/**
 * shop-client.js
 * User-side logic for Resource Shop
 * Handles product loading, purchase flow, and order history.
 */

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
    agentPricesCache: null,
    agentPricesPromise: null,
    currentUserPurchaseAccess: null,
    currentUserPurchaseAccessPromise: null,
    currentUserPurchaseAccessUserId: null,
    availableCategories: [],
    productsRequestToken: 0,
    productsCacheEpoch: 0,
    backgroundPrefetchScheduled: false,
    backgroundPrefetchHandle: null,
    lastSkeletonCount: 6,
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

    getCurrentPurchaseSubtotal: function () {
        return this.currentPurchase.quantity * this.currentPurchase.unitPrice;
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
        this.currentPurchase.discountType = null;
        this.currentPurchase.discountValue = null;
        this.currentPurchase.discountAmount = 0;
        document.getElementById('modalTotalPrice').textContent = this.getCurrentPurchaseSubtotal();
        if (clearMessage) {
            this.setDiscountMessage('');
        }
    },

    validateDiscountWithServer: async function (discountCode) {
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

    purchaseWithServer: async function () {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error(window.i18n?.t('shop.loginRequired') || '请先登录');
        }

        if (!this.currentPurchase.idempotencyKey) {
            this.currentPurchase.idempotencyKey = this.createPurchaseIdempotencyKey();
        }

        const response = await fetch('/api/shop/purchase', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-Idempotency-Key': this.currentPurchase.idempotencyKey
            },
            body: JSON.stringify({
                productId: this.currentPurchase.productId,
                quantity: this.currentPurchase.quantity,
                discountCode: this.currentPurchase.discountCode,
                agentId: this.currentAgentId,
                site: window.SiteConfig?.site || 'cn',
                idempotencyKey: this.currentPurchase.idempotencyKey
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
                        // Only use prefetch if it actually contains products, otherwise ignore (Safari empty state bug)
                        if (
                            age < 300000
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
                        }
                    }
                } catch (e) { /* ignore */ }

                // Load category filters first, then products
                await this.loadCategoryFilters();
                await this.loadProducts();

                // Clear prefetch references
                this._prefetchedCategories = null;

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
                ? event.target.closest('.shop-buy-btn[data-shop-action="buy-product"]')
                : null;
            if (!target || target.disabled) return;

            event.preventDefault?.();
            void this.buyProduct(
                target.dataset.productId || '',
                decodeURIComponent(target.dataset.productName || ''),
                decodeURIComponent(target.dataset.productNameEn || ''),
                Number(target.dataset.unitPrice || 0),
                target.dataset.qtyRules || '',
                target.dataset.maxPurchaseQuantity || '',
                target.dataset.showPurchaseNotes === 'true',
                target.dataset.purchaseNotes || ''
            );
        });

        const purchaseModal = document.getElementById('shopPurchaseModal');
        purchaseModal?.addEventListener('click', (event) => {
            if (event.target === purchaseModal) {
                this.closePurchaseModal();
                return;
            }

            const closeTrigger = event.target instanceof Element
                ? event.target.closest('#shopPurchaseModalCloseBtn')
                : null;
            if (closeTrigger) {
                event.preventDefault?.();
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

            if (event.target instanceof Element && event.target.closest('#confirmPurchaseBtn')) {
                event.preventDefault?.();
                void this.confirmPurchase();
            }
        });

        document.getElementById('shopPurchaseModalCloseBtn')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.closePurchaseModal();
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

    setDiscountMessage: function (message = '', { variant = 'error', html = false } = {}) {
        const msgBox = document.getElementById('discountMessage');
        if (!msgBox) return;

        msgBox.classList.add('shop-discount-message');
        msgBox.classList.remove('shop-discount-message--error', 'shop-discount-message--success');

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

    currentCategory: 'all',

    filterCategory: function (category, btn) {
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
                categories: this.availableCategories || [],
                products: this.allProductsCache,
                timestamp: Date.now()
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

    getExistingProductSkeletonCount: function (container = document.getElementById('userShopGrid')) {
        if (!container) return 0;
        return container.querySelectorAll('.skeleton-card').length;
    },

    renderProductSkeletons: function (count) {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        const existingSkeletonCount = this.getExistingProductSkeletonCount(container);
        const requestedCount = Number.parseInt(count, 10) || existingSkeletonCount || this.lastSkeletonCount || 6;
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

        container.innerHTML = Array.from({ length: safeCount }, () => `
            <div class="skeleton-card">
                <div class="skeleton skeleton-image"></div>
                <div class="skeleton-content">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-desc"></div>
                    <div class="skeleton skeleton-desc-short"></div>
                    <div class="skeleton-footer">
                        <div class="skeleton skeleton-price"></div>
                        <div class="skeleton skeleton-btn"></div>
                    </div>
                </div>
            </div>
        `).join('');
    },

    renderEmptyState: function () {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        container.classList.add('is-empty');
        container.innerHTML = `
            <div class="shop-empty-state">
                <div class="shop-empty-icon">
                    <i class="fas fa-box-open" aria-hidden="true"></i>
                </div>
                <h3 class="shop-empty-title" data-i18n="shop.noProducts">${window.i18n?.t('shop.noProducts') || '暂无商品上架'}</h3>
            </div>
        `;
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

    // Load categories from shop_categories table dynamically
    loadCategoryFilters: async function () {
        const container = document.getElementById('shopCategoryFilters');
        if (!container) return;

        try {
            // Use prefetched data if available
            let categories;
            if (this._prefetchedCategories) {
                categories = this._prefetchedCategories;
                console.log('⚡ Using prefetched categories');
            } else {
                const { data, error } = await supabaseClient
                    .from('shop_categories')
                    .select('*')
                    .order('sort_order');
                console.log('🛍️ Shop categories from DB:', { data, error });
                categories = (error || !data || data.length === 0) ? null : data;
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

        if (forceRefresh) {
            this.invalidateProductCaches();
        }

        if (!hasCachedProducts) {
            this.renderProductSkeletons();
        }

        // Clear existing timer if any
        if (this.flashSaleInterval) {
            clearInterval(this.flashSaleInterval);
            this.flashSaleInterval = null;
        }

        try {
            const [data, agentPrices] = await Promise.all([
                this.getProductsForCategory(requestCategory, { forceRefresh }),
                this.getAgentPrices()
            ]);

            if (requestToken !== this.productsRequestToken) return;

            container.classList.remove('is-empty');
            container.innerHTML = '';
            if (!data || data.length === 0) {
                this.renderEmptyState();
                this.scheduleBackgroundProductPrefetch();
                return;
            }

            data.forEach((p, index) => {
                const el = document.createElement('div');
                el.className = 'shop-card user-product-card breathing';
                // Randomize breathing delay for wave effect (-4s to 0s)
                const delay = -(Math.random() * 4).toFixed(2);
                this.setCssVariables(el, { '--breathe-delay': `${delay}s` });
                // Styles moved to CSS (shop.html or style.css)

                const safeIconUrl = this.escapeAttribute(p.icon_url || '');
                const safeIconClass = this.escapeAttribute(p.icon_url || '');
                const iconHtml = p.icon_url?.startsWith('fa')
                    ? `<i class="${safeIconClass} shop-card-icon shop-card-icon--font" aria-hidden="true"></i>`
                    : (p.icon_url ? `<img src="${safeIconUrl}" width="40" class="shop-card-thumb" alt="">` : '<i class="fas fa-box shop-card-icon shop-card-icon--fallback" aria-hidden="true"></i>');

                const stockCount = p.stock_count || 0;
                const noStock = stockCount <= 0;
                const buyBtnText = noStock
                    ? (window.i18n?.t('shop.outOfStock') || '售罄')
                    : (window.i18n?.t('shop.redeem') || '兑换');
                const stockLabel = noStock
                    ? (window.i18n?.t('shop.noStock') || '无货')
                    : `${window.i18n?.t('shop.stock') || '库存'}: ${stockCount}`;

                // Use class for button style
                const buyBtnClass = noStock ? 'shop-btn-disabled' : 'shop-btn-primary';

                // Cover Image Logic
                const displayHtml = p.icon_url?.startsWith('http')
                    ? `<img src="${safeIconUrl}" class="shop-card-image-cover" alt="">`
                    : `<div class="shop-icon-wrapper">${p.icon_url?.startsWith('fa')
                        ? `<i class="${safeIconClass} shop-card-icon shop-card-icon--cover" aria-hidden="true"></i>`
                        : iconHtml}</div>`;

                // Select language-appropriate content
                const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
                const displayName = (currentLang === 'en' && p.name_en) ? p.name_en : p.name;
                const displayDesc = (currentLang === 'en' && p.description_en)
                    ? p.description_en
                    : (p.description || (window.i18n?.t('shop.noDescription') || '暂无描述'));
                const qtyRulesStr = p.quantity_rules ? encodeURIComponent(JSON.stringify(p.quantity_rules)) : '';
                const maxPurchaseQuantity = this.normalizePurchaseQuantityCap(p.max_purchase_quantity);

                // Flash Sale Logic
                const nowTime = new Date();
                const flashEnd = p.flash_sale_end ? new Date(p.flash_sale_end) : null;
                let isFlashSale = flashEnd && flashEnd > nowTime && p.flash_sale_price != null;

                let currentPrice = this.getProductPriceForCurrentSite(p);
                if (currentPrice == null) {
                    return;
                }
                let originalPriceHtml = '';
                let flashSaleBadge = '';
                let flashShadowClass = '';
                let agentBadgeHtml = '';

                // Agent override highest priority if > base price
                if (this.currentAgentId && agentPrices[p.id] && agentPrices[p.id] > currentPrice) {
                    originalPriceHtml = `<span class="shop-card-original-price">${currentPrice}</span>`;
                    currentPrice = agentPrices[p.id];
                    agentBadgeHtml = `<div class="shop-agent-badge">${window.i18n?.t('shop.exclusiveBuff') || '专属加持'}</div>`;
                }

                // Check flash sale (only if no agent custom price overriding it)
                const now = new Date();
                if (p.flash_sale_price != null && p.flash_sale_end && new Date(p.flash_sale_end) > now && agentBadgeHtml === '') {
                    isFlashSale = true;
                    originalPriceHtml = `<span class="shop-card-original-price">${currentPrice}</span>`;
                    currentPrice = p.flash_sale_price;
                    flashSaleBadge = `<div class="flash-sale-badge flash-badge-glass" data-endtime="${p.flash_sale_end}"><i class="fas fa-bolt"></i> <span class="countdown-timer">${window.i18n?.t('shop.calculating') || '计算中...'}</span></div>`;
                    flashShadowClass = 'flash-sale-card';
                }

                el.className = `shop-card user-product-card breathing ${flashShadowClass}`;

                el.innerHTML = `
                    <div class="shop-card-image">
                        ${flashSaleBadge}
                        ${displayHtml}
                        ${agentBadgeHtml}
                        <div class="shop-stock-badge shop-stock-badge--floating ${noStock ? 'out-of-stock' : 'in-stock'}">
                            ${stockLabel}
                        </div>
                    </div>
                    
                    <div class="shop-content-padding">
                        <h3 class="shop-card-title">${this.escapeHtml(displayName)}</h3>
                        <p class="shop-card-desc">${this.escapeHtml(displayDesc)}</p>
                        
                        <div class="shop-card-footer">
                            <div class="shop-card-price">${originalPriceHtml}${window.SiteConfig?.formatPrice(currentPrice) || currentPrice} <span data-i18n="shop.points">${window.SiteConfig?.getPointsLabel() || window.i18n?.t('shop.points') || '积分'}</span></div>
                            <button type="button" ${noStock ? 'disabled' : ''} class="shop-buy-btn ${buyBtnClass}">
                                ${buyBtnText}
                            </button>
                        </div>
                    </div>
                `;
                const buyButton = el.querySelector('.shop-buy-btn');
                if (buyButton) {
                    buyButton.dataset.shopAction = 'buy-product';
                    buyButton.dataset.productId = String(p.id || '');
                    buyButton.dataset.productName = encodeURIComponent(p.name || '');
                    buyButton.dataset.productNameEn = encodeURIComponent(p.name_en || '');
                    buyButton.dataset.unitPrice = String(currentPrice);
                    buyButton.dataset.qtyRules = qtyRulesStr;
                    buyButton.dataset.maxPurchaseQuantity = String(maxPurchaseQuantity);
                    buyButton.dataset.showPurchaseNotes = p.show_purchase_notes ? 'true' : 'false';
                    buyButton.dataset.purchaseNotes = encodeURIComponent(p.purchase_notes || '');
                }
                container.appendChild(el);
            });

            this.lastSkeletonCount = Math.min(Math.max(data.length, 3), 8);
            this.scheduleBackgroundProductPrefetch();

        } catch (err) {
            if (requestToken !== this.productsRequestToken) return;
            container.classList.remove('is-empty');
            container.innerHTML = this.buildShopStatusMessage(
                `${window.i18n?.t('common.error') || '加载失败'}: ${err.message || ''}`,
                { variant: 'error', fullSpan: true }
            );
        }

        this.startFlashSaleTimer();
    },

    flashSaleInterval: null,

    startFlashSaleTimer: function () {
        if (this.flashSaleInterval) clearInterval(this.flashSaleInterval);
        this.flashSaleInterval = setInterval(() => {
            let activeFlashSales = 0;
            document.querySelectorAll('.flash-sale-badge').forEach(badge => {
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
        basePrice: 0,
        unitPrice: 0,
        quantity: 1,
        orderId: null,
        rules: [],
        discountCode: null,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        purchaseNotes: '',
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

    buyProduct: async function (productId, productName, productNameEn, price, rulesStr, maxPurchaseQuantity = 99, showPurchaseNotes = false, purchaseNotesEncoded = '') {
        const rules = rulesStr ? JSON.parse(decodeURIComponent(rulesStr)) : [];
        const purchaseNotes = showPurchaseNotes ? decodeURIComponent(purchaseNotesEncoded || '') : '';
        const quantityCap = this.normalizePurchaseQuantityCap(maxPurchaseQuantity);
        // 1. Open Modal immediately for instant feedback
        this.openPurchaseModal(productId, productName, productNameEn, price, rules, quantityCap, purchaseNotes);

        // 2. Auth Check in background
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            this.closePurchaseModal();
            alert(window.i18n?.t('shop.loginRequired') || '请先登录再进行兑换');
            // Open login modal after user clicks OK on alert
            if (typeof toggleLoginModal === 'function') {
                toggleLoginModal();
            }
            return;
        }

        const purchaseAccess = await this.loadCurrentUserPurchaseAccess();
        if (this.currentPurchase?.productId === productId) {
            this.currentPurchase.unlimitedPurchases = purchaseAccess.unlimitedShopPurchases === true;
            this.setCurrentPurchaseQuantityCap(maxPurchaseQuantity, {
                unlimited: this.currentPurchase.unlimitedPurchases
            });
        }
    },

    openPurchaseModal: function (productId, productName, productNameEn, price, rules, maxPurchaseQuantity = 99, purchaseNotes = '', options = {}) {
        const quantityCap = this.normalizePurchaseQuantityCap(maxPurchaseQuantity);
        const unlimitedPurchases = options?.unlimitedPurchases === true;
        this.currentPurchase = {
            productId,
            productName,
            productNameEn,
            basePrice: price,
            unitPrice: price,
            quantity: 1,
            orderId: null,
            rules: rules,
            discountCode: null,
            discountType: null,
            discountValue: null,
            discountAmount: 0,
            purchaseNotes: typeof purchaseNotes === 'string' ? purchaseNotes.trim() : '',
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
        document.getElementById('modalTotalPrice').textContent = price;
        const quantityInput = document.getElementById('purchaseQuantity');
        if (quantityInput) {
            quantityInput.value = 1;
        }
        this.setCurrentPurchaseQuantityCap(quantityCap, { unlimited: unlimitedPurchases });

        // Reset Discount UI
        const discountInput = document.getElementById('purchaseDiscountCode');
        const applyBtn = document.getElementById('applyDiscountBtn');
        if (discountInput) discountInput.value = '';
        this.setDiscountMessage('');
        if (applyBtn) {
            applyBtn.innerHTML = window.i18n?.t('shop.verify') || '验证';
            applyBtn.disabled = false;
        }

        // Reset purchase button state (in case previous purchase left it disabled)
        const btn = document.getElementById('confirmPurchaseBtn');
        if (btn) {
            const confirmText = window.i18n?.t('shop.confirmRedeem') || '确认兑换';
            btn.innerHTML = `<i class="fas fa-shopping-cart"></i> <span>${confirmText}</span>`;
            btn.disabled = false;
        }

        const modal = document.getElementById('shopPurchaseModal');
        modal.classList.remove('active');
        this.renderPurchaseNotes();

        // Flush the inactive layout first so newly revealed notes can join the stagger animation on first open.
        void modal.offsetHeight;

        // Show Modal
        modal.classList.add('active');
        // Lock background scroll on mobile Safari
        if (window.iOSScrollLock) window.iOSScrollLock.lockLight(modal);
        this.attachPurchaseModalKeyboardDock();
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
            const { discountAmount } = this.syncDiscountedTotal();
            this.setDiscountAppliedMessage(discountAmount);
        } else {
            document.getElementById('modalTotalPrice').textContent = total;
        }

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
            const validationPayload = await this.validateDiscountWithServer(codeInput);
            const preview = validationPayload?.data || {};

            this.currentPurchase.discountCode = String(preview.discount_code || codeInput).trim().toUpperCase();
            this.currentPurchase.discountType = preview.discount_type || null;
            this.currentPurchase.discountValue = preview.discount_value ?? null;

            const { discountAmount } = this.syncDiscountedTotal();

            this.setDiscountAppliedMessage(discountAmount);

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

    confirmPurchase: async function () {
        // Disable button
        const btn = document.getElementById('confirmPurchaseBtn');
        const originalText = btn.innerHTML;
        const processingText = window.i18n?.t('shop.processing') || '处理中...';
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${processingText}</span>`;
        btn.disabled = true;

        try {
            const data = await this.purchaseWithServer();
            const purchaseData = data.data;
            let allContents = [];
            if (purchaseData.content) {
                // The new backend returns newline separated contents
                allContents = purchaseData.content.split('\n----\n');
            }
            let lastOrderId = purchaseData.order_id;
            let remainingPoints = purchaseData.remaining_points;
            let usageInstructions = purchaseData.usage_instructions || null;

            // Success
            const finalContent = allContents.length > 0
                ? allContents.join('\n----\n')
                : (window.i18n?.t('shop.noContent') || '（无内容）');

            // Store order ID for export
            this.currentPurchase.orderId = lastOrderId;
            this.currentPurchase.idempotencyKey = null;

            // Handle Results
            this.closePurchaseModal();
            await this.loadProducts({ forceRefresh: true }); // Always refresh stock first

            this.showSuccessModal(finalContent, null, usageInstructions);

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
                    setTimeout(() => window.WalletModal.open('recharge'), 300);
                }
            } else {
                // For other errors, show toast in the purchase modal
                if (window.WalletModal && window.WalletModal.showToast) {
                    window.WalletModal.showToast(`❌ ${window.i18n?.t('shop.redeemFailed') || '兑换失败'}: ${errMsg}`, 'error');
                }
            }

            if (!isDuplicateSubmission) {
                this.currentPurchase.idempotencyKey = this.createPurchaseIdempotencyKey();
            }

            // Re-enable button on error
            btn.innerHTML = originalText;
            btn.disabled = false;
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
            notesContent.innerHTML = this.renderStoredRichText(normalizedPurchaseNotes);
            this.setElementHidden(notesBox, false);
            this.bindPurchaseNotesWheelIsolation();
        } else {
            this.setElementHidden(notesBox, true);
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
        const usageCard = modal?.querySelector('.shop-success-usage-card');
        if (!modal || !usageCard || !modal.classList.contains('has-usage-instructions')) return;

        const cleanup = this.bindContainedWheelIsolation(usageCard);
        if (cleanup) {
            this.successUsageWheelCleanup = cleanup;
        }
    },

    showSuccessModal: function (content, warning, usageInstructions) {
        this.injectPremiumStyles();
        const modal = document.getElementById('shopSuccessModal');
        const contentBox = document.getElementById('purchasedContent');
        const warningBox = document.getElementById('purchasedWarning');
        const warningText = document.getElementById('purchasedWarningText');
        const parentBox = contentBox.parentElement;
        const scrollArea = modal?.querySelector('.shop-success-scroll');
        const normalizedUsageInstructions = typeof usageInstructions === 'string'
            ? usageInstructions.trim()
            : '';
        const hasUsageInstructions = normalizedUsageInstructions.length > 0;

        this.clearSuccessUsageWheelIsolation();

        if (modal) {
            modal.classList.toggle('has-usage-instructions', hasUsageInstructions);
        }

        // Reset parent box styles to be cleaner (remove padding if we want cards to flush, but padding is fine)
        // Ensure parent box is transparent to let cards stand out
        if (parentBox) {
            parentBox.classList.remove('glass-box');
            parentBox.classList.add('shop-success-content-shell--plain');
        }

        if (modal && contentBox) {
            if (scrollArea) scrollArea.scrollTop = 0;
            if (parentBox) parentBox.scrollTop = 0;

            // Split content by separator (----) to get individual items
            const items = content.split(/\n----\n/);
            const totalItems = items.length;
            // Get product name based on current language
            const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
            const productName = (currentLang === 'en' && this.currentPurchase?.productNameEn)
                ? this.currentPurchase.productNameEn
                : (this.currentPurchase?.productName || '商品内容');

            // Store original content for copying (before adding UI elements)
            contentBox.dataset.originalContent = content;

            // Update the header dot with product name tooltip
            const productNameDot = document.getElementById('productNameDot');
            if (productNameDot) {
                productNameDot.setAttribute('data-tooltip', productName);
            }

            const isShortKeys = items.every(t => t.length <= 40 && !t.includes('\n'));

            const createCardMsg = (text, hidden = false) => {
                const encodedText = encodeURIComponent(text);
                return `
                <div class="content-card content-card--shop-copy" ${hidden ? 'data-expandable-item="1" hidden' : ''} data-shop-copy-content="${encodedText}" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">
                    <div class="item-content-box item-content-box--plain">
                        <div class="item-text item-text--centered">${this.escapeHtml(text)}</div>
                    </div>
                </div>`;
            };

            contentBox.classList.add('shop-success-content');
            const toastEl = this.buildSuccessToastMarkup();
            const gridClass = items.length > 1 && isShortKeys
                ? 'shop-success-content-grid shop-success-content-grid--double'
                : 'shop-success-content-grid shop-success-content-grid--stacked';

            if (totalItems <= 2) {
                // 2 or fewer items: show directly in grid
                contentBox.innerHTML = `<div class="${gridClass}">${items.map(item => createCardMsg(item)).join('')}</div>${toastEl}`;
            } else {
                // More than 2 items: show first 2, collapse rest
                const visibleHTML = items.slice(0, 2).map(item => createCardMsg(item)).join('');
                const hiddenHTML = items.slice(2).map(item => createCardMsg(item, true)).join('');
                const hiddenCount = totalItems - 2;
                const expandBtn = this.buildExpandContentToggleMarkup(hiddenCount, false);

                contentBox.innerHTML = `<div id="expandedContentGrid" class="${gridClass}">${visibleHTML}${hiddenHTML}</div>${expandBtn}${toastEl}`;
            }

            // Handle Warning
            if (warning && warningBox && warningText) {
                warningText.textContent = warning;
                this.setElementHidden(warningBox, false);
            } else if (warningBox) {
                this.setElementHidden(warningBox, true);
            }

            setTimeout(() => {
                modal.classList.add('active');
                // Lock background scroll on mobile Safari
                if (window.iOSScrollLock) window.iOSScrollLock.lockLight(modal);
            }, 50);
        }

        // Handle Usage Instructions
        const uiBox = document.getElementById('usageInstructionsBox');
        const uiContent = document.getElementById('usageInstructionsContent');
        if (uiBox && uiContent) {
            if (hasUsageInstructions) {
                uiContent.innerHTML = this.renderStoredRichText(normalizedUsageInstructions);
                this.setElementHidden(uiBox, false);
                this.bindSuccessUsageWheelIsolation();
            } else {
                this.setElementHidden(uiBox, true);
                uiContent.innerHTML = '';
            }
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
        const productName = this.currentPurchase?.productName || (window.i18n?.t('shop.unknownProduct') || '商品');
        const orderId = this.currentPurchase?.orderId || '';
        const timestamp = new Date().toLocaleString('zh-CN');

        // Parse items
        const items = content.split(/\n----\n/);

        // Build CSV content with BOM for Excel Chinese support
        const BOM = '\uFEFF';
        let csv = BOM + `${window.i18n?.t('shop.csvOrderId') || '订单号'},${window.i18n?.t('shop.csvIndex') || '序号'},${window.i18n?.t('shop.csvProductName') || '商品名称'},${window.i18n?.t('shop.csvAccountInfo') || '账号信息'},${window.i18n?.t('shop.csvRedeemTime') || '兑换时间'}\n`;

        items.forEach((item, index) => {
            // Escape quotes and wrap in quotes for CSV
            const escapedItem = item.replace(/"/g, '""');
            csv += `"${orderId}", ${index + 1}, "${productName}", "${escapedItem}", "${timestamp}"\n`;
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
