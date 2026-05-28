(function (global) {
    'use strict';

    const CACHE_KEY_PREFIX = 'zaoyoe_section_vis_';
    const STYLE_ELEMENT_ID = 'section-visibility-preload-style';
    const SECTIONS = Object.freeze(['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker', 'footer']);
    const INTL_DOMAINS = Object.freeze([
        'zaoyoe.xyz',
        'www.zaoyoe.xyz'
    ]);
    const SELECTOR_MAP = Object.freeze({
        hero: Object.freeze({
            sections: Object.freeze(['#hero-section'])
        }),
        prompts: Object.freeze({
            sections: Object.freeze(['#prompts-section']),
            navDesktop: Object.freeze([
                '.nav-menu a.nav-trigger[href="/prompts.html"]',
                '.nav-container a.nav-trigger[href="/prompts.html"]'
            ]),
            navMobile: Object.freeze([
                '.mobile-menu-items button.mobile-menu-trigger[data-submenu="prompts-mobile"]',
                '.mobile-menu-item button.mobile-menu-trigger[data-submenu="prompts-mobile"]'
            ]),
            footer: Object.freeze([
                'footer a[href="/prompts.html"]',
                '.framer-footer a[href="/prompts.html"]'
            ])
        }),
        shop: Object.freeze({
            sections: Object.freeze(['#shop-section']),
            navDesktop: Object.freeze([
                '.nav-menu a.nav-trigger[href="/shop.html"]',
                '.nav-container a.nav-trigger[href="/shop.html"]'
            ]),
            navMobile: Object.freeze([
                '.mobile-menu-items button.mobile-menu-trigger[data-submenu="shop-mobile"]',
                '.mobile-menu-item button.mobile-menu-trigger[data-submenu="shop-mobile"]'
            ]),
            footer: Object.freeze([
                'footer a[href="/shop.html"]',
                '.framer-footer a[href="/shop.html"]'
            ])
        }),
        gongyi: Object.freeze({
            sections: Object.freeze(['#gongyi-section']),
            navDesktop: Object.freeze([
                '.nav-menu a[href="https://sub2api.fatherkey.com"]',
                '.nav-menu a[href="https://sub2api.zaoyoe.xyz"]',
                '.nav-container a[href="https://sub2api.fatherkey.com"]',
                '.nav-container a[href="https://sub2api.zaoyoe.xyz"]'
            ]),
            navMobile: Object.freeze([
                '.mobile-menu-items a.mobile-menu-link[href="https://sub2api.fatherkey.com"]',
                '.mobile-menu-items a.mobile-menu-link[href="https://sub2api.zaoyoe.xyz"]',
                '.mobile-menu-item a.mobile-menu-link[href="https://sub2api.fatherkey.com"]',
                '.mobile-menu-item a.mobile-menu-link[href="https://sub2api.zaoyoe.xyz"]'
            ]),
            footer: Object.freeze([
                'footer a[href="https://sub2api.fatherkey.com"]',
                'footer a[href="https://sub2api.zaoyoe.xyz"]',
                '.framer-footer a[href="https://sub2api.fatherkey.com"]',
                '.framer-footer a[href="https://sub2api.zaoyoe.xyz"]'
            ])
        }),
        verify: Object.freeze({
            sections: Object.freeze(['#verify-section']),
            navDesktop: Object.freeze([
                '.nav-menu a[href="/verify.html"]',
                '.nav-menu a[href="#verify"]',
                '.nav-container a[href="/verify.html"]',
                '.nav-container a[href="#verify"]'
            ]),
            navMobile: Object.freeze([
                '.mobile-menu-items a.mobile-menu-link[href="/verify.html"]',
                '.mobile-menu-item a.mobile-menu-link[href="/verify.html"]'
            ]),
            footer: Object.freeze([
                'footer a[href="/verify.html"]',
                '.framer-footer a[href="/verify.html"]'
            ])
        }),
        guestbook: Object.freeze({
            sections: Object.freeze(['#guestbook-section']),
            navDesktop: Object.freeze([
                '.nav-menu a[href="/guestbook.html"]',
                '.nav-container a[href="/guestbook.html"]'
            ]),
            navMobile: Object.freeze([
                '.mobile-menu-items a.mobile-menu-link[href="/guestbook.html"]',
                '.mobile-menu-item a.mobile-menu-link[href="/guestbook.html"]'
            ]),
            footer: Object.freeze([
                'footer a[href="/guestbook.html"]',
                '.framer-footer a[href="/guestbook.html"]'
            ])
        }),
        ticker: Object.freeze({
            sections: Object.freeze(['#ticker-section'])
        }),
        footer: Object.freeze({
            sections: Object.freeze(['footer.framer-footer'])
        })
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

        const hostname = String(global.location?.hostname || '').trim().toLowerCase();
        return INTL_DOMAINS.includes(hostname) ? 'intl' : 'cn';
    }

    function loadCachedConfig(site = detectSite()) {
        try {
            const raw = global.localStorage?.getItem(`${CACHE_KEY_PREFIX}${site}`);
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    function normalizeConfig(config) {
        const source = config && typeof config === 'object' && !Array.isArray(config)
            ? config
            : {};
        const normalized = {};

        SECTIONS.forEach((section) => {
            normalized[section] = source[section] !== false;
        });

        return normalized;
    }

    function buildStyleText(config) {
        const normalizedConfig = normalizeConfig(config);
        const chunks = [];

        SECTIONS.forEach((section) => {
            if (normalizedConfig[section] !== false) {
                return;
            }

            const selectors = SELECTOR_MAP[section];
            if (!selectors) {
                return;
            }

            const hiddenSelectors = [
                ...(selectors.sections || []),
                ...(selectors.navDesktop || []),
                ...(selectors.navMobile || []),
                ...(selectors.footer || [])
            ].filter(Boolean);

            if (!hiddenSelectors.length) {
                return;
            }

            chunks.push(`${hiddenSelectors.join(',\n')} {\n    display: none !important;\n}`);
        });

        return chunks.join('\n');
    }

    function removeStyleElement(styleElement) {
        if (!styleElement) {
            return;
        }

        if (typeof styleElement.remove === 'function') {
            styleElement.remove();
            return;
        }

        if (styleElement.parentNode && typeof styleElement.parentNode.removeChild === 'function') {
            styleElement.parentNode.removeChild(styleElement);
        }
    }

    function ensureStyleElement() {
        let styleElement = global.document?.getElementById?.(STYLE_ELEMENT_ID) || null;
        if (styleElement) {
            return styleElement;
        }

        if (!global.document?.createElement) {
            return null;
        }

        styleElement = global.document.createElement('style');
        styleElement.id = STYLE_ELEMENT_ID;
        styleElement.type = 'text/css';
        (global.document.head || global.document.documentElement || global.document.body)?.appendChild?.(styleElement);
        return styleElement;
    }

    function applyConfig(config) {
        const styleText = buildStyleText(config);
        const existingStyle = global.document?.getElementById?.(STYLE_ELEMENT_ID) || null;

        if (!styleText) {
            removeStyleElement(existingStyle);
            return false;
        }

        const styleElement = existingStyle || ensureStyleElement();
        if (!styleElement) {
            return false;
        }

        styleElement.textContent = styleText;
        return true;
    }

    const api = Object.freeze({
        cacheKeyPrefix: CACHE_KEY_PREFIX,
        detectSite,
        loadCachedConfig,
        normalizeConfig,
        buildStyleText,
        applyConfig
    });

    global.SectionVisibilityPreload = api;
    global.__ZAOYOE_SECTION_VISIBILITY_PRELOAD__ = api;

    const cachedConfig = loadCachedConfig();
    if (cachedConfig) {
        applyConfig(cachedConfig);
    }
}(typeof window !== 'undefined' ? window : globalThis));
