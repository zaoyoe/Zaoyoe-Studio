const {
    parseJsonBody,
    requireAuthenticatedUser,
    sendJson
} = require('../_lib/admin');
const {
    requireSupportedSite
} = require('../_lib/site');

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function getSafeTimestamp(value) {
    const parsed = Date.parse(normalizeText(value, 80));
    return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingRelationError(error, relationName = '') {
    const normalizedMessage = normalizeText(error?.message, 1000).toLowerCase();
    const normalizedRelation = normalizeText(relationName, 120).toLowerCase();
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

function assertClaimWindowOpen(discount = {}, now = new Date()) {
    const nowMs = now.getTime();
    const claimStartsAt = getSafeTimestamp(discount?.claim_starts_at);
    const claimExpiresAt = getSafeTimestamp(discount?.claim_expires_at);

    if (discount?.is_active === false) {
        const error = new Error('该优惠券当前未开放领取');
        error.statusCode = 409;
        throw error;
    }

    if (claimStartsAt > 0 && claimStartsAt > nowMs) {
        const error = new Error('该优惠券尚未开始领取');
        error.statusCode = 409;
        throw error;
    }

    if (claimExpiresAt > 0 && claimExpiresAt <= nowMs) {
        const error = new Error('该优惠券领取期已结束');
        error.statusCode = 409;
        throw error;
    }
}

async function loadClaimDiscount(supabase, { id = '', code = '' } = {}) {
    let query = supabase
        .from('discount_codes')
        .select('id, code, is_active, applicable_site, expires_at, distribution_mode, claim_starts_at, claim_expires_at, claim_limit_per_user, campaign_tag, audience_segment');

    if (normalizeText(id, 160)) {
        query = query.eq('id', normalizeText(id, 160));
    } else {
        query = query.eq('code', normalizeText(code, 80).toUpperCase());
    }

    const { data, error } = await query.single();
    if (error || !data) {
        const notFoundError = new Error(error?.message || '优惠券不存在');
        notFoundError.statusCode = 404;
        throw notFoundError;
    }
    return data;
}

async function countUserClaims(supabase, userId, discountId) {
    try {
        const { data, error } = await supabase
            .from('discount_user_assets')
            .select('id')
            .eq('user_id', userId)
            .eq('discount_id', discountId);

        if (error) throw error;
        return Array.isArray(data) ? data.length : 0;
    } catch (error) {
        if (isMissingRelationError(error, 'discount_user_assets')) {
            const missingError = new Error('优惠券资产表尚未完成迁移，请先执行 P1 SQL');
            missingError.statusCode = 500;
            throw missingError;
        }
        throw error;
    }
}

async function recordClaimEvent(supabase, payload = {}) {
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

    try {
        const { supabase, adminSupabase, user } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);
        const site = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
        const dataSupabase = adminSupabase || supabase;
        const discount = await loadClaimDiscount(dataSupabase, {
            id: body?.discountId || body?.discount_id,
            code: body?.discountCode || body?.discount_code
        });

        if (normalizeText(discount?.distribution_mode, 40).toLowerCase() !== 'public_claim') {
            return sendJson(res, 409, {
                success: false,
                message: '该优惠券当前不支持公开领取'
            });
        }

        const applicableSite = normalizeText(discount?.applicable_site, 20).toLowerCase();
        if (applicableSite && applicableSite !== site) {
            return sendJson(res, 409, {
                success: false,
                message: '当前站点下不可领取该优惠券'
            });
        }

        assertClaimWindowOpen(discount, new Date());

        const claimLimitPerUser = Math.max(0, Number(discount?.claim_limit_per_user || 0));
        const existingClaimCount = await countUserClaims(dataSupabase, user.id, discount.id);
        if (claimLimitPerUser > 0 && existingClaimCount >= claimLimitPerUser) {
            return sendJson(res, 409, {
                success: false,
                message: '你已达到该优惠券的领取上限'
            });
        }

        const nowIso = new Date().toISOString();
        const insertPayload = {
            discount_id: discount.id,
            user_id: user.id,
            asset_status: 'available',
            assigned_at: nowIso,
            claimed_at: nowIso,
            expires_at: discount.expires_at || null,
            source_type: 'public_claim',
            source_channel: normalizeText(body?.sourceChannel || body?.source_channel, 80).toLowerCase() || 'claim_center',
            audience_segment: normalizeText(discount?.audience_segment, 80).toLowerCase() || 'public_claim',
            source_batch_id: null,
            created_by: null,
            restored_at: null,
            consumed_at: null,
            last_order_id: null
        };

        const { data, error } = await dataSupabase
            .from('discount_user_assets')
            .insert(insertPayload)
            .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, expires_at, source_type, source_channel, audience_segment')
            .single();

        if (error || !data) {
            return sendJson(res, 400, {
                success: false,
                message: error?.message || '领取失败'
            });
        }

        await recordClaimEvent(dataSupabase, {
            discount_id: discount.id,
            user_id: user.id,
            discount_asset_id: data.id,
            order_id: null,
            event_type: 'claim',
            site,
            source_channel: data.source_channel || 'claim_center',
            event_source: 'shop_claim_center',
            audience_segment: data.audience_segment || 'public_claim',
            created_at: nowIso
        });

        return sendJson(res, 200, {
            success: true,
            asset: data,
            discount: {
                id: discount.id,
                code: discount.code,
                campaign_tag: discount.campaign_tag || null
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || '领取失败'
        });
    }
};
