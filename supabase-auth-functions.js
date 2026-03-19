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

function showAuthFeedback(message, type = 'error', targetView) {
    if (typeof window.showAuthMessage === 'function' && window.showAuthMessage(message, type, targetView)) {
        return true;
    }

    alert(message);
    return false;
}

function clearAuthFeedback() {
    if (typeof window.clearAuthMessage === 'function') {
        window.clearAuthMessage();
    }
}

function authT(key, fallback) {
    return window.i18n?.t(key, fallback) || fallback;
}

function formatAuthText(key, fallback, vars = {}) {
    let text = authT(key, fallback);
    Object.entries(vars).forEach(([name, value]) => {
        text = text.split(`{${name}}`).join(String(value));
    });
    return text;
}

function setAuthLoading(formName, isLoading, label) {
    if (typeof window.setAuthFormLoading === 'function') {
        window.setAuthFormLoading(formName, isLoading, label);
    }
}

function setUserDropdownOpen(isOpen) {
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');
    const authBtn = document.getElementById('authBtn');
    const nextState = !!isOpen;

    dropdown?.classList.toggle('active', nextState);
    dropdown?.setAttribute('aria-hidden', nextState ? 'false' : 'true');
    overlay?.classList.toggle('active', nextState);
    authBtn?.setAttribute('aria-expanded', nextState ? 'true' : 'false');
}

function closeUserDropdown() {
    setUserDropdownOpen(false);
}

window.closeUserDropdown = closeUserDropdown;

const AUTH_ORIGIN_CACHE_KEY = 'zaoyoe_auth_origin_cache_v1';
const PENDING_AUTH_ORIGIN_KEY = 'zaoyoe_pending_auth_origin_v1';
const AUTH_ORIGIN_CACHE_TTL = 10 * 60 * 1000;

function getCurrentAuthSite() {
    return String(window.SiteConfig?.site || 'cn').trim() || 'cn';
}

function normalizeGeoText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function normalizeGeoPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const country = normalizeGeoText(raw.country_name || raw.country || raw.countryCode || raw.country_code);
    const region = normalizeGeoText(raw.region || raw.regionName || raw.province || raw.state);
    const city = normalizeGeoText(raw.city);

    if (!country && !region && !city) return null;

    return {
        country: country || '未知',
        region: region || '未知',
        city: city || '未知'
    };
}

function readCachedAuthOriginContext() {
    try {
        const raw = sessionStorage.getItem(AUTH_ORIGIN_CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed?.cachedAt || Date.now() - parsed.cachedAt > AUTH_ORIGIN_CACHE_TTL) {
            sessionStorage.removeItem(AUTH_ORIGIN_CACHE_KEY);
            return null;
        }

        return parsed;
    } catch (err) {
        console.warn('Failed to read cached auth origin context:', err);
        return null;
    }
}

function writeCachedAuthOriginContext(payload) {
    try {
        sessionStorage.setItem(AUTH_ORIGIN_CACHE_KEY, JSON.stringify({
            ...payload,
            cachedAt: Date.now()
        }));
    } catch (err) {
        console.warn('Failed to cache auth origin context:', err);
    }
}

async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            cache: 'no-store'
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

async function resolveClientNetworkContext(forceRefresh = false) {
    if (!forceRefresh) {
        const cached = readCachedAuthOriginContext();
        if (cached?.ip || cached?.geoInfo) {
            return cached;
        }
    }

    const resolvers = [
        async () => {
            const data = await fetchJsonWithTimeout('https://ipinfo.io/json');
            return {
                ip: normalizeGeoText(data?.ip),
                geoInfo: normalizeGeoPayload(data),
                source: 'ipinfo'
            };
        },
        async () => {
            const data = await fetchJsonWithTimeout('https://ipwho.is/');
            return {
                ip: normalizeGeoText(data?.ip),
                geoInfo: normalizeGeoPayload(data),
                source: 'ipwho.is'
            };
        },
        async () => {
            const data = await fetchJsonWithTimeout('https://ipapi.co/json/');
            return {
                ip: normalizeGeoText(data?.ip),
                geoInfo: normalizeGeoPayload(data),
                source: 'ipapi'
            };
        },
        async () => {
            const data = await fetchJsonWithTimeout('https://api.ipify.org?format=json');
            return {
                ip: normalizeGeoText(data?.ip),
                geoInfo: null,
                source: 'ipify'
            };
        }
    ];

    for (const resolver of resolvers) {
        try {
            const result = await resolver();
            if (result?.ip || result?.geoInfo) {
                writeCachedAuthOriginContext(result);
                return result;
            }
        } catch (err) {
            console.warn('Auth origin resolver failed:', err?.message || err);
        }
    }

    return {
        ip: '',
        geoInfo: null,
        source: 'unavailable'
    };
}

function queuePendingAuthOrigin(userId, context = 'login') {
    if (!userId) return;
    try {
        sessionStorage.setItem(PENDING_AUTH_ORIGIN_KEY, JSON.stringify({
            userId: String(userId),
            context: context || 'login',
            queuedAt: Date.now()
        }));
    } catch (err) {
        console.warn('Failed to queue auth origin task:', err);
    }
}

function readPendingAuthOrigin() {
    try {
        const raw = sessionStorage.getItem(PENDING_AUTH_ORIGIN_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn('Failed to read pending auth origin task:', err);
        return null;
    }
}

function clearPendingAuthOrigin(userId = '') {
    const pending = readPendingAuthOrigin();
    if (!pending) return;
    if (userId && String(pending.userId) !== String(userId)) return;
    sessionStorage.removeItem(PENDING_AUTH_ORIGIN_KEY);
}

async function persistAuthOrigin(userId, context = 'login', options = {}) {
    if (!userId || !window.supabaseClient) return false;

    const { forceRefresh = false, queueOnFailure = true } = options;

    try {
        const networkContext = await resolveClientNetworkContext(forceRefresh);
        const ip = normalizeGeoText(networkContext?.ip);
        const geoInfo = networkContext?.geoInfo || null;

        if (!ip && !geoInfo) {
            if (queueOnFailure) queuePendingAuthOrigin(userId, context);
            return false;
        }

        const { error } = await window.supabaseClient.rpc('fn_upsert_user_auth_origin', {
            p_user_id: userId,
            p_ip: ip || null,
            p_geo_info: geoInfo,
            p_user_agent: navigator.userAgent || null,
            p_site: getCurrentAuthSite(),
            p_context: context || 'login'
        });

        if (error) throw error;

        clearPendingAuthOrigin(userId);
        return true;
    } catch (err) {
        console.warn('Failed to persist auth origin:', err?.message || err);
        if (queueOnFailure) {
            queuePendingAuthOrigin(userId, context);
        }
        return false;
    }
}

async function flushPendingAuthOrigin(userId) {
    const pending = readPendingAuthOrigin();
    if (!pending || String(pending.userId) !== String(userId)) {
        return false;
    }

    return persistAuthOrigin(userId, pending.context || 'login', {
        forceRefresh: false,
        queueOnFailure: true
    });
}

// ==================== 注册功能 (Supabase 版本) ====================
async function handleRegister(event) {
    event.preventDefault();

    clearAuthFeedback();
    setAuthLoading('register', true, authT('auth.creating', '正在创建...'));

    const inputCode = document.getElementById('reg-code').value;
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const privacyConsent = document.getElementById('privacyConsent')?.checked;

    // 隐私政策验证
    if (!privacyConsent) {
        showAuthFeedback(authT('auth.agreePrivacyFirst', '请先阅读并同意隐私政策'), 'error', 'register');
        setAuthLoading('register', false);
        return;
    }

    // 验证码检查
    if (inputCode !== generatedCode) {
        showAuthFeedback(authT('auth.invalidCodeNotice', '验证码错误，请检查邮件后重新输入。'), 'error', 'register');
        setAuthLoading('register', false);
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
            showAuthFeedback(authT('auth.usernameTaken', '该用户名已被使用，请选择其他用户名。'), 'error', 'register');
            setAuthLoading('register', false);
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

        if (data.user?.id) {
            queuePendingAuthOrigin(data.user.id, 'register');
            await persistAuthOrigin(data.user.id, 'register', {
                forceRefresh: true,
                queueOnFailure: true
            });
        }

        // 关闭模态框
        if (typeof window.closeLoginModal === 'function') {
            window.closeLoginModal();
        } else {
            toggleLoginModal();
        }

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
            errorMessage = authT('auth.emailRegistered', '该邮箱已被注册。');
        } else {
            errorMessage = error.message || '未知错误';
        }

        showAuthFeedback(
            formatAuthText('auth.registerFailedPrefix', '注册失败: {message}', { message: errorMessage }),
            'error',
            'register'
        );
    } finally {
        setAuthLoading('register', false);
    }
}

// ==================== 登录功能 (Supabase 版本 - 带安全锁定) ====================
async function handleLogin(event) {
    event.preventDefault();

    clearAuthFeedback();
    setAuthLoading('login', true, authT('auth.signingIn', '正在登录...'));

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

    if (!email || !password) {
        showAuthFeedback(authT('auth.enterEmailAndPassword', '请输入邮箱和密码'), 'error', 'login');
        setAuthLoading('login', false);
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
                showAuthFeedback(message, 'error', 'login');
                setAuthLoading('login', false);
                return;
            }
        }

        // 🔒 Step 1: 检查账户是否被锁定
        const lockStatus = await checkUserLocked(email);
        if (lockStatus.isLocked) {
            const minutes = Math.ceil(lockStatus.remainingSeconds / 60);
            showAuthFeedback(
                formatAuthText('auth.accountLockedRetry', '账户已锁定。由于多次登录失败，请在 {minutes} 分钟后重试。', { minutes }),
                'error',
                'login'
            );
            setAuthLoading('login', false);
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
        if (typeof window.closeLoginModal === 'function') {
            window.closeLoginModal();
        } else {
            toggleLoginModal();
        }

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
        persistAuthOrigin(data.user.id, 'login', {
            forceRefresh: true,
            queueOnFailure: true
        });

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
        let shouldOpenRegister = false;
        if (error.message.includes('Invalid login credentials')) {
            // Check if email exists to distinguish between unregistered and wrong password
            try {
                const { data: emailExists } = await window.supabaseClient
                    .rpc('fn_check_email_exists', { check_email: email });

                if (!emailExists) {
                    errorMessage = authT('auth.emailNotRegistered', '该邮箱未注册，请先注册账号');
                    shouldOpenRegister = true;
                } else {
                    errorMessage = authT('auth.passwordIncorrect', '密码错误，请检查后重试');
                }
            } catch (e) {
                errorMessage = authT('auth.credentialsIncorrect', '用户名或密码错误');
            }
        } else {
            errorMessage = error.message || '未知错误';
        }

        if (shouldOpenRegister) {
            showAuthFeedback(
                formatAuthText('auth.loginFailedPrefix', '登录失败: {message}', { message: errorMessage }),
                'error',
                'register'
            );
        } else {
            showAuthFeedback(
                formatAuthText('auth.loginFailedPrefix', '登录失败: {message}', { message: errorMessage }),
                'error',
                'login'
            );
        }
    } finally {
        setAuthLoading('login', false);
    }
}

// ==================== 登录安全辅助函数 ====================

// 获取客户端 IP 地址
async function getClientIP() {
    try {
        const context = await resolveClientNetworkContext();
        if (context?.ip) {
            console.log('🌐 客户端 IP:', context.ip);
            return context.ip;
        }
        return null;
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

    closeUserDropdown();

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

    closeUserDropdown();
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

        if (dropdown) {
            const isActive = dropdown.classList.contains('active');
            if (isActive) {
                closeUserDropdown();
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
                    const navOverlap = parseFloat(
                        getComputedStyle(document.documentElement).getPropertyValue('--nav-dropdown-overlap')
                    ) || 1;
                    // Use setProperty with !important to guarantee JS wins over any CSS rules
                    dropdown.style.setProperty('right', Math.max(10, rightOffset) + 'px', 'important');
                    // Shift up slightly to fuse seamlessly with the nav border.
                    dropdown.style.setProperty('top', (anchorBottom - navOverlap) + 'px', 'important');
                }
                setUserDropdownOpen(true);

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

function getMatchedCachedProfile(user, cachedProfile = readCachedUserProfile()) {
    if (!cachedProfile || !user) return null;

    const cachedId = cachedProfile.objectId || cachedProfile.id || cachedProfile.user_id || '';
    if (cachedId && user.id && cachedId === user.id) {
        return cachedProfile;
    }

    if (cachedProfile.email && user.email && cachedProfile.email === user.email) {
        return cachedProfile;
    }

    return null;
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

function setTextContent(id, value) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null || value === '') return;
    el.textContent = value;
}

function isProfilePlaceholderValue(value) {
    const normalized = String(value || '').trim();
    return !normalized ||
        normalized === 'Loading...' ||
        normalized === '加载中...' ||
        normalized === '加载失败';
}

function readCurrentKnownNickname() {
    const authBtnText = document.getElementById('authBtnText')?.textContent || '';
    const dropdownUsername = document.getElementById('dropdownUsername');
    const dropdownText = dropdownUsername
        ? Array.from(dropdownUsername.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(' ')
        : '';
    const modalHeroName = document.getElementById('profileMobileHeroName')?.textContent || '';
    const modalNickname = document.getElementById('profileMobileNicknameValue')?.textContent || '';

    const candidates = [authBtnText, dropdownText, modalHeroName, modalNickname];
    for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (!isProfilePlaceholderValue(normalized)) {
            return normalized;
        }
    }

    return '';
}

function getProfileDisplayInitial(seed) {
    const source = String(seed || 'U').trim();
    return source ? source.charAt(0).toUpperCase() : 'U';
}

function getShortProfileAccountId(rawId) {
    if (!rawId) return '-';
    return String(rawId).replace(/-/g, '').slice(0, 6).toUpperCase() || '-';
}

function updateProfileMobileSummary(data = {}) {
    const {
        nickname,
        email,
        memberSince,
        userId
    } = data;

    if (nickname) {
        setTextContent('profileMobileHeroName', nickname);
        setTextContent('profileMobileNicknameValue', nickname);
    }

    if (email) {
        setTextContent('profileMobileHeroEmail', email);
        setTextContent('profileMobileEmailValue', email);
    }

    if (memberSince) {
        setTextContent('profileMobileMemberSinceValue', memberSince);
    }

    if (userId) {
        setTextContent('profileMobileHeroId', `ID ${getShortProfileAccountId(userId)}`);
    }
    const avatarFallback = document.getElementById('profileModalAvatarMobileFallback');
    if (avatarFallback && (nickname || email)) {
        avatarFallback.textContent = getProfileDisplayInitial(nickname || email);
    }
}

function formatProfileMemberSince(dateLike) {
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    if (window.i18n?.isEnglish?.()) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${monthNames[month - 1]} ${day}, ${year}`;
    }

    return `${year}年${month}月${day}日`;
}

function setProfileModalAvatar(avatarUrl, fallbackSeed = 'User', options = {}) {
    const { preferImmediate = false, keepCurrentOnEmpty = true } = options;
    const avatarTargets = Array.from(document.querySelectorAll('#profileModalAvatarMobile'));
    if (!avatarTargets.length) return;

    const fallbackUrl = getAvatarFallbackUrl(fallbackSeed);
    const currentRaw = avatarTargets[0].getAttribute('src') || avatarTargets[0].src || '';
    const incomingUrl = isUsableAvatarUrl(avatarUrl) ? String(avatarUrl).trim() : '';
    const avatarFallback = document.getElementById('profileModalAvatarMobileFallback');
    if (avatarFallback) {
        avatarFallback.textContent = getProfileDisplayInitial(fallbackSeed);
    }

    const syncMobileAvatarVisibility = (showImage) => {
        const mobileAvatar = document.getElementById('profileModalAvatarMobile');
        if (mobileAvatar) {
            mobileAvatar.style.display = showImage ? 'block' : 'none';
        }
        if (avatarFallback) {
            avatarFallback.style.display = showImage ? 'none' : 'grid';
        }
    };

    if (!incomingUrl) {
        if (keepCurrentOnEmpty) return;
        avatarTargets.forEach((avatar) => {
            avatar.src = fallbackUrl;
        });
        syncMobileAvatarVisibility(true);
        return;
    }

    const targetUrl = incomingUrl;
    const currentBase = normalizeAvatarUrl(currentRaw);
    const targetBase = normalizeAvatarUrl(targetUrl);
    const allTargetsAligned = currentBase && targetBase && avatarTargets.every((avatar) => {
        const avatarRaw = avatar.getAttribute('src') || avatar.src || '';
        return normalizeAvatarUrl(avatarRaw) === targetBase;
    });
    if (allTargetsAligned) {
        syncMobileAvatarVisibility(true);
        return;
    }

    const applySrc = (url) => {
        avatarTargets.forEach((avatar) => {
            avatar.onerror = function () {
                const failedBase = normalizeAvatarUrl(this.src || '');
                const fallbackBase = normalizeAvatarUrl(fallbackUrl);
                if (failedBase === fallbackBase) {
                    syncMobileAvatarVisibility(false);
                    return;
                }
                this.src = fallbackUrl;
                syncMobileAvatarVisibility(true);
            };
            avatar.src = url;
        });
        syncMobileAvatarVisibility(true);
    };

    if (preferImmediate || !currentRaw) {
        applySrc(targetUrl);
        return;
    }

    const probe = new Image();
    probe.onload = () => applySrc(targetUrl);
    probe.onerror = () => {
        if (keepCurrentOnEmpty) return;
        avatarTargets.forEach((avatar) => {
            avatar.src = fallbackUrl;
        });
        syncMobileAvatarVisibility(true);
    };
    probe.src = targetUrl;
}

function updateUserUI(user, options = {}) {
    const { animateAvatar = false, preferImmediateAvatar = false, clearCacheOnLogout = false } = options;
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');
    const userDropdown = document.getElementById('userDropdown');
    const enterStudioBtn = document.getElementById('enterStudioBtn');
    const authBtn = document.getElementById('authBtn');

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

        if (authBtn) authBtn.classList.add('logged-in');

        updateProfileMobileSummary({
            nickname: user.nickname || user.username || 'User',
            email: user.email || '',
            userId: user.objectId || user.id || '',
            phone: user.phone || user.phone_number || ''
        });
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
        if (navAvatar) {
            navAvatar.style.display = 'none';
            navAvatar.style.opacity = '0';
            navAvatar.classList.remove('show', 'animate-in');
        }
        if (btnText) btnText.textContent = 'Sign In';
        closeUserDropdown();
        if (enterStudioBtn) enterStudioBtn.style.display = 'none';
        if (authBtn) {
            authBtn.classList.remove('logged-in');
        }

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

    clearAuthFeedback();

    const emailInput = document.getElementById('reset-email');
    const submitBtn = document.querySelector('#resetForm button[type="submit"]');

    if (!emailInput || !submitBtn) {
        showAuthFeedback(authT('auth.resetFormMissing', '系统错误：找不到表单元素，请刷新页面重试。'), 'error', 'reset');
        return;
    }

    const email = emailInput.value.trim();

    if (!email) {
        showAuthFeedback(authT('auth.enterEmailAddress', '请输入邮箱地址'), 'error', 'reset');
        return;
    }

    if (resetCooldownSeconds > 0) {
        showAuthFeedback(
            formatAuthText('auth.waitSecondsRetry', '请等待 {seconds} 秒后再试', { seconds: resetCooldownSeconds }),
            'error',
            'reset'
        );
        return;
    }

    const originalText = submitBtn.textContent;
    submitBtn.textContent = authT('auth.sending', '发送中...');
    submitBtn.disabled = true;

    try {
        const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        });

        if (error) throw error;

        console.log('✅ 重置邮件已发送');
        showAuthFeedback(
            formatAuthText('auth.resetEmailSent', '重置密码邮件已发送到 {email}，请检查收件箱（包括垃圾邮件）。', { email }),
            'success',
            'reset'
        );
        emailInput.value = '';

        resetCooldownSeconds = 30;
        updateResetButtonCountdown(submitBtn, originalText);

        setTimeout(() => {
            switchAuthView('login');
        }, 5000);

    } catch (error) {
        console.error('密码重置失败:', error);
        showAuthFeedback(error.message || authT('auth.sendFailed', '发送失败'), 'error', 'reset');
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
}

function updateResetButtonCountdown(button, originalText) {
    if (resetCooldownSeconds > 0) {
        button.textContent = formatAuthText('auth.sentCountdown', '已发送 ({seconds}s)', { seconds: resetCooldownSeconds });
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
const GOOGLE_POPUP_MESSAGE_TYPE = 'zaoyoe:google-auth-popup';
const GOOGLE_POPUP_WINDOW_NAME = 'google_login';
const GOOGLE_POPUP_RESULT_STORAGE_KEY = 'zaoyoe_google_popup_auth_result_v1';
const GOOGLE_POPUP_STATE_PREFIX = 'zaoyoe_google_popup:';
const GOOGLE_POPUP_STATE_STORAGE_KEY = 'zaoyoe_google_popup_state_v1';
let googleIdentityScriptPromise = null;
window.currentGoogleNonce = null;
window.currentGoogleNonceHash = null;
let googleCredentialReceived = false;
let googleLoginAttemptId = 0;
let googleIdentityInitialized = false;
let googlePopupWindowRef = null;
let googlePopupMonitorTimer = null;
let googlePopupAuthResultHandled = false;
let googlePopupLastResultSignature = '';

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

function setGoogleButtonsLoading(isLoading, text = authT('auth.signingIn', '正在登录...')) {
    window.isGoogleLoginLoading = !!isLoading;
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

function isGooglePopupWindow() {
    const urlParams = new URLSearchParams(window.location.search);
    return !!(
        (window.opener && window.opener !== window) ||
        window.name === GOOGLE_POPUP_WINDOW_NAME ||
        urlParams.get('popup') === '1'
    );
}

function createGooglePopupState() {
    const state = `${GOOGLE_POPUP_STATE_PREFIX}${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    try {
        localStorage.setItem(GOOGLE_POPUP_STATE_STORAGE_KEY, state);
    } catch (err) {
        console.warn('Failed to persist Google popup state:', err);
    }
    return state;
}

function isGooglePopupState(value) {
    return typeof value === 'string' && value.startsWith(GOOGLE_POPUP_STATE_PREFIX);
}

function clearGooglePopupState(value = '') {
    try {
        const currentState = localStorage.getItem(GOOGLE_POPUP_STATE_STORAGE_KEY);
        if (!currentState) return;
        if (!value || currentState === value) {
            localStorage.removeItem(GOOGLE_POPUP_STATE_STORAGE_KEY);
        }
    } catch (err) {
        console.warn('Failed to clear Google popup state:', err);
    }
}

function buildGooglePopupRedirectUrl(mode = 'callback') {
    const popupUrl = new URL('/auth-callback.html', window.location.origin);
    popupUrl.searchParams.set('popup', '1');
    if (mode === 'close') {
        popupUrl.searchParams.set('close', '1');
    }
    return popupUrl.toString();
}

function broadcastGooglePopupResult(payload) {
    try {
        const envelope = JSON.stringify({
            type: GOOGLE_POPUP_MESSAGE_TYPE,
            emittedAt: Date.now(),
            ...payload
        });
        localStorage.setItem(GOOGLE_POPUP_RESULT_STORAGE_KEY, envelope);
        setTimeout(() => {
            try {
                if (localStorage.getItem(GOOGLE_POPUP_RESULT_STORAGE_KEY) === envelope) {
                    localStorage.removeItem(GOOGLE_POPUP_RESULT_STORAGE_KEY);
                }
            } catch (_) {
                // ignore cleanup failure
            }
        }, 1500);
    } catch (err) {
        console.warn('Failed to broadcast Google popup result:', err);
    }
}

function attemptCloseCurrentGooglePopup(force = false) {
    if (!force && !isGooglePopupWindow()) return false;

    const tryClose = () => {
        try {
            window.close();
        } catch (_) {
            // ignore
        }
    };

    tryClose();
    setTimeout(() => {
        if (window.closed) return;
        try {
            window.location.replace(buildGooglePopupRedirectUrl('close'));
        } catch (_) {
            // ignore
        }
    }, 120);

    return true;
}

function notifyGooglePopupResultToOpener(payload) {
    broadcastGooglePopupResult(payload);

    if (!window.opener || window.opener === window) return;
    try {
        window.opener.postMessage({
            type: GOOGLE_POPUP_MESSAGE_TYPE,
            ...payload
        }, window.location.origin);
    } catch (err) {
        console.warn('Failed to notify opener about Google popup result:', err);
    }
}

function stopGooglePopupMonitor() {
    if (googlePopupMonitorTimer) {
        clearInterval(googlePopupMonitorTimer);
        googlePopupMonitorTimer = null;
    }
}

function closeTrackedGooglePopup() {
    const trackedPopup = googlePopupWindowRef;
    if (trackedPopup && !trackedPopup.closed) {
        try {
            trackedPopup.close();
        } catch (_) {
            // ignore
        }

        setTimeout(() => {
            if (!trackedPopup.closed) {
                try {
                    trackedPopup.location.replace(buildGooglePopupRedirectUrl('close'));
                } catch (_) {
                    // ignore navigation failure
                }

                try {
                    trackedPopup.close();
                } catch (_) {
                    // ignore
                }
            }
        }, 160);
    }
    googlePopupWindowRef = null;
}

function ensureGooglePopupMessageBridge() {
    if (window._googlePopupMessageBridgeBound) return;
    window._googlePopupMessageBridgeBound = true;

    const processPopupPayload = async (payload) => {
        if (!payload || payload.type !== GOOGLE_POPUP_MESSAGE_TYPE) return;

        const signature = [
            payload.status || '',
            payload.userId || '',
            payload.message || '',
            payload.emittedAt || ''
        ].join('|');

        if (signature && signature === googlePopupLastResultSignature) {
            return;
        }
        googlePopupLastResultSignature = signature;

        googlePopupAuthResultHandled = true;
        stopGooglePopupMonitor();
        closeTrackedGooglePopup();
        clearGooglePopupState();
        setGoogleButtonsLoading(false);

        if (payload.status === 'success') {
            clearAuthFeedback();
            clearInlineGoogleFallbackButtons();

            if (typeof closeAdminLoginModal === 'function') closeAdminLoginModal();
            if (typeof toggleLoginModal === 'function') {
                const loginModal = document.getElementById('loginModal');
                if (loginModal && (loginModal.classList.contains('active') || loginModal.style.visibility === 'visible')) {
                    toggleLoginModal();
                }
            }

            try {
                await new Promise((resolve) => setTimeout(resolve, 120));
                await checkAuthState();
                if (payload.userId) {
                    flushPendingAuthOrigin(payload.userId);
                }
            } catch (err) {
                console.warn('Failed to refresh auth state after popup login:', err);
            }
            return;
        }

        showAuthFeedback(
            formatAuthText('auth.googleLoginFailed', 'Google 登录失败: {message}', {
                message: payload.message || authT('auth.tryAgainLater', '请稍后重试')
            }),
            'error',
            'login'
        );
    };

    window.addEventListener('message', async (event) => {
        if (event.origin !== window.location.origin) return;
        await processPopupPayload(event.data);
    });

    window.addEventListener('storage', async (event) => {
        if (event.key !== GOOGLE_POPUP_RESULT_STORAGE_KEY || !event.newValue) return;
        try {
            const payload = JSON.parse(event.newValue);
            await processPopupPayload(payload);
        } catch (err) {
            console.warn('Failed to parse Google popup storage payload:', err);
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
    clearAuthFeedback();
    setGoogleButtonsLoading(true, authT('auth.openingGoogleWindow', '正在打开授权窗口...'));

    try {
        ensureGooglePopupMessageBridge();
        openGooglePopupFallback();
        // Loading state will be cleared by the popup polling logic or after redirect
    } catch (error) {
        console.error('❌ Google login failed:', error);
        setGoogleButtonsLoading(false);
        showAuthFeedback(
            formatAuthText('auth.popupOpenFailed', '打开授权窗口失败: {message}', {
                message: error.message || authT('auth.checkPopupSettings', '请检查浏览器拦截设置')
            }),
            'error',
            'login'
        );
    }
};

// Fallback: Open Google OAuth in a popup window when One Tap is blocked
function openGooglePopupFallback() {
    const clientId = '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com';
    const redirectUri = window.location.origin;
    const scope = 'openid email profile';
    const popupState = createGooglePopupState();
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=id_token` +
        `&scope=${encodeURIComponent(scope)}` +
        `&state=${encodeURIComponent(popupState)}` +
        `&nonce=${Date.now()}` +
        `&prompt=select_account`;

    const width = 500, height = 600;
    // Calculate center relative to the entire browser window (including its toolbars)
    const browserWidth = window.outerWidth || window.innerWidth;
    const browserHeight = window.outerHeight || window.innerHeight;
    const left = window.screenX + (browserWidth - width) / 2;
    // Add a slight downward offset (+ 40px) to account for the browser's thick top toolbar
    const top = window.screenY + (browserHeight - height) / 2 + 40;

    googlePopupAuthResultHandled = false;
    stopGooglePopupMonitor();
    closeTrackedGooglePopup();

    const popup = window.open(authUrl, GOOGLE_POPUP_WINDOW_NAME,
        `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no`);

    if (!popup) {
        setGoogleButtonsLoading(false);
        showAuthFeedback(authT('auth.allowPopupRetry', '弹窗被浏览器拦截，请允许弹窗后重试'), 'error', 'login');
        return;
    }

    googlePopupWindowRef = popup;
    const popupOpenedAt = Date.now();

    googlePopupMonitorTimer = setInterval(() => {
        if (!googlePopupWindowRef || googlePopupWindowRef.closed) {
            stopGooglePopupMonitor();
            googlePopupWindowRef = null;
            clearGooglePopupState();

            if (!googlePopupAuthResultHandled) {
                setGoogleButtonsLoading(false);
                showAuthFeedback(
                    authT('auth.googlePopupClosed', '登录窗口已关闭，请重试'),
                    'error',
                    'login'
                );
            }
            return;
        }

        if (Date.now() - popupOpenedAt > 120000) {
            stopGooglePopupMonitor();
            closeTrackedGooglePopup();
            clearGooglePopupState();
            setGoogleButtonsLoading(false);
            showAuthFeedback(
                authT('auth.googlePopupTimeout', 'Google 登录超时，请重试'),
                'error',
                'login'
            );
        }
    }, 400);
}

async function handleGoogleCredentialResponse(response, options = {}) {
    const shouldClosePopupAfterSuccess = options.closePopup === true || isGooglePopupWindow();
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

        if (shouldClosePopupAfterSuccess) {
            notifyGooglePopupResultToOpener({
                status: 'success',
                userId: data?.user?.id || null
            });
            setTimeout(() => {
                attemptCloseCurrentGooglePopup(true);
            }, 80);
            return;
        }

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
        if (isGooglePopupWindow() || options.closePopup === true) {
            notifyGooglePopupResultToOpener({
                status: 'error',
                message: error.message || authT('auth.tryAgainLater', '请稍后重试')
            });
            setTimeout(() => {
                attemptCloseCurrentGooglePopup(true);
            }, 120);
            return;
        }
        showAuthFeedback(
            formatAuthText('auth.googleLoginFailed', 'Google 登录失败: {message}', {
                message: error.message || authT('auth.tryAgainLater', '请稍后重试')
            }),
            'error',
            'login'
        );
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

    closeUserDropdown();

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
    const hashHasIdToken = window.location.hash && window.location.hash.includes('id_token=');
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const popupStateFromHash = hashParams.get('state') || '';
    const popupStateFromQuery = urlParams.get('state') || '';
    const popupState = popupStateFromHash || popupStateFromQuery;
    const popupStateMatched = isGooglePopupState(popupState);

    if (popupStateMatched) {
        clearGooglePopupState(popupState);
    }

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
    } else if (hashHasIdToken) {
        console.log('🔐 Detected Google ID token in URL hash, completing popup login...');
        const idToken = hashParams.get('id_token');
        const url = new URL(window.location.href);
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}` || '/');

        if (idToken) {
            await handleGoogleCredentialResponse({ credential: idToken }, {
                closePopup: isGooglePopupWindow() || popupStateMatched
            });
        } else {
            console.warn('⚠️ Google ID token hash detected without id_token value.');
        }
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

    if (!window.__userDropdownDismissBound) {
        document.addEventListener('pointerdown', (event) => {
            const dropdown = document.getElementById('userDropdown');
            const authBtn = document.getElementById('authBtn');
            const target = event.target;

            if (!dropdown?.classList.contains('active')) return;
            if (authBtn?.contains(target) || dropdown.contains(target)) return;

            closeUserDropdown();
        }, true);

        window.__userDropdownDismissBound = true;
    }

    const dropdownOverlay = document.getElementById('dropdownOverlay');
    if (dropdownOverlay && dropdownOverlay.dataset.dismissBound !== '1') {
        dropdownOverlay.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            closeUserDropdown();
        });
        dropdownOverlay.dataset.dismissBound = '1';
    }

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
                flushPendingAuthOrigin(session.user.id);
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
                    // Record auth origin for OAuth logins and flush pending register tasks.
                    const pendingOrigin = readPendingAuthOrigin();
                    if (pendingOrigin && String(pendingOrigin.userId) === String(session.user.id)) {
                        flushPendingAuthOrigin(session.user.id);
                    } else {
                        persistAuthOrigin(session.user.id, 'login', {
                            queueOnFailure: true
                        });
                    }
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
const PROFILE_MODAL_KEYBOARD_SETTLE_MS = 100;
const PROFILE_MODAL_SCROLL_STATE_CLEAR_MS = 320;
const profileModalState = {
    baseScrollY: 0,
    overlayBaseHeight: 0,
    viewportCleanup: null,
    rootScrollCleanup: null,
    layoutRafId: 0,
    scrollAnimationClearTimer: null,
    scrollAnimationHost: null,
    scrollAnimationTarget: null,
    settleTimer: null,
    blurTimer: null,
    focusTransferUntil: 0,
    lastFocusAnchor: null,
    preserveLayoutDuringFocusTransfer: false,
    pageFrozen: false
};

function isProfileModalIOSMode() {
    const ua = navigator.userAgent || '';
    const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isiOS && window.matchMedia('(max-width: 768px)').matches && !!window.visualViewport;
}

function getProfileModalElements() {
    const overlay = document.getElementById('profileModal');
    return {
        overlay,
        card: overlay?.querySelector('.profile-modal') || null,
        scroller: overlay?.querySelector('.profile-modal-scroll') || null,
        inputs: overlay ? Array.from(overlay.querySelectorAll('input, textarea, select')) : []
    };
}

function getActiveProfileModalInput() {
    const { overlay } = getProfileModalElements();
    const active = document.activeElement;
    if (!overlay || !active || !overlay.contains(active)) return null;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
}

function clearProfileModalTimers() {
    if (profileModalState.layoutRafId) {
        cancelAnimationFrame(profileModalState.layoutRafId);
        profileModalState.layoutRafId = 0;
    }
    cancelProfileModalScrollAnimation();
    if (profileModalState.settleTimer) {
        clearTimeout(profileModalState.settleTimer);
        profileModalState.settleTimer = null;
    }
    if (profileModalState.blurTimer) {
        clearTimeout(profileModalState.blurTimer);
        profileModalState.blurTimer = null;
    }
}

function freezeProfileModalPage() {
    if (profileModalState.pageFrozen) return;

    profileModalState.baseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
    document.documentElement.classList.add('profile-modal-lock');
    document.body.classList.add('profile-modal-lock');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${profileModalState.baseScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    profileModalState.pageFrozen = true;
    stabilizeProfileModalViewport();
}

function unfreezeProfileModalPage() {
    if (!profileModalState.pageFrozen) return;

    const restoreScrollY = profileModalState.baseScrollY;
    document.documentElement.classList.remove('profile-modal-lock');
    document.body.classList.remove('profile-modal-lock');
    document.documentElement.style.overflow = '';
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    profileModalState.pageFrozen = false;

    requestAnimationFrame(() => {
        window.scrollTo(0, restoreScrollY);
    });
}

function resetProfileModalVisualState() {
    const { overlay, card, scroller } = getProfileModalElements();
    if (!overlay || !card) return;

    overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
    overlay.style.setProperty('--profile-modal-shift-y', '0px');
    overlay.style.removeProperty('--profile-modal-overlay-height');
    card.style.removeProperty('max-height');
    scroller?.style.removeProperty('scroll-padding-bottom');
    profileModalState.overlayBaseHeight = 0;
    profileModalState.focusTransferUntil = 0;
    profileModalState.lastFocusAnchor = null;
    profileModalState.preserveLayoutDuringFocusTransfer = false;
}

function captureProfileModalOverlayBaseHeight(force = false) {
    const { overlay } = getProfileModalElements();
    if (!overlay) return;

    const measuredHeight = Math.max(
        Math.round(window.innerHeight || 0),
        Math.round(document.documentElement.clientHeight || 0),
        Math.round(window.visualViewport?.height || 0)
    );

    if (!measuredHeight) return;
    if (!force && profileModalState.overlayBaseHeight >= measuredHeight) return;

    profileModalState.overlayBaseHeight = measuredHeight;
    overlay.style.setProperty('--profile-modal-overlay-height', `${measuredHeight}px`);
}

function stabilizeProfileModalViewport() {
    if (!profileModalState.pageFrozen) return;

    document.body.style.top = `-${profileModalState.baseScrollY}px`;

    if ((window.scrollY || window.pageYOffset || 0) !== 0) {
        window.scrollTo(0, 0);
    }

    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
}

function getProfileModalFocusAnchor(input = getActiveProfileModalInput()) {
    if (!input) return null;

    return (
        input.closest('.input-group') ||
        input
    );
}

function ensureProfileModalInputVisible(input = getActiveProfileModalInput()) {
    const { card, scroller } = getProfileModalElements();
    const scrollHost = scroller || card;
    if (!card || !scrollHost || !input) return;

    const anchor = getProfileModalFocusAnchor(input) || input;
    const cardRect = scrollHost.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    if (maxScrollTop <= 0) return;

    const preferredCenter = Math.max(
        136,
        Math.min(Math.round(scrollHost.clientHeight * 0.36), scrollHost.clientHeight - 136)
    );
    const anchorCenterInContent =
        scrollHost.scrollTop +
        (anchorRect.top - cardRect.top) +
        (anchorRect.height / 2);

    let nextScrollTop = Math.max(
        0,
        Math.min(anchorCenterInContent - preferredCenter, maxScrollTop)
    );

    const topGuard = Math.max(72, Math.round(scrollHost.clientHeight * 0.18));
    const bottomGuard = Math.max(124, Math.round(scrollHost.clientHeight * 0.26));

    if (inputRect.top < cardRect.top + topGuard) {
        nextScrollTop = Math.min(
            nextScrollTop,
            Math.max(0, scrollHost.scrollTop + (inputRect.top - (cardRect.top + topGuard)))
        );
    } else if (inputRect.bottom > cardRect.bottom - bottomGuard) {
        nextScrollTop = Math.max(
            nextScrollTop,
            Math.min(
                maxScrollTop,
                scrollHost.scrollTop + (inputRect.bottom - (cardRect.bottom - bottomGuard))
            )
        );
    }

    animateProfileModalScroll(scrollHost, nextScrollTop);
}

function clearProfileModalScrollAnimationState() {
    if (profileModalState.scrollAnimationClearTimer) {
        clearTimeout(profileModalState.scrollAnimationClearTimer);
        profileModalState.scrollAnimationClearTimer = null;
    }
    profileModalState.scrollAnimationHost = null;
    profileModalState.scrollAnimationTarget = null;
}

function cancelProfileModalScrollAnimation() {
    const scrollHost = profileModalState.scrollAnimationHost;
    clearProfileModalScrollAnimationState();

    if (!scrollHost || !scrollHost.isConnected) {
        return;
    }

    const currentTop = scrollHost.scrollTop;
    try {
        scrollHost.scrollTo({ top: currentTop, behavior: 'auto' });
    } catch (_) {
        scrollHost.scrollTop = currentTop;
    }
}

function animateProfileModalScroll(scrollHost, targetScrollTop) {
    if (!scrollHost) return;

    const to = Math.max(0, targetScrollTop);
    if (Math.abs(to - scrollHost.scrollTop) <= 2) {
        clearProfileModalScrollAnimationState();
        return;
    }

    if (
        profileModalState.scrollAnimationHost === scrollHost &&
        profileModalState.scrollAnimationTarget !== null &&
        Math.abs(profileModalState.scrollAnimationTarget - to) <= 2
    ) {
        return;
    }

    cancelProfileModalScrollAnimation();
    profileModalState.scrollAnimationHost = scrollHost;
    profileModalState.scrollAnimationTarget = to;

    try {
        scrollHost.scrollTo({ top: to, behavior: 'smooth' });
    } catch (_) {
        scrollHost.scrollTop = to;
        clearProfileModalScrollAnimationState();
        return;
    }

    profileModalState.scrollAnimationClearTimer = setTimeout(() => {
        if (
            profileModalState.scrollAnimationHost === scrollHost &&
            profileModalState.scrollAnimationTarget !== null &&
            Math.abs(profileModalState.scrollAnimationTarget - to) <= 2
        ) {
            clearProfileModalScrollAnimationState();
        }
    }, PROFILE_MODAL_SCROLL_STATE_CLEAR_MS);
}

function markProfileModalFocusTransfer(nextInput = null) {
    const nextAnchor = getProfileModalFocusAnchor(nextInput);
    profileModalState.focusTransferUntil = Date.now() + 260;
    profileModalState.preserveLayoutDuringFocusTransfer = !!(
        nextAnchor &&
        profileModalState.lastFocusAnchor &&
        nextAnchor === profileModalState.lastFocusAnchor
    );
}

function applyProfileModalLayout() {
    const { overlay, card, scroller } = getProfileModalElements();
    if (!overlay || !card || !overlay.classList.contains('active')) return;

    if (!isProfileModalIOSMode()) {
        card.style.removeProperty('max-height');
        if (scroller) {
            scroller.style.removeProperty('scroll-padding-bottom');
        }
        overlay.style.setProperty('--profile-modal-shift-y', '0px');
        overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
        profileModalState.lastFocusAnchor = getProfileModalFocusAnchor(getActiveProfileModalInput()) || null;
        profileModalState.preserveLayoutDuringFocusTransfer = false;
        return;
    }

    const visibleHeight = Math.max(
        320,
        Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0)
    );
    const activeInput = getActiveProfileModalInput();
    const activeAnchor = getProfileModalFocusAnchor(activeInput);
    const holdDuringFocusTransfer = !activeInput && profileModalState.focusTransferUntil > Date.now();

    card.style.maxHeight = `${Math.max(320, visibleHeight - 24)}px`;
    if (scroller) {
        scroller.style.scrollPaddingBottom = `${activeInput || holdDuringFocusTransfer ? 144 : 96}px`;
    }
    overlay.style.setProperty('--profile-modal-shift-y', '0px');
    overlay.classList.toggle('keyboard-active', !!activeInput || holdDuringFocusTransfer);

    if (!activeInput) {
        if (!holdDuringFocusTransfer) {
            profileModalState.lastFocusAnchor = null;
            profileModalState.preserveLayoutDuringFocusTransfer = false;
        }
        return;
    }

    if (!isProfileModalIOSMode()) {
        profileModalState.lastFocusAnchor = activeAnchor || null;
        profileModalState.preserveLayoutDuringFocusTransfer = false;
        return;
    }

    ensureProfileModalInputVisible(activeInput);
    profileModalState.lastFocusAnchor = activeAnchor || null;
    profileModalState.preserveLayoutDuringFocusTransfer = false;
}

function scheduleProfileModalLayout({ settled = false, deferOnly = false } = {}) {
    if (profileModalState.layoutRafId) {
        cancelAnimationFrame(profileModalState.layoutRafId);
    }

    const runLayout = () => {
        profileModalState.layoutRafId = requestAnimationFrame(() => {
            profileModalState.layoutRafId = 0;
            applyProfileModalLayout();
        });
    };

    if (!deferOnly) {
        runLayout();
    }

    if (settled) {
        if (profileModalState.settleTimer) {
            clearTimeout(profileModalState.settleTimer);
        }
        profileModalState.settleTimer = setTimeout(() => {
            profileModalState.settleTimer = null;
            runLayout();
        }, PROFILE_MODAL_KEYBOARD_SETTLE_MS);
    }
}

function bindProfileModalInputBehavior(input) {
    if (!input || input.dataset.profileInputManaged === '1') return;

    const gesture = {
        startX: 0,
        startY: 0,
        startScrollTop: 0,
        mode: 'idle'
    };

    input.addEventListener('focus', () => {
        markProfileModalFocusTransfer(input);
        if (profileModalState.blurTimer) {
            clearTimeout(profileModalState.blurTimer);
            profileModalState.blurTimer = null;
        }
        scheduleProfileModalLayout();
    });

    input.addEventListener('blur', () => {
        if (profileModalState.blurTimer) {
            clearTimeout(profileModalState.blurTimer);
        }
        profileModalState.blurTimer = setTimeout(() => {
            profileModalState.blurTimer = null;
            if (!getActiveProfileModalInput()) {
                scheduleProfileModalLayout({ settled: true, deferOnly: true });
            }
        }, 120);
    });

    input.addEventListener('click', () => {
        if (document.activeElement === input) return;
        markProfileModalFocusTransfer(input);
        scheduleProfileModalLayout();
    });

    input.addEventListener('touchstart', (event) => {
        const { overlay, card, scroller } = getProfileModalElements();
        const scrollHost = scroller || card;
        if (!overlay?.classList.contains('active') || !scrollHost) return;
        cancelProfileModalScrollAnimation();

        const touch = event.touches[0];
        gesture.startX = touch?.clientX || 0;
        gesture.startY = touch?.clientY || 0;
        gesture.startScrollTop = scrollHost.scrollTop;
        gesture.mode = 'pending';
        markProfileModalFocusTransfer(input);
    }, { passive: true });

    input.addEventListener('touchmove', (event) => {
        const { overlay, card, scroller } = getProfileModalElements();
        const scrollHost = scroller || card;
        if (!overlay?.classList.contains('active') || !scrollHost) return;
        if (document.activeElement !== input) return;
        cancelProfileModalScrollAnimation();

        const touch = event.touches[0];
        const deltaX = (touch?.clientX || 0) - gesture.startX;
        const deltaY = (touch?.clientY || 0) - gesture.startY;

        if (gesture.mode === 'pending') {
            if (Math.abs(deltaY) < 8 || Math.abs(deltaY) <= Math.abs(deltaX)) {
                return;
            }
            gesture.mode = 'scroll';
        }

        if (gesture.mode !== 'scroll') return;

        const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
        const nextScrollTop = Math.max(0, Math.min(gesture.startScrollTop - deltaY, maxScrollTop));

        if (nextScrollTop !== scrollHost.scrollTop) {
            scrollHost.scrollTop = nextScrollTop;
        }

        if (event.cancelable) {
            event.preventDefault();
        }
    }, { passive: false });

    input.addEventListener('touchend', (event) => {
        if (isProfileModalIOSMode() && gesture.mode === 'pending' && document.activeElement !== input) {
            if (event.cancelable) {
                event.preventDefault();
            }
            try {
                input.focus({ preventScroll: true });
            } catch (_) {
                input.focus();
            }
            scheduleProfileModalLayout();
        }
        gesture.mode = 'idle';
    });

    input.addEventListener('touchcancel', () => {
        gesture.mode = 'idle';
    });

    input.dataset.profileInputManaged = '1';
}

function bindProfileModalInputs() {
    const { inputs } = getProfileModalElements();
    inputs.forEach((input) => bindProfileModalInputBehavior(input));
}

function attachProfileModalViewportHandlers() {
    bindProfileModalInputs();

    if (!isProfileModalIOSMode()) {
        captureProfileModalOverlayBaseHeight(true);
        scheduleProfileModalLayout();
        return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    detachProfileModalViewportHandlers();
    captureProfileModalOverlayBaseHeight(true);

    const handleViewportChange = () => {
        stabilizeProfileModalViewport();
        if (!getActiveProfileModalInput()) {
            captureProfileModalOverlayBaseHeight();
        }
        scheduleProfileModalLayout({ settled: true, deferOnly: true });
    };

    const handleRootScroll = () => {
        stabilizeProfileModalViewport();
    };

    vv.addEventListener('resize', handleViewportChange, { passive: true });
    vv.addEventListener('scroll', handleViewportChange, { passive: true });
    window.addEventListener('scroll', handleRootScroll, { passive: true });

    profileModalState.viewportCleanup = () => {
        vv.removeEventListener('resize', handleViewportChange);
        vv.removeEventListener('scroll', handleViewportChange);
        profileModalState.viewportCleanup = null;
    };
    profileModalState.rootScrollCleanup = () => {
        window.removeEventListener('scroll', handleRootScroll);
        profileModalState.rootScrollCleanup = null;
    };

    scheduleProfileModalLayout({ settled: true });
}

function detachProfileModalViewportHandlers() {
    if (typeof profileModalState.viewportCleanup === 'function') {
        profileModalState.viewportCleanup();
    }
    if (typeof profileModalState.rootScrollCleanup === 'function') {
        profileModalState.rootScrollCleanup();
    }
    clearProfileModalTimers();
}

function hydrateProfileModalFromCache() {
    try {
        const cachedRaw = localStorage.getItem('cached_user_profile');
        if (!cachedRaw) return;

        const cached = JSON.parse(cachedRaw);
        if (!cached) return;

        const cachedNickname = cached.nickname || cached.username || cached.email?.split('@')[0] || '';
        const cachedEmail = cached.email || '';

        updateProfileMobileSummary({
            nickname: cachedNickname,
            email: cachedEmail,
            userId: cached.objectId || cached.id || ''
        });
        if (cached.avatarUrl || cachedEmail || cachedNickname) {
            setProfileModalAvatar(cached.avatarUrl, cachedEmail || cachedNickname || 'User');
        }
    } catch (_) {
        // Ignore cache parse issues and fall back to live data.
    }
}

function resetProfileModalViewState() {
    const { overlay, card, scroller } = getProfileModalElements();
    const flipInner = document.querySelector('.profile-flip-inner');
    const profileFront = document.querySelector('.profile-front');
    const profileBack = document.querySelector('.profile-back');
    const mobileHeroCard = document.querySelector('#profileModal .profile-mobile-hero-card');
    const mobileSheet = document.querySelector('#profileModal .profile-mobile-sheet');
    const mobileEditor = document.getElementById('profileMobileInlineEditor');
    const mobileInput = document.getElementById('profileMobileNicknameInput');

    if (flipInner) {
        flipInner.classList.remove('flipped');
    }

    document.querySelectorAll('[data-profile-tab]').forEach((tab) => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('[data-profile-tab="profile"]').forEach((tab) => {
        tab.classList.add('active');
    });

    if (scroller) {
        scroller.scrollTop = 0;
    }

    syncProfileModalViewLayers('profile', { profileFront, profileBack });
    profileFront?.classList.remove('animate-in');
    profileBack?.classList.remove('animate-in');

    if (mobileEditor) {
        mobileEditor.classList.remove('is-visible');
    }
    if (mobileHeroCard) {
        mobileHeroCard.classList.remove('is-editing');
    }
    if (mobileSheet) {
        mobileSheet.classList.remove('is-editing-desktop');
    }
    if (mobileInput) {
        mobileInput.value = '';
    }

    if (overlay) {
        overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
        overlay.style.setProperty('--profile-modal-shift-y', '0px');
        overlay.dataset.profileTab = 'profile';
        overlay.dataset.securityPanel = 'change-password';
    }

    updateProfileModalChrome('profile');
    if (typeof window.switchProfileSecurityPanel === 'function') {
        window.switchProfileSecurityPanel('change-password');
    }
}

function syncProfileModalViewLayers(activeTab = 'profile', providedViews = {}) {
    const profileFront = providedViews.profileFront || document.querySelector('#profileModal .profile-front');
    const profileBack = providedViews.profileBack || document.querySelector('#profileModal .profile-back');
    const showFront = activeTab !== 'security';

    [
        { node: profileFront, visible: showFront, zIndex: 3 },
        { node: profileBack, visible: !showFront, zIndex: 4 }
    ].forEach(({ node, visible, zIndex }) => {
        if (!node) return;

        node.hidden = !visible;
        node.toggleAttribute('inert', !visible);
        node.setAttribute('aria-hidden', visible ? 'false' : 'true');
        node.style.pointerEvents = visible ? 'auto' : 'none';
        node.style.zIndex = visible ? String(zIndex) : '1';
    });
}

function cleanupProfileModalAfterClose(options = {}) {
    const restoreScroll = options.restoreScroll !== false;
    const { overlay, card, scroller } = getProfileModalElements();

    getActiveProfileModalInput()?.blur();
    detachProfileModalViewportHandlers();
    resetProfileModalVisualState();

    if (overlay) {
        overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
        overlay.style.setProperty('--profile-modal-shift-y', '0px');
    }

    if (card) {
        card.style.removeProperty('max-height');
    }
    if (scroller) {
        scroller.scrollTop = 0;
    }

    if (restoreScroll) {
        unfreezeProfileModalPage();
    }
}

function closeProfileModal() {
    const { overlay } = getProfileModalElements();
    if (!overlay) return;

    cleanupProfileModalAfterClose();
    overlay.classList.remove('active');
    overlay.style.removeProperty('visibility');
    overlay.style.removeProperty('opacity');
    overlay.style.removeProperty('display');

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
    closeUserDropdown();

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
    const profileFront = document.querySelector('.profile-front');

    cleanupProfileModalAfterClose({ restoreScroll: false });
    resetProfileModalViewState();
    hydrateProfileModalFromCache();
    freezeProfileModalPage();
    bindProfileModalInputs();

    modal.classList.remove('active');
    modal.style.display = 'flex';
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';

    void modal.offsetHeight;
    modal.classList.add('active');
    attachProfileModalViewportHandlers();

    requestAnimationFrame(() => {
        modal.style.removeProperty('visibility');
        modal.style.removeProperty('opacity');
        scheduleProfileModalLayout({ settled: true });

        if (profileFront && !wasActive) {
            profileFront.classList.remove('animate-in');
            void profileFront.offsetWidth;
            profileFront.classList.add('animate-in');
        }
    });

    // 保持当前数据，避免每次打开先闪“加载中...”
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

            const matchedCachedProfile = getMatchedCachedProfile(user);
            const cachedNickname = matchedCachedProfile?.nickname ||
                matchedCachedProfile?.username ||
                matchedCachedProfile?.email?.split('@')[0] ||
                '';
            const stableNickname = cachedNickname || readCurrentKnownNickname();
            const cachedAvatarUrl = isUsableAvatarUrl(matchedCachedProfile?.avatarUrl)
                ? String(matchedCachedProfile.avatarUrl).trim()
                : '';
            const optimisticNickname = stableNickname || user.user_metadata?.full_name || user.email.split('@')[0];
            const memberSinceText = formatProfileMemberSince(user.created_at);
            updateProfileMobileSummary({
                nickname: stableNickname || undefined,
                email: user.email,
                userId: user.id,
                memberSince: memberSinceText
            });
            if (cachedAvatarUrl) {
                setProfileModalAvatar(cachedAvatarUrl, user.email || optimisticNickname, {
                    preferImmediate: true
                });
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
            updateProfileMobileSummary({
                nickname: resolvedNickname,
                email: user.email,
                userId: user.id,
                memberSince: memberSinceText
            });
        } catch (error) {
            console.error('Error loading profile:', error);
            updateProfileMobileSummary({
                nickname: '加载失败',
                email: '加载失败',
                memberSince: '加载失败'
            });
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
    closeUserDropdown();

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

    const flipInner = document.querySelector('.profile-flip-inner');
    const profileFront = document.querySelector('.profile-front');
    const profileBack = document.querySelector('.profile-back');

    updateProfileModalChrome(tabName);

    if (tabName === 'profile') {
        if (flipInner) flipInner.classList.remove('flipped');
        syncProfileModalViewLayers('profile', { profileFront, profileBack });

        if (profileFront) {
            profileFront.classList.remove('animate-in');
            void profileFront.offsetWidth;
            profileFront.classList.add('animate-in');
        }

    } else if (tabName === 'security') {
        if (flipInner) flipInner.classList.add('flipped');
        syncProfileModalViewLayers('security', { profileFront, profileBack });

        if (typeof window.switchProfileSecurityPanel === 'function') {
            const overlay = document.getElementById('profileModal');
            const targetPanel = overlay?.dataset.securityPanel || 'change-password';
            window.switchProfileSecurityPanel(targetPanel);
        }

        if (profileBack) {
            profileBack.classList.remove('animate-in');
            void profileBack.offsetWidth;
            profileBack.classList.add('animate-in');
        }
    }

    window.requestAnimationFrame(() => {
        scheduleProfileModalLayout({ settled: true });
    });
}

window.switchProfileTab = switchProfileTab;

function syncProfileMobileTabIndicator() {
    const tabsWrap = document.querySelector('#profileModal .profile-mobile-tabs');
    if (!tabsWrap) return;

    const activeTab = tabsWrap.querySelector('.tab-item.active');
    if (!activeTab) return;

    tabsWrap.style.setProperty('--profile-tab-indicator-width', `${activeTab.offsetWidth}px`);
    tabsWrap.style.setProperty('--profile-tab-indicator-x', `${activeTab.offsetLeft}px`);
}

window.syncProfileMobileTabIndicator = syncProfileMobileTabIndicator;

if (!window.__profileMobileTabIndicatorBound) {
    window.addEventListener('resize', () => {
        window.requestAnimationFrame(() => {
            syncProfileMobileTabIndicator();
        });
    });
    window.__profileMobileTabIndicatorBound = true;
}

function updateProfileModalChrome(tabName = 'profile') {
    const overlay = document.getElementById('profileModal');
    if (overlay) {
        overlay.dataset.profileTab = tabName;
    }

    document.querySelectorAll('[data-profile-tab]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.profileTab === tabName);
    });

    window.requestAnimationFrame(() => {
        syncProfileMobileTabIndicator();
    });
}

window.updateProfileModalChrome = updateProfileModalChrome;

function openProfileWalletView(view = 'balance', event) {
    if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }

    const supportedViews = new Set(['balance', 'recharge', 'orders', 'affiliate', 'checkin']);
    const targetView = supportedViews.has(view) ? view : 'balance';

    if (typeof closeProfileModal === 'function') {
        closeProfileModal();
    }

    window.setTimeout(() => {
        if (window.WalletModal && typeof window.WalletModal.open === 'function') {
            window.WalletModal.open(targetView);
            return;
        }

        alert(window.i18n?.t('wallet.loading') || '钱包模块加载中，请稍后重试');
    }, 180);
}

window.openProfileWalletView = openProfileWalletView;

function openProfileEditor(event) {
    if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
    }

    const overlay = document.getElementById('profileModal');
    const currentTab = overlay?.dataset.profileTab || 'profile';
    if (currentTab !== 'profile') {
        switchProfileTab('profile');
    }

    const nicknameEdit = document.getElementById('profileMobileInlineEditor');
    const nicknameInput = document.getElementById('profileMobileNicknameInput');
    const isEditing = !!nicknameEdit?.classList.contains('is-visible');

    if (!isEditing && typeof toggleNicknameEdit === 'function') {
        toggleNicknameEdit(true);
        return;
    }

    if (nicknameInput) {
        window.setTimeout(() => {
            try {
                nicknameInput.focus({ preventScroll: true });
            } catch (_) {
                nicknameInput.focus();
            }
            nicknameInput.select();
        }, 60);
    }
}

window.openProfileEditor = openProfileEditor;

// ==================== 昵称修改功能 ====================
function toggleNicknameEdit(show) {
    const currentNickname = document.getElementById('profileMobileHeroName')?.textContent ||
        document.getElementById('profileMobileNicknameValue')?.textContent || '';
    const mobileEditor = document.getElementById('profileMobileInlineEditor');
    const mobileInput = document.getElementById('profileMobileNicknameInput');
    const mobileHeroCard = document.querySelector('#profileModal .profile-mobile-hero-card');
    const mobileSheet = document.querySelector('#profileModal .profile-mobile-sheet');
    const isDesktopLayout = window.matchMedia('(min-width: 769px)').matches;

    if (!mobileEditor || !mobileInput) return;

    if (show) {
        mobileInput.value = currentNickname;
        void mobileEditor.offsetWidth;
        mobileHeroCard?.classList.add('is-editing');
        if (isDesktopLayout) {
            mobileSheet?.classList.add('is-editing-desktop');
        }
        mobileEditor.classList.add('is-visible');
        window.setTimeout(() => {
            try {
                mobileInput.focus({ preventScroll: true });
            } catch (_) {
                mobileInput.focus();
            }
            mobileInput.select();
        }, 180);
        return;
    }

    mobileEditor.classList.remove('is-visible');
    mobileHeroCard?.classList.remove('is-editing');
    mobileSheet?.classList.remove('is-editing-desktop');
}

window.toggleNicknameEdit = toggleNicknameEdit;

// ==================== 保存昵称 (Supabase 版本) ====================
async function saveNickname() {
    const input = document.getElementById('profileMobileNicknameInput');
    if (!input) return;
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
            updateProfileMobileSummary({ nickname: newNickname });

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

// ==================== 记录登录/注册来源 + 地理位置 ====================
async function recordLoginIP(userId, context = 'login') {
    return persistAuthOrigin(userId, context, {
        queueOnFailure: true
    });
}

window.recordLoginIP = recordLoginIP;

// 挂载到 window
window.handleRegister = handleRegister;
window.handleLogin = handleLogin;
window.handlePasswordReset = handlePasswordReset;
window.checkAuthState = checkAuthState;
window.updateUserUI = updateUserUI;
