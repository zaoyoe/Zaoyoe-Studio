'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { requireTgAdmin, requireTgAdminWriteRequest, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');
const orderQuery = require('../../../tg/order-query');
const { _private: { safeOrder } } = require('../../public/tg-purchase');
const { safeCryptoCheckout } = require('../../../tg/nowpayments-gateway');

const PAGE_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURCHASE_FIELDS = 'id,order_no,telegram_username,product_family,term_months,stars_quantity,currency,total_minor,subtotal_minor,payment_fee_minor,payment_fee_rate_bps,price_version,payment_channel,payment_status,crypto_checkout,closed_at,created_at,updated_at,payment_expires_at';
const REDEEM_FIELDS = 'id,order_no,telegram_username,product_family,term_months,stars_quantity,status,created_at,updated_at';
const REDEMPTION_STATUSES = new Set(['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed']);
const DELIVERY_STATUSES = new Set(['pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled']);
function invalid(message = '查询条件无效，请核对后重试。') {
    return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_query' });
}
function parse(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
    const { kind, search_by: searchBy, query, page = 1 } = input;
    if (!['purchase', 'redeem'].includes(kind) || !['email', 'order_no', 'username'].includes(searchBy)
        || typeof query !== 'string' || query.length > 320 || /[\x00-\x1f\x7f]/.test(query)
        || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw invalid();
    let value = query.trim();
    if (searchBy === 'email') {
        value = value.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw invalid('请输入有效的查询邮箱。');
    } else if (searchBy === 'order_no') {
        value = value.toUpperCase();
        if (!(kind === 'purchase' ? /^TGP-[A-Z0-9]{20}$/ : /^TG-[A-Z0-9]{12,24}$/).test(value)) throw invalid('请输入与订单类型对应的完整订单号。');
    } else {
        value = value.replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_]{5,32}$/.test(value)) throw invalid('请输入正确的 Telegram 用户名。');
    }
    return { kind, searchBy, value, page };
}
function createAdminOrderQueryHandler({ admin = sharedAdmin, env = process.env } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        res.setHeader('Referrer-Policy', 'no-referrer');
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            const { supabase } = await requireTgAdmin(req, admin);
            requireTgAdminWriteRequest(req, env);
            orderQuery.rejectUrlCredentials(req);
            let input;
            try { input = await admin.parseJsonBody(req); } catch (_) { throw invalid(); }
            const { kind, searchBy, value, page } = parse(input);
            let buyers;
            if (searchBy === 'email') {
                if (!await orderQuery.ready(supabase)) return admin.sendJson(res, 503, { success: false, code: 'order_query_migration_required', message: '邮箱查询尚未完成数据库升级，请先使用订单号或 Telegram 用户名查询。' });
                // Admins can search all password groups for an email. Never read
                // customer passwords, password hashes or bearer credentials.
                const { data, error } = await supabase.from('tg_order_query_buyers').select('id')
                    .eq('contact_hash', orderQuery.contactHash(value, env)).limit(6);
                if (error || !Array.isArray(data) || data.length > 5 || data.some(row => !UUID.test(row.id || ''))) throw new Error('Invalid buyer index');
                buyers = data.map(row => row.id);
                if (!buyers.length) return admin.sendJson(res, 200, { success: true, kind, orders: [], total: 0, page, page_size: PAGE_SIZE });
            }
            let query = supabase.from(kind === 'purchase' ? 'tg_purchase_orders' : 'tg_redemption_orders')
                .select(kind === 'purchase' ? PURCHASE_FIELDS : REDEEM_FIELDS, { count: 'exact' });
            if (kind === 'redeem') query = query.eq('order_source', 'redemption');
            if (buyers) query = query.in('query_buyer_id', buyers);
            else query = query.eq(searchBy === 'username' ? 'telegram_username' : 'order_no', value);
            const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false })
                .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
            if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count < 0 || data.length > PAGE_SIZE) throw new Error('Invalid order list');
            let orders;
            if (kind === 'purchase') {
                const fulfillment = new Map();
                if (data.length) {
                    const ids = data.map(row => row.id);
                    if (ids.some(id => !UUID.test(id || ''))) throw new Error('Invalid purchase identity');
                    const tasks = await supabase.from('tg_redemption_orders').select('purchase_id,status').in('purchase_id', ids);
                    if (tasks.error || !Array.isArray(tasks.data)) throw new Error('Fulfillment lookup unavailable');
                    for (const task of tasks.data) {
                        if (!ids.includes(task.purchase_id) || fulfillment.has(task.purchase_id) || !DELIVERY_STATUSES.has(task.status)) throw new Error('Invalid fulfillment snapshot');
                        fulfillment.set(task.purchase_id, task.status);
                    }
                }
                orders = data.map(row => {
                    const { crypto_checkout: cryptoCheckout, ...snapshot } = row;
                    const safe = safeOrder({ ...snapshot, fulfillment_status: fulfillment.get(row.id) || 'not_started' });
                    if (!safe) throw new Error('Invalid purchase snapshot');
                    const crypto = row.payment_channel === 'usdt_bep20' ? safeCryptoCheckout(cryptoCheckout) : null;
                    return { ...safe, ...(crypto ? { crypto_pay_amount: crypto.pay_amount, crypto_network: crypto.network } : {}) };
                });
            } else orders = data.map(row => {
                if (!UUID.test(row.id || '') || !/^TG-[A-Z0-9]{12,24}$/.test(row.order_no || '') || !REDEMPTION_STATUSES.has(row.status)
                    || !/^[a-z0-9_]{5,32}$/i.test(row.telegram_username || '')) throw new Error('Invalid redemption snapshot');
                return Object.fromEntries(REDEEM_FIELDS.split(',').map(key => [key === 'telegram_username' ? 'username' : key, row[key]]));
            });
            return admin.sendJson(res, 200, { success: true, kind, orders, total: count, page, page_size: PAGE_SIZE });
        } catch (error) {
            return adminErrorResponse(admin, res, error, '订单查询暂不可用，请稍后重试。');
        }
    };
}
module.exports = createAdminOrderQueryHandler();
module.exports.createAdminOrderQueryHandler = createAdminOrderQueryHandler;
