(function (global) {
    'use strict';

    if (global.__zaoyoeExternalEngagementEmbedLoaded) {
        return;
    }
    global.__zaoyoeExternalEngagementEmbedLoaded = true;

    const VERSION = '20260505_GONGYI_EXTERNAL_ENGAGEMENT_1';
    const CHAT_WIDGET_LOADER_SRC = 'js/chat-widget-loader.js?v=077c87a52976&siteAssetCdn=20260510_SITE_ASSET_CDN_1';
    const CHAT_WIDGET_STYLE_SRC = 'css/chat-widget.css?v=077c87a52976';
    const DEFAULT_PAGE_ID = 'gongyi';
    const DEFAULT_SITE = 'cn';
    const ASSET_CDN_ORIGINS = Object.freeze({
        cn: 'https://cdn.zaoyoe.com',
        intl: 'https://cdn.zaoyoe.xyz'
    });
    const ASSET_CDN_HOSTS = new Set([
        'cdn.zaoyoe.com',
        'cdn.zaoyoe.xyz'
    ]);
    const ASSET_CDN_PATH_PREFIXES = new Set([
        'affiliate-posters',
        'avatars',
        'chat',
        'comments',
        'guestbook',
        'homepage',
        'products',
        'prompts'
    ]);

    const currentScript = document.currentScript
        || document.querySelector(`script[src*="js/engagement-external-embed.js?v=077c87a52976"]`)
        || document.querySelector('script[src*="js/engagement-external-embed.js"]');

    function sanitizeToken(value = '', fallback = '') {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '');
        return normalized || fallback;
    }

    function getScriptRoot() {
        try {
            const scriptUrl = new URL(currentScript?.src || '', global.location.href);
            const match = scriptUrl.pathname.match(/^(.*\/)js\/engagement-external-embed\.js$/);
            if (match) {
                scriptUrl.pathname = match[1];
                scriptUrl.search = '';
                scriptUrl.hash = '';
                return scriptUrl.toString().replace(/\/?$/, '/');
            }
            scriptUrl.pathname = '/';
            scriptUrl.search = '';
            scriptUrl.hash = '';
            return scriptUrl.toString();
        } catch (_) {
            return `${global.location.origin || ''}/`;
        }
    }

    function normalizeAssetBase(value = '') {
        const raw = String(value || '').trim();
        const fallback = getScriptRoot();
        try {
            return new URL(raw || fallback, global.location.href).toString().replace(/\/?$/, '/');
        } catch (_) {
            return (raw || fallback).replace(/\/?$/, '/');
        }
    }

    function normalizeOrigin(value = '', fallback = '') {
        const raw = String(value || '').trim();
        try {
            return new URL(raw || fallback || global.location.href, global.location.href).origin;
        } catch (_) {
            return '';
        }
    }

    function resolveAssetUrl(src = '') {
        const rawSrc = String(src || '').trim();
        if (!rawSrc || /^[a-z][a-z0-9+.-]*:/i.test(rawSrc) || rawSrc.startsWith('//')) {
            return rawSrc;
        }
        return new URL(rawSrc.replace(/^\.\//, ''), config.assetBase).toString();
    }

    function getAssetCdnOriginForSite(siteValue) {
        return ASSET_CDN_ORIGINS[siteValue === 'intl' ? 'intl' : 'cn'];
    }

    function normalizeAssetUrlForSite(url, siteValue) {
        const source = String(url || '').trim();
        if (!source) return '';

        try {
            const parsed = new URL(source, global.location.origin);
            const parts = String(parsed.pathname || '').split('/').filter(Boolean);
            const isKnownAssetHost = ASSET_CDN_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.r2.dev');
            if (!isKnownAssetHost || !ASSET_CDN_PATH_PREFIXES.has(parts[0])) {
                return source;
            }

            const targetOrigin = new URL(getAssetCdnOriginForSite(siteValue));
            parsed.protocol = targetOrigin.protocol;
            parsed.host = targetOrigin.host;
            return parsed.toString();
        } catch (_) {
            return source;
        }
    }

    function getDatasetValue(...keys) {
        const dataset = currentScript?.dataset || {};
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(dataset, key)) {
                return dataset[key];
            }
        }
        return '';
    }

    const assetBase = normalizeAssetBase(getDatasetValue('assetBase', 'assets'));
    const config = Object.freeze({
        version: VERSION,
        externalHost: true,
        pageId: sanitizeToken(getDatasetValue('pageId', 'page'), DEFAULT_PAGE_ID),
        site: sanitizeToken(getDatasetValue('site'), DEFAULT_SITE) === 'intl' ? 'intl' : 'cn',
        apiOrigin: normalizeOrigin(getDatasetValue('apiOrigin', 'apiBase'), assetBase),
        assetBase,
        position: sanitizeToken(getDatasetValue('position'), 'bottom-right'),
        theme: sanitizeToken(getDatasetValue('theme'), ''),
        autoWarm: String(getDatasetValue('autoWarm', 'autowarm') || '1') !== '0'
    });

    function createEmptyQueryResult(single = false) {
        return {
            data: single ? null : [],
            error: null,
            count: 0,
            status: 200
        };
    }

    function createQueryBuilder(single = false) {
        const builder = {
            select: () => builder,
            insert: () => builder,
            upsert: () => builder,
            update: () => builder,
            delete: () => builder,
            eq: () => builder,
            neq: () => builder,
            in: () => builder,
            contains: () => builder,
            order: () => builder,
            limit: () => builder,
            range: () => builder,
            single: () => Promise.resolve(createEmptyQueryResult(true)),
            maybeSingle: () => Promise.resolve(createEmptyQueryResult(true)),
            then: (resolve, reject) => Promise.resolve(createEmptyQueryResult(single)).then(resolve, reject),
            catch: (reject) => Promise.resolve(createEmptyQueryResult(single)).catch(reject),
            finally: (callback) => Promise.resolve(createEmptyQueryResult(single)).finally(callback)
        };
        return builder;
    }

    function installSupabaseStub() {
        if (global.supabaseClient?.auth?.getSession && global.supabaseClient?.from) {
            return;
        }

        global.supabaseClient = {
            auth: {
                getUser: async () => ({ data: { user: null }, error: null }),
                getSession: async () => ({ data: { session: null }, error: null }),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } }, error: null })
            },
            rpc: async () => ({ data: null, error: null }),
            from: () => createQueryBuilder(false),
            channel: () => ({
                on() { return this; },
                subscribe() { return this; },
                unsubscribe() {}
            }),
            removeChannel: () => {},
            storage: {
                from: () => ({
                    upload: async () => ({ data: null, error: null }),
                    getPublicUrl: () => ({ data: { publicUrl: '' }, error: null })
                })
            }
        };
    }

    function installSiteConfig() {
        const existing = global.SiteConfig && typeof global.SiteConfig === 'object' ? global.SiteConfig : {};
        global.SiteConfig = {
            ...existing,
            site: existing.site || config.site,
            currency: existing.currency || 'CNY',
            currencyCode: existing.currencyCode || 'CNY',
            isCN: typeof existing.isCN === 'function' ? existing.isCN : () => config.site !== 'intl',
            isIntl: typeof existing.isIntl === 'function' ? existing.isIntl : () => config.site === 'intl',
            getPriceField: typeof existing.getPriceField === 'function' ? existing.getPriceField : () => 'price',
            getPointsLabel: typeof existing.getPointsLabel === 'function' ? existing.getPointsLabel : () => 'points',
            getAssetCdnOrigin: typeof existing.getAssetCdnOrigin === 'function' ? existing.getAssetCdnOrigin : () => getAssetCdnOriginForSite(config.site),
            getCanonicalAssetCdnOrigin: typeof existing.getCanonicalAssetCdnOrigin === 'function' ? existing.getCanonicalAssetCdnOrigin : () => ASSET_CDN_ORIGINS.cn,
            normalizeAssetUrlForCurrentSite: typeof existing.normalizeAssetUrlForCurrentSite === 'function'
                ? existing.normalizeAssetUrlForCurrentSite
                : (url) => normalizeAssetUrlForSite(url, config.site),
            normalizeAssetUrlForCanonicalSite: typeof existing.normalizeAssetUrlForCanonicalSite === 'function'
                ? existing.normalizeAssetUrlForCanonicalSite
                : (url) => normalizeAssetUrlForSite(url, 'cn'),
            getStoragePrefix: typeof existing.getStoragePrefix === 'function' ? existing.getStoragePrefix : (key = '') => `zaoyoe_${config.site}_${String(key || '')}`
        };
    }

    function exposeRuntimeConfig() {
        document.documentElement.dataset.engagementPageId = config.pageId;
        if (config.theme) {
            document.documentElement.dataset.theme = config.theme;
        }
        global.ZaoyoeExternalEngagementConfig = config;
        global.ZaoyoeEngagementExternalConfig = config;
    }

    function findExistingAsset(selector, src = '') {
        const resolvedSrc = resolveAssetUrl(src);
        return Array.from(document.querySelectorAll(selector)).find((element) => (
            element.src === resolvedSrc
            || element.href === resolvedSrc
            || element.getAttribute('src') === resolvedSrc
            || element.getAttribute('href') === resolvedSrc
            || element.getAttribute('src') === src
            || element.getAttribute('href') === src
        )) || null;
    }

    function ensureStylesheet() {
        if (findExistingAsset('link[rel="stylesheet"]', CHAT_WIDGET_STYLE_SRC)) {
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = resolveAssetUrl(CHAT_WIDGET_STYLE_SRC);
        link.dataset.engagementExternalStyle = '1';
        (document.head || document.documentElement).appendChild(link);
    }

    function loadScript(src) {
        const existing = findExistingAsset('script', src);
        if (existing) {
            if (existing.dataset.loaded === '1' || existing.readyState === 'complete') {
                return Promise.resolve(existing);
            }
            if (existing.__zaoyoeExternalLoadPromise) {
                return existing.__zaoyoeExternalLoadPromise;
            }
        }

        const script = existing || document.createElement('script');
        if (!existing) {
            script.src = resolveAssetUrl(src);
            script.async = false;
            script.dataset.assetBase = config.assetBase;
            script.dataset.loaded = '0';
        }

        const promise = new Promise((resolve, reject) => {
            const cleanup = () => {
                script.removeEventListener('load', handleLoad);
                script.removeEventListener('error', handleError);
            };
            const handleLoad = () => {
                script.dataset.loaded = '1';
                cleanup();
                resolve(script);
            };
            const handleError = () => {
                cleanup();
                reject(new Error(`Failed to load ${script.src || src}`));
            };

            script.addEventListener('load', handleLoad, { once: true });
            script.addEventListener('error', handleError, { once: true });
        });

        script.__zaoyoeExternalLoadPromise = promise;
        if (!existing) {
            (document.head || document.documentElement).appendChild(script);
        }
        return promise;
    }

    function warm() {
        installSupabaseStub();
        installSiteConfig();
        exposeRuntimeConfig();
        ensureStylesheet();
        return loadScript(CHAT_WIDGET_LOADER_SRC).then(() => global.ZaoyoeChatWidgetBootstrap?.warm?.());
    }

    function open() {
        return warm().then(() => global.ZaoyoeChatWidgetBootstrap?.open?.());
    }

    function scheduleAutoWarm() {
        if (!config.autoWarm) {
            return;
        }
        const warmOnIdle = () => {
            warm().catch((error) => {
                console.warn('[ZaoyoeExternalEngagement] Warm skipped:', error?.message || error);
            });
        };
        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(warmOnIdle, { timeout: 1800 });
            return;
        }
        global.setTimeout(warmOnIdle, 400);
    }

    installSupabaseStub();
    installSiteConfig();
    exposeRuntimeConfig();
    ensureStylesheet();

    global.ZaoyoeExternalEngagement = Object.freeze({
        version: VERSION,
        config,
        warm,
        open
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleAutoWarm, { once: true });
    } else {
        scheduleAutoWarm();
    }
}(typeof window !== 'undefined' ? window : globalThis));
