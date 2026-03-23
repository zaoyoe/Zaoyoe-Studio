(function () {
    'use strict';

    let theme = 'dark';

    try {
        theme = localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
    } catch (error) {
        console.warn('[ThemePreload] Failed to read theme preference:', error);
    }

    document.documentElement.setAttribute('data-theme', theme);
}());
