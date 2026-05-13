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
