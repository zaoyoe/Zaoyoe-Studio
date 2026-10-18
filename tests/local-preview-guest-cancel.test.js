'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { request: httpRequest } = require('node:http');
const { createGuestShopPreviewRelay, resolveGuestShopPreviewConfig } = require('../scripts/local-preview-guest-shop');
const { createGuestShopPreviewCancellation } = require('../scripts/local-preview-guest-cancel');

async function fixture(t, options = {}) {
    const order = {
        id: '33333333-3333-4333-8333-333333333333', order_no: 'GS-LOCAL-CANCEL-1',
        site: 'cn', product_id: 'product-1', sku_id: 'sku-1', total_amount: '0.02', currency: 'CNY',
        expires_at: '2026-10-16T20:00:00.000Z', payment_status: 'pending', reservation_status: 'held',
        fulfillment_status: 'pending', refund_status: 'none', cancelled_at: null,
        ...options.order
    };
    const calls = { auth: [], reads: [], rpc: [], getDb: 0 };
    const db = {
        from(table) {
            calls.reads.push(table);
            return {
                select(fields) {
                    assert.doesNotMatch(fields, /secret|contact|password/u);
                    return { eq(key, value) {
                        assert.equal(key, 'order_no');
                        assert.equal(value, order.order_no);
                        return { maybeSingle: async () => ({ data: options.missingOrder ? null : { ...order }, error: null }) };
                    } };
                }
            };
        },
        async rpc(name, args) {
            calls.rpc.push({ name, args });
            if (options.rpcError) return { error: options.rpcError };
            if (options.rpcThrows) throw new Error('private RPC diagnostic');
            if (options.concurrentPayment) {
                order.payment_status = 'confirmed';
                return { error: { message: 'guest_order_not_cancellable' } };
            }
            if (!options.unconfirmedCancel) Object.assign(order, { payment_status: 'expired', reservation_status: 'released', cancelled_at: new Date().toISOString() });
            return { data: [{ cancelled: true }], error: null };
        }
    };
    const publicOrder = () => {
        const { id, total_amount, reservation_status, cancelled_at, ...snapshot } = order;
        return { ...snapshot, amount: total_amount, ...options.publicOrder };
    };
    const fetchImpl = async (url, request) => {
        calls.auth.push({ url, ...request });
        if (options.authThrows) throw new Error('private upstream diagnostic');
        const sessionRead = url.includes('/guest/order?');
        const status = sessionRead ? (options.sessionStatus || 200) : (options.authStatus || 200);
        return Response.json(status === 200
            ? { success: true, order: publicOrder() }
            : { success: false, code: 'guest_claim_invalid', message: '取货凭证无效' }, { status, headers: { 'Retry-After': '30' } });
    };
    const app = express();
    app.use(express.json());
    app.use(createGuestShopPreviewRelay({
        origin: 'https://verify.example.test', orderWritesEnabled: options.orderWritesEnabled ?? true,
        cancellationMode: options.cancellationMode || 'local-rpc', fetchImpl,
        cancelOrder: createGuestShopPreviewCancellation({ getSupabase: () => { calls.getDb++; return options.noDb ? null : db; } })
    }));
    app.all('*', (_req, res) => res.status(418).end());
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cancel = (body = { orderNo: order.order_no }, extra = {}) => fetch(origin + (extra.path || '/api/shop/guest/cancel'), {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: 'gs-preview-claim-proof=opaque-proof; other=do-not-forward', ...extra.headers },
        body: JSON.stringify(body)
    });
    return { order, calls, cancel, origin };
}

test('local cancellation is explicit, requires write opt-in and rejects unknown modes', () => {
    const env = { LOCAL_PREVIEW_GUEST_SHOP_API_ORIGIN: 'https://verify.example.test', LOCAL_PREVIEW_GUEST_SHOP_CANCEL_MODE: 'local-rpc' };
    assert.throws(() => resolveGuestShopPreviewConfig(env), /requires/u);
    assert.equal(resolveGuestShopPreviewConfig({ ...env, LOCAL_PREVIEW_GUEST_SHOP_ORDER_WRITES: 'true' }).cancellationMode, 'local-rpc');
    assert.throws(() => resolveGuestShopPreviewConfig({ ...env, LOCAL_PREVIEW_GUEST_SHOP_CANCEL_MODE: 'automatic' }), /must be/u);
});

for (const path of ['/api/shop/guest/cancel', '/api/public?scope=shop&route=guest/cancel', '/api/public/shop/guest/cancel']) {
    test(`verified local cancellation uses one atomic RPC through ${path}`, async (t) => {
        const f = await fixture(t);
        const response = await f.cancel(undefined, { path });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-local-preview-guest-cancellation'), 'local-rpc-after-upstream-auth');
        const result = await response.json();
        assert.equal(result.cancelled, true);
        assert.equal(result.order.payment_status, 'expired');
        assert.equal(f.order.reservation_status, 'released');
        assert.deepEqual(f.calls.rpc, [{ name: 'fn_guest_shop_cancel_order', args: { p_order_id: f.order.id, p_reason: 'buyer_cancelled' } }]);
        assert.equal(f.calls.auth.length, 1);
        assert.match(f.calls.auth[0].url, /guest\/status\?orderNo=GS-LOCAL-CANCEL-1&force_provider_refresh=1$/u);
        assert.equal(f.calls.auth[0].headers.cookie, 'guest_claim_proof=opaque-proof');
        assert.equal(f.calls.auth[0].redirect, 'error');
        assert.equal(f.calls.auth[0].body, undefined);
        assert.doesNotMatch(JSON.stringify(result), /opaque-proof|secret|33333333/u);
    });
}

for (const authStatus of [403, 429, 500]) {
    test(`upstream authorization ${authStatus} never reaches the local database`, async (t) => {
        const f = await fixture(t, { authStatus });
        const response = await f.cancel();
        assert.equal(response.status, authStatus === 500 ? 502 : authStatus);
        assert.equal(f.calls.getDb, 0);
        assert.equal(f.calls.rpc.length, 0);
        assert.equal(f.order.reservation_status, 'held');
    });
}

test('upstream authorization transport failure preserves the original order', async (t) => {
    const f = await fixture(t, { authThrows: true });
    const response = await f.cancel();
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private upstream/u);
    assert.equal(f.calls.getDb, 0);
});

test('a revoked/expired claim can only use a separately verified owning buyer session', async (t) => {
    const f = await fixture(t, { authStatus: 403 });
    const response = await f.cancel(undefined, { headers: { Cookie: 'gs-preview-access=opaque-session' } });
    assert.equal(response.status, 200);
    assert.equal(f.calls.auth.length, 2);
    assert.match(f.calls.auth[1].url, /guest\/order\?order_no=GS-LOCAL-CANCEL-1$/u);
    assert.equal(f.calls.auth[1].headers.cookie, '__Host-gs-acc=opaque-session');
});

test('a revoked buyer session cannot authorize cancellation after a claim failure', async (t) => {
    const f = await fixture(t, { authStatus: 403, sessionStatus: 403 });
    assert.equal((await f.cancel(undefined, { headers: { Cookie: 'gs-preview-access=revoked-session' } })).status, 403);
    assert.equal(f.calls.getDb, 0);
});

for (const publicOrder of [{ order_no: 'GS-DIFFERENT' }, { amount: '0.03' }, { product_id: 'different-product' }]) {
    test(`mismatched upstream identity ${JSON.stringify(publicOrder)} cannot cancel local stock`, async (t) => {
        const f = await fixture(t, { publicOrder });
        assert.ok([502, 503].includes((await f.cancel()).status));
        assert.equal(f.calls.rpc.length, 0);
    });
}

test('a missing local order cannot cancel an unrelated database', async (t) => {
    const f = await fixture(t, { missingOrder: true });
    assert.equal((await f.cancel()).status, 503);
    assert.equal(f.calls.rpc.length, 0);
});

test('payment confirmation winning the database lock prevents stock release', async (t) => {
    const f = await fixture(t, { concurrentPayment: true });
    const response = await f.cancel();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'guest_order_not_cancellable');
    assert.equal(f.order.reservation_status, 'held');
    assert.equal(f.calls.rpc.length, 1);
});

for (const options of [{ rpcThrows: true }, { rpcError: { message: 'private database diagnostic' } }, { unconfirmedCancel: true }, { noDb: true }]) {
    test(`cancellation failure ${JSON.stringify(options)} cannot report success or release stock`, async (t) => {
        const f = await fixture(t, options);
        const response = await f.cancel();
        assert.equal(response.status, 503);
        const payload = await response.text();
        assert.doesNotMatch(payload, /private|"cancelled":true/u);
        assert.equal(f.order.reservation_status, 'held');
    });
}

test('retry after a completed cancellation authenticates again without releasing stock twice', async (t) => {
    const f = await fixture(t);
    assert.equal((await f.cancel()).status, 200);
    assert.equal((await f.cancel()).status, 200);
    assert.equal(f.calls.auth.length, 2);
    assert.equal(f.calls.rpc.length, 1);
});

test('invalid bodies and external origins never reach upstream authentication or the database', async (t) => {
    const f = await fixture(t);
    for (const body of [{}, { orderNo: f.order.order_no, arbitrary: true }, { orderNo: ['bad'] }, { orderNo: 'bad?orderNo=another' }, { orderNo: f.order.order_no, order_no: 'different' }]) {
        assert.equal((await f.cancel(body)).status, 400);
    }
    assert.equal((await f.cancel(undefined, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const externalHostStatus = await new Promise((resolve, reject) => {
        const request = httpRequest(f.origin + '/api/shop/guest/cancel', { method: 'POST', headers: { Host: 'public.example', Origin: 'http://public.example', 'Content-Type': 'application/json' } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
        request.on('error', reject);
        request.end(JSON.stringify({ orderNo: f.order.order_no }));
    });
    assert.equal(externalHostStatus, 403);
    assert.equal(f.calls.auth.length, 0);
    assert.equal(f.calls.getDb, 0);
});

test('the local RPC mode cannot bypass disabled real-order writes', async (t) => {
    const f = await fixture(t, { orderWritesEnabled: false });
    assert.equal((await f.cancel()).status, 409);
    assert.equal(f.calls.auth.length, 0);
    assert.equal(f.calls.getDb, 0);
});
