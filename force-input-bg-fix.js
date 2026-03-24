// Force Input Background Fix - Immediate Execution
(function () {
    'use strict';

    console.log('🎨 强制修复输入框背景...');

    const FORCE_INPUT_FIX_CLASS = 'force-input-bg-fixed';
    const FORCE_INPUT_FIX_FOCUSED_CLASS = 'force-input-bg-fixed--focused';
    const FORCE_INPUT_FIX_BOUND_ATTR = 'data-force-input-bg-bound';
    const FORCE_INPUT_SELECTORS = 'input[type="email"], input[type="password"], input[type="text"], input[type="tel"], textarea, .glass-input, .security-input';

    // Track currently focused input
    let currentFocusedInput = null;

    function shouldBypassInputFix(input) {
        return !!input?.closest?.(
            '#commentModal, #guestbookModal, .comment-composer-editor, .guestbook-composer-editor'
        );
    }

    function clearInputFixClasses(input) {
        input.classList.remove(FORCE_INPUT_FIX_CLASS, FORCE_INPUT_FIX_FOCUSED_CLASS);
    }

    function syncInputFixState(input) {
        if (!input) {
            return;
        }

        if (shouldBypassInputFix(input)) {
            clearInputFixClasses(input);
            return;
        }

        input.classList.add(FORCE_INPUT_FIX_CLASS);
        input.classList.toggle(FORCE_INPUT_FIX_FOCUSED_CLASS, input === document.activeElement);
    }

    function applyInputStyles() {
        // 获取所有输入框
        const inputs = document.querySelectorAll(FORCE_INPUT_SELECTORS);

        console.log(`找到 ${inputs.length} 个输入框`);

        inputs.forEach((input, index) => {
            syncInputFixState(input);

            if (!input.hasAttribute(FORCE_INPUT_FIX_BOUND_ATTR)) {
                input.setAttribute(FORCE_INPUT_FIX_BOUND_ATTR, 'true');

                // 添加焦点事件 - 聚焦时加深背景和边框
                input.addEventListener('focus', function () {
                    currentFocusedInput = this;
                    syncInputFixState(this);
                    console.log('📍 输入框获得焦点');
                });

                // 添加失焦事件 - 恢复灰白色边框
                input.addEventListener('blur', function () {
                    if (currentFocusedInput === this) {
                        currentFocusedInput = null;
                    }
                    syncInputFixState(this);
                    console.log('📍 输入框失去焦点');
                });
            }

            console.log(`✅ 已修复输入框 #${index + 1}`);
        });

        console.log('✨ 所有输入框背景已强制修复！');
    }

    // 持续监控当前聚焦的输入框，防止样式被覆盖
    // setInterval(function () {
    //     if (currentFocusedInput && document.activeElement === currentFocusedInput) {
    //         applyFocusStyles(currentFocusedInput);
    //     }
    // }, 50); // 每50ms检查一次

    // 立即执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyInputStyles);
    } else {
        applyInputStyles();
    }

    // 监听DOM变化，处理动态添加的输入框 - 防抖优化
    let debounceTimer = null;
    const observer = new MutationObserver(function (mutations) {
        // 清除之前的定时器
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        // 只有当真正添加了新元素时才处理
        let hasNewInputs = false;
        mutations.forEach(function (mutation) {
            if (mutation.addedNodes.length) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === 1) { // Element node
                        if (node.matches && node.matches(FORCE_INPUT_SELECTORS)) {
                            hasNewInputs = true;
                            break;
                        }
                        if (node.querySelector && node.querySelector(FORCE_INPUT_SELECTORS)) {
                            hasNewInputs = true;
                            break;
                        }
                    }
                }
            }
        });

        // 只有发现新输入框时才执行，且延迟300ms防抖
        if (hasNewInputs) {
            debounceTimer = setTimeout(applyInputStyles, 300);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
