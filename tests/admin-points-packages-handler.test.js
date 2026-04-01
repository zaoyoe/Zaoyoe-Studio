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

async function withPointsPackagesHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/points/packages.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        orderFields: [],
        selectFilters: [],
        updateFilters: [],
        deleteFilters: [],
        insertPayload: null,
        updatePayload: null,
        auditEntries: [],
        rows: options.rows || []
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        user: { id: 'admin-1' },
                        supabase: {
                            from(table) {
                                if (table !== 'points_packages') {
                                    throw new Error(`Unexpected table: ${table}`);
                                }

                                return {
                                    select() {
                                        return this;
                                    },
                                    order(field) {
                                        state.orderFields.push(field);
                                        return this;
                                    },
                                    then(resolve) {
                                        return Promise.resolve(resolve({
                                            data: state.rows,
                                            error: null
                                        }));
                                    },
                                    eq(field, value) {
                                        state.selectFilters.push({ field, value });
                                        return {
                                            select() {
                                                return this;
                                            },
                                            async single() {
                                                const row = state.rows.find((item) => String(item?.[field] || '') === String(value || ''));
                                                if (!row) {
                                                    return {
                                                        data: null,
                                                        error: { code: 'PGRST116', message: 'not found' }
                                                    };
                                                }
                                                return {
                                                    data: row,
                                                    error: null
                                                };
                                            }
                                        };
                                    },
                                    insert(payload) {
                                        state.insertPayload = payload;
                                        return {
                                            select() {
                                                return this;
                                            },
                                            async single() {
                                                return {
                                                    data: {
                                                        id: 'pkg-new',
                                                        created_at: '2026-04-01T10:00:00+08:00',
                                                        ...payload
                                                    },
                                                    error: null
                                                };
                                            }
                                        };
                                    },
                                    update(payload) {
                                        state.updatePayload = payload;
                                        return {
                                            eq(field, value) {
                                                state.updateFilters.push({ field, value });
                                                return this;
                                            },
                                            select() {
                                                return this;
                                            },
                                            async single() {
                                                const existing = state.rows.find((item) => String(item?.id || '') === String(state.updateFilters.at(-1)?.value || ''));
                                                return {
                                                    data: existing ? { ...existing, ...payload } : null,
                                                    error: existing ? null : { code: 'PGRST116', message: 'not found' }
                                                };
                                            }
                                        };
                                    },
                                    delete() {
                                        return {
                                            eq(field, value) {
                                                state.deleteFilters.push({ field, value });
                                                return Promise.resolve({ error: null });
                                            }
                                        };
                                    }
                                };
                            }
                        }
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
                    state.auditEntries.push(entry);
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

test('points packages handler lists rows through the shared package source', async () => {
    await withPointsPackagesHandler({
        rows: [
            { id: 'pkg-1', name: 'Starter', sort_order: 1, points_amount: 100 },
            { id: 'pkg-2', name: 'Value', sort_order: 2, points_amount: 500 }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.requireAdminCalls[0]?.config, {
            anyOf: ['points.manage', 'settings.manage']
        });
        assert.deepEqual(state.orderFields, ['sort_order', 'points_amount']);
        assert.equal(res.json().rows.length, 2);
    });
});

test('points packages handler creates rows from legacy settings payload fields', async () => {
    await withPointsPackagesHandler({
        rows: [
            { id: 'pkg-1', name: 'Starter', sort_order: 1, points_amount: 100 },
            { id: 'pkg-2', name: 'Value', sort_order: 2, points_amount: 500 }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'create',
                site: 'cn',
                name: '  新礼包  ',
                name_en: '  New Pack  ',
                points: 120,
                bonus: 30,
                price: '9.95',
                enabled: 'false'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.insertPayload, {
            name: '新礼包',
            name_en: 'New Pack',
            points_amount: 120,
            bonus_points: 30,
            price_cny: 9.95,
            is_active: false,
            sort_order: 3
        });
        assert.equal(state.auditEntries[0]?.actionType, 'package.create');
        assert.equal(state.auditEntries[0]?.details?.package_name, '新礼包');
        assert.equal(state.auditEntries[0]?.site, 'cn');
    });
});

test('points packages handler updates and deletes rows with audit trail', async () => {
    await withPointsPackagesHandler({
        rows: [
            {
                id: 'pkg-1',
                name: 'Starter',
                name_en: 'Starter',
                points_amount: 100,
                bonus_points: 20,
                price_cny: 1.99,
                is_active: true,
                sort_order: 1
            }
        ]
    }, async ({ handler, state }) => {
        const updateRes = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                id: 'pkg-1',
                site: 'intl',
                enabled: false,
                price: ''
            }
        }, updateRes);

        assert.equal(updateRes.statusCode, 200);
        assert.deepEqual(state.updatePayload, {
            price_cny: null,
            is_active: false
        });
        assert.deepEqual(state.updateFilters, [{ field: 'id', value: 'pkg-1' }]);
        assert.equal(state.auditEntries[0]?.actionType, 'package.update');
        assert.equal(state.auditEntries[0]?.site, 'intl');

        const deleteRes = createMockResponse();
        await handler({
            method: 'DELETE',
            headers: {},
            body: {
                id: 'pkg-1',
                site: 'intl'
            }
        }, deleteRes);

        assert.equal(deleteRes.statusCode, 200);
        assert.deepEqual(state.deleteFilters, [{ field: 'id', value: 'pkg-1' }]);
        assert.equal(state.auditEntries[1]?.actionType, 'package.delete');
        assert.equal(state.auditEntries[1]?.details?.package_id, 'pkg-1');
        assert.equal(state.auditEntries[1]?.site, 'intl');
    });
});

test('points packages handler rejects all-site writes', async () => {
    await withPointsPackagesHandler({
        rows: [
            { id: 'pkg-1', name: 'Starter', sort_order: 1, points_amount: 100 }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'update',
                id: 'pkg-1',
                site: 'all',
                name: 'Bad Update'
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.equal(state.updatePayload, null);
    });
});
