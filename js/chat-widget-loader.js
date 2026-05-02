(function (global) {
    'use strict';

    if (global.__zaoyoeChatWidgetBootstrapLoaded) {
        return;
    }
    global.__zaoyoeChatWidgetBootstrapLoaded = true;

    const VERSION = '20260502_CHAT_WIDGET_FAB_PLACEMENT_GUARD_1';
    const SUPPORT_CONFIG_SRC = 'js/support-bot-config.js?v=20260330_SUPPORT_FLOW_1';
    const ADMIN_WORKBENCH_SRC = 'js/admin-workbench.js?v=20260421_ADMIN_WORKBENCH_COMMENTS_OPS_ALERTS_HELPERS_P2';
    const CHAT_WIDGET_SRC = 'js/components/ChatWidget.js?v=20260426_CHAT_WIDGET_OPS_ALERT_LIGHT_GLASS_12';
    const CHAT_WIDGET_CRITICAL_STYLE_ID = 'zaoyoe-chat-widget-fab-placement-guard';
    const POLL_INTERVAL_MS = 125;
    const MAX_WAIT_MS = 10000;

    let pollTimer = null;
    let startedAt = 0;
    let widgetWarmPromise = null;
    let pendingOpen = false;
    let placeholderFab = null;

    function ensurePlaceholderPlacementStyles() {
        if (document.getElementById(CHAT_WIDGET_CRITICAL_STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = CHAT_WIDGET_CRITICAL_STYLE_ID;
        style.textContent = `
/* 20260502_CHAT_WIDGET_FAB_NO_POSITION_SLIDE_1 */
.chat-widget-fab {
    position: fixed;
    top: 85%;
    right: 0;
    width: 92px;
    height: 76px;
    transform: translateY(-50%);
    background: transparent;
    border: 0;
    box-shadow: none;
    display: block;
    cursor: pointer;
    z-index: 9999;
    overflow: visible;
    transition: opacity 0.24s ease;
}

@media (hover: hover) and (pointer: fine) {
    .chat-widget-fab:hover {
        transform: translateY(calc(-50% - 2px));
    }
}

.chat-widget-fab:active {
    transform: translateY(-50%);
}

.chat-widget-fab--peek .chat-widget-fab__robot {
    position: absolute;
    top: 8px;
    right: -8px;
    width: 64px;
    height: 48px;
    transform: translateX(16px) scaleX(0.84) scaleY(1.04) rotate(-4deg);
    transform-origin: 100% 50%;
    transition: filter 240ms ease;
    will-change: auto;
}

.chat-widget-fab--peek .chat-widget-fab__glow {
    position: absolute;
    inset: 8px 10px 4px 4px;
    border-radius: 999px;
    pointer-events: none;
    transition: opacity 240ms ease;
}

.chat-widget-fab--peek .chat-widget-fab__shadow {
    position: absolute;
    right: 18px;
    top: 56px;
    width: 32px;
    height: 9px;
    pointer-events: none;
    transform: scaleX(0.74) translateX(12px);
    transition: opacity 240ms ease;
}

@media (max-width: 768px) {
    .chat-widget-fab {
        top: auto;
        bottom: 30px;
        right: 16px;
        width: 58px;
        height: 52px;
        transform: none;
    }

    .chat-widget-fab:hover,
    .chat-widget-fab:active {
        transform: none;
    }

    .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__robot {
        top: 4px;
        right: 0;
        width: 56px;
        height: 46px;
        transform: none;
        transition: none;
        will-change: auto;
    }

    .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__glow {
        inset: 8px 8px 4px 2px;
        transition: opacity 240ms ease;
    }

    .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__shadow {
        right: 10px;
        top: 42px;
        width: 30px;
        transform: scaleX(0.82);
        transition: opacity 240ms ease;
    }
}
`;

        const chatStylesheet = document.querySelector('link[href*="css/chat-widget.css"]');
        if (chatStylesheet?.parentNode) {
            chatStylesheet.parentNode.insertBefore(style, chatStylesheet);
            return;
        }

        (document.head || document.documentElement).appendChild(style);
    }

    function ensureChatWidgetStyles() {
        ensurePlaceholderPlacementStyles();

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
            if (!isPlaceholderOpenIntent(event)) {
                return;
            }

            event?.preventDefault?.();
            void ensureChatWidgetReady({ open: true });
        };
        const prewarmOnIntent = () => {
            void ensureChatWidgetReady({ open: false });
        };

        fab.addEventListener('pointerdown', openOnIntent);
        fab.addEventListener('touchstart', openOnIntent);
        fab.addEventListener('click', openOnIntent);
        fab.addEventListener('keydown', openOnIntent);
        fab.addEventListener('pointerenter', prewarmOnIntent, { once: true, passive: true });
        fab.addEventListener('focus', prewarmOnIntent, { once: true });
    }

    function startChatWidgetBootstrap() {
        if (hasWidgetInstance()) {
            return;
        }

        ensureChatWidgetStyles();
        createPlaceholderFab();
        bindPlaceholderEvents();
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
