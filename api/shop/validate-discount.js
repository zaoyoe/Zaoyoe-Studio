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

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = String(error?.message || '').trim().toLowerCase();
    const normalizedRelation = String(relationName || '').trim().toLowerCase();
    if (!normalizedMessage) return false;
    const mentionsRelation = normalizedRelation
        ? normalizedMessage.includes(normalizedRelation)
        : normalizedMessage.includes('relation') || normalizedMessage.includes('table');
    return mentionsRelation && (
        normalizedMessage.includes('does not exist')
        || normalizedMessage.includes('not exist')
        || normalizedMessage.includes('could not find')
        || normalizedMessage.includes('undefined table')
    );
}

async function recordApplyAttempt(supabase, payload = {}) {
    if (!supabase || !payload?.discount_id) {
        return;
    }

    try {
        const { error } = await supabase
            .from('discount_event_logs')
            .insert(payload);
        if (error && !isMissingRelationError(error, 'discount_event_logs')) {
            throw error;
        }
    } catch (error) {
        if (!isMissingRelationError(error, 'discount_event_logs')) {
            throw error;
        }
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const rateLimit = await takeRateLimitToken({
        supabase: getOptionalSupabaseAdmin(),
        key: `shop-discount-validate:${resolveClientIp(req, { env: process.env }) || 'unknown'}`,
        limit: Math.max(1, Number(process.env.SHOP_DISCOUNT_VALIDATE_RATE_LIMIT_MAX || 12)),
        windowMs: Math.max(10_000, Number(process.env.SHOP_DISCOUNT_VALIDATE_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, rateLimit);
    if (!rateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            code: 'rate_limited',
            message: '优惠码验证过于频繁，请稍后重试',
            retry_after_seconds: rateLimit.retryAfterSeconds
        });
    }

    try {
        const { supabase, requestSupabase, adminSupabase, user } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);

        const productId = String(body?.productId || body?.product_id || '').trim();
        const discountCode = String(body?.discountCode || body?.discount_code || '').trim();
        const discountAssetId = String(body?.discountAssetId || body?.discount_asset_id || '').trim() || null;
        const quantityValue = Number(body?.quantity ?? body?.p_quantity ?? 1);
        const quantity = Number.isFinite(quantityValue) ? Math.max(1, Math.trunc(quantityValue)) : 1;
        const site = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
        const agentId = String(body?.agentId || body?.agent_id || '').trim() || null;

        if (!productId) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少商品标识'
            });
        }

        if (!discountCode) {
            return sendJson(res, 400, {
                success: false,
                message: '请输入优惠码'
            });
        }

        const { data, error } = await (requestSupabase || supabase).rpc('fn_validate_discount_code', {
            p_product_id: productId,
            p_user_id: user.id,
            p_site: site,
            p_quantity: quantity,
            p_discount_code: discountCode,
            p_discount_asset_id: discountAssetId,
            p_agent_id: agentId
        });

        if (error) {
            throw error;
        }

        const payload = Array.isArray(data) ? data[0] : data;
        if (!payload || payload.success === false) {
            return sendJson(res, 400, payload || {
                success: false,
                message: '优惠码验证失败'
            });
        }

        const responseData = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
            ? payload.data
            : {};
        const pricingWaterfall = buildPricingWaterfall({
            ...responseData,
            discount_code: responseData.discount_code || discountCode,
            discount_asset_id: discountAssetId || responseData.discount_asset_id || null
        }, {
            quantity
        });
        payload.data = {
            ...responseData,
            pricing_waterfall: pricingWaterfall.rows,
            stacking_policy: pricingWaterfall.stacking_policy
        };

        if (discountAssetId) {
            await recordApplyAttempt(adminSupabase || supabase, {
                discount_id: String(payload?.data?.discount_id || '').trim() || null,
                user_id: user.id,
                discount_asset_id: discountAssetId,
                order_id: null,
                event_type: 'apply_attempt',
                site,
                source_channel: 'shop_wallet',
                event_source: 'shop_apply_discount',
                audience_segment: String(payload?.data?.audience_segment || '').trim() || null,
                created_at: new Date().toISOString()
            });
        }

        return sendJson(res, 200, payload);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '优惠码验证失败'
        });
    }
};
