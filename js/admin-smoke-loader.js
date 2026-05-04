(function loadAdminLocalSmokeHarness() {
    'use strict';

    let shouldLoad = false;
    try {
        shouldLoad = new URL(window.location.href).searchParams.get('smoke') === '1';
    } catch (_) {
        shouldLoad = false;
    }

    if (!shouldLoad) {
        return;
    }

    const src = 'js/local-smoke-fixtures.js?v=20260504_NOTIFICATION_LOADING_VERTICAL_ONLY_SMOKE_1';
    if (document.readyState === 'loading' && typeof document.write === 'function') {
        document.write(`<script src="${src}"><\/script>`);
        return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    (document.head || document.documentElement || document.body).appendChild(script);
}());
