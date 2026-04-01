const AdminTickets = {
    tickets: [],
    filteredTickets: [],
    currentPage: 1,
    pageSize: 15,
    currentStatus: 'all',
    searchQuery: '',
    focusedTicketId: '',

    settleWorkspace: async function (delayMs = 60) {
        await new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        });

        if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
    },

    fetchProfilesByIds: async function (userIds = []) {
        const uniqueIds = Array.from(new Set(
            (userIds || [])
                .map((userId) => this.safeText(userId))
                .filter(Boolean)
        ));
        if (!uniqueIds.length) {
            return {};
        }

        const profilesById = {};
        const chunkSize = 200;

        for (let index = 0; index < uniqueIds.length; index += chunkSize) {
            const batch = uniqueIds.slice(index, index + chunkSize);
            const { data, error } = await window.supabaseClient
                .from('profiles')
                .select('id, email')
                .in('id', batch);

            if (error) throw error;

            (data || []).forEach((profile) => {
                const id = this.safeText(profile?.id);
                if (id) {
                    profilesById[id] = {
                        id,
                        email: this.safeText(profile?.email)
                    };
                }
            });
        }

        return profilesById;
    },

    waitForAuthReady: async function (timeoutMs = 2400) {
        const auth = window.supabaseClient?.auth;
        if (!auth?.getUser) {
            return { ready: false, user: null };
        }

        const startedAt = Date.now();
        while ((Date.now() - startedAt) <= timeoutMs) {
            try {
                const { data: { user } = {} } = await auth.getUser();
                if (user?.id) {
                    return { ready: true, user };
                }
            } catch (_) {
                // Retry while auth is restoring.
            }

            await new Promise((resolve) => window.setTimeout(resolve, 120));
        }

        return { ready: false, user: null };
    },

    init: async function (options = {}) {
        if (this._initPromise) return this._initPromise;
        if (this._initialized && options?.force !== true) return;

        console.log('[AdminTickets] Initializing...');
        this._initPromise = this.loadTickets(options)
            .finally(() => {
                this._initPromise = null;
            });
        await this._initPromise;
        this._initialized = true;
    },

    createTableStateRow: function ({ message, icon = 'fa-inbox', variant = 'empty', spinning = false }) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        const wrapper = document.createElement('div');
        const iconNode = document.createElement('i');
        const textNode = document.createElement('span');

        cell.colSpan = 6;
        cell.className = `empty-state admin-ticket-table-state-cell admin-ticket-table-state-cell--${variant}`;

        wrapper.className = 'admin-ticket-table-state';
        iconNode.className = `fas ${icon}${spinning ? ' fa-spin' : ''} admin-ticket-table-state-icon`;
        textNode.className = 'admin-ticket-table-state-text';
        textNode.textContent = this.safeText(message, '暂无数据');

        wrapper.appendChild(iconNode);
        wrapper.appendChild(textNode);
        cell.appendChild(wrapper);
        row.appendChild(cell);
        return row;
    },

    buildTableLoadingSkeleton: function (rowCount = 6) {
        const rows = Math.max(4, Number.parseInt(rowCount, 10) || 6);
        const titleWidths = ['admin-skeleton-w-40', 'admin-skeleton-w-50', 'admin-skeleton-w-60'];
        const metaWidths = ['admin-skeleton-w-30', 'admin-skeleton-w-40'];

        return Array.from({ length: rows }, (_, index) => `
            <tr class="admin-table-skeleton-row admin-ticket-table-skeleton-row" aria-hidden="true" data-skeleton-index="${index}">
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--title ${titleWidths[index % titleWidths.length]}"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line ${metaWidths[index % metaWidths.length]}"></span>
                    </div>
                </td>
                <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span></div></td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-80"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-cell--stack">
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                    </div>
                </td>
                <td>
                    <div class="admin-table-skeleton-cell admin-table-skeleton-actions">
                        <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    loadTickets: async function (options = {}) {
        try {
            const tbody = document.getElementById('ticketsTableBody');
            if (tbody) {
                tbody.innerHTML = this.buildTableLoadingSkeleton();
            }

            await this.waitForAuthReady(Number(options?.authTimeoutMs || 2400));

            const { data, error } = await window.supabaseClient
                .from('shop_tickets')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const rawTickets = data || [];
            let profilesById = {};
            try {
                profilesById = await this.fetchProfilesByIds(rawTickets.map((ticket) => ticket?.user_id));
            } catch (profileError) {
                console.warn('[AdminTickets] profiles load error:', profileError);
            }

            this.tickets = rawTickets.map((ticket) => ({
                ...ticket,
                user_email: this.safeText(profilesById[this.safeText(ticket?.user_id)]?.email)
            }));
            this.applyFilters();
        } catch (err) {
            console.error('[AdminTickets] load error:', err);
            const tbody = document.getElementById('ticketsTableBody');
            if (tbody) {
                tbody.replaceChildren(this.createTableStateRow({
                    message: `加载失败: ${this.safeText(err?.message, '未知错误')}`,
                    icon: 'fa-circle-exclamation',
                    variant: 'error'
                }));
            }
        }
    },

    normalizeTicketStatusValue: function (status) {
        const normalized = this.safeText(status, 'PENDING').trim().toUpperCase();
        return normalized === 'OPEN' ? 'PENDING' : normalized;
    },

    fetchTicketById: async function (ticketId) {
        const normalizedTicketId = this.safeText(ticketId).trim();
        if (!normalizedTicketId) {
            return null;
        }

        await this.waitForAuthReady(2400);
        const { data, error } = await window.supabaseClient
            .from('shop_tickets')
            .select('*')
            .eq('id', normalizedTicketId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        const ticket = data || null;
        if (!ticket) {
            return null;
        }

        const userId = this.safeText(ticket.user_id);
        let userEmail = '';
        if (userId) {
            try {
                const profilesById = await this.fetchProfilesByIds([userId]);
                userEmail = this.safeText(profilesById[userId]?.email);
            } catch (profileError) {
                console.warn('[AdminTickets] single ticket profile load error:', profileError);
            }
        }

        return {
            ...ticket,
            user_email: userEmail
        };
    },

    applyFilters: function () {
        let result = this.tickets;

        if (this.currentStatus !== 'all') {
            result = result.filter(t => {
                const s = (t.status || 'PENDING').toUpperCase();
                // Treat OPEN and PENDING as the same "pending" state
                const normalized = (s === 'OPEN') ? 'PENDING' : s;
                return normalized === this.currentStatus.toUpperCase();
            });
        }

        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            result = result.filter(t =>
                (t.id && t.id.toLowerCase().includes(q)) ||
                (t.order_id && t.order_id.toLowerCase().includes(q)) ||
                (t.user_id && t.user_id.toLowerCase().includes(q)) ||
                (t.user_email && t.user_email.toLowerCase().includes(q)) ||
                (t.reason && t.reason.toLowerCase().includes(q)) ||
                (t.description && t.description.toLowerCase().includes(q))
            );
        }

        this.filteredTickets = result;
        this.currentPage = 1;
        this.render();
    },

    normalizeStatusFilter: function (status) {
        const normalized = this.safeText(status, 'all').trim().toLowerCase();
        if (['pending', 'resolved', 'rejected', 'all'].includes(normalized)) {
            return normalized;
        }
        if (normalized === 'open') {
            return 'pending';
        }
        return 'all';
    },

    syncFilterButtons: function () {
        const buttons = document.querySelectorAll('#module-tickets .filter-btn');
        if (!buttons.length) {
            return;
        }
        buttons.forEach((button) => {
            button.classList.toggle('active', button.dataset.ticketStatus === this.currentStatus);
        });
    },

    syncSearchInput: function () {
        const input = document.getElementById('ticketSearchInput');
        if (input) {
            input.value = this.searchQuery || '';
        }
    },

    getFocusedTicketIndex: function (tickets = [], focusedTicketId = '') {
        const normalizedTicketId = this.safeText(focusedTicketId).trim();
        if (!normalizedTicketId) {
            return -1;
        }
        return tickets.findIndex((ticket) => this.safeText(ticket?.id).trim() === normalizedTicketId);
    },

    scrollFocusedTicketIntoView: function () {
        const normalizedTicketId = this.safeText(this.focusedTicketId).trim();
        if (!normalizedTicketId || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
            return;
        }

        window.requestAnimationFrame(() => {
            const row = document.querySelector(`#ticketsTableBody [data-ticket-id="${CSS.escape(normalizedTicketId)}"]`);
            if (row instanceof HTMLElement) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    },

    search: function () {
        this.searchQuery = document.getElementById('ticketSearchInput').value.trim();
        this.applyFilters();
    },

    focusTicket: async function (ticketId, options = {}) {
        const normalizedTicketId = this.safeText(ticketId).trim();
        if (!normalizedTicketId) {
            return { opened: false, matched: false };
        }

        await this.init({ force: !this.tickets.length });

        let targetTicket = this.tickets.find((ticket) => this.safeText(ticket?.id).trim() === normalizedTicketId) || null;
        if (!targetTicket) {
            try {
                targetTicket = await this.fetchTicketById(normalizedTicketId);
            } catch (error) {
                console.warn('[AdminTickets] Failed to fetch target ticket by id:', error);
            }
            if (targetTicket) {
                this.tickets = [
                    targetTicket,
                    ...this.tickets.filter((ticket) => this.safeText(ticket?.id).trim() !== normalizedTicketId)
                ];
            }
        }

        this.focusedTicketId = normalizedTicketId;
        const targetStatus = targetTicket
            ? this.normalizeStatusFilter(this.normalizeTicketStatusValue(targetTicket.status))
            : this.normalizeStatusFilter(options.status || this.currentStatus || 'all');
        this.currentStatus = targetStatus;
        this.searchQuery = normalizedTicketId;
        this.syncSearchInput();
        this.syncFilterButtons();
        this.applyFilters();

        const matched = this.getFocusedTicketIndex(this.filteredTickets, normalizedTicketId) >= 0;
        return {
            opened: true,
            matched
        };
    },

    safeText: function (value, fallback = '') {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
    },

    getTicketLinkProtocol: function () {
        return window.AdminTicketLinks || null;
    },

    parseLinkedChatSessionContext: function (description = '') {
        const protocol = this.getTicketLinkProtocol();
        if (protocol?.parseLinkedChatSessionContext) {
            return protocol.parseLinkedChatSessionContext(this.safeText(description));
        }
        return null;
    },

    inferLinkedOpsAlertCategoryKey: function (context = {}) {
        const protocol = this.getTicketLinkProtocol();
        if (protocol?.inferLinkedOpsAlertCategoryKey) {
            return protocol.inferLinkedOpsAlertCategoryKey(context);
        }
        return '';
    },

    parseLinkedOpsAlertContext: function (description = '') {
        const protocol = this.getTicketLinkProtocol();
        if (protocol?.parseLinkedOpsAlertContext) {
            return protocol.parseLinkedOpsAlertContext(this.safeText(description));
        }
        return null;
    },

    getOpsAlertWorkspaceActionForContext: function (context = {}) {
        if (typeof window.getOpsAlertWorkspaceAction !== 'function') {
            return null;
        }

        return window.getOpsAlertWorkspaceAction({
            categoryKey: this.safeText(context.category_key).trim().toLowerCase(),
            alertType: this.safeText(context.alert_type).trim().toLowerCase(),
            targetId: this.safeText(context.target_id).trim().toLowerCase()
        }, {
            labelVariant: 'ticket'
        });
    },

    resolveTicketRecord: async function (ticketOrId) {
        if (ticketOrId && typeof ticketOrId === 'object') {
            return ticketOrId;
        }

        const normalizedTicketId = this.safeText(ticketOrId).trim();
        if (!normalizedTicketId) {
            return null;
        }

        return this.tickets.find((ticket) => this.safeText(ticket?.id).trim() === normalizedTicketId)
            || this.filteredTickets.find((ticket) => this.safeText(ticket?.id).trim() === normalizedTicketId)
            || await this.fetchTicketById(normalizedTicketId);
    },

    getWorkbenchLauncher: function () {
        return window.openAdminWorkbenchEntry || window.openOpsAlertWorkspace || null;
    },

    openWorkbenchEntry: async function (workspaceKey, context = {}) {
        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher !== 'function') {
            return false;
        }
        return launcher(workspaceKey, context);
    },

    buildTicketWorkbenchEntry: function (ticket = {}, target = 'chat') {
        const linkedChatContext = this.parseLinkedChatSessionContext(ticket.description);
        const linkedOpsAlertContext = this.parseLinkedOpsAlertContext(ticket.description);
        const sourceAction = linkedOpsAlertContext ? this.getOpsAlertWorkspaceActionForContext(linkedOpsAlertContext) : null;

        if (typeof window.buildTicketWorkbenchEntry === 'function') {
            return window.buildTicketWorkbenchEntry(target, ticket, {
                linkedChatContext,
                linkedOpsAlertContext,
                workspaceAction: sourceAction
            });
        }

        const normalizedTarget = this.safeText(target).trim().toLowerCase() || 'chat';
        if (normalizedTarget === 'chat') {
            const searchValue = this.safeText(
                linkedChatContext?.session_id
                || linkedChatContext?.user_email
                || ticket.user_email
                || ticket.user_id
            ).trim();
            if (!searchValue) {
                return null;
            }
            return {
                workspaceKey: 'chat-session',
                context: {
                    sessionId: linkedChatContext?.session_id || '',
                    session_id: linkedChatContext?.session_id || '',
                    email: linkedChatContext?.user_email || ticket.user_email || '',
                    userId: this.safeText(ticket.user_id).trim(),
                    referenceLabel: linkedChatContext?.session_id
                        ? '会话ID'
                        : (linkedChatContext?.user_email || ticket.user_email ? '邮箱' : '用户ID'),
                    referenceValue: searchValue,
                    targetId: this.safeText(ticket.id).trim(),
                    target_id: this.safeText(ticket.id).trim(),
                    ticketId: this.safeText(ticket.id).trim(),
                    ticketStatus: this.safeText(ticket.status).trim()
                }
            };
        }

        if (normalizedTarget === 'order') {
            const orderId = this.safeText(ticket.order_id).trim();
            if (!orderId) {
                return null;
            }
            return {
                workspaceKey: 'shop-risk-orders',
                context: {
                    orderId,
                    targetId: orderId,
                    target_id: orderId,
                    referenceLabel: '订单号',
                    referenceValue: orderId
                }
            };
        }

        if (normalizedTarget === 'user') {
            const userId = this.safeText(ticket.user_id).trim();
            const userEmail = this.safeText(ticket.user_email).trim();
            const searchValue = userId || userEmail;
            if (!searchValue) {
                return null;
            }
            return {
                workspaceKey: 'shop-risk-users',
                context: {
                    userId,
                    email: userEmail,
                    targetId: searchValue,
                    target_id: searchValue,
                    referenceLabel: userId ? '用户' : '邮箱',
                    referenceValue: searchValue
                }
            };
        }

        if (normalizedTarget === 'source' && linkedOpsAlertContext && sourceAction?.target && !['tickets-pending', 'tickets-resolved'].includes(sourceAction.target)) {
            return {
                workspaceKey: sourceAction.target,
                label: sourceAction.label || '',
                context: {
                    alertType: linkedOpsAlertContext.alert_type,
                    targetId: linkedOpsAlertContext.target_id,
                    target_id: linkedOpsAlertContext.target_id,
                    referenceLabel: linkedOpsAlertContext.reference_label,
                    referenceValue: linkedOpsAlertContext.reference_value,
                    ticketId: this.safeText(ticket.id).trim(),
                    ticketStatus: this.safeText(ticket.status).trim()
                }
            };
        }

        return null;
    },

    openWorkbench: async function (ticketOrId, target = 'chat') {
        const ticket = await this.resolveTicketRecord(ticketOrId);
        if (!ticket) {
            window.showToast?.('未找到可处理的工单上下文', 'warning');
            return false;
        }

        const normalizedTarget = this.safeText(target).trim().toLowerCase() || 'chat';
        const launcher = this.getWorkbenchLauncher();
        const workbenchEntry = this.buildTicketWorkbenchEntry(ticket, normalizedTarget);

        if (!workbenchEntry) {
            if (normalizedTarget === 'chat') {
                window.showToast?.('这张工单没有关联可回溯的客服会话', 'info');
                return false;
            }
            if (normalizedTarget === 'order') {
                window.showToast?.('这张工单没有关联订单', 'info');
                return false;
            }
            if (normalizedTarget === 'user') {
                window.showToast?.('这张工单没有关联用户', 'info');
                return false;
            }
            if (normalizedTarget === 'source') {
                const linkedOpsAlertContext = this.parseLinkedOpsAlertContext(ticket.description);
                if (!linkedOpsAlertContext) {
                    window.showToast?.('这张工单没有关联原始站内代办', 'info');
                } else {
                    window.showToast?.('当前原始代办仍指向工单处理页，无需重复跳转', 'info');
                }
                return false;
            }
            window.showToast?.('未识别的工单工作台入口', 'warning');
            return false;
        }

        if (typeof launcher !== 'function') {
            if (normalizedTarget === 'chat') {
                window.showToast?.('客服工作台尚未就绪', 'warning');
            } else if (normalizedTarget === 'source') {
                window.showToast?.('当前页面暂时无法回到原始处理入口', 'warning');
            } else if (normalizedTarget === 'order') {
                window.showToast?.('当前页面暂时无法打开关联订单', 'warning');
            } else if (normalizedTarget === 'user') {
                window.showToast?.('当前页面暂时无法打开关联用户', 'warning');
            } else {
                window.showToast?.('当前页面暂时无法打开对应工作区', 'warning');
            }
            return false;
        }

        if (normalizedTarget === 'chat') {
            return this.openWorkbenchEntry(workbenchEntry.workspaceKey, workbenchEntry.context || {}) || false;
        }

        if (normalizedTarget === 'order') {
            return this.openWorkbenchEntry(workbenchEntry.workspaceKey, workbenchEntry.context || {}) || false;
        }

        if (normalizedTarget === 'user') {
            return this.openWorkbenchEntry(workbenchEntry.workspaceKey, workbenchEntry.context || {}) || false;
        }

        if (normalizedTarget === 'source') {
            return this.openWorkbenchEntry(workbenchEntry.workspaceKey, workbenchEntry.context || {}) || false;
        }

        window.showToast?.('未识别的工单工作台入口', 'warning');
        return false;
    },

    buildWorkbenchActionDefinitions: function (ticket = {}) {
        const actions = [];

        if (this.buildTicketWorkbenchEntry(ticket, 'chat')) {
            actions.push({
                icon: 'fa-comments',
                title: '回到客服会话',
                variant: 'chat',
                target: 'chat'
            });
        }

        if (this.buildTicketWorkbenchEntry(ticket, 'order')) {
            actions.push({
                icon: 'fa-bag-shopping',
                title: '查看关联订单',
                variant: 'order',
                target: 'order'
            });
        }

        if (this.buildTicketWorkbenchEntry(ticket, 'user')) {
            actions.push({
                icon: 'fa-user',
                title: '查看用户详情',
                variant: 'user',
                target: 'user'
            });
        }

        const sourceEntry = this.buildTicketWorkbenchEntry(ticket, 'source');
        if (sourceEntry) {
            actions.push({
                icon: 'fa-sitemap',
                title: `回到原始处理入口：${sourceEntry.label || '站内代办'}`,
                variant: 'source',
                target: 'source'
            });
        }

        return actions.slice(0, 4);
    },

    truncateText: function (value, maxLength) {
        const text = this.safeText(value);
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    },

    createStatusBadge: function (status) {
        const badge = document.createElement('span');
        const normalizedStatus = this.safeText(status, 'UNKNOWN').toUpperCase();
        badge.className = `status-badge admin-ticket-status-badge admin-ticket-status-badge--${normalizedStatus.toLowerCase()}`;

        if (normalizedStatus === 'PENDING') {
            badge.textContent = '待处理';
        } else if (normalizedStatus === 'RESOLVED') {
            badge.textContent = '已解决';
        } else if (normalizedStatus === 'REJECTED') {
            badge.textContent = '已拒绝';
        } else {
            badge.textContent = normalizedStatus;
        }

        return badge;
    },

    createActionButton: function ({ icon, title, variant, onClick }) {
        const button = document.createElement('button');
        button.className = `action-btn admin-ticket-action-btn admin-ticket-action-btn--${variant}`;
        button.type = 'button';
        button.title = title;
        button.innerHTML = `<i class="fas ${icon}"></i>`;
        button.setAttribute('aria-label', title);
        button.addEventListener('click', onClick);
        return button;
    },

    filter: function (status, btnElement) {
        this.currentStatus = this.normalizeStatusFilter(status);

        // Fix: Use .filter-btn as defined in the HTML
        const buttons = document.querySelectorAll('#module-tickets .filter-btn');
        if (buttons.length > 0) {
            buttons.forEach(b => b.classList.remove('active'));
            if (btnElement) btnElement.classList.add('active');
        }

        this.applyFilters();
    },

    render: function () {
        const tbody = document.getElementById('ticketsTableBody');
        if (!tbody) return;

        const totalItems = this.filteredTickets.length;
        const totalPages = Math.ceil(totalItems / this.pageSize) || 1;

        const focusedIndex = this.getFocusedTicketIndex(this.filteredTickets, this.focusedTicketId);
        if (focusedIndex >= 0) {
            this.currentPage = Math.floor(focusedIndex / this.pageSize) + 1;
        }

        if (this.currentPage > totalPages) this.currentPage = totalPages;

        const startIdx = (this.currentPage - 1) * this.pageSize;
        const endIdx = startIdx + this.pageSize;
        const currentData = this.filteredTickets.slice(startIdx, endIdx);

        if (currentData.length === 0) {
            tbody.replaceChildren(this.createTableStateRow({
                message: '暂无符合条件的工单',
                icon: 'fa-inbox',
                variant: 'empty'
            }));
            this.renderPagination(totalPages);
            return;
        }

        tbody.replaceChildren();

        currentData.forEach(ticket => {
            const dateStr = new Date(ticket.created_at).toLocaleString('zh-CN', { hour12: false });
            const rawStatus = (ticket.status || 'PENDING').toUpperCase();
            // Normalize: treat OPEN as PENDING
            const status = (rawStatus === 'OPEN') ? 'PENDING' : rawStatus;

            // Support both 'reason' and 'description' fields (WalletModal writes to 'description')
            const reasonText = this.safeText(ticket.reason || ticket.description, '无描述');
            const reasonPreview = this.truncateText(reasonText, 20);

            // Truncate admin reply for table display
            const adminNotesText = this.safeText(ticket.admin_notes);
            const adminNotesPreview = this.truncateText(adminNotesText, 20);

            const row = document.createElement('tr');
            const isFocusedTicket = this.safeText(ticket.id).trim() === this.safeText(this.focusedTicketId).trim();
            row.className = `admin-ticket-row${isFocusedTicket ? ' admin-ticket-row--focused' : ''}`;
            row.dataset.ticketId = this.safeText(ticket.id);

            const metaCell = document.createElement('td');
            metaCell.className = 'admin-ticket-nowrap-cell';
            const idDiv = document.createElement('div');
            idDiv.className = 'admin-ticket-meta-id';
            idDiv.textContent = `${this.safeText(ticket.id).substring(0, 8)}...`;
            const dateDiv = document.createElement('div');
            dateDiv.className = 'admin-ticket-meta-date';
            dateDiv.textContent = dateStr;
            metaCell.appendChild(idDiv);
            metaCell.appendChild(dateDiv);

            const orderCell = document.createElement('td');
            orderCell.className = 'admin-ticket-nowrap-cell';
            const orderDiv = document.createElement('div');
            orderDiv.className = 'admin-ticket-copyable admin-ticket-copyable--order';
            orderDiv.title = '点击复制';
            const orderId = this.safeText(ticket.order_id);
            orderDiv.textContent = orderId ? `${orderId.substring(0, 18)}...` : '-';
            orderDiv.addEventListener('click', () => this.copyText(orderId));
            orderCell.appendChild(orderDiv);

            const userCell = document.createElement('td');
            userCell.className = 'admin-ticket-nowrap-cell';
            const userDiv = document.createElement('div');
            userDiv.className = 'admin-ticket-copyable admin-ticket-copyable--user';
            userDiv.title = '点击复制';
            const userId = this.safeText(ticket.user_id);
            userDiv.textContent = userId ? `${userId.substring(0, 8)}...` : '-';
            userDiv.addEventListener('click', () => this.copyText(userId));
            userCell.appendChild(userDiv);

            const userEmail = this.safeText(ticket.user_email);
            const emailDiv = document.createElement('div');
            emailDiv.className = 'admin-ticket-meta-date admin-ticket-user-email';
            emailDiv.textContent = userEmail || '无邮箱';
            if (userEmail) {
                emailDiv.classList.add('admin-ticket-copyable');
                emailDiv.title = '点击复制邮箱';
                emailDiv.addEventListener('click', () => this.copyText(userEmail));
            }
            userCell.appendChild(emailDiv);

            const reasonCell = document.createElement('td');
            const reasonDiv = document.createElement('div');
            reasonDiv.className = 'admin-ticket-reason-preview';
            reasonDiv.title = reasonText;
            reasonDiv.textContent = reasonPreview;
            reasonCell.appendChild(reasonDiv);

            if (adminNotesText) {
                const notesDiv = document.createElement('div');
                notesDiv.className = 'admin-ticket-notes-preview';
                notesDiv.title = `点击复制回复: ${adminNotesText}`;
                notesDiv.textContent = `回复: ${adminNotesPreview}`;
                notesDiv.addEventListener('click', () => this.copyText(adminNotesText));
                reasonCell.appendChild(notesDiv);
            }

            const statusCell = document.createElement('td');
            statusCell.className = 'ticket-status-cell';
            statusCell.appendChild(this.createStatusBadge(status));

            const actionCell = document.createElement('td');
            const actionWrap = document.createElement('div');
            actionWrap.className = 'admin-ticket-action-wrap';

            this.buildWorkbenchActionDefinitions(ticket).forEach((action) => {
                actionWrap.appendChild(this.createActionButton({
                    icon: action.icon,
                    title: action.title,
                    variant: action.variant,
                    onClick: () => this.openWorkbench(ticket, action.target)
                }));
            });

            if (status === 'PENDING') {
                actionWrap.appendChild(this.createActionButton({
                    icon: 'fa-check',
                    title: '解决工单',
                    variant: 'resolve',
                    onClick: () => this.openReplyModal(ticket.id, 'RESOLVED')
                }));
                actionWrap.appendChild(this.createActionButton({
                    icon: 'fa-times',
                    title: '拒绝/关闭',
                    variant: 'reject',
                    onClick: () => this.openReplyModal(ticket.id, 'REJECTED')
                }));
            } else {
                const processedText = document.createElement('span');
                processedText.className = 'admin-ticket-processed-text';
                processedText.textContent = '已处理';
                actionWrap.appendChild(processedText);
            }

            actionCell.appendChild(actionWrap);

            row.appendChild(metaCell);
            row.appendChild(orderCell);
            row.appendChild(userCell);
            row.appendChild(reasonCell);
            row.appendChild(statusCell);
            row.appendChild(actionCell);
            tbody.appendChild(row);
        });

        this.renderPagination(totalPages);
        if (focusedIndex >= 0) {
            this.scrollFocusedTicketIntoView();
        }
    },

    renderPagination: function (totalPages) {
        const container = document.getElementById('ticketsPagination');
        if (!container) return;

        container.innerHTML = `
            <div class="admin-ticket-pagination-shell">
                <div class="pagination-control">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="tickets-pagination-go"
                        data-ticket-page="${Math.max(this.currentPage - 1, 1)}"
                        ${this.currentPage <= 1 ? 'disabled' : ''}>−</button>
                    <input type="number" class="pagination-input" value="${this.currentPage}" min="1" max="${totalPages}"
                        data-admin-change-action="tickets-pagination-go">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="tickets-pagination-go"
                        data-ticket-page="${Math.min(this.currentPage + 1, totalPages)}"
                        ${this.currentPage >= totalPages ? 'disabled' : ''}>+</button>
                </div>
                <div class="pagination-total pagination-total--compact">共 ${totalPages} 页 / ${this.filteredTickets.length} 条</div>
            </div>
        `;
    },

    changePage: function (page) {
        this.currentPage = page;
        this.render();
    },

    openReplyModal: function (ticketId, newStatus) {
        document.getElementById('replyTicketId').value = ticketId;
        document.getElementById('replyNewStatus').value = newStatus;
        document.getElementById('ticketAdminReply').value = '';
        document.getElementById('ticketRefundCheckbox').checked = false;

        const modal = document.getElementById('ticketReplyModal');
        modal.classList.add('is-visible');
        modal.setAttribute('aria-hidden', 'false');
        modal.querySelector('.modal-title').textContent = newStatus === 'RESOLVED' ? '解决工单' : '拒绝工单';
    },

    closeReplyModal: function () {
        const modal = document.getElementById('ticketReplyModal');
        if (!modal) return;
        modal.classList.remove('is-visible');
        modal.setAttribute('aria-hidden', 'true');
    },

    getAdminAuthHeaders: async function () {
        if (window.AdminAI?.getAuthHeaders) {
            return window.AdminAI.getAuthHeaders();
        }

        const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
        return {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        };
    },

    submitReply: async function () {
        const ticketId = document.getElementById('replyTicketId').value;
        const newStatus = document.getElementById('replyNewStatus').value;
        const adminReply = document.getElementById('ticketAdminReply').value.trim();
        const doRefund = document.getElementById('ticketRefundCheckbox').checked;

        if (!adminReply && newStatus === 'REJECTED') {
            alert("拒绝工单时请填写回复理由");
            return;
        }

        const btn = document.querySelector('#ticketReplyModal .btn-primary');
        const originText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '处理中...';

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch('/api/admin/tickets/process', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ticketId,
                    newStatus,
                    adminReply,
                    doRefund
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '工单处理失败');
            }

            // Close modal
            this.closeReplyModal();

            alert("已完成工单处理" + (doRefund ? " 并退还积分" : ""));

            this.loadTickets();

        } catch (err) {
            alert('处理失败: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originText;
        }
    },

    copyText: function (text) {
        navigator.clipboard.writeText(text).then(() => {
            if (typeof window.showToast === 'function') {
                window.showToast('已复制', 'success');
            } else {
                const toast = document.createElement('div');
                toast.className = 'admin-ticket-copy-toast';
                toast.textContent = '已复制';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2000);
            }
        });
    }
};

window.AdminTickets = AdminTickets;
