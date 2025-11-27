/**
 * LeanCloud 版本的认证和用户管理函数
 * 替换 script.js 中对应的 Firebase 函数
 */

// ==================== 注册功能 (LeanCloud 版本) ====================
async function handleRegister(event) {
    event.preventDefault();

    const inputCode = document.getElementById('reg-code').value;
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value.trim();  // ✅ 添加 .trim()
    const username = document.getElementById('reg-username').value.trim();  // ✅ 添加 .trim()

    // 验证码检查
    if (inputCode !== generatedCode) {
        alert("验证码错误！请检查邮件重新输入。");
        return;
    }

    try {
        // 创建新用户
        const user = new AV.User();
        user.setUsername(email);  // 使用邮箱作为用户名
        user.setPassword(password);
        user.setEmail(email);
        user.set('nickname', username || email.split('@')[0]);
        user.set('avatarUrl', `https://ui-avatars.com/api/?name=${encodeURIComponent(username || email.split('@')[0])}&background=random`);

        // 注册用户
        await user.signUp();
        console.log('✅ User created:', user.id);

        // ⚠️ 尝试修复ACL（大概率会失败，因为LeanCloud的Default ACL bug）
        let aclFixed = false;
        try {
            // Re-fetch to get latest server state
            await user.fetch();

            const acl = new AV.ACL(user);
            acl.setPublicReadAccess(true);
            acl.setWriteAccess(user, true);
            user.setACL(acl);
            await user.save();
            console.log('✅ ACL set successfully (lucky!)');
            aclFixed = true;
        } catch (aclError) {
            console.warn('⚠️ ACL auto-fix failed (expected):', aclError.message);
            // 不影响注册流程
        }

        console.log('✅ 注册成功:', user.toJSON());

        // 提示用户
        if (aclFixed) {
            alert(`注册成功！欢迎，${username || email.split('@')[0]}！\n现在可以上传头像了。`);
        } else {
            alert(`注册成功！欢迎，${username || email.split('@')[0]}！\n\n⚠️ 提示：首次上传头像可能需要管理员手动授权。\n如果上传失败，请联系管理员修复权限。`);
        }

        // 关闭模态框
        toggleLoginModal();

        // 更新UI - 用户已自动登录
        updateUserUI({
            objectId: user.id,
            username: email,
            email: email,
            nickname: username || email.split('@')[0],
            avatarUrl: user.get('avatarUrl')
        });

        // ✅ 移除自动跳转到登录视图的逻辑
        // 用户注册后已经是登录状态，不需要再切换到登录界面

    } catch (error) {
        console.error('注册失败:', error);

        let errorMessage = '注册失败';
        if (error.code === 202 || error.message.includes('already taken')) {
            errorMessage = '该邮箱已被注册。\n如果这是您的旧账号且存在问题，请使用【新的邮箱地址】注册新账号。';
        } else if (error.code === 125) {
            errorMessage = '邮箱格式不正确';
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`注册失败: ${errorMessage}`);
    }
}

// 显式挂载到 window 对象，确保 HTML onclick 可以访问
window.handleAuthClick = handleAuthClick;

// ==================== 登录功能 (LeanCloud 版本) ====================
async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('remember-me')?.checked || false;

    if (!email || !password) {
        alert("请输入邮箱和密码");
        return;
    }

    try {
        // 使用邮箱登录
        const user = await AV.User.logIn(email, password);

        console.log('✅ 登录成功:', user.toJSON());

        // 记住我功能 - 保存30天
        if (rememberMe) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30); // 30天后过期

            const credentials = {
                email: email,
                password: btoa(password), // Base64编码（简单混淆，不是加密）
                expiry: expiryDate.getTime()
            };

            localStorage.setItem('remembered_credentials', JSON.stringify(credentials));
            console.log('✅ 已保存登录凭证（30天有效）');
        } else {
            // 不勾选则清除保存的凭证
            localStorage.removeItem('remembered_credentials');
        }

        // 关闭模态框
        toggleLoginModal();

        // 更新UI
        updateUserUI({
            objectId: user.id,
            username: user.get('username'),
            email: user.get('email'),
            nickname: user.get('nickname') || user.get('username'),
            avatarUrl: user.get('avatarUrl') || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.get('username'))}&background=random`
        });

    } catch (error) {
        console.error('登录失败:', error);

        let errorMessage = '登录失败';
        if (error.code === 210) {
            errorMessage = '用户名或密码错误';
        } else if (error.code === 211) {
            errorMessage = '找不到该用户';
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`登录失败: ${errorMessage}`);
    }
}

// ==================== 退出登录 (LeanCloud 版本) ====================
function handleLogout(event) {
    // 阻止事件冒泡，防止下拉菜单被立即关闭
    if (event) {
        event.stopPropagation();
    }

    // ✅ 先关闭下拉菜单，避免 confirm() 对话框导致的焦点问题
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }

    // 确认对话框
    if (!confirm("确定要退出登录吗？")) return;

    console.log('🚪 退出登录');

    // 退出登录
    AV.User.logOut();

    // 清除记住的凭证
    localStorage.removeItem('remembered_credentials');
    console.log('🗑️ 已清除记住的凭证');

    // 重置UI - 使用正确的元素 ID
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');
    const userDropdown = document.getElementById('userDropdown');

    // 显示默认图标，隐藏头像
    if (defaultIcon) {
        defaultIcon.style.display = 'inline';
    }
    if (navAvatar) {
        navAvatar.style.display = 'none';
    }

    // 重置按钮文本
    if (btnText) {
        btnText.textContent = 'Sign In';
    }

    // 移除登录状态类
    const authBtn = document.getElementById('authBtn');
    if (authBtn) {
        authBtn.classList.remove('logged-in');
    }

    // 隐藏下拉菜单
    if (userDropdown) {
        // 不要设置 display: 'none'，因为这会导致再次登录时无法显示
        // 只移除 active 类
        userDropdown.classList.remove('active');
    }

    // ✅ 移除"已退出登录"提示 - 用户已确认，不需要二次提示
}

// ==================== 处理 Auth 按钮点击 ====================
function handleAuthClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    console.log('🔘 handleAuthClick triggered');

    const currentUser = AV.User.current();
    console.log('👤 Current User:', currentUser ? currentUser.id : 'null');

    if (currentUser) {
        // User is logged in - toggle dropdown
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) {
            const isActive = dropdown.classList.contains('active');
            if (isActive) {
                dropdown.classList.remove('active');
                console.log('🔽 Dropdown closed');
            } else {
                dropdown.classList.add('active');
                console.log('🔽 Dropdown opened');
            }
        } else {
            console.error('❌ userDropdown element not found!');
        }
    } else {
        // User is not logged in - open login modal
        if (typeof openAuthModal === 'function') {
            openAuthModal('login');
        } else if (typeof toggleLoginModal === 'function') {
            toggleLoginModal();
        }
    }
}

// 显式挂载到 window 对象，确保 HTML onclick 可以访问
window.handleAuthClick = handleAuthClick;

// ==================== 检查登录状态 (LeanCloud 版本) ====================
function checkAuthState() {
    console.log('🔍 检查登录状态...');

    const currentUser = AV.User.current();

    if (currentUser) {
        console.log('✅ 用户已登录:', currentUser.toJSON());

        updateUserUI({
            objectId: currentUser.id,
            username: currentUser.get('username'),
            email: currentUser.get('email'),
            nickname: currentUser.get('nickname') || currentUser.get('username'),
            avatarUrl: currentUser.get('avatarUrl') || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.get('username'))}&background=random`
        });
    } else {
        console.log('❌ 用户未登录');
        // 重置 UI 为未登录状态
        updateUserUI(null);
    }
}

// ==================== 更新用户UI ====================
function updateUserUI(user) {
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');
    const userDropdown = document.getElementById('userDropdown');
    // New Profile Modal Elements
    const profileModalEmail = document.getElementById('profileModalEmail');
    const profileModalAvatar = document.getElementById('profileModalAvatar');

    if (user) {
        console.log('👤 updateUserUI: 用户已登录', user);
        console.log('🔍 检查元素:', {
            defaultIcon: !!defaultIcon,
            navAvatar: !!navAvatar,
            navAvatarDisplay: navAvatar ? navAvatar.style.display : 'null',
            btnText: !!btnText
        });

        // 用户已登录 - 显示头像和昵称
        if (defaultIcon) {
            defaultIcon.style.display = 'none';
        }
        if (navAvatar) {
            // 移除之前的动画类（如果存在）
            navAvatar.classList.remove('animate-in');
            // 设置初始状态为透明，让动画控制显示
            navAvatar.style.opacity = '0';

            const triggerAnimation = () => {
                // 强制重排
                void navAvatar.offsetWidth;
                // 添加动画类
                navAvatar.classList.add('animate-in');
            };

            if (user.avatarUrl) {
                navAvatar.src = user.avatarUrl;
                navAvatar.style.display = 'inline';

                // 等待图片加载完成后再显示动画
                if (navAvatar.complete && navAvatar.naturalWidth > 0) {
                    // 图片已缓存，延迟触发动画
                    setTimeout(triggerAnimation, 50);
                } else {
                    // 图片需要加载，等待加载完成
                    const loadHandler = function () {
                        setTimeout(triggerAnimation, 50);
                        navAvatar.onload = null;
                        navAvatar.onerror = null;
                    };
                    navAvatar.onload = loadHandler;
                    navAvatar.onerror = loadHandler;
                }
            } else {
                // 没有头像URL，使用默认头像
                const defaultAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nickname || user.username || 'User')}&background=random`;
                navAvatar.src = defaultAvatarUrl;
                navAvatar.style.display = 'inline';

                // 等待默认头像加载
                if (navAvatar.complete && navAvatar.naturalWidth > 0) {
                    setTimeout(triggerAnimation, 50);
                } else {
                    const loadHandler = function () {
                        setTimeout(triggerAnimation, 50);
                        navAvatar.onload = null;
                        navAvatar.onerror = null;
                    };
                    navAvatar.onload = loadHandler;
                    navAvatar.onerror = loadHandler;
                }
            }
        }
        if (btnText) {
            // 更新文本
            const newText = user.nickname || user.username || 'User';
            btnText.textContent = newText;

            // 移除旧的动画类逻辑，改用 CSS 悬浮控制
            btnText.classList.remove('animate-in');
        }

        // 添加登录状态类，用于控制CSS悬浮效果
        const authBtn = document.getElementById('authBtn');
        if (authBtn) {
            authBtn.classList.add('logged-in');
        }
        if (profileModalEmail) {
            profileModalEmail.textContent = user.email;
        }
        if (profileModalAvatar && user.avatarUrl) {
            profileModalAvatar.src = user.avatarUrl;
        }
        if (userDropdown) {
            // 确保dropdown可以显示（使用CSS控制显示/隐藏，而不是display）
            userDropdown.style.display = '';
            // 确保初始状态是隐藏的
            if (!userDropdown.classList.contains('active')) {
                userDropdown.classList.remove('active');
            }
        }

        // Ensure click handler is properly attached after login
        // 注意：不要覆盖 HTML 中的 onclick，而是确保 handleAuthClick 函数可用
        // HTML 中已经有 onclick="handleAuthClick(event)"，所以不需要重新绑定

        // 确保Log Out按钮的点击处理器正确绑定
        const logoutBtn = document.querySelector('.menu-item.logout');
        if (logoutBtn) {
            logoutBtn.onclick = handleLogout;
            console.log('✅ Log Out button handler attached');
        }

        // Cach
        localStorage.setItem('cached_user_profile', JSON.stringify(user));
    } else {
        // 用户未登录 - 显示默认图标和文本
        if (defaultIcon) {
            defaultIcon.style.display = 'inline';
        }
        if (navAvatar) {
            navAvatar.style.display = 'none';
        }
        if (btnText) {
            btnText.textContent = 'Sign In';
        }
        if (userDropdown) {
            // 移除 active 类，让 CSS 处理隐藏
            userDropdown.classList.remove('active');
            userDropdown.style.display = '';
        }

        // 清除缓存
        localStorage.removeItem('cached_user_profile');
    }
}

// ==================== 密码重置 (LeanCloud 版本) ====================
let resetCooldownTimer = null;
let resetCooldownSeconds = 0;

async function handlePasswordReset(event) {
    if (event) event.preventDefault();

    console.log("=== Password Reset Started (LeanCloud) ===");

    const emailInput = document.getElementById('reset-email');
    const submitBtn = document.querySelector('#resetForm button[type="submit"]');

    if (!emailInput || !submitBtn) {
        console.error("Form elements not found!");
        alert("❌ 系统错误：找不到表单元素，请刷新页面重试。");
        return;
    }

    const email = emailInput.value.trim();  // ✅ 添加 .trim() 保持一致性

    if (!email) {
        alert("❌ 请输入邮箱地址");
        return;
    }

    // Check cooldown
    if (resetCooldownSeconds > 0) {
        alert(`⏱️ 请等待 ${resetCooldownSeconds} 秒后再试`);
        return;
    }

    // Show loading
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '发送中...';
    submitBtn.disabled = true;

    try {
        // LeanCloud 密码重置
        await AV.User.requestPasswordReset(email);

        console.log('✅ 重置邮件已发送');
        alert(`✅ 重置密码邮件已发送到 ${email}\n\n请检查您的收件箱（包括垃圾邮件），点击邮件中的链接重置密码。`);
        emailInput.value = '';

        // 开始倒计时
        resetCooldownSeconds = 30;
        updateResetButtonCountdown(submitBtn, originalText);

        // 5秒后自动切换回登录
        setTimeout(() => {
            switchAuthView('login');
        }, 5000);

    } catch (error) {
        console.error('密码重置失败:', error);

        let errorMessage = '发送失败';
        if (error.code === 205) {
            errorMessage = '该邮箱未注册';
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`❌ ${errorMessage}`);
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

// ==================== 页面加载时检查登录状态 ====================
document.addEventListener('DOMContentLoaded', function () {
    console.log('📄 页面加载完成');

    // 检查登录状态
    const currentUser = AV.User.current();
    if (currentUser) {
        checkAuthState();
    } else {
        // 尝试自动登录 (True Remember Me)
        try {
            const savedCredentials = localStorage.getItem('remembered_credentials');
            if (savedCredentials) {
                const credentials = JSON.parse(savedCredentials);
                const now = new Date().getTime();

                // 检查是否过期
                if (credentials.expiry && now < credentials.expiry) {
                    console.log('🔄 发现有效凭证，尝试自动登录...');

                    // 自动填充UI (为了视觉反馈)
                    const loginEmailInput = document.getElementById('login-email');
                    const loginPasswordInput = document.getElementById('login-password');
                    const rememberCheckbox = document.getElementById('remember-me');

                    if (loginEmailInput) loginEmailInput.value = credentials.email;
                    if (loginPasswordInput && credentials.password) loginPasswordInput.value = atob(credentials.password);
                    if (rememberCheckbox) rememberCheckbox.checked = true;

                    // 执行登录
                    AV.User.logIn(credentials.email, atob(credentials.password)).then(user => {
                        console.log('✅ 自动登录成功:', user.toJSON());
                        updateUserUI({
                            objectId: user.id,
                            username: user.get('username'),
                            email: user.get('email'),
                            nickname: user.get('nickname') || user.get('username'),
                            avatarUrl: user.get('avatarUrl') || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.get('username'))}&background=random`
                        });
                    }).catch(error => {
                        console.error('自动登录失败:', error);
                        // 登录失败可能是密码改了，清除凭证
                        localStorage.removeItem('remembered_credentials');
                        updateUserUI(null);
                    });
                } else {
                    // 已过期，清除
                    localStorage.removeItem('remembered_credentials');
                    console.log('⏰ 记住的凭证已过期');
                    updateUserUI(null);
                }
            } else {
                updateUserUI(null);
            }
        } catch (e) {
            console.error('读取记住的凭证失败:', e);
            localStorage.removeItem('remembered_credentials');
            updateUserUI(null);
        }
    }

    // 监听邮箱输入变化，自动填充对应密码
    const loginEmailInput = document.getElementById('login-email');
    if (loginEmailInput) {
        loginEmailInput.addEventListener('input', function () {
            try {
                const savedCredentials = localStorage.getItem('remembered_credentials');
                if (savedCredentials) {
                    const credentials = JSON.parse(savedCredentials);
                    const now = new Date().getTime();

                    // 检查是否匹配且未过期
                    if (credentials.email === this.value && now < credentials.expiry) {
                        const loginPasswordInput = document.getElementById('login-password');
                        if (loginPasswordInput && credentials.password) {
                            loginPasswordInput.value = atob(credentials.password);
                        }
                    }
                }
            } catch (e) {
                console.error('自动填充密码失败:', e);
            }
        });
    }

    // Add global click listener to close dropdown when clicking outside
    document.addEventListener('click', function (event) {
        const dropdown = document.getElementById('userDropdown');
        const authBtn = document.getElementById('authBtn');

        if (dropdown && authBtn &&
            !authBtn.contains(event.target) &&
            !dropdown.contains(event.target)) {
            dropdown.classList.remove('active');
        }
    });
});

// ==================== 更换头像 (LeanCloud 版本) ====================
async function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Check size (limit to 2MB)
    if (file.size > 2 * 1024 * 1024) {
        alert("图片大小不能超过 2MB");
        return;
    }

    const currentUser = AV.User.current();
    if (!currentUser) {
        alert("请先登录");
        return;
    }

    // Convert to Base64 and Resize
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = async function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Resize to 200x200 max
            const maxSize = 200;
            let width = img.width;
            let height = img.height;

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

            // Get Base64 string (JPEG, 0.8 quality)
            const base64String = canvas.toDataURL('image/jpeg', 0.8);

            try {
                console.log('🖼️ Starting avatar upload...');
                console.log('📦 Base64 size:', Math.round(base64String.length / 1024), 'KB');

                // Update LeanCloud user avatar
                currentUser.set('avatarUrl', base64String);
                await currentUser.save();

                console.log('✅ Avatar updated in LeanCloud');

                // Update UI
                updateUserUI({
                    objectId: currentUser.id,
                    username: currentUser.get('username'),
                    email: currentUser.get('email'),
                    nickname: currentUser.get('nickname') || currentUser.get('username'),
                    avatarUrl: base64String
                });

                alert("头像更新成功！");

            } catch (error) {
                console.error("❌ Error updating avatar:", error);

                // 添加详细错误日志用于调试
                console.log('🔍 Error details:', {
                    code: error.code,
                    message: error.message,
                    codeType: typeof error.code,
                    fullError: error
                });

                // 改进的ACL错误检测 - 更宽松更可靠
                // 将error转为字符串进行检测，避免类型不匹配问题
                const errorStr = (error.message || error.toString() || '').toLowerCase();
                const errorCode = String(error.code || '');
                const is403Error = errorCode === '403' || errorCode === '403' || errorStr.includes('403');
                const isACLError = errorStr.includes('forbidden') || errorStr.includes('acl');

                console.log('🔍 ACL Error Check:', {
                    is403Error,
                    isACLError,
                    willAttemptFix: is403Error || isACLError
                });

                if (is403Error || isACLError) {
                    console.log('🔧 Attempting to auto-fix ACL for existing user...');

                    alert(`❌ 头像上传失败：权限不足\n\n原因：您的账户权限需要管理员手动授权。\n\n解决方案：\n1. 请联系管理员\n2. 提供您的用户名或邮箱\n3. 管理员会在后台为您开通权限\n4. 然后您就可以上传头像了\n\n抱歉给您带来不便！`);

                    // 仍然尝试自动修复（万一能成功）
                    try {
                        await currentUser.fetch();
                        const acl = new AV.ACL(currentUser);
                        acl.setPublicReadAccess(true);
                        acl.setWriteAccess(currentUser, true);
                        currentUser.setACL(acl);
                        await currentUser.save();
                        console.log('✅ ACL auto-fix succeeded!');
                    } catch (retryError) {
                        console.error('❌ ACL auto-fix failed:', retryError);
                    }
                    try {
                        // 关键修复：先fetch最新的用户对象
                        // LeanCloud要求在修改ACL前必须先获取完整的用户数据
                        await currentUser.fetch();
                        console.log('📡 Fetched latest user data');

                        // Set proper ACL
                        const acl = new AV.ACL();
                        acl.setPublicReadAccess(true);
                        acl.setWriteAccess(currentUser, true);
                        currentUser.setACL(acl);

                        // Retry save with fixed ACL
                        currentUser.set('avatarUrl', base64String);
                        await currentUser.save();

                        console.log('✅ ACL auto-fixed and avatar updated successfully');

                        // Update UI
                        updateUserUI({
                            objectId: currentUser.id,
                            username: currentUser.get('username'),
                            email: currentUser.get('email'),
                            nickname: currentUser.get('nickname') || currentUser.get('username'),
                            avatarUrl: base64String
                        });

                        alert("头像更新成功！\n(已自动修复账号权限)");
                        return; // Success, exit function
                    } catch (retryError) {
                        console.error("❌ ACL auto-fix failed:", retryError);
                        alert("头像更新失败: ACL 自动修复失败。\n" + retryError.message);
                        return;
                    }
                }

                // Generic error handling
                alert("头像更新失败: " + error.message);
            }
        };
        img.src = e.target.result;
    };
}

// ==================== 切换账户 ====================
function handleSwitchAccount(event) {
    // 阻止事件冒泡，防止下拉菜单被立即关闭
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }

    console.log('🔄 切换账户');

    // 退出登录（不保存凭证，不显示确认对话框）
    AV.User.logOut();

    // 清除记住的凭证
    localStorage.removeItem('remembered_credentials');
    console.log('🗑️ 已清除记住的凭证');

    // 重置UI为未登录状态
    updateUserUI(null);

    // 打开登录弹窗（使用正确的函数名）
    setTimeout(() => {
        if (typeof openAuthModal === 'function') {
            openAuthModal('login');
        }
    }, 100); // 短暂延迟确保下拉菜单完全关闭
}

// ==================== 打开个人资料模态框 ====================
function openProfileModal(event) {
    // 阻止事件冒泡
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }

    // 获取当前用户信息
    const currentUser = AV.User.current();
    if (!currentUser) {
        alert('请先登录');
        return;
    }

    // 更新模态框内容
    const avatarImg = document.getElementById('profileModalAvatar');
    const emailDiv = document.getElementById('profileModalEmail');
    const nicknameSpan = document.getElementById('profileModalNickname');
    const memberSinceSpan = document.getElementById('profileMemberSince');

    if (avatarImg) {
        avatarImg.src = currentUser.get('avatarUrl') || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.get('username'))}&background=random`;
    }

    if (emailDiv) {
        emailDiv.textContent = currentUser.get('email');
    }

    if (nicknameSpan) {
        nicknameSpan.textContent = currentUser.get('nickname') || currentUser.get('username') || 'User';
    }

    // 更新邮箱验证状态
    checkEmailVerified();

    if (memberSinceSpan) {
        const createdAt = currentUser.get('createdAt');
        if (createdAt) {
            const date = new Date(createdAt);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const day = date.getDate();
            memberSinceSpan.textContent = `注册于 ${year}年${month}月${day}日`;
        } else {
            memberSinceSpan.textContent = '注册时间未知';
        }
    }

    // 打开模态框
    const modal = document.getElementById('profileModal');
    if (modal) {
        modal.classList.add('active');

        // 触发资料页面的错落上升动画
        const profileFront = document.querySelector('.profile-front');
        if (profileFront) {
            // 确保切换到资料页面
            const flipInner = document.querySelector('.profile-flip-inner');
            if (flipInner) {
                flipInner.classList.remove('flipped');
            }
            // 延迟触发动画，确保模态框已显示
            setTimeout(() => {
                profileFront.classList.remove('animate-in');
                void profileFront.offsetWidth; // 强制重排
                profileFront.classList.add('animate-in');
            }, 50);
        }
    }
}

// ==================== 昵称修改功能 ====================
function toggleNicknameEdit(show) {
    const display = document.getElementById('nicknameDisplay');
    const edit = document.getElementById('nicknameEdit');
    const input = document.getElementById('nicknameInput');
    const currentNickname = document.getElementById('profileModalNickname').textContent;

    if (show) {
        // 添加淡出动画
        display.classList.add('hiding');
        display.classList.remove('showing');
        // 等待淡出动画完成后再显示编辑模式
        setTimeout(() => {
            display.style.display = 'none';
            edit.style.display = 'flex';
            input.value = currentNickname;
            // 强制重排以触发动画
            void edit.offsetWidth;
            // 延迟聚焦，确保动画开始后再聚焦
            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);
        }, 300);
    } else {
        // 隐藏编辑模式
        edit.style.display = 'none';
        // 显示显示模式
        display.style.display = 'flex';
        display.classList.remove('hiding');
        // 强制重排以触发动画
        void display.offsetWidth;
        // 添加显示动画类
        display.classList.add('showing');
        // 动画完成后移除类，以便下次可以重新触发
        setTimeout(() => {
            display.classList.remove('showing');
        }, 400);
    }
}

async function saveNickname() {
    const input = document.getElementById('nicknameInput');
    const newNickname = input.value.trim();

    if (!newNickname) return;

    const currentUser = AV.User.current();
    if (currentUser) {
        try {
            currentUser.set('nickname', newNickname);
            await currentUser.save();

            // Update UI
            document.getElementById('profileModalNickname').textContent = newNickname;

            // Update global UI
            updateUserUI({
                objectId: currentUser.id,
                username: currentUser.get('username'),
                email: currentUser.get('email'),
                nickname: newNickname,
                avatarUrl: currentUser.get('avatarUrl')
            });

            toggleNicknameEdit(false);

        } catch (error) {
            alert('保存失败: ' + error.message);
            console.error(error);
        }
    }
}

console.log('✅ LeanCloud 认证函数已加载');

// ==================== Tab 切换功能 ====================
// ==================== Tab 切换功能 ====================
function switchProfileTab(tabName) {
    // Update Tab Styles
    const tabs = document.querySelectorAll('.tab-item');
    tabs.forEach(tab => {
        if (tab.textContent === (tabName === 'profile' ? '资料' : '安全')) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Toggle Views with Flip Animation
    const flipInner = document.querySelector('.profile-flip-inner');
    const profileFront = document.querySelector('.profile-front');
    const profileBack = document.querySelector('.profile-back');

    if (flipInner) {
        // 移除之前的动画类
        if (profileFront) profileFront.classList.remove('animate-in');
        if (profileBack) profileBack.classList.remove('animate-in');

        // 使用 requestAnimationFrame 确保 DOM 更新后再添加动画类
        requestAnimationFrame(() => {
            if (tabName === 'security') {
                flipInner.classList.add('flipped');
                // 触发安全页面的错落上升动画
                if (profileBack) {
                    profileBack.classList.remove('animate-in');
                    // 强制重排，然后添加动画类
                    void profileBack.offsetWidth;
                    profileBack.classList.add('animate-in');
                }
                // Check email status when switching to security tab
                checkEmailVerified();
            } else {
                flipInner.classList.remove('flipped');
                // 触发资料页面的错落上升动画
                if (profileFront) {
                    profileFront.classList.remove('animate-in');
                    // 强制重排，然后添加动画类
                    void profileFront.offsetWidth;
                    profileFront.classList.add('animate-in');
                }
            }
        });
    }
}

// ==================== 安全功能 ====================

// 1. 检查邮箱验证状态
function checkEmailVerified() {
    const currentUser = AV.User.current();
    if (!currentUser) return;

    const statusIcon = document.getElementById('emailStatusIcon');
    const statusText = document.getElementById('emailStatusText');
    const resendBtn = document.getElementById('resendVerifyBtn');

    // Re-fetch to get latest status
    currentUser.fetch().then(user => {
        const isVerified = user.get('emailVerified');

        if (isVerified) {
            statusIcon.innerHTML = '<i class="fas fa-check-circle" style="color: #4ade80;"></i>';
            statusText.textContent = '您的邮箱已验证，账户安全。';
            statusText.style.color = '#4ade80';
            resendBtn.style.display = 'none';
        } else {
            statusIcon.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #fbbf24;"></i>';
            statusText.textContent = '您的邮箱尚未验证，请尽快验证以确保账户安全。';
            statusText.style.color = '#fbbf24';
            resendBtn.style.display = 'block';
        }
    });
}

// 2. 重发验证邮件
let resendCooldown = 0;
let resendTimer = null;

async function resendVerificationEmail() {
    if (resendCooldown > 0) return;

    const currentUser = AV.User.current();
    if (!currentUser) return;

    const btn = document.getElementById('resendVerifyBtn');
    const originalText = btn.textContent;

    try {
        await AV.User.requestEmailVerify(currentUser.get('email'));
        alert('验证邮件已发送！请检查您的邮箱（包括垃圾邮件文件夹）。');

        // Start Cooldown (60 seconds)
        resendCooldown = 60;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';

        resendTimer = setInterval(() => {
            resendCooldown--;
            btn.textContent = `请等待 ${resendCooldown} 秒`;

            if (resendCooldown <= 0) {
                clearInterval(resendTimer);
                btn.textContent = '重发验证邮件';
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }, 1000);

    } catch (error) {
        console.error('Email verification failed:', error);

        let msg = '发送失败';
        if (error.code === 1) {
            msg = '发送过于频繁，请稍后再试（建议等待1分钟）。';
        } else if (error.code === 205) {
            msg = '找不到该邮箱的用户，请联系管理员。';
        } else if (error.code === 216) {
            msg = '该邮箱已经验证过了。';
            checkEmailVerified(); // Refresh UI
        } else {
            msg = `发送失败 (${error.code}): ${error.message}`;
        }
        alert(msg);
    }
}

// 3. 修改密码
async function changePassword() {
    const oldPassword = document.getElementById('oldPasswordInput').value;
    const newPassword = document.getElementById('newPasswordInput').value;

    if (!oldPassword || !newPassword) {
        alert('请输入当前密码和新密码');
        return;
    }

    if (newPassword.length < 6) {
        alert('新密码长度不能少于6位');
        return;
    }

    const currentUser = AV.User.current();
    if (!currentUser) return;

    try {
        // LeanCloud requires updating password via updatePassword(old, new)
        await currentUser.updatePassword(oldPassword, newPassword);
        alert('密码修改成功！请重新登录。');
        handleLogout();
    } catch (error) {
        alert('密码修改失败: ' + error.message);
    }
}

// 4. 注销账号
async function deleteAccount() {
    if (!confirm('⚠️ 警告：此操作不可恢复！\n\n确定要永久删除您的账号吗？所有数据都将丢失。')) {
        return;
    }

    const currentUser = AV.User.current();
    if (!currentUser) return;

    // Double confirmation
    const input = prompt('为了确认删除，请在下方输入 "DELETE"');
    if (input !== 'DELETE') {
        alert('输入错误，操作已取消');
        return;
    }

    try {
        await currentUser.destroy();
        alert('账号已注销。感谢您的使用。');
        handleLogout();
    } catch (error) {
        alert('注销失败: ' + error.message);
    }
}

