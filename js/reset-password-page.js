(function () {
    'use strict';

    const { url: SUPABASE_URL, publishableKey: SUPABASE_KEY } = window.requireZaoyoeSupabaseConfig();
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    async function handleNewPasswordSubmit(event) {
        event.preventDefault();

        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const statusMsg = document.getElementById('statusMessage');
        const submitBtn = document.getElementById('submitBtn');
        const btnSpan = submitBtn.querySelector('span');

        statusMsg.style.display = 'none';
        statusMsg.className = 'status-message';

        if (newPassword !== confirmPassword) {
            statusMsg.textContent = '❌ 两次输入的密码不一致';
            statusMsg.style.display = 'block';
            return;
        }

        if (newPassword.length < 6) {
            statusMsg.textContent = '❌ 密码长度不能少于6位';
            statusMsg.style.display = 'block';
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

            statusMsg.textContent = '✅ 密码修改成功，正在返回主页...';
            statusMsg.className = 'status-message success';
            statusMsg.style.display = 'block';

            btnSpan.textContent = '修改成功';
            window.location.href = 'index.html';
        } catch (error) {
            console.error('修改密码失败:', error);
            if (error.message.includes('Auth session missing') || error.message.includes('invalid')) {
                statusMsg.textContent = '❌ 链接已失效或过期，请重新发起密码找回。';
            } else {
                statusMsg.textContent = `❌ ${error.message || '系统错误，请重试'}`;
            }
            statusMsg.style.display = 'block';
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
                statusMsg.textContent = '无效的重置链接，或者链接已过期。请重新获取重置邮件。';
                statusMsg.style.display = 'block';
                submitBtn.disabled = true;
            }
            return;
        }

        if (window.location.search.includes('error=')) {
            const params = new URLSearchParams(window.location.search);
            statusMsg.textContent = `错误: ${params.get('error_description') || '无效的重置请求'}`;
            statusMsg.style.display = 'block';
            submitBtn.disabled = true;
        }
    });
}());
