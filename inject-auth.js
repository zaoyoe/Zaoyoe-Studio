(function () {
    console.log('🔧 Injecting Auth UI... v13_FORGOT_EMAIL');

    // 1. Define HTML Structure
    const authHTML = `
    <!-- Auth Button (Top Right) -->
    <div class="top-right-nav" style="position: fixed; top: 30px; right: 40px; z-index: 2100;">
        <button id="authBtn" class="login-trigger-btn" onclick="handleAuthClick(event)">
            <i id="defaultAuthIcon" class="fas fa-user-circle"></i>
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

                    <!-- Auth Links Row -->
                    <div class="auth-links-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; font-size: 13px;">
                        
                        <!-- Forgot Email (Left) with Tooltip -->
                        <div class="forgot-email-wrapper" style="position: relative; cursor: help;">
                            <span style="color: rgba(255, 255, 255, 0.5); transition: color 0.3s;">忘记邮箱？</span>
                            
                            <!-- Tooltip -->
                            <!-- Tooltip -->
                            <div class="email-tooltip" style="display: none; position: absolute; bottom: 100%; left: 0; width: 280px; height: 172px; background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 24px; padding: 0 24px; color: #334155; z-index: 2147483647 !important; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2); text-align: center; margin-bottom: 12px; pointer-events: auto;">
                                <!-- Bridge to prevent closing on gap hover -->
                                <div style="position: absolute; top: 100%; left: 0; width: 100%; height: 16px;"></div>
                                
                                <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
                                    <div style="font-size: 13px; color: #475569; font-weight: 500; margin-bottom: 4px;">请联系客服找回</div>
                                    
                                    <a href="mailto:zaoyoe@gmail.com" style="font-size: 16px; color: #1e1b4b; text-decoration: none; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 16px;">zaoyoe@gmail.com</a>

                                    <div onclick="copyRecoveryInfo(this)" style="font-size: 13px; color: #9b5de5; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; background: transparent; padding: 8px 16px; border-radius: 20px; border: 1px solid rgba(155, 93, 229, 0.3);">
                                        <i class="fas fa-copy" style="color: #9b5de5;"></i> <span>复制邮件内容模版</span>
                                    </div>
                                </div>

                                <!-- Arrow -->
                                <div style="position: absolute; bottom: -6px; left: 24px; width: 12px; height: 12px; background: #ffffff; transform: rotate(45deg); border-right: 1px solid rgba(0, 0, 0, 0.08); border-bottom: 1px solid rgba(0, 0, 0, 0.08); z-index: -1;"></div>
                            </div>
                        </div>

                        <!-- Forgot Password (Right) -->
                        <span class="forgot-password-link" onclick="switchAuthView('reset')" style="cursor: pointer;">忘记密码？</span>
                    </div>

                    <script>
                        function copyRecoveryInfo(btn) {
                            const text = "请帮我找回邮箱，我的信息如下：\\n\\n1. 用户名 (Username)：\\n2. 曾在留言板发布的评论内容/时间：\\n3. 大致注册时间 (年/月)：\\n4. 大致最后登录时间：";
                            navigator.clipboard.writeText(text).then(() => {
                                const originalContent = btn.innerHTML;
                                btn.style.background = "rgba(39, 201, 63, 0.1)";
                                btn.style.borderColor = "#27c93f";
                                btn.style.color = "#27c93f";
                                btn.innerHTML = '<i class="fas fa-check"></i> <span>已复制</span>';
                                setTimeout(() => {
                                    btn.style.background = "transparent";
                                    btn.style.borderColor = "rgba(155, 93, 229, 0.3)";
                                    btn.style.color = "#9b5de5";
                                    btn.innerHTML = originalContent;
                                }, 2000);
                            });
                        }

                        // Add hover styles
                        const style = document.createElement('style');
                        style.textContent = `
        .forgot - email - wrapper {
            position: relative;
    z - index: 1; /* Base z-index */
}
    .forgot - email - wrapper:hover {
    z - index: 2147483647!important; /* Highest possible z-index on hover */
}
                        .forgot - email - wrapper: hover.email - tooltip {
    display: flex!important;
    flex - direction: column;
    justify - content: center;
    align - items: center;
    animation: tooltipFloat 0.3s cubic - bezier(0.175, 0.885, 0.32, 1.275);
}
                        .forgot - email - wrapper: hover > span {
    color: rgba(255, 255, 255, 0.9)!important;
    border - bottom - color: rgba(255, 255, 255, 0.8)!important;
    text - shadow: 0 0 8px rgba(255, 255, 255, 0.3);
}  /* Hover effect for the copy button */
                        .email - tooltip div[onclick]:hover {
    background: rgba(155, 93, 229, 0.05)!important;
    border - color: rgba(155, 93, 229, 0.5)!important;
    transform: translateY(-1px);
}
                        .email - tooltip div[onclick]:active {
    transform: translateY(0);
}
@keyframes tooltipFloat {
                            from { opacity: 0; transform: translateY(10px) scale(0.95); }
                            to { opacity: 1; transform: translateY(0) scale(1); }
}
`;document.head.appendChild(style);
                    </script>

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

}) ();
