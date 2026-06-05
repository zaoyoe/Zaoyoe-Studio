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
            state.insertPayloads.push(payload);
            return this;
        },
        upsert(payload) {
            state.upsertPayload = payload;
            state.upsertPayloads.push(payload);
            return this;
        },
        select() {
            return this;
        },
        limit() {
            if (Array.isArray(state.writeResults) && state.writeResults.length) {
                return Promise.resolve(state.writeResults.shift());
            }

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

function createGenericTableMock(state, table) {
    const queryState = {
        filters: []
    };

    return {
        select() {
            return this;
        },
        eq(column, value) {
            queryState.filters.push([column, value]);
            if (queryState.activeUpdateEntry) {
                queryState.activeUpdateEntry.filters.push([column, value]);
            }
            state.tableReads.push({ table, filters: queryState.filters.map(([filterColumn, filterValue]) => [filterColumn, filterValue]) });
            return this;
        },
        insert(payload) {
            state.insertPayloadsByTable[table] = state.insertPayloadsByTable[table] || [];
            state.insertPayloadsByTable[table].push(payload);
            return this;
        },
        upsert(payload) {
            state.upsertPayloadsByTable[table] = state.upsertPayloadsByTable[table] || [];
            state.upsertPayloadsByTable[table].push(payload);
            return this;
        },
        update(payload) {
            state.updatePayloadsByTable[table] = state.updatePayloadsByTable[table] || [];
            const entry = {
                payload,
                filters: queryState.filters.map(([column, value]) => [column, value])
            };
            state.updatePayloadsByTable[table].push(entry);
            queryState.activeUpdateEntry = entry;
            return this;
        },
        limit() {
            const queue = state.tableResults?.[table] || [];
            if (queue.length) {
                return Promise.resolve(queue.shift());
            }

            if (table === 'shop_product_skus') {
                const insertPayloads = state.insertPayloadsByTable[table] || [];
                const upsertPayloads = state.upsertPayloadsByTable[table] || [];
                const updatePayloads = state.updatePayloadsByTable[table] || [];
                const lastUpdate = updatePayloads.at(-1) || {};
                const lastPayload = insertPayloads.at(-1) || upsertPayloads.at(-1) || lastUpdate.payload || {};
                const updateId = lastUpdate.filters?.find(([column]) => column === 'id')?.[1] || '';
                return Promise.resolve({
                    data: lastPayload.product_id
                        ? [{
                            id: lastPayload.id || updateId || `sku_${insertPayloads.length + upsertPayloads.length || 1}`,
                            stock_count: 0,
                            ...lastPayload
                        }]
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

async function withShopMutateHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/mutate.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        auditCalls: [],
        tableReads: [],
        inventoryRows: [],
        insertPayloads: [],
        upsertPayloads: [],
        insertPayloadsByTable: {},
        upsertPayloadsByTable: {},
        updatePayloadsByTable: {},
        tableResults: {},
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

test('shop mutate validation accepts intl create payloads that only carry the English product name', async () => {
    await withShopMutateHandler({}, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'validate_product',
                site: 'intl',
                payload: {
                    name_en: 'Intl Card',
                    category: 'keys',
                    price_points_intl: 1,
                    delivery_type: 'KEY',
                    is_active: true
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(
            payload.validation.blockingIssues.some((issue) => issue.code === 'name_required'),
            false
        );
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

test('shop mutate validation treats manual-delivery products as view-only instead of low-stock KEY products', async () => {
    await withShopMutateHandler({
        inventoryRows: []
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'validate_product',
                site: 'cn',
                productId: 'prod_manual_1',
                payload: {
                    name: 'Manual Goods',
                    category: 'service',
                    delivery_type: 'KEY',
                    manual_delivery: true,
                    is_active: true
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(
            payload.validation.warnings.some((issue) => issue.code === 'key_stock_empty'),
            false
        );
    });
});

test('shop mutate upsert backfills base name from name_en for intl product creation only', async () => {
    await withShopMutateHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'intl',
                payload: {
                    name_en: 'Intl Card',
                    category: 'keys',
                    price_points_intl: 1,
                    delivery_type: 'KEY',
                    is_active: true
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.insertPayload.name, 'Intl Card');
        assert.equal(state.insertPayload.name_en, 'Intl Card');
        assert.equal(state.insertPayload.price_points, undefined);
        assert.equal(state.insertPayload.price_points_intl, 1);
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

test('shop mutate upsert retries with legacy guidance payload when bilingual columns are missing', async () => {
    await withShopMutateHandler({
        writeResults: [
            {
                data: null,
                error: {
                    message: "Could not find the 'purchase_notes_zh' column of 'shop_products' in the schema cache"
                }
            },
            {
                data: [{
                    id: 'prod_saved',
                    name: 'Guided Product',
                    category: 'cards',
                    is_active: true
                }],
                error: null
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'cn',
                payload: {
                    name: 'Guided Product',
                    category: 'cards',
                    price_points: 2,
                    show_purchase_notes: true,
                    purchase_notes_zh: '购买前请确认账号地区',
                    purchase_notes_en: 'Please confirm the account region before purchase.',
                    show_usage_instructions: true,
                    usage_instructions_zh: '兑换后查看使用说明',
                    usage_instructions_en: 'Check instructions after redemption.'
                }
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.compatibilityFallback, true);
        assert.deepEqual(payload.compatibilityRemovedFields.sort(), [
            'purchase_notes_en',
            'purchase_notes_zh'
        ]);
        assert.equal(state.insertPayloads.length, 2);
        assert.equal(state.insertPayloads[0].purchase_notes_zh, '购买前请确认账号地区');
        assert.equal(state.insertPayloads[1].purchase_notes, '购买前请确认账号地区');
        assert.equal(Object.hasOwn(state.insertPayloads[1], 'purchase_notes_zh'), false);
        assert.equal(Object.hasOwn(state.insertPayloads[1], 'purchase_notes_en'), false);
        assert.equal(state.auditCalls.length, 1);
    });
});

test('shop mutate upsert saves product skus for admin inventory selectors', async () => {
    await withShopMutateHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'cn',
                payload: {
                    name: 'SKU Product',
                    category: 'cards',
                    price_points: 10,
                    delivery_type: 'KEY'
                },
                skus: [
                    {
                        sku_name: '月卡',
                        sku_code: 'month',
                        price_points: 10,
                        quantity_rules: [
                            { qty: 4, price: 8 }
                        ],
                        is_default: true,
                        is_active: true
                    },
                    {
                        sku_name: '年卡',
                        sku_code: 'year',
                        price_points: 99,
                        quantity_rules_intl: [
                            { qty: 2, price: 88 }
                        ],
                        is_default: false,
                        is_active: true
                    }
                ]
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(
            (state.insertPayloadsByTable.shop_product_skus || []).map((row) => ({
                product_id: row.product_id,
                sku_name: row.sku_name,
                sku_code: row.sku_code,
                is_default: row.is_default
            })),
            [
                { product_id: 'prod_saved', sku_name: '月卡', sku_code: 'month', is_default: false },
                { product_id: 'prod_saved', sku_name: '年卡', sku_code: 'year', is_default: false }
            ]
        );
        assert.deepEqual(state.insertPayloadsByTable.shop_product_skus[0].quantity_rules, [
            { qty: 4, price: 8 }
        ]);
        assert.deepEqual(state.insertPayloadsByTable.shop_product_skus[1].quantity_rules_intl, [
            { qty: 2, price: 88 }
        ]);
        assert.deepEqual(
            state.updatePayloadsByTable.shop_product_skus,
            [
                { payload: { is_default: false }, filters: [['product_id', 'prod_saved']] },
                { payload: { is_default: true, is_active: true }, filters: [['id', 'sku_1']] }
            ]
        );
        assert.equal(payload.skus.length, 2);
        assert.equal(payload.product.skus.length, 2);
    });
});

test('shop mutate upsert reuses existing sku by code when edit payload omits sku id', async () => {
    await withShopMutateHandler({
        tableResults: {
            shop_product_skus: [
                {
                    data: [{
                        id: 'sku_existing_default',
                        product_id: 'prod_saved',
                        sku_code: 'default',
                        sku_name: '默认规格',
                        spec_values: { label: '默认规格' },
                        price_points: 10,
                        price_points_intl: null,
                        quantity_rules: null,
                        quantity_rules_intl: null,
                        is_default: true,
                        is_active: true,
                        stock_count: 8,
                        sort_order: 0
                    }],
                    error: null
                },
                {
                    data: [{
                        id: 'sku_existing_default',
                        product_id: 'prod_saved',
                        sku_code: 'default',
                        sku_name: '默认规格',
                        spec_values: {},
                        price_points: 21,
                        price_points_intl: null,
                        quantity_rules: null,
                        quantity_rules_intl: null,
                        is_default: false,
                        is_active: true,
                        stock_count: 8,
                        sort_order: 0
                    }],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'cn',
                productId: 'prod_saved',
                payload: {
                    id: 'prod_saved',
                    name: 'SKU Product',
                    category: 'cards',
                    price_points: 21,
                    delivery_type: 'KEY',
                    show_purchase_notes: true,
                    purchase_notes_zh: '购买前请确认账号地区',
                    purchase_notes_en: 'Please confirm the account region before purchase.'
                },
                skus: [{
                    sku_name: '默认规格',
                    sku_code: 'default',
                    price_points: 21,
                    is_default: true,
                    is_active: true
                }]
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.insertPayloadsByTable.shop_product_skus, undefined);
        assert.deepEqual(
            state.updatePayloadsByTable.shop_product_skus.slice(0, 1).map((entry) => ({
                filters: entry.filters,
                product_id: entry.payload.product_id,
                sku_code: entry.payload.sku_code,
                price_points: entry.payload.price_points
            })),
            [{
                filters: [['id', 'sku_existing_default']],
                product_id: 'prod_saved',
                sku_code: 'default',
                price_points: 21
            }]
        );
        assert.equal(payload.skus[0].id, 'sku_existing_default');
    });
});

test('shop mutate upsert releases removed sku code before reusing it on another sku', async () => {
    await withShopMutateHandler({
        tableResults: {
            shop_product_skus: [
                {
                    data: [
                        {
                            id: 'sku_old_code_3',
                            product_id: 'prod_saved',
                            sku_code: '3',
                            sku_name: '旧三号规格',
                            spec_values: { label: '旧三号规格' },
                            price_points: 10,
                            price_points_intl: null,
                            quantity_rules: null,
                            quantity_rules_intl: null,
                            is_default: false,
                            is_active: true,
                            stock_count: 0,
                            sort_order: 0
                        },
                        {
                            id: 'sku_target',
                            product_id: 'prod_saved',
                            sku_code: '2',
                            sku_name: '目标规格',
                            spec_values: { label: '目标规格' },
                            price_points: 20,
                            price_points_intl: null,
                            quantity_rules: null,
                            quantity_rules_intl: null,
                            is_default: true,
                            is_active: true,
                            stock_count: 0,
                            sort_order: 1
                        }
                    ],
                    error: null
                },
                {
                    data: [{
                        id: 'sku_target',
                        product_id: 'prod_saved',
                        sku_code: '3',
                        sku_name: '目标规格',
                        spec_values: {},
                        inventory_sku_id: null,
                        price_points: 30,
                        price_points_intl: null,
                        quantity_rules: null,
                        quantity_rules_intl: null,
                        is_default: false,
                        is_active: true,
                        stock_count: 0,
                        sort_order: 0
                    }],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'cn',
                productId: 'prod_saved',
                payload: {
                    id: 'prod_saved',
                    name: 'SKU Product',
                    category: 'cards',
                    price_points: 30,
                    delivery_type: 'KEY'
                },
                skus: [{
                    id: 'sku_target',
                    sku_name: '目标规格',
                    sku_code: '3',
                    price_points: 30,
                    is_default: true,
                    is_active: true
                }]
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.insertPayloadsByTable.shop_product_skus, undefined);
        assert.deepEqual(
            state.updatePayloadsByTable.shop_product_skus.slice(0, 2),
            [
                { payload: { sku_code: null }, filters: [['id', 'sku_old_code_3']] },
                {
                    payload: {
                        product_id: 'prod_saved',
                        sku_code: '3',
                        sku_name: '目标规格',
                        spec_values: {},
                        inventory_sku_id: null,
                        price_points: 30,
                        price_points_intl: null,
                        quantity_rules: null,
                        quantity_rules_intl: null,
                        is_default: false,
                        is_active: true,
                        sort_order: 0
                    },
                    filters: [['id', 'sku_target']]
                }
            ]
        );
    });
});

test('shop mutate upsert persists shared inventory source for an existing sku', async () => {
    await withShopMutateHandler({
        tableResults: {
            shop_product_skus: [
                {
                    data: [
                        {
                            id: 'sku_us',
                            product_id: 'prod_saved',
                            sku_code: 'us',
                            sku_name: '美区',
                            spec_values: {},
                            inventory_sku_id: null,
                            price_points: 45,
                            price_points_intl: null,
                            quantity_rules: null,
                            quantity_rules_intl: null,
                            is_default: true,
                            is_active: true,
                            stock_count: 8,
                            sort_order: 0
                        },
                        {
                            id: 'sku_us_warranty',
                            product_id: 'prod_saved',
                            sku_code: 'us-warranty',
                            sku_name: '美区带质保',
                            spec_values: {},
                            inventory_sku_id: null,
                            price_points: 80,
                            price_points_intl: null,
                            quantity_rules: null,
                            quantity_rules_intl: null,
                            is_default: false,
                            is_active: true,
                            stock_count: 0,
                            sort_order: 1
                        }
                    ],
                    error: null
                },
                { data: [{ id: 'sku_us', product_id: 'prod_saved', sku_code: 'us', sku_name: '美区', inventory_sku_id: null, is_default: false, is_active: true, sort_order: 0 }], error: null },
                { data: [{ id: 'sku_us_warranty', product_id: 'prod_saved', sku_code: 'us-warranty', sku_name: '美区带质保', inventory_sku_id: 'sku_us', is_default: false, is_active: true, sort_order: 1 }], error: null }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'cn',
                productId: 'prod_saved',
                payload: {
                    id: 'prod_saved',
                    name: 'Google One',
                    category: 'cards',
                    price_points: 45,
                    delivery_type: 'KEY'
                },
                skus: [
                    {
                        id: 'sku_us',
                        sku_name: '美区',
                        sku_code: 'us',
                        price_points: 45,
                        is_default: true,
                        is_active: true
                    },
                    {
                        id: 'sku_us_warranty',
                        sku_name: '美区带质保',
                        sku_code: 'us-warranty',
                        inventory_sku_id: 'sku_us',
                        price_points: 80,
                        is_default: false,
                        is_active: true
                    }
                ]
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        const warrantyUpdate = state.updatePayloadsByTable.shop_product_skus.find((entry) => (
            entry.filters.some(([column, value]) => column === 'id' && value === 'sku_us_warranty')
        ));
        assert.equal(warrantyUpdate?.payload?.inventory_sku_id, 'sku_us');
        assert.equal(warrantyUpdate?.payload?.price_points, 80);
    });
});

test('shop mutate upsert rejects chained shared inventory sources', async () => {
    await withShopMutateHandler({
        tableResults: {
            shop_product_skus: [
                {
                    data: [
                        {
                            id: 'sku_us',
                            product_id: 'prod_saved',
                            sku_code: 'us',
                            sku_name: '美区',
                            inventory_sku_id: null,
                            is_default: true,
                            is_active: true,
                            stock_count: 8,
                            sort_order: 0
                        },
                        {
                            id: 'sku_warranty',
                            product_id: 'prod_saved',
                            sku_code: 'us-warranty',
                            sku_name: '美区带质保',
                            inventory_sku_id: 'sku_us',
                            is_default: false,
                            is_active: true,
                            stock_count: 8,
                            sort_order: 1
                        },
                        {
                            id: 'sku_second_alias',
                            product_id: 'prod_saved',
                            sku_code: 'us-second',
                            sku_name: '二级别名',
                            inventory_sku_id: null,
                            is_default: false,
                            is_active: true,
                            stock_count: 0,
                            sort_order: 2
                        }
                    ],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'upsert_product',
                site: 'cn',
                productId: 'prod_saved',
                payload: {
                    id: 'prod_saved',
                    name: 'Google One',
                    category: 'cards',
                    price_points: 45,
                    delivery_type: 'KEY'
                },
                skus: [
                    { id: 'sku_us', sku_name: '美区', sku_code: 'us', price_points: 45, is_default: true, is_active: true },
                    { id: 'sku_warranty', sku_name: '美区带质保', sku_code: 'us-warranty', inventory_sku_id: 'sku_us', price_points: 80, is_default: false, is_active: true },
                    { id: 'sku_second_alias', sku_name: '二级别名', sku_code: 'us-second', inventory_sku_id: 'sku_warranty', price_points: 90, is_default: false, is_active: true }
                ]
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'shop_product_sku_inventory_source_invalid');
        assert.equal(state.updatePayloadsByTable.shop_product_skus, undefined);
    });
});
