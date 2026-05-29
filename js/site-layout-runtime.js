(function (global) {
    'use strict';

    const PAGE_REGISTRY = Object.freeze({
        home: Object.freeze({
            key: 'home',
            label: '首页',
            href: '/'
        }),
        shop: Object.freeze({
            key: 'shop',
            label: '商城',
            href: '/shop.html'
        }),
        prompts: Object.freeze({
            key: 'prompts',
            label: '提示词',
            href: '/prompts.html'
        }),
        verify: Object.freeze({
            key: 'verify',
            label: 'Gemini Pro',
            href: '/verify.html'
        }),
        guestbook: Object.freeze({
            key: 'guestbook',
            label: '留言板',
            href: '/guestbook.html'
        }),
        gongyi: Object.freeze({
            key: 'gongyi',
            label: 'API中转',
            href: 'gongyi'
        })
    });
    const GONGYI_ORIGINS = Object.freeze({
        cn: 'https://sub2api.fatherkey.com',
        intl: 'https://sub2api.zaoyoe.xyz'
    });
    const DEFAULT_FOOTER_CONTACTS = Object.freeze({
        support_url: 'https://afdian.com/a/zaoyoe',
        telegram_url: 'https://t.me/zaoyoe',
        telegram_group_url: 'https://t.me/+I86eX5sPF1c0OTc1',
        contact_email: 'zaoyoe@gmail.com'
    });
    const DEFAULT_LAYOUTS = Object.freeze({
        cn: Object.freeze({
            root_page_key: 'home',
            logo_target_mode: 'follow_root',
            logo_page_key: 'home',
            footer_contacts: DEFAULT_FOOTER_CONTACTS
        }),
        intl: Object.freeze({
            root_page_key: 'shop',
            logo_target_mode: 'follow_root',
            logo_page_key: 'shop',
            footer_contacts: DEFAULT_FOOTER_CONTACTS
        })
    });
    const LOGO_TARGET_MODES = new Set(['follow_root', 'custom']);
    const CACHE_KEY = 'zaoyoe_site_layouts_v1';

    function normalizeSite(site) {
        return site === 'intl' ? 'intl' : 'cn';
    }

    function normalizePageKey(value, fallback = 'home') {
        const normalized = String(value || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(PAGE_REGISTRY, normalized)) {
            return normalized;
        }
        return Object.prototype.hasOwnProperty.call(PAGE_REGISTRY, fallback) ? fallback : 'home';
    }

    function normalizeContactUrl(value, fallback) {
        const source = String(value || '').trim();
        const fallbackValue = String(fallback || '').trim();
        if (!source) return fallbackValue;

        try {
            const parsed = new URL(source);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.toString();
            }
        } catch (_error) {
            return fallbackValue;
        }

        return fallbackValue;
    }

    function normalizeContactEmail(value, fallback) {
        const source = String(value || '').trim().slice(0, 320);
        const fallbackValue = String(fallback || '').trim().slice(0, 320);
        if (!source) return fallbackValue;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source) ? source : fallbackValue;
    }

    function normalizeFooterContacts(value, fallback = DEFAULT_FOOTER_CONTACTS) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
            ? fallback
            : DEFAULT_FOOTER_CONTACTS;

        return {
            support_url: normalizeContactUrl(source.support_url, defaults.support_url),
            telegram_url: normalizeContactUrl(source.telegram_url, defaults.telegram_url),
            telegram_group_url: normalizeContactUrl(source.telegram_group_url, defaults.telegram_group_url),
            contact_email: normalizeContactEmail(source.contact_email, defaults.contact_email)
        };
    }

    function buildDefaultLayout(site) {
        const normalizedSite = normalizeSite(site);
        const defaults = DEFAULT_LAYOUTS[normalizedSite] || DEFAULT_LAYOUTS.cn;
        return {
            root_page_key: defaults.root_page_key,
            logo_target_mode: defaults.logo_target_mode,
            logo_page_key: defaults.logo_page_key,
            footer_contacts: normalizeFooterContacts(defaults.footer_contacts)
        };
    }

    function normalizeLayoutRecord(value, site) {
        const defaults = buildDefaultLayout(site);
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        const rootPageKey = normalizePageKey(source.root_page_key, defaults.root_page_key);
        const logoTargetMode = LOGO_TARGET_MODES.has(String(source.logo_target_mode || '').trim().toLowerCase())
            ? String(source.logo_target_mode || '').trim().toLowerCase()
            : defaults.logo_target_mode;
        const logoPageKey = normalizePageKey(
            source.logo_page_key,
            logoTargetMode === 'custom' ? defaults.logo_page_key : rootPageKey
        );

        return {
            root_page_key: rootPageKey,
            logo_target_mode: logoTargetMode,
            logo_page_key: logoTargetMode === 'custom' ? logoPageKey : rootPageKey,
            footer_contacts: normalizeFooterContacts(source.footer_contacts, defaults.footer_contacts)
        };
    }

    function normalizeLayouts(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};

        return {
            cn: normalizeLayoutRecord(source.cn, 'cn'),
            intl: normalizeLayoutRecord(source.intl, 'intl')
        };
    }

    function getCurrentSite() {
        return normalizeSite(global.SiteConfig?.site);
    }

    function getPageHref(pageKey, site = getCurrentSite()) {
        const key = normalizePageKey(pageKey);
        if (key === 'gongyi') {
            return GONGYI_ORIGINS[normalizeSite(site)];
        }
        return PAGE_REGISTRY[key]?.href || '/';
    }

    function getRootHref(layout) {
        return getPageHref(layout?.root_page_key);
    }

    function getLogoHref(layout) {
        if ((layout?.logo_target_mode || 'follow_root') === 'custom') {
            return getPageHref(layout?.logo_page_key);
        }
        return getRootHref(layout);
    }

    function saveLayoutsToCache(layouts) {
        try {
            global.localStorage?.setItem(CACHE_KEY, JSON.stringify(layouts));
        } catch (_error) {
            // ignore cache errors
        }
    }

    function loadLayoutsFromCache() {
        try {
            const raw = global.localStorage?.getItem(CACHE_KEY);
            if (!raw) {
                return null;
            }
            return normalizeLayouts(JSON.parse(raw));
        } catch (_error) {
            return null;
        }
    }

    function applyLogoTargets(layout) {
        const href = getLogoHref(layout);
        document.querySelectorAll('a.nav-logo').forEach((anchor) => {
            anchor.setAttribute('href', href);
            anchor.dataset.siteLayoutResolvedHref = href;
        });
    }

    function setContactHref(element, href) {
        if (!element || element.tagName !== 'A' || !href) return;
        element.setAttribute('href', href);
        element.dataset.siteLayoutResolvedHref = href;
    }

    function applyFooterContacts(layout) {
        const contacts = normalizeFooterContacts(layout?.footer_contacts);
        document.querySelectorAll('[data-site-layout-contact]').forEach((element) => {
            const contactKey = String(element.dataset.siteLayoutContact || '').trim();
            if (contactKey === 'support') {
                setContactHref(element, contacts.support_url);
            } else if (contactKey === 'telegram') {
                setContactHref(element, contacts.telegram_url);
            } else if (contactKey === 'telegram_group') {
                setContactHref(element, contacts.telegram_group_url);
            } else if (contactKey === 'email') {
                element.textContent = contacts.contact_email;
                if (element.tagName === 'A') {
                    setContactHref(element, `mailto:${contacts.contact_email}`);
                }
                element.dataset.siteLayoutResolvedEmail = contacts.contact_email;
            }
        });
    }

    function applySeoMeta() {
        const currentUrl = new URL(global.location.pathname + global.location.search, global.location.origin);
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            canonical.setAttribute('href', currentUrl.toString());
        }
        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) {
            ogUrl.setAttribute('content', currentUrl.toString());
        }
    }

    function maybeRedirectRoot(layout) {
        const pathname = global.location.pathname || '/';
        if (pathname !== '/') {
            return false;
        }

        const targetHref = getRootHref(layout);
        if (!targetHref || targetHref === '/') {
            return false;
        }

        const targetUrl = new URL(targetHref, global.location.origin);
        if (!targetUrl.search && global.location.search) {
            targetUrl.search = global.location.search;
        }
        if (!targetUrl.hash && global.location.hash) {
            targetUrl.hash = global.location.hash;
        }

        if (targetUrl.toString() === global.location.href) {
            return false;
        }

        global.location.replace(targetUrl.toString());
        return true;
    }

    function fetchLayoutsFromPublicApi() {
        return fetch('/api/public?scope=config&route=site-layout', {
            method: 'GET',
            credentials: 'same-origin'
        })
            .then((response) => response.json().catch(() => ({})).then((payload) => ({ response, payload })))
            .then(({ response, payload }) => {
                if (!response.ok || payload?.success !== true) {
                    throw new Error(payload?.message || 'Failed to load site layout config');
                }
                return normalizeLayouts(payload.layouts || {});
            });
    }

    function applyLayout(layouts) {
        const site = getCurrentSite();
        const layout = layouts[site] || buildDefaultLayout(site);
        global.__ZAOYOE_SITE_LAYOUTS__ = layouts;
        global.__ZAOYOE_SITE_LAYOUT__ = layout;

        const redirected = maybeRedirectRoot(layout);
        if (redirected) {
            return;
        }

        applyLogoTargets(layout);
        applyFooterContacts(layout);
        applySeoMeta();
    }

    function ensureAppliedWithCurrentDom(layouts) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => applyLayout(layouts), { once: true });
            return;
        }
        applyLayout(layouts);
    }

    const cachedLayouts = loadLayoutsFromCache();
    if (cachedLayouts) {
        ensureAppliedWithCurrentDom(cachedLayouts);
    }

    fetchLayoutsFromPublicApi()
        .then((layouts) => {
            saveLayoutsToCache(layouts);
            ensureAppliedWithCurrentDom(layouts);
        })
        .catch((error) => {
            if (!cachedLayouts) {
                console.warn('[SiteLayoutRuntime] Failed to load public site layout config:', error?.message || error);
            }
        });

    global.SiteLayoutRuntime = Object.freeze({
        defaults: DEFAULT_LAYOUTS,
        pageRegistry: PAGE_REGISTRY,
        normalizeLayouts,
        getCurrentSite,
        getCurrentLayout: function () {
            const site = getCurrentSite();
            return (global.__ZAOYOE_SITE_LAYOUTS__ && global.__ZAOYOE_SITE_LAYOUTS__[site])
                || buildDefaultLayout(site);
        },
        resolveRootHref: function (site = getCurrentSite()) {
            const normalizedSite = normalizeSite(site);
            const layout = (global.__ZAOYOE_SITE_LAYOUTS__ && global.__ZAOYOE_SITE_LAYOUTS__[normalizedSite])
                || buildDefaultLayout(normalizedSite);
            return getRootHref(layout);
        },
        resolveLogoHref: function (site = getCurrentSite()) {
            const normalizedSite = normalizeSite(site);
            const layout = (global.__ZAOYOE_SITE_LAYOUTS__ && global.__ZAOYOE_SITE_LAYOUTS__[normalizedSite])
                || buildDefaultLayout(normalizedSite);
            return getLogoHref(layout);
        }
    });
}(typeof window !== 'undefined' ? window : globalThis));
