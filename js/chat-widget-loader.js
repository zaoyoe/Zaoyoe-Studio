(function (global) {
    'use strict';

    if (global.__zaoyoeChatWidgetBootstrapLoaded) {
        return;
    }
    global.__zaoyoeChatWidgetBootstrapLoaded = true;

    const VERSION = '20260423_CHAT_WIDGET_OPS_ALERT_LIGHT_GLASS_LOADER_11';
    const SUPPORT_CONFIG_SRC = 'js/support-bot-config.js?v=20260330_SUPPORT_FLOW_1';
    const ADMIN_WORKBENCH_SRC = 'js/admin-workbench.js?v=20260421_ADMIN_WORKBENCH_COMMENTS_OPS_ALERTS_HELPERS_P2';
    const CHAT_WIDGET_SRC = 'js/components/ChatWidget.js?v=20260423_CHAT_WIDGET_OPS_ALERT_LIGHT_GLASS_11';
    const POLL_INTERVAL_MS = 125;
    const MAX_WAIT_MS = 10000;
    const IDLE_WARMUP_TIMEOUT_MS = 2500;
    const WARMUP_EVENT_NAMES = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

    let pollTimer = null;
    let startedAt = 0;
    let widgetWarmPromise = null;
    let pendingOpen = false;
    let placeholderFab = null;
    let idleWarmupTimer = null;
    let idleWarmupHandle = null;
    const cleanupWarmupListeners = [];

    function ensureChatWidgetStyles() {
        if (typeof global.activateDeferredStyleGroup === 'function') {
            global.activateDeferredStyleGroup('homepage-chat');
            global.activateDeferredStyleGroup('public-chat');
        }
    }

    function hasWidgetInstance() {
        return Boolean(global.chatWidget || document.querySelector('.chat-widget-fab:not([data-chat-widget-placeholder="1"])'));
    }

    function getChatWidgetConstructor() {
        if (typeof global.ChatWidget === 'function') {
            return global.ChatWidget;
        }
        if (typeof ChatWidget === 'function') {
            global.ChatWidget = ChatWidget;
            return ChatWidget;
        }
        return null;
    }

    function isPlaceholderOpenIntent(event) {
        const target = event?.target;
        if (!target || typeof target.closest !== 'function') {
            return false;
        }
        if (!target.closest('.chat-widget-fab[data-chat-widget-placeholder="1"]')) {
            return false;
        }
        if (event?.type === 'keydown') {
            const key = String(event.key || '');
            return key === 'Enter' || key === ' ';
        }
        return event?.type === 'pointerdown' || event?.type === 'touchstart' || event?.type === 'click';
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function clearIdleWarmup() {
        if (idleWarmupTimer) {
            clearTimeout(idleWarmupTimer);
            idleWarmupTimer = null;
        }
        if (typeof global.cancelIdleCallback === 'function' && idleWarmupHandle) {
            global.cancelIdleCallback(idleWarmupHandle);
            idleWarmupHandle = null;
        }
    }

    function teardownWarmupListeners() {
        while (cleanupWarmupListeners.length > 0) {
            const dispose = cleanupWarmupListeners.pop();
            try {
                dispose();
            } catch (_error) {
                // Ignore listener cleanup failures.
            }
        }
    }

    function createPlaceholderFab() {
        ensureChatWidgetStyles();

        if (placeholderFab?.isConnected) {
            return placeholderFab;
        }

        const existingPlaceholder = document.querySelector('.chat-widget-fab[data-chat-widget-placeholder="1"]');
        if (existingPlaceholder) {
            placeholderFab = existingPlaceholder;
            return placeholderFab;
        }

        const fab = document.createElement('div');
        fab.className = 'chat-widget-fab chat-widget-fab--peek chat-widget-fab--ambient-retracted';
        fab.setAttribute('data-chat-widget-placeholder', '1');
        fab.setAttribute('role', 'button');
        fab.setAttribute('tabindex', '0');
        fab.setAttribute('aria-label', '打开支持助手');
        fab.innerHTML = `
            <div class="chat-widget-fab__robot" aria-hidden="true">
                <span class="chat-widget-fab__glow"></span>
                <div class="mascot-wrapper">
                    <div class="mascot-head">
                        <div class="mascot-face">
                            <div class="mascot-eyes">
                                <span class="eye left"></span>
                                <span class="eye right"></span>
                            </div>
                            <div class="mascot-mouth"></div>
                        </div>
                    </div>
                </div>
            </div>
            <span class="chat-widget-fab__shadow" aria-hidden="true"></span>
        `;
        document.body.appendChild(fab);
        placeholderFab = fab;
        return placeholderFab;
    }

    function setPlaceholderLoadingState(loading) {
        const fab = createPlaceholderFab();
        if (!fab) {
            return;
        }

        fab.classList.toggle('chat-widget-fab--disabled', Boolean(loading));
        if (loading) {
            fab.setAttribute('data-chat-widget-loading', '1');
            fab.setAttribute('aria-busy', 'true');
        } else {
            fab.removeAttribute('data-chat-widget-loading');
            fab.removeAttribute('aria-busy');
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

    function warmWidgetResources() {
        if (!widgetWarmPromise) {
            setPlaceholderLoadingState(true);
            widgetWarmPromise = Promise.all([
                loadScript(SUPPORT_CONFIG_SRC),
                loadScript(ADMIN_WORKBENCH_SRC),
                loadScript(CHAT_WIDGET_SRC)
            ]).finally(() => {
                setPlaceholderLoadingState(false);
            });
        }

        return widgetWarmPromise;
    }

    function openWidgetIfPending() {
        if (!pendingOpen || !global.chatWidget || typeof global.chatWidget.toggleChat !== 'function') {
            return;
        }

        if (!global.chatWidget.isOpen) {
            global.chatWidget.toggleChat();
        }
        if (global.chatWidget.isOpen && typeof global.chatWidget.clearUnread === 'function') {
            global.chatWidget.clearUnread();
        }
        pendingOpen = false;
    }

    function tryInitChatWidget() {
        if (global.chatWidget) {
            stopPolling();
            openWidgetIfPending();
            return true;
        }

        const ChatWidgetCtor = getChatWidgetConstructor();
        if (!ChatWidgetCtor || !global.supabaseClient) {
            return false;
        }

        try {
            global.chatWidget = new ChatWidgetCtor(global.supabaseClient);
            stopPolling();
            teardownWarmupListeners();
            clearIdleWarmup();
            openWidgetIfPending();
            return true;
        } catch (error) {
            stopPolling();
            console.error('[ChatWidgetLoader] Failed to initialize chat widget:', error);
            return false;
        }
    }

    function ensureChatWidgetReady(options = {}) {
        const openRequested = options.open === true;
        if (openRequested) {
            pendingOpen = true;
        }

        ensureChatWidgetStyles();
        clearIdleWarmup();
        teardownWarmupListeners();
        createPlaceholderFab();

        return warmWidgetResources().then(() => {
            if (tryInitChatWidget()) {
                return global.chatWidget || null;
            }

            startedAt = Date.now();
            if (!pollTimer) {
                pollTimer = setInterval(() => {
                    if (tryInitChatWidget()) {
                        return;
                    }

                    if (Date.now() - startedAt >= MAX_WAIT_MS) {
                        stopPolling();
                        console.warn('[ChatWidgetLoader] Timed out waiting for ChatWidget dependencies');
                    }
                }, POLL_INTERVAL_MS);
            }

            return null;
        }).catch((error) => {
            console.error('[ChatWidgetLoader] Failed to warm chat widget resources:', error);
            setPlaceholderLoadingState(false);
            throw error;
        });
    }

    function bindPlaceholderEvents() {
        const fab = createPlaceholderFab();
        if (!fab || fab.dataset.chatWidgetPlaceholderBound === '1') {
            return;
        }

        fab.dataset.chatWidgetPlaceholderBound = '1';
        const openOnIntent = (event) => {
            if (event?.type === 'keydown') {
                const key = String(event.key || '');
                if (key !== 'Enter' && key !== ' ') {
                    return;
                }
            }

            event?.preventDefault?.();
            void ensureChatWidgetReady({ open: true });
        };

        fab.addEventListener('click', openOnIntent);
        fab.addEventListener('keydown', openOnIntent);
    }

    function scheduleIdleWarmup() {
        clearIdleWarmup();

        if (typeof global.requestIdleCallback === 'function') {
            idleWarmupHandle = global.requestIdleCallback(() => {
                idleWarmupHandle = null;
                void ensureChatWidgetReady({ open: false });
            }, { timeout: IDLE_WARMUP_TIMEOUT_MS });
            return;
        }

        idleWarmupTimer = global.setTimeout(() => {
            idleWarmupTimer = null;
            void ensureChatWidgetReady({ open: false });
        }, IDLE_WARMUP_TIMEOUT_MS);
    }

    function registerWarmupListeners() {
        const warmHandler = (event) => {
            void ensureChatWidgetReady({ open: isPlaceholderOpenIntent(event) });
        };

        WARMUP_EVENT_NAMES.forEach((eventName) => {
            const listenerOptions = { passive: true, once: true };
            global.addEventListener(eventName, warmHandler, listenerOptions);
            cleanupWarmupListeners.push(() => {
                global.removeEventListener(eventName, warmHandler, listenerOptions);
            });
        });
    }

    function startChatWidgetBootstrap() {
        if (hasWidgetInstance()) {
            return;
        }

        ensureChatWidgetStyles();
        createPlaceholderFab();
        bindPlaceholderEvents();
        registerWarmupListeners();
        scheduleIdleWarmup();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startChatWidgetBootstrap, { once: true });
    } else {
        startChatWidgetBootstrap();
    }

    global.ZaoyoeChatWidgetBootstrap = Object.freeze({
        version: VERSION,
        warm: () => ensureChatWidgetReady({ open: false }),
        open: () => ensureChatWidgetReady({ open: true })
    });
}(typeof window !== 'undefined' ? window : globalThis));
