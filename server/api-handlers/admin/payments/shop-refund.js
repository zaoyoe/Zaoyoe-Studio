const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    applyShopOrderRefund
} = require('../../../../api/_lib/shop/admin-refunds');

function normalizeText(value) {
    return String(value || '').trim();
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        const body = await parseJsonBody(req);
        const orderId = normalizeText(body.orderId);
        const targetStatus = normalizeText(body.targetStatus).toLowerCase();
        const remark = typeof body.remark === 'string' ? body.remark.trim() : '';
        const writableSite = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });

        if (!orderId) {
            return sendJson(res, 400, { success: false, message: 'orderId is required' });
        }

        const {
            order,
            orderSite,
            result,
            duplicate
        } = await applyShopOrderRefund({
            supabase,
            adminId: user.id,
            orderId,
            targetStatus,
            remark,
            requestedSite: writableSite
        });

        if (!duplicate) {
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'shop',
                site: orderSite,
                actionType: 'shop.order.refund',
                details: {
                    order_id: order.id,
                    user_id: order.user_id,
                    refund_status_before: order.refund_status || null,
                    target_status: targetStatus,
                    price_paid: order.price_paid ?? null,
                    total_price: order.total_price ?? null,
                    remark: remark || null,
                    rpc_message: normalizeText(result?.message) || null
                }
            });
        }

        return sendJson(res, 200, {
            success: true,
            message: result.message || '退款成功',
            duplicate
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Shop refund failed'
        });
    }
};
