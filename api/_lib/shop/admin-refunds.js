const VALID_TARGET_STATUSES = new Set(['frozen', 'available', 'fault', 'reserve']);

function normalizeText(value) {
    return String(value || '').trim();
}

function createRefundError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function applyShopOrderRefund({
    supabase,
    adminId,
    orderId,
    targetStatus = 'frozen',
    remark = '',
    requestedSite = ''
}) {
    const normalizedOrderId = normalizeText(orderId);
    const normalizedTargetStatus = normalizeText(targetStatus).toLowerCase();
    const normalizedRemark = typeof remark === 'string' ? remark.trim() : '';
    const normalizedRequestedSite = normalizeText(requestedSite).toLowerCase();

    if (!supabase) {
        throw createRefundError('supabase client is required', 500);
    }

    if (!adminId) {
        throw createRefundError('adminId is required', 500);
    }

    if (!normalizedOrderId) {
        throw createRefundError('orderId is required');
    }

    if (!VALID_TARGET_STATUSES.has(normalizedTargetStatus)) {
        throw createRefundError('targetStatus is invalid');
    }

    const { data: order, error: orderError } = await supabase
        .from('shop_orders')
        .select('id, user_id, site, refund_status, price_paid, total_price')
        .eq('id', normalizedOrderId)
        .single();

    if (orderError || !order) {
        throw createRefundError(orderError?.message || '订单不存在', orderError ? 404 : 404);
    }

    const orderSite = normalizeText(order.site).toLowerCase() || 'cn';
    if (normalizedRequestedSite && normalizedRequestedSite !== orderSite) {
        throw createRefundError(`订单属于 ${orderSite.toUpperCase()} 站点，请切换站点后重试`, 409);
    }

    const refundedAmount = Number(order.price_paid || order.total_price || 0);
    if (['refunded', 'full_refund'].includes(normalizeText(order.refund_status).toLowerCase())) {
        return {
            order,
            orderSite,
            refundedAmount,
            duplicate: true,
            result: {
                success: true,
                duplicate: true,
                site: orderSite,
                message: '该订单已退款'
            }
        };
    }

    const { data, error } = await supabase.rpc('fn_admin_refund_order', {
        p_order_id: normalizedOrderId,
        p_admin_id: adminId,
        p_target_status: normalizedTargetStatus,
        p_remark: normalizedRemark || null
    });

    if (error) {
        throw createRefundError(error.message || '退款失败');
    }

    if (!data?.success) {
        throw createRefundError(data?.message || '退款失败');
    }

    return {
        order,
        orderSite,
        refundedAmount,
        duplicate: data?.duplicate === true,
        result: data
    };
}

module.exports = {
    applyShopOrderRefund,
    VALID_TARGET_STATUSES
};
