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
    const adminRoles = state.adminRoles || [];
    const systemNotifications = state.systemNotifications || [];

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

                if (table === 'admin_roles' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(adminRoles, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(systemNotifications, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'system_notifications' && query.mode === 'insert') {
                    const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const inserted = payload.map((row, index) => ({
                        id: row.id || `notification-${systemNotifications.length + index + 1}`,
                        created_at: row.created_at || new Date().toISOString(),
                        ...row
                    }));

                    inserted.forEach((row) => systemNotifications.push({ ...row }));
                    return {
                        data: query.single ? inserted[0] : inserted,
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

test('buildAdminLoginAnomalyAlerts flags combined new network and device family signal', () => {
    const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const firefoxWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';
    const alerts = buildAdminLoginAnomalyAlerts([
        {
            id: 'log-1',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:40:00.000Z',
            details: {
                client_ip: '198.51.100.21',
                user_agent: chromeMac
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
                user_agent: firefoxWindows
            }
        }
    ], normalizeAdminLoginAnomalyMonitorConfig(), {
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'security_admin_login_anomaly');
    assert.equal(alerts[0].severity, 'critical');
    assert.equal(alerts[0].payload.client_ip, '203.0.113.88');
    assert.equal(alerts[0].payload.client_ip_group, '203.0.113.0/24');
    assert.equal(alerts[0].payload.recent_distinct_ip_count, 2);
    assert.equal(alerts[0].payload.recent_distinct_user_agent_count, 2);
    assert.match(alerts[0].content, /首次从新的 IP 段和设备家族组合登录后台/);
});

test('buildAdminLoginAnomalyAlerts ignores a single new network on a known device family', () => {
    const chromeMac124 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const chromeMac125 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const alerts = buildAdminLoginAnomalyAlerts([
        {
            id: 'log-1',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:40:00.000Z',
            details: {
                client_ip: '198.51.100.21',
                user_agent: chromeMac124
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
                user_agent: chromeMac125
            }
        }
    ], normalizeAdminLoginAnomalyMonitorConfig(), {
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(alerts.length, 0);
});

test('buildAdminLoginAnomalyAlerts flags three network groups in the recent window', () => {
    const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const alerts = buildAdminLoginAnomalyAlerts([
        {
            id: 'log-1',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:35:00.000Z',
            details: {
                client_ip: '198.51.100.21',
                user_agent: chromeMac
            }
        },
        {
            id: 'log-2',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:45:00.000Z',
            details: {
                client_ip: '203.0.113.88',
                user_agent: chromeMac
            }
        },
        {
            id: 'log-3',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:55:00.000Z',
            details: {
                client_ip: '192.0.2.44',
                user_agent: chromeMac
            }
        }
    ], normalizeAdminLoginAnomalyMonitorConfig(), {
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].payload.client_ip, '192.0.2.44');
    assert.equal(alerts[0].payload.recent_distinct_ip_count, 3);
    assert.equal(alerts[0].payload.recent_distinct_user_agent_count, 1);
    assert.match(alerts[0].content, /最近窗口内出现 3 个登录 IP 段/);
});

test('buildAdminLoginAnomalyAlerts ignores same network and browser-family drift', () => {
    const chromeMac124 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const chromeMac125 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const alerts = buildAdminLoginAnomalyAlerts([
        {
            id: 'log-1',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:40:00.000Z',
            details: {
                client_ip: '198.51.100.21',
                user_agent: chromeMac124
            }
        },
        {
            id: 'log-2',
            action_type: 'admin.access.session.issue',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:55:00.000Z',
            details: {
                client_ip: '198.51.100.88',
                user_agent: chromeMac125
            }
        }
    ], normalizeAdminLoginAnomalyMonitorConfig(), {
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(alerts.length, 0);
});

test('runAdminLoginAnomalySweep enqueues anomalous admin login alerts with stable dedupe', async () => {
    const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const firefoxWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';
    const state = {
        jobs: [],
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null },
            { user_id: 'admin-2', role_name: 'super_admin', expires_at: null }
        ],
        systemNotifications: [],
        auditRows: [
            {
                id: 'log-1',
                action_type: 'admin.access.session.issue',
                admin_id: 'admin-1',
                admin_email: 'admin@example.com',
                created_at: '2026-03-25T09:40:00.000Z',
                details: {
                    client_ip: '198.51.100.21',
                    user_agent: chromeMac
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
                    user_agent: firefoxWindows
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
    assert.equal(first.admin_notifications_created, 2);
    assert.equal(first.admin_notifications_skipped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.systemNotifications.length, 2);
    assert.equal(state.jobs[0].alert_type, 'security_admin_login_anomaly');
    assert.equal(state.jobs[0].payload.client_ip, '203.0.113.88');
    assert.equal(state.systemNotifications[0].scope, 'admin_personal');
    assert.equal(state.systemNotifications[0].category, 'security');

    const second = await runAdminLoginAnomalySweep(supabase, {
        runtime,
        now: '2026-03-25T10:05:00.000Z'
    });

    assert.equal(second.anomaly_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(second.admin_notifications_skipped, 2);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.systemNotifications.length, 2);
});
