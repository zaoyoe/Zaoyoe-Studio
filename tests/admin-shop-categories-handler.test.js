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

async function withShopCategoriesHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/categories.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        fromCalls: [],
        result: {
            data: [{ id: 'cat_1', name: 'account' }],
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
                            from(table) {
                                return {
                                    select(columns) {
                                        state.fromCalls.push({ table, method: 'select', args: [columns] });
                                        return this;
                                    },
                                    order(column, options) {
                                        state.fromCalls.push({ table, method: 'order', args: [column, options] });
                                        return Promise.resolve(state.result);
                                    }
                                };
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

test('shop categories handler lists categories ordered by sort_order', async () => {
    await withShopCategoriesHandler({}, async ({ handler, state }) => {
        const req = { method: 'GET', headers: {}, url: '/api/admin/shop/categories' };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.rows.length, 1);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
        assert.deepEqual(state.fromCalls, [
            { table: 'shop_categories', method: 'select', args: ['*'] },
            { table: 'shop_categories', method: 'order', args: ['sort_order', undefined] }
        ]);
    });
});

test('shop categories handler rejects non-GET methods', async () => {
    await withShopCategoriesHandler({}, async ({ handler }) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
