'use strict';

// Local-only execution of the existing atomic cancellation RPC. Production
// still authenticates the buyer; its claim/session peppers stay on KVM4.
const ORDER_FIELDS = 'id,order_no,site,product_id,sku_id,total_amount,currency,expires_at,payment_status,reservation_status,fulfillment_status,refund_status,cancelled_at';

function createGuestShopPreviewCancellation({ getSupabase } = {}) {
    return async ({ req, res, headers, origin, fetchImpl }) => {
        const fail = (status, code, message) => res.status(status).json({ success: false, code, message });
        const body = req.body;
        const orderNo = body?.orderNo ?? body?.order_no;
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')
            || !body || Array.isArray(body) || typeof orderNo !== 'string'
            || !/^[A-Za-z0-9_-]{1,128}$/u.test(orderNo)
            || Object.keys(body).some((key) => !['orderNo', 'order_no'].includes(key))
            || (body.orderNo !== undefined && body.order_no !== undefined && body.orderNo !== body.order_no)) {
            return fail(400, 'guest_cancel_invalid_request', '取消请求字段不允许。');
        }
        try {
            // This is an explicit mode, never a fallback after a failed cancel.
            // A successful status response verifies the exact order's claim
            // proof and reconciles payment with the production payment service.
            const signal = AbortSignal.timeout(12000);
            const options = { method: 'GET', headers, redirect: 'error', signal };
            let auth = await fetchImpl(`${origin}/api/shop/guest/status?orderNo=${encodeURIComponent(orderNo)}&force_provider_refresh=1`, options);
            // Expired claim cookies can coexist with a valid buyer session.
            // The order-detail endpoint rechecks session revocation/ownership;
            // it must never be replaced with an unauthenticated order lookup.
            if (auth.status === 403 && (headers['x-guest-order-credential'] || /(?:^|;\s*)__Host-gs-acc=/u.test(headers.cookie || ''))) {
                await auth.arrayBuffer();
                auth = await fetchImpl(`${origin}/api/shop/guest/order?order_no=${encodeURIComponent(orderNo)}`, options);
            }
            const authorization = await auth.json();
            if (!auth.ok || authorization?.success !== true) {
                const status = [400, 401, 403, 404, 409, 429].includes(auth.status) ? auth.status : 502;
                const retryAfter = auth.headers.get('retry-after');
                if (retryAfter) res.setHeader('Retry-After', retryAfter);
                return fail(status, status === 502 ? 'local_preview_guest_auth_unavailable' : String(authorization?.code || 'guest_claim_invalid'),
                    status === 502 ? '线上凭证校验暂不可用，原订单未取消。' : String(authorization?.message || '订单凭证已失效，请先查询订单。'));
            }
            const authorized = authorization.order;
            if (authorized?.order_no !== orderNo) {
                return fail(502, 'local_preview_guest_auth_mismatch', '订单凭证校验结果不一致，原订单未取消。');
            }
            const db = getSupabase?.();
            if (!db?.from || typeof db.rpc !== 'function') {
                return fail(503, 'local_preview_guest_cancel_unavailable', '本地订单库未配置，原订单未取消。');
            }
            const load = () => db.from('guest_shop_orders').select(ORDER_FIELDS).eq('order_no', orderNo).maybeSingle();
            const initial = await load();
            if (initial.error) throw initial.error;
            const order = initial.data;
            // Match immutable public fields as well as the random order number.
            // An unrelated local/staging database must never receive this RPC.
            if (!order?.id || ['order_no', 'site', 'product_id', 'sku_id', 'currency'].some((key) => !authorized[key] || authorized[key] !== order[key])
                || !Number.isFinite(Number(authorized.amount)) || Number(authorized.amount) !== Number(order.total_amount)
                || !Number.isFinite(Date.parse(authorized.expires_at)) || Date.parse(authorized.expires_at) !== Date.parse(order.expires_at)) {
                return fail(503, 'local_preview_guest_database_mismatch', '本地订单库与线上订单不一致，原订单未取消。');
            }
            const cancelled = (row) => row?.payment_status === 'expired' && Boolean(row.cancelled_at);
            // A completed RPC followed by a lost HTTP response is safe to retry.
            let refreshed = order;
            if (!cancelled(order)) {
                const result = await db.rpc('fn_guest_shop_cancel_order', { p_order_id: order.id, p_reason: 'buyer_cancelled' });
                if (result?.error) throw result.error;
                const updated = await load();
                if (updated.error) throw updated.error;
                refreshed = updated.data;
            }
            if (!cancelled(refreshed)) throw new Error('cancellation_not_confirmed');
            return res.status(200).json({
                success: true,
                cancelled: true,
                order: {
                    ...authorized,
                    payment_status: refreshed.payment_status,
                    fulfillment_status: refreshed.fulfillment_status,
                    refund_status: refreshed.refund_status
                }
            });
        } catch (error) {
            if ([error?.code, error?.message].includes('guest_order_not_cancellable')) {
                return fail(409, 'guest_order_not_cancellable', '订单已付款或状态已变化，无法取消。');
            }
            // Never expose RPC errors, credentials or provider payloads.
            return fail(503, 'local_preview_guest_cancel_unavailable', '本地取消服务暂不可用，请查询原订单状态后重试。');
        }
    };
}

module.exports = { createGuestShopPreviewCancellation };
