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
    normalizeDistributionMode,
    normalizeText
} = require('../_lib/discount-assets');

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

function getSafeTimestamp(value) {
    const parsed = Date.parse(String(value || '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

function isClaimWindowOpen(discount = {}, now = new Date()) {
    const nowMs = now.getTime();
    const startsAtMs = getSafeTimestamp(discount?.claim_starts_at);
    const expiresAtMs = getSafeTimestamp(discount?.claim_expires_at);

    if (startsAtMs > 0 && startsAtMs > nowMs) return false;
    if (expiresAtMs > 0 && expiresAtMs <= nowMs) return false;
    return discount?.is_active !== false;
}

async function loadUserAssets(supabase, userId) {
    try {
        const { data, error } = await supabase
            .from('discount_user_assets')
            .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment')
            .eq('user_id', userId)
            .eq('asset_status', 'available')
            .order('assigned_at', { ascending: false });

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingRelationError(error, 'discount_user_assets')) {
            return [];
        }
        throw error;
    }
}

async function loadDiscountRowsByIds(supabase, ids = []) {
    const discountIds = [...new Set((Array.isArray(ids) ? ids : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!discountIds.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('discount_codes')
        .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, used_count, max_uses_per_user, starts_at, expires_at, lifecycle_status, status_reason, scope_type, scope_category, scope_product_id, allow_zero_total, distribution_mode, claim_starts_at, claim_expires_at, claim_limit_per_user, campaign_tag, audience_segment')
        .in('id', discountIds);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function loadPublicClaimDiscounts(supabase) {
    const { data, error } = await supabase
        .from('discount_codes')
        .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, used_count, max_uses_per_user, starts_at, expires_at, lifecycle_status, status_reason, scope_type, scope_category, scope_product_id, allow_zero_total, distribution_mode, claim_starts_at, claim_expires_at, claim_limit_per_user, campaign_tag, audience_segment')
        .eq('distribution_mode', 'public_claim')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function loadUserClaimCounts(supabase, userId, discountIds = []) {
    const ids = [...new Set((Array.isArray(discountIds) ? discountIds : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
    if (!ids.length) {
        return new Map();
    }

    try {
        const { data, error } = await supabase
            .from('discount_user_assets')
            .select('discount_id')
            .eq('user_id', userId)
            .in('discount_id', ids);

        if (error) throw error;
        const counts = new Map();
        for (const row of data || []) {
            const discountId = normalizeText(row?.discount_id, 160);
            if (!discountId) continue;
            counts.set(discountId, (counts.get(discountId) || 0) + 1);
        }
        return counts;
    } catch (error) {
        if (isMissingRelationError(error, 'discount_user_assets')) {
            return new Map();
        }
        throw error;
    }
}

async function previewDiscount(supabase, {
    productId,
    userId,
    site,
    quantity,
    discountCode,
    discountAssetId,
    agentId
}) {
    const { data, error } = await supabase.rpc('fn_validate_discount_code', {
        p_product_id: productId,
        p_user_id: userId,
        p_site: site,
        p_quantity: quantity,
        p_discount_code: discountCode,
        p_discount_asset_id: discountAssetId || null,
        p_agent_id: agentId || null
    });

    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
}

function sortOwnedDiscounts(items = []) {
    return (items || []).slice().sort((left, right) => {
        const leftAvailable = left.available ? 1 : 0;
        const rightAvailable = right.available ? 1 : 0;
        if (rightAvailable !== leftAvailable) {
            return rightAvailable - leftAvailable;
        }

        const leftDiscountAmount = Number(left?.preview?.discount_amount || 0) || 0;
        const rightDiscountAmount = Number(right?.preview?.discount_amount || 0) || 0;
        if (rightDiscountAmount !== leftDiscountAmount) {
            return rightDiscountAmount - leftDiscountAmount;
        }

        const leftFinalTotal = Number(left?.preview?.final_total || Number.MAX_SAFE_INTEGER);
        const rightFinalTotal = Number(right?.preview?.final_total || Number.MAX_SAFE_INTEGER);
        if (leftFinalTotal !== rightFinalTotal) {
            return leftFinalTotal - rightFinalTotal;
        }

        return getSafeTimestamp(left?.expires_at) - getSafeTimestamp(right?.expires_at);
    }).map((item, index) => ({
        ...item,
        recommended_rank: index + 1
    }));
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const clientIp = resolveClientIp(req, { env: process.env }) || 'unknown';
    const rateLimit = await takeRateLimitToken({
        supabase: getOptionalSupabaseAdmin(),
        key: `shop-discount-assets:${clientIp}`,
        limit: Math.max(1, Number(process.env.SHOP_DISCOUNT_ASSETS_RATE_LIMIT_MAX || 16)),
        windowMs: Math.max(10_000, Number(process.env.SHOP_DISCOUNT_ASSETS_RATE_LIMIT_WINDOW_MS || 60_000))
    });
    applyRateLimitHeaders(res, rateLimit);
    if (!rateLimit.allowed) {
        return sendJson(res, 429, {
            success: false,
            code: 'rate_limited',
            message: '优惠券列表请求过于频繁，请稍后重试',
            retry_after_seconds: rateLimit.retryAfterSeconds
        });
    }

    try {
        const { supabase, requestSupabase, adminSupabase, user } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);
        const productId = String(body?.productId || body?.product_id || '').trim();
        const quantityValue = Number(body?.quantity ?? body?.p_quantity ?? 1);
        const quantity = Number.isFinite(quantityValue) ? Math.max(1, Math.trunc(quantityValue)) : 1;
        const site = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
        const agentId = String(body?.agentId || body?.agent_id || '').trim() || null;
        const dataSupabase = adminSupabase || supabase;

        if (!productId) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少商品标识'
            });
        }

        const ownedAssets = await loadUserAssets(dataSupabase, user.id);
        const masterDiscountRows = await loadDiscountRowsByIds(dataSupabase, ownedAssets.map((asset) => asset?.discount_id));
        const discountMap = new Map(masterDiscountRows.map((row) => [normalizeText(row?.id, 160), row]));

        const ownedDiscounts = [];
        for (const asset of ownedAssets) {
            const masterDiscount = discountMap.get(normalizeText(asset?.discount_id, 160));
            if (!masterDiscount) continue;

            let preview = null;
            let available = false;
            let message = '';
            try {
                const payload = await previewDiscount(requestSupabase || supabase, {
                    productId,
                    userId: user.id,
                    site,
                    quantity,
                    discountCode: masterDiscount.code,
                    discountAssetId: asset.id,
                    agentId
                });
                if (payload?.success !== false) {
                    preview = payload?.data || {};
                    available = true;
                    message = String(payload?.message || '当前可用');
                }
            } catch (error) {
                available = false;
                message = error.message || '当前不可用';
            }

            ownedDiscounts.push({
                asset_id: asset.id,
                discount_id: masterDiscount.id,
                code: masterDiscount.code,
                distribution_mode: normalizeDistributionMode(masterDiscount.distribution_mode, 'general_code'),
                source_channel: asset.source_channel || null,
                audience_segment: asset.audience_segment || null,
                expires_at: asset.expires_at || masterDiscount.expires_at || null,
                available,
                message,
                preview
            });
        }

        const publicClaimDiscounts = (await loadPublicClaimDiscounts(dataSupabase))
            .filter((discount) => {
                const applicableSite = String(discount?.applicable_site || '').trim().toLowerCase();
                return !applicableSite || applicableSite === site;
            })
            .filter((discount) => isClaimWindowOpen(discount, new Date()));
        const claimCounts = await loadUserClaimCounts(dataSupabase, user.id, publicClaimDiscounts.map((discount) => discount?.id));
        const claimableDiscounts = publicClaimDiscounts.map((discount) => {
            const alreadyClaimedCount = Math.max(0, Number(claimCounts.get(normalizeText(discount?.id, 160)) || 0));
            const claimLimitPerUser = Math.max(0, Number(discount?.claim_limit_per_user || 0));
            const canClaim = claimLimitPerUser <= 0 || alreadyClaimedCount < claimLimitPerUser;
            return {
                discount_id: discount.id,
                code: discount.code,
                distribution_mode: 'public_claim',
                campaign_tag: discount.campaign_tag || null,
                audience_segment: discount.audience_segment || null,
                claim_starts_at: discount.claim_starts_at || null,
                claim_expires_at: discount.claim_expires_at || null,
                claim_limit_per_user: claimLimitPerUser,
                already_claimed_count: alreadyClaimedCount,
                can_claim: canClaim,
                message: canClaim ? '领取后即可在结算时直接选择' : '你已达到该券的领取上限'
            };
        });

        return sendJson(res, 200, {
            success: true,
            site,
            owned_discounts: sortOwnedDiscounts(ownedDiscounts),
            claimable_discounts: claimableDiscounts
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '加载可用优惠券失败'
        });
    }
};
