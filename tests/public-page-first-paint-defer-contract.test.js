const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function parseAttributes(source) {
    const attributes = {};
    source.replace(/([\w:-]+)(?:=("[^"]*"|'[^']*'|[^\s>]+))?/g, (_, key, value) => {
        attributes[key.toLowerCase()] = value ? String(value).replace(/^['"]|['"]$/g, '') : true;
        return '';
    });
    return attributes;
}

function getScriptTags(source) {
    return Array.from(source.matchAll(/<script\b([^>]*)>/gi))
        .map((match) => parseAttributes(match[1]))
        .filter((attributes) => attributes.src);
}

function isBlockingScript(attributes) {
    return !attributes.defer && !attributes.async && attributes.type !== 'module';
}

function scriptTagPattern(src) {
    return new RegExp(`<script\\b(?=[^>]*\\bsrc=["']${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'])(?=[^>]*\\bdefer\\b)[^>]*>`);
}

test('public pages keep noncritical runtime scripts off the parser-blocking path', () => {
    const budgets = {
        'index.html': 7,
        'shop.html': 4,
        'verify.html': 5,
        'prompts.html': 5,
        'guestbook.html': 4
    };

    Object.entries(budgets).forEach(([relativePath, maxBlockingScripts]) => {
        const source = readRepoFile(relativePath);
        const blockingScripts = getScriptTags(source).filter(isBlockingScript);

        assert.ok(
            blockingScripts.length <= maxBlockingScripts,
            `${relativePath} should keep parser-blocking scripts <= ${maxBlockingScripts}; got ${blockingScripts.length}: ${blockingScripts.map((script) => script.src).join(', ')}`
        );
    });
});

test('subpage Supabase and shared runtime chains are deferred in dependency order', () => {
    ['shop.html', 'verify.html', 'prompts.html'].forEach((relativePath) => {
        const source = readRepoFile(relativePath);
        [
            'vendor/supabase/2.95.3/supabase.js?v=20260519_VENDOR_PUBLIC_1',
            '/api/runtime/supabase-config',
            './js/runtime-supabase-config.js?v=20260510_REALTIME_GRACEFUL_FALLBACK_1',
            './supabase-client.js?v=20260504_NOTIFICATION_LOADING_VERTICAL_ONLY_1',
            './js/site-config.js?v=20260528_AVATAR_CANONICAL_CDN_1',
            './js/site-layout-runtime.js?v=20260529_FOOTER_CONTACT_HOOKS_1',
            './js/section-visibility.js?v=20260528_GONGYI_SITE_AWARE_1'
        ].forEach((src) => {
            assert.match(source, scriptTagPattern(src), `${relativePath} should defer ${src}`);
        });
    });
});

test('heavy page runtimes and engagement chrome load without blocking first paint', () => {
    const expectations = {
        'index.html': [
            'js/chat-widget-loader.js?v=20260530_SHOP_CHAT_FLOATING_STACK_3&siteAssetCdn=20260510_SITE_ASSET_CDN_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1'
        ],
        'shop.html': [
            'js/chat-widget-loader.js?v=20260530_SHOP_CHAT_FLOATING_STACK_3&siteAssetCdn=20260510_SITE_ASSET_CDN_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1'
        ],
        'verify.html': [
            './starry-sky.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1',
            './verify-widget.js?v=20260603_VERIFY_REMAINING_INLINE_1',
            'js/chat-widget-loader.js?v=20260530_SHOP_CHAT_FLOATING_STACK_3&siteAssetCdn=20260510_SITE_ASSET_CDN_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1'
        ],
        'prompts.html': [
            'vendor/dayjs/1.11.13/dayjs.min.js?v=20260519_VENDOR_PUBLIC_1',
            'vendor/dayjs/1.11.13/plugin/relativeTime.js?v=20260519_VENDOR_PUBLIC_1',
            'vendor/dayjs/1.11.13/locale/zh-cn.js?v=20260519_VENDOR_PUBLIC_1',
            './js/prompts-runtime-bootstrap.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1',
            './js/prompts-dataset-bootstrap.js?v=20260428_PUBLIC_ASSET_CACHE_SWEEP_1',
            './js/prompt-image-variants.js?v=20260430_RESPONSIVE_IMAGE_VARIANTS_1',
            'js/heartbeat.js?v=20260404_PHASE3_EVENT_TRACKER_1',
            'js/chat-widget-loader.js?v=20260530_SHOP_CHAT_FLOATING_STACK_3&siteAssetCdn=20260510_SITE_ASSET_CDN_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1'
        ],
        'guestbook.html': [
            './js/homepage-contract.js?v=20260512_HOMEPAGE_CONTRACT_VERIFY_I18N_1',
            'js/chat-widget-loader.js?v=20260530_SHOP_CHAT_FLOATING_STACK_3&siteAssetCdn=20260510_SITE_ASSET_CDN_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1',
            './js/guestbook-optional-enhancements.js?v=20260503_GUESTBOOK_DARK_STARRY_BG_1&siteAssetCdn=20260510_SITE_ASSET_CDN_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1'
        ]
    };

    Object.entries(expectations).forEach(([relativePath, srcList]) => {
        const source = readRepoFile(relativePath);
        srcList.forEach((src) => {
            assert.match(source, scriptTagPattern(src), `${relativePath} should defer ${src}`);
        });
    });
});

test('active public pages load key vendor runtimes from first-party assets', () => {
    const publicPages = [
        'index.html',
        'shop.html',
        'verify.html',
        'prompts.html',
        'guestbook.html',
        'privacy.html',
        'reset-password.html',
        'auth-callback.html'
    ];

    const retiredCdnMarkers = [
        'https://unpkg.com/@supabase/supabase-js@2',
        'https://cdn.jsdelivr.net/npm/dayjs@1',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome'
    ];

    publicPages.forEach((relativePath) => {
        const source = readRepoFile(relativePath);

        retiredCdnMarkers.forEach((marker) => {
            assert.equal(
                source.includes(marker),
                false,
                `${relativePath} should not depend on ${marker}`
            );
        });
    });
});

test('subpage chat and notification styles are deferred until their loaders need them', () => {
    ['verify.html', 'prompts.html', 'guestbook.html'].forEach((relativePath) => {
        const source = readRepoFile(relativePath);

        assert.match(
            source,
            /<link rel="stylesheet" href="css\/notification-client\.css\?v=20260513_NOTIFICATION_MOBILE_STAGGER_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1" media="print" data-deferred-style="1" data-deferred-style-mode="manual" data-deferred-style-group="public-engagement">/,
            `${relativePath} should defer notification chrome styles`
        );
        assert.match(
            source,
            /<link rel="stylesheet" href="css\/chat-widget\.css\?v=20260530_SHOP_CHAT_FLOATING_STACK_3&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1" media="print" data-deferred-style="1" data-deferred-style-mode="manual" data-deferred-style-group="public-chat">/,
            `${relativePath} should defer chat widget styles`
        );
    });
});
