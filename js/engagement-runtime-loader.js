(function (global) {
    'use strict';

    if (global.__zaoyoeEngagementRuntimeBootstrapLoaded) {
        return;
    }
    global.__zaoyoeEngagementRuntimeBootstrapLoaded = true;

    const VERSION = '20260421_PUBLIC_ENGAGEMENT_LAZY_BOOTSTRAP_P1';
    const NOTIFICATION_SRC = 'notification-client.js?v=20260410_NOTIFICATION_ADMIN_PERSONAL_FIX_1';
    const ANNOUNCEMENT_SRC = 'announcement-loader.js?v=20260410_ANNOUNCEMENT_BACKDROP_DISMISS_FIX_1';
    const IDLE_TIMEOUT_MS = 1800;

    let warmPromise = null;
    let idleWarmScheduled = false;
    let notificationInitScheduled = false;

    function getBootstrapScript() {
        return document.currentScript
            || document.querySelector(`script[src*="js/engagement-runtime-loader.js?v=${VERSION}"]`)
            || document.querySelector('script[src*="js/engagement-runtime-loader.js"]');
    }

    const bootstrapScript = getBootstrapScript();
    const shouldLoadNotification = bootstrapScript?.dataset.loadNotification !== '0';
    const shouldLoadAnnouncement = bootstrapScript?.dataset.loadAnnouncement === '1';

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

    function scheduleNotificationInit() {
        if (notificationInitScheduled || document.readyState === 'loading') {
            return;
        }

        if (typeof global.initNotificationSystem !== 'function') {
            return;
        }

        notificationInitScheduled = true;
        global.setTimeout(() => {
            Promise.resolve(global.initNotificationSystem()).catch((error) => {
                console.warn('[EngagementLoader] Failed to initialize notification runtime:', error?.message || error);
            });
        }, 180);
    }

    function ensureEngagementRuntime() {
        if (typeof global.activateDeferredStyleGroup === 'function') {
            global.activateDeferredStyleGroup('homepage-engagement');
            global.activateDeferredStyleGroup('public-engagement');
        }

        if (!warmPromise) {
            const tasks = [];

            if (shouldLoadNotification) {
                tasks.push(
                    loadScript(NOTIFICATION_SRC).then(() => {
                        scheduleNotificationInit();
                    })
                );
            }

            if (shouldLoadAnnouncement) {
                tasks.push(loadScript(ANNOUNCEMENT_SRC));
            }

            warmPromise = Promise.all(tasks);
        }

        return warmPromise;
    }

    function warmOnIdle() {
        if (idleWarmScheduled) {
            return;
        }
        idleWarmScheduled = true;

        const run = () => {
            void ensureEngagementRuntime();
        };

        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
            return;
        }

        global.setTimeout(run, 900);
    }

    function warmOnInteraction() {
        void ensureEngagementRuntime();
    }

    ['pointerdown', 'keydown', 'touchstart', 'focusin'].forEach((eventName) => {
        document.addEventListener(eventName, warmOnInteraction, { once: true, passive: true });
    });

    if (document.readyState === 'complete') {
        warmOnIdle();
    } else {
        global.addEventListener('load', warmOnIdle, { once: true });
    }

    global.ZaoyoeEngagementRuntimeBootstrap = Object.freeze({
        version: VERSION,
        warm: ensureEngagementRuntime,
        config: Object.freeze({
            notification: shouldLoadNotification,
            announcement: shouldLoadAnnouncement
        })
    });
}(typeof window !== 'undefined' ? window : globalThis));
