(function (global) {
    'use strict';

    if (global.__zaoyoeAdminScrollbarAutoHideHelperLoaded) {
        return;
    }
    global.__zaoyoeAdminScrollbarAutoHideHelperLoaded = true;

    const VERSION = '20260424_ADMIN_SCROLLBAR_AUTO_HIDE_HELPER_1';
    const ADMIN_SCROLLBAR_AUTO_HIDE_CLASS = 'admin-scrollbar-auto-hide';
    const ADMIN_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS = 'admin-scrollbar-auto-hide--visible';
    const ADMIN_SCROLLBAR_AUTO_HIDE_BOUND_ATTR = 'data-admin-scrollbar-auto-hide-helper-bound';
    const ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR = [
        '.modal-body',
        '.batch-modal-body',
        '.user-modal-body',
        '.batch-export-modal-body'
    ].join(', ');

    function markAdminScrollbarActive(target) {
        if (!(target instanceof HTMLElement)) return;

        target.classList.add(ADMIN_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS);

        if (target.__adminScrollbarHideHelperTimer) {
            window.clearTimeout(target.__adminScrollbarHideHelperTimer);
        }

        target.__adminScrollbarHideHelperTimer = window.setTimeout(() => {
            target.classList.remove(ADMIN_SCROLLBAR_AUTO_HIDE_VISIBLE_CLASS);
            target.__adminScrollbarHideHelperTimer = null;
        }, 720);
    }

    function bindAdminScrollbarAutoHide(target) {
        if (!(target instanceof HTMLElement)) return;
        if (target.getAttribute(ADMIN_SCROLLBAR_AUTO_HIDE_BOUND_ATTR) === '1') return;

        target.setAttribute(ADMIN_SCROLLBAR_AUTO_HIDE_BOUND_ATTR, '1');
        target.classList.add(ADMIN_SCROLLBAR_AUTO_HIDE_CLASS);
        target.addEventListener('mouseenter', () => markAdminScrollbarActive(target), { passive: true });
        target.addEventListener('focusin', () => markAdminScrollbarActive(target));
        target.addEventListener('scroll', () => markAdminScrollbarActive(target), { passive: true });
    }

    function collectAdminScrollbarTargets(root) {
        const targets = [];

        if (root instanceof Element && root.matches(ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR)) {
            targets.push(root);
        }

        if (root instanceof Element || root instanceof DocumentFragment || root === document) {
            targets.push(...root.querySelectorAll(ADMIN_SCROLLBAR_AUTO_HIDE_SELECTOR));
        }

        return targets;
    }

    function initAdminScrollbarAutoHide(root = document) {
        const targets = collectAdminScrollbarTargets(root);
        for (const target of targets) {
            bindAdminScrollbarAutoHide(target);
        }
    }

    function observeAdminScrollbarAutoHide() {
        if (document.documentElement.dataset.adminScrollbarAutoHideHelperObserver === '1') {
            return;
        }

        document.documentElement.dataset.adminScrollbarAutoHideHelperObserver = '1';
        initAdminScrollbarAutoHide(document);

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    initAdminScrollbarAutoHide(node);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        global.__adminScrollbarAutoHideHelperObserver = observer;
    }

    function bootAdminScrollbarAutoHide() {
        observeAdminScrollbarAutoHide();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootAdminScrollbarAutoHide, { once: true });
    } else {
        bootAdminScrollbarAutoHide();
    }

    global.ZaoyoeAdminScrollbarAutoHideHelper = Object.freeze({
        version: VERSION,
        init: initAdminScrollbarAutoHide,
        mark: markAdminScrollbarActive
    });
}(typeof window !== 'undefined' ? window : globalThis));
