/**
 * shop-client.js
 * User-side logic for Resource Shop
 * Handles product loading, purchase flow, and order history.
 */

function trackShopAnalyticsEvent(eventName, payload = {}, options = {}) {
    const tracker = window.UserEventTracker;
    if (!tracker || typeof tracker.track !== 'function') {
        return;
    }

    const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};
    const normalizedPayload = {
        module: payload.module || 'shop_storefront',
        entityType: payload.entityType || 'product',
        entityId: payload.entityId || null,
        eventValue: payload.eventValue ?? null,
        pointsDelta: payload.pointsDelta ?? null,
        metadata
    };

    const trackingPromise = options.dedupeKey && typeof tracker.trackOnce === 'function'
        ? tracker.trackOnce(options.dedupeKey, eventName, normalizedPayload, { eventType: options.eventType || 'engagement' })
        : tracker.track(eventName, normalizedPayload, { eventType: options.eventType || 'engagement' });

    void Promise.resolve(trackingPromise).catch((error) => {
        console.debug('[ShopAnalytics] Track failed:', eventName, error?.message || error);
    });
}

const SHOP_CART_ABANDON_ENGAGEMENT_DELAY_MS = 45000;

function normalizeShopTrackingText(value, maxLength = 160) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function parseShopTrackingUrl(value = '') {
    const rawValue = normalizeShopTrackingText(value, 2000);
    if (!rawValue) {
        return null;
    }

    try {
        return new URL(rawValue, window.location.origin);
    } catch (_error) {
        return null;
    }
}

function inferShopSourcePageKeyFromUrl(urlObj) {
    if (!urlObj) {
        return '';
    }

    const currentHost = normalizeShopTrackingText(window.location.hostname || '', 255).toLowerCase();
    const targetHost = normalizeShopTrackingText(urlObj.hostname || '', 255).toLowerCase();
    if (targetHost && currentHost && targetHost !== currentHost) {
        return 'external';
    }

    const pathname = normalizeShopTrackingText(urlObj.pathname || '/', 255).toLowerCase();
    if (!pathname || pathname === '/' || pathname.endsWith('/index.html')) {
        return 'home';
    }
    if (pathname.includes('prompts')) {
        return 'prompts';
    }
    if (pathname.includes('shop')) {
        return 'shop';
    }
    if (pathname.includes('verify')) {
        return 'verify';
    }
    if (pathname.includes('guestbook')) {
        return 'guestbook';
    }

    return normalizeShopTrackingText(pathname.split('/').pop()?.replace(/\.html?$/i, '') || '', 80);
}

function isSupabaseStorageImageUrl(url) {
    return /^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i.test(String(url || '').trim());
}

function getZaoyoeAssetCdnOrigin({ canonical = false } = {}) {
    if (canonical) {
        return String(window.SiteConfig?.getCanonicalAssetCdnOrigin?.() || 'https://cdn.zaoyoe.com').replace(/\/+$/, '');
    }

    const configuredOrigin = String(window.SiteConfig?.getAssetCdnOrigin?.() || '').trim();
    if (configuredOrigin) {
        return configuredOrigin.replace(/\/+$/, '');
    }

    const hostname = String(window.location?.hostname || '').toLowerCase();
    return hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz')
        ? 'https://cdn.zaoyoe.xyz'
        : 'https://cdn.zaoyoe.com';
}

function normalizeZaoyoeAssetCdnUrl(url, expectedPrefix = '', options = {}) {
    const source = String(url || '').trim();
    if (!source) return '';

    const siteConfigNormalizer = options.canonical
        ? window.SiteConfig?.normalizeAssetUrlForCanonicalSite
        : window.SiteConfig?.normalizeAssetUrlForCurrentSite;
    const normalizedBySiteConfig = typeof siteConfigNormalizer === 'function'
        ? String(siteConfigNormalizer.call(window.SiteConfig, source) || '').trim()
        : '';
    if (normalizedBySiteConfig && normalizedBySiteConfig !== source) {
        if (!expectedPrefix) return normalizedBySiteConfig;
        try {
            const parsed = new URL(normalizedBySiteConfig, window.location.origin);
            const parts = String(parsed.pathname || '').split('/').filter(Boolean);
            if (parts[0] === expectedPrefix) return normalizedBySiteConfig;
        } catch (error) {
            return '';
        }
    }

    try {
        const parsed = new URL(String(url || '').trim(), window.location.origin);
        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        const isKnownCdnHost = ['cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname) || parsed.hostname.endsWith('.r2.dev');
        if (!isKnownCdnHost || (expectedPrefix && parts[0] !== expectedPrefix)) return '';

        const targetOrigin = new URL(getZaoyoeAssetCdnOrigin(options));
        parsed.protocol = targetOrigin.protocol;
        parsed.host = targetOrigin.host;
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

function normalizeShopProductCdnUrl(url, options = {}) {
    return normalizeZaoyoeAssetCdnUrl(url, 'products', {
        ...options,
        canonical: options.canonical !== false
    });
}

function getShopProductCdnUrlCandidates(url) {
    const trimmed = String(url || '').trim();
    return Array.from(new Set([
        normalizeShopProductCdnUrl(trimmed),
        normalizeShopProductCdnUrl(trimmed, { canonical: true }),
        trimmed
    ].filter(Boolean)));
}

function getShopResponsiveImageVariantUrl(url, variant = '') {
    const normalizedVariant = String(variant || '').trim();
    const trimmed = String(url || '').trim();
    if (!normalizedVariant || !trimmed) {
        return '';
    }

    const candidates = getShopProductCdnUrlCandidates(trimmed);
    const normalizedUrl = candidates[0] || trimmed;
    const manifest = window.__SHOP_IMAGE_VARIANTS__ || null;
    const variants = manifest?.variants?.[normalizedVariant];
    if (variants && typeof variants === 'object') {
        const manifestUrl = String(candidates.map((candidate) => variants[candidate]).find(Boolean) || '').trim();
        if (manifestUrl) {
            return manifestUrl;
        }
    }

    return getShopResponsiveR2CardVariantUrl(normalizedUrl, normalizedVariant);
}

function getShopResponsiveR2CardVariantUrl(url, variant = '') {
    if (String(variant || '').trim() !== 'card') {
        return '';
    }

    try {
        const normalizedUrl = normalizeShopProductCdnUrl(url) || String(url || '').trim();
        const parsed = new URL(normalizedUrl, window.location.origin);
        if (!['cdn.zaoyoe.com', 'cdn.zaoyoe.xyz'].includes(parsed.hostname)) {
            return '';
        }

        const parts = String(parsed.pathname || '').split('/').filter(Boolean);
        if (parts.length !== 2 || parts[0] !== 'products') {
            return '';
        }

        const basename = decodeURIComponent(parts[1] || '').replace(/\.[^.]+$/, '');
        if (!basename) {
            return '';
        }

        return `${getZaoyoeAssetCdnOrigin({ canonical: true })}/products/card/${encodeURIComponent(basename)}.webp`;
    } catch (error) {
        return '';
    }
}

function normalizeShopProductImageAsset(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeShopProductImageAsset).find(Boolean) || null;
    }

    if (typeof value === 'string') {
        const original = value.trim();
        return original ? { original } : null;
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const variants = value.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)
        ? value.variants
        : {};
    const asset = {};

    for (const key of ['original', 'thumb', 'card', 'home', 'detail']) {
        const url = String(value[key] || variants[key] || '').trim();
        if (url) {
            asset[key] = url;
        }
    }

    const fallbackOriginal = String(value.url || value.src || value.image || value.icon_url || '').trim();
    if (!asset.original && fallbackOriginal) {
        asset.original = fallbackOriginal;
    }

    return asset.original || asset.thumb || asset.card || asset.home || asset.detail ? asset : null;
}

function buildShopProductImageAssetFromUrl(url) {
    const original = String(url || '').trim();
    if (!original || original.startsWith('fa')) {
        return null;
    }

    const asset = { original };
    const card = getShopResponsiveImageVariantUrl(original, 'card');
    if (card && card !== original) {
        asset.card = card;
    }
    return asset;
}

function getShopProductImageAsset(productOrAsset = {}) {
    const explicitAsset = normalizeShopProductImageAsset(
        productOrAsset?.image_assets ?? productOrAsset?.imageAssets ?? productOrAsset
    );
    if (explicitAsset) {
        return explicitAsset;
    }

    return buildShopProductImageAssetFromUrl(productOrAsset?.icon_url);
}

function getShopProductImageAssetUrl(value, variant = 'original') {
    const asset = normalizeShopProductImageAsset(value);
    if (!asset) {
        return typeof value === 'string' ? value.trim() : '';
    }

    const normalizedVariant = String(variant || 'original').trim() || 'original';
    return String(asset[normalizedVariant] || asset.original || asset.card || asset.thumb || asset.home || asset.detail || '').trim();
}

function getShopProductImageAssetExplicitVariantUrl(value, variant = '') {
    const normalizedVariant = String(variant || '').trim();
    if (!normalizedVariant || normalizedVariant === 'original') {
        return '';
    }

    const asset = normalizeShopProductImageAsset(value);
    return String(asset?.[normalizedVariant] || '').trim();
}

function readShopPromptIdFromUrl(urlObj) {
    if (!urlObj?.searchParams) {
        return '';
    }

    const searchValue = normalizeShopTrackingText(
        urlObj.searchParams.get('prompt_id')
        || urlObj.searchParams.get('promptId')
        || urlObj.searchParams.get('id')
        || '',
        160
    );
    if (searchValue) {
        return searchValue;
    }

    const pageKey = inferShopSourcePageKeyFromUrl(urlObj);
    if (pageKey !== 'prompts') {
        return '';
    }

    const normalizedHash = normalizeShopTrackingText(
        decodeURIComponent(String(urlObj.hash || '').replace(/^#/, '')),
        160
    );
    if (!normalizedHash) {
        return '';
    }

    const hashMatch = normalizedHash.match(/^(?:prompt-)?([A-Za-z0-9_-]+)$/);
    return hashMatch ? normalizeShopTrackingText(hashMatch[1], 160) : '';
}

function inferShopSourceChannelFromUrl(urlObj) {
    if (!urlObj) {
        return '';
    }

    if (readShopPromptIdFromUrl(urlObj)) {
        return 'prompt_content';
    }

    const pageKey = inferShopSourcePageKeyFromUrl(urlObj);
    if (pageKey === 'home') {
        return 'homepage';
    }
    if (pageKey === 'prompts') {
        return 'prompt_content';
    }
    if (pageKey === 'guestbook') {
        return 'guestbook';
    }
    if (pageKey === 'verify') {
        return 'verify';
    }
    if (pageKey === 'external') {
        return 'external';
    }
    if (pageKey === 'shop') {
        return urlObj.searchParams?.get('category')
            ? 'shop_category'
            : 'shop_storefront';
    }

    return pageKey || 'shop_storefront';
}

function resolveShopSourceContext() {
    const currentUrl = parseShopTrackingUrl(window.location.href);
    const referrerUrl = parseShopTrackingUrl(document.referrer || '');
    const referrerPage = inferShopSourcePageKeyFromUrl(referrerUrl);
    const currentPage = inferShopSourcePageKeyFromUrl(currentUrl) || 'shop';
    const sourcePromptId = readShopPromptIdFromUrl(currentUrl) || readShopPromptIdFromUrl(referrerUrl) || null;
    const sourcePage = referrerPage && referrerPage !== 'shop'
        ? referrerPage
        : currentPage;
    const sourceChannel = sourcePromptId
        ? 'prompt_content'
        : (inferShopSourceChannelFromUrl(referrerUrl) || inferShopSourceChannelFromUrl(currentUrl) || 'shop_storefront');

    return {
        sourcePage: normalizeShopTrackingText(sourcePage || 'shop', 80) || 'shop',
        sourceChannel: normalizeShopTrackingText(sourceChannel || 'shop_storefront', 80) || 'shop_storefront',
        sourcePromptId: sourcePromptId ? normalizeShopTrackingText(sourcePromptId, 160) : null
    };
}

function buildShopTrackingMetadata(baseMetadata = {}, sourceContext = {}) {
    const metadata = {
        ...(baseMetadata && typeof baseMetadata === 'object' && !Array.isArray(baseMetadata) ? baseMetadata : {})
    };
    const normalizedSourcePage = normalizeShopTrackingText(sourceContext?.sourcePage || '', 80);
    const normalizedSourceChannel = normalizeShopTrackingText(sourceContext?.sourceChannel || '', 80);
    const normalizedSourcePromptId = normalizeShopTrackingText(sourceContext?.sourcePromptId || '', 160);

    if (normalizedSourcePage) {
        metadata.source_page = normalizedSourcePage;
    }
    if (normalizedSourceChannel) {
        metadata.source_channel = normalizedSourceChannel;
    }
    if (normalizedSourcePromptId) {
        metadata.source_prompt_id = normalizedSourcePromptId;
    }

    return metadata;
}

const SHOP_GRID_EAGER_IMAGE_COUNT = 4;
const SHOP_PRODUCT_SKELETON_COUNT = 5;
const SHOP_CARD_BREATHE_PHASE_MAX_S = 4;
const SHOP_CARD_BREATHE_ACTIVATE_DELAY_MS = 0;
const SHOP_CARD_PROMPT_ENTER_DELAY_STEP_MS = 50;
const SHOP_CARD_PROMPT_ENTER_DURATION_MS = 800;
const SHOP_CARD_ENTER_SETTLE_FALLBACK_BUFFER_MS = 180;
const SHOP_STARRY_SKY_RUNTIME_SRC = 'starry-sky.js?v=f5a4ba7fbfa7';
const SHOP_STARRY_SKY_IDLE_DELAY_MS = 1200;
const SHOP_PREFETCH_SCHEMA_VERSION = '20260513_SHOP_SITE_MARKETING_PRICING_1';
const SHOP_PURCHASE_PREFILL_SCHEMA_VERSION = '20260415_SHOP_PURCHASE_PREFILL_1';
const SHOP_PURCHASE_PREFILL_STORAGE_KEY = 'shop_purchase_prefill';
const SHOP_DISCOUNT_ASSETS_CACHE_TTL_MS = 2 * 60 * 1000;
const SHOP_DISCOUNT_ASSETS_PREFETCH_LIMIT = 4;
const SHOP_PURCHASE_COUPON_SYNC_SUBMIT_GRACE_MS = 900;
const SHOP_DEFERRED_TASK_TIMEOUT_MS = 1400;
const SHOP_POST_RENDER_TASK_TIMEOUT_MS = 900;
const SHOP_REALTIME_SUBSCRIBE_TIMEOUT_MS = 2600;
const SHOP_REALTIME_REFRESH_DEBOUNCE_MS = 650;
const SHOP_REALTIME_RETRY_MS = 30000;
const SHOP_REALTIME_FALLBACK_REFRESH_MS = 30000;
const SHOP_PUBLIC_API_DEFAULT_BASE_URL = 'https://verify-api.zaoyoe.com';
const SHOP_CATALOG_BROWSER_CACHE_TTL_MS = 30000;
const SHOP_CATALOG_BROWSER_CACHE_PREFIX = 'zaoyoe_shop_catalog_v2';

function getShopPublicApiBaseUrl() {
    const configured = String(
        window.ZAOYOE_PUBLIC_API_BASE_URL
        || window.VERIFY_SERVER_URL
        || SHOP_PUBLIC_API_DEFAULT_BASE_URL
    ).trim();

    try {
        const parsed = new URL(configured || SHOP_PUBLIC_API_DEFAULT_BASE_URL, window.location.origin);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return '';
        }
        return parsed.origin.replace(/\/+$/, '');
    } catch (_error) {
        return SHOP_PUBLIC_API_DEFAULT_BASE_URL;
    }
}

function buildShopPublicApiUrl(pathname, params = {}) {
    const baseUrl = getShopPublicApiBaseUrl();
    if (!baseUrl) return '';

    try {
        const url = new URL(pathname, `${baseUrl}/`);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                url.searchParams.set(key, String(value));
            }
        });
        return url.toString();
    } catch (_error) {
        return '';
    }
}
const shopCardImageWarmCache = new Set();

async function ensureShopWalletModal(options = {}) {
    if (window.WalletModal) {
        if (options.prefetch === true && typeof window.WalletModal.prefetchData === 'function') {
            window.WalletModal.prefetchData();
        }
        return window.WalletModal;
    }

    const loader = window.ZaoyoeWalletModalBootstrap;
    if (!loader) {
        return null;
    }

    try {
        return options.prefetch === true && typeof loader.warm === 'function'
            ? await loader.warm({ prefetch: true })
            : await loader.ensure();
    } catch (error) {
        console.warn('[ShopClient] Failed to load wallet modal runtime:', error?.message || error);
        return null;
    }
}

async function openShopWalletModal(view = 'balance', context = {}) {
    const walletModal = await ensureShopWalletModal();
    walletModal?.open?.(view, context);
    return walletModal;
}

const ShopClient = {
    currentAgentId: null,
    currentAgentName: null,
    successUsageWheelCleanup: null,
    purchaseNotesHeightAnimationTimer: null,
    purchaseModalViewportSyncCleanup: null,
    purchaseModalViewportSyncRafId: null,
    purchaseModalOpenViewportSyncTimers: [],
    purchaseModalKeyboardViewportCleanup: null,
    purchaseModalKeyboardViewportRafId: null,
    purchaseModalKeyboardContentRafId: null,
    purchaseModalKeyboardBaseViewportHeight: 0,
    purchaseModalKeyboardBaseVisualHeight: 0,
    purchaseModalKeyboardBaseCardHeight: 0,
    purchaseModalKeyboardLastBottomInset: 0,
    purchaseModalKeyboardDocked: false,
    purchaseModalKeyboardInitialDockTimer: null,
    purchaseModalKeyboardInsetDropTimer: null,
    purchaseModalKeyboardTransitionTimer: null,
    purchaseModalKeyboardFocusedReleaseTimer: null,
    purchaseModalKeyboardPendingInset: 0,
    shopModalBackdropTapGuardUntil: 0,
    shopModalBackdropTapGuardTimer: null,
    shopModalBackdropTapGuardCleanup: null,
    purchaseModalPageFrozen: false,
    purchaseModalBaseScrollY: 0,
    purchaseModalOwnsFullScrollLock: false,
    categoryProductsCache: {},
    categoryProductsPromises: {},
    allProductsCache: null,
    allProductsPromise: null,
    shopCatalogPromise: null,
    prefetchedShopRevalidationPromise: null,
    agentPricesCache: null,
    agentPricesCacheSite: '',
    agentPricesPromise: null,
    agentPricesPromiseSite: '',
    currentUserPurchaseAccess: null,
    currentUserPurchaseAccessPromise: null,
    currentUserPurchaseAccessUserId: null,
    availableCategories: [],
    cartItems: new Map(),
    cartSnapshots: {},
    cartItemDisclosureState: {},
    cartOpen: false,
    cartCheckoutProcessing: false,
    purchaseProcessing: false,
    cartBackdropCloseGuardUntil: 0,
    cartDrawerOwnsScrollLock: false,
    cartDrawerFallbackScrollLock: false,
    cartThemeColorRestoreTimerId: null,
    cartForceHiddenTimerId: null,
    productsRequestToken: 0,
    productsCacheEpoch: 0,
    backgroundPrefetchScheduled: false,
    backgroundPrefetchHandle: null,
    gridTransitionCleanupTimer: null,
    gridTransitionSequence: 0,
    gridTransitionActiveUntil: 0,
    mobileProductFocusResizeTimer: null,
    mobileProductFocusResizeBound: false,
    mobileBrowserChromeInsetBound: false,
    mobileBrowserChromeInsetRafId: null,
    purchaseGuidanceRequestToken: 0,
    cartAnchorFeedbackTimer: null,
    lastSkeletonCount: SHOP_PRODUCT_SKELETON_COUNT,
    staticUiBindingsBound: false,
    deferredUiBindingsBound: false,
    deferredUiBindingsHandle: null,
    shopCardBreatheTimers: new WeakMap(),
    shopStarrySkyRuntimePromise: null,
    shopThemeObserver: null,
    pendingProductSpotlight: null,
    productSpotlightTimer: null,
    postRenderEnhancementHandle: null,
    discountAssetsCache: new Map(),
    discountAssetsRequestCache: new Map(),
    discountAssetsRequestControllers: new Map(),
    discountAssetsPrefetchHandle: null,
    discountAssetsCacheUserKey: null,
    shopDiscountEngagementSeenKeys: new Set(),
    productStockSnapshot: new Map(),
    cartAbandonEngagementTimer: null,
    storefrontRealtimeSubscription: null,
    storefrontRealtimeRetryTimer: null,
    storefrontRealtimeRefreshTimer: null,
    storefrontRealtimeFallbackRefreshTimer: null,
    storefrontRealtimeOrderRefreshTimer: null,
    storefrontRealtimeStatus: 'idle',
    storefrontRealtimeSite: '',
    storefrontRealtimeUserId: '',
    shopRealtimeAuthUnsubscribe: null,
    shopRealtimeAuthBound: false,
    ordersLoaded: false,
    ordersLoading: false,

    getAccessToken: async function () {
        const client = window.supabaseClient || supabaseClient;
        const { data: { session } = {} } = await client.auth.getSession();
        const nextDiscountAssetsCacheUserKey = String(session?.user?.id || '').trim() || 'guest';
        if (this.discountAssetsCacheUserKey && this.discountAssetsCacheUserKey !== nextDiscountAssetsCacheUserKey) {
            this.clearDiscountAssetsCache();
        }
        this.discountAssetsCacheUserKey = nextDiscountAssetsCacheUserKey;
        return session?.access_token || '';
    },

    clearDiscountAssetsCache: function () {
        if (this.discountAssetsCache instanceof Map) {
            this.discountAssetsCache.clear();
        } else {
            this.discountAssetsCache = new Map();
        }

        if (this.discountAssetsRequestControllers instanceof Map) {
            this.discountAssetsRequestControllers.forEach((controller) => {
                try {
                    controller?.abort?.();
                } catch (_error) {}
            });
            this.discountAssetsRequestControllers.clear();
        } else {
            this.discountAssetsRequestControllers = new Map();
        }

        if (this.discountAssetsRequestCache instanceof Map) {
            this.discountAssetsRequestCache.clear();
        } else {
            this.discountAssetsRequestCache = new Map();
        }

        if (this.discountAssetsPrefetchHandle) {
            clearTimeout(this.discountAssetsPrefetchHandle);
            this.discountAssetsPrefetchHandle = null;
        }

        if (this.shopDiscountEngagementSeenKeys instanceof Set) {
            this.shopDiscountEngagementSeenKeys.clear();
        } else {
            this.shopDiscountEngagementSeenKeys = new Set();
        }
    },

    loadCurrentUserPurchaseAccess: async function ({ forceRefresh = false } = {}) {
        const client = window.supabaseClient || supabaseClient;
        const { data: { user } = {} } = await client.auth.getUser();

        if (!user) {
            this.currentUserPurchaseAccess = null;
            this.currentUserPurchaseAccessPromise = null;
            this.currentUserPurchaseAccessUserId = null;
            if (this.discountAssetsCacheUserKey && this.discountAssetsCacheUserKey !== 'guest') {
                this.clearDiscountAssetsCache();
            }
            this.discountAssetsCacheUserKey = 'guest';
            return { unlimitedShopPurchases: false };
        }

        if (this.currentUserPurchaseAccessUserId !== user.id) {
            this.currentUserPurchaseAccess = null;
            this.currentUserPurchaseAccessPromise = null;
            this.currentUserPurchaseAccessUserId = user.id;
            if (this.discountAssetsCacheUserKey && this.discountAssetsCacheUserKey !== user.id) {
                this.clearDiscountAssetsCache();
            }
            this.discountAssetsCacheUserKey = user.id;
        }

        if (!forceRefresh && this.currentUserPurchaseAccess) {
            return this.currentUserPurchaseAccess;
        }

        if (!forceRefresh && this.currentUserPurchaseAccessPromise) {
            return this.currentUserPurchaseAccessPromise;
        }

        const request = client
            .from('user_purchase_entitlements')
            .select('unlimited_shop_purchases')
            .eq('user_id', user.id)
            .maybeSingle()
            .then(({ data, error }) => {
                if (error) {
                    throw error;
                }

                const access = {
                    unlimitedShopPurchases: data?.unlimited_shop_purchases === true
                };
                this.currentUserPurchaseAccess = access;
                return access;
            })
            .catch((error) => {
                console.warn('Failed to load current user purchase access:', error);
                const access = { unlimitedShopPurchases: false };
                this.currentUserPurchaseAccess = access;
                return access;
            })
            .finally(() => {
                if (this.currentUserPurchaseAccessPromise === request) {
                    this.currentUserPurchaseAccessPromise = null;
                }
            });

        this.currentUserPurchaseAccessPromise = request;
        return request;
    },

    createPurchaseIdempotencyKey: function () {
        if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }

        return `shop_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    },

    normalizePurchaseQuantityCap: function (value) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return 99;
        }
        return Math.min(parsed, 99);
    },

    getCurrentPurchaseQuantityCap: function () {
        if (this.currentPurchase.maxQuantity == null) {
            return Number.MAX_SAFE_INTEGER;
        }
        return this.normalizePurchaseQuantityCap(this.currentPurchase.maxQuantity);
    },

    setCurrentPurchaseQuantityCap: function (maxQuantity, { unlimited = false } = {}) {
        this.currentPurchase.maxQuantity = unlimited
            ? null
            : this.normalizePurchaseQuantityCap(maxQuantity);

        const quantityInput = document.getElementById('purchaseQuantity');
        if (quantityInput) {
            if (this.currentPurchase.maxQuantity == null) {
                quantityInput.removeAttribute('max');
            } else {
                quantityInput.max = String(this.currentPurchase.maxQuantity);
            }
        }

        const quantityCap = this.getCurrentPurchaseQuantityCap();
        if (this.currentPurchase.quantity > quantityCap) {
            this.currentPurchase.quantity = quantityCap;
            if (quantityInput) {
                quantityInput.value = String(quantityCap);
            }
            this.updatePriceForQuantity(quantityCap);
        }
    },

    isInventoryStockErrorMessage: function (message = '') {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) return false;

        return /库存不足|库存不够|售空|售罄|out\s*of\s*stock|insufficient\s+(?:stock|inventory)|inventory\s+insufficient/i.test(normalizedMessage);
    },

    refreshProductsAfterInventoryFailure: async function () {
        try {
            await this.loadProducts({ forceRefresh: true });
            this.sanitizeCartState();
            this.renderCart();
            this.renderCartCheckoutModal();
        } catch (error) {
            console.warn('Failed to refresh products after inventory failure:', error);
        }
    },

    getCurrentShopSite: function () {
        return String(window.SiteConfig?.site || 'cn').trim().toLowerCase() === 'intl'
            ? 'intl'
            : 'cn';
    },

    getProductSiteScopedMarketingValue: function (product = {}, baseField = '') {
        if (!product || !baseField) {
            return null;
        }

        if (this.getCurrentShopSite() === 'intl') {
            const intlField = `${baseField}_intl`;
            if (Object.prototype.hasOwnProperty.call(product, intlField)) {
                return product[intlField];
            }
        }

        return product?.[baseField];
    },

    normalizeProductMarketingForCurrentSite: function (product = {}) {
        if (!product || typeof product !== 'object') {
            return product;
        }

        const quantityRules = this.getProductSiteScopedMarketingValue(product, 'quantity_rules');
        const flashSalePrice = this.getProductSiteScopedMarketingValue(product, 'flash_sale_price');
        const flashSaleEnd = this.getProductSiteScopedMarketingValue(product, 'flash_sale_end');

        return {
            ...product,
            quantity_rules: quantityRules ?? null,
            flash_sale_price: flashSalePrice ?? null,
            flash_sale_end: flashSaleEnd || null
        };
    },

    filterProductsForCurrentSite: function (products) {
        const normalizeVisibleProducts = (visibleProducts) => (
            Array.isArray(visibleProducts)
                ? visibleProducts.map((product) => this.normalizeProductMarketingForCurrentSite(product))
                : []
        );

        if (window.SiteConfig?.filterProductsForCurrentSite) {
            return normalizeVisibleProducts(window.SiteConfig.filterProductsForCurrentSite(products));
        }
        return normalizeVisibleProducts(products);
    },

    filterProductsForCategory: function (products, category = 'all') {
        const normalizedCategory = String(category || 'all').trim();
        const visibleProducts = this.filterProductsForCurrentSite(products);
        if (!normalizedCategory || normalizedCategory === 'all') {
            return visibleProducts;
        }
        return visibleProducts.filter((product) => String(product?.category || '').trim() === normalizedCategory);
    },

    getProductPriceForCurrentSite: function (product) {
        if (window.SiteConfig?.getProductPrice) {
            return window.SiteConfig.getProductPrice(product);
        }
        const field = window.SiteConfig?.getPriceField?.() || 'price_points';
        const rawValue = product?.[field];
        return rawValue == null ? null : Number(rawValue);
    },

    getCurrentLanguage: function () {
        return window.i18n?.getCurrentLanguage() || 'zh';
    },

    isEnglishShopLocale: function () {
        return this.getCurrentLanguage() === 'en';
    },

    trShop: function (key, fallback = '', params = {}) {
        const translated = window.i18n?.t?.(`shop.${key}`) || fallback || '';
        return String(translated).replace(/\{(\w+)\}/g, (match, name) => (
            params[name] === undefined || params[name] === null ? match : String(params[name])
        ));
    },

    getShopCatalogUnavailableMessage: function () {
        return this.trShop(
            'catalogUnavailable',
            this.isEnglishShopLocale()
                ? 'The store is temporarily unavailable. Please refresh later.'
                : '商城数据暂时不可用，请稍后刷新重试'
        );
    },

    getGuidanceSiteForCurrentLanguage: function () {
        return this.isEnglishShopLocale() ? 'intl' : 'cn';
    },

    getMissingProductGuidanceTranslationText: function (baseField) {
        if (!this.isEnglishShopLocale()) {
            return '';
        }

        return baseField === 'usage_instructions'
            ? 'Usage instructions are being translated. Please switch to Chinese or contact support if you need them now.'
            : 'Purchase notes are being translated. Please switch to Chinese or contact support if you need them now.';
    },

    containsCjkText: function (value) {
        return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
    },

    resolveShopDataText: function (value, fallback = '') {
        const normalized = String(value || '').trim();
        if (this.isEnglishShopLocale() && this.containsCjkText(normalized)) {
            return fallback;
        }
        return normalized || fallback;
    },

    getProductCategoryLabelMap: function () {
        return {
            communityAccess: {
                zh: 'API中转',
                en: 'API Relay',
                aliases: ['API中转', 'API Relay', 'api relay', 'api_relay', 'api-relay', 'api中转', '公益站', 'community access', 'community_access', 'community-access', 'community', 'gongyi']
            },
            virtualCard: {
                zh: '虚拟卡',
                en: 'Virtual Card',
                aliases: ['虚拟卡', 'virtual card', 'virtual cards', 'virtual_card', 'virtual-card']
            },
            account: {
                zh: '账号',
                en: 'Account',
                aliases: ['账号', '账户', 'account', 'accounts']
            },
            other: {
                zh: '其他',
                en: 'Other',
                aliases: ['其他', '其它', 'other', 'others', 'misc', 'uncategorized']
            }
        };
    },

    normalizeProductCategoryAliasKey: function (value = '') {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ');
    },

    getProductCategoryTranslationKey: function (category) {
        const candidates = [
            category?.key,
            category?.name_key,
            category?.slug,
            category?.code,
            category?.name,
            category
        ];
        const categoryLabelMap = this.getProductCategoryLabelMap();

        for (const candidate of candidates) {
            const normalizedCandidate = this.normalizeProductCategoryAliasKey(candidate);
            if (!normalizedCandidate) continue;

            const matchedEntry = Object.entries(categoryLabelMap).find(([, definition]) => {
                const aliases = Array.isArray(definition?.aliases) ? definition.aliases : [];
                return aliases.some((alias) => this.normalizeProductCategoryAliasKey(alias) === normalizedCandidate);
            });
            if (matchedEntry) {
                return matchedEntry[0];
            }
        }

        return '';
    },

    getLocalizedProductName: function (product) {
        if (!product) return '';
        const isEn = this.isEnglishShopLocale();
        if (isEn && product.name_en) {
            return this.resolveShopDataText(product.name_en, window.i18n?.t('shop.unknownProduct') || 'Product');
        }
        return this.resolveShopDataText(product.name, isEn ? (window.i18n?.t('shop.unknownProduct') || 'Product') : '');
    },

    getLocalizedProductDescription: function (product) {
        if (!product) return '';
        const isEn = this.isEnglishShopLocale();
        const fallback = window.i18n?.t('shop.noDescription') || (isEn ? 'No description' : '暂无描述');
        if (isEn && product.description_en) {
            return this.resolveShopDataText(product.description_en, fallback);
        }
        return this.resolveShopDataText(product.description, fallback);
    },

    getLocalizedProductGuidanceText: function (product, baseField) {
        if (!product || !baseField) return '';
        const legacyText = String(product?.[baseField] || '').trim();
        const zhText = String(product?.[`${baseField}_zh`] || '').trim();
        const enText = String(product?.[`${baseField}_en`] || '').trim();

        if (this.isEnglishShopLocale()) {
            const localizedText = this.resolveShopDataText(enText || legacyText, '');
            const showField = `show_${baseField}`;
            if (localizedText) {
                return localizedText;
            }
            if (product?.[showField] === true && (zhText || legacyText || enText)) {
                return this.getMissingProductGuidanceTranslationText(baseField);
            }
            return '';
        }

        return zhText || legacyText || enText;
    },

    getLocalizedProductCategoryLabel: function (category) {
        const normalized = String(category?.name || category || '').trim();
        if (!normalized) return '';
        const translationKey = this.getProductCategoryTranslationKey(category);
        const categoryDefinition = translationKey ? this.getProductCategoryLabelMap()[translationKey] : null;

        if (this.isEnglishShopLocale()) {
            const explicitEnglish = String(category?.name_en || category?.label_en || '').trim();
            if (explicitEnglish) {
                return this.resolveShopDataText(explicitEnglish, normalized);
            }
            const translatedEnglish = translationKey
                ? (window.i18n?.t(`shop.categoryLabels.${translationKey}`) || categoryDefinition?.en || normalized)
                : normalized;
            return this.resolveShopDataText(translatedEnglish, normalized);
        }

        const explicitChinese = String(category?.name_zh || category?.label_zh || '').trim();
        if (explicitChinese) {
            return explicitChinese;
        }
        if (translationKey) {
            return window.i18n?.t(`shop.categoryLabels.${translationKey}`) || categoryDefinition?.zh || normalized;
        }
        return normalized;
    },

    getShopPointsLabel: function ({ lowercaseEnglish = false } = {}) {
        const fromSiteConfig = window.SiteConfig?.getPointsLabel?.({ lowercaseEnglish });
        if (fromSiteConfig) {
            return fromSiteConfig;
        }

        const translated = window.i18n?.t('shop.points');
        if (translated) {
            return lowercaseEnglish && String(translated).trim().toLowerCase() === 'points'
                ? 'points'
                : translated;
        }

        if (this.isEnglishShopLocale()) {
            return lowercaseEnglish ? 'points' : 'Points';
        }
        return '积分';
    },

    shouldShowProductCardDescription: function (product) {
        return product?.show_product_description !== false;
    },

    formatShopPoints: function (value) {
        const numericValue = Number(value || 0) || 0;
        const formattedValue = this.formatShopPointValue(numericValue);
        const pointsLabel = this.getShopPointsLabel();
        return `${formattedValue} ${pointsLabel}`;
    },

    formatShopPointValue: function (value, { maximumFractionDigits = 2 } = {}) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return '--';
        }

        const safeDigits = Math.max(0, Math.min(4, Number(maximumFractionDigits) || 0));
        const rounded = Number(numericValue.toFixed(safeDigits));
        if (Number.isInteger(rounded)) {
            return String(rounded);
        }

        return rounded
            .toFixed(safeDigits)
            .replace(/(\.\d*?[1-9])0+$/, '$1')
            .replace(/\.0+$/, '');
    },

    getDiscountBenefitLabel: function (item = {}) {
        const explicitLabel = String(
            item?.benefit_label
            || item?.benefitLabel
            || item?.preview?.benefit_label
            || ''
        ).trim();
        if (explicitLabel && (!this.isEnglishShopLocale() || !this.containsCjkText(explicitLabel))) {
            return explicitLabel;
        }

        const discountType = String(
            item?.discount_type
            || item?.discountType
            || item?.preview?.discount_type
            || ''
        ).trim().toLowerCase();
        const discountValue = Number(
            item?.discount_value
            ?? item?.discountValue
            ?? item?.preview?.discount_value
        );

        if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
            return '';
        }

        if (discountType === 'percent') {
            if (this.isEnglishShopLocale()) {
                const offPercent = Math.max(0, Math.min(100, Number((100 - discountValue).toFixed(2))));
                return this.trShop('percentOff', '{percent}% off', { percent: this.formatShopPointValue(offPercent) });
            }
            const folded = discountValue / 10;
            const display = Number.isInteger(folded)
                ? String(folded)
                : folded.toFixed(1).replace(/\.0$/, '');
            return `${display}折`;
        }

        if (discountType === 'fixed') {
            const pointsLabel = this.getShopPointsLabel();
            return this.isEnglishShopLocale()
                ? this.trShop('fixedOff', '{amount} {unit} off', { amount: this.formatShopPointValue(discountValue), unit: pointsLabel })
                : `立减 ${this.formatShopPointValue(discountValue)} ${pointsLabel}`;
        }

        return '';
    },

    getDiscountPrecisePreviewTotal: function (item = {}) {
        const preview = item?.preview && typeof item.preview === 'object' && !Array.isArray(item.preview)
            ? item.preview
            : {};
        const discountType = String(
            item?.discount_type
            || item?.discountType
            || preview?.discount_type
            || ''
        ).trim().toLowerCase();
        const discountValue = Number(
            item?.discount_value
            ?? item?.discountValue
            ?? preview?.discount_value
        );
        const rawSubtotal = Number(preview?.subtotal);
        const subtotal = Number.isFinite(rawSubtotal)
            ? Math.max(0, rawSubtotal)
            : Math.max(0, Number(this.getCurrentPurchaseSubtotal?.() || 0) || 0);

        if (discountType !== 'percent' || !Number.isFinite(discountValue) || discountValue <= 0 || subtotal <= 0) {
            return null;
        }

        return Number((subtotal * (discountValue / 100)).toFixed(2));
    },

    getCurrentPurchasePricingSummary: function () {
        const subtotal = Math.max(0, Number(this.getCurrentPurchaseSubtotal?.() || 0) || 0);
        const rawFinalTotal = Number(this.currentPurchase?.discountFinalTotal);
        let finalTotal = Number.isFinite(rawFinalTotal)
            ? Math.max(0, Math.min(subtotal, rawFinalTotal))
            : null;
        let discountAmount = Number(this.currentPurchase?.discountAmount);

        if (finalTotal != null) {
            discountAmount = Math.max(0, Number((subtotal - finalTotal).toFixed(2)));
        } else {
            discountAmount = Number.isFinite(discountAmount)
                ? Math.max(0, Math.min(subtotal, discountAmount))
                : 0;
            finalTotal = Math.max(0, Number((subtotal - discountAmount).toFixed(2)));
        }

        return {
            subtotal,
            discountAmount,
            finalTotal
        };
    },

    resolveCartDiscountPricing: function (discount = null, subtotal = 0) {
        const normalizedSubtotal = Math.max(0, Number(subtotal || 0) || 0);
        if (!discount || normalizedSubtotal <= 0) {
            return {
                discountAmount: 0,
                finalTotal: normalizedSubtotal
            };
        }

        const discountType = String(discount.discountType || '').trim().toLowerCase();
        const discountValue = Number(discount.discountValue);
        if (discountType && Number.isFinite(discountValue) && discountValue > 0) {
            return this.calculateDiscountPricingForConfig(normalizedSubtotal, { discountType, discountValue });
        }

        const storedDiscountAmount = Number(discount.discountAmount);
        const storedFinalTotal = Number(discount.finalTotal);
        const finalTotal = Number.isFinite(storedFinalTotal)
            ? Math.max(0, Math.min(normalizedSubtotal, Number(storedFinalTotal.toFixed(2))))
            : null;
        const discountAmount = Number.isFinite(storedDiscountAmount)
            ? Math.max(0, Math.min(normalizedSubtotal, Number(storedDiscountAmount.toFixed(2))))
            : null;

        if (finalTotal != null || discountAmount != null) {
            const resolvedFinalTotal = finalTotal != null
                ? finalTotal
                : Math.max(0, Number((normalizedSubtotal - discountAmount).toFixed(2)));
            const resolvedDiscountAmount = discountAmount != null
                ? discountAmount
                : Math.max(0, Number((normalizedSubtotal - finalTotal).toFixed(2)));

            return {
                discountAmount: resolvedDiscountAmount,
                finalTotal: resolvedFinalTotal
            };
        }

        return {
            discountAmount: 0,
            finalTotal: normalizedSubtotal
        };
    },

    normalizePurchaseDiscountSelectionSnapshot: function (selection = null, options = {}) {
        if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
            return null;
        }

        const allowIdentityOnly = options.allowIdentityOnly === true;
        const code = String(
            selection.code
            || selection.discountCode
            || selection.discount_code
            || ''
        ).trim().toUpperCase();
        const assetId = String(
            selection.assetId
            || selection.asset_id
            || selection.discountAssetId
            || selection.discount_asset_id
            || ''
        ).trim();
        const discountType = String(
            selection.discountType
            || selection.discount_type
            || ''
        ).trim().toLowerCase();
        const discountValue = Number(
            selection.discountValue
            ?? selection.discount_value
        );
        const hasPricingConfig = Boolean(discountType) && Number.isFinite(discountValue) && discountValue > 0;

        if ((!code && !assetId) || (!allowIdentityOnly && !hasPricingConfig)) {
            return null;
        }

        const computedBenefitLabel = hasPricingConfig
            ? this.getDiscountBenefitLabel({
                ...selection,
                discount_type: discountType,
                discount_value: discountValue
            })
            : '';
        const benefitLabel = String(
            computedBenefitLabel
            || selection.benefitLabel
            || selection.benefit_label
            || code
        ).trim();
        const discountAmount = Number(
            selection.discountAmount
            ?? selection.discount_amount
        );
        const finalTotalAfterApply = Number(
            selection.finalTotalAfterApply
            ?? selection.final_total_after_apply
            ?? selection.finalTotal
            ?? selection.final_total
        );

        return {
            code: code || null,
            assetId: assetId || null,
            discountId: String(selection.discountId || selection.discount_id || '').trim() || null,
            discountType: hasPricingConfig ? discountType : null,
            discountValue: hasPricingConfig ? discountValue : null,
            benefitLabel: benefitLabel || null,
            discountAmount: Number.isFinite(discountAmount) ? Math.max(0, Number(discountAmount.toFixed(2))) : 0,
            finalTotalAfterApply: Number.isFinite(finalTotalAfterApply) ? Math.max(0, Number(finalTotalAfterApply.toFixed(2))) : null,
            isExclusive: selection.is_exclusive !== false,
            stackPriority: Math.max(1, Number.parseInt(selection.stack_priority, 10) || 100),
            pricingApplyStage: String(selection.pricing_apply_stage || '').trim().toLowerCase() || 'order_discount',
            distributionMode: String(selection.distribution_mode || '').trim().toLowerCase() || null
        };
    },

    normalizePurchaseDiscountSelectionSnapshots: function (selections = [], options = {}) {
        const normalizedSelections = (Array.isArray(selections) ? selections : [])
            .map((selection) => this.normalizePurchaseDiscountSelectionSnapshot(selection, options))
            .filter(Boolean);
        const dedupedSelections = [];
        const seenSelectionKeys = new Set();
        normalizedSelections.forEach((selection) => {
            const selectionKey = selection.assetId
                ? `asset:${selection.assetId}`
                : `code:${selection.code || ''}`;
            if (!selectionKey || seenSelectionKeys.has(selectionKey)) {
                return;
            }
            seenSelectionKeys.add(selectionKey);
            dedupedSelections.push(selection);
        });
        return dedupedSelections;
    },

    buildDiscountSelectionSummarySnapshot: function (selections = [], options = {}) {
        const normalizedSelections = this.normalizePurchaseDiscountSelectionSnapshots(selections, options);
        if (!normalizedSelections.length) {
            return null;
        }

        const subtotalCandidate = Number(
            options.subtotal
            ?? options.sub_total
        );
        const subtotal = Number.isFinite(subtotalCandidate)
            ? Math.max(0, Number(subtotalCandidate.toFixed(2)))
            : null;
        const storedDiscountAmount = Number(options.discountAmount ?? options.discount_amount);
        const storedFinalTotal = Number(options.finalTotal ?? options.final_total);
        const totalDiscountAmount = Number.isFinite(storedDiscountAmount)
            ? Math.max(0, Number(storedDiscountAmount.toFixed(2)))
            : Number(
                normalizedSelections.reduce((sum, selection) => sum + Math.max(0, Number(selection.discountAmount || 0) || 0), 0).toFixed(2)
            );
        const finalTotal = Number.isFinite(storedFinalTotal)
            ? Math.max(0, Number(storedFinalTotal.toFixed(2)))
            : (Number.isFinite(normalizedSelections[normalizedSelections.length - 1]?.finalTotalAfterApply)
                ? Math.max(0, Number(normalizedSelections[normalizedSelections.length - 1].finalTotalAfterApply.toFixed(2)))
                : subtotal);
        const joinedCode = normalizedSelections
            .map((selection) => selection.code)
            .filter(Boolean)
            .join(' + ');
        const firstSelection = normalizedSelections[0];

        return {
            code: normalizedSelections.length === 1
                ? (firstSelection.code || null)
                : (joinedCode || null),
            assetId: normalizedSelections.length === 1
                ? (firstSelection.assetId || null)
                : null,
            discountType: normalizedSelections.length === 1
                ? firstSelection.discountType
                : null,
            discountValue: normalizedSelections.length === 1
                ? firstSelection.discountValue
                : null,
            benefitLabel: normalizedSelections.length === 1
                ? (firstSelection.benefitLabel || null)
                : this.trShop('stackedCoupons', '已叠加 {count} 张券', { count: normalizedSelections.length }),
            quantity: Math.max(
                1,
                Math.trunc(Number(
                    options.quantity
                    ?? 1
                ) || 1)
            ),
            subtotal: Number.isFinite(subtotal) ? subtotal : null,
            discountAmount: totalDiscountAmount,
            finalTotal: Number.isFinite(finalTotal) ? finalTotal : subtotal,
            selections: normalizedSelections,
            selectedCount: normalizedSelections.length
        };
    },

    normalizeCartDiscountSnapshot: function (discount = null, options = {}) {
        if (!discount || typeof discount !== 'object' || Array.isArray(discount)) {
            return null;
        }

        const selectionSummary = this.buildDiscountSelectionSummarySnapshot(
            discount.selections
            || discount.discountSelections
            || discount.discount_selections
            || discount.applied_discounts,
            {
                quantity: options.quantity ?? discount.quantity ?? 1,
                subtotal: options.subtotal ?? discount.subtotal ?? discount.preview?.subtotal,
                discountAmount: discount.discountAmount ?? discount.discount_amount,
                finalTotal: discount.finalTotal ?? discount.final_total
            }
        );
        if (selectionSummary) {
            return selectionSummary;
        }

        const code = String(
            discount.code
            || discount.discountCode
            || discount.discount_code
            || ''
        ).trim().toUpperCase();
        const assetId = String(
            discount.assetId
            || discount.asset_id
            || discount.discountAssetId
            || ''
        ).trim();
        const discountType = String(
            discount.discountType
            || discount.discount_type
            || ''
        ).trim().toLowerCase();
        const discountValue = Number(
            discount.discountValue
            ?? discount.discount_value
        );

        if ((!code && !assetId) || !discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
            return null;
        }

        const quantity = Math.max(
            1,
            Math.trunc(Number(
                options.quantity
                ?? discount.quantity
                ?? 1
            ) || 1)
        );
        const subtotalCandidate = Number(
            options.subtotal
            ?? discount.subtotal
            ?? discount.preview?.subtotal
        );
        const subtotal = Number.isFinite(subtotalCandidate)
            ? Math.max(0, Number(subtotalCandidate.toFixed(2)))
            : null;
        const pricing = Number.isFinite(subtotal)
            ? this.calculateDiscountPricingForConfig(subtotal, { discountType, discountValue })
            : null;
        const storedDiscountAmount = Number(
            discount.discountAmount
            ?? discount.discount_amount
            ?? discount.preview?.discount_amount
        );
        const storedFinalTotal = Number(
            discount.finalTotal
            ?? discount.final_total
            ?? discount.preview?.final_total
        );
        const discountAmount = Number.isFinite(pricing?.discountAmount)
            ? pricing.discountAmount
            : (Number.isFinite(storedDiscountAmount) ? Math.max(0, Number(storedDiscountAmount.toFixed(2))) : 0);
        const finalTotal = Number.isFinite(pricing?.finalTotal)
            ? pricing.finalTotal
            : (Number.isFinite(storedFinalTotal) ? Math.max(0, Number(storedFinalTotal.toFixed(2))) : subtotal);
        const benefitLabel = String(
            this.getDiscountBenefitLabel({
                ...discount,
                discount_type: discountType,
                discount_value: discountValue
            })
            || discount.benefitLabel
            || discount.benefit_label
            || discount.preview?.benefit_label
            || code
        ).trim();

        return {
            code: code || null,
            assetId: assetId || null,
            discountType,
            discountValue,
            benefitLabel: benefitLabel || null,
            quantity,
            subtotal: Number.isFinite(subtotal) ? subtotal : null,
            discountAmount: Number.isFinite(discountAmount) ? Number(discountAmount.toFixed(2)) : 0,
            finalTotal: Number.isFinite(finalTotal) ? Number(finalTotal.toFixed(2)) : subtotal,
            selections: [{
                code: code || null,
                assetId: assetId || null,
                discountType,
                discountValue,
                benefitLabel: benefitLabel || null,
                discountAmount: Number.isFinite(discountAmount) ? Number(discountAmount.toFixed(2)) : 0,
                finalTotalAfterApply: Number.isFinite(finalTotal) ? Number(finalTotal.toFixed(2)) : subtotal
            }],
            selectedCount: 1
        };
    },

    buildCurrentPurchaseCartDiscountSnapshot: function () {
        const selectedDiscounts = this.normalizePurchaseDiscountSelectionSnapshots(this.currentPurchase?.selectedDiscounts || []);
        if (!selectedDiscounts.length) {
            return null;
        }

        const { subtotal, discountAmount, finalTotal } = this.getCurrentPurchasePricingSummary();
        if (!(discountAmount > 0) || !(finalTotal < subtotal)) {
            return null;
        }

        return this.buildDiscountSelectionSummarySnapshot(selectedDiscounts, {
            quantity: this.currentPurchase?.quantity || 1,
            subtotal,
            discountAmount,
            finalTotal
        });
    },

    buildPurchasePrefillFromCartDiscountSnapshot: function (discount = null, options = {}) {
        const normalizedDiscount = this.normalizeCartDiscountSnapshot(discount, options);
        const productId = String(options.productId || this.currentPurchase?.productId || '').trim();
        if (!normalizedDiscount || !productId) {
            return null;
        }

        const category = String(options.category || this.currentPurchase?.productCategory || '').trim() || null;
        return {
            version: SHOP_PURCHASE_PREFILL_SCHEMA_VERSION,
            timestamp: Date.now(),
            site: window.SiteConfig?.site || 'cn',
            productId,
            category,
            ownedDiscounts: (normalizedDiscount.selections || []).map((selection) => ({
                asset_id: selection.assetId || null,
                code: selection.code || '',
                benefit_label: selection.benefitLabel || '',
                discount_type: selection.discountType,
                discount_value: selection.discountValue,
                available: true,
                preview: {
                    discount_code: selection.code || '',
                    discount_type: selection.discountType,
                    discount_value: selection.discountValue,
                    benefit_label: selection.benefitLabel || '',
                    subtotal: normalizedDiscount.subtotal,
                    discount_amount: selection.discountAmount,
                    final_total: selection.finalTotalAfterApply
                }
            })),
            claimableDiscounts: []
        };
    },

    consumePurchasePrefillForProduct: function (productId = '') {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId || typeof sessionStorage === 'undefined') {
            return null;
        }

        try {
            const raw = sessionStorage.getItem(SHOP_PURCHASE_PREFILL_STORAGE_KEY);
            if (!raw) {
                return null;
            }

            const payload = JSON.parse(raw);
            const currentSite = window.SiteConfig?.site || 'cn';
            const ageMs = Math.max(0, Date.now() - Number(payload?.timestamp || 0));
            const versionMatches = payload?.version === SHOP_PURCHASE_PREFILL_SCHEMA_VERSION;
            const siteMatches = !payload?.site || payload.site === currentSite;
            const productMatches = String(payload?.productId || '').trim() === normalizedProductId;

            if (!versionMatches || !siteMatches || !productMatches || ageMs > 5 * 60 * 1000) {
                sessionStorage.removeItem(SHOP_PURCHASE_PREFILL_STORAGE_KEY);
                return null;
            }

            sessionStorage.removeItem(SHOP_PURCHASE_PREFILL_STORAGE_KEY);
            return payload;
        } catch (error) {
            console.warn('Failed to consume purchase prefill payload:', error);
            try {
                sessionStorage.removeItem(SHOP_PURCHASE_PREFILL_STORAGE_KEY);
            } catch (_error) {
                // ignore
            }
            return null;
        }
    },

    cloneDiscountAssetsPayload: function (payload = {}) {
        const normalizedPayload = {
            owned_discounts: Array.isArray(payload?.owned_discounts) ? payload.owned_discounts : [],
            claimable_discounts: Array.isArray(payload?.claimable_discounts) ? payload.claimable_discounts : []
        };

        try {
            return JSON.parse(JSON.stringify(normalizedPayload));
        } catch (error) {
            console.warn('Failed to clone discount assets payload:', error);
            return normalizedPayload;
        }
    },

    buildDiscountAssetsCacheKey: function ({ productId = '', quantity = 1, agentId = null, site = '', userKey = '' } = {}) {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) {
            return '';
        }

        const normalizedQuantity = Math.max(1, Math.trunc(Number(quantity || 1) || 1));
        const normalizedAgentId = String(agentId || 'public').trim() || 'public';
        const normalizedSite = String(site || window.SiteConfig?.site || 'cn').trim() || 'cn';
        const normalizedUserKey = String(userKey || this.discountAssetsCacheUserKey || 'guest').trim() || 'guest';

        return [
            normalizedSite,
            normalizedAgentId,
            normalizedUserKey,
            normalizedProductId,
            normalizedQuantity
        ].join('::');
    },

    readDiscountAssetsCache: function (cacheKey = '') {
        const normalizedCacheKey = String(cacheKey || '').trim();
        if (!normalizedCacheKey || !(this.discountAssetsCache instanceof Map)) {
            return null;
        }

        const cachedEntry = this.discountAssetsCache.get(normalizedCacheKey);
        if (!cachedEntry) {
            return null;
        }

        const ageMs = Math.max(0, Date.now() - Number(cachedEntry.timestamp || 0));
        if (ageMs > SHOP_DISCOUNT_ASSETS_CACHE_TTL_MS) {
            this.discountAssetsCache.delete(normalizedCacheKey);
            return null;
        }

        return this.cloneDiscountAssetsPayload(cachedEntry.payload || {});
    },

    writeDiscountAssetsCache: function (cacheKey = '', payload = {}) {
        const normalizedCacheKey = String(cacheKey || '').trim();
        if (!normalizedCacheKey) {
            return;
        }

        if (!(this.discountAssetsCache instanceof Map)) {
            this.discountAssetsCache = new Map();
        }

        this.discountAssetsCache.set(normalizedCacheKey, {
            timestamp: Date.now(),
            payload: this.cloneDiscountAssetsPayload(payload)
        });
    },

    buildCurrentPurchaseDiscountAssetsCacheKey: function () {
        if (!this.currentPurchase?.productId) {
            return '';
        }

        return this.buildDiscountAssetsCacheKey({
            productId: this.currentPurchase.productId,
            quantity: this.currentPurchase.quantity || 1,
            agentId: this.currentAgentId,
            site: window.SiteConfig?.site || 'cn',
            userKey: this.discountAssetsCacheUserKey || 'guest'
        });
    },

    getCurrentPurchaseDiscountAssetsPendingRequest: function () {
        const cacheKey = this.buildCurrentPurchaseDiscountAssetsCacheKey();
        if (!cacheKey || !(this.discountAssetsRequestCache instanceof Map)) {
            return null;
        }

        return this.discountAssetsRequestCache.get(cacheKey) || null;
    },

    hasVisibleCurrentPurchaseDiscountAssets: function (payload = null) {
        const ownedItems = payload
            ? (Array.isArray(payload?.owned_discounts) ? payload.owned_discounts : [])
            : (Array.isArray(this.currentPurchase?.availableDiscountAssets) ? this.currentPurchase.availableDiscountAssets : []);
        const claimableItems = payload
            ? (Array.isArray(payload?.claimable_discounts) ? payload.claimable_discounts : [])
            : (Array.isArray(this.currentPurchase?.claimableDiscounts) ? this.currentPurchase.claimableDiscounts : []);

        return ownedItems.some((item) => item?.available !== false)
            || claimableItems.some((item) => item?.can_claim !== false);
    },

    applyCurrentPurchaseDiscountAssetsPayload: function (payload = {}) {
        if (!this.currentPurchase) {
            return;
        }

        this.currentPurchase.availableDiscountAssets = Array.isArray(payload?.owned_discounts) ? payload.owned_discounts : [];
        this.currentPurchase.claimableDiscounts = Array.isArray(payload?.claimable_discounts) ? payload.claimable_discounts : [];
        this.currentPurchase.discountAssetsLoading = false;
        this.renderPurchaseDiscountAssets();
        this.maybeShowShopDiscountEngagement();
    },

    waitForPurchaseDiscountAssetsBeforeSubmit: async function ({ timeoutMs = SHOP_PURCHASE_COUPON_SYNC_SUBMIT_GRACE_MS } = {}) {
        if (!this.currentPurchase || this.getCurrentPurchaseSelectedDiscounts().length > 0) {
            return true;
        }

        if (this.hasVisibleCurrentPurchaseDiscountAssets() || this.currentPurchase.discountAssetsLoading !== true) {
            return true;
        }

        const pendingRequest = this.getCurrentPurchaseDiscountAssetsPendingRequest();
        if (!pendingRequest || typeof pendingRequest.then !== 'function') {
            return true;
        }

        const safeTimeoutMs = Math.max(100, Number(timeoutMs || SHOP_PURCHASE_COUPON_SYNC_SUBMIT_GRACE_MS) || SHOP_PURCHASE_COUPON_SYNC_SUBMIT_GRACE_MS);
        const result = await Promise.race([
            pendingRequest
                .then((payload) => ({ status: 'fulfilled', payload }))
                .catch((error) => ({ status: 'rejected', error })),
            new Promise((resolve) => {
                window.setTimeout(() => resolve({ status: 'timeout' }), safeTimeoutMs);
            })
        ]);

        if (result.status !== 'fulfilled') {
            return true;
        }

        this.applyCurrentPurchaseDiscountAssetsPayload(result.payload || {});
        if (!this.hasVisibleCurrentPurchaseDiscountAssets()) {
            return true;
        }

        this.setDiscountMessage(
            this.trShop('couponSyncFoundBeforePurchase', '发现当前商品有可用优惠，请确认是否使用后再兑换。'),
            { variant: 'info' }
        );
        return false;
    },

    requestAvailableDiscountAssets: async function ({ productId = '', quantity = 1, agentId = null, site = '', preferCache = false, allowPending = true } = {}) {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) {
            return {
                owned_discounts: [],
                claimable_discounts: []
            };
        }

        const token = await this.getAccessToken();
        const normalizedUserKey = String(this.discountAssetsCacheUserKey || 'guest').trim() || 'guest';
        const cacheKey = this.buildDiscountAssetsCacheKey({
            productId: normalizedProductId,
            quantity,
            agentId,
            site,
            userKey: normalizedUserKey
        });

        if (preferCache) {
            const cachedPayload = this.readDiscountAssetsCache(cacheKey);
            if (cachedPayload) {
                return cachedPayload;
            }
        }

        if (allowPending && this.discountAssetsRequestCache instanceof Map && this.discountAssetsRequestCache.has(cacheKey)) {
            const pendingPayload = await this.discountAssetsRequestCache.get(cacheKey);
            return this.cloneDiscountAssetsPayload(pendingPayload);
        }

        if (!(this.discountAssetsRequestCache instanceof Map)) {
            this.discountAssetsRequestCache = new Map();
        }
        if (!(this.discountAssetsRequestControllers instanceof Map)) {
            this.discountAssetsRequestControllers = new Map();
        }

        const abortController = typeof AbortController === 'function'
            ? new AbortController()
            : null;
        if (abortController) {
            this.discountAssetsRequestControllers.set(cacheKey, abortController);
        }

        const request = (async () => {
            if (!token) {
                const emptyPayload = {
                    owned_discounts: [],
                    claimable_discounts: []
                };
                if ((this.discountAssetsCacheUserKey || 'guest') === normalizedUserKey) {
                    this.writeDiscountAssetsCache(cacheKey, emptyPayload);
                }
                return emptyPayload;
            }

            let response;
            try {
                response = await fetch('/api/shop/available-discounts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    signal: abortController?.signal,
                    body: JSON.stringify({
                        productId: normalizedProductId,
                        quantity: Math.max(1, Math.trunc(Number(quantity || 1) || 1)),
                        agentId: agentId ?? this.currentAgentId,
                        site: site || window.SiteConfig?.site || 'cn'
                    })
                });
            } catch (error) {
                throw this.normalizeShopRequestError(error, {
                    fallbackMessage: '卡券列表连接失败，请刷新页面后重试'
                });
            }

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.message || '加载优惠券失败');
            }

            const normalizedPayload = {
                owned_discounts: Array.isArray(payload?.owned_discounts) ? payload.owned_discounts : [],
                claimable_discounts: Array.isArray(payload?.claimable_discounts) ? payload.claimable_discounts : []
            };

            if ((this.discountAssetsCacheUserKey || 'guest') === normalizedUserKey) {
                this.writeDiscountAssetsCache(cacheKey, normalizedPayload);
            }

            return normalizedPayload;
        })()
            .finally(() => {
                if (this.discountAssetsRequestCache instanceof Map) {
                    this.discountAssetsRequestCache.delete(cacheKey);
                }
                if (this.discountAssetsRequestControllers instanceof Map) {
                    const currentController = this.discountAssetsRequestControllers.get(cacheKey);
                    if (!abortController || currentController === abortController) {
                        this.discountAssetsRequestControllers.delete(cacheKey);
                    }
                }
            });
        this.discountAssetsRequestCache.set(cacheKey, request);

        const payload = await request;
        return this.cloneDiscountAssetsPayload(payload);
    },

    prefetchDiscountAssetsForProduct: async function ({ productId = '', quantity = 1, agentId = null, site = '' } = {}) {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) {
            return;
        }

        try {
            await this.requestAvailableDiscountAssets({
                productId: normalizedProductId,
                quantity,
                agentId: agentId ?? this.currentAgentId,
                site: site || window.SiteConfig?.site || 'cn',
                preferCache: true,
                allowPending: true
            });
        } catch (error) {
            console.debug('Background discount assets prefetch failed:', error?.message || error);
        }
    },

    getCurrentPurchaseDisplayName: function () {
        if (!this.currentPurchase) return '';
        return this.isEnglishShopLocale() && this.currentPurchase.productNameEn
            ? this.currentPurchase.productNameEn
            : (this.currentPurchase.productName || this.currentPurchase.productNameEn || '');
    },

    isDiscountRelevantToCurrentPurchase: function (item = {}) {
        if (!this.currentPurchase) return false;

        const scopeType = String(item?.scope_type || 'all').trim().toLowerCase() || 'all';
        if (scopeType === 'all') return true;

        const currentProductId = String(this.currentPurchase.productId || '').trim();
        if (scopeType === 'product') {
            return String(item?.scope_product_id || item?.scope_product?.id || '').trim() === currentProductId;
        }

        if (scopeType === 'category') {
            const currentCategory = String(this.currentPurchase.productCategory || '').trim();
            return Boolean(currentCategory && String(item?.scope_category || '').trim() === currentCategory);
        }

        return false;
    },

    estimateDiscountSavingsForEngagement: function (item = {}) {
        const previewDiscountAmount = Number(item?.preview?.discount_amount);
        if (Number.isFinite(previewDiscountAmount) && previewDiscountAmount > 0) {
            return previewDiscountAmount;
        }

        const subtotal = Math.max(0, Number(this.getCurrentPurchaseSubtotal?.() || 0) || 0);
        if (subtotal <= 0) return 0;

        const preciseFinalTotal = this.getDiscountPrecisePreviewTotal(item);
        if (Number.isFinite(preciseFinalTotal) && preciseFinalTotal >= 0) {
            return Math.max(0, Number((subtotal - preciseFinalTotal).toFixed(2)));
        }

        const discountType = String(item?.discount_type || item?.discountType || '').trim().toLowerCase();
        const discountValue = Number(item?.discount_value ?? item?.discountValue);
        if (!Number.isFinite(discountValue) || discountValue <= 0) return 0;

        if (discountType === 'fixed') {
            return Math.min(subtotal, discountValue);
        }
        if (discountType === 'percent') {
            return Math.max(0, Number((subtotal - (subtotal * discountValue / 100)).toFixed(2)));
        }

        return 0;
    },

    selectShopDiscountEngagementOffer: function () {
        if (!this.currentPurchase) return null;

        const ownedOffers = (Array.isArray(this.currentPurchase.availableDiscountAssets) ? this.currentPurchase.availableDiscountAssets : [])
            .filter((item) => item?.available !== false && this.isDiscountRelevantToCurrentPurchase(item))
            .map((item) => ({
                type: 'owned',
                item,
                savings: this.estimateDiscountSavingsForEngagement(item)
            }));
        const claimableOffers = (Array.isArray(this.currentPurchase.claimableDiscounts) ? this.currentPurchase.claimableDiscounts : [])
            .filter((item) => item?.can_claim !== false && this.isDiscountRelevantToCurrentPurchase(item))
            .map((item) => ({
                type: 'claimable',
                item,
                savings: this.estimateDiscountSavingsForEngagement(item)
            }));

        return [...ownedOffers, ...claimableOffers]
            .sort((left, right) => {
                const savingsDelta = Number(right.savings || 0) - Number(left.savings || 0);
                if (savingsDelta) return savingsDelta;
                if (left.type !== right.type) return left.type === 'owned' ? -1 : 1;
                return String(left.item?.code || '').localeCompare(String(right.item?.code || ''));
            })[0] || null;
    },

    buildShopDiscountEngagementBubble: function (offer = {}) {
        const item = offer?.item || {};
        const productId = String(this.currentPurchase?.productId || '').trim();
        const code = String(item?.code || '').trim().toUpperCase();
        const discountId = String(item?.discount_id || '').trim();
        const assetId = String(item?.asset_id || '').trim();
        const productName = this.getCurrentPurchaseDisplayName();
        const benefitLabel = this.getDiscountBenefitLabel(item) || this.trShop('coupon', '优惠券');
        const savings = Number(offer?.savings || 0);
        const pointsLabel = this.getShopPointsLabel({ lowercaseEnglish: this.isEnglishShopLocale() });
        const savingsText = savings > 0
            ? (this.isEnglishShopLocale()
                ? this.trShop('savedAmount', 'Save {amount}', { amount: `${this.formatShopPointValue(savings)} ${pointsLabel}` })
                : `预计可省 ${this.formatShopPointValue(savings)} ${pointsLabel}`)
            : '';
        const title = offer.type === 'claimable'
            ? (this.isEnglishShopLocale() ? 'Coupon available' : '有优惠券可以领取')
            : (this.isEnglishShopLocale() ? 'Coupon ready to use' : '这件商品有可用优惠');
        const content = offer.type === 'claimable'
            ? (this.isEnglishShopLocale()
                ? `${productName || 'This product'} has ${benefitLabel} available${savingsText ? `, ${savingsText}` : ''}. Claim it before checkout.`
                : `${productName ? `「${productName}」` : '这件商品'}有 ${benefitLabel} 可领取${savingsText ? `，${savingsText}` : ''}，领取后可在结算时使用。`)
            : (this.isEnglishShopLocale()
                ? `${benefitLabel}${code ? ` (${code})` : ''} can be used for ${productName || 'this product'}${savingsText ? `, ${savingsText}` : ''}.`
                : `${benefitLabel}${code ? `（${code}）` : ''} 可用于${productName ? `「${productName}」` : '当前商品'}${savingsText ? `，${savingsText}` : ''}。`);
        const sourceEventId = [
            'shop_discount_offer',
            offer.type,
            productId,
            assetId || discountId || code
        ].filter(Boolean).join(':');
        const actionUrl = productId
            ? `/shop.html?productId=${encodeURIComponent(productId)}`
            : '/shop.html';

        return {
            id: sourceEventId,
            source: 'client_event',
            source_module: 'shop',
            source_event_id: sourceEventId,
            page_id: 'shop',
            site: window.SiteConfig?.site || 'cn',
            title,
            content,
            action_label: offer.type === 'claimable'
                ? (this.isEnglishShopLocale() ? 'Claim' : '去领取')
                : (this.isEnglishShopLocale() ? 'Use coupon' : '去使用'),
            action_url: actionUrl,
            tone: offer.type === 'claimable' ? 'success' : 'info',
            priority: offer.type === 'claimable' ? 62 : 60,
            dismiss_ttl_hours: 12,
            metadata: {
                event_type: offer.type === 'claimable' ? 'coupon_available' : 'product_discount_available',
                product_id: productId,
                product_name: productName || null,
                discount_id: discountId || null,
                discount_asset_id: assetId || null,
                discount_code: code || null,
                benefit_label: benefitLabel,
                estimated_savings: savings,
                source: 'shop_product_discount_assets'
            }
        };
    },

    showShopDiscountEngagementBubble: function (bubble = {}, options = {}) {
        const sourceEventId = String(bubble?.source_event_id || bubble?.id || '').trim();
        if (!sourceEventId) return;

        if (!(this.shopDiscountEngagementSeenKeys instanceof Set)) {
            this.shopDiscountEngagementSeenKeys = new Set();
        }
        if (this.shopDiscountEngagementSeenKeys.has(sourceEventId)) {
            return;
        }

        const triggerType = String(bubble?.metadata?.event_type || '').trim();
        const trigger = window.ZaoyoeEngagement?.trigger;
        const show = window.ZaoyoeEngagement?.show;
        if (typeof trigger !== 'function' && typeof show !== 'function') {
            if (options.retry === false) return;
            window.setTimeout(() => {
                this.showShopDiscountEngagementBubble(bubble, { retry: false });
            }, 900);
            return;
        }

        this.shopDiscountEngagementSeenKeys.add(sourceEventId);
        const fallbackShow = () => {
            if (typeof show === 'function') show(bubble);
        };
        if (triggerType && typeof trigger === 'function') {
            const triggeredEngagement = this.triggerShopEngagementEvent(triggerType, {
                ...(bubble.metadata || {}),
                source: bubble.metadata?.source || 'shop_product_discount_assets',
                source_event_id: sourceEventId,
                product_id: bubble.metadata?.product_id || null,
                discount_id: bubble.metadata?.discount_id || null,
                discount_asset_id: bubble.metadata?.discount_asset_id || null,
                benefit_label: bubble.metadata?.benefit_label || '',
                action_url: bubble.action_url || '',
                action_label: bubble.action_label || ''
            }, { once: true });
            if (triggerType === 'product_discount_available' && Number(bubble.metadata?.estimated_savings || 0) > 0) {
                this.triggerShopEngagementEvent('product_discount', {
                    ...(bubble.metadata || {}),
                    source: 'shop_product_discount_assets',
                    source_event_id: `product_discount:${sourceEventId}`,
                    product_id: bubble.metadata?.product_id || null,
                    discount_id: bubble.metadata?.discount_id || null,
                    discount_asset_id: bubble.metadata?.discount_asset_id || null,
                    benefit_label: bubble.metadata?.benefit_label || '',
                    estimated_savings: Number(bubble.metadata?.estimated_savings || 0) || null
                }, { once: true });
            }
            if (triggeredEngagement && typeof triggeredEngagement.then === 'function') {
                triggeredEngagement
                    .then((shown) => {
                        if (!shown) fallbackShow();
                    })
                    .catch(() => fallbackShow());
                return;
            }
            if (triggeredEngagement) return;
        }

        fallbackShow();
    },

    triggerShopEngagementEvent: function (triggerType = 'page_view', metadata = {}, options = {}) {
        const trigger = window.ZaoyoeEngagement?.trigger;
        if (typeof trigger !== 'function') return null;
        const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        try {
            return trigger(triggerType, {
                source_module: 'shop',
                page_id: 'shop',
                site: window.SiteConfig?.site || 'cn',
                ...normalizedMetadata
            }, {
                once: options.once !== false
            });
        } catch (error) {
            console.debug('[ShopEngagement] Trigger skipped:', triggerType, error?.message || error);
            return null;
        }
    },

    buildShopRechargeReturnContext: function (target = 'product_purchase', options = {}) {
        const normalizedTarget = String(target || options.target || '').trim().toLowerCase();
        const isCartTarget = normalizedTarget.includes('cart');
        const productId = String(options.productId || this.currentPurchase?.productId || '').trim();
        const quantity = Math.max(1, Math.trunc(Number(options.quantity || this.currentPurchase?.quantity || 1) || 1));
        const cartSnapshot = isCartTarget ? this.getCartEngagementSnapshot() : null;

        return {
            shop_return_target: isCartTarget ? 'cart' : 'product_purchase',
            shop_return_source: String(options.source || '').trim() || (isCartTarget ? 'cart_checkout_insufficient_points' : 'product_purchase_insufficient_points'),
            shop_return_product_id: isCartTarget ? null : (productId || null),
            shop_return_product_ids: isCartTarget ? (cartSnapshot?.productIds || []) : (productId ? [productId] : []),
            shop_return_quantity: isCartTarget ? null : quantity,
            shop_return_checkout: isCartTarget && options.checkout !== false
        };
    },

    resumeAfterWalletRecharge: function (context = {}) {
        const source = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
        const target = String(source.shop_return_target || source.shopReturnTarget || '').trim().toLowerCase();
        const productId = String(source.shop_return_product_id || source.shopReturnProductId || '').trim();
        const quantity = Math.max(1, Math.trunc(Number(source.shop_return_quantity || source.shopReturnQuantity || 1) || 1));
        const shouldOpenCheckout = source.shop_return_checkout === true
            || source.shop_return_checkout === 'true'
            || source.shopReturnCheckout === true
            || source.shopReturnCheckout === 'true';

        if (target === 'cart' || target === 'cart_checkout') {
            this.closePurchaseModal();
            this.renderCart();
            const opened = this.openCartFromEngagement();
            if (opened && shouldOpenCheckout) {
                window.setTimeout(() => {
                    this.openCartCheckoutModal();
                }, 360);
            }
            return opened;
        }

        if (!productId) {
            return false;
        }

        const product = this.getCachedProductById(productId);
        if (!product) {
            this.pendingProductSpotlight = {
                productId,
                autoOpen: true,
                expandedSearch: false,
                initialQuantity: quantity,
                sourceContext: {
                    sourcePage: 'wallet',
                    sourceChannel: 'recharge_return',
                    sourcePromptId: null
                }
            };
            void this.fulfillPendingProductSpotlight();
            return true;
        }

        const pricing = this.resolveProductPricing(product, this.agentPricesCache || {});
        const price = Number(pricing?.currentPrice ?? product.price ?? product.price_paid ?? 0) || 0;
        const quantityCap = this.getPurchaseQuantityCapForProduct(product, product.max_purchase_quantity);
        const card = this.findRenderedProductCard(productId);
        if (card) {
            try {
                card.scrollIntoView({
                    behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
                    block: 'center'
                });
            } catch (_error) {
                card.scrollIntoView();
            }
            this.spotlightProductCard(card);
        }

        this.openPurchaseModal(
            productId,
            product.name || product.title || '',
            product.name_en || '',
            price,
            Array.isArray(product.quantity_rules) ? product.quantity_rules : [],
            quantityCap,
            product.show_purchase_notes === true ? this.getLocalizedProductGuidanceText(product, 'purchase_notes') : '',
            product.show_usage_instructions === true ? this.getLocalizedProductGuidanceText(product, 'usage_instructions') : '',
            {
                category: product.category || '',
                initialQuantity: quantity,
                sourceContext: {
                    sourcePage: 'wallet',
                    sourceChannel: 'recharge_return',
                    sourcePromptId: null
                }
            }
        );
        void this.refreshCurrentPurchaseGuidance(productId);
        void this.syncPurchaseAccessAfterOpen(productId, quantityCap);
        return true;
    },

    maybeTriggerProductRestockedEngagement: function (products = []) {
        if (!(this.productStockSnapshot instanceof Map)) {
            this.productStockSnapshot = new Map();
        }

        const currentSnapshot = new Map();
        (Array.isArray(products) ? products : []).forEach((product) => {
            const productId = String(product?.id || '').trim();
            if (!productId) return;
            const stockCount = Math.max(0, Math.trunc(Number(product?.stock_count ?? product?.stockCount ?? 0) || 0));
            const previous = this.productStockSnapshot.get(productId);
            currentSnapshot.set(productId, {
                stockCount,
                productName: String(product?.name || product?.title || '').trim(),
                category: String(product?.category || '').trim(),
                isActive: product?.is_active !== false
            });

            if (!previous || previous.stockCount > 0 || stockCount <= 0 || product?.is_active === false) {
                return;
            }

            this.triggerShopEngagementEvent('product_restocked', {
                source_module: 'shop.inventory',
                source: 'shop_product_stock_refresh',
                source_event_id: `product_restocked:${productId}:${stockCount}`,
                product_id: productId,
                product_name: String(product?.name || product?.title || '').trim() || null,
                category: String(product?.category || '').trim() || null,
                previous_stock_count: previous.stockCount,
                stock_count: stockCount
            }, { once: true });
        });

        this.productStockSnapshot = currentSnapshot;
    },

    getCartEngagementSnapshot: function () {
        const entries = this.getCartEntries();
        const productIds = entries.map((entry) => String(entry.productId || '').trim()).filter(Boolean);
        const productNames = entries
            .map((entry) => String(entry.displayName || this.getLocalizedProductName(entry.product) || '').trim())
            .filter(Boolean);
        const totalQuantity = entries.reduce((total, entry) => total + (Number(entry.quantity || 0) || 0), 0);
        const totalPoints = entries.reduce((total, entry) => {
            const unitPrice = Number(entry.finalUnitPrice ?? entry.unitPrice ?? entry.product?.price ?? 0) || 0;
            return total + unitPrice * (Number(entry.quantity || 0) || 0);
        }, 0);
        return {
            productIds,
            productNames,
            itemCount: entries.length,
            totalQuantity,
            totalPoints
        };
    },

    clearCartAbandonEngagementTimer: function () {
        if (!this.cartAbandonEngagementTimer) return;
        window.clearTimeout(this.cartAbandonEngagementTimer);
        this.cartAbandonEngagementTimer = null;
    },

    scheduleCartAbandonEngagement: function (delayMs = SHOP_CART_ABANDON_ENGAGEMENT_DELAY_MS) {
        this.clearCartAbandonEngagementTimer();
        if (!this.cartItems || this.cartItems.size === 0) return;
        const safeDelay = Math.max(1000, Number(delayMs || SHOP_CART_ABANDON_ENGAGEMENT_DELAY_MS) || SHOP_CART_ABANDON_ENGAGEMENT_DELAY_MS);
        this.cartAbandonEngagementTimer = window.setTimeout(() => {
            this.cartAbandonEngagementTimer = null;
            if (!this.cartItems || this.cartItems.size === 0 || this.cartOpen || this.cartCheckoutProcessing || this.purchaseProcessing) {
                return;
            }
            const snapshot = this.getCartEngagementSnapshot();
            if (!snapshot.itemCount) return;
            this.triggerShopEngagementEvent('cart_abandoned', {
                source_event_id: `cart_abandoned:${snapshot.productIds.slice().sort().join(',')}:${snapshot.totalQuantity}`,
                source: 'cart_idle',
                product_ids: snapshot.productIds,
                product_names: snapshot.productNames.slice(0, 4),
                item_count: snapshot.itemCount,
                total_quantity: snapshot.totalQuantity,
                total_points: snapshot.totalPoints
            });
        }, safeDelay);
    },

    triggerShopOrderEngagement: function (triggerType = 'order_delivered', metadata = {}) {
        const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        const rawOrderIds = Array.isArray(normalizedMetadata.order_ids)
            ? normalizedMetadata.order_ids
            : [normalizedMetadata.order_id || normalizedMetadata.orderId];
        const orderIds = rawOrderIds.map((item) => String(item || '').trim()).filter(Boolean);
        const sourceEventId = String(normalizedMetadata.source_event_id || '').trim()
            || `${triggerType}:${orderIds.join(',') || String(normalizedMetadata.product_id || normalizedMetadata.productId || 'unknown').trim()}`;
        return this.triggerShopEngagementEvent(triggerType, {
            source_event_id: sourceEventId,
            source: normalizedMetadata.source || 'shop_order',
            order_ids: orderIds,
            ...normalizedMetadata
        });
    },

    getShopSupabaseClient: function () {
        return window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    },

    getCurrentShopSite: function () {
        const site = String(window.SiteConfig?.site || '').trim().toLowerCase();
        if (site === 'cn' || site === 'intl') {
            return site;
        }
        const hostname = String(window.location?.hostname || '').trim().toLowerCase();
        return hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz') ? 'intl' : 'cn';
    },

    isRealtimeRowForCurrentShopSite: function (row = {}) {
        const rowSite = String(row?.site || '').trim().toLowerCase();
        if (!rowSite || (rowSite !== 'cn' && rowSite !== 'intl')) {
            return true;
        }
        return rowSite === this.getCurrentShopSite();
    },

    clearStorefrontRealtimeRetryTimer: function () {
        if (this.storefrontRealtimeRetryTimer) {
            window.clearTimeout(this.storefrontRealtimeRetryTimer);
            this.storefrontRealtimeRetryTimer = null;
        }
    },

    clearStorefrontRealtimeFallbackRefreshTimer: function () {
        if (this.storefrontRealtimeFallbackRefreshTimer) {
            window.clearTimeout(this.storefrontRealtimeFallbackRefreshTimer);
            this.storefrontRealtimeFallbackRefreshTimer = null;
        }
    },

    clearStorefrontRealtimeRefreshTimers: function () {
        if (this.storefrontRealtimeRefreshTimer) {
            window.clearTimeout(this.storefrontRealtimeRefreshTimer);
            this.storefrontRealtimeRefreshTimer = null;
        }
        this.clearStorefrontRealtimeFallbackRefreshTimer();
        if (this.storefrontRealtimeOrderRefreshTimer) {
            window.clearTimeout(this.storefrontRealtimeOrderRefreshTimer);
            this.storefrontRealtimeOrderRefreshTimer = null;
        }
    },

    teardownStorefrontRealtime: function ({ preserveRetry = false } = {}) {
        if (!preserveRetry) {
            this.clearStorefrontRealtimeRetryTimer();
        }
        if (this.storefrontRealtimeSubscription) {
            try {
                this.storefrontRealtimeSubscription.unsubscribe?.();
            } catch (error) {
                console.warn('[ShopRealtime] Failed to unsubscribe storefront realtime:', error?.message || error);
            }
        }
        this.storefrontRealtimeSubscription = null;
        this.storefrontRealtimeStatus = 'idle';
        this.storefrontRealtimeSite = '';
        this.storefrontRealtimeUserId = '';
    },

    scheduleStorefrontRealtimeRetry: function (reason = 'degraded') {
        this.clearStorefrontRealtimeRetryTimer();
        this.storefrontRealtimeRetryTimer = window.setTimeout(() => {
            this.storefrontRealtimeRetryTimer = null;
            void this.setupStorefrontRealtime({ force: true, reason });
        }, SHOP_REALTIME_RETRY_MS);
    },

    scheduleStorefrontRealtimeFallbackCatalogRefresh: function (reason = 'realtime_degraded') {
        if (!document.getElementById('userShopGrid') || this.storefrontRealtimeStatus === 'active') {
            return;
        }
        if (this.storefrontRealtimeFallbackRefreshTimer) {
            return;
        }

        this.storefrontRealtimeFallbackRefreshTimer = window.setTimeout(() => {
            this.storefrontRealtimeFallbackRefreshTimer = null;
            if (this.storefrontRealtimeStatus === 'active') {
                return;
            }
            this.scheduleShopRealtimeCatalogRefresh(`${reason}_fallback`);
            this.scheduleStorefrontRealtimeFallbackCatalogRefresh(reason);
        }, SHOP_REALTIME_FALLBACK_REFRESH_MS);
    },

    scheduleShopRealtimeCatalogRefresh: function (reason = 'catalog_change') {
        if (!document.getElementById('userShopGrid')) {
            return;
        }

        if (this.storefrontRealtimeRefreshTimer) {
            window.clearTimeout(this.storefrontRealtimeRefreshTimer);
        }

        this.storefrontRealtimeRefreshTimer = window.setTimeout(() => {
            this.storefrontRealtimeRefreshTimer = null;
            void (async () => {
                try {
                    await this.refreshStorefrontCatalogFromRealtime();
                    this.syncCurrentPurchaseInventoryFromCatalog();
                    console.debug('[ShopRealtime] Catalog refreshed:', reason);
                } catch (error) {
                    console.warn('[ShopRealtime] Catalog refresh failed:', error?.message || error);
                }
            })();
        }, SHOP_REALTIME_REFRESH_DEBOUNCE_MS);
    },

    computeShopCatalogSignature: function (products) {
        if (!Array.isArray(products) || products.length === 0) {
            return '';
        }
        try {
            return products
                .map((p) => {
                    if (!p || typeof p !== 'object') return '';
                    // 仅采样会影响商品卡可见呈现的字段；其它字段（更新时间、内部 flag 等）
                    // 即便变化也不应触发整页 grid 重渲染。
                    return [
                        p.id || '',
                        p.product_id || '',
                        p.category || '',
                        p.name || '',
                        p.name_en || '',
                        p.description || '',
                        p.description_en || '',
                        p.icon_url || '',
                        p.cover_image || '',
                        p.image_url || '',
                        p.price ?? '',
                        p.original_price ?? '',
                        p.currency || '',
                        p.stock_count ?? p.stockCount ?? '',
                        p.max_purchase_quantity ?? '',
                        p.is_active ? 1 : 0,
                        p.sold_out ? 1 : 0,
                        p.flash_sale_price ?? '',
                        p.flash_sale_end_time || p.flash_sale_end_at || '',
                        Array.isArray(p.tiered_pricing) ? p.tiered_pricing.length : 0
                    ].join('|');
                })
                .join('~');
        } catch (_error) {
            return '';
        }
    },

    refreshStorefrontCatalogFromRealtime: async function () {
        const catalog = await this.fetchShopCatalogFromApi({ forceRefresh: true });
        const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
        const products = Array.isArray(catalog?.products) ? this.filterProductsForCurrentSite(catalog.products) : [];
        const filtersContainer = document.getElementById('shopCategoryFilters');

        if (categories.length > 0) {
            this.availableCategories = categories;
            if (filtersContainer) {
                this.renderCategoryFilterButtons(filtersContainer, categories);
            }
        }

        // 短路：当 realtime 事件触发但商品可见字段并未变化时，跳过整页 grid 重渲染。
        // 这避免了 reuseShopProductCardElement 周期性地替换 breathe-shell.innerHTML 与
        // setAttribute('class', ...)，进而消除了呼吸过程中 “每 4-5 个循环水平对齐一下” 的现象。
        const nextSignature = this.computeShopCatalogSignature(products);
        if (nextSignature && nextSignature === this.lastShopCatalogSignature) {
            this.hydrateProductCaches(products);
            return;
        }
        this.lastShopCatalogSignature = nextSignature;

        this.hydrateProductCaches(products);
        await this.loadProducts();
    },

    scheduleShopRealtimeOrderRefresh: function (reason = 'order_change') {
        const list = document.getElementById('ordersList');
        if (!list || this.ordersLoading || (!this.ordersLoaded && !list.querySelector('.shop-order-history-item'))) {
            return;
        }

        if (this.storefrontRealtimeOrderRefreshTimer) {
            window.clearTimeout(this.storefrontRealtimeOrderRefreshTimer);
        }

        this.storefrontRealtimeOrderRefreshTimer = window.setTimeout(() => {
            this.storefrontRealtimeOrderRefreshTimer = null;
            void this.loadMyOrders({ preserveExisting: true, reason }).catch((error) => {
                console.warn('[ShopRealtime] Order refresh failed:', error?.message || error);
            });
        }, SHOP_REALTIME_REFRESH_DEBOUNCE_MS);
    },

    getRealtimePayloadRow: function (payload = {}) {
        const nextRow = payload?.new && typeof payload.new === 'object' && !Array.isArray(payload.new)
            ? payload.new
            : null;
        const oldRow = payload?.old && typeof payload.old === 'object' && !Array.isArray(payload.old)
            ? payload.old
            : null;
        return nextRow || oldRow || {};
    },

    handleShopCatalogRealtimePayload: function (payload = {}, sourceTable = 'shop_products') {
        const row = this.getRealtimePayloadRow(payload);
        if (!this.isRealtimeRowForCurrentShopSite(row)) {
            return;
        }
        this.scheduleShopRealtimeCatalogRefresh(sourceTable);
    },

    handleShopOrderRealtimePayload: function (payload = {}, userId = '') {
        const row = this.getRealtimePayloadRow(payload);
        const normalizedUserId = String(userId || '').trim();
        const rowUserId = String(row?.user_id || '').trim();
        if (normalizedUserId && rowUserId && rowUserId !== normalizedUserId) {
            return;
        }
        if (!this.isRealtimeRowForCurrentShopSite(row)) {
            return;
        }
        this.scheduleShopRealtimeOrderRefresh('order_change');
    },

    markStorefrontRealtimeDegraded: function (reason = 'channel_error') {
        this.storefrontRealtimeStatus = 'degraded';
        console.warn('[ShopRealtime] Realtime degraded, existing catalog/order reads remain available:', reason);
        this.scheduleStorefrontRealtimeRetry(reason);
        this.scheduleShopRealtimeCatalogRefresh(`${reason}_snapshot`);
        this.scheduleStorefrontRealtimeFallbackCatalogRefresh(reason);
    },

    setupStorefrontRealtime: async function ({ force = false, reason = 'init' } = {}) {
        if (!document.getElementById('userShopGrid')) {
            return;
        }

        const client = this.getShopSupabaseClient();
        const site = this.getCurrentShopSite();
        let userId = '';

        if (client?.auth && typeof client.auth.getUser === 'function') {
            try {
                const { data: { user } = {} } = await client.auth.getUser();
                userId = String(user?.id || '').trim();
            } catch (error) {
                console.warn('[ShopRealtime] Failed to resolve realtime user context:', error?.message || error);
            }
        }

        if (
            !force
            && this.storefrontRealtimeSubscription
            && this.storefrontRealtimeSite === site
            && this.storefrontRealtimeUserId === userId
        ) {
            return;
        }

        this.teardownStorefrontRealtime();
        this.storefrontRealtimeSite = site;
        this.storefrontRealtimeUserId = userId;

        if (typeof window.subscribeZaoyoeRealtime !== 'function' || !client) {
            this.markStorefrontRealtimeDegraded(!client ? 'missing_supabase_client' : 'missing_realtime_guard');
            return;
        }

        const channelName = `shop-storefront:${site}:${userId || 'guest'}`;
        this.storefrontRealtimeStatus = 'connecting';
        this.storefrontRealtimeSubscription = window.subscribeZaoyoeRealtime({
            client,
            channel: channelName,
            feature: 'shop-storefront',
            timeoutMs: SHOP_REALTIME_SUBSCRIBE_TIMEOUT_MS,
            build: (channel) => {
                channel.on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'shop_products'
                }, (payload) => this.handleShopCatalogRealtimePayload(payload, 'shop_products'));

                channel.on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'shop_categories'
                }, (payload) => this.handleShopCatalogRealtimePayload(payload, 'shop_categories'));

                if (userId) {
                    channel.on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'shop_orders',
                        filter: `user_id=eq.${userId}`
                    }, (payload) => this.handleShopOrderRealtimePayload(payload, userId));
                }

                return channel;
            },
            onActive: () => {
                this.storefrontRealtimeStatus = 'active';
                this.clearStorefrontRealtimeRetryTimer();
                this.clearStorefrontRealtimeFallbackRefreshTimer();
                console.debug('[ShopRealtime] Storefront realtime active:', reason);
            },
            onDegraded: (degradeReason) => {
                this.markStorefrontRealtimeDegraded(degradeReason);
            }
        });
    },

    bindShopRealtimeAuthSync: function () {
        if (this.shopRealtimeAuthBound) {
            return;
        }

        const client = this.getShopSupabaseClient();
        if (!client?.auth || typeof client.auth.onAuthStateChange !== 'function') {
            return;
        }

        try {
            const result = client.auth.onAuthStateChange(() => {
                window.setTimeout(() => {
                    void this.setupStorefrontRealtime({ force: true, reason: 'auth_change' });
                }, 120);
            });
            this.shopRealtimeAuthUnsubscribe = result?.data?.subscription || result?.subscription || result || null;
            this.shopRealtimeAuthBound = true;
        } catch (error) {
            console.warn('[ShopRealtime] Failed to bind auth sync:', error?.message || error);
        }
    },

    syncCurrentPurchaseInventoryFromCatalog: function () {
        const productId = String(this.currentPurchase?.productId || '').trim();
        if (!productId) {
            return;
        }

        const liveProduct = this.getCachedProductById(productId);
        if (!liveProduct) {
            return;
        }

        const quantityCap = this.getPurchaseQuantityCapForProduct(liveProduct, liveProduct.max_purchase_quantity);
        this.currentPurchase.configuredMaxQuantity = quantityCap;
        this.setCurrentPurchaseQuantityCap(quantityCap, {
            unlimited: this.currentPurchase.unlimitedPurchases === true
        });
    },

    maybeShowShopDiscountEngagement: function () {
        const offer = this.selectShopDiscountEngagementOffer();
        if (!offer) return;

        const bubble = this.buildShopDiscountEngagementBubble(offer);
        window.setTimeout(() => {
            if (!this.currentPurchase || String(this.currentPurchase.productId || '').trim() !== String(bubble.metadata?.product_id || '').trim()) {
                return;
            }
            this.showShopDiscountEngagementBubble(bubble);
        }, 450);
    },

    scheduleVisibleDiscountAssetsPrefetch: function (products = []) {
        if (this.discountAssetsPrefetchHandle) {
            clearTimeout(this.discountAssetsPrefetchHandle);
            this.discountAssetsPrefetchHandle = null;
        }

        const prefetchProducts = Array.isArray(products)
            ? products
                .filter((product) => String(product?.id || '').trim())
                .slice(0, SHOP_DISCOUNT_ASSETS_PREFETCH_LIMIT)
            : [];

        if (!prefetchProducts.length) {
            return;
        }

        const runPrefetch = () => {
            this.discountAssetsPrefetchHandle = null;
            prefetchProducts.forEach((product, index) => {
                window.setTimeout(() => {
                    void this.prefetchDiscountAssetsForProduct({
                        productId: String(product?.id || '').trim(),
                        quantity: 1,
                        agentId: this.currentAgentId,
                        site: window.SiteConfig?.site || 'cn'
                    });
                }, index * 40);
            });
        };

        this.discountAssetsPrefetchHandle = window.setTimeout(runPrefetch, 24);
    },

    resolveProductPricing: function (product, agentPrices = {}) {
        const basePrice = this.getProductPriceForCurrentSite(product);
        if (basePrice == null) {
            return {
                currentPrice: null,
                originalPrice: null,
                hasAgentPrice: false,
                hasFlashSale: false
            };
        }

        let currentPrice = Number(basePrice);
        let originalPrice = null;
        let hasAgentPrice = false;
        let hasFlashSale = false;

        if (this.currentAgentId && agentPrices?.[product?.id] && Number(agentPrices[product.id]) > currentPrice) {
            originalPrice = currentPrice;
            currentPrice = Number(agentPrices[product.id]);
            hasAgentPrice = true;
        }

        const now = Date.now();
        if (product?.flash_sale_price != null && product?.flash_sale_end && Date.parse(product.flash_sale_end) > now && !hasAgentPrice) {
            originalPrice = currentPrice;
            currentPrice = Number(product.flash_sale_price);
            hasFlashSale = true;
        }

        return {
            currentPrice,
            originalPrice,
            hasAgentPrice,
            hasFlashSale
        };
    },

    getActiveFlashSalePricingContext: function (product, fallbackPrice = null) {
        const pricing = product ? this.resolveProductPricing(product, this.agentPricesCache || {}) : null;
        const flashSalePrice = Number(pricing?.currentPrice ?? fallbackPrice);
        const flashSaleOriginalPrice = Number(pricing?.originalPrice);
        const hasFlashSale = pricing?.hasFlashSale === true
            && Number.isFinite(flashSalePrice)
            && Number.isFinite(flashSaleOriginalPrice)
            && flashSaleOriginalPrice > flashSalePrice;

        return {
            hasFlashSale,
            flashSalePrice: hasFlashSale ? flashSalePrice : null,
            flashSaleOriginalPrice: hasFlashSale ? flashSaleOriginalPrice : null
        };
    },

    getFlashSaleBadgeLabel: function () {
        return this.trShop('flashSaleBadge', this.isEnglishShopLocale() ? 'Flash' : '秒杀');
    },

    buildFlashSaleBadgeHtml: function (endTime) {
        return `<div class="flash-sale-badge flash-badge-glass" data-shop-card-flash-badge="true" data-endtime="${this.escapeAttribute(endTime || '')}"><span class="flash-sale-badge__label">${this.escapeHtml(this.getFlashSaleBadgeLabel())}</span> <span class="countdown-timer">${window.i18n?.t('shop.calculating') || '计算中...'}</span></div>`;
    },

    normalizeQuantityPricingRules: function (rules = []) {
        let sourceRules = rules;
        if (typeof sourceRules === 'string' && sourceRules.trim()) {
            try {
                sourceRules = JSON.parse(sourceRules);
            } catch (_) {
                sourceRules = [];
            }
        }

        return (Array.isArray(sourceRules) ? sourceRules : [])
            .map((rule) => {
                const qty = Math.trunc(Number(rule?.qty ?? rule?.quantity ?? rule?.min_quantity));
                const price = Number(rule?.price ?? rule?.unit_price);
                return { qty, price };
            })
            .filter((rule) => Number.isFinite(rule.qty)
                && Number.isFinite(rule.price)
                && rule.qty > 0
                && rule.price >= 0)
            .sort((a, b) => (a.qty - b.qty) || (a.price - b.price));
    },

    getTieredPricingContext: function ({ basePrice = 0, rules = [], quantity = 1 } = {}) {
        const normalizedBasePrice = Math.max(0, Number(basePrice || 0) || 0);
        const normalizedQuantity = Math.max(1, Math.trunc(Number(quantity || 1) || 1));
        const discountRules = this.normalizeQuantityPricingRules(rules)
            .filter((rule) => rule.price < normalizedBasePrice);

        if (!discountRules.length) {
            return null;
        }

        const activeRule = discountRules
            .filter((rule) => normalizedQuantity >= rule.qty)
            .sort((a, b) => (a.price - b.price) || (b.qty - a.qty))[0] || null;
        const nextRule = discountRules
            .filter((rule) => normalizedQuantity < rule.qty)
            .sort((a, b) => (a.qty - b.qty) || (a.price - b.price))[0] || null;
        const lowestRule = [...discountRules].sort((a, b) => (a.price - b.price) || (a.qty - b.qty))[0] || null;

        return {
            basePrice: normalizedBasePrice,
            quantity: normalizedQuantity,
            rules: discountRules,
            activeRule,
            nextRule,
            lowestRule,
            hasActiveTier: Boolean(activeRule)
        };
    },

    getTieredPricingLabel: function () {
        return this.trShop('tieredPrice', this.isEnglishShopLocale() ? 'Tiered price' : '阶梯价');
    },

    buildTieredPricingBadgeHtml: function () {
        return `<div class="tier-price-badge tier-badge-glass" data-shop-card-tier-badge="true">${this.escapeHtml(this.getTieredPricingLabel())}</div>`;
    },

    buildTieredPricingRulesHelpHtml: function (tieredPricing = null, pointsLabel = '') {
        const rules = Array.isArray(tieredPricing?.rules) ? tieredPricing.rules : [];
        if (!rules.length) {
            return '';
        }

        const isEn = this.isEnglishShopLocale();
        const fallbackPointsLabel = pointsLabel || this.getShopPointsLabel({ lowercaseEnglish: isEn });
        const title = this.trShop('tieredPriceRulesLabel', isEn ? 'Tiered pricing rules' : '阶梯定价规则');
        const helpLabel = this.trShop('tieredPriceRulesHelp', isEn ? 'View tiered pricing rules' : '查看阶梯定价规则');
        const rulesHtml = rules.map((rule) => `
            <span class="shop-tier-rules-popover__rule">${this.escapeHtml(this.trShop('tieredPriceRuleInline', isEn ? '{qty}+ {price} {unit}' : '满 {qty} 件 {price} {unit}', {
                qty: rule.qty,
                price: this.formatShopPointValue(rule.price),
                unit: fallbackPointsLabel
            }))}</span>
        `).join('');

        return `
            <span class="shop-tier-rules-popover-wrap">
                <button type="button" class="shop-tier-rules-help" aria-label="${this.escapeAttribute(helpLabel)}" aria-describedby="modalTierPricingRules" aria-expanded="false">?</button>
                <span id="modalTierPricingRules" class="shop-tier-rules-popover" role="tooltip">
                    <span class="shop-tier-rules-popover__title">${this.escapeHtml(title)}</span>
                    ${rulesHtml}
                </span>
            </span>
        `;
    },

    buildProductCardPurchaseDataset: function (product, unitPrice) {
        const productId = String(product?.id || '').trim();
        const maxPurchaseQuantity = this.getPurchaseQuantityCapForProduct(product, product?.max_purchase_quantity);
        const qtyRulesStr = product?.quantity_rules ? encodeURIComponent(JSON.stringify(product.quantity_rules)) : '';
        const stockCount = Number(product?.stock_count ?? product?.stockCount ?? 0);
        const normalizedStockCount = Number.isFinite(stockCount) ? Math.max(0, Math.trunc(stockCount)) : 0;

        return {
            productId,
            productName: product?.name || '',
            productNameEn: product?.name_en || '',
            unitPrice,
            productCategory: String(product?.category || ''),
            qtyRules: qtyRulesStr,
            maxPurchaseQuantity: String(maxPurchaseQuantity),
            stockCount: normalizedStockCount,
            stockState: normalizedStockCount <= 0 ? 'sold-out' : 'available',
            showPurchaseNotes: product?.show_purchase_notes === true,
            purchaseNotes: this.getLocalizedProductGuidanceText(product, 'purchase_notes'),
            showUsageInstructions: product?.show_usage_instructions === true,
            usageInstructions: this.getLocalizedProductGuidanceText(product, 'usage_instructions')
        };
    },

    buildProductCardPricingState: function (product, agentPrices = {}) {
        const pricing = this.resolveProductPricing(product, agentPrices);
        const currentPrice = pricing.currentPrice;
        if (currentPrice == null) {
            return null;
        }

        let originalPriceHtml = '';
        let flashSaleBadgeHtml = '';
        let flashShadowClass = '';
        let agentBadgeHtml = '';
        let tieredPricingBadgeHtml = '';
        const formattedCurrentPrice = this.formatShopPointValue(currentPrice);
        const formattedOriginalPrice = pricing.originalPrice != null
            ? this.formatShopPointValue(pricing.originalPrice)
            : '';

        if (pricing.originalPrice != null && pricing.hasAgentPrice) {
            originalPriceHtml = `<span class="shop-card-original-price">${formattedOriginalPrice}</span>`;
            agentBadgeHtml = `<div class="shop-agent-badge" data-shop-card-agent-badge="true">${window.i18n?.t('shop.exclusiveBuff') || '专属加持'}</div>`;
        }

        if (pricing.originalPrice != null && pricing.hasFlashSale && !agentBadgeHtml) {
            originalPriceHtml = `<span class="shop-card-original-price shop-card-original-price--flash">${formattedOriginalPrice}</span>`;
            flashSaleBadgeHtml = this.buildFlashSaleBadgeHtml(product.flash_sale_end);
            flashShadowClass = 'flash-sale-card';
        }

        if (!pricing.hasFlashSale && !pricing.hasAgentPrice) {
            const tieredPricing = this.getTieredPricingContext({
                basePrice: currentPrice,
                rules: product?.quantity_rules,
                quantity: 1
            });
            if (tieredPricing?.lowestRule) {
                tieredPricingBadgeHtml = this.buildTieredPricingBadgeHtml();
            }
        }

        return {
            currentPrice,
            priceHtml: `${originalPriceHtml}${formattedCurrentPrice} <span data-i18n="shop.points">${this.getShopPointsLabel()}</span>`,
            flashSaleBadgeHtml,
            flashShadowClass,
            tieredPricingBadgeHtml,
            agentBadgeHtml
        };
    },

    syncCurrentPurchasePricingFromCatalog: function () {
        if (!this.currentPurchase?.productId) return;

        const liveProduct = this.getCachedProductById(this.currentPurchase.productId);
        if (!liveProduct) return;

        const pricingState = this.buildProductCardPricingState(liveProduct, this.agentPricesCache || {});
        if (!pricingState) return;

        const flashSalePricing = this.getActiveFlashSalePricingContext(liveProduct, pricingState.currentPrice);
        const nextBasePrice = Number(flashSalePricing.hasFlashSale
            ? flashSalePricing.flashSalePrice
            : pricingState.currentPrice || 0);
        const currentBasePrice = Number(this.currentPurchase.basePrice || 0);
        if (!Number.isFinite(nextBasePrice)) {
            return;
        }

        this.currentPurchase.hasFlashSale = flashSalePricing.hasFlashSale;
        this.currentPurchase.flashSalePrice = flashSalePricing.flashSalePrice;
        this.currentPurchase.flashSaleOriginalPrice = flashSalePricing.flashSaleOriginalPrice;

        if (nextBasePrice === currentBasePrice) {
            this.renderPurchaseUnitPrice(this.currentPurchase.unitPrice);
            return;
        }

        this.currentPurchase.basePrice = nextBasePrice;
        this.updatePriceForQuantity(Math.max(1, Number(this.currentPurchase.quantity || 1) || 1));
        this.renderPurchaseConfirmationStage();
    },

    syncProductCardPricing: function (card, product, agentPrices = {}) {
        if (!(card instanceof HTMLElement) || !product) return;

        const pricingState = this.buildProductCardPricingState(product, agentPrices);
        if (!pricingState) return;

        const priceEl = card.querySelector('.shop-card-price');
        if (priceEl) {
            priceEl.innerHTML = pricingState.priceHtml;
        }

        card.classList.toggle('flash-sale-card', Boolean(pricingState.flashShadowClass));

        const imageShell = card.querySelector('.shop-card-image');
        if (imageShell instanceof HTMLElement) {
            const existingFlashBadge = imageShell.querySelector('[data-shop-card-flash-badge="true"]');
            if (pricingState.flashSaleBadgeHtml) {
                if (existingFlashBadge) {
                    existingFlashBadge.outerHTML = pricingState.flashSaleBadgeHtml;
                } else {
                    imageShell.insertAdjacentHTML('afterbegin', pricingState.flashSaleBadgeHtml);
                }
            } else {
                existingFlashBadge?.remove();
            }

            const existingTierBadge = imageShell.querySelector('[data-shop-card-tier-badge="true"]');
            if (pricingState.tieredPricingBadgeHtml) {
                if (existingTierBadge) {
                    existingTierBadge.outerHTML = pricingState.tieredPricingBadgeHtml;
                } else {
                    imageShell.insertAdjacentHTML('afterbegin', pricingState.tieredPricingBadgeHtml);
                }
            } else {
                existingTierBadge?.remove();
            }

            const existingAgentBadge = imageShell.querySelector('[data-shop-card-agent-badge="true"]');
            if (pricingState.agentBadgeHtml) {
                if (existingAgentBadge) {
                    existingAgentBadge.outerHTML = pricingState.agentBadgeHtml;
                } else {
                    const stockBadge = imageShell.querySelector('.shop-stock-badge--floating');
                    if (stockBadge instanceof HTMLElement) {
                        stockBadge.insertAdjacentHTML('beforebegin', pricingState.agentBadgeHtml);
                    } else {
                        imageShell.insertAdjacentHTML('beforeend', pricingState.agentBadgeHtml);
                    }
                }
            } else {
                existingAgentBadge?.remove();
            }
        }

        const purchaseDataset = this.buildProductCardPurchaseDataset(product, pricingState.currentPrice);
        const maxPurchaseQuantity = String(purchaseDataset.maxPurchaseQuantity || '');
        if (card.dataset.shopAction === 'buy-product' || card.dataset.shopAction === 'sold-out-product') {
            this.applyShopPurchaseDataset(card, purchaseDataset);
            card.dataset.maxPurchaseQuantity = maxPurchaseQuantity;
        }

        const cartTriggerButton = card.querySelector('.shop-card-cart-trigger[data-shop-action="add-product-to-cart"]');
        if (cartTriggerButton instanceof HTMLElement) {
            this.applyShopPurchaseDataset(cartTriggerButton, purchaseDataset);
            cartTriggerButton.dataset.maxPurchaseQuantity = maxPurchaseQuantity;
        }

        const productId = String(product.id || '').trim();
        if (productId) {
            this.updateCartSnapshot(productId, product, { unitPrice: pricingState.currentPrice });
        }
    },

    refreshVisibleProductCardPricing: function (agentPrices = this.agentPricesCache || {}) {
        document.querySelectorAll('#userShopGrid .shop-card[data-product-id]').forEach((card) => {
            const productId = String(card instanceof HTMLElement ? (card.dataset.productId || '') : '').trim();
            if (!productId) return;

            const product = this.getCachedProductById(productId);
            if (!product) return;

            this.syncProductCardPricing(card, product, agentPrices);
        });

        this.cartItems.forEach((_quantity, rawProductId) => {
            const productId = String(rawProductId || '').trim();
            if (!productId) return;

            const product = this.getCachedProductById(productId);
            if (!product) return;

            const pricingState = this.buildProductCardPricingState(product, agentPrices);
            if (!pricingState) return;

            this.updateCartSnapshot(productId, product, { unitPrice: pricingState.currentPrice });
        });

        this.syncCurrentPurchasePricingFromCatalog();
        this.renderCart();
    },

    getCartStorageKey: function () {
        return `shop_cart_v1:${window.SiteConfig?.site || 'cn'}`;
    },

    getCartCopy: function () {
        if (this.isEnglishShopLocale()) {
            return {
                anchorHint: 'Open cart',
                anchorEmptyTitle: 'Cart is empty',
                anchorEmptyBody: 'Add a few items, then review them together.',
                drawerEyebrow: 'Floating Cart',
                drawerTitle: 'Cart',
                drawerBody: 'Keep browsing, then checkout together.',
                emptyTitle: 'Your cart is empty',
                emptyBody: 'Add a few items from the product cards, then review quantity and total points here.',
                summaryItems: 'Items selected',
                summaryTotal: 'Estimated total',
                summaryNotes: 'Products with notes',
                summaryUsage: 'Products with instructions',
                continueLabel: 'Keep browsing',
                checkoutLabel: 'Checkout',
                addLabel: 'Add to cart',
                addMoreLabel: 'Add 1 more',
                inCartLabel: 'In cart',
                notesPill: 'Notes',
                usagePill: 'Instructions',
                removeLabel: 'Remove',
                cartTitle: 'Cart',
                checkoutReviewEyebrow: 'Cart Review',
                checkoutReviewTitle: 'Final review',
                checkoutReviewHint: 'We will submit the current cart items one by one. Any coupon already attached to an item will stay with that item.',
                checkoutReviewNotice: 'Cart checkout reuses the existing order flow item by item. Kept coupons will follow their original item, but cart checkout still does not recombine or stack coupons.',
                checkoutReviewCount: 'Item count',
                checkoutReviewTotal: 'Total points',
                checkoutReviewNotes: 'Products with notes',
                checkoutReviewUsage: 'Products with instructions',
                checkoutReviewBack: 'Back to cart',
                checkoutReviewConfirm: 'Confirm and redeem',
                cartEmptyToast: 'Add a few items first to preview the cart.',
                addedToast: 'Added to cart',
                removedToast: 'Removed from cart',
                cartCheckoutLabel: 'Cart checkout',
                partialWarningPrefix: 'Some items were redeemed, but checkout did not finish:',
                singleCheckoutHint: 'Single-item checkout now confirms directly in the purchase sheet while keeping the existing discount flow.'
            };
        }

        return {
            anchorHint: '点开购物车',
            anchorEmptyTitle: '购物车为空',
            anchorEmptyBody: '先加入几件，再统一看看数量和总积分。',
            drawerEyebrow: '浮动购物车',
            drawerTitle: '购物车',
            drawerBody: '先继续逛商品，再统一结算。',
            emptyTitle: '购物车还是空的',
            emptyBody: '先从商品卡片里加入几件，再回来统一看数量和总积分。',
            summaryItems: '已选商品',
            summaryTotal: '预计合计',
            summaryNotes: '含注意事项商品',
            summaryUsage: '结算后附使用说明',
            continueLabel: '继续逛逛',
            checkoutLabel: '结算',
            addLabel: '加入购物车',
            addMoreLabel: '再加 1 件',
            inCartLabel: '已加购',
            notesPill: '注意事项',
            usagePill: '使用说明',
            removeLabel: '移除',
            cartTitle: '购物车',
            checkoutReviewEyebrow: '购物车确认',
            checkoutReviewTitle: '统一确认',
            checkoutReviewHint: '购物车会按当前顺序逐个兑换，已经挂在商品上的优惠券会继续跟着该商品提交。',
            checkoutReviewNotice: '统一结算会沿用现有下单链路逐个提交。已选优惠会保留到对应商品上，但购物车里仍不支持重新组合或叠加优惠券。',
            checkoutReviewCount: '商品总数',
            checkoutReviewTotal: '合计积分',
            checkoutReviewNotes: '含注意事项商品',
            checkoutReviewUsage: '结算后附使用说明',
            checkoutReviewBack: '返回购物车',
            checkoutReviewConfirm: '确认并兑换',
            cartEmptyToast: '先从商品卡片里加购几件，再回来统一看。',
            addedToast: '已加入购物车',
            removedToast: '已从购物车移除',
            cartCheckoutLabel: '购物车结算',
            partialWarningPrefix: '已有部分商品兑换成功，但本次结算未全部完成：',
            singleCheckoutHint: '单商品结算现在会在当前面板直接确认，同时保留现有优惠码链路。'
        };
    },

    showShopToast: function (message, variant = 'success') {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) return;

        const toast = this.ensureShopToastElement();
        if (!toast) {
            if (window.WalletModal?.showToast) {
                window.WalletModal.showToast(normalizedMessage, variant);
                return;
            }
            console.info(`[ShopToast:${variant}]`, normalizedMessage);
            return;
        }

        toast.textContent = normalizedMessage;
        toast.dataset.variant = variant;
        toast.classList.add('is-visible');

        if (toast.__hideTimer) {
            clearTimeout(toast.__hideTimer);
        }
        toast.__hideTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 1800);
    },

    getCachedProductById: function (productId) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return null;

        if (Array.isArray(this.allProductsCache)) {
            const match = this.allProductsCache.find((product) => String(product?.id || '').trim() === normalizedId);
            if (match) return match;
        }

        const categoryLists = Object.values(this.categoryProductsCache || {});
        for (const list of categoryLists) {
            if (!Array.isArray(list)) continue;
            const match = list.find((product) => String(product?.id || '').trim() === normalizedId);
            if (match) return match;
        }

        return this.cartSnapshots?.[normalizedId] || null;
    },

    buildCartProductSnapshot: function (product, options = {}) {
        if (!product) return null;

        const resolvedUnitPrice = options.unitPrice ?? this.resolveProductPricing(product, this.agentPricesCache || {}).currentPrice;
        const existingSnapshot = options?.existingSnapshot && typeof options.existingSnapshot === 'object' && !Array.isArray(options.existingSnapshot)
            ? options.existingSnapshot
            : null;
        const normalizedAppliedDiscount = Object.prototype.hasOwnProperty.call(options, 'appliedDiscount')
            ? this.normalizeCartDiscountSnapshot(options.appliedDiscount)
            : this.normalizeCartDiscountSnapshot(existingSnapshot?.applied_discount || product?.applied_discount || null);

        return {
            id: String(product.id || '').trim(),
            name: product.name || '',
            name_en: product.name_en || '',
            description: product.description || '',
            description_en: product.description_en || '',
            show_product_description: product.show_product_description !== false,
            icon_url: product.icon_url || '',
            image_assets: normalizeShopProductImageAsset(product.image_assets || product.imageAssets) || {},
            category: product.category || '',
            stock_count: Number(product.stock_count || 0) || 0,
            max_purchase_quantity: this.normalizePurchaseQuantityCap(product.max_purchase_quantity),
            quantity_rules: Array.isArray(product.quantity_rules) ? product.quantity_rules : [],
            show_purchase_notes: product.show_purchase_notes === true,
            purchase_notes: product.purchase_notes || '',
            purchase_notes_zh: product.purchase_notes_zh || '',
            purchase_notes_en: product.purchase_notes_en || '',
            show_usage_instructions: product.show_usage_instructions === true,
            usage_instructions: product.usage_instructions || '',
            usage_instructions_zh: product.usage_instructions_zh || '',
            usage_instructions_en: product.usage_instructions_en || '',
            flash_sale_price: product.flash_sale_price ?? null,
            flash_sale_end: product.flash_sale_end || null,
            resolved_unit_price: resolvedUnitPrice == null ? null : Number(resolvedUnitPrice),
            applied_discount: normalizedAppliedDiscount
        };
    },

    updateCartSnapshot: function (productId, product, options = {}) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return;
        const snapshot = this.buildCartProductSnapshot(product, {
            ...options,
            existingSnapshot: this.cartSnapshots?.[normalizedId] || null
        });
        if (!snapshot) return;
        this.cartSnapshots[normalizedId] = snapshot;
    },

    getCartQuantityCap: function (product) {
        const normalizedCap = this.normalizePurchaseQuantityCap(product?.max_purchase_quantity);
        const stockCount = Number(product?.stock_count ?? product?.stockCount ?? 0);
        if (Number.isFinite(stockCount) && stockCount > 0) {
            return Math.max(1, Math.min(normalizedCap, Math.trunc(stockCount)));
        }
        return normalizedCap;
    },

    getPurchaseQuantityCapForProduct: function (product, fallbackMaxQuantity = null) {
        const stockCount = Number(product?.stock_count ?? product?.stockCount ?? 0);
        if (Number.isFinite(stockCount) && stockCount > 0) {
            return Math.max(1, Math.min(99, Math.trunc(stockCount)));
        }

        if (fallbackMaxQuantity != null && String(fallbackMaxQuantity).trim() !== '') {
            return this.normalizePurchaseQuantityCap(fallbackMaxQuantity);
        }

        return this.normalizePurchaseQuantityCap(product?.max_purchase_quantity);
    },

    restoreCartState: function () {
        try {
            const rawPayload = sessionStorage.getItem(this.getCartStorageKey());
            if (!rawPayload) {
                this.cartItems = new Map();
                this.cartSnapshots = {};
                return;
            }

            const parsed = JSON.parse(rawPayload);
            const nextItems = new Map();
            const storedItems = Array.isArray(parsed?.items) ? parsed.items : [];
            storedItems.forEach((entry) => {
                const [id, quantity] = Array.isArray(entry) ? entry : [];
                const normalizedId = String(id || '').trim();
                const normalizedQuantity = Number(quantity || 0);
                if (!normalizedId || !Number.isFinite(normalizedQuantity) || normalizedQuantity < 1) return;
                nextItems.set(normalizedId, Math.trunc(normalizedQuantity));
            });

            this.cartItems = nextItems;
            this.cartSnapshots = parsed?.snapshots && typeof parsed.snapshots === 'object'
                ? parsed.snapshots
                : {};
            this.sanitizeCartState({ persist: false });
        } catch (error) {
            console.warn('Failed to restore cart state:', error);
            this.cartItems = new Map();
            this.cartSnapshots = {};
        }
    },

    persistCartState: function () {
        try {
            sessionStorage.setItem(this.getCartStorageKey(), JSON.stringify({
                items: Array.from(this.cartItems.entries()),
                snapshots: this.cartSnapshots
            }));
        } catch (error) {
            console.warn('Failed to persist cart state:', error);
        }
    },

    sanitizeCartState: function ({ persist = true } = {}) {
        const nextItems = new Map();
        const nextSnapshots = {};

        this.cartItems.forEach((quantity, rawProductId) => {
            const productId = String(rawProductId || '').trim();
            if (!productId) return;

            const liveProduct = this.getCachedProductById(productId);
            const product = liveProduct || this.cartSnapshots?.[productId];
            if (!product) return;

            const quantityCap = this.getCartQuantityCap(product);
            const normalizedQuantity = Math.max(0, Math.min(quantityCap, Math.trunc(Number(quantity || 0) || 0)));
            if (normalizedQuantity < 1) return;

            nextItems.set(productId, normalizedQuantity);
            nextSnapshots[productId] = liveProduct
                ? (
                    this.buildCartProductSnapshot(liveProduct, {
                        existingSnapshot: this.cartSnapshots?.[productId] || null
                    }) || this.cartSnapshots?.[productId] || product
                )
                : (this.cartSnapshots?.[productId] || product);
        });

        this.cartItems = nextItems;
        this.cartSnapshots = nextSnapshots;
        this.cartItemDisclosureState = Object.fromEntries(
            Object.entries(this.cartItemDisclosureState || {}).filter(([productId]) => nextItems.has(productId))
        );
        if (this.cartItems.size === 0) {
            this.cartOpen = false;
        }

        if (persist) {
            this.persistCartState();
        }
    },

    getCartQuantity: function (productId) {
        const quantity = this.cartItems.get(String(productId || '').trim());
        return Number(quantity || 0) || 0;
    },

    getCartEntries: function () {
        const entries = [];
        const agentPrices = this.agentPricesCache || {};

        this.cartItems.forEach((quantity, rawProductId) => {
            const productId = String(rawProductId || '').trim();
            if (!productId) return;

            const liveProduct = this.getCachedProductById(productId);
            const product = liveProduct || this.cartSnapshots?.[productId];
            if (!product) return;

            if (liveProduct) {
                this.updateCartSnapshot(productId, liveProduct);
            }

            const pricing = this.resolveProductPricing(product, agentPrices);
            const unitPrice = pricing.currentPrice == null
                ? Number(product?.resolved_unit_price || 0) || 0
                : Number(pricing.currentPrice || 0) || 0;
            const subtotal = Number((unitPrice * quantity).toFixed(2));
            const rawAppliedDiscount = this.normalizeCartDiscountSnapshot(
                product?.applied_discount || this.cartSnapshots?.[productId]?.applied_discount || null,
                { quantity, subtotal }
            );
            const shouldApplyDiscount = Boolean(rawAppliedDiscount);
            const discountPricing = shouldApplyDiscount
                ? this.resolveCartDiscountPricing(rawAppliedDiscount, subtotal)
                : null;
            const discountAmount = Number.isFinite(discountPricing?.discountAmount)
                ? discountPricing.discountAmount
                : 0;
            const finalTotal = Number.isFinite(discountPricing?.finalTotal)
                ? discountPricing.finalTotal
                : subtotal;
            const appliedDiscount = shouldApplyDiscount && discountAmount > 0
                ? {
                    ...rawAppliedDiscount,
                    subtotal,
                    quantity,
                    discountAmount,
                    finalTotal
                }
                : null;
            const hasPurchaseNotes = product.show_purchase_notes === true && this.getLocalizedProductGuidanceText(product, 'purchase_notes').length > 0;
            const hasUsageInstructions = product.show_usage_instructions === true && this.getLocalizedProductGuidanceText(product, 'usage_instructions').length > 0;

            entries.push({
                productId,
                product,
                quantity,
                unitPrice,
                subtotal,
                discountAmount,
                finalTotal,
                totalPoints: appliedDiscount ? finalTotal : subtotal,
                appliedDiscount,
                quantityCap: this.getCartQuantityCap(product),
                displayName: this.getLocalizedProductName(product),
                displayDescription: this.getLocalizedProductDescription(product),
                hasPurchaseNotes,
                hasUsageInstructions
            });
        });

        return entries;
    },

    getCartSummary: function (entries = this.getCartEntries()) {
        return entries.reduce((summary, entry) => {
            summary.uniqueCount += 1;
            summary.itemCount += Number(entry.quantity || 0) || 0;
            summary.totalPoints += Number((entry.totalPoints ?? entry.finalTotal ?? entry.subtotal ?? 0)) || 0;
            summary.notesCount += entry.hasPurchaseNotes ? 1 : 0;
            summary.usageCount += entry.hasUsageInstructions ? 1 : 0;
            return summary;
        }, {
            uniqueCount: 0,
            itemCount: 0,
            totalPoints: 0,
            notesCount: 0,
            usageCount: 0
        });
    },

    formatCartCount: function (count, { includeProductWord = false } = {}) {
        const safeCount = Math.max(0, Number(count || 0) || 0);
        if (this.isEnglishShopLocale()) {
            if (includeProductWord) {
                return `${safeCount} ${safeCount === 1 ? 'item' : 'items'}`;
            }
            return `${safeCount} ${safeCount === 1 ? 'item' : 'items'}`;
        }

        return includeProductWord ? `${safeCount} 件商品` : `${safeCount} 件`;
    },

    formatCartMetaCount: function (count) {
        const safeCount = Math.max(0, Number(count || 0) || 0);
        if (this.isEnglishShopLocale()) {
            return `${safeCount} ${safeCount === 1 ? 'item' : 'items'}`;
        }
        return `${safeCount} 个`;
    },

    getCartItemDisclosureState: function (productId) {
        const normalizedId = String(productId || '').trim();
        const state = normalizedId ? this.cartItemDisclosureState?.[normalizedId] : null;
        return {
            notes: Boolean(state?.notes),
            usage: Boolean(state?.usage),
            discounts: Boolean(state?.discounts)
        };
    },

    buildCartItemDisclosureDomId: function (productId, kind) {
        const normalizedId = String(productId || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-');
        const normalizedKind = String(kind || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-');
        return `shop-cart-disclosure-${normalizedKind || 'panel'}-${normalizedId || 'item'}`;
    },

    buildCartDiscountDisclosureMarkup: function (entry, options = {}) {
        const selections = Array.isArray(entry?.appliedDiscount?.selections)
            ? entry.appliedDiscount.selections
            : [];
        if (selections.length < 2) {
            return '';
        }

        const isEn = this.isEnglishShopLocale();
        const panelId = String(options.panelId || '').trim();
        const headingLabel = isEn ? 'Applied coupons' : '已用优惠券';
        const headingHint = isEn
            ? `${selections.length} coupons are attached to this item.`
            : `这件商品当前使用了 ${selections.length} 张券`;
        const rows = selections.map((selection, index) => {
            const title = String(
                selection?.benefitLabel
                || selection?.code
                || (isEn ? `Coupon ${index + 1}` : `优惠券 ${index + 1}`)
            ).trim();
            const couponCode = String(selection?.code || '').trim();
            const metaParts = [];
            if (couponCode && title.toUpperCase() !== couponCode.toUpperCase()) {
                metaParts.push(couponCode);
            }
            const discountAmount = Number(selection?.discountAmount);
            const amountLabel = Number.isFinite(discountAmount) && discountAmount > 0
                ? `-${this.formatShopPoints(discountAmount)}`
                : '';

            return `
                <div class="shop-cart-item__discount-row">
                    <div class="shop-cart-item__discount-copy">
                        <div class="shop-cart-item__discount-title">${this.escapeHtml(title)}</div>
                        ${metaParts.length ? `<div class="shop-cart-item__discount-meta">${this.escapeHtml(metaParts.join(' · '))}</div>` : ''}
                    </div>
                    ${amountLabel ? `<span class="shop-cart-item__discount-amount">${this.escapeHtml(amountLabel)}</span>` : ''}
                </div>
            `;
        }).join('');

        return `
            <section
                id="${this.escapeAttribute(panelId)}"
                class="shop-cart-item__panel shop-cart-item__panel--discounts"
                ${options.isOpen ? '' : 'hidden'}
            >
                <div class="shop-cart-item__discount-stack">
                    <div class="shop-cart-item__discount-stack-head">
                        <span class="shop-cart-item__discount-stack-title">${this.escapeHtml(headingLabel)}</span>
                        <span class="shop-cart-item__discount-stack-hint">${this.escapeHtml(headingHint)}</span>
                    </div>
                    <div class="shop-cart-item__discount-list">${rows}</div>
                </div>
            </section>
        `;
    },

    applyShopPurchaseDataset: function (element, payload = {}) {
        if (!(element instanceof HTMLElement) || !payload) return;

        element.dataset.productId = String(payload.productId || '');
        element.dataset.productName = encodeURIComponent(payload.productName || '');
        element.dataset.productNameEn = encodeURIComponent(payload.productNameEn || '');
        element.dataset.unitPrice = String(payload.unitPrice || 0);
        element.dataset.productCategory = String(payload.productCategory || '');
        element.dataset.qtyRules = payload.qtyRules || '';
        element.dataset.maxPurchaseQuantity = String(payload.maxPurchaseQuantity || '');
        element.dataset.stockCount = payload.stockCount == null ? '' : String(payload.stockCount);
        element.dataset.shopStockState = String(payload.stockState || '');
        element.dataset.showPurchaseNotes = payload.showPurchaseNotes ? 'true' : 'false';
        element.dataset.purchaseNotes = encodeURIComponent(payload.purchaseNotes || '');
        element.dataset.showUsageInstructions = payload.showUsageInstructions ? 'true' : 'false';
        element.dataset.usageInstructions = encodeURIComponent(payload.usageInstructions || '');
    },

    getShopPurchasePayloadFromDataset: function (dataset = {}) {
        return {
            productId: String(dataset.productId || '').trim(),
            productName: decodeURIComponent(dataset.productName || ''),
            productNameEn: decodeURIComponent(dataset.productNameEn || ''),
            unitPrice: Number(dataset.unitPrice || 0),
            qtyRules: dataset.qtyRules || '',
            maxPurchaseQuantity: dataset.maxPurchaseQuantity || '',
            stockCount: dataset.stockCount === '' || dataset.stockCount == null ? null : Number(dataset.stockCount),
            stockState: dataset.shopStockState || dataset.stockState || '',
            showPurchaseNotes: dataset.showPurchaseNotes === 'true',
            purchaseNotes: dataset.purchaseNotes || '',
            showUsageInstructions: dataset.showUsageInstructions === 'true',
            usageInstructions: dataset.usageInstructions || '',
            productCategory: dataset.productCategory || ''
        };
    },

    isShopProductSoldOut: function (product) {
        if (!product) return false;

        const stockCount = Number(product.stock_count ?? product.stockCount);
        return Number.isFinite(stockCount) && stockCount <= 0;
    },

    isShopPurchasePayloadSoldOut: function (payload = {}) {
        const liveProduct = this.getCachedProductById(payload.productId);
        if (this.isShopProductSoldOut(liveProduct)) {
            return true;
        }

        const stockState = String(payload.stockState || '').trim().toLowerCase();
        if (stockState === 'sold-out' || stockState === 'out-of-stock') {
            return true;
        }

        const stockCount = Number(payload.stockCount);
        return Number.isFinite(stockCount) && stockCount <= 0;
    },

    showSoldOutProductToast: function (payload = {}) {
        this.showShopToast(
            this.trShop('soldOutClickHint', '已售罄'),
            'sold-out'
        );
    },

    openProductPurchaseFromDataset: function (dataset = {}, sourceContext = resolveShopSourceContext(), options = {}) {
        const payload = this.getShopPurchasePayloadFromDataset(dataset);
        if (!payload.productId) return;

        if (this.isShopPurchasePayloadSoldOut(payload)) {
            this.showSoldOutProductToast(payload);
            return;
        }

        if (options.trackClick !== false) {
            trackShopAnalyticsEvent('product_card_click', {
                entityId: payload.productId || null,
                eventValue: payload.unitPrice || null,
                metadata: buildShopTrackingMetadata({
                    product_id: payload.productId || null,
                    product_name: payload.productName || '',
                    product_name_en: payload.productNameEn || '',
                    category: String(payload.productCategory || '').trim() || null,
                    unit_price: payload.unitPrice || null
                }, sourceContext)
            }, {
                eventType: 'engagement'
            });
        }

        void this.buyProduct(
            payload.productId,
            payload.productName,
            payload.productNameEn,
            payload.unitPrice,
            payload.qtyRules,
            payload.maxPurchaseQuantity,
            payload.showPurchaseNotes,
            payload.purchaseNotes,
            payload.showUsageInstructions,
            payload.usageInstructions,
            payload.productCategory,
            sourceContext,
            {
                initialQuantity: options.initialQuantity
            }
        );
    },

    trackProductAddToCartFromDataset: function (dataset = {}, addedQuantity = 0, sourceContext = resolveShopSourceContext()) {
        const payload = this.getShopPurchasePayloadFromDataset(dataset);
        if (!payload.productId || addedQuantity < 1) return;

        trackShopAnalyticsEvent('product_add_to_cart', {
            entityId: payload.productId,
            eventValue: addedQuantity,
            metadata: buildShopTrackingMetadata({
                product_id: payload.productId,
                product_name: payload.productName || null,
                product_name_en: payload.productNameEn || null,
                category: String(payload.productCategory || '').trim() || null,
                quantity: addedQuantity,
                unit_price: payload.unitPrice || null
            }, sourceContext)
        }, {
            eventType: 'engagement'
        });
    },

    toggleCartItemDisclosure: function (productId, kind) {
        const normalizedId = String(productId || '').trim();
        const normalizedKind = kind === 'notes' || kind === 'usage' || kind === 'discounts' ? kind : '';
        if (!normalizedId || !normalizedKind) return;

        const currentState = this.getCartItemDisclosureState(normalizedId);
        const nextState = {
            ...currentState,
            [normalizedKind]: !currentState[normalizedKind]
        };

        if (!nextState.notes && !nextState.usage && !nextState.discounts) {
            delete this.cartItemDisclosureState[normalizedId];
        } else {
            this.cartItemDisclosureState[normalizedId] = nextState;
        }

        this.renderCart();
    },

    getCurrentThemeChromeMode: function () {
        return document.documentElement?.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    },

    getThemeChromeColor: function (theme = this.getCurrentThemeChromeMode()) {
        if (typeof window.getSiteThemeChromeColor === 'function') {
            return window.getSiteThemeChromeColor(theme);
        }
        return theme === 'dark' ? '#000000' : '#ffffff';
    },

    getThemeColorMeta: function () {
        let metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) return metaTheme;

        metaTheme = document.createElement('meta');
        metaTheme.setAttribute('name', 'theme-color');
        document.head?.appendChild(metaTheme);
        return metaTheme;
    },

    lockShopModalThemeColor: function (themeColor = this.getThemeChromeColor()) {
        if (typeof window.lockSiteModalThemeColor !== 'function') return false;

        return window.lockSiteModalThemeColor({
            themeColor,
            restoreDelayMs: 320
        }) === true;
    },

    clearShopModalThemeColor: function (options = {}) {
        if (typeof window.clearSiteModalThemeColor !== 'function') return false;

        return window.clearSiteModalThemeColor({
            restoreDelayMs: 320,
            ...options
        }) === true;
    },

    runShopModalCloseChromeCleanup: function (options = {}) {
        if (typeof window.runSiteModalCloseChromeCleanup !== 'function') return false;

        return window.runSiteModalCloseChromeCleanup({
            restoreDelayMs: 320,
            forceHiddenDurationMs: 360,
            ...options
        }) === true;
    },

    setPurchaseModalLayerOpen: function (open) {
        if (!document.body) return;

        if (open) {
            document.body.dataset.shopPurchaseModalOpen = 'true';
        } else {
            delete document.body.dataset.shopPurchaseModalOpen;
        }
    },

    lockCartDrawerThemeColor: function () {
        if (!this.isIOSMobileViewport()) return;

        if (this.cartThemeColorRestoreTimerId) {
            window.clearTimeout(this.cartThemeColorRestoreTimerId);
            this.cartThemeColorRestoreTimerId = null;
        }

        if (this.lockShopModalThemeColor(this.getThemeChromeColor())) return;

        const metaTheme = this.getThemeColorMeta();
        if (!metaTheme) return;

        if (!metaTheme.hasAttribute('data-shop-cart-theme-restore')) {
            metaTheme.setAttribute('data-shop-cart-theme-restore', metaTheme.getAttribute('content') || this.getThemeChromeColor());
        }

        metaTheme.setAttribute('content', this.getThemeChromeColor());
    },

    clearCartDrawerThemeColor: function (options = {}) {
        if (!this.isIOSMobileViewport()) return;

        if (this.cartThemeColorRestoreTimerId) {
            window.clearTimeout(this.cartThemeColorRestoreTimerId);
            this.cartThemeColorRestoreTimerId = null;
        }

        if (this.clearShopModalThemeColor(options)) return;

        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (!metaTheme) return;

        const restoreContent = metaTheme.getAttribute('data-shop-cart-theme-restore') || this.getThemeChromeColor();
        metaTheme.removeAttribute('content');

        const restoreDelayMs = Math.max(50, Math.trunc(Number(options.restoreDelayMs || 0) || 260));
        this.cartThemeColorRestoreTimerId = window.setTimeout(() => {
            this.cartThemeColorRestoreTimerId = null;
            if (!metaTheme.isConnected) return;
            metaTheme.setAttribute('content', restoreContent);
            metaTheme.removeAttribute('data-shop-cart-theme-restore');
            if (typeof window.applySiteThemeChrome === 'function') {
                window.applySiteThemeChrome(this.getCurrentThemeChromeMode(), { forceRepaint: true });
            }
        }, restoreDelayMs);
    },

    forceHideCartDrawerDuringClose: function () {
        if (!this.isIOSMobileViewport()) return;

        if (this.cartForceHiddenTimerId) {
            window.clearTimeout(this.cartForceHiddenTimerId);
            this.cartForceHiddenTimerId = null;
        }

        document.body.classList.add('shop-cart-force-hidden');
        this.cartForceHiddenTimerId = window.setTimeout(() => {
            this.cartForceHiddenTimerId = null;
            document.body.classList.remove('shop-cart-force-hidden');
        }, 360);
    },

    releaseCartDrawerForceHidden: function () {
        if (this.cartForceHiddenTimerId) {
            window.clearTimeout(this.cartForceHiddenTimerId);
            this.cartForceHiddenTimerId = null;
        }
        document.body.classList.remove('shop-cart-force-hidden');
    },

    lockCartDrawerScroll: function (drawer) {
        if (!drawer) return;

        if (window.iOSScrollLock) {
            window.iOSScrollLock.lockLight(drawer, {
                restoreScrollDuringViewport: true
            });
            this.cartDrawerOwnsScrollLock = true;
            return;
        }

        document.documentElement.classList.add('no-scroll');
        document.body.classList.add('no-scroll');
        this.cartDrawerFallbackScrollLock = true;
    },

    unlockCartDrawerScroll: function () {
        if (this.cartDrawerOwnsScrollLock && window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        }

        if (this.cartDrawerFallbackScrollLock) {
            document.documentElement.classList.remove('no-scroll');
            document.body.classList.remove('no-scroll');
        }

        this.cartDrawerOwnsScrollLock = false;
        this.cartDrawerFallbackScrollLock = false;
    },

    setCartOpen: function (open) {
        const wasOpen = this.cartOpen === true;
        this.cartOpen = Boolean(open) && this.cartItems.size > 0;
        const drawer = document.getElementById('shopCartDrawer');
        const drawerBody = drawer?.querySelector('.shop-cart-drawer__body');
        if (!this.cartOpen) {
            this.cartBackdropCloseGuardUntil = 0;
        }
        if (this.cartOpen && !wasOpen) {
            this.releaseCartDrawerForceHidden();
            drawer?.classList.add('active');
            this.lockCartDrawerScroll(drawer);
            this.lockCartDrawerThemeColor();
        } else if (!this.cartOpen && wasOpen) {
            this.unlockCartDrawerScroll();
            const didRunSharedCleanup = this.runShopModalCloseChromeCleanup({
                targets: ['#shopCartBackdrop', '#shopCartDrawer'],
                bodyClass: 'shop-cart-force-hidden',
                restoreDelayMs: 320
            });
            if (!didRunSharedCleanup) {
                this.forceHideCartDrawerDuringClose();
                this.clearCartDrawerThemeColor({ restoreDelayMs: 320 });
            }
        }
        document.body.dataset.shopCartOpen = String(this.cartOpen);
        const anchor = document.getElementById('shopCartAnchor');
        if (anchor) {
            anchor.setAttribute('aria-expanded', String(this.cartOpen));
            const shouldDisableAnchor = this.cartOpen || this.cartItems.size === 0;
            anchor.hidden = shouldDisableAnchor;
            anchor.disabled = shouldDisableAnchor;
            anchor.setAttribute('aria-hidden', String(shouldDisableAnchor));
            anchor.style.pointerEvents = shouldDisableAnchor ? 'none' : '';
            anchor.style.opacity = shouldDisableAnchor ? '0' : '';
            anchor.style.visibility = shouldDisableAnchor ? 'hidden' : '';
        }
        if (drawer) {
            drawer.setAttribute('aria-hidden', String(!this.cartOpen));
            drawer.classList.toggle('active', this.cartOpen);
        }
        if (this.cartOpen && !wasOpen) {
            if (drawerBody) drawerBody.scrollTop = 0;
            if (drawer) drawer.scrollTop = 0;
            window.requestAnimationFrame(() => {
                if (drawerBody) drawerBody.scrollTop = 0;
                if (drawer) drawer.scrollTop = 0;
            });
        } else if (!this.cartOpen && this.cartItems.size > 0) {
            this.scheduleCartAbandonEngagement();
        }
    },

    toggleCart: function () {
        if (this.cartCheckoutProcessing) {
            return;
        }
        if (this.cartItems.size === 0) {
            this.showShopToast(this.getCartCopy().cartEmptyToast, 'error');
            return;
        }
        this.setCartOpen(!this.cartOpen);
        this.renderCart();
    },

    closeCart: function () {
        if (this.cartCheckoutProcessing) {
            return;
        }
        this.setCartOpen(false);
        this.renderCart();
    },

    isCartHashTarget: function (hash = window.location.hash || '') {
        const normalizedHash = decodeURIComponent(String(hash || '').replace(/^#/, '').trim()).toLowerCase();
        return normalizedHash === 'cart' || normalizedHash === 'shop-cart';
    },

    openCartFromEngagement: function () {
        if (this.cartCheckoutProcessing) {
            return false;
        }
        if (this.cartItems.size === 0) {
            this.renderCart();
            return false;
        }

        this.guardCartBackdropClose(260);
        this.setCartOpen(true);
        this.renderCart();

        const drawer = document.getElementById('shopCartDrawer');
        const drawerBody = drawer?.querySelector('.shop-cart-drawer__body');
        window.requestAnimationFrame(() => {
            if (drawerBody) {
                drawerBody.scrollTop = 0;
            }
            if (drawer) {
                drawer.scrollTop = 0;
            }
        });
        return true;
    },

    syncCartHashFocusFromLocation: function () {
        if (!this.isCartHashTarget()) {
            return false;
        }
        return this.openCartFromEngagement();
    },

    guardCartBackdropClose: function (durationMs = 240) {
        const safeDuration = Math.max(0, Math.trunc(Number(durationMs || 0) || 0));
        this.cartBackdropCloseGuardUntil = Date.now() + safeDuration;
    },

    shouldIgnoreCartBackdropClose: function () {
        return Number(this.cartBackdropCloseGuardUntil || 0) > Date.now();
    },

    buildCartIconMarkup: function (product, { imageClass = 'shop-cart-item__thumb', iconClass = 'shop-cart-item__icon' } = {}) {
        const imageAsset = getShopProductImageAsset(product);
        const imageSource = getShopProductImageAssetUrl(imageAsset, 'card')
            || getShopProductImageAssetUrl(imageAsset, 'thumb')
            || getShopProductImageAssetUrl(imageAsset, 'original')
            || String(product?.icon_url || '');
        const safeIconSource = this.escapeAttribute(imageSource);
        const safeAlt = this.escapeAttribute(this.getLocalizedProductName(product) || (window.i18n?.t('shop.productImage') || '商品封面'));

        if (product?.icon_url?.startsWith('fa')) {
            return `<div class="${iconClass}" aria-hidden="true"><i class="${this.escapeAttribute(product.icon_url)}"></i></div>`;
        }

        if (this.isShopImageSource(imageSource)) {
            return `<img src="${safeIconSource}" class="${imageClass}" alt="${safeAlt}" loading="lazy" decoding="async">`;
        }

        return `<div class="${iconClass}" aria-hidden="true"><i class="fas fa-box"></i></div>`;
    },

    buildCartItemMarkup: function (entry) {
        const copy = this.getCartCopy();
        const isEn = this.isEnglishShopLocale();
        const noteText = entry.hasPurchaseNotes ? this.getLocalizedProductGuidanceText(entry.product, 'purchase_notes') : '';
        const usageText = entry.hasUsageInstructions ? this.getLocalizedProductGuidanceText(entry.product, 'usage_instructions') : '';
        const disclosureState = this.getCartItemDisclosureState(entry.productId);
        const isCartBusy = this.cartCheckoutProcessing === true;
        const notePanelId = noteText ? this.buildCartItemDisclosureDomId(entry.productId, 'notes') : '';
        const usagePanelId = usageText ? this.buildCartItemDisclosureDomId(entry.productId, 'usage') : '';
        const quantityValue = Math.max(1, Number(entry.quantity || 1) || 1);
        const canDecrease = quantityValue > 1;
        const canIncrease = quantityValue < Math.max(1, Number(entry.quantityCap || 1) || 1);
        const stockCount = Number(entry.product?.stock_count || 0) || 0;
        const stockLabel = `${window.i18n?.t('shop.stock') || '库存'}: ${Math.max(0, stockCount)}`;
        const hasAppliedDiscount = entry.appliedDiscount && Number(entry.discountAmount || 0) > 0;
        const discountSelections = hasAppliedDiscount && Array.isArray(entry.appliedDiscount?.selections)
            ? entry.appliedDiscount.selections
            : [];
        const hasStackedDiscountDetails = discountSelections.length > 1;
        const discountPanelId = hasStackedDiscountDetails ? this.buildCartItemDisclosureDomId(entry.productId, 'discounts') : '';
        const hasOpenDisclosure = disclosureState.notes || disclosureState.usage || disclosureState.discounts;
        const payableTotal = Number((entry.totalPoints ?? entry.finalTotal ?? entry.subtotal ?? 0)) || 0;
        const priceMetaParts = [`${this.formatShopPoints(entry.unitPrice)} × ${quantityValue}`];
        if (hasAppliedDiscount && entry.appliedDiscount?.benefitLabel) {
            priceMetaParts.push(entry.appliedDiscount.benefitLabel);
        }
        const discountNote = hasAppliedDiscount
            ? `${isEn ? 'Saved ' : '已优惠 '}${this.formatShopPoints(entry.discountAmount)}`
            : '';
        const discountPillLabel = String(
            entry.appliedDiscount?.benefitLabel
            || (isEn ? 'Coupon kept' : '优惠已保留')
        ).trim();

        return `
            <article class="shop-cart-item shop-cart-item--${entry.hasPurchaseNotes ? 'notice' : 'default'}" data-product-id="${this.escapeAttribute(entry.productId)}">
                <div class="shop-cart-item__top">
                    <div class="shop-cart-item__heading">
                        ${this.buildCartIconMarkup(entry.product)}
                        <div class="shop-cart-item__copy">
                            <button
                                type="button"
                                class="shop-cart-item__title shop-cart-item__title-btn"
                                data-shop-cart-action="open-product"
                                data-product-id="${this.escapeAttribute(entry.productId)}"
                                ${isCartBusy ? 'disabled' : ''}
                            >${this.escapeHtml(entry.displayName)}</button>
                            <div class="shop-cart-item__subtitle">${this.escapeHtml(entry.displayDescription)}</div>
                        </div>
                    </div>

                    <button
                        type="button"
                        class="shop-cart-item__remove"
                        aria-label="${this.escapeAttribute(copy.removeLabel)}"
                        data-shop-cart-action="remove"
                        data-product-id="${this.escapeAttribute(entry.productId)}"
                        ${isCartBusy ? 'disabled' : ''}
                    ><span class="shop-cart-item__remove-icon" aria-hidden="true"></span></button>
                </div>

                <div class="shop-cart-item__meta">
                    <span class="shop-cart-item__pill shop-cart-item__pill--stock">${this.escapeHtml(stockLabel)}</span>
                    ${hasAppliedDiscount ? (hasStackedDiscountDetails ? `
                        <button
                            type="button"
                            class="shop-cart-item__pill shop-cart-item__pill--toggle shop-cart-item__pill--discount${disclosureState.discounts ? ' is-active' : ''}"
                            data-shop-cart-action="toggle-discounts"
                            data-product-id="${this.escapeAttribute(entry.productId)}"
                            aria-expanded="${disclosureState.discounts ? 'true' : 'false'}"
                            aria-controls="${this.escapeAttribute(discountPanelId)}"
                            ${isCartBusy ? 'disabled' : ''}
                        >${this.escapeHtml(discountPillLabel)}</button>
                    ` : `<span class="shop-cart-item__pill shop-cart-item__pill--discount">${this.escapeHtml(discountPillLabel)}</span>`) : ''}
                    ${noteText ? `
                        <button
                            type="button"
                            class="shop-cart-item__pill shop-cart-item__pill--toggle shop-cart-item__pill--notice${disclosureState.notes ? ' is-active' : ''}"
                            data-shop-cart-action="toggle-notes"
                            data-product-id="${this.escapeAttribute(entry.productId)}"
                            aria-expanded="${disclosureState.notes ? 'true' : 'false'}"
                            aria-controls="${this.escapeAttribute(notePanelId)}"
                            ${isCartBusy ? 'disabled' : ''}
                        >${this.escapeHtml(copy.notesPill)}</button>
                    ` : ''}
                    ${usageText ? `
                        <button
                            type="button"
                            class="shop-cart-item__pill shop-cart-item__pill--toggle shop-cart-item__pill--usage${disclosureState.usage ? ' is-active' : ''}"
                            data-shop-cart-action="toggle-usage"
                            data-product-id="${this.escapeAttribute(entry.productId)}"
                            aria-expanded="${disclosureState.usage ? 'true' : 'false'}"
                            aria-controls="${this.escapeAttribute(usagePanelId)}"
                            ${isCartBusy ? 'disabled' : ''}
                        >${this.escapeHtml(copy.usagePill)}</button>
                    ` : ''}
                </div>

                ${((noteText || usageText || hasStackedDiscountDetails) && hasOpenDisclosure) ? `
                    <div class="shop-cart-item__disclosures">
                        ${hasStackedDiscountDetails ? this.buildCartDiscountDisclosureMarkup(entry, {
                            panelId: discountPanelId,
                            isOpen: disclosureState.discounts
                        }) : ''}
                        ${noteText ? `
                            <section
                                id="${this.escapeAttribute(notePanelId)}"
                                class="shop-cart-item__panel shop-cart-item__panel--notice"
                                ${disclosureState.notes ? '' : 'hidden'}
                            >${this.renderStoredRichText(noteText)}</section>
                        ` : ''}
                        ${usageText ? `
                            <section
                                id="${this.escapeAttribute(usagePanelId)}"
                                class="shop-cart-item__panel shop-cart-item__panel--usage"
                                ${disclosureState.usage ? '' : 'hidden'}
                            >${this.renderStoredRichText(usageText)}</section>
                        ` : ''}
                    </div>
                ` : ''}

                <div class="shop-cart-item__footer">
                    <div class="shop-cart-item__price">
                        <strong>${this.escapeHtml(this.formatShopPoints(payableTotal))}</strong>
                        <span>${this.escapeHtml(priceMetaParts.join(' · '))}</span>
                        ${discountNote ? `<span class="shop-cart-item__discount-note">${this.escapeHtml(discountNote)}</span>` : ''}
                    </div>

                    <div class="shop-cart-item__quantity">
                        <button
                            type="button"
                            class="shop-cart-item__qty-btn"
                            data-shop-cart-action="decrease"
                            data-product-id="${this.escapeAttribute(entry.productId)}"
                            ${canDecrease && !isCartBusy ? '' : 'disabled'}
                        >−</button>
                        <span class="shop-cart-item__qty-value">${quantityValue}</span>
                        <button
                            type="button"
                            class="shop-cart-item__qty-btn"
                            data-shop-cart-action="increase"
                            data-product-id="${this.escapeAttribute(entry.productId)}"
                            ${canIncrease && !isCartBusy ? '' : 'disabled'}
                        >+</button>
                    </div>
                </div>
            </article>
        `;
    },

    buildCartCheckoutItemMarkup: function (entry) {
        const copy = this.getCartCopy();
        const isEn = this.isEnglishShopLocale();
        const hasAppliedDiscount = entry.appliedDiscount && Number(entry.discountAmount || 0) > 0;
        const payableTotal = Number((entry.totalPoints ?? entry.finalTotal ?? entry.subtotal ?? 0)) || 0;
        const metaLead = `${this.formatShopPoints(entry.unitPrice)} × ${entry.quantity}`;
        const discountNote = hasAppliedDiscount
            ? `${isEn ? 'Saved ' : '已优惠 '}${this.formatShopPoints(entry.discountAmount)}`
            : '';
        return `
            <article class="shop-cart-checkout__item">
                <div class="shop-cart-checkout__item-head">
                    <div class="shop-cart-checkout__item-title">${this.escapeHtml(entry.displayName)}</div>
                    <strong>${this.escapeHtml(this.formatShopPoints(payableTotal))}</strong>
                </div>
                <div class="shop-cart-checkout__item-meta">
                    <span>${this.escapeHtml(metaLead)}</span>
                    ${hasAppliedDiscount && entry.appliedDiscount?.benefitLabel ? `<span class="shop-cart-checkout__item-pill shop-cart-checkout__item-pill--discount">${this.escapeHtml(entry.appliedDiscount.benefitLabel)}</span>` : ''}
                    ${entry.hasPurchaseNotes ? `<span class="shop-cart-checkout__item-pill shop-cart-checkout__item-pill--notice">${this.escapeHtml(copy.notesPill)}</span>` : ''}
                    ${entry.hasUsageInstructions ? `<span class="shop-cart-checkout__item-pill shop-cart-checkout__item-pill--usage">${this.escapeHtml(copy.usagePill)}</span>` : ''}
                    ${discountNote ? `<span class="shop-cart-checkout__discount-note">${this.escapeHtml(discountNote)}</span>` : ''}
                </div>
            </article>
        `;
    },

    syncRenderedProductCardsWithCart: function () {
        document.querySelectorAll('#userShopGrid .shop-card[data-product-id]').forEach((card) => {
            const productId = String(card.dataset.productId || '').trim();
            if (!productId) return;

            const quantity = this.getCartQuantity(productId);
            card.classList.toggle('shop-card--in-cart', quantity > 0);
        });
    },

    renderCart: function () {
        this.sanitizeCartState();

        const entries = this.getCartEntries();
        const summary = this.getCartSummary(entries);
        const copy = this.getCartCopy();
        const anchor = document.getElementById('shopCartAnchor');
        const anchorCount = document.getElementById('shopCartAnchorCount');
        const anchorTotal = document.getElementById('shopCartAnchorTotal');
        const anchorHint = document.getElementById('shopCartAnchorHint');
        const anchorBadge = document.getElementById('shopCartAnchorBadge');
        const drawerEyebrow = document.getElementById('shopCartDrawerEyebrow');
        const drawerTitle = document.getElementById('shopCartDrawerTitle');
        const drawerBody = document.getElementById('shopCartDrawerBody');
        const emptyTitle = document.getElementById('shopCartEmptyTitle');
        const emptyBody = document.getElementById('shopCartEmptyBody');
        const list = document.getElementById('shopCartList');
        const emptyState = document.getElementById('shopCartEmptyState');
        const summaryCount = document.getElementById('shopCartSummaryCount');
        const summaryTotal = document.getElementById('shopCartSummaryTotal');
        const summaryNotes = document.getElementById('shopCartSummaryNotes');
        const summaryUsage = document.getElementById('shopCartSummaryUsage');
        const summaryItemsLabel = document.getElementById('shopCartSummaryItemsLabel');
        const summaryTotalLabel = document.getElementById('shopCartSummaryTotalLabel');
        const summaryNotesLabel = document.getElementById('shopCartSummaryNotesLabel');
        const summaryUsageLabel = document.getElementById('shopCartSummaryUsageLabel');
        const continueBtn = document.getElementById('shopCartContinueBtn');
        const checkoutBtn = document.getElementById('shopCartCheckoutBtn');

        if (drawerEyebrow) drawerEyebrow.textContent = copy.drawerEyebrow;
        if (drawerTitle) drawerTitle.textContent = copy.drawerTitle;
        if (drawerBody) drawerBody.textContent = copy.drawerBody;
        if (emptyTitle) emptyTitle.textContent = copy.emptyTitle;
        if (emptyBody) emptyBody.textContent = copy.emptyBody;
        if (summaryItemsLabel) summaryItemsLabel.textContent = copy.summaryItems;
        if (summaryTotalLabel) summaryTotalLabel.textContent = copy.summaryTotal;
        if (summaryNotesLabel) summaryNotesLabel.textContent = copy.summaryNotes;
        if (summaryUsageLabel) summaryUsageLabel.textContent = copy.summaryUsage;
        if (continueBtn) {
            continueBtn.textContent = copy.continueLabel;
            continueBtn.disabled = this.cartCheckoutProcessing;
        }
        if (checkoutBtn) {
            checkoutBtn.innerHTML = this.cartCheckoutProcessing
                ? `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${this.escapeHtml(window.i18n?.t('shop.processing') || '处理中...')}</span>`
                : this.escapeHtml(copy.checkoutLabel);
        }

        if (anchor) {
            const shouldShowAnchor = entries.length > 0 && !this.cartOpen;
            const shouldHideAnchor = !shouldShowAnchor;
            anchor.hidden = shouldHideAnchor;
            anchor.disabled = shouldHideAnchor;
            anchor.setAttribute('aria-hidden', String(shouldHideAnchor));
            anchor.style.pointerEvents = shouldHideAnchor ? 'none' : '';
            anchor.style.opacity = shouldHideAnchor ? '0' : '';
            anchor.style.visibility = shouldHideAnchor ? 'hidden' : '';
            const anchorLabel = summary.itemCount > 0
                ? `${copy.drawerTitle}，${this.formatCartCount(summary.itemCount, { includeProductWord: true })}，${this.formatShopPoints(summary.totalPoints)}`
                : copy.anchorEmptyTitle;
            anchor.setAttribute('aria-label', anchorLabel);
            anchor.setAttribute('title', copy.drawerTitle);
        }
        if (anchorCount) {
            anchorCount.textContent = summary.itemCount > 0 ? this.formatCartCount(summary.itemCount, { includeProductWord: true }) : copy.anchorEmptyTitle;
        }
        if (anchorTotal) {
            const hasAnchorItems = summary.itemCount > 0;
            anchorTotal.textContent = hasAnchorItems ? this.formatShopPoints(summary.totalPoints) : '';
            this.setElementHidden(anchorTotal, !hasAnchorItems);
        }
        if (anchorHint) {
            const hasAnchorItems = summary.itemCount > 0;
            anchorHint.textContent = hasAnchorItems ? copy.anchorHint : '';
            this.setElementHidden(anchorHint, !hasAnchorItems);
        }
        if (anchorBadge) {
            const hasAnchorItems = summary.itemCount > 0;
            anchorBadge.textContent = hasAnchorItems ? (summary.itemCount > 99 ? '99+' : String(summary.itemCount)) : '';
            this.setElementHidden(anchorBadge, !hasAnchorItems);
        }

        if (list) {
            list.innerHTML = entries.map((entry) => this.buildCartItemMarkup(entry)).join('');
            this.setElementHidden(list, entries.length === 0);
            list.setAttribute('aria-hidden', String(entries.length === 0));
        }
        if (emptyState) {
            this.setElementHidden(emptyState, entries.length !== 0);
            emptyState.setAttribute('aria-hidden', String(entries.length !== 0));
        }

        if (summaryCount) summaryCount.textContent = this.formatCartCount(summary.itemCount);
        if (summaryTotal) summaryTotal.textContent = this.formatShopPoints(summary.totalPoints);
        if (summaryNotes) summaryNotes.textContent = this.formatCartMetaCount(summary.notesCount);
        if (summaryUsage) summaryUsage.textContent = this.formatCartMetaCount(summary.usageCount);

        if (checkoutBtn) {
            checkoutBtn.disabled = entries.length === 0 || this.cartCheckoutProcessing;
        }

        this.setCartOpen(this.cartOpen);
        this.syncRenderedProductCardsWithCart();
        this.renderCartCheckoutModal();
    },

    renderCartCheckoutModal: function () {
        const copy = this.getCartCopy();
        const entries = this.getCartEntries();
        const summary = this.getCartSummary(entries);
        const list = document.getElementById('shopCartCheckoutList');
        const eyebrow = document.getElementById('shopCartCheckoutEyebrow');
        const title = document.getElementById('shopCartCheckoutTitle');
        const hint = document.getElementById('shopCartCheckoutHint');
        const notice = document.getElementById('shopCartCheckoutNotice');
        const countLabel = document.getElementById('shopCartCheckoutCountLabel');
        const totalLabel = document.getElementById('shopCartCheckoutTotalLabel');
        const notesLabel = document.getElementById('shopCartCheckoutNotesLabel');
        const usageLabel = document.getElementById('shopCartCheckoutUsageLabel');
        const countValue = document.getElementById('shopCartCheckoutCount');
        const totalValue = document.getElementById('shopCartCheckoutTotal');
        const notesValue = document.getElementById('shopCartCheckoutNotes');
        const usageValue = document.getElementById('shopCartCheckoutUsage');
        const backBtn = document.getElementById('shopCartCheckoutBackBtn');
        const confirmBtn = document.getElementById('shopCartCheckoutConfirmBtn');

        if (eyebrow) eyebrow.textContent = copy.checkoutReviewEyebrow;
        if (title) title.textContent = copy.checkoutReviewTitle;
        if (hint) hint.textContent = copy.checkoutReviewHint;
        if (notice) notice.textContent = copy.checkoutReviewNotice;
        if (countLabel) countLabel.textContent = copy.checkoutReviewCount;
        if (totalLabel) totalLabel.textContent = copy.checkoutReviewTotal;
        if (notesLabel) notesLabel.textContent = copy.checkoutReviewNotes;
        if (usageLabel) usageLabel.textContent = copy.checkoutReviewUsage;
        if (countValue) countValue.textContent = this.formatCartCount(summary.itemCount);
        if (totalValue) totalValue.textContent = this.formatShopPoints(summary.totalPoints);
        if (notesValue) notesValue.textContent = this.formatCartMetaCount(summary.notesCount);
        if (usageValue) usageValue.textContent = this.formatCartMetaCount(summary.usageCount);
        if (backBtn) backBtn.textContent = copy.checkoutReviewBack;
        if (confirmBtn) {
            confirmBtn.innerHTML = this.cartCheckoutProcessing
                ? `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${this.escapeHtml(window.i18n?.t('shop.processing') || '处理中...')}</span>`
                : this.escapeHtml(copy.checkoutReviewConfirm);
            confirmBtn.disabled = this.cartCheckoutProcessing || entries.length === 0;
        }

        if (list) {
            list.innerHTML = entries.map((entry) => this.buildCartCheckoutItemMarkup(entry)).join('');
        }
        this.bindCartCheckoutModalTapFallbacks();
    },

    captureCartItemPositions: function ({ excludeProductId = '' } = {}) {
        const positions = new Map();
        const normalizedExcludedId = String(excludeProductId || '').trim();
        document.querySelectorAll('#shopCartList .shop-cart-item[data-product-id]').forEach((item) => {
            const productId = String(item.dataset.productId || '').trim();
            if (!productId || productId === normalizedExcludedId) {
                return;
            }

            positions.set(productId, item.getBoundingClientRect().top);
        });
        return positions;
    },

    animateCartListReflow: function (previousPositions = new Map()) {
        if (!(previousPositions instanceof Map) || previousPositions.size === 0) {
            return;
        }

        if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
            return;
        }

        window.requestAnimationFrame(() => {
            document.querySelectorAll('#shopCartList .shop-cart-item[data-product-id]').forEach((item) => {
                const productId = String(item.dataset.productId || '').trim();
                const previousTop = previousPositions.get(productId);
                if (typeof previousTop !== 'number') {
                    return;
                }

                const currentTop = item.getBoundingClientRect().top;
                const deltaY = previousTop - currentTop;
                if (Math.abs(deltaY) < 1) {
                    return;
                }

                item.style.transition = 'none';
                item.style.transform = `translateY(${deltaY}px)`;
                item.style.willChange = 'transform';
                void item.offsetWidth;
                item.style.transition = 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)';
                item.style.transform = 'translateY(0)';
                window.setTimeout(() => {
                    item.style.removeProperty('transition');
                    item.style.removeProperty('transform');
                    item.style.removeProperty('will-change');
                }, 340);
            });
        });
    },

    playCartAnchorAddFeedback: function () {
        const anchor = document.getElementById('shopCartAnchor');
        if (!anchor || anchor.hidden) {
            return;
        }

        if (this.cartAnchorFeedbackTimer) {
            window.clearTimeout(this.cartAnchorFeedbackTimer);
            this.cartAnchorFeedbackTimer = null;
        }

        anchor.classList.remove('is-feedback');
        void anchor.offsetWidth;
        anchor.classList.add('is-feedback');

        this.cartAnchorFeedbackTimer = window.setTimeout(() => {
            anchor.classList.remove('is-feedback');
            this.cartAnchorFeedbackTimer = null;
        }, 720);
    },

    addProductToCart: function (productId, quantity = 1, options = {}) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return 0;

        const liveProduct = this.getCachedProductById(normalizedId);
        const product = liveProduct || this.cartSnapshots?.[normalizedId];
        if (!product) return 0;

        const quantityCap = this.getCartQuantityCap(product);
        const currentQuantity = this.getCartQuantity(normalizedId);
        const nextQuantity = Math.min(quantityCap, currentQuantity + Math.max(1, Math.trunc(Number(quantity || 1) || 1)));
        const addedQuantity = Math.max(0, nextQuantity - currentQuantity);

        if (addedQuantity < 1) {
            this.showShopToast(this.isEnglishShopLocale() ? 'Reached the current cart limit.' : '已经达到当前可加购上限。', 'error');
            return 0;
        }

        const appliedDiscount = Object.prototype.hasOwnProperty.call(options, 'appliedDiscount')
            ? this.normalizeCartDiscountSnapshot(options.appliedDiscount, { quantity: nextQuantity })
            : this.normalizeCartDiscountSnapshot(this.cartSnapshots?.[normalizedId]?.applied_discount || null, { quantity: nextQuantity });

        this.cartItems.set(normalizedId, nextQuantity);
        this.updateCartSnapshot(normalizedId, product, { appliedDiscount });
        this.renderCart();
        this.playCartAnchorAddFeedback();
        this.showShopToast(`${this.getCartCopy().addedToast}：${this.getLocalizedProductName(product)}`, 'success');
        this.scheduleCartAbandonEngagement();
        return addedQuantity;
    },

    addCurrentPurchaseToCart: function () {
        const productId = String(this.currentPurchase?.productId || '').trim();
        if (!productId) return;

        const quantity = Math.max(1, Math.trunc(Number(this.currentPurchase?.quantity || 1) || 1));
        const addedQuantity = this.addProductToCart(productId, quantity, {
            appliedDiscount: this.buildCurrentPurchaseCartDiscountSnapshot()
        });
        if (addedQuantity < 1) return;

        trackShopAnalyticsEvent('product_add_to_cart', {
            entityId: productId,
            eventValue: addedQuantity,
            metadata: buildShopTrackingMetadata({
                product_id: productId,
                product_name: this.currentPurchase?.productName || null,
                product_name_en: this.currentPurchase?.productNameEn || null,
                category: this.currentPurchase?.productCategory || null,
                quantity: addedQuantity,
                unit_price: Number(this.currentPurchase?.unitPrice || 0) || null
            }, {
                sourcePage: this.currentPurchase?.sourcePage || null,
                sourceChannel: this.currentPurchase?.sourceChannel || null,
                sourcePromptId: this.currentPurchase?.sourcePromptId || null
            })
        }, {
            eventType: 'engagement'
        });

        this.closePurchaseModal();
    },

    updateCartQuantity: function (productId, nextQuantity) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return;

        const product = this.getCachedProductById(normalizedId);
        if (!product) {
            this.removeCartItem(normalizedId);
            return;
        }

        const quantityCap = this.getCartQuantityCap(product);
        const normalizedQuantity = Math.max(0, Math.min(quantityCap, Math.trunc(Number(nextQuantity || 0) || 0)));

        if (normalizedQuantity < 1) {
            this.removeCartItem(normalizedId);
            return;
        }

        this.cartItems.set(normalizedId, normalizedQuantity);
        const appliedDiscount = this.normalizeCartDiscountSnapshot(this.cartSnapshots?.[normalizedId]?.applied_discount || null, {
            quantity: normalizedQuantity
        });
        this.updateCartSnapshot(normalizedId, product, { appliedDiscount });
        this.renderCart();
        this.scheduleCartAbandonEngagement();
    },

    removeCartItem: function (productId) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return;

        const product = this.getCachedProductById(normalizedId) || this.cartSnapshots?.[normalizedId];
        this.cartItems.delete(normalizedId);
        delete this.cartSnapshots[normalizedId];
        if (this.cartItems.size === 0) {
            this.setCartOpen(false);
            this.clearCartAbandonEngagementTimer();
        } else {
            this.scheduleCartAbandonEngagement();
        }
        this.renderCart();
        if (product) {
            this.showShopToast(`${this.getCartCopy().removedToast}：${this.getLocalizedProductName(product)}`, 'success');
        }
    },

    removeCartItemWithAnimation: function (productId) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return;

        const targetItem = Array.from(document.querySelectorAll('#shopCartList .shop-cart-item[data-product-id]'))
            .find((item) => String(item.dataset.productId || '').trim() === normalizedId);

        if (!targetItem || targetItem.classList.contains('is-removing') || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
            this.removeCartItem(normalizedId);
            return;
        }

        const previousPositions = this.captureCartItemPositions({ excludeProductId: normalizedId });
        targetItem.classList.add('is-removing');

        window.setTimeout(() => {
            this.removeCartItem(normalizedId);
            this.animateCartListReflow(previousPositions);
        }, 290);
    },

    consumePurchasedCartQuantity: function (productId, purchasedQuantity) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return;

        const currentQuantity = this.getCartQuantity(normalizedId);
        const nextQuantity = currentQuantity - Math.max(1, Math.trunc(Number(purchasedQuantity || 0) || 0));
        if (nextQuantity < 1) {
            this.cartItems.delete(normalizedId);
            delete this.cartSnapshots[normalizedId];
        } else {
            this.cartItems.set(normalizedId, nextQuantity);
        }
        if (this.cartItems.size === 0) {
            this.setCartOpen(false);
            this.clearCartAbandonEngagementTimer();
        } else {
            this.scheduleCartAbandonEngagement();
        }
        this.renderCart();
    },

    openCartCheckoutModal: function () {
        const entries = this.getCartEntries();
        if (!entries.length) {
            this.showShopToast(this.getCartCopy().cartEmptyToast, 'error');
            return;
        }

        if (entries.length === 1) {
            this.openPurchaseModalFromCartEntry(entries[0]);
            return;
        }

        const modal = document.getElementById('shopCartCheckoutModal');
        if (!modal) return;

        this.renderCartCheckoutModal();
        modal.classList.remove('shop-modal-force-hidden');
        modal.classList.add('active');
        if (window.iOSScrollLock) {
            window.iOSScrollLock.lockLight(modal);
        }
    },

    closeCartCheckoutModal: function () {
        const modal = document.getElementById('shopCartCheckoutModal');
        if (!modal) return;

        this.runShopModalCloseChromeCleanup({
            targets: [modal],
            forceHiddenClass: 'shop-modal-force-hidden',
            restoreDelayMs: 320
        });
        modal.classList.remove('active');
        this.cartCheckoutProcessing = false;
        this.renderCartCheckoutModal();
        this.renderCart();
        if (window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        }
    },

    openPurchaseModalFromCartEntry: function (entry) {
        if (!entry) return;
        const sourceContext = {
            ...resolveShopSourceContext(),
            sourceChannel: 'shop_cart'
        };
        const purchaseQuantityCap = this.getPurchaseQuantityCapForProduct(entry.product, entry.quantityCap);

        this.closeCart();
        void this.prefetchDiscountAssetsForProduct({
            productId: entry.productId,
            quantity: entry.quantity,
            agentId: this.currentAgentId,
            site: window.SiteConfig?.site || 'cn'
        });
        this.openPurchaseModal(
            entry.productId,
            entry.product?.name || entry.displayName,
            entry.product?.name_en || '',
            entry.unitPrice,
            Array.isArray(entry.product?.quantity_rules) ? entry.product.quantity_rules : [],
            purchaseQuantityCap,
            entry.hasPurchaseNotes ? this.getLocalizedProductGuidanceText(entry.product, 'purchase_notes') : '',
            entry.hasUsageInstructions ? this.getLocalizedProductGuidanceText(entry.product, 'usage_instructions') : '',
            {
                category: entry.product?.category || '',
                sourceContext,
                initialQuantity: entry.quantity,
                appliedDiscount: entry.appliedDiscount || null,
                cartOrigin: {
                    productId: entry.productId
                }
            }
        );
        void this.refreshCurrentPurchaseGuidance(entry.productId);
        void this.syncPurchaseAccessAfterOpen(entry.productId, purchaseQuantityCap);
    },

    getCurrentPurchaseSubtotal: function () {
        return this.currentPurchase.quantity * this.currentPurchase.unitPrice;
    },

    getPurchaseStageCopy: function (stage = 'configure') {
        const isEn = (window.i18n?.getCurrentLanguage() || 'zh') === 'en';
        return {
            title: window.i18n?.t('shop.confirmRedeem') || (isEn ? 'Confirm Purchase' : '确认兑换'),
            nextLabel: isEn ? 'Redeem' : '兑换',
            backLabel: isEn ? 'Back to Edit' : '返回修改',
            confirmLabel: isEn ? 'Redeem' : '兑换'
        };
    },

    getCurrentPurchaseFlashSalePricingContext: function () {
        const flashSaleOriginalPrice = Number(this.currentPurchase?.flashSaleOriginalPrice);
        const flashSalePrice = Number(this.currentPurchase?.flashSalePrice ?? this.currentPurchase?.basePrice);
        if (this.currentPurchase?.hasFlashSale !== true
            || !Number.isFinite(flashSaleOriginalPrice)
            || !Number.isFinite(flashSalePrice)
            || flashSaleOriginalPrice <= flashSalePrice) {
            return null;
        }

        return {
            flashSaleOriginalPrice,
            flashSalePrice
        };
    },

    getCurrentPurchaseTieredPricingContext: function () {
        if (this.currentPurchase?.hasFlashSale === true) {
            return null;
        }

        return this.getTieredPricingContext({
            basePrice: this.currentPurchase?.basePrice,
            rules: this.currentPurchase?.rules,
            quantity: this.currentPurchase?.quantity
        });
    },

    closeTierRulesPopovers: function (exceptWrap = null) {
        let closed = false;
        document.querySelectorAll('.shop-tier-rules-popover-wrap.is-open').forEach((wrap) => {
            if (exceptWrap && wrap === exceptWrap) {
                return;
            }
            wrap.classList.remove('is-open');
            const trigger = wrap.querySelector('.shop-tier-rules-help');
            if (trigger instanceof HTMLElement) {
                trigger.setAttribute('aria-expanded', 'false');
                if (document.activeElement === trigger) {
                    trigger.blur();
                }
            }
            closed = true;
        });
        return closed;
    },

    toggleTierRulesPopover: function (trigger) {
        if (!(trigger instanceof HTMLElement)) {
            return;
        }
        const wrap = trigger.closest('.shop-tier-rules-popover-wrap');
        if (!(wrap instanceof HTMLElement)) {
            return;
        }

        const shouldOpen = !wrap.classList.contains('is-open');
        this.closeTierRulesPopovers(wrap);
        wrap.classList.toggle('is-open', shouldOpen);
        trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        if (!shouldOpen) {
            trigger.blur();
        }
    },

    buildPurchasePriceContextNote: function () {
        const flashSalePricing = this.getCurrentPurchaseFlashSalePricingContext();
        const isEn = this.isEnglishShopLocale();
        const pointsLabel = this.getShopPointsLabel({ lowercaseEnglish: isEn });
        const originalLabel = this.trShop('originalPrice', isEn ? 'Original' : '原价');
        const tieredLabel = this.getTieredPricingLabel();

        if (flashSalePricing) {
            return {
                variant: 'flash',
                html: `
                    <span class="shop-purchase-price-note__original">
                        ${this.escapeHtml(originalLabel)}
                        <span>${this.escapeHtml(this.formatShopPointValue(flashSalePricing.flashSaleOriginalPrice))} ${this.escapeHtml(pointsLabel)}</span>
                    </span>
                `
            };
        }

        const tieredPricing = this.getCurrentPurchaseTieredPricingContext();
        if (!tieredPricing?.lowestRule) {
            return null;
        }

        const tierRulesHelpHtml = this.buildTieredPricingRulesHelpHtml(tieredPricing, pointsLabel);
        if (!tierRulesHelpHtml) {
            return null;
        }

        if (tieredPricing.activeRule) {
            return {
                variant: 'tier',
                html: `
                    <span class="shop-purchase-price-note__original">
                        ${this.escapeHtml(originalLabel)}
                        <span>${this.escapeHtml(this.formatShopPointValue(tieredPricing.basePrice))} ${this.escapeHtml(pointsLabel)}</span>
                    </span>
                    <span class="shop-purchase-price-note__tier-row">
                        <span class="shop-purchase-price-note__tier">${this.escapeHtml(tieredLabel)}</span>
                        ${tierRulesHelpHtml}
                    </span>
                `
            };
        }

        return {
            variant: 'tier',
            html: `
                <span class="shop-purchase-price-note__tier-row">
                    <span class="shop-purchase-price-note__tier">${this.escapeHtml(tieredLabel)}</span>
                    ${tierRulesHelpHtml}
                </span>
            `
        };
    },

    renderPurchaseUnitPrice: function (unitPrice = null) {
        const normalizedUnitPrice = Math.max(0, Number(unitPrice ?? this.currentPurchase?.unitPrice ?? this.currentPurchase?.basePrice ?? 0) || 0);
        const unitPriceEl = document.getElementById('modalUnitPrice');
        if (unitPriceEl) {
            const flashSalePricing = this.getCurrentPurchaseFlashSalePricingContext();
            const tieredPricing = this.getCurrentPurchaseTieredPricingContext();
            if (flashSalePricing) {
                unitPriceEl.textContent = `${this.trShop('flashSalePrice', this.isEnglishShopLocale() ? 'Flash sale price' : '秒杀价')} ${this.formatShopPointValue(normalizedUnitPrice)}`;
            } else if (tieredPricing?.activeRule) {
                unitPriceEl.textContent = `${this.getTieredPricingLabel()} ${this.formatShopPointValue(normalizedUnitPrice)}`;
            } else {
                unitPriceEl.textContent = this.formatShopPointValue(normalizedUnitPrice);
            }
        }

        const priceContextNoteEl = document.getElementById('modalPriceContextNote');
        if (!priceContextNoteEl) {
            return;
        }

        const note = this.buildPurchasePriceContextNote();
        if (!note?.html) {
            priceContextNoteEl.hidden = true;
            priceContextNoteEl.innerHTML = '';
            priceContextNoteEl.className = 'shop-purchase-price-note';
            return;
        }

        priceContextNoteEl.className = `shop-purchase-price-note shop-purchase-price-note--${this.escapeAttribute(note.variant || 'default')}`;
        priceContextNoteEl.innerHTML = note.html;
        priceContextNoteEl.hidden = false;
    },

    renderPurchaseConfirmationStage: function () {
        if (!this.currentPurchase) return;

        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const isEn = currentLang === 'en';
        const pointsLabel = this.getShopPointsLabel({ lowercaseEnglish: isEn });
        const discountLabel = isEn ? 'Discount' : '优惠';
        const displayName = (currentLang === 'en' && this.currentPurchase.productNameEn)
            ? this.currentPurchase.productNameEn
            : this.currentPurchase.productName;
        const quantity = Math.max(1, Number(this.currentPurchase.quantity) || 1);
        const unitPrice = Math.max(0, Number(this.currentPurchase.unitPrice) || 0);
        const { subtotal, discountAmount, finalTotal } = this.getCurrentPurchasePricingSummary();
        const selectedDiscountCodes = this.getCurrentPurchaseSelectedDiscountCodes();
        const discountCode = selectedDiscountCodes.join(' + ');
        const discountBenefitLabel = String(this.currentPurchase.discountBenefitLabel || '').trim();

        const productNameEl = document.getElementById('purchaseConfirmProductName');
        const quantityEl = document.getElementById('purchaseConfirmQuantity');
        const unitPriceEl = document.getElementById('purchaseConfirmUnitPrice');
        const subtotalEl = document.getElementById('purchaseConfirmSubtotal');
        const discountRowEl = document.getElementById('purchaseConfirmDiscountRow');
        const discountLabelEl = document.getElementById('purchaseConfirmDiscountLabel');
        const discountAmountEl = document.getElementById('purchaseConfirmDiscountAmount');
        const totalEl = document.getElementById('purchaseConfirmTotal');

        if (productNameEl) productNameEl.textContent = displayName || '-';
        if (quantityEl) quantityEl.textContent = String(quantity);
        if (unitPriceEl) {
            const flashSalePricing = this.getCurrentPurchaseFlashSalePricingContext();
            unitPriceEl.textContent = flashSalePricing
                ? `${this.trShop('originalPrice', isEn ? 'Original' : '原价')} ${this.formatShopPointValue(flashSalePricing.flashSaleOriginalPrice)} ${pointsLabel} · ${this.trShop('flashSalePrice', isEn ? 'Flash sale price' : '秒杀价')} ${this.formatShopPointValue(unitPrice)} ${pointsLabel}`
                : `${this.formatShopPointValue(unitPrice)} ${pointsLabel}`;
        }
        if (subtotalEl) subtotalEl.textContent = `${this.formatShopPointValue(subtotal)} ${pointsLabel}`;
        if (totalEl) totalEl.textContent = `${this.formatShopPointValue(finalTotal)} ${pointsLabel}`;

        if (discountRowEl) {
            this.setElementHidden(discountRowEl, discountAmount <= 0);
        }
        if (discountLabelEl) {
            const discountCountLabel = selectedDiscountCodes.length > 1
                ? ` ${this.trShop('couponCount', '（{count} 张）', { count: selectedDiscountCodes.length })}`
                : '';
            discountLabelEl.textContent = discountCode
                ? `${discountLabel}${discountCountLabel} ${discountCode}${discountBenefitLabel ? ` · ${discountBenefitLabel}` : ''}`
                : discountLabel;
        }
        if (discountAmountEl) {
            discountAmountEl.textContent = `-${this.formatShopPointValue(discountAmount)} ${pointsLabel}`;
        }
    },

    setPurchaseStage: function (stage = 'configure') {
        if (!this.currentPurchase) return;

        const nextStage = 'configure';
        const modal = document.getElementById('shopPurchaseModal');
        const stageTitle = document.getElementById('purchaseStageTitle');
        const backBtn = document.getElementById('purchaseBackBtn');
        const addToCartBtn = document.getElementById('purchaseAddToCartBtn');
        const nextBtn = document.getElementById('nextPurchaseStepBtn');
        const confirmBtn = document.getElementById('confirmPurchaseBtn');
        const copy = this.getPurchaseStageCopy(nextStage);
        const isPurchaseProcessing = this.purchaseProcessing === true;

        this.currentPurchase.stage = nextStage;

        if (modal) {
            modal.dataset.purchaseStep = nextStage;
        }

        document.querySelectorAll('#shopPurchaseModal [data-purchase-step]').forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            const hasPurchaseNotes = Boolean(String(this.currentPurchase?.purchaseNotes || '').trim());
            const isNotesStage = element.id === 'purchaseNotesBox';
            const shouldShow = element.dataset.purchaseStep === nextStage
                && (!isNotesStage || hasPurchaseNotes);
            this.setElementHidden(element, !shouldShow);
        });

        if (stageTitle) stageTitle.textContent = copy.title;

        if (backBtn) {
            backBtn.innerHTML = `<i class="fas fa-arrow-left"></i> <span>${this.escapeHtml(copy.backLabel)}</span>`;
            this.setElementHidden(backBtn, nextStage !== 'confirm');
            backBtn.disabled = isPurchaseProcessing;
        }

        if (addToCartBtn) {
            addToCartBtn.innerHTML = `<i class="fas fa-basket-shopping"></i> <span>${this.escapeHtml(this.getCartCopy().addLabel)}</span>`;
            this.setElementHidden(addToCartBtn, nextStage !== 'configure' || Boolean(this.currentPurchase?.cartOrigin?.productId));
            addToCartBtn.disabled = isPurchaseProcessing;
        }

        if (nextBtn) {
            nextBtn.innerHTML = isPurchaseProcessing
                ? `<i class="fas fa-spinner fa-spin"></i> <span>${this.escapeHtml(window.i18n?.t('shop.processing') || '处理中...')}</span>`
                : `<span>${this.escapeHtml(copy.nextLabel)}</span>`;
            this.setElementHidden(nextBtn, nextStage !== 'configure');
            nextBtn.disabled = isPurchaseProcessing;
        }

        if (confirmBtn) {
            confirmBtn.innerHTML = isPurchaseProcessing
                ? `<i class="fas fa-spinner fa-spin"></i> <span>${this.escapeHtml(window.i18n?.t('shop.processing') || '处理中...')}</span>`
                : `<i class="fas fa-shopping-cart"></i> <span>${this.escapeHtml(copy.confirmLabel)}</span>`;
            this.setElementHidden(confirmBtn, nextStage !== 'confirm');
            confirmBtn.disabled = isPurchaseProcessing;
        }

    },

    proceedPurchaseConfirmation: function () {
        if (!this.currentPurchase) return;
        void this.confirmPurchase();
    },

    getDefaultStackingPolicy: function () {
        return {
            is_exclusive: true,
            stack_priority: 100,
            pricing_apply_stage: 'order_discount',
            exclusivity_label: this.trShop('exclusiveCoupon', '排他券'),
            apply_stage_label: this.trShop('orderDiscountStage', '订单优惠阶段'),
            summary: this.trShop('priceWaterfallSummary', '优惠会按价格瀑布顺序结算；排他券单独生效，可并行权益会继续向下叠加。')
        };
    },

    buildLocalPricingWaterfall: function () {
        const { subtotal, discountAmount, finalTotal } = this.getCurrentPurchasePricingSummary();
        const unitPrice = Math.max(0, Number(this.currentPurchase.unitPrice) || 0);
        const quantity = Math.max(1, Number(this.currentPurchase.quantity) || 1);
        const selectedDiscounts = this.getCurrentPurchaseSelectedDiscounts();
        const discountCodes = selectedDiscounts
            .map((selection) => selection.code)
            .filter(Boolean);
        const code = discountCodes.join(' + ');
        const stackingPolicy = this.currentPurchase.stackingPolicy && typeof this.currentPurchase.stackingPolicy === 'object'
            ? {
                ...this.getDefaultStackingPolicy(),
                ...this.currentPurchase.stackingPolicy
            }
            : this.getDefaultStackingPolicy();

        const rows = [
            {
                key: 'unit_price',
                label: this.trShop('siteUnitPrice', '站点结算单价'),
                amount: unitPrice,
                detail: `${unitPrice} x ${quantity}`,
                tone: 'base'
            },
            {
                key: 'subtotal',
                label: this.trShop('productSubtotal', '商品小计'),
                amount: subtotal,
                detail: quantity > 1
                    ? this.trShop('quantity', '数量 {count}', { count: quantity })
                    : this.trShop('singleItem', '单件结算'),
                tone: 'subtotal'
            }
        ];

        if (discountAmount > 0) {
            rows.push({
                key: 'discount',
                label: selectedDiscounts.length > 1
                    ? this.trShop('stackedCoupons', '已叠加 {count} 张卡券', { count: selectedDiscounts.length })
                    : (code ? `${this.trShop('coupon', '优惠券')} ${code}` : this.trShop('discount', '优惠券抵扣')),
                amount: discountAmount,
                display_amount: -discountAmount,
                detail: `${stackingPolicy.apply_stage_label || this.trShop('orderDiscountStage', '订单优惠阶段')} · ${stackingPolicy.exclusivity_label || this.trShop('exclusiveCoupon', '排他券')} · ${this.trShop('priority', '优先级 {value}', { value: stackingPolicy.stack_priority || 100 })}`,
                tone: 'discount'
            });
        }

        rows.push({
            key: 'total',
            label: this.trShop('pointsDue', '实付积分'),
            amount: finalTotal,
            detail: discountAmount > 0
                ? (selectedDiscounts.length > 1
                    ? this.trShop('discountsIncluded', '已包含 {count} 张卡券抵扣', { count: selectedDiscounts.length })
                    : this.trShop('discountIncluded', '已包含优惠抵扣'))
                : this.trShop('noDiscountUsed', '未使用优惠'),
            tone: 'total'
        });

        return {
            rows,
            stackingPolicy
        };
    },

    syncPricingWaterfall: function ({ rows = null, stackingPolicy = null } = {}) {
        const localState = this.buildLocalPricingWaterfall();
        this.currentPurchase.pricingWaterfall = Array.isArray(rows) && rows.length
            ? rows
            : localState.rows;
        this.currentPurchase.stackingPolicy = stackingPolicy && typeof stackingPolicy === 'object'
            ? {
                ...this.getDefaultStackingPolicy(),
                ...stackingPolicy
            }
            : localState.stackingPolicy;
        this.renderPurchasePriceWaterfall();
        this.renderPurchaseConfirmationStage();
        return {
            rows: this.currentPurchase.pricingWaterfall,
            stackingPolicy: this.currentPurchase.stackingPolicy
        };
    },

    renderPurchasePriceWaterfall: function () {
        const container = document.getElementById('purchasePriceWaterfall');
        if (!container) {
            return;
        }

        const fallback = this.buildLocalPricingWaterfall();
        const waterfallRows = Array.isArray(this.currentPurchase.pricingWaterfall) && this.currentPurchase.pricingWaterfall.length
            ? this.currentPurchase.pricingWaterfall
            : fallback.rows;
        const stackingPolicy = this.currentPurchase.stackingPolicy && typeof this.currentPurchase.stackingPolicy === 'object'
            ? {
                ...this.getDefaultStackingPolicy(),
                ...this.currentPurchase.stackingPolicy
            }
            : fallback.stackingPolicy;
        const isEn = this.isEnglishShopLocale();
        const exclusivityLabel = isEn && this.containsCjkText(stackingPolicy.exclusivity_label)
            ? (stackingPolicy.is_exclusive === false ? this.trShop('stackableCoupon', 'Stackable') : this.trShop('exclusiveCoupon', 'Exclusive coupon'))
            : (stackingPolicy.exclusivity_label || this.trShop('exclusiveCoupon', '排他券'));
        const applyStageLabel = isEn && this.containsCjkText(stackingPolicy.apply_stage_label)
            ? this.trShop('orderDiscountStage', 'Order discount stage')
            : (stackingPolicy.apply_stage_label || this.trShop('orderDiscountStage', '订单优惠阶段'));
        const summaryText = isEn && this.containsCjkText(stackingPolicy.summary)
            ? this.trShop('priceWaterfallSummary', 'Coupons are applied in pricing waterfall order. Exclusive coupons apply alone; stackable benefits continue downward.')
            : (stackingPolicy.summary || this.trShop('priceWaterfallCurrentSummary', '当前按价格瀑布顺序结算。'));
        const localizeWaterfallRow = (row = {}) => {
            if (!isEn) {
                return row;
            }
            const key = String(row?.key || '').trim();
            const localized = { ...row };
            if (this.containsCjkText(localized.label)) {
                if (key === 'unit_price') localized.label = this.trShop('siteUnitPrice', 'Site unit price');
                if (key === 'subtotal') localized.label = this.trShop('productSubtotal', 'Product subtotal');
                if (key === 'discount') localized.label = this.trShop('discount', 'Discount');
                if (key === 'total') localized.label = this.trShop('pointsDue', 'Points due');
            }
            if (this.containsCjkText(localized.detail)) {
                if (key === 'discount') {
                    localized.detail = `${applyStageLabel} · ${exclusivityLabel} · ${this.trShop('priority', 'Priority {value}', { value: stackingPolicy.stack_priority || 100 })}`;
                } else if (key === 'total') {
                    localized.detail = this.trShop('discountIncluded', 'Discount included');
                } else {
                    localized.detail = '';
                }
            }
            return localized;
        };

        container.innerHTML = `
            <div class="shop-price-waterfall">
                <div class="shop-price-waterfall__header">
                    <div class="shop-price-waterfall__title">${this.trShop('priceWaterfall', '价格瀑布')}</div>
                    <div class="shop-price-waterfall__policy">
                        <span class="shop-price-waterfall__policy-chip">${this.escapeHtml(exclusivityLabel)}</span>
                        <span class="shop-price-waterfall__policy-chip">${this.escapeHtml(applyStageLabel)}</span>
                        <span class="shop-price-waterfall__policy-chip">${this.escapeHtml(this.trShop('priority', '优先级 {value}', { value: stackingPolicy.stack_priority || 100 }))}</span>
                    </div>
                </div>
                <div class="shop-price-waterfall__rows">
                    ${waterfallRows.map((row) => {
                        const localizedRow = localizeWaterfallRow(row);
                        const tone = String(row?.tone || '').trim().toLowerCase() || 'base';
                        const rawAmount = Number(localizedRow?.display_amount ?? localizedRow?.amount);
                        const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
                        const prefix = amount > 0 && tone !== 'total' ? '+' : '';
                        const displayAmount = `${prefix}${this.formatShopPointValue(amount)}`;

                        return `
                            <div class="shop-price-waterfall__row shop-price-waterfall__row--${this.escapeHtml(tone)}">
                                <div class="shop-price-waterfall__row-copy">
                                    <strong>${this.escapeHtml(localizedRow?.label || this.trShop('priceItem', '价格项'))}</strong>
                                    ${localizedRow?.detail ? `<span>${this.escapeHtml(localizedRow.detail)}</span>` : ''}
                                </div>
                                <div class="shop-price-waterfall__row-value">${this.escapeHtml(displayAmount)}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="shop-price-waterfall__footer">${this.escapeHtml(summaryText)}</div>
            </div>
        `;
    },

    calculateDiscountPricingForConfig: function (subtotal, { discountType = '', discountValue = null } = {}) {
        const normalizedSubtotal = Math.max(0, Number(subtotal || 0) || 0);
        const normalizedDiscountType = String(discountType || '').trim().toLowerCase();
        const normalizedDiscountValue = Number(discountValue);
        if (!normalizedDiscountType || !Number.isFinite(normalizedDiscountValue) || normalizedDiscountValue <= 0) {
            return {
                discountAmount: 0,
                finalTotal: normalizedSubtotal
            };
        }

        if (normalizedDiscountType === 'percent') {
            const finalTotal = Math.max(
                0,
                Math.min(normalizedSubtotal, Number(((normalizedSubtotal * normalizedDiscountValue) / 100).toFixed(2)))
            );

            return {
                discountAmount: Math.max(0, Number((normalizedSubtotal - finalTotal).toFixed(2))),
                finalTotal
            };
        }

        if (normalizedDiscountType === 'fixed') {
            const discountAmount = Math.min(normalizedSubtotal, normalizedDiscountValue);
            return {
                discountAmount,
                finalTotal: Math.max(0, Number((normalizedSubtotal - discountAmount).toFixed(2)))
            };
        }

        return {
            discountAmount: 0,
            finalTotal: normalizedSubtotal
        };
    },

    calculateDiscountPricing: function (subtotal) {
        const discountType = this.currentPurchase.discountType;
        const discountValue = Number(this.currentPurchase.discountValue);
        if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
            return {
                discountAmount: 0,
                finalTotal: Math.max(0, subtotal)
            };
        }
        return this.calculateDiscountPricingForConfig(subtotal, { discountType, discountValue });
    },

    syncDiscountedTotal: function () {
        const subtotal = this.getCurrentPurchaseSubtotal();
        const { discountAmount, finalTotal } = this.calculateDiscountPricing(subtotal);
        this.currentPurchase.discountAmount = discountAmount;
        this.currentPurchase.discountFinalTotal = finalTotal;
        document.getElementById('modalTotalPrice').textContent = this.formatShopPointValue(finalTotal);
        this.syncPricingWaterfall();
        return {
            subtotal,
            discountAmount,
            finalTotal
        };
    },

    getCurrentPurchaseSelectedDiscounts: function () {
        return this.normalizePurchaseDiscountSelectionSnapshots(this.currentPurchase?.selectedDiscounts || []);
    },

    getCurrentPurchaseSelectedDiscountCodes: function () {
        return this.getCurrentPurchaseSelectedDiscounts()
            .map((selection) => selection.code)
            .filter(Boolean);
    },

    buildCurrentPurchaseDiscountBenefitLabel: function (selectedDiscounts = null) {
        const normalizedSelections = Array.isArray(selectedDiscounts)
            ? this.normalizePurchaseDiscountSelectionSnapshots(selectedDiscounts)
            : this.getCurrentPurchaseSelectedDiscounts();
        if (!normalizedSelections.length) {
            return '';
        }
        if (normalizedSelections.length === 1) {
            return normalizedSelections[0].benefitLabel || normalizedSelections[0].code || '';
        }
        return this.trShop('stackedCoupons', '已叠加 {count} 张券', { count: normalizedSelections.length });
    },

    syncCurrentPurchaseDiscountSelectionState: function (selectedDiscounts = null) {
        const normalizedSelections = Array.isArray(selectedDiscounts)
            ? this.normalizePurchaseDiscountSelectionSnapshots(selectedDiscounts)
            : this.getCurrentPurchaseSelectedDiscounts();
        this.currentPurchase.selectedDiscounts = normalizedSelections;
        this.currentPurchase.appliedDiscounts = normalizedSelections;

        const firstSelection = normalizedSelections[0] || null;
        this.currentPurchase.discountCode = normalizedSelections.length === 1
            ? (firstSelection?.code || null)
            : (normalizedSelections.map((selection) => selection.code).filter(Boolean).join(' + ') || null);
        this.currentPurchase.discountAssetId = normalizedSelections.length === 1
            ? (firstSelection?.assetId || null)
            : null;
        this.currentPurchase.discountType = normalizedSelections.length === 1
            ? (firstSelection?.discountType || null)
            : null;
        this.currentPurchase.discountValue = normalizedSelections.length === 1
            ? (firstSelection?.discountValue ?? null)
            : null;
        this.currentPurchase.discountBenefitLabel = this.buildCurrentPurchaseDiscountBenefitLabel(normalizedSelections);
        return normalizedSelections;
    },

    serializeDiscountSelectionsForRequest: function (selectedDiscounts = null, options = {}) {
        const normalizedSelections = Array.isArray(selectedDiscounts)
            ? this.normalizePurchaseDiscountSelectionSnapshots(selectedDiscounts, {
                allowIdentityOnly: options.allowIdentityOnly === true
            })
            : this.getCurrentPurchaseSelectedDiscounts();
        return normalizedSelections.map((selection) => ({
            code: selection.code || null,
            assetId: selection.assetId || null
        }));
    },

    setDiscountAppliedMessage: function ({ discountAmount = 0, finalTotal = null, benefitLabel = '', selectionCount = 0 } = {}) {
        const pointsLabel = this.getShopPointsLabel();
        const normalizedDiscountAmount = Number(discountAmount);
        const normalizedFinalTotal = Number(finalTotal);
        const normalizedSelectionCount = Math.max(0, Number(selectionCount || 0) || 0);
        const normalizedBenefitLabel = String(benefitLabel || '').trim()
            || (normalizedSelectionCount > 1 ? this.trShop('stackedCoupons', '已叠加 {count} 张券', { count: normalizedSelectionCount }) : '');
        const savedText = Number.isFinite(normalizedDiscountAmount) && normalizedDiscountAmount > 0
            ? this.trShop('savedSuffix', '，已优惠 {amount} {unit}', {
                amount: this.formatShopPointValue(normalizedDiscountAmount),
                unit: pointsLabel
            })
            : '';
        let messageText = '';
        if (normalizedBenefitLabel && Number.isFinite(normalizedFinalTotal)) {
            messageText = this.isEnglishShopLocale()
                ? this.trShop('discountAppliedWithTotal', '{benefit} applied. Current total {total} {unit}{saved}', {
                    benefit: normalizedBenefitLabel,
                    total: this.formatShopPointValue(normalizedFinalTotal),
                    unit: pointsLabel,
                    saved: savedText
                })
                : `已应用 ${normalizedBenefitLabel}，当前实付 ${this.formatShopPointValue(normalizedFinalTotal)} ${pointsLabel}${Number.isFinite(normalizedDiscountAmount) && normalizedDiscountAmount > 0 ? `，已优惠 ${this.formatShopPointValue(normalizedDiscountAmount)} ${pointsLabel}` : ''}`;
        } else if (normalizedBenefitLabel) {
            messageText = this.trShop('discountAppliedSaved', '已应用 {benefit}{saved}', {
                benefit: normalizedBenefitLabel,
                saved: savedText
            });
        } else {
            messageText = `${window.i18n?.t('shop.discountApplied') || '已抵扣'} ${this.formatShopPointValue(normalizedDiscountAmount)} ${pointsLabel}`;
        }
        this.setDiscountMessage(
            `<i class="fas fa-check-circle" aria-hidden="true"></i><span>${this.escapeHtml(messageText)}</span>`,
            { variant: 'success', html: true }
        );
    },

    resetDiscountState: function ({ clearMessage = true } = {}) {
        this.currentPurchase.selectedDiscounts = [];
        this.currentPurchase.appliedDiscounts = [];
        this.currentPurchase.discountCode = null;
        this.currentPurchase.discountAssetId = null;
        this.currentPurchase.discountType = null;
        this.currentPurchase.discountValue = null;
        this.currentPurchase.discountBenefitLabel = '';
        this.currentPurchase.discountAmount = 0;
        this.currentPurchase.discountFinalTotal = null;
        this.currentPurchase.pricingWaterfall = [];
        this.currentPurchase.stackingPolicy = this.getDefaultStackingPolicy();
        document.getElementById('modalTotalPrice').textContent = this.formatShopPointValue(this.getCurrentPurchaseSubtotal());
        this.syncPricingWaterfall();
        if (clearMessage) {
            this.setDiscountMessage('');
        }
        this.renderPurchaseDiscountAssets();
    },

    formatDiscountSourceLabel: function (item = {}) {
        const explicitLabel = String(item?.source_label || '').trim();
        if (explicitLabel && (!this.isEnglishShopLocale() || !this.containsCjkText(explicitLabel))) {
            return explicitLabel;
        }

        const sourceChannel = String(item?.source_channel || '').trim().toLowerCase();
        const distributionMode = String(item?.distribution_mode || '').trim().toLowerCase();

        if (sourceChannel.includes('wallet') || sourceChannel.includes('recharge')) return this.trShop('rechargeCoupon', '充值赠券');
        if (sourceChannel.includes('checkin')) return this.trShop('checkinReward', '签到奖励');
        if (sourceChannel.includes('affiliate') || sourceChannel.includes('invite')) return this.trShop('affiliateReward', '推广奖励');
        if (sourceChannel.includes('claim')) return this.trShop('publicClaim', '公开领取');
        if (sourceChannel.includes('manual') || sourceChannel.includes('admin')) return this.trShop('adminIssued', '后台发放');
        if (sourceChannel.includes('shop_wallet')) return this.trShop('walletCoupon', '卡包跳转');
        if (distributionMode === 'public_claim') return this.trShop('publicClaim', '公开领取');
        if (distributionMode === 'user_assigned') return this.trShop('assignedCoupon', '定向发放');
        if (distributionMode === 'general_code') return this.trShop('generalCode', '暗码兑换');
        return '';
    },

    formatDiscountStackingLabel: function (item = {}) {
        return item?.is_exclusive === false
            ? this.trShop('stackableCoupon', '可叠加')
            : this.trShop('exclusiveCoupon', '排他券');
    },

    formatDiscountStackingSummary: function (item = {}) {
        const explicitSummary = String(item?.stacking_summary || '').trim();
        if (explicitSummary && (!this.isEnglishShopLocale() || !this.containsCjkText(explicitSummary))) {
            return explicitSummary;
        }
        return item?.is_exclusive === false
            ? this.trShop('stackableSummary', '可与其它优惠券叠加')
            : this.trShop('exclusiveSummary', '不可与其它优惠券叠加');
    },

    getDiscountStackingBadgeClassName: function (item = {}) {
        return item?.is_exclusive === false
            ? 'shop-discount-asset-card__stacking shop-discount-asset-card__stacking--stackable'
            : 'shop-discount-asset-card__stacking shop-discount-asset-card__stacking--exclusive';
    },

    normalizeShopRequestError: function (error = null, { fallbackMessage = '优惠服务连接失败，请刷新后重试' } = {}) {
        const rawMessage = String(error?.message || error || '').trim();
        const normalizedMessage = rawMessage.toLowerCase();

        if (String(error?.name || '').trim() === 'AbortError') {
            return new Error('请求已中断，请稍后重试');
        }

        if (
            normalizedMessage === 'typeerror: fetch failed'
            || normalizedMessage === 'fetch failed'
            || normalizedMessage === 'failed to fetch'
            || normalizedMessage.includes('networkerror')
            || normalizedMessage.includes('load failed')
            || normalizedMessage.includes('network request failed')
            || normalizedMessage.includes('exceed_egress_quota')
            || normalizedMessage.includes('service for this project is restricted')
            || normalizedMessage.includes('supabase support')
        ) {
            return new Error(fallbackMessage);
        }

        if (error instanceof Error) {
            return error;
        }

        return new Error(rawMessage || fallbackMessage);
    },

    collectKnownShopProducts: function () {
        const productMap = new Map();
        const addProduct = (product = null) => {
            const productId = String(product?.id || '').trim();
            if (!productId || productMap.has(productId)) {
                return;
            }
            productMap.set(productId, product);
        };

        (Array.isArray(this.allProductsCache) ? this.allProductsCache : []).forEach(addProduct);
        Object.values(this.categoryProductsCache || {}).forEach((list) => {
            (Array.isArray(list) ? list : []).forEach(addProduct);
        });

        const currentProductId = String(this.currentPurchase?.productId || '').trim();
        if (currentProductId) {
            addProduct(this.getCachedProductById(currentProductId));
        }

        return Array.from(productMap.values());
    },

    getDiscountTargetProducts: function (item = {}) {
        const currentProductId = String(this.currentPurchase?.productId || '').trim();
        const scopeType = String(item?.scope_type || '').trim().toLowerCase();
        const targetProducts = [];
        const seenProductIds = new Set();

        const pushProduct = (productId = '', fallbackName = '') => {
            const normalizedProductId = String(productId || '').trim();
            if (!normalizedProductId || normalizedProductId === currentProductId || seenProductIds.has(normalizedProductId)) {
                return;
            }

            const cachedProduct = this.getCachedProductById(normalizedProductId);
            if (cachedProduct?.is_active === false) {
                return;
            }

            const label = String(
                this.getLocalizedProductName(cachedProduct)
                || (this.isEnglishShopLocale() ? cachedProduct?.name_en : '')
                || fallbackName
                || ''
            ).trim() || this.trShop('specificProduct', '指定商品');

            seenProductIds.add(normalizedProductId);
            targetProducts.push({
                id: normalizedProductId,
                label
            });
        };

        if (scopeType === 'product') {
            const scopeProduct = item?.scope_product && typeof item.scope_product === 'object'
                ? item.scope_product
                : null;
            pushProduct(
                scopeProduct?.id || item?.scope_product_id,
                (this.isEnglishShopLocale() ? scopeProduct?.name_en : '')
                    || scopeProduct?.display_name
                    || scopeProduct?.name
                    || scopeProduct?.name_en
                    || this.trShop('specificProduct', '指定商品')
            );
            return targetProducts;
        }

        if (scopeType === 'category') {
            const scopeCategory = String(item?.scope_category || '').trim();
            if (!scopeCategory) {
                return targetProducts;
            }

            this.collectKnownShopProducts()
                .filter((product) => (
                    String(product?.category || '').trim() === scopeCategory
                    && product?.is_active !== false
                ))
                .slice(0, 4)
                .forEach((product) => {
                    pushProduct(product?.id, this.getLocalizedProductName(product) || product?.name || product?.name_en || scopeCategory);
                });
        }

        return targetProducts;
    },

    formatDiscountExpiryLabel: function (item = {}, { includePrefix = true, preferClaimWindow = false } = {}) {
        const isEn = this.isEnglishShopLocale();
        const rawValue = String(
            (preferClaimWindow
                ? (item?.claim_expires_at || item?.effective_expires_at || item?.expires_at)
                : (item?.effective_expires_at || item?.expires_at || item?.claim_expires_at))
            || ''
        ).trim();

        if (!rawValue) {
            return isEn ? 'No expiry' : '长期有效';
        }

        const parsedDate = new Date(rawValue);
        const formattedValue = Number.isNaN(parsedDate.getTime())
            ? rawValue
            : parsedDate.toLocaleString(isEn ? 'en-US' : 'zh-CN', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

        if (!includePrefix) {
            return formattedValue;
        }

        return `${isEn ? 'Valid until' : '有效至'} ${formattedValue}`;
    },

    formatDiscountUnavailableReason: function (item = {}, { short = false } = {}) {
        const rawMessage = String(item?.message || '').trim();
        if (!rawMessage || /^(?:当前不可用|请稍后再试)$/u.test(rawMessage)) {
            return '';
        }

        if (/不允许全额抵扣/u.test(rawMessage)) {
            return short
                ? this.trShop('fixedCouponZeroShort', '抵后会变成 0，不支持全额抵扣')
                : this.trShop('fixedCouponZeroLong', '当前价格会被抵到 0，这张券不支持全额抵扣');
        }

        if (/暂无可优惠金额/u.test(rawMessage)) {
            return short
                ? this.trShop('noDiscountableAmountShort', '当前商品没有可优惠金额')
                : this.trShop('noDiscountableAmountLong', '当前商品没有可优惠金额，暂时无法使用这张券');
        }

        if (/不能与其他卡券叠加/u.test(rawMessage)) {
            return short
                ? this.trShop('exclusiveRequiredShort', '需要单独使用，不能叠加')
                : this.trShop('exclusiveRequiredLong', '这张券需要单独使用，不能与其他卡券叠加');
        }

        if (this.isEnglishShopLocale() && this.containsCjkText(rawMessage)) {
            return this.trShop('currentProductUnavailable', '当前商品不可用');
        }

        return rawMessage.replace(/^指定商品当前不可用[:：]?\s*/u, '');
    },

    buildDiscountTargetProductsMarkup: function (item = {}, targetProducts = null) {
        const normalizedTargetProducts = Array.isArray(targetProducts)
            ? targetProducts
            : this.getDiscountTargetProducts(item);
        const scopeLabel = String(item?.scope_label || '').trim();
        const localizedScopeLabel = this.isEnglishShopLocale() && this.containsCjkText(scopeLabel)
            ? this.trShop('specificProduct', 'Specific product')
            : scopeLabel;

        if (!normalizedTargetProducts.length && (!scopeLabel || scopeLabel === '全场可用')) {
            return '';
        }

        if (!normalizedTargetProducts.length) {
            return `
                <div class="shop-discount-asset-card__targets shop-discount-asset-card__targets--static">
                    <span class="shop-discount-asset-card__targets-label">${this.trShop('applicableScope', '适用范围')}</span>
                    <div class="shop-discount-asset-card__scope">${this.escapeHtml(localizedScopeLabel)}</div>
                </div>
            `;
        }

        return `
            <div class="shop-discount-asset-card__targets">
                <div class="shop-discount-asset-card__targets-head">
                    <span class="shop-discount-asset-card__targets-label">${this.trShop('availableProducts', '可用商品')}</span>
                    <span class="shop-discount-asset-card__targets-count">${this.escapeHtml(String(normalizedTargetProducts.length))}</span>
                </div>
                <div class="shop-discount-asset-card__targets-list">
                    ${normalizedTargetProducts.map((product) => `
                        <button
                            type="button"
                            class="shop-discount-asset-card__target-link"
                            data-shop-discount-action="jump-product"
                            data-target-product-id="${this.escapeAttribute(product.id)}"
                        >
                            <span class="shop-discount-asset-card__target-name">${this.escapeHtml(product.label)}</span>
                            <span class="shop-discount-asset-card__target-action">${this.trShop('openProduct', '查看商品')}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    },

    buildDiscountAssetCardMarkup: function (item = {}, { selected = false, claimable = false, claimPending = false } = {}) {
        const targetProducts = !claimable && item.available === false
            ? this.getDiscountTargetProducts(item)
            : [];
        const targetProductsMarkup = !claimable && item.available === false
            ? this.buildDiscountTargetProductsMarkup(item, targetProducts)
            : '';
        const hasProductTargets = targetProducts.length > 0;
        const isUnavailableCard = !claimable && item.available === false;
        const isCollapsibleUnavailableCard = isUnavailableCard && hasProductTargets;
        const expiryLabel = this.formatDiscountExpiryLabel(item, { includePrefix: true });
        const label = claimable
            ? (claimPending
                ? this.trShop('claiming', '领取中')
                : (item.can_claim ? this.trShop('claimNow', '立即领取') : this.trShop('claimLimitReached', '已达上限')))
            : (item.available
                ? (selected ? this.trShop('selected', '已选中') : this.trShop('tapToUse', '点击使用'))
                : expiryLabel);
        const benefitLabel = this.getDiscountBenefitLabel(item);
        const stackingLabel = this.formatDiscountStackingLabel(item);
        const stackingSummary = this.formatDiscountStackingSummary(item);
        const precisePreviewTotal = this.getDiscountPrecisePreviewTotal(item);
        const previewDiscountAmount = Number(item?.preview?.discount_amount);
        const previewFinalTotal = Number(item?.preview?.final_total);
        const effectiveFinalTotal = Number.isFinite(previewFinalTotal) ? previewFinalTotal : precisePreviewTotal;
        const unavailableSummaryReason = isUnavailableCard
            ? this.formatDiscountUnavailableReason(item, { short: isCollapsibleUnavailableCard })
            : '';
        const unavailableDetailReason = isUnavailableCard
            ? this.formatDiscountUnavailableReason(item, { short: false })
            : '';
        const metaParts = [];
        if (!isUnavailableCard) {
            if (Number.isFinite(effectiveFinalTotal) && effectiveFinalTotal >= 0) {
                metaParts.push(this.trShop('discountedTotal', '{label} {amount}', {
                    label: Number.isFinite(previewFinalTotal)
                        ? this.trShop('payNow', '实付')
                        : this.trShop('discountedPrice', '折后'),
                    amount: this.formatShopPointValue(effectiveFinalTotal)
                }));
            }
            if (Number.isFinite(previewDiscountAmount) && previewDiscountAmount > 0) {
                metaParts.push(this.trShop('savedAmount', '已优惠 {amount}', { amount: this.formatShopPointValue(previewDiscountAmount) }));
            }
        }
        if (isUnavailableCard) {
            if (this.isEnglishShopLocale()) {
                metaParts.push(this.trShop('validityInline', 'Valid until {date}', {
                    date: this.formatDiscountExpiryLabel(item, { includePrefix: false })
                }));
            } else {
                metaParts.push(`有效期 ${this.formatDiscountExpiryLabel(item, { includePrefix: false })}`);
            }
        } else if (item.claim_expires_at) {
            metaParts.push(this.trShop('claimUntil', '领取至 {date}', {
                date: new Date(item.claim_expires_at).toLocaleString()
            }));
        } else if (item.expires_at || item.effective_expires_at) {
            metaParts.push(this.formatDiscountExpiryLabel(item, { includePrefix: true }));
        }
        const sourceLabel = this.formatDiscountSourceLabel(item);
        if (sourceLabel) {
            metaParts.push(sourceLabel);
        }
        if (stackingSummary) {
            metaParts.push(stackingSummary);
        }
        const rawHint = String(item.message || '').trim();
        const hintText = isUnavailableCard ? unavailableDetailReason : rawHint;
        const localizedHintText = this.isEnglishShopLocale() && this.containsCjkText(hintText)
            ? ''
            : hintText;
        const shouldRenderHint = localizedHintText && !/^(?:优惠码可用|当前可用)$/u.test(localizedHintText);
        const isInteractiveCard = claimable || item.available !== false;
        const cardTag = isInteractiveCard ? 'button' : 'div';
        const cardClassName = `shop-discount-asset-card${selected ? ' is-selected' : ''}${item.available === false && !claimable ? ' is-disabled' : ''}${hasProductTargets ? ' has-product-targets' : ''}`;
        const interactiveAttrs = isInteractiveCard
            ? `
                type="button"
                data-shop-discount-action="${claimable ? 'claim' : 'apply'}"
                data-discount-asset-id="${this.escapeHtml(item.asset_id || '')}"
                data-discount-id="${this.escapeHtml(item.discount_id || '')}"
                data-discount-code="${this.escapeHtml(item.code || '')}"
                ${claimPending ? 'aria-busy="true"' : ''}
                ${claimable ? (!item.can_claim ? 'disabled' : '') : (!item.available ? 'disabled' : '')}
            `
            : 'role="group"';
        const topMarkup = `
            <div class="shop-discount-asset-card__top">
                <div class="shop-discount-asset-card__identity">
                    <strong>${this.escapeHtml(item.code || this.trShop('coupon', '优惠券'))}</strong>
                    ${benefitLabel ? `<span class="shop-discount-asset-card__benefit">${this.escapeHtml(benefitLabel)}</span>` : ''}
                    ${stackingLabel ? `<span class="${this.getDiscountStackingBadgeClassName(item)}">${this.escapeHtml(stackingLabel)}</span>` : ''}
                </div>
                ${isCollapsibleUnavailableCard
                    ? `
                        <span class="shop-discount-asset-card__disclosure">
                            <span class="shop-discount-asset-card__chevron" aria-hidden="true"></span>
                        </span>
                    `
                    : `<span class="shop-discount-asset-card__cta${isUnavailableCard ? ' shop-discount-asset-card__cta--expiry' : ''}">${this.escapeHtml(label)}</span>`}
            </div>
        `;
        const summaryReasonMarkup = isCollapsibleUnavailableCard && unavailableSummaryReason
            ? `<div class="shop-discount-asset-card__summary-reason">${this.escapeHtml(unavailableSummaryReason)}</div>`
            : '';
        const metaMarkup = `<div class="shop-discount-asset-card__meta">${this.escapeHtml(metaParts.join(' · ') || localizedHintText || this.trShop('availableForCurrentProduct', '可在当前商品结算时使用'))}</div>`;
        const hintMarkup = shouldRenderHint ? `<div class="shop-discount-asset-card__hint">${this.escapeHtml(localizedHintText)}</div>` : '';

        if (isCollapsibleUnavailableCard) {
            return `
                <details class="${cardClassName} shop-discount-asset-card--collapsible">
                    <summary class="shop-discount-asset-card__summary">
                        ${topMarkup}
                        ${summaryReasonMarkup}
                    </summary>
                    <div class="shop-discount-asset-card__fold">
                        <div class="shop-discount-asset-card__fold-inner">
                            ${metaMarkup}
                            ${hintMarkup}
                            ${targetProductsMarkup}
                        </div>
                    </div>
                </details>
            `;
        }

        return `
            <${cardTag}
                class="${cardClassName}"
                ${interactiveAttrs}>
                ${topMarkup}
                ${metaMarkup}
                ${hintMarkup}
                ${targetProductsMarkup}
            </${cardTag}>
        `;
    },

    toggleDiscountAssetAccordion: function (detailsEl) {
        const details = detailsEl instanceof HTMLElement ? detailsEl : null;
        const summary = details?.querySelector('.shop-discount-asset-card__summary');
        const fold = details?.querySelector('.shop-discount-asset-card__fold');
        const inner = details?.querySelector('.shop-discount-asset-card__fold-inner');
        if (!details || !summary || !fold || !inner) {
            return;
        }

        if (details.dataset.animating === '1') {
            return;
        }

        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        const isOpening = !details.open;
        if (prefersReducedMotion) {
            details.open = isOpening;
            return;
        }

        const durationMs = 280;
        const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
        const collapsedHeight = Math.max(0, Math.round(summary.offsetHeight || 0));
        const expandedHeight = (() => {
            if (!details.open) {
                details.open = true;
            }
            return Math.max(collapsedHeight, Math.round(summary.offsetHeight + fold.scrollHeight));
        })();
        const startHeight = isOpening ? collapsedHeight : Math.max(collapsedHeight, Math.round(details.offsetHeight || expandedHeight));
        const endHeight = isOpening ? expandedHeight : collapsedHeight;
        let cleanedUp = false;

        const cleanup = ({ closeAfter = false } = {}) => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;
            if (closeAfter) {
                details.open = false;
            }
            delete details.dataset.animating;
            details.classList.remove('is-animating', 'is-collapsing');
            details.style.removeProperty('height');
            details.style.removeProperty('overflow');
            details.style.removeProperty('transition');
            fold.style.removeProperty('opacity');
            fold.style.removeProperty('transition');
            inner.style.removeProperty('transform');
            inner.style.removeProperty('transition');
        };

        const finish = () => cleanup({ closeAfter: !isOpening });
        const handleTransitionEnd = (event) => {
            if (event.target !== details || event.propertyName !== 'height') {
                return;
            }
            details.removeEventListener('transitionend', handleTransitionEnd);
            finish();
        };

        details.dataset.animating = '1';
        details.classList.add('is-animating');
        details.classList.toggle('is-collapsing', !isOpening);
        details.style.height = `${startHeight}px`;
        details.style.overflow = 'hidden';
        details.style.transition = `height ${durationMs}ms ${easing}`;
        fold.style.transition = `opacity ${Math.max(160, durationMs - 60)}ms ease`;
        inner.style.transition = `transform ${durationMs}ms ${easing}`;
        fold.style.opacity = isOpening ? '0' : '1';
        inner.style.transform = isOpening ? 'translateY(-8px)' : 'translateY(0)';

        void details.offsetHeight;
        details.addEventListener('transitionend', handleTransitionEnd);

        window.requestAnimationFrame(() => {
            if (isOpening) {
                fold.style.opacity = '1';
                inner.style.transform = 'translateY(0)';
            } else {
                fold.style.opacity = '0';
                inner.style.transform = 'translateY(-8px)';
            }
            details.style.height = `${endHeight}px`;
        });

        window.setTimeout(() => {
            details.removeEventListener('transitionend', handleTransitionEnd);
            finish();
        }, durationMs + 120);
    },

    renderPurchaseDiscountAssets: function () {
        const container = document.getElementById('purchaseDiscountAssetsPanel');
        if (!container) return;

        const selectedAssetIds = new Set(
            this.getCurrentPurchaseSelectedDiscounts()
                .map((selection) => String(selection.assetId || '').trim())
                .filter(Boolean)
        );
        const pendingClaimDiscountIds = this.pendingClaimDiscountIds instanceof Set
            ? this.pendingClaimDiscountIds
            : new Set();
        const ownedItems = Array.isArray(this.currentPurchase.availableDiscountAssets)
            ? this.currentPurchase.availableDiscountAssets
            : [];
        const currentlyAvailableItems = ownedItems.filter((item) => item?.available !== false);
        const currentlyUnavailableItems = ownedItems.filter((item) => item?.available === false);
        const claimableItems = Array.isArray(this.currentPurchase.claimableDiscounts)
            ? this.currentPurchase.claimableDiscounts
            : [];
        const discountAssetsLoading = this.currentPurchase?.discountAssetsLoading === true;
        const shouldWaitForLiveAvailableItems = discountAssetsLoading
            && !currentlyAvailableItems.length
            && !claimableItems.length
            && currentlyUnavailableItems.length > 0;

        if ((!ownedItems.length && !claimableItems.length) || shouldWaitForLiveAvailableItems) {
            container.innerHTML = discountAssetsLoading
                ? `<div class="shop-discount-assets-empty">${this.trShop('syncingCurrentCoupons', '正在同步当前商品可用卡券...')}</div>`
                : `<div class="shop-discount-assets-empty">${this.trShop('noSelectableCoupons', '当前没有可直接选择的卡券，仍可继续输入暗码。')}</div>`;
            this.schedulePurchaseModalKeyboardContentSync();
            this.bindPurchaseDiscountActionTapFallbacks();
            return;
        }

        container.innerHTML = `
            <div class="shop-discount-assets-shell">
                ${currentlyAvailableItems.length ? `
                    <div class="shop-discount-assets-group">
                        <div class="shop-discount-assets-group__title">${this.trShop('currentProductAvailable', '当前商品可用')}</div>
                        <div class="shop-discount-assets-grid">
                            ${currentlyAvailableItems.map((item) => this.buildDiscountAssetCardMarkup(item, {
                                selected: selectedAssetIds.has(String(item?.asset_id || '').trim())
                            })).join('')}
                        </div>
                    </div>
                ` : ''}
                ${currentlyUnavailableItems.length ? `
                    <div class="shop-discount-assets-group">
                        <div class="shop-discount-assets-group__title">${this.trShop('currentProductUnavailable', '当前商品不可用')}</div>
                        <div class="shop-discount-assets-grid">
                            ${currentlyUnavailableItems.map((item) => this.buildDiscountAssetCardMarkup(item, {
                                selected: selectedAssetIds.has(String(item?.asset_id || '').trim())
                            })).join('')}
                        </div>
                    </div>
                ` : ''}
                ${claimableItems.length ? `
                    <div class="shop-discount-assets-group">
                        <div class="shop-discount-assets-group__title">${this.trShop('claimableDiscounts', '可领取优惠')}</div>
                        <div class="shop-discount-assets-grid">
                            ${claimableItems.map((item) => this.buildDiscountAssetCardMarkup(item, {
                                claimable: true,
                                claimPending: pendingClaimDiscountIds.has(String(item?.discount_id || '').trim())
                            })).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
        this.schedulePurchaseModalKeyboardContentSync();
        this.bindPurchaseDiscountActionTapFallbacks();
    },

    jumpToDiscountTargetProduct: async function (productId, options = {}) {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) {
            return;
        }

        this.pendingProductSpotlight = {
            productId: normalizedProductId,
            autoOpen: options.autoOpen !== false,
            sourceContext: {
                sourcePage: 'purchase_modal',
                sourceChannel: 'discount_asset_target_product',
                sourcePromptId: null
            }
        };

        this.closePurchaseModal();
        await this.fulfillPendingProductSpotlight();
    },

    loadAvailableDiscountAssetsWithServer: async function () {
        return this.requestAvailableDiscountAssets({
            productId: this.currentPurchase?.productId,
            quantity: this.currentPurchase?.quantity,
            agentId: this.currentAgentId,
            site: window.SiteConfig?.site || 'cn',
            preferCache: false,
            allowPending: true
        });
    },

    claimDiscountWithServer: async function (discountId) {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error(window.i18n?.t('shop.loginRequired') || '请先登录');
        }

        let response;
        try {
            response = await fetch('/api/shop/claim-discount', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    discountId,
                    site: window.SiteConfig?.site || 'cn'
                })
            });
        } catch (error) {
            throw this.normalizeShopRequestError(error, {
                fallbackMessage: '领取卡券请求失败，请稍后重试'
            });
        }

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || '领取失败');
        }

        return payload;
    },

    loadProductGuidance: async function (productId) {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) {
            return {
                loaded: false,
                purchaseNotes: '',
                usageInstructions: ''
            };
        }

        const normalizeGuidancePayload = (data = {}) => {
            const purchaseNotes = typeof data?.purchase_notes === 'string'
                ? data.purchase_notes.trim()
                : '';
            const usageInstructions = typeof data?.usage_instructions === 'string'
                ? data.usage_instructions.trim()
                : '';
            const hasPurchaseNotes = data?.has_purchase_notes === true || data?.show_purchase_notes === true;
            const hasUsageInstructions = data?.has_usage_instructions === true || data?.show_usage_instructions === true;

            return {
                loaded: true,
                purchaseNotes: purchaseNotes || (hasPurchaseNotes ? this.getMissingProductGuidanceTranslationText('purchase_notes') : ''),
                usageInstructions: usageInstructions || (hasUsageInstructions ? this.getMissingProductGuidanceTranslationText('usage_instructions') : '')
            };
        };

        try {
            const token = await this.getAccessToken().catch(() => '');
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
            const response = await fetch('/api/shop/product-guidance', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    productId: normalizedProductId,
                    site: this.getGuidanceSiteForCurrentLanguage()
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (response.ok && payload?.success !== false) {
                const data = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
                    ? payload.data
                    : {};
                return normalizeGuidancePayload(data);
            }
        } catch (error) {
            console.warn('Failed to load product guidance from API route, falling back to direct query:', error);
        }

        try {
            const client = window.supabaseClient || supabaseClient;
            const guidanceSelect = 'show_purchase_notes, purchase_notes, purchase_notes_zh, purchase_notes_en, show_usage_instructions, usage_instructions, usage_instructions_zh, usage_instructions_en';
            let { data, error } = await client
                .from('shop_products')
                .select(guidanceSelect)
                .eq('id', normalizedProductId)
                .eq('is_active', true)
                .single();

            if (error) {
                const message = String(error?.message || '').toLowerCase();
                const missingBilingualGuidanceColumn = [
                    'purchase_notes_zh',
                    'purchase_notes_en',
                    'usage_instructions_zh',
                    'usage_instructions_en'
                ].some((field) => message.includes(field));
                if (!missingBilingualGuidanceColumn) {
                    throw error;
                }
                const legacyResult = await client
                    .from('shop_products')
                    .select('show_purchase_notes, purchase_notes, show_usage_instructions, usage_instructions')
                    .eq('id', normalizedProductId)
                    .eq('is_active', true)
                    .single();
                data = legacyResult.data;
                error = legacyResult.error;
                if (error) {
                    throw error;
                }
            }

            return normalizeGuidancePayload({
                purchase_notes: data?.show_purchase_notes ? this.getLocalizedProductGuidanceText(data, 'purchase_notes') : '',
                usage_instructions: data?.show_usage_instructions ? this.getLocalizedProductGuidanceText(data, 'usage_instructions') : ''
            });
        } catch (error) {
            console.warn('Failed to load latest product guidance:', error);
            return {
                loaded: false,
                purchaseNotes: '',
                usageInstructions: ''
            };
        }
    },

    refreshCurrentPurchaseGuidance: async function (productId) {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) return;

        const requestToken = this.purchaseGuidanceRequestToken + 1;
        this.purchaseGuidanceRequestToken = requestToken;

        const guidance = await this.loadProductGuidance(normalizedProductId);
        if (!guidance.loaded) {
            return;
        }

        if (requestToken !== this.purchaseGuidanceRequestToken) {
            return;
        }

        if (!this.currentPurchase || String(this.currentPurchase.productId || '').trim() !== normalizedProductId) {
            return;
        }

        this.currentPurchase.purchaseNotes = guidance.purchaseNotes || '';
        this.currentPurchase.usageInstructions = guidance.usageInstructions || '';
        this.renderPurchaseNotes();
        this.setPurchaseStage(this.currentPurchase.stage || 'configure');
    },

    applyDiscountPreviewState: function (preview = {}, { selectionSnapshot = null, assetId = null, fallbackCode = '' } = {}) {
        const previewSelections = this.normalizePurchaseDiscountSelectionSnapshots(
            preview?.applied_discounts && Array.isArray(preview.applied_discounts) && preview.applied_discounts.length
                ? preview.applied_discounts
                : (selectionSnapshot && Array.isArray(selectionSnapshot) && selectionSnapshot.length
                    ? selectionSnapshot
                    : [{
                        code: preview.discount_code || fallbackCode || '',
                        assetId: assetId || preview.discount_asset_id || null,
                        discountType: preview.discount_type,
                        discountValue: preview.discount_value,
                        benefitLabel: preview.benefit_label || this.getDiscountBenefitLabel(preview)
                    }])
        );
        this.syncCurrentPurchaseDiscountSelectionState(previewSelections);
        this.currentPurchase.stackingPolicy = preview?.stacking_policy && typeof preview.stacking_policy === 'object'
            ? {
                ...this.getDefaultStackingPolicy(),
                ...preview.stacking_policy
            }
            : this.getDefaultStackingPolicy();
        const codeInput = document.getElementById('purchaseDiscountCode');
        if (codeInput) {
            const codeOnlySelection = previewSelections.find((selection) => !selection.assetId) || null;
            codeInput.value = codeOnlySelection?.code || '';
        }
        const previewFinalTotal = Number(preview?.final_total);
        const previewDiscountAmount = Number(preview?.discount_amount);
        let discountAmount;
        let finalTotal;

        if (Number.isFinite(previewFinalTotal) && previewFinalTotal >= 0) {
            finalTotal = Math.max(0, previewFinalTotal);
            discountAmount = Number.isFinite(previewDiscountAmount)
                ? Math.max(0, previewDiscountAmount)
                : Math.max(0, Number((this.getCurrentPurchaseSubtotal() - finalTotal).toFixed(2)));
            this.currentPurchase.discountAmount = discountAmount;
            this.currentPurchase.discountFinalTotal = finalTotal;
            document.getElementById('modalTotalPrice').textContent = this.formatShopPointValue(finalTotal);
        } else {
            ({ discountAmount, finalTotal } = this.syncDiscountedTotal());
        }

        this.syncPricingWaterfall({
            rows: Array.isArray(preview?.pricing_waterfall) ? preview.pricing_waterfall : null,
            stackingPolicy: preview?.stacking_policy || null
        });
        this.renderPurchaseConfirmationStage();
        this.setDiscountAppliedMessage({
            discountAmount,
            finalTotal,
            benefitLabel: this.currentPurchase.discountBenefitLabel,
            selectionCount: previewSelections.length
        });
        this.renderPurchaseDiscountAssets();
    },

    refreshAppliedDiscountPreview: async function ({ silent = true } = {}) {
        const selectedDiscounts = this.getCurrentPurchaseSelectedDiscounts();
        if (!selectedDiscounts.length) {
            return;
        }

        const revision = Math.max(0, Number(this.currentPurchase.discountPreviewRevision || 0)) + 1;
        this.currentPurchase.discountPreviewRevision = revision;

        try {
            const validationPayload = await this.validateDiscountSelectionsWithServer(selectedDiscounts);

            if (this.currentPurchase.discountPreviewRevision !== revision) {
                return;
            }

            this.applyDiscountPreviewState(validationPayload?.data || {}, {
                selectionSnapshot: selectedDiscounts
            });
        } catch (error) {
            if (this.currentPurchase.discountPreviewRevision !== revision) {
                return;
            }

            const fallbackMessage = selectedDiscounts.some((selection) => selection.assetId)
                ? this.trShop('selectedCouponUnavailable', '已选卡券在当前数量下不可用，已取消使用')
                : this.trShop('discountCodeUnavailable', '优惠码在当前数量下不可用，已取消使用');
            const displayMessage = this.isEnglishShopLocale() && this.containsCjkText(error?.message)
                ? fallbackMessage
                : (error.message || fallbackMessage);
            this.resetDiscountState({ clearMessage: false });
            this.setDiscountMessage(
                `<i class="fas fa-exclamation-triangle" aria-hidden="true"></i><span>${this.escapeHtml(displayMessage)}</span>`,
                { variant: silent ? 'warning' : 'error', html: true }
            );
        }
    },

    refreshPurchaseDiscountAssets: async function ({ silent = false } = {}) {
        if (!this.currentPurchase) {
            return;
        }

        const hasPrefilledItems = (Array.isArray(this.currentPurchase.availableDiscountAssets) && this.currentPurchase.availableDiscountAssets.length > 0)
            || (Array.isArray(this.currentPurchase.claimableDiscounts) && this.currentPurchase.claimableDiscounts.length > 0);
        if (!hasPrefilledItems) {
            this.currentPurchase.discountAssetsLoading = true;
            this.renderPurchaseDiscountAssets();
        }

        try {
            const payload = await this.loadAvailableDiscountAssetsWithServer();
            this.currentPurchase.availableDiscountAssets = Array.isArray(payload?.owned_discounts) ? payload.owned_discounts : [];
            this.currentPurchase.claimableDiscounts = Array.isArray(payload?.claimable_discounts) ? payload.claimable_discounts : [];
            this.currentPurchase.discountAssetsLoading = false;
            this.renderPurchaseDiscountAssets();
            this.maybeShowShopDiscountEngagement();
        } catch (error) {
            this.currentPurchase.availableDiscountAssets = [];
            this.currentPurchase.claimableDiscounts = [];
            this.currentPurchase.discountAssetsLoading = false;
            this.renderPurchaseDiscountAssets();
            if (!silent) {
                this.setDiscountMessage(
                    (this.isEnglishShopLocale() && this.containsCjkText(error?.message))
                        ? this.trShop('couponListLoadFailed', '优惠券列表加载失败')
                        : (error.message || this.trShop('couponListLoadFailed', '优惠券列表加载失败')),
                    { variant: 'error' }
                );
            }
        }
    },

    isExclusiveDiscountStackingConflict: function (error = null) {
        const normalizedMessage = String(error?.message || error || '').trim();
        return /为排他券/u.test(normalizedMessage) && /不能与其他卡券叠加/u.test(normalizedMessage);
    },

    buildExclusiveReplacementMessage: function ({ conflictMessage = '', replacementCode = '' } = {}) {
        const normalizedConflictMessage = String(conflictMessage || '').trim().replace(/[。.!！]+$/u, '');
        const normalizedReplacementCode = String(replacementCode || '').trim().toUpperCase() || this.trShop('currentCoupon', '当前券');
        const conflictText = this.isEnglishShopLocale() && this.containsCjkText(normalizedConflictMessage)
            ? ''
            : normalizedConflictMessage;
        return this.trShop('exclusiveReplacementMessage', '{message}。已改为仅应用你刚选择的优惠券 {code}。', {
            message: conflictText || this.trShop('exclusiveConflict', '所选卡券为排他券，不能与其他卡券叠加'),
            code: normalizedReplacementCode
        });
    },

    applyExclusiveReplacementSelection: async function (selection = {}, { conflictMessage = '' } = {}) {
        const replacementSelection = {
            assetId: String(
                selection?.assetId
                || selection?.asset_id
                || selection?.discountAssetId
                || selection?.discount_asset_id
                || ''
            ).trim() || null,
            code: String(
                selection?.code
                || selection?.discountCode
                || selection?.discount_code
                || ''
            ).trim().toUpperCase() || null
        };

        if (!replacementSelection.assetId && !replacementSelection.code) {
            throw new Error(this.trShop('missingCouponToApply', '缺少要应用的卡券'));
        }

        const validationPayload = await this.validateDiscountSelectionsWithServer([replacementSelection], {
            discountCode: replacementSelection.code || null,
            discountAssetId: replacementSelection.assetId || null
        });

        this.applyDiscountPreviewState(validationPayload?.data || {}, {
            selectionSnapshot: [replacementSelection],
            assetId: replacementSelection.assetId || null,
            fallbackCode: replacementSelection.code || ''
        });
        this.setDiscountMessage(
                `<i class="fas fa-exclamation-circle" aria-hidden="true"></i><span>${this.escapeHtml(this.buildExclusiveReplacementMessage({
                conflictMessage,
                replacementCode: replacementSelection.code || replacementSelection.assetId || this.trShop('currentCoupon', '当前券')
            }))}</span>`,
            { variant: 'warning', html: true }
        );
    },

    applyOwnedDiscountAsset: async function (assetId, discountCode) {
        const applyBtn = document.getElementById('applyDiscountBtn');
        if (applyBtn) {
            applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            applyBtn.disabled = true;
        }

        const currentSelections = this.getCurrentPurchaseSelectedDiscounts();
        const isSelected = currentSelections.some((selection) => String(selection.assetId || '').trim() === String(assetId || '').trim());
        const nextSelections = isSelected
            ? currentSelections.filter((selection) => String(selection.assetId || '').trim() !== String(assetId || '').trim())
            : [...currentSelections, {
                assetId: String(assetId || '').trim() || null,
                code: String(discountCode || '').trim().toUpperCase() || null
            }];

        try {
            if (!nextSelections.length) {
                this.resetDiscountState({ clearMessage: false });
                this.setDiscountMessage('');
                return;
            }

            const validationPayload = await this.validateDiscountSelectionsWithServer(nextSelections);
            this.applyDiscountPreviewState(validationPayload?.data || {}, {
                selectionSnapshot: nextSelections
            });
        } catch (error) {
            if (!isSelected && currentSelections.length && this.isExclusiveDiscountStackingConflict(error)) {
                try {
                    await this.applyExclusiveReplacementSelection({
                        assetId: String(assetId || '').trim() || null,
                        code: String(discountCode || '').trim().toUpperCase() || null
                    }, {
                        conflictMessage: error?.message || ''
                    });
                    return;
                } catch (replacementError) {
                    error = replacementError;
                }
            }
            const displayMessage = this.isEnglishShopLocale() && this.containsCjkText(error?.message)
                ? this.trShop('currentCouponUnavailable', '当前卡券不可用')
                : (error.message || this.trShop('currentCouponUnavailable', '当前卡券不可用'));
            this.setDiscountMessage(
                `<i class="fas fa-times-circle" aria-hidden="true"></i><span>${this.escapeHtml(displayMessage)}</span>`,
                { variant: 'error', html: true }
            );
        } finally {
            if (applyBtn) {
                applyBtn.innerHTML = window.i18n?.t('shop.verify') || '验证';
                applyBtn.disabled = false;
            }
        }
    },

    claimAndRefreshDiscountAsset: async function (discountId) {
        const normalizedDiscountId = String(discountId || '').trim();
        if (!normalizedDiscountId) {
            return;
        }

        if (!(this.pendingClaimDiscountIds instanceof Set)) {
            this.pendingClaimDiscountIds = new Set();
        }
        if (this.pendingClaimDiscountIds.has(normalizedDiscountId)) {
            this.setDiscountMessage(
                `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${this.escapeHtml(this.trShop('claimingCoupon', '正在为你领取这张券，请稍候'))}</span>`,
                { variant: 'info', html: true }
            );
            return;
        }

        this.pendingClaimDiscountIds.add(normalizedDiscountId);
        this.renderPurchaseDiscountAssets();
        try {
            const payload = await this.claimDiscountWithServer(normalizedDiscountId);
            await this.refreshPurchaseDiscountAssets({ silent: true });
            const claimMessage = String(payload?.message || '').trim()
                || (payload?.already_claimed
                    ? this.trShop('alreadyClaimedCoupon', '你已领取过该券，可直接使用')
                    : this.trShop('couponClaimed', '领取成功，已加入你的卡券包'));
            const displayMessage = this.isEnglishShopLocale() && this.containsCjkText(claimMessage)
                ? (payload?.already_claimed
                    ? this.trShop('alreadyClaimedCoupon', '你已领取过该券，可直接使用')
                    : this.trShop('couponClaimed', '领取成功，已加入你的卡券包'))
                : claimMessage;
            this.setDiscountMessage(
                `<i class="fas fa-check-circle" aria-hidden="true"></i><span>${this.escapeHtml(displayMessage)}</span>`,
                { variant: 'success', html: true }
            );
        } catch (error) {
            const displayMessage = this.isEnglishShopLocale() && this.containsCjkText(error?.message)
                ? this.trShop('claimFailed', '领取失败')
                : (error.message || this.trShop('claimFailed', '领取失败'));
            this.setDiscountMessage(
                `<i class="fas fa-times-circle" aria-hidden="true"></i><span>${this.escapeHtml(displayMessage)}</span>`,
                { variant: 'error', html: true }
            );
        } finally {
            this.pendingClaimDiscountIds.delete(normalizedDiscountId);
            this.renderPurchaseDiscountAssets();
        }
    },

    validateDiscountSelectionsWithServer: async function (discountSelections = [], options = {}) {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error(window.i18n?.t('shop.loginRequired') || '请先登录');
        }

        const normalizedSelections = this.serializeDiscountSelectionsForRequest(discountSelections, {
            allowIdentityOnly: true
        });
        const primarySelection = normalizedSelections[0] || null;

        let response;
        try {
            response = await fetch('/api/shop/validate-discount', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    productId: this.currentPurchase.productId,
                    quantity: this.currentPurchase.quantity,
                    discountCode: primarySelection?.code || options.discountCode || null,
                    discountAssetId: primarySelection?.assetId || options.discountAssetId || null,
                    discountSelections: normalizedSelections,
                    agentId: this.currentAgentId,
                    site: window.SiteConfig?.site || 'cn'
                })
            });
        } catch (error) {
            throw this.normalizeShopRequestError(error, {
                fallbackMessage: '优惠验证连接失败，请刷新页面后重试'
            });
        }

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || (window.i18n?.t('shop.verifyFailed') || '验证失败'));
        }

        return payload;
    },

    validateDiscountWithServer: async function (discountCode, options = {}) {
        return this.validateDiscountSelectionsWithServer([{
            code: discountCode,
            assetId: options.discountAssetId || this.currentPurchase.discountAssetId || null
        }], {
            discountCode,
            discountAssetId: options.discountAssetId || this.currentPurchase.discountAssetId || null
        });
    },

    purchaseWithServer: async function (token = '') {
        const accessToken = String(token || '').trim() || await this.getAccessToken();
        if (!accessToken) {
            throw new Error(window.i18n?.t('shop.loginRequired') || '请先登录');
        }

        if (!this.currentPurchase.idempotencyKey) {
            this.currentPurchase.idempotencyKey = this.createPurchaseIdempotencyKey();
        }

        return this.requestPurchasePayloadWithServer({
            productId: this.currentPurchase.productId,
            quantity: this.currentPurchase.quantity,
            discountCode: this.currentPurchase.discountCode,
            discountAssetId: this.currentPurchase.discountAssetId,
            discountSelections: this.serializeDiscountSelectionsForRequest(),
            agentId: this.currentAgentId,
            site: window.SiteConfig?.site || 'cn',
            idempotencyKey: this.currentPurchase.idempotencyKey
        }, accessToken);
    },

    requestPurchasePayloadWithServer: async function (purchasePayload = {}, token = '') {
        const accessToken = String(token || '').trim() || await this.getAccessToken();
        if (!accessToken) {
            throw new Error(window.i18n?.t('shop.loginRequired') || '请先登录');
        }

        const idempotencyKey = String(
            purchasePayload?.idempotencyKey
            || purchasePayload?.idempotency_key
            || this.createPurchaseIdempotencyKey()
        ).trim();

        let response;
        try {
            response = await fetch('/api/shop/purchase', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'X-Idempotency-Key': idempotencyKey
                },
                body: JSON.stringify({
                    productId: purchasePayload.productId,
                    quantity: purchasePayload.quantity,
                    discountCode: purchasePayload.discountCode || null,
                    discountAssetId: purchasePayload.discountAssetId || null,
                    discountSelections: Array.isArray(purchasePayload.discountSelections) ? purchasePayload.discountSelections : [],
                    agentId: purchasePayload.agentId || null,
                    site: purchasePayload.site || (window.SiteConfig?.site || 'cn'),
                    idempotencyKey
                })
            });
        } catch (error) {
            throw this.normalizeShopRequestError(error, {
                fallbackMessage: '兑换请求发送失败，请稍后重试'
            });
        }

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            const error = new Error(payload?.message || (window.i18n?.t('shop.redeemFailed') || '兑换失败'));
            error.code = payload?.code || '';
            error.retryAfterSeconds = payload?.retry_after_seconds || null;
            throw error;
        }

        return payload;
    },

    init: async function () {
        console.log('🛍️ Shop Client Initialized');
        this.bindStaticUiHandlers();
        this.bindMobileProductFocusResize();
        this.bindMobileBrowserChromeInset();
        this.scheduleDeferredUiBindings();
        this.restoreCartState();
        this.renderCart();
        this.syncCartHashFocusFromLocation();
        this.bindShopThemeStarryLoader();
        this.scheduleShopStarrySkyRuntime();

        // Read URL parameters
        const urlParams = new URLSearchParams(window.location.search);

        this.scheduleDeferredInitTasks({
            agentParam: urlParams.get('agent')
        });

        const categoryParam = urlParams.get('category');
        if (categoryParam) {
            this.currentCategory = categoryParam;
            console.log(`🛍️ URL category parameter found: ${categoryParam}`);
        }

        const productSpotlightId = String(urlParams.get('productId') || urlParams.get('product_id') || '').trim();
        if (productSpotlightId) {
            const rechargeReturn = urlParams.get('rechargeReturn') === '1';
            this.pendingProductSpotlight = {
                productId: productSpotlightId,
                autoOpen: true,
                expandedSearch: false,
                initialQuantity: Math.max(1, Math.trunc(Number(urlParams.get('quantity') || 1) || 1)),
                sourceContext: {
                    sourcePage: 'wallet',
                    sourceChannel: rechargeReturn ? 'recharge_return' : 'wallet_discount_asset',
                    sourcePromptId: null
                }
            };
        }

        // Check if we are on the shop page (by checking for the grid container)
        const container = document.getElementById('userShopGrid');
        const filtersContainer = document.getElementById('shopCategoryFilters');

        if (container) {
            // Slow-load guard: keep the skeleton in place until products, empty state, or an error can render.
            const fallbackTimer = setTimeout(() => {
                const hasRenderedProducts = container.querySelectorAll('.shop-card[data-product-id]').length > 0;
                if (hasRenderedProducts) return;

                console.warn('🛍️ Shop loading is taking longer than expected');
                const hasPendingSkeleton = this.getExistingProductSkeletonCount(container) > 0;
                const hasTerminalState = !!container.querySelector('.shop-empty-state, .shop-status-message--error');
                if (!hasPendingSkeleton && !hasTerminalState) {
                    this.renderProductSkeletons();
                }
            }, 5000);

            try {
                // Wait for Supabase to be ready
                if (!window.supabaseClient) {
                    console.warn('🛍️ Waiting for Supabase...');
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                // === Check sessionStorage for prefetched shop data ===
                let usedPrefetch = false;
                try {
                    const prefetchRaw = sessionStorage.getItem('shop_prefetch');
                    if (prefetchRaw) {
                        const prefetch = JSON.parse(prefetchRaw);
                        const age = Date.now() - prefetch.timestamp;
                        const currentSite = window.SiteConfig?.site || 'cn';
                        const prefetchVersionMatches = prefetch?.version === SHOP_PREFETCH_SCHEMA_VERSION;
                        // Only use prefetch if it actually contains products, otherwise ignore (Safari empty state bug)
                        if (
                            age < 300000
                            && prefetchVersionMatches
                            && prefetch.categories
                            && prefetch.products
                            && prefetch.products.length > 0
                            && (!prefetch.site || prefetch.site === currentSite)
                        ) {
                            sessionStorage.removeItem('shop_prefetch');
                            // Inject prefetched data into Cache for loadCategoryFilters / loadProducts to use
                            this._prefetchedCategories = prefetch.categories;
                            this.availableCategories = Array.isArray(prefetch.categories) ? prefetch.categories : [];
                            this.hydrateProductCaches(this.filterProductsForCurrentSite(prefetch.products));
                            usedPrefetch = true;
                            console.log(`⚡ Using prefetched shop data (${Math.round(age / 1000)}s old)`);
                        } else if (!prefetchVersionMatches) {
                            sessionStorage.removeItem('shop_prefetch');
                        }
                    }
                } catch (e) { /* ignore */ }

                // Keep the storefront order stable: resolve category pills first,
                // then let the first product batch replace the server skeletons.
                await this.loadCategoryFilters();
                await this.loadProducts();
                this.bindShopRealtimeAuthSync();
                void this.setupStorefrontRealtime({ reason: 'shop_init' });

                // Clear prefetch references
                this._prefetchedCategories = null;
                if (usedPrefetch) {
                    void this.revalidatePrefetchedShopData();
                }

                await this.fulfillPendingProductSpotlight();

                clearTimeout(fallbackTimer);

            } catch (err) {
                console.error('🛍️ Shop loading error:', err);
                clearTimeout(fallbackTimer);
                container.innerHTML = this.buildShopStatusMessage(
                    this.getShopCatalogUnavailableMessage(),
                    { variant: 'error', fullSpan: true, iconClass: 'fas fa-circle-exclamation' }
                );
            }
        }

        // Listen for Modal Open (Backwards compatibility or for index.html link if we still used modal)
        // For now, we update the index.html link to point to shop.html, so this listener might be redundant
        // but harmless to keep if we ever revert.
        const shopCard = document.querySelector('[data-modal-target="shopModal"]');
        if (shopCard) {
            shopCard.addEventListener('click', () => {
                // Redirect instead of opening modal
                window.location.href = 'shop.html';
            });
        }

        // Listen for language change to reload products in real-time
        window.addEventListener('languageChanged', () => {
            console.log('🌐 Language changed, reloading shop content...');
            void (async () => {
                await this.loadCategoryFilters();
                await this.loadProducts();
                void this.setupStorefrontRealtime({ force: true, reason: 'language_change' });
            })();
            this.renderCart();
            this.renderCartCheckoutModal();
        });
    },

    scheduleDeferredInitTasks: function ({ agentParam = '' } = {}) {
        const run = () => {
            void this.hydrateAgentStorefront(agentParam);
        };

        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(run, { timeout: SHOP_DEFERRED_TASK_TIMEOUT_MS });
        } else {
            window.setTimeout(run, 220);
        }
    },

    shouldLoadShopStarrySkyRuntime: function ({ force = false } = {}) {
        if (force === true) return true;
        return document.documentElement?.getAttribute('data-theme') === 'dark';
    },

    loadShopStarrySkyRuntime: function (options = {}) {
        if (!document.getElementById('starryCanvas') || !this.shouldLoadShopStarrySkyRuntime(options)) {
            return Promise.resolve();
        }

        if (this.shopStarrySkyRuntimePromise) {
            return this.shopStarrySkyRuntimePromise;
        }

        const existingScript = document.querySelector('script[data-shop-starry-sky="1"], script[src*="starry-sky.js"]');
        if (existingScript) {
            return Promise.resolve(existingScript);
        }

        this.shopStarrySkyRuntimePromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = SHOP_STARRY_SKY_RUNTIME_SRC;
            script.async = true;
            script.defer = true;
            script.dataset.shopStarrySky = '1';
            script.addEventListener('load', () => resolve(script), { once: true });
            script.addEventListener('error', () => {
                this.shopStarrySkyRuntimePromise = null;
                reject(new Error('Failed to load shop starry sky runtime'));
            }, { once: true });
            document.head.appendChild(script);
        });

        return this.shopStarrySkyRuntimePromise;
    },

    scheduleShopStarrySkyRuntime: function () {
        const run = () => {
            void this.loadShopStarrySkyRuntime().catch((error) => {
                console.warn('[Shop] Starry sky runtime failed to load:', error?.message || error);
            });
        };

        window.setTimeout(() => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(run, { timeout: SHOP_DEFERRED_TASK_TIMEOUT_MS });
            } else {
                run();
            }
        }, SHOP_STARRY_SKY_IDLE_DELAY_MS);
    },

    bindShopThemeStarryLoader: function () {
        if (this.shopThemeObserver || typeof MutationObserver !== 'function') {
            return;
        }

        this.shopThemeObserver = new MutationObserver(() => {
            if (this.shouldLoadShopStarrySkyRuntime()) {
                void this.loadShopStarrySkyRuntime({ force: true }).catch((error) => {
                    console.warn('[Shop] Starry sky runtime failed to load after theme switch:', error?.message || error);
                });
            }
        });
        this.shopThemeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    },

    schedulePostRenderEnhancements: function ({ products = [], requestToken = 0 } = {}) {
        const normalizedProducts = Array.isArray(products) ? products.filter(Boolean) : [];
        if (!normalizedProducts.length) {
            return;
        }

        if (this.postRenderEnhancementHandle?.id != null) {
            if (this.postRenderEnhancementHandle.kind === 'idle' && typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(this.postRenderEnhancementHandle.id);
            } else {
                window.clearTimeout(this.postRenderEnhancementHandle.id);
            }
            this.postRenderEnhancementHandle = null;
        }

        const run = () => {
            this.postRenderEnhancementHandle = null;

            if (requestToken && requestToken !== this.productsRequestToken) {
                return;
            }

            this.warmShopCardLeadImages(normalizedProducts);
            this.scheduleVisibleDiscountAssetsPrefetch(normalizedProducts);
        };

        if (typeof window.requestIdleCallback === 'function') {
            this.postRenderEnhancementHandle = {
                kind: 'idle',
                id: window.requestIdleCallback(run, {
                    timeout: SHOP_POST_RENDER_TASK_TIMEOUT_MS
                })
            };
        } else {
            this.postRenderEnhancementHandle = {
                kind: 'timeout',
                id: window.setTimeout(run, 160)
            };
        }
    },

    scheduleDeferredUiBindings: function () {
        if (this.deferredUiBindingsBound || this.deferredUiBindingsHandle?.id != null) {
            return;
        }

        const run = () => {
            this.deferredUiBindingsHandle = null;
            this.bindDeferredUiHandlers();
        };

        if (typeof window.requestIdleCallback === 'function') {
            this.deferredUiBindingsHandle = {
                kind: 'idle',
                id: window.requestIdleCallback(run, { timeout: SHOP_POST_RENDER_TASK_TIMEOUT_MS })
            };
        } else {
            this.deferredUiBindingsHandle = {
                kind: 'timeout',
                id: window.setTimeout(run, 180)
            };
        }
    },

    hydrateAgentStorefront: async function (agentParam = '') {
        const normalizedAgent = String(agentParam || '').trim();
        if (!normalizedAgent || !window.supabaseClient) {
            return null;
        }

        try {
            const { data } = await window.supabaseClient
                .from('profiles')
                .select('id, username')
                .eq('username', normalizedAgent)
                .single();

            if (!data?.id) {
                return null;
            }

            this.currentAgentId = data.id;
            this.currentAgentName = data.username;
            this.agentPricesCache = null;
            this.agentPricesCacheSite = '';
            this.agentPricesPromise = null;
            this.agentPricesPromiseSite = '';
            console.log(`🛍️ Welcome to Agent Store: ${this.currentAgentName}`);

            document.title = `${this.currentAgentName} ${window.i18n?.t('shop.agentStore') || '的专属福利商店'}`;
            const heroTitle = document.querySelector('.hero-title');
            if (heroTitle) {
                heroTitle.innerHTML = `<span class="shop-inline-store-title-icon"><i class="fas fa-store" aria-hidden="true"></i></span>${this.escapeHtml(this.currentAgentName)} ${window.i18n?.t('shop.agentStore') || '的专属福利商店'}`;
            }

            void this.ensureAgentPricesReadyInBackground();
            return data;
        } catch (error) {
            console.warn('Agent lookup failed:', error);
            return null;
        }
    },

    bindShopMobileTapFallback: function (element, bindingKey, handler) {
        if (!(element instanceof HTMLElement) || typeof handler !== 'function') {
            return;
        }

        const safeKey = String(bindingKey || 'action').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const boundAttribute = `data-shop-mobile-tap-${safeKey || 'action'}`;
        if (element.getAttribute(boundAttribute) === '1') {
            return;
        }

        const isDisabled = () => element.disabled === true || element.getAttribute('aria-disabled') === 'true';
        const invoke = (event) => {
            if (isDisabled()) return;
            event?.preventDefault?.();
            event?.stopPropagation?.();
            handler(event, element);
        };

        element.setAttribute(boundAttribute, '1');
        let touchStart = null;
        element.addEventListener('click', invoke);
        element.addEventListener('touchstart', (event) => {
            const touch = event.changedTouches?.[0] || event.touches?.[0] || null;
            if (!touch) return;
            touchStart = {
                x: touch.clientX,
                y: touch.clientY,
                time: Date.now()
            };
        }, { passive: true });
        element.addEventListener('touchend', (event) => {
            const touch = event.changedTouches?.[0] || null;
            const start = touchStart;
            touchStart = null;
            if (!touch || !start || isDisabled()) return;

            const movedX = Math.abs(touch.clientX - start.x);
            const movedY = Math.abs(touch.clientY - start.y);
            const elapsed = Date.now() - start.time;
            if (movedX > 16 || movedY > 16 || elapsed > 1200) {
                return;
            }

            invoke(event);
        }, { passive: false });
        element.addEventListener('touchcancel', () => {
            touchStart = null;
        }, { passive: true });
    },

    resolvePurchaseActionButton: function (preferredButton = null) {
        if (preferredButton instanceof HTMLElement) {
            return preferredButton;
        }

        const candidates = [
            document.getElementById('nextPurchaseStepBtn'),
            document.getElementById('confirmPurchaseBtn')
        ].filter((button) => button instanceof HTMLElement);

        return candidates.find((button) => {
            if (button.hidden || button.disabled) return false;
            const style = window.getComputedStyle?.(button);
            return style?.display !== 'none' && style?.visibility !== 'hidden';
        }) || candidates[0] || null;
    },

    handlePurchasePrimaryActionTap: function (eventOrButton = null) {
        const triggerButton = eventOrButton instanceof HTMLElement
            ? eventOrButton
            : (eventOrButton?.target instanceof Element
                ? eventOrButton.target.closest('#nextPurchaseStepBtn, #confirmPurchaseBtn')
                : null);
        const actionButton = this.resolvePurchaseActionButton(triggerButton);
        if (!actionButton || actionButton.disabled) {
            return;
        }

        eventOrButton?.preventDefault?.();
        eventOrButton?.stopPropagation?.();
        void this.confirmPurchase({ triggerButton: actionButton });
    },

    bindPurchaseActionButtonTapFallbacks: function () {
        [
            document.getElementById('nextPurchaseStepBtn'),
            document.getElementById('confirmPurchaseBtn')
        ].forEach((button) => {
            this.bindShopMobileTapFallback(button, 'purchase-primary-action', (event) => {
                this.handlePurchasePrimaryActionTap(event);
            });
        });
    },

    bindPurchaseDiscountActionTapFallbacks: function () {
        const modal = document.getElementById('shopPurchaseModal');
        if (!modal) return;

        modal.querySelectorAll('.shop-discount-asset-card__summary').forEach((summary) => {
            this.bindShopMobileTapFallback(summary, 'purchase-discount-summary', (_event, target) => {
                this.toggleDiscountAssetAccordion(
                    target.closest('.shop-discount-asset-card--collapsible')
                );
            });
        });

        modal.querySelectorAll('[data-shop-discount-action="apply"]').forEach((button) => {
            this.bindShopMobileTapFallback(button, 'purchase-discount-apply', (_event, target) => {
                void this.applyOwnedDiscountAsset(
                    target.dataset.discountAssetId || '',
                    target.dataset.discountCode || ''
                );
            });
        });

        modal.querySelectorAll('[data-shop-discount-action="claim"]').forEach((button) => {
            this.bindShopMobileTapFallback(button, 'purchase-discount-claim', (_event, target) => {
                void this.claimAndRefreshDiscountAsset(target.dataset.discountId || '');
            });
        });

        modal.querySelectorAll('[data-shop-discount-action="jump-product"]').forEach((button) => {
            this.bindShopMobileTapFallback(button, 'purchase-discount-jump', (_event, target) => {
                void this.jumpToDiscountTargetProduct(target.dataset.targetProductId || '');
            });
        });
    },

    bindPurchaseModalControlTapFallbacks: function () {
        const modal = document.getElementById('shopPurchaseModal');
        if (!modal) return;

        this.bindPurchaseActionButtonTapFallbacks();
        modal.querySelectorAll('[data-shop-qty-delta]').forEach((button) => {
            this.bindShopMobileTapFallback(button, 'purchase-quantity', (_event, target) => {
                this.adjustQuantity(Number(target.dataset.shopQtyDelta || 0));
            });
        });
        this.bindShopMobileTapFallback(document.getElementById('applyDiscountBtn'), 'purchase-discount-code', () => {
            void this.applyDiscount();
        });
        this.bindShopMobileTapFallback(document.getElementById('purchaseNotesToggle'), 'purchase-notes-toggle', () => {
            this.togglePurchaseNotesVisibility();
        });
        this.bindShopMobileTapFallback(document.getElementById('purchaseBackBtn'), 'purchase-back', () => {
            this.setPurchaseStage('configure');
        });
        this.bindShopMobileTapFallback(document.getElementById('purchaseAddToCartBtn'), 'purchase-add-cart', () => {
            this.addCurrentPurchaseToCart();
        });
        this.bindPurchaseDiscountActionTapFallbacks();
    },

    bindCartCheckoutModalTapFallbacks: function () {
        this.bindShopMobileTapFallback(document.getElementById('shopCartCheckoutBackBtn'), 'cart-checkout-back', () => {
            this.closeCartCheckoutModal();
        });
        this.bindShopMobileTapFallback(document.getElementById('shopCartCheckoutConfirmBtn'), 'cart-checkout-confirm', () => {
            void this.confirmCartCheckout();
        });
    },

    bindStaticUiHandlers: function () {
        if (this.staticUiBindingsBound) return;

        const filtersContainer = document.getElementById('shopCategoryFilters');
        filtersContainer?.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('.filter-tab[data-shop-category]')
                : null;
            if (!target) return;

            event.preventDefault?.();
            this.filterCategory(target.dataset.shopCategory || 'all', target);
        });

        const shopGrid = document.getElementById('userShopGrid');
        shopGrid?.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-shop-action]')
                : null;
            if (!target || target.disabled) return;

            event.preventDefault?.();
            const action = target.dataset.shopAction || '';
            const sourceContext = resolveShopSourceContext();

            if (action === 'add-product-to-cart') {
                const payload = this.getShopPurchasePayloadFromDataset(target.dataset);
                if (this.isShopPurchasePayloadSoldOut(payload)) {
                    this.showSoldOutProductToast(payload);
                    return;
                }

                const addedQuantity = this.addProductToCart(target.dataset.productId || '', 1);
                if (addedQuantity > 0) {
                    this.trackProductAddToCartFromDataset(target.dataset, addedQuantity, sourceContext);
                }
                return;
            }

            if (action === 'sold-out-product') {
                this.openProductPurchaseFromDataset(target.dataset, sourceContext);
                return;
            }

            if (action !== 'buy-product') {
                return;
            }

            this.openProductPurchaseFromDataset(target.dataset, sourceContext);
        });

        shopGrid?.addEventListener('keydown', (event) => {
            if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return;

            const target = event.target instanceof HTMLElement && event.target.matches('.shop-card[data-shop-action]')
                ? event.target
                : null;
            if (!target) return;

            event.preventDefault();
            const action = target.dataset.shopAction || '';
            if (action === 'sold-out-product' || action === 'buy-product') {
                this.openProductPurchaseFromDataset(target.dataset, resolveShopSourceContext());
            }
        });

        document.getElementById('shopCartAnchor')?.addEventListener('click', (event) => {
            event.preventDefault?.();
            this.guardCartBackdropClose(180);
            this.toggleCart();
        });

        document.getElementById('shopCartBackdrop')?.addEventListener('click', (event) => {
            event.preventDefault?.();
            if (this.shouldIgnoreCartBackdropClose()) {
                return;
            }
            this.closeCart();
        });
        this.bindShopModalBackdropTouchFallback(document.getElementById('shopCartBackdrop'), 'cart-drawer', () => {
            if (this.shouldIgnoreCartBackdropClose()) return;
            this.closeCart();
        });

        document.getElementById('shopCartDrawer')?.addEventListener('pointerdown', () => {
            this.guardCartBackdropClose(260);
        });

        document.getElementById('shopCartDrawer')?.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-shop-cart-action]')
                : null;
            if (!target) return;

            event.preventDefault?.();
            event.stopPropagation?.();
            const action = target.dataset.shopCartAction || '';
            const productId = target.dataset.productId || '';
            this.guardCartBackdropClose(action === 'checkout' ? 900 : 320);

            if (action === 'close' || action === 'continue') {
                this.closeCart();
                return;
            }

            if (action === 'checkout') {
                void this.confirmCartCheckout();
                return;
            }

            if (action === 'open-product') {
                const entry = this.getCartEntries().find((cartEntry) => String(cartEntry?.productId || '').trim() === String(productId || '').trim());
                if (entry) {
                    this.openPurchaseModalFromCartEntry(entry);
                }
                return;
            }

            if (action === 'increase') {
                this.updateCartQuantity(productId, this.getCartQuantity(productId) + 1);
                return;
            }

            if (action === 'toggle-notes') {
                this.toggleCartItemDisclosure(productId, 'notes');
                return;
            }

            if (action === 'toggle-usage') {
                this.toggleCartItemDisclosure(productId, 'usage');
                return;
            }

            if (action === 'toggle-discounts') {
                this.toggleCartItemDisclosure(productId, 'discounts');
                return;
            }

            if (action === 'decrease') {
                this.updateCartQuantity(productId, this.getCartQuantity(productId) - 1);
                return;
            }

            if (action === 'remove') {
                this.removeCartItemWithAnimation(productId);
            }
        });

        const cartCheckoutModal = document.getElementById('shopCartCheckoutModal');
        cartCheckoutModal?.addEventListener('click', (event) => {
            if (event.target === cartCheckoutModal) {
                this.closeCartCheckoutModal();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#shopCartCheckoutBackBtn')) {
                event.preventDefault?.();
                this.closeCartCheckoutModal();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#shopCartCheckoutConfirmBtn')) {
                event.preventDefault?.();
                void this.confirmCartCheckout();
            }
        });
        this.bindShopModalBackdropTouchFallback(cartCheckoutModal, 'cart-checkout-modal', () => {
            this.closeCartCheckoutModal();
        });
        this.bindCartCheckoutModalTapFallbacks();

        const purchaseModal = document.getElementById('shopPurchaseModal');
        purchaseModal?.addEventListener('click', (event) => {
            if (event.target === purchaseModal) {
                this.closePurchaseModal();
                return;
            }

            const tierRulesHelpTrigger = event.target instanceof Element
                ? event.target.closest('.shop-tier-rules-help')
                : null;
            if (tierRulesHelpTrigger) {
                event.preventDefault?.();
                event.stopPropagation?.();
                this.toggleTierRulesPopover(tierRulesHelpTrigger);
                return;
            }

            if (!(event.target instanceof Element && event.target.closest('.shop-tier-rules-popover-wrap'))) {
                this.closeTierRulesPopovers();
            }

            const quantityTrigger = event.target instanceof Element
                ? event.target.closest('[data-shop-qty-delta]')
                : null;
            if (quantityTrigger) {
                event.preventDefault?.();
                this.adjustQuantity(Number(quantityTrigger.dataset.shopQtyDelta || 0));
                return;
            }

            if (event.target instanceof Element && event.target.closest('#applyDiscountBtn')) {
                event.preventDefault?.();
                void this.applyDiscount();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#purchaseNotesToggle')) {
                event.preventDefault?.();
                this.togglePurchaseNotesVisibility();
                return;
            }

            const discountAccordionSummary = event.target instanceof Element
                ? event.target.closest('.shop-discount-asset-card__summary')
                : null;
            if (discountAccordionSummary) {
                event.preventDefault?.();
                this.toggleDiscountAssetAccordion(
                    discountAccordionSummary.closest('.shop-discount-asset-card--collapsible')
                );
                return;
            }

            const discountAssetTrigger = event.target instanceof Element
                ? event.target.closest('[data-shop-discount-action="apply"]')
                : null;
            if (discountAssetTrigger) {
                event.preventDefault?.();
                void this.applyOwnedDiscountAsset(
                    discountAssetTrigger.dataset.discountAssetId || '',
                    discountAssetTrigger.dataset.discountCode || ''
                );
                return;
            }

            const claimDiscountTrigger = event.target instanceof Element
                ? event.target.closest('[data-shop-discount-action="claim"]')
                : null;
            if (claimDiscountTrigger) {
                event.preventDefault?.();
                void this.claimAndRefreshDiscountAsset(claimDiscountTrigger.dataset.discountId || '');
                return;
            }

            const jumpProductTrigger = event.target instanceof Element
                ? event.target.closest('[data-shop-discount-action="jump-product"]')
                : null;
            if (jumpProductTrigger) {
                event.preventDefault?.();
                void this.jumpToDiscountTargetProduct(jumpProductTrigger.dataset.targetProductId || '');
                return;
            }

            if (event.target instanceof Element && event.target.closest('#purchaseBackBtn')) {
                event.preventDefault?.();
                this.setPurchaseStage('configure');
                return;
            }

            if (event.target instanceof Element && event.target.closest('#purchaseAddToCartBtn')) {
                event.preventDefault?.();
                this.addCurrentPurchaseToCart();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#nextPurchaseStepBtn')) {
                this.handlePurchasePrimaryActionTap(event);
                return;
            }

            if (event.target instanceof Element && event.target.closest('#confirmPurchaseBtn')) {
                this.handlePurchasePrimaryActionTap(event);
            }
        });
        this.bindShopModalBackdropTouchFallback(purchaseModal, 'purchase-modal', () => {
            this.closePurchaseModal();
        });
        this.bindPurchaseModalControlTapFallbacks();

        document.getElementById('purchaseQuantity')?.addEventListener('input', (event) => {
            if (event.target instanceof HTMLInputElement) {
                this.onQuantityInput(event.target);
            }
        });

        document.getElementById('purchaseDiscountCode')?.addEventListener('input', (event) => {
            if (!(event.target instanceof HTMLInputElement)) return;
            event.target.value = event.target.value.toUpperCase();
            const currentSelections = this.getCurrentPurchaseSelectedDiscounts();
            const codeOnlySelections = currentSelections.filter((selection) => !selection.assetId);
            if (codeOnlySelections.length && !codeOnlySelections.some((selection) => selection.code === event.target.value.trim().toUpperCase())) {
                const retainedSelections = currentSelections.filter((selection) => selection.assetId);
                if (retainedSelections.length) {
                    this.syncCurrentPurchaseDiscountSelectionState(retainedSelections);
                    void this.refreshAppliedDiscountPreview({ silent: true });
                } else {
                    this.resetDiscountState();
                }
            }
        });

        this.staticUiBindingsBound = true;
    },

    bindDeferredUiHandlers: function () {
        if (this.deferredUiBindingsBound) {
            return;
        }

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;

            if (this.closeTierRulesPopovers()) {
                return;
            }

            const cartCheckoutModalEl = document.getElementById('shopCartCheckoutModal');
            if (cartCheckoutModalEl?.classList.contains('active')) {
                this.closeCartCheckoutModal();
                return;
            }

            if (this.cartOpen) {
                this.closeCart();
            }
        });

        const successModal = document.getElementById('shopSuccessModal');
        successModal?.addEventListener('click', (event) => {
            if (event.target === successModal) {
                this.closeSuccessModal();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#copyContentBtn')) {
                event.preventDefault?.();
                void this.copyContent();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#exportContentBtn')) {
                event.preventDefault?.();
                this.exportContent();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#expandContentBtn')) {
                event.preventDefault?.();
                this.toggleExpandContent();
                return;
            }

            const successItemCopyBtn = event.target instanceof Element
                ? event.target.closest('[data-shop-success-action="copy-item"]')
                : null;
            if (successItemCopyBtn) {
                event.preventDefault?.();
                void this.copySuccessCardContent(successItemCopyBtn.dataset.shopCopyContent || '');
                return;
            }

            const successPanelToggle = event.target instanceof Element
                ? event.target.closest('[data-shop-success-action="toggle-usage"], [data-shop-success-action="toggle-notes"]')
                : null;
            if (successPanelToggle) {
                event.preventDefault?.();
                this.toggleSuccessItemDisclosure(successPanelToggle);
                return;
            }

            const successItemToggle = event.target instanceof Element
                ? event.target.closest('[data-shop-success-action="toggle-item-content"]')
                : null;
            if (successItemToggle) {
                event.preventDefault?.();
                this.toggleSuccessItemContent(successItemToggle);
                return;
            }

            const copyCard = event.target instanceof Element
                ? event.target.closest('.content-card[data-shop-copy-content]')
                : null;
            if (copyCard) {
                event.preventDefault?.();
                void this.copySuccessCardContent(copyCard.dataset.shopCopyContent || '');
            }
        });
        this.bindShopModalBackdropTouchFallback(successModal, 'success-modal', () => {
            this.closeSuccessModal();
        });

        document.getElementById('ordersList')?.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-shop-order-id][data-shop-order-content]')
                : null;
            if (!target) return;

            event.preventDefault?.();
            this.viewOrderContent(target.dataset.shopOrderId || '', target.dataset.shopOrderContent || '');
        });

        this.deferredUiBindingsBound = true;
    },

    escapeAttribute: function (text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    buildShopStatusMessage: function (message, { variant = 'muted', fullSpan = false, iconClass = '' } = {}) {
        const classes = ['shop-status-message', `shop-status-message--${variant}`];
        if (fullSpan) classes.push('shop-status-message--full');
        const iconHtml = iconClass ? `<i class="${iconClass}" aria-hidden="true"></i>` : '';
        return `<div class="${classes.join(' ')}">${iconHtml}<span>${this.escapeHtml(message || '')}</span></div>`;
    },

    setElementHidden: function (element, hidden) {
        if (!element) return;
        element.hidden = !!hidden;
    },

    setCssVariables: function (element, variables = {}) {
        const style = element?.style;
        if (!style) return;
        const setProperty = style['setProperty'].bind(style);
        const removeProperty = style['removeProperty'].bind(style);
        for (const [property, value] of Object.entries(variables)) {
            if (value === undefined || value === null || value === '') {
                removeProperty(property);
            } else {
                setProperty(property, value);
            }
        }
    },

    getPurchaseModalNativeViewportFrame: function () {
        const vv = window.visualViewport;
        const visualTop = Math.max(0, vv?.offsetTop || 0);
        const visualLeft = Math.max(0, vv?.offsetLeft || 0);
        const visualWidth = Math.max(
            1,
            Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || document.body?.clientWidth || 0)
        );
        const visualHeight = Math.max(0, vv?.height || 0);
        const visualBottom = visualTop + visualHeight;
        const overlayHeight = Math.max(320, Math.round(
            visualHeight
            || visualBottom
            || window.innerHeight
            || document.documentElement.clientHeight
            || 0
        ));
        const stableHeight = Math.max(
            overlayHeight,
            Math.round(window.innerHeight || 0),
            Math.round(document.documentElement.clientHeight || 0),
            Math.round(visualBottom || 0)
        );

        return {
            top: Math.round(visualTop),
            left: Math.round(visualLeft),
            width: visualWidth,
            overlayHeight,
            visualHeight,
            visualBottom,
            stableHeight
        };
    },

    capturePurchaseModalOverlayHeight: function (force = false) {
        const { overlay } = this.getPurchaseModalElements();
        if (!overlay) return;
        const frame = this.getPurchaseModalNativeViewportFrame();
        const measuredHeight = Math.max(0, Math.round(frame.overlayHeight || 0));

        if (!measuredHeight) return;
        const baseHeight = Math.round(this.purchaseModalKeyboardBaseViewportHeight || 0);
        const shouldPreserveForKeyboard = this.purchaseModalKeyboardDocked || !!this.getActivePurchaseModalInput();
        const shouldPreserveKeyboardBase = overlay.classList.contains('active')
            && shouldPreserveForKeyboard
            && baseHeight > measuredHeight;
        const overlayHeight = shouldPreserveKeyboardBase ? baseHeight : measuredHeight;
        this.setCssVariables(overlay, {
            '--shop-purchase-viewport-top': `${frame.top}px`,
            '--shop-purchase-viewport-left': `${frame.left}px`,
            '--shop-purchase-viewport-width': `${frame.width}px`,
            '--shop-purchase-overlay-height': `${overlayHeight}px`
        });
        if (shouldPreserveKeyboardBase) return;
        if (!force && baseHeight === measuredHeight) return;
        this.purchaseModalKeyboardBaseViewportHeight = measuredHeight;
    },

    syncPurchaseModalOverlayViewport: function (force = false) {
        const { overlay } = this.getPurchaseModalElements();
        if (!overlay?.classList.contains('active')) return;
        if (this.purchaseModalPageFrozen) {
            this.stabilizePurchaseModalViewport();
        }
        this.capturePurchaseModalOverlayHeight(force);
    },

    schedulePurchaseModalViewportSync: function (force = false) {
        const { overlay } = this.getPurchaseModalElements();
        if (!overlay?.classList.contains('active')) return;

        if (this.purchaseModalViewportSyncRafId) {
            cancelAnimationFrame(this.purchaseModalViewportSyncRafId);
        }

        this.purchaseModalViewportSyncRafId = requestAnimationFrame(() => {
            this.purchaseModalViewportSyncRafId = null;
            this.syncPurchaseModalOverlayViewport(force);
        });
    },

    clearPurchaseModalOpenViewportStabilization: function () {
        if (!Array.isArray(this.purchaseModalOpenViewportSyncTimers)) {
            this.purchaseModalOpenViewportSyncTimers = [];
            return;
        }

        this.purchaseModalOpenViewportSyncTimers.forEach((timerId) => {
            window.clearTimeout(timerId);
        });
        this.purchaseModalOpenViewportSyncTimers = [];
    },

    schedulePurchaseModalOpenViewportStabilization: function () {
        const { overlay } = this.getPurchaseModalElements();
        if (!overlay?.classList.contains('active')) return;

        this.clearPurchaseModalOpenViewportStabilization();
        this.schedulePurchaseModalViewportSync(true);

        [48, 140, 320].forEach((delayMs) => {
            const timerId = window.setTimeout(() => {
                this.purchaseModalOpenViewportSyncTimers = this.purchaseModalOpenViewportSyncTimers
                    .filter((candidate) => candidate !== timerId);
                if (!overlay.classList.contains('active')) return;

                this.syncPurchaseModalOverlayViewport(true);
                this.syncPurchaseModalKeyboardDock();
            }, delayMs);
            this.purchaseModalOpenViewportSyncTimers.push(timerId);
        });
    },

    attachPurchaseModalViewportSync: function () {
        const { overlay } = this.getPurchaseModalElements();
        if (!overlay) return;

        this.detachPurchaseModalViewportSync();

        const handleViewportChange = () => {
            if (!overlay.classList.contains('active')) return;
            this.schedulePurchaseModalViewportSync();
        };

        window.addEventListener('resize', handleViewportChange, { passive: true });
        window.addEventListener('orientationchange', handleViewportChange, { passive: true });
        window.visualViewport?.addEventListener('resize', handleViewportChange, { passive: true });
        window.visualViewport?.addEventListener('scroll', handleViewportChange, { passive: true });

        this.purchaseModalViewportSyncCleanup = () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('orientationchange', handleViewportChange);
            window.visualViewport?.removeEventListener('resize', handleViewportChange);
            window.visualViewport?.removeEventListener('scroll', handleViewportChange);
            if (this.purchaseModalViewportSyncRafId) {
                cancelAnimationFrame(this.purchaseModalViewportSyncRafId);
                this.purchaseModalViewportSyncRafId = null;
            }
            this.purchaseModalViewportSyncCleanup = null;
        };
    },

    detachPurchaseModalViewportSync: function () {
        this.clearPurchaseModalOpenViewportStabilization();
        if (typeof this.purchaseModalViewportSyncCleanup === 'function') {
            this.purchaseModalViewportSyncCleanup();
        }
        if (this.purchaseModalViewportSyncRafId) {
            cancelAnimationFrame(this.purchaseModalViewportSyncRafId);
            this.purchaseModalViewportSyncRafId = null;
        }
    },

    isShopImageSource: function (value) {
        const trimmed = String(value || '').trim();
        if (isSupabaseStorageImageUrl(trimmed)) return false;
        return trimmed.startsWith('http://')
            || trimmed.startsWith('https://')
            || trimmed.startsWith('/')
            || trimmed.startsWith('data:image/');
    },

    getShopCardBreatheDelay: function () {
        if (!this.isShopCardBreathingEnabled()) {
            return '0s';
        }

        return `${(Math.random() * SHOP_CARD_BREATHE_PHASE_MAX_S).toFixed(2)}s`;
    },

    getShopCardNegativeBreatheDelay: function (breatheDelay = '0s') {
        const seconds = Number.parseFloat(String(breatheDelay || '').trim());
        if (!Number.isFinite(seconds) || seconds <= 0) {
            return '0s';
        }
        return `${(-seconds).toFixed(2)}s`;
    },

    isShopCardBreathingEnabled: function () {
        return !this.prefersReducedMotion();
    },

    clearShopCardBreatheTimer: function (card) {
        if (!(card instanceof Element)) return;
        const timerId = this.shopCardBreatheTimers.get(card);
        if (timerId) {
            window.clearTimeout(timerId);
            this.shopCardBreatheTimers.delete(card);
        }
    },

    cancelShopCardFreshEnterAnimation: function (card) {
        if (!(card instanceof Element)) return;
        delete card.dataset.shopFreshEnterDelayMs;
    },

    getShopCardCurrentTranslateY: function (card) {
        if (!(card instanceof Element)) {
            return 0;
        }

        const computedStyle = window.getComputedStyle(card);
        const translate = String(computedStyle.translate || '').trim();
        if (translate && translate !== 'none') {
            const parts = translate.split(/\s+/);
            const translateY = Number.parseFloat(parts[1] || parts[0] || '0');
            if (Number.isFinite(translateY)) {
                return translateY;
            }
        }

        const transform = computedStyle.transform;
        if (!transform || transform === 'none') {
            return 0;
        }

        try {
            const matrix = new window.DOMMatrixReadOnly(transform);
            return Number.isFinite(matrix.m42) ? matrix.m42 : 0;
        } catch (_error) {
            const match = transform.match(/^matrix(3d)?\((.+)\)$/);
            if (!match) {
                return 0;
            }
            const values = match[2].split(',').map(value => Number.parseFloat(value.trim()));
            if (match[1] === '3d') {
                return Number.isFinite(values[13]) ? values[13] : 0;
            }
            return Number.isFinite(values[5]) ? values[5] : 0;
        }
    },

    renderShopCoverIconMarkup: function (iconClass = '', safeIconClass = '') {
        const normalizedIconClass = String(iconClass || '').trim().toLowerCase();
        if (!normalizedIconClass) {
            return '<i class="fas fa-box shop-card-icon shop-card-icon--fallback" aria-hidden="true"></i>';
        }

        if (normalizedIconClass.includes('fa-bag-shopping') || normalizedIconClass.includes('fa-shopping-bag')) {
            return `
                <span class="shop-cover-icon-svg" aria-hidden="true">
                    <svg viewBox="0 0 64 64" focusable="false">
                        <path fill="currentColor" d="M20 24v-3c0-6.627 5.373-12 12-12s12 5.373 12 12v3h3a5 5 0 0 1 5 5v19c0 5.523-4.477 10-10 10H19c-5.523 0-10-4.477-10-10V29a5 5 0 0 1 5-5h6zm6 0h12v-3a6 6 0 1 0-12 0v3z"/>
                    </svg>
                </span>
            `;
        }

        return `<i class="${safeIconClass} shop-card-icon shop-card-icon--cover" aria-hidden="true"></i>`;
    },

    getOptimizedShopImageUrl: function (url, options = {}) {
        const explicitVariantUrl = getShopProductImageAssetExplicitVariantUrl(url, options.variant || '');
        if (explicitVariantUrl && options.variant) {
            return normalizeShopProductCdnUrl(explicitVariantUrl) || explicitVariantUrl;
        }

        const rawUrl = getShopProductImageAssetUrl(url, 'original');
        const trimmed = normalizeShopProductCdnUrl(rawUrl) || rawUrl;
        if (!trimmed) return '';

        const { variant = '' } = options;
        const variantUrl = getShopResponsiveImageVariantUrl(trimmed, variant);
        if (variantUrl) {
            return variantUrl;
        }

        if (trimmed.startsWith('data:image/') || trimmed.startsWith('/')) {
            return trimmed;
        }

        const promptCdnUrl = normalizeZaoyoeAssetCdnUrl(trimmed, 'prompts') || '';
        if (promptCdnUrl && !promptCdnUrl.includes('/thumb/')) {
            return promptCdnUrl.replace('/prompts/', '/prompts/thumb/');
        }

        if (isSupabaseStorageImageUrl(trimmed)) {
            return '';
        }

        return trimmed;
    },

    warmShopCardLeadImages: function (products = []) {
        const leadProducts = (Array.isArray(products) ? products : [])
            .filter((product) => this.isShopImageSource(getShopProductImageAssetUrl(getShopProductImageAsset(product), 'original') || product?.icon_url))
            .slice(0, SHOP_GRID_EAGER_IMAGE_COUNT);

        leadProducts.forEach((product) => {
            const imageAsset = getShopProductImageAsset(product);
            const optimizedUrl = this.getOptimizedShopImageUrl(imageAsset || product?.icon_url, { variant: 'card' });
            if (!optimizedUrl || optimizedUrl.startsWith('data:') || shopCardImageWarmCache.has(optimizedUrl)) {
                return;
            }

            shopCardImageWarmCache.add(optimizedUrl);
            const warmImage = new Image();
            warmImage.decoding = 'async';
            if ('fetchPriority' in warmImage) {
                warmImage.fetchPriority = 'high';
            }
            warmImage.src = optimizedUrl;
        });
    },

    setShopCardImageSource: function (cardImage, originalUrl) {
        if (!(cardImage instanceof HTMLImageElement) || !originalUrl) return;

        const primaryUrl = this.getOptimizedShopImageUrl(originalUrl, { variant: 'card' });
        const rawOriginalSrc = getShopProductImageAssetUrl(originalUrl, 'original');
        const originalSrc = isSupabaseStorageImageUrl(rawOriginalSrc)
            ? ''
            : (normalizeShopProductCdnUrl(rawOriginalSrc) || rawOriginalSrc);
        const transformFallbackUrl = this.getOptimizedShopImageUrl(originalSrc, { format: '' });

        cardImage.dataset.originalSrc = originalSrc;
        cardImage.dataset.transformFallbackSrc = transformFallbackUrl !== primaryUrl ? transformFallbackUrl : '';
        cardImage.dataset.fallbackStage = '';
        if (primaryUrl) {
            cardImage.src = primaryUrl;
        } else {
            cardImage.removeAttribute('src');
        }
    },

    handleShopCardImageError: function (cardImage, originalUrl) {
        if (!(cardImage instanceof HTMLImageElement)) return;

        const transformFallbackSrc = cardImage.dataset.transformFallbackSrc;
        const fallbackOriginalSrc = cardImage.dataset.originalSrc || originalUrl;

        if (!cardImage.dataset.fallbackStage && transformFallbackSrc && cardImage.src !== transformFallbackSrc) {
            cardImage.dataset.fallbackStage = 'transform';
            cardImage.src = transformFallbackSrc;
            return;
        }

        if (
            cardImage.dataset.fallbackStage !== 'original'
            && fallbackOriginalSrc
            && !isSupabaseStorageImageUrl(fallbackOriginalSrc)
            && cardImage.src !== fallbackOriginalSrc
        ) {
            cardImage.dataset.fallbackStage = 'original';
            cardImage.src = normalizeShopProductCdnUrl(fallbackOriginalSrc) || fallbackOriginalSrc;
        }
    },

    setDiscountMessage: function (message = '', { variant = 'error', html = false } = {}) {
        const msgBox = document.getElementById('discountMessage');
        if (!msgBox) return;

        msgBox.classList.add('shop-discount-message');
        msgBox.classList.remove(
            'shop-discount-message--error',
            'shop-discount-message--success',
            'shop-discount-message--warning',
            'shop-discount-message--info'
        );

        if (!message) {
            msgBox.hidden = true;
            msgBox.textContent = '';
            return;
        }

        msgBox.hidden = false;
        msgBox.classList.add(`shop-discount-message--${variant}`);
        if (html) {
            msgBox.innerHTML = message;
        } else {
            msgBox.textContent = message;
        }
    },

    renderModalProductName: function (displayName, { wholesale = false } = {}) {
        const modalProductName = document.getElementById('modalProductName');
        if (!modalProductName) return;

        if (!wholesale) {
            modalProductName.textContent = displayName;
            return;
        }

        modalProductName.innerHTML = `${this.escapeHtml(displayName)} <span class="shop-wholesale-badge"><i class="fas fa-tags shop-wholesale-badge__icon"></i>${window.i18n?.t('shop.wholesalePrice') || '批发价'}</span>`;
    },

    setShopButtonFeedbackState: function (button, active) {
        if (!button) return;
        button.classList.toggle('shop-btn-feedback-success', !!active);
    },

    buildSuccessToastMarkup: function () {
        return '<div id="shopSuccessToast" class="shop-success-toast" aria-live="polite"></div>';
    },

    ensureShopToastElement: function () {
        const existing = document.getElementById('shopStorefrontToast');
        if (existing) {
            return existing;
        }

        const toast = document.createElement('div');
        toast.id = 'shopStorefrontToast';
        toast.className = 'shop-success-toast';
        toast.dataset.shopToastGlobal = '1';
        toast.setAttribute('aria-live', 'polite');
        toast.setAttribute('aria-atomic', 'true');
        toast.setAttribute('role', 'status');
        document.body.appendChild(toast);
        return toast;
    },

    parseSuccessWarning: function (warning = '') {
        const normalizedWarning = String(warning || '').trim();
        if (!normalizedWarning) return null;

        const checkoutCopy = this.getCartCopy?.() || {};
        const partialPrefix = String(checkoutCopy.partialWarningPrefix || '').trim();
        const normalizedPrefix = partialPrefix.replace(/[：:]\s*$/, '');

        if (normalizedPrefix && normalizedWarning.startsWith(normalizedPrefix)) {
            const remainder = normalizedWarning
                .slice(normalizedPrefix.length)
                .replace(/^[：:\s]+/, '')
                .trim();
            const segments = remainder
                .split(/[：:]/)
                .map((segment) => String(segment || '').trim())
                .filter(Boolean);
            const productName = segments.length >= 2 ? segments.shift() : '';
            const reason = segments.join('：').trim() || remainder;

            return {
                eyebrow: window.i18n?.t('shop.specialTip') || '特别提示',
                title: /余额不足|insufficient/i.test(reason) ? '积分不足' : '结算未完成',
                summary: normalizedPrefix,
                productName,
                reason,
                raw: normalizedWarning
            };
        }

        return {
            eyebrow: window.i18n?.t('shop.specialTip') || '特别提示',
            title: window.i18n?.t('shop.specialTip') || '特别提示',
            summary: normalizedWarning,
            productName: '',
            reason: '',
            raw: normalizedWarning
        };
    },

    buildSuccessWarningMarkup: function (warning = '') {
        const parsedWarning = this.parseSuccessWarning(warning);
        if (!parsedWarning) return '';

        const summaryText = String(parsedWarning.summary || parsedWarning.raw || '').trim();
        const productName = String(parsedWarning.productName || '').trim();
        const reason = String(parsedWarning.reason || '').trim();
        const chips = [];

        if (productName) {
            chips.push(`
                <span class="shop-success-warning__chip shop-success-warning__chip--product">
                    <i class="fas fa-box" aria-hidden="true"></i>
                    <span>${this.escapeHtml(productName)}</span>
                </span>
            `);
        }

        if (reason) {
            chips.push(`
                <span class="shop-success-warning__chip shop-success-warning__chip--reason">
                    <i class="fas fa-wallet" aria-hidden="true"></i>
                    <span>${this.escapeHtml(reason)}</span>
                </span>
            `);
        }

        return `
            <div class="shop-success-warning">
                <div class="shop-success-warning__icon" aria-hidden="true">
                    <i class="fas fa-exclamation"></i>
                </div>
                <div class="shop-success-warning__content">
                    <div class="shop-success-warning__header">
                        <span class="shop-success-warning__eyebrow">${this.escapeHtml(parsedWarning.eyebrow || '特别提示')}</span>
                        <strong class="shop-success-warning__title">${this.escapeHtml(parsedWarning.title || '特别提示')}</strong>
                    </div>
                    ${summaryText ? `<p class="shop-success-warning__summary">${this.escapeHtml(summaryText)}</p>` : ''}
                    ${chips.length ? `<div class="shop-success-warning__chips">${chips.join('')}</div>` : ''}
                </div>
            </div>
        `;
    },

    buildExpandContentToggleMarkup: function (hiddenCount, expanded = false) {
        const safeHiddenCount = Number(hiddenCount || 0);
        const label = expanded
            ? (window.i18n?.t('shop.collapse') || '收起')
            : `${window.i18n?.t('shop.expandMore') || '展开其余'} ${safeHiddenCount} ${window.i18n?.t('shop.items') || '个'}`;
        const icon = expanded ? 'fa-chevron-up' : 'fa-chevron-down';

        return `
                <div class="shop-expand-toggle-row">
                    <span id="expandContentBtn" class="shop-expand-toggle" data-hidden-count="${safeHiddenCount}" data-expanded="${expanded ? 'true' : 'false'}">
                        <span>${label}</span>
                        <i class="fas ${icon} shop-expand-toggle-icon" aria-hidden="true"></i>
                    </span>
                </div>`;
    },

    buildSuccessModalItemPayload: function ({
        productId = '',
        displayName = '',
        orderId = '',
        createdAt = '',
        quantity = 1,
        content = '',
        contentSegments = null,
        purchaseNotes = '',
        usageInstructions = '',
        product = null
    } = {}) {
        const providedProduct = product && typeof product === 'object' && !Array.isArray(product)
            ? product
            : null;
        const normalizedProductId = String(productId || providedProduct?.id || providedProduct?.product_id || '').trim();
        const cachedProduct = this.getCachedProductById(normalizedProductId);
        const resolvedProduct = providedProduct
            ? {
                ...(cachedProduct || {}),
                ...providedProduct,
                id: String(providedProduct.id || providedProduct.product_id || cachedProduct?.id || normalizedProductId || '').trim(),
                icon_url: providedProduct.icon_url || cachedProduct?.icon_url || '',
                image_assets: normalizeShopProductImageAsset(providedProduct.image_assets || providedProduct.imageAssets)
                    || normalizeShopProductImageAsset(cachedProduct?.image_assets || cachedProduct?.imageAssets)
                    || {}
            }
            : (cachedProduct || null);
        const productSnapshot = resolvedProduct
            ? (this.buildCartProductSnapshot(resolvedProduct) || resolvedProduct)
            : null;
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const fallbackDisplayName = productSnapshot
            ? (currentLang === 'en'
                ? (productSnapshot.name_en || productSnapshot.name || '')
                : (productSnapshot.name || productSnapshot.name_en || ''))
            : (currentLang === 'en'
                ? (this.currentPurchase?.productNameEn || this.currentPurchase?.productName || '')
                : (this.currentPurchase?.productName || this.currentPurchase?.productNameEn || ''));
        const normalizedDisplayName = String(displayName || fallbackDisplayName || window.i18n?.t('shop.unknownProduct') || '商品').trim();
        const normalizedContentSegments = Array.isArray(contentSegments)
            ? contentSegments.map((segment) => String(segment || '').trim()).filter(Boolean)
            : String(content || '')
                .trim()
                .split(/\n----\n/)
                .map((segment) => String(segment || '').trim())
                .filter(Boolean);
        const resolvedPurchaseNotes = productSnapshot?.show_purchase_notes === true
            ? this.getLocalizedProductGuidanceText(productSnapshot, 'purchase_notes')
            : '';
        const resolvedUsageInstructions = productSnapshot?.show_usage_instructions === true
            ? this.getLocalizedProductGuidanceText(productSnapshot, 'usage_instructions')
            : '';
        const fallbackPurchaseNotes = String(this.currentPurchase?.productId || '').trim() === normalizedProductId
            ? String(this.currentPurchase?.purchaseNotes || '').trim()
            : '';
        const fallbackUsageInstructions = String(this.currentPurchase?.productId || '').trim() === normalizedProductId
            ? String(this.currentPurchase?.usageInstructions || '').trim()
            : '';

        return {
            productId: normalizedProductId,
            displayName: normalizedDisplayName,
            orderId: String(orderId || '').trim(),
            createdAt: String(createdAt || '').trim(),
            quantity: Math.max(1, Number(quantity || 0) || 1),
            contentSegments: normalizedContentSegments,
            purchaseNotes: String(purchaseNotes || resolvedPurchaseNotes || fallbackPurchaseNotes).trim(),
            usageInstructions: String(usageInstructions || resolvedUsageInstructions || fallbackUsageInstructions).trim(),
            product: productSnapshot || null
        };
    },

    formatSuccessOrderTimestamp: function (timestamp) {
        const normalizedTimestamp = String(timestamp || '').trim();
        if (!normalizedTimestamp) return '';

        const parsed = new Date(normalizedTimestamp);
        if (Number.isNaN(parsed.getTime())) {
            return normalizedTimestamp;
        }

        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(parsed);
    },

    buildSuccessContentCardMarkup: function (text) {
        const normalizedText = String(text || '').trim();
        if (!normalizedText) return '';

        const encodedText = encodeURIComponent(normalizedText);
        const isCompact = normalizedText.length <= 48 && !/\n/.test(normalizedText);
        const safeHtml = this.escapeHtml(normalizedText).replace(/\n/g, '<br>');

        return `
            <div
                class="content-card content-card--shop-copy shop-success-item__content-card"
                data-shop-copy-content="${encodedText}"
                title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}"
            >
                <div class="item-content-box item-content-box--plain">
                    <div class="item-text${isCompact ? ' item-text--centered' : ''}">${safeHtml}</div>
                </div>
            </div>`;
    },

    buildSuccessItemMarkup: function (item = {}, index = 0) {
        const normalizedItem = this.buildSuccessModalItemPayload(item);
        const purchaseNotesText = String(normalizedItem.purchaseNotes || '').trim();
        const usageText = String(normalizedItem.usageInstructions || '').trim();
        const contentSegments = normalizedItem.contentSegments.length
            ? normalizedItem.contentSegments
            : [window.i18n?.t('shop.noContent') || '（无内容）'];
        const contentPanelId = `shop-success-content-panel-${index}`;
        const notesPanelId = `shop-success-notes-panel-${index}`;
        const usagePanelId = `shop-success-usage-panel-${index}`;
        const quantityLabel = normalizedItem.quantity > 1
            ? this.trShop('quantity', '数量 {count}', { count: normalizedItem.quantity })
            : '';
        const revealContentLabel = this.trShop('tapToViewCardContent', '点击查看卡密');
        const encodedItemContent = encodeURIComponent(contentSegments.join('\n'));
        const formattedCreatedAt = this.formatSuccessOrderTimestamp(normalizedItem.createdAt);
        const actionTagsMarkup = (purchaseNotesText || usageText)
            ? `
                <div class="shop-success-item__action-tags">
                    ${purchaseNotesText ? `
                        <button
                            type="button"
                            class="shop-success-item__tag shop-success-item__tag--notice"
                            data-shop-success-action="toggle-notes"
                            aria-expanded="false"
                            aria-controls="${this.escapeAttribute(notesPanelId)}"
                        ><span class="shop-success-item__tag-label">注意事项</span></button>
                    ` : ''}
                    ${usageText ? `
                        <button
                            type="button"
                            class="shop-success-item__tag shop-success-item__tag--usage"
                            data-shop-success-action="toggle-usage"
                            aria-expanded="false"
                            aria-controls="${this.escapeAttribute(usagePanelId)}"
                        ><span class="shop-success-item__tag-label">使用说明</span></button>
                    ` : ''}
                </div>
            `
            : '';
        const iconMarkup = normalizedItem.product
            ? this.buildCartIconMarkup(normalizedItem.product, {
                imageClass: 'shop-success-item__thumb',
                iconClass: 'shop-success-item__icon'
            })
            : '<div class="shop-success-item__icon" aria-hidden="true"><i class="fas fa-box"></i></div>';

        return `
            <article class="shop-success-item" data-success-item-index="${index}">
                <div
                    class="shop-success-item__surface"
                    data-shop-success-action="toggle-item-content"
                    aria-expanded="false"
                    aria-controls="${this.escapeAttribute(contentPanelId)}"
                >
                    <div class="shop-success-item__header">
                        <div class="shop-success-item__heading">
                            ${iconMarkup}
                            <div class="shop-success-item__copy">
                                <div class="shop-success-item__title-row">
                                    <h3 class="shop-success-item__title">${this.escapeHtml(normalizedItem.displayName)}</h3>
                                </div>
                                <div class="shop-success-item__footer-meta">
                                    <div class="shop-success-item__submeta">
                                        <button
                                            type="button"
                                            class="shop-success-item__reveal-code"
                                            data-shop-success-action="toggle-item-content"
                                            aria-expanded="false"
                                            aria-controls="${this.escapeAttribute(contentPanelId)}"
                                            aria-label="${this.escapeAttribute(revealContentLabel)}"
                                            title="${this.escapeAttribute(revealContentLabel)}"
                                        >
                                            <span class="shop-success-item__submeta-label">${this.escapeHtml(revealContentLabel)}</span>
                                        </button>
                                    </div>
                                    ${quantityLabel ? `
                                        <div class="shop-success-item__meta shop-success-item__meta--inline">
                                            <span class="shop-success-item__tag shop-success-item__tag--quantity">${this.escapeHtml(quantityLabel)}</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        </div>

                        <div class="shop-success-item__actions">
                            <div class="shop-success-item__toolbar">
                                ${actionTagsMarkup}
                                <button
                                    type="button"
                                    class="shop-success-item__copy-btn"
                                    data-shop-success-action="copy-item"
                                    data-shop-copy-content="${encodedItemContent}"
                                    aria-label="复制该商品卡密"
                                    title="复制该商品卡密"
                                >
                                    <i class="fas fa-copy" aria-hidden="true"></i>
                                </button>
                            </div>
                            ${formattedCreatedAt ? `<div class="shop-success-item__time">${this.escapeHtml(formattedCreatedAt)}</div>` : ''}
                        </div>
                    </div>
                </div>

                <div class="shop-success-item__body">
                    <div class="shop-success-item__disclosures">
                        <section
                            id="${this.escapeAttribute(contentPanelId)}"
                            class="shop-cart-item__panel shop-success-item__content-panel"
                            aria-hidden="true"
                        >
                            <div class="shop-success-item__content-grid">
                                ${contentSegments.map((segment) => this.buildSuccessContentCardMarkup(segment)).join('')}
                            </div>
                        </section>
                        ${purchaseNotesText ? `
                            <section
                                id="${this.escapeAttribute(notesPanelId)}"
                                class="shop-cart-item__panel shop-cart-item__panel--notice shop-success-item__notes-panel"
                                hidden
                            >${this.renderStoredRichText(purchaseNotesText)}</section>
                        ` : ''}
                        ${usageText ? `
                            <section
                                id="${this.escapeAttribute(usagePanelId)}"
                                class="shop-cart-item__panel shop-cart-item__panel--usage shop-success-item__usage-panel"
                                hidden
                            >${this.renderStoredRichText(usageText)}</section>
                        ` : ''}
                    </div>
                </div>
            </article>`;
    },

    toggleSuccessItemContent: function (toggleSurface) {
        const surface = toggleSurface instanceof Element
            ? toggleSurface.closest('[data-shop-success-action="toggle-item-content"]')
            : null;
        const item = surface?.closest('.shop-success-item') || null;
        const panel = item?.querySelector('.shop-success-item__content-panel') || null;
        if (!surface || !item || !panel) return;

        const nextExpanded = surface.getAttribute('aria-expanded') !== 'true';
        if (panel.hidden) {
            panel.hidden = false;
        }
        item.querySelectorAll('[data-shop-success-action="toggle-item-content"]').forEach((toggle) => {
            toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        });
        panel.setAttribute('aria-hidden', nextExpanded ? 'false' : 'true');
        item.classList.toggle('is-content-expanded', nextExpanded);
    },

    toggleSuccessItemDisclosure: function (toggleButton) {
        if (!(toggleButton instanceof Element)) return;

        const panelId = String(toggleButton.getAttribute('aria-controls') || '').trim();
        if (!panelId) return;

        const panel = document.getElementById(panelId);
        if (!panel) return;

        const nextExpanded = toggleButton.getAttribute('aria-expanded') !== 'true';
        toggleButton.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        toggleButton.classList.toggle('is-active', nextExpanded);
        panel.hidden = !nextExpanded;
    },

    currentCategory: 'all',

    filterCategory: function (category, btn) {
        if (category === this.currentCategory && btn?.classList.contains('active')) {
            return;
        }
        this.currentCategory = category;
        const currentCards = document.querySelectorAll('#userShopGrid .shop-card').length;
        if (currentCards > 0) {
            this.lastSkeletonCount = Math.min(Math.max(currentCards, 3), 8);
        }
        const tabs = document.querySelectorAll('#shopCategoryFilters .filter-tab');
        tabs.forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        this.loadProducts();
    },

    hasCategoryProductsCache: function (category) {
        if (category === 'all') {
            return Array.isArray(this.allProductsCache);
        }

        if (Array.isArray(this.allProductsCache)) {
            return true;
        }

        return Object.prototype.hasOwnProperty.call(this.categoryProductsCache, category);
    },

    getCachedProductsForCategory: function (category) {
        if (category === 'all') {
            return Array.isArray(this.allProductsCache) ? this.allProductsCache : null;
        }

        if (Array.isArray(this.allProductsCache)) {
            return this.categoryProductsCache[category] || [];
        }

        if (Object.prototype.hasOwnProperty.call(this.categoryProductsCache, category)) {
            return this.categoryProductsCache[category] || [];
        }

        return null;
    },

    persistPrefetchedShopData: function () {
        if (!Array.isArray(this.allProductsCache) || this.allProductsCache.length === 0) return;

        try {
            sessionStorage.setItem('shop_prefetch', JSON.stringify({
                version: SHOP_PREFETCH_SCHEMA_VERSION,
                categories: this.availableCategories || [],
                products: this.allProductsCache,
                timestamp: Date.now(),
                site: window.SiteConfig?.site || 'cn'
            }));
        } catch (e) {
            console.warn('Failed to persist shop prefetch:', e);
        }
    },

    hydrateProductCaches: function (products) {
        const safeProducts = Array.isArray(products)
            ? [...products].sort((a, b) => (b.display_order || 0) - (a.display_order || 0))
            : [];
        const grouped = {};

        safeProducts.forEach(product => {
            const cacheKey = product.category || '__uncategorized__';
            if (!grouped[cacheKey]) {
                grouped[cacheKey] = [];
            }
            grouped[cacheKey].push(product);
        });

        this.allProductsCache = safeProducts;
        this.categoryProductsCache = grouped;
        const catalogSignature = this.computeShopCatalogSignature(safeProducts);
        if (catalogSignature) {
            this.lastShopCatalogSignature = catalogSignature;
        }
        this.persistPrefetchedShopData();
    },

    cacheCategoryProducts: function (category, products) {
        this.categoryProductsCache[category] = Array.isArray(products) ? products : [];
    },

    invalidateProductCaches: function () {
        this.productsCacheEpoch += 1;
        this.categoryProductsCache = {};
        this.categoryProductsPromises = {};
        this.allProductsCache = null;
        this.allProductsPromise = null;
        this.shopCatalogPromise = null;
        this.backgroundPrefetchScheduled = false;

        if (this.backgroundPrefetchHandle) {
            if (typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(this.backgroundPrefetchHandle);
            } else {
                clearTimeout(this.backgroundPrefetchHandle);
            }
            this.backgroundPrefetchHandle = null;
        }

        if (this.discountAssetsPrefetchHandle) {
            clearTimeout(this.discountAssetsPrefetchHandle);
            this.discountAssetsPrefetchHandle = null;
        }

        try {
            sessionStorage.removeItem('shop_prefetch');
        } catch (e) {
            console.warn('Failed to clear shop prefetch cache:', e);
        }
    },

    prefersReducedMotion: function () {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    },

    stabilizeShopScrollRestoration: function () {
        try {
            if ('scrollRestoration' in window.history) {
                window.history.scrollRestoration = 'manual';
            }
        } catch (_error) {
            // Ignore browsers that expose history but block scrollRestoration writes.
        }
    },

    waitForGridTransitionIdle: function ({ maxWaitMs = 3200, extraBufferMs = 48 } = {}) {
        const remainingMs = Math.ceil(this.gridTransitionActiveUntil - performance.now());
        if (remainingMs <= 0) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            window.setTimeout(resolve, Math.min(maxWaitMs, Math.max(0, remainingMs + extraBufferMs)));
        });
    },

    isProductGridTransitionActive: function (container = document.getElementById('userShopGrid')) {
        if (this.gridTransitionActiveUntil > performance.now()) {
            return true;
        }

        return !!container?.querySelector?.(
            '.shop-card-filter-enter:not(.is-visible), .shop-card-filter-exit, .shop-card-filter-moving, .shop-card-filter-hidden'
        );
    },

    runAfterNextPaint: function (callback) {
        if (typeof callback !== 'function') return;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                callback();
            });
        });
    },

    updateCategoryFilterButtons: function () {
        document.querySelectorAll('#shopCategoryFilters .filter-tab[data-shop-category]').forEach((tab) => {
            const isActive = String(tab.dataset.shopCategory || '') === String(this.currentCategory || 'all');
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    },

    getCategoryFilterEntries: function (categories = []) {
        const entries = [{
            name: 'all',
            label: window.i18n?.t('shop.allCategories') || '全部',
            i18nKey: 'shop.allCategories'
        }];

        (Array.isArray(categories) ? categories : []).forEach((category) => {
            const name = String(category?.name || '').trim();
            if (!name) return;

            entries.push({
                name,
                label: this.getLocalizedProductCategoryLabel(category) || name,
                i18nKey: ''
            });
        });

        return entries;
    },

    syncCategoryFilterButton: function (button, entry) {
        if (!button || !entry) return;

        const isActive = String(this.currentCategory || 'all') === entry.name;
        button.type = 'button';
        button.className = isActive ? 'filter-tab active' : 'filter-tab';
        button.textContent = entry.label;
        button.dataset.shopCategory = entry.name;
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');

        if (entry.i18nKey) {
            button.setAttribute('data-i18n', entry.i18nKey);
        } else {
            button.removeAttribute('data-i18n');
        }
    },

    renderCategoryFilterButtons: function (container, categories = []) {
        if (!container) return;

        const entries = this.getCategoryFilterEntries(categories);
        const existingTabs = Array.from(container.querySelectorAll('.filter-tab[data-shop-category]'));
        const canPatchInPlace = existingTabs.length === entries.length
            && existingTabs.every((tab, index) => String(tab.dataset.shopCategory || '') === entries[index].name);

        if (canPatchInPlace) {
            existingTabs.forEach((tab, index) => {
                this.syncCategoryFilterButton(tab, entries[index]);
            });
            return;
        }

        const fragment = document.createDocumentFragment();
        entries.forEach((entry) => {
            const button = document.createElement('button');
            this.syncCategoryFilterButton(button, entry);
            fragment.appendChild(button);
        });

        container.replaceChildren(fragment);
    },

    findRenderedProductCard: function (productId) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return null;

        return Array.from(document.querySelectorAll('#userShopGrid .shop-card[data-product-id]'))
            .find((card) => String(card.dataset.productId || '').trim() === normalizedId) || null;
    },

    clearProductSpotlight: function () {
        if (this.productSpotlightTimer) {
            clearTimeout(this.productSpotlightTimer);
            this.productSpotlightTimer = null;
        }

        document.querySelectorAll('#userShopGrid .shop-card--spotlight').forEach((card) => {
            card.classList.remove('shop-card--spotlight');
        });
    },

    spotlightProductCard: function (card) {
        if (!(card instanceof Element)) return;

        this.clearProductSpotlight();
        card.classList.add('shop-card--spotlight');
        this.productSpotlightTimer = window.setTimeout(() => {
            card.classList.remove('shop-card--spotlight');
            this.productSpotlightTimer = null;
        }, 2600);
    },

    clearPendingProductSpotlightUrl: function () {
        try {
            const url = new URL(window.location.href);
            const hadProductParam = url.searchParams.has('productId') || url.searchParams.has('product_id');
            const hadRechargeReturnParam = url.searchParams.has('rechargeReturn') || url.searchParams.has('quantity');
            if (!hadProductParam) return;

            url.searchParams.delete('productId');
            url.searchParams.delete('product_id');
            if (hadRechargeReturnParam) {
                url.searchParams.delete('rechargeReturn');
                url.searchParams.delete('quantity');
            }
            window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
        } catch (error) {
            console.warn('Failed to clear shop product spotlight params:', error);
        }
    },

    fulfillPendingProductSpotlight: async function () {
        const pending = this.pendingProductSpotlight;
        const normalizedProductId = String(pending?.productId || '').trim();
        if (!normalizedProductId) {
            return;
        }

        const card = this.findRenderedProductCard(normalizedProductId);
        if (card) {
            this.pendingProductSpotlight = null;
            this.clearPendingProductSpotlightUrl();
            this.runAfterNextPaint(() => {
                try {
                    card.scrollIntoView({
                        behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
                        block: 'center'
                    });
                } catch (_error) {
                    card.scrollIntoView();
                }
                this.spotlightProductCard(card);
            });

            if (pending.autoOpen && String(this.currentPurchase?.productId || '').trim() !== normalizedProductId) {
                this.runAfterNextPaint(() => {
                    this.openProductPurchaseFromDataset(
                        card.dataset,
                        pending.sourceContext || {
                            sourcePage: 'wallet',
                            sourceChannel: 'wallet_discount_asset',
                            sourcePromptId: null
                        },
                        {
                            trackClick: false,
                            initialQuantity: pending.initialQuantity
                        }
                    );
                });
            }
            return;
        }

        if (!pending.expandedSearch && this.currentCategory !== 'all') {
            this.pendingProductSpotlight = {
                ...pending,
                expandedSearch: true
            };
            this.currentCategory = 'all';
            this.updateCategoryFilterButtons();
            await this.loadProducts();
            return;
        }

        this.pendingProductSpotlight = null;
        this.clearPendingProductSpotlightUrl();
        this.showShopToast(this.trShop('couponProductHidden', '这张卡券对应的商品当前暂不可见，请先浏览商城其他商品。'), 'error');
    },

    promptLoginForPurchase: function (message) {
        const loginMessage = String(message || window.i18n?.t('shop.loginRequired') || '请先登录再进行兑换').trim();
        if (!loginMessage) return;

        if (typeof window.openLoginModalWithMessage === 'function') {
            void window.openLoginModalWithMessage(loginMessage, {
                viewId: 'login',
                type: 'error'
            }).catch((error) => {
                console.warn('Failed to open login modal with message from shop card:', error);
            });
            return;
        }

        const openAuthModal = typeof window.openLoginModal === 'function'
            ? () => window.openLoginModal('login')
            : (typeof window.toggleLoginModal === 'function'
                ? () => window.toggleLoginModal('login')
                : null);

        if (!openAuthModal) return;

        Promise.resolve(openAuthModal()).then(() => {
            this.runAfterNextPaint(() => {
                window.showAuthMessage?.(loginMessage, 'error', 'login');
            });
        }).catch((error) => {
            console.warn('Failed to open login modal from shop card:', error);
        });
    },

    startShopCardBreathing: function (card, { activateDelayMs = SHOP_CARD_BREATHE_ACTIVATE_DELAY_MS } = {}) {
        if (!(card instanceof Element)) return;
        const breatheFrame = card.querySelector('.shop-card-breathe-frame');
        if (!(breatheFrame instanceof Element)) return;

        if (card.classList.contains('breathing') && breatheFrame.classList.contains('shop-card-breathe-frame--breathing')) {
            this.clearShopCardBreatheTimer(card);
            return;
        }

        const breatheDelay = card.dataset.shopBreatheDelay
            || card.style.getPropertyValue('--breathe-delay')
            || breatheFrame.style.getPropertyValue('--breathe-delay')
            || '0s';
        if (!breatheDelay) {
            return;
        }

        this.clearShopCardBreatheTimer(card);
        if (!card.style.getPropertyValue('--breathe-delay')) {
            this.setCssVariables(card, {
                '--breathe-delay': breatheDelay
            });
        }
        if (!breatheFrame.style.getPropertyValue('--breathe-delay')) {
            this.setCssVariables(breatheFrame, {
                '--breathe-delay': breatheDelay
            });
        }
        if (!breatheFrame.style.animationDelay) {
            breatheFrame.style.animationDelay = this.getShopCardNegativeBreatheDelay(breatheDelay);
        }

        if (!this.isShopCardBreathingEnabled()) {
            card.classList.remove('breathing');
            breatheFrame.classList.remove('shop-card-breathe-frame--breathing');
            return;
        }

        const activate = () => {
            if (!card.isConnected) return;
            const activeBreatheFrame = card.querySelector('.shop-card-breathe-frame');
            if (!(activeBreatheFrame instanceof Element)) return;
            if (card.classList.contains('breathing') && activeBreatheFrame.classList.contains('shop-card-breathe-frame--breathing')) return;
            card.classList.add('breathing');
            activeBreatheFrame.classList.add('shop-card-breathe-frame--breathing');
        };

        if (activateDelayMs <= 0) {
            activate();
            return;
        }

        const timerId = window.setTimeout(() => {
            this.shopCardBreatheTimers.delete(card);
            activate();
        }, activateDelayMs);
        this.shopCardBreatheTimers.set(card, timerId);
    },

    startShopCardsBreathing: function (cards = [], options = {}) {
        (Array.isArray(cards) ? cards : []).forEach(card => {
            this.startShopCardBreathing(card, options);
        });
    },

    // 状态类：与动画/过渡相关，需要在 reuse 过程中被保留，不能因为 nextCard 没有这些 class 就被清掉。
    SHOP_CARD_REUSE_PRESERVED_CLASSES: Object.freeze([
        'breathing',
        'shop-card-filter-enter',
        'shop-card-filter-exit',
        'shop-card-filter-moving',
        'shop-card-filter-motion-lock',
        'shop-card-filter-hidden',
        'is-visible',
        'is-leaving',
        'shop-card--active-focus',
        'shop-card--observed-focus'
    ]),

    reuseShopProductCardElement: function (currentCard, nextCard) {
        if (!(currentCard instanceof Element) || !(nextCard instanceof Element)) {
            return nextCard;
        }

        const currentBreatheFrame = currentCard.querySelector('.shop-card-breathe-frame');
        const nextBreatheFrame = nextCard.querySelector('.shop-card-breathe-frame');
        const currentBreatheShell = currentCard.querySelector('.shop-card-breathe-shell');
        const nextBreatheShell = nextCard.querySelector('.shop-card-breathe-shell');
        const wasBreathing = currentCard.classList.contains('breathing')
            || currentBreatheFrame?.classList.contains('shop-card-breathe-frame--breathing') === true
            || nextCard.classList.contains('breathing') === true;
        const wasEntering = currentCard.classList.contains('shop-card-filter-enter');
        const wasVisible = currentCard.classList.contains('is-visible');
        const breatheDelay = currentCard.dataset.shopBreatheDelay
            || currentCard.style.getPropertyValue('--breathe-delay')
            || currentBreatheFrame?.style.getPropertyValue('--breathe-delay')
            || nextCard.dataset.shopBreatheDelay
            || '0s';

        // 1) 同步非 class/style 属性（增量，逐字段比较；不变则不动）。
        const nextAttrNames = new Set();
        Array.from(nextCard.attributes).forEach((attribute) => {
            nextAttrNames.add(attribute.name);
            if (attribute.name === 'class' || attribute.name === 'style') return;
            if (currentCard.getAttribute(attribute.name) !== attribute.value) {
                currentCard.setAttribute(attribute.name, attribute.value);
            }
        });
        Array.from(currentCard.attributes).forEach((attribute) => {
            if (attribute.name === 'class' || attribute.name === 'style') return;
            if (!nextAttrNames.has(attribute.name)) {
                currentCard.removeAttribute(attribute.name);
            }
        });

        // 2) 增量同步 class：用 classList.add/remove 逐项处理，避免
        //    setAttribute('class', ...) 整串覆写引发的样式重解析与合成层刷新
        //    （这正是呼吸过程中 "4-5 个循环后水平对齐" 的来源之一）。
        const preserved = this.SHOP_CARD_REUSE_PRESERVED_CLASSES;
        const nextClassSet = new Set(Array.from(nextCard.classList));
        // breathing 状态由 wasBreathing 决定，保证它继续存在；
        // filter-enter / is-visible 也要在 reuse 后保持原样。
        if (wasBreathing) nextClassSet.add('breathing');
        if (wasEntering) nextClassSet.add('shop-card-filter-enter');
        if (wasVisible) nextClassSet.add('is-visible');

        Array.from(currentCard.classList).forEach((cls) => {
            if (nextClassSet.has(cls)) return;
            if (preserved.includes(cls)) return; // 保留动画状态类
            currentCard.classList.remove(cls);
        });
        nextClassSet.forEach((cls) => {
            if (!currentCard.classList.contains(cls)) {
                currentCard.classList.add(cls);
            }
        });

        // 3) 内容：仅当 HTML 真正变化时替换。
        //    呼吸中优先替换 breathe-shell（保留 breathe-frame 节点 → 不打断呼吸动画）。
        if (wasBreathing && currentBreatheShell && nextBreatheShell) {
            if (currentBreatheShell.innerHTML !== nextBreatheShell.innerHTML) {
                currentBreatheShell.innerHTML = nextBreatheShell.innerHTML;
            }
        } else if (currentCard.innerHTML !== nextCard.innerHTML) {
            currentCard.innerHTML = nextCard.innerHTML;
        }

        // 4) 清理 exit/leaving 残留，重新固定状态类。
        currentCard.classList.remove(
            'shop-card-filter-exit',
            'shop-card-filter-hidden',
            'is-leaving'
        );
        if (wasEntering) currentCard.classList.add('shop-card-filter-enter');
        if (wasVisible) currentCard.classList.add('is-visible');
        if (wasBreathing || nextCard.classList.contains('breathing')) {
            currentCard.classList.add('breathing');
        }

        // 5) 同步 --breathe-delay 与 breathe-frame 的 breathing class。
        currentCard.dataset.shopBreatheDelay = breatheDelay;
        const restoredBreatheFrame = currentCard.querySelector('.shop-card-breathe-frame');
        if (restoredBreatheFrame instanceof Element) {
            if (!restoredBreatheFrame.style.getPropertyValue('--breathe-delay')) {
                this.setCssVariables(restoredBreatheFrame, {
                    '--breathe-delay': breatheDelay
                });
            }
            if (!restoredBreatheFrame.style.animationDelay) {
                restoredBreatheFrame.style.animationDelay = this.getShopCardNegativeBreatheDelay(breatheDelay);
            }
            if (wasBreathing || nextCard.classList.contains('breathing')) {
                restoredBreatheFrame.classList.add('shop-card-breathe-frame--breathing');
            }
        }
        if (!wasBreathing) {
            this.setCssVariables(currentCard, {
                '--breathe-delay': breatheDelay
            });
        }

        return currentCard;
    },

    clearProductGridTransitionArtifacts: function (container = document.getElementById('userShopGrid')) {
        if (this.gridTransitionCleanupTimer) {
            clearTimeout(this.gridTransitionCleanupTimer);
            this.gridTransitionCleanupTimer = null;
        }
        this.gridTransitionActiveUntil = 0;

        if (!container) return;

        container.querySelectorAll('.shop-grid-transition-layer').forEach(layer => layer.remove());
        container.querySelectorAll('.shop-card-filter-enter:not(.is-visible), .shop-card-filter-exit, .shop-card-filter-moving, .shop-card-filter-hidden').forEach(card => {
            this.cancelShopCardFreshEnterAnimation(card);
            card.classList.remove(
                'shop-card-filter-enter',
                'shop-card-filter-exit',
                'shop-card-filter-moving',
                'shop-card-filter-hidden',
                'shop-card-filter-motion-lock',
                'is-visible',
                'is-leaving'
            );
            this.clearShopCardBreatheTimer(card);
            if (!card.classList.contains('breathing') || !card.querySelector('.shop-card-breathe-frame--breathing')) {
                this.startShopCardBreathing(card, { activateDelayMs: 0 });
            }
            card.style.transition = '';
            card.style.transform = '';
            card.style.opacity = '';
            this.setCssVariables(card, {
                '--shop-card-filter-delay': null
            });
        });
    },

    clearMobileProductFocus: function () {
        document.querySelectorAll('.shop-card--active-focus, .shop-card--observed-focus').forEach(card => {
            card.classList.remove('shop-card--active-focus', 'shop-card--observed-focus');
        });
    },

    syncMobileProductFocusMode: function () {
        this.clearMobileProductFocus();
    },

    bindMobileProductFocusResize: function () {
        if (this.mobileProductFocusResizeBound) return;

        this.mobileProductFocusResizeBound = true;
        window.addEventListener('resize', () => {
            window.clearTimeout(this.mobileProductFocusResizeTimer);
            this.mobileProductFocusResizeTimer = window.setTimeout(() => {
                this.syncMobileProductFocusMode();
            }, 120);
        }, { passive: true });
    },

    isIOSMobileViewport: function () {
        const ua = navigator.userAgent || '';
        const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isiOS && window.matchMedia?.('(max-width: 768px)').matches;
    },

    shouldUseShopBackdropTouchFallback: function () {
        return this.isIOSMobileViewport() && /CriOS/i.test(navigator.userAgent || '');
    },

    shouldUsePurchaseModalLightOpenLock: function () {
        return this.shouldUseShopBackdropTouchFallback();
    },

    clearShopModalBackdropTapGuard: function () {
        if (this.shopModalBackdropTapGuardTimer) {
            clearTimeout(this.shopModalBackdropTapGuardTimer);
            this.shopModalBackdropTapGuardTimer = null;
        }
        if (typeof this.shopModalBackdropTapGuardCleanup === 'function') {
            this.shopModalBackdropTapGuardCleanup();
            this.shopModalBackdropTapGuardCleanup = null;
        }
        this.shopModalBackdropTapGuardUntil = 0;
    },

    armShopModalBackdropTapGuard: function (durationMs = 650) {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

        this.clearShopModalBackdropTapGuard();
        const guardUntil = Date.now() + Math.max(160, Math.trunc(Number(durationMs || 0) || 650));
        this.shopModalBackdropTapGuardUntil = guardUntil;

        const guardedTypes = ['mousedown', 'mouseup', 'click', 'auxclick'];
        const consumeSyntheticClick = (event) => {
            if (Date.now() > this.shopModalBackdropTapGuardUntil) {
                this.clearShopModalBackdropTapGuard();
                return;
            }

            event?.preventDefault?.();
            event?.stopPropagation?.();
            event?.stopImmediatePropagation?.();
        };

        guardedTypes.forEach((type) => {
            document.addEventListener(type, consumeSyntheticClick, true);
        });

        this.shopModalBackdropTapGuardCleanup = () => {
            guardedTypes.forEach((type) => {
                document.removeEventListener(type, consumeSyntheticClick, true);
            });
        };

        this.shopModalBackdropTapGuardTimer = setTimeout(() => {
            this.clearShopModalBackdropTapGuard();
        }, Math.max(220, guardUntil - Date.now()));
    },

    bindShopModalBackdropTouchFallback: function (element, bindingKey, closeHandler) {
        if (!(element instanceof HTMLElement) || typeof closeHandler !== 'function') return;

        const safeKey = String(bindingKey || 'modal').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const boundAttribute = `data-shop-backdrop-touch-${safeKey || 'modal'}`;
        if (element.getAttribute(boundAttribute) === '1') return;

        let touchStart = null;
        element.setAttribute(boundAttribute, '1');
        element.addEventListener('touchstart', (event) => {
            if (!this.shouldUseShopBackdropTouchFallback() || event.target !== element) {
                touchStart = null;
                return;
            }

            const touch = event.changedTouches?.[0] || event.touches?.[0] || null;
            if (!touch) {
                touchStart = null;
                return;
            }

            touchStart = {
                x: touch.clientX,
                y: touch.clientY,
                time: Date.now()
            };
        }, { passive: true });

        element.addEventListener('touchend', (event) => {
            if (!this.shouldUseShopBackdropTouchFallback() || event.target !== element) {
                touchStart = null;
                return;
            }

            const touch = event.changedTouches?.[0] || null;
            const start = touchStart;
            touchStart = null;
            if (!touch || !start) return;

            const movedX = Math.abs(touch.clientX - start.x);
            const movedY = Math.abs(touch.clientY - start.y);
            const elapsed = Date.now() - start.time;
            if (movedX > 18 || movedY > 18 || elapsed > 1200) return;

            if (event.cancelable) event.preventDefault();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            this.armShopModalBackdropTapGuard();
            closeHandler(event, element);
        }, { passive: false });

        element.addEventListener('touchcancel', () => {
            touchStart = null;
        }, { passive: true });
    },

    requestMobileBrowserChromeInsetSync: function () {
        if (this.mobileBrowserChromeInsetRafId) {
            cancelAnimationFrame(this.mobileBrowserChromeInsetRafId);
        }

        this.mobileBrowserChromeInsetRafId = requestAnimationFrame(() => {
            this.mobileBrowserChromeInsetRafId = null;
            this.syncMobileBrowserChromeInset();
        });
    },

    syncMobileBrowserChromeInset: function () {
        const root = document.documentElement;
        const body = document.body;
        if (!root || !body) return;

        if (!this.isIOSMobileViewport()) {
            this.setCssVariables(root, { '--shop-mobile-browser-chrome-bottom-gap': '' });
            this.setCssVariables(body, { '--shop-mobile-browser-chrome-bottom-gap': '' });
            return;
        }

        const vv = window.visualViewport;
        const viewportBottom = Math.round((vv?.offsetTop || 0) + (vv?.height || 0));
        const layoutHeight = Math.round(window.innerHeight || root.clientHeight || 0);
        const measuredGap = Math.max(0, layoutHeight - viewportBottom);
        const chromeGap = Math.max(64, Math.min(112, measuredGap));
        const value = `${chromeGap}px`;

        this.setCssVariables(root, { '--shop-mobile-browser-chrome-bottom-gap': value });
        this.setCssVariables(body, { '--shop-mobile-browser-chrome-bottom-gap': value });
    },

    bindMobileBrowserChromeInset: function () {
        if (this.mobileBrowserChromeInsetBound) return;

        this.mobileBrowserChromeInsetBound = true;
        this.syncMobileBrowserChromeInset();

        const scheduleSync = () => this.requestMobileBrowserChromeInsetSync();
        window.addEventListener('resize', scheduleSync, { passive: true });
        window.addEventListener('orientationchange', scheduleSync, { passive: true });
        window.visualViewport?.addEventListener('resize', scheduleSync, { passive: true });
        window.visualViewport?.addEventListener('scroll', scheduleSync, { passive: true });
    },

    buildEmptyStateElement: function () {
        const emptyState = document.createElement('div');
        emptyState.className = 'shop-empty-state';
        emptyState.innerHTML = `
            <div class="shop-empty-icon">
                <i class="fas fa-box-open" aria-hidden="true"></i>
            </div>
            <h3 class="shop-empty-title" data-i18n="shop.noProducts">${window.i18n?.t('shop.noProducts') || '暂无商品上架'}</h3>
        `;
        return emptyState;
    },

    buildProductCardElement: function (product, agentPrices = {}, index = 0) {
        if (!product) return null;

        const pricingState = this.buildProductCardPricingState(product, agentPrices);
        if (!pricingState) {
            return null;
        }
        const currentPrice = pricingState.currentPrice;

        const productId = String(product.id || '').trim();
        if (!productId) {
            return null;
        }

        const cartQuantity = this.getCartQuantity(productId);
        const breatheDelay = this.getShopCardBreatheDelay();

        const el = document.createElement('div');
        el.dataset.productId = productId;
        el.dataset.productCategory = String(product.category || '');
        el.dataset.shopBreatheDelay = breatheDelay;
        this.setCssVariables(el, {
            '--shop-card-filter-delay': null
        });

        const productImageAsset = getShopProductImageAsset(product);
        const productImageOriginalUrl = getShopProductImageAssetUrl(productImageAsset, 'original') || String(product.icon_url || '');
        const safeIconClass = this.escapeAttribute(product.icon_url || '');
        const displayName = this.getLocalizedProductName(product);
        const displayCategory = this.getLocalizedProductCategoryLabel(product.category);
        const showDescriptionOnCard = this.shouldShowProductCardDescription(product);
        const displayDesc = showDescriptionOnCard ? this.getLocalizedProductDescription(product) : '';
        const descriptionMarkup = showDescriptionOnCard
            ? `<p class="shop-card-desc">${this.escapeHtml(displayDesc)}</p>`
            : '<p class="shop-card-desc shop-card-desc--placeholder" aria-hidden="true"></p>';
        const safeCardImageAlt = this.escapeAttribute(displayName || (window.i18n?.t('shop.productImage') || '商品封面'));
        const safeIconUrl = this.escapeAttribute(productImageOriginalUrl);
        const hasCoverImage = this.isShopImageSource(productImageOriginalUrl);
        const shouldLoadImageEagerly = index < SHOP_GRID_EAGER_IMAGE_COUNT;
        const iconHtml = product.icon_url?.startsWith('fa')
            ? `<i class="${safeIconClass} shop-card-icon shop-card-icon--font" aria-hidden="true"></i>`
            : (hasCoverImage
                ? `<img src="${safeIconUrl}" width="40" class="shop-card-thumb" alt="${safeCardImageAlt}" loading="lazy" decoding="async">`
                : '<i class="fas fa-box shop-card-icon shop-card-icon--fallback" aria-hidden="true"></i>');

        const rawStockCount = Number(product.stock_count ?? product.stockCount ?? 0);
        const stockCount = Number.isFinite(rawStockCount) ? Math.max(0, Math.trunc(rawStockCount)) : 0;
        const noStock = stockCount <= 0;
        const stockLabel = noStock
            ? (window.i18n?.t('shop.outOfStock') || '售罄')
            : `${window.i18n?.t('shop.stock') || '库存'}: ${stockCount}`;
        const cartTriggerAriaLabel = noStock
            ? (window.i18n?.t('shop.outOfStock') || '售罄')
            : this.getCartCopy().addLabel;
        const maxPurchaseQuantity = this.getPurchaseQuantityCapForProduct(product, product.max_purchase_quantity);
        const purchaseDataset = this.buildProductCardPurchaseDataset(product, currentPrice);

        const coverIconMarkup = product.icon_url?.startsWith('fa')
            ? this.renderShopCoverIconMarkup(product.icon_url, safeIconClass)
            : iconHtml;
        const displayHtml = hasCoverImage
            ? `<img class="shop-card-image-cover" alt="${safeCardImageAlt}" width="480" height="320">`
            : `<div class="shop-icon-wrapper">${coverIconMarkup}</div>`;
        // breathing 现在从卡片诞生就启动：把 .breathing 与 .shop-card-breathe-frame--breathing
        // 写进初始模板，并把 --breathe-delay 内联到 breathe-frame。元素第一次 paint 时浏览器
        // 已经把 animation 应用进去，避免 "JS 后加 breathing class 时第一帧无 animation 导致
        // 所有卡片同时停在 keyframes 0%（translateY(0)）" 的水平对齐抖动。
        // 入场期间 opacity=0 看不见，呼吸期间因负 animation-delay 各自随机相位互不对齐。
        const breathingEnabled = this.isShopCardBreathingEnabled();
        const negativeBreatheDelay = this.getShopCardNegativeBreatheDelay(breatheDelay);
        const breatheFrameClass = breathingEnabled
            ? 'shop-card-breathe-frame shop-card-breathe-frame--breathing'
            : 'shop-card-breathe-frame';
        const breatheFrameStyleAttr = breathingEnabled
            ? ` style="--breathe-delay: ${breatheDelay}; animation-delay: ${negativeBreatheDelay};"`
            : '';
        el.className = `shop-card user-product-card ${breathingEnabled ? 'breathing ' : ''}${pricingState.flashShadowClass} ${cartQuantity > 0 ? 'shop-card--in-cart' : ''}`.trim();
        if (!noStock) {
            el.classList.add('shop-card--interactive');
            el.dataset.shopAction = 'buy-product';
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
        } else {
            el.classList.add('shop-card--sold-out');
            el.dataset.shopAction = 'sold-out-product';
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-disabled', 'true');
        }
        el.innerHTML = `
            <div class="${breatheFrameClass}"${breatheFrameStyleAttr}>
                <div class="shop-card-breathe-shell">
                    <div class="shop-card-image">
                        ${pricingState.flashSaleBadgeHtml}
                        ${pricingState.tieredPricingBadgeHtml}
                        ${displayHtml}
                        ${pricingState.agentBadgeHtml}
                        <div class="shop-stock-badge shop-stock-badge--floating ${noStock ? 'out-of-stock' : 'in-stock'}">
                            ${stockLabel}
                        </div>
                    </div>

                    <div class="shop-content-padding">
                        <h3 class="shop-card-title">${this.escapeHtml(displayName)}</h3>
                        ${descriptionMarkup}

                        <div class="shop-card-footer">
                            <div class="shop-card-price">${pricingState.priceHtml}</div>
                            <div class="shop-card-actions">
                                <button
                                    type="button"
                                    ${noStock ? 'aria-disabled="true"' : ''}
                                    class="shop-card-cart-trigger${noStock ? ' is-disabled' : ''}"
                                    data-shop-action="add-product-to-cart"
                                    aria-label="${this.escapeAttribute(cartTriggerAriaLabel)}"
                                >
                                    <span class="shop-card-cart-trigger__shell" aria-hidden="true">
                                        <svg viewBox="0 0 576 512" focusable="false" class="shop-card-cart-trigger__icon">
                                            <path fill="currentColor" d="M0 24C0 10.7 10.7 0 24 0l45.5 0c22.2 0 41.5 15.2 46.7 36.8L122 64 552 64c15.4 0 29.9 7.4 38.9 19.9s11.3 28.7 6.2 43.1l-55.2 160c-7.1 20.6-26.5 34.5-48.3 34.5l-277.1 0c-22.2 0-41.5-15.2-46.7-36.8L124.2 96 24 96C10.7 96 0 85.3 0 72L0 24zM128 416a48 48 0 1 1 96 0 48 48 0 1 1 -96 0zm336 48a48 48 0 1 1 0-96 48 48 0 1 1 0 96z"/>
                                        </svg>
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (el instanceof Element) {
            this.setCssVariables(el, {
                '--breathe-delay': breatheDelay
            });
        }

        this.applyShopPurchaseDataset(el, purchaseDataset);
        el.dataset.maxPurchaseQuantity = String(maxPurchaseQuantity);

        const productImage = hasCoverImage ? el.querySelector('.shop-card-image-cover') : null;
        if (productImage) {
            productImage.loading = shouldLoadImageEagerly ? 'eager' : 'lazy';
            productImage.decoding = 'async';
            productImage.setAttribute('fetchpriority', shouldLoadImageEagerly ? 'high' : 'auto');
            if ('fetchPriority' in productImage) {
                productImage.fetchPriority = shouldLoadImageEagerly ? 'high' : 'auto';
            }
            productImage.addEventListener('error', () => {
                this.handleShopCardImageError(productImage, productImageAsset || productImageOriginalUrl);
            });
            this.setShopCardImageSource(productImage, productImageAsset || productImageOriginalUrl);
        }

        const cartTriggerButton = el.querySelector('.shop-card-cart-trigger[data-shop-action="add-product-to-cart"]');
        if (cartTriggerButton) {
            this.applyShopPurchaseDataset(cartTriggerButton, purchaseDataset);
            cartTriggerButton.dataset.maxPurchaseQuantity = String(maxPurchaseQuantity);
        }

        if (!noStock) {
            const prefetchProductDiscounts = () => {
                void this.prefetchDiscountAssetsForProduct({
                    productId,
                    quantity: 1,
                    agentId: this.currentAgentId,
                    site: window.SiteConfig?.site || 'cn'
                });
            };
            el.addEventListener('pointerenter', prefetchProductDiscounts, { passive: true });
            el.addEventListener('focus', prefetchProductDiscounts);
        }

        return el;
    },

    buildProductCardElements: function (products, agentPrices = {}) {
        const renderedCards = [];
        (Array.isArray(products) ? products : []).forEach(product => {
            const card = this.buildProductCardElement(product, agentPrices, renderedCards.length);
            if (card) {
                renderedCards.push(card);
            }
        });
        return renderedCards;
    },

    transitionProductGrid: function (container, cardElements = [], { empty = false } = {}) {
        if (!container) return;

        this.clearProductGridTransitionArtifacts(container);
        const existingCards = Array.from(container.querySelectorAll('.shop-card[data-product-id]'));
        const shouldAnimate = !this.prefersReducedMotion() && (existingCards.length > 0 || (!empty && cardElements.length > 0));
        const transitionId = ++this.gridTransitionSequence;

        if (empty) {
            this.gridTransitionActiveUntil = 0;
            container.innerHTML = '';
            container.classList.add('is-empty');
            container.appendChild(this.buildEmptyStateElement());
            this.clearMobileProductFocus();
            this.syncMobileProductFocusMode();
            return;
        }

        const previousCardState = new Map(
            existingCards
                .map(card => {
                    const productId = String(card.dataset.productId || '').trim();
                    if (!productId) return null;
                    return [productId, {
                        left: card.offsetLeft,
                        top: card.offsetTop,
                        width: card.offsetWidth,
                        height: card.offsetHeight,
                        translateY: this.getShopCardCurrentTranslateY(card),
                        card
                    }];
                })
                .filter(Boolean)
        );
        const existingCardsByProductId = new Map(
            existingCards
                .map(card => {
                    const productId = String(card.dataset.productId || '').trim();
                    return productId ? [productId, card] : null;
                })
                .filter(Boolean)
        );
        const previousIds = new Set(
            existingCards
                .map(card => String(card.dataset.productId || '').trim())
                .filter(Boolean)
        );
        const nextIds = new Set(
            cardElements
                .map(card => String(card.dataset.productId || '').trim())
                .filter(Boolean)
        );

        cardElements = cardElements.map(card => {
            const productId = String(card?.dataset?.productId || '').trim();
            const reusableCard = productId ? existingCardsByProductId.get(productId) : null;
            return reusableCard ? this.reuseShopProductCardElement(reusableCard, card) : card;
        });

        if (!shouldAnimate) {
            this.gridTransitionActiveUntil = 0;
            container.innerHTML = '';
            if (empty) {
                container.classList.add('is-empty');
                container.appendChild(this.buildEmptyStateElement());
            } else {
                container.classList.remove('is-empty');
                cardElements.forEach(card => container.appendChild(card));
                this.startShopCardsBreathing(cardElements);
            }
            this.syncMobileProductFocusMode();
            return;
        }

        this.clearMobileProductFocus();

        const cleanupAnimatedCards = ({ movingCards = [], enteringCards = [], overlay = null } = {}) => {
            movingCards.forEach(({ card, clone }) => {
                card?.classList.remove('shop-card-filter-hidden', 'shop-card-filter-moving', 'shop-card-filter-motion-lock');
                card && (card.style.transition = '');
                card && (card.style.transform = '');
                card && (card.style.opacity = '');
                card && this.setCssVariables(card, {
                    '--shop-card-filter-delay': null
                });
                clone?.remove();
            });

            enteringCards.forEach(card => {
                this.cancelShopCardFreshEnterAnimation(card);
                card?.classList.remove('shop-card-filter-enter', 'shop-card-filter-motion-lock', 'is-visible');
                card && this.setCssVariables(card, {
                    '--shop-card-filter-delay': null
                });
            });

            const overlays = Array.isArray(overlay) ? overlay : [overlay].filter(Boolean);
            overlays.forEach(layer => layer?.remove());

            if (transitionId === this.gridTransitionSequence) {
                this.gridTransitionActiveUntil = 0;
                this.syncMobileProductFocusMode();
            }
        };

        const createEnteringSettlePromise = (cards = [], fallbackMs = 0) => {
            const pendingCards = new Set(
                cards.filter(card => card instanceof Element && card.isConnected)
            );

            if (!pendingCards.size) {
                return null;
            }

            const watchedProperties = new Set(['opacity', 'transform']);
            const listeners = [];
            let timeoutId = null;
            let resolvePromise = null;
            let settled = false;

            const cleanup = () => {
                listeners.forEach(({ card, handler }) => {
                    card.removeEventListener('transitionend', handler);
                    card.removeEventListener('transitioncancel', handler);
                });
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };

            const finish = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolvePromise?.();
            };

            const promise = new Promise(resolve => {
                resolvePromise = resolve;
            });

            pendingCards.forEach(card => {
                const handler = (event) => {
                    const isWatchedTransition = event.type !== 'animationend'
                        && event.type !== 'animationcancel'
                        && watchedProperties.has(event.propertyName);

                    if (event.target !== card || !isWatchedTransition) {
                        return;
                    }

                    pendingCards.delete(card);
                    if (!pendingCards.size) {
                        finish();
                    }
                };

                card.addEventListener('transitionend', handler);
                card.addEventListener('transitioncancel', handler);
                listeners.push({ card, handler });
            });

            timeoutId = window.setTimeout(
                finish,
                Math.max(0, fallbackMs) + SHOP_CARD_ENTER_SETTLE_FALLBACK_BUFFER_MS
            );

            return promise;
        };

        // Start breathing on persistent / moving cards only. New entering cards
        // do not get the breathing class until their entrance has settled.
        const releaseSettledBreathe = (payload = {}) => {
            if (payload.settledBreatheReleased) return;
            payload.settledBreatheReleased = true;
            const allCards = payload.finalCards || payload.enteringCards || [];
            const settledCards = allCards.filter(card =>
                card instanceof Element
                && !card.classList.contains('shop-card-filter-enter')
            );
            if (settledCards.length === 0) return;
            this.startShopCardsBreathing(settledCards);
        };

        // Start breathing on every card in the payload for no-animation paths.
        const releasePayloadBreathe = (payload = {}) => {
            if (payload.breatheReleased) return;
            payload.breatheReleased = true;
            const cards = (payload.finalCards || payload.enteringCards || [])
                .filter(card => card instanceof Element && !card.matches('.shop-card-filter-enter:not(.is-visible)'));
            this.startShopCardsBreathing(cards);
        };

        const scheduleCleanup = (durationMs, payload = {}) => {
            if (durationMs <= 0) {
                if (transitionId === this.gridTransitionSequence) {
                    this.gridTransitionActiveUntil = 0;
                }
                cleanupAnimatedCards(payload);
                releasePayloadBreathe(payload);
                return;
            }

            if (transitionId === this.gridTransitionSequence) {
                const activeDurationMs = durationMs + (payload.enterSettlePromise ? SHOP_CARD_ENTER_SETTLE_FALLBACK_BUFFER_MS : 0);
                this.gridTransitionActiveUntil = Math.max(this.gridTransitionActiveUntil, performance.now() + activeDurationMs);
            }

            const runCleanup = () => {
                if (transitionId !== this.gridTransitionSequence) return;
                cleanupAnimatedCards(payload);
                releasePayloadBreathe(payload);
                this.gridTransitionCleanupTimer = null;
            };

            this.gridTransitionCleanupTimer = window.setTimeout(() => {
                if (transitionId !== this.gridTransitionSequence) return;
                // Let runCleanup own both DOM mutations; the settle promise has
                // its own fallback timer if transitionend never arrives.
                if (payload.enterSettlePromise) {
                    payload.enterSettlePromise.then(runCleanup, runCleanup);
                    return;
                }
                runCleanup();
            }, durationMs);
        };

        const createExitOverlay = (cards, blockedPositionKeys = new Set()) => {
            if (!cards.length) {
                return { overlay: null, cleanupDurationMs: 0 };
            }

            const overlay = document.createElement('div');
            overlay.className = 'shop-grid-transition-layer';
            overlay.setAttribute('aria-hidden', 'true');

            cards.forEach((card, exitIndex) => {
                const productId = String(card.dataset.productId || '').trim();
                const previousState = previousCardState.get(productId);
                if (!previousState) return;
                const previousSlotKey = `${Math.round(previousState.left)}:${Math.round(previousState.top)}`;
                if (blockedPositionKeys.has(previousSlotKey)) {
                    return;
                }

                const clone = card.cloneNode(true);
                clone.classList.remove(
                    'shop-card-filter-enter',
                    'shop-card-filter-exit',
                    'shop-card-filter-moving',
                    'shop-card-filter-hidden',
                    'shop-card-filter-motion-lock',
                    'shop-card--active-focus',
                    'shop-card--observed-focus',
                    'breathing',
                    'is-visible',
                    'is-leaving'
                );
                clone.classList.add('shop-card-transition-clone', 'shop-card-transition-clone--exit');
                clone.style.width = `${previousState.width}px`;
                clone.style.height = `${previousState.height}px`;
                clone.style.left = `${previousState.left}px`;
                clone.style.top = `${previousState.top}px`;
                clone.style.transform = `translate3d(0px, ${previousState.translateY || 0}px, 0) scale(1)`;
                this.setCssVariables(clone, {
                    '--shop-card-filter-delay': `${exitIndex * 56}ms`
                });
                overlay.appendChild(clone);
            });

            return {
                overlay: overlay.childElementCount > 0 ? overlay : null,
                cleanupDurationMs: overlay.childElementCount > 0
                    ? 460 + Math.max(0, overlay.childElementCount - 1) * 56
                    : 0
            };
        };

        const renderNextState = ({ enterDelayBase = 0 } = {}) => {
            if (transitionId !== this.gridTransitionSequence) return;

            if (empty) {
                container.innerHTML = '';
                container.classList.add('is-empty');
                container.appendChild(this.buildEmptyStateElement());
                this.syncMobileProductFocusMode();
                return {
                    movingCards: [],
                    enteringCards: [],
                    cleanupDurationMs: 0,
                    overlay: []
                };
            }

            container.classList.remove('is-empty');
            const finalCardSet = new Set(cardElements);
            Array.from(container.children).forEach(child => {
                if (child.classList?.contains('shop-grid-transition-layer')) {
                    return;
                }
                if (!finalCardSet.has(child)) {
                    child.remove();
                }
            });
            cardElements.forEach(card => container.appendChild(card));

            const movingCards = [];
            cardElements.forEach(card => {
                const productId = String(card.dataset.productId || '').trim();
                const previousState = previousCardState.get(productId);
                if (!previousState) return;

                const moveX = previousState.left - card.offsetLeft;
                const moveY = previousState.top - card.offsetTop;
                if (Math.abs(moveX) < 1 && Math.abs(moveY) < 1) return;

                card.classList.add('shop-card-filter-motion-lock');
                card.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;
                movingCards.push({ card, productId });
            });

            const enterDelayStepMs = SHOP_CARD_PROMPT_ENTER_DELAY_STEP_MS;
            const effectiveEnterDelayBase = enterDelayBase;
            let enterOrder = 0;
            cardElements.forEach(card => {
                const productId = String(card.dataset.productId || '').trim();
                if (previousIds.has(productId)) {
                    return;
                }

                card.classList.add('shop-card-filter-enter');
                // breathing 现已在 buildProductCardElement 渲染时挂好，新卡进 DOM 第一帧
                // 浏览器就已应用 animation，不再需要在这里再 add class（避免 "JS 后加 class
                // 引起的首帧无 animation" 水平对齐抖动）。
                const enterDelayMs = effectiveEnterDelayBase + (enterOrder * enterDelayStepMs);
                card.dataset.shopFreshEnterDelayMs = String(enterDelayMs);
                enterOrder += 1;
            });

            const enteringCards = Array.from(container.querySelectorAll('.shop-card-filter-enter:not(.is-visible)'));
            if (movingCards.length === 0 && enteringCards.length === 0) {
                return {
                    movingCards,
                    enteringCards,
                    cleanupDurationMs: 0,
                    finalCards: cardElements,
                    overlay: []
                };
            }

            const moveDurationMs = movingCards.length > 0
                ? 400
                : 0;
            const enterDurationMs = enteringCards.length > 0
                ? effectiveEnterDelayBase + SHOP_CARD_PROMPT_ENTER_DURATION_MS + Math.max(0, enteringCards.length - 1) * enterDelayStepMs
                : 0;
            const cleanupDurationMs = Math.max(moveDurationMs, enterDurationMs);
            const enterSettlePromise = createEnteringSettlePromise(enteringCards, enterDurationMs);

            const revealEnteringCards = () => {
                if (transitionId !== this.gridTransitionSequence) return;
                movingCards.forEach(({ card }) => {
                    card.classList.add('shop-card-filter-moving');
                });
                if (movingCards.length > 0) {
                    void container.offsetWidth;
                }
                movingCards.forEach(({ card }) => {
                    card.style.transform = 'translate3d(0px, 0px, 0)';
                });
                enteringCards.forEach((card, index) => {
                    const enterDelayMs = Number(card.dataset.shopFreshEnterDelayMs || index * SHOP_CARD_PROMPT_ENTER_DELAY_STEP_MS) || 0;
                    window.setTimeout(() => {
                        if (transitionId !== this.gridTransitionSequence || !card.isConnected) return;
                        window.requestAnimationFrame(() => {
                            if (transitionId !== this.gridTransitionSequence || !card.isConnected) return;
                            card.classList.add('is-visible');
                            window.setTimeout(() => {
                                if (transitionId !== this.gridTransitionSequence || !card.isConnected) return;
                                this.startShopCardBreathing(card);
                            }, SHOP_CARD_PROMPT_ENTER_DURATION_MS + 50);
                        });
                    }, enterDelayMs);
                });
            };

            void container.offsetWidth;
            if (transitionId === this.gridTransitionSequence) {
                revealEnteringCards();
            }

            return {
                movingCards,
                enteringCards,
                cleanupDurationMs,
                enterSettlePromise,
                finalCards: cardElements,
                overlay: []
            };
        };

        const exitingCards = existingCards.filter(card => {
            const productId = String(card.dataset.productId || '').trim();
            return productId && !nextIds.has(productId);
        });
        const persistentCount = existingCards.length - exitingCards.length;

        if (exitingCards.length === 0) {
            const payload = renderNextState() || {};
            // Persistent/moving cards can keep breathing now; entering cards
            // start through the same per-card prompt timers used above.
            releaseSettledBreathe(payload);
            scheduleCleanup(payload.cleanupDurationMs || 0, payload);
            return;
        }

        if (!empty && persistentCount > 0) {
            const payload = renderNextState({ enterDelayBase: 0 }) || {};
            releaseSettledBreathe(payload);
            const blockedPositionKeys = new Set(
                Array.from(container.querySelectorAll('.shop-card[data-product-id]')).map(card =>
                    `${Math.round(card.offsetLeft)}:${Math.round(card.offsetTop)}`
                )
            );
            const exitOverlayPayload = createExitOverlay(exitingCards, blockedPositionKeys);
            if (exitOverlayPayload.overlay) {
                container.appendChild(exitOverlayPayload.overlay);
                void exitOverlayPayload.overlay.offsetWidth;
                if (transitionId === this.gridTransitionSequence) {
                    Array.from(exitOverlayPayload.overlay.children).forEach(clone => {
                        clone.classList.add('is-exiting');
                    });
                }
            }

            scheduleCleanup(
                Math.max(payload.cleanupDurationMs || 0, exitOverlayPayload.cleanupDurationMs || 0),
                {
                    ...payload,
                    overlay: [...(payload.overlay || []), exitOverlayPayload.overlay].filter(Boolean)
                }
            );
            return;
        }

        exitingCards.forEach((card, exitIndex) => {
            card.classList.add('shop-card-filter-exit', 'shop-card-filter-motion-lock');
            this.setCssVariables(card, {
                '--shop-card-filter-delay': `${exitIndex * 56}ms`
            });
        });

        void container.offsetWidth;
        if (transitionId === this.gridTransitionSequence) {
            exitingCards.forEach(card => card.classList.add('is-leaving'));
        }

        const exitDurationMs = 500 + Math.max(0, exitingCards.length - 1) * 56;
        if (transitionId === this.gridTransitionSequence) {
            this.gridTransitionActiveUntil = Math.max(this.gridTransitionActiveUntil, performance.now() + exitDurationMs);
        }
        this.gridTransitionCleanupTimer = window.setTimeout(() => {
            if (transitionId !== this.gridTransitionSequence) return;
            this.gridTransitionCleanupTimer = null;
            const payload = renderNextState() || {};
            releaseSettledBreathe(payload);
            scheduleCleanup(payload.cleanupDurationMs || 0, payload);
        }, exitDurationMs);
    },

    getExistingProductSkeletonCount: function (container = document.getElementById('userShopGrid')) {
        if (!container) return 0;
        return container.querySelectorAll('.skeleton-card').length;
    },

    buildProductSkeletonCardMarkup: function () {
        return `
            <div class="skeleton-card" aria-hidden="true">
                <div class="skeleton-image-shell">
                </div>
                <div class="skeleton-content">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-desc"></div>
                    <div class="skeleton skeleton-desc skeleton-desc--short"></div>
                    <div class="skeleton-footer">
                        <div class="skeleton skeleton-price-value"></div>
                        <div class="skeleton skeleton-btn"></div>
                    </div>
                </div>
            </div>
        `;
    },

    renderProductSkeletons: function (count) {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        this.clearProductGridTransitionArtifacts(container);
        const existingSkeletonCount = this.getExistingProductSkeletonCount(container);
        const requestedCount = Number.parseInt(count, 10)
            || existingSkeletonCount
            || this.lastSkeletonCount
            || SHOP_PRODUCT_SKELETON_COUNT;
        const safeCount = Math.min(Math.max(requestedCount, 3), 8);
        const currentSkeletonCount = existingSkeletonCount;
        const hasOnlySkeletonCards = existingSkeletonCount > 0
            && container.querySelectorAll('.shop-card').length === 0
            && !container.querySelector('.shop-empty-state, .shop-status-message');

        this.lastSkeletonCount = safeCount;
        container.classList.remove('is-empty');

        if (hasOnlySkeletonCards && currentSkeletonCount === safeCount) {
            return;
        }

        container.innerHTML = Array.from({ length: safeCount }, () => this.buildProductSkeletonCardMarkup()).join('');
        this.clearMobileProductFocus();
    },

    renderEmptyState: function () {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        this.clearProductGridTransitionArtifacts(container);
        container.classList.add('is-empty');
        container.innerHTML = '';
        container.appendChild(this.buildEmptyStateElement());
        this.clearMobileProductFocus();
    },

    fetchShopCatalogDirect: async function () {
        const client = window.supabaseClient || supabaseClient;
        const [categoryResult, productResult] = await Promise.all([
            client
                .from('shop_categories')
                .select('*')
                .order('sort_order'),
            client
                .from('shop_products')
                .select('*')
                .eq('is_active', true)
                .order('display_order', { ascending: false })
        ]);

        if (categoryResult.error) {
            throw categoryResult.error;
        }
        if (productResult.error) {
            throw productResult.error;
        }

        return {
            categories: Array.isArray(categoryResult.data) ? categoryResult.data : [],
            products: this.filterProductsForCurrentSite(productResult.data || [])
        };
    },

    getShopCatalogBrowserCacheKey: function ({ site = 'cn', category = 'all' } = {}) {
        const normalizedSite = String(site || 'cn').trim().toLowerCase() || 'cn';
        const normalizedCategory = String(category || 'all').trim().toLowerCase() || 'all';
        return `${SHOP_CATALOG_BROWSER_CACHE_PREFIX}:${SHOP_PREFETCH_SCHEMA_VERSION}:${normalizedSite}:${normalizedCategory}`;
    },

    readShopCatalogBrowserCache: function ({ site = 'cn', category = 'all' } = {}) {
        try {
            const raw = window.sessionStorage?.getItem(this.getShopCatalogBrowserCacheKey({ site, category }));
            if (!raw) return null;

            const cached = JSON.parse(raw);
            const ageMs = Date.now() - Number(cached?.cachedAt || 0);
            if (
                cached?.version !== SHOP_PREFETCH_SCHEMA_VERSION
                || ageMs < 0
                || ageMs > SHOP_CATALOG_BROWSER_CACHE_TTL_MS
                || !Array.isArray(cached?.categories)
                || !Array.isArray(cached?.products)
            ) {
                return null;
            }

            return {
                categories: cached.categories,
                products: cached.products
            };
        } catch (_error) {
            return null;
        }
    },

    writeShopCatalogBrowserCache: function ({ site = 'cn', category = 'all', categories = [], products = [] } = {}) {
        if (!Array.isArray(categories) || !Array.isArray(products)) {
            return;
        }

        try {
            window.sessionStorage?.setItem(this.getShopCatalogBrowserCacheKey({ site, category }), JSON.stringify({
                version: SHOP_PREFETCH_SCHEMA_VERSION,
                cachedAt: Date.now(),
                categories,
                products
            }));
        } catch (_error) {
            // Browser storage may be disabled.
        }
    },

    fetchShopCatalogPayloadFromApi: async function ({ site = 'cn', category = 'all', forceRefresh = false } = {}) {
        const catalogParams = new URLSearchParams({ site });
        if (category && category !== 'all') {
            catalogParams.set('category', category);
        }
        if (forceRefresh) {
            catalogParams.set('refresh', String(Date.now()));
        }
        const relativeUrl = `/api/shop/catalog?${catalogParams.toString()}`;
        const directUrl = buildShopPublicApiUrl('/api/shop/catalog', Object.fromEntries(catalogParams));
        const candidates = Array.from(new Set([directUrl, relativeUrl].filter(Boolean)));
        let lastError = null;

        for (const url of candidates) {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    cache: forceRefresh ? 'no-store' : 'default',
                    credentials: url.startsWith('http') ? 'omit' : 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        ...(forceRefresh ? {
                            'Cache-Control': 'no-cache',
                            Pragma: 'no-cache'
                        } : {})
                    }
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok || payload?.success === false) {
                    throw new Error(payload?.message || this.getShopCatalogUnavailableMessage());
                }
                return payload;
            } catch (error) {
                lastError = error;
                if (url === relativeUrl) {
                    break;
                }
                console.warn('Shop catalog direct API unavailable, falling back to same-origin route:', error?.message || error);
            }
        }

        throw lastError || new Error(this.getShopCatalogUnavailableMessage());
    },

    fetchShopCatalogFromApi: async function ({ forceRefresh = false } = {}) {
        if (!forceRefresh && this.shopCatalogPromise) {
            return this.shopCatalogPromise;
        }

        const request = (async () => {
            const currentSite = window.SiteConfig?.site || 'cn';
            const category = 'all';

            if (!forceRefresh) {
                const cachedCatalog = this.readShopCatalogBrowserCache({
                    site: currentSite,
                    category
                });
                if (cachedCatalog) {
                    void this.fetchShopCatalogFromApi({ forceRefresh: true }).catch((error) => {
                        console.debug('Shop catalog background refresh skipped:', error?.message || error);
                    });
                    return {
                        categories: cachedCatalog.categories,
                        products: this.filterProductsForCurrentSite(cachedCatalog.products)
                    };
                }
            }

            try {
                const payload = await this.fetchShopCatalogPayloadFromApi({
                    site: currentSite,
                    category,
                    forceRefresh
                });

                const categories = Array.isArray(payload?.categories)
                    ? payload.categories
                    : (Array.isArray(payload?.data?.categories) ? payload.data.categories : []);
                const products = Array.isArray(payload?.products)
                    ? payload.products
                    : (Array.isArray(payload?.data?.products) ? payload.data.products : []);

                this.writeShopCatalogBrowserCache({
                    site: currentSite,
                    category,
                    categories,
                    products
                });

                return {
                    categories,
                    products: this.filterProductsForCurrentSite(products)
                };
            } catch (error) {
                console.warn('Shop catalog API unavailable, falling back to direct query:', error?.message || error);
                return this.fetchShopCatalogDirect();
            }
        })();

        const trackedRequest = request.finally(() => {
            if (this.shopCatalogPromise === trackedRequest) {
                this.shopCatalogPromise = null;
            }
        });

        this.shopCatalogPromise = trackedRequest;
        return trackedRequest;
    },

    fetchProductsFromServer: async function (category = 'all') {
        const catalog = await this.fetchShopCatalogFromApi();
        if (Array.isArray(catalog?.categories)) {
            this.availableCategories = catalog.categories;
        }
        return this.filterProductsForCategory(catalog?.products || [], category);
    },

    getProductsForCategory: async function (category, { forceRefresh = false } = {}) {
        if (!forceRefresh) {
            const cachedProducts = this.getCachedProductsForCategory(category);
            if (cachedProducts !== null) {
                return cachedProducts;
            }
        }

        const cacheEpoch = this.productsCacheEpoch;

        if (category === 'all') {
            if (!forceRefresh && this.allProductsPromise) {
                return this.allProductsPromise;
            }

            const request = this.fetchProductsFromServer('all')
                .then(products => {
                    if (cacheEpoch === this.productsCacheEpoch) {
                        this.hydrateProductCaches(products);
                    }
                    return products;
                })
                .finally(() => {
                    if (this.allProductsPromise === request) {
                        this.allProductsPromise = null;
                    }
                });

            this.allProductsPromise = request;
            return request;
        }

        if (!forceRefresh && this.categoryProductsPromises[category]) {
            return this.categoryProductsPromises[category];
        }

        const request = this.fetchProductsFromServer(category)
            .then(products => {
                if (cacheEpoch === this.productsCacheEpoch) {
                    this.cacheCategoryProducts(category, products);
                }
                return products;
            })
            .finally(() => {
                if (this.categoryProductsPromises[category] === request) {
                    delete this.categoryProductsPromises[category];
                }
            });

        this.categoryProductsPromises[category] = request;
        return request;
    },

    isMissingAgentPriceSiteColumnError: function (error) {
        const text = [
            error?.code,
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').toLowerCase();

        return Boolean(text)
            && text.includes('agent_prices')
            && text.includes('site')
            && (
                text.includes('schema cache')
                || text.includes('could not find')
                || text.includes('does not exist')
                || text.includes('column')
            );
    },

    normalizeAgentPriceRows: function (rows = []) {
        const agentPrices = {};
        (Array.isArray(rows) ? rows : []).forEach((ap) => {
            const productId = String(ap?.product_id || '').trim();
            if (!productId) return;
            agentPrices[productId] = ap.custom_price;
        });
        return agentPrices;
    },

    getAgentPrices: async function () {
        if (!this.currentAgentId) return {};
        const currentSite = this.getCurrentShopSite();

        if (this.agentPricesCache && this.agentPricesCacheSite === currentSite) {
            return this.agentPricesCache;
        }

        if (this.agentPricesPromise && this.agentPricesPromiseSite === currentSite) {
            return this.agentPricesPromise;
        }

        const client = window.supabaseClient || supabaseClient;
        const request = (async () => {
            let { data, error } = await client
                .from('agent_prices')
                .select('product_id, custom_price, site')
                .eq('agent_id', this.currentAgentId)
                .eq('site', currentSite);

            if (error && this.isMissingAgentPriceSiteColumnError(error)) {
                console.warn('[ShopClient] agent_prices.site is missing; falling back to legacy agent price lookup.');
                const legacyResult = await client
                    .from('agent_prices')
                    .select('product_id, custom_price')
                    .eq('agent_id', this.currentAgentId);
                data = legacyResult.data;
                error = legacyResult.error;
            }

            if (error) throw error;

            return this.normalizeAgentPriceRows(data);
        })()
            .then((agentPrices) => {
                this.agentPricesCache = agentPrices;
                this.agentPricesCacheSite = currentSite;
                return agentPrices;
            })
            .finally(() => {
                if (this.agentPricesPromise === request) {
                    this.agentPricesPromise = null;
                    this.agentPricesPromiseSite = '';
                }
            });

        this.agentPricesPromise = request;
        this.agentPricesPromiseSite = currentSite;
        return request;
    },

    ensureAgentPricesReadyInBackground: function () {
        if (!this.currentAgentId) {
            return Promise.resolve({});
        }

        const currentSite = this.getCurrentShopSite();
        if (this.agentPricesCache && this.agentPricesCacheSite === currentSite) {
            this.refreshVisibleProductCardPricing(this.agentPricesCache);
            return Promise.resolve(this.agentPricesCache);
        }

        return this.getAgentPrices()
            .then((agentPrices) => {
                this.refreshVisibleProductCardPricing(agentPrices);
                return agentPrices;
            })
            .catch((error) => {
                console.warn('Background agent prices load failed:', error);
                return {};
            });
    },

    prefetchAllProductsInBackground: async function () {
        if (Array.isArray(this.allProductsCache) || this.allProductsPromise) return;

        try {
            await this.getProductsForCategory('all');
            console.log('⚡ Background-prefetched all shop categories');
        } catch (error) {
            console.warn('Background shop prefetch failed:', error);
        }
    },

    scheduleBackgroundProductPrefetch: function () {
        if (Array.isArray(this.allProductsCache) || this.allProductsPromise || this.backgroundPrefetchScheduled) {
            return;
        }

        this.backgroundPrefetchScheduled = true;

        const runPrefetch = () => {
            this.backgroundPrefetchScheduled = false;
            this.backgroundPrefetchHandle = null;
            this.prefetchAllProductsInBackground();
        };

        if (typeof window.requestIdleCallback === 'function') {
            this.backgroundPrefetchHandle = window.requestIdleCallback(runPrefetch, { timeout: 1200 });
        } else {
            this.backgroundPrefetchHandle = window.setTimeout(runPrefetch, 180);
        }
    },

    revalidatePrefetchedShopData: async function () {
        if (this.prefetchedShopRevalidationPromise) {
            return this.prefetchedShopRevalidationPromise;
        }

        const request = new Promise((resolve) => {
            const runRevalidation = async () => {
                try {
                    await this.loadCategoryFilters({ forceRefresh: true });
                    // Avoid cutting off the first-paint entrance animation when prefetched data is already visible.
                    await this.waitForGridTransitionIdle();
                    const grid = document.getElementById('userShopGrid');
                    const hasRenderedCards = !!grid?.querySelector('.shop-card[data-product-id]');
                    if (!hasRenderedCards) {
                        await this.loadProducts({ forceRefresh: true });
                        return;
                    }

                    const products = await this.getProductsForCategory(this.currentCategory, { forceRefresh: true });
                    this.warmShopCardLeadImages(products);
                    this.scheduleVisibleDiscountAssetsPrefetch(products);
                    this.renderCart();
                    this.scheduleBackgroundProductPrefetch();
                } catch (error) {
                    console.warn('Shop prefetch revalidation failed:', error);
                } finally {
                    this.prefetchedShopRevalidationPromise = null;
                    resolve();
                }
            };

            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(() => {
                    void runRevalidation();
                }, { timeout: 1200 });
            } else {
                window.setTimeout(() => {
                    void runRevalidation();
                }, 180);
            }
        });

        this.prefetchedShopRevalidationPromise = request;
        return request;
    },

    // Load categories from shop_categories table dynamically
    loadCategoryFilters: async function ({ forceRefresh = false } = {}) {
        const container = document.getElementById('shopCategoryFilters');
        if (!container) return;

        try {
            if (!forceRefresh && Array.isArray(this._prefetchedCategories) && this._prefetchedCategories.length > 0) {
                const prefetchedCategories = [...this._prefetchedCategories].sort((a, b) => (
                    Number(a?.sort_order || 0) - Number(b?.sort_order || 0)
                ));
                this.availableCategories = prefetchedCategories;
                this.renderCategoryFilterButtons(container, prefetchedCategories);
                this.persistPrefetchedShopData();
                console.log('⚡ Using prefetched shop categories');
                return;
            }

            let categories = null;
            const catalog = await this.fetchShopCatalogFromApi({ forceRefresh });
            if (Array.isArray(catalog?.products) && catalog.products.length > 0 && (forceRefresh || !Array.isArray(this.allProductsCache))) {
                this.hydrateProductCaches(catalog.products);
            }
            if (Array.isArray(catalog?.categories) && catalog.categories.length > 0) {
                categories = catalog.categories;
            } else if (!forceRefresh && Array.isArray(this._prefetchedCategories) && this._prefetchedCategories.length > 0) {
                categories = [...this._prefetchedCategories].sort((a, b) => (
                    Number(a?.sort_order || 0) - Number(b?.sort_order || 0)
                ));
                console.log('⚡ Falling back to prefetched categories');
            }

            // Fallback to defaults if empty
            if (!categories || categories.length === 0) {
                console.warn('shop_categories load failed or empty, using defaults');
                categories = [
                    { name: 'account', color: '#6b9ece' },
                    { name: 'Gemini', color: '#f4b400' },
                    { name: 'other', color: '#9aa0a6' }
                ];
            }

            this.availableCategories = categories;
            this.persistPrefetchedShopData();

            this.renderCategoryFilterButtons(container, categories);

        } catch (e) {
            console.error('Failed to load category filters:', e);
            if (container.querySelector('.filter-tab[data-shop-category]')) {
                this.updateCategoryFilterButtons();
                return;
            }
            // On initial error, show a simple "全部" button.
            this.renderCategoryFilterButtons(container, []);
        }
    },

    loadProducts: async function ({ forceRefresh = false } = {}) {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        const requestCategory = this.currentCategory;
        const requestToken = ++this.productsRequestToken;
        const hasCachedProducts = !forceRefresh && this.hasCategoryProductsCache(requestCategory);
        const hasRenderedCards = container.querySelectorAll('.shop-card[data-product-id]').length > 0;

        if (forceRefresh) {
            this.invalidateProductCaches();
        }

        if (!hasCachedProducts && !hasRenderedCards) {
            this.renderProductSkeletons();
        }

        // Clear existing timer if any
        if (this.flashSaleInterval) {
            clearInterval(this.flashSaleInterval);
            this.flashSaleInterval = null;
        }

        try {
            if (this.currentAgentId && !this.agentPricesCache) {
                void this.ensureAgentPricesReadyInBackground();
            }

            const data = await this.getProductsForCategory(requestCategory, { forceRefresh });
            const agentPrices = this.agentPricesCache || {};

            if (requestToken !== this.productsRequestToken) return;

            if (!data || data.length === 0) {
                this.transitionProductGrid(container, [], { empty: true });
                this.renderCart();
                this.scheduleBackgroundProductPrefetch();
                void this.fulfillPendingProductSpotlight();
                return;
            }

            this.warmShopCardLeadImages(data);
            const renderedCards = this.buildProductCardElements(data, agentPrices);
            if (renderedCards.length === 0) {
                this.transitionProductGrid(container, [], { empty: true });
                this.renderCart();
                this.scheduleBackgroundProductPrefetch();
                void this.fulfillPendingProductSpotlight();
                return;
            }

            this.transitionProductGrid(container, renderedCards);
            this.lastSkeletonCount = Math.min(Math.max(renderedCards.length, 3), 8);
            this.scheduleVisibleDiscountAssetsPrefetch(data);
            this.renderCart();
            this.scheduleBackgroundProductPrefetch();
            void this.fulfillPendingProductSpotlight();

        } catch (err) {
            if (requestToken !== this.productsRequestToken) return;
            this.clearProductGridTransitionArtifacts(container);
            container.classList.remove('is-empty');
            container.innerHTML = this.buildShopStatusMessage(
                this.getShopCatalogUnavailableMessage(),
                { variant: 'error', fullSpan: true, iconClass: 'fas fa-circle-exclamation' }
            );
            this.clearMobileProductFocus();
            this.renderCart();
        }

        this.startFlashSaleTimer();
    },

    flashSaleInterval: null,

    startFlashSaleTimer: function () {
        if (this.flashSaleInterval) clearInterval(this.flashSaleInterval);
        this.flashSaleInterval = setInterval(() => {
            let activeFlashSales = 0;
            document.querySelectorAll('.flash-sale-badge').forEach(badge => {
                if (badge.closest('.shop-grid-transition-layer')) {
                    return;
                }
                const endTime = new Date(badge.dataset.endtime).getTime();
                const now = Date.now();
                if (now >= endTime) {
                    // Flash sale ended, reload products completely
                    clearInterval(this.flashSaleInterval);
                    this.loadProducts({ forceRefresh: true });
                    return; // Stop processing further
                } else {
                    activeFlashSales++;
                    const diff = endTime - now;
                    const h = Math.floor(diff / (1000 * 60 * 60));
                    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                    const s = Math.floor((diff % (1000 * 60)) / 1000);
                    const timerSpan = badge.querySelector('.countdown-timer');
                    if (timerSpan) {
                        timerSpan.textContent = h > 0
                            ? `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                            : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                    }
                }
            });
            // Cleanup interval if no more flash sales on page
            if (activeFlashSales === 0) {
                clearInterval(this.flashSaleInterval);
                this.flashSaleInterval = null;
            }
        }, 1000);
    },

    // State for the purchase modal
    currentPurchase: {
        productId: null,
        productName: null,
        productNameEn: null,
        productCategory: null,
        basePrice: 0,
        unitPrice: 0,
        hasFlashSale: false,
        flashSalePrice: null,
        flashSaleOriginalPrice: null,
        quantity: 1,
        orderId: null,
        createdAt: null,
        rules: [],
        selectedDiscounts: [],
        appliedDiscounts: [],
        discountCode: null,
        discountAssetId: null,
        discountType: null,
        discountValue: null,
        discountBenefitLabel: '',
        discountAmount: 0,
        discountFinalTotal: null,
        pricingWaterfall: [],
        stackingPolicy: null,
        availableDiscountAssets: [],
        claimableDiscounts: [],
        discountAssetsLoading: false,
        purchaseNotes: '',
        usageInstructions: '',
        sourcePage: null,
        sourceChannel: null,
        sourcePromptId: null,
        cartOrigin: null,
        configuredMaxQuantity: 99,
        unlimitedPurchases: false,
        maxQuantity: 99,
        idempotencyKey: null
    },

    isPurchaseModalKeyboardDockEnabled: function () {
        const ua = navigator.userAgent || '';
        const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isiOS && window.matchMedia('(max-width: 768px)').matches && !!window.visualViewport;
    },

    getPurchaseModalElements: function () {
        const overlay = document.getElementById('shopPurchaseModal');
        return {
            overlay,
            card: overlay?.querySelector('.modal-content') || null
        };
    },

    getActivePurchaseModalInput: function () {
        const { overlay } = this.getPurchaseModalElements();
        const active = document.activeElement;
        if (!overlay || !active || !overlay.contains(active)) return null;
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
    },

    focusPurchaseModalInputWithoutScroll: function (input) {
        if (!input) return;
        try {
            input.focus({ preventScroll: true });
        } catch (_) {
            input.focus();
        }
    },

    bindPurchaseModalInputFocusStabilizer: function (input) {
        if (!input || input.dataset.shopFocusStabilizerBound === '1') return;

        input.addEventListener('touchstart', (e) => {
            if (!this.isPurchaseModalKeyboardDockEnabled()) return;
            this.lockPurchaseModalKeyboardPage();
            if (e.cancelable) e.preventDefault();
            this.focusPurchaseModalInputWithoutScroll(input);
        }, { passive: false });

        input.dataset.shopFocusStabilizerBound = '1';
    },

    freezePurchaseModalPage: function () {
        if (this.purchaseModalPageFrozen || !this.isPurchaseModalKeyboardDockEnabled()) return;
        if (this.shouldUsePurchaseModalLightOpenLock()) return;

        const theme = this.getCurrentThemeChromeMode();
        const themeColor = this.getThemeChromeColor(theme);
        const metaTheme = this.getThemeColorMeta();
        this.purchaseModalBaseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
        document.documentElement.classList.add('shop-purchase-modal-lock');
        document.body.classList.add('shop-purchase-modal-lock');
        this.setCssVariables(document.documentElement, {
            '--shop-purchase-theme-chrome-color': themeColor
        });
        this.setCssVariables(document.body, {
            '--shop-purchase-theme-chrome-color': themeColor,
            '--shop-purchase-lock-top': `-${this.purchaseModalBaseScrollY}px`
        });
        if (metaTheme) {
            metaTheme.setAttribute('data-shop-purchase-theme-lock', 'true');
            metaTheme.setAttribute('data-mobile-theme-lock', 'true');
        }
        const didLockSharedThemeColor = this.lockShopModalThemeColor(themeColor);
        if (!didLockSharedThemeColor && typeof window.applySiteThemeChrome === 'function') {
            window.applySiteThemeChrome(theme, { forceRepaint: true });
        } else if (!didLockSharedThemeColor) {
            metaTheme?.setAttribute('content', themeColor);
        }
        this.purchaseModalPageFrozen = true;
        this.stabilizePurchaseModalViewport();
    },

    stabilizePurchaseModalViewport: function () {
        if (!this.purchaseModalPageFrozen) return;

        this.setCssVariables(document.body, {
            '--shop-purchase-lock-top': `-${this.purchaseModalBaseScrollY}px`
        });

        if ((window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
        }
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    },

    unfreezePurchaseModalPage: function () {
        if (!this.purchaseModalPageFrozen) return;

        const restoreScrollY = Math.max(0, Math.round(this.purchaseModalBaseScrollY || 0));
        const root = document.documentElement;
        const body = document.body;
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        const theme = this.getCurrentThemeChromeMode();
        const siteModalThemeRestoreAttribute = window.SITE_MODAL_THEME_RESTORE_ATTRIBUTE || 'data-site-modal-theme-restore';
        const modalThemeCleanupActive = metaTheme?.hasAttribute(siteModalThemeRestoreAttribute);
        document.documentElement.classList.remove('shop-purchase-modal-lock');
        document.body.classList.remove('shop-purchase-modal-lock');
        this.setCssVariables(document.documentElement, {
            '--shop-purchase-theme-chrome-color': ''
        });
        this.setCssVariables(document.body, {
            '--shop-purchase-theme-chrome-color': '',
            '--shop-purchase-lock-top': ''
        });
        if (metaTheme?.getAttribute('data-shop-purchase-theme-lock') === 'true') {
            metaTheme.removeAttribute('data-shop-purchase-theme-lock');
            const hasOtherMobileThemeLock = root.classList.contains('mobile-menu-open')
                || body.classList.contains('mobile-menu-open')
                || Boolean(document.querySelector('.mobile-menu.active'));
            if (!hasOtherMobileThemeLock) {
                metaTheme.removeAttribute('data-mobile-theme-lock');
                if (!modalThemeCleanupActive && metaTheme.hasAttribute('data-original-content')) {
                    metaTheme.setAttribute('content', metaTheme.getAttribute('data-original-content') || this.getThemeChromeColor(theme));
                    metaTheme.removeAttribute('data-original-content');
                }
            }
        }
        if (!modalThemeCleanupActive && typeof window.applySiteThemeChrome === 'function') {
            window.applySiteThemeChrome(theme, { forceRepaint: true });
        } else if (!modalThemeCleanupActive) {
            metaTheme?.setAttribute('content', this.getThemeChromeColor(theme));
        }
        this.purchaseModalPageFrozen = false;
        this.purchaseModalBaseScrollY = 0;

        requestAnimationFrame(() => {
            window.scrollTo(0, restoreScrollY);
        });
    },

    lockPurchaseModalKeyboardPage: function () {
        if (this.purchaseModalPageFrozen) {
            this.stabilizePurchaseModalViewport();
            return;
        }
        if (!window.iOSScrollLock) return;
        const { overlay } = this.getPurchaseModalElements();
        if (!overlay?.classList.contains('active')) return;

        window.iOSScrollLock.lockLight(overlay);
        this.purchaseModalOwnsFullScrollLock = false;
    },

    unlockPurchaseModalKeyboardPage: function (preserveLightLock = true) {
        if (!this.purchaseModalOwnsFullScrollLock || !window.iOSScrollLock) return;

        window.iOSScrollLock.unlock();
        this.purchaseModalOwnsFullScrollLock = false;

        const { overlay } = this.getPurchaseModalElements();
        if (preserveLightLock && overlay?.classList.contains('active')) {
            window.iOSScrollLock.lockLight(overlay);
        }
    },

    clearPurchaseModalKeyboardTimers: function () {
        if (this.purchaseModalKeyboardInitialDockTimer) {
            clearTimeout(this.purchaseModalKeyboardInitialDockTimer);
            this.purchaseModalKeyboardInitialDockTimer = null;
        }
        if (this.purchaseModalKeyboardInsetDropTimer) {
            clearTimeout(this.purchaseModalKeyboardInsetDropTimer);
            this.purchaseModalKeyboardInsetDropTimer = null;
        }
        if (this.purchaseModalKeyboardTransitionTimer) {
            clearTimeout(this.purchaseModalKeyboardTransitionTimer);
            this.purchaseModalKeyboardTransitionTimer = null;
        }
        if (this.purchaseModalKeyboardFocusedReleaseTimer) {
            clearTimeout(this.purchaseModalKeyboardFocusedReleaseTimer);
            this.purchaseModalKeyboardFocusedReleaseTimer = null;
        }
        this.purchaseModalKeyboardPendingInset = 0;
    },

    schedulePurchaseModalFocusedRelease: function () {
        if (this.purchaseModalKeyboardFocusedReleaseTimer) return;

        this.purchaseModalKeyboardFocusedReleaseTimer = setTimeout(() => {
            this.purchaseModalKeyboardFocusedReleaseTimer = null;
            const { overlay } = this.getPurchaseModalElements();
            if (!overlay?.classList.contains('active')) return;
            if (!this.purchaseModalKeyboardDocked || !this.getActivePurchaseModalInput()) return;

            const liveMetrics = this.getPurchaseModalViewportMetrics();
            if (liveMetrics.bottomInset <= 24) {
                this.releasePurchaseModalKeyboardDock(true);
            }
        }, 48);
    },

    schedulePurchaseModalKeyboardContentSync: function () {
        const { overlay } = this.getPurchaseModalElements();
        if (!overlay?.classList.contains('active') || !this.isPurchaseModalKeyboardDockEnabled()) {
            return;
        }

        if (this.purchaseModalKeyboardContentRafId) {
            cancelAnimationFrame(this.purchaseModalKeyboardContentRafId);
        }

        this.purchaseModalKeyboardContentRafId = requestAnimationFrame(() => {
            this.purchaseModalKeyboardContentRafId = null;
            this.syncPurchaseModalKeyboardDock();
        });
    },

    togglePurchaseModalSheetAnimation: function (card, animate, duration = 250) {
        if (!card) return;

        if (this.purchaseModalKeyboardTransitionTimer) {
            clearTimeout(this.purchaseModalKeyboardTransitionTimer);
            this.purchaseModalKeyboardTransitionTimer = null;
        }

        card.classList.toggle('shop-purchase-sheet-animating', !!animate);
        if (!animate) return;

        this.purchaseModalKeyboardTransitionTimer = setTimeout(() => {
            card.classList.remove('shop-purchase-sheet-animating');
            this.purchaseModalKeyboardTransitionTimer = null;
        }, duration + 40);
    },

    capturePurchaseModalKeyboardBase: function () {
        const { overlay, card } = this.getPurchaseModalElements();
        const frame = this.getPurchaseModalNativeViewportFrame();
        const visualHeight = Math.max(0, Math.round(frame.visualHeight || 0));
        const baseViewportHeight = Math.max(0, Math.round(frame.overlayHeight || frame.visualBottom || visualHeight || 0));
        this.purchaseModalKeyboardBaseViewportHeight = baseViewportHeight;
        this.setCssVariables(overlay, {
            '--shop-purchase-viewport-top': `${frame.top}px`,
            '--shop-purchase-viewport-left': `${frame.left}px`,
            '--shop-purchase-viewport-width': `${frame.width}px`,
            '--shop-purchase-overlay-height': `${baseViewportHeight}px`
        });
        this.purchaseModalKeyboardBaseVisualHeight = Math.max(this.purchaseModalKeyboardBaseVisualHeight || 0, visualHeight);
        if (card) {
            const cardHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 420);
            this.purchaseModalKeyboardBaseCardHeight = Math.max(320, cardHeight || 420);
        }
    },

    getPurchaseModalViewportMetrics: function () {
        const vv = window.visualViewport;
        const visualTop = Math.max(0, vv?.offsetTop || 0);
        const visualHeight = Math.max(0, vv?.height || 0);
        const visualBottom = visualTop + visualHeight;
        const baseViewportHeight = Math.max(
            this.purchaseModalKeyboardBaseViewportHeight || 0,
            visualBottom
        );
        const baseVisualHeight = Math.max(this.purchaseModalKeyboardBaseVisualHeight || 0, visualHeight);
        const insetFromLayout = Math.max(0, baseViewportHeight - visualBottom);
        const insetFromViewportDelta = Math.max(0, baseVisualHeight - visualHeight);

        return {
            visualHeight,
            visualBottom,
            baseViewportHeight,
            baseVisualHeight,
            bottomInset: Math.max(0, Math.round(Math.max(insetFromLayout, insetFromViewportDelta)))
        };
    },

    getPurchaseModalLayoutRect: function (element) {
        const rect = element?.getBoundingClientRect?.();
        if (!rect) return null;

        const { overlay } = this.getPurchaseModalElements();
        const visualTop = Math.max(0, window.visualViewport?.offsetTop || 0);
        const overlayRect = overlay?.getBoundingClientRect?.();
        const rectUsesVisualViewport = visualTop > 0
            && overlayRect
            && Math.abs(Math.round(overlayRect.top || 0)) < Math.abs(Math.round((overlayRect.top || 0) - visualTop));
        const layoutOffsetTop = rectUsesVisualViewport ? visualTop : 0;

        return {
            top: Math.round(rect.top + layoutOffsetTop),
            bottom: Math.round(rect.bottom + layoutOffsetTop),
            height: Math.round(rect.height || 0)
        };
    },

    shouldDockPurchaseModalForInput: function (input, metrics = this.getPurchaseModalViewportMetrics()) {
        if (!input || !metrics) return false;

        const bottomInset = Math.max(0, Math.round(metrics.bottomInset || 0));
        if (bottomInset <= 24) return false;

        const keyboardTop = Math.max(0, Math.round((metrics.baseViewportHeight || 0) - bottomInset));
        const inputRect = this.getPurchaseModalLayoutRect(input);
        if (!keyboardTop || !inputRect) return false;

        const bottomGuard = Math.max(32, Math.min(72, Math.round((metrics.baseViewportHeight || 0) * 0.08)));
        return inputRect.bottom > keyboardTop - bottomGuard;
    },

    applyPurchaseModalKeyboardDock: function (bottomInset, animate = false) {
        const { overlay, card } = this.getPurchaseModalElements();
        if (!overlay || !card) return;

        if (this.purchaseModalKeyboardFocusedReleaseTimer) {
            clearTimeout(this.purchaseModalKeyboardFocusedReleaseTimer);
            this.purchaseModalKeyboardFocusedReleaseTimer = null;
        }
        const metrics = this.getPurchaseModalViewportMetrics();
        if (!this.purchaseModalKeyboardBaseCardHeight) {
            const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 420);
            this.purchaseModalKeyboardBaseCardHeight = Math.max(320, liveHeight || 420);
        }

        const liveScrollHeight = Math.round(card.scrollHeight || 0);
        const liveCardHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 0);
        const baseCardHeight = Math.max(320, this.purchaseModalKeyboardBaseCardHeight || 420, liveCardHeight, liveScrollHeight);
        const baseViewportHeight = Math.max(metrics.baseViewportHeight || 0, this.purchaseModalKeyboardBaseViewportHeight || 0);
        const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
        const minTop = 14;
        const keyboardClearance = 12;
        const maxAvailableHeight = Math.max(280, Math.round(keyboardTop - minTop - keyboardClearance));
        const dockHeight = Math.min(baseCardHeight, maxAvailableHeight);
        const centeredBottom = (baseViewportHeight * 0.5) + (dockHeight * 0.5);
        const targetBottom = Math.max(40, keyboardTop - keyboardClearance);
        const translateY = Math.round(Math.max(-520, Math.min(520, targetBottom - centeredBottom)));

        overlay.classList.add('keyboard-docked');
        this.setCssVariables(overlay, { '--shop-purchase-translate-y': `${translateY}px` });
        card.classList.add('shop-purchase-height-locked');
        this.setCssVariables(card, { '--shop-purchase-dock-height': `${dockHeight}px` });
        this.togglePurchaseModalSheetAnimation(card, animate);
        this.purchaseModalKeyboardDocked = bottomInset > 0;
        this.purchaseModalKeyboardLastBottomInset = Math.max(0, bottomInset);
    },

    releasePurchaseModalKeyboardDock: function (animate = false) {
        const { overlay, card } = this.getPurchaseModalElements();
        if (!overlay || !card) return;

        if (this.purchaseModalKeyboardFocusedReleaseTimer) {
            clearTimeout(this.purchaseModalKeyboardFocusedReleaseTimer);
            this.purchaseModalKeyboardFocusedReleaseTimer = null;
        }
        overlay.classList.remove('keyboard-docked');
        this.setCssVariables(overlay, { '--shop-purchase-translate-y': '0px' });
        card.classList.remove('shop-purchase-height-locked');
        this.setCssVariables(card, { '--shop-purchase-dock-height': '' });
        this.togglePurchaseModalSheetAnimation(card, animate);
        this.purchaseModalKeyboardDocked = false;
        this.purchaseModalKeyboardLastBottomInset = 0;
    },

    resetPurchaseModalKeyboardDockState: function () {
        this.clearPurchaseModalKeyboardTimers();
        if (this.purchaseModalKeyboardViewportRafId) {
            cancelAnimationFrame(this.purchaseModalKeyboardViewportRafId);
            this.purchaseModalKeyboardViewportRafId = null;
        }
        if (this.purchaseModalKeyboardContentRafId) {
            cancelAnimationFrame(this.purchaseModalKeyboardContentRafId);
            this.purchaseModalKeyboardContentRafId = null;
        }
        this.releasePurchaseModalKeyboardDock();
        this.purchaseModalKeyboardBaseViewportHeight = 0;
        this.purchaseModalKeyboardBaseVisualHeight = 0;
        this.purchaseModalKeyboardBaseCardHeight = 0;
        const { overlay } = this.getPurchaseModalElements();
        this.setCssVariables(overlay, {
            '--shop-purchase-overlay-height': '',
            '--shop-purchase-viewport-top': '',
            '--shop-purchase-viewport-left': '',
            '--shop-purchase-viewport-width': ''
        });
    },

    syncPurchaseModalKeyboardDock: function () {
        const { overlay, card } = this.getPurchaseModalElements();
        if (!overlay || !card || !overlay.classList.contains('active')) {
            this.resetPurchaseModalKeyboardDockState();
            return;
        }

        if (!this.isPurchaseModalKeyboardDockEnabled()) {
            this.releasePurchaseModalKeyboardDock();
            return;
        }

        const activeInput = this.getActivePurchaseModalInput();
        if (activeInput && !this.purchaseModalOwnsFullScrollLock) {
            this.lockPurchaseModalKeyboardPage();
        }
        const metrics = this.getPurchaseModalViewportMetrics();
        const bottomInset = metrics.bottomInset;
        const needsKeyboardDock = !!activeInput && this.shouldDockPurchaseModalForInput(activeInput, metrics);
        const shouldDock = needsKeyboardDock && (this.purchaseModalKeyboardDocked ? bottomInset > 8 : bottomInset > 24);
        const nextInset = shouldDock ? bottomInset : 0;
        const previousInset = this.purchaseModalKeyboardLastBottomInset;
        const isInsetDroppingWhileFocused = this.purchaseModalKeyboardDocked && !!activeInput && nextInset > 24 && nextInset + 24 < previousInset;

        if (!this.purchaseModalKeyboardDocked && shouldDock) {
            this.lockPurchaseModalKeyboardPage();
            this.purchaseModalKeyboardPendingInset = nextInset;
            if (!this.purchaseModalKeyboardInitialDockTimer) {
                this.purchaseModalKeyboardInitialDockTimer = setTimeout(() => {
                    this.purchaseModalKeyboardInitialDockTimer = null;
                    const liveInput = this.getActivePurchaseModalInput();
                    if (!liveInput) return;
                    const liveMetrics = this.getPurchaseModalViewportMetrics();
                    if (liveMetrics.bottomInset <= 24) return;
                    if (!this.shouldDockPurchaseModalForInput(liveInput, liveMetrics)) return;
                    this.applyPurchaseModalKeyboardDock(liveMetrics.bottomInset, true);
                }, 90);
            }
            return;
        }

        if (this.purchaseModalKeyboardInitialDockTimer && (this.purchaseModalKeyboardDocked || !shouldDock)) {
            clearTimeout(this.purchaseModalKeyboardInitialDockTimer);
            this.purchaseModalKeyboardInitialDockTimer = null;
        }

        if (this.purchaseModalKeyboardInsetDropTimer && (!isInsetDroppingWhileFocused || nextInset >= previousInset)) {
            clearTimeout(this.purchaseModalKeyboardInsetDropTimer);
            this.purchaseModalKeyboardInsetDropTimer = null;
            this.purchaseModalKeyboardPendingInset = 0;
        }

        if (isInsetDroppingWhileFocused) {
            this.purchaseModalKeyboardPendingInset = 0;
            this.applyPurchaseModalKeyboardDock(nextInset, false);
            return;
        }

        if (this.purchaseModalKeyboardDocked && activeInput && nextInset <= 24) {
            this.schedulePurchaseModalFocusedRelease();
            return;
        }

        if (nextInset > 24) {
            this.applyPurchaseModalKeyboardDock(nextInset, false);
            return;
        }

        if (this.purchaseModalKeyboardDocked) {
            this.releasePurchaseModalKeyboardDock(true);
        }
    },

    attachPurchaseModalKeyboardDock: function () {
        if (!this.isPurchaseModalKeyboardDockEnabled()) return;

        const { overlay } = this.getPurchaseModalElements();
        const vv = window.visualViewport;
        if (!overlay || !vv) return;

        this.detachPurchaseModalKeyboardDock();
        this.capturePurchaseModalKeyboardBase();
        this.syncPurchaseModalKeyboardDock();

        const inputs = Array.from(overlay.querySelectorAll('input, textarea, select'));
        inputs.forEach((input) => this.bindPurchaseModalInputFocusStabilizer(input));
        const handleViewportChange = () => {
            if (this.purchaseModalKeyboardViewportRafId) return;
            this.purchaseModalKeyboardViewportRafId = requestAnimationFrame(() => {
                this.purchaseModalKeyboardViewportRafId = null;
                this.stabilizePurchaseModalViewport();
                this.capturePurchaseModalOverlayHeight();
                this.syncPurchaseModalKeyboardDock();
            });
        };

        vv.addEventListener('resize', handleViewportChange, { passive: true });
        vv.addEventListener('scroll', handleViewportChange, { passive: true });
        window.addEventListener('resize', handleViewportChange, { passive: true });
        window.addEventListener('orientationchange', handleViewportChange, { passive: true });
        inputs.forEach((input) => {
            input.addEventListener('focus', handleViewportChange);
            input.addEventListener('blur', handleViewportChange);
        });

        this.purchaseModalKeyboardViewportCleanup = () => {
            vv.removeEventListener('resize', handleViewportChange);
            vv.removeEventListener('scroll', handleViewportChange);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('orientationchange', handleViewportChange);
            inputs.forEach((input) => {
                input.removeEventListener('focus', handleViewportChange);
                input.removeEventListener('blur', handleViewportChange);
            });
            if (this.purchaseModalKeyboardViewportRafId) {
                cancelAnimationFrame(this.purchaseModalKeyboardViewportRafId);
                this.purchaseModalKeyboardViewportRafId = null;
            }
            this.purchaseModalKeyboardViewportCleanup = null;
        };
    },

    detachPurchaseModalKeyboardDock: function () {
        if (typeof this.purchaseModalKeyboardViewportCleanup === 'function') {
            this.purchaseModalKeyboardViewportCleanup();
        }
        this.clearPurchaseModalKeyboardTimers();
    },

    // ---- New Purchase Flow via Modal ----

    syncPurchaseAccessAfterOpen: async function (productId, quantityCap) {
        try {
            const purchaseAccess = await this.loadCurrentUserPurchaseAccess();
            if (this.currentPurchase?.productId !== productId) return;

            this.currentPurchase.unlimitedPurchases = purchaseAccess.unlimitedShopPurchases === true;
            this.setCurrentPurchaseQuantityCap(quantityCap, {
                unlimited: this.currentPurchase.unlimitedPurchases
            });
        } catch (error) {
            console.warn('Failed to sync purchase access after opening modal:', error);
        }
    },

    buyProduct: async function (productId, productName, productNameEn, price, rulesStr, maxPurchaseQuantity = 99, showPurchaseNotes = false, purchaseNotesEncoded = '', showUsageInstructions = false, usageInstructionsEncoded = '', productCategory = '', sourceContext = null, options = {}) {
        const rules = rulesStr ? JSON.parse(decodeURIComponent(rulesStr)) : [];
        let purchaseNotes = showPurchaseNotes ? decodeURIComponent(purchaseNotesEncoded || '') : '';
        let usageInstructions = showUsageInstructions ? decodeURIComponent(usageInstructionsEncoded || '') : '';
        const liveProduct = this.getCachedProductById(productId);
        const quantityCap = this.getPurchaseQuantityCapForProduct(liveProduct, maxPurchaseQuantity);
        const initialQuantity = Math.max(1, Math.min(quantityCap, Math.trunc(Number(options?.initialQuantity || 1) || 1)));

        void this.prefetchDiscountAssetsForProduct({
            productId,
            quantity: initialQuantity,
            agentId: this.currentAgentId,
            site: window.SiteConfig?.site || 'cn'
        });
        this.openPurchaseModal(productId, productName, productNameEn, price, rules, quantityCap, purchaseNotes, usageInstructions, {
            category: productCategory,
            sourceContext,
            initialQuantity
        });
        void this.refreshCurrentPurchaseGuidance(productId);
        void this.syncPurchaseAccessAfterOpen(productId, quantityCap);
    },

    openPurchaseModal: function (productId, productName, productNameEn, price, rules, maxPurchaseQuantity = 99, purchaseNotes = '', usageInstructions = '', options = {}) {
        const quantityCap = this.normalizePurchaseQuantityCap(maxPurchaseQuantity);
        const unlimitedPurchases = options?.unlimitedPurchases === true;
        const initialQuantity = Math.max(1, Math.min(quantityCap, Math.trunc(Number(options?.initialQuantity || 1) || 1)));
        const liveProductForPricing = this.getCachedProductById(productId);
        const flashSalePricing = this.getActiveFlashSalePricingContext(liveProductForPricing, price);
        const effectivePrice = Math.max(0, Number(flashSalePricing.hasFlashSale ? flashSalePricing.flashSalePrice : price) || 0);
        void this.prefetchDiscountAssetsForProduct({
            productId,
            quantity: initialQuantity,
            agentId: this.currentAgentId,
            site: window.SiteConfig?.site || 'cn'
        });
        const storedPurchasePrefill = this.consumePurchasePrefillForProduct(productId);
        const cachedDiscountAssetsPayload = this.readDiscountAssetsCache(this.buildDiscountAssetsCacheKey({
            productId,
            quantity: initialQuantity,
            agentId: this.currentAgentId,
            site: window.SiteConfig?.site || 'cn'
        }));
        const runtimeCartDiscount = this.normalizeCartDiscountSnapshot(options?.appliedDiscount || null, {
            quantity: initialQuantity,
            subtotal: Number(price || 0) * initialQuantity
        });
        const runtimePurchasePrefill = this.buildPurchasePrefillFromCartDiscountSnapshot(runtimeCartDiscount, {
            productId,
            category: String(options?.category || options?.productCategory || '').trim() || null
        });
        const prefilledOwnedDiscounts = [
            ...(Array.isArray(runtimePurchasePrefill?.ownedDiscounts) ? runtimePurchasePrefill.ownedDiscounts : []),
            ...(Array.isArray(storedPurchasePrefill?.ownedDiscounts) ? storedPurchasePrefill.ownedDiscounts : []),
            ...(Array.isArray(cachedDiscountAssetsPayload?.owned_discounts) ? cachedDiscountAssetsPayload.owned_discounts : [])
        ].filter((item, index, list) => {
            const currentKey = [
                String(item?.asset_id || '').trim(),
                String(item?.code || '').trim().toUpperCase()
            ].join('::');
            return list.findIndex((candidate) => [
                String(candidate?.asset_id || '').trim(),
                String(candidate?.code || '').trim().toUpperCase()
            ].join('::') === currentKey) === index;
        });
        const prefilledClaimableDiscounts = [
            ...(Array.isArray(runtimePurchasePrefill?.claimableDiscounts) ? runtimePurchasePrefill.claimableDiscounts : []),
            ...(Array.isArray(storedPurchasePrefill?.claimableDiscounts) ? storedPurchasePrefill.claimableDiscounts : []),
            ...(Array.isArray(cachedDiscountAssetsPayload?.claimable_discounts) ? cachedDiscountAssetsPayload.claimable_discounts : [])
        ].filter((item, index, list) => {
            const currentKey = [
                String(item?.discount_id || '').trim(),
                String(item?.code || '').trim().toUpperCase()
            ].join('::');
            return list.findIndex((candidate) => [
                String(candidate?.discount_id || '').trim(),
                String(candidate?.code || '').trim().toUpperCase()
            ].join('::') === currentKey) === index;
        });
        const hasImmediateVisibleDiscountData = Boolean(cachedDiscountAssetsPayload)
            || prefilledOwnedDiscounts.some((item) => item?.available !== false)
            || prefilledClaimableDiscounts.length > 0;
        const sourceContext = {
            ...resolveShopSourceContext(),
            ...(options?.sourceContext && typeof options.sourceContext === 'object' ? options.sourceContext : {})
        };
        this.currentPurchase = {
            productId,
            productName,
            productNameEn,
            productCategory: String(options?.category || options?.productCategory || '').trim() || null,
            basePrice: effectivePrice,
            unitPrice: effectivePrice,
            hasFlashSale: flashSalePricing.hasFlashSale,
            flashSalePrice: flashSalePricing.flashSalePrice,
            flashSaleOriginalPrice: flashSalePricing.flashSaleOriginalPrice,
            quantity: initialQuantity,
            orderId: null,
            createdAt: null,
            rules: rules,
            selectedDiscounts: [],
            appliedDiscounts: [],
            discountCode: null,
            discountAssetId: null,
            discountType: null,
            discountValue: null,
            discountBenefitLabel: '',
            discountAmount: 0,
            discountFinalTotal: null,
            pricingWaterfall: [],
            stackingPolicy: this.getDefaultStackingPolicy(),
            availableDiscountAssets: prefilledOwnedDiscounts,
            claimableDiscounts: prefilledClaimableDiscounts,
            discountAssetsLoading: !hasImmediateVisibleDiscountData,
            discountPreviewRevision: 0,
            stage: 'configure',
            purchaseNotes: typeof purchaseNotes === 'string' ? purchaseNotes.trim() : '',
            purchaseNotesExpanded: false,
            usageInstructions: typeof usageInstructions === 'string' ? usageInstructions.trim() : '',
            sourcePage: normalizeShopTrackingText(sourceContext.sourcePage || '', 80) || null,
            sourceChannel: normalizeShopTrackingText(sourceContext.sourceChannel || '', 80) || null,
            sourcePromptId: normalizeShopTrackingText(sourceContext.sourcePromptId || '', 160) || null,
            cartOrigin: options?.cartOrigin && typeof options.cartOrigin === 'object'
                ? {
                    productId: String(options.cartOrigin.productId || productId || '').trim() || null
                }
                : null,
            configuredMaxQuantity: quantityCap,
            unlimitedPurchases,
            maxQuantity: unlimitedPurchases ? null : quantityCap,
            idempotencyKey: this.createPurchaseIdempotencyKey()
        };
        this.pendingClaimDiscountIds = new Set();
        this.purchaseModalBaseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
        this.purchaseModalOwnsFullScrollLock = false;

        // Update UI - show name based on current language
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && productNameEn) ? productNameEn : productName;
        this.renderModalProductName(displayName);
        this.renderPurchaseUnitPrice(effectivePrice);
        document.getElementById('modalTotalPrice').textContent = this.formatShopPointValue(effectivePrice * initialQuantity);
        const quantityInput = document.getElementById('purchaseQuantity');
        if (quantityInput) {
            quantityInput.value = initialQuantity;
        }
        this.setCurrentPurchaseQuantityCap(quantityCap, { unlimited: unlimitedPurchases });

        // Reset Discount UI
        const discountInput = document.getElementById('purchaseDiscountCode');
        const applyBtn = document.getElementById('applyDiscountBtn');
        if (discountInput) discountInput.value = '';
        this.setDiscountMessage('');
        this.renderPurchaseDiscountAssets();
        this.updatePriceForQuantity(initialQuantity);
        if (runtimeCartDiscount) {
            this.applyDiscountPreviewState({
                discount_code: runtimeCartDiscount.code || '',
                discount_type: runtimeCartDiscount.discountType,
                discount_value: runtimeCartDiscount.discountValue,
                benefit_label: runtimeCartDiscount.benefitLabel || '',
                subtotal: runtimeCartDiscount.subtotal,
                discount_amount: runtimeCartDiscount.discountAmount,
                final_total: runtimeCartDiscount.finalTotal,
                applied_discounts: Array.isArray(runtimeCartDiscount.selections)
                    ? runtimeCartDiscount.selections.map((selection) => ({
                        discount_code: selection.code || '',
                        discount_asset_id: selection.assetId || null,
                        discount_type: selection.discountType,
                        discount_value: selection.discountValue,
                        benefit_label: selection.benefitLabel || '',
                        discount_amount: selection.discountAmount,
                        final_total_after_apply: selection.finalTotalAfterApply
                    }))
                    : []
            }, {
                selectionSnapshot: runtimeCartDiscount.selections || []
            });
        }
        if (applyBtn) {
            applyBtn.innerHTML = window.i18n?.t('shop.verify') || '验证';
            applyBtn.disabled = false;
        }

        const modal = document.getElementById('shopPurchaseModal');
        modal.classList.remove('shop-purchase-force-hidden');
        modal.hidden = false;
        modal.classList.remove('active');
        this.freezePurchaseModalPage();
        this.capturePurchaseModalOverlayHeight(true);
        if (!this.purchaseModalPageFrozen && window.iOSScrollLock) {
            window.iOSScrollLock.lockLight(modal, {
                restoreScrollDuringViewport: true
            });
        }
        this.renderPurchaseNotes();
        this.renderPurchaseConfirmationStage();
        this.setPurchaseStage('configure');
        this.bindPurchaseModalControlTapFallbacks();

        // Flush the inactive layout first so newly revealed notes can join the stagger animation on first open.
        void modal.offsetHeight;

        // Show Modal
        this.setPurchaseModalLayerOpen(true);
        modal.classList.add('active');
        this.attachPurchaseModalViewportSync();
        this.attachPurchaseModalKeyboardDock();
        this.schedulePurchaseModalOpenViewportStabilization();
        void this.refreshPurchaseDiscountAssets({ silent: true });
        if (runtimeCartDiscount) {
            void this.refreshAppliedDiscountPreview({ silent: true });
        }

        trackShopAnalyticsEvent('shop_view', {
            entityId: String(productId || '').trim() || null,
            eventValue: Number(effectivePrice || 0) || null,
            metadata: buildShopTrackingMetadata({
                product_id: String(productId || '').trim() || null,
                product_name: productName || null,
                product_name_en: productNameEn || null,
                category: String(options?.category || options?.productCategory || '').trim() || null,
                unit_price: Number(effectivePrice || 0) || null,
                max_purchase_quantity: quantityCap,
                has_purchase_notes: Boolean(purchaseNotes),
                has_usage_instructions: Boolean(usageInstructions)
            }, sourceContext)
        }, {
            eventType: 'engagement'
        });

        trackShopAnalyticsEvent('product_detail_view', {
            entityId: String(productId || '').trim() || null,
            eventValue: Number(effectivePrice || 0) || null,
            metadata: buildShopTrackingMetadata({
                product_id: String(productId || '').trim() || null,
                product_name: productName || null,
                product_name_en: productNameEn || null,
                category: String(options?.category || options?.productCategory || '').trim() || null,
                unit_price: Number(effectivePrice || 0) || null,
                max_purchase_quantity: quantityCap,
                has_purchase_notes: Boolean(purchaseNotes),
                has_usage_instructions: Boolean(usageInstructions)
            }, sourceContext)
        }, {
            eventType: 'engagement'
        });
    },

    closePurchaseModal: function () {
        const modal = document.getElementById('shopPurchaseModal');
        if (!modal) return;
        const activeInput = this.getActivePurchaseModalInput();
        activeInput?.blur();
        this.runShopModalCloseChromeCleanup({
            targets: [modal],
            forceHiddenClass: 'shop-purchase-force-hidden',
            restoreDelayMs: 320
        });
        modal.classList.add('shop-purchase-force-hidden');
        modal.hidden = true;
        modal.classList.remove('active');
        void modal.offsetHeight;
        this.setPurchaseModalLayerOpen(false);
        this.clearPurchaseNotesWheelIsolation();
        this.clearPurchaseNotesHeightAnimation();
        this.detachPurchaseModalViewportSync();
        this.detachPurchaseModalKeyboardDock();
        this.resetPurchaseModalKeyboardDockState();
        modal.classList.remove('has-purchase-notes');
        modal.classList.remove('has-purchase-notes-expanded');
        // Unlock background scroll on mobile Safari
        if (this.purchaseModalPageFrozen) {
            this.unfreezePurchaseModalPage();
        } else if (window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        }
        this.purchaseModalOwnsFullScrollLock = false;
        this.purchaseModalBaseScrollY = 0;
    },

    updatePriceForQuantity: function (qty) {
        let unitPrice = this.currentPurchase.basePrice;
        if (!this.currentPurchase.hasFlashSale) {
            const tieredPricing = this.getTieredPricingContext({
                basePrice: this.currentPurchase.basePrice,
                rules: this.currentPurchase.rules,
                quantity: qty
            });
            if (tieredPricing?.activeRule) {
                unitPrice = tieredPricing.activeRule.price;
            }
        }
        this.currentPurchase.unitPrice = unitPrice;

        // Show wholesale UI feedback dynamically
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && this.currentPurchase.productNameEn) ? this.currentPurchase.productNameEn : this.currentPurchase.productName;

        this.renderModalProductName(displayName, { wholesale: unitPrice < this.currentPurchase.basePrice });

        this.renderPurchaseUnitPrice(unitPrice);

        let total = qty * unitPrice;

        if (this.getCurrentPurchaseSelectedDiscounts().length) {
            this.currentPurchase.discountAmount = 0;
            this.currentPurchase.discountFinalTotal = null;
            document.getElementById('modalTotalPrice').textContent = this.formatShopPointValue(total);
            this.setDiscountMessage(
                '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>正在重算当前优惠...</span>',
                { variant: 'info', html: true }
            );
            this.syncPricingWaterfall();
            void this.refreshAppliedDiscountPreview({ silent: true });
        } else {
            document.getElementById('modalTotalPrice').textContent = this.formatShopPointValue(total);
            this.syncPricingWaterfall();
        }

        void this.refreshPurchaseDiscountAssets({ silent: true });

        return total;
    },

    applyDiscount: async function (silent = false) {
        const codeInputElem = document.getElementById('purchaseDiscountCode');
        const codeInput = codeInputElem ? codeInputElem.value.trim() : '';
        const applyBtn = document.getElementById('applyDiscountBtn');
        const currentSelections = this.getCurrentPurchaseSelectedDiscounts();
        const assetSelections = currentSelections.filter((selection) => selection.assetId);

        if (!codeInput) {
            if (!silent) {
                this.setDiscountMessage(window.i18n?.t('shop.enterDiscountCode') || '请输入优惠码', { variant: 'error' });
            }
            if (assetSelections.length) {
                this.syncCurrentPurchaseDiscountSelectionState(assetSelections);
                void this.refreshAppliedDiscountPreview({ silent: true });
            } else {
                this.resetDiscountState({ clearMessage: false });
            }
            return;
        }

        if (applyBtn && !silent) {
            applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            applyBtn.disabled = true;
        }

        try {
            const nextSelections = [
                ...assetSelections,
                {
                    code: codeInput
                }
            ];
            const validationPayload = await this.validateDiscountSelectionsWithServer(nextSelections, {
                discountCode: codeInput
            });
            this.applyDiscountPreviewState(validationPayload?.data || {}, {
                selectionSnapshot: nextSelections
            });

        } catch (err) {
            if (assetSelections.length && this.isExclusiveDiscountStackingConflict(err)) {
                try {
                    await this.applyExclusiveReplacementSelection({
                        code: codeInput
                    }, {
                        conflictMessage: err?.message || ''
                    });
                    return;
                } catch (replacementError) {
                    err = replacementError;
                }
            }
            if (!silent) {
                this.setDiscountMessage(
                    `<i class="fas fa-times-circle" aria-hidden="true"></i><span>${this.escapeHtml(err.message || (window.i18n?.t('shop.verifyFailed') || '验证失败'))}</span>`,
                    { variant: 'error', html: true }
                );
            }
        } finally {
            if (applyBtn && !silent) {
                applyBtn.innerHTML = window.i18n?.t('shop.verify') || '验证';
                applyBtn.disabled = false;
            }
        }
    },

    adjustQuantity: function (delta) {
        const quantityCap = this.getCurrentPurchaseQuantityCap();
        let newQty = this.currentPurchase.quantity + delta;
        if (newQty < 1) newQty = 1;
        if (newQty > quantityCap) newQty = quantityCap;

        this.currentPurchase.quantity = newQty;
        document.getElementById('purchaseQuantity').value = newQty;

        // Update Total
        this.updatePriceForQuantity(newQty);
    },

    // Handle direct keyboard input
    onQuantityInput: function (input) {
        const quantityCap = this.getCurrentPurchaseQuantityCap();
        let val = parseInt(input.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > quantityCap) val = quantityCap;

        this.currentPurchase.quantity = val;
        input.value = String(val);
        // Update Total
        this.updatePriceForQuantity(val);
    },

    buildCartSuccessPayload: function (results = []) {
        const contentSegments = [];
        const usageSegments = [];
        const orderIds = [];
        const items = [];
        let remainingPoints = null;

        results.forEach(({ entry, response }) => {
            const responseData = response?.data && typeof response.data === 'object' ? response.data : {};
            const displayName = entry?.displayName || this.getLocalizedProductName(entry?.product) || (window.i18n?.t('shop.unknownProduct') || '商品');
            const rawContent = String(responseData.content || '').trim();
            const rawUsageInstructions = String(
                responseData.usage_instructions
                || this.getLocalizedProductGuidanceText(entry?.product, 'usage_instructions')
                || ''
            ).trim();
            const orderId = String(responseData.order_id || '').trim();

            if (orderId) {
                orderIds.push(orderId);
            }
            if (responseData.remaining_points != null) {
                remainingPoints = responseData.remaining_points;
            }

            items.push(this.buildSuccessModalItemPayload({
                productId: entry?.productId,
                displayName,
                orderId,
                createdAt: String(responseData.created_at || '').trim() || new Date().toISOString(),
                quantity: Number(entry?.quantity || 0) || 1,
                content: rawContent,
                purchaseNotes: entry?.product?.show_purchase_notes === true
                    ? this.getLocalizedProductGuidanceText(entry?.product, 'purchase_notes')
                    : '',
                usageInstructions: rawUsageInstructions,
                product: entry?.product || null
            }));

            if (rawContent) {
                rawContent
                    .split(/\n----\n/)
                    .map((segment) => String(segment || '').trim())
                    .filter(Boolean)
                    .forEach((segment) => {
                        contentSegments.push(`【${displayName}】\n${segment}`);
                    });
            }

            if (rawUsageInstructions) {
                const safeTitle = this.escapeHtml(displayName);
                const safeBody = this.looksLikeRichTextHtml(rawUsageInstructions)
                    ? this.sanitizeRichTextHtml(rawUsageInstructions)
                    : this.linkifyText(this.escapeHtml(rawUsageInstructions)).replace(/\n/g, '<br>');
                usageSegments.push(`<div><strong>${safeTitle}</strong></div><div>${safeBody}</div>`);
            }
        });

        return {
            content: contentSegments.join('\n----\n') || (window.i18n?.t('shop.noContent') || '（无内容）'),
            usageInstructions: usageSegments.join('<br><br>'),
            orderIds,
            remainingPoints,
            items
        };
    },

    confirmCartCheckout: async function () {
        if (this.cartCheckoutProcessing) return;

        const entries = this.getCartEntries();
        if (!entries.length) {
            this.showShopToast(this.getCartCopy().cartEmptyToast, 'error');
            this.closeCartCheckoutModal();
            return;
        }

        this.cartCheckoutProcessing = true;
        this.renderCartCheckoutModal();
        this.renderCart();

        const token = await this.getAccessToken();
        if (!token) {
            this.cartCheckoutProcessing = false;
            this.renderCartCheckoutModal();
            this.renderCart();
            this.promptLoginForPurchase(window.i18n?.t('shop.loginRequired') || '请先登录再进行兑换');
            return;
        }

        const checkoutCopy = this.getCartCopy();
        const successes = [];
        let checkoutError = null;
        let failedEntry = null;

        try {
            for (const entry of entries) {
                const response = await this.requestPurchasePayloadWithServer({
                    productId: entry.productId,
                    quantity: entry.quantity,
                    discountCode: entry.appliedDiscount?.code || null,
                    discountAssetId: entry.appliedDiscount?.assetId || null,
                    discountSelections: Array.isArray(entry.appliedDiscount?.selections)
                        ? entry.appliedDiscount.selections.map((selection) => ({
                            code: selection.code || null,
                            assetId: selection.assetId || null
                        }))
                        : [],
                    agentId: this.currentAgentId,
                    site: window.SiteConfig?.site || 'cn',
                    idempotencyKey: this.createPurchaseIdempotencyKey()
                }, token);

                successes.push({ entry, response });
            }
        } catch (error) {
            checkoutError = error;
            failedEntry = entries[successes.length] || null;
        }

        if (successes.length > 0) {
            successes.forEach(({ entry }) => {
                const normalizedId = String(entry.productId || '').trim();
                const nextQuantity = this.getCartQuantity(normalizedId) - Math.max(1, Number(entry.quantity || 0) || 1);
                if (nextQuantity < 1) {
                    this.cartItems.delete(normalizedId);
                    delete this.cartSnapshots[normalizedId];
                } else {
                    this.cartItems.set(normalizedId, nextQuantity);
                }
            });

            const successPayload = this.buildCartSuccessPayload(successes);
            const warningMessage = checkoutError
                ? `${checkoutCopy.partialWarningPrefix}${failedEntry ? ` ${failedEntry.displayName}：` : ' '}${checkoutError.message || ''}`.trim()
                : null;
            const refreshProductsPromise = this.loadProducts({ forceRefresh: true }).catch((error) => {
                console.warn('Failed to refresh shop products after cart checkout:', error);
            });
            const latestCreatedAt = successPayload.items.reduce((latest, item) => {
                const candidate = String(item?.createdAt || '').trim();
                return candidate || latest;
            }, '');

            this.currentPurchase = {
                ...this.currentPurchase,
                productId: null,
                productName: checkoutCopy.cartCheckoutLabel,
                productNameEn: 'Cart checkout',
                orderId: successPayload.orderIds.join(', '),
                createdAt: latestCreatedAt || new Date().toISOString(),
                quantity: successes.reduce((total, item) => total + (Number(item.entry?.quantity || 0) || 0), 0),
                selectedDiscounts: [],
                appliedDiscounts: [],
                purchaseNotes: '',
                usageInstructions: successPayload.usageInstructions || '',
                cartOrigin: null
            };

            this.closeCartCheckoutModal();
            this.setCartOpen(false);
            this.clearCartAbandonEngagementTimer();
            this.renderCart();
            this.showSuccessModal(successPayload.content, warningMessage, successPayload.usageInstructions, successPayload.items);
            this.triggerShopOrderEngagement('order_delivered', {
                source_event_id: `shop_cart_order_delivered:${successPayload.orderIds.join(',')}`,
                source: 'cart_checkout_success',
                order_ids: successPayload.orderIds,
                item_count: successPayload.items.length,
                total_quantity: successes.reduce((total, item) => total + (Number(item.entry?.quantity || 0) || 0), 0),
                remaining_points: successPayload.remainingPoints ?? null
            });

            if (window.updateUserPointsUI && successPayload.remainingPoints != null) {
                window.updateUserPointsUI(successPayload.remainingPoints);
                if (window.checkAuthState) window.checkAuthState();
            }
            await refreshProductsPromise;
            return;
        }

        this.cartCheckoutProcessing = false;
        this.renderCartCheckoutModal();
        this.renderCart();

        const errorMessage = checkoutError?.message || (window.i18n?.t('shop.redeemFailed') || '兑换失败');
        if (errorMessage.includes('积分') || errorMessage.includes('余额') || errorMessage.includes('nsufficient') || errorMessage.includes('balance')) {
            this.closeCartCheckoutModal();
            this.showShopToast(window.i18n?.t('shop.insufficientPoints') || '积分不足，请先充值', 'error');
            const rechargeReturnContext = this.buildShopRechargeReturnContext('cart', {
                source: 'cart_checkout_insufficient_points',
                checkout: true
            });
            const fallbackEngagement = {
                id: 'shop_cart_insufficient_points',
                source: 'client_event',
                source_module: 'shop',
                source_event_id: 'shop_cart_insufficient_points',
                page_id: 'shop',
                site: window.SiteConfig?.site || 'cn',
                title: '积分不足',
                content: '购物车结算需要更多积分，可以先去钱包充值后再回来下单。',
                action_label: '去充值',
                action_url: 'wallet://recharge',
                tone: 'warning',
                priority: 70,
                dismiss_ttl_hours: 2,
                metadata: {
                    event_type: 'points_insufficient',
                    source: 'cart_checkout',
                    ...rechargeReturnContext
                }
            };
            const triggeredEngagement = window.ZaoyoeEngagement?.trigger?.('points_insufficient', {
                source_module: 'shop',
                source_event_id: 'shop_cart_insufficient_points',
                source: 'cart_checkout',
                ...rechargeReturnContext
            });
            if (triggeredEngagement && typeof triggeredEngagement.then === 'function') {
                triggeredEngagement.then((shown) => {
                    if (!shown) window.ZaoyoeEngagement?.show?.(fallbackEngagement);
                }).catch(() => window.ZaoyoeEngagement?.show?.(fallbackEngagement));
            } else {
                window.ZaoyoeEngagement?.show?.(fallbackEngagement);
            }
            setTimeout(() => {
                void openShopWalletModal('recharge', {
                    entry: 'shop_cart_insufficient_points',
                    sourceModule: 'shop_client',
                    ...rechargeReturnContext
                });
            }, 300);
            return;
        }

        if (this.isInventoryStockErrorMessage(errorMessage)) {
            void this.refreshProductsAfterInventoryFailure();
        }
        this.showShopToast(`❌ ${errorMessage}`, 'error');
    },

    confirmPurchase: async function ({ triggerButton = null } = {}) {
        if (this.purchaseProcessing) return;

        // Disable button
        const btn = this.resolvePurchaseActionButton(triggerButton);
        const backBtn = document.getElementById('purchaseBackBtn');
        if (!btn) {
            return;
        }
        const originalText = btn.innerHTML;
        const processingText = window.i18n?.t('shop.processing') || '处理中...';
        const restoreIdleButtonState = () => {
            this.purchaseProcessing = false;
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (backBtn) {
                backBtn.disabled = false;
            }
        };
        this.purchaseProcessing = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${processingText}</span>`;
        btn.disabled = true;
        if (backBtn) {
            backBtn.disabled = true;
        }

        try {
            await new Promise((resolve) => {
                window.requestAnimationFrame(() => resolve());
            });

            const shouldContinueAfterCouponSync = await this.waitForPurchaseDiscountAssetsBeforeSubmit();
            if (!shouldContinueAfterCouponSync) {
                restoreIdleButtonState();
                return;
            }

            const token = await this.getAccessToken();
            if (!token) {
                restoreIdleButtonState();
                this.promptLoginForPurchase(window.i18n?.t('shop.loginRequired') || '请先登录再进行兑换');
                return;
            }

            const { subtotal, discountAmount, finalTotal } = this.getCurrentPurchasePricingSummary();
            const tentativeTotalPoints = finalTotal || null;
            const purchaseSourceContext = {
                sourcePage: this.currentPurchase?.sourcePage || null,
                sourceChannel: this.currentPurchase?.sourceChannel || null,
                sourcePromptId: this.currentPurchase?.sourcePromptId || null
            };
            trackShopAnalyticsEvent('product_purchase_click', {
                entityId: String(this.currentPurchase?.productId || '').trim() || null,
                eventValue: tentativeTotalPoints,
                metadata: buildShopTrackingMetadata({
                    product_id: String(this.currentPurchase?.productId || '').trim() || null,
                    product_name: this.currentPurchase?.productName || null,
                    product_name_en: this.currentPurchase?.productNameEn || null,
                    category: this.currentPurchase?.productCategory || null,
                    quantity: Number(this.currentPurchase?.quantity || 0) || 1,
                    unit_price: Number(this.currentPurchase?.unitPrice || 0) || null,
                    subtotal_points: subtotal || null,
                    discount_code: this.currentPurchase?.discountCode || null,
                    discount_amount: discountAmount || null,
                    total_points: tentativeTotalPoints
                }, purchaseSourceContext)
            }, {
                eventType: 'conversion',
                dedupeKey: String(this.currentPurchase?.idempotencyKey || '').trim()
                    ? `product_purchase_click:${String(this.currentPurchase.idempotencyKey).trim()}`
                    : ''
            });

            const data = await this.purchaseWithServer(token);
            const purchaseData = data.data;
            let allContents = [];
            if (purchaseData.content) {
                // The new backend returns newline separated contents
                allContents = purchaseData.content.split('\n----\n');
            }
            let lastOrderId = purchaseData.order_id;
            let createdAt = String(purchaseData.created_at || '').trim() || new Date().toISOString();
            let remainingPoints = purchaseData.remaining_points;
            let usageInstructions = purchaseData.usage_instructions || this.currentPurchase?.usageInstructions || null;

            // Success
            const finalContent = allContents.length > 0
                ? allContents.join('\n----\n')
                : (window.i18n?.t('shop.noContent') || '（无内容）');
            const cartOriginProductId = String(this.currentPurchase?.cartOrigin?.productId || '').trim();
            const cartPurchasedQuantity = Math.max(1, Number(this.currentPurchase?.quantity || 0) || 1);
            const purchasedProduct = this.getCachedProductById(this.currentPurchase?.productId);
            const purchasedProductSnapshot = purchasedProduct
                ? this.buildCartProductSnapshot(purchasedProduct, {
                    unitPrice: this.currentPurchase?.unitPrice
                })
                : null;

            // Store order ID for export
            this.currentPurchase.orderId = lastOrderId;
            this.currentPurchase.createdAt = createdAt;
            this.currentPurchase.idempotencyKey = null;

            const totalPointsSpent = Math.max(
                0,
                Number(
                    purchaseData.total_price
                    ?? purchaseData.price_paid
                    ?? purchaseData.points_paid
                    ?? (subtotal - discountAmount)
                ) || 0
            );
            const purchasedProductId = String(this.currentPurchase?.productId || '').trim() || null;
            const purchasedProductName = this.currentPurchase?.productName || null;
            const purchasedProductNameEn = this.currentPurchase?.productNameEn || null;
            const purchasedProductCategory = this.currentPurchase?.productCategory || null;
            const purchasedQuantity = Number(this.currentPurchase?.quantity || 0) || 1;
            const purchasedUnitPrice = Number(this.currentPurchase?.unitPrice || 0) || null;
            const purchasedDiscountCode = this.currentPurchase?.discountCode || null;

            // Handle Results
            this.closePurchaseModal();
            if (cartOriginProductId) {
                const remainingCartQuantity = this.getCartQuantity(cartOriginProductId) - cartPurchasedQuantity;
                if (remainingCartQuantity < 1) {
                    this.cartItems.delete(cartOriginProductId);
                    delete this.cartSnapshots[cartOriginProductId];
                } else {
                    this.cartItems.set(cartOriginProductId, remainingCartQuantity);
                }
                this.renderCart();
            }

            const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
            const successItems = [
                this.buildSuccessModalItemPayload({
                    productId: purchasedProductId,
                    displayName: currentLang === 'en'
                        ? (purchasedProductNameEn || purchasedProductName || '')
                        : (purchasedProductName || purchasedProductNameEn || ''),
                    orderId: lastOrderId,
                    createdAt,
                    quantity: purchasedQuantity,
                    content: finalContent,
                    purchaseNotes: this.currentPurchase?.purchaseNotes || '',
                    usageInstructions,
                    product: purchasedProductSnapshot || purchasedProduct
                })
            ];

            this.showSuccessModal(finalContent, null, usageInstructions, successItems);
            this.purchaseProcessing = false;

            // Update Points UI
            if (window.updateUserPointsUI && remainingPoints != null) {
                window.updateUserPointsUI(remainingPoints);
                if (window.checkAuthState) window.checkAuthState();
            }
            window.setTimeout(() => {
                const purchaseSuccessMetadata = buildShopTrackingMetadata({
                    order_id: String(lastOrderId || '').trim() || null,
                    product_id: purchasedProductId,
                    product_name: purchasedProductName,
                    product_name_en: purchasedProductNameEn,
                    category: purchasedProductCategory,
                    quantity: purchasedQuantity,
                    unit_price: purchasedUnitPrice,
                    subtotal_points: subtotal || null,
                    discount_code: purchasedDiscountCode,
                    discount_amount: discountAmount || null,
                    total_points: totalPointsSpent || null,
                    has_usage_instructions: Boolean(usageInstructions)
                }, purchaseSourceContext);

                trackShopAnalyticsEvent('product_purchase_success', {
                    entityType: 'shop_order',
                    entityId: String(lastOrderId || purchasedProductId || '').trim() || null,
                    eventValue: totalPointsSpent || null,
                    pointsDelta: totalPointsSpent > 0 ? -Math.abs(totalPointsSpent) : null,
                    metadata: purchaseSuccessMetadata
                }, {
                    eventType: 'conversion',
                    dedupeKey: String(lastOrderId || '').trim()
                        ? `product_purchase_success:${String(lastOrderId).trim()}`
                        : ''
                });
                trackShopAnalyticsEvent('shop_purchase', {
                    entityType: 'shop_order',
                    entityId: String(lastOrderId || purchasedProductId || '').trim() || null,
                    eventValue: totalPointsSpent || null,
                    pointsDelta: totalPointsSpent > 0 ? -Math.abs(totalPointsSpent) : null,
                    metadata: purchaseSuccessMetadata
                }, {
                    eventType: 'conversion',
                    dedupeKey: String(lastOrderId || '').trim() ? `shop_purchase:${String(lastOrderId).trim()}` : ''
                });
                this.triggerShopOrderEngagement('order_delivered', {
                    source_event_id: `shop_order_delivered:${String(lastOrderId || purchasedProductId || 'unknown').trim()}`,
                    source: 'product_purchase_success',
                    order_id: lastOrderId || null,
                    product_id: purchasedProductId,
                    product_name: purchasedProductName,
                    quantity: purchasedQuantity,
                    total_points: totalPointsSpent || null,
                    remaining_points: remainingPoints ?? null
                });
                void this.loadProducts({ forceRefresh: true }).catch((error) => {
                    console.warn('Failed to refresh shop products after purchase:', error);
                });
            }, 0);
            return;

        } catch (err) {
            console.error(err);
            const errMsg = (err.message || (window.i18n?.t('shop.unknownError') || '未知错误'));
            const isDuplicateSubmission = err?.code === 'duplicate_submission';

            // If insufficient points, show toast and open wallet for recharging
            if (errMsg.includes('积分') || errMsg.includes('余额') || errMsg.includes('nsufficient') || errMsg.includes('balance')) {
                this.closePurchaseModal();
                // Show a visible toast notification instead of native alert
                this.showShopToast(`❌ ${window.i18n?.t('shop.insufficientPoints') || '积分不足，请先充值'}`, 'error');
                const rechargeReturnContext = this.buildShopRechargeReturnContext('product_purchase', {
                    productId: this.currentPurchase?.productId,
                    quantity: this.currentPurchase?.quantity,
                    source: 'product_purchase_insufficient_points'
                });
                const fallbackEngagement = {
                    id: 'shop_insufficient_points',
                    source: 'client_event',
                    source_module: 'shop',
                    source_event_id: 'shop_insufficient_points',
                    page_id: 'shop',
                    site: window.SiteConfig?.site || 'cn',
                title: '积分不足',
                content: '这件商品需要更多积分，可以先充值，完成后回到商城继续购买。',
                action_label: '去充值',
                action_url: 'wallet://recharge',
                tone: 'warning',
                    priority: 70,
                    dismiss_ttl_hours: 2,
                    metadata: {
                        event_type: 'points_insufficient',
                        product_id: this.currentPurchase?.productId || null,
                        ...rechargeReturnContext
                    }
                };
                const triggeredEngagement = window.ZaoyoeEngagement?.trigger?.('points_insufficient', {
                    source_module: 'shop',
                    source_event_id: `shop_insufficient_points:${String(this.currentPurchase?.productId || 'unknown')}`,
                    source: 'product_purchase',
                    product_id: this.currentPurchase?.productId || null,
                    ...rechargeReturnContext
                });
                if (triggeredEngagement && typeof triggeredEngagement.then === 'function') {
                    triggeredEngagement.then((shown) => {
                        if (!shown) window.ZaoyoeEngagement?.show?.(fallbackEngagement);
                    }).catch(() => window.ZaoyoeEngagement?.show?.(fallbackEngagement));
                } else {
                    window.ZaoyoeEngagement?.show?.(fallbackEngagement);
                }
                // Open wallet modal for recharging
                setTimeout(() => {
                    void openShopWalletModal('recharge', {
                        entry: 'shop_insufficient_points',
                        sourceModule: 'shop_client',
                        ...rechargeReturnContext
                    });
                }, 300);
            } else if (this.isInventoryStockErrorMessage(errMsg)) {
                this.closePurchaseModal();
                void this.refreshProductsAfterInventoryFailure();
                const redeemFailedLabel = window.i18n?.t('shop.redeemFailed') || '兑换失败';
                const normalizedErrMsg = String(errMsg || '').trim();
                this.showShopToast(`❌ ${redeemFailedLabel}: ${normalizedErrMsg}`, 'error');
            } else {
                // For other errors, show toast in the purchase modal
                const redeemFailedLabel = window.i18n?.t('shop.redeemFailed') || '兑换失败';
                const normalizedErrMsg = String(errMsg || '').trim();
                const toastMessage = !normalizedErrMsg || normalizedErrMsg === redeemFailedLabel
                    ? `❌ ${redeemFailedLabel}`
                    : (normalizedErrMsg.startsWith(`${redeemFailedLabel}:`)
                        ? `❌ ${normalizedErrMsg}`
                        : `❌ ${redeemFailedLabel}: ${normalizedErrMsg}`);
                this.showShopToast(toastMessage, 'error');
            }

            if (!isDuplicateSubmission) {
                this.currentPurchase.idempotencyKey = this.createPurchaseIdempotencyKey();
            }

            // Re-enable button on error
            restoreIdleButtonState();
        }
    },

    injectPremiumStyles: function () {
        if (document.getElementById('shop-premium-card-style')) return;
        const style = document.createElement('style');
        style.id = 'shop-premium-card-style';
        style.innerHTML = `
    .content - card {
    background: rgba(255, 255, 255, 0.05)!important;
    backdrop - filter: blur(12px)!important;
    -webkit - backdrop - filter: blur(12px)!important;
    border - radius: 16px!important;
    padding: 16px!important;
    margin - bottom: 12px!important;
    border: 1px solid rgba(255, 255, 255, 0.1)!important;
    border - width: 1px!important;
    border - style: solid!important;
    box - sizing: border - box!important;
    outline: none!important;
    box - shadow: 0 4px 16px rgba(0, 0, 0, 0.2)!important;
    cursor: default !important;
    transition: none!important;
    transform: none!important;
}
            .content - card:hover {
    background: rgba(255, 255, 255, 0.05)!important;
    border: 1px solid rgba(255, 255, 255, 0.1)!important;
    box - shadow: 0 4px 16px rgba(0, 0, 0, 0.2)!important;
    transform: none!important;
    filter: none!important;
}
            .item - name {
    font - size: 13px; font - weight: 600; color: #e2e8f0;
    margin - bottom: 8px;
    display: flex; align - items: center; gap: 6px;
}
            .item - content - box {
    background: transparent;
    border - radius: 0;
    padding: 0;
}
            .item - text {
    font - family: 'Monaco', monospace;
    font - size: 12px; color: #10b981;
    word -break: break-all;
    line - height: 1.5;
    opacity: 0.9;
}
`;
        document.head.appendChild(style);
    },

    clearPurchaseNotesWheelIsolation: function () {
        if (typeof this.purchaseNotesWheelCleanup === 'function') {
            this.purchaseNotesWheelCleanup();
            this.purchaseNotesWheelCleanup = null;
        }
    },

    bindContainedWheelIsolation: function (scrollCard) {
        const supportsHoverWheel = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        if (!supportsHoverWheel || !scrollCard) return null;

        const onWheel = (event) => {
            if (scrollCard.scrollHeight <= scrollCard.clientHeight + 1) return;

            const deltaY = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
            const maxScrollTop = Math.max(0, scrollCard.scrollHeight - scrollCard.clientHeight);
            const nextScrollTop = Math.min(maxScrollTop, Math.max(0, scrollCard.scrollTop + deltaY));

            if (nextScrollTop === scrollCard.scrollTop) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            scrollCard.scrollTop = nextScrollTop;
            event.preventDefault();
            event.stopPropagation();
        };

        scrollCard.addEventListener('wheel', onWheel, { passive: false, capture: true });
        return () => {
            scrollCard.removeEventListener('wheel', onWheel, true);
        };
    },

    bindPurchaseNotesWheelIsolation: function () {
        this.clearPurchaseNotesWheelIsolation();
        const notesCard = document.getElementById('purchaseNotesCard');
        const cleanup = this.bindContainedWheelIsolation(notesCard);
        if (cleanup) {
            this.purchaseNotesWheelCleanup = cleanup;
        }
    },

    clearPurchaseNotesHeightAnimation: function () {
        if (this.purchaseNotesHeightAnimationTimer) {
            clearTimeout(this.purchaseNotesHeightAnimationTimer);
            this.purchaseNotesHeightAnimationTimer = null;
        }

        const { card } = this.getPurchaseModalElements();
        if (!card) return;
        card.classList.remove('shop-purchase-notes-height-animating');
        card.style.removeProperty('height');
        card.style.removeProperty('overflow');
    },

    animatePurchaseModalHeightChange: function (mutate) {
        const runMutation = typeof mutate === 'function' ? mutate : () => {};
        const { overlay, card } = this.getPurchaseModalElements();
        const prefersReducedMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (
            !overlay
            || !card
            || !overlay.classList.contains('active')
            || card.classList.contains('shop-purchase-height-locked')
            || prefersReducedMotion
        ) {
            runMutation();
            return;
        }

        this.clearPurchaseNotesHeightAnimation();

        const startHeight = Math.round(card.getBoundingClientRect().height || card.offsetHeight || 0);
        if (startHeight <= 0) {
            runMutation();
            return;
        }

        card.style.height = `${startHeight}px`;
        card.style.overflow = 'hidden';
        card.classList.add('shop-purchase-notes-height-animating');

        runMutation();

        card.style.height = 'auto';
        const targetHeight = Math.round(card.getBoundingClientRect().height || card.offsetHeight || 0);

        if (targetHeight <= 0 || Math.abs(targetHeight - startHeight) < 2) {
            this.clearPurchaseNotesHeightAnimation();
            return;
        }

        card.style.height = `${startHeight}px`;
        void card.offsetHeight;

        requestAnimationFrame(() => {
            if (!card.classList.contains('shop-purchase-notes-height-animating')) return;
            card.style.height = `${targetHeight}px`;
        });

        this.purchaseNotesHeightAnimationTimer = setTimeout(() => {
            this.clearPurchaseNotesHeightAnimation();
        }, 280);
    },

    togglePurchaseNotesVisibility: function () {
        if (!this.currentPurchase) return;
        const hasPurchaseNotes = String(this.currentPurchase.purchaseNotes || '').trim().length > 0;
        if (!hasPurchaseNotes) return;

        const nextExpanded = this.currentPurchase.purchaseNotesExpanded !== true;
        this.animatePurchaseModalHeightChange(() => {
            this.currentPurchase.purchaseNotesExpanded = nextExpanded;
            this.renderPurchaseNotes();
        });
    },

    renderPurchaseNotes: function () {
        const modal = document.getElementById('shopPurchaseModal');
        const notesBox = document.getElementById('purchaseNotesBox');
        const notesCard = document.getElementById('purchaseNotesCard');
        const notesContent = document.getElementById('purchaseNotesContent');
        const notesTitle = document.getElementById('purchaseNotesTitle');
        const notesToggle = document.getElementById('purchaseNotesToggle');
        const normalizedPurchaseNotes = typeof this.currentPurchase?.purchaseNotes === 'string'
            ? this.currentPurchase.purchaseNotes.trim()
            : '';
        const hasPurchaseNotes = normalizedPurchaseNotes.length > 0;
        const isExpanded = hasPurchaseNotes && this.currentPurchase?.purchaseNotesExpanded === true;
        const titleText = window.i18n?.t('shop.purchaseNotes') || '注意事项';
        const expandLabel = window.i18n?.t('shop.showPurchaseNotes') || '展开';
        const collapseLabel = window.i18n?.t('shop.hidePurchaseNotes') || '收起';

        this.clearPurchaseNotesWheelIsolation();

        if (modal) {
            modal.classList.toggle('has-purchase-notes', hasPurchaseNotes);
            modal.classList.toggle('has-purchase-notes-expanded', isExpanded);
        }

        if (!notesBox || !notesContent) return;

        notesBox.classList.toggle('is-expanded', isExpanded);

        if (notesTitle) {
            notesTitle.textContent = titleText;
        }

        if (notesToggle && typeof notesToggle.setAttribute === 'function') {
            if ('disabled' in notesToggle) {
                notesToggle.disabled = !hasPurchaseNotes;
            }
            notesToggle.classList.toggle('is-active', isExpanded);
            notesToggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            notesToggle.setAttribute('aria-pressed', isExpanded ? 'true' : 'false');
            notesToggle.setAttribute('aria-label', isExpanded ? collapseLabel : expandLabel);
        }

        if (hasPurchaseNotes) {
            const renderedNotes = this.renderStoredRichText(normalizedPurchaseNotes);
            notesContent.innerHTML = renderedNotes;
            this.setElementHidden(notesCard, !isExpanded);
            this.setElementHidden(notesBox, false);
            if (isExpanded) {
                this.bindPurchaseNotesWheelIsolation();
            }
        } else {
            if (this.currentPurchase) {
                this.currentPurchase.purchaseNotesExpanded = false;
            }
            this.setElementHidden(notesBox, true);
            this.setElementHidden(notesCard, true);
            notesContent.innerHTML = '';
        }
    },

    clearSuccessUsageWheelIsolation: function () {
        if (typeof this.successUsageWheelCleanup === 'function') {
            this.successUsageWheelCleanup();
            this.successUsageWheelCleanup = null;
        }
    },

    closeSuccessModal: function () {
        const modal = document.getElementById('shopSuccessModal');
        if (!modal) return;

        this.clearSuccessUsageWheelIsolation();
        this.runShopModalCloseChromeCleanup({
            targets: [modal],
            forceHiddenClass: 'shop-modal-force-hidden',
            restoreDelayMs: 320
        });
        modal.classList.remove('active', 'has-usage-instructions');

        if (window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        }
    },

    showShopSuccessToast: function (message) {
        this.showShopToast(message, 'success');
    },

    writeShopTextWithLegacyClipboard: async function (text) {
        const normalizedText = String(text ?? '');
        const root = document.body || document.documentElement;
        if (!root || typeof document.execCommand !== 'function') {
            throw new Error('legacy_copy_unavailable');
        }

        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
        const savedRanges = selection
            ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
            : [];
        const textarea = document.createElement('textarea');
        const restoreSelection = () => {
            if (!selection) return;
            selection.removeAllRanges();
            savedRanges.forEach((range) => selection.addRange(range));
        };

        textarea.value = normalizedText;
        textarea.setAttribute('readonly', '');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.padding = '0';
        textarea.style.border = '0';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        textarea.style.fontSize = '16px';

        root.appendChild(textarea);
        try {
            textarea.focus({ preventScroll: true });
        } catch (_error) {
            textarea.focus();
        }
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        try {
            const copied = document.execCommand('copy');
            if (!copied) {
                throw new Error('legacy_copy_failed');
            }
        } finally {
            textarea.remove();
            restoreSelection();
            if (activeElement && typeof activeElement.focus === 'function') {
                try {
                    activeElement.focus({ preventScroll: true });
                } catch (_error) {
                    activeElement.focus();
                }
            }
        }
    },

    writeShopTextToClipboard: async function (text) {
        const normalizedText = String(text ?? '');
        if (!normalizedText) {
            throw new Error('empty_copy_text');
        }

        const canUseClipboardApi = typeof navigator !== 'undefined'
            && typeof navigator.clipboard?.writeText === 'function'
            && (typeof window.isSecureContext !== 'boolean' || window.isSecureContext);
        if (canUseClipboardApi) {
            try {
                await navigator.clipboard.writeText(normalizedText);
                return;
            } catch (error) {
                console.warn('[ShopClient] Clipboard API failed, trying legacy copy:', error?.message || error);
            }
        }

        await this.writeShopTextWithLegacyClipboard(normalizedText);
    },

    copySuccessCardContent: async function (encodedText) {
        const text = decodeURIComponent(encodedText || '');
        if (!text) return;

        try {
            await this.writeShopTextToClipboard(text);
            this.showShopSuccessToast(window.i18n?.t('common.copied') || '已复制');
        } catch (error) {
            console.error('Failed to copy shop success content:', error);
            this.showShopToast(window.i18n?.t('common.copyFailed') || '复制失败', 'error');
        }
    },

    bindSuccessUsageWheelIsolation: function () {
        this.clearSuccessUsageWheelIsolation();

        const modal = document.getElementById('shopSuccessModal');
        if (!modal) return;

        const usageCards = Array.from(
            modal.querySelectorAll('.shop-success-item__content-panel, .shop-success-item__notes-panel, .shop-success-item__usage-panel, .shop-success-usage-card')
        );
        const cleanups = usageCards
            .map((card) => this.bindContainedWheelIsolation(card))
            .filter((cleanup) => typeof cleanup === 'function');

        if (cleanups.length > 0) {
            this.successUsageWheelCleanup = () => {
                cleanups.forEach((cleanup) => {
                    try {
                        cleanup();
                    } catch (error) {
                        console.warn('Failed to cleanup success usage wheel isolation:', error);
                    }
                });
            };
        }
    },

    showSuccessModal: function (content, warning, usageInstructions, successItems = []) {
        this.bindDeferredUiHandlers();
        this.injectPremiumStyles();
        const modal = document.getElementById('shopSuccessModal');
        const contentBox = document.getElementById('purchasedContent');
        const warningBox = document.getElementById('purchasedWarning');
        const warningText = document.getElementById('purchasedWarningText');
        const summaryCount = document.getElementById('shopSuccessSummaryCount');
        const parentBox = contentBox?.parentElement || null;
        const scrollArea = modal?.querySelector('.shop-success-scroll');
        const normalizedUsageInstructions = typeof usageInstructions === 'string'
            ? usageInstructions.trim()
            : '';
        const normalizedItems = Array.isArray(successItems) && successItems.length > 0
            ? successItems.map((item) => this.buildSuccessModalItemPayload(item))
            : [
                this.buildSuccessModalItemPayload({
                    productId: this.currentPurchase?.productId,
                    displayName: this.currentPurchase?.productName,
                    orderId: this.currentPurchase?.orderId,
                    createdAt: this.currentPurchase?.createdAt,
                    quantity: Number(this.currentPurchase?.quantity || 0) || 1,
                    content,
                    purchaseNotes: this.currentPurchase?.purchaseNotes || '',
                    usageInstructions: normalizedUsageInstructions,
                    product: this.getCachedProductById(this.currentPurchase?.productId)
                })
            ];
        const hasUsageInstructions = normalizedItems.some((item) => {
            const usageText = String(item?.usageInstructions || '').trim();
            const noteText = String(item?.purchaseNotes || '').trim();
            return usageText.length > 0 || noteText.length > 0;
        });

        this.clearSuccessUsageWheelIsolation();

        if (modal) {
            modal.classList.toggle('has-usage-instructions', hasUsageInstructions);
        }

        if (parentBox) {
            parentBox.classList.remove('glass-box');
            parentBox.classList.add('shop-success-content-shell--plain');
        }

        if (modal && contentBox) {
            if (scrollArea) scrollArea.scrollTop = 0;
            if (parentBox) parentBox.scrollTop = 0;

            contentBox.dataset.originalContent = content;
            contentBox.dataset.successItems = encodeURIComponent(JSON.stringify(
                normalizedItems.map((item) => ({
                    displayName: item.displayName,
                    orderId: item.orderId,
                    createdAt: item.createdAt,
                    quantity: item.quantity,
                    contentSegments: item.contentSegments
                }))
            ));

            contentBox.classList.add('shop-success-content');
            contentBox.innerHTML = `
                <div class="shop-success-list">
                    ${normalizedItems.map((item, index) => this.buildSuccessItemMarkup(item, index)).join('')}
                </div>
                ${this.buildSuccessToastMarkup()}
            `;

            if (summaryCount) {
                summaryCount.textContent = `${normalizedItems.length} 个商品`;
            }

            if (warning && warningBox && warningText) {
                warningText.innerHTML = this.buildSuccessWarningMarkup(warning);
                this.setElementHidden(warningBox, false);
            } else if (warningBox) {
                if (warningText) {
                    warningText.innerHTML = '';
                }
                this.setElementHidden(warningBox, true);
            }

            const uiBox = document.getElementById('usageInstructionsBox');
            const uiContent = document.getElementById('usageInstructionsContent');
            if (uiBox) {
                this.setElementHidden(uiBox, true);
            }
            if (uiContent) {
                uiContent.innerHTML = '';
            }

            setTimeout(() => {
                modal.classList.remove('shop-modal-force-hidden');
                modal.classList.add('active');
                if (window.iOSScrollLock) window.iOSScrollLock.lockLight(modal);
                this.bindSuccessUsageWheelIsolation();
            }, 50);
        }
    },

    renderStoredRichText: function (content) {
        const normalized = typeof content === 'string' ? content.trim() : '';
        if (!normalized) return '';

        if (!this.looksLikeRichTextHtml(normalized)) {
            return this.linkifyText(this.escapeHtml(normalized)).replace(/\n/g, '<br>');
        }

        return this.sanitizeRichTextHtml(normalized);
    },

    looksLikeRichTextHtml: function (content) {
        return /<\/?(?:a|b|strong|i|em|u|div|p|br|font|span|ul|ol|li)\b/i.test(content || '');
    },

    normalizeRichTextPaletteColors: function (value) {
        if (typeof value !== 'string' || !value.trim()) {
            return value;
        }

        return value.replace(
            /#ffeb3b|rgb\s*\(\s*255\s*,\s*235\s*,\s*59\s*\)|rgba\s*\(\s*255\s*,\s*235\s*,\s*59\s*,\s*1(?:\.0+)?\s*\)/gi,
            '#f4b400'
        );
    },

    sanitizeRichTextHtml: function (html) {
        const template = document.createElement('template');
        template.innerHTML = this.normalizeRichTextPaletteColors(html);

        const allowedTags = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'FONT', 'UL', 'OL', 'LI']);
        const allowedTextAlign = /^(left|center|right|justify)$/i;
        const allowedColor = /^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]*\))$/i;
        const allowedFontSize = /^([1-7]|\d+(\.\d+)?(px|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large)$/i;

        const sanitizeStyle = (styleText = '') => {
            const safeRules = [];
            styleText.split(';').forEach((rule) => {
                const [rawProp, rawValue] = rule.split(':');
                if (!rawProp || !rawValue) return;

                const prop = rawProp.trim().toLowerCase();
                const value = rawValue.trim().replace(/\s*!important$/i, '');

                if (prop === 'text-align' && allowedTextAlign.test(value)) {
                    safeRules.push(`text-align: ${value.toLowerCase()}`);
                }
                if (prop === 'color' && allowedColor.test(value)) {
                    safeRules.push(`color: ${this.normalizeRichTextPaletteColors(value)}`);
                }
                if (prop === 'font-size' && allowedFontSize.test(value)) {
                    safeRules.push(`font-size: ${value}`);
                }
            });

            return safeRules.join('; ');
        };

        const sanitizeHref = (href = '') => {
            const value = href.trim();
            return /^https?:\/\//i.test(value) ? value : '';
        };

        const sanitizeChildren = (parent) => {
            Array.from(parent.childNodes).forEach((child) => {
                if (child.nodeType === Node.COMMENT_NODE) {
                    child.remove();
                    return;
                }

                if (child.nodeType !== Node.ELEMENT_NODE) {
                    return;
                }

                if (!allowedTags.has(child.tagName)) {
                    while (child.firstChild) {
                        parent.insertBefore(child.firstChild, child);
                    }
                    child.remove();
                    sanitizeChildren(parent);
                    return;
                }

                const attrs = {};
                Array.from(child.attributes).forEach((attr) => {
                    attrs[attr.name.toLowerCase()] = attr.value;
                });
                Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));

                if (['DIV', 'P', 'SPAN'].includes(child.tagName)) {
                    const safeStyle = sanitizeStyle(attrs.style || '');
                    if (safeStyle) {
                        child.setAttribute('style', safeStyle);
                    }
                }

                if (child.tagName === 'FONT') {
                    const color = this.normalizeRichTextPaletteColors((attrs.color || '').trim());
                    const size = (attrs.size || '').trim();
                    if (allowedColor.test(color)) {
                        child.setAttribute('color', color);
                    }
                    if (allowedFontSize.test(size)) {
                        child.setAttribute('size', size);
                    }
                }

                if (child.tagName === 'A') {
                    const safeHref = sanitizeHref(attrs.href || '');
                    if (!safeHref) {
                        while (child.firstChild) {
                            parent.insertBefore(child.firstChild, child);
                        }
                        child.remove();
                        sanitizeChildren(parent);
                        return;
                    }

                    child.setAttribute('href', safeHref);
                    child.setAttribute('target', '_blank');
                    child.setAttribute('rel', 'noopener noreferrer');
                    child.classList.add('shop-rich-link');
                }

                sanitizeChildren(child);
            });
        };

        sanitizeChildren(template.content);
        return template.innerHTML;
    },

    // Convert URLs in text to clickable links
    linkifyText: function (text) {
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" class="shop-rich-link">$1</a>');
    },

    escapeHtml: function (text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    toggleExpandContent: function () {
        const expandBtn = document.getElementById('expandContentBtn');
        const expandableItems = Array.from(document.querySelectorAll('#expandedContentGrid [data-expandable-item="1"]'));

        if (expandBtn && expandableItems.length > 0) {
            const isHidden = expandableItems[0].hidden;
            expandableItems.forEach((item) => {
                item.hidden = !isHidden;
            });

            const hiddenCount = expandBtn.dataset.hiddenCount || expandableItems.length;
            expandBtn.dataset.expanded = isHidden ? 'true' : 'false';
            expandBtn.innerHTML = isHidden
                ? `<span>${window.i18n?.t('shop.collapse') || '收起'}</span><i class="fas fa-chevron-up shop-expand-toggle-icon" aria-hidden="true"></i>`
                : `<span>${window.i18n?.t('shop.expandMore') || '展开其余'} ${hiddenCount} ${window.i18n?.t('shop.items') || '个'}</span><i class="fas fa-chevron-down shop-expand-toggle-icon" aria-hidden="true"></i>`;
        }
    },

    loadMyOrders: async function (options = {}) {
        this.bindDeferredUiHandlers();
        const list = document.getElementById('ordersList');
        if (!list) return;

        const preserveExisting = options?.preserveExisting === true && list.childElementCount > 0;
        this.ordersLoading = true;

        if (!preserveExisting) {
            list.innerHTML = this.buildShopStatusMessage(
                window.i18n?.t('common.loading') || '加载中...',
                { variant: 'muted', iconClass: 'fas fa-spinner fa-spin' }
            );
        }

        try {
            const client = this.getShopSupabaseClient();
            const { data: { user } = {} } = await client.auth.getUser();
            if (!user) {
                this.ordersLoaded = false;
                list.innerHTML = this.buildShopStatusMessage(window.i18n?.t('shop.loginRequired') || '请先登录');
                return;
            }

            const { data, error } = await client
                .from('shop_orders')
                .select(`
    *,
    shop_products(name, name_en, icon_url)
        `)
                .eq('user_id', user.id)
                .eq('site', window.SiteConfig?.site || 'cn')
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.ordersLoaded = true;
            list.innerHTML = '';
            if (!data || data.length === 0) {
                list.innerHTML = this.buildShopStatusMessage(window.i18n?.t('shop.noOrders') || '暂无订单记录', { variant: 'muted' });
                return;
            }

            data.forEach(order => {
                const item = document.createElement('div');
                item.className = 'glass-box shop-order-history-item';

                const date = new Date(order.created_at).toLocaleString(this.isEnglishShopLocale() ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const icon = order.shop_products?.icon_url || 'fas fa-box';
                const displayName = this.getLocalizedProductName(order.shop_products)
                    || (window.i18n?.t('shop.unknownProduct') || '未知商品');
                const pointsLabel = this.getShopPointsLabel();
                const safeIcon = this.escapeAttribute(icon);
                const iconHtml = icon.startsWith('http')
                    ? `<img src="${safeIcon}" class="shop-order-history-icon shop-order-history-icon--image" alt="">`
                    : `<i class="${safeIcon} shop-order-history-icon shop-order-history-icon--font" aria-hidden="true"></i>`;

                item.innerHTML = `
                    <div class="shop-order-history-main">
                        <div class="shop-order-history-header">
                            ${iconHtml}
                            <span class="shop-order-history-name">${this.escapeHtml(displayName)}</span>
                        </div>
                        <div class="shop-order-history-meta">
                            ${date} · <span class="shop-order-history-points">-${this.formatShopPointValue(order.price_paid)} ${pointsLabel}</span>
                        </div>
                    </div>
                    <button type="button" data-shop-order-id="${order.id}" data-shop-order-content="${encodeURIComponent(order.content_delivered || '')}"
                        class="shop-order-history-view">
                        ${window.i18n?.t('shop.view') || '查看'}
                    </button>
                `;
                list.appendChild(item);
            });
        } catch (err) {
            console.error(err);
            if (!preserveExisting) {
                list.innerHTML = this.buildShopStatusMessage(window.i18n?.t('common.error') || '加载失败', { variant: 'error' });
            }
        } finally {
            this.ordersLoading = false;
        }
    },

    viewOrderContent: function (id, encodedContent) {
        const fallbackToLegacySuccessModal = () => {
            const content = decodeURIComponent(encodedContent);
            this.showSuccessModal(content);
            const modal = document.getElementById('shopSuccessModal');
            const title = modal.querySelector('.card-title');
            if (title) title.textContent = window.i18n?.t('shop.orderDetails') || "订单详情";
        };

        if (window.WalletModal && window.WalletModal.showOrderDetail) {
            WalletModal.showOrderDetail(id);
            return;
        }

        void ensureShopWalletModal().then((walletModal) => {
            if (walletModal?.showOrderDetail) {
                walletModal.showOrderDetail(id);
                return;
            }

            fallbackToLegacySuccessModal();
        }).catch((error) => {
            console.warn('[ShopClient] Failed to open wallet order detail:', error?.message || error);
            fallbackToLegacySuccessModal();
        });
    },

    copyContent: async function () {
        const contentBox = document.getElementById('purchasedContent');
        if (!contentBox) return;
        // Use stored original content instead of textContent (which includes UI button text)
        let text = contentBox.dataset.originalContent || contentBox.textContent;

        // Remove '----' separators and replace with single newline for clean separation
        if (text) {
            text = text.split(/\n----\n/).join('\n');
        }

        try {
            await this.writeShopTextToClipboard(text);
            const btn = document.getElementById('copyContentBtn');
            if (btn) {
                const originalHTML = btn.innerHTML;
                btn.innerHTML = `<i class="fas fa-check"></i> ${window.i18n?.t('common.copied') || '已复制'}`;
                this.setShopButtonFeedbackState(btn, true);
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    this.setShopButtonFeedbackState(btn, false);
                }, 2000);
            }

            // Also trigger the elegant success toast
            this.showShopToast(window.i18n?.t('common.copied') || '已复制', 'success');
        } catch (error) {
            console.error('Failed to copy purchased shop content:', error);
            this.showShopToast(window.i18n?.t('common.copyFailed') || '复制失败', 'error');
        }
    },

    exportContent: function () {
        const contentBox = document.getElementById('purchasedContent');
        const content = contentBox.dataset.originalContent || contentBox.textContent;
        const serializedItems = String(contentBox.dataset.successItems || '').trim();
        const productName = this.currentPurchase?.productName || (window.i18n?.t('shop.unknownProduct') || '商品');
        const orderId = this.currentPurchase?.orderId || '';
        const timestamp = this.formatSuccessOrderTimestamp(this.currentPurchase?.createdAt) || new Date().toLocaleString(this.isEnglishShopLocale() ? 'en-US' : 'zh-CN');
        let exportItems = [];

        if (serializedItems) {
            try {
                const parsedItems = JSON.parse(decodeURIComponent(serializedItems));
                if (Array.isArray(parsedItems)) {
                    exportItems = parsedItems;
                }
            } catch (error) {
                console.warn('Failed to parse shop success export items:', error);
            }
        }

        if (!exportItems.length) {
            exportItems = [{
                displayName: productName,
                orderId,
                createdAt: this.currentPurchase?.createdAt || '',
                contentSegments: String(content || '')
                    .split(/\n----\n/)
                    .map((item) => String(item || '').trim())
                    .filter(Boolean)
            }];
        }

        // Build CSV content with BOM for Excel Chinese support
        const BOM = '\uFEFF';
        let csv = BOM + `${window.i18n?.t('shop.csvOrderId') || '订单号'},${window.i18n?.t('shop.csvIndex') || '序号'},${window.i18n?.t('shop.csvProductName') || '商品名称'},${window.i18n?.t('shop.csvAccountInfo') || '账号信息'},${window.i18n?.t('shop.csvRedeemTime') || '兑换时间'}\n`;
        let rowIndex = 1;

        exportItems.forEach((item) => {
            const itemName = String(item?.displayName || productName || '').trim() || productName;
            const itemOrderId = String(item?.orderId || orderId || '').trim();
            const itemTimestamp = this.formatSuccessOrderTimestamp(item?.createdAt) || timestamp;
            const itemSegments = Array.isArray(item?.contentSegments) && item.contentSegments.length > 0
                ? item.contentSegments
                : [String(item?.content || '').trim()].filter(Boolean);

            itemSegments.forEach((segment) => {
                const escapedItem = String(segment || '').replace(/"/g, '""');
                csv += `"${itemOrderId}", ${rowIndex}, "${itemName}", "${escapedItem}", "${itemTimestamp}"\n`;
                rowIndex += 1;
            });
        });

        // Create and download file
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${window.i18n?.t('shop.orderPrefix') || '订单'}_${productName}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Button feedback
        const btn = document.getElementById('exportContentBtn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-check"></i> ${window.i18n?.t('common.exported') || '已导出'}`;
        this.setShopButtonFeedbackState(btn, true);
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            this.setShopButtonFeedbackState(btn, false);
        }, 2000);
    }
};

ShopClient.stabilizeShopScrollRestoration();

// Auto-init if DOM ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopClient.init());
} else {
    ShopClient.init();
}

window.addEventListener('hashchange', () => {
    ShopClient.syncCartHashFocusFromLocation();
});

// Expose globally
window.ShopClient = ShopClient;
window.ZaoyoeShopOpenCartFromEngagement = (...args) => ShopClient.openCartFromEngagement(...args);
