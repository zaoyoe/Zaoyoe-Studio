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
    const walletCssHref = 'css/wallet.css?v=20260430_WALLET_GUIDANCE_BILINGUAL_1';
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

    function getWalletModalScrollElements() {
        const { layout, content, scroller } = getWalletModalElements();
        return Array.from(new Set([scroller, content, layout].filter(Boolean)));
    }

    function getWalletRechargeScrollCueScroller() {
        const candidates = getWalletModalScrollElements();
        return candidates.find(el => el.scrollTop > 2)
            || candidates.find(el => (el.scrollHeight - el.clientHeight) > 2)
            || candidates[0]
            || null;
    }

    function setInlineStyles(target, styles) {
        const style = target?.style;
        if (!style || !styles) return;
        for (const [property, value] of Object.entries(styles)) {
            style[property] = value ?? '';
        }
    }

    function setCssVariables(target, variables) {
        const style = target?.style;
        if (!style || !variables) return;
        const setProperty = style['setProperty'].bind(style);
        const removeProperty = style['removeProperty'].bind(style);
        for (const [property, value] of Object.entries(variables)) {
            if (value === undefined || value === null || value === '') {
                removeProperty(property);
            } else {
                setProperty(property, value);
            }
        }
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
        setInlineStyles(document.documentElement, { overflow: 'hidden' });
        setCssVariables(document.body, { '--wallet-lock-top': `-${walletModalState.baseScrollY}px` });
        walletModalState.pageFrozen = true;
        stabilizeWalletModalViewport();
    }

    function unfreezeWalletModalPage() {
        if (!walletModalState.pageFrozen) return;

        const restoreScrollY = walletModalState.baseScrollY;
        document.documentElement.classList.remove('wallet-modal-lock');
        document.body.classList.remove('wallet-modal-lock');
        setInlineStyles(document.documentElement, { overflow: '' });
        setCssVariables(document.body, { '--wallet-lock-top': '' });
        walletModalState.pageFrozen = false;
        walletModalState.baseScrollY = 0;

        requestAnimationFrame(() => {
            window.scrollTo(0, restoreScrollY);
        });
    }

    function stabilizeWalletModalViewport() {
        if (!walletModalState.pageFrozen) return;

        setCssVariables(document.body, { '--wallet-lock-top': `-${walletModalState.baseScrollY}px` });

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
        setCssVariables(viewport, {
            '--wallet-modal-translate-y': '0px',
            '--wallet-modal-overlay-height': '',
            '--wallet-modal-viewport-top': '',
            '--wallet-modal-viewport-left': '',
            '--wallet-modal-viewport-width': ''
        });
        setInlineStyles(card, {
            maxHeight: '',
            height: '',
            minHeight: ''
        });
        setInlineStyles(scroller, {
            scrollPaddingBottom: '',
            scrollPaddingTop: ''
        });
        walletModalState.overlayBaseHeight = 0;
        walletModalState.overlayBaseVisualHeight = 0;
        walletModalState.focusTransferUntil = 0;
        walletModalState.lastFocusAnchor = null;
        walletModalState.lastViewportHeight = 0;
        clearWalletModalScrollAnimationState();
    }

    function updateWalletRechargeScrollCue() {
        const { overlay } = getWalletModalElements();
        const scrollHost = getWalletRechargeScrollCueScroller();
        const cue = overlay?.querySelector('.wallet-recharge-scroll-cue');
        const rechargeView = overlay?.querySelector('#view-recharge');

        if (!cue) return;

        if (!overlay || !scrollHost || !rechargeView || !overlay.classList.contains('active')) {
            cue.classList.remove('visible');
            return;
        }

        const isRechargeActive = rechargeView.classList.contains('active');
        if (!isRechargeActive) {
            cue.classList.remove('visible');
            return;
        }

        const overflowAmount = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
        if (overflowAmount < 8) {
            cue.classList.remove('visible');
            return;
        }

        const nearTop = scrollHost.scrollTop <= 2;
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

        setCssVariables(viewportEl, {
            '--wallet-modal-viewport-top': `${snapshot.top}px`,
            '--wallet-modal-viewport-left': `${snapshot.left}px`,
            '--wallet-modal-viewport-width': `${snapshot.width}px`,
            '--wallet-modal-overlay-height': `${snapshot.baseViewportHeight}px`,
            '--wallet-modal-translate-y': `${translateY}px`
        });

        overlay.classList.add('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
        setWalletModalAnimating(card, animate);
        setInlineStyles(card, {
            maxHeight: `${modalMaxHeight}px`,
            height: `${modalHeight}px`,
            minHeight: `${Math.min(400, modalHeight)}px`
        });
        setInlineStyles(scroller, {
            scrollPaddingTop: `${isWalletModalIOSMode() ? 84 : 24}px`,
            scrollPaddingBottom: `${Math.max(144, Math.round(dockInset + 72))}px`
        });

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

        setCssVariables(viewportEl, {
            '--wallet-modal-viewport-top': `${snapshot.top}px`,
            '--wallet-modal-viewport-left': `${snapshot.left}px`,
            '--wallet-modal-viewport-width': `${snapshot.width}px`,
            '--wallet-modal-overlay-height': `${snapshot.baseViewportHeight}px`,
            '--wallet-modal-translate-y': '0px'
        });

        overlay.classList.remove('keyboard-active');
        overlay.classList.add('keyboard-docked');
        overlay.classList.toggle('ios-focus-lock', preserveFocusLock);
        setWalletModalAnimating(card, animate, duration);
        setInlineStyles(card, {
            maxHeight: `${modalMaxHeight}px`,
            height: `${modalHeight}px`,
            minHeight: `${Math.min(400, modalHeight)}px`
        });
        setInlineStyles(scroller, {
            scrollPaddingTop: `${isWalletModalIOSMode() ? 84 : 24}px`,
            scrollPaddingBottom: `${preserveFocusLock ? 144 : 96}px`
        });

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

        setCssVariables(viewportEl, {
            '--wallet-modal-viewport-top': `${snapshot.top}px`,
            '--wallet-modal-viewport-left': `${snapshot.left}px`,
            '--wallet-modal-viewport-width': `${snapshot.width}px`,
            '--wallet-modal-overlay-height': `${snapshot.baseViewportHeight}px`,
            '--wallet-modal-translate-y': '0px'
        });

        overlay.classList.remove('keyboard-active', 'keyboard-docked');
        overlay.classList.toggle('ios-focus-lock', preserveFocusLock);
        setWalletModalAnimating(card, false);
        setInlineStyles(card, {
            maxHeight: `${modalMaxHeight}px`,
            height: `${modalHeight}px`,
            minHeight: `${Math.min(400, modalHeight)}px`
        });
        setInlineStyles(scroller, {
            scrollPaddingTop: `${isWalletModalIOSMode() ? 84 : 24}px`,
            scrollPaddingBottom: `${preserveFocusLock ? 144 : 96}px`
        });

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
            setCssVariables(viewportEl, {
                '--wallet-modal-overlay-height': '',
                '--wallet-modal-viewport-top': '',
                '--wallet-modal-viewport-left': '',
                '--wallet-modal-viewport-width': '',
                '--wallet-modal-translate-y': '0px'
            });
            setInlineStyles(card, {
                maxHeight: '',
                height: '',
                minHeight: ''
            });
            setInlineStyles(scroller, {
                scrollPaddingBottom: '',
                scrollPaddingTop: ''
            });
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
        overlay.hidden = false;
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

    function bindWalletHorizontalPanGuard(host, {
        dataKey = 'walletHorizontalPanGuard',
        shouldStart = () => true
    } = {}) {
        if (!host || host.dataset[dataKey] === '1') return;

        let startX = 0;
        let startY = 0;
        let touchActive = false;
        let horizontalLocked = false;

        host.addEventListener('touchstart', (event) => {
            touchActive = isWalletModalCompactMobile()
                && event.touches.length === 1
                && shouldStart(event);
            horizontalLocked = false;

            if (!touchActive) return;

            const touch = event.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
        }, { passive: true });

        host.addEventListener('touchmove', (event) => {
            if (!touchActive || !isWalletModalCompactMobile() || event.touches.length !== 1) return;

            const touch = event.touches[0];
            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;

            if (!horizontalLocked) {
                const absX = Math.abs(deltaX);
                const absY = Math.abs(deltaY);
                horizontalLocked = absX > 8 && absX > absY * 1.2;
            }

            if (horizontalLocked && event.cancelable) {
                event.preventDefault();
            }
        }, { passive: false });

        const resetTouch = () => {
            touchActive = false;
            horizontalLocked = false;
        };

        host.addEventListener('touchend', resetTouch, { passive: true });
        host.addEventListener('touchcancel', resetTouch, { passive: true });
        host.dataset[dataKey] = '1';
    }

    function bindWalletContentTouchLock(overlay) {
        const content = overlay?.querySelector('.wallet-content');
        bindWalletHorizontalPanGuard(content, {
            dataKey: 'walletContentTouchLock',
            shouldStart: (event) => {
                const target = event.target?.closest ? event.target : event.target?.parentElement;
                return !target?.closest?.('input, textarea, select, [contenteditable="true"], [data-wallet-allow-horizontal-pan]');
            }
        });
    }

    function bindWalletRecordsTouchLock(overlay) {
        const ordersView = overlay?.querySelector('#view-orders');
        const isRecordsListTouch = (event) => {
            const target = event.target?.closest ? event.target : event.target?.parentElement;
            return Boolean(target?.closest?.('.orders-container'));
        };

        bindWalletHorizontalPanGuard(ordersView, {
            dataKey: 'walletRecordsTouchLock',
            shouldStart: isRecordsListTouch
        });
    }

    function attachWalletModalViewportHandlers() {
        detachWalletModalViewportHandlers();
        bindWalletModalInputs();
        captureWalletModalOverlayBaseHeight(true);
        requestWalletRechargeScrollCueUpdate();

        const scrollElements = getWalletModalScrollElements();
        const handleContentScroll = () => {
            requestWalletRechargeScrollCueUpdate();
        };

        scrollElements.forEach(el => el.addEventListener('scroll', handleContentScroll, { passive: true }));

        if (!isWalletModalIOSMode()) {
            scheduleWalletModalLayout();
            window.addEventListener('resize', handleContentScroll, { passive: true });
            walletModalState.viewportCleanup = () => {
                window.removeEventListener('resize', handleContentScroll);
                scrollElements.forEach(el => el.removeEventListener('scroll', handleContentScroll));
                walletModalState.viewportCleanup = null;
            };
            return;
        }

        freezeWalletModalPage();
        const vv = window.visualViewport;
        const handleViewportChange = () => {
            requestWalletModalViewportSync();
        };

        const handleRootScroll = () => {
            stabilizeWalletModalViewport();
        };

        vv?.addEventListener('resize', handleViewportChange, { passive: true });
        vv?.addEventListener('scroll', handleViewportChange, { passive: true });
        window.addEventListener('scroll', handleRootScroll, { passive: true });
        window.addEventListener('resize', handleViewportChange, { passive: true });

        walletModalState.viewportCleanup = () => {
            vv?.removeEventListener('resize', handleViewportChange);
            vv?.removeEventListener('scroll', handleViewportChange);
            window.removeEventListener('scroll', handleRootScroll);
            window.removeEventListener('resize', handleViewportChange);
            scrollElements.forEach(el => el.removeEventListener('scroll', handleContentScroll));
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

    function trackWalletAnalyticsEvent(eventName, payload = {}, options = {}) {
        const tracker = window.UserEventTracker;
        if (!tracker || typeof tracker.track !== 'function') {
            return;
        }

        const metadata = payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
            ? payload.metadata
            : {};
        const normalizedPayload = {
            module: payload.module || 'wallet_modal',
            entityType: payload.entityType || 'wallet',
            entityId: payload.entityId || null,
            eventValue: payload.eventValue ?? null,
            pointsDelta: payload.pointsDelta ?? null,
            metadata
        };

        const trackingPromise = options.dedupeKey && typeof tracker.trackOnce === 'function'
            ? tracker.trackOnce(options.dedupeKey, eventName, normalizedPayload, { eventType: options.eventType || 'conversion' })
            : tracker.track(eventName, normalizedPayload, { eventType: options.eventType || 'conversion' });

        void Promise.resolve(trackingPromise).catch((error) => {
            console.debug('[WalletAnalytics] Track failed:', eventName, error?.message || error);
        });
    }

    function buildWalletSourceMetadata(context = {}) {
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};

        return {
            entry: String(normalizedContext.entry || '').trim() || 'wallet',
            initial_view: String(normalizedContext.initial_view || normalizedContext.initialView || '').trim() || 'balance',
            source_module: String(normalizedContext.source_module || normalizedContext.sourceModule || '').trim() || null
        };
    }

    function resetWalletSidebarIndicatorState() {
        const sidebar = document.querySelector('.wallet-sidebar');
        const indicator = document.querySelector('.sidebar-indicator');

        sidebar?.classList.remove('wallet-sidebar--indicator-ready');
        if (indicator) {
            setInlineStyles(indicator, {
                opacity: '0'
            });
        }
    }

    const WalletModal = {
        isOpen: false,
        modalEl: null,
        pendingRechargeAction: null,
        lastOpenContext: null,
        promptCache: {}, // Local simple cache for titles
        verifyLogCache: {},
        affiliateStats: null,
        affiliatePosterConfig: null,
        checkinConfig: null,
        rechargeOptionsConfig: null,
        discountAssetsData: null,
        discountAssetsLoaded: false,
        discountAssetsLoading: false,
        discountAssetsLoadError: '',
        discountAssetsActiveTab: 'available',
        discountAssetsSummaryFilter: 'available',
        discountAssetsExpandedKey: '',
        discountAssetsRemovingId: '',

        escapeAttribute(text) {
            return String(text ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },

        encodeActionValue(value) {
            return encodeURIComponent(String(value ?? ''));
        },

        decodeActionValue(value) {
            try {
                return decodeURIComponent(String(value ?? ''));
            } catch (_error) {
                return String(value ?? '');
            }
        },

        tr(key, fallback = '', params = {}) {
            const translated = window.i18n?.t?.(key) || fallback || '';
            return String(translated).replace(/\{(\w+)\}/g, (match, name) => (
                params[name] === undefined || params[name] === null ? match : String(params[name])
            ));
        },

        isEnglishLanguage() {
            return window.i18n?.isEnglish?.() || window.i18n?.getCurrentLanguage?.() === 'en';
        },

        containsCjkText(value = '') {
            return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
        },

        formatPointsWithUnit(value) {
            return `${this.formatPoints(value)} ${this.tr('wallet.pointsUnit', '积分')}`;
        },

        getLocalizedProductNameFromPayload(source = {}, fallback = '') {
            const payload = source && typeof source === 'object' ? source : {};
            const product = payload.shop_product || payload.shop_products || payload.product || {};
            const englishCandidates = [
                payload.snapshot_product_name_en,
                payload.product_name_en,
                payload.name_en,
                product.name_en,
                Array.isArray(payload.shop_order_items) ? payload.shop_order_items.find((item) => item?.name_en)?.name_en : ''
            ];
            const defaultCandidates = [
                payload.snapshot_product_name,
                payload.product_name,
                payload.name,
                product.name,
                Array.isArray(payload.shop_order_items) ? payload.shop_order_items.find((item) => item?.snapshot_product_name)?.snapshot_product_name : ''
            ];

            if (this.isEnglishLanguage()) {
                const englishName = englishCandidates.find((value) => String(value || '').trim());
                if (englishName) return String(englishName).trim();
            }

            const defaultName = defaultCandidates.find((value) => String(value || '').trim());
            return defaultName ? String(defaultName).trim() : fallback;
        },

        getLocalizedDiscountBenefitLabel(asset = {}) {
            const discountType = String(asset?.discount_type || '').trim().toLowerCase();
            const discountValue = Number(asset?.discount_value);
            const explicitLabel = String(asset?.benefit_label || '').trim();
            const isEnglish = this.isEnglishLanguage();

            if (discountType === 'percent' && Number.isFinite(discountValue) && discountValue > 0) {
                const offPercent = Math.max(0, Math.min(100, Number((100 - discountValue).toFixed(2))));
                if (isEnglish) {
                    return this.tr('wallet.percentOff', '{value}% off', { value: this.formatPoints(offPercent) });
                }
                return explicitLabel || `${this.formatPoints(discountValue / 10)}折`;
            }

            if (discountType === 'fixed' && Number.isFinite(discountValue) && discountValue > 0) {
                if (isEnglish) {
                    return this.tr('wallet.fixedOff', '{value} {unit} off', {
                        value: this.formatPoints(discountValue),
                        unit: this.tr('wallet.pointsUnit', '积分')
                    });
                }
                return explicitLabel || `立减 ${this.formatPoints(discountValue)} 积分`;
            }

            if (isEnglish && this.containsCjkText(explicitLabel)) {
                return String(asset?.code || '').trim() || this.tr('wallet.cardFallback', 'Coupon');
            }

            return explicitLabel || String(asset?.code || '').trim() || this.tr('wallet.cardFallback', '卡券');
        },

        getLocalizedDiscountScopeLabel(asset = {}) {
            const scopeType = String(asset?.scope_type || '').trim().toLowerCase();
            const category = String(asset?.scope_category || asset?.category || '').trim();
            const productName = this.getLocalizedProductNameFromPayload(asset?.scope_product || {}, '');

            if (scopeType === 'product') {
                return productName
                    ? this.tr('wallet.specificProduct', '指定商品 · {product}', { product: productName })
                    : this.tr('wallet.specificProductOnly', '指定商品');
            }
            if (scopeType === 'category') {
                return category
                    ? this.tr('wallet.categoryOnly', '分类 · {category}', { category })
                    : this.tr('wallet.categoryLimited', '指定分类');
            }
            return this.tr('wallet.allProducts', '全场可用');
        },

        getLocalizedDiscountSourceLabel(asset = {}) {
            const explicitLabel = String(asset?.source_label || '').trim();
            if (explicitLabel && (!this.isEnglishLanguage() || !this.containsCjkText(explicitLabel))) {
                return explicitLabel;
            }

            const sourceChannel = String(asset?.source_channel || asset?.source_type || '').trim().toLowerCase();
            const distributionMode = String(asset?.distribution_mode || '').trim().toLowerCase();

            if (sourceChannel.includes('checkin')) return this.tr('wallet.checkinCoupon', '签到卡券');
            if (sourceChannel.includes('affiliate') || sourceChannel.includes('invite')) return this.tr('wallet.affiliateReward', '推广奖励');
            if (sourceChannel.includes('wallet') || sourceChannel.includes('recharge')) return this.tr('wallet.rechargeCoupon', '充值赠券');
            if (sourceChannel.includes('claim')) return this.tr('wallet.publicClaim', '公开领取');
            if (sourceChannel.includes('manual') || sourceChannel.includes('admin')) return this.tr('wallet.adminIssued', '后台发放');
            if (distributionMode === 'public_claim') return this.tr('wallet.publicClaim', '公开领取');
            if (distributionMode === 'user_assigned') return this.tr('wallet.assignedCoupon', '定向发放');
            return this.tr('wallet.couponAsset', '卡券资产');
        },

        getLocalizedDiscountStatusLabel(asset = {}, tabId = this.discountAssetsActiveTab) {
            const explicitLabel = String(asset?.status_label || '').trim();
            if (explicitLabel && (!this.isEnglishLanguage() || !this.containsCjkText(explicitLabel))) {
                return explicitLabel;
            }

            const tone = String(asset?.status_tone || '').trim().toLowerCase();
            const group = String(asset?.status_group || tabId || '').trim().toLowerCase();
            if (tone === 'used' || group === 'used') return this.tr('wallet.used', '已使用');
            if (tone === 'inactive' || group === 'inactive') {
                const lifecycle = String(asset?.lifecycle_key || '').trim().toLowerCase();
                if (lifecycle.includes('expire')) return this.tr('wallet.expired', '已过期');
                if (lifecycle.includes('revoke') || lifecycle.includes('disable')) return this.tr('wallet.revoked', '已停用');
                if (lifecycle.includes('scheduled') || lifecycle.includes('not_started')) return this.tr('wallet.scheduled', '待生效');
                return this.tr('wallet.inactive', '已失效');
            }
            return this.tr('wallet.available', '可用');
        },

        getLocalizedDiscountStatusDetail(asset = {}, tabId = this.discountAssetsActiveTab) {
            const explicitDetail = String(asset?.status_detail || asset?.scoped_product_message || '').trim();
            if (explicitDetail && (!this.isEnglishLanguage() || !this.containsCjkText(explicitDetail))) {
                return explicitDetail;
            }

            if (tabId === 'used') {
                const productName = this.getLocalizedProductNameFromPayload(asset?.related_order || {}, '');
                return productName
                    ? this.tr('wallet.usedInProduct', '已用于 {product}', { product: productName })
                    : this.tr('wallet.usedInStoreOrder', '已用于商城订单');
            }

            if (tabId === 'inactive' || String(asset?.status_tone || '').trim() === 'inactive') {
                if (asset?.effective_expires_at || asset?.expires_at) {
                    return this.tr('wallet.couponExpired', '该卡券已过期');
                }
                return this.tr('wallet.unavailable', '暂不可用');
            }

            if (asset?.scope_type === 'product') {
                return this.tr('wallet.openProductToUse', '打开指定商品后可使用');
            }

            return this.tr('wallet.chooseAtCheckout', '下单时可直接选择');
        },

        buildDataAttributes(attributes = {}) {
            return Object.entries(attributes)
                .filter(([, value]) => value !== undefined && value !== null && value !== false)
                .map(([name, value]) => ` data-${name}="${this.escapeAttribute(String(value))}"`)
                .join('');
        },

        bindDelegatedHandlers(overlay = this.modalEl) {
            if (!overlay || overlay.dataset.walletDelegatesBound === '1') {
                return;
            }

            overlay.dataset.walletDelegatesBound = '1';
            bindWalletContentTouchLock(overlay);
            bindWalletRecordsTouchLock(overlay);

            overlay.addEventListener('click', (event) => {
                const actionEl = event.target.closest('[data-wallet-action]');
                if (!actionEl || !overlay.contains(actionEl)) {
                    return;
                }

                this.handleDelegatedAction(actionEl.dataset.walletAction, actionEl, event);
            });

            overlay.addEventListener('focusin', (event) => {
                const menuItem = event.target.closest('.wallet-menu-item');
                if (!menuItem || !overlay.contains(menuItem)) {
                    return;
                }

                this.updateIndicatorPosition(menuItem);
            });

            overlay.addEventListener('focusout', (event) => {
                const menuItem = event.target.closest('.wallet-menu-item');
                if (!menuItem || !overlay.contains(menuItem)) {
                    return;
                }

                requestAnimationFrame(() => {
                    const sidebar = menuItem.closest('.wallet-sidebar');
                    if (sidebar && !sidebar.contains(document.activeElement)) {
                        this.updateIndicatorPosition();
                    }
                });
            });

            overlay.addEventListener('input', (event) => {
                const inputEl = event.target.closest('[data-wallet-input-action]');
                if (!inputEl || !overlay.contains(inputEl)) {
                    return;
                }

                if (inputEl.dataset.walletInputAction === 'order-search') {
                    this.handleOrderSearchInput(event);
                }
            });

            overlay.addEventListener('keydown', (event) => {
                const keydownEl = event.target.closest('[data-wallet-keydown-action]');
                if (keydownEl && overlay.contains(keydownEl) && keydownEl.dataset.walletKeydownAction === 'order-search') {
                    this.handleOrderSearchKeydown(event);
                    return;
                }

                const enterEl = event.target.closest('[data-wallet-enter-action]');
                if (!enterEl || !overlay.contains(enterEl) || event.key !== 'Enter') {
                    return;
                }

                event.preventDefault();
                this.handleDelegatedAction(enterEl.dataset.walletEnterAction, enterEl, event);
            });
        },

        handleDelegatedAction(action, actionEl, event) {
            switch (action) {
                case 'switch-view':
                    this.switchView(actionEl.dataset.walletViewId || 'balance');
                    break;
                case 'redeem-code':
                    this.redeemCode();
                    break;
                case 'custom-recharge':
                    this.customRecharge();
                    break;
                case 'query-afdian-code':
                    this.queryAfdianCode();
                    break;
                case 'clear-order-search':
                    this.clearOrderSearch(event);
                    break;
                case 'toggle-order-time-filter-menu':
                    this.toggleOrderTimeFilterMenu(event);
                    break;
                case 'select-order-time-filter': {
                    const value = actionEl.dataset.walletFilterValue || 'all';
                    if (value === 'custom') {
                        this.showOrderCustomDate();
                    } else {
                        this.selectOrderTimeFilter(value, actionEl.dataset.walletFilterLabel || actionEl.textContent.trim());
                    }
                    break;
                }
                case 'toggle-order-filter-menu':
                    this.toggleOrderFilterMenu(event);
                    break;
                case 'select-order-filter':
                    this.selectOrderFilter(
                        actionEl.dataset.walletFilterValue || 'all',
                        actionEl.dataset.walletFilterLabel || actionEl.textContent.trim()
                    );
                    break;
                case 'clear-orders':
                    this.clearOrders();
                    break;
                case 'select-affiliate-link':
                    actionEl.select?.();
                    break;
                case 'copy-affiliate-link':
                    this.copyAffiliateLink();
                    break;
                case 'generate-affiliate-poster':
                    this.generateAffiliatePoster();
                    break;
                case 'select-discount-assets-summary-filter':
                    this.discountAssetsSummaryFilter = actionEl.dataset.walletSummaryFilter || 'available';
                    this.discountAssetsExpandedKey = '';
                    this.renderDiscountAssetsView();
                    break;
                case 'select-discount-assets-tab':
                    this.discountAssetsActiveTab = actionEl.dataset.walletTabId || 'available';
                    this.discountAssetsSummaryFilter = this.discountAssetsActiveTab === 'inactive' ? 'expiring' : 'available';
                    this.discountAssetsExpandedKey = '';
                    this.renderDiscountAssetsView();
                    break;
                case 'toggle-discount-asset-card': {
                    const assetKey = actionEl.dataset.walletAssetKey || '';
                    this.discountAssetsExpandedKey = this.discountAssetsExpandedKey === assetKey ? '' : assetKey;
                    this.renderDiscountAssetsView();
                    break;
                }
                case 'remove-discount-asset':
                    event.preventDefault();
                    event.stopPropagation();
                    this.removeDiscountAsset(this.decodeActionValue(actionEl.dataset.walletDiscountAssetId));
                    break;
                case 'refresh-discount-assets':
                    this.loadDiscountAssets(true).catch((error) => {
                        console.error('[WalletModal] Refresh discount assets failed:', error);
                    });
                    break;
                case 'open-discount-assets-shop':
                    this.close();
                    window.location.href = '/shop.html';
                    break;
                case 'open-discount-assets-product': {
                    const assetId = this.decodeActionValue(actionEl.dataset.walletDiscountAssetId);
                    const productId = this.decodeActionValue(actionEl.dataset.walletProductId);
                    const productCategory = this.decodeActionValue(actionEl.dataset.walletProductCategory);
                    const availableAssets = this.getDiscountAssetsListByTab('available');
                    const matchedAsset = availableAssets.find((asset) => String(asset?.asset_id || asset?.id || '').trim() === String(assetId || '').trim()) || null;
                    const prefill = this.buildShopPurchasePrefillFromAsset(matchedAsset, {
                        productId,
                        productCategory
                    });
                    this.persistShopPurchasePrefill(prefill);
                    const query = new URLSearchParams();
                    if (productId) {
                        query.set('productId', productId);
                    }
                    if (productCategory) {
                        query.set('category', productCategory);
                    }
                    this.close();
                    window.location.href = query.toString() ? `/shop.html?${query.toString()}` : '/shop.html';
                    break;
                }
                case 'jump-discount-assets-orders':
                    this.switchView('orders');
                    break;
                case 'toggle-affiliate-member-details':
                    this.toggleAffiliateMemberDetails({ currentTarget: actionEl, target: event.target });
                    break;
                case 'buy-package':
                    this.buyPackage(
                        this.decodeActionValue(actionEl.dataset.walletPackageId),
                        this.decodeActionValue(actionEl.dataset.walletPackageName)
                    );
                    break;
                case 'daily-checkin-v2':
                    this.dailyCheckinV2();
                    break;
                case 'makeup-checkin':
                    this.makeupCheckin(this.decodeActionValue(actionEl.dataset.walletDateValue));
                    break;
                case 'toggle-history-item-details':
                    this.toggleItemDetails(actionEl);
                    break;
                case 'history-details':
                    event.stopPropagation();
                    break;
                case 'copy-value':
                    this.copyToClipboard(this.decodeActionValue(actionEl.dataset.walletCopyValue), event);
                    break;
                case 'open-order-detail':
                    event.stopPropagation();
                    this.handleOpenOrderDetailAction(actionEl);
                    break;
                default:
                    break;
            }
        },

        handleOpenOrderDetailAction(actionEl) {
            const orderKind = actionEl.dataset.walletOrderKind || '';

            switch (orderKind) {
                case 'prompt':
                    this.showPromptOrderDetail(
                        this.decodeActionValue(actionEl.dataset.walletOrderId),
                        this.decodeActionValue(actionEl.dataset.walletPromptName),
                        Number(actionEl.dataset.walletPrice || 0),
                        this.decodeActionValue(actionEl.dataset.walletCreatedAt),
                        this.decodeActionValue(actionEl.dataset.walletPromptId)
                    );
                    break;
                case 'verify':
                    this.showVerifyOrderDetail(
                        this.decodeActionValue(actionEl.dataset.walletOrderId),
                        this.decodeActionValue(actionEl.dataset.walletReferenceId),
                        Number(actionEl.dataset.walletPointsPaid || 0),
                        this.decodeActionValue(actionEl.dataset.walletCreatedAt),
                        this.decodeActionValue(actionEl.dataset.walletReason)
                    );
                    break;
                case 'shop':
                    this.showOrderDetail(this.decodeActionValue(actionEl.dataset.walletOrderId));
                    break;
                case 'affiliate':
                    this.showAffiliateRewardDetail(
                        this.decodeActionValue(actionEl.dataset.walletOrderId),
                        Number(actionEl.dataset.walletAmount || 0),
                        this.decodeActionValue(actionEl.dataset.walletCreatedAt),
                        this.decodeActionValue(actionEl.dataset.walletReason),
                        this.decodeActionValue(actionEl.dataset.walletReferenceId)
                    );
                    break;
                case 'recharge':
                    this.showRechargeOrderDetail(
                        this.decodeActionValue(actionEl.dataset.walletOrderId),
                        Number(actionEl.dataset.walletAmount || 0),
                        this.decodeActionValue(actionEl.dataset.walletCreatedAt),
                        this.decodeActionValue(actionEl.dataset.walletReason),
                        this.decodeActionValue(actionEl.dataset.walletReferenceId),
                        {
                            balanceBefore: this.readOptionalPointDataset(actionEl.dataset.walletBalanceBefore),
                            balanceAfter: this.readOptionalPointDataset(actionEl.dataset.walletBalanceAfter)
                        }
                    );
                    break;
                case 'redeem':
                    this.showRedeemOrderDetail(
                        this.decodeActionValue(actionEl.dataset.walletOrderId),
                        Number(actionEl.dataset.walletAmount || 0),
                        this.decodeActionValue(actionEl.dataset.walletCreatedAt),
                        this.decodeActionValue(actionEl.dataset.walletRedeemCode)
                    );
                    break;
                default:
                    break;
            }
        },

        bindOverlayCloseButtons(detailOverlay) {
            detailOverlay.querySelectorAll('.js-wallet-order-close').forEach((button) => {
                button.addEventListener('click', () => detailOverlay.remove());
            });
        },

        openShopProductFromWalletDetail(productId = '', detailOverlay = null) {
            const normalizedProductId = String(productId || '').trim();
            if (!normalizedProductId) return;

            detailOverlay?.remove?.();
            this.close();

            if (
                /\/shop\.html$/i.test(window.location.pathname || '')
                && window.ShopClient
                && typeof window.ShopClient.jumpToDiscountTargetProduct === 'function'
            ) {
                void window.ShopClient.jumpToDiscountTargetProduct(normalizedProductId, {
                    autoOpen: true
                });
                return;
            }

            window.location.href = `/shop.html?productId=${encodeURIComponent(normalizedProductId)}`;
        },

        openPromptFromWalletDetail(promptId = '', detailOverlay = null) {
            const normalizedPromptId = String(promptId || '').trim();
            if (!normalizedPromptId) return;

            detailOverlay?.remove?.();
            this.close();
            window.location.href = `/prompts.html?id=${encodeURIComponent(normalizedPromptId)}`;
        },

        isVerifyServiceReason(reason = '') {
            const normalized = String(reason || '').trim().toLowerCase();
            return normalized.includes('google one');
        },

        resolveVerifyTaskType(reason = '', payload = {}) {
            const payloadTaskType = String(payload?.task_type || '').trim().toLowerCase();
            if (payloadTaskType === 'full') return 'full';
            if (payloadTaskType === 'extract') return 'extract';

            const normalizedReason = String(reason || '').trim().toLowerCase();
            if (normalizedReason.includes('绑卡') || normalizedReason.includes('full flow')) {
                return 'full';
            }
            return 'extract';
        },

        getVerifyDisplayName(reason = '', payload = {}) {
            return this.resolveVerifyTaskType(reason, payload) === 'full'
                ? (window.i18n?.t('wallet.verifyOrderNameFull') || 'Google One 全流程包绑卡')
                : (window.i18n?.t('wallet.verifyOrderName') || 'Google One Pro 试用链接');
        },

        getVerifyTaskTypeLabel(reason = '', payload = {}) {
            return this.resolveVerifyTaskType(reason, payload) === 'full'
                ? (window.i18n?.t('wallet.verifyServiceTypeFull') || 'Google One / 全流程包绑卡')
                : (window.i18n?.t('wallet.verifyServiceTypeExtract') || 'Google One / 仅提链');
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

        isAffiliateRewardReason(reason = '', referenceId = '') {
            const rawReason = String(reason || '').trim();
            const normalizedRef = String(referenceId || '').trim().toUpperCase();

            return rawReason.startsWith('推广返佣')
                || rawReason.startsWith('拉新固定奖励')
                || rawReason.startsWith('邀请拉新奖励')
                || normalizedRef.startsWith('AFFILIATE_REWARD_')
                || normalizedRef.startsWith('AFF_REW_')
                || normalizedRef.startsWith('REG_REWARD_');
        },

        getAffiliateRewardMeta(reason = '', referenceId = '') {
            const rawReason = String(reason || '').trim();
            const normalizedRef = String(referenceId || '').trim().toUpperCase();

            if (normalizedRef.startsWith('REG_REWARD_UNLOCK_RECHARGE_') || rawReason.includes('首充激活')) {
                return {
                    rewardType: 'registration_reward',
                    sourceKind: 'recharge',
                    label: this.tr('wallet.inviteFirstRechargeReward', '邀请首充奖励'),
                    icon: 'fa-gift',
                    color: '#34d399'
                };
            }

            if (normalizedRef.startsWith('REG_REWARD_UNLOCK_') || rawReason.includes('首单激活')) {
                return {
                    rewardType: 'registration_reward',
                    sourceKind: 'purchase',
                    label: this.tr('wallet.invitePurchaseReward', '邀请消费奖励'),
                    icon: 'fa-seedling',
                    color: '#f59e0b'
                };
            }

            if (normalizedRef.startsWith('REG_REWARD_') || rawReason.startsWith('邀请拉新奖励')) {
                return {
                    rewardType: 'registration_reward',
                    sourceKind: 'register',
                    label: this.tr('wallet.inviteRegisterReward', '邀请注册奖励'),
                    icon: 'fa-user-check',
                    color: '#8b5cf6'
                };
            }

            return {
                rewardType: 'commission',
                sourceKind: 'purchase',
                label: this.tr('wallet.affiliateCommission', '推广返佣'),
                icon: 'fa-share-alt',
                color: '#38bdf8'
            };
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
                return this.tr('wallet.makeupCheckinCost', '补签扣分');
            }

            if (rawReason === 'signup_bonus') {
                return this.tr('wallet.signupBonus', '注册奖励');
            }

            if (rawReason === 'custom_recharge') {
                return this.tr('wallet.customRecharge', '自定义充值');
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

        getLedgerTransactionTypeLabel(reason = '', amount = 0) {
            const rawReason = String(reason || '').trim();
            const normalizedAmount = this.normalizePointValue(amount, 0);

            if (!rawReason) {
                return normalizedAmount >= 0
                    ? (window.i18n?.t('wallet.rechargeType') || '充值')
                    : (window.i18n?.t('wallet.shopPurchase') || '商品');
            }

            if (rawReason === 'daily_checkin') {
                return window.i18n?.t('wallet.dailyCheckin') || '每日签到';
            }

            if (rawReason === 'makeup_checkin_cost') {
                return this.tr('wallet.makeupCheckinCost', '补签扣分');
            }

            if (rawReason === 'signup_bonus') {
                return this.tr('wallet.signupBonus', '注册奖励');
            }

            if (rawReason === 'custom_recharge') {
                return this.tr('wallet.customRecharge', '自定义充值');
            }

            if (rawReason.startsWith('模拟充值:') || rawReason.startsWith('模拟充值：')) {
                return this.tr('wallet.mockPayment', '模拟充值');
            }

            if (rawReason.startsWith('admin_manual')) {
                return window.i18n?.t('wallet.adminAdjustment') || '管理员调整';
            }

            if (rawReason === 'package_purchase' || rawReason === 'afdian_recharge') {
                return window.i18n?.t('wallet.rechargeType') || '充值';
            }

            return normalizedAmount >= 0
                ? this.getRechargeDisplayName(rawReason)
                : (window.i18n?.t('wallet.shopPurchase') || '商品');
        },

        normalizePointValue(value, fallback = 0) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
        },

        normalizeOptionalPointValue(value) {
            if (value === null || value === undefined || String(value).trim() === '') {
                return null;
            }
            const parsed = Number(value);
            return Number.isFinite(parsed) ? this.normalizePointValue(parsed) : null;
        },

        readOptionalPointDataset(value) {
            const rawValue = String(value ?? '').trim();
            if (!rawValue) return null;
            return this.normalizeOptionalPointValue(this.decodeActionValue(rawValue));
        },

        getCurrentWalletTotalBalance() {
            const fromState = this.normalizeOptionalPointValue(this.currentWalletBalance?.total_balance);
            if (fromState !== null) {
                return fromState;
            }

            const totalEl = document.getElementById('wallet-total');
            const rawValue = totalEl?.dataset?.value || totalEl?.textContent || '';
            const normalizedText = String(rawValue).replace(/[^\d.-]/g, '');
            return this.normalizeOptionalPointValue(normalizedText);
        },

        applyWalletBalance(balance = {}, { animate = true } = {}) {
            const normalizedBalance = {
                ...balance,
                total_balance: this.normalizePointValue(balance?.total_balance),
                paid_balance: this.normalizePointValue(balance?.paid_balance),
                bonus_balance: this.normalizePointValue(balance?.bonus_balance)
            };

            this.currentWalletBalance = normalizedBalance;

            const totalEl = document.getElementById('wallet-total');
            if (totalEl) {
                const currentVal = this.normalizePointValue(totalEl.dataset.value || totalEl.textContent || 0);
                const newVal = this.normalizePointValue(normalizedBalance.total_balance);
                if (animate) {
                    this.animateValue(totalEl, currentVal, newVal, 800);
                } else {
                    totalEl.textContent = this.formatPoints(newVal);
                }
                totalEl.dataset.value = newVal;
            }

            const paidEl = document.getElementById('wallet-paid');
            if (paidEl) paidEl.textContent = this.formatPoints(normalizedBalance.paid_balance);

            const bonusEl = document.getElementById('wallet-bonus');
            if (bonusEl) bonusEl.textContent = this.formatPoints(normalizedBalance.bonus_balance);

            this.renderBalanceContext(normalizedBalance);
            return normalizedBalance;
        },

        restoreWalletBalanceFromCache({ animate = false } = {}) {
            const pointsService = window.PointsService;
            if (!pointsService?.peekWalletBalance) {
                return false;
            }

            const cachedBalance = pointsService.peekWalletBalance({
                site: window.SiteConfig?.site || 'cn'
            });
            if (!cachedBalance) {
                return false;
            }

            this.applyWalletBalance(cachedBalance, { animate });
            return true;
        },

        async ensureWalletBalanceForOrderSnapshots() {
            if (this.getCurrentWalletTotalBalance() !== null) {
                return true;
            }

            const pointsService = window.PointsService;
            if (!pointsService?.getBalance) {
                return false;
            }

            try {
                const balance = await pointsService.getBalance();
                if (balance?._load_failed) {
                    return false;
                }

                const totalBalance = this.normalizeOptionalPointValue(balance?.total_balance);
                if (totalBalance === null) {
                    return false;
                }

                this.currentWalletBalance = {
                    ...balance,
                    total_balance: totalBalance,
                    paid_balance: this.normalizePointValue(balance?.paid_balance),
                    bonus_balance: this.normalizePointValue(balance?.bonus_balance)
                };
                return true;
            } catch (error) {
                console.warn('[WalletModal] Balance snapshot preload failed:', error);
                return false;
            }
        },

        annotateLedgerEntriesWithBalanceSnapshots(ledgerEntries = []) {
            const currentTotal = this.getCurrentWalletTotalBalance();
            if (currentTotal === null || !Array.isArray(ledgerEntries) || ledgerEntries.length === 0) {
                return ledgerEntries;
            }

            const snapshotsById = new Map();
            let runningBalance = currentTotal;
            [...ledgerEntries]
                .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))
                .forEach((entry) => {
                    const entryId = String(entry?.id || '').trim();
                    if (!entryId) return;

                    const entryAmount = this.normalizePointValue(entry?.amount);
                    const balanceAfter = this.normalizePointValue(runningBalance);
                    const balanceBefore = this.normalizePointValue(balanceAfter - entryAmount);
                    snapshotsById.set(entryId, {
                        balanceBefore,
                        balanceAfter
                    });
                    runningBalance = balanceBefore;
                });

            return ledgerEntries.map((entry) => {
                const snapshot = snapshotsById.get(String(entry?.id || '').trim());
                return snapshot ? { ...entry, ...snapshot } : entry;
            });
        },

        resolveOrderBalanceSnapshot(orderId = '', balanceSnapshot = {}) {
            const directBefore = this.normalizeOptionalPointValue(balanceSnapshot?.balanceBefore);
            const directAfter = this.normalizeOptionalPointValue(balanceSnapshot?.balanceAfter);
            if (directBefore !== null && directAfter !== null) {
                return {
                    balanceBefore: directBefore,
                    balanceAfter: directAfter
                };
            }

            const normalizedOrderId = String(orderId || '').trim();
            if (!normalizedOrderId) {
                return {
                    balanceBefore: directBefore,
                    balanceAfter: directAfter
                };
            }

            const orderPools = [
                ...(this.browseOrdersSnapshot || []),
                ...(this.ordersData || [])
            ];
            const existingOrder = orderPools.find((order) => String(order?.id || '').trim() === normalizedOrderId);
            const existingBefore = this.normalizeOptionalPointValue(existingOrder?.balanceBefore);
            const existingAfter = this.normalizeOptionalPointValue(existingOrder?.balanceAfter);
            if (existingBefore !== null && existingAfter !== null) {
                return {
                    balanceBefore: existingBefore,
                    balanceAfter: existingAfter
                };
            }

            const currentTotal = this.getCurrentWalletTotalBalance();
            if (currentTotal === null || orderPools.length === 0) {
                return {
                    balanceBefore: directBefore ?? existingBefore,
                    balanceAfter: directAfter ?? existingAfter
                };
            }

            const seenIds = new Set();
            const sortedOrders = orderPools
                .filter((order) => {
                    const id = String(order?.id || '').trim();
                    if (!id || seenIds.has(id)) return false;
                    seenIds.add(id);
                    return true;
                })
                .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0));
            const snapshotsById = new Map();
            let runningBalance = currentTotal;

            sortedOrders.forEach((order) => {
                const id = String(order?.id || '').trim();
                const signedAmount = order?.isShopOrder
                    ? -this.normalizePointValue(order?.total_price || 0)
                    : this.normalizePointValue(order?.amount ?? order?.total_price ?? 0);

                const balanceAfter = this.normalizePointValue(runningBalance);
                const balanceBefore = this.normalizePointValue(balanceAfter - signedAmount);
                snapshotsById.set(id, {
                    balanceBefore,
                    balanceAfter
                });
                runningBalance = balanceBefore;
            });

            const resolved = snapshotsById.get(normalizedOrderId) || {};
            return {
                balanceBefore: this.normalizeOptionalPointValue(resolved.balanceBefore ?? directBefore ?? existingBefore),
                balanceAfter: this.normalizeOptionalPointValue(resolved.balanceAfter ?? directAfter ?? existingAfter)
            };
        },

        formatPoints(value) {
            const normalized = this.normalizePointValue(value, 0);
            const hasDecimal = Math.abs(normalized % 1) > 0.0001;
            return normalized.toLocaleString(undefined, {
                minimumFractionDigits: hasDecimal ? (Math.abs(normalized * 10 - Math.round(normalized * 10)) > 0.0001 ? 2 : 1) : 0,
                maximumFractionDigits: 2
            });
        },

        formatCny(value) {
            const normalized = Number(value);
            return Number.isFinite(normalized)
                ? normalized.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                })
                : '0.00';
        },

        isMobilePaymentBrowser() {
            const userAgent = String(window.navigator?.userAgent || '').trim().toLowerCase();
            if (!userAgent) return false;
            return /android|iphone|ipad|ipod|mobile|micromessenger|wechat|harmonyos/.test(userAgent);
        },

        isHostedPaymentQrDesktopLayout() {
            return !window.matchMedia('(max-width: 760px)').matches;
        },

        openPaymentCheckoutUrl(checkoutUrl, options = {}) {
            const url = String(checkoutUrl || '').trim();
            if (!url) {
                throw new Error(this.tr('wallet.missingPaymentLink', '缺少支付链接'));
            }

            const useSameTab = options.sameTab === true || this.isMobilePaymentBrowser();
            if (useSameTab) {
                window.location.assign(url);
                return 'same-tab';
            }

            const popup = window.open(url, '_blank');
            if (popup) {
                try {
                    popup.opener = null;
                } catch (_) {
                    // Best effort only; some browsers expose a read-only opener.
                }
                return 'popup';
            }

            window.location.assign(url);
            return 'same-tab-fallback';
        },

        resolveFriendlyRechargeErrorMessage(error, fallback = '') {
            const fallbackMessage = fallback || this.tr('wallet.rechargeStartFailed', '充值发起失败，请稍后重试。');
            const rawMessage = String(error?.message || '').trim();
            if (!rawMessage) {
                return fallbackMessage;
            }

            if (/fetch failed|failed to fetch|networkerror|network request failed/i.test(rawMessage)) {
                return fallbackMessage;
            }

            if (
                /尚未配置|浏览器拦截|请输入|当前支付通道暂未完成接入|请先登录|禁用模拟支付|加载失败|发起失败|支付页面/.test(rawMessage)
            ) {
                return rawMessage;
            }

            return rawMessage.length > 80 ? fallbackMessage : rawMessage;
        },

        buildHostedPaymentQrStatusMarkup(message = '', options = {}) {
            const loading = !!options.loading;
            const safeMessage = this.escapeHtml(String(message || '').trim() || this.tr('wallet.scanAlipayToPay', '请使用支付宝扫码支付。'));
            if (!loading) {
                return safeMessage;
            }

            return `
                ${safeMessage}
                <span class="wallet-payment-qr-status-dots" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            `;
        },

        updateHostedPaymentQrStatus(detailOverlay, message = '', tone = 'info', options = {}) {
            const statusEl = detailOverlay?.querySelector('.js-wallet-payment-qr-status');
            if (!statusEl) {
                return;
            }

            const normalizedTone = ['success', 'error', 'info'].includes(tone) ? tone : 'info';
            const isHidden = !!options.hidden;
            const isLoading = !!options.loading;
            statusEl.hidden = isHidden;
            if (isHidden) {
                return;
            }
            statusEl.classList.remove('is-info', 'is-success', 'is-error');
            statusEl.classList.add(`is-${normalizedTone}`);
            statusEl.classList.toggle('is-loading', isLoading);
            statusEl.innerHTML = this.buildHostedPaymentQrStatusMarkup(message, { loading: isLoading });
        },

        resetHostedPaymentQrPresentation(detailOverlay) {
            const modalEl = detailOverlay?.querySelector('.wallet-payment-qr-modal');
            const panelEl = detailOverlay?.querySelector('.wallet-payment-qr-panel');
            const imageEl = detailOverlay?.querySelector('.js-wallet-payment-qr-image');
            const fallbackEl = detailOverlay?.querySelector('.js-wallet-payment-qr-fallback');
            const successEl = detailOverlay?.querySelector('.js-wallet-payment-qr-success');
            const metaEl = detailOverlay?.querySelector('.js-wallet-payment-qr-meta');
            const actionsEl = detailOverlay?.querySelector('.js-wallet-payment-qr-actions');

            if (modalEl) {
                modalEl.classList.remove('is-success');
                modalEl.style.height = '';
                modalEl.style.minHeight = '';
            }
            panelEl?.classList.remove('is-success');
            imageEl?.classList.remove('is-entering', 'is-exiting');
            if (imageEl) {
                imageEl.hidden = false;
            }
            fallbackEl?.classList.remove('is-exiting');
            if (fallbackEl) {
                fallbackEl.hidden = false;
            }
            if (successEl) {
                successEl.hidden = true;
                successEl.classList.remove('is-visible');
            }
            if (metaEl) {
                metaEl.hidden = false;
            }
            if (actionsEl) {
                actionsEl.hidden = actionsEl.dataset.hasActions !== 'true';
            }
            this.updateHostedPaymentQrStatus(detailOverlay, this.tr('wallet.scanAlipayToPay', '请使用支付宝扫码支付。'), 'info');
        },

        animateHostedPaymentQrEntry(detailOverlay) {
            const imageEl = detailOverlay?.querySelector('.js-wallet-payment-qr-image');
            if (!imageEl) {
                return;
            }

            imageEl.classList.add('is-entering');
            const reveal = () => {
                window.requestAnimationFrame(() => {
                    imageEl.classList.remove('is-entering');
                });
            };

            if (imageEl.complete) {
                reveal();
                return;
            }

            imageEl.addEventListener('load', reveal, { once: true });
            imageEl.addEventListener('error', () => {
                imageEl.classList.remove('is-entering');
            }, { once: true });
        },

        transitionHostedPaymentQrToSuccess(detailOverlay) {
            const modalEl = detailOverlay?.querySelector('.wallet-payment-qr-modal');
            const panelEl = detailOverlay?.querySelector('.wallet-payment-qr-panel');
            const imageEl = detailOverlay?.querySelector('.js-wallet-payment-qr-image');
            const fallbackEl = detailOverlay?.querySelector('.js-wallet-payment-qr-fallback');
            const successEl = detailOverlay?.querySelector('.js-wallet-payment-qr-success');
            const metaEl = detailOverlay?.querySelector('.js-wallet-payment-qr-meta');
            const actionsEl = detailOverlay?.querySelector('.js-wallet-payment-qr-actions');

            if (!panelEl || !successEl) {
                return;
            }

            if (modalEl) {
                const currentHeight = Math.ceil(modalEl.getBoundingClientRect().height);
                if (currentHeight > 0) {
                    modalEl.style.height = `${currentHeight}px`;
                    modalEl.style.minHeight = `${currentHeight}px`;
                }
                modalEl.classList.add('is-success');
            }

            panelEl.classList.add('is-success');
            if (metaEl) {
                metaEl.hidden = true;
            }
            if (actionsEl) {
                actionsEl.hidden = true;
            }
            this.updateHostedPaymentQrStatus(detailOverlay, '', 'info', { hidden: true });

            successEl.hidden = false;
            successEl.classList.remove('is-visible');

            const revealSuccess = () => {
                if (imageEl) {
                    imageEl.hidden = true;
                    imageEl.classList.remove('is-exiting');
                }
                if (fallbackEl) {
                    fallbackEl.hidden = true;
                    fallbackEl.classList.remove('is-exiting');
                }
                window.requestAnimationFrame(() => {
                    successEl.classList.add('is-visible');
                });
            };

            if (imageEl && !imageEl.hidden) {
                imageEl.classList.add('is-exiting');
                window.setTimeout(revealSuccess, 180);
                return;
            }

            if (fallbackEl && !fallbackEl.hidden) {
                fallbackEl.classList.add('is-exiting');
                window.setTimeout(revealSuccess, 180);
                return;
            }

            revealSuccess();
        },

        async revealWalletBalanceAfterRecharge() {
            const overlay = document.getElementById('wallet-modal-overlay');
            if (!overlay?.isConnected) {
                return;
            }

            this.switchView('balance');

            const contentEl = overlay.querySelector('.wallet-content');
            const balanceCard = overlay.querySelector('#view-balance .balance-card.compact-premium-card');
            if (contentEl) {
                try {
                    contentEl.scrollTo({ top: 0, behavior: 'smooth' });
                } catch (_) {
                    contentEl.scrollTop = 0;
                }
            }

            if (balanceCard) {
                balanceCard.classList.remove('wallet-balance-card--focus');
                void balanceCard.offsetWidth;
                balanceCard.classList.add('wallet-balance-card--focus');
                window.setTimeout(() => {
                    balanceCard.classList.remove('wallet-balance-card--focus');
                }, 2600);
            }

            await this.loadData().catch((error) => {
                console.error('[WalletModal] Wallet reload after QR completion failed:', error);
            });
        },

        stopHostedPaymentQrPolling(detailOverlay) {
            const cleanup = detailOverlay?._walletPaymentQrCleanup;
            if (typeof cleanup === 'function') {
                cleanup();
            }
            if (detailOverlay) {
                detailOverlay._walletPaymentQrCleanup = null;
            }
        },

        startHostedPaymentQrPolling(detailOverlay, paymentResult = {}, options = {}) {
            const checkoutSessionId = String(paymentResult?.checkout_session_id || '').trim();
            if (!checkoutSessionId) {
                this.updateHostedPaymentQrStatus(
                    detailOverlay,
                    this.tr('wallet.scanAlipayToPay', '请使用支付宝扫码支付。'),
                    'info'
                );
                return;
            }

            this.stopHostedPaymentQrPolling(detailOverlay);

            const intervalMs = Math.max(2000, Number(options.intervalMs || 3000) || 3000);
            const initialDelayMs = Math.max(800, Number(options.initialDelayMs || 1500) || 1500);
            const timeoutMs = Math.max(intervalMs * 2, Number(options.timeoutMs || 180000) || 180000);
            const startedAt = Date.now();
            let timer = null;
            let stopped = false;

            const stop = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                stopped = true;
                if (detailOverlay && detailOverlay._walletPaymentQrCleanup === stop) {
                    detailOverlay._walletPaymentQrCleanup = null;
                }
            };

            const closeIfNeeded = () => {
                if (options.closeOnCompleted === false) {
                    return;
                }
                window.setTimeout(async () => {
                    if (!detailOverlay?.isConnected) {
                        return;
                    }
                    this.stopHostedPaymentQrPolling(detailOverlay);
                    detailOverlay.remove();
                    if (options.focusBalanceOnCompleted !== false) {
                        await this.revealWalletBalanceAfterRecharge();
                    }
                    if (typeof options.onAfterCompletedClose === 'function') {
                        options.onAfterCompletedClose();
                    }
                }, Math.max(1200, Number(options.closeDelayMs || 3000) || 3000));
            };

            const scheduleNext = (delay = intervalMs) => {
                if (stopped) {
                    return;
                }
                timer = window.setTimeout(runPoll, delay);
            };

            const runPoll = async () => {
                if (stopped) {
                    return;
                }

                if ((Date.now() - startedAt) >= timeoutMs) {
                    stop();
                    this.updateHostedPaymentQrStatus(
                        detailOverlay,
                        this.tr('wallet.paymentSyncTimeout', '暂未自动同步到支付结果。若你已完成付款，请稍后刷新钱包或在订单记录中查看，或联系人工客服。'),
                        'info'
                    );
                    if (typeof options.onTimeout === 'function') {
                        options.onTimeout();
                    }
                    return;
                }

                try {
                    this.updateHostedPaymentQrStatus(
                        detailOverlay,
                        this.tr('wallet.paymentWaiting', '请支付并保持此页面，正在等待支付结果同步'),
                        'info',
                        { loading: true }
                    );
                    const statusResult = await PointsService.getPaymentRequestStatus({
                        checkout_session_id: checkoutSessionId,
                        provider_order_no: String(
                            paymentResult?.provider_order_no
                            || paymentResult?.provider_summary?.out_trade_no
                            || ''
                        ).trim() || null,
                        site: paymentResult?.site || window.SiteConfig?.site || 'cn'
                    });
                    if (stopped) {
                        return;
                    }

                    const paymentState = String(statusResult?.status || '').trim().toLowerCase();
                    if (paymentState === 'completed') {
                        stop();
                        this.transitionHostedPaymentQrToSuccess(detailOverlay);
                        if (typeof options.onCompleted === 'function') {
                            await options.onCompleted(statusResult);
                        }
                        closeIfNeeded();
                        return;
                    }

                    if (paymentState === 'failed') {
                        stop();
                        this.updateHostedPaymentQrStatus(
                            detailOverlay,
                            statusResult.message || this.tr('wallet.paymentFailedRetry', '支付未成功，请重新发起支付。'),
                            'error'
                        );
                        if (typeof options.onFailed === 'function') {
                            options.onFailed(statusResult);
                        }
                        return;
                    }

                    if (paymentState === 'review') {
                        this.updateHostedPaymentQrStatus(
                            detailOverlay,
                            statusResult.message || this.tr('wallet.paymentSubmittedReview', '支付已提交，正在等待平台确认，请稍后。'),
                            'info'
                        );
                        scheduleNext(intervalMs);
                        return;
                    }

                    this.updateHostedPaymentQrStatus(
                        detailOverlay,
                        this.tr('wallet.paymentWaiting', '请支付并保持此页面，正在等待支付结果同步'),
                        'info',
                        { loading: true }
                    );
                } catch (_) {
                    if (stopped) {
                        return;
                    }
                    this.updateHostedPaymentQrStatus(
                        detailOverlay,
                        this.tr('wallet.paymentWaiting', '请支付并保持此页面，正在等待支付结果同步'),
                        'info',
                        { loading: true }
                    );
                }

                scheduleNext(intervalMs);
            };

            detailOverlay._walletPaymentQrCleanup = stop;
            this.resetHostedPaymentQrPresentation(detailOverlay);
            this.updateHostedPaymentQrStatus(
                detailOverlay,
                this.tr('wallet.scanAlipayToPay', '请使用支付宝扫码支付。'),
                'info'
            );
            scheduleNext(initialDelayMs);
        },

        tryPresentHostedPaymentQrModal(paymentResult = {}, options = {}) {
            const provider = String(paymentResult?.provider || '').trim().toLowerCase();
            if (provider !== 'zpay' || this.isMobilePaymentBrowser()) {
                return false;
            }

            const providerSummary = paymentResult?.provider_summary && typeof paymentResult.provider_summary === 'object'
                ? paymentResult.provider_summary
                : {};
            const qrcodeImgUrl = String(providerSummary.qrcode_img_url || '').trim();
            const qrcodeUrl = String(providerSummary.qrcode_url || '').trim();
            const checkoutUrl = String(paymentResult?.checkout_url || '').trim();

            if (!qrcodeImgUrl && !qrcodeUrl) {
                return false;
            }

            const modalTitle = String(options.title || paymentResult?.package_name || paymentResult?.display_name || this.tr('wallet.recharge', '充值')).trim() || this.tr('wallet.recharge', '充值');
            const displayName = String(paymentResult?.display_name || '易支付').trim() || '易支付';
            const paidAmount = Number(paymentResult?.paid_amount || 0) || 0;
            const pointsAmount = Number(paymentResult?.points_amount || 0) || 0;
            const copyValue = qrcodeUrl || checkoutUrl || '';
            const openUrl = checkoutUrl || qrcodeUrl || '';
            const showOpenAction = Boolean(openUrl) && (!this.isHostedPaymentQrDesktopLayout() || !qrcodeImgUrl);
            const hasActions = Boolean(copyValue || showOpenAction);
            const detailRows = [
                paidAmount > 0
                    ? `
                        <div class="detail-row">
                            <span class="detail-label">${this.tr('wallet.payableAmount', '应付金额')}</span>
                            <span class="detail-val wallet-detail-val--strong ${this.getWalletToneClass('#fbbf24')}">¥${this.formatCny(paidAmount)}</span>
                        </div>
                    `
                    : '',
                pointsAmount > 0
                    ? `
                        <div class="detail-row">
                            <span class="detail-label">${this.tr('wallet.pointsToReceive', '到账积分')}</span>
                            <span class="detail-val wallet-detail-val--strong ${this.getWalletToneClass('#22c55e')}">${this.formatPoints(pointsAmount)}</span>
                        </div>
                    `
                    : '',
                `
                    <div class="detail-row">
                        <span class="detail-label">${this.tr('wallet.paymentChannel', '支付通道')}</span>
                        <span class="detail-val">${this.escapeHtml(displayName)}</span>
                    </div>
                `
            ].filter(Boolean).join('');

            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.innerHTML = `
                <div class="wallet-order-modal wallet-order-modal--compact wallet-payment-qr-modal">
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title wallet-payment-qr-title">
                            <span class="wallet-payment-qr-title-icon">${this.renderWalletInlineIcon('fa-qrcode', '#fbbf24')}</span>
                            <span class="wallet-payment-qr-title-copy">
                                <strong>${this.escapeHtml(modalTitle)}</strong>
                                <small>${this.tr('wallet.scanAlipayToPay', '请使用支付宝扫码支付')}</small>
                            </span>
                        </div>
                    </div>
                    <div class="wallet-order-modal-body wallet-order-modal-body--fade">
                        <div class="wallet-payment-qr-panel">
                            <div class="wallet-payment-qr-status js-wallet-payment-qr-status is-info">${this.tr('wallet.scanAlipayToPay', '请使用支付宝扫码支付。')}</div>
                            ${qrcodeImgUrl
                                ? `
                                    <div class="wallet-payment-qr-card js-wallet-payment-qr-visual">
                                        <img src="${this.escapeAttribute(qrcodeImgUrl)}" alt="${this.escapeAttribute(this.tr('wallet.paymentQrAlt', '支付宝付款码'))}" class="wallet-payment-qr-image js-wallet-payment-qr-image" loading="eager" decoding="async" referrerpolicy="no-referrer">
                                        <div class="wallet-payment-qr-success js-wallet-payment-qr-success" hidden>
                                            <div class="wallet-payment-qr-success-mark" aria-hidden="true">
                                                <svg viewBox="0 0 24 24" fill="none">
                                                    <path d="M5 12.5L9.2 16.7L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
                                                </svg>
                                            </div>
                                            <div class="wallet-payment-qr-success-title">${this.tr('wallet.paymentSuccess', '支付成功')}</div>
                                        </div>
                                    </div>
                                `
                                : `
                                    <div class="wallet-payment-qr-card js-wallet-payment-qr-visual">
                                        <div class="wallet-payment-qr-fallback js-wallet-payment-qr-fallback">
                                        ${this.tr('wallet.paymentQrFallback', '当前通道没有返回二维码图片，请使用下方按钮打开支付页继续付款。')}
                                        </div>
                                        <div class="wallet-payment-qr-success js-wallet-payment-qr-success" hidden>
                                            <div class="wallet-payment-qr-success-mark" aria-hidden="true">
                                                <svg viewBox="0 0 24 24" fill="none">
                                                    <path d="M5 12.5L9.2 16.7L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
                                                </svg>
                                            </div>
                                            <div class="wallet-payment-qr-success-title">${this.tr('wallet.paymentSuccess', '支付成功')}</div>
                                        </div>
                                    </div>
                                `}
                            <div class="meta-section js-wallet-payment-qr-meta">
                                ${detailRows}
                            </div>
                            <div class="modal-actions wallet-modal-actions--compact js-wallet-payment-qr-actions"${hasActions ? ' data-has-actions="true"' : ' data-has-actions="false" hidden'}>
                                ${copyValue
                                    ? `<button class="action-btn secondary wallet-action-btn--grow js-wallet-copy-payment-qr" type="button">${this.tr('wallet.copyPaymentLink', '复制付款链接')}</button>`
                                    : ''}
                                ${showOpenAction
                                    ? `<button class="action-btn primary wallet-action-btn--grow js-wallet-open-payment-qr" type="button">${this.tr('wallet.openPaymentPage', '打开支付页')}</button>`
                                    : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const closeModal = () => {
                this.stopHostedPaymentQrPolling(detailOverlay);
                detailOverlay.remove();
            };
            detailOverlay.addEventListener('click', (event) => {
                if (event.target === detailOverlay) {
                    closeModal();
                }
            });
            detailOverlay.querySelector('.js-wallet-copy-payment-qr')?.addEventListener('click', (event) => {
                this.copyToClipboard(copyValue, event);
            });
            detailOverlay.querySelector('.js-wallet-open-payment-qr')?.addEventListener('click', () => {
                if (!openUrl) return;
                this.openPaymentCheckoutUrl(openUrl);
            });

            document.body.appendChild(detailOverlay);
            this.startHostedPaymentQrPolling(detailOverlay, paymentResult, options);
            this.animateHostedPaymentQrEntry(detailOverlay);
            return true;
        },

        toPointCents(value, fallback = 0) {
            const normalized = this.normalizePointValue(value, fallback / 100);
            return Number.isFinite(normalized) ? Math.round(normalized * 100) : fallback;
        },

        isPointStepAligned(value, step) {
            const normalizedValue = this.toPointCents(value, 0);
            const normalizedStep = this.toPointCents(step, 0);
            if (normalizedValue <= 0 || normalizedStep <= 0) {
                return false;
            }
            return normalizedValue % normalizedStep === 0;
        },

        resolveCustomRechargeRequest(rawValue, rechargeOptions = this.rechargeOptionsConfig) {
            const rawText = String(rawValue ?? '').trim();
            const normalizedRaw = rawText.replace(/，/g, '.');
            const numericValue = Number(normalizedRaw);
            const minPoints = Math.max(0.01, this.normalizePointValue(rechargeOptions?.custom_amount_min_points, 0.01));
            const maxPoints = Math.max(minPoints, this.normalizePointValue(rechargeOptions?.custom_amount_max_points, minPoints));
            const stepPoints = Math.max(0.01, this.normalizePointValue(rechargeOptions?.custom_amount_step, 0.01));
            const pointsPerCny = Math.max(0.01, this.normalizePointValue(rechargeOptions?.custom_amount_points_per_cny, 1));
            const normalizedPoints = this.normalizePointValue(numericValue, 0);
            const estimatedPaidAmount = Math.ceil((normalizedPoints / pointsPerCny) * 100) / 100;
            const inputMode = Math.abs(pointsPerCny - 1) < 0.0001 ? 'unified' : 'points';
            const inputLabel = inputMode === 'unified'
                ? this.tr('wallet.rechargeAmount', '充值金额')
                : this.tr('wallet.rechargePoints', '充值积分');

            if (!normalizedRaw) {
                if (!this.isEnglishLanguage()) {
                    return {
                        ok: false,
                        errorMessage: `请输入${inputLabel}`
                    };
                }
                return {
                    ok: false,
                    errorMessage: this.tr('wallet.enterValue', '请输入{label}', { label: inputLabel })
                };
            }

            if (!Number.isFinite(numericValue) || numericValue <= 0) {
                return {
                    ok: false,
                    errorMessage: this.tr('wallet.enterPositiveValue', '请输入大于 0 的{label}', { label: inputLabel })
                };
            }

            if (normalizedPoints < minPoints || normalizedPoints > maxPoints) {
                return {
                    ok: false,
                    errorMessage: this.tr('wallet.enterRangeValue', '请输入 {min} 到 {max} 之间的{label}', {
                        min: this.formatPoints(minPoints),
                        max: this.formatPoints(maxPoints),
                        label: inputLabel
                    })
                };
            }

            if (!this.isPointStepAligned(normalizedPoints, stepPoints)) {
                return {
                    ok: false,
                    errorMessage: this.tr('wallet.enterStepValue', '请输入 {step} 的整数倍{label}', {
                        step: this.formatPoints(stepPoints),
                        label: inputLabel
                    })
                };
            }

            return {
                ok: true,
                inputMode,
                normalizedPoints,
                enteredAmountCny: inputMode === 'unified' ? normalizedPoints : null,
                estimatedPaidAmount,
                pointsPerCny
            };
        },

        formatWalletSiteLabel(site = '') {
            const normalized = String(site || '').trim().toLowerCase();
            if (normalized === 'intl') return 'INTL';
            return 'CN';
        },

        renderBalanceContext(balance = {}) {
            const contextEl = document.getElementById('wallet-balance-context');
            if (!contextEl) return;

            const currentSite = String(balance?.site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn';
            const currentSiteLabel = this.formatWalletSiteLabel(currentSite);
            const totalBalance = this.normalizePointValue(balance?.total_balance, 0);
            const otherSiteBalances = Array.isArray(balance?.other_site_balances)
                ? balance.other_site_balances.filter((item) => this.normalizePointValue(item?.total_balance, 0) > 0)
                : [];

            let message = '';
            let tone = 'info';

            if (balance?._load_failed) {
                message = balance?.error_message || '钱包余额加载失败，请刷新重试。';
                tone = 'error';
            } else if (otherSiteBalances.length > 0 && totalBalance <= 0) {
                const otherSummary = otherSiteBalances
                    .map((item) => `${this.formatWalletSiteLabel(item.site)} ${this.formatPoints(item.total_balance)}`)
                    .join('，');
                message = `当前显示 ${currentSiteLabel} 站点余额为 0；其它站点仍有余额：${otherSummary}。后台如果看的是其它站点或全站汇总，会和这里不同。`;
                tone = 'warning';
            } else if (otherSiteBalances.length > 0) {
                const otherSummary = otherSiteBalances
                    .map((item) => `${this.formatWalletSiteLabel(item.site)} ${this.formatPoints(item.total_balance)}`)
                    .join('，');
                message = `当前显示 ${currentSiteLabel} 站点余额；其它站点余额：${otherSummary}。`;
                tone = 'info';
            }

            if (!message) {
                contextEl.hidden = true;
                contextEl.textContent = '';
                contextEl.className = 'balance-site-context';
                return;
            }

            contextEl.hidden = false;
            contextEl.textContent = message;
            contextEl.className = `balance-site-context balance-site-context--${tone}`;
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

        getWalletToneClass(value = '') {
            const normalized = String(value || '').trim().toLowerCase();

            if (['#fde68a', '#fbbf24', '#f59e0b'].includes(normalized)) {
                return 'wallet-tone-amber';
            }

            if (['#22c55e', '#10b981', '#34d399'].includes(normalized)) {
                return 'wallet-tone-emerald';
            }

            if (['#6b9ece', '#38bdf8', '#7dd3fc'].includes(normalized)) {
                return 'wallet-tone-sky';
            }

            if (['#8b5cf6'].includes(normalized)) {
                return 'wallet-tone-violet';
            }

            if (['#f472b6'].includes(normalized)) {
                return 'wallet-tone-pink';
            }

            if (['#ef4444', '#f87171', '#fca5a5'].includes(normalized)) {
                return 'wallet-tone-danger';
            }

            if (['#e5e7eb', '#cbd5e1'].includes(normalized)) {
                return 'wallet-tone-muted';
            }

            return 'wallet-tone-default';
        },

        renderWalletInlineIcon(iconClass = '', toneValue = '', extraClass = '') {
            const classNames = [
                'fas',
                iconClass,
                'wallet-inline-icon',
                this.getWalletToneClass(toneValue),
                extraClass
            ].filter(Boolean).join(' ');
            return `<i class="${classNames}"></i>`;
        },

        buildWalletOrderLoadingMarkup(message = '', options = {}) {
            const loadingLabel = String(message || (window.i18n?.t('wallet.loading') || '加载中...'))
                .replace(/[.。…\s]+$/g, '');
            const modalClass = String(options?.modalClass || '')
                .split(/\s+/)
                .filter(Boolean)
                .map((className) => this.escapeAttribute(className))
                .join(' ');
            const extraClass = modalClass ? ` ${modalClass}` : '';

            return `
                <div class="wallet-order-modal wallet-order-modal--loading${extraClass}">
                    <div class="wallet-order-loading-state" aria-label="${this.escapeAttribute(loadingLabel)}">
                        <div class="wallet-order-loading-row">
                            <span class="wallet-pending-dots wallet-order-loading-dots" aria-hidden="true">
                                <span></span><span></span><span></span>
                            </span>
                        </div>
                    </div>
                </div>
            `;
        },

        markWalletOrderModalReady(modal) {
            if (!modal) return;
            modal.classList.remove('wallet-order-modal--loading');
        },

        waitForWalletOrderTransition(ms = 0) {
            return new Promise((resolve) => window.setTimeout(resolve, ms));
        },

        async replaceWalletOrderModalContent(modal, markup = '') {
            if (!modal) return false;
            const reduceMotion = typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            if (reduceMotion) {
                this.markWalletOrderModalReady(modal);
                modal.innerHTML = markup;
                return modal.isConnected;
            }

            const startHeight = modal.getBoundingClientRect().height;

            modal.classList.add('wallet-order-modal--content-swapping');
            await this.waitForWalletOrderTransition(120);
            if (!modal.isConnected) return false;

            this.markWalletOrderModalReady(modal);
            modal.innerHTML = markup;

            const body = modal.querySelector('.wallet-order-modal-body');
            body?.classList.add('wallet-order-modal-body--entering');

            const targetHeight = modal.getBoundingClientRect().height;
            modal.classList.remove('wallet-order-modal--content-swapping');

            if (
                startHeight > 0
                && targetHeight > 0
                && Math.abs(targetHeight - startHeight) > 1
                && typeof modal.animate === 'function'
            ) {
                modal.animate([
                    { height: `${Math.round(startHeight)}px` },
                    { height: `${Math.round(targetHeight)}px` }
                ], {
                    duration: 340,
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                });
            }

            const requestFrame = typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : (callback) => window.setTimeout(callback, 16);

            requestFrame(() => {
                if (modal.isConnected) body?.classList.add('is-visible');
            });

            window.setTimeout(() => {
                if (!modal.isConnected) return;
                body?.classList.remove('wallet-order-modal-body--entering', 'is-visible');
            }, 460);

            return true;
        },

        async fetchVerifyOrderLog(options = {}) {
            const {
                orderId = '',
                referenceId = '',
                site = 'cn',
                createdAt = '',
                pointsPaid = 0,
                reason = ''
            } = options;

            const pointsService = window.PointsService;
            if (!pointsService?.getWalletVerifyLog) return null;

            const emailCandidates = this.extractEmailCandidates(referenceId, reason);
            const cacheKey = `${site}:${referenceId || orderId || createdAt || 'verify'}:${emailCandidates.join('|')}`;
            if (this.verifyLogCache[cacheKey]) {
                return this.verifyLogCache[cacheKey];
            }

            try {
                const matchedRecord = await pointsService.getWalletVerifyLog({
                    orderId,
                    referenceId,
                    site,
                    createdAt,
                    pointsPaid,
                    reason
                });
                if (!matchedRecord) return null;

                this.verifyLogCache[cacheKey] = matchedRecord;
                return matchedRecord;
            } catch (err) {
                console.warn('[WalletModal] Verify log query exception:', err);
                return null;
            }
        },

        /**
         * Pre-fetch wallet data in background (called when avatar dropdown opens)
         * So data is instantly available when user clicks 'My Orders'
         */
        prefetchData() {
            const pointsService = window.PointsService;
            if (!pointsService) {
                return;
            }

            const site = window.SiteConfig?.site || 'cn';

            if (!this._prefetched && !this.ordersLoaded && pointsService?.getWalletTransactions) {
                this._prefetched = true;
                pointsService.getWalletTransactions({
                    site,
                    limit: 100
                }).then((result) => {
                    this._prefetchedShopOrders = result.shopOrders || [];
                    this._prefetchedLedger = result.ledgerEntries || [];
                    this._prefetchedPromptTitles = result.promptTitles || {};
                    this.prefetchShopOrderDetails(this._prefetchedShopOrders, { limit: 4 });
                    console.log('[WalletModal] ✅ Transaction data prefetched in background');
                }).catch(err => {
                    console.warn('[WalletModal] Transaction prefetch failed (non-critical):', err);
                });
            }

            if (pointsService?.getWalletDiscountAssets) {
                pointsService.getWalletDiscountAssets({ site }).then(() => {
                    console.log('[WalletModal] ✅ Discount assets prefetched in background');
                }).catch((err) => {
                    console.warn('[WalletModal] Discount assets prefetch failed (non-critical):', err);
                });
            }

            if (pointsService?.getBalance) {
                pointsService.getBalance({ site }).then(() => {
                    console.log('[WalletModal] ✅ Balance data prefetched in background');
                }).catch((err) => {
                    console.warn('[WalletModal] Balance prefetch failed (non-critical):', err);
                });
            }
        },

        prefetchShopOrderDetails(orders = [], { limit = 4 } = {}) {
            const pointsService = window.PointsService;
            if (!pointsService?.getWalletShopOrderDetail) {
                return;
            }

            const normalizedLimit = Math.max(0, Math.min(6, Number(limit || 0) || 0));
            if (!normalizedLimit) {
                return;
            }

            const candidateOrderIds = [...new Set(
                (Array.isArray(orders) ? orders : [])
                    .filter((order) => order?.transactionType === 'shop' && order?.isShopOrder)
                    .map((order) => String(order?.shopOrderId || order?.id || '').trim())
                    .filter(Boolean)
            )].slice(0, normalizedLimit);

            if (!candidateOrderIds.length) {
                return;
            }

            const runPrefetch = () => {
                candidateOrderIds.forEach((candidateOrderId, index) => {
                    if (pointsService?.peekWalletShopOrderDetail?.({ orderId: candidateOrderId })) {
                        return;
                    }

                    window.setTimeout(() => {
                        pointsService.getWalletShopOrderDetail({
                            orderId: candidateOrderId
                        }).catch((error) => {
                            console.warn('[WalletModal] Shop order detail prefetch failed (non-critical):', error);
                        });
                    }, index * 120);
                });
            };

            window.setTimeout(runPrefetch, 0);
        },

        /**
         * Open the wallet modal
         */
        async open(initialView, context = {}) {
            if (this.isOpen) return;

            console.log('[WalletModal] Opening...', initialView ? `view: ${initialView}` : '');

            const normalizedInitialView = String(initialView || 'balance').trim().toLowerCase() || 'balance';
            const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
                ? { ...context }
                : {};
            this.lastOpenContext = {
                ...normalizedContext,
                entry: String(normalizedContext.entry || '').trim() || `wallet_${normalizedInitialView}`,
                initial_view: normalizedInitialView,
                source_module: String(normalizedContext.sourceModule || normalizedContext.source_module || '').trim() || null
            };
            trackWalletAnalyticsEvent('wallet_open', {
                entityId: 'wallet_modal',
                metadata: this.lastOpenContext
            }, {
                eventType: 'engagement'
            });

            // Close user dropdown menu first (prevent double overlay)
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.remove('active');
            const dropdownOverlay = document.getElementById('dropdownOverlay');
            if (dropdownOverlay) dropdownOverlay.classList.remove('active');

            this.isOpen = true;
            this.ordersLoaded = false; // Reset loaded flag for new session
            this.ordersData = [];
            this.browseOrdersSnapshot = [];
            this.currentWalletBalance = null;
            this.orderRequestId += 1;
            this.resetOrderSearchState();
            this.resetAffiliateState();
            this.resetDiscountAssetsState();
            this.restoreDiscountAssetsFromCache();

            if (isWalletModalIOSMode()) {
                freezeWalletModalPage();
            }

            // Render UI immediately so there's zero delay for the user
            this.render();
            resetWalletSidebarIndicatorState();
            this.resetOrderFilters();
            this.syncOrderSearchUi();
            this.restoreWalletBalanceFromCache({ animate: true });
            this.renderDiscountAssetsView();
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
                this.switchView(normalizedInitialView);
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
                this.modalEl.hidden = true;
                this.modalEl.classList.remove('active', 'keyboard-active', 'keyboard-docked', 'ios-focus-lock');
            }
            setCssVariables(getWalletModalElements().viewport, { '--wallet-modal-translate-y': '0px' });
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
            this.resetDiscountAssetsState();
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
                overlay.hidden = false;
                this.modalEl = overlay;
                this.bindDelegatedHandlers(overlay);
                this.syncOrderSearchUi();
                return;
            }

            overlay = document.createElement('div');
            overlay.id = 'wallet-modal-overlay';
            overlay.className = 'wallet-overlay';
            overlay.hidden = true;
            overlay.innerHTML = `
                <div class="wallet-backdrop" aria-hidden="true"></div>
                <div class="wallet-viewport">
                    <div class="wallet-modal">
                        <div class="wallet-header">
                            <h2>💰 ${window.i18n?.t('wallet.title') || '我的钱包'}</h2>
                        </div>
                        
                        <div class="wallet-layout">
                            <!-- Left Sidebar Menu -->
                            <div class="wallet-sidebar" aria-label="${this.escapeAttribute(window.i18n?.t('wallet.title') || '我的钱包')}">
                                <div class="sidebar-indicator"></div>
                                <button type="button" class="wallet-menu-item active" data-view="balance" aria-current="page" aria-controls="view-balance"${this.buildDataAttributes({ 'wallet-action': 'switch-view', 'wallet-view-id': 'balance' })}>
                                    <span class="menu-icon">💳</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.balance') || '余额'}</span>
                                </button>
                                <button type="button" class="wallet-menu-item" data-view="cards" aria-controls="view-cards"${this.buildDataAttributes({ 'wallet-action': 'switch-view', 'wallet-view-id': 'cards' })}>
                                    <span class="menu-icon">${this.renderWalletInlineIcon('fa-ticket-alt', '#f472b6', 'wallet-inline-icon--compact')}</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.cards') || '卡券'}</span>
                                    <span class="wallet-menu-badge" id="wallet-menu-cards-badge" hidden>0</span>
                                </button>
                                <button type="button" class="wallet-menu-item" data-view="recharge" aria-controls="view-recharge"${this.buildDataAttributes({ 'wallet-action': 'switch-view', 'wallet-view-id': 'recharge' })}>
                                    <span class="menu-icon">${this.renderWalletInlineIcon('fa-bolt', '#fbbf24', 'wallet-inline-icon--compact')}</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.recharge') || '充值'}</span>
                                </button>

                                <button type="button" class="wallet-menu-item" data-view="orders" aria-controls="view-orders"${this.buildDataAttributes({ 'wallet-action': 'switch-view', 'wallet-view-id': 'orders' })}>
                                    <span class="menu-icon">📋</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.records') || '记录'}</span>
                                </button>

                                <button type="button" class="wallet-menu-item" data-view="affiliate" aria-controls="view-affiliate"${this.buildDataAttributes({ 'wallet-action': 'switch-view', 'wallet-view-id': 'affiliate' })}>
                                    <span class="menu-icon">${this.renderWalletInlineIcon('fa-share-alt', '#10b981', 'wallet-inline-icon--compact')}</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.affiliate') || '推广'}</span>
                                </button>

                                <button type="button" class="wallet-menu-item" data-view="checkin" aria-controls="view-checkin"${this.buildDataAttributes({ 'wallet-action': 'switch-view', 'wallet-view-id': 'checkin' })}>
                                    <span class="menu-icon">🔖</span>
                                    <span class="menu-text">${window.i18n?.t('wallet.checkin') || '签到'}</span>
                                </button>
                            </div>
                            
                            <!-- Right Content Area -->
                            <div class="wallet-content">
                            <!-- Balance View (Default) -->
                            <div class="wallet-view active" id="view-balance">
                                <div class="balance-card compact-premium-card">
                                    <div class="card-left">
                                        <label>${window.i18n?.t('wallet.currentPoints') || '当前可用积分'}</label>
                                        <div class="balance-amount" id="wallet-total">--</div>
                                        <div class="balance-site-context" id="wallet-balance-context" hidden></div>
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
                                               ${this.buildDataAttributes({ 'wallet-enter-action': 'redeem-code' })} />
                                        <button class="redeem-btn"${this.buildDataAttributes({ 'wallet-action': 'redeem-code' })}>${window.i18n?.t('wallet.redeem') || '兑换'}</button>
                                    </div>
                                </div>
                            </div>

                            ${this.renderDiscountAssetsViewShell()}
                            
                            <!-- Recharge View -->
                            <div class="wallet-view" id="view-recharge">
                                <h3 class="view-title">${this.renderWalletInlineIcon('fa-bolt', '#fbbf24', 'wallet-inline-icon--title')}${window.i18n?.t('wallet.rechargePackages') || '充值套餐'}</h3>
                                <div class="packages-container" id="wallet-packages">
                                    <div class="wallet-recharge-package-loading" role="status" aria-live="polite" aria-label="${this.escapeAttribute(window.i18n?.t('common.loading') || '加载中...')}">
                                        <span class="wallet-pending-dots wallet-recharge-package-loading-dots" aria-hidden="true">
                                            <span></span>
                                            <span></span>
                                            <span></span>
                                        </span>
                                    </div>
                                </div>

                                <div class="custom-recharge-section" id="wallet-custom-recharge-section" hidden>
                                    <div class="custom-recharge-header">
                                        <div>
                                            <div class="custom-recharge-title">${this.tr('wallet.customRecharge', '自定义充值')}</div>
                                            <div class="custom-recharge-subtitle" id="wallet-custom-recharge-subtitle" hidden></div>
                                        </div>
                                        <span class="custom-recharge-badge" id="wallet-custom-recharge-badge" hidden></span>
                                    </div>
                                    <div class="custom-recharge-row">
                                        <input type="number"
                                               id="wallet-custom-recharge-input"
                                               class="custom-recharge-input"
                                               min="0.01"
                                               step="0.01"
                                               inputmode="decimal"
                                               placeholder="请输入充值金额"
                                               ${this.buildDataAttributes({ 'wallet-enter-action': 'custom-recharge' })} />
                                        <button class="custom-recharge-btn" id="wallet-custom-recharge-btn"${this.buildDataAttributes({ 'wallet-action': 'custom-recharge' })}>充值</button>
                                    </div>
                                    <div class="custom-recharge-meta" id="wallet-custom-recharge-meta" hidden></div>
                                </div>
                                
                                <!-- Payment Order Query Section -->
                                <div class="afdian-section" id="wallet-order-query-section" hidden>
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
                                        <span id="wallet-order-query-title">${window.i18n?.t('wallet.paymentOrderQuery') || window.i18n?.t('wallet.afdianQuery') || '支付订单查询'}</span>
                                    </div>
                                    <p class="afdian-hint" id="wallet-order-query-hint">${window.i18n?.t('wallet.paymentOrderQueryHint') || window.i18n?.t('wallet.afdianHint') || '完成支付后，可在这里输入订单号查询结果。'}</p>
                                    <div class="afdian-input-row">
                                        <input type="text" 
                                               id="afdian-order-input" 
                                               placeholder="${window.i18n?.t('wallet.paymentOrderNo') || window.i18n?.t('wallet.afdianOrderNo') || '输入支付平台订单号'}"
                                               autocomplete="off"
                                               ${this.buildDataAttributes({ 'wallet-enter-action': 'query-afdian-code' })} />
                                        <button class="afdian-query-btn"${this.buildDataAttributes({ 'wallet-action': 'query-afdian-code' })}>${window.i18n?.t('wallet.query') || '查询'}</button>
                                    </div>
                                    <div id="afdian-result" class="afdian-result"></div>
                                </div>
                            </div>


                            <!-- Calendar Check-in View -->
                            <div class="wallet-view" id="view-checkin">
                                <div class="checkin-dashboard">
                                    <div class="checkin-header">
                                        <div class="checkin-month-title" id="checkin-month-title">${this.tr('wallet.monthCheckinTitle', '{month}月打卡', { month: '--' })}</div>
                                        <div class="checkin-streak">${this.tr('wallet.streakDays', '已连续 {count} 天', { count: '<strong id="checkin-streak-count">0</strong>' })}</div>
                                    </div>
                                    
                                    <!-- Mystery Rewards Progress -->
                                    <div class="mystery-progress-wrapper" id="mystery-progress-box" hidden>
                                        <div class="mystery-progress-label">${this.tr('wallet.mysteryProgress', '本周神秘盲盒进度')}</div>
                                        <div class="mystery-progress-bar">
                                            <div class="mystery-progress-fill" id="mystery-progress-fill"></div>
                                        </div>
                                    </div>
                                    
                                    <!-- Calendar Grid -->
                                    <div class="calendar-wrapper">
                                        <div class="calendar-weekdays">
                                            <span>${this.tr('wallet.weekdaysSun', '日')}</span><span>${this.tr('wallet.weekdaysMon', '一')}</span><span>${this.tr('wallet.weekdaysTue', '二')}</span><span>${this.tr('wallet.weekdaysWed', '三')}</span><span>${this.tr('wallet.weekdaysThu', '四')}</span><span>${this.tr('wallet.weekdaysFri', '五')}</span><span>${this.tr('wallet.weekdaysSat', '六')}</span>
                                        </div>
                                        <div class="calendar-grid" id="calendar-grid">
                                            <!-- Dynamically generated days go here -->
                                            <div class="loading-calendar">${this.tr('wallet.calendarLoading', '加载中...')}</div>
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
                                            placeholder="${window.i18n?.t('wallet.searchPlaceholder') || '搜索订单号 / 任务号 / 兑换码 / 商品名 / Google One 邮箱 / 积分数量'}"
                                            autocomplete="off"
                                            spellcheck="false"
                                            ${this.buildDataAttributes({ 'wallet-input-action': 'order-search', 'wallet-keydown-action': 'order-search' })}
                                        />
                                        <button
                                            type="button"
                                            class="history-search-clear"
                                            id="wallet-order-search-clear"
                                            ${this.buildDataAttributes({ 'wallet-action': 'clear-order-search' })}
                                            title="${window.i18n?.t('wallet.clearSearch') || '清除搜索'}"
                                        >
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                    <div class="history-actions">
                                        <div class="filter-wrapper">
                                            <div class="filter-chip"${this.buildDataAttributes({ 'wallet-action': 'toggle-order-time-filter-menu' })}>
                                                <span id="order-time-filter-label">${window.i18n?.t('wallet.all') || '全部'}</span>
                                                <span class="filter-arrow">▼</span>
                                            </div>
                                            <div class="filter-popup" id="order-time-filter-popup">
                                                <div class="filter-option active" data-value="all"${this.buildDataAttributes({ 'wallet-action': 'select-order-time-filter', 'wallet-filter-value': 'all', 'wallet-filter-label': window.i18n?.t('wallet.all') || '全部' })}>${window.i18n?.t('wallet.all') || '全部'}</div>
                                                <div class="filter-option" data-value="today"${this.buildDataAttributes({ 'wallet-action': 'select-order-time-filter', 'wallet-filter-value': 'today', 'wallet-filter-label': window.i18n?.t('wallet.today') || '今天' })}>${window.i18n?.t('wallet.today') || '今天'}</div>
                                                <div class="filter-option" data-value="week"${this.buildDataAttributes({ 'wallet-action': 'select-order-time-filter', 'wallet-filter-value': 'week', 'wallet-filter-label': window.i18n?.t('wallet.thisWeek') || '本周' })}>${window.i18n?.t('wallet.thisWeek') || '本周'}</div>
                                                <div class="filter-option" data-value="month"${this.buildDataAttributes({ 'wallet-action': 'select-order-time-filter', 'wallet-filter-value': 'month', 'wallet-filter-label': window.i18n?.t('wallet.thisMonth') || '本月' })}>${window.i18n?.t('wallet.thisMonth') || '本月'}</div>
                                                <div class="filter-divider"></div>
                                                <div class="filter-option" data-value="custom"${this.buildDataAttributes({ 'wallet-action': 'select-order-time-filter', 'wallet-filter-value': 'custom', 'wallet-filter-label': window.i18n?.t('wallet.custom') || '自定义...' })}>📅 ${window.i18n?.t('wallet.custom') || '自定义...'}</div>
                                            </div>
                                        </div>
                                        <div class="filter-wrapper">
                                            <div class="filter-chip"${this.buildDataAttributes({ 'wallet-action': 'toggle-order-filter-menu' })}>
                                                <span id="order-filter-label">${window.i18n?.t('wallet.all') || '全部'}</span>
                                                <span class="filter-arrow">▼</span>
                                            </div>
                                            <div class="filter-popup" id="order-filter-popup">
                                                <div class="filter-option active" data-value="all"${this.buildDataAttributes({ 'wallet-action': 'select-order-filter', 'wallet-filter-value': 'all', 'wallet-filter-label': window.i18n?.t('wallet.all') || '全部' })}>${window.i18n?.t('wallet.all') || '全部'}</div>
                                                <div class="filter-option" data-value="recharge"${this.buildDataAttributes({ 'wallet-action': 'select-order-filter', 'wallet-filter-value': 'recharge', 'wallet-filter-label': window.i18n?.t('wallet.rechargeType') || '充值' })}>${this.renderWalletInlineIcon('fa-bolt', '#fbbf24')}${window.i18n?.t('wallet.rechargeType') || '充值'}</div>
                                                <div class="filter-option" data-value="shop"${this.buildDataAttributes({ 'wallet-action': 'select-order-filter', 'wallet-filter-value': 'shop', 'wallet-filter-label': window.i18n?.t('wallet.shopPurchase') || '商品' })}>${this.renderWalletInlineIcon('fa-shopping-bag', '#22c55e')}${window.i18n?.t('wallet.shopPurchase') || '商品'}</div>
                                                <div class="filter-option" data-value="prompt"${this.buildDataAttributes({ 'wallet-action': 'select-order-filter', 'wallet-filter-value': 'prompt', 'wallet-filter-label': window.i18n?.t('wallet.promptPurchase') || '提示词' })}>${this.renderWalletInlineIcon('fa-lightbulb', '#fde68a')}${window.i18n?.t('wallet.promptPurchase') || '提示词'}</div>
                                                <div class="filter-option" data-value="redeem"${this.buildDataAttributes({ 'wallet-action': 'select-order-filter', 'wallet-filter-value': 'redeem', 'wallet-filter-label': window.i18n?.t('wallet.redeemCode') || '兑换码' })}>${this.renderWalletInlineIcon('fa-ticket-alt', '#f472b6')}${window.i18n?.t('wallet.redeemCode') || '兑换码'}</div>
                                                <div class="filter-option" data-value="verify"${this.buildDataAttributes({ 'wallet-action': 'select-order-filter', 'wallet-filter-value': 'verify', 'wallet-filter-label': 'Google One' })}>${this.renderWalletInlineIcon('fa-shield-alt', '#60a5fa')}Google One</div>
                                            </div>
                                        </div>
                                        <div class="clear-chip"${this.buildDataAttributes({ 'wallet-action': 'clear-orders' })}>🗑</div>
                                    </div>
                                </div>
                                <div class="orders-container" id="wallet-orders">
                                    <div class="loading-text">${window.i18n?.t('common.loading') || '加载中...'}</div>
                                </div>
                            </div>

                            <div class="wallet-view wallet-view-flex wallet-affiliate-view" id="view-affiliate">
                                <div class="wallet-affiliate-shell">
                                    <div class="wallet-affiliate-stats">
                                        <div class="affiliate-stat-card affiliate-stat-card-gold">
                                            <div class="affiliate-stat-label"><i class="fas fa-coins"></i> ${this.tr('wallet.affiliateRewardTotal', '累计推广奖励')}</div>
                                            <div class="affiliate-stat-value" id="affiliate-commission">0</div>
                                            <div class="affiliate-stat-meta" id="affiliate-reward-breakdown">${this.tr('wallet.rewardBreakdown', '返佣 {commission} · 拉新 {registration}', { commission: 0, registration: 0 })}</div>
                                        </div>
                                        <div class="affiliate-stat-card affiliate-stat-card-blue">
                                            <div class="affiliate-stat-label"><i class="fas fa-user-plus"></i> ${this.tr('wallet.successfulInvites', '成功邀请人数')}</div>
                                            <div class="affiliate-stat-value" id="affiliate-count">0</div>
                                            <div class="affiliate-stat-meta" id="affiliate-count-meta">${this.tr('wallet.consumedPeople', '已消费 {count} 人', { count: 0 })}</div>
                                        </div>
                                        <div class="affiliate-stat-card affiliate-stat-card-teal">
                                            <div class="affiliate-stat-label"><i class="fas fa-bolt"></i> ${this.tr('wallet.firstRechargeDone', '已完成首充')}</div>
                                            <div class="affiliate-stat-value" id="affiliate-recharge-count">0</div>
                                            <div class="affiliate-stat-meta" id="affiliate-recharge-meta">${this.tr('wallet.pendingPeople', '待激活 {count} 人', { count: 0 })}</div>
                                        </div>
                                        <div class="affiliate-stat-card affiliate-stat-card-rose">
                                            <div class="affiliate-stat-label"><i class="fas fa-chart-line"></i> ${this.tr('wallet.totalInviteeSpend', '累计贡献消费')}</div>
                                            <div class="affiliate-stat-value" id="affiliate-spend-total">0</div>
                                            <div class="affiliate-stat-meta" id="affiliate-spend-meta">${this.tr('wallet.ongoingCommission', '持续返佣 {amount} {unit}', { amount: 0, unit: this.tr('wallet.pointsUnit', '积分') })}</div>
                                        </div>
                                    </div>

                                    <div class="wallet-affiliate-panels">
                                        <section class="wallet-affiliate-panel wallet-affiliate-link-panel">
                                            <div class="wallet-affiliate-panel-head wallet-affiliate-panel-head-link">
                                                <div>
                                                    <h3>
                                                        ${this.renderWalletInlineIcon('fa-link', '#10b981')}
                                                        ${window.i18n?.t('wallet.getInviteLink') || '获取专属推广链接'}
                                                    </h3>
                                                    <p id="affiliate-desc-text" class="wallet-affiliate-desc">
                                                        加载中...
                                                    </p>
                                                </div>
                                                <span class="affiliate-reward-guide" id="affiliate-reward-guide">${this.tr('wallet.rewardGuide', '奖励说明')}</span>
                                            </div>

                                            <div class="wallet-affiliate-link-row">
                                                <input type="text" id="affiliate-link" readonly class="wallet-affiliate-link-input"${this.buildDataAttributes({ 'wallet-action': 'select-affiliate-link' })} />
                                                <button class="wallet-affiliate-copy-btn"${this.buildDataAttributes({ 'wallet-action': 'copy-affiliate-link' })}>
                                                    ${window.i18n?.t('wallet.copyLink') || '复制链接'}
                                                </button>
                                            </div>

                                            <button class="wallet-affiliate-poster-btn"${this.buildDataAttributes({ 'wallet-action': 'generate-affiliate-poster' })}>
                                                <i class="fas fa-image"></i> ${window.i18n?.t('wallet.generatePoster') || '生成海报'}
                                            </button>
                                        </section>

                                        <section class="wallet-affiliate-panel wallet-affiliate-journey-panel">
                                            <div class="wallet-affiliate-panel-head wallet-affiliate-panel-head-compact">
                                                <div>
                                                    <h3>
                                                        ${this.renderWalletInlineIcon('fa-road', '#8ab4ff')}
                                                        ${this.tr('wallet.inviteJourney', '邀请旅程')}
                                                    </h3>
                                                </div>
                                                <div class="affiliate-stage-summary" id="affiliate-stage-summary">
                                                    <span class="affiliate-stage-pill">${this.tr('wallet.registered', '注册 {count}', { count: 0 })}</span>
                                                    <span class="affiliate-stage-pill">${this.tr('wallet.firstRecharge', '首充 {count}', { count: 0 })}</span>
                                                    <span class="affiliate-stage-pill">${this.tr('wallet.purchased', '消费 {count}', { count: 0 })}</span>
                                                </div>
                                            </div>

                                            <div class="affiliate-member-list" id="affiliate-members">
                                                <div class="loading-text">${window.i18n?.t('common.loading') || '加载中...'}</div>
                                            </div>
                                        </section>
                                    </div>
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
                if (overlay.classList.contains('loading')) {
                    return;
                }
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
            this.bindDelegatedHandlers(overlay);
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
                const isActive = item.dataset.view === viewId;
                item.classList.toggle('active', isActive);
                if (isActive) {
                    item.setAttribute('aria-current', 'page');
                } else {
                    item.removeAttribute('aria-current');
                }
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

            if (viewId === 'cards') {
                this.restoreDiscountAssetsFromCache();
                this.renderDiscountAssetsView();
                if (!this.discountAssetsLoaded && !this.discountAssetsLoading) {
                    this.loadDiscountAssets().catch((error) => {
                        console.error('[WalletModal] Initial discount assets load failed:', error);
                    });
                }
            }

            if (this.isOpen) {
                scheduleWalletModalLayout({ settled: true });
                requestWalletRechargeScrollCueUpdate();
            }
        },

        /**
         * Update the position of the sliding sidebar indicator
         */
        updateIndicatorPosition(targetItem = null) {
            const sidebar = document.querySelector('.wallet-sidebar');
            const activeItem = targetItem?.classList?.contains('wallet-menu-item')
                ? targetItem
                : document.querySelector('.wallet-menu-item.active');
            const indicator = document.querySelector('.sidebar-indicator');

            if (!sidebar || !activeItem || !indicator || !sidebar.contains(activeItem)) {
                sidebar?.classList.remove('wallet-sidebar--indicator-ready');
                return;
            }

            const isCompactMobile = isWalletModalCompactMobile();
            if (isCompactMobile) {
                indicator.classList.remove('sidebar-indicator--settling');
                setInlineStyles(indicator, {
                    left: '',
                    top: '',
                    width: '',
                    height: '',
                    opacity: '0'
                });
                sidebar.classList.remove('wallet-sidebar--indicator-ready');
                return;
            }

            const left = activeItem.offsetLeft;
            const top = activeItem.offsetTop;
            const width = activeItem.offsetWidth;
            const height = activeItem.offsetHeight;
            const minReadyWidth = 1;
            const minReadyHeight = 1;

            if (width < minReadyWidth || height < minReadyHeight) {
                setInlineStyles(indicator, {
                    opacity: '0'
                });
                sidebar.classList.remove('wallet-sidebar--indicator-ready');
                return;
            }

            const wasIndicatorReady = sidebar.classList.contains('wallet-sidebar--indicator-ready');
            if (!wasIndicatorReady) {
                indicator.classList.add('sidebar-indicator--settling');
            }

            setInlineStyles(indicator, {
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                opacity: '1'
            });
            sidebar.classList.add('wallet-sidebar--indicator-ready');

            if (!wasIndicatorReady) {
                requestAnimationFrame(() => {
                    indicator.classList.remove('sidebar-indicator--settling');
                });
            }
        },

        resetAffiliateState() {
            this.affiliateLoaded = false;
            this.currentInviteCode = '';
            this.affiliateStats = null;
            this.affiliatePosterConfig = null;
            this.affiliateProfile = null;
        },

        getDefaultDiscountAssetsData() {
            return {
                summary: {
                    total_count: 0,
                    available_count: 0,
                    used_count: 0,
                    inactive_count: 0,
                    expiring_soon_count: 0,
                    saved_amount_total: 0
                },
                available_assets: [],
                used_assets: [],
                inactive_assets: []
            };
        },

        resetDiscountAssetsState() {
            this.discountAssetsData = this.getDefaultDiscountAssetsData();
            this.discountAssetsLoaded = false;
            this.discountAssetsLoading = false;
            this.discountAssetsLoadError = '';
            this.discountAssetsActiveTab = 'available';
            this.discountAssetsSummaryFilter = 'available';
            this.discountAssetsExpandedKey = '';
            this.discountAssetsRemovingId = '';
        },

        applyDiscountAssetsPayload(payload = {}) {
            this.discountAssetsData = {
                ...this.getDefaultDiscountAssetsData(),
                ...payload
            };
            this.discountAssetsLoaded = true;
            this.discountAssetsLoading = false;
            this.discountAssetsLoadError = '';

            const preferredTabs = [this.discountAssetsActiveTab, 'available', 'used', 'inactive'];
            const nextTab = preferredTabs.find((tabId) => this.getDiscountAssetsListByTab(tabId).length > 0) || 'available';
            this.discountAssetsActiveTab = nextTab;
            this.discountAssetsSummaryFilter = this.discountAssetsSummaryFilter === 'expiring' ? 'expiring' : 'available';
        },

        restoreDiscountAssetsFromCache() {
            const pointsService = window.PointsService;
            if (!pointsService?.peekWalletDiscountAssets) {
                return false;
            }

            const cachedPayload = pointsService.peekWalletDiscountAssets({
                site: window.SiteConfig?.site || 'cn'
            });
            if (!cachedPayload) {
                return false;
            }

            this.applyDiscountAssetsPayload(cachedPayload);
            return true;
        },

        getDiscountAssetKey(asset = {}, tabId = this.discountAssetsActiveTab) {
            const directKey = String(asset.asset_id || asset.id || '').trim();
            if (directKey) {
                return directKey;
            }
            return [
                tabId || 'available',
                String(asset.code || '').trim() || 'card',
                String(asset.benefit_label || '').trim() || 'benefit',
                String(asset.effective_expires_at || asset.consumed_at || '').trim() || 'na'
            ].join(':');
        },

        renderDiscountAssetsViewShell() {
            return `
                <div class="wallet-view" id="view-cards">
                    <div class="wallet-discount-assets-shell">
                        <div class="wallet-discount-assets-head">
                            <div>
                                <h3 class="view-title">${this.renderWalletInlineIcon('fa-ticket-alt', '#f472b6', 'wallet-inline-icon--title')}${window.i18n?.t('wallet.cards') || '卡券'}</h3>
                                <p class="wallet-discount-assets-subtitle">${this.tr('wallet.cardsSubtitle', '这里展示已经到账、后续下单时可直接选择使用的优惠券。')}</p>
                            </div>
                            <button type="button" class="wallet-discount-assets-refresh"${this.buildDataAttributes({ 'wallet-action': 'refresh-discount-assets' })}>${this.tr('wallet.refresh', '刷新')}</button>
                        </div>
                        <div class="wallet-discount-assets-body" id="wallet-discount-assets">
                            <div class="loading-text">${this.tr('wallet.cardsPreparing', '卡券信息准备中...')}</div>
                        </div>
                    </div>
                </div>
            `;
        },

        updateDiscountAssetsMenuBadge() {
            const badgeEl = document.getElementById('wallet-menu-cards-badge');
            if (!badgeEl) {
                return;
            }

            const availableCount = Math.max(0, Number(this.discountAssetsData?.summary?.available_count || 0) || 0);
            badgeEl.textContent = availableCount > 99 ? '99+' : String(availableCount);
            badgeEl.hidden = availableCount <= 0;
        },

        getDiscountAssetsListByTab(tabId = this.discountAssetsActiveTab) {
            const data = this.discountAssetsData || this.getDefaultDiscountAssetsData();
            if (tabId === 'used') {
                return Array.isArray(data.used_assets) ? data.used_assets : [];
            }
            if (tabId === 'inactive') {
                return Array.isArray(data.inactive_assets) ? data.inactive_assets : [];
            }
            return Array.isArray(data.available_assets) ? data.available_assets : [];
        },

        getDiscountAssetsEmptyState(tabId = this.discountAssetsActiveTab) {
            if (tabId === 'used') {
                return {
                    title: this.tr('wallet.noUsedCardsTitle', '还没有使用过卡券'),
                    copy: this.tr('wallet.noUsedCardsCopy', '后续在商城下单并用券后，会在这里留下使用记录。'),
                    action: 'jump-discount-assets-orders',
                    actionLabel: window.i18n?.t('wallet.records') || '记录'
                };
            }
            if (tabId === 'inactive') {
                return {
                    title: this.tr('wallet.noInactiveCardsTitle', '当前没有失效卡券'),
                    copy: this.tr('wallet.noInactiveCardsCopy', '过期、停用或暂未生效的卡券会在这里统一展示。'),
                    action: 'open-discount-assets-shop',
                    actionLabel: this.tr('wallet.goShop', '去商城')
                };
            }
            return {
                title: this.tr('wallet.noAvailableCardsTitle', '当前没有可用卡券'),
                copy: this.tr('wallet.noAvailableCardsCopy', '你可以继续去商城下单，或等待签到、推广、充值等活动发券。'),
                action: 'open-discount-assets-shop',
                actionLabel: this.tr('wallet.goShop', '去商城')
            };
        },

        getDiscountAssetPrimaryAction(asset = {}, tabId = this.discountAssetsActiveTab) {
            const scopeProduct = asset?.scope_product && typeof asset.scope_product === 'object'
                ? asset.scope_product
                : null;
            const hasActiveScopedProduct = tabId === 'available'
                && scopeProduct?.id
                && scopeProduct?.is_active !== false
                && scopeProduct?.is_missing !== true;

            if (tabId === 'used') {
                return {
                    action: 'jump-discount-assets-orders',
                    label: window.i18n?.t('wallet.records') || '记录',
                    attrs: this.buildDataAttributes({ 'wallet-action': 'jump-discount-assets-orders' })
                };
            }

            if (hasActiveScopedProduct) {
                return {
                    action: 'open-discount-assets-product',
                    label: this.tr('wallet.viewProduct', '查看商品'),
                    attrs: this.buildDataAttributes({
                        'wallet-action': 'open-discount-assets-product',
                        'wallet-discount-asset-id': this.encodeActionValue(asset.asset_id || asset.id || ''),
                        'wallet-product-id': this.encodeActionValue(scopeProduct.id),
                        'wallet-product-category': this.encodeActionValue(scopeProduct.category || '')
                    })
                };
            }

            return {
                action: 'open-discount-assets-shop',
                label: this.tr('wallet.goShop', '去商城'),
                attrs: this.buildDataAttributes({ 'wallet-action': 'open-discount-assets-shop' })
            };
        },

        buildShopPurchasePrefillFromAsset(asset = {}, { productId = '', productCategory = '' } = {}) {
            const normalizedProductId = String(productId || asset?.scope_product?.id || asset?.scope_product_id || '').trim();
            if (!normalizedProductId) {
                return null;
            }

            const preview = asset?.scoped_product_preview && typeof asset.scoped_product_preview === 'object' && !Array.isArray(asset.scoped_product_preview)
                ? {
                    ...asset.scoped_product_preview
                }
                : null;

            return {
                version: '20260415_SHOP_PURCHASE_PREFILL_1',
                timestamp: Date.now(),
                site: window.SiteConfig?.site || 'cn',
                productId: normalizedProductId,
                category: String(productCategory || asset?.scope_product?.category || '').trim() || null,
                ownedDiscounts: [{
                    asset_id: asset.asset_id || asset.id || null,
                    discount_id: asset.discount_id || null,
                    code: asset.code || '',
                    benefit_label: asset.benefit_label || '',
                    discount_type: asset.discount_type || null,
                    discount_value: asset.discount_value ?? null,
                    distribution_mode: asset.distribution_mode || 'user_assigned',
                    is_exclusive: asset.is_exclusive !== false,
                    stacking_label: asset.stacking_label || null,
                    stacking_summary: asset.stacking_summary || null,
                    source_channel: asset.source_channel || null,
                    expires_at: asset.expires_at || asset.effective_expires_at || null,
                    available: asset.status_group === 'available'
                        && asset.status_tone !== 'inactive'
                        && asset.scoped_product_available !== false,
                    message: String(asset.scoped_product_message || asset.status_detail || '').trim(),
                    preview
                }],
                claimableDiscounts: []
            };
        },

        persistShopPurchasePrefill(prefill = null) {
            if (!prefill || typeof sessionStorage === 'undefined') {
                return;
            }

            try {
                sessionStorage.setItem('shop_purchase_prefill', JSON.stringify(prefill));
            } catch (error) {
                console.warn('[WalletModal] Failed to persist shop purchase prefill:', error);
            }
        },

        renderDiscountAssetBenefitMarkup(assetOrLabel) {
            const rawLabel = typeof assetOrLabel === 'object' && assetOrLabel
                ? this.getLocalizedDiscountBenefitLabel(assetOrLabel)
                : (String(assetOrLabel || '').trim() || this.tr('wallet.cardFallback', '卡券'));
            const discountMatch = rawLabel.match(/^(\d+(?:\.\d+)?)(?:\s*)(折)$/);
            const fixedMatch = rawLabel.match(/^立减\s*(\d+(?:\.\d+)?)\s*(积分)$/);

            if (fixedMatch) {
                const [, value, unit] = fixedMatch;
                return `
                    <span class="wallet-discount-assets-card-benefit-side wallet-discount-assets-card-benefit-side--fixed">
                        <span class="wallet-discount-assets-card-benefit-prefix">立减</span>
                        <span class="wallet-discount-assets-card-benefit-value wallet-discount-assets-card-benefit-value--fixed">${this.escapeHtml(value)}</span>
                        <span class="wallet-discount-assets-card-benefit-unit wallet-discount-assets-card-benefit-unit--fixed">${this.escapeHtml(unit)}</span>
                    </span>
                `;
            }

            if (!discountMatch) {
                return `<span class="wallet-discount-assets-card-benefit-side wallet-discount-assets-card-benefit-side--plain">${this.escapeHtml(rawLabel)}</span>`;
            }

            const [, value, unit] = discountMatch;
            return `
                <span class="wallet-discount-assets-card-benefit-side wallet-discount-assets-card-benefit-side--discount">
                    <span class="wallet-discount-assets-card-benefit-value">${this.escapeHtml(value)}</span>
                    <span class="wallet-discount-assets-card-benefit-unit">${this.escapeHtml(unit)}</span>
                </span>
            `;
        },

        formatDiscountAssetStackingLabel(asset = {}) {
            const explicitLabel = String(asset.stacking_label || '').trim();
            if (explicitLabel && (!this.isEnglishLanguage() || !this.containsCjkText(explicitLabel))) {
                return explicitLabel === '可并行权益'
                    ? this.tr('wallet.stackable', '可叠加')
                    : explicitLabel;
            }
            return asset?.is_exclusive === false
                ? this.tr('wallet.stackable', '可叠加')
                : this.tr('wallet.exclusiveCouponShort', '排他券');
        },

        formatDiscountAssetStackingSummary(asset = {}) {
            const explicitSummary = String(asset.stacking_summary || '').trim();
            if (explicitSummary && (!this.isEnglishLanguage() || !this.containsCjkText(explicitSummary))) {
                return explicitSummary;
            }
            return asset?.is_exclusive === false
                ? this.tr('wallet.stackableSummary', '可与其它优惠券叠加')
                : this.tr('wallet.exclusiveSummary', '不可与其它优惠券叠加');
        },

        renderDiscountAssetCard(asset = {}, tabId = this.discountAssetsActiveTab) {
            const assetKey = this.getDiscountAssetKey(asset, tabId);
            const isExpanded = this.discountAssetsExpandedKey === assetKey;
            const assetId = String(asset.asset_id || asset.id || '').trim();
            const isRemovingAsset = assetId && this.discountAssetsRemovingId === assetId;
            const benefitMarkup = this.renderDiscountAssetBenefitMarkup(asset);
            const codeLabel = this.escapeHtml(asset.code || '--');
            const scopeLabel = this.escapeHtml(this.getLocalizedDiscountScopeLabel(asset));
            const stackingLabel = this.escapeHtml(this.formatDiscountAssetStackingLabel(asset));
            const stackingSummary = this.escapeHtml(this.formatDiscountAssetStackingSummary(asset));
            const stackingChipClass = asset?.is_exclusive === false
                ? 'wallet-discount-assets-card-chip wallet-discount-assets-card-chip--stackable'
                : 'wallet-discount-assets-card-chip wallet-discount-assets-card-chip--exclusive';
            const sourceLabel = this.escapeHtml(this.getLocalizedDiscountSourceLabel(asset));
            const rawStatusLabel = this.getLocalizedDiscountStatusLabel(asset, tabId);
            const statusLabel = this.escapeHtml(rawStatusLabel);
            const rawStatusDetail = this.getLocalizedDiscountStatusDetail(asset, tabId);
            const statusDetail = this.escapeHtml(rawStatusDetail);
            const expiryText = asset.effective_expires_at
                ? this.escapeHtml(this.formatOrderDateTime(asset.effective_expires_at))
                : this.tr('wallet.longTermValid', '长期有效');
            const campaignTag = asset.campaign_tag
                ? `<span class="wallet-discount-assets-tag">${this.escapeHtml(asset.campaign_tag)}</span>`
                : '';
            const scopeProduct = asset?.scope_product && typeof asset.scope_product === 'object'
                ? asset.scope_product
                : null;
            const scopeProductName = this.getLocalizedProductNameFromPayload(scopeProduct || {}, '');
            const scopeProductLabel = asset.scope_type === 'product'
                ? this.escapeHtml(scopeProductName
                    ? (scopeProduct?.is_active === false
                        ? `${scopeProductName} (${this.tr('wallet.productCurrentlyHidden', '该商品当前暂不可见')})`
                        : scopeProductName)
                    : this.tr('wallet.productCurrentlyHidden', '该商品当前暂不可见'))
                : '';
            const relatedOrder = asset.related_order || null;
            const relatedOrderName = relatedOrder
                ? this.getLocalizedProductNameFromPayload(relatedOrder, this.tr('wallet.shopOrder', '商城订单'))
                : '';
            const relatedOrderMarkup = relatedOrder
                ? `
                    <div class="wallet-discount-assets-card-line wallet-discount-assets-card-line--wide">
                        <span>${this.tr('wallet.relatedOrder', '关联订单')}</span>
                        <strong>${this.escapeHtml(relatedOrderName)}${Number(relatedOrder.discount_amount || 0) > 0 ? ` · ${this.tr('wallet.savedPoints', '节省 {amount} {unit}', {
                            amount: this.formatPoints(relatedOrder.discount_amount),
                            unit: this.tr('wallet.pointsUnit', '积分')
                        })}` : ''}</strong>
                    </div>
                `
                : '';
            const normalizedStatusTone = String(asset.status_tone || '').trim();
            const statusClass = normalizedStatusTone === 'used'
                ? 'wallet-discount-assets-status--used'
                : normalizedStatusTone === 'inactive'
                    ? 'wallet-discount-assets-status--inactive'
                : tabId === 'used'
                        ? 'wallet-discount-assets-status--used'
                        : tabId === 'inactive'
                            ? 'wallet-discount-assets-status--inactive'
                            : 'wallet-discount-assets-status--available';
            const showStatusBadge = rawStatusLabel !== this.tr('wallet.available', '可用');
            const primaryAction = this.getDiscountAssetPrimaryAction(asset, tabId);
            const scopeProductMarkup = asset.scope_type === 'product'
                ? `
                    <div class="wallet-discount-assets-card-line wallet-discount-assets-card-line--wide wallet-discount-assets-card-line--scope">
                        <div class="wallet-discount-assets-card-line-content">
                            <span>${this.tr('wallet.applicableProduct', '适用商品')}</span>
                            <strong>${scopeProductLabel}</strong>
                        </div>
                    </div>
                `
                : '';
            const shouldHideEstimatedPayHint = /打开指定商品后(?:预计)?实付/.test(rawStatusDetail);
            const shouldRenderStatusNote = !shouldHideEstimatedPayHint && statusDetail;
            const primaryActionMarkup = `<button type="button" class="wallet-discount-assets-card-action"${primaryAction.attrs}>${primaryAction.label}</button>`;
            const canRemove = tabId !== 'used'
                && tabId !== 'inactive'
                && asset?.can_remove !== false
                && assetId;
            const removeActionMarkup = canRemove
                ? `
                    <button
                        type="button"
                        class="wallet-discount-assets-card-action wallet-discount-assets-card-action--danger${isRemovingAsset ? ' is-busy' : ''}"
                        ${this.buildDataAttributes({
                            'wallet-action': 'remove-discount-asset',
                            'wallet-discount-asset-id': this.encodeActionValue(assetId)
                        })}
                        ${isRemovingAsset ? 'disabled' : ''}
                    >
                        ${isRemovingAsset ? this.tr('wallet.deleting', '删除中...') : this.tr('wallet.delete', '删除')}
                    </button>
                `
                : '';
            const actionButtonsMarkup = (primaryActionMarkup || removeActionMarkup)
                ? `
                    <div class="wallet-discount-assets-card-actions">
                        ${primaryActionMarkup}
                        ${removeActionMarkup}
                    </div>
                `
                : '';
            const tagsMarkup = campaignTag
                ? `<div class="wallet-discount-assets-tags">${campaignTag}</div>`
                : '';
            const footMarkup = (tagsMarkup || actionButtonsMarkup)
                ? `
                    <div class="wallet-discount-assets-card-foot">
                        ${tagsMarkup}
                        ${actionButtonsMarkup}
                    </div>
                `
                : '';

            return `
                <article class="wallet-discount-assets-card${isExpanded ? ' expanded' : ''}">
                    <button
                        type="button"
                        class="wallet-discount-assets-card-toggle"
                        aria-expanded="${isExpanded ? 'true' : 'false'}"
                        ${this.buildDataAttributes({ 'wallet-action': 'toggle-discount-asset-card', 'wallet-asset-key': assetKey })}
                    >
                        <div class="wallet-discount-assets-card-summary">
                            <div class="wallet-discount-assets-card-title-wrap">
                                <div class="wallet-discount-assets-card-meta">
                                    <span class="wallet-discount-assets-card-chip wallet-discount-assets-card-chip--code">${codeLabel}</span>
                                    <span class="wallet-discount-assets-card-chip">${scopeLabel}</span>
                                    <span class="${stackingChipClass}">${stackingLabel}</span>
                                </div>
                            </div>
                        </div>
                        <div class="wallet-discount-assets-card-toggle-side${showStatusBadge ? '' : ' wallet-discount-assets-card-toggle-side--available'}">
                            ${showStatusBadge ? `<span class="wallet-discount-assets-status ${statusClass}">${statusLabel}</span>` : ''}
                            <div class="wallet-discount-assets-card-toggle-main">
                                ${benefitMarkup}
                            </div>
                        </div>
                    </button>
                    ${isExpanded ? `
                        <div class="wallet-discount-assets-card-panel">
                            <div class="wallet-discount-assets-card-body">
                                <div class="wallet-discount-assets-card-grid">
                                    <div class="wallet-discount-assets-card-line">
                                        <span>${this.tr('wallet.source', '来源')}</span>
                                        <strong>${sourceLabel}</strong>
                                    </div>
                                    <div class="wallet-discount-assets-card-line">
                                        <span>${this.tr('wallet.validity', '有效期')}</span>
                                        <strong>${expiryText}</strong>
                                    </div>
                                    <div class="wallet-discount-assets-card-line wallet-discount-assets-card-line--wide">
                                        <strong>${stackingSummary}</strong>
                                    </div>
                                    ${scopeProductMarkup}
                                    ${relatedOrderMarkup}
                                </div>
                                ${shouldRenderStatusNote ? `<div class="wallet-discount-assets-card-note">${statusDetail}</div>` : ''}
                            </div>
                            ${footMarkup}
                        </div>
                    ` : ''}
                </article>
            `;
        },

        renderDiscountAssetsView() {
            const container = document.getElementById('wallet-discount-assets');
            this.updateDiscountAssetsMenuBadge();

            if (!container) {
                return;
            }

            if (this.discountAssetsLoading) {
                container.innerHTML = `<div class="loading-text">${this.tr('wallet.cardsSyncing', '正在同步你的卡券...')}</div>`;
                return;
            }

            if (this.discountAssetsLoadError) {
                container.innerHTML = `
                    <div class="wallet-discount-assets-empty">
                        <div class="wallet-discount-assets-empty-title">${this.tr('wallet.cardsLoadFailed', '卡券加载失败')}</div>
                        <div class="wallet-discount-assets-empty-copy">${this.escapeHtml(this.discountAssetsLoadError)}</div>
                        <button type="button" class="wallet-discount-assets-empty-action"${this.buildDataAttributes({ 'wallet-action': 'refresh-discount-assets' })}>${this.tr('wallet.reload', '重新加载')}</button>
                    </div>
                `;
                return;
            }

            if (!this.discountAssetsLoaded) {
                container.innerHTML = `
                    <div class="wallet-discount-assets-empty">
                        <div class="wallet-discount-assets-empty-title">${this.tr('wallet.cardsNotLoadedTitle', '已到账的优惠券会收进这里')}</div>
                        <div class="wallet-discount-assets-empty-copy">${this.tr('wallet.cardsNotLoadedCopy', '切到这个页签后，系统会自动同步你在当前站点可见的卡券资产。')}</div>
                    </div>
                `;
                return;
            }

            const data = this.discountAssetsData || this.getDefaultDiscountAssetsData();
            const summary = data.summary || {};
            const availableAssets = Array.isArray(data.available_assets) ? data.available_assets : [];
            const expiringAssets = availableAssets.filter((asset) => asset?.is_expiring_soon === true);
            const summaryFilter = this.discountAssetsSummaryFilter === 'expiring' ? 'expiring' : 'available';
            const listItems = summaryFilter === 'expiring' ? expiringAssets : availableAssets;
            const sectionId = summaryFilter === 'expiring' ? 'expiring' : 'available';
            const sectionTitle = summaryFilter === 'expiring'
                ? this.tr('wallet.expiringSoon', '即将过期')
                : this.tr('wallet.availableNow', '当前可用');
            const emptyState = summaryFilter === 'expiring'
                ? {
                    title: this.tr('wallet.noExpiringCardsTitle', '当前没有即将过期卡券'),
                    copy: this.tr('wallet.noExpiringCardsCopy', '进入即将过期前 72 小时的卡券会展示在这里。'),
                    action: 'select-discount-assets-summary-filter',
                    actionLabel: this.tr('wallet.viewAvailableCards', '查看当前可用'),
                    actionValue: 'available'
                }
                : this.getDiscountAssetsEmptyState('available');
            const expandedStillExists = listItems.some((asset) => this.getDiscountAssetKey(asset, sectionId) === this.discountAssetsExpandedKey);
            if (!expandedStillExists) {
                this.discountAssetsExpandedKey = '';
            }

            container.innerHTML = `
                <div class="wallet-discount-assets-summary">
                    <button
                        type="button"
                        class="wallet-discount-assets-summary-card wallet-discount-assets-summary-card--primary wallet-discount-assets-summary-card--interactive${summaryFilter === 'available' ? ' active' : ''}"
                        ${this.buildDataAttributes({ 'wallet-action': 'select-discount-assets-summary-filter', 'wallet-summary-filter': 'available' })}
                    >
                        <span>${this.tr('wallet.availableNow', '当前可用')}</span>
                        <strong>${this.formatPoints(summary.available_count || 0)}</strong>
                    </button>
                    <button
                        type="button"
                        class="wallet-discount-assets-summary-card wallet-discount-assets-summary-card--interactive${summaryFilter === 'expiring' ? ' active' : ''}"
                        ${this.buildDataAttributes({ 'wallet-action': 'select-discount-assets-summary-filter', 'wallet-summary-filter': 'expiring' })}
                    >
                        <span>${this.tr('wallet.expiringSoon', '即将过期')}</span>
                        <strong>${this.formatPoints(summary.expiring_soon_count || 0)}</strong>
                    </button>
                    <div class="wallet-discount-assets-summary-card">
                        <span>${this.tr('wallet.savedTotal', '累计省下')}</span>
                        <strong>${this.formatPoints(summary.saved_amount_total || 0)} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</strong>
                    </div>
                </div>
                <div class="wallet-discount-assets-list-shell">
                ${listItems.length > 0
                    ? `
                        <div class="wallet-discount-assets-sections">
                            <section class="wallet-discount-assets-section">
                                <div class="wallet-discount-assets-section-head">
                                    <span class="wallet-discount-assets-section-title">${this.escapeHtml(sectionTitle)}</span>
                                </div>
                                <div class="wallet-discount-assets-list">${listItems.map((asset) => this.renderDiscountAssetCard(asset, sectionId)).join('')}</div>
                            </section>
                        </div>
                    `
                    : `
                        <div class="wallet-discount-assets-empty">
                            <div class="wallet-discount-assets-empty-title">${this.escapeHtml(emptyState.title)}</div>
                            <div class="wallet-discount-assets-empty-copy">${this.escapeHtml(emptyState.copy)}</div>
                            <button
                                type="button"
                                class="wallet-discount-assets-empty-action"
                                ${this.buildDataAttributes(emptyState.actionValue
                                    ? {
                                        'wallet-action': emptyState.action,
                                        'wallet-summary-filter': emptyState.actionValue
                                    }
                                    : {
                                        'wallet-action': emptyState.action
                                    })}
                            >
                                ${this.escapeHtml(emptyState.actionLabel)}
                            </button>
                        </div>
                    `}
                </div>
            `;
        },

        async loadDiscountAssets(forceRefresh = false) {
            if (this.discountAssetsLoading) {
                return;
            }

            if (this.discountAssetsLoaded && !forceRefresh) {
                this.renderDiscountAssetsView();
                return;
            }

            if (!forceRefresh && this.restoreDiscountAssetsFromCache()) {
                this.renderDiscountAssetsView();
                return;
            }

            this.discountAssetsLoading = true;
            this.discountAssetsLoadError = '';
            this.renderDiscountAssetsView();

            try {
                const pointsService = window.PointsService;
                let payload = null;

                if (pointsService?.getWalletDiscountAssets) {
                    payload = await pointsService.getWalletDiscountAssets({
                        site: window.SiteConfig?.site || 'cn',
                        force: forceRefresh
                    });
                } else {
                    const { data: { session } } = await window.supabaseClient.auth.getSession();
                    if (!session?.access_token) {
                        throw new Error(window.i18n?.t('security.loginRequired') || '请先登录');
                    }

                    const response = await fetch('/api/shop/my-discount-assets', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${session.access_token}`
                        },
                        body: JSON.stringify({
                            site: window.SiteConfig?.site || 'cn'
                        })
                    });
                    payload = await response.json().catch(() => ({}));

                    if (!response.ok || payload?.success === false) {
                        throw new Error(payload?.message || '加载卡券失败');
                    }
                }

                this.applyDiscountAssetsPayload(payload);
            } catch (error) {
                console.error('[WalletModal] Load discount assets failed:', error);
                this.discountAssetsData = this.getDefaultDiscountAssetsData();
                this.discountAssetsLoaded = false;
                this.discountAssetsLoadError = error?.message || '加载卡券失败';
            } finally {
                this.discountAssetsLoading = false;
                this.renderDiscountAssetsView();
            }
        },

        async removeDiscountAsset(assetId = '') {
            const normalizedAssetId = String(assetId || '').trim();
            if (!normalizedAssetId || this.discountAssetsRemovingId === normalizedAssetId) {
                return;
            }

            const availableAssets = this.getDiscountAssetsListByTab('available');
            const matchedAsset = availableAssets.find((asset) => String(asset?.asset_id || asset?.id || '').trim() === normalizedAssetId) || null;
            if (!matchedAsset) {
                this.showToast('未找到这张卡券', 'error');
                return;
            }

            const confirmLabel = matchedAsset.benefit_label || matchedAsset.code || '这张卡券';
            if (!confirm(this.tr('wallet.confirmDeleteCard', '确定要删除 {label} 吗？\n\n删除后将不能恢复使用。', { label: confirmLabel }))) {
                return;
            }

            this.discountAssetsRemovingId = normalizedAssetId;
            this.renderDiscountAssetsView();

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (!session?.access_token) {
                    throw new Error(window.i18n?.t('security.loginRequired') || '请先登录');
                }

                const response = await fetch('/api/shop/remove-discount-asset', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({
                        site: window.SiteConfig?.site || 'cn',
                        assetId: normalizedAssetId
                    })
                });
                const payload = await response.json().catch(() => ({}));

                if (!response.ok || payload?.success === false) {
                    throw new Error(payload?.message || this.tr('wallet.deleteCardFailed', '删除卡券失败'));
                }

                window.PointsService?.invalidateWalletDiscountAssets?.({
                    site: window.SiteConfig?.site || 'cn'
                });
                if (this.discountAssetsExpandedKey === normalizedAssetId) {
                    this.discountAssetsExpandedKey = '';
                }

                await this.loadDiscountAssets(true);
                this.showToast(payload?.message || this.tr('wallet.cardDeleted', '卡券已删除'), 'success');
            } catch (error) {
                console.error('[WalletModal] Remove discount asset failed:', error);
                this.showToast(error?.message || this.tr('wallet.deleteCardFailed', '删除卡券失败'), 'error');
            } finally {
                this.discountAssetsRemovingId = '';
                if (!this.discountAssetsLoading) {
                    this.renderDiscountAssetsView();
                }
            }
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
                custom_amount_enabled: false,
                mock_payment_enabled: false,
                custom_amount_min_points: 0.01,
                custom_amount_max_points: 50000,
                custom_amount_step: 0.01,
                custom_amount_points_per_cny: 1,
                custom_amount_quote_ttl_seconds: 1800
            };
        },

        normalizeRechargeOptionsConfig(raw) {
            const defaults = this.getDefaultRechargeOptionsConfig();
            const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

            return {
                custom_amount_enabled: source.custom_amount_enabled === true || String(source.custom_amount_enabled) === 'true'
                    ? true
                    : defaults.custom_amount_enabled,
                mock_payment_enabled: source.mock_payment_enabled === true || String(source.mock_payment_enabled) === 'true'
                    ? true
                    : defaults.mock_payment_enabled,
                custom_amount_min_points: defaults.custom_amount_min_points,
                custom_amount_max_points: Math.max(
                    defaults.custom_amount_min_points,
                    this.normalizePointValue(source.custom_amount_max_points, defaults.custom_amount_max_points)
                ),
                custom_amount_step: defaults.custom_amount_step,
                custom_amount_points_per_cny: defaults.custom_amount_points_per_cny,
                custom_amount_quote_ttl_seconds: Math.max(60, Math.round(Number(source.custom_amount_quote_ttl_seconds) || defaults.custom_amount_quote_ttl_seconds))
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

        getDefaultPaymentChannelsConfig() {
            const rechargeOptions = this.normalizeRechargeOptionsConfig(this.rechargeOptionsConfig);
            const currentOrigin = window.location?.origin || 'https://www.zaoyoe.com';
            const buildDefaultPaymentWebhookUrl = (providerKey = '') => {
                const normalizedProviderKey = String(providerKey || '').trim().toLowerCase();
                return normalizedProviderKey
                    ? `${currentOrigin}/api/payments/${normalizedProviderKey}/webhook`
                    : currentOrigin;
            };
            const resolvePreferredActiveProviderKey = (providers = {}, fallback = 'afdian') => {
                const candidateKeys = ['zpay', 'hupijiao', 'afdian', ...Object.keys(providers || {})];
                const seen = new Set();

                for (const providerKey of candidateKeys) {
                    const normalizedKey = String(providerKey || '').trim().toLowerCase();
                    if (!normalizedKey || normalizedKey === 'mock' || seen.has(normalizedKey)) {
                        continue;
                    }
                    seen.add(normalizedKey);
                    const provider = providers?.[normalizedKey];
                    if (provider?.enabled === true && String(provider.checkout_url || '').trim()) {
                        return normalizedKey;
                    }
                }

                for (const providerKey of candidateKeys) {
                    const normalizedKey = String(providerKey || '').trim().toLowerCase();
                    if (!normalizedKey || normalizedKey === 'mock' || seen.has(`enabled:${normalizedKey}`)) {
                        continue;
                    }
                    seen.add(`enabled:${normalizedKey}`);
                    const provider = providers?.[normalizedKey];
                    if (provider?.enabled === true) {
                        return normalizedKey;
                    }
                }

                return ['mock', 'afdian', 'hupijiao', 'zpay'].includes(fallback) ? fallback : 'afdian';
            };

            const providers = {
                mock: {
                    enabled: true,
                    display_name: this.tr('wallet.mockPayment', '模拟支付'),
                    description: this.tr('wallet.mockPaymentDescription', '仅建议在正式支付接入前短期使用，开启后将直接到账积分。')
                },
                afdian: {
                    enabled: true,
                    display_name: '爱发电',
                    checkout_url: window.PAYMENT_AFDIAN_URL || 'https://afdian.com/a/zaoyoe',
                    package_hint: this.tr('wallet.afdianPackageHint', '请在爱发电完成支付后，返回这里输入订单号领取兑换码。'),
                    custom_amount_hint: this.tr('wallet.customAmountPaymentHint', '钱包会先生成本次应付金额，请按报价完成支付后返回这里输入订单号领取兑换码。'),
                    order_query_enabled: true,
                    order_query_title: '订单号认领',
                    order_query_hint: this.tr('wallet.paymentOrderQueryHint', '完成支付后，可在这里输入订单号查询兑换结果。'),
                    order_query_placeholder: this.tr('wallet.paymentOrderNo', '输入支付平台订单号')
                },
                zpay: {
                    enabled: false,
                    display_name: '易支付',
                    checkout_url: 'https://zpayz.cn',
                    pid: '',
                    payment_type: 'alipay',
                    channel_ids: '',
                    return_url: currentOrigin,
                    notify_url: buildDefaultPaymentWebhookUrl('zpay'),
                    package_hint: this.tr('wallet.zpayPackageHint', '易支付订单创建后会直接拉起收银台完成支付。'),
                    custom_amount_hint: this.tr('wallet.zpayCustomAmountHint', '易支付会按当前报价创建订单并直接拉起收银台。'),
                    order_query_enabled: false,
                    order_query_title: '',
                    order_query_hint: '',
                    order_query_placeholder: ''
                },
                hupijiao: {
                    enabled: false,
                    display_name: '虎皮椒',
                    checkout_url: '',
                    gateway_url: '',
                    merchant_id: '',
                    return_url: currentOrigin,
                    notify_url: buildDefaultPaymentWebhookUrl('hupijiao'),
                    package_hint: this.tr('wallet.hupijiaoPackageHint', '虎皮椒通道已启用，完成支付后请按页面提示处理。'),
                    custom_amount_hint: this.tr('wallet.hupijiaoCustomAmountHint', '虎皮椒通道已启用。自定义金额真实支付能力接入后，这里会直接拉起支付。'),
                    order_query_enabled: false,
                    order_query_title: '',
                    order_query_hint: '',
                    order_query_placeholder: ''
                }
            };
            providers.afdian.order_query_title = this.tr('wallet.orderClaimTitle', providers.afdian.order_query_title);
            const activeProvider = rechargeOptions.mock_payment_enabled
                ? 'mock'
                : resolvePreferredActiveProviderKey(providers, 'afdian');

            return {
                active_provider: activeProvider,
                providers
            };
        },

        normalizePaymentChannelsConfig(raw) {
            const defaults = this.getDefaultPaymentChannelsConfig();
            const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
            const sourceProviders = source.providers && typeof source.providers === 'object' && !Array.isArray(source.providers)
                ? source.providers
                : {};
            const resolvePreferredActiveProviderKey = (providers = {}, fallback = defaults.active_provider) => {
                const candidateKeys = ['zpay', 'hupijiao', 'afdian', ...Object.keys(providers || {})];
                const seen = new Set();

                for (const providerKey of candidateKeys) {
                    const normalizedKey = String(providerKey || '').trim().toLowerCase();
                    if (!normalizedKey || normalizedKey === 'mock' || seen.has(normalizedKey)) {
                        continue;
                    }
                    seen.add(normalizedKey);
                    const provider = providers?.[normalizedKey];
                    if (provider?.enabled === true && String(provider.checkout_url || '').trim()) {
                        return normalizedKey;
                    }
                }

                for (const providerKey of candidateKeys) {
                    const normalizedKey = String(providerKey || '').trim().toLowerCase();
                    if (!normalizedKey || normalizedKey === 'mock' || seen.has(`enabled:${normalizedKey}`)) {
                        continue;
                    }
                    seen.add(`enabled:${normalizedKey}`);
                    const provider = providers?.[normalizedKey];
                    if (provider?.enabled === true) {
                        return normalizedKey;
                    }
                }

                return ['mock', 'afdian', 'hupijiao', 'zpay'].includes(fallback) ? fallback : defaults.active_provider;
            };

            const normalized = {
                active_provider: ['mock', 'afdian', 'hupijiao', 'zpay'].includes(source.active_provider)
                    ? source.active_provider
                    : resolvePreferredActiveProviderKey(sourceProviders, defaults.active_provider),
                providers: {
                    mock: {
                        enabled: sourceProviders.mock?.enabled !== undefined
                            ? (sourceProviders.mock.enabled === true || String(sourceProviders.mock.enabled) === 'true')
                            : defaults.providers.mock.enabled,
                        display_name: String(sourceProviders.mock?.display_name || defaults.providers.mock.display_name).trim() || defaults.providers.mock.display_name,
                        description: String(sourceProviders.mock?.description || defaults.providers.mock.description).trim() || defaults.providers.mock.description
                    },
                    afdian: {
                        enabled: sourceProviders.afdian?.enabled !== undefined
                            ? (sourceProviders.afdian.enabled === true || String(sourceProviders.afdian.enabled) === 'true')
                            : defaults.providers.afdian.enabled,
                        display_name: String(sourceProviders.afdian?.display_name || defaults.providers.afdian.display_name).trim() || defaults.providers.afdian.display_name,
                        checkout_url: String(sourceProviders.afdian?.checkout_url || defaults.providers.afdian.checkout_url).trim() || defaults.providers.afdian.checkout_url,
                        package_hint: String(sourceProviders.afdian?.package_hint || defaults.providers.afdian.package_hint).trim() || defaults.providers.afdian.package_hint,
                        custom_amount_hint: String(sourceProviders.afdian?.custom_amount_hint || defaults.providers.afdian.custom_amount_hint).trim() || defaults.providers.afdian.custom_amount_hint,
                        order_query_enabled: sourceProviders.afdian?.order_query_enabled !== undefined
                            ? (sourceProviders.afdian.order_query_enabled === true || String(sourceProviders.afdian.order_query_enabled) === 'true')
                            : defaults.providers.afdian.order_query_enabled,
                        order_query_title: String(sourceProviders.afdian?.order_query_title || defaults.providers.afdian.order_query_title).trim() || defaults.providers.afdian.order_query_title,
                        order_query_hint: String(sourceProviders.afdian?.order_query_hint || defaults.providers.afdian.order_query_hint).trim() || defaults.providers.afdian.order_query_hint,
                        order_query_placeholder: String(sourceProviders.afdian?.order_query_placeholder || defaults.providers.afdian.order_query_placeholder).trim() || defaults.providers.afdian.order_query_placeholder
                    },
                    zpay: {
                        enabled: sourceProviders.zpay?.enabled === true || String(sourceProviders.zpay?.enabled) === 'true',
                        display_name: String(sourceProviders.zpay?.display_name || defaults.providers.zpay.display_name).trim() || defaults.providers.zpay.display_name,
                        checkout_url: String(sourceProviders.zpay?.checkout_url || defaults.providers.zpay.checkout_url).trim() || defaults.providers.zpay.checkout_url,
                        pid: String(sourceProviders.zpay?.pid || defaults.providers.zpay.pid).trim(),
                        payment_type: String(sourceProviders.zpay?.payment_type || defaults.providers.zpay.payment_type).trim().toLowerCase() || defaults.providers.zpay.payment_type,
                        channel_ids: String(sourceProviders.zpay?.channel_ids || defaults.providers.zpay.channel_ids).trim(),
                        return_url: String(sourceProviders.zpay?.return_url || defaults.providers.zpay.return_url).trim() || defaults.providers.zpay.return_url,
                        notify_url: String(sourceProviders.zpay?.notify_url || defaults.providers.zpay.notify_url).trim(),
                        package_hint: String(sourceProviders.zpay?.package_hint || defaults.providers.zpay.package_hint).trim() || defaults.providers.zpay.package_hint,
                        custom_amount_hint: String(sourceProviders.zpay?.custom_amount_hint || defaults.providers.zpay.custom_amount_hint).trim() || defaults.providers.zpay.custom_amount_hint,
                        order_query_enabled: sourceProviders.zpay?.order_query_enabled === true || String(sourceProviders.zpay?.order_query_enabled) === 'true',
                        order_query_title: String(sourceProviders.zpay?.order_query_title || defaults.providers.zpay.order_query_title).trim(),
                        order_query_hint: String(sourceProviders.zpay?.order_query_hint || defaults.providers.zpay.order_query_hint).trim(),
                        order_query_placeholder: String(sourceProviders.zpay?.order_query_placeholder || defaults.providers.zpay.order_query_placeholder).trim()
                    },
                    hupijiao: {
                        enabled: sourceProviders.hupijiao?.enabled === true || String(sourceProviders.hupijiao?.enabled) === 'true',
                        display_name: String(sourceProviders.hupijiao?.display_name || defaults.providers.hupijiao.display_name).trim() || defaults.providers.hupijiao.display_name,
                        checkout_url: String(sourceProviders.hupijiao?.checkout_url || defaults.providers.hupijiao.checkout_url).trim(),
                        gateway_url: String(sourceProviders.hupijiao?.gateway_url || defaults.providers.hupijiao.gateway_url).trim(),
                        merchant_id: String(sourceProviders.hupijiao?.merchant_id || defaults.providers.hupijiao.merchant_id).trim(),
                        return_url: String(sourceProviders.hupijiao?.return_url || defaults.providers.hupijiao.return_url).trim() || defaults.providers.hupijiao.return_url,
                        notify_url: String(sourceProviders.hupijiao?.notify_url || defaults.providers.hupijiao.notify_url).trim(),
                        package_hint: String(sourceProviders.hupijiao?.package_hint || defaults.providers.hupijiao.package_hint).trim() || defaults.providers.hupijiao.package_hint,
                        custom_amount_hint: String(sourceProviders.hupijiao?.custom_amount_hint || defaults.providers.hupijiao.custom_amount_hint).trim() || defaults.providers.hupijiao.custom_amount_hint,
                        order_query_enabled: sourceProviders.hupijiao?.order_query_enabled === true || String(sourceProviders.hupijiao?.order_query_enabled) === 'true',
                        order_query_title: String(sourceProviders.hupijiao?.order_query_title || defaults.providers.hupijiao.order_query_title).trim(),
                        order_query_hint: String(sourceProviders.hupijiao?.order_query_hint || defaults.providers.hupijiao.order_query_hint).trim(),
                        order_query_placeholder: String(sourceProviders.hupijiao?.order_query_placeholder || defaults.providers.hupijiao.order_query_placeholder).trim()
                    }
                }
            };

            if (!normalized.providers[normalized.active_provider]?.enabled) {
                normalized.providers[normalized.active_provider].enabled = true;
            }

            return normalized;
        },

        async loadPaymentChannelsConfig(forceRefresh = false) {
            if (!forceRefresh && this.paymentChannelsConfig) {
                return this.paymentChannelsConfig;
            }

            try {
                const { data, error } = await window.supabaseClient.rpc('get_system_config', {
                    p_key: 'payment_channels'
                });

                if (error) throw error;

                this.paymentChannelsConfig = this.normalizePaymentChannelsConfig(data);
            } catch (configError) {
                console.warn('[WalletModal] Failed to load payment channels config:', configError);
                this.paymentChannelsConfig = this.normalizePaymentChannelsConfig(null);
            }

            return this.paymentChannelsConfig;
        },

        getDefaultPaymentRuntimeConfig() {
            const allowLocalMock = window.PointsService?.isUnsafeDirectRechargeAllowed?.() === true;
            return {
                mock_payment: {
                    allowed: allowLocalMock,
                    reason: allowLocalMock ? 'local_runtime' : 'unknown',
                    message: allowLocalMock
                        ? '当前访问的是本地环境，允许使用模拟支付。'
                        : '暂时无法确认当前环境是否允许模拟支付。'
                }
            };
        },

        normalizePaymentRuntimeConfig(raw) {
            const defaults = this.getDefaultPaymentRuntimeConfig();
            const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
            const mockSource = source.mock_payment && typeof source.mock_payment === 'object' && !Array.isArray(source.mock_payment)
                ? source.mock_payment
                : {};
            const allowed = mockSource.allowed === true || String(mockSource.allowed) === 'true'
                ? true
                : (mockSource.allowed === false || String(mockSource.allowed) === 'false'
                    ? false
                    : defaults.mock_payment.allowed);
            const reason = String(mockSource.reason || defaults.mock_payment.reason).trim() || defaults.mock_payment.reason;
            const message = String(mockSource.message || defaults.mock_payment.message).trim() || defaults.mock_payment.message;

            return {
                mock_payment: {
                    allowed,
                    reason,
                    message
                }
            };
        },

        async loadPaymentRuntimeConfig(forceRefresh = false) {
            if (!forceRefresh && this.paymentRuntimeConfig) {
                return this.paymentRuntimeConfig;
            }

            try {
                const response = await fetch('/api/payments/config', {
                    method: 'GET'
                });
                const payload = await response.json().catch(() => ({}));

                if (!response.ok || payload?.success === false) {
                    throw new Error(payload?.message || '加载支付环境配置失败');
                }

                if (payload?.config) {
                    this.paymentChannelsConfig = this.normalizePaymentChannelsConfig(payload.config);
                }

                if (payload?.recharge_options) {
                    this.rechargeOptionsConfig = this.normalizeRechargeOptionsConfig(payload.recharge_options);
                }

                this.paymentRuntimeConfig = this.normalizePaymentRuntimeConfig(payload?.runtime);
            } catch (runtimeError) {
                console.warn('[WalletModal] Failed to load payment runtime config:', runtimeError);
                await this.recoverPaymentConfigsFromSystemConfig();
                this.paymentRuntimeConfig = this.getDefaultPaymentRuntimeConfig();
            }

            return this.paymentRuntimeConfig;
        },

        async loadSystemConfigValue(configKey) {
            const normalizedKey = String(configKey || '').trim();
            if (!normalizedKey || !window.supabaseClient?.rpc) {
                return null;
            }

            const { data, error } = await window.supabaseClient.rpc('get_system_config', {
                p_key: normalizedKey
            });

            if (error) throw error;
            return data || null;
        },

        async recoverPaymentConfigsFromSystemConfig() {
            const [paymentChannelsResult, rechargeOptionsResult] = await Promise.allSettled([
                this.loadSystemConfigValue('payment_channels'),
                this.loadSystemConfigValue('recharge_options')
            ]);

            if (paymentChannelsResult.status === 'fulfilled' && paymentChannelsResult.value) {
                this.paymentChannelsConfig = this.normalizePaymentChannelsConfig(paymentChannelsResult.value);
            } else if (paymentChannelsResult.status === 'rejected') {
                console.warn('[WalletModal] Failed to recover payment channels config:', paymentChannelsResult.reason);
            }

            if (rechargeOptionsResult.status === 'fulfilled' && rechargeOptionsResult.value) {
                this.rechargeOptionsConfig = this.normalizeRechargeOptionsConfig(rechargeOptionsResult.value);
            } else if (rechargeOptionsResult.status === 'rejected') {
                console.warn('[WalletModal] Failed to recover recharge options config:', rechargeOptionsResult.reason);
            }
        },

        getMockPaymentAvailability({
            rechargeOptions = this.rechargeOptionsConfig,
            paymentChannels = this.paymentChannelsConfig,
            paymentRuntime = this.paymentRuntimeConfig
        } = {}) {
            const normalizedRechargeOptions = this.normalizeRechargeOptionsConfig(rechargeOptions);
            const normalizedPaymentChannels = this.normalizePaymentChannelsConfig(paymentChannels);
            const normalizedRuntime = this.normalizePaymentRuntimeConfig(paymentRuntime);
            const activeProvider = this.getActivePaymentProviderConfig(normalizedPaymentChannels);
            const activeProviderRequested = activeProvider.key === 'mock';
            const configured = activeProviderRequested || normalizedRechargeOptions.mock_payment_enabled === true;

            return {
                activeProviderRequested,
                configured,
                allowed: configured && normalizedRuntime.mock_payment.allowed === true,
                blocked: configured && normalizedRuntime.mock_payment.allowed !== true,
                message: normalizedRuntime.mock_payment.message || this.tr('wallet.mockPaymentDisabled', '当前环境已禁用模拟支付，请切换到真实支付通道。'),
                reason: normalizedRuntime.mock_payment.reason || 'unknown'
            };
        },

        getActivePaymentProviderConfig(config = this.paymentChannelsConfig) {
            const normalizedConfig = this.normalizePaymentChannelsConfig(config);
            const activeKey = normalizedConfig.active_provider || 'afdian';
            return {
                key: activeKey,
                ...normalizedConfig.providers[activeKey]
            };
        },

        getPaymentCheckoutUrl(providerKey, config = this.paymentChannelsConfig) {
            const normalizedConfig = this.normalizePaymentChannelsConfig(config);
            const provider = normalizedConfig.providers[providerKey] || {};
            if (providerKey === 'afdian') {
                return provider.checkout_url || window.PAYMENT_AFDIAN_URL || 'https://afdian.com/a/zaoyoe';
            }
            return provider.checkout_url || '';
        },

        renderPaymentOrderQuerySection(config = this.paymentChannelsConfig) {
            const normalizedConfig = this.normalizePaymentChannelsConfig(config);
            const activeProvider = this.getActivePaymentProviderConfig(normalizedConfig);
            const section = document.getElementById('wallet-order-query-section');
            const title = document.getElementById('wallet-order-query-title');
            const hint = document.getElementById('wallet-order-query-hint');
            const input = document.getElementById('afdian-order-input');

            if (!section) return;

            const customRechargeVisible = !document.getElementById('wallet-custom-recharge-section')?.hidden;
            const queryEnabled = activeProvider?.key === 'afdian'
                && activeProvider?.order_query_enabled === true
                && !customRechargeVisible;
            section.toggleAttribute('hidden', !queryEnabled);

            if (!queryEnabled) {
                requestWalletRechargeScrollCueUpdate();
                return;
            }

            if (title) title.textContent = activeProvider.order_query_title || `${activeProvider.display_name || '支付平台'}订单查询`;
            if (hint) hint.textContent = activeProvider.order_query_hint || activeProvider.package_hint || '完成支付后，可在这里输入订单号查询结果。';
            if (input) input.placeholder = activeProvider.order_query_placeholder || `${activeProvider.display_name || '支付平台'}订单号`;

            requestWalletRechargeScrollCueUpdate();
        },

        renderCustomRechargeSection(
            config = this.rechargeOptionsConfig,
            paymentChannels = this.paymentChannelsConfig,
            paymentRuntime = this.paymentRuntimeConfig
        ) {
            const section = document.getElementById('wallet-custom-recharge-section');
            const input = document.getElementById('wallet-custom-recharge-input');
            const button = document.getElementById('wallet-custom-recharge-btn');
            const subtitle = document.getElementById('wallet-custom-recharge-subtitle');
            const badge = document.getElementById('wallet-custom-recharge-badge');
            const meta = document.getElementById('wallet-custom-recharge-meta');
            if (!section) return;

            const normalizedConfig = this.normalizeRechargeOptionsConfig(config);
            const normalizedPaymentChannels = this.normalizePaymentChannelsConfig(paymentChannels);
            const activeProvider = this.getActivePaymentProviderConfig(normalizedPaymentChannels);
            const isFeatureEnabled = normalizedConfig.custom_amount_enabled === true;
            const mockPayment = this.getMockPaymentAvailability({
                rechargeOptions: normalizedConfig,
                paymentChannels: normalizedPaymentChannels,
                paymentRuntime
            });
            const isSimulationEnabled = mockPayment.activeProviderRequested && mockPayment.allowed;
            const isSimulationBlocked = activeProvider.key === 'mock' && mockPayment.blocked;
            const pointsPerCny = Math.max(0.01, Number(normalizedConfig.custom_amount_points_per_cny) || 1);
            const inputPlaceholder = Math.abs(pointsPerCny - 1) < 0.0001
                ? this.tr('wallet.customRechargeAmountPlaceholder', '请输入充值金额')
                : this.tr('wallet.customRechargePointsPlaceholder', '请输入充值积分');

            section.toggleAttribute('hidden', !isFeatureEnabled);

            if (input) {
                input.disabled = !isFeatureEnabled || isSimulationBlocked;
                input.min = '0.01';
                input.step = '0.01';
                input.inputMode = 'decimal';
                input.placeholder = inputPlaceholder;
                if (!isFeatureEnabled) input.value = '';
            }

            if (button) {
                button.disabled = !isFeatureEnabled || isSimulationBlocked;
                button.textContent = isSimulationBlocked
                    ? this.tr('wallet.unavailableNow', '当前环境不可用')
                    : this.tr('wallet.rechargeNow', '充值');
            }

            if (subtitle) {
                subtitle.textContent = '';
                subtitle.hidden = true;
            }

            if (badge) {
                if (isSimulationBlocked) {
                    badge.hidden = false;
                    badge.textContent = this.tr('wallet.mockPaymentRestricted', '模拟支付受限');
                } else if (isSimulationEnabled) {
                    badge.hidden = false;
                    badge.textContent = this.tr('wallet.mockPayment', '模拟支付');
                } else {
                    badge.textContent = '';
                    badge.hidden = true;
                }
            }

            if (meta) {
                meta.textContent = '';
                meta.hidden = true;
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
                        name: this.tr('wallet.posterTemplateMidnightName', '星幕邀请函'),
                        description: this.tr('wallet.posterTemplateMidnightDesc', '深色高级感，适合作为默认分享海报。'),
                        custom_background_url: ''
                    },
                    {
                        id: 'sunset',
                        name: this.tr('wallet.posterTemplateSunsetName', '暖金品牌卡'),
                        description: this.tr('wallet.posterTemplateSunsetDesc', '暖色氛围更强，适合活动档期与节庆传播。'),
                        custom_background_url: ''
                    },
                    {
                        id: 'crystal',
                        name: this.tr('wallet.posterTemplateCrystalName', '清透极简版'),
                        description: this.tr('wallet.posterTemplateCrystalDesc', '浅色留白更多，适合搭配自定义品牌底图。'),
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
                    safeRegistrationRewardPoints > 0
                        ? this.tr('wallet.signupReward', '拉新奖励 {value}', { value: this.formatPointsWithUnit(safeRegistrationRewardPoints) })
                        : '',
                    this.tr('wallet.shopCommissionRate', '商城返佣：{rate}', { rate: this.formatAffiliatePercent(safeCommissionRateShop) })
                ].filter(Boolean).join(' · ');
            }

            return customTemplate
                .replace(/\{registration_reward_text\}/g, safeRegistrationRewardPoints > 0 ? this.formatPointsWithUnit(safeRegistrationRewardPoints) : this.tr('wallet.notEnabled', '未开启'))
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
                : this.tr('wallet.rewardRulesDefault', '奖励按平台风控规则自动结算，异常账号、作弊注册与退款订单不计入奖励。');
            const legalDisclaimer = typeof stats.legal_disclaimer === 'string' && stats.legal_disclaimer.trim()
                ? stats.legal_disclaimer.trim()
                : this.tr('wallet.legalDisclaimerDefault', '活动最终解释权归平台所有');

            const lines = [
                this.tr('wallet.fixedSignupReward', '固定拉新奖励：{value}', {
                    value: safeRegistrationReward > 0 ? this.formatPointsWithUnit(safeRegistrationReward) : this.tr('wallet.notEnabled', '当前未开启')
                }),
                this.tr('wallet.triggerCondition', '触发条件：好友{condition}', {
                    condition: requiresPurchase
                        ? this.tr('wallet.triggerFirstPayment', '完成首笔充值或消费后激活')
                        : this.tr('wallet.triggerRegister', '完成注册后立即发放')
                }),
                this.tr('wallet.shopCommissionRate', '商城消费返佣：{rate}', { rate: this.formatAffiliatePercent(safeCommissionRateShop) }),
                this.tr('wallet.agentCommissionRate', '分销资源返佣：{rate}', { rate: this.formatAffiliatePercent(safeCommissionRateAgent) }),
                rewardNotice,
                legalDisclaimer
            ];

            return lines.join('\n');
        },

        getAffiliateStageMeta(member = {}) {
            const stageStep = Math.max(1, Number(member.stage_step) || 1);
            const grantedReward = this.normalizePointValue(member.registration_reward_granted);
            const pendingReward = this.normalizePointValue(member.registration_reward_pending);

            if (stageStep >= 3) {
                return {
                    label: this.tr('wallet.stageConsumedLabel', '已消费'),
                    hint: this.tr('wallet.stageConsumedHint', '已完成首笔消费，持续返佣已开始'),
                    tone: 'success',
                    rewardText: grantedReward > 0
                        ? this.tr('wallet.signupRewardPlus', '拉新奖励 +{points} {unit}', { points: this.formatPoints(grantedReward), unit: this.tr('wallet.pointsUnit', '积分') })
                        : this.tr('wallet.stageConsumedReward', '已进入持续返佣阶段')
                };
            }

            if (stageStep >= 2) {
                return {
                    label: this.tr('wallet.stageRechargedLabel', '已首充'),
                    hint: this.tr('wallet.stageRechargedHint', '已完成首充，等待首笔消费继续贡献返佣'),
                    tone: 'active',
                    rewardText: grantedReward > 0
                        ? this.tr('wallet.signupRewardPlus', '拉新奖励 +{points} {unit}', { points: this.formatPoints(grantedReward), unit: this.tr('wallet.pointsUnit', '积分') })
                        : (pendingReward > 0
                            ? this.tr('wallet.rewardPending', '奖励待处理 {points} {unit}', { points: this.formatPoints(pendingReward), unit: this.tr('wallet.pointsUnit', '积分') })
                            : this.tr('wallet.stageActivatedReward', '已进入激活阶段'))
                };
            }

            return {
                label: this.tr('wallet.stageRegisteredLabel', '已注册'),
                hint: pendingReward > 0
                    ? this.tr('wallet.pendingActivationReward', '等待首充激活 {points} {unit}', { points: this.formatPoints(pendingReward), unit: this.tr('wallet.pointsUnit', '积分') })
                    : this.tr('wallet.stageRegisteredHint', '等待后续首充或消费'),
                tone: 'pending',
                rewardText: pendingReward > 0
                    ? this.tr('wallet.rewardPending', '待激活 {points} {unit}', { points: this.formatPoints(pendingReward), unit: this.tr('wallet.pointsUnit', '积分') })
                    : this.tr('wallet.noSignupReward', '当前无额外拉新奖励')
            };
        },

        renderAffiliateMembers(stats = this.affiliateStats || {}) {
            const container = document.getElementById('affiliate-members');
            const summaryEl = document.getElementById('affiliate-stage-summary');
            if (!container) return;

            const members = Array.isArray(stats.members) ? stats.members : [];
            const invitedCount = Number(stats.invited_count) || 0;
            const rechargeCount = Number(stats.first_recharge_count) || 0;
            const consumedCount = Number(stats.consumed_count) || 0;

            if (summaryEl) {
                summaryEl.innerHTML = `
                    <span class="affiliate-stage-pill">${this.tr('wallet.registered', '注册 {count}', { count: invitedCount })}</span>
                    <span class="affiliate-stage-pill">${this.tr('wallet.firstRecharge', '首充 {count}', { count: rechargeCount })}</span>
                    <span class="affiliate-stage-pill">${this.tr('wallet.purchased', '消费 {count}', { count: consumedCount })}</span>
                `;
            }

            if (members.length === 0) {
                container.innerHTML = `
                    <div class="affiliate-empty-state">
                        <div class="affiliate-empty-icon"><i class="fas fa-users"></i></div>
                        <div class="affiliate-empty-title">${this.tr('wallet.noInvitesTitle', '还没有邀请记录')}</div>
                        <div class="affiliate-empty-copy">${this.tr('wallet.noInvitesCopy', '分享上面的专属链接后，这里会按“注册 → 首充 → 消费”的旅程自动更新。')}</div>
                    </div>
                `;
                return;
            }

            const pointsUnit = window.i18n?.t('wallet.pointsUnit') || '积分';
            const notCompletedText = this.tr('wallet.notCompleted', '未完成');
            const notEnabledText = this.tr('wallet.notEnabled', '未开启');
            const newInviteeText = this.tr('wallet.newInvitee', '新邀请用户');

            container.innerHTML = members.map((member, index) => {
                const memberId = String(member.user_id || member.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const memberDomId = String(memberId || `member-${index}`).replace(/[^A-Za-z0-9_-]/g, '-') || `member-${index}`;
                const detailsId = `affiliate-member-details-${memberDomId}`;
                const displayName = String(member.display_name || member.username || member.masked_email || this.tr('wallet.inviteUser', '新用户')).trim();
                const maskedEmail = String(member.masked_email || '').trim();
                const registeredAt = this.formatOrderDateTime(member.registered_at);
                const firstRechargeAt = member.first_recharge_at ? this.formatOrderDateTime(member.first_recharge_at) : notCompletedText;
                const firstPurchaseAt = member.first_purchase_at ? this.formatOrderDateTime(member.first_purchase_at) : notCompletedText;
                const stageMeta = this.getAffiliateStageMeta(member);
                const totalSpend = this.formatPoints(member.total_spend || 0);
                const commissionEarned = this.formatPoints(member.commission_earned || 0);
                const registrationRewardGranted = this.normalizePointValue(member.registration_reward_granted || 0);
                const pendingReward = this.normalizePointValue(member.registration_reward_pending || 0);
                const rewardText = registrationRewardGranted > 0
                    ? `${this.formatPoints(registrationRewardGranted)} ${pointsUnit}`
                    : (pendingReward > 0
                        ? this.tr('wallet.rewardPending', '待激活 {points} {unit}', { points: this.formatPoints(pendingReward), unit: pointsUnit })
                        : notEnabledText);
                const lastOrderName = String(member.last_order_name || '').trim();
                const lastOrderAmount = Number(member.last_order_amount);
                const latestLabel = lastOrderName
                    ? `${this.escapeHtml(lastOrderName)}${Number.isFinite(lastOrderAmount) ? ` · ${this.formatPoints(lastOrderAmount)} ${pointsUnit}` : ''}`
                    : this.tr('wallet.registeredAt', '注册于 {date}', { date: this.escapeHtml(registeredAt) });
                const badgeClass = `affiliate-member-badge affiliate-member-badge-${stageMeta.tone}`;
                const avatarLabel = this.escapeHtml(displayName.charAt(0).toUpperCase() || 'U');
                const secondaryLine = [maskedEmail, this.tr('wallet.registeredAt', '注册于 {date}', { date: registeredAt })].filter(Boolean).join(' · ');
                const quickContribution = `${totalSpend} ${pointsUnit}`;
                const quickCommission = `${commissionEarned} ${pointsUnit}`;
                const quickReward = registrationRewardGranted > 0
                    ? `${this.formatPoints(registrationRewardGranted)} ${pointsUnit}`
                    : (pendingReward > 0
                        ? this.tr('wallet.rewardPending', '待激活 {points} {unit}', { points: this.formatPoints(pendingReward), unit: pointsUnit })
                        : notEnabledText);

                return `
                    <article class="affiliate-member-card" data-member-id="${this.escapeHtml(memberId)}">
                        <div class="affiliate-member-summary">
                            <div class="affiliate-member-summary-main">
                                <div class="affiliate-member-head">
                                    <div class="affiliate-member-avatar">
                                        ${member.avatar_url
                                            ? `<img src="${this.escapeHtml(member.avatar_url)}" alt="${this.escapeHtml(displayName)}" />`
                                            : `<span>${avatarLabel}</span>`}
                                    </div>
                                    <div class="affiliate-member-ident">
                                        <div class="affiliate-member-name-row">
                                            <div class="affiliate-member-name">${this.escapeHtml(displayName)}</div>
                                        </div>
                                        <div class="affiliate-member-sub">${this.escapeHtml(secondaryLine || newInviteeText)}</div>
                                        <div class="affiliate-member-note">${this.escapeHtml(stageMeta.hint)}</div>
                                    </div>
                                </div>
                                <div class="affiliate-member-quick-metrics">
                                    <span class="affiliate-member-chip">${this.tr('wallet.contribution', '贡献 {value}', { value: quickContribution })}</span>
                                    <span class="affiliate-member-chip">${this.tr('wallet.commission', '返佣 {value}', { value: quickCommission })}</span>
                                    <span class="affiliate-member-chip">${this.tr('wallet.signupReward', '拉新 {value}', { value: this.escapeHtml(quickReward) })}</span>
                                </div>
                            </div>
                            <div class="affiliate-member-summary-side">
                                <span class="${badgeClass}">${stageMeta.label}</span>
                                <button class="affiliate-member-chevron affiliate-member-toggle" type="button" aria-expanded="false" aria-controls="${this.escapeAttribute(detailsId)}" aria-label="${this.tr('wallet.expandJourney', '展开 {name} 的邀请旅程', { name: this.escapeAttribute(displayName) })}"${this.buildDataAttributes({ 'wallet-action': 'toggle-affiliate-member-details' })}>
                                    <i class="fas fa-chevron-down"></i>
                                </button>
                            </div>
                        </div>

                        <div class="affiliate-member-details" id="${this.escapeAttribute(detailsId)}" hidden>
                            <div class="affiliate-stage-track">
                                <div class="affiliate-stage-node affiliate-stage-node-done">
                                    <span class="affiliate-stage-dot"></span>
                                    <div class="affiliate-stage-copy">
                                        <strong>${this.tr('wallet.registeredStage', '注册')}</strong>
                                        <span>${this.escapeHtml(registeredAt)}</span>
                                    </div>
                                </div>
                                <div class="affiliate-stage-node ${member.first_recharge_at ? 'affiliate-stage-node-done' : 'affiliate-stage-node-todo'}">
                                    <span class="affiliate-stage-dot"></span>
                                    <div class="affiliate-stage-copy">
                                        <strong>${this.tr('wallet.firstRechargeStage', '首充')}</strong>
                                        <span>${this.escapeHtml(firstRechargeAt)}</span>
                                    </div>
                                </div>
                                <div class="affiliate-stage-node ${member.first_purchase_at ? 'affiliate-stage-node-done' : 'affiliate-stage-node-todo'}">
                                    <span class="affiliate-stage-dot"></span>
                                    <div class="affiliate-stage-copy">
                                        <strong>${this.tr('wallet.purchaseStage', '消费')}</strong>
                                        <span>${this.escapeHtml(firstPurchaseAt)}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="affiliate-member-metrics">
                                <div class="affiliate-member-metric">
                                    <span>${this.tr('wallet.totalContribution', '累计贡献')}</span>
                                    <strong>${totalSpend} ${pointsUnit}</strong>
                                </div>
                                <div class="affiliate-member-metric">
                                    <span>${this.tr('wallet.commissionContribution', '返佣贡献')}</span>
                                    <strong>${commissionEarned} ${pointsUnit}</strong>
                                </div>
                                <div class="affiliate-member-metric">
                                    <span>${this.tr('wallet.signupReward', '拉新奖励')}</span>
                                    <strong>${this.escapeHtml(rewardText)}</strong>
                                </div>
                                <div class="affiliate-member-metric">
                                    <span>${lastOrderName ? this.tr('wallet.latestOrder', '最近订单') : this.tr('wallet.latestActivity', '最近动态')}</span>
                                    <strong>${latestLabel}</strong>
                                </div>
                            </div>
                        </div>
                    </article>
                `;
            }).join('');
        },

        toggleAffiliateMemberDetails(event) {
            const trigger = event?.currentTarget || event?.target;
            const card = trigger?.closest?.('.affiliate-member-card');
            const list = card?.closest?.('.affiliate-member-list');
            if (!card || !list) return;

            const details = card.querySelector('.affiliate-member-details');
            const button = card.querySelector('.affiliate-member-toggle');
            const shouldExpand = !card.classList.contains('expanded');

            list.querySelectorAll('.affiliate-member-card.expanded').forEach((openCard) => {
                openCard.classList.remove('expanded');
                openCard.querySelector('.affiliate-member-details')?.setAttribute('hidden', 'hidden');
                const openButton = openCard.querySelector('.affiliate-member-toggle');
                openButton?.setAttribute('aria-expanded', 'false');
                const openName = openCard.querySelector('.affiliate-member-name')?.textContent?.trim() || '';
                if (openButton && openName) {
                    openButton.setAttribute('aria-label', this.tr('wallet.expandJourney', '展开 {name} 的邀请旅程', { name: openName }));
                }
            });

            if (shouldExpand) {
                card.classList.add('expanded');
                details?.removeAttribute('hidden');
                button?.setAttribute('aria-expanded', 'true');
                const displayName = card.querySelector('.affiliate-member-name')?.textContent?.trim() || '';
                if (button && displayName) {
                    button.setAttribute('aria-label', this.tr('wallet.collapseJourney', '收起 {name} 的邀请旅程', { name: displayName }));
                }
                return;
            }

            card.classList.remove('expanded');
            details?.setAttribute('hidden', 'hidden');
            button?.setAttribute('aria-expanded', 'false');
            const displayName = card.querySelector('.affiliate-member-name')?.textContent?.trim() || '';
            if (button && displayName) {
                button.setAttribute('aria-label', this.tr('wallet.expandJourney', '展开 {name} 的邀请旅程', { name: displayName }));
            }
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
            const rawLegalDisclaimer = typeof stats.legal_disclaimer === 'string' && stats.legal_disclaimer.trim()
                ? stats.legal_disclaimer.trim()
                : '';
            const legalDisclaimer = rawLegalDisclaimer && (!this.isEnglishLanguage() || !this.containsCjkText(rawLegalDisclaimer))
                ? rawLegalDisclaimer
                : this.tr('wallet.legalDisclaimerDefault', '活动最终解释权归平台所有');
            const rewardTriggerText = requiresPurchase
                ? this.tr('wallet.triggerFirstPayment', '完成首笔充值或消费')
                : this.tr('wallet.triggerRegister', '完成注册');
            const guideText = this.getAffiliateRewardExplanation(stats);
            const rewardPointsText = this.formatPoints(safeRegistrationReward);

            if (rewardGuideEl) {
                rewardGuideEl.setAttribute('data-tooltip', guideText);
                rewardGuideEl.setAttribute('aria-label', guideText);
                rewardGuideEl.removeAttribute('title');
            }

            if (safeRegistrationReward > 0) {
                descEl.innerHTML = `${this.tr('wallet.inviteDescWithReward', '分享专属链接邀请新用户。当好友注册并<strong>{trigger}</strong>后，您将获得 <strong class="wallet-affiliate-highlight wallet-affiliate-highlight--reward">{points} {unit}</strong> 专属拉新奖励；此外，好友后续所有商城订单还会持续按 <strong class="wallet-affiliate-highlight wallet-affiliate-highlight--commission">{rate}</strong> 自动返佣。', {
                    trigger: this.escapeHtml(rewardTriggerText),
                    points: this.escapeHtml(rewardPointsText),
                    unit: this.escapeHtml(this.tr('wallet.pointsUnit', '积分')),
                    rate: this.escapeHtml(ratePercent)
                })}<span class="affiliate-legal-note">${this.escapeHtml(legalDisclaimer)}</span>`;
                return;
            }

            descEl.innerHTML = `${this.tr('wallet.inviteDescCommissionOnly', '分享下方链接给好友。当好友注册并在商城完成消费时，系统会自动将订单金额的 <strong class="wallet-affiliate-highlight wallet-affiliate-highlight--commission">{rate}</strong> 作为奖励发放至您的积分钱包。', {
                rate: this.escapeHtml(ratePercent)
            })}<span class="affiliate-legal-note">${this.escapeHtml(legalDisclaimer)}</span>`;
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
                    const rewardBreakdownEl = document.getElementById('affiliate-reward-breakdown');
                    const countEl = document.getElementById('affiliate-count');
                    const countMetaEl = document.getElementById('affiliate-count-meta');
                    const rechargeCountEl = document.getElementById('affiliate-recharge-count');
                    const rechargeMetaEl = document.getElementById('affiliate-recharge-meta');
                    const spendTotalEl = document.getElementById('affiliate-spend-total');
                    const spendMetaEl = document.getElementById('affiliate-spend-meta');
                    const linkEl = document.getElementById('affiliate-link');
                    const totalRewards = Number(stats.total_rewards ?? stats.total_commission);
                    const totalOrderCommission = Number(stats.total_order_commission);
                    const totalRegistrationRewards = Number(stats.total_registration_rewards);
                    const invitedCount = Number(stats.invited_count);
                    const rechargeCount = Number(stats.first_recharge_count);
                    const consumedCount = Number(stats.consumed_count);
                    const pendingRewardCount = Number(stats.pending_reward_count);
                    const totalInviteeSpend = Number(stats.total_invitee_spend);
                    const inviteCode = typeof stats.invite_code === 'string' ? stats.invite_code.trim() : '';
                    const posterConfig = this.normalizeAffiliatePosterConfig(posterResult.data);

                    if (commissionEl) {
                        commissionEl.textContent = Number.isFinite(totalRewards)
                            ? this.formatPoints(totalRewards)
                            : '0';
                    }

                    if (rewardBreakdownEl) {
                        rewardBreakdownEl.textContent = this.tr('wallet.rewardBreakdown', '返佣 {commission} · 拉新 {registration}', {
                            commission: this.formatPoints(Number.isFinite(totalOrderCommission) ? totalOrderCommission : 0),
                            registration: this.formatPoints(Number.isFinite(totalRegistrationRewards) ? totalRegistrationRewards : 0)
                        });
                    }

                    if (countEl) {
                        countEl.textContent = String(Number.isFinite(invitedCount) ? invitedCount : 0);
                    }

                    if (countMetaEl) {
                        countMetaEl.textContent = this.tr('wallet.consumedPeople', '已消费 {count} 人', {
                            count: Number.isFinite(consumedCount) ? consumedCount : 0
                        });
                    }

                    if (rechargeCountEl) {
                        rechargeCountEl.textContent = String(Number.isFinite(rechargeCount) ? rechargeCount : 0);
                    }

                    if (rechargeMetaEl) {
                        rechargeMetaEl.textContent = this.tr('wallet.pendingPeople', '待激活 {count} 人', {
                            count: Number.isFinite(pendingRewardCount) ? pendingRewardCount : 0
                        });
                    }

                    if (spendTotalEl) {
                        spendTotalEl.textContent = Number.isFinite(totalInviteeSpend)
                            ? this.formatPoints(totalInviteeSpend)
                            : '0';
                    }

                    if (spendMetaEl) {
                        spendMetaEl.textContent = this.tr('wallet.ongoingCommission', '持续返佣 {amount} {unit}', {
                            amount: this.formatPoints(Number.isFinite(totalOrderCommission) ? totalOrderCommission : 0),
                            unit: this.tr('wallet.pointsUnit', '积分')
                        });
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
                    this.renderAffiliateMembers(stats);

                    if (linkEl && inviteCode) {
                        const baseUrl = window.location.origin + window.location.pathname;
                        linkEl.value = `${baseUrl}?ref=${inviteCode}`;
                    }

                    this.currentInviteCode = inviteCode;
                }
                this.affiliateLoaded = true;
            } catch (err) {
                console.error('[WalletModal] Load Affiliate Error:', err);
                const descEl = document.getElementById('affiliate-desc-text');
                const membersEl = document.getElementById('affiliate-members');
                if (descEl) {
                    descEl.textContent = this.tr('wallet.affiliateInfoLoadFailed', '推广信息加载失败，请稍后重试。');
                }
                if (membersEl) {
                    membersEl.innerHTML = `<div class="empty-text">${this.tr('wallet.affiliateJourneyLoadFailed', '推广旅程加载失败')}</div>`;
                }
            }
        },

        copyAffiliateLink() {
            const linkEl = document.getElementById('affiliate-link');
            if (!linkEl || !linkEl.value) return;
            const sourceMeta = buildWalletSourceMetadata(this.lastOpenContext);
            const analyticsMetadata = {
                ...sourceMeta,
                channel: 'copy_link',
                invite_code: String(this.currentInviteCode || '').trim() || null,
                invite_link: linkEl.value || null
            };

            navigator.clipboard.writeText(linkEl.value).then(() => {
                trackWalletAnalyticsEvent('affiliate_invite_click', {
                    entityType: 'affiliate_invite',
                    entityId: analyticsMetadata.invite_code,
                    metadata: analyticsMetadata
                }, {
                    eventType: 'engagement'
                });
                this.showToast(window.i18n?.t('wallet.copiedLink') || '链接已复制到剪贴板，快去分享吧！', 'success');
            }).catch(err => {
                console.error('Copy failed', err);
                linkEl.select();
                const copied = document.execCommand('copy');
                if (copied) {
                    trackWalletAnalyticsEvent('affiliate_invite_click', {
                        entityType: 'affiliate_invite',
                        entityId: analyticsMetadata.invite_code,
                        metadata: analyticsMetadata
                    }, {
                        eventType: 'engagement'
                    });
                }
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
                trackWalletAnalyticsEvent('affiliate_invite_click', {
                    entityType: 'affiliate_invite',
                    entityId: String(this.currentInviteCode || '').trim() || null,
                    metadata: {
                        ...buildWalletSourceMetadata(this.lastOpenContext),
                        channel: 'poster_download',
                        invite_code: String(this.currentInviteCode || '').trim() || null,
                        invite_link: linkEl.value || null,
                        poster_template: activeTemplate?.id || null
                    }
                }, {
                    eventType: 'engagement'
                });
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

                // Start all requests in parallel, but render the balance as soon as it is ready.
                const paymentRuntimePromise = this.loadPaymentRuntimeConfig();
                const balancePromise = PointsService.getBalance({
                    site: window.SiteConfig?.site || 'cn'
                });
                const auxiliaryWalletDataPromise = Promise.allSettled([
                    PointsService.getPackages(),
                    PointsService.getHistory(20, {
                        site: window.SiteConfig?.site || 'cn'
                    }),
                    paymentRuntimePromise
                ]);
                const hadCachedBalance = this.getCurrentWalletTotalBalance() !== null
                    || this.restoreWalletBalanceFromCache({ animate: false });
                const balance = await balancePromise;

                this.applyWalletBalance(balance, {
                    animate: !hadCachedBalance
                });

                // Notify other widgets (e.g. verify-widget) that balance changed
                window.dispatchEvent(new CustomEvent('walletBalanceUpdated', {
                    detail: { totalBalance: balance.total_balance }
                }));

                const [packagesResult, historyResult, paymentRuntimeResult] = await auxiliaryWalletDataPromise;
                const packages = packagesResult.status === 'fulfilled' ? packagesResult.value : [];
                const history = historyResult.status === 'fulfilled' ? historyResult.value : [];
                if (packagesResult.status === 'rejected') {
                    console.warn('[WalletModal] Packages load failed:', packagesResult.reason);
                }
                if (historyResult.status === 'rejected') {
                    console.warn('[WalletModal] History load failed:', historyResult.reason);
                }
                if (paymentRuntimeResult.status === 'rejected') {
                    console.warn('[WalletModal] Payment runtime load failed:', paymentRuntimeResult.reason);
                }
                const latestRechargeOptions = this.normalizeRechargeOptionsConfig(this.rechargeOptionsConfig);
                const latestPaymentChannels = this.normalizePaymentChannelsConfig(this.paymentChannelsConfig);
                const latestPaymentRuntime = this.normalizePaymentRuntimeConfig(this.paymentRuntimeConfig);

                console.log('[WalletModal] ✅ Data loaded:', { balance, packagesLength: packages.length });

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
                            <button type="button" class="package-item"${this.buildDataAttributes({
                                'wallet-action': 'buy-package',
                                'wallet-package-id': this.encodeActionValue(pkg.id),
                                'wallet-package-name': this.encodeActionValue(pkg.name)
                            })}>
                                <div class="pkg-name">${displayName}</div>
                                <div class="pkg-points">${this.formatPoints(pkg.points_amount)} ${pointsUnit}${pkg.bonus_points > 0 ? ` <span class="pkg-bonus">+${this.formatPoints(pkg.bonus_points)}</span>` : ''}</div>
                                <div class="pkg-price" data-wallet-package-price>¥${pkg.price_cny}</div>
                            </button>
                        `}).join('');
                    }
                    requestWalletRechargeScrollCueUpdate();
                }

                this.renderCustomRechargeSection(latestRechargeOptions, latestPaymentChannels, latestPaymentRuntime);
                this.renderPaymentOrderQuerySection(latestPaymentChannels);

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
                this.showToast(this.tr('wallet.dataLoadFailed', '数据加载失败'), 'error');
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
            this._prefetchedPromptTitles = null;
            this.ordersLoaded = false;
            this.browseOrdersSnapshot = [];
        },

        /**
         * Handle package purchase
         */
        async buyPackage(packageId, packageName) {
            if (this.pendingRechargeAction) {
                return;
            }

            const overlay = document.getElementById('wallet-modal-overlay');
            const rechargeOptions = this.normalizeRechargeOptionsConfig(this.rechargeOptionsConfig);
            const paymentChannels = this.normalizePaymentChannelsConfig(this.paymentChannelsConfig);
            const activeProvider = this.getActivePaymentProviderConfig(paymentChannels);
            const mockPayment = this.getMockPaymentAvailability({
                rechargeOptions,
                paymentChannels,
                paymentRuntime: this.paymentRuntimeConfig
            });
            const providerKey = mockPayment.activeProviderRequested && mockPayment.allowed
                ? 'mock'
                : activeProvider.key;
            const packageData = Array.isArray(this._packagesCache)
                ? this._packagesCache.find(pkg => String(pkg.id) === String(packageId))
                : null;
            const displayName = packageData?.name || packageName || this.tr('wallet.rechargePackage', '充值套餐');
            const isMockFlow = providerKey === 'mock';
            const openContext = this.lastOpenContext && typeof this.lastOpenContext === 'object'
                ? this.lastOpenContext
                : {};

            try {
                if (providerKey === 'mock' && !mockPayment.allowed) {
                    throw new Error(mockPayment.message || this.tr('wallet.mockPaymentDisabled', '当前环境已禁用模拟支付，请切换到真实支付通道。'));
                }

                trackWalletAnalyticsEvent('recharge_click', {
                    entityType: 'recharge_package',
                    entityId: String(packageId || '').trim() || null,
                    metadata: {
                        entry: openContext.entry || 'wallet_recharge',
                        initial_view: openContext.initial_view || 'recharge',
                        source_module: openContext.source_module || null,
                        channel: providerKey,
                        package_id: String(packageId || '').trim() || null,
                        package_name: displayName
                    }
                });

                this.setRechargeActionPendingState({
                    kind: 'package',
                    packageId,
                    controlLabel: isMockFlow
                        ? this.tr('wallet.mockPaymentProcessing', '模拟支付中')
                        : this.tr('wallet.processingShort', '处理中'),
                    message: isMockFlow
                        ? this.tr('wallet.processingMockPayment', '正在处理 {name} 的模拟支付...', { name: `「${displayName}」` })
                        : this.tr('wallet.creatingPaymentRequest', '正在为 {name} 创建支付请求...', { name: `「${displayName}」` })
                });

                const paymentResult = await PointsService.createPaymentRequest({
                    provider_key: providerKey,
                    package_id: packageId,
                    package_name: packageData?.name || packageName || ''
                });

                if (paymentResult.mode === 'completed') {
                    trackWalletAnalyticsEvent('recharge_success', {
                        entityType: 'recharge',
                        entityId: String(paymentResult.checkout_session_id || packageId || '').trim() || null,
                        eventValue: Number(paymentResult.paid_amount || 0) || null,
                        pointsDelta: Number(paymentResult.points_amount || packageData?.points_amount || 0) || null,
                        metadata: {
                            entry: openContext.entry || 'wallet_recharge',
                            initial_view: openContext.initial_view || 'recharge',
                            source_module: openContext.source_module || null,
                            channel: providerKey,
                            package_id: String(packageId || '').trim() || null,
                            package_name: displayName,
                            paid_amount: Number(paymentResult.paid_amount || 0) || null,
                            points_amount: Number(paymentResult.points_amount || packageData?.points_amount || 0) || null,
                            mode: paymentResult.mode || 'completed'
                        }
                    }, {
                        dedupeKey: String(paymentResult.checkout_session_id || '').trim()
                            ? `recharge_success:${String(paymentResult.checkout_session_id).trim()}`
                            : ''
                    });
                    this.showToast(
                        paymentResult.message || `✅ ${this.tr('wallet.packageRechargeSuccess', '已为你完成「{name}」', { name: displayName })}`,
                        'success'
                    );

                    this.invalidateOrderRecordsCache();
                    this.loadOrders({
                        searchQuery: this.orderSearchActiveQuery || this.orderSearchQuery,
                        ignorePrefetch: true
                    }).catch(e => console.error('Order reload after mock package purchase failed:', e));

                    this.loadData().catch(e => console.error('Wallet reload after mock package purchase failed:', e));
                    return;
                }

                if (paymentResult.mode === 'redirect') {
                    if (!paymentResult.checkout_url) {
                        throw new Error(this.tr('wallet.paymentLinkMissing', '{provider}支付链接未配置', {
                            provider: paymentResult.display_name || activeProvider.display_name || this.tr('wallet.paymentChannel', '当前支付通道')
                        }));
                    }

                    const qrModalShown = this.tryPresentHostedPaymentQrModal(paymentResult, {
                        title: displayName,
                        onCompleted: async (statusResult = {}) => {
                            this.showToast(
                                statusResult.message || `✅ ${this.tr('wallet.packageRechargeSuccess', '已为你完成「{name}」', { name: displayName })}`,
                                'success'
                            );
                            this.invalidateOrderRecordsCache();
                            this.loadOrders({
                                searchQuery: this.orderSearchActiveQuery || this.orderSearchQuery,
                                ignorePrefetch: true
                            }).catch(e => console.error('Order reload after zpay package purchase failed:', e));
                        },
                        closeDelayMs: 3000
                    });
                    if (qrModalShown) {
                        this.rememberPendingPaymentClaim(paymentResult);
                        return;
                    }

                    this.rememberPendingPaymentClaim(paymentResult);
                    this.openPaymentCheckoutUrl(paymentResult.checkout_url);
                    this.showToast(
                        paymentResult.message
                            || this.tr('wallet.paymentReady', '{provider}已准备就绪，请完成支付并按页面提示操作。', {
                                provider: paymentResult.display_name || activeProvider.display_name || this.tr('wallet.paymentChannel', '当前支付通道')
                            }),
                        'success'
                    );
                    return;
                }

                throw new Error(paymentResult.message || this.tr('wallet.paymentChannelIncomplete', '当前支付通道暂未完成接入'));

            } catch (err) {
                console.error('[WalletModal] Purchase failed:', err);
                this.showToast(this.resolveFriendlyRechargeErrorMessage(err, this.tr('wallet.rechargeStartFailed', '充值发起失败，请稍后重试。')), 'error');
            } finally {
                if (overlay) overlay.classList.remove('loading');
                this.setRechargeActionPendingState(null);
            }
        },

        async customRecharge() {
            if (this.pendingRechargeAction) {
                return;
            }

            const overlay = document.getElementById('wallet-modal-overlay');
            const input = document.getElementById('wallet-custom-recharge-input');
            const rawValue = input?.value ?? '';
            const rechargeOptions = this.normalizeRechargeOptionsConfig(this.rechargeOptionsConfig);
            const paymentChannels = this.normalizePaymentChannelsConfig(this.paymentChannelsConfig);
            const activeProvider = this.getActivePaymentProviderConfig(paymentChannels);
            const mockPayment = this.getMockPaymentAvailability({
                rechargeOptions,
                paymentChannels,
                paymentRuntime: this.paymentRuntimeConfig
            });
            const providerKey = mockPayment.activeProviderRequested && mockPayment.allowed
                ? 'mock'
                : activeProvider.key;
            const openContext = this.lastOpenContext && typeof this.lastOpenContext === 'object'
                ? this.lastOpenContext
                : {};
            const customRechargeRequest = this.resolveCustomRechargeRequest(rawValue, rechargeOptions);

            if (!customRechargeRequest.ok) {
                this.showToast(customRechargeRequest.errorMessage || this.tr('wallet.invalidRechargeValue', '请输入有效的充值积分或金额'), 'error');
                if (input) input.focus();
                return;
            }

            const normalizedAmount = customRechargeRequest.normalizedPoints;
            const quotedAmountCny = customRechargeRequest.estimatedPaidAmount;
            const inputMode = customRechargeRequest.inputMode || 'points';
            const pendingMessage = providerKey === 'mock'
                ? this.tr('wallet.processingCustomMock', '正在处理 {points} {unit}（约 ¥{amount}）的模拟充值...', {
                    points: this.formatPoints(normalizedAmount),
                    unit: this.tr('wallet.pointsUnit', '积分'),
                    amount: this.formatCny(quotedAmountCny)
                })
                : this.tr('wallet.creatingCustomPayment', '正在为 {points} {unit}（约 ¥{amount}）创建支付请求...', {
                    points: this.formatPoints(normalizedAmount),
                    unit: this.tr('wallet.pointsUnit', '积分'),
                    amount: this.formatCny(quotedAmountCny)
                });

            try {
                if (providerKey === 'mock' && !mockPayment.allowed) {
                    throw new Error(mockPayment.message || this.tr('wallet.mockPaymentDisabled', '当前环境已禁用模拟支付，请切换到真实支付通道。'));
                }

                trackWalletAnalyticsEvent('recharge_click', {
                    entityType: 'custom_recharge',
                    entityId: 'custom_recharge',
                    eventValue: normalizedAmount,
                    metadata: {
                        entry: openContext.entry || 'wallet_recharge',
                        initial_view: openContext.initial_view || 'recharge',
                        source_module: openContext.source_module || null,
                        channel: providerKey,
                        points_amount: normalizedAmount,
                        input_mode: inputMode,
                        entered_amount_cny: customRechargeRequest.enteredAmountCny,
                        quoted_amount_cny: quotedAmountCny
                    }
                });

                this.setRechargeActionPendingState({
                    kind: 'custom',
                    controlLabel: providerKey === 'mock'
                        ? this.tr('wallet.mockPaymentProcessing', '模拟处理中')
                        : this.tr('wallet.processingShort', '处理中'),
                    message: pendingMessage
                });

                const paymentResult = await PointsService.createPaymentRequest({
                    provider_key: providerKey,
                    points_amount: normalizedAmount
                });

                if (paymentResult.mode === 'redirect') {
                    if (!paymentResult.checkout_url) {
                        throw new Error(this.tr('wallet.paymentLinkMissing', '{provider}支付链接未配置', {
                            provider: paymentResult.display_name || activeProvider.display_name || this.tr('wallet.paymentChannel', '当前支付通道')
                        }));
                    }

                    const qrModalShown = this.tryPresentHostedPaymentQrModal(paymentResult, {
                        title: this.tr('wallet.customRecharge', '自定义充值'),
                        onCompleted: async (statusResult = {}) => {
                            if (input) {
                                input.value = '';
                            }
                            this.showToast(
                                statusResult.message
                                    || `✅ ${this.tr('wallet.customRechargeSuccess', '自定义充值成功！ +{points} {unit}（¥{amount}）', {
                                        points: this.formatPoints(statusResult.points_amount || normalizedAmount),
                                        unit: this.tr('wallet.pointsUnit', '积分'),
                                        amount: this.formatCny(statusResult.paid_amount ?? paymentResult.paid_amount ?? quotedAmountCny)
                                    })}`,
                                'success'
                            );
                            this.invalidateOrderRecordsCache();
                            this.loadOrders({
                                searchQuery: this.orderSearchActiveQuery || this.orderSearchQuery,
                                ignorePrefetch: true
                            }).catch(e => console.error('Order reload after zpay custom recharge failed:', e));
                        },
                        closeDelayMs: 3000
                    });
                    if (qrModalShown) {
                        this.rememberPendingPaymentClaim(paymentResult);
                        this.rememberPendingCustomRechargeQuote(paymentResult);
                        return;
                    }

                    this.rememberPendingPaymentClaim(paymentResult);
                    this.rememberPendingCustomRechargeQuote(paymentResult);
                    this.openPaymentCheckoutUrl(paymentResult.checkout_url);

                    this.showToast(
                        paymentResult.message
                            || this.tr('wallet.paymentReadyWithAmount', '{provider}已准备就绪，请按 ¥{amount} 完成支付后再返回查询订单。', {
                                provider: paymentResult.display_name || activeProvider.display_name || this.tr('wallet.paymentChannel', '当前支付通道'),
                                amount: Number(paymentResult.paid_amount || 0).toFixed(2)
                            }),
                        'success'
                    );
                    return;
                }

                if (paymentResult.mode !== 'completed') {
                    throw new Error(paymentResult.message || this.tr('wallet.paymentChannelIncomplete', '当前支付通道暂未完成接入'));
                }

                if (input) {
                    input.value = '';
                }

                trackWalletAnalyticsEvent('recharge_success', {
                    entityType: 'custom_recharge',
                    entityId: String(paymentResult.checkout_session_id || 'custom_recharge').trim(),
                    eventValue: Number(paymentResult.paid_amount || 0) || null,
                    pointsDelta: Number(paymentResult.points_amount || normalizedAmount || 0) || null,
                    metadata: {
                        entry: openContext.entry || 'wallet_recharge',
                        initial_view: openContext.initial_view || 'recharge',
                        source_module: openContext.source_module || null,
                        channel: providerKey,
                        points_amount: Number(paymentResult.points_amount || normalizedAmount || 0) || null,
                        paid_amount: Number(paymentResult.paid_amount || 0) || null,
                        input_mode: inputMode,
                        entered_amount_cny: customRechargeRequest.enteredAmountCny,
                        quoted_amount_cny: quotedAmountCny,
                        mode: paymentResult.mode || 'completed'
                    }
                }, {
                    dedupeKey: String(paymentResult.checkout_session_id || '').trim()
                        ? `recharge_success:${String(paymentResult.checkout_session_id).trim()}`
                        : ''
                });

                this.showToast(
                    paymentResult.message
                        || `✅ ${this.tr('wallet.customRechargeSuccess', '自定义充值成功！ +{points} {unit}（¥{amount}）', {
                            points: this.formatPoints(normalizedAmount),
                            unit: this.tr('wallet.pointsUnit', '积分'),
                            amount: this.formatCny(paymentResult.paid_amount ?? quotedAmountCny)
                        })}`,
                    'success'
                );

                this.invalidateOrderRecordsCache();
                this.loadOrders({
                    searchQuery: this.orderSearchActiveQuery || this.orderSearchQuery,
                    ignorePrefetch: true
                }).catch(e => console.error('Order reload after custom recharge failed:', e));

                this.loadData().catch(e => console.error('Wallet reload after custom recharge failed:', e));
            } catch (err) {
                console.error('[WalletModal] Custom recharge failed:', err);
                this.showToast(this.resolveFriendlyRechargeErrorMessage(err, this.tr('wallet.rechargeStartFailed', '自定义充值发起失败，请稍后重试。')), 'error');
            } finally {
                if (overlay) overlay.classList.remove('loading');
                this.setRechargeActionPendingState(null);
            }
        },

        getPendingCustomRechargeQuoteStorageKey() {
            return 'wallet_pending_custom_recharge_quotes_v1';
        },

        getPendingPaymentClaimStorageKey() {
            return 'wallet_pending_payment_claims_v1';
        },

        loadPendingPaymentClaims() {
            try {
                const raw = window.localStorage?.getItem(this.getPendingPaymentClaimStorageKey());
                const parsed = JSON.parse(raw || '[]');
                const now = Date.now();
                const filtered = (Array.isArray(parsed) ? parsed : []).filter((item) => {
                    const token = String(item?.token || '').trim();
                    const intentId = String(item?.intent_id || '').trim();
                    const checkoutSessionId = String(item?.checkout_session_id || '').trim();
                    const expiresAt = Date.parse(String(item?.expires_at || ''));
                    return token && intentId && checkoutSessionId && Number.isFinite(expiresAt) && expiresAt > now;
                });

                if (filtered.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
                    window.localStorage?.setItem(this.getPendingPaymentClaimStorageKey(), JSON.stringify(filtered));
                }

                return filtered;
            } catch (_) {
                return [];
            }
        },

        savePendingPaymentClaims(claims = []) {
            try {
                window.localStorage?.setItem(
                    this.getPendingPaymentClaimStorageKey(),
                    JSON.stringify(Array.isArray(claims) ? claims : [])
                );
            } catch (_) {
                // ignore storage failures
            }
        },

        rememberPendingPaymentClaim(paymentResult = {}) {
            const claim = paymentResult?.payment_claim;
            const token = String(claim?.token || '').trim();
            const intentId = String(claim?.intent_id || '').trim();
            if (!token || !intentId) {
                return;
            }

            const existing = this.loadPendingPaymentClaims().filter((item) => item.intent_id !== intentId);
            existing.unshift({
                intent_id: intentId,
                token,
                provider: String(claim?.provider || paymentResult?.provider || 'afdian').trim().toLowerCase() || 'afdian',
                site: String(claim?.site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn',
                checkout_session_id: String(claim?.checkout_session_id || paymentResult?.checkout_session_id || '').trim() || null,
                package_id: String(claim?.package_id || '').trim() || null,
                package_name: String(claim?.package_name || paymentResult?.package_name || '').trim() || null,
                expected_amount: Number(claim?.expected_amount || paymentResult?.paid_amount || 0) || 0,
                points_amount: Number(claim?.points_amount || paymentResult?.points_amount || 0) || 0,
                charge_type: String(claim?.charge_type || '').trim().toLowerCase() || null,
                issued_at: String(claim?.issued_at || '').trim() || new Date().toISOString(),
                expires_at: String(claim?.expires_at || '').trim() || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            });

            this.savePendingPaymentClaims(existing.slice(0, 20));
        },

        consumePendingPaymentClaims(intentIds = []) {
            const normalizedIds = (Array.isArray(intentIds) ? intentIds : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean);
            if (!normalizedIds.length) {
                return;
            }

            const remaining = this.loadPendingPaymentClaims()
                .filter((item) => !normalizedIds.includes(String(item?.intent_id || '').trim()));
            this.savePendingPaymentClaims(remaining);
        },

        loadPendingCustomRechargeQuotes() {
            try {
                const raw = window.localStorage?.getItem(this.getPendingCustomRechargeQuoteStorageKey());
                const parsed = JSON.parse(raw || '[]');
                const now = Date.now();
                const filtered = (Array.isArray(parsed) ? parsed : []).filter((item) => {
                    const token = String(item?.token || '').trim();
                    const quoteId = String(item?.quote_id || '').trim();
                    const expiresAt = Date.parse(String(item?.expires_at || ''));
                    return token && quoteId && Number.isFinite(expiresAt) && expiresAt > now;
                });

                if (filtered.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
                    window.localStorage?.setItem(this.getPendingCustomRechargeQuoteStorageKey(), JSON.stringify(filtered));
                }

                return filtered;
            } catch (_) {
                return [];
            }
        },

        savePendingCustomRechargeQuotes(quotes = []) {
            try {
                window.localStorage?.setItem(
                    this.getPendingCustomRechargeQuoteStorageKey(),
                    JSON.stringify(Array.isArray(quotes) ? quotes : [])
                );
            } catch (_) {
                // ignore storage failures
            }
        },

        rememberPendingCustomRechargeQuote(paymentResult = {}) {
            const quote = paymentResult?.custom_quote;
            const token = String(quote?.token || '').trim();
            const quoteId = String(quote?.quote_id || '').trim();
            if (!token || !quoteId) {
                return;
            }

            const site = window.SiteConfig?.site || 'cn';
            const existing = this.loadPendingCustomRechargeQuotes().filter((item) => item.quote_id !== quoteId);
            existing.unshift({
                quote_id: quoteId,
                token,
                provider: String(paymentResult?.provider || 'afdian').trim().toLowerCase() || 'afdian',
                site,
                points_amount: Number(quote?.points_amount || paymentResult?.points_amount || 0) || 0,
                paid_amount: Number(quote?.paid_amount || paymentResult?.paid_amount || 0) || 0,
                issued_at: String(quote?.issued_at || '').trim() || new Date().toISOString(),
                expires_at: String(quote?.expires_at || '').trim() || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                checkout_session_id: String(paymentResult?.checkout_session_id || '').trim() || null
            });

            this.savePendingCustomRechargeQuotes(existing.slice(0, 12));
        },

        consumePendingCustomRechargeQuotes(quoteIds = []) {
            const normalizedIds = (Array.isArray(quoteIds) ? quoteIds : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean);
            if (!normalizedIds.length) {
                return;
            }

            const remaining = this.loadPendingCustomRechargeQuotes()
                .filter((item) => !normalizedIds.includes(String(item?.quote_id || '').trim()));
            this.savePendingCustomRechargeQuotes(remaining);
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
                if (titleEl) titleEl.textContent = this.tr('wallet.monthCheckinTitle', '{month}月打卡', { month });

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
                    setInlineStyles(fill, { width: `${progressPercent}%` });
                }

            } catch (err) {
                console.error('[WalletModal] Error loading check-in data:', err);
                const grid = document.getElementById('calendar-grid');
                if (grid) grid.innerHTML = `<div class="loading-calendar loading-calendar--error">${this.tr('wallet.calendarLoadFailed', '加载失败')}</div>`;
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
                let actionAttrs = '';

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
                        <span class="calendar-day-number">${i}</span>
                        <span class="calendar-check-badge" aria-hidden="true">
                            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3.5 8.4L6.6 11.3L12.5 5.1"/>
                            </svg>
                        </span>
                    `;
                } else if (isToday) {
                    dayClass += ' today';
                    actionAttrs = this.buildDataAttributes({ 'wallet-action': 'daily-checkin-v2' });
                    innerHtml = `<span class="today-text">${this.tr('wallet.todayShort', '今日')}</span>`;
                } else if (isPast) {
                    dayClass += ' missed';
                    innerHtml += `<div class="makeup-badge">${this.tr('wallet.makeupShort', '补')}</div>`;
                    actionAttrs = this.buildDataAttributes({
                        'wallet-action': 'makeup-checkin',
                        'wallet-date-value': this.encodeActionValue(dateStr)
                    });
                } else {
                    dayClass += ' future';
                }

                if (isGiftDay && !isChecked) {
                    innerHtml += `
                    <div class="mystery-gift-container" title="${this.escapeAttribute(this.tr('wallet.mysteryGiftTitle', '连续签到7天神秘盲盒'))}">
                        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22 17.5C22 19.433 20.433 21 18.5 21H5.5C3.567 21 2 19.433 2 17.5V11H22V17.5ZM2 8.5C2 7.119 3.119 6 4.5 6H7.132C7.045 5.688 7 5.352 7 5C7 3.343 8.343 2 10 2C10.978 2 11.846 2.47 12.399 3.208L12 3.159L11.601 3.208C12.154 2.47 13.022 2 14 2C15.657 2 17 3.343 17 5C17 5.352 16.955 5.688 16.868 6H19.5C20.881 6 22 7.119 22 8.5V9H2V8.5ZM13 11V21H11V11H13ZM13 6V9H11V6H13Z" />
                        </svg>
                    </div>`;
                }

                html += `<div class="${dayClass}"${actionAttrs}>${innerHtml}</div>`;
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
                gridToday.innerHTML = `<span class="today-text today-text--loading">...</span>`;
            }

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (!session?.user) {
                    this.showToast(this.tr('wallet.pleaseLogin', '请先登录'), 'error');
                    this.isCheckingIn = false;
                    if (gridToday) gridToday.innerHTML = `<span class="today-text">${this.tr('wallet.todayShort', '今日')}</span>`;
                    return;
                }

                const currentSite = window.SiteConfig?.site || 'cn';
                const currentDate = new Date();
                const localDate = [
                    currentDate.getFullYear(),
                    String(currentDate.getMonth() + 1).padStart(2, '0'),
                    String(currentDate.getDate()).padStart(2, '0')
                ].join('-');

                const response = await fetch('/api/wallet/checkin', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({
                        site: currentSite,
                        local_date: localDate
                    })
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data?.message || this.tr('wallet.checkinFailed', '签到失败'));
                }

                if (data?.already_checked) {
                    this.showToast(this.tr('wallet.alreadyCheckedToday', '今日已签到过了'), 'info');
                    this.loadCheckinData(); // refresh grid
                } else if (data?.success) {
                    trackWalletAnalyticsEvent('checkin_success', {
                        entityType: 'checkin',
                        entityId: localDate,
                        eventValue: Number(data.points || 0) || null,
                        pointsDelta: Number(data.points || 0) || null,
                        metadata: {
                            ...buildWalletSourceMetadata(this.lastOpenContext),
                            checkin_date: localDate,
                            streak_days: Number(data.consecutive_days || 0) || 0,
                            points_reward: Number(data.points || 0) || 0,
                            base_reward: Number(data.base_reward || 0) || 0,
                            bonus_reward: Number(data.bonus_reward || 0) || 0
                        }
                    }, {
                        eventType: 'conversion',
                        dedupeKey: `checkin_success:${window.SiteConfig?.site || 'cn'}:${localDate}`
                    });

                    // Celebration Animations
                    this.playConfetti();

                    // Show message combining base and bonus (if any)
                    let msg = `💰 ${this.tr('wallet.checkinReward', '签到奖励 +{points} {unit}', {
                        points: this.formatPoints(data.points),
                        unit: this.tr('wallet.pointsUnit', '积分')
                    })}`;
                    if (data.message && data.message !== '签到成功' && (!this.isEnglishLanguage() || !this.containsCjkText(data.message))) {
                        msg += `\\n${data.message}`; // Append the bonus message
                    }
                    if (Number(data?.linked_discount_summary?.issued_count || 0) > 0) {
                        msg += `\\n🎟 ${this.tr('wallet.issuedCoupons', '已发放 {count} 张卡券', {
                            count: this.formatPoints(data.linked_discount_summary.issued_count)
                        })}`;
                        this.resetDiscountAssetsState();
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
                    throw new Error(data?.message || this.tr('wallet.checkinFailed', '签到失败'));
                }
            } catch (e) {
                console.error('[WalletModal] Check-in V2 failed:', e);
                this.showToast('❌ ' + (e.message || this.tr('wallet.checkinFailed', '签到失败')), 'error');
                if (gridToday) {
                    gridToday.innerHTML = `<span class="today-text">${this.tr('wallet.todayShort', '今日')}</span>`;
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
                ? this.tr('wallet.confirmMakeup', '确认要补签 {date} 吗？\\n这将扣除 {cost} {unit}', {
                    date: dateStr,
                    cost: this.formatPoints(makeupCost),
                    unit: this.tr('wallet.pointsUnit', '积分')
                })
                : this.tr('wallet.confirmMakeupFree', '确认要补签 {date} 吗？\\n当前补签不扣除积分', { date: dateStr });

            if (!confirm(confirmMessage)) {
                return;
            }

            this.executeMakeup(dateStr, 'points');
        },

        async executeMakeup(dateStr, method) {
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (!session?.user) return this.showToast(this.tr('wallet.pleaseLogin', '请先登录'), 'error');

                const { data, error } = await window.supabaseClient.rpc('fn_makeup_checkin', {
                    p_user_id: session.user.id,
                    p_site: window.SiteConfig?.site || 'cn',
                    p_date: dateStr,
                    p_method: method
                });

                if (error) throw error;

                if (data.success) {
                    this.showToast(`✅ ${this.tr('wallet.makeupSuccess', '补签成功! 扣除 {cost} {unit}', {
                        cost: this.formatPoints(data.cost),
                        unit: this.tr('wallet.pointsUnit', '积分')
                    })}`, 'success');

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
                this.showToast(`${this.tr('wallet.makeupFailed', '补签失败')}: ${e.message}`, 'error');
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
                setInlineStyles(particle, {
                    left: Math.random() * 100 + '%',
                    backgroundColor: ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#a78bfa'][Math.floor(Math.random() * 5)]
                });
                const duration = Math.random() * 1 + 1; // 1 to 2s
                const delay = Math.random() * 0.2;
                setInlineStyles(particle, {
                    animation: `confetti-fall ${duration}s ${delay}s ease-out forwards`
                });

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

                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (!session?.access_token) {
                    throw new Error('请先登录后再查询订单');
                }

                const pendingQuoteTokens = this.loadPendingCustomRechargeQuotes()
                    .filter((item) => (item.site || 'cn') === (window.SiteConfig?.site || 'cn'))
                    .filter((item) => (item.provider || 'afdian') === 'afdian')
                    .map((item) => item.token)
                    .filter(Boolean);
                const pendingClaimTokens = this.loadPendingPaymentClaims()
                    .filter((item) => (item.site || 'cn') === (window.SiteConfig?.site || 'cn'))
                    .filter((item) => (item.provider || 'afdian') === 'afdian')
                    .map((item) => item.token)
                    .filter(Boolean);

                // Get server URL from verify config or default
                const serverUrl = window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app';
                const response = await fetch(`${serverUrl}/api/afdian/query`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({
                        order_no: orderNo,
                        quote_tokens: pendingQuoteTokens,
                        claim_tokens: pendingClaimTokens
                    })
                });
                const data = await response.json().catch(() => ({}));

                if (Array.isArray(data?.consumed_custom_quote_ids) && data.consumed_custom_quote_ids.length > 0) {
                    this.consumePendingCustomRechargeQuotes(data.consumed_custom_quote_ids);
                }
                if (Array.isArray(data?.consumed_payment_claim_ids) && data.consumed_payment_claim_ids.length > 0) {
                    this.consumePendingPaymentClaims(data.consumed_payment_claim_ids);
                }

                resultDiv.innerHTML = '';
                const wrapper = document.createElement('div');

                if (response.ok && data.success) {
                    wrapper.className = 'afdian-code-result';

                    const label = document.createElement('div');
                    label.className = 'code-label';
                    label.textContent = `您的兑换码（${data.points}积分）：`;

                    const codeValue = document.createElement('div');
                    codeValue.className = 'code-value';
                    codeValue.textContent = data.code;
                    codeValue.addEventListener('click', () => this.copyAfdianCode(data.code));

                    const hint = document.createElement('div');
                    hint.className = 'code-hint';
                    hint.textContent = data.is_redeemed ? '⚠️ 该兑换码已使用' : '点击复制，然后在余额页使用';

                    wrapper.appendChild(label);
                    wrapper.appendChild(codeValue);
                    wrapper.appendChild(hint);
                } else {
                    wrapper.className = 'afdian-error';
                    wrapper.textContent = data.message || '查询失败';
                }

                resultDiv.appendChild(wrapper);
                resultDiv.classList.add('is-visible');

            } catch (err) {
                console.error('[WalletModal] Afdian query failed:', err);
                resultDiv.innerHTML = '';
                const errorDiv = document.createElement('div');
                errorDiv.className = 'afdian-error';
                errorDiv.textContent = err.message || '查询失败，请稍后重试';
                resultDiv.appendChild(errorDiv);
                resultDiv.classList.add('is-visible');
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

            // Replace emoji with custom icon
            const processedMessage = message.replace(/✅\s*/g, '');

            if (type === 'success') {
                toast.innerHTML = `
                    <span class="wallet-toast-icon" aria-hidden="true">
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6.5L4.5 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <span class="wallet-toast-message">${this.escapeHtml(processedMessage)}</span>
                `;
            } else {
                toast.textContent = message;
            }

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('wallet-toast--leaving');
                setTimeout(() => toast.remove(), 300);
            }, 2000);
        },

        buildRechargePendingMarkup(label = '处理中', options = {}) {
            const dotsOnly = !!options.dotsOnly;
            return `
                <span class="wallet-pending-badge${dotsOnly ? ' wallet-pending-badge--dots-only' : ''}">
                    ${dotsOnly ? '' : `<span>${this.escapeHtml(label)}</span>`}
                    <span class="wallet-pending-dots" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <span></span>
                    </span>
                </span>
            `;
        },

        setRechargeActionPendingState(state = null) {
            const overlay = document.getElementById('wallet-modal-overlay');
            const packageItems = Array.from(document.querySelectorAll('#wallet-packages .package-item[data-wallet-action="buy-package"]'));
            const customInput = document.getElementById('wallet-custom-recharge-input');
            const customButton = document.getElementById('wallet-custom-recharge-btn');
            const isPending = !!state;

            this.pendingRechargeAction = isPending ? { ...state } : null;

            overlay?.classList.toggle('loading', isPending);

            packageItems.forEach((item) => {
                const priceEl = item.querySelector('[data-wallet-package-price]');
                const decodedPackageId = this.decodeActionValue(item.dataset.walletPackageId);
                const isTarget = isPending
                    && state.kind === 'package'
                    && String(decodedPackageId) === String(state.packageId);

                item.disabled = isPending;
                item.classList.toggle('is-processing', isTarget);
                item.classList.toggle('is-dimmed', isPending && !isTarget);
                item.setAttribute('aria-busy', isTarget ? 'true' : 'false');

                if (!priceEl) return;
                if (!priceEl.dataset.defaultLabel) {
                    priceEl.dataset.defaultLabel = priceEl.textContent;
                }

                if (isTarget) {
                    priceEl.innerHTML = this.buildRechargePendingMarkup(state.controlLabel || '处理中');
                } else {
                    priceEl.textContent = priceEl.dataset.defaultLabel;
                }
            });

            if (!isPending) {
                if (customButton) {
                    customButton.classList.remove('is-processing');
                    customButton.removeAttribute('aria-busy');
                }

                this.renderCustomRechargeSection(
                    this.rechargeOptionsConfig,
                    this.paymentChannelsConfig,
                    this.paymentRuntimeConfig
                );
                return;
            }

            if (customInput) {
                customInput.disabled = true;
            }

            if (customButton) {
                customButton.disabled = true;
                customButton.classList.toggle('is-processing', state.kind === 'custom');
                customButton.setAttribute('aria-busy', state.kind === 'custom' ? 'true' : 'false');

                if (!customButton.dataset.defaultLabel) {
                    customButton.dataset.defaultLabel = customButton.textContent.trim();
                }

                if (state.kind === 'custom') {
                    customButton.innerHTML = this.buildRechargePendingMarkup(state.controlLabel || '处理中', { dotsOnly: true });
                    customButton.setAttribute('aria-label', state.controlLabel || '处理中');
                }
            }
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
                    reason = this.tr('wallet.makeupCheckinCost', '补签扣分');
                }
                else if (reason === 'signup_bonus') {
                    reason = this.tr('wallet.signupBonus', '注册奖励');
                }
                else if (reason === 'custom_recharge') {
                    reason = this.tr('wallet.customRecharge', '自定义充值');
                }

                return `
                    <div class="history-item"${this.buildDataAttributes({ 'wallet-action': 'toggle-history-item-details' })}>
                        <div class="history-row-main">
                            <div class="history-main">
                                <div class="history-desc" title="${item.reason}">${reason}</div>
                                <div class="history-date">${dateStr}</div>
                            </div>
                            <div class="history-amount ${item.amount > 0 ? 'positive' : 'negative'}">
                                ${item.amount > 0 ? '+' : ''}${this.formatPoints(item.amount)}
                            </div>
                        </div>
                        <div class="history-details"${this.buildDataAttributes({ 'wallet-action': 'history-details' })}>
                             <div class="detail-row">
                                <span>${this.tr('wallet.orderNo', '订单号')}</span>
                                <span class="detail-val mono copyable"${this.buildDataAttributes({
                                    'wallet-action': 'copy-value',
                                    'wallet-copy-value': this.encodeActionValue(item.id)
                                })} title="${this.escapeAttribute(this.tr('wallet.copyOrderNo', '点击复制订单号'))}">${item.id}</span>
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
                const pointsService = window.PointsService;
                if (!pointsService?.getWalletPromptTitles) return;

                const promptTitles = await pointsService.getWalletPromptTitles(toFetch, {
                    site: window.SiteConfig?.site || 'cn'
                });

                Object.entries(promptTitles || {}).forEach(([id, title]) => {
                    this.promptCache[id] = title;
                });

                return promptTitles || {};
            } catch (err) {
                console.error('Error fetching prompt titles:', err);
                return {};
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
                        <button class="date-cancel js-wallet-date-cancel">取消</button>
                        <button class="date-confirm js-wallet-date-confirm">确定</button>
                    </div>
                </div>
            `;

            // Set default dates (last 7 days)
            const today = new Date().toISOString().split('T')[0];
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            document.body.appendChild(modal);
            document.getElementById('date-start').value = weekAgo;
            document.getElementById('date-end').value = today;

            modal.querySelector('.js-wallet-date-cancel')?.addEventListener('click', () => {
                modal.remove();
            });

            modal.querySelector('.js-wallet-date-confirm')?.addEventListener('click', () => {
                this.applyCustomDate();
            });

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
        currentWalletBalance: null,
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
                <div class="wallet-order-modal wallet-order-modal--compact">
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
                            <div class="detail-row wallet-detail-row--stacked">
                                <span class="detail-label wallet-detail-label--stacked">开始日期</span>
                                <input type="date" id="order-date-start" class="wallet-date-input" value="${this.orderCustomDateStart ? this.orderCustomDateStart.toISOString().split('T')[0] : ''}">
                            </div>
                            <div class="detail-row wallet-detail-row--stacked wallet-detail-row--spaced">
                                <span class="detail-label wallet-detail-label--stacked">结束日期</span>
                                <input type="date" id="order-date-end" class="wallet-date-input" value="${this.orderCustomDateEnd ? this.orderCustomDateEnd.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}">
                            </div>
                        </div>
                        <div class="modal-actions wallet-modal-actions--compact">
                            <button class="action-btn secondary wallet-action-btn--grow date-cancel-btn">
                                取消
                            </button>
                            <button class="action-btn primary wallet-action-btn--grow date-confirm-btn">
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
            const pointsService = window.PointsService;
            if (!pointsService?.getWalletTransactions) {
                return {
                    shopOrders: [],
                    ledgerEntries: [],
                    promptTitles: {}
                };
            }

            const result = await pointsService.getWalletTransactions({
                site,
                query,
                searchLimit: 80
            });

            return {
                shopOrders: this.dedupeRecordsById(result.shopOrders || []),
                ledgerEntries: this.dedupeRecordsById(result.ledgerEntries || []),
                promptTitles: result.promptTitles || {}
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
                filtered = filtered.filter(order => order.transactionType === 'recharge' || order.transactionType === 'affiliate');
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
                    promptTitles = this._prefetchedPromptTitles || {};
                    this._prefetchedShopOrders = null;
                    this._prefetchedLedger = null;
                    this._prefetchedPromptTitles = null;
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
                    const pointsService = window.PointsService;
                    if (!pointsService?.getWalletTransactions) {
                        throw new Error('PointsService wallet transactions API not available');
                    }
                    const walletRecords = await pointsService.getWalletTransactions({
                        site,
                        limit: 100
                    });

                    if (requestId !== this.orderRequestId) return;
                    shopOrders = walletRecords.shopOrders || [];
                    ledgerEntries = walletRecords.ledgerEntries || [];
                    promptTitles = walletRecords.promptTitles || {};
                }

                const missingPromptIds = [...new Set(
                    (ledgerEntries || [])
                        .filter((entry) => entry.reason === 'unlock_prompt' && entry.reference_id && !promptTitles[entry.reference_id])
                        .map((entry) => entry.reference_id)
                )];

                if (missingPromptIds.length > 0) {
                    const extraPromptTitles = await this.fetchPromptTitles(missingPromptIds);
                    if (requestId !== this.orderRequestId) return;
                    promptTitles = {
                        ...promptTitles,
                        ...(extraPromptTitles || {})
                    };
                }

                if (!normalizedQuery) {
                    await this.ensureWalletBalanceForOrderSnapshots();
                    if (requestId !== this.orderRequestId) return;
                }

                const ledgerEntriesWithBalances = normalizedQuery
                    ? (ledgerEntries || [])
                    : this.annotateLedgerEntriesWithBalanceSnapshots(ledgerEntries || []);
                const existingBalanceSnapshots = new Map();
                [
                    ...(this.browseOrdersSnapshot || []),
                    ...(this.ordersData || [])
                ].forEach((order) => {
                    const id = String(order?.id || '').trim();
                    const balanceBefore = this.normalizeOptionalPointValue(order?.balanceBefore);
                    const balanceAfter = this.normalizeOptionalPointValue(order?.balanceAfter);
                    if (id && (balanceBefore !== null || balanceAfter !== null)) {
                        existingBalanceSnapshots.set(id, { balanceBefore, balanceAfter });
                    }
                });

                const ledgerOrders = ledgerEntriesWithBalances.map((entry) => {
                    const entryAmount = this.normalizePointValue(entry.amount);
                    const existingSnapshot = existingBalanceSnapshots.get(String(entry.id || '').trim()) || {};
                    let transactionType = 'other';
                    let displayName = entry.reason || '交易';
                    let icon = '💳';
                    let shopOrderId = '';
                    let affiliateRewardMeta = null;

                    if (entry.reason === 'unlock_prompt') {
                        transactionType = 'prompt';
                        displayName = promptTitles[entry.reference_id] || `${window.i18n?.t('wallet.promptItem') || '提示词'} #${entry.reference_id}`;
                        icon = '💡';
                    } else if (this.isVerifyServiceReason(entry.reason)) {
                        transactionType = 'verify';
                        displayName = this.getVerifyDisplayName(entry.reason);
                        icon = '🔑';
                    } else if (this.isShopLedgerReason(entry.reason, entry.reference_id)) {
                        transactionType = 'shop';
                        displayName = String(entry.reason || '')
                            .replace(/^商城购买[:：]\s*/i, '')
                            .replace(/^shop purchase[:：]\s*/i, '')
                            .trim() || (window.i18n?.t('wallet.shopPurchase') || '商品');
                        icon = '🛒';
                        shopOrderId = this.getShopOrderIdFromReference(entry.reference_id);
                    } else if (this.isAffiliateRewardReason(entry.reason, entry.reference_id)) {
                        affiliateRewardMeta = this.getAffiliateRewardMeta(entry.reason, entry.reference_id);
                        transactionType = 'affiliate';
                        displayName = affiliateRewardMeta.label;
                        icon = '🤝';
                    } else if (entry.reason === 'daily_checkin') {
                        transactionType = 'recharge';
                        displayName = window.i18n?.t('wallet.dailyCheckin') || '每日签到';
                        icon = '⚡';
                    } else if (entry.reason === 'makeup_checkin_cost') {
                        transactionType = 'recharge';
                        displayName = this.tr('wallet.makeupCheckinCost', '补签扣分');
                        icon = '📅';
                    } else if (entry.reason === 'signup_bonus') {
                        transactionType = 'recharge';
                        displayName = this.tr('wallet.signupBonus', '注册奖励');
                        icon = '🎁';
                    } else if (entry.reason === 'custom_recharge') {
                        transactionType = 'recharge';
                        displayName = this.tr('wallet.customRecharge', '自定义充值');
                        icon = '⚡';
                    } else if (entry.reason && (entry.reason.startsWith('模拟充值') || entry.reason === 'package_purchase' || entry.reason === 'afdian_recharge')) {
                        transactionType = 'recharge';
                        displayName = this.getRechargeDisplayName(entry.reason);
                        icon = '⚡';
                    } else if (entry.reason === 'redeem_code' || (entry.reason && entry.reason.includes('兑换码'))) {
                        transactionType = 'redeem';
                        displayName = this.tr('wallet.redeemCodeExchange', '兑换码兑换');
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
                        displayName = entry.reason || this.tr('wallet.pointsRecharge', '积分充值');
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
                        isAffiliateReward: transactionType === 'affiliate',
                        isRedeem: transactionType === 'redeem',
                        promptId: entry.reason === 'unlock_prompt' ? entry.reference_id : null,
                        redeemCode: transactionType === 'redeem' ? entry.reference_id : null,
                        referenceId: entry.reference_id || '',
                        balanceBefore: this.normalizeOptionalPointValue(entry.balanceBefore ?? existingSnapshot.balanceBefore),
                        balanceAfter: this.normalizeOptionalPointValue(entry.balanceAfter ?? existingSnapshot.balanceAfter),
                        shopOrderId,
                        rawReason: entry.reason || '',
                        icon,
                        affiliateRewardMeta
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
                let actionAttrs = '';
                let amountDisplay;
                let amountClass;
                let statusText = completedText;
                let statusClass = 'status-completed';
                const signedAmount = order.isShopOrder
                    ? -this.normalizePointValue(order.total_price || 0)
                    : this.normalizePointValue(order.amount ?? order.total_price ?? 0);
                const absAmountText = this.formatPoints(Math.abs(signedAmount));
                const balanceBeforeValue = this.normalizeOptionalPointValue(order.balanceBefore);
                const balanceAfterValue = this.normalizeOptionalPointValue(order.balanceAfter);

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
                    displayName = `${this.renderWalletInlineIcon('fa-lightbulb', '#fde68a')} ${this.escapeHtml(order.snapshot_product_name)}`;
                    actionAttrs = this.buildDataAttributes({
                        'wallet-action': 'open-order-detail',
                        'wallet-order-kind': 'prompt',
                        'wallet-order-id': this.encodeActionValue(order.id),
                        'wallet-prompt-name': this.encodeActionValue(order.snapshot_product_name),
                        'wallet-price': Math.abs(this.normalizePointValue(order.total_price || order.amount || 0)),
                        'wallet-created-at': this.encodeActionValue(order.created_at),
                        'wallet-prompt-id': this.encodeActionValue(order.promptId || '')
                    });
                } else if (order.transactionType === 'verify') {
                    displayName = `${this.renderWalletInlineIcon('fa-key', '#6b9ece')} ${this.escapeHtml(order.snapshot_product_name)}`;
                    actionAttrs = this.buildDataAttributes({
                        'wallet-action': 'open-order-detail',
                        'wallet-order-kind': 'verify',
                        'wallet-order-id': this.encodeActionValue(order.id),
                        'wallet-reference-id': this.encodeActionValue(order.referenceId || ''),
                        'wallet-points-paid': Math.abs(this.normalizePointValue(order.total_price || order.amount || 0)),
                        'wallet-created-at': this.encodeActionValue(order.created_at),
                        'wallet-reason': this.encodeActionValue(order.rawReason || '')
                    });
                } else if (order.transactionType === 'shop') {
                    displayName = this.getLocalizedProductNameFromPayload(order, unknownProductText);
                    const count = order.item_count || (order.shop_order_items ? order.shop_order_items.length : 1);
                    if (count > 1) {
                        displayName = isEnglish ? `${displayName} +${count - 1} ${itemsText}` : `${displayName} 等 ${count} ${itemsText}`;
                    }
                    displayName = `${this.renderWalletInlineIcon('fa-shopping-bag', '#22c55e')} ${this.escapeHtml(displayName)}`;
                    if (order.isShopOrder && (order.shopOrderId || order.id)) {
                        actionAttrs = this.buildDataAttributes({
                            'wallet-action': 'open-order-detail',
                            'wallet-order-kind': 'shop',
                            'wallet-order-id': this.encodeActionValue(String(order.shopOrderId || order.id))
                        });
                    } else {
                        actionAttrs = this.buildDataAttributes({
                            'wallet-action': 'open-order-detail',
                            'wallet-order-kind': 'recharge',
                            'wallet-order-id': this.encodeActionValue(order.id),
                            'wallet-amount': -Math.abs(this.normalizePointValue(order.total_price || order.amount || 0)),
                            'wallet-created-at': this.encodeActionValue(order.created_at),
                            'wallet-reason': this.encodeActionValue(order.rawReason || ''),
                            'wallet-reference-id': this.encodeActionValue(order.referenceId || ''),
                            'wallet-balance-before': balanceBeforeValue === null ? null : this.encodeActionValue(balanceBeforeValue),
                            'wallet-balance-after': balanceAfterValue === null ? null : this.encodeActionValue(balanceAfterValue)
                        });
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
                } else if (order.transactionType === 'affiliate') {
                    const meta = order.affiliateRewardMeta || this.getAffiliateRewardMeta(order.rawReason, order.referenceId);
                    displayName = `${this.renderWalletInlineIcon(meta.icon, meta.color)} ${this.escapeHtml(meta.label)}`;
                    actionAttrs = this.buildDataAttributes({
                        'wallet-action': 'open-order-detail',
                        'wallet-order-kind': 'affiliate',
                        'wallet-order-id': this.encodeActionValue(order.id),
                        'wallet-amount': this.normalizePointValue(order.amount || order.total_price || 0),
                        'wallet-created-at': this.encodeActionValue(order.created_at),
                        'wallet-reason': this.encodeActionValue(order.rawReason || ''),
                        'wallet-reference-id': this.encodeActionValue(order.referenceId || ''),
                        'wallet-balance-before': balanceBeforeValue === null ? null : this.encodeActionValue(balanceBeforeValue),
                        'wallet-balance-after': balanceAfterValue === null ? null : this.encodeActionValue(balanceAfterValue)
                    });
                } else if (order.transactionType === 'recharge') {
                    displayName = `${this.renderWalletInlineIcon('fa-bolt', '#fbbf24')} ${this.escapeHtml(order.snapshot_product_name)}`;
                    actionAttrs = this.buildDataAttributes({
                        'wallet-action': 'open-order-detail',
                        'wallet-order-kind': 'recharge',
                        'wallet-order-id': this.encodeActionValue(order.id),
                        'wallet-amount': this.normalizePointValue(order.amount || order.total_price || 0),
                        'wallet-created-at': this.encodeActionValue(order.created_at),
                        'wallet-reason': this.encodeActionValue(order.rawReason || ''),
                        'wallet-reference-id': this.encodeActionValue(order.referenceId || '')
                    });
                } else if (order.transactionType === 'redeem') {
                    displayName = `${this.renderWalletInlineIcon('fa-ticket-alt', '#f472b6')} ${this.escapeHtml(order.snapshot_product_name)}`;
                    actionAttrs = this.buildDataAttributes({
                        'wallet-action': 'open-order-detail',
                        'wallet-order-kind': 'redeem',
                        'wallet-order-id': this.encodeActionValue(order.id),
                        'wallet-amount': this.normalizePointValue(order.amount),
                        'wallet-created-at': this.encodeActionValue(order.created_at),
                        'wallet-redeem-code': this.encodeActionValue(order.redeemCode || '')
                    });
                } else {
                    // Fallback for other types
                    displayName = `${order.icon || '💳'} ${order.snapshot_product_name || '交易'}`;
                    actionAttrs = '';
                }

                return `
                    <div class="order-item${actionAttrs ? ' order-item--interactive' : ''}"${actionAttrs}>
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

            this.prefetchShopOrderDetails(orders, { limit: 4 });
        },

        findShopOrderPreview(orderId = '') {
            const normalizedOrderId = String(orderId || '').trim();
            if (!normalizedOrderId) {
                return null;
            }

            const candidatePools = [
                this.ordersData,
                this.browseOrdersSnapshot,
                this._prefetchedShopOrders
            ];

            for (const pool of candidatePools) {
                const matchedOrder = (Array.isArray(pool) ? pool : []).find((order) => {
                    const candidateOrderId = String(order?.shopOrderId || order?.id || '').trim();
                    return candidateOrderId === normalizedOrderId;
                });
                if (matchedOrder) {
                    return matchedOrder;
                }
            }

            return null;
        },

        buildWalletShopOrderPreviewMarkup(orderId = '', previewOrder = {}) {
            const normalizedOrderId = String(orderId || '').trim();
            const shortenedOrderId = normalizedOrderId
                ? `${normalizedOrderId.split('-')[0]}...${normalizedOrderId.slice(-4)}`
                : '--';
            const dateStr = previewOrder?.created_at
                ? this.formatOrderDateTime(previewOrder.created_at)
                : (window.i18n?.t('wallet.loading') || '加载中...');
            const totalPrice = Math.abs(this.normalizePointValue(previewOrder?.total_price ?? previewOrder?.price_paid ?? 0));
            const productName = this.getLocalizedProductNameFromPayload(previewOrder || {}, '')
                || (window.i18n?.t('wallet.unknownProduct') || '未知商品');
            const pointsUnit = window.i18n?.t('wallet.pointsUnit') || '积分';
            const loadingLabel = window.i18n?.t('wallet.loading') || '加载中...';

            return `
                <div class="wallet-order-modal wallet-order-modal--shop-detail">
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            ${this.renderWalletInlineIcon('fa-box-open', '#6b9ece')} ${window.i18n?.t('wallet.orderDetails') || '订单详情'}
                        </div>
                    </div>
                    <div class="wallet-order-modal-body wallet-order-modal-body--fade">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono">${this.escapeHtml(shortenedOrderId)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderTime') || '下单时间'}</span>
                                <span class="detail-val">${this.escapeHtml(dateStr)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.pointsPaid') || '支付积分'}</span>
                                <span class="detail-val highlight">-${this.formatPoints(totalPrice)} ${pointsUnit}</span>
                            </div>
                            <div class="detail-row wallet-detail-row--product">
                                <span class="detail-label">${window.i18n?.t('shop.productName') || '商品名称'}</span>
                                <span class="detail-val wallet-order-product-name">${this.escapeHtml(productName)}</span>
                            </div>
                        </div>
                        <div class="content-section wallet-order-content-section--pending">
                            <div class="content-section-title">${window.i18n?.t('wallet.purchaseContent') || '购买内容'}</div>
                            <div class="wallet-order-content-loading-inline">
                                <div class="wallet-order-loading-state" aria-label="${this.escapeAttribute(loadingLabel)}">
                                    <div class="wallet-order-loading-row">
                                        <span class="wallet-pending-dots wallet-order-loading-dots" aria-hidden="true">
                                            <span></span><span></span><span></span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
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
                    </div>
                    <div class="wallet-order-modal-body">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono copyable js-wallet-copy-prompt-order" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${orderId.substring(0, 8)}...${orderId.slice(-4)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.productType') || '商品类型'}</span>
                                <span class="detail-val ${this.getWalletToneClass('#fbbf24')}">${window.i18n?.t('wallet.prompt') || '提示词'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.productName') || '商品名称'}</span>
                                ${promptId ? `
                                <button type="button" class="detail-val copyable wallet-detail-link wallet-order-product-name js-wallet-open-prompt-order" title="打开提示词详情">
                                    ${this.escapeHtml(promptName || '--')}
                                </button>
                                ` : `
                                <span class="detail-val">${this.escapeHtml(promptName || '--')}</span>
                                `}
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
                                <span class="detail-val wallet-status-success"><span class="wallet-status-check" aria-hidden="true">✓</span> ${window.i18n?.t('wallet.completed') || '已完成'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(detailOverlay);
            this.bindOverlayCloseButtons(detailOverlay);
            detailOverlay.querySelector('.js-wallet-copy-prompt-order')?.addEventListener('click', (event) => {
                this.copyToClipboard(orderId, event);
            });
            if (promptId) {
                detailOverlay.querySelector('.js-wallet-open-prompt-order')?.addEventListener('click', () => {
                    this.openPromptFromWalletDetail(promptId, detailOverlay);
                });
            }
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
                    </div>
                    <div class="wallet-order-modal-body">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono copyable js-wallet-copy-redeem-order" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${orderId.substring(0, 8)}...${orderId.slice(-4)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.transactionType') || '交易类型'}</span>
                                <span class="detail-val ${this.getWalletToneClass('#f472b6')}">${window.i18n?.t('wallet.redeemCode') || '兑换码'}</span>
                            </div>
                            ${redeemCode ? `
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.redeemCode') || '兑换码'}</span>
                                <span class="detail-val mono copyable wallet-detail-val--strong ${this.getWalletToneClass('#22c55e')} js-wallet-copy-redeem-code" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(redeemCode)}</span>
                            </div>
                            ` : ''}
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.redeemTime') || '兑换时间'}</span>
                                <span class="detail-val">${dateStr}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.receivedPoints') || '获得积分'}</span>
                                <span class="detail-val wallet-detail-val--strong ${this.getWalletToneClass('#10b981')}">+${amountText} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.status') || '状态'}</span>
                                <span class="detail-val wallet-status-success"><span class="wallet-status-check" aria-hidden="true">✓</span> ${window.i18n?.t('wallet.completed') || '已完成'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(detailOverlay);
            this.bindOverlayCloseButtons(detailOverlay);
            detailOverlay.querySelector('.js-wallet-copy-redeem-order')?.addEventListener('click', (event) => {
                this.copyToClipboard(orderId, event);
            });
            if (redeemCode) {
                detailOverlay.querySelector('.js-wallet-copy-redeem-code')?.addEventListener('click', (event) => {
                    this.copyToClipboard(redeemCode, event);
                });
            }
        },

        async showAffiliateRewardDetail(orderId, amount, createdAt, reason = '', referenceId = '') {
            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.id = `affiliate-reward-detail-${orderId}`;
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            detailOverlay.innerHTML = this.buildWalletOrderLoadingMarkup(window.i18n?.t('wallet.loading') || '加载中...');

            document.body.appendChild(detailOverlay);

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user = session?.user;
                if (!user) {
                    detailOverlay.remove();
                    this.showToast(window.i18n?.t('security.loginRequired') || '请先登录', 'error');
                    return;
                }

                const { data, error } = await window.supabaseClient.rpc('fn_get_affiliate_reward_detail', {
                    p_user_id: user.id,
                    p_ledger_id: orderId
                });

                if (error) throw error;

                const detail = data && typeof data === 'object' ? data : null;
                if (!detail?.found) {
                    detailOverlay.remove();
                    this.showRechargeOrderDetail(orderId, amount, createdAt, reason, referenceId);
                    return;
                }

                const meta = this.getAffiliateRewardMeta(detail.reward_reason || reason, detail.reference_id || referenceId);
                const rewardAmount = this.formatPoints(detail.reward_amount ?? amount ?? 0);
                const rewardTimeText = this.formatOrderDateTime(detail.reward_created_at || createdAt);
                const inviteeName = String(detail.invitee_name || detail.invitee_username || detail.invitee_masked_email || '被邀请用户').trim();
                const inviteeLine = [
                    detail.invitee_masked_email || '',
                    detail.invitee_registered_at ? `注册于 ${this.formatOrderDateTime(detail.invitee_registered_at)}` : ''
                ].filter(Boolean).join(' · ');
                const sourceKind = String(detail.source_kind || meta.sourceKind || '').trim();
                const sourceName = sourceKind === 'recharge'
                    ? this.getRechargeDisplayName(detail.source_reason || '')
                    : String(detail.source_name || '').trim();
                const sourceAmount = Number(detail.source_amount);
                const sourceAmountText = Number.isFinite(sourceAmount)
                    ? `${this.formatPoints(sourceAmount)} ${window.i18n?.t('wallet.pointsUnit') || '积分'}`
                    : '--';
                const sourceTimeText = detail.source_created_at
                    ? this.formatOrderDateTime(detail.source_created_at)
                    : '--';
                const sourceStageText = String(detail.source_stage || '').trim() || '推广奖励';
                const commissionRate = Number(detail.commission_rate);
                const commissionRateText = Number.isFinite(commissionRate) ? `${this.formatPoints(commissionRate)}%` : '--';
                const declaredCommissionRate = Number(detail.declared_commission_rate);
                const declaredCommissionRateText = Number.isFinite(declaredCommissionRate) ? `${this.formatPoints(declaredCommissionRate)}%` : '--';
                const expectedRewardAmount = Number(detail.expected_reward_amount);
                const expectedRewardText = Number.isFinite(expectedRewardAmount)
                    ? `${this.formatPoints(expectedRewardAmount)} ${window.i18n?.t('wallet.pointsUnit') || '积分'}`
                    : '--';
                const rewardAmountValue = Number(detail.reward_amount ?? amount ?? 0);
                const rewardDelta = Number.isFinite(expectedRewardAmount)
                    ? this.normalizePointValue(rewardAmountValue - expectedRewardAmount)
                    : 0;
                const hasCommissionMismatch = meta.rewardType === 'commission'
                    && Number.isFinite(expectedRewardAmount)
                    && Math.abs(rewardDelta) >= 0.1;
                const shortLedgerId = orderId ? `${orderId.substring(0, 8)}...${orderId.slice(-4)}` : '--';
                const shortSourceId = detail.source_order_id
                    ? `${String(detail.source_order_id).substring(0, 8)}...${String(detail.source_order_id).slice(-4)}`
                    : (detail.source_ledger_id
                        ? `${String(detail.source_ledger_id).substring(0, 8)}...${String(detail.source_ledger_id).slice(-4)}`
                        : '--');
                const modal = detailOverlay.querySelector('.wallet-order-modal');
                if (!modal) return;

                this.markWalletOrderModalReady(modal);

                modal.innerHTML = `
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            ${this.renderWalletInlineIcon(meta.icon, meta.color)} ${this.escapeHtml(detail.reward_label || meta.label)}
                        </div>
                    </div>
                    <div class="wallet-order-modal-body wallet-order-modal-body--fade">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono copyable js-copy-affiliate-ledger" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortLedgerId)}</span>
                            </div>
                            ${(detail.source_order_id || detail.source_ledger_id) ? `
                            <div class="detail-row">
                                <span class="detail-label">${sourceKind === 'purchase' ? '关联订单' : '关联流水'}</span>
                                <span class="detail-val mono copyable js-copy-affiliate-source" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortSourceId)}</span>
                            </div>
                            ` : ''}
                            <div class="detail-row">
                                <span class="detail-label">奖励类型</span>
                                <span class="detail-val ${this.getWalletToneClass(meta.color)}">${this.escapeHtml(detail.reward_label || meta.label)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">奖励阶段</span>
                                <span class="detail-val">${this.escapeHtml(sourceStageText)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">奖励时间</span>
                                <span class="detail-val">${this.escapeHtml(rewardTimeText)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.receivedPoints') || '获得积分'}</span>
                                <span class="detail-val wallet-detail-val--strong ${this.getWalletToneClass('#10b981')}">+${this.escapeHtml(rewardAmount)} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                            </div>
                            ${meta.rewardType === 'commission' ? `
                            <div class="detail-row">
                                <span class="detail-label">配置比例</span>
                                <span class="detail-val">${this.escapeHtml(declaredCommissionRateText)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">实际到账比例</span>
                                <span class="detail-val">${this.escapeHtml(commissionRateText)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">按配置应返</span>
                                <span class="detail-val">${this.escapeHtml(expectedRewardText)}</span>
                            </div>
                            ` : ''}
                        </div>

                        ${hasCommissionMismatch ? `
                        <div class="content-section content-section--tight">
                            <div class="content-card content-card--warning">
                                <div class="wallet-warning-row">
                                    <i class="fas fa-triangle-exclamation wallet-warning-icon"></i>
                                    <div class="wallet-warning-text">
                                        当前到账是 <strong>+${this.escapeHtml(rewardAmount)} 积分</strong>，但按配置比例应为 <strong>${this.escapeHtml(expectedRewardText)}</strong>。
                                        这通常说明数据库仍在按整数保存返佣，需要执行小数积分热修复。
                                    </div>
                                </div>
                            </div>
                        </div>
                        ` : ''}

                        <div class="content-section">
                            <div class="content-section-title">被邀请人</div>
                            <div class="content-card content-card--detail">
                                <div class="wallet-affiliate-person-row">
                                    <div class="affiliate-detail-avatar">
                                        ${detail.invitee_avatar_url
                                            ? `<img src="${this.escapeHtml(detail.invitee_avatar_url)}" alt="${this.escapeHtml(inviteeName)}" />`
                                            : `<span>${this.escapeHtml((inviteeName.charAt(0) || 'U').toUpperCase())}</span>`}
                                    </div>
                                    <div class="wallet-affiliate-person-meta">
                                        <div class="wallet-affiliate-person-name">${this.escapeHtml(inviteeName)}</div>
                                        <div class="wallet-affiliate-person-subtitle">${this.escapeHtml(inviteeLine || '邀请用户')}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        ${(sourceName || sourceKind) ? `
                        <div class="content-section">
                            <div class="content-section-title">${sourceKind === 'purchase' ? '关联订单详情' : sourceKind === 'recharge' ? '关联首充详情' : '关联动作'}</div>
                            <div class="content-card content-card--detail">
                                <div class="detail-row wallet-detail-row--compact">
                                    <span class="detail-label">${sourceKind === 'purchase' ? '商品 / 订单' : sourceKind === 'recharge' ? '充值类型' : '触发动作'}</span>
                                    <span class="detail-val">${this.escapeHtml(sourceName || sourceStageText)}</span>
                                </div>
                                <div class="detail-row wallet-detail-row--compact">
                                    <span class="detail-label">${sourceKind === 'register' ? '完成时间' : '动作时间'}</span>
                                    <span class="detail-val">${this.escapeHtml(sourceTimeText)}</span>
                                </div>
                                ${sourceKind !== 'register' ? `
                                <div class="detail-row wallet-detail-row--flush">
                                    <span class="detail-label">${sourceKind === 'purchase' ? '订单金额' : '充值金额'}</span>
                                    <span class="detail-val">${this.escapeHtml(sourceAmountText)}</span>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                `;

                this.bindOverlayCloseButtons(detailOverlay);
                modal.querySelector('.js-copy-affiliate-ledger')?.addEventListener('click', (event) => {
                    this.copyToClipboard(orderId, event);
                });

                if (detail.source_order_id || detail.source_ledger_id) {
                    modal.querySelector('.js-copy-affiliate-source')?.addEventListener('click', (event) => {
                        this.copyToClipboard(detail.source_order_id || detail.source_ledger_id, event);
                    });
                }
            } catch (err) {
                console.error('[WalletModal] Show affiliate reward detail failed:', err);
                if (document.getElementById(`affiliate-reward-detail-${orderId}`)) {
                    detailOverlay.remove();
                }
                this.showToast('加载推广奖励详情失败', 'error');
            }
        },

        showRechargeOrderDetail(orderId, amount, createdAt, reason = '', referenceId = '', balanceSnapshot = {}) {
            const date = new Date(createdAt);
            const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
            const normalizedAmount = this.normalizePointValue(amount);
            const titleText = normalizedAmount >= 0
                ? (window.i18n?.t('wallet.rechargeDetails') || '充值详情')
                : (window.i18n?.t('wallet.orderDetails') || '订单详情');
            const pointsLabel = `${normalizedAmount >= 0 ? '+' : '-'}${this.formatPoints(Math.abs(normalizedAmount))} ${window.i18n?.t('wallet.pointsUnit') || '积分'}`;
            const amountColor = normalizedAmount >= 0 ? '#10b981' : '#f87171';
            const shortOrderId = orderId ? `${orderId.substring(0, 8)}...${orderId.slice(-4)}` : '--';
            const resolvedBalanceSnapshot = this.resolveOrderBalanceSnapshot(orderId, balanceSnapshot);
            const balanceBefore = this.normalizeOptionalPointValue(resolvedBalanceSnapshot?.balanceBefore);
            const balanceAfter = this.normalizeOptionalPointValue(resolvedBalanceSnapshot?.balanceAfter);
            const balanceSnapshotMarkup = normalizedAmount >= 0 && balanceBefore !== null && balanceAfter !== null
                ? `
                            <div class="detail-row">
                                <span class="detail-label">到账前积分</span>
                                <span class="detail-val">${this.escapeHtml(this.formatPoints(balanceBefore))} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">到账后积分</span>
                                <span class="detail-val wallet-detail-val--strong ${this.getWalletToneClass('#10b981')}">${this.escapeHtml(this.formatPoints(balanceAfter))} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                            </div>`
                : '';

            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            detailOverlay.innerHTML = `
                <div class="wallet-order-modal">
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            ${this.renderWalletInlineIcon(normalizedAmount >= 0 ? 'fa-bolt' : 'fa-shopping-bag', normalizedAmount >= 0 ? '#fbbf24' : '#22c55e')} ${this.escapeHtml(titleText)}
                        </div>
                    </div>
                    <div class="wallet-order-modal-body">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono copyable js-copy-ledger-order" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortOrderId)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderTime') || '下单时间'}</span>
                                <span class="detail-val">${this.escapeHtml(dateStr)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${normalizedAmount >= 0 ? (window.i18n?.t('wallet.receivedPoints') || '获得积分') : (window.i18n?.t('wallet.pointsPaid') || '支付积分')}</span>
                                <span class="detail-val wallet-detail-val--strong ${this.getWalletToneClass(amountColor)}">${this.escapeHtml(pointsLabel)}</span>
                            </div>
                            ${balanceSnapshotMarkup}
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.status') || '状态'}</span>
                                <span class="detail-val wallet-status-success"><span class="wallet-status-check" aria-hidden="true">✓</span> ${window.i18n?.t('wallet.completed') || '已完成'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(detailOverlay);
            this.bindOverlayCloseButtons(detailOverlay);

            detailOverlay.querySelector('.js-copy-ledger-order')?.addEventListener('click', (event) => {
                this.copyToClipboard(orderId, event);
            });
        },

        /**
         * Show Google One verify order detail modal
         */
        async showVerifyOrderDetail(orderId, referenceId, pointsPaid, createdAt, reason = '') {
            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.id = `verify-order-detail-${orderId}`;
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            detailOverlay.innerHTML = this.buildWalletOrderLoadingMarkup(window.i18n?.t('wallet.loading') || '加载中...');

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
                const taskType = this.resolveVerifyTaskType(reason, payload);
                const displayName = this.getVerifyDisplayName(reason, payload);
                const serviceTypeText = this.getVerifyTaskTypeLabel(reason, payload);
                const generatedLink = String(payload?.url || '').trim();
                const errorMessage = String(payload?.error_message || '').trim();
                const resultMessage = String(payload?.message || '').trim()
                    || (taskType === 'full'
                        ? (window.i18n?.t('wallet.verifyFullSuccess') || '包绑卡流程已完成')
                        : (generatedLink ? (window.i18n?.t('wallet.generatedLink') || '生成链接') : (window.i18n?.t('wallet.linkUnavailable') || '暂未获取到链接')));
                const orderTimeText = this.formatOrderDateTime(createdAt);
                const completedTimeText = verifyLog?.created_at ? this.formatOrderDateTime(verifyLog.created_at) : '';
                const shortOrderId = orderId ? `${orderId.substring(0, 8)}...${orderId.slice(-4)}` : '--';
                const shortTaskId = taskId ? `${taskId.substring(0, 8)}...${taskId.slice(-4)}` : '--';
                const safeLink = this.escapeHtml(generatedLink);

                const modal = detailOverlay.querySelector('.wallet-order-modal');
                if (!modal) return;

                this.markWalletOrderModalReady(modal);

                modal.innerHTML = `
                    <div class="wallet-order-modal-header">
                        <div class="wallet-order-modal-title">
                            ${this.renderWalletInlineIcon('fa-key', '#6b9ece')} ${this.escapeHtml(displayName)}
                        </div>
                    </div>
                    <div class="wallet-order-modal-body wallet-order-modal-body--fade">
                        <div class="meta-section">
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                <span class="detail-val mono copyable js-copy-verify-order" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${this.escapeHtml(shortOrderId)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.taskNumber') || '任务编号'}</span>
                                <span class="detail-val mono ${taskId ? 'copyable ' : ''}js-copy-verify-task" title="${taskId ? (window.i18n?.t('wallet.clickToCopy') || '点击复制') : ''}">${this.escapeHtml(shortTaskId || '--')}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.productType') || '商品类型'}</span>
                                <span class="detail-val ${this.getWalletToneClass(taskType === 'full' ? '#f59e0b' : '#6b9ece')}">${this.escapeHtml(serviceTypeText)}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">${window.i18n?.t('wallet.googleAccount') || 'Google 账号'}</span>
                                <span class="detail-val ${accountEmail !== '--' ? 'copyable ' : ''}js-copy-verify-email" title="${accountEmail !== '--' ? (window.i18n?.t('wallet.clickToCopy') || '点击复制') : ''}">${this.escapeHtml(accountEmail)}</span>
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
                                <span class="detail-val ${this.getWalletToneClass(statusMeta.color)}">${statusMeta.prefix ? `${statusMeta.prefix} ` : ''}${this.escapeHtml(statusMeta.text)}</span>
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
                            <div class="content-card wallet-copy-card wallet-copy-card--link js-copy-verify-link-card" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">
                                <div class="item-content-box item-content-box--plain">
                                    <div class="item-text item-text--left item-text--sky">${safeLink}</div>
                                </div>
                            </div>
                        </div>
                        ` : `
                        <div class="content-section">
                            <div class="content-section-title">${taskType === 'full' ? (window.i18n?.t('wallet.executionResult') || '执行结果') : (window.i18n?.t('wallet.generatedLink') || '生成链接')}</div>
                            <div class="content-card content-card--compact">
                                <div class="item-content-box item-content-box--plain">
                                    <div class="item-text item-text--left ${errorMessage ? 'item-text--danger' : 'item-text--muted'}">
                                        ${this.escapeHtml(errorMessage || resultMessage)}
                                    </div>
                                </div>
                            </div>
                        </div>
                        `}
                    </div>
                `;

                this.bindOverlayCloseButtons(detailOverlay);
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
            // 🚀 STEP 1: Show skeleton modal INSTANTLY (no await)
            const detailOverlay = document.createElement('div');
            detailOverlay.className = 'wallet-order-modal-overlay';
            detailOverlay.id = `order-detail-${orderId}`;
            detailOverlay.onclick = (e) => {
                if (e.target === detailOverlay) detailOverlay.remove();
            };

            // Skeleton HTML - shows immediately with loading animation
            const t = (key, fallback) => window.i18n?.t(key) || fallback;
            const previewOrder = this.findShopOrderPreview(orderId);
            detailOverlay.innerHTML = previewOrder
                ? this.buildWalletShopOrderPreviewMarkup(orderId, previewOrder)
                : this.buildWalletOrderLoadingMarkup(t('wallet.loading', '加载详情...'), {
                    modalClass: 'wallet-order-modal--shop-detail'
                });

            // 🚀 Append skeleton immediately - user sees modal in ~0ms
            document.body.appendChild(detailOverlay);

            // 🚀 STEP 2: Load data in background
            try {
                const pointsService = window.PointsService;
                if (!pointsService?.getWalletShopOrderDetail) {
                    throw new Error('PointsService shop order detail API not available');
                }

                const detail = pointsService?.peekWalletShopOrderDetail?.({ orderId })
                    || await pointsService.getWalletShopOrderDetail({ orderId });

                // Check if modal was closed while loading
                if (!document.getElementById(`order-detail-${orderId}`)) return;
                const order = detail?.order && typeof detail.order === 'object' ? detail.order : null;
                if (!order) {
                    detailOverlay.remove();
                    this.showToast(window.i18n?.t('wallet.orderNotFound') || '订单不存在', 'error');
                    return;
                }

                const contentFallback = window.i18n?.t('wallet.contentLoadFailed') || '内容加载失败';
                const items = Array.isArray(detail?.items)
                    ? detail.items.map((item) => {
                        const rawContent = String(item?.content || '');
                        return {
                            name: this.getLocalizedProductNameFromPayload(item, this.getLocalizedProductNameFromPayload(order, '')),
                            content: rawContent.trim() ? rawContent : contentFallback,
                            price: Number(item?.price ?? 0) || 0
                        };
                    })
                    : [];

                const dateStr = this.formatOrderDateTime(order.created_at);
                const totalPrice = order.total_price != null ? order.total_price : order.price_paid;
                const productName = items.length > 0 ? items[0].name : this.getLocalizedProductNameFromPayload(order, '');
                const productId = String(order.product_id || '').trim();
                const purchaseNotes = typeof detail?.guidance?.purchase_notes === 'string'
                    ? detail.guidance.purchase_notes.trim()
                    : '';
                const usageInstructions = typeof detail?.guidance?.usage_instructions === 'string'
                    ? detail.guidance.usage_instructions.trim()
                    : '';
                const guidanceItems = [
                    purchaseNotes
                        ? {
                            key: 'notes',
                            tone: 'notice',
                            label: window.i18n?.t('shop.purchaseNotes') || '注意事项',
                            content: purchaseNotes
                        }
                        : null,
                    usageInstructions
                        ? {
                            key: 'usage',
                            tone: 'usage',
                            label: window.i18n?.t('shop.usageInstructions') || '使用说明',
                            content: usageInstructions
                        }
                        : null
                ].filter(Boolean);
                const guidanceTogglesMarkup = guidanceItems.length
                    ? `
                            <div class="wallet-order-guidance-toggles" aria-label="${this.escapeAttribute(window.i18n?.t('wallet.orderDetails') || '订单说明')}">
                                ${guidanceItems.map((item) => `
                                    <button class="wallet-order-guidance-toggle js-wallet-toggle-guidance wallet-order-guidance-toggle--${this.escapeAttribute(item.tone || item.key)}" type="button" data-wallet-guidance-panel="${this.escapeAttribute(item.key)}" aria-expanded="false">
                                        ${this.escapeHtml(item.label)}
                                    </button>
                                `).join('')}
                            </div>
                        `
                    : '';
                const guidancePanelsMarkup = guidanceItems.length
                    ? `
                            <div class="wallet-order-guidance-panels">
                                ${guidanceItems.map((item) => `
                                    <section class="wallet-order-guidance-panel js-wallet-guidance-panel" data-wallet-guidance-panel="${this.escapeAttribute(item.key)}" hidden>
                                        <div class="wallet-order-guidance-panel-title">${this.escapeHtml(item.label)}</div>
                                        <div class="wallet-order-guidance-content">${this.renderStoredWalletOrderRichText(item.content)}</div>
                                    </section>
                                `).join('')}
                            </div>
                        `
                    : '';

                // Determine if items are short enough to display side-by-side
                const isShortKeys = items.every(item => item.content.length <= 40 && !item.content.includes('\n'));
                const gridClass = items.length > 1 && isShortKeys
                    ? 'wallet-content-grid wallet-content-grid--double'
                    : 'wallet-content-grid wallet-content-grid--stacked';

                const contentHtml = `<div class="${gridClass}">` + items.map((item) => {
                    const encodedContent = this.encodeActionValue(item.content);
                    return `
                    <div class="content-card wallet-copy-card wallet-copy-card--compact js-wallet-copy-content" data-wallet-copy-content="${this.escapeAttribute(encodedContent)}" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">
                        <div class="item-content-box item-content-box--plain">
                            <div class="item-text item-text--center">${this.escapeHtml(item.content)}</div>
                        </div>
                    </div>
                `;
                }).join('') + `</div>`;

                // Format: product name once at top, then all content items
                const allContentItems = items.length > 0
                    ? items.map(i => i.content).join('\n')
                    : (window.i18n?.t('shop.noContent') || '（无内容）');
                const allContent = productName ? `${productName}:\n${allContentItems}` : allContentItems;
                const orderNumberLabel = window.i18n?.t('wallet.orderNumber') || '订单编号';
                const orderTimeLabel = window.i18n?.t('wallet.orderTime') || '下单时间';
                const exportOrderContent = () => {
                    const blob = new Blob([`${orderNumberLabel}: ${order.id}\n${orderTimeLabel}: ${dateStr}\n\n${allContent}`], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `order_${order.id.split('-')[0]}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                };
                const copyAllOrderContent = () => {
                    navigator.clipboard.writeText(allContent).then(() => {
                        this.showToast(`✅ ${window.i18n?.t('wallet.copiedAll') || '已复制全部内容'}`, 'success');
                    }).catch(() => this.showToast(window.i18n?.t('wallet.copyFailed') || '复制失败', 'error'));
                };

                // 🚀 STEP 4: Replace skeleton with real content (smooth transition)
                const modal = detailOverlay.querySelector('.wallet-order-modal');
                if (modal) {
                    const orderDetailMarkup = `
                        <div class="wallet-order-modal-header">
                            <div class="wallet-order-modal-title">
                                ${this.renderWalletInlineIcon('fa-box-open', '#6b9ece')} ${window.i18n?.t('wallet.orderDetails') || '订单详情'}
                            </div>
                        </div>
                        <div class="wallet-order-modal-body wallet-order-modal-body--fade">
                            <div class="meta-section">
                                <div class="detail-row">
                                    <span class="detail-label">${window.i18n?.t('wallet.orderNumber') || '订单编号'}</span>
                                    <span class="detail-val mono copyable js-wallet-copy-shop-order" title="${window.i18n?.t('wallet.clickToCopy') || '点击复制'}">${order.id.split('-')[0]}...${order.id.slice(-4)}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">${window.i18n?.t('wallet.orderTime') || '下单时间'}</span>
                                    <span class="detail-val">${dateStr}</span>
                                </div>
                                <div class="detail-row">
                                    <span class="detail-label">${window.i18n?.t('wallet.pointsPaid') || '支付积分'}</span>
                                    <span class="detail-val highlight">-${totalPrice} ${window.i18n?.t('wallet.pointsUnit') || '积分'}</span>
                                </div>
                                ${productName ? `
                                    <div class="detail-row wallet-detail-row--product">
                                        <span class="detail-label">${window.i18n?.t('shop.productName') || '商品名称'}</span>
                                        ${productId ? `
                                        <button type="button" class="detail-val mono copyable wallet-order-product-name wallet-detail-link js-wallet-open-shop-product" data-wallet-product-id="${this.escapeAttribute(this.encodeActionValue(productId))}" title="打开商品详情">
                                            ${this.escapeHtml(productName)}
                                        </button>
                                        ` : `
                                        <span class="detail-val wallet-order-product-name">${this.escapeHtml(productName)}</span>
                                        `}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="wallet-order-detail-toolbar">
                                ${guidanceTogglesMarkup}
                                <div class="modal-actions wallet-modal-actions--toolbar">
                                    <button class="action-btn-minimal wallet-order-action-btn wallet-order-action-btn-copy js-wallet-copy-all" title="${window.i18n?.t('wallet.copyAll') || '全部复制'}">
                                        <i class="fas fa-copy"></i>
                                    </button>
                                    <button class="action-btn-minimal wallet-order-action-btn wallet-order-action-btn-neutral js-wallet-export-order" title="${window.i18n?.t('wallet.export') || '导出'}">
                                        <i class="fas fa-download"></i>
                                    </button>
                                    <button class="action-btn-minimal wallet-order-action-btn wallet-order-action-btn-danger js-wallet-open-ticket" title="${window.i18n?.t('wallet.submitTicket') || '提交工单'}" aria-label="${window.i18n?.t('wallet.submitTicket') || '提交工单'}">
                                        <i class="fas fa-exclamation-circle"></i>
                                    </button>
                                </div>
                            </div>
                            ${guidancePanelsMarkup}
                            <div class="content-section">
                                <div class="content-section-title">${window.i18n?.t('wallet.purchaseContent') || '购买内容'} (${items.length})</div>
                                ${contentHtml}
                            </div>
                        </div>
                    `;

                    const didRender = await this.replaceWalletOrderModalContent(modal, orderDetailMarkup);
                    if (!didRender) return;

                    this.bindOverlayCloseButtons(detailOverlay);
                    modal.querySelector('.js-wallet-copy-shop-order')?.addEventListener('click', (event) => {
                        this.copyToClipboard(order.id, event);
                    });
                    modal.querySelectorAll('.js-wallet-copy-content').forEach((card) => {
                        card.addEventListener('click', (event) => {
                            this.copyToClipboard(this.decodeActionValue(card.dataset.walletCopyContent), event);
                        });
                    });
                    modal.querySelector('.js-wallet-copy-all')?.addEventListener('click', () => {
                        copyAllOrderContent();
                    });
                    modal.querySelector('.js-wallet-export-order')?.addEventListener('click', () => {
                        exportOrderContent();
                    });
                    modal.querySelector('.js-wallet-open-ticket')?.addEventListener('click', () => {
                        this.openTicketModal(order.id);
                    });
                    modal.querySelector('.js-wallet-open-shop-product')?.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.openShopProductFromWalletDetail(
                            this.decodeActionValue(event.currentTarget?.dataset?.walletProductId || ''),
                            detailOverlay
                        );
                    });
                    modal.querySelectorAll('.js-wallet-toggle-guidance').forEach((button) => {
                        button.addEventListener('click', () => {
                            const panelKey = String(button.dataset.walletGuidancePanel || '').trim();
                            const wasExpanded = button.getAttribute('aria-expanded') === 'true';

                            modal.querySelectorAll('.js-wallet-toggle-guidance').forEach((toggle) => {
                                toggle.setAttribute('aria-expanded', 'false');
                            });
                            modal.querySelectorAll('.js-wallet-guidance-panel').forEach((panel) => {
                                panel.hidden = true;
                            });

                            if (!wasExpanded && panelKey) {
                                button.setAttribute('aria-expanded', 'true');
                                const panel = Array.from(modal.querySelectorAll('.js-wallet-guidance-panel'))
                                    .find((candidate) => candidate.dataset.walletGuidancePanel === panelKey);
                                if (panel) panel.hidden = false;
                            }
                        });
                    });
                }
            } catch (err) {
                console.error('[WalletModal] Show order detail failed:', err);
                // Remove skeleton and show error
                if (document.getElementById(`order-detail-${orderId}`)) {
                    detailOverlay.remove();
                }
                this.showToast(
                    err?.status === 404
                        ? (window.i18n?.t('wallet.orderNotFound') || '订单不存在')
                        : (window.i18n?.t('wallet.orderDetailFailed') || '加载订单详情失败'),
                    'error'
                );
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
         * Escape HTML to prevent XSS
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        linkifyWalletOrderRichText(text) {
            return String(text || '').replace(
                /(https?:\/\/[^\s<]+)/g,
                '<a href="$1" target="_blank" rel="noopener noreferrer" class="shop-rich-link">$1</a>'
            );
        },

        looksLikeWalletOrderRichTextHtml(content) {
            return /<\/?(?:a|b|strong|i|em|u|div|p|br|font|span|ul|ol|li)\b/i.test(content || '');
        },

        decodeWalletOrderHtmlEntities(content) {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = String(content || '');
            return textarea.value;
        },

        sanitizeWalletOrderRichTextHtml(html) {
            const template = document.createElement('template');
            template.innerHTML = html;

            const allowedTags = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'FONT', 'UL', 'OL', 'LI']);
            const allowedTextAlign = /^(left|center|right|justify)$/i;
            const allowedFontSize = /^([1-7]|\d+(\.\d+)?(px|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large)$/i;

            const sanitizeStyle = (styleText = '') => {
                const safeRules = [];
                String(styleText || '').split(';').forEach((rule) => {
                    const [rawProp, rawValue] = rule.split(':');
                    if (!rawProp || !rawValue) return;

                    const prop = rawProp.trim().toLowerCase();
                    const value = rawValue.trim().replace(/\s*!important$/i, '');

                    if (prop === 'text-align' && allowedTextAlign.test(value)) {
                        safeRules.push(`text-align: ${value.toLowerCase()}`);
                    }
                    if (prop === 'font-size' && allowedFontSize.test(value)) {
                        safeRules.push(`font-size: ${value}`);
                    }
                });

                return safeRules.join('; ');
            };

            const sanitizeHref = (href = '') => {
                const value = String(href || '').trim();
                return /^https?:\/\//i.test(value) ? value : '';
            };

            const sanitizeChildren = (parent) => {
                Array.from(parent.childNodes).forEach((child) => {
                    if (child.nodeType === Node.COMMENT_NODE) {
                        child.remove();
                        return;
                    }

                    if (child.nodeType !== Node.ELEMENT_NODE) {
                        return;
                    }

                    if (!allowedTags.has(child.tagName)) {
                        while (child.firstChild) {
                            parent.insertBefore(child.firstChild, child);
                        }
                        child.remove();
                        sanitizeChildren(parent);
                        return;
                    }

                    const attrs = {};
                    Array.from(child.attributes).forEach((attr) => {
                        attrs[attr.name.toLowerCase()] = attr.value;
                    });
                    Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));

                    if (['DIV', 'P', 'SPAN'].includes(child.tagName)) {
                        const safeStyle = sanitizeStyle(attrs.style || '');
                        if (safeStyle) {
                            child.setAttribute('style', safeStyle);
                        }
                    }

                    if (child.tagName === 'FONT') {
                        const size = String(attrs.size || '').trim();
                        if (allowedFontSize.test(size)) {
                            child.setAttribute('size', size);
                        }
                    }

                    if (child.tagName === 'A') {
                        const safeHref = sanitizeHref(attrs.href || '');
                        if (!safeHref) {
                            while (child.firstChild) {
                                parent.insertBefore(child.firstChild, child);
                            }
                            child.remove();
                            sanitizeChildren(parent);
                            return;
                        }

                        child.setAttribute('href', safeHref);
                        child.setAttribute('target', '_blank');
                        child.setAttribute('rel', 'noopener noreferrer');
                        child.classList.add('shop-rich-link');
                    }

                    sanitizeChildren(child);
                });
            };

            sanitizeChildren(template.content);
            return template.innerHTML;
        },

        renderStoredWalletOrderRichText(content) {
            const normalized = typeof content === 'string' ? content.trim() : '';
            if (!normalized) return '';

            const decoded = /&(?:lt|gt|quot|amp|#39|apos);/i.test(normalized)
                ? this.decodeWalletOrderHtmlEntities(normalized).trim()
                : normalized;
            if (decoded && decoded !== normalized && this.looksLikeWalletOrderRichTextHtml(decoded)) {
                return this.sanitizeWalletOrderRichTextHtml(decoded);
            }

            if (!this.looksLikeWalletOrderRichTextHtml(normalized)) {
                return this.linkifyWalletOrderRichText(this.escapeHtml(normalized)).replace(/\n/g, '<br>');
            }

            return this.sanitizeWalletOrderRichTextHtml(normalized);
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
