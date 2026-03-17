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

    init: async function () {
        console.log('🛍️ Shop Client Initialized');

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
                        heroTitle.innerHTML = `<i class="fas fa-store" style="color:#10b981; margin-right:10px;"></i>${this.currentAgentName} ${window.i18n?.t('shop.agentStore') || '的专属福利商店'}`;
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
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,100,100,0.7);">${window.i18n?.t('common.error') || '加载超时，请刷新重试'}</div>`;
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
                        // Only use prefetch if it actually contains products, otherwise ignore (Safari empty state bug)
                        if (age < 300000 && prefetch.categories && prefetch.products && prefetch.products.length > 0) {
                            sessionStorage.removeItem('shop_prefetch');
                            // Inject prefetched data into Cache for loadCategoryFilters / loadProducts to use
                            this._prefetchedCategories = prefetch.categories;
                            this._prefetchedProducts = prefetch.products;
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
                this._prefetchedProducts = null;

                clearTimeout(fallbackTimer);

            } catch (err) {
                console.error('🛍️ Shop loading error:', err);
                clearTimeout(fallbackTimer);
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,100,100,0.7);">${window.i18n?.t('common.error') || '加载失败，请刷新重试'}</div>`;
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

    currentCategory: 'all',

    filterCategory: function (category, btn) {
        this.currentCategory = category;
        const tabs = document.querySelectorAll('#shopCategoryFilters .filter-tab');
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        this.loadProducts();
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

            // Clear skeleton placeholders and rebuild all buttons
            container.innerHTML = '';

            const allBtn = document.createElement('button');
            allBtn.className = this.currentCategory === 'all' ? 'filter-tab active' : 'filter-tab';
            allBtn.textContent = window.i18n?.t('shop.allCategories') || '全部';
            allBtn.setAttribute('data-i18n', 'shop.allCategories');
            allBtn.onclick = () => this.filterCategory('all', allBtn);
            container.appendChild(allBtn);

            // Add dynamic category buttons
            categories.forEach(cat => {
                const btn = document.createElement('button');
                btn.className = this.currentCategory === cat.name ? 'filter-tab active' : 'filter-tab';
                btn.textContent = cat.name;
                btn.onclick = () => this.filterCategory(cat.name, btn);
                container.appendChild(btn);
            });

        } catch (e) {
            console.error('Failed to load category filters:', e);
            // On error, show a simple "全部" button
            container.innerHTML = `<button class="filter-tab active" data-i18n="shop.allCategories" onclick="ShopClient.filterCategory('all', this)">${window.i18n?.t('shop.allCategories') || '全部'}</button>`;
        }
    },

    loadProducts: async function () {
        const container = document.getElementById('userShopGrid');
        if (!container) return;

        // Only show spinner if no prefetched data and no skeleton already visible
        if (!this._prefetchedProducts && !container.querySelector('.skeleton')) {
            container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);"><i class="fas fa-spinner fa-spin"></i> ${window.i18n?.t('common.loading') || '加载中...'}</div>`;
        }

        // Clear existing timer if any
        if (this.flashSaleInterval) {
            clearInterval(this.flashSaleInterval);
            this.flashSaleInterval = null;
        }

        try {
            let data;

            // Use prefetched data if available
            if (this._prefetchedProducts) {
                data = this._prefetchedProducts;
                // Apply category filter client-side
                if (this.currentCategory !== 'all') {
                    data = data.filter(p => p.category === this.currentCategory);
                }
                console.log('⚡ Using prefetched products');
            } else {
                // Fetch ONLY active products
                let query = supabaseClient
                    .from('shop_products')
                    .select('*')
                    .eq('is_active', true)
                    .order('display_order', { ascending: false });

                if (this.currentCategory !== 'all') {
                    query = query.eq('category', this.currentCategory);
                }

                const result = await query;
                if (result.error) throw result.error;
                data = result.data;
            }

            container.innerHTML = '';
            if (!data || data.length === 0) {
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);" data-i18n="shop.noProducts">${window.i18n?.t('shop.noProducts') || '暂无商品上架'}</div>`;
                return;
            }

            // Fetch Agent Prices if available
            let agentPrices = {};
            if (this.currentAgentId) {
                const { data: agentData } = await window.supabaseClient
                    .from('agent_prices')
                    .select('product_id, custom_price')
                    .eq('agent_id', this.currentAgentId);

                if (agentData) {
                    agentData.forEach(ap => {
                        agentPrices[ap.product_id] = ap.custom_price;
                    });
                }
            }

            data.forEach((p, index) => {
                const el = document.createElement('div');
                el.className = 'shop-card user-product-card breathing';
                // Randomize breathing delay for wave effect (-4s to 0s)
                const delay = -(Math.random() * 4).toFixed(2);
                el.style.setProperty('--breathe-delay', `${delay}s`);
                // Styles moved to CSS (shop.html or style.css)

                const iconHtml = p.icon_url?.startsWith('fa')
                    ? `<i class="${p.icon_url}" style="font-size: 24px; color: var(--accent-purple, #6b9ece);"></i>`
                    : (p.icon_url ? `<img src="${p.icon_url}" width="40" style="border-radius:8px;">` : '<i class="fas fa-box" style="font-size: 24px; color: var(--text-dim);"></i>');

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
                    ? `<img src="${p.icon_url}" style="width:100%; height:100%; object-fit:cover;">`
                    : `<div class="shop-icon-wrapper">${iconHtml.replace('font-size: 24px', 'font-size: 3rem;')}</div>`;

                // Select language-appropriate content
                const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
                const displayName = (currentLang === 'en' && p.name_en) ? p.name_en : p.name;
                const displayDesc = (currentLang === 'en' && p.description_en)
                    ? p.description_en
                    : (p.description || (window.i18n?.t('shop.noDescription') || '暂无描述'));
                const qtyRulesStr = p.quantity_rules ? encodeURIComponent(JSON.stringify(p.quantity_rules)) : '';

                // Flash Sale Logic
                const nowTime = new Date();
                const flashEnd = p.flash_sale_end ? new Date(p.flash_sale_end) : null;
                let isFlashSale = flashEnd && flashEnd > nowTime && p.flash_sale_price != null;

                let currentPrice = p[window.SiteConfig?.getPriceField() || 'price_points'] || p.price_points;
                let originalPriceHtml = '';
                let flashSaleBadge = '';
                let flashShadowClass = '';
                let agentBadgeHtml = '';

                // Agent override highest priority if > base price
                if (this.currentAgentId && agentPrices[p.id] && agentPrices[p.id] > currentPrice) {
                    originalPriceHtml = `<span style="text-decoration: line-through; color: rgba(255,255,255,0.4); font-size: 0.8em; margin-right: 6px;">${currentPrice}</span>`;
                    currentPrice = agentPrices[p.id];
                    agentBadgeHtml = `<div style="position:absolute; bottom:12px; left:12px; z-index: 10; font-size: 11px; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.4);">${window.i18n?.t('shop.exclusiveBuff') || '专属加持'}</div>`;
                }

                // Check flash sale (only if no agent custom price overriding it)
                const now = new Date();
                if (p.flash_sale_price != null && p.flash_sale_end && new Date(p.flash_sale_end) > now && agentBadgeHtml === '') {
                    isFlashSale = true;
                    originalPriceHtml = `<span style="text-decoration: line-through; color: rgba(255,255,255,0.4); font-size: 0.8em; margin-right: 6px;">${currentPrice}</span>`;
                    currentPrice = p.flash_sale_price;
                    flashSaleBadge = `<div class="flash-sale-badge flash-badge-glass" data-endtime="${p.flash_sale_end}"><i class="fas fa-bolt"></i> <span class="countdown-timer">${window.i18n?.t('shop.calculating') || '计算中...'}</span></div>`;
                    flashShadowClass = 'flash-sale-card';
                }

                el.className = `shop-card user-product-card breathing ${flashShadowClass}`;

                el.innerHTML = `
                    <div class="shop-card-image" style="position:relative;">
                        ${flashSaleBadge}
                        ${displayHtml}
                        ${agentBadgeHtml}
                        <div class="shop-stock-badge ${noStock ? 'out-of-stock' : 'in-stock'}" style="position:absolute; top:12px; right:12px; z-index: 10;">
                            ${stockLabel}
                        </div>
                    </div>
                    
                    <div class="shop-content-padding">
                        <h3 class="shop-card-title">${displayName}</h3>
                        <p class="shop-card-desc">${displayDesc}</p>
                        
                        <div style="margin-top:auto; padding-top:20px; display:flex; justify-content:space-between; align-items:center;">
                            <div class="shop-card-price">${originalPriceHtml}${window.SiteConfig?.formatPrice(currentPrice) || currentPrice} <span data-i18n="shop.points">${window.SiteConfig?.getPointsLabel() || window.i18n?.t('shop.points') || '积分'}</span></div>
                            <button onclick="ShopClient.buyProduct('${p.id}', '${p.name}', '${p.name_en || ''}', ${currentPrice}, '${qtyRulesStr}', ${p.show_purchase_notes ? 'true' : 'false'}, '${encodeURIComponent(p.purchase_notes || '')}')"
                                ${noStock ? 'disabled' : ''}
                                class="shop-buy-btn ${buyBtnClass}">
                                ${buyBtnText}
                            </button>
                        </div>
                    </div>
                `;
                container.appendChild(el);
            });

        } catch (err) {
            container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:#ff4d4f;">${window.i18n?.t('common.error') || '加载失败'}: ${err.message}</div>`;
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
                    this.loadProducts();
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
    currentPurchase: { productId: null, productName: null, productNameEn: null, basePrice: 0, unitPrice: 0, quantity: 1, orderId: null, rules: [], discountCode: null, discountAmount: 0, purchaseNotes: '' },

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
        probe.style.position = 'fixed';
        probe.style.top = '0';
        probe.style.left = '0';
        probe.style.width = '0';
        probe.style.height = '100svh';
        probe.style.pointerEvents = 'none';
        probe.style.visibility = 'hidden';
        probe.style.opacity = '0';
        probe.style.zIndex = '-1';
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
        overlay.style.setProperty('--shop-purchase-translate-y', `${translateY}px`);
        card.style.height = `${dockHeight}px`;
        card.style.maxHeight = `${dockHeight}px`;
        this.togglePurchaseModalSheetAnimation(card, animate);
        this.purchaseModalKeyboardDocked = bottomInset > 0;
        this.purchaseModalKeyboardLastBottomInset = Math.max(0, bottomInset);
    },

    releasePurchaseModalKeyboardDock: function (animate = false) {
        const { overlay, card } = this.getPurchaseModalElements();
        if (!overlay || !card) return;

        overlay.classList.remove('keyboard-docked');
        overlay.style.setProperty('--shop-purchase-translate-y', '0px');
        card.style.removeProperty('height');
        card.style.removeProperty('max-height');
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

    buyProduct: async function (productId, productName, productNameEn, price, rulesStr, showPurchaseNotes = false, purchaseNotesEncoded = '') {
        const rules = rulesStr ? JSON.parse(decodeURIComponent(rulesStr)) : [];
        const purchaseNotes = showPurchaseNotes ? decodeURIComponent(purchaseNotesEncoded || '') : '';
        // 1. Open Modal immediately for instant feedback
        this.openPurchaseModal(productId, productName, productNameEn, price, rules, purchaseNotes);

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
    },

    openPurchaseModal: function (productId, productName, productNameEn, price, rules, purchaseNotes = '') {
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
            discountAmount: 0,
            purchaseNotes: typeof purchaseNotes === 'string' ? purchaseNotes.trim() : ''
        };
        this.purchaseModalBaseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
        this.purchaseModalOwnsFullScrollLock = false;

        // Update UI - show name based on current language
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && productNameEn) ? productNameEn : productName;
        document.getElementById('modalProductName').textContent = displayName;
        document.getElementById('modalUnitPrice').textContent = price;
        document.getElementById('modalTotalPrice').textContent = price;
        document.getElementById('purchaseQuantity').value = 1;

        // Reset Discount UI
        const discountInput = document.getElementById('purchaseDiscountCode');
        const discountMsg = document.getElementById('discountMessage');
        const applyBtn = document.getElementById('applyDiscountBtn');
        if (discountInput) discountInput.value = '';
        if (discountMsg) discountMsg.style.display = 'none';
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
        const modalProductName = document.getElementById('modalProductName');
        const currentLang = window.i18n?.getCurrentLanguage() || 'zh';
        const displayName = (currentLang === 'en' && this.currentPurchase.productNameEn) ? this.currentPurchase.productNameEn : this.currentPurchase.productName;

        if (unitPrice < this.currentPurchase.basePrice) {
            modalProductName.innerHTML = `${displayName} <span style="font-size:12px; color:#10b981; background:rgba(16,185,129,0.1); padding:2px 6px; border-radius:4px; margin-left:6px; display:inline-flex; align-items:center; gap:4px; vertical-align:middle; line-height:1;"><i class="fas fa-tags" style="font-size:10px;"></i> ${window.i18n?.t('shop.wholesalePrice') || '批发价'}</span>`;
        } else {
            modalProductName.textContent = displayName;
        }

        document.getElementById('modalUnitPrice').textContent = unitPrice;

        let total = qty * unitPrice;

        // Re-apply discount silently if exists
        if (this.currentPurchase.discountCode) {
            setTimeout(() => ShopClient.applyDiscount(true), 10);
        } else {
            document.getElementById('modalTotalPrice').textContent = total;
        }

        return total;
    },

    applyDiscount: async function (silent = false) {
        const codeInputElem = document.getElementById('purchaseDiscountCode');
        const codeInput = codeInputElem ? codeInputElem.value.trim() : '';
        const msgBox = document.getElementById('discountMessage');
        const applyBtn = document.getElementById('applyDiscountBtn');

        if (!codeInput) {
            if (!silent && msgBox) {
                msgBox.style.color = '#ef4444';
                msgBox.textContent = window.i18n?.t('shop.enterDiscountCode') || '请输入优惠码';
                msgBox.style.display = 'block';
            }
            this.currentPurchase.discountCode = null;
            this.currentPurchase.discountAmount = 0;
            const subtotal = this.currentPurchase.quantity * this.currentPurchase.unitPrice;
            document.getElementById('modalTotalPrice').textContent = subtotal;
            return;
        }

        if (applyBtn && !silent) {
            applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            applyBtn.disabled = true;
        }

        try {
            const { data, error } = await supabaseClient
                .from('discount_codes')
                .select('*')
                .eq('code', codeInput)
                .eq('is_active', true)
                .single();

            if (error || !data) {
                throw new Error(window.i18n?.t('shop.invalidCode') || '无效的优惠码');
            }

            if (data.expires_at && new Date(data.expires_at) < new Date()) {
                throw new Error(window.i18n?.t('shop.expiredCode') || '优惠码已过期');
            }

            if (data.max_uses > 0 && data.used_count >= data.max_uses) {
                throw new Error(window.i18n?.t('shop.codeLimitReached') || '优惠码使用次数已达上限');
            }

            this.currentPurchase.discountCode = data.code;
            const subtotal = this.currentPurchase.quantity * this.currentPurchase.unitPrice;

            if (data.discount_type === 'percent') {
                this.currentPurchase.discountAmount = Math.floor(subtotal * (data.discount_value / 100));
            } else {
                this.currentPurchase.discountAmount = Math.min(subtotal, data.discount_value);
            }

            const finalTotal = Math.max(0, subtotal - this.currentPurchase.discountAmount);
            document.getElementById('modalTotalPrice').textContent = finalTotal;

            if (msgBox) {
                msgBox.style.color = '#10b981';
                msgBox.innerHTML = `<i class="fas fa-check-circle"></i> ${window.i18n?.t('shop.discountApplied') || '已抵扣'} ${this.currentPurchase.discountAmount} ${window.i18n?.t('shop.points') || '积分'}`;
                msgBox.style.display = 'block';
            }

        } catch (err) {
            if (!silent && msgBox) {
                msgBox.style.color = '#ef4444';
                msgBox.innerHTML = `<i class="fas fa-times-circle"></i> ${err.message || (window.i18n?.t('shop.verifyFailed') || '验证失败')}`;
                msgBox.style.display = 'block';
            }
            this.currentPurchase.discountCode = null;
            this.currentPurchase.discountAmount = 0;
            const subtotal = this.currentPurchase.quantity * this.currentPurchase.unitPrice;
            document.getElementById('modalTotalPrice').textContent = subtotal;
        } finally {
            if (applyBtn && !silent) {
                applyBtn.innerHTML = window.i18n?.t('shop.verify') || '验证';
                applyBtn.disabled = false;
            }
        }
    },

    adjustQuantity: function (delta) {
        let newQty = this.currentPurchase.quantity + delta;
        if (newQty < 1) newQty = 1;
        if (newQty > 99) newQty = 99; // Cap at 99 for safety

        this.currentPurchase.quantity = newQty;
        document.getElementById('purchaseQuantity').value = newQty;

        // Update Total
        this.updatePriceForQuantity(newQty);
    },

    // Handle direct keyboard input
    onQuantityInput: function (input) {
        let val = parseInt(input.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 99) val = 99;

        this.currentPurchase.quantity = val;
        // Update Total
        this.updatePriceForQuantity(val);
    },

    confirmPurchase: async function () {
        const { productId, productName, quantity, unitPrice } = this.currentPurchase;

        // Disable button
        const btn = document.getElementById('confirmPurchaseBtn');
        const originalText = btn.innerHTML;
        const processingText = window.i18n?.t('shop.processing') || '处理中...';
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${processingText}</span>`;
        btn.disabled = true;

        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) throw new Error(window.i18n?.t('shop.loginRequired') || "未登录");

            // DB function signature: fn_purchase_shop_item(p_product_id, p_user_id, p_site, p_quantity, p_discount_code, p_agent_id)
            const { data, error } = await supabaseClient.rpc('fn_purchase_shop_item', {
                p_product_id: productId,
                p_user_id: user.id,
                p_site: window.SiteConfig?.site || 'cn',
                p_quantity: quantity,
                p_discount_code: this.currentPurchase.discountCode,
                p_agent_id: this.currentAgentId
            });

            if (error) {
                throw error;
            }

            if (!data.success) {
                throw new Error(data.message || (window.i18n?.t('shop.redeemFailed') || '兑换失败'));
            }

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

            // Handle Results
            this.closePurchaseModal();
            await this.loadProducts(); // Always refresh stock first

            this.showSuccessModal(finalContent, null, usageInstructions);

            // Update Points UI
            if (window.updateUserPointsUI && remainingPoints != null) {
                window.updateUserPointsUI(remainingPoints);
                if (window.checkAuthState) window.checkAuthState();
            }

        } catch (err) {
            console.error(err);
            const errMsg = (err.message || (window.i18n?.t('shop.unknownError') || '未知错误'));

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
            notesContent.innerHTML = this.linkifyText(this.escapeHtml(normalizedPurchaseNotes));
            notesBox.style.display = 'block';
            this.bindPurchaseNotesWheelIsolation();
        } else {
            notesBox.style.display = 'none';
            notesContent.innerHTML = '';
        }
    },

    clearSuccessUsageWheelIsolation: function () {
        if (typeof this.successUsageWheelCleanup === 'function') {
            this.successUsageWheelCleanup();
            this.successUsageWheelCleanup = null;
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
        if (parentBox && parentBox.classList.contains('glass-box')) {
            parentBox.classList.remove('glass-box'); // Completely remove class to kill all hover effects
            parentBox.style.background = 'transparent';
            parentBox.style.border = 'none';
            parentBox.style.boxShadow = 'none';
            parentBox.style.padding = '0'; // Let cards handle spacing
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
            const gridStyle = items.length > 1 && isShortKeys
                ? 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;'
                : 'display: flex; flex-direction: column; gap: 8px; width: 100%;';

            const createCardMsg = (text, hidden = false) => {
                const escaped = this.escapeHtml(text).replace(/`/g, '\\`');
                const hiddenStyle = hidden ? 'display: none;' : '';
                const hiddenAttr = hidden ? 'data-expandable-item="1"' : '';
                return `
                <div class="content-card" ${hiddenAttr} style="margin-bottom: 0 !important; cursor: pointer; transition: all 0.2s; padding: 10px 6px !important; display: flex; align-items: center; justify-content: center; border-radius: 10px !important; ${hiddenStyle}" onclick="navigator.clipboard.writeText(\`${escaped}\`).then(() => { if(window.WalletModal && window.WalletModal.showToast){ window.WalletModal.showToast(window.i18n?.t('common.copied') || '已复制', 'success'); } else { const t = document.getElementById('shopSuccessToast'); if(t){ t.textContent='已复制'; t.style.opacity=1; setTimeout(()=>t.style.opacity=0, 1500); } } })" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}" onmouseover="this.style.borderColor='rgba(107, 158, 206, 0.5)'; this.style.background='rgba(255, 255, 255, 0.08)';" onmouseout="this.style.borderColor='rgba(255, 255, 255, 0.1)'; this.style.background='rgba(255, 255, 255, 0.05)';">
                    <div class="item-content-box" style="padding: 0 !important; width: 100%; background: transparent !important; border-radius: 0 !important;">
                        <div class="item-text" style="text-align: center; font-size: 13px; letter-spacing: 0.5px; line-height: 1.3;">${this.escapeHtml(text)}</div>
                    </div>
                </div>`;
            };

            // Clear previous content style that might conflict
            contentBox.style.whiteSpace = 'normal';
            contentBox.style.fontFamily = 'inherit';
            // Add toast element for copy feedback
            const toastEl = '<div id="shopSuccessToast" style="position:fixed;top:20%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;pointer-events:none;opacity:0;transition:opacity 0.3s;z-index:999999;"></div>';

            if (totalItems <= 2) {
                // 2 or fewer items: show directly in grid
                contentBox.innerHTML = `<div style="${gridStyle}">${items.map(item => createCardMsg(item)).join('')}</div>${toastEl}`;
            } else {
                // More than 2 items: show first 2, collapse rest
                const visibleHTML = items.slice(0, 2).map(item => createCardMsg(item)).join('');
                const hiddenHTML = items.slice(2).map(item => createCardMsg(item, true)).join('');
                const hiddenCount = totalItems - 2;

                const expandBtn = `
                <div style="margin-top:12px;text-align:center;">
                    <span id="expandContentBtn" data-hidden-count="${hiddenCount}" onclick="ShopClient.toggleExpandContent()"
                        style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;
                               font-size:12px;color:rgba(255,255,255,0.6);background:rgba(255,255,255,0.1);
                               padding:8px 16px;border-radius:20px;transition:all 0.2s;">
                        <span>${window.i18n?.t('shop.expandMore') || '展开其余'} ${hiddenCount} ${window.i18n?.t('shop.items') || '个'}</span>
                        <i class="fas fa-chevron-down" style="font-size:10px;"></i>
                    </span>
                </div>`;

                contentBox.innerHTML = `<div id="expandedContentGrid" style="${gridStyle}">${visibleHTML}${hiddenHTML}</div>${expandBtn}${toastEl}`;
            }

            // Handle Warning
            if (warning && warningBox && warningText) {
                warningText.textContent = warning;
                warningBox.style.display = 'block';
            } else if (warningBox) {
                warningBox.style.display = 'none';
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
                uiContent.innerHTML = this.linkifyText(this.escapeHtml(normalizedUsageInstructions));
                uiBox.style.display = 'block';
                this.bindSuccessUsageWheelIsolation();
            } else {
                uiBox.style.display = 'none';
                uiContent.innerHTML = '';
            }
        }
    },

    // Convert URLs in text to clickable links
    linkifyText: function (text) {
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
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
            const isHidden = expandableItems[0].style.display === 'none';
            expandableItems.forEach((item) => {
                item.style.display = isHidden ? 'flex' : 'none';
            });

            const hiddenCount = expandBtn.dataset.hiddenCount || expandableItems.length;
            expandBtn.innerHTML = isHidden
                ? `<span>${window.i18n?.t('shop.collapse') || '收起'}</span><i class="fas fa-chevron-up" style="font-size: 10px;"></i>`
                : `<span>${window.i18n?.t('shop.expandMore') || '展开其余'} ${hiddenCount} ${window.i18n?.t('shop.items') || '个'}</span><i class="fas fa-chevron-down" style="font-size: 10px;"></i>`;
        }
    },

    loadMyOrders: async function () {
        const list = document.getElementById('ordersList');
        if (!list) return;

        list.innerHTML = `<div style="text-align:center; color:rgba(255,255,255,0.4); padding:20px;"><i class="fas fa-spinner fa-spin"></i> ${window.i18n?.t('common.loading') || '加载中...'}</div>`;

        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) {
            list.innerHTML = `<div style="text-align:center; padding:20px;">${window.i18n?.t('shop.loginRequired') || '请先登录'}</div>`;
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
                list.innerHTML = `<div style="text-align:center; color:rgba(255,255,255,0.3); padding:40px;">${window.i18n?.t('shop.noOrders') || '暂无订单记录'}</div>`;
                return;
            }

            data.forEach(order => {
                const item = document.createElement('div');
                item.className = 'glass-box';
                item.style.padding = '12px 16px';
                item.style.marginBottom = '8px';
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';

                const date = new Date(order.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const icon = order.shop_products?.icon_url || 'fas fa-box';
                const iconHtml = icon.startsWith('http') ? `<img src="${icon}" style="width:24px;height:24px;border-radius:4px;margin-right:8px;">` : `<i class="${icon}" style="margin-right:8px;color:#6b9ece;"></i>`;

                item.innerHTML = `
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; margin-bottom:4px;">
                            ${iconHtml}
                            <span style="font-weight:600; font-size:14px; color:#fff;">${order.shop_products?.name || (window.i18n?.t('shop.unknownProduct') || '未知商品')}</span>
                        </div>
                        <div style="font-size:12px; color:rgba(255,255,255,0.4);">
                            ${date} · <span style="color:#fbbf24;">-${order.price_paid} ${window.SiteConfig?.getPointsLabel() || window.i18n?.t('shop.points') || '积分'}</span>
                        </div>
                    </div>
                    <button onclick="event.stopPropagation(); ShopClient.viewOrderContent('${order.id}', '${encodeURIComponent(order.content_delivered || '')}')"
                        style="padding:6px 12px; border-radius:12px; background:rgba(255,255,255,0.1); border:none; color:#fff; cursor:pointer;">
                        ${window.i18n?.t('shop.view') || '查看'}
                    </button>
                `;
                list.appendChild(item);
            });
        } catch (err) {
            console.error(err);
            list.innerHTML = `<div style="text-align:center; color:#ff4d4f;">${window.i18n?.t('common.error') || '加载失败'}</div>`;
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
            btn.style.background = '#4ade80';
            btn.style.color = '#fff';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = ''; // reset to class style
                btn.style.color = '';
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
        btn.style.background = '#4ade80';
        btn.style.color = '#fff';
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.style.background = '';
            btn.style.color = '';
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
