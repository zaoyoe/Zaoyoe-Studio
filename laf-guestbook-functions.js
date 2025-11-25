/**
 * Laf 版本的留言板功能
 * 替换 script.js 中的 Firestore 留言板代码
 */

// ==================== 加载留言板 (Laf 版本) ====================
async function loadGuestbookMessages() {
    console.log('📋 加载留言板消息...');

    try {
        const result = await window.lafCloud.invoke('messages-list');

        if (result.code === 0) {
            const messages = result.data;
            console.log(`✅ 加载了 ${messages.length} 条留言`);

            // 显示留言
            displayMessages(messages);

            // 缓存到本地
            localStorage.setItem('cached_messages', JSON.stringify(messages));

            return messages;
        } else {
            console.error('加载留言失败:', result.message);

            // 尝试使用缓存
            const cached = localStorage.getItem('cached_messages');
            if (cached) {
                const messages = JSON.parse(cached);
                console.log('📦 使用缓存的留言数据');
                displayMessages(messages);
                return messages;
            }

            return [];
        }

    } catch (error) {
        console.error('加载留言请求失败:', error);

        // 使用缓存
        const cached = localStorage.getItem('cached_messages');
        if (cached) {
            const messages = JSON.parse(cached);
            console.log('📦 使用缓存的留言数据');
            displayMessages(messages);
            return messages;
        }

        return [];
    }
}

// ==================== 发送留言 (Laf 版本) ====================
async function addMessage(message, imageUrl = '') {
    console.log('📝 发送留言...');

    // 检查登录状态
    const token = localStorage.getItem('laf_token');
    if (!token) {
        alert('请先登录后再留言');
        return false;
    }

    try {
        const result = await window.lafCloud.invoke('message-add', {
            content: message,
            imageUrl: imageUrl
        });

        if (result.code === 0) {
            console.log('✅ 留言发送成功');

            // 重新加载留言板
            await loadGuestbookMessages();

            return true;
        } else {
            console.error('发送留言失败:', result.message);
            alert(`发送失败: ${result.message}`);
            return false;
        }

    } catch (error) {
        console.error('发送留言请求失败:', error);
        alert('发送失败，请检查网络连接后重试。');
        return false;
    }
}

// ==================== 显示留言 ====================
function displayMessages(messages) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        console.error('找不到留言容器');
        return;
    }

    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="no-messages">暂无留言</div>';
        return;
    }

    container.innerHTML = '';

    messages.forEach(msg => {
        const messageCard = createMessageCard(msg);
        container.appendChild(messageCard);
    });
}

// ==================== 创建留言卡片 ====================
function createMessageCard(msg) {
    const card = document.createElement('div');
    card.className = 'message-item';

    // 头像
    const avatar = msg.userAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.userName)}&background=random`;

    // 时间
    const time = msg.displayTime || new Date(msg.timestamp).toLocaleString('zh-CN');

    card.innerHTML = `
        <div class="message-header">
            <img src="${avatar}" alt="${msg.userName}" class="message-avatar">
            <div class="message-meta">
                <div class="message-author">${msg.userName}</div>
                <div class="message-time">${time}</div>
            </div>
        </div>
        ${msg.content ? `<div class="message-content">${msg.content}</div>` : ''}
        ${msg.imageUrl ? `<img src="${msg.imageUrl}" alt="留言图片" class="message-image">` : ''}
    `;

    return card;
}

console.log('✅ Laf 留言板函数已加载');
