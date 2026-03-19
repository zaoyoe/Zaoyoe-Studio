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
    const walletCssHref = 'css/wallet.css?v=20260318_WALLET_AFFILIATE_POSTER_11';
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
        affiliateStats: null,
        affiliatePosterConfig: null,
        checkinConfig: null,
        rechargeOptionsConfig: null,

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

            if (rawReason === 'daily_checkin') {
                return window.i18n?.t('wallet.dailyCheckin') || '每日签到';
            }

            if (rawReason === 'makeup_checkin_cost') {
                return '补签扣分';
            }

            if (rawReason === 'signup_bonus') {
                return '注册奖励';
            }

            if (rawReason === 'custom_recharge') {
                return '自定义充值';
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

        normalizePointValue(value, fallback = 0) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
        },

        formatPoints(value) {
            const normalized = this.normalizePointValue(value, 0);
            const hasDecimal = Math.abs(normalized % 1) > 0.0001;
            return normalized.toLocaleString(undefined, {
                minimumFractionDigits: hasDecimal ? 1 : 0,
                maximumFractionDigits: 1
            });
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
            this.ordersData = [];
            this.browseOrdersSnapshot = [];
            this.orderRequestId += 1;
            this.resetOrderSearchState();
            this.resetAffiliateState();

            if (isWalletModalIOSMode()) {
                freezeWalletModalPage();
            }

            // Render UI immediately so there's zero delay for the user
            this.render();
            this.resetOrderFilters();
            this.syncOrderSearchUi();
            const ordersContainer = document.getElementById('wallet-orders');
            if (ordersContainer) {
                ordersContainer.innerHTML = `<div class="loading-text">${window.i18n?.t('common.loading') || '加载中...'}</div>`;
            }
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
            this.ordersLoading = false;
            this.orderRequestId += 1;
            this.resetOrderSearchState();
            this.resetAffiliateState();
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
                this.syncOrderSearchUi();
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

                                <div class="custom-recharge-section" id="wallet-custom-recharge-section" style="display:none;">
                                    <div class="custom-recharge-header">
                                        <div>
                                            <div class="custom-recharge-title">自定义充值</div>
                                            <div class="custom-recharge-subtitle">输入要充值的积分数量，支持 0.1 精度。</div>
                                        </div>
                                        <span class="custom-recharge-badge">按需充值</span>
                                    </div>
                                    <div class="custom-recharge-row">
                                        <input type="number"
                                               id="wallet-custom-recharge-input"
                                               class="custom-recharge-input"
                                               min="0.1"
                                               step="0.1"
                                               inputmode="decimal"
                                               placeholder="例如 100 或 0.1"
                                               onkeyup="if(event.key==='Enter') WalletModal.customRecharge()" />
                                        <button class="custom-recharge-btn" id="wallet-custom-recharge-btn" onclick="WalletModal.customRecharge()">立即充值</button>
                                    </div>
                                    <div class="custom-recharge-meta">该入口由管理员在后台控制显示，用于用户自行决定本次充值的积分数量。</div>
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
                                    <div class="history-search" role="search">
                                        <i class="fas fa-search history-search-icon" aria-hidden="true"></i>
                                        <input
                                            type="search"
                                            id="wallet-order-search-input"
                                            class="history-search-input"
                                            placeholder="${window.i18n?.t('wallet.searchPlaceholder') || '搜索订单号 / 任务号 / 兑换码 / 商品名 / 认证邮箱 / 积分数量'}"
                                            autocomplete="off"
                                            spellcheck="false"
                                            oninput="WalletModal.handleOrderSearchInput(event)"
                                            onkeydown="WalletModal.handleOrderSearchKeydown(event)"
                                        />
                                        <button
                                            type="button"
                                            class="history-search-clear"
                                            id="wallet-order-search-clear"
                                            onclick="WalletModal.clearOrderSearch(event)"
                                            title="${window.i18n?.t('wallet.clearSearch') || '清除搜索'}"
                                        >
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
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
                                        <h3 style="margin:0 0 8px 0; color:#fff; font-size:16px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                                            <span style="display:flex; align-items:center; gap:8px;">
                                                <i class="fas fa-link" style="color:#10b981;"></i> ${window.i18n?.t('wallet.getInviteLink') || '获取专属推广链接'}
                                            </span>
                                            <span class="affiliate-reward-guide" id="affiliate-reward-guide">奖励说明</span>
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
                                        <i class="fas fa-image"></i> ${window.i18n?.t('wallet.generatePoster') || '生成海报'}
                                        <span class="affiliate-poster-template-name" id="affiliate-poster-template-name">默认模板</span>
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

        resetAffiliateState() {
            this.affiliateLoaded = false;
            this.currentInviteCode = '';
            this.affiliateStats = null;
            this.affiliatePosterConfig = null;
            this.affiliateProfile = null;
        },

        getDefaultCheckinConfig() {
            return {
                base_points: 5,
                consecutive_7_points: 50,
                perfect_month_points: 200,
                makeup_cost_points: 10
            };
        },

        normalizeCheckinConfig(raw) {
            const defaults = this.getDefaultCheckinConfig();
            const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

            return {
                base_points: Math.max(0, this.normalizePointValue(source.base_points, defaults.base_points)),
                consecutive_7_points: Math.max(0, this.normalizePointValue(source.consecutive_7_points, defaults.consecutive_7_points)),
                perfect_month_points: Math.max(0, this.normalizePointValue(source.perfect_month_points, defaults.perfect_month_points)),
                makeup_cost_points: Math.max(0, this.normalizePointValue(source.makeup_cost_points, defaults.makeup_cost_points))
            };
        },

        async loadCheckinConfig(forceRefresh = false) {
            if (!forceRefresh && this.checkinConfig) {
                return this.checkinConfig;
            }

            try {
                const { data, error } = await window.supabaseClient.rpc('get_system_config', {
                    p_key: 'checkin_system'
                });

                if (error) throw error;

                this.checkinConfig = this.normalizeCheckinConfig(data);
            } catch (configError) {
                console.warn('[WalletModal] Failed to load check-in config:', configError);
                this.checkinConfig = this.getDefaultCheckinConfig();
            }

            return this.checkinConfig;
        },

        getDefaultRechargeOptionsConfig() {
            return {
                custom_amount_enabled: false
            };
        },

        normalizeRechargeOptionsConfig(raw) {
            const defaults = this.getDefaultRechargeOptionsConfig();
            const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

            return {
                custom_amount_enabled: source.custom_amount_enabled === true || String(source.custom_amount_enabled) === 'true'
                    ? true
                    : defaults.custom_amount_enabled
            };
        },

        async loadRechargeOptionsConfig(forceRefresh = false) {
            if (!forceRefresh && this.rechargeOptionsConfig) {
                return this.rechargeOptionsConfig;
            }

            try {
                const { data, error } = await window.supabaseClient.rpc('get_system_config', {
                    p_key: 'recharge_options'
                });

                if (error) throw error;

                this.rechargeOptionsConfig = this.normalizeRechargeOptionsConfig(data);
            } catch (configError) {
                console.warn('[WalletModal] Failed to load recharge options config:', configError);
                this.rechargeOptionsConfig = this.getDefaultRechargeOptionsConfig();
            }

            return this.rechargeOptionsConfig;
        },

        renderCustomRechargeSection(config = this.rechargeOptionsConfig) {
            const section = document.getElementById('wallet-custom-recharge-section');
            const input = document.getElementById('wallet-custom-recharge-input');
            const button = document.getElementById('wallet-custom-recharge-btn');
            if (!section) return;

            const normalizedConfig = this.normalizeRechargeOptionsConfig(config);
            const isEnabled = normalizedConfig.custom_amount_enabled;

            section.style.display = isEnabled ? '' : 'none';

            if (input) {
                input.disabled = !isEnabled;
                if (!isEnabled) input.value = '';
            }

            if (button) {
                button.disabled = !isEnabled;
            }

            requestWalletRechargeScrollCueUpdate();
        },

        getDefaultAffiliatePosterConfig() {
            return {
                chip_label: window.i18n?.t('wallet.affiliate') || '推广',
                title: window.i18n?.t('wallet.posterTitle') || '专属邀请函',
                subtitle: window.i18n?.t('wallet.posterSubtitle') || '扫码注册 · 即享专属奖励',
                reward_badge_text: '',
                invite_code_label: window.i18n?.t('wallet.inviteCode') || '邀请码',
                qr_label: window.i18n?.t('wallet.posterScan') || '扫码注册领取新人福利',
                footer: window.i18n?.t('wallet.posterJoin') || '邀请好友注册，享受固定奖励与持续返佣',
                active_template_id: 'midnight',
                templates: [
                    {
                        id: 'midnight',
                        name: '星幕邀请函',
                        description: '深色高级感，适合作为默认分享海报。',
                        custom_background_url: ''
                    },
                    {
                        id: 'sunset',
                        name: '暖金品牌卡',
                        description: '暖色氛围更强，适合活动档期与节庆传播。',
                        custom_background_url: ''
                    },
                    {
                        id: 'crystal',
                        name: '清透极简版',
                        description: '浅色留白更多，适合搭配自定义品牌底图。',
                        custom_background_url: ''
                    }
                ]
            };
        },

        normalizeAffiliatePosterConfig(raw) {
            const defaults = this.getDefaultAffiliatePosterConfig();
            const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
            const sourceTemplates = Array.isArray(source.templates) ? source.templates : [];

            const templates = defaults.templates.map(defaultTemplate => {
                const matched = sourceTemplates.find(template => template && template.id === defaultTemplate.id) || {};
                return {
                    ...defaultTemplate,
                    custom_background_url: typeof matched.custom_background_url === 'string'
                        ? matched.custom_background_url.trim()
                        : ''
                };
            });

            const activeTemplateId = templates.some(template => template.id === source.active_template_id)
                ? source.active_template_id
                : defaults.active_template_id;

            return {
                chip_label: typeof source.chip_label === 'string' && source.chip_label.trim() ? source.chip_label.trim() : defaults.chip_label,
                title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : defaults.title,
                subtitle: typeof source.subtitle === 'string' && source.subtitle.trim() ? source.subtitle.trim() : defaults.subtitle,
                reward_badge_text: typeof source.reward_badge_text === 'string' ? source.reward_badge_text.trim() : defaults.reward_badge_text,
                invite_code_label: typeof source.invite_code_label === 'string' && source.invite_code_label.trim() ? source.invite_code_label.trim() : defaults.invite_code_label,
                qr_label: typeof source.qr_label === 'string' && source.qr_label.trim() ? source.qr_label.trim() : defaults.qr_label,
                footer: typeof source.footer === 'string' && source.footer.trim() ? source.footer.trim() : defaults.footer,
                active_template_id: activeTemplateId,
                templates
            };
        },

        getAffiliatePosterPreset(templateId) {
            const presets = {
                midnight: {
                    accent: '#10b981',
                    text: '#f8fafc',
                    muted: 'rgba(226, 232, 240, 0.82)',
                    badgeBg: 'rgba(16, 185, 129, 0.18)',
                    badgeText: '#dcfce7',
                    qrCardBg: 'rgba(255, 255, 255, 0.95)',
                    qrLabelColor: '#0f172a',
                    codeColor: '#86efac',
                    overlayOpacity: 0.52,
                    gradientStops: [
                        { offset: 0, color: '#020617' },
                        { offset: 0.45, color: '#0f172a' },
                        { offset: 1, color: '#134e4a' }
                    ]
                },
                sunset: {
                    accent: '#f97316',
                    text: '#fff7ed',
                    muted: 'rgba(255, 237, 213, 0.86)',
                    badgeBg: 'rgba(251, 146, 60, 0.18)',
                    badgeText: '#ffedd5',
                    qrCardBg: 'rgba(255, 251, 235, 0.96)',
                    qrLabelColor: '#7c2d12',
                    codeColor: '#fde68a',
                    overlayOpacity: 0.42,
                    gradientStops: [
                        { offset: 0, color: '#431407' },
                        { offset: 0.4, color: '#9a3412' },
                        { offset: 1, color: '#f59e0b' }
                    ]
                },
                crystal: {
                    accent: '#2563eb',
                    text: '#0f172a',
                    muted: 'rgba(15, 23, 42, 0.68)',
                    badgeBg: 'rgba(37, 99, 235, 0.12)',
                    badgeText: '#1d4ed8',
                    qrCardBg: 'rgba(255, 255, 255, 0.96)',
                    qrLabelColor: '#1e293b',
                    codeColor: '#1d4ed8',
                    overlayOpacity: 0.2,
                    gradientStops: [
                        { offset: 0, color: '#eff6ff' },
                        { offset: 0.45, color: '#dbeafe' },
                        { offset: 1, color: '#f8fafc' }
                    ]
                }
            };

            return presets[templateId] || presets.midnight;
        },

        formatAffiliatePercent(value, digits = 0) {
            const parsed = Number(value);
            const safe = Number.isFinite(parsed) ? parsed : 0;
            return `${(safe * 100).toFixed(digits)}%`;
        },

        getCachedUserProfile() {
            try {
                const cached = localStorage.getItem('cached_user_profile');
                if (!cached) return {};
                const parsed = JSON.parse(cached);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (error) {
                console.warn('[WalletModal] Failed to parse cached user profile:', error);
                return {};
            }
        },

        getProfileDisplayName(profile = {}, user = {}) {
            const candidates = [
                profile.display_name,
                profile.username,
                profile.nickname,
                user.user_metadata?.display_name,
                user.user_metadata?.full_name,
                user.user_metadata?.name,
                user.user_metadata?.user_name,
                user.email ? user.email.split('@')[0] : ''
            ];

            const matched = candidates.find(value => typeof value === 'string' && value.trim());
            return matched ? matched.trim() : 'U';
        },

        getProfileAvatarUrl(profile = {}, user = {}) {
            const candidates = [
                profile.avatar_url,
                profile.avatarUrl,
                user.user_metadata?.avatar_url,
                user.user_metadata?.avatarUrl,
                user.user_metadata?.picture
            ];

            const matched = candidates.find(value => typeof value === 'string' && value.trim());
            return matched ? matched.trim() : '';
        },

        getPosterInitial(name = '') {
            const safeName = String(name || '').trim();
            return safeName ? safeName.charAt(0).toUpperCase() : 'U';
        },

        getPosterRewardBadgeText(stats = this.affiliateStats || {}, posterConfig = this.affiliatePosterConfig || {}) {
            const registrationRewardPoints = Number(stats.registration_reward_points);
            const safeRegistrationRewardPoints = Number.isFinite(registrationRewardPoints) ? registrationRewardPoints : 0;
            const commissionRateShop = Number(stats.commission_rate_shop);
            const safeCommissionRateShop = Number.isFinite(commissionRateShop) ? commissionRateShop : 0.10;
            const customTemplate = typeof posterConfig.reward_badge_text === 'string' ? posterConfig.reward_badge_text.trim() : '';

            if (!customTemplate) {
                return [
                    safeRegistrationRewardPoints > 0 ? `拉新奖励 ${this.formatPoints(safeRegistrationRewardPoints)} 积分` : '',
                    `商城返佣 ${this.formatAffiliatePercent(safeCommissionRateShop)}`
                ].filter(Boolean).join(' · ');
            }

            return customTemplate
                .replace(/\{registration_reward_text\}/g, safeRegistrationRewardPoints > 0 ? `${this.formatPoints(safeRegistrationRewardPoints)} 积分` : '未开启')
                .replace(/\{registration_reward\}/g, this.formatPoints(safeRegistrationRewardPoints))
                .replace(/\{shop_commission\}/g, this.formatAffiliatePercent(safeCommissionRateShop))
                .replace(/\{shop_commission_rate\}/g, this.formatAffiliatePercent(safeCommissionRateShop))
                .replace(/\s+/g, ' ')
                .trim();
        },

        getAffiliateRewardExplanation(stats = this.affiliateStats || {}) {
            const commissionRateShop = Number(stats.commission_rate_shop);
            const safeCommissionRateShop = Number.isFinite(commissionRateShop) ? commissionRateShop : 0.10;
            const commissionRateAgent = Number(stats.commission_rate_agent);
            const safeCommissionRateAgent = Number.isFinite(commissionRateAgent) ? commissionRateAgent : 0.10;
            const registrationReward = Number(stats.registration_reward_points);
            const safeRegistrationReward = Number.isFinite(registrationReward) ? registrationReward : 0;
            const requiresPurchase = stats.registration_reward_requires_purchase !== false && String(stats.registration_reward_requires_purchase) !== 'false';
            const rewardNotice = typeof stats.reward_notice === 'string' && stats.reward_notice.trim()
                ? stats.reward_notice.trim()
                : '奖励按平台风控规则自动结算，异常账号、作弊注册与退款订单不计入奖励。';
            const legalDisclaimer = typeof stats.legal_disclaimer === 'string' && stats.legal_disclaimer.trim()
                ? stats.legal_disclaimer.trim()
                : '活动最终解释权归平台所有';

            const lines = [
                `固定拉新奖励：${safeRegistrationReward > 0 ? `${this.formatPoints(safeRegistrationReward)} 积分` : '当前未开启'}`,
                `触发条件：好友${requiresPurchase ? '完成首笔充值或消费后激活' : '完成注册后立即发放'}`,
                `商城消费返佣：${this.formatAffiliatePercent(safeCommissionRateShop)}`,
                `分销资源返佣：${this.formatAffiliatePercent(safeCommissionRateAgent)}`,
                rewardNotice,
                legalDisclaimer
            ];

            return lines.join('\n');
        },

        renderAffiliateDescription(stats = this.affiliateStats || {}) {
            const descEl = document.getElementById('affiliate-desc-text');
            if (!descEl) return;

            const rewardGuideEl = document.getElementById('affiliate-reward-guide');
            const parsedCommissionRate = Number(stats.commission_rate_shop);
            const safeCommissionRate = Number.isFinite(parsedCommissionRate) ? parsedCommissionRate : 0.10;
            const parsedRegistrationReward = Number(stats.registration_reward_points);
            const safeRegistrationReward = Number.isFinite(parsedRegistrationReward) ? parsedRegistrationReward : 0;
            const requiresPurchase = stats.registration_reward_requires_purchase !== false && String(stats.registration_reward_requires_purchase) !== 'false';
            const ratePercent = `${(safeCommissionRate * 100).toFixed(0)}%`;
            const legalDisclaimer = typeof stats.legal_disclaimer === 'string' && stats.legal_disclaimer.trim()
                ? stats.legal_disclaimer.trim()
                : '活动最终解释权归平台所有';
            const rewardTriggerText = requiresPurchase ? '完成首笔充值或消费' : '完成注册';
            const guideText = this.getAffiliateRewardExplanation(stats);
            const rewardPointsText = this.formatPoints(safeRegistrationReward);

            if (rewardGuideEl) {
                rewardGuideEl.setAttribute('data-tooltip', guideText);
                rewardGuideEl.setAttribute('title', guideText);
            }

            if (safeRegistrationReward > 0) {
                descEl.innerHTML = `分享专属链接邀请新用户。当好友注册并在商城<strong>${rewardTriggerText}</strong>后，您将获得 <strong style="color:#10b981; font-weight:600;">${rewardPointsText} 积分</strong> 专属拉新奖励；此外，好友后续所有商城订单还会持续按 <strong style="color:#f59e0b; font-weight:600;">${ratePercent}</strong> 自动返佣。<span class="affiliate-legal-note">${this.escapeHtml(legalDisclaimer)}</span>`;
                return;
            }

            descEl.innerHTML = `分享下方链接给好友。当好友注册并在商城完成消费时，系统会自动将订单金额的 <strong style="color:#f59e0b; font-weight:600;">${ratePercent}</strong> 作为奖励发放至您的积分钱包。<span class="affiliate-legal-note">${this.escapeHtml(legalDisclaimer)}</span>`;
        },

        /**
         * Affiliate Logic
         */
        async loadAffiliateData() {
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) return;

                const [statsResult, programResult, posterResult] = await Promise.all([
                    window.supabaseClient.rpc('fn_get_affiliate_stats', {
                        p_user_id: user.id
                    }),
                    window.supabaseClient.rpc('get_system_config', {
                        p_key: 'affiliate_program'
                    }),
                    window.supabaseClient.rpc('get_system_config', {
                        p_key: 'affiliate_poster'
                    })
                ]);

                if (statsResult.error) throw statsResult.error;
                if (programResult.error) {
                    console.warn('[WalletModal] Affiliate program config load warning:', programResult.error);
                }
                if (posterResult.error) {
                    console.warn('[WalletModal] Poster config load warning:', posterResult.error);
                }

                if (statsResult.data) {
                    const rawStats = (statsResult.data && typeof statsResult.data === 'object' && !Array.isArray(statsResult.data)) ? statsResult.data : {};
                    const programConfig = (programResult.data && typeof programResult.data === 'object' && !Array.isArray(programResult.data))
                        ? programResult.data
                        : {};
                    const stats = {
                        ...rawStats,
                        ...programConfig,
                        total_commission: rawStats.total_commission,
                        invited_count: rawStats.invited_count,
                        invite_code: rawStats.invite_code
                    };
                    const commissionEl = document.getElementById('affiliate-commission');
                    const countEl = document.getElementById('affiliate-count');
                    const linkEl = document.getElementById('affiliate-link');
                    const templateNameEl = document.getElementById('affiliate-poster-template-name');
                    const peopleLabel = window.i18n?.t('wallet.people') || '人';
                    const totalCommission = Number(stats.total_commission);
                    const invitedCount = Number(stats.invited_count);
                    const inviteCode = typeof stats.invite_code === 'string' ? stats.invite_code.trim() : '';
                    const posterConfig = this.normalizeAffiliatePosterConfig(posterResult.data);
                    const activeTemplate = posterConfig.templates.find(template => template.id === posterConfig.active_template_id) || posterConfig.templates[0];

                    if (commissionEl) {
                        commissionEl.textContent = Number.isFinite(totalCommission)
                            ? this.formatPoints(totalCommission)
                            : '0';
                    }

                    if (countEl) {
                        const safeInvitedCount = Number.isFinite(invitedCount) ? invitedCount : 0;
                        countEl.innerHTML = `${safeInvitedCount} <span style="font-size:14px; color:rgba(255,255,255,0.5); font-weight:normal; font-family:sans-serif;">${peopleLabel}</span>`;
                    }

                    this.affiliateStats = stats;
                    this.affiliatePosterConfig = posterConfig;

                    const cachedProfile = this.getCachedUserProfile();
                    const profileResult = await window.supabaseClient
                        .from('profiles')
                        .select('display_name, username, avatar_url')
                        .eq('id', user.id)
                        .maybeSingle();

                    if (profileResult?.error) {
                        console.warn('[WalletModal] Affiliate profile load warning:', profileResult.error);
                    }

                    const profileSource = profileResult?.data && typeof profileResult.data === 'object'
                        ? { ...cachedProfile, ...profileResult.data }
                        : cachedProfile;

                    this.affiliateProfile = {
                        displayName: this.getProfileDisplayName(profileSource, user),
                        avatarUrl: this.getProfileAvatarUrl(profileSource, user)
                    };

                    this.renderAffiliateDescription(stats);

                    if (linkEl && inviteCode) {
                        const baseUrl = window.location.origin + window.location.pathname;
                        linkEl.value = `${baseUrl}?ref=${inviteCode}`;
                    }

                    if (templateNameEl && activeTemplate) {
                        templateNameEl.textContent = activeTemplate.name;
                    }

                    this.currentInviteCode = inviteCode;
                }
                this.affiliateLoaded = true;
            } catch (err) {
                console.error('[WalletModal] Load Affiliate Error:', err);
                const descEl = document.getElementById('affiliate-desc-text');
                if (descEl) {
                    descEl.textContent = '推广信息加载失败，请稍后重试。';
                }
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
                const stats = this.affiliateStats || {};
                const posterConfig = this.normalizeAffiliatePosterConfig(this.affiliatePosterConfig);
                const activeTemplate = posterConfig.templates.find(template => template.id === posterConfig.active_template_id) || posterConfig.templates[0];
                const preset = this.getAffiliatePosterPreset(activeTemplate?.id);
                const legalDisclaimer = typeof stats.legal_disclaimer === 'string' && stats.legal_disclaimer.trim()
                    ? stats.legal_disclaimer.trim()
                    : '活动最终解释权归平台所有';
                const rewardSummary = this.getPosterRewardBadgeText(stats, posterConfig);
                const profileDisplayName = this.affiliateProfile?.displayName || 'U';
                const profileInitial = this.getPosterInitial(profileDisplayName);

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    throw new Error('海报画布初始化失败');
                }

                canvas.width = 1080;
                canvas.height = 1600;

                // 1. Draw base background
                const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
                preset.gradientStops.forEach(stop => gradient.addColorStop(stop.offset, stop.color));
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                if (activeTemplate?.custom_background_url) {
                    try {
                        const backgroundImage = await this.loadCanvasImage(activeTemplate.custom_background_url);
                        this.drawCoverImage(ctx, backgroundImage, 0, 0, canvas.width, canvas.height);
                    } catch (backgroundError) {
                        console.warn('[WalletModal] Failed to draw custom affiliate poster background:', backgroundError);
                    }

                    ctx.save();
                    ctx.globalAlpha = preset.overlayOpacity;
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }

                // Decorative shapes
                ctx.save();
                ctx.globalAlpha = activeTemplate?.id === 'crystal' ? 0.65 : 0.14;
                ctx.fillStyle = activeTemplate?.id === 'sunset' ? '#fed7aa' : '#bfdbfe';
                ctx.beginPath();
                ctx.arc(canvas.width * 0.88, 160, 220, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                ctx.save();
                ctx.globalAlpha = activeTemplate?.id === 'crystal' ? 0.45 : 0.18;
                ctx.fillStyle = activeTemplate?.id === 'sunset' ? '#fdba74' : '#6ee7b7';
                ctx.beginPath();
                ctx.arc(120, canvas.height - 220, 180, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                // Header chip
                ctx.font = '700 24px "Helvetica Neue", Arial, sans-serif';
                const chipLabel = posterConfig.chip_label || (window.i18n?.t('wallet.affiliate') || '推广');
                const chipWidth = Math.max(144, Math.min(280, ctx.measureText(chipLabel).width + 64));
                this.drawRoundedRect(ctx, 72, 76, chipWidth, 52, 26);
                ctx.fillStyle = preset.badgeBg;
                ctx.fill();
                ctx.fillStyle = preset.badgeText;
                ctx.textAlign = 'left';
                ctx.fillText(chipLabel, 104, 109);

                // Title + Subtitle
                ctx.fillStyle = preset.text;
                ctx.font = `800 ${activeTemplate?.id === 'sunset' ? 82 : 88}px "Helvetica Neue", Arial, sans-serif`;
                ctx.textAlign = 'left';
                const titleLayout = this.drawPosterTextBlock(
                    ctx,
                    posterConfig.title,
                    72,
                    214,
                    720,
                    activeTemplate?.id === 'sunset' ? 92 : 98,
                    2
                );
                ctx.fillStyle = preset.muted;
                ctx.font = '500 34px "Helvetica Neue", Arial, sans-serif';
                const subtitleLayout = this.drawPosterTextBlock(ctx, posterConfig.subtitle, 72, titleLayout.nextY + 18, 760, 46, 2);

                let rewardBadgeBottom = subtitleLayout.nextY;
                if (rewardSummary) {
                    const rewardBadgeWidth = Math.max(280, Math.min(620, 170 + rewardSummary.length * 20));
                    const rewardBadgeY = subtitleLayout.nextY + 42;
                    this.drawRoundedRect(ctx, 72, rewardBadgeY, rewardBadgeWidth, 66, 24);
                    ctx.fillStyle = preset.badgeBg;
                    ctx.fill();
                    ctx.fillStyle = preset.badgeText;
                    let rewardBadgeFontSize = 26;
                    ctx.font = `600 ${rewardBadgeFontSize}px "Helvetica Neue", Arial, sans-serif`;
                    while (ctx.measureText(rewardSummary).width > rewardBadgeWidth - 60 && rewardBadgeFontSize > 18) {
                        rewardBadgeFontSize -= 1;
                        ctx.font = `600 ${rewardBadgeFontSize}px "Helvetica Neue", Arial, sans-serif`;
                    }
                    ctx.fillText(rewardSummary, 102, rewardBadgeY + 42);
                    rewardBadgeBottom = rewardBadgeY + 66;
                }

                // Invite card
                const cardX = 72;
                const cardY = Math.max(652, rewardBadgeBottom + 84);
                const cardWidth = canvas.width - 144;
                const cardHeight = 548;

                this.drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 42);
                ctx.fillStyle = preset.qrCardBg;
                ctx.fill();

                let avatarImage = null;
                if (this.affiliateProfile?.avatarUrl) {
                    try {
                        avatarImage = await this.loadCanvasImage(this.affiliateProfile.avatarUrl);
                    } catch (avatarError) {
                        console.warn('[WalletModal] Failed to draw affiliate avatar:', avatarError);
                    }
                }

                this.drawPosterAvatar(ctx, {
                    image: avatarImage,
                    centerX: cardX + cardWidth / 2,
                    centerY: cardY + 8,
                    radius: 58,
                    ringColor: 'rgba(255, 251, 235, 0.96)',
                    borderColor: activeTemplate?.id === 'sunset' ? 'rgba(249, 115, 22, 0.34)' : 'rgba(15, 23, 42, 0.12)',
                    fallbackInitial: profileInitial,
                    fallbackBackground: activeTemplate?.id === 'sunset'
                        ? 'sunset'
                        : 'midnight'
                });

                // Fetch QR Code image
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(linkEl.value)}&margin=1`;
                const qrImg = await this.loadCanvasImage(qrUrl);
                this.drawRoundedRect(ctx, cardX + 54, cardY + 118, 360, 360, 30);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.drawImage(qrImg, cardX + 84, cardY + 148, 300, 300);

                ctx.fillStyle = preset.qrLabelColor;
                ctx.font = '600 28px "Helvetica Neue", Arial, sans-serif';
                this.drawPosterTextBlock(ctx, posterConfig.qr_label, cardX + 90, cardY + 468, 300, 34, 2);

                ctx.fillStyle = preset.qrLabelColor;
                ctx.font = '600 26px "Helvetica Neue", Arial, sans-serif';
                ctx.fillText(posterConfig.invite_code_label, cardX + 464, cardY + 184);

                ctx.fillStyle = preset.codeColor;
                ctx.font = '700 56px "Helvetica Neue", Arial, sans-serif';
                const codeLayout = this.drawPosterTextBlock(ctx, this.currentInviteCode, cardX + 464, cardY + 246, 430, 62, 2);

                ctx.fillStyle = '#475569';
                ctx.font = '500 28px "Helvetica Neue", Arial, sans-serif';
                const footerLayout = this.drawPosterTextBlock(ctx, posterConfig.footer, cardX + 464, codeLayout.nextY + 36, 430, 42, 3);

                ctx.fillStyle = preset.accent;
                ctx.font = '700 28px "Helvetica Neue", Arial, sans-serif';
                this.drawPosterTextBlock(ctx, linkEl.value, cardX + 464, footerLayout.nextY + 42, 430, 38, 3);

                // Footer disclaimer
                ctx.fillStyle = preset.text;
                ctx.font = '500 28px "Helvetica Neue", Arial, sans-serif';
                ctx.fillText(legalDisclaimer, 72, 1508);

                // Download Image
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

        async loadCanvasImage(src) {
            return await new Promise((resolve, reject) => {
                const image = new Image();
                image.crossOrigin = 'Anonymous';
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('图片加载失败'));
                image.src = src;
            });
        },

        drawCoverImage(ctx, image, x, y, width, height) {
            const imageRatio = image.width / image.height;
            const targetRatio = width / height;

            let drawWidth = width;
            let drawHeight = height;
            let offsetX = x;
            let offsetY = y;

            if (imageRatio > targetRatio) {
                drawWidth = height * imageRatio;
                offsetX = x - (drawWidth - width) / 2;
            } else {
                drawHeight = width / imageRatio;
                offsetY = y - (drawHeight - height) / 2;
            }

            ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
        },

        drawRoundedRect(ctx, x, y, width, height, radius) {
            const safeRadius = Math.min(radius, width / 2, height / 2);
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(x, y, width, height, safeRadius);
                return;
            }
            ctx.moveTo(x + safeRadius, y);
            ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
            ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
            ctx.arcTo(x, y + height, x, y, safeRadius);
            ctx.arcTo(x, y, x + width, y, safeRadius);
            ctx.closePath();
        },

        drawPosterTextBlock(ctx, text, x, startY, maxWidth, lineHeight, maxLines = 3) {
            const content = String(text || '').trim();
            if (!content) {
                return {
                    lines: [],
                    lineCount: 0,
                    startY,
                    lastBaseline: startY,
                    nextY: startY
                };
            }

            const lines = [];
            let currentLine = '';

            for (const char of content) {
                const candidate = currentLine + char;
                if (ctx.measureText(candidate).width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                    if (lines.length >= maxLines - 1) break;
                } else {
                    currentLine = candidate;
                }
            }

            if (currentLine && lines.length < maxLines) {
                lines.push(currentLine);
            }

            if (lines.length === maxLines && content.length > lines.join('').length) {
                lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, lines[maxLines - 1].length - 1))}…`;
            }

            lines.forEach((line, index) => {
                ctx.fillText(line, x, startY + index * lineHeight);
            });

            const lastBaseline = startY + Math.max(0, lines.length - 1) * lineHeight;
            return {
                lines,
                lineCount: lines.length,
                startY,
                lastBaseline,
                nextY: startY + lines.length * lineHeight
            };
        },

        drawPosterAvatar(ctx, options = {}) {
            const centerX = Number(options.centerX) || 0;
            const centerY = Number(options.centerY) || 0;
            const radius = Number(options.radius) || 56;
            const ringRadius = radius + 10;
            const fallbackInitial = options.fallbackInitial || 'U';

            ctx.save();
            ctx.shadowColor = 'rgba(15, 23, 42, 0.18)';
            ctx.shadowBlur = 28;
            ctx.shadowOffsetY = 10;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
            ctx.fillStyle = options.ringColor || 'rgba(255, 255, 255, 0.96)';
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            if (options.image) {
                this.drawCoverImage(ctx, options.image, centerX - radius, centerY - radius, radius * 2, radius * 2);
            } else {
                const fallbackGradient = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
                if (options.fallbackBackground === 'sunset') {
                    fallbackGradient.addColorStop(0, '#f97316');
                    fallbackGradient.addColorStop(1, '#f59e0b');
                } else {
                    fallbackGradient.addColorStop(0, '#0f172a');
                    fallbackGradient.addColorStop(1, '#134e4a');
                }
                ctx.fillStyle = fallbackGradient;
                ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
                ctx.fillStyle = '#ffffff';
                ctx.font = '700 56px "Helvetica Neue", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(fallbackInitial, centerX, centerY + 2);
            }
            ctx.restore();

            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = options.borderColor || 'rgba(255, 255, 255, 0.38)';
            ctx.lineWidth = 6;
            ctx.stroke();
            ctx.restore();
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
                const [balance, packages, history, rechargeOptions] = await Promise.all([
                    PointsService.getBalance(),
                    PointsService.getPackages(),
                    PointsService.getHistory(),
                    this.loadRechargeOptionsConfig()
                ]);

                console.log('[WalletModal] ✅ Data loaded:', { balance, packagesLength: packages.length });

                // Update balance with animation
                const totalEl = document.getElementById('wallet-total');
                if (totalEl) {
                    const currentVal = this.normalizePointValue(totalEl.dataset.value || 0);
                    const newVal = this.normalizePointValue(balance.total_balance);
                    this.animateValue(totalEl, currentVal, newVal, 800);
                    totalEl.dataset.value = newVal;
                }

                const paidEl = document.getElementById('wallet-paid');
                if (paidEl) paidEl.textContent = this.formatPoints(balance.paid_balance);

                const bonusEl = document.getElementById('wallet-bonus');
                if (bonusEl) bonusEl.textContent = this.formatPoints(balance.bonus_balance);

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
                                <div class="pkg-points">${this.formatPoints(pkg.points_amount)} ${pointsUnit}${pkg.bonus_points > 0 ? ` <span class="pkg-bonus">+${this.formatPoints(pkg.bonus_points)}</span>` : ''}</div>
                                <div class="pkg-price">¥${pkg.price_cny}</div>
                            </div>
                        `}).join('');
                    }
                    requestWalletRechargeScrollCueUpdate();
                }

                this.renderCustomRechargeSection(rechargeOptions);

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
                obj.textContent = this.formatPoints(end);
                return;
            }
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                // Ease out expo
                const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

                const value = this.normalizePointValue(easeProgress * (end - start) + start);
                obj.textContent = this.formatPoints(value);

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                } else {
                    obj.textContent = this.formatPoints(end);
                }
            };
            window.requestAnimationFrame(step);
        },

        invalidateOrderRecordsCache() {
            this._prefetchedShopOrders = null;
            this._prefetchedLedger = null;
            this.ordersLoaded = false;
            this.browseOrdersSnapshot = [];
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
                this.invalidateOrderRecordsCache();
                this.loadOrders({
                    searchQuery: this.orderSearchActiveQuery || this.orderSearchQuery,
                    ignorePrefetch: true
                }).catch(e => console.error('Order reload after recharge failed:', e));

                // Refresh data in background to show new balance
                this.loadData();

            } catch (err) {
                console.error('[WalletModal] Purchase failed:', err);
                // Remove loading state on error
                if (overlay) overlay.classList.remove('loading');
                alert('❌ 支付失败: ' + (err.message || '未知错误'));
            }
        },

        async customRecharge() {
            const overlay = document.getElementById('wallet-modal-overlay');
            const input = document.getElementById('wallet-custom-recharge-input');
            const button = document.getElementById('wallet-custom-recharge-btn');
            const rawValue = input?.value ?? '';
            const normalizedAmount = this.normalizePointValue(rawValue);

            if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
                this.showToast('请输入大于 0 的充值积分', 'error');
                if (input) input.focus();
                return;
            }

            try {
                if (button) button.disabled = true;
                if (overlay) overlay.classList.add('loading');

                await PointsService.customRecharge(normalizedAmount);

                if (input) {
                    input.value = '';
                }

                if (overlay) overlay.classList.remove('loading');
                this.showToast(`✅ 自定义充值成功！ +${this.formatPoints(normalizedAmount)} 积分`, 'success');

                this.invalidateOrderRecordsCache();
                this.loadOrders({
                    searchQuery: this.orderSearchActiveQuery || this.orderSearchQuery,
                    ignorePrefetch: true
                }).catch(e => console.error('Order reload after custom recharge failed:', e));

                this.loadData().catch(e => console.error('Wallet reload after custom recharge failed:', e));
            } catch (err) {
                console.error('[WalletModal] Custom recharge failed:', err);
                if (overlay) overlay.classList.remove('loading');
                this.showToast('❌ 自定义充值失败: ' + (err.message || '未知错误'), 'error');
            } finally {
                if (button) button.disabled = false;
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

                const [checkinResult] = await Promise.all([
                    window.supabaseClient.rpc('fn_get_checkin_data', {
                        p_user_id: session.user.id,
                        p_site: window.SiteConfig?.site || 'cn',
                        p_year: year,
                        p_month: month
                    }),
                    this.loadCheckinConfig(true)
                ]);

                const { data, error } = checkinResult;

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
                    let msg = `💰 签到奖励 +${this.formatPoints(data.points)} 积分`;
                    if (data.message && data.message !== '签到成功') {
                        msg += `\\n${data.message}`; // Append the bonus message
                    }
                    this.showToast(msg, 'success');

                    // Update balance display
                    if (data.new_balance !== undefined) {
                        const totalEl = document.getElementById('wallet-total');
                        if (totalEl) {
                            const normalizedBalance = this.normalizePointValue(data.new_balance);
                            totalEl.textContent = this.formatPoints(normalizedBalance);
                            totalEl.dataset.value = normalizedBalance;
                        }
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
        async makeupCheckin(dateStr) {
            const checkinConfig = await this.loadCheckinConfig(true);
            const makeupCost = Math.max(0, Number(checkinConfig?.makeup_cost_points) || 0);
            const confirmMessage = makeupCost > 0
                ? `确认要补签 ${dateStr} 吗？\\n这将扣除 ${makeupCost} 积分`
                : `确认要补签 ${dateStr} 吗？\\n当前补签不扣除积分`;

            if (!confirm(confirmMessage)) {
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
                    this.showToast(`✅ 补签成功! 扣除 ${this.formatPoints(data.cost)} 积分`, 'success');

                    // Update balance display
                    if (data.new_balance !== undefined) {
                        const totalEl = document.getElementById('wallet-total');
                        if (totalEl) {
                            const normalizedBalance = this.normalizePointValue(data.new_balance);
                            totalEl.textContent = this.formatPoints(normalizedBalance);
                            totalEl.dataset.value = normalizedBalance;
                        }
                    }

                    // Refresh calendar and data
                    this.invalidateOrderRecordsCache();
                    this.loadOrders({
                        searchQuery: this.orderSearchActiveQuery || this.orderSearchQuery,
                        ignorePrefetch: true
                    }).catch(e => console.error('Order reload after makeup failed:', e));
                    this.loadCheckinData();
                    this.loadData().catch(() => { });
                } else {
                    this.showToast(`❌ ${data.message}`, 'error');
                }
            } catch (e) {
                console.error('[WalletModal] Makeup failed:', e);
                this.showToast(`补签失败: ${e.message}`, 'error');
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
                else if (reason === 'makeup_checkin_cost') {
                    reason = '补签扣分';
                }
                else if (reason === 'signup_bonus') {
                    reason = '注册奖励';
                }
                else if (reason === 'custom_recharge') {
                    reason = '自定义充值';
                }

                return `
                    <div class="history-item" onclick="WalletModal.toggleItemDetails(this)">
                        <div class="history-row-main">
                            <div class="history-main">
                                <div class="history-desc" title="${item.reason}">${reason}</div>
                                <div class="history-date">${dateStr}</div>
                            </div>
                            <div class="history-amount ${item.amount > 0 ? 'positive' : 'negative'}">
                                ${item.amount > 0 ? '+' : ''}${this.formatPoints(item.amount)}
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
        browseOrdersSnapshot: [],
        orderSearchQuery: '',
        orderSearchActiveQuery: '',
        orderSearchDebounceTimer: null,
        orderRequestId: 0,

        syncOrderSearchUi() {
            const input = document.getElementById('wallet-order-search-input');
            const clearBtn = document.getElementById('wallet-order-search-clear');
            const query = String(this.orderSearchQuery || '');

            if (input && input.value !== query) {
                input.value = query;
            }

            if (clearBtn) {
                clearBtn.classList.toggle('visible', !!query.trim());
            }
        },

        resetOrderSearchState() {
            if (this.orderSearchDebounceTimer) {
                clearTimeout(this.orderSearchDebounceTimer);
                this.orderSearchDebounceTimer = null;
            }

            this.orderSearchQuery = '';
            this.orderSearchActiveQuery = '';
            this.syncOrderSearchUi();
        },

        handleOrderSearchInput(event) {
            this.orderSearchQuery = event?.target?.value || '';
            this.syncOrderSearchUi();

            if (this.orderSearchDebounceTimer) {
                clearTimeout(this.orderSearchDebounceTimer);
            }

            this.orderSearchDebounceTimer = setTimeout(() => {
                this.orderSearchDebounceTimer = null;
                this.triggerOrderSearch();
            }, 260);
        },

        handleOrderSearchKeydown(event) {
            if (event.key !== 'Enter') return;

            event.preventDefault();
            this.orderSearchQuery = event?.target?.value || this.orderSearchQuery || '';

            if (this.orderSearchDebounceTimer) {
                clearTimeout(this.orderSearchDebounceTimer);
                this.orderSearchDebounceTimer = null;
            }

            this.triggerOrderSearch(true);
        },

        clearOrderSearch(event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }

            this.resetOrderSearchState();

            const input = document.getElementById('wallet-order-search-input');
            if (input) {
                input.focus();
            }

            this.triggerOrderSearch(true);
        },

        triggerOrderSearch(force = false) {
            const normalizedQuery = String(this.orderSearchQuery || '').trim();

            if (normalizedQuery) {
                this.resetOrderFilters();
            }

            if (!force && normalizedQuery === this.orderSearchActiveQuery && this.ordersLoaded) {
                this.applyOrderFilter();
                return;
            }

            this.loadOrders({
                searchQuery: normalizedQuery,
                ignorePrefetch: force || !!normalizedQuery
            }).catch((err) => {
                console.error('[WalletModal] Order search failed:', err);
            });
        },

        isUuid(value = '') {
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
        },

        dedupeRecordsById(records = []) {
            const seen = new Set();
            return records.filter((record) => {
                const key = String(record?.id || '').trim();
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },

        getOrderSearchTokens(order = {}) {
            return [
                order.id,
                order.shopOrderId,
                order.referenceId,
                order.snapshot_product_name,
                order.rawReason,
                order.promptId,
                order.redeemCode,
                order.amount,
                order.total_price
            ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
        },

        async mergeLocalSearchMatches({ query = '', remoteOrders = [], sourceOrders = [], userId = '', site = 'cn' }) {
            const normalizedQuery = String(query || '').trim().toLowerCase();
            if (!normalizedQuery || !Array.isArray(sourceOrders) || sourceOrders.length === 0) {
                return remoteOrders;
            }

            const mergedOrders = [...remoteOrders];
            const seenIds = new Set(
                remoteOrders
                    .map((order) => String(order?.id || '').trim())
                    .filter(Boolean)
            );
            const emailLikeQuery = this.looksLikeEmail(normalizedQuery) || normalizedQuery.includes('@');
            const verifyCandidates = [];

            sourceOrders.forEach((order) => {
                const orderId = String(order?.id || '').trim();
                if (!orderId || seenIds.has(orderId)) return;

                const tokens = this.getOrderSearchTokens(order);
                if (tokens.some((token) => token.includes(normalizedQuery))) {
                    seenIds.add(orderId);
                    mergedOrders.push(order);
                    return;
                }

                if (emailLikeQuery && order.transactionType === 'verify' && userId) {
                    verifyCandidates.push(order);
                }
            });

            if (verifyCandidates.length > 0) {
                const verifyMatches = await Promise.all(
                    verifyCandidates.slice(0, 80).map(async (order) => {
                        try {
                            const verifyLog = await this.fetchVerifyOrderLog({
                                orderId: order.id,
                                referenceId: order.referenceId,
                                userId,
                                site,
                                createdAt: order.created_at,
                                pointsPaid: Math.abs(Number(order.total_price || order.amount) || 0),
                                reason: order.rawReason
                            });
                            const payload = verifyLog?.payload || {};
                            const verifyTokens = [
                                ...this.getOrderSearchTokens(order),
                                payload.email,
                                payload.job_id,
                                payload.url,
                                payload.error_message,
                                verifyLog?.verification_id
                            ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

                            if (verifyTokens.some((token) => token.includes(normalizedQuery))) {
                                return order;
                            }
                        } catch (error) {
                            console.warn('[WalletModal] Local verify search fallback failed:', error);
                        }

                        return null;
                    })
                );

                verifyMatches.filter(Boolean).forEach((order) => {
                    const orderId = String(order?.id || '').trim();
                    if (!orderId || seenIds.has(orderId)) return;
                    seenIds.add(orderId);
                    mergedOrders.push(order);
                });
            }

            return mergedOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        },

        resetOrderFilters() {
            this.orderFilter = 'all';
            this.orderTimeFilter = 'all';
            this.orderCustomDateStart = null;
            this.orderCustomDateEnd = null;

            const allLabel = window.i18n?.t('wallet.all') || '全部';
            const orderFilterLabel = document.getElementById('order-filter-label');
            const orderTimeFilterLabel = document.getElementById('order-time-filter-label');

            if (orderFilterLabel) orderFilterLabel.textContent = allLabel;
            if (orderTimeFilterLabel) orderTimeFilterLabel.textContent = allLabel;

            document.querySelectorAll('#order-filter-popup .filter-option').forEach((opt) => {
                opt.classList.toggle('active', opt.dataset.value === 'all');
            });

            document.querySelectorAll('#order-time-filter-popup .filter-option').forEach((opt) => {
                opt.classList.toggle('active', opt.dataset.value === 'all');
            });
        },

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

        async searchWalletTransactions({ userId, site, query }) {
            const trimmedQuery = String(query || '').trim();
            const orderSelect = `
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
            `;
            const ledgerSelect = 'id, amount, reason, reference_id, created_at';
            const likeValue = `%${trimmedQuery}%`;
            const isUuidQuery = this.isUuid(trimmedQuery);
            const numericQuery = Number(trimmedQuery);
            const isPositiveAmountQuery = /^\d+$/.test(trimmedQuery) && Number.isFinite(numericQuery) && numericQuery > 0;
            const shouldSearchVerifyLogs = trimmedQuery.length >= 3;

            const shopRequests = [
                supabase
                    .from('shop_orders')
                    .select(orderSelect)
                    .eq('user_id', userId)
                    .eq('site', site)
                    .ilike('snapshot_product_name', likeValue)
                    .order('created_at', { ascending: false })
                    .limit(80)
            ];

            const ledgerRequests = [
                supabase
                    .from('points_ledger')
                    .select(ledgerSelect)
                    .eq('user_id', userId)
                    .eq('site', site)
                    .ilike('reference_id', likeValue)
                    .order('created_at', { ascending: false })
                    .limit(80),
                supabase
                    .from('points_ledger')
                    .select(ledgerSelect)
                    .eq('user_id', userId)
                    .eq('site', site)
                    .ilike('reason', likeValue)
                    .order('created_at', { ascending: false })
                    .limit(80)
            ];

            if (isPositiveAmountQuery) {
                ledgerRequests.push(
                    supabase
                        .from('points_ledger')
                        .select(ledgerSelect)
                        .eq('user_id', userId)
                        .eq('site', site)
                        .eq('amount', numericQuery)
                        .order('created_at', { ascending: false })
                        .limit(80)
                );
            }

            if (isUuidQuery) {
                shopRequests.push(
                    supabase
                        .from('shop_orders')
                        .select(orderSelect)
                        .eq('user_id', userId)
                        .eq('site', site)
                        .eq('id', trimmedQuery)
                        .limit(20)
                );

                ledgerRequests.push(
                    supabase
                        .from('points_ledger')
                        .select(ledgerSelect)
                        .eq('user_id', userId)
                        .eq('site', site)
                        .eq('id', trimmedQuery)
                        .limit(20)
                );
            }

            const promptSearchRequest = supabase
                .from('prompts')
                .select('id, title')
                .ilike('title', likeValue)
                .limit(30);

            const verifyLogRequests = shouldSearchVerifyLogs ? [
                supabase
                    .from('verification_logs')
                    .select('verification_id, status, message, points_deducted, created_at')
                    .eq('user_id', userId)
                    .eq('site', site)
                    .ilike('verification_id', likeValue)
                    .order('created_at', { ascending: false })
                    .limit(80),
                supabase
                    .from('verification_logs')
                    .select('verification_id, status, message, points_deducted, created_at')
                    .eq('user_id', userId)
                    .eq('site', site)
                    .ilike('message', likeValue)
                    .order('created_at', { ascending: false })
                    .limit(80)
            ] : [];

            const [{ data: promptMatches, error: promptError }, verifyLogResults] = await Promise.all([
                promptSearchRequest,
                verifyLogRequests.length > 0 ? Promise.all(verifyLogRequests) : Promise.resolve([])
            ]);

            if (promptError) {
                console.warn('[WalletModal] Prompt search failed:', promptError);
            }

            const promptTitles = {};
            const promptIds = (promptMatches || []).map((prompt) => {
                promptTitles[prompt.id] = prompt.title;
                return prompt.id;
            });

            if (promptIds.length > 0) {
                ledgerRequests.push(
                    supabase
                        .from('points_ledger')
                        .select(ledgerSelect)
                        .eq('user_id', userId)
                        .eq('site', site)
                        .eq('reason', 'unlock_prompt')
                        .in('reference_id', promptIds)
                        .order('created_at', { ascending: false })
                        .limit(80)
                );
            }

            const verifyLogRows = [];
            verifyLogResults.forEach((result) => {
                if (result.error) throw result.error;
                if (result.data?.length) {
                    verifyLogRows.push(...result.data);
                }
            });

            const verifyReferenceIds = [...new Set(
                verifyLogRows.map((row) => {
                    const payload = this.parseVerifyLogMessage(row.message) || {};
                    const verificationId = String(row.verification_id || '').trim();
                    const payloadJobId = String(payload.job_id || '').trim();
                    const payloadEmail = String(payload.email || '').trim().toLowerCase();
                    const refs = [
                        verificationId,
                        payloadJobId,
                        payloadEmail
                    ].map((value) => String(value || '').trim()).filter(Boolean);
                    return refs;
                }).flat().filter(Boolean)
            )];

            if (verifyReferenceIds.length > 0) {
                ledgerRequests.push(
                    supabase
                        .from('points_ledger')
                        .select(ledgerSelect)
                        .eq('user_id', userId)
                        .eq('site', site)
                        .in('reference_id', verifyReferenceIds.slice(0, 80))
                        .order('created_at', { ascending: false })
                        .limit(80)
                );
            }

            const [shopResults, ledgerResults] = await Promise.all([
                Promise.all(shopRequests),
                Promise.all(ledgerRequests)
            ]);

            const shopOrders = [];
            shopResults.forEach((result) => {
                if (result.error) throw result.error;
                if (result.data?.length) {
                    shopOrders.push(...result.data);
                }
            });

            const ledgerEntries = [];
            ledgerResults.forEach((result) => {
                if (result.error) throw result.error;
                if (result.data?.length) {
                    ledgerEntries.push(...result.data);
                }
            });

            return {
                shopOrders: this.dedupeRecordsById(shopOrders),
                ledgerEntries: this.dedupeRecordsById(ledgerEntries),
                promptTitles
            };
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
        async loadOrders(options = {}) {
            const {
                searchQuery = this.orderSearchQuery,
                ignorePrefetch = false
            } = options;
            const normalizedQuery = String(searchQuery || '').trim();
            const requestId = ++this.orderRequestId;
            const site = window.SiteConfig?.site || 'cn';
            const container = document.getElementById('wallet-orders');

            this.ordersLoading = true;
            this.orderSearchQuery = typeof searchQuery === 'string' ? searchQuery : (this.orderSearchQuery || '');
            this.syncOrderSearchUi();

            try {
                console.log('[WalletModal] 🔄 Loading transactions...', normalizedQuery ? `search=${normalizedQuery}` : 'browse');

                if (!container) return;

                container.innerHTML = `<div class="loading-text">${normalizedQuery
                    ? (window.i18n?.t('wallet.searchingRecords') || '查询中...')
                    : (window.i18n?.t('common.loading') || '加载中...')}</div>`;

                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) {
                    if (requestId !== this.orderRequestId) return;
                    container.innerHTML = `<div class="empty-text">${window.i18n?.t('security.loginRequired') || '请先登录'}</div>`;
                    return;
                }

                let shopOrders = [];
                let ledgerEntries = [];
                let promptTitles = {};

                if (!normalizedQuery && !ignorePrefetch && this._prefetchedShopOrders && this._prefetchedLedger) {
                    console.log('[WalletModal] ⚡ Using prefetched data (instant)');
                    shopOrders = this._prefetchedShopOrders;
                    ledgerEntries = this._prefetchedLedger;
                    this._prefetchedShopOrders = null;
                    this._prefetchedLedger = null;
                } else if (normalizedQuery) {
                    const searchResult = await this.searchWalletTransactions({
                        userId: user.id,
                        site,
                        query: normalizedQuery
                    });

                    if (requestId !== this.orderRequestId) return;

                    shopOrders = searchResult.shopOrders || [];
                    ledgerEntries = searchResult.ledgerEntries || [];
                    promptTitles = searchResult.promptTitles || {};
                } else {
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
                            .eq('site', site)
                            .order('created_at', { ascending: false })
                            .limit(100),
                        supabase
                            .from('points_ledger')
                            .select('id, amount, reason, reference_id, created_at')
                            .eq('user_id', user.id)
                            .eq('site', site)
                            .order('created_at', { ascending: false })
                            .limit(100)
                    ]);

                    if (requestId !== this.orderRequestId) return;
                    if (shopOrdersResult.error) throw shopOrdersResult.error;
                    if (ledgerResult.error) throw ledgerResult.error;

                    shopOrders = shopOrdersResult.data || [];
                    ledgerEntries = ledgerResult.data || [];
                }

                const missingPromptIds = [...new Set(
                    (ledgerEntries || [])
                        .filter((entry) => entry.reason === 'unlock_prompt' && entry.reference_id && !promptTitles[entry.reference_id])
                        .map((entry) => entry.reference_id)
                )];

                if (missingPromptIds.length > 0) {
                    const { data: prompts, error: promptLookupError } = await supabase
                        .from('prompts')
                        .select('id, title')
                        .in('id', missingPromptIds);

                    if (requestId !== this.orderRequestId) return;
                    if (promptLookupError) {
                        console.warn('[WalletModal] Prompt title lookup failed:', promptLookupError);
                    } else if (prompts) {
                        prompts.forEach((prompt) => {
                            promptTitles[prompt.id] = prompt.title;
                        });
                    }
                }

                const ledgerOrders = (ledgerEntries || []).map((entry) => {
                    const entryAmount = this.normalizePointValue(entry.amount);
                    let transactionType = 'other';
                    let displayName = entry.reason || '交易';
                    let icon = '💳';
                    let shopOrderId = '';

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
                        transactionType = 'recharge';
                        displayName = window.i18n?.t('wallet.dailyCheckin') || '每日签到';
                        icon = '⚡';
                    } else if (entry.reason === 'makeup_checkin_cost') {
                        transactionType = 'recharge';
                        displayName = '补签扣分';
                        icon = '📅';
                    } else if (entry.reason === 'signup_bonus') {
                        transactionType = 'recharge';
                        displayName = '注册奖励';
                        icon = '🎁';
                    } else if (entry.reason === 'custom_recharge') {
                        transactionType = 'recharge';
                        displayName = '自定义充值';
                        icon = '⚡';
                    } else if (entry.reason && (entry.reason.startsWith('模拟充值') || entry.reason === 'package_purchase' || entry.reason === 'afdian_recharge')) {
                        transactionType = 'recharge';
                        displayName = this.getRechargeDisplayName(entry.reason);
                        icon = '⚡';
                    } else if (entry.reason === 'redeem_code' || (entry.reason && entry.reason.includes('兑换码'))) {
                        transactionType = 'redeem';
                        displayName = '兑换码兑换';
                        icon = '🎟️';
                    } else if (entry.reason && entry.reason.startsWith('admin_manual')) {
                        transactionType = 'recharge';
                        const adminLabel = window.i18n?.t('wallet.adminAdjustment') || '管理员调整:';
                        displayName = entry.reason.replace(/admin_manual:\s*\[.*?\]\s*/, `${adminLabel} `);
                        if (displayName.startsWith('admin_manual:')) {
                            displayName = displayName.replace('admin_manual:', adminLabel);
                        }
                        icon = '👤';
                    } else if (entryAmount > 0) {
                        transactionType = 'recharge';
                        displayName = entry.reason || '积分充值';
                        icon = '⚡';
                    }

                    return {
                        id: entry.id,
                        created_at: entry.created_at,
                        total_price: Math.abs(entryAmount),
                        amount: entryAmount,
                        status: 'completed',
                        snapshot_product_name: displayName,
                        item_count: 1,
                        transactionType,
                        isPromptUnlock: transactionType === 'prompt',
                        isVerifyOrder: transactionType === 'verify',
                        isRecharge: transactionType === 'recharge',
                        isRedeem: transactionType === 'redeem',
                        promptId: entry.reason === 'unlock_prompt' ? entry.reference_id : null,
                        redeemCode: transactionType === 'redeem' ? entry.reference_id : null,
                        referenceId: entry.reference_id || '',
                        shopOrderId,
                        rawReason: entry.reason || '',
                        icon
                    };
                });

                const shopOrdersList = (shopOrders || []).map((order) => ({
                    ...order,
                    transactionType: 'shop',
                    isShopOrder: true,
                    shopOrderId: order.id,
                    icon: '🛒'
                }));

                const realShopOrderIds = new Set(
                    shopOrdersList
                        .map((order) => String(order.shopOrderId || order.id || '').trim())
                        .filter(Boolean)
                );

                const dedupedLedgerOrders = ledgerOrders.filter((order) => {
                    if (order.transactionType !== 'shop') return true;
                    if (!order.shopOrderId) return true;
                    return !realShopOrderIds.has(String(order.shopOrderId).trim());
                });

                const allOrders = [...shopOrdersList, ...dedupedLedgerOrders].sort((a, b) =>
                    new Date(b.created_at) - new Date(a.created_at)
                );

                const finalOrders = normalizedQuery
                    ? await this.mergeLocalSearchMatches({
                        query: normalizedQuery,
                        remoteOrders: allOrders,
                        sourceOrders: this.browseOrdersSnapshot.length ? this.browseOrdersSnapshot : this.ordersData,
                        userId: user.id,
                        site
                    })
                    : allOrders;

                if (requestId !== this.orderRequestId) return;

                this.ordersLoaded = true;
                this.ordersData = finalOrders;
                if (!normalizedQuery) {
                    this.browseOrdersSnapshot = [...finalOrders];
                }
                this.orderSearchActiveQuery = normalizedQuery;
                this.applyOrderFilter();
            } catch (err) {
                if (requestId !== this.orderRequestId) return;

                console.error('[WalletModal] ❌ Load transactions failed:', err);
                if (container) {
                    container.innerHTML = `<div class="empty-text">${window.i18n?.t('wallet.loadFailed') || '加载失败'}</div>`;
                }
            } finally {
                if (requestId === this.orderRequestId) {
                    this.ordersLoading = false;
                }
            }
        },

        /**
         * Render all transactions (shop orders, prompts, recharges, redemptions)
         */
        renderOrders(orders) {
            const container = document.getElementById('wallet-orders');
            if (!orders || orders.length === 0) {
                const hasActiveSearch = !!String(this.orderSearchActiveQuery || '').trim();
                container.innerHTML = `<div class="empty-text">${hasActiveSearch
                    ? (window.i18n?.t('wallet.noSearchResults') || '未找到相关记录')
                    : (window.i18n?.t('wallet.noRecords') || '暂无记录')}</div>`;
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
                const signedAmount = order.isShopOrder
                    ? -this.normalizePointValue(order.total_price || 0)
                    : this.normalizePointValue(order.amount ?? order.total_price ?? 0);
                const absAmountText = this.formatPoints(Math.abs(signedAmount));

                // Determine amount display and color
                if (signedAmount >= 0) {
                    amountDisplay = `+${absAmountText} ${pointsUnit}`;
                    amountClass = 'positive';
                } else {
                    amountDisplay = `-${absAmountText} ${pointsUnit}`;
                    amountClass = 'negative';
                }

                // Handle display name and click based on type
                if (order.transactionType === 'prompt') {
                    displayName = `<i class="fas fa-lightbulb" style="color: #fde68a;"></i> ${this.escapeHtml(order.snapshot_product_name)}`;
                    clickHandler = `WalletModal.showPromptOrderDetail('${order.id}', '${this.escapeHtml(order.snapshot_product_name).replace(/'/g, "\\'")}', ${Math.abs(this.normalizePointValue(order.total_price || order.amount || 0))}, '${order.created_at}', '${order.promptId || ''}')`;
                } else if (order.transactionType === 'verify') {
                    displayName = `<i class="fas fa-key" style="color: #6b9ece;"></i> ${this.escapeHtml(order.snapshot_product_name)}`;
                    clickHandler = `WalletModal.showVerifyOrderDetail('${order.id}', '${String(order.referenceId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', ${Math.abs(this.normalizePointValue(order.total_price || order.amount || 0))}, '${order.created_at}', '${String(order.rawReason || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
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
                        clickHandler = `WalletModal.showRechargeOrderDetail('${order.id}', -${Math.abs(this.normalizePointValue(order.total_price || order.amount || 0))}, '${order.created_at}', '${String(order.rawReason || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${String(order.referenceId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
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
                    clickHandler = `WalletModal.showRechargeOrderDetail('${order.id}', ${this.normalizePointValue(order.amount || order.total_price || 0)}, '${order.created_at}', '${String(order.rawReason || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${String(order.referenceId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
                } else if (order.transactionType === 'redeem') {
                    displayName = `<i class="fas fa-ticket-alt" style="color: #f472b6;"></i> ${this.escapeHtml(order.snapshot_product_name)}`;
                    clickHandler = `WalletModal.showRedeemOrderDetail('${order.id}', ${this.normalizePointValue(order.amount)}, '${order.created_at}', '${order.redeemCode || ''}')`;
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
            const priceText = this.formatPoints(price);

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
                                <span class="detail-val highlight">-${priceText} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
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
            const amountText = this.formatPoints(amount);

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
                                <span class="detail-val" style="color: #10b981; font-weight: 600;">+${amountText} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
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
            const normalizedAmount = this.normalizePointValue(amount);
            const titleText = normalizedAmount >= 0
                ? (window.i18n?.t('wallet.rechargeDetails') || '充值详情')
                : (window.i18n?.t('wallet.orderDetails') || '订单详情');
            const typeLabel = normalizedAmount >= 0
                ? (window.i18n?.t('wallet.rechargeType') || '充值')
                : reason === 'makeup_checkin_cost'
                    ? '补签扣分'
                : (window.i18n?.t('wallet.shopPurchase') || '商品');
            const pointsLabel = `${normalizedAmount >= 0 ? '+' : '-'}${this.formatPoints(Math.abs(normalizedAmount))} ${window.i18n?.t('wallet.pointsUnit') || '积分'}`;
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
                const normalizedReferenceId = String(referenceId || '').trim();
                const taskId = String(
                    payload?.job_id ||
                    (this.looksLikeEmail(normalizedReferenceId) ? '' : normalizedReferenceId) ||
                    verifyLog?.verification_id ||
                    ''
                ).trim();
                const accountEmail = String(
                    payload?.email ||
                    (this.looksLikeEmail(normalizedReferenceId) ? normalizedReferenceId : '') ||
                    '--'
                ).trim() || '--';
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
