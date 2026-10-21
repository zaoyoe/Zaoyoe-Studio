'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShopHandlers } = require('../server/api-handlers/public/shop');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');
const { sealDelivery } = require('../server/integrations/suppliers/delivery');
const site = require('../api/_lib/site');
const ORDER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const UNIT = '44444444-4444-4444-8444-444444444444';
const INTENT = '55555555-5555-4555-8555-555555555555';
const CONTEXT = { unitId: UNIT, intentId: INTENT, site: 'cn', orderNo: 'ORIGINAL-TEST' };
const CONTENT = 'test-only-delivered-full-content';
const env = { APP_ENV: 'test', SHOP_SUPPLIER_DELIVERY_KEYS: JSON.stringify({ a: 'only-test-encryption-key-'.repeat(3) }),
    SHOP_SUPPLIER_DELIVERY_ACTIVE_KEY: 'a', SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY: 'only-test-fingerprint-key-'.repeat(3) };
function response() { return { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, end(body) { this.payload = JSON.parse(body); } }; }
function fixture(options = {}) {
    const calls = [];
    const order = { id: ORDER, user_id: USER, site: 'cn', product_id: null, inventory_id: null,
        snapshot_product_name: '测试商品', item_count: 1, price_paid: 20, fulfillment_source: 'supplier_v2',
        delivery_status: 'delivered', order_no: 'GUEST-TEST', claim_secret_hash: 'test-only-stored-hash',
        claim_attempt_count: 0, payment_status: 'confirmed', fulfillment_status: 'delivered', refund_status: 'none',
        ...options.order };
    const db = { from(table) {
        assert.ok(['shop_orders', 'guest_shop_orders'].includes(table), `supplier delivery must not read local stock or reservations: ${table}`);
        const filters = [];
        const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, is() { return q; },
            update(patch) { calls.push({ update: table, patch }); return q; },
            async single() { return q.maybeSingle(); },
            async maybeSingle() { calls.push({ table, filters });
                const match = filters.every(([k, v]) => order[k] === v);
                return { data: match ? { ...order } : null, error: match ? null : { code: 'PGRST116' } }; },
            then(resolve, reject) { return q.maybeSingle().then(resolve, reject); } };
        return q;
    }, async rpc(name, args) {
        calls.push({ rpc: name, args }); assert.equal(name, 'fn_shop_supplier_customer_delivery_v2');
        if (options.rpcError) return { error: { message: 'private-key-and-raw-upstream-response' } };
        if (options.pending) return { data: { status: 'pending' } };
        const sealed = sealDelivery(CONTENT, CONTEXT, env);
        if (options.tamper) sealed.tag = 'AAAA';
        return { data: { status: 'delivered', ...CONTEXT, sealed } };
    } };
    const admin = { getOptionalSupabaseAdmin: () => db, parseJsonBody: async req => req.body,
        async requireAuthenticatedUser() {
            calls.push({ auth: true });
            if (options.authError) throw Object.assign(new Error('请登录'), { statusCode: 401 });
            return { supabase: db, adminSupabase: db, user: { id: options.userId || USER } };
        }, sendJson(res, status, payload) { res.status(status).end(JSON.stringify(payload)); } };
    const requestSecurity = { resolveClientIp: () => '198.51.100.1', applyRateLimitHeaders() {},
        async takeRateLimitToken() { return { allowed: options.allowed !== false }; } };
    const points = createShopHandlers({ admin, requestSecurity, site, env });
    const guest = createGuestShopHandlers({ admin, requestSecurity, env, security: {
        readJsonBodyWithLimit: req => req.body,
        verifyClaimSecret(secret, hash) { calls.push({ claimAuth: true }); return secret === 'test-only-secret' && hash === 'test-only-stored-hash'; }
    } });
    return { calls, async points() { const res = response(); await points['order-detail']({ method: 'POST', headers: {}, body: { orderId: ORDER, site: options.site || 'cn' } }, res); return res; },
        async claim(secret = 'test-only-secret') { const res = response(); await guest.claim({ method: 'POST', headers: { 'x-guest-claim-secret': secret },
            body: { orderNo: 'GUEST-TEST' } }, res); return res; } };
}
test('points details verify native owner and site before returning the verified full delivery', async () => {
    const f = fixture(); const res = await f.points();
    assert.equal(res.statusCode, 200); assert.equal(res.payload.data.items[0].content, CONTENT);
    assert.equal(res.payload.data.items[0].delivery_mode, 'supplier_v2');
    assert.ok(f.calls.findIndex(c => c.table === 'shop_orders') < f.calls.findIndex(c => c.rpc));
    assert.ok(f.calls.find(c => c.table).filters.some(([key, value]) => key === 'user_id' && value === USER));
    assert.ok(f.calls.find(c => c.table).filters.some(([key, value]) => key === 'site' && value === 'cn'));
    assert.doesNotMatch(JSON.stringify(res.payload), /sealed|fingerprint|ORIGINAL-TEST|credential_ref|actualCost/);
    assert.match(res.headers['cache-control'], /no-store/);
});
for (const options of [{ authError: true }, { userId: OTHER }, { site: 'intl' }, { allowed: false }]) {
    test(`points auth/owner/site/throttle guard prevents secret read (${Object.keys(options)[0]})`, async () => {
        const f = fixture(options); const res = await f.points(); assert.ok(res.statusCode >= 400);
        assert.equal(f.calls.some(c => c.rpc), false); assert.doesNotMatch(JSON.stringify(res.payload), new RegExp(CONTENT));
    });
}
test('pending points delivery suppresses even a stale native delivered flag without a local-stock fallback', async () => {
    const f = fixture({ pending: true }); const res = await f.points();
    assert.equal(res.statusCode, 200); assert.equal(res.payload.data.items[0].content, '');
    assert.equal(res.payload.data.order.delivery_status, 'pending');
});
for (const options of [{ rpcError: true }, { tamper: true }]) {
    test(`points delivery failures return safe errors (${Object.keys(options)[0]})`, async () => {
        const res = await fixture(options).points(); assert.equal(res.statusCode, 503);
        assert.doesNotMatch(JSON.stringify(res.payload), /test-only|private-key|raw-upstream|sealed|fingerprint/);
    });
}
test('valid guest claim authorizes before private delivery RPC and keeps native content shape', async () => {
    const f = fixture(); const res = await f.claim();
    assert.equal(res.statusCode, 200); assert.equal(res.payload.content, CONTENT);
    assert.equal(res.payload.items[0].content, CONTENT);
    assert.ok(f.calls.findIndex(c => c.claimAuth) < f.calls.findIndex(c => c.rpc));
    assert.equal(f.calls.find(c => c.rpc).args.p_funding_kind, 'guest_cash');
    assert.equal(f.calls.find(c => c.rpc).args.p_buyer_user_id, null);
    assert.match(res.headers['cache-control'], /no-store/);
    assert.doesNotMatch(JSON.stringify(res.payload), /sealed|fingerprint|ORIGINAL-TEST|credential_ref|actualCost/);
});
test('wrong guest claim cannot decrypt a supplier card', async () => {
    const f = fixture(); const res = await f.claim('wrong-test-secret');
    assert.equal(res.statusCode, 403); assert.equal(f.calls.some(c => c.rpc), false);
    assert.doesNotMatch(JSON.stringify(res.payload), new RegExp(CONTENT));
});
for (const options of [{ order: { fulfillment_status: 'pending' } }, { order: { payment_status: 'pending' } }, { pending: true }]) {
    test(`guest undelivered state withholds supplier content (${JSON.stringify(options)})`, async () => {
        const f = fixture(options); const res = await f.claim(); assert.equal(res.statusCode, 409);
        assert.doesNotMatch(JSON.stringify(res.payload), new RegExp(CONTENT));
    });
}
test('guest decryption/DB failures are sanitized and do not use old inventory data', async () => {
    for (const options of [{ rpcError: true }, { tamper: true }]) {
        const res = await fixture(options).claim(); assert.equal(res.statusCode, 503);
        assert.doesNotMatch(JSON.stringify(res.payload), /test-only|private-key|raw-upstream|sealed|fingerprint/);
    }
});
