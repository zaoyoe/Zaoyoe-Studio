const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    createMarketplaceShopOrder
} = require('../../../../api/_lib/marketplace-orders');
const {
    sanitizeText
} = require('../../../../api/_lib/marketplace-channels');

module.exports = async function adminMarketplaceOrdersHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        const body = await parseJsonBody(req);
        const { request, result } = await createMarketplaceShopOrder({
            supabase,
            payload: body
        });
        const success = result?.success === true;
        const status = success ? 200 : 400;

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType: result?.duplicate
                ? 'shop.marketplace_order.duplicate'
                : (success ? 'shop.marketplace_order.create' : 'shop.marketplace_order.failed'),
            details: {
                source_channel: request.source_channel,
                channel_key: request.channel_key,
                channel_account_key: request.channel_account_key,
                external_order_id: request.external_order_id,
                product_id: request.product_id,
                quantity: request.quantity,
                local_order_id: result?.data?.order_id || null,
                delivery_status: result?.data?.delivery_status || null,
                duplicate: result?.duplicate === true,
                message: sanitizeText(result?.message, 300)
            },
            site: request.site || ''
        });

        return sendJson(res, status, {
            success,
            duplicate: result?.duplicate === true,
            message: result?.message || (success ? 'Marketplace order created' : 'Marketplace order failed'),
            request,
            data: result?.data || null
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            code: error?.code || 'marketplace_order_failed',
            message: error?.message || 'Marketplace order failed'
        });
    }
};
