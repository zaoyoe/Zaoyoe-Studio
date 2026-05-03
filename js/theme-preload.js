(function () {
    'use strict';

    const THEME_CHROME_COLORS = {
        light: '#ffffff',
        dark: '#000000'
    };
    const IOS_REPAINT_FALLBACK_COLORS = {
        light: '#fffffe',
        dark: '#010101'
    };
    const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';
    const THEME_CHROME_OVERRIDE_SELECTOR = 'meta[name="site-theme-chrome-color"]';
    const SITE_MODAL_THEME_RESTORE_ATTRIBUTE = 'data-site-modal-theme-restore';
    const PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE = 'data-prompt-modal-theme-restore';
    const THEME_RESTORE_ATTRIBUTES = [
        SITE_MODAL_THEME_RESTORE_ATTRIBUTE,
        PROMPT_MODAL_THEME_RESTORE_ATTRIBUTE,
        'data-chat-theme-restore',
        'data-shop-cart-theme-restore'
    ];
    const COLOR_SCHEME_SELECTOR = 'meta[name="color-scheme"]';
    let siteModalThemeRestoreTimerId = null;
    let siteModalForceHiddenTimerId = null;
    let siteModalForceHiddenCleanup = null;

    function normalizeTheme(theme) {
        return theme === 'dark' ? 'dark' : 'light';
    }

    function normalizeThemeChromeColor(value) {
        const color = String(value || '').trim();
        return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : '';
    }

    function parseThemeChromeHexColor(value) {
        const normalized = normalizeThemeChromeColor(value);
        if (!normalized) return null;
        const hex = normalized.slice(1);
        const expanded = hex.length === 3
            ? hex.split('').map((digit) => `${digit}${digit}`).join('')
            : hex;

        return {
            r: Number.parseInt(expanded.slice(0, 2), 16),
            g: Number.parseInt(expanded.slice(2, 4), 16),
            b: Number.parseInt(expanded.slice(4, 6), 16)
        };
    }

    function toThemeChromeHexColor(channel) {
        return Math.max(0, Math.min(255, channel))
            .toString(16)
            .padStart(2, '0');
    }

    function getIOSRepaintColor(theme, themeColor) {
        const normalizedTheme = normalizeTheme(theme);
        const rgb = parseThemeChromeHexColor(themeColor);
        if (!rgb) return IOS_REPAINT_FALLBACK_COLORS[normalizedTheme] || themeColor;

        const delta = normalizedTheme === 'dark' ? 1 : -1;
        const repaintColor = `#${
            toThemeChromeHexColor(rgb.r + delta)
        }${
            toThemeChromeHexColor(rgb.g + delta)
        }${
            toThemeChromeHexColor(rgb.b + delta)
        }`;

        return repaintColor.toLowerCase() === normalizeThemeChromeColor(themeColor).toLowerCase()
            ? IOS_REPAINT_FALLBACK_COLORS[normalizedTheme] || themeColor
            : repaintColor;
    }

    function getThemeChromeColorOverride(theme) {
        const normalizedTheme = normalizeTheme(theme);
        const overrideMeta = document.querySelector(THEME_CHROME_OVERRIDE_SELECTOR);
        if (!overrideMeta) return '';

        return normalizeThemeChromeColor(
            overrideMeta.getAttribute(`data-${normalizedTheme}`)
            || (normalizedTheme === 'light' ? overrideMeta.getAttribute('content') : '')
        );
    }

    function getThemeChromeColor(theme) {
        const normalizedTheme = normalizeTheme(theme);
        return getThemeChromeColorOverride(normalizedTheme) || THEME_CHROME_COLORS[normalizedTheme];
    }

    function getCurrentTheme() {
        return normalizeTheme(document.documentElement.getAttribute('data-theme'));
    }

    function ensureThemeColorMeta() {
        let metaTheme = document.querySelector(THEME_COLOR_SELECTOR);
        if (metaTheme) return metaTheme;

        metaTheme = document.createElement('meta');
        metaTheme.setAttribute('name', 'theme-color');
        document.head.appendChild(metaTheme);
        return metaTheme;
    }

    function ensureColorSchemeMeta() {
        let metaScheme = document.querySelector(COLOR_SCHEME_SELECTOR);
        if (metaScheme) return metaScheme;

        metaScheme = document.createElement('meta');
        metaScheme.setAttribute('name', 'color-scheme');
        document.head.appendChild(metaScheme);
        return metaScheme;
    }

    function isIOSWebKit() {
        const platform = navigator.platform || '';
        const userAgent = navigator.userAgent || '';
        return /iP(ad|hone|od)/.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function shouldUseSyntheticMenuTap() {
        if (!isIOSWebKit()) return false;

        const viewportWidth = Math.min(
            window.innerWidth || Number.POSITIVE_INFINITY,
            window.visualViewport?.width || Number.POSITIVE_INFINITY,
            screen.width || Number.POSITIVE_INFINITY
        );

        return !Number.isFinite(viewportWidth) || viewportWidth < 900;
    }

    function isIOSMobileViewport(maxWidth = 900) {
        if (!isIOSWebKit()) return false;

        const viewportWidth = Math.min(
            window.innerWidth || Number.POSITIVE_INFINITY,
            window.visualViewport?.width || Number.POSITIVE_INFINITY,
            screen.width || Number.POSITIVE_INFINITY
        );

        return !Number.isFinite(viewportWidth) || viewportWidth < maxWidth;
    }

    function hasThemeRestoreAttribute(metaTheme) {
        return THEME_RESTORE_ATTRIBUTES.some((attributeName) => metaTheme?.hasAttribute(attributeName));
    }

    function syntheticThemeChromeMenuTap(theme = getCurrentTheme()) {
        if (!shouldUseSyntheticMenuTap()) return;

        const root = document.documentElement;
        const body = document.body;
        const hamburger = document.querySelector('.nav-hamburger');
        const mobileMenu = document.querySelector('.mobile-menu');
        const normalizedTheme = normalizeTheme(theme);

        if (!hamburger || !mobileMenu || mobileMenu.classList.contains('active') || hamburger.classList.contains('active')) {
            return;
        }

        applyThemeChrome(normalizedTheme, { forceRepaint: true });
        root.classList.add('site-theme-synthetic-menu-tap');
        body?.classList.add('site-theme-synthetic-menu-tap');

        hamburger.click();
        void root.offsetHeight;
        void mobileMenu.offsetHeight;

        const closeSyntheticMenuTap = () => {
            if (mobileMenu.classList.contains('active') || hamburger.classList.contains('active')) {
                hamburger.click();
            }

            root.classList.remove('site-theme-synthetic-menu-tap');
            body?.classList.remove('site-theme-synthetic-menu-tap');
            applyThemeChrome(normalizedTheme, { forceRepaint: true });
        };

        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                window.setTimeout(closeSyntheticMenuTap, 0);
            });
        } else {
            window.setTimeout(closeSyntheticMenuTap, 12);
        }
    }

    function createThemeColorMeta(themeColor, sourceMeta = null) {
        const nextMeta = document.createElement('meta');
        nextMeta.setAttribute('name', 'theme-color');
        nextMeta.setAttribute('content', themeColor);
        nextMeta.setAttribute('data-site-theme-color', themeColor);

        ['data-original-content', 'data-mobile-theme-lock', ...THEME_RESTORE_ATTRIBUTES].forEach((attributeName) => {
            const value = sourceMeta?.getAttribute(attributeName);
            if (value !== null && value !== undefined) {
                nextMeta.setAttribute(attributeName, value);
            }
        });

        return nextMeta;
    }

    function replaceThemeColorMeta(metaTheme, themeColor) {
        const nextMeta = createThemeColorMeta(themeColor, metaTheme);

        if (metaTheme?.parentNode) {
            metaTheme.parentNode.insertBefore(nextMeta, metaTheme);
            metaTheme.parentNode.removeChild(metaTheme);
            return nextMeta;
        }

        document.head.appendChild(nextMeta);
        return nextMeta;
    }

    function writeThemeColor(metaTheme, theme, themeColor, forceRepaint) {
        if (!metaTheme) return null;

        const currentColor = metaTheme.getAttribute('content') || '';
        const shouldRepaint = forceRepaint || currentColor !== themeColor;

        if (!isIOSWebKit()) {
            metaTheme.setAttribute('content', themeColor);
            metaTheme.setAttribute('data-site-theme-color', themeColor);
            return metaTheme;
        }

        if (!shouldRepaint) return metaTheme;

        const repaintColor = getIOSRepaintColor(theme, themeColor);
        const repaintId = `${Date.now()}-${Math.random()}`;
        const scheduleFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback) => setTimeout(callback, 0);
        const repaintMeta = replaceThemeColorMeta(metaTheme, repaintColor);

        repaintMeta.setAttribute('data-site-theme-repaint', repaintId);
        repaintMeta.setAttribute('data-site-theme-color', themeColor);
        scheduleFrame(() => {
            setTimeout(() => {
                const currentMeta = document.querySelector(THEME_COLOR_SELECTOR);
                if (!currentMeta?.isConnected || currentMeta.getAttribute('data-site-theme-repaint') !== repaintId) return;

                const finalMeta = replaceThemeColorMeta(currentMeta, themeColor);
                finalMeta.removeAttribute('data-site-theme-repaint');
            }, 40);
        });

        return repaintMeta;
    }

    function applyDocumentChrome(theme, themeColor) {
        const root = document.documentElement;
        const metaScheme = ensureColorSchemeMeta();

        root.style.colorScheme = theme;
        root.style.backgroundColor = themeColor;
        root.style.setProperty('--site-theme-chrome-color', themeColor);
        root.setAttribute('data-site-theme-chrome', theme);

        if (metaScheme) {
            metaScheme.setAttribute('content', theme);
        }
    }

    function applyThemeChrome(theme, options = {}) {
        const normalizedTheme = normalizeTheme(theme);
        const themeColor = getThemeChromeColor(normalizedTheme);
        const metaTheme = ensureThemeColorMeta();

        applyDocumentChrome(normalizedTheme, themeColor);

        if (!metaTheme) return;

        if (metaTheme.hasAttribute('data-chat-theme-restore')) {
            metaTheme.setAttribute('data-chat-theme-restore', themeColor);
            return;
        }

        if (hasThemeRestoreAttribute(metaTheme)) {
            return;
        }

        if (metaTheme.hasAttribute('data-original-content') && !metaTheme.hasAttribute('data-mobile-theme-lock')) {
            metaTheme.setAttribute('data-original-content', themeColor);
            return;
        }

        if (metaTheme.hasAttribute('data-original-content')) {
            metaTheme.setAttribute('data-original-content', themeColor);
        }

        writeThemeColor(metaTheme, normalizedTheme, themeColor, Boolean(options.forceRepaint));
    }

    function normalizeModalChromeTargets(targets = []) {
        const rawTargets = Array.isArray(targets) ? targets : [targets];
        return rawTargets
            .flatMap((target) => {
                if (!target) return [];
                if (typeof target === 'string') {
                    return Array.from(document.querySelectorAll(target));
                }
                if (target instanceof Element) return [target];
                if (typeof target.length === 'number') return Array.from(target).filter((item) => item instanceof Element);
                return [];
            })
            .filter((target, index, all) => target?.isConnected && all.indexOf(target) === index);
    }

    function normalizeClassList(value = '') {
        return String(value || '')
            .split(/\s+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function lockSiteModalThemeColor(options = {}) {
        const maxWidth = Math.max(320, Number(options.maxWidth || 900) || 900);
        if (options.mobileOnly !== false && !isIOSMobileViewport(maxWidth)) return false;

        const restoreAttribute = String(options.restoreAttribute || SITE_MODAL_THEME_RESTORE_ATTRIBUTE);
        const metaTheme = ensureThemeColorMeta();
        if (!metaTheme) return false;

        if (siteModalThemeRestoreTimerId) {
            clearTimeout(siteModalThemeRestoreTimerId);
            siteModalThemeRestoreTimerId = null;
        }

        const theme = getCurrentTheme();
        const themeColor = normalizeThemeChromeColor(options.themeColor) || metaTheme.getAttribute('content') || getThemeChromeColor(theme);
        if (!metaTheme.hasAttribute(restoreAttribute)) {
            metaTheme.setAttribute(restoreAttribute, metaTheme.getAttribute('content') || themeColor);
        }
        metaTheme.setAttribute('content', themeColor);
        return true;
    }

    function clearSiteModalThemeColor(options = {}) {
        const maxWidth = Math.max(320, Number(options.maxWidth || 900) || 900);
        if (options.mobileOnly !== false && !isIOSMobileViewport(maxWidth)) return false;

        const restoreAttribute = String(options.restoreAttribute || SITE_MODAL_THEME_RESTORE_ATTRIBUTE);
        const metaTheme = document.querySelector(THEME_COLOR_SELECTOR);
        if (!metaTheme) return false;

        if (siteModalThemeRestoreTimerId) {
            clearTimeout(siteModalThemeRestoreTimerId);
            siteModalThemeRestoreTimerId = null;
        }

        const theme = getCurrentTheme();
        const restoreContent = metaTheme.getAttribute(restoreAttribute) || metaTheme.getAttribute('content') || getThemeChromeColor(theme);
        metaTheme.setAttribute(restoreAttribute, restoreContent);
        metaTheme.removeAttribute('content');

        const restoreDelayMs = Math.max(50, Math.trunc(Number(options.restoreDelayMs || 0) || 320));
        const onRestore = typeof options.onRestore === 'function' ? options.onRestore : null;
        siteModalThemeRestoreTimerId = setTimeout(() => {
            siteModalThemeRestoreTimerId = null;
            if (!metaTheme.isConnected) return;
            metaTheme.setAttribute('content', restoreContent);
            metaTheme.removeAttribute(restoreAttribute);
            if (onRestore) {
                onRestore(metaTheme, restoreContent);
            } else if (options.restoreThemeChrome !== false) {
                applyThemeChrome(getCurrentTheme(), { forceRepaint: true });
            }
        }, restoreDelayMs);

        return true;
    }

    function runSiteModalCloseChromeCleanup(options = {}) {
        const maxWidth = Math.max(320, Number(options.maxWidth || 900) || 900);
        if (options.mobileOnly !== false && !isIOSMobileViewport(maxWidth)) return false;

        if (siteModalForceHiddenTimerId) {
            clearTimeout(siteModalForceHiddenTimerId);
            siteModalForceHiddenTimerId = null;
        }
        if (typeof siteModalForceHiddenCleanup === 'function') {
            siteModalForceHiddenCleanup();
            siteModalForceHiddenCleanup = null;
        }

        const targets = normalizeModalChromeTargets(options.targets || []);
        const targetClassNames = normalizeClassList(options.forceHiddenClass || options.targetClass || '');
        const bodyClassNames = normalizeClassList(options.bodyClass || '');

        targets.forEach((target) => {
            targetClassNames.forEach((className) => target.classList.add(className));
        });
        bodyClassNames.forEach((className) => document.body?.classList.add(className));

        targets.forEach((target) => {
            void target.offsetHeight;
        });

        clearSiteModalThemeColor(options);

        const forceHiddenDurationMs = Math.max(80, Math.trunc(Number(options.forceHiddenDurationMs || 0) || 360));
        siteModalForceHiddenCleanup = () => {
            targets.forEach((target) => {
                targetClassNames.forEach((className) => target.classList.remove(className));
            });
            bodyClassNames.forEach((className) => document.body?.classList.remove(className));
        };
        siteModalForceHiddenTimerId = setTimeout(() => {
            siteModalForceHiddenTimerId = null;
            if (typeof siteModalForceHiddenCleanup === 'function') {
                siteModalForceHiddenCleanup();
                siteModalForceHiddenCleanup = null;
            }
        }, forceHiddenDurationMs);

        return true;
    }

    let theme = 'light';

    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || savedTheme === 'light') {
            theme = savedTheme;
        }
    } catch (error) {
        console.warn('[ThemePreload] Failed to read theme preference:', error);
    }

    document.documentElement.setAttribute('data-theme', theme);
    applyThemeChrome(theme);
    if (typeof MutationObserver === 'function') {
        const themeObserver = new MutationObserver(() => {
            applyThemeChrome(getCurrentTheme(), { forceRepaint: true });
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    window.addEventListener('pageshow', () => applyThemeChrome(getCurrentTheme(), { forceRepaint: true }));
    window.addEventListener('focus', () => applyThemeChrome(getCurrentTheme(), { forceRepaint: true }));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            applyThemeChrome(getCurrentTheme(), { forceRepaint: true });
        }
    });
    window.getSiteThemeChromeColor = getThemeChromeColor;
    window.syntheticThemeChromeMenuTap = syntheticThemeChromeMenuTap;
    window.applySiteThemeChrome = applyThemeChrome;
    window.SITE_MODAL_THEME_RESTORE_ATTRIBUTE = SITE_MODAL_THEME_RESTORE_ATTRIBUTE;
    window.lockSiteModalThemeColor = lockSiteModalThemeColor;
    window.clearSiteModalThemeColor = clearSiteModalThemeColor;
    window.runSiteModalCloseChromeCleanup = runSiteModalCloseChromeCleanup;
    window.isIOSMobileViewportForModalChrome = isIOSMobileViewport;
}());
