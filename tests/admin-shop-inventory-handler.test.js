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

async function withShopInventoryHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/inventory.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        rpcCalls: [],
        tableReads: [],
        rpcResult: {
            data: {
                success: true,
                items: [],
                total: 0,
                stats: {}
            },
            error: null
        },
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
                            async rpc(name, params) {
                                state.rpcCalls.push({ name, params });
                                return state.rpcResult;
                            },
                            from(table) {
                                const tableQueue = Array.isArray(state.tableResults?.[table])
                                    ? state.tableResults[table]
                                    : null;
                                return {
                                    select(columns) {
                                        state.tableReads.push({ table, method: 'select', args: [columns] });
                                        return this;
                                    },
                                    in(column, values) {
                                        state.tableReads.push({ table, method: 'in', args: [column, values] });
                                        return this;
                                    },
                                    is(column, value) {
                                        state.tableReads.push({ table, method: 'is', args: [column, value] });
                                        return this;
                                    },
                                    order(column, options) {
                                        state.tableReads.push({ table, method: 'order', args: [column, options] });
                                        const nextResult = tableQueue?.length
                                            ? tableQueue.shift()
                                            : (state.orderLookupResult || { data: [], error: null });
                                        return Promise.resolve(nextResult);
                                    }
                                };
                            }
                        },
                        user: { id: 'admin_1' }
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

test('shop inventory handler forwards filters to fn_admin_list_inventory through admin auth', async () => {
    await withShopInventoryHandler({
        rpcResult: {
            data: {
                success: true,
                items: [{ id: 'inv_1', status: 'available' }],
                total: 12,
                stats: {
                    reserve: 2,
                    available: 5,
                    sold: 3,
                    frozen: 1,
                    fault: 1
                }
            },
            error: null
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/inventory?page=2&pageSize=25&productId=prod_1&status=available&search=batch-2026&dateFrom=2026-04-01T00:00:00.000Z&dateTo=2026-04-03T23:59:59.000Z'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.total, 12);
        assert.equal(payload.items.length, 1);
        assert.deepEqual(payload.stats, {
            reserve: 2,
            available: 5,
            sold: 3,
            frozen: 1,
            fault: 1
        });
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
        assert.deepEqual(state.rpcCalls[0], {
            name: 'fn_admin_list_inventory',
            params: {
                p_product_id: 'prod_1',
                p_status: 'available',
                p_search: 'batch-2026',
                p_page: 2,
                p_page_size: 25,
                p_date_from: '2026-04-01T00:00:00.000Z',
                p_date_to: '2026-04-03T23:59:59.000Z',
                p_sku_id: null
            }
        });
    });
});

test('shop inventory handler forwards product sku filters to fn_admin_list_inventory', async () => {
    await withShopInventoryHandler({}, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/inventory?productId=prod_1&skuId=sku_1'
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.rpcCalls[0]?.params?.p_product_id, 'prod_1');
        assert.equal(state.rpcCalls[0]?.params?.p_sku_id, 'sku_1');
    });
});

test('shop inventory handler rejects non-GET methods', async () => {
    await withShopInventoryHandler({}, async ({ handler }) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('shop inventory handler surfaces rpc business failures', async () => {
    await withShopInventoryHandler({
        rpcResult: {
            data: {
                success: false,
                message: 'Access denied'
            },
            error: null
        }
    }, async ({ handler }) => {
        const req = { method: 'GET', headers: {}, url: '/api/admin/shop/inventory' };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Access denied');
    });
});

test('shop inventory handler can resolve missing order ids through server-side order hints', async () => {
    await withShopInventoryHandler({
        rpcResult: {
            data: {
                success: true,
                items: [
                    { id: 'inv_1', status: 'sold', buyer_id: 'user_1', product_id: 'prod_1', order_id: null },
                    { id: 'inv_2', status: 'available', buyer_id: null, product_id: 'prod_2', order_id: null }
                ],
                total: 2,
                stats: {}
            },
            error: null
        },
        tableResults: {
            shop_orders: [{ data: [], error: null }],
            shop_order_items: [{
                data: [
                    { order_id: 'ord_1', inventory_id: 'inv_1', created_at: '2026-04-03T08:00:00.000Z' }
                ],
                error: null
            }]
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/inventory?includeOrderHints=true'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.items[0]?.order_id, 'ord_1');
        assert.equal(payload.items[1]?.order_id, null);
        assert.equal(
            state.tableReads.some((entry) => entry.table === 'shop_order_items' && entry.method === 'select'),
            true,
            'handler should resolve orphan order ids through exact order-item linkage'
        );
    });
});
