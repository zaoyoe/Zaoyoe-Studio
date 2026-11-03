(function () {
    'use strict';

    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    try {
        window.scrollTo(0, 0);
    } catch (_) {}

    // 20260515_HOME_HARDREFRESH_STABILITY_1: defer the reset until the next frame so we don't
    // trigger an extra synchronous layout while the head is still parsing critical CSS.
    var resetScroll = function () {
        try {
            window.scrollTo(0, 0);
        } catch (_) {}
    };
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(resetScroll);
    } else {
        window.setTimeout(resetScroll, 0);
    }
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('DOMContentLoaded', resetScroll, { once: true });
        window.addEventListener('pageshow', resetScroll, { once: true });
    }
}());
