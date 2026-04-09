const crypto = require('node:crypto');

const {
    getOptionalSupabaseAdmin,
    parseJsonBody,
    requireAuthenticatedUser,
    sendJson
} = require('../_lib/admin');
const {
    applyRateLimitHeaders,
    resolveClientIp,
    takeRateLimitToken
} = require('../_lib/request-security');
const {
    requireSupportedSite
} = require('../_lib/site');
const {
    buildPricingWaterfall
} = require('../_lib/discount-pricing');

function normalizePurchaseBody(body = {}, headers = {}) {
    const quantityValue = Number(body?.quantity ?? body?.p_quantity ?? 1);
    const quantity = Number.isFinite(quantityValue) ? Math.trunc(quantityValue) : NaN;

    return {
        productId: String(body?.productId || body?.product_id || '').trim(),
        quantity,
        site: requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' }),
        discountCode: String(body?.discountCode || body?.p_discount_code || '').trim().toUpperCase() || null,
        discountAssetId: String(body?.discountAssetId || body?.p_discount_asset_id || '').trim() || null,
        agentId: String(body?.agentId || body?.p_agent_id || '').trim() || null,
        idempotencyKey: String(
            body?.idempotencyKey
            || body?.idempotency_key
            || body?.requestId
            || body?.request_id
            || headers['x-idempotency-key']
            || headers['X-Idempotency-Key']
            || ''
        ).trim()
    };
}

function buildIdempotencyFingerprint({ userId, payload }) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({
            userId: String(userId || ''),
            productId: payload.productId,
            quantity: payload.quantity,
            site: payload.site,
            discountCode: payload.discountCode || '',
            discountAssetId: payload.discountAssetId || '',
            agentId: payload.agentId || '',
            idempotencyKey: payload.idempotencyKey || ''
        }))
        .digest('hex');
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const adminSupabase = getOptionalSupabaseAdmin();
    const clientIp = resolveClientIp(req, { env: process.env }) || 'unknown';
    const ipRateLimit = await takeRateLimitToken({
        supabase: adminSupabase,
        key: `shop-purchase:ip:${clientIp}`,
        limit: Math.max(1, Number(process.env.SHOP_PURCHASE_RATE_LIMIT_MAX || 12)),
        windowMs: Math.max(10_000, Number(process.env.SHOP_PURCHASE_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, ipRateLimit);
    if (!ipRateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            code: 'rate_limited',
            message: '商城购买请求过于频繁，请稍后重试',
            retry_after_seconds: ipRateLimit.retryAfterSeconds
        });
    }

    try {
        const { supabase, requestSupabase, user } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);
        const payload = normalizePurchaseBody(body, req.headers || {});

        if (!payload.productId) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少商品标识'
            });
        }

        if (!Number.isInteger(payload.quantity) || payload.quantity < 1) {
            return sendJson(res, 400, {
                success: false,
                message: '购买数量必须大于0'
            });
        }

        const userRateLimit = await takeRateLimitToken({
            supabase: adminSupabase,
            key: `shop-purchase:user:${user.id}`,
            limit: Math.max(1, Number(process.env.SHOP_PURCHASE_USER_RATE_LIMIT_MAX || 8)),
            windowMs: Math.max(10_000, Number(process.env.SHOP_PURCHASE_USER_RATE_LIMIT_WINDOW_MS || 60_000))
        });
        applyRateLimitHeaders(res, userRateLimit);
        if (!userRateLimit.allowed) {
            return sendJson(res, 429, {
                success: false,
                code: 'rate_limited',
                message: '下单过于频繁，请稍后重试',
                retry_after_seconds: userRateLimit.retryAfterSeconds
            });
        }

        const idempotencyFingerprint = buildIdempotencyFingerprint({
            userId: user.id,
            payload
        });
        const idempotencyResult = await takeRateLimitToken({
            supabase: adminSupabase,
            key: `shop-purchase:idempotency:${user.id}:${idempotencyFingerprint}`,
            limit: 1,
            windowMs: Math.max(10_000, Number(process.env.SHOP_PURCHASE_IDEMPOTENCY_WINDOW_MS || 90_000))
        });
        if (!idempotencyResult.allowed) {
            return sendJson(res, 409, {
                success: false,
                code: 'duplicate_submission',
                message: '请勿重复提交订单，请稍候刷新后查看结果',
                retry_after_seconds: idempotencyResult.retryAfterSeconds
            });
        }

        const { data, error } = await (requestSupabase || supabase).rpc('fn_purchase_shop_item', {
            p_product_id: payload.productId,
            p_user_id: user.id,
            p_site: payload.site,
            p_quantity: payload.quantity,
            p_discount_code: payload.discountCode,
            p_discount_asset_id: payload.discountAssetId,
            p_agent_id: payload.agentId
        });

        if (error) {
            throw error;
        }

        const responsePayload = Array.isArray(data) ? data[0] : data;
        if (!responsePayload || responsePayload.success === false) {
            return sendJson(res, 400, responsePayload || {
                success: false,
                message: '兑换失败'
            });
        }

        const responseData = responsePayload?.data && typeof responsePayload.data === 'object' && !Array.isArray(responsePayload.data)
            ? responsePayload.data
            : {};
        const pricingWaterfall = buildPricingWaterfall({
            ...responseData,
            discount_code: responseData.discount_code || payload.discountCode,
            discount_asset_id: payload.discountAssetId || responseData.discount_asset_id || null
        }, {
            quantity: payload.quantity
        });

        return sendJson(res, 200, {
            ...responsePayload,
            data: {
                ...responseData,
                pricing_waterfall: pricingWaterfall.rows,
                stacking_policy: pricingWaterfall.stacking_policy
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '兑换失败'
        });
    }
};
