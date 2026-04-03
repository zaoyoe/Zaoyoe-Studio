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

async function withHomepageConfigHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/homepage/config.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        selectFilters: [],
        updateFilters: [],
        updatePayload: null,
        rows: options.rows || [],
        updateRow: options.updateRow || null
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: {
                            from(table) {
                                if (table !== 'homepage_config') {
                                    throw new Error(`Unexpected table: ${table}`);
                                }

                                const selectQuery = {
                                    select() {
                                        return this;
                                    },
                                    eq(field, value) {
                                        state.selectFilters.push({ field, value });
                                        return this;
                                    },
                                    order() {
                                        return this;
                                    },
                                    then(onFulfilled, onRejected) {
                                        return Promise.resolve({
                                            data: state.rows,
                                            error: null
                                        }).then(onFulfilled, onRejected);
                                    }
                                };

                                return {
                                    select() {
                                        return selectQuery;
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
                                                return {
                                                    data: state.updateRow,
                                                    error: state.updateRow ? null : { code: 'PGRST116', message: 'not found' }
                                                };
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
                normalizeAdminSite: adminLib.normalizeAdminSite,
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
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

test('homepage config handler loads current site rows via admin api', async () => {
    await withHomepageConfigHandler({
        rows: [
            { id: 'hero_cn', site: 'cn', section: 'hero', is_visible: true, display_order: 1, content: {} }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {},
            adminSite: 'cn'
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().site, 'cn');
        assert.deepEqual(state.selectFilters, [{ field: 'site', value: 'cn' }]);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'homepage.manage' });
    });
});

test('homepage config handler supports all-site aggregate reads without forcing cn fallback', async () => {
    await withHomepageConfigHandler({
        rows: [
            { id: 'hero_cn', site: 'cn', section: 'hero', is_visible: true, display_order: 1, content: {} },
            { id: 'hero_intl', site: 'intl', section: 'hero', is_visible: false, display_order: 1, content: {} }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {},
            adminSite: 'all'
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().site, 'all');
        assert.equal(res.json().read_only, true);
        assert.equal(res.json().mode, 'aggregate');
        assert.deepEqual(state.selectFilters, []);
        assert.equal(Array.isArray(res.json().rows), true);
        assert.equal(res.json().rows.length, 2);
    });
});

test('homepage config handler rejects all-site writes', async () => {
    await withHomepageConfigHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                id: 'hero_cn',
                section: 'hero',
                site: 'all',
                is_visible: true
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.equal(state.updatePayload, null);
    });
});

test('homepage config handler updates section rows with explicit site and id filters', async () => {
    await withHomepageConfigHandler({
        updateRow: {
            id: 'hero_intl',
            site: 'intl',
            section: 'hero',
            is_visible: false,
            display_order: 3,
            updated_at: '2026-03-31T12:00:00.000Z',
            content: { title: 'Hello' }
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                id: 'hero_intl',
                section: 'hero',
                site: 'intl',
                is_visible: false,
                display_order: 3,
                content: { title: 'Hello' }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.updatePayload, {
            content: { title: 'Hello' },
            is_visible: false,
            display_order: 3
        });
        assert.deepEqual(state.updateFilters, [
            { field: 'id', value: 'hero_intl' },
            { field: 'site', value: 'intl' },
            { field: 'section', value: 'hero' }
        ]);
    });
});
