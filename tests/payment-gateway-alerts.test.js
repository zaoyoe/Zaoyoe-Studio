const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildGatewayProviderStats,
    buildPaymentGatewayDegradedAlerts,
    buildPaymentGatewayRecoveredAlerts,
    normalizePaymentGatewayMonitorConfig,
    runPaymentGatewayDegradationSweep
} = require('../api/_lib/payment-gateway-alerts');

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
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
            return builder;
        },
        lte(column, value) {
            state.filters.push({ op: 'lte', column, value });
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
        if (op === 'lte') return compareValue(row[column], value) <= 0;
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
    const orders = state.orders || [];
    const events = state.events || [];
    const queryAttempts = state.queryAttempts || [];
    const jobs = state.jobs || [];
    const adminRoles = state.adminRoles || [];
    const systemNotifications = state.systemNotifications || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'payment_orders' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(orders, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'payment_events' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(events, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'payment_query_attempts' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(queryAttempts, query.filters), query.order), query.range),
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

                    inserted.forEach((row) => {
                        jobs.push({
                            ...row
                        });
                    });

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

                    inserted.forEach((row) => {
                        systemNotifications.push({
                            ...row
                        });
                    });

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

function createOpsRuntime(configOverrides = {}) {
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
            },
            ...configOverrides
        }),
        secrets: {
            telegram_bot_token: 'telegram-token',
            feishu_webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo'
        }
    };
}

test('buildPaymentGatewayDegradedAlerts flags real provider degradation and ignores mock', () => {
    const providerStats = buildGatewayProviderStats({
        orders: [
            { provider: 'afdian', status: 'paid', site: 'cn' },
            { provider: 'afdian', status: 'pending_review', site: 'cn' },
            { provider: 'afdian', status: 'pending_review', site: 'cn' },
            { provider: 'afdian', status: 'pending_review', site: 'cn' },
            { provider: 'afdian', status: 'pending_review', site: 'cn' },
            { provider: 'afdian', status: 'amount_mismatch', site: 'cn' },
            { provider: 'mock', status: 'pending_review', site: 'cn' },
            { provider: 'mock', status: 'pending_review', site: 'cn' },
            { provider: 'mock', status: 'pending_review', site: 'cn' },
            { provider: 'mock', status: 'pending_review', site: 'cn' },
            { provider: 'mock', status: 'pending_review', site: 'cn' },
            { provider: 'mock', status: 'pending_review', site: 'cn' }
        ],
        events: [
            { provider: 'afdian', response_status: 500, signature_valid: true, amount_valid: true, processing_result: 'webhook_exception', error_message: 'rpc failed' },
            { provider: 'afdian', response_status: 502, signature_valid: true, amount_valid: true, processing_result: 'webhook_exception', error_message: 'rpc failed' },
            { provider: 'afdian', response_status: 503, signature_valid: true, amount_valid: true, processing_result: 'webhook_exception', error_message: 'rpc failed' },
            { provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '' },
            { provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '' }
        ],
        queryAttempts: []
    });

    const alerts = buildPaymentGatewayDegradedAlerts(providerStats, normalizePaymentGatewayMonitorConfig());

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'payment_gateway_degraded');
    assert.equal(alerts[0].payload.provider, 'afdian');
    assert.equal(alerts[0].payload.site, 'cn');
    assert.equal(alerts[0].dedupeWindowMinutes, 60);
    assert.match(alerts[0].title, /爱发电/);
});

test('buildPaymentGatewayRecoveredAlerts emits a recovery notice when provider health recovers', () => {
    const providerStats = buildGatewayProviderStats({
        orders: [
            { provider: 'afdian', status: 'paid', site: 'cn' },
            { provider: 'afdian', status: 'paid', site: 'cn' },
            { provider: 'afdian', status: 'paid', site: 'cn' },
            { provider: 'afdian', status: 'paid', site: 'cn' },
            { provider: 'afdian', status: 'paid', site: 'cn' },
            { provider: 'afdian', status: 'paid', site: 'cn' },
            { provider: 'afdian', status: 'pending_review', site: 'cn' },
            { provider: 'afdian', status: 'paid', site: 'cn' }
        ],
        events: [
            { provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '' },
            { provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '' },
            { provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '' },
            { provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '' },
            { provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '' }
        ],
        queryAttempts: [
            { provider: 'afdian', site: 'cn', success: true, response_status: 200 },
            { provider: 'afdian', site: 'cn', success: true, response_status: 200 },
            { provider: 'afdian', site: 'cn', success: true, response_status: 200 },
            { provider: 'afdian', site: 'cn', success: true, response_status: 200 },
            { provider: 'afdian', site: 'cn', success: true, response_status: 200 }
        ]
    });

    const alerts = buildPaymentGatewayRecoveredAlerts(providerStats, [
        {
            id: 'gateway-incident-1',
            alert_type: 'payment_gateway_degraded',
            created_at: '2026-03-25T09:30:00.000Z',
            payload: {
                target_id: 'payment_gateway:afdian:cn',
                provider: 'afdian',
                site: 'cn',
                degraded_reasons: ['支付成功率仅 16.67%（1/6）', '回调 5xx 已累计 3 次']
            }
        }
    ], normalizePaymentGatewayMonitorConfig(), {
        now: '2026-03-25T09:54:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'payment_gateway_recovered');
    assert.equal(alerts[0].severity, 'warning');
    assert.deepEqual(alerts[0].allowedChannels, ['feishu']);
    assert.equal(alerts[0].dedupeWindowMinutes, 60);
    assert.match(alerts[0].content, /恢复结论：支付通道异常阈值已解除/);
    assert.equal(alerts[0].payload.gateway_alert_job_id, 'gateway-incident-1');
    assert.equal(alerts[0].payload.incident_duration_minutes, 24);
});

test('runPaymentGatewayDegradationSweep prefers runtime payment gateway config over passed options', async () => {
    const now = new Date('2026-03-25T10:00:00.000Z');
    const state = {
        orders: [
            { id: 'po-1', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:40:00.000Z' },
            { id: 'po-2', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:41:00.000Z' },
            { id: 'po-3', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:42:00.000Z' },
            { id: 'po-4', provider: 'afdian', status: 'amount_mismatch', site: 'cn', created_at: '2026-03-25T09:43:00.000Z' },
            { id: 'po-5', provider: 'afdian', status: 'amount_mismatch', site: 'cn', created_at: '2026-03-25T09:44:00.000Z' },
            { id: 'po-6', provider: 'afdian', status: 'amount_mismatch', site: 'cn', created_at: '2026-03-25T09:45:00.000Z' }
        ],
        events: [],
        queryAttempts: [],
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime({
        payment_gateway: {
            enabled: true,
            min_failed_orders: 3,
            min_failed_ratio_percent: 30,
            dedupe_window_minutes: 75
        }
    });

    const result = await runPaymentGatewayDegradationSweep(supabase, {
        now,
        runtime,
        config: {
            enabled: false,
            min_failed_orders: 99,
            min_failed_ratio_percent: 90,
            dedupe_window_minutes: 5
        }
    });

    assert.equal(result.skipped, undefined);
    assert.equal(result.degraded_count, 1);
    assert.equal(result.queued, 1);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'payment_gateway_degraded');
});

test('runPaymentGatewayDegradationSweep enqueues degraded alerts with stable provider dedupe', async () => {
    const now = new Date('2026-03-25T10:00:00.000Z');
    const state = {
        orders: [
            { id: 'po-1', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:40:00.000Z' },
            { id: 'po-2', provider: 'afdian', status: 'pending_review', site: 'cn', created_at: '2026-03-25T09:41:00.000Z' },
            { id: 'po-3', provider: 'afdian', status: 'pending_review', site: 'cn', created_at: '2026-03-25T09:42:00.000Z' },
            { id: 'po-4', provider: 'afdian', status: 'pending_review', site: 'cn', created_at: '2026-03-25T09:43:00.000Z' },
            { id: 'po-5', provider: 'afdian', status: 'amount_mismatch', site: 'cn', created_at: '2026-03-25T09:44:00.000Z' },
            { id: 'po-6', provider: 'afdian', status: 'amount_mismatch', site: 'cn', created_at: '2026-03-25T09:45:00.000Z' }
        ],
        events: [
            { id: 'pe-1', provider: 'afdian', response_status: 500, signature_valid: true, amount_valid: true, processing_result: 'webhook_exception', error_message: 'rpc failed', created_at: '2026-03-25T09:46:00.000Z' },
            { id: 'pe-2', provider: 'afdian', response_status: 502, signature_valid: true, amount_valid: true, processing_result: 'webhook_exception', error_message: 'rpc failed', created_at: '2026-03-25T09:47:00.000Z' },
            { id: 'pe-3', provider: 'afdian', response_status: 503, signature_valid: true, amount_valid: true, processing_result: 'webhook_exception', error_message: 'rpc failed', created_at: '2026-03-25T09:48:00.000Z' },
            { id: 'pe-4', provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '', created_at: '2026-03-25T09:49:00.000Z' },
            { id: 'pe-5', provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '', created_at: '2026-03-25T09:50:00.000Z' }
        ],
        queryAttempts: [
            { id: 'pq-1', provider: 'afdian', site: 'cn', success: false, response_status: 500, outcome_code: 'query_exception', created_at: '2026-03-25T09:45:00.000Z' },
            { id: 'pq-2', provider: 'afdian', site: 'cn', success: false, response_status: 502, outcome_code: 'query_exception', created_at: '2026-03-25T09:46:00.000Z' },
            { id: 'pq-3', provider: 'afdian', site: 'cn', success: false, response_status: 503, outcome_code: 'query_exception', created_at: '2026-03-25T09:47:00.000Z' },
            { id: 'pq-4', provider: 'afdian', site: 'cn', success: true, response_status: 200, outcome_code: 'success', created_at: '2026-03-25T09:48:00.000Z' },
            { id: 'pq-5', provider: 'afdian', site: 'cn', success: true, response_status: 200, outcome_code: 'success', created_at: '2026-03-25T09:49:00.000Z' }
        ],
        jobs: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runPaymentGatewayDegradationSweep(supabase, {
        now,
        runtime
    });

    assert.equal(first.degraded_count, 1);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'payment_gateway_degraded');
    assert.equal(state.jobs[0].payload.provider, 'afdian');
    assert.match(state.jobs[0].content, /判定信号：/);

    state.orders.push({
        id: 'po-7',
        provider: 'afdian',
        status: 'pending_review',
        site: 'cn',
        created_at: '2026-03-25T09:51:00.000Z'
    });

    const second = await runPaymentGatewayDegradationSweep(supabase, {
        now,
        runtime
    });

    assert.equal(second.degraded_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});

test('runPaymentGatewayDegradationSweep enqueues recovery notices and writes admin notifications once', async () => {
    const now = new Date('2026-03-25T10:00:00.000Z');
    const state = {
        orders: [
            { id: 'po-1', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:40:00.000Z' },
            { id: 'po-2', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:41:00.000Z' },
            { id: 'po-3', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:42:00.000Z' },
            { id: 'po-4', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:43:00.000Z' },
            { id: 'po-5', provider: 'afdian', status: 'pending_review', site: 'cn', created_at: '2026-03-25T09:44:00.000Z' },
            { id: 'po-6', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:45:00.000Z' },
            { id: 'po-7', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:46:00.000Z' },
            { id: 'po-8', provider: 'afdian', status: 'paid', site: 'cn', created_at: '2026-03-25T09:47:00.000Z' }
        ],
        events: [
            { id: 'pe-1', provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '', created_at: '2026-03-25T09:46:00.000Z' },
            { id: 'pe-2', provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '', created_at: '2026-03-25T09:47:00.000Z' },
            { id: 'pe-3', provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '', created_at: '2026-03-25T09:48:00.000Z' },
            { id: 'pe-4', provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '', created_at: '2026-03-25T09:49:00.000Z' },
            { id: 'pe-5', provider: 'afdian', response_status: 200, signature_valid: true, amount_valid: true, processing_result: 'processed_paid', error_message: '', created_at: '2026-03-25T09:50:00.000Z' }
        ],
        queryAttempts: [
            { id: 'pq-1', provider: 'afdian', site: 'cn', success: true, response_status: 200, outcome_code: 'success', created_at: '2026-03-25T09:45:00.000Z' },
            { id: 'pq-2', provider: 'afdian', site: 'cn', success: true, response_status: 200, outcome_code: 'success', created_at: '2026-03-25T09:46:00.000Z' },
            { id: 'pq-3', provider: 'afdian', site: 'cn', success: true, response_status: 200, outcome_code: 'success', created_at: '2026-03-25T09:47:00.000Z' },
            { id: 'pq-4', provider: 'afdian', site: 'cn', success: true, response_status: 200, outcome_code: 'success', created_at: '2026-03-25T09:48:00.000Z' },
            { id: 'pq-5', provider: 'afdian', site: 'cn', success: true, response_status: 200, outcome_code: 'success', created_at: '2026-03-25T09:49:00.000Z' }
        ],
        jobs: [
            {
                id: 'gateway-incident-1',
                alert_type: 'payment_gateway_degraded',
                severity: 'critical',
                title: '爱发电 支付通道异常波动（CN）',
                created_at: '2026-03-25T09:36:00.000Z',
                payload: {
                    target_id: 'payment_gateway:afdian:cn',
                    provider: 'afdian',
                    site: 'cn',
                    degraded_reasons: ['支付成功率仅 16.67%（1/6）', '回调 5xx 已累计 3 次']
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

    const first = await runPaymentGatewayDegradationSweep(supabase, {
        now,
        runtime
    });

    assert.equal(first.degraded_count, 0);
    assert.equal(first.recovered_count, 1);
    assert.equal(first.recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 2);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.jobs[1].alert_type, 'payment_gateway_recovered');
    assert.deepEqual(state.jobs[1].channels, ['feishu']);
    assert.equal(state.systemNotifications.length, 2);

    const second = await runPaymentGatewayDegradationSweep(supabase, {
        now: new Date('2026-03-25T10:01:00.000Z'),
        runtime
    });

    assert.equal(second.recovered_count, 0);
    assert.equal(second.recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.systemNotifications.length, 2);
});
