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
    stars_quantity: 100, telegram_username: 'telegram_user', currency: 'CNY', total_minor: 126, subtotal_minor: 124, payment_fee_minor: 2, payment_fee_rate_bps: 100,
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
function requestQuote() { return { product_id: 'stars', username: '@Telegram_User', stars_quantity: 100, channel: 'alipay' }; }
function requestOrder(changes = {}) { return { quote_id: QUOTE_ID, product_id: 'stars', username: 'telegram_user', stars_quantity: 100, expected_total_minor: 126, price_version: 3, channel: 'alipay', status_token: TOKEN, idempotency_key: KEY, ...changes }; }

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
        return { data: { success: true, quote: { quote_id: QUOTE_ID, product_family: 'telegram_stars', term_months: null, stars_quantity: 100, username: 'telegram_user', currency: 'CNY', total_minor: 126, subtotal_minor: 124, payment_fee_minor: 2, payment_fee_rate_bps: 100, price_version: 3, payment_channel: 'alipay', expires_at: '2026-10-15T00:10:00Z' } } };
    });
    const invalid = await call(handlers.quote, { method: 'POST', body: { ...requestQuote(), product_id: 'premium_3', stars_quantity: 100 } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(calls.length, 0);
    const quoted = await call(handlers.quote, { method: 'POST', body: requestQuote() });
    assert.equal(quoted.statusCode, 200);
    assert.deepEqual(calls[0], { name: 'fn_tg_purchase_quote', args: { p_product_family: 'telegram_stars', p_term_months: null, p_stars_quantity: 100, p_username: 'telegram_user', p_payment_channel: 'alipay' } });
    assert.equal(quoted.body.quote.total_minor, 126);
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
    assert.equal(calls[0].args.p_expected_total_minor, 126);
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

test('paid closed purchases remain closed in public status and do not restart payment or fulfillment', async () => {
    const closedAt = '2026-10-17T06:00:00.000Z';
    const stored = { ...ORDER, payment_status: 'paid', paid_at: '2026-10-16T11:00:00Z', fulfillment_status: 'cancelled', closed_at: closedAt,
        close_note: 'private operator evidence', provider_idempotency_key: 'private-original-key' };
    const original = structuredClone(stored); const calls = [];
    const handlers = purchaseHandlers(async (name) => {
        calls.push(name); return { data: { success: true, order: stored } };
    }, { gateway: gateway({ queryPayment: async () => { throw new Error('closed paid order must not query payment'); } }) });
    const res = await call(handlers.status, { url: `/?order_no=${ORDER.order_no}`, headers: { 'x-tg-status-token': TOKEN } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order.fulfillment_status, 'closed');
    assert.equal(res.body.order.closed_at, closedAt);
    assert.equal(res.body.order.payment_status, 'paid');
    assert.equal(res.body.order.can_close, false);
    assert.deepEqual(calls, ['fn_tg_purchase_status']);
    assert.deepEqual(stored, original, 'public projection preserves payment and original submission facts');
    assert.doesNotMatch(JSON.stringify(res.body), /private operator evidence|private-original-key|provider_idempotency_key|close_note/);
});

test('admin purchase listing uses the service-only stats view and exposes no payment secrets', async () => {
    const calls = [];
    const row = { order_no: ORDER.order_no, telegram_username: 'telegram_user', product_family: 'telegram_stars', term_months: null,
        stars_quantity: 100, currency: 'CNY', total_minor: 126, subtotal_minor: 124, payment_fee_minor: 2, payment_fee_rate_bps: 100, price_version: 3, payment_channel: 'alipay', payment_status: 'paid', fulfillment_status: 'succeeded',
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

test('quote rejects unavailable channels before RPC and rejects absent, waived or contradictory fee snapshots', async () => {
    for (const channel of [undefined, '', 'usdt_bep20', 'paypal']) {
        let calls = 0;
        const handler = purchaseHandlers(async () => { calls++; });
        const result = await call(handler.quote, { method: 'POST', body: { ...requestQuote(), channel } });
        assert.equal(result.statusCode, 400); assert.equal(calls, 0);
    }
    for (const changes of [{ payment_channel: 'wxpay' }, { subtotal_minor: undefined }, { payment_fee_minor: 1 },
        { payment_fee_rate_bps: 0, payment_fee_minor: 0, total_minor: 124 }, { total_minor: 124 }]) {
        const handler = purchaseHandlers(async () => ({ data: { success: true, quote: {
            quote_id: QUOTE_ID, product_family: 'telegram_stars', term_months: null, stars_quantity: 100,
            username: 'telegram_user', currency: 'CNY', subtotal_minor: 124, payment_fee_minor: 2,
            payment_fee_rate_bps: 100, total_minor: 126, payment_channel: 'alipay', price_version: 3,
            expires_at: '2026-10-15T00:10:00Z', ...changes
        } } }));
        assert.equal((await call(handler.quote, { method: 'POST', body: requestQuote() })).statusCode, 503);
    }
});

test('changed fee snapshots after checkout claim cannot reach the upstream payment provider', async () => {
    let payments = 0;
    const handler = purchaseHandlers(async (name) => {
        if (name === 'fn_tg_create_purchase') return { data: { success: true, order: ORDER } };
        if (name === 'fn_tg_claim_purchase_checkout') return { data: { success: true, action: 'create', order: {
            ...ORDER, payment_status: 'checkout_creating', subtotal_minor: 126, payment_fee_minor: 0, payment_fee_rate_bps: 0
        } } };
        if (name === 'fn_tg_fail_purchase_checkout') return { data: { success: true } };
        if (name === 'fn_tg_purchase_status') return { data: { success: true, order: { ...ORDER, payment_status: 'manual_review' } } };
        throw new Error(name);
    }, { gateway: gateway({ createPayment: async () => { payments++; } }) });
    const result = await call(handler.orders, { method: 'POST', body: requestOrder() });
    assert.equal(result.statusCode, 200); assert.equal(result.body.order.payment_status, 'manual_review'); assert.equal(payments, 0);
});

test('signed subtotal-only callback passes authentication but is rejected against the full order amount', async () => {
    let confirmed = false;
    const amounts = [];
    const handler = purchaseHandlers(async (name, args) => {
        assert.equal(name, 'fn_tg_confirm_purchase_payment'); amounts.push(args.p_amount_minor);
        if (args.p_amount_minor !== ORDER.total_minor) return { data: { success: false, code: 'payment_binding_mismatch' } };
        confirmed = true; return { data: { success: true } };
    }, { gateway: gateway({ verifyWebhook: (payload) => ({ order_no: ORDER.order_no, provider: 'zpay', merchant_id: '7654321',
        provider_trade_no: 'ZP-REMOTE-123', payment_channel: 'alipay', amount_minor: Number(payload.amount), currency: 'CNY',
        verified_payload: { verified_by: 'signed_notify', event_status: 'paid' } }) }) });
    const underpaid = await call(handler.webhook, { method: 'GET', url: `/?amount=${ORDER.subtotal_minor}` });
    assert.equal(underpaid.statusCode, 409); assert.equal(confirmed, false);
    const paid = await call(handler.webhook, { method: 'GET', url: `/?amount=${ORDER.total_minor}` });
    assert.equal(paid.statusCode, 200); assert.equal(confirmed, true); assert.deepEqual(amounts, [124, 126]);
});

function cancelRequest(changes = {}) {
    return { method: 'POST', headers: { origin: 'https://tg.fatherkey.com', 'x-tg-status-token': TOKEN }, body: { order_no: ORDER.order_no }, ...changes };
}
test('cancellation authenticates before querying the provider, works with sales closed, and hides payment credentials', async () => {
    let current = { ...ORDER, provider_trade_no: 'ZP-REMOTE-123', checkout_url: 'https://pay.example/checkout' };
    const calls = []; let queried = 0;
    const handler = purchaseHandlers(async (name, args) => {
        calls.push({ name, args });
        assert.equal(args.p_status_token_hash, require('node:crypto').createHash('sha256').update(TOKEN).digest('hex'));
        if (name === 'fn_tg_purchase_status') return { data: { success: true, order: current } };
        assert.equal(name, 'fn_tg_cancel_purchase'); assert.equal(queried, 1);
        assert.equal(args.p_provider_checked, true); assert.equal(args.p_provider_trade_no, 'ZP-REMOTE-123');
        current = { ...current, payment_status: 'cancelled' };
        return { data: { success: true, order: current } };
    }, { env: { ...ENV, TG_PURCHASE_ENABLED: 'false' }, gateway: gateway({ canCancel: async ({ order }) => { queried++; assert.equal(order.order_no, ORDER.order_no); return true; } }) });
    const result = await call(handler.cancel, cancelRequest());
    assert.equal(result.statusCode, 200); assert.equal(result.body.order.payment_status, 'cancelled');
    assert.equal(result.body.order.checkout_url, undefined); assert.equal(result.body.order.provider_trade_no, undefined);
    assert.ok(Number.isFinite(Date.parse(result.body.server_time))); assert.ok(!JSON.stringify(result.body).includes(TOKEN));
    assert.equal((await call(handler.cancel, cancelRequest())).statusCode, 200);
    assert.equal(queried, 1); assert.equal(calls.filter(row => row.name === 'fn_tg_cancel_purchase').length, 1);
});

test('missing credentials, URL-held secrets, hostile origins and unknown orders cannot cancel or query providers', async () => {
    let reads = 0; let queries = 0;
    const handler = purchaseHandlers(async () => { reads++; return { data: { success: false, code: 'not_found' } }; },
        { gateway: gateway({ canCancel: async () => { queries++; return true; } }) });
    for (const changes of [{ headers: {} }, { headers: { 'x-tg-status-token': 'invalid' } },
        { headers: {}, url: `/?status_token=${TOKEN}`, body: { order_no: ORDER.order_no, status_token: TOKEN } },
        { body: { order_no: 'wrong' } }, { headers: { origin: 'https://evil.example', 'x-tg-status-token': TOKEN } }]) {
        assert.ok([400, 403].includes((await call(handler.cancel, cancelRequest(changes))).statusCode));
    }
    assert.equal(reads, 0); assert.equal(queries, 0);
    assert.equal((await call(handler.cancel, cancelRequest())).statusCode, 404); assert.equal(queries, 0);
    assert.equal((await call(handler.cancel, cancelRequest({ method: 'GET' }))).statusCode, 405);
});

test('paid, fulfillment, unknown checkout, in-flight payment and provider failures never call the cancellation RPC', async () => {
    for (const [changes, canCancel, expected] of [
        [{ payment_status: 'paid', paid_at: ORDER.created_at }, true, 409],
        [{ fulfillment_status: 'pending' }, true, 409], [{ payment_status: 'checkout_creating' }, true, 409],
        [{ payment_status: 'manual_review' }, true, 409], [{}, false, 409], [{}, new Error('private upstream error'), 503]
    ]) {
        let cancels = 0;
        const handler = purchaseHandlers(async (name) => {
            if (name === 'fn_tg_purchase_status') return { data: { success: true, order: { ...ORDER, provider_trade_no: 'ZP-REMOTE-123', ...changes } } };
            cancels++; throw new Error('must not cancel');
        }, { gateway: gateway({ canCancel: async () => { if (canCancel instanceof Error) throw canCancel; return canCancel; } }) });
        const result = await call(handler.cancel, cancelRequest());
        assert.equal(result.statusCode, expected); assert.equal(cancels, 0); assert.ok(!result.text.includes('private upstream'));
    }
});

test('a callback winning the DB lock rejects cancellation even after the provider reported unpaid', async () => {
    let queries = 0; let cancels = 0;
    const handler = purchaseHandlers(async name => {
        if (name === 'fn_tg_purchase_status') return { data: { success: true, order: { ...ORDER, provider_trade_no: 'ZP-REMOTE-123' } } };
        assert.equal(name, 'fn_tg_cancel_purchase'); cancels++;
        return { data: { success: false, code: 'cancel_not_allowed' } };
    }, { gateway: gateway({ canCancel: async () => { queries++; return true; } }) });
    const result = await call(handler.cancel, cancelRequest());
    assert.equal(result.statusCode, 409); assert.equal(queries, 1); assert.equal(cancels, 1);
    assert.equal(result.body.success, false);
});

test('an order with no upstream trade still delegates the never-started checkout check to the locked RPC', async () => {
    let queries = 0;
    const handler = purchaseHandlers(async (name, args) => {
        if (name === 'fn_tg_purchase_status') return { data: { success: true, order: ORDER } };
        assert.equal(args.p_provider_checked, false); assert.equal(args.p_provider_trade_no, null);
        return { data: { success: false, code: 'cancel_not_allowed' } };
    }, { gateway: gateway({ canCancel: async () => { queries++; return true; } }) });
    assert.equal((await call(handler.cancel, cancelRequest())).statusCode, 409); assert.equal(queries, 0);
});

test('missing cancellation migrations return a safe failure and never pretend the order was cancelled', async () => {
    for (const code of ['PGRST202', '42883']) {
        const handler = purchaseHandlers(async (name) => name === 'fn_tg_purchase_status'
            ? { data: { success: true, order: ORDER } }
            : { error: { code, message: 'private schema and service details' } });
        const result = await call(handler.cancel, cancelRequest());
        assert.equal(result.statusCode, 503);
        assert.equal(result.body.success, false); assert.equal(result.body.code, 'cancel_unavailable');
        assert.match(result.body.message, /订单尚未取消/);
        assert.ok(!result.text.includes('private schema'));
        assert.equal(result.body.order, undefined);
    }
});

function queriedPayment(order = ORDER) {
    return { order_no: order.order_no, provider: 'zpay', merchant_id: order.payment_merchant_id,
        provider_trade_no: '2026101623001484951454703399', payment_channel: order.payment_channel,
        amount_minor: order.total_minor, currency: 'CNY', verified_payload: { verified_by: 'authenticated_query', event_status: 'paid' } };
}

test('status ownership is checked before an authenticated provider query; expired paid orders are reconciled atomically', async () => {
    const original = { ...ORDER, payment_status: 'expired', provider_trade_no: ORDER.order_no };
    const paid = { ...original, payment_status: 'manual_review', paid_at: '2026-10-16T10:00:00Z', provider_trade_no: queriedPayment().provider_trade_no };
    const calls = [];
    const db = { rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'fn_tg_purchase_status') return { data: { success: true, order: original } };
        if (name === 'fn_tg_purchase_payment_reconciliation_ready') return { data: true };
        if (name === 'fn_tg_confirm_purchase_payment') return { data: { success: true, order: paid } };
        throw new Error(name);
    } };
    let queries = 0;
    const handlers = createTgPurchaseHandlers({ admin: stubAdmin(db), env: { ...ENV, TG_PURCHASE_ENABLED: 'false' }, requestSecurity: security(),
        gateway: gateway({ queryPayment: async ({ order }) => { queries++; assert.equal(calls[0].name, 'fn_tg_purchase_status'); assert.equal(order.order_no, original.order_no); return queriedPayment(order); } }) });
    const req = { url: `/api/tg/purchase/status?order_no=${ORDER.order_no}`, headers: { 'x-tg-status-token': TOKEN } };
    const res = await call(handlers.status, req);
    assert.equal(res.statusCode, 200); assert.equal(res.body.order.payment_status, 'manual_review');
    assert.equal(res.body.order.fulfillment_status, 'not_started'); assert.equal(queries, 1);
    const settled = calls.find(c => c.name === 'fn_tg_confirm_purchase_payment');
    assert.equal(settled.args.p_amount_minor, original.total_minor); assert.equal(settled.args.p_provider_trade_no, queriedPayment().provider_trade_no);
    assert.equal(settled.args.p_verified_payload.verified_by, 'authenticated_query');
    assert.ok(!res.text.includes('provider_trade_no')); assert.ok(!res.text.includes('payment_merchant_id'));
    await call(handlers.status, { ...req, headers: {} }); assert.equal(queries, 1);
    db.rpc = async () => ({ data: { success: false } });
    assert.equal((await call(handlers.status, req)).statusCode, 404); assert.equal(queries, 1);
});

test('provider or migration failures retain the original order and distinguish confirmed receipt from an unavailable query', async () => {
    for (const mode of ['unpaid', 'timeout', 'migration', 'rejected']) {
        const calls = [];
        const db = { rpc: async (name) => {
            calls.push(name);
            if (name === 'fn_tg_purchase_status') return { data: { success: true, order: ORDER } };
            if (name === 'fn_tg_purchase_payment_reconciliation_ready') return mode === 'migration' ? { error: { code: 'PGRST202' } } : { data: true };
            if (name === 'fn_tg_confirm_purchase_payment') return { data: { success: false, code: 'payment_binding_mismatch' } };
            throw new Error(name);
        } };
        const handlers = createTgPurchaseHandlers({ admin: stubAdmin(db), env: ENV, requestSecurity: security(),
            gateway: gateway({ queryPayment: async () => { if (mode === 'timeout') throw new Error('secret provider URL'); return mode === 'unpaid' ? null : queriedPayment(); } }) });
        const res = await call(handlers.status, { url: `/?order_no=${ORDER.order_no}`, headers: { 'x-tg-status-token': TOKEN } });
        assert.equal(res.statusCode, 200); assert.equal(res.body.order.payment_status, 'pending');
        assert.equal(res.body.payment_sync?.state, mode === 'unpaid' ? undefined : mode === 'timeout' ? 'unavailable' : 'received');
        assert.ok(!res.text.includes('secret provider URL'));
        assert.equal(calls.includes('fn_tg_confirm_purchase_payment'), mode === 'rejected');
        if (mode === 'migration') assert.equal(res.body.payment_sync.code, 'payment_reconciliation_migration_required');
    }
});

test('new ZPay purchases stop before creating quotes or orders when reconciliation or local callback is unavailable', async () => {
    for (const mode of ['migration', 'callback']) {
        const calls = [];
        const db = { rpc: async (name) => { calls.push(name); return { data: mode === 'migration' ? false : true }; } };
        const handlers = createTgPurchaseHandlers({ admin: stubAdmin(db), env: ENV, requestSecurity: security(), gateway: gateway({
            queryPayment: async () => null,
            assertCallbackReady: async () => { throw Object.assign(new Error('unavailable'), { code: 'tg_payment_callback_unavailable' }); }
        }) });
        const quote = await call(handlers.quote, { method: 'POST', body: { product_id: 'stars', username: ORDER.telegram_username, stars_quantity: 100, channel: 'alipay' } });
        assert.equal(quote.statusCode, 503);
        assert.equal(quote.body.code, mode === 'migration' ? 'payment_reconciliation_migration_required' : 'tg_payment_callback_unavailable');
        assert.deepEqual(calls, ['fn_tg_purchase_payment_reconciliation_ready']);
        const order = await call(handlers.orders, { method: 'POST', headers: { 'idempotency-key': KEY }, body: { quote_id: QUOTE_ID, product_id: 'stars', username: ORDER.telegram_username, stars_quantity: 100,
            channel: 'alipay', expected_total_minor: ORDER.total_minor, price_version: ORDER.price_version, status_token: TOKEN } });
        assert.equal(order.statusCode, 503);
        assert.ok(!calls.includes('fn_tg_create_purchase'));
    }
});

test('a signed callback with a checkout alias requires an independent identical paid query before settlement', async () => {
    for (const mode of ['paid', 'unpaid', 'mismatch', 'bound']) {
        let confirmations = 0;
        const verified = queriedPayment(); const signed = { ...verified, verified_payload: { verified_by: 'signed_notify', event_status: 'paid' } };
        const db = {
            from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { ...ORDER, provider_trade_no: mode === 'bound' ? 'different-real-transaction' : ORDER.order_no } }) }),
            rpc: async (name, args) => {
                if (name === 'fn_tg_purchase_payment_reconciliation_ready') return { data: true };
                assert.equal(name, 'fn_tg_confirm_purchase_payment'); confirmations++;
                if (confirmations === 1) return { data: { success: false, code: 'payment_binding_mismatch' } };
                assert.equal(args.p_verified_payload.verified_by, 'authenticated_query');
                return { data: { success: true, existing: true } };
            }
        };
        const handlers = createTgPurchaseHandlers({ admin: stubAdmin(db), env: ENV, requestSecurity: security(), gateway: gateway({
            verifyWebhook: () => signed,
            queryPayment: async () => mode === 'unpaid' ? null : { ...verified, ...(mode === 'mismatch' ? { amount_minor: 1 } : {}) }
        }) });
        const res = await call(handlers.webhook, { method: 'GET' });
        assert.equal(res.statusCode, mode === 'paid' ? 200 : 409);
        assert.equal(res.body, mode === 'paid' ? 'success' : 'error');
        assert.equal(confirmations, mode === 'paid' ? 2 : 1);
    }
});

for (const payment of [
    { name: 'paid refund', payment_status: 'paid', paid_at: '2026-10-16T11:00:00Z', completion_outcome: 'refunded' },
    { name: 'unverified payment review', payment_status: 'manual_review', paid_at: null, completion_outcome: 'no_valid_payment' }
]) test(`manual completion exposes only the dedicated customer explanation in authenticated status: ${payment.name}`, async () => {
    const completionNote = payment.paid_at ? '已按原渠道完成退款，到账时间以支付平台为准。' : '经支付记录核对未发现有效付款，本订单已完结。';
    const stored = { ...ORDER, ...payment, fulfillment_status: payment.paid_at ? 'cancelled' : 'not_started', closed_at: '2026-10-17T11:00:00Z',
        checkout_url: 'https://pay.example.test/expired-checkout', completion_note: completionNote, close_note: 'private-verification-record-123',
        completion_request_hash: 'private-request-hash', completion_operation_id: UUID, closed_by: UUID };
    const handlers = purchaseHandlers(async () => ({ data: { success: true, order: stored } }));
    const res = await call(handlers.status, { url: `/?order_no=${ORDER.order_no}`, headers: { 'x-tg-status-token': TOKEN } });
    assert.equal(res.statusCode, 200); assert.equal(res.body.order.fulfillment_status, 'closed'); assert.equal(res.body.order.completion_note, completionNote);
    assert.equal(res.body.order.payment_status, payment.payment_status); assert.equal(res.body.order.checkout_url, undefined);
    assert.equal(res.body.order.can_close, false);
    assert.doesNotMatch(JSON.stringify(res.body), /private-|close_note|closed_by|completion_outcome|completion_request_hash|completion_operation_id/);
});

test('uncommitted or malformed completion notes never become public explanations or re-enable checkout', () => {
    const { safeOrder } = require('../server/api-handlers/public/tg-purchase')._private;
    for (const completion_note of [null, '太短', 'x'.repeat(501), '说明包含\u0000控制符', '说明包含\t制表符']) {
        const projected = safeOrder({ ...ORDER, closed_at: '2026-10-17T11:00:00Z', completion_note,
            checkout_url: 'https://pay.example.test/should-not-be-payable', can_close: true });
        assert.equal(projected.fulfillment_status, 'closed'); assert.equal(projected.completion_note, undefined);
        assert.equal(projected.checkout_url, undefined); assert.equal(projected.can_close, false);
    }
    assert.equal(safeOrder({ ...ORDER, completion_note: '尚未提交的内部草稿说明。' }).completion_note, undefined);
});
