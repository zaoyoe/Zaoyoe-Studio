'use strict';

const sharedAdmin = require('../../../../api/_lib/admin');
const { requireTgAdmin, requireTgAdminWriteRequest, secureAdminResponse, adminErrorResponse } = require('../../../tg/admin-access');

const { PRODUCTS, safeProduct } = require('../../../tg/products');
const PRODUCT_KEYS = new Set(Object.keys(PRODUCTS));
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
function invalid(message) { return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_request' }); }
function integer(value, name, { min = 1, max = MAX_SAFE } = {}) {
    const raw = typeof value === 'number' ? String(value) : String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) throw invalid(`${name} 参数无效`);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalid(`${name} 参数超出范围`);
    return parsed;
}

function createProductsHandler({ admin = sharedAdmin, env = process.env } = {}) {
    return async function handler(req, res) {
        secureAdminResponse(res);
        try {
            const method = String(req.method || '').toUpperCase();
            const { supabase, user } = await requireTgAdmin(req, admin);
            if (method === 'GET') {
                const { data, error } = await supabase.from('tg_purchase_products')
                    .select('product_key, product_family, term_months, price_minor, unit_price_micros, min_stars, max_stars, enabled, currency, price_version, updated_at')
                    .order('product_key', { ascending: true });
                if (error) throw error;
                const products = (data || []).map(safeProduct);
                if (products.some((product) => !product)) throw new Error('TG product price response is invalid');
                return admin.sendJson(res, 200, { success: true, products });
            }
            if (method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return admin.sendJson(res, 405, { success: false, message: 'Method not allowed' }); }
            requireTgAdminWriteRequest(req, env);
            let input;
            try { input = await admin.parseJsonBody(req); } catch (_) { throw invalid('请求内容格式无效'); }
            if (!input || typeof input !== 'object' || Array.isArray(input) || !PRODUCT_KEYS.has(input.product_id)) throw invalid('商品编号无效');
            if (typeof input.enabled !== 'boolean') throw invalid('上架状态无效');
            const productKey = input.product_id;
            const expectedVersion = integer(input.expected_price_version, 'expected_price_version');
            const stars = productKey === 'stars';
            if (stars ? input.price_minor != null : input.unit_price_micros != null) throw invalid('商品价格类型与商品不匹配');
            const priceMinor = stars || (!input.enabled && input.price_minor == null) ? null : integer(input.price_minor, 'price_minor');
            const unitPriceMicros = !stars || (!input.enabled && input.unit_price_micros == null) ? null : integer(input.unit_price_micros, 'unit_price_micros');
            const { data, error } = await supabase.rpc('fn_tg_update_price', {
                p_product_key: productKey,
                p_price_minor: priceMinor,
                p_unit_price_micros: unitPriceMicros,
                p_sale_enabled: input.enabled,
                p_actor_id: user.id,
                p_expected_version: expectedVersion
            });
            if (error || data?.success !== true) {
                if (data?.code === 'version_conflict') throw Object.assign(new Error('商品价格已更新，请刷新后重试'), { statusCode: 409, code: 'price_version_conflict' });
                throw error || new Error('TG product price update was not confirmed');
            }
            const product = safeProduct(data.price);
            if (!product) throw new Error('TG product price response is invalid');
            await admin.writeAdminAuditLog({ supabase, adminId: user.id, actionType: 'tg_product_price_updated', module: 'tg_purchase', details: { product_id: productKey, enabled: input.enabled, price_version: product.price_version } });
            return admin.sendJson(res, 200, { success: true, product });
        } catch (error) {
            return adminErrorResponse(admin, res, error, 'TG 商品配置失败，请稍后重试');
        }
    };
}

module.exports = createProductsHandler();
module.exports.createProductsHandler = createProductsHandler;
module.exports._private = { safeProduct };
