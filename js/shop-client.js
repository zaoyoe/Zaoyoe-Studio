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
const SHOP_CARD_BREATHE_DURATION_MS = 5800;
const SHOP_CARD_BREATHE_AMPLITUDE_PX = 6;
const SHOP_PREFETCH_SCHEMA_VERSION = '20260413_PURCHASE_GUIDANCE_2';
const shopCardImageWarmCache = new Set();

const ShopClient = {
    currentAgentId: null,
    currentAgentName: null,
    successUsageWheelCleanup: null,
    purchaseModalKeyboardViewportCleanup: null,
    purchaseModalKeyboardViewportRafId: null,
    purchaseModalKeyboardBaseViewportHeight: 0,
    purchaseModalKeyboardBaseCardHeight: 0,
    purchaseModalKeyboardLastBottomInset: 0,
    purchaseModalKeyboardDocked: false,
    purchaseModalKeyboardInitialDockTimer: null,
    purchaseModalKeyboardInsetDropTimer: null,
    purchaseModalKeyboardTransitionTimer: null,
    purchaseModalKeyboardPendingInset: 0,
    purchaseModalKeyboardStableViewportProbe: null,
    purchaseModalBaseScrollY: 0,
    purchaseModalOwnsFullScrollLock: false,
    categoryProductsCache: {},
    categoryProductsPromises: {},
    allProductsCache: null,
    allProductsPromise: null,
    prefetchedShopRevalidationPromise: null,
    agentPricesCache: null,
    agentPricesPromise: null,
    currentUserPurchaseAccess: null,
    currentUserPurchaseAccessPromise: null,
    currentUserPurchaseAccessUserId: null,
    availableCategories: [],
    cartItems: new Map(),
    cartSnapshots: {},
    cartItemDisclosureState: {},
    cartOpen: false,
    cartCheckoutProcessing: false,
    cartBackdropCloseGuardUntil: 0,
    productsRequestToken: 0,
    productsCacheEpoch: 0,
    backgroundPrefetchScheduled: false,
    backgroundPrefetchHandle: null,
    gridTransitionCleanupTimer: null,
    gridTransitionSequence: 0,
    purchaseGuidanceRequestToken: 0,
    cartAnchorFeedbackTimer: null,
    lastSkeletonCount: SHOP_PRODUCT_SKELETON_COUNT,
    staticUiBindingsBound: false,

    getAccessToken: async function () {
        const client = window.supabaseClient || supabaseClient;
        const { data: { session } = {} } = await client.auth.getSession();
        return session?.access_token || '';
    },

    loadCurrentUserPurchaseAccess: async function ({ forceRefresh = false } = {}) {
        const client = window.supabaseClient || supabaseClient;
        const { data: { user } = {} } = await client.auth.getUser();

        if (!user) {
            this.currentUserPurchaseAccess = null;
            this.currentUserPurchaseAccessPromise = null;
            this.currentUserPurchaseAccessUserId = null;
            return { unlimitedShopPurchases: false };
        }

        if (this.currentUserPurchaseAccessUserId !== user.id) {
            this.currentUserPurchaseAccess = null;
            this.currentUserPurchaseAccessPromise = null;
            this.currentUserPurchaseAccessUserId = user.id;
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

    filterProductsForCurrentSite: function (products) {
        if (window.SiteConfig?.filterProductsForCurrentSite) {
            return window.SiteConfig.filterProductsForCurrentSite(products);
        }
        return Array.isArray(products) ? products : [];
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

    getLocalizedProductName: function (product) {
        if (!product) return '';
        const isEn = this.isEnglishShopLocale();
        return (isEn && product.name_en) ? product.name_en : (product.name || '');
    },

    getLocalizedProductDescription: function (product) {
        if (!product) return '';
        const isEn = this.isEnglishShopLocale();
        return (isEn && product.description_en)
            ? product.description_en
            : (product.description || (window.i18n?.t('shop.noDescription') || '暂无描述'));
    },

    formatShopPoints: function (value) {
        const numericValue = Number(value || 0) || 0;
        const formattedValue = window.SiteConfig?.formatPrice
            ? window.SiteConfig.formatPrice(numericValue)
            : String(numericValue);
        return `${formattedValue} ${window.SiteConfig?.getPointsLabel() || window.i18n?.t('shop.points') || '积分'}`;
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

    buildProductCardPurchaseDataset: function (product, unitPrice) {
        const productId = String(product?.id || '').trim();
        const maxPurchaseQuantity = this.getPurchaseQuantityCapForProduct(product, product?.max_purchase_quantity);
        const qtyRulesStr = product?.quantity_rules ? encodeURIComponent(JSON.stringify(product.quantity_rules)) : '';

        return {
            productId,
            productName: product?.name || '',
            productNameEn: product?.name_en || '',
            unitPrice,
            productCategory: String(product?.category || ''),
            qtyRules: qtyRulesStr,
            maxPurchaseQuantity: String(maxPurchaseQuantity),
            showPurchaseNotes: product?.show_purchase_notes === true,
            purchaseNotes: product?.purchase_notes || '',
            showUsageInstructions: product?.show_usage_instructions === true,
            usageInstructions: product?.usage_instructions || ''
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

        if (pricing.originalPrice != null && pricing.hasAgentPrice) {
            originalPriceHtml = `<span class="shop-card-original-price">${pricing.originalPrice}</span>`;
            agentBadgeHtml = `<div class="shop-agent-badge" data-shop-card-agent-badge="true">${window.i18n?.t('shop.exclusiveBuff') || '专属加持'}</div>`;
        }

        if (pricing.originalPrice != null && pricing.hasFlashSale && !agentBadgeHtml) {
            originalPriceHtml = `<span class="shop-card-original-price">${pricing.originalPrice}</span>`;
            flashSaleBadgeHtml = `<div class="flash-sale-badge flash-badge-glass" data-shop-card-flash-badge="true" data-endtime="${product.flash_sale_end}"><i class="fas fa-bolt"></i> <span class="countdown-timer">${window.i18n?.t('shop.calculating') || '计算中...'}</span></div>`;
            flashShadowClass = 'flash-sale-card';
        }

        return {
            currentPrice,
            priceHtml: `${originalPriceHtml}${window.SiteConfig?.formatPrice(currentPrice) || currentPrice} <span data-i18n="shop.points">${window.SiteConfig?.getPointsLabel() || window.i18n?.t('shop.points') || '积分'}</span>`,
            flashSaleBadgeHtml,
            flashShadowClass,
            agentBadgeHtml
        };
    },

    syncCurrentPurchasePricingFromCatalog: function () {
        if (!this.currentPurchase?.productId) return;

        const liveProduct = this.getCachedProductById(this.currentPurchase.productId);
        if (!liveProduct) return;

        const pricingState = this.buildProductCardPricingState(liveProduct, this.agentPricesCache || {});
        if (!pricingState) return;

        const nextBasePrice = Number(pricingState.currentPrice || 0);
        const currentBasePrice = Number(this.currentPurchase.basePrice || 0);
        if (!Number.isFinite(nextBasePrice) || nextBasePrice === currentBasePrice) {
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
        if (card.dataset.shopAction === 'buy-product') {
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
                checkoutReviewHint: 'We will submit the current cart items one by one. Coupon stacking is not available in cart checkout yet.',
                checkoutReviewNotice: 'Cart checkout currently reuses the existing order flow item by item, so coupon stacking is unavailable in this pass.',
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
                singleCheckoutHint: 'Single-item checkout keeps the existing discount and review flow.'
            };
        }

        return {
            anchorHint: '点开购物车',
            anchorEmptyTitle: '购物车为空',
            anchorEmptyBody: '先加入几件，再统一看看数量和总积分。',
            drawerEyebrow: 'Floating Cart',
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
            checkoutReviewEyebrow: 'Cart Review',
            checkoutReviewTitle: '统一确认',
            checkoutReviewHint: '购物车会按当前顺序逐个兑换，这一版暂不叠加优惠码。',
            checkoutReviewNotice: '统一结算会沿用现有下单链路逐个提交，暂不叠加优惠码。',
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
            singleCheckoutHint: '单商品结算会继续沿用当前的优惠码和最终确认链路。'
        };
    },

    showShopToast: function (message, variant = 'success') {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) return;

        if (window.WalletModal?.showToast) {
            window.WalletModal.showToast(normalizedMessage, variant);
            return;
        }

        console.info(`[ShopToast:${variant}]`, normalizedMessage);
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
        return {
            id: String(product.id || '').trim(),
            name: product.name || '',
            name_en: product.name_en || '',
            description: product.description || '',
            description_en: product.description_en || '',
            icon_url: product.icon_url || '',
            category: product.category || '',
            stock_count: Number(product.stock_count || 0) || 0,
            max_purchase_quantity: this.normalizePurchaseQuantityCap(product.max_purchase_quantity),
            quantity_rules: Array.isArray(product.quantity_rules) ? product.quantity_rules : [],
            show_purchase_notes: product.show_purchase_notes === true,
            purchase_notes: product.purchase_notes || '',
            show_usage_instructions: product.show_usage_instructions === true,
            usage_instructions: product.usage_instructions || '',
            flash_sale_price: product.flash_sale_price ?? null,
            flash_sale_end: product.flash_sale_end || null,
            resolved_unit_price: resolvedUnitPrice == null ? null : Number(resolvedUnitPrice)
        };
    },

    updateCartSnapshot: function (productId, product, options = {}) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return;
        const snapshot = this.buildCartProductSnapshot(product, options);
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
                ? (this.buildCartProductSnapshot(liveProduct) || this.cartSnapshots?.[productId] || product)
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
            const hasPurchaseNotes = product.show_purchase_notes === true && String(product.purchase_notes || '').trim().length > 0;
            const hasUsageInstructions = product.show_usage_instructions === true && String(product.usage_instructions || '').trim().length > 0;

            entries.push({
                productId,
                product,
                quantity,
                unitPrice,
                subtotal: unitPrice * quantity,
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
            summary.totalPoints += Number(entry.subtotal || 0) || 0;
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
            usage: Boolean(state?.usage)
        };
    },

    buildCartItemDisclosureDomId: function (productId, kind) {
        const normalizedId = String(productId || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-');
        const normalizedKind = String(kind || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-');
        return `shop-cart-disclosure-${normalizedKind || 'panel'}-${normalizedId || 'item'}`;
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
            showPurchaseNotes: dataset.showPurchaseNotes === 'true',
            purchaseNotes: dataset.purchaseNotes || '',
            showUsageInstructions: dataset.showUsageInstructions === 'true',
            usageInstructions: dataset.usageInstructions || '',
            productCategory: dataset.productCategory || ''
        };
    },

    openProductPurchaseFromDataset: function (dataset = {}, sourceContext = resolveShopSourceContext()) {
        const payload = this.getShopPurchasePayloadFromDataset(dataset);
        if (!payload.productId) return;

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
            sourceContext
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
        const normalizedKind = kind === 'notes' || kind === 'usage' ? kind : '';
        if (!normalizedId || !normalizedKind) return;

        const currentState = this.getCartItemDisclosureState(normalizedId);
        const nextState = {
            ...currentState,
            [normalizedKind]: !currentState[normalizedKind]
        };

        if (!nextState.notes && !nextState.usage) {
            delete this.cartItemDisclosureState[normalizedId];
        } else {
            this.cartItemDisclosureState[normalizedId] = nextState;
        }

        this.renderCart();
    },

    setCartOpen: function (open) {
        const wasOpen = this.cartOpen === true;
        this.cartOpen = Boolean(open) && this.cartItems.size > 0;
        if (!this.cartOpen) {
            this.cartBackdropCloseGuardUntil = 0;
        }
        document.body.dataset.shopCartOpen = String(this.cartOpen);
        const anchor = document.getElementById('shopCartAnchor');
        const drawer = document.getElementById('shopCartDrawer');
        const drawerBody = drawer?.querySelector('.shop-cart-drawer__body');
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
        }
        if (this.cartOpen && !wasOpen) {
            if (drawerBody) drawerBody.scrollTop = 0;
            if (drawer) drawer.scrollTop = 0;
            window.requestAnimationFrame(() => {
                if (drawerBody) drawerBody.scrollTop = 0;
                if (drawer) drawer.scrollTop = 0;
            });
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

    guardCartBackdropClose: function (durationMs = 240) {
        const safeDuration = Math.max(0, Math.trunc(Number(durationMs || 0) || 0));
        this.cartBackdropCloseGuardUntil = Date.now() + safeDuration;
    },

    shouldIgnoreCartBackdropClose: function () {
        return Number(this.cartBackdropCloseGuardUntil || 0) > Date.now();
    },

    buildCartIconMarkup: function (product, { imageClass = 'shop-cart-item__thumb', iconClass = 'shop-cart-item__icon' } = {}) {
        const safeIconSource = this.escapeAttribute(product?.icon_url || '');
        const safeAlt = this.escapeAttribute(this.getLocalizedProductName(product) || (window.i18n?.t('shop.productImage') || '商品封面'));

        if (product?.icon_url?.startsWith('fa')) {
            return `<div class="${iconClass}" aria-hidden="true"><i class="${safeIconSource}"></i></div>`;
        }

        if (this.isShopImageSource(product?.icon_url)) {
            return `<img src="${safeIconSource}" class="${imageClass}" alt="${safeAlt}" loading="lazy" decoding="async">`;
        }

        return `<div class="${iconClass}" aria-hidden="true"><i class="fas fa-box"></i></div>`;
    },

    buildCartItemMarkup: function (entry) {
        const copy = this.getCartCopy();
        const noteText = entry.hasPurchaseNotes ? String(entry.product?.purchase_notes || '').trim() : '';
        const usageText = entry.hasUsageInstructions ? String(entry.product?.usage_instructions || '').trim() : '';
        const disclosureState = this.getCartItemDisclosureState(entry.productId);
        const hasOpenDisclosure = disclosureState.notes || disclosureState.usage;
        const isCartBusy = this.cartCheckoutProcessing === true;
        const notePanelId = noteText ? this.buildCartItemDisclosureDomId(entry.productId, 'notes') : '';
        const usagePanelId = usageText ? this.buildCartItemDisclosureDomId(entry.productId, 'usage') : '';
        const quantityValue = Math.max(1, Number(entry.quantity || 1) || 1);
        const canDecrease = quantityValue > 1;
        const canIncrease = quantityValue < Math.max(1, Number(entry.quantityCap || 1) || 1);
        const stockCount = Number(entry.product?.stock_count || 0) || 0;
        const stockLabel = `${window.i18n?.t('shop.stock') || '库存'}: ${Math.max(0, stockCount)}`;

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

                ${((noteText || usageText) && hasOpenDisclosure) ? `
                    <div class="shop-cart-item__disclosures">
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
                        <strong>${this.escapeHtml(this.formatShopPoints(entry.subtotal))}</strong>
                        <span>${this.escapeHtml(this.formatShopPoints(entry.unitPrice))} × ${quantityValue}</span>
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
        return `
            <article class="shop-cart-checkout__item">
                <div class="shop-cart-checkout__item-head">
                    <div class="shop-cart-checkout__item-title">${this.escapeHtml(entry.displayName)}</div>
                    <strong>${this.escapeHtml(this.formatShopPoints(entry.subtotal))}</strong>
                </div>
                <div class="shop-cart-checkout__item-meta">
                    <span>${this.escapeHtml(this.formatShopPoints(entry.unitPrice))} × ${entry.quantity}</span>
                    ${entry.hasPurchaseNotes ? `<span class="shop-cart-checkout__item-pill shop-cart-checkout__item-pill--notice">${this.escapeHtml(copy.notesPill)}</span>` : ''}
                    ${entry.hasUsageInstructions ? `<span class="shop-cart-checkout__item-pill shop-cart-checkout__item-pill--usage">${this.escapeHtml(copy.usagePill)}</span>` : ''}
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
            const shouldHideAnchor = entries.length === 0 || this.cartOpen;
            anchor.hidden = shouldHideAnchor;
            anchor.disabled = shouldHideAnchor;
            anchor.setAttribute('aria-hidden', String(shouldHideAnchor));
            anchor.style.pointerEvents = shouldHideAnchor ? 'none' : '';
            anchor.style.opacity = shouldHideAnchor ? '0' : '';
            anchor.style.visibility = shouldHideAnchor ? 'hidden' : '';
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

    addProductToCart: function (productId, quantity = 1) {
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

        this.cartItems.set(normalizedId, nextQuantity);
        this.updateCartSnapshot(normalizedId, product);
        this.renderCart();
        this.playCartAnchorAddFeedback();
        this.showShopToast(`${this.getCartCopy().addedToast}：${this.getLocalizedProductName(product)}`, 'success');
        return addedQuantity;
    },

    addCurrentPurchaseToCart: function () {
        const productId = String(this.currentPurchase?.productId || '').trim();
        if (!productId) return;

        const quantity = Math.max(1, Math.trunc(Number(this.currentPurchase?.quantity || 1) || 1));
        const addedQuantity = this.addProductToCart(productId, quantity);
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
        this.updateCartSnapshot(normalizedId, product);
        this.renderCart();
    },

    removeCartItem: function (productId) {
        const normalizedId = String(productId || '').trim();
        if (!normalizedId) return;

        const product = this.getCachedProductById(normalizedId) || this.cartSnapshots?.[normalizedId];
        this.cartItems.delete(normalizedId);
        delete this.cartSnapshots[normalizedId];
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
        modal.classList.add('active');
        if (window.iOSScrollLock) {
            window.iOSScrollLock.lockLight(modal);
        }
    },

    closeCartCheckoutModal: function () {
        const modal = document.getElementById('shopCartCheckoutModal');
        if (!modal) return;

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
        this.openPurchaseModal(
            entry.productId,
            entry.product?.name || entry.displayName,
            entry.product?.name_en || '',
            entry.unitPrice,
            Array.isArray(entry.product?.quantity_rules) ? entry.product.quantity_rules : [],
            purchaseQuantityCap,
            entry.hasPurchaseNotes ? (entry.product?.purchase_notes || '') : '',
            entry.hasUsageInstructions ? (entry.product?.usage_instructions || '') : '',
            {
                category: entry.product?.category || '',
                sourceContext,
                initialQuantity: entry.quantity,
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
        if (stage === 'confirm') {
            return {
                title: isEn ? 'Final Confirmation' : '最终确认',
                nextLabel: isEn ? 'Confirm Order' : '确认订单',
                backLabel: isEn ? 'Back to Edit' : '返回修改',
                confirmLabel: isEn ? 'Confirm Purchase' : '确认并兑换'
            };
        }

        return {
            title: window.i18n?.t('shop.confirmRedeem') || (isEn ? 'Confirm Purchase' : '确认兑换'),
            nextLabel: isEn ? 'Confirm Order' : '确认订单',
            backLabel: isEn ? 'Back to Edit' : '返回修改',
            confirmLabel: isEn ? 'Confirm Purchase' : '确认并兑换'
        };
    },

    renderPurchaseConfirmationStage: function () {
        if (!this.currentPurchase) return;

        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const isEn = currentLang === 'en';
        const pointsLabel = window.i18n?.t('shop.points') || (isEn ? 'points' : '积分');
        const discountLabel = isEn ? 'Discount' : '优惠';
        const displayName = (currentLang === 'en' && this.currentPurchase.productNameEn)
            ? this.currentPurchase.productNameEn
            : this.currentPurchase.productName;
        const quantity = Math.max(1, Number(this.currentPurchase.quantity) || 1);
        const unitPrice = Math.max(0, Number(this.currentPurchase.unitPrice) || 0);
        const subtotal = Math.max(0, Number(this.getCurrentPurchaseSubtotal?.() || 0) || 0);
        const discountAmount = Math.max(0, Number(this.currentPurchase.discountAmount) || 0);
        const finalTotal = Math.max(0, subtotal - discountAmount);
        const discountCode = String(this.currentPurchase.discountCode || '').trim().toUpperCase();

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
        if (unitPriceEl) unitPriceEl.textContent = `${unitPrice} ${pointsLabel}`;
        if (subtotalEl) subtotalEl.textContent = `${subtotal} ${pointsLabel}`;
        if (totalEl) totalEl.textContent = `${finalTotal} ${pointsLabel}`;

        if (discountRowEl) {
            this.setElementHidden(discountRowEl, discountAmount <= 0);
        }
        if (discountLabelEl) {
            discountLabelEl.textContent = discountCode ? `${discountLabel} ${discountCode}` : discountLabel;
        }
        if (discountAmountEl) {
            discountAmountEl.textContent = `-${discountAmount} ${pointsLabel}`;
        }
    },

    setPurchaseStage: function (stage = 'configure') {
        if (!this.currentPurchase) return;

        const nextStage = stage === 'confirm' ? 'confirm' : 'configure';
        const modal = document.getElementById('shopPurchaseModal');
        const stageTitle = document.getElementById('purchaseStageTitle');
        const backBtn = document.getElementById('purchaseBackBtn');
        const addToCartBtn = document.getElementById('purchaseAddToCartBtn');
        const nextBtn = document.getElementById('nextPurchaseStepBtn');
        const confirmBtn = document.getElementById('confirmPurchaseBtn');
        const copy = this.getPurchaseStageCopy(nextStage);

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
            backBtn.disabled = false;
        }

        if (addToCartBtn) {
            addToCartBtn.innerHTML = `<i class="fas fa-basket-shopping"></i> <span>${this.escapeHtml(this.getCartCopy().addLabel)}</span>`;
            this.setElementHidden(addToCartBtn, nextStage !== 'configure' || Boolean(this.currentPurchase?.cartOrigin?.productId));
            addToCartBtn.disabled = false;
        }

        if (nextBtn) {
            nextBtn.innerHTML = `<i class="fas fa-arrow-right"></i> <span>${this.escapeHtml(copy.nextLabel)}</span>`;
            this.setElementHidden(nextBtn, nextStage !== 'configure');
            nextBtn.disabled = false;
        }

        if (confirmBtn) {
            confirmBtn.innerHTML = `<i class="fas fa-shopping-cart"></i> <span>${this.escapeHtml(copy.confirmLabel)}</span>`;
            this.setElementHidden(confirmBtn, nextStage !== 'confirm');
            confirmBtn.disabled = false;
        }

        if (nextStage === 'confirm') {
            this.renderPurchaseConfirmationStage();
        }
    },

    proceedPurchaseConfirmation: function () {
        if (!this.currentPurchase) return;
        this.renderPurchaseConfirmationStage();
        this.setPurchaseStage('confirm');
    },

    getDefaultStackingPolicy: function () {
        return {
            is_exclusive: true,
            stack_priority: 100,
            pricing_apply_stage: 'order_discount',
            exclusivity_label: '排他券',
            apply_stage_label: '订单优惠阶段',
            summary: '当前仅支持单券结算，优惠会在订单优惠阶段直接抵扣。'
        };
    },

    buildLocalPricingWaterfall: function () {
        const subtotal = this.getCurrentPurchaseSubtotal();
        const discountAmount = Math.max(0, Number(this.currentPurchase.discountAmount) || 0);
        const finalTotal = Math.max(0, subtotal - discountAmount);
        const unitPrice = Math.max(0, Number(this.currentPurchase.unitPrice) || 0);
        const quantity = Math.max(1, Number(this.currentPurchase.quantity) || 1);
        const code = String(this.currentPurchase.discountCode || '').trim().toUpperCase();
        const stackingPolicy = this.currentPurchase.stackingPolicy && typeof this.currentPurchase.stackingPolicy === 'object'
            ? {
                ...this.getDefaultStackingPolicy(),
                ...this.currentPurchase.stackingPolicy
            }
            : this.getDefaultStackingPolicy();

        const rows = [
            {
                key: 'unit_price',
                label: '站点结算单价',
                amount: unitPrice,
                detail: `${unitPrice} x ${quantity}`,
                tone: 'base'
            },
            {
                key: 'subtotal',
                label: '商品小计',
                amount: subtotal,
                detail: quantity > 1 ? `数量 ${quantity}` : '单件结算',
                tone: 'subtotal'
            }
        ];

        if (discountAmount > 0) {
            rows.push({
                key: 'discount',
                label: code ? `优惠券 ${code}` : '优惠券抵扣',
                amount: discountAmount,
                display_amount: -discountAmount,
                detail: `${stackingPolicy.apply_stage_label || '订单优惠阶段'} · ${stackingPolicy.exclusivity_label || '排他券'} · 优先级 ${stackingPolicy.stack_priority || 100}`,
                tone: 'discount'
            });
        }

        rows.push({
            key: 'total',
            label: '实付积分',
            amount: finalTotal,
            detail: discountAmount > 0 ? '已包含优惠抵扣' : '未使用优惠',
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

        container.innerHTML = `
            <div class="shop-price-waterfall">
                <div class="shop-price-waterfall__header">
                    <div class="shop-price-waterfall__title">价格瀑布</div>
                    <div class="shop-price-waterfall__policy">
                        <span class="shop-price-waterfall__policy-chip">${this.escapeHtml(stackingPolicy.exclusivity_label || '排他券')}</span>
                        <span class="shop-price-waterfall__policy-chip">${this.escapeHtml(stackingPolicy.apply_stage_label || '订单优惠阶段')}</span>
                        <span class="shop-price-waterfall__policy-chip">优先级 ${this.escapeHtml(String(stackingPolicy.stack_priority || 100))}</span>
                    </div>
                </div>
                <div class="shop-price-waterfall__rows">
                    ${waterfallRows.map((row) => {
                        const tone = String(row?.tone || '').trim().toLowerCase() || 'base';
                        const rawAmount = Number(row?.display_amount ?? row?.amount);
                        const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
                        const prefix = amount > 0 && tone !== 'total' ? '+' : '';

                        return `
                            <div class="shop-price-waterfall__row shop-price-waterfall__row--${this.escapeHtml(tone)}">
                                <div class="shop-price-waterfall__row-copy">
                                    <strong>${this.escapeHtml(row?.label || '价格项')}</strong>
                                    ${row?.detail ? `<span>${this.escapeHtml(row.detail)}</span>` : ''}
                                </div>
                                <div class="shop-price-waterfall__row-value">${this.escapeHtml(`${prefix}${amount}`)}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="shop-price-waterfall__footer">${this.escapeHtml(stackingPolicy.summary || '当前仅支持单券结算。')}</div>
            </div>
        `;
    },

    calculateDiscountAmount: function (subtotal) {
        const discountType = this.currentPurchase.discountType;
        const discountValue = Number(this.currentPurchase.discountValue);
        if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
            return 0;
        }

        if (discountType === 'percent') {
            return Math.max(0, subtotal - Math.floor(subtotal * (discountValue / 100)));
        }

        if (discountType === 'fixed') {
            return Math.min(subtotal, discountValue);
        }

        return 0;
    },

    syncDiscountedTotal: function () {
        const subtotal = this.getCurrentPurchaseSubtotal();
        const discountAmount = this.calculateDiscountAmount(subtotal);
        const finalTotal = Math.max(0, subtotal - discountAmount);
        this.currentPurchase.discountAmount = discountAmount;
        document.getElementById('modalTotalPrice').textContent = finalTotal;
        this.syncPricingWaterfall();
        return {
            subtotal,
            discountAmount,
            finalTotal
        };
    },

    setDiscountAppliedMessage: function (discountAmount) {
        this.setDiscountMessage(
            `<i class="fas fa-check-circle" aria-hidden="true"></i><span>${window.i18n?.t('shop.discountApplied') || '已抵扣'} ${discountAmount} ${window.i18n?.t('shop.points') || '积分'}</span>`,
            { variant: 'success', html: true }
        );
    },

    resetDiscountState: function ({ clearMessage = true } = {}) {
        this.currentPurchase.discountCode = null;
        this.currentPurchase.discountAssetId = null;
        this.currentPurchase.discountType = null;
        this.currentPurchase.discountValue = null;
        this.currentPurchase.discountAmount = 0;
        this.currentPurchase.pricingWaterfall = [];
        this.currentPurchase.stackingPolicy = this.getDefaultStackingPolicy();
        document.getElementById('modalTotalPrice').textContent = this.getCurrentPurchaseSubtotal();
        this.syncPricingWaterfall();
        if (clearMessage) {
            this.setDiscountMessage('');
        }
        this.renderPurchaseDiscountAssets();
    },

    buildDiscountAssetCardMarkup: function (item = {}, { selected = false, claimable = false } = {}) {
        const label = claimable
            ? (item.can_claim ? '立即领取' : '已达上限')
            : (item.available ? (selected ? '已选中' : '直接使用') : '当前不可用');
        const metaParts = [];
        if (item.preview?.discount_amount > 0) {
            metaParts.push(`预计优惠 ${item.preview.discount_amount}`);
        }
        if (item.preview?.final_total >= 0) {
            metaParts.push(`实付 ${item.preview.final_total}`);
        }
        if (item.claim_expires_at) {
            metaParts.push(`领取至 ${new Date(item.claim_expires_at).toLocaleString()}`);
        } else if (item.expires_at) {
            metaParts.push(`有效至 ${new Date(item.expires_at).toLocaleString()}`);
        }
        if (item.source_channel) {
            metaParts.push(`渠道 ${item.source_channel}`);
        }

        return `
            <button type="button"
                class="shop-discount-asset-card${selected ? ' is-selected' : ''}${item.available === false && !claimable ? ' is-disabled' : ''}"
                data-shop-discount-action="${claimable ? 'claim' : 'apply'}"
                data-discount-asset-id="${this.escapeHtml(item.asset_id || '')}"
                data-discount-id="${this.escapeHtml(item.discount_id || '')}"
                data-discount-code="${this.escapeHtml(item.code || '')}"
                ${claimable ? (!item.can_claim ? 'disabled' : '') : (!item.available ? 'disabled' : '')}>
                <div class="shop-discount-asset-card__top">
                    <strong>${this.escapeHtml(item.code || '优惠券')}</strong>
                    <span class="shop-discount-asset-card__cta">${this.escapeHtml(label)}</span>
                </div>
                <div class="shop-discount-asset-card__meta">${this.escapeHtml(metaParts.join(' · ') || item.message || '可在当前商品结算时使用')}</div>
                ${item.message ? `<div class="shop-discount-asset-card__hint">${this.escapeHtml(item.message)}</div>` : ''}
            </button>
        `;
    },

    renderPurchaseDiscountAssets: function () {
        const container = document.getElementById('purchaseDiscountAssetsPanel');
        if (!container) return;

        const ownedItems = Array.isArray(this.currentPurchase.availableDiscountAssets)
            ? this.currentPurchase.availableDiscountAssets
            : [];
        const claimableItems = Array.isArray(this.currentPurchase.claimableDiscounts)
            ? this.currentPurchase.claimableDiscounts
            : [];

        if (!ownedItems.length && !claimableItems.length) {
            container.innerHTML = '<div class="shop-discount-assets-empty">当前没有可直接选择的卡券，仍可继续输入暗码。</div>';
            return;
        }

        container.innerHTML = `
            <div class="shop-discount-assets-shell">
                ${ownedItems.length ? `
                    <div class="shop-discount-assets-group">
                        <div class="shop-discount-assets-group__title">我的可用优惠</div>
                        <div class="shop-discount-assets-grid">
                            ${ownedItems.map((item) => this.buildDiscountAssetCardMarkup(item, {
                                selected: this.currentPurchase.discountAssetId && item.asset_id === this.currentPurchase.discountAssetId
                            })).join('')}
                        </div>
                    </div>
                ` : ''}
                ${claimableItems.length ? `
                    <div class="shop-discount-assets-group">
                        <div class="shop-discount-assets-group__title">可领取优惠</div>
                        <div class="shop-discount-assets-grid">
                            ${claimableItems.map((item) => this.buildDiscountAssetCardMarkup(item, { claimable: true })).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    },

    loadAvailableDiscountAssetsWithServer: async function () {
        const token = await this.getAccessToken();
        if (!token) {
            return {
                owned_discounts: [],
                claimable_discounts: []
            };
        }

        const response = await fetch('/api/shop/available-discounts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                productId: this.currentPurchase.productId,
                quantity: this.currentPurchase.quantity,
                agentId: this.currentAgentId,
                site: window.SiteConfig?.site || 'cn'
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || '加载优惠券失败');
        }

        return payload;
    },

    claimDiscountWithServer: async function (discountId) {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error(window.i18n?.t('shop.loginRequired') || '请先登录');
        }

        const response = await fetch('/api/shop/claim-discount', {
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

        const normalizeGuidancePayload = (data = {}) => ({
            loaded: true,
            purchaseNotes: typeof data?.purchase_notes === 'string'
                ? data.purchase_notes.trim()
                : '',
            usageInstructions: typeof data?.usage_instructions === 'string'
                ? data.usage_instructions.trim()
                : ''
        });

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
                    site: window.SiteConfig?.site || 'cn'
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
            const { data, error } = await client
                .from('shop_products')
                .select('show_purchase_notes, purchase_notes, show_usage_instructions, usage_instructions')
                .eq('id', normalizedProductId)
                .eq('is_active', true)
                .single();

            if (error) {
                throw error;
            }

            return normalizeGuidancePayload({
                purchase_notes: data?.show_purchase_notes ? data?.purchase_notes : '',
                usage_instructions: data?.show_usage_instructions ? data?.usage_instructions : ''
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

    applyDiscountPreviewState: function (preview = {}, { assetId = null, fallbackCode = '' } = {}) {
        this.currentPurchase.discountCode = String(preview.discount_code || fallbackCode || '').trim().toUpperCase() || null;
        this.currentPurchase.discountAssetId = assetId || null;
        this.currentPurchase.discountType = preview.discount_type || null;
        this.currentPurchase.discountValue = preview.discount_value ?? null;
        this.currentPurchase.stackingPolicy = preview?.stacking_policy && typeof preview.stacking_policy === 'object'
            ? {
                ...this.getDefaultStackingPolicy(),
                ...preview.stacking_policy
            }
            : this.getDefaultStackingPolicy();
        const codeInput = document.getElementById('purchaseDiscountCode');
        if (codeInput) {
            codeInput.value = this.currentPurchase.discountCode || '';
        }
        const { discountAmount } = this.syncDiscountedTotal();
        this.syncPricingWaterfall({
            rows: Array.isArray(preview?.pricing_waterfall) ? preview.pricing_waterfall : null,
            stackingPolicy: preview?.stacking_policy || null
        });
        this.setDiscountAppliedMessage(discountAmount);
        this.renderPurchaseDiscountAssets();
    },

    refreshAppliedDiscountPreview: async function ({ silent = true } = {}) {
        const currentCode = String(this.currentPurchase.discountCode || '').trim();
        if (!currentCode) {
            return;
        }

        const revision = Math.max(0, Number(this.currentPurchase.discountPreviewRevision || 0)) + 1;
        this.currentPurchase.discountPreviewRevision = revision;
        const discountAssetId = this.currentPurchase.discountAssetId || null;

        try {
            const validationPayload = await this.validateDiscountWithServer(currentCode, {
                discountAssetId
            });

            if (this.currentPurchase.discountPreviewRevision !== revision) {
                return;
            }

            this.applyDiscountPreviewState(validationPayload?.data || {}, {
                assetId: discountAssetId,
                fallbackCode: currentCode
            });
        } catch (error) {
            if (this.currentPurchase.discountPreviewRevision !== revision) {
                return;
            }

            const fallbackMessage = discountAssetId
                ? '已选卡券在当前数量下不可用，已取消使用'
                : '优惠码在当前数量下不可用，已取消使用';
            this.resetDiscountState({ clearMessage: false });
            this.setDiscountMessage(
                `<i class="fas fa-exclamation-triangle" aria-hidden="true"></i><span>${this.escapeHtml(error.message || fallbackMessage)}</span>`,
                { variant: silent ? 'warning' : 'error', html: true }
            );
        }
    },

    refreshPurchaseDiscountAssets: async function ({ silent = false } = {}) {
        try {
            const payload = await this.loadAvailableDiscountAssetsWithServer();
            this.currentPurchase.availableDiscountAssets = Array.isArray(payload?.owned_discounts) ? payload.owned_discounts : [];
            this.currentPurchase.claimableDiscounts = Array.isArray(payload?.claimable_discounts) ? payload.claimable_discounts : [];
            this.renderPurchaseDiscountAssets();
        } catch (error) {
            this.currentPurchase.availableDiscountAssets = [];
            this.currentPurchase.claimableDiscounts = [];
            this.renderPurchaseDiscountAssets();
            if (!silent) {
                this.setDiscountMessage(error.message || '优惠券列表加载失败', { variant: 'error' });
            }
        }
    },

    applyOwnedDiscountAsset: async function (assetId, discountCode) {
        const applyBtn = document.getElementById('applyDiscountBtn');
        if (applyBtn) {
            applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            applyBtn.disabled = true;
        }

        try {
            const validationPayload = await this.validateDiscountWithServer(discountCode, {
                discountAssetId: assetId
            });
            this.applyDiscountPreviewState(validationPayload?.data || {}, {
                assetId,
                fallbackCode: discountCode
            });
        } catch (error) {
            this.resetDiscountState({ clearMessage: false });
            this.setDiscountMessage(
                `<i class="fas fa-times-circle" aria-hidden="true"></i><span>${this.escapeHtml(error.message || '当前卡券不可用')}</span>`,
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
        try {
            await this.claimDiscountWithServer(discountId);
            await this.refreshPurchaseDiscountAssets({ silent: true });
            this.setDiscountMessage(
                `<i class="fas fa-check-circle" aria-hidden="true"></i><span>领取成功，已加入你的卡券包</span>`,
                { variant: 'success', html: true }
            );
        } catch (error) {
            this.setDiscountMessage(
                `<i class="fas fa-times-circle" aria-hidden="true"></i><span>${this.escapeHtml(error.message || '领取失败')}</span>`,
                { variant: 'error', html: true }
            );
        }
    },

    validateDiscountWithServer: async function (discountCode, options = {}) {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error(window.i18n?.t('shop.loginRequired') || '请先登录');
        }

        const response = await fetch('/api/shop/validate-discount', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                productId: this.currentPurchase.productId,
                quantity: this.currentPurchase.quantity,
                discountCode,
                discountAssetId: options.discountAssetId || this.currentPurchase.discountAssetId || null,
                agentId: this.currentAgentId,
                site: window.SiteConfig?.site || 'cn'
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || (window.i18n?.t('shop.verifyFailed') || '验证失败'));
        }

        return payload;
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

        const response = await fetch('/api/shop/purchase', {
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
                agentId: purchasePayload.agentId || null,
                site: purchasePayload.site || (window.SiteConfig?.site || 'cn'),
                idempotencyKey
            })
        });

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
        this.restoreCartState();
        this.renderCart();

        // Read URL parameters
        const urlParams = new URLSearchParams(window.location.search);

        // Agent Store Logic
        const agentParam = urlParams.get('agent');
        if (agentParam) {
            try {
                const { data } = await window.supabaseClient.from('profiles').select('id, username').eq('username', agentParam).single();
                if (data && data.id) {
                    this.currentAgentId = data.id;
                    this.currentAgentName = data.username;
                    console.log(`🛍️ Welcome to Agent Store: ${this.currentAgentName}`);

                    // Update Page Title and Hero Title if exists
                    document.title = `${this.currentAgentName} ${window.i18n?.t('shop.agentStore') || '的专属福利商店'}`;
                    const heroTitle = document.querySelector('.hero-title');
                    if (heroTitle) {
                        heroTitle.innerHTML = `<span class="shop-inline-store-title-icon"><i class="fas fa-store" aria-hidden="true"></i></span>${this.escapeHtml(this.currentAgentName)} ${window.i18n?.t('shop.agentStore') || '的专属福利商店'}`;
                    }

                    void this.ensureAgentPricesReadyInBackground();
                }
            } catch (err) {
                console.warn('Agent lookup failed:', err);
            }
        }

        const categoryParam = urlParams.get('category');
        if (categoryParam) {
            this.currentCategory = categoryParam;
            console.log(`🛍️ URL category parameter found: ${categoryParam}`);
        }

        // Check if we are on the shop page (by checking for the grid container)
        const container = document.getElementById('userShopGrid');
        const filtersContainer = document.getElementById('shopCategoryFilters');

        if (container) {
            // Fallback timeout - show error after 5 seconds if loading fails
            const fallbackTimer = setTimeout(() => {
                console.warn('🛍️ Shop loading timeout');
                container.innerHTML = this.buildShopStatusMessage(
                    window.i18n?.t('common.error') || '加载超时，请刷新重试',
                    { variant: 'error', fullSpan: true }
                );
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

                // Load category filters and products in parallel to avoid serial first-paint delays
                await Promise.all([
                    this.loadCategoryFilters(),
                    this.loadProducts()
                ]);

                // Clear prefetch references
                this._prefetchedCategories = null;
                if (usedPrefetch) {
                    void this.revalidatePrefetchedShopData();
                }

                clearTimeout(fallbackTimer);

            } catch (err) {
                console.error('🛍️ Shop loading error:', err);
                clearTimeout(fallbackTimer);
                container.innerHTML = this.buildShopStatusMessage(
                    window.i18n?.t('common.error') || '加载失败，请刷新重试',
                    { variant: 'error', fullSpan: true }
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
            this.loadCategoryFilters();
            this.loadProducts();
            this.renderCart();
            this.renderCartCheckoutModal();
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
                const addedQuantity = this.addProductToCart(target.dataset.productId || '', 1);
                if (addedQuantity > 0) {
                    this.trackProductAddToCartFromDataset(target.dataset, addedQuantity, sourceContext);
                }
                return;
            }

            if (action !== 'buy-product') {
                return;
            }

            this.openProductPurchaseFromDataset(target.dataset, sourceContext);
        });

        shopGrid?.addEventListener('keydown', (event) => {
            if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return;

            const target = event.target instanceof HTMLElement && event.target.matches('.shop-card[data-shop-action="buy-product"]')
                ? event.target
                : null;
            if (!target) return;

            event.preventDefault();
            this.openProductPurchaseFromDataset(target.dataset, resolveShopSourceContext());
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

        const purchaseModal = document.getElementById('shopPurchaseModal');
        purchaseModal?.addEventListener('click', (event) => {
            if (event.target === purchaseModal) {
                this.closePurchaseModal();
                return;
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
                event.preventDefault?.();
                this.proceedPurchaseConfirmation();
                return;
            }

            if (event.target instanceof Element && event.target.closest('#confirmPurchaseBtn')) {
                event.preventDefault?.();
                void this.confirmPurchase();
            }
        });

        document.getElementById('purchaseQuantity')?.addEventListener('input', (event) => {
            if (event.target instanceof HTMLInputElement) {
                this.onQuantityInput(event.target);
            }
        });

        document.getElementById('purchaseDiscountCode')?.addEventListener('input', (event) => {
            if (!(event.target instanceof HTMLInputElement)) return;
            event.target.value = event.target.value.toUpperCase();
            if (this.currentPurchase.discountCode && event.target.value.trim() !== this.currentPurchase.discountCode) {
                this.resetDiscountState();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;

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
                this.copyContent();
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

            const successOrderCopyBtn = event.target instanceof Element
                ? event.target.closest('[data-shop-success-action="copy-order-id"]')
                : null;
            if (successOrderCopyBtn) {
                event.preventDefault?.();
                void this.copySuccessCardContent(successOrderCopyBtn.dataset.shopCopyContent || '');
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

        document.getElementById('ordersList')?.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-shop-order-id][data-shop-order-content]')
                : null;
            if (!target) return;

            event.preventDefault?.();
            this.viewOrderContent(target.dataset.shopOrderId || '', target.dataset.shopOrderContent || '');
        });

        this.staticUiBindingsBound = true;
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

    isShopImageSource: function (value) {
        const trimmed = String(value || '').trim();
        return trimmed.startsWith('http://')
            || trimmed.startsWith('https://')
            || trimmed.startsWith('/')
            || trimmed.startsWith('data:image/');
    },

    getShopCardWaveOffsetMs: function (productId = '') {
        const input = String(productId || '');
        let hash = 0;
        for (let index = 0; index < input.length; index += 1) {
            hash = ((hash * 33) + input.charCodeAt(index)) >>> 0;
        }
        return (hash % 29) * 173;
    },

    getShopCardBreatheDelay: function (productId = '', timeMs = performance.now()) {
        const phaseMs = (timeMs + this.getShopCardWaveOffsetMs(productId)) % SHOP_CARD_BREATHE_DURATION_MS;
        return `-${(phaseMs / 1000).toFixed(3)}s`;
    },

    getShopCardWaveOffsetY: function (productId = '', timeMs = performance.now()) {
        const phaseMs = (timeMs + this.getShopCardWaveOffsetMs(productId)) % SHOP_CARD_BREATHE_DURATION_MS;
        const progress = phaseMs / SHOP_CARD_BREATHE_DURATION_MS;
        return -0.5 * SHOP_CARD_BREATHE_AMPLITUDE_PX * (1 - Math.cos(progress * Math.PI * 2));
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
        const trimmed = String(url || '').trim();
        if (!trimmed) return '';

        const { format = 'avif' } = options;

        if (trimmed.startsWith('data:image/') || trimmed.startsWith('/')) {
            return trimmed;
        }

        if (trimmed.includes('cdn.zaoyoe.com/prompts/') && !trimmed.includes('/thumb/')) {
            return trimmed.replace('/prompts/', '/prompts/thumb/');
        }

        if (
            trimmed.includes('supabase.co/storage/v1/object/public/')
            || trimmed.includes('supabase.co/storage/v1/render/image/public/')
        ) {
            try {
                const optimizedUrl = new URL(trimmed);
                if (optimizedUrl.pathname.includes('/storage/v1/object/public/')) {
                    optimizedUrl.pathname = optimizedUrl.pathname.replace(
                        '/storage/v1/object/public/',
                        '/storage/v1/render/image/public/'
                    );
                }
                optimizedUrl.searchParams.set('width', '480');
                optimizedUrl.searchParams.set('height', '320');
                optimizedUrl.searchParams.set('quality', '80');
                if (format) {
                    optimizedUrl.searchParams.set('format', format);
                } else {
                    optimizedUrl.searchParams.delete('format');
                }
                return optimizedUrl.toString();
            } catch (error) {
                console.warn('Failed to build shop image transform URL:', error);
            }
        }

        return trimmed;
    },

    warmShopCardLeadImages: function (products = []) {
        const leadProducts = (Array.isArray(products) ? products : [])
            .filter((product) => this.isShopImageSource(product?.icon_url))
            .slice(0, SHOP_GRID_EAGER_IMAGE_COUNT);

        leadProducts.forEach((product) => {
            const optimizedUrl = this.getOptimizedShopImageUrl(product?.icon_url);
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

        const primaryUrl = this.getOptimizedShopImageUrl(originalUrl);
        const transformFallbackUrl = this.getOptimizedShopImageUrl(originalUrl, { format: '' });

        cardImage.dataset.originalSrc = originalUrl;
        cardImage.dataset.transformFallbackSrc = transformFallbackUrl !== primaryUrl ? transformFallbackUrl : '';
        cardImage.dataset.fallbackStage = '';
        cardImage.src = primaryUrl;
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

        if (cardImage.dataset.fallbackStage !== 'original' && fallbackOriginalSrc && cardImage.src !== fallbackOriginalSrc) {
            cardImage.dataset.fallbackStage = 'original';
            cardImage.src = fallbackOriginalSrc;
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
        const normalizedProductId = String(productId || product?.id || '').trim();
        const resolvedProduct = product || this.getCachedProductById(normalizedProductId) || null;
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
            ? String(productSnapshot.purchase_notes || '').trim()
            : '';
        const fallbackPurchaseNotes = String(this.currentPurchase?.productId || '').trim() === normalizedProductId
            ? String(this.currentPurchase?.purchaseNotes || '').trim()
            : '';

        return {
            productId: normalizedProductId,
            displayName: normalizedDisplayName,
            orderId: String(orderId || '').trim(),
            createdAt: String(createdAt || '').trim(),
            quantity: Math.max(1, Number(quantity || 0) || 1),
            contentSegments: normalizedContentSegments,
            purchaseNotes: String(purchaseNotes || resolvedPurchaseNotes || fallbackPurchaseNotes).trim(),
            usageInstructions: String(usageInstructions || '').trim(),
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
        const quantityLabel = normalizedItem.quantity > 1 ? `数量 ${normalizedItem.quantity}` : '';
        const encodedItemContent = encodeURIComponent(contentSegments.join('\n'));
        const fullOrderId = String(normalizedItem.orderId || '').trim();
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
                                ${(fullOrderId || quantityLabel) ? `
                                    <div class="shop-success-item__footer-meta">
                                        ${fullOrderId ? `
                                            <div class="shop-success-item__submeta">
                                                <button
                                                    type="button"
                                                    class="shop-success-item__order-id"
                                                    data-shop-success-action="copy-order-id"
                                                    data-shop-copy-content="${encodeURIComponent(fullOrderId)}"
                                                    aria-label="复制订单号 ${this.escapeAttribute(fullOrderId)}"
                                                    title="点击复制订单号"
                                                >
                                                    <span class="shop-success-item__submeta-label">订单号</span>
                                                    <span class="shop-success-item__submeta-value">${this.escapeHtml(fullOrderId)}</span>
                                                </button>
                                            </div>
                                        ` : ''}
                                        ${quantityLabel ? `
                                            <div class="shop-success-item__meta shop-success-item__meta--inline">
                                                <span class="shop-success-item__tag shop-success-item__tag--quantity">${this.escapeHtml(quantityLabel)}</span>
                                            </div>
                                        ` : ''}
                                    </div>
                                ` : ''}
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
                            ${formattedCreatedAt ? `<div class="shop-success-item__time">下单于 ${this.escapeHtml(formattedCreatedAt)}</div>` : ''}
                        </div>
                    </div>
                </div>

                <div class="shop-success-item__body">
                    <div class="shop-success-item__disclosures">
                        <section
                            id="${this.escapeAttribute(contentPanelId)}"
                            class="shop-cart-item__panel shop-success-item__content-panel"
                            hidden
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

        const nextExpanded = panel.hidden;
        panel.hidden = !nextExpanded;
        surface.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
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
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
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
        this.backgroundPrefetchScheduled = false;

        if (this.backgroundPrefetchHandle) {
            if (typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(this.backgroundPrefetchHandle);
            } else {
                clearTimeout(this.backgroundPrefetchHandle);
            }
            this.backgroundPrefetchHandle = null;
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

    runAfterNextPaint: function (callback) {
        if (typeof callback !== 'function') return;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                callback();
            });
        });
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

    clearProductGridTransitionArtifacts: function (container = document.getElementById('userShopGrid')) {
        if (this.gridTransitionCleanupTimer) {
            clearTimeout(this.gridTransitionCleanupTimer);
            this.gridTransitionCleanupTimer = null;
        }

        if (!container) return;

        container.querySelectorAll('.shop-grid-transition-layer').forEach(layer => layer.remove());
        container.querySelectorAll('.shop-card-filter-enter, .shop-card-filter-exit, .shop-card-filter-moving, .shop-card-filter-hidden').forEach(card => {
            card.classList.remove(
                'shop-card-filter-enter',
                'shop-card-filter-enter--initial',
                'shop-card-filter-exit',
                'shop-card-filter-moving',
                'shop-card-filter-hidden',
                'shop-card-filter-motion-lock',
                'is-visible',
                'is-leaving'
            );
            card.style.transition = '';
            card.style.transform = '';
            card.style.opacity = '';
            this.setCssVariables(card, {
                '--shop-card-filter-delay': null,
                '--shop-card-shift-x': null,
                '--shop-card-shift-y': null
            });
        });
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

    buildProductCardElement: function (product, agentPrices = {}, index = 0, { waveTimeMs = performance.now() } = {}) {
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

        const el = document.createElement('div');
        el.className = `shop-card user-product-card breathing ${cartQuantity > 0 ? 'shop-card--in-cart' : ''}`;
        el.dataset.productId = productId;
        el.dataset.productCategory = String(product.category || '');
        this.setCssVariables(el, {
            '--breathe-delay': this.getShopCardBreatheDelay(productId, waveTimeMs),
            '--shop-card-filter-delay': null
        });

        const safeIconClass = this.escapeAttribute(product.icon_url || '');
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && product.name_en) ? product.name_en : product.name;
        const displayDesc = (currentLang === 'en' && product.description_en)
            ? product.description_en
            : (product.description || (window.i18n?.t('shop.noDescription') || '暂无描述'));
        const safeCardImageAlt = this.escapeAttribute(displayName || (window.i18n?.t('shop.productImage') || '商品封面'));
        const safeIconUrl = this.escapeAttribute(product.icon_url || '');
        const hasCoverImage = this.isShopImageSource(product.icon_url);
        const shouldLoadImageEagerly = index < SHOP_GRID_EAGER_IMAGE_COUNT;
        const iconHtml = product.icon_url?.startsWith('fa')
            ? `<i class="${safeIconClass} shop-card-icon shop-card-icon--font" aria-hidden="true"></i>`
            : (hasCoverImage
                ? `<img src="${safeIconUrl}" width="40" class="shop-card-thumb" alt="${safeCardImageAlt}" loading="lazy" decoding="async">`
                : '<i class="fas fa-box shop-card-icon shop-card-icon--fallback" aria-hidden="true"></i>');

        const stockCount = product.stock_count || 0;
        const noStock = stockCount <= 0;
        const stockLabel = noStock
            ? (window.i18n?.t('shop.noStock') || '无货')
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
        el.className = `shop-card user-product-card breathing ${pricingState.flashShadowClass} ${cartQuantity > 0 ? 'shop-card--in-cart' : ''}`.trim();
        if (!noStock) {
            el.classList.add('shop-card--interactive');
            el.dataset.shopAction = 'buy-product';
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
        } else {
            el.setAttribute('aria-disabled', 'true');
        }
        el.innerHTML = `
            <div class="shop-card-image">
                ${pricingState.flashSaleBadgeHtml}
                ${displayHtml}
                ${pricingState.agentBadgeHtml}
                <div class="shop-stock-badge shop-stock-badge--floating ${noStock ? 'out-of-stock' : 'in-stock'}">
                    ${stockLabel}
                </div>
            </div>

            <div class="shop-content-padding">
                <h3 class="shop-card-title">${this.escapeHtml(displayName)}</h3>
                <p class="shop-card-desc">${this.escapeHtml(displayDesc)}</p>

                <div class="shop-card-footer">
                    <div class="shop-card-price">${pricingState.priceHtml}</div>
                    <div class="shop-card-actions">
                        <button
                            type="button"
                            ${noStock ? 'disabled' : ''}
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
        `;

        if (!noStock) {
            this.applyShopPurchaseDataset(el, purchaseDataset);
            el.dataset.maxPurchaseQuantity = String(maxPurchaseQuantity);
        }

        const productImage = hasCoverImage ? el.querySelector('.shop-card-image-cover') : null;
        if (productImage) {
            productImage.loading = shouldLoadImageEagerly ? 'eager' : 'lazy';
            productImage.decoding = 'async';
            productImage.setAttribute('fetchpriority', shouldLoadImageEagerly ? 'high' : 'auto');
            if ('fetchPriority' in productImage) {
                productImage.fetchPriority = shouldLoadImageEagerly ? 'high' : 'auto';
            }
            productImage.addEventListener('error', () => {
                this.handleShopCardImageError(productImage, product.icon_url);
            });
            this.setShopCardImageSource(productImage, product.icon_url);
        }

        const cartTriggerButton = el.querySelector('.shop-card-cart-trigger[data-shop-action="add-product-to-cart"]');
        if (cartTriggerButton && !noStock) {
            this.applyShopPurchaseDataset(cartTriggerButton, purchaseDataset);
            cartTriggerButton.dataset.maxPurchaseQuantity = String(maxPurchaseQuantity);
        }
        return el;
    },

    buildProductCardElements: function (products, agentPrices = {}) {
        const renderedCards = [];
        const waveTimeMs = performance.now();
        (Array.isArray(products) ? products : []).forEach(product => {
            const card = this.buildProductCardElement(product, agentPrices, renderedCards.length, { waveTimeMs });
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
        const hadSkeletonCards = container.querySelectorAll('.skeleton-card').length > 0;
        const shouldAnimate = !this.prefersReducedMotion() && (existingCards.length > 0 || (!empty && cardElements.length > 0));
        const transitionId = ++this.gridTransitionSequence;
        const transitionStartTimeMs = performance.now();
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
                        waveOffsetY: this.getShopCardWaveOffsetY(productId, transitionStartTimeMs),
                        card
                    }];
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

        if (!shouldAnimate) {
            container.innerHTML = '';
            if (empty) {
                container.classList.add('is-empty');
                container.appendChild(this.buildEmptyStateElement());
            } else {
                container.classList.remove('is-empty');
                cardElements.forEach(card => container.appendChild(card));
            }
            return;
        }

        const cleanupAnimatedCards = ({ movingCards = [], enteringCards = [], overlay = null } = {}) => {
            movingCards.forEach(({ card, clone }) => {
                card?.classList.remove('shop-card-filter-hidden', 'shop-card-filter-moving', 'shop-card-filter-motion-lock');
                card && (card.style.transition = '');
                card && (card.style.transform = '');
                card && (card.style.opacity = '');
                card && this.setCssVariables(card, {
                    '--shop-card-filter-delay': null,
                    '--shop-card-shift-x': null,
                    '--shop-card-shift-y': null
                });
                clone?.remove();
            });

            enteringCards.forEach(card => {
                card.classList.remove('shop-card-filter-enter', 'shop-card-filter-enter--initial', 'shop-card-filter-motion-lock', 'is-visible');
                card.style.transition = '';
                card.style.transform = '';
                card.style.opacity = '';
                this.setCssVariables(card, {
                    '--shop-card-filter-delay': null,
                    '--shop-card-shift-x': null,
                    '--shop-card-shift-y': null
                });
            });

            const overlays = Array.isArray(overlay) ? overlay : [overlay].filter(Boolean);
            overlays.forEach(layer => layer?.remove());
        };

        const scheduleCleanup = (durationMs, payload = {}) => {
            if (durationMs <= 0) {
                cleanupAnimatedCards(payload);
                return;
            }

            this.gridTransitionCleanupTimer = window.setTimeout(() => {
                if (transitionId !== this.gridTransitionSequence) return;
                cleanupAnimatedCards(payload);
                this.gridTransitionCleanupTimer = null;
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
                    'breathing',
                    'is-visible',
                    'is-leaving'
                );
                clone.classList.add('shop-card-transition-clone', 'shop-card-transition-clone--exit');
                clone.style.width = `${previousState.width}px`;
                clone.style.height = `${previousState.height}px`;
                clone.style.left = `${previousState.left}px`;
                clone.style.top = `${previousState.top}px`;
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

            container.innerHTML = '';
            if (empty) {
                container.classList.add('is-empty');
                container.appendChild(this.buildEmptyStateElement());
                return {
                    movingCards: [],
                    enteringCards: [],
                    cleanupDurationMs: 0,
                    overlay: []
                };
            }

            container.classList.remove('is-empty');
            cardElements.forEach(card => container.appendChild(card));

            const movingCards = [];
            const moveOverlay = document.createElement('div');
            moveOverlay.className = 'shop-grid-transition-layer';
            moveOverlay.setAttribute('aria-hidden', 'true');
            let moveOrder = 0;
            cardElements.forEach(card => {
                const productId = String(card.dataset.productId || '').trim();
                const previousState = previousCardState.get(productId);
                if (!previousState) return;

                const moveX = card.offsetLeft - previousState.left;
                const moveY = card.offsetTop - previousState.top;
                if (Math.abs(moveX) < 1 && Math.abs(moveY) < 1) return;

                const clone = previousState.card.cloneNode(true);
                clone.classList.remove(
                    'shop-card-filter-enter',
                    'shop-card-filter-exit',
                    'shop-card-filter-moving',
                    'shop-card-filter-hidden',
                    'shop-card-filter-motion-lock',
                    'breathing',
                    'is-visible',
                    'is-leaving'
                );
                clone.classList.add('shop-card-transition-clone', 'shop-card-transition-clone--moving');
                clone.style.width = `${previousState.width}px`;
                clone.style.height = `${previousState.height}px`;
                clone.style.left = `${previousState.left}px`;
                clone.style.top = `${previousState.top}px`;
                clone.style.transform = `translate3d(0px, ${previousState.waveOffsetY}px, 0) scale(1)`;
                this.setCssVariables(clone, {
                    '--shop-card-filter-delay': `${moveOrder * 18}ms`
                });
                moveOverlay.appendChild(clone);

                card.classList.add('shop-card-filter-hidden', 'shop-card-filter-motion-lock');
                movingCards.push({ card, clone, productId, moveX, moveY });
                moveOrder += 1;
            });
            const moveOverlayNode = moveOverlay.childElementCount > 0 ? moveOverlay : null;
            if (moveOverlayNode) {
                container.appendChild(moveOverlayNode);
            }

            const isInitialEntrance = previousIds.size === 0 && hadSkeletonCards;
            const enterDelayStepMs = isInitialEntrance ? 136 : 38;
            const enterDurationBaseMs = isInitialEntrance ? 1540 : 620;
            const effectiveEnterDelayBase = enterDelayBase;
            let enterOrder = 0;
            cardElements.forEach(card => {
                const productId = String(card.dataset.productId || '').trim();
                if (previousIds.has(productId)) {
                    return;
                }

                card.classList.add('shop-card-filter-enter', 'shop-card-filter-motion-lock');
                if (isInitialEntrance) {
                    card.classList.add('shop-card-filter-enter--initial');
                }
                this.setCssVariables(card, {
                    '--shop-card-filter-delay': `${effectiveEnterDelayBase + (enterOrder * enterDelayStepMs)}ms`
                });
                enterOrder += 1;
            });

            const enteringCards = Array.from(container.querySelectorAll('.shop-card-filter-enter'));
            if (movingCards.length === 0 && enteringCards.length === 0) {
                return {
                    movingCards,
                    enteringCards,
                    cleanupDurationMs: 0,
                    overlay: moveOverlayNode ? [moveOverlayNode] : []
                };
            }

            const moveDurationMs = movingCards.length > 0
                ? 860 + Math.max(0, movingCards.length - 1) * 12
                : 0;
            const enterDurationMs = enteringCards.length > 0
                ? effectiveEnterDelayBase + enterDurationBaseMs + Math.max(0, enteringCards.length - 1) * enterDelayStepMs
                : 0;
            const cleanupDurationMs = Math.max(moveDurationMs, enterDurationMs);
            const revealTimeMs = transitionStartTimeMs + cleanupDurationMs;

            movingCards.forEach((entry) => {
                entry.targetShiftY = entry.moveY + this.getShopCardWaveOffsetY(entry.productId, revealTimeMs);
            });

            void container.offsetWidth;
            if (transitionId === this.gridTransitionSequence) {
                movingCards.forEach(({ clone, moveX, targetShiftY = 0 }) => {
                    if (!clone) return;
                    clone.style.transform = `translate3d(${moveX}px, ${targetShiftY}px, 0) scale(1)`;
                });
                enteringCards.forEach(card => card.classList.add('is-visible'));
            }

            return {
                movingCards,
                enteringCards,
                cleanupDurationMs,
                overlay: moveOverlayNode ? [moveOverlayNode] : []
            };
        };

        const exitingCards = existingCards.filter(card => {
            const productId = String(card.dataset.productId || '').trim();
            return productId && !nextIds.has(productId);
        });
        const persistentCount = existingCards.length - exitingCards.length;

        if (exitingCards.length === 0) {
            const payload = renderNextState() || {};
            scheduleCleanup(payload.cleanupDurationMs || 0, payload);
            return;
        }

        if (!empty && persistentCount > 0) {
            const payload = renderNextState({ enterDelayBase: 0 }) || {};
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
        this.gridTransitionCleanupTimer = window.setTimeout(() => {
            if (transitionId !== this.gridTransitionSequence) return;
            this.gridTransitionCleanupTimer = null;
            const payload = renderNextState() || {};
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
    },

    renderEmptyState: function () {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        this.clearProductGridTransitionArtifacts(container);
        container.classList.add('is-empty');
        container.innerHTML = '';
        container.appendChild(this.buildEmptyStateElement());
    },

    fetchProductsFromServer: async function (category = 'all') {
        const client = window.supabaseClient || supabaseClient;
        let query = client
            .from('shop_products')
            .select('*')
            .eq('is_active', true)
            .order('display_order', { ascending: false });

        if (category !== 'all') {
            query = query.eq('category', category);
        }

        const result = await query;
        if (result.error) throw result.error;
        return this.filterProductsForCurrentSite(result.data || []);
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

    getAgentPrices: async function () {
        if (!this.currentAgentId) return {};

        if (this.agentPricesCache) {
            return this.agentPricesCache;
        }

        if (this.agentPricesPromise) {
            return this.agentPricesPromise;
        }

        const client = window.supabaseClient || supabaseClient;
        const request = client
            .from('agent_prices')
            .select('product_id, custom_price')
            .eq('agent_id', this.currentAgentId)
            .then(({ data, error }) => {
                if (error) throw error;

                const agentPrices = {};
                (data || []).forEach(ap => {
                    agentPrices[ap.product_id] = ap.custom_price;
                });

                this.agentPricesCache = agentPrices;
                return agentPrices;
            })
            .finally(() => {
                if (this.agentPricesPromise === request) {
                    this.agentPricesPromise = null;
                }
            });

        this.agentPricesPromise = request;
        return request;
    },

    ensureAgentPricesReadyInBackground: function () {
        if (!this.currentAgentId) {
            return Promise.resolve({});
        }

        if (this.agentPricesCache) {
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
                    await this.loadProducts({ forceRefresh: true });
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
            let categories = null;
            const { data, error } = await supabaseClient
                .from('shop_categories')
                .select('*')
                .order('sort_order');
            console.log('🛍️ Shop categories from DB:', { data, error });
            if (!error && Array.isArray(data) && data.length > 0) {
                categories = data;
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

            // Clear skeleton placeholders and rebuild all buttons
            container.innerHTML = '';

            const allBtn = document.createElement('button');
            allBtn.type = 'button';
            allBtn.className = this.currentCategory === 'all' ? 'filter-tab active' : 'filter-tab';
            allBtn.textContent = window.i18n?.t('shop.allCategories') || '全部';
            allBtn.setAttribute('data-i18n', 'shop.allCategories');
            allBtn.dataset.shopCategory = 'all';
            container.appendChild(allBtn);

            // Add dynamic category buttons
            categories.forEach(cat => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = this.currentCategory === cat.name ? 'filter-tab active' : 'filter-tab';
                btn.textContent = cat.name;
                btn.dataset.shopCategory = cat.name;
                container.appendChild(btn);
            });

        } catch (e) {
            console.error('Failed to load category filters:', e);
            // On error, show a simple "全部" button
            container.innerHTML = '';
            const fallbackBtn = document.createElement('button');
            fallbackBtn.type = 'button';
            fallbackBtn.className = 'filter-tab active';
            fallbackBtn.textContent = window.i18n?.t('shop.allCategories') || '全部';
            fallbackBtn.setAttribute('data-i18n', 'shop.allCategories');
            fallbackBtn.dataset.shopCategory = 'all';
            container.appendChild(fallbackBtn);
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
                return;
            }

            this.warmShopCardLeadImages(data);
            const renderedCards = this.buildProductCardElements(data, agentPrices);
            if (renderedCards.length === 0) {
                this.transitionProductGrid(container, [], { empty: true });
                this.renderCart();
                this.scheduleBackgroundProductPrefetch();
                return;
            }

            this.transitionProductGrid(container, renderedCards);
            this.lastSkeletonCount = Math.min(Math.max(renderedCards.length, 3), 8);
            this.renderCart();
            this.scheduleBackgroundProductPrefetch();

        } catch (err) {
            if (requestToken !== this.productsRequestToken) return;
            this.clearProductGridTransitionArtifacts(container);
            container.classList.remove('is-empty');
            container.innerHTML = this.buildShopStatusMessage(
                `${window.i18n?.t('common.error') || '加载失败'}: ${err.message || ''}`,
                { variant: 'error', fullSpan: true }
            );
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
        quantity: 1,
        orderId: null,
        createdAt: null,
        rules: [],
        discountCode: null,
        discountAssetId: null,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        pricingWaterfall: [],
        stackingPolicy: null,
        availableDiscountAssets: [],
        claimableDiscounts: [],
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

    getPurchaseModalStableViewportProbe: function () {
        if (this.purchaseModalKeyboardStableViewportProbe?.isConnected) {
            return this.purchaseModalKeyboardStableViewportProbe;
        }

        const probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.className = 'shop-purchase-viewport-probe';
        document.body.appendChild(probe);
        this.purchaseModalKeyboardStableViewportProbe = probe;
        return probe;
    },

    getPurchaseModalStableViewportHeight: function () {
        const probe = this.getPurchaseModalStableViewportProbe();
        if (!probe) return 0;
        return Math.max(0, Math.round(probe.getBoundingClientRect().height || probe.offsetHeight || 0));
    },

    lockPurchaseModalKeyboardPage: function () {
        if (this.purchaseModalOwnsFullScrollLock || !window.iOSScrollLock) return;
        const { card } = this.getPurchaseModalElements();
        if (!card) return;

        window.iOSScrollLock.lock(card, {
            freezeScrollY: Math.max(0, Math.round(this.purchaseModalBaseScrollY || window.scrollY || window.pageYOffset || 0))
        });
        this.purchaseModalOwnsFullScrollLock = true;
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
        this.purchaseModalKeyboardPendingInset = 0;
    },

    togglePurchaseModalSheetAnimation: function (card, animate, duration = 200) {
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
        const vv = window.visualViewport;
        const { card } = this.getPurchaseModalElements();
        const visualHeight = Math.max(0, vv?.height || 0);
        const fallbackBaseHeight = Math.max(
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            visualHeight
        );
        const stableViewportHeight = this.getPurchaseModalStableViewportHeight();
        const normalizedBaseHeight = (stableViewportHeight > 0 && stableViewportHeight + 24 < fallbackBaseHeight)
            ? stableViewportHeight
            : fallbackBaseHeight;

        this.purchaseModalKeyboardBaseViewportHeight = normalizedBaseHeight;
        if (card) {
            const cardHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 420);
            this.purchaseModalKeyboardBaseCardHeight = Math.max(320, cardHeight || 420);
        }
    },

    getPurchaseModalViewportMetrics: function () {
        const vv = window.visualViewport;
        const visualHeight = Math.max(0, vv?.height || 0);
        const baseVisualHeight = this.purchaseModalKeyboardBaseViewportHeight || visualHeight;

        return {
            visualHeight,
            baseVisualHeight,
            bottomInset: Math.max(0, Math.round(baseVisualHeight - visualHeight))
        };
    },

    applyPurchaseModalKeyboardDock: function (bottomInset, animate = false) {
        const { overlay, card } = this.getPurchaseModalElements();
        if (!overlay || !card) return;

        const metrics = this.getPurchaseModalViewportMetrics();
        if (!this.purchaseModalKeyboardBaseCardHeight) {
            const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 420);
            this.purchaseModalKeyboardBaseCardHeight = Math.max(320, liveHeight || 420);
        }

        const baseCardHeight = Math.max(320, this.purchaseModalKeyboardBaseCardHeight || 420);
        const baseViewportHeight = Math.max(metrics.baseVisualHeight || 0, this.purchaseModalKeyboardBaseViewportHeight || 0);
        const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
        const minTop = 14;
        const keyboardClearance = 40;
        const maxAvailableHeight = Math.max(280, Math.round(keyboardTop - minTop - keyboardClearance));
        const dockHeight = Math.min(baseCardHeight, maxAvailableHeight);
        const centeredTop = (baseViewportHeight - dockHeight) / 2;
        const desiredTop = Math.max(minTop, keyboardTop - keyboardClearance - dockHeight);
        const translateY = Math.round(desiredTop - centeredTop);

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
        this.releasePurchaseModalKeyboardDock();
        this.purchaseModalKeyboardBaseViewportHeight = 0;
        this.purchaseModalKeyboardBaseCardHeight = 0;
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
        const shouldDock = !!activeInput && (this.purchaseModalKeyboardDocked ? bottomInset > 8 : bottomInset > 24);
        const nextInset = shouldDock ? bottomInset : 0;
        const previousInset = this.purchaseModalKeyboardLastBottomInset;
        const isInsetDroppingWhileFocused = this.purchaseModalKeyboardDocked && !!activeInput && nextInset > 24 && nextInset + 24 < previousInset;

        if (!this.purchaseModalKeyboardDocked && shouldDock) {
            this.lockPurchaseModalKeyboardPage();
            this.purchaseModalKeyboardPendingInset = nextInset;
            if (!this.purchaseModalKeyboardInitialDockTimer) {
                this.purchaseModalKeyboardInitialDockTimer = setTimeout(() => {
                    this.purchaseModalKeyboardInitialDockTimer = null;
                    if (!this.getActivePurchaseModalInput()) return;
                    const liveMetrics = this.getPurchaseModalViewportMetrics();
                    if (liveMetrics.bottomInset <= 24) return;
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
            this.purchaseModalKeyboardPendingInset = nextInset;
            if (!this.purchaseModalKeyboardInsetDropTimer) {
                this.purchaseModalKeyboardInsetDropTimer = setTimeout(() => {
                    this.purchaseModalKeyboardInsetDropTimer = null;
                    const settledInset = this.purchaseModalKeyboardPendingInset;
                    this.purchaseModalKeyboardPendingInset = 0;
                    if (settledInset > 24) {
                        this.applyPurchaseModalKeyboardDock(settledInset, true);
                    }
                }, 90);
            }
            return;
        }

        if (this.purchaseModalKeyboardDocked && activeInput && nextInset <= 24) {
            return;
        }

        if (nextInset > 24) {
            this.applyPurchaseModalKeyboardDock(nextInset, true);
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
                this.syncPurchaseModalKeyboardDock();
            });
        };

        vv.addEventListener('resize', handleViewportChange, { passive: true });
        inputs.forEach((input) => {
            input.addEventListener('focus', handleViewportChange);
            input.addEventListener('blur', handleViewportChange);
        });

        this.purchaseModalKeyboardViewportCleanup = () => {
            vv.removeEventListener('resize', handleViewportChange);
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

    buyProduct: async function (productId, productName, productNameEn, price, rulesStr, maxPurchaseQuantity = 99, showPurchaseNotes = false, purchaseNotesEncoded = '', showUsageInstructions = false, usageInstructionsEncoded = '', productCategory = '', sourceContext = null) {
        const rules = rulesStr ? JSON.parse(decodeURIComponent(rulesStr)) : [];
        let purchaseNotes = showPurchaseNotes ? decodeURIComponent(purchaseNotesEncoded || '') : '';
        let usageInstructions = showUsageInstructions ? decodeURIComponent(usageInstructionsEncoded || '') : '';
        const liveProduct = this.getCachedProductById(productId);
        const quantityCap = this.getPurchaseQuantityCapForProduct(liveProduct, maxPurchaseQuantity);

        this.openPurchaseModal(productId, productName, productNameEn, price, rules, quantityCap, purchaseNotes, usageInstructions, {
            category: productCategory,
            sourceContext
        });
        void this.refreshCurrentPurchaseGuidance(productId);
        void this.syncPurchaseAccessAfterOpen(productId, quantityCap);
    },

    openPurchaseModal: function (productId, productName, productNameEn, price, rules, maxPurchaseQuantity = 99, purchaseNotes = '', usageInstructions = '', options = {}) {
        const quantityCap = this.normalizePurchaseQuantityCap(maxPurchaseQuantity);
        const unlimitedPurchases = options?.unlimitedPurchases === true;
        const initialQuantity = Math.max(1, Math.min(quantityCap, Math.trunc(Number(options?.initialQuantity || 1) || 1)));
        const sourceContext = {
            ...resolveShopSourceContext(),
            ...(options?.sourceContext && typeof options.sourceContext === 'object' ? options.sourceContext : {})
        };
        this.currentPurchase = {
            productId,
            productName,
            productNameEn,
            productCategory: String(options?.category || options?.productCategory || '').trim() || null,
            basePrice: price,
            unitPrice: price,
            quantity: initialQuantity,
            orderId: null,
            createdAt: null,
            rules: rules,
            discountCode: null,
            discountAssetId: null,
            discountType: null,
            discountValue: null,
            discountAmount: 0,
            pricingWaterfall: [],
            stackingPolicy: this.getDefaultStackingPolicy(),
            availableDiscountAssets: [],
            claimableDiscounts: [],
            discountPreviewRevision: 0,
            stage: 'configure',
            purchaseNotes: typeof purchaseNotes === 'string' ? purchaseNotes.trim() : '',
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
        this.purchaseModalBaseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
        this.purchaseModalOwnsFullScrollLock = false;

        // Update UI - show name based on current language
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && productNameEn) ? productNameEn : productName;
        this.renderModalProductName(displayName);
        document.getElementById('modalUnitPrice').textContent = price;
        document.getElementById('modalTotalPrice').textContent = price * initialQuantity;
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
        this.currentPurchase.availableDiscountAssets = [];
        this.currentPurchase.claimableDiscounts = [];
        this.renderPurchaseDiscountAssets();
        this.updatePriceForQuantity(initialQuantity);
        if (applyBtn) {
            applyBtn.innerHTML = window.i18n?.t('shop.verify') || '验证';
            applyBtn.disabled = false;
        }

        const modal = document.getElementById('shopPurchaseModal');
        modal.classList.remove('active');
        this.renderPurchaseNotes();
        this.renderPurchaseConfirmationStage();
        this.setPurchaseStage('configure');

        // Flush the inactive layout first so newly revealed notes can join the stagger animation on first open.
        void modal.offsetHeight;

        // Show Modal
        modal.classList.add('active');
        // Lock background scroll on mobile Safari
        if (window.iOSScrollLock) window.iOSScrollLock.lockLight(modal);
        this.attachPurchaseModalKeyboardDock();
        void this.refreshPurchaseDiscountAssets({ silent: true });

        trackShopAnalyticsEvent('shop_view', {
            entityId: String(productId || '').trim() || null,
            eventValue: Number(price || 0) || null,
            metadata: buildShopTrackingMetadata({
                product_id: String(productId || '').trim() || null,
                product_name: productName || null,
                product_name_en: productNameEn || null,
                category: String(options?.category || options?.productCategory || '').trim() || null,
                unit_price: Number(price || 0) || null,
                max_purchase_quantity: quantityCap,
                has_purchase_notes: Boolean(purchaseNotes),
                has_usage_instructions: Boolean(usageInstructions)
            }, sourceContext)
        }, {
            eventType: 'engagement'
        });

        trackShopAnalyticsEvent('product_detail_view', {
            entityId: String(productId || '').trim() || null,
            eventValue: Number(price || 0) || null,
            metadata: buildShopTrackingMetadata({
                product_id: String(productId || '').trim() || null,
                product_name: productName || null,
                product_name_en: productNameEn || null,
                category: String(options?.category || options?.productCategory || '').trim() || null,
                unit_price: Number(price || 0) || null,
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
        const activeInput = this.getActivePurchaseModalInput();
        activeInput?.blur();
        this.clearPurchaseNotesWheelIsolation();
        this.detachPurchaseModalKeyboardDock();
        this.resetPurchaseModalKeyboardDockState();
        modal.classList.remove('active');
        modal.classList.remove('has-purchase-notes');
        // Unlock background scroll on mobile Safari
        if (window.iOSScrollLock) window.iOSScrollLock.unlock();
        this.purchaseModalOwnsFullScrollLock = false;
        this.purchaseModalBaseScrollY = 0;
    },

    updatePriceForQuantity: function (qty) {
        let unitPrice = this.currentPurchase.basePrice;
        if (this.currentPurchase.rules && this.currentPurchase.rules.length > 0) {
            this.currentPurchase.rules.forEach(rule => {
                if (qty >= rule.qty && rule.price < unitPrice) {
                    unitPrice = rule.price;
                }
            });
        }
        this.currentPurchase.unitPrice = unitPrice;

        // Show wholesale UI feedback dynamically
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && this.currentPurchase.productNameEn) ? this.currentPurchase.productNameEn : this.currentPurchase.productName;

        this.renderModalProductName(displayName, { wholesale: unitPrice < this.currentPurchase.basePrice });

        document.getElementById('modalUnitPrice').textContent = unitPrice;

        let total = qty * unitPrice;

        if (this.currentPurchase.discountCode && this.currentPurchase.discountType) {
            document.getElementById('modalTotalPrice').textContent = total;
            this.setDiscountMessage(
                '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>正在重算当前优惠...</span>',
                { variant: 'info', html: true }
            );
            this.syncPricingWaterfall();
            void this.refreshAppliedDiscountPreview({ silent: true });
        } else {
            document.getElementById('modalTotalPrice').textContent = total;
            this.syncPricingWaterfall();
        }

        void this.refreshPurchaseDiscountAssets({ silent: true });

        return total;
    },

    applyDiscount: async function (silent = false) {
        const codeInputElem = document.getElementById('purchaseDiscountCode');
        const codeInput = codeInputElem ? codeInputElem.value.trim() : '';
        const applyBtn = document.getElementById('applyDiscountBtn');

        if (!codeInput) {
            if (!silent) {
                this.setDiscountMessage(window.i18n?.t('shop.enterDiscountCode') || '请输入优惠码', { variant: 'error' });
            }
            this.resetDiscountState({ clearMessage: false });
            return;
        }

        if (applyBtn && !silent) {
            applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            applyBtn.disabled = true;
        }

        try {
            this.currentPurchase.discountAssetId = null;
            const validationPayload = await this.validateDiscountWithServer(codeInput);
            this.applyDiscountPreviewState(validationPayload?.data || {}, {
                assetId: null,
                fallbackCode: codeInput
            });

        } catch (err) {
            if (!silent) {
                this.setDiscountMessage(
                    `<i class="fas fa-times-circle" aria-hidden="true"></i><span>${this.escapeHtml(err.message || (window.i18n?.t('shop.verifyFailed') || '验证失败'))}</span>`,
                    { variant: 'error', html: true }
                );
            }
            this.resetDiscountState({ clearMessage: false });
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
            const rawUsageInstructions = String(responseData.usage_instructions || entry?.product?.usage_instructions || '').trim();
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
                purchaseNotes: entry?.product?.show_purchase_notes === true ? (entry?.product?.purchase_notes || '') : '',
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
                    discountCode: null,
                    discountAssetId: null,
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
                purchaseNotes: '',
                usageInstructions: successPayload.usageInstructions || '',
                cartOrigin: null
            };

            this.closeCartCheckoutModal();
            this.setCartOpen(false);
            this.renderCart();
            this.showSuccessModal(successPayload.content, warningMessage, successPayload.usageInstructions, successPayload.items);

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
            if (window.WalletModal?.open) {
                setTimeout(() => window.WalletModal.open('recharge', {
                    entry: 'shop_cart_insufficient_points',
                    sourceModule: 'shop_client'
                }), 300);
            }
            return;
        }

        this.showShopToast(`❌ ${errorMessage}`, 'error');
    },

    confirmPurchase: async function () {
        const token = await this.getAccessToken();
        if (!token) {
            this.promptLoginForPurchase(window.i18n?.t('shop.loginRequired') || '请先登录再进行兑换');
            return;
        }

        // Disable button
        const btn = document.getElementById('confirmPurchaseBtn');
        const backBtn = document.getElementById('purchaseBackBtn');
        const originalText = btn.innerHTML;
        const processingText = window.i18n?.t('shop.processing') || '处理中...';
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${processingText}</span>`;
        btn.disabled = true;
        if (backBtn) {
            backBtn.disabled = true;
        }

        try {
            const subtotal = Number(this.getCurrentPurchaseSubtotal?.() || 0) || 0;
            const discountAmount = Number(this.currentPurchase?.discountAmount || 0) || 0;
            const tentativeTotalPoints = Math.max(0, subtotal - discountAmount) || null;
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
            const purchaseSuccessMetadata = buildShopTrackingMetadata({
                order_id: String(lastOrderId || '').trim() || null,
                product_id: String(this.currentPurchase?.productId || '').trim() || null,
                product_name: this.currentPurchase?.productName || null,
                product_name_en: this.currentPurchase?.productNameEn || null,
                category: this.currentPurchase?.productCategory || null,
                quantity: Number(this.currentPurchase?.quantity || 0) || 1,
                unit_price: Number(this.currentPurchase?.unitPrice || 0) || null,
                subtotal_points: subtotal || null,
                discount_code: this.currentPurchase?.discountCode || null,
                discount_amount: discountAmount || null,
                total_points: totalPointsSpent || null,
                has_usage_instructions: Boolean(usageInstructions)
            }, purchaseSourceContext);
            trackShopAnalyticsEvent('product_purchase_success', {
                entityType: 'shop_order',
                entityId: String(lastOrderId || this.currentPurchase?.productId || '').trim() || null,
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
                entityId: String(lastOrderId || this.currentPurchase?.productId || '').trim() || null,
                eventValue: totalPointsSpent || null,
                pointsDelta: totalPointsSpent > 0 ? -Math.abs(totalPointsSpent) : null,
                metadata: purchaseSuccessMetadata
            }, {
                eventType: 'conversion',
                dedupeKey: String(lastOrderId || '').trim() ? `shop_purchase:${String(lastOrderId).trim()}` : ''
            });

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
            await this.loadProducts({ forceRefresh: true }); // Always refresh stock first

            const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
            const successItems = [
                this.buildSuccessModalItemPayload({
                    productId: this.currentPurchase?.productId,
                    displayName: currentLang === 'en'
                        ? (this.currentPurchase?.productNameEn || this.currentPurchase?.productName || '')
                        : (this.currentPurchase?.productName || this.currentPurchase?.productNameEn || ''),
                    orderId: lastOrderId,
                    createdAt,
                    quantity: Number(this.currentPurchase?.quantity || 0) || 1,
                    content: finalContent,
                    purchaseNotes: this.currentPurchase?.purchaseNotes || '',
                    usageInstructions,
                    product: this.getCachedProductById(this.currentPurchase?.productId)
                })
            ];

            this.showSuccessModal(finalContent, null, usageInstructions, successItems);

            // Update Points UI
            if (window.updateUserPointsUI && remainingPoints != null) {
                window.updateUserPointsUI(remainingPoints);
                if (window.checkAuthState) window.checkAuthState();
            }

        } catch (err) {
            console.error(err);
            const errMsg = (err.message || (window.i18n?.t('shop.unknownError') || '未知错误'));
            const isDuplicateSubmission = err?.code === 'duplicate_submission';

            // If insufficient points, show toast and open wallet for recharging
            if (errMsg.includes('积分') || errMsg.includes('余额') || errMsg.includes('nsufficient') || errMsg.includes('balance')) {
                this.closePurchaseModal();
                // Show a visible toast notification instead of native alert
                if (window.WalletModal && window.WalletModal.showToast) {
                    window.WalletModal.showToast(`❌ ${window.i18n?.t('shop.insufficientPoints') || '积分不足，请先充值'}`, 'error');
                }
                // Open wallet modal for recharging
                if (window.WalletModal && window.WalletModal.open) {
                    setTimeout(() => window.WalletModal.open('recharge', {
                        entry: 'shop_insufficient_points',
                        sourceModule: 'shop_client'
                    }), 300);
                }
            } else {
                // For other errors, show toast in the purchase modal
                if (window.WalletModal && window.WalletModal.showToast) {
                    const redeemFailedLabel = window.i18n?.t('shop.redeemFailed') || '兑换失败';
                    const normalizedErrMsg = String(errMsg || '').trim();
                    const toastMessage = !normalizedErrMsg || normalizedErrMsg === redeemFailedLabel
                        ? `❌ ${redeemFailedLabel}`
                        : (normalizedErrMsg.startsWith(`${redeemFailedLabel}:`)
                            ? `❌ ${normalizedErrMsg}`
                            : `❌ ${redeemFailedLabel}: ${normalizedErrMsg}`);
                    window.WalletModal.showToast(toastMessage, 'error');
                }
            }

            if (!isDuplicateSubmission) {
                this.currentPurchase.idempotencyKey = this.createPurchaseIdempotencyKey();
            }

            // Re-enable button on error
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (backBtn) {
                backBtn.disabled = false;
            }
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

    renderPurchaseNotes: function () {
        const modal = document.getElementById('shopPurchaseModal');
        const notesBox = document.getElementById('purchaseNotesBox');
        const notesContent = document.getElementById('purchaseNotesContent');
        const notesTitle = document.getElementById('purchaseNotesTitle');
        const normalizedPurchaseNotes = typeof this.currentPurchase?.purchaseNotes === 'string'
            ? this.currentPurchase.purchaseNotes.trim()
            : '';
        const hasPurchaseNotes = normalizedPurchaseNotes.length > 0;

        this.clearPurchaseNotesWheelIsolation();

        if (modal) {
            modal.classList.toggle('has-purchase-notes', hasPurchaseNotes);
        }

        if (!notesBox || !notesContent) return;

        if (hasPurchaseNotes) {
            const renderedNotes = this.renderStoredRichText(normalizedPurchaseNotes);
            notesContent.innerHTML = renderedNotes;
            if (notesTitle) {
                notesTitle.textContent = window.i18n?.t('shop.purchaseNotes') || '注意事项';
            }
            this.setElementHidden(notesBox, false);
            this.bindPurchaseNotesWheelIsolation();
        } else {
            this.setElementHidden(notesBox, true);
            notesContent.innerHTML = '';
            if (notesTitle) {
                notesTitle.textContent = window.i18n?.t('shop.purchaseNotes') || '注意事项';
            }
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
        modal.classList.remove('active', 'has-usage-instructions');

        if (window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        }
    },

    showShopSuccessToast: function (message) {
        if (window.WalletModal?.showToast) {
            window.WalletModal.showToast(message, 'success');
            return;
        }

        const toast = document.getElementById('shopSuccessToast');
        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('is-visible');
        setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 1500);
    },

    copySuccessCardContent: async function (encodedText) {
        const text = decodeURIComponent(encodedText || '');
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
            this.showShopSuccessToast(window.i18n?.t('common.copied') || '已复制');
        } catch (error) {
            console.error('Failed to copy shop success content:', error);
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

    sanitizeRichTextHtml: function (html) {
        const template = document.createElement('template');
        template.innerHTML = html;

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
                    safeRules.push(`color: ${value}`);
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
                    const color = (attrs.color || '').trim();
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

    loadMyOrders: async function () {
        const list = document.getElementById('ordersList');
        if (!list) return;

        list.innerHTML = this.buildShopStatusMessage(
            window.i18n?.t('common.loading') || '加载中...',
            { variant: 'muted', iconClass: 'fas fa-spinner fa-spin' }
        );

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            list.innerHTML = this.buildShopStatusMessage(window.i18n?.t('shop.loginRequired') || '请先登录');
            return;
        }

        try {
            const { data, error } = await supabaseClient
                .from('shop_orders')
                .select(`
    *,
    shop_products(name, icon_url)
        `)
                .eq('user_id', user.id)
                .eq('site', window.SiteConfig?.site || 'cn')
                .order('created_at', { ascending: false });

            if (error) throw error;

            list.innerHTML = '';
            if (!data || data.length === 0) {
                list.innerHTML = this.buildShopStatusMessage(window.i18n?.t('shop.noOrders') || '暂无订单记录', { variant: 'muted' });
                return;
            }

            data.forEach(order => {
                const item = document.createElement('div');
                item.className = 'glass-box shop-order-history-item';

                const date = new Date(order.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const icon = order.shop_products?.icon_url || 'fas fa-box';
                const safeIcon = this.escapeAttribute(icon);
                const iconHtml = icon.startsWith('http')
                    ? `<img src="${safeIcon}" class="shop-order-history-icon shop-order-history-icon--image" alt="">`
                    : `<i class="${safeIcon} shop-order-history-icon shop-order-history-icon--font" aria-hidden="true"></i>`;

                item.innerHTML = `
                    <div class="shop-order-history-main">
                        <div class="shop-order-history-header">
                            ${iconHtml}
                            <span class="shop-order-history-name">${this.escapeHtml(order.shop_products?.name || (window.i18n?.t('shop.unknownProduct') || '未知商品'))}</span>
                        </div>
                        <div class="shop-order-history-meta">
                            ${date} · <span class="shop-order-history-points">-${order.price_paid} ${window.SiteConfig?.getPointsLabel() || window.i18n?.t('shop.points') || '积分'}</span>
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
            list.innerHTML = this.buildShopStatusMessage(window.i18n?.t('common.error') || '加载失败', { variant: 'error' });
        }
    },

    viewOrderContent: function (id, encodedContent) {
        // Use unified WalletModal order detail view (premium glass style)
        if (window.WalletModal && window.WalletModal.showOrderDetail) {
            WalletModal.showOrderDetail(id);
        } else {
            // Fallback to old modal if WalletModal not loaded
            const content = decodeURIComponent(encodedContent);
            this.showSuccessModal(content);
            const modal = document.getElementById('shopSuccessModal');
            const title = modal.querySelector('.card-title');
            if (title) title.textContent = window.i18n?.t('shop.orderDetails') || "订单详情";
        }
    },

    copyContent: function () {
        const contentBox = document.getElementById('purchasedContent');
        // Use stored original content instead of textContent (which includes UI button text)
        let text = contentBox.dataset.originalContent || contentBox.textContent;

        // Remove '----' separators and replace with single newline for clean separation
        if (text) {
            text = text.split(/\n----\n/).join('\n');
        }

        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copyContentBtn');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `<i class="fas fa-check"></i> ${window.i18n?.t('common.copied') || '已复制'}`;
            this.setShopButtonFeedbackState(btn, true);
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                this.setShopButtonFeedbackState(btn, false);
            }, 2000);

            // Also trigger the elegant success toast
            if (window.WalletModal && window.WalletModal.showToast) {
                window.WalletModal.showToast(window.i18n?.t('common.copied') || '已复制', 'success');
            }
        });
    },

    exportContent: function () {
        const contentBox = document.getElementById('purchasedContent');
        const content = contentBox.dataset.originalContent || contentBox.textContent;
        const serializedItems = String(contentBox.dataset.successItems || '').trim();
        const productName = this.currentPurchase?.productName || (window.i18n?.t('shop.unknownProduct') || '商品');
        const orderId = this.currentPurchase?.orderId || '';
        const timestamp = this.formatSuccessOrderTimestamp(this.currentPurchase?.createdAt) || new Date().toLocaleString('zh-CN');
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

// Auto-init if DOM ready, otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ShopClient.init());
} else {
    ShopClient.init();
}

// Expose globally
window.ShopClient = ShopClient;
