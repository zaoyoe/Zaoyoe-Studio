(function () {
    'use strict';

    const THEME_COLORS = {
        dark: '#000000',
        light: '#f5f7fb'
    };

    function resolveTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function ensureThemeColorMeta() {
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            document.head.appendChild(meta);
        }
        return meta;
    }

    function syncShopThemeColor() {
        const meta = ensureThemeColorMeta();
        const color = THEME_COLORS[resolveTheme()] || THEME_COLORS.light;
        if (meta.getAttribute('content') !== color) {
            meta.setAttribute('content', color);
        }
    }

    function bindThemeObserver() {
        const root = document.documentElement;
        if (!root || root.__shopThemeColorObserverBound) {
            return;
        }

        const observer = new MutationObserver(() => {
            syncShopThemeColor();
        });
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        root.__shopThemeColorObserverBound = true;
    }

    syncShopThemeColor();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindThemeObserver, { once: true });
    } else {
        bindThemeObserver();
    }

    window.addEventListener('pageshow', syncShopThemeColor);
}());
