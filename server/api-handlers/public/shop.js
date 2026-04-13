const crypto = require('node:crypto');

function createShopHandlers({
    admin,
    requestSecurity,
    site,
    discountAssets,
    discountPricing,
    env = process.env
} = {}) {
    const {
        getOptionalSupabaseAdmin,
        parseJsonBody,
        requireAuthenticatedUser,
        sendJson
    } = admin || {};
    const {
        applyRateLimitHeaders,
        resolveClientIp,
        takeRateLimitToken
    } = requestSecurity || {};
    const {
        requireSupportedSite
    } = site || {};
    const {
        normalizeDistributionMode,
        normalizeText
    } = discountAssets || {};
    const {
        buildPricingWaterfall
    } = discountPricing || {};

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
        site: currentSite,
        quantity,
        discountCode,
        discountAssetId,
        agentId
    }) {
        const { data, error } = await supabase.rpc('fn_validate_discount_code', {
            p_product_id: productId,
            p_user_id: userId,
            p_site: currentSite,
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

    function normalizeClaimText(value, maxLength = 255) {
        return String(value || '').trim().slice(0, Math.max(0, maxLength));
    }

    function getClaimTimestamp(value) {
        const parsed = Date.parse(normalizeClaimText(value, 80));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function assertClaimWindowOpen(discount = {}, now = new Date()) {
        const nowMs = now.getTime();
        const claimStartsAt = getClaimTimestamp(discount?.claim_starts_at);
        const claimExpiresAt = getClaimTimestamp(discount?.claim_expires_at);

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

        if (normalizeClaimText(id, 160)) {
            query = query.eq('id', normalizeClaimText(id, 160));
        } else {
            query = query.eq('code', normalizeClaimText(code, 80).toUpperCase());
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

    function isMissingRpcCapabilityError(error) {
        const normalizedCode = String(error?.code || '').trim().toUpperCase();
        const normalizedMessage = [
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').trim().toLowerCase();

        return normalizedCode === '42883'
            || normalizedCode === 'PGRST202'
            || normalizedMessage.includes('could not find the function')
            || normalizedMessage.includes('schema cache')
            || (normalizedMessage.includes('function') && normalizedMessage.includes('does not exist'));
    }

    function isAmbiguousRpcOverloadError(error, functionName = '') {
        const normalizedCode = String(error?.code || '').trim().toUpperCase();
        const normalizedMessage = [
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').trim().toLowerCase();
        const normalizedFunctionName = String(functionName || '').trim().toLowerCase();

        if (normalizedCode === '42725') {
            return true;
        }

        return normalizedMessage.includes('is not unique')
            && (!normalizedFunctionName || normalizedMessage.includes(normalizedFunctionName));
    }

    function canFallbackToLegacyPurchaseRpc(error) {
        return isMissingRpcCapabilityError(error)
            || isAmbiguousRpcOverloadError(error, 'fn_purchase_shop_item');
    }

    function getRpcSingleRow(data) {
        if (Array.isArray(data)) {
            return data[0] || null;
        }
        return data || null;
    }

    function buildPurchaseRpcParams(payload = {}, userId = '', options = {}) {
        const params = {
            p_product_id: payload.productId,
            p_user_id: userId,
            p_site: payload.site,
            p_quantity: payload.quantity,
            p_discount_code: payload.discountCode,
            p_agent_id: payload.agentId
        };

        if (options.includeDiscountAssetId !== false) {
            params.p_discount_asset_id = payload.discountAssetId;
        }

        return params;
    }

    async function executePurchaseRpc({
        payload,
        userId,
        requestSupabase,
        adminSupabase,
        fallbackSupabase
    }) {
        const primaryClient = requestSupabase || fallbackSupabase || adminSupabase;
        if (!primaryClient?.rpc) {
            const error = new Error('商城购买服务暂时不可用');
            error.statusCode = 503;
            throw error;
        }

        const primaryParams = buildPurchaseRpcParams(payload, userId, {
            includeDiscountAssetId: true
        });
        const canFallbackToLegacyRpc = !payload.discountAssetId;
        let lastError = null;

        try {
            const { data, error } = await primaryClient.rpc('fn_purchase_shop_item', primaryParams);
            if (error) {
                throw error;
            }

            const primaryPayload = getRpcSingleRow(data);
            if (primaryPayload) {
                return primaryPayload;
            }
        } catch (error) {
            lastError = error;
            if (!canFallbackToLegacyRpc || !canFallbackToLegacyPurchaseRpc(error)) {
                throw error;
            }
        }

        if (!canFallbackToLegacyRpc) {
            const error = new Error('商城购买服务未返回结果，请稍后重试');
            error.statusCode = 502;
            throw error;
        }

        const legacyParams = buildPurchaseRpcParams(payload, userId, {
            includeDiscountAssetId: false
        });
        const legacyClients = [];
        for (const client of [requestSupabase, adminSupabase, fallbackSupabase]) {
            if (client?.rpc && !legacyClients.includes(client)) {
                legacyClients.push(client);
            }
        }

        for (const client of legacyClients) {
            try {
                const { data, error } = await client.rpc('fn_purchase_shop_item', legacyParams);
                if (error) {
                    throw error;
                }

                const legacyPayload = getRpcSingleRow(data);
                if (legacyPayload) {
                    return legacyPayload;
                }
            } catch (error) {
                lastError = error;
            }
        }

        if (isMissingRpcCapabilityError(lastError)) {
            const error = new Error('商城购买接口版本不兼容，请检查 fn_purchase_shop_item 迁移和 schema cache');
            error.statusCode = 502;
            throw error;
        }

        if (lastError) {
            throw lastError;
        }

        const error = new Error('商城购买服务未返回结果，请检查 fn_purchase_shop_item RPC 配置');
        error.statusCode = 502;
        throw error;
    }

    return {
        'available-discounts': async function availableDiscountsHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const clientIp = resolveClientIp(req, { env }) || 'unknown';
            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `shop-discount-assets:${clientIp}`,
                limit: Math.max(1, Number(env.SHOP_DISCOUNT_ASSETS_RATE_LIMIT_MAX || 16)),
                windowMs: Math.max(10_000, Number(env.SHOP_DISCOUNT_ASSETS_RATE_LIMIT_WINDOW_MS || 60_000))
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
                const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
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
                            site: currentSite,
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
                        return !applicableSite || applicableSite === currentSite;
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
                    site: currentSite,
                    owned_discounts: sortOwnedDiscounts(ownedDiscounts),
                    claimable_discounts: claimableDiscounts
                });
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '加载可用优惠券失败'
                });
            }
        },
        'claim-discount': async function claimDiscountHandler(req, res) {
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
                const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
                const dataSupabase = adminSupabase || supabase;
                const discount = await loadClaimDiscount(dataSupabase, {
                    id: body?.discountId || body?.discount_id,
                    code: body?.discountCode || body?.discount_code
                });

                if (normalizeClaimText(discount?.distribution_mode, 40).toLowerCase() !== 'public_claim') {
                    return sendJson(res, 409, {
                        success: false,
                        message: '该优惠券当前不支持公开领取'
                    });
                }

                const applicableSite = normalizeClaimText(discount?.applicable_site, 20).toLowerCase();
                if (applicableSite && applicableSite !== currentSite) {
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
                    source_channel: normalizeClaimText(body?.sourceChannel || body?.source_channel, 80).toLowerCase() || 'claim_center',
                    audience_segment: normalizeClaimText(discount?.audience_segment, 80).toLowerCase() || 'public_claim',
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
                    site: currentSite,
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
        },
        'validate-discount': async function validateDiscountHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `shop-discount-validate:${resolveClientIp(req, { env }) || 'unknown'}`,
                limit: Math.max(1, Number(env.SHOP_DISCOUNT_VALIDATE_RATE_LIMIT_MAX || 12)),
                windowMs: Math.max(10_000, Number(env.SHOP_DISCOUNT_VALIDATE_RATE_LIMIT_WINDOW_MS || 60_000))
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
                const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
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
                    p_site: currentSite,
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
                        site: currentSite,
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
        },
        purchase: async function purchaseHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            const adminSupabase = getOptionalSupabaseAdmin();
            const clientIp = resolveClientIp(req, { env }) || 'unknown';
            const ipRateLimit = await takeRateLimitToken({
                supabase: adminSupabase,
                key: `shop-purchase:ip:${clientIp}`,
                limit: Math.max(1, Number(env.SHOP_PURCHASE_RATE_LIMIT_MAX || 12)),
                windowMs: Math.max(10_000, Number(env.SHOP_PURCHASE_RATE_LIMIT_WINDOW_MS || 60_000))
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
                    limit: Math.max(1, Number(env.SHOP_PURCHASE_USER_RATE_LIMIT_MAX || 8)),
                    windowMs: Math.max(10_000, Number(env.SHOP_PURCHASE_USER_RATE_LIMIT_WINDOW_MS || 60_000))
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
                    windowMs: Math.max(10_000, Number(env.SHOP_PURCHASE_IDEMPOTENCY_WINDOW_MS || 90_000))
                });
                if (!idempotencyResult.allowed) {
                    return sendJson(res, 409, {
                        success: false,
                        code: 'duplicate_submission',
                        message: '请勿重复提交订单，请稍候刷新后查看结果',
                        retry_after_seconds: idempotencyResult.retryAfterSeconds
                    });
                }

                const responsePayload = await executePurchaseRpc({
                    payload,
                    userId: user.id,
                    requestSupabase,
                    adminSupabase,
                    fallbackSupabase: supabase
                });
                if (!responsePayload || responsePayload.success === false) {
                    return sendJson(res, 400, responsePayload || {
                        success: false,
                        message: '商城购买服务未返回结果，请检查 fn_purchase_shop_item RPC 配置'
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
        }
    };
}

module.exports = {
    createShopHandlers
};
