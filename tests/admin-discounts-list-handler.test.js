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

function createQueryBuilder(executor) {
    const state = {
        order: null
    };

    const builder = {
        select() {
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
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

function cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
}

function createSupabaseStub(state) {
    state.discountRows = Array.isArray(state.discountRows) ? state.discountRows : [];

    return {
        from(table) {
            if (table !== 'discount_codes') {
                throw new Error(`Unexpected table request: ${table}`);
            }

            return createQueryBuilder((query) => {
                const rows = state.discountRows.slice().map((row) => cloneRow(row));
                if (query.order?.column) {
                    const { column, ascending } = query.order;
                    rows.sort((left, right) => {
                        const leftValue = Date.parse(left[column] || '') || 0;
                        const rightValue = Date.parse(right[column] || '') || 0;
                        return ascending ? leftValue - rightValue : rightValue - leftValue;
                    });
                }

                return {
                    data: rows,
                    error: null
                };
            });
        }
    };
}

async function withDiscountsListHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/discounts/list.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite: adminLib.normalizeAdminSite,
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: createSupabaseStub(state),
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

test('discounts list handler returns site-specific and global discount codes in site view', async () => {
    await withDiscountsListHandler({
        discountRows: [
            {
                id: 'discount_cn',
                code: 'CNSITE',
                applicable_site: 'cn',
                created_at: '2026-04-03T10:00:00.000Z'
            },
            {
                id: 'discount_global',
                code: 'ALLSITE',
                applicable_site: null,
                created_at: '2026-04-03T09:00:00.000Z'
            },
            {
                id: 'discount_intl',
                code: 'INTLSITE',
                applicable_site: 'intl',
                created_at: '2026-04-03T08:00:00.000Z'
            }
        ]
    }, async ({ handler, state }) => {
        const req = {
            method: 'GET',
            headers: {},
            adminSite: 'cn'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.deepEqual(payload.rows.map((row) => row.id), ['discount_cn', 'discount_global']);
        assert.deepEqual(payload.scope_summary, {
            mode: 'site_plus_global',
            site: 'cn',
            other_site: 'intl',
            visible_count: 2,
            global_count: 1,
            site_specific_count: 1,
            other_site_count: 1
        });
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'discounts.manage' });
    });
});

test('discounts list handler keeps aggregate counts in all-site view', async () => {
    await withDiscountsListHandler({
        discountRows: [
            {
                id: 'discount_cn',
                code: 'CNSITE',
                applicable_site: 'cn',
                created_at: '2026-04-03T10:00:00.000Z'
            },
            {
                id: 'discount_global',
                code: 'ALLSITE',
                applicable_site: null,
                created_at: '2026-04-03T09:00:00.000Z'
            },
            {
                id: 'discount_intl',
                code: 'INTLSITE',
                applicable_site: 'intl',
                created_at: '2026-04-03T08:00:00.000Z'
            }
        ]
    }, async ({ handler }) => {
        const req = {
            method: 'GET',
            headers: {},
            url: '/api/admin/discounts/list?site=all'
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'all');
        assert.deepEqual(payload.rows.map((row) => row.id), ['discount_cn', 'discount_global', 'discount_intl']);
        assert.deepEqual(payload.scope_summary, {
            mode: 'aggregate',
            visible_count: 3,
            global_count: 1,
            cn_count: 1,
            intl_count: 1
        });
    });
});

test('discounts list handler rejects non-GET methods', async () => {
    await withDiscountsListHandler({}, async ({ handler }) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
