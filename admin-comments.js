/**
 * Admin Comments Module
 * Manages both guestbook messages and gallery comments
 */

// Get supabase client reference
const getSupabase = () => window.supabaseClient;

// Current state
let currentCommentView = 'guestbook'; // 'guestbook' or 'gallery'
let commentsData = [];
let commentsLoading = false;
let commentsInitialized = false;

// Filter state
const filterState = {
    date: 'all',           // 'all', 'today', 'week', 'month', or {from, to}
    user: '',              // username search string
    status: 'all',         // 'all', 'replied', 'unreplied'
    type: 'all',           // 'all', 'top', 'reply'
    hasImage: false,       // checkbox
    source: 'all'          // 'all', 'guestbook', 'gallery'
};

/**
 * Initialize Comments Module
 */
function initCommentsModule() {
    console.log('Initializing Comments Module...');

    // Check if supabase is available
    if (!getSupabase()) {
        console.error('Supabase client not available!');
        document.getElementById('adminCommentList').innerHTML =
            '<p class="error-text">数据库连接失败，请刷新页面重试</p>';
        return;
    }

    // Prevent double initialization
    if (commentsInitialized) {
        console.log('Comments module already initialized');
        return;
    }
    commentsInitialized = true;

    loadCommentStats();
    loadComments(currentCommentView);
    setupCommentEventHandlers();
}

/**
 * Setup event handlers
 */
function setupCommentEventHandlers() {
    // Search input (searches both content AND usernames)
    const searchInput = document.getElementById('commentSearch');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                // Set user filter to search term so it also filters by author
                filterState.user = e.target.value.trim();
                loadComments(currentCommentView);
            }, 300);
        });
    }

    // Setup filter dropdowns
    setupFilterDropdowns();
}

/**
 * Setup filter dropdown interactions
 */
function setupFilterDropdowns() {
    // Toggle dropdown on button click
    document.querySelectorAll('.filter-dropdown .filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = btn.closest('.filter-dropdown');

            // Close other dropdowns
            document.querySelectorAll('.filter-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });

            // Toggle this dropdown
            dropdown.classList.toggle('open');
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-dropdown')) {
            document.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
        }
    });

    // Handle filter option selection
    document.querySelectorAll('.filter-popup .filter-option').forEach(option => {
        option.addEventListener('click', () => {
            const dropdown = option.closest('.filter-dropdown');
            const filterType = dropdown.dataset.filter;
            const value = option.dataset.value;

            // Update selection UI
            dropdown.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');

            // Update filter state
            updateFilterState(filterType, value);

            // Update button label and active state
            const btn = dropdown.querySelector('.filter-btn');
            const label = dropdown.querySelector('.filter-label');
            if (value !== 'all') {
                btn.classList.add('active');
                label.textContent = option.textContent;
            } else {
                btn.classList.remove('active');
                label.textContent = getDefaultLabel(filterType);
            }

            // Close dropdown and reload
            dropdown.classList.remove('open');
            loadComments(currentCommentView);
        });
    });

    // Handle hasImage checkbox
    const hasImageCheckbox = document.getElementById('filterHasImage');
    if (hasImageCheckbox) {
        hasImageCheckbox.addEventListener('change', () => {
            filterState.hasImage = hasImageCheckbox.checked;
            loadComments(currentCommentView);
        });
    }

    // Handle user search
    const userSearchInput = document.getElementById('filterUserSearch');
    if (userSearchInput) {
        let timeout;
        userSearchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                filterState.user = e.target.value.trim();
                const userBtn = document.querySelector('[data-filter="user"] .filter-btn');
                if (filterState.user) {
                    userBtn.classList.add('active');
                } else {
                    userBtn.classList.remove('active');
                }
                loadComments(currentCommentView);
            }, 300);
        });
    }
}

/**
 * Update filter state
 */
function updateFilterState(filterType, value) {
    switch (filterType) {
        case 'date':
            filterState.date = value;
            break;
        case 'status':
            filterState.status = value;
            break;
        case 'type':
            filterState.type = value;
            break;
        case 'source':
            filterState.source = value;
            break;
    }
}

/**
 * Get default label for filter type
 */
function getDefaultLabel(filterType) {
    const labels = {
        date: '日期',
        user: '用户',
        status: '状态',
        type: '类型',
        source: '来源'
    };
    return labels[filterType] || filterType;
}

/**
 * Apply filters to comments array
 */
function applyFilters(comments) {
    return comments.filter(comment => {
        // Date filter
        if (filterState.date !== 'all') {
            const commentDate = new Date(comment.created_at);
            const now = new Date();

            if (filterState.date === 'today') {
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                if (commentDate < todayStart) return false;
            } else if (filterState.date === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                if (commentDate < weekAgo) return false;
            } else if (filterState.date === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                if (commentDate < monthAgo) return false;
            }
        }

        // Search filter (matches content OR username)
        if (filterState.user) {
            const searchTerm = filterState.user.toLowerCase();
            const matchesContent = comment.content.toLowerCase().includes(searchTerm);
            const matchesAuthor = comment.author.toLowerCase().includes(searchTerm);
            if (!matchesContent && !matchesAuthor) {
                return false;
            }
        }

        // Type filter
        if (filterState.type === 'top' && comment.parent_id) return false;
        if (filterState.type === 'reply' && !comment.parent_id) return false;

        // Has image filter
        if (filterState.hasImage && !comment.image_url) return false;

        // Source filter is handled during fetch, but double-check here
        if (filterState.source !== 'all' && comment.type !== filterState.source) return false;

        return true;
    });
}

/**
 * Load comment statistics
 */
async function loadCommentStats() {
    try {
        // Get total comments count
        const { count: guestbookCount } = await getSupabase()
            .from('guestbook_messages')
            .select('*', { count: 'exact', head: true });

        const { count: galleryCount } = await getSupabase()
            .from('prompt_comments')
            .select('*', { count: 'exact', head: true });

        const totalCount = (guestbookCount || 0) + (galleryCount || 0);

        // Get today's comments
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();

        const { count: todayGuestbook } = await getSupabase()
            .from('guestbook_messages')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', todayISO);

        const { count: todayGallery } = await getSupabase()
            .from('prompt_comments')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', todayISO);

        const todayCount = (todayGuestbook || 0) + (todayGallery || 0);

        // Get unique users (simplified - based on gallery comments with user_id)
        const { data: uniqueUsers } = await getSupabase()
            .from('prompt_comments')
            .select('user_id')
            .not('user_id', 'is', null);

        const uniqueUserIds = new Set(uniqueUsers?.map(u => u.user_id) || []);
        const activeUsersCount = uniqueUserIds.size;

        // Get last week's comments for growth calculation
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        const lastWeekISO = lastWeek.toISOString();

        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const twoWeeksAgoISO = twoWeeksAgo.toISOString();

        const { count: thisWeekCount } = await getSupabase()
            .from('prompt_comments')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', lastWeekISO);

        const { count: prevWeekCount } = await getSupabase()
            .from('prompt_comments')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', twoWeeksAgoISO)
            .lt('created_at', lastWeekISO);

        let weekGrowth = 0;
        if (prevWeekCount && prevWeekCount > 0) {
            weekGrowth = Math.round(((thisWeekCount - prevWeekCount) / prevWeekCount) * 100);
        }

        // Update UI
        document.getElementById('totalCommentsCount').textContent = totalCount;
        document.getElementById('todayCommentsCount').textContent = todayCount;
        document.getElementById('activeUsersCount').textContent = activeUsersCount;
        document.getElementById('weekGrowth').textContent =
            weekGrowth >= 0 ? `+${weekGrowth}%` : `${weekGrowth}%`;

    } catch (error) {
        console.error('Error loading comment stats:', error);
    }
}

/**
 * Switch comment view (guestbook/gallery)
 */
function switchCommentView(view) {
    currentCommentView = view;

    // Update tab active state
    document.querySelectorAll('[data-comment-view]').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-comment-view="${view}"]`)?.classList.add('active');

    // Load comments for the selected view
    loadComments(view);
}

/**
 * Load comments from database
 */
async function loadComments(view) {
    if (commentsLoading) return;
    commentsLoading = true;

    const listContainer = document.getElementById('adminCommentList');
    if (!listContainer) {
        commentsLoading = false;
        return;
    }

    listContainer.innerHTML = '<p class="loading-text">加载中...</p>';

    try {
        const searchQuery = document.getElementById('commentSearch')?.value?.trim() || '';
        const dateFrom = document.getElementById('commentDateFrom')?.value || '';
        const dateTo = document.getElementById('commentDateTo')?.value || '';

        let data = [];

        if (view === 'guestbook') {
            // Load guestbook messages
            let query = getSupabase()
                .from('guestbook_messages')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);


            // Note: Search filtering is done client-side via applyFilters to support
            // searching by both content AND username simultaneously
            if (dateFrom) {
                query = query.gte('created_at', dateFrom);
            }
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                query = query.lt('created_at', endDate.toISOString());
            }

            const { data: messages, error } = await query;
            if (error) throw error;

            data = (messages || []).map(msg => ({
                id: msg.id,
                type: 'guestbook',
                content: msg.content,
                author: msg.nickname || '匿名访客',
                avatar: msg.avatar_url,
                created_at: msg.created_at,
                context: null,
                user_id: null
            }));

        } else {
            // Load gallery comments
            let query = getSupabase()
                .from('prompt_comments')
                .select(`
                    *,
                    profiles:user_id (username, avatar_url)
                `)
                .order('created_at', { ascending: false })
                .limit(50);


            // Note: Search filtering is done client-side via applyFilters
            if (dateFrom) {
                query = query.gte('created_at', dateFrom);
            }
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                query = query.lt('created_at', endDate.toISOString());
            }

            const { data: comments, error } = await query;
            if (error) throw error;

            data = (comments || []).map(comment => ({
                id: comment.id,
                type: 'gallery',
                content: comment.content,
                author: comment.profiles?.username || '未知用户',
                avatar: comment.profiles?.avatar_url,
                created_at: comment.created_at,
                context: comment.prompt_id,
                user_id: comment.user_id,
                parent_id: comment.parent_id,
                image_url: comment.image_url || null
            }));
        }

        commentsData = data;
        // Apply filters before rendering
        const filteredComments = applyFilters(data);
        renderCommentList(filteredComments);

    } catch (error) {
        console.error('Error loading comments:', error);
        listContainer.innerHTML = `<p class="error-text">加载失败: ${error.message}</p>`;
    } finally {
        commentsLoading = false;
    }
}

/**
 * Render comment list
 */
function renderCommentList(comments) {
    const container = document.getElementById('adminCommentList');
    if (!container) return;

    // Reset selection state
    resetSelection();

    if (comments.length === 0) {
        container.innerHTML = '<p class="empty-text">暂无评论</p>';
        return;
    }

    // Render comments with new structure
    container.innerHTML = comments.map(comment => {
        const avatarInitial = comment.author.charAt(0).toUpperCase();
        const timeStr = formatTimeAgo(comment.created_at);
        // Reply badge (English) - shown at bottom-left if this is a reply
        const isReply = comment.parent_id ? true : false;
        const replyBadge = isReply ? `<span class="reply-badge">Reply</span>` : '';
        const sourceLabel = comment.type === 'guestbook' ? '留言板' : '画廊';

        // Context Pill for List (inline) or Grid (in content)
        // We put it in content for Grid, and List view will handle flow via CSS

        return `
            <div class="comment-admin-item" data-id="${comment.id}" data-type="${comment.type}" onclick="toggleCommentSelection(event, 'cb-${comment.id}')">
                
                <!-- 1. Checkbox Wrapper -->
                <div class="item-checkbox-wrapper">
                    <input type="checkbox" class="comment-checkbox" id="cb-${comment.id}" 
                        data-id="${comment.id}" data-type="${comment.type}"
                        onclick="event.stopPropagation(); updateSelection()">
                </div>

                <!-- 2. Header: Avatar + Meta (Name, Time) -->
                <div class="item-header">
                    <div class="item-avatar" style="${comment.avatar ? `background-image: url(${comment.avatar});` : ''}">
                        ${comment.avatar ? '' : avatarInitial}
                    </div>
                    <div class="item-meta">
                        <span class="item-name" title="${escapeHtml(comment.author)}">${escapeHtml(comment.author)}</span>
                        <span class="item-time">${timeStr}</span>
                    </div>
                </div>

                <!-- 3. Content Body -->
                <div class="item-content">
                    <p class="item-text">${escapeHtml(comment.content)}</p>
                </div>

                <!-- 4. Actions Container (delete on top, view below) -->
                <div class="item-actions">
                    <button class="action-delete" onclick="event.stopPropagation(); deleteComment('${comment.id}', '${comment.type}')" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                    ${comment.context ?
                `<button class="action-view" onclick="event.stopPropagation(); viewCommentContext('${comment.context}', '${comment.id}')" title="查看详情">
                        <i class="fas fa-external-link-alt"></i>
                    </button>` : ''}
                </div>

                <!-- Reply Badge (bottom-left in Grid, below avatar in List) -->
                ${replyBadge}

            </div>
        `;
    }).join('');
}

/**
 * Item selection handler (triggered by card click)
 */
function toggleCommentSelection(event, checkboxId) {
    // Ignore if clicked on button or link or input
    if (event.target.closest('button') || event.target.closest('a') || event.target.closest('input')) {
        return;
    }

    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        updateSelection();
    }
}

/**
 * Reset selection state
 */
function resetSelection() {
    const selectAll = document.getElementById('selectAllComments');
    if (selectAll) selectAll.checked = false;
    updateSelectionUI(0);
}

/**
 * Toggle select all checkboxes
 */
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAllComments');
    const checkboxes = document.querySelectorAll('.comment-checkbox');

    checkboxes.forEach(cb => {
        cb.checked = selectAll.checked;
        const item = cb.closest('.comment-admin-item');
        if (item) {
            item.classList.toggle('selected', selectAll.checked);
        }
    });

    updateSelectionUI(selectAll.checked ? checkboxes.length : 0);
}

/**
 * Update selection when individual checkbox changes
 */
function updateSelection() {
    const checkboxes = document.querySelectorAll('.comment-checkbox');
    const checked = document.querySelectorAll('.comment-checkbox:checked');
    const selectAll = document.getElementById('selectAllComments');

    // Update select all checkbox
    if (selectAll) {
        selectAll.checked = checked.length === checkboxes.length && checkboxes.length > 0;
        selectAll.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
    }

    // Update item selected state
    checkboxes.forEach(cb => {
        const item = cb.closest('.comment-admin-item');
        if (item) {
            item.classList.toggle('selected', cb.checked);
        }
    });

    updateSelectionUI(checked.length);
}

/**
 * Update selection UI (count and button state)
 */
function updateSelectionUI(count) {
    const countEl = document.getElementById('selectionCount');
    const deleteBtn = document.getElementById('batchDeleteBtn');

    if (countEl) countEl.textContent = `已选 ${count} 条`;
    if (deleteBtn) deleteBtn.disabled = count === 0;
}

/**
 * Batch delete selected comments
 */
async function batchDeleteComments() {
    const checked = document.querySelectorAll('.comment-checkbox:checked');
    if (checked.length === 0) return;

    if (!confirm(`确定要删除选中的 ${checked.length} 条评论吗？此操作无法撤销。`)) return;

    const items = Array.from(checked).map(cb => ({
        id: cb.dataset.id,
        type: cb.dataset.type
    }));

    // Group by type for batch deletion
    const guestbookIds = items.filter(i => i.type === 'guestbook').map(i => i.id);
    const galleryIds = items.filter(i => i.type === 'gallery').map(i => i.id);

    let deleted = 0;
    let errors = 0;

    try {
        // Delete guestbook messages
        if (guestbookIds.length > 0) {
            const { error } = await getSupabase()
                .from('guestbook_messages')
                .delete()
                .in('id', guestbookIds);

            if (error) {
                console.error('Error deleting guestbook messages:', error);
                errors += guestbookIds.length;
            } else {
                deleted += guestbookIds.length;
            }
        }

        // Delete gallery comments
        if (galleryIds.length > 0) {
            const { error } = await getSupabase()
                .from('prompt_comments')
                .delete()
                .in('id', galleryIds);

            if (error) {
                console.error('Error deleting gallery comments:', error);
                errors += galleryIds.length;
            } else {
                deleted += galleryIds.length;
            }
        }

        // Update UI
        if (deleted > 0) {
            showToast(`成功删除 ${deleted} 条评论`, 'success');
            loadCommentStats();
            loadComments(currentCommentView);
        }

        if (errors > 0) {
            showToast(`${errors} 条评论删除失败`, 'error');
        }

    } catch (error) {
        console.error('Batch delete error:', error);
        showToast('批量删除失败: ' + error.message, 'error');
    }
}

/**
 * Delete a comment
 */
async function deleteComment(id, type) {
    if (!confirm('确定要删除这条评论吗？此操作无法撤销。')) return;

    try {
        const table = type === 'guestbook' ? 'guestbook_messages' : 'prompt_comments';
        const { error } = await getSupabase()
            .from(table)
            .delete()
            .eq('id', id);

        if (error) throw error;

        // Remove from UI
        const item = document.querySelector(`.comment-admin-item[data-id="${id}"]`);
        if (item) {
            item.style.opacity = '0';
            item.style.transform = 'translateY(-20px)';
            setTimeout(() => item.remove(), 200);
        }

        // Refresh stats
        loadCommentStats();
        showToast('评论已删除', 'success');

    } catch (error) {
        console.error('Error deleting comment:', error);
        showToast('删除失败: ' + error.message, 'error');
    }
}

/**
 * View comment context (open prompt in new tab with comments visible and scroll to specific comment)
 */
function viewCommentContext(promptId, commentId) {
    window.open(`prompts.html?id=${promptId}&comments=1&commentId=${commentId}`, '_blank');
}

/**
 * Format time ago
 */
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}天前`;

    return date.toLocaleDateString('zh-CN');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Current source filter state
let currentSourceFilter = 'all';

// Current layout view state (grid or list)
let currentViewLayout = localStorage.getItem('admin_comment_layout') || 'grid';

/**
 * Switch Layout View (Grid/List)
 */
function switchLayoutView(layout) {
    currentViewLayout = layout;
    localStorage.setItem('admin_comment_layout', layout);

    // Update container class
    const container = document.getElementById('adminCommentList');
    if (container) {
        if (layout === 'list') {
            container.classList.add('list-view');
        } else {
            container.classList.remove('list-view');
        }
    }

    // Refresh render to ensure correct structure/layout logic if needed
    // (CSS handles most, but 'View' button icon might change)
    if (document.querySelectorAll('.comment-admin-item').length > 0) {
        loadComments(currentCommentView);
    }

    // Update button states
    const btns = document.querySelectorAll('.view-btn');
    btns.forEach(btn => {
        if (btn.dataset.view === layout) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}
// Initialize layout on load
document.addEventListener('DOMContentLoaded', () => {
    switchLayoutView(currentViewLayout);
});

// Export functions for global access
window.initCommentsModule = initCommentsModule;
window.switchCommentView = switchCommentView;
window.loadComments = loadComments;
window.deleteComment = deleteComment;
window.viewCommentContext = viewCommentContext;
window.toggleSelectAll = toggleSelectAll;
window.updateSelection = updateSelection;
window.batchDeleteComments = batchDeleteComments;
window.switchLayoutView = switchLayoutView;
window.toggleCommentSelection = toggleCommentSelection;


