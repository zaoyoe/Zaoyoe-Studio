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

    // --- 📥 入口：推入队列（支持向后兼容）---
    queueUpdate(type, objectId, parentMessageId = null) {
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
        if (this.state.timer) clearTimeout(this.state.timer);

        if (!this.state.isVisible) {
            el.classList.add('active');
            this.state.isVisible = true;
        } else {
            el.style.transform = 'translateX(-50%) scale(1.05) translateZ(0)';
            setTimeout(() => el.style.transform = 'translateX(-50%) scale(1) translateZ(0)', 200);
        }

        this.state.timer = setTimeout(() => this.hide(), this.config.autoHideTime);
    },

    // --- 🙈 隐藏 ---
    hide() {
        const el = document.getElementById('smart-capsule');
        if (el) {
            el.classList.remove('active');
            this.state.isVisible = false;
            if (this.config.clearQueueOnHide) this.state.updates = [];
        }
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
    }
};

document.addEventListener('click', () => CapsuleManager.initAudio(), { once: true });
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) document.title = CapsuleManager.state.originalTitle;
});

console.log('✅ CapsuleManager v5.2 (Phase 1 - Fixed Refresh) 已加载');
