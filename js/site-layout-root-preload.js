(function (global) {
    'use strict';

    const CACHE_KEY = 'zaoyoe_site_layouts_v1';
    const INTL_DOMAINS = Object.freeze({
        'zaoyoe.xyz': true,
        'www.zaoyoe.xyz': true
    });
    const PAGE_REGISTRY = Object.freeze({
        home: '/',
        shop: '/shop.html',
        prompts: '/prompts.html',
        verify: '/verify.html',
        guestbook: '/guestbook.html',
        gongyi: 'https://gongyi.zaoyoe.com'
    });
    const DEFAULT_LAYOUTS = Object.freeze({
        cn: Object.freeze({ root_page_key: 'home' }),
        intl: Object.freeze({ root_page_key: 'shop' })
    });

    function detectSite() {
        try {
            const params = new URLSearchParams(global.location?.search || '');
            const forcedSite = String(params.get('site') || '').trim().toLowerCase();
            if (forcedSite === 'intl' || forcedSite === 'cn') {
                return forcedSite;
            }
        } catch (_error) {
            // ignore URLSearchParams errors
        }

        return INTL_DOMAINS[String(global.location?.hostname || '').trim().toLowerCase()] ? 'intl' : 'cn';
    }

    function normalizePageKey(value, fallback = 'home') {
        const key = String(value || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(PAGE_REGISTRY, key)) {
            return key;
        }
        return Object.prototype.hasOwnProperty.call(PAGE_REGISTRY, fallback) ? fallback : 'home';
    }

    function loadCachedLayouts() {
        try {
            const raw = global.localStorage?.getItem(CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_error) {
            return null;
        }
    }

    function resolveRootHref(site, layouts) {
        const defaults = DEFAULT_LAYOUTS[site] || DEFAULT_LAYOUTS.cn;
        const siteLayouts = layouts && typeof layouts === 'object' && !Array.isArray(layouts)
            ? layouts[site]
            : null;
        const rootPageKey = normalizePageKey(siteLayouts?.root_page_key, defaults.root_page_key);
        return PAGE_REGISTRY[rootPageKey] || '/';
    }

    const pathname = global.location?.pathname || '/';
    if (pathname !== '/' && pathname !== '/index.html') {
        return;
    }

    const site = detectSite();
    const targetHref = resolveRootHref(site, loadCachedLayouts());
    if (!targetHref || targetHref === '/' || targetHref === '/index.html') {
        return;
    }

    const targetUrl = new URL(targetHref, global.location.origin);
    if (!targetUrl.search && global.location.search) {
        targetUrl.search = global.location.search;
    }
    if (!targetUrl.hash && global.location.hash) {
        targetUrl.hash = global.location.hash;
    }

    if (targetUrl.toString() !== global.location.href) {
        global.location.replace(targetUrl.toString());
    }
}(typeof window !== 'undefined' ? window : globalThis));
