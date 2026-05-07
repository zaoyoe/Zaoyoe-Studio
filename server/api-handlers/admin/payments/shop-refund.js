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

function isMissingNotificationColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('schema cache') && (
            message.includes('scope')
            || message.includes('category')
            || message.includes('action_url')
            || message.includes('action_label')
            || message.includes('metadata')
            || message.includes('priority')
            || message.includes('source_module')
            || message.includes('source_event_id')
        ));
}

async function insertRefundStatusNotification(supabase, payload = {}) {
    let response = await supabase
        .from('system_notifications')
        .insert(payload);

    if (!response.error || !isMissingNotificationColumnError(response.error)) {
        return response;
    }

    const legacyPayload = { ...payload };
    delete legacyPayload.scope;
    delete legacyPayload.category;
    delete legacyPayload.action_url;
    delete legacyPayload.action_label;
    delete legacyPayload.metadata;
    delete legacyPayload.priority;
    delete legacyPayload.source_module;
    delete legacyPayload.source_event_id;

    response = await supabase
        .from('system_notifications')
        .insert(legacyPayload);
    return response;
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

            try {
                await insertRefundStatusNotification(supabase, {
                    user_id: order.user_id,
                    title: '退款进度已更新',
                    content: `订单 ${String(order.id || '').slice(0, 8)} 已完成退款处理。\n${normalizeText(result?.message) || '退款成功'}`,
                    type: 'success',
                    is_read: false,
                    scope: 'user_personal',
                    category: 'refund_status',
                    action_url: 'shop://orders',
                    action_label: '查看订单',
                    source_module: 'shop.refund',
                    source_event_id: `refund_status:${normalizeText(order.id)}:refunded`,
                    priority: 50,
                    metadata: {
                        page_id: 'shop',
                        site: orderSite,
                        event_type: 'refund_status',
                        order_id: order.id,
                        refund_status: 'refunded',
                        refund_amount: order.price_paid ?? order.total_price ?? null,
                        target_status: targetStatus,
                        remark: remark || null
                    }
                });
            } catch (notificationError) {
                console.warn('[AdminAPI] Failed to insert refund notification:', notificationError.message || notificationError);
            }
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
