'use strict';
const { parseJsonBody, requireAdmin, sendJson, writeAdminAuditLog } = require('../../../../api/_lib/admin');
const { resolveCustomer } = require('../../../integrations/suppliers/resolution');
const { loadOperations } = require('../../../integrations/suppliers/operations');
module.exports = async function supplierResolution(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }
    try {
        const { adminSupabase, user } = await requireAdmin(req, { permission: 'shop.manage' });
        if (req.method === 'GET') {
            const params = new URL(req.url, 'http://localhost').searchParams;
            const orderId = params.get('orderId'); const fundingKind = params.get('fundingKind');
            if (!orderId || !fundingKind || [...params.keys()].some(key => !['orderId', 'fundingKind', 'site'].includes(key))) {
                return sendJson(res, 400, { success: false, message: '请提供完整的订单查询信息' });
            }
            const result = await loadOperations(adminSupabase, { orderId, fundingKind, site: params.get('site'), limit: 1 });
            if (result.rows.length !== 1 || result.hasMore) return sendJson(res, 404, { success: false, message: '未找到供应商订单' });
            return sendJson(res, 200, { success: true, order: result.rows[0] });
        }
        const body = await parseJsonBody(req);
        if (!body || Array.isArray(body) || Object.keys(body).some(key => !['action', 'operationId', 'orderId', 'fundingKind', 'site', 'confirm', 'request'].includes(key)) || !['query', 'commit'].includes(body.action) || (body.action === 'commit' && body.confirm !== true)) {
            return sendJson(res, 400, { success: false, message: '请确认本次处理信息' });
        }
        const result = await resolveCustomer(adminSupabase, { action: body.action, operationId: body.operationId,
            actorId: user.id, orderId: body.orderId, fundingKind: body.fundingKind, site: body.site, request: body.request });
        if (body.action === 'commit') {
            // The financial result is committed. An auxiliary audit failure must
            // not turn it into an apparent failed transaction or a new operation.
            try { await writeAdminAuditLog({ supabase: adminSupabase, adminId: user.id,
                action: 'shop.supplier.customer_resolution', targetType: 'shop_order', targetId: body.orderId,
                details: { operationId: result.operationId, fundingKind: result.fundingKind, status: result.status } }); }
            catch { /* immutable DB receipt is the authoritative audit */ }
        }
        return sendJson(res, 200, { success: true, result });
    } catch (error) {
        const status = Number(error?.statusCode) || 503;
        return sendJson(res, status, { success: false, code: error?.code || 'supplier_resolution_unavailable',
            message: status >= 500 ? '尚未确认处理结果，请查询本次操作并保持原处理信息' : error.message });
    }
};
