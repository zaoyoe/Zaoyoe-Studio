/**
 * 💳 Wallet Modal - User Interface for Points System
 * A simple, robust wallet modal implementation.
 */
(function () {
    'use strict';

    const supabase = window.supabaseClient;
    if (!supabase) {
        console.error('[WalletModal] ❌ Supabase client not found!');
        return;
    }

    console.log('[WalletModal] ✅ Initializing...');

    // Inject CSS if not already present
    const walletCssHref = 'css/wallet.css?v=20260316_WALLET_VIEWPORT_BOTTOM_INSET_FIX_1';
    const existingWalletCss = document.getElementById('wallet-modal-css');
    if (existingWalletCss) {
        existingWalletCss.href = walletCssHref;
    } else {
        const link = document.createElement('link');
        link.id = 'wallet-modal-css';
        link.rel = 'stylesheet';
        link.href = walletCssHref;
        document.head.appendChild(link);
    }

    const WALLET_MODAL_KEYBOARD_SETTLE_MS = 120;
    const WALLET_MODAL_SCROLL_STATE_CLEAR_MS = 320;
    const WALLET_MODAL_KEYBOARD_THRESHOLD = 120;
    const WALLET_MODAL_DOCK_THRESHOLD = 60;
    const WALLET_MODAL_UNDOCK_THRESHOLD = 40;
    const WALLET_MODAL_UNDOCK_DELAY_MS = 48;
    const WALLET_MODAL_DOCK_ANIMATION_MS = 180;
    const walletModalState = {
        overlayBaseHeight: 0,
        overlayBaseVisualHeight: 0,
        baseScrollY: 0,
        pageFrozen: false,
        usingLegacyScrollLock: false,
        layoutRafId: 0,
        viewportRafId: 0,
        settleTimer: null,
        blurTimer: null,
        openingTimer: null,
        scrollAnimationClearTimer: null,
        scrollAnimationHost: null,
        scrollAnimationTarget: null,
        focusTransferUntil: 0,
        lastFocusAnchor: null,
        viewportCleanup: null,
        lastViewportHeight: 0,
        keyboardDocked: false,
        pendingUndockTimer: null,
        animationCleanupTimer: null,
        scrollCueRafId: 0,
        lastKeyboardInset: 0,
        animatingUntil: 0
    };

    function isWalletModalIOSMode() {
        const ua = navigator.userAgent || '';
        const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isiOS && window.matchMedia('(max-width: 768px)').matches && !!window.visualViewport;
    }

    function getWalletModalElements() {
        const overlay = document.getElementById('wallet-modal-overlay');
        const viewport = overlay?.querySelector('.wallet-viewport') || null;
        const layout = overlay?.querySelector('.wallet-layout') || null;
        const content = overlay?.querySelector('.wallet-content') || null;
        return {
            overlay,
            viewport,
            card: overlay?.querySelector('.wallet-modal') || null,
            layout,
            content,
            scroller: isWalletModalIOSMode() ? (layout || content) : (content || layout),
            inputs: overlay
                ? Array.from(overlay.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled])'))
                : []
        };
    }

    function isWalletModalCompactMobile() {
        return window.matchMedia('(max-width: 600px)').matches;
    }

    function measureWalletModalViewport() {
        const vv = window.visualViewport;
        const docEl = document.documentElement;

        return {
            top: Math.max(0, Math.round(vv?.offsetTop || 0)),
            left: Math.max(0, Math.round(vv?.offsetLeft || 0)),
            width: Math.max(320, Math.round(vv?.width || window.innerWidth || docEl.clientWidth || 0)),
            height: Math.max(260, Math.round(vv?.height || window.innerHeight || docEl.clientHeight || 0))
        };
    }

    function getWalletModalStableViewportHeight() {
        const vv = window.visualViewport;
        const docEl = document.documentElement;
        return Math.max(
            320,
            Math.round(window.innerHeight || 0),
            Math.round(docEl.clientHeight || 0),
            Math.round(((vv?.height || 0) + (vv?.offsetTop || 0)) || 0)
        );
    }

    function getActiveWalletModalInput() {
        const { overlay } = getWalletModalElements();
        const active = document.activeElement;
        if (!overlay || !active || !overlay.contains(active)) return null;
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
    }

    function clearWalletModalTimers() {
        if (walletModalState.layoutRafId) {
            cancelAnimationFrame(walletModalState.layoutRafId);
            walletModalState.layoutRafId = 0;
        }
        if (walletModalState.viewportRafId) {
            cancelAnimationFrame(walletModalState.viewportRafId);
            walletModalState.viewportRafId = 0;
        }
        if (walletModalState.scrollCueRafId) {
            cancelAnimationFrame(walletModalState.scrollCueRafId);
            walletModalState.scrollCueRafId = 0;
        }
        cancelWalletModalScrollAnimation();
        if (walletModalState.settleTimer) {
            clearTimeout(walletModalState.settleTimer);
            walletModalState.settleTimer = null;
        }
        if (walletModalState.blurTimer) {
            clearTimeout(walletModalState.blurTimer);
            walletModalState.blurTimer = null;
        }
        if (walletModalState.openingTimer) {
            clearTimeout(walletModalState.openingTimer);
            walletModalState.openingTimer = null;
        }
        if (walletModalState.pendingUndockTimer) {
            clearTimeout(walletModalState.pendingUndockTimer);
            walletModalState.pendingUndockTimer = null;
        }
        if (walletModalState.animationCleanupTimer) {
            clearTimeout(walletModalState.animationCleanupTimer);
            walletModalState.animationCleanupTimer = null;
        }
    }

    function freezeWalletModalPage() {
        if (walletModalState.pageFrozen || !isWalletModalIOSMode()) return;

        walletModalState.baseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
        document.documentElement.classList.add('wallet-modal-lock');
        document.body.classList.add('wallet-modal-lock');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${walletModalState.baseScrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
        walletModalState.pageFrozen = true;
        stabilizeWalletModalViewport();
    }

    function unfreezeWalletModalPage() {
        if (!walletModalState.pageFrozen) return;

        const restoreScrollY = walletModalState.baseScrollY;
        document.documentElement.classList.remove('wallet-modal-lock');
        document.body.classList.remove('wallet-modal-lock');
        document.documentElement.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        walletModalState.pageFrozen = false;
        walletModalState.baseScrollY = 0;

        requestAnimationFrame(() => {
            window.scrollTo(0, restoreScrollY);
        });
    }

    function stabilizeWalletModalViewport() {
        if (!walletModalState.pageFrozen) return;

        document.body.style.top = `-${walletModalState.baseScrollY}px`;

        if ((window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
        }

        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }

    function clearWalletModalScrollAnimationState() {
        if (walletModalState.scrollAnimationClearTimer) {
            clearTimeout(walletModalState.scrollAnimationClearTimer);
            walletModalState.scrollAnimationClearTimer = null;
        }
        walletModalState.scrollAnimationHost = null;
        walletModalState.scrollAnimationTarget = null;
    }

    function cancelWalletModalScrollAnimation() {
        const scrollHost = walletModalState.scrollAnimationHost;
        clearWalletModalScrollAnimationState();

        if (!scrollHost || !scrollHost.isConnected) {
            return;
        }

        const currentTop = scrollHost.scrollTop;
        try {
            scrollHost.scrollTo({ top: currentTop, behavior: 'auto' });
        } catch (_) {
            scrollHost.scrollTop = currentTop;
        }
    }

    function resetWalletModalVisualState() {
        const { overlay, viewport, card, scroller } = getWalletModalElements();
        if (!overlay || !card) return;

        overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
        overlay.querySelector('.wallet-recharge-scroll-cue')?.classList.remove('visible');
        viewport?.style.setProperty('--wallet-modal-translate-y', '0px');
        viewport?.style.removeProperty('--wallet-modal-overlay-height');
        viewport?.style.removeProperty('--wallet-modal-viewport-top');
        viewport?.style.removeProperty('--wallet-modal-viewport-left');
        viewport?.style.removeProperty('--wallet-modal-viewport-width');
        card.style.removeProperty('max-height');
        card.style.removeProperty('height');
        card.style.removeProperty('min-height');
        scroller?.style.removeProperty('scroll-padding-bottom');
        scroller?.style.removeProperty('scroll-padding-top');
        walletModalState.overlayBaseHeight = 0;
        walletModalState.overlayBaseVisualHeight = 0;
        walletModalState.focusTransferUntil = 0;
        walletModalState.lastFocusAnchor = null;
        walletModalState.lastViewportHeight = 0;
        clearWalletModalScrollAnimationState();
    }

    function updateWalletRechargeScrollCue() {
        const { overlay, scroller } = getWalletModalElements();
        const cue = overlay?.querySelector('.wallet-recharge-scroll-cue');
        const rechargeView = overlay?.querySelector('#view-recharge');

        if (!cue) return;

        if (!overlay || !scroller || !rechargeView || !overlay.classList.contains('active')) {
            cue.classList.remove('visible');
            return;
        }

        const isRechargeActive = rechargeView.classList.contains('active');
        const isCompactMobile = isWalletModalCompactMobile();
        if (!isRechargeActive || !isCompactMobile) {
            cue.classList.remove('visible');
            return;
        }

        const overflowAmount = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (overflowAmount < 32) {
            cue.classList.remove('visible');
            return;
        }

        const nearTop = scroller.scrollTop <= 18;
        const keyboardActive = overlay.classList.contains('keyboard-active') || overlay.classList.contains('ios-focus-lock');

        cue.classList.toggle('visible', nearTop && !keyboardActive);
    }

    function requestWalletRechargeScrollCueUpdate() {
        if (walletModalState.scrollCueRafId) return;
        walletModalState.scrollCueRafId = requestAnimationFrame(() => {
            walletModalState.scrollCueRafId = 0;
            updateWalletRechargeScrollCue();
        });
    }

    function captureWalletModalOverlayBaseHeight(force = false) {
        const vv = window.visualViewport;
        const stableHeight = getWalletModalStableViewportHeight();
        const stableVisualHeight = Math.max(
            260,
            Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0)
        );
        if (!stableHeight || !stableVisualHeight) return;

        if (force || Math.abs(stableHeight - walletModalState.overlayBaseHeight) > 2) {
            walletModalState.overlayBaseHeight = stableHeight;
        }

        if (force || Math.abs(stableVisualHeight - walletModalState.overlayBaseVisualHeight) > 2) {
            walletModalState.overlayBaseVisualHeight = stableVisualHeight;
        }
    }

    function getWalletModalViewportSnapshot() {
        const viewportMetrics = measureWalletModalViewport();
        const visualBottom = viewportMetrics.top + viewportMetrics.height;
        const stableViewportHeight = getWalletModalStableViewportHeight();
        const baseViewportHeight = Math.max(
            walletModalState.overlayBaseHeight || 0,
            stableViewportHeight,
            visualBottom
        );
        const baseVisualHeight = Math.max(
            walletModalState.overlayBaseVisualHeight || 0,
            viewportMetrics.height
        );
        const bottomInset = Math.max(
            0,
            Math.round(baseViewportHeight - visualBottom),
            Math.round(baseVisualHeight - viewportMetrics.height)
        );

        return {
            ...viewportMetrics,
            baseViewportHeight,
            baseVisualHeight,
            visualBottom,
            bottomInset
        };
    }

    function setWalletModalAnimating(card, animate = false, duration = WALLET_MODAL_DOCK_ANIMATION_MS) {
        if (!card) return;

        if (walletModalState.animationCleanupTimer) {
            clearTimeout(walletModalState.animationCleanupTimer);
            walletModalState.animationCleanupTimer = null;
        }

        card.classList.toggle('wallet-modal-animating', !!animate);
        walletModalState.animatingUntil = animate
            ? ((typeof performance !== 'undefined' ? performance.now() : Date.now()) + duration + 24)
            : 0;

        if (!animate) return;

        walletModalState.animationCleanupTimer = setTimeout(() => {
            walletModalState.animationCleanupTimer = null;
            const { card: activeCard } = getWalletModalElements();
            activeCard?.classList.remove('wallet-modal-animating');
        }, duration + 40);
    }

    function clearWalletModalUndockTimer() {
        if (walletModalState.pendingUndockTimer) {
            clearTimeout(walletModalState.pendingUndockTimer);
            walletModalState.pendingUndockTimer = null;
        }
    }

    function applyWalletModalDockLayout(bottomInset, { animate = false } = {}) {
        const { overlay, viewport: viewportEl, card, scroller } = getWalletModalElements();
        if (!overlay || !viewportEl || !card) return;

        const snapshot = getWalletModalViewportSnapshot();
        const dockInset = Math.max(0, Math.round(bottomInset ?? snapshot.bottomInset));
        const modalMaxHeight = Math.max(260, snapshot.height - 24);
        const modalHeight = Math.min(500, modalMaxHeight);
        const centeredTop = Math.max(12, Math.round((snapshot.baseViewportHeight - modalHeight) / 2));
        const keyboardTop = Math.max(0, snapshot.baseViewportHeight - dockInset);
        const dockedTop = Math.max(
            12,
            Math.min(centeredTop, Math.round(keyboardTop - 12 - modalHeight))
        );
        const translateY = dockedTop - centeredTop;

        viewportEl.style.setProperty('--wallet-modal-viewport-top', `${snapshot.top}px`);
        viewportEl.style.setProperty('--wallet-modal-viewport-left', `${snapshot.left}px`);
        viewportEl.style.setProperty('--wallet-modal-viewport-width', `${snapshot.width}px`);
        viewportEl.style.setProperty('--wallet-modal-overlay-height', `${snapshot.baseViewportHeight}px`);
        viewportEl.style.setProperty('--wallet-modal-translate-y', `${translateY}px`);

        overlay.classList.add('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
        setWalletModalAnimating(card, animate);
        card.style.maxHeight = `${modalMaxHeight}px`;
        card.style.height = `${modalHeight}px`;
        card.style.minHeight = `${Math.min(400, modalHeight)}px`;
        if (scroller) {
            scroller.style.scrollPaddingTop = `${isWalletModalIOSMode() ? 84 : 24}px`;
            scroller.style.scrollPaddingBottom = `${Math.max(144, Math.round(dockInset + 72))}px`;
        }

        walletModalState.keyboardDocked = true;
        walletModalState.lastKeyboardInset = dockInset;
        walletModalState.lastViewportHeight = snapshot.height;
    }

    function resetWalletModalDockLayout(animate = false) {
        const { overlay, viewport: viewportEl, card, scroller } = getWalletModalElements();
        if (!overlay || !viewportEl || !card) return;

        clearWalletModalUndockTimer();

        const snapshot = getWalletModalViewportSnapshot();
        const activeInput = getActiveWalletModalInput();
        const preserveFocusLock = !!activeInput || walletModalState.focusTransferUntil > Date.now();
        const modalMaxHeight = Math.max(260, snapshot.baseViewportHeight - 24);
        const modalHeight = Math.min(500, modalMaxHeight);
        const duration = animate ? WALLET_MODAL_DOCK_ANIMATION_MS : 0;

        viewportEl.style.setProperty('--wallet-modal-viewport-top', `${snapshot.top}px`);
        viewportEl.style.setProperty('--wallet-modal-viewport-left', `${snapshot.left}px`);
        viewportEl.style.setProperty('--wallet-modal-viewport-width', `${snapshot.width}px`);
        viewportEl.style.setProperty('--wallet-modal-overlay-height', `${snapshot.baseViewportHeight}px`);
        viewportEl.style.setProperty('--wallet-modal-translate-y', '0px');

        overlay.classList.remove('keyboard-active');
        overlay.classList.add('keyboard-docked');
        overlay.classList.toggle('ios-focus-lock', preserveFocusLock);
        setWalletModalAnimating(card, animate, duration);
        card.style.maxHeight = `${modalMaxHeight}px`;
        card.style.height = `${modalHeight}px`;
        card.style.minHeight = `${Math.min(400, modalHeight)}px`;
        if (scroller) {
            scroller.style.scrollPaddingTop = `${isWalletModalIOSMode() ? 84 : 24}px`;
            scroller.style.scrollPaddingBottom = `${preserveFocusLock ? 144 : 96}px`;
        }

        walletModalState.keyboardDocked = false;
        walletModalState.lastKeyboardInset = 0;
        walletModalState.lastViewportHeight = snapshot.height;

        const cleanup = () => {
            const { overlay: activeOverlay, card: activeCard } = getWalletModalElements();
            if (!activeOverlay || !activeCard) return;
            if (!walletModalState.keyboardDocked) {
                activeOverlay.classList.remove('keyboard-docked');
                if (!getActiveWalletModalInput() && walletModalState.focusTransferUntil <= Date.now()) {
                    activeOverlay.classList.remove('ios-focus-lock');
                }
            }
            activeCard.classList.remove('wallet-modal-animating');
            requestWalletRechargeScrollCueUpdate();
        };

        if (duration) {
            if (walletModalState.animationCleanupTimer) {
                clearTimeout(walletModalState.animationCleanupTimer);
            }
            walletModalState.animationCleanupTimer = setTimeout(() => {
                walletModalState.animationCleanupTimer = null;
                cleanup();
            }, duration + 40);
        } else {
            cleanup();
        }
    }

    function applyWalletModalBaseLayout({ preserveFocusLock = false } = {}) {
        const { overlay, viewport: viewportEl, card, scroller } = getWalletModalElements();
        if (!overlay || !viewportEl || !card) return;

        const snapshot = getWalletModalViewportSnapshot();
        const modalMaxHeight = Math.max(260, snapshot.baseViewportHeight - 24);
        const modalHeight = Math.min(500, modalMaxHeight);

        viewportEl.style.setProperty('--wallet-modal-viewport-top', `${snapshot.top}px`);
        viewportEl.style.setProperty('--wallet-modal-viewport-left', `${snapshot.left}px`);
        viewportEl.style.setProperty('--wallet-modal-viewport-width', `${snapshot.width}px`);
        viewportEl.style.setProperty('--wallet-modal-overlay-height', `${snapshot.baseViewportHeight}px`);
        viewportEl.style.setProperty('--wallet-modal-translate-y', '0px');

        overlay.classList.remove('keyboard-active', 'keyboard-docked');
        overlay.classList.toggle('ios-focus-lock', preserveFocusLock);
        setWalletModalAnimating(card, false);
        card.style.maxHeight = `${modalMaxHeight}px`;
        card.style.height = `${modalHeight}px`;
        card.style.minHeight = `${Math.min(400, modalHeight)}px`;
        if (scroller) {
            scroller.style.scrollPaddingTop = `${isWalletModalIOSMode() ? 84 : 24}px`;
            scroller.style.scrollPaddingBottom = `${preserveFocusLock ? 144 : 96}px`;
        }

        walletModalState.keyboardDocked = false;
        walletModalState.lastKeyboardInset = 0;
        walletModalState.lastViewportHeight = snapshot.height;
        requestWalletRechargeScrollCueUpdate();
    }

    function scheduleWalletModalUndock() {
        if (walletModalState.pendingUndockTimer) return;
        walletModalState.pendingUndockTimer = setTimeout(() => {
            walletModalState.pendingUndockTimer = null;
            resetWalletModalDockLayout(true);
        }, WALLET_MODAL_UNDOCK_DELAY_MS);
    }

    function getWalletModalFocusAnchor(input = getActiveWalletModalInput()) {
        if (!input) return null;

        return (
            input.closest('.redeem-input-row, .afdian-input-row, .meta-section, .date-picker-row') ||
            input
        );
    }

    function animateWalletModalScroll(scrollHost, targetScrollTop) {
        if (!scrollHost) return;

        const to = Math.max(0, targetScrollTop);
        if (Math.abs(to - scrollHost.scrollTop) <= 2) {
            clearWalletModalScrollAnimationState();
            return;
        }

        if (
            walletModalState.scrollAnimationHost === scrollHost &&
            walletModalState.scrollAnimationTarget !== null &&
            Math.abs(walletModalState.scrollAnimationTarget - to) <= 2
        ) {
            return;
        }

        cancelWalletModalScrollAnimation();
        walletModalState.scrollAnimationHost = scrollHost;
        walletModalState.scrollAnimationTarget = to;

        try {
            scrollHost.scrollTo({ top: to, behavior: 'smooth' });
        } catch (_) {
            scrollHost.scrollTop = to;
            clearWalletModalScrollAnimationState();
            return;
        }

        walletModalState.scrollAnimationClearTimer = setTimeout(() => {
            if (
                walletModalState.scrollAnimationHost === scrollHost &&
                walletModalState.scrollAnimationTarget !== null &&
                Math.abs(walletModalState.scrollAnimationTarget - to) <= 2
            ) {
                clearWalletModalScrollAnimationState();
            }
        }, WALLET_MODAL_SCROLL_STATE_CLEAR_MS);
    }

    function ensureWalletModalInputVisible(input = getActiveWalletModalInput()) {
        const { card, scroller } = getWalletModalElements();
        const scrollHost = scroller || card;
        if (!card || !scrollHost || !input) return;

        const anchor = getWalletModalFocusAnchor(input) || input;
        const hostRect = scrollHost.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
        if (maxScrollTop <= 0) return;

        const preferredCenter = Math.max(
            136,
            Math.min(Math.round(scrollHost.clientHeight * 0.36), scrollHost.clientHeight - 136)
        );
        const anchorCenterInContent =
            scrollHost.scrollTop +
            (anchorRect.top - hostRect.top) +
            (anchorRect.height / 2);

        let nextScrollTop = Math.max(
            0,
            Math.min(anchorCenterInContent - preferredCenter, maxScrollTop)
        );

        const topGuardBase = scrollHost.classList?.contains('wallet-layout') ? 112 : 64;
        const topGuard = Math.max(topGuardBase, Math.round(scrollHost.clientHeight * 0.18));
        const bottomGuard = Math.max(120, Math.round(scrollHost.clientHeight * 0.28));

        if (inputRect.top < hostRect.top + topGuard) {
            nextScrollTop = Math.min(
                nextScrollTop,
                Math.max(0, scrollHost.scrollTop + (inputRect.top - (hostRect.top + topGuard)))
            );
        } else if (inputRect.bottom > hostRect.bottom - bottomGuard) {
            nextScrollTop = Math.max(
                nextScrollTop,
                Math.min(
                    maxScrollTop,
                    scrollHost.scrollTop + (inputRect.bottom - (hostRect.bottom - bottomGuard))
                )
            );
        }

        animateWalletModalScroll(scrollHost, nextScrollTop);
    }

    function markWalletModalFocusTransfer(nextInput = null) {
        walletModalState.focusTransferUntil = Date.now() + 260;
        walletModalState.lastFocusAnchor = getWalletModalFocusAnchor(nextInput) || walletModalState.lastFocusAnchor;
    }

    function applyWalletModalLayout() {
        const { overlay, viewport: viewportEl, card, scroller } = getWalletModalElements();
        if (!overlay || !viewportEl || !card || !overlay.classList.contains('active')) return;

        if (!isWalletModalIOSMode()) {
            viewportEl.style.removeProperty('--wallet-modal-overlay-height');
            viewportEl.style.removeProperty('--wallet-modal-viewport-top');
            viewportEl.style.removeProperty('--wallet-modal-viewport-left');
            viewportEl.style.removeProperty('--wallet-modal-viewport-width');
            card.style.removeProperty('max-height');
            card.style.removeProperty('height');
            card.style.removeProperty('min-height');
            scroller?.style.removeProperty('scroll-padding-bottom');
            scroller?.style.removeProperty('scroll-padding-top');
            viewportEl.style.setProperty('--wallet-modal-translate-y', '0px');
            overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
            walletModalState.lastViewportHeight = 0;
            walletModalState.keyboardDocked = false;
            walletModalState.lastKeyboardInset = 0;
            requestWalletRechargeScrollCueUpdate();
            return;
        }

        stabilizeWalletModalViewport();

        const activeInput = getActiveWalletModalInput();
        const holdDuringFocusTransfer = !activeInput && walletModalState.focusTransferUntil > Date.now();
        let snapshot = getWalletModalViewportSnapshot();
        if (!activeInput || (!walletModalState.keyboardDocked && snapshot.bottomInset < WALLET_MODAL_UNDOCK_THRESHOLD)) {
            captureWalletModalOverlayBaseHeight();
            snapshot = getWalletModalViewportSnapshot();
        }

        const bottomInset = snapshot.bottomInset;
        const inputFocused = !!activeInput;

        if ((inputFocused || holdDuringFocusTransfer) && bottomInset > WALLET_MODAL_DOCK_THRESHOLD) {
            clearWalletModalUndockTimer();
            const animateDock = walletModalState.keyboardDocked
                && Math.abs(bottomInset - walletModalState.lastKeyboardInset) > 30
                && walletModalState.animatingUntil <= (typeof performance !== 'undefined' ? performance.now() : Date.now());
            applyWalletModalDockLayout(bottomInset, { animate: animateDock });
            if (activeInput) {
                requestAnimationFrame(() => {
                    ensureWalletModalInputVisible(activeInput);
                });
                walletModalState.lastFocusAnchor = getWalletModalFocusAnchor(activeInput) || null;
            }
            return;
        }

        if (walletModalState.keyboardDocked && (!inputFocused || bottomInset <= WALLET_MODAL_UNDOCK_THRESHOLD)) {
            scheduleWalletModalUndock();
            return;
        }

        clearWalletModalUndockTimer();
        applyWalletModalBaseLayout({ preserveFocusLock: inputFocused || holdDuringFocusTransfer });

        if (!activeInput) {
            if (!holdDuringFocusTransfer) walletModalState.lastFocusAnchor = null;
            return;
        }

        requestAnimationFrame(() => {
            ensureWalletModalInputVisible(activeInput);
        });
        walletModalState.lastFocusAnchor = getWalletModalFocusAnchor(activeInput) || null;
        requestWalletRechargeScrollCueUpdate();
    }

    function scheduleWalletModalLayout({ settled = false, deferOnly = false } = {}) {
        if (walletModalState.layoutRafId) {
            cancelAnimationFrame(walletModalState.layoutRafId);
        }

        if (!settled && walletModalState.settleTimer) {
            clearTimeout(walletModalState.settleTimer);
            walletModalState.settleTimer = null;
        }

        const runLayout = () => {
            walletModalState.layoutRafId = requestAnimationFrame(() => {
                walletModalState.layoutRafId = 0;
                applyWalletModalLayout();
            });
        };

        if (!deferOnly) {
            runLayout();
        }

        if (settled) {
            if (walletModalState.settleTimer) {
                clearTimeout(walletModalState.settleTimer);
            }
            walletModalState.settleTimer = setTimeout(() => {
                walletModalState.settleTimer = null;
                runLayout();
            }, WALLET_MODAL_KEYBOARD_SETTLE_MS);
        }
    }

    function requestWalletModalViewportSync() {
        if (walletModalState.viewportRafId) return;
        walletModalState.viewportRafId = requestAnimationFrame(() => {
            walletModalState.viewportRafId = 0;
            stabilizeWalletModalViewport();
            if (!getActiveWalletModalInput()) {
                captureWalletModalOverlayBaseHeight();
            }
            applyWalletModalLayout();
            requestWalletRechargeScrollCueUpdate();
        });
    }

    function activateWalletModalOverlay() {
        const { overlay } = getWalletModalElements();
        if (!overlay) return;

        overlay.classList.remove('active', 'wallet-opening');
        overlay.style.display = 'block';
        void overlay.offsetWidth;

        requestAnimationFrame(() => {
            if (!overlay.isConnected) return;
            overlay.classList.add('active', 'wallet-opening');
            prepareWalletModalOpenState();

            if (walletModalState.openingTimer) {
                clearTimeout(walletModalState.openingTimer);
            }
            walletModalState.openingTimer = setTimeout(() => {
                walletModalState.openingTimer = null;
                overlay.classList.remove('wallet-opening');
            }, 420);
        });
    }

    function bindWalletModalInputBehavior(input) {
        if (!input || input.dataset.walletInputManaged === '1') return;

        input.addEventListener('focus', () => {
            markWalletModalFocusTransfer(input);
            if (walletModalState.blurTimer) {
                clearTimeout(walletModalState.blurTimer);
                walletModalState.blurTimer = null;
            }
            scheduleWalletModalLayout();
        });

        input.addEventListener('blur', () => {
            if (walletModalState.blurTimer) {
                clearTimeout(walletModalState.blurTimer);
            }
            walletModalState.blurTimer = setTimeout(() => {
                walletModalState.blurTimer = null;
                if (!getActiveWalletModalInput()) {
                    walletModalState.focusTransferUntil = 0;
                    walletModalState.lastFocusAnchor = null;
                    scheduleWalletModalLayout();
                }
            }, 0);
        });

        input.addEventListener('click', () => {
            markWalletModalFocusTransfer(input);
            scheduleWalletModalLayout();
        });

        input.addEventListener('touchend', (event) => {
            if (!isWalletModalIOSMode() || document.activeElement === input) return;
            if (event.cancelable) event.preventDefault();
            markWalletModalFocusTransfer(input);
            try {
                input.focus({ preventScroll: true });
            } catch (_) {
                input.focus();
            }
            scheduleWalletModalLayout();
        }, { passive: false });

        input.dataset.walletInputManaged = '1';
    }

    function bindWalletModalInputs() {
        const { inputs } = getWalletModalElements();
        inputs.forEach((input) => bindWalletModalInputBehavior(input));
    }

    function attachWalletModalViewportHandlers() {
        detachWalletModalViewportHandlers();
        bindWalletModalInputs();
        captureWalletModalOverlayBaseHeight(true);
        requestWalletRechargeScrollCueUpdate();

        if (!isWalletModalIOSMode()) {
            scheduleWalletModalLayout();
            return;
        }

        freezeWalletModalPage();
        const vv = window.visualViewport;
        const { scroller } = getWalletModalElements();
        const handleViewportChange = () => {
            requestWalletModalViewportSync();
        };

        const handleRootScroll = () => {
            stabilizeWalletModalViewport();
        };

        const handleContentScroll = () => {
            requestWalletRechargeScrollCueUpdate();
        };

        vv?.addEventListener('resize', handleViewportChange, { passive: true });
        vv?.addEventListener('scroll', handleViewportChange, { passive: true });
        window.addEventListener('scroll', handleRootScroll, { passive: true });
        window.addEventListener('resize', handleViewportChange, { passive: true });
        scroller?.addEventListener('scroll', handleContentScroll, { passive: true });

        walletModalState.viewportCleanup = () => {
            vv?.removeEventListener('resize', handleViewportChange);
            vv?.removeEventListener('scroll', handleViewportChange);
            window.removeEventListener('scroll', handleRootScroll);
            window.removeEventListener('resize', handleViewportChange);
            scroller?.removeEventListener('scroll', handleContentScroll);
            walletModalState.viewportCleanup = null;
        };

        requestWalletModalViewportSync();
    }

    function detachWalletModalViewportHandlers() {
        if (typeof walletModalState.viewportCleanup === 'function') {
            walletModalState.viewportCleanup();
        }
        clearWalletModalTimers();
    }

    function prepareWalletModalOpenState() {
        const { overlay } = getWalletModalElements();
        if (!overlay) return;

        resetWalletModalVisualState();
        attachWalletModalViewportHandlers();
        scheduleWalletModalLayout();
        requestWalletRechargeScrollCueUpdate();
    }

    const WalletModal = {
        isOpen: false,
        modalEl: null,
        promptCache: {}, // Local simple cache for titles
        verifyLogCache: {},

        isVerifyServiceReason(reason = '') {
            const normalized = String(reason || '').trim().toLowerCase();
            return normalized.includes('google one') && (
                normalized.includes('链接获取服务') ||
                normalized.includes('trial link') ||
                normalized.includes('link service') ||
                normalized.includes('verify service')
            );
        },

        getVerifyDisplayName() {
            return window.i18n?.t('wallet.verifyOrderName') || 'Google One Pro 试用链接';
        },

        isShopLedgerReason(reason = '', referenceId = '') {
            const normalizedReason = String(reason || '').trim().toLowerCase();
            const normalizedRef = String(referenceId || '').trim().toUpperCase();
            return normalizedReason.startsWith('商城购买:') ||
                normalizedReason.startsWith('shop purchase:') ||
                normalizedRef.startsWith('SHOP_ORDER_');
        },

        getShopOrderIdFromReference(referenceId = '') {
            const normalizedRef = String(referenceId || '').trim();
            if (!normalizedRef) return '';
            if (normalizedRef.startsWith('SHOP_ORDER_')) {
                return normalizedRef.slice('SHOP_ORDER_'.length);
            }
            return normalizedRef;
        },

        getRechargeDisplayName(reason = '') {
            const rawReason = String(reason || '').trim();
            if (!rawReason) {
                return window.i18n?.t('wallet.rechargeType') || '充值';
            }

            if (rawReason.startsWith('模拟充值:')) {
                return rawReason.replace('模拟充值:', '').trim() || (window.i18n?.t('wallet.rechargeType') || '充值');
            }

            if (rawReason.startsWith('模拟充值：')) {
                return rawReason.replace('模拟充值：', '').trim() || (window.i18n?.t('wallet.rechargeType') || '充值');
            }

            if (rawReason === 'package_purchase') {
                return window.i18n?.t('wallet.rechargeType') || '充值';
            }

            if (rawReason === 'afdian_recharge') {
                return 'Afdian';
            }

            return rawReason;
        },

        looksLikeEmail(value = '') {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(value || '').trim());
        },

        extractEmailCandidates(...values) {
            const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
            const emails = new Set();

            values.flat().forEach((value) => {
                const text = String(value || '').trim();
                if (!text) return;

                const matches = text.match(emailRegex) || [];
                matches.forEach((email) => emails.add(String(email || '').trim().toLowerCase()));
            });

            return Array.from(emails);
        },

        extractFirstUrl(text = '') {
            const match = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
            return match ? match[0] : '';
        },

        parseVerifyLogMessage(message) {
            if (typeof message !== 'string' || !message.trim().startsWith('{')) {
                return null;
            }

            try {
                const parsed = JSON.parse(message);
                if (parsed?.kind === 'google_one_job') {
                    return parsed;
                }
            } catch (_) {
                return null;
            }

            return null;
        },

        formatOrderDateTime(value) {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return '--';
            }
            return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        },

        getVerifyStatusMeta(status = '') {
            const normalized = String(status || '').trim().toLowerCase();

            if (normalized.includes('success') || normalized.includes('completed')) {
                return {
                    text: window.i18n?.t('wallet.completed') || '已完成',
                    color: '#10b981',
                    prefix: '✓'
                };
            }

            if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('timeout')) {
                return {
                    text: window.i18n?.t('wallet.failed') || '失败',
                    color: '#ef4444',
                    prefix: '✕'
                };
            }

            if (normalized.includes('queue') || normalized.includes('running') || normalized.includes('process') || normalized.includes('pending')) {
                return {
                    text: window.i18n?.t('wallet.processing') || window.i18n?.t('common.processing') || '处理中...',
                    color: '#6b9ece',
                    prefix: '•'
                };
            }

            return {
                text: normalized || '--',
                color: '#e5e7eb',
                prefix: ''
            };
        },

        async fetchVerifyOrderLog(options = {}) {
            const {
                orderId = '',
                referenceId = '',
                userId = '',
                site = 'cn',
                createdAt = '',
                pointsPaid = 0,
                reason = ''
            } = options;

            if (!userId) return null;

            const emailCandidates = this.extractEmailCandidates(referenceId, reason);
            const cacheKey = `${site}:${userId}:${referenceId || orderId || createdAt || 'verify'}:${emailCandidates.join('|')}`;
            if (this.verifyLogCache[cacheKey]) {
                return this.verifyLogCache[cacheKey];
            }

            let matchedRecord = null;

            try {
                if (referenceId) {
                    const exactResult = await supabase
                        .from('verification_logs')
                        .select('verification_id, status, message, points_deducted, created_at')
                        .eq('user_id', userId)
                        .eq('site', site)
                        .eq('verification_id', referenceId)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (exactResult.error) {
                        console.warn('[WalletModal] Verify log exact lookup failed:', exactResult.error);
                    } else if (exactResult.data?.length) {
                        matchedRecord = exactResult.data[0];
                    }
                }

                if (!matchedRecord) {
                    let exactEmailRows = [];

                    if (emailCandidates.length) {
                        const emailResult = await supabase
                            .from('verification_logs')
                            .select('verification_id, status, message, points_deducted, created_at')
                            .eq('user_id', userId)
                            .eq('site', site)
                            .in('verification_id', emailCandidates)
                            .order('created_at', { ascending: false })
                            .limit(20);

                        if (emailResult.error) {
                            console.warn('[WalletModal] Verify log email lookup failed:', emailResult.error);
                        } else {
                            exactEmailRows = emailResult.data || [];
                        }
                    }

                    let fallbackResult = null;
                    const ledgerTime = createdAt ? new Date(createdAt).getTime() : 0;

                    if (ledgerTime) {
                        const from = new Date(ledgerTime - (24 * 60 * 60 * 1000)).toISOString();
                        const to = new Date(ledgerTime + (24 * 60 * 60 * 1000)).toISOString();
                        fallbackResult = await supabase
                            .from('verification_logs')
                            .select('verification_id, status, message, points_deducted, created_at')
                            .eq('user_id', userId)
                            .eq('site', site)
                            .gte('created_at', from)
                            .lte('created_at', to)
                            .order('created_at', { ascending: false })
                            .limit(120);
                    }

                    if (!fallbackResult || fallbackResult.error || !(fallbackResult.data || []).length) {
                        fallbackResult = await supabase
                            .from('verification_logs')
                            .select('verification_id, status, message, points_deducted, created_at')
                            .eq('user_id', userId)
                            .eq('site', site)
                            .order('created_at', { ascending: false })
                            .limit(120);
                    }

                    if (fallbackResult.error) {
                        console.warn('[WalletModal] Verify log fallback lookup failed:', fallbackResult.error);
                    } else {
                        const targetAmount = Math.abs(Number(pointsPaid) || 0);
                        const candidateRows = [...exactEmailRows, ...(fallbackResult.data || [])]
                            .filter((row, index, rows) => rows.findIndex((item) => (
                                item.verification_id === row.verification_id &&
                                item.created_at === row.created_at &&
                                item.status === row.status
                            )) === index);

                        const scoredMatches = candidateRows.map((row) => {
                            const payload = this.parseVerifyLogMessage(row.message);
                            const fallbackEmail = this.looksLikeEmail(row.verification_id) ? String(row.verification_id || '').trim().toLowerCase() : '';
                            const fallbackJobId = !fallbackEmail ? String(row.verification_id || '').trim() : '';
                            const rowEmail = String(payload?.email || fallbackEmail || '').trim().toLowerCase();
                            const rowJobId = String(payload?.job_id || fallbackJobId || '').trim();
                            const rowUrl = String(payload?.url || this.extractFirstUrl(row.message) || '').trim();

                            if (referenceId && rowJobId && rowJobId === referenceId) {
                                return { row, score: 1_000_000 };
                            }

                            const rowAmount = Math.abs(Number(row.points_deducted) || 0);
                            const rowTime = row.created_at ? new Date(row.created_at).getTime() : 0;
                            const diffMs = ledgerTime && rowTime ? Math.abs(rowTime - ledgerTime) : Number.MAX_SAFE_INTEGER;
                            const diffMinutes = Number.isFinite(diffMs) ? diffMs / 60000 : Number.MAX_SAFE_INTEGER;

                            let score = 0;

                            if (emailCandidates.length && rowEmail && emailCandidates.includes(rowEmail)) score += 340;
                            if (rowUrl) score += 120;
                            if (String(row.status || '').toLowerCase() === 'success') score += 80;
                            if (targetAmount > 0 && rowAmount === targetAmount) score += 220;
                            if (targetAmount > 0 && rowAmount > 0 && Math.abs(rowAmount - targetAmount) <= 1) score += 40;

                            if (Number.isFinite(diffMinutes)) {
                                if (diffMinutes <= 1) score += 320;
                                else if (diffMinutes <= 3) score += 240;
                                else if (diffMinutes <= 10) score += 180;
                                else if (diffMinutes <= 30) score += 120;
                                else if (diffMinutes <= 120) score += 60;
                                else if (diffMinutes <= 1440) score += 20;
                            }

                            if (score <= 0) return null;

                            return {
                                row,
                                payload,
                                score,
                                diffMs
                            };
                        }).filter(Boolean);

                        scoredMatches.sort((a, b) => {
                            if (b.score !== a.score) return b.score - a.score;
                            return a.diffMs - b.diffMs;
                        });

                        matchedRecord = scoredMatches[0]?.row || null;
                    }
                }
            } catch (err) {
                console.warn('[WalletModal] Verify log query exception:', err);
            }

            if (!matchedRecord) return null;

            const parsedPayload = this.parseVerifyLogMessage(matchedRecord.message) || {};
            const fallbackEmail = this.looksLikeEmail(matchedRecord.verification_id) ? String(matchedRecord.verification_id || '').trim().toLowerCase() : '';
            const fallbackJobId = !fallbackEmail ? String(matchedRecord.verification_id || '').trim() : '';
            const normalized = {
                ...matchedRecord,
                payload: {
                    ...parsedPayload,
                    email: parsedPayload.email || fallbackEmail || '',
                    job_id: parsedPayload.job_id || fallbackJobId || '',
                    url: parsedPayload.url || this.extractFirstUrl(matchedRecord.message) || ''
                }
            };
            this.verifyLogCache[cacheKey] = normalized;
            return normalized;
        },

        /**
         * Pre-fetch wallet data in background (called when avatar dropdown opens)
         * So data is instantly available when user clicks 'My Orders'
         */
        prefetchData() {
            if (this._prefetched || this.ordersLoaded) return;
            this._prefetched = true;

            // Fire and forget - load orders data silently
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (!session?.user) return;
                const user = session.user;
                const site = window.SiteConfig?.site || 'cn';

                // Pre-fetch orders + ledger in parallel
                Promise.all([
                    supabase.from('shop_orders')
                        .select('id, total_price, item_count, status, created_at, snapshot_product_name, shop_order_items (id, snapshot_product_name)')
                        .eq('user_id', user.id)
                        .eq('site', site)
                        .order('created_at', { ascending: false })
                        .limit(100),
                    supabase.from('points_ledger')
                        .select('id, amount, reason, reference_id, created_at')
                        .eq('user_id', user.id)
                        .eq('site', site)
                        .order('created_at', { ascending: false })
                        .limit(100)
                ]).then(([shopResult, ledgerResult]) => {
                    this._prefetchedShopOrders = shopResult.data || [];
                    this._prefetchedLedger = ledgerResult.data || [];
                    console.log('[WalletModal] ✅ Data prefetched in background');
                }).catch(err => {
                    console.warn('[WalletModal] Prefetch failed (non-critical):', err);
                });
            });
        },

        /**
         * Open the wallet modal
         */
        async open(initialView) {
            if (this.isOpen) return;

            console.log('[WalletModal] Opening...', initialView ? `view: ${initialView}` : '');

            // Close user dropdown menu first (prevent double overlay)
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.remove('active');
            const dropdownOverlay = document.getElementById('dropdownOverlay');
            if (dropdownOverlay) dropdownOverlay.classList.remove('active');

            this.isOpen = true;
            this.ordersLoaded = false; // Reset loaded flag for new session

            if (isWalletModalIOSMode()) {
                freezeWalletModalPage();
            }

            // Render UI immediately so there's zero delay for the user
            this.render();
            activateWalletModalOverlay();

            const { card, overlay } = getWalletModalElements();
            if (window.iOSScrollLock) {
                if (!isWalletModalIOSMode()) {
                    window.iOSScrollLock.lockLight(card || overlay);
                    walletModalState.usingLegacyScrollLock = true;
                } else {
                    walletModalState.usingLegacyScrollLock = false;
                }
            }

            // Reset check-in button state (DOM is cached, needs refresh)
            const checkinBtn = document.getElementById('wallet-checkin-btn');
            if (checkinBtn) {
                checkinBtn.disabled = false;
                checkinBtn.classList.remove('checked', 'just-checked');
                const checkinText = document.getElementById('checkin-btn-text');
                if (checkinText) checkinText.textContent = window.i18n?.t('wallet.dailyCheckin') || '每日签到';
            }

            // Handle session asynchronously to not block initial render on hard refresh
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (!session) {
                    this.close();
                    alert(window.i18n?.t('security.loginRequired') || '请先登录');
                    return;
                }

                // Load data after session is confirmed
                this.loadData().catch(e => console.error('[WalletModal] Initial load failed:', e));
            });


            // Initialize indicator position and switch to requested view immediately
            setTimeout(() => {
                this.updateIndicatorPosition();
                if (initialView) this.switchView(initialView);
            }, 50);
        },

        /**
         * Close the modal
         */
        close() {
            const { overlay, scroller } = getWalletModalElements();
            getActiveWalletModalInput()?.blur();
            detachWalletModalViewportHandlers();
            resetWalletModalVisualState();

            if (this.modalEl) {
                this.modalEl.style.display = 'none';
                this.modalEl.classList.remove('active', 'keyboard-active', 'keyboard-docked', 'ios-focus-lock');
            }
            getWalletModalElements().viewport?.style.setProperty('--wallet-modal-translate-y', '0px');
            if (scroller) {
                scroller.scrollTop = 0;
            }
            if (walletModalState.usingLegacyScrollLock && window.iOSScrollLock) {
                window.iOSScrollLock.unlock();
            }
            walletModalState.usingLegacyScrollLock = false;
            unfreezeWalletModalPage();
            this.isOpen = false;
            this.ordersLoaded = false;
            this._prefetched = false; // Allow prefetch on next dropdown open
            console.log('[WalletModal] Closed');
        },

        /**
         * Render the modal HTML - Split Panel Layout
         */
        render() {
            let overlay = document.getElementById('wallet-modal-overlay');
            if (overlay) {
                if (!overlay.querySelector('.wallet-backdrop') || !overlay.querySelector('.wallet-viewport')) {
                    overlay.remove();
                    overlay = null;
                }
            }

            if (overlay) {
                overlay.style.display = 'block';
                this.modalEl = overlay;
                return;
            }

            overlay = document.createElement('div');
            overlay.id = 'wallet-modal-overlay';
            overlay.className = 'wallet-overlay';
            overlay.style.display = 'block';
            overlay.innerHTML = `
                <div class="wallet-backdrop" aria-hidden="true"></div>
                <div class="wallet-viewport">
                    <div class="wallet-modal">
                        <button class="wallet-close-btn" onclick="WalletModal.close()">✕</button>
                        
                        <div class="wallet-header">
                            <h2>💰 ${window.i18n?.t('wallet.title') || '我的钱包'}</h2>
                        </div>
                        
                        <div class="wallet-layout">
                            <!-- Left Sidebar Menu -->
                            <div class="wallet-sidebar">
                                <div class="sidebar-indicator"></div>
                                <div class="wallet-menu-item active" data-view="balance" onclick="WalletModal.switchView('balance')">
                                    <span class="menu-icon">💳</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.balance') || '余额'}</span>
                                </div>
                                <div class="wallet-menu-item" data-view="recharge" onclick="WalletModal.switchView('recharge')">
                                    <span class="menu-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="boltGradientSidebar" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#fbbf24"/><stop offset="100%" style="stop-color:#f97316"/></linearGradient></defs><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="url(#boltGradientSidebar)"/></svg></span>
                                    <span class="menu-text">${window.i18n?.t('wallet.recharge') || '充值'}</span>
                                </div>

                                <div class="wallet-menu-item" data-view="orders" onclick="WalletModal.switchView('orders')">
                                    <span class="menu-icon">📋</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.records') || '记录'}</span>
                                </div>

                                <div class="wallet-menu-item" data-view="affiliate" onclick="WalletModal.switchView('affiliate')">
                                    <span class="menu-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #10b981;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></span>
                                    <span class="menu-text">${window.i18n?.t('wallet.affiliate') || '推广'}</span>
                                </div>

                                <div class="wallet-menu-item" data-view="checkin" onclick="WalletModal.switchView('checkin')">
                                    <span class="menu-icon">🔖</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.checkin') || '签到'}</span>
                                </div>
                            </div>
                            
                            <!-- Right Content Area -->
                            <div class="wallet-content">
                            <!-- Balance View (Default) -->
                            <div class="wallet-view active" id="view-balance">
                                <div class="balance-card compact-premium-card">
                                    <div class="card-left">
                                        <label>${window.i18n?.t('wallet.currentPoints') || '当前可用积分'}</label>
                                        <div class="balance-amount" id="wallet-total">--</div>
                                    </div>
                                    <div class="card-right">
                                        <div class="balance-detail-row">
                                            <span class="detail-label">${window.i18n?.t('wallet.paid') || '付费'}</span>
                                            <strong id="wallet-paid" class="detail-val">--</strong>
                                        </div>
                                        <div class="balance-detail-row">
                                            <span class="detail-label">${window.i18n?.t('wallet.bonus') || '赠送'}</span>
                                            <strong id="wallet-bonus" class="detail-val">--</strong>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- No more standalone checkin button here -->
                                
                                <!-- Consolidated Redeem Section -->
                                <div class="redeem-section">
                                    <div class="redeem-input-row">
                                        <input type="text" 
                                               id="redeem-code-input" 
                                               placeholder="${window.i18n?.t('wallet.enterCode') || '输入兑换码'}"
                                               maxlength="19"
                                               autocomplete="off"
                                               onkeyup="if(event.key==='Enter') WalletModal.redeemCode()" />
                                        <button class="redeem-btn" onclick="WalletModal.redeemCode()">${window.i18n?.t('wallet.redeem') || '兑换'}</button>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Recharge View -->
                            <div class="wallet-view" id="view-recharge">
                                <h3 class="view-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: -3px; margin-right: 4px;"><defs><linearGradient id="boltGradientTitle" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#fbbf24"/><stop offset="100%" style="stop-color:#f97316"/></linearGradient></defs><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="url(#boltGradientTitle)"/></svg>${window.i18n?.t('wallet.rechargePackages') || '充值套餐'}</h3>
                                <div class="packages-container" id="wallet-packages">
                                    <div class="loading-text">${window.i18n?.t('common.loading') || '加载中...'}</div>
                                </div>
                                
                                <!-- Afdian Code Query Section -->
                                <div class="afdian-section">
                                    <div class="afdian-header">
                                        <span class="afdian-icon" aria-hidden="true">
                                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <defs>
                                                    <linearGradient id="walletAfdianHeartGradient" x1="5" y1="4" x2="19" y2="20" gradientUnits="userSpaceOnUse">
                                                        <stop offset="0%" stop-color="#ff9ab2" />
                                                        <stop offset="100%" stop-color="#ff537f" />
                                                    </linearGradient>
                                                </defs>
                                                <path d="M12 20.4c-.24 0-.48-.08-.67-.23C6.9 16.88 4 14.1 4 9.98 4 7.42 5.96 5.5 8.4 5.5c1.46 0 2.83.67 3.6 1.81.77-1.14 2.14-1.81 3.6-1.81C18.04 5.5 20 7.42 20 9.98c0 4.12-2.9 6.9-7.33 10.19-.19.15-.43.23-.67.23Z" fill="url(#walletAfdianHeartGradient)"/>
                                                <path d="M9.08 7.34c-.86 0-1.62.4-2.13 1.03-.18.23-.52.27-.75.08-.23-.19-.27-.53-.08-.76.72-.9 1.81-1.43 2.96-1.43.3 0 .54.24.54.54s-.24.54-.54.54Z" fill="rgba(255,255,255,0.72)"/>
                                            </svg>
                                        </span>
                                        <span>${window.i18n?.t('wallet.afdianQuery') || '爱发电订单查询'}</span>
                                    </div>
                                    <p class="afdian-hint">${window.i18n?.t('wallet.afdianHint') || '在爱发电支付后，输入订单号获取兑换码'}</p>
                                    <div class="afdian-input-row">
                                        <input type="text" 
                                               id="afdian-order-input" 
                                               placeholder="${window.i18n?.t('wallet.afdianOrderNo') || '爱发电订单号'}"
                                               autocomplete="off"
                                               onkeyup="if(event.key==='Enter') WalletModal.queryAfdianCode()" />
                                        <button class="afdian-query-btn" onclick="WalletModal.queryAfdianCode()">${window.i18n?.t('wallet.query') || '查询'}</button>
                                    </div>
                                    <div id="afdian-result" class="afdian-result"></div>
                                </div>
                            </div>


                            <!-- Calendar Check-in View -->
                            <div class="wallet-view" id="view-checkin">
                                <div class="checkin-dashboard">
                                    <div class="checkin-header">
                                        <div class="checkin-month-title" id="checkin-month-title">--月打卡</div>
                                        <div class="checkin-streak">已连续 <strong id="checkin-streak-count">0</strong> 天</div>
                                    </div>
                                    
                                    <!-- Mystery Rewards Progress -->
                                    <div class="mystery-progress-wrapper" style="display: none;" id="mystery-progress-box">
                                        <div class="mystery-progress-label">本周神秘盲盒进度</div>
                                        <div class="mystery-progress-bar">
                                            <div class="mystery-progress-fill" id="mystery-progress-fill" style="width: 0%;"></div>
                                        </div>
                                    </div>
                                    
                                    <!-- Calendar Grid -->
                                    <div class="calendar-wrapper">
                                        <div class="calendar-weekdays">
                                            <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
                                        </div>
                                        <div class="calendar-grid" id="calendar-grid">
                                            <!-- Dynamically generated days go here -->
                                            <div class="loading-calendar">加载中...</div>
                                        </div>
                                    </div>
                                    
                                </div>
                            </div>
                            
                            <!-- Orders View (Shop Purchase History) -->
                            <div class="wallet-view" id="view-orders">
                                <div class="history-header">
                                    <h3 class="view-title">📋 ${window.i18n?.t('wallet.transactionRecords') || '交易记录'}</h3>
                                    <div class="history-actions">
                                        <div class="filter-wrapper">
                                            <div class="filter-chip" onclick="WalletModal.toggleOrderTimeFilterMenu(event)">
                                                <span id="order-time-filter-label">${window.i18n?.t('wallet.all') || '全部'}</span>
                                                <span class="filter-arrow">▼</span>
                                            </div>
                                            <div class="filter-popup" id="order-time-filter-popup">
                                                <div class="filter-option active" data-value="all" onclick="WalletModal.selectOrderTimeFilter('all', window.i18n?.t('wallet.all') || '全部')">${window.i18n?.t('wallet.all') || '全部'}</div>
                                                <div class="filter-option" data-value="today" onclick="WalletModal.selectOrderTimeFilter('today', window.i18n?.t('wallet.today') || '今天')">${window.i18n?.t('wallet.today') || '今天'}</div>
                                                <div class="filter-option" data-value="week" onclick="WalletModal.selectOrderTimeFilter('week', window.i18n?.t('wallet.thisWeek') || '本周')">${window.i18n?.t('wallet.thisWeek') || '本周'}</div>
                                                <div class="filter-option" data-value="month" onclick="WalletModal.selectOrderTimeFilter('month', window.i18n?.t('wallet.thisMonth') || '本月')">${window.i18n?.t('wallet.thisMonth') || '本月'}</div>
                                                <div class="filter-divider"></div>
                                                <div class="filter-option" data-value="custom" onclick="WalletModal.showOrderCustomDate()">📅 ${window.i18n?.t('wallet.custom') || '自定义...'}</div>
                                            </div>
                                        </div>
                                        <div class="filter-wrapper">
                                            <div class="filter-chip" onclick="WalletModal.toggleOrderFilterMenu(event)">
                                                <span id="order-filter-label">${window.i18n?.t('wallet.all') || '全部'}</span>
                                                <span class="filter-arrow">▼</span>
                                            </div>
                                            <div class="filter-popup" id="order-filter-popup">
                                                <div class="filter-option active" data-value="all" onclick="WalletModal.selectOrderFilter('all', window.i18n?.t('wallet.all') || '全部')">${window.i18n?.t('wallet.all') || '全部'}</div>
                                                <div class="filter-option" data-value="recharge" onclick="WalletModal.selectOrderFilter('recharge', window.i18n?.t('wallet.rechargeType') || '充值')"><i class="fas fa-bolt" style="color: #fbbf24;"></i> ${window.i18n?.t('wallet.rechargeType') || '充值'}</div>
                                                <div class="filter-option" data-value="redeem" onclick="WalletModal.selectOrderFilter('redeem', window.i18n?.t('wallet.redeemCode') || '兑换码')"><i class="fas fa-ticket-alt" style="color: #f472b6;"></i> ${window.i18n?.t('wallet.redeemCode') || '兑换码'}</div>
                                                <div class="filter-option" data-value="shop" onclick="WalletModal.selectOrderFilter('shop', window.i18n?.t('wallet.shopPurchase') || '商品')"><i class="fas fa-shopping-bag" style="color: #22c55e;"></i> ${window.i18n?.t('wallet.shopPurchase') || '商品'}</div>
                                                <div class="filter-option" data-value="verify" onclick="WalletModal.selectOrderFilter('verify', window.i18n?.t('wallet.verifyPurchase') || '认证')"><i class="fas fa-shield-alt" style="color: #60a5fa;"></i> ${window.i18n?.t('wallet.verifyPurchase') || '认证'}</div>
                                                <div class="filter-option" data-value="prompt" onclick="WalletModal.selectOrderFilter('prompt', window.i18n?.t('wallet.promptPurchase') || '提示词')"><i class="fas fa-lightbulb" style="color: #fde68a;"></i> ${window.i18n?.t('wallet.promptPurchase') || '提示词'}</div>
                                            </div>
                                        </div>
                                        <div class="clear-chip" onclick="WalletModal.clearOrders()">🗑</div>
                                    </div>
                                </div>
                                <div class="orders-container" id="wallet-orders">
                                    <div class="loading-text">${window.i18n?.t('common.loading') || '加载中...'}</div>
                                </div>
                            </div>

                            <div class="wallet-view wallet-view-flex" id="view-affiliate" style="flex-direction:column; gap:20px;">
                                <!-- Top Stats Cards -->
                                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
                                    <div class="stat-box" style="background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(217,119,6,0.15)); border:1px solid rgba(245,158,11,0.25); padding:20px; border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; transition:transform 0.2s; cursor:default;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                                        <div style="font-size:13px; color:#fcd34d; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><i class="fas fa-coins"></i> ${window.i18n?.t('wallet.totalCommission') || '累计获得佣金'}</div>
                                        <div id="affiliate-commission" style="font-size:36px; font-weight:700; color:#fff; font-family:monospace; line-height:1;">0</div>
                                    </div>
                                    
                                    <div class="stat-box" style="background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(37,99,235,0.15)); border:1px solid rgba(59,130,246,0.25); padding:20px; border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; transition:transform 0.2s; cursor:default;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                                        <div style="font-size:13px; color:#93c5fd; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><i class="fas fa-users"></i> ${window.i18n?.t('wallet.invitedCount') || '成功邀请人数'}</div>
                                        <div id="affiliate-count" style="font-size:36px; font-weight:700; color:#fff; font-family:monospace; line-height:1; display:flex; align-items:baseline; gap:4px;">0 <span style="font-size:14px; color:rgba(255,255,255,0.5); font-weight:normal; font-family:sans-serif;">人</span></div>
                                    </div>
                                </div>

                                <!-- Link Section -->
                                <div class="premium-panel" style="padding:24px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:16px; display:flex; flex-direction:column; gap:16px; box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                                    <div>
                                        <h3 style="margin:0 0 8px 0; color:#fff; font-size:16px; display:flex; align-items:center; gap:8px;">
                                            <i class="fas fa-link" style="color:#10b981;"></i> ${window.i18n?.t('wallet.getInviteLink') || '获取专属推广链接'}
                                        </h3>
                                        <p id="affiliate-desc-text" style="margin:0; color:rgba(255,255,255,0.5); font-size:13px; line-height:1.6;">
                                            加载中...
                                        </p>
                                    </div>
                                    
                                    <div style="display:flex; gap:12px; align-items:center; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:6px; padding-left:16px;">
                                        <input type="text" id="affiliate-link" readonly style="flex:1; background:transparent; border:none; color:#10b981; font-family:monospace; font-size:14px; outline:none; white-space:nowrap; text-overflow:ellipsis; cursor:pointer;" onclick="this.select()" />
                                        <button onclick="WalletModal.copyAffiliateLink()" style="background:#fff; color:#000; border:none; padding:10px 20px; border-radius:8px; font-weight:600; cursor:pointer; font-size:13px; transition:all 0.2s; white-space:nowrap;" onmouseover="this.style.background='#f0f0f0';this.style.transform='scale(1.05)'" onmouseout="this.style.background='#fff';this.style.transform='scale(1)'">
                                            ${window.i18n?.t('wallet.copyLink') || '复制链接'}
                                        </button>
                                    </div>

                                    <button onclick="WalletModal.generateAffiliatePoster()" style="margin-top:8px; width:100%; border:none; padding:14px; border-radius:12px; background:linear-gradient(135deg, #10b981, #059669); color:#fff; font-weight:600; font-size:14px; cursor:pointer; box-shadow:0 10px 20px rgba(16,185,129,0.2); transition:all 0.25s; display:flex; align-items:center; justify-content:center; gap:8px;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 15px 25px rgba(16,185,129,0.3)';" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='0 10px 20px rgba(16,185,129,0.2)';">
                                        <i class="fas fa-image"></i> ${window.i18n?.t('wallet.generatePoster') || '生成精美推广海报'}
                                    </button>
                                </div>
                            </div>
                            </div>
                        </div>
                        <div class="wallet-recharge-scroll-cue" aria-hidden="true">
                            <span class="wallet-recharge-scroll-cue-icon">
                                <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <defs>
                                        <linearGradient id="walletScrollCueGradient" x1="14" y1="5" x2="14" y2="23" gradientUnits="userSpaceOnUse">
                                            <stop offset="0%" stop-color="#d8ecff" />
                                            <stop offset="100%" stop-color="#6b9ece" />
                                        </linearGradient>
                                    </defs>
                                    <path d="M8 10.5L14 16.5L20 10.5" stroke="url(#walletScrollCueGradient)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M8 16.5L14 22.5L20 16.5" stroke="url(#walletScrollCueGradient)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.78"/>
                                </svg>
                            </span>
                        </div>
                    </div>
                </div>
            `;

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (
                    e.target === overlay ||
                    e.target.classList?.contains('wallet-backdrop') ||
                    e.target.classList?.contains('wallet-viewport')
                ) {
                    this.close();
                }
            });

            document.body.appendChild(overlay);
            this.modalEl = overlay;
        },

        /**
         * Switch between views
         */
        /**
         * Switch between views
         */
        switchView(viewId) {
            // Update menu items
            document.querySelectorAll('.wallet-menu-item').forEach(item => {
                item.classList.toggle('active', item.dataset.view === viewId);
            });

            // Update Sidebar Indicator
            this.updateIndicatorPosition();

            // Update views
            document.querySelectorAll('.wallet-view').forEach(view => {
                view.classList.toggle('active', view.id === `view-${viewId}`);
            });

            // Load orders when switching to orders view
            if (viewId === 'orders' && !this.ordersLoaded) {
                this.loadOrders();
            }

            // Load affiliate when switching to affiliate view
            if (viewId === 'affiliate' && !this.affiliateLoaded) {
                this.loadAffiliateData();
            }

            // Load check-in data when switching to checkin view
            if (viewId === 'checkin') {
                this.loadCheckinData();
            }

            if (this.isOpen) {
                scheduleWalletModalLayout({ settled: true });
                requestWalletRechargeScrollCueUpdate();
            }
        },

        /**
         * Update the position of the sliding sidebar indicator
         */
        updateIndicatorPosition() {
            const sidebar = document.querySelector('.wallet-sidebar');
            const activeItem = document.querySelector('.wallet-menu-item.active');
            const indicator = document.querySelector('.sidebar-indicator');

            if (sidebar && activeItem && indicator) {
                // Calculate relative position
                const sidebarRect = sidebar.getBoundingClientRect();
                const itemRect = activeItem.getBoundingClientRect();

                // 16 is container padding top
                const top = itemRect.top - sidebarRect.top;
                const height = itemRect.height;

                indicator.style.top = `${top}px`;
                indicator.style.height = `${height}px`;
                indicator.style.opacity = '1';
            }
        },

        /**
         * Affiliate Logic
         */
        async loadAffiliateData() {
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) return;

                const { data, error } = await window.supabaseClient.rpc('fn_get_affiliate_stats', {
                    p_user_id: user.id
                });

                if (error) throw error;

                if (data) {
                    const commissionEl = document.getElementById('affiliate-commission');
                    const countEl = document.getElementById('affiliate-count');
                    const linkEl = document.getElementById('affiliate-link');

                    if (commissionEl) commissionEl.textContent = data.total_commission;
                    if (countEl) countEl.textContent = data.invited_count + ' ' + (window.i18n?.t('wallet.people') || '人');

                    const descEl = document.getElementById('affiliate-desc-text');
                    if (descEl && data.commission_rate_shop !== undefined) {
                        const ratePercent = (data.commission_rate_shop * 100).toFixed(0) + '%';
                        const regPoints = data.registration_reward_points || 0;

                        if (regPoints > 0) {
                            descEl.innerHTML = `分享专属链接邀请新用户。当好友注册并在商城<strong>完成首笔充值或消费</strong>后，您将获得 <strong style="color:#10b981; font-weight:600;">${regPoints} 积分</strong> 专属拉新奖励！此外，还会自动无上限将好友所有订单金额的 <strong style="color:#f59e0b; font-weight:600;">${ratePercent}</strong> 作为持久佣金返还给您。`;
                        } else {
                            descEl.innerHTML = `分享下方链接给好友。当好友注册并在商城完成消费时，系统会自动将订单金额的 <strong style="color:#f59e0b; font-weight:600;">${ratePercent}</strong> 作为奖励发放至您的积分钱包。`;
                        }
                    }

                    if (linkEl && data.invite_code) {
                        const baseUrl = window.location.origin + window.location.pathname;
                        linkEl.value = `${baseUrl}?ref=${data.invite_code}`;
                    }

                    this.currentInviteCode = data.invite_code;
                }
                this.affiliateLoaded = true;
            } catch (err) {
                console.error('[WalletModal] Load Affiliate Error:', err);
            }
        },

        copyAffiliateLink() {
            const linkEl = document.getElementById('affiliate-link');
            if (!linkEl || !linkEl.value) return;

            navigator.clipboard.writeText(linkEl.value).then(() => {
                this.showToast(window.i18n?.t('wallet.copiedLink') || '链接已复制到剪贴板，快去分享吧！', 'success');
            }).catch(err => {
                console.error('Copy failed', err);
                linkEl.select();
                document.execCommand('copy');
                this.showToast(window.i18n?.t('wallet.copiedLinkShort') || '链接已复制！', 'success');
            });
        },

        async generateAffiliatePoster() {
            const linkEl = document.getElementById('affiliate-link');
            if (!linkEl || !linkEl.value) {
                this.showToast(window.i18n?.t('wallet.linkNotReady') || '系统未准备好推广链接。', 'error');
                return;
            }

            const btn = event?.currentTarget || document.querySelector('.redeem-btn');
            const origText = btn.innerHTML;
            if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${window.i18n?.t('wallet.generating') || '生成中...'}`;

            try {
                // 1. Create a canvas
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 800;
                canvas.height = 1200;

                // 2. Draw background (gradient)
                const gradient = ctx.createLinearGradient(0, 0, 0, 1200);
                gradient.addColorStop(0, '#111827'); // dark gray
                gradient.addColorStop(1, '#0f172a'); // slate
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, 800, 1200);

                // Draw some decorative accents
                ctx.fillStyle = 'rgba(107, 158, 206, 0.15)'; // #6b9ece with opacity
                ctx.beginPath();
                ctx.arc(400, -200, 600, 0, Math.PI * 2);
                ctx.fill();

                // 3. Draw Title & Text
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 64px "Helvetica Neue", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(window.i18n?.t('wallet.posterTitle') || '专属邀请函', 400, 200);

                ctx.font = '32px Arial';
                ctx.fillStyle = '#9ca3af';
                ctx.fillText(window.i18n?.t('wallet.posterSubtitle') || '扫码注册·即享特权', 400, 280);

                // 4. Fetch QR Code image
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(linkEl.value)}&margin=1`;
                const qrImg = new Image();
                qrImg.crossOrigin = 'Anonymous';

                await new Promise((resolve, reject) => {
                    qrImg.onload = resolve;
                    qrImg.onerror = reject;
                    qrImg.src = qrUrl;
                });

                // Draw white background for QR
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(230, 480, 340, 340);

                // Draw QR Code
                ctx.drawImage(qrImg, 250, 500, 300, 300);

                // Draw code text
                ctx.fillStyle = '#10b981';
                ctx.font = 'bold 42px monospace';
                ctx.fillText(`${window.i18n?.t('wallet.inviteCode') || '邀请码'}: ${this.currentInviteCode}`, 400, 920);

                // Add QR code text indicator
                ctx.fillStyle = '#0f172a';
                ctx.font = '24px Arial';
                ctx.fillText(window.i18n?.t('wallet.posterScan') || '在此扫码注册', 400, 750);

                ctx.fillStyle = '#ffffff';
                ctx.font = '28px Arial';
                ctx.fillText(window.i18n?.t('wallet.posterJoin') || '加入我们获取新人专属福利', 400, 1000);

                // 5. Download Image
                const dataUrl = canvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = `Affiliate_Poster_${this.currentInviteCode}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

            } catch (err) {
                console.error('[WalletModal] Generate Poster Error:', err);
                this.showToast(window.i18n?.t('wallet.posterFailed') || '海报生成失败，请重试', 'error');
            } finally {
                if (btn) btn.innerHTML = origText;
            }
        },

        /**
         * Load data into the modal - OPTIMIZED with parallel requests
         */
        async loadData() {
            try {
                console.log('[WalletModal] 🔄 Loading wallet data...');

                // Wait for PointsService
                if (!window.PointsService) {
                    throw new Error('PointsService not available');
                }

                // 🚀 Run ALL API calls in PARALLEL
                const [balance, packages, history] = await Promise.all([
                    PointsService.getBalance(),
                    PointsService.getPackages(),
                    PointsService.getHistory()
                ]);

                console.log('[WalletModal] ✅ Data loaded:', { balance, packagesLength: packages.length });

                // Update balance with animation
                const totalEl = document.getElementById('wallet-total');
                if (totalEl) {
                    const currentVal = parseInt(totalEl.dataset.value || 0);
                    const newVal = balance.total_balance;
                    this.animateValue(totalEl, currentVal, newVal, 800);
                    totalEl.dataset.value = newVal;
                }

                const paidEl = document.getElementById('wallet-paid');
                if (paidEl) paidEl.textContent = balance.paid_balance.toLocaleString();

                const bonusEl = document.getElementById('wallet-bonus');
                if (bonusEl) bonusEl.textContent = balance.bonus_balance.toLocaleString();

                // Notify other widgets (e.g. verify-widget) that balance changed
                window.dispatchEvent(new CustomEvent('walletBalanceUpdated', {
                    detail: { totalBalance: balance.total_balance }
                }));

                // Update packages
                const pkgContainer = document.getElementById('wallet-packages');
                if (pkgContainer) {
                    if (packages.length === 0) {
                        pkgContainer.innerHTML = `<div class="empty-text">${window.i18n?.t('wallet.noPackages') || '暂无套餐'}</div>`;
                    } else {
                        const isEnglish = window.i18n?.isEnglish?.();
                        const pointsUnit = window.i18n?.t('wallet.pointsUnit') || '分';
                        pkgContainer.innerHTML = packages.map(pkg => {
                            const displayName = isEnglish && pkg.name_en ? pkg.name_en : pkg.name;
                            return `
                            <div class="package-item" onclick="WalletModal.buyPackage('${pkg.id}', '${pkg.name}')">
                                <div class="pkg-name">${displayName}</div>
                                <div class="pkg-points">${pkg.points_amount} ${pointsUnit}${pkg.bonus_points > 0 ? ` <span class="pkg-bonus">+${pkg.bonus_points}</span>` : ''}</div>
                                <div class="pkg-price">¥${pkg.price_cny}</div>
                            </div>
                        `}).join('');
                    }
                    requestWalletRechargeScrollCueUpdate();
                }

                // Store packages & history data for reuse
                this._packagesCache = packages;
                this.historyData = history;

                // Trigger loading orders in the background so it's ready when the user clicks the tab
                if (!this.ordersLoaded && !this.ordersLoading) {
                    this.loadOrders().catch(e => console.error('Background order load failed:', e));
                }

                // Note: History tab has been merged into Orders tab
                // The renderHistory() call has been removed as the wallet-history element no longer exists

            } catch (err) {
                console.error('[WalletModal] ❌ Load data failed:', err);
                this.showToast('数据加载失败', 'error');
            }
        },

        /**
         * Animate number
         */
        animateValue(obj, start, end, duration) {
            if (start === end) {
                obj.textContent = end.toLocaleString();
                return;
            }
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                // Ease out expo
                const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

                const value = Math.floor(easeProgress * (end - start) + start);
                obj.textContent = value.toLocaleString();

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                } else {
                    obj.textContent = end.toLocaleString();
                }
            };
            window.requestAnimationFrame(step);
        },

        /**
         * Handle package purchase
         */
        async buyPackage(packageId, packageName) {
            const overlay = document.getElementById('wallet-modal-overlay');

            try {
                // Show loading state
                if (overlay) overlay.classList.add('loading');

                // Use cached package data to skip the DB fetch in mockPay
                const cachedPkg = (this._packagesCache || []).find(p => p.id === packageId);
                await PointsService.mockPay(packageId, cachedPkg);

                // Remove loading state BEFORE refreshing data
                if (overlay) overlay.classList.remove('loading');

                // Show success toast immediately (don't wait for data refresh)
                this.showToast('✅ 充值成功！', 'success');

                // Refresh order data immediately so new recharge records appear without reopening the wallet
                this._prefetchedShopOrders = null;
                this._prefetchedLedger = null;
                this.ordersLoaded = false;
                this.loadOrders().catch(e => console.error('Order reload after recharge failed:', e));

                // Refresh data in background to show new balance
                this.loadData();

            } catch (err) {
                console.error('[WalletModal] Purchase failed:', err);
                // Remove loading state on error
                if (overlay) overlay.classList.remove('loading');
                alert('❌ 支付失败: ' + (err.message || '未知错误'));
            }
        },

        /**
         * Load comprehensive check-in data and render the calendar UI
         */
        async loadCheckinData() {
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (!session?.user) return;

                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth() + 1;

                // Update month title
                const titleEl = document.getElementById('checkin-month-title');
                if (titleEl) titleEl.textContent = `${month}月打卡`;

                // Fetch data from RPC
                const { data, error } = await window.supabaseClient.rpc('fn_get_checkin_data', {
                    p_user_id: session.user.id,
                    p_site: window.SiteConfig?.site || 'cn',
                    p_year: year,
                    p_month: month
                });

                if (error) throw error;

                if (data && data.success) {
                    // Update streak
                    const streakCountEl = document.getElementById('checkin-streak-count');
                    if (streakCountEl) streakCountEl.textContent = data.consecutive_days || 0;

                    // Render calendar
                    this.renderCalendar(year, month, data.checked_dates || [], data.current_date);

                    // Render Mystery Progress (mock for now, logic can be tied to config later)
                    // Config would tell us if we are in week 1, 2, 3, etc.
                    const streakRem = (data.consecutive_days || 0) % 7;
                    const progressPercent = (streakRem / 7) * 100;
                    const fill = document.getElementById('mystery-progress-fill');
                    if (fill) fill.style.width = `${progressPercent}%`;
                }

            } catch (err) {
                console.error('[WalletModal] Error loading check-in data:', err);
                const grid = document.getElementById('calendar-grid');
                if (grid) grid.innerHTML = `<div class="loading-calendar" style="color:#ef4444;">加载失败</div>`;
            }
        },

        /**
         * Render the calendar grid
         */
        renderCalendar(year, month, checkedDates, currentDateStr) {
            const grid = document.getElementById('calendar-grid');
            const mainBtn = document.getElementById('calendar-main-checkin-btn');
            if (!grid) return;

            const daysInMonth = new Date(year, month, 0).getDate();
            const firstDayIndex = new Date(year, month - 1, 1).getDay(); // 0 is Sunday

            let html = '';

            // Empty slots for days of previous month
            for (let i = 0; i < firstDayIndex; i++) {
                html += `<div class="calendar-day empty"></div>`;
            }

            // Determine if today is checked
            const todayIsChecked = checkedDates.includes(currentDateStr);

            // Days of current month
            for (let i = 1; i <= daysInMonth; i++) {
                // Pad month and day
                const mStr = String(month).padStart(2, '0');
                const dStr = String(i).padStart(2, '0');
                const dateStr = `${year}-${mStr}-${dStr}`;
                let dayClass = 'calendar-day';
                let innerHtml = `<span>${i}</span>`;
                let clickAction = '';

                // Calculate if this day is the 7th day of a streak
                // For simplicity in the UI preview, let's just highlight the next upcoming 7th day milestone
                // Real logic would calculate exactly which days cross the 7-day boundary
                const isChecked = checkedDates.includes(dateStr);
                const isToday = dateStr === currentDateStr;
                const isPast = dateStr < currentDateStr;

                // Simple logic to show mystery box on the *next* milestone day
                const currentStreak = window.walletCheckinData?.consecutive_days || 0;
                const daysUntilMilestone = 7 - (currentStreak % 7);

                // We show the gift icon if:
                // 1. the day is exactly `daysUntilMilestone` days from today AND it's not past OR
                // 2. it's already checked and corresponds to a multiple of 7 in the month (approximate visual)
                let isGiftDay = false;

                if (isToday && daysUntilMilestone === 7 && currentStreak > 0 && currentStreak % 7 === 0) {
                    // Just reached it today
                    isGiftDay = true;
                } else if (!isPast && !isChecked) {
                    // It's a future day
                    const todayDateObj = new Date(currentDateStr);
                    const thisCellDateObj = new Date(dateStr);
                    const diffTime = Math.abs(thisCellDateObj - todayDateObj);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays === daysUntilMilestone && !isToday) {
                        isGiftDay = true;
                    } else if (isToday && daysUntilMilestone === 7 && currentStreak === 0) {
                        // User hasn't started, day 7 is not today.
                    } else if (isToday && daysUntilMilestone === 7) {
                        // already handled above
                    }
                }

                if (isChecked) {
                    dayClass += ' checked';
                    // SVG Checkmark or Coin
                    innerHtml = `
                        <svg class="check-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M20 6L9 17L4 12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    `;
                } else if (isToday) {
                    dayClass += ' today';
                    clickAction = `onclick="WalletModal.dailyCheckinV2()"`;
                    innerHtml = `<span class="today-text">今日</span>`;
                } else if (isPast) {
                    dayClass += ' missed';
                    innerHtml += `<div class="makeup-badge">补</div>`;
                    clickAction = `onclick="WalletModal.makeupCheckin('${dateStr}')"`;
                } else {
                    dayClass += ' future';
                }

                if (isGiftDay && !isChecked) {
                    innerHtml += `
                    <div class="mystery-gift-container" title="连续签到7天神秘盲盒">
                        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22 17.5C22 19.433 20.433 21 18.5 21H5.5C3.567 21 2 19.433 2 17.5V11H22V17.5ZM2 8.5C2 7.119 3.119 6 4.5 6H7.132C7.045 5.688 7 5.352 7 5C7 3.343 8.343 2 10 2C10.978 2 11.846 2.47 12.399 3.208L12 3.159L11.601 3.208C12.154 2.47 13.022 2 14 2C15.657 2 17 3.343 17 5C17 5.352 16.955 5.688 16.868 6H19.5C20.881 6 22 7.119 22 8.5V9H2V8.5ZM13 11V21H11V11H13ZM13 6V9H11V6H13Z" />
                        </svg>
                    </div>`;
                }

                html += `<div class="${dayClass}" ${clickAction}>${innerHtml}</div>`;
            }

            grid.innerHTML = html;
        },

        /**
         * Check-in V2
         */
        async dailyCheckinV2() {
            if (this.isCheckingIn) return;
            this.isCheckingIn = true;

            const gridToday = document.querySelector('.calendar-day.today');
            if (gridToday) {
                gridToday.innerHTML = `<span class="today-text" style="font-size: 10px;">...</span>`;
            }

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (!session?.user) {
                    this.showToast('请先登录', 'error');
                    this.isCheckingIn = false;
                    if (gridToday) gridToday.innerHTML = `<span class="today-text">今日</span>`;
                    return;
                }

                const { data, error } = await window.supabaseClient.rpc('fn_daily_checkin_v2', {
                    p_user_id: session.user.id,
                    p_site: window.SiteConfig?.site || 'cn'
                });

                if (error) throw error;

                if (data?.already_checked) {
                    this.showToast('今日已签到过了', 'info');
                    this.loadCheckinData(); // refresh grid
                } else if (data?.success) {
                    // Celebration Animations
                    this.playConfetti();

                    // Show message combining base and bonus (if any)
                    let msg = `💰 签到奖励 +${data.points} 积分`;
                    if (data.message && data.message !== '签到成功') {
                        msg += `\\n${data.message}`; // Append the bonus message
                    }
                    this.showToast(msg, 'success');

                    // Update balance display
                    if (data.new_balance !== undefined) {
                        const totalEl = document.getElementById('wallet-total');
                        if (totalEl) totalEl.textContent = data.new_balance;
                    }

                    // Relax and let the user see the animation, then reload
                    setTimeout(() => {
                        this.loadCheckinData();
                        this.loadData().catch(() => { });
                    }, 1000);
                } else {
                    throw new Error(data?.message || '签到失败');
                }
            } catch (e) {
                console.error('[WalletModal] Check-in V2 failed:', e);
                this.showToast('❌ ' + (e.message || '签到失败'), 'error');
                if (gridToday) {
                    gridToday.innerHTML = `<span class="today-text">今日</span>`;
                }
            } finally {
                this.isCheckingIn = false;
            }
        },

        /**
         * Popup logic for Makeup Checkin
         */
        makeupCheckin(dateStr) {
            // Future extension: present a modal letting user choose 'points', 'comment', or 'invite'
            // For now, default to points, but ask for confirmation.
            // Ideally, we'd read the cost from `systemConfigCache` if we loaded it in frontend,
            // but for simplicity, we let backend handle/reject.

            if (!confirm(`确认要补签 ${dateStr} 吗？\\n这将扣除配置的积分(如10分)`)) {
                return;
            }

            this.executeMakeup(dateStr, 'points');
        },

        async executeMakeup(dateStr, method) {
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (!session?.user) return this.showToast('请先登录', 'error');

                const { data, error } = await window.supabaseClient.rpc('fn_makeup_checkin', {
                    p_user_id: session.user.id,
                    p_site: window.SiteConfig?.site || 'cn',
                    p_date: dateStr,
                    p_method: method
                });

                if (error) throw error;

                if (data.success) {
                    this.showToast(`✅ 补签成功! 扣除 ${data.cost} 积分`, 'success');

                    // Update balance display
                    if (data.new_balance !== undefined) {
                        const totalEl = document.getElementById('wallet-total');
                        if (totalEl) totalEl.textContent = data.new_balance;
                    }

                    // Refresh calendar and data
                    this.loadCheckinData();
                    this.loadData().catch(() => { });
                } else {
                    this.showToast(`❌ ${data.message}`, 'error');
                }
            } catch (e) {
                console.error('[WalletModal] Makeup failed:', e);
                this.showToast(`更补签失败: ${e.message}`, 'error');
            }
        },

        /**
         * Play Confetti animation using native JS/CSS
         */
        playConfetti() {
            // Simplified particle animation over the calendar grid
            const grid = document.getElementById('calendar-grid');
            if (!grid) return;

            for (let i = 0; i < 30; i++) {
                const particle = document.createElement('div');
                particle.className = 'confetti-particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.backgroundColor = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#a78bfa'][Math.floor(Math.random() * 5)];
                const duration = Math.random() * 1 + 1; // 1 to 2s
                const delay = Math.random() * 0.2;
                particle.style.animation = `confetti-fall ${duration}s ${delay}s ease-out forwards`;

                grid.appendChild(particle);

                setTimeout(() => particle.remove(), (duration + delay) * 1000);
            }
        },

        /**
         * Redeem activation code
         */
        async redeemCode() {
            const input = document.getElementById('redeem-code-input');
            const code = input?.value?.trim()?.toUpperCase();

            if (!code) {
                this.showToast('请输入兑换码', 'error');
                return;
            }

            // Validate format: ZY-XXXX-XXXX-XXXX
            if (!/^ZY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
                this.showToast('兑换码格式不正确', 'error');
                return;
            }

            const redeemBtn = document.querySelector('.redeem-btn');
            const originalText = redeemBtn?.textContent;

            try {
                // Show loading
                if (redeemBtn) {
                    redeemBtn.textContent = '兑换中...';
                    redeemBtn.disabled = true;
                }

                // Call RPC function
                const { data, error } = await supabase.rpc('fn_redeem_code', {
                    p_code: code,
                    p_site: window.SiteConfig?.site || 'cn'
                });

                if (error) throw error;

                if (data.success) {
                    // Clear input
                    input.value = '';

                    // Show success
                    this.showToast(`✅ ${data.message} +${data.points}分`, 'success');

                    // Refresh balance and history
                    await this.loadData();
                } else {
                    this.showToast(`❌ ${data.message}`, 'error');
                }

            } catch (err) {
                console.error('[WalletModal] Redeem failed:', err);
                this.showToast('❌ 兑换失败: ' + (err.message || '未知错误'), 'error');
            } finally {
                if (redeemBtn) {
                    redeemBtn.textContent = originalText;
                    redeemBtn.disabled = false;
                }
            }
        },

        /**
         * Query Afdian order for redemption code
         */
        async queryAfdianCode() {
            const input = document.getElementById('afdian-order-input');
            const resultDiv = document.getElementById('afdian-result');
            const orderNo = input?.value?.trim();

            if (!orderNo) {
                this.showToast('请输入订单号', 'error');
                return;
            }

            const queryBtn = document.querySelector('.afdian-query-btn');
            const originalText = queryBtn?.textContent;

            try {
                if (queryBtn) {
                    queryBtn.textContent = '查询中...';
                    queryBtn.disabled = true;
                }

                // Get server URL from verify config or default
                const serverUrl = window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app';

                const response = await fetch(`${serverUrl}/api/afdian/query?order_no=${encodeURIComponent(orderNo)}`);
                const data = await response.json();

                if (data.success) {
                    // Show code in result area
                    resultDiv.innerHTML = `
                        <div class="afdian-code-result">
                            <div class="code-label">您的兑换码（${data.points}积分）：</div>
                            <div class="code-value" onclick="WalletModal.copyAfdianCode('${data.code}')">${data.code}</div>
                            <div class="code-hint">${data.is_redeemed ? '⚠️ 该兑换码已使用' : '点击复制，然后在余额页使用'}</div>
                        </div>
                    `;
                    resultDiv.style.display = 'block';
                } else {
                    resultDiv.innerHTML = `<div class="afdian-error">${data.message || '查询失败'}</div>`;
                    resultDiv.style.display = 'block';
                }

            } catch (err) {
                console.error('[WalletModal] Afdian query failed:', err);
                resultDiv.innerHTML = `<div class="afdian-error">查询失败，请稍后重试</div>`;
                resultDiv.style.display = 'block';
            } finally {
                if (queryBtn) {
                    queryBtn.textContent = originalText;
                    queryBtn.disabled = false;
                }
            }
        },

        /**
         * Copy Afdian code to clipboard
         */
        copyAfdianCode(code) {
            navigator.clipboard.writeText(code).then(() => {
                this.showToast('✅ 兑换码已复制', 'success');
            }).catch(() => {
                this.showToast('复制失败，请手动复制', 'error');
            });
        },

        /**
         * Show a toast notification
         */
        showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `wallet-toast wallet-toast-${type}`;

            // Replace ✅ emoji with custom CSS checkmark icon
            const checkmarkIcon = `<span style="
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                border-radius: 50%;
                margin-right: 2px;
            "><svg width="10" height="10" viewBox="0 0 12 12" fill="none" style="display:block;">
                <path d="M2 6.5L4.5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg></span>`;

            // Replace emoji with custom icon
            const processedMessage = message.replace(/✅\s*/g, '');

            if (type === 'success') {
                toast.innerHTML = checkmarkIcon + processedMessage;
            } else {
                toast.innerHTML = message;
            }

            const borderColor = type === 'success'
                ? '#10b981'
                : type === 'error'
                    ? '#ef4444'
                    : '#ffffff';

            toast.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                padding: 12px 24px;
                border-radius: 50px;
                background: rgba(20, 20, 20, 0.9);
                border: 1px solid ${borderColor};
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: white;
                font-size: 14px;
                font-weight: 500;
                letter-spacing: 0.5px;
                z-index: 300000;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                opacity: 0;
                animation: toastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            // Add animation keyframes if not exists
            if (!document.getElementById('wallet-toast-style')) {
                const style = document.createElement('style');
                style.id = 'wallet-toast-style';
                style.textContent = `
                    @keyframes toastSlideIn {
                        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
                        to { opacity: 1; transform: translateX(-50%) translateY(0); }
                    }
                    @keyframes toastSlideOut {
                        from { opacity: 1; transform: translateX(-50%) translateY(0); }
                        to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'toastSlideOut 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }, 2000);
        },

        /**
         * Render history items
         */
        renderHistory(items) {
            const container = document.getElementById('wallet-history');
            if (!items || items.length === 0) {
                container.innerHTML = '<div class="empty-text">暂无记录</div>';
                return;
            }

            // identify missing prompts
            const missingPromptIds = new Set();
            items.forEach(item => {
                if (item.reason === 'unlock_prompt' && item.reference_id) {
                    // Check local cache first
                    if (!this.promptCache[item.reference_id]) {
                        // Check global PROMPTS
                        let found = false;
                        if (window.PROMPTS) {
                            const p = window.PROMPTS.find(pr => String(pr.id) === String(item.reference_id) || String(pr.supabaseId) === String(item.reference_id));
                            if (p) {
                                this.promptCache[item.reference_id] = p.title;
                                found = true;
                            }
                        }
                        if (!found) {
                            missingPromptIds.add(item.reference_id);
                        }
                    }
                }
            });

            // Fetch missing titles if any
            if (missingPromptIds.size > 0) {
                this.fetchPromptTitles(Array.from(missingPromptIds)).then(() => {
                    // Re-render to show titles (or update DOM directly if complex)
                    // For simplicity, re-rendering visible items is easiest if data changed
                    this.renderHistory(items);
                });
            }

            container.innerHTML = items.map((item, index) => {
                const date = new Date(item.created_at);
                const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

                // Format Reason
                let reason = item.reason || '交易';
                let reasonClass = '';

                // 1. Handle Admin Adjustment
                if (reason.startsWith('admin_manual:')) {
                    const adminLabel = window.i18n?.t('wallet.adminAdjustment') || '管理员调整:';
                    reason = reason.replace(/admin_manual:\s*\[.*?\]\s*/, `${adminLabel} `);
                    if (reason.startsWith('admin_manual:')) {
                        reason = reason.replace('admin_manual:', adminLabel);
                    }
                }

                // 2. Handle Unlock Prompt
                else if (reason === 'unlock_prompt') {
                    const promptId = item.reference_id;
                    let promptTitle = this.promptCache[promptId] || (window.i18n?.t('wallet.loading') || '加载中...');

                    if (!this.promptCache[promptId]) {
                        promptTitle = `${window.i18n?.t('wallet.promptItem') || '提示词'} (ID: ${promptId})`;
                    }

                    const unlockLabel = window.i18n?.t('wallet.unlockPrompt') || '解锁提示词:';
                    reason = `${unlockLabel} ${promptTitle}`;
                }

                // 3. Handle Daily Checkin
                else if (reason === 'daily_checkin') {
                    reason = window.i18n?.t('wallet.dailyCheckin') || '每日签到';
                }

                return `
                    <div class="history-item" onclick="WalletModal.toggleItemDetails(this)">
                        <div class="history-row-main">
                            <div class="history-main">
                                <div class="history-desc" title="${item.reason}">${reason}</div>
                                <div class="history-date">${dateStr}</div>
                            </div>
                            <div class="history-amount ${item.amount > 0 ? 'positive' : 'negative'}">
                                ${item.amount > 0 ? '+' : ''}${item.amount}
                            </div>
                        </div>
                        <div class="history-details" onclick="event.stopPropagation()">
                             <div class="detail-row">
                                <span>订单号</span>
                                <span class="detail-val copyable" class="detail-val copyable" onclick="WalletModal.copyToClipboard('${item.id}', event)" title="点击复制订单号" style="font-family:monospace;color:#fff;">${item.id}</span>
                             </div>
                             <div class="detail-row">
                                <span>业务关联</span>
                                <span style="font-family:monospace;color:#fff;">${item.reference_id || '无'}</span>
                             </div>
                        </div>
                    </div>
                `;
            }).join('');
        },

        // Fetch prompt titles from Supabase
        async fetchPromptTitles(ids) {
            try {
                if (!ids || ids.length === 0) return;
                // Avoid redundant fetches
                const toFetch = ids.filter(id => !this.promptCache[id]);
                if (toFetch.length === 0) return;

                const { data, error } = await window.supabaseClient
                    .from('prompts')
                    .select('id, title')
                    .in('id', toFetch);

                if (error) throw error;
                if (data) {
                    data.forEach(p => {
                        this.promptCache[p.id] = p.title;
                    });
                }
            } catch (err) {
                console.error('Error fetching prompt titles:', err);
            }
        },

        /**
         * Toggle history section collapse
         */
        toggleHistory() {
            const container = document.getElementById('wallet-history');
            const toggle = document.getElementById('history-toggle');

            if (container.classList.contains('collapsed')) {
                container.classList.remove('collapsed');
                toggle.textContent = '▼';
            } else {
                container.classList.add('collapsed');
                toggle.textContent = '▶';
            }
        },

        /**
         * Toggle filter popup menu
         */
        toggleFilterMenu(event) {
            event.stopPropagation();
            const popup = document.getElementById('filter-popup');
            const isOpen = popup.classList.contains('open');

            if (isOpen) {
                popup.classList.remove('open');
            } else {
                popup.classList.add('open');

                // Close when clicking outside
                const closeHandler = (e) => {
                    if (!e.target.closest('.filter-wrapper')) {
                        popup.classList.remove('open');
                        document.removeEventListener('click', closeHandler);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 0);
            }
        },

        /**
         * Select filter option
         */
        selectFilter(value, label) {
            // Close popup
            document.getElementById('filter-popup').classList.remove('open');

            // Update label and active state
            document.getElementById('filter-label').textContent = label;
            document.querySelectorAll('.filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === value);
            });

            this.currentFilter = value;
            this.applyFilter(value);
        },

        /**
         * Show custom date picker
         */
        showCustomDate() {
            document.getElementById('filter-popup').classList.remove('open');

            // Create date picker modal
            const modal = document.createElement('div');
            modal.className = 'date-picker-modal';
            modal.innerHTML = `
                <div class="date-picker-content">
                    <div class="date-picker-header">📅 选择日期范围</div>
                    <div class="date-picker-row">
                        <label>开始日期</label>
                        <input type="date" id="date-start" />
                    </div>
                    <div class="date-picker-row">
                        <label>结束日期</label>
                        <input type="date" id="date-end" />
                    </div>
                    <div class="date-picker-actions">
                        <button class="date-cancel" onclick="this.closest('.date-picker-modal').remove()">取消</button>
                        <button class="date-confirm" onclick="WalletModal.applyCustomDate()">确定</button>
                    </div>
                </div>
            `;

            // Set default dates (last 7 days)
            const today = new Date().toISOString().split('T')[0];
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            document.body.appendChild(modal);
            document.getElementById('date-start').value = weekAgo;
            document.getElementById('date-end').value = today;

            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        },

        /**
         * Apply custom date filter
         */
        applyCustomDate() {
            const startStr = document.getElementById('date-start').value;
            const endStr = document.getElementById('date-end').value;

            if (!startStr || !endStr) {
                alert('请选择开始和结束日期');
                return;
            }

            const start = new Date(startStr);
            const end = new Date(endStr);
            end.setHours(23, 59, 59, 999); // Include the whole end day

            if (start > end) {
                alert('开始日期不能晚于结束日期');
                return;
            }

            // Close modal
            document.querySelector('.date-picker-modal')?.remove();

            // Update label
            const label = `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
            document.getElementById('filter-label').textContent = label;

            // Store custom dates
            this.customDateStart = start;
            this.customDateEnd = end;
            this.currentFilter = 'custom';

            this.applyFilter('custom');
        },

        /**
         * Apply filter to history
         */
        applyFilter(filter) {
            const now = new Date();
            let filtered = this.historyData || [];

            if (filter === 'today') {
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                filtered = filtered.filter(item => new Date(item.created_at) >= today);
            } else if (filter === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                filtered = filtered.filter(item => new Date(item.created_at) >= weekAgo);
            } else if (filter === 'month') {
                const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                filtered = filtered.filter(item => new Date(item.created_at) >= monthAgo);
            } else if (filter === 'custom' && this.customDateStart && this.customDateEnd) {
                filtered = filtered.filter(item => {
                    const date = new Date(item.created_at);
                    return date >= this.customDateStart && date <= this.customDateEnd;
                });
            }

            const hc1 = document.getElementById('history-count');
            if (hc1) hc1.textContent = filtered.length > 0 ? `(${filtered.length})` : '';
            this.renderHistory(filtered);
        },

        /**
         * Clear all transaction history
         */
        async clearHistory() {
            // Get current count before delete
            const currentCount = (this.historyData || []).length;
            if (currentCount === 0) {
                this.showToast('暂无记录可清除', 'info');
                return;
            }

            if (!confirm(`确定要清除 ${currentCount} 条交易记录吗？\n\n此操作不可恢复！`)) {
                return;
            }

            try {
                // Use RPC function to bypass RLS issues
                const { data: deletedCount, error } = await supabase.rpc('fn_clear_user_history');

                console.log('[WalletModal] Delete result:', { deletedCount, error });

                if (error) throw error;

                this.historyData = [];
                this.renderHistory([]);
                const hc2 = document.getElementById('history-count');
                if (hc2) hc2.textContent = '';
                this.showToast(`已清除 ${currentCount} 条记录`, 'success');
            } catch (err) {
                console.error('[WalletModal] Clear history failed:', err);
                alert('清除失败: ' + (err.message || '未知错误'));
            }
        },

        // Order filter state
        orderFilter: 'all',
        ordersData: [],

        /**
         * Toggle order filter menu
         */
        toggleOrderFilterMenu(event) {
            event.stopPropagation();
            const popup = document.getElementById('order-filter-popup');
            if (popup) {
                popup.classList.toggle('open');
                // Close when clicking outside
                const closeHandler = (e) => {
                    if (!popup.contains(e.target) && !e.target.closest('.filter-chip')) {
                        popup.classList.remove('open');
                        document.removeEventListener('click', closeHandler);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 10);
            }
        },

        /**
         * Select order filter
         */
        selectOrderFilter(value, label) {
            this.orderFilter = value;
            const labelEl = document.getElementById('order-filter-label');
            if (labelEl) labelEl.textContent = label;

            // Update active state
            document.querySelectorAll('#order-filter-popup .filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === value);
            });

            // Close popup
            const popup = document.getElementById('order-filter-popup');
            if (popup) popup.classList.remove('open');

            // Apply filter
            this.applyOrderFilter();
        },

        // Order time filter state
        orderTimeFilter: 'all',

        /**
         * Toggle order time filter menu
         */
        toggleOrderTimeFilterMenu(event) {
            event.stopPropagation();
            const popup = document.getElementById('order-time-filter-popup');
            if (popup) {
                popup.classList.toggle('open');
                // Close when clicking outside
                const closeHandler = (e) => {
                    if (!popup.contains(e.target) && !e.target.closest('.filter-chip')) {
                        popup.classList.remove('open');
                        document.removeEventListener('click', closeHandler);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 10);
            }
        },

        /**
         * Select order time filter
         */
        selectOrderTimeFilter(value, label) {
            this.orderTimeFilter = value;
            const labelEl = document.getElementById('order-time-filter-label');
            if (labelEl) labelEl.textContent = label;

            // Update active state
            document.querySelectorAll('#order-time-filter-popup .filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === value);
            });

            // Close popup
            const popup = document.getElementById('order-time-filter-popup');
            if (popup) popup.classList.remove('open');

            // Apply filter
            this.applyOrderFilter();
        },

        // Order custom date range state
        orderCustomDateStart: null,
        orderCustomDateEnd: null,

        /**
         * Show custom date picker for orders
         */
        showOrderCustomDate() {
            // Close the popup first
            const popup = document.getElementById('order-time-filter-popup');
            if (popup) popup.classList.remove('open');

            // Create date picker modal with premium glass style
            const modal = document.createElement('div');
            modal.className = 'wallet-order-modal-overlay';
            modal.innerHTML = `
                <div class="wallet-order-modal" style="max-width: 360px;">
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            📅 选择日期范围
                        </div>
                        <button class="wallet-order-close-btn date-cancel-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="wallet-order-modal-body">
                        <div class="meta-section">
                            <div class="detail-row" style="flex-direction: column; align-items: stretch; gap: 8px;">
                                <span class="detail-label" style="margin-bottom: 4px;">开始日期</span>
                                <input type="date" id="order-date-start" style="
                                    width: 100%;
                                    padding: 12px 14px;
                                    background: rgba(0, 0, 0, 0.3);
                                    border: 1px solid rgba(255, 255, 255, 0.15);
                                    border-radius: 10px;
                                    color: white;
                                    font-size: 14px;
                                    box-sizing: border-box;
                                " value="${this.orderCustomDateStart ? this.orderCustomDateStart.toISOString().split('T')[0] : ''}">
                            </div>
                            <div class="detail-row" style="flex-direction: column; align-items: stretch; gap: 8px; margin-top: 16px;">
                                <span class="detail-label" style="margin-bottom: 4px;">结束日期</span>
                                <input type="date" id="order-date-end" style="
                                    width: 100%;
                                    padding: 12px 14px;
                                    background: rgba(0, 0, 0, 0.3);
                                    border: 1px solid rgba(255, 255, 255, 0.15);
                                    border-radius: 10px;
                                    color: white;
                                    font-size: 14px;
                                    box-sizing: border-box;
                                " value="${this.orderCustomDateEnd ? this.orderCustomDateEnd.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}">
                            </div>
                        </div>
                        <div class="modal-actions" style="margin-top: 20px;">
                            <button class="action-btn secondary date-cancel-btn" style="flex: 1;">
                                取消
                            </button>
                            <button class="action-btn primary date-confirm-btn" style="flex: 1;">
                                <i class="fas fa-check"></i> 确定
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Cancel buttons (close icon and cancel button)
            modal.querySelectorAll('.date-cancel-btn').forEach(btn => {
                btn.onclick = () => modal.remove();
            });

            // Confirm button
            modal.querySelector('.date-confirm-btn').onclick = () => {
                const startInput = document.getElementById('order-date-start').value;
                const endInput = document.getElementById('order-date-end').value;

                if (!startInput || !endInput) {
                    this.showToast('请选择完整的日期范围', 'error');
                    return;
                }

                this.orderCustomDateStart = new Date(startInput);
                this.orderCustomDateEnd = new Date(endInput);
                this.orderCustomDateEnd.setHours(23, 59, 59, 999); // Include the entire end day

                // Update label
                const startStr = `${this.orderCustomDateStart.getMonth() + 1}/${this.orderCustomDateStart.getDate()}`;
                const endStr = `${this.orderCustomDateEnd.getMonth() + 1}/${this.orderCustomDateEnd.getDate()}`;
                const labelEl = document.getElementById('order-time-filter-label');
                if (labelEl) labelEl.textContent = `${startStr}-${endStr}`;

                // Update active state
                document.querySelectorAll('#order-time-filter-popup .filter-option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.value === 'custom');
                });

                this.orderTimeFilter = 'custom';
                this.applyOrderFilter();
                modal.remove();
            };

            // Close on overlay click
            modal.onclick = (e) => {
                if (e.target === modal) modal.remove();
            };

            document.body.appendChild(modal);
        },

        /**
         * Apply order filter (both type and time)
         */
        applyOrderFilter() {
            const typeFilter = this.orderFilter;
            const timeFilter = this.orderTimeFilter;
            let filtered = [...(this.ordersData || [])];

            // Apply type filter using transactionType
            if (typeFilter === 'shop') {
                filtered = filtered.filter(order => order.transactionType === 'shop');
            } else if (typeFilter === 'verify') {
                filtered = filtered.filter(order => order.transactionType === 'verify');
            } else if (typeFilter === 'prompt') {
                filtered = filtered.filter(order => order.transactionType === 'prompt');
            } else if (typeFilter === 'recharge') {
                filtered = filtered.filter(order => order.transactionType === 'recharge');
            } else if (typeFilter === 'redeem') {
                filtered = filtered.filter(order => order.transactionType === 'redeem');
            }

            // Apply time filter
            const now = new Date();
            if (timeFilter === 'today') {
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                filtered = filtered.filter(order => new Date(order.created_at) >= todayStart);
            } else if (timeFilter === 'week') {
                const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
                filtered = filtered.filter(order => new Date(order.created_at) >= weekAgo);
            } else if (timeFilter === 'month') {
                const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                filtered = filtered.filter(order => new Date(order.created_at) >= monthAgo);
            } else if (timeFilter === 'custom' && this.orderCustomDateStart && this.orderCustomDateEnd) {
                filtered = filtered.filter(order => {
                    const date = new Date(order.created_at);
                    return date >= this.orderCustomDateStart && date <= this.orderCustomDateEnd;
                });
            }

            this.renderOrders(filtered);
        },

        /**
         * Clear all orders (delete from database)
         */
        async clearOrders() {
            const currentCount = (this.ordersData || []).length;
            if (currentCount === 0) {
                this.showToast('暂无订单可清除', 'info');
                return;
            }

            if (!confirm(`确定要清除 ${currentCount} 条订单记录吗？\n\n此操作不可恢复！`)) {
                return;
            }

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) {
                    this.showToast(window.i18n?.t('security.loginRequired') || '请先登录', 'error');
                    return;
                }
                const userId = user.id;

                // Delete shop orders
                const { error: shopError } = await supabase
                    .from('shop_orders')
                    .delete()
                    .eq('user_id', userId)
                    .eq('site', window.SiteConfig?.site || 'cn');

                if (shopError) console.warn('Clear shop orders failed:', shopError);

                // Clear ordersData and re-render
                this.ordersData = [];
                this.renderOrders([]);
                this.showToast(`已清除 ${currentCount} 条订单`, 'success');
            } catch (err) {
                console.error('[WalletModal] Clear orders failed:', err);
                alert('清除失败: ' + (err.message || '未知错误'));
            }
        },

        /**
         * Expand item to show details
         */
        /**
         * Copy text to clipboard
         */
        async copyToClipboard(text, event) {
            if (event) event.stopPropagation();
            try {
                await navigator.clipboard.writeText(text);
                this.showToast('✅ 复制成功', 'success');
            } catch (err) {
                console.error('Copy failed:', err);
                this.showToast('❌ 复制失败', 'error');
            }
        },

        /**
         * Toggle item expansion
         */
        toggleItemDetails(element) {
            // Toggle expanded class
            element.classList.toggle('expanded');
        },

        /**
         * Load all transactions: shop orders, prompt unlocks, recharges, redemptions
         */
        async loadOrders() {
            if (this.ordersLoading) return;
            this.ordersLoading = true;
            try {
                console.log('[WalletModal] 🔄 Loading all transactions...');
                const container = document.getElementById('wallet-orders');
                if (!container) return;

                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) {
                    container.innerHTML = `<div class="empty-text">${window.i18n?.t('security.loginRequired') || '请先登录'}</div>`;
                    return;
                }

                // Use prefetched data if available (instant!), otherwise fetch from network
                let shopOrders, ledgerEntries;

                if (this._prefetchedShopOrders && this._prefetchedLedger) {
                    console.log('[WalletModal] ⚡ Using prefetched data (instant)');
                    shopOrders = this._prefetchedShopOrders;
                    ledgerEntries = this._prefetchedLedger;
                    // Clear prefetched data after use
                    this._prefetchedShopOrders = null;
                    this._prefetchedLedger = null;
                } else {
                    // Fetch shop orders AND all ledger entries in parallel
                    const [shopOrdersResult, ledgerResult] = await Promise.all([
                        supabase
                            .from('shop_orders')
                            .select(`
                                id, 
                                total_price, 
                                item_count, 
                                status, 
                                created_at, 
                                snapshot_product_name,
                                shop_order_items (
                                    id,
                                    snapshot_product_name
                                )
                            `)
                            .eq('user_id', user.id)
                            .eq('site', window.SiteConfig?.site || 'cn')
                            .order('created_at', { ascending: false })
                            .limit(100),

                        supabase
                            .from('points_ledger')
                            .select('id, amount, reason, reference_id, created_at')
                            .eq('user_id', user.id)
                            .eq('site', window.SiteConfig?.site || 'cn')
                            .order('created_at', { ascending: false })
                            .limit(100)
                    ]);

                    if (shopOrdersResult.error) throw shopOrdersResult.error;
                    shopOrders = shopOrdersResult.data || [];
                    ledgerEntries = ledgerResult.data || [];
                }

                // Fetch prompt titles for unlock entries
                const promptIds = ledgerEntries
                    .filter(e => e.reason === 'unlock_prompt' && e.reference_id)
                    .map(e => e.reference_id);

                let promptTitles = {};
                if (promptIds.length > 0) {
                    const { data: prompts } = await supabase
                        .from('prompts')
                        .select('id, title')
                        .in('id', promptIds);

                    if (prompts) {
                        prompts.forEach(p => {
                            promptTitles[p.id] = p.title;
                        });
                    }
                }

                // Convert ledger entries to order-like format
                const ledgerOrders = ledgerEntries.map(entry => {
                    let transactionType = 'other';
                    let displayName = entry.reason || '交易';
                    let icon = '💳';
                    let shopOrderId = '';

                    // Categorize by reason
                    if (entry.reason === 'unlock_prompt') {
                        transactionType = 'prompt';
                        displayName = promptTitles[entry.reference_id] || `${window.i18n?.t('wallet.promptItem') || '提示词'} #${entry.reference_id}`;
                        icon = '💡';
                    } else if (this.isVerifyServiceReason(entry.reason)) {
                        transactionType = 'verify';
                        displayName = this.getVerifyDisplayName();
                        icon = '🔑';
                    } else if (this.isShopLedgerReason(entry.reason, entry.reference_id)) {
                        transactionType = 'shop';
                        displayName = String(entry.reason || '')
                            .replace(/^商城购买[:：]\s*/i, '')
                            .replace(/^shop purchase[:：]\s*/i, '')
                            .trim() || (window.i18n?.t('wallet.shopPurchase') || '商品');
                        icon = '🛒';
                        shopOrderId = this.getShopOrderIdFromReference(entry.reference_id);
                    } else if (entry.reason === 'daily_checkin') {
                        transactionType = 'recharge'; // Or whatever visual category is appropriate (positive)
                        displayName = window.i18n?.t('wallet.dailyCheckin') || '每日签到';
                        icon = '⚡';
                    } else if (entry.reason && (entry.reason.startsWith('模拟充值') || entry.reason === 'package_purchase' || entry.reason === 'afdian_recharge')) {
                        // Package recharges (mock or real)
                        transactionType = 'recharge';
                        displayName = this.getRechargeDisplayName(entry.reason);
                        icon = '⚡';
                    } else if (entry.reason === 'redeem_code' || (entry.reason && entry.reason.includes('兑换码'))) {
                        transactionType = 'redeem';
                        displayName = '兑换码兑换';
                        icon = '🎟️';
                    } else if (entry.reason && entry.reason.startsWith('admin_manual')) {
                        transactionType = 'recharge'; // Treat admin adjustments as recharge type
                        const adminLabel = window.i18n?.t('wallet.adminAdjustment') || '管理员调整:';
                        displayName = entry.reason.replace(/admin_manual:\s*\[.*?\]\s*/, `${adminLabel} `);
                        if (displayName.startsWith('admin_manual:')) {
                            displayName = displayName.replace('admin_manual:', adminLabel);
                        }
                        icon = '👤';
                    } else if (entry.amount > 0) {
                        // Positive amounts that don't match other patterns - likely recharges
                        transactionType = 'recharge';
                        displayName = entry.reason || '积分充值';
                        icon = '⚡';
                    }

                    return {
                        id: entry.id,
                        created_at: entry.created_at,
                        total_price: Math.abs(entry.amount),
                        amount: entry.amount, // Keep original for display
                        status: 'completed',
                        snapshot_product_name: displayName,
                        item_count: 1,
                        transactionType: transactionType,
                        isPromptUnlock: transactionType === 'prompt',
                        isVerifyOrder: transactionType === 'verify',
                        isRecharge: transactionType === 'recharge',
                        isRedeem: transactionType === 'redeem',
                        promptId: entry.reason === 'unlock_prompt' ? entry.reference_id : null,
                        redeemCode: transactionType === 'redeem' ? entry.reference_id : null,
                        referenceId: entry.reference_id || '',
                        shopOrderId,
                        rawReason: entry.reason || '',
                        icon: icon
                    };
                });

                // Add shop orders with their type
                const shopOrdersList = shopOrders.map(order => ({
                    ...order,
                    transactionType: 'shop',
                    isShopOrder: true,
                    shopOrderId: order.id,
                    icon: '🛒'
                }));

                const realShopOrderIds = new Set(
                    shopOrdersList
                        .map(order => String(order.shopOrderId || order.id || '').trim())
                        .filter(Boolean)
                );

                const dedupedLedgerOrders = ledgerOrders.filter((order) => {
                    if (order.transactionType !== 'shop') return true;
                    if (!order.shopOrderId) return true;
                    return !realShopOrderIds.has(String(order.shopOrderId).trim());
                });

                // Merge and sort by date
                const allOrders = [...shopOrdersList, ...dedupedLedgerOrders].sort((a, b) =>
                    new Date(b.created_at) - new Date(a.created_at)
                );

                this.ordersLoaded = true;
                this.ordersData = allOrders; // Save for filtering
                this.applyOrderFilter();

            } catch (err) {
                console.error('[WalletModal] ❌ Load transactions failed:', err);
                const container = document.getElementById('wallet-orders');
                if (container) {
                    container.innerHTML = '<div class="empty-text">加载失败</div>';
                }
            } finally {
                this.ordersLoading = false;
            }
        },

        /**
         * Render all transactions (shop orders, prompts, recharges, redemptions)
         */
        renderOrders(orders) {
            const container = document.getElementById('wallet-orders');
            if (!orders || orders.length === 0) {
                container.innerHTML = `<div class="empty-text">${window.i18n?.t('wallet.noRecords') || '暂无记录'}</div>`;
                return;
            }

            const pointsUnit = window.i18n?.t('wallet.pointsUnit') || '积分';
            const completedText = window.i18n?.t('wallet.completed') || '已完成';
            const refundedText = window.i18n?.t('wallet.refunded') || '已退款';
            const partialRefundText = window.i18n?.t('wallet.partialRefund') || '部分退款';
            const unknownProductText = window.i18n?.t('wallet.unknownProduct') || '未知商品';
            const itemsText = window.i18n?.t('wallet.items') || '件';
            const isEnglish = window.i18n?.isEnglish?.();

            container.innerHTML = orders.map(order => {
                const date = new Date(order.created_at);
                const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

                // Handle display based on transaction type
                let displayName;
                let clickHandler = '';
                let amountDisplay;
                let amountClass;
                let statusText = completedText;
                let statusClass = 'status-completed';

                // Determine amount display and color
                if (order.transactionType === 'recharge' || order.transactionType === 'redeem') {
                    // Positive: recharge and redemption
                    const amount = order.amount || order.total_price;
                    amountDisplay = `+${Math.abs(amount)} ${pointsUnit}`;
                    amountClass = 'positive';
                } else {
                    // Negative: purchases (shop, prompt)
                    const amount = order.total_price || order.amount;
                    amountDisplay = `-${Math.abs(amount)} ${pointsUnit}`;
                    amountClass = 'negative';
                }

                // Handle display name and click based on type
                if (order.transactionType === 'prompt') {
                    displayName = `<i class="fas fa-lightbulb" style="color: #fde68a;"></i> ${this.escapeHtml(order.snapshot_product_name)}`;
                    clickHandler = `WalletModal.showPromptOrderDetail('${order.id}', '${this.escapeHtml(order.snapshot_product_name).replace(/'/g, "\\'")}', ${order.total_price}, '${order.created_at}', '${order.promptId || ''}')`;
                } else if (order.transactionType === 'verify') {
                    displayName = `<i class="fas fa-key" style="color: #6b9ece;"></i> ${this.escapeHtml(order.snapshot_product_name)}`;
                    clickHandler = `WalletModal.showVerifyOrderDetail('${order.id}', '${String(order.referenceId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', ${Math.abs(order.total_price || order.amount || 0)}, '${order.created_at}', '${String(order.rawReason || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
                } else if (order.transactionType === 'shop') {
                    displayName = order.snapshot_product_name || unknownProductText;
                    const count = order.item_count || (order.shop_order_items ? order.shop_order_items.length : 1);
                    if (count > 1) {
                        displayName = isEnglish ? `${displayName} +${count - 1} ${itemsText}` : `${displayName} 等 ${count} ${itemsText}`;
                    }
                    displayName = `<i class="fas fa-shopping-bag" style="color: #22c55e;"></i> ${this.escapeHtml(displayName)}`;
                    if (order.isShopOrder && (order.shopOrderId || order.id)) {
                        clickHandler = `WalletModal.showOrderDetail('${String(order.shopOrderId || order.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
                    } else {
                        clickHandler = `WalletModal.showRechargeOrderDetail('${order.id}', -${Math.abs(order.total_price || order.amount || 0)}, '${order.created_at}', '${String(order.rawReason || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${String(order.referenceId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
                    }

                    // Map status for shop orders
                    const statusMap = {
                        'completed': { text: completedText, class: 'status-completed' },
                        'full_refund': { text: refundedText, class: 'status-refunded' },
                        'partial_refund': { text: partialRefundText, class: 'status-refunded' }
                    };
                    const statusInfo = statusMap[order.status] || { text: completedText, class: 'status-completed' };
                    statusText = statusInfo.text;
                    statusClass = statusInfo.class;
                } else if (order.transactionType === 'recharge') {
                    displayName = `<i class="fas fa-bolt" style="color: #fbbf24;"></i> ${this.escapeHtml(order.snapshot_product_name)}`;
                    clickHandler = `WalletModal.showRechargeOrderDetail('${order.id}', ${Number(order.amount || order.total_price || 0)}, '${order.created_at}', '${String(order.rawReason || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${String(order.referenceId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
                } else if (order.transactionType === 'redeem') {
                    displayName = `<i class="fas fa-ticket-alt" style="color: #f472b6;"></i> ${this.escapeHtml(order.snapshot_product_name)}`;
                    clickHandler = `WalletModal.showRedeemOrderDetail('${order.id}', ${order.amount}, '${order.created_at}', '${order.redeemCode || ''}')`;
                } else {
                    // Fallback for other types
                    displayName = `${order.icon || '💳'} ${order.snapshot_product_name || '交易'}`;
                    clickHandler = '';
                }

                const clickAttr = clickHandler ? `onclick="event.stopPropagation(); ${clickHandler}"` : '';
                const cursorStyle = clickHandler ? 'cursor: pointer;' : '';

                return `
                    <div class="order-item" ${clickAttr} style="${cursorStyle}">
                        <div class="order-main">
                            <div class="order-product">${displayName}</div>
                            <div class="order-meta">
                                <span class="order-date">${dateStr}</span>
                            </div>
                        </div>
                        <div class="order-right">
                            <div class="order-cost ${amountClass}">${amountDisplay}</div>
                            <div class="order-status ${statusClass}">${statusText}</div>
                        </div>
                    </div>
                `;
            }).join('');
        },

        /**
         * Show prompt unlock order detail modal (Same style as shop order detail)
         */
        showPromptOrderDetail(orderId, promptName, price, createdAt, promptId) {
            const date = new Date(createdAt);
            const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

            // Create modal overlay using same classes as shop order detail
            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            detailOverlay.innerHTML = `
                <div class="wallet-order-modal">
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            💡 ${window.i18n?.t('wallet.orderDetails') || '订单详情'}
                        </div>
                        <button class="wallet-order-close-btn" onclick="this.closest('.wallet-order-modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="wallet-order-modal-body">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono" onclick="WalletModal.copyToClipboard('${orderId}', event)" style="cursor:pointer;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${orderId.substring(0, 8)}...${orderId.slice(-4)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.productType') || '商品类型'}</span>
                                <span class="detail-val" style="color: #fbbf24;">${window.i18n?.t('wallet.prompt') || '提示词'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.productName') || '商品名称'}</span>
                                <span class="detail-val">${promptName}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderTime') || '下单时间'}</span>
                                <span class="detail-val">${dateStr}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.pointsPaid') || '支付积分'}</span>
                                <span class="detail-val highlight">-${price} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.status') || '状态'}</span>
                                <span class="detail-val" style="color: #10b981;">✓ ${window.i18n?.t('wallet.completed') || '已完成'}</span>
                            </div>
                        </div>
                        ${promptId ? `
                        <div class="modal-actions">
                            <button class="action-btn primary" onclick="window.location.href='prompts.html?id=${promptId}'">
                                <i class="fas fa-eye"></i> ${window.i18n?.t('wallet.viewPrompt') || '查看提示词'}
                            </button>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;

            document.body.appendChild(detailOverlay);
        },

        /**
         * Show redeem code order detail modal
         */
        showRedeemOrderDetail(orderId, amount, createdAt, redeemCode) {
            const date = new Date(createdAt);
            const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

            // Create modal overlay
            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            detailOverlay.innerHTML = `
                <div class="wallet-order-modal">
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            🎫 ${window.i18n?.t('wallet.redeemDetails') || '兑换详情'}
                        </div>
                        <button class="wallet-order-close-btn" onclick="this.closest('.wallet-order-modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="wallet-order-modal-body">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono" onclick="WalletModal.copyToClipboard('${orderId}', event)" style="cursor:pointer;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${orderId.substring(0, 8)}...${orderId.slice(-4)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.transactionType') || '交易类型'}</span>
                                <span class="detail-val" style="color: #f472b6;">${window.i18n?.t('wallet.redeemCode') || '兑换码'}</span>
                            </div>
                            ${redeemCode ? `
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.redeemCode') || '兑换码'}</span>
                                <span class="detail-val mono" onclick="WalletModal.copyToClipboard('${redeemCode}', event)" style="cursor:pointer; color: #22c55e; font-weight: 600;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${redeemCode}</span>
                            </div>
                            ` : ''}
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.redeemTime') || '兑换时间'}</span>
                                <span class="detail-val">${dateStr}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.receivedPoints') || '获得积分'}</span>
                                <span class="detail-val" style="color: #10b981; font-weight: 600;">+${amount} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.status') || '状态'}</span>
                                <span class="detail-val" style="color: #10b981;">✓ ${window.i18n?.t('wallet.completed') || '已完成'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(detailOverlay);
        },

        showRechargeOrderDetail(orderId, amount, createdAt, reason = '', referenceId = '') {
            const date = new Date(createdAt);
            const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            const displayName = this.getRechargeDisplayName(reason);
            const normalizedAmount = Number(amount) || 0;
            const titleText = normalizedAmount >= 0
                ? (window.i18n?.t('wallet.rechargeDetails') || '充值详情')
                : (window.i18n?.t('wallet.orderDetails') || '订单详情');
            const typeLabel = normalizedAmount >= 0
                ? (window.i18n?.t('wallet.rechargeType') || '充值')
                : (window.i18n?.t('wallet.shopPurchase') || '商品');
            const pointsLabel = `${normalizedAmount >= 0 ? '+' : '-'}${Math.abs(normalizedAmount)} ${window.i18n?.t('wallet.pointsUnit') || '积分'}`;
            const amountColor = normalizedAmount >= 0 ? '#10b981' : '#f87171';
            const shortOrderId = orderId ? `${orderId.substring(0, 8)}...${orderId.slice(-4)}` : '--';
            const shortRefId = referenceId ? `${referenceId.substring(0, 10)}...${referenceId.slice(-4)}` : '--';

            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            detailOverlay.innerHTML = `
                <div class="wallet-order-modal">
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            <i class="fas ${normalizedAmount >= 0 ? 'fa-bolt' : 'fa-shopping-bag'}" style="color: ${normalizedAmount >= 0 ? '#fbbf24' : '#22c55e'};"></i> ${this.escapeHtml(titleText)}
                        </div>
                        <button class="wallet-order-close-btn" onclick="this.closest('.wallet-order-modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="wallet-order-modal-body">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono js-copy-ledger-order" style="cursor:pointer;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortOrderId)}</span>
                            </div>
                            ${referenceId ? `
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.businessRef') || '业务关联'}</span>
                                <span class="detail-val mono js-copy-ledger-ref" style="cursor:pointer;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortRefId)}</span>
                            </div>
                            ` : ''}
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.transactionType') || '交易类型'}</span>
                                <span class="detail-val" style="color: #fbbf24;">${this.escapeHtml(typeLabel)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.productName') || '商品名称'}</span>
                                <span class="detail-val">${this.escapeHtml(displayName || '--')}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderTime') || '下单时间'}</span>
                                <span class="detail-val">${this.escapeHtml(dateStr)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${normalizedAmount >= 0 ? (window.i18n?.t('wallet.receivedPoints') || '获得积分') : (window.i18n?.t('wallet.pointsPaid') || '支付积分')}</span>
                                <span class="detail-val" style="color: ${amountColor}; font-weight: 600;">${this.escapeHtml(pointsLabel)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.status') || '状态'}</span>
                                <span class="detail-val" style="color: #10b981;">✓ ${window.i18n?.t('wallet.completed') || '已完成'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(detailOverlay);

            detailOverlay.querySelector('.js-copy-ledger-order')?.addEventListener('click', (event) => {
                this.copyToClipboard(orderId, event);
            });

            if (referenceId) {
                detailOverlay.querySelector('.js-copy-ledger-ref')?.addEventListener('click', (event) => {
                    this.copyToClipboard(referenceId, event);
                });
            }
        },

        /**
         * Show Google One verify order detail modal
         */
        async showVerifyOrderDetail(orderId, referenceId, pointsPaid, createdAt, reason = '') {
            this._ensureOrderDetailStyles();

            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.id = `verify-order-detail-${orderId}`;
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            detailOverlay.innerHTML = `
                <div class="wallet-order-modal" style="display: flex; align-items: center; justify-content: center; min-height: 200px;">
                    <div style="text-align: center; color: #6b9ece;">
                        <i class="fas fa-circle-notch fa-spin" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <div style="font-size: 13px; opacity: 0.8;">${window.i18n?.t('wallet.loading') || '加载中...'}</div>
                    </div>
                </div>
            `;

            document.body.appendChild(detailOverlay);

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) {
                    detailOverlay.remove();
                    this.showToast(window.i18n?.t('security.loginRequired') || '请先登录', 'error');
                    return;
                }

                const verifyLog = await this.fetchVerifyOrderLog({
                    orderId,
                    referenceId,
                    userId: user.id,
                    site: window.SiteConfig?.site || 'cn',
                    createdAt,
                    pointsPaid,
                    reason
                });
                if (!document.getElementById(`verify-order-detail-${orderId}`)) return;

                const payload = verifyLog?.payload || {};
                const statusMeta = this.getVerifyStatusMeta(verifyLog?.status || payload?.raw_status || '');
                const taskId = String(referenceId || verifyLog?.verification_id || payload?.job_id || '').trim();
                const accountEmail = String(payload?.email || '--').trim() || '--';
                const generatedLink = String(payload?.url || '').trim();
                const errorMessage = String(payload?.error_message || '').trim();
                const orderTimeText = this.formatOrderDateTime(createdAt);
                const completedTimeText = verifyLog?.created_at ? this.formatOrderDateTime(verifyLog.created_at) : '';
                const shortOrderId = orderId ? `${orderId.substring(0, 8)}...${orderId.slice(-4)}` : '--';
                const shortTaskId = taskId ? `${taskId.substring(0, 8)}...${taskId.slice(-4)}` : '--';
                const safeLink = this.escapeHtml(generatedLink);

                const modal = detailOverlay.querySelector('.wallet-order-modal');
                if (!modal) return;

                modal.style.alignItems = 'stretch';
                modal.style.justifyContent = 'flex-start';
                modal.style.minHeight = 'auto';
                modal.style.background = '';

                modal.innerHTML = `
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            <i class="fas fa-key" style="color: #6b9ece;"></i> ${window.i18n?.t('wallet.verifyDetails') || 'Google One 订单详情'}
                        </div>
                        <button class="wallet-order-close-btn" onclick="this.closest('.wallet-order-modal-overlay').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="wallet-order-modal-body" style="animation: fadeIn 0.2s ease-out;">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono js-copy-verify-order" style="cursor:pointer;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortOrderId)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.taskNumber') || '任务编号'}</span>
                                <span class="detail-val mono js-copy-verify-task" style="cursor:pointer;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortTaskId || '--')}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.productType') || '商品类型'}</span>
                                <span class="detail-val" style="color: #6b9ece;">${window.i18n?.t('wallet.verifyServiceType') || 'Google One'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.googleAccount') || 'Google 账号'}</span>
                                <span class="detail-val js-copy-verify-email" style="cursor:${accountEmail !== '--' ? 'pointer' : 'default'};" title="${accountEmail !== '--' ? (window.i18n?.t('wallet.clickToCopy') || '点击复制') : ''}">${this.escapeHtml(accountEmail)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderTime') || '下单时间'}</span>
                                <span class="detail-val">${this.escapeHtml(orderTimeText)}</span>
                            </div>
                            ${completedTimeText ? `
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.completedAt') || '完成时间'}</span>
                                <span class="detail-val">${this.escapeHtml(completedTimeText)}</span>
                            </div>
                            ` : ''}
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.pointsPaid') || '支付积分'}</span>
                                <span class="detail-val highlight">-${Math.abs(Number(pointsPaid) || Number(verifyLog?.points_deducted) || 0)} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.status') || '状态'}</span>
                                <span class="detail-val" style="color: ${statusMeta.color};">${statusMeta.prefix ? `${statusMeta.prefix} ` : ''}${this.escapeHtml(statusMeta.text)}</span>
                            </div>
                        </div>
                        ${generatedLink ? `
                        <div class="modal-actions">
                            <button class="action-btn secondary js-copy-verify-link">
                                <i class="fas fa-copy"></i> ${window.i18n?.t('wallet.copyLink') || '复制链接'}
                            </button>
                            <button class="action-btn primary js-open-verify-link">
                                <i class="fas fa-arrow-up-right-from-square"></i> ${window.i18n?.t('wallet.openLink') || '打开链接'}
                            </button>
                        </div>
                        <div class="content-section">
                            <div class="content-section-title">${window.i18n?.t('wallet.generatedLink') || '生成链接'}</div>
                            <div class="content-card js-copy-verify-link-card" style="margin-bottom: 0 !important; cursor: pointer; transition: all 0.2s; padding: 12px 10px !important; display: flex; align-items: center; justify-content: center;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">
                                <div class="item-content-box" style="padding: 0 !important; width: 100%; background: transparent !important; border-radius: 0 !important;">
                                    <div class="item-text" style="text-align: left; font-size: 13px; line-height: 1.45; color: #7dd3fc; word-break: break-all;">${safeLink}</div>
                                </div>
                            </div>
                        </div>
                        ` : `
                        <div class="content-section">
                            <div class="content-section-title">${window.i18n?.t('wallet.generatedLink') || '生成链接'}</div>
                            <div class="content-card" style="margin-bottom: 0 !important; padding: 14px 12px !important; cursor: default;">
                                <div class="item-content-box" style="padding: 0 !important; width: 100%; background: transparent !important; border-radius: 0 !important;">
                                    <div class="item-text" style="text-align: left; font-size: 13px; line-height: 1.45; color: ${errorMessage ? '#fca5a5' : '#cbd5e1'}; word-break: break-word;">
                                        ${this.escapeHtml(errorMessage || (window.i18n?.t('wallet.linkUnavailable') || '暂未获取到链接'))}
                                    </div>
                                </div>
                            </div>
                        </div>
                        `}
                    </div>
                `;

                modal.querySelector('.js-copy-verify-order')?.addEventListener('click', (event) => {
                    this.copyToClipboard(orderId, event);
                });

                modal.querySelector('.js-copy-verify-task')?.addEventListener('click', (event) => {
                    if (!taskId) return;
                    this.copyToClipboard(taskId, event);
                });

                if (accountEmail && accountEmail !== '--') {
                    modal.querySelector('.js-copy-verify-email')?.addEventListener('click', (event) => {
                        this.copyToClipboard(accountEmail, event);
                    });
                }

                if (generatedLink) {
                    const copyLink = (event) => this.copyToClipboard(generatedLink, event);
                    modal.querySelector('.js-copy-verify-link')?.addEventListener('click', copyLink);
                    modal.querySelector('.js-copy-verify-link-card')?.addEventListener('click', copyLink);
                    modal.querySelector('.js-open-verify-link')?.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        window.open(generatedLink, '_blank', 'noopener,noreferrer');
                    });
                }
            } catch (err) {
                console.error('[WalletModal] Show verify order detail failed:', err);
                if (document.getElementById(`verify-order-detail-${orderId}`)) {
                    detailOverlay.remove();
                }
                this.showToast(window.i18n?.t('wallet.verifyDetailFailed') || '加载 Google One 订单详情失败', 'error');
            }
        },

        /**
         * Show order detail with purchased content
         */
        /**
         * Show order detail with purchased content (Premium Dark Glass UI)
         * 🚀 OPTIMIZED: Skeleton screen shows instantly, data loads in background
         */
        async showOrderDetail(orderId) {
            // 🚀 STEP 1: Inject styles immediately (only once)
            this._ensureOrderDetailStyles();

            // 🚀 STEP 2: Show skeleton modal INSTANTLY (no await)
            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.id = `order-detail-${orderId}`;
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            // Skeleton HTML - shows immediately with loading animation
            const t = (key, fallback) => window.i18n?.t(key) || fallback;
            detailOverlay.innerHTML = `
                <div class="wallet-order-modal" style="display: flex; align-items: center; justify-content: center; min-height: 200px;">
                    <div style="text-align: center; color: #6b9ece;">
                        <i class="fas fa-circle-notch fa-spin" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <div style="font-size: 13px; opacity: 0.8;">${t('wallet.loading', '加载详情...')}</div>
                    </div>
                </div>
            `;

            // 🚀 Append skeleton immediately - user sees modal in ~0ms
            document.body.appendChild(detailOverlay);

            // 🚀 STEP 3: Load data in background
            try {
                const [orderResult, orderItemsResult] = await Promise.all([
                    supabase.from('shop_orders').select('*').eq('id', orderId).single(),
                    supabase.from('shop_order_items').select(`
                        id, snapshot_product_name, price_paid,
                        shop_inventory ( content )
                    `).eq('order_id', orderId)
                ]);

                const { data: order, error } = orderResult;
                const { data: orderItems, error: itemsError } = orderItemsResult;

                // Check if modal was closed while loading
                if (!document.getElementById(`order-detail-${orderId}`)) return;

                if (error) throw error;
                if (!order) {
                    detailOverlay.remove();
                    this.showToast(window.i18n?.t('wallet.orderNotFound') || '订单不存在', 'error');
                    return;
                }

                // Process items
                let items = [];
                if (orderItems && orderItems.length > 0) {
                    items = orderItems.map(item => ({
                        name: item.snapshot_product_name,
                        content: item.shop_inventory?.content || (window.i18n?.t('wallet.contentLoadFailed') || '内容加载失败'),
                        price: item.price_paid
                    }));
                } else if (order.inventory_id) {
                    const { data: inventory } = await supabase
                        .from('shop_inventory').select('content').eq('id', order.inventory_id).single();
                    items.push({
                        name: order.snapshot_product_name,
                        content: inventory?.content || (window.i18n?.t('wallet.contentLoadFailed') || '内容加载失败'),
                        price: order.price_paid
                    });
                }

                const date = new Date(order.created_at);
                const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
                const totalPrice = order.total_price != null ? order.total_price : order.price_paid;

                // Determine if items are short enough to display side-by-side
                const isShortKeys = items.every(item => item.content.length <= 40 && !item.content.includes('\n'));
                const gridStyle = items.length > 1 && isShortKeys
                    ? 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;'
                    : 'display: flex; flex-direction: column; gap: 8px; width: 100%;';

                const contentHtml = `<div style="${gridStyle}">` + items.map((item) => {
                    const safeContentEscaped = this.escapeHtml(item.content).replace(/`/g, '\\`');
                    return `
                    <div class="content-card" style="margin-bottom: 0 !important; cursor: pointer; transition: all 0.2s; padding: 10px 6px !important; display: flex; align-items: center; justify-content: center;" onclick="WalletModal.copyToClipboard(\`${safeContentEscaped}\`, event)" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}" onmouseover="this.style.borderColor='rgba(107, 158, 206, 0.5)'; this.style.background='rgba(255, 255, 255, 0.08)';" onmouseout="this.style.borderColor='rgba(255, 255, 255, 0.1)'; this.style.background='rgba(255, 255, 255, 0.05)';">
                        <div class="item-content-box" style="padding: 0 !important; width: 100%; background: transparent !important; border-radius: 0 !important;">
                            <div class="item-text" style="text-align: center; font-size: 13px; letter-spacing: 0.5px; line-height: 1.3;">${this.escapeHtml(item.content)}</div>
                        </div>
                    </div>
                `;
                }).join('') + `</div>`;

                // Format: product name once at top, then all content items
                const productName = items.length > 0 ? items[0].name : '';
                const allContentItems = items.map(i => i.content).join('\n');
                const allContent = productName ? `${productName}:\n${allContentItems}` : allContentItems;
                const orderNumberLabel = window.i18n?.t('wallet.orderNumber') || '订单编号';
                const orderTimeLabel = window.i18n?.t('wallet.orderTime') || '下单时间';
                window.WalletModal_export = () => {
                    const blob = new Blob([`${orderNumberLabel}: ${order.id}\n${orderTimeLabel}: ${dateStr}\n\n${allContent}`], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `order_${order.id.split('-')[0]}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                };
                window.WalletModal_copyAll = () => {
                    navigator.clipboard.writeText(allContent).then(() => {
                        this.showToast(`✅ ${window.i18n?.t('wallet.copiedAll') || '已复制全部内容'}`, 'success');
                    }).catch(() => this.showToast(window.i18n?.t('wallet.copyFailed') || '复制失败', 'error'));
                };

                // 🚀 STEP 4: Replace skeleton with real content (smooth transition)
                const modal = detailOverlay.querySelector('.wallet-order-modal');
                if (modal) {
                    // Reset loading styles
                    modal.style.alignItems = 'stretch';
                    modal.style.justifyContent = 'flex-start';
                    modal.style.minHeight = 'auto';
                    modal.style.background = ''; // Revert to CSS class styling

                    modal.innerHTML = `
                        <div class="wallet-order-modal-header">
                            <div class="wallet-order-modal-title">
                                <i class="fas fa-box-open" style="color: #6b9ece;"></i> ${window.i18n?.t('wallet.orderDetails') || '订单详情'}
                            </div>
                            <button class="wallet-order-close-btn" onclick="this.closest('.wallet-order-modal-overlay').remove()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="wallet-order-modal-body" style="animation: fadeIn 0.2s ease-out;">
                            <div class="meta-section">
                                <div class="detail-row">
                                    <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                    <span class="detail-val mono" onclick="WalletModal.copyToClipboard('${order.id}', event)" style="cursor:pointer;" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${order.id.split('-')[0]}...${order.id.slice(-4)}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">${window.i18n?.t('wallet.orderTime') || '下单时间'}</span>
                                    <span class="detail-val">${dateStr}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">${window.i18n?.t('wallet.pointsPaid') || '支付积分'}</span>
                                    <span class="detail-val highlight">-${totalPrice} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                                </div>
                            </div>
                            <div class="modal-actions" style="display: flex; gap: 8px; justify-content: flex-end; padding: 4px 0; margin-top: -8px;">
                                <button class="action-btn-minimal" style="background: transparent; border: none; color: #6b9ece; font-size: 18px; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center;" onmouseover="this.style.background='rgba(107, 158, 206, 0.15)';" onmouseout="this.style.background='transparent';" onclick="WalletModal_copyAll()" title="${window.i18n?.t('wallet.copyAll') || '全部复制'}">
                                    <i class="fas fa-copy"></i>
                                </button>
                                <button class="action-btn-minimal" style="background: transparent; border: none; color: #9ca3af; font-size: 18px; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center;" onmouseover="this.style.background='rgba(255, 255, 255, 0.1)';" onmouseout="this.style.background='transparent';" onclick="WalletModal_export()" title="${window.i18n?.t('wallet.export') || '导出'}">
                                    <i class="fas fa-download"></i>
                                </button>
                                <button class="action-btn-minimal" style="background: transparent; border: none; color: #ef4444; font-size: 18px; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center;" onmouseover="this.style.background='rgba(239, 68, 68, 0.15)';" onmouseout="this.style.background='transparent';" onclick="WalletModal.openTicketModal('${order.id}')" title="${window.i18n?.t('wallet.reportIssue') || '报告问题'}">
                                    <i class="fas fa-exclamation-circle"></i>
                                </button>
                            </div>
                            <div class="content-section">
                                <div class="content-section-title">${window.i18n?.t('wallet.purchaseContent') || '购买内容'} (${items.length}) <span class="product-dot" data-tooltip="${items.length > 0 ? items[0].name.replace(/"/g, '&quot;') : ''}" style="width:8px;height:8px;background:#6b9ece;border-radius:50%;display:inline-block;margin-left:8px;cursor:pointer;transition:all 0.2s ease;position:relative;"></span></div>
                                ${contentHtml}
                            </div>
                        </div>
                    `;
                }
            } catch (err) {
                console.error('[WalletModal] Show order detail failed:', err);
                // Remove skeleton and show error
                if (document.getElementById(`order-detail-${orderId}`)) {
                    detailOverlay.remove();
                }
                this.showToast(window.i18n?.t('wallet.orderDetailFailed') || '加载订单详情失败', 'error');
            }
        },

        openTicketModal(orderId) {
            const reason = prompt(window.i18n?.t('wallet.ticketPrompt') || "请输入您遇到的问题描述 (如：卡密无效、未到账等)：");
            if (!reason || reason.trim() === '') return;

            this.submitTicket(orderId, reason.trim());
        },

        async submitTicket(orderId, description) {
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) throw new Error("未登录");

                const { error } = await window.supabaseClient.from('shop_tickets').insert({
                    user_id: user.id,
                    order_id: orderId,
                    issue_type: 'OTHER',
                    description: description
                });

                if (error) throw error;
                this.showToast(window.i18n?.t('wallet.ticketSuccess') || "工单提交成功，客服将尽快核实处理。", "success");
            } catch (err) {
                console.error("[WalletModal] Submit ticket failed:", err);
                this.showToast((window.i18n?.t('wallet.ticketFailed') || "工单提交失败") + ": " + err.message, "error");
            }
        },

        /**
         * Ensure order detail styles are injected (skeleton + premium styles)
         */
        _ensureOrderDetailStyles() {
            const styleId = 'order-detail-premium-style';
            if (document.getElementById(styleId)) return;

            const style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = `
                /* Skeleton Loading Animation */
                @keyframes skeletonPulse {
                    0%, 100% { opacity: 0.4; }
                    50% { opacity: 0.7; }
                }
                .skeleton-text {
                    display: inline-block;
                    height: 14px;
                    background: linear-gradient(90deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.1) 100%);
                    background-size: 200% 100%;
                    border-radius: 6px;
                    animation: skeletonPulse 1.5s ease-in-out infinite;
                }
                .skeleton-card {
                    animation: skeletonPulse 1.5s ease-in-out infinite;
                }
                .skeleton-btn {
                    opacity: 0.5 !important;
                    cursor: not-allowed !important;
                }
                
                /* Modal Styles */
                .wallet-order-modal-overlay {
                    position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important;
                    background: var(--auth-sheet-overlay, rgba(7, 9, 12, 0.28)) !important;
                    backdrop-filter: var(--auth-sheet-overlay-filter, blur(14px) saturate(108%)) !important;
                    -webkit-backdrop-filter: var(--auth-sheet-overlay-filter, blur(14px) saturate(108%)) !important;
                    z-index: 200000 !important;
                    display: flex !important; justify-content: center !important; align-items: center !important;
                    animation: fadeIn 0.3s ease-out;
                }
                .wallet-order-modal {
                    width: 92% !important; max-width: 360px !important;
                    background: var(--auth-sheet-panel, rgba(12, 14, 18, 0.98)) !important;
                    border: 1px solid var(--auth-sheet-border, rgba(255, 255, 255, 0.08)) !important;
                    border-radius: 22px !important;
                    box-shadow: 0 26px 70px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
                    overflow: hidden !important;
                    display: flex !important; flex-direction: column !important;
                    max-height: 85vh !important;
                    color: var(--auth-sheet-text, #f2f5f8) !important;
                    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    opacity: 1;
                    position: relative !important;
                    isolation: isolate !important;
                }
                .wallet-order-modal::before {
                    content: '' !important;
                    position: absolute !important;
                    inset: 0 !important;
                    z-index: 0 !important;
                    pointer-events: none !important;
                    border-radius: inherit !important;
                    background: none !important;
                }
                .wallet-order-modal > * {
                    position: relative !important;
                    z-index: 1 !important;
                }
                .wallet-order-modal-header {
                    padding: 16px 20px 12px;
                    border-bottom: 1px solid var(--auth-sheet-border, rgba(255, 255, 255, 0.08));
                    background: transparent;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .wallet-order-modal-title {
                    font-size: 16px; font-weight: 700; color: var(--auth-sheet-text, #f2f5f8);
                    display: flex; align-items: center; gap: 8px;
                    letter-spacing: -0.5px;
                }
                .wallet-order-close-btn {
                    width: 28px; height: 28px;
                    border-radius: 50%;
                    border: 1px solid var(--auth-sheet-border, rgba(255, 255, 255, 0.08));
                    background: rgba(255, 255, 255, 0.05);
                    color: var(--auth-sheet-muted, rgba(231, 236, 242, 0.62));
                    cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s;
                    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
                }
                .wallet-order-close-btn:hover {
                    background: rgba(255, 255, 255, 0.09);
                    border-color: rgba(255, 255, 255, 0.14);
                    color: var(--auth-sheet-text, #f2f5f8);
                }
                .wallet-order-modal-body {
                    padding: 0 16px 12px;
                    overflow-y: auto;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
                }
                /* Webkit scrollbar for modal body */
                .wallet-order-modal-body::-webkit-scrollbar {
                    width: 4px;
                }
                .wallet-order-modal-body::-webkit-scrollbar-track {
                    background: transparent;
                    border-radius: 10px;
                }
                .wallet-order-modal-body::-webkit-scrollbar-thumb {
                    background-color: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .wallet-order-modal-body::-webkit-scrollbar-thumb:hover {
                    background-color: rgba(255, 255, 255, 0.2);
                }
                .meta-section { margin-bottom: 12px; padding-top: 10px; }
                .detail-row {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 10px; font-size: 13px;
                }
                .detail-label { color: rgba(255, 255, 255, 0.4); }
                .detail-val { color: rgba(255, 255, 255, 0.9); font-weight: 500; font-family: 'Outfit', sans-serif;}
                .detail-val.mono { font-family: monospace; letter-spacing: 0.5px; opacity: 0.8; }
                .detail-val.highlight { color: #f87171; font-weight: 700; }
                .modal-actions { display: flex; gap: 10px; margin-bottom: 20px; }
                .action-btn.primary {
                    flex: 1;
                    background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
                    color: #052e16;
                    border: none; padding: 10px; border-radius: 50px;
                    font-weight: 600; font-size: 13px; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; gap: 6px;
                    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
                    transition: all 0.2s;
                }
                .action-btn.primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(34, 197, 94, 0.4);
                    filter: brightness(1.05);
                }
                .action-btn.secondary {
                    flex: 1;
                    background: rgba(255, 255, 255, 0.05);
                    color: rgba(255, 255, 255, 0.8);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    padding: 10px; border-radius: 50px;
                    font-weight: 500; font-size: 13px; cursor: pointer;
                    display: flex; align-items: center; justify-content: center; gap: 6px;
                    transition: all 0.2s;
                }
                .action-btn.secondary:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }
                .content-section {
                    margin-top: 0 !important;
                    margin-bottom: 4px !important;
                    padding: 0 !important;
                    max-width: none !important;
                }
                .content-section-title {
                    font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.3);
                    margin-bottom: 8px; text-align: center;
                }
                .content-card {
                    background: rgba(255, 255, 255, 0.05) !important;
                    backdrop-filter: blur(12px) !important;
                    -webkit-backdrop-filter: blur(12px) !important;
                    border-radius: 10px !important; padding: 12px !important;
                    margin-bottom: 8px !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2) !important;
                }
                .item-name {
                    font-size: 13px; font-weight: 600; color: #e2e8f0;
                    margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
                }
                .item-content-box {
                    background: transparent !important;
                    border-radius: 0 !important;
                    padding: 0 !important;
                }
                .item-text {
                    font-family: 'Monaco', monospace;
                    font-size: 12px; color: #10b981;
                    word-break: break-all; line-height: 1.5; opacity: 0.9;
                }
                .product-dot:hover {
                    transform: scale(1.4);
                    box-shadow: 0 0 8px 3px rgba(107, 158, 206, 0.6);
                    background: #8bb8e8 !important;
                }
                .product-dot::after {
                    content: attr(data-tooltip);
                    position: absolute;
                    bottom: 150%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(20, 20, 22, 0.95);
                    color: #fff;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 12px;
                    white-space: nowrap;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.2s ease;
                    pointer-events: none;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                }
                .product-dot:hover::after {
                    opacity: 1;
                    visibility: visible;
                }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
            `;
            document.head.appendChild(style);
        },

        /**
         * Escape HTML to prevent XSS
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        /**
         * Copy order content to clipboard
         */
        copyOrderContent(element) {
            const content = element.textContent;
            navigator.clipboard.writeText(content).then(() => {
                this.showToast('✅ 内容已复制', 'success');
            }).catch(() => {
                this.showToast('复制失败，请手动复制', 'error');
            });
        }
    };

    // Export to window
    window.WalletModal = WalletModal;

    // Listen to global language change
    window.addEventListener('languageChanged', () => {
        // Remember the current active view so we can restore it
        const activeView = document.querySelector('.wallet-menu-item.active')?.dataset?.view || 'balance';

        // Destroy the cached overlay so render() rebuilds it with new language
        const oldOverlay = document.getElementById('wallet-modal-overlay');
        if (oldOverlay) {
            detachWalletModalViewportHandlers();
            oldOverlay.remove();
        }
        WalletModal.modalEl = null;

        if (WalletModal.isOpen) {
            console.log('[WalletModal] Language changed, rebuilding UI');
            // Rebuild the entire modal HTML with new language
            WalletModal.render();
            prepareWalletModalOpenState();
            // Restore the previously active view
            WalletModal.switchView(activeView);
            // Reload data (packages, balance, orders) with new language
            WalletModal.ordersLoaded = false;
            WalletModal.loadData().catch(e => console.error(e));
        }
    });

    console.log('[WalletModal] ✅ Ready');
})();
