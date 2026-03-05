/**
 * iOS Safari Scroll Lock Utility
 * 
 * 解决 iOS Safari 上弹窗打开期间（尤其是键盘弹出时）背景页面跟随滚动的问题。
 * 
 * 原理：
 *   - 仅 overflow:hidden 在 iOS Safari 上不足以阻止 body 滚动
 *   - 必须使用 position:fixed + top 偏移来完全锁定 body
 *   - 同时监听 visualViewport 变化来检测键盘收起，并在键盘收起时自动回位
 * 
 * 用法：
 *   window.iOSScrollLock.lock(modalElement)   // 打开弹窗时调用
 *   window.iOSScrollLock.unlock()             // 关闭弹窗时调用
 */
(function () {
    'use strict';

    let savedScrollY = 0;
    let isLocked = false;
    let viewportCleanup = null;
    let currentModal = null;

    /**
     * 检测是否为 iOS 移动端 WebKit
     */
    function isIOSMobile() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isIOS;
    }

    /**
     * 锁定背景滚动
     * @param {HTMLElement} [modalElement] - 可选，弹窗元素，用于 iOS 键盘检测
     */
    function lock(modalElement) {
        if (isLocked) return;

        // 1. 保存当前滚动位置
        savedScrollY = window.scrollY || window.pageYOffset || 0;

        // 2. 给 body 设置 position:fixed 并偏移 top 来「冻结」页面
        document.body.style.position = 'fixed';
        document.body.style.top = `-${savedScrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';

        // 3. 添加 no-scroll class 作为辅助（overflow:hidden + overscroll-behavior）
        document.documentElement.classList.add('no-scroll');
        document.body.classList.add('no-scroll');

        isLocked = true;
        currentModal = modalElement || null;

        // 4. iOS 专属：监听 visualViewport 变化，检测键盘收起后回位
        if (isIOSMobile() && currentModal) {
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

        // 2. 读取保存的位置
        const scrollY = savedScrollY;

        // 3. 移除 body 上的锁定样式
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';

        // 4. 移除 no-scroll class
        document.documentElement.classList.remove('no-scroll');
        document.body.classList.remove('no-scroll');

        isLocked = false;
        currentModal = null;

        // 5. 恢复滚动位置
        window.scrollTo(0, scrollY);
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

            // 检查当前是否有输入框正在聚焦
            const active = document.activeElement;
            const inField = !!(active && currentModal.contains(active) &&
                /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));

            // 键盘已收起（viewport 恢复到接近原始高度）且没有输入框聚焦
            if (!inField && window.visualViewport.height >= baseHeight - 2) {
                // 重新对齐 body 的 top 值，防止键盘操作后产生的偏移
                document.body.style.top = `-${savedScrollY}px`;
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
        unlock: unlock,
        /** 检查当前是否处于锁定状态 */
        get isLocked() { return isLocked; }
    };
})();
