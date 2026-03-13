/**
 * Supabase 版本的认证和用户管理函数
 * 替换 leancloud-auth-functions.js
 */

// Handle affiliate referrals
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    if (ref) {
        localStorage.setItem('invite_code', ref);
    }
});

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

        const inviteCode = localStorage.getItem('invite_code') || '';

        // 注册用户
        const { data, error } = await window.supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: username || email.split('@')[0],
                    avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(username || email.split('@')[0])}&background=random`,
                    invite_code: inviteCode
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
            avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(username || email.split('@')[0])}&background=random`
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
        let avatarUrl = profile?.avatar_url || data.user.user_metadata?.avatar_url || '';

        // 🆕 Auto-upload Google OAuth avatar to R2 (if Google avatar and not yet uploaded)
        if (data.user.user_metadata?.avatar_url &&
            data.user.user_metadata.avatar_url.includes('googleusercontent.com') &&
            (!profile?.avatar_url || profile.avatar_url.includes('googleusercontent.com'))) {
            console.log('📸 Uploading Google OAuth avatar to R2...');
            try {
                avatarUrl = await uploadAvatarToR2({
                    userId: data.user.id,
                    imageUrl: data.user.user_metadata.avatar_url
                });
                console.log('✅ Google avatar uploaded to R2:', avatarUrl);
            } catch (err) {
                console.warn('⚠️ Failed to upload Google avatar, using original:', err);
            }
        }

        updateUserUI({
            objectId: data.user.id,
            username: data.user.email,
            email: data.user.email,
            nickname: profile?.username || data.user.user_metadata?.full_name || data.user.email.split('@')[0],
            avatarUrl: avatarUrl
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
            // Check if email exists to distinguish between unregistered and wrong password
            try {
                const { data: emailExists } = await window.supabaseClient
                    .rpc('fn_check_email_exists', { check_email: email });

                if (!emailExists) {
                    errorMessage = '该邮箱未注册，请先注册账号';
                } else {
                    errorMessage = '密码错误，请检查后重试';
                }
            } catch (e) {
                errorMessage = '用户名或密码错误';
            }
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`登录失败: ${errorMessage}`);

        // If email is not registered, switch to register view after alert
        if (errorMessage.includes('未注册') && typeof switchAuthView === 'function') {
            switchAuthView('register');
        }
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
        updateUserUI(null, { clearCacheOnLogout: true });

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
                // 🆕 Dynamically position dropdown relative to nav bar bottom edge
                const authBtn = document.getElementById('authBtn');
                if (authBtn) {
                    const rect = authBtn.getBoundingClientRect();
                    // Find the actual nav bar container to get its true bottom edge
                    const navBar = authBtn.closest('.nav-bar') || authBtn.closest('nav') || authBtn.closest('.top-right-nav')?.parentElement;
                    let anchorBottom;
                    if (navBar) {
                        anchorBottom = navBar.getBoundingClientRect().bottom;
                    } else {
                        // Fallback: use button bottom + generous margin
                        anchorBottom = rect.bottom + 8;
                    }
                    // Align dropdown right edge with avatar button right edge
                    const rightOffset = window.innerWidth - rect.right;
                    // Use setProperty with !important to guarantee JS wins over any CSS rules
                    dropdown.style.setProperty('right', Math.max(10, rightOffset) + 'px', 'important');
                    // Shift up by 1px to fuse seamlessly with nav bar (same as nav-dropdown-portal)
                    dropdown.style.setProperty('top', (anchorBottom - 1) + 'px', 'important');
                }
                dropdown.classList.add('active');
                if (overlay) overlay.classList.add('active');

                // Pre-fetch wallet data so 'My Orders' opens instantly
                if (window.WalletModal && window.WalletModal.prefetchData) {
                    window.WalletModal.prefetchData();
                }
            }
        }

        // Note: Background verification happens via auth state listener, 
        // no need to await getUser() here for dropdown toggle
    } else {
        // User is not logged in - open login modal
        if (typeof window.openLoginModal === 'function') {
            window.openLoginModal();
        } else {
            const loginModal = document.getElementById('loginModal');
            if (loginModal) {
                loginModal.classList.add('active');
                loginModal.style.visibility = 'visible';
                loginModal.style.opacity = '1';
            }
        }
    }
}

window.handleAuthClick = handleAuthClick;

// ==================== 检查登录状态 (Supabase 版本) ====================
function readCachedUserProfile() {
    try {
        const raw = localStorage.getItem('cached_user_profile');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function hasCachedIdentity(profile) {
    if (!profile) return false;
    return !!(profile.objectId || profile.id || profile.user_id || profile.email);
}

async function checkAuthState(options = {}) {
    const { allowSoftNull = true } = options;
    console.log('🔍 检查登录状态...');

    const cachedProfile = readCachedUserProfile();
    let user = null;

    // 🔍 Boot diagnostic: Check raw localStorage before Supabase parses it
    const sbKeys = Object.keys(localStorage).filter(k => k.startsWith('sb-'));
    console.log('🔍 [checkAuthState] localStorage sb- keys at check time:', sbKeys);
    if (sbKeys.length > 0) {
        const rawVal = localStorage.getItem(sbKeys[0]);
        console.log('🔍 [checkAuthState] Raw session key value exists:', !!rawVal, 'length:', rawVal?.length);
    }

    try {
        // getSession() is local-storage based and returns immediately.
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        console.log('🔍 [checkAuthState] getSession result:', session ? 'HAS SESSION' : 'NULL', error?.message || '');
        if (error) {
            console.warn('⚠️ getSession failed:', error.message);
        }
        user = session?.user || null;
    } catch (err) {
        console.warn('⚠️ getSession exception:', err.message);
    }

    if (!user) {
        // 🛡️ During init period: Supabase's in-memory session may be cleared even though
        // localStorage still has valid tokens (protected by guard storage adapter).
        // Try to restore the session from localStorage into Supabase's memory.
        const pageAge = Date.now() - (window._pageLoadTime || 0);
        if (pageAge < 5000) {
            const sbKeys = Object.keys(localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
            for (const key of sbKeys) {
                try {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    const token = parsed?.access_token || parsed?.currentSession?.access_token;

                    if (token) {
                        // CRITICAL FIX: setSession() triggers a network request that fails on custom domain CORS.
                        // We bypass the network entirely by manually decoding the JWT payload from our guarded storage.
                        const payload = decodeJwtPayload(token);

                        // Verify token is not expired (with 5 min buffer)
                        const now = Math.floor(Date.now() / 1000);
                        if (payload && payload.exp && payload.exp > (now + 300)) {
                            console.log('🔄 Restored session locally from guarded JWT payload (bypassed network)!');

                            // Reconstruct the user object format that Supabase checkAuthState expects
                            user = {
                                id: payload.sub,
                                email: payload.email,
                                user_metadata: payload.user_metadata || {}
                            };

                            // Immediately update the UI to prevent race condition with INITIAL_SESSION
                            updateUserUI(user, { animateAvatar: false });
                            window._localJwtRestored = true;

                            break;
                        } else {
                            console.warn('⚠️ Guarded token is expired or invalid.');
                        }
                    }
                } catch (e) {
                    console.warn('⚠️ Session restore parse error:', e);
                }
            }
        }
    }

    if (!user) {
        // Avoid false "logged-out" flash during cross-page session restore.
        if (allowSoftNull && hasCachedIdentity(cachedProfile)) {
            console.log('⚡ Session pending, keep cached logged-in UI');
            updateUserUI(cachedProfile, { animateAvatar: false, preferImmediateAvatar: true });
            setTimeout(() => {
                checkAuthState({ allowSoftNull: false });
            }, 900);
            return;
        }

        console.log('❌ 用户未登录');
        updateUserUI(null, { clearCacheOnLogout: true });
        return;
    }

    console.log('✅ 用户已登录:', user);

    const cachedAvatarCandidate = cachedProfile?.avatarUrl;
    const cleanCachedAvatar = (isUsableAvatarUrl(cachedAvatarCandidate) &&
        !isGeneratedAvatarUrl(cachedAvatarCandidate) &&
        !isTransientAvatarUrl(cachedAvatarCandidate))
        ? String(cachedAvatarCandidate).trim()
        : '';
    const optimisticAvatar = cleanCachedAvatar || user.user_metadata?.avatar_url || '';

    const optimisticUser = {
        objectId: user.id,
        username: user.email,
        email: user.email,
        nickname: cachedProfile?.nickname || user.user_metadata?.full_name || user.email.split('@')[0],
        avatarUrl: optimisticAvatar || ''
    };
    updateUserUI(optimisticUser, { animateAvatar: false, preferImmediateAvatar: true });

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

    // Always prefer profile.avatar_url (custom uploads are persisted to R2 there).
    let avatarUrl = validCustomAvatar || cleanCachedAvatar || user.user_metadata?.avatar_url || '';
    const resolvedNickname = profile?.username || user.user_metadata?.full_name || user.email.split('@')[0];

    // 🆕 Auto-upload Google OAuth avatar to R2 asynchronously (non-blocking)
    if (user.user_metadata?.avatar_url &&
        user.user_metadata.avatar_url.includes('googleusercontent.com') &&
        (!profile?.avatar_url || profile.avatar_url.includes('googleusercontent.com'))) {
        // Do not await to avoid blocking UI update
        setTimeout(async () => {
            console.log('📸 [checkAuthState] Google avatar detected, uploading to R2 in background...');
            try {
                if (typeof uploadAvatarToR2 === 'function') {
                    const r2Url = await uploadAvatarToR2({
                        userId: user.id,
                        imageUrl: user.user_metadata.avatar_url
                    });
                    if (r2Url && !r2Url.includes('dicebear.com')) {
                        updateUserUI({
                            objectId: user.id,
                            username: user.email,
                            email: user.email,
                            nickname: resolvedNickname,
                            avatarUrl: r2Url
                        }, { animateAvatar: false });
                        console.log('✅ Google avatar uploaded to R2 and updated:', r2Url);
                    }
                }
            } catch (err) {
                console.warn('⚠️ Failed to upload Google avatar to R2:', err.message);
            }
        }, 100);
    }

    updateUserUI({
        objectId: user.id,
        username: user.email,
        email: user.email,
        nickname: resolvedNickname,
        avatarUrl: avatarUrl
    }, { animateAvatar: false });

    // 🔒 启动会话超时监控
    startSessionTimeoutMonitor();
}

// ==================== 更新用户UI ====================
const ADMIN_EMAILS = ['zaoyoe@gmail.com'];

function normalizeAvatarUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url, window.location.origin);
        return `${u.origin}${u.pathname}`;
    } catch (_) {
        return String(url).split('?')[0];
    }
}

function getAvatarFallbackUrl(seed) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(seed || 'User')}&background=6b9ece&color=fff`;
}

function isGeneratedAvatarUrl(url) {
    if (!url) return false;
    return /ui-avatars\.com|dicebear\.com/i.test(String(url));
}

function isTransientAvatarUrl(url) {
    if (!url) return false;
    return /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(String(url));
}

function isUsableAvatarUrl(url) {
    if (!url) return false;
    const value = String(url).trim();
    if (!value) return false;
    if (value.startsWith('http')) return true;
    if (value.startsWith('data:') && value.length > 100) return true;
    return false;
}

function setProfileModalAvatar(avatarUrl, fallbackSeed = 'User', options = {}) {
    const { preferImmediate = false, keepCurrentOnEmpty = true } = options;
    const profileModalAvatar = document.getElementById('profileModalAvatar');
    if (!profileModalAvatar) return;

    const fallbackUrl = getAvatarFallbackUrl(fallbackSeed);
    const currentRaw = profileModalAvatar.getAttribute('src') || profileModalAvatar.src || '';
    const incomingUrl = isUsableAvatarUrl(avatarUrl) ? String(avatarUrl).trim() : '';
    if (!incomingUrl) {
        if (keepCurrentOnEmpty) return;
        profileModalAvatar.src = fallbackUrl;
        return;
    }

    const targetUrl = incomingUrl;
    const currentBase = normalizeAvatarUrl(currentRaw);
    const targetBase = normalizeAvatarUrl(targetUrl);
    if (currentBase && currentBase === targetBase) return;

    const applySrc = (url) => {
        profileModalAvatar.onerror = function () {
            const failedBase = normalizeAvatarUrl(this.src || '');
            const fallbackBase = normalizeAvatarUrl(fallbackUrl);
            if (failedBase === fallbackBase) return;
            this.src = fallbackUrl;
        };
        profileModalAvatar.src = url;
    };

    if (preferImmediate || !currentRaw) {
        applySrc(targetUrl);
        return;
    }

    const probe = new Image();
    probe.onload = () => applySrc(targetUrl);
    probe.onerror = () => {
        if (keepCurrentOnEmpty) return;
        applySrc(fallbackUrl);
    };
    probe.src = targetUrl;
}

function updateUserUI(user, options = {}) {
    const { animateAvatar = false, preferImmediateAvatar = false, clearCacheOnLogout = false } = options;
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');
    const userDropdown = document.getElementById('userDropdown');
    const profileModalEmail = document.getElementById('profileModalEmail');
    const enterStudioBtn = document.getElementById('enterStudioBtn');

    if (user) {
        console.log('👤 updateUserUI: 用户已登录', user);

        // Check if user is admin
        const isAdmin = ADMIN_EMAILS.includes(user.email);

        if (navAvatar) {
            const fallbackSeed = user.email || user.username || user.nickname || 'User';
            const fallbackUrl = getAvatarFallbackUrl(fallbackSeed);
            const incomingAvatarUrl = isUsableAvatarUrl(user.avatarUrl) ? String(user.avatarUrl).trim() : '';
            let cachedAvatarUrl = '';
            try {
                const cachedRaw = localStorage.getItem('cached_user_profile');
                if (cachedRaw) {
                    const cachedUser = JSON.parse(cachedRaw);
                    const sameUser = (cachedUser?.objectId && user.objectId && cachedUser.objectId === user.objectId) ||
                        (cachedUser?.email && user.email && cachedUser.email === user.email);
                    if (sameUser && isUsableAvatarUrl(cachedUser?.avatarUrl) && !isGeneratedAvatarUrl(cachedUser?.avatarUrl)) {
                        cachedAvatarUrl = String(cachedUser.avatarUrl).trim();
                    }
                }
            } catch (_) {
                // ignore cache parse errors
            }

            const preferredAvatarUrl = (isTransientAvatarUrl(incomingAvatarUrl) && cachedAvatarUrl)
                ? cachedAvatarUrl
                : (incomingAvatarUrl || cachedAvatarUrl || fallbackUrl);

            const hasVisibleAvatar = navAvatar.style.display !== 'none' && navAvatar.classList.contains('show');

            // If we already have the exact same image showing, do nothing
            const currentRaw = navAvatar.getAttribute('src') || navAvatar.src || '';
            if (currentRaw && normalizeAvatarUrl(currentRaw) === normalizeAvatarUrl(preferredAvatarUrl) && hasVisibleAvatar) {
                // Already showing the correct image
            } else {
                // Keep the current state (either old avatar or default icon) visible
                // and load the new avatar silently in the background
                const preloader = new Image();
                preloader.onload = () => {
                    navAvatar.src = preferredAvatarUrl;
                    navAvatar.style.display = 'inline-block';
                    navAvatar.style.visibility = 'visible';
                    navAvatar.style.opacity = '1';
                    navAvatar.classList.add('show');
                    if (defaultIcon) defaultIcon.style.display = 'none';

                    if (animateAvatar) {
                        navAvatar.classList.remove('animate-in');
                        void navAvatar.offsetWidth; // Force reflow
                        navAvatar.classList.add('animate-in');
                    }
                };
                preloader.onerror = () => {
                    console.warn(`⚠️ Failed to load avatar from: ${preferredAvatarUrl}, falling back to generator.`);
                    // Only fallback to generator if it's not a google URL failure, or we must
                    if (!/googleusercontent\.com/i.test(preferredAvatarUrl) || !hasVisibleAvatar) {
                        navAvatar.src = fallbackUrl;
                        navAvatar.style.display = 'inline-block';
                        navAvatar.style.visibility = 'visible';
                        navAvatar.style.opacity = '1';
                        navAvatar.classList.add('show');
                        if (defaultIcon) defaultIcon.style.display = 'none';
                    }
                };
                preloader.src = preferredAvatarUrl;
            }
        } else if (defaultIcon) {
            defaultIcon.style.display = 'none';
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
        setProfileModalAvatar(
            user.avatarUrl,
            user.email || user.username || user.nickname || 'User'
        );
        if (userDropdown) userDropdown.style.display = '';

        // Show Enter Studio for admin only
        if (enterStudioBtn) enterStudioBtn.style.display = isAdmin ? 'flex' : 'none';

        const userForCache = { ...user };
        const cacheAvatar = isUsableAvatarUrl(userForCache.avatarUrl) ? String(userForCache.avatarUrl).trim() : '';
        if (!cacheAvatar) {
            delete userForCache.avatarUrl;
        } else {
            userForCache.avatarUrl = cacheAvatar;
        }

        try {
            const previousRaw = localStorage.getItem('cached_user_profile');
            if (previousRaw) {
                const previous = JSON.parse(previousRaw);
                const sameUser = (previous?.objectId && userForCache.objectId && previous.objectId === userForCache.objectId) ||
                    (previous?.email && userForCache.email && previous.email === userForCache.email);
                if (sameUser && isUsableAvatarUrl(previous?.avatarUrl) && !isGeneratedAvatarUrl(previous?.avatarUrl) &&
                    (isGeneratedAvatarUrl(userForCache.avatarUrl) ||
                        !isUsableAvatarUrl(userForCache.avatarUrl) ||
                        isTransientAvatarUrl(userForCache.avatarUrl))) {
                    userForCache.avatarUrl = previous.avatarUrl;
                }
            }
        } catch (_) {
            // ignore cache parse errors
        }

        if (isGeneratedAvatarUrl(userForCache.avatarUrl) || isTransientAvatarUrl(userForCache.avatarUrl)) {
            delete userForCache.avatarUrl;
        }

        localStorage.setItem('cached_user_profile', JSON.stringify(userForCache));
    } else {
        if (defaultIcon) {
            defaultIcon.className = 'fas fa-user-circle'; // Ensure spinner is cleared
            defaultIcon.style.display = 'inline';
        }
        if (navAvatar) navAvatar.style.display = 'none';
        if (btnText) btnText.textContent = 'Sign In';
        if (userDropdown) userDropdown.classList.remove('active');
        if (enterStudioBtn) enterStudioBtn.style.display = 'none';

        if (clearCacheOnLogout) {
            localStorage.removeItem('cached_user_profile');
        }
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

// ==================== Google Login (Primary: Google ID Token flow, no OAuth callback dependency) ====================
const GOOGLE_CLIENT_ID = '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com';
const DISABLE_OAUTH_REDIRECT_FALLBACK = true;
let googleIdentityScriptPromise = null;
window.currentGoogleNonce = null;
window.currentGoogleNonceHash = null;
let googleCredentialReceived = false;
let googleLoginAttemptId = 0;
let googleIdentityInitialized = false;

function shouldUseOAuthRedirectFallback() {
    if (DISABLE_OAUTH_REDIRECT_FALLBACK) return false;
    const host = window.location.hostname || '';
    return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local'));
}

function cleanupLegacyGoogleIdentityButtons() {
    document.querySelectorAll('.gsi-btn-container, .g_id_signin, [id^="gsi_"]').forEach((node) => {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    });

    document.querySelectorAll('.google-login-btn').forEach((btn) => {
        btn.classList.remove('gsi-hidden');
        btn.removeAttribute('aria-hidden');
        btn.removeAttribute('tabindex');
    });
}

function resolveActiveGoogleButton() {
    if (document.activeElement && document.activeElement.classList?.contains('google-login-btn')) {
        return document.activeElement;
    }
    return document.querySelector(
        '#loginModal.active .google-login-btn, #adminLoginModal.active .google-login-btn, #loginModal .google-login-btn, #adminLoginModal .google-login-btn, .google-login-btn'
    );
}

function setGoogleButtonsLoading(isLoading, text = '正在登录...') {
    document.querySelectorAll('.google-login-btn').forEach((btn) => {
        if (isLoading) {
            if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
            btn.dataset.googleBusy = '1';
            btn.innerHTML = `<i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i><span>${text}</span>`;
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.75';
        } else {
            if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
            delete btn.dataset.originalHtml;
            delete btn.dataset.googleBusy;
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
        }
    });
}

function clearInlineGoogleFallbackButtons() {
    document.querySelectorAll('.gsi-btn-container[data-inline-fallback="1"]').forEach((node) => {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    document.querySelectorAll('.google-login-btn.gsi-hidden').forEach((btn) => {
        btn.classList.remove('gsi-hidden');
        btn.removeAttribute('aria-hidden');
        btn.removeAttribute('tabindex');
    });
}

// showInlineGoogleFallbackButtons removed - single custom button in inject-auth.js

// Nonce generation removed: Chrome FedCM breaks nonce sync with Supabase

async function loadGoogleIdentityServices() {
    cleanupLegacyGoogleIdentityButtons();
    if (window.google?.accounts?.id) return true;

    if (!googleIdentityScriptPromise) {
        googleIdentityScriptPromise = new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 3;

            const appendScript = () => {
                attempts += 1;

                const stale = document.getElementById('gsi-script');
                if (stale) stale.remove();

                const script = document.createElement('script');
                script.src = `https://accounts.google.com/gsi/client?retry=${attempts}&t=${Date.now()}`;
                script.id = 'gsi-script';
                script.async = true;
                script.defer = true;

                script.onload = () => {
                    if (window.google?.accounts?.id) {
                        resolve(true);
                        return;
                    }
                    if (attempts < maxAttempts) {
                        setTimeout(appendScript, 250);
                    } else {
                        googleIdentityScriptPromise = null;
                        reject(new Error('Google GSI script load failed (api unavailable)'));
                    }
                };

                script.onerror = () => {
                    if (attempts < maxAttempts) {
                        setTimeout(appendScript, 250);
                    } else {
                        googleIdentityScriptPromise = null;
                        reject(new Error('Google GSI script load failed'));
                    }
                };

                document.head.appendChild(script);
            };

            appendScript();
        });
    }

    await googleIdentityScriptPromise;
    return !!window.google?.accounts?.id;
}

async function initGoogleIdTokenFlow() {
    if (googleIdentityInitialized && window.google?.accounts?.id) return;

    // We used to wipe storage here to clear stuck PKCE nonces, but that is no longer needed
    // since we use a custom popup flow, and it was violently destroying the user's session!

    // Initialize the Google Accounts script manually in case FedCM fallback is ever needed
    // or to keep the Google object initialized properly.
    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
            if (typeof window.handleGoogleCredentialResponse === 'function') {
                window.handleGoogleCredentialResponse(response);
            } else {
                console.error('❌ Google callback handler not ready');
                setGoogleButtonsLoading(false);
            }
        },
        context: 'signin',
        auto_select: false,
        itp_support: true,
        use_fedcm_for_prompt: true,
        use_fedcm_for_button: true
    });
    googleIdentityInitialized = true;
}

async function ensureGoogleInlineButtonReady(options = {}) {
    const loaded = await loadGoogleIdentityServices();
    if (!loaded || !window.google?.accounts?.id) return false;
    await initGoogleIdTokenFlow();
    console.log('✅ Google Identity Services ready');
    return true;
}
window.ensureGoogleInlineButtonReady = ensureGoogleInlineButtonReady;

function decodeJwtPayload(token) {
    try {
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        return JSON.parse(atob(padded));
    } catch (_) {
        return null;
    }
}

function getCurrentPageRedirectUrl() {
    const url = new URL(window.location.href);
    url.hash = '';
    return url.toString();
}

async function triggerGoogleOAuthRedirectFallback() {
    if (!shouldUseOAuthRedirectFallback()) {
        throw new Error('OAuth redirect fallback disabled');
    }
    const currentPage = getCurrentPageRedirectUrl();
    localStorage.setItem('oauth_post_login_redirect', currentPage);
    const redirectTo = `${window.location.origin}/auth-callback.html`;
    const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo,
            scopes: 'openid email profile',
            queryParams: {
                prompt: 'select_account',
                access_type: 'offline',
                include_granted_scopes: 'true'
            }
        }
    });
    if (error) throw error;
    if (data?.url) window.location.assign(data.url);
}

// triggerGoogleLogin - Triggered when the user clicks the custom "Sign in with Google" button.
// Uses a pure client-side OAuth popup flow to get the id_token directly from Google.
// This bypasses BOTH the FedCM cooldown issues AND the Supabase server-side PKCE failure
// on the custom domain (auth.zaoyoe.com).
window.triggerGoogleLogin = async () => {
    console.log('🔵 triggerGoogleLogin called (Client-side Popup mode)');

    if (window.isGoogleLoginLoading) return;
    setGoogleButtonsLoading(true, '正在打开授权窗口...');

    try {
        openGooglePopupFallback();
        // Loading state will be cleared by the popup polling logic or after redirect
    } catch (error) {
        console.error('❌ Google login failed:', error);
        setGoogleButtonsLoading(false);
        alert('打开授权窗口失败: ' + (error.message || '请检查浏览器拦截设置'));
    }
};

// Fallback: Open Google OAuth in a popup window when One Tap is blocked
function openGooglePopupFallback() {
    const clientId = '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com';
    const redirectUri = window.location.origin;
    const scope = 'openid email profile';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=id_token` +
        `&scope=${encodeURIComponent(scope)}` +
        `&nonce=${Date.now()}` +
        `&prompt=select_account`;

    const width = 500, height = 600;
    // Calculate center relative to the entire browser window (including its toolbars)
    const browserWidth = window.outerWidth || window.innerWidth;
    const browserHeight = window.outerHeight || window.innerHeight;
    const left = window.screenX + (browserWidth - width) / 2;
    // Add a slight downward offset (+ 40px) to account for the browser's thick top toolbar
    const top = window.screenY + (browserHeight - height) / 2 + 40;

    const popup = window.open(authUrl, 'google_login',
        `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no`);

    if (!popup) {
        alert('弹窗被浏览器拦截，请允许弹窗后重试');
        return;
    }

    // Poll for the popup redirect
    const pollTimer = setInterval(() => {
        try {
            if (popup.closed) {
                clearInterval(pollTimer);
                return;
            }
            const popupUrl = popup.location.href;
            if (popupUrl.startsWith(redirectUri)) {
                clearInterval(pollTimer);
                const hash = popup.location.hash;
                popup.close();
                if (hash) {
                    const params = new URLSearchParams(hash.substring(1));
                    const idToken = params.get('id_token');
                    if (idToken) {
                        handleGoogleCredentialResponse({ credential: idToken });
                    }
                }
            }
        } catch (e) {
            // Cross-origin - popup hasn't redirected yet, keep polling
        }
    }, 500);
}

async function handleGoogleCredentialResponse(response) {
    try {
        if (!response?.credential) throw new Error('未获取到 Google 凭证');
        googleCredentialReceived = true;
        googleLoginAttemptId += 1;

        console.log('🔵 Received Google ID Token, authenticating with Supabase (no-nonce mode)...');

        // Explicitly remove any nonce matching. Just pass the token.
        // If Supabase throws "Nonces mismatch", it's because a previous attempt
        // set a cookie/localstorage state. The user MUST clear cookies/storage
        // if this happens.
        const { data, error } = await window.supabaseClient.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential
        });

        if (error) {
            if (error.message.includes('Nonces mismatch') || error.message.includes('nonce')) {
                throw new Error('检测到残留的安全验证状态，请完全清除浏览器缓存Cookie后重试 (Nonces mismatch)。');
            }
            throw error;
        }

        // 🔍 Debug: Check if session was persisted to localStorage
        console.log('🔍 Session debug - signInWithIdToken result:', data?.session ? 'HAS SESSION' : 'NO SESSION');



        if (!data?.session) {
            const { data: sessionData } = await window.supabaseClient.auth.getSession();
            if (!sessionData?.session) {
                throw new Error('Google 登录后未建立会话');
            }
        }

        if (data?.user) {
            updateUserUI({
                objectId: data.user.id,
                username: data.user.email,
                email: data.user.email,
                nickname: data.user.user_metadata?.full_name || data.user.email?.split('@')[0],
                avatarUrl: data.user.user_metadata?.avatar_url || ''
            }, { animateAvatar: false, preferImmediateAvatar: true });
        }
        clearInlineGoogleFallbackButtons();

        if (typeof closeAdminLoginModal === 'function') closeAdminLoginModal();
        if (typeof toggleLoginModal === 'function') {
            const loginModal = document.getElementById('loginModal');
            if (loginModal && (loginModal.classList.contains('active') || loginModal.style.visibility === 'visible')) {
                toggleLoginModal();
            }
        }
        if (typeof checkAuthState === 'function') {
            await checkAuthState();
        }
    } catch (error) {
        console.error('❌ Google ID Token login error:', error);
        alert('Google 登录失败: ' + (error.message || '请稍后重试'));
    } finally {
        setGoogleButtonsLoading(false);
    }
}
window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;
// ==================== 图片压缩助手 ====================
function resizeImage(file, maxSize = 200) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                let width = img.width;
                let height = img.height;

                // Calculate new dimensions
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

                // Convert to JPEG with 80% quality
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                resolve(base64);
            };

            img.onerror = reject;
            img.src = e.target.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ==================== R2 头像上传助手 ====================
async function uploadAvatarToR2({ userId, imageUrl, imageData }) {
    try {
        console.log(`📸 Uploading avatar for user: ${userId}`);

        // Get current user token
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) {
            throw new Error('User not authenticated');
        }

        const SUPABASE_URL = 'https://auth.zaoyoe.com';

        // Call Edge Function
        const response = await fetch(
            `${SUPABASE_URL}/functions/v1/upload-avatar`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId,
                    imageUrl,
                    imageData
                })
            }
        );

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }

        const { imageUrl: avatarUrl } = await response.json();
        console.log(`✅ Avatar uploaded: ${avatarUrl}`);

        // Update profile in database
        const { error: dbError } = await window.supabaseClient
            .from('profiles')
            .update({ avatar_url: avatarUrl })
            .eq('id', userId);

        if (dbError) {
            console.error('❌ Failed to update profile:', dbError);
            // Avatar uploaded but DB update failed - not critical
        }

        return avatarUrl;

    } catch (error) {
        console.error('❌ Error uploading avatar:', error);

        // Fallback to DiceBear default avatar
        const fallbackUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;
        console.log(`⚠️ Using fallback avatar: ${fallbackUrl}`);

        return fallbackUrl;
    }
}

// ==================== 头像上传 (R2版本 - via Edge Function) ====================
async function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert("图片大小不能超过 5MB");
        return;
    }

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        alert("请先登录");
        return;
    }

    try {
        console.log('📸 Starting avatar upload to R2...');

        // Show loading indicator
        const submitBtn = event.target.closest('form')?.querySelector('button');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '上传中...';
        }

        // Resize image on client side
        const base64Data = await resizeImage(file, 200);

        // Upload to R2 via Edge Function
        const avatarUrl = await uploadAvatarToR2({
            userId: user.id,
            imageData: base64Data
        });

        console.log('✅ Avatar uploaded successfully:', avatarUrl);

        // Update UI immediately
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
            avatarUrl: avatarUrl
        });

        alert("头像更新成功！");

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '上传头像';
        }

    } catch (error) {
        console.error("❌ Error uploading avatar:", error);
        alert(`上传失败: ${error.message}`);

        const submitBtn = event.target.closest('form')?.querySelector('button');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '上传头像';
        }
    }
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
        // Force unlock the storage guard before intentional logout
        // otherwise if user logs out within 3s of loading, it gets blocked!
        if (typeof guardStorage !== 'undefined') {
            guardStorage._locked = false;
        }
        await window.supabaseClient.auth.signOut();
    } catch (e) {
        console.error('Supabase signOut error:', e);
    }

    // 🔴 CRITICAL FIX: Manually delete the token because signOut() will abort 
    // and fail to delete it if the network request is blocked by CORS!
    const wipeStorage = (storage) => {
        const keysToRemove = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && (key.includes('-auth-token') || key.includes('supabase.auth') || key.startsWith('sb-'))) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => storage.removeItem(k));
    };
    wipeStorage(localStorage);
    wipeStorage(sessionStorage);

    localStorage.removeItem('remembered_credentials');
    localStorage.removeItem('cached_user_profile');

    updateUserUI(null, { clearCacheOnLogout: true });
    console.log('✅ 已强制登出');
}

window.forceLogout = forceLogout;


// ==================== 页面加载时检查登录状态 ====================
async function initializeAuthPageBoot() {
    console.log('📄 页面加载完成');

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

    // 初始化 Google Identity Services
    try {
        await ensureGoogleInlineButtonReady();
    } catch (err) {
        console.warn('⚠️ Google identity preload failed:', err?.message || err);
    }

    // 🆕 OAuth Callback Handler:
    // Handle BOTH PKCE flow (?code=XXXX) and Implicit flow (#access_token=...)
    const urlParams = new URLSearchParams(window.location.search);
    const oauthCode = urlParams.get('code');
    const hashHasToken = window.location.hash && window.location.hash.includes('access_token=');

    if (oauthCode) {
        // ===== PKCE Flow (default for signInWithOAuth) =====
        // Google returned ?code=XXXX which we must exchange for a session
        console.log('🔐 Detected PKCE OAuth code in URL, exchanging for session...');
        try {
            const { data, error } = await window.supabaseClient.auth.exchangeCodeForSession(oauthCode);
            if (error) {
                console.error('❌ exchangeCodeForSession failed:', error.message);
            } else if (data?.session) {
                console.log('✅ PKCE code exchanged successfully! User logged in.');
            }
        } catch (err) {
            console.error('❌ PKCE exchange exception:', err.message);
        }
        // Clean URL regardless of success/failure
        const url = new URL(window.location.href);
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}` || '/');
    } else if (hashHasToken) {
        // ===== Implicit Flow (#access_token=...) =====
        console.log('🔐 Detected implicit OAuth token in URL hash. Waiting for Supabase...');
        let sessionGrabbed = false;
        for (let i = 0; i < 15; i++) {
            const { data } = await window.supabaseClient.auth.getSession();
            if (data?.session) {
                console.log('✅ Session extracted from URL hash after', i * 200, 'ms');
                sessionGrabbed = true;
                const url = new URL(window.location.href);
                window.history.replaceState({}, document.title, `${url.pathname}${url.search}` || '/');
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (!sessionGrabbed) {
            console.warn('⚠️ Timed out waiting for implicit OAuth session from URL hash.');
        }
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
            if (typeof window.openLoginModal === 'function') {
                window.openLoginModal();
            } else {
                const loginModal = document.getElementById('loginModal');
                if (loginModal) {
                    loginModal.classList.add('active');
                }
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

        // INITIAL_SESSION fires on page load. After OAuth redirect, this is where
        // the session tokens first arrive. We must process it if a session exists.
        if (event === 'INITIAL_SESSION') {
            authStateInitialized = true;
            if (session) {
                console.log('🔔 INITIAL_SESSION has session, updating UI...');
                checkAuthState();
            } else if (window._localJwtRestored) {
                console.log('🔔 INITIAL_SESSION is null, but local JWT already restored. Ignored.');
            }
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
                // 🛡️ Guard: Suppress SIGNED_OUT during initialization period.
                // Supabase fires SIGNED_OUT when _getUser() fails on custom domain (CORS),
                // but the session is still valid in localStorage (protected by guard storage).
                const pageAge = Date.now() - window._pageLoadTime;
                if (pageAge < 5000) {
                    console.log('🛡️ Suppressed SIGNED_OUT during init (page age: ' + pageAge + 'ms)');
                    return;
                }
                updateUserUI(null, { clearCacheOnLogout: true });
            }
            authStateInitialized = true;
        }, 100);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAuthPageBoot);
} else {
    initializeAuthPageBoot();
}

let profileModalOpenLock = false;
let lastProfileModalOpenAt = 0;
const PROFILE_MODAL_KEYBOARD_SETTLE_MS = 90;
const profileModalViewportState = {
    baseScrollY: 0,
    ownsFullScrollLock: false,
    viewportCleanup: null,
    viewportRafId: null,
    stableViewportProbe: null,
    baseViewportHeight: 0,
    baseCardHeight: 0,
    docked: false,
    lastBottomInset: 0,
    initialDockTimer: null,
    insetDropTimer: null,
    pendingInset: 0
};

function isProfileModalKeyboardDockEnabled() {
    const ua = navigator.userAgent || '';
    const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isiOS && window.matchMedia('(max-width: 768px)').matches && !!window.visualViewport;
}

function getProfileModalElements() {
    const overlay = document.getElementById('profileModal');
    return {
        overlay,
        card: overlay?.querySelector('.profile-modal') || null,
        inputs: overlay ? Array.from(overlay.querySelectorAll('input, textarea, select')) : []
    };
}

function getActiveProfileModalInput() {
    const { overlay } = getProfileModalElements();
    const active = document.activeElement;
    if (!overlay || !active || !overlay.contains(active)) return null;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
}

function focusProfileModalInputWithoutScroll(input) {
    if (!input) return;
    try {
        input.focus({ preventScroll: true });
    } catch (_) {
        input.focus();
    }
}

function bindProfileModalInputFocusStabilizer(input) {
    if (!input || input.dataset.profileFocusStabilizerBound === '1') return;

    input.addEventListener('touchstart', (event) => {
        const { overlay } = getProfileModalElements();
        if (!isProfileModalKeyboardDockEnabled() || !overlay?.classList.contains('active')) return;
        if (event.cancelable) event.preventDefault();
        focusProfileModalInputWithoutScroll(input);
    }, { passive: false });

    input.dataset.profileFocusStabilizerBound = '1';
}

function getProfileStableViewportProbe() {
    if (profileModalViewportState.stableViewportProbe?.isConnected) {
        return profileModalViewportState.stableViewportProbe;
    }

    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'fixed';
    probe.style.top = '0';
    probe.style.left = '0';
    probe.style.width = '0';
    probe.style.height = '100svh';
    probe.style.pointerEvents = 'none';
    probe.style.visibility = 'hidden';
    probe.style.opacity = '0';
    probe.style.zIndex = '-1';
    document.body.appendChild(probe);
    profileModalViewportState.stableViewportProbe = probe;
    return probe;
}

function getProfileStableViewportHeight() {
    const probe = getProfileStableViewportProbe();
    return Math.max(0, Math.round(probe.getBoundingClientRect().height || probe.offsetHeight || 0));
}

function clearProfileModalKeyboardTimers() {
    if (profileModalViewportState.initialDockTimer) {
        clearTimeout(profileModalViewportState.initialDockTimer);
        profileModalViewportState.initialDockTimer = null;
    }
    if (profileModalViewportState.insetDropTimer) {
        clearTimeout(profileModalViewportState.insetDropTimer);
        profileModalViewportState.insetDropTimer = null;
    }
    profileModalViewportState.pendingInset = 0;
}

function captureProfileModalKeyboardBase() {
    const vv = window.visualViewport;
    const { card } = getProfileModalElements();
    const visualHeight = Math.max(0, vv?.height || 0);
    const fallbackBaseHeight = Math.max(
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualHeight
    );
    const stableViewportHeight = getProfileStableViewportHeight();
    const normalizedBaseHeight = (stableViewportHeight > 0 && stableViewportHeight + 24 < fallbackBaseHeight)
        ? stableViewportHeight
        : fallbackBaseHeight;

    profileModalViewportState.baseViewportHeight = normalizedBaseHeight;
    if (card) {
        const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 680);
        profileModalViewportState.baseCardHeight = Math.max(420, liveHeight || 680);
    }
}

function getProfileModalViewportMetrics() {
    const vv = window.visualViewport;
    const visualHeight = Math.max(0, vv?.height || 0);
    const baseVisualHeight = profileModalViewportState.baseViewportHeight || visualHeight;

    return {
        visualHeight,
        baseVisualHeight,
        bottomInset: Math.max(0, Math.round(baseVisualHeight - visualHeight))
    };
}

function applyProfileModalKeyboardDock(bottomInset) {
    const { overlay, card } = getProfileModalElements();
    if (!overlay || !card) return;

    overlay.classList.add('keyboard-docked');

    const metrics = getProfileModalViewportMetrics();
    if (!profileModalViewportState.baseCardHeight) {
        const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 680);
        profileModalViewportState.baseCardHeight = Math.max(420, liveHeight || 680);
    }

    const baseCardHeight = Math.max(420, profileModalViewportState.baseCardHeight || 680);
    const baseViewportHeight = Math.max(
        metrics.baseVisualHeight || 0,
        profileModalViewportState.baseViewportHeight || 0
    );
    const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
    const minTop = 16;
    const keyboardClearance = 24;
    const maxAvailableHeight = Math.max(360, Math.round(keyboardTop - minTop - keyboardClearance));
    const liveDockedHeight = Math.round(card.getBoundingClientRect().height || 0);
    const preferredCardHeight = Math.max(
        420,
        Math.round(card.scrollHeight || 0),
        liveDockedHeight,
        baseCardHeight
    );
    const finalCardHeight = Math.min(preferredCardHeight, maxAvailableHeight);
    const centeredTop = (baseViewportHeight - finalCardHeight) / 2;
    const desiredTop = Math.max(minTop, keyboardTop - keyboardClearance - finalCardHeight);
    const shiftY = Math.round(desiredTop - centeredTop);

    overlay.style.setProperty('--profile-modal-shift-y', `${shiftY}px`);
    card.style.height = 'auto';
    card.style.maxHeight = `${maxAvailableHeight}px`;
    profileModalViewportState.docked = bottomInset > 0;
    profileModalViewportState.lastBottomInset = Math.max(0, bottomInset);
}

function releaseProfileModalKeyboardDock() {
    const { overlay, card } = getProfileModalElements();
    if (!overlay || !card) return;

    overlay.classList.remove('keyboard-docked');
    overlay.style.setProperty('--profile-modal-shift-y', '0px');
    card.style.removeProperty('height');
    card.style.removeProperty('max-height');
    profileModalViewportState.docked = false;
    profileModalViewportState.lastBottomInset = 0;
}

function resetProfileModalViewportState() {
    clearProfileModalKeyboardTimers();
    if (profileModalViewportState.viewportRafId) {
        cancelAnimationFrame(profileModalViewportState.viewportRafId);
        profileModalViewportState.viewportRafId = null;
    }
    releaseProfileModalKeyboardDock();
    profileModalViewportState.baseViewportHeight = 0;
    profileModalViewportState.baseCardHeight = 0;
}

function syncProfileModalKeyboardDock() {
    const { overlay, card } = getProfileModalElements();
    if (!overlay || !card || !overlay.classList.contains('active')) {
        resetProfileModalViewportState();
        return;
    }

    if (!isProfileModalKeyboardDockEnabled()) {
        releaseProfileModalKeyboardDock();
        return;
    }

    const activeInput = getActiveProfileModalInput();
    const metrics = getProfileModalViewportMetrics();
    const bottomInset = metrics.bottomInset;
    const shouldDock = !!activeInput && (profileModalViewportState.docked ? bottomInset > 8 : bottomInset > 24);
    const nextInset = shouldDock ? bottomInset : 0;
    const previousInset = profileModalViewportState.lastBottomInset;
    const isInsetDroppingWhileFocused = profileModalViewportState.docked &&
        !!activeInput &&
        nextInset > 24 &&
        nextInset + 24 < previousInset;

    if (!profileModalViewportState.docked && shouldDock) {
        profileModalViewportState.pendingInset = nextInset;
        if (!profileModalViewportState.initialDockTimer) {
            profileModalViewportState.initialDockTimer = setTimeout(() => {
                profileModalViewportState.initialDockTimer = null;
                if (!getActiveProfileModalInput()) return;
                const liveMetrics = getProfileModalViewportMetrics();
                if (liveMetrics.bottomInset <= 24) return;
                applyProfileModalKeyboardDock(liveMetrics.bottomInset);
            }, PROFILE_MODAL_KEYBOARD_SETTLE_MS);
        }
        return;
    }

    if (profileModalViewportState.initialDockTimer &&
        (profileModalViewportState.docked || !shouldDock)) {
        clearTimeout(profileModalViewportState.initialDockTimer);
        profileModalViewportState.initialDockTimer = null;
    }

    if (profileModalViewportState.insetDropTimer &&
        (!isInsetDroppingWhileFocused || nextInset >= previousInset)) {
        clearTimeout(profileModalViewportState.insetDropTimer);
        profileModalViewportState.insetDropTimer = null;
        profileModalViewportState.pendingInset = 0;
    }

    if (isInsetDroppingWhileFocused) {
        profileModalViewportState.pendingInset = nextInset;
        if (!profileModalViewportState.insetDropTimer) {
            profileModalViewportState.insetDropTimer = setTimeout(() => {
                profileModalViewportState.insetDropTimer = null;
                const settledInset = profileModalViewportState.pendingInset;
                profileModalViewportState.pendingInset = 0;
                if (settledInset > 24) {
                    applyProfileModalKeyboardDock(settledInset);
                }
            }, PROFILE_MODAL_KEYBOARD_SETTLE_MS);
        }
        return;
    }

    if (profileModalViewportState.docked && activeInput && nextInset <= 24) {
        return;
    }

    if (nextInset > 24) {
        applyProfileModalKeyboardDock(nextInset);
        return;
    }

    if (profileModalViewportState.docked) {
        releaseProfileModalKeyboardDock();
    }
}

function keepActiveProfileModalFieldInView() {
    const { card } = getProfileModalElements();
    const activeInput = getActiveProfileModalInput();
    if (!card || !activeInput) return;

    const cardRect = card.getBoundingClientRect();
    const inputRect = activeInput.getBoundingClientRect();
    const topBuffer = 92;
    const bottomBuffer = 132;
    let scrollDelta = 0;

    if (inputRect.top < cardRect.top + topBuffer) {
        scrollDelta = inputRect.top - (cardRect.top + topBuffer);
    } else if (inputRect.bottom > cardRect.bottom - bottomBuffer) {
        scrollDelta = inputRect.bottom - (cardRect.bottom - bottomBuffer);
    }

    if (scrollDelta !== 0) {
        card.scrollTop += scrollDelta;
    }
}

function attachProfileModalKeyboardDock() {
    if (!isProfileModalKeyboardDockEnabled()) return;

    const { overlay, inputs } = getProfileModalElements();
    const vv = window.visualViewport;
    if (!overlay || !vv) return;

    detachProfileModalKeyboardDock();
    captureProfileModalKeyboardBase();
    syncProfileModalKeyboardDock();

    inputs.forEach((input) => bindProfileModalInputFocusStabilizer(input));

    const handleViewportChange = () => {
        if (profileModalViewportState.viewportRafId) return;
        profileModalViewportState.viewportRafId = requestAnimationFrame(() => {
            profileModalViewportState.viewportRafId = null;
            syncProfileModalKeyboardDock();
            keepActiveProfileModalFieldInView();
        });
    };

    vv.addEventListener('resize', handleViewportChange, { passive: true });
    vv.addEventListener('scroll', handleViewportChange, { passive: true });
    inputs.forEach((input) => {
        input.addEventListener('focus', handleViewportChange);
        input.addEventListener('blur', handleViewportChange);
    });

    profileModalViewportState.viewportCleanup = () => {
        vv.removeEventListener('resize', handleViewportChange);
        vv.removeEventListener('scroll', handleViewportChange);
        inputs.forEach((input) => {
            input.removeEventListener('focus', handleViewportChange);
            input.removeEventListener('blur', handleViewportChange);
        });
        if (profileModalViewportState.viewportRafId) {
            cancelAnimationFrame(profileModalViewportState.viewportRafId);
            profileModalViewportState.viewportRafId = null;
        }
        profileModalViewportState.viewportCleanup = null;
    };
}

function detachProfileModalKeyboardDock() {
    if (typeof profileModalViewportState.viewportCleanup === 'function') {
        profileModalViewportState.viewportCleanup();
    }
    clearProfileModalKeyboardTimers();
}

function hydrateProfileModalFromCache() {
    const nicknameSpan = document.getElementById('profileModalNickname');
    const emailDiv = document.getElementById('profileModalEmail');

    try {
        const cachedRaw = localStorage.getItem('cached_user_profile');
        if (!cachedRaw) return;

        const cached = JSON.parse(cachedRaw);
        if (!cached) return;

        const cachedNickname = cached.nickname || cached.username || cached.email?.split('@')[0] || '';
        const cachedEmail = cached.email || '';

        if (cachedNickname && nicknameSpan) {
            nicknameSpan.textContent = cachedNickname;
        }
        if (cachedEmail && emailDiv) {
            emailDiv.textContent = cachedEmail;
        }
        if (cached.avatarUrl || cachedEmail || cachedNickname) {
            setProfileModalAvatar(cached.avatarUrl, cachedEmail || cachedNickname || 'User');
        }
    } catch (_) {
        // Ignore cache parse issues and fall back to live data.
    }
}

function resetProfileModalViewState() {
    const { overlay, card } = getProfileModalElements();
    const flipInner = document.querySelector('.profile-flip-inner');
    const profileFront = document.querySelector('.profile-front');
    const profileBack = document.querySelector('.profile-back');
    const nicknameDisplay = document.getElementById('nicknameDisplay');
    const nicknameEdit = document.getElementById('nicknameEdit');

    if (flipInner) {
        flipInner.classList.remove('flipped');
    }

    document.querySelectorAll('.tab-item').forEach((tab) => {
        tab.classList.remove('active');
    });
    const profileTab = document.querySelector('.tab-item:first-child');
    if (profileTab) {
        profileTab.classList.add('active');
    }

    if (card) {
        card.classList.remove('wide');
        card.scrollTop = 0;
    }

    if (profileFront) {
        profileFront.style.pointerEvents = 'auto';
        profileFront.classList.remove('animate-in');
    }
    if (profileBack) {
        profileBack.style.pointerEvents = 'none';
        profileBack.classList.remove('animate-in');
    }

    if (nicknameDisplay && nicknameEdit) {
        nicknameEdit.style.display = 'none';
        nicknameDisplay.style.display = 'flex';
        nicknameDisplay.classList.remove('hiding', 'showing');
    }

    if (typeof resetSecurityCards === 'function') {
        resetSecurityCards();
    }

    if (overlay) {
        overlay.classList.remove('keyboard-docked', 'ios-focus-lock');
        overlay.style.setProperty('--profile-modal-shift-y', '0px');
    }
}

function cleanupProfileModalAfterClose() {
    const { overlay, card } = getProfileModalElements();

    getActiveProfileModalInput()?.blur();
    detachProfileModalKeyboardDock();
    resetProfileModalViewportState();

    if (overlay) {
        overlay.classList.remove('keyboard-docked', 'ios-focus-lock');
        overlay.style.setProperty('--profile-modal-shift-y', '0px');
    }

    if (card) {
        card.scrollTop = 0;
        card.style.removeProperty('height');
        card.style.removeProperty('max-height');
    }

    profileModalViewportState.ownsFullScrollLock = false;
    profileModalViewportState.baseScrollY = 0;
}

function closeProfileModal() {
    const { overlay } = getProfileModalElements();
    if (!overlay) return;

    cleanupProfileModalAfterClose();
    overlay.classList.remove('active');
    overlay.style.removeProperty('visibility');
    overlay.style.removeProperty('opacity');
    overlay.style.removeProperty('display');

    if (window.iOSScrollLock) {
        window.iOSScrollLock.unlock();
    } else {
        document.documentElement.classList.remove('no-scroll');
        document.body.classList.remove('no-scroll');
    }

    profileModalOpenLock = false;
}

window.closeProfileModal = closeProfileModal;
window.__cleanupProfileModalAfterClose = cleanupProfileModalAfterClose;

// ==================== 打开个人资料模态框 (Supabase 版本) ====================
async function openProfileModal(event) {
    if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        event.stopPropagation();
    }

    const now = Date.now();
    if (profileModalOpenLock || now - lastProfileModalOpenAt < 250) {
        return;
    }
    profileModalOpenLock = true;
    lastProfileModalOpenAt = now;

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');
    if (dropdown) dropdown.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    // 检查是否在主页
    const modal = document.getElementById('profileModal');
    if (!modal) {
        // 不在主页，跳转到主页并设置标记打开模态框
        sessionStorage.setItem('openProfileModal', 'true');
        window.location.href = 'index.html';
        profileModalOpenLock = false;
        return;
    }

    const wasActive = modal.classList.contains('active');
    const { card: profileModalElement } = getProfileModalElements();
    const profileFront = document.querySelector('.profile-front');

    profileModalViewportState.baseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
    cleanupProfileModalAfterClose();
    resetProfileModalViewState();
    hydrateProfileModalFromCache();

    modal.classList.remove('active');
    modal.style.display = 'flex';
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';

    void modal.offsetHeight;
    modal.classList.add('active');

    if (window.iOSScrollLock) {
        window.iOSScrollLock.lock(profileModalElement || modal, {
            freezeScrollY: profileModalViewportState.baseScrollY
        });
        profileModalViewportState.ownsFullScrollLock = true;
    }

    attachProfileModalKeyboardDock();

    requestAnimationFrame(() => {
        modal.style.removeProperty('visibility');
        modal.style.removeProperty('opacity');

        if (profileFront && !wasActive) {
            profileFront.classList.remove('animate-in');
            void profileFront.offsetWidth;
            profileFront.classList.add('animate-in');
        }
    });

    // 保持当前数据，避免每次打开先闪“加载中...”
    const nicknameSpan = document.getElementById('profileModalNickname');
    const emailDiv = document.getElementById('profileModalEmail');
    const memberSinceSpan = document.getElementById('profileMemberSince');

    // 异步加载数据（不阻塞UI）
    (async () => {
        try {
            // 获取当前用户
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) {
                alert('请先登录');
                closeProfileModal();
                return;
            }

            const optimisticNickname = user.user_metadata?.full_name || user.email.split('@')[0];
            if (emailDiv) emailDiv.textContent = user.email;
            if (nicknameSpan) nicknameSpan.textContent = optimisticNickname;
            setProfileModalAvatar(user.user_metadata?.avatar_url, user.email || optimisticNickname);

            if (memberSinceSpan) {
                const createdAt = new Date(user.created_at);
                const year = createdAt.getFullYear();
                const month = createdAt.getMonth() + 1;
                const day = createdAt.getDate();
                const isEnglish = window.i18n?.isEnglish?.();
                if (isEnglish) {
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    memberSinceSpan.textContent = `Member since ${monthNames[month - 1]} ${day}, ${year}`;
                } else {
                    memberSinceSpan.textContent = `注册于 ${year}年${month}月${day}日`;
                }
            }

            // 获取 profile
            const { data: profile } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            const resolvedNickname = profile?.username || optimisticNickname;
            const resolvedAvatar = profile?.avatar_url || user.user_metadata?.avatar_url || getAvatarFallbackUrl(user.email);
            setProfileModalAvatar(resolvedAvatar, user.email || resolvedNickname);

            if (emailDiv) {
                emailDiv.textContent = user.email;
            }

            if (nicknameSpan) {
                nicknameSpan.textContent = resolvedNickname;
            }
        } catch (error) {
            console.error('Error loading profile:', error);
            if (nicknameSpan) nicknameSpan.textContent = '加载失败';
            if (emailDiv) emailDiv.textContent = '加载失败';
            if (memberSinceSpan) memberSinceSpan.textContent = '加载失败';
        } finally {
            setTimeout(() => {
                profileModalOpenLock = false;
            }, 120);
        }
    })();
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
    updateUserUI(null, { clearCacheOnLogout: true });

    // 打开登录弹窗
    setTimeout(() => {
        if (typeof window.openLoginModal === 'function') {
            window.openLoginModal();
        } else {
            const loginModal = document.getElementById('loginModal');
            if (loginModal) {
                loginModal.classList.add('active');
            }
        }
    }, 100);
}

window.handleSwitchAccount = handleSwitchAccount;

// ==================== Tab 切换功能 ====================
function switchProfileTab(tabName) {
    console.log('🔄 Switching profile tab to:', tabName);
    const isMobileView = window.innerWidth <= 768;

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

        if (profileFront && !isMobileView) {
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

        if (profileBack && !isMobileView) {
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
