/**
 * Google OAuth 登录功能
 * 集成 Google Sign-In 与 LeanCloud 用户系统
 */

// Google OAuth 配置
const GOOGLE_CLIENT_ID = '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com';

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
            cancel_on_tap_outside: true,
            context: 'signin'
        });

        console.log('✅ Google Sign-In initialized');

        // 渲染 Google 登录按钮（如果需要的话）
        renderGoogleButton();

    } catch (error) {
        console.error('❌ Failed to initialize Google Sign-In:', error);
    }
}

// 渲染 Google 登录按钮到隐藏的 div
function renderGoogleButton() {
    // 创建一个隐藏的容器用于 Google 按钮
    let googleBtnContainer = document.getElementById('google-btn-container');
    if (!googleBtnContainer) {
        googleBtnContainer = document.createElement('div');
        googleBtnContainer.id = 'google-btn-container';
        googleBtnContainer.style.display = 'none';
        document.body.appendChild(googleBtnContainer);
    }

    try {
        google.accounts.id.renderButton(
            googleBtnContainer,
            {
                theme: 'filled_blue',
                size: 'large',
                text: 'signin_with',
                shape: 'rectangular'
            }
        );
        console.log('✅ Google button rendered');
    } catch (error) {
        console.error('❌ Failed to render Google button:', error);
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

    if (typeof google === 'undefined') {
        alert('Google 登录服务加载失败，请刷新页面重试');
        return;
    }

    try {
        // 方法1：尝试使用 One Tap
        google.accounts.id.prompt((notification) => {
            console.log('📢 Prompt notification:', notification);

            if (notification.isNotDisplayed()) {
                console.log('⚠️ One Tap not displayed, reason:', notification.getNotDisplayedReason());

                // 如果 One Tap 不可用，触发隐藏按钮的点击
                const googleBtnContainer = document.getElementById('google-btn-container');
                if (googleBtnContainer) {
                    const googleBtn = googleBtnContainer.querySelector('div[role="button"]');
                    if (googleBtn) {
                        console.log('🔄 Clicking hidden Google button');
                        googleBtn.click();
                    } else {
                        alert('Google 登录初始化失败，请刷新页面重试');
                    }
                } else {
                    alert('Google 登录服务未就绪，请稍后再试');
                }
            }
        });
    } catch (error) {
        console.error('❌ Google login error:', error);
        alert('Google 登录失败: ' + error.message);
    }
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
