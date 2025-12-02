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
        autoHideTime: 5000, // 5秒自动消失
        clearQueueOnHide: false // 保留未读
    },

    // --- 📥 入口：推入队列（支持向后兼容）---
    queueUpdate(type, objectId) {
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

        this.state.updates.push({ type, id: objectId, time: Date.now() });
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
        iconEl.innerText = icon;

        // 智能文案
        let text = '';
        if (window.innerWidth <= 768) {
            text = `${queue.length} 条动态 ↻`;
        } else {
            if (msgs + cmts === 0 && likes > 0) {
                text = `热度上升 (+${likes})`;
            } else {
                let parts = [];
                if (msgs > 0) parts.push(`${msgs} 条留言`);
                if (cmts > 0) parts.push(`${cmts} 条评论`);
                text = `有 ${parts.join('、')} • 点击查看`;
            }
        }
        textEl.innerText = text;

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
            // 留言：刷新并定位
            if (typeof loadGuestbookMessages === 'function') {
                console.log('📜 加载留言并定位到:', firstUpdate.id);
                loadGuestbookMessages(true, firstUpdate.id);
            } else {
                window.location.reload();
            }
        } else if (firstUpdate.type === 'comment') {
            // 评论：直接定位（已在页面）
            if (window.handleSmartScroll) {
                console.log('💬 定位到评论:', firstUpdate.id);
                window.handleSmartScroll(firstUpdate.id, 'comment');
            } else {
                loadGuestbookMessages?.(true) || window.location.reload();
            }
        } else if (firstUpdate.type === 'like') {
            // 点赞：刷新页面（点赞没有具体位置）
            console.log('💗 点赞更新，刷新页面');
            loadGuestbookMessages?.(true) || window.location.reload();
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
