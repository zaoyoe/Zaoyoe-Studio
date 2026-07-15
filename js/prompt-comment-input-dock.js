(function (global) {
    'use strict';

    const STATE_IDLE = 'idle';
    const STATE_FOCUSING = 'focusing';
    const STATE_VISIBLE = 'visible';
    const STATE_DISMISSING = 'dismissing';

    const KEYBOARD_RETURN_THRESHOLD = 24;
    const KEYBOARD_DESCENT_DELTA = 4;
    const OPENING_STABLE_MS = 80;
    const OPENING_TIMEOUT_MS = 1200;
    const BLUR_GUARD_MS = 260;
    const DISMISS_GUARD_MS = 1200;

    const ROOT_LOCK_PROPERTIES = ['overflow', 'overscroll-behavior'];
    const BODY_LOCK_PROPERTIES = [
        'width',
        'overflow',
        'overscroll-behavior'
    ];

    function clampViewportNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
    }

    function captureInlineStyles(element, properties) {
        const style = element?.style;
        if (!style) return [];
        return properties.map((property) => ({
            property,
            value: style.getPropertyValue(property),
            priority: style.getPropertyPriority(property)
        }));
    }

    function restoreInlineStyles(element, snapshot) {
        const style = element?.style;
        if (!style) return;
        snapshot.forEach(({ property, value, priority }) => {
            if (value) style.setProperty(property, value, priority);
            else style.removeProperty(property);
        });
    }

    class PromptCommentInputDock {
        constructor(options = {}) {
            this.options = options;
            this.state = STATE_IDLE;
            this.root = null;
            this.panel = null;
            this.meta = null;
            this.input = null;
            this.baselineHeight = 0;
            this.baselineBottom = 0;
            this.baselineWidth = 0;
            this.openingViewportHeight = 0;
            this.maxKeyboardInset = 0;
            this.keyboardSeen = false;
            this.openingStartedAt = 0;
            this.openingCandidateFrame = null;
            this.openingCandidateSince = 0;
            this.openViewportHeight = 0;
            this.viewportFrame = 0;
            this.blurGuardTimer = 0;
            this.dismissGuardTimer = 0;
            this.listenersAttached = false;
            this.pageScrollLock = null;
            this.appliedViewport = null;

            this.handleViewportChange = this.handleViewportChange.bind(this);
            this.handleInput = this.handleInput.bind(this);
            this.handleBlur = this.handleBlur.bind(this);
            this.handleKeydown = this.handleKeydown.bind(this);
            this.handleOrientationChange = this.handleOrientationChange.bind(this);
        }

        isActive() {
            return this.state !== STATE_IDLE;
        }

        getPageScrollPosition() {
            let supplied = null;
            try {
                supplied = this.options.getScrollPosition?.() || null;
            } catch (_) {
                supplied = null;
            }
            const fallbackX = clampViewportNumber(global.scrollX ?? global.pageXOffset, 0);
            const fallbackY = clampViewportNumber(global.scrollY ?? global.pageYOffset, 0);
            return {
                x: clampViewportNumber(supplied?.x, fallbackX),
                y: clampViewportNumber(supplied?.y, fallbackY)
            };
        }

        lockPageScroll() {
            if (this.pageScrollLock) return;
            const root = document.documentElement;
            const body = document.body;
            if (!root?.style || !body?.style) return;

            const { x, y } = this.getPageScrollPosition();
            this.pageScrollLock = {
                x,
                y,
                rootStyles: captureInlineStyles(root, ROOT_LOCK_PROPERTIES),
                bodyStyles: captureInlineStyles(body, BODY_LOCK_PROPERTIES)
            };

            root.style.setProperty('overflow', 'hidden', 'important');
            root.style.setProperty('overscroll-behavior', 'none', 'important');
            body.style.setProperty('width', '100%', 'important');
            body.style.setProperty('overflow', 'hidden', 'important');
            body.style.setProperty('overscroll-behavior', 'none', 'important');
        }

        unlockPageScroll() {
            const lock = this.pageScrollLock;
            if (!lock) return;
            this.pageScrollLock = null;

            restoreInlineStyles(document.body, lock.bodyStyles);
            restoreInlineStyles(document.documentElement, lock.rootStyles);
            global.scrollTo?.(lock.x, lock.y);
        }

        getViewportFrame() {
            const viewport = global.visualViewport || null;
            const top = clampViewportNumber(viewport?.offsetTop, 0);
            const visualHeight = clampViewportNumber(viewport?.height, 0);
            const innerHeight = clampViewportNumber(global.innerHeight, 0);
            const height = Math.max(1, visualHeight && innerHeight
                ? Math.min(visualHeight, innerHeight)
                : (visualHeight || innerHeight || 1));
            const width = Math.max(1, clampViewportNumber(
                viewport?.width,
                clampViewportNumber(document.documentElement?.clientWidth, 1)
            ));
            const bottom = top + height;
            const layoutHeight = Math.max(
                height,
                bottom,
                clampViewportNumber(global.innerHeight, 0),
                clampViewportNumber(document.documentElement?.clientHeight, 0)
            );

            return { top, height, width, bottom, layoutHeight };
        }

        captureBaseline(frame, force = false) {
            const widthChanged = this.baselineWidth > 0 && Math.abs(this.baselineWidth - frame.width) > 24;
            if (force || widthChanged || this.baselineHeight <= 0) {
                this.baselineHeight = frame.layoutHeight;
                this.baselineBottom = Math.max(frame.bottom, frame.layoutHeight);
                this.baselineWidth = frame.width;
                return;
            }

            this.baselineHeight = Math.max(this.baselineHeight, frame.height, frame.layoutHeight);
            this.baselineBottom = Math.max(this.baselineBottom, frame.bottom, frame.layoutHeight);
        }

        getKeyboardInset(frame) {
            return Math.max(
                0,
                this.baselineHeight - frame.height,
                this.baselineBottom - frame.bottom,
                this.openingViewportHeight - frame.height
            );
        }

        mount() {
            if (this.root?.isConnected && this.input) return;

            const root = document.createElement('div');
            root.id = this.options.rootId || 'promptCommentInputDock';
            root.className = 'prompt-comment-input-dock';
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');

            const panel = document.createElement('div');
            panel.className = 'prompt-comment-input-dock__panel';

            const meta = document.createElement('div');
            meta.id = this.options.metaId || 'promptCommentInputDockMeta';
            meta.className = 'prompt-comment-input-dock__meta';

            const input = document.createElement('textarea');
            input.id = this.options.inputId || 'promptCommentInputDockField';
            input.className = 'prompt-comment-input-dock__field';
            input.rows = 1;
            input.placeholder = this.options.placeholder || '';
            input.setAttribute('aria-label', this.options.placeholder || 'Comment');

            panel.append(meta, input);
            root.appendChild(panel);
            document.body.appendChild(root);

            this.root = root;
            this.panel = panel;
            this.meta = meta;
            this.input = input;

            input.addEventListener('input', this.handleInput);
            input.addEventListener('blur', this.handleBlur);
            input.addEventListener('keydown', this.handleKeydown);
        }

        attachViewportListeners() {
            if (this.listenersAttached) return;
            const viewport = global.visualViewport;
            viewport?.addEventListener('resize', this.handleViewportChange, { passive: true });
            viewport?.addEventListener('scroll', this.handleViewportChange, { passive: true });
            global.addEventListener('resize', this.handleViewportChange, { passive: true });
            global.addEventListener('orientationchange', this.handleOrientationChange, { passive: true });
            this.listenersAttached = true;
        }

        detachViewportListeners() {
            if (!this.listenersAttached) return;
            const viewport = global.visualViewport;
            viewport?.removeEventListener('resize', this.handleViewportChange);
            viewport?.removeEventListener('scroll', this.handleViewportChange);
            global.removeEventListener('resize', this.handleViewportChange);
            global.removeEventListener('orientationchange', this.handleOrientationChange);
            this.listenersAttached = false;
            if (this.viewportFrame) {
                global.cancelAnimationFrame?.(this.viewportFrame);
                this.viewportFrame = 0;
            }
        }

        handleOrientationChange() {
            this.baselineHeight = 0;
            this.baselineBottom = 0;
            this.baselineWidth = 0;
            this.close({ immediate: true, blur: true, reason: 'orientation-change' });
        }

        handleViewportChange() {
            if (!this.isActive()) return;
            this.syncViewport();
        }

        scheduleViewportSync() {
            if (!this.isActive() || this.viewportFrame) return;
            const run = () => {
                this.viewportFrame = 0;
                this.syncViewport();
            };
            this.viewportFrame = global.requestAnimationFrame?.(run) || global.setTimeout?.(run, 16) || 0;
        }

        applyViewport(frame) {
            if (!this.root) return;
            const previous = this.appliedViewport;
            const topChanged = !previous || previous.top !== frame.top;
            const heightChanged = !previous || previous.height !== frame.height;

            if (topChanged) {
                this.root.style.setProperty('--prompt-comment-input-top', `${frame.top}px`);
            }
            if (heightChanged) {
                this.root.style.setProperty('--prompt-comment-input-height', `${frame.height}px`);
            }
            if (!topChanged && !heightChanged) return;

            this.appliedViewport = {
                top: frame.top,
                height: frame.height
            };
            this.options.onViewportChange?.(frame, this);
        }

        setState(nextState) {
            if (this.state === nextState) return;
            this.state = nextState;
            this.root?.classList.toggle('is-focusing', nextState === STATE_FOCUSING);
            this.root?.classList.toggle('is-visible', nextState === STATE_VISIBLE);
            this.root?.classList.toggle('is-dismissing', nextState === STATE_DISMISSING);
            this.options.onStateChange?.(nextState, this);
        }

        syncViewport() {
            if (!this.isActive() || !this.root) return;
            const frame = this.getViewportFrame();
            this.applyViewport(frame);
            const keyboardInset = this.getKeyboardInset(frame);
            const keyboardThreshold = Math.max(
                32,
                Math.round(this.baselineHeight * 0.05)
            );
            const keyboardVisible = this.baselineHeight - frame.height >= keyboardThreshold;
            this.maxKeyboardInset = Math.max(this.maxKeyboardInset, keyboardInset);

            if (this.state === STATE_FOCUSING) {
                const openingExpired = Date.now() - this.openingStartedAt >= OPENING_TIMEOUT_MS;
                const minimumPlausibleHeight = Math.max(320, Math.round(this.baselineHeight * 0.42));
                if (!keyboardVisible || frame.height < minimumPlausibleHeight) {
                    this.openingCandidateFrame = null;
                    this.openingCandidateSince = 0;
                    if (openingExpired) {
                        this.close({ immediate: true, blur: true, reason: 'opening-timeout' });
                        return;
                    }
                    this.scheduleViewportSync();
                    return;
                }

                const geometryStable = this.openingCandidateFrame
                    && Math.abs(this.openingCandidateFrame.height - frame.height) <= 4
                    && Math.abs(this.openingCandidateFrame.top - frame.top) <= 2;
                if (!geometryStable) this.openingCandidateSince = Date.now();
                this.openingCandidateFrame = { top: frame.top, height: frame.height };
                if (!this.openingCandidateSince
                    || Date.now() - this.openingCandidateSince < OPENING_STABLE_MS) {
                    this.scheduleViewportSync();
                    return;
                }

                this.keyboardSeen = true;
                this.clearBlurGuard();
                this.openViewportHeight = frame.height;
                this.setState(STATE_VISIBLE);
                this.scheduleViewportSync();
                return;
            }

            if (this.state === STATE_VISIBLE) {
                if (this.openViewportHeight > 0 && frame.height < this.openViewportHeight) {
                    this.openViewportHeight = frame.height;
                }
                const keyboardIsDescending = this.openViewportHeight > 0
                    && frame.height >= this.openViewportHeight + KEYBOARD_DESCENT_DELTA;
                if (this.keyboardSeen && (keyboardIsDescending || !keyboardVisible)) {
                    this.beginDismiss({ blur: false, reason: 'viewport' });
                    return;
                }
                this.scheduleViewportSync();
                return;
            }

            if (this.state === STATE_DISMISSING
                && keyboardInset <= KEYBOARD_RETURN_THRESHOLD
                && frame.top <= 2) {
                this.finalizeDismiss();
                return;
            }
            if (this.state === STATE_DISMISSING) this.scheduleViewportSync();
        }

        syncHeight() {
            if (!this.input) return;
            this.input.style.height = 'auto';
            this.input.style.height = `${Math.min(190, Math.max(104, this.input.scrollHeight || 0))}px`;
        }

        setMeta(text = '') {
            if (!this.meta) return;
            const value = String(text || '').trim();
            this.meta.textContent = value;
            this.meta.classList.toggle('has-content', Boolean(value));
        }

        setPlaceholder(value = '') {
            this.options.placeholder = value;
            if (!this.input) return;
            this.input.placeholder = value;
            this.input.setAttribute('aria-label', value || 'Comment');
        }

        setValue(value = '', data = {}) {
            this.mount();
            this.input.value = String(value || '');
            ['replyTo', 'replyToName'].forEach((key) => {
                if (data[key]) this.input.dataset[key] = data[key];
                else delete this.input.dataset[key];
            });
            this.syncHeight();
        }

        focusInput() {
            if (!this.input) return false;
            try {
                this.input.focus({ preventScroll: true });
            } catch (_) {
                this.input.focus();
            }
            return document.activeElement === this.input;
        }

        open(payload = {}) {
            this.mount();
            if (!this.root || !this.input) return false;

            const wasIdle = this.state === STATE_IDLE;
            this.clearAllGuards();
            if (wasIdle) {
                const frame = this.getViewportFrame();
                this.captureBaseline(frame);
                this.lockPageScroll();
                this.options.onSessionStart?.(this);
                this.root.hidden = false;
                this.root.setAttribute('aria-hidden', 'false');
                this.root.classList.add('is-mounted');
                this.attachViewportListeners();
                this.applyViewport(frame);
            }

            const openingFrame = this.getViewportFrame();
            this.openingViewportHeight = openingFrame.height;

            if (payload.placeholder !== undefined) this.setPlaceholder(payload.placeholder);
            this.setValue(payload.value ?? this.input.value, {
                replyTo: payload.replyTo,
                replyToName: payload.replyToName
            });
            this.setMeta(payload.meta || '');
            this.maxKeyboardInset = 0;
            this.keyboardSeen = false;
            this.openingStartedAt = Date.now();
            this.openingCandidateFrame = null;
            this.openingCandidateSince = 0;
            this.openViewportHeight = 0;
            this.setState(STATE_FOCUSING);

            if (!this.focusInput()) {
                this.finalizeDismiss();
                return false;
            }

            const caret = this.input.value.length;
            this.input.setSelectionRange(caret, caret);
            this.scheduleViewportSync();
            return true;
        }

        handleInput() {
            this.syncHeight();
            this.options.onInput?.(this.input.value, this.input, this);
        }

        handleKeydown(event) {
            this.options.onKeydown?.(event, this.input, this);
        }

        handleBlur() {
            if (this.state === STATE_VISIBLE) {
                this.beginDismiss({ blur: false, reason: 'blur' });
                return;
            }
            if (this.state !== STATE_FOCUSING) return;
            this.clearBlurGuard();
            this.blurGuardTimer = global.setTimeout?.(() => {
                this.blurGuardTimer = 0;
                if (this.state !== STATE_FOCUSING || document.activeElement === this.input) return;
                const frame = this.getViewportFrame();
                if (this.getKeyboardInset(frame) >= KEYBOARD_OPEN_THRESHOLD) {
                    this.keyboardSeen = true;
                    this.beginDismiss({ blur: false, reason: 'focus-lost-after-keyboard' });
                    return;
                }
                this.close({ immediate: true, blur: false, reason: 'focus-lost' });
            }, BLUR_GUARD_MS) || 0;
        }

        beginDismiss({ blur = true, reason = 'close' } = {}) {
            if (this.state === STATE_IDLE) return false;
            if (this.state !== STATE_DISMISSING) {
                this.options.onBeforeDismiss?.(this.input, reason, this);
                this.setState(STATE_DISMISSING);
            }
            this.clearBlurGuard();
            if (blur && document.activeElement === this.input) this.input.blur();

            this.clearDismissGuard();
            this.dismissGuardTimer = global.setTimeout?.(() => {
                this.dismissGuardTimer = 0;
                if (this.state === STATE_DISMISSING) this.finalizeDismiss();
            }, DISMISS_GUARD_MS) || 0;
            this.scheduleViewportSync();
            return true;
        }

        close({ immediate = false, blur = true, reason = 'close' } = {}) {
            if (this.state === STATE_IDLE) return false;
            if (immediate) {
                this.options.onBeforeDismiss?.(this.input, reason, this);
                if (blur && document.activeElement === this.input) this.input.blur();
                this.finalizeDismiss();
                return true;
            }
            return this.beginDismiss({ blur, reason });
        }

        finalizeDismiss() {
            if (
                this.state === STATE_IDLE
                && !this.root?.classList.contains('is-mounted')
                && !this.pageScrollLock
            ) return;
            this.clearAllGuards();
            this.detachViewportListeners();
            this.state = STATE_IDLE;
            this.keyboardSeen = false;
            this.maxKeyboardInset = 0;
            this.openingStartedAt = 0;
            this.openingCandidateFrame = null;
            this.openingCandidateSince = 0;
            this.openViewportHeight = 0;
            this.appliedViewport = null;

            if (this.root) {
                this.root.hidden = true;
                this.root.setAttribute('aria-hidden', 'true');
                this.root.classList.remove('is-mounted', 'is-focusing', 'is-visible', 'is-dismissing');
                this.root.style.removeProperty('--prompt-comment-input-top');
                this.root.style.removeProperty('--prompt-comment-input-height');
            }

            this.unlockPageScroll();
            this.options.onSessionEnd?.(this);
            this.options.onStateChange?.(STATE_IDLE, this);
        }

        clearBlurGuard() {
            if (!this.blurGuardTimer) return;
            global.clearTimeout?.(this.blurGuardTimer);
            this.blurGuardTimer = 0;
        }

        clearDismissGuard() {
            if (!this.dismissGuardTimer) return;
            global.clearTimeout?.(this.dismissGuardTimer);
            this.dismissGuardTimer = 0;
        }

        clearAllGuards() {
            this.clearBlurGuard();
            this.clearDismissGuard();
        }

        destroy() {
            this.close({ immediate: true, blur: true, reason: 'destroy' });
            this.unlockPageScroll();
            this.input?.removeEventListener('input', this.handleInput);
            this.input?.removeEventListener('blur', this.handleBlur);
            this.input?.removeEventListener('keydown', this.handleKeydown);
            this.root?.remove();
            this.root = null;
            this.panel = null;
            this.meta = null;
            this.input = null;
        }
    }

    global.PromptCommentInputDock = PromptCommentInputDock;
}(window));
