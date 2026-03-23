(function (window) {
    'use strict';

    let realtimeChannel = null;
    let eventCount = 0;

    function log(message, type) {
        const variant = type || 'info';
        const logArea = document.getElementById('logArea');
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-${variant}">${message}</span>
        `;
        logArea.insertBefore(entry, logArea.firstChild);

        while (logArea.children.length > 50) {
            logArea.removeChild(logArea.lastChild);
        }
    }

    function updateStatus(message, type) {
        const variant = type || 'success';
        const statusDiv = document.getElementById('connectionStatus');
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️'
        };
        statusDiv.innerHTML = `
            <div class="status ${variant}">
                <span class="status-icon">${icons[variant]}</span>
                <span>${message}</span>
            </div>
        `;
    }

    function updateInfo(key, value) {
        const infoGrid = document.getElementById('infoGrid');
        let item = document.getElementById(`info-${key}`);

        if (!item) {
            item = document.createElement('div');
            item.className = 'info-item';
            item.id = `info-${key}`;
            infoGrid.appendChild(item);
        }

        const labels = {
            client: 'Supabase Client',
            channel: 'Realtime Channel',
            state: 'Channel 状态',
            events: '收到的事件数'
        };

        item.innerHTML = `
            <div class="info-label">${labels[key] || key}</div>
            <div class="info-value">${value}</div>
        `;
    }

    async function checkRealtimeStatus() {
        log('检查 Realtime 状态...', 'info');

        if (!window.supabaseClient) {
            updateStatus('Supabase Client 未初始化', 'error');
            log('❌ Supabase Client 未找到', 'error');
            updateInfo('client', '❌ 未连接');
            return;
        }

        updateInfo('client', '✅ 已连接');
        log('✅ Supabase Client 已连接', 'success');

        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (user) {
            log(`✅ 当前用户: ${user.email}`, 'success');
            updateInfo('user', user.email);
        } else {
            log('⚠️ 未登录', 'warning');
            updateInfo('user', '游客');
        }

        if (realtimeChannel) {
            updateInfo('channel', '✅ 已创建');
            updateInfo('state', realtimeChannel.state);
            log(`✅ Channel 状态: ${realtimeChannel.state}`, 'success');
            updateStatus('Realtime 已启用并运行中', 'success');
        } else {
            updateInfo('channel', '❌ 未创建');
            log('❌ Realtime Channel 未创建', 'error');
            updateStatus('Realtime Channel 未初始化', 'error');
        }

        updateInfo('events', eventCount);
    }

    async function testRealtimeConnection() {
        log('开始测试 Realtime 连接...', 'info');

        if (!window.supabaseClient) {
            log('❌ Supabase Client 不可用', 'error');
            updateStatus('无法测试：Supabase Client 未连接', 'error');
            return;
        }

        if (realtimeChannel) {
            log('移除现有 Channel...', 'info');
            await window.supabaseClient.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }

        log('创建新的 Realtime Channel...', 'info');
        realtimeChannel = window.supabaseClient
            .channel('debug-comments-channel')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'prompt_comments' },
                (payload) => {
                    eventCount++;
                    log(`🎉 收到 Realtime 事件！评论 ID: ${payload.new.id}`, 'success');
                    log(`内容: ${payload.new.content}`, 'info');
                    updateInfo('events', eventCount);
                }
            )
            .subscribe((status) => {
                log(`📡 订阅状态: ${status}`, 'info');

                if (status === 'SUBSCRIBED') {
                    log('✅ Realtime 订阅成功！', 'success');
                    updateStatus('Realtime 已成功订阅，等待新评论...', 'success');
                } else if (status === 'CHANNEL_ERROR') {
                    log('❌ Channel 错误', 'error');
                    updateStatus('Channel 订阅失败', 'error');
                } else if (status === 'TIMED_OUT') {
                    log('❌ 连接超时', 'error');
                    updateStatus('连接超时，请检查网络', 'error');
                }

                updateInfo('state', status);
            });

        log('✅ 测试已启动，现在可以在其他浏览器发送评论来测试', 'success');
    }

    function clearLogs() {
        const logArea = document.getElementById('logArea');
        logArea.innerHTML = '<div class="log-entry"><span class="log-time">[已清空]</span><span class="log-info">日志已清空</span></div>';
        log('日志已清空', 'info');
    }

    function bindDebugActions() {
        document.querySelectorAll('[data-debug-action]').forEach((button) => {
            if (button.dataset.debugActionBound === '1') {
                return;
            }

            button.dataset.debugActionBound = '1';
            button.addEventListener('click', async () => {
                switch (button.dataset.debugAction) {
                    case 'refresh-status':
                        await checkRealtimeStatus();
                        break;
                    case 'test-connection':
                        await testRealtimeConnection();
                        break;
                    case 'clear-logs':
                        clearLogs();
                        break;
                    default:
                        break;
                }
            });
        });
    }

    window.addEventListener('DOMContentLoaded', () => {
        log('调试工具已加载', 'success');
        bindDebugActions();

        setTimeout(async () => {
            await checkRealtimeStatus();

            if (window.supabaseClient) {
                log('提示：点击 "测试连接" 按钮开始监听 Realtime 事件', 'info');
            } else {
                log('错误：请确保 supabase-client.js 已正确加载', 'error');
            }
        }, 500);
    });
}(typeof window !== 'undefined' ? window : globalThis));
