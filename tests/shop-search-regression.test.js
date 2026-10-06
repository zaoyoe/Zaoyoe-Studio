const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const layoutSource = fs.readFileSync(path.join(root, 'js/shop-list-layout.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'js/shop-client.js'), 'utf8');

function section(source, from, to) {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `Missing runtime section: ${from}`);
    return source.slice(start, end);
}

function harness({ query = '', view = 'grid', preserveEmpty = false } = {}) {
    const products = [
        { id: 'gemini', name: 'Gemini Pro', description: '季度服务', category: 'Gemini' },
        { id: 'claude', name: 'Claude Pro', description: '专业账号', category: 'Claude' },
        { id: 'mail', name: '邮箱', description: '含 Claude 验证说明', category: '邮箱' }
    ];
    const state = { query, gridQuery: query };
    const input = { value: query };
    const calls = { requests: [], renders: [], list: 0, hydration: 0 };
    const grid = { querySelectorAll: () => [{}], classList: { remove() {} } };
    const shop = {
        currentCategory: 'Gemini',
        allProductsCache: products,
        productsRequestToken: 0,
        agentPricesCache: {},
        getLocalizedProductName: product => product.name,
        getLocalizedProductDescription: product => product.description,
        hasCategoryProductsCache: () => true,
        getProductsForCategory: async category => {
            calls.requests.push(category);
            return category === 'all' ? products : products.filter(product => product.category === category);
        },
        shouldPreserveVisibleShopCatalogOnEmptyRefresh: () => preserveEmpty,
        transitionProductGrid: (_grid, cards, options = {}) => calls.renders.push({ ids: Array.from(cards, card => card.id), ...options }),
        buildProductCardElements: data => data,
        markShopCatalogRefreshNonEmpty() {},
        warmShopCardLeadImages() {},
        scheduleVisibleDiscountAssetsPrefetch() {},
        renderCart() {},
        scheduleBackgroundProductPrefetch() {},
        fulfillPendingProductSpotlight() {},
        startFlashSaleTimer() {},
        clearProductGridTransitionArtifacts() {},
        buildShopStatusMessage: message => message,
        getShopCatalogUnavailableMessage: () => 'unavailable',
        clearMobileProductFocus() {}
    };
    const context = {
        state,
        shopClient: () => shop,
        getCategoryLabel: category => category,
        effectiveView: () => view,
        isMobileLayout: () => false,
        $: selector => selector === '#listSearchInput' ? input : null,
        $all: () => [],
        renderList: () => { calls.list += 1; },
        updateCategoryTitles() {},
        ensureAllProductsForSearch: () => { calls.hydration += 1; },
        setListDrawer() {},
        prefersReducedMotion: () => true,
        document: { getElementById: () => grid, createElement: () => ({}) },
        window: {},
        console,
        clearInterval() {}
    };
    const search = vm.runInNewContext([
        section(layoutSource, '    function filterSearchProducts(', '    function getVisibleProducts()'),
        section(layoutSource, '    function selectCategory(', '    function hookShopClient()'),
        '({ filterSearchProducts, applyListSearch, refreshGridSearch, selectCategory })'
    ].join('\n'), context);
    context.window.ShopListLayout = {
        getSearchQuery: () => state.query.trim(),
        filterSearchProducts: search.filterSearchProducts
    };
    Object.assign(shop, vm.runInNewContext(`({${section(clientSource, '    loadProducts: async function (', '    flashSaleInterval: null,')}})`, context));
    const loadProducts = shop.loadProducts;
    shop.loadProducts = function () {
        calls.pending = loadProducts.apply(this, arguments);
        return calls.pending;
    };
    shop.filterCategory = category => {
        shop.currentCategory = category;
        return shop.loadProducts();
    };
    return { products, state, input, calls, shop, search, grid, context, setView: next => { view = next; } };
}

test('grid input and submit use the existing global matcher and preserve the catalog cache', async () => {
    const h = harness();
    const originalCache = h.shop.allProductsCache;
    h.input.value = '  cLaUdE  ';
    h.search.applyListSearch();
    await h.calls.pending;
    assert.deepEqual(h.calls.requests, ['all']);
    assert.deepEqual(h.calls.renders.at(-1).ids, ['claude', 'mail']);
    assert.equal(h.shop.currentCategory, 'Gemini');
    assert.equal(h.shop.allProductsCache, originalCache);
    assert.equal(h.shop.allProductsCache.length, 3);
    assert.match(layoutSource, /addEventListener\('input', applyListSearch\)/);
    assert.match(layoutSource, /listSearchForm'[\s\S]*addEventListener\('submit'[\s\S]*event\.preventDefault\(\);\s*applyListSearch\(\)/);
});

test('no-match searches replace old grid cards even when catalog refresh preserves empty responses', async () => {
    const h = harness({ query: 'does-not-exist', preserveEmpty: true });
    await h.shop.loadProducts();
    assert.deepEqual(h.calls.renders, [{ ids: [], empty: true, searchQuery: 'does-not-exist' }]);
});

test('search filtering preserves the existing protection against an empty catalog refresh', async () => {
    const h = harness({ query: 'Claude', preserveEmpty: true });
    h.shop.getProductsForCategory = async () => [];
    const previousConsole = h.context.console;
    h.context.console = { ...console, warn() {} };
    await h.shop.loadProducts();
    h.context.console = previousConsole;
    assert.equal(h.calls.renders.length, 0);
    assert.equal(h.shop.allProductsCache.length, 3);
});

test('clearing search or reselecting the current category restores its original grid', async () => {
    for (const clear of [h => { h.input.value = ''; h.search.applyListSearch(); }, h => h.search.selectCategory('Gemini')]) {
        const h = harness({ query: 'Claude' });
        await h.shop.loadProducts();
        clear(h);
        await h.calls.pending;
        assert.equal(h.state.query, '');
        assert.equal(h.input.value, '');
        assert.equal(h.calls.requests.at(-1), 'Gemini');
        assert.deepEqual(h.calls.renders.at(-1).ids, ['gemini']);
    }
});

test('search survives view switches and changing category clears both views search state', async () => {
    const h = harness({ view: 'list' });
    h.input.value = 'Claude';
    h.search.applyListSearch();
    assert.equal(h.calls.hydration, 1);
    assert.equal(h.calls.requests.length, 0);
    h.setView('grid');
    h.search.refreshGridSearch();
    await h.calls.pending;
    assert.deepEqual(h.calls.renders.at(-1).ids, ['claude', 'mail']);
    h.search.selectCategory('邮箱');
    await h.calls.pending;
    assert.equal(h.state.query, '');
    assert.equal(h.state.gridQuery, '');
    assert.equal(h.input.value, '');
    assert.deepEqual(h.calls.renders.at(-1).ids, ['mail']);
    assert.match(section(layoutSource, '    function setView(', '    function syncFromShop('), /refreshGridSearch\(\)/);
});

test('older search requests cannot overwrite a newer result or a restored category', async () => {
    for (const failOld of [false, true]) {
        const h = harness({ query: 'Claude' });
        let finishOld;
        h.shop.getProductsForCategory = () => new Promise((resolve, reject) => {
            finishOld = () => failOld ? reject(new Error('late failure')) : resolve(h.products);
        });
        const oldRequest = h.shop.loadProducts();
        h.shop.getProductsForCategory = async () => h.products.filter(product => product.category === 'Gemini');
        h.input.value = '';
        h.search.applyListSearch();
        await h.calls.pending;
        finishOld();
        await oldRequest;
        assert.deepEqual(h.calls.renders, [{ ids: ['gemini'] }]);
        assert.equal(h.grid.innerHTML, undefined);
    }
});

test('grid no-match message uses the active locale and retains the normal empty catalog message', () => {
    const h = harness();
    const emptyBuilder = vm.runInNewContext(`({${section(clientSource, '    buildEmptyStateElement: function (', '    getShopProductCardChipCopy: function (')}})`, h.context);
    h.shop.isEnglishShopLocale = () => false;
    assert.match(emptyBuilder.buildEmptyStateElement.call(h.shop, { searchQuery: 'missing' }).innerHTML, /没有找到匹配商品。/);
    h.shop.isEnglishShopLocale = () => true;
    assert.match(emptyBuilder.buildEmptyStateElement.call(h.shop, { searchQuery: 'missing' }).innerHTML, /No matching products\./);
    assert.match(emptyBuilder.buildEmptyStateElement.call(h.shop).innerHTML, /data-i18n="shop.noProducts"/);
});
