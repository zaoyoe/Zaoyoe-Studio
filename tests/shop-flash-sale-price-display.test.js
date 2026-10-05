const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop special-price cards and purchase modal make original and adjusted prices explicit', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));
    const shopHtmlSource = readRepoFile('shop.html');
    const zhLocaleSource = readRepoFile(path.join('lang', 'zh.json'));

    assert.match(
        shopClientSource,
        /shop-card-original-price shop-card-original-price--flash/,
        'flash-sale product cards should mark crossed-out original prices separately'
    );
    assert.match(
        shopCssSource,
        /\.shop-card-original-price--flash\s*\{[\s\S]*text-decoration-color:\s*#ef4444;/s,
        'flash-sale original-price strikethroughs should use a red line'
    );
    assert.match(
        shopClientSource,
        /buildFlashSaleBadgeHtml: function[\s\S]*flash-sale-badge__label[\s\S]*getFlashSaleBadgeLabel/,
        'flash-sale countdown badges should render a text label'
    );
    assert.doesNotMatch(
        shopClientSource,
        /data-shop-card-flash-badge="true"[\s\S]{0,220}<i class="fas fa-bolt"/,
        'flash-sale countdown badges should no longer render the lightning icon'
    );
    assert.match(
        shopHtmlSource,
        /id="modalPriceContextNote"/,
        'the purchase modal should include a reusable special-price note mount'
    );
    assert.match(
        shopClientSource,
        /unitPriceEl\.textContent = `\$\{this\.trShop\('flashSalePrice'/,
        'the primary modal unit-price line should carry the flash-sale price label'
    );
    assert.doesNotMatch(
        shopClientSource,
        /shop-purchase-price-note__sale/,
        'the modal flash-sale note should not repeat the sale price already shown on the primary unit-price line'
    );
    assert.match(
        shopClientSource,
        /hasFlashSale: flashSalePricing\.hasFlashSale,[\s\S]*flashSalePrice: flashSalePricing\.flashSalePrice,[\s\S]*flashSaleOriginalPrice: flashSalePricing\.flashSaleOriginalPrice,/,
        'purchase modal state should keep both original and flash-sale prices'
    );
    assert.match(
        shopClientSource,
        /if \(!this\.currentPurchase\.hasFlashSale\) \{[\s\S]*getTieredPricingContext\(\{/,
        'active flash-sale prices should stay authoritative over quantity-rule recalculation'
    );
    assert.match(
        shopClientSource,
        /buildTieredPricingBadgeHtml: function[\s\S]*data-shop-card-tier-badge="true"[\s\S]*getTieredPricingLabel/,
        'tiered-price product cards should render a dedicated tier badge'
    );
    assert.match(
        shopCssSource,
        /\.tier-badge-glass\s*\{[\s\S]*background:\s*rgba\(40,\s*40,\s*40,\s*0\.6\);[\s\S]*color:\s*#7dd3fc;/s,
        'tiered-price badges should use the same black glass capsule language as stock badges with distinct blue copy'
    );
    assert.doesNotMatch(
        shopClientSource,
        /shop-card-tier-price-hint/,
        'tiered-price product cards should not render an extra lowest-price hint under points'
    );
    assert.match(
        shopClientSource,
        /buildTieredPricingRulesHelpHtml: function[\s\S]*shop-tier-rules-help[\s\S]*aria-expanded="false"[\s\S]*shop-tier-rules-popover/s,
        'purchase modal should expose tiered pricing rules behind a help affordance'
    );
    assert.match(
        shopClientSource,
        /toggleTierRulesPopover: function[\s\S]*classList\.toggle\('is-open', shouldOpen\)/,
        'the tiered pricing help affordance should also open on click for touch screens'
    );
    assert.match(
        shopCssSource,
        /\.shop-tier-rules-popover-wrap:hover \.shop-tier-rules-popover,[\s\S]*\.shop-tier-rules-popover-wrap\.is-open \.shop-tier-rules-popover/s,
        'tiered pricing rules should be visible on hover or keyboard/click focus'
    );
    assert.match(
        shopClientSource,
        /getCurrentPurchaseTieredPricingContext: function[\s\S]*getTieredPricingContext\(\{/,
        'purchase modal should resolve tiered pricing from current quantity'
    );
    assert.match(
        shopClientSource,
        /else if \(tieredPricing\?\.activeRule\) \{[\s\S]*getTieredPricingLabel\(\)/,
        'the primary modal unit-price line should switch to a tiered-price label once a tier is active'
    );
    assert.match(
        zhLocaleSource,
        /"flashSaleBadge":\s*"秒杀"[\s\S]*"flashSalePrice":\s*"秒杀价"[\s\S]*"tieredPrice":\s*"阶梯价"[\s\S]*"tieredPriceRulesLabel":\s*"阶梯定价规则"/,
        'Chinese special-price copy should use the requested 秒杀 wording and tiered-price wording'
    );
});

test('shop purchase modal and list view expose explicit flash sale countdown and badges', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopListLayoutSource = readRepoFile(path.join('js', 'shop-list-layout.js'));
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));
    const shopListCssSource = readRepoFile(path.join('css', 'shop-list-layout.css'));
    const shopHtmlSource = readRepoFile('shop.html');

    assert.match(
        shopHtmlSource,
        /id="modalFlashSaleBanner"[\s\S]*class="[^"]*shop-purchase-flash-banner[^"]*"[\s\S]*data-shop-modal-flash-timer="true"/,
        'purchase modal must include a dedicated flash-sale countdown banner'
    );
    assert.match(
        shopClientSource,
        /renderPurchaseModalFlashSaleBanner: function/,
        'shop client must implement renderPurchaseModalFlashSaleBanner'
    );
    assert.match(
        shopClientSource,
        /formatFlashSaleRemainingTime: function/,
        'shop client must provide structured flash sale time formatting'
    );
    assert.match(
        shopCssSource,
        /\.shop-purchase-flash-banner\s*\{[\s\S]*\[data-theme="light"\] \.shop-purchase-flash-banner/,
        'purchase modal flash banner must adapt to both light and dark themes'
    );
    assert.doesNotMatch(
        shopListLayoutSource,
        /list-thumb__flash-tag/,
        'list view thumbnails should no longer display a flash lightning tag'
    );
    const listChipsFnMatch = shopListLayoutSource.match(/function listChipsMarkup[\s\S]*?return `<div class="list-chips">/);
    assert.ok(listChipsFnMatch, 'listChipsMarkup should exist');
    assert.doesNotMatch(
        listChipsFnMatch[0],
        /countdown-timer/,
        'list view flash chip should not display countdown timer'
    );
    assert.match(
        listChipsFnMatch[0],
        /list-chip--flash[\s\S]*list-chip--flash__icon[\s\S]*flash-sale-badge__label/,
        'list view flash chip should retain lightning icon and flash sale label'
    );

    const cardChipsFnMatch = shopClientSource.match(/buildShopProductCardChipsMarkup:\s*function[\s\S]*?return `<div class="list-chips">/);
    assert.ok(cardChipsFnMatch, 'buildShopProductCardChipsMarkup should exist');
    assert.doesNotMatch(
        cardChipsFnMatch[0],
        /countdown-timer/,
        'grid view card flash chip should not display countdown timer'
    );
    assert.match(
        cardChipsFnMatch[0],
        /list-chip--flash[\s\S]*list-chip--flash__icon[\s\S]*flash-sale-badge__label/,
        'grid view card flash chip should retain lightning icon and flash sale label'
    );
    assert.doesNotMatch(
        shopClientSource,
        /<div class="shop-card-image">[\s\S]*\$\{pricingState\.flashSaleBadgeHtml\}/,
        'grid card image should no longer render top-left flash badge'
    );
    assert.match(
        shopListLayoutSource,
        /list-row\$\{soldOut \? ' is-sold-out' : ''\}\$\{hasFlashSale \? ' is-flash-sale' : ''\}/,
        'list view rows should mark flash-sale items with is-flash-sale'
    );
    assert.match(
        shopListCssSource,
        /\.list-chip--flash\s*\{[\s\S]*html\[data-theme="dark"\] body\.shop-page \.list-chip--flash/,
        'list view flash chips must adapt to both light and dark themes'
    );
});

test('purchase modal flash sale banner is strictly isolated to products with active flash sale', () => {
    const shopHtmlSource = readRepoFile('shop.html');
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));

    assert.doesNotMatch(
        shopHtmlSource,
        /<div id="modalFlashSaleBanner"[^>]*data-purchase-step/,
        'modal flash sale banner must not bind to generic data-purchase-step so non-flash items stay hidden'
    );
    assert.doesNotMatch(
        shopHtmlSource,
        /shop-purchase-flash-banner__hint/,
        'modal flash sale banner must not include promo hint copy'
    );
    assert.match(
        shopClientSource,
        /if \(!isConfigStage \|\| !hasFlash \|\| !Number\.isFinite\(endTime\) \|\| now >= endTime\) \{[\s\S]*bannerEl\.hidden = true;[\s\S]*bannerEl\.style\.display = 'none';/,
        'renderPurchaseModalFlashSaleBanner must explicitly hide banner and set style.display to none when hasFlash is false'
    );
    assert.match(
        shopCssSource,
        /\.shop-purchase-flash-banner\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/,
        'css must enforce .shop-purchase-flash-banner[hidden] display none !important so flex never overrides hidden'
    );
    assert.match(
        shopHtmlSource,
        /<div class="shop-purchase-unit-price-sub">[\s\S]*<div id="modalPriceContextNote"[\s\S]*<div id="modalFlashSaleBanner"[^>]*class="[^"]*shop-purchase-flash-countdown-inline[^"]*"/,
        'modal flash sale countdown must be nested next to original price inside unit price sub-container'
    );
    assert.match(
        shopHtmlSource,
        /data-i18n="shop\.flashSaleDistanceEndsIn">距离结束<\/span>/,
        'modal flash sale countdown must display 距离结束 label'
    );
    assert.match(
        shopCssSource,
        /\.shop-inline-style-attr-17\.is-flash-sale,\s*#modalUnitPrice\.is-flash-sale\s*\{\s*color:\s*#ef4444\s*!important;\s*\}/,
        'modal unit price must display red font when flash sale is active in dark theme'
    );
    assert.match(
        shopCssSource,
        /html:not\(\[data-theme="dark"\]\)[^}]*#modalUnitPrice\.is-flash-sale\s*\{\s*color:\s*#dc2626\s*!important;\s*\}/,
        'modal unit price must display red font when flash sale is active in light theme'
    );
    assert.match(
        shopClientSource,
        /flashSalePrice < currentPrice[\s\S]*hasFlashSale = true;/,
        'resolveProductPricing must strictly require flashSalePrice < currentPrice before enabling hasFlashSale'
    );
    assert.match(
        shopClientSource,
        /selectPurchaseSku: function[\s\S]*getActiveFlashSalePricingContext\(productForPricing,\s*basePrice\)/,
        'selectPurchaseSku must validate flash sale using getActiveFlashSalePricingContext'
    );
    assert.doesNotMatch(
        shopCssSource,
        /#modalFlashSaleBanner\s*\{[^}]*display:\s*inline-flex\s*!important/s,
        'modal flash banner must not enforce display inline-flex with !important which prevents hiding for non-flash products'
    );
    assert.match(
        shopCssSource,
        /#modalFlashSaleBanner\[hidden\][\s\S]*display:\s*none\s*!important;/,
        'modal flash sale banner must have explicit [hidden] display none !important rule'
    );
    const shopListCssSource = readRepoFile(path.join('css', 'shop-list-layout.css'));
    assert.match(
        shopListCssSource,
        /\.list-price--inline \.list-price__original[\s\S]*display:\s*none\s*!important;/,
        'narrow window / mobile list view must hide original price inside inline price chip'
    );
});


