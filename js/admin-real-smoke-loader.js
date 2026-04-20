(function loadAdminRealSmokeHarness() {
    'use strict';

    let shouldLoad = false;
    try {
        shouldLoad = new URL(window.location.href).searchParams.get('realSmoke') === '1';
    } catch (_) {
        shouldLoad = false;
    }

    if (!shouldLoad) {
        return;
    }

    const src = 'js/admin-real-smoke.js?v=20260402_ADMIN_REAL_SMOKE_9';
    if (document.readyState === 'loading' && typeof document.write === 'function') {
        document.write(`<script src="${src}"><\/script>`);
        return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    (document.head || document.documentElement || document.body).appendChild(script);
}());
