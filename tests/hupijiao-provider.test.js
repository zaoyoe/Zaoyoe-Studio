const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildHupijiaoHash,
    buildHupijiaoPaymentPayload,
    buildHupijiaoQueryPayload,
    buildHupijiaoRefundPayload,
    buildHupijiaoTradeOrderId,
    createHupijiaoPayment,
    normalizeHupijiaoConfig,
    resolveHupijiaoEndpointUrl,
    sanitizeHupijiaoTitle,
    verifyHupijiaoHash
} = require('../api/_lib/payments/hupijiao');

test('normalizeHupijiaoConfig derives official endpoint urls and reports missing fields', () => {
    const config = normalizeHupijiaoConfig({
        channelConfig: {
            merchant_id: 'appid-123',
            gateway_url: 'https://api.dpweixin.com/payment/do.html',
            notify_url: 'https://www.zaoyoe.com/api/payments/hupijiao/webhook',
            return_url: 'https://www.zaoyoe.com/wallet'
        },
        secretValues: {
            hupijiao_secret_key: 'secret-123'
        },
        requestOrigin: 'https://www.zaoyoe.com'
    });

    assert.equal(config.appId, 'appid-123');
    assert.equal(config.paymentUrl, 'https://api.dpweixin.com/payment/do.html');
    assert.equal(config.queryUrl, 'https://api.dpweixin.com/payment/query.html');
    assert.equal(config.refundUrl, 'https://api.dpweixin.com/payment/refund.html');
    assert.equal(config.createReady, true);
    assert.deepEqual(config.missingFields, []);
});

test('resolveHupijiaoEndpointUrl falls back to official production gateway', () => {
    assert.equal(
        resolveHupijiaoEndpointUrl('', '/payment/query.html'),
        'https://api.xunhupay.com/payment/query.html'
    );
});

test('buildHupijiaoHash ignores empty fields and the hash/sign keys', () => {
    const payload = {
        appid: 'demo-appid',
        trade_order_id: 'HJ_ORDER_1',
        total_fee: '8.80',
        title: '测试订单',
        hash: 'ignore-me',
        sign: 'ignore-me-too',
        attach: ''
    };

    const hash = buildHupijiaoHash(payload, 'demo-secret');
    assert.equal(hash.length, 32);
    assert.deepEqual(
        verifyHupijiaoHash({
            ...payload,
            hash
        }, 'demo-secret'),
        {
            valid: true,
            expectedHash: hash,
            receivedHash: hash
        }
    );
});

test('buildHupijiaoTradeOrderId stays within the official 32-char limit', () => {
    const tradeOrderId = buildHupijiaoTradeOrderId('PCS_HUPIJIAO_1742709999999_AB12CD34');
    assert.match(tradeOrderId, /^HJ_[A-Z0-9]{26}$/);
    assert.ok(tradeOrderId.length <= 32);
});

test('sanitizeHupijiaoTitle strips forbidden percent signs and emoji', () => {
    assert.equal(
        sanitizeHupijiaoTitle('套餐 100% 🚀'),
        '套餐 100'
    );
});

test('buildHupijiaoPaymentPayload matches the official request fields', () => {
    const config = normalizeHupijiaoConfig({
        channelConfig: {
            merchant_id: 'appid-123',
            gateway_url: 'https://api.xunhupay.com/payment/do.html',
            notify_url: 'https://www.zaoyoe.com/api/payments/hupijiao/webhook',
            return_url: 'https://www.zaoyoe.com/wallet'
        },
        secretValues: {
            hupijiao_secret_key: 'secret-123'
        }
    });

    const payload = buildHupijiaoPaymentPayload({
        config,
        tradeOrderId: 'HJ_ORDER_1',
        amount: 9.9,
        title: '测试支付 100%',
        attach: {
            checkout_session_key: 'PCS_HJ_1'
        },
        now: 1_742_710_999_000
    });

    assert.equal(payload.version, '1.1');
    assert.equal(payload.appid, 'appid-123');
    assert.equal(payload.trade_order_id, 'HJ_ORDER_1');
    assert.equal(payload.total_fee, '9.90');
    assert.equal(payload.notify_url, 'https://www.zaoyoe.com/api/payments/hupijiao/webhook');
    assert.equal(payload.return_url, 'https://www.zaoyoe.com/wallet');
    assert.match(payload.attach, /checkout_session_key/);
    assert.equal(payload.hash, buildHupijiaoHash(payload, 'secret-123'));
});

test('buildHupijiaoQueryPayload and refund payload follow the documented field names', () => {
    const config = normalizeHupijiaoConfig({
        channelConfig: {
            merchant_id: 'appid-123',
            notify_url: 'https://www.zaoyoe.com/api/payments/hupijiao/webhook'
        },
        secretValues: {
            hupijiao_secret_key: 'secret-123'
        }
    });

    const queryPayload = buildHupijiaoQueryPayload({
        config,
        tradeOrderId: 'HJ_ORDER_1',
        now: 1_742_710_999_000
    });
    assert.equal(queryPayload.out_trade_order, 'HJ_ORDER_1');
    assert.equal(queryPayload.appid, 'appid-123');

    const refundPayload = buildHupijiaoRefundPayload({
        config,
        tradeOrderId: 'HJ_ORDER_1',
        reason: '重复下单',
        now: 1_742_710_999_000
    });
    assert.equal(refundPayload.trade_order_id, 'HJ_ORDER_1');
    assert.equal(refundPayload.reason, '重复下单');
});

test('createHupijiaoPayment verifies the response hash from the gateway', async () => {
    const options = {
        channelConfig: {
            merchant_id: 'appid-123',
            gateway_url: 'https://api.xunhupay.com/payment/do.html',
            notify_url: 'https://www.zaoyoe.com/api/payments/hupijiao/webhook',
            return_url: 'https://www.zaoyoe.com/wallet'
        },
        secretValues: {
            hupijiao_secret_key: 'secret-123'
        },
        tradeOrderId: 'HJ_ORDER_1',
        amount: 9.9,
        title: '测试支付',
        now: 1_742_710_999_000
    };

    const result = await createHupijiaoPayment(options, {
        fetchImpl: async (url, request) => {
            assert.equal(url, 'https://api.xunhupay.com/payment/do.html');
            assert.match(String(request.body || ''), /trade_order_id=HJ_ORDER_1/);

            const responsePayload = {
                openid: '202603230001',
                url: 'https://pay.example.com/checkout?id=123',
                url_qrcode: 'https://pay.example.com/qrcode?id=123',
                errcode: 0,
                errmsg: 'success!'
            };
            responsePayload.hash = buildHupijiaoHash(responsePayload, 'secret-123');

            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                async text() {
                    return JSON.stringify(responsePayload);
                }
            };
        }
    });

    assert.equal(result.response.data.url, 'https://pay.example.com/checkout?id=123');
    assert.equal(result.verification.valid, true);
});
