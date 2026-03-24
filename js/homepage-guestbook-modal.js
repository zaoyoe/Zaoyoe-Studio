(function () {
    'use strict';

    const GUESTBOOK_KEYBOARD_SETTLE_MS = 90;
    const GUESTBOOK_MODAL_STYLE_DECL_KEY = 'style';
    const guestbookModalKeyboardState = {
        baseScrollY: 0,
        ownsFullScrollLock: false,
        viewportCleanup: null,
        viewportRafId: null,
        stableViewportProbe: null,
        overlayBaseHeight: 0,
        baseViewportHeight: 0,
        baseCardHeight: 0,
        docked: false,
        lastBottomInset: 0,
        initialDockTimer: null,
        insetDropTimer: null,
        pendingInset: 0,
        entryAnimationTimer: null,
        sheetAnimationTimer: null,
        focusSettleTimer: null
    };

    function setGuestbookModalRuntimeStyles(target, styles = {}, priority = '') {
        if (!target || !styles || typeof styles !== 'object') {
            return;
        }

        const styleDecl = Reflect.get(target, GUESTBOOK_MODAL_STYLE_DECL_KEY);
        if (!styleDecl) {
            return;
        }

        Object.entries(styles).forEach(([name, value]) => {
            if (value === null || value === undefined || value === '') {
                styleDecl.removeProperty(name);
            } else {
                styleDecl.setProperty(name, String(value), priority);
            }
        });
    }

    function isGuestbookModalKeyboardDockEnabled() {
        const ua = navigator.userAgent || '';
        const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isiOS && window.matchMedia('(max-width: 768px)').matches && Boolean(window.visualViewport);
    }

    function getGuestbookModalElements() {
        const overlay = document.getElementById('guestbookModal');
        return {
            overlay,
            card: overlay?.querySelector('.guestbook-content, .modal-content') || null,
            inputs: overlay ? Array.from(overlay.querySelectorAll('input, textarea, select')) : []
        };
    }

    function getActiveGuestbookModalInput() {
        const { overlay } = getGuestbookModalElements();
        const active = document.activeElement;
        if (!overlay || !active || !overlay.contains(active)) {
            return null;
        }
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
    }

    function syncGuestbookComposerEmptyState() {
        const { overlay } = getGuestbookModalElements();
        if (!overlay) {
            return;
        }

        const input = document.getElementById('guestMessage');
        const editor = overlay.querySelector('.guestbook-composer-editor');
        if (!input || !editor) {
            return;
        }

        editor.classList.toggle('is-empty', !input.value.trim());
    }

    function syncGuestbookComposerImageState() {
        const { overlay } = getGuestbookModalElements();
        if (!overlay) {
            return;
        }

        const uploadBtn = overlay.querySelector('#guestbookComposerUploadBtn');
        const imagePreview = document.getElementById('imagePreview');
        const hasImage = Boolean(
            imagePreview
            && !imagePreview.hidden
            && !imagePreview.classList.contains('guestbook-composer-preview-hidden')
            && !imagePreview.classList.contains('index-guestbook-image-preview-hidden')
        );
        uploadBtn?.classList.toggle('has-image', hasImage);
    }

    function resetGuestbookComposerAnimationStyles() {
        return;
    }

    function syncGuestbookModalHitTargets(isOpen) {
        const { overlay, card } = getGuestbookModalElements();
        if (!overlay || !card) {
            return;
        }

        const interactive = Boolean(isOpen);
        overlay.setAttribute('aria-hidden', interactive ? 'false' : 'true');
        overlay.classList.toggle('guestbook-modal-interactive', interactive);
    }

    function focusGuestbookInputWithoutScroll(input) {
        if (!input) {
            return;
        }
        prepareGuestbookModalForInputFocus();
        try {
            input.focus({ preventScroll: true });
        } catch (error) {
            input.focus();
        }
    }

    function prepareGuestbookModalForInputFocus() {
        const { overlay, card } = getGuestbookModalElements();
        if (!overlay) {
            return;
        }

        clearGuestbookEntryAnimationTimer();
        clearGuestbookSheetAnimationTimer();
        overlay.classList.remove('guestbook-entrying');
        card?.classList.remove('guestbook-sheet-animating');
        captureGuestbookModalOverlayBaseHeight(true);
        setGuestbookKeyboardSettling(true);
    }

    function getGuestbookStableViewportProbe() {
        if (guestbookModalKeyboardState.stableViewportProbe?.isConnected) {
            return guestbookModalKeyboardState.stableViewportProbe;
        }

        const probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.className = 'guestbook-modal-viewport-probe';
        document.body.appendChild(probe);
        guestbookModalKeyboardState.stableViewportProbe = probe;
        return probe;
    }

    function getGuestbookStableViewportHeight() {
        const probe = getGuestbookStableViewportProbe();
        return Math.max(0, Math.round(probe.getBoundingClientRect().height || probe.offsetHeight || 0));
    }

    function captureGuestbookModalOverlayBaseHeight(force = false) {
        const { overlay } = getGuestbookModalElements();
        if (!overlay) {
            return;
        }

        const vv = window.visualViewport;
        const visualFrameHeight = Math.max(
            0,
            Math.round((vv?.height || 0) + (vv?.offsetTop || 0))
        );
        const stableViewportHeight = getGuestbookStableViewportHeight();
        const fallbackHeight = Math.max(
            Math.round(window.innerHeight || 0),
            Math.round(document.documentElement.clientHeight || 0),
            Math.round(vv?.height || 0)
        );
        const measuredHeight = visualFrameHeight || stableViewportHeight || fallbackHeight;

        if (!measuredHeight) {
            return;
        }
        if (!force && guestbookModalKeyboardState.overlayBaseHeight === measuredHeight) {
            return;
        }

        guestbookModalKeyboardState.overlayBaseHeight = measuredHeight;
        setGuestbookModalRuntimeStyles(overlay, {
            '--guestbook-modal-overlay-height': `${measuredHeight}px`
        });
    }

    function restoreGuestbookModalOverlayBaseHeight() {
        const { overlay } = getGuestbookModalElements();
        if (!overlay) {
            return;
        }

        guestbookModalKeyboardState.overlayBaseHeight = 0;
        setGuestbookModalRuntimeStyles(overlay, {
            '--guestbook-modal-overlay-height': ''
        });
    }

    function clearGuestbookModalKeyboardTimers() {
        if (guestbookModalKeyboardState.initialDockTimer) {
            clearTimeout(guestbookModalKeyboardState.initialDockTimer);
            guestbookModalKeyboardState.initialDockTimer = null;
        }
        if (guestbookModalKeyboardState.insetDropTimer) {
            clearTimeout(guestbookModalKeyboardState.insetDropTimer);
            guestbookModalKeyboardState.insetDropTimer = null;
        }
        guestbookModalKeyboardState.pendingInset = 0;
    }

    function clearGuestbookEntryAnimationTimer() {
        if (guestbookModalKeyboardState.entryAnimationTimer) {
            clearTimeout(guestbookModalKeyboardState.entryAnimationTimer);
            guestbookModalKeyboardState.entryAnimationTimer = null;
        }
    }

    function clearGuestbookSheetAnimationTimer() {
        if (guestbookModalKeyboardState.sheetAnimationTimer) {
            clearTimeout(guestbookModalKeyboardState.sheetAnimationTimer);
            guestbookModalKeyboardState.sheetAnimationTimer = null;
        }
    }

    function clearGuestbookFocusSettleTimer() {
        if (guestbookModalKeyboardState.focusSettleTimer) {
            clearTimeout(guestbookModalKeyboardState.focusSettleTimer);
            guestbookModalKeyboardState.focusSettleTimer = null;
        }
    }

    function setGuestbookKeyboardSettling(active) {
        const { overlay } = getGuestbookModalElements();
        if (!overlay) {
            return;
        }

        clearGuestbookFocusSettleTimer();
        overlay.classList.toggle('keyboard-settling', Boolean(active));

        if (!active) {
            return;
        }

        guestbookModalKeyboardState.focusSettleTimer = setTimeout(() => {
            overlay.classList.remove('keyboard-settling');
            guestbookModalKeyboardState.focusSettleTimer = null;
        }, 420);
    }

    function playGuestbookComposerEntryAnimation(overlay) {
        if (!overlay) {
            return;
        }

        clearGuestbookEntryAnimationTimer();
        overlay.classList.remove('guestbook-entrying');
        void overlay.offsetWidth;
        overlay.classList.add('guestbook-entrying');

        guestbookModalKeyboardState.entryAnimationTimer = setTimeout(() => {
            overlay.classList.remove('guestbook-entrying');
            guestbookModalKeyboardState.entryAnimationTimer = null;
        }, 760);
    }

    function toggleGuestbookSheetAnimation(card, animate) {
        if (!card) {
            return;
        }

        clearGuestbookSheetAnimationTimer();
        card.classList.toggle('guestbook-sheet-animating', Boolean(animate));

        if (!animate) {
            return;
        }

        guestbookModalKeyboardState.sheetAnimationTimer = setTimeout(() => {
            card.classList.remove('guestbook-sheet-animating');
            guestbookModalKeyboardState.sheetAnimationTimer = null;
        }, 260);
    }

    function captureGuestbookModalKeyboardBase() {
        const vv = window.visualViewport;
        const { card } = getGuestbookModalElements();
        const visualHeight = Math.max(0, vv?.height || 0);
        const fallbackBaseHeight = Math.max(
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            visualHeight
        );
        const stableViewportHeight = getGuestbookStableViewportHeight();
        const normalizedBaseHeight = Math.max(
            guestbookModalKeyboardState.overlayBaseHeight || 0,
            (stableViewportHeight > 0 && stableViewportHeight + 24 < fallbackBaseHeight)
                ? stableViewportHeight
                : fallbackBaseHeight
        );

        guestbookModalKeyboardState.baseViewportHeight = normalizedBaseHeight;
        if (card) {
            const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 420);
            guestbookModalKeyboardState.baseCardHeight = Math.max(320, liveHeight || 420);
        }
    }

    function getGuestbookModalViewportMetrics() {
        const vv = window.visualViewport;
        const visualHeight = Math.max(0, vv?.height || 0);
        const baseVisualHeight = guestbookModalKeyboardState.baseViewportHeight || visualHeight;

        return {
            visualHeight,
            baseVisualHeight,
            bottomInset: Math.max(0, Math.round(baseVisualHeight - visualHeight))
        };
    }

    function lockGuestbookModalKeyboardPage() {
        if (guestbookModalKeyboardState.ownsFullScrollLock || !window.iOSScrollLock) {
            return;
        }
        const { card } = getGuestbookModalElements();
        if (!card) {
            return;
        }

        window.iOSScrollLock.lock(card, {
            freezeScrollY: Math.max(0, Math.round(
                guestbookModalKeyboardState.baseScrollY || window.scrollY || window.pageYOffset || 0
            ))
        });
        guestbookModalKeyboardState.ownsFullScrollLock = true;
    }

    function bindGuestbookModalInputFocusStabilizer(input) {
        if (!input || input.dataset.guestbookFocusStabilizerBound === '1') {
            return;
        }

        input.addEventListener('touchstart', (event) => {
            const { overlay } = getGuestbookModalElements();
            if (!isGuestbookModalKeyboardDockEnabled() || !overlay?.classList.contains('active')) {
                return;
            }
            lockGuestbookModalKeyboardPage();
            if (event.cancelable) {
                event.preventDefault();
            }
            focusGuestbookInputWithoutScroll(input);
        }, { passive: false });

        input.dataset.guestbookFocusStabilizerBound = '1';
    }

    function applyGuestbookModalKeyboardDock(bottomInset, animate = false) {
        const { overlay, card } = getGuestbookModalElements();
        if (!overlay || !card) {
            return;
        }

        clearGuestbookEntryAnimationTimer();
        overlay.classList.remove('guestbook-entrying');
        overlay.classList.add('keyboard-docked');

        const metrics = getGuestbookModalViewportMetrics();
        if (!guestbookModalKeyboardState.baseCardHeight) {
            const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 420);
            guestbookModalKeyboardState.baseCardHeight = Math.max(320, liveHeight || 420);
        }

        const baseCardHeight = Math.max(320, guestbookModalKeyboardState.baseCardHeight || 420);
        const baseViewportHeight = Math.max(
            metrics.baseVisualHeight || 0,
            guestbookModalKeyboardState.baseViewportHeight || 0
        );
        const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
        const minTop = 12;
        const maxAvailableHeight = Math.max(260, Math.round(keyboardTop - minTop - 12));
        const finalCardHeight = Math.min(baseCardHeight, maxAvailableHeight);
        const desiredTop = Math.max(minTop, keyboardTop - 12 - finalCardHeight);
        const centeredTop = (baseViewportHeight - finalCardHeight) / 2;
        const shiftY = Math.round(desiredTop - centeredTop);

        setGuestbookModalRuntimeStyles(overlay, {
            '--guestbook-modal-translate-y': `${shiftY}px`
        });
        setGuestbookModalRuntimeStyles(card, {
            '--guestbook-modal-card-height': `${finalCardHeight}px`,
            '--guestbook-modal-card-max-height': `${finalCardHeight}px`
        });
        toggleGuestbookSheetAnimation(card, animate);
        setGuestbookKeyboardSettling(Boolean(animate));
        guestbookModalKeyboardState.docked = bottomInset > 0;
        guestbookModalKeyboardState.lastBottomInset = Math.max(0, bottomInset);
    }

    function releaseGuestbookModalKeyboardDock(animate = false) {
        const { overlay, card } = getGuestbookModalElements();
        if (!overlay || !card) {
            return;
        }

        overlay.classList.remove('keyboard-docked');
        setGuestbookModalRuntimeStyles(overlay, {
            '--guestbook-modal-translate-y': '0px'
        });
        setGuestbookModalRuntimeStyles(card, {
            '--guestbook-modal-card-height': '',
            '--guestbook-modal-card-max-height': ''
        });
        toggleGuestbookSheetAnimation(card, animate);
        if (!getActiveGuestbookModalInput()) {
            setGuestbookKeyboardSettling(false);
        }
        guestbookModalKeyboardState.docked = false;
        guestbookModalKeyboardState.lastBottomInset = 0;
    }

    function resetGuestbookModalKeyboardState() {
        clearGuestbookModalKeyboardTimers();
        if (guestbookModalKeyboardState.viewportRafId) {
            cancelAnimationFrame(guestbookModalKeyboardState.viewportRafId);
            guestbookModalKeyboardState.viewportRafId = null;
        }
        releaseGuestbookModalKeyboardDock(false);
        guestbookModalKeyboardState.baseViewportHeight = 0;
        guestbookModalKeyboardState.baseCardHeight = 0;
        setGuestbookKeyboardSettling(false);
    }

    function syncGuestbookModalKeyboardDock() {
        const { overlay, card } = getGuestbookModalElements();
        if (!overlay || !card || !overlay.classList.contains('active')) {
            resetGuestbookModalKeyboardState();
            return;
        }

        if (!isGuestbookModalKeyboardDockEnabled()) {
            captureGuestbookModalOverlayBaseHeight(true);
            releaseGuestbookModalKeyboardDock(false);
            return;
        }

        const activeInput = getActiveGuestbookModalInput();
        if (!activeInput && !guestbookModalKeyboardState.docked) {
            captureGuestbookModalOverlayBaseHeight(true);
        }
        if (activeInput && !guestbookModalKeyboardState.ownsFullScrollLock) {
            lockGuestbookModalKeyboardPage();
        }

        const metrics = getGuestbookModalViewportMetrics();
        const bottomInset = metrics.bottomInset;
        const shouldDock = Boolean(activeInput) && (guestbookModalKeyboardState.docked ? bottomInset > 8 : bottomInset > 24);
        const nextInset = shouldDock ? bottomInset : 0;
        const previousInset = guestbookModalKeyboardState.lastBottomInset;
        const isInsetDroppingWhileFocused = guestbookModalKeyboardState.docked
            && Boolean(activeInput)
            && nextInset > 24
            && nextInset + 24 < previousInset;

        if (!guestbookModalKeyboardState.docked && shouldDock) {
            lockGuestbookModalKeyboardPage();
            guestbookModalKeyboardState.pendingInset = nextInset;
            if (!guestbookModalKeyboardState.initialDockTimer) {
                guestbookModalKeyboardState.initialDockTimer = setTimeout(() => {
                    guestbookModalKeyboardState.initialDockTimer = null;
                    if (!getActiveGuestbookModalInput()) {
                        return;
                    }
                    const liveMetrics = getGuestbookModalViewportMetrics();
                    if (liveMetrics.bottomInset <= 24) {
                        return;
                    }
                    applyGuestbookModalKeyboardDock(liveMetrics.bottomInset, true);
                }, GUESTBOOK_KEYBOARD_SETTLE_MS);
            }
            return;
        }

        if (guestbookModalKeyboardState.initialDockTimer
            && (guestbookModalKeyboardState.docked || !shouldDock)) {
            clearTimeout(guestbookModalKeyboardState.initialDockTimer);
            guestbookModalKeyboardState.initialDockTimer = null;
        }

        if (guestbookModalKeyboardState.insetDropTimer
            && (!isInsetDroppingWhileFocused || nextInset >= previousInset)) {
            clearTimeout(guestbookModalKeyboardState.insetDropTimer);
            guestbookModalKeyboardState.insetDropTimer = null;
            guestbookModalKeyboardState.pendingInset = 0;
        }

        if (isInsetDroppingWhileFocused) {
            guestbookModalKeyboardState.pendingInset = nextInset;
            if (!guestbookModalKeyboardState.insetDropTimer) {
                guestbookModalKeyboardState.insetDropTimer = setTimeout(() => {
                    guestbookModalKeyboardState.insetDropTimer = null;
                    const settledInset = guestbookModalKeyboardState.pendingInset;
                    guestbookModalKeyboardState.pendingInset = 0;
                    if (settledInset > 24) {
                        applyGuestbookModalKeyboardDock(settledInset, true);
                    }
                }, GUESTBOOK_KEYBOARD_SETTLE_MS);
            }
            return;
        }

        if (guestbookModalKeyboardState.docked && activeInput && nextInset <= 24) {
            return;
        }

        if (nextInset > 24) {
            applyGuestbookModalKeyboardDock(nextInset, true);
            return;
        }

        if (guestbookModalKeyboardState.docked) {
            releaseGuestbookModalKeyboardDock(!activeInput && previousInset > 0);
        }
    }

    function attachGuestbookModalKeyboardDock() {
        if (!isGuestbookModalKeyboardDockEnabled()) {
            return;
        }

        const { overlay, inputs } = getGuestbookModalElements();
        const vv = window.visualViewport;
        if (!overlay || !vv) {
            return;
        }

        detachGuestbookModalKeyboardDock();
        captureGuestbookModalKeyboardBase();
        syncGuestbookModalKeyboardDock();

        inputs.forEach((input) => bindGuestbookModalInputFocusStabilizer(input));

        const handleViewportChange = () => {
            if (guestbookModalKeyboardState.viewportRafId) {
                return;
            }
            guestbookModalKeyboardState.viewportRafId = requestAnimationFrame(() => {
                guestbookModalKeyboardState.viewportRafId = null;
                syncGuestbookModalKeyboardDock();
            });
        };

        vv.addEventListener('resize', handleViewportChange, { passive: true });
        vv.addEventListener('scroll', handleViewportChange, { passive: true });
        inputs.forEach((input) => {
            input.addEventListener('focus', handleViewportChange);
            input.addEventListener('blur', handleViewportChange);
        });

        guestbookModalKeyboardState.viewportCleanup = () => {
            vv.removeEventListener('resize', handleViewportChange);
            vv.removeEventListener('scroll', handleViewportChange);
            inputs.forEach((input) => {
                input.removeEventListener('focus', handleViewportChange);
                input.removeEventListener('blur', handleViewportChange);
            });
            if (guestbookModalKeyboardState.viewportRafId) {
                cancelAnimationFrame(guestbookModalKeyboardState.viewportRafId);
                guestbookModalKeyboardState.viewportRafId = null;
            }
            guestbookModalKeyboardState.viewportCleanup = null;
        };
    }

    function detachGuestbookModalKeyboardDock() {
        if (typeof guestbookModalKeyboardState.viewportCleanup === 'function') {
            guestbookModalKeyboardState.viewportCleanup();
        }
        clearGuestbookModalKeyboardTimers();
    }

    const guestbookInput = document.getElementById('guestMessage');
    const guestbookEditor = document.getElementById('guestbookComposerEditor');
    const guestbookModal = document.getElementById('guestbookModal');
    const guestbookSheet = guestbookModal?.querySelector('.guestbook-composer-sheet');

    if (!guestbookModal) {
        return;
    }

    guestbookInput?.addEventListener('input', syncGuestbookComposerEmptyState);
    guestbookInput?.addEventListener('focus', () => {
        prepareGuestbookModalForInputFocus();
        syncGuestbookComposerEmptyState();
    });
    guestbookInput?.addEventListener('blur', () => {
        setGuestbookKeyboardSettling(false);
        syncGuestbookComposerEmptyState();
    });
    guestbookEditor?.addEventListener('click', (event) => {
        if (!guestbookInput) {
            return;
        }
        if (event.target instanceof HTMLElement && event.target.closest('button, a')) {
            return;
        }
        focusGuestbookInputWithoutScroll(guestbookInput);
    });
    syncGuestbookComposerEmptyState();
    syncGuestbookComposerImageState();

    window.syncGuestbookComposerEmptyState = syncGuestbookComposerEmptyState;
    window.syncGuestbookComposerImageState = syncGuestbookComposerImageState;

    window.closeGuestbookModal = function () {
        const { overlay } = getGuestbookModalElements();
        if (!overlay) {
            return;
        }

        getActiveGuestbookModalInput()?.blur();
        detachGuestbookModalKeyboardDock();
        resetGuestbookModalKeyboardState();
        clearGuestbookEntryAnimationTimer();
        clearGuestbookSheetAnimationTimer();
        clearGuestbookFocusSettleTimer();
        overlay.classList.remove('active', 'keyboard-docked', 'ios-focus-lock', 'guestbook-entrying', 'keyboard-settling');
        setGuestbookModalRuntimeStyles(overlay, {
            '--guestbook-modal-translate-y': '0px'
        });
        overlay.querySelector('.guestbook-composer-sheet')?.classList.remove('guestbook-sheet-animating');
        restoreGuestbookModalOverlayBaseHeight();
        syncGuestbookComposerEmptyState();
        syncGuestbookComposerImageState();

        if (window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        } else {
            document.documentElement.classList.remove('no-scroll');
            document.body.classList.remove('no-scroll');
        }

        guestbookModalKeyboardState.ownsFullScrollLock = false;
        guestbookModalKeyboardState.baseScrollY = 0;
        overlay._overlayDown = false;
        syncGuestbookModalHitTargets(false);
    };

    window.openGuestbookModal = function () {
        const modal = document.getElementById('guestbookModal');
        if (!modal) {
            return;
        }

        guestbookModalKeyboardState.baseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
        guestbookModalKeyboardState.ownsFullScrollLock = false;
        detachGuestbookModalKeyboardDock();
        resetGuestbookModalKeyboardState();
        clearGuestbookEntryAnimationTimer();
        clearGuestbookSheetAnimationTimer();
        clearGuestbookFocusSettleTimer();
        modal.classList.remove('keyboard-docked', 'ios-focus-lock', 'guestbook-entrying', 'keyboard-settling');
        setGuestbookModalRuntimeStyles(modal, {
            '--guestbook-modal-translate-y': '0px'
        });
        modal.querySelector('.guestbook-composer-sheet')?.classList.remove('guestbook-sheet-animating');
        syncGuestbookComposerEmptyState();
        syncGuestbookComposerImageState();
        resetGuestbookComposerAnimationStyles();

        modal.classList.remove('active');
        void modal.offsetWidth;
        modal.classList.add('active');
        modal._overlayDown = false;
        captureGuestbookModalOverlayBaseHeight(true);
        playGuestbookComposerEntryAnimation(modal);
        syncGuestbookModalHitTargets(true);

        if (window.iOSScrollLock) {
            window.iOSScrollLock.lockLight(modal);
        } else {
            document.documentElement.classList.add('no-scroll');
            document.body.classList.add('no-scroll');
        }

        attachGuestbookModalKeyboardDock();

        if (typeof window._prefetchGuestbook === 'function') {
            window._prefetchGuestbook();
        }
        syncGuestbookComposerEmptyState();
        syncGuestbookComposerImageState();
    };

    const swallowGuestbookSheetEvent = (event) => {
        event.stopPropagation();
    };

    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((eventName) => {
        guestbookSheet?.addEventListener(eventName, swallowGuestbookSheetEvent);
    });

    guestbookModal.addEventListener('mousedown', function (event) {
        if (event.target === this) {
            this._overlayDown = true;
        }
    });

    guestbookModal.addEventListener('mouseup', function (event) {
        if (event.target === this && this._overlayDown) {
            window.closeGuestbookModal?.();
        }
        this._overlayDown = false;
    });

    syncGuestbookModalHitTargets(false);
}());
