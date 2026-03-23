(function (global) {
    'use strict';

    if (global.__zaoyoeChatWidgetBootstrapLoaded) {
        return;
    }
    global.__zaoyoeChatWidgetBootstrapLoaded = true;

    const POLL_INTERVAL_MS = 125;
    const MAX_WAIT_MS = 10000;
    let pollTimer = null;
    let startedAt = 0;

    function hasWidgetInstance() {
        return Boolean(global.chatWidget || document.querySelector('.chat-widget-fab'));
    }

    function hasDependencies() {
        return typeof ChatWidget !== 'undefined' && Boolean(global.supabaseClient);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function tryInitChatWidget() {
        if (hasWidgetInstance()) {
            stopPolling();
            return true;
        }

        if (!hasDependencies()) {
            return false;
        }

        try {
            global.chatWidget = new ChatWidget(global.supabaseClient);
            stopPolling();
            return true;
        } catch (error) {
            stopPolling();
            console.error('[ChatWidgetLoader] Failed to initialize chat widget:', error);
            return false;
        }
    }

    function startChatWidgetBootstrap() {
        if (tryInitChatWidget()) {
            return;
        }

        startedAt = Date.now();
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startChatWidgetBootstrap, { once: true });
    } else {
        startChatWidgetBootstrap();
    }
}(typeof window !== 'undefined' ? window : globalThis));
