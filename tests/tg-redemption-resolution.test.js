'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const adminPath = require.resolve('../api/_lib/admin');
const previous = require.cache[adminPath];
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: {} };
const { createRedemptionResolution, parse, requestHash, cleanResult } = require('../server/tg/redemption-resolution');
const { createOrdersHandler } = require('../server/api-handlers/admin/tg/orders');
const { publicOrder } = require('../server/api-handlers/public/tg');
if (previous) require.cache[adminPath] = previous; else delete require.cache[adminPath];
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const CODE = 'f47ac10b-58cc-4372-a567-0e02b2c3d480';
const BATCH = 'f47ac10b-58cc-4372-a567-0e02b2c3d481';
const ACTOR = 'f47ac10b-58cc-4372-a567-0e02b2c3d482';
const OPERATION = 'f47ac10b-58cc-4372-a567-0e02b2c3d483';
const PROVIDER = 'f47ac10b-58cc-4372-a567-0e02b2c3d484';
const VERSION = '2026-10-17T09:00:00.123456+00:00';
const NOW = '2026-10-17T10:00:00.000Z';
const KEY = 'private-original-submission-key';
const NOTE = '已与用户协商退款，本订单处理完结。';
const TASK = { id: ID, order_no: 'TG-ABCDEFGHIJKLMNOPQRST', order_source: 'redemption', purchase_id: null, code_id: CODE,
    telegram_username: 'recipient_test', product_family: 'telegram_premium', term_months: 3, stars_quantity: null, provider: 'gramix',
    provider_order_id: null, provider_payment_currency: 'usdt', provider_idempotency_key: KEY, status: 'manual_review',
    submitted_at: '2026-10-16T11:00:00Z', attempt_count: 1, lease_token: null, lease_expires_at: null, updated_at: VERSION, closed_at: null };
const identity = { order_no: TASK.order_no, expected_updated_at: VERSION, expected_code_updated_at: VERSION };
const commit = { operation_id: OPERATION, note: '已在工单核实本次处理结果，内部凭据 SECRET-REFERENCE', confirm_original_request: true };
const linkInspect = { ...identity, action: 'inspect_upstream_order', provider_order_id: PROVIDER };
const link = { ...linkInspect, ...commit, action: 'link_upstream_order' };
const complete = { ...identity, ...commit, action: 'complete_review', outcome: 'refunded', completion_note: NOTE,
    confirm_stop_fulfillment: true, confirm_result_handled: true, confirm_upstream_risk: true };
const evidence = { kind: 'provider_support', reference: 'GRAMIX-TICKET-123', confirmed_at: '2026-10-17T09:50:00Z',
    summary: '上游工单明确确认本次原始提交未受理、未发货且不会后续发货，原始记录已归档。' };
const close = { ...identity, ...commit, action: 'close_with_nonacceptance', evidence, code_disposition: 'revoked', completion_note: NOTE,
    confirm_stop_fulfillment: true, confirm_nonacceptance: true, confirm_no_delivery: true };
const absent = { status: 'not_found', verified: false, search: { exhausted: true, missing_correlation: false, pages: 2, scanned: 25 } };
function provider(patch = {}) { return { statusCode: 200, data: { id: PROVIDER, recipientName: 'recipient_test', type: 'premium_3_month',
    method: 'api', status: 'completed', currency: 'usd', amount: '12.00', idempotencyKey: KEY, ...patch } }; }
function fixture(options = {}) {
    const calls = [], queries = [], upstream = [];
    const task = { ...TASK, ...options.task };
    const code = { id: CODE, batch_id: BATCH, status: 'fulfilling', telegram_username: task.telegram_username, expires_at: null,
        fulfilled_at: null, redeemed_at: null, updated_at: VERSION, ...options.code };
    const batch = { id: BATCH, product_family: task.product_family, term_months: task.term_months, stars_quantity: task.stars_quantity,
        status: 'active', valid_from: '2026-10-15T00:00:00Z', valid_until: null, ...options.batch };
    const db = { from(table) {
        let fields; const filters = [];
        function run() {
            queries.push({ table, fields, filters });
            const data = table === 'tg_redemption_orders' ? fields === 'id' ? filters.some(([key]) => key === 'provider_order_id') ? options.owners || [] : options.others || [] : options.missing ? null : task
                : table === 'tg_redemption_codes' ? options.missingCode ? null : code : table === 'tg_redemption_batches' ? options.missingBatch ? null : batch
                    : table === 'tg_redemption_resolution_events' ? filters.some(([key]) => key === 'operation_id') ? options.receipt || null : options.records || [] : null;
            return { data, error: options.readError || null };
        }
        return { select(value) { fields = value; return this; }, eq(...a) { filters.push(a); return this; }, neq(...a) { filters.push(a); return this; },
            in(...a) { filters.push(a); return this; }, ilike(...a) { filters.push(a); return this; }, order() { return this; }, limit() { return this; },
            async maybeSingle() { return run(); }, then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); } };
    }, async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'fn_tg_redemption_resolution_ready') return { data: options.ready ?? true, error: options.readyError };
        if (name === 'fn_tg_redemption_resolution_confirmation_ready') return { data: options.confirmationReady ?? true, error: options.confirmationError };
        if (name !== 'fn_tg_apply_redemption_resolution') throw new Error('Unexpected offline RPC: ' + name);
        return { error: options.rpcError, data: options.result || { success: true, existing: !!options.receipt, order: { ...task,
            status: args.p_action === 'link_upstream_order' ? 'succeeded' : 'closed', updated_at: NOW, closed_at: NOW,
            completion_outcome: args.p_outcome, completion_note: args.p_completion_note, code_disposition: args.p_code_disposition } } };
    } };
    const service = createRedemptionResolution({ now: () => new Date(NOW), clientFactory: () => ({ async getOrder(id, params) {
        upstream.push({ method: 'get', id, params }); if (options.providerError) throw options.providerError; return options.provider || provider();
    } }), queryUpstream: async args => { upstream.push({ method: 'negative', order: args.order }); return Object.hasOwn(options, 'negative') ? options.negative : absent; } });
    return { db, calls, queries, upstream, service, run: (input = complete, actorId = ACTOR) => service.execute({ supabase: db, actorId, input }),
        details: () => service.details({ supabase: db, orderNo: TASK.order_no }) };
}
const writes = f => f.calls.filter(c => c.name === 'fn_tg_apply_redemption_resolution');

test('action parsing binds exact versions and separates internal evidence from public explanation', () => {
    assert.equal(parse({ ...complete, note: `  ${complete.note}  `, completion_note: ` ${NOTE}\n请留意渠道到账时间。 ` }).completion_note, `${NOTE}\n请留意渠道到账时间。`);
    assert.equal(parse({ ...link, provider_order_id: PROVIDER.toUpperCase() }).provider_order_id, PROVIDER);
    assert.equal(parse(close).evidence.confirmed_at, '2026-10-17T09:50:00.000Z');
    for (const input of [null, [], {}, { ...complete, expected_code_updated_at: null }, { ...complete, note: '\tinvalid private note' },
        { ...complete, completion_note: '太短' }, { ...complete, completion_note: 'x'.repeat(501) }, { ...complete, outcome: 'succeeded' },
        { ...complete, expected_updated_at: 'yesterday' }, { ...complete, action: 'purchase' }, { ...complete, raw_provider: {} },
        { ...link, provider_order_id: 'https://untrusted.invalid/order' }, { ...close, evidence: { ...evidence, raw: KEY } },
        { ...close, evidence: { ...evidence, summary: '查不到' } }, { ...close, code_disposition: 'fulfilled' }]) assert.throws(() => parse(input));
    for (const input of [complete, close, link]) for (const key of Object.keys(input).filter(k => k.startsWith('confirm_'))) {
        assert.throws(() => parse({ ...input, [key]: false }), { code: 'invalid_redemption_resolution' });
    }
});

test('payload hash fences actor, both versions, notes, disposition and structured evidence', () => {
    const hash = requestHash(parse(close), ACTOR);
    for (const patch of [{ note: '不同的内部依据及备注' }, { completion_note: '不同的用户公开完结说明' }, { operation_id: ID },
        { expected_updated_at: NOW }, { expected_code_updated_at: NOW }, { code_disposition: 'available' }, { evidence: { ...evidence, reference: 'ANOTHER-TICKET' } }]) {
        assert.notEqual(requestHash(parse({ ...close, ...patch }), ACTOR), hash);
    }
    assert.notEqual(requestHash(parse(close), ID), hash);
    assert.equal(requestHash(parse({ ...close }), ACTOR), hash);
});

for (const readyError of [{ code: 'PGRST202' }, { code: '42883' }]) test(`missing migration ${readyError.code} exposes disabled detail without selecting new columns`, async () => {
    const f = fixture({ readyError }); const detail = await f.details();
    assert.equal(detail.ready, false); assert.equal(detail.can_complete, false); assert.match(detail.message, /升级/);
    await assert.rejects(f.run(), { code: 'redemption_resolution_migration_required' }); assert.equal(f.queries.length, 0); assert.equal(writes(f).length, 0);
});

test('unexpected readiness/database failures cannot be shown as ready or successful', async () => {
    await assert.rejects(fixture({ readyError: new Error('database offline') }).details(), /database offline/);
    await assert.rejects(fixture({ readError: new Error('database offline') }).run(), /database offline/);
    await assert.rejects(fixture({ rpcError: new Error('commit acknowledgement lost') }).run(), /acknowledgement lost/);
    const f = fixture({ ready: false }); assert.equal((await f.details()).ready, false); assert.equal(f.queries.length, 0);
});

for (const [name, options, code] of [
    ['purchase source', { task: { order_source: 'purchase' } }, 'not_allowed'], ['purchase parent', { task: { purchase_id: ID } }, 'not_allowed'],
    ['missing order', { missing: true }, 'not_allowed'], ['missing code', { missingCode: true }, 'conflict'], ['missing batch', { missingBatch: true }, 'conflict'],
    ['completed order', { task: { status: 'succeeded' } }, 'not_allowed'], ['closed order', { task: { closed_at: NOW } }, 'not_allowed'],
    ['working order', { task: { status: 'processing' } }, 'not_allowed'], ['live lease', { task: { lease_token: OPERATION } }, 'active'],
    ['expired lease', { task: { lease_expires_at: '2026-10-01T00:00:00Z' } }, 'active'], ['another task on code', { others: [{ id: OPERATION }] }, 'conflict'],
    ['code recipient mismatch', { code: { telegram_username: 'another_user' } }, 'conflict'], ['batch rights mismatch', { batch: { term_months: 12 } }, 'conflict'],
    ['used code', { code: { redeemed_at: NOW } }, 'conflict'], ['revoked code', { code: { status: 'revoked' } }, 'conflict'],
    ['order version changed', { task: { updated_at: NOW } }, 'stale'], ['code version changed', { code: { updated_at: NOW } }, 'stale']
]) test(`resolution refuses ${name} before upstream calls or writes`, async () => {
    const f = fixture(options); await assert.rejects(f.run(), { code: `redemption_resolution_${code}` }); assert.equal(writes(f).length, 0); assert.equal(f.upstream.length, 0);
});

test('missing submission evidence disables linkage but still allows registering an actual completed settlement', async () => {
    const f = fixture({ task: { submitted_at: null, attempt_count: 0, provider_payment_currency: null } }); const detail = await f.details();
    assert.equal(detail.can_link, false); assert.equal(detail.can_record_nonacceptance, false); assert.equal(detail.can_complete, true);
    await assert.rejects(f.run(link), { code: 'redemption_resolution_submission_missing' }); assert.equal(writes(f).length, 0);
    assert.equal((await f.run()).order.status, 'closed'); assert.equal(f.upstream.length, 0);
});

for (const status of ['created', 'processing', 'completed', 'failed', 'canceled']) test(`link commits re-query original upstream ${status} and send only normalized proof`, async () => {
    const f = fixture({ provider: provider({ status }) }); await f.run(linkInspect); assert.equal(writes(f).length, 0); await f.run(link);
    assert.equal(f.upstream.length, 2); assert.equal(f.upstream[1].method, 'get'); assert.equal(f.upstream[1].id, PROVIDER);
    const args = writes(f)[0].args; assert.equal(args.p_check.provider_status, status); assert.equal(args.p_check.completed, status === 'completed');
    assert.equal(args.p_check.idempotency_key_matches, true); assert.equal(args.p_provider_order_id, PROVIDER); assert.equal(args.p_actor_id, ACTOR);
    assert.equal(args.p_expected_code_updated_at, VERSION); assert.equal(args.p_code_disposition, null); assert.equal(args.p_completion_note, null);
    assert.doesNotMatch(JSON.stringify(args), new RegExp(KEY));
});

for (const [name, patch, code] of [
    ['different original key', { idempotencyKey: 'another-request-key' }, 'provider_mismatch'], ['no original key', { idempotencyKey: null }, 'correlation_missing'],
    ['different recipient', { recipientName: 'another_user' }, 'provider_mismatch'], ['different duration', { type: 'premium_12_month' }, 'provider_mismatch'],
    ['different currency', { currency: 'gram' }, 'provider_mismatch'], ['non API order', { method: 'web' }, 'provider_mismatch'],
    ['different upstream UUID', { id: OPERATION }, 'provider_mismatch']
]) test(`link refuses ${name}`, async () => {
    const f = fixture({ provider: provider(patch) }); await assert.rejects(f.run(link), { code: `redemption_resolution_${code}` }); assert.equal(writes(f).length, 0);
});

test('star linkage verifies the official quantity, not a top-level lookalike field', async () => {
    const task = { product_family: 'telegram_stars', term_months: null, stars_quantity: 50 };
    const f = fixture({ task, provider: provider({ type: 'stars', extraData: { quantityStars: 50 } }) }); assert.equal((await f.run(link)).success, true);
    const wrong = fixture({ task, provider: provider({ type: 'stars', quantity: 50, extraData: { quantityStars: 100 } }) });
    await assert.rejects(wrong.run(link), { code: 'redemption_resolution_provider_mismatch' }); assert.equal(writes(wrong).length, 0);
});

test('provider failure and ownership conflict do not bind or resubmit orders', async () => {
    for (const [options, code] of [[{ providerError: new Error('private provider failure') }, 'provider_unavailable'], [{ owners: [{ id: OPERATION }] }, 'conflict'],
        [{ task: { provider_order_id: OPERATION } }, 'conflict']]) {
        const f = fixture(options); await assert.rejects(f.run(link), { code: `redemption_resolution_${code}` }); assert.equal(writes(f).length, 0);
    }
});

for (const negative of [null, { ...absent, verified: true }, { ...absent, status: 'unavailable' }, { ...absent, status: 'submission_unknown' },
    { ...absent, status: 'search_limited' }, { ...absent, search: { exhausted: false, missing_correlation: false } },
    { ...absent, search: { exhausted: true, missing_correlation: true } }]) test(`nonacceptance requires a complete contradiction check ${JSON.stringify(negative)}`, async () => {
    const f = fixture({ negative }); await assert.rejects(f.run(close), { code: 'redemption_resolution_negative_unconfirmed' }); assert.equal(writes(f).length, 0);
});

test('negative inspection never closes; submission-time and future attestation errors cannot commit', async () => {
    const f = fixture(); const check = await f.run({ ...identity, action: 'inspect_nonacceptance' }); assert.match(check.message, /空结果不能代替凭据/); assert.equal(writes(f).length, 0);
    for (const confirmed_at of ['2026-10-15T00:00:00Z', '2026-10-18T00:00:00Z']) await assert.rejects(f.run({ ...close, evidence: { ...evidence, confirmed_at } }), { code: 'invalid_redemption_resolution' });
    assert.equal(writes(f).length, 0);
    const bound = fixture({ task: { provider_order_id: PROVIDER } }); await assert.rejects(bound.run(close), { code: 'redemption_resolution_negative_unconfirmed' }); assert.equal(bound.upstream.length, 0);
});

test('explicit nonacceptance binds private evidence, independent public note and the selected code disposition', async () => {
    for (const code_disposition of ['revoked', 'available']) {
        const f = fixture(); const result = await f.run({ ...close, code_disposition }); const args = writes(f)[0].args;
        assert.equal(args.p_outcome, 'not_accepted'); assert.equal(args.p_code_disposition, code_disposition); assert.equal(args.p_completion_note, NOTE);
        assert.equal(args.p_evidence.verification, 'operator_attestation'); assert.equal(args.p_evidence.confirm_no_delivery, true);
        assert.equal(args.p_check.search.exhausted, true); assert.equal(result.order.status, 'closed');
        assert.doesNotMatch(JSON.stringify(result), /SECRET-REFERENCE|GRAMIX-TICKET|idempotency|closed_by|request_hash/);
    }
});

for (const options of [{ batch: { status: 'revoked' } }, { batch: { valid_from: '2026-10-18T00:00:00Z' } },
    { batch: { valid_until: NOW } }, { code: { expires_at: NOW } }]) test(`expired or disabled code cannot be restored ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); assert.equal((await f.details()).can_release_code, false);
    await assert.rejects(f.run({ ...close, code_disposition: 'available' }), { code: 'redemption_resolution_code_unavailable' }); assert.equal(writes(f).length, 0);
    assert.equal((await f.run(close)).order.code_disposition, 'revoked');
});

for (const outcome of ['delivery_confirmed', 'refunded', 'agreed_settlement']) test(`manual ${outcome} closes once with matching code disposal and without any purchase call`, async () => {
    const f = fixture(); const result = await f.run({ ...complete, outcome }); const args = writes(f)[0].args;
    assert.equal(args.p_outcome, outcome); assert.equal(args.p_code_disposition, outcome === 'delivery_confirmed' ? 'fulfilled' : 'revoked');
    assert.equal(args.p_check && Object.keys(args.p_check).length, 0); assert.equal(args.p_evidence.confirm_upstream_risk, true);
    assert.equal(result.order.completion_note, NOTE); assert.equal(result.order.closed_at, NOW); assert.equal(f.upstream.length, 0);
});

for (const status of ['pending', 'processing', 'retry_waiting', 'manual_review', 'succeeded', 'failed', 'cancelled', 'closed']) test(`lost link response safely replays after worker advances to ${status}`, async () => {
    const receipt = { order_id: ID, actor_user_id: ACTOR, action: link.action, request_hash: requestHash(parse(link), ACTOR) };
    const order = { ...TASK, status, updated_at: NOW, closed_at: NOW, completion_note: NOTE, completion_outcome: 'refunded', code_disposition: 'revoked' };
    const f = fixture({ receipt, task: { status, updated_at: NOW }, result: { success: true, existing: true, order } });
    assert.equal((await f.run(link)).order.status, status); assert.equal(f.upstream.length, 0); assert.equal(writes(f).length, 1);
});

test('exact closure replay bypasses live version and code-ownership eligibility but retains receipt ownership', async () => {
    const receipt = { order_id: ID, actor_user_id: ACTOR, action: complete.action, request_hash: requestHash(parse(complete), ACTOR) };
    const f = fixture({ receipt, task: { status: 'closed', updated_at: NOW }, code: { status: 'revoked', updated_at: NOW } });
    assert.equal((await f.run()).existing, true); assert.equal(f.upstream.length, 0);
    for (const patch of [{ actor_user_id: ID }, { order_id: CODE }, { action: link.action }, { request_hash: '0'.repeat(64) }]) {
        const bad = fixture({ receipt: { ...receipt, ...patch } }); await assert.rejects(bad.run(), { code: 'redemption_resolution_conflict' }); assert.equal(writes(bad).length, 0);
    }
});

test('atomic conflicts and incomplete commit acknowledgements cannot be presented as a confirmed closure', async () => {
    for (const code of ['redemption_resolution_stale', 'redemption_resolution_active', 'redemption_resolution_conflict']) await assert.rejects(fixture({ result: { success: false, code } }).run(), { code });
    for (const order of [{ ...TASK, status: 'closed' }, { ...TASK, status: 'closed', closed_at: NOW, completion_note: NOTE, completion_outcome: 'refunded', code_disposition: 'available' }]) assert.throws(() => cleanResult(order));
    await assert.rejects(fixture({ result: { success: true, existing: 'yes', order: TASK } }).run());
    await assert.rejects(fixture().run(complete, 'untrusted-actor'), { code: 'invalid_redemption_resolution' });
});

test('all public redemption projections expose only closure time and public explanation', () => {
    const row = { ...TASK, success: true, status: 'closed', closed_at: NOW, completion_note: NOTE, completion_outcome: 'refunded', code_disposition: 'revoked',
        note: complete.note, provider_snapshot: { idempotencyKey: KEY }, evidence, closed_by: ACTOR };
    const result = publicOrder(row); assert.equal(result.status, 'closed'); assert.equal(result.completion_note, NOTE); assert.equal(result.closed_at, NOW);
    assert.doesNotMatch(JSON.stringify(result), /SECRET-REFERENCE|GRAMIX-TICKET|idempotency|provider|outcome|disposition|closed_by/);
    assert.equal(publicOrder({ ...row, completion_note: '' }), null); assert.equal(publicOrder({ ...row, closed_at: 'invalid' }), null);
    const active = publicOrder({ ...row, status: 'manual_review' }); assert.equal(active.closed_at, undefined); assert.equal(active.completion_note, undefined);
});

function endpoint(options = {}) {
    const activity = []; const db = {};
    const admin = { async requireAdmin() { activity.push('authenticate'); if (options.authError) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
        return { supabase: db, user: { id: ACTOR }, isSuperAdmin: options.superAdmin !== false }; }, sendJson(res, status, data) { res.statusCode = status; res.body = data; } };
    const resolution = { async operationStatus(args) { activity.push(args); return { success: true, state: 'not_recorded', operation_id: OPERATION }; }, async execute(args) { activity.push(args); if (options.error) throw options.error; return { success: true, operation_id: OPERATION }; } };
    return { activity, db, handler: createOrdersHandler({ admin, env: { NODE_ENV: 'production' }, resolution }) };
}
async function invoke(handler, patch = {}) {
    const req = { method: 'POST', url: '/api/admin/tg/orders', headers: { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'application/json' }, body: complete, ...patch };
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } }; await handler(req, res); return res;
}
test('redemption actions require authenticated superadmin, dedicated origin and JSON before dispatch', async () => {
    const f = endpoint(); const res = await invoke(f.handler); assert.equal(res.statusCode, 200); assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(f.activity, ['authenticate', { supabase: f.db, actorId: ACTOR, input: complete }]);
    for (const options of [{ authError: true }, { superAdmin: false }]) { const denied = endpoint(options); assert.ok([401, 403].includes((await invoke(denied.handler)).statusCode)); assert.equal(denied.activity.length, 1); }
    for (const headers of [{ origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, { origin: 'https://tg.adm.fatherkey.com', 'content-type': 'text/plain' }]) {
        const denied = endpoint(); assert.ok([403, 415].includes((await invoke(denied.handler, { headers })).statusCode)); assert.equal(denied.activity.length, 1);
    }
    const denied = endpoint({ error: Object.assign(new Error('版本已变化'), { code: 'redemption_resolution_stale', statusCode: 409 }) });
    assert.equal((await invoke(denied.handler)).body.code, 'redemption_resolution_stale');
});

for (const options of [{ confirmationReady: false }, { confirmationError: { code: 'PGRST202' } }]) test('unrepaired confirmation SQL disables commits and keeps order detail available', async () => {
    const f = fixture(options); const detail = await f.details();
    assert.equal(detail.ready, false); assert.equal(detail.can_complete, false); assert.match(detail.message, /增量数据库修复/);
    await assert.rejects(f.run(), { code: 'redemption_resolution_confirmation_required', statusCode: 503, notApplied: true });
    assert.equal(writes(f).length, 0);
});
for (const code of ['42883', 'PGRST202', '23514', '23502', '42703']) test(`definite database failure ${code} provides a safe recovery reason without leaking SQL or notes`, async () => {
    const f = fixture({ rpcError: { code, message: KEY + ' private SQL ' + complete.note } });
    await assert.rejects(f.run(), error => error.notApplied === true && error.statusCode === 503 && !error.message.includes(KEY) && !error.message.includes(complete.note));
});
test('transport and unrecognized database errors remain unconfirmed', async () => {
    const original = Object.assign(new Error('ack lost'), { code: 'NETWORK' }); const f = fixture({ rpcError: original });
    await assert.rejects(f.run(), error => error === original && !error.notApplied);
});
const operationStatus = f => f.service.operationStatus({ supabase: f.db, actorId: ACTOR, orderNo: TASK.order_no, operationId: OPERATION });
test('receipt lookup is read-only and absence does not claim rollback or completion', async () => {
    const f = fixture(); const result = await operationStatus(f);
    assert.equal(result.state, 'not_recorded'); assert.equal(result.order.status, 'manual_review'); assert.equal(result.operation_id, OPERATION);
    assert.equal(result.not_applied, undefined); assert.equal(writes(f).length, 0); assert.equal(f.upstream.length, 0);
    assert.equal(f.calls.some(call => call.name === 'fn_tg_redemption_resolution_confirmation_ready'), false);
    assert.equal(JSON.stringify(result).includes(KEY), false);
});
test('receipt confirms committed completion even while the incremental repair is unavailable', async () => {
    const f = fixture({ confirmationReady: false, task: { status: 'closed', updated_at: NOW, closed_at: NOW,
        completion_note: NOTE, completion_outcome: 'refunded', code_disposition: 'revoked' },
        receipt: { order_id: ID, actor_user_id: ACTOR, action: 'complete_review', result_status: 'closed', completion_note: NOTE } });
    const result = await operationStatus(f); assert.equal(result.state, 'applied'); assert.equal(result.existing, true);
    assert.equal(result.order.completion_note, NOTE); assert.equal(result.action, 'complete_review'); assert.equal(writes(f).length, 0);
});
for (const receipt of [{ order_id: CODE, actor_user_id: ACTOR }, { order_id: ID, actor_user_id: CODE }]) test('receipt lookup refuses cross-order and cross-actor disclosure', async () => {
    const f = fixture({ receipt }); await assert.rejects(operationStatus(f), { code: 'redemption_resolution_conflict' }); assert.equal(writes(f).length, 0);
});
test('a mismatching receipt cannot claim that an active order completed', async () => {
    const f = fixture({ receipt: { order_id: ID, actor_user_id: ACTOR, action: 'complete_review', completion_note: NOTE } });
    await assert.rejects(operationStatus(f), /Invalid TG redemption resolution receipt/); assert.equal(writes(f).length, 0);
});
test('receipt endpoint authenticates superadmin and dispatches GET without a write or an upstream check', async () => {
    const f = endpoint(); const res = await invoke(f.handler, { method: 'GET', url: `/api/admin/tg/orders?order_no=${TASK.order_no}&operation_id=${OPERATION}`, headers: {} });
    assert.equal(res.statusCode, 200); assert.equal(res.body.state, 'not_recorded');
    assert.deepEqual(f.activity, ['authenticate', { supabase: f.db, actorId: ACTOR, orderNo: TASK.order_no, operationId: OPERATION }]);
    const denied = endpoint({ superAdmin: false }); assert.equal((await invoke(denied.handler, { method: 'GET', url: `/api/admin/tg/orders?operation_id=${OPERATION}` })).statusCode, 403);
});
test('known rolled-back resolution failures expose safe recovery information while other server errors stay generic', async () => {
    const known = endpoint({ error: Object.assign(new Error('请执行兑换单处理确认修复'), { code: 'redemption_resolution_confirmation_required', notApplied: true, statusCode: 503 }) });
    const result = await invoke(known.handler); assert.equal(result.statusCode, 503); assert.equal(result.body.not_applied, true); assert.match(result.body.message, /处理确认修复/);
    const unknown = endpoint({ error: Object.assign(new Error(KEY), { notApplied: true }) });
    const masked = await invoke(unknown.handler); assert.equal(masked.statusCode, 500); assert.equal(masked.body.not_applied, undefined); assert.equal(masked.body.message.includes(KEY), false);
});
