const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
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

function createQueryBuilder(state, table) {
    const operations = [];

    function finalize(mode) {
        state.queryCalls.push({ table, operations: [...operations], mode });
        const queue = state.queryResults[table] || [];
        const nextResult = queue.length ? queue.shift() : { data: [], error: null };
        return Promise.resolve(nextResult);
    }

    const builder = {
        select(columns) {
            operations.push({ method: 'select', args: [columns] });
            return builder;
        },
        eq(column, value) {
            operations.push({ method: 'eq', args: [column, value] });
            return builder;
        },
        in(column, values) {
            operations.push({ method: 'in', args: [column, values] });
            return builder;
        },
        is(column, value) {
            operations.push({ method: 'is', args: [column, value] });
            return builder;
        },
        neq(column, value) {
            operations.push({ method: 'neq', args: [column, value] });
            return builder;
        },
        gte(column, value) {
            operations.push({ method: 'gte', args: [column, value] });
            return builder;
        },
        lte(column, value) {
            operations.push({ method: 'lte', args: [column, value] });
            return builder;
        },
        order(column, options) {
            operations.push({ method: 'order', args: [column, options] });
            return builder;
        },
        limit(value) {
            operations.push({ method: 'limit', args: [value] });
            return finalize('limit');
        },
        single() {
            operations.push({ method: 'single', args: [] });
            return finalize('single');
        },
        then(resolve, reject) {
            return finalize('then').then(resolve, reject);
        }
    };

    return builder;
}

async function withShopInventoryDetailHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/inventory-detail.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        queryCalls: [],
        queryResults: {},
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: {
                            from(table) {
                                return createQueryBuilder(state, table);
                            }
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
    }
}

test('shop inventory detail handler loads inventory, related order, and sibling inventory records', async () => {
    await withShopInventoryDetailHandler({
        queryResults: {
            shop_inventory: [
                {
                    data: {
                        id: 'inv_1',
                        product_id: 'prod_1',
                        buyer_id: 'user_1',
                        content: 'acc-1',
                        status: 'sold',
                        created_at: '2026-04-03T01:00:00.000Z',
                        sold_at: '2026-04-03T02:00:00.000Z',
                        shop_products: { name: 'Premium Account' }
                    },
                    error: null
                },
                {
                    data: [
                        { id: 'inv_0', content: 'old-1', sold_at: '2026-04-02T01:00:00.000Z' }
                    ],
                    error: null
                },
                {
                    data: [
                        { id: 'inv_2', content: 'bundle-1', sold_at: '2026-04-03T02:00:30.000Z' }
                    ],
                    error: null
                }
            ],
            shop_orders: [
                {
                    data: [],
                    error: null
                },
                {
                    data: [],
                    error: null
                },
                {
                    data: [
                        {
                            id: 'ord_1',
                            user_id: 'user_1',
                            created_at: '2026-04-03T02:00:00.000Z',
                            price_paid: 99
                        }
                    ],
                    error: null
                }
            ],
            shop_order_items: [
                {
                    data: [
                        {
                            order_id: 'ord_1',
                            inventory_id: 'inv_1',
                            created_at: '2026-04-03T02:00:00.000Z'
                        }
                    ],
                    error: null
                },
                {
                    data: [
                        {
                            inventory_id: 'inv_1'
                        },
                        {
                            inventory_id: 'inv_2'
                        }
                    ],
                    error: null
                }
            ],
            profiles: [
                {
                    data: [
                        {
                            email: 'buyer@example.com',
                            username: 'buyer_one'
                        }
                    ],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/inventory-detail?id=inv_1'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.inventory?.id, 'inv_1');
        assert.equal(payload.inventory?.shop_products?.name, 'Premium Account');
        assert.equal(payload.order?.id, 'ord_1');
        assert.equal(payload.order?.profiles?.email, 'buyer@example.com');
        assert.equal(payload.historyItems.length, 1);
        assert.equal(payload.sameOrderItems.length, 1);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
        assert.equal(
            state.queryCalls.some((entry) => entry.table === 'profiles'),
            true,
            'handler should load profile context for linked orders'
        );
    });
});

test('shop inventory detail handler rejects non-GET methods', async () => {
    await withShopInventoryDetailHandler({}, async ({ handler }) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('shop inventory detail handler validates missing inventory id', async () => {
    await withShopInventoryDetailHandler({}, async ({ handler }) => {
        const req = { method: 'GET', headers: {}, url: '/api/admin/shop/inventory-detail' };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Missing inventory id');
    });
});
