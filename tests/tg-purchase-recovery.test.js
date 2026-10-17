'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const adminPath = require.resolve('../api/_lib/admin');
const previous = require.cache[adminPath];
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: {} };
const { createPurchaseRecovery, parse, requestHash } = require('../server/tg/purchase-recovery');
const { createPurchasesHandler } = require('../server/api-handlers/admin/tg/purchases');
if (previous) require.cache[adminPath] = previous; else delete require.cache[adminPath];
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const TASK = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const ACTOR = 'f47ac10b-58cc-4372-a567-0e02b2c3d481';
const UPSTREAM = 'f47ac10b-58cc-4372-a567-0e02b2c3d482';
const OPERATION = 'f47ac10b-58cc-4372-a567-0e02b2c3d483';
const NOW = '2026-10-17T06:00:00.000Z';
const VERSION = '2026-10-17T05:00:00.000Z';
const KEY = 'private-original-submission-key';
const ORDER = { id: ID, order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', telegram_username: 'recipient_test', product_family: 'telegram_stars', term_months: null,
    stars_quantity: 50, currency: 'CNY', total_minor: 707, subtotal_minor: 700, payment_fee_minor: 7, payment_fee_rate_bps: 100,
    price_version: 3, payment_channel: 'alipay', payment_status: 'paid', paid_at: VERSION, cancelled_at: null, closed_at: null, updated_at: VERSION };
const FULFILLMENT = { id: TASK, order_no: 'TG-ABCDEFGHIJKLMNOPQRST', purchase_id: ID, code_id: null, order_source: 'purchase', provider: 'gramix',
    telegram_username: ORDER.telegram_username, product_family: ORDER.product_family, term_months: null, stars_quantity: 50,
    provider_order_id: null, provider_payment_currency: 'usdt', provider_idempotency_key: KEY, status: 'manual_review',
    submitted_at: '2026-10-16T11:00:00.000Z', attempt_count: 1, lease_token: null, lease_expires_at: null, updated_at: VERSION };
const identity = { order_no: ORDER.order_no, expected_updated_at: VERSION, expected_task_updated_at: VERSION };
const linkInspect = { ...identity, action: 'inspect_upstream_order', provider_order_id: UPSTREAM };
const commit = { operation_id: OPERATION, note: '已核对本次原上游请求及接收账号', confirm_original_request: true };
const link = { ...linkInspect, ...commit, action: 'link_upstream_order' };
const evidence = { kind: 'provider_support', reference: 'GRAMIX-TICKET-123', confirmed_at: '2026-10-17T05:50:00Z', summary: '上游工单明确确认本次原始提交未受理、未发货且不会后续发货，原记录已归档。' };
const close = { ...identity, ...commit, action: 'close_with_nonacceptance', evidence,
    confirm_nonacceptance: true, confirm_no_delivery: true, confirm_payment_handled: true };
function provider(patch = {}) { return { statusCode: 200, data: { id: UPSTREAM, recipientName: 'recipient_test', type: 'stars', method: 'api', status: 'completed',
    currency: 'usd', amount: '0.75', extraData: { quantityStars: 50 }, idempotencyKey: KEY, ...patch } }; }
const absent = { status: 'not_found', verified: false, search: { exhausted: true, missing_correlation: false, pages: 1, scanned: 1 } };
function fixture(options = {}) {
    const calls = []; const queries = []; const upstream = [];
    const order = { ...ORDER, ...options.order }; const task = { ...FULFILLMENT, ...options.task };
    const db = { from(table) {
        let fields; const filters = [];
        const query = { select(value) { fields = value; return this; }, eq(...args) { filters.push(args); return this; }, ilike(...args) { filters.push(args); return this; },
            order() { return this; }, limit() { return this; },
            async maybeSingle() { return run(); }, then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); } };
        function run() {
            queries.push({ table, fields, filters });
            const values = table === 'tg_purchase_orders' ? options.missing ? null : order
                : table === 'tg_redemption_orders' ? fields === 'id' ? options.owners || [] : options.tasks || [task]
                    : table === 'tg_purchase_recovery_events' ? filters.some(([key]) => key === 'operation_id') ? options.receipt || null : options.records || [] : [];
            return { data: values, error: options.readError || null };
        }
        return query;
    }, async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'fn_tg_purchase_recovery_ready') return { data: options.ready !== false, error: options.readyError || null };
        if (name === 'fn_tg_apply_purchase_recovery') return { data: options.result || { success: true, existing: !!options.receipt,
            order: { ...order, fulfillment_status: args.p_action === 'close_with_nonacceptance' ? 'closed' : 'succeeded', ...(args.p_action === 'close_with_nonacceptance' ? { closed_at: NOW } : {}) } }, error: options.rpcError || null };
        throw new Error('Unexpected RPC ' + name);
    } };
    const client = { async getOrder(id, opts) { upstream.push({ method: 'get', id, opts }); if (options.getError) throw options.getError; return options.provider || provider(); },
        async listOrders(opts) { upstream.push({ method: 'list', opts }); return { statusCode: 200, data: { data: [], limit: 100, offset: 0, total: 0 } }; },
        async purchaseStars() { assert.fail('recovery must never buy'); }, async purchasePremium() { assert.fail('recovery must never buy'); } };
    const service = createPurchaseRecovery({ env: {}, clientFactory: () => client, now: () => new Date(NOW),
        ...(Object.hasOwn(options, 'negative') ? { queryUpstream: async () => { upstream.push({ method: 'negative' }); return options.negative; } } : {}) });
    return { db, service, calls, queries, upstream, run(input = link) { return service.execute({ supabase: db, actorId: ACTOR, input }); } };
}
const writes = f => f.calls.filter(call => call.name === 'fn_tg_apply_purchase_recovery');

test('inspect candidate performs official bounded GET and no write; strips keys and raw payload', async () => {
    const f = fixture({ provider: provider({ secret: 'private-api-key', raw: 'raw-provider-secret' }) }); const result = await f.run(linkInspect);
    assert.equal(result.success, true); assert.equal(result.snapshot.idempotency_key_matches, true); assert.equal(result.snapshot.provider_order_id, UPSTREAM);
    assert.equal(result.expected_task_updated_at, VERSION); assert.equal(f.upstream[0].opts.timeoutMs, 3000); assert.equal(writes(f).length, 0);
    for (const secret of [KEY, 'private-api-key', 'raw-provider-secret']) assert.ok(!JSON.stringify(result).includes(secret));
});
for (const [name, patch, code] of [
    ['later order for same user', { idempotencyKey: 'another-submission-key' }, 'recovery_provider_mismatch'],
    ['missing correlation', { idempotencyKey: null }, 'recovery_correlation_missing'],
    ['wrong provider id', { id: ACTOR }, 'recovery_provider_mismatch'],
    ['wrong recipient', { recipientName: 'another_user' }, 'recovery_provider_mismatch'],
    ['wrong stars', { extraData: { quantityStars: 100 } }, 'recovery_provider_mismatch'],
    ['top-level stars only', { extraData: null, quantity: 50 }, 'recovery_provider_mismatch'],
    ['wrong currency', { currency: 'gram' }, 'recovery_provider_mismatch'],
    ['unknown state', { status: 'unknown' }, 'recovery_provider_mismatch'],
    ['web order', { method: 'web' }, 'recovery_provider_mismatch']
]) test(`link refuses ${name}`, async () => {
    const f = fixture({ provider: provider(patch) }); await assert.rejects(f.run(), { code }); assert.equal(writes(f).length, 0);
});
test('same provider UUID cannot belong to another local task, including case variants', async () => {
    const f = fixture({ owners: [{ id: ID }] }); await assert.rejects(f.run(), { code: 'recovery_conflict' }); assert.equal(writes(f).length, 0);
    assert.ok(f.queries.some(q => q.filters.some(([key, value]) => key === 'provider_order_id' && value === UPSTREAM)));
});
for (const status of ['created', 'processing', 'completed', 'failed', 'canceled']) test(`confirm link re-GETs ${status} and sends only server proof to atomic RPC`, async () => {
    const f = fixture({ provider: provider({ status }) }); const result = await f.run(); const write = writes(f)[0].args;
    assert.equal(result.success, true); assert.equal(f.upstream.length, 1); assert.equal(write.p_check.provider_status, status);
    assert.equal(write.p_check.completed, status === 'completed'); assert.equal(write.p_check.idempotency_key_matches, true);
    assert.equal(write.p_expected_task_updated_at, VERSION); assert.equal(write.p_actor_id, ACTOR); assert.equal(write.p_operation_id, OPERATION);
    assert.equal(write.p_check.idempotencyKey, undefined); assert.ok(!JSON.stringify(write).includes(KEY));
});
test('preview is not trusted by confirmation; provider changing after preview prevents linkage', async () => {
    let count = 0; const f = fixture(); const factory = () => ({ getOrder: async () => provider({ idempotencyKey: ++count === 1 ? KEY : 'different-submission' }) });
    const service = createPurchaseRecovery({ clientFactory: factory, now: () => new Date(NOW) });
    await service.execute({ supabase: f.db, actorId: ACTOR, input: linkInspect });
    await assert.rejects(service.execute({ supabase: f.db, actorId: ACTOR, input: link }), { code: 'recovery_provider_mismatch' }); assert.equal(writes(f).length, 0);
});
for (const [name, patch] of [['closed', { order: { closed_at: NOW } }], ['unpaid', { order: { paid_at: null } }], ['payment review', { order: { payment_status: 'manual_review' } }],
    ['canceled', { order: { cancelled_at: NOW } }], ['identity mismatch', { task: { stars_quantity: 100 } }], ['wrong source', { task: { order_source: 'redemption' } }],
    ['no submit', { task: { submitted_at: null } }], ['zero attempts', { task: { attempt_count: 0 } }], ['unknown currency', { task: { provider_payment_currency: null } }],
    ['missing key', { task: { provider_idempotency_key: '' } }]]) test(`recovery eligibility refuses ${name}`, async () => {
    const f = fixture(patch); await assert.rejects(f.run(), { code: 'recovery_not_allowed' }); assert.equal(f.upstream.length, 0); assert.equal(writes(f).length, 0);
});
for (const task of [{ status: 'processing' }, { lease_token: OPERATION }, { lease_expires_at: NOW }, { status: 'succeeded' }]) test(`active task is fenced ${JSON.stringify(task)}`, async () => {
    const f = fixture({ task }); await assert.rejects(f.run(), { code: 'recovery_active' }); assert.equal(f.upstream.length, 0);
});
test('stale purchase or task version is rejected before contacting upstream', async () => {
    for (const patch of [{ order: { updated_at: NOW } }, { task: { updated_at: NOW } }]) {
        const f = fixture(patch); await assert.rejects(f.run(), { code: 'recovery_stale' }); assert.equal(f.upstream.length, 0);
    }
});
test('ambiguous task binding and missing purchase fail closed', async () => {
    for (const [options, code] of [[{ tasks: [FULFILLMENT, FULFILLMENT] }, 'recovery_conflict'], [{ missing: true }, 'recovery_not_allowed']]) {
        const f = fixture(options); await assert.rejects(f.run(), { code }); assert.equal(writes(f).length, 0);
    }
});
test('negative inspect is read only and explicitly requires separate real nonacceptance evidence', async () => {
    const f = fixture(); const result = await f.run({ ...identity, action: 'inspect_nonacceptance' });
    assert.match(result.message, /空结果不能代替凭据/); assert.equal(writes(f).length, 0); assert.equal(f.upstream[0].method, 'list');
});
test('explicit nonacceptance closes with structured operator attestation, server contradiction check, and unchanged payment facts', async () => {
    const f = fixture({ negative: absent }); const result = await f.run(close); const args = writes(f)[0].args;
    assert.equal(result.order.fulfillment_status, 'closed'); assert.equal(result.order.payment_status, 'paid');
    assert.equal(args.p_evidence.verification, 'operator_attestation'); assert.equal(args.p_evidence.reference, evidence.reference);
    assert.equal(args.p_evidence.confirm_nonacceptance, true); assert.equal(args.p_check.status, 'not_found'); assert.equal(args.p_check.search.exhausted, true);
    assert.equal(args.p_provider_order_id, null); assert.deepEqual(f.upstream.map(c => c.method), ['negative']);
});
for (const negative of [null, { ...absent, status: 'verified', verified: true }, { ...absent, status: 'unavailable' }, { ...absent, status: 'search_limited' },
    { ...absent, status: 'submission_unknown' }, { ...absent, search: { exhausted: false, missing_correlation: false } }, { ...absent, search: { exhausted: true, missing_correlation: true } }]) test(`nonacceptance refuses contradictory or incomplete check ${JSON.stringify(negative)}`, async () => {
    const f = fixture({ negative }); await assert.rejects(f.run(close), { code: 'recovery_negative_unconfirmed' }); assert.equal(writes(f).length, 0);
});
test('known upstream id cannot be closed using nonacceptance evidence', async () => {
    const f = fixture({ task: { provider_order_id: UPSTREAM } }); await assert.rejects(f.run(close), { code: 'recovery_negative_unconfirmed' }); assert.equal(f.upstream.length, 0);
});
for (const confirmed_at of ['2026-10-16T10:59:59Z', '2026-10-17T06:01:00Z']) test(`evidence cannot predate submission or claim future confirmation ${confirmed_at}`, async () => {
    const f = fixture({ negative: absent }); await assert.rejects(f.run({ ...close, evidence: { ...evidence, confirmed_at } }), { code: 'invalid_recovery', statusCode: 400 }); assert.equal(writes(f).length, 0);
});
test('response-loss retry skips upstream and versions only for exact actor, action and request hash', async () => {
    const f = fixture({ receipt: { purchase_id: ID, actor_user_id: ACTOR, action: close.action, request_hash: requestHash(parse(close)) }, order: { closed_at: NOW, updated_at: NOW }, task: { status: 'cancelled', updated_at: NOW } });
    const result = await f.run(close); assert.equal(result.existing, true); assert.equal(f.upstream.length, 0); assert.deepEqual(writes(f)[0].args.p_check, {});
});
for (const patch of [{ actor_user_id: TASK }, { purchase_id: TASK }, { action: 'close_with_nonacceptance' }, { request_hash: 'changed' }]) test(`operation replay rejects changed receipt ownership ${JSON.stringify(patch)}`, async () => {
    const f = fixture({ receipt: { purchase_id: ID, actor_user_id: ACTOR, action: link.action, request_hash: requestHash(parse(link)), ...patch } });
    await assert.rejects(f.run(), { code: 'recovery_conflict' }); assert.equal(f.upstream.length, 0); assert.equal(writes(f).length, 0);
});
test('database stale/active/conflict results propagate without claiming success', async () => {
    for (const code of ['recovery_stale', 'recovery_active', 'recovery_conflict']) {
        const f = fixture({ result: { success: false, code } }); await assert.rejects(f.run(), { code });
    }
});
test('provider errors never expose exception text or reach mutation RPC', async () => {
    const f = fixture({ getError: new Error('private-api-key') }); await assert.rejects(f.run(), error => error.code === 'recovery_provider_unavailable' && !error.message.includes('private')); assert.equal(writes(f).length, 0);
});
for (const input of [{ ...link, snapshot: {} }, { ...link, actor_id: ACTOR }, { ...link, provider_idempotency_key: KEY }, { ...link, confirm_original_request: false },
    { ...close, evidence: {} }, { ...close, evidence: { ...evidence, kind: 'empty_search' } }, { ...close, evidence: { ...evidence, reference: 'short' } },
    { ...close, evidence: { ...evidence, summary: '查无结果' } }, { ...close, evidence: { ...evidence, confirmed_at: '2026-10-17T05:00:00' } },
    { ...close, evidence: { ...evidence, secret: KEY } }, { ...close, confirm_nonacceptance: false }, { ...close, confirm_payment_handled: false },
    { ...link, expected_task_updated_at: null }, { ...link, note: 'bad\nnewline' }]) test(`strict recovery schema rejects untrusted or incomplete input ${Object.keys(input).join(',')}`, () => {
    assert.throws(() => parse(input), { code: 'invalid_recovery', statusCode: 400 });
});
test('readiness missing RPC gives an honest pending state and makes no task reads/writes', async () => {
    const f = fixture({ readyError: { code: 'PGRST202' } }); const result = await f.service.details({ supabase: f.db, orderNo: ORDER.order_no });
    assert.equal(result.ready, false); assert.equal(result.can_link, false); assert.match(result.message, /迁移/); assert.equal(f.queries.length, 0);
    await assert.rejects(f.run(), { code: 'recovery_migration_required' });
});
test('history projection removes private receipt, snapshots and original idempotency key', async () => {
    const f = fixture({ records: [{ operation_id: OPERATION, actor_user_id: ACTOR, action: close.action, result_status: 'closed', note: close.note,
        evidence: { ...evidence, secret: 'private-raw-secret' }, request_hash: 'private-request-hash', submission_fingerprint: 'private-fingerprint', provider_idempotency_key: KEY, created_at: NOW }] });
    const r = await f.service.details({ supabase: f.db, orderNo: ORDER.order_no }); assert.equal(r.can_link, true); assert.equal(r.records[0].evidence.verification, 'operator_attestation');
    for (const secret of ['private-raw-secret', 'private-request-hash', 'private-fingerprint', KEY]) assert.ok(!JSON.stringify(r).includes(secret));
});
function admin(db, superadmin = true) { return { async requireAdmin() { return { supabase: db, user: { id: ACTOR }, isSuperAdmin: superadmin }; }, parseJsonBody: async req => req.body,
    sendJson(res, status, data) { res.statusCode = status; res.body = data; return res; } }; }
const headers = { origin: 'http://127.0.0.1:8000', host: '127.0.0.1:8000', 'content-type': 'application/json' };
async function handlerCall(f, req, changes = {}) {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
    await createPurchasesHandler({ admin: admin(f.db), env: {}, recovery: f.service, ...changes })({ method: 'POST', url: '/', headers, body: link, ...req }, res); return res;
}
test('handler routes read-only recovery details and dedicated protected actions', async () => {
    const f = fixture(); const res = await handlerCall(f, {}); assert.equal(res.statusCode, 200); assert.equal(res.body.operation_id, OPERATION);
    const get = await handlerCall(f, { method: 'GET', url: '/?order_no=' + ORDER.order_no + '&recovery=1' }); assert.equal(get.statusCode, 200); assert.equal(get.body.ready, true);
    assert.equal(get.headers['Cache-Control'], 'no-store');
});
for (const [name, req, changes, status] of [
    ['ordinary admin', {}, { superadmin: false }, 403], ['untrusted origin', { headers: { ...headers, origin: 'https://evil.test' } }, {}, 403],
    ['missing origin', { headers: { host: headers.host, 'content-type': 'application/json' } }, {}, 403],
    ['non-json', { headers: { ...headers, 'content-type': 'text/plain' } }, {}, 415]
]) test(`recovery handler rejects ${name} before any recovery query`, async () => {
    const f = fixture(); const res = await handlerCall(f, req, { admin: admin(f.db, changes.superadmin !== false) }); assert.equal(res.statusCode, status); assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
});

test('a closure RPC response must include a real closure timestamp before reporting success', async () => {
    for (const closed_at of [null, 'invalid']) {
        const f = fixture({ result: { success: true, order: { ...ORDER, closed_at, fulfillment_status: 'closed' } } });
        await assert.rejects(f.run(close), /Invalid TG recovery response/);
        assert.equal(writes(f).length, 1);
    }
});
