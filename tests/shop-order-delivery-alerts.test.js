const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildShopOrderDeliveryFailedAlerts,
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
