'use strict';

const { createHash } = require('node:crypto');
const { _private: { safeOrder } } = require('../api-handlers/public/tg-purchase');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAID_OUTCOMES = ['refunded', 'delivery_confirmed', 'agreed_settlement'];
const PAYMENT_REVIEW_OUTCOMES = ['no_valid_payment', 'refunded', 'agreed_settlement'];
const OUTCOMES = [...new Set([...PAID_OUTCOMES, ...PAYMENT_REVIEW_OUTCOMES])];
const MESSAGES = {
    completion_migration_required: '人工完结功能尚未完成数据库升级，请先执行人工完结迁移。',
    payment_review_completion_migration_required: '支付人工核对订单的完结功能需要增量数据库升级，请执行支付复核完结迁移。',
    completion_outcome_mismatch: '处理结果与当前支付记录不符，请重新核对；未核验付款的订单不能登记为已收货，已核验到账的订单不能登记为无有效付款。',
    invalid_completion: '请选择实际处理结果，填写内部处理依据和用户可见的完结说明，并完成所有确认。',
    completion_stale: '订单或发货任务已变化，请刷新详情，重新核对后完结。',
    completion_active: '原发货任务或支付请求仍在运行，请等待结束并重新核对。',
    completion_not_allowed: '当前订单不符合人工完结条件，请核对支付状态、关联发货任务及完结记录。',
    completion_conflict: '本次操作与已保存的完结记录不一致，请查询订单最新结果。',
    order_closed: '订单已完结，请查看已保存的完结说明。'
};
function problem(code, statusCode = 409) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.completion_stale), { code, statusCode }); }
function validText(value) { return typeof value === 'string' && value.trim().length >= 6 && value.trim().length <= 500 && !/[\x00-\x09\x0b-\x1f\x7f]/.test(value); }
function version(value, nullable = false) { return nullable && value === null || typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)); }
function parse(input) {
    const keys = new Set(['action', 'order_no', 'expected_updated_at', 'expected_task_id', 'expected_task_updated_at', 'operation_id', 'outcome', 'note', 'completion_note', 'confirm_payment_handled', 'confirm_stop_fulfillment', 'confirm_upstream_risk']);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.has(key))
        || input.action !== 'complete_review' || !/^TGP-[A-Z0-9]{20}$/.test(input.order_no || '')
        || !UUID.test(input.operation_id || '') || !version(input.expected_updated_at)
        || !(input.expected_task_id === null || UUID.test(input.expected_task_id || '')) || !version(input.expected_task_updated_at, true)
        || (input.expected_task_id === null) !== (input.expected_task_updated_at === null)
        || !OUTCOMES.includes(input.outcome) || !validText(input.note) || !validText(input.completion_note)
        || input.confirm_payment_handled !== true || input.confirm_stop_fulfillment !== true || input.confirm_upstream_risk !== true) throw problem('invalid_completion', 400);
    return { ...input, note: input.note.trim(), completion_note: input.completion_note.trim() };
}
async function ready(supabase, paymentReview = false) {
    const result = await supabase.rpc(paymentReview ? 'fn_tg_purchase_payment_review_completion_ready' : 'fn_tg_purchase_completion_ready');
    if (['PGRST202', '42883'].includes(result.error?.code)) return false;
    if (result.error) throw result.error;
    return result.data === true;
}
function requestHash(value, actorId) {
    return createHash('sha256').update(JSON.stringify([actorId, value.order_no, value.expected_updated_at, value.expected_task_id, value.expected_task_updated_at,
        value.operation_id, value.outcome, value.note, value.completion_note, true, true, true])).digest('hex');
}
function createPurchaseCompletion() {
    return {
        async details({ supabase, orderNo }) {
            if (!await ready(supabase)) return { ready: false, can_complete: false, message: MESSAGES.completion_migration_required };
            const purchase = await supabase.from('tg_purchase_orders').select('id,order_no,telegram_username,product_family,term_months,stars_quantity,payment_status,paid_at,cancelled_at,closed_at,completion_note,completion_outcome,checkout_lease_token,checkout_lease_expires_at,updated_at').eq('order_no', orderNo).maybeSingle();
            if (purchase.error) throw purchase.error;
            const order = purchase.data;
            if (!order || !UUID.test(order.id || '')) throw problem('completion_not_allowed');
            const tasks = await supabase.from('tg_redemption_orders').select('id,order_source,purchase_id,code_id,telegram_username,product_family,term_months,stars_quantity,status,lease_token,lease_expires_at,submitted_at,provider_order_id,attempt_count,updated_at').eq('purchase_id', order.id).limit(2);
            if (tasks.error) throw tasks.error;
            if (!Array.isArray(tasks.data) || tasks.data.length > 1) throw problem('completion_not_allowed');
            const task = tasks.data[0];
            const binding = !task || task.order_source === 'purchase' && task.purchase_id === order.id && task.code_id == null
                && ['telegram_username', 'product_family', 'term_months', 'stars_quantity'].every(key => task[key] === order[key]);
            const paymentUnverified = !order.paid_at;
            const eligiblePayment = paymentUnverified ? order.payment_status === 'manual_review' && !task : ['paid', 'manual_review'].includes(order.payment_status);
            let code = order.closed_at ? 'order_closed' : !eligiblePayment || order.cancelled_at || !binding ? 'completion_not_allowed' : null;
            if (!code && (order.checkout_lease_token || order.checkout_lease_expires_at || task && (!['manual_review', 'failed'].includes(task.status) || task.lease_token || task.lease_expires_at))) code = 'completion_active';
            if (!code && paymentUnverified && !await ready(supabase, true)) return { ready: false, can_complete: false, payment_unverified: true,
                allowed_outcomes: [], message: MESSAGES.payment_review_completion_migration_required };
            return { ready: true, can_complete: !code, payment_unverified: paymentUnverified,
                allowed_outcomes: code ? [] : paymentUnverified ? PAYMENT_REVIEW_OUTCOMES : PAID_OUTCOMES,
                message: code ? MESSAGES[code] : paymentUnverified
                    ? '先核对支付渠道或链上记录；确认无有效付款、已另行退款或已协商处理后再完结。迟到付款仍会记录并需要另行处理。'
                    : '先完成退款、收货核实或与用户协商，再填写完结说明。完结后停止自动处理。',
                expected_updated_at: order.updated_at, expected_task_id: task?.id || null, expected_task_updated_at: task?.updated_at || null,
                upstream_submitted: !!(task?.submitted_at || task?.provider_order_id || task?.attempt_count > 0),
                ...(order.closed_at ? { closed_at: order.closed_at, completion_note: order.completion_note || null, outcome: order.completion_outcome || null } : {}) };
        },
        async complete({ supabase, actorId, input }) {
            const value = parse(input);
            if (!UUID.test(actorId || '')) throw problem('invalid_completion', 400);
            if (!await ready(supabase)) throw problem('completion_migration_required');
            if (value.outcome === 'no_valid_payment' && !await ready(supabase, true)) throw problem('payment_review_completion_migration_required');
            // All eligibility, version and idempotency checks happen under the
            // same purchase -> task locks as the worker. No upstream buy occurs.
            const { data, error } = await supabase.rpc('fn_tg_complete_purchase_review', {
                p_order_no: value.order_no, p_actor_id: actorId, p_expected_updated_at: value.expected_updated_at,
                p_expected_task_id: value.expected_task_id, p_expected_task_updated_at: value.expected_task_updated_at,
                p_operation_id: value.operation_id, p_request_hash: requestHash(value, actorId), p_outcome: value.outcome,
                p_note: value.note, p_completion_note: value.completion_note, p_confirm_payment_handled: true, p_confirm_stop_fulfillment: true, p_confirm_upstream_risk: true
            });
            if (['PGRST202', '42883', '42703'].includes(error?.code)) throw problem('completion_migration_required');
            if (error) throw error;
            if (data?.success !== true) throw problem(Object.hasOwn(MESSAGES, data?.code) ? data.code : 'completion_stale');
            const order = safeOrder(data.order);
            if (!order || order.order_no !== value.order_no || order.fulfillment_status !== 'closed' || !order.closed_at || order.completion_note !== value.completion_note
                || typeof data.existing !== 'boolean') throw new Error('Invalid TG completion response');
            return { success: true, existing: data.existing, order };
        }
    };
}
module.exports = { createPurchaseCompletion, parse, requestHash, ready };
