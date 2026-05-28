/**
 * Section Visibility Module
 * 分栏可见性控制 - 根据 homepage_config 的站点行动态隐藏/显示页面分栏
 * 
 * 用法：
 *   SectionVisibility.isVisible('shop')     → true/false
 *   SectionVisibility.applySectionVisibility() → 立即应用可见性
 * 
 * 支持分栏：hero, prompts(兼容 gallery), shop, gongyi, verify, guestbook, ticker, footer
 * 按站点独立配置：cn / intl
 */
(function () {
    'use strict';

    const Contract = window.HomepageContract || null;
    const Preload = window.SectionVisibilityPreload || window.__ZAOYOE_SECTION_VISIBILITY_PRELOAD__ || null;
    const CACHE_KEY_PREFIX = 'zaoyoe_section_vis_';
    const SECTIONS = Array.isArray(Contract?.VISIBILITY_SECTION_ORDER)
        ? [...Contract.VISIBILITY_SECTION_ORDER]
        : ['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker', 'footer'];
    const HIDDEN_CLASS = 'section-visibility-hidden';
    const HOMEPAGE_SECTION_MAP = {
        hero: 'hero',
        prompts: 'prompts',
        shop: 'shop',
        gongyi: 'gongyi',
        verify: 'verify',
        guestbook: 'guestbook',
        ticker: 'ticker',
        footer: 'footer'
    };

    // Section → page mapping
    const SECTION_PAGES = {
        prompts: '/prompts.html',
        shop: '/shop.html',
        verify: '/verify.html',
        guestbook: '/guestbook.html'
    };

    // Section → nav/footer selectors
    const SECTION_SELECTORS = {
        prompts: {
            sections: ['#prompts-section'],
            navDesktop: ['a.nav-trigger[href="/prompts.html"]'],
            navMobile: ['button.mobile-menu-trigger[data-submenu="prompts-mobile"]'],
            footer: ['a[href="/prompts.html"]']
        },
        shop: {
            sections: ['#shop-section'],
            navDesktop: ['a.nav-trigger[href="/shop.html"]'],
            navMobile: ['button.mobile-menu-trigger[data-submenu="shop-mobile"]'],
            footer: ['a[href="/shop.html"]']
        },
        gongyi: {
            sections: ['#gongyi-section'],
            navDesktop: [
                'a[href="https://sub2api.fatherkey.com"]',
                'a[href="https://sub2api.zaoyoe.xyz"]'
            ],
            navMobile: [
                'a.mobile-menu-link[href="https://sub2api.fatherkey.com"]',
                'a.mobile-menu-link[href="https://sub2api.zaoyoe.xyz"]'
            ],
            footer: [
                'a[href="https://sub2api.fatherkey.com"]',
                'a[href="https://sub2api.zaoyoe.xyz"]'
            ]
        },
        verify: {
            sections: ['#verify-section'],
            navDesktop: ['a[href="/verify.html"]', 'a[href="#verify"]'],
            navMobile: ['a.mobile-menu-link[href="/verify.html"]'],
            footer: ['a[href="/verify.html"]']
        },
        guestbook: {
            sections: ['#guestbook-section'],
            navDesktop: ['a[href="/guestbook.html"]'],
            navMobile: ['a.mobile-menu-link[href="/guestbook.html"]'],
            footer: ['a[href="/guestbook.html"]']
        },
        ticker: {
            sections: ['#ticker-section'],
            navDesktop: null,
            navMobile: null,
            footer: null
        },
        hero: {
            sections: ['#hero-section'],
            navDesktop: null,
            navMobile: null,
            footer: null
        },
        footer: {
            sections: ['footer.framer-footer'],
            navDesktop: null,
            navMobile: null,
            footer: null
        }
    };

    let visibilityConfig = null;

    function buildScopedSelectorList(scopeSelectors = [], targetSelectors = []) {
        const scopes = Array.isArray(scopeSelectors) ? scopeSelectors.filter(Boolean) : [];
        const targets = Array.isArray(targetSelectors) ? targetSelectors.filter(Boolean) : [];

        if (!scopes.length || !targets.length) {
            return '';
        }

        return scopes
            .flatMap((scope) => targets.map((target) => `${scope} ${target}`))
            .join(', ');
    }

    function queryScopedElements(scopeSelectors = [], targetSelectors = []) {
        const selector = buildScopedSelectorList(scopeSelectors, targetSelectors);
        if (!selector) {
            return [];
        }

        try {
            return Array.from(document.querySelectorAll(selector));
        } catch (error) {
            console.warn('[SectionVisibility] Failed to query scoped selectors:', error?.message || error);
            return [];
        }
    }

    function syncPreloadVisibility(config) {
        try {
            if (typeof Preload?.applyConfig === 'function') {
                Preload.applyConfig(config);
            }
        } catch (error) {
            console.warn('[SectionVisibility] Failed to sync preload visibility:', error?.message || error);
        }
    }

    /**
     * Get default config (all visible)
     */
    function getDefaults() {
        const defaults = {};
        SECTIONS.forEach(s => defaults[s] = true);
        return defaults;
    }

    function normalizeVisibilitySection(section) {
        const normalized = Contract?.normalizeSection?.(section, { allowLegacy: true })
            || String(section || '').trim().toLowerCase();
        if (normalized === 'gallery') {
            return 'prompts';
        }
        return normalized;
    }

    /**
     * Get current site key
     */
    function getCurrentSite() {
        if (window.SiteConfig) {
            return window.SiteConfig.site; // 'cn' | 'intl'
        }
        return 'cn';
    }

    function normalizeSite(site) {
        return site === 'intl' ? 'intl' : 'cn';
    }

    /**
     * Get cache key for current site
     */
    function getCacheKey() {
        return CACHE_KEY_PREFIX + getCurrentSite();
    }

    function loadFromRuntimePreload(site = getCurrentSite()) {
        const runtimeSite = normalizeSite(window.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_SITE__);
        const runtimeConfig = window.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_CONFIG__;
        if (runtimeSite !== normalizeSite(site)) {
            return null;
        }

        if (!runtimeConfig || typeof runtimeConfig !== 'object' || Array.isArray(runtimeConfig)) {
            return null;
        }

        return runtimeConfig;
    }

    /**
     * Load config from localStorage cache (synchronous, for flash prevention)
     */
    function loadFromCache() {
        const runtimeConfig = loadFromRuntimePreload();
        if (runtimeConfig) {
            return runtimeConfig;
        }

        try {
            const cached = localStorage.getItem(getCacheKey());
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (e) {
            // ignore
        }
        return null;
    }

    /**
     * Save config to localStorage cache
     */
    function saveToCache(config) {
        try {
            localStorage.setItem(getCacheKey(), JSON.stringify(config));
        } catch (e) {
            // ignore
        }
    }

    /**
     * Load config from Supabase (async)
     */
    function mapHomepageRowsToVisibility(rows, site) {
        const config = getDefaults();
        const rowMap = Contract?.mapRowsBySection?.(rows || [], { allowLegacy: true }) || {};

        Object.entries(HOMEPAGE_SECTION_MAP).forEach(([logicalSection, rowSection]) => {
            const row = rowMap[rowSection] || (rows || []).find((item) => normalizeVisibilitySection(item?.section) === rowSection);
            if (row) {
                config[logicalSection] = row.is_visible !== false;
            }
        });

        return config;
    }

    async function loadFromDatabase(site = getCurrentSite()) {
        try {
            if (!window.supabaseClient) return null;

            const normalizedSite = normalizeSite(site);
            const { data, error } = await window.supabaseClient
                .rpc('fn_get_homepage_config', {
                    p_site: normalizedSite,
                    p_include_hidden: true
                });

            if (error) throw error;

            return mapHomepageRowsToVisibility(data || [], normalizedSite);
        } catch (e) {
            console.warn('[SectionVisibility] Failed to load from database:', e.message);
        }
        return null;
    }

    function setDomVisibility(element, visible) {
        if (!element) return;
        element.hidden = !visible;
        element.classList.toggle(HIDDEN_CLASS, !visible);
    }

    /**
     * Check if a section is visible
     */
    function isVisible(section) {
        const normalizedSection = normalizeVisibilitySection(section);
        if (!visibilityConfig) {
            // Try cache
            const cached = loadFromCache();
            if (cached) {
                visibilityConfig = cached;
            } else {
                return true; // Default visible if no config
            }
        }
        return visibilityConfig[normalizedSection] !== false;
    }

    /**
     * Apply visibility to DOM elements on the current page
     */
    function applySectionVisibility() {
        if (!visibilityConfig) return;

        SECTIONS.forEach(section => {
            const visible = visibilityConfig[section] !== false;
            const selectors = SECTION_SELECTORS[section];
            if (!selectors) return;

            // Hide/show homepage sections
            if (selectors.sections) {
                selectors.sections.forEach(sel => {
                    const el = document.querySelector(sel);
                    setDomVisibility(el, visible);
                });
            }

            // Hide/show desktop nav links
            if (Array.isArray(selectors.navDesktop) && selectors.navDesktop.length) {
                const navEls = queryScopedElements(['.nav-menu', '.nav-container'], selectors.navDesktop);
                navEls.forEach(el => setDomVisibility(el, visible));
            }

            // Hide/show mobile menu items
            if (Array.isArray(selectors.navMobile) && selectors.navMobile.length) {
                const mobileLinks = queryScopedElements(['.mobile-menu-items', '.mobile-menu-item'], selectors.navMobile);
                mobileLinks.forEach((el) => {
                    const menuItem = el.closest('.mobile-menu-item');
                    if (menuItem) {
                        setDomVisibility(menuItem, visible);
                    } else {
                        setDomVisibility(el, visible);
                    }
                });
            }

            // Hide/show footer links
            if (Array.isArray(selectors.footer) && selectors.footer.length) {
                const footerEls = queryScopedElements(['footer', '.framer-footer'], selectors.footer);
                footerEls.forEach(el => setDomVisibility(el, visible));
            }
        });
    }

    /**
     * Check if the current page should be blocked
     * Returns the section name if blocked, null otherwise
     */
    function checkPageAccess() {
        const path = window.location.pathname;

        for (const [section, pagePath] of Object.entries(SECTION_PAGES)) {
            if (path.endsWith(pagePath) || path === pagePath) {
                if (!isVisible(section)) {
                    return section;
                }
            }
        }
        return null;
    }

    /**
     * Show "page not available" overlay
     */
    function showBlockedOverlay() {
        if (document.getElementById('section-blocked-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'section-blocked-overlay';
        overlay.className = 'section-blocked-overlay';
        overlay.innerHTML = `
            <div class="section-blocked-overlay__icon-shell">
                <i class="fas fa-lock section-blocked-overlay__icon"></i>
            </div>
            <h2 class="section-blocked-overlay__title">该页面暂未开放</h2>
            <p class="section-blocked-overlay__description">此功能当前未在该站点启用，请联系管理员了解更多信息。</p>
            <a href="/" class="section-blocked-overlay__home-link">
                <i class="fas fa-home"></i>
                返回首页
            </a>
        `;
        document.body.classList.add('section-visibility-page-blocked');
        document.body.appendChild(overlay);
        // Hide all other content
        document.querySelectorAll('body > *:not(#section-blocked-overlay):not(script):not(link):not(style)').forEach(el => {
            setDomVisibility(el, false);
        });
    }

    /**
     * Initialize: load config, apply visibility, check page access
     */
    async function init() {
        const site = getCurrentSite();

        // Step 1: Try cache first (synchronous, prevents flash)
        const cached = loadFromCache();
        if (cached) {
            visibilityConfig = cached;
            syncPreloadVisibility(visibilityConfig);
            applySectionVisibility();

            // Check page access immediately
            const blocked = checkPageAccess();
            if (blocked) {
                showBlockedOverlay();
                return;
            }
        }

        // Step 2: Load from database (async) and update
        const siteConfig = await loadFromDatabase(site);
        if (siteConfig) {
            visibilityConfig = siteConfig;
            saveToCache(siteConfig);
            syncPreloadVisibility(siteConfig);
            applySectionVisibility();

            // Re-check page access with fresh data
            const blocked = checkPageAccess();
            if (blocked) {
                showBlockedOverlay();
            }
        }
    }

    // Export
    window.SectionVisibility = {
        isVisible,
        applySectionVisibility,
        checkPageAccess,
        init,
        getDefaults,
        SECTIONS,

        /**
         * Force update config (used by admin when saving)
         */
        updateConfig(siteConfig) {
            visibilityConfig = siteConfig;
            saveToCache(siteConfig);
            syncPreloadVisibility(siteConfig);
            applySectionVisibility();
        },

        /**
         * Get full config for all sites (for admin use)
         */
        async getFullConfig() {
            const [cn, intl] = await Promise.all([
                loadFromDatabase('cn'),
                loadFromDatabase('intl')
            ]);
            return {
                cn: cn || getDefaults(),
                intl: intl || getDefaults()
            };
        }
    };

    // Auto-init on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
