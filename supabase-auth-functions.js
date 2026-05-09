/**
 * Supabase 版本的认证和用户管理函数
 * 替换 leancloud-auth-functions.js
 */

function getInviteCodeStorageSite() {
    return window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
}

function getInviteCodeStorageKey(site = getInviteCodeStorageSite()) {
    return `zaoyoe_invite_code_${site}_v1`;
}

function persistInviteCodeForCurrentSite(inviteCode = '') {
    const normalizedInviteCode = String(inviteCode || '').trim();
    if (!normalizedInviteCode) return;
    try {
        localStorage.setItem(getInviteCodeStorageKey(), normalizedInviteCode);
        localStorage.removeItem('invite_code');
    } catch (error) {
        console.warn('Failed to persist invite code for current site:', error);
    }
}

function getInviteCodeForCurrentSite() {
    try {
        return String(localStorage.getItem(getInviteCodeStorageKey()) || '').trim();
    } catch (_) {
        return '';
    }
}

// Handle affiliate referrals
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    if (ref) {
        persistInviteCodeForCurrentSite(ref);
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

function requestLoginModalOpen(view = 'login') {
    const normalizedView = ['login', 'register', 'reset'].includes(view) ? view : 'login';
    const pendingLoginModalKey = 'openLoginModal';
    const pendingLoginModalViewKey = 'openLoginModalView';

    const clearPendingLoginModalRequest = () => {
        try {
            sessionStorage.removeItem(pendingLoginModalKey);
            sessionStorage.removeItem(pendingLoginModalViewKey);
        } catch (err) {
            console.warn('Failed to clear pending login modal request:', err);
        }
    };

    const openWhenReady = () => {
        if (typeof window.openLoginModal !== 'function') {
            return false;
        }

        clearPendingLoginModalRequest();
        Promise.resolve(window.openLoginModal(normalizedView)).catch((err) => {
            console.warn('Failed to open login modal:', err);
        });
        return true;
    };

    if (openWhenReady()) {
        return true;
    }

    try {
        sessionStorage.setItem(pendingLoginModalKey, 'true');
        sessionStorage.setItem(pendingLoginModalViewKey, normalizedView);
    } catch (err) {
        console.warn('Failed to queue login modal request:', err);
    }

    const retryOpen = () => {
        if (!openWhenReady()) return;
        window.removeEventListener('zaoyoe:auth-markup-ready', retryOpen);
        document.removeEventListener('DOMContentLoaded', retryOpen);
    };

    window.addEventListener('zaoyoe:auth-markup-ready', retryOpen, { once: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', retryOpen, { once: true });
    }
    window.setTimeout(retryOpen, 80);
    window.setTimeout(retryOpen, 300);
    return false;
}

window.requestLoginModalOpen = requestLoginModalOpen;

function requestProfileModalOpen() {
    const pendingProfileModalKey = 'openProfileModal';

    const clearPendingProfileModalRequest = () => {
        try {
            sessionStorage.removeItem(pendingProfileModalKey);
        } catch (err) {
            console.warn('Failed to clear pending profile modal request:', err);
        }
    };

    const openWhenReady = () => {
        if (typeof window.openProfileModal !== 'function') {
            return false;
        }

        clearPendingProfileModalRequest();
        Promise.resolve(window.openProfileModal()).catch((err) => {
            console.warn('Failed to open profile modal:', err);
        });
        return true;
    };

    if (openWhenReady()) {
        return true;
    }

    try {
        sessionStorage.setItem(pendingProfileModalKey, 'true');
    } catch (err) {
        console.warn('Failed to queue profile modal request:', err);
    }

    const retryOpen = () => {
        if (!openWhenReady()) return;
        window.removeEventListener('zaoyoe:auth-markup-ready', retryOpen);
        document.removeEventListener('DOMContentLoaded', retryOpen);
    };

    window.addEventListener('zaoyoe:auth-markup-ready', retryOpen, { once: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', retryOpen, { once: true });
    }
    window.setTimeout(retryOpen, 80);
    window.setTimeout(retryOpen, 300);
    window.setTimeout(retryOpen, 900);
    return false;
}

window.requestProfileModalOpen = requestProfileModalOpen;

function hasActiveModalBehindLogin() {
    return !!document.querySelector([
        '#shopPurchaseModal.active',
        '#shopSuccessModal.active',
        '#guestbookModal.active',
        '#commentModal.active',
        '#profileModal.active',
        '.wallet-overlay.active',
        '.poetry-modal.active'
    ].join(','));
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

function isValidAuthEmailFormat(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getInvalidResetEmailMessage() {
    return authT('auth.invalidResetEmailFormat', '请输入有效的邮箱地址');
}

function isInvalidAuthEmailError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('unable to validate email address')
        || message.includes('invalid email')
        || message.includes('invalid format');
}

function getPasswordResetErrorMessage(error) {
    if (isInvalidAuthEmailError(error)) {
        return getInvalidResetEmailMessage();
    }

    return error?.message || authT('auth.sendFailed', '发送失败');
}

function setAuthLoading(formName, isLoading, label) {
    if (typeof window.setAuthFormLoading === 'function') {
        window.setAuthFormLoading(formName, isLoading, label);
    }
}

function toAuthCssPropertyName(name) {
    if (typeof name !== 'string' || !name) return '';
    if (name.startsWith('--')) return name;
    return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function setAuthStyleState(target, styles = {}) {
    const style = target?.style;
    if (!style) return;

    const setProperty = style['setProperty'].bind(style);
    const removeProperty = style['removeProperty'].bind(style);

    Object.entries(styles).forEach(([name, value]) => {
        const cssName = toAuthCssPropertyName(name);
        if (!cssName) return;
        if (value === null || value === undefined || value === '') {
            removeProperty(cssName);
            return;
        }
        setProperty(cssName, String(value));
    });
}

function setAuthDisplayState(target, hidden, visibleDisplay = 'block') {
    if (target?.classList) {
        target.classList.toggle('auth-display-none', !!hidden);
    }
    if (typeof target?.setAttribute === 'function') {
        target.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }
    setAuthStyleState(target, {
        display: hidden ? 'none' : visibleDisplay
    });
}

function setAuthAvatarVisualState(target, visible) {
    if (!target) return;
    target.classList.toggle('show', !!visible);
    target.classList.toggle('auth-display-none', !visible);
    setAuthStyleState(target, {
        display: visible ? 'inline-block' : 'none',
        visibility: visible ? 'visible' : 'hidden',
        opacity: visible ? '1' : '0'
    });
}

function isAuthAvatarVisible(target) {
    if (!target) return false;
    return window.getComputedStyle(target).display !== 'none' && target.classList.contains('show');
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
const REMEMBERED_LOGIN_EMAIL_KEY = 'zaoyoe_remembered_login_email_v1';
const REMEMBER_LOGIN_EMAIL_PREFERENCE_KEY = 'zaoyoe_remember_login_email_preference_v1';
const POST_LOGIN_REDIRECT_STORAGE_KEY = 'zaoyoe_post_login_redirect_v1';
const POST_LOGIN_REDIRECT_TTL_MS = 15 * 60 * 1000;
const LEGACY_AUTH_SECRET_KEYS = Object.freeze([
    'remembered_credentials',
    'saved_passwords'
]);

function clearLegacyRememberedAuthSecrets() {
    LEGACY_AUTH_SECRET_KEYS.forEach((key) => {
        try {
            localStorage.removeItem(key);
        } catch (err) {
            console.warn('Failed to clear legacy auth secret:', key, err);
        }
    });
}

function readRememberedLoginEmail() {
    try {
        const raw = localStorage.getItem(REMEMBERED_LOGIN_EMAIL_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const email = String(parsed?.email || '').trim();
        const expiry = Number(parsed?.expiry || 0);
        if (!email || !Number.isFinite(expiry) || expiry <= Date.now()) {
            localStorage.removeItem(REMEMBERED_LOGIN_EMAIL_KEY);
            return null;
        }

        return {
            email,
            expiry
        };
    } catch (err) {
        console.warn('Failed to read remembered login email:', err);
        localStorage.removeItem(REMEMBERED_LOGIN_EMAIL_KEY);
        return null;
    }
}

function persistRememberedLoginEmail(email) {
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) {
        localStorage.removeItem(REMEMBERED_LOGIN_EMAIL_KEY);
        return;
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    try {
        localStorage.setItem(REMEMBERED_LOGIN_EMAIL_KEY, JSON.stringify({
            email: normalizedEmail,
            expiry: expiryDate.getTime()
        }));
    } catch (err) {
        console.warn('Failed to persist remembered login email:', err);
    }
}

function removeRememberedLoginEmail() {
    try {
        localStorage.removeItem(REMEMBERED_LOGIN_EMAIL_KEY);
    } catch (err) {
        console.warn('Failed to clear remembered login email:', err);
    }
}

function readRememberLoginEmailPreference() {
    try {
        return localStorage.getItem(REMEMBER_LOGIN_EMAIL_PREFERENCE_KEY) !== 'false';
    } catch (err) {
        console.warn('Failed to read remembered login email preference:', err);
        return true;
    }
}

function persistRememberLoginEmailPreference(enabled) {
    try {
        localStorage.setItem(REMEMBER_LOGIN_EMAIL_PREFERENCE_KEY, enabled ? 'true' : 'false');
    } catch (err) {
        console.warn('Failed to persist remembered login email preference:', err);
    }
}

function bindRememberLoginEmailPreference(rememberMeInput) {
    if (!rememberMeInput || rememberMeInput.dataset.rememberEmailPreferenceBound === '1') return;
    rememberMeInput.addEventListener('change', () => {
        const shouldRemember = rememberMeInput.checked;
        persistRememberLoginEmailPreference(shouldRemember);
        if (!shouldRemember) {
            removeRememberedLoginEmail();
        }
    });
    rememberMeInput.dataset.rememberEmailPreferenceBound = '1';
}

function restoreRememberedLoginState() {
    clearLegacyRememberedAuthSecrets();

    const shouldRememberEmail = readRememberLoginEmailPreference();
    const remembered = shouldRememberEmail ? readRememberedLoginEmail() : null;
    const emailInput = document.getElementById('login-email');
    const rememberMeInput = document.getElementById('rememberMe');

    if (emailInput) {
        emailInput.value = remembered?.email || '';
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (rememberMeInput) {
        bindRememberLoginEmailPreference(rememberMeInput);
        rememberMeInput.checked = shouldRememberEmail;
    }
}

function buildLockedAccountMessage(remainingSeconds = 0) {
    const minutes = Math.max(1, Math.ceil(Number(remainingSeconds || 0) / 60));
    return formatAuthText('auth.accountLockedRetry', '账户已锁定。由于多次登录失败，请在 {minutes} 分钟后重试。', {
        minutes
    });
}

function getIpBlockedMessage() {
    return authT('auth.ipBlocked', '当前网络请求过于频繁，已被临时拦截，请稍后再试。');
}

function normalizeLoginSecurityState(payload) {
    const security = payload?.security || {};
    return {
        ipBlocked: security.ip_blocked === true,
        ipBlockReason: security.ip_block_reason || '',
        ipBlockExpiresAt: security.ip_block_expires_at || null,
        accountLocked: security.account_locked === true,
        lockedUntil: security.locked_until || null,
        remainingSeconds: Math.max(0, Number(security.remaining_seconds) || 0),
        retryAfterSeconds: Math.max(0, Number(payload?.retry_after_seconds) || 0)
    };
}

function triggerLoginRiskEngagement(securityState = {}, source = 'login_security') {
    if (!securityState?.ipBlocked && !securityState?.accountLocked && !securityState?.rateLimited) {
        return;
    }

    const trigger = window.ZaoyoeEngagement?.trigger;
    if (typeof trigger !== 'function') {
        return;
    }

    const riskType = securityState.ipBlocked
        ? 'ip_blocked'
        : (securityState.accountLocked ? 'account_locked' : 'rate_limited');
    const riskDate = new Date().toISOString().slice(0, 10);

    try {
        void trigger('login_risk', {
            source_module: 'auth.login_security',
            source,
            source_event_id: `login_risk:${riskType}:${riskDate}`,
            page_id: 'home',
            site: window.SiteConfig?.site || 'cn',
            risk_type: riskType,
            ip_block_reason: securityState.ipBlockReason || '',
            ip_block_expires_at: securityState.ipBlockExpiresAt || null,
            locked_until: securityState.lockedUntil || null,
            remaining_seconds: Math.max(0, Number(securityState.remainingSeconds || securityState.retryAfterSeconds || 0) || 0)
        }, { once: true });
    } catch (error) {
        console.debug('[AuthSecurity] Login risk engagement skipped:', error?.message || error);
    }
}

async function requestLoginSecurityAction(action, email) {
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) return null;

    try {
        const response = await fetch('/api/auth/login-security', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify({
                action,
                email: normalizedEmail
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (response.status === 429) {
            return {
                ...normalizeLoginSecurityState(payload),
                rateLimited: true
            };
        }

        if (!response.ok) {
            throw new Error(payload?.message || `HTTP ${response.status}`);
        }

        return {
            ...normalizeLoginSecurityState(payload),
            rateLimited: false
        };
    } catch (err) {
        console.warn(`Login security action failed (${action}):`, err?.message || err);
        return null;
    }
}

function isInvalidCredentialsError(error) {
    const message = String(error?.message || '');
    return message.includes('Invalid login credentials')
        || message.includes('invalid_credentials')
        || message.includes('Invalid credentials');
}

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

        const inviteCode = getInviteCodeForCurrentSite();

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

// ==================== 登录功能 (Supabase 版本 - 带安全加固) ====================
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
        const preflightSecurity = await requestLoginSecurityAction('preflight', email);
        if (preflightSecurity?.rateLimited) {
            showAuthFeedback(
                formatAuthText('auth.waitSecondsRetry', '请等待 {seconds} 秒后再试', {
                    seconds: Math.max(1, preflightSecurity.retryAfterSeconds || 60)
                }),
                'error',
                'login'
            );
            return;
        }

        if (preflightSecurity?.ipBlocked) {
            triggerLoginRiskEngagement(preflightSecurity, 'preflight');
            showAuthFeedback(getIpBlockedMessage(), 'error', 'login');
            return;
        }

        if (preflightSecurity?.accountLocked) {
            triggerLoginRiskEngagement(preflightSecurity, 'preflight');
            showAuthFeedback(buildLockedAccountMessage(preflightSecurity.remainingSeconds), 'error', 'login');
            return;
        }

        // Step 1: 尝试登录
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            if (isInvalidCredentialsError(error)) {
                error.loginSecurity = await requestLoginSecurityAction('record_failure', email);
            }
            throw error;
        }

        console.log('✅ 登录成功:', data.user);

        // 🔒 Step 2: 登录成功 - 重置失败计数
        await resetLoginFailures(email);

        // 获取用户 profile
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        clearLegacyRememberedAuthSecrets();

        // 记住邮箱功能：只保存邮箱，不保存密码。
        persistRememberLoginEmailPreference(rememberMe);
        if (rememberMe) {
            persistRememberedLoginEmail(email);
        } else {
            removeRememberedLoginEmail();
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

        const securityState = error?.loginSecurity || null;
        let errorMessage = '登录失败';
        if (securityState?.rateLimited) {
            triggerLoginRiskEngagement(securityState, 'record_failure');
            errorMessage = formatAuthText('auth.waitSecondsRetry', '请等待 {seconds} 秒后再试', {
                seconds: Math.max(1, securityState.retryAfterSeconds || 60)
            });
        } else if (securityState?.ipBlocked) {
            triggerLoginRiskEngagement(securityState, 'record_failure');
            errorMessage = getIpBlockedMessage();
        } else if (securityState?.accountLocked) {
            triggerLoginRiskEngagement(securityState, 'record_failure');
            errorMessage = buildLockedAccountMessage(securityState.remainingSeconds);
        } else if (error.message.includes('Invalid login credentials')) {
            errorMessage = authT('auth.credentialsIncorrect', '用户名或密码错误');
        } else {
            errorMessage = error.message || '未知错误';
        }

        showAuthFeedback(
            formatAuthText('auth.loginFailedPrefix', '登录失败: {message}', { message: errorMessage }),
            'error',
            'login'
        );
    } finally {
        setAuthLoading('login', false);
    }
}

// ==================== 登录安全辅助函数 ====================

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

    let logoutEmail = '';
    try {
        const { data: { user } = {} } = await window.supabaseClient.auth.getUser();
        logoutEmail = String(user?.email || '').trim();
    } catch (error) {
        console.warn('Failed to capture logout email for remembered login:', error?.message || error);
    }

    try {
        await window.AdminAccess?.clearAdminStudioSession?.();
        await window.supabaseClient.auth.signOut();
    } catch (error) {
        console.error('❌ Supabase logout failed:', error);
    }

    clearLegacyRememberedAuthSecrets();
    if (logoutEmail && readRememberLoginEmailPreference()) {
        persistRememberedLoginEmail(logoutEmail);
    }
    console.log('🗑️ 已清除历史密码缓存');

    // 重置UI
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');

    setAuthDisplayState(defaultIcon, false, 'inline');
    setAuthAvatarVisualState(navAvatar, false);
    if (btnText) btnText.textContent = 'Sign In';

    const authBtn = document.getElementById('authBtn');
    if (authBtn) authBtn.classList.remove('logged-in');

    closeUserDropdown();
}

window.handleLogout = handleLogout;

async function ensureSupabaseAuthWalletModalRuntime(options = {}) {
    if (window.WalletModal) {
        if (options.prefetch === true && typeof window.WalletModal.prefetchData === 'function') {
            window.WalletModal.prefetchData();
        }
        return window.WalletModal;
    }

    const loader = window.ZaoyoeWalletModalBootstrap;
    if (!loader) {
        return null;
    }

    try {
        return options.prefetch === true && typeof loader.warm === 'function'
            ? await loader.warm({ prefetch: true })
            : await loader.ensure();
    } catch (error) {
        console.warn('⚠️ Failed to load wallet modal runtime:', error?.message || error);
        return null;
    }
}

let walletWarmPrefetchHandle = null;
let walletRuntimeWarmHandle = null;
let profileModalWarmHandle = null;
let profileModalBootstrapScriptPromise = null;
const PROFILE_MODAL_BOOTSTRAP_SRC = 'js/profile-modal-loader.js?v=20260503_PROFILE_MODAL_CHROME_CLOSE_1';

function warmSupabaseAuthWalletRuntime(reason = 'auth-ready') {
    const loader = window.ZaoyoeWalletModalBootstrap;
    if (!loader) {
        return Promise.resolve(null);
    }

    const warmTasks = [];
    if (typeof loader.warmOverview === 'function') {
        warmTasks.push(loader.warmOverview({ prefetch: true }));
    }
    warmTasks.push(
        typeof loader.warmRuntime === 'function'
            ? loader.warmRuntime({ reason })
            : ensureSupabaseAuthWalletModalRuntime({ prefetch: false })
    );

    return Promise.allSettled(warmTasks).then((results) => {
        results.forEach((result) => {
            if (result.status === 'rejected') {
                console.warn(`⚠️ Wallet runtime warmup failed (${reason}):`, result.reason?.message || result.reason);
            }
        });
        return window.WalletModal || null;
    });
}

function scheduleSupabaseAuthWalletWarmPrefetch(reason = 'auth-ready') {
    const isDropdownWarmup = reason === 'dropdown-open';

    if (isDropdownWarmup) {
        if (walletWarmPrefetchHandle) {
            return;
        }

        const runWarmPrefetch = () => {
            walletWarmPrefetchHandle = null;

            const warmTask = ensureSupabaseAuthWalletModalRuntime({ prefetch: true });

            void Promise.resolve(warmTask).catch((error) => {
                console.warn(`⚠️ Wallet warm prefetch failed (${reason}):`, error?.message || error);
            });
        };

        if (typeof window.requestIdleCallback === 'function') {
            walletWarmPrefetchHandle = window.requestIdleCallback(runWarmPrefetch, { timeout: 900 });
        } else {
            walletWarmPrefetchHandle = window.setTimeout(runWarmPrefetch, 160);
        }

        return;
    }

    if (walletRuntimeWarmHandle) {
        return;
    }

    const runRuntimeWarmup = () => {
        walletRuntimeWarmHandle = null;

        const warmTask = warmSupabaseAuthWalletRuntime(reason);
        void Promise.resolve(warmTask).catch((error) => {
            console.warn(`⚠️ Wallet runtime warmup failed (${reason}):`, error?.message || error);
        });
    };

    if (typeof window.requestIdleCallback === 'function') {
        walletRuntimeWarmHandle = window.requestIdleCallback(runRuntimeWarmup, { timeout: 2400 });
    } else {
        walletRuntimeWarmHandle = window.setTimeout(runRuntimeWarmup, 900);
    }
}

if (!window.__zaoyoeWalletBootstrapReadyWarmupBound) {
    window.addEventListener('zaoyoe:wallet-modal-bootstrap-ready', () => {
        if (!window.__ZAOYOE_LAST_AUTH_USER__) {
            return;
        }
        scheduleSupabaseAuthWalletWarmPrefetch('bootstrap-ready');
    });
    window.__zaoyoeWalletBootstrapReadyWarmupBound = true;
}

async function openSupabaseAuthWalletView(view = 'balance', context = {}) {
    const walletModal = await ensureSupabaseAuthWalletModalRuntime();
    walletModal?.open?.(view, context);
    return walletModal;
}

function findScriptByFilename(src) {
    const filename = String(src || '').split('?')[0].split('/').pop();
    if (!filename) return null;

    return Array.from(document.querySelectorAll('script[src]')).find((node) => {
        const rawSrc = node.getAttribute('src') || node.src || '';
        return rawSrc.split('?')[0].split('/').pop() === filename;
    }) || null;
}

function loadProfileModalBootstrapScript() {
    if (window.ZaoyoeProfileModalBootstrap) {
        return Promise.resolve(window.ZaoyoeProfileModalBootstrap);
    }

    if (profileModalBootstrapScriptPromise) {
        return profileModalBootstrapScriptPromise;
    }

    const existing = findScriptByFilename(PROFILE_MODAL_BOOTSTRAP_SRC);
    if (existing?.dataset.loaded === '1' || existing?.readyState === 'complete') {
        return Promise.resolve(window.ZaoyoeProfileModalBootstrap || null);
    }

    profileModalBootstrapScriptPromise = new Promise((resolve, reject) => {
        const script = existing || document.createElement('script');
        const finish = () => {
            script.dataset.loaded = '1';
            resolve(window.ZaoyoeProfileModalBootstrap || null);
        };
        const fail = () => {
            profileModalBootstrapScriptPromise = null;
            reject(new Error(`Failed to load ${PROFILE_MODAL_BOOTSTRAP_SRC}`));
        };

        script.addEventListener('load', finish, { once: true });
        script.addEventListener('error', fail, { once: true });

        if (!existing) {
            script.src = PROFILE_MODAL_BOOTSTRAP_SRC;
            script.async = false;
            (document.body || document.head || document.documentElement).appendChild(script);
        }
    });

    return profileModalBootstrapScriptPromise;
}

async function getProfileModalBootstrap() {
    if (window.ZaoyoeProfileModalBootstrap) {
        return window.ZaoyoeProfileModalBootstrap;
    }

    try {
        await loadProfileModalBootstrapScript();
    } catch (error) {
        console.warn('⚠️ Failed to load profile modal bootstrap:', error?.message || error);
    }

    return window.ZaoyoeProfileModalBootstrap || null;
}

async function ensureProfileModalRuntime(options = {}) {
    const useFastMount = options.fast !== false;
    const modalAlreadyMounted = document.getElementById('profileModal');
    if (modalAlreadyMounted) {
        if (typeof window.switchProfileSecurityPanel !== 'function') {
            const existingLoader = window.ZaoyoeProfileModalBootstrap;
            void existingLoader?.ensure?.().catch((error) => {
                console.warn('⚠️ Failed to finish profile modal runtime:', error?.message || error);
            });
        }
        return true;
    }

    const loader = await getProfileModalBootstrap();
    if (!loader || typeof loader.ensure !== 'function') {
        return false;
    }

    try {
        if (useFastMount && typeof loader.mount === 'function') {
            await loader.mount();
            return !!document.getElementById('profileModal');
        }

        await loader.ensure();
        return !!document.getElementById('profileModal');
    } catch (error) {
        console.warn('⚠️ Failed to load profile modal runtime:', error?.message || error);
        return false;
    }
}

function scheduleSupabaseAuthProfileModalWarmup(reason = 'auth-ready') {
    if (profileModalWarmHandle) {
        return;
    }

    const runWarmup = () => {
        profileModalWarmHandle = null;

        const warmTask = getProfileModalBootstrap().then((loader) => {
            if (typeof loader?.warm === 'function') {
                return loader.warm({ reason });
            }
            return ensureProfileModalRuntime({ fast: true });
        });

        void warmTask.catch((error) => {
            console.warn(`⚠️ Profile modal warmup failed (${reason}):`, error?.message || error);
        });
    };

    if (typeof window.requestIdleCallback === 'function') {
        profileModalWarmHandle = window.requestIdleCallback(runWarmup, { timeout: 1200 });
    } else {
        profileModalWarmHandle = window.setTimeout(runWarmup, 180);
    }
}

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
                    setAuthStyleState(dropdown, {
                        right: `${Math.max(10, rightOffset)}px`
                    });
                    // Shift up slightly to fuse seamlessly with the nav border.
                    setAuthStyleState(dropdown, {
                        top: `${anchorBottom - navOverlap}px`
                    });
                }
                setUserDropdownOpen(true);
                void refreshAdminEntryUiState({
                    source: 'dropdown-open'
                });

                // Pre-fetch wallet data so 'My Orders' opens instantly
                scheduleSupabaseAuthWalletWarmPrefetch('dropdown-open');
                scheduleSupabaseAuthProfileModalWarmup('dropdown-open');
            }
        }

        // Note: Background verification happens via auth state listener, 
        // no need to await getUser() here for dropdown toggle
    } else {
        // User is not logged in - open login modal
        requestLoginModalOpen('login');
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
            scheduleSupabaseAuthProfileModalWarmup('cached-session-pending');
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
    scheduleSupabaseAuthProfileModalWarmup('auth-ready');

    // 🔒 启动会话超时监控
    startSessionTimeoutMonitor();
}

// ==================== 更新用户UI ====================

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
        setAuthDisplayState(mobileAvatar, !showImage, 'block');
        setAuthDisplayState(avatarFallback, showImage, 'grid');
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

function normalizeUserForAdminAccess(user) {
    if (!user || typeof user !== 'object') return null;
    return {
        ...user,
        id: user.id || user.objectId || null
    };
}

function readCachedAuthUserProfile() {
    try {
        const raw = localStorage.getItem('cached_user_profile');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return normalizeUserForAdminAccess(parsed);
    } catch (error) {
        console.warn('Failed to read cached auth user profile:', error);
        return null;
    }
}

function waitForAuthSupabaseClientReady(timeoutMs = 4000) {
    if (window.supabaseClient) {
        return Promise.resolve(true);
    }

    const currentState = window.__ZAOYOE_SUPABASE_CLIENT_STATE__ || null;
    if (String(currentState?.status || '').trim().toLowerCase() === 'error') {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        let settled = false;
        let timer = null;

        const cleanup = () => {
            if (timer) {
                window.clearTimeout(timer);
            }
            window.removeEventListener('zaoyoe:supabase-client-state', handleStateChange);
        };

        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(value);
        };

        const handleStateChange = (event) => {
            const status = String(event?.detail?.status || '').trim().toLowerCase();
            if (status === 'ready' && window.supabaseClient) {
                finish(true);
                return;
            }
            if (status === 'error') {
                finish(false);
            }
        };

        window.addEventListener('zaoyoe:supabase-client-state', handleStateChange);
        timer = window.setTimeout(() => finish(Boolean(window.supabaseClient)), timeoutMs);
    });
}

async function refreshAdminEntryUiState(options = {}) {
    const normalizedUser = normalizeUserForAdminAccess(
        options.user ||
        window.__ZAOYOE_LAST_AUTH_USER__ ||
        readCachedAuthUserProfile()
    );
    const displayName = options.displayName ||
        window.__ZAOYOE_LAST_AUTH_DISPLAY_NAME__ ||
        normalizedUser?.nickname ||
        normalizedUser?.username ||
        'User';
    const enterStudioBtn = document.getElementById('enterStudioBtn');

    if (!normalizedUser?.id) {
        applyAdminEntryUiState(displayName, false);
        return {
            isAdmin: false,
            isSuperAdmin: false,
            permissions: [],
            error: new Error('No authenticated user available')
        };
    }

    window.__ZAOYOE_LAST_AUTH_USER__ = normalizedUser;
    window.__ZAOYOE_LAST_AUTH_DISPLAY_NAME__ = displayName;

    const requestId = `${normalizedUser.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    if (enterStudioBtn) {
        enterStudioBtn.dataset.adminAccessRequest = requestId;
    }

    if (!window.supabaseClient) {
        await waitForAuthSupabaseClientReady(options.timeoutMs || 4000);
    }

    try {
        const access = await resolveAdminEntryAccess(normalizedUser, {
            forceRefresh: options.forceRefresh === true
        });
        if (enterStudioBtn && enterStudioBtn.dataset.adminAccessRequest !== requestId) {
            return access;
        }

        applyAdminEntryUiState(displayName, Boolean(access?.isAdmin));

        if (access?.isAdmin) {
            void window.AdminAccess?.warmAdminStudioEntry?.({
                user: normalizedUser,
                access,
                defer: true,
                timeoutMs: 1800
            });
        }

        return access;
    } catch (error) {
        if (enterStudioBtn && enterStudioBtn.dataset.adminAccessRequest !== requestId) {
            return {
                isAdmin: false,
                isSuperAdmin: false,
                permissions: [],
                error
            };
        }
        applyAdminEntryUiState(displayName, false);
        return {
            isAdmin: false,
            isSuperAdmin: false,
            permissions: [],
            error
        };
    }
}

if (!window.__zaoyoeAdminEntryUiRetryBound) {
    window.addEventListener('zaoyoe:supabase-client-state', (event) => {
        const status = String(event?.detail?.status || '').trim().toLowerCase();
        if (status !== 'ready') {
            return;
        }
        if (!window.__ZAOYOE_LAST_AUTH_USER__) {
            return;
        }
        void refreshAdminEntryUiState({
            source: 'supabase-ready'
        });
    });
    window.__zaoyoeAdminEntryUiRetryBound = true;
}

window.refreshAdminEntryUi = refreshAdminEntryUiState;

function applyAdminEntryUiState(displayName, isAdmin) {
    const dropdownUsername = document.getElementById('dropdownUsername');
    const enterStudioBtn = document.getElementById('enterStudioBtn');

    if (dropdownUsername) {
        dropdownUsername.textContent = displayName || 'User';
        if (isAdmin) {
            const badge = document.createElement('span');
            badge.className = 'auth-admin-badge';
            badge.textContent = ' ✨';
            dropdownUsername.appendChild(badge);
        }
    }

    setAuthDisplayState(enterStudioBtn, !isAdmin, 'flex');
}

async function resolveAdminEntryAccess(user, options = {}) {
    const normalizedUser = normalizeUserForAdminAccess(user);
    if (!normalizedUser?.id) {
        return {
            isAdmin: false,
            isSuperAdmin: false,
            permissions: [],
            error: null
        };
    }

    if (!window.AdminAccess?.getCurrentAdminAccess) {
        return {
            isAdmin: false,
            isSuperAdmin: false,
            permissions: [],
            error: new Error('AdminAccess helper unavailable')
        };
    }

    return window.AdminAccess.getCurrentAdminAccess({
        user: normalizedUser,
        forceRefresh: options.forceRefresh === true
    });
}

function updateUserUI(user, options = {}) {
    const { animateAvatar = false, preferImmediateAvatar = false, clearCacheOnLogout = false } = options;
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');
    const userDropdown = document.getElementById('userDropdown');
    const enterStudioBtn = document.getElementById('enterStudioBtn');
    const authBtn = document.getElementById('authBtn');
    const hasAuthNavMarkup = !!(authBtn || defaultIcon || navAvatar || btnText);

    if (user && !hasAuthNavMarkup) {
        window.__ZAOYOE_PENDING_AUTH_USER__ = {
            user,
            options: {
                ...options,
                preferImmediateAvatar: true
            },
            updatedAt: Date.now()
        };
    } else if (!user) {
        window.__ZAOYOE_PENDING_AUTH_USER__ = null;
    }

    if (user) {
        console.log('👤 updateUserUI: 用户已登录', user);

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

            const hasVisibleAvatar = isAuthAvatarVisible(navAvatar);

            // If we already have the exact same image showing, do nothing
            const currentRaw = navAvatar.getAttribute('src') || navAvatar.src || '';
            if (currentRaw && normalizeAvatarUrl(currentRaw) === normalizeAvatarUrl(preferredAvatarUrl) && hasVisibleAvatar) {
                // Already showing the correct image
            } else {
                const revealAvatar = (url) => {
                    navAvatar.onerror = function () {
                        const failedBase = normalizeAvatarUrl(this.src || '');
                        const fallbackBase = normalizeAvatarUrl(fallbackUrl);
                        if (failedBase === fallbackBase) return;

                        if (!/googleusercontent\.com/i.test(url) || !hasVisibleAvatar) {
                            navAvatar.src = fallbackUrl;
                            setAuthAvatarVisualState(navAvatar, true);
                            setAuthDisplayState(defaultIcon, true, 'inline');
                        }
                    };
                    navAvatar.src = url;
                    setAuthAvatarVisualState(navAvatar, true);
                    setAuthDisplayState(defaultIcon, true, 'inline');
                };

                if (preferImmediateAvatar || !hasVisibleAvatar) {
                    revealAvatar(preferredAvatarUrl);
                } else {
                    // Keep the current avatar visible while the fresh URL is verified.
                    const preloader = new Image();
                    preloader.onload = () => revealAvatar(preferredAvatarUrl);
                    preloader.onerror = () => {
                        console.warn(`⚠️ Failed to load avatar from: ${preferredAvatarUrl}, falling back to generator.`);
                        // Only fallback to generator if it's not a google URL failure, or we must.
                        if (!/googleusercontent\.com/i.test(preferredAvatarUrl) || !hasVisibleAvatar) {
                            revealAvatar(fallbackUrl);
                        }
                    };
                    preloader.src = preferredAvatarUrl;
                }

                if (animateAvatar) {
                    navAvatar.classList.remove('animate-in');
                    void navAvatar.offsetWidth; // Force reflow
                    navAvatar.classList.add('animate-in');
                }
            }
        } else if (defaultIcon) {
            setAuthDisplayState(defaultIcon, true, 'inline');
        }

        if (btnText) {
            btnText.textContent = user.nickname || user.username || 'User';
        }

        const displayName = user.nickname || user.username || 'User';
        window.__ZAOYOE_LAST_AUTH_USER__ = normalizeUserForAdminAccess(user);
        window.__ZAOYOE_LAST_AUTH_DISPLAY_NAME__ = displayName;
        applyAdminEntryUiState(displayName, false);

        if (authBtn) authBtn.classList.add('logged-in');

        updateProfileMobileSummary({
            nickname: user.nickname || user.username || 'User',
            email: user.email || '',
            userId: user.objectId || user.id || '',
            phone: user.phone || user.phone_number || ''
        });
        setProfileModalAvatar(
            user.avatarUrl,
            user.email || user.username || user.nickname || 'User',
            { preferImmediate: preferImmediateAvatar }
        );
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

        void refreshAdminEntryUiState({
            user,
            displayName,
            source: 'update-user-ui'
        }).catch((error) => {
            console.warn('Failed to resolve admin entry access:', error);
        });
    } else {
        if (defaultIcon) {
            setAuthDisplayState(defaultIcon, false, 'inline');
        }
        if (navAvatar) {
            navAvatar.classList.remove('animate-in');
            setAuthAvatarVisualState(navAvatar, false);
        }
        if (btnText) btnText.textContent = 'Sign In';
        closeUserDropdown();
        setAuthDisplayState(enterStudioBtn, true, 'flex');
        if (authBtn) {
            authBtn.classList.remove('logged-in');
        }
        window.__ZAOYOE_LAST_AUTH_USER__ = null;
        window.__ZAOYOE_LAST_AUTH_DISPLAY_NAME__ = '';
        applyAdminEntryUiState('User', false);
        window.AdminAccess?.clearAccessCache?.();
        window.AdminAccess?.clearCachedAdminStudioSession?.();

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

    const resetForm = document.getElementById('resetForm');
    const emailInput = document.getElementById('reset-email');
    const submitBtn = resetForm?.querySelector('button[type="submit"]')
        || document.querySelector('[data-auth-submit="reset"][form="resetForm"], button[type="submit"][form="resetForm"]');

    if (!emailInput || !submitBtn) {
        showAuthFeedback(authT('auth.resetFormMissing', '系统错误：找不到表单元素，请刷新页面重试。'), 'error', 'reset');
        return;
    }

    const email = emailInput.value.trim();

    if (!email) {
        showAuthFeedback(authT('auth.enterEmailAddress', '请输入邮箱地址'), 'error', 'reset');
        return;
    }

    if (!isValidAuthEmailFormat(email)) {
        showAuthFeedback(getInvalidResetEmailMessage(), 'error', 'reset');
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
        showAuthFeedback(getPasswordResetErrorMessage(error), 'error', 'reset');
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
const LEGACY_GOOGLE_CLIENT_ID = '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com';
const DISABLE_OAUTH_REDIRECT_FALLBACK = true;
const GOOGLE_POPUP_MESSAGE_TYPE = 'zaoyoe:google-auth-popup';
const GOOGLE_POPUP_ACK_MESSAGE_TYPE = 'zaoyoe:google-auth-popup-ack';
const GOOGLE_POPUP_WINDOW_NAME = 'google_login';
const GOOGLE_POPUP_RESULT_STORAGE_KEY = 'zaoyoe_google_popup_auth_result_v1';
const GOOGLE_AUTH_DEBUG_STORAGE_KEY = 'zaoyoe_google_auth_debug_v1';
const GOOGLE_POPUP_CLOSE_PREFETCH_SCRIPT_VERSION = '20260509_AUTH_POPUP_FAST_RETRY_1';
const GOOGLE_POPUP_CLOSE_PREFETCH_STYLE_VERSION = '20260509_AUTH_POPUP_CLOSE_THEME_1';
const GOOGLE_POPUP_STATE_PREFIX = 'zaoyoe_google_popup:';
const GOOGLE_POPUP_STATE_STORAGE_KEY = 'zaoyoe_google_popup_state_v1';
const GOOGLE_REDIRECT_STATE_PREFIX = 'zaoyoe_google_redirect:';
const GOOGLE_REDIRECT_STATE_STORAGE_KEY = 'zaoyoe_google_redirect_state_v1';
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
let googlePopupClosureErrorTimer = null;
let googlePopupCloseShellPrefetched = false;

function syncGoogleAuthDebugFlag() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const raw = String(params.get('authDebug') || '').trim().toLowerCase();
        if (!raw) return;
        if (raw === '1' || raw === 'true' || raw === 'on') {
            localStorage.setItem(GOOGLE_AUTH_DEBUG_STORAGE_KEY, '1');
            return;
        }
        if (raw === '0' || raw === 'false' || raw === 'off') {
            localStorage.removeItem(GOOGLE_AUTH_DEBUG_STORAGE_KEY);
        }
    } catch (_) {
        // ignore query/localStorage failures
    }
}

function isGoogleAuthDebugEnabled() {
    try {
        return localStorage.getItem(GOOGLE_AUTH_DEBUG_STORAGE_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function updateGoogleAuthDebugState(label = '', detail = '') {
    if (!isGoogleAuthDebugEnabled()) {
        window.clearAuthGoogleDebugState?.();
        return false;
    }
    window.setAuthGoogleDebugState?.({
        enabled: true,
        label,
        detail
    });
    return true;
}

syncGoogleAuthDebugFlag();

function formatGoogleAuthDebugSource(source = '') {
    switch (String(source || '').trim()) {
        case 'gis_button':
            return 'GIS 按钮';
        case 'popup_bridge':
            return 'Popup 回调';
        case 'same_tab_redirect':
            return '同页重定向';
        default:
            return '未知来源';
    }
}

function resolveGoogleAuthSite() {
    const configuredSite = String(window.SiteConfig?.site || '').trim().toLowerCase();
    if (configuredSite === 'cn' || configuredSite === 'intl') {
        return configuredSite;
    }

    try {
        const siteParam = new URLSearchParams(window.location.search || '').get('site');
        if (siteParam === 'cn' || siteParam === 'intl') {
            return siteParam;
        }
    } catch (_) {
        // ignore query parsing failures
    }

    const runtimeSite = String(
        window.getZaoyoeSupabaseConfig?.()?.site
        || window.__ZAOYOE_RUNTIME_SITE__
        || ''
    ).trim().toLowerCase();
    if (runtimeSite === 'cn' || runtimeSite === 'intl') {
        return runtimeSite;
    }

    const hostname = String(window.location.hostname || '').trim().toLowerCase();
    if (hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz')) {
        return 'intl';
    }

    return 'cn';
}

function resolveGoogleAuthConfig(siteOverride = '') {
    const currentSite = String(siteOverride || resolveGoogleAuthSite()).trim().toLowerCase() === 'intl'
        ? 'intl'
        : 'cn';

    if (typeof window.getZaoyoeGoogleAuthConfig === 'function') {
        try {
            const runtimeConfig = window.getZaoyoeGoogleAuthConfig(currentSite);
            const runtimeClientId = String(runtimeConfig?.clientId || '').trim();
            if (runtimeClientId) {
                return {
                    site: currentSite,
                    clientId: runtimeClientId,
                    source: String(runtimeConfig?.source || '').trim() || 'runtime'
                };
            }
        } catch (error) {
            console.warn('Failed to resolve Google auth config from runtime helper:', error);
        }
    }

    try {
        const supabaseRuntimeConfig = typeof window.requireZaoyoeSupabaseConfig === 'function'
            ? window.requireZaoyoeSupabaseConfig()
            : null;
        const googleConfig = supabaseRuntimeConfig?.auth?.google || {};
        const runtimeClientId = String(
            googleConfig?.clientIds?.[currentSite]
            || googleConfig?.clientId
            || ''
        ).trim();
        if (runtimeClientId) {
            return {
                site: currentSite,
                clientId: runtimeClientId,
                source: String(googleConfig?.source || '').trim() || 'runtime'
            };
        }
    } catch (error) {
        console.warn('Failed to resolve Google auth config from runtime payload:', error);
    }

    return {
        site: currentSite,
        clientId: LEGACY_GOOGLE_CLIENT_ID,
        source: 'legacy'
    };
}

function resolveGoogleClientId(siteOverride = '') {
    const resolved = resolveGoogleAuthConfig(siteOverride);
    return String(resolved.clientId || '').trim();
}

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
            btn.classList.add('is-loading');
            btn.innerHTML = `<i class="fas fa-spinner fa-spin google-login-btn__spinner" aria-hidden="true"></i><span>${text}</span>`;
        } else {
            if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
            delete btn.dataset.originalHtml;
            delete btn.dataset.googleBusy;
            btn.classList.remove('is-loading');
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

function createGoogleRedirectState() {
    const state = `${GOOGLE_REDIRECT_STATE_PREFIX}${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    try {
        localStorage.setItem(GOOGLE_REDIRECT_STATE_STORAGE_KEY, state);
    } catch (err) {
        console.warn('Failed to persist Google redirect state:', err);
    }
    return state;
}

function buildGoogleImplicitAuthRedirectUri(mode = 'same-tab') {
    if (String(mode || '').trim().toLowerCase() === 'popup') {
        return new URL('/auth-popup-close', window.location.origin).toString();
    }
    return window.location.origin;
}

function buildGoogleImplicitAuthUrl(state, options = {}) {
    const clientId = resolveGoogleClientId();
    if (!clientId) {
        throw new Error('当前站点未配置 Google Client ID');
    }
    const redirectMode = String(options?.mode || '').trim().toLowerCase() === 'popup'
        ? 'popup'
        : 'same-tab';
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', buildGoogleImplicitAuthRedirectUri(redirectMode));
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', String(Date.now()));
    authUrl.searchParams.set('prompt', 'select_account');
    return authUrl.toString();
}

function shouldUseGoogleSameTabRedirect() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isIOS = /iP(ad|hone|od)/i.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isIOS && /WebKit/i.test(ua);
}

function buildGooglePopupRedirectUrl(mode = 'callback') {
    const popupUrl = new URL('/auth-popup-close', window.location.origin);
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
            window.open('', '_self');
        } catch (_) {
            // ignore
        }
        tryClose();
    }, 120);
    setTimeout(() => {
        if (window.closed) return;
        const fallbackTarget = readPendingPostLoginRedirectTarget() || '/';
        try {
            window.location.replace(normalizePostLoginRedirectTarget(fallbackTarget, '/'));
        } catch (_) {
            try {
                window.location.replace(buildGooglePopupRedirectUrl('close'));
            } catch (err) {
                // ignore
            }
        }
    }, 420);

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

function clearGooglePopupClosureErrorTimer() {
    if (googlePopupClosureErrorTimer) {
        clearTimeout(googlePopupClosureErrorTimer);
        googlePopupClosureErrorTimer = null;
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

function hasActiveGoogleAuthLoading() {
    return !!(
        window.isGoogleLoginLoading ||
        document.querySelector('.google-login-btn.is-loading, .google-login-btn[data-google-busy="1"]')
    );
}

function closeGoogleAuthSurfacesAfterSuccess() {
    setGoogleButtonsLoading(false);

    if (typeof window.closeAdminLoginModal === 'function') {
        try {
            window.closeAdminLoginModal();
        } catch (err) {
            console.warn('Failed to close admin login modal:', err);
        }
    }

    if (typeof window.closeLoginModal === 'function') {
        try {
            window.closeLoginModal();
        } catch (err) {
            console.warn('Failed to close login modal:', err);
        }
    }

    const loginModal = document.getElementById('loginModal');
    if (!loginModal) return;

    loginModal.classList.remove('active', 'auth-sheet-input-active', 'ios-focus-lock');
    loginModal.setAttribute('aria-hidden', 'true');
    loginModal.hidden = true;
    document.body?.classList?.remove('auth-sheet-open');

    if (window.iOSScrollLock && !hasActiveModalBehindLogin()) {
        try {
            window.iOSScrollLock.unlock();
        } catch (err) {
            console.warn('Failed to unlock auth sheet scroll state:', err);
        }
    }
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
            payload.credential ? 'credential' : '',
            payload.emittedAt || ''
        ].join('|');

        if (signature && signature === googlePopupLastResultSignature) {
            return;
        }
        googlePopupLastResultSignature = signature;

        googlePopupAuthResultHandled = true;
        clearGooglePopupClosureErrorTimer();
        stopGooglePopupMonitor();
        closeTrackedGooglePopup();
        clearGooglePopupState();

        if (payload.status === 'credential') {
            if (!payload.credential) {
                setGoogleButtonsLoading(false);
                showAuthFeedback(
                    formatAuthText('auth.googleLoginFailed', 'Google 登录失败: {message}', {
                        message: authT('auth.tryAgainLater', '请稍后重试')
                    }),
                    'error',
                    'login'
                );
                return;
            }

            clearAuthFeedback();
            clearInlineGoogleFallbackButtons();
            closeGoogleAuthSurfacesAfterSuccess();
            await handleGoogleCredentialResponse({ credential: payload.credential }, {
                fromPopupBridge: true,
                source: 'popup_bridge'
            });
            return;
        }

        setGoogleButtonsLoading(false);

        if (payload.status === 'success') {
            clearAuthFeedback();
            clearInlineGoogleFallbackButtons();
            closeGoogleAuthSurfacesAfterSuccess();

            try {
                await new Promise((resolve) => setTimeout(resolve, 120));
                await checkAuthState();
                if (payload.userId) {
                    flushPendingAuthOrigin(payload.userId);
                }
                if (redirectToPendingPostLoginTarget()) {
                    return;
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
        if (event.data?.type === GOOGLE_POPUP_MESSAGE_TYPE && event.source && typeof event.source.postMessage === 'function') {
            try {
                event.source.postMessage({
                    type: GOOGLE_POPUP_ACK_MESSAGE_TYPE,
                    popupEventId: event.data.popupEventId || event.data.emittedAt || ''
                }, event.origin);
            } catch (_) {
                // ignore ack failures
            }
        }
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
    document.querySelectorAll('.gsi-btn-container[data-inline-fallback="1"], .auth-sheet-google-render-slot[data-inline-fallback="1"]').forEach((node) => {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    document.querySelectorAll('.google-login-btn.gsi-hidden').forEach((btn) => {
        btn.classList.remove('gsi-hidden');
        btn.removeAttribute('aria-hidden');
        btn.removeAttribute('tabindex');
    });
}
window.clearInlineGoogleFallbackButtons = clearInlineGoogleFallbackButtons;

function ensureInlineGoogleButtonSlot(fallbackButton) {
    if (!fallbackButton?.parentNode) return null;
    const previous = fallbackButton.previousElementSibling;
    if (previous?.classList?.contains('auth-sheet-google-render-slot')) {
        return previous;
    }

    const slot = document.createElement('div');
    slot.className = 'auth-sheet-google-render-slot gsi-btn-container';
    slot.dataset.inlineFallback = '1';
    slot.hidden = true;
    fallbackButton.parentNode.insertBefore(slot, fallbackButton);
    return slot;
}

function resolveGoogleButtonLocale() {
    const htmlLang = String(document.documentElement?.lang || '').trim().toLowerCase();
    const runtimeLang = String(window.currentLanguage || window.i18n?.currentLanguage || '').trim().toLowerCase();
    const source = runtimeLang || htmlLang;
    if (source.startsWith('zh')) return 'zh-CN';
    if (source.startsWith('ja')) return 'ja';
    if (source.startsWith('ko')) return 'ko';
    return 'en';
}

function renderInlineGoogleButtons() {
    if (!window.google?.accounts?.id?.renderButton) {
        updateGoogleAuthDebugState('当前入口：Popup Fallback', 'GIS button unavailable');
        return false;
    }

    const buttons = Array.from(document.querySelectorAll('.google-login-btn'));
    let rendered = 0;

    buttons.forEach((btn) => {
        const slot = ensureInlineGoogleButtonSlot(btn);
        if (!slot) return;

        const buttonWidth = Math.max(280, Math.round(btn.getBoundingClientRect().width || btn.offsetWidth || 320));

        try {
            slot.hidden = false;
            slot.innerHTML = '';
            slot.classList.remove('is-ready');
            window.google.accounts.id.renderButton(slot, {
                type: 'standard',
                theme: 'outline',
                size: 'large',
                text: 'continue_with',
                shape: 'pill',
                logo_alignment: 'left',
                locale: resolveGoogleButtonLocale(),
                width: buttonWidth
            });
            slot.classList.add('is-ready');
            btn.classList.add('gsi-hidden');
            btn.setAttribute('aria-hidden', 'true');
            btn.setAttribute('tabindex', '-1');
            rendered += 1;
        } catch (error) {
            console.warn('⚠️ Failed to render inline Google button:', error?.message || error);
            slot.hidden = true;
            slot.classList.remove('is-ready');
            btn.classList.remove('gsi-hidden');
            btn.removeAttribute('aria-hidden');
            btn.removeAttribute('tabindex');
        }
    });

    if (rendered > 0) {
        updateGoogleAuthDebugState('当前入口：GIS 按钮', resolveGoogleAuthSite().toUpperCase());
    } else {
        updateGoogleAuthDebugState('当前入口：Popup Fallback', 'GIS render failed');
    }

    return rendered > 0;
}

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
    const clientId = resolveGoogleClientId();
    if (!clientId) {
        throw new Error('当前站点未配置 Google Client ID');
    }

    // We used to wipe storage here to clear stuck PKCE nonces, but that is no longer needed
    // since we use a custom popup flow, and it was violently destroying the user's session!

    // Initialize the Google Accounts script manually in case FedCM fallback is ever needed
    // or to keep the Google object initialized properly.
    google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
            if (typeof window.handleGoogleCredentialResponse === 'function') {
                updateGoogleAuthDebugState('收到凭证：GIS 按钮', resolveGoogleAuthSite().toUpperCase());
                window.handleGoogleCredentialResponse(response, {
                    source: 'gis_button'
                });
            } else {
                console.error('❌ Google callback handler not ready');
                setGoogleButtonsLoading(false);
            }
        },
        context: 'signin',
        auto_select: false,
        itp_support: true,
        use_fedcm_for_button: false
    });
    googleIdentityInitialized = true;
}

async function ensureGoogleInlineButtonReady(options = {}) {
    const loaded = await loadGoogleIdentityServices();
    if (!loaded || !window.google?.accounts?.id) return false;
    await initGoogleIdTokenFlow();
    if (options?.renderFallbackButton === true) {
        renderInlineGoogleButtons();
    }
    console.log('✅ Google Identity Services ready');
    return true;
}
window.ensureGoogleInlineButtonReady = ensureGoogleInlineButtonReady;

function prefetchGooglePopupCloseShell() {
    if (googlePopupCloseShellPrefetched || typeof document === 'undefined' || !window.location?.origin) {
        return;
    }
    googlePopupCloseShellPrefetched = true;

    const urls = [
        { href: new URL('/auth-popup-close', window.location.origin).toString(), as: 'document' },
        { href: new URL(`/js/auth-popup-close-page.js?v=${GOOGLE_POPUP_CLOSE_PREFETCH_SCRIPT_VERSION}`, window.location.origin).toString(), as: 'script' },
        { href: new URL(`/css/auth-popup-close.css?v=${GOOGLE_POPUP_CLOSE_PREFETCH_STYLE_VERSION}`, window.location.origin).toString(), as: 'style' }
    ];

    const head = document.head || document.documentElement;
    urls.forEach(({ href, as }) => {
        try {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = href;
            if (as) {
                link.as = as;
            }
            head.appendChild(link);
        } catch (_) {
            // ignore DOM prefetch failures
        }

        try {
            void fetch(href, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'force-cache',
                mode: 'same-origin'
            }).catch(() => {});
        } catch (_) {
            // ignore fetch prewarm failures
        }
    });
}
window.prefetchGooglePopupCloseShell = prefetchGooglePopupCloseShell;

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

function normalizePostLoginRedirectTarget(rawTarget, fallback = '') {
    const raw = String(rawTarget || '').trim();
    if (!raw) {
        return fallback;
    }

    try {
        const targetUrl = new URL(raw, window.location.origin);
        if (targetUrl.origin !== window.location.origin || /\/auth-callback\.html$/i.test(targetUrl.pathname)) {
            return fallback;
        }
        return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    } catch (error) {
        return fallback;
    }
}

function storePendingPostLoginRedirectTarget(target) {
    const safeTarget = normalizePostLoginRedirectTarget(target);
    if (!safeTarget) {
        return null;
    }

    try {
        localStorage.setItem(POST_LOGIN_REDIRECT_STORAGE_KEY, JSON.stringify({
            target: safeTarget,
            savedAt: Date.now(),
            ttlMs: POST_LOGIN_REDIRECT_TTL_MS
        }));
        return safeTarget;
    } catch (err) {
        console.warn('Failed to store post-login redirect target:', err);
        return null;
    }
}

function readPendingPostLoginRedirectTarget() {
    try {
        const raw = localStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);
        const savedAt = Number(parsed?.savedAt || 0);
        const ttlMs = Number(parsed?.ttlMs || POST_LOGIN_REDIRECT_TTL_MS);
        const safeTarget = normalizePostLoginRedirectTarget(parsed?.target);

        if (!safeTarget || !Number.isFinite(savedAt) || !Number.isFinite(ttlMs) || savedAt + ttlMs <= Date.now()) {
            localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
            return null;
        }

        return safeTarget;
    } catch (err) {
        console.warn('Failed to read post-login redirect target:', err);
        localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
        return null;
    }
}

function consumePendingPostLoginRedirectTarget() {
    const target = readPendingPostLoginRedirectTarget();
    try {
        localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
    } catch (err) {
        console.warn('Failed to clear post-login redirect target:', err);
    }
    return target;
}

function redirectToPendingPostLoginTarget() {
    const target = consumePendingPostLoginRedirectTarget();
    if (!target) {
        return false;
    }

    if (typeof window.location?.replace === 'function') {
        window.location.replace(target);
    } else {
        window.location.href = target;
    }
    return true;
}

async function triggerGoogleOAuthRedirectFallback() {
    if (!shouldUseOAuthRedirectFallback()) {
        throw new Error('OAuth redirect fallback disabled');
    }
    const currentPage = getCurrentPageRedirectUrl();
    storePendingPostLoginRedirectTarget(currentPage);
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
// We now prefer same-tab Google account selection on every platform so users do not see a
// detached popup shell after account selection. The popup bridge remains as a fallback/debug path.
window.triggerGoogleLogin = async () => {
    console.log('🔵 triggerGoogleLogin called (Client-side Google auth mode)');

    if (window.isGoogleLoginLoading) return;
    clearAuthFeedback();
    setGoogleButtonsLoading(true, authT('auth.redirectingToGoogle', '正在跳转到 Google...'));

    try {
        updateGoogleAuthDebugState('本次登录：同页重定向', resolveGoogleAuthSite().toUpperCase());
        startGoogleSameTabRedirectLogin();
        return;
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

function startGoogleSameTabRedirectLogin() {
    const currentPage = getCurrentPageRedirectUrl();
    storePendingPostLoginRedirectTarget(currentPage);
    try {
        localStorage.setItem('oauth_post_login_redirect', currentPage);
    } catch (err) {
        console.warn('Failed to persist legacy OAuth redirect target:', err);
    }

    stopGooglePopupMonitor();
    closeTrackedGooglePopup();
    clearGooglePopupState();
    clearGooglePopupClosureErrorTimer();

    const redirectState = createGoogleRedirectState();
    window.location.assign(buildGoogleImplicitAuthUrl(redirectState));
}

// Fallback: Open Google OAuth in a popup window when One Tap is blocked
function openGooglePopupFallback() {
    const popupState = createGooglePopupState();
    const authUrl = buildGoogleImplicitAuthUrl(popupState, { mode: 'popup' });

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
    clearGooglePopupClosureErrorTimer();

    const popup = window.open(authUrl, GOOGLE_POPUP_WINDOW_NAME,
        `width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no`);

    if (!popup) {
        updateGoogleAuthDebugState('Popup Fallback', '弹窗被拦截');
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
                clearGooglePopupClosureErrorTimer();
                googlePopupClosureErrorTimer = setTimeout(() => {
                    googlePopupClosureErrorTimer = null;
                    if (googlePopupAuthResultHandled) {
                        return;
                    }
                    updateGoogleAuthDebugState('Popup Fallback', '窗口已关闭');
                    setGoogleButtonsLoading(false);
                    showAuthFeedback(
                        authT('auth.googlePopupClosed', '登录窗口已关闭，请重试'),
                        'error',
                        'login'
                    );
                }, 900);
            }
            return;
        }

        if (Date.now() - popupOpenedAt > 120000) {
            stopGooglePopupMonitor();
            closeTrackedGooglePopup();
            clearGooglePopupState();
            clearGooglePopupClosureErrorTimer();
            updateGoogleAuthDebugState('Popup Fallback', '登录超时');
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
    const authSourceLabel = formatGoogleAuthDebugSource(options.source);
    try {
        if (!response?.credential) throw new Error('未获取到 Google 凭证');
        googleCredentialReceived = true;
        googleLoginAttemptId += 1;
        updateGoogleAuthDebugState('收到凭证', authSourceLabel);

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
        updateGoogleAuthDebugState('登录成功', authSourceLabel);

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

        closeGoogleAuthSurfacesAfterSuccess();
        if (typeof checkAuthState === 'function') {
            await checkAuthState();
        }
        if (redirectToPendingPostLoginTarget()) {
            return;
        }
    } catch (error) {
        console.error('❌ Google ID Token login error:', error);
        updateGoogleAuthDebugState('登录失败', authSourceLabel || (error?.message || '未知错误'));
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
        const errorMessage = formatAuthText('auth.googleLoginFailed', 'Google 登录失败: {message}', {
            message: error.message || authT('auth.tryAgainLater', '请稍后重试')
        });
        if (options.fromPopupBridge === true && typeof window.openLoginModalWithMessage === 'function') {
            await window.openLoginModalWithMessage(errorMessage, {
                type: 'error',
                viewId: 'login'
            });
            return;
        }
        showAuthFeedback(errorMessage, 'error', 'login');
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

        // Call Edge Function
        const response = await fetch(
            window.getZaoyoeSupabaseFunctionUrl('upload-avatar'),
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

let managedDismissMouseDownOverlay = null;

function closeManagedModalOverlay(overlay) {
    if (!overlay) return;

    if (overlay.id === 'profileModal') {
        closeProfileModal();
        return;
    }

    overlay.classList.remove('active');

    if (window.iOSScrollLock) {
        window.iOSScrollLock.unlock();
    }
}

function handleManagedModalPointerDismiss(event) {
    const target = event.target;
    const overlay = target instanceof Element && target.classList.contains('modal-overlay')
        ? target
        : null;
    const isManagedOverlay = overlay?.dataset?.modalDismissManaged === '1';

    if (event.type === 'mousedown') {
        managedDismissMouseDownOverlay = isManagedOverlay ? overlay : null;
        return;
    }

    if (event.type === 'mouseup') {
        if (isManagedOverlay && managedDismissMouseDownOverlay === overlay) {
            closeManagedModalOverlay(overlay);
        }
        managedDismissMouseDownOverlay = null;
    }
}

function handleManagedModalCloseTrigger(event) {
    const target = event.target;
    const closeTrigger = target instanceof Element
        ? target.closest('[data-modal-close-button="1"]')
        : null;
    if (!closeTrigger) return;

    event.preventDefault?.();
    const overlay = closeTrigger.closest('.modal-overlay[data-modal-dismiss-managed="1"]');
    if (overlay) {
        closeManagedModalOverlay(overlay);
    }
}

function handleProfileModalAction(event) {
    const target = event.target;
    const actionTrigger = target instanceof Element
        ? target.closest('[data-profile-action]')
        : null;
    if (!actionTrigger) return;

    const profileModal = document.getElementById('profileModal');
    if (!profileModal || !profileModal.contains(actionTrigger)) {
        return;
    }

    const action = String(actionTrigger.dataset.profileAction || '').trim();
    if (!action) return;

    event.preventDefault?.();

    switch (action) {
        case 'switch-tab':
            switchProfileTab(actionTrigger.dataset.profileTab || 'profile');
            break;
        case 'trigger-avatar-upload':
            triggerAvatarUpload();
            break;
        case 'open-editor':
            openProfileEditor(event);
            break;
        case 'toggle-nickname-edit':
            toggleNicknameEdit(actionTrigger.dataset.profileToggleVisible === 'true');
            break;
        case 'save-nickname':
            void saveNickname();
            break;
        case 'open-wallet-view':
            openProfileWalletView(actionTrigger.dataset.walletView || 'balance', event);
            break;
        case 'switch-security-panel':
            if (typeof window.switchProfileSecurityPanel === 'function') {
                window.switchProfileSecurityPanel(actionTrigger.dataset.securityPanel || 'change-password', event);
            } else {
                const targetPanel = actionTrigger.dataset.securityPanel || 'change-password';
                void ensureProfileModalRuntime({ fast: false }).then(() => {
                    window.switchProfileSecurityPanel?.(targetPanel);
                });
            }
            break;
        case 'change-password':
            finishProfileSecurityAction('changePassword', window.changePassword);
            break;
        case 'send-phone-code':
            finishProfileSecurityAction('sendPhoneVerificationCode', window.sendPhoneVerificationCode);
            break;
        case 'bind-phone':
            finishProfileSecurityAction('bindPhone', window.bindPhone);
            break;
        case 'delete-account':
            finishProfileSecurityAction('deleteAccount', window.deleteAccount);
            break;
        default:
            break;
    }
}

function handleProfileModalChange(event) {
    const target = event.target;
    const changeTarget = target instanceof Element
        ? target.closest('[data-profile-change]')
        : null;
    if (!changeTarget) return;

    const profileModal = document.getElementById('profileModal');
    if (!profileModal || !profileModal.contains(changeTarget)) {
        return;
    }

    const changeType = String(changeTarget.dataset.profileChange || '').trim();
    if (changeType === 'avatar-upload') {
        void handleAvatarUpload(event);
    }
}

function finishProfileSecurityAction(actionName, callback) {
    if (typeof callback === 'function') {
        callback();
        return;
    }

    void ensureProfileModalRuntime({ fast: false }).then(() => {
        const action = window[actionName];
        if (typeof action === 'function') {
            action();
        }
    });
}

function initializeManagedProfileInteractions() {
    if (window.__managedProfileInteractionsBound) return;

    document.addEventListener('mousedown', handleManagedModalPointerDismiss);
    document.addEventListener('mouseup', handleManagedModalPointerDismiss);
    document.addEventListener('click', handleManagedModalCloseTrigger);
    document.addEventListener('click', handleProfileModalAction);
    document.addEventListener('change', handleProfileModalChange);

    window.__managedProfileInteractionsBound = true;
}

initializeManagedProfileInteractions();

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
        await window.AdminAccess?.clearAdminStudioSession?.();
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

    clearLegacyRememberedAuthSecrets();
    localStorage.removeItem('cached_user_profile');

    updateUserUI(null, { clearCacheOnLogout: true });
    console.log('✅ 已强制登出');
}

window.forceLogout = forceLogout;


// ==================== 页面加载时检查登录状态 ====================
async function initializeAuthPageBoot() {
    console.log('📄 页面加载完成');
    clearLegacyRememberedAuthSecrets();

    // 🆕 Instant UI restoration from cache (prevents avatar flash on hard refresh)
    const cachedProfile = localStorage.getItem('cached_user_profile');
    if (cachedProfile) {
        try {
            const user = JSON.parse(cachedProfile);
            console.log('⚡ Instant restore from cached profile:', user.nickname);
            updateUserUI(user);
            scheduleSupabaseAuthProfileModalWarmup('cached-profile');
        } catch (e) {
            console.warn('Failed to parse cached profile:', e);
        }
    }

    // 等待 Supabase 客户端初始化
    if (!window.supabaseClient) {
        console.warn('⚠️ Supabase client not ready, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Warm Google Identity Services in the background so it does not block nav avatar restore.
    const googleIdentityWarmup = ensureGoogleInlineButtonReady().catch((err) => {
        console.warn('⚠️ Google identity preload failed:', err?.message || err);
        return false;
    });
    void googleIdentityWarmup;
    prefetchGooglePopupCloseShell();

    restoreRememberedLoginState();

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
                closePopup: isGooglePopupWindow() || popupStateMatched,
                source: popupStateMatched ? 'popup_bridge' : 'same_tab_redirect'
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
        const pendingLoginModalView = sessionStorage.getItem('openLoginModalView');
        sessionStorage.removeItem('openLoginModal');
        sessionStorage.removeItem('openLoginModalView');
        setTimeout(() => {
            requestLoginModalOpen(pendingLoginModalView || 'login');
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

        if (event === 'SIGNED_IN' && session && hasActiveGoogleAuthLoading()) {
            closeGoogleAuthSurfacesAfterSuccess();
        }

        // INITIAL_SESSION fires on page load. After OAuth redirect, this is where
        // the session tokens first arrive. We must process it if a session exists.
        if (event === 'INITIAL_SESSION') {
            authStateInitialized = true;
            if (session) {
                console.log('🔔 INITIAL_SESSION has session, updating UI...');
                checkAuthState();
                flushPendingAuthOrigin(session.user.id);
                scheduleSupabaseAuthWalletWarmPrefetch('initial-session');
                scheduleSupabaseAuthProfileModalWarmup('initial-session');
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
                    scheduleSupabaseAuthWalletWarmPrefetch('signed-in');
                    scheduleSupabaseAuthProfileModalWarmup('signed-in');
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
const PROFILE_MODAL_KEYBOARD_SETTLE_MS = 260;
const PROFILE_MODAL_KEYBOARD_RESIZE_IDLE_MS = 180;
const PROFILE_MODAL_KEYBOARD_MOTION_MS = 250;
const PROFILE_MODAL_SCROLL_STATE_CLEAR_MS = 320;
const profileModalState = {
    baseScrollY: 0,
    overlayBaseHeight: 0,
    baseViewportHeight: 0,
    baseVisualHeight: 0,
    baseCardHeight: 0,
    lastKeyboardBottomInset: 0,
    lastDockHeight: 0,
    lastTranslateY: 0,
    viewportCleanup: null,
    rootScrollCleanup: null,
    layoutRafId: 0,
    keyboardResizeTimer: null,
    keyboardMotionTimer: null,
    pendingFirstDockTimer: null,
    pendingFirstDockParams: null,
    focusScrollRafId: 0,
    focusScrollTimer: null,
    focusScrollSuppressUntil: 0,
    keyboardBlurUndocking: false,
    lastStableKeyboardInset: 0,
    scrollAnimationRafId: 0,
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
    if (profileModalState.keyboardResizeTimer) {
        clearTimeout(profileModalState.keyboardResizeTimer);
        profileModalState.keyboardResizeTimer = null;
    }
    if (profileModalState.keyboardMotionTimer) {
        clearTimeout(profileModalState.keyboardMotionTimer);
        profileModalState.keyboardMotionTimer = null;
    }
    if (profileModalState.pendingFirstDockTimer) {
        clearTimeout(profileModalState.pendingFirstDockTimer);
        profileModalState.pendingFirstDockTimer = null;
    }
    if (profileModalState.focusScrollRafId) {
        cancelAnimationFrame(profileModalState.focusScrollRafId);
        profileModalState.focusScrollRafId = 0;
    }
    if (profileModalState.focusScrollTimer) {
        clearTimeout(profileModalState.focusScrollTimer);
        profileModalState.focusScrollTimer = null;
    }
    profileModalState.focusScrollSuppressUntil = 0;
    profileModalState.pendingFirstDockParams = null;
    getProfileModalElements().overlay?.classList.remove(
        'profile-modal-keyboard-resizing',
        'profile-modal-keyboard-animating'
    );
}

function freezeProfileModalPage() {
    if (profileModalState.pageFrozen) return;

    profileModalState.baseScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
    if (isProfileModalIOSMode() && window.iOSScrollLock) {
        const { overlay } = getProfileModalElements();
        window.iOSScrollLock.lockLight(overlay || null, {
            restoreScrollDuringViewport: true
        });
        profileModalState.pageFrozen = 'light';
        return;
    }

    document.documentElement.classList.add('profile-modal-lock');
    document.body.classList.add('profile-modal-lock');
    setAuthStyleState(document.documentElement, {
        overflow: 'hidden'
    });
    setAuthStyleState(document.body, {
        position: 'fixed',
        top: `-${profileModalState.baseScrollY}px`,
        left: '0',
        right: '0',
        width: '100%',
        overflow: 'hidden'
    });
    profileModalState.pageFrozen = true;
    stabilizeProfileModalViewport();
}

function unfreezeProfileModalPage() {
    if (!profileModalState.pageFrozen) return;

    if (profileModalState.pageFrozen === 'light') {
        if (window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        }
        profileModalState.pageFrozen = false;
        profileModalState.baseScrollY = 0;
        return;
    }

    const restoreScrollY = profileModalState.baseScrollY;
    document.documentElement.classList.remove('profile-modal-lock');
    document.body.classList.remove('profile-modal-lock');
    setAuthStyleState(document.documentElement, {
        overflow: ''
    });
    setAuthStyleState(document.body, {
        position: '',
        top: '',
        left: '',
        right: '',
        width: '',
        overflow: ''
    });
    profileModalState.pageFrozen = false;

    requestAnimationFrame(() => {
        window.scrollTo(0, restoreScrollY);
    });
}

function resetProfileModalVisualState() {
    const { overlay, card, scroller } = getProfileModalElements();
    if (!overlay || !card) return;

    overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
    setAuthStyleState(overlay, {
        '--profile-modal-shift-y': '0px',
        '--profile-modal-dock-height': '',
        '--profile-modal-overlay-height': ''
    });
    setAuthStyleState(card, {
        height: '',
        maxHeight: ''
    });
    setAuthStyleState(scroller, {
        scrollPaddingBottom: ''
    });
    profileModalState.overlayBaseHeight = 0;
    profileModalState.baseViewportHeight = 0;
    profileModalState.baseVisualHeight = 0;
    profileModalState.baseCardHeight = 0;
    profileModalState.lastKeyboardBottomInset = 0;
    profileModalState.lastDockHeight = 0;
    profileModalState.lastTranslateY = 0;
    profileModalState.keyboardBlurUndocking = false;
    profileModalState.lastStableKeyboardInset = 0;
    profileModalState.pendingFirstDockParams = null;
    profileModalState.focusTransferUntil = 0;
    profileModalState.lastFocusAnchor = null;
    profileModalState.preserveLayoutDuringFocusTransfer = false;
}

function captureProfileModalOverlayBaseHeight(force = false) {
    const { overlay, card } = getProfileModalElements();
    if (!overlay) return;

    const vv = window.visualViewport;
    const visualTop = Math.max(0, vv?.offsetTop || 0);
    const visualHeight = Math.max(0, vv?.height || 0);
    const visualBottom = visualTop + visualHeight;
    const measuredHeight = Math.max(
        Math.round(window.innerHeight || 0),
        Math.round(document.documentElement.clientHeight || 0),
        Math.round(visualBottom || 0),
        Math.round(visualHeight || 0)
    );

    if (!measuredHeight) return;
    if (!force && profileModalState.overlayBaseHeight >= measuredHeight) return;

    profileModalState.overlayBaseHeight = measuredHeight;
    profileModalState.baseViewportHeight = Math.max(profileModalState.baseViewportHeight || 0, measuredHeight);
    profileModalState.baseVisualHeight = Math.max(profileModalState.baseVisualHeight || 0, visualHeight);
    if (card) {
        const cardHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 0);
        if (cardHeight > 220) {
            profileModalState.baseCardHeight = Math.max(320, cardHeight);
        }
    }
    setAuthStyleState(overlay, {
        '--profile-modal-overlay-height': `${measuredHeight}px`
    });
}

function stabilizeProfileModalViewport() {
    if (!profileModalState.pageFrozen || profileModalState.pageFrozen === 'light') return;

    setAuthStyleState(document.body, {
        top: `-${profileModalState.baseScrollY}px`
    });

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

function getProfileModalInputTargetScrollTop(input = getActiveProfileModalInput()) {
    const { card, scroller } = getProfileModalElements();
    const scrollHost = scroller || card;
    if (!card || !scrollHost || !input) return null;

    const anchor = getProfileModalFocusAnchor(input) || input;
    const cardRect = scrollHost.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const maxScrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    if (maxScrollTop <= 0) return null;

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

    return {
        scrollHost,
        targetScrollTop: nextScrollTop
    };
}

function ensureProfileModalInputVisible(input = getActiveProfileModalInput()) {
    const target = getProfileModalInputTargetScrollTop(input);
    if (!target) return;

    animateProfileModalScroll(target.scrollHost, target.targetScrollTop);
}

function clearProfileModalScrollAnimationState() {
    if (profileModalState.scrollAnimationRafId) {
        cancelAnimationFrame(profileModalState.scrollAnimationRafId);
        profileModalState.scrollAnimationRafId = 0;
    }
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

function animateProfileModalScroll(scrollHost, targetScrollTop, options = {}) {
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

    const from = scrollHost.scrollTop;
    const distance = to - from;
    const duration = Math.max(
        options.minDuration ?? 180,
        Math.min(options.maxDuration ?? 340, Math.round(Math.abs(distance) * (options.durationFactor ?? 0.72)))
    );
    const startedAt = performance.now();
    const easeOut = (t) => options.ease === 'standard'
        ? (1 - Math.pow(1 - t, 4))
        : (1 - Math.pow(1 - t, 3));

    const step = (now) => {
        if (profileModalState.scrollAnimationHost !== scrollHost) return;

        const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
        scrollHost.scrollTop = Math.round(from + (distance * easeOut(progress)));
        if (progress < 1) {
            profileModalState.scrollAnimationRafId = requestAnimationFrame(step);
            return;
        }

        scrollHost.scrollTop = to;
        profileModalState.scrollAnimationRafId = 0;
    };

    profileModalState.scrollAnimationRafId = requestAnimationFrame(step);

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
    const docked = getProfileModalElements().overlay?.classList.contains('keyboard-docked');
    profileModalState.focusTransferUntil = Date.now() + 260;
    profileModalState.preserveLayoutDuringFocusTransfer = !!(
        docked &&
        profileModalState.lastFocusAnchor &&
        nextAnchor &&
        profileModalState.lastDockHeight
    );
}

function markProfileModalKeyboardResizing() {
    const { overlay } = getProfileModalElements();
    if (!overlay?.classList.contains('active')) return;

    overlay.classList.add('profile-modal-keyboard-resizing');
    if (profileModalState.keyboardResizeTimer) {
        clearTimeout(profileModalState.keyboardResizeTimer);
    }
    profileModalState.keyboardResizeTimer = setTimeout(() => {
        profileModalState.keyboardResizeTimer = null;
        getProfileModalElements().overlay?.classList.remove('profile-modal-keyboard-resizing');
    }, PROFILE_MODAL_KEYBOARD_RESIZE_IDLE_MS);
}

function setProfileModalKeyboardAnimating(enabled) {
    const { overlay } = getProfileModalElements();
    if (!overlay) return;

    overlay.classList.toggle('profile-modal-keyboard-animating', Boolean(enabled));
    setAuthStyleState(overlay, {
        '--profile-modal-keyboard-motion-duration': enabled ? `${PROFILE_MODAL_KEYBOARD_MOTION_MS}ms` : ''
    });

    if (profileModalState.keyboardMotionTimer) {
        clearTimeout(profileModalState.keyboardMotionTimer);
        profileModalState.keyboardMotionTimer = null;
    }
    if (!enabled) return;

    profileModalState.keyboardMotionTimer = setTimeout(() => {
        profileModalState.keyboardMotionTimer = null;
        getProfileModalElements().overlay?.classList.remove('profile-modal-keyboard-animating');
        setAuthStyleState(getProfileModalElements().overlay, {
            '--profile-modal-keyboard-motion-duration': ''
        });
    }, PROFILE_MODAL_KEYBOARD_MOTION_MS + 40);
}

function clearProfileModalPendingFirstDock() {
    if (profileModalState.pendingFirstDockTimer) {
        clearTimeout(profileModalState.pendingFirstDockTimer);
        profileModalState.pendingFirstDockTimer = null;
    }
    profileModalState.pendingFirstDockParams = null;
}

function getProfileModalKeyboardMetrics() {
    const vv = window.visualViewport;
    const visualTop = Math.max(0, vv?.offsetTop || 0);
    const visualHeight = Math.max(0, vv?.height || 0);
    const visualBottom = visualTop + visualHeight;
    const baseViewportHeight = Math.max(
        profileModalState.baseViewportHeight || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualBottom
    );
    const baseVisualHeight = Math.max(profileModalState.baseVisualHeight || 0, visualHeight);
    const bottomInset = Math.max(
        0,
        Math.round(Math.max(
            baseViewportHeight - visualBottom,
            baseVisualHeight - visualHeight
        ))
    );

    return {
        visualHeight,
        visualBottom,
        baseViewportHeight,
        baseVisualHeight,
        bottomInset
    };
}

function captureProfileModalStableDockHeight(metrics = getProfileModalKeyboardMetrics()) {
    const { card } = getProfileModalElements();
    if (!card || metrics.bottomInset > 60) return;

    const cardHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 0);
    if (cardHeight > 220) {
        profileModalState.baseCardHeight = cardHeight;
    }
}

function applyProfileModalKeyboardDock(metrics, animate = false) {
    const { overlay, card, scroller } = getProfileModalElements();
    if (!overlay || !card) return;

    const bottomInset = Math.max(0, metrics?.bottomInset || 0);
    const baseViewportHeight = Math.max(
        metrics?.baseViewportHeight || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        (metrics?.visualHeight || 0) + bottomInset
    );
    const keyboardTop = Math.max(0, baseViewportHeight - bottomInset);
    const keyboardClearance = 12;
    const minTop = 12;
    const fallbackHeight = Math.min(600, Math.max(420, Math.round(baseViewportHeight * 0.7)));
    const stableHeight = Math.max(320, Math.round(profileModalState.baseCardHeight || fallbackHeight));
    const maxAvailableHeight = Math.max(320, Math.round(keyboardTop - minTop - keyboardClearance));
    const dockHeight = Math.min(stableHeight, maxAvailableHeight);
    const centeredBottom = (baseViewportHeight * 0.5) + (dockHeight * 0.5);
    const targetBottom = Math.max(40, keyboardTop - keyboardClearance);
    const translateY = Math.round(Math.max(-520, Math.min(520, targetBottom - centeredBottom)));

    clearProfileModalPendingFirstDock();
    overlay.classList.add('keyboard-active', 'keyboard-docked');
    setProfileModalKeyboardAnimating(animate);
    setAuthStyleState(overlay, {
        '--profile-modal-shift-y': `${translateY}px`,
        '--profile-modal-dock-height': `${dockHeight}px`
    });
    setAuthStyleState(card, {
        height: `${dockHeight}px`,
        maxHeight: `${dockHeight}px`
    });
    setAuthStyleState(scroller, {
        scrollPaddingBottom: '144px'
    });

    profileModalState.keyboardBlurUndocking = false;
    profileModalState.lastKeyboardBottomInset = bottomInset;
    profileModalState.lastDockHeight = dockHeight;
    profileModalState.lastTranslateY = translateY;
    if (bottomInset > 40) {
        profileModalState.lastStableKeyboardInset = bottomInset;
    }
}

function resetProfileModalKeyboardDock(animate = false) {
    const { overlay, card, scroller } = getProfileModalElements();
    if (!overlay || !card) return;

    clearProfileModalPendingFirstDock();
    overlay.classList.remove('keyboard-active', 'keyboard-docked');
    setProfileModalKeyboardAnimating(animate);
    setAuthStyleState(overlay, {
        '--profile-modal-shift-y': '0px',
        '--profile-modal-dock-height': ''
    });
    setAuthStyleState(card, {
        height: '',
        maxHeight: ''
    });
    setAuthStyleState(scroller, {
        scrollPaddingBottom: '96px'
    });

    profileModalState.lastKeyboardBottomInset = 0;
    profileModalState.lastDockHeight = 0;
    profileModalState.lastTranslateY = 0;
}

function scheduleProfileModalInitialKeyboardDock(metrics) {
    const requiresWarmup = profileModalState.lastStableKeyboardInset <= 40;
    let predictedInset = Math.max(0, metrics?.bottomInset || 0);

    if (profileModalState.lastStableKeyboardInset > 40) {
        predictedInset = predictedInset < 24
            ? profileModalState.lastStableKeyboardInset
            : Math.min(predictedInset, profileModalState.lastStableKeyboardInset + 12);
    }

    profileModalState.pendingFirstDockParams = {
        ...metrics,
        bottomInset: predictedInset,
        animate: true
    };

    if (profileModalState.pendingFirstDockTimer) return;

    profileModalState.pendingFirstDockTimer = setTimeout(() => {
        const params = profileModalState.pendingFirstDockParams;
        profileModalState.pendingFirstDockTimer = null;
        profileModalState.pendingFirstDockParams = null;
        const { overlay } = getProfileModalElements();
        if (!params || !overlay?.classList.contains('active')) return;
        if (!getActiveProfileModalInput()) return;
        if (overlay.classList.contains('keyboard-docked')) return;

        applyProfileModalKeyboardDock(params, params.animate !== false);
        ensureProfileModalInputVisible();
    }, requiresWarmup ? 88 : 34);
}

function scheduleProfileModalFocusedInputScroll(input, delay = 0) {
    if (!input) return;

    if (profileModalState.focusScrollRafId) {
        cancelAnimationFrame(profileModalState.focusScrollRafId);
        profileModalState.focusScrollRafId = 0;
    }
    if (profileModalState.focusScrollTimer) {
        clearTimeout(profileModalState.focusScrollTimer);
        profileModalState.focusScrollTimer = null;
    }

    const run = () => {
        profileModalState.focusScrollRafId = requestAnimationFrame(() => {
            profileModalState.focusScrollRafId = 0;
            const { overlay } = getProfileModalElements();
            if (!overlay?.classList.contains('keyboard-docked')) return;
            if (document.activeElement !== input) return;
            const target = getProfileModalInputTargetScrollTop(input);
            if (!target) return;
            animateProfileModalScroll(target.scrollHost, target.targetScrollTop, {
                minDuration: 240,
                maxDuration: 460,
                durationFactor: 0.95,
                ease: 'standard'
            });
        });
    };

    if (delay > 0) {
        profileModalState.focusScrollTimer = setTimeout(() => {
            profileModalState.focusScrollTimer = null;
            run();
        }, delay);
        return;
    }

    run();
}

function applyProfileModalLayout({ ensureInput = true, allowUndock = true } = {}) {
    const { overlay, card, scroller } = getProfileModalElements();
    if (!overlay || !card || !overlay.classList.contains('active')) return;

    if (!isProfileModalIOSMode()) {
        setAuthStyleState(card, {
            height: '',
            maxHeight: ''
        });
        setAuthStyleState(scroller, {
            scrollPaddingBottom: ''
        });
        setAuthStyleState(overlay, {
            '--profile-modal-shift-y': '0px',
            '--profile-modal-dock-height': ''
        });
        overlay.classList.remove('keyboard-active', 'keyboard-docked', 'ios-focus-lock');
        profileModalState.lastFocusAnchor = getProfileModalFocusAnchor(getActiveProfileModalInput()) || null;
        profileModalState.preserveLayoutDuringFocusTransfer = false;
        return;
    }

    const metrics = getProfileModalKeyboardMetrics();
    if (metrics.bottomInset < 40) {
        captureProfileModalStableDockHeight(metrics);
    }

    const activeInput = getActiveProfileModalInput();
    const activeAnchor = getProfileModalFocusAnchor(activeInput);
    const holdDuringFocusTransfer = !activeInput && profileModalState.focusTransferUntil > Date.now();
    const wasDocked = overlay.classList.contains('keyboard-docked');
    const preserveFocusDock = Boolean(
        wasDocked &&
        profileModalState.preserveLayoutDuringFocusTransfer &&
        profileModalState.lastDockHeight > 0 &&
        profileModalState.focusTransferUntil > Date.now()
    );
    const keyboardActive = Boolean(activeInput || holdDuringFocusTransfer);
    const shouldDock =
        !profileModalState.keyboardBlurUndocking &&
        keyboardActive &&
        (wasDocked ? metrics.bottomInset > 8 : metrics.bottomInset > 24);

    setAuthStyleState(scroller, {
        scrollPaddingBottom: `${wasDocked || shouldDock ? 144 : 96}px`
    });

    if (shouldDock) {
        if (!wasDocked) {
            scheduleProfileModalInitialKeyboardDock(metrics);
        } else if (!preserveFocusDock && Math.abs(metrics.bottomInset - profileModalState.lastKeyboardBottomInset) > 1) {
            applyProfileModalKeyboardDock(metrics, false);
        }
    } else {
        clearProfileModalPendingFirstDock();
        if (wasDocked && allowUndock) {
            resetProfileModalKeyboardDock(true);
        } else if (!keyboardActive && metrics.bottomInset <= 8) {
            resetProfileModalKeyboardDock(false);
            profileModalState.keyboardBlurUndocking = false;
        }
    }

    if (!activeInput) {
        if (!holdDuringFocusTransfer) {
            profileModalState.lastFocusAnchor = null;
            profileModalState.preserveLayoutDuringFocusTransfer = false;
        }
        return;
    }

    if (ensureInput && overlay.classList.contains('keyboard-docked')) {
        ensureProfileModalInputVisible(activeInput);
    }
    profileModalState.lastFocusAnchor = activeAnchor || null;
    if (profileModalState.focusTransferUntil <= Date.now()) {
        profileModalState.preserveLayoutDuringFocusTransfer = false;
    }
}

function scheduleProfileModalLayout({ settled = false, deferOnly = false, ensureInput = true, allowUndock = true } = {}) {
    if (profileModalState.layoutRafId) {
        cancelAnimationFrame(profileModalState.layoutRafId);
    }

    const runLayout = (options = {}) => {
        profileModalState.layoutRafId = requestAnimationFrame(() => {
            profileModalState.layoutRafId = 0;
            applyProfileModalLayout({
                ensureInput: options.ensureInput ?? ensureInput,
                allowUndock: options.allowUndock ?? allowUndock
            });
            if (options.finishKeyboardResize) {
                requestAnimationFrame(() => {
                    getProfileModalElements().overlay?.classList.remove('profile-modal-keyboard-resizing');
                });
            }
        });
    };

    if (!deferOnly) {
        runLayout({ ensureInput, allowUndock });
    }

    if (settled) {
        if (profileModalState.settleTimer) {
            clearTimeout(profileModalState.settleTimer);
        }
        profileModalState.settleTimer = setTimeout(() => {
            profileModalState.settleTimer = null;
            runLayout({ ensureInput: true, allowUndock: true, finishKeyboardResize: true });
        }, PROFILE_MODAL_KEYBOARD_SETTLE_MS);
    }
}

function bindProfileModalInputBehavior(input) {
    if (!input || input.dataset.profileInputManaged === '1') return;

    const gesture = {
        startX: 0,
        startY: 0,
        startScrollTop: 0,
        lastX: 0,
        lastY: 0,
        mode: 'idle'
    };

    input.addEventListener('focus', () => {
        markProfileModalFocusTransfer(input);
        if (profileModalState.blurTimer) {
            clearTimeout(profileModalState.blurTimer);
            profileModalState.blurTimer = null;
        }
        profileModalState.keyboardBlurUndocking = false;
        if (isProfileModalIOSMode()) {
            const docked = getProfileModalElements().overlay?.classList.contains('keyboard-docked');
            if (docked) {
                clearProfileModalPendingFirstDock();
                setAuthStyleState(getProfileModalElements().scroller, {
                    scrollPaddingBottom: '144px'
                });
                profileModalState.lastFocusAnchor = getProfileModalFocusAnchor(input) || null;
                if (profileModalState.focusScrollSuppressUntil > Date.now()) {
                    return;
                }
                scheduleProfileModalFocusedInputScroll(input);
                return;
            }
            captureProfileModalOverlayBaseHeight(true);
            captureProfileModalStableDockHeight();
            scheduleProfileModalLayout({ ensureInput: false, allowUndock: false });
            setTimeout(() => scheduleProfileModalLayout({ ensureInput: true, allowUndock: false }), 160);
            return;
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
                profileModalState.keyboardBlurUndocking = true;
                resetProfileModalKeyboardDock(true);
                scheduleProfileModalLayout({ settled: true, deferOnly: true });
            }
        }, 120);
    });

        input.addEventListener('click', () => {
            if (document.activeElement === input) return;
            markProfileModalFocusTransfer(input);
            if (isProfileModalIOSMode() && getProfileModalElements().overlay?.classList.contains('keyboard-docked')) {
                scheduleProfileModalFocusedInputScroll(input);
                return;
            }
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
        gesture.lastX = gesture.startX;
        gesture.lastY = gesture.startY;
        gesture.startScrollTop = scrollHost.scrollTop;
        gesture.mode = 'pending';
    }, { passive: true });

    input.addEventListener('touchmove', (event) => {
        const { overlay, card, scroller } = getProfileModalElements();
        const scrollHost = scroller || card;
        if (!overlay?.classList.contains('active') || !scrollHost) return;
        cancelProfileModalScrollAnimation();

        const touch = event.touches[0];
        gesture.lastX = touch?.clientX || gesture.lastX;
        gesture.lastY = touch?.clientY || gesture.lastY;
        const deltaX = gesture.lastX - gesture.startX;
        const deltaY = gesture.lastY - gesture.startY;

        if (gesture.mode === 'pending') {
            if (Math.abs(deltaY) < 8 || Math.abs(deltaY) <= Math.abs(deltaX)) {
                return;
            }
            gesture.mode = 'scroll';
        }

        if (gesture.mode !== 'scroll') return;
        if (document.activeElement !== input) return;

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
        const { card, scroller } = getProfileModalElements();
        const scrollHost = scroller || card;
        const touch = event.changedTouches?.[0];
        const endX = touch?.clientX ?? gesture.lastX;
        const endY = touch?.clientY ?? gesture.lastY;
        const movedDistance = Math.hypot(endX - gesture.startX, endY - gesture.startY);
        const scrollMoved = scrollHost ? Math.abs(scrollHost.scrollTop - gesture.startScrollTop) : 0;
        const isTap = gesture.mode === 'pending' && movedDistance < 8 && scrollMoved < 3;

        if (isProfileModalIOSMode() && isTap && document.activeElement !== input) {
            const beforeFocusScrollTop = scrollHost ? scrollHost.scrollTop : null;
            const wasDockedBeforeFocus = getProfileModalElements().overlay?.classList.contains('keyboard-docked');
            if (event.cancelable) {
                event.preventDefault();
            }
            markProfileModalFocusTransfer(input);
            profileModalState.focusScrollSuppressUntil = Date.now() + 120;
            try {
                input.focus({ preventScroll: true });
            } catch (_) {
                input.focus();
            }
            profileModalState.keyboardBlurUndocking = false;
            if (getProfileModalElements().overlay?.classList.contains('keyboard-docked')) {
                clearProfileModalPendingFirstDock();
                if (wasDockedBeforeFocus && scrollHost && Number.isFinite(beforeFocusScrollTop)) {
                    scrollHost.scrollTop = beforeFocusScrollTop;
                }
                profileModalState.lastFocusAnchor = getProfileModalFocusAnchor(input) || null;
                scheduleProfileModalFocusedInputScroll(input, 34);
            } else {
                captureProfileModalOverlayBaseHeight(true);
                captureProfileModalStableDockHeight();
                scheduleProfileModalLayout({ ensureInput: false, allowUndock: false });
                setTimeout(() => scheduleProfileModalLayout({ ensureInput: true, allowUndock: false }), 160);
            }
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
        markProfileModalKeyboardResizing();
        if (!getActiveProfileModalInput()) {
            captureProfileModalOverlayBaseHeight();
        }
        scheduleProfileModalLayout({ settled: true, ensureInput: false, allowUndock: false });
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
        setAuthStyleState(overlay, {
            '--profile-modal-shift-y': '0px',
            '--profile-modal-dock-height': ''
        });
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
    ].forEach(({ node, visible }) => {
        if (!node) return;

        node.hidden = !visible;
        node.toggleAttribute('inert', !visible);
        node.setAttribute('aria-hidden', visible ? 'false' : 'true');
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
        setAuthStyleState(overlay, {
            '--profile-modal-shift-y': '0px',
            '--profile-modal-dock-height': ''
        });
    }

    setAuthStyleState(card, {
        height: '',
        maxHeight: ''
    });
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

    window.runSiteModalCloseChromeCleanup?.({
        targets: [overlay],
        forceHiddenClass: 'profile-modal-force-hidden',
        restoreDelayMs: 320
    });
    cleanupProfileModalAfterClose();
    overlay.classList.remove('active');

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

    let modal = document.getElementById('profileModal');
    if (!modal) {
        const loaded = await ensureProfileModalRuntime();
        modal = document.getElementById('profileModal');
        if (!loaded || !modal) {
            alert('个人中心加载失败，请稍后重试');
            profileModalOpenLock = false;
            return;
        }
    }

    const wasActive = modal.classList.contains('active');
    const profileFront = document.querySelector('.profile-front');

    cleanupProfileModalAfterClose({ restoreScroll: false });
    resetProfileModalViewState();
    hydrateProfileModalFromCache();
    freezeProfileModalPage();
    bindProfileModalInputs();

    modal.classList.remove('active');
    modal.classList.remove('profile-modal-force-hidden');

    void modal.offsetHeight;
    modal.classList.add('active');
    attachProfileModalViewportHandlers();

    requestAnimationFrame(() => {
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
        await window.AdminAccess?.clearAdminStudioSession?.();
        await window.supabaseClient.auth.signOut();
    } catch (e) {
        console.error('Supabase signOut error:', e);
    }

    // 切换账户时清除记住的邮箱与历史密码缓存
    removeRememberedLoginEmail();
    clearLegacyRememberedAuthSecrets();
    console.log('🗑️ 已清除记住的邮箱与历史密码缓存');

    // 重置UI为未登录状态
    updateUserUI(null, { clearCacheOnLogout: true });

    // 打开登录弹窗
    setTimeout(() => {
        requestLoginModalOpen('login');
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
        } else {
            const overlay = document.getElementById('profileModal');
            const targetPanel = overlay?.dataset.securityPanel || 'change-password';
            void ensureProfileModalRuntime({ fast: false }).then(() => {
                window.switchProfileSecurityPanel?.(targetPanel);
            });
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

    setAuthStyleState(tabsWrap, {
        '--profile-tab-indicator-width': `${activeTab.offsetWidth}px`,
        '--profile-tab-indicator-x': `${activeTab.offsetLeft}px`
    });
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
        void openSupabaseAuthWalletView(targetView, {
            entry: `profile_${targetView}`,
            sourceModule: 'profile_modal'
        }).then((walletModal) => {
            if (walletModal?.open) {
                return;
            }

            alert(window.i18n?.t('wallet.loading') || '钱包模块加载中，请稍后重试');
        });
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
window.restoreRememberedLoginState = restoreRememberedLoginState;
window.handlePasswordReset = handlePasswordReset;
window.checkAuthState = checkAuthState;
window.updateUserUI = updateUserUI;
