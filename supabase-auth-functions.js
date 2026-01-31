/**
 * Supabase 版本的认证和用户管理函数
 * 替换 leancloud-auth-functions.js
 */

// ==================== 注册功能 (Supabase 版本) ====================
async function handleRegister(event) {
    event.preventDefault();

    const inputCode = document.getElementById('reg-code').value;
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const privacyConsent = document.getElementById('privacyConsent')?.checked;

    // 隐私政策验证
    if (!privacyConsent) {
        alert("请先阅读并同意隐私政策");
        return;
    }

    // 验证码检查
    if (inputCode !== generatedCode) {
        alert("验证码错误！请检查邮件重新输入。");
        return;
    }

    try {
        // 检查用户名是否已被使用
        const { data: existingUsers } = await window.supabaseClient
            .from('profiles')
            .select('username')
            .eq('username', username)
            .limit(1);

        if (existingUsers && existingUsers.length > 0) {
            alert("该用户名已被使用，请选择其他用户名。");
            return;
        }

        // 注册用户
        const { data, error } = await window.supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: username || email.split('@')[0],
                    avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(username || email.split('@')[0])}&background=random`
                }
            }
        });

        if (error) throw error;

        console.log('✅ User created:', data.user.id);

        // 关闭模态框
        toggleLoginModal();

        // 更新UI
        updateUserUI({
            objectId: data.user.id,
            username: email,
            email: email,
            nickname: username || email.split('@')[0],
            avatarUrl: data.user.user_metadata?.avatar_url
        });

    } catch (error) {
        console.error('注册失败:', error);

        let errorMessage = '注册失败';
        if (error.message.includes('already registered')) {
            errorMessage = '该邮箱已被注册。';
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`注册失败: ${errorMessage}`);
    }
}

// ==================== 登录功能 (Supabase 版本 - 带安全锁定) ====================
async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

    if (!email || !password) {
        alert("请输入邮箱和密码");
        return;
    }

    try {
        // 🌐 Step 0: 获取客户端 IP
        const clientIP = await getClientIP();

        // 🚫 Step 0.5: 检查 IP 是否被拉黑
        if (clientIP) {
            const ipStatus = await checkIPBlacklisted(clientIP);
            if (ipStatus.blocked) {
                let message = '⛔ 您的 IP 地址已被禁止登录';
                if (ipStatus.reason) {
                    message += `\n\n原因: ${ipStatus.reason}`;
                }
                if (ipStatus.expires_at) {
                    const expiresDate = new Date(ipStatus.expires_at);
                    message += `\n解封时间: ${expiresDate.toLocaleString('zh-CN')}`;
                }
                alert(message);
                return;
            }
        }

        // 🔒 Step 1: 检查账户是否被锁定
        const lockStatus = await checkUserLocked(email);
        if (lockStatus.isLocked) {
            const minutes = Math.ceil(lockStatus.remainingSeconds / 60);
            alert(`⚠️ 账户已锁定\n\n由于多次登录失败，您的账户已被临时锁定。\n请在 ${minutes} 分钟后重试。`);
            return;
        }

        // Step 2: 尝试登录
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            // 🔒 登录失败 - 记录失败次数（包含 IP）
            await recordLoginFailure(email, clientIP);
            throw error;
        }

        console.log('✅ 登录成功:', data.user);

        // 🔒 Step 3: 登录成功 - 重置失败计数
        await resetLoginFailures(email);

        // 获取用户 profile
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        // 记住我功能
        if (rememberMe) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);

            const credentials = {
                email: email,
                password: btoa(password),
                expiry: expiryDate.getTime()
            };

            localStorage.setItem('remembered_credentials', JSON.stringify(credentials));

            // 多账号密码库
            let savedPasswords = {};
            try {
                const saved = localStorage.getItem('saved_passwords');
                if (saved) savedPasswords = JSON.parse(saved);
            } catch (e) { console.error('读取密码库失败', e); }

            savedPasswords[email] = btoa(password);
            localStorage.setItem('saved_passwords', JSON.stringify(savedPasswords));
        } else {
            localStorage.removeItem('remembered_credentials');
        }

        // 关闭模态框
        toggleLoginModal();

        // 更新UI
        updateUserUI({
            objectId: data.user.id,
            username: data.user.email,
            email: data.user.email,
            nickname: profile?.username || data.user.user_metadata?.full_name || data.user.email.split('@')[0],
            avatarUrl: profile?.avatar_url || data.user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.email)}&background=random`
        });

        // 记录登录 IP（用于多账号检测）
        recordLoginIP(data.user.id);

        // 🔒 Step 4: 启动会话超时监控
        startSessionTimeoutMonitor();

        // 刷新留言板点赞状态
        if (typeof loadGuestbookMessages === 'function') {
            console.log('🔄 登录成功，刷新留言板点赞状态...');
            loadGuestbookMessages(true);
        }

    } catch (error) {
        console.error('登录失败:', error);

        let errorMessage = '登录失败';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = '用户名或密码错误';
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`登录失败: ${errorMessage}`);
    }
}

// ==================== 登录安全辅助函数 ====================

// 获取客户端 IP 地址
async function getClientIP() {
    try {
        // 优先使用 ipify（更快更稳定）
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        console.log('🌐 客户端 IP:', data.ip);
        return data.ip;
    } catch (e) {
        console.warn('无法获取客户端 IP:', e.message);
        return null;
    }
}

// 检查 IP 是否被拉黑
async function checkIPBlacklisted(clientIP) {
    try {
        const { data, error } = await window.supabaseClient.rpc('check_ip_blacklisted', {
            client_ip: clientIP
        });

        if (error) {
            console.warn('检查 IP 黑名单失败:', error.message);
            return { blocked: false };
        }

        if (data && data.blocked) {
            console.warn('🚫 IP 已被拉黑:', clientIP, data.reason);
        }

        return data || { blocked: false };
    } catch (e) {
        console.warn('检查 IP 黑名单失败:', e.message);
        return { blocked: false };
    }
}

// 获取安全配置 (使用公开 RPC 函数，anon 用户可访问)
async function getSecurityConfig() {
    try {
        const { data, error } = await window.supabaseClient
            .rpc('get_public_security_config');

        if (error) {
            console.warn('读取安全配置失败:', error.message);
            throw error;
        }

        console.log('📋 安全配置加载成功:', data);
        return data || {
            login_lockout_attempts: 5,
            lockout_duration: 900000,
            session_timeout: 3600000
        };
    } catch (e) {
        console.warn('无法获取安全配置，使用默认值:', e.message);
        return {
            login_lockout_attempts: 5,
            lockout_duration: 900000,
            session_timeout: 3600000
        };
    }
}

// 检查用户是否被锁定
async function checkUserLocked(email) {
    try {
        const { data, error } = await window.supabaseClient.rpc('check_user_locked', {
            user_email: email
        });
        if (error) throw error;
        if (data && data.length > 0) {
            return {
                isLocked: data[0].is_locked,
                lockedUntil: data[0].locked_until,
                remainingSeconds: data[0].remaining_seconds
            };
        }
        return { isLocked: false };
    } catch (e) {
        console.warn('检查锁定状态失败:', e);
        return { isLocked: false }; // 失败时允许继续登录
    }
}

// 记录登录失败（支持 IP 传递用于自动拉黑）
async function recordLoginFailure(email, clientIP = null) {
    try {
        const config = await getSecurityConfig();
        const maxAttempts = config.login_lockout_attempts || 5;
        const lockoutMinutes = Math.floor((config.lockout_duration || 900000) / 60000);

        const { data, error } = await window.supabaseClient.rpc('record_login_failure', {
            user_email: email,
            max_attempts: maxAttempts,
            lockout_minutes: lockoutMinutes,
            client_ip: clientIP
        });

        if (error) throw error;

        if (data && data.length > 0 && data[0].is_now_locked) {
            console.warn(`⚠️ 账户 ${email} 已被锁定 ${lockoutMinutes} 分钟`);

            // 检查是否触发了 IP 自动拉黑
            if (data[0].ip_auto_blocked) {
                console.warn(`🚫 IP ${clientIP} 已被自动拉黑 24 小时`);
            }
        } else if (data && data.length > 0) {
            const remaining = maxAttempts - data[0].attempts;
            if (remaining > 0 && remaining <= 2) {
                console.warn(`⚠️ 登录失败，还剩 ${remaining} 次尝试机会`);
            }
        }
    } catch (e) {
        console.error('记录登录失败次数时出错:', e);
    }
}

// 重置登录失败次数
async function resetLoginFailures(email) {
    try {
        const { error } = await window.supabaseClient.rpc('reset_login_failures', {
            user_email: email
        });
        if (error) throw error;
        console.log('✅ 登录成功，失败计数已重置');
    } catch (e) {
        console.error('重置失败计数时出错:', e);
    }
}

// ==================== 会话超时监控 ====================
let sessionTimeoutTimer = null;
let lastActivityTime = Date.now();

function startSessionTimeoutMonitor() {
    // 清除之前的定时器
    if (sessionTimeoutTimer) {
        clearInterval(sessionTimeoutTimer);
    }

    // 更新最后活动时间
    lastActivityTime = Date.now();

    // 监听用户活动
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => {
        document.addEventListener(event, updateLastActivity, { passive: true });
    });

    // 定期检查超时（每分钟检查一次）
    sessionTimeoutTimer = setInterval(checkSessionTimeout, 60000);
    console.log('🔒 会话超时监控已启动');
}

function updateLastActivity() {
    lastActivityTime = Date.now();
}

async function checkSessionTimeout() {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        // 用户未登录，停止监控
        stopSessionTimeoutMonitor();
        return;
    }

    const config = await getSecurityConfig();
    const timeout = config.session_timeout || 3600000; // 默认1小时
    const elapsed = Date.now() - lastActivityTime;

    if (elapsed >= timeout) {
        console.log('⏰ 会话超时，自动登出...');
        stopSessionTimeoutMonitor();

        // 自动登出
        await window.supabaseClient.auth.signOut();
        updateUserUI(null);

        alert('⏰ 由于长时间无操作，您已被自动登出。');
    }
}

function stopSessionTimeoutMonitor() {
    if (sessionTimeoutTimer) {
        clearInterval(sessionTimeoutTimer);
        sessionTimeoutTimer = null;
    }

    // 移除活动监听器
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => {
        document.removeEventListener(event, updateLastActivity);
    });

    console.log('🔒 会话超时监控已停止');
}

// ==================== 退出登录 (Supabase 版本) ====================
async function handleLogout(event) {
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');

    if (dropdown) dropdown.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    if (!confirm("确定要退出登录吗？")) return;

    console.log('🚪 退出登录');

    // 🔒 停止会话超时监控
    stopSessionTimeoutMonitor();

    try {
        await window.supabaseClient.auth.signOut();
    } catch (error) {
        console.error('❌ Supabase logout failed:', error);
    }

    localStorage.removeItem('remembered_credentials');
    console.log('🗑️ 已清除自动登录凭证');

    // 重置UI
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');

    if (defaultIcon) defaultIcon.style.display = 'inline';
    if (navAvatar) navAvatar.style.display = 'none';
    if (btnText) btnText.textContent = 'Sign In';

    const authBtn = document.getElementById('authBtn');
    if (authBtn) authBtn.classList.remove('logged-in');

    const userDropdown = document.getElementById('userDropdown');
    if (userDropdown) userDropdown.classList.remove('active');
}

window.handleLogout = handleLogout;

// ==================== 处理 Auth 按钮点击 ====================
async function handleAuthClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    console.log('🔘 handleAuthClick triggered');

    // 🚀 OPTIMIZATION: Use cached profile for instant dropdown (no network delay)
    const cachedProfile = localStorage.getItem('cached_user_profile');
    const isLoggedIn = !!cachedProfile;

    console.log('👤 Using cached login state:', isLoggedIn ? 'logged in' : 'not logged in');

    if (isLoggedIn) {
        // User is logged in - toggle dropdown INSTANTLY
        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('dropdownOverlay');

        if (dropdown) {
            const isActive = dropdown.classList.contains('active');
            if (isActive) {
                dropdown.classList.remove('active');
                if (overlay) overlay.classList.remove('active');
            } else {
                dropdown.classList.add('active');
                if (overlay) overlay.classList.add('active');
            }
        }

        // Note: Background verification happens via auth state listener, 
        // no need to await getUser() here for dropdown toggle
    } else {
        // User is not logged in - open login modal
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.classList.add('active');
            // 🆕 Reset visibility/opacity that toggleLoginModal sets when closing
            loginModal.style.visibility = 'visible';
            loginModal.style.opacity = '1';
            // 🆕 Also reset the card visibility
            const card = loginModal.querySelector('.login-card');
            if (card) {
                card.style.display = 'block';
                card.style.opacity = '1';
                card.style.visibility = 'visible';
            }
        }
    }
}

window.handleAuthClick = handleAuthClick;

// ==================== 检查登录状态 (Supabase 版本) ====================
async function checkAuthState() {
    console.log('🔍 检查登录状态...');

    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (user) {
        console.log('✅ 用户已登录:', user);

        // 获取 profile
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        // Validate custom avatar (same logic as prompts-poetry.js)
        let validCustomAvatar = null;
        const MIN_BASE64_LENGTH = 100;

        if (profile?.avatar_url) {
            const url = profile.avatar_url.trim();
            if (url.startsWith('http')) {
                validCustomAvatar = url;
            } else if (url.startsWith('data:') && url.length > MIN_BASE64_LENGTH) {
                validCustomAvatar = url;
            }
        }

        updateUserUI({
            objectId: user.id,
            username: user.email,
            email: user.email,
            nickname: profile?.username || user.user_metadata?.full_name || user.email.split('@')[0],
            avatarUrl: validCustomAvatar || user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=6b9ece&color=fff`
        });

        // 🔒 启动会话超时监控
        startSessionTimeoutMonitor();
    } else {
        console.log('❌ 用户未登录');
        updateUserUI(null);
    }
}

// ==================== 更新用户UI ====================
const ADMIN_EMAILS = ['zaoyoe@gmail.com'];

function updateUserUI(user) {
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');
    const userDropdown = document.getElementById('userDropdown');
    const profileModalEmail = document.getElementById('profileModalEmail');
    const profileModalAvatar = document.getElementById('profileModalAvatar');
    const enterStudioBtn = document.getElementById('enterStudioBtn');

    if (user) {
        console.log('👤 updateUserUI: 用户已登录', user);

        // Check if user is admin
        const isAdmin = ADMIN_EMAILS.includes(user.email);

        if (defaultIcon) defaultIcon.style.display = 'none';
        if (navAvatar) {
            const newAvatarUrl = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nickname || user.username || 'User')}&background=random`;
            const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nickname || user.username || 'User')}&background=6b9ece&color=fff`;

            // 🆕 只在头像 URL 变化时才更新，避免闪烁
            const currentSrc = navAvatar.src;
            const urlChanged = !currentSrc || !currentSrc.includes(newAvatarUrl.split('?')[0]);

            navAvatar.style.display = 'inline-block';
            navAvatar.style.visibility = 'visible';
            navAvatar.style.opacity = '1';
            navAvatar.classList.add('show');

            // 🆕 Add error handler for when Google CDN is rate-limited (429) or unavailable
            navAvatar.onerror = function () {
                console.warn('⚠️ Avatar load failed (possibly rate limited), using fallback');
                this.onerror = null; // Prevent infinite loop
                this.src = fallbackUrl;
            };

            if (urlChanged) {
                navAvatar.classList.remove('animate-in');
                navAvatar.src = newAvatarUrl;
                setTimeout(() => {
                    navAvatar.classList.add('animate-in');
                }, 50);
            }
        }
        if (btnText) {
            btnText.textContent = user.nickname || user.username || 'User';
        }

        const dropdownUsername = document.getElementById('dropdownUsername');
        if (dropdownUsername) {
            dropdownUsername.textContent = user.nickname || user.username || 'User';
            // Add sparkle if admin (simplified)
            if (isAdmin) dropdownUsername.innerHTML += ' <span style="color:#fbbf24;">✨</span>';
        }

        const authBtn = document.getElementById('authBtn');
        if (authBtn) authBtn.classList.add('logged-in');

        if (profileModalEmail) profileModalEmail.textContent = user.email || '未绑定邮箱';
        if (profileModalAvatar && user.avatarUrl) profileModalAvatar.src = user.avatarUrl;
        if (userDropdown) userDropdown.style.display = '';

        // Show Enter Studio for admin only
        if (enterStudioBtn) enterStudioBtn.style.display = isAdmin ? 'flex' : 'none';

        localStorage.setItem('cached_user_profile', JSON.stringify(user));
    } else {
        if (defaultIcon) defaultIcon.style.display = 'inline';
        if (navAvatar) navAvatar.style.display = 'none';
        if (btnText) btnText.textContent = 'Sign In';
        if (userDropdown) userDropdown.classList.remove('active');
        if (enterStudioBtn) enterStudioBtn.style.display = 'none';

        localStorage.removeItem('cached_user_profile');
    }
}

// ==================== 密码重置 (Supabase 版本) ====================
let resetCooldownTimer = null;
let resetCooldownSeconds = 0;

async function handlePasswordReset(event) {
    if (event) event.preventDefault();

    const emailInput = document.getElementById('reset-email');
    const submitBtn = document.querySelector('#resetForm button[type="submit"]');

    if (!emailInput || !submitBtn) {
        alert("❌ 系统错误：找不到表单元素，请刷新页面重试。");
        return;
    }

    const email = emailInput.value.trim();

    if (!email) {
        alert("❌ 请输入邮箱地址");
        return;
    }

    if (resetCooldownSeconds > 0) {
        alert(`⏱️ 请等待 ${resetCooldownSeconds} 秒后再试`);
        return;
    }

    const originalText = submitBtn.textContent;
    submitBtn.textContent = '发送中...';
    submitBtn.disabled = true;

    try {
        const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        });

        if (error) throw error;

        console.log('✅ 重置邮件已发送');
        alert(`✅ 重置密码邮件已发送到 ${email}\n\n请检查您的收件箱（包括垃圾邮件），点击邮件中的链接重置密码。`);
        emailInput.value = '';

        resetCooldownSeconds = 30;
        updateResetButtonCountdown(submitBtn, originalText);

        setTimeout(() => {
            switchAuthView('login');
        }, 5000);

    } catch (error) {
        console.error('密码重置失败:', error);
        alert(`❌ ${error.message || '发送失败'}`);
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
}

function updateResetButtonCountdown(button, originalText) {
    if (resetCooldownSeconds > 0) {
        button.textContent = `已发送 (${resetCooldownSeconds}s)`;
        button.disabled = true;
        resetCooldownSeconds--;
        resetCooldownTimer = setTimeout(() => updateResetButtonCountdown(button, originalText), 1000);
    } else {
        button.textContent = originalText;
        button.disabled = false;
        if (resetCooldownTimer) {
            clearTimeout(resetCooldownTimer);
            resetCooldownTimer = null;
        }
    }
}

// ==================== Google OAuth 登录 (Supabase 版本) ====================
async function handleGoogleLogin() {
    console.log('🔵 Google Login button clicked');

    // 移除 query 和 hash 部分，确保干净的 redirect URL
    const redirectUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
    console.log('🔗 Redirect URL:', redirectUrl);

    try {
        const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl
            }
        });

        if (error) throw error;

        // OAuth will redirect, so nothing to do here
        console.log('🔄 Redirecting to Google...');

    } catch (error) {
        console.error('❌ Google login error:', error);
        alert('Google 登录失败: ' + error.message);
    }
}

window.handleGoogleLogin = handleGoogleLogin;

// ==================== 头像上传 (Supabase 版本) ====================
async function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        alert("图片大小不能超过 2MB");
        return;
    }

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        alert("请先登录");
        return;
    }

    // Convert to Base64 and Resize
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = async function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const maxSize = 200;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            const base64String = canvas.toDataURL('image/jpeg', 0.8);

            try {
                // Update profile in Supabase
                const { error } = await window.supabaseClient
                    .from('profiles')
                    .update({ avatar_url: base64String })
                    .eq('id', user.id);

                if (error) throw error;

                console.log('✅ Avatar updated in Supabase');

                // Update UI
                const { data: profile } = await window.supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                updateUserUI({
                    objectId: user.id,
                    username: user.email,
                    email: user.email,
                    nickname: profile?.username || user.user_metadata?.full_name,
                    avatarUrl: base64String
                });

                alert("头像更新成功！");

            } catch (error) {
                console.error("❌ Error updating avatar:", error);
                alert(`更新失败: ${error.message}`);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

window.handleAvatarUpload = handleAvatarUpload;

// ==================== 触发头像上传 ====================
function triggerAvatarUpload() {
    const input = document.getElementById('avatarUpload');
    if (input) {
        input.click();
    } else {
        console.warn('❌ Avatar upload input not found');
    }
}

window.triggerAvatarUpload = triggerAvatarUpload;

// ==================== 强制登出 ====================
async function forceLogout(event) {
    if (event) event.stopPropagation();

    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');
    if (dropdown) dropdown.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    if (!confirm("确定要退出登录吗？")) return;

    // 🔒 停止会话超时监控
    stopSessionTimeoutMonitor();

    try {
        await window.supabaseClient.auth.signOut();
    } catch (e) {
        console.error('Supabase signOut error:', e);
    }

    localStorage.removeItem('remembered_credentials');
    localStorage.removeItem('cached_user_profile');

    updateUserUI(null);
    console.log('✅ 已强制登出');
}

window.forceLogout = forceLogout;

// ==================== 页面加载时检查登录状态 ====================
document.addEventListener('DOMContentLoaded', async function () {
    console.log('📄 页面加载完成');

    // 🆕 Clean up malformed OAuth URLs (fix ##access_token issue)
    const currentUrl = window.location.href;
    if (currentUrl.includes('##') || (currentUrl.match(/#/g) || []).length > 1) {
        console.warn('⚠️ Detected malformed OAuth URL, cleaning up...');
        // Remove all hash content and redirect to clean URL
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }

    // 🆕 Instant UI restoration from cache (prevents avatar flash on hard refresh)
    const cachedProfile = localStorage.getItem('cached_user_profile');
    if (cachedProfile) {
        try {
            const user = JSON.parse(cachedProfile);
            console.log('⚡ Instant restore from cached profile:', user.nickname);
            updateUserUI(user);
        } catch (e) {
            console.warn('Failed to parse cached profile:', e);
        }
    }

    // 等待 Supabase 客户端初始化
    if (!window.supabaseClient) {
        console.warn('⚠️ Supabase client not ready, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 检查登录状态 (will update UI again with fresh data)
    await checkAuthState();

    // Check sessionStorage for modal flags (from Gallery navigation)
    if (sessionStorage.getItem('openProfileModal') === 'true') {
        sessionStorage.removeItem('openProfileModal');
        setTimeout(() => {
            if (typeof openProfileModal === 'function') {
                openProfileModal();
            }
        }, 300);
    }

    if (sessionStorage.getItem('openLoginModal') === 'true') {
        sessionStorage.removeItem('openLoginModal');
        setTimeout(() => {
            const loginModal = document.getElementById('loginModal');
            if (loginModal) {
                loginModal.classList.add('active');
            }
        }, 300);
    }

    // 监听邮箱输入变化，自动填充密码
    const loginEmailInput = document.getElementById('login-email');
    if (loginEmailInput) {
        loginEmailInput.addEventListener('input', function () {
            const email = this.value.trim();

            try {
                const savedPasswordsStr = localStorage.getItem('saved_passwords');
                if (savedPasswordsStr) {
                    const savedPasswords = JSON.parse(savedPasswordsStr);
                    if (savedPasswords[email]) {
                        const loginPasswordInput = document.getElementById('login-password');
                        if (loginPasswordInput) {
                            loginPasswordInput.value = atob(savedPasswords[email]);
                            console.log('✨ 已自动填充密码 for:', email);
                        }
                    }
                }
            } catch (e) {
                console.error('自动填充密码失败:', e);
            }
        });
    }

    // 全局点击监听器关闭下拉菜单
    document.addEventListener('click', function (event) {
        const dropdown = document.getElementById('userDropdown');
        const authBtn = document.getElementById('authBtn');

        if (dropdown && authBtn &&
            !authBtn.contains(event.target) &&
            !dropdown.contains(event.target)) {
            dropdown.classList.remove('active');
        }
    });

    // 监听 Supabase Auth 状态变化
    // 使用标志位避免页面加载时的重复检查
    let authStateInitialized = false;
    let authCheckDebounceTimer = null;

    window.supabaseClient.auth.onAuthStateChange((event, session) => {
        console.log('🔔 Auth state changed:', event);

        // 跳过初始的 INITIAL_SESSION 事件，因为我们已经在 checkAuthState 中处理了
        if (event === 'INITIAL_SESSION') {
            authStateInitialized = true;
            return;
        }

        // 防抖：避免短时间内多次触发
        if (authCheckDebounceTimer) {
            clearTimeout(authCheckDebounceTimer);
        }

        authCheckDebounceTimer = setTimeout(() => {
            if (event === 'SIGNED_IN' && session) {
                // 只有在非初始化阶段才重新检查状态
                if (authStateInitialized) {
                    checkAuthState();
                    // Record login IP for OAuth logins (Google, etc.)
                    recordLoginIP(session.user.id);
                }
            } else if (event === 'SIGNED_OUT') {
                updateUserUI(null);
            }
            authStateInitialized = true;
        }, 100);
    });
});

// ==================== 打开个人资料模态框 (Supabase 版本) ====================
async function openProfileModal(event) {
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');
    if (dropdown) dropdown.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    // 获取当前用户
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        alert('请先登录');
        return;
    }

    // 检查是否在主页
    const modal = document.getElementById('profileModal');
    if (!modal) {
        // 不在主页，跳转到主页并设置标记打开模态框
        sessionStorage.setItem('openProfileModal', 'true');
        window.location.href = 'index.html';
        return;
    }

    // 获取 profile
    const { data: profile } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    // 更新模态框内容
    const avatarImg = document.getElementById('profileModalAvatar');
    const emailDiv = document.getElementById('profileModalEmail');
    const nicknameSpan = document.getElementById('profileModalNickname');
    const memberSinceSpan = document.getElementById('profileMemberSince');

    if (avatarImg) {
        avatarImg.src = profile?.avatar_url || user.user_metadata?.avatar_url ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=random`;
    }

    if (emailDiv) {
        emailDiv.textContent = user.email;
    }

    if (nicknameSpan) {
        nicknameSpan.textContent = profile?.username || user.user_metadata?.full_name || user.email.split('@')[0];
    }

    if (memberSinceSpan) {
        const createdAt = new Date(user.created_at);
        const year = createdAt.getFullYear();
        const month = createdAt.getMonth() + 1;
        const day = createdAt.getDate();
        memberSinceSpan.textContent = `注册于 ${year}年${month}月${day}日`;
    }

    // 打开模态框
    modal.classList.add('active');
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.display = 'flex';

    // 重置到资料页面
    const flipInner = document.querySelector('.profile-flip-inner');
    if (flipInner) {
        flipInner.classList.remove('flipped');
    }

    // 重置tab状态
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    const profileTab = document.querySelector('.tab-item:first-child');
    if (profileTab) {
        profileTab.classList.add('active');
    }

    // Reset modal to compact width
    const profileModalElement = document.querySelector('.profile-modal');
    if (profileModalElement) {
        profileModalElement.classList.remove('wide');
    }

    // 触发资料页面的错落上升动画
    const profileFront = document.querySelector('.profile-front');
    if (profileFront) {
        setTimeout(() => {
            profileFront.classList.remove('animate-in');
            void profileFront.offsetWidth;
            profileFront.classList.add('animate-in');
        }, 50);
    }
}

window.openProfileModal = openProfileModal;

// ==================== 切换账户 (Supabase 版本) ====================
async function handleSwitchAccount(event) {
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) dropdown.classList.remove('active');

    console.log('🔄 切换账户');

    // 退出登录
    try {
        await window.supabaseClient.auth.signOut();
    } catch (e) {
        console.error('Supabase signOut error:', e);
    }

    // 清除记住的凭证
    localStorage.removeItem('remembered_credentials');
    console.log('🗑️ 已清除记住的凭证');

    // 重置UI为未登录状态
    updateUserUI(null);

    // 打开登录弹窗
    setTimeout(() => {
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.classList.add('active');
        }
    }, 100);
}

window.handleSwitchAccount = handleSwitchAccount;

// ==================== Tab 切换功能 ====================
function switchProfileTab(tabName) {
    console.log('🔄 Switching profile tab to:', tabName);

    const profileModal = document.querySelector('.profile-modal');
    const flipInner = document.querySelector('.profile-flip-inner');
    const profileFront = document.querySelector('.profile-front');
    const profileBack = document.querySelector('.profile-back');

    // Update tab buttons
    document.querySelectorAll('.profile-tabs .tab-item').forEach(item => {
        item.classList.remove('active');
    });

    if (tabName === 'profile') {
        document.querySelectorAll('.profile-tabs .tab-item')[0].classList.add('active');
        if (flipInner) flipInner.classList.remove('flipped');
        if (profileModal) profileModal.classList.remove('wide');

        if (profileFront) profileFront.style.pointerEvents = 'auto';
        if (profileBack) profileBack.style.pointerEvents = 'none';

        if (profileFront) {
            profileFront.classList.remove('animate-in');
            void profileFront.offsetWidth;
            profileFront.classList.add('animate-in');
        }

    } else if (tabName === 'security') {
        // Now security is the 2nd tab (index 1) after removing orders
        document.querySelectorAll('.profile-tabs .tab-item')[1].classList.add('active');
        if (flipInner) flipInner.classList.add('flipped');
        if (profileModal) profileModal.classList.add('wide');

        if (profileFront) profileFront.style.pointerEvents = 'none';
        if (profileBack) profileBack.style.pointerEvents = 'auto';

        if (typeof resetSecurityCards === 'function') {
            resetSecurityCards();
        }

        if (profileBack) {
            profileBack.classList.remove('animate-in');
            void profileBack.offsetWidth;
            profileBack.classList.add('animate-in');
        }
    }
}

window.switchProfileTab = switchProfileTab;

// ==================== 昵称修改功能 ====================
function toggleNicknameEdit(show) {
    const display = document.getElementById('nicknameDisplay');
    const edit = document.getElementById('nicknameEdit');
    const input = document.getElementById('nicknameInput');
    const currentNickname = document.getElementById('profileModalNickname').textContent;

    if (show) {
        display.classList.add('hiding');
        display.classList.remove('showing');
        setTimeout(() => {
            display.style.display = 'none';
            edit.style.display = 'flex';
            input.value = currentNickname;
            void edit.offsetWidth;
            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);
        }, 300);
    } else {
        edit.style.display = 'none';
        display.style.display = 'flex';
        display.classList.remove('hiding');
        void display.offsetWidth;
        display.classList.add('showing');
        setTimeout(() => {
            display.classList.remove('showing');
        }, 400);
    }
}

window.toggleNicknameEdit = toggleNicknameEdit;

// ==================== 保存昵称 (Supabase 版本) ====================
async function saveNickname() {
    const input = document.getElementById('nicknameInput');
    const newNickname = input.value.trim();

    if (!newNickname) return;

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (user) {
        try {
            // Update profile in Supabase
            const { error } = await window.supabaseClient
                .from('profiles')
                .update({ username: newNickname })
                .eq('id', user.id);

            if (error) throw error;

            // Update UI
            document.getElementById('profileModalNickname').textContent = newNickname;

            const { data: profile } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            updateUserUI({
                objectId: user.id,
                username: user.email,
                email: user.email,
                nickname: newNickname,
                avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url
            });

            toggleNicknameEdit(false);

        } catch (error) {
            alert('保存失败: ' + error.message);
            console.error(error);
        }
    }
}

window.saveNickname = saveNickname;

// ==================== 记录登录 IP + 地理位置 ====================
async function recordLoginIP(userId) {
    try {
        // 获取用户 IP 和地理信息（通过 HTTPS ipinfo.io）
        let userIP = '';
        let geoInfo = null;

        try {
            // 使用 HTTPS API 避免 Mixed Content 错误
            const geoResponse = await fetch('https://ipinfo.io/json');
            const geoData = await geoResponse.json();

            if (geoData.ip) {
                userIP = geoData.ip;
                geoInfo = {
                    country: geoData.country || '未知',
                    region: geoData.region || '未知',
                    city: geoData.city || '未知'
                };
                console.log('📍 Geo info:', geoInfo);
            }
        } catch (geoErr) {
            console.warn('Geo API failed, fallback to IP only:', geoErr);
            // Fallback to ipify
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipResponse.json();
            userIP = ipData.ip;
        }

        console.log('📍 Recording login IP:', userIP);

        // 插入登录记录（包含地理信息）
        const { error } = await window.supabaseClient
            .from('user_login_history')
            .insert({
                user_id: userId,
                ip_address: userIP,
                user_agent: navigator.userAgent,
                geo_info: geoInfo
            });

        if (error) {
            console.warn('IP recording failed:', error.message);
        } else {
            console.log('✅ Login IP + Geo recorded');
        }
    } catch (err) {
        console.warn('Failed to record IP:', err.message);
    }
}

window.recordLoginIP = recordLoginIP;

// 挂载到 window
window.handleRegister = handleRegister;
window.handleLogin = handleLogin;
window.handlePasswordReset = handlePasswordReset;
window.checkAuthState = checkAuthState;
window.updateUserUI = updateUserUI;
