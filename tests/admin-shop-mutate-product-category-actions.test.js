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

function compareValue(left, right) {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) {
        return leftDate - rightDate;
    }

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
    }

    return String(left || '').localeCompare(String(right || ''));
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') {
            return row[column] === value;
        }
        if (op === 'in') {
            return Array.isArray(value) && value.includes(row[column]);
        }
        return true;
    }));
}

function sortRows(rows, order) {
    if (!order?.column) {
        return rows.slice();
    }

    return rows.slice().sort((left, right) => (
        order.ascending
            ? compareValue(left[order.column], right[order.column])
            : compareValue(right[order.column], left[order.column])
    ));
}

function applyLimit(rows, limit) {
    if (!Number.isFinite(limit) || limit <= 0) {
        return rows;
    }

    return rows.slice(0, limit);
}

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        order: null,
        limit: null,
        payload: null,
        single: false
    };

    const builder = {
        select() {
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
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
            return builder;
        },
        limit(value) {
            state.limit = Number(value);
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

function createSupabaseStub(state) {
    state.productRows = Array.isArray(state.productRows) ? state.productRows : [];
    state.categoryRows = Array.isArray(state.categoryRows) ? state.categoryRows : [];
    state.categoryInsertSeq = state.categoryInsertSeq || 1;

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_products') {
                    if (query.mode === 'update') {
                        const rows = applyFilters(state.productRows, query.filters);
                        rows.forEach((row) => {
                            Object.assign(row, query.payload);
                        });
                        return { data: rows, error: null };
                    }

                    const filteredRows = applyLimit(sortRows(applyFilters(state.productRows, query.filters), query.order), query.limit);
                    return {
                        data: query.single ? (filteredRows[0] || null) : filteredRows,
                        error: query.single && !filteredRows.length ? { message: 'Not found' } : null
                    };
                }

                if (table === 'shop_categories') {
                    if (query.mode === 'insert') {
                        const payload = Array.isArray(query.payload) ? query.payload[0] : query.payload;
                        const insertedRow = {
                            id: payload.id || `cat_${state.categoryInsertSeq++}`,
                            ...payload
                        };
                        state.categoryRows.push(insertedRow);
                        const rows = [insertedRow];
                        return {
                            data: query.single ? rows[0] : rows,
                            error: null
                        };
                    }

                    if (query.mode === 'update') {
                        const rows = applyFilters(state.categoryRows, query.filters);
                        rows.forEach((row) => {
                            Object.assign(row, query.payload);
                        });
                        return {
                            data: query.single ? (rows[0] || null) : rows,
                            error: query.single && !rows.length ? { message: 'Not found' } : null
                        };
                    }

                    if (query.mode === 'delete') {
                        const rows = applyFilters(state.categoryRows, query.filters);
                        const deletedIds = new Set(rows.map((row) => row.id));
                        state.categoryRows = state.categoryRows.filter((row) => !deletedIds.has(row.id));
                        return { data: rows, error: null };
                    }

                    const filteredRows = applyLimit(sortRows(applyFilters(state.categoryRows, query.filters), query.order), query.limit);
                    return {
                        data: query.single ? (filteredRows[0] || null) : filteredRows,
                        error: query.single && !filteredRows.length ? { message: 'Not found' } : null
                    };
                }

                throw new Error(`Unexpected table mock request: ${table}`);
            });
        }
    };
}

async function withShopMutateHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/mutate.js');
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

test('shop mutate handler batch soft deletes products through shared admin mutation flow', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'A', is_active: true, category: 'cards' },
            { id: 'prod_2', name: 'B', is_active: true, category: 'cards' }
        ],
        categoryRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'batch_soft_delete_products',
                site: 'cn',
                productIds: ['prod_1', 'prod_2']
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().deleted, 2);
        assert.equal(state.productRows.every((row) => row.is_active === false), true);
        assert.equal(state.auditCalls[0]?.actionType, 'shop.product.batch_delete');
        assert.deepEqual(state.auditCalls[0]?.details.product_ids, ['prod_1', 'prod_2']);
    });
});

test('shop mutate handler creates categories with appended sort order', async () => {
    await withShopMutateHandler({
        productRows: [],
        categoryRows: [
            { id: 'cat_1', name: 'account', color: '#6b9ece', sort_order: 10 },
            { id: 'cat_2', name: 'other', color: '#9aa0a6', sort_order: 40 }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'create_category',
                site: 'intl',
                name: 'new-cat',
                color: '#123456'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().category.name, 'new-cat');
        assert.equal(res.json().category.sort_order, 50);
        assert.equal(state.categoryRows.length, 3);
        assert.equal(state.auditCalls[0]?.actionType, 'shop.category.create');
    });
});

test('shop mutate handler renames categories and updates linked products', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'A', is_active: true, category: 'old-cat' },
            { id: 'prod_2', name: 'B', is_active: true, category: 'other' }
        ],
        categoryRows: [
            { id: 'cat_1', name: 'old-cat', color: '#6b9ece', sort_order: 10 }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'rename_category',
                site: 'cn',
                categoryId: 'cat_1',
                name: 'new-cat'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.categoryRows[0].name, 'new-cat');
        assert.equal(state.productRows[0].category, 'new-cat');
        assert.equal(state.auditCalls[0]?.actionType, 'shop.category.rename');
        assert.equal(state.auditCalls[0]?.details.old_name, 'old-cat');
        assert.equal(state.auditCalls[0]?.details.new_name, 'new-cat');
    });
});

test('shop mutate handler deletes categories and restores products into fallback other', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'A', is_active: true, category: 'legacy' }
        ],
        categoryRows: [
            { id: 'cat_legacy', name: 'legacy', color: '#6b9ece', sort_order: 10 }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'delete_category',
                site: 'intl',
                categoryId: 'cat_legacy'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().fallbackCategory, 'other');
        assert.equal(state.productRows[0].category, 'other');
        assert.equal(state.categoryRows.some((row) => row.name === 'legacy'), false);
        assert.equal(state.categoryRows.some((row) => row.name === 'other'), true);
        assert.equal(state.auditCalls[0]?.actionType, 'shop.category.delete');
    });
});

test('shop mutate handler recolors categories and moves products across categories', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'A', is_active: true, category: 'old-cat' }
        ],
        categoryRows: [
            { id: 'cat_1', name: 'old-cat', color: '#6b9ece', sort_order: 10 }
        ]
    }, async ({ handler, state }) => {
        const recolorRes = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'set_category_color',
                site: 'cn',
                categoryId: 'cat_1',
                color: '#ff9800'
            }
        }, recolorRes);

        assert.equal(recolorRes.statusCode, 200);
        assert.equal(state.categoryRows[0].color, '#ff9800');
        assert.equal(state.auditCalls[0]?.actionType, 'shop.category.color');

        const moveRes = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'move_product_category',
                site: 'cn',
                productId: 'prod_1',
                targetCategory: 'other'
            }
        }, moveRes);

        assert.equal(moveRes.statusCode, 200);
        assert.equal(moveRes.json().success, true);
        assert.equal(state.productRows[0].category, 'other');
        assert.equal(state.auditCalls[1]?.actionType, 'shop.product.move_category');
    });
});

test('shop mutate handler reorders products within and across categories', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'A', is_active: true, category: 'cards', sort_order: 0 },
            { id: 'prod_2', name: 'B', is_active: true, category: 'cards', sort_order: 1 },
            { id: 'prod_3', name: 'C', is_active: true, category: 'keys', sort_order: 0 }
        ],
        categoryRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'reorder_products',
                site: 'cn',
                assignments: [
                    { id: 'prod_2', category: 'cards', sortOrder: 0 },
                    { id: 'prod_1', category: 'cards', sortOrder: 1 },
                    { id: 'prod_3', category: 'cards', sortOrder: 2 }
                ]
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().updated, 3);
        assert.deepEqual(
            state.productRows.map((row) => ({
                id: row.id,
                category: row.category,
                sort_order: row.sort_order
            })),
            [
                { id: 'prod_1', category: 'cards', sort_order: 1 },
                { id: 'prod_2', category: 'cards', sort_order: 0 },
                { id: 'prod_3', category: 'cards', sort_order: 2 }
            ]
        );
        assert.equal(state.auditCalls[0]?.actionType, 'shop.product.reorder');
        assert.deepEqual(state.auditCalls[0]?.details.product_ids, ['prod_2', 'prod_1', 'prod_3']);
    });
});

test('shop mutate handler reorders categories for storefront tabs', async () => {
    await withShopMutateHandler({
        productRows: [],
        categoryRows: [
            { id: 'cat_1', name: 'cards', color: '#6b9ece', sort_order: 10 },
            { id: 'cat_2', name: 'keys', color: '#f4b400', sort_order: 20 },
            { id: 'cat_3', name: 'tools', color: '#9aa0a6', sort_order: 30 }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'reorder_categories',
                site: 'cn',
                assignments: [
                    { id: 'cat_3', sortOrder: 10 },
                    { id: 'cat_1', sortOrder: 20 },
                    { id: 'cat_2', sortOrder: 30 }
                ]
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().updated, 3);
        assert.deepEqual(
            state.categoryRows.map((row) => ({
                id: row.id,
                sort_order: row.sort_order
            })),
            [
                { id: 'cat_1', sort_order: 20 },
                { id: 'cat_2', sort_order: 30 },
                { id: 'cat_3', sort_order: 10 }
            ]
        );
        assert.equal(state.auditCalls[0]?.actionType, 'shop.category.reorder');
        assert.deepEqual(state.auditCalls[0]?.details.category_ids, ['cat_3', 'cat_1', 'cat_2']);
    });
});
