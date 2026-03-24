/**
 * 💊 Smart Capsule Manager (v5.2 Phase 1)
 * 队列管理系统 - 向后兼容 + 强制刷新修复版
 */
window.CapsuleManager = {
    state: {
        updates: [], // 队列结构: { type, id, time }
        isVisible: false,
        timer: null,
        audioCtx: null,
        originalTitle: document.title
    },

    config: {
        autoHideTime: 8000, // 8秒自动消失
        clearQueueOnHide: false // 保留未读
    },

    runtime: {
        styleKey: 'style',
        dragOffsetProperty: '--capsule-drag-offset'
    },

    // --- 📥 入口：推入队列（支持向后兼容）---
    queueUpdate(type, objectId, parentMessageId = null) {
        // 🔍 调试日志：追踪调用堆栈
        console.trace('🚨 queueUpdate 被调用', { type, objectId, parentMessageId });

        // ✅ 向后兼容：没有objectId也能工作
        if (!objectId) {
            console.warn('⚠️ queueUpdate without objectId, using legacy mode');
            objectId = 'legacy_' + Date.now();
        }

        // 队列去重
        const existingIndex = this.state.updates.findIndex(u => u.id === objectId);
        if (existingIndex > -1) {
            this.state.updates.splice(existingIndex, 1);
        }

        // 存储更新信息，包括父留言ID（用于评论定位）
        this.state.updates.push({
            type,
            id: objectId,
            parentMessageId,  // 评论的父留言ID
            time: Date.now()
        });
        console.log('📋 队列更新:', this.state.updates);

        this.updateUI();
        this.playSound();
        this.flashTitle();
    },

    // --- 🎨 UI渲染 ---
    updateUI() {
        const queue = this.state.updates;
        if (queue.length === 0) return;

        const wrapper = document.getElementById('smart-capsule');
        const textEl = document.getElementById('capsule-text');
        const iconEl = wrapper?.querySelector('.capsule-icon');
        if (!wrapper || !textEl || !iconEl) {
            console.warn('⚠️ 胶囊DOM元素未找到');
            return;
        }

        const msgs = queue.filter(u => u.type === 'message').length;
        const cmts = queue.filter(u => u.type === 'comment').length;
        const likes = queue.filter(u => u.type === 'like').length;

        // 智能图标
        let icon = '🔔';
        if (likes > 0) icon = '🔥';
        if (cmts > 0) icon = '💭';
        if (msgs > 0) icon = '💬';
        if ((msgs + cmts) > 0 && likes > 0) icon = '✨';
        // ✅ 修复：使用 innerHTML 防止 HTML 源码被显示为文本
        iconEl.innerHTML = icon;

        // 智能文案 (移动端和电脑端统一)
        let text = '';
        if (msgs + cmts === 0 && likes > 0) {
            // 纯点赞通知
            text = `点赞 (+${likes})`;
        } else {
            let parts = [];
            if (msgs > 0) parts.push(`${msgs} 条留言`);
            if (cmts > 0) parts.push(`${cmts} 条评论`);
            if (likes > 0) parts.push(`${likes} 个赞`);
            // ✅ 修复：当 parts 为空时显示通用文案
            if (parts.length > 0) {
                text = `有 ${parts.join('、')}`;
            } else {
                text = `有 ${queue.length} 条新动态`;
            }
        }
        // ✅ 修复：使用 innerHTML 防止 HTML 源码被显示为文本
        textEl.innerHTML = text;

        // 暖色模式
        if (msgs + cmts === 0 && likes > 0) wrapper.classList.add('warm-theme');
        else wrapper.classList.remove('warm-theme');

        this.show(wrapper);
    },

    // --- 🚀 显示动画 ---
    show(el) {
        // 🛡️ 状态同步检查：如果DOM有active类但JS认为不可见，清理残留
        if (el.classList.contains('active') && !this.state.isVisible) {
            console.warn('⚠️ 检测到状态不同步，清理残留 active 类');
            el.classList.remove('active');
        }

        // 逻辑优化：如果已经在显示中，不要轻易重置主计时器，防止被连续消息无限延长
        // 只有当不可见时，才设置全新的计时器
        if (!this.state.isVisible) {
            console.log('✅ show() 添加 active 类');
            el.classList.add('active');
            this.state.isVisible = true;

            // 清除旧计时器（如果有）
            if (this.state.timer) clearTimeout(this.state.timer);

            // 设置自动隐藏
            this.state.timer = setTimeout(() => this.hide(), this.config.autoHideTime);
        } else {
            console.log('ℹ️ 胶囊已可见，只播放抖动动画');
            // 如果已经可见，只播放强调动画
            this.pulse(el);

            // 可选：稍微延长一点点时间（例如 +2秒），而不是重置整整 8秒
            // 这里为了防止幽灵胶囊，我们选择不重置，或者只在剩余时间极短时重置
            // 简单起见，保持当前计时器，确保它最终会消失
        }
    },

    setDragOffset(el, value) {
        if (!el) return;
        const styleDecl = Reflect.get(el, this.runtime.styleKey);
        if (!styleDecl) return;
        if (value === null || value === undefined || value === '' || Number(value) === 0) {
            styleDecl.removeProperty(this.runtime.dragOffsetProperty);
        } else {
            styleDecl.setProperty(this.runtime.dragOffsetProperty, `${Math.round(Number(value))}px`);
        }
    },

    pulse(el) {
        if (!el) return;
        el.classList.remove('capsule-wrapper--pulse');
        void el.offsetWidth;
        el.classList.add('capsule-wrapper--pulse');
        setTimeout(() => {
            el.classList.remove('capsule-wrapper--pulse');
        }, 220);
    },

    // --- 🙈 隐藏 ---
    hide() {
        const el = document.getElementById('smart-capsule');
        if (el) {
            el.classList.remove('active');
            this.state.isVisible = false;

            // 强制清理计时器
            if (this.state.timer) {
                clearTimeout(this.state.timer);
                this.state.timer = null;
            }

            if (this.config.clearQueueOnHide) this.state.updates = [];
        }
    },

    // --- 🔊 播放声音 ---
    playSound() {
        if (!this.state.audioCtx) return;
        if (this.state.audioCtx.state === 'suspended') {
            this.state.audioCtx.resume();
        }
        try {
            const ctx = this.state.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch (e) { }
    },

    // --- ✅ Phase 4 & 6: 应用更新（智能定位）---
    applyUpdates() {
        console.log('🚀 v5.2 Phase 6: 使用智能定位');

        if (this.state.updates.length === 0) {
            console.warn('⚠️ 队列为空，无需定位');
            this.hide();
            return;
        }

        // 获取第一个更新（最优先的通知）
        const firstUpdate = this.state.updates[0];
        console.log('🎯 定位到第一个更新:', firstUpdate);

        // 根据类型智能定位
        if (firstUpdate.type === 'message') {
            // 留言：直接定位（LiveQuery 已实时插入）
            console.log('📜 定位到新留言:', firstUpdate.id);

            // 查找留言卡片
            const messageCard = document.querySelector(`[data-message-id="${firstUpdate.id}"]`);

            if (messageCard) {
                // 找到了，直接定位
                if (window.handleSmartScroll) {
                    window.handleSmartScroll(firstUpdate.id, 'message');
                } else {
                    // 降级：直接滚动
                    messageCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else {
                // 找不到，可能是 LiveQuery 还没触发，降级刷新
                console.warn('⚠️ 留言卡片未找到，执行降级刷新');
                if (typeof loadGuestbookMessages === 'function') {
                    loadGuestbookMessages(true, firstUpdate.id);
                } else {
                    window.location.reload();
                }
            }
        } else if (firstUpdate.type === 'comment') {
            // 评论：直接定位（已在页面）
            if (window.handleSmartScroll) {
                console.log('💬 定位到评论:', firstUpdate.id, '父留言ID:', firstUpdate.parentMessageId);
                window.handleSmartScroll(firstUpdate.id, 'comment', firstUpdate.parentMessageId);
            } else {
                loadGuestbookMessages?.(true) || window.location.reload();
            }
        } else if (firstUpdate.type === 'like') {
            // 点赞：定位到被点赞的卡片（LiveQuery 已实时更新数据）
            console.log('💗 点赞更新，定位到被点赞的卡片:', firstUpdate.id);

            // 智能判断是留言还是评论
            const isMessage = document.querySelector(`[data-message-id="${firstUpdate.id}"]`);
            const isComment = document.querySelector(`[data-comment-id="${firstUpdate.id}"]`);

            if (isMessage) {
                // 是留言卡片 (已存在)
                if (window.handleSmartScroll) {
                    window.handleSmartScroll(firstUpdate.id, 'message');
                } else {
                    isMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else if (isComment) {
                // 是评论 (已存在)
                if (window.handleSmartScroll) {
                    window.handleSmartScroll(firstUpdate.id, 'comment', firstUpdate.parentMessageId);
                } else {
                    isComment.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else {
                // ⚠️ 挖坟场景：元素不存在
                console.warn('⚠️ 找不到被点赞的目标，尝试打捞:', firstUpdate.id);

                if (window.handleSmartScroll) {
                    // 如果有 parentMessageId，说明是评论
                    if (firstUpdate.parentMessageId) {
                        console.log('🎣 这是一个评论点赞，尝试打捞父留言:', firstUpdate.parentMessageId);
                        window.handleSmartScroll(firstUpdate.id, 'comment', firstUpdate.parentMessageId);
                    } else {
                        // 否则假设是留言（或者没有父ID的评论，但也无法定位）
                        // 尝试作为留言打捞
                        console.log('🎣 这是一个留言点赞，尝试打捞:', firstUpdate.id);
                        window.handleSmartScroll(firstUpdate.id, 'message');
                    }
                }
            }
        }

        // 清空队列并隐藏
        this.state.updates = [];
        document.title = this.state.originalTitle;
        this.hide();
    },

    // --- 🔊 播放声音 ---
    playSound() {
        if (!this.state.audioCtx) return;
        if (this.state.audioCtx.state === 'suspended') {
            this.state.audioCtx.resume();
        }
        try {
            const ctx = this.state.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch (e) { }
    },

    flashTitle() {
        if (document.hidden) {
            const total = this.state.updates.length;
            document.title = `(${total}) ✨ 有新动态 - ${this.state.originalTitle}`;
        }
    },

    initAudio() {
        if (this.state.audioCtx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.state.audioCtx = new AC();
        } catch (e) { console.warn('Audio API not supported'); }
    },

    // --- 📱 移动端上划手势关闭 (健壮版 v2.0) ---
    initSwipeGesture() {
        // 防止重复初始化
        if (this._swipeInitialized) return;

        const capsule = document.getElementById('smart-capsule');
        if (!capsule) return;

        // 🛡️ 强制重置初始状态：移除 active 类，防止页面加载时出现幽灵胶囊
        capsule.classList.remove('active');
        this.state.isVisible = false;
        if (this.state.timer) {
            clearTimeout(this.state.timer);
            this.state.timer = null;
        }

        // 检测触摸支持
        if (!('ontouchstart' in window)) {
            console.log('⚠️ 设备不支持触摸，跳过手势初始化');
            return;
        }

        let startY = 0;
        let startX = 0;
        let currentY = 0;
        let startTime = 0;
        let isDragging = false;
        let isValidSwipe = false; // 标记是否为有效滑动
        let shouldBlockClick = false; // 标记是否需要阻止后续 click

        // touchstart：仅记录初始状态
        const handleTouchStart = (e) => {
            // ✅ 只处理通知胶囊，不处理 toast
            if (e.currentTarget.id !== 'smart-capsule') return;
            if (!this.state.isVisible) return;

            const touch = e.touches[0];
            if (!touch) return;

            startY = touch.clientY;
            startX = touch.clientX;
            currentY = startY;
            startTime = Date.now();
            isDragging = true;
            isValidSwipe = false;
            shouldBlockClick = false;

            // 暂时不阻止事件，等待判断
        };

        // touchmove：智能判断并渐进式阻止
        const handleTouchMove = (e) => {
            if (!isDragging) return;

            const touch = e.touches[0];
            if (!touch) return;

            currentY = touch.clientY;
            const deltaY = currentY - startY;
            const deltaX = Math.abs(touch.clientX - startX);

            // 判断是否为有效的向上滑动（距离 > 10px 且主要是垂直方向）
            if (Math.abs(deltaY) > 10 && Math.abs(deltaY) > deltaX) {
                if (!isValidSwipe) {
                    // 第一次识别为有效滑动，开始阻止事件
                    isValidSwipe = true;
                    capsule.classList.add('capsule-wrapper--dragging');
                }

                // 阻止默认滚动和事件冒泡
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();

                // 只允许向上滑动
                if (deltaY < 0) {
                    // 使用 requestAnimationFrame 优化性能
                    requestAnimationFrame(() => {
                        this.setDragOffset(capsule, deltaY);
                    });
                }
            }
        };

        // touchend：根据判断结果决定行为
        const handleTouchEnd = (e) => {
            if (!isDragging) return;

            e.stopPropagation(); // 始终阻止冒泡

            const deltaY = currentY - startY;
            const duration = Date.now() - startTime;

            isDragging = false;
            capsule.classList.remove('capsule-wrapper--dragging');

            // 判断是点击还是滑动
            if (!isValidSwipe || (Math.abs(deltaY) < 10 && duration < 200)) {
                // 这是一个点击，不干涉，重置状态
                this.setDragOffset(capsule, 0);
                return;
            }

            // 这是一个滑动，需要阻止后续的 click 事件
            shouldBlockClick = true;

            // 如果上划距离超过 50px，关闭胶囊
            if (deltaY < -50) {
                requestAnimationFrame(() => {
                    this.setDragOffset(capsule, -100);
                    capsule.classList.add('capsule-wrapper--dismissed');
                });
                setTimeout(() => {
                    this.hide();
                    setTimeout(() => {
                        requestAnimationFrame(() => {
                            capsule.classList.remove('capsule-wrapper--dismissed');
                            this.setDragOffset(capsule, 0);
                        });
                        shouldBlockClick = false;
                    }, 300);
                }, 300);
            } else {
                // 回弹
                requestAnimationFrame(() => {
                    this.setDragOffset(capsule, 0);
                });
                setTimeout(() => {
                    shouldBlockClick = false;
                }, 100);

                // 🛡️ 安全网：如果回弹后发现计时器没了（可能被意外清除），补一个
                if (this.state.isVisible && !this.state.timer) {
                    console.log('🛡️ 补救计时器');
                    this.state.timer = setTimeout(() => this.hide(), 3000);
                }
            }
        };

        // 拦截 click 事件（防止滑动后误触发点击）
        const handleClick = (e) => {
            if (shouldBlockClick) {
                e.preventDefault();
                e.stopPropagation();
                shouldBlockClick = false;
                console.log('🛡️ 阻止了滑动后的点击事件');
            }
        };

        // ✅ 只绑定到通知胶囊，使用 passive: false 以允许 preventDefault
        capsule.addEventListener('touchstart', handleTouchStart, { passive: true });
        capsule.addEventListener('touchmove', handleTouchMove, { passive: false });
        capsule.addEventListener('touchend', handleTouchEnd, { passive: true });
        capsule.addEventListener('click', handleClick, { capture: true });

        this._swipeInitialized = true;
        console.log('✅ 手势功能已初始化（健壮版，仅限通知胶囊）');
    }
};

document.addEventListener('click', () => CapsuleManager.initAudio(), { once: true });
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) document.title = CapsuleManager.state.originalTitle;
});

// 初始化移动端手势（健壮版）
document.addEventListener('DOMContentLoaded', () => {
    CapsuleManager.initSwipeGesture();
});

console.log('✅ CapsuleManager v5.5 (Triple Insurance - Ghost Fix) 已加载');
