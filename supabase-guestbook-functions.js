/**
 * Supabase 版本的留言板功能
 * 替换 leancloud-guestbook-functions.js
 */

// ==================== 辅助函数：防止 XSS ====================
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (match) {
        const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return escapeMap[match];
    });
}

// ==================== 敏感词过滤 ====================
let sensitiveWordsCache = null;
let sensitiveWordsCacheTime = null;

async function loadSensitiveWords() {
    // Cache for 5 minutes
    if (sensitiveWordsCache && sensitiveWordsCacheTime && (Date.now() - sensitiveWordsCacheTime < 300000)) {
        return sensitiveWordsCache;
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'moderation')
            .single();

        if (error || !data) {
            sensitiveWordsCache = { enabled: false, words: [] };
        } else {
            sensitiveWordsCache = {
                enabled: data.config_value?.auto_filter || false,
                words: data.config_value?.sensitive_words || []
            };
        }
        sensitiveWordsCacheTime = Date.now();
        console.log('📋 敏感词配置已加载:', sensitiveWordsCache.words.length, '个词');
        return sensitiveWordsCache;
    } catch (e) {
        console.warn('加载敏感词配置失败:', e);
        return { enabled: false, words: [] };
    }
}

async function checkSensitiveContent(content) {
    const config = await loadSensitiveWords();

    if (!config.enabled || !config.words.length) {
        return { blocked: false };
    }

    const lowerContent = content.toLowerCase();
    for (const word of config.words) {
        if (lowerContent.includes(word.toLowerCase())) {
            return { blocked: true, word: word };
        }
    }

    return { blocked: false };
}

// ==================== 缓存管理 ====================
const guestbookCache = {
    messages: [],
    lastFetch: null,
    userLikes: new Set(),
    recentInserts: new Set() // Track IDs of items inserted by current user
};

// Expose cache globally for debugging
window.guestbookCache = guestbookCache;

function invalidateGuestbookCache() {
    guestbookCache.lastFetch = null;
    console.log('🗑️ Guestbook cache invalidated');
}

// ==================== 加载留言板 (Supabase 版本) ====================
async function loadGuestbookMessages(forceRefresh = false, scrollTargetId = null) {
    console.log('📥 Loading guestbook messages...');

    const container = document.getElementById('messageContainer');
    if (!container) {
        console.warn('⚠️ Message container not found');
        return;
    }

    // Check cache
    const cacheValid = guestbookCache.lastFetch &&
        (Date.now() - guestbookCache.lastFetch < 30000) &&
        !forceRefresh;

    if (cacheValid && guestbookCache.messages.length > 0) {
        console.log('📦 Using cached messages');
        displayMessages(guestbookCache.messages);
        return;
    }

    try {
        // Fetch messages (without join - will fetch profiles separately)
        const currentSite = window.SiteConfig?.site || 'cn';
        const { data: messages, error } = await window.supabaseClient
            .from('guestbook_messages')
            .select('*')
            .eq('site', currentSite)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        // Fetch profiles for all message authors
        const userIds = [...new Set(messages.map(m => m.user_id))];
        const { data: profiles } = await window.supabaseClient
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', userIds);

        // Create a map for quick lookup
        const profileMap = {};
        (profiles || []).forEach(p => {
            profileMap[p.id] = p;
        });

        // Attach profiles to messages
        const messagesWithProfiles = messages.map(msg => ({
            ...msg,
            profiles: profileMap[msg.user_id] || { username: 'Anonymous', avatar_url: null }
        }));

        // Fetch comments for all messages
        const messageIds = messages.map(m => m.id);
        let comments = [];
        if (messageIds.length > 0) {
            const { data: commentsData } = await window.supabaseClient
                .from('guestbook_comments')
                .select('*')
                .in('message_id', messageIds)
                .order('created_at', { ascending: true });
            comments = commentsData || [];

            // Fetch profiles for comment authors
            const commentUserIds = [...new Set(comments.map(c => c.user_id))];
            if (commentUserIds.length > 0) {
                const { data: commentProfiles } = await window.supabaseClient
                    .from('profiles')
                    .select('id, username, avatar_url')
                    .in('id', commentUserIds);

                (commentProfiles || []).forEach(p => {
                    profileMap[p.id] = p;
                });
            }

            // Fetch like counts for all comments
            const commentIds = comments.map(c => c.id);
            const commentLikeCounts = {};
            if (commentIds.length > 0) {
                const { data: commentLikes } = await window.supabaseClient
                    .from('guestbook_likes')
                    .select('target_id')
                    .eq('target_type', 'comment')
                    .in('target_id', commentIds);

                // Count likes per comment
                (commentLikes || []).forEach(like => {
                    commentLikeCounts[like.target_id] = (commentLikeCounts[like.target_id] || 0) + 1;
                });
            }

            // Attach profiles and like counts to comments
            comments = comments.map(c => ({
                ...c,
                profiles: profileMap[c.user_id] || { username: 'Anonymous', avatar_url: null },
                like_count: commentLikeCounts[c.id] || 0
            }));
        }

        // Fetch current user's likes
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (user) {
            const { data: likes } = await window.supabaseClient
                .from('guestbook_likes')
                .select('target_type, target_id')
                .eq('user_id', user.id);

            // Normalize target_type to match guestbook.js format (Message/Comment)
            // Database stores lowercase ('message'/'comment'), but JS uses title case
            guestbookCache.userLikes = new Set(
                (likes || []).map(l => {
                    const normalizedType = l.target_type.charAt(0).toUpperCase() + l.target_type.slice(1);
                    return `${normalizedType}_${l.target_id}`;
                })
            );
        }

        // Attach comments to messages
        const messagesWithComments = messagesWithProfiles.map(msg => {
            const msgComments = comments.filter(c => c.message_id === msg.id);
            return {
                ...msg,
                comments: buildCommentTree(msgComments)
            };
        });

        // Update cache
        guestbookCache.messages = messagesWithComments;
        guestbookCache.lastFetch = Date.now();

        console.log(`✅ Loaded ${messages.length} messages`);
        displayMessages(messagesWithComments);

        // Scroll to target if specified
        if (scrollTargetId) {
            setTimeout(() => {
                const target = document.getElementById(scrollTargetId);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 300);
        }

    } catch (error) {
        console.error('❌ Error loading messages:', error);
        container.innerHTML = '<p style="color: red;">加载留言失败，请刷新重试</p>';
    }
}

// Build nested comment tree
function buildCommentTree(comments) {
    const map = {};
    const roots = [];

    comments.forEach(c => {
        map[c.id] = { ...c, replies: [] };
    });

    comments.forEach(c => {
        if (c.parent_id && map[c.parent_id]) {
            map[c.parent_id].replies.push(map[c.id]);
        } else {
            roots.push(map[c.id]);
        }
    });

    return roots;
}

// ==================== 显示留言 ====================
// Helper: Convert HTML string to DOM element
function htmlToElement(html) {
    const template = document.createElement('template');
    html = html.trim();
    template.innerHTML = html;
    return template.content.firstChild;
}

function displayMessages(messages) {
    const container = document.getElementById('messageContainer');
    if (!container) return;

    if (!messages || messages.length === 0) {
        // Hide skeleton loading
        const skeletonContainer = document.getElementById('skeletonContainer');
        if (skeletonContainer) skeletonContainer.classList.add('hidden');
        const emptyState = document.getElementById('emptyState');
        if (emptyState) emptyState.style.display = 'flex';
        container.innerHTML = '';
        container.style.opacity = '1';
        return;
    }

    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'none';

    // Format messages for UI and delegate to window.renderMessages
    // which handles masonry layout from guestbook.js
    if (typeof window.renderMessages === 'function') {
        const formattedMessages = messages.map(msg => formatMessageForUI(msg));
        window.renderMessages(formattedMessages);
    } else {
        // Fallback: simple display without masonry
        console.warn('⚠️ window.renderMessages not found, using simple display');
        container.innerHTML = messages.map(msg => `
            <div class="message-item" id="msg-${msg.id}">
                <div class="author-info">
                    <img src="${msg.profiles?.avatar_url || 'https://ui-avatars.com/api/?name=User'}" class="author-avatar">
                    <span class="author-name">${escapeHTML(msg.profiles?.username || 'Anonymous')}</span>
                </div>
                <p class="message-content">${escapeHTML(msg.content)}</p>
                ${msg.image_url ? `<img src="${msg.image_url}" class="message-image">` : ''}
                <div class="message-footer">
                    <span class="message-time">${formatTime(msg.created_at)}</span>
                    <button class="like-btn ${isLiked('message', msg.id) ? 'active' : ''}" onclick="toggleLike('message', '${msg.id}')">
                        ❤️ ${msg.like_count || 0}
                    </button>
                </div>
            </div>
        `).join('');
        container.style.opacity = '1';
    }
}

// Format message for UI compatibility with existing guestbook.js
function formatMessageForUI(msg) {
    return {
        objectId: msg.id,
        id: msg.id,
        content: msg.content,
        image: msg.image_url,
        imageUrl: msg.image_url,
        name: msg.profiles?.username || 'Anonymous',
        username: msg.profiles?.username || 'Anonymous',
        avatarUrl: msg.profiles?.avatar_url || `https://ui-avatars.com/api/?name=User&background=random`,
        userId: msg.user_id,
        authorId: msg.user_id,
        likes: msg.like_count || 0,
        createdAt: msg.created_at,
        timestamp: formatTime(msg.created_at),
        comments: (msg.comments || []).map(formatCommentForUI),
        isLiked: isLiked('Message', msg.id)
    };
}

function formatCommentForUI(comment) {
    return {
        objectId: comment.id,
        id: comment.id,
        content: comment.content,
        name: comment.profiles?.username || 'Anonymous',
        username: comment.profiles?.username || 'Anonymous',
        avatarUrl: comment.profiles?.avatar_url || `https://ui-avatars.com/api/?name=User&background=random`,
        userId: comment.user_id,
        authorId: comment.user_id,
        parentId: comment.parent_id,
        parentCommentId: comment.parent_id,
        parentUserName: null, // Will need to be populated if needed
        likes: comment.like_count || 0,
        isLiked: isLiked('Comment', comment.id),
        createdAt: comment.created_at,
        timestamp: formatTime(comment.created_at),
        replies: (comment.replies || []).map(formatCommentForUI)
    };
}

function isLiked(type, id) {
    return guestbookCache.userLikes.has(`${type}_${id}`);
}

function formatTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

    return date.toLocaleDateString('zh-CN');
}

// ==================== 封禁检查辅助函数 ====================
async function checkUserBlockStatus(userId, scope = 'guestbook') {
    if (!window.supabaseClient) return false;

    // Check for explicit block
    // We check for 'all' scope or specific scope
    const { data: blocks, error } = await window.supabaseClient
        .from('blocked_users')
        .select('*')
        .eq('user_id', userId)
        .or(`scope.eq.all,scope.eq.${scope}`);

    if (error || !blocks || blocks.length === 0) return false;

    // Check expiration
    const now = new Date();
    const activeBlock = blocks.find(b => {
        if (!b.expires_at) return true; // Permanent
        return new Date(b.expires_at) > now; // Temporary and still active
    });

    if (activeBlock) {
        const type = activeBlock.expires_at ? '临时' : '永久';
        const dateStr = activeBlock.expires_at ? new Date(activeBlock.expires_at).toLocaleDateString() : '';
        const msg = activeBlock.expires_at
            ? `您已被${type}封禁，解封时间：${dateStr}`
            : `您已被永久封禁`;
        return { blocked: true, message: msg };
    }

    return false;
}

// ==================== 发送留言 (Supabase 版本) ====================
async function addMessage(content, imageUrl = '') {
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (!user) {
        alert('请先登录');
        return false;
    }

    // 🛑 Block Check
    const blockStatus = await checkUserBlockStatus(user.id, 'guestbook');
    if (blockStatus && blockStatus.blocked) {
        alert(blockStatus.message || '您已被限制发言');
        return false;
    }

    if (!content && !imageUrl) {
        alert('请输入留言内容或上传图片');
        return false;
    }

    // 🔍 敏感词检查
    if (content) {
        const sensitiveCheck = await checkSensitiveContent(content);
        if (sensitiveCheck.blocked) {
            alert(`⚠️ 内容包含敏感词，请修改后重试`);
            return false;
        }
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('guestbook_messages')
            .insert({
                user_id: user.id,
                content: content || '',
                image_url: imageUrl || null,
                site: window.SiteConfig?.site || 'cn'
            })
            .select()
            .single();

        if (error) throw error;

        console.log('✅ Message added:', data.id);
        invalidateGuestbookCache();
        return true;

    } catch (error) {
        console.error('❌ Error adding message:', error);
        alert('发送失败: ' + error.message);
        return false;
    }
}

// ==================== 发送评论 (Supabase 版本) ====================
async function addCommentToMessage(messageId, content) {
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (!user) {
        alert('请先登录');
        return false;
    }

    // 🛑 Block Check
    const blockStatus = await checkUserBlockStatus(user.id, 'guestbook');
    if (blockStatus && blockStatus.blocked) {
        alert(blockStatus.message || '您已被限制发言');
        return false;
    }

    if (!content) {
        alert('请输入评论内容');
        return false;
    }

    // 🔍 敏感词检查
    const sensitiveCheck = await checkSensitiveContent(content);
    if (sensitiveCheck.blocked) {
        alert(`⚠️ 内容包含敏感词，请修改后重试`);
        return false;
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('guestbook_comments')
            .insert({
                message_id: messageId,
                user_id: user.id,
                content: content,
                parent_id: null,
                site: window.SiteConfig?.site || 'cn'
            })
            .select()
            .single();

        if (error) throw error;

        console.log('✅ Comment added:', data.id);

        // Track this insert to skip Realtime refresh
        guestbookCache.recentInserts.add(data.id);
        setTimeout(() => guestbookCache.recentInserts.delete(data.id), 5000); // Clear after 5s

        // Get user profile for display
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', user.id)
            .single();

        // Insert comment into DOM immediately
        insertCommentToDOM(messageId, {
            id: data.id,
            content: content,
            name: profile?.username || 'Anonymous',
            avatarUrl: profile?.avatar_url,
            timestamp: '刚刚',
            likes: 0,
            isLiked: false,
            replies: []
        });

        invalidateGuestbookCache();
        return true;

    } catch (error) {
        console.error('❌ Error adding comment:', error);
        alert('评论失败: ' + error.message);
        return false;
    }
}

// ==================== 回复评论 (嵌套) ====================
async function addReplyToComment(parentCommentId, messageId, content) {
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (!user) {
        alert('请先登录');
        return false;
    }

    // 🛑 Block Check
    const blockStatus = await checkUserBlockStatus(user.id, 'guestbook');
    if (blockStatus && blockStatus.blocked) {
        alert(blockStatus.message || '您已被限制发言');
        return false;
    }

    if (!content) {
        alert('请输入回复内容');
        return false;
    }

    // 🔍 敏感词检查
    const sensitiveCheck2 = await checkSensitiveContent(content);
    if (sensitiveCheck2.blocked) {
        alert(`⚠️ 内容包含敏感词，请修改后重试`);
        return false;
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('guestbook_comments')
            .insert({
                message_id: messageId,
                user_id: user.id,
                content: content,
                parent_id: parentCommentId,
                site: window.SiteConfig?.site || 'cn'
            })
            .select()
            .single();

        if (error) throw error;

        console.log('✅ Reply added:', data.id);

        // Track this insert to skip Realtime refresh
        guestbookCache.recentInserts.add(data.id);
        setTimeout(() => guestbookCache.recentInserts.delete(data.id), 5000); // Clear after 5s

        // Get user profile for display
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', user.id)
            .single();

        // Get parent comment author name for @mention
        const parentComment = document.querySelector(`[data-comment-id="${parentCommentId}"]`);
        const parentAuthorName = parentComment?.querySelector('.comment-author')?.textContent || null;

        // Insert reply into DOM immediately
        insertReplyToDOM(messageId, parentCommentId, {
            id: data.id,
            content: content,
            name: profile?.username || 'Anonymous',
            avatarUrl: profile?.avatar_url,
            timestamp: '刚刚',
            likes: 0,
            isLiked: false,
            parentUserName: parentAuthorName,
            replies: []
        });

        invalidateGuestbookCache();
        return true;

    } catch (error) {
        console.error('❌ Error adding reply:', error);
        alert('回复失败: ' + error.message);
        return false;
    }
}

// ==================== 点赞功能 (Supabase 版本) ====================
async function toggleLike(type, targetId) {
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (!user) {
        alert('请先登录');
        return null;
    }

    // Convert type to lowercase to match database constraint
    // guestbook.js passes 'Message'/'Comment', but DB expects 'message'/'comment'
    const dbType = type.toLowerCase();

    const likeKey = `${type}_${targetId}`;
    const isCurrentlyLiked = guestbookCache.userLikes.has(likeKey);

    try {
        if (isCurrentlyLiked) {
            // Unlike
            const { error } = await window.supabaseClient
                .from('guestbook_likes')
                .delete()
                .eq('user_id', user.id)
                .eq('target_type', dbType)
                .eq('target_id', targetId);

            if (error) throw error;

            guestbookCache.userLikes.delete(likeKey);
            console.log('💔 Unliked');
        } else {
            // Like
            const { data: likeData, error } = await window.supabaseClient
                .from('guestbook_likes')
                .insert({
                    user_id: user.id,
                    target_type: dbType,
                    target_id: targetId
                })
                .select()
                .single();

            if (error) throw error;

            // Track this like to skip Realtime notification for self
            if (likeData) {
                guestbookCache.recentInserts.add(likeData.id);
                setTimeout(() => guestbookCache.recentInserts.delete(likeData.id), 5000);
            }

            guestbookCache.userLikes.add(likeKey);
            console.log('❤️ Liked');
        }

        // Get updated like count
        const { count } = await window.supabaseClient
            .from('guestbook_likes')
            .select('*', { count: 'exact', head: true })
            .eq('target_type', dbType)
            .eq('target_id', targetId);

        const result = {
            likes: count || 0,
            isLiked: !isCurrentlyLiked
        };

        // Update UI immediately
        updateLikeButton(type, targetId, !isCurrentlyLiked);

        return result;

    } catch (error) {
        console.error('❌ Like error:', error);
        return null;
    }
}

function updateLikeButton(type, targetId, isLiked) {
    // Normalize type to lowercase for comparison
    const normalizedType = type.toLowerCase();

    const selector = normalizedType === 'message'
        ? `#msg-${targetId} .like-btn, [data-message-id="${targetId}"] .like-btn`
        : `[data-comment-id="${targetId}"] .like-btn, [data-comment-id="${targetId}"] .comment-like-btn`;

    const btn = document.querySelector(selector);
    console.log('updateLikeButton:', type, targetId, isLiked, 'selector:', selector, 'btn:', btn);

    if (btn) {
        if (isLiked) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        // Update count - look for the like-count span
        const countSpan = btn.querySelector('.like-count, span');
        if (countSpan) {
            const currentCount = parseInt(countSpan.textContent) || 0;
            const newCount = isLiked ? currentCount + 1 : Math.max(0, currentCount - 1);
            countSpan.textContent = newCount;
        }
    } else {
        console.warn('❌ Like button not found for:', type, targetId);
    }
}

// ==================== 删除留言 ====================
async function deleteMessage(messageId) {
    if (!confirm('确定要删除这条留言吗？')) return;

    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) {
        alert('请先登录');
        return;
    }

    try {
        const { error } = await window.supabaseClient
            .from('guestbook_messages')
            .delete()
            .eq('id', messageId)
            .eq('user_id', user.id);

        if (error) throw error;

        console.log('🗑️ Message deleted');
        invalidateGuestbookCache();

        // Remove from DOM
        const msgEl = document.getElementById(`msg-${messageId}`) ||
            document.querySelector(`[data-message-id="${messageId}"]`);
        if (msgEl) {
            msgEl.style.transition = 'opacity 0.3s, transform 0.3s';
            msgEl.style.opacity = '0';
            msgEl.style.transform = 'scale(0.9)';
            setTimeout(() => msgEl.remove(), 300);
        }

    } catch (error) {
        console.error('❌ Delete error:', error);
        alert('删除失败: ' + error.message);
    }
}

// ==================== 实时订阅 (使用 NotificationManager 的降级方案) ====================
let realtimeChannel = null;

function enableRealTimeUpdates() {
    if (realtimeChannel) {
        console.log('🔌 Realtime already subscribed');
        return;
    }

    console.log('🔌 Enabling notifications with auto-fallback...');

    // Check if NotificationManager is available
    if (typeof window.NotificationManager === 'undefined') {
        console.error('❌ NotificationManager not loaded! Falling back to direct Realtime');
        enableDirectRealtime();
        return;
    }

    // Subscribe to guestbook_messages with auto-fallback
    window.NotificationManager.subscribe({
        channel: 'guestbook-messages',
        table: 'guestbook_messages',
        event: '*',
        onMessage: (payload) => {
            console.log('📬 Message change:', payload.eventType || payload.new?.id);
            handleRealtimeEvent('message', payload);
        }
    });

    // Subscribe to guestbook_comments with auto-fallback
    window.NotificationManager.subscribe({
        channel: 'guestbook-comments',
        table: 'guestbook_comments',
        event: '*',
        onMessage: (payload) => {
            console.log('💬 Comment change:', payload.eventType || payload.new?.id);
            handleRealtimeEvent('comment', payload);
        }
    });

    // Subscribe to guestbook_likes with auto-fallback
    window.NotificationManager.subscribe({
        channel: 'guestbook-likes',
        table: 'guestbook_likes',
        event: '*',
        onMessage: (payload) => {
            console.log('❤️ Like change:', payload.eventType || payload.new?.id);
            handleRealtimeEvent('like', payload);
        }
    });

    // Enable automatic Realtime recovery (tries to reconnect every 60s)
    window.NotificationManager.enableRealtimeRecovery();

    // Mark as subscribed
    realtimeChannel = true;

    console.log('✅ Notifications enabled with automatic fallback');
    console.log('📊 Current mode:', window.NotificationManager.getMode());
}

// Fallback: Direct Realtime without NotificationManager (for compatibility)
function enableDirectRealtime() {
    realtimeChannel = window.supabaseClient
        .channel('guestbook-changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'guestbook_messages' },
            (payload) => {
                console.log('📬 Message change:', payload.eventType);
                handleRealtimeEvent('message', payload);
            }
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'guestbook_comments' },
            (payload) => {
                console.log('💬 Comment change:', payload.eventType);
                handleRealtimeEvent('comment', payload);
            }
        )
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'guestbook_likes' },
            (payload) => {
                console.log('❤️ Like change:', payload.eventType);
                handleRealtimeEvent('like', payload);
            }
        )
        .subscribe((status) => {
            console.log('🔌 Realtime status:', status);
        });
}

function handleRealtimeEvent(type, payload) {
    console.log('🔔 Realtime event:', type, payload.eventType, payload);

    // Skip refresh if this is the current user's own insert
    // Using synchronous check with local recentInserts tracking
    if (payload.eventType === 'INSERT' && payload.new) {
        const insertedId = payload.new.id;

        if (guestbookCache.recentInserts.has(insertedId)) {
            console.log('⏭️ Skipping - this is our own recent insert:', insertedId);
            return;
        }

        console.log('👥 Other user\'s insert detected:', insertedId);
    }

    // Show notification and refresh for other users' inserts
    showRealtimeNotification(type, payload);
}

function showRealtimeNotification(type, payload) {
    console.log('🔔 showRealtimeNotification called:', type, payload.eventType);

    // Show notification capsule if available
    if (typeof window.CapsuleManager !== 'undefined') {
        console.log('✅ CapsuleManager found');

        if (payload.eventType === 'INSERT') {
            let text;
            if (type === 'message') {
                text = '📝 新留言';
            } else if (type === 'comment') {
                text = '💬 新评论';
            } else if (type === 'like') {
                text = '❤️ 有人点赞';
            }

            // Simple approach: directly manipulate DOM
            const capsuleText = document.getElementById('capsule-text');
            const capsule = document.getElementById('smart-capsule');

            console.log('📦 Capsule elements:', { capsuleText: !!capsuleText, capsule: !!capsule });

            if (capsuleText && capsule) {
                capsuleText.textContent = text;
                capsule.classList.add('active');

                // Auto-hide after 5 seconds
                setTimeout(() => {
                    capsule.classList.remove('active');
                }, 5000);

                console.log('💊 Capsule shown:', text);
            } else {
                console.warn('❌ Capsule elements not found in DOM');
            }
        }
    } else {
        // Fallback: simple console log
        console.log('⚠️ CapsuleManager not defined, using fallback');
        console.log('📢 Realtime update:', type, payload.eventType);
    }

    // Invalidate cache
    invalidateGuestbookCache();

    // Auto-insert new content into DOM (like LeanCloud LiveQuery)
    if (payload.eventType === 'INSERT' && payload.new) {
        const newData = payload.new;

        // Store pending update info for capsule click navigation
        window._pendingRealtimeUpdate = {
            type: type,
            id: newData.id,
            messageId: newData.message_id || newData.id,
            likeData: type === 'like' ? newData : null
        };

        // Fetch user profile and insert into DOM
        if (type === 'message') {
            // New message from another user - insert at top
            insertNewMessageFromRealtime(newData);
        } else if (type === 'comment') {
            // New comment from another user - insert into message's comment list
            insertNewCommentFromRealtime(newData);
        } else if (type === 'like') {
            // Update like count in real-time
            updateLikeCountFromRealtime(newData, true);
        }
    }

    // Handle unlike (DELETE event)
    if (payload.eventType === 'DELETE' && payload.old && type === 'like') {
        updateLikeCountFromRealtime(payload.old, false);
    }
}

// Update like count from Realtime event
function updateLikeCountFromRealtime(likeData, isLike) {
    console.log('❤️ Updating like count from Realtime:', likeData.target_type, likeData.target_id, isLike ? '+1' : '-1');

    const targetType = likeData.target_type; // 'message' or 'comment'
    const targetId = likeData.target_id;

    // Find the like button
    let likeBtn;
    if (targetType === 'message') {
        likeBtn = document.querySelector(`[data-message-id="${targetId}"] .like-btn`);
    } else {
        likeBtn = document.querySelector(`[data-comment-id="${targetId}"] .like-btn, [data-comment-id="${targetId}"] .comment-like-btn`);
    }

    if (likeBtn) {
        const countSpan = likeBtn.querySelector('.like-count, span');
        if (countSpan) {
            const currentCount = parseInt(countSpan.textContent) || 0;
            const newCount = isLike ? currentCount + 1 : Math.max(0, currentCount - 1);
            countSpan.textContent = newCount;
            console.log('✅ Like count updated:', currentCount, '->', newCount);
        }

        // Add heart animation for likes (not unlikes)
        if (isLike) {
            const heartIcon = likeBtn.querySelector('i, svg') || likeBtn;

            // Ensure animation CSS exists
            if (!document.getElementById('realtimeHeartStyle')) {
                const style = document.createElement('style');
                style.id = 'realtimeHeartStyle';
                style.textContent = `
                    @keyframes heartBounce {
                        0%, 100% { transform: scale(1); }
                        20% { transform: scale(1.3); color: #ff4757; }
                        40% { transform: scale(1); }
                        60% { transform: scale(1.2); color: #ff4757; }
                        80% { transform: scale(1); }
                    }
                `;
                document.head.appendChild(style);
            }

            // Apply animation
            heartIcon.style.animation = 'heartBounce 1.2s ease-in-out';
            heartIcon.style.color = '#ff4757';

            // Reset after animation
            setTimeout(() => {
                heartIcon.style.animation = '';
                // Keep red color if it was already liked
            }, 1500);

            console.log('💓 Heart animation triggered');
        }
    } else {
        console.warn('❌ Like button not found for:', targetType, targetId);
    }
}

// Insert new message from Realtime event
async function insertNewMessageFromRealtime(msgData) {
    console.log('📨 Inserting new message from Realtime:', msgData.id);

    try {
        // Fetch user profile
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', msgData.user_id)
            .single();

        const formattedMsg = {
            id: msgData.id,
            content: msgData.content,
            image: msgData.image_url,
            authorName: profile?.username || 'Anonymous',
            authorAvatar: profile?.avatar_url,
            authorId: msgData.user_id,
            likes: 0,
            isLiked: false,
            comments: [],
            createdAt: msgData.created_at,
            timestamp: formatTime(msgData.created_at)
        };

        // Use existing renderMessages if available, or insert directly
        if (typeof window.insertMessageToDOM === 'function') {
            window.insertMessageToDOM(formattedMsg);
        } else if (typeof window.renderMessages === 'function') {
            // Prepend to existing messages
            const container = document.getElementById('guestbook-messages');
            if (container) {
                const tempDiv = document.createElement('div');
                window.renderMessages([formattedMsg], tempDiv, true);
                if (tempDiv.firstChild) {
                    container.insertBefore(tempDiv.firstChild, container.firstChild);
                }
            }
        }

        console.log('✅ New message inserted from Realtime');
    } catch (error) {
        console.error('❌ Error inserting message from Realtime:', error);
    }
}

// Insert new comment from Realtime event
async function insertNewCommentFromRealtime(commentData) {
    console.log('💬 Inserting new comment from Realtime:', commentData.id);

    try {
        // Fetch user profile
        const { data: profile } = await window.supabaseClient
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', commentData.user_id)
            .single();

        const formattedComment = {
            id: commentData.id,
            content: commentData.content,
            name: profile?.username || 'Anonymous',
            avatarUrl: profile?.avatar_url,
            timestamp: '刚刚',
            likes: 0,
            isLiked: false,
            parentUserName: null,
            replies: []
        };

        // If it's a reply (has parent_id), insert after parent comment
        // Pass autoScroll=false to prevent auto-scrolling for Realtime events
        if (commentData.parent_id) {
            insertReplyToDOM(commentData.message_id, commentData.parent_id, formattedComment, false);
        } else {
            // Top-level comment
            insertCommentToDOM(commentData.message_id, formattedComment, false);
        }

        console.log('✅ New comment inserted from Realtime');
    } catch (error) {
        console.error('❌ Error inserting comment from Realtime:', error);
    }
}

function disableRealTimeUpdates() {
    if (realtimeChannel) {
        window.supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
        console.log('🔌 Realtime disabled');
    }
}

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', function () {
    console.log('📋 Supabase Guestbook functions loaded');

    // Auto-enable realtime on guestbook page
    if (window.location.pathname.includes('guestbook')) {
        setTimeout(enableRealTimeUpdates, 1000);
    }

    // Add capsule click handler
    const capsule = document.getElementById('smart-capsule');
    if (capsule) {
        capsule.addEventListener('click', async function () {
            console.log('💊 Capsule clicked!');

            const pending = window._pendingRealtimeUpdate;
            console.log('📌 Pending update data:', pending);

            if (pending) {
                // Save pending data BEFORE async operations
                const savedPending = { ...pending };
                console.log('📌 Saved pending:', savedPending);

                // Hide capsule and clear pending immediately to prevent double-clicks
                capsule.classList.remove('active');
                window._pendingRealtimeUpdate = null;

                // Reload messages (may be needed if content isn't already visible)
                try {
                    await loadGuestbookMessages(true);
                } catch (err) {
                    console.warn('⚠️ Failed to reload messages:', err);
                }

                // Animate to target with proper sequence - use savedPending
                setTimeout(() => {
                    console.log('🎯 Navigating to:', savedPending.type, savedPending.id);

                    if (savedPending.type === 'message') {
                        // New message: use handleSmartScroll
                        if (typeof window.handleSmartScroll === 'function') {
                            window.handleSmartScroll(savedPending.id, 'message');
                        } else {
                            // Fallback
                            const msgCard = document.querySelector(`[data-message-id="${savedPending.id}"]`);
                            if (msgCard) {
                                msgCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                highlightElement(msgCard);
                            }
                        }
                    } else if (savedPending.type === 'comment') {
                        // New comment: use handleSmartScroll - it handles expand and highlight
                        if (typeof window.handleSmartScroll === 'function') {
                            window.handleSmartScroll(savedPending.id, 'comment', savedPending.messageId);
                        } else {
                            // Fallback
                            const msgCard = document.querySelector(`[data-message-id="${savedPending.messageId}"]`);
                            if (msgCard) {
                                msgCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }
                    } else if (savedPending.type === 'like') {
                        // Like: scroll to target and animate the heart
                        const likeData = savedPending.likeData;
                        if (likeData) {
                            if (likeData.target_type === 'message') {
                                // Message like: scroll directly
                                const targetEl = document.querySelector(`[data-message-id="${likeData.target_id}"]`);
                                if (targetEl) {
                                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    highlightElement(targetEl);
                                    const likeBtn = targetEl.querySelector('.like-btn');
                                    if (likeBtn) pulseHeartAnimation(likeBtn);
                                }
                            } else {
                                // Comment like: use handleSmartScroll to expand and navigate
                                // First, find the message that contains this comment
                                const commentEl = document.querySelector(`[data-comment-id="${likeData.target_id}"]`);
                                const messageId = commentEl?.getAttribute('data-message-id');

                                if (typeof window.handleSmartScroll === 'function') {
                                    window.handleSmartScroll(likeData.target_id, 'comment', messageId);
                                    // Add heart animation after scroll completes
                                    setTimeout(() => {
                                        const likeBtn = document.querySelector(`[data-comment-id="${likeData.target_id}"] .like-btn, [data-comment-id="${likeData.target_id}"] .comment-like-btn`);
                                        if (likeBtn) pulseHeartAnimation(likeBtn);
                                    }, 1500);
                                } else {
                                    // Fallback
                                    if (commentEl) {
                                        commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        highlightElement(commentEl);
                                        const likeBtn = commentEl.querySelector('.like-btn, .comment-like-btn');
                                        if (likeBtn) pulseHeartAnimation(likeBtn);
                                    }
                                }
                            }
                        }
                    }
                }, 500);
            } else {
                // No pending, just refresh
                capsule.classList.remove('active');
                await loadGuestbookMessages(true);
            }
        });
        console.log('✅ Capsule click handler added');
    }

    // Helper function to highlight element - use existing CSS class
    function highlightElement(el) {
        el.classList.remove('highlight-flash');
        // Force reflow to restart animation
        void el.offsetWidth;
        el.classList.add('highlight-flash');

        // Remove class after animation completes
        setTimeout(() => {
            el.classList.remove('highlight-flash');
        }, 3000);
    }

    // Heart pulse animation - slower, more natural breathing effect
    function pulseHeartAnimation(likeBtn) {
        const heartIcon = likeBtn.querySelector('i, svg') || likeBtn;

        // Add pulse animation - 1s per cycle, 3 times
        heartIcon.style.animation = 'heartPulse 1s ease-in-out 3';
        heartIcon.style.color = '#ff4757';

        // Remove animation after it completes
        setTimeout(() => {
            heartIcon.style.animation = '';
        }, 3500);
    }

    // Add CSS animation if not exists
    if (!document.getElementById('heartPulseStyle')) {
        const style = document.createElement('style');
        style.id = 'heartPulseStyle';
        style.textContent = `
            @keyframes heartPulse {
                0%, 100% { transform: scale(1); }
                15% { transform: scale(1.25); }
                30% { transform: scale(1); }
                45% { transform: scale(1.15); }
                60% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }
});

// ==================== 表单绑定 ====================
document.addEventListener('DOMContentLoaded', function () {
    console.log('📋 绑定留言板表单...');

    const guestbookForm = document.getElementById('guestbookForm');

    if (guestbookForm) {
        guestbookForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            console.log('📝 提交留言表单');

            // 检查登录状态 (Supabase)
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) {
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
                    document.body.classList.remove('no-scroll');
                }

                // 如果在首页，不跳转，显示成功提示
                const isHomepage = window.location.pathname === '/' || window.location.pathname === '/index.html';
                if (isHomepage) {
                    // 显示成功提示
                    const toast = document.createElement('div');
                    toast.textContent = window.i18n?.t('guestbook.postSuccess') || '留言成功！';
                    toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:12px 24px;border-radius:12px;z-index:10000;font-size:14px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,0.3);animation:fadeInUp 0.3s ease';
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                } else {
                    // 其他页面，跳转到留言板
                    window.location.href = 'guestbook.html';
                }
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

    let currentImageData = null;

    if (imageUpload) {
        imageUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                alert('请选择有效的图片文件!');
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                alert('图片文件过大! 请选择小于5MB的图片。');
                return;
            }

            try {
                currentImageData = await compressImage(file);
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

    async function compressImage(file, maxWidth = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressedData = canvas.toDataURL('image/jpeg', quality);
                    resolve(compressedData);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    window.clearGuestbookImage = clearImage;
    window.getCurrentImageData = () => currentImageData;
});

// ==================== 直接插入评论到 DOM ====================
function insertCommentToDOM(messageId, comment, autoScroll = true) {
    console.log('📝 Inserting comment to DOM:', messageId, comment.id, 'autoScroll:', autoScroll);

    // Find the message's comment list
    const messageCard = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageCard) {
        console.warn('❌ Message card not found:', messageId);
        return;
    }

    const commentList = messageCard.querySelector('.comment-list');
    if (!commentList) {
        console.warn('❌ Comment list not found in message:', messageId);
        return;
    }

    // Create comment HTML
    const avatarHtml = comment.avatarUrl
        ? `<img src="${comment.avatarUrl}" alt="${escapeHTML(comment.name)}" class="comment-avatar">`
        : '<i class="fas fa-user-circle comment-avatar-placeholder"></i>';

    const commentHtml = `
        <div class="comment-item comment-item--clickable" 
             data-comment-id="${comment.id}" 
             data-message-id="${messageId}"
             data-can-reply="true"
             style="animation: slideIn 0.3s ease;">
            <div class="comment-row">
                <div class="comment-main">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHTML(comment.name)}</span>
                        <span class="comment-time">${comment.timestamp}</span>
                    </div>
                    <div class="comment-content">${escapeHTML(comment.content)}</div>
                </div>
                <div class="comment-like-wrapper">
                    <button class="comment-like-btn" 
                            onclick="handleLike('Comment', '${comment.id}', this)">
                        <i class="far fa-heart"></i>
                        <span class="like-count">0</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Insert at the end of the comment list
    commentList.insertAdjacentHTML('beforeend', commentHtml);

    // Update comment count
    const commentBtn = messageCard.querySelector('.comment-btn span');
    if (commentBtn) {
        const currentCount = parseInt(commentBtn.textContent) || 0;
        commentBtn.textContent = currentCount + 1;
    }

    // If collapsed, expand to show new comment
    if (commentList.classList.contains('collapsed')) {
        commentList.classList.remove('collapsed');
        const toggleBtn = messageCard.querySelector('.comment-toggle-btn');
        if (toggleBtn) {
            toggleBtn.querySelector('span').textContent = '收起';
            toggleBtn.querySelector('i').className = 'fas fa-chevron-up';
        }
    }

    // Scroll to show the new comment (only if autoScroll is true)
    if (autoScroll) {
        const newComment = commentList.lastElementChild;
        if (newComment) {
            setTimeout(() => {
                newComment.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    console.log('✅ Comment inserted to DOM');
}

// ==================== 直接插入回复到 DOM (嵌套) ====================
function insertReplyToDOM(messageId, parentCommentId, reply, autoScroll = true) {
    console.log('📝 Inserting reply to DOM:', parentCommentId, reply.id, 'autoScroll:', autoScroll);

    // Find the parent comment
    const parentComment = document.querySelector(`[data-comment-id="${parentCommentId}"]`);
    if (!parentComment) {
        console.warn('❌ Parent comment not found:', parentCommentId);
        // Fallback: insert as top-level comment
        insertCommentToDOM(messageId, reply, autoScroll);
        return;
    }

    // Create @mention prefix
    const mentionPrefix = reply.parentUserName
        ? `<span class="comment-mention">@${escapeHTML(reply.parentUserName)}</span> `
        : '';

    // Create reply HTML
    const replyHtml = `
        <div class="comment-item comment-item--nested comment-item--clickable" 
             style="margin-left: 10px; animation: slideIn 0.3s ease;"
             data-comment-id="${reply.id}" 
             data-message-id="${messageId}"
             data-can-reply="true">
            <div class="comment-row">
                <div class="comment-main">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHTML(reply.name)}</span>
                        <span class="comment-time">${reply.timestamp}</span>
                    </div>
                    <div class="comment-content">${mentionPrefix}${escapeHTML(reply.content)}</div>
                </div>
                <div class="comment-like-wrapper">
                    <button class="comment-like-btn" 
                            onclick="handleLike('Comment', '${reply.id}', this)">
                        <i class="far fa-heart"></i>
                        <span class="like-count">0</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Insert after the parent comment
    parentComment.insertAdjacentHTML('afterend', replyHtml);

    // Update comment count on the message
    const messageCard = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageCard) {
        const commentBtn = messageCard.querySelector('.comment-btn span');
        if (commentBtn) {
            const currentCount = parseInt(commentBtn.textContent) || 0;
            commentBtn.textContent = currentCount + 1;
        }
    }

    // Scroll to show the new reply (only if autoScroll is true)
    if (autoScroll) {
        const newReply = parentComment.nextElementSibling;
        if (newReply) {
            setTimeout(() => {
                newReply.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    console.log('✅ Reply inserted to DOM');
}

// ==================== 挂载到 window ====================
window.loadGuestbookMessages = loadGuestbookMessages;
window.addMessage = addMessage;
window.addCommentToMessage = addCommentToMessage;
window.addReplyToComment = addReplyToComment;
window.toggleLike = toggleLike;
window.deleteMessage = deleteMessage;
window.enableRealTimeUpdates = enableRealTimeUpdates;
window.disableRealTimeUpdates = disableRealTimeUpdates;
window.invalidateGuestbookCache = invalidateGuestbookCache;
window.insertCommentToDOM = insertCommentToDOM;
window.insertReplyToDOM = insertReplyToDOM;

// For compatibility with existing code
window.loadGuestbookMessages.invalidateGuestbookCache = invalidateGuestbookCache;

console.log('✅ Supabase 留言板函数已加载');

