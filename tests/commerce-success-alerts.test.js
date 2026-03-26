const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeOpsAlertsConfig } = require('../api/_lib/ops-alerts');
const {
    buildShopPurchaseSucceededAlerts,
    buildWalletRechargeSucceededAlerts,
    runCommerceSuccessSweep
} = require('../api/_lib/commerce-success-alerts');

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
        if (op === 'in') return Array.isArray(value) && value.includes(row[column]);
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
    const shopOrders = state.shopOrders || [];
    const paymentOrders = state.paymentOrders || [];
    const profiles = state.profiles || [];
    const jobs = state.jobs || [];

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_orders' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(shopOrders, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'payment_orders' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(paymentOrders, query.filters), query.order), query.range),
                        error: null
                    };
                }

                if (table === 'profiles' && query.mode === 'select') {
                    return {
                        data: applyRange(sortRows(applyFilters(profiles, query.filters), query.order), query.range),
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

test('build success alerts render purchase and recharge details', () => {
    const profilesContext = {
        byId: new Map([
            ['user-001', { id: 'user-001', display_name: '小羽' }]
        ])
    };
    const purchaseAlerts = buildShopPurchaseSucceededAlerts([
        {
            id: 'shop-order-001',
            user_id: 'user-001',
            site: 'cn',
            snapshot_product_name: 'Prompt Pro 年卡',
            total_price: 59.8,
            price_paid: 59.8,
            item_count: 1,
            delivery_status: 'pending',
            refund_status: 'none',
            created_at: '2026-03-26T03:00:00.000Z'
        }
    ], profilesContext, {}, {
        now: new Date('2026-03-26T03:05:00.000Z')
    });
    const rechargeAlerts = buildWalletRechargeSucceededAlerts([
        {
            id: 'payment-order-001',
            user_id: 'user-001',
            provider: 'hupijiao',
            provider_order_no: 'HPJ001',
            site: 'cn',
            package_name: '30元充值',
            expected_amount: 30,
            paid_amount: 30,
            points_amount: 300,
            status: 'redeemed',
            paid_at: '2026-03-26T03:02:00.000Z',
            claimed_at: '2026-03-26T03:03:00.000Z',
            created_at: '2026-03-26T03:01:00.000Z'
        }
    ], profilesContext, {}, {
        now: new Date('2026-03-26T03:05:00.000Z')
    });

    assert.equal(purchaseAlerts.length, 1);
    assert.match(purchaseAlerts[0].content, /购买者：小羽/);
    assert.match(purchaseAlerts[0].content, /商品：Prompt Pro 年卡/);
    assert.equal(rechargeAlerts.length, 1);
    assert.match(rechargeAlerts[0].content, /付款者：小羽/);
    assert.match(rechargeAlerts[0].content, /到账积分：300 点/);
});

test('runCommerceSuccessSweep queues purchase and recharge success alerts', async () => {
    const state = {
        shopOrders: [
            {
                id: 'shop-order-100',
                user_id: 'user-100',
                site: 'cn',
                snapshot_product_name: '卡密月卡',
                total_price: 19.9,
                price_paid: 19.9,
                item_count: 1,
                delivery_status: 'pending',
                refund_status: 'none',
                created_at: '2026-03-26T04:00:00.000Z'
            }
        ],
        paymentOrders: [
            {
                id: 'payment-order-100',
                user_id: 'user-100',
                provider: 'afdian',
                provider_order_no: 'AF001',
                site: 'intl',
                package_name: '50元充值',
                expected_amount: 50,
                paid_amount: 50,
                points_amount: 500,
                status: 'redeemed',
                paid_at: '2026-03-26T04:01:00.000Z',
                claimed_at: '2026-03-26T04:02:00.000Z',
                created_at: '2026-03-26T03:59:00.000Z'
            }
        ],
        profiles: [
            {
                id: 'user-100',
                username: 'buyer100'
            }
        ],
        jobs: []
    };
    const supabase = createSupabaseStub(state);

    const result = await runCommerceSuccessSweep(supabase, {
        now: new Date('2026-03-26T04:05:00.000Z'),
        runtime: createOpsRuntime()
    });

    assert.equal(result.purchase_count, 1);
    assert.equal(result.recharge_count, 1);
    assert.equal(result.queued, 2);
    assert.equal(state.jobs.some((job) => job.alert_type === 'shop_purchase_succeeded'), true);
    assert.equal(state.jobs.some((job) => job.alert_type === 'wallet_recharge_succeeded'), true);
});
