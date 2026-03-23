(function () {
    'use strict';

    const runtimeConfig = window.getZaoyoeSupabaseConfig?.() || null;
    let client;
    let channel;

    function hasConfiguredSupabase() {
        return Boolean(runtimeConfig?.url && runtimeConfig?.publishableKey);
    }

    function log(message) {
        const logElement = document.getElementById('log');
        if (!logElement) {
            return;
        }

        const time = new Date().toLocaleTimeString();
        logElement.innerHTML = `[${time}] ${message}<br>${logElement.innerHTML}`;
    }

    function showStatus(message, success = true) {
        const statusElement = document.getElementById('status');
        if (!statusElement) {
            return;
        }

        statusElement.className = `status ${success ? 'success' : 'error'}`;
        statusElement.textContent = message;
    }

    async function testConnection() {
        try {
            if (!hasConfiguredSupabase()) {
                showStatus('缺少 Supabase runtime config，请先加载 /api/runtime/supabase-config', false);
                log('❌ 缺少 Supabase runtime config');
                return;
            }

            log('初始化 Supabase Client...');
            client = supabase.createClient(runtimeConfig.url, runtimeConfig.publishableKey);
            log('✅ Client 创建成功');

            const {
                data: { user }
            } = await client.auth.getUser();
            log(user ? `当前用户: ${user.email}` : '未登录（游客模式）');

            log('创建 Realtime Channel...');
            channel = client
                .channel('test-comments')
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'prompt_comments' },
                    (payload) => {
                        log(`🎉 收到新评论事件！ID: ${payload.new.id}`);
                        log(`内容: ${payload.new.content}`);
                        showStatus('✅ Realtime 工作正常！收到了新评论通知', true);
                    }
                )
                .subscribe((status) => {
                    log(`订阅状态: ${status}`);

                    if (status === 'SUBSCRIBED') {
                        showStatus('✅ 成功订阅！现在在其他浏览器发送评论测试', true);
                        log('✅ 订阅成功！等待新评论...');
                    } else if (status === 'CHANNEL_ERROR') {
                        showStatus('❌ 订阅失败！请检查配置', false);
                        log('❌ Channel 错误');
                    }
                });

            log('测试启动完成。请在其他浏览器窗口发送评论。');
        } catch (error) {
            log(`❌ 错误: ${error.message}`);
            showStatus(`❌ 测试失败: ${error.message}`, false);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('testConnectionBtn')?.addEventListener('click', () => {
            void testConnection();
        });
        log('页面已加载，点击按钮开始测试');
    });

    window.addEventListener('beforeunload', () => {
        if (channel?.unsubscribe) {
            channel.unsubscribe();
        }
    });
}());
