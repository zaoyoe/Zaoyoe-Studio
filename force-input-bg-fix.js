// Force Input Background Fix - Immediate Execution
(function () {
    'use strict';

    console.log('🎨 强制修复输入框背景...');

    // Track currently focused input
    let currentFocusedInput = null;

    function shouldBypassInputFix(input) {
        return !!input?.closest?.(
            '#commentModal, #guestbookModal, .comment-composer-editor, .guestbook-composer-editor'
        );
    }

    function clearInlineFixStyles(input) {
        input.style.removeProperty('background');
        input.style.removeProperty('background-color');
        input.style.removeProperty('border');
        input.style.removeProperty('border-color');
        input.style.removeProperty('box-shadow');
    }

    function applyInputStyles() {
        // 获取所有输入框
        const inputs = document.querySelectorAll('input[type="email"], input[type="password"], input[type="text"], input[type="tel"], textarea, .glass-input, .security-input');

        console.log(`找到 ${inputs.length} 个输入框`);

        inputs.forEach((input, index) => {
            if (shouldBypassInputFix(input)) {
                clearInlineFixStyles(input);
                return;
            }

            // Check if this input is currently focused
            if (input === document.activeElement) {
                applyFocusStyles(input);
            } else {
                // Only apply blur styles if NOT focused
                applyBlurStyles(input);
            }

            // 添加焦点事件 - 聚焦时加深背景和边框
            input.addEventListener('focus', function () {
                currentFocusedInput = this;
                applyFocusStyles(this);
                console.log('📍 输入框获得焦点');
            });

            // 添加失焦事件 - 恢复灰白色边框
            input.addEventListener('blur', function () {
                if (currentFocusedInput === this) {
                    currentFocusedInput = null;
                }
                applyBlurStyles(this);
                console.log('📍 输入框失去焦点');
            });

            console.log(`✅ 已修复输入框 #${index + 1}`);
        });

        console.log('✨ 所有输入框背景已强制修复！');
    }

    function applyFocusStyles(input) {
        if (shouldBypassInputFix(input)) {
            clearInlineFixStyles(input);
            return;
        }

        input.style.setProperty('background', 'rgba(0, 0, 0, 0.4)', 'important');
        input.style.setProperty('background-color', 'rgba(0, 0, 0, 0.4)', 'important');
        input.style.setProperty('border', '1px solid rgba(155, 93, 229, 0.7)', 'important');
        input.style.setProperty('border-color', 'rgba(155, 93, 229, 0.7)', 'important');
        input.style.setProperty('box-shadow', '0 0 0 3px rgba(155, 93, 229, 0.15)', 'important');
    }

    function applyBlurStyles(input) {
        if (shouldBypassInputFix(input)) {
            clearInlineFixStyles(input);
            return;
        }

        input.style.setProperty('background', 'rgba(0, 0, 0, 0.3)', 'important');
        input.style.setProperty('background-color', 'rgba(0, 0, 0, 0.3)', 'important');
        input.style.setProperty('border', '1px solid rgba(155, 93, 229, 0.3)', 'important');
        input.style.setProperty('border-color', 'rgba(155, 93, 229, 0.3)', 'important');
        input.style.setProperty('box-shadow', 'none', 'important');
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
                        if (node.matches && node.matches('input[type="email"], input[type="password"], input[type="text"], input[type="tel"], textarea, .glass-input, .security-input')) {
                            hasNewInputs = true;
                            break;
                        }
                        if (node.querySelector && node.querySelector('input[type="email"], input[type="password"], input[type="text"], input[type="tel"], textarea, .glass-input, .security-input')) {
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
