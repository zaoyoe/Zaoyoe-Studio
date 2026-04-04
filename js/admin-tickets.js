const AdminTickets = {
    tickets: [],
    filteredTickets: [],
    currentPage: 1,
    pageSize: 12,
    pagination: {
        page: 1,
        pageSize: 12,
        totalItems: 0,
        totalPages: 1,
        hasPrevPage: false,
        hasNextPage: false,
        returnedItems: 0
    },
    currentStatus: 'all',
    quickFilters: {
        overdueOnly: false,
        priority: 'all',
        assignee: 'all'
    },
    currentWorkspaceView: 'queue',
    overview: null,
    overviewErrorMessage: '',
    selectedTicketIds: [],
    searchQuery: '',
    focusedTicketId: '',
    activeReminderSummaryJobId: '',
    reminderSummaryJobHistoryById: {},
    reminderSummaryJobNoteDrafts: {},
    reminderSummaryJobNoteSavingId: '',
    searchDebounceMs: 220,
    ticketReplyTemplateConfigTemplates: null,
    opsAlertsConfigSnapshot: null,
    _ticketReplyTemplateConfigLoaded: false,

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

    updateCurrentAdminIdentity: function (user = null) {
        const normalizedUser = user && typeof user === 'object' ? user : {};
        this._currentAdminIdentity = {
            id: this.safeText(normalizedUser?.id).trim(),
            email: this.safeText(normalizedUser?.email).trim()
        };
        if (this._currentAdminIdentity.id) {
            window.__adminUserId = this._currentAdminIdentity.id;
        }
        if (this._currentAdminIdentity.email) {
            window.__adminUserEmail = this._currentAdminIdentity.email;
        }
        return this._currentAdminIdentity;
    },

    getCurrentAdminIdentity: function () {
        const cachedIdentity = this._currentAdminIdentity || {};
        return {
            id: this.safeText(cachedIdentity.id || window.__adminUserId).trim(),
            email: this.safeText(cachedIdentity.email || window.__adminUserEmail).trim()
        };
    },

    init: async function (options = {}) {
        if (this._initPromise) return this._initPromise;
        if (this._initialized && options?.force !== true) return;

        console.log('[AdminTickets] Initializing...');
        this.syncTicketWorkspaceView();
        this._initPromise = Promise.all([
            this.loadOverview({
                showSkeleton: options.showOverviewSkeleton !== false
            }),
            this.loadTickets(options)
        ])
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

        cell.colSpan = 7;
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
                <td><div class="admin-table-skeleton-cell"><span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-xs"></span></div></td>
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

    buildAdminTicketsUrl: function (route = '', params = {}) {
        const origin = window.location?.origin || 'http://localhost';
        const url = new URL('/api/admin', origin);
        const normalizedRoute = this.safeText(route).trim();

        if (normalizedRoute) {
            url.searchParams.set('route', normalizedRoute);
        }

        Object.entries(params || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') {
                return;
            }
            url.searchParams.set(key, String(value));
        });

        return `${url.pathname}${url.search}`;
    },

    getTicketsListUrl: function (options = {}) {
        const page = Math.max(1, Number.parseInt(options.page ?? this.currentPage, 10) || 1);
        const status = this.normalizeStatusFilter(options.status ?? this.currentStatus);
        const query = this.safeText(options.searchQuery ?? this.searchQuery).trim();
        const overdueOnly = this.normalizeBooleanFlag(options.overdueOnly ?? this.quickFilters.overdueOnly);
        const priority = this.normalizePriorityFilter(options.priority ?? this.quickFilters.priority);
        const assignee = this.normalizeAssigneeFilter(options.assignee ?? this.quickFilters.assignee);
        const params = {
            page,
            pageSize: this.pageSize,
            status
        };

        if (query) {
            params.query = query;
        }
        if (overdueOnly) {
            params.overdue = '1';
        }
        if (priority === 'high') {
            params.priority = 'high';
        }
        if (assignee !== 'all') {
            params.assignee = assignee;
        }

        return this.buildAdminTicketsUrl('tickets/list', params);
    },

    getTicketsAssignUrl: function () {
        return this.buildAdminTicketsUrl('tickets/assign');
    },

    getTicketsBatchProcessUrl: function () {
        return this.buildAdminTicketsUrl('tickets/batch-process');
    },

    getTicketHistoryUrl: function (ticketId = '') {
        const normalizedTicketId = this.safeText(ticketId).trim();
        return this.buildAdminTicketsUrl('tickets/history', normalizedTicketId ? { ticketId: normalizedTicketId } : {});
    },

    getTicketsMetricsUrl: function () {
        return this.buildAdminTicketsUrl('tickets/metrics');
    },

    getTicketsSummaryActionsUrl: function () {
        return this.buildAdminTicketsUrl('tickets/summary-actions');
    },

    getTicketsSummaryHistoryUrl: function (jobId = '') {
        const normalizedJobId = this.safeText(jobId).trim();
        return this.buildAdminTicketsUrl('tickets/summary-history', normalizedJobId ? { jobId: normalizedJobId } : {});
    },

    normalizeTicketWorkspaceView: function (value = '') {
        const normalized = this.safeText(value, this.currentWorkspaceView || 'queue').trim().toLowerCase();
        if (normalized === 'batch') {
            return 'queue';
        }
        if (['queue', 'overview', 'summary'].includes(normalized)) {
            return normalized;
        }
        return 'queue';
    },

    getTicketWorkspaceMeta: function (view = '') {
        const normalizedView = this.normalizeTicketWorkspaceView(view);
        const metaByView = {
            queue: {
                title: '工单处理',
                subtitle: '把搜索、筛选、逐单处理和批量动作收在同一个工作区里。'
            },
            overview: {
                title: 'SLA 看板',
                subtitle: '集中查看积压、来源分布和处理效率，先判断队列节奏再决定动作。'
            },
            summary: {
                title: '汇总追踪',
                subtitle: '聚焦超时提醒、日报外发和重试记录，适合复盘异常与交接跟进。'
            }
        };
        return metaByView[normalizedView] || metaByView.queue;
    },

    getTicketWorkspaceTargetId: function (view = '') {
        const normalizedView = this.normalizeTicketWorkspaceView(view);
        if (normalizedView === 'overview') {
            return 'ticketsOverviewPanel';
        }
        if (normalizedView === 'summary') {
            return 'ticketsOverviewReminderSection';
        }
        return 'ticketsQueueControls';
    },

    syncTicketWorkspaceView: function (view = '') {
        const moduleElement = document.getElementById('module-tickets');
        const moduleDatasetView = this.safeText(moduleElement?.dataset?.ticketWorkspace).trim().toLowerCase();
        const normalizedView = this.normalizeTicketWorkspaceView(view || moduleDatasetView || this.currentWorkspaceView);
        const meta = this.getTicketWorkspaceMeta(normalizedView);
        const tabEntries = [
            ['queue', document.getElementById('ticketWorkspaceQueueTab')],
            ['overview', document.getElementById('ticketWorkspaceOverviewTab')],
            ['summary', document.getElementById('ticketWorkspaceSummaryTab')]
        ];
        const titleNode = document.getElementById('ticketsWorkspaceTitle');
        const subtitleNode = document.getElementById('ticketsWorkspaceSubtitle');

        this.currentWorkspaceView = normalizedView;

        if (moduleElement?.dataset) {
            moduleElement.dataset.ticketWorkspace = normalizedView;
        }

        tabEntries.forEach(([workspace, button]) => {
            if (!button) {
                return;
            }

            const isActive = workspace === normalizedView;
            if (button.classList?.add && button.classList?.remove) {
                if (isActive) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            }
            if (typeof button.setAttribute === 'function') {
                button.setAttribute('aria-selected', isActive ? 'true' : 'false');
                button.setAttribute('tabindex', isActive ? '0' : '-1');
            }
        });

        if (titleNode) {
            titleNode.textContent = meta.title;
        }
        if (subtitleNode) {
            subtitleNode.textContent = meta.subtitle;
        }

        this.syncReminderWorkspacePresentation({
            rerender: true,
            mode: normalizedView
        });

        return normalizedView;
    },

    setWorkspaceView: function (view = '', options = {}) {
        const normalizedView = this.syncTicketWorkspaceView(view);
        const targetId = this.safeText(options?.targetId || this.getTicketWorkspaceTargetId(normalizedView)).trim();
        const shouldScroll = options?.scroll !== false;
        const shouldHighlight = options?.highlight !== false;

        if (!targetId || (!shouldScroll && !shouldHighlight)) {
            return normalizedView;
        }

        const activateTarget = () => {
            const target = document.getElementById(targetId);
            if (!target) {
                return;
            }

            if (shouldHighlight && target.classList?.add) {
                target.classList.add('admin-ticket-workspace-anchor--active');
                window.setTimeout(() => {
                    target.classList?.remove?.('admin-ticket-workspace-anchor--active');
                }, 1400);
            }

            if (shouldScroll && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        };

        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(activateTarget);
        });

        return normalizedView;
    },

    normalizeOverviewPayload: function (payload = {}) {
        const normalizeCount = (value) => Math.max(0, Number.parseInt(value, 10) || 0);
        const normalizePercent = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(1))) : 0;
        };
        const normalizeMaybeMinutes = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
        };
        const normalizeBreakdown = (items = []) => (Array.isArray(items) ? items : []).map((item) => ({
            key: this.safeText(item?.key, 'other').trim() || 'other',
            label: this.safeText(item?.label, '其他').trim() || '其他',
            count: normalizeCount(item?.count),
            share_percent: normalizePercent(item?.share_percent)
        }));
        const normalizeChannelList = (value) => {
            if (Array.isArray(value)) {
                return value
                    .map((item) => this.safeText(item).trim().toLowerCase())
                    .filter(Boolean);
            }
            return [];
        };
        const normalizeReminderActivityEntry = (entry = null) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const latestAttempt = entry?.latest_attempt && typeof entry.latest_attempt === 'object'
                ? entry.latest_attempt
                : {};

            return {
                kind: ['overdue', 'recovered'].includes(this.safeText(entry?.kind).trim().toLowerCase())
                    ? this.safeText(entry?.kind).trim().toLowerCase()
                    : 'overdue',
                status: this.safeText(entry?.status, 'unknown').trim().toLowerCase() || 'unknown',
                severity: this.safeText(entry?.severity, 'warning').trim().toLowerCase() || 'warning',
                title: this.safeText(entry?.title, '').trim(),
                ticket_id: this.safeText(entry?.ticket_id, '').trim(),
                target_id: this.safeText(entry?.target_id, '').trim(),
                wait_label: this.safeText(entry?.wait_label, '').trim(),
                created_at: this.safeText(entry?.created_at, '').trim(),
                delivered_at: this.safeText(entry?.delivered_at, '').trim(),
                attempt_count: normalizeCount(entry?.attempt_count),
                channels: normalizeChannelList(entry?.channels),
                remaining_channels: normalizeChannelList(entry?.remaining_channels),
                last_error: this.safeText(entry?.last_error, '').trim(),
                latest_attempt: this.safeText(latestAttempt?.channel).trim() || this.safeText(latestAttempt?.status).trim() || this.safeText(latestAttempt?.created_at).trim()
                    ? {
                        channel: this.safeText(latestAttempt?.channel, '').trim().toLowerCase(),
                        status: this.safeText(latestAttempt?.status, '').trim().toLowerCase(),
                        response_status: Number.isFinite(Number(latestAttempt?.response_status)) ? Number(latestAttempt.response_status) : null,
                        error_message: this.safeText(latestAttempt?.error_message, '').trim(),
                        created_at: this.safeText(latestAttempt?.created_at, '').trim()
                    }
                    : null
            };
        };
        const normalizeReminderSummaryPreviewItem = (item = null) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const ticketStatus = this.normalizeTicketStatusValue(item?.ticket_status || '');
            const ticketId = this.safeText(item?.ticket_id, '').trim();
            if (!ticketId) {
                return null;
            }

            return {
                ticket_id: ticketId,
                order_id: this.safeText(item?.order_id, '').trim(),
                user_id: this.safeText(item?.user_id, '').trim(),
                user_email: this.safeText(item?.user_email, '').trim(),
                wait_label: this.safeText(item?.wait_label, '').trim(),
                responsible_label: this.safeText(item?.responsible_label, '').trim(),
                ticket_status: ticketStatus,
                ticket_status_label: this.safeText(item?.ticket_status_label, '').trim() || this.getTicketStatusLabel(ticketStatus),
                reason: this.safeText(item?.reason, '').trim(),
                updated_at: this.safeText(item?.updated_at, '').trim()
            };
        };
        const normalizeReminderSummaryDigestEntry = (entry = null) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const latestAttempt = entry?.latest_attempt && typeof entry.latest_attempt === 'object'
                ? entry.latest_attempt
                : {};
            const latestManualEvent = entry?.latest_manual_event && typeof entry.latest_manual_event === 'object'
                ? entry.latest_manual_event
                : {};
            const previewItems = (Array.isArray(entry?.preview_items) ? entry.preview_items : [])
                .map((item) => normalizeReminderSummaryPreviewItem(item))
                .filter(Boolean);

            return {
                id: this.safeText(entry?.id, '').trim(),
                status: this.safeText(entry?.status, 'unknown').trim().toLowerCase() || 'unknown',
                severity: this.safeText(entry?.severity, 'warning').trim().toLowerCase() || 'warning',
                title: this.safeText(entry?.title, '').trim(),
                created_at: this.safeText(entry?.created_at, '').trim(),
                updated_at: this.safeText(entry?.updated_at, '').trim(),
                delivered_at: this.safeText(entry?.delivered_at, '').trim(),
                attempt_count: normalizeCount(entry?.attempt_count),
                max_attempts: normalizeCount(entry?.max_attempts),
                next_retry_at: this.safeText(entry?.next_retry_at, '').trim(),
                channels: normalizeChannelList(entry?.channels),
                remaining_channels: normalizeChannelList(entry?.remaining_channels),
                last_error: this.safeText(entry?.last_error, '').trim(),
                latest_attempt: this.safeText(latestAttempt?.channel).trim() || this.safeText(latestAttempt?.status).trim() || this.safeText(latestAttempt?.created_at).trim()
                    ? {
                        channel: this.safeText(latestAttempt?.channel, '').trim().toLowerCase(),
                        status: this.safeText(latestAttempt?.status, '').trim().toLowerCase(),
                        response_status: Number.isFinite(Number(latestAttempt?.response_status)) ? Number(latestAttempt.response_status) : null,
                        error_message: this.safeText(latestAttempt?.error_message, '').trim(),
                        created_at: this.safeText(latestAttempt?.created_at, '').trim()
                    }
                    : null,
                summary_schedule_mode: ['rolling_window', 'hourly', 'daily'].includes(this.safeText(entry?.summary_schedule_mode).trim().toLowerCase())
                    ? this.safeText(entry?.summary_schedule_mode).trim().toLowerCase()
                    : 'rolling_window',
                summary_window_minutes: Math.max(5, normalizeCount(entry?.summary_window_minutes) || 60),
                summary_max_items: Math.max(1, normalizeCount(entry?.summary_max_items) || 10),
                summary_hourly_minute: Math.min(59, Math.max(0, normalizeCount(entry?.summary_hourly_minute))),
                summary_daily_hour: Math.min(23, Math.max(0, normalizeCount(entry?.summary_daily_hour) || 9)),
                summary_daily_minute: Math.min(59, Math.max(0, normalizeCount(entry?.summary_daily_minute))),
                summary_timezone: this.safeText(entry?.summary_timezone, '').trim(),
                window_start_at: this.safeText(entry?.window_start_at, '').trim(),
                window_end_at: this.safeText(entry?.window_end_at, '').trim(),
                item_count: normalizeCount(entry?.item_count),
                entry_path: this.safeText(entry?.entry_path, '').trim(),
                manual_event_count: normalizeCount(entry?.manual_event_count),
                latest_manual_event: this.safeText(latestManualEvent?.title).trim() || this.safeText(latestManualEvent?.created_at).trim()
                    ? {
                        action: this.safeText(latestManualEvent?.action, '').trim().toLowerCase(),
                        title: this.safeText(latestManualEvent?.title, '').trim(),
                        actor: this.safeText(latestManualEvent?.actor, '').trim(),
                        created_at: this.safeText(latestManualEvent?.created_at, '').trim(),
                        note_excerpt: this.safeText(latestManualEvent?.note_excerpt, '').trim()
                    }
                    : null,
                preview_items: previewItems
            };
        };
        const reminderSource = payload?.reminder && typeof payload.reminder === 'object' ? payload.reminder : {};
        const reminderSweepMinutes = Math.max(1, Math.round(Number(reminderSource.sweep_interval_minutes || 10) || 10));

        return {
            generated_at: this.safeText(payload?.generated_at).trim(),
            backlog: {
                total_pending: normalizeCount(payload?.backlog?.total_pending),
                assigned_count: normalizeCount(payload?.backlog?.assigned_count),
                unassigned_count: normalizeCount(payload?.backlog?.unassigned_count),
                overdue_count: normalizeCount(payload?.backlog?.overdue_count),
                critical_overdue_count: normalizeCount(payload?.backlog?.critical_overdue_count),
                high_priority_count: normalizeCount(payload?.backlog?.high_priority_count),
                refundable_count: normalizeCount(payload?.backlog?.refundable_count),
                oldest_wait_minutes: normalizeCount(payload?.backlog?.oldest_wait_minutes)
            },
            efficiency: {
                lookback_days: Math.max(1, normalizeCount(payload?.efficiency?.lookback_days) || 30),
                closed_count: normalizeCount(payload?.efficiency?.closed_count),
                resolved_count: normalizeCount(payload?.efficiency?.resolved_count),
                rejected_count: normalizeCount(payload?.efficiency?.rejected_count),
                refund_related_count: normalizeCount(payload?.efficiency?.refund_related_count),
                resolved_rate_percent: normalizePercent(payload?.efficiency?.resolved_rate_percent),
                rejected_rate_percent: normalizePercent(payload?.efficiency?.rejected_rate_percent),
                refund_related_rate_percent: normalizePercent(payload?.efficiency?.refund_related_rate_percent),
                avg_first_touch_minutes: normalizeMaybeMinutes(payload?.efficiency?.avg_first_touch_minutes),
                first_touch_sample_count: normalizeCount(payload?.efficiency?.first_touch_sample_count),
                avg_resolution_minutes: normalizeMaybeMinutes(payload?.efficiency?.avg_resolution_minutes),
                resolution_sample_count: normalizeCount(payload?.efficiency?.resolution_sample_count)
            },
            sources: normalizeBreakdown(payload?.sources),
            issue_types: normalizeBreakdown(payload?.issue_types),
            reminder: {
                enabled: reminderSource.enabled === true,
                ops_alerts_enabled: reminderSource.ops_alerts_enabled !== false,
                monitor_enabled: reminderSource.monitor_enabled !== false,
                work_hours_only_enabled: reminderSource.work_hours_only_enabled === true,
                summary_enabled: reminderSource.summary_enabled === true,
                sweep_interval_minutes: reminderSweepMinutes,
                pending_overdue_minutes: Math.max(5, normalizeCount(reminderSource.pending_overdue_minutes) || 120),
                critical_overdue_minutes: Math.max(30, normalizeCount(reminderSource.critical_overdue_minutes) || 720),
                summary_window_minutes: Math.max(5, normalizeCount(reminderSource.summary_window_minutes) || 60),
                summary_schedule_mode: ['rolling_window', 'hourly', 'daily'].includes(this.safeText(reminderSource.summary_schedule_mode).trim().toLowerCase())
                    ? this.safeText(reminderSource.summary_schedule_mode).trim().toLowerCase()
                    : 'rolling_window',
                summary_hourly_minute: Math.min(59, Math.max(0, normalizeCount(reminderSource.summary_hourly_minute))),
                summary_daily_hour: Math.min(23, Math.max(0, normalizeCount(reminderSource.summary_daily_hour) || 9)),
                summary_daily_minute: Math.min(59, Math.max(0, normalizeCount(reminderSource.summary_daily_minute))),
                activity: {
                    lookback_days: Math.max(1, normalizeCount(reminderSource?.activity?.lookback_days) || 7),
                    total_job_count: normalizeCount(reminderSource?.activity?.total_job_count),
                    overdue_job_count: normalizeCount(reminderSource?.activity?.overdue_job_count),
                    recovered_job_count: normalizeCount(reminderSource?.activity?.recovered_job_count),
                    delivered_count: normalizeCount(reminderSource?.activity?.delivered_count),
                    active_count: normalizeCount(reminderSource?.activity?.active_count),
                    retry_count: normalizeCount(reminderSource?.activity?.retry_count),
                    dead_letter_count: normalizeCount(reminderSource?.activity?.dead_letter_count),
                    latest_job: normalizeReminderActivityEntry(reminderSource?.activity?.latest_job),
                    latest_overdue: normalizeReminderActivityEntry(reminderSource?.activity?.latest_overdue),
                    latest_recovered: normalizeReminderActivityEntry(reminderSource?.activity?.latest_recovered)
                },
                summary_digest: {
                    lookback_days: Math.max(1, normalizeCount(reminderSource?.summary_digest?.lookback_days) || 7),
                    total_job_count: normalizeCount(reminderSource?.summary_digest?.total_job_count),
                    daily_job_count: normalizeCount(reminderSource?.summary_digest?.daily_job_count),
                    delivered_count: normalizeCount(reminderSource?.summary_digest?.delivered_count),
                    active_count: normalizeCount(reminderSource?.summary_digest?.active_count),
                    retry_count: normalizeCount(reminderSource?.summary_digest?.retry_count),
                    dead_letter_count: normalizeCount(reminderSource?.summary_digest?.dead_letter_count),
                    failure_job_count: normalizeCount(reminderSource?.summary_digest?.failure_job_count),
                    latest_job: normalizeReminderSummaryDigestEntry(reminderSource?.summary_digest?.latest_job),
                    latest_daily_job: normalizeReminderSummaryDigestEntry(reminderSource?.summary_digest?.latest_daily_job),
                    latest_problem_job: normalizeReminderSummaryDigestEntry(reminderSource?.summary_digest?.latest_problem_job),
                    recent_jobs: (Array.isArray(reminderSource?.summary_digest?.recent_jobs) ? reminderSource.summary_digest.recent_jobs : [])
                        .map((item) => normalizeReminderSummaryDigestEntry(item))
                        .filter(Boolean)
                }
            }
        };
    },

    getDefaultOverviewReminderConfig: function () {
        return {
            enabled: true,
            tickets: {
                enabled: true,
                sweep_interval_ms: 10 * 60 * 1000,
                pending_overdue_minutes: 120,
                critical_overdue_minutes: 12 * 60,
                work_hours_only_enabled: false,
                summary_enabled: false,
                summary_window_minutes: 60,
                summary_schedule_mode: 'rolling_window',
                summary_hourly_minute: 0,
                summary_daily_hour: 9,
                summary_daily_minute: 0
            }
        };
    },

    applyOpsAlertsConfigSnapshot: function (config = null) {
        this.opsAlertsConfigSnapshot = config && typeof config === 'object' && !Array.isArray(config)
            ? config
            : null;
        return this.opsAlertsConfigSnapshot;
    },

    buildClientSideReminderOverview: function () {
        const fallbackConfig = this.getDefaultOverviewReminderConfig();
        const snapshot = this.opsAlertsConfigSnapshot && typeof this.opsAlertsConfigSnapshot === 'object'
            ? this.opsAlertsConfigSnapshot
            : fallbackConfig;
        const ticketsConfig = snapshot?.tickets && typeof snapshot.tickets === 'object'
            ? snapshot.tickets
            : fallbackConfig.tickets;
        const normalizeWholeNumber = (value, fallback, min, max = Number.POSITIVE_INFINITY) => {
            const parsed = Math.round(Number(value));
            if (!Number.isFinite(parsed)) {
                return fallback;
            }
            return Math.min(max, Math.max(min, parsed));
        };
        const normalizedScheduleMode = this.safeText(ticketsConfig?.summary_schedule_mode, fallbackConfig.tickets.summary_schedule_mode)
            .trim()
            .toLowerCase();

        return {
            ops_alerts_enabled: snapshot?.enabled !== false,
            monitor_enabled: ticketsConfig?.enabled !== false,
            enabled: snapshot?.enabled !== false && ticketsConfig?.enabled !== false,
            work_hours_only_enabled: ticketsConfig?.work_hours_only_enabled === true,
            summary_enabled: ticketsConfig?.summary_enabled === true,
            sweep_interval_minutes: Math.max(
                1,
                Math.round(Number(ticketsConfig?.sweep_interval_ms || fallbackConfig.tickets.sweep_interval_ms) / 60000)
            ),
            pending_overdue_minutes: normalizeWholeNumber(
                ticketsConfig?.pending_overdue_minutes,
                fallbackConfig.tickets.pending_overdue_minutes,
                5
            ),
            critical_overdue_minutes: normalizeWholeNumber(
                ticketsConfig?.critical_overdue_minutes,
                fallbackConfig.tickets.critical_overdue_minutes,
                30
            ),
            summary_window_minutes: normalizeWholeNumber(
                ticketsConfig?.summary_window_minutes,
                fallbackConfig.tickets.summary_window_minutes,
                5,
                1440
            ),
            summary_schedule_mode: ['rolling_window', 'hourly', 'daily'].includes(normalizedScheduleMode)
                ? normalizedScheduleMode
                : fallbackConfig.tickets.summary_schedule_mode,
            summary_hourly_minute: normalizeWholeNumber(
                ticketsConfig?.summary_hourly_minute,
                fallbackConfig.tickets.summary_hourly_minute,
                0,
                59
            ),
            summary_daily_hour: normalizeWholeNumber(
                ticketsConfig?.summary_daily_hour,
                fallbackConfig.tickets.summary_daily_hour,
                0,
                23
            ),
            summary_daily_minute: normalizeWholeNumber(
                ticketsConfig?.summary_daily_minute,
                fallbackConfig.tickets.summary_daily_minute,
                0,
                59
            ),
            activity: this.buildEmptyReminderActivityOverview(),
            summary_digest: this.buildEmptyReminderSummaryDigest()
        };
    },

    buildEmptyReminderActivityOverview: function () {
        return {
            lookback_days: 7,
            total_job_count: 0,
            overdue_job_count: 0,
            recovered_job_count: 0,
            delivered_count: 0,
            active_count: 0,
            retry_count: 0,
            dead_letter_count: 0,
            latest_job: null,
            latest_overdue: null,
            latest_recovered: null
        };
    },

    buildEmptyReminderSummaryDigest: function () {
        return {
            lookback_days: 7,
            total_job_count: 0,
            daily_job_count: 0,
            delivered_count: 0,
            active_count: 0,
            retry_count: 0,
            dead_letter_count: 0,
            failure_job_count: 0,
            latest_job: null,
            latest_daily_job: null,
            latest_problem_job: null,
            recent_jobs: []
        };
    },

    resolveSummaryManualAction: function (details = {}) {
        const normalizedAction = this.safeText(details?.action).trim().toLowerCase();
        if (normalizedAction === 'request_retry' || normalizedAction === 'add_note') {
            return normalizedAction;
        }
        if (this.safeText(details?.note || details?.internal_note).trim()) {
            return 'add_note';
        }
        if (this.safeText(details?.manual_retry_mode).trim() || this.safeText(details?.queue_next_status).trim().toLowerCase() === 'retry') {
            return 'request_retry';
        }
        return '';
    },

    buildSummaryManualEventFromAuditRow: function (row = {}) {
        const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
            ? row.details
            : {};
        const action = this.resolveSummaryManualAction(details);
        let title = '人工更新汇总任务';

        if (action === 'add_note') {
            title = '记录人工备注';
        } else if (action === 'request_retry') {
            title = this.safeText(details?.manual_retry_mode).trim().toLowerCase() === 'requeue'
                ? '人工重新加入重试队列'
                : '人工立即重试汇总';
        }

        return {
            action: action || 'update',
            title,
            actor: this.safeText(row?.admin_email || row?.admin_id).trim(),
            created_at: this.safeText(row?.created_at).trim(),
            note_excerpt: this.safeText(details?.note || details?.internal_note).trim().slice(0, 240)
        };
    },

    buildSummaryAuditMetaByJobId: function (auditRows = []) {
        const metaByJobId = new Map();

        (Array.isArray(auditRows) ? auditRows : []).forEach((row) => {
            const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
                ? row.details
                : {};
            const jobId = this.safeText(details?.job_id).trim();
            if (!jobId) {
                return;
            }

            const event = this.buildSummaryManualEventFromAuditRow(row);
            const existingMeta = metaByJobId.get(jobId) || {
                manual_event_count: 0,
                latest_manual_event: null
            };
            existingMeta.manual_event_count += 1;

            const existingTimeMs = Date.parse(this.safeText(existingMeta.latest_manual_event?.created_at).trim());
            const eventTimeMs = Date.parse(this.safeText(event?.created_at).trim());
            if (!existingMeta.latest_manual_event || (Number.isFinite(eventTimeMs) && (!Number.isFinite(existingTimeMs) || eventTimeMs > existingTimeMs))) {
                existingMeta.latest_manual_event = event;
            }

            metaByJobId.set(jobId, existingMeta);
        });

        return metaByJobId;
    },

    normalizeReminderJobChannelList: function (value) {
        if (Array.isArray(value)) {
            return value
                .map((item) => this.safeText(item).trim().toLowerCase())
                .filter(Boolean);
        }

        const normalized = this.safeText(value).trim();
        if (!normalized) {
            return [];
        }

        try {
            const parsed = JSON.parse(normalized);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => this.safeText(item).trim().toLowerCase())
                    .filter(Boolean);
            }
        } catch (_) {
            // Fall back to comma split below.
        }

        return normalized
            .split(',')
            .map((item) => this.safeText(item).trim().toLowerCase())
            .filter(Boolean);
    },

    buildClientSideReminderActivityEntry: function (job = null, attemptsByJobId = new Map()) {
        if (!job || typeof job !== 'object') {
            return null;
        }

        const payload = job?.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? job.payload
            : {};
        const normalizedJobId = this.safeText(job?.id).trim();
        const latestAttempt = Array.isArray(attemptsByJobId.get(normalizedJobId))
            ? attemptsByJobId.get(normalizedJobId)[0]
            : null;
        const normalizedAlertType = this.safeText(job?.alert_type).trim().toLowerCase();

        return {
            kind: normalizedAlertType === 'ticket_sla_recovered' ? 'recovered' : 'overdue',
            status: this.safeText(job?.status, 'unknown').trim().toLowerCase() || 'unknown',
            severity: this.safeText(job?.severity, 'warning').trim().toLowerCase() || 'warning',
            title: this.safeText(job?.title, '').trim(),
            ticket_id: this.safeText(payload?.ticket_id || payload?.target_id).trim(),
            target_id: this.safeText(payload?.target_id || payload?.ticket_id).trim(),
            wait_label: this.safeText(payload?.wait_label || payload?.previous_wait_label).trim(),
            created_at: this.safeText(job?.created_at).trim(),
            delivered_at: this.safeText(job?.delivered_at).trim(),
            attempt_count: Math.max(0, Number.parseInt(job?.attempt_count, 10) || 0),
            channels: this.normalizeReminderJobChannelList(job?.channels),
            remaining_channels: this.normalizeReminderJobChannelList(job?.remaining_channels),
            last_error: this.safeText(latestAttempt?.error_message || job?.last_error).trim(),
            latest_attempt: latestAttempt
                ? {
                    channel: this.safeText(latestAttempt?.channel).trim().toLowerCase(),
                    status: this.safeText(latestAttempt?.status).trim().toLowerCase(),
                    response_status: Number.isFinite(Number(latestAttempt?.response_status)) ? Number(latestAttempt.response_status) : null,
                    error_message: this.safeText(latestAttempt?.error_message).trim(),
                    created_at: this.safeText(latestAttempt?.created_at).trim()
                }
                : null
        };
    },

    buildReminderAttemptsByJobId: function (attempts = []) {
        const attemptsByJobId = new Map();

        (Array.isArray(attempts) ? attempts : []).forEach((attempt) => {
            const jobId = this.safeText(attempt?.job_id).trim();
            if (!jobId) {
                return;
            }

            if (!attemptsByJobId.has(jobId)) {
                attemptsByJobId.set(jobId, []);
            }
            attemptsByJobId.get(jobId).push(attempt);
        });

        attemptsByJobId.forEach((items, jobId) => {
            attemptsByJobId.set(jobId, items.slice().sort((left, right) => (
                (Date.parse(this.safeText(right?.created_at).trim()) || 0) - (Date.parse(this.safeText(left?.created_at).trim()) || 0)
            )));
        });

        return attemptsByJobId;
    },

    buildClientSideReminderActivityOverview: function (jobs = [], attempts = []) {
        const normalizedJobs = (Array.isArray(jobs) ? jobs : []).slice().sort((left, right) => (
            (Date.parse(this.safeText(right?.created_at).trim()) || 0) - (Date.parse(this.safeText(left?.created_at).trim()) || 0)
        ));
        const attemptsByJobId = this.buildReminderAttemptsByJobId(attempts);

        const overview = this.buildEmptyReminderActivityOverview();
        const overdueJobs = normalizedJobs.filter((job) => this.safeText(job?.alert_type).trim().toLowerCase() === 'ticket_sla_overdue');
        const recoveredJobs = normalizedJobs.filter((job) => this.safeText(job?.alert_type).trim().toLowerCase() === 'ticket_sla_recovered');

        normalizedJobs.forEach((job) => {
            const status = this.safeText(job?.status).trim().toLowerCase();
            if (status === 'delivered') {
                overview.delivered_count += 1;
            } else if (status === 'dead_letter') {
                overview.dead_letter_count += 1;
            } else if (status === 'retry') {
                overview.retry_count += 1;
                overview.active_count += 1;
            } else if (status === 'pending' || status === 'processing') {
                overview.active_count += 1;
            }
        });

        overview.total_job_count = normalizedJobs.length;
        overview.overdue_job_count = overdueJobs.length;
        overview.recovered_job_count = recoveredJobs.length;
        overview.latest_job = this.buildClientSideReminderActivityEntry(normalizedJobs[0] || null, attemptsByJobId);
        overview.latest_overdue = this.buildClientSideReminderActivityEntry(overdueJobs[0] || null, attemptsByJobId);
        overview.latest_recovered = this.buildClientSideReminderActivityEntry(recoveredJobs[0] || null, attemptsByJobId);
        return overview;
    },

    buildClientSideReminderSummaryPreviewItem: function (item = {}) {
        const payload = item?.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
            ? item.payload
            : {};
        const ticketId = this.safeText(payload?.ticket_id || payload?.target_id).trim();
        if (!ticketId) {
            return null;
        }

        const ticketStatus = this.normalizeTicketStatusValue(payload?.ticket_status || '');
        return {
            ticket_id: ticketId,
            order_id: this.safeText(payload?.order_id).trim(),
            user_id: this.safeText(payload?.user_id).trim(),
            user_email: this.safeText(payload?.user_email).trim(),
            wait_label: this.safeText(payload?.wait_label).trim(),
            responsible_label: this.safeText(payload?.responsible_label).trim(),
            ticket_status: ticketStatus,
            ticket_status_label: this.getTicketStatusLabel(ticketStatus),
            reason: this.safeText(payload?.reason).trim(),
            updated_at: this.safeText(payload?.updated_at || payload?.created_at || item?.created_at).trim()
        };
    },

    buildClientSideReminderSummaryDigestEntry: function (job = null, attemptsByJobId = new Map(), summaryAuditMetaByJobId = new Map()) {
        if (!job || typeof job !== 'object') {
            return null;
        }

        const payload = job?.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
            ? job.payload
            : {};
        const normalizedJobId = this.safeText(job?.id).trim();
        const latestAttempt = Array.isArray(attemptsByJobId.get(normalizedJobId))
            ? attemptsByJobId.get(normalizedJobId)[0]
            : null;
        const previewItems = (Array.isArray(payload?.items) ? payload.items : [])
            .map((item) => this.buildClientSideReminderSummaryPreviewItem(item))
            .filter(Boolean)
            .slice(0, Math.max(1, Number.parseInt(payload?.summary_max_items, 10) || 10));
        const normalizedScheduleMode = this.safeText(payload?.summary_schedule_mode).trim().toLowerCase();
        const summaryAuditMeta = summaryAuditMetaByJobId instanceof Map
            ? (summaryAuditMetaByJobId.get(normalizedJobId) || null)
            : null;

        return {
            id: normalizedJobId,
            status: this.safeText(job?.status, 'unknown').trim().toLowerCase() || 'unknown',
            severity: this.safeText(job?.severity, 'warning').trim().toLowerCase() || 'warning',
            title: this.safeText(job?.title, '').trim(),
            created_at: this.safeText(job?.created_at).trim(),
            updated_at: this.safeText(job?.updated_at).trim(),
            delivered_at: this.safeText(job?.delivered_at).trim(),
            attempt_count: Math.max(0, Number.parseInt(job?.attempt_count, 10) || 0),
            max_attempts: Math.max(0, Number.parseInt(job?.max_attempts, 10) || 0),
            next_retry_at: this.safeText(job?.next_retry_at).trim(),
            channels: this.normalizeReminderJobChannelList(job?.channels),
            remaining_channels: this.normalizeReminderJobChannelList(job?.remaining_channels),
            last_error: this.safeText(latestAttempt?.error_message || job?.last_error).trim(),
            latest_attempt: latestAttempt
                ? {
                    channel: this.safeText(latestAttempt?.channel).trim().toLowerCase(),
                    status: this.safeText(latestAttempt?.status).trim().toLowerCase(),
                    response_status: Number.isFinite(Number(latestAttempt?.response_status)) ? Number(latestAttempt.response_status) : null,
                    error_message: this.safeText(latestAttempt?.error_message).trim(),
                    created_at: this.safeText(latestAttempt?.created_at).trim()
                }
                : null,
            summary_schedule_mode: ['rolling_window', 'hourly', 'daily'].includes(normalizedScheduleMode)
                ? normalizedScheduleMode
                : 'rolling_window',
            summary_window_minutes: Math.max(5, Number.parseInt(payload?.summary_window_minutes, 10) || 60),
            summary_max_items: Math.max(1, Number.parseInt(payload?.summary_max_items, 10) || 10),
            summary_hourly_minute: Math.min(59, Math.max(0, Number.parseInt(payload?.summary_hourly_minute, 10) || 0)),
            summary_daily_hour: Math.min(23, Math.max(0, Number.parseInt(payload?.summary_daily_hour, 10) || 9)),
            summary_daily_minute: Math.min(59, Math.max(0, Number.parseInt(payload?.summary_daily_minute, 10) || 0)),
            summary_timezone: this.safeText(payload?.summary_timezone).trim(),
            window_start_at: this.safeText(payload?.window_start_at).trim(),
            window_end_at: this.safeText(payload?.window_end_at).trim(),
            item_count: Math.max(0, Number.parseInt(payload?.item_count, 10) || previewItems.length),
            entry_path: this.safeText(payload?.entry_path).trim(),
            manual_event_count: Math.max(0, Number.parseInt(summaryAuditMeta?.manual_event_count, 10) || 0),
            latest_manual_event: summaryAuditMeta?.latest_manual_event
                ? {
                    action: this.safeText(summaryAuditMeta.latest_manual_event.action).trim().toLowerCase(),
                    title: this.safeText(summaryAuditMeta.latest_manual_event.title).trim(),
                    actor: this.safeText(summaryAuditMeta.latest_manual_event.actor).trim(),
                    created_at: this.safeText(summaryAuditMeta.latest_manual_event.created_at).trim(),
                    note_excerpt: this.safeText(summaryAuditMeta.latest_manual_event.note_excerpt).trim().slice(0, 240)
                }
                : null,
            preview_items: previewItems
        };
    },

    buildClientSideReminderSummaryDigest: function (jobs = [], attempts = [], summaryAuditRows = []) {
        const normalizedJobs = (Array.isArray(jobs) ? jobs : []).slice().sort((left, right) => (
            (Date.parse(this.safeText(right?.created_at).trim()) || 0) - (Date.parse(this.safeText(left?.created_at).trim()) || 0)
        ));
        const attemptsByJobId = this.buildReminderAttemptsByJobId(attempts);
        const summaryAuditMetaByJobId = this.buildSummaryAuditMetaByJobId(summaryAuditRows);
        const dailyJobs = normalizedJobs.filter((job) => this.safeText(job?.payload?.summary_schedule_mode).trim().toLowerCase() === 'daily');
        const digest = this.buildEmptyReminderSummaryDigest();

        normalizedJobs.forEach((job) => {
            const status = this.safeText(job?.status).trim().toLowerCase();
            if (status === 'delivered') {
                digest.delivered_count += 1;
            } else if (status === 'dead_letter') {
                digest.dead_letter_count += 1;
            } else if (status === 'retry') {
                digest.retry_count += 1;
                digest.active_count += 1;
            } else if (status === 'pending' || status === 'processing') {
                digest.active_count += 1;
            }
        });

        digest.total_job_count = normalizedJobs.length;
        digest.daily_job_count = dailyJobs.length;
        digest.failure_job_count = normalizedJobs.filter((job) => {
            const status = this.safeText(job?.status).trim().toLowerCase();
            return status === 'retry' || status === 'dead_letter';
        }).length;
        digest.latest_job = this.buildClientSideReminderSummaryDigestEntry(normalizedJobs[0] || null, attemptsByJobId, summaryAuditMetaByJobId);
        digest.latest_daily_job = this.buildClientSideReminderSummaryDigestEntry(dailyJobs[0] || null, attemptsByJobId, summaryAuditMetaByJobId);
        digest.latest_problem_job = this.buildClientSideReminderSummaryDigestEntry(
            normalizedJobs.find((job) => {
                const status = this.safeText(job?.status).trim().toLowerCase();
                return status === 'retry' || status === 'dead_letter';
            }) || null,
            attemptsByJobId,
            summaryAuditMetaByJobId
        );
        digest.recent_jobs = normalizedJobs
            .slice(0, 4)
            .map((job) => this.buildClientSideReminderSummaryDigestEntry(job, attemptsByJobId, summaryAuditMetaByJobId))
            .filter(Boolean);
        return digest;
    },

    loadClientSideReminderJobsAndAttempts: async function (lookbackDays = 7, alertTypes = []) {
        const sinceMs = Date.now() - (Math.max(1, Number(lookbackDays || 7) || 7) * 24 * 60 * 60 * 1000);
        const allowedTypes = new Set(
            (Array.isArray(alertTypes) ? alertTypes : [])
                .map((alertType) => this.safeText(alertType).trim().toLowerCase())
                .filter(Boolean)
        );
        let jobs = [];

        try {
            const { data, error } = await window.supabaseClient
                .from('ops_alert_jobs')
                .select('id, alert_type, severity, title, payload, channels, remaining_channels, status, attempt_count, max_attempts, next_retry_at, last_error, created_at, updated_at, delivered_at')
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            jobs = (Array.isArray(data) ? data : []).filter((job) => {
                const alertType = this.safeText(job?.alert_type).trim().toLowerCase();
                const createdAtMs = Date.parse(this.safeText(job?.created_at).trim());
                return allowedTypes.has(alertType)
                    && Number.isFinite(createdAtMs)
                    && createdAtMs >= sinceMs;
            });
        } catch (error) {
            if (this.isMissingClientSideRelationError(error, 'ops_alert_jobs')) {
                return {
                    jobs: [],
                    attempts: []
                };
            }
            throw error;
        }

        let attempts = [];
        const jobIds = jobs.map((job) => this.safeText(job?.id).trim()).filter(Boolean);
        if (jobIds.length) {
            try {
                const { data, error } = await window.supabaseClient
                    .from('ops_alert_job_attempts')
                    .select('job_id, channel, status, response_status, error_message, created_at')
                    .in('job_id', jobIds)
                    .order('created_at', { ascending: false });

                if (error) {
                    throw error;
                }

                attempts = Array.isArray(data) ? data : [];
            } catch (error) {
                if (!this.isMissingClientSideRelationError(error, 'ops_alert_job_attempts')) {
                    throw error;
                }
            }
        }

        return {
            jobs,
            attempts
        };
    },

    loadClientSideReminderActivity: async function (lookbackDays = 7) {
        const fallbackOverview = this.buildEmptyReminderActivityOverview();
        const { jobs, attempts } = await this.loadClientSideReminderJobsAndAttempts(lookbackDays, [
            'ticket_sla_overdue',
            'ticket_sla_recovered'
        ]);
        if (!jobs.length) {
            return fallbackOverview;
        }

        return this.buildClientSideReminderActivityOverview(jobs, attempts);
    },

    loadClientSideSummaryAuditRows: async function (jobIds = [], lookbackDays = 7) {
        const normalizedJobIds = Array.from(new Set(
            (Array.isArray(jobIds) ? jobIds : [])
                .map((jobId) => this.safeText(jobId).trim())
                .filter(Boolean)
        ));
        if (!normalizedJobIds.length) {
            return [];
        }

        const sinceMs = Date.now() - (Math.max(1, Number(lookbackDays || 7) || 7) * 24 * 60 * 60 * 1000);
        const loadRowsFromTable = async (tableName = 'admin_audit_logs_view') => {
            const { data, error } = await window.supabaseClient
                .from(tableName)
                .select('id, action_type, details, created_at, admin_id, admin_email')
                .in('action_type', ['ticket.summary_job_action'])
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            return (Array.isArray(data) ? data : []).filter((row) => {
                const createdAtMs = Date.parse(this.safeText(row?.created_at).trim());
                const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
                    ? row.details
                    : {};
                const jobId = this.safeText(details?.job_id).trim();
                return normalizedJobIds.includes(jobId)
                    && (!Number.isFinite(createdAtMs) || createdAtMs >= sinceMs);
            });
        };

        try {
            return await loadRowsFromTable('admin_audit_logs_view');
        } catch (error) {
            if (!this.isMissingClientSideRelationError(error, 'admin_audit_logs_view')) {
                throw error;
            }
        }

        try {
            return await loadRowsFromTable('admin_audit_logs');
        } catch (error) {
            if (this.isMissingClientSideRelationError(error, 'admin_audit_logs')) {
                return [];
            }
            throw error;
        }
    },

    loadClientSideReminderSummaryDigest: async function (lookbackDays = 7) {
        const fallbackDigest = this.buildEmptyReminderSummaryDigest();
        const { jobs, attempts } = await this.loadClientSideReminderJobsAndAttempts(lookbackDays, [
            'ticket_sla_summary'
        ]);
        if (!jobs.length) {
            return fallbackDigest;
        }

        let summaryAuditRows = [];
        try {
            summaryAuditRows = await this.loadClientSideSummaryAuditRows(
                jobs.map((job) => this.safeText(job?.id).trim()),
                lookbackDays
            );
        } catch (error) {
            console.warn('[AdminTickets] client-side summary audit load skipped:', error);
        }

        return this.buildClientSideReminderSummaryDigest(jobs, attempts, summaryAuditRows);
    },

    loadClientSideReminderActivityAndSummary: async function (lookbackDays = 7) {
        const [activityResult, summaryDigestResult] = await Promise.allSettled([
            this.loadClientSideReminderActivity(lookbackDays),
            this.loadClientSideReminderSummaryDigest(lookbackDays)
        ]);

        const activity = activityResult.status === 'fulfilled'
            ? activityResult.value
            : this.buildEmptyReminderActivityOverview();
        const summaryDigest = summaryDigestResult.status === 'fulfilled'
            ? summaryDigestResult.value
            : this.buildEmptyReminderSummaryDigest();

        return {
            activity,
            summary_digest: summaryDigest
        };
    },

    formatReminderSummaryWindowLabel: function (entry = {}) {
        const start = this.safeText(entry?.window_start_at).trim();
        const end = this.safeText(entry?.window_end_at).trim();
        if (start || end) {
            return `${this.formatDateTime(start || '未知')} - ${this.formatDateTime(end || '未知')}`;
        }

        return this.formatReminderScheduleLabel(entry);
    },

    formatMetricDuration: function (minutes, fallback = '--') {
        const normalizedMinutes = Number(minutes);
        if (!Number.isFinite(normalizedMinutes) || normalizedMinutes < 0) {
            return fallback;
        }

        if (normalizedMinutes < 60) {
            return `${Math.round(normalizedMinutes)} 分钟`;
        }

        if (normalizedMinutes < 24 * 60) {
            const hours = Math.round((normalizedMinutes / 60) * 10) / 10;
            const hoursLabel = Number.isInteger(hours) ? String(hours) : String(hours).replace(/\.0$/, '');
            return `${hoursLabel} 小时`;
        }

        const days = Math.round((normalizedMinutes / (24 * 60)) * 10) / 10;
        const daysLabel = Number.isInteger(days) ? String(days) : String(days).replace(/\.0$/, '');
        return `${daysLabel} 天`;
    },

    formatMetricPercent: function (value, fallback = '--') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return fallback;
        }

        const normalized = Math.round(parsed * 10) / 10;
        return `${Number.isInteger(normalized) ? normalized : normalized.toFixed(1).replace(/\.0$/, '')}%`;
    },

    formatReminderScheduleLabel: function (reminder = {}) {
        const mode = this.safeText(reminder?.summary_schedule_mode).trim().toLowerCase();
        if (mode === 'hourly') {
            return `每小时 ${String(Math.max(0, Number(reminder?.summary_hourly_minute || 0))).padStart(2, '0')} 分`;
        }
        if (mode === 'daily') {
            return `每天 ${String(Math.max(0, Number(reminder?.summary_daily_hour || 0))).padStart(2, '0')}:${String(Math.max(0, Number(reminder?.summary_daily_minute || 0))).padStart(2, '0')}`;
        }
        return `滚动 ${Math.max(5, Number(reminder?.summary_window_minutes || 60))} 分钟窗口`;
    },

    buildOverviewCards: function (overview = {}) {
        const backlog = overview?.backlog || {};
        const efficiency = overview?.efficiency || {};
        const reminder = overview?.reminder || {};
        const totalPending = Math.max(0, Number(backlog.total_pending || 0) || 0);
        const overdueCount = Math.max(0, Number(backlog.overdue_count || 0) || 0);
        const criticalOverdueCount = Math.max(0, Number(backlog.critical_overdue_count || 0) || 0);
        const firstTouchValue = this.formatMetricDuration(efficiency.avg_first_touch_minutes);
        const resolutionValue = this.formatMetricDuration(efficiency.avg_resolution_minutes);

        return [
            {
                key: 'pending',
                tone: totalPending > 0 ? 'slate' : 'success',
                icon: 'fa-inbox',
                eyebrow: 'Current Queue',
                label: '待处理队列',
                value: String(totalPending),
                meta: `未指派 ${Math.max(0, Number(backlog.unassigned_count || 0) || 0)} · 高优 ${Math.max(0, Number(backlog.high_priority_count || 0) || 0)}`,
                hint: totalPending > 0
                    ? `最老待处理 ${this.formatMetricDuration(backlog.oldest_wait_minutes, '0 分钟')} · 当前可人工退款 ${Math.max(0, Number(backlog.refundable_count || 0) || 0)} 单`
                    : '当前没有待处理积压'
            },
            {
                key: 'overdue',
                tone: criticalOverdueCount > 0 ? 'danger' : (overdueCount > 0 ? 'warning' : 'success'),
                icon: 'fa-bell',
                eyebrow: 'SLA Alert',
                label: '超时工单',
                value: String(overdueCount),
                meta: `critical ${criticalOverdueCount} · 阈值 ${Math.max(5, Number(reminder.pending_overdue_minutes || 120) || 120)} 分钟`,
                hint: overdueCount > 0
                    ? `巡检频率约 ${Math.max(1, Number(reminder.sweep_interval_minutes || 10) || 10)} 分钟一次`
                    : '当前队列都在 SLA 范围内'
            },
            {
                key: 'first_touch',
                tone: efficiency.first_touch_sample_count > 0 ? 'info' : 'slate',
                icon: 'fa-stopwatch',
                eyebrow: 'First Touch',
                label: '首次跟进',
                value: firstTouchValue,
                meta: `近 ${Math.max(1, Number(efficiency.lookback_days || 30) || 30)} 天样本 ${Math.max(0, Number(efficiency.first_touch_sample_count || 0) || 0)} 单`,
                hint: efficiency.first_touch_sample_count > 0
                    ? `已结单 ${Math.max(0, Number(efficiency.closed_count || 0) || 0)} 单中，优先看首次被管理员接手的速度`
                    : '最近没有可用于计算首次跟进的样本'
            },
            {
                key: 'resolution',
                tone: efficiency.resolution_sample_count > 0 ? 'success' : 'slate',
                icon: 'fa-flag-checkered',
                eyebrow: 'Close Time',
                label: '平均结单',
                value: resolutionValue,
                meta: `解决率 ${this.formatMetricPercent(efficiency.resolved_rate_percent, '0%')} · 退款介入率 ${this.formatMetricPercent(efficiency.refund_related_rate_percent, '0%')}`,
                hint: efficiency.resolution_sample_count > 0
                    ? `拒绝率 ${this.formatMetricPercent(efficiency.rejected_rate_percent, '0%')} · 最近结单样本 ${Math.max(0, Number(efficiency.resolution_sample_count || 0) || 0)}`
                    : '最近没有可用于计算结单时长的样本'
            }
        ];
    },

    renderOverviewCards: function (cards = []) {
        if (!Array.isArray(cards) || !cards.length) {
            return `
                <div class="admin-ticket-overview-state">
                    <i class="fas fa-chart-simple"></i>
                    <span>暂无可展示的工单概览。</span>
                </div>
            `;
        }

        return cards.map((card) => `
            <article class="admin-ticket-overview-card admin-ticket-overview-card--${this.safeText(card?.tone, 'slate').trim() || 'slate'}">
                <div class="admin-ticket-overview-card__head">
                    <div class="admin-ticket-overview-card__icon">
                        <i class="fas ${this.safeText(card?.icon, 'fa-chart-simple').trim() || 'fa-chart-simple'}"></i>
                    </div>
                    <div>
                        <span class="admin-ticket-overview-card__eyebrow">${this.escapeHtml(card?.eyebrow || '')}</span>
                        <div class="admin-ticket-overview-card__label">${this.escapeHtml(card?.label || '')}</div>
                    </div>
                </div>
                <div class="admin-ticket-overview-card__value">${this.escapeHtml(card?.value || '--')}</div>
                <div class="admin-ticket-overview-card__meta">${this.escapeHtml(card?.meta || '')}</div>
                <div class="admin-ticket-overview-card__hint">${this.escapeHtml(card?.hint || '')}</div>
            </article>
        `).join('');
    },

    renderOverviewBreakdown: function (items = [], emptyMessage = '暂无数据') {
        if (!Array.isArray(items) || !items.length) {
            return `<div class="admin-ticket-overview-empty">${this.escapeHtml(emptyMessage)}</div>`;
        }

        return items.map((item) => `
            <div class="admin-ticket-overview-breakdown-item">
                <div class="admin-ticket-overview-breakdown-item__head">
                    <span class="admin-ticket-overview-breakdown-item__label">${this.escapeHtml(item?.label || '')}</span>
                    <span class="admin-ticket-overview-breakdown-item__value">${this.escapeHtml(String(item?.count || 0))} · ${this.escapeHtml(this.formatMetricPercent(item?.share_percent || 0, '0%'))}</span>
                </div>
                <progress class="admin-ticket-overview-breakdown-item__progress" max="100" value="${Math.max(0, Math.min(100, Number(item?.share_percent || 0) || 0))}"></progress>
            </div>
        `).join('');
    },

    getReminderChannelLabel: function (channel = '') {
        const normalized = this.safeText(channel).trim().toLowerCase();
        if (normalized === 'feishu') {
            return '飞书';
        }
        if (normalized === 'email') {
            return '邮件';
        }
        if (normalized === 'telegram') {
            return 'Telegram';
        }
        if (normalized === 'sms') {
            return '短信';
        }
        if (normalized === 'webhook') {
            return 'Webhook';
        }
        return normalized ? normalized.replace(/_/g, ' ') : '未知通道';
    },

    formatReminderChannelsLabel: function (channels = [], fallback = '未配置通道') {
        const normalized = Array.from(new Set(
            (Array.isArray(channels) ? channels : [])
                .map((channel) => this.getReminderChannelLabel(channel))
                .filter(Boolean)
        ));
        return normalized.length ? normalized.join(' / ') : fallback;
    },

    formatReminderActivityKindLabel: function (kind = '') {
        return this.safeText(kind).trim().toLowerCase() === 'recovered'
            ? '恢复提醒'
            : '超时提醒';
    },

    getReminderActivityStatusMeta: function (status = '') {
        const normalized = this.safeText(status).trim().toLowerCase();
        if (normalized === 'delivered') {
            return { label: '已送达', tone: 'success' };
        }
        if (normalized === 'retry') {
            return { label: '重试中', tone: 'warning' };
        }
        if (normalized === 'dead_letter') {
            return { label: '进入死信', tone: 'danger' };
        }
        if (normalized === 'pending' || normalized === 'processing') {
            return { label: '发送中', tone: 'info' };
        }
        return {
            label: normalized ? normalized.toUpperCase() : '未知状态',
            tone: 'slate'
        };
    },

    renderReminderSummaryPreviewList: function (entry = null) {
        const previewItems = Array.isArray(entry?.preview_items) ? entry.preview_items : [];
        if (!previewItems.length) {
            return '<div class="admin-ticket-overview-empty">最近一次汇总里还没有可预览的工单条目。</div>';
        }

        return `
            <div class="admin-ticket-overview-reminder-summary-preview-list">
                ${previewItems.slice(0, 3).map((item) => {
                    const metaParts = [
                        this.safeText(item?.ticket_id).trim() ? `工单 ${this.safeText(item.ticket_id).trim()}` : '',
                        this.safeText(item?.wait_label).trim() ? `已等待 ${this.safeText(item.wait_label).trim()}` : '',
                        this.safeText(item?.ticket_status_label).trim() ? this.safeText(item.ticket_status_label).trim() : '',
                        this.safeText(item?.responsible_label).trim() ? `负责人 ${this.safeText(item.responsible_label).trim()}` : ''
                    ].filter(Boolean);
                    const subMetaParts = [
                        this.safeText(item?.order_id).trim() ? `订单 ${this.safeText(item.order_id).trim()}` : '',
                        this.safeText(item?.user_email).trim() ? this.safeText(item.user_email).trim() : '',
                        this.safeText(item?.updated_at).trim() ? `更新时间 ${this.formatDateTime(item.updated_at)}` : ''
                    ].filter(Boolean);

                    return `
                        <div class="admin-ticket-overview-reminder-summary-preview-item">
                            <div class="admin-ticket-overview-reminder-summary-preview-item__head">
                                <div class="admin-ticket-overview-reminder-summary-preview-item__title">${this.escapeHtml(metaParts.join(' · '))}</div>
                                ${this.safeText(item?.ticket_id).trim()
                                    ? `
                                        <button
                                            type="button"
                                            class="btn-secondary admin-ticket-overview-reminder-summary-preview-item__btn"
                                            data-admin-action="tickets-open-reminder-ticket"
                                            data-ticket-id="${this.escapeHtml(item.ticket_id)}">
                                            定位
                                        </button>
                                    `
                                    : ''}
                            </div>
                            ${subMetaParts.length
                                ? `<div class="admin-ticket-overview-reminder-summary-preview-item__meta">${this.escapeHtml(subMetaParts.join(' · '))}</div>`
                                : ''}
                            ${this.safeText(item?.reason).trim()
                                ? `<div class="admin-ticket-overview-reminder-summary-preview-item__reason">${this.escapeHtml(item.reason)}</div>`
                                : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderReminderSummaryComparisonItem: function (item = null, options = {}) {
        if (!item || typeof item !== 'object') {
            return '';
        }

        const titleParts = [
            this.safeText(item?.ticket_id).trim() ? `工单 ${this.safeText(item.ticket_id).trim()}` : '',
            this.safeText(item?.wait_label).trim() ? `已等待 ${this.safeText(item.wait_label).trim()}` : '',
            this.safeText(item?.ticket_status_label).trim() ? this.safeText(item.ticket_status_label).trim() : '',
            this.safeText(item?.responsible_label).trim() ? `负责人 ${this.safeText(item.responsible_label).trim()}` : ''
        ].filter(Boolean);
        const metaParts = [
            this.safeText(item?.order_id).trim() ? `订单 ${this.safeText(item.order_id).trim()}` : '',
            this.safeText(item?.user_email).trim() ? this.safeText(item.user_email).trim() : '',
            this.safeText(item?.updated_at).trim() ? `更新时间 ${this.formatDateTime(item.updated_at)}` : ''
        ].filter(Boolean);
        const actionLabel = this.safeText(options?.actionLabel).trim() || '定位';

        return `
            <div class="admin-ticket-summary-job-modal__comparison-item">
                <div class="admin-ticket-summary-job-modal__comparison-item-copy">
                    <div class="admin-ticket-summary-job-modal__comparison-item-title">${this.escapeHtml(titleParts.join(' · ') || (this.safeText(item?.ticket_id).trim() || '工单条目'))}</div>
                    ${metaParts.length
                        ? `<div class="admin-ticket-summary-job-modal__comparison-item-meta">${this.escapeHtml(metaParts.join(' · '))}</div>`
                        : ''}
                    ${this.safeText(item?.reason).trim()
                        ? `<div class="admin-ticket-summary-job-modal__comparison-item-reason">${this.escapeHtml(item.reason)}</div>`
                        : ''}
                </div>
                ${this.safeText(item?.ticket_id).trim()
                    ? `
                        <button
                            type="button"
                            class="btn-secondary admin-ticket-summary-job-modal__comparison-item-btn"
                            data-admin-action="tickets-open-reminder-ticket"
                            data-ticket-id="${this.escapeHtml(item.ticket_id)}">
                            ${this.escapeHtml(actionLabel)}
                        </button>
                    `
                    : ''}
            </div>
        `;
    },

    renderReminderSummaryComparisonBucket: function (title = '', items = [], options = {}) {
        const normalizedTitle = this.safeText(title).trim() || '预览变化';
        const tone = this.safeText(options?.tone).trim().toLowerCase() || 'info';
        const emptyMessage = this.safeText(options?.emptyMessage).trim() || '当前没有可展示的工单。';
        const actionLabel = this.safeText(options?.actionLabel).trim() || '定位';
        const itemList = Array.isArray(items) ? items : [];
        const scrollLimit = Math.max(0, Number(options?.scrollLimit || 0) || 0);
        const shouldLimitScroll = scrollLimit > 0 && itemList.length > scrollLimit;
        const listClasses = ['admin-ticket-summary-job-modal__comparison-list'];
        if (shouldLimitScroll) {
            listClasses.push('admin-ticket-summary-job-modal__comparison-list--scrollable');
        }
        if (shouldLimitScroll && scrollLimit === 2) {
            listClasses.push('admin-ticket-summary-job-modal__comparison-list--limit-2');
        }

        return `
            <div class="admin-ticket-summary-job-modal__comparison-column admin-ticket-summary-job-modal__comparison-column--${this.escapeHtml(tone)}">
                <div class="admin-ticket-summary-job-modal__comparison-column-head">
                    <div class="admin-ticket-summary-job-modal__comparison-column-title">${this.escapeHtml(normalizedTitle)}</div>
                    <span class="admin-ticket-summary-job-modal__comparison-column-count">${Math.max(0, itemList.length)} 条</span>
                </div>
                ${itemList.length
                    ? `
                        <div class="${listClasses.join(' ')}">
                            ${itemList.map((item) => this.renderReminderSummaryComparisonItem(item, {
                                actionLabel
                            })).join('')}
                        </div>
                    `
                    : `<div class="admin-ticket-overview-empty">${this.escapeHtml(emptyMessage)}</div>`}
            </div>
        `;
    },

    collectReminderSummaryJobEntries: function (digest = {}) {
        const entries = [];
        const seenIds = new Set();
        const candidates = [
            digest?.latest_job,
            digest?.latest_daily_job,
            digest?.latest_problem_job,
            ...(Array.isArray(digest?.recent_jobs) ? digest.recent_jobs : [])
        ];

        candidates.forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }

            const normalizedId = this.safeText(entry?.id).trim();
            if (!normalizedId || seenIds.has(normalizedId)) {
                return;
            }

            seenIds.add(normalizedId);
            entries.push(entry);
        });

        return entries;
    },

    sortReminderSummaryJobEntriesByCreatedAtDesc: function (entries = []) {
        return (Array.isArray(entries) ? entries : []).slice().sort((left, right) => {
            const leftValue = Date.parse(this.safeText(left?.created_at).trim());
            const rightValue = Date.parse(this.safeText(right?.created_at).trim());
            if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
                return rightValue - leftValue;
            }
            return this.safeText(right?.id).trim().localeCompare(this.safeText(left?.id).trim(), 'zh-CN');
        });
    },

    resolveReminderSummaryJobEntry: function (jobId = '') {
        const normalizedJobId = this.safeText(jobId).trim();
        if (!normalizedJobId) {
            return null;
        }

        const digest = this.overview?.reminder?.summary_digest && typeof this.overview.reminder.summary_digest === 'object'
            ? this.overview.reminder.summary_digest
            : this.buildEmptyReminderSummaryDigest();
        return this.collectReminderSummaryJobEntries(digest)
            .find((entry) => this.safeText(entry?.id).trim() === normalizedJobId) || null;
    },

    resolvePreviousReminderSummaryJobEntry: function (entry = null) {
        const normalizedJobId = this.safeText(entry?.id).trim();
        if (!normalizedJobId) {
            return null;
        }

        const digest = this.overview?.reminder?.summary_digest && typeof this.overview.reminder.summary_digest === 'object'
            ? this.overview.reminder.summary_digest
            : this.buildEmptyReminderSummaryDigest();
        const sortedEntries = this.sortReminderSummaryJobEntriesByCreatedAtDesc(this.collectReminderSummaryJobEntries(digest));
        const currentIndex = sortedEntries.findIndex((candidate) => this.safeText(candidate?.id).trim() === normalizedJobId);
        if (currentIndex === -1) {
            return null;
        }

        const normalizedMode = this.safeText(entry?.summary_schedule_mode).trim().toLowerCase();
        const fallbackCandidates = sortedEntries.filter((candidate, index) => index > currentIndex);
        if (!fallbackCandidates.length) {
            return null;
        }

        return fallbackCandidates.find((candidate) => (
            this.safeText(candidate?.summary_schedule_mode).trim().toLowerCase() === normalizedMode
        )) || fallbackCandidates[0] || null;
    },

    buildReminderSummaryPreviewComparison: function (entry = null, previousEntry = null) {
        const currentItems = (Array.isArray(entry?.preview_items) ? entry.preview_items : [])
            .filter((item) => this.safeText(item?.ticket_id).trim());
        const comparedEntry = previousEntry && typeof previousEntry === 'object'
            ? previousEntry
            : this.resolvePreviousReminderSummaryJobEntry(entry);
        const previousItems = (Array.isArray(comparedEntry?.preview_items) ? comparedEntry.preview_items : [])
            .filter((item) => this.safeText(item?.ticket_id).trim());

        if (!currentItems.length && !previousItems.length) {
            return null;
        }

        const currentMap = new Map(
            currentItems.map((item) => [this.safeText(item?.ticket_id).trim(), item])
        );
        const previousMap = new Map(
            previousItems.map((item) => [this.safeText(item?.ticket_id).trim(), item])
        );

        return {
            compared_entry: comparedEntry || null,
            current_preview_count: currentItems.length,
            previous_preview_count: previousItems.length,
            added_items: currentItems.filter((item) => !previousMap.has(this.safeText(item?.ticket_id).trim())),
            ongoing_items: currentItems.filter((item) => previousMap.has(this.safeText(item?.ticket_id).trim())),
            removed_items: previousItems.filter((item) => !currentMap.has(this.safeText(item?.ticket_id).trim()))
        };
    },

    renderReminderSummaryPreviewComparison: function (entry = null) {
        const comparison = this.buildReminderSummaryPreviewComparison(entry);
        const comparedEntry = comparison?.compared_entry || null;

        if (!comparedEntry) {
            return '<div class="admin-ticket-overview-empty">当前没有更早的一份汇总可供对比，后续生成下一份日报后会在这里展示新增、持续和移出的预览工单。</div>';
        }

        return `
            <div class="admin-ticket-summary-job-modal__comparison-shell">
                <div class="admin-ticket-summary-job-modal__comparison-summary">
                    <div class="admin-ticket-summary-job-modal__comparison-summary-copy">
                        <div class="admin-ticket-summary-job-modal__comparison-summary-title">对比上一份汇总：${this.escapeHtml(this.safeText(comparedEntry?.title).trim() || '工单超时汇总')}</div>
                        <div class="admin-ticket-summary-job-modal__comparison-summary-meta">
                            ${this.escapeHtml([
                                comparedEntry?.created_at ? `创建 ${this.formatDateTime(comparedEntry.created_at)}` : '',
                                this.formatReminderSummaryWindowLabel(comparedEntry),
                                `预览 ${Math.max(0, Number(comparison?.previous_preview_count || 0) || 0)} / ${Math.max(0, Number(comparedEntry?.item_count || 0) || 0)} 条`
                            ].filter(Boolean).join(' · '))}
                        </div>
                    </div>
                    <div class="admin-ticket-summary-job-modal__comparison-stats">
                        <div class="admin-ticket-summary-job-modal__comparison-stat admin-ticket-summary-job-modal__comparison-stat--danger">
                            <span>新增超时</span>
                            <strong>${Math.max(0, Number(comparison?.added_items?.length || 0) || 0)}</strong>
                        </div>
                        <div class="admin-ticket-summary-job-modal__comparison-stat admin-ticket-summary-job-modal__comparison-stat--warning">
                            <span>持续超时</span>
                            <strong>${Math.max(0, Number(comparison?.ongoing_items?.length || 0) || 0)}</strong>
                        </div>
                        <div class="admin-ticket-summary-job-modal__comparison-stat admin-ticket-summary-job-modal__comparison-stat--success">
                            <span>已移出预览</span>
                            <strong>${Math.max(0, Number(comparison?.removed_items?.length || 0) || 0)}</strong>
                        </div>
                    </div>
                </div>
                <div class="admin-ticket-summary-job-modal__comparison-caption">以下对比基于最近两次汇总的预览条目，用来快速判断队列是在扩散、持平还是开始回落。</div>
                <div class="admin-ticket-summary-job-modal__comparison-columns">
                    ${this.renderReminderSummaryComparisonBucket('本次新出现的工单', comparison?.added_items, {
                        tone: 'danger',
                        emptyMessage: '这次预览里没有新出现的超时工单。',
                        actionLabel: '定位新单'
                    })}
                    ${this.renderReminderSummaryComparisonBucket('连续两次都在的工单', comparison?.ongoing_items, {
                        tone: 'warning',
                        emptyMessage: '没有看到连续两次都在汇总里的工单。',
                        actionLabel: '继续跟进',
                        scrollLimit: 2
                    })}
                    ${this.renderReminderSummaryComparisonBucket('已从这次预览移出的工单', comparison?.removed_items, {
                        tone: 'success',
                        emptyMessage: '上一份预览里的工单这次都还在队列里。',
                        actionLabel: '回看工单'
                    })}
                </div>
            </div>
        `;
    },

    canRequestReminderSummaryRetry: function (entry = null) {
        const normalizedStatus = this.safeText(entry?.status).trim().toLowerCase();
        return normalizedStatus === 'retry' || normalizedStatus === 'dead_letter';
    },

    getReminderSummaryRetryActionLabel: function (entry = null) {
        return this.safeText(entry?.status).trim().toLowerCase() === 'dead_letter'
            ? '重新加入重试队列'
            : '立即再试一次';
    },

    formatReminderSummaryManualEventMeta: function (event = null) {
        if (!event || typeof event !== 'object') {
            return '';
        }

        return [
            this.safeText(event?.title).trim() || '人工更新',
            this.safeText(event?.actor).trim() || '',
            this.safeText(event?.created_at).trim() ? this.formatDateTime(event.created_at) : ''
        ].filter(Boolean).join(' · ');
    },

    renderReminderSummaryManualEvent: function (event = null, options = {}) {
        if (!event || typeof event !== 'object') {
            return '';
        }

        const classes = ['admin-ticket-overview-reminder-summary-note'];
        if (options.compact === true) {
            classes.push('admin-ticket-overview-reminder-summary-note--compact');
        }

        return `
            <div class="${classes.join(' ')}">
                <div class="admin-ticket-overview-reminder-summary-note__title">${this.escapeHtml(this.formatReminderSummaryManualEventMeta(event) || '最近人工动作')}</div>
                ${this.safeText(event?.note_excerpt).trim()
                    ? `<div class="admin-ticket-overview-reminder-summary-note__body">${this.escapeHtml(event.note_excerpt)}</div>`
                    : ''}
            </div>
        `;
    },

    extractReminderSummaryNoteExcerpt: function (source = null) {
        if (!source) {
            return '';
        }

        if (typeof source === 'string') {
            return this.safeText(source)
                .trim()
                .replace(/^(?:内部备注|备注)：/, '')
                .trim()
                .slice(0, 240);
        }

        const explicitNote = this.safeText(source?.note_excerpt).trim();
        if (explicitNote) {
            return explicitNote.slice(0, 240);
        }

        const detail = this.safeText(source?.detail).trim();
        if (!detail) {
            return '';
        }

        const noteLine = detail
            .split('\n')
            .map((line) => this.safeText(line).trim())
            .find((line) => /^(?:内部备注|备注)：/.test(line));

        if (!noteLine) {
            return '';
        }

        return noteLine
            .replace(/^(?:内部备注|备注)：/, '')
            .trim()
            .slice(0, 240);
    },

    findLatestReminderSummaryManualHistoryItem: function (items = []) {
        return this.normalizeReminderSummaryHistoryItems(items)
            .slice()
            .sort((left, right) => {
                const leftValue = Date.parse(this.safeText(left?.created_at).trim());
                const rightValue = Date.parse(this.safeText(right?.created_at).trim());
                if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
                    return rightValue - leftValue;
                }
                return this.safeText(right?.title).trim().localeCompare(this.safeText(left?.title).trim(), 'zh-CN');
            })
            .find((item) => /人工|备注/.test(this.safeText(item?.title).trim())) || null;
    },

    buildReminderSummaryHandoffSummary: function (entry = null, historyItems = []) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }

        const latestManualHistoryItem = this.findLatestReminderSummaryManualHistoryItem(historyItems);
        const latestManualEvent = entry?.latest_manual_event && typeof entry.latest_manual_event === 'object'
            ? entry.latest_manual_event
            : null;
        const latestActor = this.safeText(latestManualHistoryItem?.actor || latestManualEvent?.actor).trim();
        const latestActionTitle = this.safeText(latestManualHistoryItem?.title || latestManualEvent?.title).trim();
        const latestActionAt = this.safeText(latestManualHistoryItem?.created_at || latestManualEvent?.created_at).trim();
        const latestNoteExcerpt = this.extractReminderSummaryNoteExcerpt(latestManualHistoryItem)
            || this.extractReminderSummaryNoteExcerpt(latestManualEvent);
        const comparison = this.buildReminderSummaryPreviewComparison(entry);
        const addedCount = Math.max(0, Number(comparison?.added_items?.length || 0) || 0);
        const ongoingCount = Math.max(0, Number(comparison?.ongoing_items?.length || 0) || 0);
        const removedCount = Math.max(0, Number(comparison?.removed_items?.length || 0) || 0);
        const remainingChannelLabel = Array.isArray(entry?.remaining_channels) && entry.remaining_channels.length
            ? this.formatReminderChannelsLabel(entry.remaining_channels, '')
            : '';
        const normalizedStatus = this.safeText(entry?.status).trim().toLowerCase();
        let nextStepTitle = '建议继续观察';
        let nextStepDetail = '这条汇总暂时没有新的人工动作，可以继续关注后续自动投递和工单队列变化。';

        if (normalizedStatus === 'dead_letter') {
            nextStepTitle = '建议立即人工恢复重试';
            nextStepDetail = [
                remainingChannelLabel ? `优先检查 ${remainingChannelLabel} 通道配置和回执状态` : '优先检查最近失败通道和外发配置',
                this.safeText(entry?.last_error).trim() ? `最近错误：${this.safeText(entry.last_error).trim()}` : '',
                addedCount > 0 ? `本轮还有 ${addedCount} 条新出现的超时工单，建议先处理这些新增项` : ''
            ].filter(Boolean).join('；');
        } else if (normalizedStatus === 'retry') {
            nextStepTitle = '建议观察自动重试并准备人工接管';
            nextStepDetail = [
                this.safeText(entry?.next_retry_at).trim() ? `系统预计 ${this.formatDateTime(entry.next_retry_at)} 再试一次` : '当前处于重试中，但没有明确的下一次重试时间',
                remainingChannelLabel ? `仍待处理通道：${remainingChannelLabel}` : '',
                ongoingCount > 0 ? `有 ${ongoingCount} 条工单连续两次都在汇总里，建议优先跟进这些持续积压项` : ''
            ].filter(Boolean).join('；');
        } else if (normalizedStatus === 'pending' || normalizedStatus === 'processing') {
            nextStepTitle = '建议等待队列处理完成';
            nextStepDetail = '任务仍在发送中，可以稍后刷新查看最新尝试结果，再决定是否需要人工介入。';
        } else if (normalizedStatus === 'delivered') {
            if (addedCount > 0) {
                nextStepTitle = '建议优先处理新出现的超时工单';
                nextStepDetail = `本轮预览里新增了 ${addedCount} 条超时工单，可先从新增项开始回看和跟进。`;
            } else if (ongoingCount > 0) {
                nextStepTitle = '建议盯住持续积压的超时工单';
                nextStepDetail = `有 ${ongoingCount} 条工单连续两次都出现在汇总里，说明这些问题还在持续堆积。`;
            } else if (removedCount > 0) {
                nextStepTitle = '建议确认队列回落是否稳定';
                nextStepDetail = `上一份预览里已有 ${removedCount} 条工单移出本轮汇总，可继续关注是否还有新的超时项补进来。`;
            } else if (latestNoteExcerpt) {
                nextStepTitle = '建议按最近备注继续跟进';
                nextStepDetail = latestNoteExcerpt;
            } else {
                nextStepTitle = '建议复盘本轮汇总效果';
                nextStepDetail = '这次汇总已成功送达，可回看预览工单并确认后续处理是否已经接续。';
            }
        }

        return {
            latest_actor: latestActor,
            latest_action_title: latestActionTitle,
            latest_action_time: latestActionAt,
            latest_note_excerpt: latestNoteExcerpt,
            next_step_title: nextStepTitle,
            next_step_detail: nextStepDetail,
            manual_action_count: Math.max(
                0,
                Number(entry?.manual_event_count || 0) || 0,
                latestManualHistoryItem ? 1 : 0,
                latestManualEvent ? 1 : 0
            )
        };
    },

    renderReminderSummaryHandoffSummary: function (entry = null, historyItems = []) {
        const summary = this.buildReminderSummaryHandoffSummary(entry, historyItems);
        if (!summary) {
            return '<div class="admin-ticket-overview-empty">当前还没有这条汇总任务的人工交接摘要。</div>';
        }

        const latestActionLabel = [
            this.safeText(summary.latest_action_title).trim() || '暂无人工动作',
            this.safeText(summary.latest_action_time).trim() ? this.formatDateTime(summary.latest_action_time) : ''
        ].filter(Boolean).join(' · ');

        return `
            <div class="admin-ticket-summary-job-modal__handoff-grid">
                <div class="admin-ticket-summary-job-modal__handoff-card">
                    <span class="admin-ticket-summary-job-modal__handoff-label">最近接手人</span>
                    <strong class="admin-ticket-summary-job-modal__handoff-value">${this.escapeHtml(this.safeText(summary.latest_actor).trim() || '暂无人工接手')}</strong>
                </div>
                <div class="admin-ticket-summary-job-modal__handoff-card">
                    <span class="admin-ticket-summary-job-modal__handoff-label">最近人工动作</span>
                    <strong class="admin-ticket-summary-job-modal__handoff-value">${this.escapeHtml(latestActionLabel || '暂无人工动作')}</strong>
                </div>
                <div class="admin-ticket-summary-job-modal__handoff-card">
                    <span class="admin-ticket-summary-job-modal__handoff-label">人工介入次数</span>
                    <strong class="admin-ticket-summary-job-modal__handoff-value">${this.escapeHtml(String(Math.max(0, Number(summary.manual_action_count || 0) || 0)))} 次</strong>
                </div>
            </div>
            <div class="admin-ticket-summary-job-modal__handoff-blocks">
                <div class="admin-ticket-summary-job-modal__handoff-block">
                    <div class="admin-ticket-summary-job-modal__handoff-block-title">最新交接备注</div>
                    <div class="admin-ticket-summary-job-modal__handoff-block-body">${this.escapeHtml(this.safeText(summary.latest_note_excerpt).trim() || '当前还没有额外的人工备注。')}</div>
                </div>
                <div class="admin-ticket-summary-job-modal__handoff-block">
                    <div class="admin-ticket-summary-job-modal__handoff-block-title">${this.escapeHtml(this.safeText(summary.next_step_title).trim() || '建议下一步')}</div>
                    <div class="admin-ticket-summary-job-modal__handoff-block-body">${this.escapeHtml(this.safeText(summary.next_step_detail).trim() || '可继续观察系统后续重试和队列变化。')}</div>
                </div>
            </div>
        `;
    },

    renderReminderSummaryJobActions: function (entry = null, options = {}) {
        const normalizedId = this.safeText(entry?.id).trim();
        if (!normalizedId) {
            return '';
        }

        const canRetry = options.showRetry !== false && this.canRequestReminderSummaryRetry(entry);
        return `
            <div class="admin-ticket-overview-reminder-summary-actions">
                <button
                    type="button"
                    class="btn-secondary admin-ticket-overview-reminder-summary-actions__btn"
                    data-admin-action="tickets-open-summary-job-detail"
                    data-summary-job-id="${this.escapeHtml(normalizedId)}">
                    查看详情
                </button>
                ${canRetry
                    ? `
                        <button
                            type="button"
                            class="btn-secondary admin-ticket-overview-reminder-summary-actions__btn"
                            data-admin-action="tickets-retry-summary-job"
                            data-summary-job-id="${this.escapeHtml(normalizedId)}">
                            ${this.escapeHtml(this.getReminderSummaryRetryActionLabel(entry))}
                        </button>
                    `
                    : ''}
            </div>
        `;
    },

    normalizeReminderSummaryHistoryItems: function (items = []) {
        return (Array.isArray(items) ? items : [])
            .map((item) => ({
                id: this.safeText(item?.id).trim(),
                title: this.safeText(item?.title).trim(),
                detail: this.safeText(item?.detail).trim(),
                time: this.formatDateTime(item?.time || item?.created_at || item?.at),
                created_at: this.safeText(item?.created_at || item?.time || item?.at).trim(),
                icon: this.safeText(item?.icon, 'fa-clock-rotate-left').trim() || 'fa-clock-rotate-left',
                tone: this.safeText(item?.tone).trim().toLowerCase(),
                actor: this.safeText(item?.actor).trim()
            }))
            .filter((item) => item.title)
            .sort((left, right) => {
                const leftValue = Date.parse(this.safeText(left?.created_at || left?.time).trim());
                const rightValue = Date.parse(this.safeText(right?.created_at || right?.time).trim());
                if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
                    return leftValue - rightValue;
                }
                return this.safeText(left?.title).trim().localeCompare(this.safeText(right?.title).trim(), 'zh-CN');
            });
    },

    buildLocalReminderSummaryJobHistoryItems: function (entry = null) {
        if (!entry || typeof entry !== 'object') {
            return [];
        }

        const statusMeta = this.getReminderActivityStatusMeta(entry?.status);
        const items = [{
            id: `summary-created:${this.safeText(entry?.id).trim()}`,
            title: '生成 SLA 汇总任务',
            detail: [
                `汇总策略：${this.formatReminderScheduleLabel({
                    summary_enabled: true,
                    summary_schedule_mode: entry?.summary_schedule_mode,
                    summary_window_minutes: entry?.summary_window_minutes,
                    summary_hourly_minute: entry?.summary_hourly_minute,
                    summary_daily_hour: entry?.summary_daily_hour,
                    summary_daily_minute: entry?.summary_daily_minute
                })}`,
                `统计窗口：${this.formatReminderSummaryWindowLabel(entry)}`,
                `累计工单：${Math.max(0, Number(entry?.item_count || 0) || 0)} 单`,
                `投递通道：${this.formatReminderChannelsLabel(entry?.channels)}`,
                this.safeText(entry?.entry_path).trim() ? `入口：${this.safeText(entry.entry_path).trim()}` : ''
            ].filter(Boolean).join('\n'),
            time: this.safeText(entry?.created_at).trim(),
            created_at: this.safeText(entry?.created_at).trim(),
            icon: 'fa-file-waveform',
            tone: ''
        }];
        const latestAttempt = entry?.latest_attempt && typeof entry.latest_attempt === 'object'
            ? entry.latest_attempt
            : null;

        if (latestAttempt?.created_at) {
            const latestAttemptStatusMeta = this.getReminderActivityStatusMeta(latestAttempt.status);
            items.push({
                id: `summary-attempt:${this.safeText(entry?.id).trim()}:latest`,
                title: latestAttemptStatusMeta.tone === 'success'
                    ? '汇总投递成功'
                    : latestAttemptStatusMeta.tone === 'danger'
                        ? '汇总投递失败'
                        : latestAttemptStatusMeta.tone === 'warning'
                            ? '汇总投递等待重试'
                            : '汇总投递更新',
                detail: [
                    `投递通道：${this.getReminderChannelLabel(latestAttempt.channel)}`,
                    `结果状态：${latestAttemptStatusMeta.label}`,
                    Number.isFinite(Number(latestAttempt.response_status)) ? `HTTP 状态：${Number(latestAttempt.response_status)}` : '',
                    this.safeText(latestAttempt?.error_message || entry?.last_error).trim()
                        ? `错误信息：${this.safeText(latestAttempt?.error_message || entry?.last_error).trim()}`
                        : ''
                ].filter(Boolean).join('\n'),
                time: this.safeText(latestAttempt?.created_at).trim(),
                created_at: this.safeText(latestAttempt?.created_at).trim(),
                icon: latestAttemptStatusMeta.tone === 'success'
                    ? 'fa-circle-check'
                    : latestAttemptStatusMeta.tone === 'danger'
                        ? 'fa-triangle-exclamation'
                        : latestAttemptStatusMeta.tone === 'warning'
                            ? 'fa-rotate-right'
                            : 'fa-paper-plane',
                tone: latestAttemptStatusMeta.tone
            });
        }

        const normalizedStatus = this.safeText(entry?.status).trim().toLowerCase();
        if (
            normalizedStatus === 'retry'
            || normalizedStatus === 'dead_letter'
            || normalizedStatus === 'pending'
            || normalizedStatus === 'processing'
            || (normalizedStatus === 'delivered' && !latestAttempt?.created_at && entry?.delivered_at)
        ) {
            items.push({
                id: `summary-status:${this.safeText(entry?.id).trim()}`,
                title: normalizedStatus === 'retry'
                    ? '汇总任务等待自动重试'
                    : normalizedStatus === 'dead_letter'
                        ? '汇总任务进入死信队列'
                        : normalizedStatus === 'delivered'
                            ? '汇总任务已送达'
                            : '汇总任务排队处理中',
                detail: [
                    `当前状态：${statusMeta.label}`,
                    Array.isArray(entry?.remaining_channels) && entry.remaining_channels.length
                        ? `待重试通道：${this.formatReminderChannelsLabel(entry.remaining_channels, '')}`
                        : '',
                    this.safeText(entry?.next_retry_at).trim() ? `下次重试：${this.formatDateTime(entry.next_retry_at)}` : '',
                    Number(entry?.max_attempts || 0) > 0
                        ? `尝试次数：${Math.max(0, Number(entry?.attempt_count || 0) || 0)} / ${Math.max(0, Number(entry?.max_attempts || 0) || 0)}`
                        : `尝试次数：${Math.max(0, Number(entry?.attempt_count || 0) || 0)} 次`,
                    this.safeText(entry?.last_error).trim() ? `最近错误：${this.safeText(entry.last_error).trim()}` : ''
                ].filter(Boolean).join('\n'),
                time: this.safeText(entry?.updated_at || entry?.delivered_at || entry?.next_retry_at).trim(),
                created_at: this.safeText(entry?.updated_at || entry?.delivered_at || entry?.next_retry_at).trim(),
                icon: normalizedStatus === 'retry'
                    ? 'fa-rotate-right'
                    : normalizedStatus === 'dead_letter'
                        ? 'fa-circle-exclamation'
                        : normalizedStatus === 'delivered'
                            ? 'fa-circle-check'
                            : 'fa-hourglass-half',
                tone: statusMeta.tone
            });
        }

        return this.normalizeReminderSummaryHistoryItems(items);
    },

    getReminderSummaryJobHistoryState: function (jobId = '') {
        const normalizedJobId = this.safeText(jobId).trim();
        const historyMap = this.reminderSummaryJobHistoryById && typeof this.reminderSummaryJobHistoryById === 'object'
            ? this.reminderSummaryJobHistoryById
            : {};
        const existingState = normalizedJobId ? historyMap[normalizedJobId] : null;
        if (!existingState || typeof existingState !== 'object') {
            return {
                loading: false,
                loaded: false,
                errorMessage: '',
                items: []
            };
        }

        return {
            loading: existingState.loading === true,
            loaded: existingState.loaded === true,
            errorMessage: this.safeText(existingState.errorMessage).trim(),
            items: this.normalizeReminderSummaryHistoryItems(existingState.items)
        };
    },

    setReminderSummaryJobHistoryState: function (jobId = '', nextState = {}) {
        const normalizedJobId = this.safeText(jobId).trim();
        if (!normalizedJobId) {
            return this.getReminderSummaryJobHistoryState('');
        }

        if (!this.reminderSummaryJobHistoryById || typeof this.reminderSummaryJobHistoryById !== 'object') {
            this.reminderSummaryJobHistoryById = {};
        }

        const currentState = this.getReminderSummaryJobHistoryState(normalizedJobId);
        const mergedState = {
            ...currentState,
            ...(nextState && typeof nextState === 'object' ? nextState : {})
        };
        mergedState.items = this.normalizeReminderSummaryHistoryItems(mergedState.items);
        this.reminderSummaryJobHistoryById[normalizedJobId] = mergedState;
        return mergedState;
    },

    captureReminderSummaryJobNoteDraft: function (jobId = '') {
        const normalizedJobId = this.safeText(jobId || this.activeReminderSummaryJobId).trim();
        if (!normalizedJobId) {
            return '';
        }

        const noteInput = document.getElementById('ticketSummaryJobNoteInput');
        if (!noteInput) {
            return this.safeText(this.reminderSummaryJobNoteDrafts?.[normalizedJobId]).trim();
        }

        const draft = this.safeText(noteInput.value).slice(0, 2000);
        this.reminderSummaryJobNoteDrafts = this.reminderSummaryJobNoteDrafts && typeof this.reminderSummaryJobNoteDrafts === 'object'
            ? this.reminderSummaryJobNoteDrafts
            : {};
        this.reminderSummaryJobNoteDrafts[normalizedJobId] = draft;
        return draft;
    },

    renderReminderSummaryJobHistoryTimeline: function (items = [], options = {}) {
        if (!Array.isArray(items) || !items.length) {
            if (this.safeText(options?.emptyMessage).trim()) {
                return `<div class="admin-ticket-overview-empty">${this.escapeHtml(options.emptyMessage)}</div>`;
            }
            return '<div class="admin-ticket-overview-empty">当前还没有这条汇总任务的人工动作和重试轨迹。</div>';
        }

        return `
            <div class="admin-ticket-summary-job-modal__timeline">
                ${items.map((item) => {
                    const toneClass = this.safeText(item?.tone).trim()
                        ? ` admin-ticket-summary-job-modal__timeline-item--${this.escapeHtml(this.safeText(item.tone).trim())}`
                        : '';
                    return `
                        <div class="admin-ticket-summary-job-modal__timeline-item${toneClass}">
                            <div class="admin-ticket-summary-job-modal__timeline-icon">
                                <i class="fas ${this.escapeHtml(item?.icon || 'fa-clock-rotate-left')}"></i>
                            </div>
                            <div class="admin-ticket-summary-job-modal__timeline-card">
                                <div class="admin-ticket-summary-job-modal__timeline-topline">
                                    <span class="admin-ticket-summary-job-modal__timeline-title">${this.escapeHtml(item?.title || '')}</span>
                                    <span class="admin-ticket-summary-job-modal__timeline-time">${this.escapeHtml(item?.time || '未知')}</span>
                                </div>
                                ${this.safeText(item?.actor).trim()
                                    ? `<div class="admin-ticket-summary-job-modal__timeline-actor">${this.escapeHtml(item.actor)}</div>`
                                    : ''}
                                <div class="admin-ticket-summary-job-modal__timeline-detail">${this.escapeHtml(item?.detail || '')}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    loadReminderSummaryJobHistory: async function (jobId = '', options = {}) {
        const normalizedJobId = this.safeText(jobId).trim();
        if (!normalizedJobId) {
            return [];
        }

        const existingState = this.getReminderSummaryJobHistoryState(normalizedJobId);
        if (existingState.loaded === true && options.force !== true) {
            return existingState.items;
        }

        if (!this._summaryJobHistoryRequestIds || typeof this._summaryJobHistoryRequestIds !== 'object') {
            this._summaryJobHistoryRequestIds = {};
        }

        const requestId = (Number(this._summaryJobHistoryRequestIds[normalizedJobId]) || 0) + 1;
        this._summaryJobHistoryRequestIds[normalizedJobId] = requestId;
        this.captureReminderSummaryJobNoteDraft(normalizedJobId);
        this.setReminderSummaryJobHistoryState(normalizedJobId, {
            loading: true,
            errorMessage: '',
            items: existingState.items
        });

        if (this.activeReminderSummaryJobId === normalizedJobId) {
            this.syncReminderSummaryJobDetailModal();
        }

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.getTicketsSummaryHistoryUrl(normalizedJobId), {
                method: 'GET',
                headers
            });
            const result = await response.json().catch(() => ({}));

            if (requestId !== Number(this._summaryJobHistoryRequestIds[normalizedJobId] || 0)) {
                return this.getReminderSummaryJobHistoryState(normalizedJobId).items;
            }

            if (!response.ok || !result.success) {
                throw new Error(result.message || '汇总任务历史加载失败');
            }

            const items = this.normalizeReminderSummaryHistoryItems(result.items);
            this.setReminderSummaryJobHistoryState(normalizedJobId, {
                loading: false,
                loaded: true,
                errorMessage: '',
                items
            });
            if (this.activeReminderSummaryJobId === normalizedJobId) {
                this.syncReminderSummaryJobDetailModal();
            }
            return items;
        } catch (error) {
            const entry = this.resolveReminderSummaryJobEntry(normalizedJobId);
            const fallbackItems = this.buildLocalReminderSummaryJobHistoryItems(entry);
            this.setReminderSummaryJobHistoryState(normalizedJobId, {
                loading: false,
                loaded: false,
                errorMessage: this.safeText(error?.message, '汇总任务历史加载失败'),
                items: fallbackItems
            });
            if (this.activeReminderSummaryJobId === normalizedJobId) {
                this.syncReminderSummaryJobDetailModal();
            }
            console.warn('[AdminTickets] summary history load error:', error);
            return fallbackItems;
        }
    },

    getReminderSummaryHistoryFallbackMessage: function (message = '') {
        const normalizedMessage = this.safeText(message).trim();
        if (!normalizedMessage) {
            return '汇总历史接口暂不可用，当前先展示本地推导的轨迹。';
        }

        if (/admin route not found|route not found|404/i.test(normalizedMessage)) {
            return '当前环境暂未接入汇总历史接口，已先展示本地推导的轨迹。';
        }

        return '汇总历史接口暂不可用，已先展示本地推导的轨迹。';
    },

    renderReminderSummaryJobDetailBody: function (entry = null, options = {}) {
        if (!entry || typeof entry !== 'object') {
            return '<div class="admin-ticket-overview-empty">没有找到这条工单汇总记录，可能已超出当前概览窗口。</div>';
        }

        const statusMeta = this.getReminderActivityStatusMeta(entry?.status);
        const historyState = options?.historyState && typeof options.historyState === 'object'
            ? options.historyState
            : this.getReminderSummaryJobHistoryState(entry?.id);
        const normalizedJobId = this.safeText(entry?.id).trim();
        const noteDraft = this.safeText(options?.noteDraft ?? this.reminderSummaryJobNoteDrafts?.[normalizedJobId]).slice(0, 2000);
        const historyItems = historyState.items.length
            ? historyState.items
            : this.buildLocalReminderSummaryJobHistoryItems(entry);
        const summaryMetaItems = [{
            label: '任务状态',
            value: statusMeta.label
        }, {
            label: '汇总策略',
            value: this.formatReminderScheduleLabel({
                summary_enabled: true,
                summary_schedule_mode: entry?.summary_schedule_mode,
                summary_window_minutes: entry?.summary_window_minutes,
                summary_hourly_minute: entry?.summary_hourly_minute,
                summary_daily_hour: entry?.summary_daily_hour,
                summary_daily_minute: entry?.summary_daily_minute
            })
        }, {
            label: '统计窗口',
            value: this.formatReminderSummaryWindowLabel(entry)
        }, {
            label: '累计工单',
            value: `${Math.max(0, Number(entry?.item_count || 0) || 0)} 单`
        }, {
            label: '投递通道',
            value: this.formatReminderChannelsLabel(entry?.channels)
        }, {
            label: '待重试通道',
            value: Array.isArray(entry?.remaining_channels) && entry.remaining_channels.length
                ? this.formatReminderChannelsLabel(entry.remaining_channels, '')
                : '无'
        }, {
            label: '创建时间',
            value: entry?.created_at ? this.formatDateTime(entry.created_at) : '未知'
        }, {
            label: '最近更新',
            value: entry?.updated_at
                ? this.formatDateTime(entry.updated_at)
                : (entry?.delivered_at ? this.formatDateTime(entry.delivered_at) : '未知')
        }, {
            label: '下次重试',
            value: entry?.next_retry_at ? this.formatDateTime(entry.next_retry_at) : '暂无'
        }, {
            label: '尝试次数',
            value: Number(entry?.max_attempts || 0) > 0
                ? `${Math.max(0, Number(entry?.attempt_count || 0) || 0)} / ${Math.max(0, Number(entry?.max_attempts || 0) || 0)}`
                : `${Math.max(0, Number(entry?.attempt_count || 0) || 0)} 次`
        }, {
            label: '入口',
            value: this.safeText(entry?.entry_path).trim() || '售后工单看板'
        }, {
            label: '任务 ID',
            value: this.safeText(entry?.id).trim() || '未知'
        }];
        const latestAttempt = entry?.latest_attempt && typeof entry.latest_attempt === 'object'
            ? entry.latest_attempt
            : null;

        return `
            <div class="admin-ticket-summary-job-modal__section">
                <div class="admin-ticket-summary-job-modal__section-head">
                    <div>
                        <div class="admin-ticket-summary-job-modal__section-title">汇总窗口与投递摘要</div>
                        <div class="admin-ticket-summary-job-modal__section-copy">这里会保留这次汇总的窗口、通道和人工重试状态。</div>
                    </div>
                    <span class="admin-ticket-overview-reminder-activity-item__status admin-ticket-overview-reminder-activity-item__status--${this.escapeHtml(statusMeta.tone)}">${this.escapeHtml(statusMeta.label)}</span>
                </div>
                <div class="admin-ticket-summary-job-modal__grid">
                    ${summaryMetaItems.map((item) => `
                        <div class="admin-ticket-summary-job-modal__fact">
                            <span class="admin-ticket-summary-job-modal__fact-label">${this.escapeHtml(item.label)}</span>
                            <strong class="admin-ticket-summary-job-modal__fact-value">${this.escapeHtml(item.value)}</strong>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="admin-ticket-summary-job-modal__section">
                <div class="admin-ticket-summary-job-modal__section-head">
                    <div>
                        <div class="admin-ticket-summary-job-modal__section-title">重试诊断</div>
                        <div class="admin-ticket-summary-job-modal__section-copy">结合最近一次尝试和当前剩余通道，判断是等待自动重试还是人工介入。</div>
                    </div>
                </div>
                <div class="admin-ticket-summary-job-modal__diagnostics">
                    <div class="admin-ticket-summary-job-modal__diagnostic-line">
                        ${this.escapeHtml([
                            `状态 ${statusMeta.label}`,
                            latestAttempt ? `最近尝试 ${this.getReminderChannelLabel(latestAttempt.channel)} / ${this.getReminderActivityStatusMeta(latestAttempt.status).label}` : '',
                            latestAttempt && Number.isFinite(Number(latestAttempt.response_status))
                                ? `HTTP ${Number(latestAttempt.response_status)}`
                                : '',
                            entry?.delivered_at ? `送达 ${this.formatDateTime(entry.delivered_at)}` : ''
                        ].filter(Boolean).join(' · '))}
                    </div>
                    ${latestAttempt?.created_at
                        ? `<div class="admin-ticket-summary-job-modal__diagnostic-line">最近尝试时间：${this.escapeHtml(this.formatDateTime(latestAttempt.created_at))}</div>`
                        : ''}
                    ${this.safeText(entry?.last_error).trim()
                        ? `<div class="admin-ticket-overview-reminder-activity-item__error">${this.escapeHtml(entry.last_error)}</div>`
                        : '<div class="admin-ticket-summary-job-modal__diagnostic-line">当前没有记录到新的错误信息。</div>'}
                </div>
            </div>
            <div class="admin-ticket-summary-job-modal__section">
                <div class="admin-ticket-summary-job-modal__section-head">
                    <div>
                        <div class="admin-ticket-summary-job-modal__section-title">人工交接摘要</div>
                        <div class="admin-ticket-summary-job-modal__section-copy">把最近谁接手、最新备注和建议下一步压成一屏，方便快速交接和复盘。</div>
                    </div>
                </div>
                ${this.renderReminderSummaryHandoffSummary(entry, historyItems)}
            </div>
            <div class="admin-ticket-summary-job-modal__section">
                <div class="admin-ticket-summary-job-modal__section-head">
                    <div>
                        <div class="admin-ticket-summary-job-modal__section-title">人工备注</div>
                        <div class="admin-ticket-summary-job-modal__section-copy">仅管理员可见，会进入这条汇总任务的处理时间线，不会影响外发给用户的内容。</div>
                    </div>
                </div>
                <div class="admin-ticket-summary-job-modal__note-shell">
                    <textarea
                        id="ticketSummaryJobNoteInput"
                        class="admin-ticket-summary-job-modal__note-textarea"
                        rows="4"
                        placeholder="记录这次人工介入的判断、补充说明或后续跟进计划...">${this.escapeHtml(noteDraft)}</textarea>
                    <div class="admin-ticket-summary-job-modal__note-actions">
                        <div class="admin-ticket-summary-job-modal__note-hint">常见用法：记录为什么手动重试、为什么先不处理、后续由谁继续跟进。</div>
                        <button
                            type="button"
                            id="ticketSummaryJobNoteBtn"
                            class="btn-secondary admin-ticket-summary-job-modal__note-btn"
                            data-admin-action="tickets-save-summary-job-note"
                            data-summary-job-id="${this.escapeHtml(normalizedJobId)}"
                            ${this.reminderSummaryJobNoteSavingId === normalizedJobId ? 'disabled' : ''}>
                            ${this.reminderSummaryJobNoteSavingId === normalizedJobId ? '保存中...' : '保存备注'}
                        </button>
                    </div>
                </div>
            </div>
            <div class="admin-ticket-summary-job-modal__section">
                <div class="admin-ticket-summary-job-modal__section-head">
                    <div>
                        <div class="admin-ticket-summary-job-modal__section-title">重试结果时间线</div>
                        <div class="admin-ticket-summary-job-modal__section-copy">把投递尝试、人工重试和人工备注放在同一条时间线上，方便复盘。</div>
                    </div>
                </div>
                ${historyState.loading === true
                    ? '<div class="admin-ticket-summary-job-modal__history-meta">正在拉取更完整的汇总任务历史...</div>'
                    : ''}
                ${this.safeText(historyState.errorMessage).trim()
                    ? `<div class="admin-ticket-summary-job-modal__history-meta admin-ticket-summary-job-modal__history-meta--warning">${this.escapeHtml(this.getReminderSummaryHistoryFallbackMessage(historyState.errorMessage))}</div>`
                    : ''}
                ${this.renderReminderSummaryJobHistoryTimeline(historyItems, {
                    emptyMessage: '当前还没有这条汇总任务的人工动作和重试轨迹。'
                })}
            </div>
            <div class="admin-ticket-summary-job-modal__section">
                <div class="admin-ticket-summary-job-modal__section-head">
                    <div>
                        <div class="admin-ticket-summary-job-modal__section-title">相较上一份汇总的预览变化</div>
                        <div class="admin-ticket-summary-job-modal__section-copy">快速判断这轮 SLA 队列是新增加压，还是持续堆积或已经开始回落。</div>
                    </div>
                </div>
                ${this.renderReminderSummaryPreviewComparison(entry)}
            </div>
            <div class="admin-ticket-summary-job-modal__section">
                <div class="admin-ticket-summary-job-modal__section-head">
                    <div>
                        <div class="admin-ticket-summary-job-modal__section-title">汇总内容预览</div>
                        <div class="admin-ticket-summary-job-modal__section-copy">可直接跳回具体工单，继续跟进队列处理。</div>
                    </div>
                </div>
                ${this.renderReminderSummaryPreviewList(entry)}
            </div>
        `;
    },

    renderReminderSummaryHistoryList: function (digest = {}) {
        const recentJobs = Array.isArray(digest?.recent_jobs) ? digest.recent_jobs : [];
        if (!recentJobs.length) {
            return '<div class="admin-ticket-overview-empty">最近还没有可追溯的工单汇总历史。</div>';
        }

        return `
            <div class="admin-ticket-overview-reminder-summary-history-list">
                ${recentJobs.map((entry) => {
                    const statusMeta = this.getReminderActivityStatusMeta(entry?.status);
                    const historyMeta = [
                        entry?.created_at ? `创建 ${this.formatDateTime(entry.created_at)}` : '',
                        entry?.window_start_at || entry?.window_end_at ? `窗口 ${this.formatReminderSummaryWindowLabel(entry)}` : '',
                        `累计 ${Math.max(0, Number(entry?.item_count || 0) || 0)} 单`
                    ].filter(Boolean);
                    const deliveryMeta = [
                        `通道 ${this.formatReminderChannelsLabel(entry?.channels)}`,
                        entry?.delivered_at ? `送达 ${this.formatDateTime(entry.delivered_at)}` : '',
                        `尝试 ${Math.max(0, Number(entry?.attempt_count || 0) || 0)} 次`
                    ].filter(Boolean);

                    return `
                        <article class="admin-ticket-overview-reminder-summary-history-item admin-ticket-overview-reminder-summary-history-item--${this.escapeHtml(statusMeta.tone)}">
                            <div class="admin-ticket-overview-reminder-summary-history-item__head">
                                <div class="admin-ticket-overview-reminder-summary-history-item__title">${this.escapeHtml(entry?.title || '工单超时汇总')}</div>
                                <span class="admin-ticket-overview-reminder-activity-item__status admin-ticket-overview-reminder-activity-item__status--${this.escapeHtml(statusMeta.tone)}">
                                    ${this.escapeHtml(statusMeta.label)}
                                </span>
                            </div>
                            <div class="admin-ticket-overview-reminder-summary-history-item__meta">${this.escapeHtml(historyMeta.join(' · '))}</div>
                            <div class="admin-ticket-overview-reminder-summary-history-item__meta">${this.escapeHtml(deliveryMeta.join(' · '))}</div>
                            ${entry?.latest_attempt
                                ? `
                                    <div class="admin-ticket-overview-reminder-summary-history-item__meta">
                                        ${this.escapeHtml([
                                            '最近尝试',
                                            this.getReminderChannelLabel(entry.latest_attempt.channel),
                                            this.getReminderActivityStatusMeta(entry.latest_attempt.status).label,
                                            Number.isFinite(Number(entry.latest_attempt.response_status))
                                                ? `HTTP ${Number(entry.latest_attempt.response_status)}`
                                                : ''
                                        ].filter(Boolean).join(' · '))}
                                    </div>
                                `
                                : ''}
                            ${Number(entry?.manual_event_count || 0) > 0
                                ? this.renderReminderSummaryManualEvent(entry?.latest_manual_event, {
                                    compact: true
                                })
                                : ''}
                            ${this.safeText(entry?.last_error).trim()
                                ? `<div class="admin-ticket-overview-reminder-activity-item__error">${this.escapeHtml(entry.last_error)}</div>`
                                : ''}
                            ${this.renderReminderSummaryJobActions(entry, {
                                showRetry: this.canRequestReminderSummaryRetry(entry)
                            })}
                        </article>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderReminderPanelActions: function (options = {}) {
        const classes = ['admin-ticket-overview-reminder-actions'];
        if (options?.embedded === true) {
            classes.push('admin-ticket-overview-reminder-actions--embedded');
        }

        return `
            <div class="${classes.join(' ')}">
                <button type="button" class="btn-secondary" data-admin-action="tickets-open-overdue-queue">只看超时工单</button>
                <button type="button" class="btn-secondary" data-admin-action="tickets-open-sla-settings">打开提醒设置</button>
                <button type="button" class="btn-secondary" data-admin-action="tickets-refresh-overview">刷新概览</button>
            </div>
        `;
    },

    renderReminderActivityList: function (activity = {}, options = {}) {
        const reminderActivity = activity && typeof activity === 'object'
            ? activity
            : this.buildEmptyReminderActivityOverview();
        const includeFooterActions = options?.includeFooterActions === true;
        const lookbackDays = Math.max(1, Number(reminderActivity?.lookback_days || 7) || 7);
        const latestEntries = [{
            title: '最近一次超时提醒',
            entry: reminderActivity.latest_overdue
        }, {
            title: '最近一次恢复提醒',
            entry: reminderActivity.latest_recovered
        }].filter((item) => item.entry && typeof item.entry === 'object');

        const statItems = [{
            label: `近 ${lookbackDays} 天总计`,
            value: Math.max(0, Number(reminderActivity?.total_job_count || 0) || 0)
        }, {
            label: '超时提醒',
            value: Math.max(0, Number(reminderActivity?.overdue_job_count || 0) || 0)
        }, {
            label: '恢复提醒',
            value: Math.max(0, Number(reminderActivity?.recovered_job_count || 0) || 0)
        }, {
            label: '已送达',
            value: Math.max(0, Number(reminderActivity?.delivered_count || 0) || 0)
        }];

        return `
            <section class="admin-ticket-overview-reminder-activity">
                <div class="admin-ticket-overview-reminder-activity__head">
                    <div>
                        <div class="admin-ticket-overview-reminder-activity__title">提醒活动闭环</div>
                        <div class="admin-ticket-overview-reminder-activity__meta">
                            活跃 ${Math.max(0, Number(reminderActivity?.active_count || 0) || 0)} 单
                            · 重试 ${Math.max(0, Number(reminderActivity?.retry_count || 0) || 0)} 次
                            · 死信 ${Math.max(0, Number(reminderActivity?.dead_letter_count || 0) || 0)} 条
                        </div>
                    </div>
                </div>
                <div class="admin-ticket-overview-reminder-activity-stats">
                    ${statItems.map((item) => `
                        <div class="admin-ticket-overview-reminder-activity-stat">
                            <span>${this.escapeHtml(item.label)}</span>
                            <strong>${this.escapeHtml(String(item.value))}</strong>
                        </div>
                    `).join('')}
                </div>
                <div class="admin-ticket-overview-reminder-activity-list">
                    ${latestEntries.length
                        ? latestEntries.map((item) => {
                            const entry = item.entry || {};
                            const statusMeta = this.getReminderActivityStatusMeta(entry?.status);
                            const metaParts = [
                                entry?.created_at ? `创建 ${this.formatDateTime(entry.created_at)}` : '',
                                entry?.ticket_id ? `工单 ${this.safeText(entry.ticket_id).trim()}` : '',
                                entry?.wait_label ? `等待 ${this.safeText(entry.wait_label).trim()}` : '',
                                `通道 ${this.formatReminderChannelsLabel(entry?.channels)}`
                            ].filter(Boolean);
                            const attemptParts = [
                                `尝试 ${Math.max(0, Number(entry?.attempt_count || 0) || 0)} 次`,
                                entry?.delivered_at ? `送达 ${this.formatDateTime(entry.delivered_at)}` : '',
                                Array.isArray(entry?.remaining_channels) && entry.remaining_channels.length
                                    ? `待重试 ${this.formatReminderChannelsLabel(entry.remaining_channels, '')}`
                                    : ''
                            ].filter(Boolean);
                            const latestAttempt = entry?.latest_attempt && typeof entry.latest_attempt === 'object'
                                ? entry.latest_attempt
                                : null;
                            const latestAttemptMeta = latestAttempt
                                ? [
                                    '最近尝试',
                                    this.getReminderChannelLabel(latestAttempt?.channel),
                                    this.getReminderActivityStatusMeta(latestAttempt?.status).label,
                                    Number.isFinite(Number(latestAttempt?.response_status))
                                        ? `HTTP ${Number(latestAttempt.response_status)}`
                                        : ''
                                ].filter(Boolean).join(' · ')
                                : '';

                            return `
                                <article class="admin-ticket-overview-reminder-activity-item admin-ticket-overview-reminder-activity-item--${this.escapeHtml(statusMeta.tone)}">
                                    <div class="admin-ticket-overview-reminder-activity-item__head">
                                        <div>
                                            <div class="admin-ticket-overview-reminder-activity-item__kicker">${this.escapeHtml(item.title)}</div>
                                            <div class="admin-ticket-overview-reminder-activity-item__title">
                                                ${this.escapeHtml(entry?.title || this.formatReminderActivityKindLabel(entry?.kind))}
                                            </div>
                                        </div>
                                        <span class="admin-ticket-overview-reminder-activity-item__status admin-ticket-overview-reminder-activity-item__status--${this.escapeHtml(statusMeta.tone)}">
                                            ${this.escapeHtml(statusMeta.label)}
                                        </span>
                                    </div>
                                    <div class="admin-ticket-overview-reminder-activity-item__meta">${this.escapeHtml(metaParts.join(' · '))}</div>
                                    <div class="admin-ticket-overview-reminder-activity-item__meta">${this.escapeHtml(attemptParts.join(' · '))}</div>
                                    ${latestAttemptMeta
                                        ? `<div class="admin-ticket-overview-reminder-activity-item__meta">${this.escapeHtml(latestAttemptMeta)}</div>`
                                        : ''}
                                    ${this.safeText(entry?.last_error).trim()
                                        ? `<div class="admin-ticket-overview-reminder-activity-item__error">${this.escapeHtml(entry.last_error)}</div>`
                                        : ''}
                                    ${this.safeText(entry?.ticket_id || entry?.target_id).trim()
                                        ? `
                                            <div class="admin-ticket-overview-reminder-activity-item__actions">
                                                <button
                                                    type="button"
                                                    class="btn-secondary admin-ticket-overview-reminder-activity-item__btn"
                                                    data-admin-action="tickets-open-reminder-ticket"
                                                    data-ticket-id="${this.escapeHtml(entry?.ticket_id || entry?.target_id || '')}">
                                                    定位工单
                                                </button>
                                            </div>
                                        `
                                        : ''}
                                </article>
                            `;
                        }).join('')
                        : `<div class="admin-ticket-overview-empty">最近 ${lookbackDays} 天还没有记录到工单超时提醒外发结果。</div>`}
                </div>
                ${includeFooterActions
                    ? `
                        <div class="admin-ticket-overview-reminder-activity__footer">
                            ${this.renderReminderPanelActions({ embedded: true })}
                        </div>
                    `
                    : ''}
            </section>
        `;
    },

    renderReminderSummaryEntry: function (reminder = {}, summaryDigest = {}) {
        const summaryEnabled = reminder.summary_enabled === true;
        const scheduleMode = this.safeText(reminder?.summary_schedule_mode).trim().toLowerCase();
        const isDailySummary = summaryEnabled && scheduleMode === 'daily';
        const digest = summaryDigest && typeof summaryDigest === 'object'
            ? summaryDigest
            : this.buildEmptyReminderSummaryDigest();
        const latestSummaryJob = isDailySummary
            ? (digest.latest_daily_job || digest.latest_job)
            : (digest.latest_job || digest.latest_daily_job);
        const latestProblemJob = digest?.latest_problem_job && typeof digest.latest_problem_job === 'object'
            ? digest.latest_problem_job
            : null;
        const statusMeta = latestSummaryJob
            ? this.getReminderActivityStatusMeta(latestSummaryJob.status)
            : { label: '暂无汇总', tone: 'slate' };
        let summaryCopy = '当前超时提醒默认即时发送，如需固定在每日某个时点统一回顾队列，可在这里切到每日汇总。';

        if (isDailySummary) {
            summaryCopy = `当前每日 SLA 汇总会在 ${String(Math.max(0, Number(reminder?.summary_daily_hour || 0) || 0)).padStart(2, '0')}:${String(Math.max(0, Number(reminder?.summary_daily_minute || 0) || 0)).padStart(2, '0')} 统一外发超时工单摘要。`;
        } else if (summaryEnabled) {
            summaryCopy = `当前汇总模式为 ${this.formatReminderScheduleLabel(reminder)}，如果希望每天固定复盘一次队列，可以直接切到每日汇总。`;
        }

        return `
            <div class="admin-ticket-overview-reminder-summary-entry">
                <div class="admin-ticket-overview-reminder-summary-entry__top">
                    <div class="admin-ticket-overview-reminder-summary-entry__copy">
                        <div class="admin-ticket-overview-reminder-summary-entry__title">每日 SLA 汇总</div>
                        <div class="admin-ticket-overview-reminder-summary-entry__meta">${this.escapeHtml(summaryCopy)}</div>
                    </div>
                    <button
                        type="button"
                        class="btn-secondary admin-ticket-overview-reminder-summary-entry__btn"
                        data-admin-action="tickets-open-sla-summary-settings">
                        ${isDailySummary ? '查看每日汇总设置' : '配置每日汇总'}
                    </button>
                </div>
                <div class="admin-ticket-overview-reminder-summary-entry__status-row">
                    <span class="admin-ticket-overview-reminder-chip ${isDailySummary ? 'admin-ticket-overview-reminder-chip--success' : ''}">
                        <i class="fas ${isDailySummary ? 'fa-calendar-check' : 'fa-calendar-day'}"></i>
                        ${isDailySummary ? '当前为每日汇总' : (summaryEnabled ? '当前非每日汇总' : '未启用汇总')}
                    </span>
                    <span class="admin-ticket-overview-reminder-activity-item__status admin-ticket-overview-reminder-activity-item__status--${this.escapeHtml(statusMeta.tone)}">
                        最近一次外发：${this.escapeHtml(statusMeta.label)}
                    </span>
                </div>
                <div class="admin-ticket-overview-reminder-summary-entry__status-row">
                    <span class="admin-ticket-overview-reminder-chip">
                        <i class="fas fa-clock-rotate-left"></i>
                        近 ${Math.max(1, Number(digest?.lookback_days || 7) || 7)} 天汇总 ${Math.max(0, Number(digest?.total_job_count || 0) || 0)} 次
                    </span>
                    <span class="admin-ticket-overview-reminder-chip ${Number(digest?.failure_job_count || 0) > 0 ? 'admin-ticket-overview-reminder-chip--warning' : 'admin-ticket-overview-reminder-chip--success'}">
                        <i class="fas ${Number(digest?.failure_job_count || 0) > 0 ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
                        异常汇总 ${Math.max(0, Number(digest?.failure_job_count || 0) || 0)} 次
                    </span>
                </div>
                <div class="admin-ticket-overview-reminder-summary-entry__cards">
                    <div class="admin-ticket-overview-reminder-summary-entry__result">
                        ${latestSummaryJob
                            ? `
                                <div class="admin-ticket-overview-reminder-summary-entry__result-head">
                                    <div class="admin-ticket-overview-reminder-summary-entry__result-title">${this.escapeHtml(latestSummaryJob.title || '最近一次工单汇总')}</div>
                                    ${this.renderReminderSummaryJobActions(latestSummaryJob, {
                                        showRetry: this.canRequestReminderSummaryRetry(latestSummaryJob)
                                    })}
                                </div>
                                <div class="admin-ticket-overview-reminder-summary-entry__result-meta">
                                    ${this.escapeHtml([
                                        `窗口 ${this.formatReminderSummaryWindowLabel(latestSummaryJob)}`,
                                        `累计 ${Math.max(0, Number(latestSummaryJob?.item_count || 0) || 0)} 单`,
                                        `通道 ${this.formatReminderChannelsLabel(latestSummaryJob?.channels)}`
                                    ].join(' · '))}
                                </div>
                                <div class="admin-ticket-overview-reminder-summary-entry__result-meta">
                                    ${this.escapeHtml([
                                        latestSummaryJob?.created_at ? `创建 ${this.formatDateTime(latestSummaryJob.created_at)}` : '',
                                        latestSummaryJob?.delivered_at ? `送达 ${this.formatDateTime(latestSummaryJob.delivered_at)}` : '',
                                        `尝试 ${Math.max(0, Number(latestSummaryJob?.attempt_count || 0) || 0)} 次`
                                    ].filter(Boolean).join(' · '))}
                                </div>
                                ${latestSummaryJob?.latest_attempt
                                    ? `
                                        <div class="admin-ticket-overview-reminder-summary-entry__result-meta">
                                            ${this.escapeHtml([
                                                '最近尝试',
                                                this.getReminderChannelLabel(latestSummaryJob.latest_attempt.channel),
                                                this.getReminderActivityStatusMeta(latestSummaryJob.latest_attempt.status).label,
                                                Number.isFinite(Number(latestSummaryJob.latest_attempt.response_status))
                                                    ? `HTTP ${Number(latestSummaryJob.latest_attempt.response_status)}`
                                                    : ''
                                            ].filter(Boolean).join(' · '))}
                                        </div>
                                    `
                                    : ''}
                                ${Number(latestSummaryJob?.manual_event_count || 0) > 0
                                    ? `
                                        <div class="admin-ticket-overview-reminder-summary-entry__result-meta">
                                            ${this.escapeHtml(`人工跟进 ${Math.max(0, Number(latestSummaryJob?.manual_event_count || 0) || 0)} 次`)}
                                        </div>
                                        ${this.renderReminderSummaryManualEvent(latestSummaryJob?.latest_manual_event)}
                                    `
                                    : ''}
                                ${this.safeText(latestSummaryJob?.last_error).trim()
                                    ? `<div class="admin-ticket-overview-reminder-activity-item__error">${this.escapeHtml(latestSummaryJob.last_error)}</div>`
                                    : ''}
                                <div class="admin-ticket-overview-reminder-summary-entry__preview-title">本次汇总预览</div>
                                ${this.renderReminderSummaryPreviewList(latestSummaryJob)}
                            `
                            : `<div class="admin-ticket-overview-empty">最近 ${Math.max(1, Number(digest?.lookback_days || 7) || 7)} 天还没有记录到工单汇总外发结果。</div>`}
                    </div>
                    <div class="admin-ticket-overview-reminder-summary-entry__diagnostics">
                        <div class="admin-ticket-overview-reminder-summary-entry__preview-title">失败与重试诊断</div>
                        ${latestProblemJob
                            ? `
                                <div class="admin-ticket-overview-reminder-summary-diagnostic admin-ticket-overview-reminder-summary-diagnostic--${this.escapeHtml(this.getReminderActivityStatusMeta(latestProblemJob.status).tone)}">
                                    <div class="admin-ticket-overview-reminder-summary-diagnostic__kicker">最近一次异常汇总</div>
                                    <div class="admin-ticket-overview-reminder-summary-diagnostic__title">${this.escapeHtml(latestProblemJob.title || '最近一次异常汇总')}</div>
                                    <div class="admin-ticket-overview-reminder-summary-diagnostic__meta">
                                        ${this.escapeHtml([
                                            `状态 ${this.getReminderActivityStatusMeta(latestProblemJob.status).label}`,
                                            latestProblemJob?.created_at ? `创建 ${this.formatDateTime(latestProblemJob.created_at)}` : '',
                                            `通道 ${this.formatReminderChannelsLabel(latestProblemJob?.channels)}`
                                        ].filter(Boolean).join(' · '))}
                                    </div>
                                    <div class="admin-ticket-overview-reminder-summary-diagnostic__meta">
                                        ${this.escapeHtml([
                                            `尝试 ${Math.max(0, Number(latestProblemJob?.attempt_count || 0) || 0)} 次`,
                                            Array.isArray(latestProblemJob?.remaining_channels) && latestProblemJob.remaining_channels.length
                                                ? `待重试 ${this.formatReminderChannelsLabel(latestProblemJob.remaining_channels, '')}`
                                                : '',
                                            latestProblemJob?.latest_attempt
                                                ? [
                                                    `最近尝试 ${this.getReminderChannelLabel(latestProblemJob.latest_attempt.channel)} / ${this.getReminderActivityStatusMeta(latestProblemJob.latest_attempt.status).label}`,
                                                    Number.isFinite(Number(latestProblemJob.latest_attempt.response_status))
                                                        ? `HTTP ${Number(latestProblemJob.latest_attempt.response_status)}`
                                                        : ''
                                                ].filter(Boolean).join(' · ')
                                                : ''
                                        ].filter(Boolean).join(' · '))}
                                    </div>
                                    ${this.safeText(latestProblemJob?.entry_path).trim()
                                        ? `<div class="admin-ticket-overview-reminder-summary-diagnostic__meta">入口 ${this.escapeHtml(latestProblemJob.entry_path)}</div>`
                                        : ''}
                                    ${Number(latestProblemJob?.manual_event_count || 0) > 0
                                        ? this.renderReminderSummaryManualEvent(latestProblemJob?.latest_manual_event, {
                                            compact: true
                                        })
                                        : ''}
                                    ${this.safeText(latestProblemJob?.last_error).trim()
                                        ? `<div class="admin-ticket-overview-reminder-activity-item__error">${this.escapeHtml(latestProblemJob.last_error)}</div>`
                                        : ''}
                                    ${this.renderReminderSummaryJobActions(latestProblemJob, {
                                        showRetry: this.canRequestReminderSummaryRetry(latestProblemJob)
                                    })}
                                </div>
                            `
                            : '<div class="admin-ticket-overview-empty">最近这段时间没有记录到工单汇总发送失败或重试。</div>'}
                    </div>
                    <div class="admin-ticket-overview-reminder-summary-entry__history">
                        <div class="admin-ticket-overview-reminder-summary-entry__preview-title">最近几次汇总记录</div>
                        ${this.renderReminderSummaryHistoryList(digest)}
                    </div>
                </div>
            </div>
        `;
    },

    getReminderWorkspaceMode: function () {
        return this.currentWorkspaceView === 'summary' ? 'summary' : 'overview';
    },

    syncReminderWorkspacePresentation: function (options = {}) {
        const mode = this.safeText(options?.mode || this.getReminderWorkspaceMode()).trim().toLowerCase() === 'summary'
            ? 'summary'
            : 'overview';
        const headingNode = document.getElementById('ticketsOverviewReminderHeading');
        const metaNode = document.getElementById('ticketsOverviewReminderMeta');
        const reminderPanel = document.getElementById('ticketsOverviewReminderPanel');

        if (headingNode) {
            headingNode.textContent = mode === 'summary' ? '汇总追踪' : '超时提醒状态';
        }
        if (metaNode) {
            metaNode.textContent = mode === 'summary'
                ? '日报任务、重试记录与最近提醒活动'
                : '沿用工单告警编排';
        }

        if (options?.rerender !== false && reminderPanel && this.overview) {
            reminderPanel.innerHTML = this.renderReminderPanel(this.overview, { mode });
        }

        return mode;
    },

    renderReminderSummaryStatusStrip: function (reminder = {}, backlog = {}) {
        const enabled = reminder.enabled === true;
        const summaryStrategy = enabled
            ? (reminder.summary_enabled === true ? this.formatReminderScheduleLabel(reminder) : '即时发送')
            : '已暂停';
        const statusTone = enabled ? 'success' : 'warning';
        const overdueCount = Math.max(0, Number(backlog?.overdue_count || 0) || 0);
        const sweepIntervalMinutes = Math.max(1, Number(reminder?.sweep_interval_minutes || 10) || 10);
        const overdueThresholdMinutes = Math.max(5, Number(reminder?.pending_overdue_minutes || 120) || 120);
        const criticalThresholdMinutes = Math.max(30, Number(reminder?.critical_overdue_minutes || 720) || 720);

        return `
            <div class="admin-ticket-overview-reminder-status-strip">
                <div class="admin-ticket-overview-reminder-status-strip__head">
                    <div class="admin-ticket-overview-reminder-status-strip__copy">
                        <div class="admin-ticket-overview-reminder-status-strip__title">当前提醒配置</div>
                        <div class="admin-ticket-overview-reminder-status-strip__meta">保留汇总追踪所需的基础状态，避免来回切回 SLA 看板确认参数。</div>
                    </div>
                    <span class="admin-ticket-overview-reminder-chip admin-ticket-overview-reminder-chip--${statusTone}">
                        <i class="fas ${enabled ? 'fa-bell' : 'fa-bell-slash'}"></i>
                        ${enabled ? '提醒开启中' : '提醒已关闭'}
                    </span>
                </div>
                <div class="admin-ticket-overview-reminder-status-strip__metrics">
                    <div class="admin-ticket-overview-reminder-status-tile">
                        <span class="admin-ticket-overview-reminder-status-tile__label">当前超时</span>
                        <strong>${this.escapeHtml(String(overdueCount))} 单</strong>
                        <small>待处理超时 ${this.escapeHtml(String(overdueThresholdMinutes))} 分钟，critical ${this.escapeHtml(String(criticalThresholdMinutes))} 分钟</small>
                    </div>
                    <div class="admin-ticket-overview-reminder-status-tile">
                        <span class="admin-ticket-overview-reminder-status-tile__label">巡检频率</span>
                        <strong>${this.escapeHtml(String(sweepIntervalMinutes))} 分钟</strong>
                        <small>按当前阈值持续扫描队列</small>
                    </div>
                    <div class="admin-ticket-overview-reminder-status-tile">
                        <span class="admin-ticket-overview-reminder-status-tile__label">汇总策略</span>
                        <strong>${this.escapeHtml(summaryStrategy)}</strong>
                        <small>${enabled ? '命中超时后按该策略外发' : '开启提醒后会按这里的策略执行'}</small>
                    </div>
                </div>
            </div>
        `;
    },

    renderReminderPanel: function (overview = {}, options = {}) {
        const reminder = overview?.reminder || {};
        const backlog = overview?.backlog || {};
        const activity = reminder?.activity && typeof reminder.activity === 'object'
            ? reminder.activity
            : this.buildEmptyReminderActivityOverview();
        const summaryDigest = reminder?.summary_digest && typeof reminder.summary_digest === 'object'
            ? reminder.summary_digest
            : this.buildEmptyReminderSummaryDigest();
        const mode = this.safeText(options?.mode || this.getReminderWorkspaceMode()).trim().toLowerCase() === 'summary'
            ? 'summary'
            : 'overview';
        const isSummaryMode = mode === 'summary';
        const enabled = reminder.enabled === true;
        const chipTone = enabled ? 'success' : 'warning';
        let statusCopy = enabled
            ? `工单超时提醒已开启，超时阈值 ${Math.max(5, Number(reminder.pending_overdue_minutes || 120) || 120)} 分钟，critical 阈值 ${Math.max(30, Number(reminder.critical_overdue_minutes || 720) || 720)} 分钟。`
            : '工单超时提醒当前处于关闭状态，售后工单仍会正常显示，但不会自动外发超时提醒。';

        if (enabled && reminder.work_hours_only_enabled === true && reminder.summary_enabled === true) {
            statusCopy += ` 非工作时段会顺延，并按 ${this.formatReminderScheduleLabel(reminder)} 汇总。`;
        } else if (enabled && reminder.work_hours_only_enabled === true) {
            statusCopy += ' 非工作时段会顺延到下一个工作时段再提醒。';
        } else if (enabled && reminder.summary_enabled === true) {
            statusCopy += ` 命中超时后会按 ${this.formatReminderScheduleLabel(reminder)} 合并外发。`;
        } else if (enabled) {
            statusCopy += ' 命中超时后会立即沿用工单告警路由外发。';
        }

        if (enabled !== true && reminder.ops_alerts_enabled === false) {
            statusCopy = '全局站外告警已关闭，因此工单超时提醒也会一并暂停。';
        }

        const statusSection = `
            <section class="admin-ticket-overview-reminder-section admin-ticket-overview-reminder-section--status">
                <div class="admin-ticket-overview-reminder-status">
                    <span class="admin-ticket-overview-reminder-chip admin-ticket-overview-reminder-chip--${chipTone}">
                        <i class="fas ${enabled ? 'fa-bell' : 'fa-bell-slash'}"></i>
                        ${enabled ? '提醒已开启' : '提醒已关闭'}
                    </span>
                    <span class="admin-ticket-overview-reminder-chip">
                        <i class="fas fa-layer-group"></i>
                        当前超时 ${Math.max(0, Number(backlog.overdue_count || 0) || 0)} 单
                    </span>
                </div>
                <p class="admin-ticket-overview-reminder-copy">${this.escapeHtml(statusCopy)}</p>
                <div class="admin-ticket-overview-reminder-metrics">
                    <div class="admin-ticket-overview-reminder-metric">
                        <span>巡检频率</span>
                        <strong>${this.escapeHtml(String(Math.max(1, Number(reminder.sweep_interval_minutes || 10) || 10)))} 分钟</strong>
                    </div>
                    <div class="admin-ticket-overview-reminder-metric">
                        <span>汇总策略</span>
                        <strong>${this.escapeHtml(reminder.summary_enabled === true ? this.formatReminderScheduleLabel(reminder) : '即时发送')}</strong>
                    </div>
                </div>
            </section>
        `;
        const summarySection = `
            <section class="admin-ticket-overview-reminder-section admin-ticket-overview-reminder-section--summary">
                ${this.renderReminderSummaryEntry(reminder, summaryDigest)}
            </section>
        `;
        const summaryStatusStripSection = `
            <section class="admin-ticket-overview-reminder-section admin-ticket-overview-reminder-section--status-strip">
                ${this.renderReminderSummaryStatusStrip(reminder, backlog)}
            </section>
        `;
        const activitySection = `
            <section class="admin-ticket-overview-reminder-section admin-ticket-overview-reminder-section--activity">
                ${this.renderReminderActivityList(activity, {
                    includeFooterActions: isSummaryMode
                })}
            </section>
        `;

        return `
            <div class="admin-ticket-overview-reminder-grid admin-ticket-overview-reminder-grid--${isSummaryMode ? 'summary' : 'overview'}">
                ${isSummaryMode ? `${summaryStatusStripSection}${summarySection}${activitySection}` : statusSection}
            </div>
            ${isSummaryMode ? '' : this.renderReminderPanelActions()}
        `;
    },

    renderOverviewSkeleton: function () {
        const grid = document.getElementById('ticketsOverviewGrid');
        const sourceBreakdown = document.getElementById('ticketsOverviewSourceBreakdown');
        const issueBreakdown = document.getElementById('ticketsOverviewIssueBreakdown');
        const reminderPanel = document.getElementById('ticketsOverviewReminderPanel');
        const subtitle = document.getElementById('ticketsOverviewSubtitle');
        const updatedAt = document.getElementById('ticketsOverviewUpdatedAt');

        if (subtitle) {
            subtitle.textContent = '正在汇总待处理队列、近 30 天处理效率和超时提醒状态...';
        }
        if (updatedAt) {
            updatedAt.textContent = '正在加载';
        }
        if (grid) {
            grid.innerHTML = Array.from({ length: 4 }, () => `
                <div class="admin-ticket-overview-card">
                    <div class="admin-ticket-overview-breakdown-skeleton">
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-40"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-80"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                    </div>
                </div>
            `).join('');
        }
        if (sourceBreakdown) {
            sourceBreakdown.innerHTML = `
                <div class="admin-ticket-overview-breakdown-skeleton">
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-80"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                </div>
            `;
        }
        if (issueBreakdown) {
            issueBreakdown.innerHTML = `
                <div class="admin-ticket-overview-breakdown-skeleton">
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-80"></span>
                </div>
            `;
        }
        if (reminderPanel) {
            reminderPanel.innerHTML = `
                <div class="admin-ticket-overview-reminder-skeleton">
                    <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-md"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-80"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-60"></span>
                </div>
            `;
        }
    },

    renderOverviewError: function (message = '') {
        const grid = document.getElementById('ticketsOverviewGrid');
        const sourceBreakdown = document.getElementById('ticketsOverviewSourceBreakdown');
        const issueBreakdown = document.getElementById('ticketsOverviewIssueBreakdown');
        const reminderPanel = document.getElementById('ticketsOverviewReminderPanel');
        const subtitle = document.getElementById('ticketsOverviewSubtitle');
        const updatedAt = document.getElementById('ticketsOverviewUpdatedAt');
        const errorText = this.safeText(message, '工单概览暂不可用').trim() || '工单概览暂不可用';

        if (subtitle) {
            subtitle.textContent = '概览加载失败，不影响工单列表和处理动作。';
        }
        if (updatedAt) {
            updatedAt.textContent = '加载失败';
        }
        if (grid) {
            grid.innerHTML = `
                <div class="admin-ticket-overview-state">
                    <i class="fas fa-circle-exclamation"></i>
                    <span>${this.escapeHtml(errorText)}</span>
                </div>
            `;
        }
        if (sourceBreakdown) {
            sourceBreakdown.innerHTML = `<div class="admin-ticket-overview-empty">概览接口恢复后会显示待处理来源分布。</div>`;
        }
        if (issueBreakdown) {
            issueBreakdown.innerHTML = `<div class="admin-ticket-overview-empty">概览接口恢复后会显示问题类型分布。</div>`;
        }
        if (reminderPanel) {
            reminderPanel.innerHTML = `
                <div class="admin-ticket-overview-empty">
                    可以继续处理工单；如需重新拉取概览，请点击“刷新概览”。
                </div>
            `;
        }
        this.closeReminderSummaryJobDetail();
    },

    renderOverview: function () {
        const grid = document.getElementById('ticketsOverviewGrid');
        const sourceBreakdown = document.getElementById('ticketsOverviewSourceBreakdown');
        const issueBreakdown = document.getElementById('ticketsOverviewIssueBreakdown');
        const reminderPanel = document.getElementById('ticketsOverviewReminderPanel');
        const subtitle = document.getElementById('ticketsOverviewSubtitle');
        const updatedAt = document.getElementById('ticketsOverviewUpdatedAt');
        const overview = this.overview;

        if (!grid || !sourceBreakdown || !issueBreakdown || !reminderPanel) {
            return;
        }

        if (!overview) {
            this.renderOverviewError(this.overviewErrorMessage || '工单概览暂不可用');
            return;
        }

        const lookbackDays = Math.max(1, Number(overview?.efficiency?.lookback_days || 30) || 30);
        if (subtitle) {
            subtitle.textContent = `按当前 SLA 配置汇总待处理队列，并统计最近 ${lookbackDays} 天结单工单的首次跟进和结单效率。`;
        }
        if (updatedAt) {
            updatedAt.textContent = overview.generated_at
                ? `更新时间：${this.formatDateTime(overview.generated_at)}`
                : '更新时间：刚刚';
        }
        const reminderMode = this.syncReminderWorkspacePresentation({
            rerender: false
        });

        grid.innerHTML = this.renderOverviewCards(this.buildOverviewCards(overview));
        sourceBreakdown.innerHTML = this.renderOverviewBreakdown(
            overview.sources,
            '当前待处理队列暂无来源分布数据。'
        );
        issueBreakdown.innerHTML = this.renderOverviewBreakdown(
            overview.issue_types,
            '当前待处理队列暂无问题类型分布。'
        );
        reminderPanel.innerHTML = this.renderReminderPanel(overview, {
            mode: reminderMode
        });
        this.syncReminderSummaryJobDetailModal();
    },

    loadOverview: async function (options = {}) {
        if (this._overviewPromise && options.force !== true) {
            return this._overviewPromise;
        }

        const requestId = (this._overviewRequestId || 0) + 1;
        this._overviewRequestId = requestId;

        if (options.showSkeleton !== false) {
            this.renderOverviewSkeleton();
        }

        this._overviewPromise = (async () => {
            try {
                await this.waitForAuthReady(Number(options?.authTimeoutMs || 2400));

                if (this._forceClientSideOverviewFallback === true) {
                    await this.loadOverviewViaSupabaseFallback({
                        ...options,
                        requestId
                    });
                    return;
                }

                const headers = await this.getAdminAuthHeaders();
                const response = await fetch(this.getTicketsMetricsUrl(), {
                    method: 'GET',
                    headers
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.success) {
                    const requestError = new Error(result.message || '工单概览加载失败');
                    requestError.statusCode = Number(response.status || 0);
                    throw requestError;
                }

                if (requestId !== this._overviewRequestId) {
                    return;
                }

                this.overview = this.normalizeOverviewPayload(result.overview || {});
                this.overviewErrorMessage = '';
                this._overviewLoadedAt = Date.now();
                this.renderOverview();
            } catch (error) {
                if (requestId !== this._overviewRequestId) {
                    return;
                }

                if (this.shouldUseClientSideOverviewFallback(error)) {
                    try {
                        this._forceClientSideOverviewFallback = true;
                        await this.loadOverviewViaSupabaseFallback({
                            ...options,
                            requestId
                        });
                        return;
                    } catch (fallbackError) {
                        console.warn('[AdminTickets] overview fallback load error:', fallbackError);
                        error = fallbackError;
                    }
                }

                console.warn('[AdminTickets] overview load error:', error);
                this.overview = null;
                this.overviewErrorMessage = this.safeText(error?.message, '工单概览暂不可用');
                this.renderOverviewError(this.overviewErrorMessage);
                if (options.notifyOnError === true) {
                    this.notify(`工单概览加载失败: ${this.overviewErrorMessage}`, 'error');
                }
            } finally {
                if (this._overviewPromise && requestId === this._overviewRequestId) {
                    this._overviewPromise = null;
                }
            }
        })();

        return this._overviewPromise;
    },

    refreshOverview: function () {
        return this.loadOverview({
            force: true,
            showSkeleton: false,
            notifyOnError: true
        });
    },

    openOverdueQueue: function () {
        this.setWorkspaceView('queue');
        this.cancelPendingSearch();
        this.currentStatus = 'pending';
        this.currentPage = 1;
        this.quickFilters = {
            ...this.quickFilters,
            overdueOnly: true
        };
        this.syncFilterButtons();
        return this.loadTickets({
            page: 1,
            status: 'pending',
            searchQuery: this.searchQuery,
            overdueOnly: true,
            priority: this.quickFilters.priority,
            assignee: this.quickFilters.assignee
        });
    },

    openSlaSettings: function () {
        const options = arguments[0] && typeof arguments[0] === 'object' && !Array.isArray(arguments[0])
            ? arguments[0]
            : {};
        const focus = this.safeText(options.focus).trim().toLowerCase();
        const switched = window.switchModule?.('settings');
        if (switched === false) {
            this.notify('当前账号没有设置模块权限，无法打开提醒配置', 'warning');
            return false;
        }

        window.switchSettingsView?.('pricing');

        const highlightCard = () => {
            const card = typeof document.querySelector === 'function'
                ? document.querySelector('[data-config="ops-alerts-tickets"]')
                : null;
            const focusIds = focus === 'summary'
                ? [
                    'opsAlertTicketsSummaryEnabledToggle',
                    'opsAlertTicketsSummaryScheduleMode',
                    'opsAlertTicketsSummaryDailyHour',
                    'opsAlertTicketsSummaryDailyMinute',
                    'opsAlertTicketsSummaryWindowMinutes',
                    'opsAlertTicketsSummaryMaxItems'
                ]
                : [
                    'opsAlertTicketsEnabledToggle',
                    'opsAlertTicketsPendingOverdueMinutes',
                    'opsAlertTicketsCriticalOverdueMinutes',
                    'opsAlertTicketsSweepIntervalMinutes'
                ];
            const highlightTargets = focusIds
                .map((id) => document.getElementById(id))
                .filter((element) => element && typeof element.classList?.add === 'function');
            const scrollTarget = highlightTargets[0] || card;

            if (card && typeof card.classList?.add === 'function') {
                card.classList.add('admin-ticket-config-card--highlight');
            }
            highlightTargets.forEach((element) => {
                element.classList.add('admin-ticket-config-focus-field--highlight');
            });

            if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            window.setTimeout(() => {
                if (card && typeof card.classList?.remove === 'function') {
                    card.classList.remove('admin-ticket-config-card--highlight');
                }
                highlightTargets.forEach((element) => {
                    element.classList.remove('admin-ticket-config-focus-field--highlight');
                });
            }, 1800);
        };

        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(highlightCard);
        });
        return true;
    },

    openSlaSummarySettings: function () {
        return this.openSlaSettings({
            focus: 'summary'
        });
    },

    syncReminderSummaryJobDetailModal: function () {
        this.captureReminderSummaryJobNoteDraft(this.activeReminderSummaryJobId);
        const modal = document.getElementById('ticketSummaryJobDetailModal');
        const titleNode = document.getElementById('ticketSummaryJobDetailTitle');
        const subtitleNode = document.getElementById('ticketSummaryJobDetailSubtitle');
        const bodyNode = document.getElementById('ticketSummaryJobDetailBody');
        const retryButton = document.getElementById('ticketSummaryJobRetryBtn');
        if (!modal || !titleNode || !subtitleNode || !bodyNode || !retryButton) {
            return;
        }

        const jobEntry = this.resolveReminderSummaryJobEntry(this.activeReminderSummaryJobId);
        if (!jobEntry) {
            this.activeReminderSummaryJobId = '';
            modal.classList.remove('is-visible');
            modal.setAttribute('aria-hidden', 'true');
            titleNode.textContent = '工单汇总详情';
            subtitleNode.textContent = '回看外发窗口、人工备注和重试时间线';
            bodyNode.innerHTML = '';
            retryButton.disabled = true;
            retryButton.textContent = '重新加入重试队列';
            retryButton.dataset.summaryJobId = '';
            return;
        }

        const statusMeta = this.getReminderActivityStatusMeta(jobEntry.status);
        const historyState = this.getReminderSummaryJobHistoryState(jobEntry.id);
        titleNode.textContent = this.safeText(jobEntry.title, '工单汇总详情').trim() || '工单汇总详情';
        subtitleNode.textContent = [
            `状态：${statusMeta.label}`,
            jobEntry?.created_at ? `创建于 ${this.formatDateTime(jobEntry.created_at)}` : '',
            jobEntry?.delivered_at ? `送达于 ${this.formatDateTime(jobEntry.delivered_at)}` : ''
        ].filter(Boolean).join(' · ');
        bodyNode.innerHTML = this.renderReminderSummaryJobDetailBody(jobEntry, {
            historyState,
            noteDraft: this.reminderSummaryJobNoteDrafts?.[this.safeText(jobEntry.id).trim()] || ''
        });
        retryButton.dataset.summaryJobId = this.safeText(jobEntry.id).trim();
        retryButton.textContent = this.getReminderSummaryRetryActionLabel(jobEntry);
        retryButton.disabled = !this.canRequestReminderSummaryRetry(jobEntry);
        modal.classList.add('is-visible');
        modal.setAttribute('aria-hidden', 'false');
    },

    openReminderSummaryJobDetail: function (jobId = '') {
        const normalizedJobId = this.safeText(jobId).trim();
        if (!normalizedJobId) {
            this.notify('当前记录缺少可查看的汇总任务标识', 'warning');
            return false;
        }

        const entry = this.resolveReminderSummaryJobEntry(normalizedJobId);
        if (!entry) {
            this.notify('没有找到这条汇总记录，可能已超出当前概览窗口', 'warning');
            return false;
        }

        this.setWorkspaceView('summary', {
            scroll: false,
            highlight: false
        });
        this.activeReminderSummaryJobId = normalizedJobId;
        this.syncReminderSummaryJobDetailModal();
        this.loadReminderSummaryJobHistory(normalizedJobId, {
            force: true
        });
        return true;
    },

    closeReminderSummaryJobDetail: function () {
        this.captureReminderSummaryJobNoteDraft(this.activeReminderSummaryJobId);
        this.activeReminderSummaryJobId = '';
        this.syncReminderSummaryJobDetailModal();
    },

    submitReminderSummaryNote: async function (jobId = '') {
        const normalizedJobId = this.safeText(jobId).trim() || this.safeText(this.activeReminderSummaryJobId).trim();
        if (!normalizedJobId) {
            this.notify('当前没有可记录备注的汇总任务', 'warning');
            return false;
        }

        const jobEntry = this.resolveReminderSummaryJobEntry(normalizedJobId);
        if (!jobEntry) {
            this.notify('没有找到这条汇总记录，请先刷新概览', 'warning');
            return false;
        }

        const noteDraft = this.captureReminderSummaryJobNoteDraft(normalizedJobId);
        const normalizedNote = this.safeText(noteDraft).trim().slice(0, 2000);
        if (!normalizedNote) {
            this.notify('请先填写内部备注，再保存', 'warning');
            return false;
        }

        this.reminderSummaryJobNoteSavingId = normalizedJobId;
        this.syncReminderSummaryJobDetailModal();

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.getTicketsSummaryActionsUrl(), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    jobId: normalizedJobId,
                    action: 'add_note',
                    note: normalizedNote
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '汇总任务备注保存失败');
            }

            this.reminderSummaryJobNoteDrafts = this.reminderSummaryJobNoteDrafts && typeof this.reminderSummaryJobNoteDrafts === 'object'
                ? this.reminderSummaryJobNoteDrafts
                : {};
            this.reminderSummaryJobNoteDrafts[normalizedJobId] = '';
            const noteInput = document.getElementById('ticketSummaryJobNoteInput');
            if (noteInput) {
                noteInput.value = '';
            }
            this.notify(this.safeText(result.message, '已记录人工备注'), 'success');
            await this.loadReminderSummaryJobHistory(normalizedJobId, {
                force: true
            });
            this.syncReminderSummaryJobDetailModal();
            return true;
        } catch (error) {
            this.notify(`保存备注失败: ${this.safeText(error?.message, '未知错误')}`, 'error');
            this.syncReminderSummaryJobDetailModal();
            return false;
        } finally {
            if (this.reminderSummaryJobNoteSavingId === normalizedJobId) {
                this.reminderSummaryJobNoteSavingId = '';
            }
            if (this.activeReminderSummaryJobId === normalizedJobId) {
                this.syncReminderSummaryJobDetailModal();
            }
        }
    },

    submitReminderSummaryRetry: async function (jobId = '') {
        const normalizedJobId = this.safeText(jobId).trim() || this.safeText(this.activeReminderSummaryJobId).trim();
        if (!normalizedJobId) {
            this.notify('当前没有可重试的汇总任务', 'warning');
            return false;
        }

        const jobEntry = this.resolveReminderSummaryJobEntry(normalizedJobId);
        if (!jobEntry) {
            this.notify('没有找到这条汇总记录，请先刷新概览', 'warning');
            return false;
        }

        if (!this.canRequestReminderSummaryRetry(jobEntry)) {
            this.notify('当前汇总任务不支持人工重试', 'warning');
            return false;
        }

        const actionLabel = this.getReminderSummaryRetryActionLabel(jobEntry);
        if (!this.requestConfirmation(`确认${actionLabel}吗？系统会沿用原有通道继续处理这条汇总任务。`)) {
            return false;
        }

        const retryButton = document.getElementById('ticketSummaryJobRetryBtn');
        const originalButtonText = retryButton?.textContent || '';
        if (retryButton) {
            retryButton.disabled = true;
            retryButton.textContent = '处理中...';
        }

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.getTicketsSummaryActionsUrl(), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    jobId: normalizedJobId,
                    action: 'request_retry'
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '汇总任务重试失败');
            }

            this.notify(this.safeText(result.message, '已提交工单汇总重试'), 'success');
            await this.loadOverview({
                force: true,
                showSkeleton: false
            });
            await this.loadReminderSummaryJobHistory(normalizedJobId, {
                force: true
            });
            this.activeReminderSummaryJobId = normalizedJobId;
            this.syncReminderSummaryJobDetailModal();
            return true;
        } catch (error) {
            this.notify(`重试失败: ${this.safeText(error?.message, '未知错误')}`, 'error');
            if (retryButton) {
                retryButton.disabled = false;
                retryButton.textContent = originalButtonText || '重新加入重试队列';
            }
            return false;
        }
    },

    openReminderTicket: async function (ticketId = '') {
        const normalizedTicketId = this.safeText(ticketId).trim();
        if (!normalizedTicketId) {
            this.notify('当前提醒记录没有关联可定位的工单', 'warning');
            return false;
        }

        const result = await this.focusTicket(normalizedTicketId, {
            status: 'pending'
        });
        if (result?.matched !== true) {
            this.notify(`已切到工单检索，但没有在当前列表中找到 ${normalizedTicketId}`, 'warning');
            return false;
        }

        this.notify(`已定位到工单 ${normalizedTicketId}`, 'success');
        return true;
    },

    updatePaginationState: function (payload = {}) {
        const totalPages = Math.max(1, Number.parseInt(payload.totalPages, 10) || Math.ceil((Number(payload.totalItems) || 0) / this.pageSize) || 1);
        const page = this.normalizePageNumber(payload.page, totalPages);

        this.pagination = {
            page,
            pageSize: Math.max(1, Number.parseInt(payload.pageSize, 10) || this.pageSize),
            totalItems: Math.max(0, Number.parseInt(payload.totalItems, 10) || 0),
            totalPages,
            hasPrevPage: payload.hasPrevPage === true || page > 1,
            hasNextPage: payload.hasNextPage === true || page < totalPages,
            returnedItems: Math.max(0, Number.parseInt(payload.returnedItems, 10) || 0)
        };
        this.currentPage = page;
    },

    cancelPendingSearch: function () {
        if (typeof window.clearTimeout === 'function' && this._searchDebounceTimer) {
            window.clearTimeout(this._searchDebounceTimer);
        }
        this._searchDebounceTimer = 0;
    },

    fetchOrdersByIds: async function (orderIds = []) {
        const uniqueIds = Array.from(new Set(
            (orderIds || [])
                .map((orderId) => this.safeText(orderId))
                .filter(Boolean)
        ));
        if (!uniqueIds.length) {
            return {};
        }

        const { data, error } = await window.supabaseClient
            .from('shop_orders')
            .select('id, price_paid, refund_status')
            .in('id', uniqueIds);

        if (error) {
            throw error;
        }

        return (data || []).reduce((accumulator, row) => {
            const id = this.safeText(row?.id).trim();
            if (id) {
                accumulator[id] = row;
            }
            return accumulator;
        }, {});
    },

    formatTicketWaitLabel: function (waitMinutes) {
        const normalized = Math.max(0, Math.round(Number(waitMinutes || 0)));
        const hours = Math.floor(normalized / 60);
        const minutes = normalized % 60;

        if (hours > 0 && minutes > 0) {
            return `${hours} 小时 ${minutes} 分钟`;
        }
        if (hours > 0) {
            return `${hours} 小时`;
        }
        return `${minutes} 分钟`;
    },

    buildClientSideTicketTimingMeta: function (ticket = {}, overdueMinutes = 120) {
        const createdAtMs = Date.parse(ticket?.created_at || '');
        const waitMinutes = Number.isFinite(createdAtMs)
            ? Math.max(0, Math.round((Date.now() - createdAtMs) / 60000))
            : 0;
        const waitLabel = this.formatTicketWaitLabel(waitMinutes);
        const normalizedStatus = this.normalizeTicketStatusValue(ticket?.status);
        const isOverdue = normalizedStatus === 'PENDING' && waitMinutes >= Math.max(0, Number(overdueMinutes || 120));

        return {
            ticket_age_minutes: waitMinutes,
            wait_label: waitLabel,
            is_overdue: isOverdue,
            sla_threshold_minutes: Math.max(0, Number(overdueMinutes || 120)),
            sla_label: normalizedStatus === 'PENDING'
                ? (isOverdue ? `已超时 ${waitLabel}` : `等待 ${waitLabel}`)
                : `已处理 · ${this.getTicketStatusLabel(normalizedStatus)}`
        };
    },

    buildClientSideRefundMeta: function (ticket = {}, order = null) {
        const orderId = this.safeText(ticket?.order_id).trim();
        if (!orderId) {
            return {
                order_price_paid: 0,
                order_refund_status: 'none',
                can_refund: false,
                refund_summary: '无关联订单'
            };
        }

        const paidAmount = Math.max(0, Math.round(Number(order?.price_paid || 0)));
        const refundStatus = this.safeText(order?.refund_status, 'none').trim().toLowerCase() || 'none';
        const refunded = refundStatus === 'refunded' || refundStatus === 'full_refund';
        const pendingTicket = this.normalizeTicketStatusValue(ticket?.status) === 'PENDING';
        const canRefund = pendingTicket && !refunded && paidAmount > 0;

        let refundSummary = '可发起退款';
        if (refunded) {
            refundSummary = '订单已退款';
        } else if (paidAmount > 0) {
            refundSummary = canRefund ? `可退 ${paidAmount} 积分` : `订单金额 ${paidAmount} 积分`;
        } else {
            refundSummary = '订单无可退积分';
        }

        return {
            order_price_paid: paidAmount,
            order_refund_status: refundStatus,
            can_refund: canRefund,
            refund_summary: refundSummary
        };
    },

    buildTicketPriorityMeta: function (ticket = {}, sourceMeta = {}, timingMeta = {}, refundMeta = {}) {
        const normalizedIssueType = this.safeText(ticket?.issue_type).trim().toUpperCase();
        const reasons = [];
        let score = 0;

        if (timingMeta.is_overdue === true) {
            reasons.push('超时待处理');
            score += 4;
        }

        if (refundMeta.can_refund === true) {
            reasons.push('可直接退款');
            score += 2;
        }

        if (this.safeText(sourceMeta?.sourceType || sourceMeta?.source_type).trim() === 'ops_alert') {
            reasons.push('站内代办');
            score += 1;
        }

        if (['REFUND', 'PAYMENT', 'ACCOUNT', 'VERIFICATION'].includes(normalizedIssueType)) {
            reasons.push('敏感售后');
            score += 1;
        }

        const isHighPriority = score >= 3;
        return {
            priority_score: score,
            priority_level: isHighPriority ? 'high' : 'normal',
            priority_label: isHighPriority ? '高优先' : '常规',
            priority_summary: reasons.slice(0, 2).join(' · ') || '常规跟进',
            is_high_priority: isHighPriority
        };
    },

    matchesDerivedTicketFilters: function (ticket = {}, filters = {}) {
        const overdueOnly = this.normalizeBooleanFlag(filters.overdueOnly ?? this.quickFilters.overdueOnly);
        const priority = this.normalizePriorityFilter(filters.priority ?? this.quickFilters.priority);
        const assignee = this.normalizeAssigneeFilter(filters.assignee ?? this.quickFilters.assignee);

        if (overdueOnly && ticket?.is_overdue !== true) {
            return false;
        }

        if (priority === 'high' && ticket?.is_high_priority !== true) {
            return false;
        }

        if (assignee === 'mine') {
            const currentUserId = this.safeText(window.__adminUserId || '').trim();
            const currentUserEmail = this.safeText(window.__adminUserEmail || '').trim().toLowerCase();
            const assignedToId = this.safeText(ticket?.assigned_to_id).trim();
            const assignedToLabel = this.safeText(ticket?.assigned_to_label).trim().toLowerCase();
            return Boolean(
                (currentUserId && assignedToId === currentUserId)
                || (currentUserEmail && assignedToLabel === currentUserEmail)
            );
        }

        if (assignee === 'unassigned') {
            return !this.safeText(ticket?.assigned_to_id).trim() && !this.safeText(ticket?.assigned_to_label).trim();
        }

        return true;
    },

    enrichClientSideTicketRows: async function (rows = []) {
        const rawRows = Array.isArray(rows) ? rows : [];
        const [profilesById, ordersById] = await Promise.all([
            this.fetchProfilesByIds(rawRows.map((ticket) => ticket?.user_id)),
            this.fetchOrdersByIds(rawRows.map((ticket) => ticket?.order_id))
        ]);

        return rawRows.map((ticket) => {
            const userId = this.safeText(ticket?.user_id).trim();
            const orderId = this.safeText(ticket?.order_id).trim();
            const status = this.normalizeTicketStatusValue(ticket?.status);
            const sourceMeta = this.getTicketSourceMeta(ticket);
            const timingMeta = this.buildClientSideTicketTimingMeta(ticket, 120);
            const refundMeta = this.buildClientSideRefundMeta(ticket, ordersById[orderId] || null);
            const priorityMeta = this.buildTicketPriorityMeta(ticket, sourceMeta, timingMeta, refundMeta);

            return {
                ...ticket,
                status,
                status_label: this.getTicketStatusLabel(status),
                issue_type_label: this.getIssueTypeLabel(ticket?.issue_type),
                user_email: this.safeText(profilesById[userId]?.email),
                source_type: sourceMeta.sourceType,
                source_label: sourceMeta.sourceLabel,
                ...timingMeta,
                ...refundMeta,
                ...priorityMeta,
                assigned_to_id: '',
                assigned_to_label: '',
                assigned_at: '',
                assigned_by: '',
                assignment_summary: '负责人：未指派'
            };
        });
    },

    matchesTicketSearchQuery: function (ticket = {}, query = '') {
        const normalizedQuery = this.safeText(query).trim().toLowerCase();
        if (!normalizedQuery) {
            return true;
        }

        const haystack = [
            ticket?.id,
            ticket?.order_id,
            ticket?.user_id,
            ticket?.user_email,
            ticket?.issue_type,
            ticket?.issue_type_label,
            ticket?.reason,
            ticket?.description,
            ticket?.admin_notes,
            ticket?.source_label,
            ticket?.priority_label,
            ticket?.assigned_to_label,
            ticket?.assignment_summary
        ]
            .map((value) => this.safeText(value).toLowerCase())
            .filter(Boolean)
            .join('\n');

        return haystack.includes(normalizedQuery);
    },

    buildClientSidePagination: function (totalItems = 0, page = 1) {
        const normalizedTotalItems = Math.max(0, Number.parseInt(totalItems, 10) || 0);
        const totalPages = Math.max(1, Math.ceil(normalizedTotalItems / this.pageSize) || 1);
        const currentPage = this.normalizePageNumber(page, totalPages);
        const start = (currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;

        return {
            page: currentPage,
            pageSize: this.pageSize,
            totalItems: normalizedTotalItems,
            totalPages,
            hasPrevPage: currentPage > 1,
            hasNextPage: currentPage < totalPages,
            returnedItems: Math.max(0, Math.min(normalizedTotalItems, end) - start),
            start,
            end
        };
    },

    isMissingClientSideRelationError: function (error, relationName = '') {
        const normalizedMessage = this.safeText(error?.message).trim().toLowerCase();
        const normalizedRelation = this.safeText(relationName).trim().toLowerCase();

        if (!normalizedMessage) {
            return false;
        }

        const mentionsRelation = normalizedRelation
            ? normalizedMessage.includes(normalizedRelation)
            : normalizedMessage.includes('relation') || normalizedMessage.includes('table');

        return mentionsRelation && (
            normalizedMessage.includes('does not exist')
            || normalizedMessage.includes('not exist')
            || normalizedMessage.includes('could not find')
            || normalizedMessage.includes('undefined table')
        );
    },

    loadClientSideAuditRows: async function () {
        const candidates = [{
            table: 'admin_audit_logs_view',
            selection: 'id, action_type, details, created_at, admin_id, admin_email'
        }, {
            table: 'admin_audit_logs',
            selection: 'id, action_type, details, created_at, admin_id'
        }];

        let lastError = null;
        for (const candidate of candidates) {
            try {
                const { data, error } = await window.supabaseClient
                    .from(candidate.table)
                    .select(candidate.selection)
                    .order('created_at', { ascending: false });

                if (error) {
                    throw error;
                }

                return Array.isArray(data) ? data : [];
            } catch (error) {
                if (this.isMissingClientSideRelationError(error, candidate.table)) {
                    lastError = error;
                    continue;
                }
                throw error;
            }
        }

        if (lastError) {
            throw lastError;
        }

        return [];
    },

    buildClientSideAssignmentMap: function (ticketIds = [], auditRows = []) {
        const normalizedTicketIds = new Set(
            (Array.isArray(ticketIds) ? ticketIds : [])
                .map((ticketId) => this.safeText(ticketId).trim())
                .filter(Boolean)
        );
        const assignmentByTicketId = new Map();

        (Array.isArray(auditRows) ? auditRows : []).forEach((row) => {
            const normalizedActionType = this.safeText(row?.action_type).trim().toLowerCase();
            if (normalizedActionType !== 'ticket.assign') {
                return;
            }

            const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
                ? row.details
                : {};
            const ticketId = this.safeText(details.ticket_id).trim();
            if (!ticketId || !normalizedTicketIds.has(ticketId) || assignmentByTicketId.has(ticketId)) {
                return;
            }

            const assigneeId = this.safeText(details.assignee_id).trim();
            const assigneeLabel = this.safeText(details.assignee_label).trim();
            const assigned = details.assigned !== false && Boolean(assigneeId || assigneeLabel);
            assignmentByTicketId.set(ticketId, {
                assigned_to_id: assigned ? assigneeId : '',
                assigned_to_label: assigned ? assigneeLabel : '',
                assignment_summary: assigned
                    ? `负责人：${assigneeLabel || assigneeId}`
                    : '负责人：未指派'
            });
        });

        return assignmentByTicketId;
    },

    averageClientSideNumbers: function (values = []) {
        const numbers = (Array.isArray(values) ? values : [])
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 0);

        if (!numbers.length) {
            return null;
        }

        return Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
    },

    buildClientSideBreakdownItems: function (items = []) {
        const normalizedItems = Array.isArray(items) ? items : [];
        const total = normalizedItems.reduce((sum, item) => sum + Math.max(0, Number(item?.count || 0)), 0);

        return normalizedItems
            .map((item) => {
                const count = Math.max(0, Number(item?.count || 0));
                return {
                    key: this.safeText(item?.key, 'other').trim() || 'other',
                    label: this.safeText(item?.label, '其他').trim() || '其他',
                    count,
                    share_percent: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0
                };
            })
            .sort((left, right) => {
                if (left.count !== right.count) {
                    return right.count - left.count;
                }
                return left.label.localeCompare(right.label, 'zh-CN');
            });
    },

    buildClientSidePendingOverview: function (pendingRows = [], context = {}) {
        const assignmentByTicketId = context.assignmentByTicketId instanceof Map
            ? context.assignmentByTicketId
            : new Map();
        const reminderConfig = context.reminder && typeof context.reminder === 'object'
            ? context.reminder
            : this.buildClientSideReminderOverview();
        const criticalOverdueMinutes = Math.max(30, Math.round(Number(reminderConfig.critical_overdue_minutes || (12 * 60)) || (12 * 60)));
        const sourceCounts = new Map();
        const issueTypeCounts = new Map();
        let assignedCount = 0;
        let unassignedCount = 0;
        let overdueCount = 0;
        let criticalOverdueCount = 0;
        let highPriorityCount = 0;
        let refundableCount = 0;
        let oldestWaitMinutes = 0;

        (Array.isArray(pendingRows) ? pendingRows : []).forEach((ticket) => {
            const ticketId = this.safeText(ticket?.id).trim();
            const sourceMeta = this.getTicketSourceMeta(ticket);
            const sourceType = this.safeText(sourceMeta?.sourceType, 'user_ticket').trim() || 'user_ticket';
            const sourceLabel = this.safeText(sourceMeta?.sourceLabel, '用户提交').trim() || '用户提交';
            const issueTypeKey = this.safeText(ticket?.issue_type, 'OTHER').trim().toUpperCase() || 'OTHER';
            const issueTypeLabel = this.safeText(ticket?.issue_type_label).trim() || this.getIssueTypeLabel(issueTypeKey);
            const waitMinutes = Math.max(0, Math.round(Number(ticket?.ticket_age_minutes || 0) || 0));
            const assignmentMeta = assignmentByTicketId.get(ticketId) || {
                assigned_to_id: this.safeText(ticket?.assigned_to_id).trim(),
                assigned_to_label: this.safeText(ticket?.assigned_to_label).trim()
            };
            const assigned = Boolean(
                this.safeText(assignmentMeta?.assigned_to_id).trim()
                || this.safeText(assignmentMeta?.assigned_to_label).trim()
            );

            sourceCounts.set(sourceType, {
                key: sourceType,
                label: sourceLabel,
                count: Number(sourceCounts.get(sourceType)?.count || 0) + 1
            });
            issueTypeCounts.set(issueTypeKey, {
                key: issueTypeKey,
                label: issueTypeLabel,
                count: Number(issueTypeCounts.get(issueTypeKey)?.count || 0) + 1
            });

            if (assigned) {
                assignedCount += 1;
            } else {
                unassignedCount += 1;
            }
            if (ticket?.is_overdue === true) {
                overdueCount += 1;
            }
            if (ticket?.is_overdue === true && waitMinutes >= criticalOverdueMinutes) {
                criticalOverdueCount += 1;
            }
            if (ticket?.is_high_priority === true) {
                highPriorityCount += 1;
            }
            if (ticket?.can_refund === true) {
                refundableCount += 1;
            }
            oldestWaitMinutes = Math.max(oldestWaitMinutes, waitMinutes);
        });

        return {
            backlog: {
                total_pending: Array.isArray(pendingRows) ? pendingRows.length : 0,
                assigned_count: assignedCount,
                unassigned_count: unassignedCount,
                overdue_count: overdueCount,
                critical_overdue_count: criticalOverdueCount,
                high_priority_count: highPriorityCount,
                refundable_count: refundableCount,
                oldest_wait_minutes: oldestWaitMinutes
            },
            sources: this.buildClientSideBreakdownItems(Array.from(sourceCounts.values())),
            issue_types: this.buildClientSideBreakdownItems(Array.from(issueTypeCounts.values()))
        };
    },

    buildClientSideEfficiencyOverview: function (closedRows = [], auditRows = []) {
        const closedTickets = Array.isArray(closedRows) ? closedRows : [];
        const ticketIds = new Set(closedTickets.map((ticket) => this.safeText(ticket?.id).trim()).filter(Boolean));
        const firstTouchByTicketId = new Map();
        const firstProcessByTicketId = new Map();
        const refundRelatedByTicketId = new Set();
        const processStatusByTicketId = new Map();

        (Array.isArray(auditRows) ? auditRows : []).forEach((row) => {
            const details = row?.details && typeof row.details === 'object' && !Array.isArray(row.details)
                ? row.details
                : {};
            const ticketId = this.safeText(details.ticket_id).trim();
            if (!ticketId || !ticketIds.has(ticketId)) {
                return;
            }

            const actionType = this.safeText(row?.action_type).trim().toLowerCase();
            const createdAtMs = Date.parse(this.safeText(row?.created_at).trim());
            if (Number.isFinite(createdAtMs)) {
                const existingFirstTouch = firstTouchByTicketId.get(ticketId);
                if (!existingFirstTouch || createdAtMs < existingFirstTouch.timeMs) {
                    firstTouchByTicketId.set(ticketId, { timeMs: createdAtMs });
                }
            }

            if (actionType !== 'ticket.process') {
                return;
            }

            const existingProcess = firstProcessByTicketId.get(ticketId);
            if (Number.isFinite(createdAtMs) && (!existingProcess || createdAtMs < existingProcess.timeMs)) {
                firstProcessByTicketId.set(ticketId, { timeMs: createdAtMs });
            }

            processStatusByTicketId.set(ticketId, this.normalizeTicketStatusValue(details.new_status));
            const refundOutcome = this.safeText(details.refund_outcome).trim().toLowerCase();
            if (
                details.refunded === true
                || details.refund_duplicate === true
                || (refundOutcome && refundOutcome !== 'not_requested')
            ) {
                refundRelatedByTicketId.add(ticketId);
            }
        });

        let resolvedCount = 0;
        let rejectedCount = 0;
        let refundRelatedCount = 0;
        const resolutionMinutes = [];
        const firstTouchMinutes = [];

        closedTickets.forEach((ticket) => {
            const ticketId = this.safeText(ticket?.id).trim();
            const createdAtMs = Date.parse(this.safeText(ticket?.created_at).trim());
            const normalizedStatus = processStatusByTicketId.get(ticketId) || this.normalizeTicketStatusValue(ticket?.status);

            if (normalizedStatus === 'RESOLVED') {
                resolvedCount += 1;
            } else if (normalizedStatus === 'REJECTED') {
                rejectedCount += 1;
            }

            if (
                refundRelatedByTicketId.has(ticketId)
                || (!processStatusByTicketId.has(ticketId) && this.safeText(ticket?.issue_type).trim().toUpperCase() === 'REFUND')
            ) {
                refundRelatedCount += 1;
            }

            const resolutionTimeMs = firstProcessByTicketId.get(ticketId)?.timeMs
                || Date.parse(this.safeText(ticket?.updated_at).trim());
            if (Number.isFinite(createdAtMs) && Number.isFinite(resolutionTimeMs) && resolutionTimeMs >= createdAtMs) {
                resolutionMinutes.push(Math.round((resolutionTimeMs - createdAtMs) / 60000));
            }

            const firstTouchTimeMs = firstTouchByTicketId.get(ticketId)?.timeMs;
            if (Number.isFinite(createdAtMs) && Number.isFinite(firstTouchTimeMs) && firstTouchTimeMs >= createdAtMs) {
                firstTouchMinutes.push(Math.round((firstTouchTimeMs - createdAtMs) / 60000));
            }
        });

        const closedCount = closedTickets.length;
        return {
            lookback_days: 30,
            closed_count: closedCount,
            resolved_count: resolvedCount,
            rejected_count: rejectedCount,
            refund_related_count: refundRelatedCount,
            resolved_rate_percent: closedCount > 0 ? Number(((resolvedCount / closedCount) * 100).toFixed(1)) : 0,
            rejected_rate_percent: closedCount > 0 ? Number(((rejectedCount / closedCount) * 100).toFixed(1)) : 0,
            refund_related_rate_percent: closedCount > 0 ? Number(((refundRelatedCount / closedCount) * 100).toFixed(1)) : 0,
            avg_first_touch_minutes: this.averageClientSideNumbers(firstTouchMinutes),
            first_touch_sample_count: firstTouchMinutes.length,
            avg_resolution_minutes: this.averageClientSideNumbers(resolutionMinutes),
            resolution_sample_count: resolutionMinutes.length
        };
    },

    loadOverviewViaSupabaseFallback: async function (options = {}) {
        const requestId = Number(options?.requestId || 0);
        const reminderConfig = this.buildClientSideReminderOverview();
        const nowDate = new Date();
        const closedSinceMs = nowDate.getTime() - (30 * 24 * 60 * 60 * 1000);
        const { data, error } = await window.supabaseClient
            .from('shop_tickets')
            .select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at')
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        const enrichedRows = await this.enrichClientSideTicketRows(data || []);
        const reminderTelemetryPromise = this.loadClientSideReminderActivityAndSummary(reminderConfig?.activity?.lookback_days || 7)
            .catch((reminderError) => {
                console.warn('[AdminTickets] client-side reminder telemetry load skipped:', reminderError);
                return {
                    activity: reminderConfig.activity,
                    summary_digest: reminderConfig.summary_digest
                };
            });
        let auditRows = [];
        try {
            auditRows = await this.loadClientSideAuditRows();
        } catch (auditError) {
            console.warn('[AdminTickets] client-side audit load skipped:', auditError);
        }
        const reminderTelemetry = await reminderTelemetryPromise;
        const reminder = {
            ...reminderConfig,
            activity: reminderTelemetry?.activity || reminderConfig.activity,
            summary_digest: reminderTelemetry?.summary_digest || reminderConfig.summary_digest
        };

        const assignmentByTicketId = this.buildClientSideAssignmentMap(
            enrichedRows.map((ticket) => ticket?.id),
            auditRows
        );
        const rowsWithAssignments = enrichedRows.map((ticket) => {
            const ticketId = this.safeText(ticket?.id).trim();
            const assignmentMeta = assignmentByTicketId.get(ticketId);
            if (!assignmentMeta) {
                return ticket;
            }
            return {
                ...ticket,
                ...assignmentMeta,
                assignment_summary: this.safeText(assignmentMeta.assignment_summary, '负责人：未指派')
            };
        });
        const pendingRows = rowsWithAssignments.filter((ticket) => this.normalizeTicketStatusValue(ticket?.status) === 'PENDING');
        const closedRows = rowsWithAssignments.filter((ticket) => {
            const status = this.normalizeTicketStatusValue(ticket?.status);
            const updatedAtMs = Date.parse(this.safeText(ticket?.updated_at).trim());
            return (status === 'RESOLVED' || status === 'REJECTED')
                && Number.isFinite(updatedAtMs)
                && updatedAtMs >= closedSinceMs;
        });
        const pendingOverview = this.buildClientSidePendingOverview(pendingRows, {
            assignmentByTicketId,
            reminder
        });

        if (requestId && requestId !== this._overviewRequestId) {
            return;
        }

        this.overview = {
            generated_at: nowDate.toISOString(),
            backlog: pendingOverview.backlog,
            efficiency: this.buildClientSideEfficiencyOverview(closedRows, auditRows),
            sources: pendingOverview.sources,
            issue_types: pendingOverview.issue_types,
            reminder
        };
        this.overviewErrorMessage = '';
        this._overviewLoadedAt = Date.now();
        this.renderOverview();
    },

    shouldUseClientSideOverviewFallback: function (error) {
        const statusCode = Number(error?.statusCode || error?.response?.status || 0);
        const message = this.safeText(error?.message).trim();

        if (statusCode === 404) {
            return true;
        }

        return /admin route not found/i.test(message)
            || /cannot get \/api\/admin/i.test(message)
            || /tickets\/metrics/i.test(message);
    },

    shouldUseClientSideListFallback: function (error) {
        const statusCode = Number(error?.statusCode || error?.response?.status || 0);
        const message = this.safeText(error?.message).trim();

        if (statusCode === 404) {
            return true;
        }

        return /admin route not found/i.test(message)
            || /cannot get \/api\/admin\/tickets\/list/i.test(message);
    },

    loadTicketsViaSupabaseFallback: async function (options = {}) {
        const targetStatus = this.normalizeStatusFilter(options.status ?? this.currentStatus);
        const targetSearchQuery = this.safeText(options.searchQuery ?? this.searchQuery).trim();
        const requestedPage = Math.max(1, Number.parseInt(options.page ?? this.currentPage, 10) || 1);
        const targetOverdueOnly = this.normalizeBooleanFlag(options.overdueOnly ?? this.quickFilters.overdueOnly);
        const targetPriority = this.normalizePriorityFilter(options.priority ?? this.quickFilters.priority);
        const targetAssignee = this.normalizeAssigneeFilter(options.assignee ?? this.quickFilters.assignee);

        let query = window.supabaseClient
            .from('shop_tickets')
            .select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at')
            .order('created_at', { ascending: false });

        if (targetStatus === 'pending') {
            query = query.in('status', ['PENDING', 'OPEN']);
        } else if (targetStatus === 'resolved') {
            query = query.eq('status', 'RESOLVED');
        } else if (targetStatus === 'rejected') {
            query = query.eq('status', 'REJECTED');
        }

        const { data, error } = await query;
        if (error) {
            throw error;
        }

        const enrichedRows = await this.enrichClientSideTicketRows(data || []);
        const filteredRows = enrichedRows
            .filter((ticket) => this.matchesTicketSearchQuery(ticket, targetSearchQuery))
            .filter((ticket) => this.matchesDerivedTicketFilters(ticket, {
                overdueOnly: targetOverdueOnly,
                priority: targetPriority,
                assignee: targetAssignee
            }));
        const pagination = this.buildClientSidePagination(filteredRows.length, requestedPage);
        const currentRows = filteredRows.slice(pagination.start, pagination.end);

        this.tickets = currentRows;
        this.filteredTickets = currentRows;
        this.updatePaginationState(pagination);
        this.pruneSelectedTickets(currentRows);
        this.render();
        this._listLoadedAt = Date.now();
    },

    loadTickets: async function (options = {}) {
        const requestId = (this._loadRequestId || 0) + 1;
        this._loadRequestId = requestId;

        const targetStatus = this.normalizeStatusFilter(options.status ?? this.currentStatus);
        const targetSearchQuery = this.safeText(options.searchQuery ?? this.searchQuery).trim();
        const targetPage = Math.max(1, Number.parseInt(options.page ?? this.currentPage, 10) || 1);
        const targetOverdueOnly = this.normalizeBooleanFlag(options.overdueOnly ?? this.quickFilters.overdueOnly);
        const targetPriority = this.normalizePriorityFilter(options.priority ?? this.quickFilters.priority);
        const targetAssignee = this.normalizeAssigneeFilter(options.assignee ?? this.quickFilters.assignee);

        this.currentStatus = targetStatus;
        this.quickFilters = {
            overdueOnly: targetOverdueOnly,
            priority: targetPriority,
            assignee: targetAssignee
        };
        this.searchQuery = targetSearchQuery;
        this.currentPage = targetPage;
        this.syncSearchInput();
        this.syncFilterButtons();

        try {
            const tbody = document.getElementById('ticketsTableBody');
            if (tbody && options.showSkeleton !== false) {
                tbody.innerHTML = this.buildTableLoadingSkeleton();
            }

            const authState = await this.waitForAuthReady(Number(options?.authTimeoutMs || 2400));
            this.updateCurrentAdminIdentity(authState?.user || null);

            if (this._forceClientSideListFallback === true) {
                await this.loadTicketsViaSupabaseFallback({
                    page: targetPage,
                    status: targetStatus,
                    searchQuery: targetSearchQuery,
                    overdueOnly: targetOverdueOnly,
                    priority: targetPriority,
                    assignee: targetAssignee
                });
                return;
            }

            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.getTicketsListUrl({
                page: targetPage,
                status: targetStatus,
                searchQuery: targetSearchQuery,
                overdueOnly: targetOverdueOnly,
                priority: targetPriority,
                assignee: targetAssignee
            }), {
                method: 'GET',
                headers
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                const requestError = new Error(result.message || '工单列表加载失败');
                requestError.statusCode = Number(response.status || 0);
                requestError.responsePayload = result;
                throw requestError;
            }

            if (requestId !== this._loadRequestId) {
                return;
            }

            this.applyTicketReplyTemplateConfig(result.templateConfig || null);
            const rows = Array.isArray(result.rows) ? result.rows : [];
            this.tickets = rows;
            this.filteredTickets = rows;
            this.updatePaginationState(result.pagination || {
                page: targetPage,
                pageSize: this.pageSize,
                totalItems: rows.length,
                totalPages: Math.max(1, Math.ceil(rows.length / this.pageSize)),
                returnedItems: rows.length
            });
            this.pruneSelectedTickets(rows);
            this.render();
            this._listLoadedAt = Date.now();
        } catch (err) {
            if (requestId !== this._loadRequestId) {
                return;
            }

            if (this.shouldUseClientSideListFallback(err)) {
                try {
                    this._forceClientSideListFallback = true;
                    await this.loadTicketsViaSupabaseFallback({
                        page: targetPage,
                        status: targetStatus,
                        searchQuery: targetSearchQuery,
                        overdueOnly: targetOverdueOnly,
                        priority: targetPriority,
                        assignee: targetAssignee
                    });
                    return;
                } catch (fallbackError) {
                    console.error('[AdminTickets] fallback load error:', fallbackError);
                    err = fallbackError;
                }
            }

            console.error('[AdminTickets] load error:', err);
            this.tickets = [];
            this.filteredTickets = [];
            this.updatePaginationState({
                page: 1,
                pageSize: this.pageSize,
                totalItems: 0,
                totalPages: 1,
                returnedItems: 0
            });
            this.pruneSelectedTickets([]);
            const tbody = document.getElementById('ticketsTableBody');
            if (tbody) {
                tbody.replaceChildren(this.createTableStateRow({
                    message: `加载失败: ${this.safeText(err?.message, '未知错误')}`,
                    icon: 'fa-circle-exclamation',
                    variant: 'error'
                }));
            }
            this.renderPagination(1);
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

    applyFilters: function (options = {}) {
        const page = options.resetPage === false ? this.currentPage : 1;
        return this.loadTickets({
            page,
            status: this.currentStatus,
            searchQuery: this.searchQuery
        });
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

    normalizePriorityFilter: function (value) {
        const normalized = this.safeText(value, 'all').trim().toLowerCase();
        return normalized === 'high' ? 'high' : 'all';
    },

    normalizeAssigneeFilter: function (value) {
        const normalized = this.safeText(value, 'all').trim().toLowerCase();
        if (normalized === 'mine' || normalized === 'unassigned') {
            return normalized;
        }
        return 'all';
    },

    normalizeTicketReplyTemplateAction: function (value, fallback = 'resolved') {
        const normalized = this.safeText(value, fallback).trim().toLowerCase();
        return normalized === 'rejected' ? 'rejected' : 'resolved';
    },

    normalizeTicketReplyTemplateIssueType: function (value, fallback = 'all') {
        const normalized = this.safeText(value, fallback).trim().toLowerCase();
        return ['all', 'refund', 'delivery', 'account', 'verification', 'payment', 'other'].includes(normalized)
            ? normalized
            : fallback;
    },

    normalizeTicketReplyTemplateDefinitions: function (templates) {
        if (!Array.isArray(templates)) {
            return [];
        }

        return templates.reduce((accumulator, item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return accumulator;
            }

            const body = this.safeText(item.body || item.text).trim();
            if (!body) {
                return accumulator;
            }

            accumulator.push({
                id: this.safeText(item.id || item.key, `ticket_template_${index + 1}`).trim() || `ticket_template_${index + 1}`,
                action: this.normalizeTicketReplyTemplateAction(item.action),
                issue_type: this.normalizeTicketReplyTemplateIssueType(item.issue_type || item.issueType, 'all'),
                enabled: item.enabled !== false,
                title: this.safeText(item.title, '快捷模板').trim() || '快捷模板',
                tag: this.safeText(item.tag, '模板').trim() || '模板',
                body
            });
            return accumulator;
        }, []).slice(0, 20);
    },

    applyTicketReplyTemplateConfig: function (templateConfig = null) {
        const nextTemplates = this.normalizeTicketReplyTemplateDefinitions(templateConfig?.reply_templates);
        this.ticketReplyTemplateConfigTemplates = nextTemplates;
        this._ticketReplyTemplateConfigLoaded = Array.isArray(templateConfig?.reply_templates);
        return nextTemplates;
    },

    handleOpsAlertsConfigUpdated: function (event = {}) {
        const config = event?.detail?.config && typeof event.detail.config === 'object'
            ? event.detail.config
            : null;
        this.applyOpsAlertsConfigSnapshot(config);
        this.applyTicketReplyTemplateConfig({
            reply_templates: config?.tickets?.reply_templates
        });
        if (this._forceClientSideOverviewFallback === true && this.overview) {
            const currentReminderActivity = this.overview?.reminder?.activity && typeof this.overview.reminder.activity === 'object'
                ? this.overview.reminder.activity
                : this.buildEmptyReminderActivityOverview();
            const currentReminderSummaryDigest = this.overview?.reminder?.summary_digest && typeof this.overview.reminder.summary_digest === 'object'
                ? this.overview.reminder.summary_digest
                : this.buildEmptyReminderSummaryDigest();
            this.overview = {
                ...this.overview,
                reminder: {
                    ...this.buildClientSideReminderOverview(),
                    activity: currentReminderActivity,
                    summary_digest: currentReminderSummaryDigest
                },
                generated_at: new Date().toISOString()
            };
            this.renderOverview();
        }
    },

    getConfiguredTicketReplyTemplates: function () {
        if (this._ticketReplyTemplateConfigLoaded !== true) {
            return null;
        }
        return Array.isArray(this.ticketReplyTemplateConfigTemplates)
            ? this.ticketReplyTemplateConfigTemplates
            : [];
    },

    normalizeBooleanFlag: function (value) {
        if (value === true || value === false) {
            return value;
        }

        const normalized = this.safeText(value).trim().toLowerCase();
        return ['1', 'true', 'yes', 'on'].includes(normalized);
    },

    syncFilterButtons: function () {
        const buttons = document.querySelectorAll('#module-tickets .filter-btn');
        if (!buttons.length) {
            return;
        }
        buttons.forEach((button) => {
            button.classList.toggle('active', button.dataset.ticketStatus === this.currentStatus);
        });
        this.syncQuickFilterButtons();
    },

    syncQuickFilterButtons: function () {
        const overdueButton = document.getElementById('ticketOverdueFilterBtn');
        const priorityButton = document.getElementById('ticketPriorityFilterBtn');
        const mineButton = document.getElementById('ticketMineFilterBtn');
        const unassignedButton = document.getElementById('ticketUnassignedFilterBtn');

        if (overdueButton) {
            overdueButton.classList.toggle('active', this.quickFilters.overdueOnly === true);
        }

        if (priorityButton) {
            priorityButton.classList.toggle('active', this.quickFilters.priority === 'high');
        }

        if (mineButton) {
            mineButton.classList.toggle('active', this.quickFilters.assignee === 'mine');
        }

        if (unassignedButton) {
            unassignedButton.classList.toggle('active', this.quickFilters.assignee === 'unassigned');
        }
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

    search: function (options = {}) {
        const input = document.getElementById('ticketSearchInput');
        this.searchQuery = input ? input.value.trim() : this.searchQuery;
        this.currentPage = 1;

        this.cancelPendingSearch();

        if (options.immediate === true) {
            return this.applyFilters();
        }

        this._searchDebounceTimer = window.setTimeout(() => {
            this.applyFilters();
        }, this.searchDebounceMs);
        return null;
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
        this.quickFilters = {
            overdueOnly: false,
            priority: 'all',
            assignee: 'all'
        };
        this.setWorkspaceView('queue', {
            scroll: false,
            highlight: false
        });
        this.searchQuery = normalizedTicketId;
        this.syncSearchInput();
        this.syncFilterButtons();
        await this.loadTickets({
            page: 1,
            status: targetStatus,
            searchQuery: normalizedTicketId,
            overdueOnly: false,
            priority: 'all',
            assignee: 'all'
        });

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

    normalizeSelectedTicketIds: function (ticketIds = []) {
        return Array.from(new Set(
            (Array.isArray(ticketIds) ? ticketIds : [])
                .map((ticketId) => this.safeText(ticketId).trim())
                .filter(Boolean)
        ));
    },

    isTicketSelectable: function (ticket = {}) {
        return this.normalizeTicketStatusValue(ticket?.status) === 'PENDING';
    },

    isTicketSelected: function (ticketId = '') {
        const normalizedTicketId = this.safeText(ticketId).trim();
        return this.normalizeSelectedTicketIds(this.selectedTicketIds).includes(normalizedTicketId);
    },

    getSelectableCurrentPageTicketIds: function () {
        return this.normalizeSelectedTicketIds(
            (Array.isArray(this.filteredTickets) ? this.filteredTickets : [])
                .filter((ticket) => this.isTicketSelectable(ticket))
                .map((ticket) => ticket?.id)
        );
    },

    pruneSelectedTickets: function (visibleTickets = []) {
        const visibleTicketIds = this.normalizeSelectedTicketIds((Array.isArray(visibleTickets) ? visibleTickets : []).map((ticket) => ticket?.id));
        this.selectedTicketIds = this.normalizeSelectedTicketIds(this.selectedTicketIds)
            .filter((ticketId) => visibleTicketIds.includes(ticketId));
        this.syncSelectionControls();
    },

    toggleTicketSelection: function (ticketId, nextChecked) {
        const normalizedTicketId = this.safeText(ticketId).trim();
        if (!normalizedTicketId) {
            return;
        }

        const nextSelectedIds = new Set(this.normalizeSelectedTicketIds(this.selectedTicketIds));
        const shouldSelect = typeof nextChecked === 'boolean'
            ? nextChecked
            : !nextSelectedIds.has(normalizedTicketId);

        if (shouldSelect) {
            nextSelectedIds.add(normalizedTicketId);
        } else {
            nextSelectedIds.delete(normalizedTicketId);
        }

        this.selectedTicketIds = Array.from(nextSelectedIds);
        this.syncSelectionControls();
        this.render();
    },

    toggleSelectAllPage: function (nextChecked) {
        const selectableIds = this.getSelectableCurrentPageTicketIds();
        const nextSelectedIds = new Set(this.normalizeSelectedTicketIds(this.selectedTicketIds));
        const shouldSelect = typeof nextChecked === 'boolean'
            ? nextChecked
            : selectableIds.some((ticketId) => !nextSelectedIds.has(ticketId));

        selectableIds.forEach((ticketId) => {
            if (shouldSelect) {
                nextSelectedIds.add(ticketId);
            } else {
                nextSelectedIds.delete(ticketId);
            }
        });

        this.selectedTicketIds = Array.from(nextSelectedIds);
        this.syncSelectionControls();
        this.render();
    },

    clearSelectedTickets: function () {
        this.selectedTicketIds = [];
        this.syncSelectionControls();
        this.render();
    },

    syncSelectionControls: function () {
        const selectedIds = this.normalizeSelectedTicketIds(this.selectedTicketIds);
        const selectableIds = this.getSelectableCurrentPageTicketIds();
        const selectedOnPage = selectableIds.filter((ticketId) => selectedIds.includes(ticketId));
        const selectAllCheckbox = document.getElementById('ticketsSelectAllCheckbox');
        const bulkToolbar = document.getElementById('ticketsBulkToolbar');
        const countNode = document.getElementById('ticketsBulkCount');
        const assignButton = document.getElementById('ticketsBulkAssignSelfBtn');
        const clearButton = document.getElementById('ticketsBulkClearAssigneeBtn');
        const clearSelectionButton = document.getElementById('ticketsClearSelectionBtn');

        if (selectAllCheckbox) {
            selectAllCheckbox.disabled = selectableIds.length === 0;
            selectAllCheckbox.checked = selectableIds.length > 0 && selectedOnPage.length === selectableIds.length;
            selectAllCheckbox.indeterminate = selectedOnPage.length > 0 && selectedOnPage.length < selectableIds.length;
        }

        if (bulkToolbar) {
            bulkToolbar.classList.toggle('admin-ticket-bulk-toolbar--active', selectedIds.length > 0);
        }

        if (countNode) {
            countNode.textContent = selectedIds.length > 0
                ? `已选 ${selectedIds.length} 个待处理工单`
                : '可批量指派或批量处理当前页待处理工单';
        }

        const bulkResolveButton = document.getElementById('ticketsBulkResolveBtn');
        const bulkRejectButton = document.getElementById('ticketsBulkRejectBtn');

        [assignButton, clearButton, clearSelectionButton, bulkResolveButton, bulkRejectButton].forEach((button) => {
            if (button) {
                button.disabled = selectedIds.length === 0;
            }
        });
    },

    notify: function (message, type = 'info') {
        const text = this.safeText(message);
        if (typeof window.showToast === 'function') {
            window.showToast(text, type);
            return;
        }

        const alertFn = window.alert || globalThis.alert;
        if (typeof alertFn === 'function') {
            alertFn(text);
        }
    },

    requestConfirmation: function (message) {
        const confirmFn = window.confirm || globalThis.confirm;
        if (typeof confirmFn !== 'function') {
            return true;
        }
        return confirmFn(this.safeText(message));
    },

    getTicketStatusLabel: function (status) {
        const normalizedStatus = this.normalizeTicketStatusValue(status);
        if (normalizedStatus === 'PENDING') return '待处理';
        if (normalizedStatus === 'RESOLVED') return '已解决';
        if (normalizedStatus === 'REJECTED') return '已拒绝';
        return normalizedStatus;
    },

    getIssueTypeLabel: function (issueType) {
        const normalizedIssueType = this.safeText(issueType, 'OTHER').trim().toUpperCase();
        const labelMap = {
            DELIVERY: '履约问题',
            VERIFICATION: '验证问题',
            REFUND: '退款问题',
            PAYMENT: '支付问题',
            ORDER: '订单问题',
            ACCOUNT: '账号问题',
            OTHER: '其他问题'
        };

        if (labelMap[normalizedIssueType]) {
            return labelMap[normalizedIssueType];
        }

        if (!normalizedIssueType) {
            return '其他问题';
        }

        return normalizedIssueType
            .toLowerCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    },

    getTicketSourceMeta: function (ticket = {}) {
        const sourceType = this.safeText(ticket?.source_type).trim().toLowerCase();
        const sourceLabel = this.safeText(ticket?.source_label).trim();
        if (sourceType || sourceLabel) {
            return {
                sourceType: sourceType || 'user_ticket',
                sourceLabel: sourceLabel || '用户提交'
            };
        }

        if (this.parseLinkedChatSessionContext(ticket?.description)) {
            return {
                sourceType: 'chat_session',
                sourceLabel: '客服会话'
            };
        }

        if (this.parseLinkedOpsAlertContext(ticket?.description)) {
            return {
                sourceType: 'ops_alert',
                sourceLabel: '站内代办'
            };
        }

        return {
            sourceType: 'user_ticket',
            sourceLabel: '用户提交'
        };
    },

    formatDateTime: function (value) {
        const text = this.safeText(value).trim();
        if (!text) {
            return '未知';
        }

        const date = new Date(text);
        if (!Number.isFinite(date.getTime())) {
            return text;
        }

        try {
            return date.toLocaleString('zh-CN', { hour12: false });
        } catch (_) {
            return date.toISOString();
        }
    },

    formatPoints: function (value) {
        const numericValue = Math.round(Number(value || 0));
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return '0 积分';
        }
        return `${numericValue} 积分`;
    },

    escapeHtml: function (value) {
        return this.safeText(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    normalizePageNumber: function (page, totalPages = 1) {
        const normalizedTotalPages = Math.max(1, Number.parseInt(totalPages, 10) || 1);
        const parsedPage = Number.parseInt(page, 10);
        if (!Number.isFinite(parsedPage)) {
            return 1;
        }
        return Math.min(Math.max(parsedPage, 1), normalizedTotalPages);
    },

    resolveLoadedTicketRecord: function (ticketId) {
        const normalizedTicketId = this.safeText(ticketId).trim();
        if (!normalizedTicketId) {
            return null;
        }

        return this.tickets.find((ticket) => this.safeText(ticket?.id).trim() === normalizedTicketId)
            || this.filteredTickets.find((ticket) => this.safeText(ticket?.id).trim() === normalizedTicketId)
            || null;
    },

    buildReplyModalState: function (ticket = {}, newStatus = '') {
        const normalizedNextStatus = this.normalizeTicketStatusValue(newStatus);
        const normalizedCurrentStatus = this.normalizeTicketStatusValue(ticket?.status);
        const hasOrder = Boolean(this.safeText(ticket?.order_id).trim());
        const orderRefundStatus = this.safeText(ticket?.order_refund_status).trim().toLowerCase();
        const alreadyRefunded = orderRefundStatus === 'refunded' || orderRefundStatus === 'full_refund';
        const canRefund = normalizedCurrentStatus === 'PENDING'
            && normalizedNextStatus === 'RESOLVED'
            && hasOrder
            && !alreadyRefunded
            && ticket?.can_refund !== false;

        let refundHint = '勾选后将自动退还该订单对应的积分给用户';
        if (normalizedCurrentStatus !== 'PENDING') {
            refundHint = `当前工单状态为${this.getTicketStatusLabel(normalizedCurrentStatus)}，不能重复处理。`;
        } else if (normalizedNextStatus !== 'RESOLVED') {
            refundHint = '只有将工单标记为已解决时才允许执行退款。';
        } else if (!hasOrder) {
            refundHint = '当前工单没有关联订单，无法执行退款。';
        } else if (alreadyRefunded) {
            refundHint = '关联订单已退款，无需重复退回积分。';
        }

        return {
            normalizedNextStatus,
            normalizedCurrentStatus,
            title: normalizedNextStatus === 'REJECTED' ? '拒绝工单' : '解决工单',
            submitLabel: normalizedNextStatus === 'REJECTED' ? '确认拒绝' : '确认处理',
            canRefund,
            refundHint
        };
    },

    buildDefaultReplyTemplates: function (ticket = {}, state = {}) {
        const normalizedNextStatus = this.normalizeTicketStatusValue(state?.normalizedNextStatus || state?.nextStatus || '');
        const issueType = this.safeText(ticket?.issue_type).trim().toUpperCase();
        const hasOrder = Boolean(this.safeText(ticket?.order_id).trim());
        const canRefund = state?.canRefund === true;

        if (normalizedNextStatus === 'REJECTED') {
            return [
                {
                    key: 'need_more_context',
                    title: '补充资料后再提交',
                    tag: '推荐',
                    body: '已收到你的反馈。当前信息还不足以完成处理，请补充订单号、异常截图、发生时间或操作步骤后重新提交，我们会继续跟进。'
                },
                {
                    key: 'duplicate_ticket',
                    title: '重复工单说明',
                    tag: '去重',
                    body: '已核查到相同问题已有工单在处理中，本工单先为你关闭。后续请以原工单为准，避免重复提交影响跟进效率。'
                },
                {
                    key: 'out_of_scope',
                    title: '不在售后范围',
                    tag: '说明',
                    body: '经核查，当前情况暂不属于售后直接处理范围，因此本工单先为你关闭。如你有新的订单信息或补充证据，可重新提交。'
                }
            ];
        }

        const templates = [{
            key: 'resolved_generic',
            title: '通用处理完成',
            tag: '推荐',
            body: '已收到你的反馈，当前问题已处理完成。如后续仍有异常，请直接回复本工单并补充具体情况，我们会继续协助你处理。'
        }];

        if (issueType === 'REFUND' || canRefund || hasOrder) {
            templates.unshift({
                key: 'resolved_refund',
                title: '退款处理通知',
                tag: canRefund ? '退款' : '订单',
                body: canRefund
                    ? '已核实本次情况，工单已处理完成，相关订单积分会按流程退回，请稍后留意账户变动。如仍未到账，请继续回复本工单。'
                    : '已核实本次情况，工单已处理完成。如涉及订单退款或补偿结果，请以系统到账记录为准；若仍有异常，请继续回复本工单。'
            });
        }

        if (issueType === 'DELIVERY') {
            templates.push({
                key: 'resolved_delivery',
                title: '履约跟进完成',
                tag: '履约',
                body: '已收到你的履约反馈，我们已经完成本次问题登记与处理。如后续仍未收到货物或状态没有更新，请继续回复本工单。'
            });
        } else if (issueType === 'ACCOUNT' || issueType === 'VERIFICATION') {
            templates.push({
                key: 'resolved_account',
                title: '账号核查完成',
                tag: '账号',
                body: '已核实你的账号/验证情况，当前问题已完成处理。如后续仍遇到同类异常，请补充截图或具体时间点，我们会继续排查。'
            });
        } else if (issueType === 'PAYMENT') {
            templates.push({
                key: 'resolved_payment',
                title: '支付问题处理',
                tag: '支付',
                body: '已收到你的支付反馈，当前问题已完成核查与处理。如后续仍有重复扣费、未到账或状态异常，请继续回复本工单。'
            });
        }

        return templates.slice(0, 3);
    },

    buildReplyTemplatePlaceholders: function (ticket = {}, state = {}) {
        const sourceMeta = this.getTicketSourceMeta(ticket);
        const normalizedNextStatus = this.normalizeTicketStatusValue(state?.normalizedNextStatus || state?.nextStatus || '');
        const refundSummary = state?.canRefund === true
            ? (this.safeText(ticket?.refund_summary).trim() || '如涉及退款，结果以系统到账记录为准')
            : (this.safeText(ticket?.refund_summary).trim() || '当前动作不涉及退款');
        return {
            ticket_id: this.safeText(ticket?.id).trim(),
            order_id: this.safeText(ticket?.order_id).trim(),
            issue_type_label: this.getIssueTypeLabel(ticket?.issue_type),
            source_label: this.safeText(sourceMeta?.sourceLabel).trim() || '用户提交',
            status_label: normalizedNextStatus === 'REJECTED' ? '已拒绝' : '已解决',
            refund_summary: refundSummary
        };
    },

    interpolateReplyTemplateValue: function (value = '', placeholders = {}) {
        return this.safeText(value).replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, rawKey) => {
            const key = this.safeText(rawKey).trim().toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(placeholders, key)) {
                return `{{${key}}}`;
            }
            return this.safeText(placeholders[key]).trim();
        }).replace(/\s{2,}/g, ' ').trim();
    },

    getTicketReplyTemplateMatchIssueTypes: function (ticket = {}, state = {}) {
        const issueTypes = new Set(['all']);
        const normalizedIssueType = this.safeText(ticket?.issue_type).trim().toUpperCase();
        const hasOrder = Boolean(this.safeText(ticket?.order_id).trim());
        const canRefund = state?.canRefund === true;

        if (normalizedIssueType === 'REFUND' || canRefund || hasOrder) {
            issueTypes.add('refund');
        }
        if (normalizedIssueType === 'DELIVERY') {
            issueTypes.add('delivery');
        }
        if (normalizedIssueType === 'ACCOUNT') {
            issueTypes.add('account');
        }
        if (normalizedIssueType === 'VERIFICATION') {
            issueTypes.add('verification');
        }
        if (normalizedIssueType === 'PAYMENT') {
            issueTypes.add('payment');
        }
        if (!['REFUND', 'DELIVERY', 'ACCOUNT', 'VERIFICATION', 'PAYMENT'].includes(normalizedIssueType)) {
            issueTypes.add('other');
        }

        return issueTypes;
    },

    buildConfiguredReplyTemplates: function (ticket = {}, state = {}) {
        const configuredTemplates = this.getConfiguredTicketReplyTemplates();
        if (configuredTemplates === null) {
            return null;
        }

        const action = this.normalizeTicketReplyTemplateAction(
            this.safeText(state?.normalizedNextStatus || state?.nextStatus).trim().toLowerCase() === 'rejected'
                ? 'rejected'
                : 'resolved'
        );
        const matchIssueTypes = this.getTicketReplyTemplateMatchIssueTypes(ticket, state);
        const placeholders = this.buildReplyTemplatePlaceholders(ticket, state);

        return configuredTemplates
            .filter((template) => template.enabled !== false && template.action === action)
            .filter((template) => matchIssueTypes.has(template.issue_type))
            .map((template, index) => ({
                ...template,
                _matchScore: template.issue_type === 'all' ? 1 : 2,
                _index: index,
                key: this.safeText(template.id, `ticket_template_${index + 1}`),
                title: this.interpolateReplyTemplateValue(template.title, placeholders) || '快捷模板',
                tag: this.interpolateReplyTemplateValue(template.tag, placeholders) || '模板',
                body: this.interpolateReplyTemplateValue(template.body, placeholders)
            }))
            .filter((template) => this.safeText(template.body).trim())
            .sort((left, right) => {
                if (left._matchScore !== right._matchScore) {
                    return right._matchScore - left._matchScore;
                }
                return left._index - right._index;
            })
            .map(({ _matchScore, _index, ...template }) => template)
            .slice(0, 3);
    },

    buildReplyTemplates: function (ticket = {}, state = {}) {
        const configuredTemplates = this.buildConfiguredReplyTemplates(ticket, state);
        if (configuredTemplates !== null) {
            return configuredTemplates;
        }
        return this.buildDefaultReplyTemplates(ticket, state);
    },

    buildReplyTimelineItems: function (ticket = {}, detailState = {}) {
        const sourceMeta = this.getTicketSourceMeta(ticket);
        const items = [];
        const createdAtLabel = this.formatDateTime(ticket?.created_at);
        const updatedAtLabel = this.formatDateTime(ticket?.updated_at);
        const currentStatus = this.normalizeTicketStatusValue(ticket?.status);
        const linkedChatContext = this.parseLinkedChatSessionContext(ticket?.description);
        const linkedOpsAlertContext = this.parseLinkedOpsAlertContext(ticket?.description);
        const waitLabel = this.safeText(ticket?.sla_label).trim() || this.safeText(detailState?.subtitle).trim();
        const adminNotes = this.safeText(ticket?.admin_notes).trim();

        items.push({
            title: '工单创建',
            time: createdAtLabel,
            detail: `来源：${sourceMeta.sourceLabel}${this.safeText(ticket?.order_id).trim() ? `\n关联订单：${this.safeText(ticket?.order_id).trim()}` : ''}`,
            icon: 'fa-file-circle-plus',
            tone: ''
        });

        if (linkedChatContext) {
            items.push({
                title: '客服会话转单',
                time: createdAtLabel,
                detail: [
                    linkedChatContext.title ? `会话标题：${linkedChatContext.title}` : '',
                    linkedChatContext.session_id ? `会话标识：${linkedChatContext.session_id}` : '',
                    linkedChatContext.user_email ? `来源邮箱：${linkedChatContext.user_email}` : ''
                ].filter(Boolean).join('\n'),
                icon: 'fa-comments',
                tone: ''
            });
        } else if (linkedOpsAlertContext) {
            items.push({
                title: '站内代办转单',
                time: createdAtLabel,
                detail: [
                    linkedOpsAlertContext.title ? `代办标题：${linkedOpsAlertContext.title}` : '',
                    linkedOpsAlertContext.alert_type ? `告警类型：${linkedOpsAlertContext.alert_type}` : '',
                    linkedOpsAlertContext.reference_label && linkedOpsAlertContext.reference_value
                        ? `${linkedOpsAlertContext.reference_label}：${linkedOpsAlertContext.reference_value}`
                        : ''
                ].filter(Boolean).join('\n'),
                icon: 'fa-sitemap',
                tone: ''
            });
        }

        if (currentStatus === 'PENDING') {
            items.push({
                title: ticket?.is_overdue ? '工单已超时待处理' : '工单等待处理中',
                time: updatedAtLabel !== '未知' ? updatedAtLabel : createdAtLabel,
                detail: [
                    waitLabel || '等待处理中',
                    this.safeText(ticket?.refund_summary).trim() || ''
                ].filter(Boolean).join('\n'),
                icon: 'fa-hourglass-half',
                tone: ticket?.is_overdue ? 'warning' : ''
            });
        } else {
            items.push({
                title: currentStatus === 'RESOLVED' ? '工单已解决' : '工单已关闭/拒绝',
                time: updatedAtLabel !== '未知' ? updatedAtLabel : createdAtLabel,
                detail: [
                    adminNotes ? `管理员回复：${adminNotes}` : '管理员已完成本工单处理。',
                    currentStatus === 'RESOLVED' ? this.safeText(ticket?.refund_summary).trim() : ''
                ].filter(Boolean).join('\n'),
                icon: currentStatus === 'RESOLVED' ? 'fa-circle-check' : 'fa-circle-xmark',
                tone: currentStatus === 'RESOLVED' ? 'success' : 'danger'
            });
        }

        return items;
    },

    normalizeReplyTimelineItems: function (items = []) {
        return (Array.isArray(items) ? items : [])
            .map((item) => ({
                ...item,
                time: this.formatDateTime(item?.time || item?.created_at || item?.at)
            }))
            .filter((item) => this.safeText(item?.title).trim());
    },

    mergeReplyTimelineItems: function (fallbackItems = [], auditItems = []) {
        const normalizedFallbackItems = this.normalizeReplyTimelineItems(fallbackItems);
        const normalizedAuditItems = this.normalizeReplyTimelineItems(auditItems);

        if (!normalizedAuditItems.length) {
            return normalizedFallbackItems;
        }

        const mergedItems = normalizedAuditItems.slice();
        normalizedFallbackItems.forEach((item) => {
            const title = this.safeText(item?.title).trim();
            const isCurrentStateItem = title === '工单等待处理中' || title === '工单已超时待处理';
            if (isCurrentStateItem) {
                mergedItems.push(item);
            }
        });

        return mergedItems;
    },

    buildReplyModalDetailState: function (ticket = {}, newStatus = '') {
        const state = this.buildReplyModalState(ticket, newStatus);
        const sourceMeta = this.getTicketSourceMeta(ticket);
        const issueTypeLabel = this.safeText(ticket?.issue_type_label).trim() || this.getIssueTypeLabel(ticket?.issue_type);
        const statusLabel = this.safeText(ticket?.status_label).trim() || this.getTicketStatusLabel(ticket?.status);
        const createdAtLabel = this.formatDateTime(ticket?.created_at);
        const updatedAtLabel = this.formatDateTime(ticket?.updated_at);
        const waitLabel = this.safeText(ticket?.sla_label).trim() || (
            state.normalizedCurrentStatus === 'PENDING'
                ? '等待处理中'
                : `已处理 · ${statusLabel}`
        );
        const refundSummary = this.safeText(ticket?.refund_summary).trim()
            || (this.safeText(ticket?.order_id).trim() ? '已关联订单' : '无关联订单');
        const descriptionText = this.safeText(ticket?.reason || ticket?.description, '暂无描述');
        const summaryItems = [
            {
                label: '工单号',
                value: this.safeText(ticket?.id).trim() || '未知工单'
            },
            {
                label: '当前状态',
                value: statusLabel
            },
            {
                label: '优先级',
                value: this.safeText(ticket?.priority_label).trim() || '常规'
            },
            {
                label: '负责人',
                value: this.safeText(ticket?.assigned_to_label).trim() || '未指派'
            },
            {
                label: '创建时间',
                value: createdAtLabel
            },
            {
                label: '处理动作',
                value: state.title
            },
            {
                label: '用户 ID',
                value: this.safeText(ticket?.user_id).trim() || '未关联用户'
            },
            {
                label: '用户邮箱',
                value: this.safeText(ticket?.user_email).trim() || '无邮箱'
            },
            {
                label: '订单号',
                value: this.safeText(ticket?.order_id).trim() || '无关联订单'
            },
            {
                label: '退款信息',
                value: refundSummary,
                tone: ticket?.can_refund ? 'success' : ''
            },
            {
                label: 'SLA',
                value: waitLabel,
                tone: ticket?.is_overdue ? 'warning' : ''
            }
        ];

        if (Number(ticket?.order_price_paid) > 0) {
            summaryItems.splice(7, 0, {
                label: '订单实付',
                value: this.formatPoints(ticket?.order_price_paid)
            });
        }

        if (updatedAtLabel !== '未知' && updatedAtLabel !== createdAtLabel) {
            summaryItems.push({
                label: '最近更新',
                value: updatedAtLabel
            });
        }

        const contextItems = [{
            label: '工单来源',
            value: sourceMeta.sourceLabel
        }];

        const linkedChatContext = this.parseLinkedChatSessionContext(ticket?.description);
        if (linkedChatContext) {
            if (linkedChatContext.title) {
                contextItems.push({
                    label: '来源标题',
                    value: linkedChatContext.title
                });
            }
            if (linkedChatContext.session_id) {
                contextItems.push({
                    label: '会话标识',
                    value: linkedChatContext.session_id
                });
            }
            if (linkedChatContext.user_email && linkedChatContext.user_email !== this.safeText(ticket?.user_email).trim()) {
                contextItems.push({
                    label: '来源邮箱',
                    value: linkedChatContext.user_email
                });
            }
        }

        const linkedOpsAlertContext = this.parseLinkedOpsAlertContext(ticket?.description);
        if (linkedOpsAlertContext) {
            if (linkedOpsAlertContext.title) {
                contextItems.push({
                    label: '代办标题',
                    value: linkedOpsAlertContext.title
                });
            }
            if (linkedOpsAlertContext.alert_type) {
                contextItems.push({
                    label: '告警类型',
                    value: linkedOpsAlertContext.alert_type
                });
            }
            if (linkedOpsAlertContext.reference_label && linkedOpsAlertContext.reference_value) {
                contextItems.push({
                    label: linkedOpsAlertContext.reference_label,
                    value: linkedOpsAlertContext.reference_value
                });
            }
            if (linkedOpsAlertContext.target_id) {
                contextItems.push({
                    label: '告警标识',
                    value: linkedOpsAlertContext.target_id
                });
            }
        }

        const adminNotes = this.safeText(ticket?.admin_notes).trim();
        if (adminNotes) {
            contextItems.push({
                label: '最近回复',
                value: adminNotes,
                tone: 'success',
                multiline: true
            });
        }

        const subtitleParts = [
            sourceMeta.sourceLabel,
            issueTypeLabel,
            waitLabel
        ].filter(Boolean);
        const templates = this.buildReplyTemplates(ticket, state);
        const timelineItems = this.buildReplyTimelineItems(ticket, {
            ...state,
            subtitle: subtitleParts.join(' · ') || '回复处理结果并通知用户'
        });

        return {
            ...state,
            subtitle: subtitleParts.join(' · ') || '回复处理结果并通知用户',
            headerBadges: [
                {
                    text: sourceMeta.sourceLabel,
                    variant: sourceMeta.sourceType || 'default'
                },
                {
                    text: issueTypeLabel,
                    variant: 'issue'
                },
                {
                    text: waitLabel,
                    variant: ticket?.is_overdue ? 'warning' : 'slate'
                }
            ],
            summaryItems,
            contextItems,
            descriptionText,
            quickActions: this.buildWorkbenchActionDefinitions(ticket),
            templates,
            timelineItems
        };
    },

    mergeReplyTemplateText: function (currentValue = '', templateText = '') {
        const current = this.safeText(currentValue).trim();
        const next = this.safeText(templateText).trim();

        if (!next) {
            return current;
        }
        if (!current) {
            return next;
        }
        if (current.includes(next)) {
            return current;
        }

        return `${current}\n\n${next}`;
    },

    applyReplyTemplate: function (templateText = '') {
        const replyInput = document.getElementById('ticketAdminReply');
        if (!replyInput) {
            return '';
        }

        const mergedValue = this.mergeReplyTemplateText(replyInput.value, templateText);
        replyInput.value = mergedValue;

        if (typeof replyInput.focus === 'function') {
            replyInput.focus();
        }
        if (typeof replyInput.setSelectionRange === 'function') {
            const cursorPosition = mergedValue.length;
            replyInput.setSelectionRange(cursorPosition, cursorPosition);
        }

        return mergedValue;
    },

    loadReplyTimelineHistory: async function (ticket = {}, fallbackItems = []) {
        const ticketId = this.safeText(ticket?.id).trim();
        const timeline = document.getElementById('ticketReplyTimeline');
        if (!ticketId || !timeline) {
            return this.normalizeReplyTimelineItems(fallbackItems);
        }

        const requestId = (this._replyTimelineRequestId || 0) + 1;
        this._replyTimelineRequestId = requestId;

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.getTicketHistoryUrl(ticketId), {
                method: 'GET',
                headers
            });
            const result = await response.json().catch(() => ({}));

            if (requestId !== this._replyTimelineRequestId) {
                return this.normalizeReplyTimelineItems(fallbackItems);
            }

            if (!response.ok || !result.success) {
                throw new Error(result.message || '工单历史加载失败');
            }

            const activeTicketId = document.getElementById('replyTicketId')?.value || '';
            if (this.safeText(activeTicketId).trim() !== ticketId) {
                return this.normalizeReplyTimelineItems(fallbackItems);
            }

            const mergedItems = this.mergeReplyTimelineItems(fallbackItems, result.items);
            if (mergedItems.length) {
                timeline.innerHTML = this.renderReplyModalTimeline(mergedItems);
            }

            return mergedItems;
        } catch (error) {
            console.warn('[AdminTickets] reply timeline history load error:', error);
            return this.normalizeReplyTimelineItems(fallbackItems);
        }
    },

    renderReplyModalSummaryItems: function (items = []) {
        if (!Array.isArray(items) || !items.length) {
            return '<div class="admin-ticket-reply-modal__empty">暂无可展示的工单摘要</div>';
        }

        return items.map((item) => {
            const toneClass = item?.tone ? ` admin-ticket-reply-modal__summary-item--${this.safeText(item.tone).trim().toLowerCase()}` : '';
            return `
                <div class="admin-ticket-reply-modal__summary-item${toneClass}">
                    <span class="admin-ticket-reply-modal__summary-label">${this.escapeHtml(item?.label || '')}</span>
                    <span class="admin-ticket-reply-modal__summary-value">${this.escapeHtml(item?.value || '')}</span>
                </div>
            `;
        }).join('');
    },

    renderReplyModalContextItems: function (items = []) {
        if (!Array.isArray(items) || !items.length) {
            return '<div class="admin-ticket-reply-modal__empty">当前工单暂无额外的会话或代办上下文</div>';
        }

        return items.map((item) => {
            const tone = this.safeText(item?.tone).trim().toLowerCase();
            const multilineClass = item?.multiline ? ' admin-ticket-reply-modal__context-item--multiline' : '';
            const toneClass = tone ? ` admin-ticket-reply-modal__context-item--${tone}` : '';
            return `
                <div class="admin-ticket-reply-modal__context-item${multilineClass}${toneClass}">
                    <div class="admin-ticket-reply-modal__context-label">${this.escapeHtml(item?.label || '')}</div>
                    <div class="admin-ticket-reply-modal__context-value">${this.escapeHtml(item?.value || '')}</div>
                </div>
            `;
        }).join('');
    },

    renderReplyModalHeaderBadges: function (items = []) {
        return (Array.isArray(items) ? items : [])
            .filter((item) => this.safeText(item?.text).trim())
            .map((item) => `
                <span class="admin-ticket-secondary-badge admin-ticket-secondary-badge--${this.escapeHtml(this.safeText(item?.variant, 'default').trim().toLowerCase() || 'default')} admin-ticket-reply-modal__header-badge">
                    ${this.escapeHtml(item?.text || '')}
                </span>
            `)
            .join('');
    },

    renderReplyModalQuickActions: function (actions = []) {
        if (!Array.isArray(actions) || !actions.length) {
            return '<div class="admin-ticket-reply-modal__empty">当前工单没有可直接回看的关联工作区</div>';
        }

        return actions.map((action) => `
            <button
                type="button"
                class="admin-ticket-reply-modal__quick-action admin-ticket-reply-modal__quick-action--${this.escapeHtml(this.safeText(action?.variant, 'default').trim().toLowerCase() || 'default')}"
                data-ticket-quick-target="${this.escapeHtml(action?.target || '')}">
                <i class="fas ${this.escapeHtml(action?.icon || 'fa-arrow-up-right-from-square')}"></i>
                <span>${this.escapeHtml(action?.title || '打开关联工作区')}</span>
            </button>
        `).join('');
    },

    renderReplyModalTemplates: function (templates = []) {
        if (!Array.isArray(templates) || !templates.length) {
            return '<div class="admin-ticket-reply-modal__empty">当前动作暂无可推荐的快捷模板</div>';
        }

        return templates.map((template) => `
            <button
                type="button"
                class="admin-ticket-reply-modal__template"
                data-ticket-template-text="${this.escapeHtml(template?.body || '')}">
                <div class="admin-ticket-reply-modal__template-title">
                    <span>${this.escapeHtml(template?.title || '快捷模板')}</span>
                    <span class="admin-ticket-reply-modal__template-tag">${this.escapeHtml(template?.tag || '模板')}</span>
                </div>
                <div class="admin-ticket-reply-modal__template-body">${this.escapeHtml(template?.body || '')}</div>
            </button>
        `).join('');
    },

    renderReplyModalTimeline: function (items = []) {
        if (!Array.isArray(items) || !items.length) {
            return '<div class="admin-ticket-reply-modal__empty">当前工单还没有可展示的处理轨迹</div>';
        }

        return items.map((item) => {
            const tone = this.safeText(item?.tone).trim().toLowerCase();
            const toneClass = tone ? ` admin-ticket-reply-modal__timeline-item--${tone}` : '';
            return `
                <div class="admin-ticket-reply-modal__timeline-item${toneClass}">
                    <div class="admin-ticket-reply-modal__timeline-icon">
                        <i class="fas ${this.escapeHtml(item?.icon || 'fa-circle')}"></i>
                    </div>
                    <div class="admin-ticket-reply-modal__timeline-card">
                        <div class="admin-ticket-reply-modal__timeline-topline">
                            <span class="admin-ticket-reply-modal__timeline-title">${this.escapeHtml(item?.title || '')}</span>
                            <span class="admin-ticket-reply-modal__timeline-time">${this.escapeHtml(item?.time || '未知')}</span>
                        </div>
                        <div class="admin-ticket-reply-modal__timeline-detail">${this.escapeHtml(item?.detail || '')}</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    syncReplyModalState: function (ticket = {}, newStatus = '') {
        const modal = document.getElementById('ticketReplyModal');
        const replyTicketId = document.getElementById('replyTicketId');
        const replyNewStatus = document.getElementById('replyNewStatus');
        const replyInput = document.getElementById('ticketAdminReply');
        const refundCheckbox = document.getElementById('ticketRefundCheckbox');
        const refundField = document.getElementById('ticketRefundField');
        const refundHint = document.getElementById('ticketRefundHint');
        const internalNoteInput = document.getElementById('ticketInternalNote');
        const submitLabel = document.getElementById('ticketReplySubmitLabel');
        const subtitle = document.getElementById('ticketReplyModalSubtitle');
        const headerBadges = document.getElementById('ticketReplyModalHeaderBadges');
        const summaryGrid = document.getElementById('ticketReplySummaryGrid');
        const description = document.getElementById('ticketReplyDescription');
        const contextList = document.getElementById('ticketReplyContextList');
        const quickActions = document.getElementById('ticketReplyQuickActions');
        const templates = document.getElementById('ticketReplyTemplates');
        const timeline = document.getElementById('ticketReplyTimeline');
        const state = this.buildReplyModalDetailState(ticket, newStatus);

        if (replyTicketId) {
            replyTicketId.value = this.safeText(ticket?.id);
        }
        if (replyNewStatus) {
            replyNewStatus.value = state.normalizedNextStatus;
        }
        if (replyInput) {
            replyInput.value = '';
        }
        if (internalNoteInput) {
            internalNoteInput.value = '';
        }
        if (refundCheckbox) {
            refundCheckbox.checked = false;
            refundCheckbox.disabled = !state.canRefund;
        }
        if (refundField) {
            refundField.classList.toggle('admin-ticket-reply-modal__refund--disabled', !state.canRefund);
        }
        if (refundHint) {
            refundHint.textContent = state.refundHint;
        }
        if (submitLabel) {
            submitLabel.textContent = state.submitLabel;
        }
        if (subtitle) {
            subtitle.textContent = state.subtitle;
        }
        if (headerBadges) {
            headerBadges.innerHTML = this.renderReplyModalHeaderBadges(state.headerBadges);
        }
        if (summaryGrid) {
            summaryGrid.innerHTML = this.renderReplyModalSummaryItems(state.summaryItems);
        }
        if (description) {
            description.textContent = state.descriptionText;
        }
        if (contextList) {
            contextList.innerHTML = this.renderReplyModalContextItems(state.contextItems);
        }
        if (quickActions) {
            quickActions.innerHTML = this.renderReplyModalQuickActions(state.quickActions);
            if (typeof quickActions.querySelectorAll === 'function') {
                quickActions.querySelectorAll('[data-ticket-quick-target]').forEach((button) => {
                    button.addEventListener('click', () => {
                        const target = this.safeText(button?.dataset?.ticketQuickTarget).trim();
                        if (target) {
                            this.openWorkbench(ticket, target);
                        }
                    });
                });
            }
        }
        if (templates) {
            templates.innerHTML = this.renderReplyModalTemplates(state.templates);
            if (typeof templates.querySelectorAll === 'function') {
                templates.querySelectorAll('[data-ticket-template-text]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.applyReplyTemplate(this.safeText(button?.dataset?.ticketTemplateText));
                    });
                });
            }
        }
        if (timeline) {
            timeline.innerHTML = this.renderReplyModalTimeline(state.timelineItems);
        }
        if (modal) {
            modal.setAttribute('data-ticket-reply-status', state.normalizedNextStatus.toLowerCase());
            const titleNode = modal.querySelector('.modal-title');
            if (titleNode) {
                titleNode.textContent = state.title;
            }
        }

        return state;
    },

    buildRefundConfirmationMessage: function (ticket = {}, adminReply = '', internalNote = '') {
        const shortTicketId = this.safeText(ticket?.id).trim().slice(0, 8) || '未知工单';
        const orderId = this.safeText(ticket?.order_id).trim();
        const lines = [`确认将工单 ${shortTicketId} 标记为已解决并退还订单积分吗？`];

        if (orderId) {
            lines.push(`关联订单：${orderId}`);
        }
        if (adminReply) {
            lines.push(`处理说明：${adminReply}`);
        }
        if (internalNote) {
            lines.push(`内部备注：${internalNote}`);
        }

        lines.push('该操作会尝试触发订单退款流程，并同步通知用户。');
        return lines.join('\n');
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

    createSecondaryBadge: function (text, variant = 'default') {
        const badge = document.createElement('span');
        badge.className = `admin-ticket-secondary-badge admin-ticket-secondary-badge--${variant}`;
        badge.textContent = this.safeText(text);
        return badge;
    },

    filter: function (status, btnElement) {
        this.cancelPendingSearch();
        this.currentStatus = this.normalizeStatusFilter(status);
        this.currentPage = 1;

        const buttons = document.querySelectorAll('#module-tickets .filter-btn');
        if (buttons.length > 0) {
            buttons.forEach(b => b.classList.remove('active'));
            if (btnElement) btnElement.classList.add('active');
        }

        return this.applyFilters();
    },

    toggleQuickFilter: function (filterKey = '') {
        const normalizedKey = this.safeText(filterKey).trim().toLowerCase();

        if (normalizedKey === 'overdue') {
            this.quickFilters = {
                ...this.quickFilters,
                overdueOnly: !this.quickFilters.overdueOnly
            };
        } else if (normalizedKey === 'priority') {
            this.quickFilters = {
                ...this.quickFilters,
                priority: this.quickFilters.priority === 'high' ? 'all' : 'high'
            };
        } else if (normalizedKey === 'mine' || normalizedKey === 'unassigned') {
            this.quickFilters = {
                ...this.quickFilters,
                assignee: this.quickFilters.assignee === normalizedKey ? 'all' : normalizedKey
            };
        } else {
            return null;
        }

        this.currentPage = 1;
        this.syncQuickFilterButtons();
        return this.applyFilters();
    },

    submitBulkAssignment: async function (operation = 'assign_self') {
        const normalizedOperation = this.safeText(operation).trim().toLowerCase();
        const ticketIds = this.normalizeSelectedTicketIds(this.selectedTicketIds);
        if (!ticketIds.length) {
            this.notify('请先选择待处理工单', 'warning');
            return;
        }

        const selectedTickets = (Array.isArray(this.filteredTickets) ? this.filteredTickets : [])
            .filter((ticket) => ticketIds.includes(this.safeText(ticket?.id).trim()));
        const pendingTicketIds = this.normalizeSelectedTicketIds(selectedTickets.filter((ticket) => this.isTicketSelectable(ticket)).map((ticket) => ticket?.id));
        if (!pendingTicketIds.length) {
            this.notify('当前选择中没有可指派的待处理工单', 'warning');
            return;
        }

        if (normalizedOperation === 'clear' && !this.requestConfirmation(`确认取消这 ${pendingTicketIds.length} 个工单的负责人吗？`)) {
            return;
        }

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.getTicketsAssignUrl(), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ticketIds: pendingTicketIds,
                    operation: normalizedOperation
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '批量指派失败');
            }

            this.selectedTicketIds = [];
            this.syncSelectionControls();

            if (normalizedOperation === 'clear') {
                this.notify(`已取消 ${Math.max(0, Number(result.changedCount || 0))} 个工单的负责人`, 'success');
            } else {
                this.notify(`已将 ${Math.max(0, Number(result.changedCount || 0))} 个工单指派给你`, 'success');
            }

            await Promise.all([
                this.loadOverview({
                    force: true,
                    showSkeleton: false
                }),
                this.loadTickets({
                    page: this.currentPage,
                    status: this.currentStatus,
                    searchQuery: this.searchQuery,
                    overdueOnly: this.quickFilters.overdueOnly,
                    priority: this.quickFilters.priority,
                    assignee: this.quickFilters.assignee
                })
            ]);
        } catch (error) {
            this.notify(`批量处理失败: ${this.safeText(error?.message, '未知错误')}`, 'error');
        }
    },

    getSelectedPendingTickets: function () {
        const selectedIds = this.normalizeSelectedTicketIds(this.selectedTicketIds);
        return (Array.isArray(this.filteredTickets) ? this.filteredTickets : [])
            .filter((ticket) => selectedIds.includes(this.safeText(ticket?.id).trim()))
            .filter((ticket) => this.isTicketSelectable(ticket));
    },

    buildBulkProcessTemplates: function (newStatus = '', tickets = []) {
        const normalizedStatus = this.normalizeTicketStatusValue(newStatus);
        const selectedTickets = Array.isArray(tickets) ? tickets : [];
        const issueTypeCounts = selectedTickets.reduce((accumulator, ticket) => {
            const issueType = this.safeText(ticket?.issue_type, 'OTHER').trim().toUpperCase() || 'OTHER';
            accumulator[issueType] = (accumulator[issueType] || 0) + 1;
            return accumulator;
        }, {});
        const dominantIssueType = Object.entries(issueTypeCounts).sort((left, right) => right[1] - left[1])[0]?.[0] || 'OTHER';
        return this.buildReplyTemplates({
            issue_type: dominantIssueType,
            order_id: selectedTickets.some((ticket) => this.safeText(ticket?.order_id).trim()) ? 'bulk-order' : ''
        }, {
            normalizedNextStatus: normalizedStatus,
            canRefund: false
        });
    },

    applyBulkReplyTemplate: function (templateText = '') {
        const replyInput = document.getElementById('ticketBulkAdminReply');
        if (!replyInput) {
            return '';
        }

        const mergedValue = this.mergeReplyTemplateText(replyInput.value, templateText);
        replyInput.value = mergedValue;

        if (typeof replyInput.focus === 'function') {
            replyInput.focus();
        }
        if (typeof replyInput.setSelectionRange === 'function') {
            const cursorPosition = mergedValue.length;
            replyInput.setSelectionRange(cursorPosition, cursorPosition);
        }

        return mergedValue;
    },

    syncBulkProcessModalState: function (newStatus = '') {
        const selectedTickets = this.getSelectedPendingTickets();
        if (!selectedTickets.length) {
            return null;
        }

        const normalizedStatus = this.normalizeTicketStatusValue(newStatus);
        const titleNode = document.getElementById('ticketBulkProcessTitle');
        const countNode = document.getElementById('ticketBulkProcessCount');
        const submitLabel = document.getElementById('ticketBulkProcessSubmitLabel');
        const templates = document.getElementById('ticketBulkProcessTemplates');
        const replyInput = document.getElementById('ticketBulkAdminReply');
        const internalNoteInput = document.getElementById('ticketBulkInternalNote');
        const statusInput = document.getElementById('ticketBulkNewStatus');
        const templatesData = this.buildBulkProcessTemplates(normalizedStatus, selectedTickets);
        const sourceLabels = Array.from(new Set(selectedTickets.map((ticket) => this.safeText(ticket?.source_label).trim()).filter(Boolean)));

        if (titleNode) {
            titleNode.textContent = normalizedStatus === 'REJECTED' ? '批量拒绝工单' : '批量解决工单';
        }
        if (countNode) {
            countNode.textContent = `本次将处理 ${selectedTickets.length} 个待处理工单${sourceLabels.length ? ` · ${sourceLabels.join(' / ')}` : ''}`;
        }
        if (submitLabel) {
            submitLabel.textContent = normalizedStatus === 'REJECTED' ? '确认批量拒绝' : '确认批量解决';
        }
        if (replyInput) {
            replyInput.value = '';
        }
        if (internalNoteInput) {
            internalNoteInput.value = '';
        }
        if (statusInput) {
            statusInput.value = normalizedStatus;
        }
        if (templates) {
            templates.innerHTML = this.renderReplyModalTemplates(templatesData);
            if (typeof templates.querySelectorAll === 'function') {
                templates.querySelectorAll('[data-ticket-template-text]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.applyBulkReplyTemplate(this.safeText(button?.dataset?.ticketTemplateText));
                    });
                });
            }
        }

        return {
            normalizedStatus,
            selectedTickets,
            templates: templatesData
        };
    },

    openBulkProcessModal: function (newStatus = '') {
        const state = this.syncBulkProcessModalState(newStatus);
        if (!state?.selectedTickets?.length) {
            this.notify('请先选择待处理工单', 'warning');
            return;
        }

        const modal = document.getElementById('ticketBulkProcessModal');
        if (!modal) {
            return;
        }

        modal.classList.add('is-visible');
        modal.setAttribute('aria-hidden', 'false');

        const replyInput = document.getElementById('ticketBulkAdminReply');
        if (replyInput && typeof replyInput.focus === 'function') {
            replyInput.focus();
        }
    },

    closeBulkProcessModal: function () {
        const modal = document.getElementById('ticketBulkProcessModal');
        if (!modal) {
            return;
        }
        modal.classList.remove('is-visible');
        modal.setAttribute('aria-hidden', 'true');
    },

    buildBulkProcessConfirmationMessage: function (tickets = [], newStatus = '', adminReply = '') {
        const normalizedStatus = this.normalizeTicketStatusValue(newStatus);
        const lines = [
            `确认将 ${Array.isArray(tickets) ? tickets.length : 0} 个工单批量标记为${normalizedStatus === 'REJECTED' ? '已拒绝' : '已解决'}吗？`
        ];

        if (adminReply) {
            lines.push(`统一回复：${adminReply}`);
        }

        lines.push('该操作会逐个通知用户，并同步回写相关处理历史。');
        return lines.join('\n');
    },

    submitBulkProcess: async function () {
        const selectedTickets = this.getSelectedPendingTickets();
        const newStatus = document.getElementById('ticketBulkNewStatus')?.value || '';
        const adminReply = document.getElementById('ticketBulkAdminReply')?.value.trim() || '';
        const internalNote = document.getElementById('ticketBulkInternalNote')?.value.trim() || '';

        if (!selectedTickets.length) {
            this.notify('请先选择待处理工单', 'warning');
            return;
        }

        if (!adminReply && this.normalizeTicketStatusValue(newStatus) === 'REJECTED') {
            this.notify('批量拒绝工单时请填写统一回复', 'warning');
            return;
        }

        if (!this.requestConfirmation(this.buildBulkProcessConfirmationMessage(selectedTickets, newStatus, adminReply))) {
            return;
        }

        const btn = document.getElementById('ticketBulkProcessSubmitBtn');
        const originText = btn?.innerHTML || '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '处理中...';
        }

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.getTicketsBatchProcessUrl(), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ticketIds: selectedTickets.map((ticket) => this.safeText(ticket?.id).trim()),
                    newStatus,
                    adminReply,
                    internalNote
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '批量处理失败');
            }

            this.closeBulkProcessModal();
            this.selectedTicketIds = [];
            this.syncSelectionControls();

            const processedCount = Math.max(0, Number(result.processedCount || 0));
            const skippedCount = Math.max(0, Number(result.skippedCount || 0));
            const failedCount = Math.max(0, Number(result.failedCount || 0));
            let successMessage = `已批量处理 ${processedCount} 个工单`;
            if (skippedCount > 0) {
                successMessage += `，跳过 ${skippedCount} 个`;
            }
            if (failedCount > 0) {
                successMessage += `，失败 ${failedCount} 个`;
            }
            this.notify(successMessage, failedCount > 0 ? 'warning' : 'success');

            await Promise.all([
                this.loadOverview({
                    force: true,
                    showSkeleton: false
                }),
                this.loadTickets({
                    page: this.currentPage,
                    status: this.currentStatus,
                    searchQuery: this.searchQuery,
                    overdueOnly: this.quickFilters.overdueOnly,
                    priority: this.quickFilters.priority,
                    assignee: this.quickFilters.assignee
                })
            ]);
        } catch (error) {
            this.notify(`批量处理失败: ${this.safeText(error?.message, '未知错误')}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originText;
            }
        }
    },

    render: function () {
        const tbody = document.getElementById('ticketsTableBody');
        if (!tbody) return;

        const totalPages = Math.max(1, Number(this.pagination?.totalPages || 1) || 1);
        const currentData = Array.isArray(this.filteredTickets) ? this.filteredTickets : [];

        const focusedIndex = this.getFocusedTicketIndex(this.filteredTickets, this.focusedTicketId);

        if (currentData.length === 0) {
            tbody.replaceChildren(this.createTableStateRow({
                message: '暂无符合条件的工单',
                icon: 'fa-inbox',
                variant: 'empty'
            }));
            this.renderPagination(totalPages);
            this.syncSelectionControls();
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
            const isSelectedTicket = this.isTicketSelected(ticket.id);
            row.className = `admin-ticket-row${isFocusedTicket ? ' admin-ticket-row--focused' : ''}${isSelectedTicket ? ' admin-ticket-row--selected' : ''}`;
            row.dataset.ticketId = this.safeText(ticket.id);

            const selectionCell = document.createElement('td');
            selectionCell.className = 'admin-ticket-selection-cell';
            if (this.isTicketSelectable(ticket)) {
                const selectionInput = document.createElement('input');
                selectionInput.type = 'checkbox';
                selectionInput.className = 'admin-ticket-selection-checkbox';
                selectionInput.checked = isSelectedTicket;
                selectionInput.setAttribute('aria-label', `选择工单 ${this.safeText(ticket.id).substring(0, 8)}`);
                selectionInput.addEventListener('change', () => {
                    this.toggleTicketSelection(ticket.id, selectionInput.checked);
                });
                selectionCell.appendChild(selectionInput);
            } else {
                const selectionMuted = document.createElement('span');
                selectionMuted.className = 'admin-ticket-selection-muted';
                selectionMuted.textContent = '—';
                selectionCell.appendChild(selectionMuted);
            }

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
            const metaCluster = document.createElement('div');
            metaCluster.className = 'admin-ticket-meta-cluster';
            metaCluster.appendChild(this.createSecondaryBadge(ticket.source_label || '用户提交', this.safeText(ticket.source_type, 'default').toLowerCase() || 'default'));
            metaCluster.appendChild(this.createSecondaryBadge(ticket.issue_type_label || '其他问题', 'issue'));
            if (ticket.is_high_priority) {
                metaCluster.appendChild(this.createSecondaryBadge(ticket.priority_label || '高优先', 'priority'));
            }
            reasonCell.appendChild(metaCluster);

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

            const slaDiv = document.createElement('div');
            slaDiv.className = `admin-ticket-sla-meta${ticket.is_overdue ? ' admin-ticket-sla-meta--overdue' : ''}`;
            slaDiv.textContent = this.safeText(ticket.sla_label, '等待中');
            statusCell.appendChild(slaDiv);

            const refundDiv = document.createElement('div');
            refundDiv.className = `admin-ticket-refund-meta${ticket.can_refund ? ' admin-ticket-refund-meta--actionable' : ''}`;
            refundDiv.textContent = this.safeText(ticket.refund_summary, '无关联订单');
            statusCell.appendChild(refundDiv);

            const assigneeDiv = document.createElement('div');
            assigneeDiv.className = `admin-ticket-assignee-meta${this.safeText(ticket.assigned_to_label).trim() ? ' admin-ticket-assignee-meta--assigned' : ''}`;
            assigneeDiv.textContent = this.safeText(ticket.assignment_summary, '负责人：未指派');
            statusCell.appendChild(assigneeDiv);

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

            row.appendChild(selectionCell);
            row.appendChild(metaCell);
            row.appendChild(orderCell);
            row.appendChild(userCell);
            row.appendChild(reasonCell);
            row.appendChild(statusCell);
            row.appendChild(actionCell);
            tbody.appendChild(row);
        });

        this.renderPagination(totalPages);
        this.syncSelectionControls();
        if (focusedIndex >= 0) {
            this.scrollFocusedTicketIntoView();
        }
    },

    renderPagination: function (totalPages) {
        const container = document.getElementById('ticketsPagination');
        if (!container) return;

        const currentPage = this.normalizePageNumber(this.currentPage, totalPages);
        const totalItems = Math.max(0, Number(this.pagination?.totalItems || 0) || 0);

        container.innerHTML = `
            <div class="admin-ticket-pagination-shell">
                <div class="pagination-control">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="tickets-pagination-go"
                        data-ticket-page="${Math.max(currentPage - 1, 1)}"
                        ${currentPage <= 1 ? 'disabled' : ''}>−</button>
                    <input type="number" class="pagination-input" value="${currentPage}" min="1" max="${totalPages}"
                        data-admin-change-action="tickets-pagination-go">
                    <button class="pagination-btn"
                        type="button"
                        data-admin-action="tickets-pagination-go"
                        data-ticket-page="${Math.min(currentPage + 1, totalPages)}"
                        ${currentPage >= totalPages ? 'disabled' : ''}>+</button>
                </div>
                <div class="pagination-total pagination-total--compact">共 ${totalPages} 页 / ${totalItems} 条</div>
            </div>
        `;
    },

    changePage: function (page) {
        this.cancelPendingSearch();
        const totalPages = Math.max(1, Number(this.pagination?.totalPages || 1) || 1);
        const nextPage = this.normalizePageNumber(page, totalPages);
        return this.loadTickets({
            page: nextPage,
            status: this.currentStatus,
            searchQuery: this.searchQuery
        });
    },

    openReplyModal: function (ticketId, newStatus) {
        const ticket = this.resolveLoadedTicketRecord(ticketId) || { id: ticketId };
        const state = this.buildReplyModalState(ticket, newStatus);
        if (state.normalizedCurrentStatus !== 'PENDING') {
            this.notify(`工单当前状态为${this.getTicketStatusLabel(state.normalizedCurrentStatus)}，不能重复处理`, 'warning');
            return;
        }

        const detailState = this.syncReplyModalState(ticket, newStatus);

        const modal = document.getElementById('ticketReplyModal');
        if (!modal) return;
        modal.classList.add('is-visible');
        modal.setAttribute('aria-hidden', 'false');

        this.loadReplyTimelineHistory(ticket, detailState?.timelineItems || []);

        const replyInput = document.getElementById('ticketAdminReply');
        if (replyInput && typeof replyInput.focus === 'function') {
            replyInput.focus();
        }
    },

    closeReplyModal: function () {
        this._replyTimelineRequestId = (this._replyTimelineRequestId || 0) + 1;
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
        const ticketId = document.getElementById('replyTicketId')?.value || '';
        const newStatus = document.getElementById('replyNewStatus')?.value || '';
        const adminReply = document.getElementById('ticketAdminReply')?.value.trim() || '';
        const internalNote = document.getElementById('ticketInternalNote')?.value.trim() || '';
        const doRefund = document.getElementById('ticketRefundCheckbox')?.checked === true;
        const ticket = this.resolveLoadedTicketRecord(ticketId) || { id: ticketId };
        const state = this.buildReplyModalState(ticket, newStatus);

        if (!adminReply && newStatus === 'REJECTED') {
            this.notify('拒绝工单时请填写回复理由', 'warning');
            return;
        }

        if (state.normalizedCurrentStatus !== 'PENDING') {
            this.notify(`工单当前状态为${this.getTicketStatusLabel(state.normalizedCurrentStatus)}，不能重复处理`, 'warning');
            return;
        }

        if (doRefund && !state.canRefund) {
            this.notify(state.refundHint, 'warning');
            return;
        }

        if (doRefund && !this.requestConfirmation(this.buildRefundConfirmationMessage(ticket, adminReply, internalNote))) {
            return;
        }

        const btn = document.querySelector('#ticketReplyModal .btn-primary');
        const originText = btn?.innerHTML || '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '处理中...';
        }

        try {
            const headers = await this.getAdminAuthHeaders();
            const response = await fetch(this.buildAdminTicketsUrl('tickets/process'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ticketId,
                    newStatus,
                    adminReply,
                    internalNote,
                    doRefund
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.message || '工单处理失败');
            }

            // Close modal
            this.closeReplyModal();
            if (result.refundDuplicate) {
                this.notify('已完成工单处理，关联订单此前已退款，无需重复退回积分', 'success');
            } else if (result.refundAmount > 0) {
                this.notify(`已完成工单处理，并退回 ${Math.max(0, Math.round(Number(result.refundAmount || 0)))} 积分`, 'success');
            } else {
                this.notify('已完成工单处理', 'success');
            }

            await Promise.all([
                this.loadOverview({
                    force: true,
                    showSkeleton: false
                }),
                this.loadTickets()
            ]);

        } catch (err) {
            this.notify(`处理失败: ${this.safeText(err?.message, '未知错误')}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originText;
            }
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
window.AdminTickets?.syncTicketWorkspaceView?.();
window.addEventListener?.('ops-alerts-config-updated', (event) => {
    window.AdminTickets?.handleOpsAlertsConfigUpdated?.(event);
});
