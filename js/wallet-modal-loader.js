(function (global) {
    'use strict';

    if (global.__zaoyoeWalletModalBootstrapLoaded) {
        return;
    }
    global.__zaoyoeWalletModalBootstrapLoaded = true;

    const VERSION = '20260504_USDT_DIRECT_CHECKOUT_1';
    const POINTS_SERVICE_SRC = 'js/services/PointsService.js?v=20260430_WALLET_GUIDANCE_BILINGUAL_1';
    const WALLET_MODAL_SRC = 'js/components/WalletModal.js?v=20260504_USDT_DIRECT_CHECKOUT_1';
    const POLL_INTERVAL_MS = 100;
    const MAX_WAIT_MS = 10000;

    let pointsServiceWarmPromise = null;
    let walletWarmPromise = null;
    let walletPollTimer = null;

    function hasPointsService() {
        return Boolean(global.PointsService && typeof global.PointsService.getBalance === 'function');
    }

    function hasWalletModal() {
        return Boolean(global.WalletModal && typeof global.WalletModal.open === 'function');
    }

    function stopWalletPolling() {
        if (walletPollTimer) {
            clearInterval(walletPollTimer);
            walletPollTimer = null;
        }
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

    function ensurePointsServiceReady() {
        if (hasPointsService()) {
            return Promise.resolve(global.PointsService);
        }

        if (!pointsServiceWarmPromise) {
            pointsServiceWarmPromise = loadScript(POINTS_SERVICE_SRC).then(() => global.PointsService || null);
        }

        return pointsServiceWarmPromise;
    }

    function waitForWalletModal() {
        if (hasWalletModal()) {
            return Promise.resolve(global.WalletModal);
        }

        const startedAt = Date.now();
        return new Promise((resolve, reject) => {
            stopWalletPolling();
            walletPollTimer = setInterval(() => {
                if (hasWalletModal()) {
                    stopWalletPolling();
                    resolve(global.WalletModal);
                    return;
                }

                if (Date.now() - startedAt >= MAX_WAIT_MS) {
                    stopWalletPolling();
                    reject(new Error('Timed out waiting for WalletModal'));
                }
            }, POLL_INTERVAL_MS);
        });
    }

    function ensureWalletModalReady() {
        if (hasWalletModal()) {
            return Promise.resolve(global.WalletModal);
        }

        if (!walletWarmPromise) {
            walletWarmPromise = Promise.all([
                ensurePointsServiceReady(),
                loadScript(WALLET_MODAL_SRC)
            ]).then(() => waitForWalletModal());
        }

        return walletWarmPromise;
    }

    function warmWalletOverview(options = {}) {
        return ensurePointsServiceReady().then((pointsService) => {
            if (options.prefetch !== false && typeof pointsService?.getBalance === 'function') {
                return Promise.resolve(pointsService.getBalance({
                    site: options.site || global.SiteConfig?.site || 'cn'
                })).catch((error) => {
                    console.warn('[WalletLoader] Failed to prefetch wallet overview:', error?.message || error);
                }).then(() => pointsService);
            }
            return pointsService;
        });
    }

    function warmWalletModal(options = {}) {
        return ensureWalletModalReady().then((walletModal) => {
            if (options.prefetch !== false && typeof walletModal?.prefetchData === 'function') {
                walletModal.prefetchData();
            }
            return walletModal;
        });
    }

    function openWalletModal(view = 'balance', context = {}) {
        return ensureWalletModalReady().then((walletModal) => {
            walletModal?.open?.(view, context);
            return walletModal;
        });
    }

    global.ZaoyoeWalletModalBootstrap = Object.freeze({
        version: VERSION,
        ensurePointsService: ensurePointsServiceReady,
        ensure: ensureWalletModalReady,
        warmOverview: warmWalletOverview,
        warm: warmWalletModal,
        open: openWalletModal
    });
}(typeof window !== 'undefined' ? window : globalThis));
