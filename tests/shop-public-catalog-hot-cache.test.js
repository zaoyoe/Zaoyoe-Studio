const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createShopHandlers
} = require('../server/api-handlers/public/shop');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get headers() {
            return state.headers;
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function createThenableQuery(getResult, onAwait) {
    return {
        select() {
            return this;
        },
        in() {
            return this;
        },
        eq() {
            return this;
        },
        order() {
            return this;
        },
        then(resolve, reject) {
            if (typeof onAwait === 'function') {
                onAwait();
            }
            return Promise.resolve()
                .then(getResult)
                .then(resolve, reject);
        }
    };
}

test('public shop catalog hot cache preserves normal hits while refresh requests reload data', async () => {
    let catalogVersion = 1;
    let categoryReads = 0;
    let productReads = 0;
    let skuReads = 0;
    const supabase = {
        from(table) {
            if (table === 'shop_categories') {
                return createThenableQuery(() => ({
                    data: [
                        {
                            id: `category-${catalogVersion}`,
                            name: `Category ${catalogVersion}`,
                            sort_order: 1
                        }
                    ],
                    error: null
                }), () => {
                    categoryReads += 1;
                });
            }

            if (table === 'shop_product_skus') {
                return createThenableQuery(() => ({
                    data: [
                        {
                            id: `sku-${catalogVersion}`,
                            product_id: `product-${catalogVersion}`,
                            sku_name: `Default ${catalogVersion}`,
                            price_points: 10,
                            quantity_rules: [{ qty: 3, price: 8 }],
                            stock_count: 5,
                            is_default: true,
                            is_active: true,
                            sort_order: 0
                        }
                    ],
                    error: null
                }), () => {
                    skuReads += 1;
                });
            }

            if (table === 'shop_inventory') {
                return createThenableQuery(() => ({
                    data: [],
                    error: null
                }));
            }

            assert.equal(table, 'shop_products');
            return createThenableQuery(() => ({
                data: [
                    {
                        id: `product-${catalogVersion}`,
                        name: `Product ${catalogVersion}`,
                        price_points: 10,
                        stock_count: 5,
                        manual_delivery: catalogVersion === 1,
                        category: 'tools',
                        display_order: 1,
                        is_active: true
                    }
                ],
                error: null
            }), () => {
                productReads += 1;
            });
        }
    };
    const handler = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return supabase;
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        site: {
            requireSupportedSite(value) {
                const normalized = String(value || 'cn').trim().toLowerCase();
                if (normalized !== 'cn' && normalized !== 'intl') {
                    const error = new Error('Unsupported site');
                    error.statusCode = 400;
                    throw error;
                }
                return normalized;
            }
        },
        env: {
            SHOP_CATALOG_HOT_CACHE_TTL_MS: '60000'
        }
    }).catalog;

    const firstRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn',
        headers: {}
    }, firstRes);

    catalogVersion = 2;
    const secondRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn',
        headers: {}
    }, secondRes);

    const refreshRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn&refresh=123',
        headers: {
            'cache-control': 'no-cache'
        }
    }, refreshRes);

    const finalRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn',
        headers: {}
    }, finalRes);

    assert.equal(firstRes.statusCode, 200);
    assert.equal(secondRes.statusCode, 200);
    assert.equal(refreshRes.statusCode, 200);
    assert.equal(finalRes.statusCode, 200);
    assert.equal(firstRes.headers['x-zaoyoe-cache'], 'miss');
    assert.equal(secondRes.headers['x-zaoyoe-cache'], 'hit');
    assert.equal(refreshRes.headers['x-zaoyoe-cache'], 'refresh');
    assert.equal(finalRes.headers['x-zaoyoe-cache'], 'hit');
    assert.equal(categoryReads, 2);
    assert.equal(productReads, 2);
    assert.equal(skuReads, 2);
    assert.equal(firstRes.json().products[0].id, 'product-1');
    assert.equal(firstRes.json().products[0].manual_delivery, true);
    assert.equal(firstRes.json().products[0].skus[0].id, 'sku-1');
    assert.deepEqual(firstRes.json().products[0].skus[0].quantity_rules, [{ qty: 3, price: 8 }]);
    assert.equal(secondRes.json().products[0].id, 'product-1');
    assert.equal(refreshRes.json().products[0].id, 'product-2');
    assert.equal(refreshRes.json().products[0].manual_delivery, false);
    assert.equal(finalRes.json().products[0].id, 'product-2');
    assert.match(secondRes.headers['server-timing'], /shop-catalog-cache;dur=\d+;desc="hit"/);
});

test('public shop catalog hides private categories and their products', async () => {
    const supabase = {
        from(table) {
            if (table === 'shop_categories') {
                return createThenableQuery(() => ({
                    data: [
                        { id: 'cat_public', name: 'public-tools', sort_order: 1, is_public: true },
                        { id: 'cat_hidden', name: 'internal-tools', sort_order: 2, is_public: false }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_product_skus') {
                return createThenableQuery(() => ({
                    data: [],
                    error: null
                }));
            }

            if (table === 'shop_inventory') {
                return createThenableQuery(() => ({
                    data: [],
                    error: null
                }));
            }

            assert.equal(table, 'shop_products');
            return createThenableQuery(() => ({
                data: [
                    {
                        id: 'product_public',
                        name: 'Visible product',
                        price_points: 10,
                        stock_count: 5,
                        category: 'public-tools',
                        display_order: 2,
                        is_active: true
                    },
                    {
                        id: 'product_hidden',
                        name: 'Hidden product',
                        price_points: 10,
                        stock_count: 5,
                        category: 'internal-tools',
                        display_order: 1,
                        is_active: true
                    }
                ],
                error: null
            }));
        }
    };
    const handler = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return supabase;
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        site: {
            requireSupportedSite(value) {
                return String(value || 'cn').trim().toLowerCase() || 'cn';
            }
        },
        env: {
            SHOP_CATALOG_HOT_CACHE_TTL_MS: '0'
        }
    }).catalog;

    const allRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn&refresh=1',
        headers: {}
    }, allRes);

    assert.equal(allRes.statusCode, 200);
    assert.deepEqual(allRes.json().categories.map((category) => category.name), ['public-tools']);
    assert.deepEqual(allRes.json().products.map((product) => product.id), ['product_public']);

    const hiddenCategoryRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn&category=internal-tools&refresh=2',
        headers: {}
    }, hiddenCategoryRes);

    assert.equal(hiddenCategoryRes.statusCode, 200);
    assert.deepEqual(hiddenCategoryRes.json().categories.map((category) => category.name), ['public-tools']);
    assert.deepEqual(hiddenCategoryRes.json().products, []);
});

test('public shop catalog hides categories without products priced for the requested site', async () => {
    const supabase = {
        from(table) {
            if (table === 'shop_categories') {
                return createThenableQuery(() => ({
                    data: [
                        { id: 'cat_cn_only', name: 'cn-only-tools', sort_order: 1, is_public: true },
                        { id: 'cat_intl', name: 'intl-tools', sort_order: 2, is_public: true }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_product_skus') {
                return createThenableQuery(() => ({
                    data: [],
                    error: null
                }));
            }

            if (table === 'shop_inventory') {
                return createThenableQuery(() => ({
                    data: [],
                    error: null
                }));
            }

            assert.equal(table, 'shop_products');
            return createThenableQuery(() => ({
                data: [
                    {
                        id: 'product-cn-only',
                        name: 'CN only product',
                        price_points: 10,
                        price_points_intl: null,
                        stock_count: 5,
                        category: 'cn-only-tools',
                        display_order: 2,
                        is_active: true
                    },
                    {
                        id: 'product-intl',
                        name: 'INTL product',
                        price_points: 20,
                        price_points_intl: 2,
                        stock_count: 5,
                        category: 'intl-tools',
                        display_order: 1,
                        is_active: true
                    }
                ],
                error: null
            }));
        }
    };
    const handler = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return supabase;
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        site: {
            requireSupportedSite(value) {
                return String(value || 'cn').trim().toLowerCase() || 'cn';
            }
        },
        env: {
            SHOP_CATALOG_HOT_CACHE_TTL_MS: '0'
        }
    }).catalog;

    const intlRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=intl&refresh=1',
        headers: {}
    }, intlRes);

    assert.equal(intlRes.statusCode, 200);
    assert.deepEqual(intlRes.json().categories.map((category) => category.name), ['intl-tools']);
    assert.deepEqual(intlRes.json().products.map((product) => product.id), ['product-intl']);

    const cnRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn&refresh=2',
        headers: {}
    }, cnRes);

    assert.equal(cnRes.statusCode, 200);
    assert.deepEqual(cnRes.json().categories.map((category) => category.name), ['cn-only-tools', 'intl-tools']);
    assert.deepEqual(cnRes.json().products.map((product) => product.id), ['product-cn-only', 'product-intl']);
});

test('public shop catalog hides skus without a price for the requested site', async () => {
    const supabase = {
        from(table) {
            if (table === 'shop_categories') {
                return createThenableQuery(() => ({
                    data: [
                        { id: 'cat_public', name: 'memberships', sort_order: 1, is_public: true }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_product_skus') {
                return createThenableQuery(() => ({
                    data: [
                        {
                            id: 'sku-cn-only',
                            product_id: 'product-intl',
                            sku_name: 'CN only',
                            price_points: 10,
                            price_points_intl: null,
                            stock_count: 5,
                            is_default: true,
                            is_active: true,
                            sort_order: 0
                        },
                        {
                            id: 'sku-intl',
                            product_id: 'product-intl',
                            sku_name: 'INTL',
                            price_points: 12,
                            price_points_intl: 2,
                            stock_count: 5,
                            is_default: false,
                            is_active: true,
                            sort_order: 1
                        }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_inventory') {
                return createThenableQuery(() => ({
                    data: [],
                    error: null
                }));
            }

            assert.equal(table, 'shop_products');
            return createThenableQuery(() => ({
                data: [
                    {
                        id: 'product-intl',
                        name: 'Site scoped product',
                        price_points: 99,
                        price_points_intl: 9,
                        stock_count: 10,
                        category: 'memberships',
                        display_order: 1,
                        is_active: true
                    }
                ],
                error: null
            }));
        }
    };
    const handler = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return supabase;
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        site: {
            requireSupportedSite(value) {
                return String(value || 'cn').trim().toLowerCase() || 'cn';
            }
        },
        env: {
            SHOP_CATALOG_HOT_CACHE_TTL_MS: '0'
        }
    }).catalog;

    const res = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=intl&refresh=1',
        headers: {}
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(
        res.json().products[0].skus.map((sku) => ({
            id: sku.id,
            price_points: sku.price_points
        })),
        [
            { id: 'sku-intl', price_points: 2 }
        ]
    );
});

test('public shop catalog keeps decimal default sku price even when legacy product price is stale', async () => {
    const supabase = {
        from(table) {
            if (table === 'shop_categories') {
                return createThenableQuery(() => ({
                    data: [
                        { id: 'cat_public', name: 'games', sort_order: 1, is_public: true }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_product_skus') {
                return createThenableQuery(() => ({
                    data: [
                        {
                            id: 'sku-default-decimal',
                            product_id: 'product-decimal',
                            sku_name: '永久维护',
                            price_points: 6.9,
                            stock_count: 5,
                            is_default: true,
                            is_active: true,
                            sort_order: 0
                        }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_inventory') {
                return createThenableQuery(() => ({
                    data: [],
                    error: null
                }));
            }

            assert.equal(table, 'shop_products');
            return createThenableQuery(() => ({
                data: [
                    {
                        id: 'product-decimal',
                        name: 'Decimal Product',
                        price_points: 6,
                        stock_count: 5,
                        category: 'games',
                        display_order: 1,
                        is_active: true
                    }
                ],
                error: null
            }));
        }
    };
    const handler = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return supabase;
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        site: {
            requireSupportedSite(value) {
                return String(value || 'cn').trim().toLowerCase() || 'cn';
            }
        },
        env: {
            SHOP_CATALOG_HOT_CACHE_TTL_MS: '0'
        }
    }).catalog;

    const res = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn&refresh=1',
        headers: {}
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().products[0].price_points, 6);
    assert.equal(res.json().products[0].skus[0].price_points, 6.9);
});

test('public shop catalog resolves site-scoped sku inventory source chains', async () => {
    const supabase = {
        from(table) {
            if (table === 'shop_categories') {
                return createThenableQuery(() => ({
                    data: [
                        { id: 'cat_public', name: 'memberships', sort_order: 1, is_public: true }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_product_skus') {
                return createThenableQuery(() => ({
                    data: [
                        {
                            id: 'sku-local',
                            product_id: 'product-stock',
                            sku_name: 'Local',
                            inventory_source_sku_ids: ['sku-local', 'sku-backup'],
                            inventory_source_sku_ids_intl: [],
                            price_points: 10,
                            price_points_intl: 2,
                            stock_count: 99,
                            is_default: true,
                            is_active: true,
                            sort_order: 0
                        },
                        {
                            id: 'sku-backup',
                            product_id: 'product-stock',
                            sku_name: 'Backup',
                            inventory_source_sku_ids: [],
                            inventory_source_sku_ids_intl: [],
                            price_points: 10,
                            price_points_intl: 2,
                            stock_count: 99,
                            is_default: false,
                            is_active: true,
                            sort_order: 1
                        }
                    ],
                    error: null
                }));
            }

            if (table === 'shop_inventory') {
                return createThenableQuery(() => ({
                    data: [
                        { product_id: 'product-stock', sku_id: 'sku-local', status: 'available' },
                        { product_id: 'product-stock', sku_id: 'sku-backup', status: 'available' },
                        { product_id: 'product-stock', sku_id: 'sku-backup', status: 'available' }
                    ],
                    error: null
                }));
            }

            assert.equal(table, 'shop_products');
            return createThenableQuery(() => ({
                data: [
                    {
                        id: 'product-stock',
                        name: 'Site scoped stock product',
                        price_points: 99,
                        price_points_intl: 9,
                        stock_count: 99,
                        category: 'memberships',
                        display_order: 1,
                        is_active: true
                    }
                ],
                error: null
            }));
        }
    };
    const handler = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() {
                return supabase;
            },
            sendJson(res, status, payload) {
                res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        site: {
            requireSupportedSite(value) {
                return String(value || 'cn').trim().toLowerCase() || 'cn';
            }
        },
        env: {
            SHOP_CATALOG_HOT_CACHE_TTL_MS: '0'
        }
    }).catalog;

    const cnRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=cn&refresh=1',
        headers: {}
    }, cnRes);

    const intlRes = createMockResponse();
    await handler({
        method: 'GET',
        url: '/api/shop/catalog?site=intl&refresh=2',
        headers: {}
    }, intlRes);

    assert.equal(cnRes.statusCode, 200);
    assert.equal(intlRes.statusCode, 200);
    assert.equal(cnRes.json().products[0].skus.find((sku) => sku.id === 'sku-local')?.stock_count, 3);
    assert.deepEqual(cnRes.json().products[0].skus.find((sku) => sku.id === 'sku-local')?.inventory_source_sku_ids, ['sku-local', 'sku-backup']);
    assert.equal(intlRes.json().products[0].skus.find((sku) => sku.id === 'sku-local')?.stock_count, 1);
    assert.deepEqual(intlRes.json().products[0].skus.find((sku) => sku.id === 'sku-local')?.inventory_source_sku_ids, []);
});
