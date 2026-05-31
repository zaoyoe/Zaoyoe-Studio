const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homepageSourcePath = path.resolve(__dirname, '../js/framer_home.js');
const adminShopSourcePath = path.resolve(__dirname, '../js/admin-shop.js');
const shopClientSourcePath = path.resolve(__dirname, '../js/shop-client.js');
const uploadAvatarSourcePath = path.resolve(__dirname, '../supabase/functions/upload-avatar/index.ts');

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

    assert.match(optimizationBlock, /const \{ variant = '' \} = options;/);
    assert.match(source, /function normalizeShopProductImageAsset\(value\) \{/);
    assert.match(source, /const explicitVariantUrl = getShopProductImageAssetExplicitVariantUrl\(url, options\.variant \|\| ''\);/);
    assert.match(source, /function getZaoyoeAssetCdnOrigin\(\{ canonical = false \} = \{\}\) \{/);
    assert.match(source, /function normalizeShopProductCdnUrl\(url, options = \{\}\) \{/);
    assert.match(optimizationBlock, /const variantUrl = getShopImageVariantUrl\(trimmed, variant\);/);
    assert.match(optimizationBlock, /if \(variantUrl\) \{\s*return variantUrl;\s*\}/);
    assert.match(optimizationBlock, /if \(isSupabaseStorageImageUrl\(trimmed\)\) \{\s*return '';\s*\}/);
    assert.doesNotMatch(optimizationBlock, /storage\/v1\/render\/image\/public/);
    assert.match(source, /function buildShopProductImageCacheVersion\(product = \{\}\) \{/);
    assert.match(source, /function appendShopImageUrlVersion\(url, version = ''\) \{/);
    assert.match(source, /const primaryUrl = appendShopImageUrlVersion\(\s*this\.getOptimizedShopImageUrl\(originalUrl, \{ variant: 'card' \}\),\s*version\s*\);/);
    assert.match(source, /data-home-shop-image="1"/);
    assert.match(source, /data-home-shop-image-version="\$\{escapeHomeHtml\(productImageCacheVersion\)\}"/);
    assert.match(source, /this\.setHomeShopCardImageSource\(image, imageAsset\);/);
    assert.match(source, /this\.handleHomeShopCardImageError\(image, imageAsset\)/);
    assert.doesNotMatch(source, /data-home-replace-parent-icon="1"/);
});

test('admin shop product cards use the storefront shop image optimization contract', () => {
    const source = fs.readFileSync(adminShopSourcePath, 'utf8');
    const shopClientSource = fs.readFileSync(shopClientSourcePath, 'utf8');
    const uploadAvatarSource = fs.readFileSync(uploadAvatarSourcePath, 'utf8');
    const optimizationBlock = sliceSourceBetween(
        source,
        'getOptimizedShopImageUrl: function (url, options = {}) {',
        'setProductCardImageSource: function (cardImage, originalUrl, options = {}) {'
    );

    assert.match(optimizationBlock, /const \{ variant = '' \} = options;/);
    assert.match(source, /function normalizeShopProductImageAsset\(value\) \{/);
    assert.match(source, /function getShopProductImageAsset\(productOrAsset = \{\}\) \{/);
    assert.match(source, /function buildShopProductImageAssetForSave\(iconUrl, existingAsset = null\) \{/);
    assert.match(source, /function getZaoyoeAssetCdnOrigin\(\{ canonical = false \} = \{\}\) \{/);
    assert.match(source, /function normalizeShopProductCdnUrl\(url, options = \{\}\) \{/);
    assert.match(optimizationBlock, /const cardVariantUrl = getShopProductR2CardVariantUrl\(trimmed\);/);
    assert.match(optimizationBlock, /if \(isSupabaseStorageImageUrl\(trimmed\)\) \{\s*return '';\s*\}/);
    assert.doesNotMatch(optimizationBlock, /storage\/v1\/render\/image\/public/);
    assert.match(source, /function buildShopProductImageCacheVersion\(product = \{\}\) \{/);
    assert.match(source, /function appendShopImageUrlVersion\(url, version = ''\) \{/);
    assert.match(source, /const primaryUrl = appendShopImageUrlVersion\(\s*this\.getOptimizedShopImageUrl\(originalUrl, \{ variant: 'card' \}\),\s*version\s*\);/);
    assert.match(source, /data-shop-product-image="1"/);
    assert.match(source, /const productImageCacheVersion = buildShopProductImageCacheVersion\(p\);/);
    assert.match(source, /this\.setProductCardImageSource\(productImage, productImageAsset \|\| productImageOriginalUrl, \{\s*version: productImageCacheVersion\s*\}\);/);
    assert.match(source, /this\.handleProductCardImageError\(productImage, productImageAsset \|\| productImageOriginalUrl\)/);
    assert.match(source, /image_assets: imageAsset,/);
    assert.match(source, /replaceProductCardImageWithFallback: function \(cardImage\) \{/);
    assert.match(source, /const SHOP_PRODUCT_IMAGE_CARD_WIDTH = 480;/);
    assert.match(source, /cardImageData = await this\.blobToDataUrl\(cardBlob\);/);
    assert.match(source, /fit: 'cover'/);
    assert.match(shopClientSource, /function normalizeShopProductImageAsset\(value\) \{/);
    assert.match(shopClientSource, /function getZaoyoeAssetCdnOrigin\(\{ canonical = false \} = \{\}\) \{/);
    assert.match(shopClientSource, /function normalizeShopProductCdnUrl\(url, options = \{\}\) \{/);
    assert.match(shopClientSource, /const explicitVariantUrl = getShopProductImageAssetExplicitVariantUrl\(url, options\.variant \|\| ''\);/);
    assert.match(shopClientSource, /function getShopResponsiveR2CardVariantUrl\(url, variant = ''\) \{/);
    assert.match(shopClientSource, /return `\$\{getZaoyoeAssetCdnOrigin\(\{ canonical: true \}\)\}\/products\/card\/\$\{encodeURIComponent\(basename\)\}\.webp`;/);
    assert.match(uploadAvatarSource, /cardImageData\?: string/);
    assert.match(uploadAvatarSource, /const cardFilename = `products\/card\/\$\{productKeyBase\}\.webp`/);
    assert.match(uploadAvatarSource, /imageAsset/);
    assert.match(uploadAvatarSource, /ContentType: 'image\/webp'/);
});
