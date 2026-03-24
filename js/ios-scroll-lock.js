/**
 * iOS Safari Scroll Lock Utility
 * 
 * 解决 iOS Safari 上弹窗打开期间（尤其是键盘弹出时）背景页面跟随滚动的问题。
 * 
 * 原理：
 *   - 仅 overflow:hidden 在 iOS Safari 上不足以阻止 body 滚动
 *   - 必须使用 position:fixed + top 偏移来完全锁定 body
 *   - 同时拦截 touchmove 事件，防止弹窗内可滚动区域到达边界后"穿透"到背景
 *   - 监听 visualViewport 变化来检测键盘收起，并在键盘收起时自动回位
 * 
 * 用法：
 *   window.iOSScrollLock.lock(modalElement)   // 打开弹窗时调用
 *   window.iOSScrollLock.unlock()             // 关闭弹窗时调用
 */
(function () {
    'use strict';

    let savedScrollY = 0;
    let isLocked = false;
    let isLightLock = false;
    let viewportCleanup = null;
    let scrollCleanup = null;
    let currentModal = null;
    let touchStartY = 0;
    let lastTouchY = 0;

    function setFixedBodyLockOffset() {
        document.body.style['setProperty']('--ios-scroll-lock-offset', `-${savedScrollY}px`);
    }

    function clearFixedBodyLockOffset() {
        document.body.style['removeProperty']('--ios-scroll-lock-offset');
    }

    function applyFixedBodyLock() {
        document.body.classList.add('ios-scroll-lock-fixed');
        setFixedBodyLockOffset();
        document.documentElement.classList.add('no-scroll');
        document.body.classList.add('no-scroll');
    }

    function clearFixedBodyLock() {
        clearFixedBodyLockOffset();
        document.body.classList.remove('ios-scroll-lock-fixed');
        document.documentElement.classList.remove('no-scroll');
        document.body.classList.remove('no-scroll');
    }

    function attachRootScrollGuard() {
        if (typeof scrollCleanup === 'function') return;

        const handleRootScroll = () => {
            if (!isLocked || isLightLock) return;
            stabilizeLockedViewport();
        };

        window.addEventListener('scroll', handleRootScroll, { passive: true });
        scrollCleanup = () => {
            window.removeEventListener('scroll', handleRootScroll);
            scrollCleanup = null;
        };
    }

    function getPortaledInputProxy(el) {
        if (!el || !currentModal) return null;

        const canonicalInput = el.closest?.('[data-auth-canonical-input][data-auth-proxy-source]');
        if (!canonicalInput || !canonicalInput.closest('#authInputPlane')) {
            return null;
        }

        const sourceId = canonicalInput.getAttribute('data-auth-proxy-source');
        if (!sourceId) return null;

        return currentModal.querySelector(`[data-auth-proxy-for="${sourceId}"]`);
    }

    function isFocusedFieldInsideCurrentModal() {
        const active = document.activeElement;
        if (!active || !currentModal || !/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
            return false;
        }

        if (currentModal.contains(active)) {
            return true;
        }

        return !!getPortaledInputProxy(active);
    }

    function shouldObserveViewportChanges() {
        return !!(
            currentModal &&
            currentModal.classList &&
            !currentModal.classList.contains('login-overlay')
        );
    }

    function shouldSkipLockedViewportStabilization() {
        return !!(
            currentModal &&
            currentModal.classList &&
            (
                currentModal.classList.contains('poetry-modal')
            ) &&
            isFocusedFieldInsideCurrentModal()
        );
    }

    function stabilizeLockedViewport() {
        if (!isLocked || isLightLock) return;

        // Keep body anchored at the original page position while lock is active.
        setFixedBodyLockOffset();

        if (shouldSkipLockedViewportStabilization()) {
            return;
        }

        // iOS may still mutate the root scroll offset when keyboard opens; pin it back.
        if ((window.scrollY || window.pageYOffset || 0) !== 0) {
            window.scrollTo(0, 0);
        }
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }

    /**
     * 检测是否为 iOS 移动端 WebKit
     */
    function isIOSMobile() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isIOS;
    }

    /**
     * 查找触摸点所在的最近可滚动祖先元素（在 modal 内部）
     */
    function findScrollableParent(el) {
        if (!el || !currentModal) return null;
        let node = getPortaledInputProxy(el) || el;
        while (node && node !== document.body) {
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY;
            // 元素可滚动 且 内容超出容器
            if ((overflowY === 'auto' || overflowY === 'scroll') &&
                node.scrollHeight > node.clientHeight) {
                return node;
            }
            // Stop at modal boundary
            if (node === currentModal) break;
            node = node.parentElement;
        }
        return null;
    }

    /**
     * touchstart 记录起始位置
     */
    function handleTouchStart(e) {
        if (!isLocked) return;
        touchStartY = e.touches[0].clientY;
        lastTouchY = touchStartY;
    }

    /**
     * touchmove 核心：阻止滚动穿透
     * - 如果触摸点不在 modal 内 → 阻止
     * - 如果触摸点在 modal 内但没有可滚动容器 → 阻止
     * - 如果触摸点在可滚动容器内，但已到达滚动边界 → 阻止
     * - 否则 → 允许（让弹窗内容正常滚动）
     */
    function handleTouchMove(e) {
        if (!isLocked) return;

        // 如果没有设置 modal 元素，阻止所有滚动
        if (!currentModal) {
            e.preventDefault();
            return;
        }

        const target = e.target;
        const portaledProxy = getPortaledInputProxy(target);

        // 触摸点不在弹窗内，且也不是映射到弹窗内代理输入框的真实输入 → 阻止
        if (!currentModal.contains(target) && !portaledProxy) {
            e.preventDefault();
            return;
        }

        // === Explicit Textarea/Input Handling ===
        // If the input itself is scrollable (e.g. a textarea), keep boundary guards on the input.
        // Plain inputs should be allowed to pass the gesture through so their scrollable parent
        // (such as the auth sheet body) can continue handling vertical scrolling.
        const inputEl = target.closest('textarea, input');
        if (inputEl && !portaledProxy) {
            if (Math.ceil(inputEl.scrollHeight) > Math.ceil(inputEl.clientHeight) + 2) {
                const touchY = e.touches[0].clientY;
                const deltaY = touchStartY - touchY;
                const atTop = inputEl.scrollTop <= 0;
                const atBottom = inputEl.scrollTop + inputEl.clientHeight >= inputEl.scrollHeight - 2;

                if (atTop && deltaY < 0) {
                    e.preventDefault(); // Trying to pull down at top
                } else if (atBottom && deltaY > 0) {
                    e.preventDefault(); // Trying to push up at bottom
                } else {
                    e.stopPropagation(); // Safe native scrolling area
                }
                return;
            }
        }

        // 在弹窗内，寻找最近的可滚动容器
        const scrollable = findScrollableParent(target);

        // 没有可滚动容器 → 阻止（弹窗本身不可滚动的区域）
        if (!scrollable) {
            e.preventDefault();
            return;
        }

        // 有可滚动容器，检查是否到达滚动边界
        const touchY = e.touches[0].clientY;
        const deltaY = touchStartY - touchY; // 正 = 向上滚, 负 = 向下滚
        const deltaStep = lastTouchY - touchY;
        lastTouchY = touchY;
        const { scrollTop, scrollHeight, clientHeight } = scrollable;

        const atTop = scrollTop <= 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1; // 1px 容差

        // 到达顶部还想向下拉 → 阻止
        if (atTop && deltaY < 0) {
            e.preventDefault();
            return;
        }

        // 到达底部还想向上推 → 阻止
        if (atBottom && deltaY > 0) {
            e.preventDefault();
            return;
        }

        if (portaledProxy) {
            if (deltaStep !== 0) {
                scrollable.scrollTop += deltaStep;
            }
            e.preventDefault();
            return;
        }

        // 正常滚动 → 允许
    }

    /**
     * 锁定背景滚动
     * @param {HTMLElement} [modalElement] - 可选，弹窗元素，用于 iOS 键盘检测
     */
    function lock(modalElement, options = {}) {
        const freezeScrollY = Number.isFinite(options?.freezeScrollY)
            ? Math.max(0, Math.round(options.freezeScrollY))
            : null;

        if (isLocked) {
            currentModal = modalElement || currentModal;

            if (isLightLock) {
                if (freezeScrollY !== null) {
                    savedScrollY = freezeScrollY;
                }
                applyFixedBodyLock();
                isLightLock = false;
                stabilizeLockedViewport();
                attachRootScrollGuard();
            }

            if (isIOSMobile() && shouldObserveViewportChanges()) {
                detachViewportListener();
                attachViewportListener();
            }
            return;
        }

        // 1. 保存当前滚动位置
        savedScrollY = freezeScrollY !== null
            ? freezeScrollY
            : (window.scrollY || window.pageYOffset || 0);

        // 2. 给 body 设置 position:fixed 并偏移 top 来「冻结」页面
        applyFixedBodyLock();

        isLocked = true;
        isLightLock = false;
        currentModal = modalElement || null;

        stabilizeLockedViewport();

        // 4. 添加 touchmove 拦截，防止滚动穿透（scroll chaining）
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });

        attachRootScrollGuard();

        // 5. iOS 专属：监听 visualViewport 变化，检测键盘收起后回位
        if (isIOSMobile() && shouldObserveViewportChanges()) {
            attachViewportListener();
        }
    }

    /**
     * 轻量锁定（不使用 position:fixed，保留 backdrop-filter 透明效果）
     * 适用于不需要键盘输入的弹窗（如商城兑换弹窗）
     * @param {HTMLElement} [modalElement] - 弹窗元素
     */
    function lockLight(modalElement) {
        if (isLocked) {
            currentModal = modalElement || currentModal;
            if (isIOSMobile() && shouldObserveViewportChanges()) {
                detachViewportListener();
                attachViewportListener();
            }
            return;
        }

        savedScrollY = window.scrollY || window.pageYOffset || 0;

        // 只对非 iOS 设备应用 overflow:hidden，iOS 下使用这招会导致页面被强行裁切并在底部留下巨大黑块
        if (!isIOSMobile()) {
            document.documentElement.classList.add('no-scroll');
            document.body.classList.add('no-scroll');
        }

        isLocked = true;
        isLightLock = true;
        currentModal = modalElement || null;

        // 添加 touchmove 拦截
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });

        // iOS 专属：监听 visualViewport 变化，暴露键盘事件
        if (isIOSMobile() && shouldObserveViewportChanges()) {
            attachViewportListener();
        }
    }

    /**
     * 解锁背景滚动，恢复到原始位置
     */
    function unlock() {
        if (!isLocked) return;

        // 1. 清理 viewport 监听器
        detachViewportListener();
        if (typeof scrollCleanup === 'function') {
            scrollCleanup();
        }

        // 2. 移除 touchmove 拦截
        document.removeEventListener('touchstart', handleTouchStart);
        document.removeEventListener('touchmove', handleTouchMove);

        // 3. 移除 body 上的锁定样式（仅 full lock 模式下需要）
        if (!isLightLock) {
            const scrollY = savedScrollY;
            clearFixedBodyLock();

            isLocked = false;
            isLightLock = false;
            currentModal = null;

            // 恢复滚动位置
            window.scrollTo(0, scrollY);
        } else {
            // Light lock: 只移除 overflow hidden
            document.documentElement.classList.remove('no-scroll');
            document.body.classList.remove('no-scroll');

            isLocked = false;
            isLightLock = false;
            currentModal = null;
        }
    }

    /**
     * 附加 visualViewport 监听器（iOS 键盘收起检测）
     * 当键盘收起且无输入框聚焦时，自动做一次 scroll 回位
     */
    function attachViewportListener() {
        if (!window.visualViewport) return;

        const baseHeight = window.visualViewport.height;

        const handleViewportChange = () => {
            if (!isLocked || !currentModal) return;

            stabilizeLockedViewport();

            // 检查当前是否有输入框正在聚焦
            const inField = isFocusedFieldInsideCurrentModal();

            // 键盘已收起（viewport 恢复到接近原始高度）且没有输入框聚焦
            if (!inField && window.visualViewport.height >= baseHeight - 2) {
                // 重新对齐 body 的 top 值，防止键盘操作后产生的偏移
                setFixedBodyLockOffset();
            }
        };

        window.visualViewport.addEventListener('resize', handleViewportChange, { passive: true });
        window.visualViewport.addEventListener('scroll', handleViewportChange, { passive: true });

        viewportCleanup = () => {
            window.visualViewport.removeEventListener('resize', handleViewportChange);
            window.visualViewport.removeEventListener('scroll', handleViewportChange);
            viewportCleanup = null;
        };
    }

    /**
     * 移除 visualViewport 监听器
     */
    function detachViewportListener() {
        if (typeof viewportCleanup === 'function') {
            viewportCleanup();
        }
    }

    // 暴露为全局对象
    window.iOSScrollLock = {
        lock: lock,
        lockLight: lockLight,
        unlock: unlock,
        /** 检查当前是否处于锁定状态 */
        get isLocked() { return isLocked; }
    };

    /**
     * ⚡ Universal iOS Focus Lock for ALL modals
     * Adds 'ios-focus-lock' class to modal overlays when an input inside
     * gains focus, which flattens transforms to prevent caret misplacement.
     * Works via event delegation so dynamically injected modals are covered.
     */
    if (isIOSMobile()) {
        document.addEventListener('focusin', (e) => {
            const target = e.target;
            if (!target || !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

            const modal = target.closest('.modal-overlay, .poetry-modal, .auth-sheet-overlay');
            if (modal?.id === 'profileModal') return;
            if (modal) {
                modal.classList.add('ios-focus-lock');
            }
        }, true);

        document.addEventListener('focusout', (e) => {
            const target = e.target;
            if (!target || !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

            const modal = target.closest('.modal-overlay, .poetry-modal, .auth-sheet-overlay');
            if (modal?.id === 'profileModal') return;
            if (modal) {
                // Delay removal to avoid flickering when focus moves between inputs
                setTimeout(() => {
                    if (!modal.contains(document.activeElement) ||
                        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
                        modal.classList.remove('ios-focus-lock');
                    }
                }, 150);
            }
        }, true);
    }
})();
