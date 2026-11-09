(function () {
    'use strict';

    const STORAGE_KEY = 'shop-layout-view';
    const MOBILE_MQ = '(max-width: 820px)';
    const LIST_CART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><circle cx="9" cy="20" r="1.15"/><circle cx="17" cy="20" r="1.15"/><path d="M3 4h2l2.2 11.2A2 2 0 0 0 9.2 17h7.7a2 2 0 0 0 2-1.55L21 8H7"/></svg>';
    const BOX_ICON = '<svg class="shop-icon-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>';

    const state = {
        view: 'list',
        query: '',
        gridQuery: '',
        layoutMode: 'desktop',
        pendingAnimate: false,
        hooked: false,
        ready: false,
        syncing: false
    };

    let syncTimer = 0;
    let drawerReadyTimer = 0;
    let listEnterToken = 0;
    let listEnterTimer = 0;
    let indicatorObserver = null;
    const shopCategoryExpandedState = new Set();
    const shopCategoryUserToggledState = new Set();

    function $(sel, root) {
        return (root || document).querySelector(sel);
    }

    function $all(sel, root) {
        return Array.from((root || document).querySelectorAll(sel));
    }

    function shopClient() {
        return window.ShopClient || null;
    }

    function normalizeSite(value) {
        return String(value || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
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
            flashSale: en ? 'Flash' : '秒杀',
            calculating: en ? 'Calculating...' : '计算中...',
            auto: en ? 'Instant delivery' : '自动交付',
            online: en ? 'Online delivery' : '在线交付',
            guestPurchase: en ? 'Guest purchase' : '游客可购',
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
        const asideKicker = $('.list-aside .list-panel-kicker, [data-list-aside-catalog-kicker]');
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

        if (asideKicker) asideKicker.textContent = labels.catalog;
        catalogKickers.forEach((el) => {
            el.textContent = labels.catalog;
        });
        updateCategoryTitles();
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

    function getCategoryIcon(name) {
        const shop = shopClient();
        const match = getCategoryEntries().find((entry) => entry.name === name);
        let iconUrl = match?.iconUrl;
        const lower = String(name || '').toLowerCase();
        if (iconUrl && (
            iconUrl.includes('202608282029589417833') ||
            iconUrl.includes('202606030325329662693') ||
            iconUrl.includes('gpt.png') ||
            iconUrl.includes('openai')
        ) && (lower.includes('gemini') || lower.includes('claude'))) {
            iconUrl = '';
        }
        if (iconUrl) return iconUrl;
        if (shop && typeof shop.getCategoryPredefinedIcon === 'function') {
            return shop.getCategoryPredefinedIcon(name) || '';
        }
        return '';
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

    function filterSearchProducts(products, searchQuery = state.query) {
        const shop = shopClient();
        const query = String(searchQuery || '').trim().toLowerCase();
        const catalog = Array.isArray(products) ? products : [];
        if (!shop || !query) return catalog;
        return catalog.filter((product) => {
            const name = typeof shop.getLocalizedProductName === 'function' ? shop.getLocalizedProductName(product) : (product?.name || '');
            const desc = typeof shop.getLocalizedProductDescription === 'function' ? shop.getLocalizedProductDescription(product) : (product?.description || '');
            const category = getCategoryLabel(product?.category);
            return `${name} ${desc} ${category}`.toLowerCase().includes(query);
        });
    }

    function getVisibleProducts() {
        const shop = shopClient();
        if (!shop) return [];
        if (state.query.trim()) return filterSearchProducts(getAllProducts());
        const category = String(shop.currentCategory || '').trim();
        if (typeof shop.getCachedProductsForCategory === 'function') {
            const cached = shop.getCachedProductsForCategory(category);
            if (Array.isArray(cached)) return cached;
        }
        const all = getAllProducts();
        if (!category || category === 'all') return all;

        // Support hierarchical category: if category is a parent, include products of its children
        const matchingCategories = new Set([category]);
        if (Array.isArray(shop.availableCategories)) {
            const catEntry = shop.availableCategories.find((c) => c.name === category);
            const pid = catEntry ? String(catEntry.id || catEntry.name) : category;
            shop.availableCategories.forEach((c) => {
                const pKey = c.parent_id || c.parent_name;
                if (pKey && (String(pKey) === pid || pKey === category)) {
                    matchingCategories.add(c.name);
                }
            });
        }
        return all.filter((product) => matchingCategories.has(String(product?.category || '')));
    }

    function isCatalogLoading() {
        const shop = shopClient();
        const products = getVisibleProducts();
        if (products.length) return false;
        if (state.query.trim() && Array.isArray(shop?.allProductsCache)) return false;
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
        const chip = stock < 3 ? 'low' : (stock <= 10 ? 'ok' : 'plenty');
        return { label: String(stock), kind: 'in-stock', chip };
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

    function listChipsMarkup(product, fulfillment, pricingState, priceMarkup = '') {
        const shop = shopClient();
        if (shop && typeof shop.buildShopProductCardChipsMarkup === 'function') {
            const chipsMarkup = shop.buildShopProductCardChipsMarkup(product, fulfillment, pricingState);
            return chipsMarkup.replace('<div class="list-chips">', `<div class="list-chips">${priceMarkup}`);
        }
        const labels = copy();
        const stock = listStockMeta(product, fulfillment);
        const chips = [];
        const flashContext = shop && typeof shop.getActiveFlashSalePricingContext === 'function'
            ? shop.getActiveFlashSalePricingContext(product, pricingState?.currentPrice)
            : null;
        const hasFlash = Boolean(pricingState?.hasFlashSale || pricingState?.flashSaleBadgeHtml || flashContext?.hasFlashSale);
        const flashSaleEnd = product?.flash_sale_end || '';
        const flashEndMs = flashSaleEnd ? Date.parse(flashSaleEnd) : null;
        if (hasFlash && Number.isFinite(flashEndMs) && Date.now() < flashEndMs) {
            chips.push(`<span class="list-chip list-chip--flash"><i class="fas fa-bolt-lightning list-chip--flash__icon" aria-hidden="true"></i><span class="flash-sale-badge__label">${escapeHtml(labels.flashSale)}</span></span>`);
        }
        const isGuestPurchasable = shop && typeof shop.isShopProductGuestPurchasable === 'function'
            ? shop.isShopProductGuestPurchasable(product)
            : Boolean(product?.allow_guest_purchase);
        if (isGuestPurchasable) {
            chips.push(`<span class="list-chip list-chip--guest-purchase">${escapeHtml(labels.guestPurchase || (copy().isEn ? 'Guest purchase' : '游客可购'))}</span>`);
        }
        if (hasTieredPricing(product, pricingState)) {
            chips.push(`<span class="list-chip list-chip--wholesale">${escapeHtml(labels.wholesale)}</span>`);
        }
        const minQuantity = (typeof shop?.getProductMinPurchaseQuantity === 'function')
            ? shop.getProductMinPurchaseQuantity(product)
            : Math.max(1, Number(product?.min_purchase_quantity || 1) || 1);
        if (minQuantity > 1) {
            chips.push(`<span class="list-chip list-chip--min-quantity">${minQuantity}件起售</span>`);
        }
        if (!fulfillment.manualDelivery) {
            chips.push(`<span class="list-chip list-chip--stock list-chip--stock-${stock.chip}">${escapeHtml(labels.stock)} ${escapeHtml(stock.label)}</span>`);
        }
        const sales = getSalesCount(product);
        chips.push(`<span class="list-chip list-chip--sales">${escapeHtml(labels.sales)} ${sales == null ? '—' : escapeHtml(String(sales))}</span>`);
        chips.push(fulfillment.manualDelivery
            ? `<span class="list-chip list-chip--online">${escapeHtml(labels.online)}</span>`
            : `<span class="list-chip list-chip--auto">${escapeHtml(labels.auto)}</span>`);
        return `<div class="list-chips">${priceMarkup}${chips.join('')}</div>`;
    }

    window.ShopListLayout = Object.assign(window.ShopListLayout || {}, {
        listChipsMarkup
    });

    function thumbMarkup(product, displayName, isFlashSale = false) {
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
            return `<img class="list-thumb__image" alt="${escapeAttribute(displayName)}" width="64" height="64" loading="lazy" decoding="async" draggable="false">`;
        }
        if (String(product?.icon_url || '').startsWith('fa')) {
            return `<i class="${escapeAttribute(product.icon_url)}" aria-hidden="true"></i>`;
        }
        return `${BOX_ICON}`;
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
            img.onerror = () => shop.handleShopCardImageError(img, imageAsset);
            shop.setShopCardImageSource(img, imageAsset, { version, variant: 'thumb' });
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
                        <div class="list-chips">
                            <span class="list-price list-price--inline list-chip list-skel"></span>
                            <span class="list-chip list-skel"></span>
                            <span class="list-chip list-skel"></span>
                        </div>
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
            const pricing = shop && typeof shop.resolveProductPricing === 'function'
                ? shop.resolveProductPricing(product, shop.agentPricesCache || {})
                : null;
            const flashContext = shop && typeof shop.getActiveFlashSalePricingContext === 'function'
                ? shop.getActiveFlashSalePricingContext(product, pricingState?.currentPrice)
                : null;
            const hasFlashSale = Boolean(pricingState?.hasFlashSale || pricingState?.flashSaleBadgeHtml || flashContext?.hasFlashSale);
            const originalPriceValue = (hasFlashSale && (flashContext?.flashSaleOriginalPrice != null || pricing?.originalPrice != null))
                ? (shop && typeof shop.formatShopPointValue === 'function'
                    ? shop.formatShopPointValue(flashContext?.flashSaleOriginalPrice ?? pricing?.originalPrice)
                    : String(flashContext?.flashSaleOriginalPrice ?? pricing?.originalPrice))
                : null;
            const inlineOriginalHtml = (hasFlashSale && originalPriceValue)
                ? `<del class="list-price__original" aria-label="${escapeAttribute(labels.originalPrice || '原价')}">￥${escapeHtml(originalPriceValue)}</del>`
                : '';
            const metricsOriginalHtml = (hasFlashSale && originalPriceValue)
                ? `<del class="list-price__original" aria-label="${escapeAttribute(labels.originalPrice || '原价')}">￥${escapeHtml(originalPriceValue)}</del>`
                : '';
            return `<article class="list-row${soldOut ? ' is-sold-out' : ''}${hasFlashSale ? ' is-flash-sale' : ''}" data-shop-action="${shopAction}" data-product-id="${escapeAttribute(product.id)}" role="button" tabindex="0">
                <div class="list-product">
                    <div class="list-thumb">${thumbMarkup(product, displayName, hasFlashSale)}</div>
                    <div class="list-product__copy">
                        ${categoryChip}
                        <strong>${escapeHtml(displayName)}</strong>
                        <p>${escapeHtml(displayDesc || '')}</p>
                        ${listChipsMarkup(product, fulfillment, pricingState, `<div class="list-price list-price--inline${hasFlashSale ? ' list-price--flash' : ''} list-chip list-chip--price">${inlineOriginalHtml}<span class="list-price__symbol" aria-hidden="true">￥</span><span class="list-price__value">${escapeHtml(priceValue)}</span></div>`)}
                    </div>
                </div>
                <div class="list-metrics">
                    <div class="list-price${hasFlashSale ? ' list-price--flash' : ''}">${metricsOriginalHtml}<span class="list-price__symbol" aria-hidden="true">￥</span><span class="list-price__value">${escapeHtml(priceValue)}</span></div>
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
            // The public shop has two order-query experiences. Resolve the
            // browser session at click time so a signed-out visitor never gets
            // sent into the wallet modal (which can only serve point orders).
            let session = null;
            try {
                const client = window.supabaseClient || window.supabase;
                if (client?.auth?.getSession) {
                    const result = await client.auth.getSession();
                    session = result?.data?.session || null;
                }
            } catch (error) {
                console.warn('[ShopListLayout] Failed to resolve auth state:', error?.message || error);
            }
            if (!session?.access_token) {
                const site = normalizeSite(window.ShopClient?.currentSite || new URL(window.location.href).searchParams.get('site') || 'cn');
                window.location.assign(`/guest-orders.html?site=${encodeURIComponent(site)}`);
                return;
            }
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
        const asideTitle = $('.list-aside__title');
        if (mobileTitle) mobileTitle.textContent = title || labels.catalog;
        if (desktopTitle) desktopTitle.textContent = title || labels.catalog;
        if (asideTitle) asideTitle.textContent = title || labels.catalog;
    }

    let indicatorTrackingFrame = 0;
    function animateIndicatorTracking(duration = 340) {
        if (typeof cancelAnimationFrame === 'function' && indicatorTrackingFrame) {
            cancelAnimationFrame(indicatorTrackingFrame);
        }
        const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        function frame(now) {
            syncListIndicator({ animate: false });
            syncGridIndicator({ animate: false });
            if (now - start < duration) {
                indicatorTrackingFrame = requestAnimationFrame(frame);
            } else {
                syncListIndicator({ animate: true });
                syncGridIndicator({ animate: true });
            }
        }
        indicatorTrackingFrame = requestAnimationFrame(frame);
    }

    function toggleCategorySubtabs(pid, forceState) {
        if (!pid) return;
        shopCategoryUserToggledState.add(pid);
        const currentExpanded = shopCategoryExpandedState.has(pid);
        const nextExpanded = typeof forceState === 'boolean' ? forceState : !currentExpanded;
        if (nextExpanded) {
            shopCategoryExpandedState.add(pid);
        } else {
            shopCategoryExpandedState.delete(pid);
        }

        // Toggle accordion wrapper class
        const wrappers = Array.from(document.querySelectorAll('.category-sub-tabs-wrapper'))
            .filter((w) => w.dataset.parentPid === String(pid));
        wrappers.forEach((w) => {
            w.classList.toggle('is-expanded', nextExpanded);
        });

        // Toggle chevron rotation & aria-expanded
        const chevrons = Array.from(document.querySelectorAll('[data-shop-toggle-subtabs]'))
            .filter((ch) => ch.getAttribute('data-shop-toggle-subtabs') === String(pid));
        chevrons.forEach((ch) => {
            ch.classList.toggle('expanded', nextExpanded);
            ch.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        });

        // Update count on parent category tab
        const entries = getCategoryEntries();
        const entryMap = new Map();
        entries.forEach(e => {
            if (e.id) entryMap.set(String(e.id), e);
            if (e.name) entryMap.set(String(e.name).toLowerCase(), e);
        });
        const parentEntry = entries.find((e) => String(e.id || e.name) === String(pid) || e.name === pid);
        if (parentEntry) {
            if (!wrappers.length) {
                Array.from(document.querySelectorAll('.category-item-group'))
                    .filter((g) => g.dataset.parentCategory === parentEntry.name)
                    .forEach((g) => {
                        const w = g.querySelector('.category-sub-tabs-wrapper');
                        if (w) w.classList.toggle('is-expanded', nextExpanded);
                        const ch = g.querySelector('[data-shop-toggle-subtabs]');
                        if (ch) {
                            ch.classList.toggle('expanded', nextExpanded);
                            ch.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
                        }
                    });
            }
            const children = entries.filter((e) => {
                const pKey = e.parentId || e.parentName;
                const parent = pKey ? (entryMap.get(String(pKey)) || entryMap.get(String(pKey).toLowerCase())) : null;
                return parent && String(parent.id || parent.name) === String(pid);
            });
            const directCount = countProductsInCategory(parentEntry.name);
            const totalCount = directCount + children.reduce((sum, c) => sum + countProductsInCategory(c.name), 0);
            const countText = String(nextExpanded ? directCount : totalCount);

            Array.from(document.querySelectorAll('.category-item-group'))
                .filter((g) => g.dataset.parentCategory === parentEntry.name)
                .forEach((g) => {
                    const countEl = g.querySelector('.category-item-row .filter-tab [data-list-category-count]');
                    if (countEl) countEl.textContent = countText;
                });
        }

        animateIndicatorTracking(340);
    }

    function syncCategoryIndicator(container, { animate = false } = {}) {
        if (!container) return;
        const indicator = container.querySelector('.list-aside__indicator');
        const active = container.querySelector('.filter-tab.active');
        if (!indicator || !active) return;
        let top = 0;
        let left = 0;
        let width = 0;
        let height = 0;
        if (typeof active.getBoundingClientRect === 'function' && typeof container.getBoundingClientRect === 'function') {
            const activeRect = active.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            top = Math.round(activeRect.top - containerRect.top + container.scrollTop);
            left = Math.round(activeRect.left - containerRect.left);
            width = Math.round(activeRect.width || active.offsetWidth);
            height = Math.round(active.offsetHeight || activeRect.height);
        } else {
            top = active.offsetTop;
            left = active.offsetLeft;
            width = active.offsetWidth;
            height = active.offsetHeight;
        }
        if (!height || !width) return;
        const currentLeft = indicator.dataset.left ? Number(indicator.dataset.left) : null;
        const currentTop = indicator.dataset.top ? Number(indicator.dataset.top) : null;
        const currentWidth = indicator.dataset.width ? Number(indicator.dataset.width) : null;
        const currentHeight = indicator.dataset.height ? Number(indicator.dataset.height) : null;
        const isPlaced = indicator.dataset.placed === '1';
        if (isPlaced && currentLeft === left && currentTop === top && currentWidth === width && currentHeight === height) {
            return;
        }
        indicator.dataset.left = String(left);
        indicator.dataset.top = String(top);
        indicator.dataset.width = String(width);
        indicator.dataset.height = String(height);
        const skipMotion = !animate || prefersReducedMotion() || !isPlaced;
        indicator.style.transition = skipMotion ? 'none' : '';
        indicator.style.width = `${width}px`;
        indicator.style.height = `${height}px`;
        indicator.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        if (skipMotion) {
            void indicator.offsetHeight;
            indicator.style.transition = '';
        }
        indicator.dataset.placed = '1';
    }

    function syncListIndicator(options = {}) {
        syncCategoryIndicator($('#listCategoryFilters'), options);
    }

    function syncGridIndicator(options = {}) {
        syncCategoryIndicator($('#shopCategoryFilters'), options);
    }

    function ensureListIndicatorObserver() {
        const listFilters = $('#listCategoryFilters');
        const gridFilters = $('#shopCategoryFilters');
        if (listFilters) listFilters.dataset.observed = '1';
        if (gridFilters) gridFilters.dataset.indicatorObserved = '1';
        if (listFilters && !listFilters.dataset.scrollBound) {
            listFilters.dataset.scrollBound = '1';
            listFilters.addEventListener('scroll', () => {
                syncListIndicator({ animate: false });
            }, { passive: true });
        }
        if (gridFilters && !gridFilters.dataset.scrollBound) {
            gridFilters.dataset.scrollBound = '1';
            gridFilters.addEventListener('scroll', () => {
                syncGridIndicator({ animate: false });
            }, { passive: true });
        }
        if (typeof ResizeObserver !== 'function' || indicatorObserver) return;
        indicatorObserver = new ResizeObserver(() => {
            syncListIndicator({ animate: false });
            syncGridIndicator({ animate: false });
        });
        if (listFilters) indicatorObserver.observe(listFilters);
        if (gridFilters) indicatorObserver.observe(gridFilters);
    }

    function createCategoryIconHtml(entry) {
        const iconUrl = getCategoryIcon(entry.name) || entry.iconUrl;
        if (iconUrl) {
            return `<img class="category-icon" src="${escapeAttribute(iconUrl)}" alt="" decoding="async" loading="lazy" onerror="this.style.display='none'">`;
        }
        const folderColor = entry.color || '#6b9ece';
        return `<i class="fas fa-folder category-folder-icon" style="color: ${escapeAttribute(folderColor)}"></i>`;
    }

    function syncCategoryTab(tab, entry, current) {
        if (!tab || !entry) return;
        const isActive = entry.name === current;
        tab.className = `filter-tab${isActive ? ' active' : ''}`;
        tab.type = 'button';
        tab.dataset.shopCategory = entry.name;
        tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');

        let main = tab.querySelector('.category-tab-main');
        let label = tab.querySelector('[data-list-category-label]');
        let count = tab.querySelector('[data-list-category-count]');
        let icon = tab.querySelector('.category-icon');
        let folderIcon = tab.querySelector('.category-folder-icon');
        const iconUrl = getCategoryIcon(entry.name) || entry.iconUrl;
        const folderColor = entry.color || '#6b9ece';

        if (!main || !label || !count) {
            main = document.createElement('span');
            main.className = 'category-tab-main';
            if (iconUrl) {
                icon = document.createElement('img');
                icon.className = 'category-icon';
                icon.src = iconUrl;
                icon.alt = '';
                icon.loading = 'lazy';
                icon.onerror = () => { icon.style.display = 'none'; };
                main.appendChild(icon);
            } else {
                folderIcon = document.createElement('i');
                folderIcon.className = 'fas fa-folder category-folder-icon';
                folderIcon.style.color = folderColor;
                main.appendChild(folderIcon);
            }
            label = document.createElement('span');
            label.className = 'category-name';
            label.dataset.listCategoryLabel = '';
            main.appendChild(label);

            count = document.createElement('span');
            count.className = 'count';
            count.dataset.listCategoryCount = '';

            tab.replaceChildren(main, count);
        } else {
            if (iconUrl) {
                if (folderIcon) folderIcon.remove();
                if (!icon) {
                    icon = document.createElement('img');
                    icon.className = 'category-icon';
                    icon.alt = '';
                    icon.loading = 'lazy';
                    icon.onerror = () => { icon.style.display = 'none'; };
                    main.insertBefore(icon, label);
                }
                if (icon.getAttribute('src') !== iconUrl) {
                    icon.src = iconUrl;
                    icon.style.display = '';
                }
            } else {
                if (icon) icon.remove();
                if (!folderIcon) {
                    folderIcon = document.createElement('i');
                    folderIcon.className = 'fas fa-folder category-folder-icon';
                    main.insertBefore(folderIcon, label);
                }
                folderIcon.style.color = folderColor;
            }
        }
        label.textContent = entry.label;
        count.textContent = String(countProductsInCategory(entry.name));
    }

    function renderCategoryContainer(container, entries, current, { withIndicator = false } = {}) {
        if (!container) return;
        container.setAttribute('aria-busy', 'false');

        const entryMap = new Map();
        entries.forEach(e => {
            if (e.id) entryMap.set(String(e.id), e);
            if (e.name) entryMap.set(String(e.name).toLowerCase(), e);
        });

        const topLevel = [];
        const childrenMap = new Map();

        entries.forEach(e => {
            const pKey = e.parentId || e.parentName;
            const parent = pKey ? (entryMap.get(String(pKey)) || entryMap.get(String(pKey).toLowerCase())) : null;
            if (parent && parent !== e) {
                const pid = String(parent.id || parent.name);
                if (!childrenMap.has(pid)) childrenMap.set(pid, []);
                childrenMap.get(pid).push(e);
            } else {
                topLevel.push(e);
            }
        });

        const expectedTabs = [];
        topLevel.forEach(p => {
            expectedTabs.push(p);
            const pid = String(p.id || p.name);
            const children = childrenMap.get(pid) || [];
            children.forEach(c => expectedTabs.push(c));
        });

        const existingTabs = $all('.filter-tab[data-shop-category]', container);
        const hasIndicator = Boolean(container.querySelector('.list-aside__indicator'));
        const indicatorMatches = withIndicator ? hasIndicator : !hasIndicator;

        const canPatchInPlace = expectedTabs.length > 0
            && existingTabs.length === expectedTabs.length
            && existingTabs.every((tab, index) => tab.dataset.shopCategory === expectedTabs[index].name)
            && indicatorMatches;

        if (canPatchInPlace) {
            existingTabs.forEach(tab => {
                const catName = tab.dataset.shopCategory;
                const isActive = catName === current;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });

            topLevel.forEach(parentEntry => {
                const pid = String(parentEntry.id || parentEntry.name);
                const children = childrenMap.get(pid) || [];
                if (!children.length) {
                    const tab = existingTabs.find(t => t.dataset.shopCategory === parentEntry.name);
                    const countEl = tab?.querySelector('[data-list-category-count]');
                    if (countEl) countEl.textContent = String(countProductsInCategory(parentEntry.name));
                    return;
                }

                if (children.some(c => c.name === current) || (parentEntry.name === current && !shopCategoryUserToggledState.has(pid))) {
                    shopCategoryExpandedState.add(pid);
                }

                const isExpanded = shopCategoryExpandedState.has(pid);
                const directCount = countProductsInCategory(parentEntry.name);
                const totalCount = directCount + children.reduce((sum, c) => sum + countProductsInCategory(c.name), 0);
                const displayCount = isExpanded ? directCount : totalCount;

                const group = Array.from(container.querySelectorAll('.category-item-group'))
                    .find(g => g.dataset.parentCategory === parentEntry.name);
                if (group) {
                    const parentCountEl = group.querySelector('.category-item-row .filter-tab [data-list-category-count]');
                    if (parentCountEl) parentCountEl.textContent = String(displayCount);

                    const chevron = group.querySelector('[data-shop-toggle-subtabs]');
                    if (chevron) {
                        chevron.classList.toggle('expanded', isExpanded);
                        chevron.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
                    }

                    const wrapper = group.querySelector('.category-sub-tabs-wrapper');
                    if (wrapper) {
                        wrapper.classList.toggle('is-expanded', isExpanded);
                    }

                    children.forEach(child => {
                        const childTab = Array.from(group.querySelectorAll('.filter-tab--child'))
                            .find(t => t.dataset.shopCategory === child.name);
                        const childCountEl = childTab?.querySelector('[data-list-category-count]');
                        if (childCountEl) childCountEl.textContent = String(countProductsInCategory(child.name));
                    });
                }
            });
            return;
        }

        const html = [withIndicator ? '<span class="list-aside__indicator" aria-hidden="true"></span>' : ''];

        topLevel.forEach(parentEntry => {
            const pid = String(parentEntry.id || parentEntry.name);
            const children = childrenMap.get(pid) || [];
            const hasChildren = children.length > 0;
            const isChildActive = children.some(c => c.name === current);
            const isParentActive = parentEntry.name === current;

            const directCount = countProductsInCategory(parentEntry.name);
            const totalCount = directCount + children.reduce((sum, c) => sum + countProductsInCategory(c.name), 0);

            if (isChildActive || (isParentActive && !shopCategoryUserToggledState.has(pid))) {
                shopCategoryExpandedState.add(pid);
            }

            const isExpanded = shopCategoryExpandedState.has(pid);
            const displayCount = isExpanded ? directCount : totalCount;

            if (!hasChildren) {
                html.push(`
                    <button class="filter-tab${isParentActive ? ' active' : ''}" type="button" data-shop-category="${escapeAttribute(parentEntry.name)}" aria-pressed="${isParentActive ? 'true' : 'false'}">
                        <span class="category-tab-main">
                            ${createCategoryIconHtml(parentEntry)}
                            <span data-list-category-label class="category-name">${escapeHtml(parentEntry.label)}</span>
                        </span>
                        <span class="count" data-list-category-count>${directCount}</span>
                    </button>
                `);
            } else {
                html.push(`
                    <div class="category-item-group" data-parent-category="${escapeAttribute(parentEntry.name)}">
                        <div class="category-item-row">
                            <button class="filter-tab${isParentActive ? ' active' : ''}" type="button" data-shop-category="${escapeAttribute(parentEntry.name)}" aria-pressed="${isParentActive ? 'true' : 'false'}">
                                <span class="category-tab-main">
                                    <span class="category-tree-chevron${isExpanded ? ' expanded' : ''}" data-shop-toggle-subtabs="${escapeAttribute(pid)}" role="button" aria-label="展开或折叠子分类" aria-expanded="${isExpanded ? 'true' : 'false'}"><i class="fas fa-chevron-right"></i></span>
                                    ${createCategoryIconHtml(parentEntry)}
                                    <span data-list-category-label class="category-name">${escapeHtml(parentEntry.label)}</span>
                                </span>
                                <span class="count" data-list-category-count>${displayCount}</span>
                            </button>
                        </div>
                        <div class="category-sub-tabs-wrapper${isExpanded ? ' is-expanded' : ''}" data-parent-pid="${escapeAttribute(pid)}">
                            <div class="category-sub-tabs" data-parent-pid="${escapeAttribute(pid)}">
                                ${children.map(child => {
                                    const isCActive = child.name === current;
                                    return `
                                        <button class="filter-tab filter-tab--child${isCActive ? ' active' : ''}" type="button" data-shop-category="${escapeAttribute(child.name)}" aria-pressed="${isCActive ? 'true' : 'false'}">
                                            <span class="category-tab-main">
                                                ${createCategoryIconHtml(child)}
                                                <span data-list-category-label class="category-name">${escapeHtml(child.label)}</span>
                                            </span>
                                            <span class="count" data-list-category-count>${countProductsInCategory(child.name)}</span>
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                `);
            }
        });

        container.innerHTML = html.join('');

        container.querySelectorAll('[data-shop-toggle-subtabs]').forEach(ch => {
            ch.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const pid = ch.getAttribute('data-shop-toggle-subtabs');
                toggleCategorySubtabs(pid);
            });
        });
    }

    function renderFilters({ animateListIndicator = false } = {}) {
        const listFilters = $('#listCategoryFilters');
        const gridFilters = $('#shopCategoryFilters');
        const shop = shopClient();
        if ((!listFilters && !gridFilters) || !shop) return;
        const entries = getCategoryEntries();
        if (!entries.length) {
            const terminalState = $('#userShopGrid .shop-empty-state, #userShopGrid .shop-status-message--error');
            const loading = !terminalState && isCatalogLoading();
            [listFilters, gridFilters].forEach((container) => {
                if (!container) return;
                container.setAttribute('aria-busy', loading ? 'true' : 'false');
                // Keep the initial rows until categories resolve; an unplaced
                // selection indicator otherwise collapses into a stray line.
                if (!loading) container.replaceChildren();
            });
            return;
        }
        const current = typeof shop.normalizeCurrentShopCategoryFromEntries === 'function'
            ? shop.normalizeCurrentShopCategoryFromEntries(entries)
            : String(shop.currentCategory || '');

        renderCategoryContainer(listFilters, entries, current, { withIndicator: true });
        renderCategoryContainer(gridFilters, entries, current, { withIndicator: true });
        ensureListIndicatorObserver();
        // Position new indicators in this render, before the browser paints.
        // Keep the next-frame sync for expanded groups and layout changes.
        [listFilters, gridFilters].forEach((container) => {
            const indicator = container?.querySelector('.list-aside__indicator');
            if (indicator && indicator.dataset.placed !== '1') {
                syncCategoryIndicator(container);
            }
        });
        requestAnimationFrame(() => {
            syncListIndicator({ animate: animateListIndicator });
            syncGridIndicator({ animate: animateListIndicator });
        });
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
        const nextMarkup = listRowsMarkup();
        const hasExistingRows = !!rows.querySelector('.list-row[data-product-id]');
        if (hasExistingRows && rows.dataset.renderedSignature === nextMarkup) {
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
            updateCategoryTitles();
            shopClient()?.startFlashSaleTimer?.();
            return;
        }
        rows.dataset.renderedSignature = nextMarkup;
        rows.innerHTML = nextMarkup;
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
        shopClient()?.startFlashSaleTimer?.();
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
        const shouldOpen = Boolean(open);
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
        } else {
            renderFilters({ animateListIndicator: false });
            refreshGridSearch();
            requestAnimationFrame(() => syncListIndicator({ animate: false }));
        }
    }

    function syncFromShop({ animate = false } = {}) {
        if (!state.ready) return;
        state.syncing = true;
        try {
            applyLayoutClasses();
            renderFilters({ animateListIndicator: animate });
            if (effectiveView() === 'list') {
                renderList({
                    animate: animate && !state.query.trim()
                });
            }
        } finally {
            state.syncing = false;
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

        const entries = typeof getCategoryEntries === 'function' ? getCategoryEntries() : [];
        const entryMap = new Map();
        entries.forEach(e => {
            if (e.id) entryMap.set(String(e.id), e);
            if (e.name) entryMap.set(String(e.name).toLowerCase(), e);
        });

        const matched = entries.find((e) => e.name === name);
        const pid = matched ? String(matched.id || matched.name) : '';
        const children = pid ? entries.filter((e) => {
            const pKey = e.parentId || e.parentName;
            const parent = pKey ? (entryMap.get(String(pKey)) || entryMap.get(String(pKey).toLowerCase())) : null;
            return parent && String(parent.id || parent.name) === pid;
        }) : [];
        const isParentWithChildren = children.length > 0;

        const currentName = String(shop.currentCategory || '');
        const changed = name !== currentName;

        // If category is a parent with children, toggle its expand/collapse state when clicking active parent
        if (!changed && isParentWithChildren) {
            if (shopCategoryExpandedState.has(pid)) {
                shopCategoryExpandedState.delete(pid);
            } else {
                shopCategoryExpandedState.add(pid);
            }
            toggleCategorySubtabs(pid, shopCategoryExpandedState.has(pid));
            return;
        }

        // If switching to a parent category that is collapsed, automatically expand it smoothly
        if (changed && isParentWithChildren && !shopCategoryExpandedState.has(pid)) {
            shopCategoryExpandedState.add(pid);
            toggleCategorySubtabs(pid, true);
        }

        // If switching to a child category, ensure its parent is expanded
        if (matched && (matched.parentId || matched.parentName)) {
            const pKey = matched.parentId || matched.parentName;
            const parent = pKey ? (entryMap.get(String(pKey)) || entryMap.get(String(pKey).toLowerCase())) : null;
            if (parent) {
                const parentPid = String(parent.id || parent.name);
                if (!shopCategoryExpandedState.has(parentPid)) {
                    shopCategoryExpandedState.add(parentPid);
                    toggleCategorySubtabs(parentPid, true);
                }
            }
        }

        // Optimistically update active tab UI for instant 0ms feedback
        if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
            document.querySelectorAll('#listCategoryFilters .filter-tab, #shopCategoryFilters .filter-tab').forEach((tab) => {
                const isTabActive = tab.dataset.shopCategory === name;
                tab.classList.toggle('active', isTabActive);
                tab.setAttribute('aria-pressed', isTabActive ? 'true' : 'false');
            });
        }
        if (typeof syncListIndicator === 'function') syncListIndicator({ animate: true });
        if (typeof syncGridIndicator === 'function') syncGridIndicator({ animate: true });

        state.query = '';
        const input = $('#listSearchInput');
        if (input) input.value = '';
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('shop-search-change', { detail: { active: false, query: '' } }));
        }
        if (!changed) {
            if (typeof renderFilters === 'function') renderFilters({ animateListIndicator: true });
            renderList({ animate: effectiveView() === 'list' });
            updateCategoryTitles();
            refreshGridSearch();
            return;
        }
        state.gridQuery = '';
        state.pendingAnimate = !prefersReducedMotion();
        // A short category (for example GPT) can make the sticky containing
        // block shorter than the previous category. Start the new category at
        // the document top on desktop so the sidebar is never constrained by
        // the old long-list scroll position. Mobile keeps its existing drawer
        // flow and must not be repositioned here.
        if (!isMobileLayout() && typeof window.scrollTo === 'function') {
            window.scrollTo(0, 0);
        }
        const gridBtn = $all('#shopCategoryFilters .filter-tab[data-shop-category]')
            .find((button) => button.dataset.shopCategory === name);
        shop.filterCategory(name, gridBtn || undefined);
        updateCategoryTitles();
        if (effectiveView() === 'list') {
            renderList({ animate: true });
        }
        if (typeof renderFilters === 'function') {
            renderFilters({ animateListIndicator: true });
        }
        if (typeof document !== 'undefined') {
            const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                ? CSS.escape(name)
                : String(name).replace(/["\\]/g, '\\$&');
            const activeTab = $(`#listCategoryFilters .filter-tab[data-shop-category="${escaped}"]`);
            const tabsContainer = $('#listCategoryFilters');
            if (activeTab && tabsContainer && tabsContainer.scrollHeight > tabsContainer.clientHeight) {
                const aRect = activeTab.getBoundingClientRect();
                const cRect = tabsContainer.getBoundingClientRect();
                if (aRect.top < cRect.top || aRect.bottom > cRect.bottom) {
                    activeTab.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        }
    }

    function refreshGridSearch() {
        if (effectiveView() !== 'grid') return;
        const query = state.query.trim();
        if (!query && !state.gridQuery) return;
        state.gridQuery = query;
        // Keep card construction, pricing, purchases and transitions in ShopClient.
        void shopClient()?.loadProducts?.();
    }

    function applyListSearch() {
        const input = $('#listSearchInput');
        state.query = input ? String(input.value || '') : '';
        renderList({ animate: false });
        updateCategoryTitles();
        if (effectiveView() === 'grid') refreshGridSearch();
        else ensureAllProductsForSearch();
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('shop-search-change', {
                detail: { active: Boolean(state.query.trim()), query: state.query.trim() }
            }));
        }
    }

    function setSearchQuery(newQuery) {
        const input = $('#listSearchInput');
        if (input) input.value = String(newQuery || '');
        applyListSearch();
    }

    function resetSearch(options = {}) {
        const input = $('#listSearchInput');
        if (input) input.value = '';
        applyListSearch();
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
                renderFilters({ animateListIndicator: !prefersReducedMotion() });
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
        const observer = new MutationObserver((mutations) => {
            if (effectiveView() !== 'list' || state.syncing) return;
            const hasMeaningfulMutation = (mutations || []).some((m) => {
                const removedNodes = Array.from(m.removedNodes || []);
                const addedNodes = Array.from(m.addedNodes || []);
                const removedOnlyTransitionLayer = removedNodes.length > 0 && removedNodes.every(
                    (node) => node.classList?.contains('shop-grid-transition-layer')
                );
                if (addedNodes.length === 0 && removedOnlyTransitionLayer) return false;
                const touchedOurControls = addedNodes.concat(removedNodes).some(
                    (node) => node.classList?.contains('list-aside__indicator') || node.classList?.contains('category-item-group')
                );
                if (touchedOurControls) return false;
                return true;
            });
            if (hasMeaningfulMutation) {
                scheduleSyncFromShop({ animate: false });
            }
        });
        if (grid) observer.observe(grid, { childList: true, subtree: false });
        if (filters) observer.observe(filters, { childList: true, subtree: false });
    }

    function bind() {
        // Intercept wheel on the category sidebar so hovering over the sidebar
        // scrolls only the category tabs inside the card, never scrolling the webpage.
        document.addEventListener('wheel', (event) => {
            const aside = event.target.closest?.('.list-aside-stack, .list-aside, .list-aside__panel');
            if (!aside) return;
            const tabs = aside.querySelector?.('.list-aside__tabs') || $('#listCategoryFilters');
            if (tabs) {
                tabs.scrollTop += event.deltaY;
                event.preventDefault();
            }
        }, { passive: false });

        // Capture grid category clicks before ShopClient's legacy container
        // listener so both views enter the same selectCategory path.
        document.addEventListener('click', (event) => {
            const toggleChevron = event.target.closest?.('[data-shop-toggle-subtabs]');
            if (toggleChevron) {
                event.preventDefault();
                event.stopPropagation();
                const pid = toggleChevron.getAttribute('data-shop-toggle-subtabs');
                toggleCategorySubtabs(pid);
                return;
            }

            const gridCategoryBtn = event.target.closest?.('#shopCategoryFilters .filter-tab[data-shop-category]');
            if (gridCategoryBtn) {
                event.preventDefault();
                event.stopPropagation();
                selectCategory(gridCategoryBtn.dataset.shopCategory || '');
                return;
            }

            const listCategoryBtn = event.target.closest?.('#listCategoryFilters .filter-tab[data-shop-category]');
            if (listCategoryBtn) {
                event.preventDefault();
                event.stopPropagation();
                selectCategory(listCategoryBtn.dataset.shopCategory || '');
                return;
            }
        }, true);

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
                const isOpen = document.body.classList.contains('shop-list-drawer-open') || $('.shop-main')?.classList.contains('is-list-drawer-open');
                setListDrawer(!isOpen);
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

            const toggleChevron = event.target.closest?.('[data-shop-toggle-subtabs]');
            if (toggleChevron) {
                event.preventDefault();
                event.stopPropagation();
                const pid = toggleChevron.getAttribute('data-shop-toggle-subtabs');
                toggleCategorySubtabs(pid);
                return;
            }

            const categoryBtn = event.target.closest?.('#listCategoryFilters .filter-tab[data-shop-category]');
            if (categoryBtn) {
                event.preventDefault();
                selectCategory(categoryBtn.dataset.shopCategory || '');
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
            refreshGridSearch();
        });

        window.addEventListener('resize', () => {
        });

        if (window.matchMedia) {
            const media = window.matchMedia(MOBILE_MQ);
            const onChange = () => {
                applyLayoutClasses();
                if (effectiveView() === 'list') {
                    renderFilters({ animateListIndicator: false });
                    renderList({ animate: false });
                } else {
                    refreshGridSearch();
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
            setListDrawer,
            isListDrawerOpen: () => Boolean(document.body.classList.contains('shop-list-drawer-open') || $('.shop-main')?.classList.contains('is-list-drawer-open')),
            getView: () => effectiveView(),
            getSearchQuery: () => state.query.trim(),
            setSearchQuery,
            resetSearch,
            filterSearchProducts,
            listChipsMarkup
        });
        if (typeof window !== 'undefined') {
            window.isShopSearchActive = () => Boolean(state.query.trim() || document.getElementById('listSearchInput')?.value?.trim());
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());
