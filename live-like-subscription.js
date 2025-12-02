// ==================== LiveQuery 点赞更新 - 优雅的原位心跳动画 ====================

/**
 * 优雅地更新点赞数 - 原位心跳动画
 * @param {string} targetType - 'Message' 或 'Comment'
 * @param {string} targetId - 目标ID
 * @param {number} newLikes - 新的点赞数
 */
function updateLikeWithAnimation(targetType, targetId, newLikes) {
    console.log(`✨ [优雅更新] ${targetType} ${targetId} → ${newLikes} 赞`);

    // 根据类型找到对应的DOM元素
    let element;
    if (targetType === 'Message') {
        element = document.querySelector(`.message-item[data-message-id="${targetId}"]`);
    } else if (targetType === 'Comment') {
        element = document.querySelector(`.comment-item[data-comment-id="${targetId}"]`);
    }

    if (!element) {
        console.warn(`找不到对应的DOM元素: ${targetType} ${targetId}`);
        return;
    }

    // 找到点赞数字和图标
    const likeCountSpan = element.querySelector('.like-count');
    const likeBtn = element.querySelector('.like-btn');
    const likeIcon = likeBtn ? likeBtn.querySelector('i, span') : null;

    if (!likeCountSpan) {
        console.warn('找不到 .like-count 元素');
        return;
    }

    const currentLikes = parseInt(likeCountSpan.textContent) || 0;

    // 只有数字变化时才触发动画
    if (currentLikes !== newLikes) {
        // 更新数字
        likeCountSpan.textContent = newLikes;

        // 移除之前的动画类（支持连续动画）
        likeCountSpan.classList.remove('live-pulse-number');
        if (likeIcon) {
            likeIcon.classList.remove('live-pulse-icon');
        }

        // 强制浏览器重绘
        void likeCountSpan.offsetWidth;

        // 添加动画类
        likeCountSpan.classList.add('live-pulse-number');
        if (likeIcon) {
            likeIcon.classList.add('live-pulse-icon');
        }

        // 动画结束后移除类
        setTimeout(() => {
            likeCountSpan.classList.remove('live-pulse-number');
            if (likeIcon) {
                likeIcon.classList.remove('live-pulse-icon');
            }
        }, 600);

        console.log(`✅ 点赞数已更新: ${currentLikes} → ${newLikes}`);
    }
}

/**
 * 订阅点赞更新的LiveQuery
 */
async function subscribeLikeLiveQuery() {
    if (typeof AV === 'undefined' || !AV.Query.prototype.subscribe) {
        console.warn('⚠️ LiveQuery 不可用，跳过点赞订阅');
        return;
    }

    try {
        console.log('💗 开始订阅点赞更新...');

        const likeQuery = new AV.Query('Like');
        const likeLiveQuery = await likeQuery.subscribe();

        console.log('✅ 点赞实时订阅已启用');

        // 新增点赞
        likeLiveQuery.on('create', async (newLike) => {
            console.log('💗 [LiveQuery] 收到新点赞事件!');
            const targetId = newLike.get('targetId');
            const targetType = newLike.get('targetType');

            if (!targetId) return;

            // 统计该目标的最新点赞数
            const countQuery = new AV.Query('Like');
            countQuery.equalTo('targetId', targetId);
            const totalLikes = await countQuery.count();

            // 为了 CapsuleManager 和更详细的日志，我们需要获取旧的点赞数
            let oldCount = 0;
            const element = document.querySelector(`.message-item[data-message-id="${targetId}"]`) || document.querySelector(`.comment-item[data-comment-id="${targetId}"]`);
            if (element) {
                const likeCountSpan = element.querySelector('.like-count');
                if (likeCountSpan) {
                    oldCount = parseInt(likeCountSpan.textContent) || 0;
                }
            }
            const newCount = totalLikes;
            const change = newCount - oldCount;

            console.log(`💗 ${targetType} [${targetId}] 点赞数: ${oldCount} → ${newCount} (+${change})`);

            // ✨ Phase 5: 触发智能胶囊通知（只有+1才触发）
            if (change === 1 && window.CapsuleManager) {
                console.log('🔔 触发胶囊通知 - 点赞 targetId:', targetId);
                window.CapsuleManager.queueUpdate('like', targetId);
            }

            // 🎬 触发心跳动画优雅更新：原位心跳动画
            updateLikeWithAnimation(targetType, targetId, totalLikes);
        });

        // 取消点赞
        likeLiveQuery.on('delete', async (deletedLike) => {
            console.log('💔 [LiveQuery] 收到取消点赞事件!');
            const targetId = deletedLike.get('targetId');
            const targetType = deletedLike.get('targetType');

            if (!targetId) return;

            // 统计该目标的最新点赞数
            const countQuery = new AV.Query('Like');
            countQuery.equalTo('targetId', targetId);
            const totalLikes = await countQuery.count();
            console.log(`💔 目标 ${targetId} 的点赞数已更新为: ${totalLikes}`);

            // ✨ 优雅更新：原位心跳动画
            updateLikeWithAnimation(targetType, targetId, totalLikes);
        });

    } catch (error) {
        console.error('❌ 点赞订阅失败:', error);
    }
}

// 页面加载完成后自动订阅
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // 延迟1秒后订阅，确保AV已初始化
        setTimeout(subscribeLikeLiveQuery, 1000);
    });
} else {
    setTimeout(subscribeLikeLiveQuery, 1000);
}

// 导出函数供外部使用
window.updateLikeWithAnimation = updateLikeWithAnimation;
window.subscribeLikeLiveQuery = subscribeLikeLiveQuery;
