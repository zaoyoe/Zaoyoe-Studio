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

    // 1. Define HTML Structure
    const authHTML = `
    <!-- Auth Button (Top Right) -->
    <div class="top-right-nav" style="position: fixed; top: 28px; right: 30px; z-index: 2100; display: flex; align-items: center; gap: 16px;">
        <!-- Notification Bell -->
        <div class="notif-wrapper" style="position: relative; display: none;" id="navNotifWrapper">
            <button id="notifBtn" onclick="toggleNotifMenu(event)"
                style="width: 40px; height: 40px; padding: 0; display: flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; color: rgba(255,255,255,0.9); transition: color 0.2s;">
                <i class="far fa-bell" style="font-size: 1.2rem;"></i>
                <div class="notif-badge" id="notifBadge" style="display: none;"></div>
            </button>
        </div>




        <button id="authBtn" class="login-trigger-btn${isLoggedIn ? ' logged-in' : ''}" onclick="handleAuthClick(event)">
            <i id="defaultAuthIcon" class="fas fa-user-circle" style="display: ${defaultIconDisplay};"></i>
            <img id="navUserAvatar" class="nav-user-avatar show" src="${avatarUrl}" alt="Avatar" style="display: ${avatarDisplay}; opacity: ${avatarOpacity};">
            <span id="authBtnText" style="display: none;">Sign In</span>
        </button>

        <!-- New Avatar Dropdown -->
        <div id="userDropdown" class="avatar-dropdown" style="z-index: 2100;">
            <div class="dropdown-header">
                <span class="identity-name" id="dropdownUsername">Guest</span>
                <button class="theme-toggle-btn" onclick="window.toggleTheme(event)">
                    <span class="theme-icon sun-icon">☀️</span>
                    <span class="theme-icon moon-icon">🌙</span>
                </button>
            </div>
            
            <div class="dropdown-actions">
                <button class="dropdown-action" onclick="window.openProfileModal(event)">
                    <i class="fas fa-user"></i>
                    <span>个人资料</span>
                </button>
                <button class="dropdown-action" onclick="WalletModal.open()">
                    <i class="fas fa-wallet"></i>
                    <span>我的钱包</span>
                </button>
                <button class="dropdown-action" onclick="window.handleSwitchAccount(event)">
                    <i class="fas fa-exchange-alt"></i>
                    <span>切换账户</span>
                </button>
                <button class="dropdown-action" id="enterStudioBtn" style="display: none;" onclick="window.location.href='admin-studio.html'">
                     <i class="fas fa-palette"></i>
                     <span>Enter Studio</span>
                </button>
                <button class="dropdown-action" onclick="window.handleLogout(event)">
                    <i class="fas fa-sign-out-alt"></i>
                    <span>Logout</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Login Modal -->
    <div class="login-overlay" id="loginModal" onmousedown="handleLoginOverlayClick(event)" onmouseup="handleLoginOverlayClick(event)">
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
                <h2 class="card-title">欢迎回来</h2>
                <p class="card-subtitle">请输入您的账号信息以登录</p>

                <!-- Google Login Button -->
                <button type="button" class="google-login-btn" onclick="handleGoogleLogin()">
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" height="18">
                    使用 Google 登录
                </button>

                <!-- Divider -->
                <div class="login-divider">
                    <span>或者</span>
                </div>

                <form id="loginForm" onsubmit="handleLogin(event)">
                    <div class="input-group">
                        <input type="email" id="login-email" class="glass-input" placeholder="邮箱地址" required>
                    </div>
                    <div class="input-group">
                        <input type="password" id="login-password" class="glass-input" placeholder="密码" required>
                    </div>

                    <!-- Forgot Password Link -->
                    <div style="text-align: right; margin-bottom: 16px;">
                        <span class="forgot-password-link" onclick="switchAuthView('reset')">忘记密码了吗？</span>
                    </div>

                    <!-- Remember Me Checkbox -->
                    <div class="checkbox-wrapper" style="margin-bottom: 24px; display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.7); font-size: 13px;">
                        <input type="checkbox" id="rememberMe" class="custom-checkbox" style="width: 16px; height: 16px; accent-color: #9b5de5; cursor: pointer;" title="勾选后将自动保存您的登录信息，30天内无需重复输入密码">
                        <label for="rememberMe" style="cursor: pointer;" title="勾选后将自动保存您的登录信息，30天内无需重复输入密码">记住密码</label>
                    </div>

                    <button type="submit" class="login-submit-btn">登录</button>
                </form>

                <div class="switch-text">
                    还没有账号？
                    <span class="switch-link" onclick="switchAuthView('register')">立即注册</span>
                </div>
            </div>

            <!-- Register View -->
            <div id="registerView" class="form-view hidden">
                <h2 class="card-title">创建账号</h2>
                <p class="card-subtitle">加入我们以获取更多高级功能</p>

                <form id="registerForm" onsubmit="handleRegister(event)" autocomplete="off">
                    <div class="input-group">
                        <input type="text" id="reg-username" class="glass-input" placeholder="用户名" autocomplete="off" data-form-type="other" required>
                    </div>

                    <div class="input-group">
                        <input type="text" id="reg-email" class="glass-input" placeholder="邮箱地址" autocomplete="off" data-form-type="other" required>
                    </div>

                    <div class="input-group input-with-action">
                        <input type="text" id="reg-code" class="glass-input" placeholder="输入6位验证码" maxlength="6" autocomplete="off" data-form-type="other" required>
                        <button type="button" class="verify-code-btn" id="sendBtn" onclick="sendVerificationCode()">
                            获取验证码
                        </button>
                    </div>

                    <div class="input-group">
                        <input type="password" id="reg-password" class="glass-input" placeholder="设置密码" autocomplete="new-password" data-form-type="other" required>
                    </div>

                    <button type="submit" class="login-submit-btn">创建账号</button>
                </form>

                <div class="switch-text">
                    已有账号？
                    <span class="switch-link" onclick="switchAuthView('login')">直接登录</span>
                </div>
            </div>

            <!-- Password Reset View -->
            <div id="resetView" class="form-view hidden">
                <h2 class="card-title">找回密码</h2>
                <p class="card-subtitle">请输入您的注册邮箱以重置密码</p>

                <form id="resetForm" onsubmit="handlePasswordReset(event)">
                    <div class="input-group">
                        <input type="email" id="reset-email" class="glass-input" placeholder="电子邮箱" required>
                    </div>

                    <button type="submit" class="login-submit-btn" style="margin-top: 24px;">找回</button>
                </form>

                <div class="switch-text">
                    没有账户？
                    <span class="switch-link" onclick="switchAuthView('register')">注册</span>
                </div>
                <div class="switch-text" style="margin-top: 10px;">
                    <span class="switch-link back-to-login" onclick="switchAuthView('login')">返回登录</span>
                </div>
            </div>

        </div>
    </div>
    `;

    // 2. Inject HTML
    if (!document.getElementById('authBtn')) {
        const div = document.createElement('div');
        div.innerHTML = authHTML;
        document.body.appendChild(div);

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

            /* Dropdown Styles (Refined Glassmorphism) */
            .avatar-dropdown {
                position: absolute;
                top: calc(100% + 12px);
                right: 0;
                min-width: 220px;
                /* Dark Mode Default: High transparency glass */
                background: rgba(30, 41, 59, 0.65);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 16px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                opacity: 0;
                visibility: hidden;
                transform: translateY(-10px) scale(0.95);
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                display: block;
                text-align: left;
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

            /* Light Mode CSS */
            [data-theme="light"] .avatar-dropdown {
                background: rgba(255, 255, 255, 0.85); /* Glassy White */
                border-color: rgba(0,0,0,0.1);
                box-shadow: 0 10px 40px rgba(0,0,0,0.1);
                color: #333;
            }
            [data-theme="light"] .identity-name { color: #1e293b; }
            [data-theme="light"] .dropdown-header { border-bottom-color: rgba(0,0,0,0.08); }
            [data-theme="light"] .dropdown-action { color: #334155; }
            [data-theme="light"] .dropdown-action i { color: #94a3b8; }
            
            [data-theme="light"] .dropdown-action:hover {
                background: rgba(107, 158, 206, 0.12); /* Starry Blue Tint */
                color: #6b9ece; /* Starry Blue */
            }
            [data-theme="light"] .dropdown-action:hover i {
                color: #6b9ece;
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
            
            /* Force input transparency to match main page EXACTLY */
            .login-overlay .glass-input,
            .login-card .glass-input,
            #loginModal .glass-input,
            #loginView .glass-input,
            #registerView .glass-input,
            #resetView .glass-input {
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
            
            .nav-user-avatar:hover {
                transform: scale(1.1) !important;
                box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.9), 0 0 15px rgba(255, 255, 255, 0.7) !important;
            }
        `;
        document.head.appendChild(forceStyle);
    }

    // 3. Load Scripts if missing
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
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

    // Init Theme
    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    } catch (e) { }

    // Run initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        initAuth();
    }

})();
