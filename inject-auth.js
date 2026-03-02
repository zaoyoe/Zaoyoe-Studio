(function () {
    console.log('🔧 Injecting Auth UI...');

    // 🆕 Check for cached user profile to prevent avatar flashing
    let cachedProfile = null;
    try {
        const cached = localStorage.getItem('cached_user_profile');
        if (cached) cachedProfile = JSON.parse(cached);
    } catch (e) { /* ignore */ }

    const isLoggedIn = !!cachedProfile;
    const avatarUrl = cachedProfile?.avatarUrl || '';
    const defaultIconDisplay = isLoggedIn ? 'none' : 'inline';
    const avatarDisplay = isLoggedIn ? 'inline-block' : 'none';
    const avatarOpacity = isLoggedIn ? '1' : '0';

    // 1. Define HTML Structure - SEPARATED for flexible injection
    // Auth Button ONLY (will be injected into #auth-container if available)
    const authButtonOnlyHTML = `
        <button id="authBtn" class="login-trigger-btn${isLoggedIn ? ' logged-in' : ''}" onclick="handleAuthClick(event)">
            <i id="defaultAuthIcon" class="fas fa-user-circle" style="display: ${defaultIconDisplay};"></i>
            <img id="navUserAvatar" class="nav-user-avatar show" src="${avatarUrl}" alt="Avatar" style="display: ${avatarDisplay}; opacity: ${avatarOpacity};">
            <span id="authBtnText" style="display: none;">Sign In</span>
            <!-- Unread notification badge on avatar -->
            <span id="avatarUnreadBadge" class="avatar-unread-badge" style="display: none;"></span>
        </button>
    `;

    // Avatar Dropdown (ALWAYS appended to body for proper backdrop-filter)
    const dropdownHTML = `
        <!-- Avatar Dropdown -->
        <div id="userDropdown" class="avatar-dropdown" style="z-index: 2100;">
            <div class="dropdown-header">
                <button class="dropdown-notif-btn" id="dropdownNotifBtn" onclick="window.handleDropdownNotifClick(event)">
                    <i class="far fa-bell"></i>
                    <span id="dropdownNotifBadge" class="dropdown-notif-badge" style="display: none;"></span>
                </button>
                <button class="dropdown-lang-btn" id="dropdownLangBtn" onclick="window.toggleLanguage(event)">
                    <span class="lang-icon lang-zh">文</span>
                    <span class="lang-icon lang-en">A</span>
                </button>
                <button class="theme-toggle-btn" onclick="window.toggleTheme(event)">
                    <span class="theme-icon sun-icon">☀️</span>
                    <span class="theme-icon moon-icon">🌙</span>
                </button>
            </div>
            
            <div class="dropdown-actions">
                <button class="dropdown-action" onclick="window.openProfileModal(event)">
                    <i class="fas fa-user"></i>
                    <span data-i18n="common.profile">个人资料</span>
                </button>
                <button class="dropdown-action" onclick="WalletModal.open()">
                    <i class="fas fa-wallet"></i>
                    <span data-i18n="wallet.title">我的钱包</span>
                </button>
                <button class="dropdown-action" onclick="WalletModal.open('orders')">
                    <i class="fas fa-box-open"></i>
                    <span data-i18n="wallet.myOrders">我的订单</span>
                </button>
                <button class="dropdown-action" onclick="window.handleSwitchAccount(event)">
                    <i class="fas fa-exchange-alt"></i>
                    <span data-i18n="auth.switchAccount">切换账户</span>
                </button>
                <button class="dropdown-action" id="enterStudioBtn" style="display: none;" onclick="window.location.href='admin-studio.html'">
                     <i class="fas fa-palette"></i>
                     <span data-i18n="admin.enterStudio">Enter Studio</span>
                </button>
                <button class="dropdown-action" onclick="window.handleLogout(event)">
                    <i class="fas fa-sign-out-alt"></i>
                    <span data-i18n="common.logout">退出登录</span>
                </button>
            </div>
        </div>
    `;

    // Legacy wrapper for pages without #auth-container (button + dropdown together)
    const authWrapperHTML = `
    <!-- Auth Button (Top Right) - Legacy Fixed Position -->
    <div class="top-right-nav" style="position: fixed; top: 28px; right: 30px; z-index: 2100; display: flex; align-items: center; gap: 16px;">
        ${authButtonOnlyHTML}
    </div>
    `;

    // Login Modal (always appended to body)
    const loginModalHTML = `
    <!-- Login Modal -->
    <div class="login-overlay" id="loginModal" style="display: none; opacity: 0; visibility: hidden;" onmousedown="handleLoginOverlayClick(event)" onmouseup="handleLoginOverlayClick(event)">
        <div class="login-card" onclick="event.stopPropagation()">
            <!-- Mac Window Controls -->
            <div class="mac-controls">
                <div class="mac-dot red" onclick="toggleLoginModal()">
                    <i class="fas fa-times"></i>
                </div>
                <div class="mac-dot yellow"></div>
                <div class="mac-dot green"></div>
            </div>

            <!-- Login View -->
            <div id="loginView" class="form-view">
                <h2 class="card-title" data-i18n="auth.welcomeBack">欢迎回来</h2>
                <p class="card-subtitle" data-i18n="auth.loginSubtitle">请输入您的账号信息以登录</p>

                <!-- Google Login Button -->
                <button type="button" class="google-login-btn" onclick="triggerGoogleLogin()">
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" height="18">
                    <span data-i18n="auth.googleLogin">使用 Google 登录</span>
                </button>

                <!-- Divider -->
                <div class="login-divider">
                    <span data-i18n="auth.or">或者</span>
                </div>

                <form id="loginForm" onsubmit="handleLogin(event)" autocomplete="off">
                    <div class="input-group">
                        <input type="email" id="login-email" class="glass-input" placeholder="邮箱地址" data-i18n-placeholder="auth.emailPlaceholder" required>
                    </div>
                    <div class="input-group">
                        <input type="password" id="login-password" class="glass-input" placeholder="密码" data-i18n-placeholder="auth.passwordPlaceholder" autocomplete="new-password" data-form-type="other" required>
                    </div>

                    <!-- Forgot Password Link -->
                    <div style="text-align: right; margin-bottom: 16px;">
                        <span class="forgot-password-link" onclick="switchAuthView('reset')" data-i18n="auth.forgotPassword">忘记密码了吗？</span>
                    </div>

                    <!-- Remember Me Checkbox -->
                    <div class="checkbox-wrapper" style="margin-bottom: 24px; display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.7); font-size: 13px;">
                        <input type="checkbox" id="rememberMe" class="custom-checkbox" style="width: 16px; height: 16px; accent-color: #9b5de5; cursor: pointer;">
                        <label for="rememberMe" style="cursor: pointer;" data-i18n="auth.rememberMe">记住密码</label>
                    </div>

                    <button type="submit" class="login-submit-btn" data-i18n="common.login">登录</button>
                </form>

                <div class="switch-text">
                    <span data-i18n="auth.noAccount">还没有账号？</span>
                    <span class="switch-link" onclick="switchAuthView('register')" data-i18n="auth.signUpNow">立即注册</span>
                </div>
            </div>

            <!-- Register View -->
            <div id="registerView" class="form-view hidden">
                <h2 class="card-title" data-i18n="auth.createAccount">创建账号</h2>
                <p class="card-subtitle" data-i18n="auth.registerSubtitle">加入我们以获取更多高级功能</p>

                <form id="registerForm" onsubmit="handleRegister(event)" autocomplete="off">
                    <div class="input-group">
                        <input type="text" id="reg-username" class="glass-input" placeholder="用户名" data-i18n-placeholder="auth.usernamePlaceholder" autocomplete="off" data-form-type="other" required>
                    </div>

                    <div class="input-group">
                        <input type="text" id="reg-email" class="glass-input" placeholder="邮箱地址" data-i18n-placeholder="auth.emailPlaceholder" autocomplete="off" data-form-type="other" required>
                    </div>

                    <div class="input-group input-with-action">
                        <input type="text" id="reg-code" class="glass-input" placeholder="输入6位验证码" data-i18n-placeholder="auth.enterVerifyCode" maxlength="6" autocomplete="off" data-form-type="other" required>
                        <button type="button" class="verify-code-btn" id="sendBtn" onclick="sendVerificationCode()" data-i18n="auth.getVerifyCode">
                            获取验证码
                        </button>
                    </div>

                    <div class="input-group">
                        <input type="password" id="reg-password" class="glass-input" placeholder="设置密码" data-i18n-placeholder="auth.setPassword" autocomplete="new-password" data-form-type="other" required>
                    </div>

                    <!-- Privacy Policy Consent Checkbox -->
                    <div class="checkbox-wrapper" style="margin-bottom: 24px; display: flex; align-items: flex-start; gap: 8px; color: rgba(255,255,255,0.7); font-size: 13px;">
                        <input type="checkbox" id="privacyConsent" class="custom-checkbox" style="width: 16px; height: 16px; accent-color: #9b5de5; cursor: pointer; margin-top: 2px; flex-shrink: 0;">
                        <label for="privacyConsent" style="cursor: pointer; line-height: 1.4;">
                            <span data-i18n="auth.agreeToTerms">我已阅读并同意</span>
                            <a href="/privacy.html" target="_blank" style="color: #9b5de5; text-decoration: underline;" data-i18n="auth.privacyPolicy">隐私政策</a>
                        </label>
                    </div>

                    <button type="submit" class="login-submit-btn" data-i18n="auth.createAccount">创建账号</button>
                </form>

                <div class="switch-text">
                    <span data-i18n="auth.hasAccount">已有账号？</span>
                    <span class="switch-link" onclick="switchAuthView('login')" data-i18n="auth.loginNow">直接登录</span>
                </div>
            </div>

            <!-- Password Reset View -->
            <div id="resetView" class="form-view hidden">
                <h2 class="card-title" data-i18n="auth.resetPassword">找回密码</h2>
                <p class="card-subtitle" data-i18n="auth.resetSubtitle">请输入您的注册邮箱以重置密码</p>

                <form id="resetForm" onsubmit="handlePasswordReset(event)">
                    <div class="input-group">
                        <input type="email" id="reset-email" class="glass-input" placeholder="邮箱地址" data-i18n-placeholder="auth.emailPlaceholder" required>
                    </div>

                    <button type="submit" class="login-submit-btn" style="margin-top: 24px;" data-i18n="auth.recover">找回</button>
                </form>

                <div class="switch-text">
                    <span data-i18n="auth.noAccountYet">没有账户？</span>
                    <span class="switch-link" onclick="switchAuthView('register')" data-i18n="auth.register">注册</span>
                </div>
                <div class="switch-text" style="margin-top: 10px;">
                    <span class="switch-link back-to-login" onclick="switchAuthView('login')" data-i18n="auth.backToLogin">返回登录</span>
                </div>
            </div>

        </div>
    </div>
    `;

    // 2. Inject HTML - Smart detection of #auth-container
    if (!document.getElementById('authBtn')) {
        const authContainer = document.getElementById('auth-container');

        if (authContainer) {
            // 🆕 Nav bar mode: inject button into #auth-container, dropdown to body
            console.log('🔧 Auth: Injecting button into #auth-container, dropdown to body (nav bar mode)');
            authContainer.innerHTML = authButtonOnlyHTML;
            // Dropdown MUST go to body for backdrop-filter to work (nav has its own backdrop-filter)
            const dropdownDiv = document.createElement('div');
            dropdownDiv.innerHTML = dropdownHTML;
            document.body.appendChild(dropdownDiv);
        } else {
            // Legacy mode: inject fixed-position wrapper + dropdown to body
            console.log('🔧 Auth: Injecting fixed-position wrapper to body (legacy mode)');
            const div = document.createElement('div');
            div.innerHTML = authWrapperHTML;
            document.body.appendChild(div);
            // Also append dropdown to body
            const dropdownDiv = document.createElement('div');
            dropdownDiv.innerHTML = dropdownHTML;
            document.body.appendChild(dropdownDiv);
        }

        // Login modal always goes to body
        const modalDiv = document.createElement('div');
        modalDiv.innerHTML = loginModalHTML;
        document.body.appendChild(modalDiv);

        // 🆕 Force inject critical CSS to override any conflicts
        const forceStyle = document.createElement('style');
        forceStyle.id = 'force-auth-styles';
        forceStyle.textContent = `
            /* Force avatar position */
            .top-right-nav {
                position: fixed !important;
                top: 28px !important;
                right: 30px !important;
                z-index: 2100 !important;
                display: flex !important;
                align-items: center !important;
                gap: 16px !important;
            }

            #notifBtn:hover {
                transform: scale(1.1);
                text-shadow: 0 0 10px rgba(255,255,255,0.5);
            }
            [data-theme="light"] #notifBtn { color: #475569 !important; }
            [data-theme="light"] #notifBtn:hover {
                 color: #1e293b !important;
                 text-shadow: none !important;
                 background: rgba(0,0,0,0.05) !important;
                 border-radius: 50%;
            }

            /* ===========================================
               UNIFIED AVATAR STYLING (Fix for all pages)
               =========================================== */
            
            /* Login trigger button - transparent background */
            .login-trigger-btn,
            button.login-trigger-btn,
            #authBtn {
                background: transparent !important;
                background-color: transparent !important;
                border: none !important;
                box-shadow: none !important;
                outline: none !important;
                border-radius: 50% !important;
                padding: 0 !important;
                width: 32px !important;
                height: 32px !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                position: relative !important;
            }
            
            /* Default auth icon - gray transparent style */
            #defaultAuthIcon {
                filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.4)) drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3)) !important;
                font-size: 1.8rem !important;
                color: rgba(255, 255, 255, 0.5) !important;
                transition: all 0.3s ease !important;
            }
            
            /* Default icon hover effect */
            #defaultAuthIcon:hover,
            .login-trigger-btn:hover #defaultAuthIcon,
            #authBtn:hover #defaultAuthIcon {
                transform: scale(1.1) !important;
                filter: drop-shadow(0 0 0 3px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 15px rgba(255, 255, 255, 0.7)) brightness(1.3) !important;
            }
            
            /* Light mode adjustments */
            [data-theme="light"] #defaultAuthIcon {
                color: rgba(100, 116, 139, 0.7) !important;
                filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15)) !important;
            }
            
            [data-theme="light"] #defaultAuthIcon:hover,
            [data-theme="light"] .login-trigger-btn:hover #defaultAuthIcon {
                color: rgba(30, 41, 59, 0.9) !important;
                filter: drop-shadow(0 0 10px rgba(155, 93, 229, 0.4)) brightness(1.1) !important;
            }

            /* Dropdown Styles (Refined Glassmorphism) */
            .avatar-dropdown {
                position: fixed;
                top: 63px;
                right: 30px;
                min-width: 220px;
                /* Match nav bar glass effect */
                background: rgba(0, 0, 0, 0.65);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-top: none;
                border-radius: 12px;
                padding: 16px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
                opacity: 0;
                visibility: hidden;
                transform: translateY(-10px) scale(0.95);
                transition: opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), visibility 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                display: block;
                text-align: left;
                z-index: 9999;
            }
            .avatar-dropdown.active {
                opacity: 1;
                visibility: visible;
                transform: translateY(0) scale(1);
            }
            .dropdown-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 14px;
                margin-bottom: 12px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .identity-name {
                font-family: 'Playfair Display', serif;
                font-size: 1.1rem;
                color: #fff;
                font-weight: 600;
            }
            
            /* Disable Global Blur for Dropdown Overlay */
            .dropdown-overlay {
                background: transparent !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            /* Theme Toggle Button (Springy Animation) */
            .theme-toggle-btn {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.1);
                background: rgba(255,255,255,0.05);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .theme-toggle-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 12px rgba(93, 159, 216, 0.25);
                border-color: rgba(93, 159, 216, 0.5);
            }
            .theme-toggle-btn::after {
                content: '';
                position: absolute;
                inset: -2px;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(93, 159, 216, 0.35) 0%, transparent 70%);
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            .theme-toggle-btn:hover::after { opacity: 1; }
            
            .theme-icon {
                position: absolute;
                font-size: 1.1rem;
                transition: all 0.5s cubic-bezier(0.68, -0.55, 0.27, 1.55);
            }

            /* Theme Toggle Logic: Verify Default is Dark */
            .sun-icon { 
                opacity: 0;
                transform: rotate(90deg) scale(0.5);
                display: block; /* Visible in DOM, hidden by opacity */
            }
            .moon-icon { 
                opacity: 1;
                transform: rotate(0deg) scale(1);
                display: block;
            }
            /* When clicked (to Light mode), .sun-icon becomes visible as switch target? */
            /* Wait, Icons represent CURRENT state or TARGET state? */
            /* In Prompts: Dark Mode -> shows Moon (to signify Dark Mode is ON? OR Moon is the Icon for Dark Mode?) */
            /* Let's re-read Prompts CSS: [data-theme="dark"] .moon-icon { opacity: 1; } */
            /* So Moon is Visible in Dark Mode. */
            /* So Verify Default (Dark) should show Moon. */
            
            [data-theme="light"] .sun-icon {
                opacity: 1;
                transform: rotate(0deg) scale(1);
            }
            [data-theme="light"] .moon-icon {
                opacity: 0;
                transform: rotate(-90deg) scale(0.5);
            }
            
            /* Toggle Button Light Mode Override */
             [data-theme="light"] .theme-toggle-btn {
                background: rgba(0,0,0,0.05);
                border-color: rgba(0,0,0,0.1);
            }
            [data-theme="light"] .theme-toggle-btn:hover {
                box-shadow: 0 4px 12px rgba(155, 93, 229, 0.2);
                border-color: rgba(155, 93, 229, 0.4);
            }
            [data-theme="light"] .theme-toggle-btn::after {
                background: radial-gradient(circle, rgba(155, 93, 229, 0.3) 0%, transparent 70%);
            }

            .dropdown-actions { padding-top: 12px; }
            .dropdown-action {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 10px;
                color: #e2e8f0; /* Brighter Text (var(--text-main)) */
                text-decoration: none;
                transition: all 0.2s ease;
                background: transparent;
                border: none;
                width: 100%;
                text-align: left;
                cursor: pointer;
                font-size: 0.9rem;
                font-family: 'Inter', sans-serif;
                font-weight: 500;
            }
            .dropdown-action i {
                width: 20px;
                text-align: center;
                color: #94a3b8; /* Refined Icon Color (var(--text-dim)) */
                transition: color 0.2s ease;
            }

            /* Hover - Dark Mode (Default) */
            .dropdown-action:hover {
                background: rgba(93, 159, 216, 0.12);
                color: #5d9fd8;
                transform: translateX(0); /* Prompts doesn't translate */
            }
            .dropdown-action:hover i { color: #5d9fd8; }

            /* Light Mode CSS - Keep dropdown consistent with nav bar */
            [data-theme="light"] .avatar-dropdown {
                background: rgba(0, 0, 0, 0.65);
                border-color: rgba(255, 255, 255, 0.1);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            }
            [data-theme="light"] .identity-name { color: rgba(255, 255, 255, 0.95); }
            [data-theme="light"] .dropdown-header { border-bottom-color: rgba(255, 255, 255, 0.15); }
            [data-theme="light"] .dropdown-action { color: rgba(255, 255, 255, 0.85); }
            [data-theme="light"] .dropdown-action i { color: rgba(255, 255, 255, 0.6); }
            
            [data-theme="light"] .dropdown-action:hover {
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.95);
            }
            [data-theme="light"] .dropdown-action:hover i {
                color: rgba(255, 255, 255, 0.95);
            }

            /* Verify Widget Layout Optimization (Text + Points in one row) */
            .verify-widget-header {
                display: flex !important;
                align-items: center !important;
                flex-wrap: nowrap !important;
                gap: 16px !important;
                padding-bottom: 24px !important;
            }
            .verify-widget-icon {
                margin: 0 !important;
                flex-shrink: 0;
            }
            .verify-widget-title {
                flex: 1 !important;
                text-align: left !important;
                margin: 0 !important;
            }
            .verify-widget-title h3 { margin: 0 0 4px 0 !important; font-size: 1.25rem !important; line-height: 1.2; }
            .verify-widget-title p { margin: 0 !important; font-size: 0.85rem !important; opacity: 0.8; }
            
            .verify-balance {
                margin: 0 !important;
                width: auto !important;
                padding: 6px 14px !important;
                font-size: 0.9rem !important;
                border-radius: 20px !important;
                background: rgba(255,255,255,0.1); /* Default Dark Mode bg */
                justify-content: center;
                box-shadow: none !important;
                flex-shrink: 0;
                min-width: 0 !important; /* Allow shrink if needed, but flex-shrink 0 stops it */
                height: 32px !important;
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            }
            .verify-balance i { font-size: 0.9rem !important; }
            .verify-balance span { font-weight: 600 !important; }

            /* Light Mode Overrides (Verify Page Content) */
            [data-theme="light"] body {
                background-color: #f1f5f9 !important;
                color: #334155 !important;
            }
            /* Hide Starry Canvas in Light Mode */
            [data-theme="light"] #starryCanvas { opacity: 0 !important; }
            
            [data-theme="light"] .verify-page-header h1 { color: #1e293b !important; }
            [data-theme="light"] .verify-page-header p { color: #64748b !important; }
            
            [data-theme="light"] .verify-info-card,
            [data-theme="light"] .verify-instructions {
                background: #ffffff !important;
                border: 1px solid #e2e8f0 !important;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
            }
            [data-theme="light"] .verify-info-card .info-value { color: #1e293b !important; }
            [data-theme="light"] .verify-info-card .info-label { color: #94a3b8 !important; }
            [data-theme="light"] .verify-instructions h3 { color: #334155 !important; }
            [data-theme="light"] .verify-instructions ol { color: #475569 !important; }
            [data-theme="light"] .verify-instructions code {
                background: #f1f5f9 !important;
                color: #0f172a !important;
            }
            
            [data-theme="light"] .back-link {
                background: #ffffff !important;
                color: #64748b !important;
                border-color: #e2e8f0 !important;
                backdrop-filter: none !important;
                box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1) !important;
            }
            [data-theme="light"] .back-link:hover {
                color: #0f172a !important;
                border-color: #cbd5e1 !important;
                transform: translateY(-2px);
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1) !important;
            }
            
            [data-theme="light"] .verify-footer,
            [data-theme="light"] .verify-footer a {
                color: #64748b !important;
                border-top-color: #e2e8f0 !important;
                border-bottom-color: #cbd5e1 !important;
            }

            /* Verify Widget Light Mode Overrides */
            [data-theme="light"] .verify-widget {
                background: #ffffff !important;
                border: 1px solid #e2e8f0 !important;
                box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.05) !important;
            }
            [data-theme="light"] .verify-widget-title h3 { color: #1e293b !important; }
            [data-theme="light"] .verify-widget-title p { color: #64748b !important; }
            [data-theme="light"] .verify-widget-icon svg path { fill: #ffffff !important; }
            [data-theme="light"] .verify-balance {
                color: #d97706 !important; /* Amber 600 for visibility on light bg */
                background: #f1f5f9 !important;
            }
            [data-theme="light"] .verify-balance i { color: #f59e0b !important; } /* Amber 500 Icon */
            [data-theme="light"] .verify-quota { color: #334155 !important; }
            
            [data-theme="light"] .verify-batch-info { color: #475569 !important; }
            [data-theme="light"] .verify-batch-count,
            [data-theme="light"] .verify-price-info { color: #475569 !important; }
            [data-theme="light"] .verify-batch-count i,
            [data-theme="light"] .verify-price-info i { color: #64748b !important; }
            [data-theme="light"] .verify-batch-count .count,
            [data-theme="light"] .verify-price-info .price { color: #d97706 !important; }
            
            [data-theme="light"] .verify-footer span { color: #64748b !important; }
            [data-theme="light"] .verify-footer a { color: #475569 !important; border-bottom-color: #cbd5e1 !important; }
            [data-theme="light"] .verify-footer span span { opacity: 0.4 !important; color: #94a3b8 !important; } /* Pipe separator */
            
            [data-theme="light"] .verify-textarea {
                background-color: #f8fafc !important;
                border: 1px solid #cbd5e1 !important;
                color: #334155 !important;
            }
            [data-theme="light"] .verify-textarea::placeholder { color: #94a3b8 !important; }
            
            /* Ensure login prompt text is visible */
            [data-theme="light"] .verify-login-prompt p { color: #475569 !important; }

            
            /* Force Google button styles - MUST match main page */
            .google-login-btn {
                background: transparent !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important;
                color: rgba(255, 255, 255, 0.9) !important;
                backdrop-filter: blur(10px) !important;
                -webkit-backdrop-filter: blur(10px) !important;
            }
            
            .google-login-btn:hover {
                background: rgba(255, 255, 255, 0.08) !important;
                border-color: rgba(255, 255, 255, 0.25) !important;
            }
            
            /* ===========================================
               UNIFIED LOGIN MODAL DIMENSIONS (All Pages)
               Force exact match with homepage style
               =========================================== */
            
            /* Login Card - Fixed narrow width matching homepage */
            .login-card,
            #loginModal .login-card {
                width: 360px !important;
                max-width: 90vw !important;
                padding: 40px !important;
                border-radius: 24px !important;
                background: rgba(255, 255, 255, 0.03) !important;
                backdrop-filter: blur(20px) saturate(150%) !important;
                -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
                box-sizing: border-box !important;
            }
            
            /* Submit Button - Centered, narrow width like homepage */
            .login-submit-btn,
            .login-card .login-submit-btn,
            #loginView .login-submit-btn,
            #registerView .login-submit-btn,
            #resetView .login-submit-btn {
                width: auto !important;
                min-width: 160px !important;
                max-width: 200px !important;
                padding: 14px 48px !important;
                margin: 8px auto 0 auto !important;
                display: block !important;
                border-radius: 12px !important;
                background: linear-gradient(135deg, #9b5de5 0%, #f15bb5 100%) !important;
                font-size: 16px !important;
                font-weight: 600 !important;
            }
            
            /* Google Button - Full width within card */
            .google-login-btn,
            .login-card .google-login-btn {
                width: 100% !important;
                padding: 14px !important;
                border-radius: 16px !important;
                background: transparent !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important;
            }
            
            /* Input group spacing */
            .login-card .input-group {
                margin-bottom: 20px !important;
            }
            
            /* Force input transparency to match main page EXACTLY */
            .login-overlay .glass-input,
            .login-card .glass-input,
            #loginModal .glass-input,
            #loginView .glass-input,
            #registerView .glass-input,
            #resetView .glass-input {
                width: 100% !important;
                box-sizing: border-box !important;
                background: rgba(0, 0, 0, 0.3) !important;
                border: 1px solid rgba(155, 93, 229, 0.3) !important;
                backdrop-filter: blur(20px) !important;
                -webkit-backdrop-filter: blur(20px) !important;
                color: white !important;
                font-size: 16px !important;
                padding: 18px 22px !important;
                border-radius: 16px !important;
            }
            
            /* Placeholder color matching */
            .login-overlay .glass-input::placeholder,
            .login-card .glass-input::placeholder {
                color: rgba(255, 255, 255, 0.5) !important;
            }
            
            /* Focus state - EXACT match from style.css line 2831-2834 */
            .login-overlay .glass-input:focus,
            .login-card .glass-input:focus,
            #loginModal .glass-input:focus,
            #loginView .glass-input:focus,
            #registerView .glass-input:focus,
            #resetView .glass-input:focus {
                background: rgba(0, 0, 0, 0.4) !important;
                border-color: rgba(155, 93, 229, 0.7) !important;
                box-shadow: 0 0 0 3px rgba(155, 93, 229, 0.15), 0 0 20px rgba(168, 85, 247, 0.12) !important;
            }
            
            /* Force avatar hover animation */
            #defaultAuthIcon:hover {
                transform: scale(1.1) !important;
                filter: drop-shadow(0 0 0 3px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 15px rgba(255, 255, 255, 0.7)) brightness(1.3) !important;
            }
            
            /* ========================================
               ULTIMATE PRIORITY: Avatar Shrink on Hover
               Overrides ALL other CSS files
               ======================================== */
            
            /* Disable button container transform to prevent conflicts */
            .login-trigger-btn:hover,  
            button.login-trigger-btn:hover,
            .login-trigger-btn.logged-in:hover {
                transform: none !important;
            }
            
            .nav-user-avatar,
            #navUserAvatar {
                transform: scale(1) !important;
                transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
                will-change: transform !important;
            }
            
            .nav-user-avatar:hover,
            #navUserAvatar:hover,
            .login-trigger-btn:hover .nav-user-avatar,
            .login-trigger-btn:hover #navUserAvatar,
            button.login-trigger-btn:hover .nav-user-avatar,
            button.login-trigger-btn:hover #navUserAvatar,
            .login-trigger-btn.logged-in:hover .nav-user-avatar,
            .login-trigger-btn.logged-in:hover #navUserAvatar {
                transform: scale(0.85) !important;
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4) !important;
                transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }

            /* ========================================
               NOTIFICATION IN DROPDOWN (B+D Hybrid)
               ======================================== */
            
            /* Dropdown notification button - matches theme-toggle-btn */
            .dropdown-notif-btn {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.1);
                background: rgba(255,255,255,0.05);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: visible;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .dropdown-notif-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 12px rgba(93, 159, 216, 0.25);
                border-color: rgba(93, 159, 216, 0.5);
            }
            .dropdown-notif-btn i {
                font-size: 1.1rem;
                color: rgba(255, 255, 255, 0.85);
            }
            
            /* Dropdown notification badge (red dot) - positioned at top-right */
            .dropdown-notif-badge {
                position: absolute;
                top: -2px;
                right: -2px;
                width: 8px;
                height: 8px;
                background: #ef4444;
                border-radius: 50%;
                border: 1.5px solid rgba(30, 30, 40, 0.9);
            }
            
            /* Language toggle button - circular with elegant text */
            .dropdown-lang-btn {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 1px solid rgba(255,255,255,0.1);
                background: rgba(255,255,255,0.05);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .dropdown-lang-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 12px rgba(93, 159, 216, 0.25);
                border-color: rgba(93, 159, 216, 0.5);
            }
            
            /* Language text icon */
            .dropdown-lang-btn .lang-icon {
                position: absolute;
                font-size: 1rem;
                font-weight: 700;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: rgba(255, 255, 255, 0.85);
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            /* Default: show 文 (Chinese mode) */
            .dropdown-lang-btn .lang-zh {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
            .dropdown-lang-btn .lang-en {
                opacity: 0;
                transform: scale(0.5) translateY(10px);
            }
            
            /* When in English mode: show A */
            html[lang="en"] .dropdown-lang-btn .lang-zh {
                opacity: 0;
                transform: scale(0.5) translateY(-10px);
            }
            html[lang="en"] .dropdown-lang-btn .lang-en {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
            
            /* Dropdown header - evenly distribute buttons */
            .dropdown-header {
                display: flex;
                justify-content: space-evenly;
                align-items: center;
                padding: 12px 8px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            
            /* Avatar unread badge (red dot on avatar) */
            .avatar-unread-badge {
                position: absolute;
                top: 0px;
                right: 0px;
                width: 10px;
                height: 10px;
                background: #ef4444;
                border-radius: 50%;
                border: 2px solid rgba(0, 0, 0, 0.8);
                box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.3);
                z-index: 10;
            }
            
            /* Ripple animation for avatar badge */
            .avatar-unread-badge::after {
                content: '';
                position: absolute;
                inset: -2px; /* Pull it slightly out */
                border-radius: 50%;
                border: 1px solid rgba(239, 68, 68, 0.6);
                animation: avatarDotPulse 1.5s infinite ease-out;
                z-index: -1;
            }
            
            @keyframes avatarDotPulse {
                0% { transform: scale(1); opacity: 1; }
                100% { transform: scale(2.5); opacity: 0; }
            }
            
            /* Light mode adjustments for notification UI */
            [data-theme="light"] .dropdown-notif-btn {
                background: rgba(0, 0, 0, 0.03);
                border-color: rgba(0, 0, 0, 0.08);
                color: rgba(255, 255, 255, 0.9);
            }
            [data-theme="light"] .dropdown-notif-btn:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            [data-theme="light"] .avatar-unread-badge {
                border-color: rgba(255, 255, 255, 0.9);
            }

        `;
        document.head.appendChild(forceStyle);
    }

    // 3. Load Scripts if missing
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            // Check by base path (without query string) to avoid duplicate loading
            const basePath = src.split('?')[0];
            const existing = document.querySelector(`script[src^="${basePath}"]`);
            if (existing) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function initAuth() {
        try {
            // ✅ 加载 EmailJS (用于验证码)
            if (typeof emailjs === 'undefined') {
                await loadScript('https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js');
                // 初始化 EmailJS
                if (typeof emailjs !== 'undefined') {
                    emailjs.init("vawaxLVEzJMAVbut0");
                    console.log('✅ EmailJS initialized');
                }
            }

            // 🆕 Inject missing CSS files for Login Modal
            function loadCSS(href) {
                if (!document.querySelector(`link[href^="${href.split('?')[0]}"]`)) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = href;
                    document.head.appendChild(link);
                    console.log(`🎨 Injected CSS: ${href}`);
                }
            }
            loadCSS(`login_styles.css?v=DARK_BG_INPUTS_V12`);
            loadCSS(`login_dual_mode.css?v=DARK_BG_INPUTS_V12`);

            // Supabase Auth
            await loadScript('./supabase-auth-functions.js?v=INITIAL');

            // ✅ 加载 script.js (包含 sendVerificationCode 函数)
            await loadScript('./script.js?v=EMAIL_FIX_V1');

            // Initialize UI - now using Supabase
            if (window.supabaseClient) {
                const { data: { user } } = await window.supabaseClient.auth.getUser();
                if (user && typeof updateUserUI === 'function') {
                    const { data: profile } = await window.supabaseClient
                        .from('profiles')
                        .select('*')
                        .eq('id', user.id)
                        .single();

                    updateUserUI({
                        objectId: user.id,
                        username: user.email,
                        email: user.email,
                        nickname: profile?.username || user.user_metadata?.full_name || user.email.split('@')[0],
                        avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url
                    });
                }
            }

            // Add global handlers if needed
            window.toggleLoginModal = function () {
                const modal = document.getElementById('loginModal');
                if (modal) {
                    modal.classList.toggle('active');
                    const isActive = modal.classList.contains('active');

                    if (isActive) {
                        modal.style.display = 'flex';
                        modal.style.visibility = 'visible';
                        modal.style.opacity = '1';
                        // 🆕 Force card visibility
                        const card = modal.querySelector('.login-card');
                        if (card) {
                            card.style.display = 'block';
                            card.style.opacity = '1';
                            card.style.visibility = 'visible';
                        }
                    } else {
                        modal.style.display = 'none';
                        modal.style.visibility = 'hidden';
                        modal.style.opacity = '0';
                    }
                }
            };

            window.switchAuthView = function (viewId) {
                // 隐藏所有视图
                document.querySelectorAll('.form-view').forEach(el => el.classList.add('hidden'));
                // 显示目标视图
                const targetView = document.getElementById(viewId + 'View');
                if (targetView) {
                    targetView.classList.remove('hidden');

                    // 强制清空目标视图中的所有输入框（多次清空确保生效）
                    const inputs = targetView.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
                    inputs.forEach(input => {
                        // 第一次清空
                        input.value = '';
                        // 移除 readonly 属性（如果有）
                        input.removeAttribute('readonly');
                    });

                    // 延迟再次清空，确保浏览器自动填充后也能清除
                    setTimeout(() => {
                        inputs.forEach(input => {
                            input.value = '';
                            // 触发 input 事件，确保任何监听器都知道值已改变
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                        });
                        console.log(`✅ 已切换到 ${viewId} 视图并清空输入框`);
                    }, 10);
                }
            };

            // 记录 mousedown 是否发生在 overlay 上
            let mouseDownOnOverlay = false;

            window.handleLoginOverlayClick = function (event) {
                const isOverlay = event.target.classList.contains('login-overlay');

                if (event.type === 'mousedown') {
                    mouseDownOnOverlay = isOverlay;
                } else if (event.type === 'mouseup') {
                    // 只有当 mousedown 和 mouseup 都在 overlay 上时才关闭
                    if (mouseDownOnOverlay && isOverlay) {
                        toggleLoginModal();
                    }
                    mouseDownOnOverlay = false;
                }
            };

        } catch (error) {
            console.error('Failed to initialize auth:', error);
        }
    }

    // ==================== Theme Toggle ====================
    window.toggleTheme = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const html = document.documentElement;
        const currentData = html.getAttribute('data-theme');
        const isLight = currentData === 'light';

        if (isLight) {
            html.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        } else {
            html.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
        }
    };

    // ==================== Language Toggle ====================
    window.toggleLanguage = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (window.i18n && typeof window.i18n.toggleLanguage === 'function') {
            window.i18n.toggleLanguage();
            // Update button text after toggle
            updateLangButtonText();
        } else {
            console.warn('i18n.toggleLanguage not available');
        }
    };

    // Update language button text to show current language
    function updateLangButtonText() {
        const langBtn = document.getElementById('langTextDisplay');
        if (langBtn && window.i18n) {
            const currentLang = window.i18n.getCurrentLanguage() || 'zh';
            langBtn.textContent = currentLang.toUpperCase();
        }
    }

    // Init Theme
    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme !== 'light') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    } catch (e) { }

    // Sync language button on load
    setTimeout(updateLangButtonText, 500);

    // Run initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        initAuth();
    }

    // Language Toggle Sync
    function updateLangToggle(lang) {
        const zhEl = document.getElementById('langZh');
        const enEl = document.getElementById('langEn');
        if (zhEl && enEl) {
            zhEl.style.opacity = lang === 'zh' ? '1' : '0.5';
            enEl.style.opacity = lang === 'en' ? '1' : '0.5';
        }
    }

    // Listen for language changes
    window.addEventListener('languageChanged', (e) => {
        updateLangToggle(e.detail.lang);
    });

    // Sync initial state
    setTimeout(() => {
        const lang = window.i18n?.getCurrentLanguage() || 'zh';
        updateLangToggle(lang);
    }, 100);

    // ==================== Notification Click Handler (B+D Hybrid) ====================
    window.handleDropdownNotifClick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }

        // Close the dropdown menu AND its overlay
        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('dropdownOverlay');
        if (dropdown) {
            dropdown.classList.remove('active');
        }
        if (overlay) {
            overlay.classList.remove('active');
        }

        // Open the notification panel (using existing toggleNotifMenu function)
        if (typeof window.toggleNotifMenu === 'function') {
            window.toggleNotifMenu(e);
        } else {
            console.warn('toggleNotifMenu not available');
        }
    };

    // ==================== Update Unread Badges ====================
    window.updateNotificationBadges = function (hasUnread) {
        // Update avatar badge
        const avatarBadge = document.getElementById('avatarUnreadBadge');
        if (avatarBadge) {
            avatarBadge.style.display = hasUnread ? 'block' : 'none';
        }

        // Update dropdown notification badge
        const dropdownBadge = document.getElementById('dropdownNotifBadge');
        if (dropdownBadge) {
            dropdownBadge.style.display = hasUnread ? 'inline-block' : 'none';
        }
    };

    // Hook into NotificationManager if available
    function initNotificationBadges() {
        if (window.NotificationManager && typeof window.NotificationManager.getUnreadCount === 'function') {
            const count = window.NotificationManager.getUnreadCount();
            window.updateNotificationBadges(count > 0);
        }
    }

    // Check for unread notifications after page load
    setTimeout(initNotificationBadges, 2000);


})();
