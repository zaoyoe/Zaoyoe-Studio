'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { requireTgAdmin, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');
const { _private: { safeOrder } } = require('../../public/tg-purchase');
function positive(value, fallback, max) {
    const raw = value == null || value === '' ? String(fallback) : String(value);
    const number = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < 1 || number > max) throw Object.assign(new Error('分页参数无效'), { statusCode: 400, code: 'invalid_pagination' });
    return number;
}
function createPurchasesHandler({ admin = sharedAdmin } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
        try {
            const { supabase } = await requireTgAdmin(req, admin);
            const params = new URL(req.url || '/', 'http://localhost').searchParams;
            const page = positive(params.get('page'), 1, 100000);
            const pageSize = positive(params.get('pageSize') || params.get('page_size'), 50, 100);
            const { data, error, count } = await supabase.from('tg_purchase_order_stats')
                .select('order_no,telegram_username,product_family,term_months,stars_quantity,currency,total_minor,price_version,payment_channel,payment_status,fulfillment_status,created_at,updated_at,expires_at', { count: 'exact' })
                .order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
            if (error) throw error;
            const purchases = (data || []).map(safeOrder);
            if (purchases.some((order) => !order)) throw new Error('Invalid TG purchase response');
            return admin.sendJson(res, 200, { success: true, purchases, page, page_size: pageSize, total: count || 0 });
        } catch (error) { return adminErrorResponse(admin, res, error, 'TG 购买订单暂不可用'); }
    };
}
module.exports = createPurchasesHandler();
module.exports.createPurchasesHandler = createPurchasesHandler;
