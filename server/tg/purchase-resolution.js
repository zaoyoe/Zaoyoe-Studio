'use strict';

const { queryUpstreamStatus } = require('./upstream-status');
const { _private: { safeOrder } } = require('../api-handlers/public/tg-purchase');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = {
    resolution_migration_required: '订单处理数据库迁移尚未生效，请先执行迁移。',
    order_closed: '订单已关闭，不会继续自动发货。关闭订单不会自动退款，请核对支付后台。',
    resolution_stale: '订单或发货任务已变化，请重新核对后处理。',
    fulfillment_active: '发货任务仍在运行，当前不能关闭或重新提交。请先查询原任务及上游状态。',
    delivery_uncertain: '原任务可能已提交上游，尚不能确认未发货。请核对上游；查无结果或超时不能作为重复补发依据。',
    payment_review_completion_required: '尚无已核验到账记录。请核对支付渠道或链上记录，再到购买订单详情的“人工完结”登记支付核验结果。',
    not_reviewable: '此订单当前不属于可人工处理的订单。',
    invalid_resolution: '请填写 6–500 字处理依据，并确认收款、退款及发货记录。'
};
function problem(code, statusCode = 409) { return Object.assign(new Error(MESSAGES[code] || '订单处理尚未确认，请重新查询。'), { code, statusCode }); }
async function ready(supabase) {
    const result = await supabase.rpc('fn_tg_purchase_resolution_ready');
    if (['PGRST202', '42883'].includes(result.error?.code)) return false;
    if (result.error) throw result.error;
    return result.data === true;
}
function parse(input) {
    const keys = new Set(['action', 'order_no', 'expected_updated_at', 'note', 'confirm_no_delivery', 'confirm_payment_handled']);
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !keys.has(key)) || !['close_order', 'resume_fulfillment'].includes(input.action)
        || !/^TGP-[A-Z0-9]{20}$/.test(input.order_no || '') || typeof input.expected_updated_at !== 'string'
        || !/^\d{4}-\d\d-\d\dT/.test(input.expected_updated_at) || !Number.isFinite(Date.parse(input.expected_updated_at))
        || typeof input.note !== 'string' || input.note.trim().length < 6 || input.note.trim().length > 500 || /[\x00-\x1f\x7f]/.test(input.note)
        || input.confirm_no_delivery !== true || input.confirm_payment_handled !== true) throw problem('invalid_resolution', 400);
    return { ...input, note: input.note.trim() };
}
function createPurchaseResolution({ env = process.env, queryUpstream = queryUpstreamStatus, now = () => new Date() } = {}) {
    async function inspect({ supabase, orderNo }) {
        if (!await ready(supabase)) return { ready: false, can_close: false, can_resume: false, message: MESSAGES.resolution_migration_required };
        const purchase = await supabase.from('tg_purchase_orders').select('id,order_no,payment_status,paid_at,cancelled_at,closed_at,updated_at').eq('order_no', orderNo).maybeSingle();
        if (purchase.error) throw purchase.error;
        const order = purchase.data;
        if (!order || !UUID.test(order.id || '')) throw problem('not_reviewable');
        const tasks = await supabase.from('tg_redemption_orders').select('id,order_no,order_source,purchase_id,code_id,telegram_username,product_family,term_months,stars_quantity,status,provider,provider_order_id,provider_payment_currency,provider_idempotency_key,attempt_count,submitted_at,lease_token,lease_expires_at,updated_at')
            .eq('purchase_id', order.id).limit(2);
        if (tasks.error) throw tasks.error;
        if (!Array.isArray(tasks.data) || tasks.data.length > 1) throw problem('delivery_uncertain');
        const task = tasks.data[0];
        let code = order.closed_at ? 'order_closed' : !order.paid_at || order.cancelled_at || !['paid', 'manual_review'].includes(order.payment_status) ? 'not_reviewable' : null;
        if (!order.closed_at && !order.cancelled_at && !order.paid_at && order.payment_status === 'manual_review') code = 'payment_review_completion_required';
        if (!code && task && (!['manual_review', 'failed'].includes(task.status) || task.lease_token || task.lease_expires_at)) code = 'fulfillment_active';
        let pristine = !task; let upstream = null;
        if (!code && task) {
            const attempts = await supabase.from('tg_fulfillment_attempts').select('id').eq('order_id', task.id).limit(1);
            if (attempts.error || !Array.isArray(attempts.data)) throw problem('delivery_uncertain');
            pristine = !task.submitted_at && !task.provider_order_id && task.attempt_count === 0 && attempts.data.length === 0;
            if (!pristine) upstream = await queryUpstream({ order: task, env, now });
        }
        const verified = upstream?.verified === true && upstream.snapshot?.verified_by === 'order_get';
        const terminalFailure = verified && ['failed', 'canceled'].includes(upstream.snapshot.provider_status);
        const canClose = !code && (pristine || terminalFailure);
        // An existing provider task is only polled. Submission history is never reset.
        const canResume = !code && !!task && order.payment_status === 'paid' && (pristine || (verified && !terminalFailure && !!task.provider_order_id && !!task.submitted_at && ['usdt', 'gram'].includes(task.provider_payment_currency)));
        return { ready: true, code, can_close: canClose, can_resume: canResume, closed_at: order.closed_at,
            message: code ? MESSAGES[code] : canClose ? '可关闭此订单；关闭后停止发货，收款及退款记录仍须在支付后台核对。'
                : canResume ? '可恢复原发货任务的状态核对，不会重复创建上游订单。' : MESSAGES.delivery_uncertain,
            order, task, upstream, pristine };
    }
    return {
        async details(args) {
            const result = await inspect(args);
            return Object.fromEntries(['ready', 'can_close', 'can_resume', 'closed_at', 'message'].filter(key => result[key] !== undefined).map(key => [key, result[key]]));
        },
        async resolve({ supabase, actorId, input }) {
            const value = parse(input);
            if (!UUID.test(actorId || '')) throw problem('invalid_resolution', 400);
            const result = await inspect({ supabase, orderNo: value.order_no });
            if (!result.ready) throw problem('resolution_migration_required');
            // Closing twice is idempotent, even after a response was lost.
            if (!result.closed_at && !(value.action === 'close_order' ? result.can_close : result.can_resume)) throw problem(result.code === 'payment_review_completion_required' ? result.code : 'delivery_uncertain');
            const { data, error } = await supabase.rpc('fn_tg_resolve_purchase_review', {
                p_order_no: value.order_no, p_actor_id: actorId, p_action: value.action, p_expected_updated_at: value.expected_updated_at,
                p_expected_task_updated_at: result.task?.updated_at || null, p_note: value.note,
                p_confirm_no_delivery: true, p_confirm_payment_handled: true,
                p_checked_at: now().toISOString(), p_upstream_snapshot: result.upstream?.verified ? result.upstream.snapshot : {}
            });
            if (error) throw error;
            if (data?.success !== true) throw problem(Object.hasOwn(MESSAGES, data?.code) ? data.code : 'resolution_stale');
            const order = safeOrder(data.order);
            if (!order || order.order_no !== value.order_no || (value.action === 'close_order' && order.fulfillment_status !== 'closed')) throw new Error('Invalid TG resolution response');
            return { success: true, existing: data.existing === true, order };
        }
    };
}
module.exports = { createPurchaseResolution, ready, parse };
