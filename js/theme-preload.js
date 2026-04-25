(function () {
    'use strict';

    const THEME_CHROME_COLORS = {
        light: '#f8fafc',
        dark: '#000000'
    };

    function applyThemeChrome(theme) {
        const normalizedTheme = theme === 'light' ? 'light' : 'dark';
        const themeColor = THEME_CHROME_COLORS[normalizedTheme];
        const metaTheme = document.querySelector('meta[name="theme-color"]');

        document.documentElement.style.colorScheme = normalizedTheme;

        if (!metaTheme) return;

        if (metaTheme.hasAttribute('data-original-content')) {
            metaTheme.setAttribute('data-original-content', themeColor);
            return;
        }

        metaTheme.content = themeColor;
    }

    let theme = 'light';

    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || savedTheme === 'light') {
            theme = savedTheme;
        } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
            theme = 'dark';
        }
    } catch (error) {
        console.warn('[ThemePreload] Failed to read theme preference:', error);
    }

    document.documentElement.setAttribute('data-theme', theme);
    applyThemeChrome(theme);
    window.applySiteThemeChrome = applyThemeChrome;
}());
