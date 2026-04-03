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
        mode: 'select',
        filters: [],
        payload: null,
        single: false,
        selectFields: '*'
    };

    const builder = {
        select(fields = '*') {
            state.selectFields = fields;
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        delete() {
            state.mode = 'delete';
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        single() {
            state.single = true;
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

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') {
            return row[column] === value;
        }
        return true;
    }));
}

function cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
}

function createSupabaseStub(state) {
    state.discountRows = Array.isArray(state.discountRows) ? state.discountRows : [];
    state.insertSeq = state.insertSeq || 1;
    state.fromCalls = Array.isArray(state.fromCalls) ? state.fromCalls : [];

    return {
        from(table) {
            state.fromCalls.push(table);

            return createQueryBuilder(async (query) => {
                if (table !== 'discount_codes') {
                    throw new Error(`Unexpected table mock request: ${table}`);
                }

                if (query.mode === 'insert') {
                    const duplicate = state.discountRows.find((row) => row.code === query.payload?.code);
                    if (duplicate) {
                        return {
                            data: null,
                            error: { code: '23505', message: 'duplicate key value violates unique constraint' }
                        };
                    }

                    const insertedRow = {
                        id: query.payload.id || `discount_${state.insertSeq++}`,
                        created_at: query.payload.created_at || '2026-04-02T00:00:00.000Z',
                        used_count: 0,
                        ...cloneRow(query.payload)
                    };
                    state.discountRows.unshift(insertedRow);
                    return {
                        data: query.single ? insertedRow : [insertedRow],
                        error: null
                    };
                }

                if (query.mode === 'update') {
                    const rows = applyFilters(state.discountRows, query.filters);
                    rows.forEach((row) => {
                        Object.assign(row, cloneRow(query.payload));
                    });
                    const first = rows[0] || null;
                    return {
                        data: query.single ? first : rows,
                        error: first ? null : { message: 'Not found' }
                    };
                }

                if (query.mode === 'delete') {
                    const rows = applyFilters(state.discountRows, query.filters);
                    const idsToDelete = new Set(rows.map((row) => row.id));
                    state.discountRows = state.discountRows.filter((row) => !idsToDelete.has(row.id));
                    return {
                        data: null,
                        error: null
                    };
                }

                const rows = applyFilters(state.discountRows, query.filters).map((row) => cloneRow(row));
                const first = rows[0] || null;
                return {
                    data: query.single ? first : rows,
                    error: first ? null : { message: 'Not found', status: 406 }
                };
            });
        }
    };
}

async function withDiscountsMutateHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/discounts/mutate.js');
    const originalLoad = Module._load;
    const state = {
        auditCalls: [],
        requireAdminCalls: [],
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite: adminLib.normalizeAdminSite,
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: createSupabaseStub(state),
                        user: { id: 'admin_1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
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

test('discounts mutate handler rejects all-site writes before touching Supabase', async () => {
    await withDiscountsMutateHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'create',
                site: 'all',
                payload: {
                    code: 'FLASH0',
                    discount_type: 'percent',
                    discount_value: 80,
                    max_uses: 0,
                    max_uses_per_user: 0
                }
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.json().success, false);
        assert.match(res.json().message, /Writable admin site must be cn or intl/i);
        assert.deepEqual(state.fromCalls, []);
        assert.equal(state.auditCalls.length, 0);
    });
});

test('discounts mutate handler creates discount codes and writes audit context', async () => {
    await withDiscountsMutateHandler({
        discountRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'create',
                site: 'cn',
                payload: {
                    code: 'flash0',
                    discount_type: 'percent',
                    discount_value: 80,
                    max_uses: 100,
                    max_uses_per_user: 1,
                    expires_at: '2026-05-01T00:00:00.000Z',
                    applicable_site: 'cn',
                    scope_type: 'product',
                    scope_product_id: 'prod_1',
                    allow_zero_total: true,
                    is_active: true
                }
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.discountRows.length, 1);
        assert.equal(state.discountRows[0].code, 'FLASH0');
        assert.equal(state.discountRows[0].scope_product_id, 'prod_1');
        assert.equal(state.discountRows[0].allow_zero_total, true);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].site, 'cn');
        assert.equal(state.auditCalls[0].module, 'discounts');
        assert.equal(state.auditCalls[0].actionType, 'discount.code.create');
        assert.equal(state.auditCalls[0].details.code, 'FLASH0');
    });
});

test('discounts mutate handler blocks cross-site discount toggles', async () => {
    await withDiscountsMutateHandler({
        discountRows: [
            {
                id: 'discount_intl',
                code: 'INTL50',
                is_active: true,
                applicable_site: 'intl',
                discount_type: 'percent',
                discount_value: 50,
                max_uses: 0,
                max_uses_per_user: 0,
                allow_zero_total: false,
                scope_type: 'all',
                scope_category: null,
                scope_product_id: null,
                expires_at: null
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'toggle_status',
                site: 'cn',
                id: 'discount_intl',
                isActive: false
            }
        }, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.json().success, false);
        assert.match(res.json().message, /INTL 站点/);
        assert.equal(state.discountRows[0].is_active, true);
        assert.equal(state.auditCalls.length, 0);
    });
});

test('discounts mutate handler deletes discount codes and writes audit context', async () => {
    await withDiscountsMutateHandler({
        discountRows: [
            {
                id: 'discount_cn',
                code: 'SPRING2026',
                is_active: false,
                applicable_site: 'cn',
                discount_type: 'fixed',
                discount_value: 30,
                max_uses: 10,
                max_uses_per_user: 1,
                allow_zero_total: false,
                scope_type: 'category',
                scope_category: 'cards',
                scope_product_id: null,
                expires_at: null
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'delete',
                site: 'cn',
                id: 'discount_cn'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.discountRows.length, 0);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'discount.code.delete');
        assert.equal(state.auditCalls[0].details.code, 'SPRING2026');
        assert.equal(state.auditCalls[0].site, 'cn');
    });
});
