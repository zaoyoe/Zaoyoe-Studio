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

function createState(overrides = {}) {
    return {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        requireAdminCalls: [],
        jobs: [],
        attempts: [],
        runtime: {
            config: {
                enabled: true,
                channels: {
                    telegram: {
                        enabled: true,
                        minimum_severity: 'warning',
                        chat_ids: ['123456789']
                    },
                    feishu: {
                        enabled: true,
                        minimum_severity: 'warning'
                    },
                    email: {
                        enabled: true,
                        minimum_severity: 'critical',
                        recipients: ['ops@example.com'],
                        from_address: 'alerts@example.com',
                        reply_to: '',
                        subject_prefix: '[Zaoyoe告警]'
                    }
                }
            },
            secrets: {
                telegram_bot_token: 'telegram-token',
                telegram_bot_token_source: 'stored',
                telegram_bot_token_updated_at: '2026-03-26T01:00:00.000Z',
                feishu_webhook_url: 'https://hook.feishu.test/123',
                feishu_webhook_url_source: 'environment',
                feishu_webhook_url_updated_at: null,
                email_api_key: 're_test_key',
                email_api_key_source: 'stored',
                email_api_key_updated_at: '2026-03-26T01:30:00.000Z'
            }
        },
        ...overrides
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

function applyRange(rows, range) {
    if (!range) return rows;
    return rows.slice(range.from, range.to + 1);
}

function createSupabaseStub(state) {
    return {
        from(table) {
            if (!['ops_alert_jobs', 'ops_alert_job_attempts'].includes(table)) {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const rows = table === 'ops_alert_jobs' ? (state.jobs || []) : (state.attempts || []);
            const queryState = {
                filters: [],
                order: null,
                range: null
            };

            const query = {
                select() {
                    return query;
                },
                gte(column, value) {
                    queryState.filters.push({ op: 'gte', column, value });
                    return query;
                },
                order(column, options = {}) {
                    queryState.order = {
                        column,
                        ascending: options.ascending !== false
                    };
                    return query;
                },
                async range(from, to) {
                    return {
                        data: applyRange(sortRows(applyFilters(rows, queryState.filters), queryState.order), { from, to }),
                        error: null
                    };
                }
            };

            return query;
        }
    };
}

function createAdminModule(state) {
    function normalizeAdminSite(value, options = {}) {
        const normalizedDefault = Object.prototype.hasOwnProperty.call(options, 'defaultValue')
            ? normalizeAdminSite(options.defaultValue)
            : '';
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) return normalizedDefault;
        if (normalized === 'cn' || normalized === 'intl' || normalized === 'all') return normalized;
        return normalizedDefault;
    }

    return {
        normalizeAdminSite,
        async requireAdmin(_req, options = {}) {
            state.requireAdminCalls.push(options);
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

function createOpsAlertsModule(state) {
    return {
        async loadOpsAlertsRuntimeConfig() {
            return state.runtime;
        },
        buildOpsAlertSecretStatus(runtime = {}) {
            const secrets = runtime.secrets || {};
            return {
                telegram_bot_token: {
                    configured: Boolean(secrets.telegram_bot_token),
                    source: secrets.telegram_bot_token_source || 'missing',
                    updatedAt: secrets.telegram_bot_token_updated_at || null,
                    errorMessage: secrets.telegram_bot_token_error_message || ''
                },
                feishu_webhook_url: {
                    configured: Boolean(secrets.feishu_webhook_url),
                    source: secrets.feishu_webhook_url_source || 'missing',
                    updatedAt: secrets.feishu_webhook_url_updated_at || null,
                    errorMessage: secrets.feishu_webhook_url_error_message || ''
                },
                email_api_key: {
                    configured: Boolean(secrets.email_api_key),
                    source: secrets.email_api_key_source || 'missing',
                    updatedAt: secrets.email_api_key_updated_at || null,
                    errorMessage: secrets.email_api_key_error_message || ''
                }
            };
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/ops-alert-health.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule(state);
        }
        if (request === '../../../../api/_lib/ops-alerts') {
            return createOpsAlertsModule(state);
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

function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

test('ops alert health handler summarizes recent channel delivery health', async () => {
    await withHandler({
        jobs: [
            {
                id: 'job-telegram-dead',
                status: 'dead_letter',
                channels: ['telegram'],
                remaining_channels: ['telegram'],
                created_at: hoursAgo(2),
                last_error: 'telegram dead letter'
            },
            {
                id: 'job-feishu-retry',
                status: 'retry',
                channels: ['feishu'],
                remaining_channels: ['feishu'],
                created_at: hoursAgo(3),
                last_error: 'feishu timeout'
            },
            {
                id: 'job-email-done',
                status: 'delivered',
                channels: ['email'],
                remaining_channels: [],
                created_at: hoursAgo(4),
                last_error: null,
                alert_type: 'wallet_recharge_succeeded',
                title: '充值成功',
                payload: {
                    buyer_label: '林白',
                    user_id: 'user_demo_buyer_001'
                }
            }
        ],
        attempts: [
            {
                job_id: 'job-telegram-dead',
                channel: 'telegram',
                status: 'failed',
                response_status: 500,
                error_message: 'telegram timeout',
                created_at: hoursAgo(2)
            },
            {
                job_id: 'job-feishu-retry',
                channel: 'feishu',
                status: 'failed',
                response_status: 429,
                error_message: 'feishu rate limit',
                created_at: hoursAgo(3)
            },
            {
                job_id: 'job-email-done',
                channel: 'email',
                status: 'delivered',
                response_status: 200,
                error_message: '',
                created_at: hoursAgo(4)
            }
        ]
    }, async (handler, state) => {
        const response = createMockResponse();
        await handler({ method: 'GET', headers: {} }, response);

        assert.equal(response.statusCode, 200);
        const payload = response.json();
        assert.equal(payload.success, true);
        assert.deepEqual(
            state.requireAdminCalls[0],
            { anyOf: ['ops_alerts.manage', 'analytics.view'] }
        );
        assert.equal(payload.summary.total_job_count, 3);
        assert.equal(payload.summary.total_attempt_count, 3);
        assert.equal(payload.summary.delivered_count, 1);
        assert.equal(payload.summary.failed_count, 2);
        assert.equal(payload.summary.recent_deliveries.length, 1);
        assert.equal(payload.summary.recent_deliveries[0].alert_type, 'wallet_recharge_succeeded');
        assert.equal(payload.summary.recent_deliveries[0].target_summary, '林白');
        assert.equal(payload.summary.recent_delivery_types.length, 1);
        assert.equal(payload.summary.recent_delivery_types[0].title, '充值成功');
        assert.equal(payload.summary.recent_delivery_types[0].count, 1);
        assert.equal(payload.summary.recent_errors.length, 2);
        assert.equal(payload.summary.recent_errors[0].channel_label, 'Telegram');
        assert.equal(payload.summary.recent_errors[0].message, 'telegram timeout');
        assert.equal(payload.summary.recent_errors[1].channel_label, '飞书');
        assert.equal(payload.summary.recent_errors[1].message, 'feishu rate limit');
        assert.equal(payload.summary.recent_error_channels.length, 2);
        assert.equal(payload.summary.recent_error_channels[0].channel_label, 'Telegram');
        assert.equal(payload.summary.recent_error_channels[0].count, 1);
        assert.equal(payload.summary.recent_error_channels[1].channel_label, '飞书');
        assert.equal(payload.summary.recent_error_channels[1].count, 1);
        assert.equal(payload.summary.trend_bucket_hours, 6);
        assert.equal(payload.summary.recent_trend_buckets.length, 12);
        assert.equal(
            payload.summary.recent_trend_buckets.reduce((sum, bucket) => sum + Number(bucket.delivered_count || 0), 0),
            1
        );
        assert.equal(
            payload.summary.recent_trend_buckets.reduce((sum, bucket) => sum + Number(bucket.failed_count || 0), 0),
            2
        );
        assert.equal(
            payload.summary.recent_trend_buckets.reduce((sum, bucket) => sum + Number(bucket.dead_letter_count || 0), 0),
            1
        );

        const telegram = payload.channels.find((channel) => channel.key === 'telegram');
        const feishu = payload.channels.find((channel) => channel.key === 'feishu');
        const email = payload.channels.find((channel) => channel.key === 'email');

        assert.equal(telegram.health_label, '存在死信');
        assert.equal(telegram.dead_letter_count, 1);
        assert.equal(telegram.recipient_summary, '1 个 chat');

        assert.equal(feishu.health_label, '存在失败 / 重试');
        assert.equal(feishu.retry_count, 1);
        assert.equal(feishu.source, 'environment');

        assert.equal(email.health_label, '最近投递正常');
        assert.equal(email.delivered_count, 1);
        assert.equal(email.recipient_summary, '1 个收件人');
        assert.equal(email.recipient_preview, 'ops@example.com');
        assert.equal(email.from_address, 'alerts@example.com');
        assert.equal(email.subject_prefix, '[Zaoyoe告警]');
        assert.equal(email.recent_deliveries.length, 1);
        assert.equal(email.recent_deliveries[0].title, '充值成功');
    });
});

test('ops alert health handler keeps the panel readable when a stored secret cannot be decrypted', async () => {
    await withHandler({
        runtime: {
            config: {
                enabled: true,
                channels: {
                    telegram: {
                        enabled: true,
                        minimum_severity: 'warning',
                        chat_ids: ['123456789']
                    },
                    feishu: {
                        enabled: false,
                        minimum_severity: 'warning'
                    },
                    email: {
                        enabled: false,
                        minimum_severity: 'warning',
                        recipients: [],
                        from_address: '',
                        reply_to: '',
                        subject_prefix: '[Zaoyoe告警]'
                    }
                }
            },
            secrets: {
                telegram_bot_token: '',
                telegram_bot_token_source: 'error',
                telegram_bot_token_updated_at: '2026-03-26T01:00:00.000Z',
                telegram_bot_token_error_message: 'Telegram Bot Token 无法解密，请检查 ADMIN_CONFIG_ENCRYPTION_KEY 是否与写入该密钥时一致，或重新保存该密钥。',
                feishu_webhook_url: '',
                feishu_webhook_url_source: 'missing',
                feishu_webhook_url_updated_at: null,
                feishu_webhook_url_error_message: '',
                email_api_key: '',
                email_api_key_source: 'missing',
                email_api_key_updated_at: null,
                email_api_key_error_message: ''
            }
        }
    }, async (handler) => {
        const response = createMockResponse();
        await handler({ method: 'GET', headers: {} }, response);

        assert.equal(response.statusCode, 200);
        const payload = response.json();
        assert.equal(payload.success, true);
        assert.equal(payload.summary.config_issue_count, 1);
        assert.equal(payload.summary.config_issues[0].includes('Telegram'), true);

        const telegram = payload.channels.find((channel) => channel.key === 'telegram');
        assert.equal(telegram.health_label, '密钥解密失败');
        assert.equal(telegram.source, 'error');
        assert.equal(telegram.errors[0].includes('ADMIN_CONFIG_ENCRYPTION_KEY'), true);
        assert.equal(telegram.last_error.includes('ADMIN_CONFIG_ENCRYPTION_KEY'), true);
    });
});

test('ops alert health handler rejects unsupported methods', async () => {
    await withHandler({}, async (handler) => {
        const response = createMockResponse();
        await handler({ method: 'POST', headers: {} }, response);

        assert.equal(response.statusCode, 405);
        assert.equal(response.json().success, false);
    });
});
