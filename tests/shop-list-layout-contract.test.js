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
        source,
        /<span class="list-price__symbol" aria-hidden="true">￥<\/span><span class="list-price__value">/,
        'the main-site list price should keep the yuan symbol from the preview'
    );
    assert.match(source, /list-chip--sales/, 'the integrated list should keep sales metadata chips');
    assert.match(source, /openProductPurchaseFromDataset/, 'list actions should continue using the original purchase flow');
    assert.match(source, /syncStaticCopy/, 'list chrome should follow the active shop locale');
    assert.match(source, /ensureAllProductsForSearch/, 'search should hydrate all categories before resolving results');
    assert.match(source, /canPatchInPlace/, 'category indicator should be preserved for sliding transitions');
    assert.match(source, /originalHydrateProductCaches/, 'background catalog hydration should refresh the list view');
    assert.match(clientSource, /SHOP_PREFETCH_SCHEMA_VERSION = '20260912_SHOP_LIST_LAYOUT_SALES_1'/, 'catalog cache should invalidate stale pre-sales payloads');
    assert.match(markup, /class="list-search-submit"/, 'the integrated list should keep the search submit control');
    assert.match(markup, /family=Noto\+Sans\+SC:wght@400;500;600;700;800/, 'shop.html should load a CJK 800 weight so list chips can render the intended bold');
    assert.match(styles, /\.list-chip--sales/, 'the integrated list should keep the sales chip styling');
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
    assert.match(styles, /html body\.shop-page \.shop-card \.list-chip \{[\s\S]*font-weight: 800 !important/, 'list and grid chips should lock to 800 after refresh');
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
        /@media \(max-width: 820px\)[\s\S]*html\[data-theme="dark"\] body\.shop-page \.shop-main\.shop-layout--list \.list-catalog \{[\s\S]*background: transparent;/,
        'mobile dark catalog chrome must not keep the desktop card slab behind title/search/filter'
    );
});
