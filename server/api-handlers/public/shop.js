const crypto = require('node:crypto');
const {
    buildDiscountLifecycleSummary
} = require('../admin/discounts/_shared');
const {
    maybeIssueAffiliateDiscountAssetsForShopOrder
} = require('../../../api/_lib/discount-trigger-linkage');
const {
    markUserAsPaid
} = require('../../../api/_lib/user-tags');
const {
    applyHotCacheResponseHeaders,
    createHotCache
} = require('./_hot-cache');

let vercelWaitUntil = null;
try {
    ({ waitUntil: vercelWaitUntil } = require('@vercel/functions'));
} catch (_error) {
    vercelWaitUntil = null;
}

async function safeMarkShopBuyerAsPaid(supabase, options = {}) {
    try {
        return await markUserAsPaid(supabase, options);
    } catch (error) {
        console.warn('[Shop] Failed to sync engagement user tags:', error?.message || error);
        return {
            ok: false,
            skipped: 'tag_sync_failed'
        };
    }
}

function normalizePositiveInteger(value, fallback, minimum = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return Math.max(minimum, fallback);
    }
    return Math.max(minimum, Math.floor(numericValue));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) {
        return fallback;
    }

    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function shouldBypassShopCatalogHotCache(req, requestUrl) {
    const headers = req?.headers || {};
    const cacheControl = String(headers['cache-control'] || headers['Cache-Control'] || '').toLowerCase();
    const pragma = String(headers.pragma || headers.Pragma || '').toLowerCase();

    return requestUrl.searchParams.has('refresh')
        || cacheControl.includes('no-cache')
        || cacheControl.includes('no-store')
        || pragma.includes('no-cache');
}

function buildShopCatalogCacheKey({
    site = 'cn',
    category = 'all'
} = {}) {
    return [
        'shop-catalog',
        String(site || 'cn').trim().toLowerCase(),
        String(category || 'all').trim().toLowerCase()
    ].join(':');
}

function maybeLogSlowShopCatalogRequest({
    env = process.env,
    site = 'cn',
    category = 'all',
    statusCode = 200,
    cacheStatus = 'miss',
    totalMs = 0
} = {}) {
    const thresholdMs = normalizePositiveInteger(env.SHOP_CATALOG_SLOW_REQUEST_MS, 800, 100);
    if (totalMs < thresholdMs) return;

    console.warn(
        `[ShopCatalog] Slow request status=${statusCode} total=${Math.round(totalMs)}ms cache=${cacheStatus} site=${site} category=${category}`
    );
}

function createShopHandlers({
    admin,
    requestSecurity,
    site,
    discountAssets,
    discountPricing,
    env = process.env
} = {}) {
    const {
        notifyUsers
    } = require('../../../api/_lib/admin-notifications');
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
        normalizeText: normalizeDiscountAssetText,
        normalizeSite,
        isRefundedOrder
    } = discountAssets || {};
    const {
        buildPricingWaterfall,
        buildDiscountStackingPolicy,
        normalizeDiscountSelection: normalizePricingDiscountSelection,
        resolveDiscountStacking: resolvePricingDiscountStacking
    } = discountPricing || {};
    const shopCatalogCache = createHotCache({
        ttlMs: normalizePositiveInteger(env.SHOP_CATALOG_HOT_CACHE_TTL_MS, 15_000, 0),
        maxEntries: normalizePositiveInteger(env.SHOP_CATALOG_HOT_CACHE_MAX_ENTRIES, 128, 1)
    });

    const normalizeText = typeof normalizeDiscountAssetText === 'function'
        ? normalizeDiscountAssetText
        : ((value, maxLength = 160) => String(value || '').trim().slice(0, Math.max(0, maxLength)));

    function setPrivateApiCache(res) {
        if (!res?.setHeader) return;
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('CDN-Cache-Control', 'no-store');
        res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    }

    function createServerTimingTracker() {
        return {
            startedAt: Date.now(),
            phases: []
        };
    }

    function recordServerTimingPhase(tracker, name = '', startedAt = Date.now()) {
        if (!tracker || !name) return 0;
        const durationMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
        tracker.phases.push({
            name: String(name || '').trim(),
            durationMs
        });
        return durationMs;
    }

    function applyServerTimingHeader(res, tracker) {
        if (!res?.setHeader || !tracker) {
            return {
                phases: [],
                totalMs: 0
            };
        }

        const phases = Array.isArray(tracker.phases)
            ? tracker.phases.filter((phase) => phase?.name)
            : [];
        const totalMs = Math.max(0, Date.now() - Number(tracker.startedAt || Date.now()));
        const metrics = [
            ...phases,
            { name: 'shop-purchase-total', durationMs: totalMs }
        ];
        const serverTimingValue = metrics
            .map((metric) => `${metric.name};dur=${Math.max(0, Math.round(Number(metric.durationMs || 0)))}`)
            .join(', ');

        if (serverTimingValue) {
            res.setHeader('Server-Timing', serverTimingValue);
        }

        return {
            phases,
            totalMs
        };
    }

    function maybeLogSlowPurchaseTiming(summary = {}, context = {}) {
        const totalMs = Math.max(0, Number(summary?.totalMs || 0) || 0);
        const slowThresholdMs = Math.max(250, Number(env.SHOP_PURCHASE_SLOW_REQUEST_MS || 1200) || 1200);
        if (!totalMs || totalMs < slowThresholdMs) {
            return;
        }

        const phaseSummary = (Array.isArray(summary?.phases) ? summary.phases : [])
            .map((phase) => `${String(phase?.name || '').replace(/^shop-purchase-/, '')}=${Math.max(0, Math.round(Number(phase?.durationMs || 0) || 0))}ms`)
            .filter(Boolean)
            .join(' ');
        const statusCode = Math.max(0, Number(context?.statusCode || 0) || 0);
        const productId = normalizeText(context?.productId, 160) || 'unknown';
        const userId = normalizeText(context?.userId, 160) || 'unknown';
        const orderId = normalizeText(context?.orderId, 160) || 'pending';
        const outcome = context?.success === false ? 'failure' : 'success';

        console.warn(
            `[Shop] Slow purchase ${outcome} status=${statusCode || 0} total=${Math.round(totalMs)}ms product=${productId} user=${userId} order=${orderId} ${phaseSummary}`.trim()
        );
    }

    function scheduleShopPurchaseFollowups(followupTask) {
        const guardedPromise = new Promise((resolve) => {
            const startTask = () => {
                Promise.resolve()
                    .then(() => (typeof followupTask === 'function' ? followupTask() : followupTask))
                    .catch((error) => {
                        console.warn('[Shop] Async purchase follow-up failed:', error?.message || error);
                    })
                    .finally(resolve);
            };

            if (typeof setImmediate === 'function') {
                setImmediate(startTask);
            } else {
                setTimeout(startTask, 0);
            }
        });

        if (typeof vercelWaitUntil === 'function') {
            try {
                vercelWaitUntil(guardedPromise);
                return;
            } catch (error) {
                console.warn('[Shop] Failed to register purchase follow-up with waitUntil:', error?.message || error);
            }
        }

        void guardedPromise;
    }

    async function safeProcessShopPurchaseRewards(supabase, { orderId = '', site = 'cn' } = {}) {
        const normalizedOrderId = normalizeText(orderId, 160);
        if (!supabase?.rpc || !normalizedOrderId) {
            return {
                success: false,
                skipped: 'reward_rpc_unavailable'
            };
        }

        try {
            const { data, error } = await supabase.rpc('fn_process_shop_purchase_rewards', {
                p_order_id: normalizedOrderId,
                p_site: site || 'cn'
            });
            if (error) throw error;
            return data || { success: true };
        } catch (error) {
            if (isMissingRpcCapabilityError(error)) {
                console.debug('[Shop] Purchase reward job RPC is not available yet; assuming legacy inline rewards.');
                return {
                    success: false,
                    skipped: 'reward_rpc_missing'
                };
            }

            console.warn('[Shop] Purchase reward job failed:', error?.message || error);
            return {
                success: false,
                message: error?.message || 'purchase reward job failed'
            };
        }
    }

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

    function isMissingColumnError(error, columnName = '') {
        const normalizedMessage = String(error?.message || '').trim().toLowerCase();
        const normalizedColumn = String(columnName || '').trim().toLowerCase();
        if (!normalizedMessage || !normalizedColumn) {
            return false;
        }

        return normalizedMessage.includes(normalizedColumn)
            && (
                normalizedMessage.includes('does not exist')
                || normalizedMessage.includes('not exist')
                || normalizedMessage.includes('undefined column')
                || normalizedMessage.includes('schema cache')
            );
    }

    function shouldRetryShopCatalogSelect(error) {
        return [
            'image_assets',
            'price_points_intl',
            'name_en',
            'description_en',
            'quantity_rules',
            'quantity_rules_intl',
            'max_purchase_quantity',
            'show_product_description',
            'show_purchase_notes',
            'purchase_notes',
            'purchase_notes_zh',
            'purchase_notes_en',
            'show_usage_instructions',
            'usage_instructions',
            'usage_instructions_zh',
            'usage_instructions_en',
            'flash_sale_price',
            'flash_sale_price_intl',
            'flash_sale_end',
            'flash_sale_end_intl',
            'manual_delivery',
            'updated_at',
            'created_at'
        ].some((field) => isMissingColumnError(error, field));
    }

    function normalizeShopCatalogCategory(value = 'all') {
        const normalized = String(value || 'all').trim();
        if (!normalized || normalized.toLowerCase() === 'all') return 'all';
        return normalized.slice(0, 120);
    }

    function hasShopCategoryPublicFlag(category = {}) {
        return category
            && typeof category === 'object'
            && Object.prototype.hasOwnProperty.call(category, 'is_public');
    }

    function isPublicShopCategory(category = {}) {
        if (!hasShopCategoryPublicFlag(category)) {
            return true;
        }
        const value = category.is_public;
        if (typeof value === 'boolean') {
            return value;
        }
        const normalized = normalizeText(value, 20).toLowerCase();
        return !['0', 'false', 'no', 'off', 'hidden', 'private'].includes(normalized);
    }

    function getHiddenShopCategoryNames(categories = []) {
        return new Set(
            (Array.isArray(categories) ? categories : [])
                .filter((category) => !isPublicShopCategory(category))
                .map((category) => normalizeText(category?.name, 120))
                .filter(Boolean)
        );
    }

    function isShopCatalogProductAvailableForSite(product = {}, currentSite = 'cn') {
        const priceField = currentSite === 'intl' ? 'price_points_intl' : 'price_points';
        const rawValue = product?.[priceField];
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return false;
        }
        return Number.isFinite(Number(rawValue));
    }

    function getSiteScopedShopMarketingValue(product = {}, baseField = '', currentSite = 'cn') {
        if (currentSite === 'intl') {
            const intlField = `${baseField}_intl`;
            if (Object.prototype.hasOwnProperty.call(product, intlField)) {
                return product[intlField];
            }
        }

        return product?.[baseField];
    }

    function normalizePublicShopSkuForSite(sku = {}, product = {}, currentSite = 'cn') {
        const skuPrice = currentSite === 'intl'
            ? (sku.price_points_intl ?? sku.price_points ?? null)
            : (sku.price_points ?? null);
        const skuQuantityRules = getSiteScopedShopMarketingValue(sku, 'quantity_rules', currentSite);

        return {
            ...sku,
            price_points: skuPrice,
            quantity_rules: skuQuantityRules ?? null,
            stock_count: Math.max(0, Number(sku.stock_count || 0) || 0)
        };
    }

    function normalizeShopCatalogProductForSite(product = {}, currentSite = 'cn') {
        const quantityRules = getSiteScopedShopMarketingValue(product, 'quantity_rules', currentSite);
        const flashSalePrice = getSiteScopedShopMarketingValue(product, 'flash_sale_price', currentSite);
        const flashSaleEnd = getSiteScopedShopMarketingValue(product, 'flash_sale_end', currentSite);
        const rawSkus = Array.isArray(product?.skus) ? product.skus : [];
        const imageCacheVersion = normalizeText(
            product?.image_cache_version || product?.image_updated_at || product?.updated_at || product?.created_at,
            80
        );
        const skus = rawSkus
            .filter((sku) => sku?.is_active !== false)
            .map((sku) => normalizePublicShopSkuForSite(sku, product, currentSite))
            .filter((sku) => sku.price_points !== null && sku.price_points !== undefined && sku.price_points !== '');

        return {
            ...product,
            manual_delivery: normalizeBoolean(product?.manual_delivery, false),
            quantity_rules: quantityRules ?? null,
            flash_sale_price: flashSalePrice ?? null,
            flash_sale_end: flashSaleEnd || null,
            ...(imageCacheVersion ? { image_cache_version: imageCacheVersion } : {}),
            skus
        };
    }

    async function attachPublicShopProductSkus(dataSupabase, products = []) {
        const rows = Array.isArray(products) ? products : [];
        const productIds = rows.map((product) => normalizeText(product?.id, 160)).filter(Boolean);
        if (!productIds.length) {
            return rows;
        }

        try {
            const { data, error } = await dataSupabase
                .from('shop_product_skus')
                .select('id, product_id, sku_code, sku_name, spec_values, price_points, price_points_intl, quantity_rules, quantity_rules_intl, is_default, is_active, stock_count, sort_order')
                .in('product_id', productIds)
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) throw error;

            const skusByProductId = new Map();
            (Array.isArray(data) ? data : []).forEach((sku) => {
                const productId = normalizeText(sku?.product_id, 160);
                if (!productId) return;
                if (!skusByProductId.has(productId)) {
                    skusByProductId.set(productId, []);
                }
                skusByProductId.get(productId).push(sku);
            });

            return rows.map((product) => ({
                ...product,
                skus: skusByProductId.get(normalizeText(product?.id, 160)) || []
            }));
        } catch (error) {
            if (isMissingRelationError(error, 'shop_product_skus')) {
                return rows;
            }
            throw error;
        }
    }

    async function loadShopCategoriesForCatalog(dataSupabase) {
        const { data, error } = await dataSupabase
            .from('shop_categories')
            .select('*')
            .order('sort_order');

        if (error) {
            if (isMissingRelationError(error, 'shop_categories')) {
                return [];
            }
            throw error;
        }
        return Array.isArray(data) ? data : [];
    }

    async function loadPublicShopProducts(dataSupabase, {
        category = 'all',
        currentSite = 'cn',
        hiddenCategoryNames = []
    } = {}) {
        const hiddenCategoryNameSet = hiddenCategoryNames instanceof Set
            ? hiddenCategoryNames
            : new Set((Array.isArray(hiddenCategoryNames) ? hiddenCategoryNames : [])
                .map((name) => normalizeText(name, 120))
                .filter(Boolean));

        if (category !== 'all' && hiddenCategoryNameSet.has(category)) {
            return [];
        }

        const selectAttempts = [
            [
                'id',
                'name',
                'name_en',
                'description',
                'description_en',
                'icon_url',
                'image_assets',
                'price_points',
                'price_points_intl',
                'stock_count',
                'category',
                'tags',
                'display_order',
                'is_active',
                'quantity_rules',
                'quantity_rules_intl',
                'max_purchase_quantity',
                'manual_delivery',
                'show_product_description',
                'show_purchase_notes',
                'purchase_notes',
                'purchase_notes_zh',
                'purchase_notes_en',
                'show_usage_instructions',
                'usage_instructions',
                'usage_instructions_zh',
                'usage_instructions_en',
                'flash_sale_price',
                'flash_sale_price_intl',
                'flash_sale_end',
                'flash_sale_end_intl',
                'updated_at',
                'created_at'
            ].join(', '),
            [
                'id',
                'name',
                'name_en',
                'description',
                'description_en',
                'icon_url',
                'price_points',
                'price_points_intl',
                'stock_count',
                'category',
                'tags',
                'display_order',
                'is_active',
                'quantity_rules',
                'max_purchase_quantity',
                'manual_delivery',
                'show_product_description',
                'show_purchase_notes',
                'purchase_notes',
                'show_usage_instructions',
                'usage_instructions',
                'flash_sale_price',
                'flash_sale_end',
                'updated_at',
                'created_at'
            ].join(', '),
            'id, name, description, icon_url, price_points, stock_count, category, tags, display_order, is_active'
        ];

        let lastError = null;
        for (const selectClause of selectAttempts) {
            let query = dataSupabase
                .from('shop_products')
                .select(selectClause)
                .eq('is_active', true)
                .order('display_order', { ascending: false });

            if (category !== 'all') {
                query = query.eq('category', category);
            }

            const { data, error } = await query;
            if (!error) {
                const products = await attachPublicShopProductSkus(dataSupabase, Array.isArray(data) ? data : []);
                return products
                    .filter((product) => !hiddenCategoryNameSet.has(normalizeText(product?.category, 120)))
                    .filter((product) => isShopCatalogProductAvailableForSite(product, currentSite))
                    .map((product) => normalizeShopCatalogProductForSite(product, currentSite));
            }

            lastError = error;
            if (!shouldRetryShopCatalogSelect(error)) {
                throw error;
            }
        }

        throw lastError || new Error('Failed to load shop catalog');
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
                .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment, last_order_id')
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

    async function loadAllUserAssets(supabase, userId) {
        try {
            const { data, error } = await supabase
                .from('discount_user_assets')
                .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment, last_order_id')
                .eq('user_id', userId)
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

    async function loadUserAssetById(supabase, userId, assetId) {
        const normalizedAssetId = normalizeText(assetId, 160);
        if (!normalizedAssetId) {
            const error = new Error('assetId is required');
            error.statusCode = 400;
            throw error;
        }

        try {
            const { data, error } = await supabase
                .from('discount_user_assets')
                .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment, last_order_id, updated_at')
                .eq('id', normalizedAssetId)
                .eq('user_id', userId)
                .single();

            if (error || !data) {
                const notFoundError = new Error('未找到这张卡券');
                notFoundError.statusCode = 404;
                throw notFoundError;
            }

            return data;
        } catch (error) {
            if (isMissingRelationError(error, 'discount_user_assets')) {
                const missingError = new Error('优惠券资产表尚未完成迁移，请先执行 P1 SQL');
                missingError.statusCode = 500;
                throw missingError;
            }
            throw error;
        }
    }

    async function loadDiscountRowsByIds(supabase, ids = []) {
        const discountIds = [...new Set((Array.isArray(ids) ? ids : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
        if (!discountIds.length) {
            return [];
        }

        let response = await supabase
            .from('discount_codes')
            .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, used_count, max_uses_per_user, starts_at, expires_at, lifecycle_status, status_reason, scope_type, scope_category, scope_product_id, scope_product_sku_id, allow_zero_total, distribution_mode, claim_starts_at, claim_expires_at, claim_limit_per_user, campaign_tag, audience_segment, observation_ends_at, is_exclusive, stack_priority, pricing_apply_stage')
            .in('id', discountIds);

        if (response.error && isMissingColumnError(response.error, 'scope_product_sku_id')) {
            response = await supabase
                .from('discount_codes')
                .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, used_count, max_uses_per_user, starts_at, expires_at, lifecycle_status, status_reason, scope_type, scope_category, scope_product_id, allow_zero_total, distribution_mode, claim_starts_at, claim_expires_at, claim_limit_per_user, campaign_tag, audience_segment, observation_ends_at, is_exclusive, stack_priority, pricing_apply_stage')
                .in('id', discountIds);
        }

        if (response.error) throw response.error;
        return Array.isArray(response.data) ? response.data : [];
    }

    async function loadPublicClaimDiscounts(supabase) {
        let response = await supabase
            .from('discount_codes')
            .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, used_count, max_uses_per_user, starts_at, expires_at, lifecycle_status, status_reason, scope_type, scope_category, scope_product_id, scope_product_sku_id, allow_zero_total, distribution_mode, claim_starts_at, claim_expires_at, claim_limit_per_user, campaign_tag, audience_segment, is_exclusive, stack_priority, pricing_apply_stage')
            .eq('distribution_mode', 'public_claim')
            .order('created_at', { ascending: false });

        if (response.error && isMissingColumnError(response.error, 'scope_product_sku_id')) {
            response = await supabase
                .from('discount_codes')
                .select('id, code, is_active, applicable_site, discount_type, discount_value, max_uses, used_count, max_uses_per_user, starts_at, expires_at, lifecycle_status, status_reason, scope_type, scope_category, scope_product_id, allow_zero_total, distribution_mode, claim_starts_at, claim_expires_at, claim_limit_per_user, campaign_tag, audience_segment, is_exclusive, stack_priority, pricing_apply_stage')
                .eq('distribution_mode', 'public_claim')
                .order('created_at', { ascending: false });
        }

        if (response.error) throw response.error;
        return Array.isArray(response.data) ? response.data : [];
    }

    async function loadShopOrdersByDiscountAssets(supabase, assets = []) {
        const assetRows = Array.isArray(assets) ? assets : [];
        const assetIds = [...new Set(assetRows.map((row) => normalizeText(row?.id, 160)).filter(Boolean))];
        const lastOrderIds = [...new Set(assetRows.map((row) => normalizeText(row?.last_order_id, 160)).filter(Boolean))];
        const orderByAssetId = new Map();

        if (!assetIds.length && !lastOrderIds.length) {
            return orderByAssetId;
        }

        try {
            if (assetIds.length) {
                const { data, error } = await supabase
                    .from('shop_orders')
                    .select('id, discount_asset_id, snapshot_product_name, discount_amount, refund_status, created_at')
                    .in('discount_asset_id', assetIds)
                    .order('created_at', { ascending: false });

                if (error) throw error;

                for (const row of data || []) {
                    const assetId = normalizeText(row?.discount_asset_id, 160);
                    if (!assetId || orderByAssetId.has(assetId)) continue;
                    orderByAssetId.set(assetId, row);
                }
            }
        } catch (error) {
            if (
                isMissingRelationError(error, 'shop_orders')
                || isMissingColumnError(error, 'discount_asset_id')
            ) {
                return orderByAssetId;
            }
            throw error;
        }

        const missingAssetRows = assetRows.filter((asset) => {
            const assetId = normalizeText(asset?.id, 160);
            return assetId && !orderByAssetId.has(assetId) && normalizeText(asset?.last_order_id, 160);
        });
        const missingOrderIds = [...new Set(missingAssetRows.map((row) => normalizeText(row?.last_order_id, 160)).filter(Boolean))];
        if (!missingOrderIds.length) {
            return orderByAssetId;
        }

        try {
            const { data, error } = await supabase
                .from('shop_orders')
                .select('id, discount_asset_id, snapshot_product_name, discount_amount, refund_status, created_at')
                .in('id', missingOrderIds);

            if (error) throw error;

            const assetIdByOrderId = new Map(
                missingAssetRows.map((row) => [normalizeText(row?.last_order_id, 160), normalizeText(row?.id, 160)])
            );

            for (const row of data || []) {
                const orderId = normalizeText(row?.id, 160);
                const assetId = assetIdByOrderId.get(orderId);
                if (!assetId || orderByAssetId.has(assetId)) continue;
                orderByAssetId.set(assetId, row);
            }
        } catch (error) {
            if (isMissingRelationError(error, 'shop_orders')) {
                return orderByAssetId;
            }
            throw error;
        }

        return orderByAssetId;
    }

    async function loadShopProductsByIds(supabase, ids = []) {
        const productIds = [...new Set((Array.isArray(ids) ? ids : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
        if (!productIds.length) {
            return new Map();
        }

        try {
            const { data, error } = await supabase
                .from('shop_products')
                .select('id, name, name_en, category, is_active')
                .in('id', productIds);

            if (error) throw error;

            return new Map(
                (Array.isArray(data) ? data : [])
                    .map((row) => [normalizeText(row?.id, 160), row])
                    .filter(([id]) => id)
            );
        } catch (error) {
            if (isMissingRelationError(error, 'shop_products')) {
                return new Map();
            }
            throw error;
        }
    }

    async function loadShopProductSkusByIds(supabase, ids = []) {
        const skuIds = [...new Set((Array.isArray(ids) ? ids : []).map((value) => normalizeText(value, 160)).filter(Boolean))];
        if (!skuIds.length) {
            return new Map();
        }

        try {
            const { data, error } = await supabase
                .from('shop_product_skus')
                .select('id, product_id, sku_code, sku_name, is_active, is_default')
                .in('id', skuIds);

            if (error) throw error;

            return new Map(
                (Array.isArray(data) ? data : [])
                    .map((row) => [normalizeText(row?.id, 160), row])
                    .filter(([id]) => id)
            );
        } catch (error) {
            if (isMissingRelationError(error, 'shop_product_skus')) {
                return new Map();
            }
            throw error;
        }
    }

    function resolveScopeProductSkuSummary(discount = {}, skuById = new Map()) {
        const scopeType = normalizeClaimText(discount?.scope_type, 40).toLowerCase() || 'all';
        if (scopeType !== 'product') {
            return null;
        }

        const skuId = normalizeClaimText(discount?.scope_product_sku_id, 160);
        if (!skuId) {
            return null;
        }

        const sku = skuById instanceof Map
            ? (skuById.get(skuId) || null)
            : null;
        const displayName = normalizeClaimText(sku?.sku_name, 120) || normalizeClaimText(sku?.sku_code, 120) || null;

        return {
            id: skuId,
            product_id: normalizeClaimText(sku?.product_id, 160) || null,
            sku_code: normalizeClaimText(sku?.sku_code, 120) || null,
            sku_name: normalizeClaimText(sku?.sku_name, 160) || null,
            is_active: sku ? sku.is_active !== false : null,
            is_default: sku ? sku.is_default === true : null,
            display_name: displayName,
            is_missing: !sku
        };
    }

    async function loadScopedProductAvailabilityByAsset(supabase, {
        userId = '',
        site: currentSite = 'cn',
        assets = [],
        discountMap = new Map(),
        productById = new Map(),
        skuById = new Map()
    } = {}) {
        const availabilityByAssetId = new Map();
        const relevantAssets = (Array.isArray(assets) ? assets : []).filter((asset) => {
            const normalizedAssetId = normalizeText(asset?.id, 160);
            const discount = discountMap.get(normalizeText(asset?.discount_id, 160));
            return normalizedAssetId
                && normalizeClaimText(asset?.asset_status, 40).toLowerCase() === 'available'
                && normalizeClaimText(discount?.scope_type, 40).toLowerCase() === 'product'
                && normalizeClaimText(discount?.scope_product_id, 160);
        });

        if (!relevantAssets.length || !supabase?.rpc || !userId) {
            return availabilityByAssetId;
        }

        const entries = await Promise.all(relevantAssets.map(async (asset) => {
            const assetId = normalizeText(asset?.id, 160);
            const discount = discountMap.get(normalizeText(asset?.discount_id, 160));
            const productId = normalizeClaimText(discount?.scope_product_id, 160);
            const skuId = normalizeClaimText(discount?.scope_product_sku_id, 160);
            const product = productById.get(productId) || null;
            const sku = skuId ? (skuById.get(skuId) || null) : null;

            if (!productId) {
                return [assetId, {
                    available: false,
                    message: '指定商品信息缺失，请联系管理员检查卡券配置',
                    preview: null
                }];
            }

            if (!product) {
                return [assetId, {
                    available: false,
                    message: '指定商品当前暂不可见，请稍后再试',
                    preview: null
                }];
            }

            if (product.is_active === false) {
                return [assetId, {
                    available: false,
                    message: '指定商品当前已下架，暂时无法使用这张卡券',
                    preview: null
                }];
            }

            if (skuId && !sku) {
                return [assetId, {
                    available: false,
                    message: '指定规格当前暂不可见，请联系管理员检查卡券配置',
                    preview: null
                }];
            }

            if (skuId && sku.is_active === false) {
                return [assetId, {
                    available: false,
                    message: '指定规格当前已停用，暂时无法使用这张卡券',
                    preview: null
                }];
            }

            try {
                const payload = await previewDiscount(supabase, {
                    productId,
                    userId,
                    site: currentSite,
                    quantity: 1,
                    discountCode: discount?.code,
                    discountAssetId: assetId,
                    productSkuId: skuId || null,
                    agentId: null
                });

                if (payload?.success === false) {
                    return [assetId, {
                        available: false,
                        message: normalizeClaimText(payload?.message, 160) || '指定商品当前暂不可用',
                        preview: payload?.data || null
                    }];
                }

                return [assetId, {
                    available: true,
                    message: buildScopedProductAvailabilityMessage(payload),
                    preview: payload?.data || null
                }];
            } catch (error) {
                return [assetId, {
                    available: false,
                    message: normalizeClaimText(error?.message, 160) || '指定商品当前暂不可用',
                    preview: null
                }];
            }
        }));

        return new Map(entries.filter(([assetId]) => assetId));
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

    function getDiscountAssetActivityTime(asset = {}) {
        return getSafeTimestamp(asset?.claimed_at || asset?.assigned_at || asset?.created_at);
    }

    function isFreshPublicClaimAssetCandidate(asset = {}) {
        return normalizeClaimText(asset?.asset_status, 40).toLowerCase() === 'available'
            && normalizeClaimText(asset?.source_type, 40).toLowerCase() === 'public_claim'
            && !normalizeClaimText(asset?.consumed_at, 80)
            && !normalizeClaimText(asset?.restored_at, 80)
            && !normalizeClaimText(asset?.last_order_id, 160);
    }

    function suppressExcessPublicClaimAssets(assets = [], discountMap = new Map()) {
        const assetRows = Array.isArray(assets) ? assets.slice() : [];
        if (!assetRows.length) {
            return assetRows;
        }

        const groupedAssets = new Map();
        for (const asset of assetRows) {
            const discountId = normalizeText(asset?.discount_id, 160);
            if (!discountId) continue;
            if (!groupedAssets.has(discountId)) {
                groupedAssets.set(discountId, []);
            }
            groupedAssets.get(discountId).push(asset);
        }

        const suppressedAssetIds = new Set();
        for (const [discountId, rows] of groupedAssets.entries()) {
            const discount = discountMap.get(discountId);
            if (normalizeDistributionMode(discount?.distribution_mode, 'general_code') !== 'public_claim') {
                continue;
            }

            const claimLimitPerUser = Math.max(0, Number(discount?.claim_limit_per_user || 0));
            if (claimLimitPerUser <= 0 || rows.length <= claimLimitPerUser) {
                continue;
            }

            const candidateRows = rows.filter((asset) => isFreshPublicClaimAssetCandidate(asset));
            if (!candidateRows.length) {
                continue;
            }

            const candidateIdSet = new Set(
                candidateRows
                    .map((asset) => normalizeText(asset?.id, 160))
                    .filter(Boolean)
            );
            const preservedClaimCount = rows.filter((asset) => {
                const assetId = normalizeText(asset?.id, 160);
                if (candidateIdSet.has(assetId)) {
                    return false;
                }
                return normalizeClaimText(asset?.asset_status, 40).toLowerCase() !== 'revoked';
            }).length;
            const allowedCandidateCount = Math.max(0, claimLimitPerUser - preservedClaimCount);

            if (candidateRows.length <= allowedCandidateCount) {
                continue;
            }

            const sortedCandidates = candidateRows.slice().sort((left, right) => {
                const leftTime = getDiscountAssetActivityTime(left);
                const rightTime = getDiscountAssetActivityTime(right);
                if (leftTime !== rightTime) {
                    return leftTime - rightTime;
                }
                return normalizeText(left?.id, 160).localeCompare(normalizeText(right?.id, 160));
            });

            for (const asset of sortedCandidates.slice(allowedCandidateCount)) {
                const assetId = normalizeText(asset?.id, 160);
                if (!assetId) continue;
                suppressedAssetIds.add(assetId);
            }
        }

        if (!suppressedAssetIds.size) {
            return assetRows;
        }

        return assetRows.filter((asset) => !suppressedAssetIds.has(normalizeText(asset?.id, 160)));
    }

    async function previewDiscount(supabase, {
        productId,
        userId,
        site: currentSite,
        quantity,
        discountCode,
        discountAssetId,
        productSkuId,
        agentId
    }) {
        const params = {
            p_product_id: productId,
            p_user_id: userId,
            p_site: currentSite,
            p_quantity: quantity,
            p_discount_code: discountCode,
            p_discount_asset_id: discountAssetId || null,
            p_agent_id: agentId || null
        };
        if (productSkuId) {
            params.p_sku_id = productSkuId;
        }

        let { data, error } = await supabase.rpc('fn_validate_discount_code', params);
        if (error && productSkuId && isMissingRpcCapabilityError(error)) {
            const legacyParams = { ...params };
            delete legacyParams.p_sku_id;
            ({ data, error } = await supabase.rpc('fn_validate_discount_code', legacyParams));
        }

        if (error) throw error;
        return Array.isArray(data) ? data[0] : data;
    }

    function normalizeDiscountSelectionInput(selection = {}) {
        if (typeof normalizePricingDiscountSelection !== 'function') {
            return null;
        }

        const normalized = normalizePricingDiscountSelection({
            discount_code: selection?.discountCode ?? selection?.discount_code ?? selection?.code,
            discount_asset_id: selection?.discountAssetId ?? selection?.discount_asset_id ?? selection?.assetId ?? selection?.asset_id,
            scope_product_sku_id: selection?.scopeProductSkuId ?? selection?.scope_product_sku_id
        });

        if (!normalized?.code && !normalized?.asset_id) {
            return null;
        }

        return {
            code: normalized.code || null,
            assetId: normalized.asset_id || null,
            scopeProductSkuId: normalized.scope_product_sku_id || null
        };
    }

    function normalizeDiscountSelectionsInput(source = {}, options = {}) {
        const rawSelections = Array.isArray(source?.discountSelections)
            ? source.discountSelections
            : (Array.isArray(source?.discount_selections) ? source.discount_selections : []);
        const selections = rawSelections
            .map((selection) => normalizeDiscountSelectionInput(selection))
            .filter(Boolean);

        const fallbackSelection = normalizeDiscountSelectionInput({
            discountCode: options.discountCode ?? source?.discountCode ?? source?.discount_code,
            discountAssetId: options.discountAssetId ?? source?.discountAssetId ?? source?.discount_asset_id
        });
        if (!selections.length && fallbackSelection) {
            selections.push(fallbackSelection);
        }

        const dedupedSelections = [];
        const seenSelectionKeys = new Set();
        for (const selection of selections) {
            const selectionKey = selection.assetId
                ? `asset:${selection.assetId}`
                : `code:${selection.code || ''}`;
            if (!selectionKey || seenSelectionKeys.has(selectionKey)) {
                continue;
            }
            seenSelectionKeys.add(selectionKey);
            dedupedSelections.push(selection);
        }

        return dedupedSelections;
    }

    function buildCombinedBenefitLabel(appliedDiscounts = [], totalDiscountAmount = 0) {
        const normalizedDiscounts = Array.isArray(appliedDiscounts) ? appliedDiscounts : [];
        if (normalizedDiscounts.length === 1) {
            return formatBenefitLabel(normalizedDiscounts[0]);
        }

        const normalizedAmount = Number(totalDiscountAmount);
        if (normalizedDiscounts.length > 1 && Number.isFinite(normalizedAmount) && normalizedAmount > 0) {
            return `已叠加 ${normalizedDiscounts.length} 张卡券`;
        }

        return normalizedDiscounts.length > 1
            ? `已选 ${normalizedDiscounts.length} 张卡券`
            : '';
    }

    async function buildDiscountSelectionPreview(supabase, {
        productId,
        userId,
        site: currentSite,
        quantity,
        selections = [],
        productSkuId,
        agentId
    } = {}) {
        const normalizedSelections = normalizeDiscountSelectionsInput({
            discountSelections: selections
        });

        if (!normalizedSelections.length) {
            return {
                success: false,
                statusCode: 400,
                message: '请输入优惠码'
            };
        }

        if (normalizedSelections.length > 8) {
            return {
                success: false,
                statusCode: 400,
                message: '单次最多选择 8 张卡券'
            };
        }

        const previewRows = [];
        for (const selection of normalizedSelections) {
            const payload = await previewDiscount(supabase, {
                productId,
                userId,
                site: currentSite,
                quantity,
                discountCode: selection.code,
                discountAssetId: selection.assetId,
                productSkuId,
                agentId
            });

            if (!payload || payload.success === false) {
                return {
                    success: false,
                    statusCode: 400,
                    message: payload?.message || '优惠码验证失败'
                };
            }

            previewRows.push({
                selection,
                payload
            });
        }

        const discountRows = await loadDiscountRowsByIds(
            supabase,
            previewRows
                .map((row) => normalizeText(row?.payload?.data?.discount_id, 160))
                .filter(Boolean)
        );
        const discountRowById = new Map(
            discountRows.map((row) => [normalizeText(row?.id, 160), row])
        );

        const appliedDiscounts = previewRows.map(({ selection, payload }) => {
            const responseData = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
                ? payload.data
                : {};
            const discountId = normalizeText(responseData?.discount_id, 160);
            const matchingDiscountRow = discountRowById.get(discountId) || {};

            return {
                ...responseData,
                discount_code: responseData.discount_code || selection.code,
                discount_asset_id: selection.assetId || responseData.discount_asset_id || null,
                allow_zero_total: matchingDiscountRow.allow_zero_total === true,
                benefit_label: formatBenefitLabel({
                    discount_type: responseData.discount_type,
                    discount_value: responseData.discount_value,
                    code: responseData.discount_code || selection.code
                })
            };
        });

        const subtotal = Number(appliedDiscounts[0]?.subtotal);
        const resolvedStack = typeof resolvePricingDiscountStacking === 'function'
            ? resolvePricingDiscountStacking({
                subtotal,
                discounts: appliedDiscounts
            })
            : null;

        if (!resolvedStack?.success) {
            return {
                success: false,
                statusCode: 400,
                message: resolvedStack?.message || '当前卡券组合不可用'
            };
        }

        const resolvedAppliedDiscounts = (resolvedStack.applied_discounts || []).map((discount) => ({
            ...discount,
            benefit_label: discount?.benefit_label || formatBenefitLabel(discount)
        }));
        const totalDiscountAmount = Number(resolvedStack.discount_amount || 0) || 0;
        const finalTotal = Number(resolvedStack.final_total || subtotal || 0) || 0;
        const primaryDiscount = resolvedAppliedDiscounts[0] || null;
        const displayCode = resolvedAppliedDiscounts
            .map((discount) => normalizeText(discount?.code, 80).toUpperCase())
            .filter(Boolean)
            .join(' + ') || null;

        return {
            success: true,
            statusCode: 200,
            payload: {
                success: true,
                message: resolvedAppliedDiscounts.length > 1 ? '卡券组合可用' : '优惠码可用',
                data: {
                    ...(primaryDiscount ? {
                        discount_id: primaryDiscount.discount_id || null,
                        discount_asset_id: primaryDiscount.asset_id || null,
                        distribution_mode: primaryDiscount.distribution_mode || null,
                        campaign_tag: primaryDiscount.campaign_tag || null,
                        audience_segment: primaryDiscount.audience_segment || null,
                        discount_type: primaryDiscount.discount_type || null,
                        discount_value: primaryDiscount.discount_value ?? null,
                        is_exclusive: primaryDiscount.is_exclusive !== false,
                        stack_priority: primaryDiscount.stack_priority ?? 100,
                        pricing_apply_stage: primaryDiscount.pricing_apply_stage || 'order_discount'
                    } : {}),
                    discount_code: displayCode,
                    discount_codes: resolvedAppliedDiscounts.map((discount) => discount.code).filter(Boolean),
                    applied_discounts: resolvedAppliedDiscounts,
                    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
                    discount_amount: totalDiscountAmount,
                    final_total: finalTotal,
                    unit_price: Number(primaryDiscount?.unit_price ?? appliedDiscounts[0]?.unit_price ?? 0) || 0,
                    benefit_label: buildCombinedBenefitLabel(resolvedAppliedDiscounts, totalDiscountAmount)
                }
            },
            appliedDiscounts: resolvedAppliedDiscounts
        };
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

    function formatClaimPoints(value, fallback = '0') {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return fallback;
        }

        const normalized = Math.round(numericValue * 100) / 100;
        return Number.isInteger(normalized)
            ? String(normalized)
            : normalized
                .toFixed(2)
                .replace(/(\.\d*?[1-9])0+$/, '$1')
                .replace(/\.0+$/, '');
    }

    function buildScopedProductAvailabilityMessage(payload = {}) {
        const preview = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
            ? payload.data
            : null;
        const finalTotal = Number(preview?.final_total);
        const discountAmount = Number(preview?.discount_amount);

        if (Number.isFinite(finalTotal) && finalTotal >= 0) {
            const prefix = Number.isFinite(discountAmount) && discountAmount > 0
                ? '打开指定商品后预计实付'
                : '打开指定商品后实付';
            return `${prefix} ${formatClaimPoints(finalTotal)} 积分`;
        }

        return normalizeClaimText(payload?.message, 160) || '打开指定商品后可直接选择使用';
    }

    function matchesApplicableSite(discount = {}, currentSite = 'cn') {
        const discountSite = typeof normalizeSite === 'function'
            ? normalizeSite(discount?.applicable_site, 'all')
            : (normalizeClaimText(discount?.applicable_site, 20).toLowerCase() || 'all');
        return discountSite === 'all' || discountSite === currentSite;
    }

    function formatPercentDiscountValue(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return '折扣券';
        }

        const folded = numericValue / 10;
        const display = Number.isInteger(folded)
            ? String(folded)
            : folded.toFixed(1).replace(/\.0$/, '');
        return `${display}折`;
    }

    function formatBenefitLabel(discount = {}) {
        const discountType = normalizeClaimText(discount?.discount_type, 20).toLowerCase();
        const discountValue = Number(discount?.discount_value);

        if (discountType === 'percent') {
            return formatPercentDiscountValue(discountValue);
        }

        if (discountType === 'fixed') {
            return Number.isFinite(discountValue) && discountValue > 0
                ? `立减 ${discountValue} 积分`
                : '立减券';
        }

        return normalizeClaimText(discount?.code, 80) || '卡券';
    }

    function formatDiscountNotificationExpiryLabel(asset = {}, discount = {}) {
        const effectiveExpiresAt = resolveEffectiveExpiry(asset, discount);
        return effectiveExpiresAt
            ? `有效期至 ${effectiveExpiresAt}`
            : '长期有效';
    }

    function buildDiscountUserNotificationPayload({
        action = 'claim',
        asset = {},
        discount = {}
    } = {}) {
        const benefitLabel = formatBenefitLabel(discount);
        const code = normalizeClaimText(discount?.code, 80);
        const expiryLabel = formatDiscountNotificationExpiryLabel(asset, discount);
        const normalizedAction = normalizeClaimText(action, 20).toLowerCase();
        const title = normalizedAction === 'assign' ? '优惠券已到账' : '优惠券领取成功';
        const intro = normalizedAction === 'assign'
            ? `${benefitLabel}${code ? `（${code}）` : ''} 已发放到你的钱包卡券。`
            : `你已领取 ${benefitLabel}${code ? `（${code}）` : ''}。`;

        return {
            title,
            content: `${intro}\n${expiryLabel}。\n请前往“我的钱包 > 卡券”查看，并在下单时点击使用。`,
            type: 'success',
            scope: 'user_personal',
            category: 'discount_notice',
            actionLabel: '去商城使用',
            actionUrl: '/shop.html',
            sourceModule: 'discounts',
            sourceEventId: `discount_${normalizedAction}:${normalizeClaimText(asset?.id || discount?.id, 120)}`,
            priority: 45,
            metadata: {
                page_id: 'shop',
                event_type: 'coupon_available',
                action: normalizedAction,
                action_path_label: '我的钱包 > 卡券',
                action_path_url: 'wallet://cards',
                action_path_kind: 'wallet',
                wallet_view: 'cards',
                discount_id: normalizeClaimText(discount?.id, 120),
                discount_code: code,
                discount_asset_id: normalizeClaimText(asset?.id, 120),
                benefit_label: benefitLabel,
                expires_at: resolveEffectiveExpiry(asset, discount)
            },
            dedupeWindowMinutes: 0
        };
    }

    function resolveScopeProductSummary(discount = {}, productById = new Map()) {
        const scopeType = normalizeClaimText(discount?.scope_type, 40).toLowerCase() || 'all';
        if (scopeType !== 'product') {
            return null;
        }

        const productId = normalizeClaimText(discount?.scope_product_id, 160);
        if (!productId) {
            return null;
        }

        const product = productById instanceof Map
            ? (productById.get(productId) || null)
            : null;
        const displayName = normalizeClaimText(product?.name, 120) || normalizeClaimText(product?.name_en, 120) || null;

        return {
            id: productId,
            name: normalizeClaimText(product?.name, 160) || null,
            name_en: normalizeClaimText(product?.name_en, 160) || null,
            category: normalizeClaimText(product?.category, 120) || null,
            is_active: product ? product.is_active !== false : null,
            display_name: displayName,
            is_missing: !product
        };
    }

    function formatScopeLabel(discount = {}, productById = new Map(), skuById = new Map()) {
        const scopeType = normalizeClaimText(discount?.scope_type, 40).toLowerCase() || 'all';
        if (scopeType === 'category') {
            return normalizeClaimText(discount?.scope_category, 80)
                ? `分类限定 · ${normalizeClaimText(discount?.scope_category, 80)}`
                : '分类限定';
        }

        if (scopeType === 'product') {
            const scopeProduct = resolveScopeProductSummary(discount, productById);
            const scopeSku = resolveScopeProductSkuSummary(discount, skuById);
            if (scopeProduct?.display_name && scopeSku?.display_name) {
                return `指定商品 · ${scopeProduct.display_name} / ${scopeSku.display_name}`;
            }
            return scopeProduct?.display_name
                ? `指定商品 · ${scopeProduct.display_name}`
                : '指定商品';
        }

        return '全场可用';
    }

    function buildDiscountScopePayload(discount = {}, productById = new Map(), skuById = new Map()) {
        return {
            scope_type: normalizeClaimText(discount?.scope_type, 40).toLowerCase() || 'all',
            scope_category: normalizeClaimText(discount?.scope_category, 120) || null,
            scope_product_id: normalizeClaimText(discount?.scope_product_id, 160) || null,
            scope_product_sku_id: normalizeClaimText(discount?.scope_product_sku_id, 160) || null,
            scope_product: resolveScopeProductSummary(discount, productById),
            scope_product_sku: resolveScopeProductSkuSummary(discount, skuById),
            scope_label: formatScopeLabel(discount, productById, skuById)
        };
    }

    function formatSourceLabel(asset = {}, discount = {}) {
        const sourceChannel = normalizeClaimText(asset?.source_channel, 80).toLowerCase();
        const sourceType = normalizeClaimText(asset?.source_type, 80).toLowerCase();
        const distributionMode = normalizeDistributionMode(discount?.distribution_mode, 'general_code');

        if (sourceChannel.includes('checkin') || sourceType.includes('checkin')) {
            return '签到发券';
        }
        if (sourceChannel.includes('affiliate') || sourceChannel.includes('invite') || sourceType.includes('affiliate')) {
            return '推广奖励';
        }
        if (sourceChannel.includes('recharge') || sourceType.includes('recharge')) {
            return '充值赠券';
        }
        if (sourceChannel.includes('claim') || sourceType === 'public_claim' || distributionMode === 'public_claim') {
            return '主动领取';
        }
        if (sourceChannel.includes('admin') || sourceType.includes('manual')) {
            return '后台发放';
        }
        if (distributionMode === 'user_assigned') {
            return '到账卡券';
        }
        return '卡券资产';
    }

    function buildDiscountStackingPresentation(discount = {}) {
        const policy = typeof buildDiscountStackingPolicy === 'function'
            ? buildDiscountStackingPolicy(discount)
            : {
                is_exclusive: discount?.is_exclusive !== false,
                stack_priority: Number(discount?.stack_priority || 100) || 100,
                pricing_apply_stage: normalizeClaimText(discount?.pricing_apply_stage, 40).toLowerCase() || 'order_discount',
                exclusivity_label: discount?.is_exclusive === false ? '可并行权益' : '排他券',
                apply_stage_label: '订单优惠阶段',
                summary: discount?.is_exclusive === false ? '可与其它优惠券叠加' : '不可与其它优惠券叠加'
            };

        return {
            is_exclusive: policy.is_exclusive !== false,
            stack_priority: Number(policy.stack_priority || 100) || 100,
            pricing_apply_stage: policy.pricing_apply_stage || 'order_discount',
            stacking_label: policy.exclusivity_label || (policy.is_exclusive === false ? '可并行权益' : '排他券'),
            stacking_summary: policy.is_exclusive === false ? '可与其它优惠券叠加' : '不可与其它优惠券叠加',
            stacking_stage_label: policy.apply_stage_label || '订单优惠阶段'
        };
    }

    function resolveEffectiveExpiry(asset = {}, discount = {}) {
        const assetExpiry = normalizeClaimText(asset?.expires_at, 80);
        const discountExpiry = normalizeClaimText(discount?.expires_at, 80);
        const assetExpiryMs = getSafeTimestamp(assetExpiry);
        const discountExpiryMs = getSafeTimestamp(discountExpiry);

        if (assetExpiryMs > 0 && discountExpiryMs > 0) {
            return assetExpiryMs <= discountExpiryMs ? assetExpiry : discountExpiry;
        }
        if (assetExpiryMs > 0) return assetExpiry;
        if (discountExpiryMs > 0) return discountExpiry;
        return null;
    }

    function getWalletOrderDiscountAmount(order = {}) {
        const amount = Number(order?.discount_amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return 0;
        }
        const refunded = typeof isRefundedOrder === 'function'
            ? isRefundedOrder(order)
            : ['refunded', 'full_refund'].includes(normalizeClaimText(order?.refund_status, 40).toLowerCase());
        return refunded ? 0 : amount;
    }

    function buildWalletAssetCard(
        asset = {},
        discount = {},
        orderByAssetId = new Map(),
        productById = new Map(),
        skuById = new Map(),
        now = new Date(),
        options = {}
    ) {
        const normalizedAssetStatus = normalizeClaimText(asset?.asset_status, 40).toLowerCase() || 'available';
        const lifecycle = buildDiscountLifecycleSummary(discount, { now });
        const effectiveExpiresAt = resolveEffectiveExpiry(asset, discount);
        const effectiveExpiresAtMs = getSafeTimestamp(effectiveExpiresAt);
        const nowMs = now.getTime();
        const relatedOrder = orderByAssetId.get(normalizeClaimText(asset?.id, 160)) || null;
        const savedAmount = getWalletOrderDiscountAmount(relatedOrder);
        const isExpiredByTime = effectiveExpiresAtMs > 0 && effectiveExpiresAtMs <= nowMs;
        const scopeProduct = resolveScopeProductSummary(discount, productById);
        const scopedProductAvailability = options?.scopedProductAvailability || null;
        const isProductScoped = normalizeClaimText(discount?.scope_type, 40).toLowerCase() === 'product';
        const scopeProductSku = resolveScopeProductSkuSummary(discount, skuById);

        let statusGroup = 'inactive';
        let statusLabel = '已失效';
        let statusDetail = lifecycle.detail_text || '当前不可使用';
        let statusTone = 'inactive';

        if (normalizedAssetStatus === 'used') {
            statusGroup = 'used';
            statusLabel = '已使用';
            statusDetail = relatedOrder?.snapshot_product_name
                ? `已用于 ${relatedOrder.snapshot_product_name}`
                : '已在商城下单时使用';
            statusTone = 'used';
        } else if (normalizedAssetStatus === 'available' && !isExpiredByTime && lifecycle.key === 'active') {
            statusGroup = 'available';
            statusTone = 'available';
            if (isProductScoped && scopedProductAvailability?.available === false) {
                statusLabel = '暂不可用';
                statusDetail = `指定商品当前不可用：${normalizeClaimText(scopedProductAvailability?.message, 160) || '请稍后再试'}`;
                statusTone = 'inactive';
            } else {
                statusLabel = '可用';
                const scopedAvailableMessage = normalizeClaimText(scopedProductAvailability?.message, 160) || '';
                statusDetail = isProductScoped && scopedAvailableMessage
                    ? scopedAvailableMessage
                    : (effectiveExpiresAt
                        ? `有效期至 ${effectiveExpiresAt}`
                        : (isProductScoped
                            ? '打开指定商品后可直接选择使用'
                            : '当前下单可直接选择使用'));
            }
        } else if (normalizedAssetStatus === 'expired' || isExpiredByTime || lifecycle.key === 'expired') {
            statusLabel = '已过期';
            statusDetail = effectiveExpiresAt
                ? `已于 ${effectiveExpiresAt} 过期`
                : '该卡券已过期';
        } else if (normalizedAssetStatus === 'revoked') {
            statusLabel = '已停用';
            statusDetail = '该卡券已被停用，暂时无法使用';
        } else if (lifecycle.key === 'scheduled') {
            statusLabel = '待生效';
            statusDetail = lifecycle.detail_text || '未到生效时间';
        } else if (lifecycle.key === 'paused_manual' || lifecycle.key === 'paused_risk' || lifecycle.key === 'archived' || lifecycle.key === 'exhausted') {
            statusLabel = lifecycle.label || '暂不可用';
            statusDetail = lifecycle.detail_text || '当前暂不可使用';
        }

        const isExpiringSoon = statusGroup === 'available'
            && statusTone === 'available'
            && effectiveExpiresAtMs > nowMs
            && effectiveExpiresAtMs - nowMs <= 72 * 60 * 60 * 1000;

        const stackingPresentation = buildDiscountStackingPresentation(discount);

        return {
            asset_id: asset.id,
            discount_id: discount.id,
            code: discount.code || null,
            asset_status: normalizedAssetStatus,
            can_remove: normalizedAssetStatus === 'available',
            status_group: statusGroup,
            status_label: isExpiringSoon ? '即将过期' : statusLabel,
            status_tone: isExpiringSoon ? 'available' : statusTone,
            status_detail: statusDetail,
            benefit_label: formatBenefitLabel(discount),
            scope_type: normalizeClaimText(discount?.scope_type, 40).toLowerCase() || 'all',
            scope_category: normalizeClaimText(discount?.scope_category, 120) || null,
            scope_product_id: normalizeClaimText(discount?.scope_product_id, 160) || null,
            scope_product_sku_id: normalizeClaimText(discount?.scope_product_sku_id, 160) || null,
            scope_product: scopeProduct,
            scope_product_sku: scopeProductSku,
            scoped_product_available: scopedProductAvailability?.available ?? null,
            scoped_product_message: scopedProductAvailability?.message || null,
            scoped_product_preview: scopedProductAvailability?.preview || null,
            scope_label: formatScopeLabel(discount, productById, skuById),
            source_label: formatSourceLabel(asset, discount),
            source_channel: asset.source_channel || null,
            discount_type: discount.discount_type || null,
            discount_value: discount.discount_value == null ? null : Number(discount.discount_value),
            distribution_mode: normalizeDistributionMode(discount.distribution_mode, 'general_code'),
            is_exclusive: stackingPresentation.is_exclusive,
            stack_priority: stackingPresentation.stack_priority,
            pricing_apply_stage: stackingPresentation.pricing_apply_stage,
            stacking_label: stackingPresentation.stacking_label,
            stacking_summary: stackingPresentation.stacking_summary,
            stacking_stage_label: stackingPresentation.stacking_stage_label,
            campaign_tag: discount.campaign_tag || null,
            audience_segment: asset.audience_segment || discount.audience_segment || null,
            assigned_at: asset.assigned_at || null,
            claimed_at: asset.claimed_at || null,
            consumed_at: asset.consumed_at || null,
            restored_at: asset.restored_at || null,
            expires_at: asset.expires_at || null,
            effective_expires_at: effectiveExpiresAt,
            is_expiring_soon: isExpiringSoon,
            lifecycle_key: lifecycle.key,
            lifecycle_label: lifecycle.label,
            lifecycle_detail: lifecycle.detail_text,
            related_order: relatedOrder
                ? {
                    id: relatedOrder.id,
                    created_at: relatedOrder.created_at || null,
                    snapshot_product_name: relatedOrder.snapshot_product_name || '商城订单',
                    discount_amount: Number(relatedOrder.discount_amount || 0) || 0,
                    refund_status: relatedOrder.refund_status || null
                }
                : null,
            saved_amount: savedAmount
        };
    }

    function sortWalletAssets(items = [], bucket = 'available') {
        return (Array.isArray(items) ? items : []).slice().sort((left, right) => {
            if (bucket === 'available') {
                const leftExpiringSoon = left?.is_expiring_soon ? 1 : 0;
                const rightExpiringSoon = right?.is_expiring_soon ? 1 : 0;
                if (rightExpiringSoon !== leftExpiringSoon) {
                    return rightExpiringSoon - leftExpiringSoon;
                }

                const leftExpiry = getSafeTimestamp(left?.effective_expires_at);
                const rightExpiry = getSafeTimestamp(right?.effective_expires_at);
                if (leftExpiry !== rightExpiry) {
                    if (!leftExpiry) return 1;
                    if (!rightExpiry) return -1;
                    return leftExpiry - rightExpiry;
                }
            }

            if (bucket === 'used') {
                const leftUsedAt = getSafeTimestamp(left?.consumed_at || left?.related_order?.created_at);
                const rightUsedAt = getSafeTimestamp(right?.consumed_at || right?.related_order?.created_at);
                if (rightUsedAt !== leftUsedAt) {
                    return rightUsedAt - leftUsedAt;
                }
            }

            const rightAssigned = getSafeTimestamp(right?.assigned_at || right?.claimed_at);
            const leftAssigned = getSafeTimestamp(left?.assigned_at || left?.claimed_at);
            if (rightAssigned !== leftAssigned) {
                return rightAssigned - leftAssigned;
            }

            return normalizeClaimText(left?.code, 80).localeCompare(normalizeClaimText(right?.code, 80));
        });
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

    async function loadUserClaimAssets(supabase, userId, discountId) {
        try {
            const { data, error } = await supabase
                .from('discount_user_assets')
                .select('id, discount_id, user_id, asset_status, assigned_at, claimed_at, consumed_at, expires_at, restored_at, source_type, source_channel, audience_segment, last_order_id')
                .eq('user_id', userId)
                .eq('discount_id', discountId);

            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            if (isMissingRelationError(error, 'discount_user_assets')) {
                const missingError = new Error('优惠券资产表尚未完成迁移，请先执行 P1 SQL');
                missingError.statusCode = 500;
                throw missingError;
            }
            throw error;
        }
    }

    async function countUserClaims(supabase, userId, discountId) {
        const rows = await loadUserClaimAssets(supabase, userId, discountId);
        return rows.length;
    }

    function pickExistingClaimAsset(claimRows = []) {
        return (Array.isArray(claimRows) ? claimRows : [])
            .filter((row) => normalizeClaimText(row?.asset_status, 40).toLowerCase() !== 'revoked')
            .sort((left, right) => {
                const leftAvailable = normalizeClaimText(left?.asset_status, 40).toLowerCase() === 'available' ? 1 : 0;
                const rightAvailable = normalizeClaimText(right?.asset_status, 40).toLowerCase() === 'available' ? 1 : 0;
                if (rightAvailable !== leftAvailable) {
                    return rightAvailable - leftAvailable;
                }

                const leftTime = getDiscountAssetActivityTime(left);
                const rightTime = getDiscountAssetActivityTime(right);
                if (rightTime !== leftTime) {
                    return rightTime - leftTime;
                }

                return normalizeClaimText(right?.id, 160).localeCompare(normalizeClaimText(left?.id, 160));
            })[0] || null;
    }

    async function recordDiscountEvent(supabase, payload = {}) {
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

    function buildClaimSuccessPayload({
        asset = {},
        discount = {},
        claimLimitPerUser = 0,
        existingClaimCount = 0,
        message = '领取成功',
        alreadyClaimed = false
    } = {}) {
        const normalizedClaimLimit = Math.max(0, Number(claimLimitPerUser || 0) || 0);
        const normalizedClaimCount = Math.max(0, Number(existingClaimCount || 0) || 0);
        const remainingClaims = normalizedClaimLimit > 0
            ? Math.max(0, normalizedClaimLimit - normalizedClaimCount)
            : null;

        return {
            success: true,
            message,
            already_claimed: alreadyClaimed,
            asset,
            discount: {
                id: discount.id || null,
                code: discount.code || null,
                campaign_tag: discount.campaign_tag || null,
                claim_limit_per_user: normalizedClaimLimit,
                claimed_count: normalizedClaimCount,
                remaining_claims: remainingClaims
            }
        };
    }

    function buildAlreadyClaimedPayload({ claimRows = [], discount = {} } = {}) {
        const claimLimitPerUser = Math.max(0, Number(discount?.claim_limit_per_user || 0) || 0);
        if (claimLimitPerUser !== 1) {
            return null;
        }

        const existingAsset = pickExistingClaimAsset(claimRows);
        if (!existingAsset) {
            return null;
        }

        return buildClaimSuccessPayload({
            asset: existingAsset,
            discount,
            claimLimitPerUser,
            existingClaimCount: claimRows.length,
            message: '你已领取过该券，可直接使用',
            alreadyClaimed: true
        });
    }

    function canFallbackToLegacyClaimRpc(error) {
        const normalizedMessage = [
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').trim().toLowerCase();

        return isMissingRpcCapabilityError(error)
            || isAmbiguousRpcOverloadError(error, 'fn_claim_public_discount')
            || normalizedMessage.includes('permission denied for function fn_claim_public_discount');
    }

    function buildClaimRpcParams({ discountId = '', discountCode = '', site: currentSite = 'cn', sourceChannel = '' } = {}, userId = '') {
        return {
            p_discount_id: String(discountId || '').trim() || null,
            p_discount_code: String(discountCode || '').trim().toUpperCase() || null,
            p_user_id: String(userId || '').trim() || null,
            p_site: String(currentSite || 'cn').trim() || 'cn',
            p_source_channel: normalizeClaimText(sourceChannel, 80).toLowerCase() || null
        };
    }

    async function executeClaimDiscountRpc({
        discountId = '',
        discountCode = '',
        site: currentSite = 'cn',
        sourceChannel = '',
        userId = '',
        requestSupabase,
        adminSupabase,
        fallbackSupabase
    }) {
        const params = buildClaimRpcParams({
            discountId,
            discountCode,
            site: currentSite,
            sourceChannel
        }, userId);
        const clients = [];
        for (const client of [requestSupabase, adminSupabase, fallbackSupabase]) {
            if (client?.rpc && !clients.includes(client)) {
                clients.push(client);
            }
        }

        let lastError = null;
        for (const client of clients) {
            try {
                const { data, error } = await client.rpc('fn_claim_public_discount', params);
                if (error) {
                    throw error;
                }

                const payload = getRpcSingleRow(data);
                if (payload) {
                    return payload;
                }
            } catch (error) {
                lastError = error;
                if (canFallbackToLegacyClaimRpc(error)) {
                    continue;
                }
                throw error;
            }
        }

        if (lastError && !canFallbackToLegacyClaimRpc(lastError)) {
            throw lastError;
        }

        return null;
    }

    async function recordApplyAttempt(supabase, payload = {}) {
        return recordDiscountEvent(supabase, payload);
    }

    function normalizePurchaseBody(body = {}, headers = {}) {
        const quantityValue = Number(body?.quantity ?? body?.p_quantity ?? 1);
        const quantity = Number.isFinite(quantityValue) ? Math.trunc(quantityValue) : NaN;
        const discountCode = String(body?.discountCode || body?.p_discount_code || '').trim().toUpperCase() || null;
        const discountAssetId = String(body?.discountAssetId || body?.p_discount_asset_id || '').trim() || null;
        const rawProductSkuId = String(
            body?.productSkuId
            || body?.product_sku_id
            || body?.skuId
            || body?.sku_id
            || body?.p_sku_id
            || ''
        ).trim();
        const productSkuId = isUuid(rawProductSkuId) ? rawProductSkuId : null;
        const discountSelections = normalizeDiscountSelectionsInput(body, {
            discountCode,
            discountAssetId
        });

        return {
            productId: String(body?.productId || body?.product_id || '').trim(),
            quantity,
            site: requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' }),
            productSkuId,
            discountCode,
            discountAssetId,
            discountSelections,
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

    async function loadShopProductPurchaseAvailability(dataSupabase, productId = '') {
        const normalizedProductId = normalizeText(productId, 160);
        if (!normalizedProductId || !dataSupabase?.from) {
            return {
                manualDelivery: false,
                product: null
            };
        }

        const selectAttempts = [
            'id, is_active, manual_delivery',
            'id, is_active'
        ];
        let lastError = null;

        for (const selectClause of selectAttempts) {
            const tableQuery = dataSupabase.from('shop_products');
            if (!tableQuery || typeof tableQuery.select !== 'function') {
                return {
                    manualDelivery: false,
                    product: null
                };
            }
            const selectQuery = tableQuery.select(selectClause);
            const idQuery = selectQuery && typeof selectQuery.eq === 'function'
                ? selectQuery.eq('id', normalizedProductId)
                : null;
            if (!idQuery || typeof idQuery.maybeSingle !== 'function') {
                return {
                    manualDelivery: false,
                    product: null
                };
            }
            const { data, error } = await idQuery.maybeSingle();

            if (!error) {
                return {
                    manualDelivery: normalizeBoolean(data?.manual_delivery, false),
                    product: data || null
                };
            }

            lastError = error;
            if (!isMissingColumnError(error, 'manual_delivery')) {
                return {
                    manualDelivery: false,
                    product: null,
                    error
                };
            }
        }

        return {
            manualDelivery: false,
            product: null,
            error: lastError
        };
    }

    function normalizeGuidanceText(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function containsGuidanceCjkText(value) {
        return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
    }

    function normalizeGuidanceSite(value = 'cn') {
        const normalized = String(value || 'cn').trim().toLowerCase();
        return normalized === 'intl' || normalized === 'en' ? 'intl' : 'cn';
    }

    function resolveLocalizedGuidanceText(product = {}, baseField = '', guidanceSite = 'cn') {
        const siteKey = normalizeGuidanceSite(guidanceSite);
        const legacyText = normalizeGuidanceText(product?.[baseField]);
        const zhText = normalizeGuidanceText(product?.[`${baseField}_zh`]);
        const enText = normalizeGuidanceText(product?.[`${baseField}_en`]);

        if (siteKey === 'intl') {
            const candidate = enText || legacyText;
            return containsGuidanceCjkText(candidate) ? '' : candidate;
        }

        return zhText || legacyText || enText;
    }

    function hasProductGuidanceSourceText(product = {}, baseField = '') {
        return [
            product?.[baseField],
            product?.[`${baseField}_zh`],
            product?.[`${baseField}_en`]
        ].some((value) => normalizeGuidanceText(value).length > 0);
    }

    function getProductGuidanceSelectClause({ includeIdentity = false, bilingual = true, purchaseNotes = true } = {}) {
        const fields = includeIdentity ? ['id', 'is_active'] : [];
        if (purchaseNotes) {
            fields.push(
                'show_purchase_notes',
                'purchase_notes',
                ...(bilingual ? ['purchase_notes_zh', 'purchase_notes_en'] : [])
            );
        }
        fields.push(
            'show_usage_instructions',
            'usage_instructions',
            ...(bilingual ? ['usage_instructions_zh', 'usage_instructions_en'] : [])
        );
        return fields.join(', ');
    }

    async function loadProductGuidanceRow(dataSupabase, normalizedProductId, { includeIdentity = false } = {}) {
        const selectAttempts = [
            getProductGuidanceSelectClause({ includeIdentity, bilingual: true, purchaseNotes: true }),
            getProductGuidanceSelectClause({ includeIdentity, bilingual: false, purchaseNotes: true }),
            getProductGuidanceSelectClause({ includeIdentity, bilingual: false, purchaseNotes: false })
        ];

        let lastError = null;
        for (const selectClause of selectAttempts) {
            const query = dataSupabase
                .from('shop_products')
                .select(selectClause)
                .eq('id', normalizedProductId);
            const { data, error } = includeIdentity
                ? await query.single()
                : await query.maybeSingle();

            if (!error) {
                return { data, error: null };
            }

            lastError = error;
            const isGuidanceColumnMissing = [
                'purchase_notes',
                'show_purchase_notes',
                'purchase_notes_zh',
                'purchase_notes_en',
                'usage_instructions_zh',
                'usage_instructions_en'
            ].some((field) => isMissingColumnError(error, field));
            if (!isGuidanceColumnMissing) {
                return { data: null, error };
            }
        }

        return { data: null, error: lastError };
    }

    function buildProductGuidancePayload(product = {}, guidanceSite = 'cn') {
        const showPurchaseNotes = product?.show_purchase_notes === true;
        const showUsageInstructions = product?.show_usage_instructions === true;
        const purchaseNotes = product?.show_purchase_notes
            ? resolveLocalizedGuidanceText(product, 'purchase_notes', guidanceSite)
            : '';
        const usageInstructions = product?.show_usage_instructions
            ? resolveLocalizedGuidanceText(product, 'usage_instructions', guidanceSite)
            : '';

        return {
            product_id: String(product?.id || '').trim() || null,
            show_purchase_notes: showPurchaseNotes,
            show_usage_instructions: showUsageInstructions,
            purchase_notes: purchaseNotes,
            usage_instructions: usageInstructions,
            has_purchase_notes: showPurchaseNotes && hasProductGuidanceSourceText(product, 'purchase_notes'),
            has_usage_instructions: showUsageInstructions && hasProductGuidanceSourceText(product, 'usage_instructions'),
            purchase_notes_needs_translation: showPurchaseNotes && !purchaseNotes && hasProductGuidanceSourceText(product, 'purchase_notes'),
            usage_instructions_needs_translation: showUsageInstructions && !usageInstructions && hasProductGuidanceSourceText(product, 'usage_instructions')
        };
    }

    function buildIdempotencyFingerprint({ userId, payload }) {
        const normalizedSelections = normalizeDiscountSelectionsInput({
            discountSelections: payload?.discountSelections
        }, {
            discountCode: payload?.discountCode,
            discountAssetId: payload?.discountAssetId
        }).map((selection) => ({
            code: selection.code || '',
            assetId: selection.assetId || ''
        }));

        return crypto
            .createHash('sha256')
            .update(JSON.stringify({
                userId: String(userId || ''),
                productId: payload.productId,
                quantity: payload.quantity,
                site: payload.site,
                productSkuId: payload.productSkuId || '',
                discountCode: payload.discountCode || '',
                discountAssetId: payload.discountAssetId || '',
                discountSelections: normalizedSelections,
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

        if (options.includeDiscountAssetId !== false && (payload.discountAssetId || payload.productSkuId)) {
            params.p_discount_asset_id = payload.discountAssetId || null;
        }
        if (payload.productSkuId) {
            params.p_sku_id = payload.productSkuId;
        }

        return params;
    }

    function buildMultiDiscountPurchaseRpcParams(payload = {}, userId = '') {
        const params = {
            p_product_id: payload.productId,
            p_user_id: userId,
            p_site: payload.site,
            p_quantity: payload.quantity,
            p_discount_inputs: (Array.isArray(payload.discountSelections) ? payload.discountSelections : []).map((selection) => {
                const input = {
                    discount_code: selection?.code || null,
                    discount_asset_id: selection?.assetId || null
                };
                if (selection?.scopeProductSkuId) {
                    input.scope_product_sku_id = selection.scopeProductSkuId;
                }
                return input;
            }),
            p_agent_id: payload.agentId
        };
        if (payload.productSkuId) {
            params.p_sku_id = payload.productSkuId;
        }
        return params;
    }

    async function executeMultiDiscountPurchaseRpc({
        payload,
        userId,
        requestSupabase,
        adminSupabase,
        fallbackSupabase
    }) {
        const clients = [];
        for (const client of [requestSupabase, adminSupabase, fallbackSupabase]) {
            if (client?.rpc && !clients.includes(client)) {
                clients.push(client);
            }
        }

        if (!clients.length) {
            const error = new Error('商城购买服务暂时不可用');
            error.statusCode = 503;
            throw error;
        }

        const params = buildMultiDiscountPurchaseRpcParams(payload, userId);
        let lastError = null;

        for (const client of clients) {
            try {
                const { data, error } = await client.rpc('fn_purchase_shop_item_with_discounts', params);
                if (error) {
                    throw error;
                }

                const rpcPayload = getRpcSingleRow(data);
                if (rpcPayload) {
                    return rpcPayload;
                }
            } catch (error) {
                lastError = error;
            }
        }

        if (isMissingRpcCapabilityError(lastError)) {
            const error = new Error('当前数据库尚未启用多券叠加，请先执行最新的 shop discount stacking 迁移');
            error.statusCode = 503;
            throw error;
        }

        if (lastError) {
            throw lastError;
        }

        const error = new Error('多券购买服务未返回结果，请检查 fn_purchase_shop_item_with_discounts RPC 配置');
        error.statusCode = 502;
        throw error;
    }

    async function executePurchaseRpc({
        payload,
        userId,
        requestSupabase,
        adminSupabase,
        fallbackSupabase
    }) {
        const clients = [];
        for (const client of [requestSupabase, adminSupabase, fallbackSupabase]) {
            if (client?.rpc && !clients.includes(client)) {
                clients.push(client);
            }
        }

        if (!clients.length) {
            const error = new Error('商城购买服务暂时不可用');
            error.statusCode = 503;
            throw error;
        }

        const params = buildPurchaseRpcParams(payload, userId, {
            includeDiscountAssetId: Boolean(payload.discountAssetId || payload.productSkuId)
        });
        let lastError = null;

        for (const client of clients) {
            try {
                const { data, error } = await client.rpc('fn_purchase_shop_item', params);
                if (error) {
                    throw error;
                }

                const rpcPayload = getRpcSingleRow(data);
                if (rpcPayload) {
                    return rpcPayload;
                }
            } catch (error) {
                lastError = error;
            }
        }

        if ((payload.discountAssetId || payload.productSkuId) && isMissingRpcCapabilityError(lastError)) {
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

    function normalizeOrderDetailId(body = {}) {
        return String(
            body?.orderId
            || body?.order_id
            || body?.id
            || body?.order
            || ''
        ).trim();
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
    }

    async function loadShopOrderDetail(dataSupabase, { orderId = '', userId = '', site = 'cn' } = {}) {
        const normalizedOrderId = String(orderId || '').trim();
        const normalizedUserId = String(userId || '').trim();

        const { data: order, error: orderError } = await dataSupabase
            .from('shop_orders')
            .select('id, user_id, product_id, inventory_id, snapshot_product_name, created_at, price_paid, total_price, discount_code, discount_amount, discount_snapshot, item_count')
            .eq('id', normalizedOrderId)
            .eq('user_id', normalizedUserId)
            .eq('site', site)
            .single();

        if (orderError || !order) {
            const error = new Error(orderError?.message || '订单不存在或无权访问');
            error.statusCode = orderError?.code === 'PGRST116' ? 404 : (orderError?.statusCode || 404);
            throw error;
        }

        const normalizedProductId = String(order?.product_id || '').trim();
        const normalizedItemCount = Math.max(1, Number(order?.item_count || 1) || 1);
        const needsOrderItems = normalizedItemCount > 1 || !String(order?.inventory_id || '').trim();

        const orderItemsPromise = needsOrderItems
            ? (async () => {
                try {
                    const { data, error } = await dataSupabase
                        .from('shop_order_items')
                        .select('id, inventory_id, snapshot_product_name, price_paid')
                        .eq('order_id', normalizedOrderId)
                        .order('id', { ascending: true });

                    if (error) throw error;
                    return Array.isArray(data) ? data : [];
                } catch (error) {
                    if (!isMissingRelationError(error, 'shop_order_items')) {
                        throw error;
                    }
                    return [];
                }
            })()
            : Promise.resolve([]);

        const guidancePromise = (async () => {
            let purchaseNotes = '';
            let usageInstructions = '';

            if (!isUuid(normalizedProductId)) {
                return { purchaseNotes, usageInstructions };
            }

            const { data: productGuidanceRow, error: productGuidanceError } = await loadProductGuidanceRow(
                dataSupabase,
                normalizedProductId
            );
            if (productGuidanceError) {
                throw productGuidanceError;
            }

            purchaseNotes = productGuidanceRow?.show_purchase_notes
                ? resolveLocalizedGuidanceText(productGuidanceRow, 'purchase_notes', site)
                : '';
            usageInstructions = productGuidanceRow?.show_usage_instructions
                ? resolveLocalizedGuidanceText(productGuidanceRow, 'usage_instructions', site)
                : '';

            return { purchaseNotes, usageInstructions };
        })();

        const [orderItems, guidance] = await Promise.all([
            orderItemsPromise,
            guidancePromise
        ]);

        const inventoryIds = [...new Set(
            [
                ...orderItems.map((item) => String(item?.inventory_id || '').trim()).filter(Boolean),
                String(order?.inventory_id || '').trim()
            ].filter(Boolean)
        )];

        const inventoryContentMap = new Map();
        if (inventoryIds.length) {
            const { data: inventoryRows, error: inventoryError } = await dataSupabase
                .from('shop_inventory')
                .select('id, content')
                .in('id', inventoryIds);

            if (inventoryError) {
                throw inventoryError;
            }

            for (const row of inventoryRows || []) {
                const inventoryId = String(row?.id || '').trim();
                if (!inventoryId) continue;
                inventoryContentMap.set(inventoryId, String(row?.content || ''));
            }
        }

        const purchaseNotes = guidance?.purchaseNotes || '';
        const usageInstructions = guidance?.usageInstructions || '';

        const items = orderItems.length
            ? orderItems.map((item) => {
                const inventoryId = String(item?.inventory_id || '').trim();
                return {
                    id: item?.id || null,
                    inventory_id: inventoryId || null,
                    name: item?.snapshot_product_name || order?.snapshot_product_name || '未知商品',
                    content: inventoryId
                        ? (inventoryContentMap.get(inventoryId) || '')
                        : '',
                    price: Number(item?.price_paid || 0) || 0
                };
            })
            : [{
                id: null,
                inventory_id: String(order?.inventory_id || '').trim() || null,
                name: order?.snapshot_product_name || '未知商品',
                content: inventoryContentMap.get(String(order?.inventory_id || '').trim()) || '',
                price: Number(order?.price_paid || 0) || 0
            }];

        return {
            order: {
                id: order.id,
                created_at: order.created_at || null,
                product_id: order.product_id || null,
                inventory_id: order.inventory_id || null,
                snapshot_product_name: order.snapshot_product_name || '',
                price_paid: Number(order.price_paid || 0) || 0,
                total_price: order.total_price == null ? null : (Number(order.total_price) || 0),
                discount_code: order.discount_code || null,
                discount_amount: Number(order.discount_amount || 0) || 0,
                applied_discounts: Array.isArray(order?.discount_snapshot?.applied_discounts)
                    ? order.discount_snapshot.applied_discounts
                    : [],
                item_count: Math.max(1, Number(order.item_count || items.length || 1) || 1)
            },
            items,
            guidance: {
                purchase_notes: purchaseNotes || null,
                has_purchase_notes: purchaseNotes.length > 0,
                usage_instructions: usageInstructions || null,
                has_usage_instructions: usageInstructions.length > 0
            }
        };
    }

    async function loadProductGuidance(dataSupabase, { productId = '', site = 'cn' } = {}) {
        const normalizedProductId = String(productId || '').trim();
        if (!isUuid(normalizedProductId)) {
            const error = new Error('商品标识格式不正确');
            error.statusCode = 400;
            throw error;
        }

        const { data, error } = await loadProductGuidanceRow(dataSupabase, normalizedProductId, {
            includeIdentity: true
        });

        if (error || !data) {
            const notFoundError = new Error(error?.message || '商品不存在');
            notFoundError.statusCode = error?.code === 'PGRST116' ? 404 : (error?.statusCode || 404);
            throw notFoundError;
        }

        if (data.is_active === false) {
            const inactiveError = new Error('商品未上架');
            inactiveError.statusCode = 404;
            throw inactiveError;
        }

        return buildProductGuidancePayload(data, site);
    }

    return {
        catalog: async function catalogHandler(req, res) {
            const startedAt = Date.now();
            let currentSite = 'cn';
            let category = 'all';
            let cacheStatus = 'miss';
            let loadMs = 0;

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.setHeader('Allow', 'GET, HEAD');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }

            try {
                const adminSupabase = getOptionalSupabaseAdmin();
                if (!adminSupabase) {
                    applyHotCacheResponseHeaders(res, {
                        label: 'shop-catalog',
                        status: 'error',
                        totalMs: Math.max(0, Date.now() - startedAt),
                        loadMs
                    });
                    return sendJson(res, 503, {
                        success: false,
                        code: 'shop_catalog_unavailable',
                        message: '商城数据暂时不可用，请稍后刷新重试'
                    });
                }

                const requestUrl = new URL(req.url || '/', 'http://localhost');
                currentSite = requireSupportedSite(requestUrl.searchParams.get('site') || 'cn', {
                    fieldName: 'site'
                });
                category = normalizeShopCatalogCategory(requestUrl.searchParams.get('category') || 'all');
                const bypassHotCache = shouldBypassShopCatalogHotCache(req, requestUrl);
                const cacheKey = buildShopCatalogCacheKey({
                    site: currentSite,
                    category
                });
                const loadStartedAt = Date.now();
                const cachedResult = await shopCatalogCache.getOrLoad(cacheKey, async () => {
                    const allCategories = await loadShopCategoriesForCatalog(adminSupabase);
                    const categories = allCategories.filter((category) => isPublicShopCategory(category));
                    const hiddenCategoryNames = getHiddenShopCategoryNames(allCategories);
                    const products = await loadPublicShopProducts(adminSupabase, {
                        category,
                        currentSite,
                        hiddenCategoryNames
                    });

                    return {
                        success: true,
                        site: currentSite,
                        category,
                        categories,
                        products,
                        data: {
                            categories,
                            products
                        }
                    };
                }, {
                    forceRefresh: bypassHotCache
                });
                loadMs = Math.max(0, Date.now() - loadStartedAt);
                cacheStatus = cachedResult.status;

                res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
                res.setHeader('CDN-Cache-Control', 'max-age=300, stale-while-revalidate=86400');
                res.setHeader('Vercel-CDN-Cache-Control', 'max-age=300, stale-while-revalidate=86400');
                const totalMs = Math.max(0, Date.now() - startedAt);
                applyHotCacheResponseHeaders(res, {
                    label: 'shop-catalog',
                    status: cacheStatus,
                    totalMs,
                    loadMs
                });
                maybeLogSlowShopCatalogRequest({
                    env,
                    site: currentSite,
                    category,
                    statusCode: 200,
                    cacheStatus,
                    totalMs
                });
                return sendJson(res, 200, cachedResult.value);
            } catch (error) {
                console.warn('[ShopCatalog] Failed to load public catalog:', error?.message || error);
                const totalMs = Math.max(0, Date.now() - startedAt);
                applyHotCacheResponseHeaders(res, {
                    label: 'shop-catalog',
                    status: cacheStatus === 'miss' ? 'error' : cacheStatus,
                    totalMs,
                    loadMs
                });
                maybeLogSlowShopCatalogRequest({
                    env,
                    site: currentSite,
                    category,
                    statusCode: error.statusCode || 503,
                    cacheStatus: cacheStatus === 'miss' ? 'error' : cacheStatus,
                    totalMs
                });
                return sendJson(res, error.statusCode || 503, {
                    success: false,
                    code: 'shop_catalog_unavailable',
                    message: '商城数据暂时不可用，请稍后刷新重试'
                });
            }
        },
        'available-discounts': async function availableDiscountsHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }
            setPrivateApiCache(res);

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
                const rawProductSkuId = String(
                    body?.productSkuId
                    || body?.product_sku_id
                    || body?.skuId
                    || body?.sku_id
                    || body?.p_sku_id
                    || ''
                ).trim();
                const productSkuId = isUuid(rawProductSkuId) ? rawProductSkuId : null;
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
                const visibleOwnedAssets = suppressExcessPublicClaimAssets(ownedAssets, discountMap);
                const publicClaimDiscounts = (await loadPublicClaimDiscounts(dataSupabase))
                    .filter((discount) => matchesApplicableSite(discount, currentSite))
                    .filter((discount) => isClaimWindowOpen(discount, new Date()));
                const scopedProductById = await loadShopProductsByIds(
                    dataSupabase,
                    [...masterDiscountRows, ...publicClaimDiscounts]
                        .filter((row) => normalizeClaimText(row?.scope_type, 40).toLowerCase() === 'product')
                        .map((row) => row?.scope_product_id)
                );
                const scopedSkuById = await loadShopProductSkusByIds(
                    dataSupabase,
                    [...masterDiscountRows, ...publicClaimDiscounts]
                        .filter((row) => normalizeClaimText(row?.scope_type, 40).toLowerCase() === 'product')
                        .map((row) => row?.scope_product_sku_id)
                );

                const ownedDiscounts = [];
                for (const asset of visibleOwnedAssets) {
                    const masterDiscount = discountMap.get(normalizeText(asset?.discount_id, 160));
                    if (!masterDiscount) continue;
                    if (!matchesApplicableSite(masterDiscount, currentSite)) continue;

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
                            productSkuId,
                            agentId
                        });
                        if (payload?.success === false) {
                            available = false;
                            preview = payload?.data || null;
                            message = String(payload?.message || '当前不可用');
                        } else {
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
                        benefit_label: formatBenefitLabel(masterDiscount),
                        ...buildDiscountScopePayload(masterDiscount, scopedProductById, scopedSkuById),
                        discount_type: masterDiscount.discount_type || null,
                        discount_value: masterDiscount.discount_value == null ? null : Number(masterDiscount.discount_value),
                        distribution_mode: normalizeDistributionMode(masterDiscount.distribution_mode, 'general_code'),
                        ...buildDiscountStackingPresentation(masterDiscount),
                        source_label: formatSourceLabel(asset, masterDiscount),
                        source_channel: asset.source_channel || null,
                        campaign_tag: masterDiscount.campaign_tag || null,
                        audience_segment: asset.audience_segment || null,
                        expires_at: asset.expires_at || masterDiscount.expires_at || null,
                        available,
                        message,
                        preview
                    });
                }

                const claimCounts = await loadUserClaimCounts(dataSupabase, user.id, publicClaimDiscounts.map((discount) => discount?.id));
                const claimableDiscounts = publicClaimDiscounts
                    .map((discount) => {
                        const alreadyClaimedCount = Math.max(0, Number(claimCounts.get(normalizeText(discount?.id, 160)) || 0));
                        const claimLimitPerUser = Math.max(0, Number(discount?.claim_limit_per_user || 0));
                        const canClaim = claimLimitPerUser <= 0 || alreadyClaimedCount < claimLimitPerUser;
                        return {
                            discount_id: discount.id,
                            code: discount.code,
                            benefit_label: formatBenefitLabel(discount),
                            ...buildDiscountScopePayload(discount, scopedProductById, scopedSkuById),
                            discount_type: discount.discount_type || null,
                            discount_value: discount.discount_value == null ? null : Number(discount.discount_value),
                            distribution_mode: 'public_claim',
                            ...buildDiscountStackingPresentation(discount),
                            source_label: formatSourceLabel({}, discount),
                            campaign_tag: discount.campaign_tag || null,
                            audience_segment: discount.audience_segment || null,
                            claim_starts_at: discount.claim_starts_at || null,
                            claim_expires_at: discount.claim_expires_at || null,
                            claim_limit_per_user: claimLimitPerUser,
                            already_claimed_count: alreadyClaimedCount,
                            can_claim: canClaim,
                            message: '领取后即可在结算时直接选择'
                        };
                    })
                    .filter((discount) => discount.can_claim);

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
        'my-discount-assets': async function myDiscountAssetsHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }
            setPrivateApiCache(res);

            const clientIp = resolveClientIp(req, { env }) || 'unknown';
            const rateLimit = await takeRateLimitToken({
                supabase: getOptionalSupabaseAdmin(),
                key: `shop-my-discount-assets:${clientIp}`,
                limit: Math.max(1, Number(env.SHOP_DISCOUNT_ASSETS_RATE_LIMIT_MAX || 16)),
                windowMs: Math.max(10_000, Number(env.SHOP_DISCOUNT_ASSETS_RATE_LIMIT_WINDOW_MS || 60_000))
            });
            applyRateLimitHeaders(res, rateLimit);
            if (!rateLimit.allowed) {
                return sendJson(res, 429, {
                    success: false,
                    code: 'rate_limited',
                    message: '卡券列表请求过于频繁，请稍后重试',
                    retry_after_seconds: rateLimit.retryAfterSeconds
                });
            }

            try {
                const { supabase, requestSupabase, adminSupabase, user } = await requireAuthenticatedUser(req);
                const body = await parseJsonBody(req);
                const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
                const dataSupabase = adminSupabase || supabase;
                const now = new Date();

                const userAssets = await loadAllUserAssets(dataSupabase, user.id);
                const discountRows = await loadDiscountRowsByIds(dataSupabase, userAssets.map((asset) => asset?.discount_id));
                const discountMap = new Map(
                    discountRows
                        .filter((row) => matchesApplicableSite(row, currentSite))
                        .map((row) => [normalizeText(row?.id, 160), row])
                );
                const visibleUserAssets = suppressExcessPublicClaimAssets(userAssets, discountMap);
                const scopedAssets = visibleUserAssets.filter((asset) => discountMap.has(normalizeText(asset?.discount_id, 160)));
                const scopedProductIds = Array.from(discountMap.values())
                    .filter((row) => normalizeClaimText(row?.scope_type, 40).toLowerCase() === 'product')
                    .map((row) => row?.scope_product_id);
                const scopedSkuIds = Array.from(discountMap.values())
                    .filter((row) => normalizeClaimText(row?.scope_type, 40).toLowerCase() === 'product')
                    .map((row) => row?.scope_product_sku_id);
                const [orderByAssetId, productById, skuById] = await Promise.all([
                    loadShopOrdersByDiscountAssets(dataSupabase, scopedAssets),
                    loadShopProductsByIds(dataSupabase, scopedProductIds),
                    loadShopProductSkusByIds(dataSupabase, scopedSkuIds)
                ]);
                const scopedProductAvailabilityByAsset = await loadScopedProductAvailabilityByAsset(requestSupabase || supabase, {
                    userId: user.id,
                    site: currentSite,
                    assets: scopedAssets,
                    discountMap,
                    productById,
                    skuById
                });

                const availableAssets = [];
                const usedAssets = [];
                const inactiveAssets = [];

                for (const asset of scopedAssets) {
                    const discount = discountMap.get(normalizeText(asset?.discount_id, 160));
                    if (!discount) continue;

                    const payload = buildWalletAssetCard(
                        asset,
                        discount,
                        orderByAssetId,
                        productById,
                        skuById,
                        now,
                        {
                            scopedProductAvailability: scopedProductAvailabilityByAsset.get(normalizeText(asset?.id, 160)) || null
                        }
                    );
                    if (payload.status_group === 'available') {
                        availableAssets.push(payload);
                    } else if (payload.status_group === 'used') {
                        usedAssets.push(payload);
                    } else {
                        inactiveAssets.push(payload);
                    }
                }

                const sortedAvailableAssets = sortWalletAssets(availableAssets, 'available');
                const sortedUsedAssets = sortWalletAssets(usedAssets, 'used');
                const sortedInactiveAssets = sortWalletAssets(inactiveAssets, 'inactive');
                const allAssets = [
                    ...sortedAvailableAssets,
                    ...sortedUsedAssets,
                    ...sortedInactiveAssets
                ];

                return sendJson(res, 200, {
                    success: true,
                    site: currentSite,
                    summary: {
                        total_count: allAssets.length,
                        available_count: sortedAvailableAssets.length,
                        used_count: sortedUsedAssets.length,
                        inactive_count: sortedInactiveAssets.length,
                        expiring_soon_count: sortedAvailableAssets.filter((asset) => asset?.is_expiring_soon).length,
                        saved_amount_total: allAssets.reduce((sum, asset) => sum + (Number(asset?.saved_amount || 0) || 0), 0)
                    },
                    available_assets: sortedAvailableAssets,
                    used_assets: sortedUsedAssets,
                    inactive_assets: sortedInactiveAssets
                });
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '加载我的卡券失败'
                });
            }
        },
        'remove-discount-asset': async function removeDiscountAssetHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }
            setPrivateApiCache(res);

            try {
                const { supabase, adminSupabase, user } = await requireAuthenticatedUser(req);
                const body = await parseJsonBody(req);
                const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
                const assetId = normalizeClaimText(body?.assetId || body?.asset_id, 160);

                if (!assetId) {
                    const error = new Error('assetId is required');
                    error.statusCode = 400;
                    throw error;
                }

                const dataSupabase = adminSupabase || supabase;
                const asset = await loadUserAssetById(dataSupabase, user.id, assetId);
                const discount = (await loadDiscountRowsByIds(dataSupabase, [asset.discount_id]))[0] || null;

                if (!discount || !matchesApplicableSite(discount, currentSite)) {
                    const error = new Error('未找到这张卡券');
                    error.statusCode = 404;
                    throw error;
                }

                const assetStatus = normalizeClaimText(asset?.asset_status, 40).toLowerCase() || 'available';
                if (assetStatus !== 'available') {
                    const error = new Error('当前卡券不能删除');
                    error.statusCode = 409;
                    throw error;
                }

                const removedAt = new Date().toISOString();
                const { error: updateError } = await dataSupabase
                    .from('discount_user_assets')
                    .update({
                        asset_status: 'revoked',
                        updated_at: removedAt
                    })
                    .eq('id', asset.id)
                    .eq('user_id', user.id)
                    .eq('asset_status', 'available');

                if (updateError) {
                    throw updateError;
                }

                try {
                    await recordDiscountEvent(dataSupabase, {
                        discount_id: discount.id,
                        user_id: user.id,
                        discount_asset_id: asset.id,
                        order_id: null,
                        event_type: 'wallet_remove',
                        site: currentSite,
                        source_channel: asset.source_channel || null,
                        event_source: 'wallet_modal',
                        audience_segment: asset.audience_segment || discount.audience_segment || null,
                        created_at: removedAt
                    });
                } catch (auditError) {
                    console.warn('[Shop] Failed to record wallet discount removal event:', auditError?.message || auditError);
                }

                return sendJson(res, 200, {
                    success: true,
                    message: '卡券已删除',
                    asset_id: asset.id,
                    asset_status: 'revoked',
                    removed_at: removedAt
                });
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '删除卡券失败'
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
            setPrivateApiCache(res);

            try {
                const { supabase, requestSupabase, adminSupabase, user } = await requireAuthenticatedUser(req);
                const body = await parseJsonBody(req);
                const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
                const dataSupabase = adminSupabase || supabase;
                const sourceChannel = normalizeClaimText(body?.sourceChannel || body?.source_channel, 80).toLowerCase() || 'claim_center';
                const claimLookup = {
                    id: body?.discountId || body?.discount_id,
                    code: body?.discountCode || body?.discount_code
                };
                const rpcPayload = await executeClaimDiscountRpc({
                    discountId: claimLookup.id,
                    discountCode: claimLookup.code,
                    site: currentSite,
                    sourceChannel,
                    userId: user.id,
                    requestSupabase: requestSupabase || supabase,
                    adminSupabase,
                    fallbackSupabase: dataSupabase
                });

                if (rpcPayload && rpcPayload.success === false) {
                    const rpcStatusCode = Math.max(400, Number(rpcPayload?.status_code || 409) || 409);
                    const rpcMessage = normalizeClaimText(rpcPayload?.message, 160);
                    if (rpcStatusCode === 409 && rpcMessage.includes('领取上限')) {
                        try {
                            const discount = await loadClaimDiscount(dataSupabase, claimLookup);
                            const claimRows = await loadUserClaimAssets(dataSupabase, user.id, discount.id);
                            const alreadyClaimedPayload = buildAlreadyClaimedPayload({ claimRows, discount });
                            if (alreadyClaimedPayload) {
                                return sendJson(res, 200, alreadyClaimedPayload);
                            }
                        } catch (alreadyClaimedError) {
                            console.warn('[Shop] Failed to resolve repeated claim gracefully:', alreadyClaimedError.message);
                        }
                    }
                    return sendJson(res, rpcStatusCode, rpcPayload);
                }

                if (rpcPayload && rpcPayload.success === true) {
                    const claimedAsset = rpcPayload?.asset && typeof rpcPayload.asset === 'object' && !Array.isArray(rpcPayload.asset)
                        ? rpcPayload.asset
                        : null;
                    const claimedDiscount = rpcPayload?.discount && typeof rpcPayload.discount === 'object' && !Array.isArray(rpcPayload.discount)
                        ? rpcPayload.discount
                        : null;

                    if (claimedAsset?.id && claimedDiscount?.id) {
                        await recordDiscountEvent(dataSupabase, {
                            discount_id: claimedDiscount.id,
                            user_id: user.id,
                            discount_asset_id: claimedAsset.id,
                            order_id: null,
                            event_type: 'claim',
                            site: currentSite,
                            source_channel: claimedAsset.source_channel || sourceChannel,
                            event_source: 'shop_claim_center',
                            audience_segment: claimedAsset.audience_segment || claimedDiscount.audience_segment || 'public_claim',
                            created_at: claimedAsset.claimed_at || new Date().toISOString()
                        });
                    }

                    if (rpcPayload?.already_claimed !== true) {
                        try {
                            await notifyUsers(dataSupabase, {
                                userIds: [user.id],
                                ...buildDiscountUserNotificationPayload({
                                    action: 'claim',
                                    asset: claimedAsset || {},
                                    discount: claimedDiscount || {}
                                })
                            });
                        } catch (notificationError) {
                            console.warn('[Shop] Failed to notify claimed discount recipient:', notificationError.message || notificationError);
                        }
                    }

                    return sendJson(res, 200, rpcPayload);
                }

                const discount = await loadClaimDiscount(dataSupabase, claimLookup);

                if (normalizeClaimText(discount?.distribution_mode, 40).toLowerCase() !== 'public_claim') {
                    return sendJson(res, 409, {
                        success: false,
                        message: '该优惠券当前不支持公开领取'
                    });
                }

                if (!matchesApplicableSite(discount, currentSite)) {
                    return sendJson(res, 409, {
                        success: false,
                        message: '当前站点下不可领取该优惠券'
                    });
                }

                assertClaimWindowOpen(discount, new Date());

                const claimLimitPerUser = Math.max(0, Number(discount?.claim_limit_per_user || 0));
                const existingClaimRows = await loadUserClaimAssets(dataSupabase, user.id, discount.id);
                const existingClaimCount = existingClaimRows.length;
                if (claimLimitPerUser > 0 && existingClaimCount >= claimLimitPerUser) {
                    const alreadyClaimedPayload = buildAlreadyClaimedPayload({
                        claimRows: existingClaimRows,
                        discount
                    });
                    if (alreadyClaimedPayload) {
                        return sendJson(res, 200, alreadyClaimedPayload);
                    }
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
                    source_channel: sourceChannel,
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

                await recordDiscountEvent(dataSupabase, {
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

                try {
                    await notifyUsers(dataSupabase, {
                        userIds: [user.id],
                        ...buildDiscountUserNotificationPayload({
                            action: 'claim',
                            asset: data,
                            discount
                        })
                    });
                } catch (notificationError) {
                    console.warn('[Shop] Failed to notify claimed discount recipient:', notificationError.message || notificationError);
                }

                return sendJson(res, 200, {
                    ...buildClaimSuccessPayload({
                        asset: data,
                        discount,
                        claimLimitPerUser,
                        existingClaimCount: existingClaimCount + 1
                    })
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
            setPrivateApiCache(res);

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
                const quantityValue = Number(body?.quantity ?? body?.p_quantity ?? 1);
                const quantity = Number.isFinite(quantityValue) ? Math.max(1, Math.trunc(quantityValue)) : 1;
                const currentSite = requireSupportedSite(body?.site || body?.p_site || 'cn', { fieldName: 'site' });
                const agentId = String(body?.agentId || body?.agent_id || '').trim() || null;
                const rawProductSkuId = String(
                    body?.productSkuId
                    || body?.product_sku_id
                    || body?.skuId
                    || body?.sku_id
                    || body?.p_sku_id
                    || ''
                ).trim();
                const productSkuId = isUuid(rawProductSkuId) ? rawProductSkuId : null;
                const discountSelections = normalizeDiscountSelectionsInput(body);

                if (!productId) {
                    return sendJson(res, 400, {
                        success: false,
                        message: '缺少商品标识'
                    });
                }

                if (!discountSelections.length) {
                    return sendJson(res, 400, {
                        success: false,
                        message: '请输入优惠码'
                    });
                }

                const previewResult = await buildDiscountSelectionPreview(requestSupabase || supabase, {
                    productId,
                    userId: user.id,
                    site: currentSite,
                    quantity,
                    selections: discountSelections,
                    productSkuId,
                    agentId
                });

                if (!previewResult?.success) {
                    return sendJson(res, previewResult?.statusCode || 400, {
                        success: false,
                        message: previewResult?.message || '优惠码验证失败'
                    });
                }

                const payload = previewResult.payload;
                const responseData = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
                    ? payload.data
                    : {};
                const pricingWaterfall = buildPricingWaterfall({
                    ...responseData,
                    applied_discounts: responseData.applied_discounts || [],
                    discount_code: responseData.discount_code || null,
                    discount_asset_id: responseData.discount_asset_id || null
                }, {
                    quantity
                });
                payload.data = {
                    ...responseData,
                    benefit_label: responseData.benefit_label || buildCombinedBenefitLabel(
                        Array.isArray(responseData.applied_discounts) ? responseData.applied_discounts : [],
                        responseData.discount_amount
                    ),
                    pricing_waterfall: pricingWaterfall.rows,
                    stacking_policy: pricingWaterfall.stacking_policy
                };

                for (const selection of discountSelections.filter((item) => item?.assetId)) {
                    await recordApplyAttempt(adminSupabase || supabase, {
                        discount_id: String(
                            (payload?.data?.applied_discounts || []).find((item) => String(item?.asset_id || '').trim() === selection.assetId)?.discount_id
                            || payload?.data?.discount_id
                            || ''
                        ).trim() || null,
                        user_id: user.id,
                        discount_asset_id: selection.assetId,
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
        'order-detail': async function orderDetailHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }
            setPrivateApiCache(res);

            const adminSupabase = getOptionalSupabaseAdmin();
            const clientIp = resolveClientIp(req, { env }) || 'unknown';
            const ipRateLimit = await takeRateLimitToken({
                supabase: adminSupabase,
                key: `shop-order-detail:ip:${clientIp}`,
                limit: Math.max(1, Number(env.SHOP_ORDER_DETAIL_RATE_LIMIT_MAX || 40)),
                windowMs: Math.max(10_000, Number(env.SHOP_ORDER_DETAIL_RATE_LIMIT_WINDOW_MS || 60_000))
            });
            applyRateLimitHeaders(res, ipRateLimit);
            if (!ipRateLimit.allowed) {
                return sendJson(res, 429, {
                    success: false,
                    code: 'rate_limited',
                    message: '订单详情请求过于频繁，请稍后重试',
                    retry_after_seconds: ipRateLimit.retryAfterSeconds
                });
            }

            try {
                const { supabase, adminSupabase: requestAdminSupabase, user } = await requireAuthenticatedUser(req);
                const body = await parseJsonBody(req);
                const orderId = normalizeOrderDetailId(body);
                const currentSite = requireSupportedSite(body?.site || 'cn', { fieldName: 'site' });

                if (!isUuid(orderId)) {
                    return sendJson(res, 400, {
                        success: false,
                        message: '订单号格式不正确'
                    });
                }

                const userRateLimit = await takeRateLimitToken({
                    supabase: adminSupabase,
                    key: `shop-order-detail:user:${user.id}`,
                    limit: Math.max(1, Number(env.SHOP_ORDER_DETAIL_USER_RATE_LIMIT_MAX || 24)),
                    windowMs: Math.max(10_000, Number(env.SHOP_ORDER_DETAIL_USER_RATE_LIMIT_WINDOW_MS || 60_000))
                });
                applyRateLimitHeaders(res, userRateLimit);
                if (!userRateLimit.allowed) {
                    return sendJson(res, 429, {
                        success: false,
                        code: 'rate_limited',
                        message: '查看订单详情过于频繁，请稍后重试',
                        retry_after_seconds: userRateLimit.retryAfterSeconds
                    });
                }

                const data = await loadShopOrderDetail(requestAdminSupabase || supabase, {
                    orderId,
                    userId: user.id,
                    site: currentSite
                });

                return sendJson(res, 200, {
                    success: true,
                    data
                });
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '加载订单详情失败'
                });
            }
        },
        'product-guidance': async function productGuidanceHandler(req, res) {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return sendJson(res, 405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }
            setPrivateApiCache(res);

            const adminSupabase = getOptionalSupabaseAdmin();
            const clientIp = resolveClientIp(req, { env }) || 'unknown';
            const ipRateLimit = await takeRateLimitToken({
                supabase: adminSupabase,
                key: `shop-product-guidance:ip:${clientIp}`,
                limit: Math.max(1, Number(env.SHOP_PRODUCT_GUIDANCE_RATE_LIMIT_MAX || 40)),
                windowMs: Math.max(10_000, Number(env.SHOP_PRODUCT_GUIDANCE_RATE_LIMIT_WINDOW_MS || 60_000))
            });
            applyRateLimitHeaders(res, ipRateLimit);
            if (!ipRateLimit.allowed) {
                return sendJson(res, 429, {
                    success: false,
                    code: 'rate_limited',
                    message: '商品说明请求过于频繁，请稍后重试',
                    retry_after_seconds: ipRateLimit.retryAfterSeconds
                });
            }

            try {
                const body = await parseJsonBody(req);
                const productId = String(body?.productId || body?.product_id || '').trim();
                const currentSite = requireSupportedSite(body?.site || 'cn', { fieldName: 'site' });
                const dataSupabase = adminSupabase;
                if (!dataSupabase) {
                    return sendJson(res, 503, {
                        success: false,
                        message: '商品说明服务暂时不可用'
                    });
                }

                const data = await loadProductGuidance(dataSupabase, {
                    productId,
                    site: currentSite
                });

                return sendJson(res, 200, {
                    success: true,
                    data
                });
            } catch (error) {
                return sendJson(res, error.statusCode || 500, {
                    success: false,
                    message: error.message || '加载商品说明失败'
                });
            }
        },
        purchase: async function purchaseHandler(req, res) {
            const timingTracker = createServerTimingTracker();
            const respond = (statusCode, payload, context = {}) => {
                const timingSummary = applyServerTimingHeader(res, timingTracker);
                maybeLogSlowPurchaseTiming(timingSummary, {
                    ...context,
                    statusCode,
                    success: payload?.success !== false
                });
                return sendJson(res, statusCode, payload);
            };

            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                return respond(405, {
                    success: false,
                    message: 'Method not allowed'
                });
            }
            setPrivateApiCache(res);

            const adminSupabase = getOptionalSupabaseAdmin();
            const clientIp = resolveClientIp(req, { env }) || 'unknown';
            const ipRateLimitStartedAt = Date.now();
            const ipRateLimit = await takeRateLimitToken({
                supabase: adminSupabase,
                key: `shop-purchase:ip:${clientIp}`,
                limit: Math.max(1, Number(env.SHOP_PURCHASE_RATE_LIMIT_MAX || 12)),
                windowMs: Math.max(10_000, Number(env.SHOP_PURCHASE_RATE_LIMIT_WINDOW_MS || 60_000))
            });
            recordServerTimingPhase(timingTracker, 'shop-purchase-iplimit', ipRateLimitStartedAt);
            applyRateLimitHeaders(res, ipRateLimit);
            if (!ipRateLimit.allowed) {
                return respond(429, {
                    success: false,
                    code: 'rate_limited',
                    message: '商城购买请求过于频繁，请稍后重试',
                    retry_after_seconds: ipRateLimit.retryAfterSeconds
                });
            }

            try {
                const authStartedAt = Date.now();
                const authPromise = (async () => {
                    try {
                        return await requireAuthenticatedUser(req);
                    } finally {
                        recordServerTimingPhase(timingTracker, 'shop-purchase-auth', authStartedAt);
                    }
                })();
                const prepareStartedAt = Date.now();
                const bodyPromise = parseJsonBody(req);
                const [{ supabase, requestSupabase, adminSupabase: requestAdminSupabase, user }, body] = await Promise.all([
                    authPromise,
                    bodyPromise
                ]);
                const payload = normalizePurchaseBody(body, req.headers || {});
                payload.discountSelections = normalizeDiscountSelectionsInput({
                    discountSelections: payload.discountSelections
                }, {
                    discountCode: payload.discountCode,
                    discountAssetId: payload.discountAssetId
                });
                if (payload.discountSelections.length === 1) {
                    payload.discountCode = payload.discountSelections[0].code || null;
                    payload.discountAssetId = payload.discountSelections[0].assetId || null;
                }
                recordServerTimingPhase(timingTracker, 'shop-purchase-prepare', prepareStartedAt);

                if (!payload.productId) {
                    return respond(400, {
                        success: false,
                        message: '缺少商品标识'
                    }, {
                        userId: user.id,
                        productId: payload.productId
                    });
                }

                if (!Number.isInteger(payload.quantity) || payload.quantity < 1) {
                    return respond(400, {
                        success: false,
                        message: '购买数量必须大于0'
                    }, {
                        userId: user.id,
                        productId: payload.productId
                    });
                }

                const availabilityStartedAt = Date.now();
                const availabilityClient = requestAdminSupabase || adminSupabase || supabase;
                const purchaseAvailability = await loadShopProductPurchaseAvailability(availabilityClient, payload.productId);
                recordServerTimingPhase(timingTracker, 'shop-purchase-availability', availabilityStartedAt);
                if (purchaseAvailability.manualDelivery === true) {
                    return respond(409, {
                        success: false,
                        code: 'manual_delivery_unavailable',
                        message: '该商品为人工发货，暂不支持自助兑换'
                    }, {
                        userId: user.id,
                        productId: payload.productId
                    });
                }

                const idempotencyFingerprint = buildIdempotencyFingerprint({
                    userId: user.id,
                    payload
                });
                const userRateLimitStartedAt = Date.now();
                const userRateLimitPromise = (async () => {
                    try {
                        return await takeRateLimitToken({
                            supabase: adminSupabase,
                            key: `shop-purchase:user:${user.id}`,
                            limit: Math.max(1, Number(env.SHOP_PURCHASE_USER_RATE_LIMIT_MAX || 8)),
                            windowMs: Math.max(10_000, Number(env.SHOP_PURCHASE_USER_RATE_LIMIT_WINDOW_MS || 60_000))
                        });
                    } finally {
                        recordServerTimingPhase(timingTracker, 'shop-purchase-userlimit', userRateLimitStartedAt);
                    }
                })();
                const idempotencyStartedAt = Date.now();
                const idempotencyPromise = (async () => {
                    try {
                        return await takeRateLimitToken({
                            supabase: adminSupabase,
                            key: `shop-purchase:idempotency:${user.id}:${idempotencyFingerprint}`,
                            limit: 1,
                            windowMs: Math.max(10_000, Number(env.SHOP_PURCHASE_IDEMPOTENCY_WINDOW_MS || 90_000))
                        });
                    } finally {
                        recordServerTimingPhase(timingTracker, 'shop-purchase-idempotency', idempotencyStartedAt);
                    }
                })();
                const [userRateLimit, idempotencyResult] = await Promise.all([
                    userRateLimitPromise,
                    idempotencyPromise
                ]);
                applyRateLimitHeaders(res, userRateLimit);
                if (!userRateLimit.allowed) {
                    return respond(429, {
                        success: false,
                        code: 'rate_limited',
                        message: '下单过于频繁，请稍后重试',
                        retry_after_seconds: userRateLimit.retryAfterSeconds
                    }, {
                        userId: user.id,
                        productId: payload.productId
                    });
                }
                if (!idempotencyResult.allowed) {
                    return respond(409, {
                        success: false,
                        code: 'duplicate_submission',
                        message: '请勿重复提交订单，请稍候刷新后查看结果',
                        retry_after_seconds: idempotencyResult.retryAfterSeconds
                    }, {
                        userId: user.id,
                        productId: payload.productId
                    });
                }

                let responsePayload = null;
                const rpcPhaseName = payload.discountSelections.length > 1
                    ? 'shop-purchase-rpc-multidiscount'
                    : 'shop-purchase-rpc';
                const rpcStartedAt = Date.now();
                try {
                    responsePayload = payload.discountSelections.length > 1
                        ? await executeMultiDiscountPurchaseRpc({
                            payload,
                            userId: user.id,
                            requestSupabase,
                            adminSupabase,
                            fallbackSupabase: supabase
                        })
                        : await executePurchaseRpc({
                            payload,
                            userId: user.id,
                            requestSupabase,
                            adminSupabase,
                            fallbackSupabase: supabase
                        });
                } finally {
                    recordServerTimingPhase(timingTracker, rpcPhaseName, rpcStartedAt);
                }
                if (!responsePayload || responsePayload.success === false) {
                    return respond(400, responsePayload || {
                        success: false,
                        message: '商城购买服务未返回结果，请检查 fn_purchase_shop_item RPC 配置'
                    }, {
                        userId: user.id,
                        productId: payload.productId
                    });
                }

                const responseData = responsePayload?.data && typeof responsePayload.data === 'object' && !Array.isArray(responsePayload.data)
                    ? responsePayload.data
                    : {};
                const orderId = normalizeText(responseData.order_id || responseData.id, 160);
                const systemSupabase = requestAdminSupabase || adminSupabase || supabase;
                const responseUsageInstructions = normalizeGuidanceText(responseData.usage_instructions);
                const responseHasUsageInstructions = responseData.show_usage_instructions === true
                    || Boolean(responseUsageInstructions);
                const pricingWaterfall = buildPricingWaterfall({
                    ...responseData,
                    applied_discounts: responseData.applied_discounts || [],
                    discount_code: responseData.discount_code || payload.discountCode,
                    discount_asset_id: payload.discountAssetId || responseData.discount_asset_id || null
                }, {
                    quantity: payload.quantity
                });
                const benefitLabel = buildCombinedBenefitLabel(
                    Array.isArray(responseData.applied_discounts) ? responseData.applied_discounts : [{
                        discount_type: responseData.discount_type,
                        discount_value: responseData.discount_value,
                        code: responseData.discount_code || payload.discountCode
                    }],
                    responseData.discount_amount
                );
                const followupsStartedAt = Date.now();
                scheduleShopPurchaseFollowups(async () => {
                    await safeProcessShopPurchaseRewards(systemSupabase, {
                        orderId,
                        site: payload.site
                    });

                    await Promise.all([
                        (orderId && systemSupabase?.from)
                            ? (async () => {
                                try {
                                    await maybeIssueAffiliateDiscountAssetsForShopOrder({
                                        supabase: systemSupabase,
                                        site: payload.site,
                                        orderId
                                    });
                                } catch (linkageError) {
                                    console.warn('[Shop] Affiliate discount linkage skipped:', linkageError.message);
                                }
                            })()
                            : Promise.resolve(null),
                        systemSupabase?.from
                            ? safeMarkShopBuyerAsPaid(systemSupabase, {
                                userId: user.id,
                                sourceEventId: orderId,
                                sourceModule: 'shop.purchase'
                            })
                            : Promise.resolve(null)
                    ]);
                });
                recordServerTimingPhase(timingTracker, 'shop-purchase-followups', followupsStartedAt);

                return respond(200, {
                    ...responsePayload,
                    data: {
                        ...responseData,
                        benefit_label: benefitLabel,
                        usage_instructions: responseUsageInstructions || null,
                        show_usage_instructions: responseHasUsageInstructions,
                        pricing_waterfall: pricingWaterfall.rows,
                        stacking_policy: pricingWaterfall.stacking_policy
                    }
                }, {
                    userId: user.id,
                    productId: payload.productId,
                    orderId
                });
            } catch (error) {
                return respond(error.statusCode || 500, {
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
