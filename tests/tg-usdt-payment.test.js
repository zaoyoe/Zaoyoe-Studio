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
const { createTgHandlers } = require('../server/api-handlers/public/tg');
if (previousAdmin) require.cache[adminModulePath] = previousAdmin; else delete require.cache[adminModulePath];
const NOW = Date.parse('2026-10-15T00:00:00.000Z');
const ENV = { TG_PURCHASE_CHANNELS: 'usdt_bep20', TG_PURCHASE_NOWPAYMENTS_API_KEY: 'tg-nowpayments-test-api-key-123456',
    TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: 'tg-nowpayments-test-ipn-secret-123456', TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '0.1536',
    TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com', TG_PURCHASE_ENABLED: 'false' };
const identity = createTgNowpaymentsGateway({ env: ENV }).identity();
const ORDER = { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', quote_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d480',
    product_family: 'telegram_stars', term_months: null, stars_quantity: 100, telegram_username: 'telegram_user', currency: 'CNY', total_minor: 1234, subtotal_minor: 1234, payment_fee_minor: 0, payment_fee_rate_bps: 0,
    payment_channel: 'usdt_bep20', payment_provider: 'nowpayments', payment_merchant_id: identity.merchant_id, price_version: 3,
    payment_status: 'awaiting_payment', provider_trade_no: null, payment_expires_at: '2026-10-15T00:15:00.000Z' };
const ADDRESS = `0x${'a1'.repeat(20)}`;
const PROVIDER = { payment_id: 1234567890, order_id: ORDER.order_no, payment_status: 'waiting', pay_currency: 'usdtbsc', price_currency: 'usd', price_amount: 1.90,
    pay_address: ADDRESS, pay_amount: '1.912345678912345678', expiration_estimate_date: '2026-10-15T00:10:00.000Z' };
const CREATED_PROVIDER = { ...PROVIDER, price_currency: 'usdtbsc', pay_amount: '1.9' };
const CHECKOUT = { payment_id: String(PROVIDER.payment_id), network: 'BSC (BEP20)', pay_currency: 'usdtbsc', price_currency: 'usd', price_amount_minor: 190,
    pay_address: ADDRESS, pay_amount: PROVIDER.pay_amount, quote_expires_at: '2026-10-15T00:05:00.000Z' };
const FINISHED = { ...PROVIDER, payment_status: 'finished', actually_paid_currency: 'usdtbsc', actually_paid: PROVIDER.pay_amount };
const SAVED = { ...ORDER, provider_trade_no: CHECKOUT.payment_id, crypto_checkout: CHECKOUT };
const MARKET_FX = { id: '41444444-4444-4444-8444-444444444444', source: 'coingecko:tether/cny', cny_per_usdt: '6.68000000',
    usdt_per_cny: '0.14970060', source_updated_at: new Date(NOW).toISOString(), fetched_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + 300000).toISOString() };
const json = (data) => ({ ok: true, text: async () => JSON.stringify(data) });
function paymentInput(payload, order = SAVED) { return { payload, exact: parsePaymentJson(JSON.stringify(payload)).exact, order }; }
function nowGateway(fetchImpl = async () => json(PROVIDER), changes = {}) { return createTgNowpaymentsGateway({ env: ENV, now: () => NOW, fetchImpl, ...changes }); }
function res() { return { headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(key, value) { this.headers[key] = value; return this; }, end(value) { this.text = value; try { this.body = JSON.parse(value); } catch (_) {} } }; }
async function call(handler, req) { const response = res(); await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, ...req }, response); return response; }
function stubAdmin(db) {
    if (!db) return { getOptionalSupabaseAdmin: () => db };
    return { getOptionalSupabaseAdmin: () => ({ ...db, rpc: async (name, args) => name === 'fn_tg_usdt_pricing_contract' ? { data: 1 }
        : name === 'fn_tg_purchase_network_quote' ? { data: null } : db.rpc(name, args) }) };
}
const security = { resolveClientIp: () => '192.0.2.1', _private: { isProductionLikeRuntime: () => false }, takeRateLimitToken: async () => ({ allowed: true }), applyRateLimitHeaders() {} };

for (const selected of require('../api/_lib/payments/usdt-networks').NETWORKS) test(`TG ${selected.name} freezes network and Memo through create, verification and cancellation`, async () => {
    const address = selected.currency === 'usdtton' ? 'EQ' + 'a'.repeat(46)
        : selected.currency === 'usdttrc20' ? 'T' + 'a'.repeat(33) : ADDRESS;
    const provider = { ...CREATED_PROVIDER, price_currency: selected.currency, pay_currency: selected.currency, pay_address: address,
        ...(selected.currency === 'usdtton' ? { extra_id: '556677' } : {}) };
    const requests = [];
    let canonical = provider;
    const gateway = nowGateway(async (url, options) => { requests.push({ url, options }); return json(canonical); });
    const created = await gateway.createPayment({ order: ORDER, payCurrency: selected.currency });
    const sent = JSON.parse(requests[0].options.body);
    assert.equal(sent.price_currency, selected.currency); assert.equal(sent.pay_currency, selected.currency);
    assert.equal(created.crypto_checkout.network, selected.name);
    assert.equal(created.crypto_checkout.payin_extra_id, provider.extra_id);
    const order = { ...ORDER, ...created };
    assert.equal(await gateway.canCancel({ order }), true);
    canonical = { ...provider, payment_status: 'finished', actually_paid: '1.90', outcome_currency: 'btc' };
    const valid = await gateway.verifyPayment(paymentInput(canonical, order));
    assert.equal(valid.verified_payload.pay_currency, selected.currency);
    assert.equal(valid.verified_payload.payin_extra_id, provider.extra_id);
    for (const patch of [{ pay_currency: 'usdterc20' }, { actually_paid: '1.899999999999999999' },
        { extra_id: selected.currency === 'usdtton' ? 'wrong' : 'unexpected' }]) {
        assert.equal(await gateway.verifyPayment(paymentInput({ ...canonical, ...patch }, order)), null);
    }
    const paid = canonical;
    canonical = { ...paid, extra_id: 'wrong' };
    assert.equal(await gateway.verifyPayment(paymentInput(paid, order)), null, 'independent GET must match Memo too');
});

test('TG network binding rejects changed or omitted currency and a missing migration before order creation', async () => {
    for (const supplied of ['usdtbsc', undefined, 'usdtton']) for (const missing of [false, true]) {
        const calls = [];
        const db = { rpc: async name => {
            calls.push(name);
            if (name === 'fn_tg_usdt_pricing_contract') return { data: 1 };
            assert.equal(name, 'fn_tg_purchase_network_quote', 'must not create a purchase or provider payment');
            return missing ? { error: { code: 'PGRST202' } } : { data: { pay_currency: 'usdtmatic' } };
        } };
        const handler = createTgPurchaseHandlers({ env: { ...ENV, TG_PURCHASE_ENABLED: 'true' }, requestSecurity: security,
            admin: { getOptionalSupabaseAdmin: () => db }, gateway: { channels: () => [{ id: 'usdt_bep20' }] } });
        const result = await call(handler.orders, { body: { product_id: 'stars', username: 'telegram_user', stars_quantity: 100,
            quote_id: ORDER.quote_id, expected_total_minor: ORDER.total_minor, price_version: 3, channel: 'usdt_bep20',
            status_token: 'a'.repeat(32), idempotency_key: 'network-selection-test-001', ...(supplied ? { pay_currency: supplied } : {}) } });
        assert.ok(result.statusCode >= 400);
        assert.deepEqual(calls, ['fn_tg_usdt_pricing_contract', 'fn_tg_purchase_network_quote']);
    }
});

test('USDT channel works independently of ZPay and requires explicit rate, distinct valid credentials and fixed TG origin', () => {
    assert.deepEqual(createTgPaymentGateway({ env: ENV }).channels(), [{ id: 'usdt_bep20', label: 'USDT', networks: require('../api/_lib/payments/usdt-networks').NETWORKS }]);
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

test('catalog exposes the merchant USDT selling rate without credentials', async () => {
    const handler = createTgHandlers({ admin: stubAdmin(null), env: ENV });
    const result = await call(handler.catalog, { method: 'GET' });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.usdt_per_cny, '0.1536');
    assert.equal(result.body.usdt_cny_to_usd_rate, undefined);
    assert.equal(result.body.currency, 'CNY');
    assert.ok(!result.text.includes(ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY));
    assert.ok(!result.text.includes(ENV.TG_PURCHASE_NOWPAYMENTS_IPN_SECRET));
});

test('market TG quote binds the canonical FX snapshot before returning an exact USDT confirmation', async () => {
    const quote = { quote_id: ORDER.quote_id, product_family: ORDER.product_family, term_months: null, stars_quantity: 100,
        username: 'telegram_user', currency: 'CNY', subtotal_minor: 9800, payment_fee_minor: 98, payment_fee_rate_bps: 100,
        total_minor: 9898, price_version: 3, payment_channel: 'usdt_bep20', expires_at: ORDER.payment_expires_at };
    const calls = [];
    const handler = createTgPurchaseHandlers({ env: { ...ENV, TG_PURCHASE_ENABLED: 'true', PAYMENT_USDT_FX_MODE: 'market' }, requestSecurity: security,
        gateway: { channels: () => [{ id: 'usdt_bep20' }], resolveUsdtFx: async () => MARKET_FX,
            minimumPayment: async ({payCurrency}) => ({network: payCurrency, currency: 'USDT', amount: '0.09', expires_at: new Date(NOW + 60000).toISOString()}),
            quotePayment() { throw Error('must use the database-bound quote'); } },
        admin: stubAdmin({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'fn_tg_purchase_quote'
            ? { success: true, quote } : { quote_id: quote.quote_id, total_minor: 9898, usdt_pay_amount: '14.82', fx: MARKET_FX } }; } }) });
    const result = await call(handler.quote, { body: { product_id: 'stars', username: 'telegram_user', channel: 'usdt_bep20', stars_quantity: 100 } });
    assert.equal(result.statusCode, 200); assert.equal(result.body.quote.usdt_pay_amount, '14.82');
    assert.deepEqual(result.body.quote.usdt_fx, MARKET_FX);
    assert.deepEqual(calls.map(call => call.name), ['fn_tg_purchase_quote', 'fn_tg_bind_purchase_fx_quote']);
    assert.deepEqual(calls[1].args, { p_quote_id: ORDER.quote_id, p_fx_snapshot_id: MARKET_FX.id });
});

test('market TG creation uses the accepted amount after source expiry without another FX request', async () => {
    const snapshot = { ...MARKET_FX, source_updated_at: new Date(NOW - 600000).toISOString(),
        fetched_at: new Date(NOW - 600000).toISOString(), expires_at: new Date(NOW - 300000).toISOString() };
    const quoted = { quote_id: ORDER.quote_id, total_minor: ORDER.total_minor, usdt_pay_amount: '1.85', fx: snapshot };
    const requests = [];
    const gateway = nowGateway(async (url, options) => { requests.push(url); assert.equal(JSON.parse(options.body).price_amount, '1.85');
        return json({ ...CREATED_PROVIDER, price_amount: '1.85', pay_amount: '1.85' }); },
    { env: { ...ENV, PAYMENT_USDT_FX_MODE: 'market', TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '' } });
    assert.equal(gateway.ready(), true);
    const result = await gateway.createPayment({ order: ORDER, usdtQuote: quoted });
    assert.equal(result.crypto_checkout.pay_amount, '1.85'); assert.equal(requests.length, 1);
    assert.equal(result.crypto_checkout.price_amount_minor, 185);
    await assert.rejects(gateway.createPayment({ order: ORDER }));
    await assert.rejects(gateway.createPayment({ order: ORDER, usdtQuote: { ...quoted, usdt_pay_amount: '1.84' } }));
    assert.equal(requests.length, 1);
});

test('market TG order creation refuses an unbound quote before creating any purchase or provider payment', async () => {
    const calls = [];
    const handler = createTgPurchaseHandlers({ env: { ...ENV, TG_PURCHASE_ENABLED: 'true', PAYMENT_USDT_FX_MODE: 'market' }, requestSecurity: security,
        gateway: { channels: () => [{ id: 'usdt_bep20' }], identity: () => { throw Error('must not create'); } },
        admin: stubAdmin({ rpc: async name => { calls.push(name); return { data: null }; } }) });
    const result = await call(handler.orders, { body: { product_id: 'stars', username: 'telegram_user', stars_quantity: 100,
        quote_id: ORDER.quote_id, expected_total_minor: ORDER.total_minor, price_version: 3, channel: 'usdt_bep20',
        status_token: 'a'.repeat(32), idempotency_key: 'market-fx-idempotency-001' } });
    assert.equal(result.statusCode, 409); assert.equal(result.body.code, 'quote_expired');
    assert.deepEqual(calls, ['fn_tg_purchase_fx_quote']);
});

test('market catalog exposes the shared snapshot and a missing migration hides only the USDT channel', async () => {
    const timestamp = Date.now();
    const snapshot = { ...MARKET_FX, source_updated_at: new Date(timestamp).toISOString(), fetched_at: new Date(timestamp).toISOString(),
        expires_at: new Date(timestamp + 240000).toISOString() };
    for (const missing of [false, true]) {
        const env = { ...ENV, TG_PURCHASE_CHANNELS: 'alipay,usdt_bep20', TG_PURCHASE_ZPAY_PID: '12345',
            TG_PURCHASE_ZPAY_KEY: 'test-zpay-secret-only-for-unit-tests', PAYMENT_USDT_FX_MODE: 'market' };
        const admin = { getOptionalSupabaseAdmin: () => ({ rpc: async name => {
            assert.equal(name, 'fn_payment_usdt_fx_current'); return missing ? { error: { code: 'PGRST202' } } : { data: snapshot };
        } }) };
        const result = await call(createTgHandlers({ admin, env }).catalog, { method: 'GET' });
        assert.equal(result.statusCode, 200);
        assert.deepEqual(result.body.payment_channels.map(item => item.id), missing ? ['alipay'] : ['alipay', 'usdt_bep20']);
        assert.equal(result.body.usdt_per_cny, missing ? undefined : snapshot.usdt_per_cny);
        assert.equal(result.body.usdt_fx_mode, 'market');
    }
});

test('market mode still verifies and cancels historical payments using saved amounts with no FX access', async () => {
    const requests = [];
    const gateway = nowGateway(async url => { requests.push(url); return json(FINISHED); },
        { env: { ...ENV, PAYMENT_USDT_FX_MODE: 'market', TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '' } });
    assert.ok(await gateway.verifyPayment(paymentInput(FINISHED)));
    assert.deepEqual(requests, [`https://api.nowpayments.io/v1/payment/${CHECKOUT.payment_id}`]);
});

test('USDT quote returns the merchant amount and read-only minimum without any external estimate or payment', async () => {
    const calls = [];
    const quote = { quote_id: ORDER.quote_id, product_family: ORDER.product_family, term_months: null, stars_quantity: 100,
        username: 'telegram_user', currency: 'CNY', subtotal_minor: 21800, payment_fee_minor: 218, payment_fee_rate_bps: 100,
        total_minor: 22018, price_version: 3, payment_channel: 'usdt_bep20', expires_at: ORDER.payment_expires_at, usdt_pay_amount: '999.99' };
    const providerRequests = [];
    const channel = createTgPaymentGateway({ env: ENV, fetchImpl: async (url, options) => {
        providerRequests.push({ url, options });
        const query = new URL(url);
        assert.equal(query.pathname, '/v1/min-amount');
        assert.equal(options.method, 'GET');
        assert.equal(options.headers['x-api-key'], ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY);
        assert.equal(query.searchParams.get('currency_from'), 'usdtbsc');
        assert.equal(query.searchParams.has('currency_to'), false);
        assert.equal(query.searchParams.get('is_fixed_rate'), 'false');
        assert.equal(query.searchParams.get('is_fee_paid_by_user'), 'false');
        return json({ currency_from: 'usdtbsc', min_amount: 0.0869 });
    } });
    const handler = createTgPurchaseHandlers({ env: { ...ENV, TG_PURCHASE_ENABLED: 'true' }, requestSecurity: security,
        admin: stubAdmin({ rpc: async (name) => { calls.push(name); return { data: { success: true, quote } }; } }), gateway: channel });
    const result = await call(handler.quote, { body: { product_id: 'stars', username: 'telegram_user', channel: 'usdt_bep20', stars_quantity: 100 } });
    assert.equal(result.statusCode, 200); assert.equal(result.body.quote.usdt_pay_amount, '33.82');
    assert.equal(result.body.quote.usdt_estimate, undefined);
    assert.equal(result.body.quote.usdt_minimum.amount, '0.09');
    assert.equal(providerRequests.length, 1);
    assert.ok(!result.text.includes(ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY));
    assert.equal(result.body.quote.total_minor, 22018); assert.equal(result.body.quote.payment_fee_minor, 218);
    assert.deepEqual(calls, ['fn_tg_purchase_quote']);
});

test('merchant USDT selling rate can differ from the legacy USD reference rate', async () => {
    const gateway = nowGateway(async (_, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.price_amount, '1.98'); assert.equal(body.price_currency, 'usdtbsc');
        return json({ ...CREATED_PROVIDER, price_amount: '1.98', pay_amount: '1.98' });
    }, { env: { ...ENV, TG_PURCHASE_USDT_PER_CNY: '0.16' } });
    assert.equal(gateway.quoteRate(), '0.16'); assert.equal(gateway.quotePayment({ totalMinor: 1234 }), '1.98');
    assert.equal((await gateway.createPayment({ order: ORDER })).crypto_checkout.pay_amount, '1.98');
    for (const totalMinor of [undefined, null, 0, -1, 1.1, '1234', 100000001]) assert.throws(() => gateway.quotePayment({ totalMinor }));
    for (const rate of ['0', '10', '1e-2', '0.123456789', 'NaN']) assert.equal(nowGateway(undefined, { env: { ...ENV, TG_PURCHASE_USDT_PER_CNY: rate } }).ready(), false);
});

test('an unavailable merchant price cannot silently fall back to a USD value or leak provider diagnostics', async () => {
    const quote = { quote_id: ORDER.quote_id, product_family: ORDER.product_family, term_months: null, stars_quantity: 100,
        username: 'telegram_user', currency: 'CNY', subtotal_minor: 7000, payment_fee_minor: 70, payment_fee_rate_bps: 100,
        total_minor: 7070, price_version: 3, payment_channel: 'usdt_bep20', expires_at: ORDER.payment_expires_at };
    const handler = createTgPurchaseHandlers({ env: { ...ENV, TG_PURCHASE_ENABLED: 'true' }, requestSecurity: security,
        admin: stubAdmin({ rpc: async () => ({ data: { success: true, quote } }) }),
        gateway: { channels: () => [{ id: 'usdt_bep20' }], quotePayment: async () => { throw new Error(ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY); } } });
    const result = await call(handler.quote, { body: { product_id: 'stars', username: 'telegram_user', channel: 'usdt_bep20', stars_quantity: 100 } });
    assert.equal(result.statusCode, 503); assert.equal(result.body.quote, undefined);
    assert.equal(result.body.code, 'quote_unavailable'); assert.match(result.body.message, /尚未创建支付订单/);
    assert.ok(!result.text.includes(ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY));
});

test('USDT create sends one direct USDT official payment request with isolated callback and no browser amount', async () => {
    const requests = [];
    const gateway = nowGateway(async (url, options) => { requests.push({ url, options }); return json(CREATED_PROVIDER); });
    const result = await gateway.createPayment({ order: ORDER });
    assert.deepEqual(result, { provider_trade_no: CHECKOUT.payment_id, crypto_checkout: { ...CHECKOUT, price_currency: 'usdtbsc', pay_amount: '1.9', quote_expires_at: PROVIDER.expiration_estimate_date } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.nowpayments.io/v1/payment');
    assert.equal(requests[0].options.redirect, 'error');
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.price_amount, '1.90');
    assert.equal(payload.price_currency, 'usdtbsc');
    assert.equal(payload.pay_currency, 'usdtbsc');
    assert.equal(payload.pay_amount, undefined);
    assert.equal(payload.is_fixed_rate, false);
    assert.equal(payload.is_fee_paid_by_user, false);
    assert.equal(payload.order_id, ORDER.order_no);
    assert.equal(payload.ipn_callback_url, 'https://tg.fatherkey.com/api/tg/purchase/webhooks/nowpayments');
});

test('raw numeric amount tokens retain 18 digits before BigInt comparison without changing the signature object', async () => {
    const raw = JSON.stringify(PROVIDER).replace(`"${PROVIDER.pay_amount}"`, PROVIDER.pay_amount);
    const parsed = parsePaymentJson(raw);
    assert.equal(parsed.exact.pay_amount, '1.912345678912345678');
    assert.equal(typeof parsed.data.pay_amount, 'number');
    assert.notEqual(String(parsed.data.pay_amount), parsed.exact.pay_amount);
    const finishedRaw = JSON.stringify(FINISHED).replaceAll(`\"${PROVIDER.pay_amount}\"`, PROVIDER.pay_amount);
    const finished = parsePaymentJson(finishedRaw);
    const verified = await nowGateway(async () => ({ ok: true, text: async () => finishedRaw })).verifyPayment({ payload: finished.data, exact: finished.exact, order: SAVED });
    assert.equal(verified.verified_payload.actually_paid, '1.912345678912345678');
    const underpaidRaw = JSON.stringify(FINISHED).replace(`"actually_paid":"${PROVIDER.pay_amount}"`, '"actually_paid":1.912345678912345677');
    const underpaid = parsePaymentJson(underpaidRaw);
    assert.equal(await nowGateway().verifyPayment({ payload: underpaid.data, exact: underpaid.exact, order: SAVED }), null);
    assert.throws(() => parsePaymentJson('{"pay_amount":1,"pay_amount":2}'));
});

test('missing create expiry uses one official estimate refresh for the same payment and never a fabricated provider deadline', async () => {
    const calls = [];
    const gateway = nowGateway(async (url, options) => { calls.push({ url, options }); return json(calls.length === 1
        ? { ...CREATED_PROVIDER, expiration_estimate_date: undefined }
        : { id: String(PROVIDER.payment_id), pay_amount: CREATED_PROVIDER.pay_amount, expiration_estimate_date: '2026-10-15T00:03:00.000Z' }); });
    const payment = await gateway.createPayment({ order: ORDER });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, `https://api.nowpayments.io/v1/payment/${PROVIDER.payment_id}/update-merchant-estimate`);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(payment.crypto_checkout.quote_expires_at, '2026-10-15T00:03:00.000Z');
    let requests = 0;
    await assert.rejects(nowGateway(async () => { requests += 1; return json({ ...CREATED_PROVIDER, expiration_estimate_date: undefined }); }).createPayment({ order: ORDER }));
    assert.equal(requests, 2);
    for (const wrongIdentity of [{ id: '9876543210' }, { id: String(PROVIDER.payment_id), payment_id: '9876543210' }, {}]) {
        let attempt = 0;
        await assert.rejects(nowGateway(async () => json(++attempt === 1 ? { ...CREATED_PROVIDER, expiration_estimate_date: undefined }
            : { ...wrongIdentity, pay_amount: CREATED_PROVIDER.pay_amount, expiration_estimate_date: '2026-10-15T00:03:00.000Z' })).createPayment({ order: ORDER }));
        assert.equal(attempt, 2);
    }
});

test('provider checkout binding rejects another order, price, currency, address or expired quote', async () => {
    for (const changes of [{ order_id: 'TGP-ZYXWVUTSRQPONMLKJIHG' }, { price_amount: '1.91' }, { price_currency: 'cny' }, { pay_amount: '1.900000000000000001' }, { pay_amount: '1.899999999999999999' },
        { pay_currency: 'usdttrc20' }, { payment_status: 'finished' }, { pay_address: 'invalid' }, { expiration_estimate_date: '2026-10-14T23:59:59.000Z' }, { expiration_estimate_date: undefined }, { expiration_estimate_date: 'invalid' }]) {
        await assert.rejects(nowGateway(async () => json({ ...CREATED_PROVIDER, ...changes })).createPayment({ order: ORDER }), (error) => error.code === 'tg_payment_provider_unconfirmed');
    }
    const early = await nowGateway(async () => json({ ...CREATED_PROVIDER, expiration_estimate_date: '2026-10-15T00:02:00.000Z' })).createPayment({ order: ORDER });
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
    assert.deepEqual(safeOrder({ ...SAVED, payment_status: 'paid' }).crypto_payment, {
        network: 'BSC (BEP20)', pay_currency: 'usdtbsc', pay_amount: CHECKOUT.pay_amount
    });
    const historical = safeOrder({ ...SAVED, payment_status: 'expired' });
    assert.deepEqual(historical.crypto_payment, {
        network: 'BSC (BEP20)', pay_currency: 'usdtbsc', pay_amount: CHECKOUT.pay_amount
    });
    assert.equal('pay_address' in historical.crypto_payment, false);
    assert.equal('payment_id' in historical.crypto_payment, false);
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

test('USDT converts the fee-inclusive total once and underpaid finished notifications never confirm fulfillment', async () => {
    const order = { ...ORDER, subtotal_minor: 1234, payment_fee_minor: 13, payment_fee_rate_bps: 100, total_minor: 1247 };
    let sent;
    const gateway = nowGateway(async (_, options) => {
        sent = JSON.parse(options.body);
        return json({ ...CREATED_PROVIDER, price_amount: '1.92', pay_amount: '1.92' });
    });
    const payment = await gateway.createPayment({ order });
    assert.equal(sent.price_amount, '1.92'); assert.equal(sent.is_fee_paid_by_user, false);
    assert.equal(payment.crypto_checkout.price_amount_minor, 192);
    let confirmations = 0;
    const underpaid = { ...FINISHED, actually_paid: '1.9' };
    const verifying = nowGateway(async () => json(underpaid));
    const db = { from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: SAVED, error: null }; } }; },
        async rpc() { confirmations++; return { data: { success: true } }; } };
    const handler = createTgPurchaseHandlers({ admin: stubAdmin(db), env: ENV, gateway: { ...verifying,
        verifyCryptoSignature: verifying.verifySignature, verifyCryptoPayment: verifying.verifyPayment } });
    const result = await call(handler.webhookNowpayments, { rawBody: Buffer.from(JSON.stringify(underpaid)),
        headers: { 'content-type': 'application/json', 'x-nowpayments-sig': buildNowpaymentsIpnSignature(underpaid, ENV.TG_PURCHASE_NOWPAYMENTS_IPN_SECRET) } });
    assert.equal(result.statusCode, 409); assert.equal(confirmations, 0);
});

test('new USDT quotes use the real provider/order deadline without a five-minute cap or extending saved historical quotes', async () => {
    for (const [providerMinutes, orderMinutes, expectedMinutes] of [[10, 15, 10], [25, 15, 15], [2, 15, 2], [10, 1, 1]]) {
        const provider = { ...CREATED_PROVIDER, expiration_estimate_date: new Date(NOW + providerMinutes * 60000).toISOString() };
        const order = { ...ORDER, payment_expires_at: new Date(NOW + orderMinutes * 60000).toISOString() };
        const result = await nowGateway(async () => json(provider)).createPayment({ order });
        assert.equal(Date.parse(result.crypto_checkout.quote_expires_at), NOW + expectedMinutes * 60000);
    }
    assert.equal(safeOrder(SAVED).crypto_checkout.quote_expires_at, CHECKOUT.quote_expires_at, 'saved historical five-minute quote remains immutable');
});

test('USDT cancellation queries the saved payment and allows only a fully bound, explicitly zero-paid idle status', async () => {
    const idle = { ...PROVIDER, actually_paid: 0 };
    for (const payment_status of ['waiting', 'expired', 'failed']) {
        const gateway = nowGateway(async (url, options) => {
            assert.equal(url, `https://api.nowpayments.io/v1/payment/${CHECKOUT.payment_id}`);
            assert.equal(options.method, 'GET'); return json({ ...idle, payment_status });
        });
        assert.equal(await gateway.canCancel({ order: SAVED }), true);
    }
    assert.equal(await nowGateway(async () => json({ ...PROVIDER, payment_status: 'waiting', actually_paid: undefined })).canCancel({ order: SAVED }), true);
    for (const changes of [{ payment_status: 'confirming' }, { payment_status: 'confirmed' }, { payment_status: 'sending' },
        { payment_status: 'finished' }, { payment_status: 'partially_paid' }, { payment_status: 'refunded' },
        { actually_paid: '0.000000000000000001' }, { actually_paid: null }, { actually_paid: '-1' }]) {
        assert.equal(await nowGateway(async () => json({ ...idle, ...changes })).canCancel({ order: SAVED }), false);
    }
    for (const changes of [{ order_id: 'TGP-ZYXWVUTSRQPONMLKJIHG' }, { payment_id: 999 }, { pay_amount: '1.9' },
        { price_amount: '2' }, { pay_currency: 'usdttrc20' }, { price_currency: 'cny' }, { pay_address: `0x${'b'.repeat(40)}` }]) {
        await assert.rejects(nowGateway(async () => json({ ...idle, ...changes })).canCancel({ order: SAVED }));
    }
    await assert.rejects(nowGateway(async () => { throw new Error('secret upstream detail'); }).canCancel({ order: SAVED }), error => !error.message.includes('secret'));
});

test('direct USDT finished callbacks bind the saved currency, exact amount and official GET; USD legacy orders retain their own currency', async () => {
    const checkout = { ...CHECKOUT, price_currency: 'usdtbsc', pay_amount: '1.9' };
    const saved = { ...SAVED, crypto_checkout: checkout };
    const finished = { ...CREATED_PROVIDER, payment_status: 'finished', actually_paid: '1.9' };
    const gateway = nowGateway(async () => json(finished));
    const verified = await gateway.verifyPayment(paymentInput(finished, saved));
    assert.equal(verified.verified_payload.price_currency, 'usdtbsc');
    for (const changes of [{ price_currency: 'usd' }, { pay_amount: '1.900000000000000001' }, { actually_paid: '1.899999999999999999' }]) {
        assert.equal(await gateway.verifyPayment(paymentInput({ ...finished, ...changes }, saved)), null);
    }
    assert.equal(await gateway.verifyPayment(paymentInput(finished, SAVED)), null);
    assert.ok(await nowGateway(async () => json(FINISHED)).verifyPayment(paymentInput(FINISHED)));
});

test('an expiry refresh that changes the merchant amount by one atomic unit cannot create a payable checkout', async () => {
    for (const amount of ['1.900000000000000001', '1.899999999999999999']) {
        let calls = 0;
        await assert.rejects(nowGateway(async () => json(++calls === 1 ? { ...CREATED_PROVIDER, expiration_estimate_date: undefined }
            : { id: String(PROVIDER.payment_id), pay_amount: amount, expiration_estimate_date: '2026-10-15T00:03:00.000Z' })).createPayment({ order: ORDER }));
        assert.equal(calls, 2);
    }
});

test('missing, stale or unavailable native-pricing migration blocks quote and create before database mutation or provider contact', async () => {
    for (const data of [0, null, { success: true }]) for (const operation of ['quote', 'orders']) {
        const calls = [];
        const handler = createTgPurchaseHandlers({ env: { ...ENV, TG_PURCHASE_ENABLED: 'true' }, requestSecurity: security,
            admin: { getOptionalSupabaseAdmin: () => ({ rpc: async name => { calls.push(name); return { data }; } }) },
            gateway: { channels: () => [{ id: 'usdt_bep20' }], identity() { throw new Error('must not contact provider'); } } });
        const result = await call(handler[operation], { body: { product_id: 'stars', stars_quantity: 100, username: 'telegram_user', channel: 'usdt_bep20',
            expected_total_minor: 1234, price_version: 3, quote_id: ORDER.quote_id, status_token: 'a'.repeat(32), idempotency_key: 'tg-native-pricing-test-001' } });
        assert.equal(result.statusCode, 503); assert.equal(result.body.code, 'usdt_pricing_migration_required');
        assert.deepEqual(calls, ['fn_tg_usdt_pricing_contract']);
    }
});

for (const [network, raw, amount] of [['usdtbsc', 0.0869, '0.09'], ['usdtton', 0.2551, '0.26'], ['usdtmatic', 0.2324, '0.24'], ['usdttrc20', 11.9203, '11.93']]) {
    test(`TG minimum uses its own merchant and selected ${network} network`, async () => {
        const gateway = nowGateway(async (url, options) => {
            const query = new URL(url);
            assert.equal(options.method, 'GET');
            assert.equal(query.pathname, '/v1/min-amount');
            assert.equal(query.searchParams.get('currency_from'), network);
            assert.equal(options.headers['x-api-key'], ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY);
            return json({ currency_from: network, min_amount: raw });
        });
        const minimum = await gateway.minimumPayment({ payCurrency: network });
        assert.deepEqual(minimum, { network, currency: 'USDT', amount,
            checked_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 60000).toISOString() });
    });
}

test('TG unavailable minimum fails before exposing confirmation and never leaks merchant diagnostics', async () => {
    const quote = { quote_id: ORDER.quote_id, product_family: ORDER.product_family, term_months: null, stars_quantity: 100,
        username: 'telegram_user', currency: 'CNY', subtotal_minor: 7000, payment_fee_minor: 70, payment_fee_rate_bps: 100,
        total_minor: 7070, price_version: 3, payment_channel: 'usdt_bep20', expires_at: ORDER.payment_expires_at };
    const handler = createTgPurchaseHandlers({ env: { ...ENV, TG_PURCHASE_ENABLED: 'true' }, requestSecurity: security,
        admin: stubAdmin({ rpc: async () => ({ data: { success: true, quote } }) }),
        gateway: { channels: () => [{ id: 'usdt_bep20' }], quotePayment: () => '10.86',
            minimumPayment: async () => { throw Error(ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY); } } });
    const result = await call(handler.quote, { body: { product_id: 'stars', username: 'telegram_user', channel: 'usdt_bep20', stars_quantity: 100 } });
    assert.equal(result.statusCode, 503); assert.equal(result.body.quote, undefined);
    assert.equal(result.body.code, 'quote_unavailable');
    assert.ok(!result.text.includes(ENV.TG_PURCHASE_NOWPAYMENTS_API_KEY));
});
