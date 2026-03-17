/**
 * Admin Comments Module
 * Manages both guestbook messages and gallery comments
 */

// Get supabase client reference - check if already defined (from admin-points.js)
// Use existing function if available, otherwise define it
if (typeof getSupabase === 'undefined') {
    window.getSupabase = () => window.supabaseClient || window.supabase;
}

// Current state
// Current state
let currentCommentView = 'guestbook'; // 'guestbook' or 'gallery'
let commentsData = [];
let commentsLoading = false;
let commentsInitialized = false;
let filteredComments = []; // Global filtered data for export

// Filter state
const filterState = {
    date: 'all',           // 'all', 'today', 'week', 'month', 'custom'
    dateFrom: null,        // custom range start (datetime string)
    dateTo: null,          // custom range end (datetime string)
    user: '',              // DEPRECATED - separate search tags used instead
    currentSearchInput: '', // Live search input value
    status: 'all',         // 'all', 'replied', 'unreplied'
    type: 'all',           // 'all', 'top', 'reply'
    hasImage: false,       // checkbox
    source: 'all',         // 'all', 'guestbook', 'gallery'
    searchTags: []         // Array of search strings
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

            // Skip action dropdowns (like Export)
            if (filterType === 'export') return;

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

    // Expose export function globally
    window.exportData = exportData;

    // Handle hasImage checkbox
    const hasImageCheckbox = document.getElementById('filterHasImage');
    if (hasImageCheckbox) {
        hasImageCheckbox.addEventListener('change', () => {
            filterState.hasImage = hasImageCheckbox.checked;
            loadComments(currentCommentView);
        });
    }

    // Handle user search (Enter key to add tag, Input for live search)
    const userSearchInput = document.getElementById('commentSearch');
    if (userSearchInput) {
        // Enter key -> Create Tag
        userSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = e.target.value.trim();
                if (val && !filterState.searchTags.includes(val)) {
                    filterState.searchTags.push(val);
                    filterState.currentSearchInput = ''; // Clear live input state
                    e.target.value = ''; // Clear input UI
                    loadComments(currentCommentView);
                }
            }
        });

        // Input -> Live Search
        let timeout;
        userSearchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                filterState.currentSearchInput = e.target.value.trim();
                loadComments(currentCommentView);
            }, 300);
        });
    }

    // Handle custom date range inputs with Flatpickr
    const dateFromInput = document.getElementById('filterDateFrom');
    const dateToInput = document.getElementById('filterDateTo');

    const applyCustomDateRange = () => {
        if (dateFromInput.value || dateToInput.value) {
            filterState.date = 'custom';
            // Flatpickr value is already properly formatted if configured correctly
            filterState.dateFrom = dateFromInput.value || null;
            filterState.dateTo = dateToInput.value || null;

            // Update date filter button to show active state
            const dateDropdown = document.querySelector('[data-filter="date"]');
            const dateBtn = dateDropdown?.querySelector('.filter-btn');
            const dateLabel = dateDropdown?.querySelector('.filter-label');
            if (dateBtn) dateBtn.classList.add('active');
            if (dateLabel) dateLabel.textContent = '自定义';

            // Clear preset selections
            dateDropdown?.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));

            loadComments(currentCommentView);
        }
    };

    // Initialize Flatpickr
    const flatpickrConfig = {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        theme: "dark",
        locale: "zh",
        onChange: function (selectedDates, dateStr, instance) {
            applyCustomDateRange();
        }
    };

    // Check if flatpickr is loaded, if not wait a bit
    const initFlatpickr = () => {
        if (window.flatpickr) {
            if (dateFromInput) flatpickr(dateFromInput, flatpickrConfig);
            if (dateToInput) flatpickr(dateToInput, flatpickrConfig);
        } else {
            console.warn('Flatpickr not loaded yed, retrying...');
            setTimeout(initFlatpickr, 100);
        }
    };

    initFlatpickr();
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
            } else if (filterState.date === 'custom') {
                // Custom date range (datetime-local gives minute precision)
                if (filterState.dateFrom) {
                    const fromDate = new Date(filterState.dateFrom);
                    if (commentDate < fromDate) return false;
                }
                if (filterState.dateTo) {
                    const toDate = new Date(filterState.dateTo);
                    if (commentDate > toDate) return false;
                }
            }
        }

        // Search filter (Accumulative tags AND Live Input - AND logic)
        // 1. Check Tags
        if (filterState.searchTags.length > 0) {
            const matchesTags = filterState.searchTags.every(tag => {
                const searchTerm = tag.toLowerCase();
                const matchesContent = comment.content.toLowerCase().includes(searchTerm);
                const matchesAuthor = comment.author.toLowerCase().includes(searchTerm);
                const matchesPrompt = comment.prompt_title && comment.prompt_title.toLowerCase().includes(searchTerm);
                const matchesId = comment.id && comment.id.toLowerCase().includes(searchTerm);
                const matchesParentId = comment.parent_id && String(comment.parent_id).toLowerCase().includes(searchTerm);
                return matchesContent || matchesAuthor || matchesPrompt || matchesId || matchesParentId;
            });
            if (!matchesTags) return false;
        }

        // 2. Check Live Input
        if (filterState.currentSearchInput) {
            const searchTerm = filterState.currentSearchInput.toLowerCase();

            // Special keyword: "置顶" filters pinned comments only
            if (searchTerm === '置顶' || searchTerm === 'pinned') {
                if (!comment.is_pinned) return false;
            } else {
                const matchesContent = comment.content.toLowerCase().includes(searchTerm);
                const matchesAuthor = comment.author.toLowerCase().includes(searchTerm);
                const matchesPrompt = comment.prompt_title && comment.prompt_title.toLowerCase().includes(searchTerm);
                const matchesId = comment.id && comment.id.toLowerCase().includes(searchTerm);
                const matchesParentId = comment.parent_id && String(comment.parent_id).toLowerCase().includes(searchTerm);

                if (!matchesContent && !matchesAuthor && !matchesPrompt && !matchesId && !matchesParentId) return false;
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
        const { count: guestbookCount } = await (function () {
            let q = getSupabase().from('guestbook_messages').select('*', { count: 'exact', head: true });
            if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
            return q;
        })();

        const { count: galleryCount } = await (function () {
            let q = getSupabase().from('prompt_comments').select('*', { count: 'exact', head: true });
            if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
            return q;
        })();

        const totalCount = (guestbookCount || 0) + (galleryCount || 0);

        // Get today's comments
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();

        const { count: todayGuestbook } = await (function () {
            let q = getSupabase().from('guestbook_messages').select('*', { count: 'exact', head: true }).gte('created_at', todayISO);
            if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
            return q;
        })();

        const { count: todayGallery } = await (function () {
            let q = getSupabase().from('prompt_comments').select('*', { count: 'exact', head: true }).gte('created_at', todayISO);
            if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
            return q;
        })();

        const todayCount = (todayGuestbook || 0) + (todayGallery || 0);

        // Get unique users (simplified - based on gallery comments with user_id)
        const { data: uniqueUsers } = await (function () {
            let q = getSupabase().from('prompt_comments').select('user_id').not('user_id', 'is', null);
            if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
            return q;
        })();

        const uniqueUserIds = new Set(uniqueUsers?.map(u => u.user_id) || []);
        const activeUsersCount = uniqueUserIds.size;

        // Get last week's comments for growth calculation
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        const lastWeekISO = lastWeek.toISOString();

        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const twoWeeksAgoISO = twoWeeksAgo.toISOString();

        const { count: thisWeekCount } = await (function () {
            let q = getSupabase().from('prompt_comments').select('*', { count: 'exact', head: true }).gte('created_at', lastWeekISO);
            if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
            return q;
        })();

        const { count: prevWeekCount } = await (function () {
            let q = getSupabase().from('prompt_comments').select('*', { count: 'exact', head: true }).gte('created_at', twoWeeksAgoISO).lt('created_at', lastWeekISO);
            if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
            return q;
        })();

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
 * Render active filter tags
 */
function renderFilterTags() {
    const container = document.getElementById('activeFilterTags');
    if (!container) return;

    let tagsHtml = '';

    // Date Filter
    if (filterState.date !== 'all') {
        let label = '时间';
        let value = '';
        if (filterState.date === 'today') value = '今天';
        else if (filterState.date === 'week') value = '本周';
        else if (filterState.date === 'month') value = '本月';
        else if (filterState.date === 'custom') {
            const start = filterState.dateFrom ? filterState.dateFrom.split(' ')[0] : '...';
            const end = filterState.dateTo ? filterState.dateTo.split(' ')[0] : '...';
            value = `${start} - ${end}`;
        }
        tagsHtml += createTagHtml('date', label, value);
    }

    // Status Filter
    if (filterState.status !== 'all') {
        const value = filterState.status === 'replied' ? '已回复' : '未回复';
        tagsHtml += createTagHtml('status', '状态', value);
    }

    // Type Filter
    if (filterState.type !== 'all') {
        const value = filterState.type === 'top' ? '主评论' : '子回复';
        tagsHtml += createTagHtml('type', '层级', value);
    }

    // Has Image
    if (filterState.hasImage) {
        tagsHtml += createTagHtml('hasImage', '包含', '图片');
    }

    // User Search Tags
    if (filterState.searchTags && filterState.searchTags.length > 0) {
        filterState.searchTags.forEach(tag => {
            tagsHtml += createTagHtml('searchTag', '搜索', tag, tag); // Pass value as ID for removal
        });
    }

    container.innerHTML = tagsHtml;
}

function createTagHtml(type, label, value, idValue) {
    // idValue is optional, defaults to value
    const removeId = idValue || type;
    // Escape value for onclick to prevent syntax errors with quotes
    const safeRemoveId = String(removeId).replace(/'/g, "\\'");

    return `
        <div class="filter-tag">
            <span class="filter-tag-label">${label}:</span>
            <span class="filter-tag-value">${value}</span>
            <span class="filter-tag-close" onclick="removeFilter('${type}', '${safeRemoveId}')">
                <i class="fas fa-times"></i>
            </span>
        </div>
    `;
}

/**
 * Remove a specific filter
 */
window.removeFilter = function (type, id) {
    if (type === 'date') {
        filterState.date = 'all';
        filterState.dateFrom = null;
        filterState.dateTo = null;
        // Reset inputs
        document.getElementById('filterDateFrom').value = '';
        document.getElementById('filterDateTo').value = '';
        updateDropdownUI('date', 'all');
    } else if (type === 'status') {
        filterState.status = 'all';
        updateDropdownUI('status', 'all');
    } else if (type === 'type') {
        filterState.type = 'all';
        updateDropdownUI('type', 'all');
    } else if (type === 'user') {
        filterState.user = ''; // Keep for backward compatibility if needed, though unused
        // document.getElementById('commentSearch').value = ''; // Don't clear input when removing tag? Maybe unnecessary.
        // Actually, logic is: 'user' type removed -> clear input?
        // Wait, 'user' type is legacy. The new type is 'searchTag'. 
        // But let's keep this safe just in case.
        const input = document.getElementById('commentSearch');
        if (input) input.value = ''; false;
    } else if (type === 'searchTag') {
        // Remove specific tag from array
        filterState.searchTags = filterState.searchTags.filter(t => t !== id);
    }

    loadComments(currentCommentView);
};

function updateDropdownUI(filterType, value) {
    const dropdown = document.querySelector(`.filter-dropdown[data-filter="${filterType}"]`);
    if (!dropdown) return;

    // Reset selection classes
    dropdown.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
    const defaultOption = dropdown.querySelector(`.filter-option[data-value="${value}"]`);
    if (defaultOption) defaultOption.classList.add('selected');

    // Reset button text
    const btn = dropdown.querySelector('.filter-btn');
    const label = dropdown.querySelector('.filter-label');
    if (btn) btn.classList.remove('active');
    if (label) label.textContent = getDefaultLabel(filterType);
}


/**
 * Load comments from database
 */
async function loadComments(view) {
    console.log('loadComments called for view:', view);
    // Render active filters
    renderFilterTags();

    if (commentsLoading) {
        console.warn('Comments already loading, skipping...');
        return;
    }
    commentsLoading = true;

    const listContainer = document.getElementById('adminCommentList');
    if (!listContainer) {
        console.error('adminCommentList container not found!');
        commentsLoading = false;
        return;
    }

    listContainer.innerHTML = '<p class="loading-text">加载中...</p>';

    try {
        const client = getSupabase();
        if (!client) {
            throw new Error('Supabase client not initialized');
        }

        const searchQuery = document.getElementById('commentSearch')?.value?.trim() || '';
        const dateFrom = document.getElementById('filterDateFrom')?.value || ''; // Fixed ID
        const dateTo = document.getElementById('filterDateTo')?.value || ''; // Fixed ID

        console.log('Fetching comments...', { view, searchQuery, dateFrom, dateTo });

        let data = [];

        if (view === 'guestbook') {
            // Load guestbook messages
            console.log('Loading guestbook messages...');

            let query = client
                .from('guestbook_messages')
                .select(`
                    id,
                    content,
                    user_id,
                    created_at,
                    image_url,
                    like_count,
                    profiles:user_id (username, avatar_url, email)
                `)
                .order('created_at', { ascending: false })
                .limit(50);

            // Apply admin site filter
            if (window.AdminSiteFilter) query = AdminSiteFilter.applySiteFilter(query);

            // Time filtering
            if (dateFrom) {
                query = query.gte('created_at', dateFrom);
            }
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                query = query.lt('created_at', endDate.toISOString());
            }

            const { data: messages, error } = await query;

            if (error) {
                console.error('Error fetching guestbook messages:', error);
                throw error;
            }

            console.log('Guestbook messages fetched:', messages?.length);

            data = (messages || []).map(msg => ({
                id: msg.id,
                type: 'guestbook',
                content: msg.content || '',
                author: msg.profiles?.username || '未知用户',
                email: msg.profiles?.email || '',
                avatar: msg.profiles?.avatar_url || null,
                created_at: msg.created_at,
                context: '',
                prompt_title: '',
                likes: msg.like_count || 0,
                user_id: msg.user_id,
                parent_id: null,
                image_url: msg.image_url || null
            }));

        } else {
            // Load gallery comments
            let query = client
                .from('prompt_comments')
                .select(`
                    *,
                    is_pinned,
                    is_featured,
                    profiles:user_id (username, avatar_url, email),
                    prompts:prompt_id (title),
                    comment_likes (count)
                `)
                .order('created_at', { ascending: false })
                .limit(50);

            // Apply admin site filter
            if (window.AdminSiteFilter) query = AdminSiteFilter.applySiteFilter(query);


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
            if (error) {
                console.error('Error fetching gallery comments:', error);
                throw error;
            }

            console.log('Gallery comments fetched:', comments?.length);
            console.log('Admin: Fetched Comments:', comments.length, 'First is_pinned:', comments[0]?.is_pinned, 'is_featured:', comments[0]?.is_featured);

            data = (comments || []).map(comment => ({
                id: comment.id,
                type: 'gallery',
                content: comment.content,
                author: comment.profiles?.username || '未知用户',
                email: comment.profiles?.email || '',
                avatar: comment.profiles?.avatar_url,
                created_at: comment.created_at,
                context: comment.prompt_id,
                prompt_title: comment.prompts?.title || 'Unknown',
                likes: comment.comment_likes ? (comment.comment_likes[0]?.count || 0) : 0,
                user_id: comment.user_id,
                parent_id: comment.parent_id,
                image_url: comment.image_url || null,
                is_pinned: comment.is_pinned || false,
                is_featured: comment.is_featured || false
            }));
        }

        commentsData = data;
        // Apply filters before rendering
        filteredComments = applyFilters(data);
        renderCommentList(filteredComments);

    } catch (error) {
        console.error('Error loading comments:', error);
        listContainer.innerHTML = `<p class="error-text">加载失败: ${error.message || '未知错误'}</p>`;
    } finally {
        commentsLoading = false;
        console.log('Comments loading finished.');
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
                    <div class="action-info-wrapper">
                         <button class="action-info" onclick="event.stopPropagation(); copyCommentId('${comment.id}', '${comment.parent_id}')" title="复制 ID">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </div>
                    
                    ${comment.type === 'gallery' && window.hasPermission && window.hasPermission('content.moderate') ? `
                    <button class="action-btn ${comment.is_pinned ? 'active' : ''}" 
                        onclick="event.stopPropagation(); togglePin('${comment.id}', ${comment.is_pinned}, '${comment.context}')" 
                        title="${comment.is_pinned ? '取消置顶' : '置顶评论'}">
                        <i class="fas fa-thumbtack" style="${comment.is_pinned ? 'color: #9b5de5;' : ''}"></i>
                    </button>
                    ` : ''}

                    ${window.hasPermission && window.hasPermission('users.manage') ? `
                    <div class="action-block-wrapper" style="position: relative;">
                        <button class="action-btn action-block" onclick="event.stopPropagation(); toggleBlockDropdown('${comment.user_id}', this)" title="用户管理">
                            <i class="fas fa-ban"></i>
                        </button>
                    </div>
                    ` : ''}

                    ${comment.context ?
                `<button class="action-view" onclick="event.stopPropagation(); viewCommentContext('${comment.context}', '${comment.id}')" title="查看上下文">
                        <i class="fas fa-external-link-alt"></i>
                    </button>` : ''}
                    
                    ${window.hasPermission && window.hasPermission('content.moderate') ? `
                    <button class="action-delete" onclick="event.stopPropagation(); deleteComment('${comment.id}', '${comment.type}')" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
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

    // Update Export text options
    const exportCsvBtn = document.querySelector('.export-popup .filter-option:nth-child(1)');
    const exportJsonBtn = document.querySelector('.export-popup .filter-option:nth-child(2)');

    const contextText = count > 0 ? `(选中 ${count} 项)` : `(当前筛选)`;

    if (exportCsvBtn) exportCsvBtn.innerHTML = `<i class="fas fa-file-csv"></i> 导出 CSV ${contextText}`;
    if (exportJsonBtn) exportJsonBtn.innerHTML = `<i class="fas fa-file-code"></i> 导出 JSON ${contextText}`;

    if (countEl) countEl.textContent = `已选 ${count} 条`;
    if (deleteBtn) deleteBtn.disabled = count === 0;
}

/**
 * Export data function
 * format: 'csv' | 'json'
 */
function exportData(format) {
    const checked = document.querySelectorAll('.comment-checkbox:checked');
    let sourceData = [];

    // 1. Determine Data Source
    if (checked.length > 0) {
        // Export selected items from current filtered list
        const selectedIds = Array.from(checked).map(cb => cb.dataset.id);
        sourceData = filteredComments.filter(c => selectedIds.includes(c.id));
    } else {
        // Export all filtered items
        sourceData = filteredComments;
    }

    if (sourceData.length === 0) {
        alert('无数据可导出');
        return;
    }

    // 2. Generate Content
    let content = '';
    let mimeType = '';
    let extension = '';
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
        // CSV Generation with BOM for Excel
        content = generateCSV(sourceData);
        mimeType = 'text/csv;charset=utf-8;';
        extension = 'csv';
    } else {
        // JSON Generation
        content = JSON.stringify(sourceData, null, 2);
        mimeType = 'application/json';
        extension = 'json';
    }

    // 3. Trigger Download
    const blob = new Blob([format === 'csv' ? '\ufeff' + content : content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `comments_export_${timestamp}.${extension}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Helper: Generate CSV string from comments
 */
function generateCSV(data) {
    // Define columns
    const columns = [
        { header: 'ID', key: 'id' },
        { header: 'Author', key: 'author' },
        { header: 'Email', key: 'email' },
        { header: 'Content', key: 'content' },
        { header: 'Date', key: 'created_at' },
        { header: 'Type', key: 'type' },
        { header: 'Likes', key: 'likes' },
        { header: 'Prompt Title', key: 'prompt_title' },
        { header: 'Prompt ID', key: 'context' },
        { header: 'Parent ID', key: 'parent_id' }
    ];

    // Create Header Row
    const headerRow = columns.map(col => `"${col.header}"`).join(',');

    // Create Data Rows
    const dataRows = data.map(item => {
        return columns.map(col => {
            let val = item[col.key] || '';

            // Format specific fields
            if (col.key === 'content') {
                // Escape quotes and handle newlines for CSV
                val = val.replace(/"/g, '""'); // Double quotes
                val = val.replace(/\n/g, ' '); // Replace newlines with space
            }
            if (col.key === 'created_at') {
                val = new Date(val).toLocaleString('zh-CN');
            }

            return `"${val}"`;
        }).join(',');
    });

    return [headerRow, ...dataRows].join('\n');
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


/**
 * Copy Comment ID to clipboard
 */
window.copyCommentId = function (id, parentId) {
    if (!id) return;

    // Copy ID (just the ID)
    navigator.clipboard.writeText(id).then(() => {
        // Show simplified toast
        showToast ? showToast(`已复制 ID`, 'info') : alert('ID Copied: ' + id);
    }).catch(err => {
        console.error('Failed to copy ID:', err);
    });
};

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
window.copyCommentId = window.copyCommentId;

/**
 * Toggle Pin Status (Single pin per card)
 */
window.togglePin = async function (id, currentStatus, promptId) {
    console.log('togglePin called:', id, 'current:', currentStatus, 'prompt:', promptId);
    try {
        // If pinning (not unpinning), first unpin any existing pinned comment for this prompt
        if (!currentStatus && promptId) {
            const { error: unpinError } = await getSupabase()
                .from('prompt_comments')
                .update({ is_pinned: false })
                .eq('prompt_id', promptId)
                .eq('is_pinned', true);

            if (unpinError) console.warn('Failed to unpin existing:', unpinError);
        }

        // Now pin/unpin the target comment
        const { data, error } = await getSupabase()
            .from('prompt_comments')
            .update({ is_pinned: !currentStatus })
            .eq('id', id)
            .select();

        console.log('togglePin result:', { data, error });

        if (error) throw error;

        showToast(currentStatus ? '已取消置顶' : '评论已置顶', 'success');
        loadComments(currentCommentView); // Refresh list
    } catch (err) {
        console.error('Error toggling pin:', err);
        showToast('操作失败', 'error');
    }
};

// --- User Blocking Functions ---

let activeBlockDropdown = null;


window.toggleBlockDropdown = function (userId, btnElement) {
    // Close existing if specific button clicked again or just close any open one
    if (activeBlockDropdown) {
        const isSame = activeBlockDropdown.dataset.triggerId === userId;
        activeBlockDropdown.remove();
        activeBlockDropdown = null;
        if (isSame) return; // Toggle off behavior
    }

    // Default to empty/false for immediate render
    let blockedScopes = [];
    let isGuestbookBlocked = false;
    let isGalleryBlocked = false;

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'block-dropdown-menu';
    dropdown.dataset.triggerId = userId;

    let html = `<div class="block-menu-header">封禁管理</div>`;

    // Guestbook Actions
    if (isGuestbookBlocked) {
        html += `<button class="block-menu-btn" onclick="unblockUser('${userId}', 'guestbook')">🚫 解封留言板</button>`;
    } else {
        html += `<button class="block-menu-btn" onclick="blockUser('${userId}', 'guestbook', null)">永久封禁留言板</button>`;
    }

    // Gallery Actions
    if (isGalleryBlocked) {
        html += `<button class="block-menu-btn" onclick="unblockUser('${userId}', 'gallery')">🚫 解封画廊</button>`;
    } else {
        html += `<button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', null)">永久封禁画廊</button>`;
        html += `
            <div class="block-menu-divider"></div>
            <div class="block-menu-header">临时封禁 (画廊)</div>
            <button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', 3)">封禁 3 天</button>
            <button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', 7)">封禁 7 天</button>
            <button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', 30)">封禁 30 天</button>
        `;
    }

    html += `
        <div class="block-menu-divider"></div>
        <button class="block-menu-btn" onclick="checkUserStatus('${userId}')">查看状态详情</button>
    `;

    dropdown.innerHTML = html;

    // Helper to attach listeners (relying on CSS classes for styles)
    const attachListeners = () => {
        const buttons = dropdown.querySelectorAll('button');
        buttons.forEach(btn => {
            const originalClick = btn.getAttribute('onclick');
            if (originalClick) {
                btn.removeAttribute('onclick');
                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (originalClick.includes('unblockUser')) {
                        const args = originalClick.match(/'([^']*)'/g).map(s => s.replace(/'/g, ''));
                        window.unblockUser(args[0], args[1]);
                    } else if (originalClick.includes('checkUserStatus')) {
                        const args = originalClick.match(/'([^']*)'/g).map(s => s.replace(/'/g, ''));
                        window.checkUserStatus(args[0]);
                    } else {
                        const parts = originalClick.split('(')[1].split(')')[0].split(',');
                        const uid = parts[0].trim().replace(/'/g, '');
                        const scope = parts[1].trim().replace(/'/g, '');
                        const days = parts[2].trim() === 'null' ? null : parseInt(parts[2].trim());
                        window.blockUser(uid, scope, days);
                    }
                    dropdown.remove();
                    activeBlockDropdown = null;
                };
            }
        });
    };

    attachListeners();

    btnElement.parentNode.appendChild(dropdown);
    activeBlockDropdown = dropdown;

    // Robust Close Handler
    const closeHandler = (e) => {
        // If clicking inside dropdown, do nothing (handled by buttons)
        if (dropdown.contains(e.target)) return;

        // If clicking the button that opened it, do nothing (toggle logic handles it)
        if (btnElement.contains(e.target)) return;

        // Otherwise close
        dropdown.remove();
        activeBlockDropdown = null;
        document.removeEventListener('click', closeHandler);
        // Also remove mouseleave listener if we added one
    };

    // Add close listener with delay to avoid immediate trigger
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // Auto-close on mouse leave (requested "retract automatic")
    dropdown.onmouseleave = () => {
        // Create a grace period allowing moving to sibling elements? 
        // For now user said "won't automatically retract", implying they WANT it to retract.
        // Let's add a timeout to close on mouseleave
        dropdown._closeTimer = setTimeout(() => {
            dropdown.remove();
            activeBlockDropdown = null;
            document.removeEventListener('click', closeHandler);
        }, 500);
    };
    dropdown.onmouseenter = () => {
        clearTimeout(dropdown._closeTimer);
    };

    // -- Async Status Update --
    // Check status in background and update UI if user is blocked
    getSupabase()
        .from('blocked_users')
        .select('scope')
        .eq('user_id', userId)
        .then(({ data }) => {
            if (activeBlockDropdown === dropdown && data && data.length > 0) {
                const updatedScopes = data.map(d => d.scope);
                const isGuestbookBlocked = updatedScopes.includes('guestbook') || updatedScopes.includes('all');
                const isGalleryBlocked = updatedScopes.includes('gallery') || updatedScopes.includes('all');

                if (isGuestbookBlocked || isGalleryBlocked) {
                    // Re-render content
                    let newHtml = `<div class="block-menu-header">封禁管理</div>`;

                    if (isGuestbookBlocked) {
                        newHtml += `<button class="block-menu-btn" onclick="unblockUser('${userId}', 'guestbook')">🚫 解封留言板</button>`;
                    } else {
                        newHtml += `<button class="block-menu-btn" onclick="blockUser('${userId}', 'guestbook', null)">永久封禁留言板</button>`;
                    }

                    if (isGalleryBlocked) {
                        newHtml += `<button class="block-menu-btn" onclick="unblockUser('${userId}', 'gallery')">🚫 解封画廊</button>`;
                    } else {
                        newHtml += `<button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', null)">永久封禁画廊</button>`;
                        newHtml += `
                            <div class="block-menu-divider"></div>
                            <div class="block-menu-header">临时封禁 (画廊)</div>
                            <button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', 3)">封禁 3 天</button>
                            <button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', 7)">封禁 7 天</button>
                            <button class="block-menu-btn" onclick="blockUser('${userId}', 'gallery', 30)">封禁 30 天</button>
                        `;
                    }

                    newHtml += `
                        <div class="block-menu-divider"></div>
                        <button class="block-menu-btn" onclick="checkUserStatus('${userId}')">查看状态详情</button>
                    `;

                    dropdown.innerHTML = newHtml;
                    attachListeners();
                }
            }
        })
        .catch(console.error);
};

window.blockUser = async function (userId, scope, days) {
    const durationStr = days ? `${days}天` : '永久';
    const scopeStr = scope === 'guestbook' ? '留言板' : '画廊';

    if (!confirm(`确定要 [${durationStr}] 封禁该用户在 [${scopeStr}] 的权限吗？`)) return;

    try {
        const payload = {
            user_id: userId,
            scope: scope,
            blocked_by: (await getSupabase().auth.getUser()).data.user.id,
            blocked_at: new Date().toISOString()
        };

        if (days) {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + days);
            payload.expires_at = expiresAt.toISOString();
        } else {
            payload.expires_at = null; // Permanent
        }

        const { error } = await getSupabase()
            .from('blocked_users')
            .upsert(payload, { onConflict: 'user_id, scope' });

        if (error) throw error;
        showToast(`已${durationStr}封禁用户 ${scopeStr} 权限`, 'success');
    } catch (err) {
        console.error('Block user error:', err);
        showToast('操作失败: ' + err.message, 'error');
    }
};

window.checkUserStatus = async function (userId) {
    try {
        const { data, error } = await getSupabase()
            .from('blocked_users')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;

        if (!data || data.length === 0) {
            alert('该用户未被封禁');
        } else {
            const scopes = data.map(d => d.scope).join(', ');
            alert(`用户当前封禁状态：\n权限范围: ${scopes}\n封禁时间: ${new Date(data[0].blocked_at).toLocaleString()}`);
        }
    } catch (err) {
        console.error('Check status error:', err);
        showToast('查询失败', 'error');
    }
};

window.unblockUser = async function (userId, scope) {
    if (!confirm(`确定要解除该用户在 [${scope === 'guestbook' ? '留言板' : '画廊'}] 的封禁吗？`)) return;

    try {
        const { error } = await getSupabase()
            .from('blocked_users')
            .delete()
            .eq('user_id', userId)
            .eq('scope', scope);

        if (error) throw error;
        showToast(`已解封用户 ${scope === 'guestbook' ? '留言板' : '画廊'} 权限`, 'success');
    } catch (err) {
        console.error('Unblock user error:', err);
        showToast('操作失败: ' + err.message, 'error');
    }
};

