const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop realtime catalog refresh bypasses stale HTTP and worker caches', () => {
    const shopClient = readRepoFile('js/shop-client.js');
    const serviceWorker = readRepoFile('sw.js');
    const shopHtml = readRepoFile('shop.html');

    assert.match(
        shopClient,
        /catalogParams\.set\('refresh', String\(Date\.now\(\)\)\);/,
        'force refreshes should use a unique catalog URL so CDN cache entries are not reused'
    );
    assert.match(
        shopClient,
        /cache: forceRefresh \? 'no-store' : 'default'/,
        'force refreshes should ask the browser not to reuse cached catalog responses'
    );
    assert.match(
        shopClient,
        /const SHOP_REALTIME_FALLBACK_REFRESH_MS = 30000;/,
        'storefront realtime should have a bounded fallback refresh cadence'
    );
    assert.match(
        shopClient,
        /this\.scheduleShopRealtimeCatalogRefresh\(`\$\{reason\}_snapshot`\);/,
        'a degraded realtime channel should take an immediate fresh catalog snapshot'
    );
    assert.match(
        shopClient,
        /this\.scheduleStorefrontRealtimeFallbackCatalogRefresh\(reason\);/,
        'a degraded realtime channel should continue refreshing while websocket delivery is unavailable'
    );
    assert.match(
        shopClient,
        /'Cache-Control': 'no-cache'/,
        'force refreshes should send no-cache request headers for intermediaries that honor them'
    );
    assert.match(
        serviceWorker,
        /url\.pathname\.startsWith\('\/api\/'\)/,
        'the service worker should recognize dynamic API requests'
    );
    assert.match(
        serviceWorker,
        /isApiRequest \|\| event\.request\.cache === 'no-store'/,
        'the service worker should not satisfy API or no-store requests from its static cache'
    );
    assert.equal(
        shopHtml.includes('js/shop-client.js?v=20260513_SHOP_MOBILE_TAP_FALLBACK_1'),
        true,
        'shop.html should cache-bust the realtime catalog refresh runtime'
    );
});
