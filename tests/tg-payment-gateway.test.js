'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildZpaySign } = require('../api/_lib/payments/zpay');
const { createTgPaymentGateway, amountMinor, decimal } = require('../server/tg/payment-gateway');

const KEY = 'independent-tg-zpay-key-0123456789';
const ENV = {
    TG_PURCHASE_ZPAY_PID: '7654321',
    TG_PURCHASE_ZPAY_KEY: KEY,
    TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com',
    TG_PURCHASE_ENABLED: 'false',
    GRAMIX_API_KEY: 'gramix-secret-is-not-the-payment-key'
};
const ORDER = {
    order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', product_family: 'telegram_stars', stars_quantity: 100,
    currency: 'CNY', total_minor: 1234, payment_channel: 'alipay', payment_provider: 'zpay', payment_merchant_id: '7654321'
};
function signed(values = {}) {
    const payload = { pid: ENV.TG_PURCHASE_ZPAY_PID, type: 'alipay', out_trade_no: ORDER.order_no,
        trade_no: 'ZP-REMOTE-123', trade_status: 'TRADE_SUCCESS', money: '12.34', sign_type: 'MD5', ...values };
    payload.sign = buildZpaySign(payload, KEY);
    return payload;
}
function response(body) { return { ok: true, text: async () => JSON.stringify(body) }; }

test('TG ZPay checkout uses an exact decimal amount and its isolated callback/return URLs', async () => {
    let request;
    const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async (url, options) => { request = { url, options }; return response({ code: 1, payurl: 'https://pay.example/checkout/123', trade_no: 'ZP-REMOTE-123' }); } });
    const result = await gateway.createPayment({ order: ORDER, clientIp: '192.0.2.1', userAgent: 'Mozilla/5.0 iPhone' });
    assert.deepEqual(result, { checkout_url: 'https://pay.example/checkout/123', provider_trade_no: 'ZP-REMOTE-123' });
    assert.equal(request.url, 'https://zpayz.cn/mapi.php');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.redirect, 'error');
    const body = new URLSearchParams(request.options.body);
    assert.equal(body.get('money'), '12.34');
    assert.equal(body.get('pid'), ENV.TG_PURCHASE_ZPAY_PID);
    assert.equal(body.get('out_trade_no'), ORDER.order_no);
    assert.equal(body.get('notify_url'), 'https://tg.fatherkey.com/api/tg/purchase/webhooks/zpay');
    assert.equal(body.get('return_url'), `https://tg.fatherkey.com/?purchase_order=${ORDER.order_no}`);
    assert.equal(body.get('device'), 'mobile');
    assert.equal(body.get('sign'), buildZpaySign(Object.fromEntries(body), KEY));
    assert.deepEqual(gateway.channels().map((item) => item.id), ['alipay', 'wxpay']);
    assert.deepEqual(gateway.identity(), { provider: 'zpay', merchant_id: '7654321' });
});

test('ZPay callback signature binds exact order, channel, amount, merchant, status and currency', () => {
    const gateway = createTgPaymentGateway({ env: ENV });
    const verified = gateway.verifyWebhook(signed());
    assert.deepEqual(verified, { order_no: ORDER.order_no, provider: 'zpay', merchant_id: ENV.TG_PURCHASE_ZPAY_PID,
        provider_trade_no: 'ZP-REMOTE-123', payment_channel: 'alipay', amount_minor: 1234, currency: 'CNY',
        verified_payload: { verified_by: 'signed_notify', event_status: 'paid' } });
    assert.equal(gateway.verifyWebhook({ ...signed(), money: '12.35' }), null);
    assert.equal(gateway.verifyWebhook({ ...signed(), out_trade_no: 'TGP-ZYXWVUTSRQPONMLKJIHG' }), null);
    assert.equal(gateway.verifyWebhook(signed({ pid: '7654322' })), null);
    assert.equal(gateway.verifyWebhook(signed({ type: 'paypal' })), null);
    assert.equal(gateway.verifyWebhook(signed({ trade_status: 'WAIT_BUYER_PAY' })), null);
    assert.equal(gateway.verifyWebhook(signed({ currency: 'USD' })), null);
    assert.equal(gateway.verifyWebhook({ ...signed(), sign: '0'.repeat(32) }), null);
});

test('amount conversion avoids floating point and rejects ambiguous values', () => {
    assert.equal(amountMinor('0.01'), 1);
    assert.equal(amountMinor('999999999999.99'), 99999999999999);
    assert.equal(amountMinor('1.2'), 120);
    for (const value of ['1.001', '-1', '01.00', '1e2', '', '0.00', '90000000000000.00']) assert.equal(amountMinor(value), null, value);
    assert.equal(decimal(1234), '12.34');
    assert.equal(decimal(100), '1.00');
});

test('invalid checkout URLs and provider responses fail without exposing provider content', async () => {
    for (const payurl of ['http://pay.example/checkout', 'https://user:pass@pay.example/x', 'https://pay.example/x#fragment', 'not a URL']) {
        const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ code: 1, payurl, trade_no: 'ZP-REMOTE-123', error: 'provider secret' }) });
        await assert.rejects(gateway.createPayment({ order: ORDER }), (error) => error.statusCode === 503 && !error.message.includes('provider secret'));
    }
    const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ code: 1, payurl: 'https://pay.example', trade_no: 'bad/format', raw: 'secret' }) });
    await assert.rejects(gateway.createPayment({ order: ORDER }), (error) => !error.message.includes('secret'));
});

test('TG payment configuration is fail closed and does not reuse application secrets', () => {
    const cases = [
        { TG_PURCHASE_ZPAY_KEY: `${KEY}\n` },
        { TG_PURCHASE_ZPAY_API_BASE_URL: 'https://zpay.example/path' },
        { TG_PURCHASE_ZPAY_API_BASE_URL: 'https://user:pass@zpay.example' },
        { TG_PUBLIC_ORIGIN: 'https://evil.example' },
        { TG_PURCHASE_CHANNELS: 'alipay,alipay' },
        { TG_PURCHASE_CHANNELS: 'alipay,,wxpay' },
        { TG_PURCHASE_ZPAY_KEY: ENV.GRAMIX_API_KEY }
    ];
    for (const changes of cases) {
        const gateway = createTgPaymentGateway({ env: { ...ENV, ...changes } });
        assert.deepEqual(gateway.channels(), [], JSON.stringify(Object.keys(changes)));
        assert.throws(() => gateway.identity());
    }
    for (const pid of ['1', '9'.repeat(32)]) assert.notDeepEqual(createTgPaymentGateway({ env: { ...ENV, TG_PURCHASE_ZPAY_PID: pid } }).channels(), []);
    for (const pid of ['', '0'.repeat(33), '123abc']) assert.deepEqual(createTgPaymentGateway({ env: { ...ENV, TG_PURCHASE_ZPAY_PID: pid } }).channels(), []);
});

test('ZPay requests the full fee-inclusive amount; a signed lower amount remains subject to SQL binding', async () => {
    let request;
    const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async (_, options) => {
        request = new URLSearchParams(options.body);
        return response({ code: 1, payurl: 'https://qr.alipay.com/example', trade_no: 'ZP-REMOTE-123' });
    } });
    await gateway.createPayment({ order: { ...ORDER, subtotal_minor: 1234, payment_fee_minor: 13, payment_fee_rate_bps: 100, total_minor: 1247 } });
    assert.equal(request.get('money'), '12.47');
    assert.equal(gateway.verifyWebhook(signed({ money: '12.34' })).amount_minor, 1234);
    assert.equal(gateway.verifyWebhook(signed({ money: '12.47' })).amount_minor, 1247);
});

test('ZPay uses the order QR payload, falls back to the cashier URL, and rejects generic downloads', async () => {
    for (const [payload, expected] of [
        [{ qrcode: 'https://qr.alipay.com/opaque-payment-token', payurl: 'https://d.alipay.com/' }, 'https://qr.alipay.com/opaque-payment-token'],
        [{ qrcode: 'https://pay.example/qr-image.png', payurl: 'https://pay.example/cashier/opaque' }, 'https://pay.example/cashier/opaque'],
        [{ qrcode: 'https://pay.example/loading.png', payurl: 'https://pay.example/cashier/opaque' }, 'https://pay.example/cashier/opaque'],
        [{ qrcode: 'https://pay.example/cashier/opaque' }, 'https://pay.example/cashier/opaque']
    ]) {
        const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ code: 1, trade_no: 'ZP-REMOTE-123', ...payload }) });
        assert.equal((await gateway.createPayment({ order: ORDER })).checkout_url, expected);
    }
    for (const payurl of ['https://d.alipay.com/', 'https://mobile.alipay.com/download/app', 'https://pay.example/', 'https://pay.example/sample/qr', 'https://pay.example/download/app']) {
        const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ code: 1, trade_no: 'ZP-REMOTE-123', payurl }) });
        await assert.rejects(gateway.createPayment({ order: ORDER }), error => error.code === 'tg_payment_provider_unconfirmed');
    }
});

test('ZPay cancellation checks the authenticated official order query with exact merchant, trade, order, channel and amount', async () => {
    const order = { ...ORDER, provider_trade_no: 'ZP-REMOTE-123' };
    const idle = { code: 1, pid: ENV.TG_PURCHASE_ZPAY_PID, trade_no: order.provider_trade_no, out_trade_no: order.order_no, type: 'alipay', money: '12.34', status: 0 };
    const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async (url, options) => {
        const target = new URL(url); assert.equal(target.origin, 'https://zpayz.cn'); assert.equal(target.pathname, '/api.php');
        assert.equal(target.searchParams.get('act'), 'order'); assert.equal(target.searchParams.get('out_trade_no'), order.order_no);
        assert.equal(target.searchParams.get('pid'), ENV.TG_PURCHASE_ZPAY_PID); assert.equal(target.searchParams.get('key'), KEY);
        assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.redirect, 'error');
        return response(idle);
    } });
    assert.equal(await gateway.canCancel({ order }), true);
    assert.equal(await createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ ...idle, status: '1' }) }).canCancel({ order }), false);
    for (const changes of [{ code: 0 }, { pid: '999' }, { trade_no: 'other' }, { out_trade_no: 'other' }, { type: 'wxpay' }, { money: '12.33' }, { status: null }, { status: 2 }]) {
        await assert.rejects(createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ ...idle, ...changes }) }).canCancel({ order }));
    }
    await assert.rejects(createTgPaymentGateway({ env: ENV, fetchImpl: async url => { throw new Error(url); } }).canCancel({ order }), error => !error.message.includes(KEY));
});

test('authenticated ZPay reads reconcile checkout aliases while binding every paid-order identity', async () => {
    const order = { ...ORDER, provider_trade_no: ORDER.order_no };
    const paid = { code: 1, pid: ENV.TG_PURCHASE_ZPAY_PID, out_trade_no: ORDER.order_no,
        trade_no: '2026101623001484951454703399', type: 'alipay', money: '12.34', status: 1 };
    let target;
    const gateway = createTgPaymentGateway({ env: ENV, fetchImpl: async url => { target = new URL(url); return response(paid); } });
    const verified = await gateway.queryPayment({ order });
    assert.equal(target.pathname, '/api.php'); assert.equal(target.searchParams.get('act'), 'order');
    assert.equal(target.searchParams.get('out_trade_no'), order.order_no);
    assert.equal(target.searchParams.get('key'), KEY);
    assert.equal(verified.provider_trade_no, paid.trade_no);
    assert.equal(verified.amount_minor, order.total_minor);
    assert.equal(verified.verified_payload.verified_by, 'authenticated_query');
    assert.equal(verified.verified_payload.checkout_trade_no, order.order_no);
    assert.equal(verified.verified_payload.provider_order_no, order.order_no);
    assert.ok(!JSON.stringify(verified).includes(KEY));
    assert.equal(await createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ ...paid, status: 0 }) }).queryPayment({ order }), null);
    for (const fields of [{ code: 0 }, { pid: 'other' }, { out_trade_no: 'TGP-ZYXWVUTSRQPONMLKJIHG' }, { type: 'wxpay' },
        { money: '12.33' }, { money: '12.35' }, { currency: 'USD' }, { status: 2 }, { status: null }, { trade_no: 'invalid/id' }]) {
        await assert.rejects(createTgPaymentGateway({ env: ENV, fetchImpl: async () => response({ ...paid, ...fields }) }).queryPayment({ order }));
    }
    await assert.rejects(gateway.queryPayment({ order: { ...order, provider_trade_no: 'an-already-bound-real-transaction' } }));
    await assert.rejects(gateway.queryPayment({ order: { ...order, payment_merchant_id: 'other' } }));
    const failing = createTgPaymentGateway({ env: ENV, fetchImpl: async url => { throw new Error(url); } });
    await assert.rejects(failing.queryPayment({ order }), error => !error.message.includes(KEY));
});
