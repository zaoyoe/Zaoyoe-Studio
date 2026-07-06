const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function readVercelConfig() {
    return JSON.parse(readRepoFile('vercel.json'));
}

function getHeaderValue(entry = {}, key = '') {
    const headers = Array.isArray(entry?.headers) ? entry.headers : [];
    const match = headers.find((header) => header?.key === key);
    return match ? String(match.value || '') : '';
}

test('vercel cache policy keeps admin shells and APIs uncached while allowing versioned static assets to reuse browser cache', () => {
    const config = readVercelConfig();
    const headers = Array.isArray(config.headers) ? config.headers : [];
    const shopHandlerSource = readRepoFile('server/api-handlers/public/shop.js');

    const apiAdminRule = headers.find((entry) => entry?.source === '/api/admin/:path*');
    const apiAuthRule = headers.find((entry) => entry?.source === '/api/auth/:path*');
    const apiPublicRule = headers.find((entry) => entry?.source === '/api/public');
    const apiShopRule = headers.find((entry) => entry?.source === '/api/shop/:path*');
    const adminStudioRule = headers.find((entry) => entry?.source === '/admin-studio');
    const adminStudioHtmlRule = headers.find((entry) => entry?.source === '/admin-studio.html');
    const adminEntryRule = headers.find((entry) => entry?.source === '/admin-entry');
    const authCallbackRule = headers.find((entry) => entry?.source === '/auth-callback');
    const authPopupCloseRule = headers.find((entry) => entry?.source === '/auth-popup-close');
    const authPopupCloseHtmlRule = headers.find((entry) => entry?.source === '/auth-popup-close.html');
    const smokeNotificationsRule = headers.find((entry) => entry?.source === '/smoke-notifications');
    const swRule = headers.find((entry) => entry?.source === '/sw.js');
    const vendorRule = headers.find((entry) => entry?.source === '/vendor/:path*');
    const versionedJsRule = headers.find((entry) => entry?.source === '/:path*.js');
    const versionedCssRule = headers.find((entry) => entry?.source === '/:path*.css');
    const globalRule = headers.find((entry) => entry?.source === '/(.*)');

    assert.ok(apiAdminRule, 'vercel.json should keep an explicit API admin cache rule');
    assert.equal(getHeaderValue(apiAdminRule, 'Cache-Control'), 'no-store, max-age=0');
    assert.ok(apiAuthRule, 'vercel.json should keep an explicit API auth cache rule');
    assert.equal(getHeaderValue(apiAuthRule, 'Cache-Control'), 'no-store, max-age=0');
    assert.equal(apiPublicRule, undefined, 'vercel.json must not cache the shared /api/public dispatcher broadly');
    assert.equal(apiShopRule, undefined, 'vercel.json must not cache mixed public/authenticated shop APIs broadly');
    assert.match(shopHandlerSource, /res\.setHeader\('Cache-Control', 'public, max-age=60, s-maxage=300/);
    assert.match(shopHandlerSource, /function setPrivateApiCache\(res\)/);
    assert.match(shopHandlerSource, /res\.setHeader\('Cache-Control', 'no-store, max-age=0'\)/);

    assert.ok(adminStudioRule, 'vercel.json should keep admin-studio uncached');
    assert.equal(getHeaderValue(adminStudioRule, 'Cache-Control'), 'no-store, max-age=0');
    assert.ok(adminStudioHtmlRule, 'vercel.json should keep direct admin-studio.html uncached');
    assert.equal(getHeaderValue(adminStudioHtmlRule, 'Cache-Control'), 'no-store, max-age=0');

    assert.ok(adminEntryRule, 'vercel.json should keep the admin entry shell uncached');
    assert.equal(getHeaderValue(adminEntryRule, 'Cache-Control'), 'no-store, max-age=0');
    assert.ok(authCallbackRule, 'vercel.json should keep the auth callback shell uncached');
    assert.equal(getHeaderValue(authCallbackRule, 'Cache-Control'), 'no-store, max-age=0');
    assert.ok(authPopupCloseRule, 'vercel.json should keep a dedicated popup close shell cache rule');
    assert.equal(getHeaderValue(authPopupCloseRule, 'Cache-Control'), 'public, max-age=600, stale-while-revalidate=300');
    assert.ok(authPopupCloseHtmlRule, 'vercel.json should keep a dedicated popup close html cache rule');
    assert.equal(getHeaderValue(authPopupCloseHtmlRule, 'Cache-Control'), 'public, max-age=600, stale-while-revalidate=300');
    assert.ok(smokeNotificationsRule, 'vercel.json should keep the smoke notification shell uncached');
    assert.equal(getHeaderValue(smokeNotificationsRule, 'Cache-Control'), 'no-store, max-age=0');
    assert.ok(swRule, 'vercel.json should keep the service worker uncached');
    assert.equal(getHeaderValue(swRule, 'Cache-Control'), 'no-store, max-age=0');

    assert.ok(vendorRule, 'vercel.json should cache version-pinned first-party vendor assets');
    assert.equal(getHeaderValue(vendorRule, 'Cache-Control'), 'public, max-age=31536000, immutable');

    assert.ok(versionedJsRule, 'vercel.json should define a versioned JavaScript cache rule');
    assert.deepEqual(versionedJsRule.has, [{ type: 'query', key: 'v' }]);
    assert.equal(getHeaderValue(versionedJsRule, 'Cache-Control'), 'public, max-age=31536000, immutable');

    assert.ok(versionedCssRule, 'vercel.json should define a versioned stylesheet cache rule');
    assert.deepEqual(versionedCssRule.has, [{ type: 'query', key: 'v' }]);
    assert.equal(getHeaderValue(versionedCssRule, 'Cache-Control'), 'public, max-age=31536000, immutable');

    assert.ok(globalRule, 'vercel.json should keep the global security headers rule');
    assert.equal(getHeaderValue(globalRule, 'Cache-Control'), '', 'Global catch-all security headers should not force a cache policy');
    const contentSecurityPolicy = getHeaderValue(globalRule, 'Content-Security-Policy');
    assert.equal(contentSecurityPolicy.includes("default-src 'self'"), true);
    assert.equal(
        contentSecurityPolicy.includes("media-src 'self' data: blob: https:"),
        true,
        'CSP should allow AI workbench videos to load from HTTPS/CDN media URLs'
    );
});
