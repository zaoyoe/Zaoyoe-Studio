(function (global) {
    'use strict';

    if (global.__zaoyoeEngagementRuntimeBootstrapLoaded) {
        return;
    }
    global.__zaoyoeEngagementRuntimeBootstrapLoaded = true;

    const VERSION = '20260519_ANNOUNCEMENT_HAIRLINE_1';
    const NOTIFICATION_SRC = 'notification-client.js?v=20260510_NOTIFICATION_SCHEMA_FALLBACK_1';
    const ANNOUNCEMENT_SRC = 'announcement-loader.js?v=20260519_ANNOUNCEMENT_HAIRLINE_1';
    const NOTIFICATION_IDLE_TIMEOUT_MS = 1800;
    const ANNOUNCEMENT_BOOT_DELAY_MS = 0;
    const HOMEPAGE_FIRST_PAINT_EVENT = 'zaoyoe:homepage-first-paint-ready';
    const HOMEPAGE_ANNOUNCEMENT_FALLBACK_MS = 3200;

    let notificationWarmPromise = null;
    let announcementWarmPromise = null;
    let notificationIdleWarmScheduled = false;
    let announcementIdleWarmScheduled = false;
    let notificationInitScheduled = false;
    let announcementGateBound = false;
    let announcementGateTimer = null;

    function getBootstrapScript() {
        return document.currentScript
            || document.querySelector(`script[src*="js/engagement-runtime-loader.js?v=${VERSION}"]`)
            || document.querySelector('script[src*="js/engagement-runtime-loader.js"]');
    }

    const bootstrapScript = getBootstrapScript();
    const shouldLoadNotification = bootstrapScript?.dataset.loadNotification !== '0';
    const shouldLoadAnnouncement = bootstrapScript?.dataset.loadAnnouncement === '1';
    const shouldGateAnnouncementForHomepage = bootstrapScript?.dataset.homepageFirstPaintGated === '1';

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

    function warmAnnouncementAfterHomepageFirstPaint() {
        if (!shouldGateAnnouncementForHomepage) {
            warmAnnouncementEagerly();
            return;
        }

        if (document.documentElement?.dataset.homepageFirstPaintReady === '1') {
            warmAnnouncementEagerly();
            return;
        }

        if (announcementGateBound) {
            return;
        }
        announcementGateBound = true;

        const releaseGate = () => {
            if (announcementGateTimer) {
                global.clearTimeout(announcementGateTimer);
                announcementGateTimer = null;
            }
            global.removeEventListener(HOMEPAGE_FIRST_PAINT_EVENT, releaseGate);
            warmAnnouncementEagerly();
        };

        global.addEventListener(HOMEPAGE_FIRST_PAINT_EVENT, releaseGate, { once: true });
        announcementGateTimer = global.setTimeout(releaseGate, HOMEPAGE_ANNOUNCEMENT_FALLBACK_MS);
    }

    function warmOnInteraction() {
        void ensureEngagementRuntime({ includeAnnouncement: false });
    }

    ['pointerdown', 'keydown', 'touchstart', 'focusin'].forEach((eventName) => {
        document.addEventListener(eventName, warmOnInteraction, { once: true, passive: true });
    });

    if (document.readyState === 'complete') {
        warmNotificationOnIdle();
    } else {
        global.addEventListener('load', () => {
            warmNotificationOnIdle();
        }, { once: true });
    }

    warmAnnouncementAfterHomepageFirstPaint();

    global.ZaoyoeEngagementRuntimeBootstrap = Object.freeze({
        version: VERSION,
        warm: ensureEngagementRuntime,
        warmNotifications: ensureNotificationRuntime,
        warmAnnouncement: ensureAnnouncementRuntime,
        config: Object.freeze({
            notification: shouldLoadNotification,
            announcement: shouldLoadAnnouncement,
            homepageFirstPaintGated: shouldGateAnnouncementForHomepage,
            notificationIdleTimeoutMs: NOTIFICATION_IDLE_TIMEOUT_MS,
            announcementBootDelayMs: ANNOUNCEMENT_BOOT_DELAY_MS,
            homepageAnnouncementFallbackMs: HOMEPAGE_ANNOUNCEMENT_FALLBACK_MS
        })
    });
}(typeof window !== 'undefined' ? window : globalThis));
