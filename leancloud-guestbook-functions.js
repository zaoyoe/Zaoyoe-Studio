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
async function loadGuestbookMessages(forceRefresh = false, scrollTargetId = null) {
    console.log('📋 加载留言板消息...', forceRefresh ? '(强制刷新)' : '', scrollTargetId ? `(定位到: ${scrollTargetId})` : '');

    const container = document.getElementById('messageContainer');
    const emptyState = document.getElementById('emptyState');

    // 🔧 判断是否是留言板页面
    const isGuestbookPage = window.location.pathname.includes('guestbook.html');

    // 🚀 Cache-First Strategy: Show cached content immediately
    const CACHE_VERSION = 'v2_fix_images'; // 🆕 强制刷新缓存的版本号

    // ✅ 缓存失效辅助函数（提交新内容或收到实时消息时调用）
    window.invalidateGuestbookCache = function () {
        console.log('🗑️ 清除留言板缓存...');
        localStorage.removeItem('cached_messages_' + CACHE_VERSION);
        localStorage.removeItem('cache_time_' + CACHE_VERSION);
    };

    // 🚨 强制刷新时的状态重置
    if (forceRefresh) {
        console.log('🔄 强制刷新：清除缓存并重置状态');
        // 清除缓存
        window.invalidateGuestbookCache();
        // 重置guestbook.js中的状态（通过window对象访问）
        if (window.resetGuestbookState) {
            window.resetGuestbookState();
        }
    }

    if (!forceRefresh) {
        const cached = localStorage.getItem('cached_messages_' + CACHE_VERSION);
        const cacheTime = localStorage.getItem('cache_time_' + CACHE_VERSION);
        const currentTime = Date.now();

        // Use cache if it's less than 30 minutes old
        if (cached && cacheTime && (currentTime - parseInt(cacheTime) < 30 * 60 * 1000)) {
            try {
                const messages = JSON.parse(cached);
                console.log('⚡ 使用缓存数据 (立即显示) - 缓存时间:', new Date(parseInt(cacheTime)).toLocaleTimeString());

                if (typeof renderMessages === 'function') {
                    renderMessages(messages);

                    // 🆕 在留言板页面，如果缓存新鲜就直接返回，避免二次刷新
                    if (isGuestbookPage) {
                        console.log('✅ 留言板页面使用缓存，跳过后台更新（实时推送已启用）');
                        return messages;
                    }

                    // 在其他页面，如果缓存很新鲜（<2分钟），也直接返回
                    const cacheAge = currentTime - parseInt(cacheTime);
                    if (cacheAge < 2 * 60 * 1000) {
                        console.log('✅ 缓存很新鲜，跳过后台更新');
                        return messages;
                    } else {
                        console.log('⚠️ 缓存较旧，将继续后台更新');
                    }
                }

                // Continue loading fresh data in background (only for non-guestbook pages)
                console.log('🔄 后台更新数据...');
            } catch (e) {
                console.error('缓存解析失败:', e);
            }
        }
    }

    try {
        const startTime = performance.now();

        // 1. 查询留言
        console.time('⏱️ Query Messages');
        const query = new AV.Query('Message');
        // Only select necessary fields to reduce payload
        query.select('userName', 'userAvatar', 'content', 'imageUrl', 'createdAt', 'likes');
        // 按热度排序 (点赞数倒序)，其次按时间倒序
        query.addDescending('likes');
        query.addDescending('createdAt');
        query.limit(1000);  // 增加到1000条，确保获取更多历史留言

        const messages = await query.find();
        console.timeEnd('⏱️ Query Messages');

        console.log(`✅ 加载了 ${messages.length} 条留言`);

        // 🆕 Fetch ALL likes for these messages and comments to calculate counts
        const allTargetIds = [...messages.map(m => m.id)];
        // We will add comment IDs after we fetch comments, but we need to do this in order.
        // Let's fetch comments first, then likes.




        // 2. 获取所有相关的评论
        console.time('⏱️ Query Comments');
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
        commentQuery.limit(200); // 减少评论查询限制以提升速度

        const comments = await commentQuery.find();
        console.timeEnd('⏱️ Query Comments');
        console.log(`✅ 加载了 ${comments.length} 条评论`);

        // 3. 构建评论树结构（支持嵌套回复）
        // 3.1 先格式化所有评论为对象
        const commentMap = new Map(); // 用于快速查找评论
        const topLevelComments = []; // 顶级评论（直接回复留言）

        // 🆕 收集所有 ID (留言 + 评论) 用于查询点赞
        allTargetIds.push(...comments.map(c => c.id));
        const likeCounts = {}; // targetId -> count
        const userLikedSet = new Set(); // targetIds liked by current user

        if (allTargetIds.length > 0) {
            console.time('⏱️ Query Likes');
            console.log(`🔍 [Load] Fetching likes for ${allTargetIds.length} items...`);
            const likeQuery = new AV.Query('Like');
            likeQuery.containedIn('targetId', allTargetIds);
            likeQuery.limit(500); // 减少到500以提升性能

            try {
                const allLikes = await likeQuery.find();
                console.timeEnd('⏱️ Query Likes');
                console.log(`🔍 [Load] Found ${allLikes.length} total likes`);

                const currentUserId = AV.User.current()?.id;

                allLikes.forEach(like => {
                    const tid = like.get('targetId');
                    // 计数
                    likeCounts[tid] = (likeCounts[tid] || 0) + 1;
                    // 检查当前用户是否点赞（优先使用userId，兼容旧数据的user.id）
                    const likeUserId = like.get('userId') || like.get('user')?.id;
                    if (currentUserId && likeUserId === currentUserId) {
                        userLikedSet.add(tid);
                    }
                });
            } catch (e) {
                if (e.code === 101 || e.message.includes('Class or object doesn\'t exists')) {
                    console.log('ℹ️ [Load] Like class does not exist yet.');
                } else {
                    console.error('❌ [Load] Failed to fetch likes:', e);
                }
            }
        }

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
                rawDate: comment.get('createdAt'), // 🆕 用于排序
                messageId: comment.get('message')?.id,
                parentCommentId: pId,
                parentUserName: parentUserName, // 🆕 父评论者名字（用于 @mention）
                likes: likeCounts[comment.id] || 0, // 🆕 Use calculated count
                isLiked: userLikedSet.has(comment.id), // 🆕 Check if liked
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

        // 4. 将评论分配给对应的消息
        // 🆕 Now we format messages, AFTER we have like counts
        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            name: msg.get('userName'),
            avatarUrl: msg.get('userAvatar') || '',
            content: msg.get('content') || '',
            image: msg.get('imageUrl') || null,
            likes: likeCounts[msg.id] || 0, // 🆕 Use calculated count
            isLiked: userLikedSet.has(msg.id), // 🆕 Check if liked
            timestamp: msg.get('createdAt').toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }),
            rawDate: msg.get('createdAt'), // 🆕 用于排序
            comments: [] // 初始为空，稍后填充
        }));

        formattedMessages.forEach(msg => {
            msg.comments = topLevelComments.filter(c => c.messageId === msg.id);

            // 🆕 计算最新动态时间 (Client-side Sorting Logic)
            // 默认最新时间是消息创建时间
            let latestTime = new Date(msg.rawDate || 0).getTime();

            // 遍历该消息的所有评论（包括子评论），找到最新的时间
            // 注意：这里我们遍历的是所有属于该消息的 commentMap 中的评论，而不仅仅是 topLevel
            commentMap.forEach(c => {
                if (c.messageId === msg.id) {
                    const cTime = new Date(c.rawDate).getTime();
                    if (cTime > latestTime) {
                        latestTime = cTime;
                    }
                }
            });

            msg.latestActivityTimestamp = latestTime;
        });

        // 🆕 5. 客户端排序：按热度（点赞数）倒序，其次按创建时间倒序
        formattedMessages.sort((a, b) => {
            // 首先按点赞数排序
            if (b.likes !== a.likes) {
                return b.likes - a.likes;
            }
            // 点赞数相同时，按创建时间排序
            return new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime();
        });

        console.log('✅ 留言板数据处理完成 (已按热度排序)');

        // 渲染到页面 (调用 guestbook.js 中的 renderMessages)
        if (typeof renderMessages === 'function') {
            renderMessages(formattedMessages);
        } else {
            console.error('❌ renderMessages function not found!');
        }

        // 缓存到本地（带时间戳和版本号）
        localStorage.setItem('cached_messages_' + CACHE_VERSION, JSON.stringify(formattedMessages));
        localStorage.setItem('cache_time_' + CACHE_VERSION, Date.now().toString());

        // Store for debugging
        window.lastLoadedMessages = formattedMessages;

        // === Phase 6: 智能定位 ===
        if (scrollTargetId && window.handleSmartScroll) {
            console.log('🎯 Phase 6: 触发智能定位到留言:', scrollTargetId);
            // 延迟稍长确保DOM完全渲染
            setTimeout(() => {
                window.handleSmartScroll(scrollTargetId, 'message');
            }, 1200);
        }


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
                </div>
            `;
        }

        // 🆕 确保隐藏加载指示器
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator) loadingIndicator.style.display = 'none';

        return [];
    }
}

// ==================== 发送留言 (LeanCloud 版本) ====================
async function addMessage(content, imageUrl = '') {
    console.log('📝 发送留言...');

    // 检查登录状态
    const currentUser = AV.User.current();
    if (!currentUser) {
        if (confirm('请先登录后再留言。是否立即登录？')) {
            if (typeof window.parent.toggleLoginModal === 'function') {
                window.parent.toggleLoginModal();
            } else if (typeof toggleLoginModal === 'function') {
                toggleLoginModal();
            }
        }
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
        message.set('content', content);
        message.set('imageUrl', imageUrl);
        message.set('latestActivityAt', new Date()); // 🆕 初始化最新动态时间
        message.set('likes', 0); // 🆕 初始化点赞数
        message.set('likedBy', []); // 🆕 初始化点赞列表

        // 3. 保存
        await message.save();

        console.log('✅ 留言发送成功');

        // 重新加载留言板 (强制刷新缓存)
        await loadGuestbookMessages(true);

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
        if (confirm('请先登录后再评论。是否立即登录？')) {
            if (typeof window.parent.toggleLoginModal === 'function') {
                window.parent.toggleLoginModal();
            } else if (typeof toggleLoginModal === 'function') {
                toggleLoginModal();
            }
        }
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
        comment.set('likes', 0);
        comment.set('likedBy', []);

        // 3. 保存评论
        await comment.save();
        console.log('✅ 评论发送成功');

        // 4. 🆕 无刷新插入评论到DOM
        const newComment = {
            id: comment.id,
            name: currentUser.get('nickname') || currentUser.get('username'),
            content: content,
            timestamp: new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }),
            likes: 0,
            isLiked: false,
            replies: [],
            messageId: messageId,
            parentCommentId: null,
            parentUserName: null
        };

        // 插入DOM
        insertCommentToDOM(messageId, newComment);

        // 更新内存数据
        if (window.allMessages) {
            const msg = window.allMessages.find(m => m.id === messageId);
            if (msg) {
                if (!msg.comments) msg.comments = [];
                msg.comments.push(newComment);

                // 更新缓存
                const CACHE_VERSION = 'v2_fix_images';
                localStorage.setItem('cached_messages_' + CACHE_VERSION, JSON.stringify(window.allMessages));
                localStorage.setItem('cache_time_' + CACHE_VERSION, Date.now().toString());
            }
        }

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
        if (confirm('请先登录后再回复。是否立即登录？')) {
            if (typeof window.parent.toggleLoginModal === 'function') {
                window.parent.toggleLoginModal();
            } else if (typeof toggleLoginModal === 'function') {
                toggleLoginModal();
            }
        }
        return false;
    }

    try {
        // 1. 获取父评论对象以获取父评论者的名字
        const parentCommentQuery = new AV.Query('Comment');
        const parentCommentObj = await parentCommentQuery.get(parentCommentId);
        const parentUserName = parentCommentObj.get('userName') || '匿名用户';

        console.log(`👤 回复给: ${parentUserName}`);

        // 2. 获取消息对象 (Pointer)
        const parentComment = AV.Object.createWithoutData('Comment', parentCommentId);
        const message = AV.Object.createWithoutData('Message', messageId);

        // 3. 创建回复评论对象
        const Comment = AV.Object.extend('Comment');
        const reply = new Comment();

        reply.set('user', currentUser);
        reply.set('message', message);
        reply.set('parentComment', parentComment);
        reply.set('userName', currentUser.get('nickname') || currentUser.get('username'));
        reply.set('userAvatar', currentUser.get('avatarUrl') || '');
        reply.set('parentUserName', parentUserName);
        reply.set('content', content);
        reply.set('likes', 0);
        reply.set('likedBy', []);

        // 4. 保存回复
        await reply.save();
        console.log('✅ 回复发送成功');

        // 5. 🆕 无刷新插入回复到DOM
        const newReply = {
            id: reply.id,
            name: currentUser.get('nickname') || currentUser.get('username'),
            content: content,
            timestamp: new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }),
            likes: 0,
            isLiked: false,
            replies: [],
            messageId: messageId,
            parentCommentId: parentCommentId,
            parentUserName: parentUserName
        };

        // 插入DOM
        insertReplyToDOM(parentCommentId, newReply);

        // 更新内存数据
        if (window.allMessages) {
            const msg = window.allMessages.find(m => m.id === messageId);
            if (msg) {
                // 递归查找父评论并添加回复
                function addReplyToParent(comments) {
                    for (let comment of comments) {
                        if (comment.id === parentCommentId) {
                            if (!comment.replies) comment.replies = [];
                            comment.replies.push(newReply);
                            return true;
                        }
                        if (comment.replies && comment.replies.length > 0) {
                            if (addReplyToParent(comment.replies)) return true;
                        }
                    }
                    return false;
                }


                addReplyToParent(msg.comments || []);

                // ✅ 提交评论成功后清除缓存（让其他设备刷新时能看到新评论）
                if (typeof window.invalidateGuestbookCache === 'function') {
                    window.invalidateGuestbookCache();
                }

                // 更新缓存（用最新数据）
                const CACHE_VERSION = 'v2_fix_images';
                localStorage.setItem('cached_messages_' + CACHE_VERSION, JSON.stringify(window.allMessages));
                localStorage.setItem('cache_time_' + CACHE_VERSION, Date.now().toString());
            }
        }

        return true;

    } catch (error) {
        console.error('回复评论失败:', error);
        alert(`回复失败: ${error.message || '未知错误'} `);
        return false;
    }
}

// ==================== 辅助函数：插入评论到DOM ====================
function insertCommentToDOM(messageId, comment) {
    console.log(`📝 插入评论到DOM: messageId=${messageId}, commentId=${comment.id}`);

    // ✅ 防止重复插入：检查评论是否已存在
    const existingComment = document.querySelector(`[data-comment-id="${comment.id}"]`);
    if (existingComment) {
        console.log(`⏭️ 评论已存在，跳过插入: commentId=${comment.id}`);
        return;
    }

    // 查找对应的留言卡片
    const messageCard = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageCard) {
        console.error('❌ 找不到对应的留言卡片, messageId=', messageId);
        console.log('📋 当前页面的所有 message-item:', document.querySelectorAll('[data-message-id]').length);
        return;
    }

    console.log('✅ 找到留言卡片');

    // 🔧 修复：直接查找 .comment-list 容器（它在 .comment-section 内）
    let commentList = messageCard.querySelector(`.comment-list[data-message-id="${messageId}"]`);
    if (!commentList) {
        console.error('❌ 找不到评论列表 .comment-list');
        // 尝试查找 comment-section 并打印其结构
        const commentSection = messageCard.querySelector('.comment-section');
        if (commentSection) {
            console.log('📋 找到comment-section，内容:', commentSection.innerHTML.substring(0, 300));
        } else {
            console.log('📋 连comment-section都找不到');
        }
        return;
    }

    console.log('✅ 找到评论列表');

    // 移除"暂无评论"提示
    const noComments = commentList.querySelector('.no-comments');
    if (noComments) {
        console.log('🗑️ 移除"暂无评论"提示');
        noComments.remove();
    }

    // 生成评论HTML
    const mentionPrefix = (comment.parentUserName)
        ? `<span class="comment-mention">@${escapeHTML(comment.parentUserName)}</span> `
        : '';

    const commentHTML = `
        <div class="comment-item" data-comment-id="${comment.id}" data-message-id="${messageId}" data-can-reply="true">
            <div class="comment-row">
                <div class="comment-main">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHTML(comment.name)}</span>
                        <span class="comment-time">${comment.timestamp}</span>
                    </div>
                    <div class="comment-content">${mentionPrefix}${escapeHTML(comment.content)}</div>
                </div>
                <div class="comment-like-wrapper">
                    <button class="comment-like-btn" onclick="handleLike('Comment', '${comment.id}', this)">
                        <i class="far fa-heart"></i>
                        <span class="like-count">0</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // 插入到评论列表末尾
    console.log('📤 插入评论HTML到comment-list');
    commentList.insertAdjacentHTML('beforeend', commentHTML);

    // 重新绑定评论点击事件
    if (typeof window.attachCommentHandlers === 'function') {
        console.log('🔗 重新绑定评论事件');
        window.attachCommentHandlers();
    }

    console.log('✅ 评论已插入DOM');
}

// ==================== 辅助函数：插入回复到DOM ====================
function insertReplyToDOM(parentCommentId, reply) {
    console.log(`📝 插入回复到DOM: parentCommentId=${parentCommentId}, replyId=${reply.id}`);

    // ✅ 防止重复插入：检查回复是否已存在
    const existingReply = document.querySelector(`[data-comment-id="${reply.id}"]`);
    if (existingReply) {
        console.log(`⏭️ 回复已存在，跳过插入: replyId=${reply.id}`);
        return;
    }

    // 查找父评论元素
    const parentCommentElem = document.querySelector(`[data-comment-id="${parentCommentId}"]`);
    if (!parentCommentElem) {
        console.error('找不到父评论元素');
        return;
    }

    // 计算嵌套层级
    const currentDepth = parentCommentElem.style.marginLeft ?
        parseInt(parentCommentElem.style.marginLeft) / 10 : 0;
    const newDepth = currentDepth + 1;
    const maxDepth = 2;
    const indentPx = Math.min(newDepth * 10, 20);
    const canReply = newDepth < maxDepth;

    // 生成回复HTML
    const mentionPrefix = reply.parentUserName
        ? `<span class="comment-mention">@${escapeHTML(reply.parentUserName)}</span> `
        : '';

    const replyHTML = `
        <div class="comment-item comment-item--nested ${canReply ? 'comment-item--clickable' : ''}" 
             style="margin-left: ${indentPx}px"
             data-comment-id="${reply.id}" 
             data-message-id="${reply.messageId}"
             data-can-reply="${canReply}">
            <div class="comment-row">
                <div class="comment-main">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHTML(reply.name)}</span>
                        <span class="comment-time">${reply.timestamp}</span>
                    </div>
                    <div class="comment-content">${mentionPrefix}${escapeHTML(reply.content)}</div>
                </div>
                <div class="comment-like-wrapper">
                    <button class="comment-like-btn" onclick="handleLike('Comment', '${reply.id}', this)">
                        <i class="far fa-heart"></i>
                        <span class="like-count">0</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // 插入到父评论后面
    parentCommentElem.insertAdjacentHTML('afterend', replyHTML);

    // 重新绑定评论点击事件
    if (typeof window.attachCommentHandlers === 'function') {
        window.attachCommentHandlers();
    }

    console.log('✅ 回复已插入DOM');
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

        // 重新加载 (强制刷新缓存)
        await loadGuestbookMessages(true);

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

// ==================== 点赞功能 (Like Class) ====================
async function toggleLike(type, id) {
    console.log(`❤️ 切换点赞: type=${type}, id=${id}`);
    const currentUser = AV.User.current();
    if (!currentUser) {
        if (confirm('请先登录后再点赞。是否立即登录？')) {
            if (typeof window.parent.toggleLoginModal === 'function') {
                window.parent.toggleLoginModal();
            } else if (typeof toggleLoginModal === 'function') {
                toggleLoginModal();
            }
        }
        return null;
    }

    const currentUserId = currentUser.id;

    try {
        // 1. 查询当前用户对该目标的点赞记录（只用userId）
        const likeQuery = new AV.Query('Like');
        likeQuery.equalTo('targetId', id);
        likeQuery.equalTo('userId', currentUserId);

        const existingLike = await likeQuery.first();
        console.log(`🔍 [Like] 查询到已存在的点赞?`, !!existingLike);

        let isLiked = false;

        if (existingLike) {
            // 取消点赞
            await existingLike.destroy();
            console.log('✅ [Like] 点赞已取消');
            isLiked = false;
        } else {
            // 添加点赞
            const Like = AV.Object.extend('Like');
            const newLike = new Like();
            newLike.set('userId', currentUserId);
            newLike.set('targetId', id);
            newLike.set('targetType', type);

            // 设置 ACL
            const acl = new AV.ACL(currentUser);
            acl.setPublicReadAccess(true);
            newLike.setACL(acl);

            await newLike.save();
            console.log('✅ [Like] 点赞成功');
            isLiked = true;
        }

        // 2. 重新统计该目标的总点赞数
        const countQuery = new AV.Query('Like');
        countQuery.equalTo('targetId', id);
        const likes = await countQuery.count();
        console.log(`✅ [Like] 当前总点赞数: ${likes}`);

        // ✅ 清除缓存，确保刷新页面时显示最新数据
        if (typeof window.invalidateGuestbookCache === 'function') {
            window.invalidateGuestbookCache();
        }

        return { likes, isLiked };

    } catch (error) {
        console.error('❌ 点赞操作失败:', error);
        return null;
    }
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
            console.log('📩 收到新留言:', message.id);
            loadGuestbookMessages();
        });

        // 消息删除
        liveQuery.on('delete', message => {
            console.log('🗑️ 留言被删除');
            loadGuestbookMessages();
        });

    }).catch(error => {
        console.error('❌ 订阅失败:', error);
    });
}

console.log('✅ LeanCloud 留言板函数已加载');

// ==================== WebSocket实时推送 ====================
function enableRealTimeUpdates() {
    console.log('🔌 启用实时推送...');
    console.log('🔍 当前URL:', window.location.pathname);
    console.log('🔍 AV对象:', typeof AV !== 'undefined' ? '✅ 存在' : '❌ 不存在');
    console.log('🔍 AV.Query.prototype.subscribe:', typeof AV.Query.prototype.subscribe);

    // 检查 LiveQuery 是否可用
    if (!AV.Query.prototype.subscribe) {
        console.warn('⚠️ LiveQuery 不可用，可能需要升级SDK或开启后台功能');
        return;
    }

    console.log('✅ LiveQuery 功能可用，开始订阅...');

    // 订阅新留言
    const messageQuery = new AV.Query('Message');
    messageQuery.descending('createdAt');

    console.log('📡 创建留言 Query 订阅...');

    messageQuery.subscribe().then(liveQuery => {
        console.log('✅ 留言实时订阅已启用');
        console.log('🔍 LiveQuery 对象:', liveQuery);

        liveQuery.on('create', async (message) => {
            console.log('🎉 [LiveQuery] 收到 create 事件!');
            console.log('📦 消息对象:', message);
            console.log('👤 消息作者:', message.get('userName'));

            // 检查是否是当前用户发的（避免重复显示）
            const currentUser = AV.User.current();
            console.log('🔍 当前用户:', currentUser ? currentUser.get('username') : '未登录');
            console.log('🔍 消息用户ID:', message.get('user')?.id);
            console.log('🔍 当前用户ID:', currentUser?.id);

            if (currentUser && message.get('user')?.id === currentUser.id) {
                console.log('⏭️ 跳过自己发的留言');
                return;
            }

            console.log('📩 收到新留言:', message.get('userName'));

            // ✨ Phase 5: 触发智能胶囊通知
            if (window.CapsuleManager) {
                console.log('🔔 触发胶囊通知 - 留言ID:', message.id);
                window.CapsuleManager.queueUpdate('message', message.id);
            }

            // ✅ 收到新留言时清除缓存
            if (typeof window.invalidateGuestbookCache === 'function') {
                window.invalidateGuestbookCache();
            }

            // 格式化新留言
            const newMessage = {
                id: message.id,
                name: message.get('userName'),
                avatarUrl: message.get('userAvatar') || '',
                content: message.get('content') || '',
                image: message.get('imageUrl') || null,
                likes: 0,
                isLiked: false,
                timestamp: new Date().toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                rawDate: new Date(),
                comments: []
            };

            // 插入到页面顶部
            insertMessageToTop(newMessage);

            // 显示通知
            // ✅ 已有 CapsuleManager 胶囊通知，注释掉旧的 showNotification 避免重复
            // showNotification(`${newMessage.name} 发了新留言`);

            // 更新内存和缓存
            if (window.allMessages) {
                window.allMessages.unshift(newMessage);
                const CACHE_VERSION = 'v2_fix_images';
                localStorage.setItem('cached_messages_' + CACHE_VERSION, JSON.stringify(window.allMessages));
                localStorage.setItem('cache_time_' + CACHE_VERSION, Date.now().toString());
            }
        });

        liveQuery.on('delete', (message) => {
            console.log('🗑️ 留言被删除:', message.id);
            removeMessageFromDOM(message.id);
        });

    }).catch(err => {
        console.error('❌ 留言订阅失败:', err);
        console.warn('💡 提示：LiveQuery 可能需要在 LeanCloud 控制台开启，或升级到商用版');
        console.log('📝 虽然实时推送不可用，但其他功能（评论立即显示、点赞等）仍然正常');
    });

    // 订阅新评论
    const commentQuery = new AV.Query('Comment');
    commentQuery.include('message');

    commentQuery.subscribe().then(liveQuery => {
        console.log('✅ 评论实时订阅已启用');

        liveQuery.on('create', async (comment) => {
            const currentUser = AV.User.current();
            if (currentUser && comment.get('user')?.id === currentUser.id) {
                console.log('⏭️ 跳过自己发的评论');
                return;
            }

            console.log('💬 收到新评论:', comment.get('userName'));

            const messageId = comment.get('message')?.id;
            if (!messageId) return;

            // 格式化新评论
            const newComment = {
                id: comment.id,
                name: comment.get('userName'),
                content: comment.get('content'),
                timestamp: new Date().toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                likes: 0,
                isLiked: false,
                replies: [],
                messageId: messageId,
                parentCommentId: comment.get('parentComment')?.id || null,
                parentUserName: comment.get('parentUserName') || null
            };

            // 插入到DOM
            if (newComment.parentCommentId) {
                insertReplyToDOM(newComment.parentCommentId, newComment);
            } else {
                insertCommentToDOM(messageId, newComment);
            }

            // ✨ Phase 5: 触发智能胶囊通知（传入父留言ID）
            if (window.CapsuleManager) {
                console.log('🔔 触发胶囊通知 - 评论ID:', comment.id, '父留言ID:', messageId);
                window.CapsuleManager.queueUpdate('comment', comment.id, messageId);
            }

            // ✅ 已有 CapsuleManager 胶囊通知，注释掉旧的 showNotification 避免重复
            // showNotification(`${newComment.name} 发了新评论`);
        });

    }).catch(err => {
        console.error('❌ 评论订阅失败:', err);
        console.warn('💡 虽然实时推送不可用，但评论仍会立即显示在你自己的页面上');
    });
}

// ==================== 辅助函数：HTML字符串转DOM元素 ====================
function htmlToElement(html) {
    const template = document.createElement('template');
    html = html.trim(); // 去除首尾空格
    template.innerHTML = html;
    return template.content.firstChild;
}

// ==================== 辅助函数：插入新留言到顶部 ====================
function insertMessageToTop(msg) {
    console.log('📝 插入新留言到页面顶部:', msg.id);

    const container = document.getElementById('messageContainer');
    if (!container) {
        console.error('找不到留言容器');
        return;
    }

    // 检查是否已存在
    if (document.querySelector(`[data - message - id= "${msg.id}"]`)) {
        console.log('留言已存在，跳过');
        return;
    }

    // 使用guestbook.js中的createMessageCard函数
    if (typeof window.createMessageCard === 'function') {
        const html = window.createMessageCard(msg, 0);
        const element = htmlToElement(html);

        // 添加新消息标记和动画类
        element.classList.add('message-new');

        // 插入到第一列顶部
        const firstColumn = container.querySelector('.masonry-column');
        if (firstColumn) {
            firstColumn.insertBefore(element, firstColumn.firstChild);

            // 触发动画
            setTimeout(() => {
                element.classList.add('visible');
            }, 50);
        }
    }

    console.log('✅ 新留言已插入');
}

// ==================== 辅助函数：从DOM移除留言 ====================
function removeMessageFromDOM(messageId) {
    const elem = document.querySelector(`[data - message - id= "${messageId}"]`);
    if (elem) {
        elem.classList.add('message-removing');
        setTimeout(() => elem.remove(), 300);
    }
}

// ==================== 辅助函数：显示通知 ====================
function showNotification(message) {
    // 检查是否已存在通知容器
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z - index: 10000;
        pointer - events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.cssText = `
        background: linear - gradient(135deg, #667eea 0 %, #764ba2 100 %);
        color: white;
        padding: 12px 20px;
        border - radius: 8px;
        margin - bottom: 10px;
        box - shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        display: flex;
        align - items: center;
        gap: 10px;
        font - size: 14px;
        opacity: 0;
        transform: translateX(100px);
        transition: all 0.3s cubic - bezier(0.34, 1.56, 0.64, 1);
        pointer - events: auto;
        `;

    toast.innerHTML = `
            < i class="fas fa-bell" style = "font-size: 16px;" ></i >
                <span>${escapeHTML(message)}</span>
        `;

    container.appendChild(toast);

    // 触发动画
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    }, 10);

    // 3秒后淡出
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== 自动启用实时推送 ====================
// 在留言板页面自动启用
if (typeof AV !== 'undefined' && window.location.pathname.includes('guestbook.html')) {
    // 等待DOM加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(enableRealTimeUpdates, 1000);
        });
    } else {
        setTimeout(enableRealTimeUpdates, 1000);
    }
}

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
                    console.log(`压缩后图片大小: ${sizeInKB} KB`);

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
