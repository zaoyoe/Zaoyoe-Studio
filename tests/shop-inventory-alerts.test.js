const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildShopInventoryLowAlerts,
    normalizeShopInventoryMonitorConfig,
    runShopInventoryLowSweep
} = require('../api/_lib/shop-inventory-alerts');

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
    const products = state.products || [];
    const orders = state.orders || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_products' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(products, query.filters), query.order), query.range),
                        error: null
                    };
                }

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

test('buildShopInventoryLowAlerts flags low stock and sold-out key products with recent sales context', () => {
    const alerts = buildShopInventoryLowAlerts([
        {
            id: 'product-low',
            name: 'Prompt Pro 月卡',
            category: '提示词',
            stock_count: 3,
            delivery_type: 'KEY'
        },
        {
            id: 'product-empty',
            name: '账号季卡',
            category: '账号',
            stock_count: 0,
            delivery_type: null
        },
        {
            id: 'product-api',
            name: 'API 自动发货商品',
            category: '接口',
            stock_count: 0,
            delivery_type: 'API'
        }
    ], [
        {
            id: 'order-1',
            product_id: 'product-low',
            item_count: 2,
            refund_status: 'none',
            created_at: '2026-03-25T09:00:00.000Z'
        },
        {
            id: 'order-2',
            product_id: 'product-empty',
            item_count: 5,
            refund_status: 'none',
            created_at: '2026-03-24T09:00:00.000Z'
        },
        {
            id: 'order-3',
            product_id: 'product-empty',
            item_count: 1,
            refund_status: 'full_refund',
            created_at: '2026-03-24T10:00:00.000Z'
        }
    ], normalizeShopInventoryMonitorConfig());

    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].alertType, 'shop_inventory_low');
    assert.equal(alerts[0].payload.recent_sales_count, 2);
    assert.match(alerts[0].content, /最近销量：近 7 天售出 2 件/);
    assert.equal(alerts[1].alertType, 'shop_inventory_empty');
    assert.equal(alerts[1].severity, 'critical');
    assert.equal(alerts[1].payload.recent_sales_count, 5);
});

test('runShopInventoryLowSweep enqueues key-product low stock alerts with stable dedupe', async () => {
    const state = {
        jobs: [],
        products: [
            {
                id: 'product-low',
                name: 'Prompt Pro 月卡',
                category: '提示词',
                stock_count: 3,
                is_active: true,
                delivery_type: 'KEY',
                updated_at: '2026-03-25T09:00:00.000Z'
            },
            {
                id: 'product-api',
                name: '接口自动发货',
                category: '接口',
                stock_count: 0,
                is_active: true,
                delivery_type: 'API',
                updated_at: '2026-03-25T09:00:00.000Z'
            }
        ],
        orders: [
            {
                id: 'order-1',
                product_id: 'product-low',
                item_count: 6,
                refund_status: 'none',
                created_at: '2026-03-24T09:00:00.000Z'
            }
        ]
    };
    const supabase = createSupabaseStub(state);
    const runtime = createOpsRuntime();

    const first = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-25T10:00:00.000Z'
    });

    assert.equal(first.low_stock_count, 1);
    assert.equal(first.empty_stock_count, 0);
    assert.equal(first.queued, 1);
    assert.equal(first.deduped, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.jobs[0].alert_type, 'shop_inventory_low');
    assert.equal(state.jobs[0].payload.recent_sales_count, 6);
    assert.equal(state.jobs[0].payload.product_name, 'Prompt Pro 月卡');

    const second = await runShopInventoryLowSweep(supabase, {
        runtime,
        now: '2026-03-25T10:05:00.000Z'
    });

    assert.equal(second.low_stock_count, 1);
    assert.equal(second.queued, 0);
    assert.equal(second.deduped, 1);
    assert.equal(state.jobs.length, 1);
});
