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

function createCountQueryBuilder(state, table) {
    const queryState = {
        table,
        filters: []
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            queryState.filters.push([column, value]);
            return builder;
        },
        then(resolve, reject) {
            state.tableReads.push({
                table,
                filters: queryState.filters.map(([column, value]) => [column, value])
            });

            if (table === 'shop_inventory') {
                const productId = queryState.filters.find(([column]) => column === 'product_id')?.[1];
                const status = queryState.filters.find(([column]) => column === 'status')?.[1];
                const availableRows = (state.inventoryRows || []).filter((row) => (
                    String(row.product_id || '') === String(productId || '')
                    && String(row.status || '') === String(status || '')
                ));

                return Promise.resolve({
                    count: availableRows.length,
                    data: null,
                    error: null
                }).then(resolve, reject);
            }

            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
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
                    id: 'prod_saved',
                    name: state.insertPayload?.name || state.upsertPayload?.name || 'Saved Product',
                    category: state.insertPayload?.category || state.upsertPayload?.category || 'cards',
                    is_active: true
                }],
                error: null
            });
        }
    };
}

async function withShopMutateHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/mutate.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        auditCalls: [],
        tableReads: [],
        inventoryRows: [],
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
                                if (table === 'shop_products') {
                                    return createShopProductsTableMock(state);
                                }

                                if (table === 'shop_inventory') {
                                    return createCountQueryBuilder(state, table);
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

test('shop mutate validation blocks API products without webhook target', async () => {
    await withShopMutateHandler({}, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'validate_product',
                site: 'cn',
                payload: {
                    name: 'Webhook Goods',
                    category: 'api',
                    delivery_type: 'API',
                    is_active: true
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.validation.blockingIssues.length, 1);
        assert.match(payload.validation.blockingIssues[0].message, /Webhook URL/i);
    });
});

test('shop mutate validation warns when active KEY product has no available inventory', async () => {
    await withShopMutateHandler({
        inventoryRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'validate_product',
                site: 'intl',
                productId: 'prod_key_1',
                payload: {
                    name: 'Key Goods',
                    category: 'keys',
                    delivery_type: 'KEY',
                    is_active: true
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.validation.warnings.length >= 1, true);
        assert.equal(
            payload.validation.warnings.some((issue) => /可用库存为 0/i.test(String(issue?.message || ''))),
            true
        );
        assert.equal(
            state.tableReads.some((entry) => entry.table === 'shop_inventory'),
            true,
            'validation should inspect inventory health for existing KEY products'
        );
    });
});

test('shop mutate upsert blocks invalid API product payload before writing', async () => {
    await withShopMutateHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'cn',
                payload: {
                    name: 'Broken API Goods',
                    category: 'api',
                    delivery_type: 'API',
                    webhook_target: '',
                    is_active: true
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.match(payload.message, /Webhook URL/i);
        assert.equal(state.insertPayload, undefined);
        assert.equal(state.upsertPayload, undefined);
        assert.equal(state.auditCalls.length, 0);
    });
});
