// Profile security actions for the unified profile modal layout
let phoneCooldownSeconds = 0;

function sanitizePhoneDigits(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function bindPhoneDigitFilter(input) {
    if (!input || input.dataset.phoneDigitsBound === '1') return;

    input.addEventListener('input', () => {
        const sanitized = sanitizePhoneDigits(input.value);
        if (input.value !== sanitized) {
            input.value = sanitized;
        }
    });

    input.dataset.phoneDigitsBound = '1';
}

function initializePhoneDigitFilters() {
    ['mobile_phoneNumberInput'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;

        input.setAttribute('maxlength', '11');
        input.setAttribute('inputmode', 'text');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        bindPhoneDigitFilter(input);
    });
}

function sendPhoneVerificationCode() {
    const phoneInput = document.getElementById('mobile_phoneNumberInput');
    const sendBtn = document.getElementById('mobile_sendPhoneCodeBtn');

    if (!phoneInput || !sendBtn) return;

    const phoneNumber = sanitizePhoneDigits(phoneInput.value);
    phoneInput.value = phoneNumber;

    if (!phoneNumber) {
        alert('请输入手机号');
        return;
    }

    if (phoneCooldownSeconds > 0) {
        return;
    }

    if (typeof window.requestPhoneBindCode !== 'function') {
        alert('后端功能未加载，请刷新页面重试');
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = '发送中...';

    window.requestPhoneBindCode(phoneNumber).then((success) => {
        if (success) {
            phoneCooldownSeconds = 60;
            updatePhoneButtonCountdown(sendBtn, '获取验证码');
            return;
        }

        sendBtn.disabled = false;
        sendBtn.textContent = '获取验证码';
    });
}

function updatePhoneButtonCountdown(button, originalText) {
    if (phoneCooldownSeconds > 0) {
        button.textContent = `${phoneCooldownSeconds}s`;
        button.disabled = true;
        return;
    }

    button.textContent = originalText;
    button.disabled = false;
}

setInterval(() => {
    const button = document.getElementById('mobile_sendPhoneCodeBtn');
    if (!button) return;

    if (phoneCooldownSeconds > 0) {
        phoneCooldownSeconds -= 1;
        button.textContent = `${phoneCooldownSeconds}s`;
        button.disabled = true;
        return;
    }

    if (button.disabled && button.textContent.includes('s')) {
        button.textContent = '获取验证码';
        button.disabled = false;
    }
}, 1000);

function bindPhone() {
    const phoneInput = document.getElementById('mobile_phoneNumberInput');
    const codeInput = document.getElementById('mobile_phoneCodeInput');

    if (!phoneInput || !codeInput) return;

    const phoneNumber = sanitizePhoneDigits(phoneInput.value);
    const code = codeInput.value.trim();
    phoneInput.value = phoneNumber;

    if (!phoneNumber || !code) {
        alert('请输入手机号和验证码');
        return;
    }

    if (typeof window.bindPhoneNumber !== 'function') {
        alert('后端功能未加载，请刷新页面重试');
        return;
    }

    window.bindPhoneNumber(phoneNumber, code).then((success) => {
        if (!success) return;
        phoneInput.value = '';
        codeInput.value = '';
        phoneCooldownSeconds = 0;
    });
}

async function changePassword() {
    const oldPassInput = document.getElementById('mobile_oldPassword');
    const newPassInput = document.getElementById('mobile_newPassword');

    if (!oldPassInput || !newPassInput) {
        console.error('❌ Password inputs not found');
        alert('系统错误：找不到密码输入框');
        return;
    }

    const oldPassword = oldPassInput.value;
    const newPassword = newPassInput.value;

    if (!oldPassword || !newPassword) {
        alert('请输入当前密码和新密码');
        return;
    }

    if (newPassword.length < 6) {
        alert('新密码至少需要6位');
        return;
    }

    const supabase = window.supabaseClient;
    if (!supabase?.auth) {
        alert('系统错误，请刷新页面后重试');
        return;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.email) {
        alert('请先登录');
        return;
    }

    try {
        const { error: verifyError } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: oldPassword
        });

        if (verifyError) throw verifyError;

        const { error: updateError } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (updateError) throw updateError;

        alert('密码修改成功，请使用新密码继续登录。');
        oldPassInput.value = '';
        newPassInput.value = '';
    } catch (error) {
        console.error('❌ Password change failed:', error);

        let errorMsg = '密码修改失败';

        if (
            error?.message?.includes('Invalid login credentials') ||
            error?.message?.includes('invalid_credentials')
        ) {
            errorMsg = '当前密码不正确，请检查后重试。';
        } else if (error?.message?.includes('Password should be at least')) {
            errorMsg = '新密码至少需要6位。';
        } else if (error?.message) {
            errorMsg = '密码修改失败: ' + error.message;
        }

        setTimeout(() => {
            alert(errorMsg);
        }, 100);
    }
}

async function deleteAccount() {
    const t = (key, fallback) => {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const result = window.i18n.t(key);
            if (result && result !== key) return result;
        }
        return fallback;
    };

    const confirmed = confirm(t('security.deleteConfirmPrompt', '⚠️ 您确定要注销账号吗？此操作不可恢复，您的所有数据将被永久删除。'));
    if (!confirmed) return;

    const input = prompt(t('security.deleteTypeConfirm', '请输入 DELETE 以确认注销账号：'));
    if (!input || input.trim().toUpperCase() !== 'DELETE') {
        alert(t('security.deleteCancelled', '注销已取消。'));
        return;
    }

    try {
        const supabase = window.supabaseClient;
        if (!supabase) {
            alert(t('security.systemError', '系统错误，请刷新页面重试'));
            return;
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            alert(t('security.loginRequired', '请先登录'));
            return;
        }

        const { error: deleteError } = await supabase.rpc('fn_delete_own_account');
        if (deleteError) {
            console.error('❌ Account deletion RPC failed:', deleteError);
            alert(t('security.deleteFailed', '注销失败：') + deleteError.message);
            return;
        }

        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.warn('SignOut after delete (expected):', e);
        }

        alert(t('security.deleteSuccess', '账号已成功注销，所有数据已被永久删除。'));
        window.location.href = '/';
    } catch (error) {
        console.error('❌ Account deletion failed:', error);
        alert(t('security.deleteFailed', '注销失败：') + (error.message || '未知错误'));
    }
}

window.sendPhoneVerificationCode = sendPhoneVerificationCode;
window.bindPhone = bindPhone;
window.changePassword = changePassword;
window.deleteAccount = deleteAccount;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePhoneDigitFilters);
} else {
    initializePhoneDigitFilters();
}
