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

    // 隐藏下拉菜单
    if (userDropdown) {
        userDropdown.style.display = 'none';
    }

    alert('已退出登录');
}

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
    const profileEmail = document.getElementById('profileEmail');
    const dropdownAvatar = document.getElementById('dropdownAvatar');

    if (user) {
        // 用户已登录 - 显示头像和昵称
        if (defaultIcon) {
            defaultIcon.style.display = 'none';
        }
        if (navAvatar && user.avatarUrl) {
            navAvatar.src = user.avatarUrl;
            navAvatar.style.display = 'inline';
        }
        if (btnText) {
            btnText.textContent = user.nickname || user.username;
        }
        if (profileEmail) {
            profileEmail.textContent = user.email;
        }
        if (dropdownAvatar && user.avatarUrl) {
            dropdownAvatar.src = user.avatarUrl;
        }
        if (userDropdown) {
            userDropdown.style.display = 'block';
        }

        // Ensure click handler is properly attached after login
        const authBtn = document.getElementById('authBtn');
        if (authBtn) {
            // Re-attach the click handler to ensure it works (fixes first-login issue)
            authBtn.onclick = function () {
                const currentUser = AV.User.current();
                if (currentUser) {
                    // User is logged in - toggle dropdown
                    const dropdown = document.getElementById('userDropdown');
                    if (dropdown) {
                        dropdown.classList.toggle('active');
                    }
                } else {
                    // User is not logged in - open login modal
                    if (typeof openAuthModal === 'function') {
                        openAuthModal('login');
                    } else if (typeof toggleLoginModal === 'function') {
                        toggleLoginModal();
                    }
                }
            };
        }

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
            userDropdown.style.display = 'none';
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
    reader.readAsDataURL(file);
}

console.log('✅ LeanCloud 认证函数已加载');
