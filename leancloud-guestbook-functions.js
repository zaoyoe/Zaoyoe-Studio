/**
 * LeanCloud 版本的留言板功能
 * 替换 script.js 中的 Firestore 留言板代码
 */

// ==================== 加载留言板 (LeanCloud 版本) ====================
async function loadGuestbookMessages() {
    console.log('📋 加载留言板消息...');

    try {
        const query = new AV.Query('Message');
        query.include('user');  // 关联查询用户信息
        query.descending('createdAt');  // 按时间倒序
        query.limit(100);  // 限制100条

        const messages = await query.find();

        console.log(`✅ 加载了 ${messages.length} 条留言`);

        // 转换为前端需要的格式
        const formattedMessages = messages.map(msg => ({
            objectId: msg.id,
            userName: msg.get('userName'),
            userAvatar: msg.get('userAvatar'),
            content: msg.get('content') || '',
            imageUrl: msg.get('imageUrl') || '',
            createdAt: msg.get('createdAt'),
            displayTime: msg.get('createdAt').toLocaleString('zh-CN')
        }));

        // 显示留言
        displayMessages(formattedMessages);

        // 缓存到本地
        localStorage.setItem('cached_messages', JSON.stringify(formattedMessages));

        return formattedMessages;

    } catch (error) {
        console.error('加载留言失败:', error);

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
}

// ==================== 发送留言 (LeanCloud 版本) ====================
async function addMessage(content, imageUrl = '') {
    console.log('📝 发送留言...');

    // 检查登录状态
    const currentUser = AV.User.current();
    if (!currentUser) {
        alert('请先登录后再留言');
        return false;
    }

    try {
        // 创建留言对象
        const Message = AV.Object.extend('Message');
        const message = new Message();

        // 设置字段
        message.set('user', currentUser);  // Pointer 类型
        message.set('userName', currentUser.get('nickname') || currentUser.get('username'));
        message.set('userAvatar', currentUser.get('avatarUrl') || '');
        message.set('content', content || '');
        message.set('imageUrl', imageUrl || '');

        // 保存
        await message.save();

        console.log('✅ 留言发送成功');

        // 重新加载留言板
        await loadGuestbookMessages();

        return true;

    } catch (error) {
        console.error('发送留言失败:', error);
        alert(`发送失败: ${error.message || '未知错误'}`);
        return false;
    }
}

// ==================== 删除留言 (可选) ====================
async function deleteMessage(messageId) {
    const currentUser = AV.User.current();
    if (!currentUser) {
        alert('请先登录');
        return false;
    }

    try {
        const query = new AV.Query('Message');
        const message = await query.get(messageId);

        // 检查是否是留言作者
        const messageUser = message.get('user');
        if (messageUser.id !== currentUser.id) {
            alert('只能删除自己的留言');
            return false;
        }

        // 删除
        await message.destroy();
        console.log('✅ 留言已删除');

        // 重新加载
        await loadGuestbookMessages();

        return true;

    } catch (error) {
        console.error('删除留言失败:', error);
        alert(`删除失败: ${error.message}`);
        return false;
    }
}

// ==================== 显示留言 ====================
function displayMessages(messages) {
    const container = document.getElementById('messagesContainer');
    if (!container) {
        console.error('find不到留言容器');
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
    card.dataset.messageId = msg.objectId;

    // 头像
    const avatar = msg.userAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.userName)}&background=random`;

    // 时间
    const time = msg.displayTime || new Date(msg.createdAt).toLocaleString('zh-CN');

    // 检查是否是当前用户的留言
    const currentUser = AV.User.current();
    const isOwnMessage = currentUser && msg.user && currentUser.id === msg.user.id;

    card.innerHTML = `
        <div class="message-header">
            <img src="${avatar}" alt="${msg.userName}" class="message-avatar">
            <div class="message-meta">
                <div class="message-author">${msg.userName}</div>
                <div class="message-time">${time}</div>
            </div>
            ${isOwnMessage ? '<button class="delete-btn" onclick="deleteMessage(\'' + msg.objectId + '\')">删除</button>' : ''}
        </div>
        ${msg.content ? `<div class="message-content">${msg.content}</div>` : ''}
        ${msg.imageUrl ? `<img src="${msg.imageUrl}" alt="留言图片" class="message-image">` : ''}
    `;

    return card;
}

// ==================== 实时订阅更新（可选）====================
function subscribeToMessages() {
    const query = new AV.Query('Message');
    query.descending('createdAt');
    query.limit(100);

    // 订阅新消息
    query.subscribe().then(liveQuery => {
        console.log('✅ 已订阅留言更新');

        // 新消息创建
        liveQuery.on('create', message => {
            console.log('🆕 收到新留言');
            loadGuestbookMessages();  // 重新加载
        });

        // 消息删除
        liveQuery.on('delete', message => {
            console.log('🗑️ 留言被删除');
            loadGuestbookMessages();  // 重新加载
        });

    }).catch(error => {
        console.error('订阅失败:', error);
    });
}

console.log('✅ LeanCloud 留言板函数已加载');
