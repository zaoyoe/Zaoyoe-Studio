(function (global) {
    'use strict';

    if (global.__zaoyoePublicScrollbarAutoHideLoaded) {
        return;
    }
    global.__zaoyoePublicScrollbarAutoHideLoaded = true;

    const VERSION = '20260430_PUBLIC_SCROLLBAR_FULL_HIDE_1';
    const STYLE_HREF = 'css/public-scrollbar-auto-hide.css?v=f5a4ba7fbfa7';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_CLASS = 'public-scrollbar-auto-hide';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS = 'public-scrollbar-auto-hide--visible';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_ROOT_CLASS = 'public-scrollbar-auto-hide--root';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_NO_GUTTER_CLASS = 'public-scrollbar-auto-hide--no-gutter';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_BOUND_ATTR = 'data-public-scrollbar-auto-hide-bound';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_SELECTOR = [
        'body.prompts-page',
        '#profileModal',
        '.auth-sheet-body',
        '#profileModal .profile-modal-scroll',
        '#profileModal .modal-content.profile-modal',
        '.modal-overlay',
        '.modal-content',
        '.zaoyoe-announcement-modal .zaoyoe-announcement-text',
        '.wallet-modal',
        '.wallet-content',
        '.wallet-layout',
        '.wallet-affiliate-shell',
        '.wallet-order-modal-body',
        '.history-container',
        '.orders-container',
        '.shop-cart-drawer__body',
        '.shop-cart-item__panel',
        '.shop-cart-checkout__list',
        '.shop-success-scroll',
        '#shopPurchaseModal .shop-success-usage-card',
        '#shopSuccessModal.has-usage-instructions .shop-success-usage-card',
        '.shop-inline-style-attr-31',
        '.chat-messages',
        '.chat-support-panel',
        '.chat-support-card--fullscreen',
        '.message-list',
        '.modal-content-col',
        '.prompt-text:not(.blur-masked)',
        '.comment-list:not(.collapsed)',
        '#commentInput',
        '#promptCommentComposerInput',
        '.verify-batch-results',
        '.verify-history-list'
    ].join(', ');

    function ensureStyles() {
        let link = document.getElementById('public-scrollbar-auto-hide-css');
        if (!link) {
            link = document.createElement('link');
            link.id = 'public-scrollbar-auto-hide-css';
            link.rel = 'stylesheet';
            link.href = STYLE_HREF;
            (document.head || document.documentElement || document.body).appendChild(link);
        } else if (link.getAttribute('href') !== STYLE_HREF) {
            link.href = STYLE_HREF;
        }

        return link;
    }

    function isPublicRootScrollbarTarget(target) {
        const scrollingElement = document.scrollingElement || document.documentElement;
        return target === scrollingElement || target === document.documentElement || target === document.body;
    }

    function collectPublicRootScrollbarTargets(root) {
        if (root !== document && root !== document.documentElement && root !== document.body) return [];

        return Array.from(new Set([
            document.scrollingElement || document.documentElement,
            document.documentElement,
            document.body
        ])).filter((target) => target instanceof HTMLElement);
    }

    function markPublicScrollbarActive(target) {
        if (!(target instanceof HTMLElement)) return;

        target.classList.add(PUBLIC_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS);

        if (target.__publicScrollbarHideTimer) {
            window.clearTimeout(target.__publicScrollbarHideTimer);
        }

        target.__publicScrollbarHideTimer = window.setTimeout(() => {
            target.classList.remove(PUBLIC_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS);
            target.__publicScrollbarHideTimer = null;
        }, 720);
    }

    function bindPublicScrollbarAutoHide(target) {
        if (!(target instanceof HTMLElement)) return;
        if (target.getAttribute(PUBLIC_SCROLLBAR_AUTO_HIDE_BOUND_ATTR) === '1') return;

        const isRootScrollbarTarget = isPublicRootScrollbarTarget(target);
        const markRootScrollbarActive = () => markPublicScrollbarActive(target);

        target.setAttribute(PUBLIC_SCROLLBAR_AUTO_HIDE_BOUND_ATTR, '1');
        target.classList.add(PUBLIC_SCROLLBAR_AUTO_HIDE_CLASS);
        target.classList.add(PUBLIC_SCROLLBAR_AUTO_HIDE_NO_GUTTER_CLASS);
        if (isRootScrollbarTarget) {
            target.classList.add(PUBLIC_SCROLLBAR_AUTO_HIDE_ROOT_CLASS);
        }
        target.addEventListener('mouseenter', () => markPublicScrollbarActive(target), { passive: true });
        if (!isRootScrollbarTarget) {
            target.addEventListener('focusin', () => markPublicScrollbarActive(target));
        }
        target.addEventListener('scroll', () => markPublicScrollbarActive(target), { passive: true });
        target.addEventListener('touchstart', () => markPublicScrollbarActive(target), { passive: true });

        if (isRootScrollbarTarget) {
            window.addEventListener('scroll', markRootScrollbarActive, { passive: true });
            window.addEventListener('wheel', markRootScrollbarActive, { passive: true });
            window.addEventListener('touchmove', markRootScrollbarActive, { passive: true });
        }
    }

    function collectPublicScrollbarTargets(root) {
        const targets = collectPublicRootScrollbarTargets(root);

        if (root instanceof Element && root.matches(PUBLIC_SCROLLBAR_AUTO_HIDE_SELECTOR)) {
            targets.push(root);
        }

        if (root instanceof Element || root instanceof DocumentFragment || root === document) {
            targets.push(...root.querySelectorAll(PUBLIC_SCROLLBAR_AUTO_HIDE_SELECTOR));
        }

        return Array.from(new Set(targets));
    }

    function initPublicScrollbarAutoHide(root = document) {
        ensureStyles();
        const targets = collectPublicScrollbarTargets(root);
        for (const target of targets) {
            bindPublicScrollbarAutoHide(target);
        }
    }

    function observePublicScrollbarAutoHide() {
        if (document.documentElement.dataset.publicScrollbarAutoHideObserver === '1') {
            return;
        }

        document.documentElement.dataset.publicScrollbarAutoHideObserver = '1';
        initPublicScrollbarAutoHide(document);

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    initPublicScrollbarAutoHide(node);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        global.__publicScrollbarAutoHideObserver = observer;
    }

    function bootPublicScrollbarAutoHide() {
        ensureStyles();
        observePublicScrollbarAutoHide();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootPublicScrollbarAutoHide, { once: true });
    } else {
        bootPublicScrollbarAutoHide();
    }

    global.ZaoyoePublicScrollbarAutoHide = Object.freeze({
        version: VERSION,
        init: initPublicScrollbarAutoHide,
        mark: markPublicScrollbarActive
    });
}(typeof window !== 'undefined' ? window : globalThis));
