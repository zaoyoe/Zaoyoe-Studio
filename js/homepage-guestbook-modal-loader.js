(function () {
    'use strict';

    const HOMEPAGE_GUESTBOOK_LOADER_VERSION = '20260504_HOME_GUESTBOOK_LOADER_KEYBOARD_RETRACT_1';
    const IOS_CHROME_KEYBOARD_VERSION = '20260514_ALL_KEYBOARD_RELEASE_1';
    const HOMEPAGE_GUESTBOOK_RUNTIME_SOURCES = Object.freeze([
        {
            id: 'guestbook-data-runtime',
            src: './supabase-guestbook-functions.js?v=87e2e3d98e61',
            isReady: () => typeof window.loadGuestbookMessages === 'function'
                && typeof window.addMessage === 'function'
        },
        {
            id: 'guestbook-modal-runtime',
            src: `./js/homepage-guestbook-modal.js?v=87e2e3d98e61&iosChromeKeyboard=${IOS_CHROME_KEYBOARD_VERSION}&inputPaste=20260609_INPUT_PASTE_1`,
            isReady: () => typeof window.openGuestbookModal === 'function'
                && window.openGuestbookModal.__homepageGuestbookIntentStub !== true
        }
    ]);

    let runtimePromise = null;

    function activateGuestbookOverlayStyles() {
        if (typeof window.activateDeferredStyleGroup === 'function') {
            window.activateDeferredStyleGroup('homepage-overlays');
        }
    }

    function findRuntimeScript(runtime) {
        return document.querySelector(`script[data-homepage-guestbook-runtime="${runtime.id}"]`)
            || Array.from(document.scripts || []).find((script) => {
                const src = script.getAttribute('src') || '';
                return src && src === runtime.src;
            })
            || null;
    }

    function loadRuntimeScript(runtime) {
        if (runtime.isReady()) {
            return Promise.resolve();
        }

        const existing = findRuntimeScript(runtime);
        if (existing) {
            if (existing.dataset.homepageGuestbookLoaded === '1' || runtime.isReady()) {
                return Promise.resolve();
            }

            return new Promise((resolve, reject) => {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load ${runtime.src}`)), { once: true });
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = runtime.src;
            script.async = true;
            script.dataset.homepageGuestbookRuntime = runtime.id;
            script.dataset.homepageGuestbookLoader = HOMEPAGE_GUESTBOOK_LOADER_VERSION;
            script.addEventListener('load', () => {
                script.dataset.homepageGuestbookLoaded = '1';
                resolve();
            }, { once: true });
            script.addEventListener('error', () => {
                script.remove();
                reject(new Error(`Failed to load ${runtime.src}`));
            }, { once: true });
            document.head.appendChild(script);
        });
    }

    function loadHomepageGuestbookModalRuntime() {
        activateGuestbookOverlayStyles();

        if (!runtimePromise) {
            runtimePromise = Promise.all(HOMEPAGE_GUESTBOOK_RUNTIME_SOURCES.map(loadRuntimeScript))
                .then(() => {
                    window.dispatchEvent(new CustomEvent('homepageGuestbookRuntimeLoaded'));
                })
                .catch((error) => {
                    runtimePromise = null;
                    throw error;
                });
        }

        return runtimePromise;
    }

    function openGuestbookModalIntentStub() {
        const currentOpen = window.openGuestbookModal;
        if (typeof currentOpen === 'function' && currentOpen.__homepageGuestbookIntentStub !== true) {
            currentOpen();
            return true;
        }

        void loadHomepageGuestbookModalRuntime()
            .then(() => {
                const loadedOpen = window.openGuestbookModal;
                if (typeof loadedOpen === 'function' && loadedOpen.__homepageGuestbookIntentStub !== true) {
                    loadedOpen();
                }
            })
            .catch((error) => {
                console.warn('[HomepageGuestbookLoader] Runtime load failed:', error?.message || error);
                window.location.href = '/guestbook.html';
            });

        return true;
    }

    openGuestbookModalIntentStub.__homepageGuestbookIntentStub = true;

    function prewarmFromIntentEvent(event) {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target?.closest?.('[data-home-open-guestbook="1"], #guestbookModal')) {
            return;
        }

        void loadHomepageGuestbookModalRuntime().catch((error) => {
            console.debug('[HomepageGuestbookLoader] Prewarm skipped:', error?.message || error);
        });
    }

    if (typeof window.openGuestbookModal !== 'function') {
        window.openGuestbookModal = openGuestbookModalIntentStub;
    }

    window.loadHomepageGuestbookModalRuntime = loadHomepageGuestbookModalRuntime;

    document.addEventListener('pointerover', prewarmFromIntentEvent, { passive: true });
    document.addEventListener('focusin', prewarmFromIntentEvent);
    document.addEventListener('touchstart', prewarmFromIntentEvent, { passive: true, capture: true });
}());
