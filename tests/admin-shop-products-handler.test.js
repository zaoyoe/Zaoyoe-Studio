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
        or(expression) {
            operations.push({ method: 'or', args: [expression] });
            return builder;
        },
        order(column, options) {
            operations.push({ method: 'order', args: [column, options] });
            return finalize('order');
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

async function withShopProductsHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/products.js');
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

test('shop products handler lists products with status/category filters', async () => {
    await withShopProductsHandler({
        queryResults: {
            shop_products: [
                {
                    data: [{ id: 'prod_1', name: 'Premium', is_active: true }],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/products?status=active&category=account&fields=full&order=display_order_desc'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.rows.length, 1);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
        assert.deepEqual(state.queryCalls[0], {
            table: 'shop_products',
            operations: [
                { method: 'select', args: ['*'] },
                { method: 'eq', args: ['is_active', true] },
                { method: 'eq', args: ['category', 'account'] },
                { method: 'order', args: ['display_order', { ascending: false }] }
            ],
            mode: 'order'
        });
    });
});

test('shop products handler loads a single product by id', async () => {
    await withShopProductsHandler({
        queryResults: {
            shop_products: [
                {
                    data: { id: 'prod_2', name: 'VIP Account' },
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/products?id=prod_2'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.product?.id, 'prod_2');
        assert.deepEqual(state.queryCalls[0], {
            table: 'shop_products',
            operations: [
                { method: 'select', args: ['*'] },
                { method: 'eq', args: ['id', 'prod_2'] },
                { method: 'single', args: [] }
            ],
            mode: 'single'
        });
    });
});

test('shop products handler rejects non-GET methods', async () => {
    await withShopProductsHandler({}, async ({ handler }) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});

test('shop products handler supports query and delivery filters for运营检索', async () => {
    await withShopProductsHandler({
        queryResults: {
            shop_products: [
                {
                    data: [{ id: 'prod_api_1', name: 'API Gift', delivery_type: 'API', is_active: true }],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/products?status=active&deliveryType=api&query=Gift&fields=full'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.rows.length, 1);
        assert.deepEqual(state.queryCalls[0], {
            table: 'shop_products',
            operations: [
                { method: 'select', args: ['*'] },
                { method: 'eq', args: ['is_active', true] },
                { method: 'eq', args: ['delivery_type', 'API'] },
                { method: 'or', args: ['id.ilike.%Gift%,name.ilike.%Gift%,category.ilike.%Gift%,delivery_type.ilike.%Gift%'] },
                { method: 'order', args: ['display_order', { ascending: false }] }
            ],
            mode: 'order'
        });
    });
});
