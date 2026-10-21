'use strict';
const { publicResolution } = require('./resolution');

// Public/native-order projection only. Supplier accounts, mapping revisions,
// procurement payloads and risk ceilings never cross this boundary.
function supplierOrderStatus(order = {}) {
    if (order.fulfillment_source !== 'supplier_v2') return {};
    const resolution = publicResolution(order.supplier_customer_resolution);
    if (resolution) return { fulfillment_source: 'supplier_v2', supplier_status: resolution.status,
        fulfillment_message: resolution.message, customer_resolution: resolution,
        ...(order.delivery_status ? { delivery_status: order.delivery_status } : {}) };
    const fulfillment = order.fulfillment_status || order.delivery_status;
    let status;
    if (order.status === 'partial_refund') status = 'partially_refunded';
    else if (order.status === 'full_refund' || ['refunded', 'full_refund', 'succeeded', 'success'].includes(order.refund_status)
        || order.payment_status === 'refunded' || fulfillment === 'refunded') status = 'refunded';
    else if (order.refund_status === 'pending') status = 'refunding';
    else if (['failed', 'manual_review'].includes(order.refund_status)
        || ['paid_unfulfillable', 'dead_letter', 'failed'].includes(fulfillment)
        || ['partial', 'overpaid', 'amount_mismatch', 'chargeback', 'review'].includes(order.payment_status)) status = 'review';
    else if (order.payment_status === 'expired' || order.status === 'expired') status = 'expired';
    else if (['cancelled', 'canceled', 'closed'].includes(order.status)) status = 'closed';
    else if (order.payment_status === 'failed') status = 'failed';
    else if (['pending', 'created'].includes(order.payment_status)) status = 'awaiting_payment';
    else if (order.payment_status && !['confirmed', 'paid'].includes(order.payment_status)) status = 'review';
    else status = fulfillment === 'delivered' ? 'delivered' : 'pending';
    const messages = {
        refunded: '订单退款已处理，请在订单记录中核对退款结果',
        partially_refunded: '订单已部分退款，请在订单记录中核对退款与供货结果',
        refunding: '订单退款处理中，请在订单记录中查看退款结果',
        review: '订单正在核对处理中，请在订单记录中查看结果或联系客服',
        expired: '订单已过期；如已付款，请联系客服核对付款结果',
        closed: '订单已关闭；如已付款，请联系客服核对付款结果',
        failed: '付款未成功，请在订单记录中核对结果后再试',
        awaiting_payment: '订单已创建，等待付款确认',
        delivered: '订单已完成供货',
        pending: '订单已受理，正在等待供货处理，请在订单记录中查看进度'
    };
    return {
        fulfillment_source: 'supplier_v2',
        supplier_status: status,
        fulfillment_message: messages[status],
        ...(order.delivery_status ? { delivery_status: order.delivery_status } : {})
    };
}

// Only map our exact database guard. Do not reflect database details or
// upstream responses into an administrator-facing financial operation error.
function supplierResolutionError(error) {
    if (!/\bsupplier_dispatch_resolution_required\b/.test(String(error?.message || ''))) return null;
    return Object.assign(new Error('该订单已有采购准备或提交记录，当前不能直接退款或关闭。请先核对原采购请求；请使用订单详情中的“供应商结案”入口，登记退款或已完成的补偿。查无结果或超时不代表未受理。'), {
        code: 'supplier_dispatch_resolution_required', statusCode: 409
    });
}

module.exports = { supplierOrderStatus, supplierResolutionError };
