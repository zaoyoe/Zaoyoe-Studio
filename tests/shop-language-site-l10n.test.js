const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function loadSiteConfigForUrl(rawUrl) {
    const pageUrl = new URL(rawUrl);
    const window = {
        location: {
            search: pageUrl.search,
            hostname: pageUrl.hostname,
            origin: pageUrl.origin
        }
    };

    vm.runInNewContext(readRepoFile('js/site-config.js'), {
        window,
        document: { documentElement: { lang: '' } },
        console: { log() {}, warn() {}, debug() {} },
        URL,
        URLSearchParams
    });

    return window.SiteConfig;
}

test('shop runtime derives points label from current language instead of site', () => {
    const siteConfigSource = readRepoFile('js/site-config.js');
    const shopClientSource = readRepoFile('js/shop-client.js');

    assert.match(
        siteConfigSource,
        /window\.i18n\?\.getCurrentLanguage\?\.\(\)/,
        'SiteConfig.getPointsLabel should prioritize the current i18n language'
    );
    assert.match(
        shopClientSource,
        /getShopPointsLabel: function \(\{ lowercaseEnglish = false \} = \{\}\)/,
        'shop client should keep a shared helper for localized points labels'
    );
    assert.doesNotMatch(
        shopClientSource,
        /window\.SiteConfig\?\.getPointsLabel\(\) \|\| window\.i18n\?\.t\('shop\.points'\) \|\| '积分'/,
        'shop client should not keep a site-biased inline fallback for points labels'
    );
});

test('site config keeps shared image records canonical while exposing intl CDN display origins', () => {
    const siteConfigSource = readRepoFile('js/site-config.js');
    const shopClientSource = readRepoFile('js/shop-client.js');
    const framerHomeSource = readRepoFile('js/framer_home.js');
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    assert.match(siteConfigSource, /intl: 'https:\/\/cdn\.zaoyoe\.xyz'/);
    assert.match(siteConfigSource, /getCanonicalAssetCdnOrigin: function \(\)/);
    assert.match(siteConfigSource, /normalizeAssetUrlForCurrentSite: function \(url\)/);
    assert.match(
        shopClientSource,
        /function normalizeShopProductCdnUrl\(url, options = \{\}\) \{[\s\S]*canonical: options\.canonical !== false/,
        'shop storefront product images should stay on canonical R2 CDN by default'
    );
    assert.match(
        shopClientSource,
        /return `\$\{getZaoyoeAssetCdnOrigin\(\{ canonical: true \}\)\}\/products\/card/,
        'shop storefront generated card variants should stay on canonical R2 CDN'
    );
    assert.match(framerHomeSource, /getZaoyoeAssetCdnOrigin\(\)/);
    assert.match(chatWidgetSource, /window\.SiteConfig\?\.normalizeAssetUrlForCurrentSite\?\.\(parsed\.href\)/);
    assert.ok(
        adminStudioHtml.indexOf('./js/site-config.js?v=20260528_AVATAR_CANONICAL_CDN_1') < adminStudioHtml.indexOf('admin-studio.js?v='),
        'admin studio should load site config before admin gallery image rendering'
    );
    assert.ok(
        adminStudioHtml.indexOf('./js/site-config.js?v=20260528_AVATAR_CANONICAL_CDN_1') < adminStudioHtml.indexOf('js/admin-shop.js?v='),
        'admin studio should load site config before admin shop image rendering'
    );
});

test('site config retires legacy service worker caches before they can pin stale shells', () => {
    const siteConfigSource = readRepoFile('js/site-config.js');
    const indexSource = readRepoFile('index.html');

    assert.match(
        siteConfigSource,
        /LEGACY_SERVICE_WORKER_CACHE_RE = \/\^\(\?:prompts-gallery\|static\|images\)-v\/i/,
        'SiteConfig should target the historical service worker cache families'
    );
    assert.match(
        siteConfigSource,
        /navigator\.serviceWorker\.getRegistrations\(\)/,
        'SiteConfig should find existing same-origin service worker registrations'
    );
    assert.match(
        siteConfigSource,
        /registration\.unregister\(\)/,
        'SiteConfig should unregister legacy same-origin service workers'
    );
    assert.match(
        siteConfigSource,
        /window\.caches\.delete\(cacheName\)/,
        'SiteConfig should delete stale Cache Storage entries'
    );
    assert.ok(
        indexSource.includes('./js/site-config.js?v=20260528_AVATAR_CANONICAL_CDN_1'),
        'homepage should cache-bust the service worker retirement runtime'
    );
});

test('site config rewrites canonical image CDN records to intl display origins at runtime', () => {
    const intlConfig = loadSiteConfigForUrl('https://zaoyoe.xyz/shop.html?site=intl');
    const cnConfig = loadSiteConfigForUrl('https://zaoyoe.com/shop.html');

    assert.equal(intlConfig.site, 'intl');
    assert.equal(intlConfig.getAssetCdnOrigin(), 'https://cdn.zaoyoe.xyz');
    assert.equal(intlConfig.getCanonicalAssetCdnOrigin(), 'https://cdn.fatherkey.com');
    assert.equal(
        intlConfig.normalizeAssetUrlForCurrentSite('https://cdn.fatherkey.com/products/product_1775982177111.jpg'),
        'https://cdn.zaoyoe.xyz/products/product_1775982177111.jpg'
    );
    assert.equal(
        intlConfig.normalizeAssetUrlForCurrentSite('https://cdn.fatherkey.com/avatars/user_1775982177111.webp'),
        'https://cdn.fatherkey.com/avatars/user_1775982177111.webp'
    );
    assert.equal(
        intlConfig.normalizeAssetUrlForCurrentSite('https://cdn.zaoyoe.com/avatars/user_1775982177111.webp'),
        'https://cdn.fatherkey.com/avatars/user_1775982177111.webp'
    );
    assert.equal(
        intlConfig.normalizeAssetUrlForCurrentSite('https://legacy-public.r2.dev/prompts/example.webp?size=card'),
        'https://cdn.zaoyoe.xyz/prompts/example.webp?size=card'
    );
    assert.equal(
        intlConfig.normalizeAssetUrlForCanonicalSite('https://cdn.zaoyoe.xyz/chat/thread/image.webp'),
        'https://cdn.fatherkey.com/chat/thread/image.webp'
    );
    assert.equal(
        intlConfig.normalizeAssetUrlForCurrentSite('https://example.com/products/product_1775982177111.jpg'),
        'https://example.com/products/product_1775982177111.jpg'
    );
    assert.equal(intlConfig.getGongyiOrigin(), 'https://sub2api.zaoyoe.xyz');
    assert.equal(
        intlConfig.normalizeGongyiUrlForCurrentSite('https://sub2api.fatherkey.com/dashboard?tab=keys#top'),
        'https://sub2api.zaoyoe.xyz/dashboard?tab=keys#top'
    );

    assert.equal(cnConfig.site, 'cn');
    assert.equal(cnConfig.getGongyiOrigin(), 'https://sub2api.fatherkey.com');
    assert.equal(
        cnConfig.normalizeAssetUrlForCurrentSite('https://cdn.zaoyoe.xyz/prompts/example.webp'),
        'https://cdn.fatherkey.com/prompts/example.webp'
    );
    assert.equal(
        cnConfig.normalizeAssetUrlForCurrentSite('https://cdn.zaoyoe.xyz/avatars/user_1775982177111.webp'),
        'https://cdn.fatherkey.com/avatars/user_1775982177111.webp'
    );
    assert.equal(
        cnConfig.normalizeGongyiUrlForCurrentSite('https://sub2api.zaoyoe.xyz/dashboard'),
        'https://sub2api.fatherkey.com/dashboard'
    );
});

test('shop category aliases localize for zh and en storefront views', () => {
    const zh = JSON.parse(readRepoFile('lang/zh.json'));
    const en = JSON.parse(readRepoFile('lang/en.json'));
    const shopClientSource = readRepoFile('js/shop-client.js');

    assert.deepEqual(zh.shop.categoryLabels, {
        communityAccess: 'API中转',
        virtualCard: '虚拟卡',
        account: '账号',
        other: '其他'
    }, 'Chinese shop translations should define canonical category labels');
    assert.deepEqual(en.shop.categoryLabels, {
        communityAccess: 'API Relay',
        virtualCard: 'Virtual Card',
        account: 'Account',
        other: 'Other'
    }, 'English shop translations should define canonical category labels');
    assert.match(
        shopClientSource,
        /normalizeProductCategoryAliasKey: function \(value = ''\)/,
        'shop client should normalize category aliases before translation'
    );
    assert.match(
        shopClientSource,
        /window\.i18n\?\.t\(`shop\.categoryLabels\.\$\{translationKey\}`\)/,
        'shop client should resolve category names through translation keys when available'
    );
});

test('shop cart copy keeps zh storefront copy free from leaked english labels', () => {
    const shopClientSource = readRepoFile('js/shop-client.js');

    assert.match(
        shopClientSource,
        /drawerEyebrow: '浮动购物车'/,
        'Chinese cart drawer eyebrow should stay localized'
    );
    assert.match(
        shopClientSource,
        /checkoutReviewEyebrow: '购物车确认'/,
        'Chinese cart review eyebrow should stay localized'
    );
});
