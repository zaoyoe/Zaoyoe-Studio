'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { createGramixClient } = require('../../../tg/gramix-client');
const { requireTgAdmin, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');

const ORDER_STATUSES = new Set(['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function text(value, max = 256) { return String(value ?? '').trim().slice(0, max); }
function positive(value, fallback, max) {
    const raw = value === undefined || value === null || value === '' ? String(fallback) : String(value).trim();
    if (!/^\d+$/.test(raw)) throw Object.assign(new Error('分页参数无效'), { statusCode: 400, code: 'invalid_pagination' });
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw Object.assign(new Error('分页参数超出范围'), { statusCode: 400, code: 'invalid_pagination' });
    return parsed;
}

function createOrdersHandler({ admin = sharedAdmin, clientFactory = createGramixClient, env = process.env } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        if (String(req.method || '').toUpperCase() !== 'GET') {
            res.setHeader('Allow', 'GET');
            return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            const { supabase } = await requireTgAdmin(req, admin);
            const url = new URL(req.url || '', 'http://localhost');
            const orderId = text(url.searchParams.get('orderId') || url.searchParams.get('id'), 64);
            const orderNo = text(url.searchParams.get('orderNo') || url.searchParams.get('order_no'), 64);
            if (orderId || orderNo) {
                if ((orderId && !UUID_PATTERN.test(orderId)) || (orderNo && !/^TG-[A-Z0-9]{12,24}$/.test(orderNo))) return admin.sendJson(res, 400, { success: false, code: 'invalid_order', message: '订单编号无效' });
                let query = supabase.from('tg_redemption_orders').select('id, order_no, telegram_username, product_family, term_months, stars_quantity, status, provider, provider_order_id, provider_payment_currency, provider_idempotency_key, attempt_count, submitted_at, completed_at, last_error_code, last_error_message, created_at, updated_at');
                query = orderId ? query.eq('id', orderId) : query.eq('order_no', orderNo);
                const { data, error } = await query.maybeSingle();
                if (error) throw error;
                if (!data) return admin.sendJson(res, 404, { success: false, message: '订单不存在' });
                let reconciliation = null;
                if (url.searchParams.get('reconcile') === '1' && data.provider_order_id) {
                    const client = clientFactory({ env });
                    const providerData = await client.getOrder(data.provider_order_id);
                    const { normalizeOrderSnapshot } = require('../../../tg/worker');
                    const normalized = normalizeOrderSnapshot(providerData, data);
                    reconciliation = {
                        checked_at: new Date().toISOString(),
                        verified: normalized.valid === true,
                        reason: normalized.reason || null,
                        snapshot: normalized.valid ? normalized.snapshot : null
                    };
                }
                const { provider_idempotency_key: _secretCorrelationKey, ...order } = data;
                return admin.sendJson(res, 200, { success: true, order, reconciliation });
            }
            const page = positive(url.searchParams.get('page'), 1, 100000);
            const pageSize = positive(url.searchParams.get('pageSize') || url.searchParams.get('page_size'), 50, 100);
            const status = text(url.searchParams.get('status'), 32).toLowerCase();
            let query = supabase.from('tg_redemption_orders').select('id, order_no, telegram_username, product_family, term_months, stars_quantity, status, provider, provider_order_id, provider_payment_currency, attempt_count, submitted_at, completed_at, last_error_code, last_error_message, created_at, updated_at', { count: 'exact' }).order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
            if (status) {
                if (!ORDER_STATUSES.has(status)) return admin.sendJson(res, 400, { success: false, code: 'invalid_status', message: '订单状态无效' });
                query = query.eq('status', status);
            }
            const { data, error, count } = await query;
            if (error) throw error;
            return admin.sendJson(res, 200, { success: true, orders: data || [], total: count || 0, page, page_size: pageSize });
        } catch (error) {
            return adminErrorResponse(admin, res, error, 'TG 订单服务暂不可用');
        }
    };
}

module.exports = createOrdersHandler();
module.exports.createOrdersHandler = createOrdersHandler;
