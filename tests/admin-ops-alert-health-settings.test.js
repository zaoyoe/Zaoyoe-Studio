const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function compareValue(left, right) {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate - rightDate;
    }
    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'gte') {
            return compareValue(row[column], value) >= 0;
        }
        return true;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) return rows.slice();
    return rows.slice().sort((left, right) => (
        order.ascending
            ? compareValue(left[order.column], right[order.column])
            : compareValue(right[order.column], left[order.column])
    ));
}

function createSupabaseStub(state) {
    return {
        from(table) {
            const sourceRows = table === 'ops_alert_jobs'
                ? state.jobs
                : table === 'ops_alert_job_attempts'
                    ? state.attempts
                    : null;

            if (!sourceRows) {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                filters: [],
                order: null
            };

            return {
                select() {
                    return this;
                },
                gte(column, value) {
                    queryState.filters.push({ op: 'gte', column, value });
                    return this;
                },
                order(column, options = {}) {
                    queryState.order = {
                        column,
                        ascending: options.ascending !== false
                    };
                    return this;
                },
                async range(from, to) {
                    const rows = sortRows(applyFilters(sourceRows, queryState.filters), queryState.order).slice(from, to + 1);
                    return { data: rows, error: null };
                }
            };
        }
    };
}

function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/ops-alert-health.js');
    const originalLoad = Module._load;
    const state = {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        jobs: [],
        attempts: [],
        runtime: {
            config: {
                enabled: true,
                channels: {
                    telegram: { enabled: true, minimum_severity: 'warning', chat_ids: ['5104238366'] },
                    feishu: { enabled: true, minimum_severity: 'warning' },
                    email: {
                        enabled: true,
                        minimum_severity: 'critical',
                        recipients: ['ops@example.com'],
                        from_address: 'Zaoyoe Alerts <alerts@zaoyoe.com>',
                        subject_prefix: '[Zaoyoe] '
                    }
                }
            },
            secrets: {}
        },
        secretStatus: {
            telegram_bot_token: { configured: true, source: 'stored', updatedAt: '2026-03-25T09:00:00.000Z' },
            feishu_webhook_url: { configured: true, source: 'stored', updatedAt: '2026-03-25T09:00:00.000Z' },
            email_api_key: { configured: true, source: 'stored', updatedAt: '2026-03-25T09:00:00.000Z' }
        },
        ...stateOverrides
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin() {
                    return {
                        supabase: createSupabaseStub(state),
                        user: state.user
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        if (request === '../../../../api/_lib/ops-alerts') {
            return {
                async loadOpsAlertsRuntimeConfig() {
                    return state.runtime;
                },
                buildOpsAlertSecretStatus() {
                    return state.secretStatus;
                }
            };
        }

        return originalLoad(request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback(handler, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('ops alert health handler summarizes enabled channels and recent failures', async () => {
    await withHandler({
        jobs: [
            {
                id: 'job-1',
                alert_type: 'payment_refund_ops',
                status: 'delivered',
                channels: ['telegram', 'email'],
                remaining_channels: [],
                created_at: hoursAgo(2),
                delivered_at: hoursAgo(1),
                updated_at: hoursAgo(1)
            },
            {
                id: 'job-2',
                alert_type: 'payment_gateway_degraded',
                status: 'dead_letter',
                channels: ['feishu'],
                remaining_channels: ['feishu'],
                created_at: hoursAgo(3),
                delivered_at: null,
                updated_at: hoursAgo(1)
            }
        ],
        attempts: [
            {
                id: 'attempt-1',
                job_id: 'job-1',
                channel: 'telegram',
                status: 'delivered',
                response_status: 200,
                error_message: '',
                response_body: '',
                created_at: hoursAgo(1)
            },
            {
                id: 'attempt-2',
                job_id: 'job-1',
                channel: 'email',
                status: 'failed',
                response_status: 401,
                error_message: 'invalid api key',
                response_body: '',
                created_at: hoursAgo(1)
            },
            {
                id: 'attempt-3',
                job_id: 'job-2',
                channel: 'feishu',
                status: 'failed',
                response_status: 500,
                error_message: 'webhook timeout',
                response_body: '',
                created_at: hoursAgo(2)
            }
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.enabled_channel_count, 3);
        assert.equal(payload.channels.length, 3);

        const email = payload.channels.find((item) => item.key === 'email');
        assert.equal(email.enabled, true);
        assert.equal(email.configured, true);
        assert.equal(email.failed_count, 1);
        assert.equal(email.recipient_count, 1);

        const feishu = payload.channels.find((item) => item.key === 'feishu');
        assert.equal(feishu.dead_letter_job_count, 1);
        assert.equal(feishu.health_tone, 'danger');

        assert.equal(payload.recent_failures.length, 2);
        assert.equal(payload.recent_failures[0].channel_label.length > 0, true);
    });
});
