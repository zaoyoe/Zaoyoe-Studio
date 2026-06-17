const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('cart flow preserves selected discount snapshots from purchase modal through checkout', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const shopCssSource = readRepoFile(path.join('css', 'shop-page.css'));

    assert.match(
        shopClientSource,
        /addCurrentPurchaseToCart: function \(\) \{[\s\S]*appliedDiscount: this\.buildCurrentPurchaseCartDiscountSnapshot\(\)/,
        'adding the configured purchase into the cart should persist the currently selected coupon snapshot'
    );
    assert.match(
        shopClientSource,
        /buildCartProductSnapshot: function \(product, options = \{\}\) \{[\s\S]*applied_discount: normalizedAppliedDiscount/,
        'cart snapshots should retain the applied discount payload alongside the product snapshot'
    );
    assert.match(
        shopClientSource,
        /getCartEntries: function \(\) \{[\s\S]*totalPoints: appliedDiscount \? finalTotal : subtotal,[\s\S]*appliedDiscount,/,
        'cart entries should switch their displayed total to the discounted payable amount when a coupon is attached'
    );
    assert.match(
        shopClientSource,
        /openPurchaseModalFromCartEntry: function \(entry\) \{[\s\S]*appliedDiscount: entry\.appliedDiscount \|\| null,/,
        'reopening a cart item should pass its preserved coupon snapshot back into the purchase modal'
    );
    assert.match(
        shopClientSource,
        /confirmCartCheckout: async function \(\) \{[\s\S]*discountCode: entry\.appliedDiscount\?\.code \|\| null,[\s\S]*discountAssetId: entry\.appliedDiscount\?\.assetId \|\| null,/,
        'cart checkout should forward the preserved coupon identifiers for each cart item'
    );
    assert.match(
        shopClientSource,
        /normalizeCartDiscountSnapshot: function \(discount = null, options = \{\}\) \{[\s\S]*options\.quantity[\s\S]*\?\? discount\.quantity[\s\S]*options\.subtotal[\s\S]*\?\? discount\.subtotal/s,
        'cart discount snapshots should prefer the latest cart quantity and subtotal when items are adjusted'
    );
    assert.match(
        shopClientSource,
        /resolveCartDiscountPricing: function \(discount = null, subtotal = 0\) \{[\s\S]*calculateDiscountPricingForConfig\(normalizedSubtotal,[\s\S]*discount\.discountAmount[\s\S]*discount\.finalTotal/s,
        'cart pricing should fall back to stored discount summary totals when a multi-coupon snapshot has no single-coupon config'
    );
    assert.match(
        shopClientSource,
        /updateCartQuantity: function \(productId, nextQuantity\) \{[\s\S]*normalizeCartDiscountSnapshot\(this\.cartSnapshots\?\.\[normalizedId\]\?\.applied_discount \|\| null,\s*\{[\s\S]*quantity:\s*normalizedQuantity[\s\S]*\}\)/s,
        'changing the cart quantity should keep and normalize the stored discount snapshot instead of dropping it'
    );
    assert.match(
        shopClientSource,
        /getCartEntries: function \(\) \{[\s\S]*const shouldApplyDiscount = Boolean\(rawAppliedDiscount\);[\s\S]*this\.resolveCartDiscountPricing\(rawAppliedDiscount, subtotal\)/s,
        'cart totals should continue applying the stored coupon summary after quantity adjustments'
    );
    assert.match(
        shopCssSource,
        /\.shop-cart-item__pill--discount,[\s\S]*\.shop-cart-checkout__item-pill--discount/,
        'shop-page.css should style the dedicated cart discount pill so preserved coupons remain visible in the cart UI'
    );
});

test('shop client local discount pricing allows zero percent settlement coupons', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));

    assert.match(
        shopClientSource,
        /calculateDiscountPricingForConfig: function \(subtotal, \{[\s\S]*discountType = '',[\s\S]*discountValue = null[\s\S]*\} = \{\}\) \{[\s\S]*normalizedDiscountType === 'percent' \? normalizedDiscountValue < 0 : normalizedDiscountValue <= 0/s,
        'local shop pricing should allow percent discount_value 0 while keeping fixed coupons positive'
    );
    assert.match(
        shopClientSource,
        /calculateDiscountPricing: function \(subtotal\) \{[\s\S]*discountType === 'percent' \? discountValue < 0 : discountValue <= 0/s,
        'active purchase pricing should also treat 0 as valid for percent coupons'
    );
});
