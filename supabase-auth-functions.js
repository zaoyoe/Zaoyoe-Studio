/**
 * Supabase 版本的认证和用户管理函数
 * 替换 leancloud-auth-functions.js
 */

// ==================== 注册功能 (Supabase 版本) ====================
async function handleRegister(event) {
    event.preventDefault();

    const inputCode = document.getElementById('reg-code').value;
    const password = document.getElementById('reg-password').value;
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();

    // 验证码检查
    if (inputCode !== generatedCode) {
        alert("验证码错误！请检查邮件重新输入。");
        return;
    }

    try {
        // 检查用户名是否已被使用
        const { data: existingUsers } = await window.supabaseClient
            .from('profiles')
            .select('username')
            .eq('username', username)
            .limit(1);

        if (existingUsers && existingUsers.length > 0) {
            alert("该用户名已被使用，请选择其他用户名。");
            return;
        }

        // 注册用户
        const { data, error } = await window.supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: username || email.split('@')[0],
                    avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(username || email.split('@')[0])}&background=random`
                }
            }
        });

        if (error) throw error;

        console.log('✅ User created:', data.user.id);

        // 关闭模态框
        toggleLoginModal();

        // 更新UI
        updateUserUI({
            objectId: data.user.id,
            username: email,
            email: email,
            nickname: username || email.split('@')[0],
            avatarUrl: data.user.user_metadata?.avatar_url
        });

    } catch (error) {
        console.error('注册失败:', error);

        let errorMessage = '注册失败';
        if (error.message.includes('already registered')) {
            errorMessage = '该邮箱已被注册。';
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`注册失败: ${errorMessage}`);
    }
}

// ==================== 登录功能 (Supabase 版本) ====================
async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

    if (!email || !password) {
        alert("请输入邮箱和密码");
        return;
    }

    try {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        console.log('✅ 登录成功:', data.user);

        // 获取用户 profile
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        // 记住我功能
        if (rememberMe) {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);

            const credentials = {
                email: email,
                password: btoa(password),
                expiry: expiryDate.getTime()
            };

            localStorage.setItem('remembered_credentials', JSON.stringify(credentials));

            // 多账号密码库
            let savedPasswords = {};
            try {
                const saved = localStorage.getItem('saved_passwords');
                if (saved) savedPasswords = JSON.parse(saved);
            } catch (e) { console.error('读取密码库失败', e); }

            savedPasswords[email] = btoa(password);
            localStorage.setItem('saved_passwords', JSON.stringify(savedPasswords));
        } else {
            localStorage.removeItem('remembered_credentials');
        }

        // 关闭模态框
        toggleLoginModal();

        // 更新UI
        updateUserUI({
            objectId: data.user.id,
            username: data.user.email,
            email: data.user.email,
            nickname: profile?.username || data.user.user_metadata?.full_name || data.user.email.split('@')[0],
            avatarUrl: profile?.avatar_url || data.user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(data.user.email)}&background=random`
        });

        // 刷新留言板点赞状态
        if (typeof loadGuestbookMessages === 'function') {
            console.log('🔄 登录成功，刷新留言板点赞状态...');
            loadGuestbookMessages(true);
        }

    } catch (error) {
        console.error('登录失败:', error);

        let errorMessage = '登录失败';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = '用户名或密码错误';
        } else {
            errorMessage = error.message || '未知错误';
        }

        alert(`登录失败: ${errorMessage}`);
    }
}

// ==================== 退出登录 (Supabase 版本) ====================
async function handleLogout(event) {
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');

    if (dropdown) dropdown.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    if (!confirm("确定要退出登录吗？")) return;

    console.log('🚪 退出登录');

    try {
        await window.supabaseClient.auth.signOut();
    } catch (error) {
        console.error('❌ Supabase logout failed:', error);
    }

    localStorage.removeItem('remembered_credentials');
    console.log('🗑️ 已清除自动登录凭证');

    // 重置UI
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');

    if (defaultIcon) defaultIcon.style.display = 'inline';
    if (navAvatar) navAvatar.style.display = 'none';
    if (btnText) btnText.textContent = 'Sign In';

    const authBtn = document.getElementById('authBtn');
    if (authBtn) authBtn.classList.remove('logged-in');

    const userDropdown = document.getElementById('userDropdown');
    if (userDropdown) userDropdown.classList.remove('active');
}

window.handleLogout = handleLogout;

// ==================== 处理 Auth 按钮点击 ====================
async function handleAuthClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    console.log('🔘 handleAuthClick triggered');

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    console.log('👤 Current User:', user ? user.id : 'null');

    if (user) {
        // User is logged in - toggle dropdown
        const dropdown = document.getElementById('userDropdown');
        const overlay = document.getElementById('dropdownOverlay');

        if (dropdown) {
            const isActive = dropdown.classList.contains('active');
            if (isActive) {
                dropdown.classList.remove('active');
                if (overlay) overlay.classList.remove('active');
            } else {
                dropdown.classList.add('active');
                if (overlay) overlay.classList.add('active');
            }
        }
    } else {
        // User is not logged in - open login modal
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.classList.add('active');
        }
    }
}

window.handleAuthClick = handleAuthClick;

// ==================== 检查登录状态 (Supabase 版本) ====================
async function checkAuthState() {
    console.log('🔍 检查登录状态...');

    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (user) {
        console.log('✅ 用户已登录:', user);

        // 获取 profile
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
            avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=random`
        });
    } else {
        console.log('❌ 用户未登录');
        updateUserUI(null);
    }
}

// ==================== 更新用户UI ====================
function updateUserUI(user) {
    const defaultIcon = document.getElementById('defaultAuthIcon');
    const navAvatar = document.getElementById('navUserAvatar');
    const btnText = document.getElementById('authBtnText');
    const userDropdown = document.getElementById('userDropdown');
    const profileModalEmail = document.getElementById('profileModalEmail');
    const profileModalAvatar = document.getElementById('profileModalAvatar');

    if (user) {
        console.log('👤 updateUserUI: 用户已登录', user);

        if (defaultIcon) defaultIcon.style.display = 'none';
        if (navAvatar) {
            navAvatar.classList.remove('animate-in');
            navAvatar.style.display = 'inline-block';
            navAvatar.style.visibility = 'visible';
            navAvatar.style.opacity = '1';

            if (user.avatarUrl) {
                navAvatar.src = user.avatarUrl;
            } else {
                navAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nickname || user.username || 'User')}&background=random`;
            }

            setTimeout(() => {
                navAvatar.classList.add('animate-in');
            }, 50);
        }
        if (btnText) {
            btnText.textContent = user.nickname || user.username || 'User';
        }

        const authBtn = document.getElementById('authBtn');
        if (authBtn) authBtn.classList.add('logged-in');

        if (profileModalEmail) profileModalEmail.textContent = user.email || '未绑定邮箱';
        if (profileModalAvatar && user.avatarUrl) profileModalAvatar.src = user.avatarUrl;
        if (userDropdown) userDropdown.style.display = '';

        localStorage.setItem('cached_user_profile', JSON.stringify(user));
    } else {
        if (defaultIcon) defaultIcon.style.display = 'inline';
        if (navAvatar) navAvatar.style.display = 'none';
        if (btnText) btnText.textContent = 'Sign In';
        if (userDropdown) userDropdown.classList.remove('active');

        localStorage.removeItem('cached_user_profile');
    }
}

// ==================== 密码重置 (Supabase 版本) ====================
let resetCooldownTimer = null;
let resetCooldownSeconds = 0;

async function handlePasswordReset(event) {
    if (event) event.preventDefault();

    const emailInput = document.getElementById('reset-email');
    const submitBtn = document.querySelector('#resetForm button[type="submit"]');

    if (!emailInput || !submitBtn) {
        alert("❌ 系统错误：找不到表单元素，请刷新页面重试。");
        return;
    }

    const email = emailInput.value.trim();

    if (!email) {
        alert("❌ 请输入邮箱地址");
        return;
    }

    if (resetCooldownSeconds > 0) {
        alert(`⏱️ 请等待 ${resetCooldownSeconds} 秒后再试`);
        return;
    }

    const originalText = submitBtn.textContent;
    submitBtn.textContent = '发送中...';
    submitBtn.disabled = true;

    try {
        const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        });

        if (error) throw error;

        console.log('✅ 重置邮件已发送');
        alert(`✅ 重置密码邮件已发送到 ${email}\n\n请检查您的收件箱（包括垃圾邮件），点击邮件中的链接重置密码。`);
        emailInput.value = '';

        resetCooldownSeconds = 30;
        updateResetButtonCountdown(submitBtn, originalText);

        setTimeout(() => {
            switchAuthView('login');
        }, 5000);

    } catch (error) {
        console.error('密码重置失败:', error);
        alert(`❌ ${error.message || '发送失败'}`);
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

// ==================== Google OAuth 登录 (Supabase 版本) ====================
async function handleGoogleLogin() {
    console.log('🔵 Google Login button clicked');

    try {
        const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) throw error;

        // OAuth will redirect, so nothing to do here
        console.log('🔄 Redirecting to Google...');

    } catch (error) {
        console.error('❌ Google login error:', error);
        alert('Google 登录失败: ' + error.message);
    }
}

window.handleGoogleLogin = handleGoogleLogin;

// ==================== 头像上传 (Supabase 版本) ====================
async function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        alert("图片大小不能超过 2MB");
        return;
    }

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
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

            const base64String = canvas.toDataURL('image/jpeg', 0.8);

            try {
                // Update profile in Supabase
                const { error } = await window.supabaseClient
                    .from('profiles')
                    .update({ avatar_url: base64String })
                    .eq('id', user.id);

                if (error) throw error;

                console.log('✅ Avatar updated in Supabase');

                // Update UI
                const { data: profile } = await window.supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();

                updateUserUI({
                    objectId: user.id,
                    username: user.email,
                    email: user.email,
                    nickname: profile?.username || user.user_metadata?.full_name,
                    avatarUrl: base64String
                });

                alert("头像更新成功！");

            } catch (error) {
                console.error("❌ Error updating avatar:", error);
                alert(`更新失败: ${error.message}`);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

window.handleAvatarUpload = handleAvatarUpload;

// ==================== 触发头像上传 ====================
function triggerAvatarUpload() {
    const input = document.getElementById('avatarUpload');
    if (input) {
        input.click();
    } else {
        console.warn('❌ Avatar upload input not found');
    }
}

window.triggerAvatarUpload = triggerAvatarUpload;

// ==================== 强制登出 ====================
async function forceLogout(event) {
    if (event) event.stopPropagation();

    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');
    if (dropdown) dropdown.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    if (!confirm("确定要退出登录吗？")) return;

    try {
        await window.supabaseClient.auth.signOut();
    } catch (e) {
        console.error('Supabase signOut error:', e);
    }

    localStorage.removeItem('remembered_credentials');
    localStorage.removeItem('cached_user_profile');

    updateUserUI(null);
    console.log('✅ 已强制登出');
}

window.forceLogout = forceLogout;

// ==================== 页面加载时检查登录状态 ====================
document.addEventListener('DOMContentLoaded', async function () {
    console.log('📄 页面加载完成');

    // 等待 Supabase 客户端初始化
    if (!window.supabaseClient) {
        console.warn('⚠️ Supabase client not ready, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 检查登录状态
    await checkAuthState();

    // 监听邮箱输入变化，自动填充密码
    const loginEmailInput = document.getElementById('login-email');
    if (loginEmailInput) {
        loginEmailInput.addEventListener('input', function () {
            const email = this.value.trim();

            try {
                const savedPasswordsStr = localStorage.getItem('saved_passwords');
                if (savedPasswordsStr) {
                    const savedPasswords = JSON.parse(savedPasswordsStr);
                    if (savedPasswords[email]) {
                        const loginPasswordInput = document.getElementById('login-password');
                        if (loginPasswordInput) {
                            loginPasswordInput.value = atob(savedPasswords[email]);
                            console.log('✨ 已自动填充密码 for:', email);
                        }
                    }
                }
            } catch (e) {
                console.error('自动填充密码失败:', e);
            }
        });
    }

    // 全局点击监听器关闭下拉菜单
    document.addEventListener('click', function (event) {
        const dropdown = document.getElementById('userDropdown');
        const authBtn = document.getElementById('authBtn');

        if (dropdown && authBtn &&
            !authBtn.contains(event.target) &&
            !dropdown.contains(event.target)) {
            dropdown.classList.remove('active');
        }
    });

    // 监听 Supabase Auth 状态变化
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
        console.log('🔔 Auth state changed:', event);
        if (event === 'SIGNED_IN' && session) {
            checkAuthState();
        } else if (event === 'SIGNED_OUT') {
            updateUserUI(null);
        }
    });
});

// ==================== 打开个人资料模态框 (Supabase 版本) ====================
async function openProfileModal(event) {
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    const overlay = document.getElementById('dropdownOverlay');
    if (dropdown) dropdown.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    // 获取当前用户
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        alert('请先登录');
        return;
    }

    // 检查是否在主页
    const modal = document.getElementById('profileModal');
    if (!modal) {
        // 不在主页，跳转到主页并设置标记打开模态框
        sessionStorage.setItem('openProfileModal', 'true');
        window.location.href = 'index.html';
        return;
    }

    // 获取 profile
    const { data: profile } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    // 更新模态框内容
    const avatarImg = document.getElementById('profileModalAvatar');
    const emailDiv = document.getElementById('profileModalEmail');
    const nicknameSpan = document.getElementById('profileModalNickname');
    const memberSinceSpan = document.getElementById('profileMemberSince');

    if (avatarImg) {
        avatarImg.src = profile?.avatar_url || user.user_metadata?.avatar_url ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(user.email)}&background=random`;
    }

    if (emailDiv) {
        emailDiv.textContent = user.email;
    }

    if (nicknameSpan) {
        nicknameSpan.textContent = profile?.username || user.user_metadata?.full_name || user.email.split('@')[0];
    }

    if (memberSinceSpan) {
        const createdAt = new Date(user.created_at);
        const year = createdAt.getFullYear();
        const month = createdAt.getMonth() + 1;
        const day = createdAt.getDate();
        memberSinceSpan.textContent = `注册于 ${year}年${month}月${day}日`;
    }

    // 打开模态框
    modal.classList.add('active');
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.display = 'flex';

    // 重置到资料页面
    const flipInner = document.querySelector('.profile-flip-inner');
    if (flipInner) {
        flipInner.classList.remove('flipped');
    }

    // 重置tab状态
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    const profileTab = document.querySelector('.tab-item:first-child');
    if (profileTab) {
        profileTab.classList.add('active');
    }

    // Reset modal to compact width
    const profileModalElement = document.querySelector('.profile-modal');
    if (profileModalElement) {
        profileModalElement.classList.remove('wide');
    }

    // 触发资料页面的错落上升动画
    const profileFront = document.querySelector('.profile-front');
    if (profileFront) {
        setTimeout(() => {
            profileFront.classList.remove('animate-in');
            void profileFront.offsetWidth;
            profileFront.classList.add('animate-in');
        }, 50);
    }
}

window.openProfileModal = openProfileModal;

// ==================== 切换账户 (Supabase 版本) ====================
async function handleSwitchAccount(event) {
    if (event) {
        event.stopPropagation();
    }

    // 关闭下拉菜单
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) dropdown.classList.remove('active');

    console.log('🔄 切换账户');

    // 退出登录
    try {
        await window.supabaseClient.auth.signOut();
    } catch (e) {
        console.error('Supabase signOut error:', e);
    }

    // 清除记住的凭证
    localStorage.removeItem('remembered_credentials');
    console.log('🗑️ 已清除记住的凭证');

    // 重置UI为未登录状态
    updateUserUI(null);

    // 打开登录弹窗
    setTimeout(() => {
        const loginModal = document.getElementById('loginModal');
        if (loginModal) {
            loginModal.classList.add('active');
        }
    }, 100);
}

window.handleSwitchAccount = handleSwitchAccount;

// ==================== Tab 切换功能 ====================
function switchProfileTab(tabName) {
    console.log('🔄 Switching profile tab to:', tabName);

    const profileModal = document.querySelector('.profile-modal');
    const flipInner = document.querySelector('.profile-flip-inner');
    const profileFront = document.querySelector('.profile-front');
    const profileBack = document.querySelector('.profile-back');

    // Update tab buttons
    document.querySelectorAll('.tab-item').forEach(item => {
        item.classList.remove('active');
    });

    if (tabName === 'profile') {
        document.querySelector('.tab-item:first-child').classList.add('active');
        if (flipInner) flipInner.classList.remove('flipped');
        if (profileModal) profileModal.classList.remove('wide');

        if (profileFront) profileFront.style.pointerEvents = 'auto';
        if (profileBack) profileBack.style.pointerEvents = 'none';

        if (profileFront) {
            profileFront.classList.remove('animate-in');
            void profileFront.offsetWidth;
            profileFront.classList.add('animate-in');
        }
        if (profileBack) {
            profileBack.classList.remove('animate-in');
        }

    } else if (tabName === 'security') {
        document.querySelector('.tab-item:last-child').classList.add('active');
        if (flipInner) flipInner.classList.add('flipped');
        if (profileModal) profileModal.classList.add('wide');

        if (profileFront) profileFront.style.pointerEvents = 'none';
        if (profileBack) profileBack.style.pointerEvents = 'auto';

        if (typeof resetSecurityCards === 'function') {
            resetSecurityCards();
        }

        if (profileBack) {
            profileBack.classList.remove('animate-in');
            void profileBack.offsetWidth;
            profileBack.classList.add('animate-in');
        }
        if (profileFront) {
            profileFront.classList.remove('animate-in');
        }
    }
}

window.switchProfileTab = switchProfileTab;

// ==================== 昵称修改功能 ====================
function toggleNicknameEdit(show) {
    const display = document.getElementById('nicknameDisplay');
    const edit = document.getElementById('nicknameEdit');
    const input = document.getElementById('nicknameInput');
    const currentNickname = document.getElementById('profileModalNickname').textContent;

    if (show) {
        display.classList.add('hiding');
        display.classList.remove('showing');
        setTimeout(() => {
            display.style.display = 'none';
            edit.style.display = 'flex';
            input.value = currentNickname;
            void edit.offsetWidth;
            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);
        }, 300);
    } else {
        edit.style.display = 'none';
        display.style.display = 'flex';
        display.classList.remove('hiding');
        void display.offsetWidth;
        display.classList.add('showing');
        setTimeout(() => {
            display.classList.remove('showing');
        }, 400);
    }
}

window.toggleNicknameEdit = toggleNicknameEdit;

// ==================== 保存昵称 (Supabase 版本) ====================
async function saveNickname() {
    const input = document.getElementById('nicknameInput');
    const newNickname = input.value.trim();

    if (!newNickname) return;

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (user) {
        try {
            // Update profile in Supabase
            const { error } = await window.supabaseClient
                .from('profiles')
                .update({ username: newNickname })
                .eq('id', user.id);

            if (error) throw error;

            // Update UI
            document.getElementById('profileModalNickname').textContent = newNickname;

            const { data: profile } = await window.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            updateUserUI({
                objectId: user.id,
                username: user.email,
                email: user.email,
                nickname: newNickname,
                avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url
            });

            toggleNicknameEdit(false);

        } catch (error) {
            alert('保存失败: ' + error.message);
            console.error(error);
        }
    }
}

window.saveNickname = saveNickname;

// 挂载到 window
window.handleRegister = handleRegister;
window.handleLogin = handleLogin;
window.handlePasswordReset = handlePasswordReset;
window.checkAuthState = checkAuthState;
window.updateUserUI = updateUserUI;
