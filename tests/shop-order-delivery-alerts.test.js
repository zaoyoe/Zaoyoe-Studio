const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildShopOrderDeliveryFailedAlerts,
    buildShopOrderDeliveryIncidentAlerts,
    buildShopOrderDeliveryIncidentRecoveryAlerts,
    buildShopOrderDeliveryRecoveredAlerts,
    normalizeShopOrderDeliveryMonitorConfig,
    runShopOrderDeliveryFailedSweep
} = require('../api/_lib/shop-order-delivery-alerts');

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
        lte(column, value) {
            state.filters.push({ op: 'lte', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, value: values });
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
        if (op === 'lte') return compareValue(row[column], value) <= 0;
        if (op === 'in') return Array.isArray(value) ? value.includes(row[column]) : false;
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
    const orders = state.orders || [];
    const adminRoles = state.adminRoles || [];
    const systemNotifications = state.systemNotifications || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_orders' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(orders, query.filters), query.order), query.range),
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
                        jobs.push({ ...row });
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
                        systemNotifications.push({ ...row });
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

test('buildShopOrderDeliveryFailedAlerts flags dead letters and sustained retry failures', () => {
    const alerts = buildShopOrderDeliveryFailedAlerts([
        {
            id: 'shop-order-dead-001',
            user_id: 'buyer-001',
            snapshot_product_name: 'Prompt Pro 年卡',
            total_price: 59.8,
            item_count: 2,
            delivery_status: 'dead_letter',
            delivery_attempt_count: 4,
            delivery_last_error: '目标履约地址连续超时',
            delivery_updated_at: '2026-03-25T09:45:00.000Z',
            created_at: '2026-03-25T08:10:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'shop-order-retry-001',
            user_id: 'buyer-002',
            snapshot_product_name: '卡密周卡',
            total_price: 9.9,
            item_count: 1,
            delivery_status: 'retry_waiting',
            delivery_attempt_count: 2,
            delivery_last_error: '库存锁定冲突，已等待下一轮重试',
            delivery_updated_at: '2026-03-25T09:48:00.000Z',
            created_at: '2026-03-25T09:00:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'shop-order-noise-001',
            user_id: 'buyer-003',
            snapshot_product_name: '接口发货测试',
            total_price: 19.9,
            item_count: 1,
            delivery_status: 'retry_waiting',
            delivery_attempt_count: 1,
            delivery_last_error: '首次超时',
            delivery_updated_at: '2026-03-25T09:52:00.000Z',
            created_at: '2026-03-25T09:30:00.000Z',
            refund_status: 'none'
        },
        {
            id: 'shop-order-refunded-001',
            user_id: 'buyer-004',
            snapshot_product_name: '退款单',
            total_price: 29.9,
            item_count: 1,
            delivery_status: 'dead_letter',
            delivery_attempt_count: 4,
            delivery_last_error: '退款后不应再告警',
            delivery_updated_at: '2026-03-25T09:50:00.000Z',
            created_at: '2026-03-25T09:20:00.000Z',
            refund_status: 'full_refund'
        }
    ], normalizeShopOrderDeliveryMonitorConfig());

    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].alertType, 'shop_order_delivery_failed');
    assert.equal(alerts[0].severity, 'critical');
    assert.match(alerts[0].content, /已进入履约死信队列/);
    assert.equal(alerts[1].severity, 'warning');
    assert.match(alerts[1].content, /连续履约失败 2 次/);
});

test('runShopOrderDeliveryFailedSweep enqueues delivery failure alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        orders: [
            {
                id: 'shop-order-dead-001',
                user_id: 'buyer-001',
                snapshot_product_name: 'Prompt Pro 年卡',
                price_paid: 59.8,
                total_price: 59.8,
                item_count: 2,
                delivery_status: 'dead_letter',
                delivery_attempt_count: 4,
                delivery_last_error: '目标履约地址连续超时',
                delivery_updated_at: '2026-03-25T09:45:00.000Z',
                created_at: '2026-03-25T08:10:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'shop-order-retry-001',
                user_id: 'buyer-002',
                snapshot_product_name: '卡密周卡',
                price_paid: 9.9,
                total_price: 9.9,
                item_count: 1,
                delivery_status: 'retry_waiting',
                delivery_attempt_count: 2,
                delivery_last_error: '库存锁定冲突，已等待下一轮重试',
                delivery_updated_at: '2026-03-25T09:48:00.000Z',
                created_at: '2026-03-25T09:00:00.000Z',
                refund_status: 'none'
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(first.failure_count, 2);
    assert.equal(first.dead_letter_count, 1);
    assert.equal(first.retry_waiting_count, 1);
    assert.equal(first.queued, 2);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.jobs.every((job) => job.alert_type === 'shop_order_delivery_failed'), true);
    assert.equal(
        state.jobs.some((job) => job.payload?.order_id === 'shop-order-dead-001'),
        true
    );

    const second = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:05:00.000Z'
    });

    assert.equal(second.failure_count, 2);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 2);
    assert.equal(state.jobs.length, 2);
});

test('buildShopOrderDeliveryRecoveredAlerts emits a recovery notice after a dead-letter order is delivered', () => {
    const alerts = buildShopOrderDeliveryRecoveredAlerts([
        {
            id: 'shop-order-dead-001',
            user_id: 'buyer-001',
            snapshot_product_name: 'Prompt Pro 年卡',
            price_paid: 59.8,
            total_price: 59.8,
            item_count: 2,
            delivery_status: 'delivered',
            delivery_attempt_count: 4,
            delivery_last_error: '',
            delivery_updated_at: '2026-03-25T10:54:00.000Z',
            created_at: '2026-03-25T08:10:00.000Z',
            refund_status: 'none'
        }
    ], [
        {
            id: 'delivery-failed-1',
            alert_type: 'shop_order_delivery_failed',
            severity: 'critical',
            title: '商城履约失败（shop-ord）',
            created_at: '2026-03-25T10:00:00.000Z',
            payload: {
                target_id: 'shop-order-dead-001',
                order_id: 'shop-order-dead-001',
                product_name: 'Prompt Pro 年卡',
                user_id: 'buyer-001',
                item_count: 2,
                total_price: 59.8,
                delivery_status: 'dead_letter',
                delivery_status_label: '死信待处理',
                delivery_attempt_count: 4,
                delivery_last_error: '目标履约地址连续超时'
            }
        }
    ], normalizeShopOrderDeliveryMonitorConfig(), {
        now: '2026-03-25T10:54:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'shop_order_delivery_recovered');
    assert.equal(alerts[0].severity, 'warning');
    assert.deepEqual(alerts[0].allowedChannels, ['feishu']);
    assert.match(alerts[0].content, /恢复结论：订单已成功履约，已退出履约异常状态/);
    assert.equal(alerts[0].payload.incident_alert_job_id, 'delivery-failed-1');
    assert.equal(alerts[0].payload.previous_delivery_status, 'dead_letter');
    assert.equal(alerts[0].payload.delivery_status, 'delivered');
    assert.equal(alerts[0].payload.incident_duration_minutes, 54);
});

test('buildShopOrderDeliveryIncidentRecoveryAlerts emits a recovery notice after clustered failures fall below the incident threshold', () => {
    const alerts = buildShopOrderDeliveryIncidentRecoveryAlerts([
        {
            alertType: 'shop_order_delivery_failed',
            severity: 'warning',
            payload: {
                order_id: 'shop-order-3',
                user_id: 'buyer-003',
                product_name: '卡密周卡',
                delivery_status: 'retry_waiting',
                delivery_attempt_count: 2,
                delivery_last_error: '库存锁定冲突，已等待下一轮重试'
            }
        }
    ], [
        {
            id: 'delivery-incident-1',
            alert_type: 'shop_order_delivery_incident',
            severity: 'critical',
            title: '商城履约异常升级（4 笔）',
            created_at: '2026-03-25T10:00:00.000Z',
            payload: {
                target_id: 'shop_order_delivery_incident:global',
                incident_order_count: 4,
                dead_letter_count: 2,
                retry_waiting_count: 2
            }
        }
    ], normalizeShopOrderDeliveryMonitorConfig(), {
        now: '2026-03-25T10:46:00.000Z'
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'shop_order_delivery_incident_recovered');
    assert.equal(alerts[0].severity, 'warning');
    assert.deepEqual(alerts[0].allowedChannels, ['feishu']);
    assert.match(alerts[0].content, /履约集中事故阈值已解除，当前仍保留 1 笔单笔异常订单/);
    assert.equal(alerts[0].payload.previous_incident_order_count, 4);
    assert.equal(alerts[0].payload.active_order_count, 1);
    assert.equal(alerts[0].payload.incident_duration_minutes, 46);
});

test('buildShopOrderDeliveryIncidentAlerts escalates when multiple delivery failures pile up', () => {
    const alerts = buildShopOrderDeliveryIncidentAlerts([
        {
            alertType: 'shop_order_delivery_failed',
            severity: 'critical',
            payload: {
                order_id: 'shop-order-1',
                user_id: 'buyer-001',
                product_name: 'Prompt Pro 年卡',
                delivery_status: 'dead_letter',
                delivery_attempt_count: 4,
                delivery_last_error: '目标履约地址连续超时',
                delivery_updated_at: '2026-03-25T10:10:00.000Z'
            }
        },
        {
            alertType: 'shop_order_delivery_failed',
            severity: 'critical',
            payload: {
                order_id: 'shop-order-2',
                user_id: 'buyer-002',
                product_name: 'Prompt Pro 年卡',
                delivery_status: 'dead_letter',
                delivery_attempt_count: 3,
                delivery_last_error: '目标履约地址连续超时',
                delivery_updated_at: '2026-03-25T10:12:00.000Z'
            }
        },
        {
            alertType: 'shop_order_delivery_failed',
            severity: 'warning',
            payload: {
                order_id: 'shop-order-3',
                user_id: 'buyer-003',
                product_name: '卡密周卡',
                delivery_status: 'retry_waiting',
                delivery_attempt_count: 2,
                delivery_last_error: '库存锁定冲突，已等待下一轮重试',
                delivery_updated_at: '2026-03-25T10:15:00.000Z'
            }
        }
    ], [], normalizeShopOrderDeliveryMonitorConfig());

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertType, 'shop_order_delivery_incident');
    assert.equal(alerts[0].severity, 'critical');
    assert.match(alerts[0].content, /当前同时存在 3 笔履约异常订单/);
    assert.equal(alerts[0].payload.dead_letter_count, 2);
    assert.equal(alerts[0].payload.distinct_user_count, 3);
    assert.deepEqual(alerts[0].payload.hot_products, ['Prompt Pro 年卡 × 2', '卡密周卡 × 1']);
});

test('runShopOrderDeliveryFailedSweep enqueues recovery notices and writes admin notifications once', async () => {
    const state = {
        jobs: [
            {
                id: 'delivery-failed-1',
                alert_type: 'shop_order_delivery_failed',
                severity: 'critical',
                title: '商城履约失败（shop-ord）',
                created_at: '2026-03-25T10:00:00.000Z',
                payload: {
                    target_id: 'shop-order-dead-001',
                    order_id: 'shop-order-dead-001',
                    product_name: 'Prompt Pro 年卡',
                    user_id: 'buyer-001',
                    item_count: 2,
                    total_price: 59.8,
                    delivery_status: 'dead_letter',
                    delivery_status_label: '死信待处理',
                    delivery_attempt_count: 4,
                    delivery_last_error: '目标履约地址连续超时'
                }
            }
        ],
        orders: [
            {
                id: 'shop-order-dead-001',
                user_id: 'buyer-001',
                snapshot_product_name: 'Prompt Pro 年卡',
                price_paid: 59.8,
                total_price: 59.8,
                item_count: 2,
                delivery_status: 'delivered',
                delivery_attempt_count: 4,
                delivery_last_error: '',
                delivery_updated_at: '2026-03-25T10:54:00.000Z',
                created_at: '2026-03-25T08:10:00.000Z',
                refund_status: 'none'
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

    const first = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:54:00.000Z'
    });

    assert.equal(first.failure_count, 0);
    assert.equal(first.recovered_count, 1);
    assert.equal(first.recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 2);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.jobs[1].alert_type, 'shop_order_delivery_recovered');
    assert.deepEqual(state.jobs[1].channels, ['feishu']);
    assert.equal(state.systemNotifications.length, 2);
    assert.match(state.systemNotifications[0].title, /履约已恢复/);

    const second = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:55:00.000Z'
    });

    assert.equal(second.recovered_count, 0);
    assert.equal(second.recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.systemNotifications.length, 2);
});

test('runShopOrderDeliveryFailedSweep enqueues a delivery incident escalation with stable dedupe', async () => {
    const state = {
        jobs: [],
        orders: [
            {
                id: 'shop-order-1',
                user_id: 'buyer-001',
                snapshot_product_name: 'Prompt Pro 年卡',
                price_paid: 59.8,
                total_price: 59.8,
                item_count: 2,
                delivery_status: 'dead_letter',
                delivery_attempt_count: 4,
                delivery_last_error: '目标履约地址连续超时',
                delivery_updated_at: '2026-03-25T10:10:00.000Z',
                created_at: '2026-03-25T08:10:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'shop-order-2',
                user_id: 'buyer-002',
                snapshot_product_name: 'Prompt Pro 年卡',
                price_paid: 29.9,
                total_price: 29.9,
                item_count: 1,
                delivery_status: 'dead_letter',
                delivery_attempt_count: 3,
                delivery_last_error: '目标履约地址连续超时',
                delivery_updated_at: '2026-03-25T10:12:00.000Z',
                created_at: '2026-03-25T08:20:00.000Z',
                refund_status: 'none'
            },
            {
                id: 'shop-order-3',
                user_id: 'buyer-003',
                snapshot_product_name: '卡密周卡',
                price_paid: 9.9,
                total_price: 9.9,
                item_count: 1,
                delivery_status: 'retry_waiting',
                delivery_attempt_count: 2,
                delivery_last_error: '库存锁定冲突，已等待下一轮重试',
                delivery_updated_at: '2026-03-25T10:15:00.000Z',
                created_at: '2026-03-25T09:10:00.000Z',
                refund_status: 'none'
            }
        ],
        adminRoles: [],
        systemNotifications: []
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:20:00.000Z'
    });

    assert.equal(first.failure_count, 3);
    assert.equal(first.incident_count, 1);
    assert.equal(first.queued, 3);
    assert.equal(first.incident_queued, 1);
    assert.equal(state.jobs.length, 4);
    assert.equal(state.jobs.some((job) => job.alert_type === 'shop_order_delivery_incident'), true);

    const second = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:25:00.000Z'
    });

    assert.equal(second.incident_count, 1);
    assert.equal(second.incident_queued, 0);
    assert.equal(second.incident_deduped, 1);
    assert.equal(state.jobs.length, 4);
});

test('runShopOrderDeliveryFailedSweep enqueues incident recovery notices and writes admin notifications once', async () => {
    const state = {
        jobs: [
            {
                id: 'delivery-incident-1',
                alert_type: 'shop_order_delivery_incident',
                severity: 'critical',
                title: '商城履约异常升级（4 笔）',
                created_at: '2026-03-25T10:00:00.000Z',
                payload: {
                    target_id: 'shop_order_delivery_incident:global',
                    incident_order_count: 4,
                    dead_letter_count: 2,
                    retry_waiting_count: 2
                }
            }
        ],
        orders: [
            {
                id: 'shop-order-3',
                user_id: 'buyer-003',
                snapshot_product_name: '卡密周卡',
                price_paid: 9.9,
                total_price: 9.9,
                item_count: 1,
                delivery_status: 'retry_waiting',
                delivery_attempt_count: 2,
                delivery_last_error: '库存锁定冲突，已等待下一轮重试',
                delivery_updated_at: '2026-03-25T10:15:00.000Z',
                created_at: '2026-03-25T09:10:00.000Z',
                refund_status: 'none'
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

    const first = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:46:00.000Z'
    });

    assert.equal(first.incident_count, 0);
    assert.equal(first.incident_recovered_count, 1);
    assert.equal(first.incident_recovered_queued, 1);
    assert.equal(first.admin_notifications_created, 2);
    assert.equal(state.jobs.length, 3);
    assert.equal(state.jobs[0].alert_type, 'shop_order_delivery_incident');
    assert.equal(state.jobs[1].alert_type, 'shop_order_delivery_failed');
    assert.equal(state.jobs[2].alert_type, 'shop_order_delivery_incident_recovered');
    assert.deepEqual(state.jobs[2].channels, ['feishu']);
    assert.equal(state.systemNotifications.length, 2);
    assert.match(state.systemNotifications[0].title, /履约事故已恢复/);

    const second = await runShopOrderDeliveryFailedSweep(supabase, {
        runtime,
        now: '2026-03-25T10:47:00.000Z'
    });

    assert.equal(second.incident_recovered_count, 0);
    assert.equal(second.incident_recovered_queued, 0);
    assert.equal(second.admin_notifications_created, 0);
    assert.equal(state.jobs.length, 3);
    assert.equal(state.systemNotifications.length, 2);
});
