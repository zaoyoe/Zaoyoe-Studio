'use strict';

const { createTgPaymentGateway } = require('./payment-gateway');
const { fulfillmentRuntime } = require('./upstream-status');
const { _private: { safeOrder } } = require('../api-handlers/public/tg-purchase');
const ORDER_NO = /^TGP-[A-Z0-9]{20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const FULFILLMENT = new Set(['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled']);
const FIELDS = 'id,order_no,telegram_username,product_family,term_months,stars_quantity,currency,total_minor,subtotal_minor,payment_fee_minor,payment_fee_rate_bps,price_version,payment_provider,payment_channel,payment_merchant_id,provider_trade_no,payment_status,paid_at,cancelled_at,checkout_started_at,payment_expires_at,last_error_code,created_at,updated_at';
const DELIVERY_FIELDS = 'id,order_no,order_source,purchase_id,code_id,telegram_username,product_family,term_months,stars_quantity,status,provider_order_id,created_at,completed_at';
const MESSAGES = Object.freeze({
    migration_required: '审核补发数据库迁移尚未生效，请先完成迁移并重新核对。',
    order_closed: '订单已关闭，不能再创建发货任务。请核对支付后台的退款记录。',
    provider_unsupported: '此入口仅支持支付宝或微信的易支付收款核对；其他支付方式请继续人工处理。',
    cancelled_order: '订单已取消，请先核对退款和收货情况，此入口不会恢复发货。',
    payment_not_recorded: '本地尚未确认到账，请先恢复收款记录再审核。',
    fulfillment_exists: '已有发货任务，请查看原任务及上游状态，不能再次创建。',
    not_reviewable: '此订单不属于已收款且尚未发货的过期核对订单。',
    payment_unconfirmed: '支付渠道暂时无法确认收款，请重新核对；当前不能补发。',
    payment_not_paid: '支付渠道未确认已付款，当前不能补发。',
    payment_binding_mismatch: '收款凭据与原订单不一致，当前不能补发。',
    review_stale: '订单已发生变化，请重新核对后再审核。',
    invalid_review: '审核信息无效，请重新核对并填写备注和确认项。',
    not_found: '购买订单不存在。'
});
function problem(code, statusCode = 409) { return Object.assign(new Error(MESSAGES[code] || '审核结果尚未确认，请重新核对原订单。'), { code, statusCode }); }
function validOrderNo(value) { return typeof value === 'string' && ORDER_NO.test(value); }
function approvalInput(input) {
    const keys = new Set(['action', 'order_no', 'expected_updated_at', 'note', 'confirm_no_refund', 'confirm_no_delivery']);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !keys.has(key))
        || input.action !== 'approve_fulfillment' || !validOrderNo(input.order_no)
        || typeof input.expected_updated_at !== 'string' || !TIMESTAMP.test(input.expected_updated_at) || !Number.isFinite(Date.parse(input.expected_updated_at))
        || typeof input.note !== 'string' || input.note.trim().length < 6 || input.note.trim().length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.note)
        || input.confirm_no_refund !== true || input.confirm_no_delivery !== true) throw problem('invalid_review', 400);
    return { ...input, note: input.note.trim() };
}
function missingRpc(error) { return ['PGRST202', '42883'].includes(error?.code); }
async function reviewReady(supabase) {
    const { data, error } = await supabase.rpc('fn_tg_purchase_fulfillment_review_ready');
    if (missingRpc(error)) return false;
    if (error) throw error;
    return data === true;
}
function sameDelivery(order, delivery) {
    return delivery?.order_source === 'purchase' && delivery.purchase_id === order.id && delivery.code_id == null
        && delivery.telegram_username === order.telegram_username && delivery.product_family === order.product_family
        && delivery.term_months === order.term_months && delivery.stars_quantity === order.stars_quantity
        && UUID.test(delivery.id || '') && /^TG-[A-Z0-9]{20}$/.test(delivery.order_no || '') && FULFILLMENT.has(delivery.status);
}
async function loadOrder(supabase, orderNo) {
    if (!validOrderNo(orderNo)) throw problem('invalid_review', 400);
    const { data: order, error } = await supabase.from('tg_purchase_orders').select(FIELDS).eq('order_no', orderNo).maybeSingle();
    if (error) throw error;
    if (!order) throw problem('not_found', 404);
    if (order.order_no !== orderNo || !UUID.test(order.id || '')) throw new Error('Invalid TG review order');
    const { data, error: deliveryError } = await supabase.from('tg_redemption_orders').select(DELIVERY_FIELDS).eq('purchase_id', order.id).limit(2);
    if (deliveryError) throw deliveryError;
    if (!Array.isArray(data) || data.length > 1 || (data.length === 1 && !sameDelivery(order, data[0]))) throw new Error('Invalid TG review fulfillment');
    const delivery = data[0] || null;
    const safe = safeOrder({ ...order, fulfillment_status: delivery?.status || 'not_started' });
    if (!safe || !TIMESTAMP.test(order.updated_at || '')) throw new Error('Invalid TG review snapshot');
    return { order, delivery, safe };
}
function blockedReason(order, delivery) {
    if (order.payment_provider !== 'zpay' || !['alipay', 'wxpay'].includes(order.payment_channel)) return 'provider_unsupported';
    if (order.cancelled_at) return 'cancelled_order';
    if (delivery) return 'fulfillment_exists';
    if (!order.paid_at || !order.checkout_started_at || !/^[A-Za-z0-9_-]{1,128}$/.test(order.provider_trade_no || '')
        || order.provider_trade_no === order.order_no) return 'payment_not_recorded';
    if (order.payment_status !== 'manual_review' || order.last_error_code !== 'payment_received_after_expiry') return 'not_reviewable';
    return null;
}
function verifiedPayment(order, verified) {
    const proof = verified?.verified_payload;
    return verified?.provider === 'zpay' && verified.order_no === order.order_no && verified.merchant_id === order.payment_merchant_id
        && verified.provider_trade_no === order.provider_trade_no && verified.payment_channel === order.payment_channel
        && verified.amount_minor === order.total_minor && verified.currency === order.currency
        && proof?.verified_by === 'authenticated_query' && proof.event_status === 'paid' && proof.provider_order_no === order.order_no
        && proof.merchant_id === order.payment_merchant_id && proof.provider_trade_no === order.provider_trade_no
        && proof.checkout_trade_no === order.provider_trade_no
        && proof.payment_channel === order.payment_channel && proof.amount_minor === order.total_minor && proof.currency === order.currency;
}
function safeDelivery(delivery) {
    return delivery ? { id: delivery.id, order_no: delivery.order_no, status: delivery.status, has_provider_order: !!delivery.provider_order_id,
        created_at: delivery.created_at, completed_at: delivery.completed_at } : null;
}
function createPurchaseReview({ env = process.env, gateway = createTgPaymentGateway({ env }), now = () => new Date() } = {}) {
    async function checkPayment(order) {
        if (order.payment_provider !== 'zpay' || !['alipay', 'wxpay'].includes(order.payment_channel)) return { status: 'unsupported', checked_at: now().toISOString() };
        try {
            const verified = await gateway.queryPayment({ order });
            const checkedAt = now().toISOString();
            if (verified == null) return { status: 'unpaid', checked_at: checkedAt };
            if (!verifiedPayment(order, verified)) return { status: 'mismatch', checked_at: checkedAt };
            const proof = verified.verified_payload;
            const paymentProof = Object.fromEntries(['verified_by', 'event_status', 'provider_order_no', 'merchant_id', 'provider_trade_no',
                'checkout_trade_no', 'payment_channel', 'amount_minor', 'currency'].map((key) => [key, proof[key]]));
            return { status: 'confirmed', checked_at: checkedAt, proof: paymentProof };
        } catch (_) { return { status: 'unconfirmed', checked_at: now().toISOString() }; }
    }
    return {
        async details({ supabase, orderNo }) {
            const [{ order, delivery, safe }, ready] = await Promise.all([loadOrder(supabase, orderNo), reviewReady(supabase)]);
            const payment = await checkPayment(order);
            const code = !ready ? 'migration_required' : blockedReason(order, delivery)
                || (payment.status === 'unpaid' ? 'payment_not_paid' : payment.status === 'mismatch' ? 'payment_binding_mismatch' : payment.status !== 'confirmed' ? 'payment_unconfirmed' : null);
            const { data: history, error } = await supabase.from('tg_audit_events').select('actor_user_id,created_at,metadata')
                .eq('target_type', 'purchase_order').eq('target_id', order.id).eq('event_type', 'purchase_fulfillment_approved').order('created_at', { ascending: false }).limit(5);
            if (error) throw error;
            return { success: true, order: safe, fulfillment: safeDelivery(delivery),
                review: { ready, can_approve: !code, blocked_code: code, message: code ? MESSAGES[code] : '收款核对一致，确认未退款且未另行发货后可提交审核。',
                    reason: order.last_error_code === 'payment_received_after_expiry' ? 'payment_received_after_expiry' : null,
                    receipt_recorded_at: order.paid_at, worker_enabled: /^(true|1)$/i.test(String(env.TG_FULFILLMENT_ENABLED || '').trim()), worker_scope: 'current_api'  },
                runtime: fulfillmentRuntime(env),
                payment_check: { status: payment.status, checked_at: payment.checked_at,
                    ...(payment.status === 'confirmed' ? { amount_minor: order.total_minor, currency: order.currency } : {}) },
                reviews: (history || []).map((event) => ({ actor_user_id: event.actor_user_id, created_at: event.created_at,
                    note: typeof event.metadata?.note === 'string' ? event.metadata.note.slice(0, 500) : '', payment_checked_at: event.metadata?.payment_checked_at || null })) };
        },
        async approve({ supabase, actorId, input }) {
            const value = approvalInput(input);
            if (!UUID.test(actorId || '')) throw problem('invalid_review', 400);
            if (!await reviewReady(supabase)) throw problem('migration_required');
            const { order, delivery } = await loadOrder(supabase, value.order_no);
            // A second request after a lost response may return the original task.
            // Only the locked RPC can recognize an approval audit; it never resets it.
            const retry = order.payment_status === 'paid' && order.paid_at && delivery && !order.cancelled_at;
            const blocked = blockedReason(order, delivery);
            if (blocked && !retry) throw problem(blocked);
            const payment = await checkPayment(order);
            if (payment.status !== 'confirmed') throw problem(payment.status === 'unpaid' ? 'payment_not_paid' : payment.status === 'mismatch' ? 'payment_binding_mismatch' : 'payment_unconfirmed');
            const { data, error } = await supabase.rpc('fn_tg_approve_purchase_fulfillment', {
                p_order_no: value.order_no, p_actor_id: actorId, p_expected_updated_at: value.expected_updated_at,
                p_review_note: value.note, p_payment_checked_at: payment.checked_at, p_verified_payment: payment.proof,
                p_confirm_no_refund: true, p_confirm_no_delivery: true
            });
            if (missingRpc(error)) throw problem('migration_required');
            if (error) throw error;
            if (data?.success !== true) throw problem(Object.hasOwn(MESSAGES, data?.code) ? data.code : 'review_unconfirmed');
            const safe = safeOrder(data.order);
            if (!safe || safe.order_no !== order.order_no || safe.payment_status !== 'paid' || !FULFILLMENT.has(safe.fulfillment_status)
                || safe.username !== order.telegram_username || safe.product_family !== order.product_family || safe.term_months !== order.term_months
                || safe.stars_quantity !== order.stars_quantity || safe.total_minor !== order.total_minor || safe.subtotal_minor !== order.subtotal_minor
                || safe.payment_fee_minor !== order.payment_fee_minor || safe.payment_fee_rate_bps !== order.payment_fee_rate_bps
                || safe.price_version !== order.price_version || safe.payment_channel !== order.payment_channel || safe.currency !== order.currency || typeof data.existing !== 'boolean') throw new Error('Invalid TG approval result');
            return { success: true, existing: data.existing, order: safe };
        }
    };
}
module.exports = { createPurchaseReview, approvalInput, validOrderNo };
