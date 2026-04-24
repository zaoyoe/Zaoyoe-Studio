(function () {
    'use strict';

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
}());
