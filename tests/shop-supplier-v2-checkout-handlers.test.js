'use strict';
// HTTP-handler integration with fake RPCs only; no database or provider I/O.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShopHandlers } = require('../server/api-handlers/public/shop');
const site = require('../api/_lib/site');
const discountAssets = require('../api/_lib/discount-assets');
const discountPricing = require('../api/_lib/discount-pricing');
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const SKU = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const QUOTE = '44444444-4444-4444-8444-444444444444';
const ORDER = '55555555-5555-4555-8555-555555555555';
const KEY = 'supplier-handler-purchase-0001';

function response() {
    return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
        end(body) { this.payload = JSON.parse(body); } };
}
function fixture(options = {}) {
    const calls = { rpc: [], tables: [], limits: [], auth: 0 };
    const db = {
        from(table) {
            calls.tables.push(table);
            assert.ok(['shop_products', 'shop_product_skus'].includes(table), `unexpected side effect: ${table}`);
            const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
                async maybeSingle() { return { data: table === 'shop_products'
                    ? { id: PRODUCT, is_active: true, manual_delivery: false, show_usage_instructions: false }
                    : { id: SKU, product_id: PRODUCT, is_active: true, manual_delivery: false } }; } };
            return query;
        },
        async rpc(name, args) {
            calls.rpc.push({ name, args });
            if (name === 'fn_shop_supplier_source_v2') return { data: { is_supplier: options.isSupplier !== false, sku_id: SKU } };
            if (name === 'fn_shop_supplier_recover_points_v2') return options.recoveryError
                ? { error: options.recoveryError } : { data: options.recovery || { status: 'confirmed', orderId: ORDER } };
            if (name === 'fn_issue_shop_supplier_quote_v2') return options.quoteError
                ? { error: options.quoteError } : { data: { quote_id: QUOTE } };
            if (name === 'fn_purchase_shop_supplier_points_v2') return options.purchaseError
                ? { error: options.purchaseError } : { data: { success: true, data: { order_id: ORDER,
                    fulfillment_source: 'supplier_v2', delivery_status: 'pending', fulfillment_pending: true,
                    content: null, remaining_balance: 50 } } };
            if (name === 'fn_purchase_shop_item') return { data: { success: false, message: 'native test boundary' } };
            assert.fail(`unexpected RPC or reward before delivery: ${name}`);
        }
    };
    const handlers = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin: () => db,
            parseJsonBody: async req => req.body,
            async requireAuthenticatedUser() {
                calls.auth++;
                if (options.authError) throw Object.assign(new Error('login required'), { statusCode: 401 });
                return { supabase: db, requestSupabase: { rpc() { assert.fail('supplier must use trusted admin'); } },
                    adminSupabase: db, user: { id: USER } };
            },
            sendJson(res, status, payload) { res.statusCode = status; res.end(JSON.stringify(payload)); }
        },
        requestSecurity: {
            resolveClientIp: () => '198.51.100.20', applyRateLimitHeaders() {},
            async takeRateLimitToken({ key }) {
                calls.limits.push(key);
                return { allowed: !key.includes(options.denyLimit || 'never-match'), retryAfterSeconds: 10 };
            }
        },
        site, discountAssets, discountPricing,
        env: { SHOP_SUPPLIER_CHECKOUT_V2_ENABLED: options.enabled === false ? 'false' : 'true' }
    });
    async function request(body) {
        const res = response();
        await handlers.purchase({ method: 'POST', headers: {}, body }, res);
        await new Promise(resolve => setImmediate(resolve));
        return res;
    }
    return { calls, request, purchase(overrides = {}) {
        return request({ productId: PRODUCT, productSkuId: SKU, quantity: 1, site: 'cn', idempotencyKey: KEY, ...overrides });
    } };
}

test('points HTTP path uses trusted source, quote and wrapper and defers rewards for funded pending orders', async () => {
    const f = fixture();
    const first = await f.purchase();
    const retry = await f.purchase();
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.data.fulfillment_source, 'supplier_v2');
    assert.equal(first.payload.data.delivery_status, 'pending');
    assert.equal(first.payload.data.content, null);
    assert.equal(first.payload.data.remaining_balance, 50);
    assert.equal(retry.payload.data.order_id, first.payload.data.order_id);
    assert.deepEqual(f.calls.rpc.map(c => c.name), Array(2).fill([
        'fn_shop_supplier_source_v2', 'fn_issue_shop_supplier_quote_v2', 'fn_purchase_shop_supplier_points_v2'
    ]).flat());
    const quotes = f.calls.rpc.filter(c => c.name === 'fn_issue_shop_supplier_quote_v2');
    assert.equal(quotes[0].args.p_operation_id, quotes[1].args.p_operation_id);
    assert.equal(quotes[0].args.p_buyer_user_id, USER);
    assert.equal(quotes[0].args.p_funding_kind, 'points');
    assert.equal(f.calls.limits.filter(k => k.startsWith('shop-purchase:ip:')).length, 2);
    assert.equal(f.calls.limits.filter(k => k.startsWith('shop-purchase:user:')).length, 2);
    assert.equal(f.calls.limits.some(k => k.includes(':idempotency:')), false);
});
for (const phase of ['quote', 'purchase']) {
    test(`points ${phase} RPC failure is sanitized without falling back to local inventory`, async () => {
        const f = fixture({ [`${phase}Error`]: { message: 'private SQL detail with merchant secret' } });
        const res = await f.purchase();
        assert.equal(res.statusCode, 503);
        assert.equal(res.payload.code, 'supplier_checkout_unavailable');
        assert.doesNotMatch(JSON.stringify(res.payload), /private SQL|merchant secret/);
        assert.equal(f.calls.rpc.some(c => c.name === 'fn_purchase_shop_item'), false);
    });
}
for (const denyLimit of [':ip:', ':user:']) {
    test(`points supplier checkout retains ${denyLimit} throttling`, async () => {
        const f = fixture({ denyLimit });
        const res = await f.purchase();
        assert.equal(res.statusCode, 429);
        assert.equal(f.calls.rpc.some(c => c.name.includes('quote') || c.name.includes('purchase')), false);
        if (denyLimit === ':ip:') assert.equal(f.calls.auth, 0);
    });
}
test('points supplier checkout requires existing authentication', async () => {
    const f = fixture({ authError: true });
    assert.equal((await f.purchase()).statusCode, 401);
    assert.deepEqual(f.calls.rpc, []);
});
test('points supplier scope rejects quantity or discount widening before a quote or purchase', async () => {
    for (const overrides of [{ quantity: 2 }, { discountCode: 'TEST' }, { agentId: USER }]) {
        const f = fixture();
        const res = await f.purchase(overrides);
        assert.equal(res.statusCode, 409);
        assert.equal(res.payload.code, 'supplier_checkout_scope_unsupported');
        assert.deepEqual(f.calls.rpc.map(c => c.name), ['fn_shop_supplier_source_v2']);
    }
});
test('points checkout flag off uses the unchanged native purchase path and its idempotency limiter', async () => {
    const f = fixture({ enabled: false });
    const res = await f.purchase();
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.message, 'native test boundary');
    assert.deepEqual(f.calls.rpc.map(c => c.name), ['fn_purchase_shop_item']);
    assert.equal(f.calls.limits.some(k => k.includes(':idempotency:')), true);
});


test('source preparation is authenticated and read-only, without catalog reads, a quote or a purchase', async () => {
    for (const isSupplier of [true, false]) {
        const f = fixture({ isSupplier });
        const res = await f.request({ prepareRecovery: true, productId: PRODUCT, productSkuId: SKU, site: 'cn' });
        assert.equal(res.statusCode, 200);
        assert.equal(res.payload.recoverySource, isSupplier ? 'supplier_v2' : 'local');
        assert.equal(f.calls.auth, 1);
        assert.deepEqual(f.calls.tables, []);
        assert.deepEqual(f.calls.rpc.map(c => c.name), ['fn_shop_supplier_source_v2']);
        assert.match(res.headers['Cache-Control'], /no-store/);
    }
});
test('source preparation and recovery cannot bypass authentication or accept purchase fields', async () => {
    for (const body of [
        { prepareRecovery: true, productId: PRODUCT, site: 'cn' },
        { recoverOnly: true, idempotencyKey: KEY, site: 'cn' }
    ]) {
        const unauthenticated = fixture({ authError: true });
        assert.equal((await unauthenticated.request(body)).statusCode, 401);
        assert.deepEqual(unauthenticated.calls.rpc, []);
        const invalid = fixture();
        assert.equal((await invalid.request({ ...body, quantity: 1 })).statusCode, 400);
        assert.deepEqual(invalid.calls.rpc, []);
        assert.deepEqual(invalid.calls.tables, []);
    }
});
test('read-only recovery works with intake disabled and binds original operation to authenticated buyer/site', async () => {
    const f = fixture({ enabled: false });
    const body = { recoverOnly: true, idempotencyKey: KEY, site: 'cn' };
    const first = await f.request(body);
    const retry = await f.request(body);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.payload.recovery, { status: 'confirmed', orderId: ORDER, resolution: null });
    assert.deepEqual(retry.payload, first.payload);
    assert.deepEqual(f.calls.tables, []);
    assert.deepEqual(f.calls.rpc.map(c => c.name), Array(2).fill('fn_shop_supplier_recover_points_v2'));
    assert.deepEqual(f.calls.rpc[0].args, f.calls.rpc[1].args);
    assert.equal(f.calls.rpc[0].args.p_buyer_user_id, USER);
    assert.equal(f.calls.rpc[0].args.p_site, 'cn');
    assert.match(f.calls.rpc[0].args.p_operation_id, /^[a-f\d-]{36}$/);
    assert.match(first.headers['Cache-Control'], /no-store/);
});
test('unconfirmed recovery remains unconfirmed and never falls through to a purchase', async () => {
    const f = fixture({ recovery: { status: 'unconfirmed', private: 'not public' } });
    const res = await f.request({ recoverOnly: true, idempotencyKey: KEY, site: 'cn' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.recovery, { status: 'unconfirmed' });
    assert.deepEqual(f.calls.rpc.map(c => c.name), ['fn_shop_supplier_recover_points_v2']);
    assert.deepEqual(f.calls.tables, []);
});
test('recovery errors are sanitized and cannot quote, debit or access another site', async () => {
    const f = fixture({ recoveryError: { message: 'private SQL merchant key' } });
    const res = await f.request({ recoverOnly: true, idempotencyKey: KEY, site: 'cn' });
    assert.equal(res.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(res.payload), /private SQL|merchant key/);
    assert.deepEqual(f.calls.rpc.map(c => c.name), ['fn_shop_supplier_recover_points_v2']);
    const wrongSite = fixture();
    assert.equal((await wrongSite.request({ recoverOnly: true, idempotencyKey: KEY, site: 'intl' })).statusCode, 400);
    assert.deepEqual(wrongSite.calls.rpc, []);
});
test('source changed after preparation rejects before quote, purchase, or idempotency lock', async () => {
    for (const [isSupplier, recoverySource] of [[true, 'local'], [false, 'supplier_v2'], [true, 'invalid']]) {
        const f = fixture({ isSupplier });
        const res = await f.purchase({ recoverySource });
        assert.equal(res.statusCode, 409);
        assert.equal(res.payload.code, 'purchase_source_changed');
        assert.deepEqual(f.calls.rpc.map(c => c.name), ['fn_shop_supplier_source_v2']);
        assert.equal(f.calls.limits.some(k => k.includes(':idempotency:')), false);
    }
});
