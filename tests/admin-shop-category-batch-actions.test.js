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

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every(({ op, column, value }) => {
        if (op === 'eq') return row[column] === value;
        if (op === 'in') return Array.isArray(value) && value.includes(row[column]);
        return true;
    }));
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
        upsert(payload, options = {}) {
            state.mode = 'upsert';
            state.payload = payload;
            state.upsertOptions = options;
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
        in(column, value) {
            state.filters.push({ op: 'in', column, value });
            return builder;
        },
        not() {
            return builder;
        },
        order(column, options = {}) {
            state.order = { column, ascending: options.ascending !== false };
            return builder;
        },
        limit(count) {
            state.limit = count;
            return builder;
        },
        single() {
            state.single = true;
            return builder.then((result) => result);
        },
        maybeSingle() {
            state.single = true;
            return builder.then((result) => result);
        },
        then(resolve, reject) {
            return executor(state).then(resolve, reject);
        }
    };

    return builder;
}

function createSupabaseStub(state) {
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
                    const filteredRows = applyFilters(state.productRows, query.filters);
                    return {
                        data: query.single ? (filteredRows[0] || null) : filteredRows,
                        error: null
                    };
                }

                if (table === 'shop_product_skus') {
                    if (query.mode === 'update') {
                        const rows = applyFilters(state.skuRows || [], query.filters);
                        rows.forEach((row) => {
                            Object.assign(row, query.payload);
                        });
                        return { data: rows, error: null };
                    }
                    const filteredRows = applyFilters(state.skuRows || [], query.filters);
                    return {
                        data: query.single ? (filteredRows[0] || null) : filteredRows,
                        error: null
                    };
                }

                if (table === 'shop_supplier_product_mappings') {
                    if (query.mode === 'update') {
                        const rows = applyFilters(state.mappingRows || [], query.filters);
                        rows.forEach((row) => {
                            Object.assign(row, query.payload);
                        });
                        return { data: rows, error: null };
                    }
                    const filteredRows = applyFilters(state.mappingRows || [], query.filters);
                    return {
                        data: query.single ? (filteredRows[0] || null) : filteredRows,
                        error: null
                    };
                }

                if (table === 'shop_categories') {
                    if (query.mode === 'insert') {
                        const newRow = { id: `cat_${(state.categoryRows || []).length + 1}`, ...query.payload };
                        (state.categoryRows = state.categoryRows || []).push(newRow);
                        return { data: query.single ? newRow : [newRow], error: null };
                    }
                    const filteredRows = applyFilters(state.categoryRows || [], query.filters);
                    return {
                        data: query.single ? (filteredRows[0] || null) : filteredRows,
                        error: null
                    };
                }

                if (table === 'system_config') {
                    if (query.mode === 'upsert' || query.mode === 'insert' || query.mode === 'update') {
                        state.systemConfig = { ...(state.systemConfig || {}), ...(query.payload || {}) };
                        return { data: query.single ? state.systemConfig : [state.systemConfig], error: null };
                    }
                    return { data: query.single ? (state.systemConfig || { value: {} }) : [state.systemConfig || { value: {} }], error: null };
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

    try {
        const handler = require(handlerPath);
        return await callback(handler, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('batch_toggle_category_products preflight detects items with zero price', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'Valid Product 1', price_points: 10, is_active: false, category: 'telegram' },
            { id: 'prod_2', name: 'Valid Product 2', price_points: 25, is_active: false, category: 'telegram' },
            { id: 'prod_3', name: 'Invalid Zero Price', price_points: 0, is_active: false, category: 'telegram' }
        ],
        skuRows: [
            { id: 'sku_1', product_id: 'prod_1', price_points: 10, is_active: true },
            { id: 'sku_2', product_id: 'prod_2', price_points: 25, is_active: true },
            { id: 'sku_3', product_id: 'prod_3', price_points: 0, is_active: true }
        ],
        mappingRows: [
            { id: 'map_1', product_id: 'prod_1', is_enabled: false },
            { id: 'map_2', product_id: 'prod_2', is_enabled: false }
        ]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin/shop/mutate?action=batch_toggle_category_products',
            query: { action: 'batch_toggle_category_products' },
            body: {
                action: 'batch_toggle_category_products',
                site: 'cn',
                category: 'telegram',
                isActive: true,
                preflightOnly: true
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.preflight, true);
        assert.equal(body.total, 3);
        assert.equal(body.eligibleCount, 2);
        assert.equal(body.excludedCount, 1);
        assert.equal(body.excludedDetails[0].id, 'prod_3');

        // Ensure database state was not modified in preflight
        assert.equal(state.productRows[0].is_active, false);
        assert.equal(state.productRows[1].is_active, false);
        assert.equal(state.productRows[2].is_active, false);
    });
});

test('batch_toggle_category_products publish activates eligible products and enables supplier mappings', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'Valid Product 1', price_points: 10, is_active: false, category: 'telegram' },
            { id: 'prod_2', name: 'Valid Product 2', price_points: 25, is_active: false, category: 'telegram' },
            { id: 'prod_3', name: 'Invalid Zero Price', price_points: 0, is_active: false, category: 'telegram' }
        ],
        skuRows: [
            { id: 'sku_1', product_id: 'prod_1', price_points: 10, is_active: true },
            { id: 'sku_2', product_id: 'prod_2', price_points: 25, is_active: true },
            { id: 'sku_3', product_id: 'prod_3', price_points: 0, is_active: true }
        ],
        mappingRows: [
            { id: 'map_1', product_id: 'prod_1', is_enabled: false },
            { id: 'map_2', product_id: 'prod_2', is_enabled: false }
        ]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin/shop/mutate?action=batch_toggle_category_products',
            query: { action: 'batch_toggle_category_products' },
            body: {
                action: 'batch_toggle_category_products',
                site: 'cn',
                category: 'telegram',
                isActive: true,
                preflightOnly: false
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.updatedCount, 2);
        assert.equal(body.excludedCount, 1);

        // Verify products
        assert.equal(state.productRows.find((p) => p.id === 'prod_1').is_active, true);
        assert.equal(state.productRows.find((p) => p.id === 'prod_2').is_active, true);
        assert.equal(state.productRows.find((p) => p.id === 'prod_3').is_active, false);

        // Verify supplier mappings
        assert.equal(state.mappingRows.find((m) => m.id === 'map_1').is_enabled, true);
        assert.equal(state.mappingRows.find((m) => m.id === 'map_2').is_enabled, true);

        // Verify audit log
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'shop.category.publish');
    });
});

test('batch_toggle_category_products unpublish deactivates all products in category', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'Product 1', price_points: 10, is_active: true, category: 'telegram' },
            { id: 'prod_2', name: 'Product 2', price_points: 25, is_active: true, category: 'telegram' },
            { id: 'prod_other', name: 'Other', price_points: 15, is_active: true, category: 'gmail' }
        ]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin/shop/mutate?action=batch_toggle_category_products',
            query: { action: 'batch_toggle_category_products' },
            body: {
                action: 'batch_toggle_category_products',
                site: 'cn',
                category: 'telegram',
                isActive: false
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.updatedCount, 2);

        assert.equal(state.productRows.find((p) => p.id === 'prod_1').is_active, false);
        assert.equal(state.productRows.find((p) => p.id === 'prod_2').is_active, false);
        assert.equal(state.productRows.find((p) => p.id === 'prod_other').is_active, true);
    });
});

test('batch_update_products updates payment channels and recalculates prices by multiplier', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'prod_1', name: 'Product 1', guest_payment_channels: ['zpay'], price_points: 10, is_active: true, category: 'telegram' },
            { id: 'prod_2', name: 'Product 2', guest_payment_channels: ['nowpayments'], price_points: 20, is_active: true, category: 'telegram' }
        ],
        skuRows: [
            { id: 'sku_1', product_id: 'prod_1', price_points: 10 },
            { id: 'sku_2', product_id: 'prod_2', price_points: 20 }
        ],
        mappingRows: [
            { id: 'map_1', product_id: 'prod_1', sku_id: 'sku_1', import_snapshot: { supplierUnitPrice: 10 } },
            { id: 'map_2', product_id: 'prod_2', sku_id: 'sku_2', import_snapshot: { supplierUnitPrice: 20 } }
        ]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin/shop/mutate?action=batch_update_products',
            query: { action: 'batch_update_products' },
            body: {
                action: 'batch_update_products',
                site: 'cn',
                productIds: ['prod_1', 'prod_2'],
                guestPaymentChannels: ['zpay', 'nowpayments'],
                paymentChannelMode: 'replace',
                markupMultiplier: 1.5,
                recalculatePrices: true,
                maxPurchaseQuantity: 10
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.updatedCount, 2);

        // Check product channels and prices: 10 * 1.5 = 15, 20 * 1.5 = 30
        const p1 = state.productRows.find((p) => p.id === 'prod_1');
        assert.deepEqual(p1.guest_payment_channels, ['zpay', 'nowpayments']);
        assert.equal(p1.price_points, 15);
        assert.equal(p1.max_purchase_quantity, 10);

        const p2 = state.productRows.find((p) => p.id === 'prod_2');
        assert.deepEqual(p2.guest_payment_channels, ['zpay', 'nowpayments']);
        assert.equal(p2.price_points, 30);

        // Check SKU prices
        assert.equal(state.skuRows.find((s) => s.id === 'sku_1').price_points, 15);
        assert.equal(state.skuRows.find((s) => s.id === 'sku_2').price_points, 30);

        // Check snapshot markupMultiplier updated
        assert.equal(state.mappingRows.find((m) => m.id === 'map_1').import_snapshot.markupMultiplier, 1.5);
    });
});

test('adminShopCategoriesHandler auto-heals missing categories from shop_products', async () => {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/categories.js');
    const originalLoad = Module._load;
    const state = {
        categoryRows: [
            { id: 'cat_account', name: 'account', sort_order: 10 }
        ],
        productRows: [
            { id: 'prod_1', category: 'account' },
            { id: 'prod_2', category: '飞机场API | 精养 1-12月' }
        ]
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin() {
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

    try {
        const handler = require(handlerPath);
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/shop/categories' }, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        const catNames = (body.rows || []).map((c) => c.name);
        assert.ok(catNames.includes('account'));
        assert.ok(catNames.includes('飞机场API | 精养 1-12月'));
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
});

test('batch_toggle_products publishes selected products and enables mappings', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'p_1', name: 'Product 1', is_active: false, price_points: 50 },
            { id: 'p_2', name: 'Product 2', is_active: false, price_points: 60 }
        ],
        skuRows: [
            { id: 's_1', product_id: 'p_1', sku_name: 'Var 1', price_points: 50 },
            { id: 's_2', product_id: 'p_2', sku_name: 'Var 2', price_points: 60 }
        ],
        mappingRows: [
            { id: 'm_1', product_id: 'p_1', is_enabled: false },
            { id: 'm_2', product_id: 'p_2', is_enabled: false }
        ]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin/shop/mutate?action=batch_toggle_products',
            body: {
                action: 'batch_toggle_products',
                site: 'cn',
                productIds: ['p_1', 'p_2'],
                isActive: true
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.updatedCount, 2);

        const p1 = state.productRows.find((p) => p.id === 'p_1');
        const p2 = state.productRows.find((p) => p.id === 'p_2');
        assert.equal(p1.is_active, true);
        assert.equal(p2.is_active, true);

        const m1 = state.mappingRows.find((m) => m.id === 'm_1');
        const m2 = state.mappingRows.find((m) => m.id === 'm_2');
        assert.equal(m1.is_enabled, true);
        assert.equal(m2.is_enabled, true);
    });
});

test('batch_toggle_products unpublishes selected products and disables mappings', async () => {
    await withShopMutateHandler({
        productRows: [
            { id: 'p_1', name: 'Product 1', is_active: true, price_points: 50 }
        ],
        skuRows: [],
        mappingRows: [
            { id: 'm_1', product_id: 'p_1', is_enabled: true }
        ]
    }, async (handler, state) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            url: '/api/admin/shop/mutate?action=batch_toggle_products',
            body: {
                action: 'batch_toggle_products',
                site: 'cn',
                productIds: ['p_1'],
                isActive: false
            }
        }, res);

        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.updatedCount, 1);

        const p1 = state.productRows.find((p) => p.id === 'p_1');
        assert.equal(p1.is_active, false);

        const m1 = state.mappingRows.find((m) => m.id === 'm_1');
        assert.equal(m1.is_enabled, false);
    });
});

test('admin shop category publish and unpublish contracts guarantee button feedback, view switching and sync broadcasting', () => {
    const fs = require('node:fs');
    const adminShopSource = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');

    // 1. publishCurrentCategory contract
    assert.match(adminShopSource, /publishCurrentCategory:\s*async function\s*\(/);
    assert.match(adminShopSource, /setActionButtonLoading\(btn,\s*'预检中\.\.\.'\)/);
    assert.match(adminShopSource, /setActionButtonLoading\(btn,\s*'上架中\.\.\.'\)/);
    assert.match(adminShopSource, /finishActionButton\(btn,\s*`已上架/);
    assert.match(adminShopSource, /restoreActionButton\(btn\)/);
    assert.match(adminShopSource, /failActionButton\(btn,\s*'上架失败'\)/);
    assert.match(adminShopSource, /notifyShopCatalogChanged\('category_publish'/);

    // 2. unpublishCurrentCategory contract
    assert.match(adminShopSource, /unpublishCurrentCategory:\s*async function\s*\(/);
    assert.match(adminShopSource, /setActionButtonLoading\(btn,\s*'下架中\.\.\.'\)/);
    assert.match(adminShopSource, /finishActionButton\(btn,\s*`已下架/);
    assert.match(adminShopSource, /failActionButton\(btn,\s*'下架失败'\)/);
    assert.match(adminShopSource, /notifyShopCatalogChanged\('category_unpublish'/);
    assert.match(adminShopSource, /filterStatus\('deleted',\s*deletedTabBtn\)/);

    // 3. Action dispatch passes actionEl
    assert.match(adminShopSource, /case 'category-publish-all':\s*void this\.publishCurrentCategory\(actionEl\);/);
    assert.match(adminShopSource, /case 'category-unpublish-all':\s*void this\.unpublishCurrentCategory\(actionEl\);/);

    // 4. Empty state contextual guidance
    assert.match(adminShopSource, /该分类下暂无上架在售商品/);
    assert.match(adminShopSource, /查看该分类下的已下架\/草稿商品/);
    assert.match(adminShopSource, /该分类下暂无已下架商品/);
});

test('shop-client accurately detects catalog differences and revalidates cache seamlessly', () => {
    const fs = require('node:fs');
    const shopClientSource = fs.readFileSync(path.resolve(__dirname, '../js/shop-client.js'), 'utf8');

    // 1. shop-client contract checks
    assert.match(shopClientSource, /hasShopCatalogDifferences:\s*function/);
    assert.match(shopClientSource, /revalidateCatalogAgainstActiveView:\s*async function/);
    assert.match(shopClientSource, /setupShopCatalogSyncListener:\s*function/);
    assert.match(shopClientSource, /BroadcastChannel\('zaoyoe_shop_catalog_channel'\)/);
    assert.match(shopClientSource, /zaoyoe_shop_catalog_v/);
    assert.match(shopClientSource, /visibilitychange/);

    // 2. Functional evaluation of hasShopCatalogDifferences
    const fnSource = shopClientSource.slice(
        shopClientSource.indexOf('hasShopCatalogDifferences: function'),
        shopClientSource.indexOf('revalidateCatalogAgainstActiveView:')
    ).replace(/,\s*$/, '');
    const obj = new Function(`return { ${fnSource} };`)();
    const hasDiff = obj.hasShopCatalogDifferences;

    const baseProducts = [
        { id: '1', name: '商品A', price: 10, stock_count: 5, is_active: true, sold_out: false, updated_at: '2026-11-05T00:00:00Z' },
        { id: '2', name: '商品B', price: 20, stock_count: 10, is_active: true, sold_out: false, updated_at: '2026-11-05T00:00:00Z' }
    ];

    // Same products -> no diff
    assert.equal(hasDiff(baseProducts, JSON.parse(JSON.stringify(baseProducts))), false);

    // Product added -> diff detected!
    const addedProducts = [
        ...baseProducts,
        { id: '3', name: '商品C', price: 30, stock_count: 1, is_active: true, sold_out: false, updated_at: '2026-11-05T00:00:00Z' }
    ];
    assert.equal(hasDiff(baseProducts, addedProducts), true);

    // Product removed/unpublished -> diff detected!
    const removedProducts = [baseProducts[0]];
    assert.equal(hasDiff(baseProducts, removedProducts), true);

    // Product price changed -> diff detected!
    const priceChangedProducts = JSON.parse(JSON.stringify(baseProducts));
    priceChangedProducts[0].price = 15;
    assert.equal(hasDiff(baseProducts, priceChangedProducts), true);

    // Product stock changed -> diff detected!
    const stockChangedProducts = JSON.parse(JSON.stringify(baseProducts));
    stockChangedProducts[1].stock_count = 0;
    assert.equal(hasDiff(baseProducts, stockChangedProducts), true);

    // Product updated_at changed -> diff detected!
    const timeChangedProducts = JSON.parse(JSON.stringify(baseProducts));
    timeChangedProducts[0].updated_at = '2026-11-05T01:00:00Z';
    assert.equal(hasDiff(baseProducts, timeChangedProducts), true);
});

test('category icon mapping, R2 synchronization and UI rendering contracts', async () => {
    const { matchCategoryIconUrl } = require('../server/integrations/suppliers/xiareng/category-groups');

    // 1. upstream categories icon matching matches Xiaren brands
    assert.ok(matchCategoryIconUrl('谷歌邮箱').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('Telegram 账号').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('全球苹果ID（独享）').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('Twitter丨推特/X账号/代开订阅').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('Tiktok账号/海外抖音').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('GPT/Claude/Grok/Gemini/订阅/成品').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('Threads 账号').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('Instagram 账号').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('日韩台/Kakao/LINE').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('linkedin 领英').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('大黄蜂/巴豆/OKC').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('Whatsapp/注册/API').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('USDT/收款靓号').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('Facebook-脸书').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('飞机会员官方代开/频道僵尸粉/浏览量').includes('xiareng.cc'));
    assert.ok(matchCategoryIconUrl('雅虎邮箱').includes('xiareng.cc'));

    // 2. Mutate handler create_category and set_category_icon contracts
    await withShopMutateHandler({
        categoryRows: [
            { id: 'cat_linkedin', name: 'linkedin 领英', color: '#6b9ece', sort_order: 10, icon_url: null }
        ]
    }, async (handler, state) => {
        // Test set_category_icon
        const setReq = {
            method: 'POST',
            url: '/api/admin/shop/mutate?action=set_category_icon',
            query: { action: 'set_category_icon' },
            body: {
                action: 'set_category_icon',
                site: 'cn',
                categoryId: 'cat_linkedin',
                icon_url: 'https://r2.fatherkey.com/shop/categories/icons/test.png'
            }
        };
        const setRes = createMockResponse();
        await handler(setReq, setRes);
        assert.equal(setRes.statusCode, 200);
        const setBody = setRes.json();
        assert.equal(setBody.success, true);
        assert.equal(setBody.category.icon_url, 'https://r2.fatherkey.com/shop/categories/icons/test.png');

        // Test create_category automatically matches icon if not given
        const createReq = {
            method: 'POST',
            url: '/api/admin/shop/mutate?action=create_category',
            query: { action: 'create_category' },
            body: {
                action: 'create_category',
                site: 'cn',
                name: '日韩台/Kakao/LINE',
                color: '#6b9ece'
            }
        };
        const createRes = createMockResponse();
        await handler(createReq, createRes);
        assert.equal(createRes.statusCode, 200);
        const createBody = createRes.json();
        assert.equal(createBody.success, true);
        assert.ok(createBody.category.icon_url.includes('xiareng.cc') || createBody.category.icon_url.includes('r2.fatherkey.com'));
    });

    // 3. Frontend static contract assertions
    const fs = require('node:fs');
    const adminShopSource = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');
    const shopClientSource = fs.readFileSync(path.resolve(__dirname, '../js/shop-client.js'), 'utf8');
    const shopListLayoutSource = fs.readFileSync(path.resolve(__dirname, '../js/shop-list-layout.js'), 'utf8');
    const shopListCssSource = fs.readFileSync(path.resolve(__dirname, '../css/shop-list-layout.css'), 'utf8');

    assert.match(adminShopSource, /getCategoryIconUrl:\s*function/);
    assert.match(adminShopSource, /getCategoryPredefinedIcon:\s*function/);
    assert.match(adminShopSource, /category-tab-main/);
    assert.match(adminShopSource, /category-icon/);
    assert.match(adminShopSource, /categoryIcons/);

    assert.match(shopClientSource, /getCategoryPredefinedIcon:\s*function/);
    assert.match(shopClientSource, /category-icon/);
    assert.match(shopClientSource, /category-text/);

    assert.match(shopListLayoutSource, /function getCategoryIcon\(name\)/);
    assert.match(shopListLayoutSource, /category-tab-main/);
    assert.match(shopListLayoutSource, /category-icon/);
    assert.match(shopListLayoutSource, /syncCategoryTab/);
    assert.match(shopListCssSource, /\.list-aside \.filter-tab \.category-tab-main/);
    assert.match(shopListCssSource, /\.list-aside \.filter-tab \.category-icon/);
});

test('category hierarchy, drag reordering and icon customizer contracts', async () => {
    // 1. Verify Gemini and Claude icon matching guarantees
    const { matchCategoryIconUrl } = require('../server/integrations/suppliers/xiareng/category-groups');
    assert.equal(matchCategoryIconUrl('Gemini'), '/assets/affiliate-poster-icons/gemini.png');
    assert.equal(matchCategoryIconUrl('Gemini Pro 3个月'), '/assets/affiliate-poster-icons/gemini.png');
    assert.equal(matchCategoryIconUrl('Claude'), '/assets/affiliate-poster-icons/claude.png');
    assert.equal(matchCategoryIconUrl('Claude 3.5 Sonnet'), '/assets/affiliate-poster-icons/claude.png');

    // 2. Verify set_category_parent mutation
    await withShopMutateHandler({
        categoryRows: [
            { id: 'cat_parent', name: '谷歌邮箱', sort_order: 10, is_public: true },
            { id: 'cat_child', name: '谷歌邮箱（自营）', sort_order: 20, is_public: true }
        ]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            url: '/api/admin/shop/mutate?action=set_category_parent',
            query: { action: 'set_category_parent' },
            body: {
                action: 'set_category_parent',
                site: 'cn',
                categoryId: 'cat_child',
                parentId: 'cat_parent',
                parentName: '谷歌邮箱'
            }
        };
        const res = createMockResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.category.parent_id, 'cat_parent');
    });

    // 3. Verify set_category_icon mutation
    await withShopMutateHandler({
        categoryRows: [
            { id: 'cat_gemini', name: 'Gemini', icon_url: null, sort_order: 10, is_public: true }
        ]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            url: '/api/admin/shop/mutate?action=set_category_icon',
            query: { action: 'set_category_icon' },
            body: {
                action: 'set_category_icon',
                site: 'cn',
                categoryId: 'cat_gemini',
                iconUrl: '/assets/affiliate-poster-icons/gemini.png'
            }
        };
        const res = createMockResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.success, true);
        assert.equal(body.category.icon_url, '/assets/affiliate-poster-icons/gemini.png');
    });

    // 4. Verify static DOM and JS contracts
    const fs = require('node:fs');
    const adminHtml = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
    const adminShopJs = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');
    const shopListLayoutJs = fs.readFileSync(path.resolve(__dirname, '../js/shop-list-layout.js'), 'utf8');
    const shopClientJs = fs.readFileSync(path.resolve(__dirname, '../js/shop-client.js'), 'utf8');
    const shopListCss = fs.readFileSync(path.resolve(__dirname, '../css/shop-list-layout.css'), 'utf8');

    // Context menu and modals exist in admin-studio.html
    assert.ok(adminHtml.includes('id="categoryContextMenu"'));
    assert.ok(adminHtml.includes('id="categoryIconCustomizerModal"'));
    assert.ok(adminHtml.includes('id="categoryParentPickerModal"'));
    assert.ok(adminHtml.includes('data-shop-action="category-custom-icon"'));
    assert.ok(adminHtml.includes('data-shop-action="category-set-parent"'));
    assert.ok(adminHtml.includes('data-shop-action="category-clear-parent"'));
    assert.ok(adminHtml.includes('data-shop-action="category-publish-all-products"'));
    assert.ok(adminHtml.includes('data-shop-action="category-unpublish-all-products"'));

    // Admin shop JS hierarchy and drag-and-drop methods
    assert.match(adminShopJs, /resolveCategoryIconUrl:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /attachCategoryDragListeners:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /reorderCategoryRelativeTo:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /toggleCategorySubTabs:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /openCategoryIconCustomizer:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /openCategoryParentPicker:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /setCategoryParent:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /clearCategoryParent:\s*(?:async\s+)?function/);
    assert.match(adminShopJs, /batchToggleCategoryProducts:\s*(?:async\s+)?function/);

    // CSS hierarchy and drag classes
    assert.ok(shopListCss.includes('.category-item-group'));
    assert.ok(shopListCss.includes('.filter-tab--child'));
    assert.ok(shopListCss.includes('.category-sub-tabs'));
    assert.ok(shopListCss.includes('.category-tree-chevron'));
    assert.ok(shopListCss.includes('.category-drag-handle'));
    assert.ok(shopListCss.includes('.drop-over-middle'));
    assert.ok(shopListCss.includes('.drop-over-top'));
    assert.ok(shopListCss.includes('.drop-over-bottom'));
    assert.ok(shopListCss.includes('.category-preset-icon-btn'));

    // Buyer shop hierarchy and filtering
    assert.match(shopClientJs, /filterProductsForCategory:\s*function/);
    assert.match(shopListLayoutJs, /renderCategoryContainer/);
    assert.ok(shopListLayoutJs.includes('category-item-group'));
    assert.ok(shopListLayoutJs.includes('category-sub-tabs'));
});

test('optimistic category drag hierarchy reordering and parent picker modal contracts', () => {
    const fs = require('node:fs');
    const adminHtml = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
    const adminShopJs = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');
    const shopListCss = fs.readFileSync(path.resolve(__dirname, '../css/shop-list-layout.css'), 'utf8');

    // 1. Modal visibility and active class guarantees
    assert.match(adminShopJs, /modal\.classList\.add\('active'\)/);
    assert.match(adminShopJs, /modal\.classList\.remove\('active'\)/);
    assert.ok(adminHtml.includes('id="categoryParentPickerModal"'));
    assert.ok(adminHtml.includes('id="categoryParentTargetIcon"'));
    assert.ok(adminHtml.includes('id="categoryParentAsRootBtn"'));
    assert.ok(adminHtml.includes('id="categoryParentOptionsGrid"'));
    assert.ok(adminHtml.includes('id="categoryParentSearchInput"'));
    assert.ok(adminHtml.includes('data-shop-overlay-close="category-parent-modal"'));
    assert.ok(adminHtml.includes('data-shop-overlay-close="category-icon-modal"'));

    // 2. Context menu extensions
    assert.ok(adminHtml.includes('data-shop-action="category-view-products"'));
    assert.ok(adminHtml.includes('data-shop-action="category-create-sub-category"'));
    assert.match(adminShopJs, /selectCategory:\s*function/);
    assert.match(adminShopJs, /createSubCategoryFor:\s*async function/);

    // 3. 0ms Optimistic drag reordering & hierarchy detachment guarantees
    assert.match(adminShopJs, /isTargetChild\s*=\s*Boolean\(category\.parent_id/);
    assert.match(adminShopJs, /parentChanged\s*=\s*\(draggedCat\.parent_id/);
    assert.match(adminShopJs, /inMemoryDragged\.parent_id\s*=\s*newParentId/);
    assert.match(adminShopJs, /previousSnapshot\s*=\s*JSON\.parse\(JSON\.stringify/);

    // 4. CSS drop indicators and badges
    assert.ok(shopListCss.includes('.filter-tab.drop-over-top::after'));
    assert.ok(shopListCss.includes('.filter-tab.drop-over-bottom::after'));
    assert.ok(shopListCss.includes('.filter-tab.drop-over-middle::after'));
    assert.ok(shopListCss.includes('.category-parent-option-card'));
    assert.ok(shopListCss.includes('.category-parent-option-card.selected'));
});

test('category hierarchy parent toggles expand and collapse and sliding indicator aligns bounding client rect', () => {
    const fs = require('node:fs');
    const adminShopJs = fs.readFileSync(path.resolve(__dirname, '../js/admin-shop.js'), 'utf8');
    const shopListLayoutJs = fs.readFileSync(path.resolve(__dirname, '../js/shop-list-layout.js'), 'utf8');
    const shopClientJs = fs.readFileSync(path.resolve(__dirname, '../js/shop-client.js'), 'utf8');
    const shopListCss = fs.readFileSync(path.resolve(__dirname, '../css/shop-list-layout.css'), 'utf8');

    // 1. AdminShop parent toggle and bounding client rect indicator
    assert.match(adminShopJs, /getBoundingClientRect/);
    assert.match(adminShopJs, /Math\.round\(activeRect\.top - containerRect\.top \+ container\.scrollTop\)/);
    assert.match(adminShopJs, /filterCategory:\s*function/);
    assert.match(adminShopJs, /if \(children\.length > 0\) \{/);
    assert.match(adminShopJs, /this\._categoryExpandedState\.delete\(pid\)/);
    assert.match(adminShopJs, /this\._categoryExpandedState\.add\(pid\)/);
    assert.match(adminShopJs, /category-sub-tabs-wrapper/);
    assert.match(adminShopJs, /translate3d\(\$\{left\}px,\$\{top\}px,0\)/);

    // 2. ShopListLayout parent toggle and bounding client rect indicator
    assert.match(shopListLayoutJs, /getBoundingClientRect/);
    assert.match(shopListLayoutJs, /Math\.round\(activeRect\.top - containerRect\.top \+ container\.scrollTop\)/);
    assert.match(shopListLayoutJs, /selectCategory/);
    assert.match(shopListLayoutJs, /shopCategoryExpandedState\.delete\(pid\)/);
    assert.match(shopListLayoutJs, /shopCategoryExpandedState\.add\(pid\)/);
    assert.match(shopListLayoutJs, /toggleCategorySubtabs/);
    assert.match(shopListLayoutJs, /category-sub-tabs-wrapper/);
    assert.match(shopListLayoutJs, /translate3d\(\$\{left\}px, \$\{top\}px, 0\)/);

    // 3. CSS smooth accordion and shortened capsule indicator styles
    assert.ok(shopListCss.includes('.category-sub-tabs-wrapper'));
    assert.ok(shopListCss.includes('.category-sub-tabs-wrapper.is-expanded'));
    assert.ok(shopListCss.includes('grid-template-rows: 0fr'));
    assert.ok(shopListCss.includes('grid-template-rows: 1fr'));
    assert.ok(shopListCss.includes('transition: transform 0.32s'));
    assert.ok(shopListCss.includes('width 0.32s'));

    // 4. ShopClient storefront category normalization preserves parent category
    assert.match(shopClientJs, /normalizeCurrentShopCategoryFromEntries:\s*function/);
    assert.match(shopClientJs, /getCachedProductsForCategory:\s*function/);
});
