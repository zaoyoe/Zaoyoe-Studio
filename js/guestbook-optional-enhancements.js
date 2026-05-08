(function () {
    'use strict';

    const optionalResources = new Set();

    function runWhenIdle(task, timeout = 1200) {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(task, { timeout });
            return;
        }

        setTimeout(task, 0);
    }

    function scheduleOptionalTask(delay, task, idleTimeout = 1200) {
        setTimeout(() => {
            runWhenIdle(task, idleTimeout);
        }, delay);
    }

    function hasResource(selector) {
        return Boolean(document.querySelector(selector));
    }

    function loadScript(src, onload) {
        if (optionalResources.has(src) || hasResource(`script[src="${src}"]`)) {
            if (typeof onload === 'function') {
                onload();
            }
            return;
        }

        optionalResources.add(src);
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.fetchPriority = 'low';

        if (typeof onload === 'function') {
            script.addEventListener('load', onload, { once: true });
        }

        document.body.appendChild(script);
    }

    function loadStylesheet(href) {
        if (optionalResources.has(href) || hasResource(`link[href="${href}"]`)) {
            return;
        }

        optionalResources.add(href);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.setAttribute('fetchpriority', 'low');
        document.head.appendChild(link);
    }

    function initChatWidgetIfReady() {
        if (window.chatWidget || typeof ChatWidget === 'undefined') {
            return;
        }

        window.chatWidget = new ChatWidget(window.supabaseClient);
    }

    function scheduleOptionalGuestbookEnhancements() {
        scheduleOptionalTask(250, () => {
            loadScript('./starry-sky.js?v=20260503_GUESTBOOK_DARK_STARRY_BG_1');
        }, 800);

        scheduleOptionalTask(2200, () => {
            loadStylesheet('css/chat-widget.css?v=20260507_CHAT_WIDGET_ADAPTIVE_BUBBLE_1');
            loadScript('js/components/ChatWidget.js?v=20260508_ENGAGEMENT_SITE_SCOPE_2', initChatWidgetIfReady);
        }, 2200);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleOptionalGuestbookEnhancements, { once: true });
    } else {
        scheduleOptionalGuestbookEnhancements();
    }
}());
