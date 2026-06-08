const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop purchase modal remains scrollable when the mobile keyboard docks it', () => {
    const shopStyles = readRepoFile(path.join('css', 'shop-page.css'));
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopHtml = readRepoFile('shop.html');

    assert.equal(
        shopHtml.includes('css/shop-page.css?v=20260520_SHOP_CARD_PROMPT_BREATHE_3'),
        true,
        'shop.html should load the keyboard-dock cache-busted storefront stylesheet'
    );

    assert.equal(
        shopHtml.includes('purchaseModalRoomier=20260523_SHOP_PURCHASE_MODAL_ROOMIER_1'),
        true,
        'shop.html should bust the storefront stylesheet cache after making the purchase modal roomier'
    );
    assert.equal(
        shopHtml.includes('purchaseSkuCombo=20260524_SHOP_PURCHASE_SKU_COMBO_1'),
        true,
        'shop.html should bust storefront assets after switching purchase SKU selection to compact tags and grouped specs'
    );
    assert.equal(
        shopHtml.includes('purchaseSkuCompact=20260524_SHOP_PURCHASE_SKU_COMPACT_2'),
        true,
        'shop.html should bust storefront styles after tightening the purchase SKU and coupon controls'
    );
    assert.equal(
        shopHtml.includes('purchaseSplit=20260524_SHOP_PURCHASE_SPLIT_2'),
        true,
        'shop.html should bust storefront styles after widening the purchase modal checkout dock'
    );
    assert.equal(
        shopHtml.includes('purchaseStagger=20260524_SHOP_PURCHASE_STAGGER_1'),
        true,
        'shop.html should bust storefront styles after restoring the purchase modal staggered entrance animation'
    );
    assert.equal(
        shopHtml.includes('purchaseWideDefaults=20260524_SHOP_PURCHASE_WIDE_DEFAULTS_1'),
        true,
        'shop.html should bust storefront assets after locking wide purchase defaults'
    );
    assert.equal(
        shopHtml.includes('purchaseNarrowUnified=20260524_SHOP_PURCHASE_NARROW_UNIFIED_1'),
        true,
        'shop.html should bust storefront styles after unifying the narrow purchase modal surface'
    );
    assert.equal(
        shopHtml.includes('purchaseStockTone=20260524_SHOP_PURCHASE_STOCK_TONE_1'),
        true,
        'shop.html should bust storefront assets after adding purchase stock tone colors'
    );
    assert.equal(
        shopHtml.includes('purchaseNarrowGuidanceGap=20260524_SHOP_PURCHASE_NARROW_GUIDANCE_GAP_7'),
        true,
        'shop.html should bust storefront styles after spacing narrow guidance panels away from the quantity dock'
    );
    assert.equal(
        shopHtml.includes('successDeliveryPanel=20260524_SHOP_SUCCESS_DELIVERY_PANEL_3'),
        true,
        'shop.html should bust storefront styles after restoring compact success card content height'
    );
    assert.equal(
        shopHtml.includes('purchaseTitleCompact=20260524_SHOP_PURCHASE_TITLE_COMPACT_1'),
        true,
        'shop.html should bust storefront styles after matching the purchase title to the compact success title'
    );
    assert.equal(
        shopHtml.includes('successScrollHandoff=20260524_SHOP_SUCCESS_SCROLL_HANDOFF_2'),
        true,
        'shop.html should bust storefront styles after moving success guidance into the main modal scroll flow'
    );
    assert.match(
        shopHtml,
        /<h3 id="purchaseStageTitle" class="card-title shop-inline-style-attr-6">Product Name<\/h3>/,
        'purchase modal should use the product name as its visible title instead of a generic confirm title'
    );
    assert.doesNotMatch(
        shopHtml,
        /id="purchaseStageTitle"[\s\S]{0,120}data-i18n="shop\.confirmRedeem"/,
        'purchase modal title should not be reset to the generic confirm-redeem copy'
    );
    assert.match(
        shopHtml,
        /<p id="modalProductName" class="shop-inline-style-attr-7" hidden><\/p>/,
        'purchase modal should keep the retired subtitle hidden so the product name is not duplicated'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal #purchaseStageTitle\s*\{[\s\S]*font-size:\s*24px;[\s\S]*font-weight:\s*700;[\s\S]*line-height:\s*1\.6;[\s\S]*letter-spacing:\s*0\.5px;[\s\S]*text-align:\s*center;/,
        'purchase modal product title should use the same compact card-title scale as the success modal title'
    );
    assert.match(
        shopHtml,
        /<div class="shop-purchase-body" data-purchase-step="configure">[\s\S]*<div class="shop-purchase-config-panel">[\s\S]*<div id="purchaseSkuSelector"[\s\S]*<div class="shop-purchase-dock" data-purchase-step="configure">[\s\S]*<details class="shop-purchase-stage shop-purchase-stage-discount shop-purchase-discount/,
        'purchase modal should keep SKU configuration on the left and place collapsible coupon controls in the checkout dock'
    );
    assert.match(
        shopHtml,
        /<div class="shop-purchase-dock" data-purchase-step="configure">[\s\S]*<div class="shop-quantity-wrapper shop-purchase-stage shop-purchase-stage-quantity"[\s\S]*<div class="shop-purchase-stage shop-purchase-stage-summary[\s\S]*<details class="shop-purchase-stage shop-purchase-stage-discount shop-purchase-discount[\s\S]*<div class="shop-purchase-stage shop-purchase-stage-action/,
        'purchase modal should place quantity, pricing, coupons, and actions in the checkout dock in that order'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal \.modal-content>\.shop-purchase-stage,[\s\S]*#shopPurchaseModal \.shop-purchase-config-panel>\.shop-purchase-stage,[\s\S]*#shopPurchaseModal \.shop-purchase-dock>\.shop-purchase-stage[\s\S]*will-change: opacity, transform;/,
        'purchase modal should animate both the header and the nested split-column stage blocks'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal:not\(\.active\) \.modal-content>\.shop-purchase-stage,[\s\S]*transform: translate3d\(0, 14px, 0\) !important;[\s\S]*#shopPurchaseModal \.modal-content>\.shop-purchase-stage--opening-stagger,[\s\S]*transform: translate3d\(0, 14px, 0\);[\s\S]*#shopPurchaseModal \.shop-purchase-stage--opening-stagger \.shop-sku-option--pill,[\s\S]*transform: translate3d\(0, 0, 0\);[\s\S]*#shopPurchaseModal\.active \.modal-content>\.shop-purchase-stage--opening-stagger,[\s\S]*#shopPurchaseModal\.active \.shop-purchase-dock>\.shop-purchase-stage--opening-stagger \{[\s\S]*animation: shopPurchaseStaggeredRise 0\.42s cubic-bezier\(0\.22, 1, 0\.36, 1\) both;/,
        'purchase modal should prepare the product title and content at the same rise origin before the active frame'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal\.active \.shop-purchase-stage--opening-stagger \.shop-sku-selector__header \{[\s\S]*animation: shopPurchaseStaggeredRise 0\.42s cubic-bezier\(0\.22, 1, 0\.36, 1\) both;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage--opening-stagger \.shop-sku-option--pill,[\s\S]*animation: shopPurchaseSkuTagFadeIn 0\.3s cubic-bezier\(0\.22, 1, 0\.36, 1\) both;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage--opening-stagger \.shop-sku-option--pill\.is-disabled,[\s\S]*animation-name: shopPurchaseSkuDisabledFadeIn;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage-sku\.shop-purchase-stage--opening-stagger \{[\s\S]*animation: none;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage--opening-stagger \.shop-sku-option--pill:nth-of-type\(1\)[\s\S]*animation-delay: 0\.14s !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage--opening-stagger \.shop-sku-option--pill:nth-of-type\(2\)[\s\S]*animation-delay: 0\.18s !important;/,
        'purchase modal should stagger SKU tags with opacity only and keep disabled tags gray during opening'
    );
    assert.match(
        shopStyles,
        /@keyframes shopPurchaseStaggeredRise \{[\s\S]*from \{[\s\S]*opacity: 0;[\s\S]*transform: translate3d\(0, 14px, 0\);[\s\S]*to \{[\s\S]*opacity: 1;[\s\S]*transform: translate3d\(0, 0, 0\);/,
        'purchase modal should keep a named rise keyframe for the staggered entrance'
    );
    assert.match(
        shopStyles,
        /@keyframes shopPurchaseSkuTagFadeIn \{[\s\S]*to \{[\s\S]*opacity: 1;[\s\S]*@keyframes shopPurchaseSkuDisabledFadeIn \{[\s\S]*to \{[\s\S]*opacity: 0\.42;/,
        'SKU opening animations should keep unavailable specs in their disabled opacity instead of flashing active text'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal\.active \.shop-purchase-stage-header \{[\s\S]*animation-delay: 0s !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage-sku \{[\s\S]*animation-delay: 0\.08s !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage-quantity \{[\s\S]*animation-delay: 0\.2s !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage-notes \{[\s\S]*animation-delay: 0\.24s !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage-summary \{[\s\S]*animation-delay: 0\.28s !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage-discount \{[\s\S]*animation-delay: 0\.34s !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage-action \{[\s\S]*animation-delay: 0\.4s !important;/,
        'purchase modal should start the title immediately and keep a compact stagger order across the content'
    );

    assert.match(
        shopStyles,
        /\/\* 20260523_SHOP_PURCHASE_MODAL_ROOMIER_1 \*\/[\s\S]*@media \(min-width: 769px\) \{[\s\S]*#shopPurchaseModal \.modal-content \{[\s\S]*width: min\(calc\(100% - 72px\), 820px\) !important;[\s\S]*max-width: 820px !important;[\s\S]*padding: clamp\(38px, 3\.4vw, 50px\) clamp\(42px, 4\.2vw, 60px\) clamp\(34px, 3\.6vw, 46px\) !important;/,
        'desktop purchase modal should have a wider, less cramped shell'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal \.shop-sku-selector__options \{[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(184px, 1fr\)\);[\s\S]*gap: 14px;/,
        'desktop purchase modal should give SKU choices enough horizontal room'
    );

    assert.match(
        shopStyles,
        /\/\* 20260523_SHOP_PURCHASE_MODAL_NARROW_1 \*\/[\s\S]*@media \(min-width: 769px\) and \(max-width: 980px\) \{[\s\S]*#shopPurchaseModal \.modal-content \{[\s\S]*width: min\(calc\(100% - 48px\), 720px\) !important;[\s\S]*max-width: 720px !important;[\s\S]*padding: 30px 34px 32px !important;/,
        'narrow desktop purchase modal should not inherit the full wide desktop shell'
    );

    assert.match(
        shopStyles,
        /@media \(min-width: 769px\) and \(max-width: 980px\) \{[\s\S]*#shopPurchaseModal \.shop-sku-selector__options \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*gap: 10px;/,
        'narrow desktop purchase modal should keep three compact SKU choices without crowding the viewport'
    );

    assert.match(
        shopStyles,
        /\/\* 20260523_SHOP_PURCHASE_MODAL_COMPACT_NARROW_1 \*\/[\s\S]*@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.modal-content \{[\s\S]*width: min\(calc\(100% - 32px\), 600px\) !important;[\s\S]*padding: 22px 18px calc\(18px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*border-radius: 28px !important;/,
        'narrow viewport purchase modal should compact the shell instead of filling the window edge to edge'
    );

    assert.match(
        shopStyles,
        /@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.shop-sku-selector__options \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*gap: 8px;[\s\S]*@media \(max-width: 460px\) \{[\s\S]*#shopPurchaseModal \.shop-sku-selector__options \{[\s\S]*grid-template-columns: 1fr;/,
        'narrow viewport SKU choices should stay compact, then fall back to one column on very small screens'
    );
    assert.equal(
        shopHtml.includes('js/shop-client.js?v=20260520_SHOP_CARD_PROMPT_BREATHE_3'),
        true,
        'shop.html should load the viewport-sync cache-busted storefront runtime'
    );
    assert.match(
        shopHtml,
        /js\/shop-client\.js\?[\s\S]*purchaseSplit=20260524_SHOP_PURCHASE_SPLIT_2[\s\S]*purchaseDiscountDrawer=20260524_SHOP_PURCHASE_DISCOUNT_DRAWER_3[\s\S]*purchaseGuidanceScrollState=20260524_SHOP_PURCHASE_GUIDANCE_SCROLL_STATE_2/,
        'shop.html should bust the storefront runtime cache after switching the purchase coupon accordion and guidance scroll state logic'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal \{[\s\S]*--shop-purchase-overlay-height: 100dvh;[\s\S]*--shop-purchase-viewport-top: 0px;[\s\S]*--shop-purchase-viewport-left: 0px;[\s\S]*--shop-purchase-viewport-width: 100vw;[\s\S]*top: var\(--shop-purchase-viewport-top\) !important;[\s\S]*height: var\(--shop-purchase-overlay-height\) !important;[\s\S]*overflow: hidden !important;/,
        'purchase modal overlay should be positioned against the native visual viewport like the wallet modal'
    );

    assert.match(
        shopStyles,
        /html\.shop-purchase-modal-lock,[\s\S]*body\.shop-purchase-modal-lock \{[\s\S]*overflow: hidden !important;[\s\S]*background: var\(--shop-purchase-theme-chrome-color, var\(--site-theme-chrome-color, var\(--bg-color\)\)\) !important;[\s\S]*body\.shop-purchase-modal-lock \{[\s\S]*position: fixed !important;[\s\S]*top: var\(--shop-purchase-lock-top, 0px\) !important;/,
        'purchase modal should freeze the page with a theme-aware body background before the active overlay frame'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal\.shop-purchase-force-hidden,[\s\S]*#shopPurchaseModal\[hidden\] \{[\s\S]*display: none !important;[\s\S]*transition: none !important;/,
        'purchase modal should bypass overlay fade rules when closing so the iOS address-bar white area disappears immediately'
    );

    assert.equal(
        shopStyles.includes('shop-purchase-chrome-fill'),
        false,
        'purchase modal should not retain the old extra-height chrome fill'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal \.modal-content\.shop-purchase-height-locked \{[\s\S]*overflow-y: auto !important;[\s\S]*overflow-x: hidden !important;/,
        'keyboard-locked purchase modal height should still expose a scrollable content area'
    );

    assert.match(
        shopStyles,
        /@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.modal-content \{[\s\S]*overflow-y: auto !important;[\s\S]*-webkit-overflow-scrolling: touch;[\s\S]*touch-action: pan-y;[\s\S]*scroll-padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\);/s,
        'mobile purchase modal content should be the scroll container accepted by the iOS scroll lock'
    );

    assert.match(
        shopClientSource,
        /schedulePurchaseModalKeyboardContentSync:\s*function\s*\(/,
        'shop-client.js should schedule a dock refresh after modal content changes'
    );

    assert.match(
        shopClientSource,
        /const liveScrollHeight = Math\.round\(card\.scrollHeight \|\| 0\);[\s\S]*const baseCardHeight = Math\.max\(320,[\s\S]*liveScrollHeight\);/,
        'keyboard dock height should account for the full scrollHeight of coupon-rich modal content'
    );
    assert.match(
        shopClientSource,
        /buildPurchaseSkuSpecGroups:\s*function[\s\S]*renderPurchaseSkuSpecGroups/,
        'purchase modal should support grouped spec selection when SKU spec_values are structured'
    );
    const selectedSkuSummarySource = shopClientSource.match(
        /renderPurchaseSkuSelectedSummary:\s*function\s*\(sku = \{\}\) \{([\s\S]*?)\n    \},\n\n    renderPurchaseSkuPills:/
    )?.[1] || '';
    assert.match(
        selectedSkuSummarySource,
        /shop\.stock|库存/,
        'selected SKU summary should keep the current stock label visible'
    );
    assert.match(
        selectedSkuSummarySource,
        /stock < 5 \? 'is-low-stock' : 'is-normal-stock'[\s\S]*shop-sku-selector__current-value/,
        'selected SKU summary should color the stock number by low versus normal inventory'
    );
    assert.doesNotMatch(
        selectedSkuSummarySource,
        /formatShopPoints|getProductSkuPriceForCurrentSite/,
        'selected SKU summary should not repeat the price already shown in the checkout dock'
    );
    const skuPillsSource = shopClientSource.match(
        /renderPurchaseSkuPills:\s*function\s*\(skus = \[\], selectedSkuId = ''\) \{([\s\S]*?)\n    \},\n\n    renderPurchaseSkuSpecGroups:/
    )?.[1] || '';
    assert.match(
        skuPillsSource,
        /shop-sku-option__name/,
        'compact SKU pills should still render the SKU name'
    );
    assert.match(
        skuPillsSource,
        /data-purchase-stagger-child="sku-option"/,
        'compact SKU pills should expose a stable child-stage marker for individual opening animation'
    );
    assert.doesNotMatch(
        skuPillsSource,
        /shop-sku-option__meta|formatShopPoints|getProductSkuPriceForCurrentSite|metaParts/,
        'compact SKU pills should not show duplicate price or stock metadata beside the SKU name'
    );
    assert.match(
        shopStyles,
        /\/\* 20260524_SHOP_PURCHASE_SKU_COMBO_1 \*\/[\s\S]*#shopPurchaseModal \.shop-purchase-scroll\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*#shopPurchaseModal \.shop-purchase-dock\s*\{[\s\S]*flex:\s*0 0 auto;/,
        'purchase modal should keep SKU content scrollable while the checkout dock stays fixed'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal \.shop-sku-selector__options--pills,[\s\S]*#shopPurchaseModal \.shop-sku-spec-group__options\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/,
        'SKU choices should render as compact wrapping tags instead of large cards'
    );
    assert.match(
        shopStyles,
        /\/\* 20260524_SHOP_PURCHASE_SKU_COMPACT_2 \*\/[\s\S]*#shopPurchaseModal \.shop-sku-selector__options--pills\s*\{[\s\S]*margin-top:\s*0;[\s\S]*padding:\s*6px 2px 8px 0;[\s\S]*#shopPurchaseModal \.shop-sku-spec-group__options\s*\{[\s\S]*padding:\s*6px 0 7px;/,
        'compact SKU choices should keep real hit area padding instead of relying on negative offsets'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal \.shop-sku-option--pill,[\s\S]*#shopPurchaseModal \.shop-sku-spec-option \{[\s\S]*transform:\s*translateZ\(0\);[\s\S]*touch-action:\s*manipulation;[\s\S]*transition:\s*background-color 0\.16s ease, border-color 0\.16s ease, box-shadow 0\.16s ease, color 0\.16s ease;/,
        'SKU pills should use a stable compositor layer and avoid transform transitions on normal interaction'
    );
    assert.match(
        shopStyles,
        /html:not\(\[data-theme="dark"\]\) body\.shop-page #shopPurchaseModal \.shop-sku-option--pill\.is-disabled,[\s\S]*color:\s*rgba\(71, 85, 105, 0\.62\);/,
        'light theme disabled SKU pills should keep gray text instead of flashing as active black text'
    );
    const skuHoverRule = shopStyles.match(
        /#shopPurchaseModal \.shop-sku-option--pill:hover:not\(:disabled\),\s*#shopPurchaseModal \.shop-sku-spec-option:hover:not\(:disabled\)\s*\{(?<body>[\s\S]*?)\n\}/
    )?.groups?.body || '';
    assert.doesNotMatch(
        skuHoverRule,
        /transform\s*:\s*translateY/,
        'SKU pill hover should not move the visual target away from its click hit area'
    );
    assert.match(
        shopClientSource,
        /resolvePurchaseSkuTriggerFromEvent:\s*function \(event\) \{[\s\S]*event\.target\.closest\('\[data-shop-sku-id\]'\)[\s\S]*matchMedia\?\.\('\(max-width: 768px\)'\)[\s\S]*closestDistance <= 14[\s\S]*handlePurchaseSkuTapFromEvent:\s*function \(event\) \{[\s\S]*this\.selectPurchaseSku\(skuTrigger\.dataset\.shopSkuId \|\| ''\);[\s\S]*modal\.querySelectorAll\('\.shop-sku-selector__options--pills, \.shop-sku-spec-group__options'\)[\s\S]*purchase-sku-near-edge[\s\S]*this\.handlePurchaseSkuTapFromEvent\(event\)/,
        'mobile SKU taps should resolve near-edge touches to the closest available pill'
    );
    assert.match(
        shopStyles,
        /@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.shop-sku-selector__header\s*\{[\s\S]*align-items:\s*baseline;[\s\S]*flex-direction:\s*row;[\s\S]*justify-content:\s*space-between;[\s\S]*#shopPurchaseModal \.shop-sku-selector__current\s*\{[\s\S]*margin-left:\s*auto;[\s\S]*text-align:\s*right;/,
        'narrow purchase modal should keep stock aligned to the right of the SKU label'
    );
    assert.match(
        shopStyles,
        /@media \(max-width: 768px\) \{[\s\S]*#shopPurchaseModal \.shop-sku-selector__label\s*\{[\s\S]*text-align:\s*left;/,
        'narrow purchase modal should keep the SKU label left aligned'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal \.shop-sku-selector__current-value\s*\{[\s\S]*color:\s*#22c55e;[\s\S]*#shopPurchaseModal \.shop-sku-selector__current\.is-low-stock \.shop-sku-selector__current-value\s*\{[\s\S]*color:\s*#ef4444;[\s\S]*#shopPurchaseModal \.shop-sku-selector__current\.is-normal-stock \.shop-sku-selector__current-value\s*\{[\s\S]*color:\s*#22c55e;/,
        'purchase modal stock count should use red for low inventory and green for normal inventory'
    );
    assert.match(
        shopStyles,
        /@media \(max-width: 900px\) \{[\s\S]*#shopPurchaseModal \.modal-content\s*\{[\s\S]*padding-bottom:\s*clamp\(18px, 4vw, 24px\) !important;[\s\S]*#shopPurchaseModal \.shop-purchase-scroll\s*\{[\s\S]*margin:\s*0;[\s\S]*padding:\s*0 0 22px;[\s\S]*#shopPurchaseModal \.shop-purchase-dock\s*\{[\s\S]*margin:\s*0;[\s\S]*padding:\s*0 0 calc\(2px \+ env\(safe-area-inset-bottom, 0px\)\);[\s\S]*border-top:\s*0 !important;[\s\S]*background:\s*transparent !important;[\s\S]*box-shadow:\s*none !important;/,
        'narrow purchase modal should use one continuous card surface instead of a separate checkout drawer'
    );
    assert.match(
        shopStyles,
        /@media \(max-width: 900px\) \{[\s\S]*#shopPurchaseModal\s*\{[\s\S]*--shop-purchase-guidance-bottom-reserve:\s*clamp\(124px, 18dvh, 158px\);[\s\S]*--shop-purchase-guidance-dock-gap:\s*16px;[\s\S]*--shop-purchase-guidance-card-max:\s*clamp\(132px, 18dvh, 168px\);[\s\S]*--shop-purchase-guidance-card-bottom-inset:\s*32px;[\s\S]*#shopPurchaseModal \.shop-purchase-scroll\s*\{[\s\S]*padding:\s*0 0 22px;[\s\S]*scroll-padding-bottom:\s*var\(--shop-purchase-guidance-bottom-reserve\);[\s\S]*#shopPurchaseModal #purchaseNotesBox\.is-expanded,[\s\S]*#shopPurchaseModal #purchaseUsageBox\.is-expanded\s*\{[\s\S]*margin-bottom:\s*0 !important;[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseNotesBox\.is-expanded\) \.shop-purchase-scroll,[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseUsageBox\.is-expanded\) \.shop-purchase-scroll\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*padding-bottom:\s*var\(--shop-purchase-guidance-dock-gap\);[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseNotesBox\.is-expanded\) \.shop-purchase-config-panel,[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseUsageBox\.is-expanded\) \.shop-purchase-config-panel\s*\{[\s\S]*gap:\s*6px;[\s\S]*#shopPurchaseModal #purchaseNotesCard\.shop-success-usage-card,[\s\S]*#shopPurchaseModal #purchaseUsageCard\.shop-success-usage-card\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*max-height:\s*var\(--shop-purchase-guidance-card-max\);[\s\S]*overflow:\s*hidden;[\s\S]*padding-bottom:\s*15px !important;[\s\S]*#shopPurchaseModal #purchaseNotesContent,[\s\S]*#shopPurchaseModal #purchaseUsageContent\s*\{[\s\S]*max-height:\s*calc\(var\(--shop-purchase-guidance-card-max\) - 30px\);[\s\S]*padding-bottom:\s*var\(--shop-purchase-guidance-card-bottom-inset\) !important;[\s\S]*scroll-padding-bottom:\s*var\(--shop-purchase-guidance-card-bottom-inset\);[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseNotesBox\.is-expanded\) \.shop-purchase-dock,[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseUsageBox\.is-expanded\) \.shop-purchase-dock\s*\{[\s\S]*gap:\s*8px;[\s\S]*padding-top:\s*2px;[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseNotesBox\.is-expanded\) \.shop-purchase-dock \.shop-purchase-stage-quantity,[\s\S]*#shopPurchaseModal \.shop-purchase-body:has\(#purchaseUsageBox\.is-expanded\) \.shop-purchase-dock \.shop-purchase-stage-quantity\s*\{[\s\S]*min-height:\s*0;[\s\S]*margin-top:\s*0 !important;[\s\S]*padding-block:\s*0;/,
        'narrow purchase modal should keep a tight but non-overlapping gap between expanded guidance text and the quantity controls'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal #purchaseNotesContent,[\s\S]*#shopPurchaseModal #purchaseUsageContent\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*padding-right:\s*42px;/,
        'purchase guidance copy buttons should stay fixed while the inner guidance content scrolls'
    );
    assert.match(
        shopClientSource,
        /bindContainedWheelIsolation: function \(scrollCard, \{ chainScrollTarget = null \} = \{\}\) \{[\s\S]*const getScrollEdgeBuffer = \(\) => \{[\s\S]*return Math\.min\(32, Math\.max\(0, paddingBottom\)\);[\s\S]*const effectiveMaxScrollTop = Math\.max\(0, maxScrollTop - getScrollEdgeBuffer\(\)\);[\s\S]*getPurchaseGuidanceScrollElement: function \(guidanceCard\) \{[\s\S]*return guidanceCard\.querySelector\('#purchaseNotesContent, #purchaseUsageContent'\) \|\| guidanceCard;[\s\S]*updatePurchaseGuidanceScrollState: function \(scrollCard\) \{[\s\S]*scrollCard\.classList\.toggle\('is-scroll-at-bottom', isAtBottom\);[\s\S]*scrollCard\.classList\.toggle\('is-scroll-away-from-bottom', isScrollable && !isAtBottom\);[\s\S]*this\.updatePurchaseGuidanceScrollState\(this\.getPurchaseGuidanceScrollElement\(expandedCard\)\);[\s\S]*this\.ensurePurchaseGuidanceVisible\(expandedCard\);[\s\S]*bindPurchaseGuidanceScrollState: function \(scrollCard\) \{[\s\S]*this\.updatePurchaseGuidanceScrollState\(scrollCard\);[\s\S]*ensurePurchaseGuidanceVisible: function \(scrollCard\) \{[\s\S]*const purchaseScroll = document\.querySelector\('#shopPurchaseModal \.shop-purchase-scroll'\);[\s\S]*const visibleGap = Math\.max\(12, Number\.parseFloat\(rawGap\) \|\| 16\);[\s\S]*purchaseScroll\.scrollTop = Math\.min\(maxScrollTop, purchaseScroll\.scrollTop \+ overflowBottom\);[\s\S]*getPurchaseGuidanceWheelChainTarget: function \(\) \{[\s\S]*if \(this\.isWidePurchaseModalLayout\(\)\) \{[\s\S]*return null;[\s\S]*return document\.querySelector\('#shopPurchaseModal \.shop-purchase-scroll'\);[\s\S]*bindPurchaseNotesWheelIsolation: function \(\) \{[\s\S]*const notesScroll = this\.getPurchaseGuidanceScrollElement\(notesCard\);[\s\S]*chainScrollTarget: this\.getPurchaseGuidanceWheelChainTarget\(\)[\s\S]*const scrollStateCleanup = this\.bindPurchaseGuidanceScrollState\(notesScroll\);[\s\S]*bindPurchaseUsageWheelIsolation: function \(\) \{[\s\S]*const usageScroll = this\.getPurchaseGuidanceScrollElement\(usageCard\);[\s\S]*chainScrollTarget: this\.getPurchaseGuidanceWheelChainTarget\(\)[\s\S]*const scrollStateCleanup = this\.bindPurchaseGuidanceScrollState\(usageScroll\);[\s\S]*this\.ensurePurchaseGuidanceVisible\(notesCard\);[\s\S]*this\.ensurePurchaseGuidanceVisible\(usageCard\);/,
        'purchase guidance cards should isolate desktop wheel scrolling, hand off narrow scrolling, mark scroll state, and keep expanded panels above the quantity dock'
    );
    assert.match(
        shopClientSource,
        /setPurchaseStage:\s*function[\s\S]*stageTitle\.textContent = this\.getCurrentPurchaseDisplayName\(\);/,
        'purchase stage title should be refreshed from the selected product name'
    );
    assert.match(
        shopClientSource,
        /renderModalProductName:\s*function[\s\S]*stageTitle\.textContent = displayName;[\s\S]*modalProductName\.hidden = true;/,
        'rendering the purchase modal product should put the product name in the title and hide the duplicate subtitle'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal #purchaseQuantity\.shop-qty-input\s*\{[\s\S]*width:\s*88px;[\s\S]*height:\s*42px;[\s\S]*#shopPurchaseModal \.shop-purchase-discount__input-wrap\s*\{[\s\S]*min-height:\s*46px;[\s\S]*#shopPurchaseModal \.shop-purchase-discount__input\s*\{[\s\S]*height:\s*38px;/,
        'quantity and coupon controls should be compact inside the purchase modal'
    );
    assert.match(
        shopStyles,
        /\/\* 20260524_SHOP_PURCHASE_SPLIT_2 \*\/[\s\S]*#shopPurchaseModal \.shop-purchase-body\s*\{[\s\S]*display:\s*flex;[\s\S]*#shopPurchaseModal \.shop-purchase-discount\s*\{[\s\S]*contain:\s*paint;[\s\S]*#shopPurchaseModal \.shop-purchase-discount__summary\s*\{[\s\S]*min-height:\s*42px;[\s\S]*#shopPurchaseModal \.shop-purchase-discount__fold\s*\{[\s\S]*grid-template-rows:\s*0fr;[\s\S]*pointer-events:\s*none;[\s\S]*visibility:\s*hidden;[\s\S]*transition:[\s\S]*grid-template-rows 260ms[\s\S]*#shopPurchaseModal \.shop-purchase-discount\.is-expanded \.shop-purchase-discount__fold\s*\{[\s\S]*grid-template-rows:\s*1fr;[\s\S]*pointer-events:\s*auto;[\s\S]*visibility:\s*visible;[\s\S]*#shopPurchaseModal \.shop-purchase-discount__fold-inner\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*will-change:\s*transform;[\s\S]*@media \(min-width: 901px\) \{[\s\S]*#shopPurchaseModal \.modal-content\s*\{[\s\S]*max-width:\s*1040px !important;[\s\S]*#shopPurchaseModal \.shop-purchase-body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(340px, 380px\);[\s\S]*#shopPurchaseModal \.shop-purchase-dock\s*\{[\s\S]*justify-content:\s*flex-start;[\s\S]*gap:\s*14px;[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-discount\s*\{[\s\S]*width:\s*100%;/,
        'wide purchase modal should use a roomier two-column checkout layout while preserving the mobile coupon drawer foundation'
    );
    assert.match(
        shopStyles,
        /@media \(min-width: 901px\) \{[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-discount__summary\s*\{[\s\S]*cursor:\s*default;[\s\S]*pointer-events:\s*none !important;[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-discount__summary::after\s*\{[\s\S]*content:\s*none;[\s\S]*display:\s*none;[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-discount__fold,[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-discount\.is-expanded \.shop-purchase-discount__fold\s*\{[\s\S]*grid-template-rows:\s*1fr;[\s\S]*opacity:\s*1;[\s\S]*visibility:\s*visible;[\s\S]*transition:\s*none;[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-discount__fold-inner,[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-discount\.is-expanded \.shop-purchase-discount__fold-inner\s*\{[\s\S]*transform:\s*none;[\s\S]*transition:\s*none;/,
        'wide purchase modal should keep the coupon area expanded and remove the close affordance from the checkout dock'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal \.shop-purchase-discount__summary\s*\{[\s\S]*height:\s*42px;[\s\S]*align-items:\s*center;[\s\S]*line-height:\s*1;[\s\S]*#shopPurchaseModal \.shop-purchase-discount__summary::after\s*\{[\s\S]*content:\s*"";[\s\S]*background-image:[\s\S]*linear-gradient\(currentColor, currentColor\)[\s\S]*transform:\s*translateY\(5px\);[\s\S]*#shopPurchaseModal \.shop-purchase-discount\.is-expanded \.shop-purchase-discount__summary::after\s*\{[\s\S]*transform:\s*translateY\(5px\) rotate\(45deg\);[\s\S]*#shopPurchaseModal \.shop-purchase-discount__label\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*line-height:\s*20px;[\s\S]*transform:\s*translateY\(3\.5px\);[\s\S]*#shopPurchaseModal \.shop-purchase-discount__summary-meta\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*line-height:\s*20px;[\s\S]*transform:\s*translateY\(3\.5px\);/,
        'collapsed coupon capsule text and optional badge should use an optical vertical center correction'
    );
    assert.match(
        shopStyles,
        /#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-stage-quantity\s*\{[\s\S]*justify-content:\s*center;[\s\S]*@media \(min-width: 901px\) \{[\s\S]*#shopPurchaseModal \.shop-purchase-stage-summary\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[\s\S]*border-top:\s*1px solid rgba\(148, 163, 184, 0\.16\);[\s\S]*#shopPurchaseModal \.shop-purchase-dock \.shop-purchase-stage-quantity\s*\{[\s\S]*min-height:\s*58px;[\s\S]*padding:\s*6px 0;[\s\S]*#shopPurchaseModal \.shop-purchase-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);/,
        'checkout dock should center the quantity stepper above a left-right aligned price row and side-by-side actions'
    );

    assert.match(
        shopClientSource,
        /isWidePurchaseModalLayout:\s*function \(\) \{[\s\S]*window\.matchMedia\('\(min-width: 901px\)'\)\.matches[\s\S]*syncPurchaseDiscountDetailsForLayout:\s*function \(\) \{[\s\S]*summary\?\.setAttribute\('aria-disabled', 'true'\);[\s\S]*summary\?\.setAttribute\('tabindex', '-1'\);[\s\S]*this\.expandPurchaseDiscountDetails\(details\);[\s\S]*togglePurchaseDiscountDetails:\s*function \(detailsEl\) \{[\s\S]*if \(this\.isWidePurchaseModalLayout\(\)\) \{[\s\S]*this\.expandPurchaseDiscountDetails\(details\);[\s\S]*return;[\s\S]*const isOpening = !details\.classList\.contains\('is-expanded'\);[\s\S]*window\.clearTimeout\(Number\(details\.dataset\.animationTimer \|\| 0\)\);[\s\S]*details\.open = true;[\s\S]*details\.classList\.remove\('is-expanded'\);[\s\S]*\}, isOpening \? 320 : 300\)\);/,
        'purchase coupon details should stay mounted on mobile but be forced open and non-interactive in wide layout'
    );

    assert.match(
        shopClientSource,
        /document\.querySelectorAll\('#shopPurchaseModal \.shop-purchase-discount'\)\.forEach\(\(details\) => \{[\s\S]*details\.classList\.remove\('is-expanded', 'is-animating', 'is-collapsing'\);[\s\S]*details\.open = true;[\s\S]*\}\);[\s\S]*this\.syncPurchaseDiscountDetailsForLayout\(\);/,
        'opening a purchase modal should reset the coupon drawer, then apply the wide-layout expanded default'
    );

    assert.match(
        shopClientSource,
        /const shouldDefaultGuidanceOpen = this\.isWidePurchaseModalLayout\(\);[\s\S]*const defaultPurchaseNotesExpanded = shouldDefaultGuidanceOpen && normalizedPurchaseNotes\.length > 0;[\s\S]*const defaultUsageInstructionsExpanded = shouldDefaultGuidanceOpen[\s\S]*&& !defaultPurchaseNotesExpanded[\s\S]*&& normalizedUsageInstructions\.length > 0;[\s\S]*purchaseGuidanceDisclosureTouched: false,[\s\S]*ensureDefaultPurchaseGuidanceDisclosure:\s*function \(\{ force = false \} = \{\}\) \{[\s\S]*const nextPurchaseNotesExpanded = hasPurchaseNotes;[\s\S]*const nextUsageInstructionsExpanded = !hasPurchaseNotes && hasUsageInstructions;/,
        'wide purchase modal should default exactly one guidance panel open, preferring purchase notes over usage instructions'
    );

    assert.match(
        shopClientSource,
        /event\.target\.closest\('#shopPurchaseModal \.shop-purchase-discount__summary'\)[\s\S]*this\.togglePurchaseDiscountDetails\([\s\S]*purchaseDiscountSummary\.closest\('\.shop-purchase-discount'\)/,
        'purchase coupon summary clicks should be intercepted so the custom accordion animation runs'
    );

    assert.match(
        shopClientSource,
        /shouldDockPurchaseModalForInput:\s*function\s*\(input, metrics = this\.getPurchaseModalViewportMetrics\(\)\) \{[\s\S]*const keyboardTop = Math\.max\(0, Math\.round\(\(metrics\.baseViewportHeight \|\| 0\) - bottomInset\)\);[\s\S]*return inputRect\.bottom > keyboardTop - bottomGuard;/,
        'purchase modal should only dock upward when the focused input would be covered by the keyboard'
    );

    assert.match(
        shopClientSource,
        /const needsKeyboardDock = !!activeInput && this\.shouldDockPurchaseModalForInput\(activeInput, metrics\);[\s\S]*const shouldDock = needsKeyboardDock && \(this\.purchaseModalKeyboardDocked \? bottomInset > 8 : bottomInset > 24\);[\s\S]*if \(!this\.shouldDockPurchaseModalForInput\(liveInput, liveMetrics\)\) return;/,
        'purchase modal should recheck focused-input coverage before running the first keyboard dock animation'
    );

    assert.match(
        shopClientSource,
        /getPurchaseModalNativeViewportFrame:\s*function \(\) \{[\s\S]*const visualTop = Math\.max\(0, vv\?\.offsetTop \|\| 0\);[\s\S]*const visualLeft = Math\.max\(0, vv\?\.offsetLeft \|\| 0\);[\s\S]*const overlayHeight = Math\.max\(320, Math\.round\([\s\S]*visualHeight[\s\S]*return \{[\s\S]*top: Math\.round\(visualTop\),[\s\S]*left: Math\.round\(visualLeft\),[\s\S]*width: visualWidth,[\s\S]*overlayHeight,/,
        'purchase modal should derive its overlay frame from visualViewport top/left/width/height'
    );

    assert.match(
        shopClientSource,
        /const visualWidth = Math\.max\(\s*1,\s*Math\.round\(vv\?\.width \|\| window\.innerWidth \|\| document\.documentElement\.clientWidth \|\| document\.body\?\.clientWidth \|\| 0\)\s*\);/,
        'purchase modal should use the live visual viewport width instead of pinning the overlay to a 320px minimum'
    );

    assert.doesNotMatch(
        shopClientSource,
        /const visualWidth = Math\.max\(320,/,
        'purchase modal should not keep the retired 320px viewport-width clamp that breaks narrow desktop windows'
    );

    assert.match(
        shopClientSource,
        /freezePurchaseModalPage:\s*function \(\) \{[\s\S]*const theme = this\.getCurrentThemeChromeMode\(\);[\s\S]*const themeColor = this\.getThemeChromeColor\(theme\);[\s\S]*document\.documentElement\.classList\.add\('shop-purchase-modal-lock'\);[\s\S]*document\.body\.classList\.add\('shop-purchase-modal-lock'\);[\s\S]*'--shop-purchase-theme-chrome-color': themeColor,[\s\S]*'--shop-purchase-lock-top': `-\$\{this\.purchaseModalBaseScrollY\}px`[\s\S]*metaTheme\.setAttribute\('data-shop-purchase-theme-lock', 'true'\);[\s\S]*metaTheme\.setAttribute\('data-mobile-theme-lock', 'true'\);[\s\S]*window\.applySiteThemeChrome\(theme, \{ forceRepaint: true \}\);[\s\S]*this\.stabilizePurchaseModalViewport\(\);/,
        'purchase modal should freeze the page and lock the iOS address-bar chrome to the current theme before opening'
    );

    assert.match(
        shopClientSource,
        /shouldUsePurchaseModalLightOpenLock:\s*function \(\) \{[\s\S]*return this\.shouldUseShopBackdropTouchFallback\(\);[\s\S]*freezePurchaseModalPage:\s*function \(\) \{[\s\S]*if \(this\.shouldUsePurchaseModalLightOpenLock\(\)\) return;[\s\S]*window\.iOSScrollLock\.lockLight\(modal, \{[\s\S]*restoreScrollDuringViewport: true/,
        'iOS Chrome purchase modal should use light scroll lock on open so background cards do not jump when opened from the page bottom'
    );

    assert.match(
        shopClientSource,
        /unfreezePurchaseModalPage:\s*function \(\) \{[\s\S]*document\.documentElement\.classList\.remove\('shop-purchase-modal-lock'\);[\s\S]*document\.body\.classList\.remove\('shop-purchase-modal-lock'\);[\s\S]*'--shop-purchase-theme-chrome-color': '',[\s\S]*metaTheme\.removeAttribute\('data-shop-purchase-theme-lock'\);[\s\S]*metaTheme\.removeAttribute\('data-mobile-theme-lock'\);[\s\S]*window\.applySiteThemeChrome\(theme, \{ forceRepaint: true \}\);/,
        'purchase modal should release its theme chrome lock immediately when closing'
    );

    assert.match(
        shopClientSource,
        /capturePurchaseModalOverlayHeight:\s*function \(force = false\) \{[\s\S]*const frame = this\.getPurchaseModalNativeViewportFrame\(\);[\s\S]*const measuredHeight = Math\.max\(0, Math\.round\(frame\.overlayHeight \|\| 0\)\);[\s\S]*const baseHeight = Math\.round\(this\.purchaseModalKeyboardBaseViewportHeight \|\| 0\);[\s\S]*const shouldPreserveForKeyboard = this\.purchaseModalKeyboardDocked \|\| !!this\.getActivePurchaseModalInput\(\);[\s\S]*const shouldPreserveKeyboardBase = overlay\.classList\.contains\('active'\)\s+&& shouldPreserveForKeyboard\s+&& baseHeight > measuredHeight;[\s\S]*const overlayHeight = shouldPreserveKeyboardBase \? baseHeight : measuredHeight;[\s\S]*'--shop-purchase-viewport-top': `\$\{frame\.top\}px`,[\s\S]*'--shop-purchase-viewport-left': `\$\{frame\.left\}px`,[\s\S]*'--shop-purchase-viewport-width': `\$\{frame\.width\}px`,[\s\S]*'--shop-purchase-overlay-height': `\$\{overlayHeight\}px`[\s\S]*if \(shouldPreserveKeyboardBase\) return;/,
        'purchase modal should preserve the pre-keyboard overlay height only while keyboard-related focus or docking is active'
    );

    assert.match(
        shopClientSource,
        /schedulePurchaseModalOpenViewportStabilization:\s*function \(\) \{[\s\S]*this\.schedulePurchaseModalViewportSync\(true\);[\s\S]*\[48, 140, 320\]\.forEach\(\(delayMs\) => \{[\s\S]*this\.syncPurchaseModalOverlayViewport\(true\);[\s\S]*this\.syncPurchaseModalKeyboardDock\(\);[\s\S]*detachPurchaseModalViewportSync:\s*function \(\) \{[\s\S]*this\.clearPurchaseModalOpenViewportStabilization\(\);/,
        'purchase modal should resample the iOS Chrome viewport after opening so the sheet recenters when browser chrome settles'
    );

    assert.match(
        shopClientSource,
        /schedulePurchaseModalViewportSync:\s*function \(force = false\) \{[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*this\.syncPurchaseModalOverlayViewport\(force\);[\s\S]*\}\);/,
        'purchase modal should coalesce live viewport resizes through one animation-frame sync'
    );

    assert.match(
        shopClientSource,
        /attachPurchaseModalViewportSync:\s*function \(\) \{[\s\S]*window\.addEventListener\('resize', handleViewportChange, \{ passive: true \}\);[\s\S]*window\.addEventListener\('orientationchange', handleViewportChange, \{ passive: true \}\);[\s\S]*window\.visualViewport\?\.addEventListener\('resize', handleViewportChange, \{ passive: true \}\);[\s\S]*window\.visualViewport\?\.addEventListener\('scroll', handleViewportChange, \{ passive: true \}\);/,
        'purchase modal should keep listening for desktop and visual viewport changes while it is open'
    );

    assert.equal(
        shopClientSource.includes('shop-purchase-chrome-fill'),
        false,
        'shop-client.js should not retain the retired artificial chrome fill runtime'
    );

    assert.match(
        shopClientSource,
        /modal\.classList\.remove\('shop-purchase-force-hidden'\);\s+modal\.hidden = false;\s+modal\.classList\.remove\('active'\);\s+this\.freezePurchaseModalPage\(\);\s+this\.capturePurchaseModalOverlayHeight\(true\);\s+if \(!this\.purchaseModalPageFrozen && window\.iOSScrollLock\) \{[\s\S]*window\.iOSScrollLock\.lockLight\(modal, \{[\s\S]*restoreScrollDuringViewport: true[\s\S]*modal\.classList\.add\('active'\);\s+this\.attachPurchaseModalViewportSync\(\);\s+this\.attachPurchaseModalKeyboardDock\(\);\s+this\.schedulePurchaseModalOpenViewportStabilization\(\);/,
        'purchase modal should freeze the iOS page and capture the visual viewport before the active overlay frame is painted'
    );

    assert.match(
        shopClientSource,
        /purchaseModalOpeningStabilityTimer: null,[\s\S]*beginPurchaseModalOpeningStability: function \(modal = document\.getElementById\('shopPurchaseModal'\)\) \{[\s\S]*modal\.classList\.add\('shop-purchase-opening-stable'\);[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*modal\.classList\.remove\('shop-purchase-opening-stable'\);[\s\S]*\}, 980\);[\s\S]*this\.bindPurchaseModalControlTapFallbacks\(\);\s+this\.resetPurchaseModalOpeningSettledStages\(modal\);\s+this\.markPurchaseModalOpeningStaggerStages\(modal\);\s+this\.beginPurchaseModalOpeningStability\(modal\);[\s\S]*void modal\.offsetHeight;[\s\S]*this\.schedulePurchaseModalOpenViewportStabilization\(\);[\s\S]*void this\.refreshPurchaseDiscountAssets\(\{ silent: true \}\);/,
        'purchase modal should silence async viewport, coupon, and guidance layout changes during the opening settle window'
    );

    assert.match(
        shopClientSource,
        /purchaseModalStageSettledTimer: null,[\s\S]*markPurchaseModalOpeningStaggerStages: function \(modal = document\.getElementById\('shopPurchaseModal'\)\) \{[\s\S]*element\.classList\.remove\('shop-purchase-stage--opening-stagger'\);[\s\S]*if \(element\.hidden\) return;[\s\S]*element\.classList\.add\('shop-purchase-stage--opening-stagger'\);[\s\S]*beginPurchaseModalStageSettledState: function \(modal = document\.getElementById\('shopPurchaseModal'\)\) \{[\s\S]*this\.purchaseModalStageSettledTimer = window\.setTimeout\(\(\) => \{[\s\S]*modal\.classList\.add\('shop-purchase-stages-settled'\);[\s\S]*element\.classList\.remove\('shop-purchase-stage--opening-stagger'\);[\s\S]*\}, 720\);[\s\S]*this\.markPurchaseModalOpeningStaggerStages\(modal\);\s+this\.beginPurchaseModalOpeningStability\(modal\);[\s\S]*modal\.classList\.add\('active'\);[\s\S]*this\.beginPurchaseModalStageSettledState\(modal\);[\s\S]*closePurchaseModal:[\s\S]*this\.clearPurchaseModalStageSettledState\(modal\);/,
        'purchase modal should only grant stagger animation to initially visible stages so late async content cannot replay the staggered rise'
    );

    assert.match(
        shopStyles,
        /#shopPurchaseModal\.active \.modal-content>\.shop-purchase-stage--opening-stagger,[\s\S]*#shopPurchaseModal\.active \.shop-purchase-dock>\.shop-purchase-stage--opening-stagger \{[\s\S]*animation: shopPurchaseStaggeredRise[\s\S]*#shopPurchaseModal\.shop-purchase-opening-stable \.modal-content,[\s\S]*#shopPurchaseModal\.shop-purchase-opening-stable\.active:not\(:focus-within\):not\(\.ios-focus-lock\):not\(\.keyboard-docked\) \.modal-content,[\s\S]*transition: none !important;[\s\S]*#shopPurchaseModal\.active \.shop-purchase-stage--opening-settled \{[\s\S]*animation: none !important;[\s\S]*#shopPurchaseModal\.active\.shop-purchase-stages-settled \.shop-purchase-dock>\.shop-purchase-stage \{[\s\S]*animation: none !important;[\s\S]*#shopPurchaseModal\.shop-purchase-opening-stable \.shop-purchase-discount__fold-inner \{[\s\S]*transition: none !important;/,
        'purchase modal opening settle styles should suppress the second visible squirm without disabling normal later interactions'
    );

    assert.match(
        shopClientSource,
        /closePurchaseModal:\s*function \(\) \{[\s\S]*activeInput\?\.blur\(\);[\s\S]*modal\.classList\.add\('shop-purchase-force-hidden'\);\s+modal\.hidden = true;\s+modal\.classList\.remove\('active'\);\s+void modal\.offsetHeight;[\s\S]*this\.detachPurchaseModalViewportSync\(\);[\s\S]*this\.detachPurchaseModalKeyboardDock\(\);[\s\S]*if \(this\.purchaseModalPageFrozen\) \{[\s\S]*this\.unfreezePurchaseModalPage\(\);/,
        'purchase modal should force-hide before cleanup and lock release so the address-bar white area disappears in the close frame'
    );

    assert.match(
        shopClientSource,
        /requestAnimationFrame\(\(\) => \{[\s\S]*this\.capturePurchaseModalOverlayHeight\(\);[\s\S]*this\.syncPurchaseModalKeyboardDock\(\);[\s\S]*\}\);/,
        'purchase modal should keep the native overlay height aligned while iOS Safari settles viewport changes'
    );

    assert.equal(
        shopClientSource.includes('getPurchaseModalStableViewportProbe'),
        false,
        'purchase modal should not use a 100svh stable viewport probe that can overrun the native address bar'
    );

    assert.match(
        shopClientSource,
        /renderPurchaseDiscountAssets:\s*function\s*\(\) \{[\s\S]*this\.schedulePurchaseModalKeyboardContentSync\(\);[\s\S]*this\.schedulePurchaseModalKeyboardContentSync\(\);[\s\S]*\},/,
        'discount asset rendering should resync the dock for both empty/loading and populated states'
    );
});
