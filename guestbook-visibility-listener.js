// ==================== 页面可见性监听 ====================
// 当用户切换回页面时，自动刷新留言列表（防止 LiveQuery 断线）
(function () {
    'use strict';

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            console.log('👀 页面回到前台，检查是否需要更新留言列表...');

            // 清除缓存并重新加载
            if (typeof window.invalidateGuestbookCache === 'function') {
                window.invalidateGuestbookCache();
            }

            // 延迟500ms后重新加载，给 LiveQuery 时间重新连接
            setTimeout(function () {
                if (typeof loadGuestbookMessages === 'function') {
                    console.log('🔄 重新加载留言列表...');
                    loadGuestbookMessages(true); // 强制刷新
                }
            }, 500);
        }
    });
})();
