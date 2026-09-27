'use strict';

const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REF_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const MIN_REASON_LENGTH = 8;

function httpError(status, message, code) {
    const error = new Error(message);
    error.statusCode = status;
    error.code = code;
    return error;
}

function text(value, max) {
    return String(value ?? '').trim().slice(0, max);
}

function first(data) {
    return Array.isArray(data) ? data[0] || null : data || null;
}

function errorResponse(res, error) {
    const status = Number(error?.statusCode) || 500;
    return sendJson(res, status, {
        success: false,
        code: error?.code || 'guest_refund_reconcile_failed',
        message: status >= 500 ? '退款人工复核同步失败' : error.message
    });
}

async function handler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }
    try {
        const { adminSupabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        if (!adminSupabase || typeof adminSupabase.rpc !== 'function') {
            throw httpError(503, '游客后台写操作尚未启用', 'guest_admin_ops_unavailable');
        }
        let body;
        try { body = await parseJsonBody(req); } catch (_) { throw httpError(400, '请求体不是有效 JSON', 'invalid_json'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, '请求体无效', 'invalid_json');
        if (body.confirm !== true) throw httpError(400, '写操作需要二次确认', 'guest_admin_confirm_required');
        const orderId = text(body.orderId || body.order_id, 80);
        if (!UUID_RE.test(orderId)) throw httpError(400, 'orderId must be a valid UUID', 'invalid_guest_order_id');
        const providerRef = text(body.providerRef || body.provider_ref, MAX_REF_LENGTH);
        if (!providerRef) throw httpError(400, '缺少 providerRef', 'guest_refund_provider_ref_required');
        const reason = text(body.reason || body.remark, MAX_REASON_LENGTH);
        if (reason.length < MIN_REASON_LENGTH) throw httpError(400, '请填写至少 8 个字的处理原因', 'guest_admin_reason_required');
        const requestedSite = normalizeAdminSite(text(body.site || req.adminSite, 20) || 'all');
        if (!['all', 'cn', 'intl'].includes(requestedSite)) throw httpError(400, 'site must be all, cn, or intl', 'invalid_guest_order_site');
        const adminId = text(user?.id, 80);
        if (!UUID_RE.test(adminId)) throw httpError(400, '缺少管理员身份', 'guest_admin_actor_required');

        const orderResult = await adminSupabase.from('guest_shop_orders')
            .select('id,order_no,site,refund_status,last_error_code,payment_status,fulfillment_status')
            .eq('id', orderId).maybeSingle();
        if (orderResult?.error) throw orderResult.error;
        const order = orderResult?.data;
        if (!order) throw httpError(404, '游客订单不存在', 'guest_order_not_found');
        if (requestedSite !== 'all' && order.site !== requestedSite) throw httpError(409, '订单站点与当前筛选不一致', 'guest_admin_site_mismatch');
        if (order.refund_status === 'succeeded' || order.payment_status === 'refunded') {
            return sendJson(res, 200, { success: true, idempotent: true, orderId, orderNo: order.order_no, refund: 'succeeded', payment: 'refunded' });
        }
        if (order.refund_status !== 'manual_review') throw httpError(409, '当前订单不在人工复核退款队列', 'guest_refund_not_manual_review');
        const paymentResult = await adminSupabase.from('guest_shop_payment_orders')
            .select('id,refund_provider_ref,status,last_error_code')
            .eq('guest_order_id', orderId).maybeSingle();
        if (paymentResult?.error) throw paymentResult.error;
        const payment = paymentResult?.data;
        if (!payment) throw httpError(409, '订单支付记录不存在', 'guest_payment_order_not_found');
        if (payment.refund_provider_ref && payment.refund_provider_ref !== providerRef) throw httpError(409, '退款交易号与现有记录冲突', 'guest_refund_provider_ref_conflict');

        const rpc = await adminSupabase.rpc('fn_guest_shop_record_refund_result', {
            p_order_id: orderId,
            p_refund_status: 'succeeded',
            p_provider_ref: providerRef,
            p_error_code: null,
            p_error_message: null
        });
        if (rpc?.error) throw rpc.error;
        const row = first(rpc?.data);
        if (!row) throw httpError(500, '退款人工复核同步失败', 'guest_refund_reconcile_failed');
        await writeAdminAuditLog({
            supabase: adminSupabase,
            adminId,
            actionType: 'shop.guest_order.acknowledge_provider_refund',
            module: 'shop',
            site: order.site,
            details: { order_id: orderId, order_no: order.order_no, provider_ref: providerRef, reason, previous_refund_status: order.refund_status, target_refund_status: row.refund_status }
        });
        return sendJson(res, 200, { success: true, idempotent: false, orderId: row.order_id || orderId, orderNo: row.order_no || order.order_no, refund: row.refund_status, payment: row.payment_status, fulfillment: row.fulfillment_status, providerRef: row.provider_ref || providerRef });
    } catch (error) {
        return errorResponse(res, error);
    }
}

module.exports = handler;
