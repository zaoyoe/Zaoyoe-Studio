(function () {
    'use strict';

    const AUTH_SHEET_CSS_HREF = './css/auth-sheet.css?v=20260316_AUTH_CHAT_MATCH_38';
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
    function t(key, fallback) {
        return window.i18n?.t(key, fallback) || fallback;
    }

    function isGeneratedAvatarUrl(url) {
        return /ui-avatars\.com|dicebear\.com/i.test(String(url || ''));
    }

    function isTransientAvatarUrl(url) {
        return /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(String(url || ''));
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
        const avatarUrl = profile?.avatarUrl || '';
        const defaultIconDisplay = (isLoggedIn && avatarUrl) ? 'none' : 'inline';
        const avatarDisplay = (isLoggedIn && avatarUrl) ? 'inline-block' : 'none';
        const avatarOpacity = (isLoggedIn && avatarUrl) ? '1' : '0';
        const label = isLoggedIn ? 'Open account menu' : 'Open sign in panel';

        return `
            <button id="authBtn" class="login-trigger-btn${isLoggedIn ? ' logged-in' : ''}" type="button" aria-label="${label}">
                <i id="defaultAuthIcon" class="fas fa-user-circle" style="display: ${defaultIconDisplay};"></i>
                <img id="navUserAvatar" class="nav-user-avatar show" src="${avatarUrl}" alt="Avatar" style="display: ${avatarDisplay}; opacity: ${avatarOpacity};">
                <span id="authBtnText" style="display: none;">Sign In</span>
                <span id="avatarUnreadBadge" class="avatar-unread-badge" style="display: none;"></span>
            </button>
        `;
    }

    function buildDropdownHTML() {
        return `
            <div id="userDropdown" class="avatar-dropdown" style="z-index: 2100;" aria-hidden="true">
                <div class="dropdown-header">
                    <button type="button" class="dropdown-notif-btn" id="dropdownNotifBtn" data-auth-action="notifications">
                        <i class="far fa-bell"></i>
                        <span id="dropdownNotifBadge" class="dropdown-notif-badge" style="display: none;"></span>
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
                    <button type="button" class="dropdown-action" id="enterStudioBtn" style="display: none;" data-auth-action="studio">
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
            <div id="loginModal" class="auth-sheet-overlay login-overlay" hidden aria-hidden="true">
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
                                    <button type="button" class="auth-sheet-google-btn google-login-btn" data-auth-google>
                                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" height="18">
                                        <span data-i18n="auth.googleLogin">使用 Google 登录</span>
                                    </button>

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
                                                inputAttributes: 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-auth-form="loginForm" required'
                                            })}
                                        </div>

                                        <div class="auth-sheet-field">
                                            <span class="auth-sheet-label" data-i18n="auth.passwordPlaceholder">密码</span>
                                            ${buildPortaledInputControlHTML({
                                                id: 'login-password',
                                                type: 'password',
                                                placeholder: t('auth.passwordPlaceholder', '密码'),
                                                placeholderKey: 'auth.passwordPlaceholder',
                                                inputAttributes: 'autocomplete="new-password" data-auth-form="loginForm" required'
                                            })}
                                        </div>
                                    </form>

                                    <div class="auth-sheet-inline-row auth-sheet-inline-row--spread">
                                        <label class="auth-sheet-check">
                                            <input type="checkbox" id="rememberMe">
                                            <span data-i18n="auth.rememberMe">记住密码</span>
                                        </label>
                                        <button type="button" class="auth-sheet-link" data-auth-reset data-i18n="auth.forgotPassword">忘记密码？</button>
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

    function ensureStyles() {
        removeLegacyLoginStyles();

        if (!document.querySelector(`link[href^="${AUTH_SHEET_CSS_HREF.split('?')[0]}"]`)) {
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
            body: overlay?.querySelector('.auth-sheet-body') || null,
            plane: overlay?.querySelector('#authInputPlane') || null
        };
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
        input.style.removeProperty('position');
        input.style.removeProperty('left');
        input.style.removeProperty('top');
        input.style.removeProperty('width');
        input.style.removeProperty('height');
        input.style.removeProperty('margin');
        input.style.removeProperty('z-index');
        input.style.removeProperty('pointer-events');
        input.style.removeProperty('right');
        input.style.removeProperty('bottom');
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

            input.style.position = 'absolute';
            input.style.left = `${rect.left - offsetParentRect.left}px`;
            input.style.top = `${rect.top - offsetParentRect.top}px`;
            input.style.width = `${rect.width}px`;
            input.style.height = `${rect.height}px`;
            input.style.margin = '0';
            input.style.zIndex = '2';
            input.style.pointerEvents = 'auto';
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

        input.style.position = 'fixed';
        input.style.left = `${rect.left}px`;
        input.style.top = `${rect.top}px`;
        input.style.width = `${rect.width}px`;
        input.style.height = `${rect.height}px`;
        input.style.margin = '0';
        input.style.zIndex = '12091';
        input.style.pointerEvents = isVisible ? 'auto' : 'none';
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
                input.focus({ preventScroll: true });
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
            indicator.style.width = `${activeButton.offsetWidth}px`;
            indicator.style.transform = `translateX(${activeButton.offsetLeft}px)`;
        };

        if (immediate) {
            applyPosition();
            return;
        }

        window.requestAnimationFrame(applyPosition);
    }

    function syncPrimaryViewHeights() {
        const { overlay, body } = getSheetElements();
        if (!overlay || !body) return;

        const primaryViews = Array.from(overlay.querySelectorAll('.auth-sheet-view--primary'));
        if (!primaryViews.length) return;

        let maxHeight = 0;
        primaryViews.forEach((view) => {
            const clone = view.cloneNode(true);
            clone.hidden = false;
            clone.classList.add('is-active');
            clone.style.position = 'absolute';
            clone.style.left = '0';
            clone.style.top = '0';
            clone.style.width = '100%';
            clone.style.visibility = 'hidden';
            clone.style.pointerEvents = 'none';
            clone.style.display = 'flex';
            clone.style.minHeight = '0';
            clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
            body.appendChild(clone);
            maxHeight = Math.max(maxHeight, Math.ceil(clone.getBoundingClientRect().height));
            clone.remove();
        });

        if (maxHeight > 0) {
            body.style.setProperty('--auth-primary-view-min-height', `${maxHeight + 12}px`);
        }
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
        const { overlay, body } = getSheetElements();
        if (!overlay || !body) return;

        if (!VIEW_META[viewId]) {
            viewId = 'login';
        }

        if (ensureDependencies && viewId === 'register') {
            warmRegisterDependencies();
        }

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
        overlay.classList.toggle('auth-sheet-primary-mode', PRIMARY_VIEWS.has(viewId));
        updateSheetCopy(viewId);
        updateTabState(viewId, { immediate: !overlay.classList.contains('active') });

        if (clearMessage) {
            clearAuthMessage();
        }

        body.scrollTop = 0;
    }

    function showAuthMessage(message, type = 'error', targetView) {
        const { overlay, message: messageBox } = getSheetElements();
        if (!messageBox || !overlay?.classList.contains('active')) return false;

        if (targetView && VIEW_META[targetView]) {
            setAuthView(targetView, { clearMessage: false }).catch(() => { /* ignore */ });
        }

        messageBox.hidden = false;
        messageBox.textContent = message;
        messageBox.classList.remove('is-error', 'is-success');
        messageBox.classList.add(type === 'success' ? 'is-success' : 'is-error');
        return true;
    }

    function clearAuthMessage() {
        const { message } = getSheetElements();
        if (!message) return;
        message.hidden = true;
        message.textContent = '';
        message.classList.remove('is-error', 'is-success');
    }

    function resetAuthSheetFields(options = {}) {
        const { preserveView = false } = options;
        const overlay = document.getElementById('loginModal');
        if (!overlay) return;

        deactivateActivePortaledInput({ blur: false });
        getActiveAuthInput()?.blur();
        clearAuthMessage();

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
        }
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

        dropdown.style.setProperty('right', `${rightOffset}px`, 'important');
        dropdown.style.setProperty('top', `${navBottom - navOverlap}px`, 'important');
        dropdown.classList.add('active');
        dropdown.setAttribute('aria-hidden', 'false');
        overlay?.classList.add('active');
        authBtn.setAttribute('aria-expanded', 'true');

        if (window.WalletModal?.prefetchData) {
            window.WalletModal.prefetchData();
        }
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

    async function openLoginModal(viewId = sheetState.lastPrimaryView || 'login') {
        ensureMarkup();
        ensureStyles();

        const { overlay } = getSheetElements();
        if (!overlay) return;

        syncAuthInputInteractionMode();
        resetAuthSheetFields({ preserveView: true });

        overlay.hidden = false;
        overlay.style.removeProperty('display');
        overlay.style.removeProperty('visibility');
        overlay.style.removeProperty('opacity');
        overlay.classList.remove('auth-sheet-input-active');
        await setAuthView(viewId, { clearMessage: true });
        syncAllInputProxyDisplays();
        syncPrimaryViewHeights();
        syncTabIndicator(sheetState.view, { immediate: true });

        window.requestAnimationFrame(() => {
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
        });

        window.setTimeout(() => {
            if (!overlay.classList.contains('active')) return;
            resetAuthSheetFields({ preserveView: true });
            setAuthView(viewId, { clearMessage: true, ensureDependencies: false }).catch(() => { /* ignore */ });
        }, 80);

        document.body.classList.add('auth-sheet-open');
        if (typeof window.__forcePromptThemeColorBlack === 'function') {
            window.__forcePromptThemeColorBlack();
        }
        if (window.iOSScrollLock) {
            window.iOSScrollLock.lock(overlay);
        }

        overlayCloseDisabledUntil = Date.now() + 240;
        warmRegisterDependencies();

        if (typeof window.ensureGoogleInlineButtonReady === 'function') {
            window.ensureGoogleInlineButtonReady({ renderFallbackButton: true }).catch((error) => {
                console.warn('⚠️ ensureGoogleInlineButtonReady failed:', error?.message || error);
            });
        }
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
        sheet?.style.removeProperty('transform');

        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('auth-sheet-open');
        if (typeof window.__forcePromptThemeColorBlack === 'function') {
            window.__forcePromptThemeColorBlack();
        }

        window.setTimeout(() => {
            if (!overlay.classList.contains('active')) {
                overlay.hidden = true;
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
            clearAuthMessage();
            window.handleLogin?.(event);
        });

        overlay.querySelector('#registerForm')?.addEventListener('submit', (event) => {
            clearAuthMessage();
            window.handleRegister?.(event);
        });

        overlay.querySelector('#resetForm')?.addEventListener('submit', (event) => {
            clearAuthMessage();
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
            sheet?.style.removeProperty('transform');
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
                sheet.style.removeProperty('transform');
                return;
            }

            const translate = Math.min(112, dragState.deltaY);
            sheet.style.transform = `translateY(${translate}px) scale(${1 - translate * 0.00045})`;
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
            syncPrimaryViewHeights();
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
                window.openProfileModal?.(event);
            } else if (action === 'wallet') {
                window.WalletModal?.open();
            } else if (action === 'orders') {
                window.WalletModal?.open('orders');
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
        window.closeLoginModal = closeLoginModal;
        window.toggleLoginModal = toggleLoginModal;
        window.switchAuthView = function (viewId) {
            setAuthView(viewId).catch((error) => {
                console.warn('Failed to switch auth view:', error);
            });
        };
        window.showAuthMessage = showAuthMessage;
        window.clearAuthMessage = clearAuthMessage;
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
        }
    };

    window.updateNotificationBadges = function (hasUnread) {
        const avatarBadge = document.getElementById('avatarUnreadBadge');
        const dropdownBadge = document.getElementById('dropdownNotifBadge');
        if (avatarBadge) avatarBadge.style.display = hasUnread ? 'block' : 'none';
        if (dropdownBadge) dropdownBadge.style.display = hasUnread ? 'inline-block' : 'none';
    };

    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark');
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
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth, { once: true });
    } else {
        initAuth();
    }
})();
