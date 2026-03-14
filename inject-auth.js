(function () {
    'use strict';

    const AUTH_SHEET_CSS_HREF = './css/auth-sheet.css?v=20260314_AUTH_SHEET_REWRITE_1';
    const SUPPORT_SCRIPT_SRC = './script.js?v=20260313_PROFILE_MODAL_DOCK_1';
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
            titleFallback: '欢迎回来',
            subtitleKey: 'auth.loginSubtitle',
            subtitleFallback: '请输入您的账号信息以登录'
        },
        register: {
            titleKey: 'auth.createAccount',
            titleFallback: '创建账号',
            subtitleKey: 'auth.registerSubtitle',
            subtitleFallback: '加入我们以获取更多高级功能'
        },
        reset: {
            titleKey: 'auth.resetPassword',
            titleFallback: '找回密码',
            subtitleKey: 'auth.resetSubtitle',
            subtitleFallback: '请输入您的注册邮箱以重置密码'
        }
    };

    let emailJsPromise = null;
    let supportScriptPromise = null;
    let overlayCloseDisabledUntil = 0;
    const sheetState = {
        view: 'login',
        lastPrimaryView: 'login'
    };
    const keyboardState = {
        attached: false,
        baseViewportHeight: 0,
        isKeyboardOpen: false
    };
    const dragState = {
        active: false,
        startY: 0,
        deltaY: 0
    };

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
                        <span class="lang-icon lang-zh">文</span>
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

    function buildAuthSheetHTML() {
        return `
            <div id="loginModal" class="auth-sheet-overlay login-overlay" hidden aria-hidden="true">
                <div class="auth-sheet-backdrop" data-auth-backdrop></div>
                <section class="auth-sheet" role="dialog" aria-modal="true" aria-labelledby="authSheetTitle">
                    <div class="auth-sheet-shell">
                        <div class="auth-sheet-drag-zone" data-auth-drag-zone>
                            <div class="auth-sheet-handle" aria-hidden="true"></div>
                        </div>

                        <header class="auth-sheet-header">
                            <p class="auth-sheet-overline">ZAOYOE STUDIO</p>
                            <h2 id="authSheetTitle" class="auth-sheet-title">${t('auth.welcomeBack', '欢迎回来')}</h2>
                            <p id="authSheetSubtitle" class="auth-sheet-subtitle">${t('auth.loginSubtitle', '请输入您的账号信息以登录')}</p>

                            <div class="auth-sheet-badges">
                                <span class="auth-sheet-badge">
                                    <i class="fas fa-shield-heart"></i>
                                    <span data-i18n="security.title">安全设置</span>
                                </span>
                                <span class="auth-sheet-badge">
                                    <i class="fas fa-box-open"></i>
                                    <span data-i18n="wallet.myOrders">我的订单</span>
                                </span>
                            </div>
                        </header>

                        <nav id="authSheetTabs" class="auth-sheet-tabs" aria-label="Authentication views">
                            <button type="button" class="auth-sheet-tab is-active" data-auth-tab="login" data-i18n="common.login">登录</button>
                            <button type="button" class="auth-sheet-tab" data-auth-tab="register" data-i18n="auth.register">注册</button>
                        </nav>

                        <div id="authSheetMessage" class="auth-sheet-message" hidden role="status" aria-live="polite"></div>

                        <div class="auth-sheet-body">
                            <section id="loginView" class="auth-sheet-view is-active" data-auth-view="login">
                                <button type="button" class="auth-sheet-google-btn google-login-btn" data-auth-google>
                                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" height="18">
                                    <span data-i18n="auth.googleLogin">使用 Google 登录</span>
                                </button>

                                <div class="auth-sheet-divider">
                                    <span data-i18n="auth.or">或者</span>
                                </div>

                                <form id="loginForm" class="auth-sheet-form" autocomplete="on" novalidate>
                                    <label class="auth-sheet-field">
                                        <span class="auth-sheet-label">Email</span>
                                        <input type="email" id="login-email" class="auth-sheet-input" placeholder="${t('auth.emailPlaceholder', '邮箱地址')}" data-i18n-placeholder="auth.emailPlaceholder" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" required>
                                    </label>

                                    <label class="auth-sheet-field">
                                        <span class="auth-sheet-label" data-i18n="auth.passwordPlaceholder">密码</span>
                                        <input type="password" id="login-password" class="auth-sheet-input" placeholder="${t('auth.passwordPlaceholder', '密码')}" data-i18n-placeholder="auth.passwordPlaceholder" autocomplete="current-password" required>
                                    </label>
                                </form>

                                <div class="auth-sheet-inline-row auth-sheet-inline-row--spread">
                                    <label class="auth-sheet-check">
                                        <input type="checkbox" id="rememberMe">
                                        <span data-i18n="auth.rememberMe">记住密码</span>
                                    </label>
                                    <button type="button" class="auth-sheet-link" data-auth-reset data-i18n="auth.forgotPassword">忘记密码？</button>
                                </div>

                                <button type="submit" class="auth-sheet-submit login-submit-btn" data-auth-submit="login" form="loginForm" data-i18n="common.login">登录</button>

                                <p class="auth-sheet-switch">
                                    <span data-i18n="auth.noAccountYet">还没有账号？</span>
                                    <button type="button" class="auth-sheet-link auth-sheet-switch-link" data-auth-tab="register" data-i18n="auth.signUpNow">立即注册</button>
                                </p>
                            </section>

                            <section id="registerView" class="auth-sheet-view" data-auth-view="register" hidden>
                                <p class="auth-sheet-note" data-i18n="auth.registerSubtitle">加入我们以获取更多高级功能</p>

                                <form id="registerForm" class="auth-sheet-form" autocomplete="off" novalidate>
                                    <label class="auth-sheet-field">
                                        <span class="auth-sheet-label" data-i18n="auth.usernamePlaceholder">用户名</span>
                                        <input type="text" id="reg-username" class="auth-sheet-input" placeholder="${t('auth.usernamePlaceholder', '用户名')}" data-i18n-placeholder="auth.usernamePlaceholder" autocomplete="off" required>
                                    </label>

                                    <label class="auth-sheet-field">
                                        <span class="auth-sheet-label">Email</span>
                                        <input type="email" id="reg-email" class="auth-sheet-input" placeholder="${t('auth.emailPlaceholder', '邮箱地址')}" data-i18n-placeholder="auth.emailPlaceholder" autocomplete="off" required>
                                    </label>

                                    <div class="auth-sheet-inline-group">
                                        <label class="auth-sheet-field">
                                            <span class="auth-sheet-label" data-i18n="auth.enterVerifyCode">输入6位验证码</span>
                                            <input type="text" id="reg-code" class="auth-sheet-input" placeholder="${t('auth.enterVerifyCode', '输入6位验证码')}" data-i18n-placeholder="auth.enterVerifyCode" maxlength="6" autocomplete="off" required>
                                        </label>
                                        <button type="button" class="auth-sheet-secondary verify-code-btn" id="sendBtn" data-auth-send-code data-i18n="auth.getVerifyCode">获取验证码</button>
                                    </div>

                                    <label class="auth-sheet-field">
                                        <span class="auth-sheet-label" data-i18n="auth.setPassword">设置密码</span>
                                        <input type="password" id="reg-password" class="auth-sheet-input" placeholder="${t('auth.setPassword', '设置密码')}" data-i18n-placeholder="auth.setPassword" autocomplete="new-password" required>
                                    </label>

                                    <label class="auth-sheet-check auth-sheet-check--start">
                                        <input type="checkbox" id="privacyConsent">
                                        <span>
                                            <span data-i18n="auth.agreeToTerms">我已阅读并同意</span>
                                            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" data-i18n="auth.privacyPolicy">隐私政策</a>
                                        </span>
                                    </label>
                                </form>

                                <button type="submit" class="auth-sheet-submit login-submit-btn" data-auth-submit="register" form="registerForm" data-i18n="auth.createAccount">创建账号</button>

                                <p class="auth-sheet-switch">
                                    <span data-i18n="auth.hasAccount">已有账号？</span>
                                    <button type="button" class="auth-sheet-link auth-sheet-switch-link" data-auth-tab="login" data-i18n="auth.loginNow">直接登录</button>
                                </p>
                            </section>

                            <section id="resetView" class="auth-sheet-view" data-auth-view="reset" hidden>
                                <p class="auth-sheet-note" data-i18n="auth.resetSubtitle">请输入您的注册邮箱以重置密码</p>

                                <form id="resetForm" class="auth-sheet-form" novalidate>
                                    <label class="auth-sheet-field">
                                        <span class="auth-sheet-label">Email</span>
                                        <input type="email" id="reset-email" class="auth-sheet-input" placeholder="${t('auth.emailPlaceholder', '邮箱地址')}" data-i18n-placeholder="auth.emailPlaceholder" autocomplete="email" required>
                                    </label>
                                </form>

                                <button type="submit" class="auth-sheet-submit login-submit-btn" data-auth-submit="reset" form="resetForm" data-i18n="auth.recover">找回</button>

                                <p class="auth-sheet-switch">
                                    <button type="button" class="auth-sheet-link auth-sheet-switch-link" data-auth-tab="login" data-i18n="auth.backToLogin">返回登录</button>
                                </p>
                            </section>
                        </div>
                    </div>
                </section>
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

    function getSheetElements() {
        const overlay = document.getElementById('loginModal');
        return {
            overlay,
            sheet: overlay?.querySelector('.auth-sheet') || null,
            tabs: overlay?.querySelector('#authSheetTabs') || null,
            title: overlay?.querySelector('#authSheetTitle') || null,
            subtitle: overlay?.querySelector('#authSheetSubtitle') || null,
            message: overlay?.querySelector('#authSheetMessage') || null,
            body: overlay?.querySelector('.auth-sheet-body') || null
        };
    }

    function getActiveAuthInput() {
        const { overlay } = getSheetElements();
        const active = document.activeElement;
        if (!overlay || !active || !overlay.contains(active)) return null;
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
    }

    function isKeyboardDockEnabled() {
        const ua = navigator.userAgent || '';
        const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isIOS && window.matchMedia('(max-width: 768px)').matches && !!window.visualViewport;
    }

    function handleViewportChange() {
        if (!isKeyboardDockEnabled()) return;

        const { overlay, body } = getSheetElements();
        const vv = window.visualViewport;
        if (!overlay || !body || !vv) return;

        if (keyboardState.baseViewportHeight === 0 || !keyboardState.isKeyboardOpen) {
            keyboardState.baseViewportHeight = Math.max(keyboardState.baseViewportHeight, vv.height);
        }

        const heightDiff = keyboardState.baseViewportHeight - vv.height;
        const activeInput = getActiveAuthInput();
        const isKeyboardOpen = heightDiff > 50 && !!activeInput;
        keyboardState.isKeyboardOpen = isKeyboardOpen;

        if (isKeyboardOpen) {
            const actualOverlap = keyboardState.baseViewportHeight - (vv.height + vv.offsetTop);
            const bottomInset = Math.max(0, actualOverlap);
            overlay.style.setProperty('--auth-sheet-keyboard-offset', `${bottomInset}px`);

            window.setTimeout(() => {
                activeInput?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 40);
        } else {
            overlay.style.setProperty('--auth-sheet-keyboard-offset', '0px');
            keyboardState.baseViewportHeight = Math.max(keyboardState.baseViewportHeight, vv.height);
        }
    }

    function attachKeyboardDock() {
        if (!isKeyboardDockEnabled() || keyboardState.attached) return;
        const vv = window.visualViewport;
        const { overlay } = getSheetElements();
        if (!vv || !overlay) return;

        keyboardState.baseViewportHeight = vv.height;
        vv.addEventListener('resize', handleViewportChange, { passive: true });
        vv.addEventListener('scroll', handleViewportChange, { passive: true });
        overlay.addEventListener('focusin', handleViewportChange);
        overlay.addEventListener('focusout', onSheetFocusOut);
        keyboardState.attached = true;
    }

    function onSheetFocusOut() {
        window.setTimeout(handleViewportChange, 100);
    }

    function detachKeyboardDock() {
        if (!keyboardState.attached) return;
        const vv = window.visualViewport;
        const { overlay, sheet } = getSheetElements();

        if (vv) {
            vv.removeEventListener('resize', handleViewportChange);
            vv.removeEventListener('scroll', handleViewportChange);
        }

        if (overlay) {
            overlay.removeEventListener('focusin', handleViewportChange);
            overlay.removeEventListener('focusout', onSheetFocusOut);
        }

        overlay?.style.setProperty('--auth-sheet-keyboard-offset', '0px');
        sheet?.style.removeProperty('transform');
        keyboardState.attached = false;
        keyboardState.baseViewportHeight = 0;
        keyboardState.isKeyboardOpen = false;
    }

    function updateSheetCopy(viewId) {
        const meta = VIEW_META[viewId] || VIEW_META.login;
        const { title, subtitle, tabs } = getSheetElements();
        if (title) title.textContent = t(meta.titleKey, meta.titleFallback);
        if (subtitle) subtitle.textContent = t(meta.subtitleKey, meta.subtitleFallback);
        if (tabs) tabs.hidden = viewId === 'reset';
    }

    function updateTabState(viewId) {
        document.querySelectorAll('#loginModal [data-auth-tab]').forEach((button) => {
            const isActive = button.dataset.authTab === viewId;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    async function setAuthView(viewId, options = {}) {
        const { clearMessage = true, ensureDependencies = true } = options;
        const { overlay, body } = getSheetElements();
        if (!overlay || !body) return;

        if (!VIEW_META[viewId]) {
            viewId = 'login';
        }

        if (ensureDependencies && viewId === 'register') {
            try {
                await ensureRegisterDependencies();
            } catch (error) {
                console.warn('⚠️ Failed to prepare register dependencies:', error?.message || error);
            }
        }

        document.querySelectorAll('#loginModal [data-auth-view]').forEach((view) => {
            const isActive = view.dataset.authView === viewId;
            view.hidden = !isActive;
            view.classList.toggle('is-active', isActive);
        });

        if (PRIMARY_VIEWS.has(viewId)) {
            sheetState.lastPrimaryView = viewId;
        }

        sheetState.view = viewId;
        updateSheetCopy(viewId);
        updateTabState(viewId);

        if (clearMessage) {
            clearAuthMessage();
        }

        body.scrollTop = 0;
        keyboardState.baseViewportHeight = 0;
        if (keyboardState.attached) {
            handleViewportChange();
        }
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
        const rightOffset = Math.max(10, window.innerWidth - rect.right);

        dropdown.style.setProperty('right', `${rightOffset}px`, 'important');
        dropdown.style.setProperty('top', `${navBottom - 1}px`, 'important');
        dropdown.classList.add('active');
        dropdown.setAttribute('aria-hidden', 'false');
        overlay?.classList.add('active');
        authBtn.setAttribute('aria-expanded', 'true');

        if (window.WalletModal?.prefetchData) {
            window.WalletModal.prefetchData();
        }
    }

    function closeDropdown() {
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

        await setAuthView(viewId, { clearMessage: true });
        overlay.hidden = false;
        overlay.style.removeProperty('display');
        overlay.style.removeProperty('visibility');
        overlay.style.removeProperty('opacity');

        window.requestAnimationFrame(() => {
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
        });

        document.body.classList.add('auth-sheet-open');
        if (window.iOSScrollLock) {
            window.iOSScrollLock.lock(overlay);
        }

        overlayCloseDisabledUntil = Date.now() + 240;
        attachKeyboardDock();

        if (typeof window.ensureGoogleInlineButtonReady === 'function') {
            window.ensureGoogleInlineButtonReady({ renderFallbackButton: true }).catch((error) => {
                console.warn('⚠️ ensureGoogleInlineButtonReady failed:', error?.message || error);
            });
        }
    }

    function closeLoginModal() {
        const { overlay, sheet } = getSheetElements();
        if (!overlay) return;

        getActiveAuthInput()?.blur();
        clearAuthMessage();
        detachKeyboardDock();
        dragState.active = false;
        dragState.startY = 0;
        dragState.deltaY = 0;
        sheet?.style.removeProperty('transform');

        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('auth-sheet-open');

        window.setTimeout(() => {
            if (!overlay.classList.contains('active')) {
                overlay.hidden = true;
                overlay.style.setProperty('--auth-sheet-keyboard-offset', '0px');
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

        const activeInput = getActiveAuthInput();
        if (activeInput) {
            activeInput.blur();
            overlayCloseDisabledUntil = now + 160;
            return;
        }

        closeLoginModal();
    }

    function bindAuthSheetEvents() {
        const overlay = document.getElementById('loginModal');
        if (!overlay || overlay.dataset.bound === '1') return;

        overlay.addEventListener('click', (event) => {
            const tabTrigger = event.target.closest('[data-auth-tab]');
            if (tabTrigger) {
                setAuthView(tabTrigger.dataset.authTab).catch((error) => {
                    console.warn('Failed to switch auth view:', error);
                });
                return;
            }

            if (event.target.closest('[data-auth-reset]')) {
                setAuthView('reset').catch((error) => {
                    console.warn('Failed to open reset view:', error);
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
                        showAuthMessage('验证码能力加载失败，请稍后重试。');
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

        const dragTargets = overlay.querySelectorAll('[data-auth-drag-zone], .auth-sheet-header');
        const resetDragState = () => {
            const { sheet } = getSheetElements();
            sheet?.style.removeProperty('transform');
            dragState.active = false;
            dragState.startY = 0;
            dragState.deltaY = 0;
        };

        const handleDragStart = (event) => {
            if (event.touches.length !== 1) return;
            dragState.active = true;
            dragState.startY = event.touches[0].clientY;
            dragState.deltaY = 0;
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
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && overlay.classList.contains('active')) {
                closeLoginModal();
            }
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
                window.location.href = 'admin-studio.html';
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

        if (window.i18n?.toggleLanguage) {
            window.i18n.toggleLanguage();
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
