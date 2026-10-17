'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const security = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_NO = 'GS-CANCEL-HANDLER-1';
const CLAIM_SECRET = 'c'.repeat(43);
const ENV = { GUEST_SHOP_CLAIM_PEPPER: 'cancellation-test-only-pepper-value-1234567890' };

function fixture({ paymentStatus = 'pending', rpcError = null, rpcThrows = false, databaseUnavailable = false } = {}) {
    const order = {
        id: ORDER_ID,
        order_no: ORDER_NO,
        site: 'cn',
        snapshot_product_name: 'Cancellation product',
        quantity: 1,
        total_amount: '0.02',
        currency: 'CNY',
        payment_status: paymentStatus,
        reservation_status: 'held',
        fulfillment_status: 'pending',
        refund_status: 'none',
        claim_secret_hash: security.hashClaimSecret(CLAIM_SECRET, { env: ENV }),
        claim_attempt_count: 0,
        last_error_code: null,
        last_error_message: null,
        expires_at: '2099-01-01T00:00:00.000Z'
    };
    const payment = { id: 'payment-1', guest_order_id: ORDER_ID, status: paymentStatus, provider_order_no: ORDER_NO };
    const calls = { rpc: [], writes: [], tables: [] };
    const clone = (value) => JSON.parse(JSON.stringify(value));
    function query(table, patch = null) {
        const filters = [];
        const execute = async () => {
            const row = table === 'guest_shop_orders' ? order : table === 'guest_shop_payment_orders' ? payment : null;
            const found = row && filters.every(([key, value]) => row[key] === value);
            if (found && patch) {
                calls.writes.push({ table, patch: clone(patch) });
                Object.assign(row, patch);
            }
            return { data: found ? clone(row) : null, error: null };
        };
        const builder = {
            select() { return builder; },
            eq(key, value) { filters.push([key, value]); return builder; },
            is(key, value) { filters.push([key, value]); return builder; },
            maybeSingle: execute,
            then(resolve, reject) { return execute().then(resolve, reject); }
        };
        return builder;
    }
    const db = {
        from(table) {
            calls.tables.push(table);
            return {
                select() { return query(table); },
                update(patch) { return query(table, patch); }
            };
        },
        async rpc(name, args) {
            calls.rpc.push({ name, args });
            if (rpcThrows) throw new Error('private database transport error');
            if (rpcError) return { data: null, error: rpcError };
            assert.equal(name, 'fn_guest_shop_cancel_order');
            assert.deepEqual(args, { p_order_id: ORDER_ID, p_reason: 'buyer_cancelled' });
            Object.assign(order, { payment_status: 'expired', reservation_status: 'released', last_error_code: 'guest_order_cancelled' });
            payment.status = 'expired';
            return { data: [{ cancelled: true, order_id: ORDER_ID }], error: null };
        }
    };
    const handlers = createGuestShopHandlers({
        admin: { getOptionalSupabaseAdmin: () => databaseUnavailable ? null : db },
        requestSecurity: { async takeRateLimitToken() { return { allowed: true }; }, applyRateLimitHeaders() {} },
        env: ENV
    });
    async function cancel({ secret = CLAIM_SECRET, body = { orderNo: ORDER_NO }, method = 'POST' } = {}) {
        const res = {
            statusCode: 200,
            headers: {},
            setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
            end(body) { this.payload = JSON.parse(body); }
        };
        await handlers.cancel({ method, body, headers: { 'content-type': 'application/json', ...(secret ? { 'x-guest-claim-secret': secret } : {}) } }, res);
        return res;
    }
    return { cancel, order, payment, calls };
}

for (const paymentStatus of ['pending', 'review']) {
    test(`authorized ${paymentStatus} order cancellation calls the atomic RPC and returns the refreshed order`, async () => {
        const f = fixture({ paymentStatus });
        const res = await f.cancel();
        assert.equal(res.statusCode, 200);
        assert.equal(res.payload.cancelled, true);
        assert.equal(res.payload.order.order_no, ORDER_NO);
        assert.equal(res.payload.order.payment_status, 'expired');
        assert.equal(f.order.reservation_status, 'released');
        assert.equal(f.payment.status, 'expired');
        assert.equal(f.calls.rpc.length, 1);
        assert.deepEqual(f.calls.writes, [], 'stock and payment writes belong to the atomic RPC');
        assert.doesNotMatch(JSON.stringify(res.payload), /claim_secret|private database/u);
    });
}

test('missing or invalid claim credentials cannot reach the cancellation RPC', async () => {
    for (const secret of ['', 'invalid-claim-secret']) {
        const f = fixture();
        const res = await f.cancel({ secret });
        assert.equal(res.statusCode, 403);
        assert.equal(res.payload.code, 'guest_claim_invalid');
        assert.deepEqual(f.calls.rpc, []);
        assert.equal(f.order.payment_status, 'pending');
        assert.equal(f.order.reservation_status, 'held');
        assert.equal(f.payment.status, 'pending');
    }
});

test('buyer cancellation rejects unexpected fields before accessing the order', async () => {
    const f = fixture();
    const res = await f.cancel({ body: { orderNo: ORDER_NO, payment_status: 'expired' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, 'guest_cancel_invalid_request');
    assert.deepEqual(f.calls.tables, []);
    assert.deepEqual(f.calls.rpc, []);
});

test('unavailable cancellation database returns a service error', async () => {
    const f = fixture({ databaseUnavailable: true });
    const res = await f.cancel();
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'guest_database_unavailable');
    assert.deepEqual(f.calls.rpc, []);
});

test('an atomic cancellation refusal never falls back to separate inventory or order writes', async () => {
    for (const paymentStatus of ['pending', 'review', 'confirmed']) {
        const f = fixture({ paymentStatus, rpcError: { code: 'P0001', message: 'guest_order_not_cancellable' } });
        const res = await f.cancel();
        assert.equal(res.statusCode, 409);
        assert.equal(res.payload.code, 'guest_order_not_cancellable');
        assert.deepEqual(f.calls.rpc.map((call) => call.name), ['fn_guest_shop_cancel_order']);
        assert.deepEqual(f.calls.writes, []);
        assert.equal(f.order.payment_status, paymentStatus);
        assert.equal(f.order.reservation_status, 'held');
        assert.equal(f.payment.status, paymentStatus);
    }
});

test('a failed review-order cancellation remains failed without partial stock release', async () => {
    const f = fixture({ paymentStatus: 'review', rpcError: { code: 'XX000', message: 'private database failure' } });
    const res = await f.cancel();
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.success, false);
    assert.doesNotMatch(JSON.stringify(res.payload), /private database failure/u);
    assert.deepEqual(f.calls.rpc.map((call) => call.name), ['fn_guest_shop_cancel_order']);
    assert.deepEqual(f.calls.writes, []);
    assert.equal(f.order.payment_status, 'review');
    assert.equal(f.order.reservation_status, 'held');
});

test('a thrown cancellation RPC error preserves the unpaid order and hides internal details', async () => {
    const f = fixture({ rpcThrows: true });
    const res = await f.cancel();
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.success, false);
    assert.doesNotMatch(JSON.stringify(res.payload), /private database transport error/u);
    assert.equal(f.calls.rpc.length, 1);
    assert.deepEqual(f.calls.writes, []);
    assert.equal(f.order.payment_status, 'pending');
    assert.equal(f.order.reservation_status, 'held');
});
