class AdminChat {
    constructor(targetContainer = null) {
        const previousInstance = window.adminChatInstance;
        if (previousInstance && previousInstance !== this && typeof previousInstance.destroy === 'function') {
            previousInstance.destroy();
        }

        this.supabase = window.supabaseClient;
        this.currentSessionId = null;
        this.currentSessionKey = null;
        this.currentSessionIds = [];
        this.sessions = [];
        this.chatSessions = [];
        this.opsAlertMessages = [];
        this.opsAlertLoadError = '';
        this.targetContainer = targetContainer;
        this.searchQuery = '';
        this.chatChannel = null;
        this.opsAlertChannel = null;
        this.ticketChannel = null;
        this.paymentChannel = null;
        this.verificationChannel = null;
        this.userPresenceChannel = null;
        this.userPresenceStatusTimer = null;
        this.userPresenceByKey = new Map();
        this.userActivityChannel = null;
        this.userActivityRefreshTimer = null;
        this.userActivityByKey = new Map();
        this.userActivityFetchDisabled = false;
        this.sessionSlaTimer = null;
        this.sessionQueueView = 'all';
        this.sessionQueueFilter = 'all';
        this.sessionQueueDefaultView = 'all';
        this.sessionQueueDefaultFilter = 'all';
        this.sidebarInsightsCollapsed = true;
        this.opsAlertCaseActionLocks = new Set();
        this.opsAlertBatchAssignBusy = false;
        this.opsAlertViewFilter = 'active';
        this.opsAlertOwnerFilter = 'all';
        this.opsAlertReadCategoryFilter = 'all';
        this.opsAlertReadTimeFilter = 'visible';
        this.opsAlertReadReceipts = new Map();
        this.pendingPaymentReadReceipts = new Map();
        this.opsAlertAssignableAdmins = [];
        this.opsAlertCurrentAdminId = '';
        this.opsAlertCurrentAdminLabel = '';
        this.opsAlertModuleMuteRules = {};
        this.userContextCache = new Map();
        this.userContextRecentActions = new Map();
        this.currentUserContext = null;
        this.currentSessionInfo = null;
        this.userContextPanelCollapsed = true;
        this.currentAdminUserId = '';
        this.currentAdminUserPromise = null;
        this.isSessionBootstrapPending = false;
        this.sessionBootstrapPromise = null;
        this.hasBootstrappedSessions = false;
        this.hasHydratedSessionSidebarData = false;
        this.sessionDeferredHydrationPromise = null;
        this.sessionDeferredHydrationHandle = null;
        this.sessionHistoryConsistencyPromise = null;
        this.sessionHistoryConsistencyHandle = null;
        this.sessionRealtimeHydrationHandle = null;
        this.pendingRealtimeSessionUserIds = new Set();
        this.pendingRealtimeSessionEmailKeys = new Set();
        this.backgroundServicesStarted = false;
        this.opsAlertSettingsConfigCache = null;
        this.opsAlertSettingsConfigLoadedAt = 0;
        this.chatScrollbarAutoHideClass = 'admin-scrollbar-auto-hide';
        this.chatScrollbarAutoHideVisibleClass = 'admin-scrollbar-auto-hide--visible';
        this.chatScrollbarAutoHideBoundAttr = 'data-admin-chat-scrollbar-auto-hide-bound';
        this.replyTemplateConfigTemplates = null;
        this.replyTemplateConfigLoadedAt = 0;
        this.replyTemplateConfigPromise = null;
        this._replyTemplateRenderToken = 0;
        this._userContextRequestId = 0;
        this._mobileKeyboardDock = {
            baseViewportHeight: 0,
            baseVisualHeight: 0,
            baseContainerHeight: 0,
            lastBottomInset: 0,
            lastTranslateY: 0,
            lastDockHeight: 0,
            docked: false,
            scrollLockActive: false,
            rafId: 0,
            focusedReleaseTimer: null,
            stableViewportProbe: null,
            cleanup: null
        };
        this.destroyed = false;
        this.opsAlertSessionId = '__admin_ops_todo__';
        this.handleDocumentClick = this.handleDocumentClick.bind(this);
        this.handleOpsAlertConfigUpdated = this.handleOpsAlertConfigUpdated.bind(this);
        this.handleWindowResize = this.updateChatContextPanelLayout.bind(this);
        this.restoreSessionQueuePreferences();
        this.restoreSidebarInsightsPreference();
        this.restoreOpsAlertReadReceipts();
        this.restorePendingPaymentReadReceipts();
        window.addEventListener('ops-alerts-config-updated', this.handleOpsAlertConfigUpdated);
        window.addEventListener('resize', this.handleWindowResize);

        window.adminChatInstance = this;
        this.init();
    }

    destroy() {
        this.destroyed = true;

        if (this.supabase?.removeChannel) {
            if (this.chatChannel) {
                this.supabase.removeChannel(this.chatChannel);
                this.chatChannel = null;
            }
            if (this.opsAlertChannel) {
                this.supabase.removeChannel(this.opsAlertChannel);
                this.opsAlertChannel = null;
            }
            if (this.ticketChannel) {
                this.supabase.removeChannel(this.ticketChannel);
                this.ticketChannel = null;
            }
            if (this.paymentChannel) {
                this.supabase.removeChannel(this.paymentChannel);
                this.paymentChannel = null;
            }
            if (this.verificationChannel) {
                this.supabase.removeChannel(this.verificationChannel);
                this.verificationChannel = null;
            }
            if (this.userPresenceChannel) {
                this.supabase.removeChannel(this.userPresenceChannel);
                this.userPresenceChannel = null;
            }
            if (this.userActivityChannel) {
                this.supabase.removeChannel(this.userActivityChannel);
                this.userActivityChannel = null;
            }
        }

        if (this.sessionSlaTimer) {
            window.clearInterval(this.sessionSlaTimer);
            this.sessionSlaTimer = null;
        }
        if (this.userPresenceStatusTimer) {
            window.clearInterval(this.userPresenceStatusTimer);
            this.userPresenceStatusTimer = null;
        }
        if (this.userActivityRefreshTimer) {
            window.clearInterval(this.userActivityRefreshTimer);
            this.userActivityRefreshTimer = null;
        }

        if (this.sessionDeferredHydrationHandle) {
            if (this.sessionDeferredHydrationHandle.type === 'idle' && typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(this.sessionDeferredHydrationHandle.id);
            } else if (this.sessionDeferredHydrationHandle.type === 'timeout') {
                window.clearTimeout(this.sessionDeferredHydrationHandle.id);
            }
            this.sessionDeferredHydrationHandle = null;
        }

        if (this.sessionHistoryConsistencyHandle) {
            if (this.sessionHistoryConsistencyHandle.type === 'idle' && typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(this.sessionHistoryConsistencyHandle.id);
            } else if (this.sessionHistoryConsistencyHandle.type === 'timeout') {
                window.clearTimeout(this.sessionHistoryConsistencyHandle.id);
            }
            this.sessionHistoryConsistencyHandle = null;
        }

        if (this.sessionRealtimeHydrationHandle) {
            window.clearTimeout(this.sessionRealtimeHydrationHandle);
            this.sessionRealtimeHydrationHandle = null;
        }

        document.removeEventListener('click', this.handleDocumentClick);
        window.removeEventListener('ops-alerts-config-updated', this.handleOpsAlertConfigUpdated);
        window.removeEventListener('resize', this.handleWindowResize);
        window.ZaoyoeAdminPresence?.stop?.();
        this.detachMobileKeyboardDock();
    }

    startAdminPresence() {
        window.ZaoyoeAdminPresence?.start?.(this.supabase);
    }

    getUserPresenceChannelName() {
        return window.ZaoyoeUserPresence?.channelName || window.AdminAccess?.userPresenceChannelName || 'zaoyoe-user-presence';
    }

    getPresenceKeysForPayload(payload = {}) {
        const keys = [];
        const pushKey = (prefix, value) => {
            const normalized = String(value || '').trim();
            if (!normalized) return;
            keys.push(`${prefix}:${prefix === 'email' ? normalized.toLowerCase() : normalized}`);
        };

        pushKey('user', payload.user_id || payload.userId);
        pushKey('email', payload.email);
        pushKey('session', payload.session_id || payload.sessionId);
        (Array.isArray(payload.session_ids) ? payload.session_ids : [])
            .forEach((value) => pushKey('session', value));

        return [...new Set(keys)];
    }

    getPresenceKeysForSession(session = {}) {
        const keys = [];
        const pushKey = (prefix, value) => {
            const normalized = String(value || '').trim();
            if (!normalized) return;
            keys.push(`${prefix}:${prefix === 'email' ? normalized.toLowerCase() : normalized}`);
        };

        pushKey('user', session.userId || session.profile?.id);
        pushKey('email', this.resolveSessionContextEmail(session) || session.email || session.profile?.email);
        pushKey('session', session.sessionId);
        (Array.isArray(session.sessionIds) ? session.sessionIds : [])
            .forEach((value) => pushKey('session', value));

        return [...new Set(keys)];
    }

    getSessionPresenceState(session = {}) {
        const keys = this.getPresenceKeysForSession(session);
        const liveStates = keys
            .map((key) => this.userPresenceByKey.get(key))
            .filter(Boolean);
        const activityStates = keys
            .map((key) => this.userActivityByKey.get(key))
            .filter(Boolean);
        const states = [...liveStates, ...activityStates];
        if (!states.length) {
            return { online: false, lastSeenAt: '' };
        }

        const latest = states.sort((left, right) => Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0))[0];
        return {
            online: liveStates.some((state) => state.online),
            lastSeenAt: latest?.lastSeenAt || ''
        };
    }

    getSessionPresenceStatusItem(session = {}) {
        if (this.isOpsAlertSession(session)) return null;
        const presence = this.getSessionPresenceState(session);
        const lastSeenAt = String(presence.lastSeenAt || '').trim();
        const lastSeenTime = Date.parse(lastSeenAt);

        if (presence.online) {
            return { label: '状态', value: '在线', tone: 'success' };
        }

        if (!Number.isFinite(lastSeenTime)) {
            return null;
        }

        const diffMins = Math.max(1, Math.floor((Date.now() - lastSeenTime) / 60000));
        if (diffMins < 30) {
            return { label: '状态', value: `${diffMins}分钟前活跃`, tone: 'warning' };
        }
        if (diffMins < 60) {
            return { label: '状态', value: `${diffMins}分钟前`, tone: 'neutral' };
        }
        if (diffMins < 1440) {
            return { label: '状态', value: `${Math.floor(diffMins / 60)}小时前`, tone: 'neutral' };
        }
        return { label: '状态', value: `${Math.floor(diffMins / 1440)}天前`, tone: 'neutral' };
    }

    applyUserPresenceToSessions() {
        this.chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []).map((session) => {
            const presence = this.getSessionPresenceState(session);
            return {
                ...session,
                presenceOnline: presence.online,
                presenceLastSeenAt: presence.lastSeenAt
            };
        });
    }

    refreshUserPresenceSnapshot() {
        if (!this.userPresenceChannel || typeof this.userPresenceChannel.presenceState !== 'function') {
            return;
        }

        const state = this.userPresenceChannel.presenceState() || {};
        const nextPresenceByKey = new Map();
        Object.values(state)
            .flatMap((entries) => Array.isArray(entries) ? entries : [])
            .filter((entry) => String(entry?.role || '') === 'user')
            .forEach((entry) => {
                const lastSeenAt = String(entry?.last_seen_at || entry?.online_at || new Date().toISOString()).trim();
                this.getPresenceKeysForPayload(entry).forEach((key) => {
                    const current = nextPresenceByKey.get(key);
                    if (!current || Date.parse(lastSeenAt || 0) >= Date.parse(current.lastSeenAt || 0)) {
                        nextPresenceByKey.set(key, {
                            online: true,
                            lastSeenAt
                        });
                    }
                });
            });

        this.userPresenceByKey = nextPresenceByKey;
        this.applyUserPresenceToSessions();
        this.composeSessions();
        this.syncCurrentSessionFromSessions();
        this.renderSessionList(this.searchQuery);
        if (this.currentSessionInfo && !this.isOpsAlertSession(this.currentSessionInfo)) {
            this.renderUserContextHeaderStatus(this.currentUserContext);
        }
    }

    createRealtimeSubscription(channelName, buildChannel, options = {}) {
        if (!this.supabase?.channel || typeof buildChannel !== 'function') {
            return null;
        }

        const subscribeRealtime = window.subscribeZaoyoeRealtime;
        if (typeof subscribeRealtime === 'function') {
            const subscription = subscribeRealtime({
                client: this.supabase,
                channel: channelName,
                feature: options.feature || 'admin_chat',
                timeoutMs: options.timeoutMs || 2600,
                build: buildChannel,
                onActive: options.onActive,
                onDegraded: (reason, detail) => {
                    console.warn(`[AdminChat] Realtime degraded for ${channelName}; polling/manual refresh remains available:`, reason, detail?.error || '');
                    options.onDegraded?.(reason, detail);
                }
            });
            return subscription?.channel || null;
        }

        try {
            const channel = buildChannel(this.supabase.channel(channelName));
            return channel.subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    console.warn(`[AdminChat] Realtime degraded for ${channelName}; polling/manual refresh remains available:`, status);
                    options.onDegraded?.(String(status || '').toLowerCase(), {});
                }
                if (status === 'SUBSCRIBED') {
                    options.onActive?.({ reason: 'subscribed' });
                }
            });
        } catch (error) {
            console.warn(`[AdminChat] Realtime unavailable for ${channelName}; polling/manual refresh remains available:`, error?.message || error);
            options.onDegraded?.('subscribe_exception', { error: error?.message || String(error || '') });
            return null;
        }
    }

    subscribeToUserPresence() {
        if (!this.supabase?.channel || this.userPresenceChannel) {
            return;
        }

        this.userPresenceChannel = this.createRealtimeSubscription(
            this.getUserPresenceChannelName(),
            (channel) => channel.on('presence', { event: 'sync' }, () => {
                this.refreshUserPresenceSnapshot();
            }),
            {
                feature: 'admin_user_presence',
                onActive: () => this.refreshUserPresenceSnapshot()
            }
        );

        this.userPresenceStatusTimer = window.setInterval(() => {
            if (document.hidden) return;
            if (this.currentSessionInfo && !this.isOpsAlertSession(this.currentSessionInfo)) {
                this.renderUserContextHeaderStatus(this.currentUserContext);
            }
            this.renderSessionList(this.searchQuery);
        }, 15000);
    }

    getUserActivitySiteParam() {
        return window.AdminSiteFilter?.getSiteParam?.() || null;
    }

    isUserActivityRowInScope(row = {}) {
        const siteFilter = this.getUserActivitySiteParam();
        if (!siteFilter) return true;
        return String(row?.site || '').trim() === siteFilter;
    }

    isMissingUserActivityTableError(error = null) {
        const raw = [
            error?.code,
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ');
        return /42P01|PGRST205|schema cache|does not exist|could not find/i.test(raw);
    }

    normalizeUserActivityLastSeenAt(value = '') {
        const time = Date.parse(value || '');
        return Number.isFinite(time) ? new Date(time).toISOString() : '';
    }

    upsertUserActivityStateForKeys(keys = [], lastActiveAt = '') {
        const normalizedLastActiveAt = this.normalizeUserActivityLastSeenAt(lastActiveAt);
        const nextTime = Date.parse(normalizedLastActiveAt || '');
        if (!Number.isFinite(nextTime)) {
            return false;
        }

        let changed = false;
        [...new Set(Array.isArray(keys) ? keys : [])].forEach((key) => {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return;
            const current = this.userActivityByKey.get(normalizedKey);
            const currentTime = Date.parse(current?.lastSeenAt || '');
            if (!current || !Number.isFinite(currentTime) || nextTime >= currentTime) {
                this.userActivityByKey.set(normalizedKey, {
                    online: false,
                    lastSeenAt: normalizedLastActiveAt
                });
                changed = true;
            }
        });
        return changed;
    }

    applyUserActivityRowsToSessions(rows = [], sessions = this.chatSessions) {
        const sessionList = (Array.isArray(sessions) ? sessions : []).filter((session) => !this.isOpsAlertSession(session));
        const sessionsByUserId = new Map();
        sessionList.forEach((session) => {
            const userId = String(session?.userId || session?.profile?.id || '').trim();
            if (!userId) return;
            const existing = sessionsByUserId.get(userId) || [];
            existing.push(session);
            sessionsByUserId.set(userId, existing);
        });

        let changed = false;
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            if (!this.isUserActivityRowInScope(row)) return;
            const userId = String(row?.user_id || row?.userId || '').trim();
            const lastActiveAt = String(row?.last_active_at || row?.lastActiveAt || '').trim();
            if (!userId || !lastActiveAt) return;

            const matchedSessions = sessionsByUserId.get(userId) || [];
            if (matchedSessions.length) {
                matchedSessions.forEach((session) => {
                    changed = this.upsertUserActivityStateForKeys(
                        this.getPresenceKeysForSession(session),
                        lastActiveAt
                    ) || changed;
                });
                return;
            }

            changed = this.upsertUserActivityStateForKeys(
                this.getPresenceKeysForPayload(row),
                lastActiveAt
            ) || changed;
        });
        return changed;
    }

    getUserActivitySessionIds(sessions = this.chatSessions) {
        return [...new Set((Array.isArray(sessions) ? sessions : [])
            .map((session) => String(session?.userId || session?.profile?.id || '').trim())
            .filter(Boolean))];
    }

    async fetchUserActivityRowsForSessions(sessions = this.chatSessions) {
        const userIds = this.getUserActivitySessionIds(sessions);
        if (!userIds.length || !this.supabase?.from || this.userActivityFetchDisabled) {
            return [];
        }

        try {
            let query = this.supabase
                .from('engagement_user_activity')
                .select('user_id,last_active_at,site')
                .in('user_id', userIds)
                .order('last_active_at', { ascending: false });

            const siteFilter = this.getUserActivitySiteParam();
            if (siteFilter) {
                query = query.eq('site', siteFilter);
            }

            const { data, error } = await query;
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            if (this.isMissingUserActivityTableError(error)) {
                this.userActivityFetchDisabled = true;
                return [];
            }
            console.warn('[AdminChat] Failed to fetch user activity heartbeats:', error);
            return [];
        }
    }

    renderUserActivityStatusRefresh() {
        this.applyUserPresenceToSessions();
        this.composeSessions();
        this.syncCurrentSessionFromSessions();
        this.renderSessionList(this.searchQuery);
        if (this.currentSessionInfo && !this.isOpsAlertSession(this.currentSessionInfo)) {
            this.renderUserContextHeaderStatus(this.currentUserContext);
        }
    }

    async refreshUserActivityForSessions(sessions = this.chatSessions, { render = false } = {}) {
        const rows = await this.fetchUserActivityRowsForSessions(sessions);
        const changed = this.applyUserActivityRowsToSessions(rows, sessions);
        if (changed && render) {
            this.renderUserActivityStatusRefresh();
        }
        return rows;
    }

    handleUserActivityRealtime(row = {}) {
        if (!row || !this.isUserActivityRowInScope(row)) return;
        const changed = this.applyUserActivityRowsToSessions([row], this.chatSessions);
        if (changed) {
            this.renderUserActivityStatusRefresh();
        }
    }

    subscribeToUserActivity() {
        if (!this.supabase?.from || this.userActivityRefreshTimer) {
            return;
        }

        if (this.supabase?.channel && !this.userActivityChannel) {
            this.userActivityChannel = this.createRealtimeSubscription(
                `admin-user-activity-${Date.now()}`,
                (channel) => channel
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'engagement_user_activity' }, (payload) => {
                    this.handleUserActivityRealtime(payload.new);
                })
                    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'engagement_user_activity' }, (payload) => {
                    this.handleUserActivityRealtime(payload.new);
                }),
                { feature: 'admin_user_activity' }
            );
        }

        this.userActivityRefreshTimer = window.setInterval(() => {
            if (document.hidden) return;
            void this.refreshUserActivityForSessions(this.chatSessions, { render: true });
        }, 30000);
        void this.refreshUserActivityForSessions(this.chatSessions, { render: true });
    }

    isMobileKeyboardDockEnabled() {
        const ua = navigator.userAgent || '';
        const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const vv = window.visualViewport;
        const viewportWidth = Math.min(
            ...[
                window.innerWidth || 0,
                document.documentElement.clientWidth || 0,
                vv?.width || 0
            ].filter((value) => value > 0)
        );
        const coarsePointer = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
        const narrowViewport = window.matchMedia('(max-width: 900px)').matches
            || (viewportWidth > 0 && viewportWidth <= 900)
            || (coarsePointer && viewportWidth > 0 && viewportWidth <= 1024);
        return isiOS && narrowViewport && Boolean(vv);
    }

    getAdminChatKeyboardElements() {
        const containerEl = document.getElementById('chatMainContainer');
        const interfaceEl = document.getElementById('chatInterface');
        return {
            containerEl,
            interfaceEl,
            inputWrapper: document.getElementById('chatInputWrapper'),
            input: document.getElementById('adminChatInput')
        };
    }

    isAdminChatInputFocused() {
        const { interfaceEl } = this.getAdminChatKeyboardElements();
        const active = document.activeElement;
        return Boolean(interfaceEl && active && interfaceEl.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
    }

    focusAdminChatInputWithoutScroll(input) {
        if (!input) return;
        try {
            input.focus({ preventScroll: true });
        } catch (_) {
            input.focus();
        }
    }

    lockAdminChatKeyboardPage() {
        if (!window.iOSScrollLock || !this.isMobileKeyboardDockEnabled()) return;
        const { containerEl, interfaceEl } = this.getAdminChatKeyboardElements();
        if (!interfaceEl || interfaceEl.hidden) return;

        window.iOSScrollLock.lockLight(containerEl || interfaceEl, {
            restoreScrollDuringViewport: true
        });
        this._mobileKeyboardDock.scrollLockActive = true;
    }

    unlockAdminChatKeyboardPage() {
        if (!this._mobileKeyboardDock?.scrollLockActive || !window.iOSScrollLock) return;
        window.iOSScrollLock.unlock();
        this._mobileKeyboardDock.scrollLockActive = false;
    }

    getAdminChatKeyboardStableViewportProbe() {
        if (this._mobileKeyboardDock.stableViewportProbe?.isConnected) {
            return this._mobileKeyboardDock.stableViewportProbe;
        }

        const probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.className = 'admin-chat-viewport-probe';
        document.body.appendChild(probe);
        this._mobileKeyboardDock.stableViewportProbe = probe;
        return probe;
    }

    getAdminChatKeyboardStableViewportHeight() {
        const probe = this.getAdminChatKeyboardStableViewportProbe();
        return Math.max(0, Math.round(probe?.getBoundingClientRect().height || probe?.offsetHeight || 0));
    }

    removeAdminChatKeyboardStableViewportProbe() {
        if (this._mobileKeyboardDock.stableViewportProbe?.isConnected) {
            this._mobileKeyboardDock.stableViewportProbe.remove();
        }
        this._mobileKeyboardDock.stableViewportProbe = null;
    }

    captureAdminChatKeyboardBase() {
        const vv = window.visualViewport;
        const visualTop = Math.max(0, vv?.offsetTop || 0);
        const visualHeight = Math.max(0, vv?.height || 0);
        const visualBottom = visualTop + visualHeight;
        const stableViewportHeight = this.getAdminChatKeyboardStableViewportHeight();
        this._mobileKeyboardDock.baseViewportHeight = Math.max(
            this._mobileKeyboardDock.baseViewportHeight || 0,
            stableViewportHeight,
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            visualBottom
        );
        this._mobileKeyboardDock.baseVisualHeight = Math.max(
            this._mobileKeyboardDock.baseVisualHeight || 0,
            visualHeight
        );

        const { containerEl, interfaceEl } = this.getAdminChatKeyboardElements();
        const dockTarget = containerEl || interfaceEl;
        if (dockTarget && !this._mobileKeyboardDock.docked) {
            const rect = dockTarget.getBoundingClientRect();
            const targetHeight = Math.round(rect.height || dockTarget.offsetHeight || 0);
            if (targetHeight > 0) {
                this._mobileKeyboardDock.baseContainerHeight = Math.max(
                    this._mobileKeyboardDock.baseContainerHeight || 0,
                    targetHeight
                );
            }
        }
    }

    getAdminChatKeyboardMetrics() {
        const vv = window.visualViewport;
        const visualTop = Math.max(0, vv?.offsetTop || 0);
        const visualHeight = Math.max(0, vv?.height || 0);
        const visualBottom = visualTop + visualHeight;
        const baseViewportHeight = Math.max(
            this._mobileKeyboardDock.baseViewportHeight || 0,
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            visualBottom
        );
        const baseVisualHeight = Math.max(this._mobileKeyboardDock.baseVisualHeight || 0, visualHeight);
        const bottomInset = Math.max(
            0,
            Math.round(Math.max(
                baseViewportHeight - visualBottom,
                baseVisualHeight - visualHeight
            ))
        );

        return { baseViewportHeight, visualHeight, visualBottom, bottomInset };
    }

    getAdminChatFocusKeyboardInset(metrics = this.getAdminChatKeyboardMetrics()) {
        const baseViewportHeight = Math.max(320, metrics.baseViewportHeight || 0);
        const estimatedInset = Math.min(
            440,
            Math.max(280, Math.round(baseViewportHeight * 0.44))
        );

        return metrics.bottomInset > 24 ? metrics.bottomInset : estimatedInset;
    }

    clearAdminChatFocusedReleaseTimer() {
        if (this._mobileKeyboardDock.focusedReleaseTimer) {
            clearTimeout(this._mobileKeyboardDock.focusedReleaseTimer);
            this._mobileKeyboardDock.focusedReleaseTimer = null;
        }
    }

    scheduleAdminChatFocusedRelease() {
        if (this._mobileKeyboardDock.focusedReleaseTimer) return;

        this._mobileKeyboardDock.focusedReleaseTimer = setTimeout(() => {
            this._mobileKeyboardDock.focusedReleaseTimer = null;
            if (!this.isAdminChatInputFocused() || !this._mobileKeyboardDock.docked) return;
            const liveMetrics = this.getAdminChatKeyboardMetrics();
            if (liveMetrics.bottomInset <= 24) {
                this.releaseAdminChatKeyboardDock();
                this.unlockAdminChatKeyboardPage();
            }
        }, 48);
    }

    applyAdminChatKeyboardDock(bottomInset) {
        const { containerEl, interfaceEl, inputWrapper } = this.getAdminChatKeyboardElements();
        if (!interfaceEl || !inputWrapper || interfaceEl.hidden) return;

        this.clearAdminChatFocusedReleaseTimer();
        const metrics = this.getAdminChatKeyboardMetrics();
        const effectiveBottomInset = Math.max(0, Math.round(bottomInset ?? metrics.bottomInset));
        const dockTarget = containerEl || interfaceEl;
        const targetRect = dockTarget.getBoundingClientRect();
        const liveTargetHeight = Math.round(targetRect.height || dockTarget.offsetHeight || interfaceEl.offsetHeight || 0);
        const baseContainerHeight = Math.max(
            320,
            this._mobileKeyboardDock.baseContainerHeight || 0,
            this._mobileKeyboardDock.lastDockHeight || 0,
            liveTargetHeight || 0
        );
        const baseViewportHeight = Math.max(
            320,
            metrics.baseViewportHeight || 0,
            this._mobileKeyboardDock.baseViewportHeight || 0
        );
        const keyboardTop = Math.max(0, baseViewportHeight - effectiveBottomInset);
        const minTop = Math.max(8, Math.round((window.visualViewport?.offsetTop || 0) + 8));
        const keyboardClearance = 12;
        const maxAvailableHeight = Math.max(300, Math.round(keyboardTop - minTop - keyboardClearance));
        const dockHeight = Math.round(Math.min(baseContainerHeight, maxAvailableHeight));
        const targetBottom = Math.max(40, keyboardTop - 12);
        const previousTranslateY = Math.round(this._mobileKeyboardDock.lastTranslateY || 0);
        const layoutTop = Math.round((targetRect.top || 0) - previousTranslateY);
        const layoutBottom = layoutTop + dockHeight;
        const translateY = Math.round(Math.max(-520, Math.min(80, targetBottom - layoutBottom)));

        interfaceEl.classList.remove('admin-chat-keyboard-docked');
        dockTarget.classList.add('admin-chat-keyboard-docked');
        dockTarget.style.setProperty('--admin-chat-keyboard-shift-y', `${translateY}px`);
        dockTarget.style.setProperty('--admin-chat-keyboard-dock-height', `${dockHeight}px`);
        this._mobileKeyboardDock.docked = true;
        this._mobileKeyboardDock.lastBottomInset = effectiveBottomInset;
        this._mobileKeyboardDock.lastTranslateY = translateY;
        this._mobileKeyboardDock.lastDockHeight = dockHeight;
        this.updateChatContextPanelLayout();
    }

    releaseAdminChatKeyboardDock() {
        this.clearAdminChatFocusedReleaseTimer();
        const { containerEl, interfaceEl } = this.getAdminChatKeyboardElements();
        if (containerEl) {
            containerEl.classList.remove('admin-chat-keyboard-docked');
            containerEl.style.removeProperty('--admin-chat-keyboard-shift-y');
            containerEl.style.removeProperty('--admin-chat-keyboard-dock-height');
        }
        if (interfaceEl) {
            interfaceEl.classList.remove('admin-chat-keyboard-docked');
            interfaceEl.style.removeProperty('--admin-chat-keyboard-shift-y');
            interfaceEl.style.removeProperty('--admin-chat-keyboard-dock-height');
        }
        this._mobileKeyboardDock.docked = false;
        this._mobileKeyboardDock.lastBottomInset = 0;
        this._mobileKeyboardDock.lastTranslateY = 0;
        this._mobileKeyboardDock.lastDockHeight = 0;
    }

    syncAdminChatKeyboardDock() {
        const { interfaceEl } = this.getAdminChatKeyboardElements();
        if (!interfaceEl || interfaceEl.hidden || !this.isMobileKeyboardDockEnabled()) {
            this.releaseAdminChatKeyboardDock();
            return;
        }

        const activeInput = this.isAdminChatInputFocused();
        const metrics = this.getAdminChatKeyboardMetrics();
        if (activeInput && this._mobileKeyboardDock.docked && metrics.bottomInset <= 24) {
            this.scheduleAdminChatFocusedRelease();
            return;
        }
        const effectiveBottomInset = activeInput
            ? this.getAdminChatFocusKeyboardInset(metrics)
            : metrics.bottomInset;
        const shouldDock = activeInput && effectiveBottomInset > 24;

        if (activeInput) {
            this.lockAdminChatKeyboardPage();
        } else {
            this.unlockAdminChatKeyboardPage();
        }

        if (shouldDock) {
            this.applyAdminChatKeyboardDock(effectiveBottomInset);
            return;
        }

        if (this._mobileKeyboardDock.docked) {
            this.releaseAdminChatKeyboardDock();
        }
    }

    requestAdminChatKeyboardDockSync() {
        if (this._mobileKeyboardDock.rafId) return;
        this._mobileKeyboardDock.rafId = requestAnimationFrame(() => {
            this._mobileKeyboardDock.rafId = 0;
            this.syncAdminChatKeyboardDock();
        });
    }

    attachMobileKeyboardDock() {
        if (!this.isMobileKeyboardDockEnabled()) return;
        const { interfaceEl, input } = this.getAdminChatKeyboardElements();
        const vv = window.visualViewport;
        if (!interfaceEl || !input || !vv) return;

        this.detachMobileKeyboardDock();
        this.captureAdminChatKeyboardBase();

        const handleViewportChange = () => this.requestAdminChatKeyboardDockSync();
        const handleInputFocus = () => {
            this.captureAdminChatKeyboardBase();
            this.lockAdminChatKeyboardPage();
            handleViewportChange();
            setTimeout(handleViewportChange, 60);
            setTimeout(handleViewportChange, 120);
            setTimeout(handleViewportChange, 260);
        };
        const handleInputBlur = () => {
            handleViewportChange();
            setTimeout(handleViewportChange, 120);
        };
        const handleTouchStart = (event) => {
            if (!this.isMobileKeyboardDockEnabled()) return;
            if (event.cancelable) event.preventDefault();
            this.captureAdminChatKeyboardBase();
            this.lockAdminChatKeyboardPage();
            this.focusAdminChatInputWithoutScroll(input);
            handleViewportChange();
            setTimeout(handleViewportChange, 60);
        };

        vv.addEventListener('resize', handleViewportChange, { passive: true });
        vv.addEventListener('scroll', handleViewportChange, { passive: true });
        window.addEventListener('resize', handleViewportChange, { passive: true });
        window.addEventListener('orientationchange', handleViewportChange, { passive: true });
        input.addEventListener('focus', handleInputFocus);
        input.addEventListener('blur', handleInputBlur);
        input.addEventListener('touchstart', handleTouchStart, { passive: false });

        this._mobileKeyboardDock.cleanup = () => {
            vv.removeEventListener('resize', handleViewportChange);
            vv.removeEventListener('scroll', handleViewportChange);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('orientationchange', handleViewportChange);
            input.removeEventListener('focus', handleInputFocus);
            input.removeEventListener('blur', handleInputBlur);
            input.removeEventListener('touchstart', handleTouchStart);
            if (this._mobileKeyboardDock.rafId) {
                cancelAnimationFrame(this._mobileKeyboardDock.rafId);
                this._mobileKeyboardDock.rafId = 0;
            }
            this._mobileKeyboardDock.cleanup = null;
        };

        this.requestAdminChatKeyboardDockSync();
    }

    detachMobileKeyboardDock() {
        if (typeof this._mobileKeyboardDock?.cleanup === 'function') {
            this._mobileKeyboardDock.cleanup();
        }
        if (this._mobileKeyboardDock?.rafId) {
            cancelAnimationFrame(this._mobileKeyboardDock.rafId);
            this._mobileKeyboardDock.rafId = 0;
        }
        if (this._mobileKeyboardDock) {
            this._mobileKeyboardDock.baseViewportHeight = 0;
            this._mobileKeyboardDock.baseVisualHeight = 0;
            this._mobileKeyboardDock.baseContainerHeight = 0;
        }
        this.releaseAdminChatKeyboardDock();
        this.unlockAdminChatKeyboardPage();
        this.removeAdminChatKeyboardStableViewportProbe();
    }

    // i18n helper with fallback
    t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key);
        }
        return fallback || key;
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    looksLikeEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    }

    truncateText(value, maxLength = 80) {
        const text = String(value || '').trim();
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
    }

    buildMessageAreaLoadingSkeleton() {
        const rows = [68, 52, 60, 44].map((width, index) => `
            <div class="chat-skeleton-row${index % 2 === 1 ? ' chat-skeleton-row--self' : ''}">
                <div class="chat-skeleton-bubble">
                    <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${width}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${Math.max(32, width - 18)}%"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--tiny" style="width:${18 + (index % 3) * 8}%"></span>
                </div>
            </div>
        `).join('');

        return `
            <div class="chat-loading-state chat-loading-state--skeleton" aria-hidden="true">
                ${rows}
            </div>
        `;
    }

    getSessionQueuePreferenceStorageKey() {
        return 'zaoyoe_admin_support_queue_preferences_v1';
    }

    getSidebarInsightsPreferenceStorageKey() {
        return 'zaoyoe_admin_support_sidebar_insights_v1';
    }

    getChatSessionCacheStorageKey() {
        return `zaoyoe_admin_support_session_cache_v1:${this.getActiveSiteFilter()}`;
    }

    getOpsAlertReadReceiptStorageKey() {
        return `zaoyoe_admin_ops_alert_read_receipts_v1:${this.getActiveSiteFilter()}`;
    }

    getPendingPaymentReadReceiptStorageKey() {
        return `zaoyoe_admin_chat_pending_payment_read_receipts_v1:${this.getActiveSiteFilter()}`;
    }

    getChatSessionCacheMaxAgeMs() {
        return 5 * 60 * 1000;
    }

    getChatBootstrapMessageLimit() {
        return 500;
    }

    getChatHistoryPageSize() {
        return 1000;
    }

    async ensureCurrentAdminUserId() {
        if (this.currentAdminUserId) {
            return this.currentAdminUserId;
        }

        if (this.currentAdminUserPromise) {
            return this.currentAdminUserPromise;
        }

        this.currentAdminUserPromise = this.supabase?.auth?.getUser?.()
            .then(({ data }) => {
                const userId = String(data?.user?.id || '').trim();
                this.currentAdminUserId = userId;
                return userId;
            })
            .catch((error) => {
                console.warn('[AdminChat] Failed to resolve current admin user id:', error);
                return '';
            })
            .finally(() => {
                this.currentAdminUserPromise = null;
            });

        return this.currentAdminUserPromise;
    }

    cloneChatSessionCacheValue(value, depth = 0) {
        if (depth > 4 || value == null) {
            return value ?? null;
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (Array.isArray(value)) {
            return value
                .map((entry) => this.cloneChatSessionCacheValue(entry, depth + 1))
                .filter((entry) => entry !== undefined);
        }

        if (typeof value === 'object') {
            return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
                if (typeof entryValue === 'function' || entryValue === undefined) {
                    return accumulator;
                }
                accumulator[key] = this.cloneChatSessionCacheValue(entryValue, depth + 1);
                return accumulator;
            }, {});
        }

        return value;
    }

    serializeChatProfileForCache(profile = null) {
        if (!profile || typeof profile !== 'object') {
            return null;
        }

        return this.cloneChatSessionCacheValue({
            id: profile.id || '',
            email: profile.email || '',
            username: profile.username || '',
            display_name: profile.display_name || '',
            avatar_url: profile.avatar_url || ''
        });
    }

    serializeChatSessionForCache(session = {}) {
        return this.cloneChatSessionCacheValue({
            sessionId: session.sessionId || '',
            sessionIds: Array.isArray(session.sessionIds) ? session.sessionIds : [],
            nickname: session.nickname || '',
            email: session.email || '',
            lastMessage: session.lastMessage || '',
            timestamp: session.timestamp instanceof Date ? session.timestamp.toISOString() : (session.timestamp || ''),
            userId: session.userId || '',
            unread: Number(session.unread || 0),
            profile: this.serializeChatProfileForCache(session.profile),
            lastUserMessageAt: session.lastUserMessageAt || '',
            lastAdminMessageAt: session.lastAdminMessageAt || '',
            replySummary: session.replySummary || null,
            ticketSummary: session.ticketSummary || null,
            paymentSummary: session.paymentSummary || null,
            verificationSummary: session.verificationSummary || null
        });
    }

    restoreChatSessionCache() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return false;
        }

        try {
            const rawValue = window.localStorage.getItem(this.getChatSessionCacheStorageKey());
            if (!rawValue) return false;

            const parsed = JSON.parse(rawValue);
            const updatedAt = Date.parse(parsed?.updatedAt || '');
            if (!Number.isFinite(updatedAt) || (Date.now() - updatedAt) > this.getChatSessionCacheMaxAgeMs()) {
                window.localStorage.removeItem(this.getChatSessionCacheStorageKey());
                return false;
            }

            const cachedSessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
            if (!cachedSessions.length) {
                this.chatSessions = [];
                return false;
            }

            this.chatSessions = cachedSessions
                .map((session) => {
                    if (!session || typeof session !== 'object') {
                        return null;
                    }

                    const sessionId = String(session.sessionId || '').trim();
                    const sessionIds = Array.isArray(session.sessionIds)
                        ? session.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
                        : [];
                    if (!sessionId || !sessionIds.length) {
                        return null;
                    }

                    const timestamp = session.timestamp ? new Date(session.timestamp) : null;
                    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
                        return null;
                    }

                    return {
                        sessionId,
                        sessionIds,
                        nickname: String(session.nickname || '').trim(),
                        email: String(session.email || '').trim(),
                        lastMessage: String(session.lastMessage || ''),
                        timestamp,
                        userId: String(session.userId || '').trim(),
                        unread: Number(session.unread || 0),
                        profile: session.profile && typeof session.profile === 'object'
                            ? { ...session.profile }
                            : null,
                        lastUserMessageAt: session.lastUserMessageAt || '',
                        lastAdminMessageAt: session.lastAdminMessageAt || '',
                        replySummary: session.replySummary && typeof session.replySummary === 'object'
                            ? { ...session.replySummary }
                            : this.buildSessionReplySummary(session.lastUserMessageAt, session.lastAdminMessageAt),
                        ticketSummary: session.ticketSummary && typeof session.ticketSummary === 'object'
                            ? this.cloneChatSessionCacheValue(session.ticketSummary)
                            : null,
                        paymentSummary: session.paymentSummary && typeof session.paymentSummary === 'object'
                            ? this.cloneChatSessionCacheValue(session.paymentSummary)
                            : null,
                        verificationSummary: session.verificationSummary && typeof session.verificationSummary === 'object'
                            ? this.cloneChatSessionCacheValue(session.verificationSummary)
                            : null
                    };
                })
                .filter(Boolean);

            return this.chatSessions.length > 0;
        } catch (error) {
            console.warn('[AdminChat] Failed to restore chat session cache:', error);
            return false;
        }
    }

    persistChatSessionCache() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const sessions = Array.isArray(this.chatSessions)
                ? this.chatSessions.map((session) => this.serializeChatSessionForCache(session)).filter(Boolean)
                : [];
            window.localStorage.setItem(this.getChatSessionCacheStorageKey(), JSON.stringify({
                updatedAt: new Date().toISOString(),
                sessions
            }));
        } catch (error) {
            console.warn('[AdminChat] Failed to persist chat session cache:', error);
        }
    }

    restoreOpsAlertReadReceipts() {
        this.opsAlertReadReceipts = new Map();
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const rawValue = window.localStorage.getItem(this.getOpsAlertReadReceiptStorageKey());
            if (!rawValue) return;
            const parsed = JSON.parse(rawValue);
            const entries = Array.isArray(parsed)
                ? parsed.map((id) => [id, new Date().toISOString()])
                : Object.entries(parsed?.receipts || parsed || {});

            entries.forEach(([id, readAt]) => {
                const normalizedId = String(id || '').trim();
                const normalizedReadAt = String(readAt || '').trim();
                if (!normalizedId || !Number.isFinite(Date.parse(normalizedReadAt))) {
                    return;
                }
                this.opsAlertReadReceipts.set(normalizedId, normalizedReadAt);
            });
        } catch (error) {
            console.warn('[AdminChat] Failed to restore ops alert read receipts:', error);
        }
    }

    persistOpsAlertReadReceipts() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const receipts = Object.fromEntries(
                Array.from(this.opsAlertReadReceipts.entries())
                    .slice(-1000)
            );
            window.localStorage.setItem(this.getOpsAlertReadReceiptStorageKey(), JSON.stringify({
                updatedAt: new Date().toISOString(),
                receipts
            }));
        } catch (error) {
            console.warn('[AdminChat] Failed to persist ops alert read receipts:', error);
        }
    }

    restorePendingPaymentReadReceipts() {
        this.pendingPaymentReadReceipts = new Map();
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const rawValue = window.localStorage.getItem(this.getPendingPaymentReadReceiptStorageKey());
            if (!rawValue) return;
            const parsed = JSON.parse(rawValue);
            const entries = Array.isArray(parsed)
                ? parsed.map((id) => [id, new Date().toISOString()])
                : Object.entries(parsed?.receipts || parsed || {});

            entries.forEach(([id, readAt]) => {
                const normalizedId = String(id || '').trim();
                const normalizedReadAt = String(readAt || '').trim();
                if (!normalizedId || !Number.isFinite(Date.parse(normalizedReadAt))) {
                    return;
                }
                this.pendingPaymentReadReceipts.set(normalizedId, normalizedReadAt);
            });
        } catch (error) {
            console.warn('[AdminChat] Failed to restore pending payment read receipts:', error);
        }
    }

    persistPendingPaymentReadReceipts() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const receipts = Object.fromEntries(
                Array.from(this.pendingPaymentReadReceipts.entries())
                    .slice(-1000)
            );
            window.localStorage.setItem(this.getPendingPaymentReadReceiptStorageKey(), JSON.stringify({
                updatedAt: new Date().toISOString(),
                receipts
            }));
        } catch (error) {
            console.warn('[AdminChat] Failed to persist pending payment read receipts:', error);
        }
    }

    normalizeSessionQueueView(value = 'all') {
        const normalized = String(value || 'all').trim() || 'all';
        const allowed = new Set(['all', 'priority', 'ticket_followup', 'payment_verify']);
        return allowed.has(normalized) ? normalized : 'all';
    }

    normalizeSessionQueueFilter(value = 'all') {
        const normalized = String(value || 'all').trim() || 'all';
        const allowed = new Set(['all', 'reply', 'stale_reply', 'ticket', 'verification']);
        return allowed.has(normalized) ? normalized : 'all';
    }

    getSessionQueueViewLabel(value = 'all') {
        const labels = {
            all: '全部视图',
            priority: '高优先',
            ticket_followup: '售后值守',
            payment_verify: '支付/验证'
        };
        return labels[this.normalizeSessionQueueView(value)] || '全部视图';
    }

    getSessionQueueFilterLabel(value = 'all') {
        const labels = {
            all: '全部',
            reply: '待回复',
            stale_reply: '久未回复',
            ticket: '工单中',
            verification: '验证异常'
        };
        return labels[this.normalizeSessionQueueFilter(value)] || '全部';
    }

    getUserContextPanelSummaryText(context = {}) {
        const items = this.getUserContextHeaderStatusItems(context);
        if (items.length) {
            return items.map((item) => `${item.label} ${item.value}`).join(' · ');
        }

        const summaryParts = [];
        if (context.accountState) {
            summaryParts.push(String(context.accountState).trim());
        }

        const counts = [
            { label: '订单', value: Array.isArray(context.orders) ? context.orders.length : 0 },
            { label: '充值', value: Array.isArray(context.payments) ? context.payments.length : 0 },
            { label: '验证', value: Array.isArray(context.verifications) ? context.verifications.length : 0 },
            { label: '工单', value: Array.isArray(context.tickets) ? context.tickets.length : 0 }
        ]
            .filter((item) => item.value > 0)
            .slice(0, 3)
            .map((item) => `${item.label} ${item.value}`);

        if (counts.length) {
            summaryParts.push(...counts);
        }

        return summaryParts.join(' · ') || '账号、订单、充值与工单概览';
    }

    setUserContextPanelCollapsed(collapsed = false) {
        this.userContextPanelCollapsed = Boolean(collapsed);

        const shell = document.querySelector('#chatContextPanel .user-context-shell');
        const toggle = document.querySelector('#chatContextPanel #userContextPanelToggle');
        const toggleText = toggle?.querySelector('.user-context-shell__toggle-text');

        if (shell) {
            shell.classList.toggle('is-collapsed', this.userContextPanelCollapsed);
        }

        if (toggle) {
            toggle.setAttribute('aria-expanded', this.userContextPanelCollapsed ? 'false' : 'true');
            toggle.setAttribute('title', this.userContextPanelCollapsed ? '展开 360 信息' : '收起 360 信息');
        }

        if (toggleText) {
            toggleText.textContent = this.userContextPanelCollapsed ? '展开' : '收起';
        }

        this.updateChatContextPanelLayout();
    }

    updateChatContextPanelLayout() {
        const interfaceEl = document.getElementById('chatInterface');
        const headerEl = interfaceEl?.querySelector('.chat-main-header');
        const inputWrapper = interfaceEl?.querySelector('#chatInputWrapper');
        const replyBar = interfaceEl?.querySelector('#chatReplyTemplateBar');
        const messagesArea = interfaceEl?.querySelector('#adminMessagesArea');
        const contextPanel = interfaceEl?.querySelector('#chatContextPanel');
        const contextShell = contextPanel?.querySelector('.user-context-shell');
        if (!interfaceEl || !headerEl) return;

        const topOffset = (headerEl.offsetHeight || 0) + 8;
        interfaceEl.style.setProperty('--chat-context-panel-top', `${topOffset}px`);

        const replyBottom = (inputWrapper?.offsetHeight || 0) + 10;
        interfaceEl.style.setProperty('--chat-reply-templates-bottom', `${replyBottom}px`);

        const replyHeight = replyBar && !replyBar.hidden ? (replyBar.offsetHeight || 0) : 0;
        const replySpacer = replyHeight ? replyHeight + 14 : 0;
        interfaceEl.style.setProperty('--chat-reply-templates-height', `${replySpacer}px`);

        let contextSpacer = 0;
        if (contextPanel && !contextPanel.hidden) {
            contextSpacer = Math.max(0, contextPanel.offsetHeight || 0);
        }
        interfaceEl.style.setProperty('--chat-context-panel-collapsed-height', `${contextSpacer}px`);

        if (messagesArea) {
            messagesArea.classList.toggle('chat-messages-area--reply-floating', replySpacer > 0);
            messagesArea.classList.toggle('chat-messages-area--context-collapsed', contextSpacer > 0);
        }
    }

    getScrollbarAutoHideTargets(root = document) {
        const selectors = [
            '#sessionList',
            '#chatSidebarInsightsBody',
            '#adminMessagesArea',
            '.user-context-shell__body-inner'
        ].join(', ');

        const targets = [];
        if (root instanceof Element && root.matches(selectors)) {
            targets.push(root);
        }

        if (root instanceof Element || root instanceof DocumentFragment || root === document) {
            targets.push(...root.querySelectorAll(selectors));
        }

        return targets;
    }

    markScrollbarActive(target) {
        if (!(target instanceof HTMLElement)) return;

        target.classList.add(this.chatScrollbarAutoHideVisibleClass);
        if (target.__adminChatScrollbarHideTimer) {
            window.clearTimeout(target.__adminChatScrollbarHideTimer);
        }

        target.__adminChatScrollbarHideTimer = window.setTimeout(() => {
            target.classList.remove(this.chatScrollbarAutoHideVisibleClass);
            target.__adminChatScrollbarHideTimer = null;
        }, 720);
    }

    bindScrollbarAutoHide(target) {
        if (!(target instanceof HTMLElement)) return;
        if (target.getAttribute(this.chatScrollbarAutoHideBoundAttr) === '1') return;

        target.setAttribute(this.chatScrollbarAutoHideBoundAttr, '1');
        target.classList.add(this.chatScrollbarAutoHideClass);
        target.addEventListener('mouseenter', () => this.markScrollbarActive(target), { passive: true });
        target.addEventListener('focusin', () => this.markScrollbarActive(target), { passive: true });
        target.addEventListener('scroll', () => this.markScrollbarActive(target), { passive: true });
    }

    initScrollbarAutoHide(root = document) {
        const targets = this.getScrollbarAutoHideTargets(root);
        for (const target of targets) {
            this.bindScrollbarAutoHide(target);
        }
    }

    formatSessionQueueModeLabel(view = 'all', filter = 'all') {
        const normalizedView = this.normalizeSessionQueueView(view);
        const normalizedFilter = this.normalizeSessionQueueFilter(filter);
        const viewLabel = this.getSessionQueueViewLabel(normalizedView);
        if (normalizedFilter === 'all') {
            return viewLabel;
        }
        return `${viewLabel} / ${this.getSessionQueueFilterLabel(normalizedFilter)}`;
    }

    restoreSessionQueuePreferences() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const rawValue = window.localStorage.getItem(this.getSessionQueuePreferenceStorageKey());
            if (!rawValue) return;
            const parsed = JSON.parse(rawValue);
            const lastView = this.normalizeSessionQueueView(parsed?.lastView ?? parsed?.view);
            const lastFilter = this.normalizeSessionQueueFilter(parsed?.lastFilter ?? parsed?.filter);
            this.sessionQueueView = lastView;
            this.sessionQueueFilter = lastFilter;
            this.sessionQueueDefaultView = this.normalizeSessionQueueView(parsed?.defaultView ?? lastView);
            this.sessionQueueDefaultFilter = this.normalizeSessionQueueFilter(parsed?.defaultFilter ?? lastFilter);
        } catch (error) {
            console.warn('[AdminChat] Failed to restore session queue preferences:', error);
        }
    }

    restoreSidebarInsightsPreference() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const rawValue = window.localStorage.getItem(this.getSidebarInsightsPreferenceStorageKey());
            if (!rawValue) return;
            const parsed = JSON.parse(rawValue);
            this.sidebarInsightsCollapsed = parsed?.collapsed !== false;
        } catch (error) {
            console.warn('[AdminChat] Failed to restore sidebar insights preference:', error);
        }
    }

    persistSidebarInsightsPreference() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            window.localStorage.setItem(this.getSidebarInsightsPreferenceStorageKey(), JSON.stringify({
                collapsed: this.sidebarInsightsCollapsed !== false
            }));
        } catch (error) {
            console.warn('[AdminChat] Failed to persist sidebar insights preference:', error);
        }
    }

    persistSessionQueuePreferences({ saveAsDefault = false } = {}) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const lastView = this.normalizeSessionQueueView(this.sessionQueueView);
            const lastFilter = this.normalizeSessionQueueFilter(this.sessionQueueFilter);
            const defaultView = saveAsDefault
                ? lastView
                : this.normalizeSessionQueueView(this.sessionQueueDefaultView || lastView);
            const defaultFilter = saveAsDefault
                ? lastFilter
                : this.normalizeSessionQueueFilter(this.sessionQueueDefaultFilter || lastFilter);
            this.sessionQueueDefaultView = defaultView;
            this.sessionQueueDefaultFilter = defaultFilter;
            window.localStorage.setItem(this.getSessionQueuePreferenceStorageKey(), JSON.stringify({
                lastView,
                lastFilter,
                defaultView,
                defaultFilter,
                updatedAt: new Date().toISOString()
            }));
        } catch (error) {
            console.warn('[AdminChat] Failed to persist session queue preferences:', error);
        }
    }

    getSidebarInsightsSummary(snapshot = null) {
        if (this.isSessionBootstrapPending && !(Array.isArray(this.chatSessions) && this.chatSessions.length)) {
            return '正在加载会话...';
        }

        const sourceSnapshot = snapshot || this.getSessionQueueBacklogSnapshot();
        if (!sourceSnapshot || typeof sourceSnapshot !== 'object') {
            return '正在整理当前队列...';
        }

        const parts = [];
        if (Number(sourceSnapshot.openTickets || 0) > 0) {
            parts.push(`工单中 ${sourceSnapshot.openTickets}`);
        }
        if (Number(sourceSnapshot.pendingReply || 0) > 0) {
            parts.push(`待回复 ${sourceSnapshot.pendingReply}`);
        }
        if (Number(sourceSnapshot.staleReply || 0) > 0) {
            parts.push(`久未回复 ${sourceSnapshot.staleReply}`);
        }
        if (Number(sourceSnapshot.verificationAlerts || 0) > 0) {
            parts.push(`验证异常 ${sourceSnapshot.verificationAlerts}`);
        }
        return parts.length ? parts.slice(0, 2).join(' · ') : '当前队列比较平稳';
    }

    setSidebarInsightsCollapsed(collapsed = false) {
        this.sidebarInsightsCollapsed = collapsed !== false;
        this.persistSidebarInsightsPreference();
        this.updateSidebarInsightsShell();
    }

    updateSidebarInsightsShell(snapshot = null) {
        const shell = document.getElementById('chatSidebarInsights');
        const toggle = document.getElementById('chatSidebarInsightsToggle');
        const summary = document.getElementById('chatSidebarInsightsSummary');
        if (!shell || !toggle) {
            return;
        }

        const collapsed = this.sidebarInsightsCollapsed !== false;
        shell.classList.toggle('is-collapsed', collapsed);
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.setAttribute('title', collapsed ? '展开值班概览' : '收起值班概览');

        const toggleText = toggle.querySelector('.chat-sidebar-insights__toggle-text');
        if (toggleText) {
            toggleText.textContent = collapsed ? '展开' : '收起';
        }

        if (summary) {
            summary.textContent = this.getSidebarInsightsSummary(snapshot);
        }
    }

    syncCurrentSessionFromSessions() {
        if (!this.currentSessionKey) {
            return;
        }

        const refreshedSession = this.sessions.find((item) => item.sessionId === this.currentSessionKey) || null;
        if (!refreshedSession) {
            return;
        }

        this.currentSessionInfo = refreshedSession;
        this.currentSessionIds = Array.isArray(refreshedSession.sessionIds) && refreshedSession.sessionIds.length
            ? refreshedSession.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
            : [String(refreshedSession.sessionId || '').trim()].filter(Boolean);

        if (!this.isOpsAlertSession(refreshedSession)) {
            this.currentSessionId = this.currentSessionIds[0] || this.currentSessionKey;
        }
    }

    startBackgroundServices() {
        if (this.backgroundServicesStarted || this.destroyed) {
            return;
        }

        this.backgroundServicesStarted = true;
        this.subscribeToRealtime();
        this.startSessionSlaTicker();
    }

    scheduleDeferredSessionHydration() {
        if (this.destroyed || this.sessionDeferredHydrationPromise || this.sessionDeferredHydrationHandle) {
            return;
        }

        const runHydration = () => {
            this.sessionDeferredHydrationHandle = null;
            this.sessionDeferredHydrationPromise = this.hydrateSessionSidebarData()
                .catch((error) => {
                    console.warn('[AdminChat] Deferred session hydration failed:', error);
                })
                .finally(() => {
                    this.sessionDeferredHydrationPromise = null;
                });
        };

        if (typeof window.requestIdleCallback === 'function') {
            this.sessionDeferredHydrationHandle = {
                type: 'idle',
                id: window.requestIdleCallback(runHydration, { timeout: 900 })
            };
            return;
        }

        this.sessionDeferredHydrationHandle = {
            type: 'timeout',
            id: window.setTimeout(runHydration, 140)
        };
    }

    scheduleSessionHistoryConsistencySync() {
        if (this.destroyed || this.sessionHistoryConsistencyPromise || this.sessionHistoryConsistencyHandle) {
            return;
        }

        const runSync = () => {
            this.sessionHistoryConsistencyHandle = null;
            this.sessionHistoryConsistencyPromise = this.syncSessionsWithCompleteHistory()
                .catch((error) => {
                    console.warn('[AdminChat] Complete history session sync failed:', error);
                })
                .finally(() => {
                    this.sessionHistoryConsistencyPromise = null;
                });
        };

        if (typeof window.requestIdleCallback === 'function') {
            this.sessionHistoryConsistencyHandle = {
                type: 'idle',
                id: window.requestIdleCallback(runSync, { timeout: 1600 })
            };
            return;
        }

        this.sessionHistoryConsistencyHandle = {
            type: 'timeout',
            id: window.setTimeout(runSync, 520)
        };
    }

    isSessionQueueUsingDefaultView() {
        return this.normalizeSessionQueueView(this.sessionQueueView) === this.normalizeSessionQueueView(this.sessionQueueDefaultView)
            && this.normalizeSessionQueueFilter(this.sessionQueueFilter) === this.normalizeSessionQueueFilter(this.sessionQueueDefaultFilter);
    }

    restoreSessionQueueDefaultView() {
        this.sessionQueueView = this.normalizeSessionQueueView(this.sessionQueueDefaultView);
        this.sessionQueueFilter = this.normalizeSessionQueueFilter(this.sessionQueueDefaultFilter);
        this.persistSessionQueuePreferences();
        this.renderSessionQueueControls();
        this.renderSessionList(this.searchQuery);
    }

    saveCurrentSessionQueueAsDefault() {
        this.persistSessionQueuePreferences({ saveAsDefault: true });
        this.renderSessionQueueControls();
        this.renderSessionList(this.searchQuery);
    }

    isTicketSyncChatMessage(message = {}) {
        const messageType = String(message?.message_type || '').trim().toLowerCase();
        if (messageType === 'ticket_update') {
            return true;
        }
        return String(message?.content || '').includes('[工单处理结果同步]');
    }

    sanitizeImageUrl(url) {
        if (typeof url !== 'string' || !url.trim()) return '';

        const trimmed = url.trim();
        if (trimmed.startsWith('data:image/')) return trimmed;
        if (/^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i.test(trimmed)) return '';

        try {
            const parsed = new URL(trimmed, window.location.origin);
            if (['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
                return window.SiteConfig?.normalizeAssetUrlForCurrentSite?.(parsed.href) || parsed.href;
            }
        } catch (err) {
            console.warn('[AdminChat] Blocked unsafe image URL:', trimmed, err);
        }

        return '';
    }

    parseJsonObject(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
        if (typeof value !== 'string' || !value.trim()) {
            return {};
        }

        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    setElementHidden(element, hidden) {
        if (!element) return;
        element.hidden = hidden;
    }

    handleDocumentClick(event) {
        if (!event.target.closest('.admin-alert-toolbar-dropdown')) {
            this.closeOpsAlertToolbarDropdowns();
        }

        const emojiPicker = document.getElementById('adminEmojiPicker');
        if (!emojiPicker) return;

        if (!event.target.closest('#adminEmojiBtn') && !event.target.closest('#adminEmojiPicker')) {
            this.setElementHidden(emojiPicker, true);
        }
    }

    createImageElement(url, { alt = '', className = '' } = {}) {
        const safeUrl = this.sanitizeImageUrl(url);
        if (!safeUrl) return null;

        const img = document.createElement('img');
        img.src = safeUrl;
        img.alt = alt;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        if (className) img.className = className;
        img.addEventListener('click', () => window.open(safeUrl, '_blank', 'noopener'));
        return img;
    }

    createSessionAvatar(session, displayName) {
        const avatar = document.createElement('div');
        avatar.className = 'session-avatar';

        if (this.isOpsAlertSession(session)) {
            avatar.classList.add('session-avatar--ops');
            avatar.innerHTML = '<i class="fas fa-thumbtack session-icon" aria-hidden="true"></i>';
            return avatar;
        }

        const initialSeed = (session.nickname || session.email || session.sessionId || displayName || '?').trim();
        const defaultInitials = initialSeed.substring(0, 2).toUpperCase() || '?';

        if (session.profile?.avatar_url) {
            const img = this.createImageElement(session.profile.avatar_url, {
                alt: `${displayName || this.t('chat.user', '用户')} avatar`,
                className: 'session-avatar-image'
            });

            if (img) {
                avatar.classList.add('session-avatar--media');
                avatar.appendChild(img);
                return avatar;
            }
        }

        avatar.textContent = session.profile ? (displayName || '?').substring(0, 1).toUpperCase() : defaultInitials;
        return avatar;
    }

    async fetchChatProfiles(filterType, values = []) {
        const uniqueValues = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
        if (!uniqueValues.length || !this.supabase?.from) return [];

        const selectVariants = [
            'id, email, display_name, username, avatar_url',
            'id, email, username, avatar_url',
            'id, username, avatar_url'
        ];

        let lastError = null;

        for (const selectClause of selectVariants) {
            try {
                const { data, error } = await this.supabase
                    .from('profiles')
                    .select(selectClause)
                    .in(filterType, uniqueValues);

                if (error) {
                    lastError = error;
                    continue;
                }

                return Array.isArray(data) ? data : [];
            } catch (error) {
                lastError = error;
            }
        }

        if (lastError) {
            console.warn(`[AdminChat] Failed to fetch profiles by ${filterType}:`, lastError);
        }
        return [];
    }

    async attachSessionProfiles(sessions = []) {
        const safeSessions = Array.isArray(sessions) ? sessions : [];
        if (!safeSessions.length) {
            return [];
        }

        const userIds = [...new Set(
            safeSessions
                .map((session) => String(session?.userId || '').trim())
                .filter(Boolean)
        )];
        const emailKeys = [...new Set(
            safeSessions
                .filter((session) => !String(session?.userId || '').trim())
                .map((session) => {
                    const directEmail = String(session?.email || '').trim().toLowerCase();
                    if (directEmail && directEmail.includes('@')) {
                        return directEmail;
                    }
                    return (Array.isArray(session?.sessionIds) ? session.sessionIds : [])
                        .map((value) => String(value || '').trim().toLowerCase())
                        .find((value) => value.includes('@')) || '';
                })
                .filter(Boolean)
        )];

        const [profilesById, profilesByEmail] = await Promise.all([
            userIds.length > 0 ? this.fetchChatProfiles('id', userIds) : Promise.resolve([]),
            emailKeys.length > 0 ? this.fetchChatProfiles('email', emailKeys) : Promise.resolve([])
        ]);

        const userMapById = new Map((Array.isArray(profilesById) ? profilesById : []).map((profile) => [profile.id, profile]));
        const userMapByEmail = new Map(
            (Array.isArray(profilesByEmail) ? profilesByEmail : [])
                .filter((profile) => profile?.email)
                .map((profile) => [String(profile.email || '').toLowerCase(), profile])
        );

        const profiledSessions = safeSessions.map((session) => {
            const fallbackKey = String(session?.sessionId || '').trim();
            const sessionIds = Array.isArray(session?.sessionIds) ? session.sessionIds : [];
            const fallbackEmail = this.resolveSessionEmail(session?.profile || null, fallbackKey, sessionIds);
            const profile = session?.userId
                ? (userMapById.get(String(session.userId).trim()) || session.profile || null)
                : (userMapByEmail.get(fallbackEmail.toLowerCase()) || session.profile || null);
            const email = this.resolveSessionEmail(profile, fallbackKey, sessionIds);
            const nickname = this.resolveSessionNickname(profile, fallbackKey, email);

            return {
                ...session,
                userId: String(session?.userId || profile?.id || '').trim(),
                profile,
                email,
                nickname
            };
        });

        await this.refreshUserActivityForSessions(profiledSessions, { render: false });
        return profiledSessions;
    }

    resolveSessionEmail(profile, fallbackKey = '', sessionIds = []) {
        const email = typeof profile?.email === 'string' ? profile.email.trim() : '';
        if (email) return email;

        const normalizedFallback = typeof fallbackKey === 'string' ? fallbackKey.trim() : String(fallbackKey || '');
        if (normalizedFallback.includes('@')) return normalizedFallback;

        const emailSessionId = (Array.isArray(sessionIds) ? sessionIds : [])
            .find((id) => typeof id === 'string' && id.includes('@'));
        return emailSessionId ? emailSessionId.trim() : '';
    }

    resolveSessionNickname(profile, fallbackKey = '', preferredEmail = '') {
        const displayName = typeof profile?.display_name === 'string' ? profile.display_name.trim() : '';
        const username = typeof profile?.username === 'string' ? profile.username.trim() : '';
        const normalizedFallback = typeof fallbackKey === 'string' ? fallbackKey.trim() : String(fallbackKey || '');

        if (displayName) return displayName;
        if (username) return username;
        if (preferredEmail && preferredEmail.includes('@')) return preferredEmail.split('@')[0];
        if (normalizedFallback.includes('@')) return normalizedFallback.split('@')[0];
        return this.t('chat.guest', '访客');
    }

    getActiveSiteFilter() {
        return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
    }

    isOpsAlertSessionId(sessionId) {
        return String(sessionId || '').trim() === this.opsAlertSessionId;
    }

    isOpsAlertSession(session) {
        return session?.kind === 'ops_alerts' || this.isOpsAlertSessionId(session?.sessionId);
    }

    formatSessionTime(value) {
        if (!value) return '';
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return '';

        const now = new Date();
        const sameDay = now.getFullYear() === date.getFullYear()
            && now.getMonth() === date.getMonth()
            && now.getDate() === date.getDate();

        if (sameDay) {
            return date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        return date.toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric'
        });
    }

    formatDetailTime(value) {
        if (!value) return '未知时间';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);

        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    formatCompactCount(value) {
        const count = Number(value || 0);
        if (!Number.isFinite(count) || count <= 0) return '0';
        return count > 99 ? '99+' : String(Math.round(count));
    }

    formatUserContextDate(value) {
        if (!value) return '未知时间';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatUserContextPoints(value) {
        const points = Number(value || 0);
        if (!Number.isFinite(points)) return '0 积分';
        return `${points.toLocaleString('zh-CN')} 积分`;
    }

    formatUserContextCurrency(value, fallback = '') {
        const amount = Number(value);
        if (!Number.isFinite(amount)) {
            return fallback || '金额未知';
        }
        return `¥${amount.toLocaleString('zh-CN', {
            minimumFractionDigits: amount % 1 ? 2 : 0,
            maximumFractionDigits: 2
        })}`;
    }

    formatUserContextStatus(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        const labelMap = {
            pending: '待处理',
            open: '待处理',
            resolved: '已解决',
            rejected: '已拒绝',
            paid: '已支付',
            succeeded: '已成功',
            success: '成功',
            failed: '失败',
            delivered: '已交付',
            processing: '处理中',
            queued: '排队中',
            retry_waiting: '重试中',
            refunded: '已退款'
        };
        return labelMap[normalized] || (normalized ? normalized.toUpperCase() : '未知');
    }

    isOpenTicketStatus(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        if (!normalized) return false;
        return !['resolved', 'rejected'].includes(normalized);
    }

    buildSessionTicketSummaryMap(rows = []) {
        const summaryMap = new Map();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const userId = String(row?.user_id || '').trim();
            if (!userId) return;

            let summary = summaryMap.get(userId);
            if (!summary) {
                summary = {
                    openCount: 0,
                    latestOpenTicket: null
                };
                summaryMap.set(userId, summary);
            }

            if (!this.isOpenTicketStatus(row.status)) {
                return;
            }

            summary.openCount += 1;
            if (!summary.latestOpenTicket) {
                summary.latestOpenTicket = row;
            }
        });

        for (const [userId, summary] of summaryMap.entries()) {
            if (!summary.openCount || !summary.latestOpenTicket) {
                summaryMap.delete(userId);
            }
        }

        return summaryMap;
    }

    async fetchSessionTicketSummaryMap(userIds = []) {
        const uniqueUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
        if (!uniqueUserIds.length || !this.supabase?.from) {
            return new Map();
        }

        try {
            const { data, error } = await this.supabase
                .from('shop_tickets')
                .select('id, user_id, status, description, created_at')
                .in('user_id', uniqueUserIds)
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            return this.buildSessionTicketSummaryMap(data || []);
        } catch (error) {
            console.warn('[AdminChat] Failed to fetch session ticket summaries:', error);
            return new Map();
        }
    }

    buildSessionLatestRecordMap(rows = [], userIdField = 'user_id') {
        const latestMap = new Map();

        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const userId = String(row?.[userIdField] || '').trim();
            if (!userId || latestMap.has(userId)) {
                return;
            }
            latestMap.set(userId, row);
        });

        return latestMap;
    }

    async fetchSessionPaymentSummaryMap(userIds = []) {
        const uniqueUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
        if (!uniqueUserIds.length || !this.supabase?.from) {
            return new Map();
        }

        try {
            const { data, error } = await this.supabase
                .from('payment_orders')
                .select('id, user_id, status, package_name, paid_amount, expected_amount, created_at')
                .in('user_id', uniqueUserIds)
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            return this.buildSessionLatestRecordMap(data || []);
        } catch (error) {
            console.warn('[AdminChat] Failed to fetch session payment summaries:', error);
            return new Map();
        }
    }

    async fetchSessionVerificationSummaryMap(userIds = []) {
        const uniqueUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
        if (!uniqueUserIds.length || !this.supabase?.from) {
            return new Map();
        }

        try {
            const { data, error } = await this.supabase
                .from('verification_logs')
                .select('verification_id, user_id, status, message, created_at')
                .in('user_id', uniqueUserIds)
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            return this.buildSessionLatestRecordMap(data || []);
        } catch (error) {
            console.warn('[AdminChat] Failed to fetch session verification summaries:', error);
            return new Map();
        }
    }

    getSessionPaymentSignal(summary = null) {
        const latestPayment = summary || null;
        if (!latestPayment) return null;

        const status = String(latestPayment.status || '').trim().toLowerCase();
        if (!status) return null;
        if (['paid', 'succeeded', 'success', 'refunded'].includes(status)) {
            return null;
        }

        const dangerStatuses = ['failed', 'rejected', 'cancelled', 'canceled', 'expired', 'closed'];
        if (dangerStatuses.includes(status)) {
            return {
                key: 'payment',
                label: '支付异常',
                subtext: `支付${this.formatUserContextStatus(status)}`,
                score: 50,
                badgeClass: 'session-badge--danger'
            };
        }

        const processingStatuses = ['pending', 'processing', 'queued', 'retry_waiting', 'created', 'waiting', 'open', 'unpaid'];
        if (processingStatuses.includes(status)) {
            if (this.isPendingPaymentRead(latestPayment)) {
                return null;
            }
            return {
                key: 'payment',
                label: '待支付',
                subtext: `支付${this.formatUserContextStatus(status)}`,
                score: 45,
                badgeClass: 'session-badge--warning'
            };
        }

        return null;
    }

    isPendingPaymentStatus(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        return ['pending', 'processing', 'queued', 'retry_waiting', 'created', 'waiting', 'open', 'unpaid'].includes(normalized);
    }

    getPendingPaymentReadIdentity(payment = {}) {
        const paymentId = String(payment?.id || '').trim();
        if (paymentId) return `payment:${paymentId}`;
        return [
            'payment',
            String(payment?.user_id || '').trim(),
            String(payment?.status || '').trim().toLowerCase(),
            String(payment?.created_at || '').trim(),
            String(payment?.package_name || '').trim(),
            String(payment?.expected_amount || '').trim()
        ].join(':');
    }

    isPendingPaymentRead(payment = {}) {
        const identity = this.getPendingPaymentReadIdentity(payment);
        return Boolean(identity && this.pendingPaymentReadReceipts.has(identity));
    }

    getPendingPaymentReadTarget(context = {}) {
        return (Array.isArray(context.payments) ? context.payments : [])
            .find((payment) => this.isPendingPaymentStatus(payment?.status) && !this.isPendingPaymentRead(payment)) || null;
    }

    markPendingPaymentRead(payment = {}, context = {}) {
        const identity = this.getPendingPaymentReadIdentity(payment);
        if (!identity) {
            window.showToast?.('未找到可标记的待支付记录', 'warning');
            return false;
        }

        const readAt = new Date().toISOString();
        this.pendingPaymentReadReceipts.set(identity, readAt);
        this.persistPendingPaymentReadReceipts();

        const updatePayment = (item = {}) => (
            this.getPendingPaymentReadIdentity(item) === identity
                ? { ...item, support_read_at: readAt }
                : item
        );

        if (context.cacheKey) {
            const nextContext = {
                ...context,
                payments: (Array.isArray(context.payments) ? context.payments : []).map(updatePayment)
            };
            this.userContextCache.set(context.cacheKey, nextContext);
            this.currentUserContext = nextContext;
            this.renderUser360Context(nextContext);
        }

        this.chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []).map((session) => {
            const paymentSummary = session.paymentSummary && typeof session.paymentSummary === 'object'
                ? updatePayment(session.paymentSummary)
                : session.paymentSummary;
            return paymentSummary === session.paymentSummary ? session : { ...session, paymentSummary };
        });
        this.composeSessions();
        this.renderSessionQueueControls();
        this.renderSessionList(this.searchQuery);
        window.showToast?.('已将这笔待支付标记为已读', 'success');
        return true;
    }

    getSessionVerificationSignal(summary = null) {
        const latestVerification = summary || null;
        if (!latestVerification) return null;

        const status = String(latestVerification.status || '').trim().toLowerCase();
        if (!status) return null;
        if (['success', 'succeeded', 'resolved', 'completed', 'done', 'paid'].includes(status)) {
            return null;
        }

        const dangerStatuses = ['failed', 'error', 'dead', 'rejected', 'cancelled', 'timeout', 'exception'];
        if (dangerStatuses.some((token) => status.includes(token))) {
            return {
                key: 'verification',
                label: '验证异常',
                subtext: `验证${this.formatUserContextStatus(status)}`,
                score: 80,
                badgeClass: 'session-badge--danger'
            };
        }

        const processingStatuses = ['pending', 'processing', 'queued', 'retry', 'running', 'waiting'];
        if (processingStatuses.some((token) => status.includes(token))) {
            return {
                key: 'verification',
                label: '验证中',
                subtext: `验证${this.formatUserContextStatus(status)}`,
                score: 55,
                badgeClass: 'session-badge--warning'
            };
        }

        return null;
    }

    getSessionPrioritySignals(session = {}) {
        const signals = [];
        const ticketBadge = this.getSessionListTicketBadge(session.ticketSummary);
        const ticketSubtext = this.getSessionListTicketSubtext(session.ticketSummary);
        if (ticketBadge) {
            signals.push({
                key: 'ticket',
                label: ticketBadge,
                subtext: ticketSubtext,
                score: 100 + Number(session?.ticketSummary?.openCount || 0),
                badgeClass: 'session-badge--ticket'
            });
        }

        const verificationSignal = this.getSessionVerificationSignal(session.verificationSummary);
        if (verificationSignal) {
            signals.push(verificationSignal);
        }

        const paymentSignal = this.getSessionPaymentSignal(session.paymentSummary);
        if (paymentSignal) {
            signals.push(paymentSignal);
        }

        if (session.replySummary?.pending) {
            signals.push({
                key: 'reply',
                label: session.replySummary.label,
                subtext: session.replySummary.subtext,
                score: Number(session.replySummary.score || 0),
                badgeClass: session.replySummary.badgeClass || 'session-badge--warning'
            });
        }

        return signals.sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
    }

    async attachSessionOperationalSummaries(sessions = []) {
        const userIds = (Array.isArray(sessions) ? sessions : []).map((session) => session?.userId);
        const [ticketSummaryMap, paymentSummaryMap, verificationSummaryMap] = await Promise.all([
            this.fetchSessionTicketSummaryMap(userIds),
            this.fetchSessionPaymentSummaryMap(userIds),
            this.fetchSessionVerificationSummaryMap(userIds)
        ]);

        return (Array.isArray(sessions) ? sessions : []).map((session) => {
            const userId = String(session?.userId || '').trim();
            return {
                ...session,
                ticketSummary: userId ? (ticketSummaryMap.get(userId) || null) : null,
                paymentSummary: userId ? (paymentSummaryMap.get(userId) || null) : null,
                verificationSummary: userId ? (verificationSummaryMap.get(userId) || null) : null
            };
        });
    }

    async refreshSessionOperationalSummariesForUserIds(userIds = []) {
        const uniqueUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
        if (!uniqueUserIds.length) {
            return;
        }

        const [ticketSummaryMap, paymentSummaryMap, verificationSummaryMap] = await Promise.all([
            this.fetchSessionTicketSummaryMap(uniqueUserIds),
            this.fetchSessionPaymentSummaryMap(uniqueUserIds),
            this.fetchSessionVerificationSummaryMap(uniqueUserIds)
        ]);
        const touchedUserIds = new Set(uniqueUserIds);

        this.chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []).map((session) => {
            const userId = String(session?.userId || '').trim();
            if (!touchedUserIds.has(userId)) {
                return session;
            }
            return {
                ...session,
                ticketSummary: ticketSummaryMap.get(userId) || null,
                paymentSummary: paymentSummaryMap.get(userId) || null,
                verificationSummary: verificationSummaryMap.get(userId) || null
            };
        });

        this.composeSessions();
        this.persistChatSessionCache();
        this.renderSessionQueueControls();
        this.renderSessionList(this.searchQuery);
    }

    async attachSessionTicketSummaries(sessions = []) {
        return this.attachSessionOperationalSummaries(sessions);
    }

    async refreshSessionTicketSummariesForUserIds(userIds = []) {
        return this.refreshSessionOperationalSummariesForUserIds(userIds);
    }

    getSessionListTicketBadge(summary = null) {
        const openCount = Number(summary?.openCount || 0);
        if (!Number.isFinite(openCount) || openCount <= 0) return '';
        return openCount > 1 ? `${openCount}工单` : '工单中';
    }

    getSessionListTicketSubtext(summary = null) {
        const latestTicket = summary?.latestOpenTicket;
        if (!latestTicket) return '';
        const statusText = this.formatUserContextStatus(latestTicket.status || 'pending');
        const countText = Number(summary?.openCount || 0) > 1 ? ` · ${summary.openCount}条未结` : '';
        return `售后${statusText}${countText}`;
    }

    formatSessionReplyWaitAge(waitMinutes = 0) {
        const minutes = Math.max(1, Number(waitMinutes || 0));
        if (minutes < 60) {
            return `${minutes}分钟前`;
        }

        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours}小时前`;
        }

        const days = Math.floor(hours / 24);
        return `${days}天前`;
    }

    buildSessionReplySummary(lastUserMessageAt = '', lastAdminMessageAt = '') {
        const lastUserTs = lastUserMessageAt ? Date.parse(lastUserMessageAt) : NaN;
        if (!Number.isFinite(lastUserTs)) {
            return null;
        }

        const lastAdminTs = lastAdminMessageAt ? Date.parse(lastAdminMessageAt) : NaN;
        const pending = !Number.isFinite(lastAdminTs) || lastUserTs > lastAdminTs;
        if (!pending) {
            return null;
        }

        const waitMinutes = Math.max(1, Math.floor((Date.now() - lastUserTs) / 60000));
        if (waitMinutes < 5) {
            return null;
        }

        const isDanger = waitMinutes >= 60;
        return {
            pending: true,
            waitMinutes,
            label: isDanger ? '久未回复' : '待回复',
            subtext: `${this.formatSessionReplyWaitAge(waitMinutes)}待回复`,
            score: isDanger ? 85 : (waitMinutes >= 15 ? 65 : 25),
            badgeClass: isDanger ? 'session-badge--danger' : 'session-badge--warning'
        };
    }

    refreshSessionReplySummaries() {
        this.chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []).map((session) => ({
            ...session,
            replySummary: this.buildSessionReplySummary(session.lastUserMessageAt, session.lastAdminMessageAt)
        }));

        this.composeSessions();
        this.persistChatSessionCache();
        this.renderSessionList(this.searchQuery);
    }

    startSessionSlaTicker() {
        if (this.sessionSlaTimer) {
            return;
        }

        this.sessionSlaTimer = window.setInterval(() => {
            this.refreshSessionReplySummaries();
        }, 60000);
    }

    getSessionQueueFilterOptions() {
        const chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []);
        return [
            { value: 'all', label: '全部', count: chatSessions.length },
            { value: 'reply', label: '待回复', count: chatSessions.filter((session) => session.replySummary?.pending).length },
            { value: 'stale_reply', label: '久未回复', count: chatSessions.filter((session) => Number(session.replySummary?.waitMinutes || 0) >= 60).length },
            { value: 'ticket', label: '工单中', count: chatSessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length },
            { value: 'verification', label: '验证异常', count: chatSessions.filter((session) => Boolean(this.getSessionVerificationSignal(session.verificationSummary))).length }
        ];
    }

    isHighPrioritySession(session = {}) {
        const maxScore = this.getSessionPrioritySignals(session)
            .reduce((score, signal) => Math.max(score, Number(signal?.score || 0)), 0);
        return maxScore >= 45;
    }

    getSessionQueueOverviewCards() {
        const chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []);
        return [
            { value: 'all', label: '全部会话', count: chatSessions.length, hint: '当前队列' },
            { value: 'reply', label: '待回复', count: chatSessions.filter((session) => session.replySummary?.pending).length, hint: '需要跟进' },
            { value: 'stale_reply', label: '久未回复', count: chatSessions.filter((session) => Number(session.replySummary?.waitMinutes || 0) >= 60).length, hint: '优先处理' },
            { value: 'ticket', label: '工单中', count: chatSessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length, hint: '售后处理中' },
            { value: 'verification', label: '验证异常', count: chatSessions.filter((session) => Boolean(this.getSessionVerificationSignal(session.verificationSummary))).length, hint: '需要排查' }
        ];
    }

    renderSessionQueueOverview() {
        const container = document.getElementById('sessionQueueOverview');
        if (!container) return;

        const cards = this.getSessionQueueOverviewCards();
        container.replaceChildren();

        cards.forEach((card) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `session-queue-card${this.sessionQueueView === 'all' && this.sessionQueueFilter === card.value ? ' is-active' : ''}`;
            button.setAttribute('data-session-stat-filter', card.value);
            button.innerHTML = `
                <span class="session-queue-card__value">${card.count}</span>
                <span class="session-queue-card__label">${card.label}</span>
                <span class="session-queue-card__hint">${card.hint}</span>
            `;
            container.appendChild(button);
        });
    }

    getSessionQueueViewOptions() {
        const chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []);
        return [
            { value: 'all', label: '全部视图', count: chatSessions.length },
            { value: 'priority', label: '高优先', count: chatSessions.filter((session) => this.isHighPrioritySession(session)).length },
            { value: 'ticket_followup', label: '售后值守', count: chatSessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length },
            {
                value: 'payment_verify',
                label: '支付/验证',
                count: chatSessions.filter((session) => Boolean(
                    this.getSessionPaymentSignal(session.paymentSummary)
                    || this.getSessionVerificationSignal(session.verificationSummary)
                )).length
            }
        ];
    }

    buildSessionQueueSnapshot({ view = 'all', filter = 'all', respectSearch = false } = {}) {
        const normalizedView = this.normalizeSessionQueueView(view);
        const normalizedFilter = this.normalizeSessionQueueFilter(filter);
        const searchQuery = respectSearch ? this.searchQuery : '';
        const sessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => this.matchesSessionQueueViewMode(session, normalizedView))
            .filter((session) => this.matchesSessionQueueFilterMode(session, normalizedFilter, normalizedView))
            .filter((session) => this.sessionMatchesFilter(session, searchQuery));
        const chatSessions = sessions.filter((session) => !this.isOpsAlertSession(session));

        const pendingReply = chatSessions.filter((session) => session.replySummary?.pending).length;
        const staleReply = chatSessions.filter((session) => Number(session.replySummary?.waitMinutes || 0) >= 60).length;
        const highPriority = chatSessions.filter((session) => this.isHighPrioritySession(session)).length;
        const openTickets = chatSessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length;
        const verificationAlerts = chatSessions.filter((session) => Boolean(this.getSessionVerificationSignal(session.verificationSummary))).length;
        const paymentFollowups = chatSessions.filter((session) => Boolean(this.getSessionPaymentSignal(session.paymentSummary))).length;
        const topWait = chatSessions
            .map((session) => Number(session.replySummary?.waitMinutes || 0))
            .filter((value) => value > 0)
            .sort((left, right) => right - left)[0] || 0;

        return {
            view: normalizedView,
            filter: normalizedFilter,
            total: chatSessions.length,
            pendingReply,
            staleReply,
            highPriority,
            openTickets,
            verificationAlerts,
            paymentFollowups,
            specializedLoad: verificationAlerts + paymentFollowups,
            topWait
        };
    }

    getSessionQueueSnapshot() {
        return this.buildSessionQueueSnapshot({
            view: this.sessionQueueView,
            filter: this.sessionQueueFilter,
            respectSearch: true
        });
    }

    getSessionQueueBacklogSnapshot() {
        return this.buildSessionQueueSnapshot({
            view: 'all',
            filter: 'all',
            respectSearch: false
        });
    }

    getCommandCenterRecentItems() {
        const buildOpsAlertRecentAction = (alert = {}) => {
            const alertId = String(alert?.id || alert?.created_at || 'ops-alert').trim() || 'ops-alert';
            const workspace = alert?.workspace && typeof alert.workspace === 'object' ? alert.workspace : {};
            const workspaceContext = workspace.context && typeof workspace.context === 'object' ? workspace.context : {};
            const workspaceKind = String(workspace.kind || '').trim().toLowerCase();
            const workspaceKey = String(workspace.workspaceKey || '').trim().toLowerCase();
            const actionLabel = this.getOpsAlertActionLabel(alert);

            if (workspaceKind === 'chat-session') {
                const sessionId = String(
                    workspaceContext.sessionId
                    || workspaceContext.session_id
                    || alert?.sessionId
                    || alert?.session_id
                    || ''
                ).trim();
                if (sessionId) {
                    return {
                        moduleId: 'chat',
                        stateKey: `notifications-alert-${alertId}`,
                        feedbackLabel: '系统告警',
                        intent: '打开这条告警关联的消息会话。',
                        context: {
                            payload: {
                                sessionId
                            }
                        }
                    };
                }
            }

            if (workspaceKind === 'shop-orders') {
                return {
                    moduleId: 'ops-workspace',
                    stateKey: `notifications-alert-${alertId}`,
                    feedbackLabel: actionLabel || '查看订单',
                    intent: '打开这条告警关联的订单处理位。',
                    context: {
                        ...workspaceContext
                    },
                    options: {
                        workspaceKey: 'shop-risk-orders'
                    }
                };
            }

            if (workspaceKind === 'ops-workspace' && workspaceKey) {
                return {
                    moduleId: 'ops-workspace',
                    stateKey: `notifications-alert-${alertId}`,
                    feedbackLabel: actionLabel || '前往处理',
                    intent: `打开这条告警对应的${actionLabel || '处理'}工作位。`,
                    context: {
                        ...workspaceContext
                    },
                    options: {
                        workspaceKey
                    }
                };
            }

            return {
                moduleId: 'chat',
                stateKey: `notifications-alert-${alertId}`,
                feedbackLabel: '系统告警',
                intent: '打开消息中心里的系统告警流。',
                context: {
                    payload: {
                        workspace: 'ops-alerts'
                    }
                }
            };
        };

        const sessionItems = (Array.isArray(this.chatSessions) ? this.chatSessions : [])
            .filter((session) => !this.isOpsAlertSession(session))
            .map((session) => {
                const display = this.getSessionDisplayInfo(session);
                const topSignal = this.getSessionPrioritySignals(session)[0] || null;
                const sessionId = String(session?.sessionId || session?.id || '').trim();
                const timestamp = Date.parse(
                    session?.lastUserMessageAt
                    || session?.lastAdminMessageAt
                    || session?.updatedAt
                    || ''
                ) || 0;
                const preview = String(display.preview || '').trim();
                const detail = [
                    topSignal?.label || '',
                    preview || display.subtext || ''
                ].filter(Boolean).join(' · ');
                const tone = topSignal?.badgeClass === 'session-badge--danger'
                    ? 'alert'
                    : (topSignal ? 'warn' : '');

                if (!detail) {
                    return null;
                }

                return {
                    label: String(display.name || '用户消息').trim() || '用户消息',
                    copy: detail,
                    timestamp,
                    tone,
                    moduleId: sessionId ? 'chat' : '',
                    stateKey: sessionId ? `notifications-session-${sessionId}` : '',
                    feedbackLabel: String(display.name || '用户消息').trim() || '用户消息',
                    intent: sessionId
                        ? `打开 ${String(display.name || '用户消息').trim() || '用户消息'} 会话。`
                        : '',
                    context: sessionId
                        ? {
                            payload: {
                                sessionId
                            }
                        }
                        : {}
                };
            })
            .filter(Boolean)
            .sort((left, right) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0))
            .slice(0, 2);

        const alertItems = (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .filter((alert) => !this.isOpsAlertClosed(alert) && !this.isOpsAlertRead(alert))
            .map((alert) => {
                const timestamp = alert?.sortTimestamp instanceof Date
                    ? alert.sortTimestamp.getTime()
                    : (Date.parse(alert?.updated_at || alert?.created_at || '') || 0);
                const preview = String(this.buildOpsAlertPreview(alert) || '').trim();
                if (!preview) {
                    return null;
                }
                const normalizedSeverity = String(alert?.severity || '').trim().toLowerCase();
                return {
                    label: '系统告警',
                    copy: preview,
                    timestamp,
                    tone: ['critical', 'danger', 'error'].includes(normalizedSeverity) ? 'alert' : 'warn',
                    ...buildOpsAlertRecentAction(alert)
                };
            })
            .filter(Boolean)
            .sort((left, right) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0))
            .slice(0, 2);

        return [...sessionItems, ...alertItems]
            .sort((left, right) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0))
            .slice(0, 3);
    }

    getCommandCenterSummary() {
        const backlog = this.getSessionQueueBacklogSnapshot();
        const unreadMessages = (Array.isArray(this.chatSessions) ? this.chatSessions : [])
            .reduce((sum, session) => sum + Math.max(0, Number(session?.unread || 0) || 0), 0);
        const pendingReply = Math.max(0, Number(backlog.pendingReply || 0) || 0);
        const systemAlerts = Math.max(0, Number(this.getOpsAlertActiveCount() || 0) || 0);
        const unreadSystemAlerts = Math.max(0, Number(this.getOpsAlertUnreadCount() || 0) || 0);
        const actionableCount = pendingReply + unreadSystemAlerts;
        const hasLoaded = this.hasBootstrappedSessions || this.hasHydratedSessionSidebarData;
        const status = this.isSessionBootstrapPending
            ? 'loading'
            : (this.opsAlertLoadError ? 'partial' : (hasLoaded ? 'ready' : 'idle'));

        return {
            ready: hasLoaded,
            status,
            unreadMessages,
            pendingReply,
            staleReply: Math.max(0, Number(backlog.staleReply || 0) || 0),
            openTickets: Math.max(0, Number(backlog.openTickets || 0) || 0),
            verificationAlerts: Math.max(0, Number(backlog.verificationAlerts || 0) || 0),
            paymentFollowups: Math.max(0, Number(backlog.paymentFollowups || 0) || 0),
            systemAlerts,
            unreadSystemAlerts,
            actionableCount,
            recentItems: this.getCommandCenterRecentItems()
        };
    }

    emitCommandCenterSummaryUpdate() {
        if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') {
            return;
        }

        try {
            window.dispatchEvent(new CustomEvent('admin-chat-command-summary-updated', {
                detail: this.getCommandCenterSummary()
            }));
        } catch (_) {
            // Summary sync should never block the chat module itself.
        }
    }

    getSessionQueueCapacityAlerts(snapshot = {}) {
        const alerts = [];

        if (Number(snapshot.staleReply || 0) >= 3) {
            alerts.push({
                tone: 'danger',
                label: `久未回复积压 ${snapshot.staleReply} 个`
            });
        }

        if (Number(snapshot.highPriority || 0) >= 5) {
            alerts.push({
                tone: alerts.length ? 'warning' : 'danger',
                label: `高优先会话 ${snapshot.highPriority} 个`
            });
        }

        if (Number(snapshot.pendingReply || 0) >= 8) {
            alerts.push({
                tone: 'warning',
                label: `待回复堆积 ${snapshot.pendingReply} 个`
            });
        }

        return alerts.slice(0, 3);
    }

    getSessionQueuePriorityItems(snapshot = {}) {
        const items = [];

        if (Number(snapshot.staleReply || 0) > 0) {
            items.push({
                key: 'stale_reply',
                title: `${snapshot.staleReply} 个久未回复`,
                detail: snapshot.topWait > 0
                    ? `最长等待 ${this.formatSessionReplyWaitAge(snapshot.topWait)}`
                    : '先清最老会话',
                weight: snapshot.staleReply * 140 + Math.min(240, Number(snapshot.topWait || 0)),
                tone: snapshot.staleReply >= 3 || Number(snapshot.topWait || 0) >= 120 ? 'danger' : 'warning'
            });
        }

        if (Number(snapshot.openTickets || 0) > 0) {
            items.push({
                key: 'ticket',
                title: `${snapshot.openTickets} 个售后处理中`,
                detail: '优先守住工单与退款闭环',
                weight: snapshot.openTickets * 120,
                tone: snapshot.openTickets >= 5 ? 'danger' : 'warning'
            });
        }

        if (Number(snapshot.verificationAlerts || 0) > 0) {
            items.push({
                key: 'verification',
                title: `${snapshot.verificationAlerts} 个验证异常`,
                detail: '先核验失败、超时与重试中的会话',
                weight: snapshot.verificationAlerts * 110,
                tone: snapshot.verificationAlerts >= 3 ? 'danger' : 'warning'
            });
        }

        if (Number(snapshot.paymentFollowups || 0) > 0) {
            items.push({
                key: 'payment',
                title: `${snapshot.paymentFollowups} 个支付待跟进`,
                detail: '确认到账、补单和回填状态',
                weight: snapshot.paymentFollowups * 95,
                tone: snapshot.paymentFollowups >= 4 ? 'warning' : 'calm'
            });
        }

        if (Number(snapshot.pendingReply || 0) > 0) {
            items.push({
                key: 'reply',
                title: `${snapshot.pendingReply} 个待回复`,
                detail: '避免新会话继续老化',
                weight: snapshot.pendingReply * 70,
                tone: snapshot.pendingReply >= 8 ? 'warning' : 'calm'
            });
        }

        return items
            .sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0))
            .slice(0, 3);
    }

    getSessionQueueRecommendedMode(snapshot = {}) {
        const specializedLoad = Number(snapshot.specializedLoad || 0);
        const defaultView = this.normalizeSessionQueueView(this.sessionQueueDefaultView || 'all');
        const defaultFilter = this.normalizeSessionQueueFilter(this.sessionQueueDefaultFilter || 'all');

        if (Number(snapshot.staleReply || 0) >= 3 || Number(snapshot.topWait || 0) >= 120) {
            return {
                view: 'all',
                filter: 'stale_reply',
                tone: Number(snapshot.staleReply || 0) >= 5 || Number(snapshot.topWait || 0) >= 180 ? 'danger' : 'warning',
                reason: `先把 ${snapshot.staleReply} 个久未回复清掉，最长已经等了 ${this.formatSessionReplyWaitAge(snapshot.topWait || 60)}。`
            };
        }

        if (Number(snapshot.openTickets || 0) >= 5 || Number(snapshot.openTickets || 0) >= Math.max(3, specializedLoad + 1)) {
            return {
                view: 'ticket_followup',
                filter: 'all',
                tone: Number(snapshot.openTickets || 0) >= 6 ? 'danger' : 'warning',
                reason: `售后闭环里的会话有 ${snapshot.openTickets} 个，先盯工单、退款和承诺中的用户。`
            };
        }

        if (Number(snapshot.verificationAlerts || 0) >= 2 && Number(snapshot.verificationAlerts || 0) >= Number(snapshot.paymentFollowups || 0)) {
            return {
                view: 'payment_verify',
                filter: 'verification',
                tone: Number(snapshot.verificationAlerts || 0) >= 4 ? 'danger' : 'warning',
                reason: `验证异常更集中，适合先切到验证异常视图集中排查。`
            };
        }

        if (specializedLoad >= 3) {
            return {
                view: 'payment_verify',
                filter: 'all',
                tone: specializedLoad >= 5 ? 'danger' : 'warning',
                reason: `支付和验证待跟进共 ${specializedLoad} 个，适合切到异常工作流连续处理。`
            };
        }

        if (Number(snapshot.highPriority || 0) >= 5) {
            return {
                view: 'priority',
                filter: 'all',
                tone: Number(snapshot.highPriority || 0) >= 7 ? 'danger' : 'warning',
                reason: `高优先会话已经堆到 ${snapshot.highPriority} 个，先按综合优先级清队列。`
            };
        }

        if (Number(snapshot.pendingReply || 0) >= 6) {
            return {
                view: 'all',
                filter: 'reply',
                tone: Number(snapshot.pendingReply || 0) >= 10 ? 'warning' : 'calm',
                reason: `先接住还没回复的 ${snapshot.pendingReply} 个会话，避免继续变成超时积压。`
            };
        }

        return {
            view: defaultView,
            filter: defaultFilter,
            tone: 'calm',
            reason: '当前没有明显拥堵，保持默认值班视图即可。'
        };
    }

    getSessionQueueCoordinationAdvice(snapshot = {}) {
        const specializedLoad = Number(snapshot.specializedLoad || 0);

        if (Number(snapshot.staleReply || 0) >= 5 && (Number(snapshot.openTickets || 0) >= 4 || specializedLoad >= 4)) {
            return {
                tone: 'danger',
                title: '建议立刻补位增援',
                description: '当前回复清 backlog 和售后/异常会互相打断，建议至少加 1 人：一人清久未回复，一人盯售后或异常链路。'
            };
        }

        if (Number(snapshot.openTickets || 0) >= 4 && specializedLoad >= 3) {
            return {
                tone: 'warning',
                title: '建议拆成两路值守',
                description: '把售后值守和支付/验证分开，异常会话优先转交到对应工作区负责人，客服只保留对用户的回访。'
            };
        }

        if (Number(snapshot.verificationAlerts || 0) >= 3) {
            return {
                tone: 'warning',
                title: '建议转给验证线协同',
                description: '验证异常已经成堆，适合先让验证负责人盯排查，客服工作台负责同步结果和稳住用户预期。'
            };
        }

        if (Number(snapshot.paymentFollowups || 0) >= 3) {
            return {
                tone: 'warning',
                title: '建议支付会话单独处理',
                description: '到账、补单和回填类问题最好成线处理，必要时直接转给支付工作区值守，减少在客服列表里来回切换。'
            };
        }

        if (Number(snapshot.openTickets || 0) >= 4) {
            return {
                tone: 'warning',
                title: '建议补一个售后值守',
                description: '工单中的会话偏多，优先让一位同学专门看退款和工单推进，避免用户刚被回复又重新排队。'
            };
        }

        if (Number(snapshot.staleReply || 0) >= 3 || Number(snapshot.pendingReply || 0) >= 8) {
            return {
                tone: 'calm',
                title: '先切视图集中清队列',
                description: '暂时不一定要增援，先切到建议视图把老会话清掉，队列通常会先明显回落。'
            };
        }

        return {
            tone: 'calm',
            title: '维持默认值守即可',
            description: '当前还不需要专门转交或增援，按默认视图持续跟进就够了。'
        };
    }

    getSessionQueueDutyAdvice(snapshot = null) {
        const backlogSnapshot = snapshot || this.getSessionQueueBacklogSnapshot();
        const recommendedMode = this.getSessionQueueRecommendedMode(backlogSnapshot);
        const priorityItems = this.getSessionQueuePriorityItems(backlogSnapshot);
        const coordination = this.getSessionQueueCoordinationAdvice(backlogSnapshot);
        const recommendedLabel = this.formatSessionQueueModeLabel(recommendedMode.view, recommendedMode.filter);
        const isCurrentModeRecommended = this.normalizeSessionQueueView(this.sessionQueueView) === recommendedMode.view
            && this.normalizeSessionQueueFilter(this.sessionQueueFilter) === recommendedMode.filter;

        return {
            snapshot: backlogSnapshot,
            recommendedMode: {
                ...recommendedMode,
                label: recommendedLabel
            },
            priorityItems,
            coordination,
            isCurrentModeRecommended
        };
    }

    renderSessionQueueSnapshot() {
        const container = document.getElementById('sessionQueueSnapshot');
        if (!container) return;

        const snapshot = this.getSessionQueueBacklogSnapshot();
        const capacityAlerts = this.getSessionQueueCapacityAlerts(snapshot);
        const dutyAdvice = this.getSessionQueueDutyAdvice(snapshot);
        const currentMode = this.formatSessionQueueModeLabel(this.sessionQueueView, this.sessionQueueFilter);
        const defaultMode = this.formatSessionQueueModeLabel(this.sessionQueueDefaultView, this.sessionQueueDefaultFilter);
        const isDefaultMode = this.isSessionQueueUsingDefaultView();
        const summaryParts = [];
        if (snapshot.staleReply > 0) summaryParts.push(`${snapshot.staleReply} 个久未回复`);
        if (snapshot.openTickets > 0) summaryParts.push(`${snapshot.openTickets} 个售后处理中`);
        if (snapshot.verificationAlerts > 0) summaryParts.push(`${snapshot.verificationAlerts} 个验证异常`);
        if (snapshot.paymentFollowups > 0) summaryParts.push(`${snapshot.paymentFollowups} 个支付待跟进`);
        if (!summaryParts.length) summaryParts.push('当前队列比较平稳');

        container.innerHTML = `
            <div class="session-queue-snapshot__title">交班摘要</div>
            <div class="session-queue-snapshot__mode">
                <span>当前：${currentMode}</span>
                <span>默认：${defaultMode}</span>
                <span>摘要：全队列</span>
            </div>
            <div class="session-queue-snapshot__summary">${summaryParts.slice(0, 3).join(' · ')}</div>
            <div class="session-queue-snapshot__meta">
                <span>待回复 ${snapshot.pendingReply}</span>
                <span>高优先 ${snapshot.highPriority}</span>
                <span>工单中 ${snapshot.openTickets}</span>
                <span>验证异常 ${snapshot.verificationAlerts}</span>
                ${snapshot.topWait > 0 ? `<span>最长等待 ${this.formatSessionReplyWaitAge(snapshot.topWait)}</span>` : ''}
            </div>
            ${capacityAlerts.length ? `
                <div class="session-queue-snapshot__capacity">
                    ${capacityAlerts.map((alert) => `
                        <span class="session-queue-snapshot__capacity-badge session-queue-snapshot__capacity-badge--${alert.tone}">
                            ${alert.label}
                        </span>
                    `).join('')}
                </div>
            ` : ''}
            <div class="session-queue-snapshot__suggestions">
                <div class="session-queue-suggestion session-queue-suggestion--${dutyAdvice.recommendedMode.tone}">
                    <div class="session-queue-suggestion__eyebrow">适合切到</div>
                    <div class="session-queue-suggestion__title">${this.escapeHtml(dutyAdvice.recommendedMode.label)}</div>
                    <div class="session-queue-suggestion__desc">${this.escapeHtml(dutyAdvice.recommendedMode.reason)}</div>
                    ${dutyAdvice.isCurrentModeRecommended
                        ? '<span class="session-queue-suggestion__hint">当前已在建议视图</span>'
                        : `<button type="button" class="session-queue-suggestion__action" data-session-snapshot-action="apply-recommended-mode" data-session-recommended-view="${this.escapeHtml(dutyAdvice.recommendedMode.view)}" data-session-recommended-filter="${this.escapeHtml(dutyAdvice.recommendedMode.filter)}">切到建议视图</button>`}
                </div>
                <div class="session-queue-suggestion session-queue-suggestion--${dutyAdvice.priorityItems[0]?.tone || dutyAdvice.recommendedMode.tone}">
                    <div class="session-queue-suggestion__eyebrow">优先处理</div>
                    ${dutyAdvice.priorityItems.length ? `
                        <div class="session-queue-suggestion__list">
                            ${dutyAdvice.priorityItems.map((item, index) => `
                                <div class="session-queue-suggestion__list-item">
                                    <span class="session-queue-suggestion__index">${index + 1}</span>
                                    <span class="session-queue-suggestion__list-body">
                                        <span class="session-queue-suggestion__list-title">${this.escapeHtml(item.title)}</span>
                                        <span class="session-queue-suggestion__list-detail">${this.escapeHtml(item.detail)}</span>
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="session-queue-suggestion__desc">当前队列比较平稳，按默认节奏处理即可。</div>'}
                </div>
                <div class="session-queue-suggestion session-queue-suggestion--${dutyAdvice.coordination.tone}">
                    <div class="session-queue-suggestion__eyebrow">协同安排</div>
                    <div class="session-queue-suggestion__title">${this.escapeHtml(dutyAdvice.coordination.title)}</div>
                    <div class="session-queue-suggestion__desc">${this.escapeHtml(dutyAdvice.coordination.description)}</div>
                </div>
            </div>
            <div class="session-queue-snapshot__actions">
                ${isDefaultMode
                    ? '<span class="session-queue-snapshot__hint">当前已使用默认视图</span>'
                    : '<button type="button" class="session-queue-snapshot__action" data-session-snapshot-action="restore-default">回到默认视图</button>'}
                <button type="button" class="session-queue-snapshot__action session-queue-snapshot__action--ghost" data-session-snapshot-action="save-default">设为默认</button>
            </div>
        `;
    }

    renderSessionQueueViews() {
        const container = document.getElementById('sessionQueueViews');
        if (!container) return;

        const options = this.getSessionQueueViewOptions();
        container.replaceChildren();

        options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `session-queue-preset${this.sessionQueueView === option.value ? ' is-active' : ''}`;
            button.setAttribute('data-session-view', option.value);
            button.textContent = option.count > 0 ? `${option.label} ${option.count}` : option.label;
            container.appendChild(button);
        });
    }

    renderSessionQueueControls() {
        this.renderSessionQueueOverview();
        this.renderSessionQueueSnapshot();
        this.renderSessionQueueViews();
        this.renderSessionQueueFilters();
        this.updateSidebarInsightsShell();
    }

    renderSessionQueueFilters() {
        const container = document.getElementById('sessionFilterBar');
        if (!container) return;

        const options = this.getSessionQueueFilterOptions();
        container.replaceChildren();

        options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `session-filter-btn${this.sessionQueueFilter === option.value ? ' is-active' : ''}`;
            button.setAttribute('data-session-filter', option.value);
            button.textContent = option.count > 0 ? `${option.label} ${option.count}` : option.label;
            container.appendChild(button);
        });
    }

    setSessionQueueView(value = 'all', { resetFilter = true } = {}) {
        const nextValue = this.normalizeSessionQueueView(value);
        this.sessionQueueView = nextValue;
        if (resetFilter) {
            this.sessionQueueFilter = 'all';
        }
        this.persistSessionQueuePreferences();
        this.renderSessionQueueControls();
        this.renderSessionList(this.searchQuery);
    }

    setSessionQueueFilter(value = 'all') {
        const nextValue = this.normalizeSessionQueueFilter(value);
        this.sessionQueueFilter = nextValue;
        this.persistSessionQueuePreferences();
        this.renderSessionQueueControls();
        this.renderSessionList(this.searchQuery);
    }

    getSessionQueueEmptyMessage(filter = '') {
        const normalizedFilter = String(filter || '').trim();
        if (normalizedFilter) {
            return `没有匹配“${normalizedFilter}”的会话`;
        }

        if (this.sessionQueueView === 'priority') {
            return '当前没有高优先会话';
        }
        if (this.sessionQueueView === 'ticket_followup') {
            return '当前没有售后值守会话';
        }
        if (this.sessionQueueView === 'payment_verify') {
            return '当前没有支付或验证异常会话';
        }

        switch (this.sessionQueueFilter) {
            case 'reply':
                return '当前没有待回复会话';
            case 'stale_reply':
                return '当前没有久未回复会话';
            case 'ticket':
                return '当前没有工单中的会话';
            case 'verification':
                return '当前没有验证异常会话';
            case 'all':
            default:
                return '当前没有会话';
        }
    }

    sessionMatchesQueueView(session = {}) {
        return this.matchesSessionQueueViewMode(session, this.sessionQueueView);
    }

    matchesSessionQueueViewMode(session = {}, view = 'all') {
        const normalizedView = this.normalizeSessionQueueView(view);
        if (this.isOpsAlertSession(session)) {
            return normalizedView === 'all';
        }

        switch (normalizedView) {
            case 'priority':
                return this.isHighPrioritySession(session);
            case 'ticket_followup':
                return Boolean(session.ticketSummary?.latestOpenTicket);
            case 'payment_verify':
                return Boolean(
                    this.getSessionPaymentSignal(session.paymentSummary)
                    || this.getSessionVerificationSignal(session.verificationSummary)
                );
            case 'all':
            default:
                return true;
        }
    }

    sessionMatchesQueueFilter(session = {}) {
        return this.matchesSessionQueueFilterMode(session, this.sessionQueueFilter, this.sessionQueueView);
    }

    matchesSessionQueueFilterMode(session = {}, filter = 'all', view = 'all') {
        const normalizedFilter = this.normalizeSessionQueueFilter(filter);
        const normalizedView = this.normalizeSessionQueueView(view);
        if (this.isOpsAlertSession(session)) {
            return normalizedView === 'all' && normalizedFilter === 'all';
        }

        switch (normalizedFilter) {
            case 'reply':
                return Boolean(session.replySummary?.pending);
            case 'stale_reply':
                return Number(session.replySummary?.waitMinutes || 0) >= 60;
            case 'ticket':
                return Boolean(session.ticketSummary?.latestOpenTicket);
            case 'verification':
                return Boolean(this.getSessionVerificationSignal(session.verificationSummary));
            case 'all':
            default:
                return true;
        }
    }

    getChatSessionSortPriority(session = {}) {
        return this.getSessionPrioritySignals(session)
            .reduce((maxScore, signal) => Math.max(maxScore, Number(signal?.score || 0)), 0);
    }

    getUserContextHeadlineTone(status = '') {
        const normalized = String(status || '').trim().toLowerCase();
        if (!normalized) return 'neutral';

        const successTokens = ['resolved', 'delivered', 'paid', 'succeeded', 'success', 'refunded', '已解决', '已交付', '已支付', '已成功', '成功', '已退款'];
        if (successTokens.some((token) => normalized.includes(token))) {
            return 'success';
        }

        const dangerTokens = ['failed', 'rejected', 'dead', '拒绝', '失败', '异常'];
        if (dangerTokens.some((token) => normalized.includes(token))) {
            return 'danger';
        }

        const warningTokens = ['pending', 'open', 'processing', 'queued', 'retry', '待处理', '处理中', '排队中', '重试'];
        if (warningTokens.some((token) => normalized.includes(token))) {
            return 'warning';
        }

        return 'neutral';
    }

    getUserContextHeadlineItems(context = {}) {
        const latestOrder = this.getLatestUserContextRecord(context.orders);
        const latestPayment = this.getLatestUserContextRecord(context.payments);
        const latestVerification = this.getLatestUserContextRecord(context.verifications);
        const latestTicket = this.getLatestUserContextRecord(context.tickets);
        const openTickets = (Array.isArray(context.tickets) ? context.tickets : [])
            .filter((ticket) => !['resolved', 'rejected'].includes(String(ticket?.status || '').trim().toLowerCase()));

        const items = [];

        if (latestOrder) {
            const rawStatus = String(latestOrder.delivery_status || latestOrder.refund_status || '').trim();
            items.push({
                label: '订单',
                value: this.formatUserContextStatus(rawStatus),
                tone: this.getUserContextHeadlineTone(rawStatus)
            });
        }

        if (latestPayment) {
            const rawStatus = String(latestPayment.status || '').trim();
            items.push({
                label: '充值',
                value: this.formatUserContextStatus(rawStatus),
                tone: this.getUserContextHeadlineTone(rawStatus)
            });
        }

        if (latestVerification) {
            const rawStatus = String(latestVerification.status || '').trim();
            items.push({
                label: '验证',
                value: this.formatUserContextStatus(rawStatus),
                tone: this.getUserContextHeadlineTone(rawStatus)
            });
        }

        if (openTickets.length > 0) {
            items.push({
                label: '工单',
                value: openTickets.length > 1 ? `${openTickets.length} 条待处理` : '待处理',
                tone: 'warning'
            });
        } else if (latestTicket) {
            const rawStatus = String(latestTicket.status || '').trim();
            items.push({
                label: '工单',
                value: this.formatUserContextStatus(rawStatus),
                tone: this.getUserContextHeadlineTone(rawStatus)
            });
        }

        return items.slice(0, 4);
    }

    createUserContextHeadline(context = {}) {
        const items = this.getUserContextHeadlineItems(context);
        if (!items.length) {
            return null;
        }

        const headline = document.createElement('div');
        headline.className = 'user-context-headline';

        const label = document.createElement('div');
        label.className = 'user-context-headline__label';
        label.textContent = '会话摘要';
        headline.appendChild(label);

        const itemsWrap = document.createElement('div');
        itemsWrap.className = 'user-context-headline__items';

        items.forEach((item) => {
            const chip = document.createElement('div');
            chip.className = `user-context-headline__item user-context-headline__item--${item.tone || 'neutral'}`;
            chip.innerHTML = `
                <span class="user-context-headline__item-label">${this.escapeHtml(item.label)}</span>
                <span class="user-context-headline__item-value">${this.escapeHtml(item.value)}</span>
            `;
            itemsWrap.appendChild(chip);
        });

        headline.appendChild(itemsWrap);
        return headline;
    }

    getUserContextHeaderStatusItems(context = {}) {
        return this.getUserContextHeadlineItems(context).slice(0, 3);
    }

    renderUserContextHeaderStatus(context = null) {
        const container = document.getElementById('currentChatStatusChips');
        if (!container) return;

        container.replaceChildren();

        const presenceItem = this.currentSessionInfo
            ? this.getSessionPresenceStatusItem(this.currentSessionInfo)
            : null;
        const items = [
            presenceItem,
            ...(context ? this.getUserContextHeaderStatusItems(context) : [])
        ].filter(Boolean).slice(0, 3);
        if (!items.length) {
            container.hidden = true;
            return;
        }

        items.forEach((item) => {
            const chip = document.createElement('span');
            chip.className = `chat-user-status-chip chat-user-status-chip--${item.tone || 'neutral'}`;
            chip.innerHTML = `
                <span class="chat-user-status-chip__label">${this.escapeHtml(item.label)}</span>
                <span class="chat-user-status-chip__value">${this.escapeHtml(item.value)}</span>
            `;
            container.appendChild(chip);
        });

        container.hidden = false;
    }

    buildUserContextActionSignature(action = {}) {
        return [
            String(action.workspaceKey || '').trim(),
            String(action.context?.targetId || action.context?.target_id || '').trim(),
            String(action.context?.referenceValue || '').trim()
        ].join('::');
    }

    getUserContextRecentAction(context = {}) {
        const cacheKey = String(context.cacheKey || '').trim();
        if (!cacheKey) return null;
        const recentAction = this.userContextRecentActions.get(cacheKey) || null;
        if (!recentAction) {
            return null;
        }
        if (!this.canAccessWorkbenchAction(recentAction)) {
            this.userContextRecentActions.delete(cacheKey);
            if (this.currentUserContext?.cacheKey === cacheKey) {
                this.currentUserContext = {
                    ...this.currentUserContext,
                    recentAction: null
                };
            }
            return null;
        }
        return recentAction;
    }

    rememberUserContextAction(context = {}, action = {}) {
        const cacheKey = String(context.cacheKey || action._contextCacheKey || '').trim();
        if (!cacheKey) return null;
        if (!this.canAccessWorkbenchAction(action)) {
            this.userContextRecentActions.delete(cacheKey);
            return null;
        }

        const contextPayload = action.context && typeof action.context === 'object'
            ? { ...action.context }
            : {};
        const record = {
            cacheKey,
            signature: this.buildUserContextActionSignature(action),
            label: String(action.label || '已打开工作区').trim(),
            workspaceKey: String(action.workspaceKey || '').trim(),
            context: contextPayload,
            referenceValue: String(contextPayload.referenceValue || contextPayload.targetId || contextPayload.target_id || '').trim(),
            updatedAt: new Date().toISOString()
        };

        this.userContextRecentActions.set(cacheKey, record);

        if (this.currentUserContext?.cacheKey === cacheKey) {
            this.currentUserContext = {
                ...this.currentUserContext,
                recentAction: record
            };
            this.renderUser360Context(this.currentUserContext);
        }

        return record;
    }

    isUserContextActionRecent(context = {}, action = {}) {
        const recentAction = this.getUserContextRecentAction(context);
        if (!recentAction) return false;
        return recentAction.signature === this.buildUserContextActionSignature(action);
    }

    createUserContextRecentActionBanner(context = {}) {
        const recentAction = this.getUserContextRecentAction(context);
        if (!recentAction) {
            return null;
        }

        const banner = document.createElement('button');
        banner.type = 'button';
        banner.className = 'user-context-recent-action';
        banner.innerHTML = `
            <span class="user-context-recent-action__label">最近处理</span>
            <span class="user-context-recent-action__value">${this.escapeHtml(recentAction.label)}${recentAction.referenceValue ? ` · ${this.escapeHtml(this.truncateText(recentAction.referenceValue, 28))}` : ''}</span>
            <span class="user-context-recent-action__time">${this.escapeHtml(this.formatUserContextDate(recentAction.updatedAt))}</span>
        `;
        banner.addEventListener('click', () => {
            this.handleUserContextAction({
                label: recentAction.label,
                workspaceKey: recentAction.workspaceKey,
                context: { ...(recentAction.context || {}) },
                _contextCacheKey: recentAction.cacheKey
            });
        });
        return banner;
    }

    resolveSessionContextEmail(session = {}) {
        const explicitEmail = String(session?.email || '').trim();
        if (explicitEmail) return explicitEmail;
        return this.resolveSessionEmail(session?.profile || null, session?.sessionId || '', session?.sessionIds || []);
    }

    hasKnownUserIdentityForSession(session = {}) {
        const userId = String(session?.userId || session?.profile?.id || '').trim();
        const email = this.resolveSessionContextEmail(session);
        return Boolean(userId || email);
    }

    buildUserContextCacheKey(session = {}) {
        const userId = String(session?.userId || session?.profile?.id || '').trim();
        const email = this.resolveSessionContextEmail(session).toLowerCase();
        const sessionId = String(session?.sessionId || '').trim();
        if (userId) return `user:${userId}`;
        if (email) return `email:${email}`;
        return `session:${sessionId}`;
    }

    async fetchUserContextProfile({ userId = '', email = '' } = {}) {
        if (!this.supabase?.from || (!userId && !email)) {
            return null;
        }

        const selectVariants = [
            'id, email, display_name, username, avatar_url',
            'id, email, username, avatar_url',
            'id, username, avatar_url'
        ];

        const lookupPlans = [];
        if (userId) {
            lookupPlans.push({ field: 'id', value: userId, useIlike: false });
        }
        if (email) {
            lookupPlans.push({ field: 'email', value: email, useIlike: true });
        }

        for (const selectClause of selectVariants) {
            for (const plan of lookupPlans) {
                try {
                    let query = this.supabase
                        .from('profiles')
                        .select(selectClause)
                        .limit(1);

                    query = plan.useIlike
                        ? query.ilike(plan.field, plan.value)
                        : query.eq(plan.field, plan.value);

                    const { data, error } = await query;
                    if (error) {
                        continue;
                    }

                    const profile = Array.isArray(data) ? (data[0] || null) : (data || null);
                    if (profile) {
                        return profile;
                    }
                } catch (error) {
                    continue;
                }
            }
        }

        return null;
    }

    async fetchUser360Context(session = {}) {
        const cacheKey = this.buildUserContextCacheKey(session);
        if (this.userContextCache.has(cacheKey)) {
            return this.userContextCache.get(cacheKey);
        }

        const initialUserId = String(session?.userId || session?.profile?.id || '').trim();
        const initialEmail = this.resolveSessionContextEmail(session);
        const fetchedProfile = await this.fetchUserContextProfile({
            userId: initialUserId,
            email: initialEmail
        });
        const profile = {
            ...(session?.profile && typeof session.profile === 'object' ? session.profile : {}),
            ...(fetchedProfile && typeof fetchedProfile === 'object' ? fetchedProfile : {})
        };
        const userId = String(profile.id || initialUserId || '').trim();
        const email = String(initialEmail || profile.email || '').trim();

        const [ordersResult, paymentsResult, verifyResult, ticketsResult] = await Promise.allSettled([
            userId
                ? this.supabase
                    .from('shop_orders')
                    .select('id, created_at, price_paid, snapshot_product_name, refund_status, delivery_status')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(2)
                : Promise.resolve({ data: [] }),
            userId
                ? this.supabase
                    .from('payment_orders')
                    .select('id, user_id, created_at, package_name, paid_amount, expected_amount, status, provider')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(2)
                : Promise.resolve({ data: [] }),
            (userId || email)
                ? (() => {
                    let query = this.supabase
                        .from('verification_logs')
                        .select('verification_id, user_id, status, message, created_at')
                        .order('created_at', { ascending: false })
                        .limit(2);
                    if (userId) {
                        query = query.eq('user_id', userId);
                    } else {
                        query = query.eq('verification_id', email);
                    }
                    return query;
                })()
                : Promise.resolve({ data: [] }),
            userId
                ? this.supabase
                    .from('shop_tickets')
                    .select('id, order_id, issue_type, status, description, created_at')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(2)
                : Promise.resolve({ data: [] })
        ]);

        const context = {
            cacheKey,
            userId,
            email,
            displayName: String(profile.display_name || profile.username || (email ? email.split('@')[0] : '') || '').trim()
                || (String(session?.sessionId || '').startsWith('guest') ? this.t('chat.guest', '访客') : this.t('chat.user', '用户')),
            avatarUrl: String(profile.avatar_url || '').trim(),
            sessionId: String(session?.sessionId || '').trim(),
            accountState: userId ? '已绑定账号' : '游客会话',
            orders: ordersResult.status === 'fulfilled' ? (ordersResult.value.data || []) : [],
            payments: paymentsResult.status === 'fulfilled' ? (paymentsResult.value.data || []) : [],
            verifications: verifyResult.status === 'fulfilled' ? (verifyResult.value.data || []) : [],
            tickets: ticketsResult.status === 'fulfilled' ? (ticketsResult.value.data || []) : []
        };

        this.userContextCache.set(cacheKey, context);
        return context;
    }

    renderUserContextPanelState(message = '', variant = 'loading') {
        const panel = document.getElementById('chatContextPanel');
        if (!panel) return;
        const text = String(message || '').trim();
        if (!text) {
            panel.hidden = true;
            panel.replaceChildren();
            this.updateChatContextPanelLayout();
            return;
        }
        panel.hidden = false;
        panel.className = `chat-context-panel chat-context-panel--${variant}`;
        panel.innerHTML = `<div class="chat-context-panel__state">${this.escapeHtml(text)}</div>`;
        this.updateChatContextPanelLayout();
    }

    createUserContextSection(title, rows = [], emptyText = '暂无记录') {
        const section = document.createElement('section');
        section.className = 'user-context-section';

        const heading = document.createElement('div');
        heading.className = 'user-context-section__title';
        heading.textContent = title;
        section.appendChild(heading);

        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'user-context-section__empty';
            empty.textContent = emptyText;
            section.appendChild(empty);
            return section;
        }

        rows.forEach((row) => {
            const item = document.createElement('div');
            item.className = 'user-context-item';

            const main = document.createElement('div');
            main.className = 'user-context-item__main';
            main.textContent = row.main;
            item.appendChild(main);

            if (row.sub) {
                const sub = document.createElement('div');
                sub.className = 'user-context-item__sub';
                sub.textContent = row.sub;
                item.appendChild(sub);
            }

            section.appendChild(item);
        });

        return section;
    }

    getLatestUserContextRecord(items = []) {
        return (Array.isArray(items) ? items : [])
            .find((item) => item && typeof item === 'object') || null;
    }

    getUserContextVerificationPayload(item = {}) {
        const rawMessage = String(item?.message || '').trim();
        if (!rawMessage || !/^[{\[]/.test(rawMessage)) {
            return {};
        }

        try {
            const parsed = JSON.parse(rawMessage);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
            return {};
        }
    }

    getUserContextVerificationSubmitterLabel(item = {}, context = {}) {
        const payload = this.getUserContextVerificationPayload(item);
        const email = String(
            item?.submitter_email
            || item?.email
            || item?.user_email
            || payload.email
            || context.email
            || ''
        ).trim();
        const displayName = String(
            item?.submitter_display_name
            || item?.display_name
            || item?.submitter_username
            || item?.username
            || payload.display_name
            || payload.username
            || context.displayName
            || ''
        ).trim();
        const userId = String(item?.user_id || context.userId || '').trim();
        return email || displayName || (userId ? `用户 ${this.truncateText(userId, 18)}` : '未记录提交者');
    }

    getUserContextVerificationReferenceLabel(item = {}) {
        const verificationId = String(item?.verification_id || '').trim();
        return verificationId ? `验证单号 ${this.truncateText(verificationId, 22)}` : '验证单号未记录';
    }

    buildUserContextWorkbenchEntry(kind = '', payload = {}) {
        const normalizedKind = String(kind || '').trim().toLowerCase();
        const sharedRuntime = window || {};

        if (normalizedKind === 'user') {
            if (typeof sharedRuntime.buildUserWorkbenchEntry === 'function') {
                return sharedRuntime.buildUserWorkbenchEntry(payload);
            }
            const userId = String(payload.userId || '').trim();
            const email = String(payload.email || '').trim();
            const searchValue = String(payload.referenceValue || userId || email || '').trim();
            if (!searchValue) {
                return null;
            }
            return {
                workspaceKey: 'shop-risk-users',
                context: {
                    userId,
                    email,
                    targetId: searchValue,
                    target_id: searchValue,
                    referenceLabel: String(payload.referenceLabel || '').trim() || (userId ? '用户' : '邮箱'),
                    referenceValue: searchValue
                }
            };
        }

        if (normalizedKind === 'order') {
            if (typeof sharedRuntime.buildShopOrderWorkbenchEntry === 'function') {
                return sharedRuntime.buildShopOrderWorkbenchEntry(payload);
            }
            const orderId = String(payload.orderId || '').trim();
            if (!orderId) {
                return null;
            }
            return {
                workspaceKey: 'shop-risk-orders',
                context: {
                    orderId,
                    targetId: orderId,
                    target_id: orderId,
                    referenceLabel: String(payload.referenceLabel || '').trim() || '订单',
                    referenceValue: String(payload.referenceValue || orderId).trim() || orderId
                }
            };
        }

        if (normalizedKind === 'ticket') {
            if (typeof sharedRuntime.buildTicketQueueWorkbenchEntry === 'function') {
                return sharedRuntime.buildTicketQueueWorkbenchEntry(payload);
            }
            const ticketId = String(payload.ticketId || '').trim();
            if (!ticketId) {
                return null;
            }
            const ticketStatus = String(payload.ticketStatus || '').trim().toLowerCase();
            return {
                workspaceKey: ticketStatus === 'resolved' ? 'tickets-resolved' : 'tickets-pending',
                context: {
                    ticketId,
                    ticketStatus,
                    targetId: ticketId,
                    target_id: ticketId,
                    referenceLabel: '工单号',
                    referenceValue: ticketId
                }
            };
        }

        if (normalizedKind === 'payment') {
            if (typeof sharedRuntime.buildPaymentWorkbenchEntry === 'function') {
                return sharedRuntime.buildPaymentWorkbenchEntry(payload);
            }
            const paymentOrderId = String(payload.paymentOrderId || '').trim();
            const userId = String(payload.userId || '').trim();
            const email = String(payload.email || '').trim();
            const referenceValue = String(
                payload.referenceValue
                || (userId ? (paymentOrderId || payload.packageName || '最近充值') : (email || paymentOrderId || payload.packageName || '最近充值'))
            ).trim();
            if (userId || email) {
                return {
                    workspaceKey: 'shop-risk-users',
                    context: {
                        userId,
                        email,
                        paymentOrderId,
                        targetId: userId || email,
                        target_id: userId || email,
                        referenceLabel: String(payload.referenceLabel || '').trim() || (userId ? '支付单' : '邮箱'),
                        referenceValue,
                        defaultTab: 'payments',
                        tab: 'payments'
                    }
                };
            }
            if (!paymentOrderId && !referenceValue) {
                return null;
            }
            return {
                workspaceKey: 'payments-overview',
                context: {
                    paymentOrderId,
                    targetId: paymentOrderId || referenceValue,
                    target_id: paymentOrderId || referenceValue,
                    referenceLabel: String(payload.referenceLabel || '').trim() || (paymentOrderId ? '支付单' : '充值'),
                    referenceValue
                }
            };
        }

        if (normalizedKind === 'verify') {
            if (typeof sharedRuntime.buildVerifyWorkbenchEntry === 'function') {
                return sharedRuntime.buildVerifyWorkbenchEntry(payload);
            }
            const verificationId = String(payload.verificationId || '').trim();
            if (!verificationId) {
                return null;
            }
            return {
                workspaceKey: 'verify-monitor',
                context: {
                    verificationId,
                    targetId: verificationId,
                    target_id: verificationId,
                    referenceLabel: String(payload.referenceLabel || '').trim() || '验证任务',
                    referenceValue: String(payload.referenceValue || verificationId).trim() || verificationId
                }
            };
        }

        return null;
    }

    getUserContextQuickActions(context = {}) {
        const actions = [];
        const latestOrder = this.getLatestUserContextRecord(context.orders);
        const latestPayment = this.getLatestUserContextRecord(context.payments);
        const latestVerification = this.getLatestUserContextRecord(context.verifications);
        const latestTicket = this.getLatestUserContextRecord(context.tickets);
        const openTicket = (Array.isArray(context.tickets) ? context.tickets : [])
            .find((ticket) => !['resolved', 'rejected'].includes(String(ticket?.status || '').trim().toLowerCase()));

        const userSearchValue = String(context.userId || context.email || '').trim();
        const userEntry = userSearchValue ? this.buildUserContextWorkbenchEntry('user', {
            userId: context.userId || '',
            email: context.email || '',
            referenceLabel: context.userId ? '用户' : '邮箱',
            referenceValue: userSearchValue
        }) : null;
        if (userEntry) {
            actions.push({
                key: 'user',
                label: '查用户',
                hint: context.userId
                    ? `UUID ${String(context.userId || '').slice(0, 8)}`
                    : this.truncateText(context.email || '当前会话', 24),
                workspaceKey: userEntry.workspaceKey,
                context: userEntry.context
            });
        }

        const orderId = String(latestOrder?.id || latestTicket?.order_id || '').trim();
        const orderEntry = orderId ? this.buildUserContextWorkbenchEntry('order', {
            orderId,
            referenceLabel: '订单',
            referenceValue: orderId
        }) : null;
        if (orderEntry) {
            actions.push({
                key: 'order',
                label: '打开订单',
                hint: `订单 ${orderId.slice(0, 8)}`,
                workspaceKey: orderEntry.workspaceKey,
                context: orderEntry.context
            });
        }

        const ticketId = String(latestTicket?.id || '').trim();
        const ticketEntry = ticketId ? this.buildUserContextWorkbenchEntry('ticket', {
            ticketId,
            ticketStatus: latestTicket?.status || ''
        }) : null;
        if (ticketEntry) {
            const isResolved = String(latestTicket?.status || '').trim().toLowerCase() === 'resolved';
            actions.push({
                key: 'ticket',
                label: isResolved ? '查看工单' : '处理工单',
                hint: `工单 ${ticketId.slice(0, 8)}`,
                workspaceKey: ticketEntry.workspaceKey,
                context: ticketEntry.context
            });
        }

        if (this.canCreateUserContextTicket(context, { openTicket })) {
            actions.push({
                key: 'create_ticket',
                label: '转售后',
                hint: '将当前会话转成工单',
                action: 'create_ticket'
            });
        }

        const pendingPaymentReadTarget = this.getPendingPaymentReadTarget(context);
        if (pendingPaymentReadTarget) {
            actions.push({
                key: 'payment_read',
                label: '待支付已读',
                hint: '不再在列表提示这笔待支付',
                action: 'payment_read',
                paymentIdentity: this.getPendingPaymentReadIdentity(pendingPaymentReadTarget)
            });
        }

        if (latestPayment) {
            const paymentId = String(latestPayment.id || '').trim();
            const paymentUserId = String(latestPayment.user_id || context.userId || '').trim();
            const paymentUserReference = String(paymentUserId || context.email || '').trim();
            const paymentEntry = this.buildUserContextWorkbenchEntry('payment', {
                userId: paymentUserId,
                email: context.email || '',
                paymentOrderId: paymentId,
                packageName: latestPayment.package_name || '',
                referenceLabel: paymentUserReference
                    ? (paymentUserId ? '支付单' : '邮箱')
                    : (paymentId ? '支付单' : '充值'),
                referenceValue: paymentUserReference
                    ? (paymentUserId
                        ? (paymentId || String(latestPayment.package_name || '最近充值').trim())
                        : paymentUserReference)
                    : (paymentId || String(latestPayment.package_name || '最近充值').trim())
            });
            if (paymentEntry) {
            actions.push({
                key: 'payment',
                label: '充值记录',
                hint: paymentId ? `支付单 ${paymentId.slice(0, 8)}` : '最近充值',
                workspaceKey: paymentEntry.workspaceKey,
                context: paymentEntry.context
            });
            }
        }

        const verificationId = String(latestVerification?.verification_id || '').trim();
        const verifyEntry = verificationId ? this.buildUserContextWorkbenchEntry('verify', {
            verificationId,
            referenceLabel: '验证任务',
            referenceValue: verificationId
        }) : null;
        if (verifyEntry) {
            actions.push({
                key: 'verify',
                label: '验证面板',
                hint: verificationId ? `验证单号 ${this.truncateText(verificationId, 18)}` : '最近验证',
                workspaceKey: verifyEntry.workspaceKey,
                context: verifyEntry.context
            });
        }

        return actions
            .filter((action) => this.canAccessWorkbenchAction(action))
            .slice(0, 5);
    }

    canCreateUserContextTicket(context = {}, { openTicket = null } = {}) {
        if (!context || typeof context !== 'object') {
            return false;
        }
        if (!this.canAccessWorkbenchAction({
            key: 'create_ticket',
            action: 'create_ticket',
            context
        })) {
            return false;
        }
        const activeTicket = openTicket || (Array.isArray(context.tickets) ? context.tickets : [])
            .find((ticket) => !['resolved', 'rejected'].includes(String(ticket?.status || '').trim().toLowerCase()));
        if (activeTicket) {
            return false;
        }
        return Boolean(String(context.userId || '').trim());
    }

    buildChatSessionTicketPayload(context = {}, note = '') {
        const latestOrder = this.getLatestUserContextRecord(context.orders);
        const latestPayment = this.getLatestUserContextRecord(context.payments);
        const latestVerification = this.getLatestUserContextRecord(context.verifications);
        const latestSummary = [
            latestOrder ? `最近订单：${this.truncateText(latestOrder.snapshot_product_name || String(latestOrder.id || ''), 24)}（${this.formatUserContextStatus(latestOrder.delivery_status || latestOrder.refund_status)}）` : '',
            latestPayment ? `最近充值：${this.truncateText(latestPayment.package_name || String(latestPayment.id || ''), 24)}（${this.formatUserContextStatus(latestPayment.status)}）` : '',
            latestVerification ? `最近验证：${this.truncateText(this.getUserContextVerificationSubmitterLabel(latestVerification, context), 24)}（${this.formatUserContextStatus(latestVerification.status)}）` : ''
        ].filter(Boolean).join('\n');
        const displayTarget = this.truncateText(context.displayName || context.email || context.userId || context.sessionId || '当前会话', 24);

        return {
            source: 'chat_session',
            title: `客服会话跟进（${displayTarget}）`,
            content: latestSummary || '客服会话需要继续跟进处理。',
            reference_label: '会话',
            reference_value: context.email || context.sessionId || context.userId || '',
            user_id: context.userId || '',
            user_email: context.email || '',
            session_id: this.currentSessionId || context.sessionId || '',
            order_id: latestOrder?.id || '',
            payment_order_id: latestPayment?.id || '',
            note
        };
    }

    async handleCreateUserContextTicket(context = {}) {
        if (!this.canAccessWorkbenchAction({
            key: 'create_ticket',
            action: 'create_ticket',
            context
        })) {
            window.showToast?.('当前账号未分配「售后工单」模块权限', 'warning');
            return false;
        }
        if (!this.canCreateUserContextTicket(context)) {
            window.showToast?.('当前会话暂不适合直接转售后工单', 'info');
            return false;
        }

        const note = String(window.prompt('可选：填写转售后补充说明', '') || '').trim();
        const headers = await this.getOpsAlertCaseApiHeaders();
        const response = await fetch('/api/admin/tickets/create', {
            method: 'POST',
            headers,
            body: JSON.stringify(this.buildChatSessionTicketPayload(context, note))
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || '转售后工单失败');
        }

        const ticket = payload.ticket && typeof payload.ticket === 'object' ? payload.ticket : null;
        if (ticket && context.cacheKey) {
            const nextContext = {
                ...context,
                tickets: [ticket, ...(Array.isArray(context.tickets) ? context.tickets : [])]
                    .filter(Boolean)
                    .slice(0, 3)
            };
            this.userContextCache.set(context.cacheKey, nextContext);
            this.currentUserContext = nextContext;
            const ticketEntry = this.buildUserContextWorkbenchEntry('ticket', {
                ticketId: String(ticket.id || '').trim(),
                ticketStatus: ticket.status || ''
            });
            this.rememberUserContextAction(nextContext, {
                label: '处理工单',
                workspaceKey: ticketEntry?.workspaceKey || 'tickets-pending',
                context: ticketEntry?.context || {
                    ticketId: String(ticket.id || '').trim(),
                    targetId: String(ticket.id || '').trim(),
                    target_id: String(ticket.id || '').trim(),
                    referenceLabel: '工单号',
                    referenceValue: String(ticket.id || '').trim()
                },
                _contextCacheKey: context.cacheKey
            });
            this.renderUser360Context(nextContext);
        }

        window.showToast?.(payload.message || `已转工单：${payload.ticket_id || '已创建'}`, 'success');
        return true;
    }

    getDefaultReplyTemplateDefinitions() {
        return [{
            id: 'ack',
            business_type: 'general',
            enabled: true,
            label: '先接手',
            hint: '先稳住用户预期',
            text: '这边已看到你的消息，我先帮你核对一下当前记录，稍后给你明确处理结果。'
        }, {
            id: 'order',
            business_type: 'order',
            enabled: true,
            label: '订单说明',
            hint: '最近订单 {{order_status}}',
            text: '我这边看到你最近的订单「{{order_name}}」当前状态是{{order_status}}，我先继续帮你核对处理进度，稍后给你明确反馈。'
        }, {
            id: 'payment',
            business_type: 'payment',
            enabled: true,
            label: '充值核对',
            hint: '最近充值 {{payment_status}}',
            text: '我这边看到你最近的充值记录当前是{{payment_status}}，先帮你核对到账和处理链路，稍后回复你。'
        }, {
            id: 'verify',
            business_type: 'verification',
            enabled: true,
            label: '验证跟进',
            hint: '最近验证 {{verification_status}}',
            text: '我这边看到最近验证任务状态是{{verification_status}}，先帮你核对当前提示和处理进度，稍后给你更新。'
        }, {
            id: 'ticket',
            business_type: 'ticket',
            enabled: true,
            label: '工单跟进',
            hint: '售后工单 {{ticket_status}}',
            text: '我这边看到最近售后工单目前是{{ticket_status}}，已经接手继续跟进，有结果会第一时间回复你。'
        }];
    }

    normalizeReplyTemplateBusinessType(value = 'general') {
        const normalized = String(value || '').trim().toLowerCase();
        return ['general', 'order', 'payment', 'verification', 'ticket'].includes(normalized)
            ? normalized
            : 'general';
    }

    normalizeReplyTemplateDefinitions(templates) {
        if (!Array.isArray(templates)) {
            return this.getDefaultReplyTemplateDefinitions();
        }
        if (!templates.length) {
            return [];
        }

        const defaults = this.getDefaultReplyTemplateDefinitions();
        const normalized = [];
        templates.forEach((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return;
            }

            const businessType = this.normalizeReplyTemplateBusinessType(
                item.business_type || item.businessType || item.type
            );
            const fallback = defaults.find((candidate) => candidate.id === String(item.id || '').trim())
                || defaults.find((candidate) => candidate.business_type === businessType)
                || null;
            const text = String(item.text || '').trim();
            if (!text) {
                return;
            }

            normalized.push({
                id: String(item.id || fallback?.id || `template_${normalized.length + 1}`).trim() || `template_${normalized.length + 1}`,
                business_type: businessType,
                enabled: item.enabled !== false,
                label: String(item.label || '').trim() || fallback?.label || '快捷回复',
                hint: String(item.hint || '').trim(),
                text
            });
        });

        return normalized.slice(0, 12);
    }

    getReplyTemplateDefinitions() {
        return this.normalizeReplyTemplateDefinitions(this.replyTemplateConfigTemplates);
    }

    buildReplyTemplateContextState(context = {}) {
        const latestOrder = this.getLatestUserContextRecord(context.orders);
        const latestPayment = this.getLatestUserContextRecord(context.payments);
        const latestVerification = this.getLatestUserContextRecord(context.verifications);
        const latestTicket = this.getLatestUserContextRecord(context.tickets);
        const openTicket = (Array.isArray(context.tickets) ? context.tickets : [])
            .find((ticket) => !['resolved', 'rejected'].includes(String(ticket?.status || '').trim().toLowerCase()));
        const activeTicket = openTicket || latestTicket;

        return {
            availability: {
                general: true,
                order: Boolean(latestOrder),
                payment: Boolean(latestPayment),
                verification: Boolean(latestVerification),
                ticket: Boolean(activeTicket)
            },
            placeholders: {
                order_name: latestOrder ? this.truncateText(latestOrder.snapshot_product_name || '最近订单', 16) : '最近订单',
                order_status: latestOrder ? this.formatUserContextStatus(latestOrder.delivery_status || latestOrder.refund_status) : '处理中',
                payment_status: latestPayment ? this.formatUserContextStatus(latestPayment.status) : '处理中',
                verification_status: latestVerification ? this.formatUserContextStatus(latestVerification.status) : '处理中',
                ticket_status: activeTicket ? this.formatUserContextStatus(activeTicket.status) : '处理中'
            }
        };
    }

    interpolateReplyTemplateText(templateText = '', placeholders = {}) {
        return String(templateText || '').replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, rawKey) => {
            const key = String(rawKey || '').trim().toLowerCase();
            return String(placeholders[key] ?? '').trim();
        }).replace(/\s{2,}/g, ' ').trim();
    }

    async ensureReplyTemplateConfigLoaded(force = false) {
        if (!force && this.replyTemplateConfigPromise) {
            return this.replyTemplateConfigPromise;
        }

        const now = Date.now();
        if (!force && this.replyTemplateConfigLoadedAt && (now - this.replyTemplateConfigLoadedAt) < 5 * 60 * 1000) {
            return false;
        }

        this.replyTemplateConfigPromise = (async () => {
            try {
                const config = await this.fetchOpsAlertSettingsConfig();
                const nextTemplates = this.normalizeReplyTemplateDefinitions(config?.customer_chat_message?.quick_reply_templates);
                const previousSnapshot = JSON.stringify(Array.isArray(this.replyTemplateConfigTemplates) ? this.replyTemplateConfigTemplates : null);
                const nextSnapshot = JSON.stringify(nextTemplates);
                this.replyTemplateConfigTemplates = nextTemplates;
                this.replyTemplateConfigLoadedAt = Date.now();
                return previousSnapshot !== nextSnapshot;
            } catch (error) {
                this.replyTemplateConfigLoadedAt = Date.now();
                console.warn('[AdminChat] Failed to load quick reply templates:', error);
                return false;
            } finally {
                this.replyTemplateConfigPromise = null;
            }
        })();

        return this.replyTemplateConfigPromise;
    }

    handleOpsAlertConfigUpdated(event = {}) {
        const config = event?.detail?.config && typeof event.detail.config === 'object'
            ? event.detail.config
            : null;
        this.replyTemplateConfigTemplates = this.normalizeReplyTemplateDefinitions(
            config?.customer_chat_message?.quick_reply_templates
        );
        this.replyTemplateConfigLoadedAt = Date.now();
        this.renderReplyTemplateBar(this.currentUserContext || null);
    }

    getReplyTemplateDrafts(context = {}) {
        if (!this.currentSessionId || this.isOpsAlertSessionId(this.currentSessionId)) {
            return [];
        }

        const templateState = this.buildReplyTemplateContextState(context || {});
        return this.getReplyTemplateDefinitions()
            .filter((template) => template.enabled !== false && templateState.availability[template.business_type] !== false)
            .map((template, index) => ({
                key: String(template.id || `template_${index + 1}`).trim() || `template_${index + 1}`,
                label: this.interpolateReplyTemplateText(template.label, templateState.placeholders) || `快捷回复 ${index + 1}`,
                hint: this.interpolateReplyTemplateText(template.hint, templateState.placeholders),
                text: this.interpolateReplyTemplateText(template.text, templateState.placeholders)
            }))
            .filter((template) => template.text);
    }

    applyReplyTemplate(template = {}) {
        const input = document.getElementById('adminChatInput');
        const templateText = String(template.text || '').trim();
        if (!input || input.disabled || !templateText) {
            return;
        }

        const currentValue = String(input.value || '');
        const separator = currentValue.trim() ? '\n' : '';
        input.value = `${currentValue}${separator}${templateText}`;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    renderReplyTemplateBar(context = null) {
        const bar = document.getElementById('chatReplyTemplateBar');
        if (!bar) return;

        const renderToken = (this._replyTemplateRenderToken || 0) + 1;
        this._replyTemplateRenderToken = renderToken;
        const renderTemplates = () => this.getReplyTemplateDrafts(context || {});
        const templates = renderTemplates();
        bar.replaceChildren();

        if (!templates.length) {
            bar.hidden = true;
        } else {
            const label = document.createElement('div');
            label.className = 'chat-reply-templates__label';
            label.textContent = '快捷回复';
            bar.appendChild(label);

            const list = document.createElement('div');
            list.className = 'chat-reply-templates__list';

            templates.forEach((template) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'chat-reply-template-btn';
                button.innerHTML = `
                    <span class="chat-reply-template-btn__label">${this.escapeHtml(template.label)}</span>
                    <span class="chat-reply-template-btn__hint">${this.escapeHtml(template.hint || '插入到回复框')}</span>
                `;
                button.addEventListener('click', () => this.applyReplyTemplate(template));
                list.appendChild(button);
            });

            bar.appendChild(list);
            bar.hidden = false;
        }

        this.updateChatContextPanelLayout();

        this.ensureReplyTemplateConfigLoaded()
            .then((changed) => {
                if (changed && this._replyTemplateRenderToken === renderToken) {
                    this.renderReplyTemplateBar(context);
                }
            })
            .catch(() => {});
    }

    createUserContextActionsSection(context = {}) {
        const actions = this.getUserContextQuickActions(context);
        if (!actions.length) {
            return null;
        }

        const iconMap = {
            user: 'fa-user',
            order: 'fa-bag-shopping',
            ticket: 'fa-life-ring',
            create_ticket: 'fa-ticket',
            payment_read: 'fa-check-double',
            payment: 'fa-wallet',
            verify: 'fa-shield-halved'
        };

        const section = document.createElement('section');
        section.className = 'user-context-section user-context-section--actions';

        const heading = document.createElement('div');
        heading.className = 'user-context-section__title';
        heading.textContent = '快捷动作';
        section.appendChild(heading);

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'user-context-actions';

        actions.forEach((action) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `user-context-action-btn user-context-action-btn--${action.key}${this.isUserContextActionRecent(context, action) ? ' user-context-action-btn--recent' : ''}`;
            button.innerHTML = `
                <span class="user-context-action-btn__icon"><i class="fas ${iconMap[action.key] || 'fa-arrow-up-right-from-square'}"></i></span>
                <span class="user-context-action-btn__text">
                    <span class="user-context-action-btn__title">${this.escapeHtml(action.label)}</span>
                    <span class="user-context-action-btn__hint">${this.escapeHtml(action.hint || '打开对应工作区')}</span>
                </span>
            `;
            button.addEventListener('click', () => {
                this.handleUserContextAction({
                    ...action,
                    _contextCacheKey: context.cacheKey || ''
                });
            });
            actionsWrap.appendChild(button);
        });

        section.appendChild(actionsWrap);
        return section;
    }

    async handleUserContextAction(action = {}) {
        if (String(action.action || action.key || '').trim().toLowerCase() === 'payment_read') {
            const context = this.currentUserContext || {};
            const target = this.getPendingPaymentReadTarget(context);
            return this.markPendingPaymentRead(target || {}, context);
        }

        if (String(action.action || action.key || '').trim().toLowerCase() === 'create_ticket') {
            try {
                return await this.handleCreateUserContextTicket(this.currentUserContext || {});
            } catch (error) {
                console.error('[AdminChat] Failed to create chat session ticket:', error);
                window.showToast?.(`转工单失败: ${error.message || '未知错误'}`, 'error');
                return false;
            }
        }

        const workspaceKey = String(action.workspaceKey || '').trim();
        if (!workspaceKey) {
            window.showToast?.('当前动作缺少目标工作区', 'warning');
            return false;
        }
        if (!this.canAccessWorkbenchAction(action)) {
            if (this.currentUserContext) {
                this.renderUser360Context(this.currentUserContext);
            }
            return false;
        }

        try {
            let result = false;
            const launcher = this.getWorkbenchLauncher();
            if (typeof launcher === 'function') {
                result = await this.openWorkbenchEntry(workspaceKey, action.context || {});
            } else {
                window.showToast?.('当前页面暂时无法打开对应工作区', 'warning');
                result = false;
            }
            if (result) {
                this.rememberUserContextAction(this.currentUserContext || {}, action);
            }
            return result;
        } catch (error) {
            console.error('[AdminChat] Failed to open user context workspace:', error);
            window.showToast?.(`打开失败: ${error.message || '未知错误'}`, 'error');
            return false;
        }
    }

    buildUserContextTimelineAction(kind = '', item = {}, context = {}) {
        if (!item || typeof item !== 'object') return null;

        if (kind === 'order') {
            const orderId = String(item.id || '').trim();
            const entry = this.buildUserContextWorkbenchEntry('order', {
                orderId,
                referenceLabel: '订单',
                referenceValue: orderId
            });
            if (!entry) return null;
            return {
                key: 'order',
                label: '打开订单',
                workspaceKey: entry.workspaceKey,
                context: entry.context
            };
        }

        if (kind === 'payment') {
            const paymentId = String(item.id || '').trim();
            const paymentUserId = String(item.user_id || context.userId || '').trim();
            const paymentUserReference = String(paymentUserId || context.email || '').trim();
            const entry = this.buildUserContextWorkbenchEntry('payment', {
                userId: paymentUserId,
                email: context.email || '',
                paymentOrderId: paymentId,
                packageName: item.package_name || '',
                referenceLabel: paymentUserReference
                    ? (paymentUserId ? '支付单' : '邮箱')
                    : (paymentId ? '支付单' : '充值'),
                referenceValue: paymentUserReference
                    ? (paymentUserId
                        ? (paymentId || String(item.package_name || '最近充值').trim())
                        : paymentUserReference)
                    : (paymentId || String(item.package_name || '最近充值').trim())
            });
            if (!entry) return null;
            return {
                key: 'payment',
                label: '查看充值记录',
                workspaceKey: entry.workspaceKey,
                context: entry.context
            };
        }

        if (kind === 'verify') {
            const verificationId = String(item.verification_id || '').trim();
            const entry = this.buildUserContextWorkbenchEntry('verify', {
                verificationId,
                referenceLabel: '验证任务',
                referenceValue: verificationId
            });
            if (!entry) return null;
            return {
                key: 'verify',
                label: '打开验证面板',
                workspaceKey: entry.workspaceKey,
                context: entry.context
            };
        }

        if (kind === 'ticket') {
            const isResolved = String(item.status || '').trim().toLowerCase() === 'resolved';
            const entry = this.buildUserContextWorkbenchEntry('ticket', {
                ticketId: String(item.id || '').trim(),
                ticketStatus: item.status || ''
            });
            if (!entry) return null;
            return {
                key: 'ticket',
                label: isResolved ? '查看工单' : '处理工单',
                workspaceKey: entry.workspaceKey,
                context: entry.context
            };
        }

        return null;
    }

    buildUserContextTimelineEntries(context = {}) {
        const entries = [];

        (Array.isArray(context.orders) ? context.orders : []).forEach((order) => {
            const action = this.buildUserContextTimelineAction('order', order, context);
            const accessibleAction = action && this.canAccessWorkbenchAction(action)
                ? { ...action, _contextCacheKey: context.cacheKey || '' }
                : null;
            entries.push({
                kind: 'order',
                label: '订单',
                time: String(order.created_at || '').trim(),
                title: this.truncateText(order.snapshot_product_name || `订单 ${String(order.id || '').slice(0, 8)}`, 48),
                meta: `${this.formatUserContextPoints(order.price_paid)} · ${this.formatUserContextStatus(order.delivery_status || order.refund_status)}`,
                action: accessibleAction,
                isRecent: accessibleAction ? this.isUserContextActionRecent(context, accessibleAction) : false
            });
        });

        (Array.isArray(context.payments) ? context.payments : []).forEach((payment) => {
            const action = this.buildUserContextTimelineAction('payment', payment, context);
            const accessibleAction = action && this.canAccessWorkbenchAction(action)
                ? { ...action, _contextCacheKey: context.cacheKey || '' }
                : null;
            entries.push({
                kind: 'payment',
                label: '充值',
                time: String(payment.created_at || '').trim(),
                title: this.truncateText(payment.package_name || `支付单 ${String(payment.id || '').slice(0, 8)}`, 48),
                meta: `${this.formatUserContextCurrency(payment.paid_amount, this.formatUserContextCurrency(payment.expected_amount))} · ${this.formatUserContextStatus(payment.status)}`,
                action: accessibleAction,
                isRecent: accessibleAction ? this.isUserContextActionRecent(context, accessibleAction) : false
            });
        });

        (Array.isArray(context.verifications) ? context.verifications : []).forEach((item) => {
            const action = this.buildUserContextTimelineAction('verify', item, context);
            const accessibleAction = action && this.canAccessWorkbenchAction(action)
                ? { ...action, _contextCacheKey: context.cacheKey || '' }
                : null;
            entries.push({
                kind: 'verify',
                label: '验证',
                time: String(item.created_at || '').trim(),
                title: this.truncateText(this.getUserContextVerificationSubmitterLabel(item, context), 48),
                meta: `${this.formatUserContextStatus(item.status)} · ${this.getUserContextVerificationReferenceLabel(item)} · ${this.truncateText(item.message || '暂无描述', 30)}`,
                action: accessibleAction,
                isRecent: accessibleAction ? this.isUserContextActionRecent(context, accessibleAction) : false
            });
        });

        (Array.isArray(context.tickets) ? context.tickets : []).forEach((ticket) => {
            const action = this.buildUserContextTimelineAction('ticket', ticket, context);
            const accessibleAction = action && this.canAccessWorkbenchAction(action)
                ? { ...action, _contextCacheKey: context.cacheKey || '' }
                : null;
            entries.push({
                kind: 'ticket',
                label: '工单',
                time: String(ticket.created_at || '').trim(),
                title: this.truncateText(ticket.description || `工单 ${String(ticket.id || '').slice(0, 8)}`, 48),
                meta: `${this.formatUserContextStatus(ticket.status)}${ticket.order_id ? ` · 订单 ${String(ticket.order_id).slice(0, 8)}` : ''}`,
                action: accessibleAction,
                isRecent: accessibleAction ? this.isUserContextActionRecent(context, accessibleAction) : false
            });
        });

        return entries
            .sort((left, right) => {
                const leftTime = left.time ? Date.parse(left.time) : 0;
                const rightTime = right.time ? Date.parse(right.time) : 0;
                return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
            })
            .slice(0, 6);
    }

    createUserContextTimelineSection(entries = []) {
        const section = document.createElement('section');
        section.className = 'user-context-section user-context-section--timeline';

        const heading = document.createElement('div');
        heading.className = 'user-context-section__title';
        heading.textContent = '业务时间线';
        section.appendChild(heading);

        if (!entries.length) {
            const empty = document.createElement('div');
            empty.className = 'user-context-section__empty';
            empty.textContent = '最近还没有可串起来的业务记录';
            section.appendChild(empty);
            return section;
        }

        const timeline = document.createElement('div');
        timeline.className = 'user-context-timeline';

        entries.forEach((entry) => {
            const item = document.createElement(entry.action ? 'button' : 'div');
            item.className = `user-context-timeline-item user-context-timeline-item--${entry.kind}${entry.action ? ' user-context-timeline-item--actionable' : ''}${entry.isRecent ? ' user-context-timeline-item--recent' : ''}`;
            if (entry.action) {
                item.type = 'button';
                item.title = entry.action.label || '打开对应工作区';
                item.addEventListener('click', () => {
                    this.handleUserContextAction(entry.action);
                });
            }

            const badge = document.createElement('span');
            badge.className = 'user-context-timeline-item__badge';
            badge.textContent = entry.label;
            item.appendChild(badge);

            const body = document.createElement('div');
            body.className = 'user-context-timeline-item__body';

            const main = document.createElement('div');
            main.className = 'user-context-timeline-item__main';
            main.textContent = entry.title;
            body.appendChild(main);

            const sub = document.createElement('div');
            sub.className = 'user-context-timeline-item__sub';
            sub.textContent = `${entry.meta} · ${this.formatUserContextDate(entry.time)}`;
            body.appendChild(sub);

            item.appendChild(body);

            if (entry.action) {
                const jump = document.createElement('span');
                jump.className = 'user-context-timeline-item__jump';
                jump.innerHTML = '<i class="fas fa-arrow-up-right-from-square"></i>';
                item.appendChild(jump);
            }
            timeline.appendChild(item);
        });

        section.appendChild(timeline);
        return section;
    }

    renderUser360Context(context = null) {
        const panel = document.getElementById('chatContextPanel');
        if (!panel) return;
        if (!context) {
            panel.hidden = true;
            panel.replaceChildren();
            this.renderUserContextHeaderStatus(null);
            this.renderReplyTemplateBar(null);
            this.updateChatContextPanelLayout();
            return;
        }

        panel.hidden = false;
        panel.className = 'chat-context-panel';
        panel.replaceChildren();
        this.renderUserContextHeaderStatus(context);
        this.renderReplyTemplateBar(context);

        const shell = document.createElement('section');
        shell.className = 'user-context-shell';

        const shellToggle = document.createElement('button');
        shellToggle.type = 'button';
        shellToggle.className = 'user-context-shell__toggle';
        shellToggle.id = 'userContextPanelToggle';
        shellToggle.setAttribute('data-user-context-panel-toggle', 'true');
        shellToggle.innerHTML = `
            <span class="user-context-shell__toggle-copy">
                <span class="user-context-shell__eyebrow">用户 360</span>
                <strong class="user-context-shell__title">账号、订单、工单与业务时间线</strong>
                <span class="user-context-shell__summary">${this.escapeHtml(this.getUserContextPanelSummaryText(context))}</span>
            </span>
            <span class="user-context-shell__toggle-side">
                <span class="user-context-shell__toggle-text">展开</span>
                <i class="fas fa-chevron-down user-context-shell__toggle-icon" aria-hidden="true"></i>
            </span>
        `;
        shellToggle.addEventListener('click', () => {
            this.setUserContextPanelCollapsed(!this.userContextPanelCollapsed);
        });
        shell.appendChild(shellToggle);

        const shellBody = document.createElement('div');
        shellBody.className = 'user-context-shell__body';
        shellBody.id = 'userContextPanelBody';

        const shellBodyInner = document.createElement('div');
        shellBodyInner.className = 'user-context-shell__body-inner';
        shellBody.appendChild(shellBodyInner);
        shell.appendChild(shellBody);

        const card = document.createElement('div');
        card.className = 'user-context-card';

        const summary = document.createElement('div');
        summary.className = 'user-context-summary';
        [
            { label: '账号状态', value: context.accountState },
            { label: '用户邮箱', value: context.email || '未识别邮箱' },
            { label: '用户 UUID', value: context.userId || this.truncateText(context.sessionId || '未绑定账号', 32) }
        ].forEach((item) => {
            const pill = document.createElement('div');
            pill.className = 'user-context-pill';
            pill.innerHTML = `<span class="user-context-pill__label">${this.escapeHtml(item.label)}</span><strong class="user-context-pill__value">${this.escapeHtml(item.value)}</strong>`;
            summary.appendChild(pill);
        });
        card.appendChild(summary);

        const headline = this.createUserContextHeadline(context);
        if (headline) {
            card.appendChild(headline);
        }

        const recentActionBanner = this.createUserContextRecentActionBanner(context);
        if (recentActionBanner) {
            card.appendChild(recentActionBanner);
        }

        const actionsSection = this.createUserContextActionsSection(context);
        if (actionsSection) {
            card.appendChild(actionsSection);
        }

        const grid = document.createElement('div');
        grid.className = 'user-context-grid';

        grid.appendChild(this.createUserContextSection('最近订单', context.orders.map((order) => ({
            main: this.truncateText(order.snapshot_product_name || `订单 ${String(order.id || '').slice(0, 8)}`, 42),
            sub: `${this.formatUserContextPoints(order.price_paid)} · ${this.formatUserContextStatus(order.delivery_status || order.refund_status)} · ${this.formatUserContextDate(order.created_at)}`
        })), '最近没有商城订单'));

        grid.appendChild(this.createUserContextSection('最近充值', context.payments.map((payment) => ({
            main: this.truncateText(payment.package_name || `支付单 ${String(payment.id || '').slice(0, 8)}`, 42),
            sub: `${this.formatUserContextCurrency(payment.paid_amount, this.formatUserContextCurrency(payment.expected_amount))} · ${this.formatUserContextStatus(payment.status)} · ${this.formatUserContextDate(payment.created_at)}`
        })), '最近没有充值记录'));

        grid.appendChild(this.createUserContextSection('验证任务', context.verifications.map((item) => ({
            main: this.truncateText(this.getUserContextVerificationSubmitterLabel(item, context), 42),
            sub: `${this.formatUserContextStatus(item.status)} · ${this.getUserContextVerificationReferenceLabel(item)} · ${this.truncateText(item.message || '暂无描述', 26)} · ${this.formatUserContextDate(item.created_at)}`
        })), '最近没有验证记录'));

        grid.appendChild(this.createUserContextSection('售后工单', context.tickets.map((ticket) => ({
            main: this.truncateText(ticket.description || `工单 ${String(ticket.id || '').slice(0, 8)}`, 42),
            sub: `${this.formatUserContextStatus(ticket.status)}${ticket.order_id ? ` · 订单 ${String(ticket.order_id).slice(0, 8)}` : ''} · ${this.formatUserContextDate(ticket.created_at)}`
        })), '最近没有售后工单'));

        card.appendChild(grid);
        card.appendChild(this.createUserContextTimelineSection(this.buildUserContextTimelineEntries(context)));
        shellBodyInner.appendChild(card);
        panel.appendChild(shell);
        this.initScrollbarAutoHide(panel);
        this.setUserContextPanelCollapsed(this.userContextPanelCollapsed);
        this.updateChatContextPanelLayout();
    }

    async refreshCurrentUserContext({ silent = true } = {}) {
        const session = this.currentSessionInfo;
        const activeSessionId = String(this.currentSessionId || '').trim();
        if (!session || !activeSessionId || this.isOpsAlertSessionId(activeSessionId)) {
            return null;
        }

        const cacheKey = this.buildUserContextCacheKey(session);
        this.userContextCache.delete(cacheKey);

        if (!silent) {
            this.renderUserContextPanelState('正在整理用户上下文...', 'loading');
        }

        const requestId = ++this._userContextRequestId;

        try {
            const context = await this.fetchUser360Context(session);
            if (requestId !== this._userContextRequestId || String(this.currentSessionId || '').trim() !== activeSessionId) {
                return null;
            }
            this.currentUserContext = context;
            this.renderUser360Context(context);
            return context;
        } catch (error) {
            if (!silent && requestId === this._userContextRequestId && String(this.currentSessionId || '').trim() === activeSessionId) {
                this.currentUserContext = null;
                this.renderUserContextPanelState('暂时无法读取用户上下文', 'error');
            }
            return null;
        }
    }

    async handleTicketRealtimeChange(ticket = {}) {
        const currentUserId = String(this.currentUserContext?.userId || '').trim();
        const ticketUserId = String(ticket?.user_id || '').trim();
        if (ticketUserId) {
            await this.refreshSessionOperationalSummariesForUserIds([ticketUserId]);
        }
        if (!currentUserId || !ticketUserId || currentUserId !== ticketUserId) {
            return;
        }

        await this.refreshCurrentUserContext({ silent: true });
    }

    async handlePaymentRealtimeChange(payment = {}) {
        const currentUserId = String(this.currentUserContext?.userId || '').trim();
        const paymentUserId = String(payment?.user_id || '').trim();
        if (paymentUserId) {
            await this.refreshSessionOperationalSummariesForUserIds([paymentUserId]);
        }
        if (!currentUserId || !paymentUserId || currentUserId !== paymentUserId) {
            return;
        }

        await this.refreshCurrentUserContext({ silent: true });
    }

    async handleVerificationRealtimeChange(entry = {}) {
        const currentUserId = String(this.currentUserContext?.userId || '').trim();
        const verificationUserId = String(entry?.user_id || '').trim();
        if (verificationUserId) {
            await this.refreshSessionOperationalSummariesForUserIds([verificationUserId]);
        }
        if (!currentUserId || !verificationUserId || currentUserId !== verificationUserId) {
            return;
        }

        await this.refreshCurrentUserContext({ silent: true });
    }

    getOpsAlertActiveCount() {
        return (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .filter((alert) => !this.isOpsAlertClosed(alert))
            .length;
    }

    getOpsAlertMutedModuleCount() {
        return new Set(
            (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
                .filter((alert) => alert.moduleMuteActive && alert.caseCategoryKey)
                .map((alert) => String(alert.caseCategoryKey || '').trim().toLowerCase())
                .filter(Boolean)
        ).size;
    }

    getOpsAlertOwnerSummary(limit = 2) {
        const owners = Array.from(new Set(
            (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
                .filter((alert) => !this.isOpsAlertClosed(alert))
                .map((alert) => String(alert.case_owner_label || '').trim())
                .filter(Boolean)
        ));

        if (!owners.length) {
            return '';
        }

        const visibleOwners = owners.slice(0, Math.max(1, limit));
        const remaining = owners.length - visibleOwners.length;
        return `负责人：${visibleOwners.join('、')}${remaining > 0 ? ` +${remaining}` : ''}`;
    }

    getOpsAlertSeverityLabel(severity = 'warning') {
        const normalized = String(severity || 'warning').trim().toLowerCase();
        const labelMap = {
            info: '提示',
            warning: '告警',
            critical: '紧急'
        };
        return labelMap[normalized] || '告警';
    }

    getOpsAlertStatusLabel(alert = {}) {
        const normalized = String(alert.status || 'pending').trim().toLowerCase();
        if (normalized === 'delivered') return '站外已发送';
        if (normalized === 'dead_letter') return '站外发送失败';
        if (normalized === 'retry') return '站外重试中';
        if (normalized === 'processing') return '站外发送中';
        return '等待站外发送';
    }

    getOpsAlertActionLabel(alert = {}) {
        const kind = String(alert.workspace?.kind || '').trim().toLowerCase();
        if (kind === 'chat-session') {
            return String(alert.workspace?.context?.sessionId || alert.workspace?.context?.session_id || '').trim()
                ? '查看会话'
                : '打开消息';
        }
        if (kind === 'shop-orders') {
            return '查看订单';
        }
        if (kind === 'ops-workspace') {
            const workspaceKey = String(alert.workspace?.workspaceKey || '').trim().toLowerCase();
            const labelMap = {
                'payments-overview': '查看最近订单',
                'payments-ops': '处理异常',
                'verify-monitor': '查看验证面板',
                'admin-audit-monitor': '查看审计',
                'tickets-pending': '处理工单',
                'tickets-resolved': '查看工单',
                'shop-inventory': '处理库存',
                'shop-fulfillment': '处理履约',
                'shop-risk-orders': '查看订单',
                'shop-risk-discounts': '查看优惠码',
                'shop-risk-users': '查看用户'
            };
            return labelMap[workspaceKey] || '前往处理';
        }
        return '暂无处理页';
    }

    extractEntryPathFromContent(content = '') {
        return String(content || '')
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.startsWith('处理入口：'))
            ?.replace(/^处理入口：/, '')
            .trim() || '';
    }

    stripEntryPathFromContent(content = '') {
        return String(content || '')
            .split('\n')
            .filter((line) => !String(line || '').trim().startsWith('处理入口：'))
            .join('\n')
            .trim();
    }

    buildOpsAlertFallbackContent(alertType = '', payload = {}, title = '') {
        const normalizedAlertType = String(alertType || '').trim().toLowerCase();
        if (normalizedAlertType !== 'verify_service_disabled') {
            return '';
        }

        const apiBaseUrl = String(payload.api_base_url || '').trim().replace(/\/+$/, '');
        const upstreamEndpoint = String(payload.upstream_endpoint || '').trim()
            || (apiBaseUrl ? (/\/openapi$/i.test(apiBaseUrl) ? apiBaseUrl : `${apiBaseUrl}/openapi`) : '');
        const lines = [];
        if (payload.service_status_label) lines.push(`当前状态：${String(payload.service_status_label || '').trim()}`);
        if (payload.key_name) lines.push(`API Key：${String(payload.key_name || '').trim()}`);
        if (payload.api_base_url) lines.push(`API Base：${String(payload.api_base_url || '').trim()}`);
        if (upstreamEndpoint) lines.push(`请求地址：${upstreamEndpoint}`);
        if (payload.last_error) lines.push(`最近错误：${String(payload.last_error || '').trim()}`);
        const responseStatus = Number(payload.response_status);
        if (Number.isFinite(responseStatus) && responseStatus > 0) lines.push(`响应状态：${responseStatus}`);
        if (payload.checked_at) lines.push(`检查时间：${String(payload.checked_at || '').trim()}`);
        if (payload.entry_path) lines.push(`处理入口：${String(payload.entry_path || '').trim()}`);

        return lines.filter(Boolean).join('\n') || String(title || '').trim();
    }

    buildOpsAlertPreview(alert = {}) {
        const title = String(alert.title || '').trim();
        if (title) {
            return `${this.getOpsAlertSeverityLabel(alert.severity)} · ${title}`;
        }

        const firstLine = this.stripEntryPathFromContent(alert.content || '')
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean);
        if (firstLine) {
            return `${this.getOpsAlertSeverityLabel(alert.severity)} · ${firstLine}`;
        }

        return '站外告警同步';
    }

    isOpsAlertClosed(alert = {}) {
        const caseStatus = String(alert.case_status || '').trim().toLowerCase();
        const queueStatus = String(alert.status || '').trim().toLowerCase();
        return caseStatus === 'resolved' || ['suppressed', 'handled', 'ignored'].includes(queueStatus);
    }

    getOpsAlertReferenceLabel(payload = {}) {
        if (payload.ticket_id) return '工单号';
        if (payload.order_id) return '订单号';
        if (payload.payment_order_id) return '充值单号';
        if (payload.verification_id) return '验证任务';
        if (payload.product_id) return '商品';
        if (payload.provider_order_no) return '支付单号';
        if (payload.message_id) return '消息ID';
        if (payload.session_id) return '会话ID';
        if (payload.user_id) return '用户ID';
        if (payload.admin_id || payload.admin_email) return '管理员';
        if (payload.email || payload.user_email || payload.sender_email) return '邮箱';
        if (payload.target_id) return '目标';
        return '';
    }

    getOpsAlertReferenceValue(payload = {}) {
        return String(
            payload.ticket_id
            || payload.order_id
            || payload.payment_order_id
            || payload.verification_id
            || payload.product_id
            || payload.provider_order_no
            || payload.message_id
            || payload.session_id
            || payload.user_id
            || payload.admin_email
            || payload.admin_id
            || payload.email
            || payload.user_email
            || payload.sender_email
            || payload.target_id
            || ''
        ).trim();
    }

    buildOpsAlertSummaryTargetId(payload = {}, options = {}) {
        const summaryAlertType = String(options.alertType || payload.summary_type || '').trim().toLowerCase();
        if (!summaryAlertType || !summaryAlertType.endsWith('_summary')) {
            return '';
        }
        return `ops_summary:${summaryAlertType}`;
    }

    buildOpsAlertLegacySummaryTargetId(payload = {}, options = {}) {
        const summaryAlertType = String(options.alertType || payload.summary_type || '').trim().toLowerCase();
        const summaryDedupeKey = String(options.dedupeKey || payload.summary_dedupe_key || payload.dedupe_key || '').trim();
        if (!summaryAlertType || !summaryDedupeKey || !summaryAlertType.endsWith('_summary')) {
            return '';
        }
        return `ops_summary:${summaryAlertType}:${summaryDedupeKey}`;
    }

    getOpsAlertTargetId(payload = {}, options = {}) {
        const summaryTargetId = this.buildOpsAlertSummaryTargetId(payload, options);
        const payloadTargetId = String(payload.target_id || '').trim();
        if (summaryTargetId && (!payloadTargetId || payloadTargetId === summaryTargetId || payloadTargetId.startsWith(`${summaryTargetId}:`))) {
            return summaryTargetId;
        }
        return String(
            payloadTargetId
            || payload.order_id
            || payload.payment_order_id
            || payload.ticket_id
            || payload.verification_id
            || payload.product_id
            || payload.admin_id
            || payload.message_id
            || summaryTargetId
            || payload.id
            || ''
        ).trim();
    }

    getOpsAlertCaseCategoryKey(alertType = '', targetId = '') {
        const normalizedAlertType = String(alertType || '').trim().toLowerCase();
        const normalizedTargetId = String(targetId || '').trim().toLowerCase();
        if (normalizedTargetId.startsWith('shop_order_risk:')) {
            return 'shop_risk';
        }

        const categoryMap = {
            customer_chat_message_received: 'customer_engagement',
            customer_chat_message_summary: 'customer_engagement',
            shop_purchase_succeeded: 'commerce',
            shop_purchase_summary: 'commerce',
            wallet_recharge_succeeded: 'commerce',
            wallet_recharge_summary: 'commerce',
            shop_inventory_summary: 'inventory',
            shop_inventory_low: 'inventory',
            shop_inventory_empty: 'inventory',
            shop_inventory_recovered: 'inventory',
            payment_gateway_summary: 'payments',
            payment_gateway_degraded: 'payments',
            payment_gateway_recovered: 'payments',
            payment_refund_ops: 'payments',
            payment_refund_alert: 'payments',
            payment_config_changed: 'payments',
            payment_config_recovered: 'payments',
            payment_config_incident: 'payments',
            payment_config_incident_recovered: 'payments',
            shop_order_risk_anomaly: 'shop_risk',
            shop_order_risk_recovered: 'shop_risk',
            verify_quota_summary: 'verify',
            verify_quota_low: 'verify',
            verify_service_disabled: 'verify',
            verify_failure_summary: 'verify',
            verify_failure_rate_spike: 'verify',
            verify_queue_summary: 'verify',
            verify_queue_backlog: 'verify',
            verify_incident_escalated: 'verify',
            verify_incident_recovered: 'verify',
            ticket_new: 'tickets',
            ticket_sla_summary: 'tickets',
            ticket_sla_overdue: 'tickets',
            ticket_sla_recovered: 'tickets',
            shop_order_delivery_summary: 'fulfillment',
            shop_order_delivery_failed: 'fulfillment',
            shop_order_delivery_recovered: 'fulfillment',
            shop_order_delivery_incident: 'fulfillment',
            shop_order_delivery_incident_recovered: 'fulfillment',
            security_admin_login_anomaly: 'security'
        };

        return categoryMap[normalizedAlertType] || '';
    }

    normalizeOpsAlertCaseSite(value = '', fallback = 'cn') {
        const fallbackText = String(fallback || '').trim().toLowerCase();
        const normalizedFallback = ['cn', 'intl', 'all'].includes(fallbackText)
            ? fallbackText
            : (fallbackText ? 'cn' : '');
        const normalized = String(value || '').trim().toLowerCase();
        if (['cn', 'intl', 'all'].includes(normalized)) {
            return normalized;
        }
        return normalizedFallback;
    }

    getOpsAlertCaseSite(alert = {}) {
        const payload = alert.payload && typeof alert.payload === 'object' && !Array.isArray(alert.payload)
            ? alert.payload
            : {};
        const siteLabels = Array.isArray(payload.site_labels)
            ? payload.site_labels.map((item) => this.normalizeOpsAlertCaseSite(item, '')).filter(Boolean)
            : [];
        if (siteLabels.length === 1) {
            return siteLabels[0];
        }
        if (siteLabels.length > 1) {
            return 'all';
        }
        return this.normalizeOpsAlertCaseSite(alert.caseSite || alert.site || payload.site || payload.site_context, 'cn');
    }

    buildOpsAlertCaseKey(categoryKey = '', targetId = '', site = 'cn') {
        return `${this.normalizeOpsAlertCaseSite(site, 'cn')}::${String(categoryKey || '').trim().toLowerCase()}::${String(targetId || '').trim()}`;
    }

    getOpsAlertCaseTargetIds(alert = {}) {
        const targetIds = [String(alert.caseTargetId || '').trim()];
        const legacySummaryTargetId = this.buildOpsAlertLegacySummaryTargetId(alert.payload || {}, {
            alertType: alert.alertType || alert.alert_type || '',
            dedupeKey: alert.dedupe_key || alert.dedupeKey || ''
        });
        if (legacySummaryTargetId) {
            targetIds.push(legacySummaryTargetId);
        }
        return Array.from(new Set(targetIds.filter(Boolean)));
    }

    getOpsAlertSummaryCaseGroupKey(alert = {}) {
        const alertType = String(alert.alertType || alert.alert_type || alert.payload?.summary_type || '').trim().toLowerCase();
        if (!alertType || !alertType.endsWith('_summary')) {
            return '';
        }
        return `${this.getOpsAlertCaseSite(alert)}::${String(alert.caseCategoryKey || '').trim().toLowerCase()}::${alertType}`;
    }

    pickPreferredOpsAlertCaseRecord(current = null, candidate = null) {
        if (!candidate) {
            return current || null;
        }
        if (!current) {
            return candidate;
        }
        const currentResolved = String(current.status || '').trim().toLowerCase() === 'resolved';
        const candidateResolved = String(candidate.status || '').trim().toLowerCase() === 'resolved';
        if (candidateResolved !== currentResolved) {
            return candidateResolved ? candidate : current;
        }
        const currentTime = Date.parse(current.updated_at || current.last_action_at || current.created_at || '') || 0;
        const candidateTime = Date.parse(candidate.updated_at || candidate.last_action_at || candidate.created_at || '') || 0;
        return candidateTime >= currentTime ? candidate : current;
    }

    buildOpsAlertSummaryFallbackCaseMap(alerts = [], caseMap = new Map()) {
        const summaryCaseByGroup = new Map();
        (Array.isArray(alerts) ? alerts : []).forEach((alert) => {
            const groupKey = this.getOpsAlertSummaryCaseGroupKey(alert);
            if (!groupKey) {
                return;
            }
            this.getOpsAlertCaseTargetIds(alert)
                .filter((targetId) => targetId && targetId !== alert.caseTargetId)
                .forEach((targetId) => {
                    const legacyCase = caseMap.get(this.buildOpsAlertCaseKey(alert.caseCategoryKey, targetId, this.getOpsAlertCaseSite(alert)));
                    if (!legacyCase) {
                        return;
                    }
                    summaryCaseByGroup.set(
                        groupKey,
                        this.pickPreferredOpsAlertCaseRecord(summaryCaseByGroup.get(groupKey), legacyCase)
                    );
                });
        });

        const fallbackMap = new Map();
        (Array.isArray(alerts) ? alerts : []).forEach((alert) => {
            const groupKey = this.getOpsAlertSummaryCaseGroupKey(alert);
            const fallbackCase = groupKey ? summaryCaseByGroup.get(groupKey) : null;
            if (!fallbackCase || !alert.caseCategoryKey || !alert.caseTargetId) {
                return;
            }
            fallbackMap.set(this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId, this.getOpsAlertCaseSite(alert)), {
                ...fallbackCase,
                site: this.getOpsAlertCaseSite(alert),
                category_key: String(alert.caseCategoryKey || '').trim().toLowerCase(),
                target_id: String(alert.caseTargetId || '').trim()
            });
        });
        return fallbackMap;
    }

    isMissingOpsAlertCasesTableError(error) {
        const code = String(error?.code || '').trim().toUpperCase();
        const message = [
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').toLowerCase();
        return (
            code === '42P01'
            || code === 'PGRST205'
            || message.includes('ops_alert_cases')
        );
    }

    isMissingOpsAlertCaseEventsTableError(error) {
        const code = String(error?.code || '').trim().toUpperCase();
        const message = [
            error?.message,
            error?.details,
            error?.hint
        ].filter(Boolean).join(' ').toLowerCase();
        return (
            code === '42P01'
            || code === 'PGRST205'
            || message.includes('ops_alert_case_events')
        );
    }

    getOpsAlertCaseStatusTone(status = '') {
        if (typeof window.getAdminWorkbenchOpsAlertCaseStatusTone === 'function') {
            return window.getAdminWorkbenchOpsAlertCaseStatusTone(status, { variant: 'chat' });
        }
        const normalized = String(status || '').trim().toLowerCase() || 'open';
        if (normalized === 'resolved') return 'resolved';
        if (normalized === 'claimed') return 'claimed';
        return 'open';
    }

    getOpsAlertCaseStatusLabel(status = '') {
        if (typeof window.getAdminWorkbenchOpsAlertCaseStatusLabel === 'function') {
            return window.getAdminWorkbenchOpsAlertCaseStatusLabel(status);
        }
        const normalized = String(status || '').trim().toLowerCase() || 'open';
        const labelMap = {
            open: '待处理',
            claimed: '处理中',
            resolved: '已关闭'
        };
        return labelMap[normalized] || '待处理';
    }

    getOpsAlertCaseEventActionLabel(action = '') {
        if (typeof window.getOpsAlertCaseEventActionLabel === 'function') {
            return window.getOpsAlertCaseEventActionLabel(action);
        }
        const normalized = String(action || '').trim().toLowerCase();
        const labelMap = {
            claim: '认领处理',
            assign: '转交负责人',
            add_note: '记录备注',
            resolve: '关闭告警',
            reopen: '重新打开',
            batch_mute: '批量静默'
        };
        return labelMap[normalized] || normalized || '处置更新';
    }

    mapOpsAlertCaseLastAction(lastAction = '') {
        const normalized = String(lastAction || '').trim().toLowerCase();
        const actionMap = {
            claimed: 'claim',
            assigned: 'assign',
            noted: 'add_note',
            resolved: 'resolve',
            reopened: 'reopen'
        };
        return actionMap[normalized] || '';
    }

    normalizeOpsAlertCaseRecord(row = {}) {
        const categoryKey = String(row.category_key || '').trim().toLowerCase();
        const targetId = String(row.target_id || '').trim();
        if (!categoryKey || !targetId) {
            return null;
        }

        return {
            id: String(row.id || '').trim(),
            site: this.normalizeOpsAlertCaseSite(row.site || row.metadata?.site, 'cn'),
            category_key: categoryKey,
            target_id: targetId,
            status: String(row.status || 'open').trim().toLowerCase() || 'open',
            owner_admin_id: String(row.owner_admin_id || '').trim(),
            owner_label: String(row.owner_label || '').trim(),
            note: String(row.note || '').trim(),
            resolution: String(row.resolution || '').trim(),
            last_action: String(row.last_action || '').trim().toLowerCase(),
            last_action_at: String(row.last_action_at || row.updated_at || row.created_at || '').trim(),
            created_at: String(row.created_at || '').trim(),
            updated_at: String(row.updated_at || row.last_action_at || row.created_at || '').trim()
        };
    }

    normalizeOpsAlertCaseEventRecord(row = {}) {
        const categoryKey = String(row.category_key || '').trim().toLowerCase();
        const targetId = String(row.target_id || '').trim();
        if (!categoryKey || !targetId) {
            return null;
        }

        const action = String(row.action || '').trim().toLowerCase();
        const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {};
        const note = String(row.note || '').trim();
        const resolution = String(row.resolution || '').trim();
        const ownerLabel = String(row.owner_label || '').trim();
        const muteUntil = String(metadata.mute_until || '').trim();
        let summary = '';
        if (action === 'batch_mute' && muteUntil) {
            summary = `已静音至 ${muteUntil}`;
        } else if (action === 'resolve' && resolution) {
            summary = resolution;
        } else if (note) {
            summary = note;
        } else if (['claim', 'assign'].includes(action) && ownerLabel) {
            summary = `负责人 ${ownerLabel}`;
        }

        return {
            id: String(row.id || '').trim(),
            site: this.normalizeOpsAlertCaseSite(row.site || metadata.site, 'cn'),
            category_key: categoryKey,
            target_id: targetId,
            action,
            action_label: String(row.action_label || '').trim() || this.getOpsAlertCaseEventActionLabel(action),
            summary,
            status: String(row.status || '').trim().toLowerCase(),
            owner_admin_id: String(row.owner_admin_id || '').trim(),
            owner_label: ownerLabel,
            actor_admin_id: String(row.actor_admin_id || '').trim(),
            actor_label: String(row.actor_label || '').trim(),
            note,
            resolution,
            metadata,
            created_at: String(row.created_at || '').trim()
        };
    }

    buildOpsAlertFallbackCaseEvent(alert = {}) {
        const caseRecord = alert.caseRecord || null;
        const action = this.mapOpsAlertCaseLastAction(caseRecord?.last_action);
        const createdAt = String(caseRecord?.last_action_at || caseRecord?.updated_at || caseRecord?.created_at || '').trim();
        if (!action || !createdAt) {
            return null;
        }

        const summary = action === 'resolve' && caseRecord?.resolution
            ? String(caseRecord.resolution || '').trim()
            : caseRecord?.note
                ? String(caseRecord.note || '').trim()
                : ['claim', 'assign'].includes(action) && caseRecord?.owner_label
                    ? `负责人 ${String(caseRecord.owner_label || '').trim()}`
                    : '';

        return {
            id: '',
            site: this.getOpsAlertCaseSite(alert),
            category_key: String(alert.caseCategoryKey || '').trim().toLowerCase(),
            target_id: String(alert.caseTargetId || '').trim(),
            action,
            action_label: this.getOpsAlertCaseEventActionLabel(action),
            summary,
            status: String(caseRecord?.status || '').trim().toLowerCase(),
            owner_admin_id: String(caseRecord?.owner_admin_id || '').trim(),
            owner_label: String(caseRecord?.owner_label || '').trim(),
            actor_admin_id: '',
            actor_label: '',
            note: String(caseRecord?.note || '').trim(),
            resolution: String(caseRecord?.resolution || '').trim(),
            metadata: {},
            created_at: createdAt
        };
    }

    parseOpsAlertTimestampMs(value = '') {
        if (value instanceof Date) {
            const timestamp = value.getTime();
            return Number.isFinite(timestamp) ? timestamp : 0;
        }
        const timestamp = Date.parse(String(value || '').trim());
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    getOpsAlertActivityTimestampMs(alert = {}) {
        return Math.max(
            this.parseOpsAlertTimestampMs(alert.updated_at || alert.updatedAt),
            this.parseOpsAlertTimestampMs(alert.delivered_at || alert.deliveredAt),
            this.parseOpsAlertTimestampMs(alert.created_at || alert.createdAt),
            this.parseOpsAlertTimestampMs(alert.sortTimestamp),
            this.parseOpsAlertTimestampMs(alert.timestamp)
        );
    }

    isResolvedOpsAlertCaseStaleForAlert(caseRecord = null, alert = {}) {
        if (String(caseRecord?.status || '').trim().toLowerCase() !== 'resolved') {
            return false;
        }
        const alertActivityAt = this.getOpsAlertActivityTimestampMs(alert);
        const caseClosedAt = this.parseOpsAlertTimestampMs(caseRecord.last_action_at)
            || this.parseOpsAlertTimestampMs(caseRecord.updated_at)
            || this.parseOpsAlertTimestampMs(caseRecord.created_at);
        return alertActivityAt > 0 && caseClosedAt > 0 && alertActivityAt > caseClosedAt;
    }

    buildImplicitlyReopenedOpsAlertCaseRecord(caseRecord = {}, alert = {}) {
        const reopenedAt = String(
            alert.updated_at
            || alert.updatedAt
            || alert.delivered_at
            || alert.deliveredAt
            || alert.created_at
            || alert.createdAt
            || caseRecord.updated_at
            || caseRecord.last_action_at
            || ''
        ).trim();
        return {
            ...caseRecord,
            status: 'open',
            resolution: '',
            last_action: 'reopened',
            last_action_at: reopenedAt || caseRecord.last_action_at || '',
            updated_at: reopenedAt || caseRecord.updated_at || '',
            metadata: {
                ...(caseRecord.metadata && typeof caseRecord.metadata === 'object' && !Array.isArray(caseRecord.metadata)
                    ? caseRecord.metadata
                    : {}),
                implicit_reopen_reason: 'newer_alert_after_resolved_case',
                implicit_reopen_alert_job_id: String(alert.id || '').trim() || null
            }
        };
    }

    applyOpsAlertCaseRecord(alert = {}, row = null) {
        const normalizedCaseRecord = row ? this.normalizeOpsAlertCaseRecord(row) : null;
        const caseRecord = this.isResolvedOpsAlertCaseStaleForAlert(normalizedCaseRecord, alert)
            ? this.buildImplicitlyReopenedOpsAlertCaseRecord(normalizedCaseRecord, alert)
            : normalizedCaseRecord;
        alert.caseRecord = caseRecord;
        alert.case_status = caseRecord?.status || '';
        alert.case_owner_admin_id = caseRecord?.owner_admin_id || '';
        alert.case_owner_label = caseRecord?.owner_label || '';
        alert.case_note = caseRecord?.note || '';
        alert.case_resolution = caseRecord?.resolution || '';
        alert.case_last_action = caseRecord?.last_action || '';
        alert.case_last_action_at = caseRecord?.last_action_at || '';
        alert.case_updated_at = caseRecord?.updated_at || '';
        return this.applyOpsAlertMuteState(alert);
    }

    applyOpsAlertCaseEvents(alert = {}, rows = []) {
        const normalizedEvents = (Array.isArray(rows) ? rows : [])
            .map((row) => this.normalizeOpsAlertCaseEventRecord(row))
            .filter(Boolean)
            .slice(0, 3);
        const fallbackEvent = normalizedEvents.length ? null : this.buildOpsAlertFallbackCaseEvent(alert);
        const recentEvents = normalizedEvents.length ? normalizedEvents : (fallbackEvent ? [fallbackEvent] : []);
        const latestEvent = recentEvents[0] || null;
        const latestNoteEvent = recentEvents.find((event) => String(event?.note || '').trim()) || null;

        alert.case_recent_events = recentEvents;
        alert.case_recent_note = latestNoteEvent?.note || '';
        alert.case_recent_note_at = latestNoteEvent?.created_at || '';
        alert.case_latest_event_action = latestEvent?.action || '';
        alert.case_latest_event_label = latestEvent?.action_label || '';
        alert.case_latest_event_summary = latestEvent?.summary || '';
        alert.case_latest_event_at = latestEvent?.created_at || '';
        alert.case_latest_event_by_label = latestEvent?.actor_label || '';
        alert.case_latest_event_owner_label = latestEvent?.owner_label || '';
        return alert;
    }

    getOpsAlertCaseRecentEvents(alert = {}) {
        return (Array.isArray(alert.case_recent_events) ? alert.case_recent_events : [])
            .map((event) => this.normalizeOpsAlertCaseEventRecord(event))
            .filter(Boolean);
    }

    getOpsAlertCaseRecentEventText(event = {}) {
        if (typeof window.getAdminWorkbenchOpsAlertCaseRecentEventText === 'function') {
            return window.getAdminWorkbenchOpsAlertCaseRecentEventText(event, {
                formatTime: (value) => this.formatDetailTime(value),
                muteVerb: '已静音至'
            });
        }
        const normalized = this.normalizeOpsAlertCaseEventRecord(event);
        if (!normalized) {
            return '';
        }

        const muteUntil = String(normalized.metadata?.mute_until || '').trim();
        const action = String(normalized.action || '').trim().toLowerCase();
        const summary = action === 'batch_mute' && muteUntil
            ? `已静音至 ${this.formatDetailTime(muteUntil)}`
            : String(normalized.summary || '').trim();
        const parts = [];

        if (normalized.action_label) {
            parts.push(normalized.action_label);
        }
        if (summary) {
            parts.push(summary);
        } else if (normalized.owner_label && ['claim', 'assign'].includes(action)) {
            parts.push(`负责人 ${normalized.owner_label}`);
        }
        if (normalized.actor_label) {
            parts.push(`操作人 ${normalized.actor_label}`);
        }
        if (normalized.created_at) {
            parts.push(this.formatDetailTime(normalized.created_at));
        }

        return parts.join(' · ');
    }

    normalizeOpsAlertModuleMuteRules(config = {}) {
        const source = config?.mute_rules?.modules;
        const rules = {};
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            return rules;
        }

        Object.entries(source).forEach(([moduleKey, rule]) => {
            const normalizedKey = String(moduleKey || '').trim().toLowerCase();
            if (!normalizedKey || !rule || typeof rule !== 'object' || Array.isArray(rule)) {
                return;
            }

            const until = String(rule.until || '').trim();
            const untilTime = until ? new Date(until).getTime() : Number.NaN;
            if (!until || Number.isNaN(untilTime) || untilTime <= Date.now()) {
                return;
            }

            rules[normalizedKey] = {
                until,
                allowCritical: rule.allow_critical !== false
            };
        });

        return rules;
    }

    setOpsAlertModuleMuteRules(config = {}) {
        this.opsAlertModuleMuteRules = this.normalizeOpsAlertModuleMuteRules(config);
        this.opsAlertMessages = (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .map((alert) => this.applyOpsAlertMuteState(alert));
    }

    applyOpsAlertMuteState(alert = {}) {
        const moduleKey = String(alert.caseCategoryKey || '').trim().toLowerCase();
        const rule = moduleKey ? this.opsAlertModuleMuteRules[moduleKey] : null;
        const hasActiveMute = Boolean(rule?.until);
        alert.moduleMuteUntil = hasActiveMute ? String(rule.until || '').trim() : '';
        alert.moduleMuteAllowCritical = hasActiveMute ? rule.allowCritical !== false : true;
        alert.moduleMuteActive = hasActiveMute;
        alert.moduleMuteLabel = hasActiveMute ? this.getOpsAlertMuteModuleLabel(moduleKey) : '';
        return alert;
    }

    buildOpsAlertCaseSummary(alert = {}) {
        if (typeof window.getAdminWorkbenchOpsAlertCaseSummaryText === 'function') {
            return window.getAdminWorkbenchOpsAlertCaseSummaryText(alert, {
                formatTime: (value) => this.formatDetailTime(value),
                muteVerb: '已静音至',
                includeStatusLabel: false,
                resolutionPrefix: '结论：',
                notePrefix: '备注：',
                includeModuleMuteAllowCriticalSuffix: true
            });
        }
        const caseRecord = alert.caseRecord || null;
        const parts = [];
        if (alert.moduleMuteActive && alert.moduleMuteUntil) {
            const muteCopy = alert.moduleMuteAllowCritical
                ? `已静音至 ${this.formatDetailTime(alert.moduleMuteUntil)}（紧急继续通知）`
                : `已静音至 ${this.formatDetailTime(alert.moduleMuteUntil)}`;
            parts.push(muteCopy);
        }
        if (caseRecord?.owner_label) {
            parts.push(`负责人 ${caseRecord.owner_label}`);
        }
        if (caseRecord?.status === 'resolved' && caseRecord.resolution) {
            parts.push(`结论：${caseRecord.resolution}`);
        } else if (caseRecord?.note) {
            parts.push(`备注：${caseRecord.note}`);
        }
        if (caseRecord?.last_action_at) {
            parts.push(`更新于 ${this.formatDetailTime(caseRecord.last_action_at)}`);
        }
        return parts.join(' · ');
    }

    buildOpsAlertBodyText(alert = {}) {
        const rawContent = String(alert.displayContent || alert.content || alert.title || '系统告警').trim();
        if (!rawContent) {
            return '系统告警';
        }

        if (!this.isOpsAlertClosed(alert)) {
            return rawContent;
        }

        const rewrittenLines = rawContent
            .split('\n')
            .map((line, index) => {
                const normalizedLine = String(line || '').trim();
                if (normalizedLine.startsWith('当前状态：')) {
                    return line.replace('当前状态：', '触发时状态：');
                }
                if (index === 0 && normalizedLine) {
                    return `该告警已关闭，以下为触发当时的历史快照。\n${line}`;
                }
                return line;
            })
            .join('\n')
            .trim();

        return rewrittenLines || rawContent;
    }

    getOpsAlertLinkedTicketId(alert = {}) {
        const candidates = [
            alert.case_note,
            alert.case_resolution,
            alert.caseRecord?.note,
            alert.caseRecord?.resolution
        ];
        for (const candidate of candidates) {
            const match = String(candidate || '').match(/工单号[:：]\s*([A-Za-z0-9-]{6,120})/i);
            if (match?.[1]) {
                return String(match[1]).trim();
            }
        }
        return '';
    }

    canCreateOpsAlertTicket(alert = {}) {
        if (!alert.caseCategoryKey || !alert.caseTargetId) {
            return false;
        }
        if (this.isOpsAlertClosed(alert)) {
            return false;
        }
        if (String(alert.alertType || '').trim().toLowerCase().startsWith('ticket_')) {
            return false;
        }
        if (this.getOpsAlertLinkedTicketId(alert)) {
            return false;
        }
        const payload = alert.payload || {};
        return Boolean(
            String(payload.user_id || '').trim()
            || String(payload.order_id || '').trim()
            || String(payload.payment_order_id || '').trim()
        );
    }

    buildOpsAlertTicketNote(alert = {}, ticketId = '', note = '') {
        const linkedTicketId = String(ticketId || '').trim();
        if (!linkedTicketId) {
            return String(alert.case_note || '').trim();
        }
        const existingNote = String(alert.case_note || '').trim();
        if (existingNote.includes(`工单号：${linkedTicketId}`)) {
            return existingNote;
        }
        const extraNote = String(note || '').trim();
        return [existingNote, `已转工单，工单号：${linkedTicketId}`, extraNote ? `补充说明：${extraNote}` : '']
            .filter(Boolean)
            .join('\n');
    }

    buildOpsAlertCaseMutationContext(alert = {}) {
        const baseContext = {
            ...this.buildOpsAlertContext(alert.alertType || alert.alert_type || '', alert.payload || {}, alert.title || ''),
            title: String(alert.title || '').trim(),
            alertType: String(alert.alertType || alert.alert_type || '').trim().toLowerCase(),
            alert_type: String(alert.alertType || alert.alert_type || '').trim().toLowerCase(),
            category: String(alert.caseCategoryKey || alert.category || alert.category_key || '').trim().toLowerCase(),
            category_key: String(alert.caseCategoryKey || alert.category || alert.category_key || '').trim().toLowerCase(),
            site: this.getOpsAlertCaseSite(alert),
            referenceLabel: String(alert.referenceLabel || alert.reference_label || '').trim(),
            referenceValue: String(alert.referenceValue || alert.reference_value || '').trim(),
            targetId: String(alert.caseTargetId || alert.targetId || alert.target_id || '').trim(),
            target_id: String(alert.caseTargetId || alert.targetId || alert.target_id || '').trim(),
            userId: String(alert.userId || alert.user_id || alert.payload?.user_id || '').trim(),
            user_id: String(alert.userId || alert.user_id || alert.payload?.user_id || '').trim(),
            clientIp: String(alert.clientIp || alert.client_ip || alert.payload?.client_ip || '').trim(),
            client_ip: String(alert.clientIp || alert.client_ip || alert.payload?.client_ip || '').trim(),
            discountCode: String(alert.discountCode || alert.discount_code || alert.payload?.discount_code || '').trim(),
            discount_code: String(alert.discountCode || alert.discount_code || alert.payload?.discount_code || '').trim(),
            signalType: String(alert.signalType || alert.signal_type || alert.payload?.signal_type || '').trim(),
            signal_type: String(alert.signalType || alert.signal_type || alert.payload?.signal_type || '').trim(),
            sessionId: String(alert.sessionId || alert.session_id || alert.payload?.session_id || '').trim(),
            session_id: String(alert.sessionId || alert.session_id || alert.payload?.session_id || '').trim(),
            caseStatus: String(alert.case_status || alert.caseStatus || '').trim().toLowerCase(),
            case_status: String(alert.case_status || alert.caseStatus || '').trim().toLowerCase(),
            caseOwnerAdminId: String(alert.case_owner_admin_id || alert.caseOwnerAdminId || '').trim(),
            case_owner_admin_id: String(alert.case_owner_admin_id || alert.caseOwnerAdminId || '').trim(),
            caseOwnerLabel: String(alert.case_owner_label || alert.caseOwnerLabel || '').trim(),
            case_owner_label: String(alert.case_owner_label || alert.caseOwnerLabel || '').trim()
        };

        if (typeof window.buildOpsAlertCaseMutationContext === 'function') {
            return window.buildOpsAlertCaseMutationContext(baseContext);
        }

        return baseContext;
    }

    async submitOpsAlertCaseMutationRequest(action, alert = {}, options = {}) {
        const headers = await this.getOpsAlertCaseApiHeaders();
        const context = this.buildOpsAlertCaseMutationContext(alert);

        if (typeof window.submitOpsAlertCaseMutationRequest === 'function') {
            return window.submitOpsAlertCaseMutationRequest(headers, action, context, {
                ...options,
                errorMessage: options.errorMessage || '站内代办处理失败'
            });
        }

        const requestBody = typeof window.buildOpsAlertCaseMutationRequest === 'function'
            ? window.buildOpsAlertCaseMutationRequest(action, context, options)
            : (() => {
                const requestItems = (Array.isArray(options.items) ? options.items : [])
                    .map((item) => {
                        const nextItem = {
                            category_key: String(item.category_key || item.category || item.caseCategoryKey || context.category || '').trim().toLowerCase(),
                            target_id: String(item.target_id || item.targetId || item.caseTargetId || '').trim(),
                            alert_type: String(item.alert_type || item.alertType || '').trim().toLowerCase(),
                            title: String(item.title || '').trim(),
                            reference_label: String(item.reference_label || item.referenceLabel || '').trim(),
                            reference_value: String(item.reference_value || item.referenceValue || '').trim(),
                            metadata: item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
                                ? item.metadata
                                : undefined
                        };
                        const itemSite = this.normalizeOpsAlertCaseSite(item.site || item.caseSite || item.site_context || context.site, '');
                        if (itemSite) {
                            nextItem.site = itemSite;
                        }
                        return nextItem;
                    })
                    .filter((item) => item.category_key && item.target_id);
                const requestBody = {
                    action: String(action || '').trim().toLowerCase(),
                    note: String(options.note || '').trim(),
                    resolution: String(options.resolution || '').trim(),
                    metadata: {
                        category: context.category || '',
                        alert_type: context.alertType || '',
                        reference_label: context.referenceLabel || '',
                        reference_value: context.referenceValue || '',
                        signal_type: context.signalType || '',
                        title: context.title || '',
                        ...(options.metadata && typeof options.metadata === 'object' && !Array.isArray(options.metadata)
                            ? options.metadata
                            : {})
                    }
                };
                if (context.site) {
                    requestBody.metadata.site = context.site;
                }

                if (requestItems.length) {
                    requestBody.items = requestItems;
                } else {
                    requestBody.category_key = context.category || '';
                    requestBody.target_id = context.targetId || '';
                    requestBody.alert_type = context.alertType || '';
                    if (context.site) {
                        requestBody.site = context.site;
                    }
                    requestBody.title = context.title || '';
                }

                const ownerAdminId = String(options.ownerAdminId || options.owner_admin_id || '').trim();
                const ownerLabel = String(options.ownerLabel || options.owner_label || '').trim();
                if (ownerAdminId) {
                    requestBody.owner_admin_id = ownerAdminId;
                }
                if (ownerLabel) {
                    requestBody.owner_label = ownerLabel;
                }

                return requestBody;
            })();

        const response = await fetch('/api/admin/settings/ops-alert-monitor-cases', {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || options.errorMessage || '站内代办处理失败');
        }

        return payload;
    }

    async appendOpsAlertCaseNote(alert = {}, note = '') {
        const normalizedNote = String(note || '').trim();
        if (!normalizedNote || !alert.caseCategoryKey || !alert.caseTargetId) {
            return null;
        }

        const payload = await this.submitOpsAlertCaseMutationRequest('add_note', alert, {
            note: normalizedNote,
            errorMessage: '回写工单备注失败'
        });
        return payload.case || null;
    }

    async openLinkedOpsAlertTicket(alert = {}) {
        const ticketId = this.getOpsAlertLinkedTicketId(alert);
        if (!ticketId) {
            window.showToast?.('这条代办还没有关联工单', 'info');
            return false;
        }

        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher !== 'function') {
            window.showToast?.('当前页面暂时无法直接打开工单', 'warning');
            return false;
        }

        const context = {
            ...this.buildOpsAlertContext(alert.alertType || '', alert.payload || {}, alert.title || ''),
            referenceLabel: '工单号',
            referenceValue: ticketId,
            targetId: ticketId,
            target_id: ticketId
        };
        return this.openWorkbenchEntry('tickets-pending', context);
    }

    async handleCreateOpsAlertTicket(alert = {}) {
        if (!this.canCreateOpsAlertTicket(alert)) {
            window.showToast?.('当前告警暂不支持直接转工单', 'info');
            return false;
        }

        const note = String(window.prompt('可选：补充转工单说明', '') || '').trim();
        const headers = await this.getOpsAlertCaseApiHeaders();
        const response = await fetch('/api/admin/tickets/create', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                source: 'ops_alert',
                alert_type: alert.alertType || '',
                title: alert.title || '',
                content: alert.displayContent || alert.content || '',
                reference_label: alert.referenceLabel || '',
                reference_value: alert.referenceValue || '',
                target_id: alert.caseTargetId || '',
                user_id: alert.payload?.user_id || '',
                order_id: alert.payload?.order_id || '',
                payment_order_id: alert.payload?.payment_order_id || '',
                entry_path: alert.entryPath || '',
                note
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || '转工单失败');
        }

        const ticketId = String(payload.ticket_id || payload.ticket?.id || '').trim();
        if (ticketId) {
            try {
                const nextCase = await this.appendOpsAlertCaseNote(alert, this.buildOpsAlertTicketNote(alert, ticketId, note));
                if (nextCase) {
                    const targetAlert = this.opsAlertMessages.find((item) => item.id === alert.id) || alert;
                    this.applyOpsAlertCaseRecord(targetAlert, nextCase);
                    await this.refreshOpsAlertCaseStateForAlerts([targetAlert]);
                }
            } catch (noteError) {
                console.warn('[AdminChat] Failed to append linked ticket note:', noteError);
            }
        }

        this.refreshOpsAlertViews();
        window.showToast?.(payload.message || `已转工单：${ticketId || '已创建'}`, 'success');
        return true;
    }

    getOpsAlertCaseActions(alert = {}) {
        if (!alert.caseCategoryKey || !alert.caseTargetId) {
            return [];
        }

        const status = String(alert.case_status || '').trim().toLowerCase() || 'open';
        const linkedTicketId = this.getOpsAlertLinkedTicketId(alert);
        if (this.isOpsAlertClosed(alert)) {
            const actions = [
                ...(linkedTicketId ? [{ action: 'open_ticket', label: '查看工单', style: 'secondary' }] : []),
                ...(status === 'resolved' ? [{ action: 'reopen', label: '重新打开', style: 'ghost' }] : []),
                { action: 'add_note', label: '补充备注', style: 'secondary' }
            ];
            return actions;
        }

        const actions = [];
        if (status === 'open') {
            actions.push({ action: 'claim', label: '认领', style: 'secondary' });
        }
        if (this.opsAlertAssignableAdmins.length) {
            actions.push({
                action: 'assign',
                label: status === 'claimed' ? '转交' : '指派',
                style: 'secondary'
            });
        }
        if (linkedTicketId) {
            actions.push({ action: 'open_ticket', label: '查看工单', style: 'secondary' });
        } else if (this.canCreateOpsAlertTicket(alert)) {
            actions.push({ action: 'create_ticket', label: '转工单', style: 'secondary' });
        }
        actions.push({ action: 'snooze', label: '稍后提醒', style: 'ghost' });
        actions.push({ action: 'add_note', label: status === 'claimed' ? '补充备注' : '备注', style: 'secondary' });
        actions.push({ action: 'resolve', label: '关闭', style: 'danger' });
        return actions;
    }

    normalizeOpsAlertAssignableAdmins(admins = []) {
        return (Array.isArray(admins) ? admins : [])
            .map((admin) => ({
                id: String(admin.id || '').trim(),
                label: String(admin.label || admin.display_name || admin.email || admin.id || '').trim(),
                email: String(admin.email || '').trim(),
                isCurrent: admin.is_current === true
            }))
            .filter((admin) => admin.id && admin.label);
    }

    async ensureOpsAlertMonitorMeta(force = false) {
        if (!force && (this.opsAlertAssignableAdmins.length || this.opsAlertCurrentAdminId || this.opsAlertCurrentAdminLabel)) {
            return {
                assignable_admins: this.opsAlertAssignableAdmins,
                current_admin_id: this.opsAlertCurrentAdminId,
                current_admin_label: this.opsAlertCurrentAdminLabel
            };
        }

        try {
            const headers = await this.getOpsAlertCaseApiHeaders();
            const response = await fetch('/api/admin/settings/ops-alert-monitor', {
                method: 'GET',
                headers
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success === false) {
                throw new Error(payload.message || '读取站内代办负责人失败');
            }

            this.opsAlertAssignableAdmins = this.normalizeOpsAlertAssignableAdmins(payload.assignable_admins);
            this.opsAlertCurrentAdminId = String(payload.current_admin_id || '').trim();
            this.opsAlertCurrentAdminLabel = String(payload.current_admin_label || '').trim();
            return payload;
        } catch (error) {
            console.warn('[AdminChat] Failed to load ops alert monitor meta:', error);
            return {
                assignable_admins: this.opsAlertAssignableAdmins,
                current_admin_id: this.opsAlertCurrentAdminId,
                current_admin_label: this.opsAlertCurrentAdminLabel
            };
        }
    }

    getFilteredOpsAlertMessages(options = {}) {
        const ignoreReadView = Boolean(options.ignoreReadView);
        let alerts = Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [];
        if (this.opsAlertViewFilter === 'mine') {
            if (!this.opsAlertCurrentAdminId) {
                return alerts;
            }
            alerts = alerts.filter((alert) => String(alert.case_owner_admin_id || '').trim() === this.opsAlertCurrentAdminId);
        }
        if (this.opsAlertViewFilter === 'active') {
            alerts = alerts.filter((alert) => !this.isOpsAlertClosed(alert));
        }
        if (!ignoreReadView && this.opsAlertViewFilter === 'unread') {
            alerts = alerts.filter((alert) => !this.isOpsAlertClosed(alert) && !this.isOpsAlertRead(alert));
        }
        if (!ignoreReadView && this.opsAlertViewFilter === 'read') {
            alerts = alerts.filter((alert) => !this.isOpsAlertClosed(alert) && this.isOpsAlertRead(alert));
        }
        const ownerFilter = String(this.opsAlertOwnerFilter || 'all').trim();
        if (!ownerFilter || ownerFilter === 'all') {
            return alerts;
        }
        if (ownerFilter === 'unassigned') {
            return alerts.filter((alert) => !String(alert.case_owner_admin_id || '').trim());
        }
        return alerts.filter((alert) => String(alert.case_owner_admin_id || '').trim() === ownerFilter);
    }

    setOpsAlertViewFilter(filter = 'all') {
        const normalizedRaw = String(filter || '').trim().toLowerCase();
        const normalized = ['mine', 'active', 'unread', 'read'].includes(normalizedRaw) ? normalizedRaw : 'all';
        if (normalized === this.opsAlertViewFilter) {
            return;
        }
        this.opsAlertViewFilter = normalized;
        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    getOpsAlertOwnerFilterOptions() {
        const unresolvedAlerts = (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .filter((alert) => !this.isOpsAlertClosed(alert));
        const hasUnassigned = unresolvedAlerts.some((alert) => !String(alert.case_owner_admin_id || '').trim());
        const ownerMap = new Map();
        unresolvedAlerts.forEach((alert) => {
            const ownerId = String(alert.case_owner_admin_id || '').trim();
            const ownerLabel = String(alert.case_owner_label || '').trim();
            if (!ownerId || !ownerLabel || ownerMap.has(ownerId)) {
                return;
            }
            ownerMap.set(ownerId, ownerLabel);
        });

        const options = [{ value: 'all', label: '全部负责人' }];
        if (hasUnassigned) {
            options.push({ value: 'unassigned', label: '未认领' });
        }
        ownerMap.forEach((label, value) => {
            options.push({ value, label });
        });
        return options;
    }

    syncOpsAlertOwnerFilter(options = []) {
        if (!Array.isArray(options) || !options.some((option) => option.value === this.opsAlertOwnerFilter)) {
            this.opsAlertOwnerFilter = 'all';
        }
    }

    setOpsAlertOwnerFilter(value = 'all') {
        const normalized = String(value || 'all').trim() || 'all';
        if (normalized === this.opsAlertOwnerFilter) {
            return;
        }
        this.opsAlertOwnerFilter = normalized;
        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    getOpsAlertReadIdentity(alert = {}) {
        return String(
            alert.id
            || alert.caseTargetId
            || alert.target_id
            || `${alert.alertType || alert.alert_type || 'alert'}:${alert.created_at || alert.createdAt || alert.timestamp || ''}`
        ).trim();
    }

    getOpsAlertTimestampMs(alert = {}) {
        const timestamp = alert.sortTimestamp || alert.timestamp || alert.updated_at || alert.created_at || alert.createdAt;
        if (timestamp instanceof Date) {
            return timestamp.getTime();
        }
        const parsed = Date.parse(timestamp || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    getOpsAlertUpdatedMs(alert = {}) {
        const parsed = Date.parse(alert.updated_at || alert.updatedAt || '');
        return Number.isFinite(parsed) ? parsed : this.getOpsAlertTimestampMs(alert);
    }

    isOpsAlertRead(alert = {}) {
        const alertId = this.getOpsAlertReadIdentity(alert);
        if (!alertId || !this.opsAlertReadReceipts.has(alertId)) {
            return false;
        }

        const readAt = Date.parse(this.opsAlertReadReceipts.get(alertId) || '');
        if (!Number.isFinite(readAt)) {
            return false;
        }

        const updatedAt = this.getOpsAlertUpdatedMs(alert);
        return !updatedAt || readAt + 1000 >= updatedAt;
    }

    getOpsAlertUnreadCount(alerts = this.opsAlertMessages) {
        return (Array.isArray(alerts) ? alerts : [])
            .filter((alert) => !this.isOpsAlertClosed(alert) && !this.isOpsAlertRead(alert))
            .length;
    }

    getOpsAlertReadCategoryOptions(alerts = this.getFilteredOpsAlertMessages({ ignoreReadView: true })) {
        const categoryMap = new Map();
        (Array.isArray(alerts) ? alerts : []).forEach((alert) => {
            const key = String(alert.caseCategoryKey || alert.category_key || '').trim().toLowerCase();
            if (!key || categoryMap.has(key)) {
                return;
            }
            categoryMap.set(key, this.getOpsAlertMuteModuleLabel(key) || key);
        });

        return [
            { value: 'all', label: '全部分类' },
            ...Array.from(categoryMap.entries())
                .sort((left, right) => left[1].localeCompare(right[1], 'zh-Hans-CN'))
                .map(([value, label]) => ({ value, label }))
        ];
    }

    syncOpsAlertReadCategoryFilter(options = []) {
        if (!Array.isArray(options) || !options.some((option) => option.value === this.opsAlertReadCategoryFilter)) {
            this.opsAlertReadCategoryFilter = 'all';
        }
    }

    getOpsAlertReadTimeOptions() {
        return [
            { value: 'visible', label: '当前筛选' },
            { value: 'hour', label: '近 1 小时' },
            { value: 'today', label: '今天' },
            { value: 'all', label: '全部时间' }
        ];
    }

    matchesOpsAlertReadTimeFilter(alert = {}, filter = this.opsAlertReadTimeFilter) {
        const normalized = String(filter || 'visible').trim().toLowerCase();
        if (normalized === 'visible' || normalized === 'all') {
            return true;
        }

        const timestamp = this.getOpsAlertTimestampMs(alert);
        if (!timestamp) {
            return false;
        }
        if (normalized === 'hour') {
            return timestamp >= Date.now() - 60 * 60 * 1000;
        }
        if (normalized === 'today') {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            return timestamp >= startOfToday.getTime();
        }
        return true;
    }

    getOpsAlertReadTargetAlerts() {
        const categoryFilter = String(this.opsAlertReadCategoryFilter || 'all').trim().toLowerCase();
        return this.getFilteredOpsAlertMessages({ ignoreReadView: true })
            .filter((alert) => !this.isOpsAlertClosed(alert))
            .filter((alert) => categoryFilter === 'all' || String(alert.caseCategoryKey || '').trim().toLowerCase() === categoryFilter)
            .filter((alert) => this.matchesOpsAlertReadTimeFilter(alert))
            .filter((alert) => !this.isOpsAlertRead(alert));
    }

    handleOpsAlertReadCategoryChange(value = 'all') {
        this.opsAlertReadCategoryFilter = String(value || 'all').trim().toLowerCase() || 'all';
        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    handleOpsAlertReadTimeChange(value = 'visible') {
        const normalized = String(value || 'visible').trim().toLowerCase();
        const allowed = new Set(this.getOpsAlertReadTimeOptions().map((item) => item.value));
        this.opsAlertReadTimeFilter = allowed.has(normalized) ? normalized : 'visible';
        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    markFilteredOpsAlertsRead() {
        const targets = this.getOpsAlertReadTargetAlerts();
        if (!targets.length) {
            window.showToast?.('当前范围没有未读代办', 'info');
            return false;
        }

        const readAt = new Date().toISOString();
        targets.forEach((alert) => {
            const alertId = this.getOpsAlertReadIdentity(alert);
            if (alertId) {
                this.opsAlertReadReceipts.set(alertId, readAt);
            }
        });
        this.persistOpsAlertReadReceipts();
        this.refreshOpsAlertViews();
        window.showToast?.(`已标记 ${this.formatCompactCount(targets.length)} 条代办为已读`, 'success');
        return true;
    }

    getBatchAssignableOpsAlerts() {
        const filteredAlerts = this.getFilteredOpsAlertMessages();
        const caseMap = new Map();
        filteredAlerts
            .filter((alert) => !this.isOpsAlertClosed(alert))
            .forEach((alert) => {
                const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId, this.getOpsAlertCaseSite(alert));
                if (!alert.caseCategoryKey || !alert.caseTargetId || caseMap.has(caseKey)) {
                    return;
                }
                caseMap.set(caseKey, alert);
            });
        return Array.from(caseMap.values());
    }

    shouldShowOpsAlertBatchAssign() {
        const hasScopedFilter = this.opsAlertViewFilter === 'mine' || this.opsAlertOwnerFilter !== 'all';
        return hasScopedFilter && this.getBatchAssignableOpsAlerts().length > 0 && this.opsAlertAssignableAdmins.length > 0;
    }

    applyOpsAlertCasesToMessages(cases = []) {
        const caseMap = new Map(
            (Array.isArray(cases) ? cases : [])
                .map((row) => this.normalizeOpsAlertCaseRecord(row))
                .filter(Boolean)
                .map((row) => [this.buildOpsAlertCaseKey(row.category_key, row.target_id, row.site), row])
        );

        this.opsAlertMessages = (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .map((alert) => {
                const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId, this.getOpsAlertCaseSite(alert));
                return caseMap.has(caseKey)
                    ? this.applyOpsAlertCaseRecord(alert, caseMap.get(caseKey))
                    : alert;
            });
    }

    async handleOpsAlertBatchAssign() {
        if (this.opsAlertBatchAssignBusy) {
            return false;
        }

        const alerts = this.getBatchAssignableOpsAlerts();
        if (!alerts.length) {
            window.showToast?.('当前筛选下没有可转交的站内代办', 'info');
            return false;
        }

        const defaultOwnerAdminId = this.opsAlertOwnerFilter !== 'all' && this.opsAlertOwnerFilter !== 'unassigned'
            ? this.opsAlertOwnerFilter
            : this.opsAlertCurrentAdminId;

        try {
            this.opsAlertBatchAssignBusy = true;
            this.refreshOpsAlertViews();

            const selectedOwner = await this.promptOpsAlertAssignee(defaultOwnerAdminId);
            if (!selectedOwner) {
                return false;
            }

            const note = String(window.prompt(`可选：填写交接备注（将同步到 ${alerts.length} 条代办）`, '') || '').trim();
            const label = this.opsAlertOwnerFilter === 'unassigned' ? '批量指派' : '批量接力';
            if (!window.confirm(`确定将当前筛选下的 ${alerts.length} 条代办${label}给 ${selectedOwner.label} 吗？`)) {
                return false;
            }

            const payload = await this.submitOpsAlertCaseMutationRequest('assign', alerts[0] || {}, {
                ownerAdminId: selectedOwner.id,
                ownerLabel: selectedOwner.label,
                note,
                metadata: {
                    source: 'admin_chat_toolbar_batch_assign',
                    filter_view: this.opsAlertViewFilter,
                    filter_owner: this.opsAlertOwnerFilter
                },
                items: alerts.map((item) => ({
                    ...item,
                    metadata: {
                        title: item.title || '',
                        reference_label: item.referenceLabel || '',
                        reference_value: item.referenceValue || '',
                        alert_type: item.alertType || ''
                    }
                })),
                errorMessage: '批量转交站内代办失败'
            });

            this.applyOpsAlertCasesToMessages(payload.cases || []);
            await this.refreshOpsAlertCaseStateForAlerts(alerts);
            this.refreshOpsAlertViews();
            window.showToast?.(payload.message || '站内代办已批量转交', 'success');
            return true;
        } catch (error) {
            console.error('[AdminChat] Failed to batch assign ops alerts:', error);
            window.showToast?.(`处理失败: ${error.message || '未知错误'}`, 'error');
            return false;
        } finally {
            this.opsAlertBatchAssignBusy = false;
            this.refreshOpsAlertViews();
        }
    }

    closeOpsAlertToolbarDropdowns(root = document) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        scope.querySelectorAll('.admin-alert-toolbar-dropdown.is-open').forEach((dropdown) => {
            if (typeof dropdown._closeOpsAlertToolbarDropdown === 'function') {
                dropdown._closeOpsAlertToolbarDropdown();
                return;
            }
            dropdown.classList.remove('is-open');
            dropdown.querySelector('.admin-alert-toolbar-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
        });
    }

    createOpsAlertToolbarDropdown({
        label = '',
        ariaLabel = '',
        options = [],
        value = '',
        onChange = () => {},
        fieldClassName = '',
        compact = false
    } = {}) {
        const normalizedOptions = Array.isArray(options) ? options : [];
        const normalizedValue = String(value || '').trim();
        const selectedOption = normalizedOptions.find((option) => String(option.value || '').trim() === normalizedValue)
            || normalizedOptions.find((option) => !option.disabled)
            || normalizedOptions[0]
            || { value: '', label: '请选择' };

        const field = document.createElement('div');
        field.className = `admin-alert-toolbar-filter${fieldClassName ? ` ${fieldClassName}` : ''}`;

        const labelEl = document.createElement('span');
        labelEl.className = 'admin-alert-toolbar-copy';
        labelEl.textContent = label;
        field.appendChild(labelEl);

        const dropdown = document.createElement('div');
        dropdown.className = `admin-alert-toolbar-dropdown${compact ? ' admin-alert-toolbar-dropdown--compact' : ''}`;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'admin-alert-toolbar-dropdown-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', ariaLabel || label || '选择筛选项');

        const triggerText = document.createElement('span');
        triggerText.className = 'admin-alert-toolbar-dropdown-value';
        triggerText.textContent = selectedOption.label || selectedOption.value || '请选择';
        trigger.appendChild(triggerText);

        const triggerIcon = document.createElement('i');
        triggerIcon.className = 'fas fa-chevron-down admin-alert-toolbar-dropdown-icon';
        triggerIcon.setAttribute('aria-hidden', 'true');
        trigger.appendChild(triggerIcon);

        const menu = document.createElement('div');
        menu.className = 'admin-alert-toolbar-dropdown-menu';
        menu.setAttribute('role', 'listbox');

        let removeOutsideClick = () => {};
        const closeDropdown = () => {
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            removeOutsideClick();
            removeOutsideClick = () => {};
        };
        dropdown._closeOpsAlertToolbarDropdown = closeDropdown;

        const openDropdown = () => {
            this.closeOpsAlertToolbarDropdowns();
            dropdown.classList.add('is-open');
            trigger.setAttribute('aria-expanded', 'true');
            const handleOutsideClick = (event) => {
                if (!dropdown.contains(event.target)) {
                    closeDropdown();
                }
            };
            window.setTimeout(() => {
                document.addEventListener('click', handleOutsideClick);
                removeOutsideClick = () => document.removeEventListener('click', handleOutsideClick);
            }, 0);
        };

        normalizedOptions.forEach((option) => {
            const optionValue = String(option.value || '').trim();
            const isSelected = optionValue === String(selectedOption.value || '').trim();
            const optionButton = document.createElement('button');
            optionButton.type = 'button';
            optionButton.className = `admin-alert-toolbar-dropdown-option${isSelected ? ' is-selected' : ''}`;
            optionButton.setAttribute('role', 'option');
            optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            optionButton.dataset.value = optionValue;
            optionButton.disabled = Boolean(option.disabled);

            const optionText = document.createElement('span');
            optionText.textContent = option.label || optionValue || '未命名';
            optionButton.appendChild(optionText);

            const checkIcon = document.createElement('i');
            checkIcon.className = 'fas fa-check admin-alert-toolbar-dropdown-check';
            checkIcon.setAttribute('aria-hidden', 'true');
            optionButton.appendChild(checkIcon);

            optionButton.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (optionButton.disabled) return;
                closeDropdown();
                if (optionValue !== normalizedValue) {
                    onChange(optionValue);
                }
            });
            menu.appendChild(optionButton);
        });

        const focusEnabledOption = (step = 1) => {
            const enabledOptions = Array.from(menu.querySelectorAll('.admin-alert-toolbar-dropdown-option:not(:disabled)'));
            if (!enabledOptions.length) return;
            const activeIndex = enabledOptions.indexOf(document.activeElement);
            const nextIndex = activeIndex >= 0
                ? (activeIndex + step + enabledOptions.length) % enabledOptions.length
                : (step > 0 ? 0 : enabledOptions.length - 1);
            enabledOptions[nextIndex]?.focus();
        };

        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (dropdown.classList.contains('is-open')) {
                closeDropdown();
            } else {
                openDropdown();
            }
        });
        trigger.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeDropdown();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!dropdown.classList.contains('is-open')) {
                    openDropdown();
                }
                focusEnabledOption(event.key === 'ArrowDown' ? 1 : -1);
            }
        });
        menu.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeDropdown();
                trigger.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                focusEnabledOption(event.key === 'ArrowDown' ? 1 : -1);
            }
        });

        dropdown.appendChild(trigger);
        dropdown.appendChild(menu);
        field.appendChild(dropdown);
        return field;
    }

    createOpsAlertToolbarElement() {
        const wrapper = document.createElement('div');
        wrapper.className = 'admin-alert-toolbar';

        const unreadCount = this.getOpsAlertUnreadCount();
        const viewOptions = [
            { key: 'all', label: '全部' },
            { key: 'active', label: '未关闭' },
            { key: 'unread', label: unreadCount > 0 ? `未读 ${this.formatCompactCount(unreadCount)}` : '未读' },
            { key: 'read', label: '已读' },
            { key: 'mine', label: '我认领的' }
        ];
        const scopeFilterWrap = this.createOpsAlertToolbarDropdown({
            label: '筛选范围',
            ariaLabel: '选择站内代办筛选范围',
            options: viewOptions.map((item) => ({
                value: item.key,
                label: item.label,
                disabled: item.key === 'mine' && !this.opsAlertCurrentAdminId
            })),
            value: this.opsAlertViewFilter,
            onChange: (nextValue) => this.setOpsAlertViewFilter(nextValue),
            fieldClassName: 'admin-alert-toolbar-filter--scope'
        });
        wrapper.appendChild(scopeFilterWrap);

        const readOptions = this.getOpsAlertReadCategoryOptions();
        this.syncOpsAlertReadCategoryFilter(readOptions);
        const readTargetCount = this.getOpsAlertReadTargetAlerts().length;
        const readWrap = document.createElement('div');
        readWrap.className = 'admin-alert-toolbar-read';

        const readLabel = document.createElement('span');
        readLabel.className = 'admin-alert-toolbar-copy';
        readLabel.textContent = '已读';
        readWrap.appendChild(readLabel);

        readWrap.appendChild(this.createOpsAlertToolbarDropdown({
            label: '',
            ariaLabel: '选择已读分类',
            options: readOptions,
            value: this.opsAlertReadCategoryFilter,
            onChange: (nextValue) => this.handleOpsAlertReadCategoryChange(nextValue),
            compact: true
        }));

        readWrap.appendChild(this.createOpsAlertToolbarDropdown({
            label: '',
            ariaLabel: '选择已读时间范围',
            options: this.getOpsAlertReadTimeOptions(),
            value: this.opsAlertReadTimeFilter,
            onChange: (nextValue) => this.handleOpsAlertReadTimeChange(nextValue),
            compact: true
        }));

        const ownerOptions = this.getOpsAlertOwnerFilterOptions();
        this.syncOpsAlertOwnerFilter(ownerOptions);
        if (ownerOptions.length > 1) {
            const ownerFilterWrap = this.createOpsAlertToolbarDropdown({
                label: '负责人',
                ariaLabel: '选择站内代办负责人',
                options: ownerOptions,
                value: this.opsAlertOwnerFilter,
                onChange: (nextValue) => this.setOpsAlertOwnerFilter(nextValue),
                fieldClassName: 'admin-alert-toolbar-filter--owner'
            });
            readWrap.appendChild(ownerFilterWrap);
        }
        wrapper.appendChild(readWrap);

        const readButton = document.createElement('button');
        readButton.type = 'button';
        readButton.className = 'admin-alert-toolbar-btn admin-alert-toolbar-btn--read admin-alert-toolbar-btn--read-standalone';
        readButton.disabled = readTargetCount <= 0;
        readButton.innerHTML = `<i class="fas fa-check-double" aria-hidden="true"></i><span>${readTargetCount > 0 ? `标记 ${this.formatCompactCount(readTargetCount)}` : '无未读'}</span>`;
        readButton.addEventListener('click', () => {
            this.markFilteredOpsAlertsRead();
        });
        wrapper.appendChild(readButton);

        if (this.shouldShowOpsAlertBatchAssign()) {
            const batchButton = document.createElement('button');
            batchButton.type = 'button';
            batchButton.className = 'admin-alert-toolbar-btn admin-alert-toolbar-btn--accent';
            const count = this.getBatchAssignableOpsAlerts().length;
            batchButton.textContent = `${this.opsAlertOwnerFilter === 'unassigned' ? '批量指派' : '批量接力'} ${this.formatCompactCount(count)} 条`;
            batchButton.disabled = this.opsAlertBatchAssignBusy;
            if (this.opsAlertBatchAssignBusy) {
                batchButton.textContent = '处理中...';
            }
            batchButton.addEventListener('click', () => {
                this.handleOpsAlertBatchAssign();
            });
            wrapper.appendChild(batchButton);
        }

        return wrapper;
    }

    async promptOpsAlertAssignee(defaultOwnerAdminId = '') {
        await this.ensureOpsAlertMonitorMeta();
        const admins = this.opsAlertAssignableAdmins;
        if (!admins.length) {
            throw new Error('当前未加载到可指派的负责人');
        }

        const defaultIndex = Math.max(
            1,
            admins.findIndex((admin) => admin.id === defaultOwnerAdminId) + 1
            || admins.findIndex((admin) => admin.id === this.opsAlertCurrentAdminId) + 1
            || 1
        );
        const promptText = [
            '请选择负责人，输入序号后回车：',
            ...admins.map((admin, index) => `${index + 1}. ${admin.label}${admin.email ? ` (${admin.email})` : ''}${admin.isCurrent ? '（我）' : ''}`)
        ].join('\n');
        const answer = String(window.prompt(promptText, String(defaultIndex)) || '').trim();
        if (!answer) {
            return null;
        }

        const selected = admins.find((admin, index) => String(index + 1) === answer || admin.id === answer || admin.email === answer);
        if (!selected) {
            throw new Error('未识别的负责人');
        }

        return selected;
    }

    getOpsAlertMuteModuleLabel(moduleKey = '') {
        const normalized = String(moduleKey || '').trim().toLowerCase();
        const labelMap = {
            customer_engagement: '客服消息',
            commerce: '商城与充值',
            inventory: '库存与补货',
            payments: '支付与退款',
            shop_risk: '商城风控',
            verify: '验证服务',
            tickets: '工单与售后',
            fulfillment: '履约与死信',
            security: '账号安全'
        };
        return labelMap[normalized] || '';
    }

    promptOpsAlertSnoozeDuration(moduleKey = '') {
        const moduleLabel = this.getOpsAlertMuteModuleLabel(moduleKey);
        if (!moduleLabel) {
            throw new Error('当前告警暂不支持稍后提醒');
        }

        const promptText = [
            `将“${moduleLabel}”稍后提醒多久？`,
            '1. 1 小时',
            '2. 6 小时',
            '3. 24 小时',
            '',
            '输入序号或小时数，默认保留紧急告警继续通知。'
        ].join('\n');
        const answer = String(window.prompt(promptText, '1') || '').trim();
        if (!answer) {
            return null;
        }

        const presetMap = {
            '1': 1,
            '2': 6,
            '3': 24,
            '6': 6,
            '24': 24
        };
        const hours = presetMap[answer] || 0;
        if (![1, 6, 24].includes(hours)) {
            throw new Error('未识别的稍后提醒时长');
        }

        return {
            hours,
            until: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
            allowCritical: true,
            moduleKey: String(moduleKey || '').trim().toLowerCase(),
            moduleLabel
        };
    }

    buildOpsAlertBatchMuteItems(moduleKey = '', sourceAlert = {}) {
        const normalizedModuleKey = String(moduleKey || '').trim().toLowerCase();
        if (!normalizedModuleKey) {
            return [];
        }

        const itemMap = new Map();
        const alerts = Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [];
        alerts.forEach((item) => {
            if (String(item.caseCategoryKey || '').trim().toLowerCase() !== normalizedModuleKey) {
                return;
            }
            if (!item.caseTargetId) {
                return;
            }
            const caseSite = this.getOpsAlertCaseSite(item);
            const caseKey = this.buildOpsAlertCaseKey(item.caseCategoryKey, item.caseTargetId, caseSite);
            if (itemMap.has(caseKey)) {
                return;
            }
            itemMap.set(caseKey, {
                category_key: item.caseCategoryKey,
                site: caseSite,
                target_id: item.caseTargetId,
                alert_type: item.alertType || '',
                title: item.title || '',
                reference_label: item.referenceLabel || '',
                reference_value: item.referenceValue || '',
                metadata: {
                    title: item.title || '',
                    reference_label: item.referenceLabel || '',
                    reference_value: item.referenceValue || '',
                    alert_type: item.alertType || ''
                }
            });
        });

        if (!itemMap.size && sourceAlert?.caseTargetId) {
            const caseSite = this.getOpsAlertCaseSite(sourceAlert);
            const caseKey = this.buildOpsAlertCaseKey(sourceAlert.caseCategoryKey, sourceAlert.caseTargetId, caseSite);
            itemMap.set(caseKey, {
                category_key: sourceAlert.caseCategoryKey,
                site: caseSite,
                target_id: sourceAlert.caseTargetId,
                alert_type: sourceAlert.alertType || '',
                title: sourceAlert.title || '',
                reference_label: sourceAlert.referenceLabel || '',
                reference_value: sourceAlert.referenceValue || '',
                metadata: {
                    title: sourceAlert.title || '',
                    reference_label: sourceAlert.referenceLabel || '',
                    reference_value: sourceAlert.referenceValue || '',
                    alert_type: sourceAlert.alertType || ''
                }
            });
        }

        return Array.from(itemMap.values());
    }

    async fetchOpsAlertSettingsConfig({ force = false } = {}) {
        const now = Date.now();
        if (!force && this.opsAlertSettingsConfigCache && (now - this.opsAlertSettingsConfigLoadedAt) < 120000) {
            return this.opsAlertSettingsConfigCache;
        }

        const headers = await this.getOpsAlertCaseApiHeaders();
        const response = await fetch('/api/admin/settings/ops-alerts', {
            method: 'GET',
            headers
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || '读取站外告警配置失败');
        }
        const normalizedConfig = payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config)
            ? payload.config
            : {};
        this.setOpsAlertModuleMuteRules(normalizedConfig);
        this.opsAlertSettingsConfigCache = normalizedConfig;
        this.opsAlertSettingsConfigLoadedAt = now;
        return normalizedConfig;
    }

    async saveOpsAlertSettingsConfig(config = {}, caseEvents = []) {
        const headers = await this.getOpsAlertCaseApiHeaders();
        const response = await fetch('/api/admin/settings/ops-alerts', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                config,
                secrets: {
                    telegram_bot_token: '',
                    feishu_webhook_url: '',
                    email_api_key: ''
                },
                case_events: Array.isArray(caseEvents) ? caseEvents : []
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || '保存站外告警配置失败');
        }
        const normalizedConfig = payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config)
            ? payload.config
            : {};
        this.setOpsAlertModuleMuteRules(normalizedConfig);
        this.opsAlertSettingsConfigCache = normalizedConfig;
        this.opsAlertSettingsConfigLoadedAt = Date.now();
        return normalizedConfig;
    }

    async applyOpsAlertSnooze(alert = {}) {
        const selection = this.promptOpsAlertSnoozeDuration(alert.caseCategoryKey || '');
        if (!selection) {
            return null;
        }

        const currentConfig = await this.fetchOpsAlertSettingsConfig();
        const nextConfig = JSON.parse(JSON.stringify(currentConfig || {}));
        if (!nextConfig.mute_rules || typeof nextConfig.mute_rules !== 'object' || Array.isArray(nextConfig.mute_rules)) {
            nextConfig.mute_rules = {};
        }
        if (!nextConfig.mute_rules.modules || typeof nextConfig.mute_rules.modules !== 'object' || Array.isArray(nextConfig.mute_rules.modules)) {
            nextConfig.mute_rules.modules = {};
        }

        const currentRule = nextConfig.mute_rules.modules[selection.moduleKey] && typeof nextConfig.mute_rules.modules[selection.moduleKey] === 'object'
            ? nextConfig.mute_rules.modules[selection.moduleKey]
            : {};
        nextConfig.mute_rules.modules[selection.moduleKey] = {
            ...currentRule,
            until: selection.until,
            allow_critical: selection.allowCritical
        };

        const items = this.buildOpsAlertBatchMuteItems(selection.moduleKey, alert);
        const caseEvents = items.length ? [{
            action: 'batch_mute',
            items,
            metadata: {
                mute_until: selection.until,
                allow_critical: selection.allowCritical,
                module_keys: [selection.moduleKey],
                filter_summary: '站内代办稍后提醒'
            }
        }] : [];

        await this.saveOpsAlertSettingsConfig(nextConfig, caseEvents);
        return {
            message: `已将${selection.moduleLabel}稍后至 ${this.formatDetailTime(selection.until)}`,
            until: selection.until,
            moduleLabel: selection.moduleLabel
        };
    }

    async fetchOpsAlertCasesForAlerts(alerts = []) {
        const normalizedAlerts = Array.isArray(alerts) ? alerts : [];
        const targetIds = [...new Set(normalizedAlerts.flatMap((alert) => this.getOpsAlertCaseTargetIds(alert)))];
        const categoryKeys = [...new Set(normalizedAlerts.map((alert) => String(alert.caseCategoryKey || '').trim().toLowerCase()).filter(Boolean))];
        const sites = [...new Set(normalizedAlerts.map((alert) => this.getOpsAlertCaseSite(alert)).filter(Boolean))];

        if (!targetIds.length || !categoryKeys.length || !sites.length || !this.supabase?.from) {
            return new Map();
        }

        try {
            const { data, error } = await this.supabase
                .from('ops_alert_cases')
                .select('id, site, category_key, target_id, status, owner_admin_id, owner_label, note, resolution, last_action, last_action_at, created_at, updated_at')
                .in('site', sites)
                .in('category_key', categoryKeys)
                .in('target_id', targetIds);

            if (error) {
                throw error;
            }

            return new Map(
                (Array.isArray(data) ? data : [])
                    .map((row) => this.normalizeOpsAlertCaseRecord(row))
                    .filter(Boolean)
                    .map((row) => [this.buildOpsAlertCaseKey(row.category_key, row.target_id, row.site), row])
            );
        } catch (error) {
            if (this.isMissingOpsAlertCasesTableError(error)) {
                return new Map();
            }
            throw error;
        }
    }

    async fetchOpsAlertCaseEventsForAlerts(alerts = []) {
        const normalizedAlerts = (Array.isArray(alerts) ? alerts : [])
            .filter((alert) => alert.caseCategoryKey && alert.caseTargetId);
        if (!normalizedAlerts.length || !this.supabase?.from) {
            return new Map();
        }

        const groupedTargets = normalizedAlerts.reduce((accumulator, alert) => {
            const categoryKey = String(alert.caseCategoryKey || '').trim().toLowerCase();
            const site = this.getOpsAlertCaseSite(alert);
            const targetIds = this.getOpsAlertCaseTargetIds(alert);
            if (!categoryKey || !targetIds.length) {
                return accumulator;
            }
            const groupKey = this.buildOpsAlertCaseKey(categoryKey, '', site);
            if (!accumulator.has(groupKey)) {
                accumulator.set(groupKey, {
                    site,
                    categoryKey,
                    targetIds: []
                });
            }
            accumulator.get(groupKey).targetIds.push(...targetIds);
            return accumulator;
        }, new Map());

        const eventMap = new Map();
        try {
            for (const group of groupedTargets.values()) {
                const { data, error } = await this.supabase
                    .from('ops_alert_case_events')
                    .select('id, site, category_key, target_id, action, status, owner_admin_id, owner_label, actor_admin_id, actor_label, note, resolution, metadata, created_at')
                    .in('site', [group.site])
                    .in('category_key', [group.categoryKey])
                    .in('target_id', Array.from(new Set(group.targetIds)))
                    .order('created_at', { ascending: false });

                if (error) {
                    throw error;
                }

                (Array.isArray(data) ? data : []).forEach((row) => {
                    const event = this.normalizeOpsAlertCaseEventRecord(row);
                    if (!event) {
                        return;
                    }
                    const caseKey = this.buildOpsAlertCaseKey(event.category_key, event.target_id, event.site);
                    if (!eventMap.has(caseKey)) {
                        eventMap.set(caseKey, []);
                    }
                    const rows = eventMap.get(caseKey);
                    if (rows.length < 3) {
                        rows.push(event);
                    }
                });
            }
            return eventMap;
        } catch (error) {
            if (this.isMissingOpsAlertCaseEventsTableError(error)) {
                return new Map();
            }
            throw error;
        }
    }

    async attachOpsAlertCases(alerts = []) {
        const [caseMap, eventMap] = await Promise.all([
            this.fetchOpsAlertCasesForAlerts(alerts),
            this.fetchOpsAlertCaseEventsForAlerts(alerts)
        ]);
        const summaryFallbackCaseMap = this.buildOpsAlertSummaryFallbackCaseMap(alerts, caseMap);
        return (Array.isArray(alerts) ? alerts : []).map((alert) => {
            const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId, this.getOpsAlertCaseSite(alert));
            this.applyOpsAlertCaseRecord(alert, caseMap.get(caseKey) || summaryFallbackCaseMap.get(caseKey) || null);
            return this.applyOpsAlertCaseEvents(alert, eventMap.get(caseKey) || []);
        });
    }

    async refreshOpsAlertCaseStateForAlerts(alerts = []) {
        const uniqueAlerts = Array.from(new Map(
            (Array.isArray(alerts) ? alerts : [])
                .filter((alert) => alert?.caseCategoryKey && alert?.caseTargetId)
                .map((alert) => [this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId, this.getOpsAlertCaseSite(alert)), alert])
        ).values());
        if (!uniqueAlerts.length) {
            return [];
        }

        const [caseMap, eventMap] = await Promise.all([
            this.fetchOpsAlertCasesForAlerts(uniqueAlerts),
            this.fetchOpsAlertCaseEventsForAlerts(uniqueAlerts)
        ]);
        const summaryFallbackCaseMap = this.buildOpsAlertSummaryFallbackCaseMap(uniqueAlerts, caseMap);

        uniqueAlerts.forEach((alert) => {
            const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId, this.getOpsAlertCaseSite(alert));
            this.applyOpsAlertCaseRecord(alert, caseMap.get(caseKey) || summaryFallbackCaseMap.get(caseKey) || null);
            this.applyOpsAlertCaseEvents(alert, eventMap.get(caseKey) || []);
        });
        return uniqueAlerts;
    }

    async getOpsAlertCaseApiHeaders() {
        if (typeof window.getAdminConfigApiHeaders === 'function') {
            return window.getAdminConfigApiHeaders();
        }

        const headers = {
            'Content-Type': 'application/json'
        };

        if (window.AdminApi?.buildRequestInit) {
            try {
                const requestInit = await window.AdminApi.buildRequestInit({
                    headers
                });
                return requestInit?.headers || headers;
            } catch (_) {
                // Fall through to direct token resolution.
            }
        }

        let accessToken = '';

        try {
            const { data: { session } = { session: null } } = await this.supabase.auth.getSession();
            accessToken = String(session?.access_token || '').trim();
        } catch (_) {
            accessToken = '';
        }

        if (!accessToken && typeof this.supabase?.accessToken === 'function') {
            try {
                accessToken = String(await this.supabase.accessToken() || '').trim();
            } catch (_) {
                accessToken = '';
            }
        }

        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }

        return headers;
    }

    async mutateOpsAlertCase(alert = {}, action = '') {
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!normalizedAction || !alert.caseCategoryKey || !alert.caseTargetId) {
            throw new Error('缺少可处理的告警标识');
        }

        let note = '';
        let resolution = '';
        let ownerAdminId = '';
        let ownerLabel = '';
        if (normalizedAction === 'add_note') {
            note = String(window.prompt('请填写备注内容', alert.case_note || '') || '').trim();
            if (!note) {
                return null;
            }
        } else if (normalizedAction === 'assign') {
            const selectedOwner = await this.promptOpsAlertAssignee(alert.case_owner_admin_id || '');
            if (!selectedOwner) {
                return null;
            }
            ownerAdminId = selectedOwner.id;
            ownerLabel = selectedOwner.label;
            note = String(window.prompt('可选：填写交接备注', alert.case_note || '') || '').trim();
        } else if (normalizedAction === 'resolve') {
            resolution = String(window.prompt('请填写关闭结论', alert.case_resolution || alert.case_note || '') || '').trim();
            if (!resolution) {
                return null;
            }
        }

        const payload = await this.submitOpsAlertCaseMutationRequest(normalizedAction, alert, {
            ownerAdminId,
            ownerLabel,
            note,
            resolution,
            errorMessage: '站内代办处理失败'
        });
        return payload.case || null;
    }

    markOpsAlertCaseActionBusy(alertId = '', action = '', busy = false) {
        const lockKey = `${String(alertId || '').trim()}::${String(action || '').trim().toLowerCase()}`;
        if (!lockKey) return;
        if (busy) {
            this.opsAlertCaseActionLocks.add(lockKey);
        } else {
            this.opsAlertCaseActionLocks.delete(lockKey);
        }
    }

    isOpsAlertCaseActionBusy(alertId = '', action = '') {
        const lockKey = `${String(alertId || '').trim()}::${String(action || '').trim().toLowerCase()}`;
        return this.opsAlertCaseActionLocks.has(lockKey);
    }

    refreshOpsAlertViews() {
        this.composeSessions();
        this.renderSessionList(this.searchQuery);
        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    async handleOpsAlertCaseAction(alert = {}, action = '') {
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!normalizedAction) return false;
        if (this.isOpsAlertCaseActionBusy(alert.id, normalizedAction)) {
            return false;
        }
        if (normalizedAction === 'resolve' && this.isOpsAlertClosed(alert)) {
            this.refreshOpsAlertViews();
            window.showToast?.('这条代办已经关闭，无需重复关闭', 'info');
            return false;
        }

        try {
            this.markOpsAlertCaseActionBusy(alert.id, normalizedAction, true);
            this.refreshOpsAlertViews();

            if (normalizedAction === 'snooze') {
                const result = await this.applyOpsAlertSnooze(alert);
                if (!result) {
                    return false;
                }
                await this.refreshOpsAlertCaseStateForAlerts(
                    (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
                        .filter((item) => String(item.caseCategoryKey || '').trim().toLowerCase() === String(result.moduleKey || '').trim().toLowerCase())
                );
                this.refreshOpsAlertViews();
                window.showToast?.(result.message || '站内代办已更新', 'success');
                return true;
            }

            if (normalizedAction === 'create_ticket') {
                return await this.handleCreateOpsAlertTicket(alert);
            }

            if (normalizedAction === 'open_ticket') {
                return await this.openLinkedOpsAlertTicket(alert);
            }

            const nextCase = await this.mutateOpsAlertCase(alert, normalizedAction);
            if (!nextCase) {
                return false;
            }

            const targetAlert = this.opsAlertMessages.find((item) => item.id === alert.id) || alert;
            this.applyOpsAlertCaseRecord(targetAlert, nextCase);
            await this.refreshOpsAlertCaseStateForAlerts([targetAlert]);
            this.refreshOpsAlertViews();
            window.showToast?.('站内代办已更新', 'success');
            return true;
        } catch (error) {
            console.error('[AdminChat] Failed to mutate ops alert case:', error);
            window.showToast?.(`处理失败: ${error.message || '未知错误'}`, 'error');
            return false;
        } finally {
            this.markOpsAlertCaseActionBusy(alert.id, normalizedAction, false);
            this.refreshOpsAlertViews();
        }
    }

    buildOpsAlertContext(alertType = '', payload = {}, title = '', options = {}) {
        const targetId = this.getOpsAlertTargetId(payload, {
            ...options,
            alertType
        });
        const categoryKey = this.getOpsAlertCaseCategoryKey(alertType, targetId);
        const referenceLabel = this.getOpsAlertReferenceLabel(payload);
        const referenceValue = this.getOpsAlertReferenceValue(payload);
        const email = String(
            payload.email
            || payload.user_email
            || payload.sender_email
            || payload.admin_email
            || ''
        ).trim();
        const orderId = String(payload.order_id || '').trim();
        const paymentOrderId = String(payload.payment_order_id || '').trim();
        const ticketId = String(payload.ticket_id || '').trim();
        const ticketStatus = String(payload.ticket_status || '').trim().toLowerCase();
        const verificationId = String(payload.verification_id || '').trim();
        const productId = String(payload.product_id || '').trim();
        const adminId = String(payload.admin_id || '').trim();
        const adminEmail = String(payload.admin_email || '').trim();
        const providerOrderNo = String(payload.provider_order_no || '').trim();

        return {
            title: String(title || '').trim(),
            alertType,
            alert_type: alertType,
            category: categoryKey,
            referenceLabel,
            referenceValue,
            targetId,
            target_id: targetId,
            email,
            userId: String(payload.user_id || '').trim(),
            user_id: String(payload.user_id || '').trim(),
            clientIp: String(payload.client_ip || '').trim(),
            client_ip: String(payload.client_ip || '').trim(),
            discountCode: String(payload.discount_code || '').trim(),
            discount_code: String(payload.discount_code || '').trim(),
            sessionId: String(payload.session_id || '').trim(),
            session_id: String(payload.session_id || '').trim(),
            messageId: String(payload.message_id || '').trim(),
            message_id: String(payload.message_id || '').trim(),
            orderId,
            order_id: orderId,
            paymentOrderId,
            payment_order_id: paymentOrderId,
            providerOrderNo,
            provider_order_no: providerOrderNo,
            ticketId,
            ticket_id: ticketId,
            ticketStatus,
            ticket_status: ticketStatus,
            verificationId,
            verification_id: verificationId,
            productId,
            product_id: productId,
            adminId,
            admin_id: adminId,
            adminEmail,
            admin_email: adminEmail,
            site: String(payload.site || '').trim().toLowerCase(),
            signalType: String(payload.signal_type || '').trim().toLowerCase(),
            signal_type: String(payload.signal_type || '').trim().toLowerCase()
        };
    }

    resolveEntryPathWorkspace(entryPath = '', baseContext = {}) {
        if (typeof window.resolveOpsAlertEntryWorkspace === 'function') {
            return window.resolveOpsAlertEntryWorkspace(entryPath, baseContext);
        }
        return { kind: 'none' };
    }

    resolveShopRiskWorkspace(baseContext = {}, payload = {}) {
        if (typeof window.resolveShopRiskWorkspace === 'function') {
            return window.resolveShopRiskWorkspace(baseContext, payload);
        }
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-orders',
            context: baseContext
        };
    }

    resolveOpsAlertWorkspace(alertType = '', payload = {}, title = '', entryPath = '') {
        const baseContext = this.buildOpsAlertContext(alertType, payload, title);

        if (typeof window.resolveOpsAlertWorkspace === 'function') {
            return window.resolveOpsAlertWorkspace(alertType, payload, baseContext, entryPath);
        }
        return this.resolveEntryPathWorkspace(entryPath, baseContext);
    }

    normalizeOpsAlertJob(row = {}) {
        const payload = this.parseJsonObject(row.payload);
        const alertType = String(row.alert_type || '').trim().toLowerCase();
        const rawContent = String(row.content || '').trim();
        const content = rawContent || this.buildOpsAlertFallbackContent(alertType, payload, row.title);
        const entryPath = String(payload.entry_path || '').trim() || this.extractEntryPathFromContent(content);
        const createdAt = row.created_at || row.updated_at || new Date().toISOString();
        const updatedAt = row.updated_at || createdAt;
        const targetId = this.getOpsAlertTargetId(payload, { alertType, dedupeKey: row.dedupe_key || '' });
        const caseCategoryKey = this.getOpsAlertCaseCategoryKey(alertType, targetId);
        const alert = {
            id: String(row.id || `ops-alert-${createdAt}`),
            __kind: 'ops_alert',
            message_type: 'ops_alert',
            alertType,
            severity: String(row.severity || 'warning').trim().toLowerCase() || 'warning',
            title: String(row.title || '系统告警').trim() || '系统告警',
            content,
            displayContent: this.stripEntryPathFromContent(content),
            entryPath,
            status: String(row.status || 'pending').trim().toLowerCase() || 'pending',
            lastError: String(row.last_error || '').trim(),
            payload,
            workspace: null,
            created_at: createdAt,
            updated_at: updatedAt,
            delivered_at: row.delivered_at || '',
            timestamp: new Date(createdAt),
            sortTimestamp: new Date(updatedAt),
            preview: '',
            dedupeKey: String(row.dedupe_key || '').trim(),
            dedupe_key: String(row.dedupe_key || '').trim(),
            caseCategoryKey,
            caseTargetId: targetId,
            caseSite: this.getOpsAlertCaseSite({
                payload,
                site: payload.site
            }),
            referenceLabel: this.getOpsAlertReferenceLabel(payload),
            referenceValue: this.getOpsAlertReferenceValue(payload),
            case_status: '',
            case_owner_admin_id: '',
            case_owner_label: '',
            case_note: '',
            case_resolution: '',
            case_last_action: '',
            case_last_action_at: '',
            case_updated_at: '',
            case_recent_events: [],
            case_recent_note: '',
            case_recent_note_at: '',
            case_latest_event_action: '',
            case_latest_event_label: '',
            case_latest_event_summary: '',
            case_latest_event_at: '',
            case_latest_event_by_label: '',
            case_latest_event_owner_label: '',
            caseRecord: null
        };

        alert.workspace = this.resolveOpsAlertWorkspace(alertType, payload, alert.title, entryPath);
        alert.preview = this.buildOpsAlertPreview(alert);
        return alert;
    }

    matchesOpsAlertSiteFilter(alert = {}) {
        const siteFilter = String(this.getActiveSiteFilter() || 'all').trim().toLowerCase();
        if (siteFilter === 'all') return true;

        const site = this.getOpsAlertCaseSite(alert);
        return site === siteFilter;
    }

    buildOpsAlertSession() {
        const latest = this.opsAlertMessages[0] || null;
        const latestActive = (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .find((alert) => !this.isOpsAlertClosed(alert)) || null;
        const activeCount = this.getOpsAlertActiveCount();
        const unreadCount = this.getOpsAlertUnreadCount();
        const mutedModuleCount = this.getOpsAlertMutedModuleCount();
        const ownerSummary = this.getOpsAlertOwnerSummary();
        const preview = this.opsAlertLoadError
            ? `同步失败：${this.opsAlertLoadError}`
            : latestActive
                ? (latestActive.preview || '站外告警会同步到这里')
                : latest
                    ? '当前没有未关闭的站内代办'
                    : '站外告警会同步到这里';

        const subtextParts = this.opsAlertLoadError
            ? ['站外告警同步异常']
            : [ownerSummary || '固定系统联系人'];
        if (!this.opsAlertLoadError && this.opsAlertMessages.length) {
            subtextParts.push(`${this.formatCompactCount(this.opsAlertMessages.length)} 条同步`);
        }
        if (activeCount > 0) {
            subtextParts.push(`未关闭 ${this.formatCompactCount(activeCount)}`);
        }
        if (unreadCount > 0) {
            subtextParts.push(`未读 ${this.formatCompactCount(unreadCount)}`);
        }
        if (mutedModuleCount > 0) {
            subtextParts.push(`静音 ${this.formatCompactCount(mutedModuleCount)} 组`);
        }
        const subtext = subtextParts.join(' · ');
        const badge = this.opsAlertLoadError
            ? '异常'
            : unreadCount > 0
                ? `${this.formatCompactCount(unreadCount)}未读`
                : activeCount > 0
                ? `${this.formatCompactCount(activeCount)}待办`
                : mutedModuleCount > 0
                    ? `${this.formatCompactCount(mutedModuleCount)}静音`
                    : '置顶';

        return {
            sessionId: this.opsAlertSessionId,
            kind: 'ops_alerts',
            lastMessage: preview,
            timestamp: latestActive?.sortTimestamp || latestActive?.timestamp || latest?.sortTimestamp || latest?.timestamp || null,
            unread: 0,
            profile: null,
            subtext,
            badge
        };
    }

    composeSessions() {
        const sortedChatSessions = [...this.chatSessions].sort((left, right) => {
            const priorityDiff = this.getChatSessionSortPriority(right) - this.getChatSessionSortPriority(left);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : 0;
            const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : 0;
            return rightTime - leftTime;
        });

        this.sessions = [
            this.buildOpsAlertSession(),
            ...sortedChatSessions
        ];
        this.emitCommandCenterSummaryUpdate();
    }

    async bootstrapSessions() {
        if (this.sessionBootstrapPromise || !this.supabase?.from) {
            return this.sessionBootstrapPromise;
        }

        this.isSessionBootstrapPending = true;
        this.renderSessionList(this.searchQuery);

        this.sessionBootstrapPromise = (async () => {
            try {
                await this.ensureCurrentAdminUserId();
                const messages = await this.fetchChatMessages();
                if (this.destroyed) return;

                await this.processSessionsData(messages, { includeOperationalSummaries: false, includeProfiles: false });
                if (this.destroyed) return;
                this.persistChatSessionCache();
            } catch (error) {
                console.error('Error bootstrapping chat sessions:', error);
                this.chatSessions = [];
            }

            this.hasBootstrappedSessions = true;
            this.isSessionBootstrapPending = false;
            this.composeSessions();
            this.syncCurrentSessionFromSessions();
            this.renderSessionList(this.searchQuery);
            this.startBackgroundServices();
            this.scheduleDeferredSessionHydration();
            this.scheduleSessionHistoryConsistencySync();
        })().finally(() => {
            this.sessionBootstrapPromise = null;
        });

        return this.sessionBootstrapPromise;
    }

    async hydrateSessionSidebarData() {
        if (!this.supabase?.from || this.destroyed) {
            return;
        }

        const baseChatSessions = Array.isArray(this.chatSessions)
            ? this.chatSessions.map((session) => ({
                ...session,
                sessionIds: Array.isArray(session.sessionIds) ? [...session.sessionIds] : [],
                profile: session.profile && typeof session.profile === 'object'
                    ? { ...session.profile }
                    : session.profile
            }))
            : [];

        const [enrichedChatSessionsResult, opsAlertResult, opsAlertMetaResult, opsAlertConfigResult] = await Promise.allSettled([
            baseChatSessions.length
                ? this.attachSessionProfiles(baseChatSessions)
                    .then((sessionsWithProfiles) => this.attachSessionOperationalSummaries(sessionsWithProfiles))
                : Promise.resolve(baseChatSessions),
            this.fetchOpsAlertJobs(),
            this.ensureOpsAlertMonitorMeta(),
            this.fetchOpsAlertSettingsConfig()
        ]);

        if (this.destroyed) {
            return;
        }

        if (enrichedChatSessionsResult.status === 'fulfilled') {
            this.chatSessions = enrichedChatSessionsResult.value.map((session) => ({
                ...session,
                replySummary: session.replySummary || this.buildSessionReplySummary(session.lastUserMessageAt, session.lastAdminMessageAt)
            }));
            this.persistChatSessionCache();
        } else {
            console.warn('Failed to enrich chat session summaries:', enrichedChatSessionsResult.reason);
        }

        if (opsAlertResult.status === 'fulfilled') {
            await this.processOpsAlertData(opsAlertResult.value);
        } else {
            console.error('Error fetching ops alert jobs:', opsAlertResult.reason);
            this.opsAlertMessages = [];
            this.opsAlertLoadError = opsAlertResult.reason?.message || '站外告警读取失败';
        }

        if (opsAlertMetaResult.status !== 'fulfilled') {
            console.warn('Failed to fetch ops alert assignee meta:', opsAlertMetaResult.reason);
        }
        if (opsAlertConfigResult.status !== 'fulfilled') {
            console.warn('Failed to fetch ops alert mute rules:', opsAlertConfigResult.reason);
        }

        this.hasHydratedSessionSidebarData = true;
        this.composeSessions();
        this.syncCurrentSessionFromSessions();
        this.renderSessionList(this.searchQuery);

        if (this.currentSessionId && this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    init() {
        const container = this.targetContainer || document.getElementById('chat-admin-container');
        if (!container) return;

        this.startAdminPresence();
        this.renderLayout(container);
        this.subscribeToUserPresence();
        this.subscribeToUserActivity();
        const restoredFromCache = this.restoreChatSessionCache();
        if (restoredFromCache) {
            this.composeSessions();
            this.syncCurrentSessionFromSessions();
            this.renderSessionList(this.searchQuery);
            void this.refreshUserActivityForSessions(this.chatSessions, { render: true });
        }
        this.bootstrapSessions();

        const searchInput = container.querySelector('#sessionSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                this.filterSessions(event.target.value);
            });
        }
    }

    renderLayout(container) {
        document.removeEventListener('click', this.handleDocumentClick);

        container.innerHTML = `
            <div class="chat-container" id="chatMainContainer">
                <div class="chat-sidebar" id="chatSidebar">
                    <div class="chat-sidebar-header">
                        <button class="mobile-menu-btn chat-menu-btn" type="button" data-admin-action="toggle-mobile-sidebar">
                            <i class="fas fa-bars"></i>
                        </button>
                        <span class="chat-sidebar-title">${this.t('chat.sidebarTitle', '客服消息')}</span>
                    </div>
                    <div class="chat-sidebar-body">
                        <div class="chat-search">
                            <input type="text" id="sessionSearch" placeholder="${this.t('chat.searchPlaceholder', '搜索会话...')}">
                        </div>
                        <section class="chat-sidebar-insights is-collapsed" id="chatSidebarInsights">
                            <button type="button" class="chat-sidebar-insights__header" id="chatSidebarInsightsToggle" aria-expanded="false">
                                <span class="chat-sidebar-insights__eyebrow">值班概览</span>
                                <span class="chat-sidebar-insights__summary" id="chatSidebarInsightsSummary">正在整理当前队列...</span>
                                <span class="chat-sidebar-insights__toggle-text">展开</span>
                            </button>
                            <div class="chat-sidebar-insights__body" id="chatSidebarInsightsBody">
                                <div class="session-queue-overview" id="sessionQueueOverview"></div>
                                <div class="session-queue-snapshot" id="sessionQueueSnapshot"></div>
                                <div class="session-queue-presets" id="sessionQueueViews"></div>
                                <div class="session-filter-bar" id="sessionFilterBar"></div>
                            </div>
                        </section>
                        <div class="session-list" id="sessionList">
                            <!-- Sessions will be loaded here -->
                        </div>
                    </div>
                </div>

                <div class="chat-main" id="chatMainPanel">
                    <div id="chatEmptyState" class="chat-empty-state">
                        <i class="fas fa-comments"></i>
                        <p>${this.t('chat.emptyStateChat', '请从左侧选择一个会话开始聊天')}</p>
                    </div>
                    <div id="chatInterface" class="chat-interface" hidden>
                        <div class="chat-main-header">
                            <div class="mobile-back-btn" id="mobileBackBtn">
                                <i class="fas fa-arrow-left"></i>
                            </div>
                            <div class="chat-user-title">
                                <h3 id="currentChatUser">${this.t('chat.guest', '访客')}</h3>
                                <span id="currentChatId">ID: ...</span>
                                <div id="currentChatStatusChips" class="chat-user-status-chips" hidden></div>
                            </div>
                        </div>
                        <div id="chatContextPanel" class="chat-context-panel" hidden></div>
                        <div class="chat-messages-area" id="adminMessagesArea">
                            <!-- Messages -->
                        </div>
                        <div id="chatReplyTemplateBar" class="chat-reply-templates" hidden></div>
                        <div class="chat-input-wrapper chat-input-area" id="chatInputWrapper">
                            <input type="file" id="adminImageInput" class="admin-chat-file-input" accept="image/*" hidden>
                            <button class="chat-action-btn" id="adminUploadBtn"><i class="fas fa-plus"></i></button>
                            <input type="text" class="chat-input admin-chat-input" id="adminChatInput" placeholder="${this.t('chat.inputMessagePlaceholder', '输入消息...')}">
                            <button class="chat-action-btn" id="adminEmojiBtn"><i class="far fa-smile"></i></button>
                            <button class="chat-send-btn admin-send-btn" id="adminSendBtn"><i class="fas fa-paper-plane"></i></button>
                        </div>
                        <div class="emoji-picker-popover admin-emoji-picker" id="adminEmojiPicker" hidden></div>
                    </div>
                </div>
            </div>
        `;

        const sendBtn = container.querySelector('#adminSendBtn');
        const input = container.querySelector('#adminChatInput');
        const backBtn = container.querySelector('#mobileBackBtn');
        const uploadBtn = container.querySelector('#adminUploadBtn');
        const imageInput = container.querySelector('#adminImageInput');
        const emojiBtn = container.querySelector('#adminEmojiBtn');
        const emojiPicker = container.querySelector('#adminEmojiPicker');
        const sessionQueueOverview = container.querySelector('#sessionQueueOverview');
        const sessionQueueSnapshot = container.querySelector('#sessionQueueSnapshot');
        const sessionQueueViews = container.querySelector('#sessionQueueViews');
        const sessionFilterBar = container.querySelector('#sessionFilterBar');
        const sidebarInsightsToggle = container.querySelector('#chatSidebarInsightsToggle');

        const emojis = ['😀', '😂', '🥰', '😍', '🤔', '👍', '👎', '🙏', '🎉', '❤️', '🔥', '✨', '💯', '😊', '😅', '🤣', '😢', '😭', '😱', '🤗'];
        if (emojiPicker) {
            emojiPicker.innerHTML = emojis.map((emoji) => `<div class="emoji-item">${emoji}</div>`).join('');
            emojiPicker.addEventListener('click', (event) => {
                if (event.target.classList.contains('emoji-item')) {
                    input.value += event.target.textContent;
                    input.focus();
                    this.setElementHidden(emojiPicker, true);
                }
            });
        }

        if (sendBtn) sendBtn.addEventListener('click', () => this.sendReply());
        if (input) {
            input.addEventListener('keypress', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    this.sendReply();
                }
            });
        }
        this.attachMobileKeyboardDock();
        if (backBtn) backBtn.addEventListener('click', () => this.backToSessions());

        if (uploadBtn && imageInput) {
            uploadBtn.addEventListener('click', () => imageInput.click());
            imageInput.addEventListener('change', (event) => this.handleImageUpload(event));
        }

        if (emojiBtn && emojiPicker) {
            emojiBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setElementHidden(emojiPicker, !emojiPicker.hidden);
            });
        }

        if (sessionQueueOverview) {
            sessionQueueOverview.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-stat-filter]');
                if (!button) return;
                this.sessionQueueView = 'all';
                this.setSessionQueueFilter(button.getAttribute('data-session-stat-filter') || 'all');
            });
        }

        if (sessionQueueViews) {
            sessionQueueViews.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-view]');
                if (!button) return;
                this.setSessionQueueView(button.getAttribute('data-session-view') || 'all');
            });
        }

        if (sessionQueueSnapshot) {
            sessionQueueSnapshot.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-snapshot-action]');
                if (!button) return;
                const action = button.getAttribute('data-session-snapshot-action');
                if (action === 'restore-default') {
                    this.restoreSessionQueueDefaultView();
                } else if (action === 'apply-recommended-mode') {
                    this.sessionQueueView = this.normalizeSessionQueueView(button.getAttribute('data-session-recommended-view') || 'all');
                    this.sessionQueueFilter = this.normalizeSessionQueueFilter(button.getAttribute('data-session-recommended-filter') || 'all');
                    this.persistSessionQueuePreferences();
                    this.renderSessionQueueControls();
                    this.renderSessionList(this.searchQuery);
                } else if (action === 'save-default') {
                    this.saveCurrentSessionQueueAsDefault();
                }
            });
        }

        if (sessionFilterBar) {
            sessionFilterBar.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-filter]');
                if (!button) return;
                this.setSessionQueueFilter(button.getAttribute('data-session-filter') || 'all');
            });
        }

        if (sidebarInsightsToggle) {
            sidebarInsightsToggle.addEventListener('click', () => {
                this.setSidebarInsightsCollapsed(!(this.sidebarInsightsCollapsed !== false));
            });
        }

        this.updateSidebarInsightsShell();
        this.initScrollbarAutoHide(container);

        document.addEventListener('click', this.handleDocumentClick);
    }

    async fetchChatMessages({ fullHistory = false } = {}) {
        const selectFields = 'id, session_id, user_id, is_admin, content, message_type, created_at';
        const applySiteFilter = (query) => {
            if (window.AdminSiteFilter) {
                return window.AdminSiteFilter.applySiteFilter(query);
            }
            return query;
        };

        if (!fullHistory) {
            let query = this.supabase
                .from('chat_messages')
                .select(selectFields)
                .order('created_at', { ascending: false })
                .limit(this.getChatBootstrapMessageLimit());

            query = applySiteFilter(query);

            const { data, error } = await query;
            if (error) {
                throw error;
            }
            return Array.isArray(data) ? data : [];
        }

        const pageSize = this.getChatHistoryPageSize();
        let from = 0;
        let hasMore = true;
        const rows = [];

        while (hasMore && !this.destroyed) {
            let query = this.supabase
                .from('chat_messages')
                .select(selectFields)
                .order('created_at', { ascending: false })
                .range(from, from + pageSize - 1);

            query = applySiteFilter(query);

            const { data, error } = await query;
            if (error) {
                throw error;
            }

            const batch = Array.isArray(data) ? data : [];
            rows.push(...batch);
            hasMore = batch.length === pageSize;
            from += pageSize;
        }

        return rows;
    }

    async fetchOpsAlertJobs() {
        const { data, error } = await this.supabase
            .from('ops_alert_jobs')
            .select('id, dedupe_key, alert_type, severity, title, content, payload, status, last_error, created_at, updated_at, delivered_at')
            .order('created_at', { ascending: false })
            .limit(160);

        if (error) {
            throw error;
        }
        return Array.isArray(data) ? data : [];
    }

    async fetchSessions() {
        if (!this.supabase?.from) {
            return;
        }

        await this.ensureCurrentAdminUserId();

        const [chatResult, opsAlertResult, opsAlertMetaResult, opsAlertConfigResult] = await Promise.allSettled([
            this.fetchChatMessages({ fullHistory: true }),
            this.fetchOpsAlertJobs(),
            this.ensureOpsAlertMonitorMeta(),
            this.fetchOpsAlertSettingsConfig()
        ]);

        if (chatResult.status === 'fulfilled') {
            await this.processSessionsData(chatResult.value, { includeOperationalSummaries: true });
            this.persistChatSessionCache();
        } else {
            console.error('Error fetching chat sessions:', chatResult.reason);
            this.chatSessions = [];
        }

        if (opsAlertResult.status === 'fulfilled') {
            await this.processOpsAlertData(opsAlertResult.value);
        } else {
            console.error('Error fetching ops alert jobs:', opsAlertResult.reason);
            this.opsAlertMessages = [];
            this.opsAlertLoadError = opsAlertResult.reason?.message || '站外告警读取失败';
        }

        if (opsAlertMetaResult.status !== 'fulfilled') {
            console.warn('Failed to fetch ops alert assignee meta:', opsAlertMetaResult.reason);
        }
        if (opsAlertConfigResult.status !== 'fulfilled') {
            console.warn('Failed to fetch ops alert mute rules:', opsAlertConfigResult.reason);
        }

        this.hasBootstrappedSessions = true;
        this.hasHydratedSessionSidebarData = true;
        this.composeSessions();
        this.syncCurrentSessionFromSessions();
        this.renderSessionList(this.searchQuery);

        if (this.currentSessionId && this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    async syncSessionsWithCompleteHistory() {
        if (!this.supabase?.from || this.destroyed) {
            return;
        }

        await this.ensureCurrentAdminUserId();

        const completeMessages = await this.fetchChatMessages({ fullHistory: true });
        if (this.destroyed || !Array.isArray(completeMessages) || !completeMessages.length) {
            return;
        }

        if (completeMessages.length <= this.getChatBootstrapMessageLimit()
            && Array.isArray(this.chatSessions)
            && this.chatSessions.length
        ) {
            return;
        }

        await this.processSessionsData(completeMessages, {
            includeOperationalSummaries: true,
            includeProfiles: true
        });

        if (this.destroyed) {
            return;
        }

        this.persistChatSessionCache();
        this.composeSessions();
        this.syncCurrentSessionFromSessions();
        this.renderSessionList(this.searchQuery);
    }

    async processSessionsData(messages, { includeOperationalSummaries = true, includeProfiles = true } = {}) {
        const safeMessages = Array.isArray(messages) ? messages : [];
        const userMessages = safeMessages.filter((msg) => !msg.is_admin);
        const userSessionMap = new Map();
        const sessionIdToGroupKey = new Map();
        const adminUserId = String(this.currentAdminUserId || '').trim();

        userMessages.forEach((msg) => {
            const groupKey = msg.user_id || msg.session_id;
            if (!groupKey) return;
            if (adminUserId && String(groupKey).trim() === adminUserId) return;

            if (!userSessionMap.has(groupKey)) {
                userSessionMap.set(groupKey, {
                    lastMsg: msg,
                    sessionIds: new Set([msg.session_id]),
                    userId: msg.user_id,
                    lastUserMessageAt: null,
                    lastAdminMessageAt: null
                });
            } else {
                userSessionMap.get(groupKey).sessionIds.add(msg.session_id);
            }

            sessionIdToGroupKey.set(msg.session_id, groupKey);
        });

        safeMessages.forEach((msg) => {
            const groupKey = sessionIdToGroupKey.get(msg.session_id) || msg.user_id || msg.session_id;
            const group = userSessionMap.get(groupKey);
            if (!group) return;

            if (msg.is_admin) {
                if (!group.lastAdminMessageAt) {
                    group.lastAdminMessageAt = msg.created_at;
                }
            } else if (!group.lastUserMessageAt) {
                group.lastUserMessageAt = msg.created_at;
            }
        });

        const sessions = Array.from(userSessionMap.entries()).map(([groupKey, data]) => {
            const lastMsg = data.lastMsg || {};
            const normalizedGroupKey = typeof groupKey === 'string' ? groupKey.trim() : String(groupKey || '');
            const sessionIds = Array.from(data.sessionIds);
            const profile = null;
            const email = this.resolveSessionEmail(profile, normalizedGroupKey, sessionIds);
            const nickname = this.resolveSessionNickname(profile, normalizedGroupKey, email);

            return {
                sessionId: normalizedGroupKey,
                sessionIds,
                nickname,
                email,
                lastMessage: lastMsg.message_type === 'image' ? this.t('chat.image', '[图片]') : lastMsg.content,
                timestamp: new Date(lastMsg.created_at),
                userId: data.userId,
                unread: 0,
                profile,
                lastUserMessageAt: data.lastUserMessageAt || null,
                lastAdminMessageAt: data.lastAdminMessageAt || null,
                replySummary: null
            };
        });

        const sessionsWithProfiles = includeProfiles
            ? await this.attachSessionProfiles(sessions)
            : sessions;

        const normalizedSessions = includeOperationalSummaries
            ? await this.attachSessionTicketSummaries(sessionsWithProfiles)
            : sessionsWithProfiles;

        this.chatSessions = normalizedSessions.map((session) => ({
            ...session,
            replySummary: this.buildSessionReplySummary(session.lastUserMessageAt, session.lastAdminMessageAt)
        }));
        await this.refreshUserActivityForSessions(this.chatSessions, { render: false });
        this.applyUserPresenceToSessions();
    }

    async processOpsAlertData(rows) {
        this.opsAlertLoadError = '';
        const alerts = (Array.isArray(rows) ? rows : [])
            .map((row) => this.normalizeOpsAlertJob(row))
            .filter((alert) => this.matchesOpsAlertSiteFilter(alert));
        this.opsAlertMessages = (await this.attachOpsAlertCases(alerts))
            .sort((left, right) => {
                const leftTime = left.sortTimestamp instanceof Date ? left.sortTimestamp.getTime() : 0;
                const rightTime = right.sortTimestamp instanceof Date ? right.sortTimestamp.getTime() : 0;
                return rightTime - leftTime;
            });
    }

    getSessionDisplayInfo(session) {
        if (this.isOpsAlertSession(session)) {
            return {
                name: '站内代办',
                subtext: session.subtext || '固定系统联系人',
                preview: session.lastMessage || '站外告警会同步到这里',
                badge: session.badge || '置顶'
            };
        }

        const resolvedEmail = this.resolveSessionContextEmail(session);
        let displayName = session.nickname
            || session.profile?.display_name
            || session.profile?.username
            || (resolvedEmail ? resolvedEmail.split('@')[0] : this.t('chat.guest', '访客'));
        let displaySub = resolvedEmail || this.t('chat.noEmail', '无邮箱');
        const presenceStatus = this.getSessionPresenceStatusItem(session);

        if (!resolvedEmail) {
            const primarySessionId = String((session.sessionIds && session.sessionIds[0]) || session.sessionId || '').trim();
            displaySub = primarySessionId ? `${primarySessionId.slice(0, 8)}...` : this.t('chat.noEmail', '无邮箱');
        }

        if (presenceStatus?.value) {
            displaySub = displaySub ? `${presenceStatus.value} · ${displaySub}` : presenceStatus.value;
        }

        const prioritySignals = this.getSessionPrioritySignals(session);
        const prioritySubtext = prioritySignals
            .map((signal) => signal.subtext)
            .filter(Boolean)
            .slice(0, 2)
            .join(' · ');
        if (prioritySubtext) {
            displaySub = displaySub ? `${displaySub} · ${prioritySubtext}` : prioritySubtext;
        }

        return {
            name: displayName,
            subtext: displaySub,
            preview: session.lastMessage || '',
            badge: prioritySignals[0]?.label || '',
            badgeClass: prioritySignals[0]?.badgeClass || ''
        };
    }

    sessionMatchesFilter(session, filter = '') {
        const normalizedFilter = String(filter || '').trim().toLowerCase();
        if (!normalizedFilter) return true;

        const display = this.getSessionDisplayInfo(session);
        const haystack = [
            display.name,
            display.subtext,
            display.preview
        ];

        if (this.isOpsAlertSession(session)) {
            this.opsAlertMessages.forEach((alert) => {
                haystack.push(alert.title, alert.content, alert.entryPath, alert.case_owner_label || '');
            });
        } else {
            const ticketSummary = session.ticketSummary || {};
            const paymentSummary = session.paymentSummary || {};
            const verificationSummary = session.verificationSummary || {};
            const prioritySignals = this.getSessionPrioritySignals(session);
            haystack.push(
                session.profile?.email || '',
                session.profile?.username || '',
                session.nickname || '',
                session.email || '',
                session.sessionId || '',
                (session.sessionIds || []).join(' '),
                prioritySignals.map((signal) => `${signal.label} ${signal.subtext || ''}`).join(' '),
                this.getSessionListTicketBadge(ticketSummary),
                this.getSessionListTicketSubtext(ticketSummary),
                ticketSummary.latestOpenTicket?.description || '',
                ticketSummary.latestOpenTicket?.status || '',
                ticketSummary.latestOpenTicket?.id || '',
                paymentSummary.status || '',
                paymentSummary.package_name || '',
                paymentSummary.id || '',
                verificationSummary.status || '',
                verificationSummary.message || '',
                verificationSummary.verification_id || ''
            );
        }

        return haystack
            .join('\n')
            .toLowerCase()
            .includes(normalizedFilter);
    }

    renderSessionList(filter = '') {
        const listEl = document.getElementById('sessionList');
        if (!listEl) return;

        this.renderSessionQueueControls();
        listEl.replaceChildren();

        const visibleSessions = this.sessions
            .filter((session) => this.sessionMatchesQueueView(session))
            .filter((session) => this.sessionMatchesQueueFilter(session))
            .filter((session) => this.sessionMatchesFilter(session, filter));

        if (!visibleSessions.length) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'session-empty-state';
            emptyEl.textContent = this.isSessionBootstrapPending
                ? '正在加载会话...'
                : this.getSessionQueueEmptyMessage(filter);
            listEl.appendChild(emptyEl);
            return;
        }

        visibleSessions.forEach((session) => {
                const display = this.getSessionDisplayInfo(session);
                const el = document.createElement('div');
                el.className = `session-item ${(this.currentSessionKey || this.currentSessionId) === session.sessionId ? 'active' : ''} ${this.isOpsAlertSession(session) ? 'session-item--ops' : ''}`;
                el.addEventListener('click', () => this.loadSession(session.sessionId));

                const avatarEl = this.createSessionAvatar(session, display.name);
                const infoEl = document.createElement('div');
                infoEl.className = 'session-info';

                const headerEl = document.createElement('div');
                headerEl.className = 'session-header';

                const headerMainEl = document.createElement('div');
                headerMainEl.className = 'session-header-main';

                const nameEl = document.createElement('span');
                nameEl.className = 'session-name';
                nameEl.textContent = display.name;

                headerMainEl.appendChild(nameEl);

                if (display.badge) {
                    const badgeEl = document.createElement('span');
                    badgeEl.className = `session-badge${display.badgeClass ? ` ${display.badgeClass}` : ''}`;
                    badgeEl.textContent = display.badge;
                    headerMainEl.appendChild(badgeEl);
                }

                const isOpsSession = this.isOpsAlertSession(session);
                const presenceStatus = this.getSessionPresenceStatusItem(session);
                const isPresenceOnline = presenceStatus?.value === '在线';
                const inactiveActivityFallback = this.hasKnownUserIdentityForSession(session)
                    ? this.t('chat.noActiveRecord', '暂无活跃')
                    : this.formatSessionTime(session.timestamp);
                const timeEl = document.createElement('span');
                timeEl.className = `session-time${isPresenceOnline ? ' session-time--online' : ''}`;
                timeEl.textContent = isOpsSession
                    ? ''
                    : isPresenceOnline
                    ? '在线'
                    : (presenceStatus?.value || inactiveActivityFallback);

                headerEl.appendChild(headerMainEl);
                headerEl.appendChild(timeEl);

                const subEl = document.createElement('div');
                subEl.className = 'session-preview session-preview-subtext';
                subEl.textContent = display.subtext;

                const previewEl = document.createElement('div');
                previewEl.className = 'session-preview';
                previewEl.textContent = display.preview;

                infoEl.appendChild(headerEl);
                infoEl.appendChild(subEl);
                infoEl.appendChild(previewEl);

                el.appendChild(avatarEl);
                el.appendChild(infoEl);
                listEl.appendChild(el);
            });
    }

    setReadonlyMode(readonly) {
        const inputWrapper = document.getElementById('chatInputWrapper');
        const input = document.getElementById('adminChatInput');
        const uploadBtn = document.getElementById('adminUploadBtn');
        const emojiBtn = document.getElementById('adminEmojiBtn');
        const sendBtn = document.getElementById('adminSendBtn');
        const templateBar = document.getElementById('chatReplyTemplateBar');

        this.setElementHidden(inputWrapper, readonly);
        this.setElementHidden(templateBar, readonly);

        if (input) {
            input.disabled = readonly;
            if (!readonly) {
                input.placeholder = this.t('chat.inputPlaceholder', '输入回复...');
            }
        }
        if (uploadBtn) uploadBtn.disabled = readonly;
        if (emojiBtn) emojiBtn.disabled = readonly;
        if (sendBtn) sendBtn.disabled = readonly;
    }

    fetchSessionMessages(sessionIds = []) {
        const normalizedSessionIds = Array.from(new Set(
            (Array.isArray(sessionIds) ? sessionIds : [sessionIds])
                .map((value) => String(value || '').trim())
                .filter(Boolean)
        ));

        let query = this.supabase
            .from('chat_messages')
            .select('*')
            .order('created_at', { ascending: true });

        query = normalizedSessionIds.length === 1
            ? query.eq('session_id', normalizedSessionIds[0])
            : query.in('session_id', normalizedSessionIds);

        return query;
    }

    warmUser360ContextForSession(session = {}, contextRequestId = this._userContextRequestId) {
        return this.fetchUser360Context(session || {})
            .then((context) => {
                if (this.destroyed || contextRequestId !== this._userContextRequestId) {
                    return null;
                }

                this.currentUserContext = context;
                this.renderUser360Context(context);
                return context;
            })
            .catch((error) => {
                if (this.destroyed || contextRequestId !== this._userContextRequestId) {
                    return null;
                }

                this.currentUserContext = null;
                this.renderUserContextPanelState('暂时无法读取用户上下文', 'error');
                console.warn('[AdminChat] User 360 context warm failed:', error?.message || error);
                return null;
            });
    }

    async loadSession(sessionId) {
        this.currentSessionKey = sessionId;
        this.renderSessionList(this.searchQuery);

        const container = document.getElementById('chatMainContainer');
        container?.classList.add('mobile-chat-active');

        this.setElementHidden(document.getElementById('chatEmptyState'), true);
        const interfaceEl = document.getElementById('chatInterface');
        this.setElementHidden(interfaceEl, false);
        this.attachMobileKeyboardDock();
        this.requestAdminChatKeyboardDockSync();

        const normalizedRequestedSessionId = String(sessionId || '').trim();
        const session = this.sessions.find((item) => item.sessionId === normalizedRequestedSessionId)
            || this.sessions.find((item) => (
                Array.isArray(item?.sessionIds)
                && item.sessionIds.some((value) => String(value || '').trim() === normalizedRequestedSessionId)
            ));
        this.currentSessionInfo = session || null;
        const sessionIds = Array.from(new Set(
            (Array.isArray(session?.sessionIds) && session.sessionIds.length ? session.sessionIds : [sessionId])
                .map((value) => String(value || '').trim())
                .filter(Boolean)
        ));
        this.currentSessionIds = sessionIds;
        this.currentSessionId = sessionIds[0] || sessionId;
        const area = document.getElementById('adminMessagesArea');
        const contextRequestId = ++this._userContextRequestId;
        if (!area) return;

        if (this.isOpsAlertSession(session)) {
            this.currentUserContext = null;
            this.renderUser360Context(null);
            document.getElementById('currentChatUser').textContent = '站内代办';
            document.getElementById('currentChatId').textContent = '站外告警同步 / 可认领、备注、关闭并跳转处理页';
            this.renderUserContextHeaderStatus(null);
            this.setReadonlyMode(true);
            area.innerHTML = this.buildMessageAreaLoadingSkeleton();
            this.renderOpsAlertMessages();
            return;
        }

        this.setReadonlyMode(false);
        this.renderReplyTemplateBar({
            sessionId: this.currentSessionId,
            userId: session?.profile?.id || session?.userId || '',
            email: this.resolveSessionContextEmail(session),
            orders: [],
            payments: [],
            verifications: [],
            tickets: []
        });

        const resolvedEmail = this.resolveSessionContextEmail(session);
        const title = session?.nickname
            || session?.profile?.display_name
            || session?.profile?.username
            || (resolvedEmail ? resolvedEmail.split('@')[0] : (sessionId.startsWith('guest') ? this.t('chat.guest', '访客') : this.t('chat.user', '用户')));
        const sub = resolvedEmail || `${this.t('chat.session', 'Session')}: ${this.currentSessionId}`;

        document.getElementById('currentChatUser').textContent = title;
        document.getElementById('currentChatId').textContent = sub;

        area.innerHTML = this.buildMessageAreaLoadingSkeleton();
        this.currentUserContext = null;
        this.renderUserContextPanelState('正在整理用户上下文...', 'loading');
        const contextPromise = this.warmUser360ContextForSession(session || {}, contextRequestId);

        let messagesResult;
        try {
            messagesResult = await this.fetchSessionMessages(sessionIds);
        } catch (error) {
            messagesResult = { error };
        }

        if (contextRequestId !== this._userContextRequestId) {
            return;
        }

        if (messagesResult?.error) {
            area.innerHTML = `<div class="chat-loading-state chat-loading-state--error">${this.escapeHtml(this.t('chat.loadFailed', '加载失败'))}</div>`;
            return;
        }

        area.innerHTML = '';
        (messagesResult?.data || []).forEach((message) => this.appendMessage(message, { scroll: false }));
        this.scrollToBottom();
        void contextPromise;
    }

    renderOpsAlertMessages() {
        const area = document.getElementById('adminMessagesArea');
        if (!area) return;

        area.innerHTML = '';

        if (this.opsAlertLoadError) {
            area.innerHTML = `<div class="chat-loading-state chat-loading-state--error">站外告警读取失败：${this.escapeHtml(this.opsAlertLoadError)}</div>`;
            return;
        }

        const toolbar = this.createOpsAlertToolbarElement();
        if (toolbar) {
            area.appendChild(toolbar);
        }

        const alerts = [...this.getFilteredOpsAlertMessages()].sort((left, right) => {
            const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : 0;
            const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : 0;
            return leftTime - rightTime;
        });

        if (!alerts.length) {
            let message = '当前筛选下还没有同步过来的站外告警。';
            if (this.opsAlertViewFilter === 'mine') {
                message = '当前还没有你认领的站内代办。';
            } else if (this.opsAlertViewFilter === 'unread') {
                message = '当前筛选下没有未读代办。';
            } else if (this.opsAlertViewFilter === 'read') {
                message = '当前筛选下没有已读代办。';
            } else if (this.opsAlertViewFilter === 'active') {
                message = '当前没有未关闭的站内代办。';
            }
            if (this.opsAlertOwnerFilter === 'unassigned') {
                message = '当前没有未认领的站内代办。';
            } else if (this.opsAlertOwnerFilter !== 'all') {
                const ownerOption = this.getOpsAlertOwnerFilterOptions()
                    .find((option) => option.value === this.opsAlertOwnerFilter);
                if (ownerOption?.label) {
                    message = `当前没有分配给${ownerOption.label}的站内代办。`;
                }
            }
            area.insertAdjacentHTML('beforeend', `<div class="chat-loading-state">${this.escapeHtml(message)}</div>`);
            return;
        }

        alerts.forEach((alert) => this.appendMessage(alert, { scroll: false }));
        this.scrollToBottom();
    }

    backToSessions() {
        const container = document.getElementById('chatMainContainer');
        container?.classList.remove('mobile-chat-active');
        this.currentSessionId = null;
        this.currentSessionKey = null;
        this.currentSessionIds = [];
        this.currentSessionInfo = null;
        this.currentUserContext = null;
        this.renderUserContextHeaderStatus(null);
        this.renderReplyTemplateBar(null);
        this.setElementHidden(document.getElementById('chatEmptyState'), false);
        this.setElementHidden(document.getElementById('chatInterface'), true);
        this.releaseAdminChatKeyboardDock();
        this.renderSessionList(this.searchQuery);
    }

    createOpsAlertMessageElement(alert = {}) {
        const wrapper = document.createElement('div');
        const isRead = this.isOpsAlertRead(alert) && !this.isOpsAlertClosed(alert);
        wrapper.className = `admin-message received admin-message--ops-alert admin-message--severity-${this.escapeHtml(alert.severity || 'warning')}${isRead ? ' admin-message--ops-alert-read' : ''}`;
        wrapper.dataset.id = alert.id || '';

        const card = document.createElement('div');
        card.className = 'admin-alert-card';

        const header = document.createElement('div');
        header.className = 'admin-alert-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'admin-alert-header-main';

        const badge = document.createElement('span');
        badge.className = `admin-alert-badge admin-alert-badge--${this.escapeHtml(alert.severity || 'warning')}`;
        badge.textContent = this.getOpsAlertSeverityLabel(alert.severity);

        const title = document.createElement('div');
        title.className = 'admin-alert-title';
        title.textContent = alert.title || '系统告警';

        titleWrap.appendChild(badge);
        if (alert.caseTargetId) {
            const statusBadge = document.createElement('span');
            statusBadge.className = `admin-alert-case-badge admin-alert-case-badge--${this.escapeHtml(this.getOpsAlertCaseStatusTone(alert.case_status))}`;
            statusBadge.textContent = this.getOpsAlertCaseStatusLabel(alert.case_status);
            titleWrap.appendChild(statusBadge);
        }
        if (alert.moduleMuteActive && alert.moduleMuteUntil) {
            const muteBadge = document.createElement('span');
            muteBadge.className = 'admin-alert-case-badge admin-alert-case-badge--muted';
            muteBadge.textContent = `已静音至 ${this.formatDetailTime(alert.moduleMuteUntil)}`;
            titleWrap.appendChild(muteBadge);
        }
        if (isRead) {
            const readBadge = document.createElement('span');
            readBadge.className = 'admin-alert-case-badge admin-alert-case-badge--read';
            readBadge.textContent = '已读';
            titleWrap.appendChild(readBadge);
        }
        titleWrap.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'admin-alert-meta';
        const metaParts = [
            `创建于 ${this.formatDetailTime(alert.created_at)}`,
            this.getOpsAlertStatusLabel(alert)
        ];
        if (alert.updated_at && alert.updated_at !== alert.created_at) {
            metaParts.push(`更新于 ${this.formatDetailTime(alert.updated_at)}`);
        }
        meta.textContent = metaParts.join(' · ');

        header.appendChild(titleWrap);
        header.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'admin-alert-content';
        body.textContent = this.buildOpsAlertBodyText(alert);

        card.appendChild(header);
        card.appendChild(body);

        const caseSummary = this.buildOpsAlertCaseSummary(alert);
        if (caseSummary) {
            const summaryEl = document.createElement('div');
            summaryEl.className = 'admin-alert-case-summary';
            summaryEl.textContent = caseSummary;
            card.appendChild(summaryEl);
        }

        const recentEvents = this.getOpsAlertCaseRecentEvents(alert)
            .map((event) => this.getOpsAlertCaseRecentEventText(event))
            .filter(Boolean)
            .slice(0, 3);
        if (recentEvents.length) {
            const historyEl = document.createElement('div');
            historyEl.className = 'admin-alert-history';
            recentEvents.forEach((eventText) => {
                const itemEl = document.createElement('div');
                itemEl.className = 'admin-alert-history-item';
                itemEl.textContent = eventText;
                historyEl.appendChild(itemEl);
            });
            card.appendChild(historyEl);
        }

        if (alert.lastError) {
            const errorEl = document.createElement('div');
            errorEl.className = 'admin-alert-error';
            errorEl.textContent = `最近错误：${alert.lastError}`;
            card.appendChild(errorEl);
        }

        const footer = document.createElement('div');
        footer.className = 'admin-alert-footer';

        const entry = document.createElement('div');
        entry.className = 'admin-alert-entry';
        entry.textContent = alert.entryPath || '暂无处理入口';

        footer.appendChild(entry);

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'admin-alert-actions';

        this.getOpsAlertCaseActions(alert).forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `admin-alert-action-btn admin-alert-action-btn--${item.style || 'secondary'}`;
            button.textContent = this.isOpsAlertCaseActionBusy(alert.id, item.action) ? '处理中...' : item.label;
            button.disabled = this.isOpsAlertCaseActionBusy(alert.id, item.action);
            button.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.handleOpsAlertCaseAction(alert, item.action);
            });
            actionsWrap.appendChild(button);
        });

        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'admin-alert-action-btn admin-alert-action-btn--primary';
        actionButton.textContent = this.getOpsAlertActionLabel(alert);
        if (!alert.workspace || alert.workspace.kind === 'none') {
            actionButton.disabled = true;
        } else {
            actionButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.handleOpsAlertNavigation(alert);
            });
        }

        actionsWrap.appendChild(actionButton);
        footer.appendChild(actionsWrap);
        card.appendChild(footer);

        wrapper.appendChild(card);
        return wrapper;
    }

    appendMessage(msg, options = {}) {
        const area = document.getElementById('adminMessagesArea');
        if (!area) return;

        if (msg?.__kind === 'ops_alert' || msg?.message_type === 'ops_alert') {
            area.appendChild(this.createOpsAlertMessageElement(msg));
            if (options.scroll !== false) {
                this.scrollToBottom();
            }
            return;
        }

        const bubble = document.createElement('div');
        const isSentByAdmin = msg.is_admin;

        bubble.className = `admin-message ${isSentByAdmin ? 'sent' : 'received'}`;
        if (msg.id) {
            bubble.dataset.id = msg.id;
        }

        if (msg.message_type === 'image') {
            const img = this.createImageElement(msg.content, {
                alt: this.t('chat.image', '聊天图片')
            });

            if (img) {
                bubble.appendChild(img);
            } else {
                bubble.textContent = this.t('chat.imageUnavailable', '[图片地址无效]');
            }
        } else {
            bubble.textContent = msg.content;
        }

        area.appendChild(bubble);
        if (options.scroll !== false) {
            this.scrollToBottom();
        }
    }

    getIncomingChatMessagePreview(msg = {}) {
        if (msg?.message_type === 'image') {
            return this.t('chat.image', '[图片]');
        }
        return String(msg?.content || '');
    }

    applyIncomingUserMessage(msg = {}) {
        const normalizedSessionId = String(msg.session_id || '').trim();
        const normalizedUserId = String(msg.user_id || '').trim();
        const normalizedCreatedAt = String(msg.created_at || new Date().toISOString()).trim();
        const currentAdminUserId = String(this.currentAdminUserId || '').trim();
        if (!normalizedSessionId || !normalizedCreatedAt) {
            return false;
        }
        if (currentAdminUserId && normalizedUserId && normalizedUserId === currentAdminUserId) {
            return false;
        }

        const preview = this.getIncomingChatMessagePreview(msg);
        let matched = false;

        this.chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []).map((session) => {
            const sessionIds = Array.isArray(session?.sessionIds) && session.sessionIds.length
                ? session.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
                : [String(session?.sessionId || '').trim()].filter(Boolean);
            const normalizedSessionKey = String(session?.sessionId || '').trim();
            const normalizedSessionUserId = String(session?.userId || '').trim();
            const matches = (normalizedUserId && (normalizedSessionUserId === normalizedUserId || normalizedSessionKey === normalizedUserId))
                || normalizedSessionKey === normalizedSessionId
                || sessionIds.includes(normalizedSessionId);

            if (!matches) {
                return session;
            }

            matched = true;
            const nextSessionIds = sessionIds.includes(normalizedSessionId)
                ? sessionIds
                : [...sessionIds, normalizedSessionId];
            const fallbackKey = normalizedUserId || normalizedSessionKey || normalizedSessionId;
            const email = this.resolveSessionEmail(session?.profile || null, fallbackKey, nextSessionIds);
            const nickname = this.resolveSessionNickname(session?.profile || null, fallbackKey, email);

            return {
                ...session,
                sessionId: normalizedUserId || normalizedSessionKey || normalizedSessionId,
                sessionIds: nextSessionIds,
                userId: normalizedUserId || normalizedSessionUserId,
                nickname,
                email,
                lastMessage: preview,
                timestamp: new Date(normalizedCreatedAt),
                lastUserMessageAt: normalizedCreatedAt,
                replySummary: this.buildSessionReplySummary(normalizedCreatedAt, session?.lastAdminMessageAt || '')
            };
        });

        if (!matched) {
            const fallbackKey = normalizedUserId || normalizedSessionId;
            const email = this.resolveSessionEmail(null, fallbackKey, [normalizedSessionId]);
            const nickname = this.resolveSessionNickname(null, fallbackKey, email);
            this.chatSessions = [
                ...this.chatSessions,
                {
                    sessionId: fallbackKey,
                    sessionIds: [normalizedSessionId],
                    nickname,
                    email,
                    lastMessage: preview,
                    timestamp: new Date(normalizedCreatedAt),
                    userId: normalizedUserId,
                    unread: 0,
                    profile: null,
                    lastUserMessageAt: normalizedCreatedAt,
                    lastAdminMessageAt: '',
                    replySummary: this.buildSessionReplySummary(normalizedCreatedAt, '')
                }
            ];
        }

        this.composeSessions();
        this.syncCurrentSessionFromSessions();
        this.persistChatSessionCache();
        this.renderSessionList(this.searchQuery);
        return true;
    }

    scheduleRealtimeSessionHydration(message = {}) {
        const userId = String(message?.user_id || '').trim();
        const sessionId = String(message?.session_id || '').trim().toLowerCase();

        if (userId) {
            this.pendingRealtimeSessionUserIds.add(userId);
        } else if (sessionId.includes('@')) {
            this.pendingRealtimeSessionEmailKeys.add(sessionId);
        }

        if (this.sessionRealtimeHydrationHandle) {
            return;
        }

        this.sessionRealtimeHydrationHandle = window.setTimeout(() => {
            this.sessionRealtimeHydrationHandle = null;
            this.flushRealtimeSessionHydration().catch((error) => {
                console.warn('[AdminChat] Failed to hydrate realtime chat sessions:', error);
            });
        }, 180);
    }

    async flushRealtimeSessionHydration() {
        const userIds = [...this.pendingRealtimeSessionUserIds];
        const emailKeys = [...this.pendingRealtimeSessionEmailKeys];
        this.pendingRealtimeSessionUserIds.clear();
        this.pendingRealtimeSessionEmailKeys.clear();

        if ((!userIds.length && !emailKeys.length) || !Array.isArray(this.chatSessions) || !this.chatSessions.length) {
            return;
        }

        const targetSessions = this.chatSessions.filter((session) => {
            const sessionUserId = String(session?.userId || '').trim();
            if (sessionUserId && userIds.includes(sessionUserId)) {
                return true;
            }

            const sessionEmail = String(session?.email || '').trim().toLowerCase();
            if (sessionEmail && emailKeys.includes(sessionEmail)) {
                return true;
            }

            const sessionIds = Array.isArray(session?.sessionIds)
                ? session.sessionIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
                : [];
            return emailKeys.some((value) => sessionIds.includes(value));
        });

        if (!targetSessions.length) {
            return;
        }

        const hydratedSessions = await this.attachSessionProfiles(targetSessions);
        const hydratedSessionMap = new Map(hydratedSessions.map((session) => [String(session.sessionId || '').trim(), session]));
        this.chatSessions = this.chatSessions.map((session) => hydratedSessionMap.get(String(session?.sessionId || '').trim()) || session);

        if (userIds.length) {
            await this.refreshSessionOperationalSummariesForUserIds(userIds);
            return;
        }

        this.composeSessions();
        this.syncCurrentSessionFromSessions();
        this.persistChatSessionCache();
        this.renderSessionList(this.searchQuery);
    }

    async sendReply() {
        const input = document.getElementById('adminChatInput');
        const text = input?.value?.trim();
        if (!text || !this.currentSessionId || this.isOpsAlertSessionId(this.currentSessionId)) return;

        const fakeMsg = {
            id: `temp-${Date.now()}`,
            content: text,
            message_type: 'text',
            is_admin: true,
            created_at: new Date().toISOString()
        };

        this.appendMessage(fakeMsg);
        input.value = '';

        try {
            await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    content: text,
                    message_type: 'text',
                    is_admin: true
                });
            window.ZaoyoeAdminPresence?.markActive?.();
        } catch (err) {
            console.error('Failed to send:', err);
        }
    }

    readImageFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('图片读取失败'));
            reader.readAsDataURL(file);
        });
    }

    async uploadChatImageToR2(file) {
        const { data: { session } = {} } = await this.supabase.auth.getSession();
        if (!session?.access_token || !session?.user?.id) {
            throw new Error('请先登录后再上传图片');
        }

        const imageData = await this.readImageFileAsDataUrl(file);
        const response = await fetch(
            window.getZaoyoeSupabaseFunctionUrl('upload-avatar'),
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: session.user.id,
                    type: 'chat',
                    sessionId: this.currentSessionId,
                    imageData
                })
            }
        );

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (!response.ok || !payload?.imageUrl) {
            throw new Error(payload?.error || 'R2 图片上传失败');
        }

        return payload.imageUrl;
    }

    async handleImageUpload(event) {
        const file = event.target.files?.[0];
        if (!file || !this.currentSessionId || this.isOpsAlertSessionId(this.currentSessionId)) return;

        const tempId = `temp-img-${Date.now()}`;
        this.appendMessage({
            id: tempId,
            content: this.t('chat.uploading', '上传中...'),
            message_type: 'text',
            is_admin: true,
            created_at: new Date().toISOString()
        });

        try {
            const imageUrl = await this.uploadChatImageToR2(file);
            document.querySelector(`[data-id="${tempId}"]`)?.remove();

            await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    content: imageUrl,
                    message_type: 'image',
                    is_admin: true
                });
            window.ZaoyoeAdminPresence?.markActive?.();

            this.appendMessage({
                content: imageUrl,
                message_type: 'image',
                is_admin: true,
                created_at: new Date().toISOString()
            });
        } catch (err) {
            console.error('Failed to upload image:', err);
            alert(`${this.t('chat.uploadFailed', '图片上传失败')}: ${err.message}`);
        }

        event.target.value = '';
    }

    scrollToBottom() {
        const area = document.getElementById('adminMessagesArea');
        if (!area) return;
        area.scrollTop = area.scrollHeight;
    }

    subscribeToRealtime() {
        if (!this.supabase?.channel || this.chatChannel) {
            return;
        }

        this.chatChannel = this.createRealtimeSubscription(
            `admin-chat-global-${Date.now()}`,
            (channel) => channel.on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'chat_messages' },
                (payload) => {
                    const newMsg = payload.new;
                    const currentAdminUserId = String(this.currentAdminUserId || '').trim();
                    if (!newMsg?.is_admin && currentAdminUserId && String(newMsg.user_id || '').trim() === currentAdminUserId) {
                        return;
                    }
                    this.updateSessionOnNewMessage(newMsg);

                    const activeSessionIds = Array.isArray(this.currentSessionIds) && this.currentSessionIds.length
                        ? this.currentSessionIds
                        : (this.currentSessionId ? [this.currentSessionId] : []);
                    if (activeSessionIds.includes(newMsg.session_id) && (!newMsg.is_admin || this.isTicketSyncChatMessage(newMsg))) {
                        this.appendMessage(newMsg);
                    }
                }
            ),
            { feature: 'admin_chat_messages' }
        );

        this.opsAlertChannel = this.createRealtimeSubscription(
            `admin-ops-alerts-${Date.now()}`,
            (channel) => channel.on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'ops_alert_jobs' },
                (payload) => this.upsertOpsAlertMessage(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'ops_alert_jobs' },
                (payload) => this.upsertOpsAlertMessage(payload.new)
            ),
            { feature: 'admin_ops_alerts' }
        );

        this.ticketChannel = this.createRealtimeSubscription(
            `admin-ticket-context-${Date.now()}`,
            (channel) => channel.on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'shop_tickets' },
                (payload) => this.handleTicketRealtimeChange(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'shop_tickets' },
                (payload) => this.handleTicketRealtimeChange(payload.new)
            ),
            { feature: 'admin_ticket_context' }
        );

        this.paymentChannel = this.createRealtimeSubscription(
            `admin-payment-context-${Date.now()}`,
            (channel) => channel.on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'payment_orders' },
                (payload) => this.handlePaymentRealtimeChange(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'payment_orders' },
                (payload) => this.handlePaymentRealtimeChange(payload.new)
            ),
            { feature: 'admin_payment_context' }
        );

        this.verificationChannel = this.createRealtimeSubscription(
            `admin-verification-context-${Date.now()}`,
            (channel) => channel.on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'verification_logs' },
                (payload) => this.handleVerificationRealtimeChange(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'verification_logs' },
                (payload) => this.handleVerificationRealtimeChange(payload.new)
            ),
            { feature: 'admin_verification_context' }
        );
    }

    async upsertOpsAlertMessage(row) {
        const [normalized] = await this.attachOpsAlertCases([this.normalizeOpsAlertJob(row)]);
        const existingIndex = this.opsAlertMessages.findIndex((item) => item.id === normalized.id);
        const matchesFilter = this.matchesOpsAlertSiteFilter(normalized);

        if (!matchesFilter) {
            if (existingIndex > -1) {
                this.opsAlertMessages.splice(existingIndex, 1);
            }
        } else if (existingIndex > -1) {
            this.opsAlertMessages.splice(existingIndex, 1, normalized);
        } else {
            this.opsAlertMessages.push(normalized);
        }

        this.opsAlertMessages.sort((left, right) => {
            const leftTime = left.sortTimestamp instanceof Date ? left.sortTimestamp.getTime() : 0;
            const rightTime = right.sortTimestamp instanceof Date ? right.sortTimestamp.getTime() : 0;
            return rightTime - leftTime;
        });

        this.composeSessions();
        this.renderSessionList(this.searchQuery);

        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    async updateSessionOnNewMessage(msg) {
        if (msg?.is_admin && !this.isTicketSyncChatMessage(msg)) {
            const normalizedSessionId = String(msg.session_id || '').trim();
            const normalizedCreatedAt = String(msg.created_at || new Date().toISOString()).trim();
            if (normalizedSessionId) {
                this.chatSessions = (Array.isArray(this.chatSessions) ? this.chatSessions : []).map((session) => {
                    const sessionIds = Array.isArray(session?.sessionIds) && session.sessionIds.length
                        ? session.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
                        : [String(session?.sessionId || '').trim()].filter(Boolean);
                    if (!(session.sessionId === normalizedSessionId || sessionIds.includes(normalizedSessionId))) {
                        return session;
                    }

                    return {
                        ...session,
                        lastAdminMessageAt: normalizedCreatedAt,
                        replySummary: this.buildSessionReplySummary(session.lastUserMessageAt, normalizedCreatedAt)
                    };
                });

                this.composeSessions();
                this.persistChatSessionCache();
                this.renderSessionList(this.searchQuery);
            }
            return;
        }

        if (this.applyIncomingUserMessage(msg)) {
            this.scheduleRealtimeSessionHydration(msg);
            return;
        }

        await this.fetchSessions();
    }

    filterSessions(query) {
        this.searchQuery = String(query || '');
        this.renderSessionList(this.searchQuery);
    }

    async settleWorkspace(delayMs = 60) {
        await new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        });

        if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
    }

    scrollToElement(elementId) {
        const target = document.getElementById(String(elementId || '').trim());
        if (!target || typeof target.scrollIntoView !== 'function') {
            return;
        }

        window.setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 40);
    }

    getWorkbenchLauncher() {
        return window.openAdminWorkbenchEntry || window.openOpsAlertWorkspace || null;
    }

    async openWorkbenchEntry(workspaceKey, context = {}) {
        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher !== 'function') {
            return false;
        }
        return launcher(workspaceKey, context);
    }

    async openChatSessionFromAlert(context = {}) {
        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher === 'function') {
            return this.openWorkbenchEntry('chat-session', context);
        }

        const sessionId = String(
            context.sessionId
            || context.session_id
            || ((context.referenceLabel === '会话ID' || context.reference_label === '会话ID')
                ? (context.referenceValue || context.reference_value || '')
                : '')
            || ''
        ).trim();
        const searchValue = String(
            sessionId
            || context.email
            || context.userId
            || context.user_id
            || context.referenceValue
            || context.reference_value
            || ''
        ).trim();
        if (window.AdminShell?.openContext) {
            const opened = await window.AdminShell.openContext('chat', {
                source: 'ops-alerts',
                entity: 'chat-session',
                action: sessionId ? 'focus-session' : 'search-session',
                site: context.site,
                focus: {
                    sessionId,
                    session_id: sessionId,
                    userId: context.userId || context.user_id || '',
                    user_id: context.user_id || context.userId || ''
                },
                payload: {
                    search: searchValue,
                    searchQuery: searchValue,
                    email: context.email || '',
                    referenceLabel: context.referenceLabel || context.reference_label || '',
                    referenceValue: context.referenceValue || context.reference_value || '',
                    ticketId: context.ticketId || context.ticket_id || '',
                    ticketStatus: context.ticketStatus || context.ticket_status || ''
                }
            }, {
                settleMs: 0,
                silentDenied: true
            });

            if (opened) {
                return true;
            }
        }

        window.switchModule?.('chat');
        await this.settleWorkspace(80);

        const instance = window.adminChatInstance || this;
        if (sessionId) {
            await instance.loadSession(sessionId);
            return true;
        }

        instance.backToSessions();
        if (searchValue) {
            instance.filterSessions?.(searchValue);
            const searchInput = document.getElementById('sessionSearch');
            if (searchInput) {
                searchInput.value = searchValue;
            }
        }
        return true;
    }

    getContextSearchValue(context = {}) {
        return String(
            context.referenceValue
            || context.targetId
            || context.target_id
            || context.sessionId
            || context.session_id
            || ''
        ).trim();
    }

    getImplicitWorkbenchWorkspaceKey(action = {}) {
        const normalizedAction = String(action.action || action.key || '').trim().toLowerCase();
        if (normalizedAction === 'create_ticket') {
            return 'tickets-pending';
        }
        return '';
    }

    canAccessWorkbenchAction(action = {}) {
        const normalizedAction = String(action.action || action.key || '').trim().toLowerCase();
        if (normalizedAction === 'payment_read') {
            return true;
        }

        const workspaceKey = String(action.workspaceKey || this.getImplicitWorkbenchWorkspaceKey(action) || '').trim();
        if (!workspaceKey) {
            return false;
        }

        if (typeof window.canOpenAdminWorkbenchWorkspace === 'function') {
            return window.canOpenAdminWorkbenchWorkspace(workspaceKey, action.context || {});
        }

        if (workspaceKey === 'tickets-pending' && typeof window.hasModulePermission === 'function') {
            return window.hasModulePermission('tickets', action.context || {});
        }

        return true;
    }

    async openShopOrdersFromAlert(context = {}) {
        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher === 'function') {
            const searchValue = this.getContextSearchValue(context);
            return this.openWorkbenchEntry('shop-risk-orders', {
                ...context,
                orderId: context.orderId || context.order_id || searchValue,
                referenceLabel: context.referenceLabel || context.reference_label || '订单号',
                referenceValue: context.referenceValue || context.reference_value || searchValue,
                targetId: context.targetId || context.target_id || searchValue,
                target_id: context.target_id || context.targetId || searchValue
            });
        }

        const searchValue = this.getContextSearchValue(context);
        const referenceLabel = String(
            context.referenceLabel
            || context.reference_label
            || ''
        ).trim();
        const orderId = String(
            context.orderId
            || context.order_id
            || ((referenceLabel === '订单号' || referenceLabel === '订单')
                ? (context.referenceValue || context.reference_value || '')
                : '')
            || ''
        ).trim();

        if (window.AdminShell?.openContext) {
            const opened = await window.AdminShell.openContext('shop', {
                source: 'ops-alerts',
                entity: 'shop-order',
                action: orderId ? 'focus-order' : 'search-orders',
                site: context.site,
                focus: {
                    orderId,
                    order_id: orderId
                },
                payload: {
                    workspace: 'orders',
                    defaultTab: 'orders',
                    tab: 'orders',
                    query: searchValue,
                    search: searchValue,
                    searchQuery: searchValue,
                    referenceLabel,
                    referenceValue: context.referenceValue || context.reference_value || ''
                },
                userId: context.userId || context.user_id || '',
                user_id: context.user_id || context.userId || '',
                email: context.email || ''
            }, {
                settleMs: 0,
                silentDenied: true
            });

            if (opened) {
                this.scrollToElement('shop-view-orders');
                window.showToast?.('已打开商城订单列表', 'success');
                return true;
            }
        }

        const opened = window.switchModule?.('shop');
        if (opened === false) {
            return false;
        }
        await this.settleWorkspace(80);

        await window.ShopAdmin?.activate?.({
            ...context,
            workspace: 'orders',
            defaultTab: 'orders',
            tab: 'orders'
        }, {
            defaultTab: 'orders',
            tab: 'orders'
        });
        await this.settleWorkspace(80);

        const searchInput = document.getElementById('orderSearchInput');
        if (searchInput) {
            searchInput.value = searchValue || '';
        }

        await window.ShopAdmin?.searchOrders?.(1);
        this.scrollToElement('shop-view-orders');
        window.showToast?.('已打开商城订单列表', 'success');
        return true;
    }

    async openPaymentsOverviewFromAlert(context = {}) {
        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher === 'function') {
            return this.openWorkbenchEntry('payments-overview', context);
        }

        const paymentOrderId = String(
            context.paymentOrderId
            || context.payment_order_id
            || ((context.referenceLabel === '支付订单号' || context.reference_label === '支付订单号')
                ? (context.referenceValue || context.reference_value || '')
                : '')
            || ''
        ).trim();
        const referenceValue = String(
            context.referenceValue
            || context.reference_value
            || paymentOrderId
            || ''
        ).trim();

        if (window.AdminShell?.openContext) {
            const opened = await window.AdminShell.openContext('payments', {
                source: 'ops-alerts',
                entity: paymentOrderId ? 'payment-order' : 'payments-overview',
                action: paymentOrderId ? 'focus-order' : 'open-overview',
                site: context.site,
                focus: {
                    paymentOrderId,
                    payment_order_id: paymentOrderId
                },
                payload: {
                    defaultTab: 'overview',
                    tab: 'overview',
                    focusTargetId: 'paymentsOrdersTable',
                    focus_target_id: 'paymentsOrdersTable',
                    search: referenceValue,
                    searchQuery: referenceValue,
                    referenceLabel: context.referenceLabel || context.reference_label || '',
                    referenceValue
                }
            }, {
                settleMs: 0,
                silentDenied: true
            });

            if (opened) {
                this.scrollToElement('paymentsOrdersTable');
                window.showToast?.('已打开支付最近订单', 'success');
                return true;
            }
        }

        const opened = window.switchModule?.('payments');
        if (opened === false) {
            return false;
        }
        await this.settleWorkspace(80);

        await window.AdminPayments?.activate?.({
            ...context,
            defaultTab: 'overview',
            tab: 'overview'
        }, {
            defaultTab: 'overview',
            tab: 'overview'
        });
        await this.settleWorkspace(80);

        this.scrollToElement('paymentsOrdersTable');
        window.showToast?.('已打开支付最近订单', 'success');
        return true;
    }

    async handleOpsAlertNavigation(alert = {}) {
        const workspace = alert.workspace || { kind: 'none' };
        const launcher = this.getWorkbenchLauncher();

        try {
            if (workspace.kind === 'chat-session') {
                return await this.openChatSessionFromAlert(workspace.context || {});
            }

            if (workspace.kind === 'shop-orders') {
                return await this.openShopOrdersFromAlert(workspace.context || {});
            }

            if (workspace.kind === 'ops-workspace' && workspace.workspaceKey === 'payments-overview') {
                return await this.openPaymentsOverviewFromAlert(workspace.context || {});
            }

            if (workspace.kind === 'ops-workspace' && typeof launcher === 'function') {
                return await this.openWorkbenchEntry(workspace.workspaceKey, workspace.context || {});
            }

            window.showToast?.('这条告警暂时没有可跳转的处理页', 'warning');
            return false;
        } catch (error) {
            console.error('[AdminChat] Failed to open alert workspace:', error);
            window.showToast?.(`打开处理页失败: ${error.message || '未知错误'}`, 'error');
            return false;
        }
    }
}

window.AdminChat = AdminChat;

function normalizeAdminChatShellContextObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isAdminChatModuleVisible() {
    const module = document.getElementById('module-chat');
    return Boolean(module && module.classList.contains('active') && !module.hidden);
}

function getActiveAdminChatInstance() {
    const instance = window.adminChatInstance;
    if (!instance || instance.destroyed === true) {
        return null;
    }
    return instance;
}

function getAdminChatCommandCenterSummary() {
    const instance = getActiveAdminChatInstance();
    if (!instance || typeof instance.getCommandCenterSummary !== 'function') {
        return {
            ready: false,
            status: 'idle',
            unreadMessages: 0,
            pendingReply: 0,
            staleReply: 0,
            openTickets: 0,
            verificationAlerts: 0,
            paymentFollowups: 0,
            systemAlerts: 0,
            unreadSystemAlerts: 0,
            actionableCount: 0
        };
    }
    return instance.getCommandCenterSummary();
}

async function primeAdminChatCommandCenterSummary(options = {}) {
    const instance = ensureAdminChatInstance();
    if (!instance) {
        return getAdminChatCommandCenterSummary();
    }

    if (options?.force === true && typeof instance.fetchSessions === 'function') {
        await instance.fetchSessions();
        return instance.getCommandCenterSummary();
    }

    if (!instance.hasBootstrappedSessions && typeof instance.bootstrapSessions === 'function') {
        await instance.bootstrapSessions();
    }

    if (!instance.hasHydratedSessionSidebarData && typeof instance.hydrateSessionSidebarData === 'function') {
        await instance.hydrateSessionSidebarData();
    }

    return instance.getCommandCenterSummary();
}

function ensureAdminChatInstance(options = {}) {
    const existingInstance = getActiveAdminChatInstance();
    const container = document.getElementById('chat-admin-container');

    if (existingInstance) {
        if (container && existingInstance.targetContainer !== container) {
            existingInstance.targetContainer = container;
        }

        if (options?.ensureLayout === true && container && !container.querySelector('#chatMainContainer')) {
            existingInstance.init();
        }

        return existingInstance;
    }

    if (typeof window.AdminChat !== 'function' || !container) {
        return null;
    }

    return new window.AdminChat(container);
}

function resolveAdminChatContextSessionId(context = {}) {
    const normalizedContext = normalizeAdminChatShellContextObject(context);
    const focus = normalizeAdminChatShellContextObject(normalizedContext.focus);
    const payload = normalizeAdminChatShellContextObject(normalizedContext.payload);
    const raw = normalizeAdminChatShellContextObject(normalizedContext.raw);

    return String(
        focus.sessionId
        || focus.session_id
        || focus.chatSessionId
        || focus.chat_session_id
        || payload.sessionId
        || payload.session_id
        || payload.chatSessionId
        || payload.chat_session_id
        || raw.sessionId
        || raw.session_id
        || raw.chatSessionId
        || raw.chat_session_id
        || normalizedContext.sessionId
        || normalizedContext.session_id
        || normalizedContext.chatSessionId
        || normalizedContext.chat_session_id
        || ''
    ).trim();
}

function resolveAdminChatContextSearchValue(context = {}) {
    const normalizedContext = normalizeAdminChatShellContextObject(context);
    const focus = normalizeAdminChatShellContextObject(normalizedContext.focus);
    const payload = normalizeAdminChatShellContextObject(normalizedContext.payload);
    const raw = normalizeAdminChatShellContextObject(normalizedContext.raw);

    return String(
        payload.search
        || payload.searchQuery
        || payload.query
        || payload.email
        || payload.userId
        || payload.user_id
        || raw.search
        || raw.searchQuery
        || raw.query
        || raw.email
        || raw.userId
        || raw.user_id
        || focus.userId
        || focus.user_id
        || normalizedContext.search
        || normalizedContext.searchQuery
        || normalizedContext.query
        || normalizedContext.email
        || normalizedContext.userId
        || normalizedContext.user_id
        || normalizedContext.referenceValue
        || normalizedContext.reference_value
        || ''
    ).trim();
}

function resolveAdminChatContextQueueState(context = {}) {
    const normalizedContext = normalizeAdminChatShellContextObject(context);
    const payload = normalizeAdminChatShellContextObject(normalizedContext.payload);
    const raw = normalizeAdminChatShellContextObject(normalizedContext.raw);

    return {
        view: String(
            payload.queueView
            || payload.view
            || raw.queueView
            || raw.view
            || normalizedContext.queueView
            || normalizedContext.view
            || ''
        ).trim(),
        filter: String(
            payload.queueFilter
            || payload.filter
            || raw.queueFilter
            || raw.filter
            || normalizedContext.queueFilter
            || normalizedContext.filter
            || ''
        ).trim()
    };
}

async function activateChatModule(context = {}, options = {}) {
    const chatInstance = ensureAdminChatInstance({ ensureLayout: true });
    if (!chatInstance) {
        return false;
    }

    if ((!Array.isArray(chatInstance.sessions) || chatInstance.sessions.length === 0) && typeof chatInstance.bootstrapSessions === 'function') {
        await chatInstance.bootstrapSessions();
    }

    if (options?.force === true && typeof chatInstance.fetchSessions === 'function') {
        await chatInstance.fetchSessions();
    }

    return true;
}

async function handleChatModuleContext(context = {}, options = {}) {
    const chatInstance = ensureAdminChatInstance({ ensureLayout: true });
    if (!chatInstance) {
        return false;
    }

    const normalizedContext = normalizeAdminChatShellContextObject(context);
    const payload = normalizeAdminChatShellContextObject(normalizedContext.payload);
    const raw = normalizeAdminChatShellContextObject(normalizedContext.raw);
    const sessionId = resolveAdminChatContextSessionId(normalizedContext);
    const searchValue = resolveAdminChatContextSearchValue(normalizedContext);
    const queueState = resolveAdminChatContextQueueState(normalizedContext);
    const shouldOpenOpsAlerts = ['ops-alerts', 'ops_alerts', 'alerts'].includes(String(
        payload.workspace
        || payload.mode
        || raw.workspace
        || raw.mode
        || normalizedContext.workspace
        || normalizedContext.mode
        || ''
    ).trim().toLowerCase());

    if (typeof chatInstance.bootstrapSessions === 'function') {
        await chatInstance.bootstrapSessions();
    }

    if (shouldOpenOpsAlerts) {
        await chatInstance.loadSession(chatInstance.opsAlertSessionId);
        return true;
    }

    if (sessionId) {
        await chatInstance.loadSession(sessionId);
        return true;
    }

    chatInstance.backToSessions?.();

    if (queueState.view && typeof chatInstance.setSessionQueueView === 'function') {
        chatInstance.setSessionQueueView(queueState.view, {
            resetFilter: !queueState.filter
        });
    }

    if (queueState.filter && typeof chatInstance.setSessionQueueFilter === 'function') {
        chatInstance.setSessionQueueFilter(queueState.filter);
    }

    if (searchValue) {
        chatInstance.filterSessions?.(searchValue);
        const searchInput = document.getElementById('sessionSearch');
        if (searchInput) {
            searchInput.value = searchValue;
        }
        return true;
    }

    return true;
}

async function handleChatModuleSiteChange() {
    const chatInstance = getActiveAdminChatInstance();
    if (!chatInstance || !isAdminChatModuleVisible()) {
        return false;
    }

    const currentSessionKey = String(chatInstance.currentSessionKey || chatInstance.currentSessionId || '').trim();
    const currentSearchValue = String(chatInstance.searchQuery || '').trim();

    chatInstance.backToSessions?.();
    chatInstance.restoreOpsAlertReadReceipts?.();
    await chatInstance.fetchSessions?.();

    if (currentSearchValue) {
        chatInstance.filterSessions?.(currentSearchValue);
        const searchInput = document.getElementById('sessionSearch');
        if (searchInput) {
            searchInput.value = currentSearchValue;
        }
    }

    if (!currentSessionKey || typeof chatInstance.loadSession !== 'function') {
        return true;
    }

    const hasMatchedSession = (Array.isArray(chatInstance.sessions) ? chatInstance.sessions : []).some((session) => {
        const normalizedSessionId = String(session?.sessionId || '').trim();
        const sessionIds = Array.isArray(session?.sessionIds)
            ? session.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
        return normalizedSessionId === currentSessionKey || sessionIds.includes(currentSessionKey);
    });

    if (hasMatchedSession) {
        await chatInstance.loadSession(currentSessionKey);
    }

    return true;
}

function activateVisibleChatModuleOnAccess() {
    if (!isAdminChatModuleVisible()) {
        return;
    }

    void activateChatModule();
}

window.ensureAdminChatInstance = ensureAdminChatInstance;
window.getAdminChatCommandCenterSummary = getAdminChatCommandCenterSummary;
window.primeAdminChatCommandCenterSummary = primeAdminChatCommandCenterSummary;
window.handleAdminChatModuleSiteChange = handleChatModuleSiteChange;

if (window.AdminShell?.registerModule) {
    window.AdminShell.registerModule('chat', {
        activate: activateChatModule,
        handleContext: handleChatModuleContext,
        onSiteChange: handleChatModuleSiteChange
    });
}

document.addEventListener?.('DOMContentLoaded', () => {
    if (window.adminStudioAccessGranted) {
        activateVisibleChatModuleOnAccess();
        return;
    }

    window.addEventListener?.('adminStudioAccessGranted', activateVisibleChatModuleOnAccess, { once: true });
});
