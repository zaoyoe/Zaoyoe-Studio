/**
 * Section Visibility Module
 * 分栏可见性控制 - 根据站点配置动态隐藏/显示页面分栏
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

    const CONFIG_KEY = 'section_visibility';
    const CACHE_KEY_PREFIX = 'zaoyoe_section_vis_';
    const SECTIONS = ['hero', 'gallery', 'shop', 'verify', 'guestbook', 'footer'];

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
    async function loadFromDatabase() {
        try {
            if (!window.supabaseClient) return null;

            const { data, error } = await window.supabaseClient
                .rpc('get_all_system_config');

            if (error) throw error;

            const configItem = (data || []).find(item => item.config_key === CONFIG_KEY);
            if (configItem && configItem.config_value) {
                return configItem.config_value;
            }
        } catch (e) {
            console.warn('[SectionVisibility] Failed to load from database:', e.message);
        }
        return null;
    }

    /**
     * Get visibility config for current site
     */
    function getConfigForSite(fullConfig, site) {
        if (!fullConfig) return getDefaults();
        const siteConfig = fullConfig[site || getCurrentSite()];
        if (!siteConfig) return getDefaults();
        // Merge with defaults to ensure all keys exist
        const defaults = getDefaults();
        return { ...defaults, ...siteConfig };
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
                    if (el) el.style.display = visible ? '' : 'none';
                });
            }

            // Hide/show desktop nav links
            if (selectors.navDesktop) {
                const navEls = document.querySelectorAll(`.nav-menu ${selectors.navDesktop}, .nav-container ${selectors.navDesktop}`);
                navEls.forEach(el => el.style.display = visible ? '' : 'none');
            }

            // Hide/show mobile menu items
            if (selectors.footer) {
                // Also find in mobile menu
                const mobileLinks = document.querySelectorAll(`.mobile-menu-items ${selectors.footer}, .mobile-menu-item ${selectors.footer}`);
                mobileLinks.forEach(el => {
                    const menuItem = el.closest('.mobile-menu-item');
                    if (menuItem) {
                        menuItem.style.display = visible ? '' : 'none';
                    } else {
                        el.style.display = visible ? '' : 'none';
                    }
                });
            }

            // Hide/show footer links
            if (selectors.footer) {
                const footerEls = document.querySelectorAll(`footer ${selectors.footer}, .framer-footer ${selectors.footer}`);
                footerEls.forEach(el => el.style.display = visible ? '' : 'none');
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
        const overlay = document.createElement('div');
        overlay.id = 'section-blocked-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 99999;
            background: linear-gradient(135deg, #0f1724 0%, #1a2332 50%, #0f1724 100%);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: 'Inter', 'Outfit', -apple-system, sans-serif;
            color: #fff; text-align: center; padding: 40px;
        `;
        overlay.innerHTML = `
            <div style="
                width: 80px; height: 80px; border-radius: 50%;
                background: rgba(107, 158, 206, 0.1);
                display: flex; align-items: center; justify-content: center;
                margin-bottom: 24px;
                box-shadow: 0 0 40px rgba(107, 158, 206, 0.15);
            ">
                <i class="fas fa-lock" style="font-size: 32px; color: #6b9ece;"></i>
            </div>
            <h2 style="
                font-size: 1.5rem; font-weight: 700; margin: 0 0 12px 0;
                background: linear-gradient(135deg, #6b9ece, #89b8e0);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            ">该页面暂未开放</h2>
            <p style="
                color: rgba(255,255,255,0.5); font-size: 0.95rem;
                max-width: 400px; line-height: 1.6; margin: 0 0 32px 0;
            ">此功能当前未在该站点启用，请联系管理员了解更多信息。</p>
            <a href="/" style="
                display: inline-flex; align-items: center; gap: 8px;
                padding: 12px 28px; border-radius: 12px;
                background: rgba(107, 158, 206, 0.15);
                border: 1px solid rgba(107, 158, 206, 0.3);
                color: #6b9ece; text-decoration: none;
                font-weight: 600; font-size: 0.9rem;
                transition: all 0.3s;
            " onmouseenter="this.style.background='rgba(107,158,206,0.25)';this.style.transform='translateY(-2px)'"
               onmouseleave="this.style.background='rgba(107,158,206,0.15)';this.style.transform='translateY(0)'">
                <i class="fas fa-home"></i>
                返回首页
            </a>
        `;
        document.body.appendChild(overlay);
        // Hide all other content
        document.querySelectorAll('body > *:not(#section-blocked-overlay):not(script):not(link):not(style)').forEach(el => {
            el.style.display = 'none';
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
        const fullConfig = await loadFromDatabase();
        if (fullConfig) {
            const siteConfig = getConfigForSite(fullConfig, site);
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
            const fullConfig = await loadFromDatabase();
            return fullConfig || { cn: getDefaults(), intl: getDefaults() };
        }
    };

    // Auto-init on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
