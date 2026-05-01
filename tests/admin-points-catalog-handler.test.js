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

async function withPointsCatalogHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/points/catalog.js');
    const sharedBasePath = path.resolve(__dirname, '../server/api-handlers/admin/points/_catalog-base.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        tableRequests: [],
        packageOrderFields: [],
        batchOrderFields: [],
        packageRows: options.packageRows || [],
        batchRows: options.batchRows || []
    };

    delete require.cache[handlerPath];
    delete require.cache[sharedBasePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: {
                            from(table) {
                                state.tableRequests.push(table);
                                if (table === 'points_packages') {
                                    return {
                                        select() {
                                            return this;
                                        },
                                        order(field) {
                                            state.packageOrderFields.push(field);
                                            return this;
                                        },
                                        then(resolve) {
                                            return Promise.resolve(resolve({
                                                data: state.packageRows,
                                                error: null
                                            }));
                                        }
                                    };
                                }

                                if (table === 'redemption_batches') {
                                    return {
                                        select() {
                                            return this;
                                        },
                                        order(field) {
                                            state.batchOrderFields.push(field);
                                            return this;
                                        },
                                        then(resolve) {
                                            return Promise.resolve(resolve({
                                                data: state.batchRows,
                                                error: null
                                            }));
                                        }
                                    };
                                }

                                throw new Error(`Unexpected table: ${table}`);
                            }
                        }
                    };
                },
                normalizeAdminSite: adminLib.normalizeAdminSite,
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
        delete require.cache[sharedBasePath];
    }
}

test('points catalog handler returns package catalog rows with cn/intl metrics and scoped summary', async () => {
    await withPointsCatalogHandler({
        packageRows: [
            {
                id: 'pkg-1',
                name: 'Starter',
                name_en: 'Starter',
                points_amount: 100,
                bonus_points: 20,
                price_cny: 1.99,
                is_active: true,
                sort_order: 1
            },
            {
                id: 'pkg-2',
                name: 'Legacy',
                name_en: 'Legacy',
                points_amount: 200,
                bonus_points: 0,
                price_cny: 4.99,
                is_active: false,
                sort_order: 2
            }
        ],
        batchRows: [
            { id: 'batch-cn-1', package_id: 'pkg-1', total_count: 10, used_count: 4, site: 'cn' },
            { id: 'batch-intl-1', package_id: 'pkg-1', total_count: 5, used_count: 1, site: 'intl' },
            { id: 'batch-custom-1', package_id: null, total_count: 3, used_count: 0, site: 'cn' }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/points/catalog?site=cn',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().siteContext, 'cn');
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'points.manage' });
        assert.deepEqual(state.packageOrderFields, ['sort_order', 'points_amount']);
        assert.deepEqual(res.json().summary, {
            package_count: 2,
            active_package_count: 1,
            batch_count: 2,
            generated_code_count: 13,
            used_code_count: 4,
            custom_batch_count: 1
        });
        assert.deepEqual(res.json().packages[0]?.metrics, {
            cn: { batch_count: 1, generated_count: 10, used_count: 4 },
            intl: { batch_count: 1, generated_count: 5, used_count: 1 },
            total: { batch_count: 2, generated_count: 15, used_count: 5 }
        });
        assert.equal(res.json().packages[0]?.total_points, 120);
    });
});

test('points catalog handler reuses the shared base rows inside the short warm cache', async () => {
    await withPointsCatalogHandler({
        packageRows: [
            {
                id: 'pkg-1',
                name: 'Starter',
                points_amount: 100,
                bonus_points: 20,
                is_active: true,
                sort_order: 1
            }
        ],
        batchRows: [
            { id: 'batch-cn-1', package_id: 'pkg-1', total_count: 10, used_count: 4, site: 'cn' }
        ]
    }, async ({ handler, state }) => {
        const firstRes = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin/points/catalog?site=cn',
            headers: {}
        }, firstRes);

        const secondRes = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin/points/catalog?site=cn',
            headers: {}
        }, secondRes);

        assert.equal(firstRes.statusCode, 200);
        assert.equal(secondRes.statusCode, 200);
        assert.equal(state.tableRequests.filter((table) => table === 'points_packages').length, 1);
        assert.equal(state.tableRequests.filter((table) => table === 'redemption_batches').length, 1);
        assert.deepEqual(state.packageOrderFields, ['sort_order', 'points_amount']);
        assert.deepEqual(state.batchOrderFields, ['created_at']);
    });
});
