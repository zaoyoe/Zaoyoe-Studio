(function () {
    'use strict';

    const AUTH_SHEET_CSS_HREF = './css/auth-sheet.css?v=20260509_AUTH_POPUP_STABLE_1';
    const SUPPORT_SCRIPT_SRC = './script.js?v=20260314_AUTH_I18N_1';
    const EMAILJS_SRC = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
    const EMAILJS_PUBLIC_KEY = 'vawaxLVEzJMAVbut0';
    const LEGACY_AUTH_STYLE_SELECTORS = [
        'link[href*="login_styles.css"]',
        'link[href*="login_dual_mode.css"]',
        'link[href*="shared-login-stagger.css"]'
    ];
    const LEGACY_AUTH_STYLE_IDS = ['force-auth-styles', 'force-google-btn-slim-style'];
    const PRIMARY_VIEWS = new Set(['login', 'register']);
    const AUTH_SHEET_RESIZE_DURATION_MS = 320;
    const AUTH_SHEET_RESIZE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const PERSONAL_MESSAGE_BUTTON_LABEL = '打开个人消息';
    const PERSONAL_MESSAGE_BUTTON_UNREAD_LABEL = '打开个人消息（有未读）';
    const VIEW_META = {
        login: {
            titleKey: 'auth.welcomeBack',
            titleFallback: '欢迎回来'
        },
        register: {
            titleKey: 'auth.createAccount',
            titleFallback: '创建账号'
        },
        reset: {
            titleKey: 'auth.resetPassword',
            titleFallback: '找回密码'
        }
    };

    let emailJsPromise = null;
    let supportScriptPromise = null;
    let overlayCloseDisabledUntil = 0;
    const sheetState = {
        view: 'login',
        lastPrimaryView: 'login'
    };
    const dragState = {
        active: false,
        startY: 0,
        deltaY: 0
    };
    const portalState = {
        activeId: null,
        input: null,
        proxy: null,
        originParent: null,
        originNextSibling: null,
        layoutRafId: 0
    };
    const resizeState = {
        token: 0,
        cleanupTimerId: 0
    };
    const submitState = {
        stabilizeTimerId: 0
    };
    const googleDebugState = {
        enabled: false,
        label: '',
        detail: ''
    };
    const GOOGLE_DEBUG_FLOATING_ID = 'authGoogleDebugFloating';
    let userPresenceAuthBound = false;

    function isIOSMobile() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function shouldUseInPlaceAuthInput() {
        return isIOSMobile() && window.matchMedia('(max-width: 768px)').matches;
    }

    function shouldUseDesktopNativeAuthInput() {
        return window.matchMedia('(min-width: 769px)').matches;
    }

    function prefersReducedAuthMotion() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    function t(key, fallback) {
        return window.i18n?.t(key, fallback) || fallback;
    }

    function formatInjectedAuthText(key, fallback = '', vars = {}) {
        let text = t(key, fallback || '');
        Object.entries(vars || {}).forEach(([name, value]) => {
            text = String(text).split(`{${name}}`).join(String(value));
        });
        return text;
    }

    function normalizeAuthMessagePayload(message) {
        if (message && typeof message === 'object' && message.key) {
            const vars = message.vars && typeof message.vars === 'object' ? message.vars : {};
            return {
                text: formatInjectedAuthText(message.key, message.fallback || '', vars),
                key: String(message.key || ''),
                fallback: String(message.fallback || ''),
                vars
            };
        }

        return {
            text: String(message || ''),
            key: '',
            fallback: '',
            vars: null
        };
    }

    function setAuthMessageTranslationState(messageBox, payload = {}) {
        if (!messageBox) return;
        if (payload.key) {
            messageBox.dataset.authI18nKey = payload.key;
            messageBox.dataset.authI18nFallback = payload.fallback || '';
            messageBox.dataset.authI18nVars = JSON.stringify(payload.vars || {});
            return;
        }

        delete messageBox.dataset.authI18nKey;
        delete messageBox.dataset.authI18nFallback;
        delete messageBox.dataset.authI18nVars;
    }

    function refreshVisibleAuthMessageTranslation() {
        const { message: messageBox } = getSheetElements();
        if (!messageBox || messageBox.hidden || !messageBox.dataset.authI18nKey) return;

        let vars = {};
        try {
            vars = JSON.parse(messageBox.dataset.authI18nVars || '{}') || {};
        } catch (_) {
            vars = {};
        }

        const translated = formatInjectedAuthText(
            messageBox.dataset.authI18nKey,
            messageBox.dataset.authI18nFallback || messageBox.textContent || '',
            vars
        );
        messageBox.textContent = translated;
    }

    function toInjectedAuthCssPropertyName(name) {
        if (typeof name !== 'string' || !name) return '';
        if (name.startsWith('--')) return name;
        return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    }

    function setInjectedAuthStyleProperty(target, name, value, priority = '') {
        const style = target?.style;
        if (!style) return;

        const setProperty = style['setProperty'].bind(style);
        const removeProperty = style['removeProperty'].bind(style);
        const cssName = toInjectedAuthCssPropertyName(name);
        if (!cssName) return;

        if (value === null || value === undefined || value === '') {
            removeProperty(cssName);
            return;
        }

        setProperty(cssName, String(value), priority);
    }

    function setInjectedAuthStyleState(target, styles = {}, priority = '') {
        Object.entries(styles).forEach(([name, value]) => {
            setInjectedAuthStyleProperty(target, name, value, priority);
        });
    }

    function isGeneratedAvatarUrl(url) {
        return /ui-avatars\.com|dicebear\.com/i.test(String(url || ''));
    }

    function isTransientAvatarUrl(url) {
        return /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(String(url || ''));
    }

    function escapeSvgText(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;'
        }[char]));
    }

    function getInstantFallbackAvatarUrl(seed) {
        const raw = String(seed || 'User').trim();
        const initial = escapeSvgText((Array.from(raw)[0] || 'U').toUpperCase());
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#6b9ece"/><text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="700" fill="#fff">${initial}</text></svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    function readCachedProfile() {
        try {
            const raw = localStorage.getItem('cached_user_profile');
            if (!raw) return null;
            const profile = JSON.parse(raw);

            if (!profile || typeof profile !== 'object') return null;

            if (profile.avatarUrl && (isGeneratedAvatarUrl(profile.avatarUrl) || isTransientAvatarUrl(profile.avatarUrl))) {
                delete profile.avatarUrl;
                localStorage.setItem('cached_user_profile', JSON.stringify(profile));
            }

            return profile;
        } catch (error) {
            console.warn('⚠️ Failed to read cached profile:', error?.message || error);
            return null;
        }
    }

    function buildAuthButtonHTML(profile) {
        const isLoggedIn = !!profile;
        const avatarSeed = profile?.email || profile?.username || profile?.nickname || 'User';
        const avatarUrl = profile?.avatarUrl || (isLoggedIn ? getInstantFallbackAvatarUrl(avatarSeed) : '');
        const hasAvatar = !!(isLoggedIn && avatarUrl);
        const label = isLoggedIn ? 'Open account menu' : 'Open sign in panel';

        return `
            <button id="authBtn" class="login-trigger-btn${isLoggedIn ? ' logged-in' : ''}" type="button" aria-label="${label}">
                <span id="defaultAuthIcon" class="default-auth-icon${hasAvatar ? ' auth-display-none' : ''}" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                        <path fill="currentColor" d="M12 12.25c2.35 0 4.25-1.9 4.25-4.25S14.35 3.75 12 3.75 7.75 5.65 7.75 8s1.9 4.25 4.25 4.25Zm0 2c-3.32 0-6.25 2.03-7.5 5.07-.24.58.2 1.18.82 1.18h13.36c.62 0 1.06-.6.82-1.18-1.25-3.04-4.18-5.07-7.5-5.07Z"></path>
                    </svg>
                </span>
                <img id="navUserAvatar" class="nav-user-avatar${hasAvatar ? ' show' : ' auth-display-none'}" src="${avatarUrl}" alt="Avatar" loading="eager" decoding="sync" fetchpriority="high">
                <span id="authBtnText" class="auth-display-none">Sign In</span>
                <span id="avatarUnreadBadge" class="avatar-unread-badge"></span>
            </button>
        `;
    }

    function buildDropdownHTML() {
        return `
            <div id="userDropdown" class="avatar-dropdown auth-dropdown-layer" aria-hidden="true">
                <div class="dropdown-header">
                    <button type="button" class="dropdown-notif-btn" id="dropdownNotifBtn" data-auth-action="notifications" aria-label="${PERSONAL_MESSAGE_BUTTON_LABEL}" title="${PERSONAL_MESSAGE_BUTTON_LABEL}">
                        <i class="far fa-bell"></i>
                        <span id="dropdownNotifBadge" class="dropdown-notif-badge"></span>
                    </button>
                    <button type="button" class="dropdown-lang-btn" id="dropdownLangBtn" data-auth-action="language">
                        <span class="lang-icon lang-zh">中</span>
                        <span class="lang-icon lang-en">A</span>
                    </button>
                    <button type="button" class="theme-toggle-btn" data-auth-action="theme">
                        <span class="theme-icon sun-icon">☀️</span>
                        <span class="theme-icon moon-icon">🌙</span>
                    </button>
                </div>

                <div class="dropdown-actions">
                    <button type="button" class="dropdown-action" data-auth-action="profile">
                        <i class="fas fa-user"></i>
                        <span data-i18n="common.profile">个人资料</span>
                    </button>
                    <button type="button" class="dropdown-action" data-auth-action="wallet">
                        <i class="fas fa-wallet"></i>
                        <span data-i18n="wallet.title">我的钱包</span>
                    </button>
                    <button type="button" class="dropdown-action" data-auth-action="orders">
                        <i class="fas fa-box-open"></i>
                        <span data-i18n="wallet.myOrders">我的订单</span>
                    </button>
                    <button type="button" class="dropdown-action" data-auth-action="switch-account">
                        <i class="fas fa-exchange-alt"></i>
                        <span data-i18n="auth.switchAccount">切换账户</span>
                    </button>
                    <button type="button" class="dropdown-action auth-display-none" id="enterStudioBtn" data-auth-action="studio">
                        <i class="fas fa-palette"></i>
                        <span data-i18n="admin.enterStudio">Enter Studio</span>
                    </button>
                    <button type="button" class="dropdown-action" data-auth-action="logout">
                        <i class="fas fa-sign-out-alt"></i>
                        <span data-i18n="common.logout">退出登录</span>
                    </button>
                </div>
            </div>
        `;
    }

    function buildPortaledInputControlHTML(options) {
        const {
            id,
            type = 'text',
            placeholder,
            placeholderKey = '',
            inputClass = '',
            proxyClass = '',
            inputAttributes = ''
        } = options;

        const proxyPlaceholderAttr = placeholderKey ? ` data-i18n="${placeholderKey}"` : '';
        const inputPlaceholderAttr = placeholderKey ? ` data-i18n-placeholder="${placeholderKey}"` : '';
        const className = ['auth-sheet-input', inputClass, 'auth-sheet-input--canonical', 'auth-sheet-input--parked']
            .filter(Boolean)
            .join(' ');

        return `
            <button type="button" class="auth-sheet-input-proxy${proxyClass ? ` ${proxyClass}` : ''}" data-auth-proxy-for="${id}" aria-controls="authInputPlane" aria-label="${placeholder}">
                <span class="auth-sheet-input-proxy-value" data-auth-proxy-value></span>
                <span class="auth-sheet-input-proxy-placeholder"${proxyPlaceholderAttr}>${placeholder}</span>
            </button>
            <input type="${type}" id="${id}" class="${className}" placeholder="${placeholder}"${inputPlaceholderAttr} data-auth-canonical-input data-auth-proxy-source="${id}" aria-hidden="true" tabindex="-1"${inputAttributes ? ` ${inputAttributes.trim()}` : ''}>
        `;
    }

    function buildAuthSheetHTML() {
        return `
            <div id="loginModal" class="auth-sheet-overlay login-overlay" data-auth-current-view="login" hidden aria-hidden="true" style="display: none;">
                <div class="auth-sheet-backdrop" data-auth-backdrop></div>
                <div class="auth-sheet-stage">
                    <section class="auth-sheet" role="dialog" aria-modal="true" aria-labelledby="authSheetTitle">
                        <div class="auth-sheet-surface" aria-hidden="true"></div>

                        <div class="auth-sheet-motion-shell">
                            <div class="auth-sheet-drag-zone" data-auth-drag-zone>
                                <div class="auth-sheet-handle" aria-hidden="true"></div>
                            </div>

                            <header class="auth-sheet-header">
                                <p class="auth-sheet-overline">ZAOYOE STUDIO</p>
                                <h2 id="authSheetTitle" class="auth-sheet-title">${t('auth.welcomeBack', '欢迎回来')}</h2>
                            </header>

                            <nav id="authSheetTabs" class="auth-sheet-tabs" aria-label="${t('auth.tabsLabel', '登录与注册')}" data-i18n="auth.tabsLabel" data-i18n-attr="aria-label">
                                <span class="auth-sheet-tab-indicator" aria-hidden="true"></span>
                                <button type="button" class="auth-sheet-tab is-active" data-auth-tab="login" data-i18n="common.login">登录</button>
                                <button type="button" class="auth-sheet-tab" data-auth-tab="register" data-i18n="auth.register">注册</button>
                            </nav>
                        </div>

                        <div class="auth-sheet-form-core">
                            <div id="authSheetMessage" class="auth-sheet-message" hidden role="status" aria-live="polite"></div>

                            <div class="auth-sheet-body">
                                <section id="loginView" class="auth-sheet-view auth-sheet-view--primary is-active" data-auth-view="login">
                                    <div class="auth-sheet-login-stack">
                                        <button type="button" class="auth-sheet-google-btn google-login-btn" data-auth-google>
                                            <span class="auth-sheet-google-mark" aria-hidden="true">
                                                <svg viewBox="0 0 18 18" width="18" height="18" focusable="false" role="img">
                                                    <path fill="#4285f4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.25h2.91c1.7-1.57 2.69-3.88 2.69-6.6Z"/>
                                                    <path fill="#34a853" d="M9 18c2.43 0 4.47-.8 5.95-2.2l-2.91-2.25c-.8.54-1.83.86-3.04.86-2.35 0-4.34-1.58-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"/>
                                                    <path fill="#fbbc05" d="M3.95 10.69a5.41 5.41 0 0 1 0-3.38V4.98H.94a9 9 0 0 0 0 8.04l3.01-2.33Z"/>
                                                    <path fill="#ea4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.57-2.57A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .94 4.98l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
                                                </svg>
                                            </span>
                                            <span data-i18n="auth.googleLogin">使用 Google 登录</span>
                                        </button>
                                        <div id="authGoogleDebugBadge" class="auth-google-debug-badge" hidden aria-live="polite"></div>

                                        <div class="auth-sheet-login-fields-stack">
                                            <div class="auth-sheet-divider">
                                                <span data-i18n="auth.or">或者</span>
                                            </div>

                                            <form id="loginForm" class="auth-sheet-form" autocomplete="off" novalidate>
                                                <div class="auth-sheet-field">
                                                    <span class="auth-sheet-label" data-i18n="auth.emailLabel">邮箱</span>
                                                    ${buildPortaledInputControlHTML({
                                                        id: 'login-email',
                                                        type: 'email',
                                                        placeholder: t('auth.emailPlaceholder', '邮箱地址'),
                                                        placeholderKey: 'auth.emailPlaceholder',
                                                        inputAttributes: 'autocomplete="username email" autocapitalize="off" autocorrect="off" spellcheck="false" data-auth-form="loginForm" required'
                                                    })}
                                                </div>

                                                <div class="auth-sheet-field">
                                                    <span class="auth-sheet-label" data-i18n="auth.passwordPlaceholder">密码</span>
                                                    ${buildPortaledInputControlHTML({
                                                        id: 'login-password',
                                                        type: 'password',
                                                        placeholder: t('auth.passwordPlaceholder', '密码'),
                                                        placeholderKey: 'auth.passwordPlaceholder',
                                                        inputAttributes: 'autocomplete="current-password" data-auth-form="loginForm" required'
                                                    })}
                                                </div>
                                            </form>

                                            <div class="auth-sheet-inline-row auth-sheet-inline-row--spread">
                                                <label class="auth-sheet-check">
                                                    <input type="checkbox" id="rememberMe">
                                                    <span data-i18n="auth.rememberMe">记住邮箱</span>
                                                </label>
                                                <button type="button" class="auth-sheet-link" data-auth-reset data-i18n="auth.forgotPassword">忘记密码？</button>
                                            </div>
                                        </div>
                                    </div>

                                    <button type="submit" class="auth-sheet-submit login-submit-btn" data-auth-submit="login" form="loginForm" data-i18n="common.login">登录</button>
                                </section>

                                <section id="registerView" class="auth-sheet-view auth-sheet-view--primary" data-auth-view="register" hidden>
                                    <form id="registerForm" class="auth-sheet-form" autocomplete="off" novalidate>
                                        <div class="auth-sheet-field">
                                            <span class="auth-sheet-label" data-i18n="auth.usernamePlaceholder">用户名</span>
                                            ${buildPortaledInputControlHTML({
                                                id: 'reg-username',
                                                type: 'text',
                                                placeholder: t('auth.usernamePlaceholder', '用户名'),
                                                placeholderKey: 'auth.usernamePlaceholder',
                                                inputAttributes: 'autocomplete="off" data-auth-form="registerForm" required'
                                            })}
                                        </div>

                                        <div class="auth-sheet-field">
                                            <span class="auth-sheet-label" data-i18n="auth.emailLabel">邮箱</span>
                                            ${buildPortaledInputControlHTML({
                                                id: 'reg-email',
                                                type: 'email',
                                                placeholder: t('auth.emailPlaceholder', '邮箱地址'),
                                                placeholderKey: 'auth.emailPlaceholder',
                                                inputAttributes: 'autocomplete="off" data-auth-form="registerForm" required'
                                            })}
                                        </div>

                                        <div class="auth-sheet-field auth-sheet-field--code">
                                            <span class="auth-sheet-label" data-i18n="auth.codeLabel">验证码</span>
                                            <div class="auth-sheet-inline-group auth-sheet-inline-group--code">
                                                ${buildPortaledInputControlHTML({
                                                    id: 'reg-code',
                                                    type: 'text',
                                                    placeholder: t('auth.codeLabel', '验证码'),
                                                    placeholderKey: 'auth.codeLabel',
                                                    inputClass: 'auth-sheet-input--code',
                                                    proxyClass: 'auth-sheet-input-proxy--code',
                                                    inputAttributes: 'maxlength="6" autocomplete="off" data-auth-form="registerForm" required'
                                                })}
                                                <button type="button" class="auth-sheet-secondary verify-code-btn" id="sendBtn" data-auth-send-code data-i18n="auth.getShort">获取</button>
                                            </div>
                                        </div>

                                        <div class="auth-sheet-field">
                                            <span class="auth-sheet-label" data-i18n="auth.setPassword">设置密码</span>
                                            ${buildPortaledInputControlHTML({
                                                id: 'reg-password',
                                                type: 'password',
                                                placeholder: t('auth.setPassword', '设置密码'),
                                                placeholderKey: 'auth.setPassword',
                                                inputAttributes: 'autocomplete="new-password" data-auth-form="registerForm" required'
                                            })}
                                        </div>

                                        <label class="auth-sheet-check auth-sheet-check--start">
                                            <input type="checkbox" id="privacyConsent">
                                            <span>
                                                <span data-i18n="auth.agreeToTerms">我已阅读并同意</span>
                                                <a href="/privacy.html" target="_blank" rel="noopener noreferrer" data-i18n="auth.privacyPolicy">隐私政策</a>
                                            </span>
                                        </label>
                                    </form>

                                    <button type="submit" class="auth-sheet-submit login-submit-btn" data-auth-submit="register" form="registerForm" data-i18n="auth.createAccount">创建账号</button>
                                </section>

                                <section id="resetView" class="auth-sheet-view" data-auth-view="reset" hidden>
                                    <p class="auth-sheet-note" data-i18n="auth.resetSubtitle">请输入您的注册邮箱以重置密码</p>

                                    <form id="resetForm" class="auth-sheet-form" novalidate>
                                        <div class="auth-sheet-field">
                                            <span class="auth-sheet-label" data-i18n="auth.emailLabel">邮箱</span>
                                            ${buildPortaledInputControlHTML({
                                                id: 'reset-email',
                                                type: 'email',
                                                placeholder: t('auth.emailPlaceholder', '邮箱地址'),
                                                placeholderKey: 'auth.emailPlaceholder',
                                                inputAttributes: 'autocomplete="email" data-auth-form="resetForm" required'
                                            })}
                                        </div>
                                    </form>

                                    <button type="submit" class="auth-sheet-submit login-submit-btn" data-auth-submit="reset" form="resetForm" data-i18n="auth.recover">找回</button>

                                    <div class="auth-sheet-inline-row auth-sheet-inline-row--center">
                                        <button type="button" class="auth-sheet-link" data-auth-tab="login" data-i18n="auth.backToLogin">返回登录</button>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </section>
                </div>
                <div id="authInputPlane" class="auth-input-plane" aria-hidden="true"></div>
            </div>
        `;
    }

    function removeLegacyLoginStyles() {
        LEGACY_AUTH_STYLE_SELECTORS.forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => node.remove());
        });

        LEGACY_AUTH_STYLE_IDS.forEach((id) => {
            document.getElementById(id)?.remove();
        });
    }

    function findAuthSheetStylesheet() {
        const normalizedTargetHref = AUTH_SHEET_CSS_HREF.split('?')[0].replace(/^\.\//, '');
        return Array.from(document.querySelectorAll('link[href]')).find((link) => {
            const href = String(link.getAttribute('href') || '').trim().replace(/^\.\//, '');
            return href.startsWith(normalizedTargetHref);
        }) || null;
    }

    function waitForAuthSheetStylesheet(link) {
        if (!(link instanceof HTMLLinkElement)) {
            return Promise.resolve(null);
        }

        if (link.dataset.authSheetReady === '1' || link.sheet) {
            link.dataset.authSheetReady = '1';
            return Promise.resolve(link);
        }

        return new Promise((resolve) => {
            const markReady = () => {
                link.dataset.authSheetReady = '1';
                resolve(link);
            };

            link.addEventListener('load', markReady, { once: true });
            link.addEventListener('error', markReady, { once: true });
        });
    }

    function areAuthSheetStylesApplied(overlay = document.getElementById('loginModal')) {
        const sheet = overlay?.querySelector('.auth-sheet');
        const inputProxy = overlay?.querySelector('.auth-sheet-input-proxy');
        if (!sheet || !inputProxy || typeof window.getComputedStyle !== 'function') {
            return false;
        }

        const sheetStyle = window.getComputedStyle(sheet);
        const inputProxyStyle = window.getComputedStyle(inputProxy);
        const inputProxyHeight = Number.parseFloat(inputProxyStyle.height) || 0;

        return sheetStyle.display === 'grid'
            && inputProxyHeight >= 40
            && inputProxyStyle.borderRadius !== '0px';
    }

    function waitForAuthSheetStylesApplied(overlay, timeoutMs = 1200) {
        if (areAuthSheetStylesApplied(overlay)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const startedAt = window.performance?.now?.() || Date.now();
            const check = () => {
                if (areAuthSheetStylesApplied(overlay)) {
                    resolve(true);
                    return;
                }

                const now = window.performance?.now?.() || Date.now();
                if (now - startedAt >= timeoutMs) {
                    resolve(false);
                    return;
                }

                window.requestAnimationFrame(check);
            };

            window.requestAnimationFrame(check);
        });
    }

    async function ensureAuthSheetStylesReady() {
        removeLegacyLoginStyles();

        let link = findAuthSheetStylesheet();
        if (!link) {
            link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = AUTH_SHEET_CSS_HREF;
            document.head.appendChild(link);
        } else if (link.dataset.deferredStyle === '1') {
            if (typeof window.activateDeferredStyleGroup === 'function') {
                window.activateDeferredStyleGroup('public-auth-sheet');
            }
            if (link.media !== 'all') {
                link.media = 'all';
            }
            link.dataset.deferredStyleActive = '1';
        }

        return waitForAuthSheetStylesheet(link);
    }

    function ensureStyles() {
        removeLegacyLoginStyles();

        if (!findAuthSheetStylesheet()) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = AUTH_SHEET_CSS_HREF;
            document.head.appendChild(link);
        }
    }

    function ensureMarkup() {
        const cachedProfile = readCachedProfile();
        const authButtonHTML = buildAuthButtonHTML(cachedProfile);
        const authContainer = document.getElementById('auth-container');

        if (!document.getElementById('authBtn')) {
            if (authContainer) {
                authContainer.innerHTML = authButtonHTML;
            } else {
                document.body.insertAdjacentHTML('beforeend', `<div class="top-right-nav">${authButtonHTML}</div>`);
            }
        }

        if (!document.getElementById('dropdownOverlay')) {
            document.body.insertAdjacentHTML('beforeend', '<div class="dropdown-overlay" id="dropdownOverlay"></div>');
        }

        if (!document.getElementById('userDropdown')) {
            document.body.insertAdjacentHTML('beforeend', buildDropdownHTML());
        }

        if (!document.getElementById('loginModal')) {
            document.body.insertAdjacentHTML('beforeend', buildAuthSheetHTML());
        }

        const pendingAuthUser = window.__ZAOYOE_PENDING_AUTH_USER__;
        if (pendingAuthUser?.user && typeof window.updateUserUI === 'function') {
            window.updateUserUI(pendingAuthUser.user, {
                ...(pendingAuthUser.options || {}),
                preferImmediateAvatar: true
            });
            window.__ZAOYOE_PENDING_AUTH_USER__ = null;
        } else if (cachedProfile && typeof window.updateUserUI === 'function') {
            window.updateUserUI(cachedProfile, {
                animateAvatar: false,
                preferImmediateAvatar: true
            });
        }

        if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('zaoyoe:auth-markup-ready', {
                detail: {
                    hasCachedProfile: !!cachedProfile
                }
            }));
        }

        if (window.i18n?.applyTranslations) {
            window.i18n.applyTranslations();
        }
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const filename = src.split('?')[0].split('/').pop();
            const existingScript = Array.from(document.querySelectorAll('script')).find((node) => {
                return node.src && node.src.split('?')[0].split('/').pop() === filename;
            });

            if (existingScript) {
                if (existingScript.dataset.loaded === '1' || existingScript.readyState === 'complete') {
                    resolve();
                    return;
                }

                existingScript.addEventListener('load', () => resolve(), { once: true });
                existingScript.addEventListener('error', reject, { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = () => {
                script.dataset.loaded = '1';
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function ensureSupportScript() {
        if (typeof window.sendVerificationCode === 'function') {
            return Promise.resolve();
        }

        if (!supportScriptPromise) {
            supportScriptPromise = loadScript(SUPPORT_SCRIPT_SRC);
        }

        return supportScriptPromise;
    }

    function ensureEmailJs() {
        if (typeof window.emailjs !== 'undefined') {
            try {
                window.emailjs.init(EMAILJS_PUBLIC_KEY);
            } catch (error) {
                // ignore repeated init
            }
            return Promise.resolve();
        }

        if (!emailJsPromise) {
            emailJsPromise = loadScript(EMAILJS_SRC).then(() => {
                if (typeof window.emailjs !== 'undefined') {
                    window.emailjs.init(EMAILJS_PUBLIC_KEY);
                }
            });
        }

        return emailJsPromise;
    }

    async function ensureRegisterDependencies() {
        await Promise.all([ensureSupportScript(), ensureEmailJs()]);
    }

    function warmRegisterDependencies() {
        ensureRegisterDependencies().catch((error) => {
            console.warn('⚠️ Failed to warm register dependencies:', error?.message || error);
        });
    }

    function getSheetElements() {
        const overlay = document.getElementById('loginModal');
        return {
            overlay,
            stage: overlay?.querySelector('.auth-sheet-stage') || null,
            sheet: overlay?.querySelector('.auth-sheet') || null,
            motionShell: overlay?.querySelector('.auth-sheet-motion-shell') || null,
            formCore: overlay?.querySelector('.auth-sheet-form-core') || null,
            tabs: overlay?.querySelector('#authSheetTabs') || null,
            title: overlay?.querySelector('#authSheetTitle') || null,
            message: overlay?.querySelector('#authSheetMessage') || null,
            googleDebug: overlay?.querySelector('#authGoogleDebugBadge') || null,
            body: overlay?.querySelector('.auth-sheet-body') || null,
            plane: overlay?.querySelector('#authInputPlane') || null
        };
    }

    function ensureGoogleDebugFloatingBadge() {
        let badge = document.getElementById(GOOGLE_DEBUG_FLOATING_ID);
        if (badge) return badge;
        if (!document.body) return null;

        badge = document.createElement('div');
        badge.id = GOOGLE_DEBUG_FLOATING_ID;
        badge.className = 'auth-google-debug-floating';
        badge.hidden = true;
        badge.setAttribute('aria-live', 'polite');
        document.body.appendChild(badge);
        return badge;
    }

    function renderGoogleDebugBadge() {
        const { googleDebug } = getSheetElements();
        const floatingDebug = ensureGoogleDebugFloatingBadge();

        const enabled = googleDebugState.enabled && !!String(googleDebugState.label || '').trim();
        if (googleDebug) {
            googleDebug.hidden = !enabled;
            googleDebug.classList.toggle('is-visible', enabled);
        }
        if (floatingDebug) {
            floatingDebug.hidden = !enabled;
            floatingDebug.classList.toggle('is-visible', enabled);
        }

        if (!enabled) {
            if (googleDebug) {
                googleDebug.textContent = '';
            }
            if (floatingDebug) {
                floatingDebug.textContent = '';
            }
            return;
        }

        const label = String(googleDebugState.label || '').trim();
        const detail = String(googleDebugState.detail || '').trim();
        const text = detail ? `${label} · ${detail}` : label;
        if (googleDebug) {
            googleDebug.textContent = text;
        }
        if (floatingDebug) {
            floatingDebug.textContent = `Google 登录诊断：${text}`;
        }
    }

    function setAuthGoogleDebugState(payload = {}) {
        googleDebugState.enabled = payload.enabled === true;
        googleDebugState.label = String(payload.label || '').trim();
        googleDebugState.detail = String(payload.detail || '').trim();
        renderGoogleDebugBadge();
        return true;
    }

    function clearAuthGoogleDebugState() {
        googleDebugState.enabled = false;
        googleDebugState.label = '';
        googleDebugState.detail = '';
        renderGoogleDebugBadge();
    }

    function getActiveAuthInput() {
        const { overlay } = getSheetElements();
        const active = document.activeElement;
        if (!overlay || !active || !overlay.contains(active)) return null;
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
    }

    function syncAuthInputActiveState() {
        const { overlay } = getSheetElements();
        if (!overlay) return;
        overlay.classList.toggle('auth-sheet-input-active', !!portalState.activeId || !!getActiveAuthInput());
    }

    function stabilizeAuthSheetForSubmit(options = {}) {
        const { overlay } = getSheetElements();
        if (!overlay) return;

        if (submitState.stabilizeTimerId) {
            window.clearTimeout(submitState.stabilizeTimerId);
            submitState.stabilizeTimerId = 0;
        }

        overlay.classList.add('auth-sheet-submit-active');
        deactivateActivePortaledInput({ blur: true });
        getActiveAuthInput()?.blur();
        syncAuthInputActiveState();

        if (options.persist === true) {
            return;
        }

        submitState.stabilizeTimerId = window.setTimeout(() => {
            overlay.classList.remove('auth-sheet-submit-active');
            submitState.stabilizeTimerId = 0;
        }, 360);
    }

    function clearAuthSheetSubmitState() {
        const { overlay } = getSheetElements();
        if (submitState.stabilizeTimerId) {
            window.clearTimeout(submitState.stabilizeTimerId);
            submitState.stabilizeTimerId = 0;
        }
        overlay?.classList.remove('auth-sheet-submit-active', 'auth-sheet-submitting');
        const message = overlay?.querySelector('#authSheetMessage');
        if (message?.hidden) {
            releaseAuthMessageReserve(message);
        }
    }

    function getProxyForInputId(inputId) {
        const { overlay } = getSheetElements();
        return overlay?.querySelector(`[data-auth-proxy-for="${inputId}"]`) || null;
    }

    function getProxyDisplayValue(input) {
        if (!input) return '';
        if (input.type === 'password') {
            return input.value ? '•'.repeat(input.value.length) : '';
        }
        return input.value || '';
    }

    function updateInputProxyDisplay(input) {
        if (!input?.id) return;
        const proxy = getProxyForInputId(input.id);
        if (!proxy) return;

        const valueNode = proxy.querySelector('[data-auth-proxy-value]');
        const hasValue = !!input.value;

        if (valueNode) {
            valueNode.textContent = getProxyDisplayValue(input);
        }

        proxy.classList.toggle('is-filled', hasValue);
    }

    function syncAllInputProxyDisplays() {
        document.querySelectorAll('#loginModal [data-auth-canonical-input]').forEach((input) => {
            updateInputProxyDisplay(input);
        });
    }

    function syncAuthInputInteractionMode() {
        const overlay = document.getElementById('loginModal');
        if (!overlay) return;

        const desktopNativeInputs = shouldUseDesktopNativeAuthInput();
        if (desktopNativeInputs && portalState.activeId) {
            deactivateActivePortaledInput({ blur: false });
        }

        overlay.querySelectorAll('[data-auth-canonical-input]').forEach((input) => {
            resetPortaledInputStyles(input);

            if (desktopNativeInputs) {
                input.classList.remove('auth-sheet-input--parked', 'auth-sheet-input--portaled', 'auth-sheet-input--proxy-hidden');
                input.removeAttribute('aria-hidden');
                input.removeAttribute('tabindex');
                return;
            }

            if (portalState.input === input) return;

            input.classList.add('auth-sheet-input--parked');
            input.classList.remove('auth-sheet-input--portaled', 'auth-sheet-input--proxy-hidden');
            input.setAttribute('aria-hidden', 'true');
            input.setAttribute('tabindex', '-1');
        });

        overlay.querySelectorAll('[data-auth-proxy-for]').forEach((proxy) => {
            proxy.classList.toggle('auth-sheet-input-proxy--desktop-hidden', desktopNativeInputs);
        });

        if (desktopNativeInputs) {
            const plane = document.getElementById('authInputPlane');
            plane?.classList.remove('is-active');
            plane?.setAttribute('aria-hidden', 'true');
        }

        syncAuthInputActiveState();
    }

    function clearPortalLayoutRaf() {
        if (portalState.layoutRafId) {
            window.cancelAnimationFrame(portalState.layoutRafId);
            portalState.layoutRafId = 0;
        }
    }

    function resetPortaledInputStyles(input) {
        if (!input) return;
        setInjectedAuthStyleState(input, {
            position: '',
            left: '',
            top: '',
            width: '',
            height: '',
            margin: '',
            zIndex: '',
            pointerEvents: '',
            right: '',
            bottom: ''
        });
    }

    function focusPortaledInput(input) {
        if (!input) return;

        try {
            input.focus({ preventScroll: true });
        } catch (error) {
            input.focus();
        }

        if (typeof input.setSelectionRange === 'function' && !['email', 'number', 'date', 'time'].includes(input.type)) {
            const end = input.value.length;
            input.setSelectionRange(end, end);
        }
    }

    function setPortaledInputVisibility(input, proxy, isVisible) {
        if (!input) return;
        input.classList.toggle('auth-sheet-input--proxy-hidden', !isVisible);
        proxy?.classList.toggle('is-proxy-hidden', !isVisible);
    }

    function syncActivePortaledInputPosition() {
        if (!portalState.activeId || !portalState.input || !portalState.proxy) return;

        const { body, plane } = getSheetElements();
        const rect = portalState.proxy.getBoundingClientRect();
        const input = portalState.input;
        const useInPlaceInput = shouldUseInPlaceAuthInput();
        let isVisible = true;

        if (useInPlaceInput) {
            const offsetParent = input.offsetParent || portalState.proxy.offsetParent || portalState.originParent;
            if (!offsetParent) return;
            const offsetParentRect = offsetParent.getBoundingClientRect();

            plane?.classList.remove('is-active');
            plane?.setAttribute('aria-hidden', 'true');

            setInjectedAuthStyleState(input, {
                position: 'absolute',
                left: `${rect.left - offsetParentRect.left}px`,
                top: `${rect.top - offsetParentRect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                margin: '0',
                zIndex: '2',
                pointerEvents: 'auto'
            });
            setPortaledInputVisibility(input, portalState.proxy, true);
            return;
        }

        if (body) {
            const bodyRect = body.getBoundingClientRect();
            const viewportTop = window.visualViewport?.offsetTop || 0;
            const viewportLeft = window.visualViewport?.offsetLeft || 0;
            const viewportWidth = window.visualViewport?.width || window.innerWidth;
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            const visibleTop = Math.max(bodyRect.top, viewportTop);
            const visibleBottom = Math.min(bodyRect.bottom, viewportTop + viewportHeight);
            const visibleLeft = Math.max(bodyRect.left, viewportLeft);
            const visibleRight = Math.min(bodyRect.right, viewportLeft + viewportWidth);
            const edgePadding = 8;
            const fullyInsideVertical = rect.top >= visibleTop + edgePadding && rect.bottom <= visibleBottom - edgePadding;
            const fullyInsideHorizontal = rect.left >= visibleLeft && rect.right <= visibleRight;
            isVisible = fullyInsideVertical && fullyInsideHorizontal && rect.width > 16 && rect.height > 20;
        }

        setInjectedAuthStyleState(input, {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: '0',
            zIndex: '12091',
            pointerEvents: isVisible ? 'auto' : 'none'
        });
        setPortaledInputVisibility(input, portalState.proxy, isVisible);
    }

    function scheduleActivePortaledInputPosition() {
        if (!portalState.activeId || portalState.layoutRafId) return;
        portalState.layoutRafId = window.requestAnimationFrame(() => {
            portalState.layoutRafId = 0;
            syncActivePortaledInputPosition();
        });
    }

    function deactivateActivePortaledInput(options = {}) {
        if (!portalState.activeId || !portalState.input) return;

        const { blur = true } = options;
        const { plane } = getSheetElements();
        const { input, proxy, originParent, originNextSibling } = portalState;

        clearPortalLayoutRaf();

        if (blur && document.activeElement === input) {
            input.blur();
        }

        resetPortaledInputStyles(input);

        if (originParent) {
            if (originNextSibling && originNextSibling.parentNode === originParent) {
                originParent.insertBefore(input, originNextSibling);
            } else {
                originParent.appendChild(input);
            }
        }

        input.classList.add('auth-sheet-input--parked');
        input.classList.remove('auth-sheet-input--portaled');
        input.classList.remove('auth-sheet-input--proxy-hidden');
        input.setAttribute('aria-hidden', 'true');
        input.setAttribute('tabindex', '-1');

        proxy?.classList.remove('is-active');
        proxy?.classList.remove('is-portaled');
        proxy?.classList.remove('is-proxy-hidden');
        updateInputProxyDisplay(input);

        plane?.classList.remove('is-active');
        plane?.setAttribute('aria-hidden', 'true');

        portalState.activeId = null;
        portalState.input = null;
        portalState.proxy = null;
        portalState.originParent = null;
        portalState.originNextSibling = null;
        syncAuthInputActiveState();
    }

    function activatePortaledInputById(inputId, options = {}) {
        const { plane } = getSheetElements();
        const input = document.getElementById(inputId);
        const proxy = getProxyForInputId(inputId);
        if (!plane || !input || !proxy) return;
        const useInPlaceInput = shouldUseInPlaceAuthInput();

        if (portalState.activeId === inputId) {
            if (useInPlaceInput) {
                plane.classList.remove('is-active');
                plane.setAttribute('aria-hidden', 'true');
            } else {
                plane.classList.add('is-active');
                plane.setAttribute('aria-hidden', 'false');
            }
            scheduleActivePortaledInputPosition();
            if (options.focus !== false && document.activeElement !== input) {
                focusPortaledInput(input);
            }
            return;
        }

        deactivateActivePortaledInput({ blur: false });

        portalState.activeId = inputId;
        portalState.input = input;
        portalState.proxy = proxy;
        portalState.originParent = input.parentNode;
        portalState.originNextSibling = input.nextSibling;

        input.classList.remove('auth-sheet-input--parked');
        input.classList.add('auth-sheet-input--portaled');
        input.removeAttribute('aria-hidden');
        input.removeAttribute('tabindex');

        proxy.classList.add('is-active');
        proxy.classList.add('is-portaled');
        syncAuthInputActiveState();

        if (useInPlaceInput) {
            plane.classList.remove('is-active');
            plane.setAttribute('aria-hidden', 'true');
        } else {
            plane.classList.add('is-active');
            plane.setAttribute('aria-hidden', 'false');
            plane.appendChild(input);
        }

        syncActivePortaledInputPosition();
        scheduleActivePortaledInputPosition();
        updateInputProxyDisplay(input);

        if (options.focus !== false) {
            focusPortaledInput(input);
        }
    }

    function requestKeyboardDismiss() {
        const activeInput = getActiveAuthInput();
        if (!activeInput) return false;
        activeInput?.blur();
        overlayCloseDisabledUntil = Date.now() + 220;
        return true;
    }

    function runAfterKeyboardDismiss(callback, delay = 140) {
        if (requestKeyboardDismiss()) {
            window.setTimeout(callback, delay);
            return;
        }

        callback();
    }

    function updateSheetCopy(viewId) {
        const meta = VIEW_META[viewId] || VIEW_META.login;
        const { title, tabs } = getSheetElements();
        if (title) title.textContent = t(meta.titleKey, meta.titleFallback);
        if (tabs) tabs.hidden = viewId === 'reset';
    }

    function syncTabIndicator(viewId, options = {}) {
        const { immediate = false } = options;
        const tabs = document.getElementById('authSheetTabs');
        const indicator = tabs?.querySelector('.auth-sheet-tab-indicator');
        const activeButton = tabs?.querySelector(`[data-auth-tab="${viewId}"]`);
        if (!tabs || !indicator || !activeButton || tabs.hidden) return;

        const applyPosition = () => {
            setInjectedAuthStyleState(indicator, {
                width: `${activeButton.offsetWidth}px`,
                transform: `translateX(${activeButton.offsetLeft}px)`
            });
        };

        if (immediate) {
            applyPosition();
            return;
        }

        window.requestAnimationFrame(applyPosition);
    }

    function finishAuthSheetResizeAnimation(token) {
        if (token !== resizeState.token) return;

        const { overlay, sheet, body } = getSheetElements();
        if (resizeState.cleanupTimerId) {
            window.clearTimeout(resizeState.cleanupTimerId);
            resizeState.cleanupTimerId = 0;
        }

        overlay?.classList.remove('auth-sheet-resizing');
        setInjectedAuthStyleState(sheet, {
            height: null,
            transition: null,
            willChange: null
        });
        setInjectedAuthStyleProperty(body, 'overflowY', null);
    }

    function mutateAuthSheetLayout(mutator, options = {}) {
        const { animate = true } = options;
        const { overlay, sheet } = getSheetElements();
        const shouldAnimateResize = animate &&
            !!sheet &&
            overlay?.classList.contains('active') &&
            !prefersReducedAuthMotion();
        const fromHeight = shouldAnimateResize ? Math.ceil(sheet.getBoundingClientRect().height) : 0;

        mutator();

        if (shouldAnimateResize) {
            animateAuthSheetResize(fromHeight);
        }
    }

    function animateAuthSheetResize(fromHeight) {
        const { overlay, sheet, body } = getSheetElements();
        if (!overlay || !sheet || !body) return;

        resizeState.token += 1;
        const token = resizeState.token;

        if (resizeState.cleanupTimerId) {
            window.clearTimeout(resizeState.cleanupTimerId);
            resizeState.cleanupTimerId = 0;
        }

        overlay.classList.add('auth-sheet-resizing');

        setInjectedAuthStyleProperty(sheet, 'height', 'auto');
        const toHeight = Math.ceil(sheet.getBoundingClientRect().height);
        setInjectedAuthStyleState(sheet, {
            height: `${fromHeight}px`,
            transition: 'none',
            willChange: 'height'
        });
        setInjectedAuthStyleProperty(body, 'overflowY', 'hidden', 'important');

        void sheet.offsetHeight;

        if (!toHeight || Math.abs(toHeight - fromHeight) < 1) {
            finishAuthSheetResizeAnimation(token);
            return;
        }

        setInjectedAuthStyleProperty(
            sheet,
            'transition',
            `height ${AUTH_SHEET_RESIZE_DURATION_MS}ms ${AUTH_SHEET_RESIZE_EASING}`
        );

        const handleTransitionEnd = (event) => {
            if (event.target !== sheet || event.propertyName !== 'height') return;
            sheet.removeEventListener('transitionend', handleTransitionEnd);
            finishAuthSheetResizeAnimation(token);
        };

        sheet.addEventListener('transitionend', handleTransitionEnd);
        resizeState.cleanupTimerId = window.setTimeout(() => {
            sheet.removeEventListener('transitionend', handleTransitionEnd);
            finishAuthSheetResizeAnimation(token);
        }, AUTH_SHEET_RESIZE_DURATION_MS + 80);

        window.requestAnimationFrame(() => {
            if (token !== resizeState.token) return;
            setInjectedAuthStyleProperty(sheet, 'height', `${toHeight}px`);
        });
    }

    function updateTabState(viewId, options = {}) {
        document.querySelectorAll('#loginModal [data-auth-tab]').forEach((button) => {
            const isActive = button.dataset.authTab === viewId;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        syncTabIndicator(viewId, options);
    }

    async function setAuthView(viewId, options = {}) {
        const { clearMessage = true, ensureDependencies = true } = options;
        const { overlay, sheet, body } = getSheetElements();
        if (!overlay || !body) return;

        if (!VIEW_META[viewId]) {
            viewId = 'login';
        }

        if (ensureDependencies && viewId === 'register') {
            warmRegisterDependencies();
        }

        const previousView = sheetState.view;
        const shouldAnimateResize = !!sheet &&
            overlay.classList.contains('active') &&
            previousView !== viewId &&
            !prefersReducedAuthMotion();
        const fromHeight = shouldAnimateResize ? Math.ceil(sheet.getBoundingClientRect().height) : 0;

        document.querySelectorAll('#loginModal [data-auth-view]').forEach((view) => {
            const isActive = view.dataset.authView === viewId;
            view.hidden = !isActive;
            view.classList.toggle('is-active', isActive);
        });

        deactivateActivePortaledInput({ blur: false });

        if (PRIMARY_VIEWS.has(viewId)) {
            sheetState.lastPrimaryView = viewId;
        }

        sheetState.view = viewId;
        overlay.dataset.authCurrentView = viewId;
        overlay.classList.toggle('auth-sheet-primary-mode', PRIMARY_VIEWS.has(viewId));
        updateSheetCopy(viewId);
        updateTabState(viewId, { immediate: !overlay.classList.contains('active') });

        if (clearMessage) {
            clearAuthMessage({ animate: false });
        }

        body.scrollTop = 0;

        if (shouldAnimateResize) {
            animateAuthSheetResize(fromHeight);
        }
    }

    function renderAuthMessage(message, type = 'error') {
        const { message: messageBox } = getSheetElements();
        const payload = normalizeAuthMessagePayload(message);
        const normalizedMessage = String(payload.text || '').trim();
        if (!messageBox || !normalizedMessage) return false;

        releaseAuthMessageReserve(messageBox);
        messageBox.hidden = false;
        messageBox.textContent = normalizedMessage;
        setAuthMessageTranslationState(messageBox, payload);
        messageBox.classList.remove('is-error', 'is-success');
        messageBox.classList.add(type === 'success' ? 'is-success' : 'is-error');
        return true;
    }

    function hasSubmitStabilizedAuthSheet(overlay) {
        return !!(
            overlay?.classList.contains('auth-sheet-submit-active') ||
            overlay?.classList.contains('auth-sheet-submitting')
        );
    }

    function reserveAuthMessageSpace(messageBox) {
        if (!messageBox || messageBox.hidden) return false;

        const reserveHeight = Math.ceil(
            messageBox.getBoundingClientRect().height ||
            messageBox.offsetHeight ||
            0
        );

        if (reserveHeight <= 0) return false;

        setInjectedAuthStyleProperty(messageBox, '--auth-sheet-message-reserve-height', `${reserveHeight}px`);
        messageBox.classList.add('is-reserved');
        return true;
    }

    function releaseAuthMessageReserve(messageBox) {
        if (!messageBox?.classList?.contains('is-reserved')) return;

        messageBox.classList.remove('is-reserved');
        setInjectedAuthStyleProperty(messageBox, '--auth-sheet-message-reserve-height', null);
    }

    function showAuthMessage(message, type = 'error', targetView) {
        const { overlay, message: messageBox } = getSheetElements();
        if (!messageBox || !overlay?.classList.contains('active')) return false;

        if (targetView && VIEW_META[targetView]) {
            setAuthView(targetView, { clearMessage: false }).catch(() => { /* ignore */ });
        }

        mutateAuthSheetLayout(() => {
            renderAuthMessage(message, type);
        }, { animate: !overlay.classList.contains('auth-sheet-over-shop-modal') });
        return true;
    }

    function clearAuthMessage(options = {}) {
        const { animate = true, reserveSpace = false } = options;
        const { overlay, message } = getSheetElements();
        if (!message) return;
        if (message.hidden && !message.textContent && !message.classList.contains('is-error') && !message.classList.contains('is-success')) {
            if (!hasSubmitStabilizedAuthSheet(overlay)) {
                releaseAuthMessageReserve(message);
            }
            return;
        }

        const shouldReserveSpace = (
            reserveSpace ||
            (hasSubmitStabilizedAuthSheet(overlay) && !message.hidden && !!message.textContent)
        );

        mutateAuthSheetLayout(() => {
            if (shouldReserveSpace) {
                reserveAuthMessageSpace(message);
            } else {
                releaseAuthMessageReserve(message);
            }
            message.hidden = true;
            message.textContent = '';
            setAuthMessageTranslationState(message, {});
            message.classList.remove('is-error', 'is-success');
        }, { animate: animate && !shouldReserveSpace });
    }

    function resetAuthSheetFields(options = {}) {
        const { preserveView = false, preserveMessage = false } = options;
        const overlay = document.getElementById('loginModal');
        if (!overlay) return;

        deactivateActivePortaledInput({ blur: false });
        getActiveAuthInput()?.blur();
        if (!preserveMessage) {
            clearAuthMessage();
        }

        overlay.querySelectorAll('form').forEach((form) => {
            form.reset();
        });

        overlay.querySelectorAll('[data-auth-canonical-input]').forEach((input) => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        const rememberMe = overlay.querySelector('#rememberMe');
        const privacyConsent = overlay.querySelector('#privacyConsent');
        if (rememberMe) rememberMe.checked = false;
        if (privacyConsent) privacyConsent.checked = false;

        if (typeof window.restoreRememberedLoginState === 'function') {
            window.restoreRememberedLoginState();
        }

        overlay.querySelectorAll('[data-auth-submit]').forEach((button) => {
            if (button.dataset.originalHtml) {
                button.innerHTML = button.dataset.originalHtml;
                delete button.dataset.originalHtml;
            }
            button.disabled = false;
        });

        syncAllInputProxyDisplays();
        syncAuthInputInteractionMode();

        if (!preserveView) {
            setAuthView('login', { clearMessage: true, ensureDependencies: false }).catch(() => { /* ignore */ });
        }
    }

    function setAuthFormLoading(formName, isLoading, label) {
        const button = document.querySelector(`#loginModal [data-auth-submit="${formName}"]`);
        if (!button) return;

        if (isLoading) {
            stabilizeAuthSheetForSubmit({ persist: true });
            document.getElementById('loginModal')?.classList.add('auth-sheet-submitting');

            if (!button.dataset.originalHtml) {
                button.dataset.originalHtml = button.innerHTML;
            }

            const loadingText = label || t('common.loading', '加载中...');
            button.innerHTML = `<span class="auth-sheet-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;
            button.disabled = true;
        } else {
            if (button.dataset.originalHtml) {
                button.innerHTML = button.dataset.originalHtml;
                delete button.dataset.originalHtml;
            }
            button.disabled = false;
            clearAuthSheetSubmitState();
        }
    }

    async function ensureInjectedAuthWalletModal(options = {}) {
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

    async function openInjectedAuthWalletView(view = 'balance', context = {}) {
        const walletModal = await ensureInjectedAuthWalletModal();
        walletModal?.open?.(view, context);
        return walletModal;
    }

    function openDropdown() {
        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('dropdownOverlay');
        const authBtn = document.getElementById('authBtn');
        if (!dropdown || !authBtn) return;

        const rect = authBtn.getBoundingClientRect();
        const navBar = authBtn.closest('.nav-bar') || authBtn.closest('.framer-nav') || authBtn.closest('nav') || authBtn.closest('.top-right-nav');
        const navBottom = navBar ? navBar.getBoundingClientRect().bottom : rect.bottom + 8;
        const navOverlap = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--nav-dropdown-overlap')
        ) || 1;
        const rightOffset = Math.max(10, window.innerWidth - rect.right);

        setInjectedAuthStyleState(dropdown, {
            right: `${rightOffset}px`,
            top: `${navBottom - navOverlap}px`
        }, 'important');
        dropdown.classList.add('active');
        dropdown.setAttribute('aria-hidden', 'false');
        overlay?.classList.add('active');
        authBtn.setAttribute('aria-expanded', 'true');

        void ensureInjectedAuthWalletModal({ prefetch: true });
        void window.ZaoyoeProfileModalBootstrap?.warm?.({ reason: 'dropdown-open' });
    }

    function closeDropdown() {
        if (typeof window.closeUserDropdown === 'function') {
            window.closeUserDropdown();
            return;
        }

        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('dropdownOverlay');
        const authBtn = document.getElementById('authBtn');
        dropdown?.classList.remove('active');
        dropdown?.setAttribute('aria-hidden', 'true');
        overlay?.classList.remove('active');
        authBtn?.setAttribute('aria-expanded', 'false');
    }

    function hasActiveShopModalBehindAuthSheet() {
        return !!document.querySelector('#shopPurchaseModal.active, #shopSuccessModal.active');
    }

    function lockAuthSheetScroll(overlay, options = {}) {
        if (!window.iOSScrollLock) return;

        const freezeScrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
        window.iOSScrollLock.lock(overlay, { freezeScrollY });
    }

    async function openLoginModal(viewId = sheetState.lastPrimaryView || 'login', options = {}) {
        const initialMessage = String(options?.initialMessage || '').trim();
        const initialMessageType = options?.initialMessageType === 'success' ? 'success' : 'error';
        const hasInitialMessage = !!initialMessage;

        ensureMarkup();
        await ensureAuthSheetStylesReady();

        const { overlay } = getSheetElements();
        if (!overlay) return;

        await waitForAuthSheetStylesApplied(overlay);

        const overShopModal = hasActiveShopModalBehindAuthSheet();
        overlay.classList.toggle('auth-sheet-over-shop-modal', overShopModal);
        overlay.classList.remove('auth-sheet-force-hidden');

        syncAuthInputInteractionMode();
        resetAuthSheetFields({ preserveView: true });

        setInjectedAuthStyleProperty(overlay, 'display', null);
        overlay.hidden = false;
        overlay.classList.remove('auth-sheet-input-active');
        await setAuthView(viewId, { clearMessage: true });
        if (hasInitialMessage) {
            renderAuthMessage(initialMessage, initialMessageType);
        }
        syncAllInputProxyDisplays();
        syncTabIndicator(sheetState.view, { immediate: true });

        window.requestAnimationFrame(() => {
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
        });

        window.setTimeout(() => {
            if (!overlay.classList.contains('active')) return;
            resetAuthSheetFields({ preserveView: true, preserveMessage: hasInitialMessage });
            setAuthView(viewId, { clearMessage: !hasInitialMessage, ensureDependencies: false }).catch(() => { /* ignore */ });
            if (hasInitialMessage) {
                renderAuthMessage(initialMessage, initialMessageType);
            }
        }, 80);

        document.body.classList.add('auth-sheet-open');
        if (typeof window.__forcePromptThemeColorBlack === 'function') {
            window.__forcePromptThemeColorBlack();
        }
        lockAuthSheetScroll(overlay, { overShopModal });

        overlayCloseDisabledUntil = Date.now() + 240;
        warmRegisterDependencies();
        renderGoogleDebugBadge();

        if (typeof window.prefetchGooglePopupCloseShell === 'function') {
            window.prefetchGooglePopupCloseShell();
        }
    }

    async function openLoginModalWithMessage(message, options = {}) {
        const normalizedMessage = String(message || '').trim();
        const viewId = options?.viewId || sheetState.lastPrimaryView || 'login';
        const type = options?.type === 'success' ? 'success' : 'error';
        const overlay = document.getElementById('loginModal');

        if (overlay?.classList.contains('active')) {
            await setAuthView(viewId, { clearMessage: true });
            if (normalizedMessage) {
                showAuthMessage(normalizedMessage, type, viewId);
            }
            return;
        }

        await openLoginModal(viewId, {
            initialMessage: normalizedMessage,
            initialMessageType: type
        });
    }

    function closeLoginModal() {
        const { overlay, sheet } = getSheetElements();
        if (!overlay) return;

        resetAuthSheetFields({ preserveView: true });
        deactivateActivePortaledInput();
        getActiveAuthInput()?.blur();
        clearAuthMessage();
        dragState.active = false;
        dragState.startY = 0;
        dragState.deltaY = 0;
        setInjectedAuthStyleProperty(sheet, 'transform', null);

        window.runSiteModalCloseChromeCleanup?.({
            targets: [overlay],
            forceHiddenClass: 'auth-sheet-force-hidden',
            restoreDelayMs: 320
        });
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('auth-sheet-open');
        if (typeof window.__forcePromptThemeColorBlack === 'function') {
            window.__forcePromptThemeColorBlack();
        }

        window.setTimeout(() => {
            if (!overlay.classList.contains('active')) {
                overlay.hidden = true;
                overlay.classList.remove('auth-sheet-over-shop-modal');
            }
        }, 280);

        if (window.iOSScrollLock) {
            window.iOSScrollLock.unlock();
        }
    }

    function toggleLoginModal(viewId) {
        const { overlay } = getSheetElements();
        if (overlay?.classList.contains('active')) {
            closeLoginModal();
        } else {
            openLoginModal(viewId || sheetState.lastPrimaryView || 'login').catch((error) => {
                console.error('Failed to open auth sheet:', error);
            });
        }
    }

    function maybeDismissAuthSheet() {
        const now = Date.now();
        if (now < overlayCloseDisabledUntil) return;

        if (requestKeyboardDismiss()) {
            return;
        }

        closeLoginModal();
    }

    function bindAuthSheetEvents() {
        const overlay = document.getElementById('loginModal');
        if (!overlay || overlay.dataset.bound === '1') return;

        overlay.addEventListener('click', (event) => {
            const proxyTrigger = event.target.closest('[data-auth-proxy-for]');
            if (proxyTrigger) {
                activatePortaledInputById(proxyTrigger.dataset.authProxyFor);
                return;
            }

            const submitTrigger = event.target.closest('[data-auth-submit]');
            if (submitTrigger && overlay.contains(submitTrigger) && !submitTrigger.disabled) {
                stabilizeAuthSheetForSubmit();
                return;
            }

            const tabTrigger = event.target.closest('[data-auth-tab]');
            if (tabTrigger) {
                runAfterKeyboardDismiss(() => {
                    deactivateActivePortaledInput({ blur: false });
                    setAuthView(tabTrigger.dataset.authTab).catch((error) => {
                        console.warn('Failed to switch auth view:', error);
                    });
                });
                return;
            }

            if (event.target.closest('[data-auth-reset]')) {
                runAfterKeyboardDismiss(() => {
                    deactivateActivePortaledInput({ blur: false });
                    setAuthView('reset').catch((error) => {
                        console.warn('Failed to open reset view:', error);
                    });
                });
                return;
            }

            if (event.target.closest('[data-auth-google]')) {
                clearAuthMessage();
                window.triggerGoogleLogin?.();
                return;
            }

            if (event.target.closest('[data-auth-send-code]')) {
                clearAuthMessage();
                ensureRegisterDependencies()
                    .then(() => window.sendVerificationCode?.())
                    .catch((error) => {
                        console.error('Failed to load verification dependencies:', error);
                        showAuthMessage(t('auth.codeServiceFailed', '验证码能力加载失败，请稍后重试。'));
                    });
                return;
            }

            if (event.target === overlay || event.target.closest('[data-auth-backdrop]')) {
                maybeDismissAuthSheet();
            }
        });

        overlay.querySelector('#loginForm')?.addEventListener('submit', (event) => {
            stabilizeAuthSheetForSubmit();
            clearAuthMessage({ reserveSpace: true, animate: false });
            window.handleLogin?.(event);
        });

        overlay.querySelector('#registerForm')?.addEventListener('submit', (event) => {
            stabilizeAuthSheetForSubmit();
            clearAuthMessage({ reserveSpace: true, animate: false });
            window.handleRegister?.(event);
        });

        overlay.querySelector('#resetForm')?.addEventListener('submit', (event) => {
            stabilizeAuthSheetForSubmit();
            clearAuthMessage({ reserveSpace: true, animate: false });
            window.handlePasswordReset?.(event);
        });

        overlay.querySelectorAll('[data-auth-canonical-input]').forEach((input) => {
            updateInputProxyDisplay(input);

            input.addEventListener('input', () => {
                syncAllInputProxyDisplays();
                scheduleActivePortaledInputPosition();
            });

            input.addEventListener('change', () => {
                syncAllInputProxyDisplays();
                scheduleActivePortaledInputPosition();
            });

            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' || event.shiftKey) return;
                const formId = input.dataset.authForm;
                if (!formId) return;
                const form = document.getElementById(formId);
                if (!form) return;
                event.preventDefault();
                form.requestSubmit?.();
            });

            input.addEventListener('blur', () => {
                window.setTimeout(() => {
                    if (portalState.input === input && document.activeElement !== input) {
                        deactivateActivePortaledInput({ blur: false });
                    }
                    syncAuthInputActiveState();
                }, 60);
            });
        });

        overlay.querySelector('.auth-sheet-body')?.addEventListener('scroll', () => {
            syncActivePortaledInputPosition();
            scheduleActivePortaledInputPosition();
        }, { passive: true });

        const dragTargets = overlay.querySelectorAll('[data-auth-drag-zone]');
        const setDragHandleActive = (isActive) => {
            dragTargets.forEach((target) => {
                target.classList.toggle('is-close-armed', isActive);
            });
        };
        const resetDragState = () => {
            const { sheet } = getSheetElements();
            setInjectedAuthStyleProperty(sheet, 'transform', null);
            setDragHandleActive(false);
            dragState.active = false;
            dragState.startY = 0;
            dragState.deltaY = 0;
        };

        const handleDragStart = (event) => {
            const touch = event.touches?.[0];
            if (event.type === 'touchstart' && !touch) return;
            if (event.touches.length !== 1) return;

            if (requestKeyboardDismiss()) {
                return;
            }

            dragState.active = true;
            dragState.startY = touch.clientY;
            dragState.deltaY = 0;
            setDragHandleActive(true);
        };

        const handleDragMove = (event) => {
            if (!dragState.active) return;
            const { sheet } = getSheetElements();
            if (!sheet) return;

            dragState.deltaY = Math.max(0, event.touches[0].clientY - dragState.startY);
            if (dragState.deltaY <= 0) {
                setInjectedAuthStyleProperty(sheet, 'transform', null);
                return;
            }

            const translate = Math.min(112, dragState.deltaY);
            setInjectedAuthStyleProperty(sheet, 'transform', `translateY(${translate}px) scale(${1 - translate * 0.00045})`);
        };

        const handleDragEnd = () => {
            if (!dragState.active) return;
            if (dragState.deltaY > 64) {
                resetDragState();
                closeLoginModal();
            } else {
                resetDragState();
            }
        };

        dragTargets.forEach((target) => {
            target.addEventListener('touchstart', handleDragStart, { passive: true });
            target.addEventListener('touchmove', handleDragMove, { passive: true });
            target.addEventListener('touchend', handleDragEnd);
            target.addEventListener('touchcancel', resetDragState);
            target.addEventListener('mousedown', () => setDragHandleActive(true));
            target.addEventListener('mouseup', () => setDragHandleActive(false));
            target.addEventListener('mouseleave', () => setDragHandleActive(false));
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && overlay.classList.contains('active')) {
                closeLoginModal();
            }
        });

        window.addEventListener('resize', () => {
            if (!overlay.classList.contains('active')) return;
            syncAuthInputInteractionMode();
            scheduleActivePortaledInputPosition();
            syncTabIndicator(sheetState.view);
        });

        overlay.dataset.bound = '1';
    }

    function bindDropdownEvents() {
        const dropdown = document.getElementById('userDropdown');
        if (!dropdown || dropdown.dataset.bound === '1') return;

        dropdown.addEventListener('click', (event) => {
            const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
            if (!action) return;

            event.preventDefault();
            event.stopPropagation();

            if (action === 'notifications') {
                window.handleDropdownNotifClick?.(event);
                return;
            }

            if (action === 'language') {
                window.toggleLanguage?.(event);
                return;
            }

            if (action === 'theme') {
                window.toggleTheme?.(event);
                return;
            }

            closeDropdown();

            if (action === 'profile') {
                void window.ZaoyoeProfileModalBootstrap?.warm?.({ reason: 'profile-click' });
                window.openProfileModal?.(event);
            } else if (action === 'wallet') {
                void openInjectedAuthWalletView('balance', {
                    entry: 'nav_wallet',
                    sourceModule: 'auth_dropdown'
                });
            } else if (action === 'orders') {
                void openInjectedAuthWalletView('orders', {
                    entry: 'nav_orders',
                    sourceModule: 'auth_dropdown'
                });
            } else if (action === 'switch-account') {
                window.handleSwitchAccount?.(event);
            } else if (action === 'studio') {
                void window.AdminAccess?.openAdminStudio?.('admin-studio.html');
            } else if (action === 'logout') {
                window.handleLogout?.(event);
            }
        });

        dropdown.dataset.bound = '1';
    }

    function bindGlobalEvents() {
        const authBtn = document.getElementById('authBtn');
        if (authBtn && authBtn.dataset.bound !== '1') {
            authBtn.addEventListener('click', (event) => {
                if (typeof window.handleAuthClick === 'function') {
                    window.handleAuthClick(event);
                } else {
                    event.preventDefault();
                    event.stopPropagation();
                    openLoginModal().catch((error) => {
                        console.error('Failed to open auth sheet:', error);
                    });
                }
            });
            authBtn.dataset.bound = '1';
        }

        const dropdownOverlay = document.getElementById('dropdownOverlay');
        if (dropdownOverlay && dropdownOverlay.dataset.bound !== '1') {
            dropdownOverlay.addEventListener('click', closeDropdown);
            dropdownOverlay.dataset.bound = '1';
        }

        bindDropdownEvents();
        bindAuthSheetEvents();
    }

    function exposeAuthApi() {
        window.openLoginModal = openLoginModal;
        window.openLoginModalWithMessage = openLoginModalWithMessage;
        window.closeLoginModal = closeLoginModal;
        window.toggleLoginModal = toggleLoginModal;
        window.switchAuthView = function (viewId) {
            setAuthView(viewId).catch((error) => {
                console.warn('Failed to switch auth view:', error);
            });
        };
        window.showAuthMessage = showAuthMessage;
        window.clearAuthMessage = clearAuthMessage;
        window.setAuthGoogleDebugState = setAuthGoogleDebugState;
        window.clearAuthGoogleDebugState = clearAuthGoogleDebugState;
        window.setAuthFormLoading = setAuthFormLoading;
        window.isAuthModalOpen = function () {
            return !!document.getElementById('loginModal')?.classList.contains('active');
        };
    }

    exposeAuthApi();

    window.toggleTheme = function (event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const html = document.documentElement;
        const nextTheme = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', nextTheme);
        localStorage.setItem('theme', nextTheme);
        window.applySiteThemeChrome?.(nextTheme);
        window.syntheticThemeChromeMenuTap?.(nextTheme);
    };

    window.toggleLanguage = function (event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const langBtn = document.getElementById('dropdownLangBtn');
        if (langBtn) {
            const currentLang = getCurrentLanguageCode();
            langBtn.dataset.lang = currentLang === 'zh' ? 'en' : 'zh';
        }

        if (window.i18n?.toggleLanguage) {
            window.i18n.toggleLanguage();
            window.setTimeout(syncDropdownLanguageButton, 0);
        } else {
            syncDropdownLanguageButton();
        }
    };

    window.handleDropdownNotifClick = function (event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        closeDropdown();
        if (typeof window.toggleNotifMenu === 'function') {
            window.toggleNotifMenu(event);
            return;
        }

        const warmNotifications = window.ZaoyoeEngagementRuntimeBootstrap?.warmNotifications;
        if (typeof warmNotifications !== 'function') {
            return;
        }

        Promise.resolve(warmNotifications())
            .then(() => {
                if (typeof window.toggleNotifMenu === 'function') {
                    window.toggleNotifMenu();
                }
            })
            .catch((error) => {
                console.warn('⚠️ Failed to warm notification runtime:', error?.message || error);
            });
    };

    window.updateNotificationBadges = function (hasUnread) {
        const avatarBadge = document.getElementById('avatarUnreadBadge');
        const dropdownBadge = document.getElementById('dropdownNotifBadge');
        const dropdownButton = document.getElementById('dropdownNotifBtn');
        const entryLabel = hasUnread ? PERSONAL_MESSAGE_BUTTON_UNREAD_LABEL : PERSONAL_MESSAGE_BUTTON_LABEL;
        if (avatarBadge) avatarBadge.classList.toggle('is-visible', !!hasUnread);
        if (dropdownBadge) dropdownBadge.classList.toggle('is-visible', !!hasUnread);
        if (dropdownButton) {
            dropdownButton.setAttribute('aria-label', entryLabel);
            dropdownButton.setAttribute('title', entryLabel);
        }
    };

    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        const theme = savedTheme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        window.applySiteThemeChrome?.(theme);
    }

    function getCurrentLanguageCode() {
        const i18nLang = window.i18n?.getCurrentLanguage?.();
        const storedLang = localStorage.getItem('zaoyoe_language');
        const htmlLang = document.documentElement.lang;
        const rawLang = i18nLang || storedLang || htmlLang || 'zh';
        return String(rawLang).toLowerCase().startsWith('en') ? 'en' : 'zh';
    }

    function syncDropdownLanguageButton() {
        const langBtn = document.getElementById('dropdownLangBtn');
        if (!langBtn) return;

        const currentLang = getCurrentLanguageCode();
        langBtn.dataset.lang = currentLang;
        langBtn.setAttribute('aria-label', currentLang === 'zh' ? '切换到英文' : 'Switch to Chinese');
    }

    function initNotificationBadges() {
        if (window.NotificationManager?.getUnreadCount) {
            const count = window.NotificationManager.getUnreadCount();
            window.updateNotificationBadges(count > 0);
        }
    }

    function getInjectedAuthUserPresenceSessionIds(user = null) {
        const userId = String(user?.id || '').trim();
        if (!userId) return [];

        const email = String(user?.email || '').trim();
        return [...new Set([
            `user_${userId}`,
            email,
            email.toLowerCase()
        ].filter(Boolean))];
    }

    function getInjectedAuthGuestPresenceSessionId() {
        try {
            return String(localStorage.getItem('chat_session_id') || '').trim();
        } catch (_) {
            return '';
        }
    }

    async function syncInjectedAuthUserPresence() {
        const client = window.supabaseClient;
        if (!client?.auth?.getUser) return;

        try {
            const { data: { user } = {} } = await client.auth.getUser();
            if (user?.id) {
                const adminAccess = await window.AdminAccess?.getCurrentAdminAccess?.({
                    user,
                    supabaseClient: client,
                    forceRefresh: false
                });

                if (adminAccess?.isAdmin) {
                    window.ZaoyoeUserPresence?.stop?.();
                    return;
                }

                const sessionIds = getInjectedAuthUserPresenceSessionIds(user);
                window.ZaoyoeUserPresence?.start?.(client, {
                    user,
                    sessionId: sessionIds[0] || '',
                    sessionIds
                });
                return;
            }

            const guestSessionId = getInjectedAuthGuestPresenceSessionId();
            if (guestSessionId) {
                window.ZaoyoeUserPresence?.start?.(client, {
                    sessionId: guestSessionId,
                    sessionIds: [guestSessionId]
                });
            } else {
                window.ZaoyoeUserPresence?.stop?.();
            }
        } catch (error) {
            console.warn('[UserPresence] Failed to sync auth presence:', error?.message || error);
        }
    }

    function bindInjectedAuthUserPresenceEvents() {
        const client = window.supabaseClient;
        if (userPresenceAuthBound || !client?.auth?.onAuthStateChange) return;
        userPresenceAuthBound = true;

        client.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') {
                window.ZaoyoeUserPresence?.stop?.();
                return;
            }

            window.setTimeout(() => {
                void syncInjectedAuthUserPresence();
            }, 0);
        });
    }

    async function initAuth() {
        ensureStyles();
        ensureMarkup();
        initTheme();
        syncDropdownLanguageButton();

        try {
            await ensureSupportScript();
        } catch (error) {
            console.warn('⚠️ Failed to preload auth support script:', error?.message || error);
        }

        exposeAuthApi();

        bindGlobalEvents();
        bindInjectedAuthUserPresenceEvents();
        void syncInjectedAuthUserPresence();
        updateSheetCopy(sheetState.view);
        updateTabState(sheetState.view);

        if (window.i18n?.applyTranslations) {
            window.i18n.applyTranslations();
        }

        window.setTimeout(initNotificationBadges, 1200);
    }

    window.addEventListener('languageChanged', () => {
        syncDropdownLanguageButton();
        updateSheetCopy(sheetState.view);
        if (window.i18n?.applyTranslations) {
            window.i18n.applyTranslations();
        }
        refreshVisibleAuthMessageTranslation();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth, { once: true });
    } else {
        initAuth();
    }
})();
