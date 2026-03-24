(function () {
    'use strict';

    const { url: SUPABASE_URL, publishableKey: SUPABASE_KEY } = window.requireZaoyoeSupabaseConfig();
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    function resetStatusMessage(statusMsg) {
        statusMsg.hidden = true;
        statusMsg.textContent = '';
        statusMsg.classList.remove('success');
    }

    function showStatusMessage(statusMsg, message, options = {}) {
        const { success = false } = options;

        statusMsg.textContent = message;
        statusMsg.hidden = false;
        statusMsg.classList.toggle('success', success);
    }

    async function handleNewPasswordSubmit(event) {
        event.preventDefault();

        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const statusMsg = document.getElementById('statusMessage');
        const submitBtn = document.getElementById('submitBtn');
        const btnSpan = submitBtn.querySelector('span');

        resetStatusMessage(statusMsg);

        if (newPassword !== confirmPassword) {
            showStatusMessage(statusMsg, '❌ 两次输入的密码不一致');
            return;
        }

        if (newPassword.length < 6) {
            showStatusMessage(statusMsg, '❌ 密码长度不能少于6位');
            return;
        }

        submitBtn.disabled = true;
        btnSpan.textContent = '修改中...';

        try {
            const { error } = await window.supabaseClient.auth.updateUser({
                password: newPassword
            });

            if (error) {
                throw error;
            }

            showStatusMessage(statusMsg, '✅ 密码修改成功，正在返回主页...', { success: true });

            btnSpan.textContent = '修改成功';
            window.location.href = 'index.html';
        } catch (error) {
            console.error('修改密码失败:', error);
            if (error.message.includes('Auth session missing') || error.message.includes('invalid')) {
                showStatusMessage(statusMsg, '❌ 链接已失效或过期，请重新发起密码找回。');
            } else {
                showStatusMessage(statusMsg, `❌ ${error.message || '系统错误，请重试'}`);
                submitBtn.disabled = false;
                btnSpan.textContent = '确认修改';
                return;
            }
            submitBtn.disabled = false;
            btnSpan.textContent = '确认修改';
        }
    }

    document.getElementById('resetPasswordForm')?.addEventListener('submit', handleNewPasswordSubmit);

    document.addEventListener('DOMContentLoaded', async () => {
        const hash = window.location.hash;
        const statusMsg = document.getElementById('statusMessage');
        const submitBtn = document.getElementById('submitBtn');

        if (!hash && !window.location.search.includes('error')) {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) {
                showStatusMessage(statusMsg, '无效的重置链接，或者链接已过期。请重新获取重置邮件。');
                submitBtn.disabled = true;
            }
            return;
        }

        if (window.location.search.includes('error=')) {
            const params = new URLSearchParams(window.location.search);
            showStatusMessage(statusMsg, `错误: ${params.get('error_description') || '无效的重置请求'}`);
            submitBtn.disabled = true;
        }
    });
}());
