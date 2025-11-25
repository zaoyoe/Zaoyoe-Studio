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

        // 注册
        await user.signUp();

        console.log('✅ 注册成功:', user.toJSON());
        alert(`注册成功！欢迎，${username || email.split('@')[0]}！`);

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
        if (error.code === 202) {
            errorMessage = '该邮箱已被注册';
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
function handleLogout() {
    // 确认对话框
    if (!confirm("确定要退出登录吗？")) return;

    console.log('🚪 退出登录');

    // 退出登录
    AV.User.logOut();

    // 清除记住的凭证
    localStorage.removeItem('remembered_credentials');
    console.log('🗑️ 已清除记住的凭证');

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('active');
    }

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

        // 缓存用户信息
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
});

console.log('✅ LeanCloud 认证函数已加载');
