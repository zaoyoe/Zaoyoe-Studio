'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adminModulePath = require.resolve('../api/_lib/admin');
const cachedAdmin = require.cache[adminModulePath];
require.cache[adminModulePath] = { id: adminModulePath, filename: adminModulePath, loaded: true, exports: {} };
const { createPurchaseReview, approvalInput } = require('../server/tg/purchase-review');
const { createPurchasesHandler } = require('../server/api-handlers/admin/tg/purchases');
if (cachedAdmin) require.cache[adminModulePath] = cachedAdmin; else delete require.cache[adminModulePath];
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const DELIVERY_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const ACTOR = 'f47ac10b-58cc-4372-a567-0e02b2c3d481';
const NOW = '2026-10-16T10:30:00.000Z';
const ORDER = Object.freeze({ id: ID, order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', telegram_username: 'telegram_user',
    product_family: 'telegram_stars', term_months: null, stars_quantity: 50, currency: 'CNY', total_minor: 707,
    subtotal_minor: 700, payment_fee_minor: 7, payment_fee_rate_bps: 100, price_version: 3,
    payment_provider: 'zpay', payment_channel: 'alipay', payment_merchant_id: '7654321', provider_trade_no: 'ZP-REAL-123',
    payment_status: 'manual_review', paid_at: '2026-10-16T10:14:31.392691+00:00', cancelled_at: null,
    checkout_started_at: '2026-10-16T09:00:00+00:00', payment_expires_at: '2026-10-16T09:06:00+00:00',
    last_error_code: 'payment_received_after_expiry', created_at: '2026-10-16T09:00:00+00:00', updated_at: '2026-10-16T10:14:31.392691+00:00',
    // Sentinel private fields must never reach an admin response.
    status_token_hash: 'private-status-token', idempotency_key_hash: 'private-idempotency', verified_payment: { secret: 'private-saved-proof' } });
const DELIVERY = Object.freeze({ id: DELIVERY_ID, order_no: 'TG-ABCDEFGHIJKLMNOPQRST', order_source: 'purchase', purchase_id: ID, code_id: null,
    telegram_username: ORDER.telegram_username, product_family: ORDER.product_family, term_months: null, stars_quantity: 50,
    status: 'pending', provider_order_id: null, created_at: NOW, completed_at: null });
const INPUT = Object.freeze({ action: 'approve_fulfillment', order_no: ORDER.order_no, expected_updated_at: ORDER.updated_at,
    note: '已在渠道后台核对收款，未退款且未另行发货', confirm_no_refund: true, confirm_no_delivery: true });
function proof(order = ORDER) { return { order_no: order.order_no, provider: 'zpay', merchant_id: order.payment_merchant_id,
    provider_trade_no: order.provider_trade_no, payment_channel: order.payment_channel, amount_minor: order.total_minor, currency: 'CNY',
    verified_payload: { verified_by: 'authenticated_query', event_status: 'paid', provider_order_no: order.order_no,
        merchant_id: order.payment_merchant_id, provider_trade_no: order.provider_trade_no, payment_channel: order.payment_channel,
        amount_minor: order.total_minor, currency: 'CNY', checkout_trade_no: order.provider_trade_no, raw_secret: 'private-query-proof' } }; }
function fixture(options = {}) {
    const calls = []; const queries = []; const payments = [];
    const purchase = Object.hasOwn(options, 'purchase') ? options.purchase : { ...ORDER };
    const db = { from(table) {
        const values = table === 'tg_purchase_orders' ? purchase : table === 'tg_redemption_orders' ? options.deliveries || [] : options.history || [];
        const query = { select(fields) { queries.push({ table, fields }); return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
            maybeSingle() { return Promise.resolve({ data: values, error: options.readError || null }); },
            then(resolve, reject) { return Promise.resolve({ data: values, error: options.readError || null }).then(resolve, reject); } };
        return query;
    }, async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'fn_tg_purchase_fulfillment_review_ready') return { data: options.ready !== false, error: options.readyError || null };
        if (name === 'fn_tg_approve_purchase_fulfillment') {
            if (options.approval) return options.approval(args);
            return { data: options.result || { success: true, existing: false, order: { ...purchase, payment_status: 'paid', fulfillment_status: 'pending', updated_at: NOW } }, error: options.rpcError || null };
        }
        throw new Error('Unexpected RPC');
    } };
    const gateway = { async queryPayment({ order }) {
        payments.push(order.order_no);
        if (options.queryError) throw new Error('private-provider-error-with-key');
        return Object.hasOwn(options, 'verified') ? options.verified : proof(order);
    } };
    const review = createPurchaseReview({ env: { TG_FULFILLMENT_ENABLED: 'true', ...options.env }, gateway, now: () => new Date(NOW) });
    return { db, review, calls, queries, payments };
}
const approvals = (f) => f.calls.filter((call) => call.name === 'fn_tg_approve_purchase_fulfillment');
async function approve(f, input = INPUT) { return f.review.approve({ supabase: f.db, actorId: ACTOR, input }); }
async function details(f) { return f.review.details({ supabase: f.db, orderNo: ORDER.order_no }); }
function noSecrets(value) { assert.doesNotMatch(JSON.stringify(value), /private-|status_token|idempotency|verified_payload|payment_merchant_id|provider_trade_no|raw_secret/); }

test('read-only review independently queries receipt, exposes exact amount and no private payment data', async () => {
    const f = fixture({ history: [{ actor_user_id: ACTOR, created_at: NOW, metadata: { note: '测试历史备注', secret: 'private-audit-secret' } }] });
    const data = await details(f);
    assert.equal(data.order.total_minor, 707); assert.equal(data.order.fulfillment_status, 'not_started');
    assert.equal(data.review.can_approve, true); assert.equal(data.review.ready, true); assert.equal(data.review.worker_enabled, true);
    assert.equal(data.payment_check.status, 'confirmed'); assert.equal(data.payment_check.checked_at, NOW);
    assert.equal(data.review.receipt_recorded_at, ORDER.paid_at); assert.equal(data.reviews[0].note, '测试历史备注');
    assert.equal(approvals(f).length, 0); assert.deepEqual(f.payments, [ORDER.order_no]); noSecrets(data);
    assert.ok(f.queries.some((q) => q.table === 'tg_audit_events'));
});
test('approval rechecks receipt and delegates one atomic task creation with the exact snapshot and real administrator', async () => {
    const f = fixture(); await details(f); const data = await approve(f);
    assert.equal(f.payments.length, 2); assert.equal(approvals(f).length, 1);
    assert.equal(approvals(f)[0].args.p_actor_id, ACTOR); assert.equal(approvals(f)[0].args.p_expected_updated_at, ORDER.updated_at);
    assert.equal(approvals(f)[0].args.p_payment_checked_at, NOW); assert.equal(approvals(f)[0].args.p_verified_payment.verified_by, 'authenticated_query');
    assert.equal(approvals(f)[0].args.p_verified_payment.checkout_trade_no, ORDER.provider_trade_no);
    assert.equal(Object.hasOwn(approvals(f)[0].args.p_verified_payment, 'raw_secret'), false);
    assert.deepEqual(Object.keys(approvals(f)[0].args.p_verified_payment).sort(), ['amount_minor', 'checkout_trade_no', 'currency', 'event_status', 'merchant_id', 'payment_channel', 'provider_order_no', 'provider_trade_no', 'verified_by']);
    assert.equal(approvals(f)[0].args.p_confirm_no_refund, true); assert.equal(approvals(f)[0].args.p_confirm_no_delivery, true);
    assert.equal(data.order.payment_status, 'paid'); assert.equal(data.order.fulfillment_status, 'pending'); assert.equal(data.existing, false); noSecrets(data);
});
for (const [name, changes, code] of [
    ['USDT', { payment_provider: 'nowpayments', payment_channel: 'usdt_bep20' }, 'provider_unsupported'],
    ['cancelled receipt', { cancelled_at: NOW }, 'cancelled_order'],
    ['unpaid receipt', { paid_at: null }, 'payment_not_recorded'],
    ['checkout never started', { checkout_started_at: null }, 'payment_not_recorded'],
    ['unbound trade', { provider_trade_no: null }, 'payment_not_recorded'],
    ['unreconciled checkout alias', { provider_trade_no: ORDER.order_no }, 'payment_not_recorded'],
    ['uncertain manual-review cause', { last_error_code: 'provider_timeout' }, 'not_reviewable'],
    ['unexpired pending payment', { payment_status: 'awaiting_payment' }, 'not_reviewable']
]) test(`review cannot approve ${name}`, async () => {
    const f = fixture({ purchase: { ...ORDER, ...changes } });
    assert.equal((await details(f)).review.blocked_code, code);
    await assert.rejects(approve(f), { code }); assert.equal(approvals(f).length, 0);
});
for (const status of ['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled']) {
    test(`an existing ${status} delivery is displayed and never replaced`, async () => {
        const f = fixture({ deliveries: [{ ...DELIVERY, status, provider_order_id: 'upstream-original' }] });
        const data = await details(f); assert.equal(data.review.can_approve, false); assert.equal(data.fulfillment.status, status);
        assert.equal(data.fulfillment.has_provider_order, true); assert.equal(data.order.fulfillment_status, status);
        await assert.rejects(approve(f), { code: 'fulfillment_exists' }); assert.equal(approvals(f).length, 0); noSecrets(data);
    });
}
for (const options of [{ ready: false }, { readyError: { code: 'PGRST202' } }, { readyError: { code: '42883' } }]) {
    test(`missing migration is a readable closed gate (${JSON.stringify(options)})`, async () => {
        const f = fixture(options); assert.equal((await details(f)).review.blocked_code, 'migration_required');
        await assert.rejects(approve(f), { code: 'migration_required' }); assert.equal(approvals(f).length, 0);
    });
}
for (const [name, options, code] of [
    ['unpaid', { verified: null }, 'payment_not_paid'], ['provider unavailable', { queryError: true }, 'payment_unconfirmed'],
    ['refund or unknown channel status', { queryError: true }, 'payment_unconfirmed']
]) test(`live ${name} cannot authorize approval`, async () => {
    const f = fixture(options); assert.equal((await details(f)).review.blocked_code, code);
    await assert.rejects(approve(f), { code }); assert.equal(approvals(f).length, 0);
});
for (const field of ['provider', 'order_no', 'merchant_id', 'provider_trade_no', 'payment_channel', 'amount_minor', 'currency']) {
    test(`approval rejects mismatched payment ${field}`, async () => {
        const verified = proof(); verified[field] = field === 'amount_minor' ? 700 : 'mismatch';
        const f = fixture({ verified }); await assert.rejects(approve(f), { code: 'payment_binding_mismatch' }); assert.equal(approvals(f).length, 0);
    });
}
for (const field of ['verified_by', 'event_status', 'provider_order_no', 'merchant_id', 'provider_trade_no', 'checkout_trade_no', 'payment_channel', 'amount_minor', 'currency']) {
    for (const missing of [false, true]) test(`approval rejects ${missing ? 'missing' : 'mismatched'} authenticated proof ${field}`, async () => {
        const verified = proof(); if (missing) delete verified.verified_payload[field]; else verified.verified_payload[field] = 'mismatch';
        const f = fixture({ verified }); await assert.rejects(approve(f), { code: 'payment_binding_mismatch' }); assert.equal(approvals(f).length, 0);
    });
}
for (const changes of [
    { action: 'retry_provider_purchase' }, { order_no: 'TG-ABCDEFGHIJKLMNOPQRST' }, { actor_id: ACTOR }, { verified_payment: proof() },
    { amount_minor: 1 }, { expected_updated_at: null }, { expected_updated_at: 'invalid' }, { expected_updated_at: '2026-10-16' },
    { note: '短' }, { note: 'x'.repeat(501) }, { note: 'invalid\x01note' }, { confirm_no_refund: false }, { confirm_no_refund: 'true' },
    { confirm_no_delivery: false }, { confirm_no_delivery: 1 }
]) test(`strict approval input rejects ${Object.keys(changes).join(',')}: ${JSON.stringify(changes).slice(0, 70)}`, async () => {
    const f = fixture(); await assert.rejects(approve(f, { ...INPUT, ...changes }), { code: 'invalid_review' }); assert.equal(f.calls.length, 0);
});
test('approval note is trimmed without modifying the original input', () => {
    const input = { ...INPUT, note: '  已核对收款并确认未退款\n未另行发货  ' };
    assert.equal(approvalInput(input).note, input.note.trim()); assert.ok(input.note.startsWith('  '));
});
for (const code of ['review_stale', 'fulfillment_exists', 'cancelled_order', 'payment_binding_mismatch', 'not_reviewable']) {
    test(`locked database ${code} is returned without claiming approval`, async () => {
        const f = fixture({ result: { success: false, code } }); await assert.rejects(approve(f), { code });
    });
}
test('idempotent retry of an approved paid order returns the original task even after its status advances', async () => {
    const f = fixture({ purchase: { ...ORDER, payment_status: 'paid', last_error_code: null }, deliveries: [{ ...DELIVERY, status: 'processing' }],
        result: { success: true, existing: true, order: { ...ORDER, payment_status: 'paid', fulfillment_status: 'processing' } } });
    const result = await approve(f); assert.equal(result.existing, true); assert.equal(result.order.fulfillment_status, 'processing'); assert.equal(approvals(f).length, 1);
});
test('ordinary paid order without this approval audit cannot create or replace a task', async () => {
    const f = fixture({ purchase: { ...ORDER, payment_status: 'paid' }, deliveries: [{ ...DELIVERY }], result: { success: false, code: 'fulfillment_exists' } });
    await assert.rejects(approve(f), { code: 'fulfillment_exists' });
});
test('concurrent requests use the same snapshot and atomic RPC rather than issuing upstream purchases', async () => {
    let count = 0;
    const f = fixture({ approval: async () => ({ data: { success: true, existing: count++ > 0, order: { ...ORDER, payment_status: 'paid', fulfillment_status: 'pending' } } }) });
    const results = await Promise.all([approve(f), approve(f)]);
    assert.deepEqual(results.map((r) => r.existing).sort(), [false, true]); assert.equal(approvals(f).length, 2);
    assert.ok(approvals(f).every((c) => c.args.p_order_no === ORDER.order_no && c.args.p_expected_updated_at === ORDER.updated_at));
});
for (const change of [{ telegram_username: 'other_user' }, { stars_quantity: 100 }, { fulfillment_status: 'not_started' }, { total_minor: 708 }, { payment_status: 'manual_review' }]) {
    test(`inconsistent approval response is rejected: ${JSON.stringify(change)}`, async () => {
        const f = fixture({ result: { success: true, existing: false, order: { ...ORDER, payment_status: 'paid', fulfillment_status: 'pending', ...change } } });
        await assert.rejects(approve(f), /Invalid TG approval result/);
    });
}
test('delivery binding corruption or duplicate delivery rows fail closed', async () => {
    for (const deliveries of [[{ ...DELIVERY, telegram_username: 'other_user' }], [DELIVERY, DELIVERY]]) {
        const f = fixture({ deliveries }); await assert.rejects(details(f), /Invalid TG review fulfillment/); assert.equal(approvals(f).length, 0);
    }
});
test('missing order returns 404 and never calls the gateway', async () => {
    const f = fixture({ purchase: null }); await assert.rejects(approve(f), { statusCode: 404 }); assert.equal(f.payments.length, 0);
});
function handlerFixture(options = {}) {
    const f = fixture(options);
    const admin = { async requireAdmin() { if (options.authError) throw Object.assign(new Error('请登录'), { statusCode: 401 });
        return { supabase: f.db, user: { id: ACTOR }, isSuperAdmin: options.superAdmin !== false }; },
        async parseJsonBody(req) { if (options.parseError) throw new Error('private-parse-error'); return req.body; },
        sendJson(res, status, body) { res.statusCode = status; res.body = body; } };
    const handler = createPurchasesHandler({ admin, env: options.runtime || {}, review: f.review, resolution: { async details() { return { can_close: false, can_resume: false, closed_at: null }; } } });
    return { ...f, async call(changes = {}) { const req = { method: 'POST', url: '/api/admin/tg/purchases',
        headers: { origin: 'http://127.0.0.1:8000', host: '127.0.0.1:8000', 'content-type': 'application/json' }, body: INPUT, ...changes };
        const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; } }; await handler(req, res); return res; } };
}
test('admin API supports detail GET and JSON approval POST with no-store', async () => {
    const f = handlerFixture(); const detail = await f.call({ method: 'GET', url: `/api/admin/tg/purchases?orderNo=${ORDER.order_no}` });
    assert.equal(detail.statusCode, 200); assert.equal(detail.headers['Cache-Control'], 'no-store'); assert.equal(approvals(f).length, 0); noSecrets(detail.body);
    const result = await f.call(); assert.equal(result.statusCode, 200); assert.equal(result.body.order.payment_status, 'paid'); noSecrets(result.body);
});
for (const [name, options, expected] of [['unauthenticated', { authError: true }, 401], ['ordinary administrator', { superAdmin: false }, 403]]) {
    test(`${name} cannot read or approve a purchase review`, async () => {
        const f = handlerFixture(options);
        for (const method of ['GET', 'POST']) assert.equal((await f.call({ method, url: `/api/admin/tg/purchases?orderNo=${ORDER.order_no}` })).statusCode, expected);
        assert.equal(f.calls.length, 0); assert.equal(f.payments.length, 0);
    });
}
for (const headers of [{}, { origin: 'https://evil.example', 'content-type': 'application/json' },
    { origin: 'http://127.0.0.1:8001', host: '127.0.0.1:8000', 'content-type': 'application/json' },
    { origin: 'https://www.fatherkey.com', 'content-type': 'application/json' }]) {
    test(`write request rejects untrusted Origin: ${headers.origin || 'missing'}`, async () => {
        const f = handlerFixture(); assert.equal((await f.call({ headers })).statusCode, 403); assert.equal(f.calls.length, 0);
    });
}
test('production accepts only the TG administrator origin', async () => {
    const f = handlerFixture({ runtime: { NODE_ENV: 'production' } }); assert.equal((await f.call()).statusCode, 403);
    assert.equal((await f.call({ headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' } })).statusCode, 200);
});
test('non-JSON, malformed JSON and unsupported methods are rejected without checking payment', async () => {
    const f = handlerFixture(); assert.equal((await f.call({ headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'text/plain' } })).statusCode, 415);
    const method = await f.call({ method: 'DELETE' }); assert.equal(method.statusCode, 405); assert.equal(method.headers.Allow, 'GET, POST');
    assert.equal((await handlerFixture({ parseError: true }).call()).statusCode, 400); assert.equal(f.payments.length, 0);
});
test('malformed or repeated detail identifiers do not hit the database', async () => {
    const f = handlerFixture();
    for (const suffix of ['bad', `${ORDER.order_no}&orderNo=${ORDER.order_no}`]) assert.equal((await f.call({ method: 'GET', url: `/api/admin/tg/purchases?orderNo=${suffix}` })).statusCode, 400);
    assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
});
test('database errors are redacted while missing migration and stale review keep actionable codes', async () => {
    const failed = handlerFixture({ rpcError: { code: 'XX001', message: 'private-rpc-secret' } });
    const response = await failed.call(); assert.equal(response.statusCode, 500); noSecrets(response.body); assert.equal(response.body.code, 'tg_service_error');
    assert.equal((await handlerFixture({ ready: false }).call()).body.code, 'migration_required');
    assert.equal((await handlerFixture({ result: { success: false, code: 'review_stale' } }).call()).body.code, 'review_stale');
});
