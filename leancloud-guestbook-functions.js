/**
 * LeanCloud 版本的留言板功能
 * 替换 script.js 中的 Firestore 留言板代码
 */

// ==================== 辅助函数：防止 XSS ====================
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== 加载留言板 (LeanCloud 版本) ====================
async function loadGuestbookMessages() {
    console.log('📋 加载留言板消息...');

    const container = document.getElementById('messageContainer');
    const emptyState = document.getElementById('emptyState');

    try {
        const query = new AV.Query('Message');
        // 不使用 include('user') 避免 ACL 权限问题
        // 用户信息已经存储在 userName 和 userAvatar 字段中
        query.descending('createdAt');  // 按时间倒序
        query.limit(100);  // 限制100条

        const messages = await query.find();

        console.log(`✅ 加载了 ${messages.length} 条留言`);

        // 转换为 guestbook.js 期望的格式
        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            name: msg.get('userName'),
            avatarUrl: msg.get('userAvatar') || '',
            content: msg.get('content') || '',
            image: msg.get('imageUrl') || null,
            timestamp: msg.get('createdAt').toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }),
            comments: [] // 初始为空，稍后填充
        }));

        // 2. 获取所有相关的评论
        // 为了减少请求，我们可以一次性获取这些消息的所有评论
        // 或者简单点，为每条消息单独获取（如果消息不多）
        // 这里采用一次性获取所有相关评论的方法 (Query IN)

        const messageIds = messages.map(m => m); // Keep AV.Objects

        const commentQuery = new AV.Query('Comment');
        commentQuery.containedIn('message', messageIds);
        // 关键修复：必须 include parentComment 才能获取到指针数据
        commentQuery.include('parentComment');
        // 不使用 include('user') 避免 ACL 权限问题
        // 用户信息已经存储在 userName 字段中
        commentQuery.ascending('createdAt'); // 评论按时间正序
        commentQuery.limit(1000);

        const comments = await commentQuery.find();
        console.log(`✅ 加载了 ${comments.length} 条评论`);

        // 3. 构建评论树结构（支持嵌套回复）
        // 3.1 先格式化所有评论为对象
        const commentMap = new Map(); // 用于快速查找评论
        const topLevelComments = []; // 顶级评论（直接回复留言）

        comments.forEach(comment => {
            // 🔧 FIX: 获取 parentUserName，如果是字符串 "null" 或 "undefined"，转换为实际的 null
            const rawParentUserName = comment.get('parentUserName');
            const parentUserName = (rawParentUserName && rawParentUserName !== 'null' && rawParentUserName !== 'undefined')
                ? rawParentUserName
                : null;

            const rawParent = comment.get('parentComment');

            // 🔍 DEBUG: 打印第一个评论的完整数据，查看是否有其他字段存储了父ID
            if (comments.indexOf(comment) === 0) {
                console.log('  🔍 第一个评论的完整数据 (toJSON):', comment.toJSON());
            }

            // 🔍 DEBUG: 专门检查有 parentUserName 但没有 parentComment 指针的情况
            if (parentUserName && !rawParent) {
                console.warn(`  ⚠️ 发现“孤儿”回复 (有名字无指针): ${comment.id}, parentUserName=${parentUserName}`);
                if (!window.hasLoggedOrphan) {
                    console.log('  🔍 孤儿回复完整数据:', comment.toJSON());
                    window.hasLoggedOrphan = true;
                }
            }

            // 尝试获取 ID
            let pId = null;
            if (rawParent) {
                if (typeof rawParent === 'string') {
                    pId = rawParent;
                } else if (rawParent.id) {
                    pId = rawParent.id;
                } else if (rawParent.objectId) {
                    pId = rawParent.objectId;
                }
            }

            // 过滤无效 ID
            if (pId === 'null' || pId === 'undefined') pId = null;

            const formattedComment = {
                id: comment.id,
                name: comment.get('userName') || '匿名用户', // Fallback for legacy comments
                content: comment.get('content'),
                timestamp: comment.get('createdAt').toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                messageId: comment.get('message')?.id,
                parentCommentId: pId,
                parentUserName: parentUserName, // 🆕 父评论者名字（用于 @mention）
                replies: [] // 存储子评论
            };

            commentMap.set(comment.id, formattedComment);

            // 如果没有 parentComment，就是顶级评论
            if (!formattedComment.parentCommentId) {
                topLevelComments.push(formattedComment);
            }
        });

        // 3.2 构建树结构：将回复添加到父评论的 replies 数组
        console.log(`🌳 开始构建评论树，共 ${commentMap.size} 条评论`);
        commentMap.forEach(comment => {
            console.log(`  - 评论 ${comment.id.substring(0, 8)}: name="${comment.name}", parentCommentId="${comment.parentCommentId}"`);

            if (comment.parentCommentId) {
                console.log(`    🔗 这是一个回复，查找父评论: ${comment.parentCommentId.substring(0, 8)}`);
                const parent = commentMap.get(comment.parentCommentId);

                if (parent) {
                    console.log(`    ✅ 找到父评论: ${parent.name}`);
                    parent.replies.push(comment);
                    console.log(`    📝 已添加到父评论的 replies 数组，现在有 ${parent.replies.length} 个回复`);

                    // 🆕 向后兼容：如果数据库中没有存储 parentUserName，从父评论中获取
                    if (!comment.parentUserName && parent.name) {
                        comment.parentUserName = parent.name;
                        console.log(`    🔧 设置 parentUserName = "${parent.name}"`);
                    }
                } else {
                    console.warn(`    ⚠️ 找不到父评论 ${comment.parentCommentId}，将评论 ${comment.id} 作为顶级评论`);
                    // 如果找不到父评论，降级为顶级评论
                    topLevelComments.push(comment);
                }
            } else {
                console.log(`    📌 这是一个顶级评论（直接回复留言）`);
            }
        });

        // 3.3 将顶级评论分配给对应的消息
        topLevelComments.forEach(comment => {
            const targetMsg = formattedMessages.find(m => m.id === comment.messageId);
            if (targetMsg) {
                targetMsg.comments.push(comment);
            }
        });

        // 显示留言（使用 guestbook.js 的 renderMessages）
        if (typeof renderMessages === 'function') {
            renderMessages(formattedMessages);
        } else {
            // 等待 renderMessages 定义
            console.warn('⚠️ renderMessages 未定义，等待加载...');
            // 不做任何fallback显示，避免乱码闪烁
        }

        // 缓存到本地
        localStorage.setItem('cached_messages', JSON.stringify(formattedMessages));

        // Store for debugging
        window.lastLoadedMessages = formattedMessages;

        return formattedMessages;

    } catch (error) {
        console.error('❌ 加载留言失败:', error);
        console.error('错误详情:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });

        // 尝试使用缓存
        const cached = localStorage.getItem('cached_messages');
        if (cached) {
            try {
                const messages = JSON.parse(cached);
                console.log('📦 使用缓存的留言数据');

                if (typeof renderMessages === 'function') {
                    renderMessages(messages);
                } else {
                    console.error('❌ renderMessages function not found');
                }
                return messages;
            } catch (parseError) {
                console.error('❌ 解析缓存数据失败:', parseError);
            }
        }

        // 显示详细错误信息
        if (container) {
            const errorDetails = error.message || '未知错误';
            container.innerHTML = `
                <div style="text-align:center; color: #ff6b6b; padding: 40px;">
                    <div style="font-size: 18px; margin-bottom: 10px;">加载留言失败</div>
                    <div style="font-size: 14px; opacity: 0.8; margin-bottom: 20px;">错误: ${errorDetails}</div>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 8px; cursor: pointer;">
                        重新加载
                    </button>
                </div>
            `;
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

// ==================== 发送评论 (LeanCloud 版本) ====================
async function addCommentToMessage(messageId, content) {
    console.log(`💬 发送评论给消息 ${messageId}...`);

    const currentUser = AV.User.current();
    if (!currentUser) {
        alert('请先登录后再评论');
        return false;
    }

    try {
        // 1. 获取消息对象 (Pointer)
        const message = AV.Object.createWithoutData('Message', messageId);

        // 2. 创建评论对象
        const Comment = AV.Object.extend('Comment');
        const comment = new Comment();

        comment.set('user', currentUser);
        comment.set('message', message);
        comment.set('userName', currentUser.get('nickname') || currentUser.get('username'));
        comment.set('userAvatar', currentUser.get('avatarUrl') || '');
        comment.set('content', content);

        // 3. 保存
        await comment.save();
        console.log('✅ 评论发送成功');

        // 4. 重新加载留言板 (或者只更新局部，但重新加载最简单)
        await loadGuestbookMessages();

        return true;

    } catch (error) {
        console.error('发送评论失败:', error);
        alert(`评论失败: ${error.message} `);
        return false;
    }
}

// ==================== 回复评论 (嵌套评论) ====================
async function addReplyToComment(parentCommentId, messageId, content) {
    console.log(`💬 回复评论 ${parentCommentId}...`);

    if (!parentCommentId || parentCommentId === 'undefined') {
        console.error('❌ Invalid parentCommentId:', parentCommentId);
        alert('无法回复：评论ID无效');
        return false;
    }

    const currentUser = AV.User.current();
    if (!currentUser) {
        alert('请先登录后再回复');
        return false;
    }

    try {
        // 1. 获取父评论对象以获取父评论者的名字
        const parentCommentQuery = new AV.Query('Comment');
        const parentCommentObj = await parentCommentQuery.get(parentCommentId);

        // 🔍 DEBUG: 检查获取到的父评论对象
        console.log(`🔍 [addReply] 获取父评论对象: id=${parentCommentObj.id}, userName=${parentCommentObj.get('userName')}`);

        const parentUserName = parentCommentObj.get('userName') || '匿名用户';

        console.log(`👤 回复给: ${parentUserName}`);

        // 2. 获取消息对象 (Pointer)
        const parentComment = AV.Object.createWithoutData('Comment', parentCommentId);
        const message = AV.Object.createWithoutData('Message', messageId);

        // 3. 创建回复评论对象
        const Comment = AV.Object.extend('Comment');
        const reply = new Comment();

        reply.set('user', currentUser);
        reply.set('message', message); // 仍然关联到根留言
        reply.set('parentComment', parentComment); // 关联到父评论
        reply.set('userName', currentUser.get('nickname') || currentUser.get('username'));
        reply.set('userAvatar', currentUser.get('avatarUrl') || '');
        reply.set('parentUserName', parentUserName); // 🆕 存储父评论者名字用于 @mention
        reply.set('content', content);

        // 🔍 DEBUG: 打印即将保存的回复对象
        console.log('🔍 [addReply] 即将保存回复:', {
            parentCommentId: parentComment.id,
            parentUserName: parentUserName,
            content: content
        });

        // 4. 保存
        await reply.save();
        console.log('✅ 回复发送成功');

        // 5. 重新加载留言板
        await loadGuestbookMessages();

        return true;

    } catch (error) {
        console.error('回复评论失败:', error);
        alert(`回复失败: ${error.message || '未知错误'} `);
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
        alert(`删除失败: ${error.message} `);
        return false;
    }
}

// ==================== 显示留言 ====================
function displayMessages(messages) {
    const container = document.getElementById('messageContainer');  // 改为单数
    const emptyState = document.getElementById('emptyState');

    if (!container) {
        console.error('❌ 找不到留言容器 #messageContainer');
        return;
    }

    if (!messages || messages.length === 0) {
        container.innerHTML = '';
        if (emptyState) {
            emptyState.style.display = 'flex';
        }
        return;
    }

    // 隐藏空状态
    if (emptyState) {
        emptyState.style.display = 'none';
    }

    container.innerHTML = '';

    messages.forEach(msg => {
        const messageCard = createMessageCard(msg);
        container.appendChild(messageCard);
    });

    console.log(`✅ 显示了 ${messages.length} 条留言`);
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
            <img src="${avatar}" alt="${escapeHTML(msg.userName)}" class="message-avatar">
            <div class="message-meta">
                <div class="message-author">${escapeHTML(msg.userName)}</div>
                <div class="message-time">${time}</div>
            </div>
            ${isOwnMessage ? '<button class="delete-btn" onclick="deleteMessage(\'' + msg.objectId + '\')">删除</button>' : ''}
        </div>
        ${msg.content ? `<div class="message-content">${escapeHTML(msg.content)}</div>` : ''}
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

// ==================== 表单绑定 ====================
document.addEventListener('DOMContentLoaded', function () {
    console.log('📋 绑定留言板表单...');

    const guestbookForm = document.getElementById('guestbookForm');

    if (guestbookForm) {
        guestbookForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            console.log('📝 提交留言表单');

            // 检查登录状态
            const currentUser = AV.User.current();
            if (!currentUser) {
                alert('请先登录后再留言');
                if (typeof toggleLoginModal === 'function') {
                    toggleLoginModal();
                }
                return;
            }

            // 获取留言内容
            const messageInput = document.getElementById('guestMessage');
            const content = messageInput ? messageInput.value.trim() : '';

            // 获取图片数据（如果有）
            const imageData = typeof window.getCurrentImageData === 'function' ? window.getCurrentImageData() : null;

            // 至少需要有内容或图片
            if (!content && !imageData) {
                alert('请输入留言内容或上传图片');
                return;
            }

            // 发送留言（传递图片数据）
            const success = await addMessage(content, imageData || '');

            if (success) {
                // 清空输入框
                if (messageInput) {
                    messageInput.value = '';
                }

                // 清空图片预览
                if (typeof window.clearGuestbookImage === 'function') {
                    window.clearGuestbookImage();
                }

                // 关闭模态框
                const modal = document.getElementById('guestbookModal');
                if (modal) {
                    modal.classList.remove('active');
                }

                // 自动跳转到留言板页面
                window.location.href = 'guestbook.html';
            }
        });

        console.log('✅ 留言板表单绑定成功');
    }
});

// ==================== 图片上传处理 ====================
document.addEventListener('DOMContentLoaded', function () {
    const imageUpload = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    const removeImageBtn = document.getElementById('removeImageBtn');

    let currentImageData = null; // Store base64 image data

    // Image Upload Handler
    if (imageUpload) {
        imageUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Validate file type
            if (!file.type.startsWith('image/')) {
                alert('请选择有效的图片文件!');
                return;
            }

            // Validate file size (max 5MB before compression)
            if (file.size > 5 * 1024 * 1024) {
                alert('图片文件过大! 请选择小于5MB的图片。');
                return;
            }

            try {
                // Compress and convert to base64
                currentImageData = await compressImage(file);

                // Show preview
                if (previewImg && imagePreview) {
                    previewImg.src = currentImageData;
                    imagePreview.style.display = 'block';
                }
            } catch (error) {
                console.error('图片处理失败:', error);
                alert('图片处理失败,请重试!');
            }
        });
    }

    // Remove Image Handler
    if (removeImageBtn) {
        removeImageBtn.addEventListener('click', () => {
            clearImage();
        });
    }

    function clearImage() {
        if (imageUpload) imageUpload.value = '';
        if (imagePreview) imagePreview.style.display = 'none';
        if (previewImg) previewImg.src = '';
        currentImageData = null;
    }

    // Helper: Compress Image to Base64
    async function compressImage(file, maxWidth = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Create canvas for compression
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Resize if too large
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Convert to base64 with compression
                    const compressedData = canvas.toDataURL('image/jpeg', quality);

                    // Check size (warn if > 500KB)
                    const sizeInKB = Math.round((compressedData.length * 3 / 4) / 1024);
                    console.log(`压缩后图片大小: ${sizeInKB}KB`);

                    if (sizeInKB > 500) {
                        console.warn('图片较大,可能影响性能');
                    }

                    resolve(compressedData);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };

            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Make clearImage available globally
    window.clearGuestbookImage = clearImage;
    window.getCurrentImageData = () => currentImageData;
});
