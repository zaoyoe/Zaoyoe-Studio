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

function getCommentsReadSite() {
    return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
}

function requireWritableCommentsSite(options = {}) {
    return window.AdminSiteFilter?.requireWritableSite?.(options) || null;
}

function buildAdminCommentsUrl(route, params = {}) {
    const url = new URL(`/api/admin/${route}`, window.location.origin);

    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        url.searchParams.set(key, String(value));
    });

    return `${url.pathname}${url.search}`;
}

async function parseAdminCommentsResponse(response) {
    let payload = {};

    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }

    if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || `Comments request failed (${response.status})`);
    }

    return payload;
}

async function fetchAdminCommentSummary(site = getCommentsReadSite()) {
    const response = await fetch(buildAdminCommentsUrl('comments/summary', { site }), {
        credentials: 'include'
    });

    return parseAdminCommentsResponse(response);
}

async function fetchAdminCommentsList({ view, site = getCommentsReadSite(), dateFrom = '', dateTo = '' } = {}) {
    const response = await fetch(buildAdminCommentsUrl('comments/list', {
        view,
        site,
        dateFrom,
        dateTo
    }), {
        credentials: 'include'
    });

    return parseAdminCommentsResponse(response);
}

async function moderateCommentsViaAdminApi({ items = [], site, action = 'delete_many' } = {}) {
    const response = await fetch('/api/admin/comments/moderate', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action,
            site,
            items
        })
    });

    return parseAdminCommentsResponse(response);
}

async function fetchAdminCommentBlockState(userId, site = getCommentsReadSite()) {
    const response = await fetch(buildAdminCommentsUrl('comments/blocks', {
        userId,
        site
    }), {
        credentials: 'include'
    });

    return parseAdminCommentsResponse(response);
}

async function mutateAdminCommentBlockState({ action, userId, scope, days = null, site } = {}) {
    const response = await fetch('/api/admin/comments/blocks', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action,
            userId,
            scope,
            days,
            site
        })
    });

    return parseAdminCommentsResponse(response);
}

async function toggleCommentPinViaAdminApi({ id, promptId, currentStatus, site } = {}) {
    const response = await fetch('/api/admin/comments/moderate', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action: 'toggle_pin',
            site,
            id,
            promptId,
            currentStatus
        })
    });

    return parseAdminCommentsResponse(response);
}

function buildCommentLoadingSkeleton(count = 6) {
    const itemCount = Math.max(3, Number.parseInt(count, 10) || 6);
    return Array.from({ length: itemCount }, (_, index) => `
        <div class="comment-admin-item comment-admin-item--skeleton" aria-hidden="true" data-skeleton-index="${index}">
            <div class="item-checkbox-wrapper">
                <span class="admin-skeleton-block admin-skeleton-block--checkbox"></span>
            </div>
            <div class="item-header">
                <span class="admin-skeleton-block admin-skeleton-block--avatar"></span>
                <div class="item-meta">
                    <span class="admin-skeleton-block admin-skeleton-block--title" style="width:${44 + (index % 3) * 12}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${26 + (index % 3) * 8}%"></span>
                </div>
            </div>
            <div class="item-content">
                <span class="admin-skeleton-block admin-skeleton-block--line" style="width:100%"></span>
                <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${76 - (index % 2) * 12}%"></span>
                <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${58 + (index % 3) * 10}%"></span>
            </div>
            <div class="item-actions">
                <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                <span class="admin-skeleton-block admin-skeleton-block--action"></span>
            </div>
        </div>
    `).join('');
}

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
    window.currentCommentView = currentCommentView;

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

function getCommentReplyCount(comment) {
    return Math.max(0, Number(comment?.reply_count || 0));
}

function isReplyLevelComment(comment) {
    return String(comment?.level || '').trim() === 'reply';
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

        // Status filter
        const replyCount = getCommentReplyCount(comment);
        if (filterState.status === 'replied' && replyCount <= 0) return false;
        if (filterState.status === 'unreplied' && replyCount > 0) return false;

        // Type filter
        if (filterState.type === 'top' && isReplyLevelComment(comment)) return false;
        if (filterState.type === 'reply' && !isReplyLevelComment(comment)) return false;

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
        const payload = await fetchAdminCommentSummary(getCommentsReadSite());
        const totalCount = Number(payload?.summary?.totalCount || 0);
        const todayCount = Number(payload?.summary?.todayCount || 0);
        const activeUsersCount = Number(payload?.summary?.activeUsersCount || 0);
        const weekGrowth = Number(payload?.summary?.weekGrowth || 0);

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
    window.currentCommentView = view;

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

    return `
        <div class="filter-tag">
            <span class="filter-tag-label">${label}:</span>
            <span class="filter-tag-value">${value}</span>
            <span class="filter-tag-close" data-comments-action="remove-filter" data-filter-type="${escapeHtml(type)}" data-filter-id="${encodeURIComponent(String(removeId))}">
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

    listContainer.innerHTML = buildCommentLoadingSkeleton();

    try {
        const dateFrom = document.getElementById('filterDateFrom')?.value || ''; // Fixed ID
        const dateTo = document.getElementById('filterDateTo')?.value || ''; // Fixed ID

        console.log('Fetching comments...', { view, dateFrom, dateTo, site: getCommentsReadSite() });
        const payload = await fetchAdminCommentsList({
            view,
            site: getCommentsReadSite(),
            dateFrom,
            dateTo
        });
        const data = Array.isArray(payload?.comments) ? payload.comments : [];

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
        const avatarMarkup = comment.avatar
            ? `<img class="item-avatar-image" src="${escapeHtml(comment.avatar)}" alt="" loading="lazy" decoding="async">`
            : avatarInitial;
        const timeStr = formatTimeAgo(comment.created_at);
        // Reply badge - shown for guestbook replies and nested gallery replies
        const isReply = isReplyLevelComment(comment);
        const replyBadge = isReply ? `<span class="reply-badge">Reply</span>` : '';

        // Context Pill for List (inline) or Grid (in content)
        // We put it in content for Grid, and List view will handle flow via CSS

        return `
            <div class="comment-admin-item" data-id="${comment.id}" data-type="${comment.type}" data-record-type="${comment.record_type || ''}" data-comments-action="toggle-selection" data-checkbox-id="cb-${comment.id}">
                
                <!-- 1. Checkbox Wrapper -->
                <div class="item-checkbox-wrapper">
                    <input type="checkbox" class="comment-checkbox" id="cb-${comment.id}" 
                        data-id="${comment.id}" data-type="${comment.type}" data-record-type="${comment.record_type || ''}"
                        data-comments-change="selection">
                </div>

                <!-- 2. Header: Avatar + Meta (Name, Time) -->
                <div class="item-header">
                    <div class="item-avatar${comment.avatar ? ' item-avatar--image' : ''}">
                        ${avatarMarkup}
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
                         <button class="action-info" type="button" data-comments-action="copy-comment-id" data-comment-id="${encodeURIComponent(comment.id)}" data-parent-id="${encodeURIComponent(comment.parent_id || '')}" title="复制 ID">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </div>
                    
                    ${comment.type === 'gallery' && window.hasPermission && window.hasPermission('content.moderate') ? `
                    <button class="action-btn ${comment.is_pinned ? 'active' : ''}" 
                        type="button"
                        data-comments-action="toggle-pin"
                        data-comment-id="${encodeURIComponent(comment.id)}"
                        data-comment-pinned="${comment.is_pinned ? '1' : '0'}"
                        data-prompt-id="${encodeURIComponent(comment.context || '')}"
                        title="${comment.is_pinned ? '取消置顶' : '置顶评论'}">
                        <i class="fas fa-thumbtack${comment.is_pinned ? ' comment-pin-icon--active' : ''}"></i>
                    </button>
                    ` : ''}

                    ${window.hasPermission && window.hasPermission('users.manage') ? `
                    <div class="action-block-wrapper">
                        <button class="action-btn action-block" type="button" data-comments-action="toggle-block-dropdown" data-user-id="${encodeURIComponent(comment.user_id || '')}" title="用户管理">
                            <i class="fas fa-ban"></i>
                        </button>
                    </div>
                    ` : ''}

                    ${comment.context ?
                `<button class="action-view" type="button" data-comments-action="view-comment-context" data-prompt-id="${encodeURIComponent(comment.context)}" data-comment-id="${encodeURIComponent(comment.id)}" title="查看上下文">
                        <i class="fas fa-external-link-alt"></i>
                    </button>` : ''}
                    
                    ${window.hasPermission && window.hasPermission('content.moderate') ? `
                    <button class="action-delete" type="button" data-comments-action="delete-comment" data-comment-id="${encodeURIComponent(comment.id)}" data-comment-type="${encodeURIComponent(comment.type)}" data-comment-record-type="${encodeURIComponent(comment.record_type || '')}" title="删除">
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

    const writableSite = requireWritableCommentsSite({ action: 'comments-batch-delete' });
    if (!writableSite) {
        return;
    }

    if (!confirm(`确定要删除选中的 ${checked.length} 条评论吗？此操作无法撤销。`)) return;

    const items = Array.from(checked).map(cb => ({
        id: cb.dataset.id,
        type: cb.dataset.type,
        recordType: cb.dataset.recordType || ''
    }));

    try {
        const payload = await moderateCommentsViaAdminApi({
            items,
            site: writableSite,
            action: 'delete_many'
        });
        const deleted = Number(payload?.deletedCount || 0);
        showToast(`成功删除 ${deleted} 条评论`, 'success');
        loadCommentStats();
        loadComments(currentCommentView);
    } catch (error) {
        console.error('Batch delete error:', error);
        showToast('批量删除失败: ' + error.message, 'error');
    }
}

/**
 * Delete a comment
 */
async function deleteComment(id, type, recordType = '') {
    const writableSite = requireWritableCommentsSite({
        label: recordType === 'message' ? '删除留言主贴' : '删除评论'
    });
    if (!writableSite) {
        return;
    }

    if (!confirm('确定要删除这条评论吗？此操作无法撤销。')) return;

    try {
        await moderateCommentsViaAdminApi({
            site: writableSite,
            action: 'delete',
            items: [{
                id,
                type,
                recordType
            }]
        });

        // Remove from UI
        const item = document.querySelector(`.comment-admin-item[data-id="${id}"]`);
        if (item) {
            item.classList.add('comment-admin-item--removing');
            setTimeout(() => item.remove(), 200);
        }

        // Refresh stats
        loadCommentStats();
        loadComments(currentCommentView);
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
    const initCommentsLayout = () => switchLayoutView(currentViewLayout);
    if (window.adminStudioAccessGranted) {
        initCommentsLayout();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initCommentsLayout, { once: true });
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

function bindAdminCommentsRuntimeDelegates() {
    if (document.documentElement.dataset.adminCommentsRuntimeDelegatesBound === '1') {
        return;
    }

    document.documentElement.dataset.adminCommentsRuntimeDelegatesBound = '1';

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-comments-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.commentsAction) {
            case 'remove-filter':
                window.removeFilter?.(
                    actionEl.dataset.filterType || '',
                    decodeURIComponent(actionEl.dataset.filterId || '')
                );
                break;
            case 'toggle-selection':
                toggleCommentSelection(event, actionEl.dataset.checkboxId || '');
                break;
            case 'copy-comment-id':
                event.stopPropagation();
                window.copyCommentId?.(
                    decodeURIComponent(actionEl.dataset.commentId || ''),
                    decodeURIComponent(actionEl.dataset.parentId || '')
                );
                break;
            case 'toggle-pin':
                event.stopPropagation();
                window.togglePin?.(
                    decodeURIComponent(actionEl.dataset.commentId || ''),
                    actionEl.dataset.commentPinned === '1',
                    decodeURIComponent(actionEl.dataset.promptId || '')
                );
                break;
            case 'toggle-block-dropdown':
                event.stopPropagation();
                window.toggleBlockDropdown?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl
                );
                break;
            case 'view-comment-context':
                event.stopPropagation();
                window.viewCommentContext?.(
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    decodeURIComponent(actionEl.dataset.commentId || '')
                );
                break;
            case 'delete-comment':
                event.stopPropagation();
                window.deleteComment?.(
                    decodeURIComponent(actionEl.dataset.commentId || ''),
                    decodeURIComponent(actionEl.dataset.commentType || ''),
                    decodeURIComponent(actionEl.dataset.commentRecordType || '')
                );
                break;
            case 'block-user': {
                event.stopPropagation();
                const rawDays = actionEl.dataset.blockDays;
                const days = rawDays === 'permanent' ? null : Number(rawDays || 0);
                window.blockUser?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl.dataset.userScope || '',
                    Number.isFinite(days) ? days : null
                );
                activeBlockDropdown?.remove();
                activeBlockDropdown = null;
                break;
            }
            case 'unblock-user':
                event.stopPropagation();
                window.unblockUser?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl.dataset.userScope || ''
                );
                activeBlockDropdown?.remove();
                activeBlockDropdown = null;
                break;
            case 'check-user-status':
                event.stopPropagation();
                window.checkUserStatus?.(decodeURIComponent(actionEl.dataset.userId || ''));
                activeBlockDropdown?.remove();
                activeBlockDropdown = null;
                break;
        }
    });

    document.addEventListener('change', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-comments-change]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.commentsChange) {
            case 'selection':
                updateSelection();
                break;
        }
    });
}

bindAdminCommentsRuntimeDelegates();

/**
 * Toggle Pin Status (Single pin per card)
 */
window.togglePin = async function (id, currentStatus, promptId) {
    console.log('togglePin called:', id, 'current:', currentStatus, 'prompt:', promptId);
    try {
        const writableSite = requireWritableCommentsSite({ label: currentStatus ? '取消评论置顶' : '置顶评论' });
        if (!writableSite) {
            return;
        }

        const payload = await toggleCommentPinViaAdminApi({
            id,
            promptId,
            currentStatus,
            site: writableSite
        });

        console.log('togglePin result:', payload);

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
    let hasGlobalBlock = false;

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'block-dropdown-menu';
    dropdown.dataset.triggerId = userId;
    dropdown.innerHTML = renderBlockDropdownMenu(userId, {
        isGuestbookBlocked,
        isGalleryBlocked,
        hasGlobalBlock
    });

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
    fetchAdminCommentBlockState(userId)
        .then((payload) => {
            if (activeBlockDropdown !== dropdown) {
                return;
            }

            blockedScopes = Array.isArray(payload?.scopes) ? payload.scopes : [];
            isGuestbookBlocked = payload?.isGuestbookBlocked === true;
            isGalleryBlocked = payload?.isGalleryBlocked === true;
            hasGlobalBlock = payload?.hasGlobalBlock === true;

            dropdown.innerHTML = renderBlockDropdownMenu(userId, {
                isGuestbookBlocked,
                isGalleryBlocked,
                hasGlobalBlock
            });
        })
        .catch(console.error);
};

function renderBlockDropdownMenu(userId, { isGuestbookBlocked = false, isGalleryBlocked = false, hasGlobalBlock = false } = {}) {
    const encodedUserId = encodeURIComponent(userId || '');
    let html = `
        <div class="block-menu-header">封禁管理</div>
        <div class="block-menu-note">当前封禁按 scope 全站生效，不区分 CN / EN 站点。</div>
    `;

    if (hasGlobalBlock) {
        html += `
            <div class="block-menu-divider"></div>
            <button class="block-menu-btn" type="button" data-comments-action="unblock-user" data-user-id="${encodedUserId}" data-user-scope="all">🚫 解封全站</button>
        `;
        html += `
            <div class="block-menu-divider"></div>
            <button class="block-menu-btn" type="button" data-comments-action="check-user-status" data-user-id="${encodedUserId}">查看状态详情</button>
        `;
        return html;
    }

    if (isGuestbookBlocked) {
        html += `<button class="block-menu-btn" type="button" data-comments-action="unblock-user" data-user-id="${encodedUserId}" data-user-scope="guestbook">🚫 解封留言板</button>`;
    } else {
        html += `<button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="guestbook" data-block-days="permanent">永久封禁留言板</button>`;
    }

    if (isGalleryBlocked) {
        html += `<button class="block-menu-btn" type="button" data-comments-action="unblock-user" data-user-id="${encodedUserId}" data-user-scope="gallery">🚫 解封画廊</button>`;
    } else {
        html += `<button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="permanent">永久封禁画廊</button>`;
        html += `
            <div class="block-menu-divider"></div>
            <div class="block-menu-header">临时封禁 (画廊)</div>
            <button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="3">封禁 3 天</button>
            <button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="7">封禁 7 天</button>
            <button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="30">封禁 30 天</button>
        `;
    }

    html += `
        <div class="block-menu-divider"></div>
        <button class="block-menu-btn" type="button" data-comments-action="check-user-status" data-user-id="${encodedUserId}">查看状态详情</button>
    `;

    return html;
}

window.blockUser = async function (userId, scope, days) {
    const durationStr = days ? `${days}天` : '永久';
    const scopeStr = scope === 'guestbook' ? '留言板' : (scope === 'all' ? '全站' : '画廊');

    if (!confirm(`确定要 [${durationStr}] 封禁该用户在 [${scopeStr}] 的权限吗？`)) return;

    try {
        const writableSite = requireWritableCommentsSite({ label: `${scopeStr}用户封禁` });
        if (!writableSite) {
            return;
        }

        const payload = await mutateAdminCommentBlockState({
            action: 'block',
            userId,
            scope,
            days,
            site: writableSite
        });

        if (activeBlockDropdown && activeBlockDropdown.dataset.triggerId === userId) {
            activeBlockDropdown.innerHTML = renderBlockDropdownMenu(userId, {
                isGuestbookBlocked: payload?.isGuestbookBlocked === true,
                isGalleryBlocked: payload?.isGalleryBlocked === true,
                hasGlobalBlock: payload?.hasGlobalBlock === true
            });
        }

        showToast(`已${durationStr}封禁用户 ${scopeStr} 权限（全站生效）`, 'success');
    } catch (err) {
        console.error('Block user error:', err);
        showToast('操作失败: ' + err.message, 'error');
    }
};

window.checkUserStatus = async function (userId) {
    try {
        const payload = await fetchAdminCommentBlockState(userId);
        const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];

        if (!blocks.length) {
            alert('该用户未被封禁');
        } else {
            const lines = blocks.map((block) => {
                const scopeLabel = block.scope === 'all'
                    ? '全部（留言板 / 画廊全站生效）'
                    : (block.scope === 'guestbook' ? '留言板（全站生效）' : '画廊（全站生效）');
                const expiryLabel = block.expires_at
                    ? `${new Date(block.expires_at).toLocaleDateString()} 到期`
                    : '永久';
                return `- [${scopeLabel}] ${expiryLabel}${block.reason ? `\n  原因: ${block.reason}` : ''}`;
            });
            alert(`用户当前封禁状态：\n\n${lines.join('\n\n')}`);
        }
    } catch (err) {
        console.error('Check status error:', err);
        showToast('查询失败', 'error');
    }
};

window.unblockUser = async function (userId, scope) {
    const scopeLabel = scope === 'guestbook'
        ? '留言板'
        : (scope === 'all' ? '全站' : '画廊');

    if (!confirm(`确定要解除该用户在 [${scopeLabel}] 的封禁吗？`)) return;

    try {
        const writableSite = requireWritableCommentsSite({ label: `${scopeLabel}用户解封` });
        if (!writableSite) {
            return;
        }

        const payload = await mutateAdminCommentBlockState({
            action: 'unblock',
            userId,
            scope,
            site: writableSite
        });

        if (activeBlockDropdown && activeBlockDropdown.dataset.triggerId === userId) {
            activeBlockDropdown.innerHTML = renderBlockDropdownMenu(userId, {
                isGuestbookBlocked: payload?.isGuestbookBlocked === true,
                isGalleryBlocked: payload?.isGalleryBlocked === true,
                hasGlobalBlock: payload?.hasGlobalBlock === true
            });
        }

        showToast(`已解封用户 ${scopeLabel} 权限`, 'success');
    } catch (err) {
        console.error('Unblock user error:', err);
        showToast('操作失败: ' + err.message, 'error');
    }
};
