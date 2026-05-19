const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('public pages preconnect to the KVM public API host', () => {
    [
        'index.html',
        'shop.html',
        'verify.html',
        'prompts.html',
        'guestbook.html'
    ].forEach((relativePath) => {
        const source = readRepoFile(relativePath);
        assert.equal(
            source.includes('<link rel="preconnect" href="https://verify-api.zaoyoe.com" crossorigin>'),
            true,
            `${relativePath} should preconnect to verify-api.zaoyoe.com`
        );
    });
});

test('wallet payment config uses direct public API, short browser cache, and same-origin fallback', () => {
    const walletSource = readRepoFile('js/components/WalletModal.js');

    [
        "const WALLET_PUBLIC_API_DEFAULT_BASE_URL = 'https://verify-api.zaoyoe.com';",
        'const WALLET_PAYMENT_CONFIG_BROWSER_CACHE_TTL_MS = 30000;',
        'getWalletPublicApiBaseUrl()',
        'buildWalletPublicApiUrl(\'/api/payments/config\'',
        'readPaymentConfigBrowserCache(site)',
        'writePaymentConfigBrowserCache(site, payload)',
        "credentials: url.startsWith('http') ? 'omit' : 'same-origin'",
        "console.warn('[WalletModal] Direct payment config fetch failed, retrying same-origin route:'",
        'void this.loadPaymentRuntimeConfig().then(() => {'
    ].forEach((marker) => {
        assert.equal(walletSource.includes(marker), true, `WalletModal.js should contain ${marker}`);
    });
});

test('shop catalog and homepage prefetches use the KVM public API fast path with fallback', () => {
    const shopClientSource = readRepoFile('js/shop-client.js');
    const homeBootstrapSource = readRepoFile('js/index-home-bootstrap.js');
    const prefetchHomeSource = readRepoFile('js/prefetch-home.js');
    const framerHomeSource = readRepoFile('js/framer_home.js');

    [
        "const SHOP_PUBLIC_API_DEFAULT_BASE_URL = 'https://verify-api.zaoyoe.com';",
        'const SHOP_CATALOG_BROWSER_CACHE_TTL_MS = 30000;',
        'buildShopPublicApiUrl(\'/api/shop/catalog\'',
        'readShopCatalogBrowserCache({',
        'writeShopCatalogBrowserCache({',
        "credentials: url.startsWith('http') ? 'omit' : 'same-origin'",
        "console.warn('Shop catalog direct API unavailable, falling back to same-origin route:'"
    ].forEach((marker) => {
        assert.equal(shopClientSource.includes(marker), true, `shop-client.js should contain ${marker}`);
    });

    assert.equal(homeBootstrapSource.includes('fetchShopCatalogPayload(currentSite)'), true);
    assert.equal(prefetchHomeSource.includes('fetchPublicShopCatalogPayload(getCurrentSite())'), true);
    assert.equal(framerHomeSource.includes('fetchHomepageShopCatalogPayload(getHomepageRuntimeSite())'), true);
});
