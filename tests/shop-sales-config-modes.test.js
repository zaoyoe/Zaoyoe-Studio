'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

const {
    createShopHandlers,
    calculateProductDisplaySales
} = require('../server/api-handlers/public/shop');
const handleShopMutation = require('../server/api-handlers/admin/shop/mutate');

test('Mode 1: External display sales equals real sales + sales base', () => {
    assert.equal(typeof calculateProductDisplaySales, 'function');

    const product = {
        id: 'prod-mode-1',
        sales_config: {
            mode: 1,
            base_sales: 120
        }
    };

    // real sales = 25 (local + upstream)
    const displaySales = calculateProductDisplaySales(product, 25);
    assert.equal(displaySales, 145, 'Mode 1 should sum real sales (25) and base_sales (120)');

    // with 0 real sales
    const zeroSales = calculateProductDisplaySales(product, 0);
    assert.equal(zeroSales, 120, 'Mode 1 with 0 real sales should return base_sales');
});

test('Mode 2: External display sales equals daily accumulated random seed increment + sales base', () => {
    const product = {
        id: 'prod-mode-2-test',
        sales_config: {
            mode: 2,
            base_sales: 200,
            daily_random_min: 5,
            daily_random_max: 10,
            random_seed: 'custom-seed-xyz',
            start_date: '2026-11-01'
        }
    };

    // Day 0: 2026-11-01
    const day0Sales = calculateProductDisplaySales(product, 999, { currentDateStr: '2026-11-01' });
    const day0Increment = day0Sales - 200;
    assert.ok(day0Increment >= 5 && day0Increment <= 10, `Day 0 increment (${day0Increment}) should be in [5, 10]`);

    // Repeated calls on same day must be completely deterministic (no jitter)
    const day0SalesAgain = calculateProductDisplaySales(product, 0, { currentDateStr: '2026-11-01' });
    assert.equal(day0Sales, day0SalesAgain, 'Same date must return identical deterministic sales');

    // Day 1: 2026-11-02
    const day1Sales = calculateProductDisplaySales(product, 999, { currentDateStr: '2026-11-02' });
    const day1Delta = day1Sales - day0Sales;
    assert.ok(day1Delta >= 5 && day1Delta <= 10, `Day 1 delta (${day1Delta}) should be in [5, 10]`);
    assert.ok(day1Sales > day0Sales, 'Sales must monotonically increase over days');

    // Day 5: 2026-11-06 (6 total days accumulated: day 0 through day 5)
    const day5Sales = calculateProductDisplaySales(product, 0, { currentDateStr: '2026-11-06' });
    assert.ok(day5Sales > day1Sales, 'Day 5 sales must be strictly greater than day 1 sales');
    assert.ok(day5Sales >= 200 + (6 * 5) && day5Sales <= 200 + (6 * 10), 'Day 5 sales must stay strictly within theoretical min/max bounds');

    // Fixed increment when min == max
    const fixedProduct = {
        id: 'prod-fixed',
        sales_config: {
            mode: 2,
            base_sales: 50,
            daily_random_min: 7,
            daily_random_max: 7,
            start_date: '2026-11-01'
        }
    };
    const fixedDay3 = calculateProductDisplaySales(fixedProduct, 0, { currentDateStr: '2026-11-04' }); // 4 days (Nov 1, 2, 3, 4)
    assert.equal(fixedDay3, 50 + 4 * 7, 'When min == max, each day must add exactly that fixed amount');

    // Future start date
    const futureProduct = {
        id: 'prod-future',
        sales_config: {
            mode: 2,
            base_sales: 88,
            daily_random_min: 2,
            daily_random_max: 5,
            start_date: '2026-12-01'
        }
    };
    const futureSales = calculateProductDisplaySales(futureProduct, 0, { currentDateStr: '2026-11-07' });
    assert.equal(futureSales, 88, 'Future start_date should return base_sales without increment');

    // When start_date is omitted, it must default to today, NOT product.created_at
    const productOldCreated = {
        id: 'prod-old',
        created_at: '2025-01-01T00:00:00Z',
        sales_config: {
            mode: 2,
            base_sales: 126,
            daily_random_min: 12,
            daily_random_max: 33
        }
    };
    const oldCreatedTodaySales = calculateProductDisplaySales(productOldCreated, 0, { currentDateStr: '2026-11-07' });
    assert.ok(
        oldCreatedTodaySales >= 126 + 12 && oldCreatedTodaySales <= 126 + 33,
        `Omitted start_date must default to today (${oldCreatedTodaySales} should be between 138 and 159, not 3000+)`
    );
});

test('Mode 3 and fallback: Completely real sales', () => {
    // Explicit Mode 3
    const mode3Product = {
        id: 'prod-mode-3',
        sales_config: {
            mode: 3,
            base_sales: 500,
            daily_random_min: 10,
            daily_random_max: 20
        }
    };
    const mode3Sales = calculateProductDisplaySales(mode3Product, 37);
    assert.equal(mode3Sales, 37, 'Mode 3 must strictly return real sales (37), ignoring base or daily randoms');

    // Default when sales_config is empty / missing
    const defaultProduct = { id: 'prod-plain' };
    const defaultSales = calculateProductDisplaySales(defaultProduct, 18);
    assert.equal(defaultSales, 18, 'Product without sales_config must return real sales');
});

test('attachPublicShopProductSales strips sales_config from public output', async () => {
    const handlers = createShopHandlers({
        admin: {},
        requestSecurity: {},
        site: { getSite: () => 'cn' }
    });
    const attachSales = handlers?.attachPublicShopProductSales;

    const mockSupabase = {
        from(table) {
            return {
                select() {
                    return {
                        in() {
                            return {
                                eq() {
                                    return Promise.resolve({ data: [], error: null });
                                }
                            };
                        }
                    };
                }
            };
        },
        rpc() {
            return Promise.resolve({
                data: [{ product_id: 'prod-p1', sales_count: 5 }],
                error: null
            });
        }
    };

    const inputProducts = [
        {
            id: 'prod-p1',
            sales_config: {
                mode: 1,
                base_sales: 100
            }
        }
    ];

    const result = await attachSales(mockSupabase, inputProducts, 'cn');
    assert.equal(result.length, 1);
    assert.equal(result[0].sales_count, 105, 'Should calculate Mode 1: 5 real + 100 base = 105');
    assert.equal(Object.prototype.hasOwnProperty.call(result[0], 'sales_config'), false, 'sales_config must NOT be leaked to public client');
});

test('Admin mutation normalizes and validates sales_config payload', async () => {
    const { validateProductPayload } = handleShopMutation;
    assert.equal(typeof validateProductPayload, 'function');

    const createQueryChain = () => {
        const chain = {
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            limit: () => chain,
            single: () => Promise.resolve({ data: null, error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (resolve, reject) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject)
        };
        return chain;
    };
    const mockSupabase = {
        from() {
            return {
                select: () => createQueryChain()
            };
        }
    };

    // Valid Mode 2 config
    const validResult = await validateProductPayload(mockSupabase, {
        productId: 'prod-test',
        payload: {
            name: '测试商品',
            category: 'other',
            price_points: 10,
            sales_config: {
                mode: 2,
                base_sales: '50',
                daily_random_min: '3',
                daily_random_max: '8',
                random_seed: 'seed123',
                start_date: '2026-11-01'
            }
        }
    });
    assert.equal(validResult.blockingIssues.length, 0, 'Valid sales_config should pass validation');

    // Invalid Mode 2 config (min > max)
    const invalidResult = await validateProductPayload(mockSupabase, {
        productId: 'prod-test',
        payload: {
            name: '测试商品',
            category: 'other',
            price_points: 10,
            sales_config: {
                mode: 2,
                base_sales: 10,
                daily_random_min: 15,
                daily_random_max: 5
            }
        }
    });
    assert.ok(invalidResult.blockingIssues.some(i => i.field === 'sales_config'), 'Should reject daily_random_min > daily_random_max');
});

test('Admin studio UI and JS binding support 3 sales modes and custom inputs', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminJs = readRepoFile('js/admin-shop.js');

    // HTML input elements presence
    assert.match(adminHtml, /id="prodSalesMode"/, 'admin-studio.html should contain #prodSalesMode');
    assert.match(adminHtml, /id="prodSalesBase"/, 'admin-studio.html should contain #prodSalesBase');
    assert.match(adminHtml, /id="prodDailyRandomMin"/, 'admin-studio.html should contain #prodDailyRandomMin');
    assert.match(adminHtml, /id="prodDailyRandomMax"/, 'admin-studio.html should contain #prodDailyRandomMax');
    assert.match(adminHtml, /id="prodRandomSeed"/, 'admin-studio.html should contain #prodRandomSeed');
    assert.match(adminHtml, /id="prodSalesStartDate"/, 'admin-studio.html should contain #prodSalesStartDate');

    // JS binding presence
    assert.match(adminJs, /syncSalesModeControls:\s*function/, 'admin-shop.js should implement syncSalesModeControls');
    assert.match(adminJs, /case 'product-sync-sales-mode':/, 'admin-shop.js should delegate product-sync-sales-mode change');
    assert.match(adminJs, /payload\.sales_config\s*=/, 'admin-shop.js should attach sales_config to product payload on save');
});

test('Supplier catalog batch import and single detail modal support sales display configuration', () => {
    const adminHtml = readRepoFile('admin-studio.html');
    const adminJs = readRepoFile('js/admin-shop.js');

    // Batch import modal UI in admin-studio.html
    assert.match(adminHtml, /id="batchImportSalesMode"/, 'Batch modal should contain #batchImportSalesMode');
    assert.match(adminHtml, /id="batchImportSalesBaseGroup"/, 'Batch modal should contain #batchImportSalesBaseGroup');
    assert.match(adminHtml, /id="batchImportDailyMinGroup"/, 'Batch modal should contain #batchImportDailyMinGroup');
    assert.match(adminHtml, /id="batchImportDailyMaxGroup"/, 'Batch modal should contain #batchImportDailyMaxGroup');
    assert.match(adminHtml, /id="batchImportStartDateGroup"/, 'Batch modal should contain #batchImportStartDateGroup');

    // Detail modal in admin-shop.js
    assert.match(adminJs, /id="supplierImportSalesMode"/, 'Detail modal should render #supplierImportSalesMode');
    assert.match(adminJs, /id="supplierImportSalesBaseGroup"/, 'Detail modal should render #supplierImportSalesBaseGroup');
    assert.match(adminJs, /id="supplierImportDailyRandomRow"/, 'Detail modal should render #supplierImportDailyRandomRow');

    // JS controllers and event delegations
    assert.match(adminJs, /syncBatchImportSalesModeControls:\s*function/, 'admin-shop.js should implement syncBatchImportSalesModeControls');
    assert.match(adminJs, /syncSupplierImportSalesModeControls:\s*function/, 'admin-shop.js should implement syncSupplierImportSalesModeControls');
    assert.match(adminJs, /case 'batch-import-sales-mode':/, 'admin-shop.js should delegate batch-import-sales-mode');
    assert.match(adminJs, /case 'supplier-import-sales-mode':/, 'admin-shop.js should delegate supplier-import-sales-mode');

    // Passing salesConfig in batch import and single import
    assert.match(adminJs, /salesConfig:\s*batchSalesConfig/, 'Batch import chunk should pass salesConfig: batchSalesConfig');
    assert.match(adminJs, /initialStatus,\s*salesConfig,/, 'Detail import should pass salesConfig to importSupplierCatalogGoods');
});

test('Supplier catalog backend import handler normalizes and saves sales_config', async () => {
    const supplierCatalogHandler = require('../server/api-handlers/admin/shop/supplier-catalog');
    assert.equal(typeof supplierCatalogHandler.normalizeProductSalesConfig, 'function');

    // Test normalization
    const normMode1 = supplierCatalogHandler.normalizeProductSalesConfig({
        mode: 1,
        base_sales: 120
    });
    assert.deepEqual(normMode1, {
        mode: 1,
        base_sales: 120,
        daily_random_min: 0,
        daily_random_max: 0,
        random_seed: '',
        start_date: null
    });

    const normMode2 = supplierCatalogHandler.normalizeProductSalesConfig({
        mode: 2,
        base_sales: 50,
        daily_random_min: 10,
        daily_random_max: 30,
        random_seed: 'seed-xyz',
        start_date: '2026-11-05'
    });
    assert.deepEqual(normMode2, {
        mode: 2,
        base_sales: 50,
        daily_random_min: 10,
        daily_random_max: 30,
        random_seed: 'seed-xyz',
        start_date: '2026-11-05'
    });

    // Test import handler with salesConfig in payload
    const writes = [];
    const queries = [];
    const results = [
        // resolveAccount
        { data: { id: 'acc-1', provider_id: 'xiareng', account_key: 'default', is_enabled: true }, error: null },
        // existing mapping lookup
        { data: null, error: null },
        // shop_products insert
        { data: { id: 'prod-new-1', name: '虾仁商品' }, error: null },
        // default sku lookup
        { data: { id: 'sku-new-1' }, error: null },
        // sku update
        { data: { id: 'sku-new-1' }, error: null },
        // mapping insert
        { data: { id: 'map-new-1' }, error: null }
    ];

    const mockSupabase = {
        from(table) {
            const query = {
                select() { return this; },
                eq() { return this; },
                maybeSingle() { return this.finish(); },
                single() { return this.finish(); },
                then(resolve, reject) { return this.finish().then(resolve, reject); },
                insert(payload) {
                    writes.push({ table, op: 'insert', payload });
                    return this;
                },
                update(payload) {
                    writes.push({ table, op: 'update', payload });
                    return this;
                },
                finish() {
                    return Promise.resolve(results.shift() || { data: null, error: null });
                }
            };
            return query;
        }
    };

    const { createSupplierAdapterRegistry } = require('../server/integrations/suppliers/contract');

    const mockAdapter = {
        providerId: '16688',
        displayName: '16688',
        capabilities: { catalog: true },
        normalizeCatalogItem(item) {
            return {
                providerGoodsId: String(item.goods_no || item.providerGoodsId || ''),
                name: String(item.goods_name || item.name || ''),
                description: '',
                imageUrl: '',
                supplierUnitPrice: null,
                currency: 'CNY',
                minimumQuantity: null,
                deliveryMethod: null
            };
        },
        async listGoods() { return { total: 1, items: [] }; },
        async getGoodsDetail(goodsNo) {
            return { goods_no: goodsNo, goods_name: '测试导入商品' };
        }
    };

    const handler = supplierCatalogHandler.createSupplierCatalogHandler({
        requireAdmin: async () => ({ supabase: mockSupabase, user: { id: 'admin-1' } }),
        registryFactory: () => createSupplierAdapterRegistry([mockAdapter]),
        writeAdminAuditLog: async () => {},
        sendJson: (response, code, payload) => {
            response.statusCode = code;
            response.body = JSON.stringify(payload);
        },
        env: { SUPPLIER_16688_APP_ID: 'app', SUPPLIER_16688_SECRET: 'secret' }
    });

    const res = {
        statusCode: 200,
        body: '',
        status(code) { this.statusCode = code; return this; },
        setHeader() { return this; },
        end(v) { this.body = v; return this; },
        json() { return JSON.parse(this.body); }
    };

    await handler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: '16688',
            site: 'cn',
            goodsNos: ['G-1'],
            salesConfig: {
                mode: 2,
                base_sales: 88,
                daily_random_min: 15,
                daily_random_max: 35,
                start_date: '2026-11-08'
            }
        }
    }, res);

    assert.equal(res.statusCode, 200);
    const prodInsert = writes.find(w => w.table === 'shop_products' && w.op === 'insert');
    assert.ok(prodInsert, 'Should have inserted into shop_products');
    assert.deepEqual(prodInsert.payload.sales_config, {
        mode: 2,
        base_sales: 88,
        daily_random_min: 15,
        daily_random_max: 35,
        random_seed: '',
        start_date: '2026-11-08'
    }, 'Inserted product must have sales_config attached');
});

test('Supplier catalog import gracefully falls back when sales_config column is missing in database', async () => {
    const supplierCatalogHandler = require('../server/api-handlers/admin/shop/supplier-catalog');
    const { createSupplierAdapterRegistry } = require('../server/integrations/suppliers/contract');

    const writes = [];
    const results = [
        // resolveAccount
        { data: { id: 'acc-1', provider_id: '16688', account_key: 'default', is_enabled: true }, error: null },
        // existing mapping lookup
        { data: null, error: null },
        // First shop_products insert fails due to missing sales_config column
        { data: null, error: { code: 'PGRST204', message: "Could not find the 'sales_config' column of 'shop_products' in the schema cache" } },
        // Fallback shop_products insert succeeds
        { data: { id: 'prod-fallback-1', name: '测试商品' }, error: null },
        // default sku lookup
        { data: { id: 'sku-fallback-1' }, error: null },
        // sku update
        { data: { id: 'sku-fallback-1' }, error: null },
        // mapping insert
        { data: { id: 'map-fallback-1' }, error: null }
    ];

    const mockSupabase = {
        from(table) {
            const query = {
                select() { return this; },
                eq() { return this; },
                maybeSingle() { return this.finish(); },
                single() { return this.finish(); },
                then(resolve, reject) { return this.finish().then(resolve, reject); },
                insert(payload) {
                    writes.push({ table, op: 'insert', payload });
                    return this;
                },
                update(payload) {
                    writes.push({ table, op: 'update', payload });
                    return this;
                },
                finish() {
                    return Promise.resolve(results.shift() || { data: null, error: null });
                }
            };
            return query;
        }
    };

    const mockAdapter = {
        providerId: '16688',
        displayName: '16688',
        capabilities: { catalog: true },
        normalizeCatalogItem(item) {
            return {
                providerGoodsId: String(item.goods_no || item.providerGoodsId || ''),
                name: String(item.goods_name || item.name || ''),
                description: '',
                imageUrl: '',
                supplierUnitPrice: null,
                currency: 'CNY',
                minimumQuantity: null,
                deliveryMethod: null
            };
        },
        async listGoods() { return { total: 1, items: [] }; },
        async getGoodsDetail(goodsNo) {
            return { goods_no: goodsNo, goods_name: '测试商品' };
        }
    };

    const handler = supplierCatalogHandler.createSupplierCatalogHandler({
        requireAdmin: async () => ({ supabase: mockSupabase, user: { id: 'admin-1' } }),
        registryFactory: () => createSupplierAdapterRegistry([mockAdapter]),
        writeAdminAuditLog: async () => {},
        sendJson: (response, code, payload) => {
            response.statusCode = code;
            response.body = JSON.stringify(payload);
        },
        env: { SUPPLIER_16688_APP_ID: 'app', SUPPLIER_16688_SECRET: 'secret' }
    });

    const res = {
        statusCode: 200,
        body: '',
        status(code) { this.statusCode = code; return this; },
        setHeader() { return this; },
        end(v) { this.body = v; return this; },
        json() { return JSON.parse(this.body); }
    };

    await handler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: '16688',
            site: 'cn',
            goodsNos: ['G-FALLBACK'],
            salesConfig: {
                mode: 1,
                base_sales: 66
            }
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const prodInserts = writes.filter(w => w.table === 'shop_products' && w.op === 'insert');
    assert.equal(prodInserts.length, 2, 'Should attempt insert twice (initial with sales_config, fallback without)');
    assert.deepEqual(prodInserts[0].payload.sales_config, {
        mode: 1,
        base_sales: 66,
        daily_random_min: 0,
        daily_random_max: 0,
        random_seed: '',
        start_date: null
    });
    assert.equal('sales_config' in prodInserts[1].payload, false, 'Fallback payload should not have sales_config');
    assert.equal(prodInserts[1].payload.name, '测试商品');
});
