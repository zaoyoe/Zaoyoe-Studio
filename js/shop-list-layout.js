(function () {
    'use strict';

    const STORAGE_KEY = 'shop-layout-view';
    const MOBILE_MQ = '(max-width: 820px)';
    const LIST_CART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><circle cx="9" cy="20" r="1.15"/><circle cx="17" cy="20" r="1.15"/><path d="M3 4h2l2.2 11.2A2 2 0 0 0 9.2 17h7.7a2 2 0 0 0 2-1.55L21 8H7"/></svg>';
    const BOX_ICON = '<svg class="shop-icon-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>';

    const state = {
        view: 'list',
        query: '',
        layoutMode: 'desktop',
        pendingAnimate: false,
        hooked: false,
        ready: false
    };

    let syncTimer = 0;
    let drawerReadyTimer = 0;
    let listEnterToken = 0;
    let listEnterTimer = 0;
    let indicatorObserver = null;

    function $(sel, root) {
        return (root || document).querySelector(sel);
    }

    function $all(sel, root) {
        return Array.from((root || document).querySelectorAll(sel));
    }

    function shopClient() {
        return window.ShopClient || null;
    }

    function prefersReducedMotion() {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function isMobileLayout() {
        return Boolean(window.matchMedia && window.matchMedia(MOBILE_MQ).matches);
    }

    function effectiveView() {
        return isMobileLayout() ? 'list' : state.view;
    }

    function isEnglish() {
        const shop = shopClient();
        return Boolean(shop && typeof shop.isEnglishShopLocale === 'function' && shop.isEnglishShopLocale());
    }

    function copy() {
        const en = isEnglish();
        return {
            categories: en ? 'Categories' : '商品分类',
            catalog: en ? 'Current category' : '当前分类',
            searchPlaceholder: en ? 'Search all products' : '搜索全部商品',
            search: en ? 'Search' : '搜索',
            filter: en ? 'Filter' : '筛选分类',
            product: en ? 'Product' : '商品',
            price: en ? 'Price' : '价格',
            stock: en ? 'Stock' : '库存',
            sales: en ? 'Sales' : '销量',
            buy: en ? 'Buy' : '购买',
            soldOut: en ? 'Sold out' : '售罄',
            addCart: en ? 'Add to cart' : '加入购物车',
            empty: en ? 'No matching products.' : '没有找到匹配商品。',
            loading: en ? 'Loading products…' : '商品加载中…',
            searchResults: (count) => en ? `Search results (${count})` : `搜索结果（${count}）`,
            wholesale: en ? 'Tiered' : '阶梯价',
            auto: en ? 'Instant delivery' : '自动交付',
            online: en ? 'Online delivery' : '在线交付',
            low: en ? 'Low stock' : '即将售罄',
            ok: en ? 'In stock' : '充足',
            plenty: en ? 'Plenty' : '非常多',
            closeCategories: en ? 'Close categories' : '关闭分类',
            orderQuery: en ? 'Orders' : '订单查询',
            grid: en ? 'Grid cards' : '网格卡片',
            list: en ? 'List catalog' : '列目录'
        };
    }

    function syncStaticCopy() {
        const labels = copy();
        const asideKicker = $('.list-aside .list-panel-kicker');
        const asideTitle = $('.list-aside__title');
        const catalogKickers = $all('.list-catalog .list-panel-kicker, [data-list-mobile-catalog-kicker]');
        const filterTrigger = $('.list-mobile-filter__trigger');
        const filterLabel = filterTrigger
            ? Array.from(filterTrigger.children).find((child) => child.tagName === 'SPAN')
            : null;
        const closeButton = $('[data-list-drawer-close]');
        const orderQueryButtons = $all('[data-list-order-query]');
        const searchInput = $('#listSearchInput');
        const searchSubmit = $('.list-search-submit');
        const searchSubmitLabel = searchSubmit
            ? Array.from(searchSubmit.children).find((child) => child.tagName === 'SPAN')
            : null;
        const tableLabels = $all('.list-table-head > span');
        const viewToggle = $('.view-toggle');
        const viewButtons = $all('[data-view-target]');

        if (asideKicker) asideKicker.textContent = labels.categories;
        if (asideTitle) asideTitle.textContent = labels.categories;
        catalogKickers.forEach((el) => {
            el.textContent = labels.catalog;
        });
        if (filterLabel) filterLabel.textContent = labels.filter;
        if (filterTrigger) filterTrigger.setAttribute('aria-label', labels.filter);
        if (closeButton) closeButton.setAttribute('aria-label', labels.closeCategories);
        orderQueryButtons.forEach((button) => {
            const labelEl = Array.from(button.children).find((child) => child.tagName === 'SPAN');
            if (labelEl) labelEl.textContent = labels.orderQuery;
            else button.textContent = labels.orderQuery;
            button.setAttribute('aria-label', labels.orderQuery);
            button.setAttribute('title', labels.orderQuery);
        });
        if (searchInput) {
            searchInput.placeholder = labels.searchPlaceholder;
            searchInput.setAttribute('aria-label', labels.searchPlaceholder);
        }
        if (searchSubmitLabel) searchSubmitLabel.textContent = labels.search;
        if (searchSubmit) searchSubmit.setAttribute('aria-label', labels.search);
        [labels.product, labels.price, labels.stock, labels.sales, ''].forEach((label, index) => {
            if (tableLabels[index]) tableLabels[index].textContent = label;
        });
        if (viewToggle) viewToggle.setAttribute('aria-label', `${labels.grid} / ${labels.list}`);
        if (viewButtons[0]) {
            viewButtons[0].setAttribute('title', labels.grid);
            viewButtons[0].setAttribute('aria-label', labels.grid);
        }
        if (viewButtons[1]) {
            viewButtons[1].setAttribute('title', labels.list);
            viewButtons[1].setAttribute('aria-label', labels.list);
        }
    }

    function escapeHtml(value) {
        const shop = shopClient();
        if (shop && typeof shop.escapeHtml === 'function') {
            return shop.escapeHtml(value);
        }
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        const shop = shopClient();
        if (shop && typeof shop.escapeAttribute === 'function') {
            return shop.escapeAttribute(value);
        }
        return escapeHtml(value);
    }

    function readStoredView() {
        try {
            const stored = String(localStorage.getItem(STORAGE_KEY) || '').trim();
            return stored === 'list' || stored === 'grid' ? stored : 'list';
        } catch (_error) {
            return 'list';
        }
    }

    function persistView(view) {
        try {
            localStorage.setItem(STORAGE_KEY, view);
        } catch (_error) {
            // Ignore private-mode storage failures.
        }
    }

    function getCategoryEntries() {
        const shop = shopClient();
        if (!shop || typeof shop.getCategoryFilterEntries !== 'function') return [];
        return shop.getCategoryFilterEntries(shop.availableCategories || []);
    }

    function getCategoryLabel(name) {
        const shop = shopClient();
        const match = getCategoryEntries().find((entry) => entry.name === name);
        if (match?.label) return match.label;
        if (shop && typeof shop.getLocalizedProductCategoryLabel === 'function') {
            return shop.getLocalizedProductCategoryLabel(name) || name || '';
        }
        return name || '';
    }

    function countProductsInCategory(name) {
        const shop = shopClient();
        if (!shop) return 0;
        if (typeof shop.getCachedProductsForCategory === 'function') {
            const cached = shop.getCachedProductsForCategory(name);
            if (Array.isArray(cached)) return cached.length;
        }
        const all = Array.isArray(shop.allProductsCache) ? shop.allProductsCache : [];
        return all.filter((product) => String(product?.category || '') === String(name || '')).length;
    }

    function getAllProducts() {
        const shop = shopClient();
        if (!shop) return [];
        if (Array.isArray(shop.allProductsCache)) return shop.allProductsCache;
        const grouped = Object.values(shop.categoryProductsCache || {});
        const merged = [];
        const seen = new Set();
        grouped.forEach((list) => {
            (Array.isArray(list) ? list : []).forEach((product) => {
                const id = String(product?.id || '').trim();
                if (!id || seen.has(id)) return;
                seen.add(id);
                merged.push(product);
            });
        });
        return merged;
    }

    function ensureAllProductsForSearch() {
        const shop = shopClient();
        const query = state.query.trim();
        if (!shop || !query || Array.isArray(shop.allProductsCache)) return;
        if (typeof shop.getProductsForCategory !== 'function') return;

        Promise.resolve(shop.getProductsForCategory('all'))
            .then(() => {
                if (state.query.trim() !== query) return;
                renderList({ animate: false });
                updateCategoryTitles();
                renderFilters({ animateListIndicator: false });
            })
            .catch(() => {
                // The primary catalog request owns the user-facing error state.
            });
    }

    function getVisibleProducts() {
        const shop = shopClient();
        if (!shop) return [];
        const query = state.query.trim().toLowerCase();
        if (query) {
            return getAllProducts().filter((product) => {
                const name = typeof shop.getLocalizedProductName === 'function' ? shop.getLocalizedProductName(product) : (product?.name || '');
                const desc = typeof shop.getLocalizedProductDescription === 'function' ? shop.getLocalizedProductDescription(product) : (product?.description || '');
                const category = getCategoryLabel(product?.category);
                return `${name} ${desc} ${category}`.toLowerCase().includes(query);
            });
        }
        const category = String(shop.currentCategory || '').trim();
        if (typeof shop.getCachedProductsForCategory === 'function') {
            const cached = shop.getCachedProductsForCategory(category);
            if (Array.isArray(cached)) return cached;
        }
        return getAllProducts().filter((product) => String(product?.category || '') === category);
    }

    function isCatalogLoading() {
        const shop = shopClient();
        const products = getVisibleProducts();
        if (products.length) return false;
        const grid = document.getElementById('userShopGrid');
        if (grid?.querySelector('.shop-card[data-product-id]')) return false;
        if (grid?.querySelector('.skeleton-card, .skeleton')) return true;
        if (shop && !Array.isArray(shop.allProductsCache) && !(shop.availableCategories || []).length) return true;
        return false;
    }

    function getSalesCount(product) {
        const keys = ['sales_count', 'sold_count', 'units_sold', 'sales', 'purchase_count', 'total_sold'];
        for (let i = 0; i < keys.length; i += 1) {
            const numeric = Number(product?.[keys[i]]);
            if (Number.isFinite(numeric) && numeric >= 0) return Math.trunc(numeric);
        }
        return null;
    }

    function getFulfillment(product) {
        const shop = shopClient();
        if (shop && typeof shop.getShopProductCardFulfillmentState === 'function') {
            return shop.getShopProductCardFulfillmentState(product) || {};
        }
        return { manualDelivery: false, soldOut: false };
    }

    function getStockCount(product) {
        const shop = shopClient();
        if (shop && typeof shop.getShopProductCardStockCount === 'function') {
            return shop.getShopProductCardStockCount(product);
        }
        const numeric = Number(product?.stock_count ?? product?.stockCount ?? 0);
        return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
    }

    function listStockMeta(product, fulfillment) {
        const labels = copy();
        if (fulfillment.manualDelivery) {
            return { label: labels.online, kind: 'manual', chip: 'manual' };
        }
        const stock = getStockCount(product);
        if (fulfillment.soldOut || stock <= 0) {
            return { label: labels.soldOut, kind: 'sold-out', chip: 'sold' };
        }
        if (stock < 3) return { label: labels.low, kind: 'in-stock', chip: 'low' };
        if (stock <= 10) return { label: labels.ok, kind: 'in-stock', chip: 'ok' };
        return { label: labels.plenty, kind: 'in-stock', chip: 'plenty' };
    }

    function hasTieredPricing(product, pricingState) {
        if (pricingState?.tieredPricingBadgeHtml) return true;
        const shop = shopClient();
        if (!shop || typeof shop.getTieredPricingContext !== 'function') return false;
        const tiered = shop.getTieredPricingContext({
            basePrice: pricingState?.currentPrice,
            rules: typeof shop.resolveQuantityPricingRulesForProductSelection === 'function'
                ? shop.resolveQuantityPricingRulesForProductSelection(product)
                : [],
            quantity: 1
        });
        return Boolean(tiered?.lowestRule);
    }

    function listChipsMarkup(product, fulfillment, pricingState) {
        const shop = shopClient();
        if (shop && typeof shop.buildShopProductCardChipsMarkup === 'function') {
            return shop.buildShopProductCardChipsMarkup(product, fulfillment, pricingState);
        }
        const labels = copy();
        const stock = listStockMeta(product, fulfillment);
        const chips = [];
        if (hasTieredPricing(product, pricingState)) {
            chips.push(`<span class="list-chip list-chip--wholesale">${escapeHtml(labels.wholesale)}</span>`);
        }
        if (!fulfillment.manualDelivery) {
            chips.push(`<span class="list-chip list-chip--stock list-chip--stock-${stock.chip}">${escapeHtml(labels.stock)} ${escapeHtml(stock.label)}</span>`);
        }
        const sales = getSalesCount(product);
        chips.push(`<span class="list-chip list-chip--sales">${escapeHtml(labels.sales)} ${sales == null ? '—' : escapeHtml(String(sales))}</span>`);
        chips.push(fulfillment.manualDelivery
            ? `<span class="list-chip list-chip--online">${escapeHtml(labels.online)}</span>`
            : `<span class="list-chip list-chip--auto">${escapeHtml(labels.auto)}</span>`);
        return `<div class="list-chips">${chips.join('')}</div>`;
    }

    window.ShopListLayout = Object.assign(window.ShopListLayout || {}, {
        listChipsMarkup
    });

    function thumbMarkup(product, displayName) {
        const shop = shopClient();
        const imageAsset = typeof window.getShopProductImageAsset === 'function'
            ? window.getShopProductImageAsset(product)
            : null;
        const originalUrl = typeof window.getShopProductImageAssetUrl === 'function'
            ? (window.getShopProductImageAssetUrl(imageAsset, 'original') || String(product?.icon_url || ''))
            : String(product?.icon_url || '');
        const hasCoverImage = shop && typeof shop.isShopImageSource === 'function'
            ? shop.isShopImageSource(originalUrl)
            : /^https?:\/\//i.test(originalUrl);
        if (hasCoverImage) {
            return `<img class="list-thumb__image" alt="${escapeAttribute(displayName)}" width="64" height="64" draggable="false">`;
        }
        if (String(product?.icon_url || '').startsWith('fa')) {
            return `<i class="${escapeAttribute(product.icon_url)}" aria-hidden="true"></i>`;
        }
        return BOX_ICON;
    }

    function hydrateRowImages(root) {
        const shop = shopClient();
        if (!shop || typeof shop.setShopCardImageSource !== 'function') return;
        $all('.list-row[data-product-id]', root).forEach((row) => {
            const img = row.querySelector('.list-thumb__image');
            if (!(img instanceof HTMLImageElement)) return;
            const product = typeof shop.getCachedProductById === 'function'
                ? shop.getCachedProductById(row.dataset.productId)
                : getAllProducts().find((item) => String(item?.id || '') === String(row.dataset.productId || ''));
            if (!product) return;
            const imageAsset = typeof window.getShopProductImageAsset === 'function'
                ? window.getShopProductImageAsset(product)
                : product;
            const version = typeof window.buildShopProductImageCacheVersion === 'function'
                ? window.buildShopProductImageCacheVersion(product)
                : '';
            shop.setShopCardImageSource(img, imageAsset, { version });
        });
    }

    function applyPurchaseDataset(element, product, pricingState) {
        const shop = shopClient();
        if (!shop || !(element instanceof HTMLElement) || !pricingState) return;
        const payload = typeof shop.buildProductCardPurchaseDataset === 'function'
            ? shop.buildProductCardPurchaseDataset(product, pricingState.currentPrice)
            : null;
        if (payload && typeof shop.applyShopPurchaseDataset === 'function') {
            shop.applyShopPurchaseDataset(element, payload);
            element.dataset.maxPurchaseQuantity = String(payload.maxPurchaseQuantity || '');
        }
    }

    function listSkeletonMarkup() {
        return Array.from({ length: 6 }, () => `<article class="list-row is-skeleton" aria-hidden="true">
                <div class="list-product">
                    <div class="list-thumb list-skel"></div>
                    <div class="list-product__copy">
                        <strong class="list-skel"></strong>
                        <p class="list-skel"></p>
                    </div>
                </div>
                <div class="list-metrics">
                    <div class="list-price list-skel"></div>
                    <span class="list-stock list-skel"></span>
                    <span class="list-sales list-skel"></span>
                    <div class="list-actions list-skel"></div>
                </div>
            </article>`).join('');
    }

    function listRowsMarkup() {
        const shop = shopClient();
        const labels = copy();
        if (isCatalogLoading()) {
            return listSkeletonMarkup();
        }
        const products = getVisibleProducts();
        const query = state.query.trim();
        if (!products.length) {
            return `<div class="shop-list-empty">${escapeHtml(labels.empty)}</div>`;
        }
        return products.map((product) => {
            const pricingState = shop && typeof shop.buildProductCardPricingState === 'function'
                ? shop.buildProductCardPricingState(product, shop.agentPricesCache || {})
                : { currentPrice: product?.price_points, priceHtml: String(product?.price_points ?? '') };
            if (!pricingState) return '';
            const fulfillment = getFulfillment(product);
            const stock = listStockMeta(product, fulfillment);
            const soldOut = stock.kind === 'sold-out';
            const cartDisabled = fulfillment.manualDelivery || soldOut;
            const displayName = shop && typeof shop.getLocalizedProductName === 'function'
                ? shop.getLocalizedProductName(product)
                : (product?.name || '');
            const shouldShowDescription = !shop
                || typeof shop.shouldShowProductCardDescription !== 'function'
                || shop.shouldShowProductCardDescription(product);
            const displayDesc = shouldShowDescription && shop && typeof shop.getLocalizedProductDescription === 'function'
                ? shop.getLocalizedProductDescription(product)
                : (shouldShowDescription ? (product?.description || '') : '');
            const priceValue = shop && typeof shop.formatShopPointValue === 'function'
                ? shop.formatShopPointValue(pricingState.currentPrice)
                : String(pricingState.currentPrice ?? '');
            const sales = getSalesCount(product);
            const shopAction = soldOut ? 'sold-out-product' : 'buy-product';
            const buyLabel = soldOut ? labels.soldOut : labels.buy;
            const categoryChip = query
                ? `<span class="list-category-chip">${escapeHtml(getCategoryLabel(product?.category))}</span>`
                : '';
            const cartAria = cartDisabled
                ? (fulfillment.manualDelivery ? labels.online : labels.soldOut)
                : (shop && typeof shop.getCartCopy === 'function' ? shop.getCartCopy().addLabel : labels.addCart);
            return `<article class="list-row${soldOut ? ' is-sold-out' : ''}" data-shop-action="${shopAction}" data-product-id="${escapeAttribute(product.id)}" role="button" tabindex="0">
                <div class="list-product">
                    <div class="list-thumb">${thumbMarkup(product, displayName)}</div>
                    <div class="list-product__copy">
                        ${categoryChip}
                        <strong>${escapeHtml(displayName)}</strong>
                        <p>${escapeHtml(displayDesc || '')}</p>
                        ${listChipsMarkup(product, fulfillment, pricingState)}
                    </div>
                </div>
                <div class="list-metrics">
                    <div class="list-price"><span class="list-price__symbol" aria-hidden="true">￥</span><span class="list-price__value">${escapeHtml(priceValue)}</span></div>
                    <span class="list-stock">${escapeHtml(stock.label)}</span>
                    <span class="list-sales">${sales == null ? '—' : escapeHtml(String(sales))}</span>
                    <div class="list-actions">
                        <button class="list-cart${cartDisabled ? ' is-disabled' : ''}" type="button" data-shop-action="add-product-to-cart" aria-disabled="${cartDisabled ? 'true' : 'false'}" aria-label="${escapeAttribute(cartAria)}">${LIST_CART_ICON}</button>
                        <button class="list-buy${fulfillment.manualDelivery ? ' is-manual' : ''}${soldOut ? ' is-disabled' : ''}" type="button" data-shop-action="${shopAction}">${escapeHtml(buyLabel)}</button>
                    </div>
                </div>
            </article>`;
        }).join('');
    }

    function openOrderRecords() {
        const context = {
            entry: 'shop_list_order_query',
            sourceModule: 'shop_list'
        };
        setListDrawer(false);
        const open = async () => {
            let walletModal = null;
            if (typeof window.ZaoyoeWalletModalBootstrap?.open === 'function') {
                walletModal = await window.ZaoyoeWalletModalBootstrap.open('orders', context);
            } else if (typeof window.WalletModal?.open === 'function') {
                await window.WalletModal.open('orders', context);
                walletModal = window.WalletModal;
            }
            if (walletModal && typeof walletModal.switchView === 'function') {
                walletModal.switchView('orders');
            }
            if (!walletModal) {
                shopClient()?.showShopToast?.(window.i18n?.t('wallet.loading') || '钱包模块加载中，请稍后重试', 'error');
            }
        };
        void open().catch((error) => {
            console.warn('[ShopListLayout] Failed to open order records:', error?.message || error);
        });
    }

    function updateCategoryTitles() {
        const shop = shopClient();
        const labels = copy();
        const query = state.query.trim();
        const title = query
            ? labels.searchResults(getVisibleProducts().length)
            : getCategoryLabel(shop?.currentCategory || '');
        const mobileTitle = $('#listMobileCategoryTitle');
        const desktopTitle = $('#listDesktopCategoryTitle');
        if (mobileTitle) mobileTitle.textContent = title || labels.catalog;
        if (desktopTitle) desktopTitle.textContent = title || labels.catalog;
    }

    function syncListIndicator({ animate = false } = {}) {
        const listFilters = $('#listCategoryFilters');
        if (!listFilters) return;
        const indicator = listFilters.querySelector('.list-aside__indicator');
        const active = listFilters.querySelector('.filter-tab.active');
        if (!indicator || !active) return;
        const top = active.offsetTop;
        const height = active.offsetHeight;
        if (!height) return;
        const skipMotion = !animate || prefersReducedMotion() || indicator.dataset.placed !== '1';
        indicator.style.transition = skipMotion ? 'none' : '';
        indicator.style.height = `${height}px`;
        indicator.style.transform = `translate3d(0, ${top}px, 0)`;
        if (skipMotion) {
            void indicator.offsetHeight;
            indicator.style.transition = '';
        }
        indicator.dataset.placed = '1';
    }

    function ensureListIndicatorObserver() {
        const listFilters = $('#listCategoryFilters');
        if (!listFilters || listFilters.dataset.observed === '1') return;
        listFilters.dataset.observed = '1';
        if (typeof ResizeObserver !== 'function') return;
        indicatorObserver = new ResizeObserver(() => syncListIndicator({ animate: false }));
        indicatorObserver.observe(listFilters);
    }

    function renderFilters({ animateListIndicator = false } = {}) {
        const listFilters = $('#listCategoryFilters');
        const shop = shopClient();
        if (!listFilters || !shop) return;
        const entries = getCategoryEntries();
        const current = String(shop.currentCategory || '');
        const existingTabs = $all('.filter-tab[data-shop-category]', listFilters);
        const canPatchInPlace = entries.length > 0
            && existingTabs.length === entries.length
            && existingTabs.every((tab, index) => tab.dataset.shopCategory === entries[index].name);

        if (canPatchInPlace) {
            existingTabs.forEach((tab, index) => {
                const entry = entries[index];
                const isActive = entry.name === current;
                tab.classList.toggle('active', isActive);
                tab.dataset.shopCategory = entry.name;
                tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                const label = tab.querySelector('[data-list-category-label]');
                const count = tab.querySelector('[data-list-category-count]');
                if (label) label.textContent = entry.label;
                if (count) count.textContent = String(countProductsInCategory(entry.name));
            });
        } else {
            listFilters.innerHTML = '<span class="list-aside__indicator" aria-hidden="true"></span>' + entries.map((entry) => {
                const isActive = entry.name === current;
                return `<button class="filter-tab${isActive ? ' active' : ''}" type="button" data-shop-category="${escapeAttribute(entry.name)}" aria-pressed="${isActive ? 'true' : 'false'}">
                    <span data-list-category-label>${escapeHtml(entry.label)}</span>
                    <span class="count" data-list-category-count>${countProductsInCategory(entry.name)}</span>
                </button>`;
            }).join('');
        }
        ensureListIndicatorObserver();
        requestAnimationFrame(() => syncListIndicator({ animate: animateListIndicator }));
    }

    function paintList() {
        const rows = $('#listRows');
        if (!rows) return;
        const loading = isCatalogLoading();
        rows.setAttribute('aria-busy', loading ? 'true' : 'false');
        if (loading && rows.querySelector('.list-row.is-skeleton')) {
            updateCategoryTitles();
            return;
        }
        rows.innerHTML = listRowsMarkup();
        $all('.list-row[data-product-id]', rows).forEach((row) => {
            const shop = shopClient();
            const product = shop && typeof shop.getCachedProductById === 'function'
                ? shop.getCachedProductById(row.dataset.productId)
                : getAllProducts().find((item) => String(item?.id || '') === String(row.dataset.productId || ''));
            if (!product) return;
            const pricingState = shop.buildProductCardPricingState(product, shop.agentPricesCache || {});
            applyPurchaseDataset(row, product, pricingState);
            const cartButton = row.querySelector('[data-shop-action="add-product-to-cart"]');
            const buyButton = row.querySelector('.list-buy[data-shop-action]');
            applyPurchaseDataset(cartButton, product, pricingState);
            applyPurchaseDataset(buyButton, product, pricingState);
        });
        hydrateRowImages(rows);
        updateCategoryTitles();
    }

    function clearListEnterTimer() {
        window.clearTimeout(listEnterTimer);
    }

    function renderList({ animate = false } = {}) {
        const rows = $('#listRows');
        if (!rows) return;
        const canAnimate = Boolean(
            animate
            && effectiveView() === 'list'
            && !prefersReducedMotion()
        );
        const token = ++listEnterToken;
        clearListEnterTimer();
        rows.classList.remove('is-enter');
        paintList();
        if (!canAnimate || rows.querySelector('.list-row.is-skeleton')) return;
        void rows.offsetWidth;
        rows.classList.add('is-enter');
        listEnterTimer = window.setTimeout(() => {
            if (token !== listEnterToken) return;
            rows.classList.remove('is-enter');
        }, 520);
    }

    function setListDrawerReady(ready) {
        const shopMain = $('.shop-main');
        const shouldReady = Boolean(ready) && isMobileLayout() && effectiveView() === 'list';
        shopMain?.classList.toggle('is-list-drawer-ready', shouldReady);
    }

    function scheduleListDrawerReady() {
        window.clearTimeout(drawerReadyTimer);
        drawerReadyTimer = window.setTimeout(() => {
            if (isMobileLayout() && effectiveView() === 'list') setListDrawerReady(true);
        }, 50);
    }

    function setListDrawer(open) {
        const shopMain = $('.shop-main');
        const trigger = $('[data-list-drawer-open]');
        const shouldOpen = Boolean(open) && isMobileLayout() && effectiveView() === 'list';
        shopMain?.classList.toggle('is-list-drawer-open', shouldOpen);
        document.body.classList.toggle('shop-list-drawer-open', shouldOpen);
        if (trigger) trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        if (shouldOpen) {
            setListDrawerReady(true);
            requestAnimationFrame(() => syncListIndicator({ animate: false }));
        }
    }

    function applyLayoutClasses() {
        const shopMain = $('.shop-main');
        const view = effectiveView();
        const mobile = isMobileLayout();
        const crossedViewport = state.layoutMode !== (mobile ? 'mobile' : 'desktop');
        if (!mobile || view !== 'list' || crossedViewport) {
            window.clearTimeout(drawerReadyTimer);
            setListDrawerReady(false);
            setListDrawer(false);
        }
        state.layoutMode = mobile ? 'mobile' : 'desktop';
        document.body.dataset.layoutMode = state.layoutMode;
        document.documentElement.dataset.shopLayout = view;
        document.documentElement.dataset.layoutMode = state.layoutMode;
        if (!shopMain) return;
        shopMain.classList.toggle('shop-layout--grid', view === 'grid');
        shopMain.classList.toggle('shop-layout--list', view === 'list');
        shopMain.dataset.shopLayout = view;
        const viewToggle = $('.view-toggle');
        if (viewToggle) {
            viewToggle.dataset.view = state.view;
            viewToggle.setAttribute('aria-hidden', mobile ? 'true' : 'false');
        }
        $all('[data-view-target]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.viewTarget === state.view);
        });
        if (mobile && view === 'list') scheduleListDrawerReady();
    }

    function setView(view) {
        const next = view === 'list' ? 'list' : 'grid';
        state.view = next;
        persistView(next);
        setListDrawer(false);
        applyLayoutClasses();
        if (effectiveView() === 'list') {
            renderFilters({ animateListIndicator: false });
            renderList({ animate: false });
            requestAnimationFrame(() => syncListIndicator({ animate: false }));
        }
    }

    function syncFromShop({ animate = false } = {}) {
        if (!state.ready) return;
        applyLayoutClasses();
        renderFilters({ animateListIndicator: animate && effectiveView() === 'list' });
        if (effectiveView() === 'list') {
            renderList({
                animate: animate && !state.query.trim()
            });
        }
    }

    function scheduleSyncFromShop(options) {
        window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(() => syncFromShop(options || {}), 30);
    }

    function handleShopAction(target, sourceContextExtra) {
        const shop = shopClient();
        if (!shop || !(target instanceof Element) || target.disabled) return;
        const action = target.dataset.shopAction || '';
        const sourceContext = {
            ...(typeof window.resolveShopSourceContext === 'function' ? window.resolveShopSourceContext() : {}),
            ...(sourceContextExtra || {})
        };
        if (action === 'add-product-to-cart') {
            const payload = shop.getShopPurchasePayloadFromDataset(target.dataset);
            if (shop.isShopPurchasePayloadManualDelivery?.(payload)) {
                shop.showManualDeliveryProductToast?.(payload);
                return;
            }
            if (shop.isShopPurchasePayloadSoldOut?.(payload)) {
                shop.showSoldOutProductToast?.(payload);
                return;
            }
            if (Number(payload.skuCount || 0) > 1) {
                shop.openProductPurchaseFromDataset(target.dataset, {
                    ...sourceContext,
                    sourceChannel: 'shop_card_cart'
                });
                return;
            }
            const addedQuantity = shop.addProductToCart(target.dataset.productId || '', 1, {
                skuId: payload.defaultSkuId || ''
            });
            if (addedQuantity > 0) {
                shop.trackProductAddToCartFromDataset?.(target.dataset, addedQuantity, sourceContext);
            }
            return;
        }
        if (action === 'sold-out-product' || action === 'buy-product') {
            shop.openProductPurchaseFromDataset(target.dataset, sourceContext);
        }
    }

    function selectCategory(name) {
        const shop = shopClient();
        if (!shop || !name) return;
        const changed = name !== String(shop.currentCategory || '');
        state.query = '';
        const input = $('#listSearchInput');
        if (input) input.value = '';
        setListDrawer(false);
        if (!changed) {
            renderList({ animate: effectiveView() === 'list' });
            updateCategoryTitles();
            return;
        }
        state.pendingAnimate = effectiveView() === 'list';
        const gridBtn = $all('#shopCategoryFilters .filter-tab[data-shop-category]')
            .find((button) => button.dataset.shopCategory === name);
        shop.filterCategory(name, gridBtn || undefined);
    }

    function applyListSearch() {
        const input = $('#listSearchInput');
        state.query = input ? String(input.value || '') : '';
        renderList({ animate: false });
        updateCategoryTitles();
        ensureAllProductsForSearch();
    }

    function hookShopClient() {
        const shop = shopClient();
        if (!shop || state.hooked) return;
        state.hooked = true;

        const originalLoadProducts = shop.loadProducts;
        if (typeof originalLoadProducts === 'function') {
            shop.loadProducts = async function hookedLoadProducts() {
                const result = await originalLoadProducts.apply(this, arguments);
                const animate = state.pendingAnimate;
                state.pendingAnimate = false;
                scheduleSyncFromShop({ animate });
                return result;
            };
        }

        const originalFilterCategory = shop.filterCategory;
        if (typeof originalFilterCategory === 'function') {
            shop.filterCategory = function hookedFilterCategory(category, btn) {
                const result = originalFilterCategory.apply(this, arguments);
                if (effectiveView() === 'list') {
                    renderFilters({ animateListIndicator: true });
                }
                return result;
            };
        }

        const originalRenderFilters = shop.renderCategoryFilterButtons;
        if (typeof originalRenderFilters === 'function') {
            shop.renderCategoryFilterButtons = function hookedRenderCategoryFilterButtons() {
                const result = originalRenderFilters.apply(this, arguments);
                if (state.ready) renderFilters({ animateListIndicator: false });
                return result;
            };
        }

        const originalUpdateFilters = shop.updateCategoryFilterButtons;
        if (typeof originalUpdateFilters === 'function') {
            shop.updateCategoryFilterButtons = function hookedUpdateCategoryFilterButtons() {
                const result = originalUpdateFilters.apply(this, arguments);
                if (state.ready) renderFilters({ animateListIndicator: false });
                return result;
            };
        }

        const originalHydrateProductCaches = shop.hydrateProductCaches;
        if (typeof originalHydrateProductCaches === 'function') {
            shop.hydrateProductCaches = function hookedHydrateProductCaches() {
                const result = originalHydrateProductCaches.apply(this, arguments);
                scheduleSyncFromShop({ animate: false });
                return result;
            };
        }

        const originalRefreshPricing = shop.refreshVisibleProductCardPricing;
        if (typeof originalRefreshPricing === 'function') {
            shop.refreshVisibleProductCardPricing = function hookedRefreshVisibleProductCardPricing() {
                const result = originalRefreshPricing.apply(this, arguments);
                if (state.ready && effectiveView() === 'list') {
                    scheduleSyncFromShop({ animate: false });
                }
                return result;
            };
        }
    }

    function observeShopDom() {
        const grid = document.getElementById('userShopGrid');
        const filters = document.getElementById('shopCategoryFilters');
        if (typeof MutationObserver !== 'function') return;
        const observer = new MutationObserver(() => {
            if (effectiveView() === 'list') scheduleSyncFromShop({ animate: false });
        });
        if (grid) observer.observe(grid, { childList: true, subtree: false });
        if (filters) observer.observe(filters, { childList: true, subtree: false });
    }

    function bind() {
        document.addEventListener('click', (event) => {
            const viewBtn = event.target.closest?.('[data-view-target]');
            if (viewBtn) {
                event.preventDefault();
                setView(viewBtn.dataset.viewTarget);
                return;
            }

            const openDrawer = event.target.closest?.('[data-list-drawer-open]');
            if (openDrawer) {
                event.preventDefault();
                setListDrawer(true);
                return;
            }

            const closeDrawer = event.target.closest?.('[data-list-drawer-close]');
            if (closeDrawer) {
                event.preventDefault();
                setListDrawer(false);
                return;
            }

            const orderQuery = event.target.closest?.('[data-list-order-query]');
            if (orderQuery) {
                event.preventDefault();
                openOrderRecords();
                return;
            }

            const listCategoryBtn = event.target.closest?.('#listCategoryFilters .filter-tab[data-shop-category]');
            if (listCategoryBtn) {
                event.preventDefault();
                selectCategory(listCategoryBtn.dataset.shopCategory || '');
                return;
            }

            const actionEl = event.target.closest?.('#listRows [data-shop-action]');
            if (!actionEl) return;
            event.preventDefault();
            event.stopPropagation();
            const extra = actionEl.dataset.shopAction === 'add-product-to-cart'
                ? { sourceChannel: 'shop_card_cart' }
                : {};
            handleShopAction(actionEl, extra);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setListDrawer(false);
                return;
            }
            if ((event.key !== 'Enter' && event.key !== ' ') || event.target.closest?.('button, input')) return;
            const row = event.target.closest?.('#listRows .list-row[data-shop-action]');
            if (!row) return;
            event.preventDefault();
            handleShopAction(row);
        });

        $('#listSearchInput')?.addEventListener('input', applyListSearch);
        $('#listSearchForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            applyListSearch();
        });

        window.addEventListener('languageChanged', () => {
            syncStaticCopy();
            syncFromShop({ animate: false });
        });

        if (window.matchMedia) {
            const media = window.matchMedia(MOBILE_MQ);
            const onChange = () => {
                applyLayoutClasses();
                if (effectiveView() === 'list') {
                    renderFilters({ animateListIndicator: false });
                    renderList({ animate: false });
                }
            };
            if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
            else if (typeof media.addListener === 'function') media.addListener(onChange);
        }
    }

    function init() {
        const shopMain = $('.shop-main');
        if (!shopMain || state.ready) return;
        state.view = readStoredView();
        syncStaticCopy();
        hookShopClient();
        applyLayoutClasses();
        bind();
        observeShopDom();
        state.ready = true;
        syncFromShop({ animate: false });
        const shop = shopClient();
        if (shop && typeof shop.refreshVisibleProductCardChips === 'function') {
            shop.refreshVisibleProductCardChips(shop.agentPricesCache || {});
        }
        window.ShopListLayout = Object.assign(window.ShopListLayout || {}, {
            setView,
            syncFromShop,
            getView: () => effectiveView(),
            listChipsMarkup
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());
