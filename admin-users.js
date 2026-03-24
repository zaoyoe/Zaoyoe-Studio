// ========================================
// ADMIN USERS MODULE
// Handles User Directory, Drawers, and Basic Actions
// ========================================

// Module State
const userState = {
    users: [],
    filteredUsers: [], // For filtered results
    currentPage: 1,
    itemsPerPage: 10,
    selectedUsers: new Set(), // For batch operations (persists across pages)
    selectMode: false, // Selection mode toggle (like Gallery Manage)
    filters: {
        status: 'all', // all, active, banned
        level: 'all',  // all, vip
        role: 'all',   // all, admin, user
        search: '',
        showTestAccounts: false
    }
};

// Prompt Cache for History Display
let promptCache = {};
let promptCacheLoaded = false;

async function fetchPromptCache() {
    if (promptCacheLoaded) return;
    try {
        const { data, error } = await window.supabaseClient
            .from('prompts')
            .select('id, title');

        if (error) throw error;

        if (data) {
            data.forEach(p => {
                promptCache[p.id] = p.title;
            });
            promptCacheLoaded = true;
            console.log('📚 Ledger Prompt Cache Loaded:', Object.keys(promptCache).length);
        }
    } catch (e) {
        console.error('Failed to load prompt cache for ledger:', e);
    }
}

// Predefined tags with labels and CSS classes (moved to top for initialization order)
const TAG_CONFIG = {
    vip: { label: 'VIP', class: 'tag-vip' },
    creator: { label: '创作者', class: 'tag-creator' },
    risk: { label: '需关注', class: 'tag-risk' },
    spam: { label: '广告号', class: 'tag-spam' },
    '间距': { label: '间距', class: 'tag-spacing' },
    '用户': { label: '用户', class: 'tag-user' }
};

const TEST_ACCOUNT_EMAIL_RE = /@example\.(?:com|org|net)$/i;
const TEST_ACCOUNT_KEYWORD_RE = /\b(?:autodeploy|summaryfix|final\d*|diag|wwwdiag|test|mock|demo|seed|fixture|smoke|sandbox|staging)\b/i;
const SYNTHETIC_ROLE_SEGMENT_RE = /(?:^|[._-])(admin|regular)(?:[._-]|$)/i;
const SYNTHETIC_TIMESTAMP_RE = /(?:^|[._-])\d{8,}$/;
const SYSTEM_USERNAME_RE = /^(?:system|bot|service|worker|cron|automation)(?:[._-]|$)/i;
const PHONE_ONLY_USERNAME_RE = /^\+?\d{8,}$/;
const USERS_HIDDEN_CLASS = 'admin-studio-inline-style-attr-3';

function getTagClass(tag) {
    return TAG_CONFIG[tag]?.class || 'tag-custom';
}

function getTagLabel(tag) {
    return TAG_CONFIG[tag]?.label || tag;
}

function normalizeUserIdentity(value) {
    return String(value || '').trim().toLowerCase();
}

function classifyUserAccount({ email, username }) {
    const normalizedEmail = normalizeUserIdentity(email);
    const normalizedUsername = normalizeUserIdentity(username);
    const emailLocalPart = normalizedEmail.split('@')[0] || '';

    const hasExampleEmail = TEST_ACCOUNT_EMAIL_RE.test(normalizedEmail);
    const hasSyntheticKeyword = TEST_ACCOUNT_KEYWORD_RE.test(`${normalizedUsername} ${emailLocalPart}`);
    const hasSyntheticRoleSegment =
        SYNTHETIC_ROLE_SEGMENT_RE.test(normalizedUsername) ||
        SYNTHETIC_ROLE_SEGMENT_RE.test(emailLocalPart);
    const hasTimestampSuffix =
        SYNTHETIC_TIMESTAMP_RE.test(normalizedUsername) ||
        SYNTHETIC_TIMESTAMP_RE.test(emailLocalPart);
    const missingEmailWithSystemName = !normalizedEmail && SYSTEM_USERNAME_RE.test(normalizedUsername);
    const phoneOnlyUsername = !normalizedEmail && PHONE_ONLY_USERNAME_RE.test(normalizedUsername);
    const isStructuredSyntheticIdentity =
        hasSyntheticKeyword && (hasSyntheticRoleSegment || hasTimestampSuffix);

    return {
        isTestOrSystem: hasExampleEmail || missingEmailWithSystemName || phoneOnlyUsername || (!normalizedEmail && isStructuredSyntheticIdentity)
    };
}

function updateUserAccountVisibilityMeta() {
    const metaEl = document.getElementById('userTestAccountCount');
    if (!metaEl) return;

    const testAccountCount = userState.users.filter(user => user.is_test_or_system).length;

    if (testAccountCount === 0) {
        metaEl.textContent = '未发现测试/系统账号';
        return;
    }

    metaEl.textContent = userState.filters.showTestAccounts
        ? `测试/系统账号 ${testAccountCount}`
        : `已隐藏 ${testAccountCount} 个测试/系统账号`;
}

function setUsersHiddenState(element, hidden) {
    if (!(element instanceof HTMLElement)) {
        return;
    }
    element.classList.toggle(USERS_HIDDEN_CLASS, Boolean(hidden));
}

function ensureUsersTableEmptyState() {
    let emptyDiv = document.getElementById('usersEmptyState');
    if (emptyDiv) {
        return emptyDiv;
    }

    emptyDiv = document.createElement('div');
    emptyDiv.id = 'usersEmptyState';
    emptyDiv.className = `users-table-empty-state ${USERS_HIDDEN_CLASS}`;
    emptyDiv.hidden = true;

    const table = document.getElementById('usersTable');
    if (table?.parentNode) {
        table.parentNode.insertBefore(emptyDiv, table.nextSibling);
    }

    return emptyDiv;
}

// Initialize Module
function initUserModule() {
    console.log('👥 Initializing User Module...');

    // Clear search input to prevent browser autofill (e.g., "100")
    const searchInput = document.getElementById('userSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }

    const showTestAccountsToggle = document.getElementById('userShowTestAccountsToggle');
    if (showTestAccountsToggle) {
        showTestAccountsToggle.checked = Boolean(userState.filters.showTestAccounts);
    }

    // Bind Search
    document.getElementById('userSearchInput').addEventListener('input', debounce(handleUserSearch, 500));

    // Bind Custom Filter Dropdowns
    initUserFilterDropdowns();

    // Show admin role filter for super admins
    if (window._isSuperAdmin) {
        const roleFilter = document.getElementById('adminRoleFilter');
        setUsersHiddenState(roleFilter, false);
    }

    // Bind Modal Overlay Click
    const overlay = document.getElementById('userModalOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeUserModal();
            }
        });
    }

    // Initial Load
    loadUsers();

    // Fetch Prompt Cache
    fetchPromptCache();

    // Enable horizontal scroll with mouse wheel on desktop
    // Must use #module-users context to avoid selecting the wrong .users-table-panel (e.g., points batch table)
    const usersModule = document.getElementById('module-users');
    const tablePanel = usersModule ? usersModule.querySelector('.users-table-panel') : null;
    if (tablePanel && window.enableHorizontalScroll) {
        window.enableHorizontalScroll(tablePanel);
    }
}

// Initialize Filter Dropdowns (Custom Component)
function initUserFilterDropdowns() {
    const userModule = document.getElementById('module-users');
    if (!userModule) return;

    // Toggle dropdown on button click
    userModule.querySelectorAll('.filter-dropdown .filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = btn.closest('.filter-dropdown');

            // Close other open dropdowns
            userModule.querySelectorAll('.filter-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });

            dropdown.classList.toggle('open');
        });
    });

    // Handle option selection
    userModule.querySelectorAll('.filter-dropdown .filter-option').forEach(option => {
        option.addEventListener('click', (e) => {
            const dropdown = option.closest('.filter-dropdown');
            const filterType = dropdown.dataset.filter;
            const value = option.dataset.value;

            // Update selected state
            dropdown.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');

            // Update label
            const label = dropdown.querySelector('.filter-label');
            if (value === 'all') {
                label.textContent = filterType === 'userStatus' ? '状态' : '等级';
            } else {
                label.textContent = option.textContent;
            }

            // Update filter state
            if (filterType === 'userStatus') {
                userState.filters.status = value;
            } else if (filterType === 'userLevel') {
                userState.filters.level = value;
            } else if (filterType === 'userRole') {
                userState.filters.role = value;
            }

            // Close dropdown and re-render
            dropdown.classList.remove('open');
            userState.currentPage = 1;
            renderUsersTable();
        });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-dropdown')) {
            userModule.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
        }
    });
}

// ========================================
// FILTER TOGGLE FUNCTIONS (Inline onclick handlers)
// ========================================
function toggleUserStatusFilter() {
    const filter = document.querySelector('#module-users .filter-dropdown[data-filter="userStatus"]');
    if (!filter) return;
    const wasOpen = filter.classList.contains('open');
    closeUserFilterDropdowns();
    if (!wasOpen) {
        filter.classList.add('open');
    }
}

function toggleUserLevelFilter() {
    const filter = document.querySelector('#module-users .filter-dropdown[data-filter="userLevel"]');
    if (!filter) return;
    const wasOpen = filter.classList.contains('open');
    closeUserFilterDropdowns();
    if (!wasOpen) {
        filter.classList.add('open');
    }
}

function toggleUserRoleFilter() {
    const filter = document.querySelector('#module-users .filter-dropdown[data-filter="userRole"]');
    if (!filter) return;
    const wasOpen = filter.classList.contains('open');
    closeUserFilterDropdowns();
    if (!wasOpen) {
        filter.classList.add('open');
    }
}

function closeUserFilterDropdowns() {
    const userModule = document.getElementById('module-users');
    if (!userModule) return;
    userModule.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
}

function filterUserByStatus(value) {
    userState.filters.status = value;
    const labels = { all: '状态', active: '正常', banned: '封禁中' };
    const label = document.querySelector('#module-users .filter-dropdown[data-filter="userStatus"] .filter-label');
    if (label) label.textContent = labels[value] || '状态';

    document.querySelectorAll('#module-users .filter-dropdown[data-filter="userStatus"] .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    closeUserFilterDropdowns();
    userState.currentPage = 1;
    renderUsersTable();
}

function filterUserByLevel(value) {
    userState.filters.level = value;
    const labels = { all: '等级', vip: 'VIP 会员' };
    const label = document.querySelector('#module-users .filter-dropdown[data-filter="userLevel"] .filter-label');
    if (label) label.textContent = labels[value] || '等级';

    document.querySelectorAll('#module-users .filter-dropdown[data-filter="userLevel"] .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    closeUserFilterDropdowns();
    userState.currentPage = 1;
    renderUsersTable();
}

function filterUserByRole(value) {
    userState.filters.role = value;
    const labels = { all: '角色', admin: '管理员', user: '普通用户' };
    const label = document.querySelector('#module-users .filter-dropdown[data-filter="userRole"] .filter-label');
    if (label) label.textContent = labels[value] || '角色';

    document.querySelectorAll('#module-users .filter-dropdown[data-filter="userRole"] .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    closeUserFilterDropdowns();
    userState.currentPage = 1;
    renderUsersTable();
}

// Close user filter dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('#module-users .filter-dropdown')) {
        closeUserFilterDropdowns();
    }
});

// Debounce Helper
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Fetch Users from Supabase with Real Points Data
async function loadUsers() {
    renderUserLoading();

    try {
        let profiles = [];
        let rpcError = null;

        // Try RPC first (includes last_sign_in_at)
        const { data: rpcData, error: err } = await window.supabaseClient.rpc('get_admin_users');

        if (!err && rpcData) {
            profiles = rpcData;
        } else {
            rpcError = err;
            console.warn('RPC get_admin_users failed, falling back to profiles table:', err.message);
            // Fallback to standard profiles query
            const { data: profileData, error: profileError } = await window.supabaseClient
                .from('profiles')
                .select('id, username, email, avatar_url');

            if (profileError) throw profileError;
            profiles = profileData || [];
        }

        // Fetch blocks, points, tags, and admin roles in parallel
        const [blocksResult, pointsResult, tagsResult, rolesResult] = await Promise.all([
            window.supabaseClient
                .from('blocked_users')
                .select('user_id, scope, expires_at'),
            (function () {
                let q = window.supabaseClient.from('points_balance').select('user_id, total_balance');
                if (window.AdminSiteFilter) q = AdminSiteFilter.applySiteFilter(q);
                return q;
            })(),
            window.supabaseClient
                .from('user_tags')
                .select('user_id, tag'),
            window.supabaseClient
                .from('admin_roles')
                .select('user_id, role_name, permissions, expires_at')
        ]);

        const blocks = blocksResult.data || [];
        const points = pointsResult.data || [];
        const tags = tagsResult.data || [];
        const roles = rolesResult.data || [];

        // Create lookup maps
        const blockedMap = new Map();
        blocks.forEach(b => blockedMap.set(b.user_id, b));

        const pointsMap = new Map();
        points.forEach(p => pointsMap.set(p.user_id, p));

        const tagsMap = new Map();
        tags.forEach(t => {
            if (!tagsMap.has(t.user_id)) tagsMap.set(t.user_id, []);
            tagsMap.get(t.user_id).push(t.tag);
        });

        const rolesMap = new Map();
        roles.forEach(r => {
            // Check if role is not expired
            if (!r.expires_at || new Date(r.expires_at) > new Date()) {
                rolesMap.set(r.user_id, r);
            }
        });

        // Site-based user filtering: only show users with activity on selected site
        const siteFilter = window.AdminSiteFilter ? AdminSiteFilter.getSiteParam() : null;
        if (siteFilter) {
            // Fetch user IDs with activity on this site (login, points, comments, messages)
            const [loginResult, commentsResult, messagesResult] = await Promise.all([
                window.supabaseClient
                    .from('user_login_history')
                    .select('user_id')
                    .eq('site', siteFilter),
                window.supabaseClient
                    .from('prompt_comments')
                    .select('user_id')
                    .eq('site', siteFilter)
                    .not('user_id', 'is', null),
                window.supabaseClient
                    .from('guestbook_messages')
                    .select('user_id')
                    .eq('site', siteFilter)
                    .not('user_id', 'is', null)
            ]);

            const activeUserIds = new Set();
            (loginResult.data || []).forEach(r => activeUserIds.add(r.user_id));
            (commentsResult.data || []).forEach(r => activeUserIds.add(r.user_id));
            (messagesResult.data || []).forEach(r => activeUserIds.add(r.user_id));
            // Also include users with points on this site
            points.forEach(p => activeUserIds.add(p.user_id));

            profiles = profiles.filter(p => {
                const uid = p.out_id || p.id;
                return activeUserIds.has(uid);
            });
        }

        // Transform to View Model with real data
        userState.users = profiles.map(p => {
            // Support both new out_ prefixed columns and legacy column names
            const id = p.out_id || p.id;
            const email = p.out_email || p.email;
            const username = p.out_username || p.username;
            const avatar_url = p.out_avatar_url || p.avatar_url;
            const last_active = p.out_last_active_at || p.out_last_sign_in_at || p.last_sign_in_at;
            const created = p.out_created_at || p.created_at;

            const userPoints = pointsMap.get(id);
            const accountFlags = classifyUserAccount({ email, username });
            return {
                id: id,
                username: username || 'Unknown',
                email: email || null,
                avatar_url: avatar_url,
                last_sign_in_at: last_active || null, // Use computed active time
                created_at: created || null,
                // Real Points Data (using new system)
                points: userPoints?.total_balance || 0,
                total_earned: userPoints?.total_balance || 0, // Fallback as total_earned is not in balance table yet
                vip_level: (userPoints?.balance || 0) >= 1000 ? 'VIP' : null,
                // Tags
                tags: tagsMap.get(id) || [],
                // Status
                is_banned: blockedMap.has(id),
                block_info: blockedMap.get(id),
                // Admin Role
                is_admin: rolesMap.has(id) || ['fjivvid@163.com', 'zaoyoe@gmail.com'].includes(email),
                admin_role: rolesMap.get(id),
                is_test_or_system: accountFlags.isTestOrSystem
            };
        });

        renderUsersTable();

    } catch (err) {
        console.error('Failed to load users:', err);
        document.getElementById('usersTableBody').innerHTML = `
            <tr><td colspan="5" class="loading-cell users-table-status-cell">
                加载失败: ${err.message}
            </td></tr>
        `;
        hideUsersEmptyState();
    }
}

// Handle Filter Changes
function handleUserSearch(e) {
    userState.filters.search = e.target.value.toLowerCase();
    userState.currentPage = 1;
    renderUsersTable();
}

function handleUserFilterChange(e) {
    if (e.target.id === 'userStatusFilter') userState.filters.status = e.target.value;
    if (e.target.id === 'userLevelFilter') userState.filters.level = e.target.value;
    userState.currentPage = 1;
    renderUsersTable();
}

function setUsersEmptyStateContent(content, { isHtml = false } = {}) {
    const emptyDiv = ensureUsersTableEmptyState();
    if (!emptyDiv) return;
    if (isHtml) {
        emptyDiv.innerHTML = content;
    } else {
        emptyDiv.textContent = content;
    }
    emptyDiv.hidden = false;
    setUsersHiddenState(emptyDiv, false);
}

function hideUsersEmptyState() {
    const emptyDiv = document.getElementById('usersEmptyState');
    if (!emptyDiv) return;
    emptyDiv.hidden = true;
    emptyDiv.innerHTML = '';
    setUsersHiddenState(emptyDiv, true);
}

function toggleUserTestAccountVisibility(checked) {
    userState.filters.showTestAccounts = Boolean(checked);

    if (!userState.filters.showTestAccounts) {
        const hiddenIds = new Set(
            userState.users
                .filter(user => user.is_test_or_system)
                .map(user => user.id)
        );

        Array.from(userState.selectedUsers).forEach(userId => {
            if (hiddenIds.has(userId)) {
                userState.selectedUsers.delete(userId);
            }
        });
    }

    userState.currentPage = 1;
    renderUsersTable();
    renderBatchActionBar();
}

// Render Users Table
function renderUsersTable() {
    // 1. Filter Users
    const { status, level, role, search, showTestAccounts } = userState.filters;
    const term = search ? search.toLowerCase() : '';

    userState.filteredUsers = userState.users.filter(u => {
        // Search - also match "管理员" / "admin" keywords
        const isAdminSearch = term && (term.includes('管理员') || term.includes('admin'));
        const matchSearch = !term ||
            u.username.toLowerCase().includes(term) ||
            (u.email && u.email.toLowerCase().includes(term)) ||
            (u.id && u.id.includes(term)) ||
            (isAdminSearch && u.is_admin);

        // Status
        const matchStatus = status === 'all' ||
            (status === 'active' && !u.is_banned) ||
            (status === 'banned' && u.is_banned);

        // Level
        const matchLevel = level === 'all' ||
            (level === 'vip' && u.vip_level === 'VIP');

        // Role
        const matchRole = role === 'all' ||
            (role === 'admin' && u.is_admin) ||
            (role === 'user' && !u.is_admin);

        const matchAccountScope = showTestAccounts || !u.is_test_or_system;

        return matchSearch && matchStatus && matchLevel && matchRole && matchAccountScope;
    });

    updateUserAccountVisibilityMeta();

    const tableBody = document.getElementById('usersTableBody');
    if (!tableBody) return;

    // 3. Pagination - Calculate BEFORE header rendering
    const totalPages = Math.max(1, Math.ceil(userState.filteredUsers.length / userState.itemsPerPage));
    if (userState.currentPage > totalPages) {
        userState.currentPage = totalPages;
    }
    const start = (userState.currentPage - 1) * userState.itemsPerPage;
    const paginatedUsers = userState.filteredUsers.slice(start, start + userState.itemsPerPage);

    const tableHead = document.querySelector('.users-table thead tr');
    if (tableHead) {
        const allOnPageSelected = paginatedUsers.length > 0 && paginatedUsers.every(u => userState.selectedUsers.has(u.id));

        // Conditionally include checkbox column based on selectMode
        const checkboxHeader = userState.selectMode ? `
            <th class="checkbox-col">
                <label class="custom-checkbox">
                    <input type="checkbox" id="selectAllUsers" 
                           ${allOnPageSelected ? 'checked' : ''} 
                           data-admin-change-action="users-toggle-select-all-page"
                           title="全选当前页">
                    <span class="checkmark"></span>
                </label>
            </th>
        ` : '';

        tableHead.innerHTML = `
            ${checkboxHeader}
            <th class="col-identity">用户 Identity</th>
            <th class="col-assets">资产 Assets</th>
            <th class="col-active">活跃 Active</th>
            <th class="col-status">状态 Status</th>
            <th class="col-tags">标签 Tags</th>
        `;

    }

    if (paginatedUsers.length === 0) {
        tableBody.innerHTML = '';
        setUsersEmptyStateContent(
            showTestAccounts
                ? '未找到符合条件的用户'
                : '当前仅显示真实用户，打开“显示测试/系统账号”可查看被隐藏账号'
        );
        return;
    }
    hideUsersEmptyState();

    // 4. Render Rows
    tableBody.innerHTML = paginatedUsers.map(u => {
        // Status Logic
        let statusClass = 'offline';
        let statusText = '离线';
        let timeAgo = '未知';

        if (u.last_sign_in_at) {
            const date = new Date(u.last_sign_in_at);
            const now = new Date();
            const diffMin = (now - date) / 1000 / 60;

            timeAgo = formatTimeAgo(u.last_sign_in_at);

            if (diffMin < 30) { statusClass = 'online'; statusText = '在线'; }
            else if (diffMin < 60 * 24) { statusClass = 'away'; statusText = '今日'; }
        } else if (u.created_at) {
            // Fallback to created_at if no sign in record (new user)
            timeAgo = '注册于 ' + formatTimeAgo(u.created_at);
        }

        return `
        <tr class="user-row ${userState.selectedUsers.has(u.id) ? 'selected' : ''}" data-admin-action="users-open-drawer" data-user-id="${encodeURIComponent(u.id)}">
            ${userState.selectMode ? `
            <td class="checkbox-col" data-admin-action="users-stop-propagation">
                <label class="custom-checkbox">
                    <input type="checkbox" 
                           ${userState.selectedUsers.has(u.id) ? 'checked' : ''} 
                           data-admin-change-action="users-toggle-selection"
                           data-user-id="${encodeURIComponent(u.id)}"
                           class="user-checkbox">
                    <span class="checkmark"></span>
                </label>
            </td>
            ` : ''}
            <td>
                <div class="user-cell">
                    ${u.avatar_url
                ? `<img src="${u.avatar_url}" class="user-avatar-small" data-avatar-fallback-src="https://via.placeholder.com/40">`
                : generateInitialsAvatar(u.username)
            }
                    <div class="user-info">
                        <div class="user-name">
                            ${escapeHtml(u.username)}
                            ${u.vip_level === 'VIP' ? '<i class="fas fa-crown vip-icon"></i>' : ''}
                            ${u.is_admin ? '<i class="fas fa-shield-alt admin-icon" title="管理员"></i>' : ''}
                            ${u.is_test_or_system ? '<span class="user-account-pill">测试/系统</span>' : ''}
                        </div>
                        <div class="user-email">${escapeHtml(u.email || 'No Email')}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="assets-cell">
                    <div class="points-display">
                        <i class="fas fa-coins"></i>
                        <span>${u.points.toLocaleString()}</span>
                    </div>
                </div>
            </td>
            <td>
                <div class="active-status">
                    <div class="status-dot ${statusClass}"></div>
                    <span>${timeAgo}</span>
                </div>
            </td>
            <td>
                ${u.is_banned
                ? `<span class="status-badge banned"><i class="fas fa-ban"></i> 封禁中</span>`
                : `<span class="status-badge active"><i class="fas fa-check-circle"></i> 正常</span>`
            }
            </td>
            <td>
                <div class="user-tags-cell">
                    ${u.tags.length > 0
                ? u.tags.slice(0, 2).map(tag => `<span class="user-tag ${getTagClass(tag)}">${getTagLabel(tag)}</span>`).join('') + (u.tags.length > 2 ? `<span class="user-tag more">+${u.tags.length - 2}</span>` : '')
                : '<span class="users-empty-tag">-</span>'
            }
                </div>
            </td>
        </tr>
    `}).join('');
}

// Loading State
function renderUserLoading() {
    document.getElementById('usersTableBody').innerHTML = '';
    setUsersEmptyStateContent('<div class="neural-loader small"><div class="neural-dot"></div><div class="neural-dot"></div><div class="neural-dot"></div></div>', { isHtml: true });
}

// ========================================
// BATCH SELECTION & ACTIONS
// ========================================

// Toggle single user selection
function toggleUserSelection(userId) {
    if (userState.selectedUsers.has(userId)) {
        userState.selectedUsers.delete(userId);
    } else {
        userState.selectedUsers.add(userId);
    }
    renderUsersTable(); // Re-render to update checkbox states
    renderBatchActionBar();
}

// Toggle select all on current page
function toggleSelectAllPage() {
    const start = (userState.currentPage - 1) * userState.itemsPerPage;
    const paginatedUsers = userState.filteredUsers.slice(start, start + userState.itemsPerPage);

    const allSelected = paginatedUsers.every(u => userState.selectedUsers.has(u.id));

    if (allSelected) {
        // Deselect all on page
        paginatedUsers.forEach(u => userState.selectedUsers.delete(u.id));
    } else {
        // Select all on page
        paginatedUsers.forEach(u => userState.selectedUsers.add(u.id));
    }

    renderUsersTable();
    renderBatchActionBar();
}

// Clear all selections
function clearAllSelections() {
    userState.selectedUsers.clear();
    renderUsersTable();
    renderBatchActionBar();
}

// Render batch action bar - Now just updates the toolbar state  
function renderBatchActionBar() {
    updateUserSelectionCount();
}

// Toggle user selection mode (like Gallery Manage)
function toggleUserSelectMode() {
    userState.selectMode = !userState.selectMode;

    // Clear selections when exiting select mode
    if (!userState.selectMode) {
        userState.selectedUsers.clear();
    }

    // Update UI
    updateSelectModeUI();
    renderUsersTable();
}

// Update select mode UI (toolbar buttons, counters)
function updateSelectModeUI() {
    const selectModeBtn = document.getElementById('userSelectModeBtn');
    const batchMenuContainer = document.getElementById('userBatchMenuContainer');
    const selectedCountWrapper = document.getElementById('userSelectedCountWrapper');

    if (selectModeBtn) {
        selectModeBtn.classList.toggle('active', userState.selectMode);
    }

    setUsersHiddenState(batchMenuContainer, !userState.selectMode);
    setUsersHiddenState(selectedCountWrapper, !(userState.selectMode && userState.selectedUsers.size > 0));
}

// Update selection count display
function updateUserSelectionCount() {
    const countEl = document.getElementById('userSelectedCount');
    const wrapper = document.getElementById('userSelectedCountWrapper');

    if (countEl) {
        countEl.textContent = userState.selectedUsers.size;
    }

    setUsersHiddenState(wrapper, !(userState.selectMode && userState.selectedUsers.size > 0));
}

// Select all users on current page
function selectAllUsersOnPage() {
    const start = (userState.currentPage - 1) * userState.itemsPerPage;
    const paginatedUsers = userState.filteredUsers.slice(start, start + userState.itemsPerPage);

    paginatedUsers.forEach(u => userState.selectedUsers.add(u.id));
    renderUsersTable();
    updateUserSelectionCount();
}

// Toggle batch menu dropdown
function toggleUserBatchMenu() {
    const menu = document.getElementById('userBatchDropdownMenu');
    if (menu) {
        menu.classList.toggle('open');
    }
}

// Close batch menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('userBatchDropdownMenu');
    const trigger = document.getElementById('userBatchMenuTrigger');

    if (menu && trigger && !menu.contains(e.target) && !trigger.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// ========================================
// BATCH OPERATION FUNCTIONS
// ========================================

// Batch send notification - reuses existing notification modal
let batchNotificationUserIds = [];

async function batchSendNotification() {
    const userIds = Array.from(userState.selectedUsers);
    if (userIds.length === 0) {
        showToast('请先选择用户', 'error');
        return;
    }

    // Store batch user IDs and open notification modal in batch mode
    batchNotificationUserIds = userIds;
    showNotificationModalBatch(userIds.length);
}

function buildUsersModalCountBadge(count) {
    return `<span class="users-modal-title-count">(${escapeHtml(String(count))} 人)</span>`;
}

function buildNotificationModalTitle(count = null) {
    const isBatch = Number.isFinite(Number(count)) && Number(count) > 0;
    const badge = isBatch ? ` ${buildUsersModalCountBadge(count)}` : '';
    return `<i class="far fa-bell notification-modal-title-icon" aria-hidden="true"></i>${isBatch ? '批量通知' : '通知'}${badge}`;
}

function getNotificationModal() {
    let modal = document.getElementById('notificationModal');
    if (modal) {
        return modal;
    }

    modal = document.createElement('div');
    modal.id = 'notificationModal';
    modal.className = 'custom-modal-overlay notification-modal-overlay';
    modal.innerHTML = `
        <div class="custom-modal notification-modal-dialog">
            <div class="modal-header">
                <h3 class="modal-title">${buildNotificationModalTitle()}</h3>
                <button class="modal-close-btn" type="button" data-admin-action="users-close-notification-modal"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>标题</label>
                    <input type="text" id="notifTitle" class="modal-input" placeholder="简短的通知标题">
                </div>
                <div class="form-group">
                    <label>内容</label>
                    <textarea id="notifContent" class="modal-input" rows="4" placeholder="通知详细内容..."></textarea>
                </div>
                <div class="form-group">
                    <label>类型</label>
                    <div class="notif-type-selector notification-type-selector">
                        <button class="type-btn active" type="button" data-type="info" data-admin-action="users-select-notification-type" data-notification-type="info"><i class="fas fa-info-circle"></i> 信息</button>
                        <button class="type-btn" type="button" data-type="warning" data-admin-action="users-select-notification-type" data-notification-type="warning"><i class="fas fa-exclamation-triangle"></i> 警告</button>
                        <button class="type-btn" type="button" data-type="success" data-admin-action="users-select-notification-type" data-notification-type="success"><i class="fas fa-check-circle"></i> 成功</button>
                    </div>
                    <input type="hidden" id="notifType" value="info">
                </div>
            </div>
            <div class="modal-footer notification-modal-footer">
                <button class="send-notification-btn" type="button" data-admin-action="users-send-notification" data-user-id=""><i class="fas fa-paper-plane"></i></button>
            </div>
        </div>
    `;

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeNotificationModal();
        }
    });

    document.body.appendChild(modal);
    return modal;
}

function openNotificationModal(userId, count = null) {
    const modal = getNotificationModal();
    const titleEl = modal.querySelector('.modal-title');
    if (titleEl) {
        titleEl.innerHTML = buildNotificationModalTitle(count);
    }

    document.getElementById('notifTitle').value = '';
    document.getElementById('notifContent').value = '';

    const sendBtn = modal.querySelector('.send-notification-btn');
    if (sendBtn) {
        sendBtn.dataset.userId = userId;
    }

    selectNotifType('info');

    requestAnimationFrame(() => {
        modal.classList.add('active');
    });
}

// Open notification modal in batch mode
function showNotificationModalBatch(count) {
    openNotificationModal('__BATCH__', count);
}

// Execute batch notification send
async function executeBatchNotification() {
    const title = document.getElementById('notifTitle')?.value.trim();
    const content = document.getElementById('notifContent')?.value.trim();
    const type = document.getElementById('notifType')?.value || 'info';

    if (!title) {
        showToast('请输入通知标题', 'error');
        return;
    }
    if (!content) {
        showToast('请输入通知内容', 'error');
        return;
    }

    const btn = document.querySelector('#notificationModal .send-notification-btn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
    }

    try {
        for (const userId of batchNotificationUserIds) {
            await window.supabaseClient
                .from('system_notifications')
                .insert({
                    user_id: userId,
                    title,
                    content,
                    type
                });
        }

        showToast(`成功发送通知给 ${batchNotificationUserIds.length} 位用户`, 'success');

        // Close modal
        closeNotificationModal();

        batchNotificationUserIds = [];
        clearAllSelections();
    } catch (err) {
        console.error('Batch notification failed:', err);
        showToast('批量发送通知失败: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
            btn.disabled = false;
        }
    }
}

// Batch ban users - reuses existing ban modal
async function batchBanUsers() {
    const userIds = Array.from(userState.selectedUsers);
    if (userIds.length === 0) {
        showToast('请先选择用户', 'error');
        return;
    }

    // Store batch user IDs and open ban modal in batch mode
    batchBanUserIds = userIds;
    openBanModalBatch(userIds.length);
}

// Open ban modal in batch mode
async function openBanModalBatch(count) {
    injectBanUserModal();

    // Set a special marker for batch mode
    document.getElementById('banTargetUserId').value = '__BATCH__';

    // Update modal title to show batch mode
    const titleEl = document.querySelector('#banUserModalOverlay .modal-title');
    if (titleEl) {
        titleEl.innerHTML = `🚫 批量封禁管理 ${buildUsersModalCountBadge(count)}`;
    }

    // Reset State
    pendingBanState = {};
    originalBanState = { guestbook: false, gallery: false };

    // Reset UI
    document.querySelectorAll('.ban-check-item').forEach(item => item.classList.remove('selected'));

    // Show modal
    const overlay = document.getElementById('banUserModalOverlay');
    overlay.classList.add('active');

    updateConfirmBtn();
}


// Batch unban users
async function batchUnbanUsers() {
    const userIds = Array.from(userState.selectedUsers);
    if (userIds.length === 0) return;

    if (!confirm(`确定要解封选中的 ${userIds.length} 位用户吗？`)) return;

    showToast(`正在解封 ${userIds.length} 位用户...`, 'info');

    try {
        for (const userId of userIds) {
            await window.supabaseClient
                .from('blocked_users')
                .delete()
                .eq('user_id', userId);
        }

        showToast(`成功解封 ${userIds.length} 位用户`, 'success');
        clearAllSelections();
        loadUsers();
    } catch (err) {
        console.error('Batch unban failed:', err);
        showToast('批量解封失败: ' + err.message, 'error');
    }
}

// Batch adjust points - reuses existing points modal
let batchPointsUserIds = [];

async function batchAdjustPoints() {
    const userIds = Array.from(userState.selectedUsers);
    if (userIds.length === 0) {
        showToast('请先选择用户', 'error');
        return;
    }

    // Store batch user IDs and open points modal in batch mode
    batchPointsUserIds = userIds;
    openPointsModalBatch(userIds.length);
}

// Open points modal in batch mode
function openPointsModalBatch(count) {
    injectPointsModal();
    const overlay = document.getElementById('pointsModalOverlay');

    // Update for batch mode
    document.getElementById('pmUserName').textContent = `批量 (${count} 人)`;
    document.getElementById('pmCurrentPoints').textContent = '多用户';
    document.getElementById('pmAmount').value = '';
    document.getElementById('pmReason').value = '';

    // Update confirm button for batch mode
    const confirmBtn = document.getElementById('pmConfirmBtn');
    confirmBtn.onclick = () => executeBatchPointsAdjustment();

    // Show Modal
    overlay.classList.add('active');
}

// Execute batch points adjustment
async function executeBatchPointsAdjustment() {
    const amountStr = document.getElementById('pmAmount').value;
    const reason = document.getElementById('pmReason').value.trim();
    const amount = parseInt(amountStr, 10);

    if (isNaN(amount) || amount === 0) {
        showToast('请输入有效的调整数值', 'error');
        return;
    }
    if (!reason) {
        showToast('请输入调整原因', 'error');
        return;
    }

    const confirmBtn = document.getElementById('pmConfirmBtn');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';

    try {
        const { data: { user: adminUser } } = await window.supabaseClient.auth.getUser();

        for (const userId of batchPointsUserIds) {
            // Get current balance
            const { data: current } = await window.supabaseClient
                .from('user_points')
                .select('balance, total_earned')
                .eq('user_id', userId)
                .maybeSingle();

            const currentBalance = current?.balance || 0;
            const currentTotal = current?.total_earned || 0;
            const newBalance = currentBalance + amount;
            const newTotalEarned = amount > 0 ? currentTotal + amount : currentTotal;

            // Update points
            await window.supabaseClient
                .from('user_points')
                .upsert({
                    user_id: userId,
                    balance: newBalance,
                    total_earned: newTotalEarned,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });

            // Log to ledger
            await window.supabaseClient
                .from('points_ledger')
                .insert({
                    user_id: userId,
                    amount: amount,
                    reason: `[批量调整] ${reason}`,
                    admin_id: adminUser?.id
                });
        }

        showToast(`成功为 ${batchPointsUserIds.length} 位用户${amount > 0 ? '增加' : '扣除'} ${Math.abs(amount)} 积分`, 'success');

        closePointsModal();
        batchPointsUserIds = [];
        clearAllSelections();
        loadUsers();
    } catch (err) {
        console.error('Batch points adjustment failed:', err);
        showToast('批量调整积分失败: ' + err.message, 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认调整';
    }
}

// Batch add tags
async function batchAddTags() {
    const userIds = Array.from(userState.selectedUsers);
    if (userIds.length === 0) return;

    // Show tag selection modal
    const tag = await showBatchTagModal(userIds.length);
    if (!tag) return;

    showToast(`正在为 ${userIds.length} 位用户添加标签...`, 'info');

    try {
        for (const userId of userIds) {
            // Check if tag already exists
            const { data: existing } = await window.supabaseClient
                .from('user_tags')
                .select('id')
                .eq('user_id', userId)
                .eq('tag', tag)
                .single();

            if (!existing) {
                await window.supabaseClient
                    .from('user_tags')
                    .insert({ user_id: userId, tag: tag });
            }
        }

        showToast(`成功为 ${userIds.length} 位用户添加标签 "${getTagLabel(tag)}"`, 'success');
        clearAllSelections();
        loadUsers();
    } catch (err) {
        console.error('Batch add tags failed:', err);
        showToast('批量添加标签失败: ' + err.message, 'error');
    }
}

// Show batch tag selection modal
function showBatchTagModal(count) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';

        const tagButtons = Object.entries(TAG_CONFIG)
            .map(([key, config]) => `<button class="tag-option ${config.class}" type="button" data-batch-tag-value="${escapeHtml(key)}">${config.label}</button>`)
            .join('');

        modal.innerHTML = `
            <div class="modal-content users-batch-tag-modal">
                <div class="modal-header">
                    <h3>批量添加标签 (${count} 人)</h3>
                    <button class="modal-close" type="button" data-batch-tag-close="1">&times;</button>
                </div>
                <div class="modal-body users-batch-tag-body">
                    <p class="users-batch-tag-note">选择要添加的标签：</p>
                    <div class="tag-options users-batch-tag-options">
                        ${tagButtons}
                    </div>
                    <div class="users-batch-tag-custom">
                        <input type="text" id="customTagInput" class="users-batch-tag-input" placeholder="或输入自定义标签...">
                        <button class="btn-secondary users-batch-tag-submit" type="button" data-batch-tag-submit="1">添加自定义标签</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const resolveBatchTag = (tag) => {
            if (!tag || !tag.trim()) {
                showToast('请选择或输入标签', 'error');
                return;
            }
            modal.remove();
            resolve(tag.trim());
        };

        modal.addEventListener('click', (e) => {
            const actionEl = e.target instanceof Element ? e.target.closest('[data-batch-tag-value],[data-batch-tag-close],[data-batch-tag-submit]') : null;
            if (actionEl) {
                if (actionEl.hasAttribute('data-batch-tag-close')) {
                    modal.remove();
                    resolve(null);
                    return;
                }

                if (actionEl.hasAttribute('data-batch-tag-submit')) {
                    resolveBatchTag(document.getElementById('customTagInput')?.value || '');
                    return;
                }

                if (actionEl.hasAttribute('data-batch-tag-value')) {
                    resolveBatchTag(actionEl.getAttribute('data-batch-tag-value') || '');
                    return;
                }
            }

            if (e.target === modal) {
                modal.remove();
                resolve(null);
            }
        });
    });
}

// Batch export users
async function batchExportUsers() {
    const userIds = Array.from(userState.selectedUsers);
    if (userIds.length === 0) return;

    // Show export options modal
    const options = await showBatchExportModal(userIds.length);
    if (!options) return;

    showToast(`正在导出 ${userIds.length} 位用户数据...`, 'info');

    try {
        // Get selected users' data
        const selectedUserData = userState.users.filter(u => userIds.includes(u.id));

        if (options.mode === 'simple') {
            // Simple CSV export
            exportUsersToCSV(selectedUserData);
        } else {
            // Full Excel export with multiple sheets
            console.log('📊 Export options:', JSON.stringify(options, null, 2));
            await exportUsersToExcel(selectedUserData, options);
        }

        showToast(`成功导出 ${userIds.length} 位用户数据`, 'success');
    } catch (err) {
        console.error('Batch export failed:', err);
        showToast('导出失败: ' + err.message, 'error');
    }
}

// Show export options modal
function showBatchExportModal(count) {
    return new Promise((resolve, reject) => {
        // Remove existing modal if any
        document.querySelector('.batch-export-modal-overlay')?.remove();

        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'batch-export-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'batch-export-modal glass-panel';
        modal.innerHTML = `
            <div class="batch-export-modal-header">
                <h3 class="batch-export-modal-title">📥 批量导出用户</h3>
            </div>

            <div class="batch-export-modal-body">
                <div class="batch-export-modal-summary">
                    已选 <span class="batch-export-modal-count">${escapeHtml(String(count))}</span> 位用户
                </div>

                <div class="batch-export-modal-section">
                    <div class="batch-export-modal-section-title">导出格式:</div>
                    <div class="batch-export-modal-options">
                        <label class="batch-export-modal-option">
                            <input type="radio" name="exportMode" value="simple">
                            <span>简洁模式 (CSV) - 仅基本信息</span>
                        </label>
                        <label class="batch-export-modal-option">
                            <input type="radio" name="exportMode" value="full" checked>
                            <span>完整模式 (Excel) - 含积分流水/封禁记录</span>
                        </label>
                    </div>
                </div>

                <div id="exportDataOptions" class="batch-export-modal-section batch-export-modal-section-compact">
                    <div class="batch-export-modal-section-title">包含数据:</div>
                    <div class="batch-export-modal-options batch-export-modal-options-tight">
                        <label class="batch-export-modal-option is-disabled">
                            <input type="checkbox" checked disabled> 基本信息 (用户名/邮箱/积分/状态)
                        </label>
                        <label class="batch-export-modal-option">
                            <input type="checkbox" id="exportLedger" checked> 积分流水记录
                        </label>
                        <label class="batch-export-modal-option">
                            <input type="checkbox" id="exportBanHistory"> 封禁历史
                        </label>
                        <label class="batch-export-modal-option">
                            <input type="checkbox" id="exportTags"> 标签详情
                        </label>
                    </div>
                </div>
            </div>

            <div class="batch-export-modal-footer">
                <button class="modal-btn-cancel batch-export-modal-btn" type="button">
                    取消
                </button>
                <button class="modal-btn-confirm batch-export-modal-btn batch-export-modal-btn-primary" type="button">
                    导出
                </button>
            </div>
        `;

        document.body.appendChild(modalOverlay);
        modalOverlay.appendChild(modal);

        // Animation in
        requestAnimationFrame(() => {
            modalOverlay.classList.add('active');
        });

        let finished = false;

        const finish = (result) => {
            if (finished) return;
            finished = true;
            modalOverlay.classList.remove('active');
            setTimeout(() => {
                modalOverlay.remove();
                resolve(result);
            }, 300);
        };

        // Event Listeners
        const close = () => finish(null);

        const confirm = () => {
            const mode = modal.querySelector('input[name="exportMode"]:checked')?.value || 'full';
            const options = {
                mode,
                includeLedger: modal.querySelector('#exportLedger')?.checked ?? false,
                includeBanHistory: modal.querySelector('#exportBanHistory')?.checked ?? false,
                includeTags: modal.querySelector('#exportTags')?.checked ?? false
            };

            finish(options);
        };

        // Bind event listeners to buttons
        modal.querySelector('.modal-btn-cancel').addEventListener('click', close);
        modal.querySelector('.modal-btn-confirm').addEventListener('click', confirm);

        // Click outside to close
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) close();
        });

    });
}

// Export to CSV (simple mode)
function exportUsersToCSV(users) {
    const headers = ['用户名', '邮箱', '积分', '状态', '标签', '注册时间', '最后活跃'];
    const rows = users.map(u => [
        u.username || 'Unknown',
        u.email || '',
        u.points || 0,
        u.is_banned ? '封禁' : '正常',
        (u.tags || []).join(', '),
        u.created_at ? new Date(u.created_at).toLocaleDateString() : '',
        u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : ''
    ]);

    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `users_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

// Export to Excel (full mode) - requires SheetJS library
async function exportUsersToExcel(users, options) {
    console.log('📊 exportUsersToExcel called with', users.length, 'users, options:', options);

    // Check if SheetJS is available
    if (typeof XLSX === 'undefined') {
        // Fallback to CSV if SheetJS not loaded
        console.log('📊 XLSX not available, falling back to CSV');
        showToast('Excel 库未加载，将导出为 CSV', 'warning');
        exportUsersToCSV(users);
        return;
    }

    const workbook = XLSX.utils.book_new();
    const userIds = users.map(u => u.id);

    // Sheet 1: Basic Info
    const basicData = users.map(u => ({
        '用户名': u.username || 'Unknown',
        '邮箱': u.email || '',
        '积分': u.points || 0,
        '状态': u.is_banned ? '封禁' : '正常',
        '标签': (u.tags || []).join(', '),
        '注册时间': u.created_at ? new Date(u.created_at).toLocaleDateString() : '',
        '最后活跃': u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : ''
    }));
    const ws1 = XLSX.utils.json_to_sheet(basicData);
    XLSX.utils.book_append_sheet(workbook, ws1, '用户信息');

    // Sheet 2: Points Ledger (if selected)
    if (options.includeLedger) {
        const { data: ledger } = await window.supabaseClient
            .from('points_ledger')
            .select('*')
            .in('user_id', userIds)
            .order('created_at', { ascending: false });

        if (ledger && ledger.length > 0) {
            const ledgerData = ledger.map(l => {
                const user = users.find(u => u.id === l.user_id);
                return {
                    '用户': user?.username || l.user_id,
                    '变动': l.amount,
                    '原因': l.reason,
                    '时间': new Date(l.created_at).toLocaleString()
                };
            });
            const ws2 = XLSX.utils.json_to_sheet(ledgerData);
            XLSX.utils.book_append_sheet(workbook, ws2, '积分流水');
        }
    }

    // Sheet 3: Ban History (if selected)
    if (options.includeBanHistory) {
        console.log('📊 Fetching ban history for users:', userIds);
        const { data: banHistory, error: banError } = await window.supabaseClient
            .from('block_history')
            .select('*')
            .in('user_id', userIds)
            .order('created_at', { ascending: false });

        console.log('📊 Ban history result:', banHistory, 'Error:', banError);

        if (banHistory && banHistory.length > 0) {
            const banData = banHistory.map(b => {
                const user = users.find(u => u.id === b.user_id);
                return {
                    '用户': user?.username || b.user_id,
                    '操作': b.action === 'block' ? '封禁' : '解封',
                    '范围': b.scope,
                    '原因': b.reason || '',
                    '时间': new Date(b.created_at).toLocaleString()
                };
            });
            const ws3 = XLSX.utils.json_to_sheet(banData);
            XLSX.utils.book_append_sheet(workbook, ws3, '封禁历史');
        }
    }

    // Sheet 4: Tags Detail (if selected)
    if (options.includeTags) {
        console.log('📊 Fetching tags for users:', userIds);
        const { data: userTags, error: tagError } = await window.supabaseClient
            .from('user_tags')
            .select('*')
            .in('user_id', userIds);

        console.log('📊 Tags result:', userTags, 'Error:', tagError);

        if (userTags && userTags.length > 0) {
            const tagData = userTags.map(t => {
                const user = users.find(u => u.id === t.user_id);
                return {
                    '用户': user?.username || t.user_id,
                    '标签': t.tag,
                    '标签名称': getTagLabel(t.tag),
                    '添加时间': t.created_at ? new Date(t.created_at).toLocaleString() : ''
                };
            });
            const ws4 = XLSX.utils.json_to_sheet(tagData);
            XLSX.utils.book_append_sheet(workbook, ws4, '标签详情');
        }
    }

    // Download
    console.log('📊 Workbook sheets:', workbook.SheetNames);
    XLSX.writeFile(workbook, `users_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ========================================
// USER MODAL - FULLSCREEN CARD
// ========================================

// Current modal state
let currentModalUser = null;
let currentModalData = {};
let currentTab = 'ledger';

// Fetch Active Bans
async function fetchActiveBans(userId) {
    const { data, error } = await window.supabaseClient
        .from('blocked_users')
        .select('*')
        .eq('user_id', userId);
    if (error) {
        console.error('Error fetching active bans:', error);
        return [];
    }
    return data || [];
}

function createEmptyAffiliateModalState() {
    return {
        loaded: false,
        loading: false,
        error: null,
        stats: null,
        rewards: [],
        loadedAt: null
    };
}

function formatAdminPointValue(value) {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return '0';
    const hasDecimal = Math.abs(numericValue % 1) > 0.001;
    return new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: hasDecimal ? 1 : 0,
        maximumFractionDigits: 1
    }).format(numericValue);
}

function formatAdminPercentValue(value) {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return '0%';
    return `${formatAdminPointValue(numericValue)}%`;
}

function formatAdminDateTime(value) {
    if (!value) return '未发生';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未发生';
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeAdminIpValue(value) {
    if (!value) return '';
    return String(value).trim();
}

function formatAdminGeoLocation(geoInfo) {
    if (!geoInfo || typeof geoInfo !== 'object' || Array.isArray(geoInfo)) {
        return '';
    }

    const rawParts = [
        geoInfo.country,
        geoInfo.region || geoInfo.province,
        geoInfo.city
    ];

    const parts = [];
    rawParts.forEach(part => {
        const text = String(part || '').trim();
        if (!text || parts.includes(text)) return;
        parts.push(text);
    });

    return parts.join(' · ');
}

async function fetchUserRegistrationOrigin(userId) {
    const emptyResult = {
        registration_ip: '',
        registration_location: '未记录',
        registration_location_title: ''
    };

    try {
        const [profileResult, loginResult] = await Promise.all([
            window.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle(),
            window.supabaseClient
                .from('user_login_history')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true })
                .limit(10)
        ]);

        if (profileResult?.error) {
            console.warn('Failed to load registration profile info:', profileResult.error);
        }
        if (loginResult?.error) {
            console.warn('Failed to load registration geo info:', loginResult.error);
        }

        const profile = profileResult?.data || null;
        const loginRows = Array.isArray(loginResult?.data) ? loginResult.data : [];
        const registrationIp = normalizeAdminIpValue(profile?.registration_ip);
        const profileLocation = formatAdminGeoLocation({
            country: profile?.registration_country || profile?.registration_geo_info?.country,
            region: profile?.registration_region || profile?.registration_geo_info?.region || profile?.registration_geo_info?.province,
            city: profile?.registration_city || profile?.registration_geo_info?.city
        });

        const matchingLog = registrationIp
            ? loginRows.find(row => normalizeAdminIpValue(row?.ip_address) === registrationIp)
            : null;
        const sourceLog = matchingLog || loginRows[0] || null;
        const sourceIp = registrationIp || normalizeAdminIpValue(sourceLog?.ip_address);
        const location = profileLocation || formatAdminGeoLocation(sourceLog?.geo_info);

        return {
            registration_ip: sourceIp,
            registration_location: location || (sourceIp ? '未知地区' : '未记录'),
            registration_location_title: sourceIp ? `注册 IP：${sourceIp}` : ''
        };
    } catch (err) {
        console.warn('Failed to resolve registration origin:', err);
        return emptyResult;
    }
}

function getAffiliateMemberStageMeta(member = {}) {
    if (member.first_purchase_at) {
        return {
            label: '已消费',
            className: 'stage-success',
            hint: '已完成首单消费，开始贡献返佣',
            step: 3
        };
    }
    if (member.first_recharge_at) {
        return {
            label: '已首充',
            className: 'stage-warning',
            hint: '已完成首充，等待首单消费',
            step: 2
        };
    }
    return {
        label: '已注册',
        className: 'stage-muted',
        hint: '已完成注册，尚未首充',
        step: 1
    };
}

function normalizeAffiliateMembers(members = []) {
    return (Array.isArray(members) ? members : [])
        .map(member => {
            const stageMeta = getAffiliateMemberStageMeta(member);
            return {
                ...member,
                stageMeta,
                total_rewards: Number(member.total_rewards || 0),
                commission_earned: Number(member.commission_earned || 0),
                total_spend: Number(member.total_spend || 0),
                registration_reward_granted: Number(member.registration_reward_granted || 0),
                registration_reward_pending: Number(member.registration_reward_pending || 0)
            };
        })
        .sort((a, b) => {
            const stageDiff = (b.stageMeta?.step || 0) - (a.stageMeta?.step || 0);
            if (stageDiff !== 0) return stageDiff;
            const rewardDiff = (b.total_rewards || 0) - (a.total_rewards || 0);
            if (rewardDiff !== 0) return rewardDiff;
            return (b.total_spend || 0) - (a.total_spend || 0);
        });
}

async function fetchUserAffiliateStats(userId) {
    const { data, error } = await window.supabaseClient.rpc('fn_get_affiliate_stats', {
        p_user_id: userId
    });

    if (error) throw error;
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

async function fetchUserAffiliateRewards(userId) {
    const { data, error } = await window.supabaseClient
        .from('points_ledger')
        .select('id, amount, reason, reference_id, created_at')
        .eq('user_id', userId)
        .or('reference_id.like.AFFILIATE_REWARD_%,reference_id.like.AFF_REW_%,reference_id.like.REG_REWARD_%')
        .order('created_at', { ascending: false })
        .limit(18);

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return [];

    const details = await Promise.all(rows.map(async row => {
        try {
            const { data: detail, error: detailError } = await window.supabaseClient.rpc('fn_get_affiliate_reward_detail', {
                p_user_id: userId,
                p_ledger_id: row.id
            });

            if (detailError || !detail || detail.found === false) {
                return {
                    found: false,
                    ledger_id: row.id,
                    reward_amount: Number(row.amount || 0),
                    reward_reason: row.reason,
                    reward_created_at: row.created_at,
                    reference_id: row.reference_id
                };
            }

            return detail;
        } catch (detailErr) {
            console.warn('Failed to fetch affiliate reward detail:', detailErr);
            return {
                found: false,
                ledger_id: row.id,
                reward_amount: Number(row.amount || 0),
                reward_reason: row.reason,
                reward_created_at: row.created_at,
                reference_id: row.reference_id
            };
        }
    }));

    return details;
}

async function ensureAffiliateModalData(userId) {
    if (!currentModalData.affiliate) {
        currentModalData.affiliate = createEmptyAffiliateModalState();
    }

    if (currentModalData.affiliate.loading || currentModalData.affiliate.loaded) {
        return;
    }

    currentModalData.affiliate.loading = true;
    currentModalData.affiliate.error = null;

    try {
        const [stats, rewards] = await Promise.all([
            fetchUserAffiliateStats(userId),
            fetchUserAffiliateRewards(userId)
        ]);

        currentModalData.affiliate = {
            loaded: true,
            loading: false,
            error: null,
            stats,
            rewards,
            loadedAt: new Date().toISOString()
        };
    } catch (err) {
        console.error('Failed to load affiliate data:', err);
        currentModalData.affiliate = {
            ...createEmptyAffiliateModalState(),
            error: err.message || '推广数据加载失败'
        };
    }

    if (currentModalUser?.id === userId && currentTab === 'affiliate') {
        renderUserTab('affiliate');
    }
}

// Open User Modal
async function openUserModal(userId) {
    const user = userState.users.find(u => u.id === userId);
    if (!user) {
        console.error('User not found:', userId);
        return;
    }

    currentModalUser = user;
    currentTab = 'ledger';

    const overlay = document.getElementById('userModalOverlay');
    const leftPanel = document.getElementById('userModalLeft');
    const tabContent = document.getElementById('userTabContent');
    const actionsPanel = document.getElementById('userModalActions');

    // Show modal with loading state
    overlay.classList.add('active');
    leftPanel.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
    tabContent.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i></div>';

    try {
        // Fetch all data in parallel
        console.log('📡 Fetching user data for:', userId);
        const [contentLog, blockHistory, relatedAccounts, roleInfo, pointsLedger, isSuperAdmin, activeBans, registrationOrigin] = await Promise.all([
            fetchUserContentLog(userId),
            fetchUserBlockHistory(userId),
            fetchRelatedAccounts(userId),
            fetchUserRoleInfo(userId),
            fetchPointsLedger(userId),
            checkSuperAdmin(),
            fetchActiveBans(userId),
            fetchUserRegistrationOrigin(userId)
        ]);

        Object.assign(user, registrationOrigin || {});
        currentModalUser = user;

        console.log('✅ Data fetched:', { contentLog, blockHistory, relatedAccounts, roleInfo, pointsLedger, isSuperAdmin, activeBans, registrationOrigin });

        // Store data for tabs
        currentModalData = {
            contentLog,
            blockHistory,
            relatedAccounts,
            roleInfo,
            pointsLedger,
            ledgerDetails: {},
            isSuperAdmin,
            activeBans,
            affiliate: createEmptyAffiliateModalState()
        };

        // Render left panel
        renderModalLeftPanel(user, roleInfo, isSuperAdmin, activeBans);

        // Render initial tab
        renderUserTab('ledger');

        // Render actions
        renderModalActions(user);

        // Reset tab active states
        document.querySelectorAll('.user-tab-btn').forEach(btn => btn.classList.remove('active'));
        const defaultTabBtn = document.querySelector('.user-tab-btn[data-tab="ledger"]');
        if (defaultTabBtn) {
            defaultTabBtn.classList.add('active');
            // Initialize indicator position with a small delay to ensure rendering
            setTimeout(() => updateTabIndicator(defaultTabBtn), 10);
        }

    } catch (err) {
        console.error('❌ Error loading user modal:', err);
        leftPanel.innerHTML = `<div class="users-modal-error">加载失败: ${escapeHtml(err.message)}</div>`;
        tabContent.innerHTML = '';
    }
}

// Render Left Panel
function renderModalLeftPanel(user, roleInfo, isSuperAdmin, activeBans) {
    const leftPanel = document.getElementById('userModalLeft');
    const fullEmail = user.email || 'Not available';
    const registrationLocation = user.registration_location || '未记录';
    const registrationLocationTitle = user.registration_location_title || '';

    // Format ban details for tooltip
    let banTooltip = '账号已封禁';
    if (activeBans && activeBans.length > 0) {
        banTooltip = '';
        activeBans.forEach(ban => {
            const scopeName = ban.scope === 'gallery' ? '画廊' : (ban.scope === 'guestbook' ? '留言板' : (ban.scope === 'points_usage' ? '积分权限' : '全部'));
            const expiry = ban.expires_at
                ? `${new Date(ban.expires_at).toLocaleDateString()} 到期`
                : '永久';
            banTooltip += `🚫[${scopeName}] ${expiry} \n`;
        });
        banTooltip = banTooltip.trim();
    }

    leftPanel.innerHTML = `
            <!-- User Card (Horizontal) -->
        <div class="user-card">
            ${user.avatar_url
            ? `<img src="${user.avatar_url}" class="user-avatar-large" data-avatar-fallback-src="https://via.placeholder.com/80">`
            : generateInitialsAvatar(user.username, 64)}
            
            <div class="user-details">
                <div class="user-name">${escapeHtml(user.username)}</div>
                <div class="user-email">${fullEmail}</div>
                <div class="user-registered-at">注册于 ${user.created_at ? formatAdminDateTime(user.created_at) : '未知'}</div>
                <div class="user-registration-origin"${registrationLocationTitle ? ` title="${escapeHtml(registrationLocationTitle)}"` : ''}>注册地 ${escapeHtml(registrationLocation)}</div>
                
                <div class="user-meta-icons">
                    ${user.is_banned
            ? `<div class="meta-icon-wrapper banned" data-tooltip="${banTooltip}"><i class="fas fa-ban"></i></div>`
            : `<div class="meta-icon-wrapper active" data-tooltip="账号状态正常"><i class="fas fa-check-circle"></i></div>`
        }
                    
                    <div class="meta-icon-wrapper info" 
                         data-tooltip="${user.id}" 
                         data-admin-action="users-copy-meta"
                         data-copy-value="${encodeURIComponent(user.id)}"
                         data-copy-success="✅ ID 已复制!">
                        <i class="fas fa-info-circle"></i>
                    </div>
                    
                    ${user.vip_level === 'VIP'
            ? '<div class="meta-icon-wrapper vip-active" data-tooltip="VIP User"><i class="fas fa-crown"></i></div>'
            : '<div class="meta-icon-wrapper vip-inactive" data-tooltip="Regular User"><i class="fas fa-crown"></i></div>'
        }
                </div>
            </div>
        </div>

        <!--Assets Info - Compact Icon + Value-- >
        <div class="assets-refined-section compact">
            <div class="asset-stat-row">
                <i class="fas fa-coins coin-icon"></i>
                <span class="asset-value-compact">${user.points.toLocaleString()}</span>
            </div>
        </div>

        <!--Tags - Custom Dropdown-- >
        < !--Tags - Custom Dropdown-- >
            ${window.hasPermission && window.hasPermission('users.manage') ? `
        <div class="info-block tags-block">
            <div class="admin-control-header">
                <div class="admin-control-left">
                    <div class="admin-control-icon"><i class="fas fa-tags"></i></div>
                    <span class="admin-control-title">标签</span>
                </div>
                <!-- Inline Add Button -->
                ${!user.tags.length ? `
                <div class="add-tag-wrapper add-tag-wrapper--push-end" id="addTagWrapper_${user.id}">
                    <button class="add-tag-btn" type="button" data-admin-action="users-show-tag-input" data-user-id="${encodeURIComponent(user.id)}" title="添加标签">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>` : ''}
            </div>
            <div class="modal-tags-container">
                ${user.tags.length > 0
                ? `
                    ${user.tags.map(tag => `
                        <span class="modal-tag ${getTagClass(tag)}">
                            ${getTagLabel(tag)}
                            <button class="tag-remove-btn" type="button" data-admin-action="users-remove-tag" data-user-id="${encodeURIComponent(user.id)}" data-user-tag="${encodeURIComponent(tag)}">&times;</button>
                        </span>
                    `).join('')}
                    
                    <div class="add-tag-wrapper" id="addTagWrapper_${user.id}">
                        <button class="add-tag-btn" type="button" data-admin-action="users-show-tag-input" data-user-id="${encodeURIComponent(user.id)}">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                `
                : ''}
            </div>
        </div>
        ` : ''
        }

        <!-- Admin Role (Super Admin Only) -->
            ${isSuperAdmin ? `
        <div class="info-block permissions-block">
            <div class="admin-control-header">
                <div class="admin-control-left">
                    <div class="admin-control-icon"><i class="fas fa-user-shield"></i></div>
                    <span class="admin-control-title">权限</span>
                </div>
                ${['fjivvid@163.com', 'zaoyoe@gmail.com'].includes(user.email) ?
                '<div class="super-admin-badge">⭐ 超管</div>' :
                `<label class="toggle-switch admin-switch-reset">
                        <input type="checkbox" id="modalAdminToggle" ${roleInfo.is_admin ? 'checked' : ''} 
                            data-admin-change-action="users-toggle-modal-admin"
                            data-user-id="${encodeURIComponent(user.id)}">
                        <span class="toggle-slider"></span>
                    </label>`
            }
            </div>
            
            ${!['fjivvid@163.com', 'zaoyoe@gmail.com'].includes(user.email) ? `
                <div class="modal-permissions-panel modal-permissions-panel--flush" id="modalPermissionsPanel"${roleInfo.is_admin ? '' : ' hidden'}>
                    <div class="perm-checkboxes">
                        <label class="perm-item">
                            <input type="checkbox" data-perm="content.moderate" ${roleInfo.permissions?.includes('content.moderate') ? 'checked' : ''}>
                            <span>📝 内容审核</span>
                        </label>
                        <label class="perm-item">
                            <input type="checkbox" data-perm="users.manage" ${roleInfo.permissions?.includes('users.manage') ? 'checked' : ''}>
                            <span>👥 用户管理</span>
                        </label>
                        <label class="perm-item">
                            <input type="checkbox" data-perm="prompts.manage" ${roleInfo.permissions?.includes('prompts.manage') ? 'checked' : ''}>
                            <span>🎨 Prompt 管理</span>
                        </label>
                        <label class="perm-item">
                            <input type="checkbox" data-perm="analytics.view" ${roleInfo.permissions?.includes('analytics.view') ? 'checked' : ''}>
                            <span>📊 数据分析</span>
                        </label>
                    </div>
                    <div class="perm-expiry">
                        <label>到期时间</label>
                        <input type="text" id="modalRoleExpiry" placeholder="日期和时间"
                            data-initial-value="${roleInfo.expires_at || ''}">
                    </div>
                    <button class="perm-save-btn" type="button" data-admin-action="users-save-modal-admin-permissions" data-user-id="${encodeURIComponent(user.id)}">
                        <i class="fas fa-save"></i> 保存权限
                    </button>
                </div>
            ` : ''}
        </div>
        ` : ''
        }
        `;

    // Initialize Flatpickr for expiry date after DOM is updated
    setTimeout(() => {
        const expiryInput = document.getElementById('modalRoleExpiry');
        if (expiryInput && typeof flatpickr !== 'undefined') {
            const initialValue = expiryInput.dataset.initialValue;
            const modalLeft = document.querySelector('.user-modal-left');
            flatpickr(expiryInput, {
                enableTime: true,
                dateFormat: 'Y-m-d H:i',
                locale: 'zh',
                time_24hr: true,
                defaultDate: initialValue ? new Date(initialValue) : null,
                minDate: 'today',
                disableMobile: true,
                appendTo: modalLeft || document.body,
                positionElement: expiryInput
            });
        }
    }, 100);
}

// Toggle modal dropdown
function toggleModalDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    dropdown.classList.toggle('open');

    // Close when clicking outside
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// Handle admin toggle in modal
function handleModalAdminToggle(userId, isEnabled) {
    const panel = document.getElementById('modalPermissionsPanel');
    if (panel) {
        panel.hidden = !isEnabled;
    }
    toggleAdminRole(userId, isEnabled);
}

// Save admin permissions from modal
async function saveModalAdminPermissions(userId) {
    const panel = document.getElementById('modalPermissionsPanel');
    const expiryInput = document.getElementById('modalRoleExpiry');

    if (!panel) return;

    const permissions = [];
    panel.querySelectorAll('input[data-perm]:checked').forEach(cb => {
        permissions.push(cb.dataset.perm);
    });

    const expiresAt = expiryInput?.value ? new Date(expiryInput.value).toISOString() : null;

    try {
        const { error } = await window.supabaseClient
            .from('admin_roles')
            .update({ permissions, expires_at: expiresAt })
            .eq('user_id', userId);

        if (error) throw error;
        alert('✅ 权限配置已保存');
    } catch (err) {
        console.error('Failed to save permissions:', err);
        alert('保存失败: ' + err.message);
    }
}

// Render Modal Actions
function renderModalActions(user) {
    const actionsPanel = document.getElementById('userModalActions');

    if (!window.hasPermission || !window.hasPermission('users.manage')) {
        actionsPanel.innerHTML = '';
        return;
    }

    actionsPanel.innerHTML = `
        <button class="modal-action-btn ${user.is_banned ? '' : 'danger'}" type="button" data-admin-action="users-toggle-block" data-user-id="${encodeURIComponent(user.id)}" data-user-banned="${user.is_banned ? '1' : '0'}">
            <i class="fas ${user.is_banned ? 'fa-unlock' : 'fa-ban'}"></i>
            ${user.is_banned ? '解除封禁' : '封禁用户'}
        </button>
        <button class="modal-action-btn" type="button" data-admin-action="users-adjust-points" data-user-id="${encodeURIComponent(user.id)}">
            <i class="fas fa-coins"></i> 调整积分
        </button>
        <button class="modal-action-btn" type="button" data-admin-action="users-reset-avatar" data-user-id="${encodeURIComponent(user.id)}">
            <i class="fas fa-user-circle"></i> 重置头像
        </button>
        <button class="modal-action-btn warning" type="button" data-admin-action="users-clear-content" data-user-id="${encodeURIComponent(user.id)}">
            <i class="fas fa-trash-alt"></i> 清空内容
        </button>
        <button class="modal-action-btn notifications-bell" type="button" data-admin-action="users-show-notification" data-user-id="${encodeURIComponent(user.id)}" title="发送系统通知">
            <i class="fas fa-bell"></i>
        </button>
    `;

}

// Switch Tab
function switchUserTab(tabName) {
    currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.user-tab-btn').forEach(btn => {
        const isActive = btn.dataset.tab === tabName;
        btn.classList.toggle('active', isActive);

        // Move indicator to active button
        if (isActive) {
            updateTabIndicator(btn);
        }
    });

    // Render tab content
    renderUserTab(tabName);
}

// Update Sliding Indicator Position
function updateTabIndicator(activeBtn) {
    const nav = document.querySelector('.user-tab-nav');
    const indicator = document.querySelector('.tab-indicator');

    if (nav && indicator && activeBtn) {
        indicator.style.setProperty('--users-tab-indicator-left', `${activeBtn.offsetLeft}px`);
        indicator.style.setProperty('--users-tab-indicator-width', `${activeBtn.offsetWidth}px`);
        indicator.style.setProperty('--users-tab-indicator-opacity', '1');
    }
}

// Render Tab Content
function renderUserTab(tabName) {
    const container = document.getElementById('userTabContent');
    // Switch Logic
    switch (tabName) {
        case 'ledger':
            renderLedgerTab(container);
            break;
        case 'activity':
            renderActivityTab(container);
            break;
        case 'notes':
            renderNotesTab(container);
            break;
        case 'audit':
            renderAuditTab(container);
            break;
        case 'blocks':
            renderBlocksTab(container);
            break;
        case 'affiliate':
            renderAffiliateTab(container);
            break;
        case 'relatives':
            renderRelatedTab(container);
            break;
    }
}

function buildUserTabToolbar(tabName, options = {}) {
    const {
        includeCustomDate = false,
        exportLabel = '导出 Excel'
    } = options;

    const baseRanges = [
        ['all', '全部时间'],
        ['today', '今天'],
        ['week', '本周'],
        ['month', '本月']
    ];

    return `
        <div class="tab-toolbar users-tab-toolbar">
            <div class="modal-dropdown" id="${tabName}TimeDropdown">
                <div class="modal-dropdown-trigger users-tab-date-trigger" data-admin-action="users-toggle-modal-dropdown" data-dropdown-id="${tabName}TimeDropdown">
                    <i class="far fa-calendar-alt"></i>
                    <span id="${tabName}TimeLabel">全部时间</span>
                    <i class="fas fa-chevron-down"></i>
                </div>
                <div class="modal-dropdown-menu">
                    ${baseRanges.map(([range, label]) => `
                        <div class="modal-dropdown-item" data-admin-action="users-filter-tab-date" data-user-tab-name="${tabName}" data-user-date-range="${range}" data-user-date-label="${label}">${label}</div>
                    `).join('')}
                    ${includeCustomDate ? `<div class="modal-dropdown-item" data-admin-action="users-open-custom-date-picker" data-user-tab-name="${tabName}">📅 自定义</div>` : ''}
                </div>
            </div>
            <button class="btn-export users-tab-export-btn" type="button" data-admin-action="users-export-tab-data" data-user-tab-name="${tabName}">
                <i class="fas fa-download"></i> ${exportLabel}
            </button>
        </div>
    `;
}

function buildUsersTabEmptyState(message) {
    return `<div class="empty-state users-tab-empty-state">${escapeHtml(message)}</div>`;
}

function buildUsersTabError(message) {
    return `<div class="error-msg users-tab-error">加载失败: ${escapeHtml(message)}</div>`;
}

// Render Ledger Tab
function renderLedgerTab(container) {
    const data = currentModalData.pointsLedger || [];

    container.innerHTML = `
        ${buildUserTabToolbar('ledger', { includeCustomDate: true })}
        <input type="text" id="ledgerDatePicker" class="users-hidden-date-picker" placeholder="选择日期范围">
        <div class="data-list" id="ledgerList">
            ${renderLedgerItems(data)}
        </div>
    `;
}

// Render ledger items helper
function renderLedgerItems(data) {
    if (data.length === 0) {
        return buildUsersTabEmptyState('暂无积分记录');
    }
    return data.map(record => {
        const meta = getAdminLedgerMeta(record);
        const normalizedAmount = normalizeAdminLedgerValue(record.amount);
        const recordId = encodeURIComponent(String(record.id || ''));
        const amountText = `${normalizedAmount >= 0 ? '+' : ''}${formatAdminPointValue(normalizedAmount)} 分`;
        const tone = getAdminUiTone(meta.accent);
        const referenceChip = meta.referenceLabel
            ? `<span class="admin-ledger-chip admin-ledger-chip-mono">${escapeHtml(meta.referenceLabel)}</span>`
            : '';

        return `
            <div class="data-list-item admin-ledger-item admin-ledger-item--${tone}" data-admin-action="users-open-ledger-detail" data-ledger-id="${recordId}">
                <div class="admin-ledger-icon admin-ledger-icon--${tone}">
                    <i class="fas ${meta.icon}"></i>
                </div>
                <div class="admin-ledger-main">
                    <div class="admin-ledger-topline">
                        <div class="admin-ledger-title-wrap">
                            <div class="admin-ledger-title">${escapeHtml(meta.title)}</div>
                            <div class="admin-ledger-subtitle">${escapeHtml(meta.subtitle)}</div>
                        </div>
                        <div class="admin-ledger-amount ${normalizedAmount >= 0 ? 'positive' : 'negative'}">${amountText}</div>
                    </div>
                    <div class="admin-ledger-meta-row">
                        <span class="admin-ledger-chip">${escapeHtml(meta.badge)}</span>
                        ${referenceChip}
                        <span class="admin-ledger-time">${escapeHtml(meta.timeLabel)}</span>
                    </div>
                </div>
                <i class="fas fa-chevron-right admin-ledger-arrow"></i>
            </div>
        `;
    }).join('');
}

function normalizeAdminLedgerValue(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.round(numericValue * 10) / 10 : fallback;
}

function truncateAdminLedgerText(value, head = 10, tail = 4) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= head + tail + 3) return text;
    return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function looksLikeAdminEmail(value = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(value || '').trim());
}

function extractAdminFirstUrl(text = '') {
    const match = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0] : '';
}

function parseAdminVerifyLogMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        return parsed?.kind === 'google_one_job' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function getAdminVerifyStatusMeta(status = '') {
    const normalized = String(status || '').trim().toLowerCase();

    if (normalized.includes('success') || normalized.includes('completed')) {
        return { text: '已完成', color: '#10b981' };
    }
    if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('timeout')) {
        return { text: '失败', color: '#ef4444' };
    }
    if (normalized.includes('queue') || normalized.includes('running') || normalized.includes('process') || normalized.includes('pending')) {
        return { text: '处理中', color: '#6b9ece' };
    }
    return { text: normalized || '未知', color: '#cbd5e1' };
}

function getAdminUiTone(color = '') {
    const normalized = String(color || '').trim().toLowerCase();
    const palette = new Map([
        ['#10b981', 'emerald'],
        ['#22c55e', 'emerald'],
        ['#34d399', 'emerald'],
        ['#38bdf8', 'sky'],
        ['#60a5fa', 'sky'],
        ['#6b9ece', 'sky'],
        ['#3b82f6', 'sky'],
        ['#8b5cf6', 'violet'],
        ['#a78bfa', 'violet'],
        ['#f59e0b', 'amber'],
        ['#f97316', 'amber'],
        ['#ec4899', 'pink'],
        ['#f472b6', 'pink'],
        ['#ef4444', 'danger'],
        ['#f87171', 'danger'],
        ['#fca5a5', 'danger'],
        ['#94a3b8', 'muted'],
        ['#cbd5e1', 'muted']
    ]);

    return palette.get(normalized) || 'muted';
}

function isAdminVerifyServiceReason(reason = '') {
    const normalized = String(reason || '').trim().toLowerCase();
    return normalized.includes('google one') && (
        normalized.includes('链接获取服务') ||
        normalized.includes('trial link') ||
        normalized.includes('link service') ||
        normalized.includes('verify service')
    );
}

function isAdminShopLedgerReason(reason = '', referenceId = '') {
    const normalizedReason = String(reason || '').trim().toLowerCase();
    const normalizedRef = String(referenceId || '').trim().toUpperCase();
    return normalizedReason.startsWith('商城购买:') ||
        normalizedReason.startsWith('shop purchase:') ||
        normalizedRef.startsWith('SHOP_ORDER_');
}

function getAdminShopOrderIdFromReference(referenceId = '') {
    const normalizedRef = String(referenceId || '').trim();
    if (!normalizedRef) return '';
    if (normalizedRef.startsWith('SHOP_ORDER_')) {
        return normalizedRef.slice('SHOP_ORDER_'.length);
    }
    return normalizedRef;
}

function isAdminAffiliateRewardReason(reason = '', referenceId = '') {
    const rawReason = String(reason || '').trim();
    const normalizedRef = String(referenceId || '').trim().toUpperCase();

    return rawReason.startsWith('推广返佣')
        || rawReason.startsWith('拉新固定奖励')
        || rawReason.startsWith('邀请拉新奖励')
        || normalizedRef.startsWith('AFFILIATE_REWARD_')
        || normalizedRef.startsWith('AFF_REW_')
        || normalizedRef.startsWith('REG_REWARD_');
}

function getAdminAffiliateRewardMeta(reason = '', referenceId = '') {
    const rawReason = String(reason || '').trim();
    const normalizedRef = String(referenceId || '').trim().toUpperCase();

    if (normalizedRef.startsWith('REG_REWARD_UNLOCK_RECHARGE_') || rawReason.includes('首充激活')) {
        return {
            rewardType: 'registration_reward',
            label: '邀请首充奖励',
            icon: 'fa-gift',
            color: '#34d399'
        };
    }

    if (normalizedRef.startsWith('REG_REWARD_UNLOCK_') || rawReason.includes('首单激活')) {
        return {
            rewardType: 'registration_reward',
            label: '邀请消费奖励',
            icon: 'fa-seedling',
            color: '#f59e0b'
        };
    }

    if (normalizedRef.startsWith('REG_REWARD_') || rawReason.startsWith('邀请拉新奖励')) {
        return {
            rewardType: 'registration_reward',
            label: '邀请注册奖励',
            icon: 'fa-user-check',
            color: '#8b5cf6'
        };
    }

    return {
        rewardType: 'commission',
        label: '推广返佣',
        icon: 'fa-share-nodes',
        color: '#38bdf8'
    };
}

function getAdminRechargeDisplayName(reason = '') {
    const rawReason = String(reason || '').trim();
    if (!rawReason) return '积分变动';
    if (rawReason === 'daily_checkin') return '每日签到';
    if (rawReason === 'makeup_checkin_cost') return '补签扣分';
    if (rawReason === 'signup_bonus' || rawReason === 'register_bonus') return '注册奖励';
    if (rawReason === 'custom_recharge') return '自定义充值';
    if (rawReason === 'package_purchase') return '充值';
    if (rawReason === 'afdian_recharge') return 'Afdian 充值';
    if (rawReason.startsWith('模拟充值:')) return rawReason.replace('模拟充值:', '').trim() || '充值';
    if (rawReason.startsWith('模拟充值：')) return rawReason.replace('模拟充值：', '').trim() || '充值';
    if (rawReason.startsWith('admin_manual:')) return '管理员调整';
    return rawReason;
}

function getAdminLedgerReasonText(reason = '', referenceId = '') {
    const rawReason = String(reason || '').trim();
    if (!rawReason) return '未记录';

    if (rawReason === 'daily_checkin') return '每日签到奖励发放';
    if (rawReason === 'makeup_checkin_cost') return '用户补签时扣除成本积分';
    if (rawReason === 'signup_bonus' || rawReason === 'register_bonus') return '用户注册成功后发放奖励积分';
    if (rawReason === 'unlock_prompt') {
        const promptTitle = referenceId && promptCache[referenceId] ? promptCache[referenceId] : '';
        return promptTitle ? `解锁提示词：${promptTitle}` : '解锁提示词并扣除对应积分';
    }
    if (rawReason === 'redeem_code' || rawReason.includes('兑换码')) return '兑换码兑换积分';
    if (rawReason === 'package_purchase' || rawReason === 'afdian_recharge' || rawReason === 'custom_recharge' || rawReason.startsWith('模拟充值:') || rawReason.startsWith('模拟充值：')) {
        return `${getAdminRechargeDisplayName(rawReason)}积分到账`;
    }
    if (rawReason.startsWith('admin_manual:')) {
        const parsed = parseAdminManualReason(rawReason);
        return `管理员调整积分：${parsed.note}`;
    }
    if (isAdminVerifyServiceReason(rawReason)) return 'Google One 验证服务扣分';
    return rawReason;
}

function getAdminReferenceMeta(detail) {
    const transactionType = String(detail?.meta?.transactionType || '').trim();

    switch (transactionType) {
        case 'prompt':
            return { label: '提示词编号', usage: '用于回溯本次解锁对应的提示词记录' };
        case 'shop':
            return { label: '关联订单号', usage: '用于回溯本次商城订单和商品内容' };
        case 'affiliate':
            return { label: '关联奖励号', usage: '用于回溯返佣对应的来源订单或奖励流水' };
        case 'verify':
            return { label: '验证任务号', usage: '用于回溯验证任务、状态和生成链接' };
        case 'recharge':
            return { label: '充值单号', usage: '用于回溯本次充值来源或支付批次' };
        case 'redeem':
            return { label: '兑换码编号', usage: '用于回溯本次兑换对应的兑换码或兑换批次' };
        case 'bonus':
            return { label: '关联批次号', usage: '用于标记这次系统奖励或扣分的来源批次' };
        case 'admin':
            return { label: '关联记录号', usage: '用于标记本次管理员调整关联的附加来源' };
        default:
            return { label: '关联编号', usage: '用于回溯这笔流水对应的来源记录' };
    }
}

function getAdminInviteeDisplay(detail = {}) {
    const inviteeId = String(detail.invitee_id || '').trim();
    const userRecord = inviteeId
        ? userState.users.find(user => String(user?.id || '').trim() === inviteeId)
        : null;
    const displayName = String(detail.invitee_name || detail.invitee_username || userRecord?.username || detail.invitee_masked_email || '匿名用户').trim();
    const email = String(userRecord?.email || detail.invitee_masked_email || '').trim();
    return email ? `${displayName} · ${email}` : displayName;
}

function parseAdminManualReason(reason = '') {
    const rawReason = String(reason || '').trim();
    const match = rawReason.match(/admin_manual:\s*\[(.*?)\]\s*(.*)/);
    if (match) {
        return {
            operator: String(match[1] || '').trim() || '管理员',
            note: String(match[2] || '').trim() || '未填写原因'
        };
    }

    return {
        operator: '管理员',
        note: rawReason.replace(/^admin_manual:\s*/i, '').trim() || '未填写原因'
    };
}

function getAdminLedgerMeta(record = {}) {
    const amount = normalizeAdminLedgerValue(record.amount);
    const reason = String(record.reason || '').trim();
    const referenceId = String(record.reference_id || '').trim();
    const timeLabel = record.created_at ? formatTimeAgo(record.created_at) : '刚刚';
    const shortReference = referenceId ? truncateAdminLedgerText(referenceId, 12, 6) : '';
    const isRechargeRecord =
        reason === 'package_purchase' ||
        reason === 'afdian_recharge' ||
        reason === 'custom_recharge' ||
        reason.startsWith('模拟充值:') ||
        reason.startsWith('模拟充值：');

    if (isRechargeRecord) {
        return {
            transactionType: 'recharge',
            title: getAdminRechargeDisplayName(reason),
            subtitle: referenceId ? `充值流水 ${shortReference}` : '积分充值记录',
            badge: '积分充值',
            referenceLabel: shortReference,
            icon: 'fa-wallet',
            accent: '#22c55e',
            timeLabel
        };
    }

    if (reason === 'daily_checkin') {
        return {
            transactionType: 'bonus',
            title: '每日签到',
            subtitle: '签到奖励记录',
            badge: '签到奖励',
            referenceLabel: shortReference,
            icon: 'fa-calendar-check',
            accent: '#38bdf8',
            timeLabel
        };
    }

    if (reason === 'makeup_checkin_cost') {
        return {
            transactionType: 'bonus',
            title: '补签扣分',
            subtitle: '补签成本记录',
            badge: '补签扣分',
            referenceLabel: shortReference,
            icon: 'fa-calendar-xmark',
            accent: '#f97316',
            timeLabel
        };
    }

    if (reason === 'signup_bonus' || reason === 'register_bonus') {
        return {
            transactionType: 'bonus',
            title: '注册奖励',
            subtitle: '新用户注册奖励记录',
            badge: '注册奖励',
            referenceLabel: shortReference,
            icon: 'fa-gift',
            accent: '#f472b6',
            timeLabel
        };
    }

    if (reason === 'unlock_prompt') {
        const promptTitle = referenceId && promptCache[referenceId] ? promptCache[referenceId] : `提示词 #${referenceId || '--'}`;
        return {
            transactionType: 'prompt',
            title: promptTitle,
            subtitle: '提示词解锁记录',
            badge: '提示词',
            referenceLabel: referenceId ? `Prompt ${truncateAdminLedgerText(referenceId, 8, 4)}` : '',
            icon: 'fa-lightbulb',
            accent: '#f59e0b',
            timeLabel
        };
    }

    if (isAdminVerifyServiceReason(reason)) {
        return {
            transactionType: 'verify',
            title: 'Google One 验证',
            subtitle: referenceId ? `任务 ${shortReference}` : '验证服务记录',
            badge: '验证服务',
            referenceLabel: shortReference,
            icon: 'fa-key',
            accent: '#60a5fa',
            timeLabel
        };
    }

    if (isAdminShopLedgerReason(reason, referenceId)) {
        const orderId = getAdminShopOrderIdFromReference(referenceId);
        const productName = reason
            .replace(/^商城购买[:：]\s*/i, '')
            .replace(/^shop purchase[:：]\s*/i, '')
            .trim() || '商城商品';
        return {
            transactionType: 'shop',
            title: productName,
            subtitle: orderId ? `订单 ${truncateAdminLedgerText(orderId, 8, 4)}` : '商城订单记录',
            badge: '商城订单',
            referenceLabel: orderId ? `Order ${truncateAdminLedgerText(orderId, 8, 4)}` : shortReference,
            icon: 'fa-bag-shopping',
            accent: amount >= 0 ? '#22c55e' : '#34d399',
            timeLabel
        };
    }

    if (isAdminAffiliateRewardReason(reason, referenceId)) {
        const rewardMeta = getAdminAffiliateRewardMeta(reason, referenceId);
        return {
            transactionType: 'affiliate',
            title: rewardMeta.label,
            subtitle: reason || '推广奖励流水',
            badge: '推广奖励',
            referenceLabel: shortReference,
            icon: rewardMeta.icon,
            accent: rewardMeta.color,
            timeLabel
        };
    }

    if (reason === 'redeem_code' || reason.includes('兑换码')) {
        return {
            transactionType: 'redeem',
            title: '兑换码兑换',
            subtitle: referenceId ? `兑换码 ${shortReference}` : '兑换记录',
            badge: '兑换码',
            referenceLabel: shortReference,
            icon: 'fa-ticket',
            accent: '#f472b6',
            timeLabel
        };
    }

    if (reason.startsWith('admin_manual:')) {
        const match = reason.match(/admin_manual:\[(.*?)\]\s*(.*)/);
        return {
            transactionType: 'admin',
            title: match?.[2] || '管理员调整',
            subtitle: match?.[1] ? `操作者 ${match[1]}` : '管理员手动调整',
            badge: '管理员',
            referenceLabel: shortReference,
            icon: 'fa-user-shield',
            accent: '#a78bfa',
            timeLabel
        };
    }

    return {
        transactionType: amount >= 0 ? 'income' : 'expense',
        title: getAdminRechargeDisplayName(reason),
        subtitle: reason || '积分流水记录',
        badge: amount >= 0 ? '入账' : '支出',
        referenceLabel: shortReference,
        icon: amount >= 0 ? 'fa-circle-plus' : 'fa-circle-minus',
        accent: amount >= 0 ? '#10b981' : '#ef4444',
        timeLabel
    };
}

function renderAdminLedgerDetailRows(rows = []) {
    return rows.filter(row => row && row.value !== undefined && row.value !== null && row.value !== '').map(row => `
        <div class="admin-ledger-detail-row">
            <span class="admin-ledger-detail-label">${escapeHtml(row.label)}</span>
            <span class="admin-ledger-detail-value ${row.mono ? 'mono' : ''}${row.color ? ` admin-ledger-detail-value--${getAdminUiTone(row.color)}` : ''}">${escapeHtml(String(row.value))}</span>
        </div>
    `).join('');
}

function renderAdminLedgerContentCards(items = []) {
    if (!items.length) return '';
    return `
        <div class="admin-ledger-content-grid">
            ${items.map((item, index) => `
                <div class="admin-ledger-content-card">
                    <div class="admin-ledger-content-head">
                        <strong>${escapeHtml(item.title || `内容 ${index + 1}`)}</strong>
                        ${item.copyText ? `<button class="admin-ledger-copy-btn" data-copy-text="${encodeURIComponent(item.copyText)}">复制</button>` : ''}
                    </div>
                    <pre>${escapeHtml(item.content || '--')}</pre>
                </div>
            `).join('')}
        </div>
    `;
}

async function fetchAdminLedgerDetail(record) {
    const meta = getAdminLedgerMeta(record);
    const detail = {
        record,
        meta,
        amount: normalizeAdminLedgerValue(record.amount),
        reason: String(record.reason || ''),
        referenceId: String(record.reference_id || ''),
        createdAt: record.created_at,
        prompt: null,
        shop: null,
        affiliate: null,
        verify: null
    };

    try {
        if (meta.transactionType === 'prompt' && detail.referenceId) {
            const promptId = Number(detail.referenceId);
            if (Number.isFinite(promptId)) {
                const { data } = await window.supabaseClient
                    .from('prompts')
                    .select('id, title, description, prompt, tags, author_name, created_at')
                    .eq('id', promptId)
                    .maybeSingle();
                detail.prompt = data || null;
            }
        } else if (meta.transactionType === 'shop') {
            const orderId = getAdminShopOrderIdFromReference(detail.referenceId);
            if (orderId) {
                const [orderResult, itemsResult] = await Promise.all([
                    window.supabaseClient
                        .from('shop_orders')
                        .select('*')
                        .eq('id', orderId)
                        .maybeSingle(),
                    window.supabaseClient
                        .from('shop_order_items')
                        .select(`
                            id,
                            snapshot_product_name,
                            price_paid,
                            shop_inventory ( content )
                        `)
                        .eq('order_id', orderId)
                ]);

                detail.shop = {
                    order: orderResult.data || null,
                    items: (itemsResult.data || []).map(item => ({
                        name: item.snapshot_product_name || '未知商品',
                        price: normalizeAdminLedgerValue(item.price_paid),
                        content: item.shop_inventory?.content || ''
                    }))
                };
            }
        } else if (meta.transactionType === 'affiliate' && currentModalUser?.id) {
            const { data } = await window.supabaseClient.rpc('fn_get_affiliate_reward_detail', {
                p_user_id: currentModalUser.id,
                p_ledger_id: record.id
            });
            if (data && data.found !== false) {
                detail.affiliate = data;
            }
        } else if (meta.transactionType === 'verify' && detail.referenceId) {
            const { data } = await window.supabaseClient
                .from('verification_logs')
                .select('verification_id, status, message, points_deducted, created_at')
                .eq('verification_id', detail.referenceId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (Array.isArray(data) && data.length > 0) {
                const verifyLog = data[0];
                const payload = parseAdminVerifyLogMessage(verifyLog.message) || {};
                detail.verify = {
                    ...verifyLog,
                    payload,
                    email: String(payload.email || (looksLikeAdminEmail(detail.referenceId) ? detail.referenceId : '')).trim(),
                    jobId: String(payload.job_id || (!looksLikeAdminEmail(detail.referenceId) ? detail.referenceId : '')).trim(),
                    url: String(payload.url || extractAdminFirstUrl(verifyLog.message) || '').trim()
                };
            }
        }
    } catch (error) {
        console.warn('Failed to fetch ledger detail:', error);
        detail.error = error.message || '详情加载失败';
    }

    return detail;
}

function bindAdminLedgerDetailInteractions(overlay) {
    overlay.querySelectorAll('.admin-ledger-copy-btn').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const encoded = button.getAttribute('data-copy-text');
            if (!encoded) return;
            const text = decodeURIComponent(encoded);
            navigator.clipboard.writeText(text).then(() => {
                const originalText = button.textContent;
                button.textContent = '已复制';
                setTimeout(() => {
                    button.textContent = originalText;
                }, 1200);
            }).catch(() => {
                button.textContent = '复制失败';
            });
        });
    });
}

function renderAdminLedgerDetailModal(detail) {
    const referenceMeta = getAdminReferenceMeta(detail);
    const humanizedReason = getAdminLedgerReasonText(detail.reason, detail.referenceId);
    const amountText = `${detail.amount >= 0 ? '+' : ''}${formatAdminPointValue(detail.amount)} 分`;
    const summaryRows = [
        { label: '流水编号', value: String(detail.record.id || '') },
        { label: '交易类型', value: detail.meta.badge },
        { label: '变动时间', value: formatAdminDateTime(detail.createdAt) },
        { label: '积分变动', value: amountText, color: detail.amount >= 0 ? '#34d399' : '#f87171' },
        { label: referenceMeta.label, value: detail.referenceId || '无', mono: !!detail.referenceId },
        { label: '关联用途', value: referenceMeta.usage },
        { label: '原因说明', value: humanizedReason }
    ];

    let extraSections = '';

    if (detail.prompt) {
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">提示词详情</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '标题', value: detail.prompt.title || '未命名提示词' },
                        { label: '作者', value: detail.prompt.author_name || '未知' },
                        { label: '创建时间', value: formatAdminDateTime(detail.prompt.created_at) },
                        { label: '标签', value: Array.isArray(detail.prompt.tags) && detail.prompt.tags.length ? detail.prompt.tags.join(' / ') : '无' }
                    ])}
                </div>
                ${renderAdminLedgerContentCards(detail.prompt.prompt ? [{
            title: '提示词内容',
            content: detail.prompt.prompt,
            copyText: detail.prompt.prompt
        }] : [])}
            </section>
        `;
    }

    if (detail.shop?.order || (detail.shop?.items || []).length) {
        const order = detail.shop.order || {};
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">商城订单详情</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '订单编号', value: order.id || getAdminShopOrderIdFromReference(detail.referenceId) || '未找到', mono: true },
                        { label: '订单状态', value: order.status || '已完成' },
                        { label: '下单时间', value: formatAdminDateTime(order.created_at || detail.createdAt) },
                        { label: '订单金额', value: `${formatAdminPointValue(order.total_price ?? order.price_paid ?? Math.abs(detail.amount))} 分` }
                    ])}
                </div>
                ${renderAdminLedgerContentCards((detail.shop.items || []).map((item, index) => ({
            title: `${item.name || `商品 ${index + 1}`} · ${formatAdminPointValue(item.price)} 分`,
            content: item.content || '该商品没有内容快照或是接口型商品',
            copyText: item.content || ''
        })))}
            </section>
        `;
    }

    if (detail.affiliate) {
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">推广奖励详情</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '奖励类型', value: detail.affiliate.reward_label || detail.meta.title },
                        { label: '来源阶段', value: detail.affiliate.source_stage || detail.affiliate.reward_reason || '未记录' },
                        { label: '被邀请人', value: getAdminInviteeDisplay(detail.affiliate) },
                        { label: '来源对象', value: detail.affiliate.source_name || detail.affiliate.source_reason || '未命名记录' },
                        { label: '来源金额', value: `${formatAdminPointValue(detail.affiliate.source_amount || 0)} 分` },
                        { label: '配置比例', value: detail.affiliate.declared_commission_rate ? formatAdminPercentValue(detail.affiliate.declared_commission_rate) : '未记录' },
                        { label: '实际到账比例', value: detail.affiliate.commission_rate ? formatAdminPercentValue(detail.affiliate.commission_rate) : '未记录' },
                        { label: '按配置应返', value: detail.affiliate.expected_reward_amount ? `${formatAdminPointValue(detail.affiliate.expected_reward_amount)} 分` : '未记录' }
                    ])}
                </div>
            </section>
        `;
    }

    if (detail.verify) {
        const verifyStatus = getAdminVerifyStatusMeta(detail.verify.status || detail.verify.payload?.raw_status || '');
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">验证服务详情</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '验证编号', value: detail.verify.verification_id || detail.referenceId || '未记录', mono: true },
                        { label: '状态', value: verifyStatus.text, color: verifyStatus.color },
                        { label: '账号邮箱', value: detail.verify.email || '未记录' },
                        { label: '任务编号', value: detail.verify.jobId || '未记录', mono: !!detail.verify.jobId },
                        { label: '完成时间', value: formatAdminDateTime(detail.verify.created_at || detail.createdAt) },
                        { label: '扣除积分', value: `${formatAdminPointValue(detail.verify.points_deducted || Math.abs(detail.amount))} 分` }
                    ])}
                </div>
                ${detail.verify.url ? renderAdminLedgerContentCards([{
            title: '生成链接',
            content: detail.verify.url,
            copyText: detail.verify.url
        }]) : ''}
            </section>
        `;
    }

    if (detail.meta.transactionType === 'recharge') {
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">充值详情</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '充值类型', value: detail.meta.title || getAdminRechargeDisplayName(detail.reason) },
                        { label: '到账状态', value: '已完成', color: '#34d399' },
                        { label: '到账时间', value: formatAdminDateTime(detail.createdAt) },
                        { label: '到账积分', value: `${detail.amount >= 0 ? '+' : ''}${formatAdminPointValue(detail.amount)} 分`, color: detail.amount >= 0 ? '#34d399' : '#f87171' },
                        { label: '充值单号', value: detail.referenceId || '未记录', mono: !!detail.referenceId },
                        { label: '备注', value: detail.reason || '系统充值流水' }
                    ])}
                </div>
            </section>
        `;
    }

    if (detail.meta.transactionType === 'redeem') {
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">兑换详情</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '兑换状态', value: '已完成', color: '#34d399' },
                        { label: '兑换时间', value: formatAdminDateTime(detail.createdAt) },
                        { label: '获得积分', value: `${detail.amount >= 0 ? '+' : ''}${formatAdminPointValue(detail.amount)} 分`, color: detail.amount >= 0 ? '#34d399' : '#f87171' },
                        { label: '兑换码 / 关联号', value: detail.referenceId || '未记录', mono: !!detail.referenceId },
                        { label: '流水说明', value: humanizedReason }
                    ])}
                </div>
            </section>
        `;
    }

    if (detail.meta.transactionType === 'admin') {
        const adminManualMeta = parseAdminManualReason(detail.reason);
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">管理员调整详情</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '操作人', value: adminManualMeta.operator },
                        { label: '调整时间', value: formatAdminDateTime(detail.createdAt) },
                        { label: '积分变动', value: `${detail.amount >= 0 ? '+' : ''}${formatAdminPointValue(detail.amount)} 分`, color: detail.amount >= 0 ? '#34d399' : '#f87171' },
                        { label: '调整原因', value: adminManualMeta.note },
                        { label: '关联记录号', value: detail.referenceId || '无', mono: !!detail.referenceId }
                    ])}
                </div>
            </section>
        `;
    }

    if (detail.meta.transactionType === 'bonus') {
        const sectionTitle = detail.amount >= 0 ? '奖励详情' : '扣分详情';
        const descriptionLabel = detail.amount >= 0 ? '奖励说明' : '扣分说明';
        extraSections += `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">${sectionTitle}</div>
                <div class="admin-ledger-detail-grid">
                    ${renderAdminLedgerDetailRows([
                        { label: '奖励类型', value: detail.meta.title || '积分奖励' },
                        { label: '处理时间', value: formatAdminDateTime(detail.createdAt) },
                        { label: '积分变动', value: `${detail.amount >= 0 ? '+' : ''}${formatAdminPointValue(detail.amount)} 分`, color: detail.amount >= 0 ? '#34d399' : '#f87171' },
                        { label: '状态', value: detail.amount >= 0 ? '已发放' : '已扣除', color: detail.amount >= 0 ? '#34d399' : '#f59e0b' },
                        { label: descriptionLabel, value: humanizedReason }
                    ])}
                </div>
            </section>
        `;
    }

    if (!extraSections && detail.error) {
        extraSections = `
            <section class="admin-ledger-section">
                <div class="admin-ledger-section-title">详情加载提示</div>
                <div class="admin-ledger-note">${escapeHtml(detail.error)}</div>
            </section>
        `;
    }

    return `
        <div class="admin-ledger-modal">
            <div class="admin-ledger-modal-header">
                <div>
                    <div class="admin-ledger-modal-title">${escapeHtml(detail.meta.title)}</div>
                    <div class="admin-ledger-modal-subtitle">${escapeHtml(detail.meta.subtitle)}</div>
                </div>
                <button class="modal-close-btn" type="button" data-admin-action="users-close-ledger-detail">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="admin-ledger-modal-body">
                <section class="admin-ledger-section">
                    <div class="admin-ledger-section-title">流水摘要</div>
                    <div class="admin-ledger-detail-grid">
                        ${renderAdminLedgerDetailRows(summaryRows)}
                    </div>
                </section>
                ${extraSections}
            </div>
        </div>
    `;
}

async function openAdminLedgerDetail(ledgerId) {
    const record = (currentModalData.pointsLedger || []).find(item => String(item.id) === String(ledgerId));
    if (!record) return;

    closeAdminLedgerDetailModal();

    const overlay = document.createElement('div');
    overlay.id = 'adminLedgerDetailOverlay';
    overlay.className = 'admin-ledger-modal-overlay';
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeAdminLedgerDetailModal();
        }
    });

    overlay.innerHTML = `
        <div class="admin-ledger-modal admin-ledger-modal-loading">
            <div class="modal-loading"><i class="fas fa-spinner fa-spin"></i> 加载流水详情...</div>
        </div>
    `;
    document.body.appendChild(overlay);

    if (!currentModalData.ledgerDetails) {
        currentModalData.ledgerDetails = {};
    }

    let detail = currentModalData.ledgerDetails[ledgerId];
    if (!detail) {
        detail = await fetchAdminLedgerDetail(record);
        currentModalData.ledgerDetails[ledgerId] = detail;
    }

    if (!document.getElementById('adminLedgerDetailOverlay')) return;

    overlay.innerHTML = renderAdminLedgerDetailModal(detail);
    bindAdminLedgerDetailInteractions(overlay);
}

function closeAdminLedgerDetailModal() {
    document.getElementById('adminLedgerDetailOverlay')?.remove();
}

window.openAdminLedgerDetail = openAdminLedgerDetail;
window.closeAdminLedgerDetailModal = closeAdminLedgerDetailModal;

// Filter tab data by date
function filterTabByDate(tabName, range, label) {
    // Update label
    const labelEl = document.getElementById(`${tabName}TimeLabel`);
    if (labelEl) labelEl.textContent = label;

    // Close dropdown
    document.getElementById(`${tabName}TimeDropdown`)?.classList.remove('open');

    // Filter data
    let data = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (tabName) {
        case 'ledger':
            data = currentModalData.pointsLedger || [];
            break;
        case 'activity':
            data = currentModalData.contentLog || [];
            break;
        case 'blocks':
            data = currentModalData.blockHistory || [];
            break;
        case 'blocks':
            data = currentModalData.blockHistory || [];
            break;
        case 'notes':
            data = currentModalData.notes || [];
            break;
        case 'audit':
            data = currentModalData.auditLogs || [];
            break;
    }

    if (range !== 'all') {
        let cutoff;
        switch (range) {
            case 'today':
                cutoff = today;
                break;
            case 'week':
                cutoff = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                cutoff = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
        }
        data = data.filter(item => new Date(item.created_at) >= cutoff);
    }

    // Re-render list
    const listEl = document.getElementById(`${tabName}List`);
    if (listEl) {
        switch (tabName) {
            case 'ledger':
                listEl.innerHTML = renderLedgerItems(data);
                break;
            case 'activity':
                listEl.innerHTML = renderActivityItems(data);
                break;
            case 'blocks':
                listEl.innerHTML = renderBlocksItems(data);
                break;
            case 'notes':
                listEl.innerHTML = renderNotesItems(data);
                break;
            case 'audit':
                listEl.innerHTML = renderAuditItems(data);
                break;
        }
    }
}

// Open custom date picker
function openCustomDatePicker(tabName) {
    document.getElementById(`${tabName}TimeDropdown`)?.classList.remove('open');

    const pickerEl = document.getElementById(`${tabName}DatePicker`);
    if (!pickerEl) return;

    // Destroy previous instance if any
    if (pickerEl._flatpickr) {
        pickerEl._flatpickr.destroy();
    }

    // Get dropdown for positioning reference
    const dropdown = document.getElementById(`${tabName}TimeDropdown`);
    const dropdownTrigger = dropdown ? dropdown.querySelector('.modal-dropdown-trigger') : null;

    // Position calendar function
    function positionCalendar(instance) {
        if (!instance.calendarContainer) return;

        // Use requestAnimationFrame to ensure we run after Flatpickr's own positioning
        requestAnimationFrame(() => {
            const targetEl = dropdownTrigger || dropdown;
            if (targetEl) {
                const rect = targetEl.getBoundingClientRect();

                // Force fixed positioning relative to viewport
                Object.assign(instance.calendarContainer.style, {
                    position: 'fixed',
                    top: `${rect.bottom + 4}px`,
                    left: `${rect.left}px`,
                    display: 'block',
                    visibility: 'visible',
                    opacity: '1'
                });
                // Force max z-index separately to ensure it applies
                instance.calendarContainer.style.setProperty('z-index', '2147483647', 'important');
            }
        });
    }

    // Initialize Flatpickr with positioning callbacks
    const fp = flatpickr(pickerEl, {
        mode: 'range',
        locale: 'zh',
        dateFormat: 'Y-m-d',
        appendTo: document.body, // Always append to body to avoid stacking context issues
        clickOpens: false, // We open it manually
        onReady: (selectedDates, dateStr, instance) => positionCalendar(instance),
        onOpen: (selectedDates, dateStr, instance) => positionCalendar(instance),
        onClose: (selectedDates, dateStr, instance) => {
            if (selectedDates.length === 2) {
                const [start, end] = selectedDates;
                const labelEl = document.getElementById(`${tabName}TimeLabel`);
                if (labelEl) labelEl.textContent = `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;

                // Get source data based on tab
                let data = [];
                switch (tabName) {
                    case 'ledger':
                        data = currentModalData.pointsLedger || [];
                        break;
                    case 'activity':
                        data = currentModalData.contentLog || [];
                        break;
                    case 'blocks':
                        data = currentModalData.blockHistory || [];
                        break;
                }

                // Filter by custom range
                data = data.filter(item => {
                    const d = new Date(item.created_at);
                    return d >= start && d <= new Date(end.getTime() + 86400000);
                });

                // Re-render
                const listEl = document.getElementById(`${tabName}List`);
                if (listEl) {
                    switch (tabName) {
                        case 'ledger':
                            listEl.innerHTML = renderLedgerItems(data);
                            break;
                        case 'activity':
                            listEl.innerHTML = renderActivityItems(data);
                            break;
                        case 'blocks':
                            listEl.innerHTML = renderBlocksItems(data);
                            break;
                    }
                }
            }
            // Cleanup flatpickr instance after selection  
            setTimeout(() => {
                if (instance) instance.destroy();
            }, 100);
        }
    });

    fp.open();
}

// Render Activity Tab
function renderActivityTab(container) {
    const data = currentModalData.contentLog || [];

    container.innerHTML = `
        ${buildUserTabToolbar('activity', { includeCustomDate: true })}
        <input type="text" id="activityDatePicker" class="users-hidden-date-picker" placeholder="选择日期范围">
        <div class="data-list" id="activityList">
            ${renderActivityItems(data)}
        </div>
    `;
}

// Render activity items helper
function renderActivityItems(data) {
    if (data.length === 0) {
        return buildUsersTabEmptyState('暂无内容记录');
    }
    return data.map(item => `
        <div class="data-list-item">
            <div class="users-tab-item-icon users-tab-item-icon-info">
                <i class="fas ${item.type === 'comment' ? 'fa-comment' : 'fa-book'} users-tab-item-icon-glyph"></i>
            </div>
            <div class="users-tab-item-main">
                <div class="users-tab-item-title">${escapeHtml(item.content.substring(0, 80))}${item.content.length > 80 ? '...' : ''}</div>
                <div class="users-tab-item-subtitle">${escapeHtml(String(item.source || '-'))} · ${formatTimeAgo(item.created_at)}</div>
            </div>
        </div>
    `).join('');
}

// Render Blocks Tab
function renderBlocksTab(container) {
    const data = currentModalData.blockHistory || [];

    container.innerHTML = `
        ${buildUserTabToolbar('blocks', { includeCustomDate: true })}
        <input type="text" id="blocksDatePicker" class="users-hidden-date-picker" placeholder="选择日期范围">
        <div class="data-list" id="blocksList">
            ${renderBlocksItems(data)}
        </div>
    `;
}

// Render blocks items helper
function renderBlocksItems(data) {
    if (data.length === 0) {
        return buildUsersTabEmptyState('无封禁记录');
    }
    return data.map(record => `
        <div class="data-list-item users-block-item ${record.action === 'block' ? 'is-block' : 'is-unblock'}">
            <div class="users-tab-item-icon ${record.action === 'block' ? 'users-tab-item-icon-danger' : 'users-tab-item-icon-success'}">
                <i class="fas ${record.action === 'block' ? 'fa-ban' : 'fa-unlock'} users-tab-item-icon-glyph"></i>
            </div>
            <div class="users-tab-item-main">
                <div class="users-tab-item-title">${record.action === 'block' ? '封禁' : '解封'} - ${record.scope === 'all' ? '全站' : record.scope}</div>
                <div class="users-tab-item-subtitle">${escapeHtml(record.reason || '无备注')} · ${formatTimeAgo(record.created_at)}</div>
            </div>
        </div>
    `).join('');
}

// Render Related Accounts Tab
function renderRelatedTab(container) {
    const data = currentModalData.relatedAccounts || [];

    container.innerHTML = `
        <div class="data-list">
            ${data.length > 0 ? data.map(acc => `
                <div class="data-list-item users-related-item" data-admin-action="users-open-user-modal" data-user-id="${encodeURIComponent(acc.related_user_id)}">
                    <div class="users-related-avatar">
                        <i class="fas fa-user-circle users-related-avatar-icon"></i>
                    </div>
                    <div class="users-tab-item-main">
                        <div class="users-related-title">${escapeHtml(acc.related_username || 'Unknown')}</div>
                        <div class="users-tab-item-subtitle">共享 IP: ${escapeHtml(acc.shared_ip || '-')}</div>
                    </div>
                    <i class="fas fa-chevron-right users-related-arrow"></i>
                </div>
            `).join('') : buildUsersTabEmptyState('未检测到关联账号')}
        </div>
    `;
}

function renderAffiliateTab(container) {
    const affiliateState = currentModalData.affiliate || createEmptyAffiliateModalState();
    currentModalData.affiliate = affiliateState;

    if (!currentModalUser?.id) {
        container.innerHTML = buildUsersTabEmptyState('未找到用户');
        return;
    }

    if (!affiliateState.loaded && !affiliateState.loading) {
        container.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i> 加载推广数据...</div>';
        ensureAffiliateModalData(currentModalUser.id);
        return;
    }

    if (affiliateState.loading) {
        container.innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i> 加载推广数据...</div>';
        return;
    }

    if (affiliateState.error) {
        container.innerHTML = `
            <div class="empty-state users-affiliate-error-state">
                <div class="users-affiliate-error-title">推广数据加载失败</div>
                <div class="users-affiliate-error-message">${escapeHtml(affiliateState.error)}</div>
                <button class="btn-export" type="button" data-admin-action="users-reload-affiliate">
                    <i class="fas fa-rotate-right"></i> 重新加载
                </button>
            </div>
        `;
        return;
    }

    const stats = affiliateState.stats || {};
    const members = normalizeAffiliateMembers(stats.members || []);
    const rewards = Array.isArray(affiliateState.rewards) ? affiliateState.rewards : [];

    const inviteCode = typeof stats.invite_code === 'string' ? stats.invite_code.trim() : '';
    const inviteLink = inviteCode ? `${window.location.origin}/?ref=${encodeURIComponent(inviteCode)}` : '';
    const totalRewards = Number(stats.total_rewards || stats.total_commission || 0);
    const totalOrderCommission = Number(stats.total_order_commission || 0);
    const totalRegistrationRewards = Number(stats.total_registration_rewards || 0);
    const totalInviteeSpend = Number(stats.total_invitee_spend || 0);
    const invitedCount = Number(stats.invited_count || 0);
    const firstRechargeCount = Number(stats.first_recharge_count || 0);
    const consumedCount = Number(stats.consumed_count || 0);
    const pendingRewardCount = Number(stats.pending_reward_count || 0);
    const rechargeRate = invitedCount > 0 ? (firstRechargeCount / invitedCount) * 100 : 0;
    const consumeRate = invitedCount > 0 ? (consumedCount / invitedCount) * 100 : 0;

    container.innerHTML = `
        <div class="affiliate-admin-shell">
            <section class="affiliate-admin-link-strip">
                <div class="affiliate-admin-link-card affiliate-admin-link-card--wide">
                    <div class="affiliate-admin-link-copy">
                        <div class="affiliate-admin-link-label">推广链接</div>
                        <div class="affiliate-admin-link-value">${escapeHtml(inviteLink || '暂未生成推广链接')}</div>
                    </div>
                    <button class="btn-export affiliate-admin-export-btn" type="button" data-admin-action="users-export-tab-data" data-user-tab-name="affiliate">
                        <i class="fas fa-download"></i> 导出推广记录
                    </button>
                </div>
            </section>

            <section class="affiliate-admin-stats">
                <article class="affiliate-admin-stat-card">
                    <span class="stat-label">累计推广奖励</span>
                    <strong>${formatAdminPointValue(totalRewards)}</strong>
                    <span class="stat-meta">订单返佣 ${formatAdminPointValue(totalOrderCommission)} · 拉新奖励 ${formatAdminPointValue(totalRegistrationRewards)}</span>
                </article>
                <article class="affiliate-admin-stat-card">
                    <span class="stat-label">邀请人数</span>
                    <strong>${invitedCount}</strong>
                    <span class="stat-meta">首充 ${firstRechargeCount} · 已消费 ${consumedCount}</span>
                </article>
                <article class="affiliate-admin-stat-card">
                    <span class="stat-label">累计邀请消费</span>
                    <strong>${formatAdminPointValue(totalInviteeSpend)}</strong>
                    <span class="stat-meta">待激活奖励 ${pendingRewardCount} 笔</span>
                </article>
                <article class="affiliate-admin-stat-card">
                    <span class="stat-label">转化效率</span>
                    <strong>${formatAdminPercentValue(consumeRate)}</strong>
                    <span class="stat-meta">首充转化 ${formatAdminPercentValue(rechargeRate)}</span>
                </article>
            </section>

            <div class="affiliate-admin-grid">
                <section class="affiliate-admin-panel">
                    <div class="affiliate-admin-panel-head">
                        <div>
                            <h4>邀请成员</h4>
                            <p>先看当前阶段和贡献概览，展开后再看注册、首充、首单消费与奖励构成。</p>
                        </div>
                        <div class="affiliate-admin-panel-meta">${members.length} 位成员</div>
                    </div>
                    <div class="affiliate-admin-members">
                        ${members.length ? members.map((member, index) => {
        const stageMeta = member.stageMeta || getAffiliateMemberStageMeta(member);
        const displayName = member.display_name || member.username || member.masked_email || '新用户';
        const subline = member.masked_email || member.username || '未绑定邮箱';
        const rewardStatus = member.reward_status || (member.registration_reward_pending > 0 ? '待激活' : '已发放');
        return `
                            <details class="affiliate-admin-member" ${index < 3 ? 'open' : ''}>
                                <summary>
                                    <div class="affiliate-admin-member-main">
                                        <div class="affiliate-admin-member-title-row">
                                            <strong>${escapeHtml(displayName)}</strong>
                                            <span class="affiliate-admin-stage ${stageMeta.className}">${stageMeta.label}</span>
                                        </div>
                                        <div class="affiliate-admin-member-sub">${escapeHtml(subline)}</div>
                                        <div class="affiliate-admin-member-chip-row">
                                            <span class="affiliate-admin-mini-chip">贡献 ${formatAdminPointValue(member.total_spend)} 分</span>
                                            <span class="affiliate-admin-mini-chip">返佣 ${formatAdminPointValue(member.commission_earned)} 分</span>
                                            <span class="affiliate-admin-mini-chip">拉新 ${formatAdminPointValue(member.registration_reward_granted || member.registration_reward_pending)} 分</span>
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-down"></i>
                                </summary>
                                <div class="affiliate-admin-member-body">
                                    <div class="affiliate-admin-member-grid">
                                        <div class="affiliate-admin-detail-card">
                                            <span class="label">注册时间</span>
                                            <strong>${formatAdminDateTime(member.registered_at)}</strong>
                                            <span class="meta">${escapeHtml(stageMeta.hint)}</span>
                                        </div>
                                        <div class="affiliate-admin-detail-card">
                                            <span class="label">首充时间</span>
                                            <strong>${formatAdminDateTime(member.first_recharge_at)}</strong>
                                            <span class="meta">奖励状态：${escapeHtml(rewardStatus)}</span>
                                        </div>
                                        <div class="affiliate-admin-detail-card">
                                            <span class="label">首单消费</span>
                                            <strong>${formatAdminDateTime(member.first_purchase_at)}</strong>
                                            <span class="meta">订单数 ${Number(member.paid_order_count || 0)}</span>
                                        </div>
                                        <div class="affiliate-admin-detail-card">
                                            <span class="label">最近订单</span>
                                            <strong>${escapeHtml(member.last_order_name || '暂无订单')}</strong>
                                            <span class="meta">${formatAdminPointValue(member.last_order_amount || 0)} 分 · ${formatAdminDateTime(member.last_order_at)}</span>
                                        </div>
                                    </div>
                                    <div class="affiliate-admin-metrics-row">
                                        <div class="metric">
                                            <span>累计消费</span>
                                            <strong>${formatAdminPointValue(member.total_spend)}</strong>
                                        </div>
                                        <div class="metric">
                                            <span>订单返佣</span>
                                            <strong>${formatAdminPointValue(member.commission_earned)}</strong>
                                        </div>
                                        <div class="metric">
                                            <span>拉新奖励已发</span>
                                            <strong>${formatAdminPointValue(member.registration_reward_granted)}</strong>
                                        </div>
                                        <div class="metric">
                                            <span>待激活奖励</span>
                                            <strong>${formatAdminPointValue(member.registration_reward_pending)}</strong>
                                        </div>
                                        <div class="metric">
                                            <span>总贡献奖励</span>
                                            <strong>${formatAdminPointValue(member.total_rewards)}</strong>
                                        </div>
                                    </div>
                                </div>
                            </details>
                        `;
    }).join('') : '<div class="empty-state">该用户暂时还没有邀请到任何成员。</div>'}
                    </div>
                </section>

                <section class="affiliate-admin-panel">
                    <div class="affiliate-admin-panel-head">
                        <div>
                            <h4>奖励记录</h4>
                            <p>默认折叠显示，点击某条奖励后再查看来源对象、比例和到账明细。</p>
                        </div>
                        <div class="affiliate-admin-panel-meta">${rewards.length} 条记录</div>
                    </div>
                    <div class="affiliate-admin-rewards">
                        ${rewards.length ? rewards.map(reward => {
        const rewardAmount = Number(reward.reward_amount || 0);
        const declaredRate = Number(reward.declared_commission_rate || 0);
        const actualRate = Number(reward.commission_rate || 0);
        const expectedAmount = Number(reward.expected_reward_amount || 0);
        const rateMismatch = declaredRate > 0 && expectedAmount > 0 && Math.abs(expectedAmount - rewardAmount) >= 0.1;
        return `
                            <details class="affiliate-admin-reward-card ${rateMismatch ? 'has-warning' : ''}">
                                <summary>
                                    <div class="affiliate-admin-reward-top">
                                        <div>
                                            <span class="reward-type">${escapeHtml(reward.reward_label || '推广奖励')}</span>
                                            <h5>${escapeHtml(reward.invitee_name || reward.invitee_username || '匿名用户')}</h5>
                                            <div class="reward-sub">${escapeHtml(reward.source_stage || reward.reward_reason || '未知来源')} · ${formatAdminDateTime(reward.reward_created_at)}</div>
                                        </div>
                                        <div class="affiliate-admin-reward-side">
                                            <div class="reward-amount ${rewardAmount >= 0 ? 'positive' : 'negative'}">${rewardAmount >= 0 ? '+' : ''}${formatAdminPointValue(rewardAmount)} 分</div>
                                            <i class="fas fa-chevron-down"></i>
                                        </div>
                                    </div>
                                </summary>
                                <div class="affiliate-admin-reward-body">
                                    <div class="affiliate-admin-reward-grid">
                                        <div><span>来源对象</span><strong>${escapeHtml(reward.source_name || reward.source_reason || '未命名记录')}</strong></div>
                                        <div><span>触发时间</span><strong>${formatAdminDateTime(reward.reward_created_at)}</strong></div>
                                        <div><span>订单/来源金额</span><strong>${formatAdminPointValue(reward.source_amount || 0)} 分</strong></div>
                                        <div><span>配置比例</span><strong>${declaredRate ? formatAdminPercentValue(declaredRate) : '未记录'}</strong></div>
                                        <div><span>实际到账比例</span><strong>${actualRate ? formatAdminPercentValue(actualRate) : '未记录'}</strong></div>
                                        <div><span>按配置应返</span><strong>${expectedAmount ? `${formatAdminPointValue(expectedAmount)} 分` : '未记录'}</strong></div>
                                    </div>
                                    ${rateMismatch ? `
                                        <div class="affiliate-admin-reward-warning">
                                            <i class="fas fa-triangle-exclamation"></i>
                                            <span>这笔奖励的应返与实返不一致，通常说明它来自历史修复前的旧流水。</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </details>
                        `;
    }).join('') : '<div class="empty-state">该用户暂时还没有推广奖励记录。</div>'}
                    </div>
                </section>
            </div>
        </div>
    `;
}

function reloadAffiliateModalData() {
    currentModalData.affiliate = createEmptyAffiliateModalState();
    renderUserTab('affiliate');
}

// Close Modal
function closeUserModal() {
    closeAdminLedgerDetailModal();
    const overlay = document.getElementById('userModalOverlay');
    overlay.classList.remove('active');
    currentModalUser = null;
    currentModalData = {};
}

function sanitizeAdminExportFilename(value = 'export') {
    const text = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
    return text || 'export';
}

function summarizeAdminExportText(value = '', limit = 160) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > limit ? `${text.slice(0, Math.max(limit - 1, 1))}…` : text;
}

function hasAdminExportValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

function formatAdminExportPercent(value) {
    return hasAdminExportValue(value) ? formatAdminPercentValue(value) : '';
}

function buildAdminExportWorksheet(data, headers) {
    const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
    worksheet['!cols'] = headers.map(header => {
        const contentWidth = data.reduce((maxWidth, row) => {
            const rawValue = row?.[header];
            const text = rawValue === null || rawValue === undefined ? '' : String(rawValue);
            const width = text.split(/\r?\n/).reduce((lineMax, line) => Math.max(lineMax, line.length), 0);
            return Math.max(maxWidth, width);
        }, header.length);
        return { wch: Math.min(Math.max(contentWidth + 2, 10), 42) };
    });
    return worksheet;
}

function downloadAdminTabExport(data, { filenameBase, sheetName, headers }) {
    const safeFilename = sanitizeAdminExportFilename(filenameBase || 'export');
    const safeSheetName = String(sheetName || '导出').slice(0, 31);
    const exportHeaders = headers?.length ? headers : Object.keys(data[0] || {});

    if (typeof XLSX === 'undefined') {
        showToast?.('Excel 库未加载，将导出为 CSV', 'warning');
        const csv = [
            exportHeaders.join(','),
            ...data.map(row => exportHeaders.map(header => `"${String(row?.[header] ?? '').replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${safeFilename}.csv`;
        link.click();
        return;
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = buildAdminExportWorksheet(data, exportHeaders);
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
    XLSX.writeFile(workbook, `${safeFilename}.xlsx`);
}

function buildAdminLedgerExportRow(detail = {}) {
    const referenceMeta = getAdminReferenceMeta(detail);
    const humanizedReason = getAdminLedgerReasonText(detail.reason, detail.referenceId);
    const adminManualMeta = detail.meta?.transactionType === 'admin' ? parseAdminManualReason(detail.reason) : null;
    const baseUserName = currentModalUser?.username || '';
    const baseUserEmail = currentModalUser?.email || '';
    const row = {
        '用户昵称': baseUserName,
        '用户邮箱': baseUserEmail,
        '流水编号': String(detail.record?.id || ''),
        '记录标题': detail.meta?.title || '',
        '流水摘要': detail.meta?.subtitle || '',
        '交易类型': detail.meta?.badge || '',
        '积分方向': detail.amount >= 0 ? '入账' : '支出',
        '积分变动(分)': detail.amount,
        '原因说明': humanizedReason,
        '关联编号': detail.referenceId || '',
        '关联用途': referenceMeta.usage || '',
        '时间': formatAdminDateTime(detail.createdAt),
        '操作人': adminManualMeta?.operator || '系统',
        '状态/阶段': '',
        '来源对象': '',
        '被邀请人': '',
        '订单/来源金额(分)': '',
        '配置比例': '',
        '实际到账比例': '',
        '按配置应返(分)': '',
        '订单编号': '',
        '订单状态': '',
        '商品明细': '',
        '商品内容摘要': '',
        '提示词标题': '',
        '提示词作者': '',
        '提示词标签': '',
        '验证状态': '',
        '账号邮箱': '',
        '任务编号': '',
        '生成链接': '',
        '附加说明': detail.error || ''
    };

    if (detail.prompt) {
        row['来源对象'] = detail.prompt.title || detail.meta?.title || '提示词';
        row['提示词标题'] = detail.prompt.title || '';
        row['提示词作者'] = detail.prompt.author_name || '';
        row['提示词标签'] = Array.isArray(detail.prompt.tags) ? detail.prompt.tags.join(' / ') : '';
        row['附加说明'] = summarizeAdminExportText(detail.prompt.description || detail.meta?.subtitle || '');
    }

    if (detail.shop?.order || (detail.shop?.items || []).length) {
        const order = detail.shop.order || {};
        const itemSummaries = (detail.shop.items || []).map(item => `${item.name || '未知商品'} · ${formatAdminPointValue(item.price || 0)} 分`);
        const itemContentSummaries = (detail.shop.items || [])
            .filter(item => item.content)
            .map(item => `${item.name || '未知商品'}：${summarizeAdminExportText(item.content, 140)}`);
        row['来源对象'] = itemSummaries.join('；') || detail.meta?.title || '商城订单';
        row['订单/来源金额(分)'] = normalizeAdminLedgerValue(order.total_price ?? order.price_paid ?? Math.abs(detail.amount));
        row['订单编号'] = order.id || getAdminShopOrderIdFromReference(detail.referenceId) || '';
        row['订单状态'] = order.status || '已完成';
        row['状态/阶段'] = row['订单状态'];
        row['商品明细'] = itemSummaries.join('\n');
        row['商品内容摘要'] = itemContentSummaries.join('\n\n');
    }

    if (detail.affiliate) {
        const hasExpected = hasAdminExportValue(detail.affiliate.expected_reward_amount);
        row['状态/阶段'] = detail.affiliate.source_stage || detail.affiliate.reward_reason || '';
        row['来源对象'] = detail.affiliate.source_name || detail.affiliate.source_reason || detail.meta?.title || '推广奖励';
        row['被邀请人'] = getAdminInviteeDisplay(detail.affiliate);
        row['订单/来源金额(分)'] = hasAdminExportValue(detail.affiliate.source_amount)
            ? normalizeAdminLedgerValue(detail.affiliate.source_amount)
            : '';
        row['配置比例'] = formatAdminExportPercent(detail.affiliate.declared_commission_rate);
        row['实际到账比例'] = formatAdminExportPercent(detail.affiliate.commission_rate);
        row['按配置应返(分)'] = hasExpected
            ? normalizeAdminLedgerValue(detail.affiliate.expected_reward_amount)
            : '';
        row['附加说明'] = detail.affiliate.reward_label || detail.meta?.subtitle || '';
    }

    if (detail.verify) {
        const verifyStatus = getAdminVerifyStatusMeta(detail.verify.status || detail.verify.payload?.raw_status || '');
        row['状态/阶段'] = verifyStatus.text;
        row['来源对象'] = 'Google One 验证服务';
        row['验证状态'] = verifyStatus.text;
        row['账号邮箱'] = detail.verify.email || '';
        row['任务编号'] = detail.verify.jobId || detail.referenceId || '';
        row['生成链接'] = detail.verify.url || '';
        row['附加说明'] = summarizeAdminExportText(detail.verify.message || detail.meta?.subtitle || '');
    }

    if (detail.meta?.transactionType === 'recharge') {
        row['状态/阶段'] = '已到账';
        row['来源对象'] = detail.meta?.title || getAdminRechargeDisplayName(detail.reason);
        row['附加说明'] = '积分充值记录';
    }

    if (detail.meta?.transactionType === 'redeem') {
        row['状态/阶段'] = '已兑换';
        row['来源对象'] = '兑换码兑换';
        row['附加说明'] = '兑换码积分到账';
    }

    if (detail.meta?.transactionType === 'bonus') {
        row['状态/阶段'] = detail.amount >= 0 ? '已发放' : '已扣除';
        row['来源对象'] = detail.meta?.title || humanizedReason;
        row['附加说明'] = detail.meta?.subtitle || humanizedReason;
    }

    if (detail.meta?.transactionType === 'admin') {
        row['状态/阶段'] = detail.amount >= 0 ? '管理员加分' : '管理员扣分';
        row['来源对象'] = '管理员手动调整';
        row['附加说明'] = adminManualMeta?.note || humanizedReason;
    }

    if (!row['来源对象']) {
        row['来源对象'] = detail.meta?.title || humanizedReason;
    }

    return row;
}

async function buildAdminLedgerExportData(records = []) {
    await fetchPromptCache();
    const details = await Promise.all(records.map(record => fetchAdminLedgerDetail(record)));
    return details.map(detail => buildAdminLedgerExportRow(detail));
}

// Export Tab Data to Excel (CSV fallback)
async function exportTabData(tabName) {
    let data = [];
    let headers = [];
    let filenameBase = '';
    let sheetName = '';
    const username = sanitizeAdminExportFilename(currentModalUser?.username || 'user');
    const date = new Date().toISOString().split('T')[0];

    try {
        switch (tabName) {
            case 'ledger':
                showToast?.('正在整理积分流水导出内容...', 'info');
                data = await buildAdminLedgerExportData(currentModalData.pointsLedger || []);
                headers = [
                    '用户昵称',
                    '用户邮箱',
                    '流水编号',
                    '记录标题',
                    '流水摘要',
                    '交易类型',
                    '积分方向',
                    '积分变动(分)',
                    '原因说明',
                    '关联编号',
                    '关联用途',
                    '时间',
                    '操作人',
                    '状态/阶段',
                    '来源对象',
                    '被邀请人',
                    '订单/来源金额(分)',
                    '配置比例',
                    '实际到账比例',
                    '按配置应返(分)',
                    '订单编号',
                    '订单状态',
                    '商品明细',
                    '商品内容摘要',
                    '提示词标题',
                    '提示词作者',
                    '提示词标签',
                    '验证状态',
                    '账号邮箱',
                    '任务编号',
                    '生成链接',
                    '附加说明'
                ];
                filenameBase = `${username}_积分流水_${date}`;
                sheetName = '积分流水';
                break;
            case 'activity':
                data = (currentModalData.contentLog || []).map(r => ({
                    '类型': r.type,
                    '内容': r.content,
                    '来源': r.source,
                    '时间': new Date(r.created_at).toLocaleString()
                }));
                filenameBase = `${username}_近期动态_${date}`;
                sheetName = '近期动态';
                break;
            case 'notes':
                data = (currentModalData.notes || []).map(r => ({
                    '操作人': r.admin_email,
                    '内容': r.content,
                    '时间': new Date(r.created_at).toLocaleString()
                }));
                filenameBase = `${username}_备注记录_${date}`;
                sheetName = '备注记录';
                break;
            case 'audit':
                data = (currentModalData.auditLogs || []).map(r => {
                    let details = '';
                    try { details = JSON.stringify(r.details); } catch (e) { }
                    return {
                        '行动': r.action_type,
                        '详情': details,
                        '操作人': r.admin_email,
                        '时间': new Date(r.created_at).toLocaleString()
                    };
                });
                filenameBase = `${username}_审计日志_${date}`;
                sheetName = '审计日志';
                break;
            case 'blocks':
                data = (currentModalData.blockHistory || []).map(r => ({
                    '操作': r.action,
                    '范围': r.scope,
                    '原因': r.reason || '',
                    '时间': new Date(r.created_at).toLocaleString()
                }));
                filenameBase = `${username}_封禁记录_${date}`;
                sheetName = '封禁记录';
                break;
            case 'affiliate':
                data = (currentModalData.affiliate?.rewards || []).map(r => ({
                    '奖励类型': r.reward_label || '推广奖励',
                    '被邀请人': getAdminInviteeDisplay(r),
                    '奖励阶段': r.source_stage || '',
                    '奖励积分': Number(r.reward_amount || 0),
                    '来源对象': r.source_name || r.source_reason || '',
                    '来源金额': Number(r.source_amount || 0),
                    '配置比例': hasAdminExportValue(r.declared_commission_rate) ? `${r.declared_commission_rate}%` : '',
                    '实际到账比例': hasAdminExportValue(r.commission_rate) ? `${r.commission_rate}%` : '',
                    '时间': r.reward_created_at ? new Date(r.reward_created_at).toLocaleString() : ''
                }));
                filenameBase = `${username}_推广记录_${date}`;
                sheetName = '推广记录';
                break;
            default:
                break;
        }

        if (data.length === 0) {
            alert('没有数据可导出');
            return;
        }

        downloadAdminTabExport(data, { filenameBase, sheetName, headers });
        showToast?.(`已导出 ${data.length} 条${sheetName || '记录'}`, 'success');
    } catch (error) {
        console.error(`Failed to export tab data for ${tabName}:`, error);
        showToast?.(`导出失败: ${error.message || '未知错误'}`, 'error');
    }
}

// Backward compatibility: keep openUserDrawer as alias
function openUserDrawer(userId) {
    openUserModal(userId);
}

function closeUserDrawer() {
    closeUserModal();
}

// Fetch user's recent content (comments/guestbook)
async function fetchUserContentLog(userId) {
    try {
        // Fetch from both comments and guestbook
        const [galleryComments, guestbookMessages] = await Promise.all([
            window.supabaseClient
                .from('prompt_comments')
                .select('id, content, created_at, prompt_id, prompts(title)')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(5),
            window.supabaseClient
                .from('guestbook_messages')
                .select('id, content, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(5)
        ]);

        const items = [];

        if (galleryComments.data) {
            galleryComments.data.forEach(c => {
                const promptTitle = c.prompts?.title || `Prompt #${c.prompt_id}`;
                items.push({
                    type: 'comment',
                    content: c.content,
                    source: `📸 ${promptTitle}`,
                    created_at: c.created_at
                });
            });
        }

        if (guestbookMessages.data) {
            guestbookMessages.data.forEach(m => {
                items.push({
                    type: 'guestbook',
                    content: m.content,
                    source: '留言板',
                    created_at: m.created_at
                });
            });
        }

        // Sort by date and take top 5
        return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    } catch (err) {
        console.error('Failed to fetch content log:', err);
        return [];
    }
}

// Fetch user's block history (from permanent history table)
async function fetchUserBlockHistory(userId) {
    try {
        const { data, error } = await window.supabaseClient
            .from('block_history')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return (data || []).map(record => ({
            ...record,
            is_active: record.action === 'block',
            scope: record.scope || 'all'
        }));
    } catch (err) {
        console.error('Failed to fetch block history:', err);
        return [];
    }
}

// Fetch related accounts (multi-account detection by IP)
async function fetchRelatedAccounts(userId) {
    try {
        const { data, error } = await window.supabaseClient
            .rpc('find_related_accounts', { target_user_id: userId });

        if (error) {
            console.warn('Related accounts query failed:', error.message);
            return [];
        }

        // Return unique users (dedupe by user_id)
        const uniqueUsers = new Map();
        (data || []).forEach(acc => {
            if (!uniqueUsers.has(acc.related_user_id)) {
                uniqueUsers.set(acc.related_user_id, acc);
            }
        });

        return Array.from(uniqueUsers.values());
    } catch (err) {
        console.error('Failed to fetch related accounts:', err);
        return [];
    }
}

// Fetch user's points ledger (transaction history)
async function fetchPointsLedger(userId) {
    try {
        const { data, error } = await window.supabaseClient
            .from('points_ledger')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        return data || [];
    } catch (err) {
        console.error('Failed to fetch points ledger:', err);
        return [];
    }
}

// Format ledger reason for display
function formatLedgerReason(reason, createdAt, referenceId) {
    const timeStr = createdAt ? formatTimeAgo(createdAt) : '';
    const timeHtml = `<span class="users-ledger-reason-time">${timeStr}</span>`;

    if (!reason) return `
        <div class="users-ledger-reason-row">
             <span>未知</span>
             ${timeHtml}
        </div>`;

    let text = reason;
    let color = '#94a3b8'; // default gray

    if (reason === 'daily_checkin') {
        text = '📅 每日签到';
        color = '#3b82f6';
    } else if (reason === 'unlock_prompt') {
        text = '🔓 解锁提示词';
        color = '#f59e0b';
        // Try to resolve prompt title
        if (referenceId && promptCache[referenceId]) {
            text += `: ${promptCache[referenceId]}`;
        } else if (referenceId) {
            text += ` (ID: ${referenceId})`;
        }
    } else if (reason.startsWith('comment_reward')) {
        text = '💬 评论奖励';
        color = '#10b981';
    } else if (reason.startsWith('admin_manual')) {
        text = '👮‍♂️ 管理员调整';
        color = '#8b5cf6';
        const match = reason.match(/admin_manual:\[(.*?)\] (.*)/);
        if (match && match[2]) {
            text += `: ${match[2]}`;
            // Hide email if desired, or keep as is for admin view (admin sees admin email usually)
            // User asked: "管理员的‘积分流水’也是应该显示详细的解锁了哪款提示词"
            // Assuming admin manual reason is fine as is
        } else if (reason.includes(':')) {
            text += `: ${reason.split(':')[1].trim()}`;
        }
    } else if (reason === 'recharge') {
        text = '💰 充值';
        color = '#10b981';
    } else if (reason === 'redeem_code') {
        text = '🎟️ 兑换码';
        color = '#10b981';
    } else if (reason === 'register_bonus') {
        text = '🎁 注册奖励';
        color = '#ec4899';
    }

    const tone = getAdminUiTone(color);
    return `
        <div class="users-ledger-reason-row">
             <span class="users-ledger-reason-text users-ledger-reason-text--${tone}">${text}</span>
             ${timeHtml}
        </div>`;
}



let pendingBanState = {}; // { guestbook: {action, days}, gallery: {action, days} }
let originalBanState = {}; // To track what to unban
let batchBanUserIds = []; // For batch ban operations

// Inject Ban Modal
function injectBanUserModal() {
    if (document.getElementById('banUserModalOverlay')) return;

    const modalHtml = `
    <div id="banUserModalOverlay" class="custom-modal-overlay">
        <div class="custom-modal ban-user-modal">
            <div class="modal-header">
                <h3 class="modal-title users-danger-modal-title">🚫 封禁管理</h3>
                <button class="modal-close-btn" type="button" data-users-ban-action="close"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body users-ban-modal-body">
                 <input type="hidden" id="banTargetUserId">
                 
                 <!-- Permanent Bans -->
                 <div class="ban-scope-group">
                     <div class="ban-scope-header">
                        <i class="fas fa-comment-alt"></i> 留言板权限
                     </div>
                     <div class="scope-options-pills">
                         <div class="scope-pill selected" data-scope="guestbook" data-days="unban" data-users-ban-action="select">正常</div>
                         <div class="scope-pill" data-scope="guestbook" data-days="3" data-users-ban-action="select">3天</div>
                         <div class="scope-pill" data-scope="guestbook" data-days="30" data-users-ban-action="select">30天</div>
                         <div class="scope-pill danger" data-scope="guestbook" data-days="permanent" data-users-ban-action="select">永久封禁</div>
                     </div>
                 </div>

                 <div class="ban-scope-group">
                     <div class="ban-scope-header">
                        <i class="fas fa-images"></i> 画廊权限
                     </div>
                     <div class="scope-options-pills">
                         <div class="scope-pill selected" data-scope="gallery" data-days="unban" data-users-ban-action="select">正常</div>
                         <div class="scope-pill" data-scope="gallery" data-days="3" data-users-ban-action="select">3天</div>
                         <div class="scope-pill" data-scope="gallery" data-days="7" data-users-ban-action="select">7天</div>
                         <div class="scope-pill" data-scope="gallery" data-days="30" data-users-ban-action="select">30天</div>
                         <div class="scope-pill danger" data-scope="gallery" data-days="permanent" data-users-ban-action="select">永久封禁</div>
                     </div>
                 </div>

                 <div class="ban-scope-group">
                     <div class="ban-scope-header">
                        <i class="fas fa-coins"></i> 积分消费
                     </div>
                     <div class="scope-options-pills">
                         <div class="scope-pill selected" data-scope="points_usage" data-days="unban" data-users-ban-action="select">正常</div>
                         <div class="scope-pill" data-scope="points_usage" data-days="3" data-users-ban-action="select">3天</div>
                         <div class="scope-pill" data-scope="points_usage" data-days="7" data-users-ban-action="select">7天</div>
                         <div class="scope-pill" data-scope="points_usage" data-days="30" data-users-ban-action="select">30天</div>
                         <div class="scope-pill danger" data-scope="points_usage" data-days="permanent" data-users-ban-action="select">永久封禁</div>
                     </div>
                 </div>
                 
                 <div class="ban-scope-group users-ban-reset-group">
                    <div class="scope-options-pills no-indicator">
                        <div class="scope-pill success users-ban-unban-all" data-scope="all" data-days="unban" data-users-ban-action="select">
                            <i class="fas fa-shield-alt users-ban-unban-icon"></i> 解除该用户所有封禁
                        </div>
                    </div>
                 </div>
                 
                 <div class="ban-actions users-ban-actions">
                    <button class="modal-btn users-ban-details-btn" type="button" data-users-ban-action="details">状态详情</button>
                    <button id="btnBanConfirm" class="modal-btn confirm" type="button" data-users-ban-action="confirm">确认执行</button>
                 </div>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    bindBanUserModalInteractions(document.getElementById('banUserModalOverlay'));
}

function normalizeBanDaysValue(value) {
    if (value === 'unban') return 'unban';
    if (value === 'permanent') return null;
    const parsed = parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function bindBanUserModalInteractions(overlay) {
    if (!overlay || overlay.dataset.usersBanBound === '1') {
        return;
    }

    overlay.dataset.usersBanBound = '1';
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeBanUserModal();
            return;
        }

        const actionEl = event.target instanceof Element ? event.target.closest('[data-users-ban-action]') : null;
        if (!actionEl || !overlay.contains(actionEl)) {
            return;
        }

        switch (actionEl.dataset.usersBanAction) {
            case 'close':
                closeBanUserModal();
                break;
            case 'select':
                toggleBanSelection(
                    actionEl,
                    actionEl.dataset.scope || '',
                    normalizeBanDaysValue(actionEl.dataset.days)
                );
                break;
            case 'details':
                showBanDetails(null);
                break;
            case 'confirm':
                executeBanSelection();
                break;
        }
    });
}


function closeBanUserModal() {
    const overlay = document.getElementById('banUserModalOverlay');
    if (overlay) overlay.classList.remove('active');
    pendingBanState = {};
}

// Update sliding indicator position and color
// Update sliding indicator position and color
function updatePillIndicator(container, selectedPill) {
    if (!container || !selectedPill) return;
    if (container.classList.contains('no-indicator')) return;

    const pills = Array.from(container.querySelectorAll('.scope-pill'));
    const index = pills.indexOf(selectedPill);
    const count = pills.length;

    if (index === -1) return;

    // Set pill count and active index
    container.style.setProperty('--pill-count', count);
    container.style.setProperty('--active-index', index);

    // Determine indicator color based on pill type
    const days = selectedPill.dataset.days;
    const isDanger = selectedPill.classList.contains('danger');

    let bgColor, borderColor;
    if (days === 'unban') {
        // Blue for normal/unban
        bgColor = 'rgba(59, 130, 246, 0.25)';
        borderColor = 'rgba(59, 130, 246, 0.5)';
    } else if (isDanger || days === 'permanent') {
        // Red for permanent ban
        bgColor = 'rgba(239, 68, 68, 0.25)';
        borderColor = 'rgba(239, 68, 68, 0.5)';
    } else {
        // Orange for temporary ban
        bgColor = 'rgba(245, 158, 11, 0.2)';
        borderColor = 'rgba(245, 158, 11, 0.5)';
    }

    container.style.setProperty('--indicator-color', bgColor);
    container.style.setProperty('--indicator-border', borderColor);
}

// Toggle Selection (Pills behavior)
function toggleBanSelection(el, scope, days) {
    if (scope === 'all' && days === 'unban') {
        // Unban All: Set all scopes to 'unban'
        ['guestbook', 'gallery', 'points_usage'].forEach(s => {
            pendingBanState[s] = { action: 'unban' };

            // Visuals: Select "Normal" pill for this scope
            const container = document.querySelector(`.scope-pill[data-scope="${s}"]`)?.parentElement;
            document.querySelectorAll(`.scope-pill[data-scope="${s}"]`).forEach(p => p.classList.remove('selected'));
            const unbanPill = document.querySelector(`.scope-pill[data-scope="${s}"][data-days="unban"]`);
            if (unbanPill) {
                unbanPill.classList.add('selected');
                updatePillIndicator(container, unbanPill);
            }
        });
    } else {
        // Specific Scope
        const container = el.parentElement;

        // 1. Deselect other pills in this scope group
        document.querySelectorAll(`.scope-pill[data-scope="${scope}"]`).forEach(p => p.classList.remove('selected'));

        // 2. Select clicked pill
        el.classList.add('selected');

        // 3. Update sliding indicator
        updatePillIndicator(container, el);

        // 4. Logic
        if (days === 'unban') {
            pendingBanState[scope] = { action: 'unban' };
        } else {
            pendingBanState[scope] = { action: 'ban', days: days };
        }
    }

    updateConfirmBtn();
}

function updateConfirmBtn() {
    const btn = document.getElementById('btnBanConfirm');
    if (!btn) return;
    const toneClasses = [
        'users-ban-confirm-btn--unban',
        'users-ban-confirm-btn--ban',
        'users-ban-confirm-btn--idle'
    ];
    btn.classList.remove(...toneClasses);

    // Check if any changes
    const hasChanges = Object.keys(pendingBanState).length > 0;

    if (hasChanges) {
        btn.disabled = false;
        // Check if all actions are unban
        const allUnban = Object.values(pendingBanState).every(s => s.action === 'unban');
        if (allUnban) {
            btn.textContent = '确认解封';
            btn.classList.add('users-ban-confirm-btn--unban');
        } else {
            btn.textContent = '确认执行';
            btn.classList.add('users-ban-confirm-btn--ban');
        }
    } else {
        btn.disabled = false; // Always enabled to allow "No Change"? No, prefer disabled or "No Change"
        btn.textContent = '未做修改';
        btn.classList.add('users-ban-confirm-btn--idle');
    }
}

// Open and Load Data
async function openBanModal(userId) {
    injectBanUserModal();
    document.getElementById('banTargetUserId').value = userId;

    // Reset State
    pendingBanState = {};
    originalBanState = { guestbook: false, gallery: false, points_usage: false };

    // Reset UI: Select "Normal" (Unban) for all scopes by default
    document.querySelectorAll('.scope-pill').forEach(item => item.classList.remove('selected'));
    document.querySelectorAll('.scope-pill[data-days="unban"]').forEach(item => {
        if (item.getAttribute('data-scope') !== 'all') { // Skip the 'Unban All' button itself if it has unban data
            item.classList.add('selected');
        }
    });

    // Show Loading or just fetch fast
    const overlay = document.getElementById('banUserModalOverlay');
    overlay.classList.add('active');

    try {
        const { data: bans } = await window.supabaseClient
            .from('blocked_users')
            .select('*')
            .eq('user_id', userId);

        // Pre-select options based on existing bans
        if (bans && bans.length > 0) {
            bans.forEach(ban => {
                let scope = ban.scope;
                originalBanState[scope] = true; // Mark as was banned

                let selector = `.scope-pill[data-scope="${scope}"]`;

                let targetDays = 'permanent';
                if (ban.expires_at) {
                    const diff = new Date(ban.expires_at) - new Date();
                    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                    if (days <= 3) targetDays = '3';
                    else if (days <= 7) targetDays = '7';
                    else if (days <= 30) targetDays = '30';
                    else targetDays = 'permanent'; // fallback
                }

                // Deselect "Normal"
                const normalPill = document.querySelector(`${selector}[data-days="unban"]`);
                if (normalPill) normalPill.classList.remove('selected');

                // Select Target
                const el = document.querySelector(`${selector}[data-days="${targetDays}"]`);
                if (el) el.classList.add('selected');
            });
        }

    } catch (e) {
        console.error("Fetch ban status failed", e);
    }

    // Initialize sliding indicators for all scope groups
    ['guestbook', 'gallery', 'points_usage'].forEach(scope => {
        const selectedPill = document.querySelector(`.scope-pill[data-scope="${scope}"].selected`);
        if (selectedPill) {
            const container = selectedPill.parentElement;
            updatePillIndicator(container, selectedPill);
        }
    });

    updateConfirmBtn();
}

// Execute Final Logic
async function executeBanSelection() {
    const targetId = document.getElementById('banTargetUserId').value;
    const isBatchMode = targetId === '__BATCH__';
    const userIds = isBatchMode ? batchBanUserIds : [targetId];

    const { data: { user: adminUser } } = await window.supabaseClient.auth.getUser();

    if (Object.keys(pendingBanState).length === 0) {
        closeBanUserModal();
        return;
    }

    const promises = [];

    for (const userId of userIds) {
        for (const [scope, state] of Object.entries(pendingBanState)) {
            if (state.action === 'ban') {
                // Calculate expiry
                let expiresAt = null;
                if (state.days) {
                    const date = new Date();
                    date.setDate(date.getDate() + parseInt(state.days));
                    expiresAt = date.toISOString();
                }

                const payload = {
                    user_id: userId,
                    scope: scope,
                    reason: state.days ? `临时封禁 ${state.days}天` : '永久封禁',
                    admin_id: adminUser?.id,
                    expires_at: expiresAt
                };

                // Upsert
                promises.push(
                    window.supabaseClient
                        .from('blocked_users')
                        .upsert(payload, { onConflict: 'user_id, scope' })
                        .then(async () => {
                            logAdminAction('BAN_USER', userId, { scope, days: state.days });
                            // Notify Ban (skip for batch to avoid spam, or just send)
                            if (!isBatchMode) {
                                await sendSystemNotification(
                                    userId,
                                    '账号封禁通知',
                                    `您已被封禁 [${scope === 'all' ? '全站' : scope}] 权限。\n时长：${state.days ? state.days + '天' : '永久'}.\n此期间您将无法使用相关功能。`,
                                    'warning'
                                );
                            }
                        })
                );

                // Log history
                promises.push(
                    window.supabaseClient.from('block_history').insert({
                        user_id: userId, action: 'block', scope, reason: payload.reason, admin_id: adminUser?.id
                    })
                );

            } else if (state.action === 'unban') {
                // Delete
                promises.push(
                    window.supabaseClient
                        .from('blocked_users')
                        .delete()
                        .eq('user_id', userId)
                        .eq('scope', scope)
                        .then(async () => {
                            logAdminAction('UNBAN_USER', userId, { scope });
                            if (!isBatchMode) {
                                await sendSystemNotification(
                                    userId,
                                    '封禁解除通知',
                                    `您的 [${scope === 'all' ? '全站' : scope}] 封禁已被管理员解除。您可以正常使用了。`,
                                    'success'
                                );
                            }
                        })
                );
                // Log history
                promises.push(
                    window.supabaseClient.from('block_history').insert({
                        user_id: userId, action: 'unblock', scope, reason: 'Manual Unban', admin_id: adminUser?.id
                    })
                );
            }
        }
    }

    closeBanUserModal();

    try {
        await Promise.all(promises);

        if (isBatchMode) {
            showToast(`成功处理 ${userIds.length} 位用户的封禁状态`, 'success');
            batchBanUserIds = []; // Clear batch state
            clearAllSelections();
            loadUsers();
        } else {
            // Refresh single user drawer
            await openUserDrawer(targetId);
            showToast('✅ 操作执行成功', 'success');
        }
    } catch (err) {
        console.error('Ban exec failed', err);
        showToast('部分操作可能失败: ' + err.message, 'error');
    }
}

// Show Ban Details
async function showBanDetails(userId) {
    if (!userId) userId = document.getElementById('banTargetUserId').value;

    try {
        const { data: bans, error } = await window.supabaseClient
            .from('blocked_users')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;

        if (!bans || bans.length === 0) {
            alert('该用户当前没有生效的封禁记录。');
            return;
        }

        let msg = '🚫 封禁记录:\n\n';
        bans.forEach(b => {
            let typeStr = b.expires_at ? `${new Date(b.expires_at).toLocaleDateString()} 到期` : '永久';
            let scopeStr = b.scope === 'gallery' ? '画廊' : b.scope;
            msg += `- [${scopeStr}] ${typeStr}\n  原因: ${b.reason || '无'}\n\n`;
        });

        alert(msg);
    } catch (e) {
        alert('获取详情失败');
    }
}

// Toggle Block/Unblock (Entry Point)
async function toggleUserBlock(userId, currentlyBanned) {
    openBanModal(userId);
}

// Reset user avatar (placeholder)
async function resetUserAvatar(userId) {
    if (!confirm('确定要重置该用户的头像为默认头像吗？')) return;

    try {
        const { error } = await window.supabaseClient
            .from('profiles')
            .update({ avatar_url: null })
            .eq('id', userId);

        if (error) throw error;

        const userIndex = userState.users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            userState.users[userIndex].avatar_url = null;
        }

        await openUserDrawer(userId);
        renderUsersTable();

        alert('头像已重置');
        logAdminAction('RESET_AVATAR', userId, {});
    } catch (err) {
        console.error('Avatar reset failed:', err);
        alert('操作失败: ' + err.message);
    }

}

// Helper: Mask email for privacy
function maskEmail(email) {
    if (!email || !email.includes('@')) return email;
    const [name, domain] = email.split('@');
    const maskedName = name.length > 2
        ? name.substring(0, 2) + '***'
        : name + '***';
    return `${maskedName} @${domain} `;
}

// Helper: Format time ago
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)} 天前`;
    return date.toLocaleDateString();
}

function closeUserDrawer() {
    document.getElementById('userDrawerOverlay').classList.remove('active');
}

// Close drawer on overlay click (with null check)
const drawerOverlay = document.getElementById('userDrawerOverlay') || document.getElementById('userModalOverlay');
if (drawerOverlay) {
    drawerOverlay.addEventListener('click', (e) => {
        if (e.target === drawerOverlay) closeUserDrawer();
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

// Generate avatar with initials
function generateInitialsAvatar(name, size = 32) {
    const initials = (name || 'U').slice(0, 2).toUpperCase();
    const colorIndex = (name || 'U').charCodeAt(0) % 6;
    const avatarSizeClass = size >= 64 ? 'user-avatar-large initials-avatar--lg' : 'user-avatar-small initials-avatar--sm';
    return `<div class="${avatarSizeClass} initials-avatar initials-avatar--tone-${colorIndex}">${initials}</div>`;
}

// Points Modal Logic
function injectPointsModal() {
    if (document.getElementById('pointsModalOverlay')) return;

    const modalHtml = `
        <div id="pointsModalOverlay" class="custom-modal-overlay">
            <div class="custom-modal ban-user-modal points-adjustment-modal">
                <div class="modal-header">
                    <h3 class="modal-title">⚖️ 调整积分</h3>
                    <button class="modal-close-btn" type="button" data-users-points-action="close"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="data-row">
                        <span class="label">目标用户:</span>
                        <span id="pmUserName" class="value-highlight">--</span>
                    </div>
                    <div class="data-row">
                        <span class="label">当前积分:</span>
                        <span id="pmCurrentPoints" class="value-highlight">0</span>
                    </div>

                    <div class="form-group users-points-form-group-first">
                        <label>调整数值 <small>(正数增加 / 负数扣除)</small></label>
                        <input type="number" id="pmAmount" class="modal-input">
                    </div>

                    <div class="form-group">
                        <label>调整原因 <small>(必填)</small></label>
                        <input type="text" id="pmReason" class="modal-input">
                    </div>
                </div>
                <div class="modal-footer users-points-modal-footer">
                    <button class="modal-btn confirm" id="pmConfirmBtn">确认调整</button>
                </div>
            </div>
    </div > `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    bindPointsModalInteractions(document.getElementById('pointsModalOverlay'));
}

function bindPointsModalInteractions(overlay) {
    if (!overlay || overlay.dataset.usersPointsBound === '1') {
        return;
    }

    overlay.dataset.usersPointsBound = '1';
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closePointsModal();
            return;
        }

        const actionEl = event.target instanceof Element ? event.target.closest('[data-users-points-action]') : null;
        if (!actionEl || !overlay.contains(actionEl)) {
            return;
        }

        if (actionEl.dataset.usersPointsAction === 'close') {
            closePointsModal();
        }
    });
}

function closePointsModal() {
    const overlay = document.getElementById('pointsModalOverlay');
    if (overlay) overlay.classList.remove('active');
}

// Manual Points Adjustment (Custom Modal)
async function adjustUserPoints(userId) {
    injectPointsModal();
    const overlay = document.getElementById('pointsModalOverlay');
    const user = userState.users.find(u => u.id === userId);
    if (!user) return;

    // Reset Fields
    // Display name priority: email > username (if not 'Unknown') > nickname > fallback
    const displayName = user.email || (user.username !== 'Unknown' ? user.username : null) || user.nickname || 'Unknown';
    document.getElementById('pmUserName').textContent = displayName;
    document.getElementById('pmCurrentPoints').textContent = user.points.toLocaleString();
    document.getElementById('pmAmount').value = '';
    document.getElementById('pmReason').value = '';

    // Show Modal
    overlay.classList.add('active');

    // Handle Confirm
    const confirmBtn = document.getElementById('pmConfirmBtn');
    confirmBtn.onclick = async () => {
        const amountStr = document.getElementById('pmAmount').value;
        const reason = document.getElementById('pmReason').value.trim();

        const amount = parseInt(amountStr, 10);

        if (isNaN(amount) || amount === 0) {
            alert('请输入有效的调整数值');
            return;
        }

        if (!reason) {
            alert('请输入调整原因');
            return;
        }

        // Disable button
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';

        try {
            // 1. Fetch latest points
            const { data: currentPoints, error: fetchError } = await window.supabaseClient
                .from('user_points')
                .select('balance, total_earned')
                .eq('user_id', userId)
                .maybeSingle();

            if (fetchError) throw fetchError;

            const currentBalance = currentPoints?.balance || 0;
            const currentTotalEarned = currentPoints?.total_earned || 0;
            const newBalance = currentBalance + amount;
            const newTotalEarned = amount > 0 ? currentTotalEarned + amount : currentTotalEarned;

            // 2. Upsert user_points
            const { error: upsertError } = await window.supabaseClient
                .from('user_points')
                .upsert({
                    user_id: userId,
                    balance: newBalance,
                    total_earned: newTotalEarned,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });

            if (upsertError) throw upsertError;

            // 3. Get admin info for audit
            const { data: { user: currentUser } } = await window.supabaseClient.auth.getUser();
            const adminIdentity = currentUser?.email || 'Unknown';

            // 4. Log to ledger
            await window.supabaseClient
                .from('points_ledger')
                .insert({
                    user_id: userId,
                    amount: amount,
                    reason: `admin_manual: [${adminIdentity}] ${reason} `,
                    reference_id: 'admin_adjustment'
                });

            logAdminAction('UPDATE_POINT', userId, { amount, reason });

            // Send System Notification
            const changeStr = amount > 0 ? `+${amount}` : `${amount}`;
            await sendSystemNotification(
                userId,
                '积分变动通知',
                `您的积分已${amount > 0 ? '增加' : '扣除'} ${Math.abs(amount)}。\n原因：${reason}`,
                amount > 0 ? 'success' : 'warning'
            );

            // 5. Update Local State
            const userIndex = userState.users.findIndex(u => u.id === userId);
            if (userIndex !== -1) {
                userState.users[userIndex].points = newBalance;
                userState.users[userIndex].total_earned = newTotalEarned;
            }

            // 6. Refresh UI
            if (currentModalUser && currentModalUser.id === userId) {
                // If drawer/modal is open for this user, refresh it
                openUserModal(userId);
            }
            renderUsersTable();

            // Close and Reset
            closePointsModal();
            console.log(`✅ Points adjusted for ${userId}: ${changeStr}, new balance: ${newBalance} `);

        } catch (err) {
            console.error('Points adjustment failed:', err);
            alert('操作失败: ' + err.message);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '确认调整';
        }
    };
}

// Clear Content Modal Logic
function injectClearContentModal() {
    if (document.getElementById('clearContentModalOverlay')) return;

    const modalHtml = `
        <div id="clearContentModalOverlay" class="custom-modal-overlay">
            <div class="custom-modal ban-user-modal danger-modal">
                <div class="modal-header">
                    <h3 class="modal-title users-danger-modal-title">⚠️ 危险操作</h3>
                    <button class="modal-close-btn" type="button" data-users-clear-action="close"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="checklist-container users-danger-checklist">
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckComments">
                                <span>🖼️ 画廊评论</span>
                        </label>
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckGuestbook">
                                <span>📝 留言板留言</span>
                        </label>
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckPoints">
                                <span>💰 积分流水</span>
                        </label>
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckBlocks">
                                <span>🚫 封禁记录</span>
                        </label>
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckNotes">
                                <span>🗒️ 内部备注</span>
                        </label>
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckAudit">
                                <span>🛡️ 审计日志</span>
                        </label>
                        <div class="users-danger-divider"></div>
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckResetPoints">
                                <span>🗑️ 清空剩余积分 (重置为0)</span>
                        </label>
                        <label class="checkbox-item users-danger-checkbox-item">
                            <input type="checkbox" id="ccCheckPurchases">
                                <span>🛒 清空购买记录 (收回商品)</span>
                        </label>
                    </div>

                    <div class="form-group">
                        <input type="text" id="ccConfirmInput" class="modal-input users-danger-input" placeholder="输入密匙">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn cancel" type="button" data-users-clear-action="close">取消</button>
                    <button class="modal-btn danger users-clear-confirm-btn" id="ccConfirmBtn">确认清空</button>
                </div>
            </div>
    </div > `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    bindClearContentModalInteractions(document.getElementById('clearContentModalOverlay'));
}

function bindClearContentModalInteractions(overlay) {
    if (!overlay || overlay.dataset.usersClearBound === '1') {
        return;
    }

    overlay.dataset.usersClearBound = '1';
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeClearContentModal();
            return;
        }

        const actionEl = event.target instanceof Element ? event.target.closest('[data-users-clear-action]') : null;
        if (!actionEl || !overlay.contains(actionEl)) {
            return;
        }

        if (actionEl.dataset.usersClearAction === 'close') {
            closeClearContentModal();
        }
    });
}

function closeClearContentModal() {
    const overlay = document.getElementById('clearContentModalOverlay');
    if (overlay) overlay.classList.remove('active');
}

// Clear All User Content (Dangerous operation)
async function clearAllUserContent(userId) {
    injectClearContentModal();
    const overlay = document.getElementById('clearContentModalOverlay');
    const user = userState.users.find(u => u.id === userId);
    if (!user) return;

    // Reset Fields
    // document.getElementById('ccUserName').textContent = user.username; // Element removed

    // Reset inputs
    const input = document.getElementById('ccConfirmInput');
    input.value = '';

    const checkboxes = [
        document.getElementById('ccCheckComments'),
        document.getElementById('ccCheckGuestbook'),
        document.getElementById('ccCheckPoints'),
        document.getElementById('ccCheckBlocks'),
        document.getElementById('ccCheckBlocks'),
        document.getElementById('ccCheckNotes'),
        document.getElementById('ccCheckAudit'),
        document.getElementById('ccCheckResetPoints'),
        document.getElementById('ccCheckPurchases')
    ];

    // Uncheck all
    checkboxes.forEach(cb => cb.checked = false);

    const confirmBtn = document.getElementById('ccConfirmBtn');

    const validateState = () => {
        const isConfirmed = input.value === '0.0wangyong';
        const hasSelection = checkboxes.some(cb => cb.checked);
        confirmBtn.disabled = !(isConfirmed && hasSelection);
    };

    // Bind events
    input.oninput = validateState;
    checkboxes.forEach(cb => cb.onchange = validateState);

    // Initial validation
    validateState();

    // Show Modal
    overlay.classList.add('active');

    // Handle Confirm
    confirmBtn.onclick = async () => {
        if (input.value !== '0.0wangyong') return;

        // Disable button
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';

        try {
            const results = [];

            // 1. Delete Gallery Comments
            if (document.getElementById('ccCheckComments').checked) {
                const { error } = await window.supabaseClient
                    .from('prompt_comments')
                    .delete()
                    .eq('user_id', userId);
                if (error) console.warn('删除画廊评论失败:', error);
                else results.push('画廊评论');
            }

            // 2. Delete Guestbook Messages
            if (document.getElementById('ccCheckGuestbook').checked) {
                const { error } = await window.supabaseClient
                    .from('guestbook_messages')
                    .delete()
                    .eq('user_id', userId);
                if (error) console.warn('删除留言失败:', error);
                else results.push('留言板留言');
            }

            // 3. Delete Points Ledger
            if (document.getElementById('ccCheckPoints').checked) {
                const { error } = await window.supabaseClient
                    .from('points_ledger')
                    .delete()
                    .eq('user_id', userId);
                if (error) console.warn('删除积分记录失败:', error);
                else results.push('积分记录');

                // Note: This does NOT reset the user's current points balance, only the history.
                // If user wants to reset balance, they should adjust points manually or we'd need another option.
                // Assuming "Clear Content" implies history/logs.
            }

            // 4. Delete Block History
            if (document.getElementById('ccCheckBlocks').checked) {
                const { error } = await window.supabaseClient
                    .from('block_history')
                    .delete()
                    .eq('user_id', userId);
                if (error) console.warn('删除封禁记录失败:', error);
                else results.push('封禁记录');
            }

            // 5. Delete Notes
            if (document.getElementById('ccCheckNotes').checked) {
                const { error } = await window.supabaseClient
                    .from('admin_notes')
                    .delete()
                    .eq('target_user_id', userId);
                if (error) console.warn('删除备注失败:', error);
                else results.push('内部备注');
            }

            // 6. Delete Audit Logs
            if (document.getElementById('ccCheckAudit').checked) {
                const { error } = await window.supabaseClient
                    .from('admin_audit_logs')
                    .delete()
                    .eq('target_user_id', userId);
                if (error) console.warn('删除审计日志失败:', error);
                else results.push('审计日志');
            }

            // 7. Reset Points & Purchases (Consolidated Atomic RPC)
            const checkPoints = document.getElementById('ccCheckResetPoints').checked;
            const checkPurchases = document.getElementById('ccCheckPurchases').checked;

            if (checkPoints || checkPurchases) {
                const { data, error } = await window.supabaseClient
                    .rpc('fn_admin_clear_user_data', {
                        target_user_id: userId,
                        clear_points: checkPoints,
                        clear_purchases: checkPurchases
                    });

                if (error) {
                    console.warn('清空用户数据失败:', error);
                    results.push('清空失败: ' + error.message);
                } else {
                    if (checkPoints) results.push('剩余积分(重置为0)');
                    if (checkPurchases) results.push('购买记录(已收回)');
                    console.log('✅ Clear Data Result:', data);
                }
            }

            // Update Local State if points were reset
            if (document.getElementById('ccCheckResetPoints').checked) {
                const userIndex = userState.users.findIndex(u => u.id === userId);
                if (userIndex !== -1) {
                    userState.users[userIndex].points = 0;
                    userState.users[userIndex].total_earned = 0;
                }
            }

            // Refresh drawer
            await openUserDrawer(userId);
            // Refresh table list
            renderUsersTable();

            closeClearContentModal();
            console.log(`✅ Cleared content for user ${userId}: ${results.join(', ')} `);
            logAdminAction('CLEAR_CONTENT', userId, { cleared_items: results });

        } catch (err) {
            console.error('Clear content failed:', err);
            alert('操作失败: ' + err.message);
        } finally {
            confirmBtn.textContent = '确认清空';
        }
    };
}

// ============================================
// TAG SYSTEM
// ============================================

// Add tag to user
async function addUserTag(userId, tag) {
    try {
        const { error } = await window.supabaseClient
            .from('user_tags')
            .insert({ user_id: userId, tag: tag });

        if (error) throw error;

        // Log action
        await logAdminAction('add_tag', userId, { tag });

        // Update local state
        const userIndex = userState.users.findIndex(u => u.id === userId);
        if (userIndex !== -1 && !userState.users[userIndex].tags.includes(tag)) {
            userState.users[userIndex].tags.push(tag);
        }

        await openUserDrawer(userId);
        renderUsersTable();
        console.log(`✅ Tag "${tag}" added to user ${userId} `);
    } catch (err) {
        console.error('Add tag failed:', err);
        alert('添加标签失败: ' + err.message);
    }
}

// Remove tag from user
async function removeUserTag(userId, tag) {
    try {
        const { error } = await window.supabaseClient
            .from('user_tags')
            .delete()
            .eq('user_id', userId)
            .eq('tag', tag);

        if (error) throw error;

        // Log action
        await logAdminAction('remove_tag', userId, { tag });

        // Update local state
        const userIndex = userState.users.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            userState.users[userIndex].tags = userState.users[userIndex].tags.filter(t => t !== tag);
        }

        await openUserDrawer(userId);
        renderUsersTable();
        console.log(`✅ Tag "${tag}" removed from user ${userId} `);
    } catch (err) {
        console.error('Remove tag failed:', err);
        alert('移除标签失败: ' + err.message);
    }
}

// Show inline tag input
function showTagInput(userId) {
    const wrapper = document.getElementById(`addTagWrapper_${userId}`);
    if (!wrapper) return;

    wrapper.innerHTML = `
        <div class="custom-tag-input-wrapper">
            <input type="text" class="custom-tag-input" 
                   placeholder="输入标签..." 
                   data-users-tag-input="1"
                   data-user-id="${userId}"
            >
        </div>
    `;

    // Focus immediately
    const input = wrapper.querySelector('input');
    if (input) {
        input.focus();
        // Prevent immediate blur overlap if needed, though native focus works well
    }
}

// Handle key events in tag input
function handleTagInputKey(e, userId) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) {
            addUserTag(userId, val);
        } else {
            resetTagInput(userId, e.target);
        }
    } else if (e.key === 'Escape') {
        resetTagInput(userId, e.target);
    }
}

// Reset input to button
function resetTagInput(userId, inputElement) {
    // Delay to check if related target is within (if needed), or just revert
    setTimeout(() => {
        const wrapper = document.getElementById(`addTagWrapper_${userId}`);
        if (wrapper) {
            wrapper.innerHTML = `
                <button class="add-tag-btn" type="button" data-admin-action="users-show-tag-input" data-user-id="${encodeURIComponent(userId)}">
                    <i class="fas fa-plus"></i>
                </button>
            `;
        }
    }, 200);
}

// ============================================
// AUDIT LOG
// ============================================

async function logAdminAction(action, targetUserId, details = {}) {
    try {
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) return;

        await window.supabaseClient
            .from('admin_audit_logs')
            .insert({
                admin_id: user.id,
                action_type: action,
                target_user_id: targetUserId,
                details: details
            });
    } catch (err) {
        console.error('Audit log failed:', err);
    }
}

// Fetch audit log entries
async function fetchAuditLog(limit = 50) {
    try {
        const { data, error } = await window.supabaseClient
            .from('admin_audit_log')
            .select(`
            id, action, details, created_at,
                admin: admin_id(username),
                    target: target_user_id(username)
            `)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Failed to fetch audit log:', err);
        return [];
    }
}

// ============================================
// Admin Role Management Functions
// ============================================

// Check if current user is Super Admin
async function checkSuperAdmin() {
    try {
        const { data, error } = await window.supabaseClient
            .rpc('is_super_admin');

        if (error) throw error;
        window._isSuperAdmin = data === true;
        return window._isSuperAdmin;
    } catch (err) {
        console.warn('Super admin check failed:', err);
        window._isSuperAdmin = false;
        return false;
    }
}

// Fetch role info for a specific user
async function fetchUserRoleInfo(userId) {
    try {
        const { data, error } = await window.supabaseClient
            .from('admin_roles')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;

        return {
            is_admin: !!data,
            is_super_admin: false, // Will be determined by email check
            permissions: data?.permissions || [],
            expires_at: data?.expires_at,
            role_name: data?.role_name || 'admin'
        };
    } catch (err) {
        console.warn('Failed to fetch role info:', err);
        return {
            is_admin: false,
            is_super_admin: false,
            permissions: [],
            expires_at: null
        };
    }
}

// Toggle admin role on/off
async function toggleAdminRole(userId, enabled) {
    const permPanel = document.getElementById(`permPanel - ${userId} `);

    if (enabled) {
        // Show permissions panel
        if (permPanel) permPanel.hidden = false;

        // Insert role with default permissions
        try {
            const { data: currentUser } = await window.supabaseClient.auth.getUser();

            const { error } = await window.supabaseClient
                .from('admin_roles')
                .upsert({
                    user_id: userId,
                    role_name: 'admin',
                    permissions: ['content.moderate'],
                    granted_by: currentUser.user?.id,
                    granted_at: new Date().toISOString()
                }, { onConflict: 'user_id' });

            if (error) throw error;

            console.log('✅ Admin role granted to', userId);
            logAdminAction('grant_admin', userId, { permissions: ['content.moderate'] });
        } catch (err) {
            console.error('Failed to grant admin role:', err);
            alert('授予管理员权限失败: ' + err.message);
            // Revert toggle
            document.getElementById(`adminRoleToggle - ${userId} `).checked = false;
            if (permPanel) permPanel.hidden = true;
        }
    } else {
        // Hide permissions panel
        if (permPanel) permPanel.hidden = true;

        // Remove role
        try {
            const { error } = await window.supabaseClient
                .from('admin_roles')
                .delete()
                .eq('user_id', userId);

            if (error) throw error;

            console.log('✅ Admin role revoked from', userId);
            logAdminAction('revoke_admin', userId, {});
        } catch (err) {
            console.error('Failed to revoke admin role:', err);
            alert('撤销管理员权限失败: ' + err.message);
            // Revert toggle
            document.getElementById(`adminRoleToggle - ${userId} `).checked = true;
            if (permPanel) permPanel.hidden = false;
        }
    }
}

// Save admin permissions configuration
async function saveAdminPermissions(userId) {
    const permPanel = document.getElementById(`permPanel - ${userId} `);
    const expiryInput = document.getElementById(`roleExpiry - ${userId} `);

    // Collect selected permissions
    const permissions = [];
    permPanel.querySelectorAll('input[data-perm]:checked').forEach(cb => {
        permissions.push(cb.dataset.perm);
    });

    // Get expiry time
    const expiresAt = expiryInput.value ? new Date(expiryInput.value).toISOString() : null;

    try {
        const { error } = await window.supabaseClient
            .from('admin_roles')
            .update({
                permissions: permissions,
                expires_at: expiresAt
            })
            .eq('user_id', userId);

        if (error) throw error;

        alert('✅ 权限配置已保存');
        console.log('✅ Permissions saved for', userId, permissions, 'expires:', expiresAt);
        logAdminAction('update_permissions', userId, { permissions, expires_at: expiresAt });
    } catch (err) {
        console.error('Failed to save permissions:', err);
        alert('保存权限失败: ' + err.message);
    }
}

// Initialize super admin check when module loads
(async function () {
    await checkSuperAdmin();
})();

// Export functions
window.initUserModule = initUserModule;
window.toggleUserBlock = toggleUserBlock;
window.resetUserAvatar = resetUserAvatar;
window.adjustUserPoints = adjustUserPoints;
window.clearAllUserContent = clearAllUserContent;
window.addUserTag = addUserTag;
window.removeUserTag = removeUserTag;
window.getTagClass = getTagClass;
window.getTagLabel = getTagLabel;
window.toggleAdminRole = toggleAdminRole;
window.saveAdminPermissions = saveAdminPermissions;
window.checkSuperAdmin = checkSuperAdmin;
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.switchUserTab = switchUserTab;
window.exportTabData = exportTabData;
window.openUserDrawer = openUserDrawer;
window.closeUserDrawer = closeUserDrawer;
window.toggleModalDropdown = toggleModalDropdown;
window.handleModalAdminToggle = handleModalAdminToggle;
window.saveModalAdminPermissions = saveModalAdminPermissions;
window.filterTabByDate = filterTabByDate;
window.openCustomDatePicker = openCustomDatePicker;

function bindAdminUsersRuntimeDelegates() {
    if (document.documentElement.dataset.adminUsersRuntimeDelegatesBound === '1') {
        return;
    }

    document.documentElement.dataset.adminUsersRuntimeDelegatesBound = '1';

    document.addEventListener('error', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) {
            return;
        }

        const fallbackSrc = target.dataset.avatarFallbackSrc;
        if (!fallbackSrc || target.dataset.avatarFallbackApplied === '1') {
            return;
        }

        target.dataset.avatarFallbackApplied = '1';
        target.src = fallbackSrc;
    }, true);

    document.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement)) {
            return;
        }

        if (target.matches('[data-users-note-input="1"]')) {
            window.autoResizeNotesInput?.(target);
        }
    });

    document.addEventListener('keydown', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        if (target.matches('[data-users-tag-input="1"]')) {
            handleTagInputKey(event, target.dataset.userId || '');
        }
    });

    document.addEventListener('focusout', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        if (target.matches('[data-users-tag-input="1"]')) {
            resetTagInput(target.dataset.userId || '', target);
        }
    });
}

bindAdminUsersRuntimeDelegates();

// ==========================================
// NOTES TAB
// ==========================================
// Helper for auto-resizing notes input
window.autoResizeNotesInput = function (el) {
    el.style.setProperty('--users-note-height', 'auto');
    el.style.setProperty('--users-note-height', `${el.scrollHeight}px`);
};

async function renderNotesTab(container) {
    container.innerHTML = `
        ${buildUserTabToolbar('notes')}
        <div class="notes-container users-notes-container">
             <div class="notes-list users-notes-list" id="notesList">
                 <div class="modal-loading"><i class="fas fa-spinner fa-spin"></i> 加载备注...</div>
             </div>
             <div class="notes-input-area users-notes-input-area">
                 <div class="users-notes-composer">
                     <textarea id="newNoteInput" class="users-notes-input" placeholder="添加内部备注..." rows="1" data-users-note-input="1"></textarea>
                     <button class="btn-primary users-notes-submit-btn" type="button" data-admin-action="users-submit-note"><i class="fas fa-paper-plane"></i></button>
                 </div>
             </div>
        </div>
    `;

    try {
        const { data, error } = await window.supabaseClient
            .from('admin_notes_view')
            .select('id, content, created_at, admin_email')
            .eq('target_user_id', currentModalUser.id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        currentModalData.notes = data; // Store for filtering
        document.getElementById('notesList').innerHTML = renderNotesItems(data);

    } catch (err) {
        console.error('Error loading notes:', err);
        document.getElementById('notesList').innerHTML = buildUsersTabError(err.message);
    }
}

function renderNotesItems(data) {
    if (!data || data.length === 0) {
        return buildUsersTabEmptyState('暂无备注');
    }

    return data.map(note => {
        const adminEmail = note.admin_email || 'Unknown';
        return `
            <div class="note-item users-note-item">
                <div class="note-content users-note-content">${escapeHtml(note.content)}</div>
                <div class="note-meta users-note-meta">
                        <span><i class="fas fa-user-shield"></i> ${escapeHtml(adminEmail)}</span>
                        <span>${formatTimeAgo(note.created_at)}</span>
                </div>
            </div>
        `;
    }).join('');
}

async function submitUserNote() {
    const input = document.getElementById('newNoteInput');
    const content = input.value.trim();
    if (!content) return;

    try {
        // Get current admin ID
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { error } = await window.supabaseClient
            .from('admin_notes')
            .insert({
                target_user_id: currentModalUser.id,
                admin_id: user.id,
                content: content
            });

        if (error) throw error;

        input.value = '';
        renderNotesTab(document.getElementById('userTabContent')); // Reload list

        logAdminAction('ADD_NOTE', currentModalUser.id, { content_preview: content.substring(0, 20) });

    } catch (err) {
        alert('发送失败: ' + err.message);
    }
}

// ==========================================
// AUDIT TAB
// ==========================================
async function renderAuditTab(container) {
    container.innerHTML = `
        ${buildUserTabToolbar('audit')}
        <div class="audit-list users-audit-list" id="auditList">
            <div class="modal-loading"><i class="fas fa-spinner fa-spin"></i> 加载审计日志...</div>
        </div>
    `;

    try {
        const { data, error } = await window.supabaseClient
            .from('admin_audit_logs_view')
            .select('id, action_type, details, created_at, admin_email')
            .eq('target_user_id', currentModalUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        currentModalData.auditLogs = data; // Store for filtering
        document.getElementById('auditList').innerHTML = renderAuditItems(data);

    } catch (err) {
        console.error('Error loading audit logs:', err);
        document.getElementById('auditList').innerHTML = buildUsersTabError(err.message);
    }
}

function renderAuditItems(data) {
    if (!data || data.length === 0) {
        return buildUsersTabEmptyState('暂无审计记录');
    }

    return data.map(log => {
        const adminEmail = log.admin_email || 'Unknown';
        // Format details helper
        const formatDetails = (type, details) => {
            if (type.includes('POINT')) {
                const detailClass = details.amount > 0 ? 'is-positive' : 'is-negative';
                return `变动: <span class="audit-detail-amount ${detailClass}">${details.amount > 0 ? '+' : ''}${details.amount}</span> · 理由: ${escapeHtml(details.reason || '-')} `;
            }
            if (type.includes('BAN')) return `范围: ${details.scope === 'all' ? '全站' : '单项'} · 时长: ${escapeHtml(String(details.days || 0))}天`;
            if (type.includes('UNBAN')) return `解封范围: ${details.scope === 'all' ? '全站' : '单项'}`;
            if (type.includes('NOTE')) return `内容: ${escapeHtml(String(details.content_preview || ''))}...`;
            if (type.includes('NOTIFICATION')) return `标题: ${escapeHtml(String(details.title || '-'))} (${escapeHtml(String(details.type || 'info'))})`;
            if (type.includes('CLEAR')) return `清空项目: ${Array.isArray(details.cleared_items) ? details.cleared_items.map((item) => escapeHtml(String(item))).join(', ') : '无'}`;

            // Admin Permission Changes
            if (type === 'grant_admin' || type === 'update_admin_permissions') {
                const permMap = {
                    'content.moderate': '内容审核',
                    'users.manage': '用户管理',
                    'prompts.manage': 'Prompt 管理',
                    'analytics.view': '数据分析'
                };
                const perms = details.permissions
                    ? details.permissions.map(p => permMap[p] || p).join(', ')
                    : '无';
                return `授予权限: ${escapeHtml(perms)}`;
            }
            if (type === 'revoke_admin') return '已移除该用户的管理员权限';

            return escapeHtml(JSON.stringify(details, null, 2)); // Fallback
        };

        let icon = 'fa-shield-alt';
        let toneClass = 'is-neutral';

        if (log.action_type.includes('BAN')) { icon = 'fa-ban'; toneClass = 'is-danger'; }
        else if (log.action_type.includes('UNBAN')) { icon = 'fa-unlock'; toneClass = 'is-success'; }
        else if (log.action_type.includes('POINTS')) { icon = 'fa-coins'; toneClass = 'is-warning'; }
        else if (log.action_type.includes('NOTE')) { icon = 'fa-sticky-note'; toneClass = 'is-info'; }
        else if (log.action_type.includes('CLEAR')) { icon = 'fa-trash-alt'; toneClass = 'is-danger'; }
        else if (log.action_type.includes('NOTIFICATION')) { icon = 'fa-bell'; toneClass = 'is-accent'; }
        else if (log.action_type.includes('admin')) { icon = 'fa-user-shield'; toneClass = 'is-accent'; }

        return `
            <div class="audit-item users-audit-item ${toneClass}">
                <div class="audit-icon users-audit-icon ${toneClass}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="audit-content users-audit-content">
                    <div class="audit-header users-audit-header">
                        <span class="users-audit-title">${formatAuditAction(log.action_type)}</span>
                        <span class="users-audit-time">${formatTimeAgo(log.created_at)}</span>
                    </div>
                    <div class="audit-meta users-audit-meta">
                        <i class="fas fa-user-tie users-audit-meta-icon"></i> ${escapeHtml(adminEmail)}
                    </div>
                    ${Object.keys(log.details).length > 0 || log.action_type === 'revoke_admin' ? `
                    <div class="audit-details users-audit-details">
                        ${formatDetails(log.action_type, log.details)}
                    </div>` : ''}

                </div>
            </div>
        `;
    }).join('');
}

function formatAuditAction(action) {
    const map = {
        'BAN_USER': '封禁用户',
        'UNBAN_USER': '解除封禁',
        'UPDATE_POINT': '调整积分',
        'UPDATE_VIP': '修改VIP',
        'CLEAR_CONTENT': '清空内容',
        'ADD_NOTE': '添加备注',
        'SEND_NOTIFICATION': '发送系统通知',
        'RESET_AVATAR': '重置头像',
        'grant_admin': '授予管理员',
        'revoke_admin': '移除管理员',
        'update_admin_permissions': '更新权限'
    };
    return map[action] || action;
}

// ==========================================
// SYSTEM NOTIFICATIONS
// ==========================================
function showNotificationModal(userId) {
    openNotificationModal(userId);
}

function closeNotificationModal() {
    const modal = document.getElementById('notificationModal');
    if (!modal) {
        return;
    }

    modal.classList.remove('active');
}

function selectNotifType(buttonOrType, maybeType = null) {
    const type = maybeType || String(buttonOrType || 'info');
    const btn = buttonOrType instanceof Element
        ? buttonOrType
        : document.querySelector(`#notificationModal .type-btn[data-type="${type}"]`);

    document.querySelectorAll('#notificationModal .type-btn').forEach((button) => button.classList.remove('active'));
    if (btn) {
        btn.classList.add('active');
    }

    const typeInput = document.getElementById('notifType');
    if (typeInput) {
        typeInput.value = type;
    }
}

async function sendSystemNotification(userId, titleArg = null, contentArg = null, typeArg = null) {
    if (!titleArg && userId === '__BATCH__') {
        return executeBatchNotification();
    }

    // Determine if manual (UI) or automated
    const isManual = !titleArg;

    let title = titleArg;
    let content = contentArg;
    let type = typeArg;

    if (isManual) {
        title = document.getElementById('notifTitle').value.trim();
        content = document.getElementById('notifContent').value.trim();
        type = document.getElementById('notifType').value;

        if (!title || !content) {
            alert('请填写完整的标题和内容');
            return;
        }
    }

    // UI Loading State (only if manual)
    let btn = null;
    let originalText = '';

    if (isManual) {
        btn = document.querySelector('#notificationModal .send-notification-btn');
        if (btn) {
            originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            btn.disabled = true;
        }
    }

    try {
        const { error } = await window.supabaseClient
            .from('system_notifications')
            .insert({
                user_id: userId,
                title,
                content,
                type: type || 'info'
            });

        if (error) throw error;

        if (isManual) {
            alert('✅ 通知发送成功');
            closeNotificationModal();
        }

        logAdminAction('SEND_NOTIFICATION', userId, { title, type });

    } catch (err) {
        console.error('Failed to send notification:', err);
        if (isManual) alert('发送失败: ' + err.message);
    } finally {
        if (isManual && btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

// Expose functions globally
window.toggleUserSelection = toggleUserSelection;
window.toggleSelectAllPage = toggleSelectAllPage;
window.showTagInput = showTagInput;
window.renderNotesTab = renderNotesTab;
window.submitUserNote = submitUserNote;
window.renderAuditTab = renderAuditTab;
window.reloadAffiliateModalData = reloadAffiliateModalData;
window.showNotificationModal = showNotificationModal;
window.closeNotificationModal = closeNotificationModal;
window.selectNotifType = selectNotifType;
window.sendSystemNotification = sendSystemNotification;
