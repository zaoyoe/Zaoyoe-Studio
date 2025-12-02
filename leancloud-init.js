/**
 * LeanCloud SDK 初始化配置
 * 替代 Firebase SDK
 */

// ✅ LeanCloud 配置 - 混合模式
// REST API: 生产环境用Vercel代理(解决CORS)，本地直连
// WebSocket: 始终直连(LiveQuery需要)
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const LEANCLOUD_CONFIG = {
    appId: 'q6Nh03PQaIjEKthkhFGBL7AX-MdYXbMMI',
    appKey: 'sZuQhlUhkFCofqN96CLWYNyh',
    // REST API: 生产环境用代理，本地直连
    serverURLs: isLocal
        ? 'https://q6nh03pq.api.lncldglobal.com'
        : 'https://www.zaoyoe.com/api'
};

// 🆕 LiveQuery WebSocket 服务器配置 (始终直连)
const REALTIME_CONFIG = {
    RTMServerURL: 'wss://q6nh03pq.lc-ws-w1.lncldglobal.com'
};

// 初始化 LeanCloud（合并配置）
AV.init({
    ...LEANCLOUD_CONFIG,
    ...REALTIME_CONFIG
});

console.log('✅ LeanCloud SDK 初始化完成');
console.log('📡 配置详情:');
console.log('- AppID:', LEANCLOUD_CONFIG.appId);
console.log('- API 地址 (serverURLs):', LEANCLOUD_CONFIG.serverURLs);
console.log('- WebSocket (RTMServerURL):', REALTIME_CONFIG.RTMServerURL);
console.log('- LiveQuery 支持:', typeof AV.Query.prototype.subscribe !== 'undefined' ? '✅ 已启用' : '❌ 未启用');

console.log('⚠️ 请确保已将配置替换为您的实际 AppID/AppKey！');

// 辅助函数：检查登录状态
window.checkLeanCloudLogin = function () {
    const currentUser = AV.User.current();
    if (currentUser) {
        console.log('✅ 用户已登录:', currentUser.toJSON());
        return currentUser;
    } else {
        console.log('❌ 用户未登录');
        return null;
    }
};

// 辅助函数：退出登录
window.leanCloudLogout = function () {
    AV.User.logOut();
    console.log('🚪 已退出登录');
};

// 辅助函数：获取当前用户信息
window.getCurrentUserInfo = function () {
    const user = AV.User.current();
    if (!user) return null;

    return {
        objectId: user.id,
        username: user.get('username'),
        email: user.get('email'),
        nickname: user.get('nickname') || user.get('username'),
        avatarUrl: user.get('avatarUrl') || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.get('username'))}&background=random`
    };
};

console.log('✅ LeanCloud 辅助函数已加载');
