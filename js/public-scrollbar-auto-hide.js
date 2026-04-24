(function (global) {
    'use strict';

    if (global.__zaoyoePublicScrollbarAutoHideLoaded) {
        return;
    }
    global.__zaoyoePublicScrollbarAutoHideLoaded = true;

    const VERSION = '20260424_PUBLIC_SCROLLBAR_AUTO_HIDE_1';
    const STYLE_HREF = 'css/public-scrollbar-auto-hide.css?v=20260424_PUBLIC_SCROLLBAR_AUTO_HIDE_1';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_CLASS = 'public-scrollbar-auto-hide';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS = 'public-scrollbar-auto-hide--visible';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_BOUND_ATTR = 'data-public-scrollbar-auto-hide-bound';
    const PUBLIC_SCROLLBAR_AUTO_HIDE_SELECTOR = [
        '.auth-sheet-body',
        '#profileModal .profile-modal-scroll',
        '.wallet-modal',
        '.wallet-content',
        '.wallet-layout',
        '.wallet-affiliate-shell',
        '.wallet-order-modal-body',
        '.history-container',
        '.message-list',
        '.comment-list:not(.collapsed)',
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

        target.setAttribute(PUBLIC_SCROLLBAR_AUTO_HIDE_BOUND_ATTR, '1');
        target.classList.add(PUBLIC_SCROLLBAR_AUTO_HIDE_CLASS);
        target.addEventListener('mouseenter', () => markPublicScrollbarActive(target), { passive: true });
        target.addEventListener('focusin', () => markPublicScrollbarActive(target));
        target.addEventListener('scroll', () => markPublicScrollbarActive(target), { passive: true });
        target.addEventListener('touchstart', () => markPublicScrollbarActive(target), { passive: true });
    }

    function collectPublicScrollbarTargets(root) {
        const targets = [];

        if (root instanceof Element && root.matches(PUBLIC_SCROLLBAR_AUTO_HIDE_SELECTOR)) {
            targets.push(root);
        }

        if (root instanceof Element || root instanceof DocumentFragment || root === document) {
            targets.push(...root.querySelectorAll(PUBLIC_SCROLLBAR_AUTO_HIDE_SELECTOR));
        }

        return targets;
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
