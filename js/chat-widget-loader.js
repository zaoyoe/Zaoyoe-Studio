(function (global) {
    'use strict';

    if (global.__zaoyoeChatWidgetBootstrapLoaded) {
        return;
    }
    global.__zaoyoeChatWidgetBootstrapLoaded = true;

    const VERSION = '20260509_ENGAGEMENT_ORDER_DETAIL_ROUTE_1';
    const SUPPORT_CONFIG_SRC = 'js/support-bot-config.js?v=20260330_SUPPORT_FLOW_1';
    const ADMIN_WORKBENCH_SRC = 'js/admin-workbench.js?v=20260421_ADMIN_WORKBENCH_COMMENTS_OPS_ALERTS_HELPERS_P2';
    const CHAT_WIDGET_SRC = 'js/components/ChatWidget.js?v=20260509_ENGAGEMENT_ORDER_DETAIL_ROUTE_1';
    const CHAT_WIDGET_STYLE_SRC = 'css/chat-widget.css?v=20260507_CHAT_WIDGET_ADAPTIVE_BUBBLE_1';
    const CHAT_WIDGET_CRITICAL_STYLE_ID = 'zaoyoe-chat-widget-fab-placement-guard';
    const CHAT_WIDGET_SHELL_MODE_KEY = 'zaoyoe_chat_widget_last_shell_mode_v1';
    const ADMIN_ACCESS_CACHE_KEY = 'zaoyoe_admin_access_cache_v1';
    const ADMIN_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;
    const POLL_INTERVAL_MS = 125;
    const MAX_WAIT_MS = 10000;
    const BOOTSTRAP_HANDOFF_MAX_WAIT_MS = 720;
    const BOOTSTRAP_HANDOFF_VISIBLE_DELAY_MS = 110;
    const BOOTSTRAP_HANDOFF_FADE_MS = 320;
    const ENGAGEMENT_RUNTIME_WARM_DELAY_MS = 1400;

    let pollTimer = null;
    let startedAt = 0;
    let widgetWarmPromise = null;
    let engagementRuntimeWarmScheduled = false;
    let pendingOpen = false;
    let placeholderFab = null;
    let placeholderSuppressed = false;
    let bootstrapLoadingShell = null;
    let bootstrapLoadingShellRemoveTimer = null;
    let bootstrapScrollLockActive = false;
    let bootstrapDismissToken = 0;
    let bootstrapScript = null;
    let runtimePendingOpenWatcher = null;

    function getBootstrapScript() {
        if (bootstrapScript && bootstrapScript.isConnected) {
            return bootstrapScript;
        }
        bootstrapScript = document.currentScript
            || document.querySelector(`script[src*="js/chat-widget-loader.js?v=${VERSION}"]`)
            || document.querySelector('script[src*="js/chat-widget-loader.js"]');
        return bootstrapScript;
    }

    function getExternalEngagementConfig() {
        const config = global.ZaoyoeExternalEngagementConfig || global.ZaoyoeEngagementExternalConfig || {};
        return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    }

    function getLoaderAssetBase() {
        const config = getExternalEngagementConfig();
        const script = getBootstrapScript();
        const configuredBase = String(config.assetBase || script?.dataset.assetBase || '').trim();
        if (configuredBase) {
            try {
                return new URL(configuredBase, global.location.href).toString().replace(/\/?$/, '/');
            } catch (_) {
                return configuredBase.replace(/\/?$/, '/');
            }
        }

        if (script?.src) {
            try {
                const scriptUrl = new URL(script.src, global.location.href);
                const match = scriptUrl.pathname.match(/^(.*\/)js\/chat-widget-loader\.js$/);
                if (match) {
                    scriptUrl.pathname = match[1];
                    scriptUrl.search = '';
                    scriptUrl.hash = '';
                    return scriptUrl.toString().replace(/\/?$/, '/');
                }
            } catch (_) {
                // Fall through to relative loading.
            }
        }

        return '';
    }

    function resolveAssetUrl(src = '') {
        const rawSrc = String(src || '').trim();
        if (!rawSrc || /^[a-z][a-z0-9+.-]*:/i.test(rawSrc) || rawSrc.startsWith('//')) {
            return rawSrc;
        }
        const assetBase = getLoaderAssetBase();
        if (!assetBase) return rawSrc;
        return new URL(rawSrc.replace(/^\.\//, ''), assetBase).toString();
    }

    function findExistingScriptBySrc(src = '') {
        const resolvedSrc = resolveAssetUrl(src);
        return Array.from(document.scripts || []).find((script) => (
            script.src === resolvedSrc
            || script.getAttribute('src') === resolvedSrc
            || script.getAttribute('src') === src
        )) || null;
    }

    function shouldLoadFullChatWidgetStylesheet() {
        const config = getExternalEngagementConfig();
        return config.externalHost === true || config.external_host === true || String(config.pageId || config.page_id || '').trim() === 'gongyi';
    }

    function ensureFullChatWidgetStylesheet() {
        if (!shouldLoadFullChatWidgetStylesheet()) {
            return;
        }
        const href = resolveAssetUrl(CHAT_WIDGET_STYLE_SRC);
        const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find((link) => (
            link.href === href
            || link.getAttribute('href') === href
            || link.getAttribute('href') === CHAT_WIDGET_STYLE_SRC
        ));
        if (existing) return;

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.engagementExternalStyle = '1';
        (document.head || document.documentElement).appendChild(link);
    }

    function activateChatWidgetStylesheetLinks() {
        const links = Array.from(document.querySelectorAll('link[href*="css/chat-widget.css"]'));
        links.forEach((link) => {
            if (!(link instanceof HTMLLinkElement)) {
                return;
            }

            link.media = 'all';
            link.dataset.deferredStyleActive = '1';
        });
    }

    function ensurePlaceholderPlacementStyles() {
        if (document.getElementById(CHAT_WIDGET_CRITICAL_STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = CHAT_WIDGET_CRITICAL_STYLE_ID;
        style.textContent = `
/* 20260502_CHAT_WIDGET_FAB_NO_POSITION_SLIDE_1 */
/* 20260503_CHAT_WIDGET_SAFARI_HANDOFF_12 */
/* 20260503_CHAT_WIDGET_DESKTOP_NARROW_PEEK_1 */
/* 20260503_CHAT_WIDGET_BOOTSTRAP_SCROLL_LOCK_1 */
/* 20260505_ENGAGEMENT_BUBBLE_READABILITY_1 */
/* 20260509_ENGAGEMENT_ORDER_DETAIL_ROUTE_1 */
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
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
    transition: opacity 0.24s ease;
}

.chat-widget-fab.chat-widget-fab--hidden,
html.chat-widget-bootstrap-loading .chat-widget-fab,
body.chat-widget-bootstrap-loading .chat-widget-fab {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
}

html.chat-widget-open,
body.chat-widget-open,
html.chat-widget-bootstrap-scroll-locked,
body.chat-widget-bootstrap-scroll-locked {
    overflow: hidden !important;
    overscroll-behavior: none !important;
}

.chat-window:not([data-chat-widget-bootstrap-shell="1"]) {
    position: fixed !important;
    right: 30px !important;
    bottom: 100px !important;
    width: 380px !important;
    height: 600px !important;
    max-width: calc(100vw - 32px) !important;
    max-height: 80vh !important;
    min-width: 0 !important;
    min-height: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
    z-index: 9998 !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    transform: translateY(20px) scale(0.95) !important;
    transform-origin: bottom right !important;
}

.chat-window:not([data-chat-widget-bootstrap-shell="1"]).active {
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: all !important;
    transform: translateY(0) scale(1) !important;
}

.chat-window.admin-mode-layout:not([data-chat-widget-bootstrap-shell="1"]) {
    --chat-admin-top-gap: clamp(18px, 4vh, 36px);
    --chat-admin-bottom-gap: 24px;
    top: var(--chat-admin-top-gap) !important;
    right: 30px !important;
    bottom: auto !important;
    width: min(1040px, calc(100vw - 32px)) !important;
    height: min(760px, calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap)))) !important;
    max-width: 97vw !important;
    max-height: calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap))) !important;
    display: flex !important;
    flex-direction: row !important;
    transform: translateY(20px) scale(0.95) !important;
    transform-origin: bottom right !important;
}

.chat-window.admin-mode-layout:not([data-chat-widget-bootstrap-shell="1"]).active {
    transform: translateY(0) scale(1) !important;
}

.chat-window.admin-mode-layout.chat-window--desktop-edge-safe:not([data-chat-widget-bootstrap-shell="1"]) {
    --chat-admin-top-gap: clamp(56px, 9vh, 96px);
    top: 50% !important;
    transform: translateY(calc(-50% + 20px)) scale(0.95) !important;
    transform-origin: center right !important;
}

.chat-window.admin-mode-layout.chat-window--desktop-edge-safe:not([data-chat-widget-bootstrap-shell="1"]).active {
    transform: translateY(-50%) scale(1) !important;
}

@media (max-width: 700px) {
    .chat-window.admin-mode-layout:not([data-chat-widget-bootstrap-shell="1"]) {
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        width: min(460px, max(97vw, calc(100vw - 16px))) !important;
        max-width: 97vw !important;
        height: min(640px, 84vh) !important;
        max-height: 82vh !important;
        border-radius: 20px !important;
        transform: translate3d(-50%, calc(-50% + 24px), 0) scale(0.94) !important;
        transform-origin: center center !important;
    }

    .chat-window.admin-mode-layout:not([data-chat-widget-bootstrap-shell="1"]).active {
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
    }
}

@media (max-width: 480px) {
    .chat-window.admin-mode-layout:not([data-chat-widget-bootstrap-shell="1"]) {
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        width: 97vw !important;
        max-width: 97vw !important;
        height: 78vh !important;
        max-height: 78vh !important;
        border-radius: 16px !important;
        transform: translate3d(-50%, calc(-50% + 24px), 0) scale(0.94) !important;
        transform-origin: center center !important;
    }

    .chat-window.admin-mode-layout:not([data-chat-widget-bootstrap-shell="1"]).active {
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
    }
}

.chat-overlay {
    position: fixed !important;
    inset: 0 !important;
    display: none;
    opacity: 0;
    pointer-events: none;
    z-index: 9997;
}

.chat-overlay.visible {
    display: block !important;
    pointer-events: auto;
}

@media (max-width: 700px) {
    .chat-window:not(.admin-mode-layout):not([data-chat-widget-bootstrap-shell="1"]) {
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        width: min(460px, max(97vw, calc(100vw - 16px))) !important;
        max-width: 97vw !important;
        height: 70vh !important;
        max-height: 600px !important;
        transform: translate3d(-50%, calc(-50% + 24px), 0) scale(0.94) !important;
        transform-origin: center center !important;
    }

    .chat-window:not(.admin-mode-layout):not([data-chat-widget-bootstrap-shell="1"]).active {
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
    }
}

@media (hover: hover) and (pointer: fine) {
    .chat-widget-fab {
        transition:
            opacity 0.24s ease,
            transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .chat-widget-fab:hover {
        transform: translateY(calc(-50% - 2px));
    }
}

.chat-widget-fab:active {
    transform: translateY(-50%);
}

.chat-widget-fab:focus:not(:focus-visible) {
    outline: none;
}

.chat-widget-fab *,
.chat-widget-fab *::before,
.chat-widget-fab *::after {
    -webkit-tap-highlight-color: transparent;
}

.chat-widget-fab--peek .chat-widget-fab__robot {
    position: absolute;
    top: 8px;
    right: -8px;
    width: 64px;
    height: 48px;
    transform: translateX(8px) scaleX(0.84) scaleY(1.04) rotate(-4deg);
    transform-origin: 100% 50%;
    transition:
        transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
        filter 240ms ease;
    will-change: transform, filter;
}

.chat-widget-fab--peek .chat-widget-fab__glow {
    position: absolute;
    inset: 8px 10px 4px 4px;
    border-radius: 999px;
    pointer-events: none;
    transition:
        opacity 280ms ease,
        transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chat-widget-fab--peek .chat-widget-fab__shadow {
    position: absolute;
    right: 18px;
    top: 56px;
    width: 32px;
    height: 9px;
    pointer-events: none;
    transform: scaleX(0.74) translateX(12px);
    transition:
        opacity 280ms ease,
        transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (max-width: 768px) and (hover: none) and (pointer: coarse) {
    .chat-widget-fab {
        --chat-mobile-fab-glass-bg: rgba(0, 0, 0, 0.48);
        --chat-mobile-fab-glass-border: rgba(255, 255, 255, 0.055);
        --chat-mobile-fab-glass-filter: blur(20px) saturate(150%);
        --chat-mobile-fab-glass-shadow:
            0 2px 8px rgba(0, 0, 0, 0.12),
            inset 0 0.5px 0 rgba(255, 255, 255, 0.025);
        top: auto;
        bottom: 30px;
        right: 16px;
        width: 56px;
        height: 56px;
        min-width: 56px;
        transform: none;
        border: 1px solid var(--chat-mobile-fab-glass-border) !important;
        border-radius: 18px !important;
        background: var(--chat-mobile-fab-glass-bg) !important;
        background-color: var(--chat-mobile-fab-glass-bg) !important;
        backdrop-filter: var(--chat-mobile-fab-glass-filter) !important;
        -webkit-backdrop-filter: var(--chat-mobile-fab-glass-filter) !important;
        box-shadow: var(--chat-mobile-fab-glass-shadow) !important;
        outline: none !important;
        box-sizing: border-box;
        isolation: isolate;
        -webkit-tap-highlight-color: transparent;
    }

    html[data-theme="light"] .chat-widget-fab {
        --chat-mobile-fab-glass-bg: rgba(255, 255, 255, 0.76);
        --chat-mobile-fab-glass-border: rgba(15, 23, 42, 0.065);
        --chat-mobile-fab-glass-shadow:
            0 2px 8px rgba(15, 23, 42, 0.045),
            inset 0 0.5px 0 rgba(255, 255, 255, 0.34);
    }

    .chat-widget-fab:hover,
    .chat-widget-fab:active,
    .chat-widget-fab:focus,
    .chat-widget-fab:focus-visible {
        transform: none;
        background: var(--chat-mobile-fab-glass-bg) !important;
        background-color: var(--chat-mobile-fab-glass-bg) !important;
        box-shadow: var(--chat-mobile-fab-glass-shadow) !important;
        outline: none !important;
    }

    .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__robot {
        top: 5px;
        left: 0;
        right: auto;
        width: 56px;
        height: 46px;
        transform: none;
        transition: none;
        will-change: auto;
    }

    .chat-widget-fab.chat-widget-fab--peek:active .chat-widget-fab__robot,
    .chat-widget-fab[data-chat-widget-loading="1"] .chat-widget-fab__robot {
        transform: none !important;
        filter: none !important;
    }

    .chat-widget-fab[data-chat-widget-loading="1"] .mascot-wrapper {
        animation: none !important;
    }

    .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__glow {
        inset: 8px 8px 5px;
        opacity: 0.14;
        transition: opacity 240ms ease;
    }

    .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__shadow {
        right: 12px;
        top: 42px;
        width: 30px;
        transform: scaleX(0.82);
        opacity: 0.1;
        transition: opacity 240ms ease;
    }
}

@media (max-width: 1180px) and (hover: hover) and (pointer: fine) {
    body.shop-page .chat-widget-fab,
    body.shop-page .chat-widget-fab:hover,
    body.shop-page .chat-widget-fab:active,
    body.shop-page .chat-widget-fab:focus,
    body.shop-page .chat-widget-fab:focus-visible {
        width: 92px !important;
        height: 76px !important;
        min-width: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        box-shadow: none !important;
    }

    body.shop-page .chat-widget-fab {
        top: 85% !important;
        right: 0 !important;
        bottom: auto !important;
        transform: translateY(-50%) !important;
    }

    body.shop-page .chat-widget-fab:hover {
        transform: translateY(calc(-50% - 2px)) !important;
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__robot {
        top: 8px !important;
        left: auto !important;
        right: -8px !important;
        width: 64px !important;
        height: 48px !important;
        transform: translateX(8px) scaleX(0.84) scaleY(1.04) rotate(-4deg) !important;
        transition:
            transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
            filter 240ms ease;
        will-change: transform, filter;
        z-index: auto;
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek.chat-widget-fab--ambient-retracted .chat-widget-fab__robot {
        transform: translateX(18px) scaleX(0.8) scaleY(1.06) rotate(-5deg) !important;
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek:hover .chat-widget-fab__robot {
        transform: translateX(-8px) scale(1.04) !important;
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek:active .chat-widget-fab__robot {
        transform: translateX(-5px) scale(0.98) !important;
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__glow {
        inset: 8px 10px 4px 4px;
        opacity: 0.18;
        transform: none;
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek.chat-widget-fab--ambient-retracted .chat-widget-fab__glow {
        opacity: 0.1;
        transform: scale(0.92) translateX(4px);
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek:hover .chat-widget-fab__glow {
        opacity: 0.28;
        transform: scale(1.08);
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek .chat-widget-fab__shadow {
        right: 18px;
        top: 56px;
        width: 32px;
        opacity: 0.1;
        transform: scaleX(0.74) translateX(12px);
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek.chat-widget-fab--ambient-retracted .chat-widget-fab__shadow {
        opacity: 0.06;
        transform: scaleX(0.6) translateX(18px);
    }

    body.shop-page .chat-widget-fab.chat-widget-fab--peek:hover .chat-widget-fab__shadow {
        opacity: 0.2;
        transform: scaleX(0.98) translateX(-12px);
    }
}

.chat-widget-bootstrap-overlay {
    position: fixed;
    inset: 0;
    display: none;
    background: rgba(7, 9, 12, 0);
    backdrop-filter: blur(0) saturate(100%);
    -webkit-backdrop-filter: blur(0) saturate(100%);
    opacity: 0;
    z-index: 9997;
    transition:
        opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
        background-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
        backdrop-filter 260ms cubic-bezier(0.22, 1, 0.36, 1),
        -webkit-backdrop-filter 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chat-widget-bootstrap-shell {
    --chat-bootstrap-shell-width: 380px;
    --chat-bootstrap-shell-height: 600px;
    position: fixed;
    bottom: 100px;
    right: 30px;
    width: var(--chat-bootstrap-shell-width);
    height: var(--chat-bootstrap-shell-height);
    max-width: calc(100vw - 32px);
    max-height: 80vh;
    display: none;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 20px;
    background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98));
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.9);
    opacity: 0;
    transform: translateY(28px) scale(0.94);
    transform-origin: bottom right;
    z-index: 9998;
    transition:
        opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
        transform 360ms cubic-bezier(0.18, 0.88, 0.24, 1);
}

.chat-widget-bootstrap-shell.chat-window {
    width: var(--chat-bootstrap-shell-width) !important;
    height: var(--chat-bootstrap-shell-height) !important;
    max-width: calc(100vw - 32px) !important;
    max-height: 80vh !important;
    display: none !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    transform: translateY(28px) scale(0.94) !important;
    transition:
        opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
        transform 360ms cubic-bezier(0.18, 0.88, 0.24, 1),
        visibility 320ms !important;
}

html[data-theme="light"] .chat-widget-bootstrap-overlay {
    background: rgba(34, 41, 52, 0);
}

.chat-widget-bootstrap-overlay--user {
    background: rgba(7, 9, 12, 0);
    backdrop-filter: blur(0) saturate(100%);
    -webkit-backdrop-filter: blur(0) saturate(100%);
}

html[data-theme="light"] .chat-widget-bootstrap-overlay--user {
    background: rgba(34, 41, 52, 0);
}

html[data-theme="light"] .chat-widget-bootstrap-shell {
    border-color: rgba(148, 163, 184, 0.18);
    background: rgba(252, 253, 255, 0.98);
    box-shadow: 0 28px 70px rgba(148, 163, 184, 0.2), 0 8px 24px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.94);
    color: #334155;
}

.chat-widget-bootstrap-overlay.is-visible,
.chat-widget-bootstrap-shell.is-visible {
    display: flex;
}

.chat-widget-bootstrap-shell.chat-window.is-visible {
    display: flex !important;
    visibility: visible !important;
}

.chat-widget-bootstrap-overlay.is-active {
    background: var(--chat-overlay-bg, rgba(7, 9, 12, 0.12));
    backdrop-filter: var(--chat-overlay-filter, blur(14px) saturate(108%));
    -webkit-backdrop-filter: var(--chat-overlay-filter, blur(14px) saturate(108%));
    opacity: 1;
}

html[data-theme="light"] .chat-widget-bootstrap-overlay.is-active {
    background: var(--chat-overlay-bg, rgba(34, 41, 52, 0.48));
}

.chat-widget-bootstrap-shell.is-active {
    opacity: 1;
    transform: translateY(0) scale(1);
}

.chat-widget-bootstrap-shell.chat-window.is-active {
    opacity: 1 !important;
    transform: translateY(0) scale(1) !important;
}

.chat-widget-bootstrap-shell.is-handoff {
    transform: translateY(0) scale(1);
    transition:
        opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
        transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chat-widget-bootstrap-shell.chat-window.is-handoff {
    transform: translateY(0) scale(1) !important;
}

.chat-widget-bootstrap-shell.is-handoff:not(.is-active) {
    opacity: 0;
    transform: translateY(0) scale(1);
}

.chat-widget-bootstrap-shell.chat-window.is-handoff:not(.is-active) {
    opacity: 0 !important;
    transform: translateY(0) scale(1) !important;
}

.chat-widget-bootstrap-shell--admin.chat-window {
    --chat-admin-top-gap: clamp(18px, 4vh, 36px);
    --chat-admin-bottom-gap: 24px;
    top: var(--chat-admin-top-gap) !important;
    right: 30px !important;
    bottom: auto !important;
    width: min(1040px, calc(100vw - 32px)) !important;
    max-width: 97vw !important;
    height: min(760px, calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap)))) !important;
    max-height: calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap))) !important;
    flex-direction: column !important;
}

.chat-widget-bootstrap-shell--admin.chat-window[data-chat-widget-bootstrap-adopted="1"] {
    display: flex !important;
    flex-direction: row !important;
}

.chat-widget-bootstrap-shell--admin.chat-window.chat-widget-bootstrap-shell--desktop-edge-safe {
    --chat-admin-top-gap: clamp(56px, 9vh, 96px);
    top: 50% !important;
    transform: translateY(calc(-50% + 20px)) scale(0.95) !important;
    transform-origin: center right !important;
}

.chat-widget-bootstrap-shell--admin.chat-window.is-active,
.chat-widget-bootstrap-shell--admin.chat-window.is-handoff,
.chat-widget-bootstrap-shell--admin.chat-window.is-handoff:not(.is-active) {
    transform: translateY(0) scale(1) !important;
}

.chat-widget-bootstrap-shell--admin.chat-window.chat-widget-bootstrap-shell--desktop-edge-safe.is-active,
.chat-widget-bootstrap-shell--admin.chat-window.chat-widget-bootstrap-shell--desktop-edge-safe.is-handoff,
.chat-widget-bootstrap-shell--admin.chat-window.chat-widget-bootstrap-shell--desktop-edge-safe.is-handoff:not(.is-active) {
    transform: translateY(-50%) scale(1) !important;
}

.chat-widget-bootstrap-user-header {
    flex: 0 0 auto;
    width: 100%;
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
}

.chat-widget-bootstrap-user-header.chat-header {
    background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98));
    border-bottom-color: var(--chat-panel-border, rgba(255, 255, 255, 0.08));
}

.chat-widget-bootstrap-user-header .chat-header-info {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1 1 auto;
}

.chat-widget-bootstrap-user-header .chat-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--chat-avatar-bg, rgba(107, 158, 206, 0.18));
    border: 1px solid var(--chat-avatar-border, rgba(107, 158, 206, 0.16));
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    flex: 0 0 auto;
}

.chat-widget-bootstrap-user-header .chat-title {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
}

.chat-widget-bootstrap-user-header .chat-title h3 {
    margin: 0;
    font-size: 16px;
    line-height: 1.2;
    font-weight: 600;
    color: var(--chat-text, rgba(255, 255, 255, 0.96));
}

.chat-widget-bootstrap-user-header .chat-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 2px;
}

.chat-widget-bootstrap-user-header .chat-status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.chat-widget-bootstrap-user-header .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: #4cd964;
    box-shadow: 0 0 8px rgba(76, 217, 100, 0.4);
}

.chat-widget-bootstrap-user-header .status-text {
    font-size: 12px;
    line-height: 1.2;
    color: var(--chat-text-subtle, rgba(255, 255, 255, 0.56));
}

.chat-widget-bootstrap-user-header .chat-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex: 0 0 auto;
    white-space: nowrap;
}

.chat-widget-bootstrap-user-body.chat-messages {
    padding: 20px;
    background: var(--chat-panel-bg, rgba(12, 15, 22, 0.98));
    box-shadow: var(--chat-panel-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.04), inset 0 -12px 24px rgba(0, 0, 0, 0.08));
    overflow: hidden;
}

.chat-widget-bootstrap-user-body .chat-widget-loading-state {
    margin: auto;
}

.chat-widget-bootstrap-user-input.chat-input-area {
    background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98));
    border-top-color: var(--chat-panel-border, rgba(255, 255, 255, 0.08));
}

.chat-widget-bootstrap-user-input .chat-action-btn {
    width: 36px;
    height: 36px;
    min-width: 36px;
    min-height: 36px;
    flex: 0 0 36px;
    margin: 0;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    border-radius: 50%;
    color: var(--chat-action-color, rgba(255, 255, 255, 0.7));
    box-sizing: border-box;
}

.chat-widget-bootstrap-user-input .chat-action-btn {
    border: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08));
    background: var(--chat-panel-bg, rgba(12, 15, 22, 0.98));
}

.chat-widget-bootstrap-user-input .chat-action-btn i {
    width: 16px;
    height: 16px;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    font-size: 16px;
    line-height: 1;
}

.chat-widget-bootstrap-user-input .chat-widget-bootstrap-user-emoji-btn {
    width: 36px;
    height: 36px;
    min-width: 36px;
    min-height: 36px;
    flex: 0 0 36px;
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
}

.chat-widget-bootstrap-user-input .chat-send-btn {
    border: 0;
    background: transparent;
    color: var(--chat-accent-blue, #6b9ece);
    font-size: 20px;
    padding: 0 5px;
    width: auto;
    height: auto;
    min-width: 0;
    min-height: 0;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
}

.chat-widget-bootstrap-user-input .chat-input {
    flex: 1 1 auto;
    min-width: 0;
    border-radius: 20px;
    border: 1px solid var(--chat-input-border, rgba(255, 255, 255, 0.1));
    background: var(--chat-input-bg, rgba(0, 0, 0, 0.2));
    color: var(--chat-text, rgba(255, 255, 255, 0.96));
    padding: 10px 15px;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
}

.chat-widget-bootstrap-user-input .chat-input {
    pointer-events: none;
}

.chat-widget-bootstrap-user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(107, 158, 206, 0.18);
    position: relative;
    flex: 0 0 auto;
    box-shadow: inset 0 0 0 1px rgba(107, 158, 206, 0.22);
}

.chat-widget-bootstrap-user-avatar::before,
.chat-widget-bootstrap-user-avatar::after {
    content: '';
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(107, 158, 206, 0.84);
}

.chat-widget-bootstrap-user-avatar::before {
    top: 14px;
    width: 22px;
    height: 14px;
    border-radius: 8px;
}

.chat-widget-bootstrap-user-avatar::after {
    top: 19px;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    box-shadow: -6px 0 0 rgba(255, 255, 255, 0.92), 6px 0 0 rgba(255, 255, 255, 0.92);
    background: rgba(255, 255, 255, 0.92);
}

.chat-widget-bootstrap-user-title-stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
}

.chat-widget-bootstrap-user-title-text {
    color: rgba(255, 255, 255, 0.94);
    font-size: 16px;
    line-height: 1.15;
    font-weight: 700;
}

.chat-widget-bootstrap-user-status-row {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    color: rgba(203, 213, 225, 0.82);
    font-size: 13px;
    line-height: 1.2;
}

.chat-widget-bootstrap-user-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #facc15;
    box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.16);
    flex: 0 0 auto;
}

.chat-widget-bootstrap-user-entry {
    margin-left: auto;
    color: rgba(147, 187, 227, 0.92);
    font-size: 13px;
    line-height: 1;
    font-weight: 700;
    white-space: nowrap;
    flex: 0 0 auto;
}

.chat-widget-bootstrap-skeleton {
    position: relative;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
}

.chat-widget-bootstrap-skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.18), transparent);
    animation: chat-widget-bootstrap-skeleton 1.2s ease-in-out infinite;
}

.chat-widget-bootstrap-user-body {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    padding: 20px;
    background: rgba(255, 255, 255, 0.018);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
}

.chat-widget-loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    min-height: 44px;
    color: rgba(147, 187, 227, 0.96);
}

.chat-loading-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    min-height: 44px;
}

.chat-loading-state--user-handoff {
    margin: auto;
    color: var(--chat-accent-blue, #6b94c6);
}

.chat-loading-dots {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-shrink: 0;
}

.chat-loading-dots span {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.24;
    animation: chat-loading-dots 1.05s ease-in-out infinite;
}

.chat-loading-dots span:nth-child(2) {
    animation-delay: 0.16s;
}

.chat-loading-dots span:nth-child(3) {
    animation-delay: 0.32s;
}

.chat-widget-bootstrap-user-input {
    flex: 0 0 auto;
    width: 100%;
    padding: 15px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
    color: rgba(203, 213, 225, 0.76);
}

.chat-widget-bootstrap-user-input-action,
.chat-widget-bootstrap-user-send {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(255, 255, 255, 0.04);
    color: currentColor;
    font-size: 22px;
    line-height: 1;
}

.chat-widget-bootstrap-user-input-field {
    height: 38px;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 999px;
    color: rgba(203, 213, 225, 0.68);
    background: rgba(255, 255, 255, 0.04);
    box-sizing: border-box;
    font-size: 14px;
    line-height: 1;
}

html[data-theme="light"] .chat-widget-bootstrap-user-header {
    border-bottom-color: rgba(148, 163, 184, 0.14);
}

html[data-theme="light"] .chat-widget-bootstrap-user-title-text {
    color: #111827;
}

html[data-theme="light"] .chat-widget-bootstrap-user-status-row {
    color: #64748b;
}

html[data-theme="light"] .chat-widget-bootstrap-user-entry {
    color: #6b94c6;
}

html[data-theme="light"] .chat-widget-bootstrap-user-body {
    background: rgba(243, 247, 251, 0.96);
}

html[data-theme="light"] .chat-widget-bootstrap-skeleton,
html[data-theme="light"] .chat-widget-bootstrap-bubble {
    background: rgba(15, 23, 42, 0.08);
}

html[data-theme="light"] .chat-widget-bootstrap-skeleton::after {
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.62), transparent);
}

html[data-theme="light"] .chat-widget-bootstrap-user-input {
    border-top-color: rgba(148, 163, 184, 0.14);
    color: #7d8ca3;
    background: rgba(252, 253, 255, 0.98);
}

html[data-theme="light"] .chat-widget-bootstrap-user-input-action,
html[data-theme="light"] .chat-widget-bootstrap-user-send,
html[data-theme="light"] .chat-widget-bootstrap-user-input-field {
    border-color: rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.9);
}

html[data-theme="light"] .chat-widget-loading-state {
    color: #6b94c6;
}

.chat-widget-bootstrap-admin-loading {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(241, 246, 252, 0.96);
    color: #6b94c6;
}

html[data-theme="dark"] .chat-widget-bootstrap-admin-loading {
    background: rgba(12, 15, 22, 0.98);
    color: rgba(147, 187, 227, 0.96);
}

@keyframes chat-loading-dots {
    0%, 80%, 100% {
        transform: translateY(0);
        opacity: 0.24;
    }

    40% {
        transform: translateY(-3px);
        opacity: 0.96;
    }
}

.chat-widget-bootstrap-admin-header {
    flex: 0 0 auto;
    min-height: 72px;
    padding: 22px 28px 18px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    display: flex;
    align-items: center;
    box-sizing: border-box;
}

.chat-widget-bootstrap-admin-title-line {
    width: 126px;
    height: 24px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.14);
}

.chat-widget-bootstrap-admin-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: rgba(241, 246, 252, 0.96);
}

.chat-widget-bootstrap-admin-search {
    margin: 18px 28px 14px;
    height: 46px;
    border-radius: 16px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    background: rgba(255, 255, 255, 0.92);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 18px;
    box-sizing: border-box;
    color: #94a3b8;
}

.chat-widget-bootstrap-admin-search-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: rgba(100, 116, 139, 0.18);
}

.chat-widget-bootstrap-admin-search-line {
    height: 15px;
    width: min(280px, 72%);
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.2);
}

.chat-widget-bootstrap-admin-overview {
    margin: 0 28px 18px;
    min-height: 64px;
    border-radius: 18px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    background: rgba(248, 250, 252, 0.82);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 18px;
    padding: 14px 18px;
    box-sizing: border-box;
}

.chat-widget-bootstrap-admin-overview-label,
.chat-widget-bootstrap-admin-overview-meta,
.chat-widget-bootstrap-admin-overview-toggle {
    border-radius: 999px;
    background: rgba(100, 116, 139, 0.18);
}

.chat-widget-bootstrap-admin-overview-label {
    width: 78px;
    height: 14px;
    margin-bottom: 8px;
}

.chat-widget-bootstrap-admin-overview-meta {
    width: 150px;
    height: 13px;
}

.chat-widget-bootstrap-admin-overview-toggle {
    width: 38px;
    height: 14px;
}

.chat-widget-bootstrap-admin-pinned,
.chat-widget-bootstrap-admin-row {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    padding: 18px 28px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    box-sizing: border-box;
}

.chat-widget-bootstrap-admin-pinned {
    background: rgba(219, 234, 254, 0.42);
}

.chat-widget-bootstrap-admin-avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: rgba(107, 158, 206, 0.22);
    flex: 0 0 auto;
}

.chat-widget-bootstrap-admin-avatar--warm {
    background: rgba(107, 158, 206, 0.18);
}

.chat-widget-bootstrap-admin-avatar--soft {
    background: rgba(107, 158, 206, 0.2);
}

.chat-widget-bootstrap-admin-main {
    min-width: 0;
}

.chat-widget-bootstrap-admin-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin-bottom: 7px;
}

.chat-widget-bootstrap-admin-name {
    width: 96px;
    height: 17px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.2);
}

.chat-widget-bootstrap-admin-name--short {
    width: 60px;
}

.chat-widget-bootstrap-admin-badge {
    width: 44px;
    height: 18px;
    border-radius: 999px;
    background: rgba(239, 68, 68, 0.16);
}

.chat-widget-bootstrap-admin-subline,
.chat-widget-bootstrap-admin-preview,
.chat-widget-bootstrap-admin-time {
    border-radius: 999px;
    background: rgba(100, 116, 139, 0.18);
}

.chat-widget-bootstrap-admin-subline {
    width: min(360px, 82%);
    height: 14px;
    margin-bottom: 8px;
}

.chat-widget-bootstrap-admin-preview {
    width: min(220px, 54%);
    height: 13px;
}

.chat-widget-bootstrap-admin-time {
    width: 60px;
    height: 14px;
}

.chat-widget-bootstrap-admin-pinned .chat-widget-bootstrap-admin-name {
    width: 84px;
    background: rgba(15, 23, 42, 0.84);
}

.chat-widget-bootstrap-admin-pinned .chat-widget-bootstrap-admin-badge {
    width: 48px;
    background: rgba(107, 158, 206, 0.2);
}

.chat-widget-bootstrap-admin-pinned .chat-widget-bootstrap-admin-subline {
    width: 160px;
}

.chat-widget-bootstrap-admin-pinned .chat-widget-bootstrap-admin-preview {
    width: 210px;
}

html[data-theme="dark"] .chat-widget-bootstrap-admin-title-line {
    background: rgba(248, 250, 252, 0.16);
}

html[data-theme="dark"] .chat-widget-bootstrap-admin-body {
    background: rgba(12, 15, 22, 0.98);
}

html[data-theme="dark"] .chat-widget-bootstrap-admin-search,
html[data-theme="dark"] .chat-widget-bootstrap-admin-overview {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.1);
}

html[data-theme="dark"] .chat-widget-bootstrap-admin-header,
html[data-theme="dark"] .chat-widget-bootstrap-admin-pinned,
html[data-theme="dark"] .chat-widget-bootstrap-admin-row {
    border-color: rgba(255, 255, 255, 0.08);
}

@keyframes chat-widget-bootstrap-skeleton {
    to {
        transform: translateX(100%);
    }
}

@keyframes chat-widget-bootstrap-content-swap {
    0% {
        opacity: 0;
        filter: blur(3px);
        transform: translateY(8px);
    }
    58% {
        opacity: 0.9;
        filter: blur(1px);
    }
    100% {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
    }
}

@keyframes chat-widget-bootstrap-content-settle {
    0% {
        opacity: 1;
        transform: translateY(4px);
    }
    100% {
        opacity: 1;
        transform: translateY(0);
    }
}

.chat-window--bootstrap-adopting-content > *:not(.chat-bootstrap-content-snapshot) {
    opacity: 0;
}

.chat-window--bootstrap-adopting-content.chat-window--bootstrap-content-ready > *:not(.emoji-picker-popover):not(.chat-bootstrap-content-snapshot) {
    opacity: 1;
    animation: chat-widget-bootstrap-content-settle 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.chat-bootstrap-content-snapshot {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98));
    opacity: 1;
    pointer-events: none;
    transition: opacity 300ms cubic-bezier(0.22, 1, 0.36, 1);
    contain: paint;
}

html[data-theme="light"] .chat-bootstrap-content-snapshot {
    background: var(--chat-shell-bg, rgba(252, 253, 255, 0.98));
}

.chat-window--bootstrap-content-ready .chat-bootstrap-content-snapshot {
    opacity: 0;
    transition-delay: 80ms;
}

.chat-window--bootstrap-adopting-content .emoji-picker-popover:not(.active),
.chat-window--bootstrap-content-ready .emoji-picker-popover:not(.active) {
    opacity: 0 !important;
    pointer-events: none !important;
    transform: translateY(10px) !important;
    animation: none !important;
}

.chat-window--bootstrap-interaction-locked .chat-input-area,
.chat-window--bootstrap-interaction-locked .chat-action-btn,
.chat-window--bootstrap-interaction-locked .chat-send-btn,
.chat-window--bootstrap-interaction-locked .chat-input,
.chat-window--bootstrap-interaction-locked .emoji-picker-popover {
    pointer-events: none !important;
}

.chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn,
.chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn:hover,
.chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn:active,
.chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn:focus,
.chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn i {
    background: transparent !important;
    color: var(--chat-action-color) !important;
    box-shadow: none !important;
    transform: none !important;
    filter: none !important;
}

.chat-window--bootstrap-interaction-locked .emoji-picker-popover,
.chat-window--bootstrap-interaction-locked .emoji-picker-popover.active {
    opacity: 0 !important;
    transform: translateY(10px) !important;
    pointer-events: none !important;
}

@media (max-width: 700px) and (hover: hover) and (pointer: fine) {
    .chat-widget-bootstrap-shell {
        --chat-user-narrow-top-gap: clamp(18px, 5vh, 40px);
        --chat-user-narrow-bottom-gap: 24px;
        top: var(--chat-user-narrow-top-gap);
        left: 50%;
        right: auto;
        bottom: auto;
        width: min(var(--chat-bootstrap-shell-width), calc(100vw - 24px));
        max-width: calc(100vw - 24px);
        height: min(var(--chat-bootstrap-shell-height), calc(100vh - (var(--chat-user-narrow-top-gap) + var(--chat-user-narrow-bottom-gap))));
        max-height: calc(100vh - (var(--chat-user-narrow-top-gap) + var(--chat-user-narrow-bottom-gap)));
        transform: translate3d(-50%, 28px, 0) scale(0.94);
        transform-origin: center top;
    }

    .chat-widget-bootstrap-shell.chat-window {
        top: var(--chat-user-narrow-top-gap) !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        width: min(var(--chat-bootstrap-shell-width), calc(100vw - 24px)) !important;
        max-width: calc(100vw - 24px) !important;
        height: min(var(--chat-bootstrap-shell-height), calc(100vh - (var(--chat-user-narrow-top-gap) + var(--chat-user-narrow-bottom-gap)))) !important;
        max-height: calc(100vh - (var(--chat-user-narrow-top-gap) + var(--chat-user-narrow-bottom-gap))) !important;
        transform: translate3d(-50%, 28px, 0) scale(0.94) !important;
        transform-origin: center top !important;
    }

    .chat-widget-bootstrap-shell.is-active,
    .chat-widget-bootstrap-shell.is-handoff,
    .chat-widget-bootstrap-shell.is-handoff:not(.is-active) {
        transform: translate3d(-50%, 0, 0) scale(1);
    }

    .chat-widget-bootstrap-shell.chat-window.is-active,
    .chat-widget-bootstrap-shell.chat-window.is-handoff,
    .chat-widget-bootstrap-shell.chat-window.is-handoff:not(.is-active) {
        transform: translate3d(-50%, 0, 0) scale(1) !important;
    }
}

@media (max-width: 700px) and (hover: none), (max-width: 700px) and (pointer: coarse) {
    .chat-widget-bootstrap-shell {
        top: 50%;
        left: 50%;
        right: auto;
        bottom: auto;
        width: min(460px, max(97vw, calc(100vw - 16px)));
        max-width: 97vw;
        height: 70vh;
        max-height: 600px;
        transform: translate3d(-50%, calc(-50% + 24px), 0) scale(0.94);
        transform-origin: center center;
    }

    .chat-widget-bootstrap-shell.chat-window {
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        width: min(460px, max(97vw, calc(100vw - 16px))) !important;
        max-width: 97vw !important;
        height: 70vh !important;
        max-height: 600px !important;
        transform: translate3d(-50%, calc(-50% + 24px), 0) scale(0.94) !important;
        transform-origin: center center !important;
    }

    .chat-widget-bootstrap-shell.is-active {
        transform: translate3d(-50%, -50%, 0) scale(1);
    }

    .chat-widget-bootstrap-shell.chat-window.is-active {
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
    }

    .chat-widget-bootstrap-shell.is-handoff,
    .chat-widget-bootstrap-shell.is-handoff:not(.is-active) {
        transform: translate3d(-50%, -50%, 0) scale(1);
    }

    .chat-widget-bootstrap-shell.chat-window.is-handoff,
    .chat-widget-bootstrap-shell.chat-window.is-handoff:not(.is-active) {
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
    }
}

@media (max-width: 700px) {
    .chat-widget-bootstrap-shell--admin.chat-window {
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        width: min(460px, calc(100vw - 16px)) !important;
        max-width: 97vw !important;
        height: min(640px, 84vh) !important;
        max-height: 82vh !important;
        border-radius: 20px !important;
        transform: translate3d(-50%, calc(-50% + 24px), 0) scale(0.94) !important;
        transform-origin: center center !important;
    }

    .chat-widget-bootstrap-shell--admin.chat-window.is-active,
    .chat-widget-bootstrap-shell--admin.chat-window.is-handoff,
    .chat-widget-bootstrap-shell--admin.chat-window.is-handoff:not(.is-active) {
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
    }
}

@media (max-width: 480px) {
    .chat-widget-bootstrap-shell--admin.chat-window {
        top: 50% !important;
        left: 50% !important;
        right: auto !important;
        bottom: auto !important;
        width: 97vw !important;
        max-width: 97vw !important;
        height: 78vh !important;
        max-height: 78vh !important;
        border-radius: 16px !important;
        transform: translate3d(-50%, calc(-50% + 24px), 0) scale(0.94) !important;
        transform-origin: center center !important;
    }

    .chat-widget-bootstrap-shell--admin.chat-window.is-active,
    .chat-widget-bootstrap-shell--admin.chat-window.is-handoff,
    .chat-widget-bootstrap-shell--admin.chat-window.is-handoff:not(.is-active) {
        transform: translate3d(-50%, -50%, 0) scale(1) !important;
    }

    .chat-widget-bootstrap-admin-header {
        min-height: 64px;
        padding: 20px 16px 16px;
    }

    .chat-widget-bootstrap-admin-title-line {
        width: 112px;
        height: 22px;
    }

    .chat-widget-bootstrap-admin-search {
        margin: 14px 14px 12px;
    }

    .chat-widget-bootstrap-admin-overview {
        margin: 0 14px 14px;
        border-radius: 16px;
    }

    .chat-widget-bootstrap-admin-pinned,
    .chat-widget-bootstrap-admin-row {
        grid-template-columns: 40px minmax(0, 1fr) 54px;
        gap: 14px;
        padding: 17px 16px;
    }

    .chat-widget-bootstrap-admin-avatar {
        width: 40px;
        height: 40px;
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
        ensureFullChatWidgetStylesheet();
        activateChatWidgetStylesheetLinks();

        if (typeof global.activateDeferredStyleGroup === 'function') {
            global.activateDeferredStyleGroup('homepage-chat');
            global.activateDeferredStyleGroup('public-chat');
        }
    }

    function hasRecentAdminAccessCache() {
        if (typeof global.sessionStorage === 'undefined') {
            return false;
        }

        try {
            const rawValue = global.sessionStorage.getItem(ADMIN_ACCESS_CACHE_KEY);
            if (!rawValue) {
                return false;
            }

            const parsed = JSON.parse(rawValue);
            const cachedAt = Number(parsed?.cachedAt || 0);
            return Boolean(parsed?.access?.isAdmin)
                && Number.isFinite(cachedAt)
                && (Date.now() - cachedAt) <= ADMIN_ACCESS_CACHE_TTL_MS;
        } catch {
            return false;
        }
    }

    function getPreferredBootstrapShellMode() {
        if (typeof global.localStorage === 'undefined') {
            return 'user';
        }

        try {
            if (hasRecentAdminAccessCache()) {
                return 'admin';
            }

            const rawMode = global.localStorage.getItem(CHAT_WIDGET_SHELL_MODE_KEY);
            if (rawMode) {
                const parsed = JSON.parse(rawMode);
                const savedAt = Number(parsed?.savedAt || 0);
                const mode = String(parsed?.mode || '').trim();
                if (mode === 'user' && Number.isFinite(savedAt) && (Date.now() - savedAt) <= (7 * 24 * 60 * 60 * 1000)) {
                    return mode;
                }
            }
        } catch {
            return 'user';
        }

        return 'user';
    }

    function getUserBootstrapShellMarkup() {
        return `
            <div class="chat-header chat-widget-bootstrap-user-header">
                <div class="chat-header-info">
                    <div class="chat-avatar">
                        <div class="mascot-wrapper mascot-wrapper--compact" aria-hidden="true">
                            <div class="mascot-head">
                                <div class="mascot-ears"></div>
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
                    <div class="chat-title">
                        <h3>在线客服</h3>
                        <div class="chat-status-row">
                            <div class="chat-status-indicator">
                                <span class="status-dot online" aria-hidden="true"></span>
                                <span class="status-text">管理员在线</span>
                            </div>
                            <div class="chat-header-actions">
                                <button type="button" class="chat-header-mode-switch" tabindex="-1">常用入口</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="chat-messages chat-widget-bootstrap-user-body">
                <div class="chat-widget-loading-state" role="status" aria-label="正在加载">
                    <span class="chat-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                </div>
            </div>
            <div class="chat-input-area chat-widget-bootstrap-user-input" aria-hidden="true">
                <button class="chat-action-btn" type="button" tabindex="-1"><i class="fas fa-plus"></i></button>
                <input type="text" class="chat-input" tabindex="-1" value="" placeholder="输入消息..." disabled>
                <button class="chat-action-btn chat-widget-bootstrap-user-emoji-btn" type="button" tabindex="-1"><i class="far fa-smile"></i></button>
                <button class="chat-send-btn" type="button" tabindex="-1"><i class="fas fa-paper-plane"></i></button>
            </div>
        `;
    }

    function getAdminBootstrapShellMarkup() {
        return `
            <div class="chat-widget-bootstrap-admin-loading" role="status" aria-label="正在加载客服工作台">
                <span class="chat-loading-dots chat-loading-dots--admin" aria-hidden="true"><span></span><span></span><span></span></span>
            </div>
        `;
    }

    function isBootstrapNarrowViewport() {
        if (typeof global.matchMedia === 'function') {
            try {
                return global.matchMedia('(max-width: 700px)').matches;
            } catch (_) {
                // Fall back to viewport measurements below.
            }
        }

        const viewportWidth = Math.max(
            global.innerWidth || 0,
            document.documentElement?.clientWidth || 0
        );
        return viewportWidth > 0 && viewportWidth <= 700;
    }

    function isBootstrapTouchPrimaryInput() {
        if (navigator.maxTouchPoints > 0) return true;
        if (typeof global.matchMedia === 'function') {
            try {
                if (global.matchMedia('(pointer: coarse)').matches) {
                    return true;
                }
            } catch (_) {
                // Fall back to touch event support below.
            }
        }
        return 'ontouchstart' in global;
    }

    function shouldUseBootstrapDesktopEdgeSafeInset() {
        if (isBootstrapNarrowViewport() || isBootstrapTouchPrimaryInput()) {
            return false;
        }

        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
        if (fullscreenElement) return true;

        if (typeof global.matchMedia === 'function') {
            try {
                if (global.matchMedia('(display-mode: fullscreen)').matches) {
                    return true;
                }
            } catch (error) {
                console.warn('[ChatWidgetLoader] Failed to evaluate fullscreen display-mode:', error);
            }
        }

        const screenWidth = Math.max(global.screen?.width || 0, global.screen?.availWidth || 0);
        const screenHeight = Math.max(global.screen?.height || 0, global.screen?.availHeight || 0);
        const viewportWidth = Math.max(global.innerWidth || 0, document.documentElement?.clientWidth || 0);
        const viewportHeight = Math.max(global.innerHeight || 0, document.documentElement?.clientHeight || 0);
        const outerWidth = Math.max(global.outerWidth || 0, viewportWidth);
        const outerHeight = Math.max(global.outerHeight || 0, viewportHeight);
        const widthDelta = screenWidth ? Math.abs(screenWidth - outerWidth) : Number.POSITIVE_INFINITY;
        const heightDelta = screenHeight ? Math.abs(screenHeight - outerHeight) : Number.POSITIVE_INFINITY;
        const browserChromeHeight = Math.max(0, outerHeight - viewportHeight);

        return widthDelta <= 24 && heightDelta <= 24 && browserChromeHeight <= 96;
    }

    function syncBootstrapLoadingShellViewportMode(shell = bootstrapLoadingShell?.shell) {
        if (!shell) {
            return;
        }

        const useEdgeSafeInset = shell.classList.contains('chat-widget-bootstrap-shell--admin')
            && shouldUseBootstrapDesktopEdgeSafeInset();
        shell.classList.toggle('chat-widget-bootstrap-shell--desktop-edge-safe', useEdgeSafeInset);
    }

    function handleBootstrapViewportModeChange() {
        if (bootstrapLoadingShell?.shell?.isConnected) {
            syncBootstrapLoadingShellViewportMode(bootstrapLoadingShell.shell);
        }
    }

    function syncBootstrapLoadingShellMode(loadingShell, mode = getPreferredBootstrapShellMode()) {
        if (!loadingShell?.shell) {
            return;
        }

        const normalizedMode = mode === 'admin' ? 'admin' : 'user';
        const { shell } = loadingShell;
        if (shell.dataset.chatWidgetBootstrapAdopted === '1') {
            return;
        }
        if (shell.dataset.chatWidgetBootstrapMode === normalizedMode && shell.innerHTML.trim()) {
            syncBootstrapLoadingShellViewportMode(shell);
            return;
        }

        shell.dataset.chatWidgetBootstrapMode = normalizedMode;
        shell.classList.toggle('chat-widget-bootstrap-shell--admin', normalizedMode === 'admin');
        shell.classList.toggle('chat-widget-bootstrap-shell--user', normalizedMode !== 'admin');
        shell.classList.toggle('admin-mode-layout', normalizedMode === 'admin');
        shell.classList.toggle('admin-mode-layout--narrow', normalizedMode === 'admin');
        syncBootstrapLoadingShellViewportMode(shell);
        loadingShell.overlay?.classList.toggle('chat-widget-bootstrap-overlay--admin', normalizedMode === 'admin');
        loadingShell.overlay?.classList.toggle('chat-widget-bootstrap-overlay--user', normalizedMode !== 'admin');
        shell.innerHTML = normalizedMode === 'admin'
            ? getAdminBootstrapShellMarkup()
            : getUserBootstrapShellMarkup();
    }

    function createBootstrapLoadingShell() {
        ensureChatWidgetStyles();
        if (!document.body) {
            return null;
        }
        if (bootstrapLoadingShell?.shell?.isConnected) {
            return bootstrapLoadingShell;
        }

        const overlay = document.createElement('div');
        overlay.className = 'chat-widget-bootstrap-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.addEventListener('click', dismissBootstrapLoadingShell);

        const shell = document.createElement('div');
        shell.className = 'chat-window chat-widget-bootstrap-shell';
        shell.setAttribute('data-chat-widget-bootstrap-shell', '1');
        shell.setAttribute('role', 'status');
        shell.setAttribute('aria-live', 'polite');
        shell.setAttribute('aria-label', '内容加载中');

        document.body.appendChild(overlay);
        document.body.appendChild(shell);
        bootstrapLoadingShell = { overlay, shell };
        syncBootstrapLoadingShellMode(bootstrapLoadingShell);
        return bootstrapLoadingShell;
    }

    function dismissBootstrapLoadingShell(event = null) {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const clickedBootstrapOverlay = event?.currentTarget?.classList?.contains('chat-widget-bootstrap-overlay');
        if (!bootstrapLoadingShell && !clickedBootstrapOverlay) {
            return;
        }

        bootstrapDismissToken += 1;
        pendingOpen = false;

        const widget = global.chatWidget;
        if (widget && typeof widget.closeChat === 'function') {
            Promise.resolve(widget.closeChat()).catch((error) => {
                console.warn('[ChatWidgetLoader] Failed to close chat widget during bootstrap dismiss:', error);
            });
        } else if (widget?.isOpen && typeof widget.toggleChat === 'function') {
            try {
                widget.toggleChat();
            } catch (error) {
                console.warn('[ChatWidgetLoader] Failed to toggle chat widget during bootstrap dismiss:', error);
            }
        }

        hideBootstrapLoadingShell({ dismissed: true });
    }

    function showBootstrapLoadingShell() {
        const loadingShell = createBootstrapLoadingShell();
        if (!loadingShell) {
            return;
        }

        if (bootstrapLoadingShellRemoveTimer) {
            clearTimeout(bootstrapLoadingShellRemoveTimer);
            bootstrapLoadingShellRemoveTimer = null;
        }

        loadingShell.overlay.classList.remove('is-handoff');
        loadingShell.shell.classList.remove('is-handoff');
        syncBootstrapLoadingShellMode(loadingShell);
        lockBootstrapLoadingPageScroll(loadingShell);
        setBootstrapLoadingPageFabHidden(true);
        const openingPlaceholder = placeholderFab?.isConnected
            ? placeholderFab
            : document.querySelector('.chat-widget-fab[data-chat-widget-placeholder="1"]');
        if (openingPlaceholder) {
            openingPlaceholder.dataset.chatWidgetPlaceholderOpening = '1';
            openingPlaceholder.classList.add('chat-widget-fab--disabled');
            openingPlaceholder.classList.add('chat-widget-fab--hidden');
            openingPlaceholder.setAttribute('aria-hidden', 'true');
            openingPlaceholder.setAttribute('aria-busy', 'true');
            openingPlaceholder.removeAttribute('data-chat-widget-loading');
        }
        suppressRuntimeFabDuringBootstrapLoading();
        loadingShell.overlay.classList.add('is-visible');
        loadingShell.shell.classList.add('is-visible');
        const showDismissToken = bootstrapDismissToken;
        requestAnimationFrame(() => {
            if (showDismissToken !== bootstrapDismissToken) {
                return;
            }
            if (bootstrapLoadingShell !== loadingShell || !loadingShell.overlay.isConnected || !loadingShell.shell.isConnected) {
                return;
            }
            loadingShell.overlay.classList.add('is-active');
            loadingShell.shell.classList.add('is-active');
            setPlaceholderSuppressed(true);
        });
    }

    function hideBootstrapLoadingShell(options = {}) {
        const handoff = options.handoff === true;
        const loadingShell = bootstrapLoadingShell;
        if (!loadingShell) {
            releaseBootstrapLoadingPageScroll({ preserveForHandoff: handoff });
            if (handoff) {
                setBootstrapLoadingPageFabHidden(false);
            } else {
                setPlaceholderSuppressed(false);
            }
            return;
        }

        if (loadingShell.shell?.dataset?.chatWidgetBootstrapAdopted === '1') {
            releaseBootstrapLoadingPageScroll({ preserveForHandoff: true });
            setBootstrapLoadingPageFabHidden(false);
            if (bootstrapLoadingShellRemoveTimer) {
                clearTimeout(bootstrapLoadingShellRemoveTimer);
                bootstrapLoadingShellRemoveTimer = null;
            }
            bootstrapLoadingShell = null;
            return;
        }

        if (handoff) {
            releaseBootstrapLoadingPageScroll({ preserveForHandoff: true });
        }
        if (!handoff) {
            setPlaceholderSuppressed(false);
        } else {
            setBootstrapLoadingPageFabHidden(false);
        }
        if (handoff) {
            loadingShell.overlay.classList.add('is-handoff');
            loadingShell.shell.classList.add('is-handoff');
        }
        loadingShell.overlay.classList.remove('is-active');
        loadingShell.shell.classList.remove('is-active');
        bootstrapLoadingShellRemoveTimer = setTimeout(() => {
            loadingShell.overlay.remove();
            loadingShell.shell.remove();
            if (bootstrapLoadingShell === loadingShell) {
                bootstrapLoadingShell = null;
            }
            bootstrapLoadingShellRemoveTimer = null;
            if (!handoff) {
                releaseBootstrapLoadingPageScroll();
            }
        }, handoff ? BOOTSTRAP_HANDOFF_FADE_MS : 220);
    }

    function getWidgetChatWindow(widget) {
        if (widget?.chatWindow) {
            return widget.chatWindow;
        }
        return document.querySelector('.chat-window:not(.admin-mode-layout):not([data-chat-widget-bootstrap-shell="1"])');
    }

    function waitForWidgetWindowHandoff(widget) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            let settled = false;

            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                setTimeout(resolve, BOOTSTRAP_HANDOFF_VISIBLE_DELAY_MS);
            };

            const checkVisibility = () => {
                const chatWindow = getWidgetChatWindow(widget);
                if (chatWindow?.classList.contains('active')) {
                    finish();
                    return;
                }

                if (Date.now() - startTime >= BOOTSTRAP_HANDOFF_MAX_WAIT_MS) {
                    finish();
                    return;
                }

                requestAnimationFrame(checkVisibility);
            };

            requestAnimationFrame(checkVisibility);
        });
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
            if (!placeholderSuppressed && existingPlaceholder.dataset.chatWidgetPlaceholderOpening !== '1') {
                existingPlaceholder.classList.remove('chat-widget-fab--ambient-retracted');
            }
            if (placeholderSuppressed) {
                setPlaceholderSuppressed(true);
            }
            return placeholderFab;
        }

        const fab = document.createElement('div');
        fab.className = 'chat-widget-fab chat-widget-fab--peek';
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
        if (placeholderSuppressed) {
            setPlaceholderSuppressed(true);
        }
        return placeholderFab;
    }

    function restoreClosedRuntimeFabVisibility() {
        const widget = global.chatWidget;
        if (widget?.isOpen) {
            return false;
        }

        const runtimeFab = widget?.fab?.isConnected
            ? widget.fab
            : document.querySelector('.chat-widget-fab:not([data-chat-widget-placeholder="1"])');
        if (!runtimeFab) {
            return false;
        }

        runtimeFab.classList.remove(
            'chat-widget-fab--hidden',
            'chat-widget-fab--disabled',
            'chat-widget-fab--ambient-retracted'
        );
        runtimeFab.removeAttribute('aria-hidden');
        runtimeFab.removeAttribute('aria-busy');
        return true;
    }

    function setBootstrapLoadingPageFabHidden(hidden) {
        const active = Boolean(hidden);
        document.documentElement?.classList?.toggle('chat-widget-bootstrap-loading', active);
        document.body?.classList?.toggle('chat-widget-bootstrap-loading', active);
    }

    function setBootstrapLoadingPageScrollLocked(locked) {
        const active = Boolean(locked);
        document.documentElement?.classList?.toggle('chat-widget-bootstrap-scroll-locked', active);
        document.body?.classList?.toggle('chat-widget-bootstrap-scroll-locked', active);
    }

    function lockBootstrapLoadingPageScroll(loadingShell) {
        if (bootstrapScrollLockActive) {
            return;
        }

        bootstrapScrollLockActive = true;
        setBootstrapLoadingPageScrollLocked(true);

        const shell = loadingShell?.shell || null;
        if (!shell || typeof global.iOSScrollLock?.lockLight !== 'function') {
            return;
        }

        try {
            global.iOSScrollLock.lockLight(shell, { restoreScrollDuringViewport: true });
        } catch (error) {
            console.warn('[ChatWidgetLoader] Failed to lock page scroll for bootstrap shell:', error);
        }
    }

    function releaseBootstrapLoadingPageScroll(options = {}) {
        const preserveForHandoff = options.preserveForHandoff === true;
        setBootstrapLoadingPageScrollLocked(false);

        if (!bootstrapScrollLockActive) {
            return;
        }

        bootstrapScrollLockActive = false;
        if (preserveForHandoff) {
            return;
        }

        if (typeof global.iOSScrollLock?.unlock !== 'function') {
            return;
        }

        try {
            global.iOSScrollLock.unlock();
        } catch (error) {
            console.warn('[ChatWidgetLoader] Failed to unlock page scroll for bootstrap shell:', error);
        }
    }

    function suppressRuntimeFabDuringBootstrapLoading() {
        const runtimeFab = global.chatWidget?.fab?.isConnected
            ? global.chatWidget.fab
            : document.querySelector('.chat-widget-fab:not([data-chat-widget-placeholder="1"])');
        if (!runtimeFab) {
            return false;
        }

        runtimeFab.classList.add('chat-widget-fab--hidden', 'chat-widget-fab--disabled');
        runtimeFab.setAttribute('aria-hidden', 'true');
        runtimeFab.setAttribute('aria-busy', 'true');
        return true;
    }

    function setPlaceholderSuppressed(suppressed) {
        placeholderSuppressed = Boolean(suppressed);
        setBootstrapLoadingPageFabHidden(placeholderSuppressed);
        const fab = placeholderFab?.isConnected
            ? placeholderFab
            : document.querySelector('.chat-widget-fab[data-chat-widget-placeholder="1"]');
        if (!fab) {
            if (suppressed) {
                suppressRuntimeFabDuringBootstrapLoading();
                return;
            }
            if (!suppressed) {
                restoreClosedRuntimeFabVisibility();
            }
            return;
        }

        fab.dataset.chatWidgetPlaceholderSuppressed = suppressed ? '1' : '0';
        fab.removeAttribute('data-chat-widget-placeholder-opening');
        fab.classList.toggle('chat-widget-fab--hidden', Boolean(suppressed));
        fab.classList.toggle('chat-widget-fab--disabled', Boolean(suppressed));
        if (suppressed) {
            fab.setAttribute('aria-hidden', 'true');
        } else {
            fab.removeAttribute('aria-hidden');
            if (!fab.hasAttribute('data-chat-widget-loading')) {
                fab.removeAttribute('aria-busy');
            }
        }
    }

    function setPlaceholderLoadingState(loading, options = {}) {
        const fab = createPlaceholderFab();
        if (!fab) {
            return;
        }

        const lockInteraction = options.lockInteraction === true;
        const suppressed = fab.dataset.chatWidgetPlaceholderSuppressed === '1';
        const opening = fab.dataset.chatWidgetPlaceholderOpening === '1';
        fab.classList.toggle('chat-widget-fab--disabled', (Boolean(loading) && lockInteraction) || suppressed || opening);
        if (suppressed || opening) {
            fab.removeAttribute('data-chat-widget-loading');
            if (loading || opening) {
                fab.setAttribute('aria-busy', 'true');
            } else {
                fab.removeAttribute('aria-busy');
            }
            return;
        }
        if (loading) {
            fab.setAttribute('data-chat-widget-loading', '1');
            fab.setAttribute('aria-busy', 'true');
        } else {
            fab.removeAttribute('data-chat-widget-loading');
            fab.removeAttribute('aria-busy');
        }
    }

    function loadScript(src) {
        const resolvedSrc = resolveAssetUrl(src);
        const existing = findExistingScriptBySrc(src);
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
            script.src = resolvedSrc;
            script.async = false;
            script.dataset.loaded = '0';
        }

        const promise = new Promise((resolve, reject) => {
            const handleLoad = () => {
                script.dataset.loaded = '1';
                resolve(script);
            };
            const handleError = () => reject(new Error(`Failed to load ${resolvedSrc}`));

            script.addEventListener('load', handleLoad, { once: true });
            script.addEventListener('error', handleError, { once: true });

            if (!existing) {
                (document.body || document.head || document.documentElement).appendChild(script);
            }
        });

        script.__zaoyoeLoadPromise = promise;
        return promise;
    }

    function warmWidgetResources(options = {}) {
        if (!widgetWarmPromise) {
            setPlaceholderLoadingState(true, {
                lockInteraction: options.lockInteraction === true
            });
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
        if (!pendingOpen || !global.chatWidget) {
            return;
        }

        const widget = global.chatWidget;
        const openDismissToken = bootstrapDismissToken;
        pendingOpen = false;

        if (typeof widget.openChat === 'function') {
            Promise.resolve(widget.openChat())
                .then((readyWidget) => {
                    const activeWidget = readyWidget || widget;
                    if (openDismissToken !== bootstrapDismissToken || !activeWidget?.isOpen) {
                        return null;
                    }
                    syncBootstrapLoadingShellMode(bootstrapLoadingShell, activeWidget?.isAdmin ? 'admin' : 'user');
                    return activeWidget;
                })
                .then((activeWidget) => {
                    if (!activeWidget || openDismissToken !== bootstrapDismissToken || !activeWidget.isOpen) {
                        return null;
                    }
                    return waitForWidgetWindowHandoff(activeWidget).then(() => activeWidget);
                })
                .then((activeWidget) => {
                    if (!activeWidget || openDismissToken !== bootstrapDismissToken || !activeWidget.isOpen) {
                        return;
                    }
                    if (typeof activeWidget.clearUnread === 'function') {
                        activeWidget.clearUnread();
                    }
                    hideBootstrapLoadingShell({ handoff: true });
                })
                .catch((error) => {
                    if (openDismissToken === bootstrapDismissToken) {
                        pendingOpen = true;
                    }
                    hideBootstrapLoadingShell();
                    console.error('[ChatWidgetLoader] Failed to open chat widget:', error);
                });
            return;
        }

        if (typeof widget.toggleChat === 'function' && !widget.isOpen) {
            widget.toggleChat();
        }
        if (widget.isOpen && typeof widget.clearUnread === 'function') {
            widget.clearUnread();
        }
        hideBootstrapLoadingShell();
    }

    function queueRuntimeOpenWhenReady(widget = global.chatWidget) {
        if (!widget || runtimePendingOpenWatcher) {
            return;
        }

        const readyDismissToken = bootstrapDismissToken;
        runtimePendingOpenWatcher = Promise.resolve(widget.ready || widget)
            .then(() => {
                runtimePendingOpenWatcher = null;
                if (readyDismissToken !== bootstrapDismissToken) {
                    return;
                }
                openWidgetIfPending();
            })
            .catch((error) => {
                runtimePendingOpenWatcher = null;
                if (readyDismissToken === bootstrapDismissToken) {
                    pendingOpen = false;
                    hideBootstrapLoadingShell();
                }
                console.error('[ChatWidgetLoader] Failed while waiting for runtime open:', error);
            });
    }

    function requestRuntimePendingOpen() {
        pendingOpen = true;
        showBootstrapLoadingShell();
        queueRuntimeOpenWhenReady(global.chatWidget);
    }

    function handleRuntimePendingOpenRequest() {
        requestRuntimePendingOpen();
    }

    function tryInitChatWidget() {
        if (global.chatWidget) {
            const shouldRestoreClosedRuntimeFab = !pendingOpen;
            stopPolling();
            openWidgetIfPending();
            if (shouldRestoreClosedRuntimeFab) {
                restoreClosedRuntimeFabVisibility();
            }
            return true;
        }

        const ChatWidgetCtor = getChatWidgetConstructor();
        if (!ChatWidgetCtor || !global.supabaseClient) {
            return false;
        }

        try {
            const shouldRestoreClosedRuntimeFab = !pendingOpen;
            global.chatWidget = new ChatWidgetCtor(global.supabaseClient);
            stopPolling();
            openWidgetIfPending();
            if (shouldRestoreClosedRuntimeFab) {
                restoreClosedRuntimeFabVisibility();
            }
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
            showBootstrapLoadingShell();
        }

        ensureChatWidgetStyles();
        createPlaceholderFab();

        return warmWidgetResources({
            lockInteraction: openRequested
        }).then(() => {
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
            hideBootstrapLoadingShell();
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
        fab.addEventListener('pointerdown', openOnIntent);
        fab.addEventListener('touchstart', openOnIntent);
        fab.addEventListener('click', openOnIntent);
        fab.addEventListener('keydown', openOnIntent);
    }

    function startChatWidgetBootstrap() {
        if (hasWidgetInstance()) {
            return;
        }

        ensureChatWidgetStyles();
        createPlaceholderFab();
        bindPlaceholderEvents();
        scheduleEngagementRuntimeWarm();
    }

    function startChatWidgetBootstrapWhenBodyReady() {
        if (document.body) {
            startChatWidgetBootstrap();
            return;
        }

        document.addEventListener('DOMContentLoaded', startChatWidgetBootstrap, { once: true });
    }

    function scheduleEngagementRuntimeWarm() {
        if (engagementRuntimeWarmScheduled || hasWidgetInstance()) {
            return;
        }
        engagementRuntimeWarmScheduled = true;

        const warmRuntime = () => {
            if (hasWidgetInstance()) {
                return;
            }
            ensureChatWidgetReady({ open: false }).catch((error) => {
                console.warn('[ChatWidgetLoader] Failed to warm engagement runtime:', error);
            });
        };

        if (typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(warmRuntime, {
                timeout: ENGAGEMENT_RUNTIME_WARM_DELAY_MS + 1600
            });
            return;
        }

        global.setTimeout(warmRuntime, ENGAGEMENT_RUNTIME_WARM_DELAY_MS);
    }

    global.addEventListener?.('zaoyoe:chat-widget-runtime-pending-open', handleRuntimePendingOpenRequest);
    global.addEventListener?.('resize', handleBootstrapViewportModeChange, { passive: true });
    global.visualViewport?.addEventListener?.('resize', handleBootstrapViewportModeChange, { passive: true });
    document.addEventListener?.('fullscreenchange', handleBootstrapViewportModeChange, { passive: true });
    document.addEventListener?.('webkitfullscreenchange', handleBootstrapViewportModeChange, { passive: true });
    startChatWidgetBootstrapWhenBodyReady();

    global.ZaoyoeChatWidgetBootstrap = Object.freeze({
        version: VERSION,
        warm: () => ensureChatWidgetReady({ open: false }),
        open: () => ensureChatWidgetReady({ open: true }),
        requestPendingOpen: requestRuntimePendingOpen
    });
}(typeof window !== 'undefined' ? window : globalThis));
