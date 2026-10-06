const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');

test('shop list integration keeps the preview price symbol and list metadata hooks', () => {
    const source = fs.readFileSync(path.join(workspaceRoot, 'js/shop-list-layout.js'), 'utf8');
    const clientSource = fs.readFileSync(path.join(workspaceRoot, 'js/shop-client.js'), 'utf8');
    const markup = fs.readFileSync(path.join(workspaceRoot, 'shop.html'), 'utf8');
    const styles = fs.readFileSync(path.join(workspaceRoot, 'css/shop-list-layout.css'), 'utf8');

    assert.match(
        styles,
        /@media \(min-width: 821px\)[\s\S]*html body\.shop-page \{\s*overflow-x: clip !important;\s*overflow-y: visible !important;/,
        'desktop shop pages must keep horizontal clipping without creating a body scroll container so the sidebar sticky can follow document scrolling'
    );
    assert.match(
        styles,
        /html body\.shop-page \.list-aside-stack \{\s*top: calc\(var\(--nav-height, 61px\) \+ 58px\);/,
        'desktop sidebar sticky positioning must preserve its initial position below the fixed navigation while scrolling'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-layout \{\s*min-height: calc\(100vh - var\(--nav-height, 61px\) - 58px\);/,
        'short list categories must keep a viewport-sized sticky containing block'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--grid \{\s*min-height: calc\(100vh - var\(--nav-height, 61px\) - 58px\);/,
        'short grid categories must keep a viewport-sized sticky containing block'
    );
    assert.match(
        source,
        /if \(!isMobileLayout\(\) && typeof window\.scrollTo === 'function'\) \{\s*window\.scrollTo\(0, 0\);/,
        'desktop category changes must reset the old long-list scroll position'
    );
    assert.match(
        styles,
        /body\[data-layout-mode="mobile"\] \.list-aside-stack \{[\s\S]*display: contents;[\s\S]*position: static;/,
        'mobile layout must keep the category controls in the existing drawer flow'
    );

    assert.match(
        source,
        /<span class="list-price__symbol" aria-hidden="true">￥<\/span><span class="list-price__value">/,
        'the main-site list price should keep the yuan symbol from the preview'
    );
    assert.match(source, /list-chip--sales/, 'the integrated list should keep sales metadata chips');
    assert.match(source, /<strong>\$\{escapeHtml\(displayName\)\}<\/strong>\s*<p>\$\{escapeHtml\(displayDesc \|\| ''\)\}<\/p>\s*\$\{listChipsMarkup\([\s\S]*?list-price--inline/, 'mobile list pricing should follow the description as the first chip');
    assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.list-actions,[\s\S]*\.list-cart,[\s\S]*\.list-buy \{\s*display: none !important;/, 'mobile list mode should hide cart and buy controls');
    assert.match(source, /openProductPurchaseFromDataset/, 'list actions should continue using the original purchase flow');
    assert.match(source, /syncStaticCopy/, 'list chrome should follow the active shop locale');
    assert.match(source, /ensureAllProductsForSearch/, 'search should hydrate all categories before resolving results');
    assert.match(source, /canPatchInPlace/, 'category indicator should be preserved for sliding transitions');
    assert.match(source, /function renderCategoryContainer\(container, entries, current/, 'list and grid categories must share one renderer');
    assert.match(source, /renderCategoryContainer\(listFilters, entries, current, \{ withIndicator: true \}\)/, 'list categories must use the shared category renderer');
    assert.match(source, /renderCategoryContainer\(gridFilters, entries, current, \{ withIndicator: true \}\)/, 'grid categories must use the shared category renderer');
    assert.match(source, /#shopCategoryFilters \.filter-tab\[data-shop-category\]/, 'grid category clicks must enter the shared category path');
    assert.match(source, /selectCategory\(gridCategoryBtn\.dataset\.shopCategory \|\| ''\)/, 'grid category clicks must call the shared selector');
    assert.match(source, /originalHydrateProductCaches/, 'background catalog hydration should refresh the list view');
    assert.match(clientSource, /SHOP_PREFETCH_SCHEMA_VERSION = '20260927_SHOP_GUEST_PAYMENT_CHANNELS_1'/, 'catalog cache should invalidate stale pre-sales payloads');
    assert.match(markup, /class="list-search-submit"/, 'the integrated list should keep the search submit control');
    assert.match(markup, /family=Noto\+Sans\+SC:wght@400;500;600;700;800/, 'shop.html should load a CJK 800 weight so list chips can render the intended bold');
    assert.match(styles, /\.list-chip--sales/, 'the integrated list should keep the sales chip styling');
    const finalChipPalette = styles.slice(styles.lastIndexOf('/* Fresh semantic chip palette'));
    assert.match(finalChipPalette, /\.list-chip--auto \{[\s\S]*background: #eaf6ef !important;[\s\S]*color: #3f7c5a !important;/, 'instant delivery should use a softer mint chip');
    assert.match(finalChipPalette, /\.list-chip--wholesale \{[\s\S]*background: #f0edfa !important;[\s\S]*color: #6d5aa5 !important;/, 'tiered pricing should use a distinct soft lavender chip');
    assert.match(finalChipPalette, /\.list-chip--guest-purchase \{[\s\S]*background: #e9f4f6 !important;[\s\S]*color: #3f7580 !important;/, 'guest purchase should use a distinct airy aqua chip');
    assert.match(finalChipPalette, /html\[data-theme="dark"\] body\.shop-page \.list-chip--guest-purchase \{[\s\S]*background: rgba\(111, 190, 205, 0\.17\) !important;/, 'guest purchase dark theme should keep its aqua palette');
    assert.match(
        styles,
        /\.shop-main\.shop-layout--grid \.list-layout/,
        'grid mode should hide the actual list layout class rather than a stale selector'
    );
    assert.doesNotMatch(
        styles,
        /\.shop-main\.shop-layout--grid \.shop-list-layout/,
        'the stale .shop-list-layout hide selector should not remain'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-price__symbol/,
        'main-site list prices need a high-specificity lock so shop-page text-fill rules cannot hide ￥'
    );
    assert.match(
        styles,
        /-webkit-text-fill-color: #1c2024 !important;/,
        'the yuan symbol lock should force an opaque text fill against shop-page transparent fills'
    );
    assert.match(
        styles,
        /@media \(max-width: 820px\)[\s\S]*list-mobile-filter__trigger/,
        'mobile filter chrome must exist as a CSS breakpoint fallback, not only body[data-layout-mode]'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-mobile-filter__trigger \{[\s\S]*box-shadow: none;/,
        'the mobile filter capsule should sit flat with the search field instead of floating'
    );
    assert.doesNotMatch(
        styles,
        /list-mobile-filter__trigger:hover \{[\s\S]*translateY\(-1px\)/,
        'the mobile filter capsule must not lift on hover'
    );
    assert.match(
        styles,
        /\.shop-main\.shop-layout--list \.shop-header \{[\s\S]*margin-bottom: 0;/,
        'list mode should collapse the empty shop header so the catalog sits closer to the nav'
    );
    assert.match(
        styles,
        /\.shop-layout--list \.shop-toolbar \{\s*margin-bottom: 8px;/,
        'list toolbar should keep a tight gap above the catalog'
    );
    assert.match(markup, /data-list-mobile-catalog-kicker/, 'mobile list heading should keep the catalog kicker');
    assert.match(markup, /list-mobile-filter__heading-copy/, 'mobile list heading should stack catalog kicker above the category name');
    assert.match(source, /if \(mobileTitle\) mobileTitle\.textContent = title \|\| labels\.catalog;/, 'mobile list heading should show the focused category under catalog');
    assert.match(markup, /data-list-order-query/, 'shop.html should expose order-query buttons in list chrome');
    assert.match(source, /ZaoyoeWalletModalBootstrap\.open\('orders'/, 'order query should open the wallet records view');
    assert.match(source, /walletModal\.switchView\('orders'\)/, 'order query should focus the wallet records sidebar');
    assert.match(styles, /\.list-aside-stack/, 'the order-query control should sit above the category card');
    assert.match(source, /window\.ShopListLayout = Object\.assign\(window\.ShopListLayout \|\| \{\}, \{[\s\S]*listChipsMarkup/, 'list chip markup should stay exported for list rows');
    assert.match(source, /shop\.buildShopProductCardChipsMarkup/, 'list chips should reuse the shop-client first-paint markup');
    assert.match(clientSource, /buildShopProductCardChipsMarkup\(product, fulfillmentState, pricingState\)/, 'grid cards should render chips under the description');
    assert.match(clientSource, /descriptionMarkup[\s\S]*buildShopProductCardChipsMarkup[\s\S]*shop-card-footer/, 'grid chips should sit between the description and the points footer');
    assert.match(clientSource, /list-chip--wholesale/, 'grid first paint must own wholesale chip markup without waiting for ShopListLayout');
    assert.match(clientSource, /list-chip--sales/, 'grid first paint must own sales chip markup without waiting for ShopListLayout');
    assert.match(clientSource, /refreshVisibleProductCardChips/, 'list layout boot should be able to refresh any already-rendered grid chips');
    assert.doesNotMatch(clientSource, /return '<div class="list-chips"><\/div>'/, 'grid chips must not fall back to an empty host when ShopListLayout is still loading');
    assert.match(styles, /html body\.shop-page \.shop-card \.list-chip \{[\s\S]*font-weight: 800 !important/, 'the shared card chip baseline should remain available before the desktop grid override');
    const desktopGridChipCss = styles.slice(styles.lastIndexOf('/* Desktop grid card chips: keep capsule typography consistent'));
    assert.match(
        desktopGridChipCss,
        /@media \(min-width: 821px\)[\s\S]*shop-main\.shop-layout--grid \.shop-card \.list-chip \{[\s\S]*font-weight: 800 !important;/,
        'wide grid cards should use the same 800 chip weight as list mode without changing mobile chips'
    );
    assert.match(
        desktopGridChipCss,
        /shop-main\.shop-layout--grid \.shop-card \.list-chip--stock-plenty \{[\s\S]*background: #eef4fb !important;[\s\S]*color: #4b6f91 !important;/,
        'wide grid plentiful-stock chips should use a fresh mist-blue palette'
    );
    assert.match(
        desktopGridChipCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.shop-card \.list-chip--stock-plenty \{[\s\S]*background: rgba\(125, 170, 207, 0\.16\) !important;[\s\S]*color: #b6d9ee !important;/,
        'wide grid plentiful-stock chips should keep a readable mist-blue palette in dark theme'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-card \.list-chip \{[\s\S]*font-family: Inter, "Noto Sans SC"/,
        'list chips must use Noto Sans SC so CJK 800 is not silently clamped by PingFang'
    );
    assert.match(
        styles,
        /\.list-chip \{[\s\S]*font-family: Inter, "Noto Sans SC"/,
        'the base list chip stack should prefer Noto Sans SC over system CJK fonts'
    );
    assert.doesNotMatch(
        styles,
        /\.list-rows\.is-leaving/,
        'category switch must not fade the whole list, which washes icons, copy, and chips'
    );
    assert.match(
        styles,
        /@keyframes list-row-in \{[\s\S]*translateY\(10px\)/,
        'category switch should stagger rows with a float-up entrance'
    );
    assert.match(
        styles,
        /@keyframes list-row-in-sold-out \{[\s\S]*opacity: 0\.78/,
        'sold-out rows must finish the entrance at 0.78 instead of snapping after a full fade-in'
    );
    assert.doesNotMatch(
        source,
        /classList\.add\('is-leaving'\)/,
        'list rendering should swap rows without a leaving opacity phase'
    );
    assert.doesNotMatch(source, /is-list-fading/, 'category switch must not cover the list with a same-color veil');
    assert.doesNotMatch(markup, /list-rows-veil/, 'the unused fade veil should stay out of the list markup');
    assert.match(markup, /class="list-rows-host"/, 'list rows should keep their host wrapper for catalog spacing');
    assert.match(source, /classList\.add\('is-enter'\)/, 'category switch should replay the staggered row entrance');
    assert.doesNotMatch(
        styles,
        /\.list-rows \{\s*display: flex;[^}]*transition: opacity/,
        'product rows must stay at full opacity so icons, copy, and chips do not wash out'
    );
    assert.doesNotMatch(clientSource, /shop-stock-badge--floating/, 'grid cards should not overlay a floating stock capsule on the cover');
    assert.match(styles, /\.shop-card \.list-chip--stock \{[\s\S]*display: inline-flex;/, 'grid cards should keep the moved stock chip visible');
    assert.match(
        styles,
        /@media \(max-width: 820px\)[\s\S]*list-mobile-filter__heading/,
        'mobile order query should sit beside the category title above the filter capsule'
    );
    assert.match(
        styles,
        /grid-template-columns: minmax\(0, 1fr\) 72px 64px 48px 88px;/,
        'narrow desktop price column must stay wide enough for ￥ plus the amount'
    );
    assert.match(
        styles,
        /@media \(min-width: 821px\) and \(max-width: 980px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\) 72px 64px 48px 88px;/,
        'the five-column list grid must stay desktop-only so mobile price does not sit in the leftover stock/sales/action tracks'
    );
    assert.match(
        styles,
        /@media \(max-width: 820px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto !important;/,
        'mobile list rows must lock to a two-column product/price grid'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list\.is-list-drawer-open \.list-aside \{[\s\S]*pointer-events: auto;/,
        'the open category drawer must receive clicks and hover above the overlay'
    );
    assert.match(
        styles,
        /@media \(max-width: 820px\)[\s\S]*html body\.shop-page \.shop-main\.shop-layout--list \.list-aside \{[\s\S]*transform: translateX\(-110%\);[\s\S]*transition: none;/,
        'crossing to mobile must snap the category drawer closed instead of animating it open from the desktop sidebar'
    );
    assert.match(
        styles,
        /is-list-drawer-ready \.list-aside \{[\s\S]*transition: transform 0\.32s/,
        'intentional mobile drawer open/close can still animate after the breakpoint has settled'
    );
    assert.match(
        source,
        /crossedViewport/,
        'resizing across the mobile breakpoint should freeze and close the category drawer'
    );
    assert.match(
        source,
        /scheduleListDrawerReady/,
        'drawer motion should be re-enabled only after the mobile layout has settled'
    );
    const overlayIdx = styles.lastIndexOf('z-index: 10030');
    const drawerIdx = styles.lastIndexOf('z-index: 10040');
    assert.ok(overlayIdx > 0 && drawerIdx > overlayIdx, 'the mobile category drawer must stack above its overlay');

    const preload = fs.readFileSync(path.join(workspaceRoot, 'js/shop-layout-preload.js'), 'utf8');
    assert.match(markup, /js\/shop-layout-preload\.js/, 'shop.html should boot the stored list/grid layout before first paint');
    assert.ok(
        markup.indexOf('shop-layout-preload.js') < markup.indexOf('id="userShopGrid"'),
        'layout preload must run before the grid skeleton is parsed'
    );
    assert.match(markup, /list-row is-skeleton/, 'list mode should have row skeletons instead of flashing grid cards');
    assert.match(preload, /shop-layout-view/, 'layout preload should read the persisted list/grid preference');
    assert.match(preload, /stored === 'list' \|\| stored === 'grid' \? stored : 'list'/, 'new shop visits should default to list mode');
    assert.match(source, /stored === 'list' \|\| stored === 'grid' \? stored : 'list'/, 'runtime layout should default to list when no preference is stored');
    assert.match(markup, /class="shop-main shop-layout--list"/, 'shop.html should boot in list mode before preload runs');
    assert.match(markup, /data-view-target="list"[\s\S]*data-view-target="grid"/, 'the view toggle should put the list icon before the grid icon');
    assert.match(styles, /\.view-toggle\[data-view="grid"\] \.view-toggle__indicator \{\s*transform: translateX/, 'the sliding indicator should follow the grid icon on the right');
    assert.match(preload, /\(max-width: 820px\)/, 'layout preload should force list mode on mobile');
    assert.match(source, /document\.documentElement\.dataset\.shopLayout = view/, 'runtime layout updates should keep the html layout hint in sync');
    assert.match(source, /listSkeletonMarkup/, 'list loading should reuse list-row skeletons rather than the grid skeleton');
    assert.match(
        styles,
        /html\[data-shop-layout="list"\] \.shop-main #userShopGrid/,
        'list preference must hide the grid skeleton even before shop-main classes update'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-rows \{[\s\S]*overflow: visible;/,
        'mobile list card must not clip its own background out of the rounded corners'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-catalog \{[\s\S]*background: transparent;/,
        'mobile list catalog wrapper must stay transparent so controls above the product rows keep the page surface'
    );
    assert.match(
        styles,
        /@media \(max-width: 820px\)[\s\S]*html body\.shop-page \.shop-main\.shop-layout--list \.list-product p \{\s*display: none !important;/,
        'mobile list rows must hide product descriptions below the product name'
    );
    assert.match(
        styles,
        /@media \(max-width: 820px\)[\s\S]*html body\.shop-page \.shop-main\.shop-layout--list \.list-product \.list-chips \{\s*margin-top: 10px;/,
        'mobile list metadata capsules should have a little breathing room below the product name'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-row:last-child \{[\s\S]*border-radius: 0 0 18px 18px;/,
        'mobile last product must paint the card bottom corners with the row background'
    );
    assert.doesNotMatch(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-rows \{[\s\S]*transform: translateZ\(0\);/,
        'mobile list card must not promote a compositor layer that punches holes in rounded corners'
    );
    assert.match(
        styles,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \.list-rows,[\s\S]*background: #1a1f26;/,
        'dark list rows must share the raised card background so first/last corners do not leak'
    );
    assert.match(
        styles,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \.list-aside__panel,[\s\S]*background: var\(--shop-list-gray-surface\) !important;[\s\S]*backdrop-filter: none !important;/,
        'dark list surfaces must use the neutral graphite palette and must not let the starfield show through the category panel'
    );
    assert.match(
        styles,
        /@media \(max-width: 820px\) \{[\s\S]*html\[data-theme="dark"\] body\.shop-page\[data-layout-mode="mobile"\][\s\S]*\.shop-main\.shop-layout--list \.list-layout,[\s\S]*\.shop-main\.shop-layout--list \.list-catalog,[\s\S]*\.shop-main\.shop-layout--list \.list-catalog__head \{[\s\S]*background: transparent !important;[\s\S]*background-color: transparent !important;/,
        'dark mobile list shell must stay transparent so controls above the product rows keep the page background'
    );
    assert.match(
        styles,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \{[\s\S]*position: relative;[\s\S]*z-index: 1;[\s\S]*background-color: var\(--shop-list-gray-page\) !important;/,
        'dark list mode must sit above the star canvas and keep the area outside its panels on the page black'
    );
    const finalListImageCss = styles.slice(styles.lastIndexOf('/* Keep desktop list thumbnails'));
    assert.match(
        finalListImageCss,
        /@media \(min-width: 821px\)[\s\S]*shop-main\.shop-layout--list \.list-row:not\(\.is-skeleton\) \.list-thumb \{[\s\S]*width: 52px;[\s\S]*height: 52px;/,
        'desktop list thumbnails must keep the same 52px footprint as the mobile list'
    );
    const mobileListSurfaceCss = styles.slice(styles.lastIndexOf('/* Narrow list rows use the same opaque card surfaces'));
    assert.match(
        mobileListSurfaceCss,
        /@media \(max-width: 820px\)[\s\S]*shop-main\.shop-layout--list \.list-rows,[\s\S]*shop-main\.shop-layout--list \.list-row \{[\s\S]*background: #fff !important;[\s\S]*background-color: #fff !important;[\s\S]*background-image: none !important;/,
        'narrow list product rows must use the same opaque light product-card surface as grid mode'
    );
    assert.match(
        mobileListSurfaceCss,
        /html\[data-theme="dark"\] body\.shop-page\[data-layout-mode="mobile"\] \.shop-main\.shop-layout--list \.list-rows,[\s\S]*html\[data-theme="dark"\] body\.shop-page\[data-layout-mode="mobile"\] \.shop-main\.shop-layout--list \.list-row \{[\s\S]*background: #171d28 !important;[\s\S]*background-color: #171d28 !important;[\s\S]*background-image: none !important;/,
        'narrow list product rows must use the same opaque dark product-card surface as grid mode and outrank the legacy mobile override'
    );
    const desktopListSurfaceCss = styles.slice(styles.lastIndexOf('/* Desktop list surfaces follow the same opaque product-card palette'));
    assert.match(
        desktopListSurfaceCss,
        /@media \(min-width: 821px\)[\s\S]*shop-main\.shop-layout--list \.list-aside__panel,[\s\S]*shop-main\.shop-layout--list \.list-row \{[\s\S]*background: #fff !important;[\s\S]*background-color: #fff !important;[\s\S]*background-image: none !important;/,
        'desktop list surfaces must use the same opaque light product-card surface as grid mode'
    );
    assert.match(
        desktopListSurfaceCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \.list-aside__panel,[\s\S]*html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \.list-row \{[\s\S]*background: #171d28 !important;[\s\S]*background-color: #171d28 !important;[\s\S]*background-image: none !important;/,
        'desktop list surfaces must use the same opaque dark product-card surface as grid mode'
    );
    assert.match(
        styles,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \.list-row:hover \{[\s\S]*background: #202836 !important;[\s\S]*outline: none !important;[\s\S]*box-shadow: none !important;/,
        'dark list hover must match the narrow blue surface without thickening the row edges'
    );
    assert.match(
        styles,
        /html body\.shop-page \.shop-main\.shop-layout--list \.list-row:hover \.list-thumb img \{\s*transform: scale\(1\.03\);/,
        'list image hover should keep the subtle 1.03 zoom treatment'
    );
    assert.match(
        styles,
        /\.shop-main\.shop-layout--list \.list-aside \.filter-tab:hover:not\(.active\) \{[\s\S]*background: #202836 !important;[\s\S]*color: #f1f3f5 !important;/,
        'dark category hover should match the blue list-row surface'
    );
    assert.match(
        styles,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-main\.shop-layout--list \.list-aside \.filter-tab:hover:not\(.active\) \{[\s\S]*background: #f5f6f8 !important;[\s\S]*color: #3f4650 !important;/,
        'light category hover should use a soft neutral surface instead of a dark overlay'
    );
    assert.match(
        styles,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-main\.shop-layout--list \.list-row:hover \{[\s\S]*background: #f5f6f8 !important;[\s\S]*outline: none !important;[\s\S]*box-shadow: none !important;/,
        'light list row hover should share the category soft gray surface'
    );
});

test('grid mode reuses the list sidebar and puts order query above categories', () => {
    const markup = fs.readFileSync(path.join(workspaceRoot, 'shop.html'), 'utf8');
    const styles = fs.readFileSync(path.join(workspaceRoot, 'css/shop-list-layout.css'), 'utf8');
    const layoutSource = fs.readFileSync(path.join(workspaceRoot, 'js/shop-list-layout.js'), 'utf8');
    const pageStyles = fs.readFileSync(path.join(workspaceRoot, 'css/shop-page.css'), 'utf8');

    const toolbarIndex = markup.indexOf('<div class="shop-toolbar shop-view-toolbar">');
    const listLayoutIndex = markup.indexOf('<div class="list-layout">');
    const asideStackIndex = markup.indexOf('<div class="list-aside-stack">', listLayoutIndex);
    const desktopQueryIndex = markup.indexOf('<button class="list-order-query list-order-query--desktop"', asideStackIndex);
    const categoryDrawerIndex = markup.indexOf('<aside class="list-aside" id="listCategoryDrawer">', asideStackIndex);
    const gridIndex = markup.indexOf('<div id="userShopGrid"');
    assert.ok(
        toolbarIndex >= 0 && toolbarIndex < listLayoutIndex
            && listLayoutIndex < asideStackIndex
            && asideStackIndex < desktopQueryIndex
            && desktopQueryIndex < categoryDrawerIndex
            && categoryDrawerIndex < gridIndex,
        'the shared list shell must keep order query above the category card and the product grid after it'
    );
    assert.match(
        markup,
        /<div class="list-aside-stack">[\s\S]*<button class="list-order-query list-order-query--desktop"[^>]*data-list-order-query[\s\S]*<aside class="list-aside" id="listCategoryDrawer">[\s\S]*<div id="listCategoryFilters"/,
        'grid mode must reuse the list sidebar category card and its order-query control'
    );

    const finalGridCss = styles.slice(styles.lastIndexOf('/* Desktop grid mode: reuse the list sidebar'));
    assert.match(
        finalGridCss,
        /@media \(min-width: 821px\)[\s\S]*\.shop-main\.shop-layout--grid \{[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(250px, 290px\) minmax\(0, 1fr\);/,
        'desktop grid mode must create a left sidebar column and a right content column'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \{[\s\S]*grid-template-rows: max-content 40px auto;/,
        'desktop grid mode must keep a fixed 40px search row so short categories cannot shift the product grid baseline'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-aside__panel \{[\s\S]*padding: 22px;[\s\S]*border-radius: 24px;/,
        'grid mode category card must reuse the list mode card spacing and radius'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-aside__heading \{[\s\S]*min-height: 86px;[\s\S]*border-bottom: 1px solid #e0e1e6;/,
        'grid mode category card must keep the list mode title header hierarchy'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-aside__panel \{[\s\S]*background: #fff !important;[\s\S]*background-color: #fff !important;[\s\S]*background-image: none !important;[\s\S]*backdrop-filter: none;/,
        'grid mode category card must use an opaque white surface in the light theme'
    );
    assert.match(
        finalGridCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.list-aside__panel \{[\s\S]*background: #171d28 !important;[\s\S]*background-color: #171d28 !important;[\s\S]*border-color: rgba\(255, 255, 255, 0\.14\) !important;[\s\S]*box-shadow: 0 10px 24px rgba\(0, 0, 0, 0\.26\) !important;/,
        'grid mode category card must use an opaque product-card-matched surface in the dark theme'
    );
    assert.match(
        finalGridCss,
        /html body\.shop-page \.shop-main\.shop-layout--grid \.list-aside \.filter-tab,[\s\S]*min-height: 42px;[\s\S]*border-radius: 999px;/,
        'grid category items must reuse the list mode height and capsule radius'
    );
    assert.match(
        finalGridCss,
        /html body\.shop-page \.shop-main\.shop-layout--grid \.list-aside \.filter-tab \.count,[\s\S]*min-width: 28px;[\s\S]*height: 22px;[\s\S]*background: #f0f0f3 !important;/,
        'grid category counts must reuse the list mode badge sizing and surface'
    );
    assert.match(
        finalGridCss,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page \.shop-main\.shop-layout--grid \.list-aside \.filter-tab:hover:not\(\.active\) \{[\s\S]*background: #f5f6f8 !important;[\s\S]*border-color: rgba\(15, 23, 42, 0\.08\) !important;[\s\S]*box-shadow: none !important;[\s\S]*transform: none !important;/,
        'grid light category hover must match the list soft gray surface and neutral border'
    );
    assert.match(
        finalGridCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.list-aside \.filter-tab:hover:not\(\.active\) \{[\s\S]*background: #202836 !important;[\s\S]*border-color: rgba\(255, 255, 255, 0\.13\) !important;[\s\S]*color: #f1f3f5 !important;[\s\S]*box-shadow: none !important;[\s\S]*transform: none !important;/,
        'grid dark category hover must match the blue list surface and neutral border'
    );
    assert.match(
        finalGridCss,
        /html body\.shop-page \.shop-main\.shop-layout--grid \.list-aside__indicator \{[\s\S]*background: #fff !important;[\s\S]*border: 1px solid #d9d9e0 !important;[\s\S]*box-shadow: 0 3px 6px rgba\(0, 0, 0, 0\.08\), 0 2px 4px rgba\(0, 0, 0, 0\.05\) !important;/,
        'grid light category selection indicator must reuse the list mode surface'
    );
    assert.match(
        finalGridCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.list-aside__indicator \{[\s\S]*background: #20242a !important;[\s\S]*border-color: rgba\(255, 255, 255, 0\.3\) !important;[\s\S]*box-shadow: 0 3px 10px rgba\(0, 0, 0, 0\.28\) !important;/,
        'grid dark category selection indicator must reuse the list mode surface'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.shop-category-strip,[\s\S]*\.shop-main\.shop-layout--grid \.list-order-query--grid \{[\s\S]*display: none !important;/,
        'the obsolete top category strip and duplicate grid order-query button must be hidden'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-layout \{\s*display: contents !important;/,
        'grid mode must expose the shared list sidebar and catalog as outer grid children'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-aside-stack \{[\s\S]*display: flex !important;[\s\S]*flex-direction: column;[\s\S]*grid-column: 1;[\s\S]*grid-row: 2 \/ span 2;/,
        'grid mode must keep the order query and category card in the same vertical sidebar arrangement as list mode'
    );
    assert.doesNotMatch(
        layoutSource,
        /syncGridSearchPlacement|listSearchHome/,
        'grid mode must not move or fold the shared list search form into the order-query sidebar'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-search-combo \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 2;[\s\S]*width: min\(360px, 100%\);/,
        'grid mode search must remain in the catalog column with the list-mode width'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-aside__indicator \{[\s\S]*border-top: 1px solid #d9d9e0 !important;[\s\S]*transition: transform 0\.34s cubic-bezier\(0\.22, 1, 0\.36, 1\), height 0\.34s cubic-bezier\(0\.22, 1, 0\.36, 1\);/,
        'grid selected category indicator must retain its top border and list-mode sliding transition'
    );
    assert.match(
        finalGridCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.list-aside__indicator \{[\s\S]*border-top-color: rgba\(255, 255, 255, 0\.3\) !important;/,
        'dark grid selected category indicator must retain its top border'
    );
    assert.match(
        finalGridCss,
        /shop-main\.shop-layout--grid \.list-aside__tabs \{[\s\S]*isolation: isolate;/,
        'grid category tabs must isolate the shared selected indicator layer'
    );
    assert.match(
        finalGridCss,
        /shop-main\.shop-layout--grid \.list-aside \.filter-tab,[\s\S]*backdrop-filter: none !important;[\s\S]*-webkit-backdrop-filter: none !important;/,
        'grid category buttons must not blur or cover the selected indicator border'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.shop-grid-layout \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 3;/,
        'the product grid must remain below the list-mode search row in the right column'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-search-combo \{[\s\S]*display: flex;[\s\S]*border-radius: 999px;/,
        'grid mode search must use the same one-row pill container as list mode'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-search-combo \{[\s\S]*height: 40px;[\s\S]*min-height: 40px;[\s\S]*box-sizing: border-box;/,
        'grid mode search must match the 40px order-query control height'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.list-search-submit \{[\s\S]*display: inline-flex;[\s\S]*flex: 0 0 auto;/,
        'grid mode search button must keep the list-mode inline search control'
    );
    assert.match(
        finalGridCss,
        /\.shop-main\.shop-layout--grid \.shop-card-breathe-shell,[\s\S]*\.shop-main\.shop-layout--grid \.shop-card:hover \.shop-card-breathe-shell \{[\s\S]*box-shadow: 0 3px 6px rgba\(0, 0, 0, 0\.08\), 0 2px 4px rgba\(0, 0, 0, 0\.05\);/,
        'grid product cards must share the refined light-theme shadow used by the category card'
    );
    assert.match(
        finalGridCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.shop-card-breathe-shell,[\s\S]*background: #171d28 !important;[\s\S]*background-color: #171d28 !important;[\s\S]*background-image: none !important;/,
        'grid product cards must use the same opaque surface in the dark theme'
    );
    assert.match(
        finalGridCss,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.shop-card-breathe-shell,[\s\S]*box-shadow: 0 10px 24px rgba\(0, 0, 0, 0\.26\);/,
        'grid product cards must keep the category card shadow in the dark theme'
    );
    assert.match(finalGridCss, /@media \(min-width: 821px\) and \(max-width: 1159px\)[\s\S]*shop-main\.shop-layout--grid \.shop-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, 'desktop grid mode must keep at least two columns');
    assert.match(finalGridCss, /@media \(min-width: 1160px\) and \(max-width: 1419px\)[\s\S]*shop-main\.shop-layout--grid \.shop-grid \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, 'desktop grid mode must use three columns through the middle width range');
    assert.match(finalGridCss, /@media \(min-width: 1420px\)[\s\S]*shop-main\.shop-layout--grid \.shop-grid \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/, 'wide grid mode must cap cards at four columns');
    assert.doesNotMatch(finalGridCss, /\.shop-main\.shop-layout--grid \.shop-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/, 'desktop grid mode must not define a one-column product grid');
    assert.match(
        styles,
        /@media \(min-width: 821px\)[\s\S]*shop-main\.shop-layout--list \.shop-view-toolbar,[\s\S]*shop-main\.shop-layout--grid \.shop-view-toolbar \{[\s\S]*min-height: 24px;/,
        'list and grid mode must share the same toolbar height before the left sidebar stack'
    );
    assert.match(
        styles,
        /shop-main\.shop-layout--list \.shop-view-toolbar \{[\s\S]*margin-bottom: 18px;[\s\S]*\}\s*html body\.shop-page \.shop-main\.shop-layout--grid \.shop-view-toolbar \{[\s\S]*margin-bottom: 6px;/,
        'grid toolbar margin must compensate for the 12px grid row gap so the sidebar baseline matches list mode'
    );
    assert.match(
        styles,
        /@media \(min-width: 821px\)[\s\S]*shop-main\.shop-layout--list \.list-search-combo,[\s\S]*shop-main\.shop-layout--grid \.list-search-combo \{[\s\S]*height: 40px;[\s\S]*min-height: 40px;[\s\S]*box-sizing: border-box;[\s\S]*border: 1px solid #d9d9e0;[\s\S]*background: #fff;/,
        'list and grid mode search forms must share the same 40px outer pill and light-theme surface'
    );
    assert.match(
        styles,
        /html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \.list-search-combo,[\s\S]*html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--grid \.list-search-combo \{[\s\S]*background: #181b20;[\s\S]*border-color: rgba\(255, 255, 255, 0\.18\);/,
        'list and grid mode search forms must share the same dark-theme surface'
    );
    assert.match(
        styles,
        /shop-main\.shop-layout--list \.list-search,[\s\S]*shop-main\.shop-layout--grid \.list-search \{[\s\S]*height: 30px;[\s\S]*min-height: 30px;/,
        'list and grid mode search fields must use the same 30px inner control'
    );
    assert.match(
        styles,
        /shop-main\.shop-layout--list \.list-search-submit,[\s\S]*shop-main\.shop-layout--grid \.list-search-submit \{[\s\S]*height: 30px;[\s\S]*min-height: 30px;/,
        'list and grid mode search buttons must use the same 30px control height'
    );
    assert.match(layoutSource, /renderCategoryContainer\(listFilters, entries, current, \{ withIndicator: true \}\)/, 'grid mode must continue to share the list category renderer');
    assert.match(layoutSource, /renderCategoryContainer\(gridFilters, entries, current, \{ withIndicator: true \}\)/, 'grid categories must render the same sliding indicator');
    assert.match(layoutSource, /function syncCategoryIndicator\(container/, 'list and grid indicators must share one positioning algorithm');
    assert.match(layoutSource, /syncGridIndicator\(\{ animate: animateListIndicator \}\)/, 'grid category changes must animate the shared indicator');
    assert.match(layoutSource, /selectCategory\(gridCategoryBtn\.dataset\.shopCategory \|\| ''\)/, 'category selection must continue through the shared selector');

    const orderDetailBaseStart = pageStyles.lastIndexOf('.shop-order-history-view {');
    const orderDetailHoverStart = pageStyles.lastIndexOf('html body.shop-page .shop-order-history-view:hover');
    assert.ok(orderDetailBaseStart >= 0 && orderDetailHoverStart > orderDetailBaseStart, 'order detail base and hover rules must be present');
    const orderDetailBase = pageStyles.slice(orderDetailBaseStart, pageStyles.indexOf('}', orderDetailBaseStart) + 1);
    const orderDetailHover = pageStyles.slice(orderDetailHoverStart, pageStyles.indexOf('}', orderDetailHoverStart) + 1);
    assert.match(orderDetailBase, /box-shadow: none;[\s\S]*transform: none;[\s\S]*filter: none;/, 'order detail surface and shadow must stay static');
    assert.match(orderDetailBase, /transition: color 0\.2s ease;/, 'order detail transition should be limited to text color');
    assert.match(orderDetailHover, /color: #9ca3af;/, 'order detail hover should match the list purchase action color');
    assert.doesNotMatch(
        orderDetailHover,
        /background|border|box-shadow|transform|filter/,
        'order detail hover must change text color only'
    );
});
