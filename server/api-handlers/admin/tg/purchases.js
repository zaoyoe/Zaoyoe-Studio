'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { requireTgAdmin, requireTgAdminWriteRequest, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');
const { createGramixClient } = require('../../../tg/gramix-client');
const { _private: { safeOrder } } = require('../../public/tg-purchase');
const ops = require('../../../tg/operations');
const dataCenter = require('../../../tg/data-center');
const { _private: { body } } = require('../../public/tg');
const { createPurchaseReview, validOrderNo } = require('../../../tg/purchase-review');
const { createPurchaseResolution } = require('../../../tg/purchase-resolution');
const { createPurchaseRecovery } = require('../../../tg/purchase-recovery');
const { createPurchaseCompletion } = require('../../../tg/purchase-completion');
const ORDER_NO = /^TGP-[A-Z0-9]{20}$/;
function positive(value, fallback, max) {
    const raw = value == null || value === '' ? String(fallback) : String(value);
    const number = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < 1 || number > max) throw Object.assign(new Error('分页参数无效'), { statusCode: 400, code: 'invalid_pagination' });
    return number;
}
function createPurchasesHandler({ admin = sharedAdmin, env = process.env, clientFactory = createGramixClient, review = createPurchaseReview({ env }), resolution = createPurchaseResolution({ env }), recovery = createPurchaseRecovery({ env, clientFactory }), completion = createPurchaseCompletion() } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        try {
            const { supabase, user } = await requireTgAdmin(req, admin);
            if (req.method === 'POST') {
                requireTgAdminWriteRequest(req, env);
                let parsed;
                try { parsed = await (admin.parseJsonBody ? admin.parseJsonBody(req) : body(req)); } catch (_) { throw ops.invalid('请求内容格式无效'); }
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw ops.invalid('请求内容格式无效');
                if (parsed.action === 'complete_review') return admin.sendJson(res, 200, await completion.complete({ supabase, actorId: user?.id, input: parsed }));
                if (['inspect_upstream_order', 'link_upstream_order', 'inspect_nonacceptance', 'close_with_nonacceptance'].includes(parsed.action)) {
                    return admin.sendJson(res, 200, await recovery.execute({ supabase, actorId: user?.id, input: parsed }));
                }
                if (['approve_fulfillment', 'close_order', 'resume_fulfillment'].includes(parsed.action)) {
                    const result = parsed.action === 'approve_fulfillment'
                        ? await review.approve({ supabase, actorId: user?.id, input: parsed })
                        : await resolution.resolve({ supabase, actorId: user?.id, input: parsed });
                    return admin.sendJson(res, 200, result);
                }
                if (parsed.action === 'approve_payment') {
                    return admin.sendJson(res, 409, { success: false, code: 'payment_recheck_required', message: '请使用支付核对 / 补发审核，重新核对渠道收款并确认未退款、未另行发货。' });
                }
                const input = await ops.reviewInput({ ...req, body: parsed }, ['close', 'note']);
                if (!ORDER_NO.test(input.order_no || '') || !ops.UUID.test(user?.id || '')) throw ops.invalid();
                const args = { p_order_no: input.order_no, p_expected_updated_at: input.expected_updated_at, p_actor_id: user.id, p_note: input.note };
                const { data, error } = await supabase.rpc(input.action === 'close' ? 'fn_tg_close_purchase' : 'fn_tg_review_purchase',
                    { ...args, ...(input.action === 'close' ? { p_status_token_hash: null } : { p_action: input.action }) });
                if (error) throw error;
                return ops.rpcResult(admin, res, data);
            }
            const params = new URL(req.url || '/', 'http://localhost').searchParams;
            if (params.has('orderNo')) {
                const orderNo = params.get('orderNo');
                if (params.getAll('orderNo').length !== 1 || !validOrderNo(orderNo)) throw ops.invalid('订单编号无效');
                const result = await review.details({ supabase, orderNo });
                result.resolution = await resolution.details({ supabase, orderNo });
                if (result.resolution.closed_at) {
                    result.order = { ...result.order, fulfillment_status: 'closed', closed_at: result.resolution.closed_at };
                    result.review = { ...result.review, can_approve: false, blocked_code: 'order_closed', message: result.resolution.message };
                }
                return admin.sendJson(res, 200, result);
            }
            const orderNo = params.get('order_no');
            if (orderNo) {
                if (!ORDER_NO.test(orderNo) || params.getAll('order_no').length !== 1) throw ops.invalid('购买订单号无效');
                if (params.get('completion') === '1') return admin.sendJson(res, 200, { success: true, order_no: orderNo, completion: await completion.details({ supabase, orderNo }) });
                if (params.get('recovery') === '1') return admin.sendJson(res, 200, await recovery.details({ supabase, orderNo }));
                const { data, error } = await supabase.from('tg_purchase_orders')
                    .select('id,order_no,telegram_username,product_family,term_months,stars_quantity,currency,total_minor,subtotal_minor,payment_fee_minor,payment_fee_rate_bps,price_version,payment_channel,payment_provider,payment_status,paid_at,closed_at,last_error_code,checkout_lease_token,created_at,updated_at,payment_expires_at')
                    .eq('order_no', orderNo).maybeSingle();
                if (error?.code === '42703' && /\bclosed_at\b/.test(error.message || '')) {
                    throw Object.assign(new Error('订单处理数据库迁移尚未生效，请先完成迁移后再查看详情。'), {
                        statusCode: 409, code: 'resolution_migration_required'
                    });
                }
                if (error) throw error;
                if (!data) return admin.sendJson(res, 404, { success: false, message: '订单不存在' });
                const fulfillment = await ops.lookupOrder(supabase, 'purchase_id', data.id);
                const completionState = await completion.details({ supabase, orderNo });
                const order = safeOrder({ ...data, ...(completionState.closed_at ? { completion_note: completionState.completion_note } : {}), fulfillment_status: fulfillment?.status || 'not_started' });
                if (!order) throw new Error('Invalid TG purchase response');
                const reconciliation = params.get('reconcile') === '1' && fulfillment?.provider_order_id ? await ops.reconcile(fulfillment, clientFactory, env) : null;
                return admin.sendJson(res, 200, { success: true,
                    order: { ...order, raw_payment_status: data.payment_status, payment_provider: data.payment_provider, paid_at: data.paid_at, last_error_code: data.last_error_code,
                        can_close: !data.closed_at && ['awaiting_payment', 'expired'].includes(data.payment_status) && !data.paid_at && !data.checkout_lease_token && !data.last_error_code && !fulfillment },
                    fulfillment: ops.cleanOrder(fulfillment), completion: completionState, reconciliation, history: await ops.history(supabase, 'purchase_order', data.id) });
            }
            const page = positive(params.get('page'), 1, 100000); const pageSize = positive(params.get('pageSize') || params.get('page_size'), 50, 100);
            if (params.get('data_center') === '1') {
                const result = await dataCenter.list(supabase, params, 'purchase', page, pageSize);
                const purchases = result.rows.map(row => {
                    const order = safeOrder(row);
                    if (!order) throw new Error('Invalid TG purchase response');
                    return { ...order, paid_at: row.paid_at, receipt_currency: row.receipt_currency, receipt_amount: row.receipt_amount, pay_currency: row.pay_currency, receipt_confirmed: row.receipt_confirmed === true };
                });
                return admin.sendJson(res, 200, { success: true, purchases, total: result.total, page, page_size: pageSize, snapshot_at: result.snapshot_at });
            }
            let query = supabase.from('tg_purchase_order_stats')
                .select('order_no,telegram_username,product_family,term_months,stars_quantity,currency,total_minor,subtotal_minor,payment_fee_minor,payment_fee_rate_bps,price_version,payment_channel,payment_status,fulfillment_status,created_at,updated_at,expires_at', { count: 'exact' })
                .order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
            query = ops.filters(query, params, 'purchase');
            const { data, error, count } = await query;
            if (error) throw error;
            const purchases = (data || []).map(safeOrder);
            if (purchases.some((order) => !order)) throw new Error('Invalid TG purchase response');
            return admin.sendJson(res, 200, { success: true, purchases, page, page_size: pageSize, total: count || 0 });
        } catch (error) { return adminErrorResponse(admin, res, error, 'TG 购买订单暂不可用'); }
    };
}
module.exports = createPurchasesHandler();
module.exports.createPurchasesHandler = createPurchasesHandler;
