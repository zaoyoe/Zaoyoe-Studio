const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildAdminLoginAnomalyAlerts,
    normalizeAdminLoginAnomalyMonitorConfig,
    runAdminLoginAnomalySweep
} = require('../api/_lib/admin-login-anomaly-alerts');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        payload: null,
        range: null,
        single: false
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
            return builder;
        },
        range(from, to) {
            state.range = { from, to };
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
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
        if (op === 'eq') return row[column] === value;
        if (op === 'gte') return compareValue(row[column], value) >= 0;
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

function createSupabaseStub(state = {}) {
    const jobs = state.jobs || [];
    const auditRows = state.auditRows || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'admin_audit_logs_view' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(auditRows, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(jobs, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'ops_alert_jobs' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `job-${jobs.length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    }));

                    inserted.forEach((row) => jobs.push({ ...row }));
                    return {
                        data: query.single ? inserted[0] : inserted,
                        error: null
                    };
                }

                throw new Error(`Unexpected table access: ${table}/${query.mode}`);
            });
        }
    };
}

function createOpsRuntime() {
    return {
        config: normalizeOpsAlertsConfig({
            enabled: true,
            channels: {
                telegram: {
                    enabled: true,
                    minimum_severity: 'warning',
                    chat_ids: ['10001']
                },
                feishu: {
                    enabled: true,
                    minimum_severity: 'warning'
                }
            }
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    };
}

test('buildAdminLoginAnomalyAlerts flags new admin login IPs and short-window drift', () => {
    const alerts = buildAdminLoginAnomalyAlerts([
        {
            id: 'log-1',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:40:00.000Z',
            details: {
                client_ip: '198.51.100.21',
                user_agent: 'UA-1'
            }
        },
        {
            id: 'log-2',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:55:00.000Z',
            details: {
                client_ip: '203.0.113.88',
                user_agent: 'UA-2'
            }
        }
    ], normalizeAdminLoginAnomalyMonitorConfig(), {
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'security_admin_login_anomaly');
    assert.equal(alerts[0].severity, 'critical');
    assert.equal(alerts[0].payload.client_ip, '203.0.113.88');
    assert.equal(alerts[0].payload.recent_distinct_ip_count, 2);
    assert.match(alerts[0].content, /首次从该 IP 登录后台/);
});

test('runAdminLoginAnomalySweep enqueues anomalous admin login alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        auditRows: [
            {
                id: 'log-1',
                action_type: 'admin.access.session.issue',
                admin_id: 'admin-1',
                admin_email: 'admin@example.com',
                created_at: '2026-03-25T09:40:00.000Z',
                details: {
                    client_ip: '198.51.100.21',
                    user_agent: 'UA-1'
                }
            },
            {
                id: 'log-2',
                action_type: 'admin.access.session.issue',
                admin_id: 'admin-1',
                admin_email: 'admin@example.com',
                created_at: '2026-03-25T09:55:00.000Z',
                details: {
                    client_ip: '203.0.113.88',
                    user_agent: 'UA-2'
                }
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runAdminLoginAnomalySweep(supabase, {
        runtime,
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(first.anomaly_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'security_admin_login_anomaly');
    assert.equal(state.jobs[0].payload.client_ip, '203.0.113.88');

    const second = await runAdminLoginAnomalySweep(supabase, {
        runtime,
        now: '2026-03-25T10:05:00.000Z'
    });

    assert.equal(second.anomaly_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});
