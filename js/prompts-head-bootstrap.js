(function () {
    'use strict';

    const root = document.documentElement;
    if (root) {
        root.classList.add('prompts-gallery-pending');
    }

    const THEME_COLOR = '#000000';

    function ensureThemeColorBlack() {
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            document.head.appendChild(meta);
        }

        if (meta.getAttribute('content') !== THEME_COLOR) {
            meta.setAttribute('content', THEME_COLOR);
        }

        return meta;
    }

    function observeThemeColor() {
        const meta = ensureThemeColorBlack();
        if (!meta || meta.__promptThemeObserverBound) {
            return;
        }

        const attributeObserver = new MutationObserver(() => {
            if (meta.getAttribute('content') !== THEME_COLOR) {
                meta.setAttribute('content', THEME_COLOR);
            }
        });
        attributeObserver.observe(meta, { attributes: true, attributeFilter: ['content'] });
        meta.__promptThemeObserverBound = true;

        const headObserver = new MutationObserver(() => {
            ensureThemeColorBlack();
        });
        headObserver.observe(document.head, { childList: true, subtree: true });
    }

    window.__forcePromptThemeColorBlack = ensureThemeColorBlack;
    ensureThemeColorBlack();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeThemeColor, { once: true });
    } else {
        observeThemeColor();
    }

    window.addEventListener('pageshow', ensureThemeColorBlack);
    window.addEventListener('focus', ensureThemeColorBlack);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            ensureThemeColorBlack();
        }
    });
}());

(function () {
    'use strict';

    const navEntry = performance.getEntriesByType?.('navigation')?.[0];
    const navigationType = navEntry?.type
        || (performance.navigation?.type === 2
            ? 'back_forward'
            : performance.navigation?.type === 1
                ? 'reload'
                : 'navigate');
    const shouldLockToTop = navigationType !== 'back_forward';

    const forceTop = () => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    };

    const releaseTopLock = () => {
        if (!window.__PROMPTS_TOP_LOCK_ACTIVE__) {
            return;
        }

        window.__PROMPTS_TOP_LOCK_ACTIVE__ = false;
        window.__PROMPTS_FORCE_SCROLL_TOP__ = false;

        window.removeEventListener('scroll', clampTop);
        window.removeEventListener('touchstart', releaseTopLock);
        window.removeEventListener('wheel', releaseTopLock);
        window.removeEventListener('keydown', releaseTopLock);
    };

    const clampTop = () => {
        if (!window.__PROMPTS_TOP_LOCK_ACTIVE__) {
            return;
        }

        if ((window.scrollY || window.pageYOffset || 0) !== 0 || window.scrollX !== 0) {
            forceTop();
        }
    };

    window.__PROMPTS_FORCE_SCROLL_TOP__ = Boolean(shouldLockToTop);
    window.__PROMPTS_FORCE_SCROLL_TOP_FN__ = forceTop;
    window.__PROMPTS_TOP_LOCK_ACTIVE__ = Boolean(shouldLockToTop);

    if (!shouldLockToTop) {
        return;
    }

    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    forceTop();

    window.addEventListener('scroll', clampTop, { passive: true });
    window.addEventListener('touchstart', releaseTopLock, { passive: true });
    window.addEventListener('wheel', releaseTopLock, { passive: true });
    window.addEventListener('keydown', releaseTopLock);

    window.addEventListener('load', () => {
        forceTop();
        requestAnimationFrame(forceTop);
        setTimeout(forceTop, 250);
        setTimeout(forceTop, 800);
        setTimeout(releaseTopLock, 2200);
    }, { once: true });
}());
