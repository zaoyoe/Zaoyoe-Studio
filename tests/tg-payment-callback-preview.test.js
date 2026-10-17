'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { webhookUrl } = require('../server/tg/payment-urls');
const { createTgLocalPaymentRelay } = require('../scripts/tg-local-payment-relay');
const { createTgPaymentGateway } = require('../server/tg/payment-gateway');
const PREVIEW = { APP_ENV: 'preview', NODE_ENV: 'development', LOCAL_PREVIEW_HOST: '127.0.0.1', TG_PREVIEW_PAYMENT_WEBHOOK_ORIGIN: 'https://tg-local-callback.trycloudflare.com' };

test('callback overrides work only in explicit loopback preview; production keeps canonical callbacks', () => {
    for (const provider of ['zpay', 'nowpayments']) {
        assert.equal(webhookUrl(provider, {}), `https://tg.fatherkey.com/api/tg/purchase/webhooks/${provider}`);
        assert.equal(webhookUrl(provider, PREVIEW), `${PREVIEW.TG_PREVIEW_PAYMENT_WEBHOOK_ORIGIN}/api/tg/purchase/webhooks/${provider}`);
        for (const markers of [{ APP_ENV: 'production' }, { NODE_ENV: 'production' }, { VERCEL_ENV: 'production' }, { DEPLOYMENT_TIER: 'production' }, { RAILWAY_ENVIRONMENT_NAME: 'production' }]) {
            assert.equal(webhookUrl(provider, { ...PREVIEW, ...markers }), `https://tg.fatherkey.com/api/tg/purchase/webhooks/${provider}`);
        }
        for (const invalid of ['http://tg-local-callback.trycloudflare.com', 'https://user:secret@tg-local-callback.trycloudflare.com',
            'https://tg-local-callback.trycloudflare.com/path', 'https://tg-local-callback.trycloudflare.com/?x=1',
            'https://tg-local-callback.trycloudflare.com/#x', 'https://tg-local-callback.trycloudflare.com:8443', 'https://evil.example']) {
            assert.throws(() => webhookUrl(provider, { ...PREVIEW, TG_PREVIEW_PAYMENT_WEBHOOK_ORIGIN: invalid }));
        }
        assert.throws(() => webhookUrl(provider, { ...PREVIEW, LOCAL_PREVIEW_HOST: '0.0.0.0' }));
        assert.throws(() => webhookUrl(provider, { ...PREVIEW, APP_ENV: '' }));
    }
});

test('both provider payment requests use the configured local webhook without changing canonical return URLs', async () => {
    const env = { ...PREVIEW, TG_PURCHASE_CHANNELS: 'alipay,usdt_bep20', TG_PURCHASE_ZPAY_PID: '1234',
        TG_PURCHASE_ZPAY_KEY: 'tg-test-zpay-key-0123456789', TG_PURCHASE_NOWPAYMENTS_API_KEY: 'tg-test-nowpayments-api-0123456789',
        TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: 'tg-test-nowpayments-ipn-0123456789', TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '0.15' };
    const order = { order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', product_family: 'telegram_stars', stars_quantity: 100,
        currency: 'CNY', total_minor: 10000, payment_expires_at: '2026-10-17T00:10:00Z' };
    const sent = [];
    const gateway = createTgPaymentGateway({ env, fetchImpl: async (url, options) => {
        sent.push({ url, body: options.body });
        const body = url.includes('zpay') ? { code: 1, payurl: 'https://qr.alipay.com/test-payment', trade_no: 'test-trade' }
            : { payment_id: '123456', order_id: order.order_no, payment_status: 'waiting', pay_currency: 'usdtton', price_currency: 'usdtton',
                pay_amount: '15', price_amount: '15', pay_address: 'EQ' + 'a'.repeat(46), expiration_estimate_date: '2026-10-17T00:05:00Z' };
        return { ok: true, text: async () => JSON.stringify(body) };
    } });
    await gateway.createPayment({ order: { ...order, payment_channel: 'alipay', payment_provider: 'zpay', payment_merchant_id: '1234' } });
    const zpay = new URLSearchParams(sent[0].body);
    assert.equal(zpay.get('notify_url'), webhookUrl('zpay', env));
    assert.equal(zpay.get('return_url'), `https://tg.fatherkey.com/?purchase_order=${order.order_no}`);
    const { createTgNowpaymentsGateway } = require('../server/tg/nowpayments-gateway');
    const nowpayments = createTgNowpaymentsGateway({ env, now: () => Date.parse('2026-10-17T00:00:00Z'), fetchImpl: async (url, options) => {
        sent.push({ url, body: options.body });
        return { ok: true, text: async () => JSON.stringify({ payment_id: '123456', order_id: order.order_no, payment_status: 'waiting',
            pay_currency: 'usdtton', price_currency: 'usdtton', pay_amount: '15', price_amount: '15', pay_address: 'EQ' + 'a'.repeat(46), expiration_estimate_date: '2026-10-17T00:05:00Z' }) };
    } });
    await nowpayments.createPayment({ order: { ...order, payment_expires_at: '2026-10-17T00:10:00Z', payment_channel: 'usdt_bep20',
        payment_provider: 'nowpayments', payment_merchant_id: nowpayments.identity().merchant_id }, payCurrency: 'usdtton' });
    assert.equal(JSON.parse(sent[1].body).ipn_callback_url, webhookUrl('nowpayments', env));
});

test('local relay forwards exact signed bytes and blocks pages, admin routes, router overrides and oversized requests', async t => {
    const received = [];
    const upstream = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c);
        received.push({ url: req.url, signature: req.headers['x-nowpayments-sig'], body: Buffer.concat(chunks).toString() }); res.end('success'); });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const relay = createTgLocalPaymentRelay({ targetPort: upstream.address().port });
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    t.after(() => { relay.closeAllConnections(); relay.close(); upstream.closeAllConnections(); upstream.close(); });
    const base = `http://127.0.0.1:${relay.address().port}`;
    const raw = '{"pay_amount":1.123456789012345678}';
    const accepted = await fetch(`${base}/api/tg/purchase/webhooks/nowpayments`, { method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', 'x-nowpayments-sig': 'test-signature' } });
    assert.equal(accepted.status, 200); assert.equal(await accepted.text(), 'success');
    assert.deepEqual(received[0], { url: '/api/tg/purchase/webhooks/nowpayments', signature: 'test-signature', body: raw });
    for (const [path, status] of [['/tg', 404], ['/tg-admin', 404], ['/api/admin/tg/products', 404],
        ['/api/tg/purchase/orders', 404], ['/api/tg/purchase/webhooks/zpay?scope=admin', 400], ['/api/tg/purchase/webhooks/zpay?route=catalog', 400]]) {
        const rejected = await fetch(base + path); assert.equal(rejected.status, status, path); await rejected.text();
    }
    const oversized = await fetch(`${base}/api/tg/purchase/webhooks/zpay`, { method: 'POST', body: 'x'.repeat(16385) });
    assert.equal(oversized.status, 413); await oversized.text();
    assert.equal(received.length, 1);
});

test('preview callback preflight rejects expired tunnels and requires the live relay challenge', async () => {
    const check = async (reply, ok = true) => {
        const gateway = createTgPaymentGateway({ env: PREVIEW, fetchImpl: async url => {
            const target = new URL(url); assert.equal(target.pathname, '/_tg-payment-health');
            return { ok, text: async () => typeof reply === 'function' ? JSON.stringify(reply(target.searchParams.get('challenge'))) : reply };
        } });
        return gateway.assertCallbackReady();
    };
    await check(challenge => ({ service: 'tg-local-payment-relay', status: 'ok', challenge }));
    for (const reply of ['<html>Cloudflare tunnel offline</html>', '{}', JSON.stringify({ service: 'tg-local-payment-relay', status: 'ok', challenge: 'stale' })]) {
        await assert.rejects(check(reply), error => error.code === 'tg_payment_callback_unavailable');
    }
    await assert.rejects(check('{}', false));
    let calls = 0;
    await createTgPaymentGateway({ env: { ...PREVIEW, NODE_ENV: 'production' }, fetchImpl: async () => { calls++; } }).assertCallbackReady();
    assert.equal(calls, 0);
});

test('relay health probes check the actual preview but expose no admin or environment data', async t => {
    let healthy = true;
    const upstream = http.createServer((req, res) => {
        assert.equal(req.url, '/healthz');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: healthy ? 'ok' : 'failed', service: 'local-preview-server', secret: 'never-expose' }));
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const relay = createTgLocalPaymentRelay({ targetPort: upstream.address().port });
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    t.after(() => { relay.closeAllConnections(); relay.close(); upstream.closeAllConnections(); upstream.close(); });
    const url = `http://127.0.0.1:${relay.address().port}/_tg-payment-health?challenge=${'a'.repeat(32)}`;
    const valid = await fetch(url); assert.equal(valid.status, 200);
    const data = await valid.json(); assert.deepEqual(data, { service: 'tg-local-payment-relay', status: 'ok', challenge: 'a'.repeat(32) });
    assert.ok(!JSON.stringify(data).includes('never-expose'));
    const override = await fetch(url + '&scope=admin'); assert.equal(override.status, 400); await override.text();
    healthy = false;
    const failed = await fetch(url); assert.equal(failed.status, 503); await failed.text();
});
