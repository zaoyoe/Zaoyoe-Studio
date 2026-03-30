const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildVerifyIncidentEscalationAlerts,
    buildVerifyIncidentRecoveryAlerts,
    normalizeVerifyIncidentMonitorConfig,
    runVerifyIncidentEscalationSweep
} = require('../api/_lib/verify-incident-alerts');

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
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
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
        if (op === 'in') return Array.isArray(value) ? value.includes(row[column]) : false;
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
    const adminRoles = state.adminRoles || [];
    const systemNotifications = state.systemNotifications || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
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

test('buildVerifyIncidentEscalationAlerts escalates when multiple high-risk verify signals overlap', () => {
    const alerts = buildVerifyIncidentEscalationAlerts([
        {
            id: 'svc-1',
            alert_type: 'verify_service_disabled',
            created_at: '2026-03-25T10:00:00.000Z',
            payload: {
                key_name: 'primary-key',
                api_base_url: 'https://verify.test',
                service_status_label: '服务不可用',
                last_error: 'balance_http_503'
            }
        },
        {
            id: 'fail-1',
            alert_type: 'verify_failure_rate_spike',
            created_at: '2026-03-25T10:02:00.000Z',
            payload: {
                key_name: 'primary-key',
                api_base_url: 'https://verify.test',
                failure_rate: 77.78,
                failed_jobs: 7,
                total_jobs: 9
            }
        },
        {
            id: 'queue-1',
            alert_type: 'verify_queue_backlog',
            created_at: '2026-03-25T10:04:00.000Z',
            payload: {
                key_name: 'primary-key',
                api_base_url: 'https://verify.test',
                queue_size: 18,
                active_job_count: 11
            }
        }
    ], normalizeVerifyIncidentMonitorConfig());

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'verify_incident_escalated');
    assert.equal(alerts[0].severity, 'critical');
    assert.match(alerts[0].content, /升级信号：验证服务停摆、验证失败率飙升、验证任务堆积/);
    assert.match(alerts[0].content, /关键摘要：服务不可用 \/ balance_http_503；失败率 77\.78%（7\/9）；排队 18 个 \/ 本地活跃 11 个/);
    assert.match(alerts[0].content, /最近触发：验证服务停摆：2026-03-25T10:00:00\.000Z；验证失败率飙升：2026-03-25T10:02:00\.000Z；验证任务堆积：2026-03-25T10:04:00\.000Z/);
    assert.equal(alerts[0].payload.triggered_signal_count, 3);
    assert.deepEqual(alerts[0].payload.signal_types, [
        'verify_service_disabled',
        'verify_failure_rate_spike',
        'verify_queue_backlog'
    ]);
});

test('buildVerifyIncidentRecoveryAlerts emits a recovery notice after composite verify risk clears', () => {
    const alerts = buildVerifyIncidentRecoveryAlerts([
        {
            id: 'quota-1',
            alert_type: 'verify_quota_low',
            created_at: '2026-03-25T10:16:00.000Z',
            payload: {
                key_name: 'primary-key',
                api_base_url: 'https://verify.test',
                balance: 18,
                remaining_jobs: 9
            }
        }
    ], [
        {
            id: 'incident-1',
            alert_type: 'verify_incident_escalated',
            created_at: '2026-03-25T10:00:00.000Z',
            payload: {
                target_id: 'verify_incident:https://verify.test',
                key_name: 'primary-key',
                api_base_url: 'https://verify.test'
            }
        }
    ], normalizeVerifyIncidentMonitorConfig(), {
        now: '2026-03-25T10:18:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'verify_incident_recovered');
    assert.equal(alerts[0].severity, 'warning');
    assert.deepEqual(alerts[0].allowedChannels, ['feishu']);
    assert.match(alerts[0].content, /恢复结论：验证综合高危组合已解除，当前仍保留 1 类低优先级信号/);
    assert.match(alerts[0].content, /当前仍有信号：验证额度不足/);
    assert.equal(alerts[0].payload.incident_alert_job_id, 'incident-1');
    assert.equal(alerts[0].payload.incident_duration_minutes, 18);
    assert.deepEqual(alerts[0].payload.active_signal_types, ['verify_quota_low']);
});

test('runVerifyIncidentEscalationSweep enqueues escalated verify incidents with stable dedupe', async () => {
    const state = {
        jobs: [
            {
                id: 'svc-1',
                alert_type: 'verify_service_disabled',
                severity: 'critical',
                title: '验证服务不可用（primary-key）',
                created_at: '2026-03-25T10:00:00.000Z',
                payload: {
                    key_name: 'primary-key',
                    api_base_url: 'https://verify.test',
                    service_status_label: '服务不可用',
                    last_error: 'balance_http_503'
                }
            },
            {
                id: 'fail-1',
                alert_type: 'verify_failure_rate_spike',
                severity: 'critical',
                title: '验证失败率异常（primary-key）',
                created_at: '2026-03-25T10:02:00.000Z',
                payload: {
                    key_name: 'primary-key',
                    api_base_url: 'https://verify.test',
                    failure_rate: 77.78,
                    failed_jobs: 7,
                    total_jobs: 9
                }
            },
            {
                id: 'queue-1',
                alert_type: 'verify_queue_backlog',
                severity: 'warning',
                title: '验证任务堆积预警（primary-key）',
                created_at: '2026-03-25T10:04:00.000Z',
                payload: {
                    key_name: 'primary-key',
                    api_base_url: 'https://verify.test',
                    queue_size: 18,
                    active_job_count: 11
                }
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runVerifyIncidentEscalationSweep(supabase, {
        runtime,
        now: '2026-03-25T10:05:00.000Z'
    });

    assert.equal(first.incident_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 4);
    assert.equal(state.jobs[3].alert_type, 'verify_incident_escalated');
    assert.equal(state.jobs[3].payload.triggered_signal_count, 3);

    const second = await runVerifyIncidentEscalationSweep(supabase, {
        runtime,
        now: '2026-03-25T10:05:00.000Z'
    });

    assert.equal(second.incident_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 4);
});

test('runVerifyIncidentEscalationSweep enqueues recovery notices without duplicating admin personal notifications', async () => {
    const state = {
        jobs: [
            {
                id: 'incident-1',
                alert_type: 'verify_incident_escalated',
                severity: 'critical',
                title: '验证综合异常升级（primary-key）',
                created_at: '2026-03-25T10:00:00.000Z',
                payload: {
                    target_id: 'verify_incident:https://verify.test',
                    key_name: 'primary-key',
                    api_base_url: 'https://verify.test'
                }
            },
            {
                id: 'quota-1',
                alert_type: 'verify_quota_low',
                severity: 'warning',
                title: '验证额度告警（primary-key）',
                created_at: '2026-03-25T10:14:00.000Z',
                payload: {
                    target_id: 'verify_quota:https://verify.test',
                    key_name: 'primary-key',
                    api_base_url: 'https://verify.test',
                    balance: 18,
                    remaining_jobs: 9
                }
            }
        ],
        adminRoles: [
            { user_id: 'admin-1', role_name: 'admin', expires_at: null },
            { user_id: 'admin-2', role_name: 'super_admin', expires_at: null }
        ],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runVerifyIncidentEscalationSweep(supabase, {
        runtime,
        now: '2026-03-25T10:18:00.000Z'
    });

    assert.equal(first.incident_count, 0);
    assert.equal(first.recovered_count, 1);
    assert.equal(first.recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 3);
    assert.equal(state.jobs[2].alert_type, 'verify_incident_recovered');
    assert.deepEqual(state.jobs[2].channels, ['feishu']);
    assert.equal(state.systemNotifications.length, 0);

    const second = await runVerifyIncidentEscalationSweep(supabase, {
        runtime,
        now: '2026-03-25T10:19:00.000Z'
    });

    assert.equal(second.recovered_count, 0);
    assert.equal(second.recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 3);
    assert.equal(state.systemNotifications.length, 0);
});
