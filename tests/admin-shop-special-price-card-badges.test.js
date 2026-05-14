const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('admin shop product cards mirror storefront special price badges', () => {
    const shopSource = readFile('js/admin-shop.js');
    const stylesSource = readFile('css/admin-studio-page.css');
    const adminHtml = readFile('admin-studio.html');

    assert.match(
        shopSource,
        /isAdminProductFlashSaleActive: function[\s\S]*marketingFields\.flashSalePrice[\s\S]*marketingFields\.flashSaleEnd[\s\S]*Date\.now\(\)/,
        'admin cards should only mark flash-sale products while the flash sale is active'
    );
    assert.match(
        shopSource,
        /SITE_MARKETING_FIELD_MAP:[\s\S]*quantity_rules_intl[\s\S]*flash_sale_price_intl[\s\S]*flash_sale_end_intl/,
        'admin cards should know the site-scoped INTL marketing fields'
    );
    assert.match(
        shopSource,
        /getAdminProductDiscountTierRules: function[\s\S]*marketingFields\.quantityRules[\s\S]*rule\)\s*=>\s*rule\.price < basePrice/,
        'admin cards should only mark tier pricing when a rule discounts the current site price'
    );
    assert.match(
        shopSource,
        /buildAdminProductSpecialPriceBadgeHtml: function[\s\S]*shop-admin-product-special-badge--flash[\s\S]*秒杀/,
        'admin cards should render the flash-sale capsule'
    );
    assert.match(
        shopSource,
        /buildAdminProductSpecialPriceBadgeHtml: function[\s\S]*shop-admin-product-special-badge--tier[\s\S]*阶梯价/,
        'admin cards should render the tiered-pricing capsule'
    );
    assert.match(
        shopSource,
        /\$\{specialPriceBadgeHtml\}[\s\S]*product-checkbox-wrapper/,
        'special price capsules should live on the product cover before the selection checkbox'
    );

    assert.match(
        stylesSource,
        /\.shop-admin-product-special-badge\s*\{[\s\S]*background:\s*rgba\(10,\s*14,\s*22,\s*0\.68\)[\s\S]*backdrop-filter:\s*blur\(14px\) saturate\(135%\)/,
        'admin special price capsules should share the black glass treatment'
    );
    assert.match(
        stylesSource,
        /\.shop-admin-product-special-badge--flash\s*\{[\s\S]*color:\s*#fb7185/,
        'flash-sale capsule should use the distinct flash-sale color'
    );
    assert.match(
        stylesSource,
        /\.shop-admin-product-special-badge--tier\s*\{[\s\S]*color:\s*#7dd3fc/,
        'tiered-pricing capsule should use the distinct tier color'
    );
    assert.match(
        stylesSource,
        /shop-admin-products-grid--selection-mode \.shop-admin-product-special-badge\s*\{[\s\S]*top:\s*46px/,
        'special price capsules should move down when bulk selection is active'
    );

    assert.equal(
        adminHtml.includes('shopPriceBadges=20260513_ADMIN_SHOP_PRICE_BADGES_1'),
        true,
        'admin-studio.html should cache-bust the admin CSS for product price badges'
    );
    assert.equal(
        adminHtml.includes('adminPriceBadges=20260513_ADMIN_SHOP_PRICE_BADGES_1'),
        true,
        'admin-studio.html should cache-bust the admin shop script for product price badges'
    );
});
