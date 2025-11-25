/**
 * Laf 版本的认证和数据库函数
 * 替换 script.js 中对应的 Firebase 函数
 */

// ==================== 注册功能 (Laf 版本) ====================
async function handleRegister(event) {
    event.preventDefault();

    const inputCode = document.getElementById('reg-code').value;
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value;
    const username = document.getElementById('reg-username').value;

    // 验证码检查
    if (inputCode !== generatedCode) {
        alert("验证码错误！请检查邮件重新输入。");
        return;
    }

    try {
        // 调用 Laf 云函数进行注册
        const result = await window.lafCloud.invoke('user-register', {
            email: email,
            password: password,
            nickname: username
        });

        if (result.code === 0) {
            // 注册成功
            const { token, user } = result.data;

            // 保存 token 和用户信息
            localStorage.setItem('laf_token', token);
            localStorage.setItem('cached_user_profile', JSON.stringify(user));

            console.log('✅ 注册成功:', user);
            alert(`注册成功！欢迎，${user.nickname}！`);

            // 关闭模态框
            toggleRegisterModal();

            // 更新UI
            updateUserUI(user);

            // 自动切换到登录视图
            setTimeout(() => {
                switchToLoginView();
            }, 500);

        } else {
            // 注册失败
            console.error('注册失败:', result.message);
            alert(`注册失败: ${result.message}`);
        }

    } catch (error) {
        console.error('注册请求失败:', error);
        alert('注册失败，请检查网络连接后重试。');
    }
}

// ==================== 登录功能 (Laf 版本) ====================
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
        // 调用 Laf 云函数进行登录
        const result = await window.lafCloud.invoke('user-login', {
            email: email,
            password: password
        });

        if (result.code === 0) {
            // 登录成功
            const { token, user } = result.data;

            // 保存 token 和用户信息
            localStorage.setItem('laf_token', token);
            localStorage.setItem('cached_user_profile', JSON.stringify(user));

            // 记住我功能（可选）
            if (rememberMe) {
                localStorage.setItem('remember_email', email);
            } else {
                localStorage.removeItem('remember_email');
            }

            console.log('✅ 登录成功:', user);

            // 关闭模态框
            toggleLoginModal();

            // 更新UI
            updateUserUI(user);

        } else {
            // 登录失败
            console.error('登录失败:', result.message);
            alert(`登录失败: ${result.message}`);
        }

    } catch (error) {
        console.error('登录请求失败:', error);
        alert('登录失败，请检查网络连接后重试。');
    }
}

// ==================== 退出登录 (Laf 版本) ====================
function handleLogout() {
    console.log('🚪 退出登录');

    // 清除本地数据
    window.lafLogout();

    // 重置UI
    const authIcon = document.getElementById('authIcon');
    const authText = document.getElementById('authText');
    const userDropdown = document.getElementById('userDropdown');

    if (authIcon) {
        authIcon.innerHTML = '<i class="fas fa-user-circle"></i>';
    }
    if (authText) {
        authText.textContent = '登录 / 注册';
    }
    if (userDropdown) {
        userDropdown.style.display = 'none';
    }

    alert('已退出登录');
}

// ==================== 检查登录状态 (Laf 版本) ====================
async function checkAuthState() {
    console.log('🔍 检查登录状态...');

    const user = await window.checkLafLoginStatus();

    if (user) {
        console.log('✅ 用户已登录:', user);
        updateUserUI(user);
    } else {
        console.log('❌ 用户未登录');
    }
}

// ====================更新用户UI ====================
function updateUserUI(user) {
    const authIcon = document.getElementById('authIcon');
    const authText = document.getElementById('authText');
    const userDropdown = document.getElementById('userDropdown');
    const userEmail = document.getElementById('userEmail');
    const userAvatar = document.getElementById('userAvatar');

    if (authIcon && user.avatarUrl) {
        authIcon.innerHTML = `<img src="${user.avatarUrl}" alt="Avatar" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">`;
    }

    if (authText) {
        authText.textContent = user.nickname || user.email.split('@')[0];
    }

    if (userEmail) {
        userEmail.textContent = user.email;
    }

    if (userAvatar && user.avatarUrl) {
        userAvatar.src = user.avatarUrl;
    }

    if (userDropdown) {
        userDropdown.style.display = 'block';
    }
}

// ==================== 密码重置 (Laf 版本) ====================
let resetCooldownTimer = null;
let resetCooldownSeconds = 0;

async function handlePasswordReset(event) {
    if (event) event.preventDefault();

    console.log("=== Password Reset Started (Laf + Resend) ===");

    const emailInput = document.getElementById('reset-email');
    const submitBtn = document.querySelector('#resetForm button[type="submit"]');

    if (!emailInput || !submitBtn) {
        console.error("Form elements not found!");
        alert("❌ 系统错误：找不到表单元素，请刷新页面重试。");
        return;
    }

    const email = emailInput.value.trim();

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
        // 调用 Laf 云函数发送重置邮件
        const result = await window.lafCloud.invoke('send-password-reset', {
            email: email
        });

        if (result.code === 0) {
            // 成功
            console.log('✅ 重置邮件已发送');
            alert(`✅ 重置密码邮件已发送到 ${email}\n\n请检查您的收件箱，点击邮件中的链接重置密码。`);
            emailInput.value = '';

            // 开始倒计时
            resetCooldownSeconds = 30;
            updateResetButtonCountdown(submitBtn, originalText);

            // 5秒后自动切换回登录
            setTimeout(() => {
                switchToLoginView();
            }, 5000);

        } else {
            // 失败
            console.error('发送失败:', result.message);
            alert(`❌ ${result.message}`);
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }

    } catch (error) {
        console.error('密码重置请求失败:', error);
        alert('❌ 请求失败，请检查网络连接后重试。');
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

    // 等待 Laf SDK 初始化后检查登录状态
    setTimeout(() => {
        checkAuthState();
    }, 500);
});

console.log('✅ Laf 认证函数已加载');
