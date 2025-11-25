/**
 * Laf Cloud SDK 初始化配置
 * 替代 Firebase SDK
 */

// ⚠️ 重要：注册 Laf 后，将下面的 baseUrl 替换为您的实际应用地址
// 格式：https://your-app-name.laf.run
const LAF_BASE_URL = 'https://YOUR-APP-NAME.laf.run';

// 初始化 Laf Cloud（使用 CDN 方式，无需 npm）
class LafCloud {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    // 调用云函数
    async invoke(functionName, data = {}) {
        const token = localStorage.getItem('laf_token');

        try {
            const response = await fetch(`${this.baseUrl}/${functionName}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error(`调用云函数 ${functionName} 失败:`, error);
            throw error;
        }
    }
}

// 创建全局实例
window.lafCloud = new LafCloud(LAF_BASE_URL);

// 辅助函数：检查登录状态
window.checkLafLoginStatus = async function () {
    const token = localStorage.getItem('laf_token');
    if (!token) {
        console.log('未找到 token，用户未登录');
        return null;
    }

    try {
        const res = await window.lafCloud.invoke('user-info');
        if (res.code === 0) {
            console.log('用户已登录:', res.data);
            return res.data;
        } else {
            console.log('Token 无效或已过期');
            localStorage.removeItem('laf_token');
            localStorage.removeItem('cached_user_profile');
            return null;
        }
    } catch (e) {
        console.error('检查登录状态失败:', e);
        localStorage.removeItem('laf_token');
        localStorage.removeItem('cached_user_profile');
        return null;
    }
};

// 辅助函数：退出登录
window.lafLogout = function () {
    localStorage.removeItem('laf_token');
    localStorage.removeItem('cached_user_profile');
    console.log('已退出登录');
};

console.log('✅ Laf SDK 初始化完成');
console.log('📡 API 地址:', LAF_BASE_URL);
console.log('⚠️ 请确保已将 LAF_BASE_URL 替换为您的实际应用地址！');
