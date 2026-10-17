'use strict';

const crypto = require('node:crypto');
const sharedSecurity = require('../../../api/_lib/request-security');
const { _private: { body, allowedOrigin, sendJson }, publicOrder } = require('./tg');
const { _private: { safeOrder } } = require('./tg-purchase');
const access = require('../../tg/order-query');
const patterns = { purchase: /^TGP-[A-Z0-9]{20}$/, redeem: /^TG-[A-Z0-9]{12,24}$/ };
function createTgOrderQueryHandlers({ admin, env = process.env, requestSecurity = sharedSecurity } = {}) {
    async function context(req, res, action) {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); sendJson(res, 405, { success: false, message: 'Method not allowed' }); return null; }
        if (!allowedOrigin(req, env)) { sendJson(res, 403, { success: false, message: '当前请求来源不可用' }); return null; }
        access.rejectUrlCredentials(req);
        const db = admin.getOptionalSupabaseAdmin?.(); if (!db) throw access.failure('订单查询服务暂不可用。');
        const ip = requestSecurity.resolveClientIp(req, { env }) || 'unknown';
        const rate = await requestSecurity.takeRateLimitToken({ supabase: db, env,
            key: `tg:order-query:${action}:ip:${crypto.createHash('sha256').update(ip).digest('hex')}`,
            limit: action === 'bind' ? 10 : 20, windowMs: 60000, requirePersistent: requestSecurity._private.isProductionLikeRuntime(env) });
        requestSecurity.applyRateLimitHeaders(res, rate);
        if (!rate.allowed) throw access.failure(rate.unavailable ? '查询服务暂不可用。' : '查询过于频繁，请稍后重试。', rate.unavailable ? 503 : 429, 'order_query_rate_limited');
        return db;
    }
    function fail(res, error) {
        if (access.sendError(res, error)) return;
        sendJson(res, [400, 413].includes(error?.statusCode) ? error.statusCode : 503, { success: false, code: 'order_query_unavailable', message: [400, 413].includes(error?.statusCode) ? error.message : '订单查询暂不可用，请稍后重试。' });
    }
    return {
        async query(req, res) {
            try {
                const db = await context(req, res, 'query'); if (!db) return;
                const input = await body(req); const kind = input.kind || 'purchase';
                const orderNo = typeof input.order_no === 'string' ? input.order_no.trim().toUpperCase() : '';
                if (!Object.hasOwn(patterns, kind) || input.order_no !== undefined && typeof input.order_no !== 'string' || orderNo && !patterns[kind].test(orderNo)
                    || input.page !== undefined && (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000)) throw access.failure('订单查询参数无效。', 400, 'invalid_request');
                const buyerId = await access.authenticate({ db, email: input.email, password: input.password, env, requestSecurity, req, res });
                const result = await access.rpc(db, 'fn_tg_query_orders', { p_buyer_id: buyerId, p_kind: kind, p_order_no: orderNo || null, p_page: input.page || 1 });
                if (!Array.isArray(result?.orders) || !Number.isSafeInteger(result.total) || result.total < 0 || result.orders.length > 20) throw access.failure('订单查询结果暂未确认，请稍后重试。');
                const orders = result.orders.map(row => kind === 'purchase' ? safeOrder(row) : publicOrder({ ...row, success: true }));
                if (orders.some(row => !row || orderNo && row.order_no !== orderNo)
                    || new Set(orders.map(row => row.order_no)).size !== orders.length || result.total < orders.length) throw access.failure('订单查询结果暂未确认，请稍后重试。');
                return sendJson(res, 200, { success: true, kind, orders, total: result.total, page: input.page || 1, page_size: 20 });
            } catch (error) { return fail(res, error); }
        },
        async bind(req, res) {
            try {
                const db = await context(req, res, 'bind'); if (!db) return;
                const input = await body(req); const kind = input.kind; const token = req.headers?.['x-tg-status-token'];
                if (!Object.hasOwn(patterns, kind) || !patterns[kind].test(input.order_no || '') || typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw access.failure('请先使用原订单号和查询凭证查询。', 400, 'invalid_request');
                if (!await access.ready(db)) throw access.failure('邮箱查询升级尚未完成，请暂用原订单凭证。');
                const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
                // Prove the old bearer credential BEFORE allocating any buyer.
                const current = await access.rpc(db, kind === 'purchase' ? 'fn_tg_purchase_status' : 'fn_tg_order_status', { p_order_no: input.order_no, p_status_token_hash: tokenHash });
                if (current?.success !== true) throw access.failure('订单不存在或查询凭证无效。', 404, 'not_found');
                const buyerId = await access.createBuyer(db, { query_email: input.email, query_password: input.password }, env);
                const result = await access.rpc(db, 'fn_tg_bind_query_order', { p_kind: kind, p_order_no: input.order_no, p_status_token_hash: tokenHash, p_buyer_id: buyerId });
                if (result !== true) throw access.failure('订单绑定暂未确认，请保留原查询凭证后重试。');
                return sendJson(res, 200, { success: true, message: '已绑定邮箱查询，原订单号和查询凭证仍可使用。' });
            } catch (error) { return fail(res, error); }
        }
    };
}
module.exports = { createTgOrderQueryHandlers };
