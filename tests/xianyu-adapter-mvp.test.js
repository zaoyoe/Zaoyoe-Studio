const test = require('node:test');
const assert = require('node:assert/strict');

const {
    formatCliError,
    parseArgs,
    normalizeOrdersJson
} = require('../adapters/xianyu/adapter');

const {
    buildMarketplaceOrderPayload,
    normalizeXianyuOrder,
    runXianyuAdapter,
    submitMarketplaceOrder
} = require('../adapters/xianyu/core');

function createConfig(overrides = {}) {
    return {
        website_base_url: 'https://shop.example.test',
        channel: 'xianyu',
        account: 'backup-1',
        site: 'cn',
        dry_run: true,
        ingest_token_env: 'TEST_XIANYU_TOKEN',
        product_mappings: [
            {
                label: '测试商品',
                xianyu_item_id: 'xy-item-001',
                product_id: '11111111-1111-4111-8111-111111111111'
            }
        ],
        ...overrides
    };
}

function createRawOrder(overrides = {}) {
    return {
        orderId: 'XY-ORDER-1001',
        status: '买家已付款',
        buyerId: 'buyer-1',
        buyerNick: '闲鱼买家',
        item: {
            itemId: 'xy-item-001',
            title: '测试商品标题',
            skuText: '标准版'
        },
        quantity: 2,
        payAmount: '19.80',
        totalAmount: '19.80',
        createdAt: '2026-05-21T09:00:00.000Z',
        ...overrides
    };
}

test('xianyu adapter normalizes raw order and maps it to website product payload', () => {
    const normalized = normalizeXianyuOrder(createRawOrder());
    const payload = buildMarketplaceOrderPayload(normalized, createConfig());

    assert.equal(normalized.external_order_id, 'XY-ORDER-1001');
    assert.equal(normalized.xianyu_item_id, 'xy-item-001');
    assert.equal(normalized.quantity, 2);
    assert.equal(normalized.price_paid, 19.8);
    assert.equal(payload.product_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(payload.channel, 'xianyu');
    assert.equal(payload.account, 'backup-1');
    assert.equal(payload.external_buyer_name, '闲鱼买家');
    assert.equal(payload.snapshot.adapter, 'xianyu-mvp');
});

test('xianyu adapter requires an explicit product mapping before delivery', () => {
    assert.throws(
        () => buildMarketplaceOrderPayload(createRawOrder(), createConfig({
            product_mappings: []
        })),
        /未找到商品映射/
    );
});

test('xianyu adapter matches sku text regardless of spacing around units', () => {
    const payload = buildMarketplaceOrderPayload(createRawOrder({
        item: {
            itemId: 'xy-item-001',
            title: '星星人手办',
            skuText: '6 米'
        }
    }), createConfig({
        product_mappings: [
            {
                label: '星星人手办 - 规格 6',
                xianyu_item_id: 'xy-item-001',
                sku_text_contains: '6米',
                product_id: '11111111-1111-4111-8111-111111111111',
                product_sku_id: '22222222-2222-4222-8222-222222222222'
            }
        ]
    }));

    assert.equal(payload.product_sku_id, '22222222-2222-4222-8222-222222222222');
    assert.equal(payload.snapshot.sku_text, '6 米');
});

test('xianyu adapter dry-run builds payloads without calling network', async () => {
    let fetchCalled = false;
    const summary = await runXianyuAdapter({
        config: createConfig({ dry_run: true }),
        orders: [
            createRawOrder(),
            createRawOrder({
                orderId: 'XY-ORDER-1002',
                status: '待付款'
            })
        ],
        env: {
            TEST_XIANYU_TOKEN: 'secret-token'
        },
        fetchImpl() {
            fetchCalled = true;
        }
    });

    assert.equal(fetchCalled, false);
    assert.equal(summary.dry_run, true);
    assert.equal(summary.dry_run_count, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.results[0].payload.external_order_id, 'XY-ORDER-1001');
});

test('xianyu adapter submit uses bearer token and pins configured channel account', async () => {
    const payload = buildMarketplaceOrderPayload(createRawOrder(), createConfig());
    let captured = null;

    const response = await submitMarketplaceOrder(payload, createConfig({ dry_run: false }), {
        env: {
            TEST_XIANYU_TOKEN: 'secret-token'
        },
        async fetchImpl(url, options) {
            captured = {
                url,
                options,
                body: JSON.parse(options.body)
            };
            return {
                ok: true,
                status: 200,
                async text() {
                    return JSON.stringify({
                        success: true,
                        message: 'Marketplace order created'
                    });
                }
            };
        }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(captured.url, 'https://shop.example.test/api/marketplace/orders');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, 'Bearer secret-token');
    assert.equal(captured.body.channel, 'xianyu');
    assert.equal(captured.body.account, 'backup-1');
});

test('xianyu adapter CLI accepts Admin Studio runtime mode and env file', () => {
    const options = parseArgs([
        '--from-admin',
        '--env-file',
        'server/.env.production',
        '--orders',
        'orders.json',
        '--account',
        'main',
        '--base-url',
        'https://www.zaoyoe.com',
        '--submit'
    ]);

    assert.equal(options.fromAdmin, true);
    assert.equal(options.envFile.endsWith('server/.env.production'), true);
    assert.equal(options.ordersPath.endsWith('orders.json'), true);
    assert.equal(options.overrides.account, 'main');
    assert.equal(options.overrides.website_base_url, 'https://www.zaoyoe.com');
    assert.equal(options.dryRunOverride, false);
});

test('xianyu adapter CLI normalizes single admin order export object', () => {
    assert.deepEqual(normalizeOrdersJson({ orders: [createRawOrder()] }).length, 1);
    assert.deepEqual(normalizeOrdersJson({ data: { orders: [createRawOrder()] } }).length, 1);
    assert.deepEqual(normalizeOrdersJson(createRawOrder()).length, 1);
});

test('xianyu adapter CLI formats missing admin env errors for operators', () => {
    assert.match(
        formatCliError(new Error('Missing required environment variable: SUPABASE_URL')),
        /请使用 --env-file/
    );
});
