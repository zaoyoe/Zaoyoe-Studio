const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homepageSourcePath = path.resolve(__dirname, '../js/framer_home.js');
const adminShopSourcePath = path.resolve(__dirname, '../js/admin-shop.js');

function sliceSourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

test('homepage shop carousel uses the storefront shop image optimization contract', () => {
    const source = fs.readFileSync(homepageSourcePath, 'utf8');
    const optimizationBlock = sliceSourceBetween(
        source,
        'getOptimizedShopImageUrl(url, options = {}) {',
        'setHomeShopCardImageSource(cardImage, originalUrl) {'
    );

    assert.match(optimizationBlock, /const \{ format = 'avif' \} = options;/);
    assert.match(optimizationBlock, /optimizedUrl\.searchParams\.set\('width', '480'\);/);
    assert.match(optimizationBlock, /optimizedUrl\.searchParams\.set\('height', '320'\);/);
    assert.match(optimizationBlock, /optimizedUrl\.searchParams\.set\('quality', '80'\);/);
    assert.match(source, /data-home-shop-image="1"/);
    assert.match(source, /this\.setHomeShopCardImageSource\(image, originalSrc\);/);
    assert.match(source, /this\.handleHomeShopCardImageError\(image, originalSrc\)/);
    assert.doesNotMatch(source, /data-home-replace-parent-icon="1"/);
});

test('admin shop product cards use the storefront shop image optimization contract', () => {
    const source = fs.readFileSync(adminShopSourcePath, 'utf8');
    const optimizationBlock = sliceSourceBetween(
        source,
        'getOptimizedShopImageUrl: function (url, options = {}) {',
        'setProductCardImageSource: function (cardImage, originalUrl) {'
    );

    assert.match(optimizationBlock, /const \{ format = 'avif' \} = options;/);
    assert.match(optimizationBlock, /optimizedUrl\.searchParams\.set\('width', '480'\);/);
    assert.match(optimizationBlock, /optimizedUrl\.searchParams\.set\('height', '320'\);/);
    assert.match(optimizationBlock, /optimizedUrl\.searchParams\.set\('quality', '80'\);/);
    assert.match(source, /data-shop-product-image="1"/);
    assert.match(source, /this\.setProductCardImageSource\(productImage, p\.icon_url\);/);
    assert.match(source, /this\.handleProductCardImageError\(productImage, p\.icon_url\)/);
    assert.match(source, /replaceProductCardImageWithFallback: function \(cardImage\) \{/);
});
