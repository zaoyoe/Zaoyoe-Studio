(function () {
    'use strict';

    const THEME_CHROME_COLORS = {
        light: '#ffffff',
        dark: '#000000'
    };
    const IOS_REPAINT_COLORS = {
        light: '#fffffe',
        dark: '#010101'
    };
    const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';
    const COLOR_SCHEME_SELECTOR = 'meta[name="color-scheme"]';

    function normalizeTheme(theme) {
        return theme === 'dark' ? 'dark' : 'light';
    }

    function getThemeChromeColor(theme) {
        return THEME_CHROME_COLORS[normalizeTheme(theme)];
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

        ['data-original-content', 'data-mobile-theme-lock', 'data-chat-theme-restore'].forEach((attributeName) => {
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

        const repaintColor = IOS_REPAINT_COLORS[theme] || themeColor;
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

        if (metaTheme.hasAttribute('data-original-content') && !metaTheme.hasAttribute('data-mobile-theme-lock')) {
            metaTheme.setAttribute('data-original-content', themeColor);
            return;
        }

        if (metaTheme.hasAttribute('data-original-content')) {
            metaTheme.setAttribute('data-original-content', themeColor);
        }

        writeThemeColor(metaTheme, normalizedTheme, themeColor, Boolean(options.forceRepaint));
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
}());
