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
        order: null,
        limit: null,
        payload: null,
        selectOptions: null,
        single: false
    };

    const builder = {
        select(_fields, options = {}) {
            state.mode = 'select';
            state.selectOptions = options;
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
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, value: Array.isArray(values) ? values : [] });
            return builder;
        },
        lt(column, value) {
            state.filters.push({ op: 'lt', column, value });
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
        if (op === 'lt') {
            return compareValue(row[column], value) < 0;
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

function createSupabaseStub(state) {
    state.inventoryRows = Array.isArray(state.inventoryRows) ? state.inventoryRows : [];
    state.productRows = Array.isArray(state.productRows) ? state.productRows : [];
    state.skuRows = Array.isArray(state.skuRows) ? state.skuRows : [];
    state.inventoryInsertSeq = state.inventoryInsertSeq || 1;

    return {
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'shop_inventory') {
                    if (query.mode === 'insert') {
                        const payloads = Array.isArray(query.payload) ? query.payload : [query.payload];
                        const inserted = payloads.map((row) => {
                            const insertedRow = {
                                id: row.id || `inventory_${state.inventoryInsertSeq++}`,
                                created_at: row.created_at || `2026-04-02T00:00:${String(state.inventoryInsertSeq).padStart(2, '0')}Z`,
                                buyer_id: row.buyer_id ?? null,
                                sold_at: row.sold_at ?? null,
                                remark: row.remark ?? null,
                                ...row
                            };
                            state.inventoryRows.push(insertedRow);
                            return insertedRow;
                        });
                        return { data: inserted, error: null };
                    }

                    if (query.mode === 'update') {
                        const rows = applyFilters(state.inventoryRows, query.filters);
                        rows.forEach((row) => {
                            Object.assign(row, query.payload);
                        });
                        return { data: rows, error: null };
                    }

                    const filteredRows = applyLimit(sortRows(applyFilters(state.inventoryRows, query.filters), query.order), query.limit);
                    if (query.selectOptions?.head) {
                        return {
                            data: null,
                            count: filteredRows.length,
                            error: null
                        };
                    }

                    if (query.single) {
                        return {
                            data: filteredRows[0] || null,
                            error: filteredRows.length ? null : { message: 'Not found' }
                        };
                    }

                    return { data: filteredRows, error: null };
                }

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
                        error: null
                    };
                }

                if (table === 'shop_product_skus') {
                    const filteredRows = applyLimit(sortRows(applyFilters(state.skuRows, query.filters), query.order), query.limit);
                    if (query.single) {
                        return {
                            data: filteredRows[0] || null,
                            error: filteredRows.length ? null : { message: 'Not found' }
                        };
                    }

                    return { data: filteredRows, error: null };
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

test('shop mutate handler imports inventory through shared admin mutation flow', async () => {
    await withShopMutateHandler({
        productRows: [{ id: 'prod_1', stock_count: 1 }],
        skuRows: [
            {
                id: 'sku_default_1',
                product_id: 'prod_1',
                sku_name: '默认规格',
                sku_code: 'default',
                is_default: true,
                is_active: true,
                stock_count: 1
            }
        ],
        inventoryRows: [
            {
                id: 'inventory_existing',
                product_id: 'prod_1',
                sku_id: 'sku_default_1',
                status: 'available',
                content: 'legacy-account',
                created_at: '2026-04-01T00:00:00Z'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'import_inventory',
                site: 'intl',
                productId: 'prod_1',
                lines: ['new-account-1', 'new-account-2'],
                importStatus: 'available',
                batchId: 'batch_20260402'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().imported, 2);
        assert.equal(res.json().stockCount, 3);
        assert.equal(state.inventoryRows.length, 3);
        assert.deepEqual(
            state.inventoryRows.slice(1).map((row) => ({
                product_id: row.product_id,
                sku_id: row.sku_id,
                status: row.status,
                batch_id: row.batch_id,
                content: row.content
            })),
            [
                { product_id: 'prod_1', sku_id: 'sku_default_1', status: 'available', batch_id: 'batch_20260402', content: 'new-account-1' },
                { product_id: 'prod_1', sku_id: 'sku_default_1', status: 'available', batch_id: 'batch_20260402', content: 'new-account-2' }
            ]
        );
        assert.equal(res.json().skuId, 'sku_default_1');
        assert.equal(res.json().skuStockCount, 3);
        assert.equal(state.productRows[0].stock_count, 3);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].site, 'intl');
        assert.equal(state.auditCalls[0].actionType, 'shop.inventory.import');
        assert.equal(state.auditCalls[0].details.count, 2);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
    });
});

test('shop mutate handler imports inventory into the requested product sku', async () => {
    await withShopMutateHandler({
        productRows: [{ id: 'prod_1', stock_count: 0 }],
        skuRows: [
            {
                id: 'sku_default_1',
                product_id: 'prod_1',
                sku_name: '默认规格',
                is_default: true,
                is_active: true,
                stock_count: 0
            },
            {
                id: 'sku_year_1',
                product_id: 'prod_1',
                sku_name: '年卡',
                is_default: false,
                is_active: true,
                stock_count: 0
            }
        ],
        inventoryRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'import_inventory',
                site: 'cn',
                productId: 'prod_1',
                skuId: 'sku_year_1',
                lines: ['year-card-1'],
                importStatus: 'available',
                batchId: 'batch_year'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.skuId, 'sku_year_1');
        assert.equal(payload.skuStockCount, 1);
        assert.deepEqual(
            state.inventoryRows.map((row) => ({
                product_id: row.product_id,
                sku_id: row.sku_id,
                content: row.content
            })),
            [{ product_id: 'prod_1', sku_id: 'sku_year_1', content: 'year-card-1' }]
        );
        assert.equal(state.auditCalls[0]?.details?.sku_id, 'sku_year_1');
        assert.equal(state.auditCalls[0]?.details?.sku_name, '年卡');
    });
});

test('shop mutate handler rejects inventory import for a sku from another product', async () => {
    await withShopMutateHandler({
        productRows: [{ id: 'prod_1', stock_count: 0 }],
        skuRows: [
            {
                id: 'sku_other_1',
                product_id: 'prod_2',
                sku_name: '其他商品规格',
                is_default: false,
                is_active: true,
                stock_count: 0
            }
        ],
        inventoryRows: []
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'import_inventory',
                site: 'cn',
                productId: 'prod_1',
                skuId: 'sku_other_1',
                lines: ['wrong-sku-card']
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'shop_product_sku_not_found');
        assert.deepEqual(state.inventoryRows, []);
    });
});

test('shop mutate handler releases reserve inventory through shared admin mutation flow', async () => {
    await withShopMutateHandler({
        productRows: [{ id: 'prod_1', stock_count: 1 }],
        inventoryRows: [
            {
                id: 'reserve_1',
                product_id: 'prod_1',
                status: 'reserve',
                buyer_id: 'user_1',
                sold_at: '2026-03-29T09:00:00Z',
                remark: 'held for replay',
                created_at: '2026-03-29T08:00:00Z'
            },
            {
                id: 'reserve_2',
                product_id: 'prod_1',
                status: 'reserve',
                buyer_id: 'user_2',
                sold_at: '2026-03-30T09:00:00Z',
                remark: 'held for retry',
                created_at: '2026-03-30T08:00:00Z'
            },
            {
                id: 'reserve_3',
                product_id: 'prod_1',
                status: 'reserve',
                buyer_id: 'user_3',
                sold_at: '2026-04-03T09:00:00Z',
                remark: 'newer reserve',
                created_at: '2026-04-03T08:00:00Z'
            },
            {
                id: 'available_1',
                product_id: 'prod_1',
                status: 'available',
                buyer_id: null,
                sold_at: null,
                remark: null,
                created_at: '2026-03-28T08:00:00Z'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'inventory_release_reserve',
                site: 'cn',
                productId: 'prod_1',
                count: 5,
                beforeDate: '2026-04-02T23:59:59.000Z'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(res.json().released, 2);
        assert.equal(res.json().stockCount, 3);
        assert.match(res.json().message, /成功释放 2 条储备库存/);

        const releasedRows = state.inventoryRows.filter((row) => ['reserve_1', 'reserve_2'].includes(row.id));
        for (const row of releasedRows) {
            assert.equal(row.status, 'available');
            assert.equal(row.buyer_id, null);
            assert.equal(row.sold_at, null);
            assert.equal(row.remark, null);
        }
        assert.equal(state.inventoryRows.find((row) => row.id === 'reserve_3')?.status, 'reserve');
        assert.equal(state.productRows[0].stock_count, 3);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].site, 'cn');
        assert.equal(state.auditCalls[0].actionType, 'shop.inventory.release_reserve');
        assert.equal(state.auditCalls[0].details.released_count, 2);
        assert.deepEqual(state.auditCalls[0].details.inventory_ids, ['reserve_1', 'reserve_2']);
    });
});
