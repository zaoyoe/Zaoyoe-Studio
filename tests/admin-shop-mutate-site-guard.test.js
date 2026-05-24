const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const adminLib = require('../api/_lib/admin');

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

function createShopProductsTableMock(state) {
    return {
        insert(payload) {
            state.insertPayload = payload;
            return this;
        },
        upsert(payload) {
            state.upsertPayload = payload;
            return this;
        },
        select() {
            return this;
        },
        limit() {
            return Promise.resolve({
                data: [{
                    id: 'prod_1',
                    name: state.insertPayload?.name || state.upsertPayload?.name || 'Demo Product',
                    category: state.insertPayload?.category || state.upsertPayload?.category || 'cards',
                    is_active: true
                }],
                error: null
            });
        }
    };
}

function createGenericTableMock(state, table) {
    return {
        select() {
            return this;
        },
        eq() {
            return this;
        },
        insert(payload) {
            state.tableInserts.push({ table, payload });
            return this;
        },
        update(payload) {
            state.tableUpdates.push({ table, payload });
            return this;
        },
        limit() {
            if (table === 'shop_product_skus') {
                const lastInsert = state.tableInserts.findLast((entry) => entry.table === table)?.payload || {};
                return Promise.resolve({
                    data: lastInsert.product_id
                        ? [{ id: 'sku_1', stock_count: 0, ...lastInsert }]
                        : [],
                    error: null
                });
            }

            return Promise.resolve({ data: [], error: null });
        },
        then(resolve, reject) {
            return this.limit().then(resolve, reject);
        },
        catch(reject) {
            return this.then(undefined, reject);
        }
    };
}

async function withShopMutateHandler(callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/mutate.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        auditCalls: [],
        fromCalls: [],
        tableInserts: [],
        tableUpdates: []
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
                                state.fromCalls.push(table);
                                if (table === 'shop_products') {
                                    return createShopProductsTableMock(state);
                                }

                                if (table === 'shop_product_skus') {
                                    return createGenericTableMock(state, table);
                                }

                                throw new Error(`Unexpected table mock request: ${table}`);
                            }
                        },
                        user: { id: 'admin_1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditCalls.push(entry);
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

test('shop mutate handler rejects all-site writes before touching Supabase', async () => {
    await withShopMutateHandler(async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'all',
                payload: { name: 'Blocked Product', category: 'cards' }
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.json().success, false);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.deepEqual(state.fromCalls, []);
        assert.equal(state.auditCalls.length, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('shop mutate handler accepts writable site and writes audit context', async () => {
    await withShopMutateHandler(async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'intl',
                payload: {
                    name: 'International Product',
                    category: 'cards',
                    is_active: true
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.fromCalls, ['shop_products', 'shop_product_skus', 'shop_product_skus', 'shop_product_skus']);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].site, 'intl');
        assert.equal(state.auditCalls[0].module, 'shop');
        assert.equal(state.auditCalls[0].actionType, 'shop.product.create');
    });
});
