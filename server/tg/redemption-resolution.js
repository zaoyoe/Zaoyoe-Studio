'use strict';

const { createHash } = require('node:crypto');
const { createGramixClient } = require('./gramix-client');
const { normalizeOrderSnapshot } = require('./worker');
const { queryUpstreamStatus } = require('./upstream-status');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ['inspect_upstream_order', 'link_upstream_order', 'inspect_nonacceptance', 'close_with_nonacceptance', 'complete_review'];
const COMMITS = new Set(['link_upstream_order', 'close_with_nonacceptance', 'complete_review']);
const OUTCOMES = ['delivery_confirmed', 'refunded', 'agreed_settlement'];
const ORDER_FIELDS = 'id,order_no,order_source,purchase_id,code_id,telegram_username,product_family,term_months,stars_quantity,status,provider,provider_order_id,provider_payment_currency,provider_idempotency_key,attempt_count,submitted_at,lease_token,lease_expires_at,updated_at,closed_at,completion_note,completion_outcome,code_disposition';
const MESSAGES = Object.freeze({
    redemption_resolution_migration_required: '兑换订单处理功能需要数据库升级，请先执行兑换单结案迁移及只读验证。',
    redemption_resolution_confirmation_required: '兑换单处理确认功能需要增量数据库修复，请执行兑换单处理确认修复及只读验证；原订单不会被自动完结。',
    redemption_resolution_database_rejected: '数据库拒绝保存本次处理，事务已回滚。请核对兑换单结案迁移及只读验证后，再查询并重试同一次操作。',
    redemption_resolution_not_allowed: '仅可处理没有关联购买单、兑换码归属一致且处于人工复核或失败状态的独立兑换订单。',
    redemption_resolution_active: '原任务仍在运行或持有工作租约，请等待任务停止后重新核对。',
    redemption_resolution_stale: '订单或兑换码已变化，请刷新详情并重新核验。',
    redemption_resolution_conflict: '操作编号、兑换码或上游订单已有其他归属，请刷新详情核对记录。',
    redemption_resolution_submission_missing: '原始提交标识或扣款币种不完整，不能补录上游或登记未受理凭据。可核实实际处理结果后人工完结。',
    redemption_resolution_provider_mismatch: '原提交标识、上游订单、接收人、商品权益或扣款币种不一致，禁止关联。',
    redemption_resolution_correlation_missing: '上游未返回原提交标识，无法确认是本次原始请求。请索取可核验原单或明确未受理凭据。',
    redemption_resolution_provider_unavailable: '上游查询未完成，请稍后重试，当前没有修改订单。',
    redemption_resolution_negative_unconfirmed: '上游仍有匹配、冲突、缺少关联标识或未完成的记录，暂不能凭未受理证明结案。查无结果本身不能代替凭据。',
    redemption_resolution_code_unavailable: '兑换码或批次已失效，不能恢复可兑换；可选择作废兑换码后结案。',
    invalid_redemption_resolution: '请核对订单版本、处理结果、依据和确认项；内部依据及用户说明须为 6–500 字。'
});
function problem(code, statusCode = 409) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.redemption_resolution_stale), { code, statusCode }); }
function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)); }
function validText(value, min = 6, max = 500) { return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max && !/[\x00-\x09\x0b-\x1f\x7f]/.test(value); }
function keysOnly(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)); }
function parse(input) {
    const link = ['inspect_upstream_order', 'link_upstream_order'].includes(input?.action);
    const commit = COMMITS.has(input?.action);
    const closure = ['close_with_nonacceptance', 'complete_review'].includes(input?.action);
    const keys = ['action', 'order_no', 'expected_updated_at', 'expected_code_updated_at', ...(link ? ['provider_order_id'] : []),
        ...(commit ? ['operation_id', 'note', 'confirm_original_request'] : []), ...(closure ? ['completion_note', 'confirm_stop_fulfillment'] : []),
        ...(input?.action === 'complete_review' ? ['outcome', 'confirm_result_handled', 'confirm_upstream_risk'] : []),
        ...(input?.action === 'close_with_nonacceptance' ? ['code_disposition', 'evidence', 'confirm_nonacceptance', 'confirm_no_delivery'] : [])];
    if (!keysOnly(input, keys) || !ACTIONS.includes(input.action) || !/^TG-[A-Z0-9]{12,24}$/.test(input.order_no || '')
        || !timestamp(input.expected_updated_at) || !timestamp(input.expected_code_updated_at)
        || (link && !UUID.test(input.provider_order_id || ''))
        || (commit && (!UUID.test(input.operation_id || '') || !validText(input.note) || input.confirm_original_request !== true))
        || (closure && (!validText(input.completion_note) || input.confirm_stop_fulfillment !== true))) throw problem('invalid_redemption_resolution', 400);
    const value = { ...input };
    if (link) value.provider_order_id = input.provider_order_id.toLowerCase();
    if (commit) { value.operation_id = input.operation_id.toLowerCase(); value.note = input.note.trim(); }
    if (closure) value.completion_note = input.completion_note.trim();
    if (input.action === 'complete_review' && (!OUTCOMES.includes(input.outcome) || input.confirm_result_handled !== true || input.confirm_upstream_risk !== true)) throw problem('invalid_redemption_resolution', 400);
    if (input.action === 'close_with_nonacceptance') {
        const e = input.evidence;
        if (!['available', 'revoked'].includes(input.code_disposition) || !keysOnly(e, ['kind', 'reference', 'confirmed_at', 'summary'])
            || !['provider_support', 'provider_rejection'].includes(e.kind) || !validText(e.reference, 6, 200) || !timestamp(e.confirmed_at)
            || !validText(e.summary, 20, 1000) || input.confirm_nonacceptance !== true || input.confirm_no_delivery !== true) throw problem('invalid_redemption_resolution', 400);
        value.evidence = { kind: e.kind, reference: e.reference.trim(), confirmed_at: new Date(e.confirmed_at).toISOString(), summary: e.summary.trim() };
    }
    return value;
}
async function ready(supabase) {
    const { data, error } = await supabase.rpc('fn_tg_redemption_resolution_ready');
    if (['PGRST202', '42883'].includes(error?.code)) return false;
    if (error) throw error;
    return data === true;
}
async function confirmationReady(supabase) {
    const { data, error } = await supabase.rpc('fn_tg_redemption_resolution_confirmation_ready');
    if (['PGRST202', '42883'].includes(error?.code)) return false;
    if (error) throw error;
    return data === true;
}
function databaseFailure(error) {
    if (['PGRST202', '42883'].includes(error?.code)) return Object.assign(problem('redemption_resolution_confirmation_required', 503), { notApplied: true });
    if (['23502', '23503', '23514', '42703', '42P01', '42501'].includes(error?.code)) {
        return Object.assign(problem('redemption_resolution_database_rejected', 503), { notApplied: true });
    }
    // A transport error is ambiguous: never claim it rolled back or discard its operation ID.
    return error;
}
function requestHash(value, actorId) {
    return createHash('sha256').update(JSON.stringify([actorId, ...['action', 'order_no', 'expected_updated_at', 'expected_code_updated_at', 'operation_id', 'provider_order_id',
        'outcome', 'code_disposition', 'note', 'completion_note', 'evidence', 'confirm_original_request', 'confirm_stop_fulfillment', 'confirm_result_handled',
        'confirm_upstream_risk', 'confirm_nonacceptance', 'confirm_no_delivery'].map(key => value[key] ?? null)])).digest('hex');
}
function cleanResult(order) {
    if (!order || !UUID.test(order.id || '') || !/^TG-[A-Z0-9]{12,24}$/.test(order.order_no || '') || !timestamp(order.updated_at)
        || !['pending', 'processing', 'retry_waiting', 'manual_review', 'succeeded', 'failed', 'cancelled', 'closed'].includes(order.status)) throw new Error('Invalid TG redemption resolution response');
    const result = { id: order.id, order_no: order.order_no, status: order.status, updated_at: order.updated_at };
    if (order.status === 'closed') {
        if (!timestamp(order.closed_at) || !validText(order.completion_note) || ![...OUTCOMES, 'not_accepted'].includes(order.completion_outcome)
            || !(order.completion_outcome === 'delivery_confirmed' ? order.code_disposition === 'fulfilled'
                : order.completion_outcome === 'not_accepted' ? ['available', 'revoked'].includes(order.code_disposition) : order.code_disposition === 'revoked')) throw new Error('Invalid TG redemption closure response');
        Object.assign(result, { closed_at: order.closed_at, completion_note: order.completion_note, completion_outcome: order.completion_outcome, code_disposition: order.code_disposition });
    }
    return result;
}
function receipt(record) {
    return { operation_id: record.operation_id, action: record.action, created_at: record.created_at, result_status: record.result_status,
        outcome: record.outcome || null, code_disposition: record.code_disposition, provider_order_id: record.provider_order_id || null,
        note: record.note, completion_note: record.completion_note || null,
        evidence: record.action === 'close_with_nonacceptance' ? Object.fromEntries(['kind', 'reference', 'confirmed_at', 'summary'].map(key => [key, record.evidence?.[key]])) : null };
}
function createRedemptionResolution({ env = process.env, clientFactory = createGramixClient, queryUpstream = queryUpstreamStatus, now = () => new Date() } = {}) {
    async function load(supabase, orderNo) {
        if (!await ready(supabase)) throw problem('redemption_resolution_migration_required', 503);
        const task = await supabase.from('tg_redemption_orders').select(ORDER_FIELDS).eq('order_no', orderNo).maybeSingle();
        if (task.error) throw task.error;
        if (!task.data || task.data.order_source !== 'redemption' || task.data.purchase_id != null || !UUID.test(task.data.code_id || '')) throw problem('redemption_resolution_not_allowed');
        const code = await supabase.from('tg_redemption_codes').select('id,batch_id,status,telegram_username,expires_at,fulfilled_at,redeemed_at,updated_at').eq('id', task.data.code_id).maybeSingle();
        if (code.error) throw code.error;
        if (!code.data) throw problem('redemption_resolution_conflict');
        const batch = await supabase.from('tg_redemption_batches').select('id,product_family,term_months,stars_quantity,status,valid_from,valid_until').eq('id', code.data.batch_id).maybeSingle();
        if (batch.error) throw batch.error;
        const others = await supabase.from('tg_redemption_orders').select('id').eq('code_id', code.data.id).neq('id', task.data.id)
            .in('status', ['pending', 'processing', 'retry_waiting', 'manual_review', 'failed', 'succeeded']).limit(1);
        if (others.error) throw others.error;
        if (!Array.isArray(others.data)) throw new Error('Invalid redemption ownership lookup');
        return { task: task.data, code: code.data, batch: batch.data, conflict: others.data.length > 0 };
    }
    function eligible({ task, code, batch, conflict }, value) {
        if (task.closed_at || !['manual_review', 'failed'].includes(task.status)) throw problem('redemption_resolution_not_allowed');
        if (task.lease_token || task.lease_expires_at) throw problem('redemption_resolution_active');
        if (conflict || task.provider !== 'gramix' || code.id !== task.code_id || !['reserved', 'fulfilling', 'failed'].includes(code.status)
            || code.fulfilled_at || code.redeemed_at || code.telegram_username !== task.telegram_username || !batch || batch.id !== code.batch_id
            || batch.product_family !== task.product_family || batch.term_months !== task.term_months || batch.stars_quantity !== task.stars_quantity) throw problem('redemption_resolution_conflict');
        if (value && (task.updated_at !== value.expected_updated_at || code.updated_at !== value.expected_code_updated_at)) throw problem('redemption_resolution_stale');
    }
    function submitted({ task }) {
        if (!timestamp(task.submitted_at) || !Number.isInteger(task.attempt_count) || task.attempt_count < 1
            || typeof task.provider_idempotency_key !== 'string' || task.provider_idempotency_key.length < 16 || !['usdt', 'gram'].includes(task.provider_payment_currency)) throw problem('redemption_resolution_submission_missing');
    }
    function releasable({ code, batch }) {
        const time = now().getTime();
        return batch?.status === 'active' && Number.isFinite(Date.parse(batch.valid_from)) && Date.parse(batch.valid_from) <= time
            && (!batch.valid_until || Date.parse(batch.valid_until) > time) && (!code.expires_at || Date.parse(code.expires_at) > time);
    }
    async function candidate(task, id, supabase) {
        if (task.provider_order_id && task.provider_order_id.toLowerCase() !== id) throw problem('redemption_resolution_conflict');
        let checked;
        try { checked = normalizeOrderSnapshot(await clientFactory({ env }).getOrder(id, { timeoutMs: 3000 }), { ...task, provider_order_id: id }); }
        catch (_) { throw problem('redemption_resolution_provider_unavailable', 502); }
        if (!checked.valid) throw problem('redemption_resolution_provider_mismatch');
        if (checked.snapshot.idempotency_key_matches !== true) throw problem('redemption_resolution_correlation_missing');
        const owners = await supabase.from('tg_redemption_orders').select('id').eq('provider', 'gramix').ilike('provider_order_id', id).limit(2);
        if (owners.error) throw owners.error;
        if (!Array.isArray(owners.data) || owners.data.some(row => row.id !== task.id)) throw problem('redemption_resolution_conflict');
        return checked.snapshot;
    }
    async function negative(task) {
        if (task.provider_order_id) throw problem('redemption_resolution_negative_unconfirmed');
        const check = await queryUpstream({ order: task, env, clientFactory, now });
        if (check?.status !== 'not_found' || check.verified !== false || check.search?.exhausted !== true || check.search?.missing_correlation !== false) throw problem('redemption_resolution_negative_unconfirmed');
        return { status: 'not_found', search: { exhausted: true, missing_correlation: false, pages: check.search.pages, scanned: check.search.scanned } };
    }
    return {
        async details({ supabase, orderNo }) {
            let context;
            try { context = await load(supabase, orderNo); }
            catch (error) { if (error.code === 'redemption_resolution_migration_required') return { ready: false, can_link: false, can_record_nonacceptance: false, can_complete: false, message: error.message }; throw error; }
            const { task, code } = context;
            const records = await supabase.from('tg_redemption_resolution_events').select('operation_id,action,provider_order_id,result_status,outcome,code_disposition,note,completion_note,evidence,created_at').eq('order_id', task.id).order('created_at', { ascending: false }).limit(20);
            if (records.error) throw records.error;
            const confirmation = await confirmationReady(supabase);
            let blocked = confirmation ? null : MESSAGES.redemption_resolution_confirmation_required; let submission = null;
            try { eligible(context); } catch (error) { blocked = error.message; }
            try { submitted(context); } catch (error) { submission = error.message; }
            return { ready: confirmation, can_complete: !blocked, can_link: !blocked && !submission,
                can_record_nonacceptance: !blocked && !submission && !task.provider_order_id, can_release_code: !blocked && releasable(context),
                expected_updated_at: task.updated_at, expected_code_updated_at: code.updated_at, code_status: code.status,
                completion: task.status === 'closed' ? cleanResult(task) : null,
                message: task.status === 'closed' ? '订单已完结，自动履约已停止。' : blocked || submission || '选择与实际处理结果相符的方式；补录只核验原始请求，不会再次购买。',
                records: (records.data || []).map(receipt) };
        },
        async operationStatus({ supabase, actorId, orderNo, operationId }) {
            if (!UUID.test(actorId || '') || !UUID.test(operationId || '') || !/^TG-[A-Z0-9]{12,24}$/.test(orderNo || '')) throw problem('invalid_redemption_resolution', 400);
            const { task } = await load(supabase, orderNo);
            const { data, error } = await supabase.from('tg_redemption_resolution_events')
                .select('order_id,actor_user_id,action,result_status,completion_note').eq('operation_id', operationId.toLowerCase()).maybeSingle();
            if (error) throw error;
            if (data && (data.order_id !== task.id || data.actor_user_id !== actorId)) throw problem('redemption_resolution_conflict');
            // No receipt is not proof that a concurrent transaction cannot still commit.
            if (!data) return { success: true, operation_id: operationId.toLowerCase(), state: 'not_recorded', order: cleanResult(task) };
            if (!COMMITS.has(data.action) || (data.action !== 'link_upstream_order' && (task.status !== 'closed' || task.completion_note !== data.completion_note))) {
                throw new Error('Invalid TG redemption resolution receipt');
            }
            return { success: true, operation_id: operationId.toLowerCase(), state: 'applied', action: data.action, existing: true, order: cleanResult(task) };
        },
        async execute({ supabase, actorId, input }) {
            const value = parse(input);
            if (!UUID.test(actorId || '')) throw problem('invalid_redemption_resolution', 400);
            const context = await load(supabase, value.order_no);
            const commit = COMMITS.has(value.action); const hash = commit ? requestHash(value, actorId) : null;
            let existing = false;
            if (commit) {
                const saved = await supabase.from('tg_redemption_resolution_events').select('order_id,actor_user_id,action,request_hash').eq('operation_id', value.operation_id).maybeSingle();
                if (saved.error) throw saved.error;
                if (saved.data) {
                    if (saved.data.order_id !== context.task.id || saved.data.actor_user_id !== actorId || saved.data.action !== value.action || saved.data.request_hash !== hash) throw problem('redemption_resolution_conflict');
                    existing = true;
                }
            }
            let check = {};
            if (!existing) {
                if (commit && !await confirmationReady(supabase)) throw Object.assign(problem('redemption_resolution_confirmation_required', 503), { notApplied: true });
                eligible(context, value);
                if (value.action !== 'complete_review') {
                    submitted(context);
                    check = ['inspect_upstream_order', 'link_upstream_order'].includes(value.action) ? await candidate(context.task, value.provider_order_id, supabase) : await negative(context.task);
                }
                if (value.action === 'close_with_nonacceptance') {
                    if (Date.parse(value.evidence.confirmed_at) < Date.parse(context.task.submitted_at) || Date.parse(value.evidence.confirmed_at) > now().getTime()) throw problem('invalid_redemption_resolution', 400);
                    if (value.code_disposition === 'available' && !releasable(context)) throw problem('redemption_resolution_code_unavailable');
                }
            }
            if (!commit) return { success: true, checked_at: now().toISOString(), order_no: value.order_no,
                expected_updated_at: context.task.updated_at, expected_code_updated_at: context.code.updated_at,
                ...(value.action === 'inspect_upstream_order' ? { snapshot: check, message: '原提交标识、账号和权益核验一致；确认补录时将重新查询上游。' }
                    : { message: '完整查询未发现匹配原提交标识的订单。结案仍须明确未受理且不会后续发货的凭据，空结果不能代替凭据。' }) };
            const disposition = value.action === 'complete_review' ? (value.outcome === 'delivery_confirmed' ? 'fulfilled' : 'revoked') : value.code_disposition || null;
            const { data, error } = await supabase.rpc('fn_tg_apply_redemption_resolution', {
                p_order_no: value.order_no, p_actor_id: actorId, p_action: value.action, p_operation_id: value.operation_id, p_request_hash: hash,
                p_expected_updated_at: value.expected_updated_at, p_expected_code_updated_at: value.expected_code_updated_at,
                p_note: value.note, p_completion_note: value.completion_note || null, p_outcome: value.action === 'close_with_nonacceptance' ? 'not_accepted' : value.outcome || null,
                p_code_disposition: disposition, p_provider_order_id: value.provider_order_id || null,
                p_evidence: { ...(value.evidence || {}), verification: 'operator_attestation', confirm_original_request: true,
                    ...(value.action === 'complete_review' ? { confirm_stop_fulfillment: true, confirm_result_handled: true, confirm_upstream_risk: true } : {}),
                    ...(value.action === 'close_with_nonacceptance' ? { confirm_stop_fulfillment: true, confirm_nonacceptance: true, confirm_no_delivery: true } : {}) },
                p_checked_at: now().toISOString(), p_check: check
            });
            if (error) throw databaseFailure(error);
            if (data?.success !== true) throw problem(Object.hasOwn(MESSAGES, data?.code) ? data.code : 'redemption_resolution_stale');
            const order = cleanResult(data.order);
            if (typeof data.existing !== 'boolean' || order.order_no !== value.order_no || order.id !== context.task.id
                || (value.action === 'link_upstream_order' && !data.existing && !['retry_waiting', 'succeeded', 'failed'].includes(order.status))
                || (value.action !== 'link_upstream_order' && (order.status !== 'closed' || order.completion_note !== value.completion_note))) throw new Error('Invalid TG redemption resolution result');
            return { success: true, existing: data.existing === true, operation_id: value.operation_id, order };
        }
    };
}
module.exports = { createRedemptionResolution, parse, ready, confirmationReady, requestHash, cleanResult };
