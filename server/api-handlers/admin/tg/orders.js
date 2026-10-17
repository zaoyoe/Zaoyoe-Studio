'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { createGramixClient } = require('../../../tg/gramix-client');
const { requireTgAdmin, requireTgAdminWriteRequest, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');
const ops = require('../../../tg/operations');
const { _private: { body } } = require('../../public/tg');
const { createRedemptionResolution } = require('../../../tg/redemption-resolution');
const dataCenter = require('../../../tg/data-center');
const { queryUpstreamStatus, fulfillmentRuntime } = require('../../../tg/upstream-status');
const ORDER_STATUSES = new Set(['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed']);
function positive(value, fallback, max) {
    const raw = value == null || value === '' ? String(fallback) : String(value).trim();
    const parsed = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw Object.assign(new Error('分页参数无效'), { statusCode: 400, code: 'invalid_pagination' });
    return parsed;
}
function createOrdersHandler({ admin = sharedAdmin, clientFactory = createGramixClient, env = process.env, resolution = createRedemptionResolution({ env, clientFactory }) } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        try {
            const { supabase, user } = await requireTgAdmin(req, admin);
            if (req.method === 'POST') {
                requireTgAdminWriteRequest(req, env);
                const raw = await body(req);
                if (['inspect_upstream_order', 'link_upstream_order', 'inspect_nonacceptance', 'close_with_nonacceptance', 'complete_review'].includes(raw.action)) {
                    return admin.sendJson(res, 200, await resolution.execute({ supabase, actorId: user?.id, input: raw }));
                }
                const input = await ops.reviewInput({ body: raw }, ['reconcile', 'resume_unsubmitted', 'close', 'note']);
                if (!ops.UUID.test(input.order_id || '') || !ops.UUID.test(user?.id || '')) throw ops.invalid();
                const order = await ops.lookupOrder(supabase, 'id', input.order_id);
                if (!order) return ops.rpcResult(admin, res, { code: 'not_found' });
                let snapshot = {};
                if (input.action === 'reconcile') {
                    const check = await ops.reconcile(order, clientFactory, env);
                    if (!check.verified) return ops.rpcResult(admin, res, { code: 'provider_unverified' });
                    snapshot = check.snapshot;
                }
                const { data, error } = await supabase.rpc('fn_tg_review_order', { p_order_id: order.id, p_action: input.action,
                    p_expected_updated_at: input.expected_updated_at, p_actor_id: user.id, p_note: input.note, p_snapshot: snapshot });
                if (error) throw error;
                return ops.rpcResult(admin, res, data);
            }
            const params = new URL(req.url || '/', 'http://localhost').searchParams;
            if (params.has('operation_id')) {
                return admin.sendJson(res, 200, await resolution.operationStatus({ supabase, actorId: user?.id,
                    orderNo: params.get('order_no'), operationId: params.get('operation_id') }));
            }
            const orderId = params.get('orderId') || params.get('id'); const orderNo = params.get('orderNo') || params.get('order_no');
            if (orderId || orderNo) {
                if ((orderId && !ops.UUID.test(orderId)) || (orderNo && !/^TG-[A-Z0-9]{12,24}$/.test(orderNo))) throw ops.invalid('订单编号无效');
                const data = await ops.lookupOrder(supabase, orderId ? 'id' : 'order_no', orderId || orderNo);
                if (!data) return admin.sendJson(res, 404, { success: false, message: '订单不存在' });
                const reconciliation = params.get('reconcile') === '1' ? await queryUpstreamStatus({ order: data, clientFactory, env }) : null;
                let purchase = null;
                if (data.order_source === 'purchase' && ops.UUID.test(data.purchase_id || '')) {
                    const parent = await supabase.from('tg_purchase_orders').select('order_no,closed_at').eq('id', data.purchase_id).maybeSingle();
                    if (parent.error) throw parent.error;
                    if (/^TGP-[A-Z0-9]{20}$/.test(parent.data?.order_no || '')) purchase = { order_no: parent.data.order_no, closed_at: parent.data.closed_at || null };
                }
                const processing = data.order_source === 'redemption' && ['manual_review', 'failed', 'closed'].includes(data.status)
                    ? await resolution.details({ supabase, orderNo: data.order_no }) : null;
                return admin.sendJson(res, 200, { success: true, order: ops.cleanOrder(data), resolution: processing, purchase, reconciliation, runtime: fulfillmentRuntime(env),
                    history: await ops.history(supabase, 'redemption_order', data.id) });
            }
            const page = positive(params.get('page'), 1, 100000); const pageSize = positive(params.get('pageSize') || params.get('page_size'), 50, 100);
            if (params.get('data_center') === '1') {
                const result = await dataCenter.list(supabase, params, 'order', page, pageSize);
                return admin.sendJson(res, 200, { success: true, orders: result.rows.map(ops.cleanOrder), total: result.total, page, page_size: pageSize, snapshot_at: result.snapshot_at });
            }
            const status = String(params.get('status') || '').trim().toLowerCase();
            let query = supabase.from('tg_redemption_orders').select(ops.ORDER_FIELDS.replace(',provider_idempotency_key', ''), { count: 'exact' })
                .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
            if (status) {
                if (!ORDER_STATUSES.has(status)) return admin.sendJson(res, 400, { success: false, code: 'invalid_status', message: '订单状态无效' });
                query = query.eq('status', status);
            }
            if (!params.get('order_source')) query = query.eq('order_source', 'redemption');
            query = ops.filters(query, params, 'order');
            const { data, error, count } = await query;
            if (error) throw error;
            return admin.sendJson(res, 200, { success: true, orders: (data || []).map(ops.cleanOrder), total: count || 0, page, page_size: pageSize });
        } catch (error) {
            if (error?.notApplied === true && ['redemption_resolution_confirmation_required', 'redemption_resolution_database_rejected'].includes(error.code)) {
                return admin.sendJson(res, 503, { success: false, code: error.code, message: error.message, not_applied: true });
            }
            return adminErrorResponse(admin, res, error, 'TG 订单服务暂不可用');
        }
    };
}
module.exports = createOrdersHandler();
module.exports.createOrdersHandler = createOrdersHandler;
