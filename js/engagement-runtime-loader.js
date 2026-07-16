(function (global) {
    'use strict';

    if (global.__zaoyoeEngagementRuntimeBootstrapLoaded) {
        return;
    }
    global.__zaoyoeEngagementRuntimeBootstrapLoaded = true;

    const VERSION = '20260519_ANNOUNCEMENT_HAIRLINE_1';
    const NOTIFICATION_SRC = 'notification-client.js?v=87e2e3d98e61';
    const ANNOUNCEMENT_SRC = 'announcement-loader.js?v=87e2e3d98e61';
    const NOTIFICATION_IDLE_TIMEOUT_MS = 1800;
    const ANNOUNCEMENT_BOOT_DELAY_MS = 0;

    let notificationWarmPromise = null;
    let announcementWarmPromise = null;
    let notificationIdleWarmScheduled = false;
    let announcementIdleWarmScheduled = false;
    let notificationInitScheduled = false;

    function getBootstrapScript() {
        return document.currentScript
            || document.querySelector(`script[src*="js/engagement-runtime-loader.js?v=87e2e3d98e61"]`)
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

    function activateEngagementStyles() {
        if (typeof global.activateDeferredStyleGroup === 'function') {
            global.activateDeferredStyleGroup('homepage-engagement');
            global.activateDeferredStyleGroup('public-engagement');
        }
    }

    function ensureNotificationRuntime() {
        activateEngagementStyles();

        if (!shouldLoadNotification) {
            return Promise.resolve();
        }

        if (!notificationWarmPromise) {
            notificationWarmPromise = loadScript(NOTIFICATION_SRC).then(() => {
                scheduleNotificationInit();
            });
        }

        return notificationWarmPromise;
    }

    function ensureAnnouncementRuntime() {
        activateEngagementStyles();

        if (!shouldLoadAnnouncement) {
            return Promise.resolve();
        }

        if (!announcementWarmPromise) {
            announcementWarmPromise = loadScript(ANNOUNCEMENT_SRC);
        }

        return announcementWarmPromise;
    }

    function ensureEngagementRuntime(options = {}) {
        const includeAnnouncement = options.includeAnnouncement !== false;
        const tasks = [];

        if (shouldLoadNotification) {
            tasks.push(ensureNotificationRuntime());
        }

        if (shouldLoadAnnouncement && includeAnnouncement) {
            tasks.push(ensureAnnouncementRuntime());
        }

        return Promise.all(tasks);
    }

    function scheduleIdleWarm(callback, timeoutMs) {
        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(callback, { timeout: timeoutMs });
            return;
        }

        global.setTimeout(callback, timeoutMs);
    }

    function warmNotificationOnIdle() {
        if (notificationIdleWarmScheduled) {
            return;
        }
        notificationIdleWarmScheduled = true;

        const run = () => {
            void ensureNotificationRuntime();
        };

        scheduleIdleWarm(run, NOTIFICATION_IDLE_TIMEOUT_MS);
    }

    function warmAnnouncementEagerly() {
        if (announcementIdleWarmScheduled || !shouldLoadAnnouncement) {
            return;
        }
        announcementIdleWarmScheduled = true;

        const run = () => {
            void ensureAnnouncementRuntime();
        };

        if (ANNOUNCEMENT_BOOT_DELAY_MS > 0) {
            global.setTimeout(run, ANNOUNCEMENT_BOOT_DELAY_MS);
            return;
        }

        run();
    }

    function warmOnInteraction() {
        void ensureEngagementRuntime({ includeAnnouncement: false });
    }

    ['pointerdown', 'keydown', 'touchstart', 'focusin'].forEach((eventName) => {
        document.addEventListener(eventName, warmOnInteraction, { once: true, passive: true });
    });

    if (document.readyState === 'complete') {
        warmNotificationOnIdle();
        warmAnnouncementEagerly();
    } else {
        global.addEventListener('load', () => {
            warmNotificationOnIdle();
        }, { once: true });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                warmAnnouncementEagerly();
            }, { once: true });
        } else {
            warmAnnouncementEagerly();
        }
    }

    warmAnnouncementEagerly();

    global.ZaoyoeEngagementRuntimeBootstrap = Object.freeze({
        version: VERSION,
        warm: ensureEngagementRuntime,
        warmNotifications: ensureNotificationRuntime,
        warmAnnouncement: ensureAnnouncementRuntime,
        config: Object.freeze({
            notification: shouldLoadNotification,
            announcement: shouldLoadAnnouncement,
            notificationIdleTimeoutMs: NOTIFICATION_IDLE_TIMEOUT_MS,
            announcementBootDelayMs: ANNOUNCEMENT_BOOT_DELAY_MS
        })
    });
}(typeof window !== 'undefined' ? window : globalThis));
