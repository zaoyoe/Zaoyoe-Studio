(function (global) {
    'use strict';

    if (global.__zaoyoeProfileModalBootstrapLoaded) {
        return;
    }
    global.__zaoyoeProfileModalBootstrapLoaded = true;

    const VERSION = '20260503_PROFILE_MODAL_CHROME_CLOSE_1';
    const PROFILE_TEMPLATE_SRC = 'js/profile-modal-template.js?v=20260503_PROFILE_MODAL_CHROME_CLOSE_1';
    const SECURITY_CARDS_SRC = 'security-cards.js?v=20260423_PROFILE_MODAL_SECURITY_INDICATOR_1';
    const PROFILE_MODAL_STYLE_HREF = 'css/profile-modal.css?v=20260503_PROFILE_MODAL_CHROME_CLOSE_1&componentSelectGuard=20260530_PUBLIC_COMPONENT_SELECT_GUARD_1&inputPaste=20260609_INPUT_PASTE_1';

    let profileModalPromise = null;
    let profileTemplatePromise = null;
    let profileSecurityPromise = null;
    const PROFILE_MODAL_CRITICAL_CLASS = 'profile-modal-critical-pending';

    function waitForDomReady() {
        if (document.readyState !== 'loading') {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
    }

    function ensureProfileModalCriticalStyles() {
        document.documentElement.classList.add(PROFILE_MODAL_CRITICAL_CLASS);

        if (document.getElementById('profileModalCriticalStyles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'profileModalCriticalStyles';
        style.textContent = `
html.${PROFILE_MODAL_CRITICAL_CLASS} #profileModal:not(.active) {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
}
html.${PROFILE_MODAL_CRITICAL_CLASS} #profileModal.active {
    position: fixed;
    inset: 0;
    z-index: 12000;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 24px;
    background: var(--app-modal-backdrop, rgba(31, 76, 118, 0.20));
    backdrop-filter: var(--app-modal-backdrop-filter, blur(8px) saturate(108%));
    -webkit-backdrop-filter: var(--app-modal-backdrop-filter, blur(8px) saturate(108%));
}
html.${PROFILE_MODAL_CRITICAL_CLASS} #profileModal .modal-content.profile-modal {
    width: min(400px, 90vw);
    max-height: min(760px, calc(100dvh - 32px));
    overflow: auto;
    box-sizing: border-box;
    background: #0f172a;
    color: #fff;
    border-radius: 28px;
}`;
        (document.head || document.documentElement).appendChild(style);
    }

    function markProfileModalStylesReady() {
        document.documentElement.classList.remove(PROFILE_MODAL_CRITICAL_CLASS);
    }

    function warnProfileModalWarmup(label, error) {
        console.warn(`Profile modal ${label} warmup failed:`, error?.message || error);
    }

    function loadScript(src) {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === '1' || existing.readyState === 'complete') {
                return Promise.resolve(existing);
            }
            if (existing.__zaoyoeLoadPromise) {
                return existing.__zaoyoeLoadPromise;
            }
        }

        const script = existing || document.createElement('script');
        if (!existing) {
            script.src = src;
            script.async = false;
            script.dataset.loaded = '0';
        }

        const promise = new Promise((resolve, reject) => {
            const handleLoad = () => {
                script.dataset.loaded = '1';
                resolve(script);
            };
            const handleError = () => reject(new Error(`Failed to load ${src}`));

            script.addEventListener('load', handleLoad, { once: true });
            script.addEventListener('error', handleError, { once: true });

            if (!existing) {
                (document.body || document.head || document.documentElement).appendChild(script);
            }
        });

        script.__zaoyoeLoadPromise = promise;
        return promise;
    }

    function findStylesheetByFilename(filename) {
        return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find((node) => {
            const href = node.getAttribute('href') || '';
            return href.split('?')[0].split('/').pop() === filename;
        }) || null;
    }

    function waitForStylesheet(link) {
        if (!link) {
            return Promise.resolve(null);
        }

        if (link.dataset.loaded === '1' || link.sheet) {
            link.dataset.loaded = '1';
            markProfileModalStylesReady();
            return Promise.resolve(link);
        }

        if (link.__zaoyoeLoadPromise) {
            return link.__zaoyoeLoadPromise;
        }

        const promise = new Promise((resolve, reject) => {
            const handleLoad = () => {
                link.dataset.loaded = '1';
                markProfileModalStylesReady();
                resolve(link);
            };
            const handleError = () => reject(new Error(`Failed to load ${link.href || PROFILE_MODAL_STYLE_HREF}`));

            link.addEventListener('load', handleLoad, { once: true });
            link.addEventListener('error', handleError, { once: true });
        });

        link.__zaoyoeLoadPromise = promise;
        return promise;
    }

    function ensureProfileModalStyles() {
        ensureProfileModalCriticalStyles();

        const filename = PROFILE_MODAL_STYLE_HREF.split('?')[0].split('/').pop();
        let link = findStylesheetByFilename(filename);

        if (!link) {
            link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = PROFILE_MODAL_STYLE_HREF;
            link.dataset.loaded = '0';
            (document.head || document.documentElement || document.body).appendChild(link);
        } else if (!link.dataset.loaded) {
            link.dataset.loaded = link.sheet ? '1' : '0';
        }

        if (link.media !== 'all') {
            link.media = 'all';
        }
        link.dataset.deferredStyleActive = '1';

        return waitForStylesheet(link);
    }

    function ensureProfileSecurityRuntime() {
        if (typeof global.switchProfileSecurityPanel === 'function') {
            return Promise.resolve(true);
        }

        if (!profileSecurityPromise) {
            profileSecurityPromise = loadScript(SECURITY_CARDS_SRC).then(() => true).catch((error) => {
                profileSecurityPromise = null;
                throw error;
            });
        }

        return profileSecurityPromise;
    }

    function ensureProfileModalTemplate() {
        ensureProfileModalCriticalStyles();

        if (document.getElementById('profileModal')) {
            return Promise.resolve(true);
        }

        if (!profileTemplatePromise) {
            profileTemplatePromise = loadScript(PROFILE_TEMPLATE_SRC)
                .then(waitForDomReady)
                .then(() => {
                    if (!document.getElementById('profileModal')) {
                        throw new Error('Profile modal template did not mount');
                    }
                    return true;
                })
                .catch((error) => {
                    profileTemplatePromise = null;
                    throw error;
                });
        }

        return profileTemplatePromise;
    }

    function startProfileModalBackgroundWarmup() {
        void ensureProfileModalStyles().catch((error) => warnProfileModalWarmup('style', error));
        void ensureProfileSecurityRuntime().catch((error) => warnProfileModalWarmup('security', error));
    }

    function mountProfileModalFast() {
        startProfileModalBackgroundWarmup();
        return ensureProfileModalTemplate();
    }

    function warmProfileModalRuntime() {
        startProfileModalBackgroundWarmup();
        return ensureProfileModalTemplate();
    }

    function ensureProfileModalReady() {
        if (document.getElementById('profileModal') && typeof global.switchProfileSecurityPanel === 'function') {
            return ensureProfileModalStyles().then(() => true);
        }

        if (!profileModalPromise) {
            profileModalPromise = Promise.all([
                ensureProfileModalStyles(),
                ensureProfileModalTemplate(),
                ensureProfileSecurityRuntime()
            ]).then(() => {
                if (!document.getElementById('profileModal')) {
                    throw new Error('Profile modal template did not mount');
                }
                return true;
            }).catch((error) => {
                profileModalPromise = null;
                throw error;
            });
        }

        return profileModalPromise;
    }

    global.ZaoyoeProfileModalBootstrap = Object.freeze({
        version: VERSION,
        mount: mountProfileModalFast,
        warm: warmProfileModalRuntime,
        ensure: ensureProfileModalReady
    });
}(typeof window !== 'undefined' ? window : globalThis));
