'use strict';

const crypto = require('node:crypto');
const { createGramixClient } = require('./gramix-client');
const { normalizeOrderSnapshot } = require('./worker');
const { queryUpstreamStatus } = require('./upstream-status');
const { _private: { safeOrder } } = require('../api-handlers/public/tg-purchase');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ['inspect_upstream_order', 'link_upstream_order', 'inspect_nonacceptance', 'close_with_nonacceptance'];
const MESSAGES = Object.freeze({
    recovery_migration_required: '上游订单恢复迁移尚未生效，请先执行迁移及只读验证。',
    recovery_not_allowed: '仅可处理支付状态为已付款、未关闭且原任务已提交上游的人工复核或失败订单。支付待核对的订单须先完成支付审核。',
    recovery_stale: '购买订单或原发货任务已变化，请刷新详情并重新核验。',
    recovery_active: '原任务仍在运行或持有工作租约，请等待任务停止后再处理。',
    recovery_conflict: '该操作编号或上游订单已有其他归属，请刷新详情核对处理记录。',
    recovery_provider_mismatch: '上游单号、原提交标识、接收人、商品权益或扣款币种不一致，禁止关联。不能使用同一用户的另一笔订单。',
    recovery_correlation_missing: '上游详情未返回原提交标识，无法确认是本次原始请求。请让上游提供可核验的原订单，或明确未受理凭据。',
    recovery_provider_unavailable: '上游查询未完成，请稍后重试。当前没有修改原任务。',
    recovery_negative_unconfirmed: '上游查询仍有匹配、冲突、缺少关联标识或未完成的记录，暂不能结案。查无结果本身也不等于未受理凭据。',
    invalid_recovery: '请核对原订单号、订单版本、凭据和确认项；处理原因须为 6–500 字。'
});
function problem(code, statusCode = 409) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.recovery_stale), { code, statusCode }); }
function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)); }
function cleanText(value, min, max) { return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value); }
function strictKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)); }
function parse(input) {
    const base = ['action', 'order_no', 'expected_updated_at', 'expected_task_updated_at'];
    const link = input?.action === 'inspect_upstream_order' || input?.action === 'link_upstream_order';
    const commit = input?.action === 'link_upstream_order' || input?.action === 'close_with_nonacceptance';
    const keys = [...base, ...(link ? ['provider_order_id'] : []), ...(commit ? ['operation_id', 'note', 'confirm_original_request'] : []), ...(input?.action === 'close_with_nonacceptance' ? ['evidence', 'confirm_nonacceptance', 'confirm_no_delivery', 'confirm_payment_handled'] : [])];
    if (!strictKeys(input, keys) || !ACTIONS.includes(input.action) || !/^TGP-[A-Z0-9]{20}$/.test(input.order_no || '')
        || !timestamp(input.expected_updated_at) || !timestamp(input.expected_task_updated_at)
        || (link && !UUID.test(input.provider_order_id || ''))
        || (commit && (!UUID.test(input.operation_id || '') || !cleanText(input.note, 6, 500) || input.confirm_original_request !== true))) throw problem('invalid_recovery', 400);
    const value = { ...input };
    if (link) value.provider_order_id = value.provider_order_id.toLowerCase();
    if (commit) value.note = value.note.trim();
    if (input.action === 'close_with_nonacceptance') {
        const evidence = input.evidence;
        if (!strictKeys(evidence, ['kind', 'reference', 'confirmed_at', 'summary']) || !['provider_support', 'provider_rejection'].includes(evidence.kind)
            || !cleanText(evidence.reference, 6, 200) || !timestamp(evidence.confirmed_at) || !cleanText(evidence.summary, 20, 1000)
            || input.confirm_nonacceptance !== true || input.confirm_no_delivery !== true || input.confirm_payment_handled !== true) throw problem('invalid_recovery', 400);
        value.evidence = { kind: evidence.kind, reference: evidence.reference.trim(), confirmed_at: new Date(evidence.confirmed_at).toISOString(), summary: evidence.summary.trim() };
    }
    return value;
}
async function ready(supabase) {
    const { data, error } = await supabase.rpc('fn_tg_purchase_recovery_ready');
    if (['PGRST202', '42883'].includes(error?.code)) return false;
    if (error) throw error;
    return data === true;
}
function requestHash(value) {
    return crypto.createHash('sha256').update(JSON.stringify([value.action, value.order_no, value.expected_updated_at,
        value.expected_task_updated_at, value.provider_order_id || null, value.note, value.evidence || null,
        value.confirm_original_request, value.confirm_nonacceptance || false, value.confirm_no_delivery || false, value.confirm_payment_handled || false])).digest('hex');
}
function safeReceipt(record) {
    return { operation_id: record.operation_id, action: record.action, actor_user_id: record.actor_user_id, created_at: record.created_at,
        provider_order_id: record.provider_order_id || null, result_status: record.result_status, note: record.note,
        evidence: record.action === 'close_with_nonacceptance' ? { verification: 'operator_attestation', kind: record.evidence?.kind,
            reference: record.evidence?.reference, confirmed_at: record.evidence?.confirmed_at, summary: record.evidence?.summary } : null };
}
function createPurchaseRecovery({ env = process.env, clientFactory = createGramixClient, queryUpstream = queryUpstreamStatus, now = () => new Date() } = {}) {
    async function load(supabase, orderNo) {
        if (!await ready(supabase)) throw problem('recovery_migration_required');
        const purchase = await supabase.from('tg_purchase_orders').select('id,order_no,telegram_username,product_family,term_months,stars_quantity,payment_status,paid_at,cancelled_at,closed_at,updated_at').eq('order_no', orderNo).maybeSingle();
        if (purchase.error) throw purchase.error;
        if (!purchase.data || !UUID.test(purchase.data.id || '')) throw problem('recovery_not_allowed');
        const tasks = await supabase.from('tg_redemption_orders').select('id,order_no,order_source,purchase_id,code_id,telegram_username,product_family,term_months,stars_quantity,status,provider,provider_order_id,provider_payment_currency,provider_idempotency_key,attempt_count,submitted_at,lease_token,lease_expires_at,updated_at')
            .eq('purchase_id', purchase.data.id).limit(2);
        if (tasks.error) throw tasks.error;
        if (!Array.isArray(tasks.data) || tasks.data.length > 1) throw problem('recovery_conflict');
        return { order: purchase.data, task: tasks.data[0] };
    }
    function eligible({ order, task }, value) {
        if (!task || !UUID.test(task.id || '') || order.closed_at || order.cancelled_at || !order.paid_at || order.payment_status !== 'paid'
            || task.order_source !== 'purchase' || task.purchase_id !== order.id || task.code_id != null || task.provider !== 'gramix'
            || task.telegram_username !== order.telegram_username || task.product_family !== order.product_family || task.term_months !== order.term_months || task.stars_quantity !== order.stars_quantity
            || !task.submitted_at || !Number.isInteger(task.attempt_count) || task.attempt_count < 1 || !task.provider_idempotency_key
            || !['usdt', 'gram'].includes(task.provider_payment_currency)) throw problem('recovery_not_allowed');
        if (!['manual_review', 'failed'].includes(task.status) || task.lease_token || task.lease_expires_at) throw problem('recovery_active');
        if (value && (order.updated_at !== value.expected_updated_at || task.updated_at !== value.expected_task_updated_at)) throw problem('recovery_stale');
    }
    async function candidate(task, id, supabase) {
        if (task.provider_order_id && task.provider_order_id.toLowerCase() !== id) throw problem('recovery_conflict');
        let checked;
        try { checked = normalizeOrderSnapshot(await clientFactory({ env }).getOrder(id, { timeoutMs: 3000 }), { ...task, provider_order_id: id }); }
        catch (_) { throw problem('recovery_provider_unavailable'); }
        if (!checked.valid) throw problem('recovery_provider_mismatch');
        if (checked.snapshot.idempotency_key_matches !== true) throw problem('recovery_correlation_missing');
        // The unique case-folded database index is the final concurrent ownership guard.
        const owners = await supabase.from('tg_redemption_orders').select('id').eq('provider', 'gramix').ilike('provider_order_id', id).limit(2);
        if (owners.error) throw owners.error;
        if (!Array.isArray(owners.data) || owners.data.some(owner => owner.id !== task.id)) throw problem('recovery_conflict');
        return checked.snapshot;
    }
    async function negative(task) {
        if (task.provider_order_id) throw problem('recovery_negative_unconfirmed');
        const check = await queryUpstream({ order: task, env, clientFactory, now });
        // A completed, correlated search only rules out a contradictory known order.
        // The actual nonacceptance evidence remains an explicit operator attestation.
        if (check?.status !== 'not_found' || check.verified !== false || check.search?.exhausted !== true || check.search?.missing_correlation !== false) throw problem('recovery_negative_unconfirmed');
        return { status: 'not_found', search: { exhausted: true, missing_correlation: false, pages: check.search.pages, scanned: check.search.scanned } };
    }
    return {
        async details({ supabase, orderNo }) {
            let context;
            try { context = await load(supabase, orderNo); }
            catch (error) { if (error.code === 'recovery_migration_required') return { success: true, ready: false, can_link: false, can_record_nonacceptance: false, message: error.message, records: [] }; throw error; }
            const { data, error } = await supabase.from('tg_purchase_recovery_events').select('operation_id,action,actor_user_id,provider_order_id,result_status,note,evidence,created_at').eq('purchase_id', context.order.id).order('created_at', { ascending: false }).limit(20);
            if (error) throw error;
            let blocked = null;
            try { eligible(context); } catch (error) { blocked = error.message; }
            return { success: true, ready: true, can_link: !blocked, can_record_nonacceptance: !blocked && !context.task.provider_order_id,
                message: blocked || '补录只关联本次原始请求；未受理凭据须明确针对原请求，确认上游未受理且不会后续发货。',
                records: (data || []).map(safeReceipt) };
        },
        async execute({ supabase, actorId, input }) {
            const value = parse(input);
            if (!UUID.test(actorId || '')) throw problem('invalid_recovery', 400);
            const context = await load(supabase, value.order_no);
            const commit = ['link_upstream_order', 'close_with_nonacceptance'].includes(value.action);
            const hash = commit ? requestHash(value) : null;
            let existing = false;
            if (commit) {
                const receipt = await supabase.from('tg_purchase_recovery_events').select('purchase_id,actor_user_id,action,request_hash').eq('operation_id', value.operation_id).maybeSingle();
                if (receipt.error) throw receipt.error;
                if (receipt.data) {
                    if (receipt.data.purchase_id !== context.order.id || receipt.data.actor_user_id !== actorId || receipt.data.action !== value.action || receipt.data.request_hash !== hash) throw problem('recovery_conflict');
                    existing = true;
                }
            }
            let check = {};
            if (!existing) {
                eligible(context, value);
                check = ['inspect_upstream_order', 'link_upstream_order'].includes(value.action)
                    ? await candidate(context.task, value.provider_order_id, supabase) : await negative(context.task);
                if (value.action === 'close_with_nonacceptance' && (Date.parse(value.evidence.confirmed_at) < Date.parse(context.task.submitted_at)
                    || Date.parse(value.evidence.confirmed_at) > now().getTime())) throw problem('invalid_recovery', 400);
            }
            if (!commit) return { success: true, checked_at: now().toISOString(), order_no: context.order.order_no,
                expected_updated_at: context.order.updated_at, expected_task_updated_at: context.task.updated_at,
                ...(value.action === 'inspect_upstream_order' ? { snapshot: check, message: '原提交标识及商品权益核验一致；确认补录时会再次查询上游。' }
                    : { message: '本次完整查询未发现与原提交标识匹配的上游订单。仍须登记上游明确未受理且不会后续发货的凭据；空结果不能代替凭据。' }) };
            const { data, error } = await supabase.rpc('fn_tg_apply_purchase_recovery', {
                p_order_no: value.order_no, p_actor_id: actorId, p_action: value.action, p_operation_id: value.operation_id, p_request_hash: hash,
                p_expected_updated_at: value.expected_updated_at, p_expected_task_updated_at: value.expected_task_updated_at,
                p_note: value.note, p_provider_order_id: value.provider_order_id || null,
                p_evidence: { ...(value.evidence || {}), confirm_original_request: true, ...(value.action === 'close_with_nonacceptance'
                    ? { verification: 'operator_attestation', confirm_nonacceptance: true, confirm_no_delivery: true, confirm_payment_handled: true } : {}) },
                p_checked_at: now().toISOString(), p_check: check
            });
            if (error) throw error;
            if (data?.success !== true) throw problem(Object.hasOwn(MESSAGES, data?.code) ? data.code : 'recovery_stale');
            const order = safeOrder(data.order);
            if (!order || order.order_no !== value.order_no || (value.action === 'close_with_nonacceptance' && (order.fulfillment_status !== 'closed' || !order.closed_at))) throw new Error('Invalid TG recovery response');
            return { success: true, existing: data.existing === true, operation_id: value.operation_id, order };
        }
    };
}
module.exports = { createPurchaseRecovery, parse, ready, requestHash };
