(function () {
    'use strict';

    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    // 20260515_HOME_HARDREFRESH_STABILITY_1: defer the reset until the next frame so we don't
    // trigger an extra synchronous layout while the head is still parsing critical CSS.
    var resetScroll = function () { window.scrollTo(0, 0); };
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(resetScroll);
    } else {
        window.setTimeout(resetScroll, 0);
    }
}());
