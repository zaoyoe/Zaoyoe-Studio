'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SupplierAdapterError,
    createSupplierAdapterRegistry
} = require('../server/integrations/suppliers/contract');
const {
    buildSigningString,
    create16688Adapter,
    normalizeCatalogItem,
    normalizeMoney,
    normalizePurchaseStatus,
    sign16688Params
} = require('../server/integrations/suppliers/16688/client');

function makeResponse(data, { status = 200, ok = true } = {}) {
    return {
        ok,
        status,
        async json() {
            return data;
        }
    };
}

function makeFetchQueue(queue, calls = []) {
    return async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        const next = queue.shift();
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return next(url, options);
        return next;
    };
}

test('16688 signing sorts keys and nested objects, preserves list order, and skips empty/sign fields', () => {
    const params = {
        z: 'last',
        empty: '',
        nil: null,
        sign: 'ignored',
        sign_type: 'ignored',
        nested: {
            z: '斜杠/保留',
            a: 1
        },
        list: [{ z: 2, a: 1 }, 'second'],
        app_id: 'app-1'
    };

    assert.equal(
        buildSigningString(params),
        'app_id=app-1&list=[{"a":1,"z":2},"second"]&nested={"a":1,"z":"斜杠/保留"}&z=last'
    );
    assert.match(sign16688Params(params, 'secret'), /^[a-f0-9]{32}$/);
});

test('16688 adapter signs JSON POST requests and maps catalog, quote, balance and purchase routes', async () => {
    const calls = [];
    const fetchImpl = makeFetchQueue([
        makeResponse({ code: 1, data: { total: 1, list: [{ goods_no: 'SG1' }] } }),
        makeResponse({ code: 1, data: { goods_no: 'SG1', available_quantity: 4 } }),
        makeResponse({ code: 1, data: { balance_enough: false, available_money: 0, available_quantity: 4 } }),
        makeResponse({ code: 1, data: { operate_money: 0 } }),
        makeResponse({ code: 1, data: { trade_no: 'T-1', goods_no: 'SG1', status: 4, cards: [{ code: 'masked' }] } })
    ], calls);
    const adapter = create16688Adapter({
        appId: 'test-app',
        secret: 'test-secret',
        fetchImpl,
        now: () => 1_710_000_000_000
    });

    const catalog = await adapter.listGoods({ pageNo: 2, pageSize: 50, keywords: 'demo' });
    const detail = await adapter.getGoodsDetail('SG1');
    const quote = await adapter.quotePrice({ goodsNo: 'SG1', quantity: 2 });
    const balance = await adapter.getBalance();
    const purchase = await adapter.createPurchase({ goodsNo: 'SG1', quantity: 1, remark: 'order-1' });

    assert.equal(catalog.total, 1);
    assert.equal(catalog.items[0].goods_no, 'SG1');
    assert.equal(detail.available_quantity, 4);
    assert.equal(quote.balance_enough, false);
    assert.equal(balance.operate_money, 0);
    assert.equal(purchase.providerOrderId, 'T-1');
    assert.equal(purchase.status, 'delivered');
    assert.equal(purchase.totalAmount, null);
    assert.equal(calls.length, 5);
    assert.deepEqual(calls.map(({ url }) => url), [
        'https://www.16688.com.cn/openApi/goods/list',
        'https://www.16688.com.cn/openApi/goods/detail',
        'https://www.16688.com.cn/openApi/purchase/quotePrice',
        'https://www.16688.com.cn/openApi/merchant/balance',
        'https://www.16688.com.cn/openApi/purchase/create'
    ]);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].body.app_id, 'test-app');
    assert.equal(calls[0].body.timestamp, '1710000000');
    assert.equal(calls[0].body.page_no, 2);
    assert.equal(calls[0].body.source, 'supply');
    assert.equal(calls[2].body.quantity, 2);
    assert.equal(
        calls[0].body.sign,
        sign16688Params(Object.fromEntries(Object.entries(calls[0].body).filter(([key]) => key !== 'sign')), 'test-secret')
    );
    assert.equal('secret' in calls[0].body, false);
});


test('16688 catalog records normalize into provider-neutral, safe preview fields', () => {
    assert.deepEqual(normalizeCatalogItem({
        goods_no: 'G-1',
        goods_name: '商品标题',
        goods_desc: '描述',
        unit_price: '12.50',
        min_quantity: 2,
        delivery_method: 1,
        image_url: 'https://cdn.example.test/goods.png'
    }), {
        providerGoodsId: 'G-1',
        source: null,
        name: '商品标题',
        description: '描述',
        imageUrl: 'https://cdn.example.test/goods.png',
        supplierUnitPrice: '12.50',
        currency: 'CNY',
        availableQuantity: null,
        salesCount: null,
        minimumQuantity: 2,
        deliveryMethod: 1
    });
    assert.equal(normalizeCatalogItem({ goods_no: 'G-2', goods_name: 'bad image', image_url: 'javascript:alert(1)' }).imageUrl, '');
    assert.deepEqual(normalizeCatalogItem({
        goods_no: 'G-4',
        source: 'supply',
        name: '官方字段商品',
        image: 'https://cdn.example.test/official.png',
        available_quantity: 7,
        limit_quantity: 2,
        sales_count: 11
    }), {
        providerGoodsId: 'G-4',
        source: 'supply',
        name: '官方字段商品',
        description: '',
        imageUrl: 'https://cdn.example.test/official.png',
        supplierUnitPrice: null,
        currency: 'CNY',
        availableQuantity: 7,
        salesCount: 11,
        minimumQuantity: 2,
        deliveryMethod: null
    });
    assert.equal(normalizeCatalogItem({ goods_no: 'G-3' }), null);
});

test('16688 purchase create network timeout is marked outcome-unknown and must not be retried blindly', async () => {
    const fetchImpl = async () => {
        const error = new Error('socket timed out');
        error.name = 'AbortError';
        throw error;
    };
    const adapter = create16688Adapter({
        appId: 'test-app',
        secret: 'test-secret',
        fetchImpl,
        timeoutMs: 250
    });

    await assert.rejects(
        adapter.createPurchase({ goodsNo: 'SG1' }),
        (error) => {
            assert.ok(error instanceof SupplierAdapterError);
            assert.equal(error.operation, 'create_purchase');
            assert.equal(error.code, 'supplier_timeout');
            assert.equal(error.outcomeUnknown, true);
            assert.equal(error.retryable, false);
            return true;
        }
    );
});

test('16688 API rejection is a definitive supplier rejection', async () => {
    const adapter = create16688Adapter({
        appId: 'test-app',
        secret: 'test-secret',
        fetchImpl: makeFetchQueue([makeResponse({ code: 0, msg: '运营钱包余额不足', data: null })])
    });

    await assert.rejects(
        adapter.createPurchase({ goodsNo: 'SG1' }),
        (error) => {
            assert.equal(error.code, 'supplier_rejected');
            assert.equal(error.outcomeUnknown, false);
            assert.match(error.message, /运营钱包余额不足/);
            return true;
        }
    );
});

test('supplier adapter registry validates declared capabilities and provides provider-neutral lookup', () => {
    const adapter = create16688Adapter({
        appId: 'test-app',
        secret: 'test-secret',
        fetchImpl: async () => makeResponse({ code: 1, data: {} })
    });
    const registry = createSupplierAdapterRegistry([adapter]);

    assert.equal(registry.get('16688').providerId, adapter.providerId);
    assert.equal(registry.require('16688', 'procurement').providerId, adapter.providerId);
    assert.equal(registry.get('future-provider'), null);
    assert.throws(() => registry.register(adapter), /already registered/);
    assert.throws(() => registry.require('future-provider'), (error) => error.code === 'supplier_not_configured');
    assert.throws(() => registry.register({ providerId: 'broken', capabilities: { quote: true } }), /quotePrice/);
});

test('supplier money values remain decimal strings instead of entering binary floating-point arithmetic', () => {
    assert.equal(normalizeMoney(19.11), '19.11');
    assert.equal(normalizeMoney('0.0100'), '0.0100');
    assert.equal(normalizeMoney('not-a-number'), null);
});

test('16688 purchase status values map into normalized supplier-neutral states', () => {
    assert.equal(normalizePurchaseStatus(0), 'awaiting_payment');
    assert.equal(normalizePurchaseStatus(1), 'pending_fulfillment');
    assert.equal(normalizePurchaseStatus(2), 'closed');
    assert.equal(normalizePurchaseStatus(3), 'refunded');
    assert.equal(normalizePurchaseStatus(4), 'delivered');
    assert.equal(normalizePurchaseStatus(5), 'completed');
    assert.equal(normalizePurchaseStatus(99), 'unknown');
});
