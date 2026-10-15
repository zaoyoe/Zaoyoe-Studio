'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const adminModulePath = require.resolve('../api/_lib/admin');
const cachedAdminModule = require.cache[adminModulePath];
require.cache[adminModulePath] = { id: adminModulePath, filename: adminModulePath, loaded: true, exports: {} };
const { createTgHandlers } = require('../server/api-handlers/public/tg');
const { createTgPurchaseHandlers } = require('../server/api-handlers/public/tg-purchase');
const createProductsHandler = require('../server/api-handlers/admin/tg/products').createProductsHandler;
const createPurchasesHandler = require('../server/api-handlers/admin/tg/purchases').createPurchasesHandler;
if (cachedAdminModule) require.cache[adminModulePath] = cachedAdminModule;
else delete require.cache[adminModulePath];

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const QUOTE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const TOKEN = 'a'.repeat(32);
const KEY = 'tg-purchase-idempotency-001';
const ENV = { TG_PURCHASE_ENABLED: 'true', TG_PURCHASE_ZPAY_PID: '7654321', TG_PURCHASE_ZPAY_KEY: 'test-independent-tg-key-00000001', TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com' };
const PRODUCT_ROWS = [
    { product_key: 'premium_3', product_family: 'telegram_premium', term_months: 3, price_minor: 12999, unit_price_micros: null, enabled: true, currency: 'CNY', price_version: 2, min_stars: 50, max_stars: 1000000 },
    { product_key: 'premium_6', product_family: 'telegram_premium', term_months: 6, price_minor: null, unit_price_micros: null, enabled: false, currency: 'CNY', price_version: 1, min_stars: 50, max_stars: 1000000 },
    { product_key: 'premium_12', product_family: 'telegram_premium', term_months: 12, price_minor: null, unit_price_micros: null, enabled: false, currency: 'CNY', price_version: 1, min_stars: 50, max_stars: 1000000 },
    { product_key: 'stars', product_family: 'telegram_stars', term_months: null, price_minor: null, unit_price_micros: 12345, enabled: true, currency: 'CNY', price_version: 3, min_stars: 50, max_stars: 1000000 }
];
const PRODUCT = PRODUCT_ROWS[3];
const ORDER = {
    id: UUID, order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', quote_id: QUOTE_ID, product_family: 'telegram_stars', term_months: null,
    stars_quantity: 100, telegram_username: 'telegram_user', currency: 'CNY', total_minor: 124,
    price_version: 3, payment_channel: 'alipay', payment_provider: 'zpay', payment_merchant_id: '7654321',
    payment_status: 'awaiting_payment', checkout_url: null, provider_trade_no: null, payment_expires_at: '2026-10-15T00:15:00Z',
    fulfillment_status: 'not_started', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z'
};
function response() {
    return { headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; }, end(value) { this.text = value; try { this.body = JSON.parse(value); } catch (_) { this.body = value; } } };
}
async function call(handler, req = {}) {
    const res = response();
    await handler({ method: 'GET', url: '/', headers: {}, ...req }, res);
    return res;
}
function security() {
    return { resolveClientIp: () => '192.0.2.10', _private: { isProductionLikeRuntime: () => true }, applyRateLimitHeaders() {}, takeRateLimitToken: async () => ({ allowed: true }) };
}
function gateway(overrides = {}) {
    return { channels: () => [{ id: 'alipay', label: '支付宝' }, { id: 'wxpay', label: '微信支付' }], identity: () => ({ provider: 'zpay', merchant_id: '7654321' }), createPayment: async () => ({ checkout_url: 'https://pay.example/checkout', provider_trade_no: 'ZP-REMOTE-123' }), verifyWebhook: () => ({ order_no: ORDER.order_no, provider: 'zpay', merchant_id: '7654321', provider_trade_no: 'ZP-REMOTE-123', payment_channel: 'alipay', amount_minor: 124, currency: 'CNY', verified_payload: { verified_by: 'signed_notify', event_status: 'paid' } }), ...overrides };
}
function stubAdmin(supabase, overrides = {}) {
    return { getOptionalSupabaseAdmin: () => supabase, requireAdmin: async () => ({ supabase, user: { id: UUID }, isSuperAdmin: true }), parseJsonBody: async (req) => req.body, sendJson(res, status, data) { res.status(status).end(JSON.stringify(data)); }, writeAdminAuditLog: async () => {}, ...overrides };
}
function dbQuery(data, methods = {}) {
    const calls = [];
    const query = {
        select(value, options) { calls.push(['select', value, options]); return this; },
        order(...args) { calls.push(['order', ...args]); return this; },
        range(...args) { calls.push(['range', ...args]); return Promise.resolve({ data, error: null, count: data.length }); },
        then(resolve, reject) { return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject); },
        ...methods
    };
    return { query, calls };
}
function purchaseHandlers(rpc, overrides = {}) {
    return createTgPurchaseHandlers({ admin: stubAdmin({ rpc }), env: ENV, requestSecurity: security(), gateway: gateway(), leaseTokenFactory: () => UUID, ...overrides });
}
function requestQuote() { return { product_id: 'stars', username: '@Telegram_User', stars_quantity: 100 }; }
function requestOrder(changes = {}) { return { quote_id: QUOTE_ID, product_id: 'stars', username: 'telegram_user', stars_quantity: 100, expected_total_minor: 124, price_version: 3, channel: 'alipay', status_token: TOKEN, idempotency_key: KEY, ...changes }; }

test('catalog and admin pricing use the migration table and exact current columns', async () => {
    const calls = [];
    const supabase = { from(table) {
        calls.push(['from', table]);
        const { query } = dbQuery(PRODUCT_ROWS);
        const originalSelect = query.select;
        query.select = function (fields, options) { calls.push(['fields', fields]); return originalSelect.call(this, fields, options); };
        return query;
    } };
    const publicHandler = createTgHandlers({ admin: stubAdmin(supabase), env: ENV, requestSecurity: security() });
    const catalog = await call(publicHandler.catalog);
    assert.equal(catalog.statusCode, 200);
    assert.equal(calls[0][1], 'tg_purchase_products');
    assert.match(calls[1][1], /\benabled\b/);
    assert.match(calls[1][1], /\bprice_version\b/);
    assert.doesNotMatch(calls[1][1], /sale_enabled|\bversion\b/);
    assert.equal(catalog.body.purchase_enabled, true);
    assert.equal(catalog.body.sale_products.find((row) => row.id === 'premium_3').price_minor, 12999);
    assert.equal(catalog.body.sale_products.find((row) => row.id === 'stars').min_stars, 50);

    const adminCalls = [];
    const adminSupabase = { from(table) {
        adminCalls.push(['from', table]);
        const { query } = dbQuery(PRODUCT_ROWS);
        const originalSelect = query.select;
        query.select = function (fields, options) { adminCalls.push(['fields', fields]); return originalSelect.call(this, fields, options); };
        return query;
    } };
    const adminProducts = await call(createProductsHandler({ admin: stubAdmin(adminSupabase), env: ENV }));
    assert.equal(adminProducts.statusCode, 200);
    assert.equal(adminCalls[0][1], 'tg_purchase_products');
    assert.match(adminCalls[1][1], /price_version/);
    assert.match(adminCalls[1][1], /min_stars/);
    assert.match(adminCalls[1][1], /max_stars/);

    const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261015_tg_purchase_domain.sql'), 'utf8');
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.tg_purchase_products\s*\([\s\S]*?\benabled BOOLEAN\b[\s\S]*?\bprice_version BIGINT\b/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_tg_update_price\s*\(\s*p_product_key TEXT,\s*p_price_minor BIGINT,\s*p_unit_price_micros BIGINT,\s*p_sale_enabled BOOLEAN,\s*p_actor_id UUID,\s*p_expected_version BIGINT/s);
});

test('disabled nullable products are valid catalog rows while malformed and unsafe prices fail closed', async () => {
    const { safeProduct } = require('../server/tg/products');
    assert.ok(safeProduct({ ...PRODUCT_ROWS[1] }));
    for (const row of [
        { ...PRODUCT, enabled: true, unit_price_micros: null },
        { ...PRODUCT, price_version: 0 },
        { ...PRODUCT, unit_price_micros: 1.5 },
        { ...PRODUCT, unit_price_micros: 1000000001 },
        { ...PRODUCT, min_stars: 49 },
        { ...PRODUCT, currency: 'USD' },
        { ...PRODUCT, product_family: 'telegram_premium' }
    ]) assert.equal(safeProduct(row), null);
});

test('admin price update binds optimistic version to actual RPC contract and handles conflicts', async () => {
    const calls = [];
    let result = { data: { success: true, price: { ...PRODUCT, enabled: true, price_version: 4, unit_price_micros: 12000 } } };
    const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return result; } };
    const handler = createProductsHandler({ admin: stubAdmin(supabase), env: ENV });
    const accepted = await call(handler, { method: 'POST', body: { product_id: 'stars', enabled: true, unit_price_micros: 12000, expected_price_version: 3 }, headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' } });
    assert.equal(accepted.statusCode, 200);
    assert.equal(calls[0].name, 'fn_tg_update_price');
    assert.deepEqual(calls[0].args, { p_product_key: 'stars', p_price_minor: null, p_unit_price_micros: 12000, p_sale_enabled: true, p_actor_id: UUID, p_expected_version: 3 });
    result = { data: { success: false, code: 'version_conflict' } };
    const conflict = await call(handler, { method: 'POST', body: { product_id: 'stars', enabled: false, expected_price_version: 3 }, headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' } });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, 'price_version_conflict');
    assert.equal(calls.length, 2);
});

test('purchase quote validates product mapping and preserves the immutable SQL quote snapshot', async () => {
    const calls = [];
    const handlers = purchaseHandlers(async (name, args) => {
        calls.push({ name, args });
        return { data: { success: true, quote: { quote_id: QUOTE_ID, product_family: 'telegram_stars', term_months: null, stars_quantity: 100, username: 'telegram_user', currency: 'CNY', total_minor: 124, price_version: 3, expires_at: '2026-10-15T00:10:00Z' } } };
    });
    const invalid = await call(handlers.quote, { method: 'POST', body: { ...requestQuote(), product_id: 'premium_3', stars_quantity: 100 } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(calls.length, 0);
    const quoted = await call(handlers.quote, { method: 'POST', body: requestQuote() });
    assert.equal(quoted.statusCode, 200);
    assert.deepEqual(calls[0], { name: 'fn_tg_purchase_quote', args: { p_product_family: 'telegram_stars', p_term_months: null, p_stars_quantity: 100, p_username: 'telegram_user' } });
    assert.equal(quoted.body.quote.total_minor, 124);
    assert.equal(quoted.body.quote.price_version, 3);
});

test('checkout is created once after claim, binding quote, merchant, channel and idempotency hashes', async () => {
    const calls = [];
    let checkoutCalls = 0;
    const checkout = gateway({ createPayment: async () => { checkoutCalls++; return { checkout_url: 'https://pay.example/checkout', provider_trade_no: 'ZP-REMOTE-123' }; } });
    const rpc = async (name, args) => {
        calls.push({ name, args });
        if (name === 'fn_tg_create_purchase') return { data: { success: true, existing: false, order: ORDER } };
        if (name === 'fn_tg_claim_purchase_checkout') return { data: { success: true, action: 'create', order: { ...ORDER, payment_status: 'checkout_creating' } } };
        if (name === 'fn_tg_save_purchase_checkout') return { data: { success: true, order: { ...ORDER, checkout_url: 'https://pay.example/checkout', provider_trade_no: 'ZP-REMOTE-123' } } };
        throw new Error(`unexpected RPC ${name}`);
    };
    const handlers = createTgPurchaseHandlers({ admin: stubAdmin({ rpc }), env: ENV, requestSecurity: security(), gateway: checkout, leaseTokenFactory: () => UUID });
    const res = await call(handlers.orders, { method: 'POST', body: requestOrder(), headers: { 'idempotency-key': KEY } });
    assert.equal(res.statusCode, 200);
    assert.equal(checkoutCalls, 1);
    assert.deepEqual(calls.map((item) => item.name), ['fn_tg_create_purchase', 'fn_tg_claim_purchase_checkout', 'fn_tg_save_purchase_checkout']);
    assert.equal(calls[0].args.p_quote_id, QUOTE_ID);
    assert.equal(calls[0].args.p_expected_product_key, 'stars');
    assert.equal(calls[0].args.p_expected_username, 'telegram_user');
    assert.equal(calls[0].args.p_expected_total_minor, 124);
    assert.equal(calls[0].args.p_expected_price_version, 3);
    assert.equal(calls[0].args.p_expected_stars_quantity, 100);
    assert.equal(calls[0].args.p_payment_merchant_id, '7654321');
    assert.equal(calls[0].args.p_payment_channel, 'alipay');
    assert.match(calls[0].args.p_status_token_hash, /^[a-f0-9]{64}$/);
    assert.match(calls[0].args.p_idempotency_key_hash, /^[a-f0-9]{64}$/);
    assert.equal(calls[1].args.p_purchase_id, UUID);
    assert.equal(res.body.order.checkout_url, 'https://pay.example/checkout');
    assert.equal(res.body.status_token, TOKEN);
    assert.equal(JSON.stringify(calls).includes(TOKEN), false);
    assert.equal(JSON.stringify(calls).includes(KEY), false);
});

test('order creation rejects malformed client quote bindings before creating an order', async () => {
    const cases = [
        { expected_total_minor: 0 },
        { expected_total_minor: 124.5 },
        { price_version: 0 },
        { price_version: 3.5 },
        { product_id: 'premium_3' },
        { product_id: '__proto__' },
        { username: 'bad username' }
    ];
    for (const change of cases) {
        let rpcCalls = 0;
        const handlers = purchaseHandlers(async () => { rpcCalls++; return { data: { success: true, order: ORDER } }; });
        const result = await call(handlers.orders, { method: 'POST', body: requestOrder(change) });
        assert.equal(result.statusCode, 400, JSON.stringify(change));
        assert.equal(rpcCalls, 0, JSON.stringify(change));
    }
});

test('order response must match the full client quote binding before checkout creation', async () => {
    for (const change of [
        { total_minor: 125 }, { telegram_username: 'other_user' }, { price_version: 4 },
        { stars_quantity: 101 }, { product_family: 'telegram_premium', term_months: 3, stars_quantity: null }
    ]) {
        let checkoutCalls = 0;
        const handlers = purchaseHandlers(async (name) => {
            if (name === 'fn_tg_create_purchase') return { data: { success: true, existing: false, order: { ...ORDER, ...change } } };
            if (name === 'fn_tg_claim_purchase_checkout') throw new Error('mismatched order must not be claimed');
            throw new Error(name);
        }, { gateway: gateway({ createPayment: async () => { checkoutCalls++; } }) });
        const result = await call(handlers.orders, { method: 'POST', body: requestOrder() });
        assert.equal(result.statusCode, 503, JSON.stringify(change));
        assert.equal(checkoutCalls, 0);
    }
});

test('database quote conflicts are returned safely without claiming a checkout', async () => {
    const calls = [];
    const handlers = purchaseHandlers(async (name, args) => {
        calls.push({ name, args });
        return { data: { success: false, code: 'quote_mismatch' } };
    });
    const result = await call(handlers.orders, { method: 'POST', body: requestOrder({ username: 'other_user', stars_quantity: 101 }) });
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.code, 'quote_mismatch');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_expected_username, 'other_user');
    assert.equal(calls[0].args.p_expected_stars_quantity, 101);
});

test('busy or replayed checkout never creates a second upstream payment', async () => {
    for (const [existing, status] of [[false, 'checkout_creating'], [true, 'awaiting_payment']]) {
        let checkoutCalls = 0;
        const rpcCalls = [];
        const resultOrder = { ...ORDER, payment_status: status, checkout_url: status === 'awaiting_payment' ? 'https://pay.example/existing' : null };
        const rpc = async (name) => {
            rpcCalls.push(name);
            if (name === 'fn_tg_create_purchase') return { data: { success: true, existing, order: resultOrder } };
            if (name === 'fn_tg_claim_purchase_checkout') return { data: { success: false, action: 'busy', order: resultOrder } };
            throw new Error(name);
        };
        const handlers = createTgPurchaseHandlers({ admin: stubAdmin({ rpc }), env: ENV, requestSecurity: security(), gateway: gateway({ createPayment: async () => { checkoutCalls++; throw new Error('must not call'); } }) });
        const res = await call(handlers.orders, { method: 'POST', body: requestOrder() });
        assert.equal(res.statusCode, 200);
        assert.equal(checkoutCalls, 0);
        assert.equal(rpcCalls.includes('fn_tg_save_purchase_checkout'), false);
    }
});

test('ambiguous payment creation enters manual review and idempotent replay does not resubmit', async () => {
    let createCount = 0;
    let status = 'awaiting_payment';
    const rpcNames = [];
    const rpc = async (name) => {
        rpcNames.push(name);
        if (name === 'fn_tg_create_purchase') return { data: { success: true, existing: status === 'manual_review', order: { ...ORDER, payment_status: status } } };
        if (name === 'fn_tg_claim_purchase_checkout') return { data: { success: true, action: 'create', order: { ...ORDER, payment_status: 'checkout_creating' } } };
        if (name === 'fn_tg_fail_purchase_checkout') { status = 'manual_review'; return { data: { success: true } }; }
        if (name === 'fn_tg_purchase_status') return { data: { success: true, order: { ...ORDER, payment_status: status } } };
        throw new Error(name);
    };
    const handlers = createTgPurchaseHandlers({ admin: stubAdmin({ rpc }), env: ENV, requestSecurity: security(), gateway: gateway({ createPayment: async () => { createCount++; throw new Error('timeout after upstream acceptance'); } }), leaseTokenFactory: () => UUID });
    const first = await call(handlers.orders, { method: 'POST', body: requestOrder() });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.order.payment_status, 'manual_review');
    const replay = await call(handlers.orders, { method: 'POST', body: requestOrder() });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.order.payment_status, 'manual_review');
    assert.equal(createCount, 1);
    assert.equal(rpcNames.filter((name) => name === 'fn_tg_fail_purchase_checkout').length, 1);
});

test('signed webhook is acknowledged idempotently and remains active while sales are closed', async () => {
    const calls = [];
    const rpc = async (name, args) => { calls.push({ name, args }); return { data: { success: true, existing: calls.length > 1 } }; };
    const handlerGateway = gateway();
    const handlers = createTgPurchaseHandlers({ admin: stubAdmin({ rpc }), env: { ...ENV, TG_PURCHASE_ENABLED: 'false' }, requestSecurity: security(), gateway: handlerGateway });
    for (let i = 0; i < 2; i++) {
        const res = await call(handlers.webhook, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'pid=7654321&trade_status=TRADE_SUCCESS' });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'success');
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, 'fn_tg_confirm_purchase_payment');
    assert.deepEqual(calls[0].args.p_verified_payload, { verified_by: 'signed_notify', event_status: 'paid' });
});

test('malformed and duplicate callback fields never reach the payment confirmation RPC', async () => {
    let calls = 0;
    const handlers = purchaseHandlers(async () => { calls++; return { data: { success: true } }; });
    const malformed = await call(handlers.webhook, { method: 'GET', url: '/?pid=1&pid=2' });
    assert.equal(malformed.statusCode, 400);
    const oversize = await call(handlers.webhook, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `data=${'x'.repeat(17000)}` });
    assert.equal(oversize.statusCode, 400);
    assert.equal(calls, 0);
});

test('status lookup uses a header-held secret and accepts SQL payment_expires_at', async () => {
    let args;
    const handlers = purchaseHandlers(async (name, input) => { args = input; return { data: { success: true, order: { ...ORDER, checkout_url: 'https://pay.example/x' } } }; });
    const res = await call(handlers.status, { method: 'GET', url: `/?order_no=${ORDER.order_no}`, headers: { 'x-tg-status-token': TOKEN } });
    assert.equal(res.statusCode, 200);
    assert.match(args.p_status_token_hash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(res.body).includes(TOKEN), false);
    assert.equal(res.body.order.expires_at, ORDER.payment_expires_at);
    assert.equal(res.body.order.fulfillment_status, 'not_started');
    assert.equal(res.body.order.price_version, ORDER.price_version);
});

test('purchase status rejects missing or invalid price versions before returning payment links', async () => {
    for (const price_version of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const handlers = purchaseHandlers(async () => ({ data: { success: true, order: { ...ORDER, price_version, checkout_url: 'https://pay.example/x' } } }));
        const res = await call(handlers.status, { method: 'GET', url: `/?order_no=${ORDER.order_no}`, headers: { 'x-tg-status-token': TOKEN } });
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.order, undefined);
        assert.equal(JSON.stringify(res.body).includes('https://pay.example/x'), false);
    }
});

test('admin purchase listing uses the service-only stats view and exposes no payment secrets', async () => {
    const calls = [];
    const row = { order_no: ORDER.order_no, telegram_username: 'telegram_user', product_family: 'telegram_stars', term_months: null,
        stars_quantity: 100, currency: 'CNY', total_minor: 124, price_version: 3, payment_channel: 'alipay', payment_status: 'paid', fulfillment_status: 'succeeded',
        created_at: ORDER.created_at, updated_at: ORDER.updated_at, expires_at: ORDER.payment_expires_at, status_token_hash: 'secret' };
    const supabase = { from(table) {
        calls.push(['from', table]);
        const { query } = dbQuery([row]);
        const select = query.select;
        query.select = function (fields, options) { calls.push(['fields', fields]); return select.call(this, fields, options); };
        return query;
    } };
    const res = await call(createPurchasesHandler({ admin: stubAdmin(supabase) }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0][1], 'tg_purchase_order_stats');
    assert.match(calls[1][1], /fulfillment_status/);
    assert.match(calls[1][1], /price_version/);
    assert.match(calls[1][1], /expires_at/);
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
    assert.equal(res.body.purchases[0].order_no, ORDER.order_no);
});
