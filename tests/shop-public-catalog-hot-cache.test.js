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

            assert.equal(table, 'shop_products');
            return createThenableQuery(() => ({
                data: [
                    {
                        id: `product-${catalogVersion}`,
                        name: `Product ${catalogVersion}`,
                        price_points: 10,
                        stock_count: 5,
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
    assert.equal(firstRes.json().products[0].skus[0].id, 'sku-1');
    assert.deepEqual(firstRes.json().products[0].skus[0].quantity_rules, [{ qty: 3, price: 8 }]);
    assert.equal(secondRes.json().products[0].id, 'product-1');
    assert.equal(refreshRes.json().products[0].id, 'product-2');
    assert.equal(finalRes.json().products[0].id, 'product-2');
    assert.match(secondRes.headers['server-timing'], /shop-catalog-cache;dur=\d+;desc="hit"/);
});
