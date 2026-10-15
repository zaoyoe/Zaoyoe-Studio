'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildNowpaymentsIpnSignature } = require('../api/_lib/payments/nowpayments');
const { createTgPaymentGateway } = require('../server/tg/payment-gateway');
const { createTgNowpaymentsGateway, usdPriceMinor, decimalUnits, parsePaymentJson } = require('../server/tg/nowpayments-gateway');
const OFFICIAL = require('./fixtures/tg-nowpayments-official-contract.json');
const adminModulePath = require.resolve('../api/_lib/admin');
const previousAdmin = require.cache[adminModulePath];
require.cache[adminModulePath] = { id: adminModulePath, filename: adminModulePath, loaded: true, exports: {} };
const { createTgPurchaseHandlers, _private: { safeOrder } } = require('../server/api-handlers/public/tg-purchase');
if (previousAdmin) require.cache[adminModulePath] = previousAdmin; else delete require.cache[adminModulePath];
const NOW = Date.parse('2026-10-15T00:00:00.000Z');
const ENV = { TG_PURCHASE_CHANNELS: 'usdt_bep20', TG_PURCHASE_NOWPAYMENTS_API_KEY: 'tg-nowpayments-test-api-key-123456',
    TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: 'tg-nowpayments-test-ipn-secret-123456', TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '0.1536',
    TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com', TG_PURCHASE_ENABLED: 'false' };
const identity = createTgNowpaymentsGateway({ env: ENV }).identity();
const ORDER = { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', quote_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
    product_family: 'telegram_stars', term_months: null, stars_quantity: 100, telegram_username: 'telegram_user', currency: 'CNY', total_minor: 1234,
    payment_channel: 'usdt_bep20', payment_provider: 'nowpayments', payment_merchant_id: identity.merchant_id, price_version: 3,
    payment_status: 'awaiting_payment', provider_trade_no: null, payment_expires_at: '2026-10-15T00:15:00.000Z' };
const ADDRESS = `0x${'a1'.repeat(20)}`;
const PROVIDER = { payment_id: 1234567890, order_id: ORDER.order_no, payment_status: 'waiting', pay_currency: 'usdtbsc', price_currency: 'usd', price_amount: 1.90,
    pay_address: ADDRESS, pay_amount: '1.912345678912345678', expiration_estimate_date: '2026-10-15T00:10:00.000Z' };
const CHECKOUT = { payment_id: String(PROVIDER.payment_id), network: 'BSC (BEP20)', pay_currency: 'usdtbsc', price_currency: 'usd', price_amount_minor: 190,
    pay_address: ADDRESS, pay_amount: PROVIDER.pay_amount, quote_expires_at: '2026-10-15T00:05:00.000Z' };
const FINISHED = { ...PROVIDER, payment_status: 'finished', actually_paid_currency: 'usdtbsc', actually_paid: PROVIDER.pay_amount };
const SAVED = { ...ORDER, provider_trade_no: CHECKOUT.payment_id, crypto_checkout: CHECKOUT };
const json = (data) => ({ ok: true, text: async () => JSON.stringify(data) });
function paymentInput(payload, order = SAVED) { return { payload, exact: parsePaymentJson(JSON.stringify(payload)).exact, order }; }
function nowGateway(fetchImpl = async () => json(PROVIDER), changes = {}) { return createTgNowpaymentsGateway({ env: ENV, now: () => NOW, fetchImpl, ...changes }); }
function res() { return { headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key] = value; return this; }, end(value) { this.text = value; try { this.body = JSON.parse(value); } catch (_) {} } }; }
async function call(handler, req) { const response = res(); await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, ...req }, response); return response; }
function stubAdmin(db) { return { getOptionalSupabaseAdmin: () => db }; }
const security = { resolveClientIp: () => '192.0.2.1', _private: { isProductionLikeRuntime: () => false }, takeRateLimitToken: async () => ({ allowed: true }), applyRateLimitHeaders() {} };

test('USDT channel works independently of ZPay and requires explicit rate, distinct valid credentials and fixed TG origin', () => {
    assert.deepEqual(createTgPaymentGateway({ env: ENV }).channels(), [{ id: 'usdt_bep20', label: 'USDT · BSC (BEP20)' }]);
    assert.deepEqual(createTgPaymentGateway({ env: ENV }).identity('usdt_bep20'), identity);
    for (const changes of [{ TG_PURCHASE_NOWPAYMENTS_API_KEY: '' }, { TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: '' },
        { TG_PURCHASE_NOWPAYMENTS_API_KEY: `${ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY}\n` },
        { TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY }, { ADMIN_STUDIO_ACCESS_SECRET: ENV.TG_PURCHASE_NOWPAYMENTS_IPN_SECRET },
        { TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '' }, { TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '0' },
        { TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '1e-2' }, { TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '10' },
        { TG_PUBLIC_ORIGIN: 'https://evil.example' }]) assert.deepEqual(createTgPaymentGateway({ env: { ...ENV, ...changes } }).channels(), []);
    assert.match(identity.merchant_id, /^nowpayments:[0-9a-f]{64}$/);
    assert.ok(!identity.merchant_id.includes(ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY));
});

test('CNY to USD uses exact decimal ceiling and USDT comparison retains all 18 decimals', () => {
    assert.equal(usdPriceMinor(1234, '0.1536'), 190);
    assert.equal(usdPriceMinor(100, '0.14'), 14);
    assert.equal(usdPriceMinor(1, '0.00000001'), 1);
    assert.equal(usdPriceMinor(100000000, '9.99999999'), 999999999);
    assert.equal(usdPriceMinor(1234, '0.123456789'), null);
    assert.equal(decimalUnits('1.912345678912345678'), 1912345678912345678n);
    assert.equal(decimalUnits('1.912345678912345677'), 1912345678912345677n);
    assert.equal(decimalUnits('1e3'), null);
    assert.equal(decimalUnits('1.0000000000000000001'), null);
});

test('USDT create sends one fixed-rate official payment request with isolated callback and no browser amount', async () => {
    const requests = [];
    const gateway = nowGateway(async (url, options) => { requests.push({ url, options }); return json(PROVIDER); });
    const result = await gateway.createPayment({ order: ORDER });
    assert.deepEqual(result, { provider_trade_no: CHECKOUT.payment_id, crypto_checkout: CHECKOUT });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.nowpayments.io/v1/payment');
    assert.equal(requests[0].options.redirect, 'error');
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.price_amount, '1.90');
    assert.equal(payload.price_currency, 'usd');
    assert.equal(payload.pay_currency, 'usdtbsc');
    assert.equal(payload.is_fixed_rate, true);
    assert.equal(payload.is_fee_paid_by_user, true);
    assert.equal(payload.order_id, ORDER.order_no);
    assert.equal(payload.ipn_callback_url, 'https://tg.fatherkey.com/api/tg/purchase/webhooks/nowpayments');
});

test('raw numeric amount tokens retain 18 digits before BigInt comparison without changing the signature object', async () => {
    const raw = JSON.stringify(PROVIDER).replace(`"${PROVIDER.pay_amount}"`, PROVIDER.pay_amount);
    const parsed = parsePaymentJson(raw);
    assert.equal(parsed.exact.pay_amount, '1.912345678912345678');
    assert.equal(typeof parsed.data.pay_amount, 'number');
    assert.notEqual(String(parsed.data.pay_amount), parsed.exact.pay_amount);
    const checkout = await nowGateway(async () => ({ ok: true, text: async () => raw })).createPayment({ order: ORDER });
    assert.equal(checkout.crypto_checkout.pay_amount, '1.912345678912345678');
    const underpaidRaw = JSON.stringify(FINISHED).replace(`"actually_paid":"${PROVIDER.pay_amount}"`, '"actually_paid":1.912345678912345677');
    const underpaid = parsePaymentJson(underpaidRaw);
    assert.equal(await nowGateway().verifyPayment({ payload: underpaid.data, exact: underpaid.exact, order: SAVED }), null);
    assert.throws(() => parsePaymentJson('{"pay_amount":1,"pay_amount":2}'));
});

test('missing create expiry uses one official estimate refresh for the same payment and never a fabricated provider deadline', async () => {
    const calls = [];
    const gateway = nowGateway(async (url, options) => { calls.push({ url, options }); return json(calls.length === 1
        ? { ...PROVIDER, expiration_estimate_date: undefined }
        : { id: String(PROVIDER.payment_id), pay_amount: PROVIDER.pay_amount, expiration_estimate_date: '2026-10-15T00:03:00.000Z' }); });
    const payment = await gateway.createPayment({ order: ORDER });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, `https://api.nowpayments.io/v1/payment/${PROVIDER.payment_id}/update-merchant-estimate`);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(payment.crypto_checkout.quote_expires_at, '2026-10-15T00:03:00.000Z');
    let requests = 0;
    await assert.rejects(nowGateway(async () => { requests += 1; return json({ ...PROVIDER, expiration_estimate_date: undefined }); }).createPayment({ order: ORDER }));
    assert.equal(requests, 2);
    for (const wrongIdentity of [{ id: '9876543210' }, { id: String(PROVIDER.payment_id), payment_id: '9876543210' }, {}]) {
        let attempt = 0;
        await assert.rejects(nowGateway(async () => json(++attempt === 1 ? { ...PROVIDER, expiration_estimate_date: undefined }
            : { ...wrongIdentity, pay_amount: PROVIDER.pay_amount, expiration_estimate_date: '2026-10-15T00:03:00.000Z' })).createPayment({ order: ORDER }));
        assert.equal(attempt, 2);
    }
});

test('provider checkout binding rejects another order, price, currency, address or expired quote', async () => {
    for (const changes of [{ order_id: 'TGP-ZYXWVUTSRQPONMLKJIHG' }, { price_amount: '1.91' }, { price_currency: 'cny' },
        { pay_currency: 'usdttrc20' }, { payment_status: 'finished' }, { pay_address: 'invalid' }, { expiration_estimate_date: '2026-10-14T23:59:59.000Z' }, { expiration_estimate_date: undefined }, { expiration_estimate_date: 'invalid' }]) {
        await assert.rejects(nowGateway(async () => json({ ...PROVIDER, ...changes })).createPayment({ order: ORDER }), (error) => error.code === 'tg_payment_provider_unconfirmed');
    }
    const early = await nowGateway(async () => json({ ...PROVIDER, expiration_estimate_date: '2026-10-15T00:02:00.000Z' })).createPayment({ order: ORDER });
    assert.equal(early.crypto_checkout.quote_expires_at, '2026-10-15T00:02:00.000Z');
});

test('HMAC verification rejects altered signed payloads and payment confirmation independently GETs exact official payment', async () => {
    let queries = 0;
    const gateway = nowGateway(async (url, options) => { queries += 1; assert.equal(url, `https://api.nowpayments.io/v1/payment/${CHECKOUT.payment_id}`); assert.equal(options.method, 'GET'); return json(FINISHED); });
    const signature = buildNowpaymentsIpnSignature(FINISHED, ENV.TG_PURCHASE_NOWPAYMENTS_IPN_SECRET);
    assert.equal(gateway.verifySignature(FINISHED, signature), true);
    assert.equal(gateway.verifySignature({ ...FINISHED, actually_paid: '2' }, signature), false);
    assert.equal(gateway.verifySignature(FINISHED, '0'.repeat(128)), false);
    const verified = await gateway.verifyPayment(paymentInput(FINISHED));
    assert.equal(queries, 1);
    assert.equal(verified.amount_minor, ORDER.total_minor);
    assert.equal(verified.currency, 'CNY');
    assert.equal(verified.verified_payload.verified_by, 'signed_notify_and_query');
    assert.equal(verified.verified_payload.actually_paid, PROVIDER.pay_amount);
});

test('USDT cannot be paid by requested amount, insufficient actual settlement, wrong network, progress or a mismatching canonical GET', async () => {
    for (const changes of [{ actually_paid: undefined }, { actually_paid_currency: null }, { actually_paid_currency: '' }, { actually_paid_currency: 'usdttrc20' },
        { actually_paid: '1.912345678912345677' }, { payment_status: 'confirmed' }, { pay_amount: '1.9' }, { order_id: 'TGP-ZYXWVUTSRQPONMLKJIHG' }]) {
        let queried = false;
        assert.equal(await nowGateway(async () => { queried = true; return json(FINISHED); }).verifyPayment(paymentInput({ ...FINISHED, ...changes })), null);
        assert.equal(queried, false);
    }
    for (const changes of [{ payment_status: 'confirming' }, { actually_paid: '1' }, { actually_paid: undefined }, { price_amount: 2 },
        { payment_id: 9876543210 }, { pay_address: `0x${'b2'.repeat(20)}` }, { actually_paid_currency: 'usdttrc20' }, { actually_paid_currency: null }, { actually_paid_currency: '' }]) {
        assert.equal(await nowGateway(async () => json({ ...FINISHED, ...changes })).verifyPayment(paymentInput(FINISHED)), null);
    }
    assert.equal(await nowGateway().verifyPayment(paymentInput(FINISHED, { ...SAVED, crypto_checkout: null })), null);
});

test('official IPN and GET fixtures omit actual-currency while explicit fields still bind settlement to the saved USDT payment', async () => {
    assert.equal(Object.hasOwn(OFFICIAL.finished_payment, 'actually_paid_currency'), false);
    assert.equal(Object.hasOwn(OFFICIAL.ipn_payment, 'actually_paid_currency'), false);
    // Preserve the documented payload shapes and payout currency. Adapt the
    // sample's product/order/network values to this test's independent TG order.
    const binding = { payment_id: PROVIDER.payment_id, order_id: ORDER.order_no, pay_address: ADDRESS, pay_currency: 'usdtbsc', price_currency: 'usd',
        price_amount: PROVIDER.price_amount, pay_amount: PROVIDER.pay_amount, actually_paid: PROVIDER.pay_amount, payment_status: 'finished' };
    const officialGet = { ...OFFICIAL.finished_payment, ...binding };
    const officialIpn = { ...OFFICIAL.ipn_payment, ...binding };
    const gateway = nowGateway(async () => json(officialGet));
    assert.equal(gateway.verifySignature(officialIpn, buildNowpaymentsIpnSignature(officialIpn, ENV.TG_PURCHASE_NOWPAYMENTS_IPN_SECRET)), true);
    const accepted = await gateway.verifyPayment(paymentInput(officialIpn));
    assert.equal(accepted.verified_payload.actually_paid_currency, 'usdtbsc');
    assert.equal(accepted.verified_payload.actually_paid, PROVIDER.pay_amount);
    for (const field of ['actually_paid_currency', 'pay_currency']) for (const wrong of ['usdttrc20', null, '']) {
        assert.equal(await gateway.verifyPayment(paymentInput({ ...officialIpn, [field]: wrong })), null);
        assert.equal(await nowGateway(async () => json({ ...officialGet, [field]: wrong })).verifyPayment(paymentInput(officialIpn)), null);
    }
    assert.equal(await gateway.verifyPayment(paymentInput({ ...officialIpn, actually_paid: '1.912345678912345677' })), null);
    assert.equal(await nowGateway(async () => json({ ...officialGet, actually_paid: '1.912345678912345677' })).verifyPayment(paymentInput(officialIpn)), null);
});

test('USDT order response exposes an exact transfer amount and address only for a valid pending snapshot', () => {
    assert.deepEqual(safeOrder(SAVED).crypto_checkout, CHECKOUT);
    assert.equal(safeOrder({ ...SAVED, crypto_checkout: { ...CHECKOUT, pay_address: 'bad' } }), null);
    assert.equal(safeOrder({ ...SAVED, payment_channel: 'alipay' }), null);
    assert.equal(safeOrder({ ...SAVED, payment_status: 'paid' }).crypto_checkout, undefined);
});

test('USDT orders save the immutable crypto snapshot once under the checkout lease and replay never recreates it', async () => {
    const calls = []; let creates = 0;
    const customGateway = { channels: () => [{ id: 'usdt_bep20', label: 'USDT' }], identity: () => identity,
        async createPayment() { creates += 1; return { provider_trade_no: CHECKOUT.payment_id, crypto_checkout: CHECKOUT }; } };
    const rpc = async (name, args) => { calls.push({ name, args });
        if (name === 'fn_tg_create_purchase') return { data: { success: true, order: creates ? SAVED : ORDER } };
        if (name === 'fn_tg_claim_purchase_checkout') return { data: { success: true, action: 'create', order: { ...ORDER, payment_status: 'checkout_creating' } } };
        if (name === 'fn_tg_save_purchase_crypto_checkout') return { data: { success: true, order: SAVED } };
        throw new Error(name);
    };
    const handler = createTgPurchaseHandlers({ admin: stubAdmin({ rpc }), env: { ...ENV, TG_PURCHASE_ENABLED: 'true' }, requestSecurity: security, gateway: customGateway });
    const input = { product_id: 'stars', username: 'telegram_user', stars_quantity: 100, quote_id: ORDER.quote_id, expected_total_minor: ORDER.total_minor, price_version: 3,
        channel: 'usdt_bep20', status_token: 'a'.repeat(32), idempotency_key: 'tg-usdt-test-idempotency-001' };
    for (let index = 0; index < 2; index++) assert.equal((await call(handler.orders, { body: input })).statusCode, 200);
    assert.equal(creates, 1);
    assert.deepEqual(calls.find((item) => item.name === 'fn_tg_save_purchase_crypto_checkout').args.p_crypto_checkout, CHECKOUT);
    assert.ok(!calls.some((item) => item.name === 'fn_tg_save_purchase_checkout'));
});

test('USDT callback authenticates before reading orders, acknowledges progress, retries the save race, and confirms only a saved matching payment while sales closed', async () => {
    const gateway = nowGateway(async () => json(FINISHED)); let selected = 0; const rpcCalls = []; let current = { ...SAVED, crypto_checkout: null };
    const db = { from(table) { selected += 1; assert.equal(table, 'tg_purchase_orders'); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: current, error: null }; } }; },
        async rpc(name, args) { rpcCalls.push({ name, args }); return { data: { success: true } }; } };
    const handler = createTgPurchaseHandlers({ admin: stubAdmin(db), env: ENV, gateway: { ...gateway, verifyCryptoSignature: gateway.verifySignature, verifyCryptoPayment: gateway.verifyPayment } });
    const req = (payload, signature = buildNowpaymentsIpnSignature(payload, ENV.TG_PURCHASE_NOWPAYMENTS_IPN_SECRET)) => ({ headers: { 'content-type': 'application/json', 'x-nowpayments-sig': signature }, body: payload, rawBody: Buffer.from(JSON.stringify(payload)) });
    assert.equal((await call(handler.webhookNowpayments, req(FINISHED, '0'.repeat(128)))).statusCode, 401);
    assert.equal(selected, 0);
    assert.equal((await call(handler.webhookNowpayments, req(PROVIDER))).statusCode, 200);
    assert.equal(selected, 0);
    assert.equal((await call(handler.webhookNowpayments, req(FINISHED))).statusCode, 409);
    assert.equal(rpcCalls.length, 0);
    current = SAVED;
    assert.equal((await call(handler.webhookNowpayments, req(FINISHED))).statusCode, 200);
    assert.equal(rpcCalls[0].name, 'fn_tg_confirm_purchase_payment');
    assert.equal(rpcCalls[0].args.p_amount_minor, ORDER.total_minor);
    assert.equal(rpcCalls[0].args.p_verified_payload.actually_paid_currency, 'usdtbsc');
});

test('USDT migration preserves old migrations and adds immutable quote, provider binding, exact settlement and service-only RPC', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015_tg_purchase_usdt_payments.sql'), 'utf8');
    assert.match(migration, /^BEGIN;$/m); assert.match(migration, /\nCOMMIT;\s*$/);
    assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(?:shop_|wallet|payment_orders)/i);
    assert.doesNotMatch(migration, /SET enabled\s*=\s*true/i);
    for (const fragment of ["payment_provider = 'nowpayments' AND payment_channel = 'usdt_bep20'", 'TG crypto quote is immutable', 'TG crypto quote requires checkout lease',
        'fn_tg_save_purchase_crypto_checkout', "v_order.payment_provider <> 'zpay'", 'signed_notify_and_query', "p_verified_payload->>'actually_paid_currency' IS DISTINCT FROM 'usdtbsc'",
        "(p_verified_payload->>'actually_paid')::NUMERIC < (v_order.crypto_checkout->>'pay_amount')::NUMERIC", "v_order.crypto_checkout->>'quote_expires_at'",
        'FROM PUBLIC, anon, authenticated', 'TO service_role', 'payment_binding_mismatch', 'payment_received_after_expiry', 'INSERT INTO public.tg_redemption_orders']) assert.ok(migration.includes(fragment), fragment);
});
