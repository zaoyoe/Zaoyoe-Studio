function getNormalizedPaymentOrderStatus(order = null) {
    return String(order?.status || '').trim().toLowerCase();
}

function getNormalizedPaymentRefundStatus(order = null) {
    const metadata = order?.provider_metadata && typeof order.provider_metadata === 'object'
        ? order.provider_metadata
        : {};
    return String(metadata.refund_status || '').trim().toLowerCase();
}

function isTerminalRefundPaymentOrder(order = null) {
    const status = getNormalizedPaymentOrderStatus(order);
    const refundStatus = getNormalizedPaymentRefundStatus(order);
    return status === 'refunded' || refundStatus === 'refunded' || refundStatus === 'refund_pending';
}

module.exports = {
    getNormalizedPaymentOrderStatus,
    getNormalizedPaymentRefundStatus,
    isTerminalRefundPaymentOrder
};
