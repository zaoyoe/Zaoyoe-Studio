'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const adminPath = require.resolve('../api/_lib/admin');
const previousAdmin = require.cache[adminPath];
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: {} };
const { createPurchaseCompletion, parse, requestHash } = require('../server/tg/purchase-completion');
const { createPurchasesHandler } = require('../server/api-handlers/admin/tg/purchases');
if (previousAdmin) require.cache[adminPath] = previousAdmin; else delete require.cache[adminPath];
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const TASK = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const ACTOR = 'f47ac10b-58cc-4372-a567-0e02b2c3d481';
const OPERATION = 'f47ac10b-58cc-4372-a567-0e02b2c3d483';
const VERSION = '2026-10-17T10:00:00.123456+00:00';
const CLOSED = '2026-10-17T11:00:00.000Z';
const PRIVATE = 'private-refund-reference-123';
const NOTE = '已按原渠道完成退款，到账时间以支付渠道为准。';
const ORDER = { id: ID, order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', telegram_username: 'recipient_test', product_family: 'telegram_stars', term_months: null,
    stars_quantity: 50, currency: 'CNY', total_minor: 707, subtotal_minor: 700, payment_fee_minor: 7, payment_fee_rate_bps: 100,
    price_version: 3, payment_channel: 'alipay', payment_status: 'paid', paid_at: VERSION, cancelled_at: null, closed_at: null, updated_at: VERSION };
const FULFILLMENT = { id: TASK, order_source: 'purchase', purchase_id: ID, code_id: null, telegram_username: ORDER.telegram_username,
    product_family: ORDER.product_family, term_months: null, stars_quantity: 50, status: 'manual_review', lease_token: null, lease_expires_at: null,
    submitted_at: VERSION, provider_order_id: null, attempt_count: 1, provider_idempotency_key: PRIVATE, updated_at: VERSION };
const INPUT = { action: 'complete_review', order_no: ORDER.order_no, expected_updated_at: VERSION, expected_task_id: TASK,
    expected_task_updated_at: VERSION, operation_id: OPERATION, outcome: 'refunded', note: `已在支付平台核实退款：${PRIVATE}`,
    completion_note: NOTE, confirm_payment_handled: true, confirm_stop_fulfillment: true, confirm_upstream_risk: true };
function fixture(options = {}) {
    const calls = []; const queries = [];
    const order = { ...ORDER, ...options.order }; const task = { ...FULFILLMENT, ...options.task };
    const db = { from(table) {
        let fields; const filters = [];
        function result() {
            queries.push({ table, fields, filters });
            return { data: table === 'tg_purchase_orders' ? options.missing ? null : order : options.tasks || [task], error: options.readError };
        }
        return { select(value) { fields = value; return this; }, eq(...value) { filters.push(value); return this; }, limit() { return this; },
            async maybeSingle() { return result(); }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
    }, async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'fn_tg_purchase_resolution_ready') return { data: true };
        if (name === 'fn_tg_purchase_payment_review_completion_ready') return { data: options.paymentReviewReady ?? true, error: options.paymentReviewReadyError };
        if (name === 'fn_tg_purchase_completion_ready') return { data: options.ready ?? true, error: options.readyError };
        if (name === 'fn_tg_complete_purchase_review') return { data: options.result ?? { success: true, existing: options.existing === true,
            order: { ...order, fulfillment_status: 'cancelled', closed_at: CLOSED, completion_note: args.p_completion_note,
                close_note: PRIVATE, completion_outcome: 'refunded', completion_request_hash: PRIVATE, closed_by: ACTOR } }, error: options.rpcError };
        throw new Error('Unexpected offline RPC: ' + name);
    } };
    const completion = createPurchaseCompletion();
    return { db, calls, queries, complete: (input = INPUT, actorId = ACTOR) => completion.complete({ supabase: db, actorId, input }),
        details: () => completion.details({ supabase: db, orderNo: ORDER.order_no }) };
}
const writes = fixture => fixture.calls.filter(call => call.name === 'fn_tg_complete_purchase_review');

test('completion parsing binds the exact task versions, outcome and both independent notes', () => {
    for (const outcome of ['refunded', 'delivery_confirmed', 'agreed_settlement', 'no_valid_payment']) {
        const parsed = parse({ ...INPUT, outcome, note: `  ${INPUT.note}  `, completion_note: `  ${NOTE}\n第二行用户说明。  ` });
        assert.equal(parsed.note, INPUT.note); assert.equal(parsed.completion_note, `${NOTE}\n第二行用户说明。`);
        assert.equal(parsed.expected_updated_at, VERSION); assert.equal(parsed.expected_task_updated_at, VERSION);
        assert.equal(parsed.outcome, outcome);
    }
    assert.equal(parse({ ...INPUT, expected_task_id: null, expected_task_updated_at: null }).expected_task_id, null);
});

test('malformed, forged, incomplete and unconfirmed completion inputs never reach the database', async () => {
    const changes = [{ action: 'close_order' }, { order_no: 'TG-WRONG' }, { expected_updated_at: null }, { expected_updated_at: '2026-10-17' },
        { expected_task_id: 'wrong' }, { expected_task_id: null }, { expected_task_updated_at: null }, { operation_id: '' }, { outcome: 'force_closed' },
        { note: '太短' }, { note: 'x'.repeat(501) }, { note: 'private\tevidence' }, { completion_note: '太短' }, { completion_note: 'x'.repeat(501) },
        { completion_note: 'hello\u0000world' }, { completion_note: 'hello\rworld' }, { confirm_payment_handled: 'true' },
        { confirm_stop_fulfillment: false }, { confirm_upstream_risk: false }, { closed_by: ACTOR }, { provider_order_id: PRIVATE }];
    for (const change of changes) {
        const f = fixture(); await assert.rejects(f.complete({ ...INPUT, ...change }), { code: 'invalid_completion', statusCode: 400 });
        assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
    }
    const f = fixture(); await assert.rejects(f.complete(INPUT, 'not-an-actor'), { code: 'invalid_completion' }); assert.equal(f.calls.length, 0);
});

test('request identity is stable for a retry and changes with the actor, notes, task or settlement', () => {
    assert.equal(requestHash(INPUT, ACTOR), requestHash({ ...INPUT }, ACTOR));
    assert.match(requestHash(INPUT, ACTOR), /^[0-9a-f]{64}$/);
    for (const change of [{ completion_note: NOTE + '请查收。' }, { note: INPUT.note + '已存档。' }, { outcome: 'delivery_confirmed' }, { outcome: 'no_valid_payment' },
        { expected_updated_at: CLOSED }, { expected_task_updated_at: CLOSED }, { expected_task_id: null }, { operation_id: TASK }]) {
        assert.notEqual(requestHash(INPUT, ACTOR), requestHash({ ...INPUT, ...change }, ACTOR));
    }
    assert.notEqual(requestHash(INPUT, ACTOR), requestHash(INPUT, ID));
});

test('absent or not-ready migrations disable completion without selecting unavailable columns', async () => {
    for (const options of [{ ready: false }, { ready: { ready: true } }, { readyError: { code: 'PGRST202' } }, { readyError: { code: '42883' } }]) {
        const f = fixture(options); const details = await f.details(); assert.equal(details.ready, false); assert.equal(details.can_complete, false);
        await assert.rejects(f.complete(), { code: 'completion_migration_required' }); assert.equal(f.queries.length, 0); assert.equal(writes(f).length, 0);
    }
    const f = fixture({ readyError: new Error(PRIVATE) }); await assert.rejects(f.details(), /private-refund/); assert.equal(f.queries.length, 0);
});

test('eligibility reads retain submission risk while returning only safe capabilities and exact versions', async () => {
    const f = fixture(); const result = await f.details();
    assert.equal(result.ready, true); assert.equal(result.can_complete, true); assert.equal(result.upstream_submitted, true);
    assert.equal(result.expected_updated_at, VERSION); assert.equal(result.expected_task_updated_at, VERSION); assert.equal(result.expected_task_id, TASK);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(PRIVATE)); assert.equal(writes(f).length, 0);
    assert.equal((await fixture({ tasks: [] }).details()).can_complete, true);
    assert.equal((await fixture({ task: { status: 'failed' } }).details()).can_complete, true);
});

for (const [label, changes] of [
    ['unverified receipt with a delivery task', { order: { paid_at: null, payment_status: 'manual_review' } }],
    ['pending payment', { order: { payment_status: 'awaiting_payment' } }],
    ['cancelled purchase', { order: { cancelled_at: VERSION } }],
    ['checkout lease', { order: { checkout_lease_token: PRIVATE } }],
    ['residual checkout expiry', { order: { checkout_lease_expires_at: VERSION } }],
    ['processing task', { task: { status: 'processing' } }],
    ['succeeded task', { task: { status: 'succeeded' } }],
    ['claimable task', { task: { status: 'pending' } }],
    ['residual task lease', { task: { lease_token: PRIVATE } }],
    ['residual task expiry', { task: { lease_expires_at: VERSION } }],
    ['wrong buyer', { task: { telegram_username: 'different_recipient' } }],
    ['wrong purchase', { task: { purchase_id: TASK } }],
    ['redemption source', { task: { order_source: 'redemption' } }],
    ['wrong quantity', { task: { stars_quantity: 100 } }],
    ['wrong code binding', { task: { code_id: TASK } }]
]) test(`completion eligibility blocks ${label} without changing or reclaiming the task`, async () => {
    const f = fixture(changes); const result = await f.details(); assert.equal(result.can_complete, false); assert.ok(result.message); assert.equal(writes(f).length, 0);
});

test('ambiguous or missing purchase/task binding fails closed', async () => {
    for (const options of [{ tasks: [FULFILLMENT, FULFILLMENT] }, { missing: true }]) {
        const f = fixture(options); await assert.rejects(f.details(), { code: 'completion_not_allowed' }); assert.equal(writes(f).length, 0);
    }
});

test('an existing completion returns its saved public explanation and cannot be completed again', async () => {
    const f = fixture({ order: { closed_at: CLOSED, completion_note: NOTE, completion_outcome: 'refunded' }, task: { status: 'cancelled' } });
    const result = await f.details(); assert.equal(result.can_complete, false); assert.equal(result.closed_at, CLOSED); assert.equal(result.completion_note, NOTE);
    assert.equal(result.outcome, 'refunded'); assert.equal(writes(f).length, 0);
});

test('atomic completion forwards confirmations, exact versions and idempotency while preserving payment and hiding internal evidence', async () => {
    const f = fixture(); const result = await f.complete(); const call = writes(f)[0];
    assert.equal(result.success, true); assert.equal(result.existing, false); assert.equal(result.order.fulfillment_status, 'closed');
    assert.equal(result.order.completion_note, NOTE); assert.equal(result.order.payment_status, 'paid'); assert.equal(result.order.total_minor, 707);
    assert.equal(result.order.closed_at, CLOSED); assert.equal(call.args.p_expected_updated_at, VERSION); assert.equal(call.args.p_expected_task_id, TASK);
    assert.equal(call.args.p_expected_task_updated_at, VERSION); assert.equal(call.args.p_operation_id, OPERATION); assert.equal(call.args.p_actor_id, ACTOR);
    assert.equal(call.args.p_request_hash, requestHash(INPUT, ACTOR)); assert.equal(call.args.p_note, INPUT.note); assert.equal(call.args.p_completion_note, NOTE);
    for (const key of ['p_confirm_payment_handled', 'p_confirm_stop_fulfillment', 'p_confirm_upstream_risk']) assert.equal(call.args[key], true);
    assert.deepEqual(f.calls.map(call => call.name), ['fn_tg_purchase_completion_ready', 'fn_tg_complete_purchase_review']);
    assert.equal(f.queries.length, 0, 'all write eligibility is rechecked atomically in the RPC');
    assert.doesNotMatch(JSON.stringify(result), /private-refund|closed_by|completion_outcome|completion_request_hash|close_note/);
});

test('an identical retry preserves the operation identity and recognizes the committed result', async () => {
    const f = fixture({ existing: true }); const first = await f.complete(); const retry = await f.complete({ ...INPUT });
    assert.equal(first.existing, true); assert.deepEqual(first, retry); assert.deepEqual(writes(f)[0].args, writes(f)[1].args);
});

for (const code of ['completion_stale', 'completion_active', 'completion_not_allowed', 'completion_outcome_mismatch', 'completion_conflict', 'order_closed']) test(`atomic ${code} cannot become UI success`, async () => {
    const f = fixture({ result: { success: false, code } }); await assert.rejects(f.complete(), { code, statusCode: 409 });
});

test('partial migrations and malformed commit responses cannot claim completion', async () => {
    for (const code of ['PGRST202', '42883', '42703']) await assert.rejects(fixture({ rpcError: { code } }).complete(), { code: 'completion_migration_required' });
    for (const result of [null, { success: true, existing: false }, { success: true, existing: 'yes', order: ORDER },
        { success: true, existing: false, order: { ...ORDER, fulfillment_status: 'closed' } },
        { success: true, existing: false, order: { ...ORDER, closed_at: CLOSED, completion_note: '与提交说明不一致' } },
        { success: true, existing: false, order: { ...ORDER, order_no: 'TGP-ZYXWVUTSRQPONMLKJIHG', closed_at: CLOSED, completion_note: NOTE } }]) {
        // null deliberately uses a false-success response instead of the fixture default.
        const f = fixture({ result: result || { success: false, code: 'unexpected_private_code' } });
        await assert.rejects(f.complete());
    }
});

function endpoint(options = {}) {
    const activity = []; const db = {};
    const admin = { async requireAdmin() { activity.push('authenticate'); if (options.authError) throw Object.assign(new Error('Unauthorized'), { statusCode: options.authError });
        return { supabase: db, user: { id: ACTOR }, isSuperAdmin: options.role !== false }; },
        async parseJsonBody(req) { activity.push('parse'); return req.body; }, sendJson(res, code, body) { res.statusCode = code; res.body = body; } };
    const completion = { async details(input) { activity.push(input); return { ready: false, can_complete: false, message: '请先升级数据库' }; },
        async complete(input) { activity.push(input); if (options.error) throw options.error; return { success: true, existing: true, order: { closed_at: CLOSED } }; } };
    return { activity, db, handler: createPurchasesHandler({ admin, env: { NODE_ENV: 'production' }, completion }) };
}
async function call(handler, overrides = {}) {
    const req = { method: 'POST', url: '/api/admin/tg/purchases', headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' }, body: INPUT, ...overrides };
    const res = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; } }; await handler(req, res); return res;
}
test('completion endpoint authenticates the superadmin, checks origin and forwards only the authenticated actor', async () => {
    const f = endpoint(); const res = await call(f.handler); assert.equal(res.statusCode, 200); assert.equal(f.activity[0], 'authenticate');
    assert.equal(f.activity[1], 'parse'); assert.deepEqual(f.activity[2], { supabase: f.db, actorId: ACTOR, input: INPUT });
    assert.equal(res.headers['cache-control'], 'no-store');
    for (const options of [{ role: false }, { authError: 401 }]) {
        const blocked = endpoint(options); const denial = await call(blocked.handler); assert.ok([401, 403].includes(denial.statusCode)); assert.deepEqual(blocked.activity, ['authenticate']);
    }
    const blocked = endpoint(); const denial = await call(blocked.handler, { headers: { origin: 'https://untrusted.example.test', 'content-type': 'application/json' } });
    assert.equal(denial.statusCode, 403); assert.deepEqual(blocked.activity, ['authenticate']);
});

test('eligibility endpoint is read only and tags the exact purchase even when migration is absent', async () => {
    const f = endpoint(); const res = await call(f.handler, { method: 'GET', url: `/?order_no=${ORDER.order_no}&completion=1` });
    assert.equal(res.statusCode, 200); assert.equal(res.body.order_no, ORDER.order_no); assert.equal(res.body.completion.can_complete, false);
    assert.deepEqual(f.activity, ['authenticate', { supabase: f.db, orderNo: ORDER.order_no }]);
});

test('completion endpoint keeps private infrastructure failures out of browser responses', async () => {
    const f = endpoint({ error: new Error(PRIVATE) }); const res = await call(f.handler);
    assert.equal(res.statusCode, 500); assert.doesNotMatch(JSON.stringify(res.body), new RegExp(PRIVATE));
});


const UNVERIFIED_ORDER = { payment_status: 'manual_review', paid_at: null };
const NO_PAYMENT_INPUT = { ...INPUT, expected_task_id: null, expected_task_updated_at: null, outcome: 'no_valid_payment',
    note: '已核对原商户订单、付款网络和到账记录，未发现有效付款。', completion_note: '经核对，此订单无有效付款，现已完结。如有付款凭据请联系管理员。' };

test('payment manual-review orders without a receipt or delivery task expose payment-specific completion choices', async () => {
    const f = fixture({ order: UNVERIFIED_ORDER, tasks: [] }); const result = await f.details();
    assert.equal(result.ready, true); assert.equal(result.can_complete, true); assert.equal(result.payment_unverified, true);
    assert.deepEqual(result.allowed_outcomes, ['no_valid_payment', 'refunded', 'agreed_settlement']);
    assert.equal(result.expected_task_id, null); assert.equal(result.expected_task_updated_at, null); assert.equal(result.upstream_submitted, false);
    assert.match(result.message, /链上记录/); assert.match(result.message, /迟到付款/); assert.equal(writes(f).length, 0);
    const paid = fixture({ paymentReviewReady: false }); const paidState = await paid.details();
    assert.deepEqual(paidState.allowed_outcomes, ['refunded', 'delivery_confirmed', 'agreed_settlement']);
    assert.equal(paidState.payment_unverified, false); assert.equal(paidState.can_complete, true);
    await paid.complete(); assert.equal(paid.calls.some(call => call.name === 'fn_tg_purchase_payment_review_completion_ready'), false);
});

test('missing payment-review increment blocks only its new capability and never submits a no-payment completion', async () => {
    for (const options of [{ paymentReviewReady: false }, { paymentReviewReady: { ready: true } },
        { paymentReviewReadyError: { code: 'PGRST202' } }, { paymentReviewReadyError: { code: '42883' } }]) {
        const f = fixture({ ...options, order: UNVERIFIED_ORDER, tasks: [] }); const details = await f.details();
        assert.equal(details.ready, false); assert.equal(details.can_complete, false); assert.deepEqual(details.allowed_outcomes, []);
        assert.match(details.message, /增量数据库升级/);
        await assert.rejects(f.complete(NO_PAYMENT_INPUT), { code: 'payment_review_completion_migration_required' });
        assert.equal(writes(f).length, 0);
    }
    await assert.rejects(fixture({ order: UNVERIFIED_ORDER, tasks: [], paymentReviewReadyError: new Error('offline capability error') }).details(), /offline capability/);
});

for (const [label, changes] of [
    ['checkout token', { order: { ...UNVERIFIED_ORDER, checkout_lease_token: PRIVATE } }],
    ['checkout expiry', { order: { ...UNVERIFIED_ORDER, checkout_lease_expires_at: VERSION } }],
    ['cancelled purchase', { order: { ...UNVERIFIED_ORDER, cancelled_at: VERSION } }],
    ['inconsistent paid status', { order: { paid_at: null, payment_status: 'paid' } }],
    ['any delivery task', { order: UNVERIFIED_ORDER, tasks: [FULFILLMENT] }]
]) test(`payment-review completion rejects ${label}`, async () => {
    const f = fixture({ tasks: [], ...changes }); const details = await f.details();
    assert.equal(details.can_complete, false); assert.deepEqual(details.allowed_outcomes, []); assert.equal(writes(f).length, 0);
});

test('no-payment completion preserves unverified payment facts, public explanation, task absence and retry identity', async () => {
    const f = fixture({ order: UNVERIFIED_ORDER, tasks: [] }); const result = await f.complete(NO_PAYMENT_INPUT);
    assert.equal(result.order.payment_status, 'manual_review'); assert.equal(result.order.fulfillment_status, 'closed');
    assert.equal(result.order.completion_note, NO_PAYMENT_INPUT.completion_note); assert.equal(result.order.checkout_url, undefined);
    assert.equal(writes(f)[0].args.p_outcome, 'no_valid_payment'); assert.equal(writes(f)[0].args.p_expected_task_id, null);
    assert.equal(writes(f)[0].args.p_expected_task_updated_at, null);
    assert.deepEqual(f.calls.map(call => call.name), ['fn_tg_purchase_completion_ready', 'fn_tg_purchase_payment_review_completion_ready', 'fn_tg_complete_purchase_review']);
    assert.equal(f.queries.length, 0); assert.doesNotMatch(JSON.stringify(result), /private-|close_note|closed_by|completion_outcome/);
    const replay = fixture({ order: UNVERIFIED_ORDER, tasks: [], existing: true });
    assert.deepEqual(await replay.complete(NO_PAYMENT_INPUT), await replay.complete({ ...NO_PAYMENT_INPUT }));
    assert.deepEqual(writes(replay)[0].args, writes(replay)[1].args);
});


test('legacy closure gives payment-review orders a precise completion path without invoking write RPCs', async () => {
    const { createPurchaseResolution } = require('../server/tg/purchase-resolution');
    const f = fixture({ order: UNVERIFIED_ORDER, tasks: [] }); const resolution = createPurchaseResolution();
    const result = await resolution.details({ supabase: f.db, orderNo: ORDER.order_no });
    assert.equal(result.can_close, false); assert.equal(result.can_resume, false); assert.match(result.message, /人工完结.*支付核验/);
    await assert.rejects(resolution.resolve({ supabase: f.db, actorId: ACTOR, input: { action: 'close_order', order_no: ORDER.order_no,
        expected_updated_at: VERSION, note: INPUT.note, confirm_no_delivery: true, confirm_payment_handled: true } }), { code: 'payment_review_completion_required' });
    assert.equal(f.calls.some(call => call.name !== 'fn_tg_purchase_resolution_ready'), false);
});
