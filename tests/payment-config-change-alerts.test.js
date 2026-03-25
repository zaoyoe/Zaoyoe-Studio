const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildPaymentConfigChangedAlerts,
    buildPaymentConfigRecoveredAlerts,
    normalizePaymentConfigChangeMonitorConfig,
    runPaymentConfigChangedSweep
} = require('../api/_lib/payment-config-change-alerts');

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

test('buildPaymentConfigChangedAlerts flags payment channel updates and secret deletes', () => {
    const alerts = buildPaymentConfigChangedAlerts([
        {
            id: 'audit-1',
            action_type: 'admin.payment_channels.upsert',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:55:00.000Z',
            details: {
                active_provider: 'mock',
                updated_providers: ['mock', 'hupijiao'],
                updated_secrets: ['hupijiao_secret_key']
            }
        },
        {
            id: 'audit-2',
            action_type: 'admin.payment_channels.secret.delete',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:57:00.000Z',
            details: {
                secret_name: 'hupijiao_secret_key'
            }
        },
        {
            id: 'audit-3',
            action_type: 'admin.ops_alerts.upsert',
            admin_id: 'admin-1',
            admin_email: 'admin@example.com',
            created_at: '2026-03-25T09:58:00.000Z',
            details: {}
        }
    ], normalizePaymentConfigChangeMonitorConfig(), {
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].alertType, 'payment_config_changed');
    assert.equal(alerts[0].severity, 'critical');
    assert.match(alerts[0].content, /当前活动通道已切换为模拟支付/);
    assert.match(alerts[1].content, /删除密钥：hupijiao_secret_key/);
});

test('runPaymentConfigChangedSweep enqueues payment config alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        auditRows: [
            {
                id: 'audit-1',
                action_type: 'admin.payment_channels.upsert',
                admin_id: 'admin-1',
                admin_email: 'admin@example.com',
                created_at: '2026-03-25T09:55:00.000Z',
                details: {
                    active_provider: 'hupijiao',
                    updated_providers: ['afdian', 'hupijiao'],
                    updated_secrets: ['hupijiao_secret_key']
                }
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runPaymentConfigChangedSweep(supabase, {
        runtime,
        stateJobs: [],
        currentPaymentChannels: {
            active_provider: 'hupijiao',
            providers: {
                mock: { enabled: false },
                afdian: { enabled: true },
                hupijiao: { enabled: true }
            }
        },
        currentSecretStatus: {
            hupijiao_secret_key: { configured: true, source: 'stored' }
        },
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(first.change_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'payment_config_changed');
    assert.equal(state.jobs[0].payload.action_type, 'admin.payment_channels.upsert');

    const second = await runPaymentConfigChangedSweep(supabase, {
        runtime,
        stateJobs: [],
        currentPaymentChannels: {
            active_provider: 'hupijiao',
            providers: {
                mock: { enabled: false },
                afdian: { enabled: true },
                hupijiao: { enabled: true }
            }
        },
        currentSecretStatus: {
            hupijiao_secret_key: { configured: true, source: 'stored' }
        },
        now: '2026-03-25T10:03:00.000Z'
    });

    assert.equal(second.change_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});

test('buildPaymentConfigRecoveredAlerts emits recoveries when mock mode is rolled back and secrets are restored', () => {
    const alerts = buildPaymentConfigRecoveredAlerts([
        {
            id: 'job-risk-mock',
            alert_type: 'payment_config_changed',
            created_at: '2026-03-25T09:20:00.000Z',
            payload: {
                action_type: 'admin.payment_channels.upsert',
                admin_email: 'ops@example.com',
                active_provider: 'mock',
                active_provider_label: '模拟支付',
                risk_flags: ['当前活动通道已切换为模拟支付']
            }
        },
        {
            id: 'job-risk-secret',
            alert_type: 'payment_config_changed',
            created_at: '2026-03-25T09:25:00.000Z',
            payload: {
                action_type: 'admin.payment_channels.secret.delete',
                admin_email: 'ops@example.com',
                secret_name: 'hupijiao_secret_key',
                risk_flags: ['支付密钥 hupijiao_secret_key 已被删除']
            }
        }
    ], [
        {
            id: 'audit-restore-mock',
            action_type: 'admin.payment_channels.upsert',
            admin_email: 'owner@example.com',
            created_at: '2026-03-25T09:31:00.000Z',
            details: {
                active_provider: 'afdian',
                updated_providers: ['afdian', 'hupijiao']
            }
        },
        {
            id: 'audit-restore-secret',
            action_type: 'admin.payment_channels.upsert',
            admin_email: 'owner@example.com',
            created_at: '2026-03-25T09:34:00.000Z',
            details: {
                active_provider: 'afdian',
                updated_providers: ['afdian', 'hupijiao'],
                updated_secrets: ['hupijiao_secret_key']
            }
        }
    ], {
        active_provider: 'afdian',
        providers: {
            mock: { enabled: false },
            afdian: { enabled: true },
            hupijiao: { enabled: true }
        }
    }, {
        hupijiao_secret_key: {
            configured: true,
            source: 'stored',
            updatedAt: '2026-03-25T09:34:00.000Z'
        }
    }, normalizePaymentConfigChangeMonitorConfig(), {
        now: '2026-03-25T09:40:00.000Z'
    });

    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].alertType, 'payment_config_recovered');
    assert.match(alerts[0].content, /当前生效通道：爱发电/);
    assert.equal(alerts[1].payload.restored_secret_name, 'hupijiao_secret_key');
    assert.match(alerts[1].content, /当前密钥来源：后台密钥库/);
});

test('runPaymentConfigChangedSweep enqueues recovery notices and writes admin notifications once', async () => {
    const state = {
        jobs: [
            {
                id: 'job-risk-mock',
                alert_type: 'payment_config_changed',
                severity: 'critical',
                created_at: '2026-03-25T09:20:00.000Z',
                payload: {
                    action_type: 'admin.payment_channels.upsert',
                    admin_email: 'ops@example.com',
                    active_provider: 'mock',
                    active_provider_label: '模拟支付',
                    risk_flags: ['当前活动通道已切换为模拟支付']
                }
            }
        ],
        auditRows: [
            {
                id: 'audit-risk-mock',
                action_type: 'admin.payment_channels.upsert',
                admin_id: 'admin-1',
                admin_email: 'ops@example.com',
                created_at: '2026-03-25T09:20:00.000Z',
                details: {
                    active_provider: 'mock',
                    updated_providers: ['mock', 'afdian']
                }
            },
            {
                id: 'audit-restore-mock',
                action_type: 'admin.payment_channels.upsert',
                admin_id: 'admin-2',
                admin_email: 'owner@example.com',
                created_at: '2026-03-25T09:31:00.000Z',
                details: {
                    active_provider: 'afdian',
                    updated_providers: ['afdian', 'hupijiao']
                }
            }
        ],
        adminRoles: [
            { user_id: 'admin-user-1', role_name: 'admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runPaymentConfigChangedSweep(supabase, {
        runtime,
        auditRows: state.auditRows,
        stateJobs: state.jobs,
        currentPaymentChannels: {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false },
                afdian: { enabled: true },
                hupijiao: { enabled: true }
            }
        },
        currentSecretStatus: {},
        now: '2026-03-25T09:40:00.000Z'
    });

    assert.equal(first.change_count, 2);
    assert.equal(first.queued, 2);
    assert.equal(first.recovery_count, 1);
    assert.equal(first.recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 1);
    assert.equal(state.jobs.length, 4);
    assert.equal(state.jobs[1].alert_type, 'payment_config_changed');
    assert.equal(state.jobs[2].alert_type, 'payment_config_changed');
    assert.equal(state.jobs[3].alert_type, 'payment_config_recovered');
    assert.equal(state.systemNotifications.length, 1);
    assert.match(state.systemNotifications[0].title, /支付配置风险已恢复/);

    const second = await runPaymentConfigChangedSweep(supabase, {
        runtime,
        auditRows: state.auditRows,
        stateJobs: state.jobs,
        currentPaymentChannels: {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false },
                afdian: { enabled: true },
                hupijiao: { enabled: true }
            }
        },
        currentSecretStatus: {},
        now: '2026-03-25T09:44:00.000Z'
    });

    assert.equal(second.recovery_count, 0);
    assert.equal(second.recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 4);
    assert.equal(state.systemNotifications.length, 1);
});
