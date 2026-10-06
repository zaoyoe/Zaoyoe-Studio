const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('admin shop products view enforces unified table layout and strictly list view mode', () => {
    const adminHtml = readFile('admin-studio.html');
    const shopJs = readFile('js/admin-shop.js');
    const stylesCss = readFile('css/admin-studio-page.css');

    // 1. HTML DOM Structure
    assert.match(
        adminHtml,
        /<link[^>]+href="css\/shop-list-layout\.css(?:\?v=[^"]+)?"/,
        'admin-studio.html should link to css/shop-list-layout.css for 1:1 shop visual parity'
    );
    assert.match(
        adminHtml,
        /<body[^>]+class="[^"]*shop-page[^"]*"/,
        'admin-studio.html body should have shop-page class to inherit shop styling'
    );
    assert.match(
        adminHtml,
        /<div class="shop-admin-products-layout list-layout"/,
        'admin-studio.html should wrap products in split layout container'
    );
    assert.match(
        adminHtml,
        /<aside class="list-aside shop-admin-category-aside" id="adminProductCategoryAside"/,
        'admin-studio.html should contain category aside sidebar'
    );
    assert.match(
        adminHtml,
        /id="productCategorySidebarList"/,
        'admin-studio.html should have productCategorySidebarList container'
    );
    assert.match(
        adminHtml,
        /id="productCatalogCategoryTitle"/,
        'admin-studio.html should display catalog category title'
    );
    assert.match(
        adminHtml,
        /<button class="list-aside__close"[^>]*data-shop-action="product-close-category-drawer"/,
        'admin-studio.html aside heading should contain drawer close button'
    );
    assert.match(
        adminHtml,
        /<div class="list-mobile-filter">[\s\S]*id="adminProductMobileCategoryTitle"[\s\S]*<button class="list-mobile-filter__trigger"[^>]*data-shop-action="product-open-category-drawer"/,
        'admin-studio.html catalog should contain mobile category filter trigger matching shop.html'
    );
    assert.match(
        adminHtml,
        /<button class="list-drawer-overlay"[^>]*data-shop-action="product-close-category-drawer"/,
        'admin-studio.html should contain mobile drawer backdrop overlay'
    );

    // View toggle capsule removed per user request (strictly list mode)
    assert.equal(
        adminHtml.includes('shop-admin-view-toggle'),
        false,
        'admin-studio.html should not contain shop-admin-view-toggle capsule'
    );

    assert.match(
        adminHtml,
        /id="productsListView"/,
        'admin-studio.html should have productsListView container'
    );
    assert.match(
        adminHtml,
        /id="productsListRows"/,
        'admin-studio.html should have productsListRows container'
    );
    assert.match(
        adminHtml,
        /id="productsGrid"[^>]*hidden/,
        'admin-studio.html must retain hidden productsGrid container for compatibility'
    );
    assert.match(
        adminHtml,
        /id="productCategoryFilters"/,
        'admin-studio.html must retain productCategoryFilters container for backward compatibility'
    );

    assert.match(
        adminHtml,
        /<div class="list-table-head">[\s\S]*<span>商品<\/span>[\s\S]*<span>价格<\/span>[\s\S]*<span>库存<\/span>[\s\S]*<span>状态<\/span>[\s\S]*<span>操作<\/span>/,
        'admin-studio.html list-table-head should align columns with product, price, stock, status, and actions'
    );
    assert.equal(
        /<div class="list-table-head">[\s\S]*id="adminProductTableHeadSelectAll"/.test(adminHtml),
        false,
        'admin-studio.html list-table-head should not have select all checkbox preceding 商品'
    );
    assert.match(
        adminHtml,
        /<div[^>]+id="productCategorySidebarList"[^>]*>[\s\S]*<div class="filter-tab is-skeleton active"/,
        'admin-studio.html category sidebar should activate first skeleton tab with indicator to avoid jump'
    );

    // 2. JavaScript logic
    assert.match(
        shopJs,
        /productViewMode:\s*'list'/,
        'admin-shop.js should lock productViewMode to list'
    );
    assert.match(
        shopJs,
        /setProductViewMode:\s*function\s*\(view\)/,
        'admin-shop.js should implement setProductViewMode'
    );
    assert.match(
        shopJs,
        /renderProductListRows:\s*function\s*\(products\)/,
        'admin-shop.js should implement renderProductListRows'
    );
    assert.match(
        shopJs,
        /categories\.forEach\(cat => \{[\s\S]*sidebarContainer\.appendChild\(btn\)/,
        'renderProductCategoryFilters should populate sidebar with business category badges without all-tab'
    );
    assert.match(
        shopJs,
        /setProductCategoryDrawer:\s*function\s*\(open\)/,
        'admin-shop.js should implement setProductCategoryDrawer'
    );
    assert.match(
        shopJs,
        /syncProductCategoryFilterButtons:\s*function[\s\S]*productCatalogCategoryTitle[\s\S]*adminProductMobileCategoryTitle/,
        'syncProductCategoryFilterButtons should synchronize desktop and mobile category titles'
    );
    assert.match(
        shopJs,
        /filterCategory:\s*function[\s\S]*this\.setProductCategoryDrawer\(false\)/,
        'filterCategory should automatically close mobile category drawer upon selection'
    );
    assert.match(
        shopJs,
        /'product-open-category-drawer':\s*this\.setProductCategoryDrawer\(true\)/,
        'admin-shop.js should route product-open-category-drawer action'
    );
    assert.match(
        shopJs,
        /'product-close-category-drawer':\s*this\.setProductCategoryDrawer\(false\)/,
        'admin-shop.js should route product-close-category-drawer action'
    );
    assert.match(
        shopJs,
        /updateProductSelectionCount:\s*function[\s\S]*adminProductTableHeadSelectAll/,
        'updateProductSelectionCount should synchronize head select all state and deduplicate selected product IDs'
    );
    assert.match(
        shopJs,
        /renderProductListSkeleton:\s*function\s*\(container,\s*\{ count = 5 \} = \{\}\)/,
        'admin-shop.js should implement renderProductListSkeleton'
    );
    assert.match(
        shopJs,
        /renderCategorySidebarSkeleton:\s*function\s*\(container\)/,
        'admin-shop.js should implement renderCategorySidebarSkeleton'
    );
    assert.match(
        shopJs,
        /renderProductCategoryFilters:\s*async\s*function[\s\S]*this\.renderCategorySidebarSkeleton\(sidebarContainer\)/,
        'admin-shop.js should display skeleton in category sidebar when loading categories'
    );
    assert.match(
        shopJs,
        /renderProductListRows:\s*function[\s\S]*listRowsContainer\.classList\.add\('is-enter'\)/,
        'renderProductListRows should trigger staggered entrance animation via is-enter'
    );
    assert.match(
        shopJs,
        /filterCategory:\s*function[\s\S]*shopProductCategoryCache[\s\S]*renderProductListSkeleton/,
        'filterCategory should leverage in-memory cache for instant switch and render skeleton on cache miss'
    );
    assert.match(
        shopJs,
        /selectAllProducts:\s*function[\s\S]*this\.isProductSelectionMode = shouldCheck;[\s\S]*this\.syncProductSelectionModeUi\(\)/,
        'selectAllProducts should synchronize isProductSelectionMode when head checkbox is toggled'
    );

    // 3. CSS Styling: Unified Table Layout (1:1 with shop.html) and List-Only mode
    assert.match(
        stylesCss,
        /#shop-view-products \.shop-admin-catalog-section\.list-catalog\s*\{[\s\S]*border-radius:\s*20px !important;[\s\S]*background:\s*var\(--card-bg,\s*#ffffff\) !important;/,
        'admin css should style outer catalog as single unified card'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-mobile-filter,\s*#shop-view-products \.list-drawer-overlay,\s*#shop-view-products \.list-aside__close\s*\{[\s\S]*display:\s*none !important;/,
        'admin css should hide mobile filter trigger, drawer overlay, and close button on desktop'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-table-head\s*\{[\s\S]*border:\s*0 !important;[\s\S]*border-bottom:\s*1px solid var\(--card-border,\s*#e0e1e6\) !important;[\s\S]*border-radius:\s*0 !important;[\s\S]*background:\s*transparent !important;/,
        'admin css should style list-table-head seamlessly without separate box/radius/background'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-row\s*\{[\s\S]*border:\s*0 !important;[\s\S]*border-bottom:\s*1px solid var\(--card-border,\s*#e0e1e6\) !important;[\s\S]*border-radius:\s*0 !important;[\s\S]*background:\s*transparent !important;/,
        'admin css should style list-row seamlessly with clean divider lines'
    );
    assert.match(
        stylesCss,
        /#shop-view-products #productsListView,\s*\.shop-admin-products-layout #productsListView\s*\{[\s\S]*display:\s*block !important;/,
        'admin css should always display productsListView in list mode'
    );
    assert.match(
        stylesCss,
        /#shop-view-products #productsGrid,\s*\.shop-admin-products-layout #productsGrid\s*\{[\s\S]*display:\s*none !important;/,
        'admin css should always hide productsGrid'
    );
    assert.match(
        stylesCss,
        /\.shop-product-toolbar-row #productSelectControls[\s\S]*margin-left:\s*auto !important;/,
        'admin css should right-align toolbar selection controls'
    );
    assert.match(
        stylesCss,
        /:is\(.*#shop-view-products.*\) \.list-aside \.filter-tab:hover:not\(\.active\)[\s\S]*background:\s*#f5f6f8 !important;/,
        'admin css should apply light theme hover effect matching shop page'
    );
    assert.match(
        stylesCss,
        /:is\(.*#shop-view-products.*\) \.list-aside \.filter-tab:hover:not\(\.active\)[\s\S]*background:\s*#202836 !important;/,
        'admin css should apply dark theme hover effect matching shop page'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-row \.product-card-checkbox-label\s*\{\s*display:\s*none !important;\s*\}/,
        'admin css should hide list row checkboxes by default'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.shop-admin-products-list--selection-mode \.list-row \.product-card-checkbox-label[\s\S]*display:\s*inline-flex !important;/,
        'admin css should show list row checkboxes in selection mode'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-row\.is-skeleton \.list-skel::after[\s\S]*animation:\s*shop-admin-skeleton-shimmer/,
        'admin css should animate skeleton list rows with shimmer effect'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-aside \.filter-tab\.is-skeleton[\s\S]*animation:\s*shop-admin-skeleton-shimmer/,
        'admin css should animate category sidebar skeleton tabs with shimmer'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-aside \.filter-tab\.is-skeleton\s*\{[\s\S]*min-height:\s*42px !important;[\s\S]*border-radius:\s*999px !important;/,
        'admin css should match category skeleton tab height and border radius to loaded tabs'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-aside \.filter-tab\.is-skeleton \.list-aside-skel-count\s*\{[\s\S]*width:\s*28px !important;[\s\S]*height:\s*22px !important;/,
        'admin css should match category skeleton count badge dimensions to loaded badge'
    );
    assert.match(
        stylesCss,
        /\.list-aside-skel-name--w1\s*\{\s*width:\s*54px !important;\s*\}/,
        'admin css should define realistic width for category skeleton name w1'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-row\.is-skeleton \.list-price[\s\S]*background:\s*transparent !important;/,
        'admin css should ensure skeleton list-price container has transparent background to avoid double-box overlap'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-row\.is-skeleton \.shop-admin-skeleton--price\s*\{[\s\S]*width:\s*56px !important;[\s\S]*height:\s*16px !important;[\s\S]*border-radius:\s*999px !important;/,
        'admin css should size price skeleton pill to 56x16px centered capsule'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-aside \.list-panel-kicker\s*\{[\s\S]*font-size:\s*12px !important;/,
        'admin css should enlarge desktop category aside kicker font size to 12px'
    );
    assert.match(
        stylesCss,
        /#shop-view-products \.list-aside__title\s*\{[\s\S]*font-size:\s*17px !important;/,
        'admin css should enlarge desktop category aside title font size to 17px'
    );

    // 4. Mobile Responsiveness (1:1 with shop.html drawer pattern @media max-width: 820px)
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-aside-stack\s*\{[\s\S]*display:\s*contents !important;/,
        'admin css should set list-aside-stack to display: contents on mobile to eliminate vertical space'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-aside\s*\{[\s\S]*position:\s*fixed !important;[\s\S]*transform:\s*translateX\(-110%\) !important;/,
        'admin css should configure list-aside as offscreen slide-out drawer on mobile'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products\.is-list-drawer-open \.list-aside\s*\{[\s\S]*transform:\s*none !important;[\s\S]*pointer-events:\s*auto !important;/,
        'admin css should slide drawer in when is-list-drawer-open'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-drawer-overlay\s*\{[\s\S]*position:\s*fixed !important;[\s\S]*z-index:\s*10030 !important;/,
        'admin css should position drawer backdrop overlay with high z-index on mobile'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products\.is-list-drawer-open \.list-drawer-overlay\s*\{[\s\S]*display:\s*block !important;/,
        'admin css should display backdrop overlay when drawer is open'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-mobile-filter\s*\{[\s\S]*display:\s*flex !important;[\s\S]*flex-direction:\s*column !important;/,
        'admin css should display list-mobile-filter with vertical column flow on mobile'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-mobile-filter__trigger\s*\{[\s\S]*width:\s*100% !important;[\s\S]*border-radius:\s*999px !important;/,
        'admin css should style filter trigger as full-width capsule button spanning the list'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-catalog__head\.shop-admin-catalog-head\s*\{[\s\S]*display:\s*none !important;/,
        'admin css should hide desktop catalog head on mobile screens <= 820px'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-table-head\s*\{[\s\S]*display:\s*none !important;/,
        'admin css should hide table head on mobile screens <= 820px'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-row\s*\{[\s\S]*display:\s*flex !important;[\s\S]*flex-direction:\s*column !important;/,
        'admin css should stack list row elements vertically on mobile'
    );
    assert.match(
        stylesCss,
        /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*#shop-view-products \.list-metrics\s*\{[\s\S]*display:\s*flex !important;[\s\S]*justify-content:\s*space-between !important;/,
        'admin css should display metrics sub-bar with space-between on mobile'
    );
    assert.match(
        stylesCss,
        /#module-shop #shop-view-products #productSelectControls[\s\S]*grid-column:\s*2\s*\/\s*3 !important;/,
        'admin css should place toolbar selection controls on row 2 right-aligned next to search actions'
    );
    assert.match(
        stylesCss,
        /#module-shop #shop-view-products \.shop-product-delivery-filter-slot--toolbar[\s\S]*order:\s*3 !important;/,
        'admin css should place delivery filter dropdown on row 3 below actions and selection controls'
    );
    assert.match(
        stylesCss,
        /#module-shop \.shop-tab[\s\S]*border-bottom:\s*none !important;/,
        'admin css should eliminate static border-bottom on shop-tab so only sliding indicator displays'
    );
    assert.match(
        shopJs,
        /window\.innerWidth\s*<=\s*820/,
        'admin-shop.js should guard indicator position calculation on mobile screens'
    );
    assert.match(
        shopJs,
        /activeSidebarTab\.scrollIntoView/,
        'admin-shop.js should scroll active category tab smoothly into view'
    );
    assert.match(
        stylesCss,
        /body\.shop-list-drawer-open #module-shop \.shop-tabs::after[\s\S]*opacity:\s*0 !important;[\s\S]*visibility:\s*hidden !important;/,
        'admin css should hide shop-tabs indicator when category drawer is open to prevent bleeding through'
    );
    assert.match(
        stylesCss,
        /#shop-view-products\.is-list-drawer-open\s*\{[\s\S]*position:\s*relative !important;[\s\S]*z-index:\s*10030 !important;/,
        'admin css should elevate shop-view-products above navbar when category drawer is open'
    );
    assert.match(
        shopJs,
        /moduleShop\?\.classList\.toggle\('shop-list-drawer-open', shouldOpen\)/,
        'admin-shop.js should toggle shop-list-drawer-open class on module-shop container'
    );
});


