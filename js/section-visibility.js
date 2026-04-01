/**
 * Section Visibility Module
 * 分栏可见性控制 - 根据 homepage_config 的站点行动态隐藏/显示页面分栏
 * 
 * 用法：
 *   SectionVisibility.isVisible('shop')     → true/false
 *   SectionVisibility.applySectionVisibility() → 立即应用可见性
 * 
 * 支持分栏：hero, gallery(=prompts), shop, verify, guestbook, footer
 * 按站点独立配置：cn / intl
 */
(function () {
    'use strict';

    const CACHE_KEY_PREFIX = 'zaoyoe_section_vis_';
    const SECTIONS = ['hero', 'gallery', 'shop', 'verify', 'guestbook', 'footer'];
    const HIDDEN_CLASS = 'section-visibility-hidden';
    const HOMEPAGE_SECTION_MAP = {
        hero: 'hero',
        gallery: 'prompts',
        shop: 'shop',
        verify: 'verify',
        guestbook: 'guestbook',
        footer: 'footer'
    };

    // Section → page mapping
    const SECTION_PAGES = {
        gallery: '/prompts.html',
        shop: '/shop.html',
        verify: '/verify.html',
        guestbook: '/guestbook.html'
    };

    // Section → nav/footer selectors
    const SECTION_SELECTORS = {
        gallery: {
            sections: ['#prompts-section'],
            navDesktop: 'a.nav-trigger[href="/prompts.html"]',
            navMobile: null, // handled dynamically
            footer: 'a[href="/prompts.html"]'
        },
        shop: {
            sections: ['#shop-section'],
            navDesktop: 'a.nav-trigger[href="/shop.html"]',
            navMobile: null,
            footer: 'a[href="/shop.html"]'
        },
        verify: {
            sections: ['#verify-section'],
            navDesktop: 'a[href="/verify.html"]',
            navMobile: null,
            footer: 'a[href="/verify.html"]'
        },
        guestbook: {
            sections: ['#guestbook-section'],
            navDesktop: 'a[href="/guestbook.html"]',
            navMobile: null,
            footer: 'a[href="/guestbook.html"]'
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

    /**
     * Get default config (all visible)
     */
    function getDefaults() {
        const defaults = {};
        SECTIONS.forEach(s => defaults[s] = true);
        return defaults;
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

    /**
     * Load config from localStorage cache (synchronous, for flash prevention)
     */
    function loadFromCache() {
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

        Object.entries(HOMEPAGE_SECTION_MAP).forEach(([logicalSection, rowSection]) => {
            const row = (rows || []).find((item) => item?.section === rowSection);
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
        if (!visibilityConfig) {
            // Try cache
            const cached = loadFromCache();
            if (cached) {
                visibilityConfig = cached;
            } else {
                return true; // Default visible if no config
            }
        }
        return visibilityConfig[section] !== false;
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
            if (selectors.navDesktop) {
                const navEls = document.querySelectorAll(`.nav-menu ${selectors.navDesktop}, .nav-container ${selectors.navDesktop}`);
                navEls.forEach(el => setDomVisibility(el, visible));
            }

            // Hide/show mobile menu items
            if (selectors.footer) {
                // Also find in mobile menu
                const mobileLinks = document.querySelectorAll(`.mobile-menu-items ${selectors.footer}, .mobile-menu-item ${selectors.footer}`);
                mobileLinks.forEach(el => {
                    const menuItem = el.closest('.mobile-menu-item');
                    if (menuItem) {
                        setDomVisibility(menuItem, visible);
                    } else {
                        setDomVisibility(el, visible);
                    }
                });
            }

            // Hide/show footer links
            if (selectors.footer) {
                const footerEls = document.querySelectorAll(`footer ${selectors.footer}, .framer-footer ${selectors.footer}`);
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
