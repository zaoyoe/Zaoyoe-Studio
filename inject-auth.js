(function () {
    console.log('🔧 Injecting Auth UI...');

    // 1. Define HTML Structure
    const authHTML = `
    <!-- Auth Button (Top Right) -->
    <div class="top-right-nav" style="position: fixed; top: 30px; right: 40px; z-index: 2100;">
        <button id="authBtn" class="login-trigger-btn" onclick="handleAuthClick(event)">
            <i id="defaultAuthIcon" class="fas fa-user"></i>
            <img id="navUserAvatar" class="nav-user-avatar" src="" alt="Avatar" style="display: none;">
            <span id="authBtnText" style="display: none;">Sign In</span>
        </button>

        <div id="userDropdown" class="user-dropdown" style="z-index: 2100;">
            <div class="menu-item profile-menu-item" onclick="window.openProfileModal(event)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
                个人资料
            </div>
            <div class="divider" style="margin: 5px 0; border-top: 1px solid rgba(255,255,255,0.1);"></div>
            <div class="menu-item switch-account" onclick="window.handleSwitchAccount(event)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                切换账户
            </div>
            <div class="menu-item logout" onclick="window.handleLogout(event)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Log Out
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

                <form id="registerForm" onsubmit="handleRegister(event)">
                    <div class="input-group">
                        <input type="text" id="reg-username" class="glass-input" placeholder="用户名" required>
                    </div>

                    <div class="input-group">
                        <input type="email" id="reg-email" class="glass-input" placeholder="邮箱地址" required>
                    </div>

                    <div class="input-group input-with-action">
                        <input type="text" id="reg-code" class="glass-input" placeholder="输入6位验证码" maxlength="6" required>
                        <button type="button" class="verify-code-btn" id="sendBtn" onclick="sendVerificationCode()">
                            获取验证码
                        </button>
                    </div>

                    <div class="input-group">
                        <input type="password" id="reg-password" class="glass-input" placeholder="设置密码" required>
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
                top: 30px !important;
                right: 40px !important;
                z-index: 2100 !important;
            }
            
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
                background: rgba(0, 0, 0, 0.5) !important;
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
            // Load dependencies in order
            if (typeof AV === 'undefined') {
                await loadScript('https://cdn.jsdelivr.net/npm/leancloud-storage@4.15.2/dist/av-min.js');
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

            // Check if init script is loaded (it might be deferred)
            // We can check if AV is initialized or just load our init script
            await loadScript('./leancloud-init.js?v=20251125_ACL_FIX');
            await loadScript('./leancloud-auth-functions.js?v=20251125_ACL_FIX');
            await loadScript('./google-oauth.js?v=20251126_CORRECT_CLIENT_ID');

            // Initialize UI
            if (typeof AV !== 'undefined' && AV.User) {
                const currentUser = AV.User.current();
                if (currentUser && typeof updateUserUI === 'function') {
                    updateUserUI({
                        objectId: currentUser.id,
                        username: currentUser.get('username'),
                        email: currentUser.get('email'),
                        nickname: currentUser.get('nickname') || currentUser.get('username'),
                        avatarUrl: currentUser.get('avatarUrl')
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
                document.querySelectorAll('.form-view').forEach(el => el.classList.add('hidden'));
                document.getElementById(viewId + 'View').classList.remove('hidden');
            };

            window.handleLoginOverlayClick = function (event) {
                if (event.target.classList.contains('login-overlay')) {
                    if (event.type === 'mouseup') {
                        toggleLoginModal();
                    }
                }
            };

        } catch (error) {
            console.error('Failed to initialize auth:', error);
        }
    }

    // Run initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        initAuth();
    }

})();
