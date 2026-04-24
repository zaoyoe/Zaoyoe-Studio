(function (global) {
    'use strict';

    if (global.__zaoyoeProfileModalBootstrapLoaded) {
        return;
    }
    global.__zaoyoeProfileModalBootstrapLoaded = true;

    const VERSION = '20260423_PROFILE_MODAL_LAZY_BOOTSTRAP_P3';
    const PROFILE_TEMPLATE_SRC = 'js/profile-modal-template.js?v=20260423_PROFILE_MODAL_SECURITY_INDICATOR_1';
    const SECURITY_CARDS_SRC = 'security-cards.js?v=20260423_PROFILE_MODAL_SECURITY_INDICATOR_1';
    const PROFILE_MODAL_STYLE_HREF = 'css/profile-modal.css?v=20260424_PUBLIC_LIGHT_MODAL_BACKDROP_1';

    let profileModalPromise = null;

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
            return Promise.resolve(link);
        }

        if (link.__zaoyoeLoadPromise) {
            return link.__zaoyoeLoadPromise;
        }

        const promise = new Promise((resolve, reject) => {
            const handleLoad = () => {
                link.dataset.loaded = '1';
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

    function ensureProfileModalReady() {
        if (document.getElementById('profileModal') && typeof global.switchProfileSecurityPanel === 'function') {
            return ensureProfileModalStyles().then(() => true);
        }

        if (!profileModalPromise) {
            profileModalPromise = Promise.all([
                ensureProfileModalStyles(),
                loadScript(PROFILE_TEMPLATE_SRC),
                loadScript(SECURITY_CARDS_SRC)
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
        ensure: ensureProfileModalReady
    });
}(typeof window !== 'undefined' ? window : globalThis));
