/**
 * Google OAuth 登录功能
 * 集成 Google Sign-In 与 LeanCloud 用户系统
 */

// Google OAuth 配置
const GOOGLE_CLIENT_ID = '1017068787594-ep4bj8cdirkilqipbmlfp.apps.googleusercontent.com';

// ==================== 初始化 Google Sign-In ====================
function initGoogleSignIn() {
    if (typeof google === 'undefined') {
        console.warn('⚠️ Google Sign-In SDK not loaded yet');
        return;
    }

    try {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true
        });

        console.log('✅ Google Sign-In initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Google Sign-In:', error);
    }
}

// 页面加载时初始化
window.addEventListener('load', function () {
    // 延迟初始化，确保 Google SDK 已加载
    setTimeout(initGoogleSignIn, 500);
});

// ==================== 处理 Google 登录按钮点击 ====================
async function handleGoogleLogin() {
    console.log('🔵 Google Login button clicked');

    // 使用传统 OAuth 2.0 授权码流程（弹窗方式）
    const redirectUri = encodeURIComponent('http://localhost:8000');
    const scope = encodeURIComponent('openid email profile');
    const responseType = 'token id_token'; // 使用 implicit flow 获取 id_token

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${redirectUri}&` +
        `response_type=${responseType}&` +
        `scope=${scope}&` +
        `nonce=${Math.random().toString(36).substring(7)}`;

    // 打开弹窗
    const width = 500;
    const height = 600;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;

    const popup = window.open(
        authUrl,
        'Google Login',
        `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popup) {
        alert('弹窗被阻止，请允许浏览器弹窗');
        return;
    }

    // 监听弹窗返回
    const checkPopup = setInterval(() => {
        try {
            if (popup.closed) {
                clearInterval(checkPopup);
                console.log('⚠️ Popup closed');
                return;
            }

            // 检查是否跳转回来了
            const popupUrl = popup.location.href;

            if (popupUrl.includes('localhost') && popupUrl.includes('id_token')) {
                clearInterval(checkPopup);
                popup.close();

                // 从 URL fragment 提取 id_token
                const fragment = popupUrl.split('#')[1];
                const params = new URLSearchParams(fragment);
                const idToken = params.get('id_token');

                if (idToken) {
                    handleGoogleCredentialResponse({ credential: idToken });
                }
            }
        } catch (e) {
            // CORS 阻止访问 popup.location，忽略
        }
    }, 500);
}

// ==================== 处理 Google 登录回调 ====================
async function handleGoogleCredentialResponse(response) {
    console.log('🔵 Google credential received');

    try {
        // 1. 解码 JWT Token 获取用户信息
        const userInfo = parseJwt(response.credential);
        console.log('👤 Google user info:', {
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture
        });

        const email = userInfo.email;
        const googleId = userInfo.sub;
        const name = userInfo.name;
        const picture = userInfo.picture;

        // 2. 检查 LeanCloud 中是否已存在该用户（通过 email）
        const query = new AV.Query('_User');
        query.equalTo('username', email);

        let user;
        try {
            user = await query.first();
        } catch (queryError) {
            console.log('⚠️ User lookup failed, will create new user');
        }

        if (user) {
            // 用户已存在，直接登录
            console.log('✅ Found existing user, logging in...');

            // 使用 sessionToken 登录（需要先获取）
            // 由于我们无法直接使用第三方登录，需要为 Google 用户生成一个固定密码
            // 或者使用 LeanCloud 的 sessionToken 机制

            // 方案：更新用户信息并使用 become 方法登录
            try {
                await AV.User.logIn(email, `google_${googleId}`);
                console.log('✅ Logged in with existing Google account');
            } catch (loginError) {
                console.error('❌ Login failed:', loginError);
                alert('登录失败: 账号密码不匹配。请使用邮箱密码登录，或联系管理员。');
                return;
            }

        } else {
            // 用户不存在，创建新用户
            console.log('📝 Creating new user from Google account...');

            user = new AV.User();
            user.setUsername(email);
            user.setEmail(email);
            user.setPassword(`google_${googleId}`); // 使用 Google ID 作为密码（用户不需要知道）
            user.set('nickname', name);
            user.set('avatarUrl', picture);
            user.set('googleId', googleId);
            user.set('authProvider', 'google');

            try {
                await user.signUp();
                console.log('✅ New Google user created:', user.id);

                // 尝试设置 ACL
                try {
                    await user.fetch();
                    const acl = new AV.ACL(user);
                    acl.setPublicReadAccess(true);
                    acl.setWriteAccess(user, true);
                    user.setACL(acl);
                    await user.save();
                    console.log('✅ ACL set for Google user');
                } catch (aclError) {
                    console.warn('⚠️ ACL setup failed for Google user:', aclError);
                }

            } catch (signUpError) {
                console.error('❌ Failed to create Google user:', signUpError);
                alert('注册失败: ' + signUpError.message);
                return;
            }
        }

        // 3. 关闭登录模态框
        if (typeof toggleLoginModal === 'function') {
            toggleLoginModal();
        }

        // 4. 更新 UI
        updateUserUI({
            objectId: user.id,
            username: user.get('username'),
            email: user.get('email'),
            nickname: user.get('nickname'),
            avatarUrl: user.get('avatarUrl')
        });

        alert(`欢迎，${name}！Google 登录成功！`);

    } catch (error) {
        console.error('❌ Google login error:', error);
        alert('Google 登录失败: ' + error.message);
    }
}

// ==================== JWT Token 解析工具 ====================
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split('')
                .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
        return JSON.parse(jsonPayload);
    } catch (error) {
        console.error('❌ Failed to parse JWT:', error);
        return null;
    }
}

console.log('✅ Google OAuth functions loaded');
