function isMissingNotificationScopeColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    return error?.code === '42703'
        || error?.code === '42P01'
        || (message.includes('column') && message.includes('does not exist'))
        || (message.includes('schema cache') && (
            message.includes('scope')
            || message.includes('category')
            || message.includes('action_url')
            || message.includes('action_label')
            || message.includes('metadata')
            || message.includes('priority')
            || message.includes('expires_at')
            || message.includes('site')
            || message.includes('dedupe_key')
            || message.includes('source_module')
            || message.includes('source_event_id')
        ));
}

async function insertScopedSystemNotification(client, payload = {}) {
    const response = await client
        .from('system_notifications')
        .insert(payload);

    if (!response?.error || !isMissingNotificationScopeColumnError(response.error)) {
        return response;
    }

    const legacyPayload = { ...payload };
    delete legacyPayload.scope;
    delete legacyPayload.category;
    delete legacyPayload.action_url;
    delete legacyPayload.action_label;
    delete legacyPayload.metadata;
    delete legacyPayload.priority;
    delete legacyPayload.expires_at;
    delete legacyPayload.site;
    delete legacyPayload.dedupe_key;
    delete legacyPayload.source_module;
    delete legacyPayload.source_event_id;

    return client
        .from('system_notifications')
        .insert(legacyPayload);
}

class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.isVerifyPage = /(^|\/)verify(?:\.html)?\/?$/i.test(window.location.pathname || '');
        this.sessionId = this.getSessionId();
        this.userSessionIds = [this.sessionId];
        this.currentUser = null;
        this.supabase = window.supabaseClient; // Assuming global supabase client
        this.unreadCount = 0; // Track unread messages
        this.lastMessageTime = null; // Track last seen message
        this.unreadSessions = new Set(); // Track sessions with unread messages (admin mode)
        this.sessionMessagesCache = new Map(); // Cache admin conversation payloads for faster switching
        this.sessionAvatarImageCache = new Map(); // Keep decoded avatar images stable across list refreshes
        this.userContextCache = new Map();
        this.userContextRecentActions = new Map();
        this.currentUserContext = null;
        this.userContextPanelCollapsed = true;
        this.replyTemplateBarCollapsed = true;
        this.opsAlertToolbarCollapsed = true;
        this.currentSessionInfo = null;
        this.userHistoryCache = new Map();
        this.replyTemplateConfigTemplates = null;
        this.replyTemplateConfigLoadedAt = 0;
        this.replyTemplateConfigPromise = null;
        this._replyTemplateRenderToken = 0;
        this.handleOpsAlertConfigUpdated = this.handleOpsAlertConfigUpdated.bind(this);
        this._adminFloatingPanelOffsetFrame = null;
        this._adminResponsiveNarrow = false;
        this._adminLayoutResizeObserver = null;
        this._adminFloatingPanelResizeHandler = () => {
            this.syncAdminResponsiveLayout();
            this.scheduleAdminFloatingPanelOffsetSync();
        };
        this._userContextRequestId = 0;
        this._adminSessionLoadRequestId = 0;
        this._sessionLoadRequestId = 0;
        this._sessionLoadingOverlayTimer = null;
        this._userHistoryLoadFailsafeTimer = null;
        this._adminSessionPrewarmHandle = null;
        this._adminSessionHydrationTimer = null;
        this._adminSessionHydrationRequestId = 0;
        this._adminSessionListBootstrapping = false;
        this._pendingAdminSessionHydrationUserIds = new Set();
        this._pendingAdminSessionHydrationEmails = new Set();
        this.currentAdminUserId = '';
        this._authenticatedUserSessionHydrationHandle = null;
        this._authenticatedUserSessionHydrationRequestId = 0;
        this._userHistoryLoadRequestId = 0;
        this._userHistorySyncHandle = null;
        this.opsAlertSessionId = '__admin_ops_todo__';
        this.opsAlertMessages = [];
        this.opsAlertLoadError = '';
        this.adminMessageChannel = null;
        this.adminOpsAlertChannel = null;
        this.adminTicketChannel = null;
        this.adminPaymentChannel = null;
        this.adminVerificationChannel = null;
        this.adminPresenceChannel = null;
        this.adminPresenceOnline = false;
        this.adminPresenceLastSeenAt = '';
        this.adminPresenceStatusTimer = null;
        this.adminPresenceLastSeenStorageKey = 'zaoyoe_admin_presence_last_seen_v1';
        this.userPresenceChannel = null;
        this.userPresenceStatusTimer = null;
        this.userPresenceByKey = new Map();
        this.userActivityChannel = null;
        this.userActivityRefreshTimer = null;
        this.userActivityByKey = new Map();
        this.userActivityFetchDisabled = false;
        this.engagementNotificationChannel = null;
        this.engagementNotificationChannelUserId = '';
        this.engagementNotificationRefreshTimer = null;
        this.engagementDeliveryChannel = null;
        this.engagementDeliveryChannelUserId = '';
        this.engagementUserTagsChannel = null;
        this.engagementUserTagsChannelUserId = '';
        this.engagementUserTagsRefreshTimer = null;
        this.engagementFeedBroadcastChannel = null;
        this.engagementFeedBroadcastRefreshTimer = null;
        this.engagementFeedInvalidationsChannel = null;
        this.engagementFeedInvalidationsRefreshTimer = null;
        this.engagementScheduledRuleRefreshTimer = null;
        this.engagementAuthSubscription = null;
        this.adminOpsAlertPollTimer = null;
        this.adminSessionSlaTimer = null;
        this.adminSessionQueueView = 'all';
        this.adminSessionQueueFilter = 'all';
        this.adminSessionQueueDefaultView = 'all';
        this.adminSessionQueueDefaultFilter = 'all';
        this.adminSidebarInsightsCollapsed = true;
        this.adminSessionSearchQuery = '';
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
        this.restoreAdminSessionQueuePreferences();
        this.restoreOpsAlertReadReceipts();
        this.restorePendingPaymentReadReceipts();

        // Preload configuration - lock scroll until messages are loaded
        this.isPreloading = false;

        // Smart time display - only show time if 5+ minutes gap
        this.lastDisplayedTime = null;
        this.timeDisplayThreshold = 5 * 60 * 1000; // 5 minutes in ms

        // Define common emojis
        this.emojis = ['😀', '😂', '😍', '🤔', '😭', '😡', '👍', '👎', '🎉', '🔥', '❤️', '👀', '🚀', '💯', '👋', '✨', '🤖', '👻'];
        this._stableDockHeight = null;
        this._keyboardDocked = false;
        this._lastKeyboardInset = 0;
        this._viewportRafId = null;
        this._viewportThrottleTimer = null;
        this._lastViewportSyncAt = 0;
        this._keyboardSettleTimer = null;
        this._pendingStableKeyboardInset = 0;
        this._lastStableKeyboardInset = 0;
        this._transitionCleanupTimer = null;
        this._openingAnimationTimer = null;
        this._openingAnimationFrame = null;
        this._openingAnimationRunId = 0;
        this._closingAnimationTimer = null;
        this._bootstrapContentSettleTimer = null;
        this._bootstrapContentSettleFrame = null;
        this._ignoreEmojiClicksUntil = 0;
        this._userHistoryComposerHandoffHeld = false;
        this._userComposerUnlockTimer = null;
        this._userComposerSkeletonRemoveTimer = null;
        this._userComposerInteractionUnlockTimer = null;
        this._pendingFirstDockTimer = null;
        this._pendingFirstDockParams = null;
        this._keyboardDockAnimatingUntil = 0;
        this._keyboardBlurUndocking = false;
        this._keyboardPreLiftActive = false;
        this._motionVisualLockTimer = null;
        this._sessionVisualLocked = false;
        this._estimatedRefreshHz = 60;
        this._isHighRefreshDisplay = false;
        this._statusBarShield = null;
        this._themeColorMeta = null;
        this._themeColorRestoreContent = '';
        this._closeChromeCleanupStarted = false;
        this._fabHovering = false;
        this._fabAmbientPeekTimer = null;
        this._fabAmbientReturnTimer = null;
        this._fabAmbientResumeTimer = null;
        this._onFabAmbientViewportChange = null;
        this.engagementViewedKeys = new Set();
        this.engagementTriggeredKeys = new Set();
        this.engagementFeedLoaded = false;
        this.engagementFeedLoading = false;
        this.engagementActiveItem = null;
        this.engagementPendingItems = [];
        this.engagementPendingFlushTimer = null;
        this.engagementDisplayQuietUntil = 0;
        this.engagementAuthBurstUntil = 0;
        this.engagementAuthBurstCollectUntil = 0;
        this.engagementAuthBurstDisplayedCount = 0;
        this.engagementEventPriorityCenter = null;
        this.engagementSessionQuietUntil = new Map();
        this.engagementSemanticFamilyMap = {
            new_user_welcome: 'new_user_welcome',
            inactive_user_return: 'inactive_return',
            message_replied: 'reply_followup',
            comment_replied: 'reply_followup',
            coupon_available: 'shop_discount_ready',
            product_discount_available: 'shop_discount_ready',
            order_paid: 'order_lifecycle',
            order_status: 'order_lifecycle',
            order_delivered: 'order_lifecycle',
            refund_status: 'order_lifecycle'
        };
        this.engagementRefreshTimer = null;
        this.engagementFollowupRefreshTimers = new Set();
        this.engagementConditionEvaluationTimer = null;
        this.engagementConditionEvaluationInFlight = false;
        this.engagementTimeTriggerTimer = null;
        this.engagementScrollTriggerBound = false;
        this.engagementClickTriggerBound = false;
        this.engagementRuntimeInitialized = false;
        this.engagementSurfaceEscapeHandler = null;
        this.supportConfig = window.ZaoyoeSupportBotConfig || null;
        this.engagementSupportEntry = null;
        this.engagementSupportConfig = null;
        this.supportContextKey = this.getSupportContextKey();
        this.supportDisplayMode = 'chat';
        this.supportView = { type: 'root', id: '' };
        this.supportPendingActionId = '';
        this.supportLastMenuId = '';
        this.supportInlineState = { actionId: '', value: '', result: '', error: '', loading: false };
        this.supportTicketHistoryState = { context: {}, payload: null, error: '', loading: false };
        this._supportPanelPrewarmHandle = null;
        this._supportRootPrewarmed = false;
        this._lastRenderedUserHistoryMessages = [];
        this._pendingOpenAfterInit = false;
        this._chatWidgetReady = false;
        window.addEventListener('ops-alerts-config-updated', this.handleOpsAlertConfigUpdated);

        this._detectRefreshRate();
        this.ready = this.init()
            .then(() => {
                this._chatWidgetReady = true;
                if (this._pendingOpenAfterInit) {
                    try {
                        return this.openChat().catch((error) => {
                            console.error('[ChatWidget] Failed to replay queued open:', error);
                        }).then(() => this);
                    } catch (error) {
                        console.error('[ChatWidget] Failed to replay queued open:', error);
                    }
                }
                return this;
            })
            .catch((error) => {
                this._pendingOpenAfterInit = false;
                console.error('[ChatWidget] Failed to initialize:', error);
                throw error;
            });
    }

    // i18n helper with fallback
    t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const value = window.i18n.t(key);
            if (value === null || value === undefined) {
                return fallback || key;
            }
            if (typeof value === 'string') {
                const normalized = value.trim().toLowerCase();
                if (!normalized || normalized === 'null' || normalized === 'undefined') {
                    return fallback || key;
                }
            }
            return value;
        }
        return fallback || key;
    }

    formatCompactCount(value) {
        const count = Number(value || 0);
        if (!Number.isFinite(count) || count <= 0) return '0';
        return count > 99 ? '99+' : String(Math.round(count));
    }

    getAdminSessionQueuePreferenceStorageKey() {
        return 'zaoyoe_admin_support_queue_preferences_v1';
    }

    getPendingPaymentReadReceiptStorageKey() {
        const site = typeof window !== 'undefined' && window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
        return `zaoyoe_admin_chat_pending_payment_read_receipts_v1:${site}`;
    }

    getOpsAlertReadReceiptStorageKey() {
        return 'zaoyoe_admin_ops_alert_read_receipts_v1:all';
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
            console.warn('[ChatWidget] Failed to restore ops alert read receipts:', error);
        }
    }

    persistOpsAlertReadReceipts() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const receipts = Object.fromEntries(Array.from(this.opsAlertReadReceipts.entries()).slice(-1000));
            window.localStorage.setItem(this.getOpsAlertReadReceiptStorageKey(), JSON.stringify({
                updatedAt: new Date().toISOString(),
                receipts
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to persist ops alert read receipts:', error);
        }
    }

    restorePendingPaymentReadReceipts() {
        this.pendingPaymentReadReceipts = new Map();
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            [
                this.getPendingPaymentReadReceiptStorageKey(),
                'zaoyoe_admin_chat_pending_payment_read_receipts_v1:all'
            ].forEach((storageKey) => {
                const rawValue = window.localStorage.getItem(storageKey);
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
            });
        } catch (error) {
            console.warn('[ChatWidget] Failed to restore pending payment read receipts:', error);
        }
    }

    persistPendingPaymentReadReceipts() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const receipts = Object.fromEntries(Array.from(this.pendingPaymentReadReceipts.entries()).slice(-1000));
            window.localStorage.setItem(this.getPendingPaymentReadReceiptStorageKey(), JSON.stringify({
                updatedAt: new Date().toISOString(),
                receipts
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to persist pending payment read receipts:', error);
        }
    }

    normalizeAdminSessionQueueView(value = 'all') {
        const normalized = String(value || 'all').trim() || 'all';
        const allowed = new Set(['all', 'priority', 'ticket_followup', 'payment_verify']);
        return allowed.has(normalized) ? normalized : 'all';
    }

    normalizeAdminSessionQueueFilter(value = 'all') {
        const normalized = String(value || 'all').trim() || 'all';
        const allowed = new Set(['all', 'reply', 'stale_reply', 'ticket', 'verification']);
        return allowed.has(normalized) ? normalized : 'all';
    }

    getAdminSessionQueueViewLabel(value = 'all') {
        const labels = {
            all: '全部视图',
            priority: '高优先',
            ticket_followup: '售后值守',
            payment_verify: '支付/验证'
        };
        return labels[this.normalizeAdminSessionQueueView(value)] || '全部视图';
    }

    getAdminSessionQueueFilterLabel(value = 'all') {
        const labels = {
            all: '全部',
            reply: '待回复',
            stale_reply: '久未回复',
            ticket: '工单中',
            verification: '验证异常'
        };
        return labels[this.normalizeAdminSessionQueueFilter(value)] || '全部';
    }

    formatAdminSessionQueueModeLabel(view = 'all', filter = 'all') {
        const normalizedView = this.normalizeAdminSessionQueueView(view);
        const normalizedFilter = this.normalizeAdminSessionQueueFilter(filter);
        const viewLabel = this.getAdminSessionQueueViewLabel(normalizedView);
        if (normalizedFilter === 'all') {
            return viewLabel;
        }
        return `${viewLabel} / ${this.getAdminSessionQueueFilterLabel(normalizedFilter)}`;
    }

    restoreAdminSessionQueuePreferences() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const rawValue = window.localStorage.getItem(this.getAdminSessionQueuePreferenceStorageKey());
            if (!rawValue) return;
            const parsed = JSON.parse(rawValue);
            const lastView = this.normalizeAdminSessionQueueView(parsed?.lastView ?? parsed?.view);
            const lastFilter = this.normalizeAdminSessionQueueFilter(parsed?.lastFilter ?? parsed?.filter);
            this.adminSessionQueueView = lastView;
            this.adminSessionQueueFilter = lastFilter;
            this.adminSessionQueueDefaultView = this.normalizeAdminSessionQueueView(parsed?.defaultView ?? lastView);
            this.adminSessionQueueDefaultFilter = this.normalizeAdminSessionQueueFilter(parsed?.defaultFilter ?? lastFilter);
        } catch (error) {
            console.warn('[ChatWidget] Failed to restore admin session queue preferences:', error);
        }
    }

    persistAdminSessionQueuePreferences({ saveAsDefault = false } = {}) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const lastView = this.normalizeAdminSessionQueueView(this.adminSessionQueueView);
            const lastFilter = this.normalizeAdminSessionQueueFilter(this.adminSessionQueueFilter);
            const defaultView = saveAsDefault
                ? lastView
                : this.normalizeAdminSessionQueueView(this.adminSessionQueueDefaultView || lastView);
            const defaultFilter = saveAsDefault
                ? lastFilter
                : this.normalizeAdminSessionQueueFilter(this.adminSessionQueueDefaultFilter || lastFilter);
            this.adminSessionQueueDefaultView = defaultView;
            this.adminSessionQueueDefaultFilter = defaultFilter;
            window.localStorage.setItem(this.getAdminSessionQueuePreferenceStorageKey(), JSON.stringify({
                lastView,
                lastFilter,
                defaultView,
                defaultFilter,
                updatedAt: new Date().toISOString()
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to persist admin session queue preferences:', error);
        }
    }

    getAdminSessionSnapshotStorageKey() {
        const site = window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
        return `zaoyoe_admin_support_sessions_snapshot_v1_${site}`;
    }

    getBootstrapShellModeStorageKey() {
        return 'zaoyoe_chat_widget_last_shell_mode_v1';
    }

    getAdminAccessCacheStorageKey() {
        return 'zaoyoe_admin_access_cache_v1';
    }

    getAdminAccessCacheMaxAgeMs() {
        return 5 * 60 * 1000;
    }

    readRecentAdminAccessCache(userId = '') {
        if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
            return null;
        }

        try {
            const rawValue = window.sessionStorage.getItem(this.getAdminAccessCacheStorageKey());
            if (!rawValue) return null;

            const parsed = JSON.parse(rawValue);
            const cachedAt = Number(parsed?.cachedAt || 0);
            if (!Number.isFinite(cachedAt) || (Date.now() - cachedAt) > this.getAdminAccessCacheMaxAgeMs()) {
                return null;
            }

            const cachedUserId = String(parsed?.userId || '').trim();
            const expectedUserId = String(userId || '').trim();
            if (expectedUserId && cachedUserId && cachedUserId !== expectedUserId) {
                return null;
            }

            return {
                userId: cachedUserId,
                isAdmin: Boolean(parsed?.access?.isAdmin),
                isSuperAdmin: Boolean(parsed?.access?.isSuperAdmin),
                permissions: Array.isArray(parsed?.access?.permissions) ? parsed.access.permissions : [],
                cachedAt
            };
        } catch (error) {
            console.warn('[ChatWidget] Failed to read admin access cache:', error);
            return null;
        }
    }

    persistBootstrapShellMode(mode = 'user') {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        const normalizedMode = mode === 'admin' ? 'admin' : 'user';
        try {
            window.localStorage.setItem(this.getBootstrapShellModeStorageKey(), JSON.stringify({
                mode: normalizedMode,
                savedAt: Date.now()
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to persist bootstrap shell mode:', error);
        }
    }

    getAdminSessionSnapshotMaxAgeMs() {
        return 10 * 60 * 1000;
    }

    getAuthenticatedUserSessionIdsStorageKey(user = null) {
        const site = window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
        const userId = String(user?.id || '').trim();
        return userId ? `zaoyoe_chat_session_ids_v1_${site}_${userId}` : '';
    }

    getAuthenticatedUserSessionIdsMaxAgeMs() {
        return 24 * 60 * 60 * 1000;
    }

    restoreAuthenticatedUserSessionIds(user = null) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return [];
        }

        const storageKey = this.getAuthenticatedUserSessionIdsStorageKey(user);
        if (!storageKey) {
            return [];
        }

        try {
            const rawValue = window.localStorage.getItem(storageKey);
            if (!rawValue) return [];

            const parsed = JSON.parse(rawValue);
            const savedAt = Number(parsed?.savedAt || 0);
            if (!Number.isFinite(savedAt) || (Date.now() - savedAt) > this.getAuthenticatedUserSessionIdsMaxAgeMs()) {
                return [];
            }

            return [...new Set(
                (Array.isArray(parsed?.sessionIds) ? parsed.sessionIds : [])
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            )];
        } catch (error) {
            console.warn('[ChatWidget] Failed to restore authenticated session ids:', error);
            return [];
        }
    }

    persistAuthenticatedUserSessionIds(user = null, sessionIds = []) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        const storageKey = this.getAuthenticatedUserSessionIdsStorageKey(user);
        if (!storageKey) {
            return;
        }

        try {
            window.localStorage.setItem(storageKey, JSON.stringify({
                savedAt: Date.now(),
                sessionIds: [...new Set(
                    (Array.isArray(sessionIds) ? sessionIds : [])
                        .map((value) => String(value || '').trim())
                        .filter(Boolean)
                )]
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to persist authenticated session ids:', error);
        }
    }

    clearAuthenticatedUserSessionHydrationHandle() {
        if (!this._authenticatedUserSessionHydrationHandle) return;

        if (typeof this._authenticatedUserSessionHydrationHandle === 'object' && this._authenticatedUserSessionHydrationHandle.type === 'idle') {
            window.cancelIdleCallback?.(this._authenticatedUserSessionHydrationHandle.handle);
        } else {
            clearTimeout(this._authenticatedUserSessionHydrationHandle);
        }
        this._authenticatedUserSessionHydrationHandle = null;
    }

    scheduleAuthenticatedUserSessionHydration(user = null, { immediate = false } = {}) {
        const normalizedUserId = String(user?.id || '').trim();
        if (!normalizedUserId) {
            return;
        }

        this.clearAuthenticatedUserSessionHydrationHandle();

        const run = () => {
            this._authenticatedUserSessionHydrationHandle = null;
            this.hydrateAuthenticatedUserSessionIds(user).catch((error) => {
                console.warn('[ChatWidget] Failed to hydrate authenticated session ids:', error);
            });
        };

        if (immediate) {
            this._authenticatedUserSessionHydrationHandle = setTimeout(run, 0);
            return;
        }

        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            const handle = window.requestIdleCallback(run, { timeout: 700 });
            this._authenticatedUserSessionHydrationHandle = { type: 'idle', handle };
            return;
        }

        this._authenticatedUserSessionHydrationHandle = setTimeout(run, 180);
    }

    async hydrateAuthenticatedUserSessionIds(user = null) {
        const activeUser = user || this.currentUser || null;
        const normalizedUserId = String(activeUser?.id || '').trim();
        if (!normalizedUserId) {
            return this.getActiveUserSessionIds();
        }

        const requestId = ++this._authenticatedUserSessionHydrationRequestId;
        const previousSessionIds = this.getActiveUserSessionIds();
        const primarySessionId = this.getAuthenticatedSessionId(activeUser);
        const baselineSessionIds = [
            primarySessionId,
            ...this.getLegacyAuthenticatedSessionIds(activeUser),
            ...previousSessionIds
        ].filter(Boolean);

        const { data, error } = await this.queryForCurrentSite(
            this.supabase
                .from('chat_messages')
                .select('session_id, created_at')
                .eq('user_id', normalizedUserId),
            this.getCurrentSite()
        )
            .order('created_at', { ascending: false })
            .limit(1000);

        if (error) {
            throw error;
        }

        if (requestId !== this._authenticatedUserSessionHydrationRequestId) {
            return this.getActiveUserSessionIds();
        }

        const linkedSessionIds = (Array.isArray(data) ? data : [])
            .map((entry) => String(entry?.session_id || '').trim())
            .filter(Boolean);
        const nextSessionIds = [...new Set([...baselineSessionIds, ...linkedSessionIds])];
        const addedSessionIds = nextSessionIds.filter((value) => !previousSessionIds.includes(value));

        this.userSessionIds = nextSessionIds;
        this.persistAuthenticatedUserSessionIds(activeUser, nextSessionIds);

        if (
            addedSessionIds.length
            && !this.isAdmin
            && this.isOpen
            && String(this.currentUser?.id || '').trim() === normalizedUserId
        ) {
            this.loadHistory().catch((historyError) => {
                console.warn('[ChatWidget] Failed to refresh hydrated user history:', historyError);
            });
        }

        return nextSessionIds;
    }

    normalizeAdminSessionSnapshotSession(session = {}) {
        const normalizedId = String(session?.id || '').trim();
        if (!normalizedId) return null;

        const sessionIds = [...new Set(
            (Array.isArray(session?.sessionIds) ? session.sessionIds : [normalizedId])
                .map((value) => String(value || '').trim())
                .filter(Boolean)
        )];

        return {
            id: normalizedId,
            sessionIds,
            nickname: String(session?.nickname || '').trim() || this.t('chat.guest', '访客'),
            email: String(session?.email || '').trim(),
            lastLogin: String(session?.lastLogin || '').trim(),
            lastMessage: String(session?.lastMessage || '').trim(),
            lastTime: String(session?.lastTime || '').trim(),
            isAdmin: Boolean(session?.isAdmin),
            userId: String(session?.userId || '').trim(),
            avatarUrl: String(session?.avatarUrl || '').trim(),
            lastUserMessageAt: String(session?.lastUserMessageAt || '').trim(),
            lastAdminMessageAt: String(session?.lastAdminMessageAt || '').trim(),
            replySummary: session?.replySummary && typeof session.replySummary === 'object'
                ? { ...session.replySummary }
                : null,
            ticketSummary: session?.ticketSummary && typeof session.ticketSummary === 'object'
                ? { ...session.ticketSummary }
                : null,
            paymentSummary: session?.paymentSummary && typeof session.paymentSummary === 'object'
                ? { ...session.paymentSummary }
                : null,
            verificationSummary: session?.verificationSummary && typeof session.verificationSummary === 'object'
                ? { ...session.verificationSummary }
                : null,
            searchText: String(session?.searchText || '').trim(),
            subtext: String(session?.subtext || '').trim(),
            badge: String(session?.badge || '').trim()
        };
    }

    restoreAdminSessionSnapshot() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return [];
        }

        try {
            const rawValue = window.localStorage.getItem(this.getAdminSessionSnapshotStorageKey());
            if (!rawValue) return [];

            const parsed = JSON.parse(rawValue);
            const savedAt = Number(parsed?.savedAt || 0);
            if (!Number.isFinite(savedAt) || (Date.now() - savedAt) > this.getAdminSessionSnapshotMaxAgeMs()) {
                return [];
            }

            return this.sortAdminSessions(
                (Array.isArray(parsed?.sessions) ? parsed.sessions : [])
                    .map((session) => this.normalizeAdminSessionSnapshotSession(session))
                    .filter(Boolean)
            );
        } catch (error) {
            console.warn('[ChatWidget] Failed to restore admin session snapshot:', error);
            return [];
        }
    }

    persistAdminSessionSnapshot(chatSessions = []) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const normalizedSessions = (Array.isArray(chatSessions) ? chatSessions : [])
                .map((session) => this.normalizeAdminSessionSnapshotSession(session))
                .filter(Boolean);

            window.localStorage.setItem(this.getAdminSessionSnapshotStorageKey(), JSON.stringify({
                savedAt: Date.now(),
                sessions: normalizedSessions
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to persist admin session snapshot:', error);
        }
    }

    clearAdminSessionPrewarmHandle() {
        if (!this._adminSessionPrewarmHandle) return;

        if (typeof this._adminSessionPrewarmHandle === 'object' && this._adminSessionPrewarmHandle.type === 'idle') {
            window.cancelIdleCallback?.(this._adminSessionPrewarmHandle.handle);
        } else {
            clearTimeout(this._adminSessionPrewarmHandle);
        }
        this._adminSessionPrewarmHandle = null;
    }

    scheduleAdminSessionPrewarm({ immediate = false } = {}) {
        this.clearAdminSessionPrewarmHandle();

        const run = () => {
            this._adminSessionPrewarmHandle = null;
            this.loadAdminSessions();
        };

        if (immediate) {
            this._adminSessionPrewarmHandle = setTimeout(run, 0);
            return;
        }

        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            const handle = window.requestIdleCallback(run, { timeout: 450 });
            this._adminSessionPrewarmHandle = { type: 'idle', handle };
            return;
        }

        this._adminSessionPrewarmHandle = setTimeout(run, 120);
    }

    getUserHistorySnapshotStorageKey(sessionIds = []) {
        const site = window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
        const cacheKey = encodeURIComponent(this.getSessionCacheKey(sessionIds) || 'default');
        return `zaoyoe_chat_history_snapshot_v1_${site}_${cacheKey}`;
    }

    restoreUserHistorySnapshot(sessionIds = []) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return [];
        }

        try {
            const rawValue = window.localStorage.getItem(this.getUserHistorySnapshotStorageKey(sessionIds));
            if (!rawValue) return [];

            const parsed = JSON.parse(rawValue);
            const savedAt = Number(parsed?.savedAt || 0);
            if (!Number.isFinite(savedAt) || (Date.now() - savedAt) > this.getAdminSessionSnapshotMaxAgeMs()) {
                return [];
            }

            return Array.isArray(parsed?.messages) ? parsed.messages : [];
        } catch (error) {
            console.warn('[ChatWidget] Failed to restore user history snapshot:', error);
            return [];
        }
    }

    persistUserHistorySnapshot(sessionIds = [], messages = []) {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            window.localStorage.setItem(this.getUserHistorySnapshotStorageKey(sessionIds), JSON.stringify({
                savedAt: Date.now(),
                messages: Array.isArray(messages) ? messages : []
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to persist user history snapshot:', error);
        }
    }

    clearUserHistorySyncHandle() {
        if (!this._userHistorySyncHandle) return;

        if (typeof this._userHistorySyncHandle === 'object' && this._userHistorySyncHandle.type === 'idle') {
            window.cancelIdleCallback?.(this._userHistorySyncHandle.handle);
        } else {
            clearTimeout(this._userHistorySyncHandle);
        }
        this._userHistorySyncHandle = null;
    }

    isAdminSessionQueueUsingDefaultView() {
        return this.normalizeAdminSessionQueueView(this.adminSessionQueueView) === this.normalizeAdminSessionQueueView(this.adminSessionQueueDefaultView)
            && this.normalizeAdminSessionQueueFilter(this.adminSessionQueueFilter) === this.normalizeAdminSessionQueueFilter(this.adminSessionQueueDefaultFilter);
    }

    restoreAdminSessionQueueDefaultView() {
        this.adminSessionQueueView = this.normalizeAdminSessionQueueView(this.adminSessionQueueDefaultView);
        this.adminSessionQueueFilter = this.normalizeAdminSessionQueueFilter(this.adminSessionQueueDefaultFilter);
        this.persistAdminSessionQueuePreferences();
        this.renderAdminSessionQueueControls();
        this.renderAdminSessionList();
    }

    saveCurrentAdminSessionQueueAsDefault() {
        this.persistAdminSessionQueuePreferences({ saveAsDefault: true });
        this.renderAdminSessionQueueControls();
        this.renderAdminSessionList();
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

    isTicketSyncChatMessage(message = {}) {
        const messageType = String(message?.message_type || '').trim().toLowerCase();
        if (messageType === 'ticket_update') {
            return true;
        }
        return String(message?.content || '').includes('[工单处理结果同步]');
    }

    getCurrentLanguage() {
        return window.i18n?.getCurrentLanguage?.() || 'zh';
    }

    resolveSupportText(value, fallback = '') {
        if (value === null || value === undefined) return fallback;
        if (typeof value === 'string') return value;
        if (typeof value === 'object') {
            const lang = this.getCurrentLanguage();
            return value[lang] || value.zh || value.en || fallback;
        }
        return fallback;
    }

    cloneSupportBotConfig(config = {}) {
        try {
            return JSON.parse(JSON.stringify(config || {}));
        } catch (_) {
            return { ...(config || {}) };
        }
    }

    normalizeSupportActionIds(value, fallback = []) {
        const validActions = new Set([
            'code_status',
            'redeem_code',
            'afdian_lookup',
            'shop_order_status',
            'shop_order_content',
            'discount_help',
            'verify_task_status',
            'verify_failure_help',
            'verify_precheck',
            'ticket_history',
            'create_ticket',
            'tg_support',
            'live_chat'
        ]);
        const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
        const normalized = [...new Set(source
            .map((item) => String(item || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
            .filter((item) => validActions.has(item)))];
        return normalized.length ? normalized : fallback.filter((item) => validActions.has(item));
    }

    normalizeEngagementSupportEntry(entry = {}) {
        const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
        const contexts = Array.isArray(source.contexts) ? source.contexts : [];
        return {
            enabled: source.enabled !== false,
            entry_label: String(source.entry_label || source.entryLabel || '常用入口').trim() || '常用入口',
            entry_label_en: String(source.entry_label_en || source.entryLabelEn || 'Quick Help').trim() || 'Quick Help',
            root_menus: Array.isArray(source.root_menus) && source.root_menus.length
                ? source.root_menus.map((item) => String(item || '').trim()).filter(Boolean)
                : ['exchange', 'shop', 'verify', 'human'],
            telegram_url: String(source.telegram_url || source.telegramUrl || 'https://t.me/zaoyoe').trim() || 'https://t.me/zaoyoe',
            ticket_enabled: source.ticket_enabled !== false && source.ticketEnabled !== false,
            live_chat_enabled: source.live_chat_enabled !== false && source.liveChatEnabled !== false,
            ticket_sla_hours: Number(source.ticket_sla_hours || source.ticketSlaHours || 24) || 24,
            ticket_prompt: String(source.ticket_prompt || source.ticketPrompt || '把“关联 ID + 问题描述”发我，我会帮你生成一条客服工单。').trim(),
            ticket_placeholder: String(source.ticket_placeholder || source.ticketPlaceholder || '输入关联 ID 和问题描述').trim(),
            ticket_input_hint: String(source.ticket_input_hint || source.ticketInputHint || '示例：order:订单号 卡密未到账、task:任务号 一直失败、code:兑换码 显示已使用').trim(),
            contexts: contexts.map((context) => {
                const id = String(context?.id || context?.context_id || context?.contextId || 'default')
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, '') || 'default';
                const fallbackShortcuts = id === 'shop'
                    ? ['shop_order_status', 'shop_order_content', 'discount_help', 'create_ticket', 'live_chat']
                    : id === 'verify'
                        ? ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket', 'live_chat']
                        : ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat'];
                return {
                    id,
                    label: String(context?.label || context?.title || '常用入口').trim() || '常用入口',
                    intro: String(context?.intro || context?.description || '').trim(),
                    shortcuts: this.normalizeSupportActionIds(context?.shortcuts || context?.action_ids || context?.actionIds, fallbackShortcuts).slice(0, 8),
                    enabled: context?.enabled !== false
                };
            }).filter((context) => context.enabled)
        };
    }

    buildEngagementSupportBotConfig(entry = {}) {
        const normalized = this.normalizeEngagementSupportEntry(entry);
        if (normalized.enabled === false) return null;

        const base = this.cloneSupportBotConfig(window.ZaoyoeSupportBotConfig || this.supportConfig || {});
        const config = {
            ...base,
            version: `${base.version || 'support'}+engagement-entry`,
            rootMenus: normalized.root_menus,
            contexts: {
                ...(base.contexts || {})
            },
            menus: {
                ...(base.menus || {})
            },
            actions: {
                ...(base.actions || {})
            }
        };

        normalized.contexts.forEach((context) => {
            config.contexts[context.id] = {
                title: {
                    zh: context.label,
                    en: context.id === 'default' ? normalized.entry_label_en : context.label
                },
                intro: {
                    zh: context.intro || '优先帮你找到正确入口，能自助解决的先自助处理，需要人工时再提交工单。',
                    en: context.intro || 'Start with the right self-serve entry, then submit a ticket if human support is needed.'
                },
                shortcuts: context.shortcuts
            };
        });

        if (config.actions.create_ticket) {
            config.actions.create_ticket = {
                ...config.actions.create_ticket,
                label: {
                    zh: '提交问题工单',
                    en: 'Submit Ticket'
                },
                prompt: {
                    zh: normalized.ticket_prompt,
                    en: config.actions.create_ticket.prompt?.en || 'Send the reference ID plus a problem description and I will create a support ticket.'
                },
                placeholder: {
                    zh: normalized.ticket_placeholder,
                    en: config.actions.create_ticket.placeholder?.en || 'Enter the reference ID and issue description'
                },
                inputHint: {
                    zh: normalized.ticket_input_hint,
                    en: config.actions.create_ticket.inputHint?.en || 'Example: order:ORDER_ID content not delivered'
                }
            };
        }

        if (config.actions.tg_support) {
            config.actions.tg_support = {
                ...config.actions.tg_support,
                url: normalized.telegram_url
            };
        }

        const disabledActions = new Set();
        if (!normalized.ticket_enabled) {
            disabledActions.add('create_ticket');
            disabledActions.add('ticket_history');
        }
        if (!normalized.live_chat_enabled) disabledActions.add('live_chat');
        Object.keys(config.menus || {}).forEach((menuId) => {
            const menu = config.menus[menuId];
            if (Array.isArray(menu?.items)) {
                menu.items = menu.items.filter((actionId) => !disabledActions.has(actionId));
            }
        });
        Object.keys(config.contexts || {}).forEach((contextId) => {
            const context = config.contexts[contextId];
            if (Array.isArray(context?.shortcuts)) {
                context.shortcuts = context.shortcuts.filter((actionId) => !disabledActions.has(actionId));
            }
        });

        return config;
    }

    applyEngagementSupportEntry(entry = {}) {
        const normalized = this.normalizeEngagementSupportEntry(entry);
        this.engagementSupportEntry = normalized;
        this.engagementSupportConfig = this.buildEngagementSupportBotConfig(normalized);
        this.supportContextKey = this.getSupportContextKey();
        this._supportRootPrewarmed = false;
        this.syncSupportShellState?.();
        if (!this.isAdmin && this.supportDisplayMode === 'support') {
            this.renderSupportRootPanel?.({ activate: true });
        }
    }

    getSupportConfig() {
        if (this.engagementSupportEntry?.enabled === false) return null;
        return this.engagementSupportConfig || window.ZaoyoeSupportBotConfig || this.supportConfig || null;
    }

    getSupportContextKey() {
        const pageId = typeof this.getEngagementPageId === 'function' ? this.getEngagementPageId() : '';
        const config = this.engagementSupportConfig || window.ZaoyoeSupportBotConfig || this.supportConfig || null;
        if (pageId && config?.contexts?.[pageId]) return pageId;
        const path = String(window.location.pathname || '').toLowerCase();
        if (/(^|\/)shop(?:\.html)?\/?$/.test(path)) return 'shop';
        if (/(^|\/)verify(?:\.html)?\/?$/.test(path)) return 'verify';
        return 'default';
    }

    getSupportContextConfig() {
        const config = this.getSupportConfig();
        if (!config) return null;
        return config.contexts?.[this.supportContextKey] || config.contexts?.default || null;
    }

    getSupportMenu(menuId) {
        return this.getSupportConfig()?.menus?.[menuId] || null;
    }

    getSupportAction(actionId) {
        return this.getSupportConfig()?.actions?.[actionId] || null;
    }

    getSupportEntryLabel() {
        if (this.engagementSupportEntry) {
            const label = this.getCurrentLanguage() === 'zh'
                ? this.engagementSupportEntry.entry_label
                : this.engagementSupportEntry.entry_label_en;
            if (label) return label;
        }
        return this.getCurrentLanguage() === 'zh' ? '常用入口' : 'Quick Help';
    }

    getSupportInlineState(actionId = '') {
        if (!actionId) {
            this.supportInlineState = { actionId: '', value: '', result: '', error: '', loading: false };
            return this.supportInlineState;
        }

        if (!this.supportInlineState || this.supportInlineState.actionId !== actionId) {
            this.supportInlineState = { actionId, value: '', result: '', error: '', loading: false };
        }

        return this.supportInlineState;
    }

    setSupportInlineState(actionId = '', nextState = {}) {
        const normalizedActionId = String(actionId || '').trim();
        const baseState = normalizedActionId
            ? this.getSupportInlineState(normalizedActionId)
            : { actionId: '', value: '', result: '', error: '', loading: false };

        this.supportInlineState = {
            ...baseState,
            ...nextState,
            actionId: normalizedActionId
        };

        return this.supportInlineState;
    }

    normalizeSupportTicketHistoryContext(context = {}) {
        const source = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
        return {
            ticketId: String(source.ticketId || source.ticket_id || '').trim(),
            orderId: String(source.orderId || source.order_id || '').trim(),
            ticketStatus: String(source.ticketStatus || source.ticket_status || '').trim().toLowerCase(),
            ticketStatusLabel: String(source.ticketStatusLabel || source.ticket_status_label || '').trim()
        };
    }

    getSupportTicketHistoryState() {
        if (!this.supportTicketHistoryState || typeof this.supportTicketHistoryState !== 'object') {
            this.supportTicketHistoryState = { context: {}, payload: null, error: '', loading: false };
        }
        return this.supportTicketHistoryState;
    }

    setSupportTicketHistoryState(nextState = {}) {
        const baseState = this.getSupportTicketHistoryState();
        const nextContext = nextState.context !== undefined
            ? this.normalizeSupportTicketHistoryContext(nextState.context)
            : baseState.context;

        this.supportTicketHistoryState = {
            ...baseState,
            ...nextState,
            context: nextContext
        };

        return this.supportTicketHistoryState;
    }

    clearSupportPanelPrewarmHandle() {
        if (!this._supportPanelPrewarmHandle) return;
        if (typeof this._supportPanelPrewarmHandle === 'object' && this._supportPanelPrewarmHandle.type === 'idle') {
            window.cancelIdleCallback?.(this._supportPanelPrewarmHandle.handle);
        } else {
            clearTimeout(this._supportPanelPrewarmHandle);
        }
        this._supportPanelPrewarmHandle = null;
    }

    scheduleSupportPanelPrewarm({ immediate = false } = {}) {
        this.clearSupportPanelPrewarmHandle();
        if (this.isAdmin || !this.supportPanel) return;
        if (!this.getSupportConfig() || !this.getSupportContextConfig()) return;
        if (this._supportRootPrewarmed || this.supportDisplayMode === 'support') return;

        const run = () => {
            this._supportPanelPrewarmHandle = null;
            if (this.isAdmin || !this.supportPanel) return;
            if (this._supportRootPrewarmed || this.supportDisplayMode === 'support') return;
            this.renderSupportRootPanel({ activate: false });
        };

        if (immediate) {
            this._supportPanelPrewarmHandle = setTimeout(run, 0);
            return;
        }

        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            const handle = window.requestIdleCallback(run, { timeout: 500 });
            this._supportPanelPrewarmHandle = { type: 'idle', handle };
            return;
        }

        this._supportPanelPrewarmHandle = setTimeout(run, 180);
    }

    setSupportDisplayMode(mode = 'support') {
        this.supportDisplayMode = mode === 'chat' ? 'chat' : 'support';
        this.supportPendingActionId = '';
        this.syncSupportShellState();
    }

    syncSupportShellState() {
        const hasSupport = Boolean(this.getSupportConfig() && this.getSupportContextConfig() && this.supportPanel);
        const mode = hasSupport ? this.supportDisplayMode : 'chat';
        const showChat = !hasSupport || mode === 'chat';
        const showSupport = hasSupport && mode === 'support';
        const showHeaderActions = hasSupport && mode === 'chat';

        if (this.chatWindow) {
            this.chatWindow.classList.toggle('chat-window--support-mode', showSupport);
            this.chatWindow.classList.toggle('chat-window--chat-mode', showChat);
        }

        if (this.messagesContainer) {
            this.messagesContainer.hidden = !showChat;
            this.messagesContainer.style.display = showChat ? 'flex' : 'none';
        }

        if (this.inputArea) {
            this.inputArea.hidden = !showChat;
            this.inputArea.style.display = showChat ? 'flex' : 'none';
        }

        if (this.supportPanel) {
            this.supportPanel.hidden = !showSupport;
            this.supportPanel.style.display = showSupport ? 'flex' : 'none';
        }

        if (this.headerActions) {
            this.headerActions.hidden = !showHeaderActions;
            this.headerActions.style.display = showHeaderActions ? 'flex' : 'none';
            if (this.headerSupportToggle) {
                this.headerSupportToggle.textContent = this.getSupportEntryLabel();
            }
        }

        if (mode === 'chat') {
            this.updateSupportInputState('');
        }
    }

    buildSupportMenuButtons(actionIds = []) {
        return actionIds
            .map((actionId) => {
                const action = this.getSupportAction(actionId);
                if (!action) return '';
                return `
                    <button type="button" class="chat-support-btn" data-support-action-id="${this.escapeHtml(actionId)}">
                        ${this.escapeHtml(this.resolveSupportText(action.label, actionId))}
                    </button>
                `;
            })
            .join('');
    }

    buildSupportChecklist(items = []) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '';
        return `
            <ul class="chat-support-list">
                ${list.map((item) => `<li>${this.escapeHtml(String(item || ''))}</li>`).join('')}
            </ul>
        `;
    }

    updateSupportInputState(actionId = '') {
        this.supportPendingActionId = '';
        if (!this.input) return;
        this.input.placeholder = this.t('chat.inputMessagePlaceholder', '输入消息...');
    }

    getSupportRefTypeLabel(refType) {
        const normalized = String(refType || '').trim().toLowerCase();
        const labels = {
            order_id: this.getCurrentLanguage() === 'zh' ? '商城订单号' : 'Shop Order ID',
            task_id: this.getCurrentLanguage() === 'zh' ? '验证任务号' : 'Verify Task ID',
            redeem_code: this.getCurrentLanguage() === 'zh' ? '兑换码' : 'Redeem Code',
            afdian_order_no: this.getCurrentLanguage() === 'zh' ? '爱发电订单号' : 'Afdian Order ID',
            email: this.getCurrentLanguage() === 'zh' ? '邮箱' : 'Email'
        };
        return labels[normalized] || (this.getCurrentLanguage() === 'zh' ? '问题标识' : 'Reference');
    }

    getSupportActionLabel(actionId) {
        const action = this.getSupportAction(actionId);
        return action ? this.resolveSupportText(action.label, actionId) : actionId;
    }

    getSupportCategoryLabel(category) {
        const normalized = String(category || '').trim().toLowerCase();
        const labels = {
            redeem_code_available: this.getCurrentLanguage() === 'zh' ? '兑换码可用' : 'Code Available',
            redeem_code_used: this.getCurrentLanguage() === 'zh' ? '兑换码已使用' : 'Code Used',
            redeem_code_unavailable: this.getCurrentLanguage() === 'zh' ? '兑换码不可用' : 'Code Unavailable',
            redeem_code_invalid: this.getCurrentLanguage() === 'zh' ? '兑换码无效' : 'Code Invalid',
            shop_delivered: this.getCurrentLanguage() === 'zh' ? '订单已发放' : 'Delivered',
            shop_delivery_in_progress: this.getCurrentLanguage() === 'zh' ? '订单处理中' : 'In Progress',
            shop_delivery_retrying: this.getCurrentLanguage() === 'zh' ? '订单自动重试中' : 'Retrying',
            shop_delivery_dead_letter: this.getCurrentLanguage() === 'zh' ? '订单需人工处理' : 'Manual Review',
            verify_success: this.getCurrentLanguage() === 'zh' ? '任务已完成' : 'Task Completed',
            verify_in_progress: this.getCurrentLanguage() === 'zh' ? '任务处理中' : 'Task In Progress',
            verify_region_unsupported: this.getCurrentLanguage() === 'zh' ? '地区限制' : 'Region Restricted',
            verify_sso_unsupported: this.getCurrentLanguage() === 'zh' ? '邮箱类型限制' : 'Email Restricted',
            verify_upstream_temporary: this.getCurrentLanguage() === 'zh' ? '上游临时异常' : 'Upstream Issue',
            verify_conflict_existing_state: this.getCurrentLanguage() === 'zh' ? '账号状态冲突' : 'Account Conflict',
            verify_failed_unknown: this.getCurrentLanguage() === 'zh' ? '未知失败' : 'Unknown Failure',
            afdian_lookup_required: this.getCurrentLanguage() === 'zh' ? '爱发电订单查询' : 'Afdian Lookup',
            verify_email_precheck: this.getCurrentLanguage() === 'zh' ? '邮箱前置检查' : 'Email Precheck'
        };
        return labels[normalized] || '';
    }

    getSuggestedActionLabels(actionIds = []) {
        return (Array.isArray(actionIds) ? actionIds : [])
            .map((actionId) => this.getSupportActionLabel(actionId))
            .filter(Boolean);
    }

    getAutoSupportAssistActionLabel(actionId, detected, explanation = null, options = {}) {
        const normalizedActionId = String(actionId || '').trim();
        const category = String(explanation?.category || '').trim().toLowerCase();
        const status = String(explanation?.status || '').trim().toLowerCase();
        const refType = String(detected?.ref_type || '').trim().toLowerCase();
        const isPrimary = options?.primary === true;
        const zh = this.getCurrentLanguage() === 'zh';

        switch (normalizedActionId) {
            case 'code_status':
                return zh ? '查看兑换码状态' : 'View Code Status';
            case 'redeem_code':
                return zh ? '立即兑换' : 'Redeem Now';
            case 'afdian_lookup':
                return zh ? '查爱发电订单' : 'Check Afdian Order';
            case 'shop_order_status':
                if (category === 'shop_delivery_in_progress' || category === 'shop_delivery_retrying') {
                    return zh ? '继续查订单状态' : 'Check Order Status Again';
                }
                if (category === 'shop_delivery_dead_letter') {
                    return zh ? '查看订单异常' : 'View Order Issue';
                }
                return zh ? '查看订单状态' : 'View Order Status';
            case 'shop_order_content':
                return zh ? '查看已发放内容' : 'View Delivered Content';
            case 'verify_task_status':
                if (status === 'success') {
                    return zh ? '查看任务详情' : 'View Task Details';
                }
                if (category === 'verify_in_progress') {
                    return zh ? '继续查任务进度' : 'Check Task Progress';
                }
                return zh ? '查看任务状态' : 'View Task Status';
            case 'verify_failure_help':
                return zh ? '查看失败原因' : 'View Failure Reason';
            case 'verify_precheck':
                return zh ? '做提交前检查' : 'Run Precheck';
            case 'create_ticket':
                if (refType === 'redeem_code') return zh ? '提交兑换码工单' : 'Submit Code Ticket';
                if (refType === 'task_id') return zh ? '提交任务工单' : 'Submit Task Ticket';
                if (refType === 'order_id') return zh ? '提交订单工单' : 'Submit Order Ticket';
                return zh ? '提交问题工单' : 'Submit Ticket';
            case 'tg_support':
                return zh ? '转 TG 人工客服' : 'Open Telegram Support';
            case 'live_chat':
                return zh ? '切到在线客服' : 'Open Live Chat';
            default:
                return isPrimary ? this.getSupportActionLabel(normalizedActionId) : this.getSupportActionLabel(normalizedActionId);
        }
    }

    getAutoSupportRootActionLabel() {
        return this.getCurrentLanguage() === 'zh' ? '更多自助入口' : 'More Help';
    }

    getAutoSupportPrimaryActionId(detected, explanation = null) {
        const candidateIds = [];
        const pushActionId = (actionId) => {
            const normalizedActionId = String(actionId || '').trim();
            if (!normalizedActionId || candidateIds.includes(normalizedActionId)) return;
            if (!this.getSupportAction(normalizedActionId)) return;
            candidateIds.push(normalizedActionId);
        };

        (Array.isArray(explanation?.suggested_actions) ? explanation.suggested_actions : []).forEach(pushActionId);
        pushActionId(explanation?.next_action);
        pushActionId(detected?.next_action);

        const refType = String(detected?.ref_type || '').trim().toLowerCase();
        if (!candidateIds.length) {
            if (refType === 'order_id') pushActionId('shop_order_status');
            if (refType === 'task_id') pushActionId('verify_task_status');
            if (refType === 'redeem_code') pushActionId('code_status');
            if (refType === 'afdian_order_no') pushActionId('afdian_lookup');
            if (refType === 'email') pushActionId('verify_precheck');
        }

        return candidateIds[0] || '';
    }

    buildAutoSupportPrefillValue(actionId, detected, explanation = null) {
        const normalizedActionId = String(actionId || '').trim();
        const refValue = String(detected?.normalized_value || '').trim();
        if (!normalizedActionId || !refValue) return '';

        if (normalizedActionId === 'create_ticket') {
            const refKeyMap = {
                order_id: 'order',
                task_id: 'task',
                redeem_code: 'code',
                afdian_order_no: 'afdian',
                email: 'email'
            };
            const refKey = refKeyMap[String(detected?.ref_type || '').trim().toLowerCase()] || 'ref';
            const lines = [`${refKey}:${refValue}`];
            if (String(explanation?.title || '').trim()) {
                lines.push(`${this.getCurrentLanguage() === 'zh' ? '自动判断' : 'Auto Check'}：${String(explanation.title).trim()}`);
            }
            if (String(explanation?.message || '').trim()) {
                lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${String(explanation.message).trim()}`);
            }
            return lines.join('\n');
        }

        if ([
            'code_status',
            'redeem_code',
            'afdian_lookup',
            'shop_order_status',
            'shop_order_content',
            'verify_task_status',
            'verify_failure_help'
        ].includes(normalizedActionId)) {
            return refValue;
        }

        return '';
    }

    formatAutoSupportPanelResult(detected, explanation = null, fallbackError = '') {
        if (!explanation && !fallbackError) return '';

        const lines = [];
        const title = String(explanation?.title || '').trim();
        const message = String(explanation?.message || '').trim();
        const category = this.getSupportCategoryLabel(explanation?.category);

        if (title) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '自动判断' : 'Automatic Check'}：${title}`);
        }

        if (message) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${message}`);
        } else if (fallbackError) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${fallbackError}`);
        }

        if (category) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '问题分类' : 'Category'}：${category}`);
        }

        if (explanation && typeof explanation.retryable === 'boolean') {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '是否建议重试' : 'Retry Recommended'}：${explanation.retryable
                ? (this.getCurrentLanguage() === 'zh' ? '可以稍后重试' : 'You can retry later')
                : (this.getCurrentLanguage() === 'zh' ? '不建议直接重试' : 'Retry is not recommended')}`);
        }

        return lines.filter(Boolean).join('\n');
    }

    getAutoSupportScenarioActionIds(detected, explanation = null, openedActionId = '') {
        const category = String(explanation?.category || '').trim().toLowerCase();
        const status = String(explanation?.status || '').trim().toLowerCase();
        const refType = String(detected?.ref_type || '').trim().toLowerCase();
        const actionIds = [];
        const pushActionId = (actionId) => {
            const normalizedActionId = String(actionId || '').trim();
            if (!normalizedActionId || actionIds.includes(normalizedActionId)) return;
            if (!this.getSupportAction(normalizedActionId)) return;
            actionIds.push(normalizedActionId);
        };

        switch (category) {
            case 'redeem_code_available':
                pushActionId('redeem_code');
                pushActionId('code_status');
                break;
            case 'redeem_code_used':
            case 'redeem_code_unavailable':
            case 'redeem_code_invalid':
                pushActionId('create_ticket');
                pushActionId('code_status');
                break;
            case 'shop_delivered':
                pushActionId('shop_order_content');
                pushActionId('shop_order_status');
                break;
            case 'shop_delivery_in_progress':
            case 'shop_delivery_retrying':
                pushActionId('shop_order_status');
                pushActionId('create_ticket');
                break;
            case 'shop_delivery_dead_letter':
                pushActionId('create_ticket');
                pushActionId('shop_order_status');
                break;
            case 'verify_success':
                pushActionId('verify_task_status');
                break;
            case 'verify_in_progress':
                pushActionId('verify_task_status');
                pushActionId('verify_failure_help');
                break;
            case 'verify_upstream_temporary':
                pushActionId('verify_task_status');
                pushActionId('create_ticket');
                break;
            case 'verify_region_unsupported':
            case 'verify_sso_unsupported':
            case 'verify_conflict_existing_state':
                pushActionId('verify_failure_help');
                pushActionId('create_ticket');
                break;
            case 'verify_failed_unknown':
            case 'verify_unknown':
                pushActionId('verify_failure_help');
                pushActionId('create_ticket');
                break;
            case 'afdian_lookup_required':
                pushActionId('afdian_lookup');
                pushActionId('create_ticket');
                break;
            case 'verify_email_precheck':
                pushActionId('verify_precheck');
                pushActionId('create_ticket');
                break;
            default:
                break;
        }

        if (!actionIds.length) {
            if (status === 'success') {
                if (refType === 'task_id') pushActionId('verify_task_status');
                if (refType === 'order_id') pushActionId('shop_order_content');
            } else if (['queued', 'pending', 'processing', 'requeued', 'retry_waiting'].includes(status)) {
                if (refType === 'task_id') pushActionId('verify_task_status');
                if (refType === 'order_id') pushActionId('shop_order_status');
            } else if (status === 'failed') {
                if (refType === 'task_id') {
                    pushActionId('verify_failure_help');
                    pushActionId('create_ticket');
                }
            }
        }

        pushActionId(openedActionId);
        (Array.isArray(explanation?.suggested_actions) ? explanation.suggested_actions : []).forEach(pushActionId);
        pushActionId(detected?.next_action);

        if (!actionIds.length) {
            pushActionId(this.getAutoSupportPrimaryActionId(detected, explanation));
        }

        return actionIds;
    }

    getAutoSupportAssistActions(detected, explanation = null, openedActionId = '') {
        const actions = this.getAutoSupportScenarioActionIds(detected, explanation, openedActionId)
            .slice(0, 2)
            .map((actionId, index) => ({
            kind: 'action',
            actionId,
            label: this.getAutoSupportAssistActionLabel(actionId, detected, explanation, {
                primary: index === 0,
                openedActionId
            }),
            primary: index === 0
        }));

        actions.push({
            kind: 'root',
            label: this.getAutoSupportRootActionLabel(),
            primary: false
        });

        return actions;
    }

    extractAutoSupportReference(text) {
        const rawText = String(text || '').trim();
        if (!rawText) return null;

        const emailMatch = rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (emailMatch) {
            return {
                value: emailMatch[0],
                ref_type: 'email'
            };
        }

        const uuidMatch = rawText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
        if (uuidMatch) {
            return {
                value: uuidMatch[0]
            };
        }

        const codeMatch = rawText.match(/\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/i);
        if (codeMatch) {
            return {
                value: codeMatch[0],
                ref_type: 'redeem_code'
            };
        }

        const afdianMatch = rawText.match(/(?:爱发电|afdian|订单号|order)[:：#\s-]*([A-Za-z0-9_-]{10,40})/i);
        if (afdianMatch?.[1]) {
            return {
                value: afdianMatch[1]
            };
        }

        if (rawText.length <= 40 && /^[A-Za-z0-9_-]{10,40}$/.test(rawText) && /\d/.test(rawText)) {
            return {
                value: rawText
            };
        }

        return null;
    }

    formatAutoSupportAssistMessage(detected, explanation = null, openedActionId = '', fallbackError = '') {
        const lines = [];
        const refTypeLabel = this.getSupportRefTypeLabel(detected?.ref_type);
        const refValue = String(detected?.normalized_value || '').trim();
        const title = String(explanation?.title || '').trim();
        const message = String(explanation?.message || '').trim();
        const category = this.getSupportCategoryLabel(explanation?.category);
        const openedActionLabel = openedActionId ? this.getSupportActionLabel(openedActionId) : '';

        if (openedActionLabel) {
            lines.push(this.getCurrentLanguage() === 'zh'
                ? `我已经识别到这是“${refTypeLabel}”，并帮你打开了“${openedActionLabel}”。`
                : `I detected this as “${refTypeLabel}” and opened “${openedActionLabel}” for you.`);
        } else {
            lines.push(this.getCurrentLanguage() === 'zh'
                ? `我已经识别到这是“${refTypeLabel}”。`
                : `I detected this as “${refTypeLabel}”.`);
        }

        if (refValue) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '识别内容' : 'Reference'}：${refValue}`);
        }

        if (title) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '判断结果' : 'Result'}：${title}`);
        }

        if (message) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${message}`);
        } else if (fallbackError) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${fallbackError}`);
        }

        if (category) {
            lines.push(`${this.getCurrentLanguage() === 'zh' ? '问题分类' : 'Category'}：${category}`);
        }

        if (openedActionLabel || explanation || fallbackError) {
            lines.push(this.getCurrentLanguage() === 'zh'
                ? '你也可以直接点下方按钮切换到其他入口。'
                : 'You can also use the buttons below to continue.');
        }

        return lines.filter(Boolean).join('\n');
    }

    buildAutoSupportAssistPayload(detected, explanation = null, openedActionId = '', fallbackError = '') {
        return {
            text: this.formatAutoSupportAssistMessage(detected, explanation, openedActionId, fallbackError),
            actions: this.getAutoSupportAssistActions(detected, explanation, openedActionId),
            detected,
            explanation,
            fallbackError
        };
    }

    async openAutoSupportAssistPanel(detected, explanation = null, fallbackError = '') {
        const actionId = this.getAutoSupportPrimaryActionId(detected, explanation);
        if (!actionId) return '';

        const action = this.getSupportAction(actionId);
        if (!action) return '';

        const panelState = {
            value: this.buildAutoSupportPrefillValue(actionId, detected, explanation),
            result: this.formatAutoSupportPanelResult(detected, explanation, fallbackError),
            error: '',
            loading: false
        };

        await this.openSupportAction(actionId, panelState);
        return actionId;
    }

    async maybeRunAutoSupportAssist(text) {
        const candidate = this.extractAutoSupportReference(text);
        if (!candidate) return false;

        let sessionContext = null;
        try {
            sessionContext = await this.refreshUserSessionContext();
        } catch (error) {
            console.error('[ChatWidget] Failed to refresh auth before auto support assist:', error);
            return false;
        }

        if (!sessionContext?.user) return false;

        try {
            const detected = await this.callSupportApi('detect_reference', candidate);
            const confidence = Number(detected?.confidence || 0);
            if (!detected || detected.ref_type === 'unknown' || confidence < 0.6) {
                return false;
            }

            try {
                const explanation = await this.callSupportApi('explain_failure', {
                    ref_type: detected.ref_type,
                    ref_id: detected.normalized_value,
                    site: detected.site || window.SiteConfig?.site || 'cn'
                });
                const openedActionId = await this.openAutoSupportAssistPanel(detected, explanation);
                this.appendMessage(
                    this.buildAutoSupportAssistPayload(detected, explanation, openedActionId),
                    this.getMessageRenderType(true),
                    'support-assist',
                    null,
                    true
                );
                return true;
            } catch (explainError) {
                const openedActionId = await this.openAutoSupportAssistPanel(detected, null, explainError?.message || '');
                this.appendMessage(
                    this.buildAutoSupportAssistPayload(detected, null, openedActionId, explainError?.message || ''),
                    this.getMessageRenderType(true),
                    'support-assist',
                    null,
                    true
                );
                return true;
            }
        } catch (error) {
            console.warn('[ChatWidget] Auto support detection skipped:', error?.message || error);
            return false;
        }
    }

    getSupportSubmitLabel(actionId, action) {
        if (actionId === 'redeem_code') {
            return this.getCurrentLanguage() === 'zh' ? '立即兑换' : 'Redeem Now';
        }

        if (action?.mode === 'ticket') {
            return this.getCurrentLanguage() === 'zh' ? '提交工单' : 'Submit Ticket';
        }

        return this.getCurrentLanguage() === 'zh' ? '立即查询' : 'Run Check';
    }

    getSupportSubmittingLabel(action) {
        if (action?.mode === 'ticket') {
            return this.getCurrentLanguage() === 'zh' ? '提交中...' : 'Submitting...';
        }

        if (action?.mode === 'rpc') {
            return this.getCurrentLanguage() === 'zh' ? '兑换中...' : 'Redeeming...';
        }

        return this.getCurrentLanguage() === 'zh' ? '查询中...' : 'Checking...';
    }

    buildSupportResultBlock(state) {
        if (!state?.result && !state?.error) return '';
        const resultClass = state.error ? 'chat-support-result chat-support-result--error' : 'chat-support-result';
        const text = state.error || state.result || '';
        return `
            <div class="${resultClass}">
                <div class="chat-support-result-label">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '处理结果' : 'Result')}</div>
                <div class="chat-support-result-body">${this.escapeHtml(text)}</div>
            </div>
        `;
    }

    buildSupportInlineField(actionId, action, state) {
        const isTextarea = action?.mode === 'ticket';
        const controlClass = isTextarea
            ? 'chat-support-inline-input chat-support-inline-input--textarea'
            : 'chat-support-inline-input';

        return `
            <form class="chat-support-form" data-support-inline-form="${this.escapeHtml(actionId)}">
                ${isTextarea
                    ? `<textarea class="${controlClass}" data-support-inline-input rows="3"></textarea>`
                    : `<input type="text" class="${controlClass}" data-support-inline-input>`}
                <div class="chat-support-form-actions">
                    <button type="submit" class="chat-support-btn" ${state.loading ? 'disabled' : ''}>
                        ${this.escapeHtml(state.loading ? this.getSupportSubmittingLabel(action) : this.getSupportSubmitLabel(actionId, action))}
                    </button>
                    <button type="button" class="chat-support-link-btn" data-support-root="1">
                        ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}
                    </button>
                </div>
            </form>
        `;
    }

    hydrateSupportInlineField(actionId, action) {
        if (!this.supportPanel) return;
        const state = this.getSupportInlineState(actionId);
        const inputEl = this.supportPanel.querySelector('[data-support-inline-input]');
        if (!inputEl) return;

        inputEl.value = state.value || '';
        inputEl.placeholder = this.resolveSupportText(
            action?.placeholder,
            this.t('chat.inputMessagePlaceholder', '输入消息...')
        );

        if (!state.loading) {
            requestAnimationFrame(() => this._focusInputWithoutScroll?.(inputEl));
        }
    }

    renderSupportRootPanel(options = {}) {
        if (!this.supportPanel) return;
        const activate = options?.activate !== false;

        const config = this.getSupportConfig();
        const context = this.getSupportContextConfig();
        if (!config || !context) {
            if (activate) {
                this.setSupportDisplayMode('chat');
                this.updateSupportInputState('');
            }
            return;
        }

        if (activate) {
            this.getSupportInlineState('');
            this.supportView = { type: 'root', id: '' };
            this.supportLastMenuId = '';
            this.setSupportDisplayMode('support');
            this.updateSupportInputState('');
        }

        const shortcutButtons = this.buildSupportMenuButtons(context.shortcuts || []);
        const menuButtons = (config.rootMenus || [])
            .map((menuId) => {
                const menu = this.getSupportMenu(menuId);
                if (!menu) return '';
                return `
                    <button type="button" class="chat-support-btn chat-support-btn--secondary" data-support-menu-id="${this.escapeHtml(menuId)}">
                        ${this.escapeHtml(this.resolveSupportText(menu.title, menuId))}
                    </button>
                `;
            })
            .join('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '自助排查' : 'Self-serve')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.getSupportEntryLabel())}</div>
                <p class="chat-support-body">${this.escapeHtml(this.resolveSupportText(context.intro, '优先帮你处理兑换、发放和任务状态问题。'))}</p>
                <div class="chat-support-section chat-support-section--shortcuts">
                    <div class="chat-support-section-title">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '推荐快捷入口' : 'Recommended')}</div>
                    <div class="chat-support-grid chat-support-grid--shortcuts">${shortcutButtons}</div>
                </div>
                <div class="chat-support-section chat-support-section--menus">
                    <div class="chat-support-section-title">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '全部问题分类' : 'Categories')}</div>
                    <div class="chat-support-grid chat-support-grid--menus">${menuButtons}</div>
                </div>
            </div>
        `;
        this._supportRootPrewarmed = true;
    }

    renderSupportMenuPanel(menuId) {
        if (!this.supportPanel) return;
        const menu = this.getSupportMenu(menuId);
        if (!menu) {
            this.renderSupportRootPanel();
            return;
        }

        this.supportView = { type: 'menu', id: menuId };
        this.supportLastMenuId = menuId;
        this.getSupportInlineState('');
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '问题分类' : 'Category')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(menu.title, menuId))}</div>
                <p class="chat-support-body">${this.escapeHtml(this.resolveSupportText(menu.description, ''))}</p>
                <div class="chat-support-grid">${this.buildSupportMenuButtons(menu.items || [])}</div>
                <div class="chat-support-footer chat-support-footer--back">
                    <button type="button" class="chat-support-link-btn" data-support-root="1">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}</button>
                </div>
            </div>
        `;
    }

    renderSupportStaticPanel(actionId) {
        if (!this.supportPanel) return;
        const action = this.getSupportAction(actionId);
        if (!action) {
            this.renderSupportRootPanel();
            return;
        }

        this.supportView = { type: 'action', id: actionId };
        this.supportLastMenuId = this.supportLastMenuId || 'human';
        this.getSupportInlineState('');
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        const checklist = this.buildSupportChecklist(this.resolveSupportText(action.checklist, []));
        const bodyText = this.resolveSupportText(action.body, '');
        const maybeLink = action.mode === 'link'
            ? `
                <div class="chat-support-footer">
                    <button type="button" class="chat-support-btn" data-support-open-link="${this.escapeHtml(action.url || '')}">
                        ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '打开 Telegram' : 'Open Telegram')}
                    </button>
                </div>
            `
            : '';

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '操作指引' : 'Guide')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(action.label, actionId))}</div>
                ${bodyText ? `<p class="chat-support-body">${this.escapeHtml(bodyText)}</p>` : ''}
                ${checklist}
                ${maybeLink}
                <div class="chat-support-footer chat-support-footer--back">
                    <button type="button" class="chat-support-link-btn" data-support-root="1">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}</button>
                </div>
            </div>
        `;
    }

    renderSupportActionPanel(actionId) {
        if (!this.supportPanel) return;
        const action = this.getSupportAction(actionId);
        if (!action) {
            this.renderSupportRootPanel();
            return;
        }

        const state = this.getSupportInlineState(actionId);
        this.supportView = { type: 'action', id: actionId };
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '自助处理' : 'Self-serve')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(action.label, actionId))}</div>
                <p class="chat-support-body">${this.escapeHtml(this.resolveSupportText(action.prompt, ''))}</p>
                ${this.resolveSupportText(action.inputHint, '') ? `<div class="chat-support-hint">${this.escapeHtml(this.resolveSupportText(action.inputHint, ''))}</div>` : ''}
                ${this.buildSupportInlineField(actionId, action, state)}
                ${this.buildSupportResultBlock(state)}
            </div>
        `;

        this.hydrateSupportInlineField(actionId, action);
    }

    renderSupportLoginRequiredPanel(actionId) {
        if (!this.supportPanel) return;
        const action = this.getSupportAction(actionId);
        this.supportView = { type: 'action', id: actionId };
        this.getSupportInlineState('');
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');

        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '需要登录' : 'Login Required')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.resolveSupportText(action?.label, actionId || ''))}</div>
                <p class="chat-support-body">${this.escapeHtml(this.getCurrentLanguage() === 'zh'
                    ? '这个操作会读取你的订单、兑换码或任务状态，所以需要先登录当前账号。'
                    : 'This action reads your orders, codes, or tasks, so you need to sign in first.')}</p>
                <div class="chat-support-footer chat-support-footer--back">
                    <button type="button" class="chat-support-link-btn" data-support-root="1">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}</button>
                </div>
            </div>
        `;
    }

    buildSupportTicketHistoryMeta(ticket = {}) {
        const metaParts = [
            this.getSupportIssueTypeLabel(ticket.issue_type),
            ticket.order_id ? `${this.getCurrentLanguage() === 'zh' ? '订单' : 'Order'} ${this.truncateText(ticket.order_id, 12)}` : '',
            this.formatSupportPanelDate(ticket.updated_at || ticket.created_at)
        ].filter(Boolean);

        return metaParts.join(' · ');
    }

    renderSupportTicketHistoryPanel() {
        if (!this.supportPanel) return;

        const state = this.getSupportTicketHistoryState();
        const context = this.normalizeSupportTicketHistoryContext(state.context);
        const payload = state.payload && typeof state.payload === 'object' ? state.payload : {};
        const tickets = Array.isArray(payload.tickets) ? payload.tickets : [];
        const focusTicketId = String(payload.focus_ticket_id || context.ticketId || '').trim();
        const focusTicket = focusTicketId
            ? tickets.find((ticket) => String(ticket?.id || '').trim() === focusTicketId)
            : null;
        const intro = focusTicket
            ? (this.getCurrentLanguage() === 'zh'
                ? `已为你定位到工单 ${String(focusTicket.id || '').slice(0, 8)} 的最新结果。`
                : `Focused on the latest update for ticket ${String(focusTicket.id || '').slice(0, 8)}.`)
            : (this.getCurrentLanguage() === 'zh'
                ? '这里会列出你最近的工单处理结果，以及仍待处理的记录。'
                : 'This panel shows your latest ticket outcomes and anything still waiting for review.');

        let listMarkup = `
            <div class="chat-support-ticket-empty">
                ${this.escapeHtml(this.getCurrentLanguage() === 'zh'
                    ? '当前账号下还没有可展示的工单记录。'
                    : 'There are no ticket records to show for this account yet.')}
            </div>
        `;
        if (state.loading) {
            listMarkup = `
                <div class="chat-support-ticket-empty">
                    ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '正在加载工单结果...' : 'Loading ticket results...')}
                </div>
            `;
        } else if (tickets.length) {
            listMarkup = `
                <div class="chat-support-ticket-list">
                    ${tickets.map((ticket) => {
                        const normalizedStatus = String(ticket?.status || '').trim().toLowerCase();
                        const statusLabel = this.getSupportStatusLabel(normalizedStatus);
                        const statusTone = ['resolved', 'success'].includes(normalizedStatus)
                            ? 'resolved'
                            : (normalizedStatus === 'rejected' ? 'rejected' : 'pending');
                        const description = String(ticket?.description || '').trim();
                        const adminNotes = String(ticket?.admin_notes || '').trim();
                        const noteText = adminNotes
                            || (this.getCurrentLanguage() === 'zh'
                                ? '客服还在处理中，你可以稍后回来查看结果。'
                                : 'Support is still reviewing this ticket. Check back again later.');
                        return `
                            <article class="chat-support-ticket-item${ticket?.is_focus ? ' is-focus' : ''}">
                                <div class="chat-support-ticket-row">
                                    <div class="chat-support-ticket-heading">
                                        <div class="chat-support-ticket-title">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? `工单 ${String(ticket?.id || '').slice(0, 8)}` : `Ticket ${String(ticket?.id || '').slice(0, 8)}`)}</div>
                                        <div class="chat-support-ticket-meta">${this.escapeHtml(this.buildSupportTicketHistoryMeta(ticket))}</div>
                                    </div>
                                    <span class="chat-support-ticket-status chat-support-ticket-status--${statusTone}">${this.escapeHtml(statusLabel)}</span>
                                </div>
                                ${ticket?.is_focus
                                    ? `<div class="chat-support-ticket-flag">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '当前提醒对应工单' : 'Linked to the current reminder')}</div>`
                                    : ''}
                                ${description
                                    ? `<div class="chat-support-ticket-copy"><span class="chat-support-ticket-copy-label">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '问题描述' : 'Issue')}</span>${this.escapeHtml(this.truncateText(description, 180))}</div>`
                                    : ''}
                                <div class="chat-support-ticket-copy"><span class="chat-support-ticket-copy-label">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '处理结果' : 'Result')}</span>${this.escapeHtml(this.truncateText(noteText, 220))}</div>
                            </article>
                        `;
                    }).join('')}
                </div>
            `;
        }

        const errorMarkup = !state.loading && state.error
            ? `
                <div class="chat-support-result chat-support-result--error">
                    <div class="chat-support-result-label">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '加载失败' : 'Load Failed')}</div>
                    <div class="chat-support-result-body">${this.escapeHtml(state.error)}</div>
                </div>
            `
            : '';

        this.supportView = { type: 'action', id: 'ticket_history' };
        this.setSupportDisplayMode('support');
        this.updateSupportInputState('');
        this.supportPanel.innerHTML = `
            <div class="chat-support-card chat-support-card--fullscreen">
                <div class="chat-support-eyebrow">${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '工单结果' : 'Ticket Results')}</div>
                <div class="chat-support-title">${this.escapeHtml(this.getSupportActionLabel('ticket_history'))}</div>
                <p class="chat-support-body">${this.escapeHtml(intro)}</p>
                <div class="chat-support-section">
                    <div class="chat-support-section-title">${this.escapeHtml(this.getCurrentLanguage() === 'zh'
                        ? `最近 ${Number(payload.limit || 6)} 条记录`
                        : `Latest ${Number(payload.limit || 6)} tickets`)}</div>
                    ${listMarkup}
                </div>
                ${errorMarkup}
                <div class="chat-support-footer chat-support-footer--stack">
                    <button type="button" class="chat-support-btn chat-support-btn--secondary" data-support-ticket-history-refresh="1">
                        ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '刷新结果' : 'Refresh')}
                    </button>
                    <button type="button" class="chat-support-btn" data-support-action-id="create_ticket">
                        ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '提交新工单' : 'Submit Ticket')}
                    </button>
                    <button type="button" class="chat-support-link-btn" data-support-root="1">
                        ${this.escapeHtml(this.getCurrentLanguage() === 'zh' ? '返回主菜单' : 'Back')}
                    </button>
                </div>
            </div>
        `;
    }

    async openSupportTicketHistoryPanel(context = {}) {
        const normalizedContext = this.normalizeSupportTicketHistoryContext(context);
        this.supportLastMenuId = this.supportLastMenuId || 'human';
        this.getSupportInlineState('');
        this.setSupportTicketHistoryState({
            context: normalizedContext,
            payload: null,
            error: '',
            loading: true
        });
        this.renderSupportTicketHistoryPanel();

        try {
            const payload = await this.callSupportApi('ticket_history', {
                ticket_id: normalizedContext.ticketId || '',
                order_id: normalizedContext.orderId || ''
            });
            this.setSupportTicketHistoryState({
                context: normalizedContext,
                payload,
                error: '',
                loading: false
            });
        } catch (error) {
            this.setSupportTicketHistoryState({
                context: normalizedContext,
                payload: null,
                error: error?.message || (this.getCurrentLanguage() === 'zh' ? '工单记录加载失败' : 'Failed to load tickets'),
                loading: false
            });
        }

        this.renderSupportTicketHistoryPanel();
    }

    async openSupportAction(actionId, nextPanelState = null) {
        const action = this.getSupportAction(actionId);
        if (!action) return;

        if (action.mode === 'live_chat') {
            this.supportView = { type: 'chat', id: actionId };
            this.setSupportDisplayMode('chat');
            requestAnimationFrame(() => {
                this.scrollToBottom();
                this._focusInputWithoutScroll?.(this.input);
            });
            return;
        }

        try {
            await this.refreshUserSessionContext();
        } catch (error) {
            console.error('[ChatWidget] Failed to refresh support auth state:', error);
        }

        if (action.requiresAuth && !this.currentUser) {
            this.renderSupportLoginRequiredPanel(actionId);
            return;
        }

        if (action.mode === 'static' || action.mode === 'link') {
            this.renderSupportStaticPanel(actionId);
            return;
        }

        if (action.mode === 'ticket_history') {
            await this.openSupportTicketHistoryPanel(nextPanelState?.context || {});
            return;
        }

        if (nextPanelState && typeof nextPanelState === 'object') {
            this.setSupportInlineState(actionId, {
                value: typeof nextPanelState.value === 'string' ? nextPanelState.value : '',
                result: typeof nextPanelState.result === 'string' ? nextPanelState.result : '',
                error: typeof nextPanelState.error === 'string' ? nextPanelState.error : '',
                loading: nextPanelState.loading === true
            });
        } else {
            this.getSupportInlineState(actionId);
        }

        this.renderSupportActionPanel(actionId);
    }

    async getSupportAuthHeaders() {
        const { data: { session } } = await this.supabase.auth.getSession();
        const accessToken = session?.access_token || '';
        const headers = {
            'Content-Type': 'application/json'
        };

        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }

        return headers;
    }

    async callSupportApi(action, input) {
        const headers = await this.getSupportAuthHeaders();
        let response = null;
        let payload = {};

        try {
            response = await fetch('/api/support', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    action,
                    input,
                    site: this.getCurrentSite()
                })
            });
            payload = await response.json().catch(() => ({}));
        } catch (error) {
            if (action === 'code_status') {
                return this.callSupportCodeStatusRpcFallback(input, error);
            }
            throw error;
        }

        if (!response.ok || payload.success === false) {
            if (action === 'code_status' && this.shouldFallbackSupportCodeStatusRequest(response, payload)) {
                return this.callSupportCodeStatusRpcFallback(input, new Error(payload.message || '支持请求失败'));
            }
            throw new Error(payload.message || '支持请求失败');
        }
        return payload.payload || null;
    }

    shouldFallbackSupportCodeStatusRequest(response, payload = {}) {
        const status = Number(response?.status || 0);
        const code = String(payload?.code || '').trim();
        if ([404, 405, 500, 501, 502, 503, 504].includes(status)) {
            return true;
        }

        return [
            'support_not_configured',
            'auth_service_unavailable',
            'support_request_failed',
            'code_status_failed'
        ].includes(code);
    }

    async callSupportCodeStatusRpcFallback(input, cause = null) {
        const codeOrOrder = String(input || '').trim().toUpperCase();
        if (!codeOrOrder) {
            throw new Error(this.getCurrentLanguage() === 'zh' ? '请输入兑换码或外部订单号' : 'Enter a code or external order number');
        }

        if (!this.supabase?.rpc) {
            throw cause || new Error(this.getCurrentLanguage() === 'zh' ? '支持请求失败' : 'Support request failed');
        }

        const { data, error } = await this.supabase.rpc('fn_check_code_status', {
            p_code: codeOrOrder
        });
        if (error) {
            throw new Error(error.message || (this.getCurrentLanguage() === 'zh' ? '兑换码状态查询失败' : 'Code status lookup failed'));
        }

        return data || null;
    }

    async callVerifyStatus(taskId) {
        const headers = await this.getSupportAuthHeaders();
        const site = window.SiteConfig?.site || 'cn';
        const response = await fetch(`/api/verify/status/${encodeURIComponent(taskId)}?site=${encodeURIComponent(site)}`, {
            method: 'GET',
            headers
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || '任务状态查询失败');
        }
        return payload;
    }

    getSupportStatusLabel(status) {
        const normalized = String(status || '').trim().toLowerCase();
        const labels = {
            pending: this.getCurrentLanguage() === 'zh' ? '待处理' : 'Pending',
            open: this.getCurrentLanguage() === 'zh' ? '待处理' : 'Pending',
            resolved: this.getCurrentLanguage() === 'zh' ? '已解决' : 'Resolved',
            rejected: this.getCurrentLanguage() === 'zh' ? '已拒绝' : 'Rejected',
            used: this.getCurrentLanguage() === 'zh' ? '已使用' : 'Used',
            revoked: this.getCurrentLanguage() === 'zh' ? '已撤销' : 'Revoked',
            locked: this.getCurrentLanguage() === 'zh' ? '已锁定' : 'Locked',
            disabled: this.getCurrentLanguage() === 'zh' ? '已禁用' : 'Disabled',
            delivered: this.getCurrentLanguage() === 'zh' ? '已发放' : 'Delivered',
            processing: this.getCurrentLanguage() === 'zh' ? '处理中' : 'Processing',
            queued: this.getCurrentLanguage() === 'zh' ? '排队中' : 'Queued',
            success: this.getCurrentLanguage() === 'zh' ? '已完成' : 'Completed',
            failed: this.getCurrentLanguage() === 'zh' ? '失败' : 'Failed',
            dead_letter: this.getCurrentLanguage() === 'zh' ? '死信' : 'Dead Letter',
            retry_waiting: this.getCurrentLanguage() === 'zh' ? '重试等待中' : 'Retry Waiting',
            requeued: this.getCurrentLanguage() === 'zh' ? '已重排队' : 'Requeued',
            paid: this.getCurrentLanguage() === 'zh' ? '已支付' : 'Paid'
        };
        return labels[normalized] || (normalized || (this.getCurrentLanguage() === 'zh' ? '未知' : 'Unknown'));
    }

    getSupportIssueTypeLabel(issueType = '') {
        const normalized = String(issueType || '').trim().toLowerCase();
        const labels = {
            delivery: this.getCurrentLanguage() === 'zh' ? '履约问题' : 'Delivery',
            verification: this.getCurrentLanguage() === 'zh' ? '验证问题' : 'Verification',
            refund: this.getCurrentLanguage() === 'zh' ? '退款问题' : 'Refund',
            payment: this.getCurrentLanguage() === 'zh' ? '支付问题' : 'Payment',
            order: this.getCurrentLanguage() === 'zh' ? '订单问题' : 'Order',
            account: this.getCurrentLanguage() === 'zh' ? '账号问题' : 'Account',
            other: this.getCurrentLanguage() === 'zh' ? '其他问题' : 'Other'
        };
        return labels[normalized] || (this.getCurrentLanguage() === 'zh' ? '其他问题' : 'Other');
    }

    formatSupportPanelDate(value) {
        if (!value) return this.getCurrentLanguage() === 'zh' ? '时间未知' : 'Unknown time';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString(this.getCurrentLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatSupportResult(actionId, payload) {
        const newline = '\n';
        if (!payload) {
            return this.getCurrentLanguage() === 'zh' ? '没有查到可用结果。' : 'No result found.';
        }

        if (actionId === 'code_status') {
            const valid = payload.valid === true;
            const status = this.getSupportStatusLabel(payload.status);
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '兑换码状态结果' : 'Code Status',
                `${this.getCurrentLanguage() === 'zh' ? '状态' : 'Status'}：${valid ? status : (payload.message || status)}`,
                payload.code ? `${this.getCurrentLanguage() === 'zh' ? '兑换码' : 'Code'}：${payload.code}` : '',
                payload.package_name ? `${this.getCurrentLanguage() === 'zh' ? '套餐' : 'Package'}：${payload.package_name}` : '',
                payload.points ? `${this.getCurrentLanguage() === 'zh' ? '积分' : 'Points'}：${payload.points}` : '',
                payload.used_by ? `${this.getCurrentLanguage() === 'zh' ? '使用者' : 'Used By'}：${payload.used_by}` : '',
                payload.used_at ? `${this.getCurrentLanguage() === 'zh' ? '使用时间' : 'Used At'}：${payload.used_at}` : '',
                payload.revoke_reason ? `${this.getCurrentLanguage() === 'zh' ? '撤销理由' : 'Revocation Reason'}：${payload.revoke_reason}` : '',
                payload.revoked_at ? `${this.getCurrentLanguage() === 'zh' ? '撤销时间' : 'Revoked At'}：${payload.revoked_at}` : '',
                payload.expires_at ? `${this.getCurrentLanguage() === 'zh' ? '过期时间' : 'Expires At'}：${payload.expires_at}` : '',
                payload.message && !valid ? `${this.getCurrentLanguage() === 'zh' ? '说明' : 'Note'}：${payload.message}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'redeem_code') {
            const lines = [
                payload.message || (this.getCurrentLanguage() === 'zh' ? '兑换已处理。' : 'Redeem request completed.'),
                payload.package_name ? `${this.getCurrentLanguage() === 'zh' ? '套餐' : 'Package'}：${payload.package_name}` : '',
                payload.points ? `${this.getCurrentLanguage() === 'zh' ? '到账积分' : 'Points Added'}：${payload.points}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'afdian_lookup') {
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '爱发电订单结果' : 'Afdian Order',
                `${this.getCurrentLanguage() === 'zh' ? '支付状态' : 'Payment'}：${this.getSupportStatusLabel(payload.payment_status)}`,
                payload.code ? `${this.getCurrentLanguage() === 'zh' ? '兑换码' : 'Code'}：${payload.code}` : '',
                payload.points ? `${this.getCurrentLanguage() === 'zh' ? '积分' : 'Points'}：${payload.points}` : '',
                `${this.getCurrentLanguage() === 'zh' ? '领取状态' : 'Claim Status'}：${payload.is_redeemed ? (this.getCurrentLanguage() === 'zh' ? '已领取' : 'Claimed') : (this.getCurrentLanguage() === 'zh' ? '未领取' : 'Not Claimed')}`,
                payload.sign_verified !== undefined ? `${this.getCurrentLanguage() === 'zh' ? '签名校验' : 'Signature'}：${payload.sign_verified ? (this.getCurrentLanguage() === 'zh' ? '通过' : 'Passed') : (this.getCurrentLanguage() === 'zh' ? '未通过' : 'Not Passed')}` : '',
                payload.amount_verified !== undefined ? `${this.getCurrentLanguage() === 'zh' ? '金额校验' : 'Amount'}：${payload.amount_verified ? (this.getCurrentLanguage() === 'zh' ? '通过' : 'Passed') : (this.getCurrentLanguage() === 'zh' ? '未通过' : 'Not Passed')}` : '',
                payload.last_error ? `${this.getCurrentLanguage() === 'zh' ? '最近错误' : 'Last Error'}：${payload.last_error}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'shop_order_status') {
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '商城订单状态' : 'Shop Order Status',
                `${this.getCurrentLanguage() === 'zh' ? '订单号' : 'Order ID'}：${payload.id}`,
                payload.snapshot_product_name ? `${this.getCurrentLanguage() === 'zh' ? '商品' : 'Product'}：${payload.snapshot_product_name}` : '',
                `${this.getCurrentLanguage() === 'zh' ? '发放状态' : 'Delivery'}：${this.getSupportStatusLabel(payload.delivery_status)}`,
                payload.delivery_task_id ? `${this.getCurrentLanguage() === 'zh' ? '任务号' : 'Task ID'}：${payload.delivery_task_id}` : '',
                payload.delivery_last_error ? `${this.getCurrentLanguage() === 'zh' ? '最近错误' : 'Last Error'}：${payload.delivery_last_error}` : '',
                payload.delivery_completed_at ? `${this.getCurrentLanguage() === 'zh' ? '完成时间' : 'Completed At'}：${payload.delivery_completed_at}` : '',
                payload.created_at ? `${this.getCurrentLanguage() === 'zh' ? '下单时间' : 'Created At'}：${payload.created_at}` : ''
            ].filter(Boolean);
            return lines.join(newline);
        }

        if (actionId === 'shop_order_content') {
            const items = Array.isArray(payload.items) ? payload.items : [];
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '订单内容摘要' : 'Order Content Summary',
                payload.order_id ? `${this.getCurrentLanguage() === 'zh' ? '订单号' : 'Order ID'}：${payload.order_id}` : '',
                payload.product_name ? `${this.getCurrentLanguage() === 'zh' ? '商品' : 'Product'}：${payload.product_name}` : ''
            ];
            items.slice(0, 3).forEach((item, index) => {
                const content = String(item?.content || '').trim();
                const summary = content.length > 90 ? `${content.slice(0, 90)}...` : content;
                lines.push(`${this.getCurrentLanguage() === 'zh' ? '内容' : 'Item'} ${index + 1}：${summary || (this.getCurrentLanguage() === 'zh' ? '暂无内容' : 'No content')}`);
            });
            if (items.length > 3) {
                lines.push(this.getCurrentLanguage() === 'zh' ? '内容较多，建议去钱包订单详情页复制完整结果。' : 'There are more items. Open the wallet order detail to copy the full result.');
            }
            return lines.filter(Boolean).join(newline);
        }

        if (actionId === 'verify_task_status' || actionId === 'verify_failure_help') {
            const lines = [
                this.getCurrentLanguage() === 'zh' ? '验证任务状态' : 'Verify Task Status',
                payload.job_id ? `${this.getCurrentLanguage() === 'zh' ? '任务号' : 'Task ID'}：${payload.job_id}` : '',
                `${this.getCurrentLanguage() === 'zh' ? '当前状态' : 'Status'}：${this.getSupportStatusLabel(payload.status)}`,
                payload.stage_label ? `${this.getCurrentLanguage() === 'zh' ? '阶段' : 'Stage'}：${payload.stage_label}` : '',
                payload.queue_position !== undefined && payload.queue_position !== null ? `${this.getCurrentLanguage() === 'zh' ? '队列位置' : 'Queue Position'}：${payload.queue_position}` : '',
                payload.estimated_wait_seconds ? `${this.getCurrentLanguage() === 'zh' ? '预计等待秒数' : 'Estimated Wait (s)'}：${payload.estimated_wait_seconds}` : '',
                payload.message ? `${this.getCurrentLanguage() === 'zh' ? '说明' : 'Message'}：${payload.message}` : '',
                payload.url ? `${this.getCurrentLanguage() === 'zh' ? '结果链接' : 'Result URL'}：${payload.url}` : '',
                payload.error ? `${this.getCurrentLanguage() === 'zh' ? '错误原因' : 'Error'}：${payload.error}` : ''
            ].filter(Boolean);

            if (actionId === 'verify_failure_help' && String(payload.status || '').toLowerCase() !== 'failed') {
                lines.push(this.getCurrentLanguage() === 'zh'
                    ? '这个任务当前不处于失败状态。如果你是要查进度，建议用“查询任务进度”。'
                    : 'This task is not currently failed. If you only want progress, use “Check Task Status”.');
            }

            return lines.join(newline);
        }

        if (actionId === 'create_ticket') {
            return [
                this.getCurrentLanguage() === 'zh' ? '工单已提交。' : 'Ticket submitted.',
                payload.ticket_id ? `${this.getCurrentLanguage() === 'zh' ? '工单号' : 'Ticket ID'}：${payload.ticket_id}` : '',
                this.getCurrentLanguage() === 'zh' ? '客服会在后台看到你的描述并继续处理。' : 'Support will see your description and continue from there.'
            ].filter(Boolean).join(newline);
        }

        return JSON.stringify(payload, null, 2);
    }

    async handleSupportActionSubmission(actionId, input) {
        const action = this.getSupportAction(actionId);
        if (!action) {
            return {
                success: false,
                message: this.getCurrentLanguage() === 'zh' ? '没有找到对应操作。' : 'Action not found.'
            };
        }

        try {
            let payload = null;

            if (action.mode === 'support_api') {
                payload = await this.callSupportApi(action.apiAction, input);
            } else if (action.mode === 'rpc') {
                const site = window.SiteConfig?.site || 'cn';
                const { data, error } = await this.supabase.rpc(action.rpcName, {
                    p_code: String(input || '').trim(),
                    p_site: site
                });
                if (error) throw error;
                if (data?.success === false) {
                    throw new Error(data.message || '操作失败');
                }
                payload = data;
            } else if (action.mode === 'verify_status') {
                payload = await this.callVerifyStatus(String(input || '').trim());
            } else if (action.mode === 'ticket') {
                payload = await this.callSupportApi('create_ticket', input);
            }

            return {
                success: true,
                message: this.formatSupportResult(actionId, payload)
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || (this.getCurrentLanguage() === 'zh' ? '处理失败，请稍后重试。' : 'Request failed. Please try again later.')
            };
        }
    }

    async handleSupportPanelSubmit(event) {
        const form = event.target instanceof Element ? event.target.closest('[data-support-inline-form]') : null;
        if (!form) return;

        event.preventDefault();

        const actionId = form.getAttribute('data-support-inline-form') || '';
        const action = this.getSupportAction(actionId);
        const inputEl = form.querySelector('[data-support-inline-input]');
        const rawValue = typeof inputEl?.value === 'string' ? inputEl.value : '';
        const trimmedValue = rawValue.trim();

        if (!action) return;

        if (!trimmedValue) {
            this.supportInlineState = {
                actionId,
                value: rawValue,
                result: '',
                error: this.getCurrentLanguage() === 'zh' ? '先输入内容再提交。' : 'Enter something before submitting.',
                loading: false
            };
            this.renderSupportActionPanel(actionId);
            return;
        }

        this.supportInlineState = {
            actionId,
            value: rawValue,
            result: '',
            error: '',
            loading: true
        };
        this.renderSupportActionPanel(actionId);

        const outcome = await this.handleSupportActionSubmission(actionId, trimmedValue);
        this.supportInlineState = {
            actionId,
            value: rawValue,
            result: outcome?.success ? (outcome.message || '') : '',
            error: outcome?.success ? '' : (outcome?.message || ''),
            loading: false
        };
        this.renderSupportActionPanel(actionId);
    }

    handleSupportPanelClick(event) {
        const button = event.target instanceof Element
            ? event.target.closest('[data-support-action-id], [data-support-menu-id], [data-support-root], [data-support-open-link], [data-support-ticket-history-refresh]')
            : null;
        if (!button) return;

        if (button.hasAttribute('data-support-root')) {
            this.renderSupportRootPanel();
            return;
        }

        const menuId = button.getAttribute('data-support-menu-id');
        if (menuId) {
            this.renderSupportMenuPanel(menuId);
            return;
        }

        const actionId = button.getAttribute('data-support-action-id');
        if (actionId) {
            this.openSupportAction(actionId);
            return;
        }

        const url = button.getAttribute('data-support-open-link');
        if (url) {
            window.open(url, '_blank', 'noopener');
            return;
        }

        if (button.hasAttribute('data-support-ticket-history-refresh')) {
            void this.openSupportTicketHistoryPanel(this.getSupportTicketHistoryState().context);
        }
    }

    setSupportAssistButtonLoading(button = null, label = '') {
        if (!button || button.dataset.supportAssistLoading === '1') return button;

        const loadingLabel = String(label || this.t('chat.loading', '加载中...'));
        const rect = typeof button.getBoundingClientRect === 'function'
            ? button.getBoundingClientRect()
            : null;
        button.dataset.supportAssistLoading = '1';
        button.dataset.supportAssistOriginalHtml = button.innerHTML;
        button.dataset.supportAssistOriginalMinWidth = button.style.minWidth || '';
        button.dataset.supportAssistOriginalAriaLabel = button.getAttribute('aria-label') || '';
        button.dataset.supportAssistHadAriaLabel = button.hasAttribute('aria-label') ? '1' : '0';
        button.dataset.supportAssistWasDisabled = button.disabled === true ? '1' : '0';
        if (rect?.width > 0) {
            button.style.minWidth = `${Math.ceil(rect.width)}px`;
        }
        button.classList.add('is-loading');
        button.setAttribute('aria-busy', 'true');
        button.setAttribute('aria-label', loadingLabel);
        button.disabled = true;
        button.innerHTML = this.getChatInlineLoadingDotsMarkup(loadingLabel);
        return button;
    }

    clearSupportAssistButtonLoading(button = null) {
        if (!button || button.dataset?.supportAssistLoading !== '1') return;

        button.innerHTML = button.dataset.supportAssistOriginalHtml || '';
        button.style.minWidth = button.dataset.supportAssistOriginalMinWidth || '';
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
        if (button.dataset.supportAssistHadAriaLabel === '1') {
            button.setAttribute('aria-label', button.dataset.supportAssistOriginalAriaLabel || '');
        } else {
            button.removeAttribute('aria-label');
        }
        button.disabled = button.dataset.supportAssistWasDisabled === '1';

        delete button.dataset.supportAssistLoading;
        delete button.dataset.supportAssistOriginalHtml;
        delete button.dataset.supportAssistOriginalMinWidth;
        delete button.dataset.supportAssistOriginalAriaLabel;
        delete button.dataset.supportAssistHadAriaLabel;
        delete button.dataset.supportAssistWasDisabled;
    }

    handleSupportAssistMessageClick(event) {
        const button = event.target instanceof Element
            ? event.target.closest('[data-support-chat-action-id], [data-support-chat-root]')
            : null;
        if (!button) return;

        event.preventDefault();

        if (button.hasAttribute('data-support-chat-root')) {
            this.renderSupportRootPanel();
            return;
        }

        const actionId = String(button.getAttribute('data-support-chat-action-id') || '').trim();
        if (!actionId) return;

        const assistState = button._supportAssistState || null;
        const panelState = assistState
            ? {
                value: this.buildAutoSupportPrefillValue(actionId, assistState.detected, assistState.explanation),
                result: this.formatAutoSupportPanelResult(assistState.detected, assistState.explanation, assistState.fallbackError),
                error: '',
                loading: false
            }
            : null;

        const loadingButton = this.setSupportAssistButtonLoading(button, this.t('chat.loading', '加载中...'));
        void this.openSupportAction(actionId, panelState).catch((error) => {
            console.warn('[ChatWidget] Failed to open support assist action:', error?.message || error);
            this.clearSupportAssistButtonLoading(loadingButton);
        });
    }

    _detectRefreshRate() {
        if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
        const samples = [];
        let lastTs = 0;
        let remaining = 8;

        const step = (ts) => {
            if (lastTs) {
                samples.push(ts - lastTs);
                remaining -= 1;
            }
            lastTs = ts;
            if (remaining > 0) {
                requestAnimationFrame(step);
                return;
            }
            const sorted = samples.filter((v) => v > 0).sort((a, b) => a - b);
            if (!sorted.length) return;
            const median = sorted[Math.floor(sorted.length / 2)];
            const hz = Math.round(1000 / median);
            if (Number.isFinite(hz) && hz >= 50) {
                this._estimatedRefreshHz = hz;
                this._isHighRefreshDisplay = hz >= 90;
            }
        };

        requestAnimationFrame(step);
    }

    _closeEmojiPicker() {
        if (this.emojiPicker) {
            this.emojiPicker.classList.remove('active');
        }
    }

    _bindEmojiPicker(emojiBtn) {
        if (!emojiBtn || !this.emojiPicker) return;

        if (this._onEmojiDismissClick) {
            document.removeEventListener('click', this._onEmojiDismissClick);
        }

        const shouldSuppressEmojiIntent = () => (
            this.chatWindow?.classList.contains('chat-window--bootstrap-interaction-locked')
            || Date.now() < (this._ignoreEmojiClicksUntil || 0)
        );
        const suppressEmojiIntent = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
            this._closeEmojiPicker();
            if (typeof emojiBtn.blur === 'function') {
                emojiBtn.blur();
            }
        };

        ['pointerdown', 'touchstart', 'mousedown'].forEach((eventName) => {
            emojiBtn.addEventListener(eventName, (event) => {
                if (!shouldSuppressEmojiIntent()) return;
                suppressEmojiIntent(event);
            }, { capture: true });
        });

        emojiBtn.addEventListener('click', (e) => {
            if (shouldSuppressEmojiIntent()) {
                suppressEmojiIntent(e);
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.emojiPicker.classList.toggle('active');
        });

        this.emojiPicker.addEventListener('click', (e) => {
            e.stopPropagation();
            const emojiItem = e.target instanceof Element ? e.target.closest('.emoji-item') : null;
            if (!emojiItem) return;
            if (this.input) {
                this.input.value += emojiItem.textContent;
                this._focusInputWithoutScroll(this.input);
            }
            this._closeEmojiPicker();
        });

        this._onEmojiDismissClick = (e) => {
            if (!this.emojiPicker?.classList.contains('active')) return;
            if (this.emojiPicker.contains(e.target) || emojiBtn.contains(e.target)) return;
            this._closeEmojiPicker();
        };
        document.addEventListener('click', this._onEmojiDismissClick);
    }

    _getAdaptiveKeyboardDuration(frames, minMs, maxMs) {
        const hz = Math.max(50, this._estimatedRefreshHz || 60);
        const ms = Math.round((frames * 1000) / hz);
        return Math.max(minMs, Math.min(maxMs, ms));
    }

    _setChatTranslateVars(baseTranslateY = '-50%', shiftY = 0) {
        if (!this.chatWindow) return;
        const normalizedBase = typeof baseTranslateY === 'number' ? `${Math.round(baseTranslateY)}px` : String(baseTranslateY);
        const normalizedShift = typeof shiftY === 'number' ? `${Math.round(shiftY)}px` : String(shiftY);
        this._setRuntimeStyle(this.chatWindow, '--chat-base-translate-y', normalizedBase);
        this._setRuntimeStyle(this.chatWindow, '--chat-shift-y', normalizedShift);
    }

    _setRuntimeStyle(target, prop, value, priority = '') {
        const style = target?.style;
        if (!style) return;
        const removeProperty = style['removeProperty'].bind(style);
        const setProperty = style['setProperty'].bind(style);
        if (value === null || value === undefined || value === '') {
            removeProperty(prop);
            return;
        }
        setProperty(prop, String(value), priority);
    }

    _toggleElementClass(target, className, enabled) {
        if (!target) return;
        target.classList.toggle(className, enabled);
    }

    scheduleAdminFloatingPanelOffsetSync() {
        if (!this.isAdmin || !this.chatWindow) return;

        if (this._adminFloatingPanelOffsetFrame) {
            if (typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(this._adminFloatingPanelOffsetFrame);
            } else {
                clearTimeout(this._adminFloatingPanelOffsetFrame);
            }
            this._adminFloatingPanelOffsetFrame = null;
        }

        const sync = () => {
            this._adminFloatingPanelOffsetFrame = null;
            this.updateAdminFloatingPanelOffsets();
        };

        this._adminFloatingPanelOffsetFrame = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame(sync)
            : setTimeout(sync, 0);
    }

    getAdminResponsiveNarrowBreakpoint() {
        return 860;
    }

    isNarrowAdminMode() {
        return Boolean(this._adminResponsiveNarrow);
    }

    _shouldUseNarrowAdminMode() {
        if (!this.isAdmin || !this.chatWindow?.classList.contains('admin-mode-layout')) {
            return false;
        }

        const viewportNarrow = typeof window.matchMedia === 'function'
            ? window.matchMedia('(max-width: 700px)').matches
            : window.innerWidth <= 700;

        const width = Math.max(
            Math.ceil(this.chatWindow.getBoundingClientRect?.().width || 0),
            Math.ceil(this.chatWindow.offsetWidth || 0)
        );

        return viewportNarrow || (width > 0 && width <= this.getAdminResponsiveNarrowBreakpoint());
    }

    observeAdminLayoutSize() {
        if (this._adminLayoutResizeObserver) {
            this._adminLayoutResizeObserver.disconnect();
            this._adminLayoutResizeObserver = null;
        }

        if (typeof ResizeObserver !== 'function' || !this.chatWindow) {
            return;
        }

        this._adminLayoutResizeObserver = new ResizeObserver(() => {
            this.syncAdminResponsiveLayout();
            this.scheduleAdminFloatingPanelOffsetSync();
        });
        this._adminLayoutResizeObserver.observe(this.chatWindow);
    }

    syncAdminResponsiveLayout({ force = false } = {}) {
        if (!this.isAdmin || !this.chatWindow?.classList.contains('admin-mode-layout')) {
            return;
        }

        const nextNarrow = this._shouldUseNarrowAdminMode();
        const changed = force || nextNarrow !== this._adminResponsiveNarrow;

        if (changed) {
            this._adminResponsiveNarrow = nextNarrow;
            this._toggleElementClass(this.chatWindow, 'admin-mode-layout--narrow', nextNarrow);

            if (nextNarrow) {
                this.userContextPanelCollapsed = true;
                this.replyTemplateBarCollapsed = true;
                this.opsAlertToolbarCollapsed = true;
            }
        }

        this.syncReplyTemplateBarCollapsedState();
        this.renderOpsAlertToolbarPanel();
        this.syncUserContextInlineTrigger();
        this.syncUserContextPanelVisibility();
        this.scheduleAdminFloatingPanelOffsetSync();
    }

    updateAdminFloatingPanelOffsets() {
        const chatArea = this.chatWindow?.querySelector('.admin-chat-area');
        const header = this.chatHeader || this.chatWindow?.querySelector('#adminChatHeader');
        if (!chatArea || !header) return;

        const headerRect = typeof header.getBoundingClientRect === 'function'
            ? header.getBoundingClientRect()
            : null;
        const headerHeight = Math.max(72, Math.ceil(headerRect?.height || header.offsetHeight || 0));
        this._setRuntimeStyle(chatArea, '--chat-admin-context-top', `${headerHeight + 12}px`);

        const contextHeight = this.userContextPanel && !this.userContextPanel.hidden
            ? Math.ceil(this.userContextPanel.offsetHeight || 0) + 12
            : 0;
        const replyHeight = this.replyTemplateBar && !this.replyTemplateBar.hidden
            ? Math.ceil(this.replyTemplateBar.offsetHeight || 0) + 12
            : 0;

        this._setRuntimeStyle(chatArea, '--chat-admin-context-height', `${Math.max(0, contextHeight)}px`);
        this._setRuntimeStyle(chatArea, '--chat-admin-reply-height', `${Math.max(0, replyHeight)}px`);
    }

    _shouldUseDesktopEdgeSafeInset() {
        if (this._isNarrowViewport() || this._isTouchPrimaryInput()) return false;

        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
        if (fullscreenElement) return true;

        if (typeof window.matchMedia === 'function') {
            try {
                if (window.matchMedia('(display-mode: fullscreen)').matches) {
                    return true;
                }
            } catch (error) {
                console.warn('[ChatWidget] Failed to evaluate fullscreen display-mode:', error);
            }
        }

        const screenWidth = Math.max(window.screen?.width || 0, window.screen?.availWidth || 0);
        const screenHeight = Math.max(window.screen?.height || 0, window.screen?.availHeight || 0);
        const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
        const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
        const outerWidth = Math.max(window.outerWidth || 0, viewportWidth);
        const outerHeight = Math.max(window.outerHeight || 0, viewportHeight);
        const widthDelta = screenWidth ? Math.abs(screenWidth - outerWidth) : Number.POSITIVE_INFINITY;
        const heightDelta = screenHeight ? Math.abs(screenHeight - outerHeight) : Number.POSITIVE_INFINITY;
        const browserChromeHeight = Math.max(0, outerHeight - viewportHeight);

        return widthDelta <= 24 && heightDelta <= 24 && browserChromeHeight <= 96;
    }

    _syncDesktopViewportInsetMode() {
        if (!this.chatWindow) return;
        const useEdgeSafeInset = this.chatWindow.classList.contains('admin-mode-layout') && this._shouldUseDesktopEdgeSafeInset();
        this._toggleElementClass(this.chatWindow, 'chat-window--desktop-edge-safe', useEdgeSafeInset);
    }

    _setChatWindowKeyboardAnimating(enabled, durationMs = 250) {
        if (!this.chatWindow) return;
        this._toggleElementClass(this.chatWindow, 'chat-window--keyboard-animating', enabled);
        this._setRuntimeStyle(
            this.chatWindow,
            '--chat-keyboard-motion-duration',
            enabled ? `${Math.max(0, Math.round(durationMs))}ms` : null
        );
    }

    _setChatWindowDockHeight(heightPx) {
        if (!this.chatWindow) return;
        const hasHeight = Number.isFinite(heightPx) && heightPx > 0;
        this._toggleElementClass(this.chatWindow, 'chat-window--keyboard-height-locked', hasHeight);
        this._setRuntimeStyle(
            this.chatWindow,
            '--chat-keyboard-dock-height',
            hasHeight ? `${Math.round(heightPx)}px` : null,
            'important'
        );
    }

    _setChatWindowDockBottom(bottomPx) {
        if (!this.chatWindow) return;
        const hasBottom = Number.isFinite(bottomPx);
        this._toggleElementClass(this.chatWindow, 'chat-window--keyboard-bottom-docked', hasBottom);
        this._setRuntimeStyle(
            this.chatWindow,
            '--chat-keyboard-bottom',
            hasBottom ? `${Math.max(0, Math.round(bottomPx))}px` : null,
            'important'
        );
    }

    _setMessagesContainerMinHeight(heightPx) {
        if (!this.messagesContainer) return;
        const hasHeight = Number.isFinite(heightPx) && heightPx > 0;
        this._toggleElementClass(this.messagesContainer, 'chat-messages--height-locked', hasHeight);
        this._setRuntimeStyle(
            this.messagesContainer,
            '--chat-messages-runtime-min-height',
            hasHeight ? `${Math.round(heightPx)}px` : null
        );
    }

    _ensureThemeColorMeta() {
        if (this._themeColorMeta?.isConnected) return this._themeColorMeta;
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            meta.setAttribute('data-chat-theme-created', 'true');
            document.head.appendChild(meta);
        }
        this._themeColorMeta = meta;
        return meta;
    }

    _getChatThemeChromeColor() {
        const meta = document.querySelector('meta[name="theme-color"]');
        const currentContent = meta?.getAttribute('content');
        if (currentContent) return currentContent;
        return document.documentElement?.getAttribute('data-theme') === 'dark' ? '#0a0d14' : '#ffffff';
    }

    _lockThemeColor() {
        if (!(this._isIOSMobile() && this._isNarrowViewport())) return;
        const themeColor = this._getChatThemeChromeColor();
        if (typeof window.lockSiteModalThemeColor === 'function'
            && window.lockSiteModalThemeColor({
                themeColor,
                restoreAttribute: 'data-chat-theme-restore',
                restoreDelayMs: 320
            })) {
            this._themeColorMeta = document.querySelector('meta[name="theme-color"]');
            return;
        }

        const meta = this._ensureThemeColorMeta();
        if (!meta) return;
        if (!meta.hasAttribute('data-chat-theme-restore')) {
            meta.setAttribute('data-chat-theme-restore', meta.getAttribute('content') || '');
        }
        this._themeColorRestoreContent = meta.getAttribute('data-chat-theme-restore') || '';
        meta.setAttribute('content', themeColor);
    }

    _unlockThemeColor() {
        const meta = this._themeColorMeta || document.querySelector('meta[name="theme-color"]');
        if (!meta) return;

        if (!meta.hasAttribute('data-chat-theme-created')
            && typeof window.clearSiteModalThemeColor === 'function'
            && window.clearSiteModalThemeColor({
                restoreAttribute: 'data-chat-theme-restore',
                restoreDelayMs: 320
            })) {
            this._themeColorRestoreContent = '';
            return;
        }

        // Clean up totally if the chat widget created the tag
        if (meta.hasAttribute('data-chat-theme-created')) {
            if (meta.parentNode) meta.parentNode.removeChild(meta);
            this._themeColorMeta = null;
            this._themeColorRestoreContent = '';
            return;
        }

        const restoreContent = meta.getAttribute('data-chat-theme-restore');
        if (restoreContent === null) return;

        // Force Safari iOS 15+ Repaint Hack
        meta.removeAttribute('content');

        setTimeout(() => {
            if (!meta.isConnected) return;
            if (restoreContent === '') {
                meta.removeAttribute('content');
            } else {
                meta.setAttribute('content', restoreContent);
            }
            meta.removeAttribute('data-chat-theme-restore');
            this._themeColorRestoreContent = '';
        }, 50);
    }

    _ensureStatusBarShield() {
        if (this._statusBarShield) return;
        const shield = document.createElement('div');
        shield.className = 'chat-status-bar-shield';
        document.body.appendChild(shield);
        this._statusBarShield = shield;
    }

    _showStatusBarShield() {
        if (!(this._isIOSMobile() && this._isNarrowViewport())) return;
        this._ensureStatusBarShield();
        if (!this._statusBarShield) return;
        this._statusBarShield.classList.add('is-visible');
        this._lockThemeColor();
    }

    _hideStatusBarShield() {
        if (this._statusBarShield) {
            this._statusBarShield.classList.remove('is-visible');
            setTimeout(() => {
                if (!this._statusBarShield || this.isOpen) return;
                this._statusBarShield.classList.remove('is-visible');
            }, 90);
        }
        this._unlockThemeColor();
    }

    _runChatCloseChromeCleanup() {
        if (this._closeChromeCleanupStarted) return;
        this._closeChromeCleanupStarted = true;
        this._hideStatusBarShield();
    }

    _setFabHidden(hidden) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--hidden', hidden);
        if (hidden) {
            this.fab.setAttribute('aria-hidden', 'true');
        } else {
            this.fab.removeAttribute('aria-hidden');
        }
    }

    _setFabDisabled(disabled) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--disabled', disabled);
    }

    _setFabTransitionless(enabled) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--transitionless', enabled);
    }

    _setChatWindowForceHidden(hidden) {
        if (!this.chatWindow) return;
        this.chatWindow.classList.toggle('chat-window--force-hidden', hidden);
    }

    _setChatWindowTransitionless(enabled) {
        if (!this.chatWindow) return;
        this.chatWindow.classList.toggle('chat-window--transitionless', enabled);
    }

    _showChatOverlay() {
        if (!this.overlay) return;

        const alreadyActive = this.overlay.classList.contains('chat-overlay--active')
            || this.overlay.classList.contains('is-active');

        this.overlay.classList.remove('closing');
        this.overlay.classList.add('visible');

        if (alreadyActive) {
            this.overlay.classList.add('chat-overlay--active');
            return;
        }

        this.overlay.classList.remove('chat-overlay--active');
        requestAnimationFrame(() => {
            if (!this.isOpen || !this.overlay?.classList.contains('visible')) return;
            this.overlay.classList.add('chat-overlay--active');
        });
    }

    _setSessionItemHidden(item, hidden) {
        if (!item) return;
        item.classList.toggle('session-item--hidden', hidden);
    }

    _scheduleStableKeyboardInset(bottomInset) {
        if (!Number.isFinite(bottomInset) || bottomInset < 40) return;
        this._pendingStableKeyboardInset = bottomInset;
        this._clearKeyboardSettleTimer();
        this._keyboardSettleTimer = setTimeout(() => {
            this._keyboardSettleTimer = null;
            this._lastStableKeyboardInset = this._pendingStableKeyboardInset;
        }, this._isHighRefreshDisplay ? 110 : 80);
    }

    getSessionId() {
        let sid = localStorage.getItem('chat_session_id');
        if (!sid) {
            sid = 'guest_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('chat_session_id', sid);
        }
        return sid;
    }

    getAuthenticatedSessionId(user) {
        if (!user?.id) return '';
        return `user_${user.id}`;
    }

    getLegacyAuthenticatedSessionIds(user) {
        const rawEmail = typeof user?.email === 'string' ? user.email.trim() : '';
        const normalizedEmail = rawEmail.toLowerCase();
        return [rawEmail, normalizedEmail].filter(Boolean);
    }

    getActiveUserSessionIds() {
        if (Array.isArray(this.userSessionIds) && this.userSessionIds.length > 0) {
            return [...new Set(this.userSessionIds.filter(Boolean))];
        }
        return this.sessionId ? [this.sessionId] : [];
    }

    async refreshUserSessionContext() {
        const { data: { user } } = await this.supabase.auth.getUser();
        this.currentUser = user || null;

        if (user) {
            const primarySessionId = this.getAuthenticatedSessionId(user);
            const restoredSessionIds = this.restoreAuthenticatedUserSessionIds(user);
            this.userSessionIds = [...new Set([
                primarySessionId,
                ...this.getLegacyAuthenticatedSessionIds(user),
                ...restoredSessionIds
            ].filter(Boolean))];
            this.sessionId = primarySessionId;
            this.persistAuthenticatedUserSessionIds(user, this.userSessionIds);
            this.scheduleAuthenticatedUserSessionHydration(user);
            window.ZaoyoeUserPresence?.start?.(this.supabase, {
                user,
                sessionId: primarySessionId,
                sessionIds: this.userSessionIds
            });
            this.syncEngagementNotificationSubscription(user);
            this.syncEngagementDeliverySubscription(user);
            this.syncEngagementUserTagsSubscription(user);
            return { user, sessionId: primarySessionId, sessionIds: this.getActiveUserSessionIds() };
        }

        this.clearAuthenticatedUserSessionHydrationHandle();
        this._authenticatedUserSessionHydrationRequestId += 1;
        const guestSessionId = this.getSessionId();
        this.userSessionIds = [guestSessionId];
        this.sessionId = guestSessionId;
        window.ZaoyoeUserPresence?.start?.(this.supabase, {
            sessionId: guestSessionId,
            sessionIds: [guestSessionId]
        });
        this.syncEngagementNotificationSubscription(null);
        this.syncEngagementDeliverySubscription(null);
        this.syncEngagementUserTagsSubscription(null);
        return { user: null, sessionId: guestSessionId, sessionIds: this.getActiveUserSessionIds() };
    }

    async resolveAdminModeAccess() {
        if (window.adminStudioAccessGranted === true || window.isAdmin === true || window.isSuperAdmin === true) {
            return true;
        }

        const cachedAdminAccess = this.readRecentAdminAccessCache();
        try {
            const access = await window.AdminAccess?.getCurrentAdminAccess?.({ forceRefresh: false });
            if (access?.user && typeof access.isAdmin === 'boolean') {
                if (access.isAdmin) {
                    return true;
                }
                if (!access.cached && !access.error) {
                    return false;
                }
            }

            if (access?.error && cachedAdminAccess?.isAdmin) {
                return true;
            }

            const verifiedAccess = await window.AdminAccess?.getCurrentAdminAccess?.({
                user: access?.user || null,
                forceRefresh: true
            });
            if (verifiedAccess?.user && typeof verifiedAccess.isAdmin === 'boolean') {
                if (verifiedAccess.error && cachedAdminAccess?.isAdmin) {
                    return true;
                }
                if (!verifiedAccess.error) {
                    return Boolean(verifiedAccess.isAdmin);
                }
            }

            if (cachedAdminAccess?.isAdmin) {
                return true;
            }
        } catch (error) {
            if (cachedAdminAccess?.isAdmin) {
                return true;
            }
            console.warn('[ChatWidget] AdminAccess lookup failed:', error);
        }

        try {
            const { data: { user } = {} } = await this.supabase.auth.getUser();
            const userScopedCache = this.readRecentAdminAccessCache(user?.id || '');
            if (userScopedCache?.isAdmin) {
                return true;
            }
        } catch (error) {
            console.warn('[ChatWidget] Failed to compare admin cache with auth user:', error);
        }

        try {
            const access = await window.AdminAccess?.getCurrentAdminAccess?.({ forceRefresh: true });
            if (access?.user && typeof access.isAdmin === 'boolean') {
                if (access.error && cachedAdminAccess?.isAdmin) {
                    return true;
                }
                return Boolean(access.isAdmin);
            }
        } catch (error) {
            console.warn('[ChatWidget] AdminAccess lookup failed:', error);
        }

        try {
            const { data: { user } = {} } = await this.supabase.auth.getUser();
            if (!user) return false;

            const { data: adminFlag, error: adminError } = await this.supabase.rpc('is_admin');
            if (adminError) {
                console.warn('[ChatWidget] Failed to verify admin status:', adminError);
                return false;
            }

            return Boolean(adminFlag);
        } catch (error) {
            console.error('[ChatWidget] Admin status fallback failed:', error);
            return false;
        }
    }

    getAdminPresenceChannelName() {
        return window.ZaoyoeAdminPresence?.channelName || window.AdminAccess?.adminPresenceChannelName || 'zaoyoe-admin-presence';
    }

    startSharedAdminPresence() {
        window.ZaoyoeAdminPresence?.start?.(this.supabase);
    }

    getAdminPresenceLastSeenStorageKey() {
        const site = window.SiteConfig?.site === 'intl' ? 'intl' : 'cn';
        return `${this.adminPresenceLastSeenStorageKey}_${site}`;
    }

    restoreAdminPresenceLastSeenAt() {
        if (this.adminPresenceLastSeenAt && Date.parse(this.adminPresenceLastSeenAt)) {
            return this.adminPresenceLastSeenAt;
        }

        try {
            const stored = String(window.localStorage?.getItem(this.getAdminPresenceLastSeenStorageKey()) || '').trim();
            if (stored && Date.parse(stored)) {
                this.adminPresenceLastSeenAt = stored;
                return stored;
            }
        } catch (_) {
            // localStorage may be unavailable in private or embedded contexts.
        }

        return '';
    }

    rememberAdminPresenceLastSeenAt(timestamp = '') {
        const normalized = String(timestamp || '').trim();
        const nextTime = Date.parse(normalized);
        if (!Number.isFinite(nextTime)) {
            return false;
        }

        const currentTime = Date.parse(this.adminPresenceLastSeenAt || '');
        if (!Number.isFinite(currentTime) || nextTime >= currentTime) {
            this.adminPresenceLastSeenAt = new Date(nextTime).toISOString();
            try {
                window.localStorage?.setItem(this.getAdminPresenceLastSeenStorageKey(), this.adminPresenceLastSeenAt);
            } catch (_) {
                // best-effort cache only
            }
            return true;
        }

        return false;
    }

    getAdminPresenceEntries() {
        if (!this.adminPresenceChannel || typeof this.adminPresenceChannel.presenceState !== 'function') {
            return [];
        }

        const state = this.adminPresenceChannel.presenceState() || {};
        return Object.values(state)
            .flatMap((entries) => Array.isArray(entries) ? entries : [])
            .filter((entry) => String(entry?.role || '') === 'admin');
    }

    getLatestAdminPresenceSeenAt(entries = []) {
        const timestamps = entries
            .map((entry) => String(entry?.last_seen_at || entry?.online_at || '').trim())
            .filter((value) => {
                const time = Date.parse(value);
                return Number.isFinite(time);
            })
            .sort((left, right) => Date.parse(right) - Date.parse(left));

        return timestamps[0] || '';
    }

    applyAdminPresenceStatusFromCache() {
        const statusText = this.chatWindow?.querySelector('.target-admin-status');
        const statusDot = this.chatWindow?.querySelector('.status-dot');
        if (!statusText || !statusDot) {
            return false;
        }

        const lastSeenAt = String(this.adminPresenceLastSeenAt || this.restoreAdminPresenceLastSeenAt() || '').trim();
        const lastSeenTime = Date.parse(lastSeenAt);
        const hasLastSeen = Number.isFinite(lastSeenTime);

        if (this.adminPresenceOnline) {
            statusText.innerText = this.t('chat.adminOnline', '管理员在线');
            statusDot.className = 'status-dot online';
            return true;
        }

        if (!hasLastSeen) {
            return false;
        }

        const diffMinutes = Math.max(0, Math.floor((Date.now() - lastSeenTime) / 60000));
        if (diffMinutes < 1) {
            statusText.innerText = this.t('chat.justNowOnline', '刚刚在线');
            statusDot.className = 'status-dot away';
            return true;
        }

        if (diffMinutes < 60) {
            statusText.innerText = this.t('chat.minutesAgo', '{minutes}分钟前在线').replace('{minutes}', diffMinutes);
            statusDot.className = 'status-dot away';
            return true;
        }

        if (diffMinutes < 1440) {
            const hours = Math.floor(diffMinutes / 60);
            statusText.innerText = this.t('chat.hoursAgo', '{hours}小时前在线').replace('{hours}', hours);
            statusDot.className = 'status-dot away';
            return true;
        }

        statusText.innerText = this.t('chat.adminOffline', '管理员离线');
        statusDot.className = 'status-dot offline';
        return true;
    }

    refreshAdminPresenceSnapshot() {
        const wasOnline = this.adminPresenceOnline;
        const entries = this.getAdminPresenceEntries();
        const hasOnlineAdmin = entries.length > 0;
        const latestSeenAt = this.getLatestAdminPresenceSeenAt(entries);

        this.adminPresenceOnline = hasOnlineAdmin;
        if (latestSeenAt) {
            this.rememberAdminPresenceLastSeenAt(latestSeenAt);
        } else if (hasOnlineAdmin) {
            this.rememberAdminPresenceLastSeenAt(new Date().toISOString());
        } else if (wasOnline) {
            this.rememberAdminPresenceLastSeenAt(new Date().toISOString());
        } else if (this.restoreAdminPresenceLastSeenAt()) {
            // Keep the last observed presence timestamp so a fresh disconnect has a sensible relative label.
        } else {
            this.adminPresenceLastSeenAt = '';
        }

        return this.applyAdminPresenceStatusFromCache();
    }

    subscribeToAdminPresence() {
        if (!this.supabase?.channel) {
            return;
        }

        if (this.adminPresenceChannel && this.supabase.removeChannel) {
            this.supabase.removeChannel(this.adminPresenceChannel);
        }

        if (this.adminPresenceStatusTimer) {
            clearInterval(this.adminPresenceStatusTimer);
            this.adminPresenceStatusTimer = null;
        }

        this.adminPresenceChannel = this.supabase
            .channel(this.getAdminPresenceChannelName())
            .on('presence', { event: 'sync' }, () => {
                this.refreshAdminPresenceSnapshot();
            })
            .on('presence', { event: 'leave' }, (payload = {}) => {
                const leftPresences = Array.isArray(payload.leftPresences) ? payload.leftPresences : [];
                const adminLeft = leftPresences.some((entry) => String(entry?.role || '') === 'admin');
                if (adminLeft) {
                    this.rememberAdminPresenceLastSeenAt(new Date().toISOString());
                }
                this.refreshAdminPresenceSnapshot();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    this.refreshAdminPresenceSnapshot();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    this.adminPresenceOnline = false;
                    this.applyAdminPresenceStatusFromCache();
                }
            });

        this.adminPresenceStatusTimer = setInterval(() => {
            if (this.adminPresenceOnline || this.adminPresenceLastSeenAt) {
                this.applyAdminPresenceStatusFromCache();
            }
        }, 15000);
    }

    getUserPresenceChannelName() {
        return window.ZaoyoeUserPresence?.channelName || window.AdminAccess?.userPresenceChannelName || 'zaoyoe-user-presence';
    }

    getUserPresenceKeysForPayload(payload = {}) {
        const keys = [];
        const pushKey = (prefix, value) => {
            const normalized = String(value || '').trim();
            if (!normalized) return;
            keys.push(`${prefix}:${prefix === 'email' ? normalized.toLowerCase() : normalized}`);
        };

        pushKey('user', payload.user_id || payload.userId);
        pushKey('email', payload.email);
        pushKey('session', payload.session_id || payload.sessionId);
        (Array.isArray(payload.session_ids) ? payload.session_ids : []).forEach((value) => pushKey('session', value));
        return [...new Set(keys)];
    }

    getUserPresenceKeysForSession(session = {}) {
        const keys = [];
        const pushKey = (prefix, value) => {
            const normalized = String(value || '').trim();
            if (!normalized) return;
            keys.push(`${prefix}:${prefix === 'email' ? normalized.toLowerCase() : normalized}`);
        };

        pushKey('user', session.userId || session.profile?.id);
        pushKey('email', session.email || session.profile?.email);
        pushKey('session', session.id);
        (Array.isArray(session.sessionIds) ? session.sessionIds : []).forEach((value) => pushKey('session', value));
        return [...new Set(keys)];
    }

    getUserPresenceStateForSession(session = {}) {
        const keys = this.getUserPresenceKeysForSession(session);
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

    getUserPresenceLabelForSession(session = {}) {
        const presence = this.getUserPresenceStateForSession(session);
        const lastSeenTime = Date.parse(presence.lastSeenAt || '');
        if (presence.online) return '在线';
        if (!Number.isFinite(lastSeenTime)) return '';

        const diffMins = Math.max(1, Math.floor((Date.now() - lastSeenTime) / 60000));
        if (diffMins < 30) return this.t('chat.activeMinutesAgo', '{minutes}分钟前活跃').replace('{minutes}', diffMins);
        if (diffMins < 60) return this.t('chat.minutesAgo', '{minutes}分钟前').replace('{minutes}', diffMins);
        if (diffMins < 1440) return this.t('chat.hoursAgo', '{hours}小时前').replace('{hours}', Math.floor(diffMins / 60));
        return this.t('chat.daysAgo', '{days}天前').replace('{days}', Math.floor(diffMins / 1440));
    }

    applyUserPresenceToAdminSessions() {
        this.sessions = (Array.isArray(this.sessions) ? this.sessions : []).map((session) => {
            if (this.isOpsAlertSession(session)) return session;
            const presence = this.getUserPresenceStateForSession(session);
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
                this.getUserPresenceKeysForPayload(entry).forEach((key) => {
                    const current = nextPresenceByKey.get(key);
                    if (!current || Date.parse(lastSeenAt || 0) >= Date.parse(current.lastSeenAt || 0)) {
                        nextPresenceByKey.set(key, { online: true, lastSeenAt });
                    }
                });
            });

        this.userPresenceByKey = nextPresenceByKey;
        this.applyUserPresenceToAdminSessions();
        this.renderAdminSessionList();
        if (this.currentSessionInfo && !this.isOpsAlertSession(this.currentSessionInfo)) {
            this.renderSelectedSessionPresenceStatus(this.currentSessionInfo);
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
                feature: options.feature || 'chat_widget',
                timeoutMs: options.timeoutMs || 2600,
                channelOptions: options.channelOptions,
                build: buildChannel,
                onActive: options.onActive,
                onDegraded: (reason, detail) => {
                    console.warn(`[ChatWidget] Realtime degraded for ${channelName}; polling/manual refresh remains available:`, reason, detail?.error || '');
                    options.onDegraded?.(reason, detail);
                }
            });
            return subscription?.channel || null;
        }

        try {
            const channel = buildChannel(this.supabase.channel(channelName, options.channelOptions || undefined));
            return channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    options.onActive?.({ reason: 'subscribed' });
                    return;
                }
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    console.warn(`[ChatWidget] Realtime degraded for ${channelName}; polling/manual refresh remains available:`, status);
                    options.onDegraded?.(String(status || '').toLowerCase(), {});
                }
            });
        } catch (error) {
            console.warn(`[ChatWidget] Realtime unavailable for ${channelName}; polling/manual refresh remains available:`, error?.message || error);
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
            (channel) => channel.on('presence', { event: 'sync' }, () => this.refreshUserPresenceSnapshot()),
            {
                feature: 'chat_widget_user_presence',
                onActive: () => this.refreshUserPresenceSnapshot()
            }
        );

        this.userPresenceStatusTimer = setInterval(() => {
            this.renderAdminSessionList();
            if (this.currentSessionInfo && !this.isOpsAlertSession(this.currentSessionInfo)) {
                this.renderSelectedSessionPresenceStatus(this.currentSessionInfo);
            }
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

    applyUserActivityRowsToAdminSessions(rows = [], sessions = this.sessions) {
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
                        this.getUserPresenceKeysForSession(session),
                        lastActiveAt
                    ) || changed;
                });
                return;
            }

            changed = this.upsertUserActivityStateForKeys(
                this.getUserPresenceKeysForPayload(row),
                lastActiveAt
            ) || changed;
        });
        return changed;
    }

    getUserActivityAdminSessionIds(sessions = this.sessions) {
        return [...new Set((Array.isArray(sessions) ? sessions : [])
            .filter((session) => !this.isOpsAlertSession(session))
            .map((session) => String(session?.userId || session?.profile?.id || '').trim())
            .filter(Boolean))];
    }

    async fetchUserActivityRowsForAdminSessions(sessions = this.sessions) {
        const userIds = this.getUserActivityAdminSessionIds(sessions);
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
            console.warn('[ChatWidget] Failed to fetch user activity heartbeats:', error);
            return [];
        }
    }

    renderUserActivityAdminStatusRefresh() {
        this.applyUserPresenceToAdminSessions();
        if (this.currentSessionKey) {
            const nextCurrentSession = (Array.isArray(this.sessions) ? this.sessions : [])
                .find((session) => session.id === this.currentSessionKey) || null;
            if (nextCurrentSession) {
                this.currentSessionInfo = nextCurrentSession;
            }
        }
        this.renderAdminSessionList();
        if (this.currentSessionInfo && !this.isOpsAlertSession(this.currentSessionInfo)) {
            this.renderSelectedSessionPresenceStatus(this.currentSessionInfo);
        }
    }

    async refreshUserActivityForAdminSessions(sessions = this.sessions, { render = false } = {}) {
        const rows = await this.fetchUserActivityRowsForAdminSessions(sessions);
        const changed = this.applyUserActivityRowsToAdminSessions(rows, sessions);
        if (changed && render) {
            this.renderUserActivityAdminStatusRefresh();
        }
        return rows;
    }

    handleUserActivityRealtime(row = {}) {
        if (!row || !this.isUserActivityRowInScope(row)) return;
        const changed = this.applyUserActivityRowsToAdminSessions([row], this.sessions);
        if (changed) {
            this.renderUserActivityAdminStatusRefresh();
        }
    }

    subscribeToUserActivity() {
        if (!this.supabase?.from) {
            return;
        }

        if (this.supabase?.channel && !this.userActivityChannel) {
            this.userActivityChannel = this.createRealtimeSubscription(
                `chat-widget-user-activity-${Date.now()}`,
                (channel) => channel
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'engagement_user_activity' }, (payload) => {
                    this.handleUserActivityRealtime(payload.new);
                })
                    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'engagement_user_activity' }, (payload) => {
                    this.handleUserActivityRealtime(payload.new);
                }),
                { feature: 'chat_widget_user_activity' }
            );
        }

        if (!this.userActivityRefreshTimer) {
            this.userActivityRefreshTimer = setInterval(() => {
                void this.refreshUserActivityForAdminSessions(this.sessions, { render: true });
            }, 30000);
            void this.refreshUserActivityForAdminSessions(this.sessions, { render: true });
        }
    }

    async init() {
        this.renderFAB();
        this.bindFabEvents();
        this._scheduleFabAmbientMotion();

        const isAdmin = await this.resolveAdminModeAccess();
        window.isAdmin = isAdmin;

        if (isAdmin) {
            this.startSharedAdminPresence();
            this.renderAdminMode();

            // Listen for language changes and update text
            window.addEventListener('languageChanged', () => {
                if (this.isAdmin && this.chatWindow) {
                    this.updateAdminModeText();
                }
            });
        } else {
            try {
                await this.refreshUserSessionContext();
            } catch (e) { console.error('Failed to get user for session:', e); }

            this.renderUserMode();
            window.addEventListener('languageChanged', () => {
                if (!this.isAdmin && this.chatWindow) {
                    const titleEl = this.chatWindow.querySelector('.chat-title h3');
                    if (titleEl) {
                        titleEl.textContent = this.t('chat.onlineSupport', '在线客服');
                    }
                    const currentView = this.supportView?.type || 'root';
                    if (currentView === 'menu' && this.supportView?.id) {
                        this.renderSupportMenuPanel(this.supportView.id);
                    } else if (currentView === 'chat') {
                        this.syncSupportShellState();
                    } else if (currentView === 'action' && this.supportView?.id) {
                        const action = this.getSupportAction(this.supportView.id);
                        if (action?.mode === 'static' || action?.mode === 'link') {
                            this.renderSupportStaticPanel(this.supportView.id);
                        } else if (action?.mode === 'ticket_history') {
                            this.renderSupportTicketHistoryPanel();
                        } else {
                            this.renderSupportActionPanel(this.supportView.id);
                        }
                    } else if (currentView === 'root' && this.supportDisplayMode === 'support') {
                        this.renderSupportRootPanel();
                    } else {
                        this.syncSupportShellState();
                    }
                }
            });
            this.subscribeToMessages();
            this.subscribeToAdminPresence();
            this.loadHistory();
            this.checkAdminStatus();
            setInterval(() => this.checkAdminStatus(), 60000);
        }

        this.bindAdminRoleAuthListener();
        this.initEngagementRuntime();
    }

    /**
     * Bind a Supabase auth state listener that detects when the
     * signed-in user transitions between regular-user and admin roles.
     *
     * The chat widget renders either the user-facing chat or the admin
     * console based on a one-time admin-access check in init(). When a
     * user signs in to an admin account from the public page, that check
     * never re-runs, so the widget keeps showing the user shell until a
     * full page refresh. This listener bridges that gap by reloading the
     * widget once the role changes.
     */
    bindAdminRoleAuthListener() {
        if (this.adminRoleAuthSubscription || !this.supabase?.auth?.onAuthStateChange) {
            return;
        }

        try {
            const { data } = this.supabase.auth.onAuthStateChange((event, session) => {
                // INITIAL_SESSION fires on every page load; ignore it so we don't
                // race the initial init() decision. TOKEN_REFRESHED / USER_UPDATED
                // don't change the user identity, so they cannot change role.
                if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') {
                    return;
                }

                void this.handleAdminRoleAuthChange(event, session).catch((error) => {
                    console.warn(
                        '[ChatWidget] Failed to handle admin role auth change:',
                        error?.message || error
                    );
                });
            });
            this.adminRoleAuthSubscription = data?.subscription || null;
        } catch (error) {
            console.warn(
                '[ChatWidget] Failed to bind admin role auth state listener:',
                error?.message || error
            );
        }
    }

    /**
     * Re-evaluate admin access after a sign-in / sign-out event and, if the
     * effective role does not match the currently rendered widget mode,
     * tear down the existing chat widget and rebuild it via the bootstrap
     * loader so it boots in the correct mode. This avoids the manual page
     * refresh that used to be required after logging in to an admin
     * account, without disturbing the rest of the page (hero animations,
     * scroll position, other widgets, etc.).
     */
    async handleAdminRoleAuthChange(event /* , session */) {
        // Mirror the SIGNED_OUT init guard from supabase-auth-functions.js:
        // Supabase can spuriously fire SIGNED_OUT during the first few seconds
        // after page load (e.g., when _getUser() fails due to CORS on a custom
        // domain) even though the session is still valid. Reinitializing on
        // that false signal would cause unwanted widget churn, so ignore
        // early SIGNED_OUT events here as well.
        if (event === 'SIGNED_OUT' && typeof window !== 'undefined') {
            const pageLoadTime = Number(window._pageLoadTime || 0);
            if (pageLoadTime > 0 && (Date.now() - pageLoadTime) < 5000) {
                return;
            }
        }

        const reinitToken = (this._adminRoleReinitToken = (this._adminRoleReinitToken || 0) + 1);

        const wasAdmin = Boolean(this.isAdmin);
        let isAdminNow = false;

        if (event === 'SIGNED_OUT') {
            isAdminNow = false;
        } else {
            // SIGNED_IN: fetch fresh access info; AdminAccess writes the
            // session-storage cache that the bootstrap loader consults
            // when picking the initial shell skeleton.
            try {
                if (window.AdminAccess?.getCurrentAdminAccess) {
                    const access = await window.AdminAccess.getCurrentAdminAccess({
                        forceRefresh: true
                    });
                    isAdminNow = Boolean(access?.isAdmin);
                } else if (typeof this.resolveAdminModeAccess === 'function') {
                    isAdminNow = await this.resolveAdminModeAccess();
                }
            } catch (error) {
                console.warn(
                    '[ChatWidget] Failed to resolve admin access after sign-in:',
                    error?.message || error
                );
                // Fall back to current state so we don't churn the widget
                // when admin access verification is temporarily unavailable.
                isAdminNow = wasAdmin;
            }
        }

        if (isAdminNow === wasAdmin) {
            return;
        }
        // Persist the target shell mode so any future page load (and the
        // recreated widget's own bootstrap-shell handoff) starts in the
        // correct skeleton.
        try {
            this.persistBootstrapShellMode(isAdminNow ? 'admin' : 'user');
        } catch (error) {
            console.warn(
                '[ChatWidget] Failed to persist bootstrap shell mode before reinit:',
                error?.message || error
            );
        }

        this._adminRoleReinitScheduled = true;

        // Delay slightly so other auth handlers (UI updates, presence sync,
        // remembered-email persistence in supabase-auth-functions.js) can
        // finish before we tear the widget down.
        const reinitDelayMs = 250;
        const scheduleReinit = () => {
            if (this._adminRoleReinitToken !== reinitToken) {
                return;
            }
            try {
                this.reinitializeChatWidget();
            } catch (error) {
                console.warn(
                    '[ChatWidget] Failed to reinitialize chat widget after admin role change:',
                    error?.message || error
                );
            }
        };

        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
            window.setTimeout(scheduleReinit, reinitDelayMs);
        } else {
            scheduleReinit();
        }
    }

    /**
     * Tear down the current chat widget instance and ask the shared
     * bootstrap loader to recreate it. This rebuilds only the chat widget;
     * the rest of the page (hero animations, scroll position, other
     * components) keeps its state.
     */
    reinitializeChatWidget() {
        const bootstrap = (typeof window !== 'undefined' && window.ZaoyoeChatWidgetBootstrap) || null;

        this._teardownForReinit();

        if (typeof window !== 'undefined') {
            try {
                if (window.chatWidget === this) {
                    window.chatWidget = null;
                }
            } catch (_) {
                // ignore inability to clear the global handle
            }
        }

        if (bootstrap && typeof bootstrap.warm === 'function') {
            try {
                const warmResult = bootstrap.warm();
                if (warmResult && typeof warmResult.catch === 'function') {
                    warmResult.catch((error) => {
                        console.warn(
                            '[ChatWidget] Failed to warm chat widget after admin role change:',
                            error?.message || error
                        );
                    });
                }
            } catch (error) {
                console.warn(
                    '[ChatWidget] Failed to invoke ZaoyoeChatWidgetBootstrap.warm after admin role change:',
                    error?.message || error
                );
            }
        }
    }

    /**
     * Best-effort cleanup of resources held by this widget instance so
     * it can be replaced in place without leaking realtime channels,
     * timers, or DOM nodes. Anything we miss will be garbage-collected
     * with the dropped instance reference once window.chatWidget is
     * reassigned.
     */
    _teardownForReinit() {
        // Stop ambient FAB motion before we drop the FAB element.
        try {
            this._clearFabAmbientMotionTimers?.();
        } catch (_) {
            // ignore best-effort timer cleanup
        }

        // Stop shared admin / user presence so the next widget instance
        // can claim a fresh tab key cleanly.
        try {
            window?.ZaoyoeAdminPresence?.stop?.();
        } catch (_) {
            // ignore best-effort presence cleanup
        }
        try {
            window?.ZaoyoeUserPresence?.stop?.();
        } catch (_) {
            // ignore best-effort presence cleanup
        }

        // Unsubscribe Supabase realtime channels we own.
        const channelKeys = [
            'adminMessageChannel',
            'adminOpsAlertChannel',
            'adminTicketChannel',
            'adminPaymentChannel',
            'adminVerificationChannel',
            'adminPresenceChannel',
            'userPresenceChannel',
            'userMessageChannel',
            'userActivityChannel',
            'engagementNotificationChannel',
            'engagementDeliveryChannel',
            'engagementUserTagsChannel',
            'engagementFeedBroadcastChannel',
            'engagementFeedInvalidationsChannel'
        ];
        for (const key of channelKeys) {
            const channel = this[key];
            if (channel && this.supabase?.removeChannel) {
                try {
                    this.supabase.removeChannel(channel);
                } catch (_) {
                    // ignore best-effort channel cleanup
                }
            }
            this[key] = null;
        }

        // Unsubscribe Supabase auth state listeners owned by this instance.
        try {
            this.engagementAuthSubscription?.unsubscribe?.();
        } catch (_) {
            // ignore best-effort unsubscribe
        }
        this.engagementAuthSubscription = null;

        try {
            this.adminRoleAuthSubscription?.unsubscribe?.();
        } catch (_) {
            // ignore best-effort unsubscribe
        }
        this.adminRoleAuthSubscription = null;

        // Clear repeating timers we know about.
        const timerKeys = [
            'adminPresenceStatusTimer',
            'userPresenceStatusTimer',
            'userActivityRefreshTimer',
            'engagementNotificationRefreshTimer',
            'engagementUserTagsRefreshTimer',
            'engagementFeedBroadcastRefreshTimer',
            'engagementFeedInvalidationsRefreshTimer',
            'engagementScheduledRuleRefreshTimer',
            'engagementRefreshTimer',
            'engagementConditionEvaluationTimer',
            'engagementTimeTriggerTimer',
            'engagementPendingFlushTimer',
            'adminOpsAlertPollTimer',
            'adminSessionSlaTimer',
            '_adminSessionHydrationTimer',
            '_sessionLoadingOverlayTimer',
            '_fabAmbientPeekTimer',
            '_fabAmbientReturnTimer',
            '_fabAmbientResumeTimer',
            '_keyboardSettleTimer',
            '_userComposerInteractionUnlockTimer',
            '_userComposerUnlockTimer',
            '_userComposerSkeletonRemoveTimer',
            '_bootstrapContentSettleTimer',
            '_motionVisualLockTimer',
            '_transitionCleanupTimer',
            '_openingAnimationTimer',
            '_closingAnimationTimer',
            '_viewportThrottleTimer',
            '_pendingUndockTimer',
            '_pendingFirstDockTimer'
        ];
        for (const key of timerKeys) {
            const handle = this[key];
            if (handle != null) {
                try { clearTimeout(handle); } catch (_) { /* not a timeout */ }
                try { clearInterval(handle); } catch (_) { /* not an interval */ }
                this[key] = null;
            }
        }

        // Drop DOM nodes owned by this widget. We also sweep any stale
        // siblings that earlier renders may have left behind so the next
        // bootstrap pass starts from a clean slate.
        try { this.chatWindow?.remove(); } catch (_) { /* ignore */ }
        this.chatWindow = null;

        try { this.overlay?.remove(); } catch (_) { /* ignore */ }
        this.overlay = null;

        try { this.fab?.remove(); } catch (_) { /* ignore */ }
        this.fab = null;

        if (typeof document !== 'undefined') {
            const selectors = [
                '.chat-window',
                '.chat-overlay',
                '.chat-widget-fab',
                '.chat-widget-bootstrap-overlay'
            ];
            for (const selector of selectors) {
                try {
                    document.querySelectorAll(selector).forEach((node) => {
                        try { node.remove(); } catch (_) { /* ignore */ }
                    });
                } catch (_) {
                    // ignore best-effort DOM sweep
                }
            }
        }

        this.isOpen = false;
        this._chatWidgetReady = false;
        this._pendingOpenAfterInit = false;

        if (typeof window !== 'undefined') {
            window.adminStudioAccessGranted = false;
            window.isAdmin = false;
            window.isSuperAdmin = false;
            window.__ZAOYOE_ADMIN_MODE_HINT__ = 'user';
        }
    }

    async checkAdminStatus() {
        try {
            if (this.adminPresenceOnline && this.applyAdminPresenceStatusFromCache()) {
                return;
            }

            const sessionIds = this.getActiveUserSessionIds();
            if (!sessionIds.length) {
                this.unlockScroll();
                return;
            }

            // Find the latest message from an admin
            let query = this.supabase
                .from('chat_messages')
                .select('created_at')
                .eq('is_admin', true)
                .order('created_at', { ascending: false })
                .limit(1);
            query = this.queryForCurrentSite(query, this.getCurrentSite());

            query = sessionIds.length === 1
                ? query.eq('session_id', sessionIds[0])
                : query.in('session_id', sessionIds);

            const { data, error } = await query.single();

            const statusText = this.chatWindow.querySelector('.target-admin-status');
            const statusDot = this.chatWindow.querySelector('.status-dot');

            if (!statusText || !statusDot) return;

            const presenceLastSeenTime = Date.parse(this.adminPresenceLastSeenAt || '');
            if ((error || !data) && !Number.isFinite(presenceLastSeenTime)) {
                statusText.innerText = this.t('chat.adminOffline', '管理员离线');
                statusDot.className = "status-dot offline";
                return;
            }

            const messageLastSeenTime = Date.parse(data?.created_at || '');
            const lastActiveTime = Math.max(
                Number.isFinite(messageLastSeenTime) ? messageLastSeenTime : 0,
                Number.isFinite(presenceLastSeenTime) ? presenceLastSeenTime : 0
            );
            const lastActive = new Date(lastActiveTime);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastActive) / (1000 * 60));

            if (this.adminPresenceOnline) {
                statusText.innerText = this.t('chat.adminOnline', '管理员在线');
                statusDot.className = "status-dot online";
            } else if (diffMinutes < 1) {
                statusText.innerText = this.t('chat.justNowOnline', '刚刚在线');
                statusDot.className = "status-dot away";
            } else if (diffMinutes < 60) {
                statusText.innerText = this.t('chat.minutesAgo', '{minutes}分钟前在线').replace('{minutes}', diffMinutes);
                statusDot.className = "status-dot away";
            } else if (diffMinutes < 1440) {
                const hours = Math.floor(diffMinutes / 60);
                statusText.innerText = this.t('chat.hoursAgo', '{hours}小时前在线').replace('{hours}', hours);
                statusDot.className = "status-dot away";
            } else {
                statusText.innerText = this.t('chat.adminOffline', '管理员离线');
                statusDot.className = "status-dot offline";
            }

        } catch (err) {
            console.error('Error checking admin status:', err);
        }
    }

    claimBootstrapShell(mode = 'user') {
        const shell = document.querySelector('.chat-window[data-chat-widget-bootstrap-shell="1"]');
        if (!shell) {
            return null;
        }

        const normalizedMode = mode === 'admin' ? 'admin' : 'user';
        shell.dataset.chatWidgetBootstrapAdopted = '1';
        shell.dataset.chatWidgetBootstrapAdoptedMode = normalizedMode;
        shell.removeAttribute('role');
        shell.removeAttribute('aria-live');
        shell.removeAttribute('aria-label');
        shell.classList.add(
            'chat-window',
            'chat-window--bootstrap-adopting-content',
            'chat-window--bootstrap-interaction-locked'
        );
        shell.classList.remove('chat-window--bootstrap-content-ready');
        shell.classList.toggle('admin-mode-layout', normalizedMode === 'admin');
        shell.classList.remove('admin-mode-layout--narrow');
        shell.classList.remove('chat-widget-bootstrap-shell--desktop-edge-safe');
        shell.classList.toggle('chat-widget-bootstrap-shell--admin', normalizedMode === 'admin');
        shell.classList.toggle('chat-widget-bootstrap-shell--user', normalizedMode !== 'admin');
        return shell;
    }

    claimBootstrapOverlay(mode = 'user') {
        const overlay = document.querySelector('.chat-widget-bootstrap-overlay');
        if (!overlay) {
            return null;
        }

        const normalizedMode = mode === 'admin' ? 'admin' : 'user';
        overlay.dataset.chatWidgetBootstrapAdopted = '1';
        overlay.removeAttribute('aria-hidden');
        overlay.classList.add('chat-overlay');
        overlay.classList.toggle('chat-overlay--user', normalizedMode !== 'admin');
        overlay.classList.toggle('chat-overlay--admin', normalizedMode === 'admin');
        return overlay;
    }

    isBootstrapShellAdopted() {
        return this.chatWindow?.dataset?.chatWidgetBootstrapAdopted === '1'
            && this.chatWindow?.hasAttribute('data-chat-widget-bootstrap-shell');
    }

    getBootstrapContentSnapshotMarkup(shell = this.chatWindow) {
        if (shell?.dataset?.chatWidgetBootstrapAdopted !== '1') {
            return '';
        }

        const snapshotHtml = String(shell.innerHTML || '').trim();
        if (!snapshotHtml) {
            return '';
        }

        return `<div class="chat-bootstrap-content-snapshot" aria-hidden="true">${snapshotHtml}</div>`;
    }

    removeBootstrapContentSnapshot() {
        this.chatWindow?.querySelectorAll('.chat-bootstrap-content-snapshot').forEach((snapshot) => {
            snapshot.remove();
        });
    }

    getChatLoadingDotsMarkup(label = '', extraClass = '') {
        const loadingLabel = this.escapeHtml(String(label || this.t('chat.loading', '加载中...')));
        const normalizedExtraClass = String(extraClass || '')
            .split(/\s+/)
            .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
            .join(' ');
        const stateClass = `chat-loading-state${normalizedExtraClass ? ` ${normalizedExtraClass}` : ''}`;
        return `
            <div class="${stateClass}" role="status" aria-label="${loadingLabel}">
                <span class="chat-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>
            </div>
        `;
    }

    getChatInlineLoadingDotsMarkup(label = '') {
        const loadingLabel = this.escapeHtml(String(label || this.t('chat.loading', '加载中...')));
        return `
            <span class="chat-loading-dots chat-loading-dots--inline" aria-hidden="true"><span></span><span></span><span></span></span>
            <span class="chat-loading-dots__label">${loadingLabel}</span>
        `;
    }

    getUserInitialMessagesMarkup({ loading = false } = {}) {
        if (loading) {
            return this.getChatLoadingDotsMarkup(
                this.t('chat.loading', '加载中...'),
                'chat-loading-state--user-handoff'
            );
        }

        return `
            <!-- Welcome Message -->
            <div class="message admin">
                ${this.t('chat.welcomeMessage', '您好！有什么可以帮您的吗？')}
            </div>
        `;
    }

    clearUserComposerHandoffTimers() {
        if (this._userComposerUnlockTimer) {
            clearTimeout(this._userComposerUnlockTimer);
            this._userComposerUnlockTimer = null;
        }
        if (this._userComposerSkeletonRemoveTimer) {
            clearTimeout(this._userComposerSkeletonRemoveTimer);
            this._userComposerSkeletonRemoveTimer = null;
        }
        if (this._userComposerInteractionUnlockTimer) {
            clearTimeout(this._userComposerInteractionUnlockTimer);
            this._userComposerInteractionUnlockTimer = null;
        }
    }

    holdUserHistoryComposerHandoff() {
        if (this.isAdmin || !this.chatWindow) return;

        this.clearUserComposerHandoffTimers();
        this._userHistoryComposerHandoffHeld = true;
        this._closeEmojiPicker();

        this.chatWindow.querySelectorAll('.chat-input-handoff-skeleton').forEach((legacySkeleton) => {
            legacySkeleton.remove();
        });

        this.chatWindow.classList.add('chat-window--bootstrap-interaction-locked');
        this._ignoreEmojiClicksUntil = Date.now() + 760;
    }

    finishUserComposerHandoffRelease(releaseDelay = 0) {
        if (!this.chatWindow) return;

        if (releaseDelay > 0) {
            this._ignoreEmojiClicksUntil = Date.now() + releaseDelay + 260;
            if (this._userComposerInteractionUnlockTimer) {
                clearTimeout(this._userComposerInteractionUnlockTimer);
            }
            this._userComposerInteractionUnlockTimer = setTimeout(() => {
                this._userComposerInteractionUnlockTimer = null;
                if (this._userHistoryComposerHandoffHeld) return;
                this.chatWindow?.classList.remove('chat-window--bootstrap-interaction-locked');
            }, releaseDelay);
            return;
        }

        if (!this._userHistoryComposerHandoffHeld) {
            this.chatWindow.classList.remove('chat-window--bootstrap-interaction-locked');
        }
        this._ignoreEmojiClicksUntil = Date.now() + 220;
    }

    releaseUserHistoryComposerHandoff() {
        if (this.isAdmin || !this.chatWindow) return;
        if (!this._userHistoryComposerHandoffHeld) return;

        this._userHistoryComposerHandoffHeld = false;
        const releaseDelay = this.releaseUserBootstrapComposer();
        this.finishUserComposerHandoffRelease(releaseDelay);
    }

    finishUserHistoryLoadHandoff() {
        if (this.isBootstrapShellAdopted()) {
            this._userHistoryComposerHandoffHeld = false;
            if (!this.isBootstrapContentSettleInFlight()) {
                this.scheduleBootstrapAdoptedContentSettle();
            }
            return;
        }

        this.releaseUserHistoryComposerHandoff();
    }

    isBootstrapContentSettleInFlight() {
        return Boolean(
            this._bootstrapContentSettleFrame
            || this._bootstrapContentSettleTimer
            || this.chatWindow?.classList.contains('chat-window--bootstrap-content-ready')
        );
    }

    scheduleBootstrapAdoptedContentSettle() {
        if (!this.isBootstrapShellAdopted()) {
            return;
        }

        if (this._bootstrapContentSettleTimer) {
            clearTimeout(this._bootstrapContentSettleTimer);
            this._bootstrapContentSettleTimer = null;
        }
        if (this._bootstrapContentSettleFrame) {
            cancelAnimationFrame(this._bootstrapContentSettleFrame);
            this._bootstrapContentSettleFrame = null;
        }

        this.chatWindow.classList.add(
            'chat-window--bootstrap-adopting-content',
            'chat-window--bootstrap-interaction-locked'
        );
        this.chatWindow.classList.remove('chat-window--bootstrap-content-ready');
        this._closeEmojiPicker();
        this._ignoreEmojiClicksUntil = Date.now() + 760;

        const contentSettleDelayMs = 420;
        this._bootstrapContentSettleFrame = requestAnimationFrame(() => {
            this._bootstrapContentSettleFrame = null;
            if (!this.chatWindow) return;
            this.chatWindow.classList.add('chat-window--bootstrap-content-ready');
            this._bootstrapContentSettleTimer = setTimeout(() => {
                this._bootstrapContentSettleTimer = null;
                this.chatWindow?.classList.remove(
                    'chat-window--bootstrap-adopting-content',
                    'chat-window--bootstrap-content-ready'
                );
                this.removeBootstrapContentSnapshot();
                if (this._userHistoryComposerHandoffHeld) {
                    this._ignoreEmojiClicksUntil = Date.now() + 760;
                    return;
                }
                const composerReleaseDelay = this.releaseUserBootstrapComposer();
                this.finishUserComposerHandoffRelease(composerReleaseDelay);
                if (this.isBootstrapShellAdopted()) {
                    this.completeBootstrapShellAdoption();
                }
            }, contentSettleDelayMs);
        });
    }

    releaseUserBootstrapComposer() {
        if (this.isAdmin || !this.chatWindow) return 0;

        const inputArea = this.chatWindow.querySelector('.chat-input-area');
        const legacySkeleton = this.chatWindow.querySelector('.chat-input-handoff-skeleton');

        this.clearUserComposerHandoffTimers();
        this._closeEmojiPicker();

        if (inputArea) {
            inputArea.removeAttribute('inert');
            inputArea.removeAttribute('aria-hidden');
        }

        if (legacySkeleton) {
            legacySkeleton.remove();
        }

        return 0;
    }

    completeBootstrapShellAdoption() {
        if (this.chatWindow?.dataset?.chatWidgetBootstrapAdopted === '1') {
            this.chatWindow.classList.remove(
                'chat-widget-bootstrap-shell',
                'chat-widget-bootstrap-shell--admin',
                'chat-widget-bootstrap-shell--user',
                'is-visible',
                'is-active',
                'is-handoff'
            );
            this.chatWindow.classList.toggle('admin-mode-layout', Boolean(this.isAdmin));
            this.chatWindow.classList.remove('admin-mode-layout--narrow');
            this.chatWindow.removeAttribute('data-chat-widget-bootstrap-shell');
            this.chatWindow.removeAttribute('data-chat-widget-bootstrap-adopted');
            this.chatWindow.removeAttribute('data-chat-widget-bootstrap-adopted-mode');
            delete this.chatWindow.dataset.chatWidgetBootstrapMode;
        }

        if (this.overlay?.dataset?.chatWidgetBootstrapAdopted === '1') {
            this.overlay.classList.add('chat-overlay', 'visible', 'chat-overlay--active');
            this.overlay.classList.remove(
                'chat-widget-bootstrap-overlay',
                'chat-widget-bootstrap-overlay--admin',
                'chat-widget-bootstrap-overlay--user',
                'is-visible',
                'is-active',
                'is-handoff'
            );
            this.overlay.removeAttribute('data-chat-widget-bootstrap-adopted');
        }

        if (this.isAdmin) {
            this.syncAdminResponsiveLayout({ force: true });
        } else {
            this._adminResponsiveNarrow = false;
        }
    }

    renderFAB() {
        const existingPlaceholder = document.querySelector('.chat-widget-fab[data-chat-widget-placeholder="1"]');
        if (existingPlaceholder) {
            const wasSuppressed = existingPlaceholder.dataset.chatWidgetPlaceholderSuppressed === '1';
            const wasOpening = existingPlaceholder.dataset.chatWidgetPlaceholderOpening === '1';
            const shouldKeepHiddenForBootstrap = wasSuppressed || wasOpening;
            const reusedFab = existingPlaceholder.cloneNode(true);
            reusedFab.removeAttribute('data-chat-widget-placeholder');
            reusedFab.removeAttribute('data-chat-widget-loading');
            reusedFab.removeAttribute('data-chat-widget-placeholder-opening');
            reusedFab.removeAttribute('data-chat-widget-placeholder-suppressed');
            reusedFab.removeAttribute('aria-busy');
            reusedFab.removeAttribute('aria-hidden');
            reusedFab.classList.toggle('chat-widget-fab--hidden', shouldKeepHiddenForBootstrap);
            reusedFab.classList.toggle('chat-widget-fab--disabled', shouldKeepHiddenForBootstrap);
            if (shouldKeepHiddenForBootstrap) {
                reusedFab.setAttribute('aria-hidden', 'true');
            } else {
                reusedFab.classList.remove('chat-widget-fab--ambient-retracted');
                reusedFab.removeAttribute('aria-hidden');
            }
            reusedFab.setAttribute('aria-label', this.t('chat.openChat', '打开支持助手'));
            existingPlaceholder.replaceWith(reusedFab);
            this.fab = reusedFab;
            return;
        }

        // Create FAB with Custom Mascot (CSS Art)
        this.fab = document.createElement('div');
        this.fab.className = 'chat-widget-fab chat-widget-fab--peek';
        this.fab.setAttribute('role', 'button');
        this.fab.setAttribute('tabindex', '0');
        this.fab.setAttribute('aria-label', this.t('chat.openChat', '打开支持助手'));
        this.fab.innerHTML = `
            <div class="chat-widget-fab__robot" aria-hidden="true">
                <span class="chat-widget-fab__glow"></span>
                <div class="mascot-wrapper">
                    <div class="mascot-head">
                        <div class="mascot-face">
                            <div class="mascot-eyes">
                                <span class="eye left"></span>
                                <span class="eye right"></span>
                            </div>
                            <div class="mascot-mouth"></div>
                        </div>
                    </div>
                </div>
            </div>
            <span class="chat-widget-fab__shadow" aria-hidden="true"></span>
        `;
        document.body.appendChild(this.fab);
    }

    bindFabEvents() {
        this.fab.addEventListener('mouseenter', () => {
            this._fabHovering = true;
            this._pauseFabAmbientMotion();
        });

        this.fab.addEventListener('mouseleave', () => {
            this._fabHovering = false;
            this._scheduleFabAmbientMotion();
        });

        if (!this._onFabAmbientViewportChange) {
            this._onFabAmbientViewportChange = () => {
                this._syncDesktopViewportInsetMode();
                if (this._fabHovering) {
                    this._pauseFabAmbientMotion();
                } else {
                    this._scheduleFabAmbientMotion(9000);
                }
            };
            window.addEventListener('resize', this._onFabAmbientViewportChange);
        }

        this.fab.addEventListener('click', () => {
            this.openChat().then(() => this.clearUnread()).catch((error) => {
                console.error('[ChatWidget] Failed to open chat:', error);
            });
        });

        this.fab.addEventListener('keydown', (event) => {
            const key = String(event.key || '');
            if (key !== 'Enter' && key !== ' ') {
                return;
            }
            event.preventDefault();
            this.openChat().then(() => this.clearUnread()).catch((error) => {
                console.error('[ChatWidget] Failed to open chat:', error);
            });
        });
    }

    _clearFabAmbientMotionTimers() {
        if (this._fabAmbientPeekTimer) {
            clearTimeout(this._fabAmbientPeekTimer);
            this._fabAmbientPeekTimer = null;
        }
        if (this._fabAmbientReturnTimer) {
            clearTimeout(this._fabAmbientReturnTimer);
            this._fabAmbientReturnTimer = null;
        }
        if (this._fabAmbientResumeTimer) {
            clearTimeout(this._fabAmbientResumeTimer);
            this._fabAmbientResumeTimer = null;
        }
    }

    _setFabAmbientRetracted(retracted) {
        if (!this.fab) return;
        this.fab.classList.toggle('chat-widget-fab--ambient-retracted', Boolean(retracted));
    }

    _shouldRunFabAmbientMotion() {
        if (!this.fab || this.isOpen) return false;
        if (this._fabHovering) return false;
        if (this.fab.classList.contains('chat-widget-fab--hidden')) return false;
        if (this.fab.classList.contains('chat-widget-fab--disabled')) return false;
        if (this.fab.classList.contains('has-new-message')) return false;
        if (this.fab.classList.contains('wiggle')) return false;
        if (this.fab.querySelector('.message-preview')) return false;
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false;
        if (this._isNarrowViewport()) return false;
        return true;
    }

    _scheduleFabAmbientMotion(delayMs = null) {
        this._clearFabAmbientMotionTimers();

        if (!this._shouldRunFabAmbientMotion()) return;

        const delay = Number.isFinite(delayMs) ? delayMs : 4000 + Math.round(Math.random() * 4000);
        this._fabAmbientPeekTimer = setTimeout(() => {
            this._fabAmbientPeekTimer = null;

            if (!this._shouldRunFabAmbientMotion()) {
                this._setFabAmbientRetracted(true);
                return;
            }

            this._setFabAmbientRetracted(false);
            this._fabAmbientReturnTimer = setTimeout(() => {
                this._fabAmbientReturnTimer = null;
                this._setFabAmbientRetracted(true);
                this._scheduleFabAmbientMotion();
            }, 4200 + Math.round(Math.random() * 1600));
        }, delay);
    }

    _pauseFabAmbientMotion(resumeDelayMs = null, keepExposed = false) {
        this._clearFabAmbientMotionTimers();
        this._setFabAmbientRetracted(!keepExposed);

        if (!Number.isFinite(resumeDelayMs) || resumeDelayMs < 0) return;

        this._fabAmbientResumeTimer = setTimeout(() => {
            this._fabAmbientResumeTimer = null;
            this._scheduleFabAmbientMotion();
        }, resumeDelayMs);
    }

    // ===== Engagement Robot Bubble Runtime =====

    clearEngagementNotificationRefreshTimer() {
        if (this.engagementNotificationRefreshTimer) {
            window.clearTimeout(this.engagementNotificationRefreshTimer);
            this.engagementNotificationRefreshTimer = null;
        }
    }

    stopEngagementNotificationSubscription() {
        this.clearEngagementNotificationRefreshTimer();
        if (this.engagementNotificationChannel && this.supabase?.removeChannel) {
            try {
                this.supabase.removeChannel(this.engagementNotificationChannel);
            } catch (error) {
                console.warn('[ChatWidget] Failed to remove engagement notification channel:', error?.message || error);
            }
        }
        this.engagementNotificationChannel = null;
        this.engagementNotificationChannelUserId = '';
    }

    syncEngagementNotificationSubscription(user = this.currentUser) {
        const userId = String(user?.id || '').trim();
        if (this.engagementNotificationChannelUserId === userId && this.engagementNotificationChannel) {
            return;
        }

        this.stopEngagementNotificationSubscription();

        if (!userId || !this.supabase?.channel) {
            return;
        }

        this.engagementNotificationChannelUserId = userId;
        this.engagementNotificationChannel = this.createRealtimeSubscription(
            `engagement-user-notifications-${userId}`,
            (channel) => channel.on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'system_notifications',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => this.handleEngagementNotificationRealtime(payload)
            ),
            { feature: 'engagement_notifications' }
        );
    }

    getEngagementRealtimeRow(payload = {}) {
        const nextRow = payload?.new && typeof payload.new === 'object' && !Array.isArray(payload.new) ? payload.new : null;
        const previousRow = payload?.old && typeof payload.old === 'object' && !Array.isArray(payload.old) ? payload.old : null;
        return nextRow || previousRow || {};
    }

    normalizeEngagementNotificationRow(row = {}) {
        const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
            ? source.metadata
            : {};
        const category = String(source.category || metadata.category || 'user_notice').trim() || 'user_notice';
        return this.normalizeEngagementItem({
            id: `notification:${String(source.id || '').trim()}`,
            notification_id: String(source.id || '').trim(),
            source: 'notification',
            source_module: String(source.source_module || metadata.source_module || category).trim() || category,
            source_event_id: String(source.source_event_id || metadata.source_event_id || '').trim(),
            title: String(source.title || '小助手提醒').trim() || '小助手提醒',
            content: String(source.content || '').trim(),
            category,
            scope: String(source.scope || metadata.scope || 'unspecified').trim().toLowerCase() || 'unspecified',
            page_id: String(metadata.page_id || this.getEngagementPageId()).trim() || this.getEngagementPageId(),
            site: String(source.site || metadata.site || 'cn').trim().toLowerCase() || 'cn',
            placement: metadata.placement || metadata.display_type || metadata.displayType || 'robot_bubble',
            priority: Number(source.priority || metadata.priority || 20) || 20,
            action_label: String(source.action_label || metadata.action_label || '').trim(),
            action_url: String(source.action_url || metadata.action_url || '').trim(),
            dismiss_ttl_hours: metadata.dismiss_ttl_hours ?? 24,
            tone: String(source.type || metadata.tone || 'info').trim() || 'info',
            icon: String(metadata.icon || 'robot').trim() || 'robot',
            metadata: {
                ...metadata,
                scope: String(source.scope || metadata.scope || 'unspecified').trim().toLowerCase() || 'unspecified'
            }
        });
    }

    isCnAdminEngagementBubbleContext() {
        return Boolean(this.isAdmin) && this.getEngagementBroadcastSite() === 'cn';
    }

    getAdminOpsNotificationPatterns() {
        return [
            /库存/,
            /补货/,
            /履约/,
            /支付/,
            /验证/,
            /工单超时/,
            /风险/,
            /异常登录/,
            /客服消息汇总/,
            /购买成功汇总/,
            /充值成功汇总/,
            /库存与补货汇总/,
            /工单超时汇总/,
            /履约失败汇总/,
            /支付通道异常汇总/,
            /验证额度告警汇总/,
            /验证堆积告警汇总/,
            /验证失败率告警汇总/
        ];
    }

    normalizeSystemNotificationScope(value = '') {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) {
            return 'unspecified';
        }
        return ['admin_personal', 'user_personal', 'unspecified'].includes(normalized)
            ? normalized
            : 'unknown';
    }

    isOpsLikeSystemNotification(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return false;
        const metadata = normalized.metadata && typeof normalized.metadata === 'object' && !Array.isArray(normalized.metadata)
            ? normalized.metadata
            : {};
        const text = [
            normalized.title,
            normalized.content,
            normalized.category,
            metadata.category,
            metadata.event_type,
            metadata.trigger_type,
            normalized.source_module
        ].map((entry) => String(entry || '').trim()).filter(Boolean).join('\n');
        return this.getAdminOpsNotificationPatterns().some((pattern) => pattern.test(text));
    }

    getSystemNotificationAutomationTriggerTypes() {
        return new Set([
            'cart_abandoned',
            'comment_replied',
            'coupon_available',
            'coupon_expiring',
            'content_featured',
            'daily_checkin_available',
            'guestbook_mention',
            'inactive_user_return',
            'login_risk',
            'maintenance_notice',
            'message_replied',
            'new_user_welcome',
            'order_delivered',
            'order_paid',
            'order_status',
            'payment_failed',
            'permission_changed',
            'points_adjusted',
            'points_insufficient',
            'points_low_balance',
            'product_discount',
            'product_discount_available',
            'product_restocked',
            'profile_incomplete',
            'prompt_unlocked',
            'refund_status',
            'search_no_result',
            'service_status',
            'support_reply',
            'ticket_updated',
            'usage_rules',
            'verification_expiring',
            'verify_failed',
            'verify_queue',
            'verify_success',
            'wallet_recharge_failed',
            'wallet_recharge_success',
            'community_rule'
        ]);
    }

    getSystemNotificationAutomationTriggerType(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return '';
        const metadata = normalized.metadata && typeof normalized.metadata === 'object' && !Array.isArray(normalized.metadata)
            ? normalized.metadata
            : {};
        const triggerType = this.normalizeEngagementTriggerType(
            metadata.trigger_type
                || metadata.triggerType
                || metadata.event_type
                || metadata.eventType
                || ''
        );
        return this.getSystemNotificationAutomationTriggerTypes().has(triggerType) ? triggerType : '';
    }

    shouldSurfaceSystemNotificationBubble(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return false;
        if (!this.matchesCurrentSite(normalized, normalized.site)) {
            return false;
        }
        const metadata = normalized.metadata && typeof normalized.metadata === 'object' && !Array.isArray(normalized.metadata)
            ? normalized.metadata
            : {};
        const notificationCategory = String(normalized.category || metadata.category || '').trim().toLowerCase();
        const triggerType = this.normalizeEngagementTriggerType(
            metadata.trigger_type
                || metadata.triggerType
                || metadata.event_type
                || metadata.eventType
                || ''
        );
        if (notificationCategory === 'content_moderated' || triggerType === 'content_moderated') {
            return false;
        }
        const scope = this.normalizeSystemNotificationScope(normalized.scope || metadata.scope);
        const cnAdminBubble = this.isCnAdminEngagementBubbleContext();
        if (scope === 'admin_personal') {
            return cnAdminBubble;
        }
        if (this.isOpsLikeSystemNotification(normalized) && !cnAdminBubble) {
            return false;
        }
        if (scope !== 'user_personal' && scope !== 'unspecified') {
            return false;
        }
        return true;
    }

    shouldSurfaceEngagementItem(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return false;
        if (normalized.source === 'notification' && !this.shouldSurfaceSystemNotificationBubble(normalized)) {
            return false;
        }
        return true;
    }

    async showAutomationForSystemNotification(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return false;
        const triggerType = this.getSystemNotificationAutomationTriggerType(normalized);
        if (!triggerType) return false;

        const metadata = normalized.metadata && typeof normalized.metadata === 'object' && !Array.isArray(normalized.metadata)
            ? normalized.metadata
            : {};
        const result = await this.triggerEngagementEvent(triggerType, {
            ...metadata,
            source_module: String(metadata.source_module || normalized.source_module || 'system_notifications').trim() || 'system_notifications',
            source_event_id: String(normalized.source_event_id || metadata.source_event_id || normalized.notification_id || '').trim(),
            notification_id: normalized.notification_id || '',
            notification_category: String(metadata.category || normalized.category || '').trim(),
            notification_title: normalized.title || '',
            page_id: normalized.page_id || this.getEngagementPageId(),
            site: normalized.site || this.getEngagementBroadcastSite()
        }, { once: true });
        return Boolean(result);
    }

    showRealtimeEngagementItem(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return false;
        if (!this.shouldSurfaceEngagementItem(normalized)) {
            return false;
        }
        const activeKey = this.engagementActiveItem ? this.getEngagementItemKey(this.engagementActiveItem) : '';
        const nextKey = this.getEngagementItemKey(normalized);
        const activeSemanticKey = this.engagementActiveItem ? this.getEngagementSemanticDedupeKey(this.engagementActiveItem) : '';
        const nextSemanticKey = this.getEngagementSemanticDedupeKey(normalized);
        if (activeKey && nextKey && activeKey === nextKey) return false;
        if (activeSemanticKey && nextSemanticKey && activeSemanticKey === nextSemanticKey) return false;
        if (this.isEngagementItemSuppressed(normalized) || this.isEngagementItemSessionQuiet(normalized)) {
            return false;
        }
        if (this.isOpen || this.engagementActiveItem || this.isEngagementDisplayCoolingDown()) {
            const queued = this.queuePendingEngagementItem(normalized, options);
            this.schedulePendingEngagementFlush();
            if (queued) {
                this.scheduleEngagementFollowupRefresh(260);
            }
            return queued;
        }
        this.showEngagementItem(normalized, {
            ...options,
            realtime: true
        });
        this.scheduleEngagementFollowupRefresh(260);
        return true;
    }

    queuePendingEngagementItem(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return false;
        const key = this.getEngagementItemKey(normalized);
        const semanticKey = this.getEngagementSemanticDedupeKey(normalized);
        if (!key || this.isEngagementItemSuppressed(normalized) || this.isEngagementItemSessionQuiet(normalized)) {
            return false;
        }
        const existingSemanticEntry = semanticKey ? this.getPendingEngagementSemanticEntry(semanticKey) : null;
        if (existingSemanticEntry) {
            const existingItem = this.normalizeEngagementItem(existingSemanticEntry.item || {});
            if (existingItem && this.compareEngagementDisplayPriority(existingItem, normalized) <= 0) {
                return false;
            }
        }
        const queuedItem = {
            key,
            semanticKey,
            item: normalized,
            options: {
                ...options,
                queued: true
            },
            queuedAt: Date.now()
        };
        this.engagementPendingItems = [
            queuedItem,
            ...this.engagementPendingItems.filter((entry) => entry?.key !== key && (!semanticKey || entry?.semanticKey !== semanticKey))
        ]
            .sort((left, right) => {
                const priorityDelta = this.compareEngagementDisplayPriority(left.item || {}, right.item || {});
                if (priorityDelta) return priorityDelta;
                return Number(right.queuedAt || 0) - Number(left.queuedAt || 0);
            })
            .slice(0, 8);
        return true;
    }

    clearPendingEngagementFlushTimer() {
        if (!this.engagementPendingFlushTimer) return;
        window.clearTimeout(this.engagementPendingFlushTimer);
        this.engagementPendingFlushTimer = null;
    }

    isEngagementDisplayCoolingDown() {
        return Number(this.engagementDisplayQuietUntil || 0) > Date.now();
    }

    getEngagementDisplayCooldownRemainingMs() {
        return Math.max(0, Number(this.engagementDisplayQuietUntil || 0) - Date.now());
    }

    beginEngagementDisplayCooldown(delayMs = 1800) {
        const normalizedDelay = Math.max(0, Number(delayMs || 0) || 0);
        this.engagementDisplayQuietUntil = Date.now() + normalizedDelay;
        return normalizedDelay;
    }

    beginEngagementAuthBurst(durationMs = 10000, collectMs = 1200) {
        const normalizedDuration = Math.max(0, Number(durationMs || 0) || 0);
        const normalizedCollect = Math.max(0, Number(collectMs || 0) || 0);
        this.engagementAuthBurstUntil = Date.now() + normalizedDuration;
        this.engagementAuthBurstCollectUntil = Date.now() + Math.min(normalizedDuration, normalizedCollect);
        this.engagementAuthBurstDisplayedCount = 0;
        return normalizedDuration;
    }

    isEngagementAuthBurstActive() {
        return Number(this.engagementAuthBurstUntil || 0) > Date.now();
    }

    isEngagementAuthBurstCollecting() {
        return Number(this.engagementAuthBurstCollectUntil || 0) > Date.now();
    }

    getEngagementAuthBurstRemainingMs() {
        return Math.max(0, Number(this.engagementAuthBurstUntil || 0) - Date.now());
    }

    getEngagementAuthBurstHoldingRemainingMs() {
        if (this.isEngagementAuthBurstCollecting()) {
            return Math.max(0, Number(this.engagementAuthBurstCollectUntil || 0) - Date.now());
        }
        if (this.isEngagementAuthBurstActive() && Number(this.engagementAuthBurstDisplayedCount || 0) >= 1) {
            return this.getEngagementAuthBurstRemainingMs();
        }
        return 0;
    }

    shouldThrottleEngagementForAuthBurst(options = {}) {
        if (options?.manual === true) return false;
        if (this.isEngagementAuthBurstCollecting()) return true;
        return this.isEngagementAuthBurstActive() && Number(this.engagementAuthBurstDisplayedCount || 0) >= 1;
    }

    markEngagementDisplayStarted(options = {}) {
        if (options?.manual === true) return;
        if (this.isEngagementAuthBurstActive()) {
            this.engagementAuthBurstDisplayedCount += 1;
        }
    }

    getEngagementRespirationDelayMs(options = {}) {
        if (options?.eventType === 'click' || options?.eventType === 'action') {
            return 2800;
        }
        if (options?.eventType === 'dismiss' && options?.passive !== true) {
            return 2400;
        }
        return 1800;
    }

    getEngagementNextDisplayDelayMs(options = {}) {
        const cooldownDelay = this.getEngagementDisplayCooldownRemainingMs();
        const authBurstDelay = this.shouldThrottleEngagementForAuthBurst(options)
            ? this.getEngagementAuthBurstHoldingRemainingMs()
            : 0;
        return Math.max(120, cooldownDelay, authBurstDelay);
    }

    getEngagementUrgencyRank(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return 0;
        const triggerType = String(normalized.trigger_type || '').trim().toLowerCase();
        const priorityCenter = this.getEngagementEventPriorityCenter();
        const priorityGroups = [
            ['first_wave', 4],
            ['service', 3],
            ['guidance', 2],
            ['marketing', 1]
        ];
        for (const [groupId, rank] of priorityGroups) {
            const events = Array.isArray(priorityCenter?.[groupId]?.events) ? priorityCenter[groupId].events : [];
            if (events.includes(triggerType)) return rank;
        }
        if (normalized.source === 'notification') return 2;
        return 0;
    }

    normalizeEngagementEventPriorityCenter(value = {}) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const fallback = {
            first_wave: {
                label: '首波优先',
                events: ['login_risk', 'payment_failed', 'wallet_recharge_failed', 'verify_failed', 'support_reply', 'ticket_updated', 'refund_status', 'order_status', 'order_paid', 'order_delivered', 'content_moderated']
            },
            service: {
                label: '常规服务',
                events: ['verification_expiring', 'permission_changed', 'points_adjusted', 'points_insufficient', 'verify_queue', 'message_replied', 'comment_replied', 'guestbook_mention', 'service_status', 'maintenance_notice', 'usage_rules', 'community_rule']
            },
            marketing: {
                label: '延后营销',
                events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_discount_available', 'product_restocked', 'cart_abandoned', 'inactive_user_return']
            },
            guidance: {
                label: '体验引导',
                events: ['verify_success', 'prompt_unlocked', 'search_no_result', 'profile_incomplete', 'daily_checkin_available', 'new_user_welcome', 'points_low_balance', 'content_featured', 'wallet_recharge_success']
            }
        };
        const normalizeEvents = (input) => {
            const list = Array.isArray(input) ? input : [];
            return [...new Set(list
                .map((entry) => String(entry || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                .filter(Boolean))];
        };
        return {
            first_wave: {
                label: String(source.first_wave?.label || fallback.first_wave.label).trim() || fallback.first_wave.label,
                events: normalizeEvents(source.first_wave?.events || fallback.first_wave.events)
            },
            service: {
                label: String(source.service?.label || fallback.service.label).trim() || fallback.service.label,
                events: normalizeEvents(source.service?.events || fallback.service.events)
            },
            marketing: {
                label: String(source.marketing?.label || fallback.marketing.label).trim() || fallback.marketing.label,
                events: normalizeEvents(source.marketing?.events || fallback.marketing.events)
            },
            guidance: {
                label: String(source.guidance?.label || fallback.guidance.label).trim() || fallback.guidance.label,
                events: normalizeEvents(source.guidance?.events || fallback.guidance.events)
            }
        };
    }

    getEngagementEventPriorityCenter() {
        if (!this.engagementEventPriorityCenter) {
            this.engagementEventPriorityCenter = this.normalizeEngagementEventPriorityCenter({});
        }
        return this.engagementEventPriorityCenter;
    }

    compareEngagementDisplayPriority(left = {}, right = {}) {
        const urgencyDelta = this.getEngagementUrgencyRank(right) - this.getEngagementUrgencyRank(left);
        if (urgencyDelta) return urgencyDelta;
        const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
        if (priorityDelta) return priorityDelta;
        const sourceWeight = (item = {}) => (String(item.source || '') === 'notification' ? 2 : (String(item.source || '') === 'rule' ? 1 : 0));
        const sourceDelta = sourceWeight(right) - sourceWeight(left);
        if (sourceDelta) return sourceDelta;
        return 0;
    }

    selectPreferredEngagementFeedItem(existingItem = {}, nextItem = {}) {
        const existingNormalized = this.normalizeEngagementItem(existingItem);
        const nextNormalized = this.normalizeEngagementItem(nextItem);
        if (!existingNormalized) return nextNormalized;
        if (!nextNormalized) return existingNormalized;

        const existingBridgeKey = this.getEngagementBridgeDedupeKey(existingNormalized);
        const nextBridgeKey = this.getEngagementBridgeDedupeKey(nextNormalized);
        if (existingBridgeKey && existingBridgeKey === nextBridgeKey) {
            if (existingNormalized.source === 'notification' && nextNormalized.source === 'rule') {
                return nextNormalized;
            }
            if (existingNormalized.source === 'rule' && nextNormalized.source === 'notification') {
                return existingNormalized;
            }
        }

        return this.compareEngagementDisplayPriority(existingNormalized, nextNormalized) > 0
            ? nextNormalized
            : existingNormalized;
    }

    dedupeEngagementFeedItems(items = []) {
        const dedupedItems = [];
        const bridgeIndexByKey = new Map();

        (Array.isArray(items) ? items : [])
            .map((entry) => this.normalizeEngagementItem(entry))
            .filter(Boolean)
            .forEach((item) => {
                const bridgeKey = this.getEngagementBridgeDedupeKey(item);
                if (!bridgeKey) {
                    dedupedItems.push(item);
                    return;
                }
                const existingIndex = bridgeIndexByKey.get(bridgeKey);
                if (existingIndex === undefined) {
                    bridgeIndexByKey.set(bridgeKey, dedupedItems.length);
                    dedupedItems.push(item);
                    return;
                }
                dedupedItems[existingIndex] = this.selectPreferredEngagementFeedItem(dedupedItems[existingIndex], item);
            });

        return dedupedItems;
    }

    schedulePendingEngagementFlush(delayMs = null) {
        this.clearPendingEngagementFlushTimer();
        if (this.isOpen || this.engagementActiveItem || !Array.isArray(this.engagementPendingItems) || !this.engagementPendingItems.length) {
            return false;
        }
        const waitMs = delayMs === null
            ? this.getEngagementNextDisplayDelayMs()
            : Math.max(120, Number(delayMs || 0) || 0);
        this.engagementPendingFlushTimer = window.setTimeout(() => {
            this.engagementPendingFlushTimer = null;
            this.flushPendingEngagementItems();
        }, waitMs);
        return true;
    }

    removePendingEngagementItemByKey(key = '') {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey || !Array.isArray(this.engagementPendingItems) || !this.engagementPendingItems.length) {
            return false;
        }
        const previousLength = this.engagementPendingItems.length;
        this.engagementPendingItems = this.engagementPendingItems.filter((entry) => entry?.key !== normalizedKey);
        return this.engagementPendingItems.length !== previousLength;
    }

    flushPendingEngagementItems() {
        if (this.isOpen || this.engagementActiveItem || !Array.isArray(this.engagementPendingItems) || !this.engagementPendingItems.length) {
            return false;
        }
        if (this.isEngagementDisplayCoolingDown() || this.shouldThrottleEngagementForAuthBurst()) {
            this.schedulePendingEngagementFlush();
            return false;
        }
        this.engagementPendingItems = this.engagementPendingItems
            .slice()
            .sort((left, right) => {
                const priorityDelta = this.compareEngagementDisplayPriority(left.item || {}, right.item || {});
                if (priorityDelta) return priorityDelta;
                return Number(right.queuedAt || 0) - Number(left.queuedAt || 0);
            });
        while (this.engagementPendingItems.length) {
            const entry = this.engagementPendingItems.shift();
            const normalized = this.normalizeEngagementItem(entry?.item || {});
            if (!normalized || this.isEngagementItemSuppressed(normalized) || this.isEngagementItemSessionQuiet(normalized)) {
                continue;
            }
            if (this.shouldThrottleEngagementForAuthBurst(entry?.options || {})) {
                this.queuePendingEngagementItem(normalized, entry?.options || {});
                this.schedulePendingEngagementFlush(this.getEngagementNextDisplayDelayMs(entry?.options || {}));
                return false;
            }
            this.showEngagementItem(normalized, {
                ...(entry?.options || {}),
                queued: true
            });
            return true;
        }
        return false;
    }

    handleEngagementNotificationRealtime(payload = {}) {
        if (payload?.eventType && payload.eventType !== 'INSERT') {
            return;
        }
        const row = this.getEngagementRealtimeRow(payload);
        if (!row.id || row.is_read === true) {
            return;
        }
        if (String(row.user_id || '').trim() !== this.engagementNotificationChannelUserId) {
            return;
        }
        if (!this.matchesCurrentSite(row, 'cn')) {
            return;
        }

        const item = this.normalizeEngagementNotificationRow(row);
        if (!this.shouldSurfaceSystemNotificationBubble(item)) {
            return;
        }
        const triggerType = this.getSystemNotificationAutomationTriggerType(item);
        if (triggerType) {
            const fallbackDelayMs = 160;
            let fallbackTimer = null;
            let fallbackShown = false;
            const showFallback = () => {
                fallbackTimer = null;
                if (fallbackShown) return false;
                fallbackShown = this.showRealtimeEngagementItem(item, {
                    source: 'system_notifications',
                    bridge_fallback: true
                }) === true;
                return fallbackShown;
            };
            void this.showAutomationForSystemNotification(item).then((shown) => {
                if (fallbackTimer) {
                    window.clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                if (shown) {
                    this.suppressEngagementItem(item);
                    return;
                }
                if (!fallbackShown) {
                    showFallback();
                }
            }).catch((error) => {
                if (fallbackTimer) {
                    window.clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                console.warn('[ChatWidget] Failed to bridge notification into engagement automation:', error?.message || error);
                if (!fallbackShown) {
                    showFallback();
                }
            });
            fallbackTimer = window.setTimeout(showFallback, fallbackDelayMs);
            return;
        }
        this.showRealtimeEngagementItem(item, { source: 'system_notifications' });
    }

    stopEngagementDeliverySubscription() {
        if (this.engagementDeliveryChannel && this.supabase?.removeChannel) {
            try {
                this.supabase.removeChannel(this.engagementDeliveryChannel);
            } catch (error) {
                console.warn('[ChatWidget] Failed to remove engagement delivery channel:', error?.message || error);
            }
        }
        this.engagementDeliveryChannel = null;
        this.engagementDeliveryChannelUserId = '';
    }

    syncEngagementDeliverySubscription(user = this.currentUser) {
        const userId = String(user?.id || '').trim();
        if (this.engagementDeliveryChannelUserId === userId && this.engagementDeliveryChannel) {
            return;
        }

        this.stopEngagementDeliverySubscription();

        if (!userId || !this.supabase?.channel) {
            return;
        }

        this.engagementDeliveryChannelUserId = userId;
        this.engagementDeliveryChannel = this.createRealtimeSubscription(
            `engagement-user-deliveries-${userId}`,
            (channel) => channel.on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'engagement_deliveries',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => this.handleEngagementDeliveryRealtime(payload)
            ),
            { feature: 'engagement_deliveries' }
        );
    }

    normalizeEngagementDeliveryRow(row = {}) {
        const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
            ? source.metadata
            : {};
        const bubble = metadata.bubble && typeof metadata.bubble === 'object' && !Array.isArray(metadata.bubble)
            ? metadata.bubble
            : {};
        const bubbleMetadata = bubble.metadata && typeof bubble.metadata === 'object' && !Array.isArray(bubble.metadata)
            ? bubble.metadata
            : {};
        const { bubble: _bubble, ...deliveryMetadata } = metadata;
        return this.normalizeEngagementItem({
            ...bubble,
            id: String(bubble.id || source.rule_id || source.notification_id || source.id || '').trim(),
            delivery_id: String(source.id || '').trim(),
            rule_id: String(source.rule_id || bubble.rule_id || '').trim(),
            notification_id: String(source.notification_id || bubble.notification_id || '').trim(),
            source: String(bubble.source || (source.rule_id ? 'rule' : 'notification')).trim() || 'rule',
            page_id: String(source.page_id || bubble.page_id || this.getEngagementPageId()).trim() || this.getEngagementPageId(),
            site: String(source.site || bubble.site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn',
            source_module: String(source.source_module || bubble.source_module || 'engagement').trim() || 'engagement',
            source_event_id: String(source.source_event_id || bubble.source_event_id || metadata.delivery_key || '').trim(),
            delivery_key: String(source.delivery_key || metadata.delivery_key || '').trim(),
            metadata: {
                ...bubbleMetadata,
                ...deliveryMetadata,
                delivery_id: String(source.id || '').trim(),
                delivered_at: String(source.delivered_at || '').trim()
            }
        });
    }

    shouldApplyEngagementDeliveryRealtime(row = {}) {
        const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        if (!source.id || String(source.user_id || '').trim() !== this.engagementDeliveryChannelUserId) {
            return false;
        }
        const status = String(source.status || 'delivered').trim().toLowerCase();
        if (status && !['delivered', 'viewed', 'clicked', 'dismissed', 'expired'].includes(status)) {
            return false;
        }
        const expiresAt = String(source.expires_at || '').trim();
        if (expiresAt) {
            const expiresMs = new Date(expiresAt).getTime();
            if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
                return false;
            }
        }
        const site = String(source.site || 'all').trim().toLowerCase() || 'all';
        if (site !== 'all' && site !== this.getEngagementBroadcastSite()) {
            return false;
        }
        const pageId = String(source.page_id || 'all').trim().toLowerCase() || 'all';
        return pageId === 'all' || pageId === this.getEngagementPageId();
    }

    handleEngagementDeliveryRealtime(payload = {}) {
        if (payload?.eventType && payload.eventType !== 'INSERT') {
            const row = this.getEngagementRealtimeRow(payload);
            if (this.shouldApplyEngagementDeliveryRealtime(row)) {
                this.handleEngagementDeliveryStatusRealtime(row);
            }
            return;
        }
        const row = this.getEngagementRealtimeRow(payload);
        if (!this.shouldApplyEngagementDeliveryRealtime(row)) {
            return;
        }
        const item = this.normalizeEngagementDeliveryRow(row);
        this.showRealtimeEngagementItem(item, { source: 'engagement_deliveries' });
    }

    handleEngagementDeliveryStatusRealtime(row = {}) {
        const item = this.normalizeEngagementDeliveryRow(row);
        if (!item) return false;
        const key = this.getEngagementItemKey(item);
        this.removePendingEngagementItemByKey(key);
        const status = String(row.status || '').trim().toLowerCase();
        if (!['clicked', 'dismissed', 'expired'].includes(status)) {
            return false;
        }
        const activeKey = this.engagementActiveItem ? this.getEngagementItemKey(this.engagementActiveItem) : '';
        if (key && activeKey && key === activeKey) {
            this.dismissEngagementSurface(this.engagementActiveItem, { passive: true });
            return true;
        }
        return false;
    }

    clearEngagementUserTagsRefreshTimer() {
        if (this.engagementUserTagsRefreshTimer) {
            window.clearTimeout(this.engagementUserTagsRefreshTimer);
            this.engagementUserTagsRefreshTimer = null;
        }
    }

    stopEngagementUserTagsSubscription() {
        this.clearEngagementUserTagsRefreshTimer();
        if (this.engagementUserTagsChannel && this.supabase?.removeChannel) {
            try {
                this.supabase.removeChannel(this.engagementUserTagsChannel);
            } catch (error) {
                console.warn('[ChatWidget] Failed to remove engagement user tags channel:', error?.message || error);
            }
        }
        this.engagementUserTagsChannel = null;
        this.engagementUserTagsChannelUserId = '';
    }

    syncEngagementUserTagsSubscription(user = this.currentUser) {
        const userId = String(user?.id || '').trim();
        if (this.engagementUserTagsChannelUserId === userId && this.engagementUserTagsChannel) {
            return;
        }

        this.stopEngagementUserTagsSubscription();

        if (!userId || !this.supabase?.channel) {
            return;
        }

        this.engagementUserTagsChannelUserId = userId;
        this.engagementUserTagsChannel = this.createRealtimeSubscription(
            `engagement-user-tags-${userId}`,
            (channel) => channel.on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'user_tags',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => this.handleEngagementUserTagsRealtime(payload)
            ),
            { feature: 'engagement_user_tags' }
        );
    }

    handleEngagementUserTagsRealtime(payload = {}) {
        const nextRow = payload?.new && typeof payload.new === 'object' && !Array.isArray(payload.new) ? payload.new : null;
        const previousRow = payload?.old && typeof payload.old === 'object' && !Array.isArray(payload.old) ? payload.old : null;
        const rowUserId = String(nextRow?.user_id || previousRow?.user_id || '').trim();
        if (!rowUserId || rowUserId !== this.engagementUserTagsChannelUserId) {
            return;
        }

        this.clearEngagementUserTagsRefreshTimer();
        this.engagementUserTagsRefreshTimer = window.setTimeout(() => {
            this.engagementUserTagsRefreshTimer = null;
            void this.refreshEngagementFeed({ force: true }).catch((error) => {
                console.warn('[ChatWidget] Failed to refresh engagement feed after user tag change:', error?.message || error);
            });
        }, 160);
    }

    clearEngagementFeedBroadcastRefreshTimer() {
        if (this.engagementFeedBroadcastRefreshTimer) {
            window.clearTimeout(this.engagementFeedBroadcastRefreshTimer);
            this.engagementFeedBroadcastRefreshTimer = null;
        }
    }

    stopEngagementFeedBroadcastSubscription() {
        this.clearEngagementFeedBroadcastRefreshTimer();
        if (this.engagementFeedBroadcastChannel && this.supabase?.removeChannel) {
            try {
                this.supabase.removeChannel(this.engagementFeedBroadcastChannel);
            } catch (error) {
                console.warn('[ChatWidget] Failed to remove engagement feed broadcast channel:', error?.message || error);
            }
        }
        this.engagementFeedBroadcastChannel = null;
    }

    syncEngagementFeedBroadcastSubscription() {
        if (this.engagementFeedBroadcastChannel || !this.supabase?.channel) {
            return;
        }

        this.engagementFeedBroadcastChannel = this.createRealtimeSubscription(
            'engagement-feed-invalidations',
            (channel) => channel.on(
                'broadcast',
                { event: 'engagement_feed_changed' },
                (payload) => this.handleEngagementFeedBroadcast(payload?.payload || payload)
            ),
            {
                feature: 'engagement_feed_broadcast',
                channelOptions: { config: { broadcast: { self: false } } }
            }
        );
    }

    normalizeEngagementBroadcastList(value) {
        const source = Array.isArray(value) ? value : (value ? [value] : []);
        return [...new Set(source.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))];
    }

    getEngagementBroadcastSite() {
        const externalSite = String(this.getEngagementExternalConfig().site || '').trim().toLowerCase();
        return (externalSite || String(window.SiteConfig?.site || 'cn').trim().toLowerCase()) === 'intl' ? 'intl' : 'cn';
    }

    getCurrentSite() {
        return this.getEngagementBroadcastSite();
    }

    getCurrentSiteRealtimeFilter() {
        return `site=eq.${this.getCurrentSite()}`;
    }

    queryForCurrentSite(query, site = this.getCurrentSite()) {
        if (!query || typeof query.eq !== 'function') {
            return query;
        }
        return query.eq('site', site);
    }

    matchesCurrentSite(row = {}, fallbackSite = '') {
        const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
            ? source.metadata
            : {};
        const rowSite = String(
            source.site
                || metadata.site
                || metadata.site_id
                || metadata.siteId
                || fallbackSite
                || ''
        ).trim().toLowerCase();
        if (!rowSite || rowSite === 'all') {
            return true;
        }
        return rowSite === this.getCurrentSite();
    }

    shouldApplyEngagementFeedBroadcast(message = {}) {
        const source = message && typeof message === 'object' && !Array.isArray(message) ? message : {};
        const site = String(source.site || '').trim().toLowerCase();
        if (site && site !== 'all' && site !== this.getEngagementBroadcastSite()) {
            return false;
        }

        const pageIds = this.normalizeEngagementBroadcastList(source.page_ids || source.pageIds || source.pages);
        if (!pageIds.length || pageIds.includes('all')) {
            return true;
        }

        return pageIds.includes(this.getEngagementPageId());
    }

    handleEngagementFeedBroadcast(message = {}) {
        if (!this.shouldApplyEngagementFeedBroadcast(message)) {
            return;
        }

        this.clearEngagementFeedBroadcastRefreshTimer();
        this.engagementFeedBroadcastRefreshTimer = window.setTimeout(() => {
            this.engagementFeedBroadcastRefreshTimer = null;
            void this.refreshEngagementFeed({ force: true }).catch((error) => {
                console.warn('[ChatWidget] Failed to refresh engagement feed after broadcast:', error?.message || error);
            });
        }, 180);
    }

    clearEngagementFeedInvalidationsRefreshTimer() {
        if (this.engagementFeedInvalidationsRefreshTimer) {
            window.clearTimeout(this.engagementFeedInvalidationsRefreshTimer);
            this.engagementFeedInvalidationsRefreshTimer = null;
        }
    }

    stopEngagementFeedInvalidationsSubscription() {
        this.clearEngagementFeedInvalidationsRefreshTimer();
        if (this.engagementFeedInvalidationsChannel && this.supabase?.removeChannel) {
            try {
                this.supabase.removeChannel(this.engagementFeedInvalidationsChannel);
            } catch (error) {
                console.warn('[ChatWidget] Failed to remove engagement feed invalidations channel:', error?.message || error);
            }
        }
        this.engagementFeedInvalidationsChannel = null;
    }

    shouldApplyEngagementFeedInvalidationRealtime(row = {}) {
        const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
        if (!source.id) return false;
        const site = String(source.site || 'all').trim().toLowerCase() || 'all';
        if (site !== 'all' && site !== this.getEngagementBroadcastSite()) {
            return false;
        }

        const pageIds = this.normalizeEngagementBroadcastList(source.page_ids || source.pageIds || source.pages);
        return !pageIds.length || pageIds.includes('all') || pageIds.includes(this.getEngagementPageId());
    }

    syncEngagementFeedInvalidationsSubscription() {
        if (this.engagementFeedInvalidationsChannel || !this.supabase?.channel) {
            return;
        }

        this.engagementFeedInvalidationsChannel = this.createRealtimeSubscription(
            'engagement-feed-invalidations-db',
            (channel) => channel.on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'engagement_feed_invalidations'
                },
                (payload) => this.handleEngagementFeedInvalidationRealtime(payload)
            ),
            { feature: 'engagement_feed_invalidations' }
        );
    }

    handleEngagementFeedInvalidationRealtime(payload = {}) {
        const row = this.getEngagementRealtimeRow(payload);
        if (!this.shouldApplyEngagementFeedInvalidationRealtime(row)) {
            return;
        }

        this.clearEngagementFeedInvalidationsRefreshTimer();
        this.engagementFeedInvalidationsRefreshTimer = window.setTimeout(() => {
            this.engagementFeedInvalidationsRefreshTimer = null;
            void this.refreshEngagementFeed({ force: true }).catch((error) => {
                console.warn('[ChatWidget] Failed to refresh engagement feed after invalidation realtime:', error?.message || error);
            });
        }, 80);
    }

    bindEngagementAuthStateListener() {
        if (this.engagementAuthSubscription || !this.supabase?.auth?.onAuthStateChange) {
            return;
        }

        try {
            const { data } = this.supabase.auth.onAuthStateChange((_authEvent, session) => {
                const previousUserId = String(this.currentUser?.id || '').trim();
                const user = session?.user || null;
                const nextUserId = String(user?.id || '').trim();
                this.currentUser = user;
                if (nextUserId && nextUserId !== previousUserId) {
                    this.beginEngagementAuthBurst(10000, 1200);
                    this.schedulePendingEngagementFlush(1400);
                }
                this.syncEngagementNotificationSubscription(user);
                this.syncEngagementDeliverySubscription(user);
                this.syncEngagementUserTagsSubscription(user);
                this.scheduleEngagementConditionEvaluation('auth_change', 650);
                void this.refreshEngagementFeed({ force: true }).catch((error) => {
                    console.warn('[ChatWidget] Failed to refresh engagement feed after auth change:', error?.message || error);
                });
            });
            this.engagementAuthSubscription = data?.subscription || null;
        } catch (error) {
            console.warn('[ChatWidget] Failed to bind engagement auth state listener:', error?.message || error);
        }
    }

    async bootstrapEngagementPersonalSubscriptions() {
        if (!this.supabase?.auth?.getUser) {
            return;
        }

        try {
            const { data: { user } = {} } = await this.supabase.auth.getUser();
            this.currentUser = user || null;
            this.syncEngagementNotificationSubscription(user || null);
            this.syncEngagementDeliverySubscription(user || null);
            this.syncEngagementUserTagsSubscription(user || null);
            this.scheduleEngagementConditionEvaluation('bootstrap', 900);
        } catch (error) {
            console.warn('[ChatWidget] Failed to bootstrap engagement personal realtime:', error?.message || error);
        }
    }

    initEngagementRuntime() {
        if (this.engagementRuntimeInitialized) return;
        this.engagementRuntimeInitialized = true;
        window.ZaoyoeEngagement = {
            refresh: () => this.refreshEngagementFeed({ force: true }),
            show: (item) => this.showEngagementItem(item, { manual: true }),
            trigger: (triggerType, metadata = {}, options = {}) => this.triggerEngagementEvent(triggerType, metadata, options),
            dismiss: () => this.dismissEngagementSurface(this.engagementActiveItem, { eventType: 'dismiss' })
        };
        this.bindEngagementAuthStateListener();
        void this.bootstrapEngagementPersonalSubscriptions();
        this.syncEngagementFeedBroadcastSubscription();
        this.syncEngagementFeedInvalidationsSubscription();
        window.setTimeout(() => {
            void this.refreshEngagementFeed();
        }, 1400);
        this.scheduleEngagementConditionEvaluation('runtime_init', 1800);
        // Realtime subscriptions drive freshness; this is a degraded-network safety sweep.
        this.engagementRefreshTimer = window.setInterval(() => {
            void this.refreshEngagementFeed();
        }, 300000);
        this.scheduleEngagementAutomationTriggers();
    }

    scheduleEngagementConditionEvaluation(reason = 'runtime', delayMs = 1200) {
        if (!this.supabase?.auth?.getSession || typeof window === 'undefined') {
            return;
        }
        if (this.engagementConditionEvaluationTimer) {
            window.clearTimeout(this.engagementConditionEvaluationTimer);
        }
        const normalizedDelay = Math.max(0, Number(delayMs || 0) || 0);
        this.engagementConditionEvaluationTimer = window.setTimeout(() => {
            this.engagementConditionEvaluationTimer = null;
            void this.runEngagementConditionEvaluators(reason).catch((error) => {
                console.warn('[ChatWidget] Engagement condition evaluators skipped:', error?.message || error);
            });
        }, normalizedDelay);
    }

    getEngagementLocalDateKey(date = new Date()) {
        const value = date instanceof Date ? date : new Date(date);
        if (!Number.isFinite(value.getTime())) return '';
        return [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0')
        ].join('-');
    }

    normalizeEngagementDateKey(value = '') {
        const raw = String(value || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const parsed = raw ? new Date(raw) : null;
        return parsed && Number.isFinite(parsed.getTime()) ? this.getEngagementLocalDateKey(parsed) : '';
    }

    async runEngagementConditionEvaluators(reason = 'runtime') {
        if (this.engagementConditionEvaluationInFlight || !this.supabase?.auth?.getSession) {
            return;
        }
        this.engagementConditionEvaluationInFlight = true;

        try {
            const { data: { session } = {} } = await this.supabase.auth.getSession();
            const user = session?.user || this.currentUser || null;
            if (!user?.id) return;
            this.currentUser = user;

            const context = {
                reason,
                page_id: this.getEngagementPageId(),
                site: this.getEngagementBroadcastSite()
            };
            await Promise.allSettled([
                this.evaluateNewUserWelcomeAutomation(user, context),
                this.evaluateDailyCheckinAvailableAutomation(user, context),
                this.evaluateProfileIncompleteAutomation(user, context),
                this.evaluateInactiveUserReturnAutomation(user, context),
                this.evaluatePointsLowBalanceAutomation(user, context),
                this.evaluateCouponExpiringAutomation(user, context),
                this.evaluateVerificationExpiringAutomation(user, context)
            ]);
        } finally {
            this.engagementConditionEvaluationInFlight = false;
        }
    }

    getEngagementDaysSince(value = '') {
        const timestamp = value ? new Date(value).getTime() : 0;
        if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
        return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
    }

    getEngagementNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    getEngagementConditionConfig() {
        const config = window.ZaoyoeEngagementAutomationConfig || window.ZaoyoeEngagementConditionConfig || {};
        return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    }

    getEngagementLowBalanceThreshold() {
        const config = this.getEngagementConditionConfig();
        const value = config.points_low_balance_threshold ?? config.pointsLowBalanceThreshold ?? 20;
        return Math.max(0, this.getEngagementNumber(value, 20));
    }

    getEngagementVerificationExpiryDays() {
        const config = this.getEngagementConditionConfig();
        const value = config.verification_expiry_days ?? config.verificationExpiryDays ?? 30;
        return Math.max(1, this.getEngagementNumber(value, 30));
    }

    getEngagementVerificationExpiryLeadDays() {
        const config = this.getEngagementConditionConfig();
        const value = config.verification_expiring_lead_days ?? config.verificationExpiringLeadDays ?? 3;
        return Math.max(1, this.getEngagementNumber(value, 3));
    }

    async getEngagementPointsService() {
        if (window.PointsService?.getBalance) {
            return window.PointsService;
        }
        const ensurePointsService = window.ZaoyoeWalletModalBootstrap?.ensurePointsService;
        if (typeof ensurePointsService !== 'function') {
            return null;
        }
        try {
            const pointsService = await ensurePointsService();
            return pointsService?.getBalance ? pointsService : null;
        } catch (error) {
            console.warn('[ChatWidget] Failed to load points service for engagement evaluators:', error?.message || error);
            return null;
        }
    }

    async evaluateNewUserWelcomeAutomation(user = {}, context = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId) return null;

        const createdAt = String(user.created_at || user.createdAt || '').trim();
        const ageDays = this.getEngagementDaysSince(createdAt);
        if (ageDays === null || ageDays > 7) {
            return null;
        }

        const site = String(context.site || this.getEngagementBroadcastSite()).trim().toLowerCase() || 'cn';
        return this.triggerEngagementEvent('new_user_welcome', {
            source_module: 'engagement.condition_evaluator',
            evaluator: 'new_user_welcome',
            source_event_id: `new_user_welcome:${userId}`,
            page_id: context.page_id || this.getEngagementPageId(),
            site,
            account_age_days: ageDays,
            reason: context.reason || 'runtime'
        }, { once: true });
    }

    async evaluateDailyCheckinAvailableAutomation(user = {}, context = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId || !this.supabase?.rpc) return null;

        const now = new Date();
        const site = String(context.site || this.getEngagementBroadcastSite()).trim().toLowerCase() || 'cn';
        const { data, error } = await this.supabase.rpc('fn_get_checkin_data', {
            p_user_id: userId,
            p_site: site,
            p_year: now.getFullYear(),
            p_month: now.getMonth() + 1
        });
        if (error || data?.success === false) {
            return null;
        }

        const currentDate = this.normalizeEngagementDateKey(data?.current_date) || this.getEngagementLocalDateKey(now);
        const checkedDates = new Set((Array.isArray(data?.checked_dates) ? data.checked_dates : [])
            .map((entry) => this.normalizeEngagementDateKey(entry))
            .filter(Boolean));
        if (!currentDate || checkedDates.has(currentDate)) {
            return null;
        }

        return this.triggerEngagementEvent('daily_checkin_available', {
            source_module: 'engagement.condition_evaluator',
            evaluator: 'daily_checkin_available',
            source_event_id: `daily_checkin_available:${site}:${currentDate}:${userId}`,
            page_id: context.page_id || this.getEngagementPageId(),
            site,
            current_date: currentDate,
            consecutive_days: Number(data?.consecutive_days || 0) || 0,
            reason: context.reason || 'runtime'
        }, { once: true });
    }

    async fetchEngagementUserActivitySnapshot(user = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId || !this.supabase?.from) return null;

        const { data, error } = await this.supabase
            .from('engagement_user_activity')
            .select('last_active_at,last_page_id,site')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) return null;
        return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    }

    async evaluateInactiveUserReturnAutomation(user = {}, context = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId) return null;

        const activity = await this.fetchEngagementUserActivitySnapshot(user);
        const inactiveDays = this.getEngagementDaysSince(activity?.last_active_at);
        if (inactiveDays === null || inactiveDays < 14) {
            return null;
        }

        const site = String(context.site || activity?.site || this.getEngagementBroadcastSite()).trim().toLowerCase() || 'cn';
        const currentDate = this.getEngagementLocalDateKey(new Date());
        return this.triggerEngagementEvent('inactive_user_return', {
            source_module: 'engagement.condition_evaluator',
            evaluator: 'inactive_user_return',
            source_event_id: `inactive_user_return:${site}:${currentDate}:${userId}`,
            page_id: context.page_id || this.getEngagementPageId(),
            site,
            inactive_days: inactiveDays,
            last_active_at: String(activity?.last_active_at || ''),
            last_page_id: String(activity?.last_page_id || ''),
            reason: context.reason || 'runtime'
        }, { once: true });
    }

    async evaluatePointsLowBalanceAutomation(user = {}, context = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId) return null;

        const site = String(context.site || this.getEngagementBroadcastSite()).trim().toLowerCase() || 'cn';
        const pointsService = await this.getEngagementPointsService();
        if (!pointsService?.getBalance) return null;

        const balance = await pointsService.getBalance({ site });
        if (balance?._load_failed) return null;

        const totalBalance = this.getEngagementNumber(balance?.total_balance, Number.NaN);
        const threshold = this.getEngagementLowBalanceThreshold();
        if (!Number.isFinite(totalBalance) || totalBalance < 0 || totalBalance > threshold) {
            return null;
        }

        const currentDate = this.getEngagementLocalDateKey(new Date());
        const balanceBucket = totalBalance <= 0 ? 'empty' : `lte_${Math.ceil(threshold)}`;
        return this.triggerEngagementEvent('points_low_balance', {
            source_module: 'engagement.condition_evaluator',
            evaluator: 'points_low_balance',
            source_event_id: `points_low_balance:${site}:${currentDate}:${userId}:${balanceBucket}`,
            page_id: context.page_id || this.getEngagementPageId(),
            site,
            total_balance: totalBalance,
            paid_balance: this.getEngagementNumber(balance?.paid_balance, 0),
            bonus_balance: this.getEngagementNumber(balance?.bonus_balance, 0),
            threshold,
            reason: context.reason || 'runtime'
        }, { once: true });
    }

    getEngagementExpiringCouponCandidate(payload = {}) {
        const availableAssets = Array.isArray(payload?.available_assets) ? payload.available_assets : [];
        const now = Date.now();
        const maxLeadHours = Math.max(1, this.getEngagementNumber(
            this.getEngagementConditionConfig().coupon_expiring_lead_hours
                ?? this.getEngagementConditionConfig().couponExpiringLeadHours,
            72
        ));
        const maxLeadMs = maxLeadHours * 60 * 60 * 1000;

        return availableAssets
            .map((asset) => {
                const expiresAt = String(asset?.effective_expires_at || asset?.expires_at || '').trim();
                const expiresMs = expiresAt ? new Date(expiresAt).getTime() : 0;
                return {
                    asset,
                    expiresAt,
                    expiresMs
                };
            })
            .filter((entry) => Number.isFinite(entry.expiresMs) && entry.expiresMs > now && entry.expiresMs - now <= maxLeadMs)
            .sort((left, right) => left.expiresMs - right.expiresMs)[0] || null;
    }

    async evaluateCouponExpiringAutomation(user = {}, context = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId) return null;

        const site = String(context.site || this.getEngagementBroadcastSite()).trim().toLowerCase() || 'cn';
        const pointsService = await this.getEngagementPointsService();
        if (!pointsService?.getWalletDiscountAssets) return null;

        const payload = await pointsService.getWalletDiscountAssets({ site, force: false });
        const candidate = this.getEngagementExpiringCouponCandidate(payload);
        if (!candidate?.asset) return null;

        const assetId = String(candidate.asset.asset_id || candidate.asset.id || candidate.asset.discount_id || candidate.asset.code || 'coupon').trim();
        const expiryDate = this.normalizeEngagementDateKey(candidate.expiresAt) || this.getEngagementLocalDateKey(new Date(candidate.expiresMs));
        return this.triggerEngagementEvent('coupon_expiring', {
            source_module: 'engagement.condition_evaluator',
            evaluator: 'coupon_expiring',
            source_event_id: `coupon_expiring:${site}:${assetId}:${expiryDate}`,
            page_id: context.page_id || this.getEngagementPageId(),
            site,
            asset_id: assetId,
            discount_id: String(candidate.asset.discount_id || ''),
            benefit_label: String(candidate.asset.benefit_label || ''),
            expires_at: candidate.expiresAt,
            hours_until_expiry: Math.max(0, Math.ceil((candidate.expiresMs - Date.now()) / 3600000)),
            reason: context.reason || 'runtime'
        }, { once: true });
    }

    async evaluateVerificationExpiringAutomation(user = {}, context = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId || !this.supabase?.from) return null;

        const site = String(context.site || this.getEngagementBroadcastSite()).trim().toLowerCase() || 'cn';
        const { data, error } = await this.supabase
            .from('verification_logs')
            .select('id,verification_id,status,site,created_at')
            .eq('user_id', userId)
            .eq('site', site)
            .in('status', ['success', 'completed', 'passed'])
            .order('created_at', { ascending: false })
            .limit(1);
        if (error || !Array.isArray(data) || !data.length) return null;

        const latest = data[0] || {};
        const verifiedAtMs = latest.created_at ? new Date(latest.created_at).getTime() : 0;
        if (!Number.isFinite(verifiedAtMs) || verifiedAtMs <= 0) return null;

        const expiryDays = this.getEngagementVerificationExpiryDays();
        const leadDays = Math.min(expiryDays, this.getEngagementVerificationExpiryLeadDays());
        const expiresAtMs = verifiedAtMs + expiryDays * 86400000;
        const nowMs = Date.now();
        const daysUntilExpiry = Math.ceil((expiresAtMs - nowMs) / 86400000);
        if (daysUntilExpiry < 0 || daysUntilExpiry > leadDays) return null;

        const expiryDate = this.getEngagementLocalDateKey(new Date(expiresAtMs));
        return this.triggerEngagementEvent('verification_expiring', {
            source_module: 'engagement.condition_evaluator',
            evaluator: 'verification_expiring',
            source_event_id: `verification_expiring:${site}:${userId}:${expiryDate}`,
            page_id: context.page_id || this.getEngagementPageId(),
            site,
            verification_log_id: String(latest.id || ''),
            verification_id: String(latest.verification_id || ''),
            verified_at: String(latest.created_at || ''),
            inferred_expires_at: new Date(expiresAtMs).toISOString(),
            days_until_expiry: Math.max(0, daysUntilExpiry),
            expiry_days: expiryDays,
            lead_days: leadDays,
            reason: context.reason || 'runtime'
        }, { once: true });
    }

    isEngagementProfileNameIncomplete(value = '', email = '') {
        const name = String(value || '').trim();
        if (name.length < 2) return true;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail) return false;
        const emailLocalPart = normalizedEmail.split('@')[0] || '';
        return name.toLowerCase() === normalizedEmail || name.toLowerCase() === emailLocalPart;
    }

    async fetchEngagementProfileSnapshot(user = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId || !this.supabase?.from) return null;

        const { data, error } = await this.supabase
            .from('profiles')
            .select('username,avatar_url')
            .eq('id', userId)
            .maybeSingle();
        if (error) return null;
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    }

    async evaluateProfileIncompleteAutomation(user = {}, context = {}) {
        const userId = String(user?.id || '').trim();
        if (!userId) return null;

        const metadata = user.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
            ? user.user_metadata
            : {};
        const profile = await this.fetchEngagementProfileSnapshot(user);
        if (profile === null) {
            return null;
        }
        const email = String(user.email || metadata.email || '').trim();
        const displayName = String(
            profile?.username
                || metadata.display_name
                || metadata.full_name
                || metadata.name
                || metadata.user_name
                || ''
        ).trim();
        if (!this.isEngagementProfileNameIncomplete(displayName, email)) {
            return null;
        }

        const site = String(context.site || this.getEngagementBroadcastSite()).trim().toLowerCase() || 'cn';
        return this.triggerEngagementEvent('profile_incomplete', {
            source_module: 'engagement.condition_evaluator',
            evaluator: 'profile_incomplete',
            source_event_id: `profile_incomplete:${userId}:display_name`,
            page_id: context.page_id || this.getEngagementPageId(),
            site,
            missing_fields: ['display_name'],
            has_avatar: Boolean(profile?.avatar_url || metadata.avatar_url || metadata.picture),
            reason: context.reason || 'runtime'
        }, { once: true });
    }

    normalizeEngagementTriggerType(value = 'page_view') {
        return String(value || 'page_view').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'page_view';
    }

    getEngagementTriggerSourceEventId(metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
        return String(
            source.source_event_id
                || source.sourceEventId
                || source.dedupe_key
                || source.dedupeKey
                || source.order_id
                || source.orderId
                || source.payment_order_id
                || source.paymentOrderId
                || source.checkout_session_id
                || source.checkoutSessionId
                || source.task_id
                || source.taskId
                || source.job_id
                || source.jobId
                || source.comment_id
                || source.commentId
                || source.message_id
                || source.messageId
                || source.coupon_id
                || source.couponId
                || source.element_id
                || source.elementId
                || source.product_id
                || source.productId
                || source.target_id
                || source.targetId
                || source.id
                || ''
        ).trim();
    }

    prepareEngagementTriggerMetadata(triggerType = 'page_view', metadata = {}) {
        const normalizedTrigger = this.normalizeEngagementTriggerType(triggerType);
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
        if (this.getEngagementTriggerSourceEventId(source)) {
            return source;
        }
        if (normalizedTrigger && normalizedTrigger !== 'page_view') {
            source.source_event_id = [
                normalizedTrigger,
                this.getEngagementPageId(),
                Date.now().toString(36),
                Math.random().toString(36).slice(2, 8)
            ].join(':');
            source.source_event_id_generated = true;
        }
        return source;
    }

    getEngagementTriggerKey(triggerType = 'page_view', metadata = {}) {
        const normalizedTrigger = this.normalizeEngagementTriggerType(triggerType);
        const sourceEventId = this.getEngagementTriggerSourceEventId(metadata);
        return `${normalizedTrigger}:${this.getEngagementPageId()}:${sourceEventId || 'default'}`;
    }

    scheduleEngagementAutomationTriggers() {
        if (this.engagementTimeTriggerTimer) return;
        this.engagementTimeTriggerTimer = window.setTimeout(() => {
            void this.triggerEngagementEvent('time_on_page', {
                elapsed_seconds: 10,
                source: 'runtime_timer'
            });
        }, 10000);
        window.setTimeout(() => {
            this.triggerEngagementPageContextRules();
        }, 2600);

        if (!this.engagementScrollTriggerBound) {
            this.engagementScrollTriggerBound = true;
            let ticking = false;
            const handleScroll = () => {
                if (ticking) return;
                ticking = true;
                window.requestAnimationFrame(() => {
                    ticking = false;
                    const doc = document.documentElement;
                    const scrollTop = window.scrollY || doc.scrollTop || 0;
                    const viewportHeight = window.innerHeight || doc.clientHeight || 0;
                    const scrollHeight = Math.max(doc.scrollHeight || 0, document.body?.scrollHeight || 0, viewportHeight);
                    const percent = scrollHeight > viewportHeight
                        ? Math.round(((scrollTop + viewportHeight) / scrollHeight) * 100)
                        : 100;
                    if (percent >= 50) {
                        window.removeEventListener('scroll', handleScroll);
                        void this.triggerEngagementEvent('scroll_depth', {
                            scroll_percent: Math.min(100, Math.max(0, percent)),
                            source: 'runtime_scroll'
                        });
                    }
                });
            };
            window.addEventListener('scroll', handleScroll, { passive: true });
            handleScroll();
        }

        if (!this.engagementClickTriggerBound) {
            this.engagementClickTriggerBound = true;
            document.addEventListener('click', (event) => {
                const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
                const triggerElement = target?.closest?.('[data-engagement-trigger]');
                if (!triggerElement) return;
                const triggerType = this.normalizeEngagementTriggerType(triggerElement.dataset.engagementTrigger || 'click_action');
                void this.triggerEngagementEvent(triggerType, {
                    source: 'runtime_click',
                    element_id: triggerElement.id || '',
                    element_label: String(triggerElement.textContent || '').trim().slice(0, 120),
                    source_event_id: triggerElement.dataset.engagementEventId || ''
                }, {
                    once: triggerElement.dataset.engagementTriggerOnce !== 'false'
                });
            }, true);
        }
    }

    triggerEngagementPageContextRules() {
        const pageId = this.getEngagementPageId();
        const site = this.getEngagementBroadcastSite();
        const currentDate = this.getEngagementLocalDateKey(new Date());
        const eventEntries = [];

        if (['home', 'gongyi', 'verify'].includes(pageId)) {
            eventEntries.push(['usage_rules', 'page_usage_rules']);
        }
        if (['guestbook', 'prompts', 'gongyi'].includes(pageId)) {
            eventEntries.push(['community_rule', 'page_community_rule']);
        }

        eventEntries.forEach(([triggerType, source]) => {
            void this.triggerEngagementEvent(triggerType, {
                source_module: 'engagement.page_context',
                source,
                source_event_id: `${triggerType}:${site}:${pageId}:${currentDate}`,
                page_id: pageId,
                site,
                context_date: currentDate
            }, { once: true });
        });
    }

    getEngagementPageId() {
        const externalPageId = String(
            window.ZaoyoeExternalEngagementConfig?.pageId
                || window.ZaoyoeExternalEngagementConfig?.page_id
                || window.ZaoyoeEngagementExternalConfig?.pageId
                || window.ZaoyoeEngagementExternalConfig?.page_id
                || document.documentElement?.dataset?.engagementPageId
                || ''
        ).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (['home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook'].includes(externalPageId)) {
            return externalPageId;
        }
        const pathname = String(window.location?.pathname || '/').toLowerCase();
        if (/\/prompts(?:\.html)?\/?$/.test(pathname)) return 'prompts';
        if (/\/gongyi(?:\.html)?\/?$/.test(pathname)) return 'gongyi';
        if (/\/shop(?:\.html)?\/?$/.test(pathname)) return 'shop';
        if (/\/verify(?:\.html)?\/?$/.test(pathname)) return 'verify';
        if (/\/guestbook(?:\.html)?\/?$/.test(pathname)) return 'guestbook';
        return 'home';
    }

    getEngagementReaderKeyStorageKey(site = this.getEngagementBroadcastSite()) {
        return `zaoyoe_engagement_reader_key_${site}_v1`;
    }

    getEngagementDismissedStorageKey(site = this.getEngagementBroadcastSite()) {
        return `zaoyoe_engagement_dismissed_${site}_v1`;
    }

    getEngagementReaderKey() {
        const storageKey = this.getEngagementReaderKeyStorageKey();
        try {
            const existing = window.localStorage?.getItem(storageKey);
            if (existing) return existing;
            const generated = `reader_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            window.localStorage?.setItem(storageKey, generated);
            return generated;
        } catch (_) {
            return `reader_${Date.now().toString(36)}`;
        }
    }

    getEngagementDismissedMap() {
        try {
            const raw = window.localStorage?.getItem(this.getEngagementDismissedStorageKey());
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    persistEngagementDismissedMap(map = {}) {
        try {
            window.localStorage?.setItem(this.getEngagementDismissedStorageKey(), JSON.stringify(map));
        } catch (_) {
            // Ignore storage failures; the server-side event still records the action.
        }
    }

    getEngagementItemKey(item = {}) {
        const metadata = item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
            ? item.metadata
            : {};
        const id = String(item.id || item.notification_id || item.rule_id || '').trim();
        const source = String(item.source || 'engagement').trim() || 'engagement';
        const deliveryId = String(item.delivery_id || item.deliveryId || metadata.delivery_id || '').trim();
        if (id && deliveryId) {
            return `${source}:${id}:delivery:${deliveryId}`;
        }
        const deliveryKey = String(item.delivery_key || item.deliveryKey || metadata.delivery_key || '').trim();
        if (id && deliveryKey) {
            return `${source}:${id}:delivery:${deliveryKey}`;
        }
        const sourceEventId = String(item.source_event_id || item.sourceEventId || metadata.source_event_id || '').trim();
        if (id && sourceEventId) {
            return `${source}:${id}:event:${sourceEventId}`;
        }
        if (id) {
            return `${source}:${id}`;
        }
        const pageId = String(item.page_id || this.getEngagementPageId()).trim() || 'home';
        return `${source}:anonymous:${pageId}`;
    }

    getEngagementLegacyPageItemKey(item = {}) {
        const id = String(item.id || item.notification_id || item.rule_id || '').trim();
        const pageId = String(item.page_id || this.getEngagementPageId()).trim() || 'home';
        return `${String(item.source || 'engagement').trim() || 'engagement'}:${id}:${pageId}`;
    }

    getEngagementSemanticFamily(item = {}) {
        const normalized = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
        const metadata = normalized.metadata && typeof normalized.metadata === 'object' && !Array.isArray(normalized.metadata)
            ? normalized.metadata
            : {};
        const explicitFamily = String(
            normalized.semantic_family
                || normalized.semanticFamily
                || metadata.semantic_family
                || metadata.semanticFamily
                || ''
        ).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (explicitFamily) return explicitFamily;
        const triggerType = String(normalized.trigger_type || normalized.triggerType || metadata.trigger_type || metadata.triggerType || '').trim().toLowerCase();
        return this.engagementSemanticFamilyMap?.[triggerType] || '';
    }

    getEngagementSemanticDedupeKey(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return '';
        const semanticFamily = this.getEngagementSemanticFamily(normalized);
        const sourceEventId = String(normalized.source_event_id || normalized.delivery_key || normalized.delivery_id || '').trim();
        if (!semanticFamily || !sourceEventId) return '';
        return `${semanticFamily}:${sourceEventId}`;
    }

    getEngagementBridgeTriggerType(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return '';
        if (normalized.source === 'notification') {
            return this.getSystemNotificationAutomationTriggerType(normalized);
        }
        return this.normalizeEngagementTriggerType(
            normalized.trigger_type
                || normalized.triggerType
                || normalized.metadata?.trigger_type
                || normalized.metadata?.triggerType
                || normalized.metadata?.event_type
                || normalized.metadata?.eventType
                || ''
        );
    }

    getEngagementBridgeDedupeKey(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return '';
        const triggerType = this.getEngagementBridgeTriggerType(normalized);
        const sourceEventId = String(normalized.source_event_id || normalized.metadata?.source_event_id || '').trim();
        if (!triggerType || !sourceEventId) return '';
        return `bridge:${triggerType}:${sourceEventId}`;
    }

    getPendingEngagementSemanticEntry(semanticKey = '') {
        const normalizedSemanticKey = String(semanticKey || '').trim();
        if (!normalizedSemanticKey || !Array.isArray(this.engagementPendingItems) || !this.engagementPendingItems.length) {
            return null;
        }
        return this.engagementPendingItems.find((entry) => String(entry?.semanticKey || '').trim() === normalizedSemanticKey) || null;
    }

    getEngagementItemSuppressionKeys(item = {}) {
        const metadata = item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
            ? item.metadata
            : {};
        const keys = [
            this.getEngagementItemKey(item),
            this.getEngagementSemanticDedupeKey(item),
            this.getEngagementBridgeDedupeKey(item)
        ].filter(Boolean);
        const hasEventScopedIdentity = Boolean(
            String(item.source_event_id || item.sourceEventId || metadata.source_event_id || '').trim()
            || String(item.delivery_key || item.deliveryKey || metadata.delivery_key || '').trim()
            || String(item.delivery_id || item.deliveryId || metadata.delivery_id || '').trim()
        );
        if (!hasEventScopedIdentity) {
            keys.push(this.getEngagementLegacyPageItemKey(item));
        }
        return [...new Set(keys)];
    }

    isEngagementItemSuppressed(item = {}) {
        const keys = this.getEngagementItemSuppressionKeys(item);
        if (!keys.length) return false;
        const dismissedMap = this.getEngagementDismissedMap();
        let changed = false;
        let isSuppressed = false;
        keys.forEach((key) => {
            const expiresAt = dismissedMap[key];
            if (!expiresAt) return;
            const expiresMs = Number(expiresAt);
            if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
                delete dismissedMap[key];
                changed = true;
                return;
            }
            isSuppressed = true;
        });
        if (changed) {
            this.persistEngagementDismissedMap(dismissedMap);
        }
        return isSuppressed;
    }

    persistEngagementItemQuiet(item = {}, durationMs = 15 * 60 * 1000) {
        const keys = this.getEngagementItemSuppressionKeys(item);
        if (!keys.length) return;
        const normalizedDuration = Math.max(0, Number(durationMs || 0) || 0);
        if (normalizedDuration <= 0) return;
        const dismissedMap = this.getEngagementDismissedMap();
        const nextExpiresAt = Date.now() + normalizedDuration;
        keys.forEach((key) => {
            const currentExpiresAt = Number(dismissedMap[key] || 0) || 0;
            dismissedMap[key] = Math.max(currentExpiresAt, nextExpiresAt);
        });
        this.persistEngagementDismissedMap(dismissedMap);
    }

    normalizeEngagementRepeatIntervalMinutes(value, fallback = 2) {
        const parsed = Number.parseInt(value, 10);
        const fallbackParsed = Number.parseInt(fallback, 10);
        const normalizedFallback = Number.isFinite(fallbackParsed) ? Math.min(Math.max(fallbackParsed, 0), 1440) : 2;
        if (!Number.isFinite(parsed)) return normalizedFallback;
        return Math.min(Math.max(parsed, 0), 1440);
    }

    scheduleEngagementFollowupRefresh(delayMs = 800) {
        const normalizedDelay = Math.max(0, Number(delayMs || 0) || 0);
        const refreshTimer = window.setTimeout(() => {
            this.engagementFollowupRefreshTimers?.delete(refreshTimer);
            if (this.isOpen) return;
            void this.refreshEngagementFeed({ force: true }).catch((error) => {
                console.warn('[ChatWidget] Failed to refresh engagement follow-up feed:', error?.message || error);
            });
        }, normalizedDelay);
        this.engagementFollowupRefreshTimers?.add(refreshTimer);
    }

    clearEngagementScheduledRuleRefreshTimer() {
        if (this.engagementScheduledRuleRefreshTimer) {
            window.clearTimeout(this.engagementScheduledRuleRefreshTimer);
            this.engagementScheduledRuleRefreshTimer = null;
        }
    }

    scheduleEngagementScheduledRuleRefresh(nextStartsAt = '') {
        this.clearEngagementScheduledRuleRefreshTimer();
        const scheduledAt = nextStartsAt ? new Date(nextStartsAt) : null;
        if (!scheduledAt || !Number.isFinite(scheduledAt.getTime())) return;
        const delayMs = Math.min(2147480000, Math.max(250, scheduledAt.getTime() - Date.now() + 350));
        this.engagementScheduledRuleRefreshTimer = window.setTimeout(() => {
            this.engagementScheduledRuleRefreshTimer = null;
            if (this.isOpen) return;
            void this.refreshEngagementFeed({ force: true }).catch((error) => {
                console.warn('[ChatWidget] Failed to refresh scheduled engagement feed:', error?.message || error);
            });
        }, delayMs);
    }

    quietEngagementItemForRepeatInterval(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return;
        const repeatIntervalMinutes = this.normalizeEngagementRepeatIntervalMinutes(normalized.repeat_interval_minutes, 2);
        if (repeatIntervalMinutes <= 0) return;
        const durationMs = repeatIntervalMinutes * 60 * 1000;
        this.quietEngagementItemForSession(normalized, durationMs);
        this.persistEngagementItemQuiet(normalized, durationMs);
        this.scheduleEngagementFollowupRefresh(durationMs + 250);
    }

    isEngagementItemSessionQuiet(item = {}) {
        const keys = this.getEngagementItemSuppressionKeys(item);
        if (!keys.length) return false;
        let isQuiet = false;
        keys.forEach((key) => {
            if (!this.engagementSessionQuietUntil?.has(key)) return;
            const quietUntil = Number(this.engagementSessionQuietUntil.get(key) || 0);
            if (!Number.isFinite(quietUntil) || quietUntil <= Date.now()) {
                this.engagementSessionQuietUntil.delete(key);
                return;
            }
            isQuiet = true;
        });
        return isQuiet;
    }

    quietEngagementItemForSession(item = {}, durationMs = 15 * 60 * 1000) {
        const keys = this.getEngagementItemSuppressionKeys(item);
        if (!keys.length) return;
        const normalizedDuration = Math.max(60 * 1000, Number(durationMs || 0) || 0);
        const quietUntil = Date.now() + normalizedDuration;
        keys.forEach((key) => {
            this.engagementSessionQuietUntil.set(key, quietUntil);
        });
    }

    normalizeEngagementDismissTtlHours(value, fallback = 24) {
        if (value === 0 || value === '0') return 0;
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        const fallbackParsed = Number(fallback);
        return Number.isFinite(fallbackParsed) && fallbackParsed >= 0 ? fallbackParsed : 24;
    }

    suppressEngagementItem(item = {}) {
        const keys = this.getEngagementItemSuppressionKeys(item);
        if (!keys.length) return;
        const ttlHours = this.normalizeEngagementDismissTtlHours(item.dismiss_ttl_hours, 24);
        if (ttlHours <= 0) {
            this.quietEngagementItemForSession(item, 30 * 60 * 1000);
            return;
        }
        const dismissedMap = this.getEngagementDismissedMap();
        const nextExpiresAt = Date.now() + ttlHours * 60 * 60 * 1000;
        keys.forEach((key) => {
            const currentExpiresAt = Number(dismissedMap[key] || 0) || 0;
            dismissedMap[key] = Math.max(currentExpiresAt, nextExpiresAt);
        });
        this.persistEngagementDismissedMap(dismissedMap);
    }

    async getEngagementAccessToken() {
        try {
            const result = await window.supabaseClient?.auth?.getSession?.();
            return result?.data?.session?.access_token || '';
        } catch (_) {
            return '';
        }
    }

    getEngagementExternalConfig() {
        const config = window.ZaoyoeExternalEngagementConfig || window.ZaoyoeEngagementExternalConfig || {};
        return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    }

    getEngagementApiOrigin() {
        const config = this.getEngagementExternalConfig();
        const rawOrigin = String(config.apiOrigin || config.api_origin || config.apiBase || config.api_base || '').trim();
        if (!rawOrigin) return '';
        try {
            return new URL(rawOrigin, window.location.href).origin;
        } catch (_) {
            return '';
        }
    }

    resolveEngagementApiUrl(pathname = '') {
        const apiOrigin = this.getEngagementApiOrigin();
        const path = String(pathname || '').trim();
        if (!apiOrigin || !path.startsWith('/')) return path;
        try {
            return new URL(path, apiOrigin).toString();
        } catch (_) {
            return path;
        }
    }

    getEngagementFetchCredentials() {
        return this.getEngagementApiOrigin() ? 'omit' : 'same-origin';
    }

    getEngagementApiUrls(route = '', params = null) {
        const normalizedRoute = String(route || '').trim().replace(/^\/+|\/+$/g, '');
        const query = params instanceof URLSearchParams
            ? params.toString()
            : new URLSearchParams(params || {}).toString();
        const suffix = query ? `?${query}` : '';
        const fallbackParams = new URLSearchParams(params instanceof URLSearchParams ? params : (params || {}));
        fallbackParams.set('scope', 'engagement');
        fallbackParams.set('route', normalizedRoute);
        return [
            this.resolveEngagementApiUrl(`/api/engagement/${encodeURIComponent(normalizedRoute)}${suffix}`),
            this.resolveEngagementApiUrl(`/api/public?${fallbackParams.toString()}`)
        ];
    }

    normalizeEngagementItem(item = {}) {
        const normalized = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
        const title = String(normalized.title || '小助手提醒').trim() || '小助手提醒';
        const content = String(normalized.content || '').trim();
        if (!content) return null;
        const metadata = normalized.metadata && typeof normalized.metadata === 'object' && !Array.isArray(normalized.metadata)
            ? normalized.metadata
            : {};
        return {
            ...normalized,
            id: String(normalized.id || normalized.notification_id || normalized.rule_id || '').trim(),
            title,
            content,
            trigger_type: String(normalized.trigger_type || normalized.triggerType || metadata.trigger_type || metadata.triggerType || '').trim().toLowerCase(),
            action_label: String(normalized.action_label || '').trim(),
            action_url: String(normalized.action_url || '').trim(),
            page_id: String(normalized.page_id || this.getEngagementPageId()).trim() || this.getEngagementPageId(),
            site: String(normalized.site || window.SiteConfig?.site || 'cn').trim().toLowerCase() || 'cn',
            placement: this.normalizeEngagementPlacement(normalized.placement || metadata.placement || metadata.display_type || metadata.displayType),
            priority: Number(normalized.priority || 0) || 0,
            tone: String(normalized.tone || 'info').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'info',
            source: String(normalized.source || 'rule').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'rule',
            source_module: String(normalized.source_module || 'engagement').trim() || 'engagement',
            source_event_id: String(normalized.source_event_id || '').trim(),
            delivery_id: String(normalized.delivery_id || normalized.deliveryId || metadata.delivery_id || '').trim(),
            delivery_key: String(normalized.delivery_key || normalized.deliveryKey || metadata.delivery_key || '').trim(),
            notification_id: String(normalized.notification_id || '').trim(),
            rule_id: String(normalized.rule_id || '').trim(),
            frequency: String(normalized.frequency || metadata.frequency || 'once_per_day').trim().toLowerCase() || 'once_per_day',
            dismiss_ttl_hours: this.normalizeEngagementDismissTtlHours(normalized.dismiss_ttl_hours, 24),
            repeat_interval_minutes: this.normalizeEngagementRepeatIntervalMinutes(
                normalized.repeat_interval_minutes
                    ?? normalized.repeatIntervalMinutes
                    ?? metadata.repeat_interval_minutes
                    ?? metadata.repeatIntervalMinutes,
                2
            ),
            metadata
        };
    }

    normalizeEngagementPlacement(value = 'robot_bubble') {
        const normalized = String(value || 'robot_bubble').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'robot_bubble';
        return ['robot_bubble', 'top_banner', 'inline_card', 'modal', 'floating_badge'].includes(normalized)
            ? normalized
            : 'robot_bubble';
    }

    normalizeEngagementWalletView(view = '') {
        const normalized = String(view || '').trim().toLowerCase().replace(/_/g, '-').replace(/^view-/, '');
        const aliases = {
            order: 'orders',
            transaction: 'orders',
            transactions: 'orders',
            'shop-orders': 'orders',
            'order-history': 'orders',
            card: 'cards',
            coupon: 'cards',
            coupons: 'cards',
            'coupon-assets': 'cards',
            'discount-assets': 'cards',
            discounts: 'cards',
            'wallet-card': 'cards',
            'wallet-cards': 'cards',
            point: 'balance',
            points: 'balance',
            credit: 'balance',
            credits: 'balance'
        };
        const viewId = aliases[normalized] || normalized;
        return ['balance', 'cards', 'recharge', 'orders', 'affiliate', 'checkin'].includes(viewId) ? viewId : '';
    }

    getEngagementWalletViewFromActionUrl(actionUrl = '') {
        const rawUrl = String(actionUrl || '').trim();
        if (!rawUrl) return '';

        if (/^wallet:/i.test(rawUrl)) {
            const walletTarget = rawUrl
                .replace(/^wallet:(\/\/)?/i, '')
                .replace(/^\/+/, '')
                .split(/[?#/]/)[0];
            return this.normalizeEngagementWalletView(decodeURIComponent(walletTarget || 'balance'));
        }

        if (/^shop:/i.test(rawUrl)) {
            const shopTarget = rawUrl
                .replace(/^shop:(\/\/)?/i, '')
                .replace(/^\/+/, '')
                .split(/[?#/]/)[0];
            const resolvedView = this.normalizeEngagementWalletView(decodeURIComponent(shopTarget || 'orders'));
            if (resolvedView === 'orders') {
                return resolvedView;
            }
        }

        try {
            const targetUrl = new URL(rawUrl, window.location.origin);
            const queryView = targetUrl.searchParams.get('wallet_view') || targetUrl.searchParams.get('wallet');
            if (queryView) {
                return this.normalizeEngagementWalletView(queryView);
            }

            const hash = decodeURIComponent(String(targetUrl.hash || '').replace(/^#/, '').trim());
            if (hash === 'wallet') {
                return 'balance';
            }
            if (hash.startsWith('wallet/')) {
                return this.normalizeEngagementWalletView(hash.slice('wallet/'.length));
            }
            if (hash.startsWith('wallet:')) {
                return this.normalizeEngagementWalletView(hash.slice('wallet:'.length));
            }
        } catch (_) {
            return '';
        }

        return '';
    }

    detectEngagementWalletViewFromText(text = '') {
        const content = String(text || '');
        if (/(我的钱包\s*[>＞]\s*卡券|Wallet\s*[>＞]\s*Cards)/iu.test(content)) {
            return 'cards';
        }
        return '';
    }

    detectEngagementRouteLabel(text = '', walletView = '') {
        const content = String(text || '');
        const cardsMatch = content.match(/(我的钱包\s*[>＞]\s*卡券|Wallet\s*[>＞]\s*Cards)/iu);
        if (cardsMatch) {
            return cardsMatch[0];
        }
        if (walletView === 'cards') {
            return '我的钱包 > 卡券';
        }
        return '';
    }

    getEngagementInlineRouteTarget(item = {}, previewText = '') {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return null;

        const metadata = normalized.metadata || {};
        const text = String(previewText || normalized.content || '');
        let walletView = this.normalizeEngagementWalletView(
            metadata.wallet_view
                || metadata.walletView
                || metadata.action_wallet_view
                || metadata.target_wallet_view
                || ''
        );
        if (!walletView) {
            walletView = this.detectEngagementWalletViewFromText(text);
        }

        let actionUrl = String(
            metadata.action_path_url
                || metadata.route_url
                || metadata.target_url
                || ''
        ).trim();
        if (!actionUrl && walletView) {
            actionUrl = `wallet://${walletView}`;
        }
        if (!actionUrl && metadata.action_url) {
            actionUrl = String(metadata.action_url || '').trim();
        }

        const actionKind = String(
            metadata.action_path_kind
                || metadata.action_kind
                || metadata.route_kind
                || ''
        ).trim().toLowerCase();
        const label = String(
            metadata.action_path_label
                || metadata.route_label
                || metadata.target_path_label
                || this.detectEngagementRouteLabel(text, walletView)
                || ''
        ).trim();

        if (!label || (!actionUrl && !walletView)) {
            return null;
        }

        return {
            label,
            action_url: actionUrl,
            action_kind: actionKind || (walletView ? 'wallet' : ''),
            wallet_view: walletView
        };
    }

    escapeRegExp(text = '') {
        return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    getEngagementInlineRoutePattern(target = {}) {
        const walletView = this.normalizeEngagementWalletView(target.wallet_view);
        if (walletView === 'cards' || /我的钱包|Wallet/i.test(String(target.label || ''))) {
            return /(我的钱包\s*[>＞]\s*卡券|Wallet\s*[>＞]\s*Cards)/iu;
        }
        const label = String(target.label || '').trim();
        return label ? new RegExp(this.escapeRegExp(label), 'u') : null;
    }

    renderEngagementRouteLinkText(text = '', target = {}) {
        const content = String(text || '');
        const pattern = this.getEngagementInlineRoutePattern(target);
        const match = pattern ? content.match(pattern) : null;
        if (!match || typeof match.index !== 'number') {
            return this.escapeHtml(content);
        }

        const matchedLabel = match[0];
        const before = content.slice(0, match.index);
        const after = content.slice(match.index + matchedLabel.length);
        const actionUrl = String(target.action_url || '').trim();
        const actionKind = String(target.action_kind || '').trim();
        const walletView = this.normalizeEngagementWalletView(target.wallet_view);

        return [
            this.escapeHtml(before),
            `<button type="button" class="engagement-preview__path-link" data-engagement-route-link="1" data-engagement-action-url="${this.escapeAttribute(actionUrl)}" data-engagement-action-kind="${this.escapeAttribute(actionKind)}" data-engagement-wallet-view="${this.escapeAttribute(walletView)}">${this.escapeHtml(matchedLabel)}</button>`,
            this.escapeHtml(after)
        ].join('');
    }

    renderEngagementContentHtml(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return '';
        const previewText = `${normalized.content.substring(0, 120)}${normalized.content.length > 120 ? '...' : ''}`;
        const routeTarget = this.getEngagementInlineRouteTarget(normalized, previewText);
        return routeTarget
            ? this.renderEngagementRouteLinkText(previewText, routeTarget)
            : this.escapeHtml(previewText);
    }

    normalizeEngagementHexColor(value = '', fallback = '#6b9ece') {
        const normalized = String(value || '').trim().toLowerCase();
        return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
    }

    getEngagementHexLuma(hexColor = '') {
        const normalized = this.normalizeEngagementHexColor(hexColor, '#000000').replace('#', '');
        const red = Number.parseInt(normalized.slice(0, 2), 16) || 0;
        const green = Number.parseInt(normalized.slice(2, 4), 16) || 0;
        const blue = Number.parseInt(normalized.slice(4, 6), 16) || 0;
        return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    }

    deriveEngagementDarkPalette(style = {}) {
        const bubbleBackground = this.normalizeEngagementHexColor(style.bubble_background, '#ffffff');
        const textColor = this.normalizeEngagementHexColor(style.text_color, '#1f2937');
        const titleColor = this.normalizeEngagementHexColor(style.title_color, '#5f95cc');
        const accentColor = this.normalizeEngagementHexColor(style.accent_color, '#6b9ece');
        const bubbleIsLight = this.getEngagementHexLuma(bubbleBackground) > 0.62;
        const textIsDark = this.getEngagementHexLuma(textColor) < 0.45;
        const titleIsDark = this.getEngagementHexLuma(titleColor) < 0.45;
        const accentIsDark = this.getEngagementHexLuma(accentColor) < 0.38;
        return {
            bubble_background_dark: bubbleIsLight ? '#111827' : bubbleBackground,
            text_color_dark: textIsDark ? '#e2e8f0' : textColor,
            title_color_dark: titleIsDark ? '#bfdbfe' : titleColor,
            accent_color_dark: accentIsDark ? '#93c5fd' : accentColor
        };
    }

    normalizeEngagementAssetStyle(style = {}) {
        const source = style && typeof style === 'object' && !Array.isArray(style) ? style : {};
        const density = String(source.density || 'comfortable').trim().toLowerCase();
        const shadow = String(source.shadow || 'soft').trim().toLowerCase();
        const animation = String(source.animation || 'gentle').trim().toLowerCase();
        const robotVariant = String(source.robot_variant || source.robotVariant || 'default').trim().toLowerCase();
        const radius = Math.min(Math.max(Number.parseInt(source.radius_px || source.radiusPx || 22, 10) || 22, 12), 32);
        const maxWidth = Math.min(Math.max(Number.parseInt(source.max_width_px || source.maxWidthPx || 520, 10) || 520, 260), 560);
        const normalized = {
            enabled: source.enabled !== false,
            preset: String(source.preset || 'studio_blue').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'studio_blue',
            accent_color: this.normalizeEngagementHexColor(source.accent_color || source.accentColor, '#6b9ece'),
            title_color: this.normalizeEngagementHexColor(source.title_color || source.titleColor, '#5f95cc'),
            bubble_background: this.normalizeEngagementHexColor(source.bubble_background || source.bubbleBackground, '#ffffff'),
            text_color: this.normalizeEngagementHexColor(source.text_color || source.textColor, '#1f2937'),
            radius_px: radius,
            max_width_px: maxWidth,
            density: ['compact', 'comfortable', 'spacious'].includes(density) ? density : 'comfortable',
            shadow: ['none', 'soft', 'elevated'].includes(shadow) ? shadow : 'soft',
            animation: ['none', 'gentle', 'lively'].includes(animation) ? animation : 'gentle',
            robot_variant: ['default', 'rounded', 'minimal'].includes(robotVariant) ? robotVariant : 'default'
        };
        return {
            ...normalized,
            ...this.deriveEngagementDarkPalette(normalized)
        };
    }

    applyEngagementAssetStyle(style = {}) {
        const normalized = this.normalizeEngagementAssetStyle(style);
        if (!normalized.enabled) return;
        const root = document.documentElement;
        root.style.setProperty('--engagement-accent-color', normalized.accent_color);
        root.style.setProperty('--engagement-title-color', normalized.title_color);
        root.style.setProperty('--engagement-bubble-bg', normalized.bubble_background);
        root.style.setProperty('--engagement-text-color', normalized.text_color);
        root.style.setProperty('--engagement-bubble-radius', `${normalized.radius_px}px`);
        root.style.setProperty('--engagement-bubble-max-width', `${normalized.max_width_px}px`);
        root.style.setProperty('--engagement-accent-color-dark', normalized.accent_color_dark);
        root.style.setProperty('--engagement-title-color-dark', normalized.title_color_dark);
        root.style.setProperty('--engagement-bubble-bg-dark', normalized.bubble_background_dark);
        root.style.setProperty('--engagement-text-color-dark', normalized.text_color_dark);
        root.dataset.engagementStylePreset = normalized.preset;
        root.dataset.engagementDensity = normalized.density;
        root.dataset.engagementShadow = normalized.shadow;
        root.dataset.engagementAnimation = normalized.animation;
        root.dataset.engagementRobot = normalized.robot_variant;
    }

    getEngagementRouteTargetFromElement(element) {
        if (!element) return null;
        return {
            label: String(element.textContent || '').trim(),
            action_url: String(element.dataset.engagementActionUrl || '').trim(),
            action_kind: String(element.dataset.engagementActionKind || '').trim(),
            wallet_view: this.normalizeEngagementWalletView(element.dataset.engagementWalletView || '')
        };
    }

    getEngagementClientTheme() {
        const explicitTheme = String(document.documentElement?.getAttribute('data-theme') || '').trim().toLowerCase();
        if (explicitTheme === 'dark' || explicitTheme === 'light') return explicitTheme;
        return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
    }

    getEngagementClientDevice() {
        const width = Math.round(window.innerWidth || document.documentElement?.clientWidth || 0);
        if (width > 0 && width <= 720) return 'mobile';
        if (width > 720 && width <= 1100) return 'tablet';
        return 'desktop';
    }

    getEngagementExperienceContext(extra = {}) {
        const root = document.documentElement;
        const viewportWidth = Math.round(window.innerWidth || root?.clientWidth || 0);
        const viewportHeight = Math.round(window.innerHeight || root?.clientHeight || 0);
        const visualViewport = window.visualViewport;
        return {
            theme: this.getEngagementClientTheme(),
            device: this.getEngagementClientDevice(),
            viewport_width: viewportWidth,
            viewport_height: viewportHeight,
            visual_viewport_width: visualViewport ? Math.round(visualViewport.width || viewportWidth) : viewportWidth,
            visual_viewport_height: visualViewport ? Math.round(visualViewport.height || viewportHeight) : viewportHeight,
            pixel_ratio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
            page_path: String(window.location?.pathname || '/'),
            page_origin: String(window.location?.origin || ''),
            page_host: String(window.location?.host || ''),
            page_id: this.getEngagementPageId(),
            support_context: this.supportContextKey || this.getSupportContextKey?.() || 'default',
            external_host: this.getEngagementExternalConfig().externalHost === true || this.getEngagementExternalConfig().external_host === true,
            external_api_origin: this.getEngagementApiOrigin(),
            style_preset: root?.dataset?.engagementStylePreset || 'studio_blue',
            density: root?.dataset?.engagementDensity || 'comfortable',
            shadow: root?.dataset?.engagementShadow || 'soft',
            animation: root?.dataset?.engagementAnimation || 'gentle',
            robot_variant: root?.dataset?.engagementRobot || 'default',
            ...extra
        };
    }

    measureEngagementElement(element, placement = '') {
        if (!element?.getBoundingClientRect) {
            return {};
        }
        const rect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
        const edgeGap = Math.min(
            Math.max(0, rect.left),
            Math.max(0, viewportWidth - rect.right),
            Math.max(0, rect.top),
            Math.max(0, viewportHeight - rect.bottom)
        );
        return {
            placement: this.normalizeEngagementPlacement(placement),
            bubble_width: Math.round(rect.width || 0),
            bubble_height: Math.round(rect.height || 0),
            viewport_edge_gap: Math.round(edgeGap),
            overflows_viewport: rect.left < 0 || rect.top < 0 || rect.right > viewportWidth || rect.bottom > viewportHeight,
            bottom_gap: Math.round(Math.max(0, viewportHeight - rect.bottom)),
            right_gap: Math.round(Math.max(0, viewportWidth - rect.right))
        };
    }

    getEngagementElementMetrics(element, placement = '') {
        return this.measureEngagementElement(element, placement);
    }

    getEngagementFeedbackTarget(element = null, root = null) {
        const source = element?.nodeType === 1 ? element : element?.parentElement;
        return source?.closest?.('.engagement-preview__action, .engagement-surface__action, .engagement-preview__path-link')
            || root?.querySelector?.('.engagement-preview__action, .engagement-surface__action')
            || null;
    }

    setEngagementActionLoading(element = null, root = null, label = '') {
        const target = this.getEngagementFeedbackTarget(element, root);
        if (!target || target.dataset.engagementActionLoading === '1') return target;

        const loadingLabel = String(label || this.t('chat.loading', '加载中...'));
        const rect = typeof target.getBoundingClientRect === 'function'
            ? target.getBoundingClientRect()
            : null;
        target.dataset.engagementActionLoading = '1';
        target.dataset.engagementOriginalHtml = target.innerHTML;
        target.dataset.engagementOriginalMinWidth = target.style.minWidth || '';
        target.dataset.engagementOriginalAriaLabel = target.getAttribute('aria-label') || '';
        target.dataset.engagementHadAriaLabel = target.hasAttribute('aria-label') ? '1' : '0';
        target.dataset.engagementWasDisabled = target.disabled === true ? '1' : '0';
        if (rect?.width > 0) {
            target.style.minWidth = `${Math.ceil(rect.width)}px`;
        }
        target.classList.add('is-loading');
        target.setAttribute('aria-busy', 'true');
        target.setAttribute('aria-label', loadingLabel);
        if ('disabled' in target) {
            target.disabled = true;
        }
        target.innerHTML = this.getChatInlineLoadingDotsMarkup(loadingLabel);
        return target;
    }

    clearEngagementActionLoading(element = null) {
        if (!element || element.dataset?.engagementActionLoading !== '1') return;

        element.innerHTML = element.dataset.engagementOriginalHtml || '';
        element.style.minWidth = element.dataset.engagementOriginalMinWidth || '';
        element.classList.remove('is-loading');
        element.removeAttribute('aria-busy');
        if (element.dataset.engagementHadAriaLabel === '1') {
            element.setAttribute('aria-label', element.dataset.engagementOriginalAriaLabel || '');
        } else {
            element.removeAttribute('aria-label');
        }
        if ('disabled' in element) {
            element.disabled = element.dataset.engagementWasDisabled === '1';
        }

        delete element.dataset.engagementActionLoading;
        delete element.dataset.engagementOriginalHtml;
        delete element.dataset.engagementOriginalMinWidth;
        delete element.dataset.engagementOriginalAriaLabel;
        delete element.dataset.engagementHadAriaLabel;
        delete element.dataset.engagementWasDisabled;
    }

    isEngagementGuestbookPath(pathname = '') {
        return /\/guestbook(?:\.html)?\/?$/i.test(String(pathname || '').trim());
    }

    getEngagementRouteMetadataContexts(metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        const feedContext = source.feed_context && typeof source.feed_context === 'object' && !Array.isArray(source.feed_context)
            ? source.feed_context
            : {};
        const eventContext = feedContext.event_context && typeof feedContext.event_context === 'object' && !Array.isArray(feedContext.event_context)
            ? feedContext.event_context
            : {};
        const directEventContext = source.event_context && typeof source.event_context === 'object' && !Array.isArray(source.event_context)
            ? source.event_context
            : {};
        return [source, feedContext, eventContext, directEventContext];
    }

    getEngagementRouteMetadataValue(metadata = {}, candidateKeys = []) {
        const keys = Array.isArray(candidateKeys) ? candidateKeys : [candidateKeys];
        const contexts = this.getEngagementRouteMetadataContexts(metadata);
        for (const context of contexts) {
            for (const key of keys) {
                const value = context?.[key];
                if (value === undefined || value === null) continue;
                const normalized = String(value).trim();
                if (normalized) {
                    return normalized;
                }
            }
        }
        return '';
    }

    getEngagementRouteMetadataValues(metadata = {}, candidateKeys = []) {
        const keys = Array.isArray(candidateKeys) ? candidateKeys : [candidateKeys];
        const values = [];
        const appendValue = (value) => {
            if (Array.isArray(value)) {
                value.forEach(appendValue);
                return;
            }
            if (value === undefined || value === null) return;
            String(value)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
                .forEach((item) => values.push(item));
        };

        this.getEngagementRouteMetadataContexts(metadata).forEach((context) => {
            keys.forEach((key) => appendValue(context?.[key]));
        });

        return [...new Set(values)];
    }

    getEngagementWalletOrderDetailTarget(actionUrl = '', metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        const orderIds = [];
        const appendOrderIds = (items = []) => {
            (Array.isArray(items) ? items : [items])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .forEach((item) => orderIds.push(item));
        };
        const rawActionUrl = String(actionUrl || '').trim();
        let targetUrl = null;
        let isOrderRoute = false;

        if (rawActionUrl) {
            try {
                targetUrl = new URL(rawActionUrl, window.location.origin);
                const routeParts = [
                    String(targetUrl.hostname || '').trim(),
                    String(targetUrl.pathname || '').replace(/^\/+/, '').trim()
                ].filter(Boolean).join('/').toLowerCase();
                isOrderRoute = ['wallet:', 'shop:'].includes(targetUrl.protocol)
                    && /(^|\/)(orders|order-history|shop-orders)$/.test(routeParts || 'orders');
                appendOrderIds([
                    targetUrl.searchParams.get('order_id'),
                    targetUrl.searchParams.get('orderId'),
                    targetUrl.searchParams.get('shop_order_id'),
                    targetUrl.searchParams.get('shopOrderId'),
                    targetUrl.searchParams.get('order_ids'),
                    targetUrl.searchParams.get('orderIds'),
                    targetUrl.searchParams.get('shop_order_ids'),
                    targetUrl.searchParams.get('shopOrderIds')
                ]);
                if (isOrderRoute) {
                    appendOrderIds(targetUrl.searchParams.get('id'));
                }
            } catch (_) {
                targetUrl = null;
            }
        }

        appendOrderIds(this.getEngagementRouteMetadataValues(source, [
            'order_id',
            'orderId',
            'shop_order_id',
            'shopOrderId',
            'target_order_id',
            'targetOrderId',
            'reference_order_id',
            'referenceOrderId',
            'source_order_id',
            'sourceOrderId'
        ]));
        appendOrderIds(this.getEngagementRouteMetadataValues(source, [
            'order_ids',
            'orderIds',
            'shop_order_ids',
            'shopOrderIds'
        ]));

        const uniqueOrderIds = [...new Set(orderIds)];
        return uniqueOrderIds.length
            ? {
                orderId: uniqueOrderIds[0],
                orderIds: uniqueOrderIds
            }
            : null;
    }

    getEngagementWalletReturnContext(metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        const target = this.getEngagementRouteMetadataValue(source, ['shop_return_target', 'shopReturnTarget']);
        if (!target) {
            return {};
        }

        const productIds = this.getEngagementRouteMetadataValues(source, ['shop_return_product_ids', 'shopReturnProductIds', 'product_ids', 'productIds']);
        const productId = this.getEngagementRouteMetadataValue(source, [
            'shop_return_product_id',
            'shopReturnProductId',
            'product_id',
            'productId'
        ]) || productIds[0] || '';
        const quantity = this.getEngagementRouteMetadataValue(source, ['shop_return_quantity', 'shopReturnQuantity', 'quantity']);
        const checkout = this.getEngagementRouteMetadataValue(source, ['shop_return_checkout', 'shopReturnCheckout']);

        return {
            shop_return_target: target,
            shop_return_source: this.getEngagementRouteMetadataValue(source, ['shop_return_source', 'shopReturnSource', 'source']),
            shop_return_product_id: productId,
            shop_return_product_ids: productIds,
            shop_return_quantity: quantity || null,
            shop_return_checkout: checkout === 'true' || checkout === '1'
        };
    }

    getEngagementSupportTarget(actionUrl = '', metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        const rawActionUrl = String(actionUrl || '').trim();
        if (!/^support:/i.test(rawActionUrl)) {
            return null;
        }

        let supportPath = '';
        let targetUrl = null;
        try {
            targetUrl = new URL(rawActionUrl, window.location.origin);
            supportPath = decodeURIComponent([
                String(targetUrl.hostname || '').trim(),
                String(targetUrl.pathname || '').replace(/^\/+/, '').trim()
            ].filter(Boolean).join('/')).toLowerCase();
        } catch (_) {
            supportPath = decodeURIComponent(
                rawActionUrl
                    .replace(/^support:(\/\/)?/i, '')
                    .replace(/^\/+/, '')
                    .split(/[?#]/)[0]
            ).toLowerCase();
        }

        if (!['tickets', 'ticket-history', 'ticket_history'].includes(supportPath)) {
            return null;
        }

        return {
            type: 'ticket_history',
            ticketId: String(
                targetUrl?.searchParams?.get('ticketId')
                    || targetUrl?.searchParams?.get('ticket_id')
                    || this.getEngagementRouteMetadataValue(source, ['ticketId', 'ticket_id', 'supportTicketId', 'support_ticket_id'])
                    || ''
            ).trim(),
            orderId: String(
                targetUrl?.searchParams?.get('orderId')
                    || targetUrl?.searchParams?.get('order_id')
                    || this.getEngagementRouteMetadataValue(source, ['orderId', 'order_id', 'shopOrderId', 'shop_order_id'])
                    || ''
            ).trim(),
            ticketStatus: String(
                this.getEngagementRouteMetadataValue(source, ['ticketStatus', 'ticket_status'])
                    || ''
            ).trim(),
            ticketStatusLabel: String(
                this.getEngagementRouteMetadataValue(source, ['ticketStatusLabel', 'ticket_status_label'])
                    || ''
            ).trim()
        };
    }

    async openSupportTicketHistoryFromEngagement(target = {}) {
        await this.openChat();
        await this.openSupportAction('ticket_history', {
            context: target
        });
        this.clearUnread();
        return true;
    }

    getEngagementGuestbookReplyTarget(actionUrl = '', metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        let targetUrl = null;
        let urlTargetsGuestbook = false;

        const rawActionUrl = String(actionUrl || '').trim();
        if (rawActionUrl) {
            try {
                targetUrl = new URL(rawActionUrl, window.location.origin);
                urlTargetsGuestbook = targetUrl.origin === window.location.origin
                    && this.isEngagementGuestbookPath(targetUrl.pathname);
            } catch (_) {
                targetUrl = null;
            }
        }

        const metadataPageId = String(source.page_id || source.pageId || source.page || '').trim().toLowerCase();
        const metadataSource = String(source.source || '').trim().toLowerCase();
        const metadataSourceModule = String(source.source_module || source.sourceModule || '').trim().toLowerCase();
        const metadataTargetsGuestbook = metadataPageId === 'guestbook'
            || metadataSource === 'guestbook_comment'
            || metadataSourceModule === 'guestbook';

        if (!urlTargetsGuestbook && !metadataTargetsGuestbook) {
            return null;
        }

        const messageId = String(
            targetUrl?.searchParams?.get('messageId')
                || targetUrl?.searchParams?.get('message_id')
                || this.getEngagementRouteMetadataValue(source, ['messageId', 'message_id'])
                || ''
        ).trim();
        const commentId = String(
            targetUrl?.searchParams?.get('commentId')
                || targetUrl?.searchParams?.get('comment_id')
                || this.getEngagementRouteMetadataValue(source, ['commentId', 'comment_id'])
                || ''
        ).trim();

        if (!messageId) {
            return null;
        }

        return {
            messageId,
            commentId,
            targetUrl,
            urlTargetsGuestbook
        };
    }

    isCurrentEngagementGuestbookPage() {
        return this.isEngagementGuestbookPath(window.location?.pathname || '')
            || (this.getEngagementPageId() === 'guestbook' && typeof window.handleSmartScroll === 'function');
    }

    waitForGuestbookSmartScroll(timeoutMs = 5200) {
        if (typeof window.handleSmartScroll === 'function') {
            return Promise.resolve(window.handleSmartScroll);
        }

        const startedAt = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                if (typeof window.handleSmartScroll === 'function') {
                    resolve(window.handleSmartScroll);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(null);
                    return;
                }
                window.setTimeout(check, 80);
            };
            check();
        });
    }

    async focusGuestbookReplyFromEngagement(target = {}) {
        if (!this.isCurrentEngagementGuestbookPage()) {
            return false;
        }

        const smartScroll = await this.waitForGuestbookSmartScroll();
        if (typeof smartScroll !== 'function') {
            throw new Error('Guestbook smart scroll is not ready');
        }

        const focused = target.commentId
            ? await Promise.resolve(smartScroll(target.commentId, 'comment', target.messageId))
            : await Promise.resolve(smartScroll(target.messageId, 'message'));
        if (focused === false) {
            return false;
        }
        this.clearUnread();
        return true;
    }

    isEngagementPromptsPath(pathname = '') {
        return /\/prompts(?:\.html)?\/?$/i.test(String(pathname || '').trim());
    }

    getEngagementPromptReplyTarget(actionUrl = '', metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        let targetUrl = null;
        let urlTargetsPrompts = false;

        const rawActionUrl = String(actionUrl || '').trim();
        if (rawActionUrl) {
            try {
                targetUrl = new URL(rawActionUrl, window.location.origin);
                urlTargetsPrompts = targetUrl.origin === window.location.origin
                    && this.isEngagementPromptsPath(targetUrl.pathname);
            } catch (_) {
                targetUrl = null;
            }
        }

        const metadataPageId = String(source.page_id || source.pageId || source.page || '').trim().toLowerCase();
        const metadataSource = String(source.source || '').trim().toLowerCase();
        const metadataSourceModule = String(source.source_module || source.sourceModule || '').trim().toLowerCase();
        const metadataTargetsPrompts = metadataPageId === 'prompts'
            || metadataSource === 'prompt_comment'
            || metadataSourceModule === 'prompts'
            || metadataSourceModule === 'prompt';

        if (!urlTargetsPrompts && !metadataTargetsPrompts) {
            return null;
        }

        const promptId = String(
            targetUrl?.searchParams?.get('id')
                || targetUrl?.searchParams?.get('promptId')
                || targetUrl?.searchParams?.get('prompt_id')
                || this.getEngagementRouteMetadataValue(source, ['promptId', 'prompt_id', 'id'])
                || ''
        ).trim();
        const commentId = String(
            targetUrl?.searchParams?.get('commentId')
                || targetUrl?.searchParams?.get('comment_id')
                || this.getEngagementRouteMetadataValue(source, ['commentId', 'comment_id'])
                || ''
        ).trim();

        if (!promptId) {
            return null;
        }

        return {
            promptId,
            commentId,
            targetUrl,
            urlTargetsPrompts
        };
    }

    isCurrentEngagementPromptsPage() {
        return this.isEngagementPromptsPath(window.location?.pathname || '')
            || (this.getEngagementPageId() === 'prompts' && typeof window.ZaoyoePromptsFocusCommentFromEngagement === 'function');
    }

    waitForPromptsCommentFocus(timeoutMs = 2600) {
        if (typeof window.ZaoyoePromptsFocusCommentFromEngagement === 'function') {
            return Promise.resolve(window.ZaoyoePromptsFocusCommentFromEngagement);
        }

        const startedAt = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                if (typeof window.ZaoyoePromptsFocusCommentFromEngagement === 'function') {
                    resolve(window.ZaoyoePromptsFocusCommentFromEngagement);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(null);
                    return;
                }
                window.setTimeout(check, 80);
            };
            check();
        });
    }

    async focusPromptReplyFromEngagement(target = {}) {
        if (!this.isCurrentEngagementPromptsPage()) {
            return false;
        }

        const focusComment = await this.waitForPromptsCommentFocus();
        if (typeof focusComment !== 'function') {
            throw new Error('Prompt comment focus is not ready');
        }

        const focused = await Promise.resolve(focusComment({
            promptId: target.promptId,
            commentId: target.commentId
        }));
        if (!focused) {
            return false;
        }
        this.clearUnread();
        return true;
    }

    buildEngagementReplyNavigationUrl(targetUrl = null, routeTargets = {}) {
        if (!(targetUrl instanceof URL)) {
            return targetUrl;
        }
        const nextUrl = new URL(targetUrl.href);
        const guestbookReplyTarget = routeTargets.guestbookReplyTarget && typeof routeTargets.guestbookReplyTarget === 'object'
            ? routeTargets.guestbookReplyTarget
            : null;
        const promptReplyTarget = routeTargets.promptReplyTarget && typeof routeTargets.promptReplyTarget === 'object'
            ? routeTargets.promptReplyTarget
            : null;

        if (guestbookReplyTarget && this.isEngagementGuestbookPath(nextUrl.pathname)) {
            if (guestbookReplyTarget.messageId && !nextUrl.searchParams.get('messageId')) {
                nextUrl.searchParams.set('messageId', guestbookReplyTarget.messageId);
            }
            if (guestbookReplyTarget.commentId && !nextUrl.searchParams.get('commentId')) {
                nextUrl.searchParams.set('commentId', guestbookReplyTarget.commentId);
            }
        }

        if (promptReplyTarget && this.isEngagementPromptsPath(nextUrl.pathname)) {
            if (promptReplyTarget.promptId && !nextUrl.searchParams.get('id')) {
                nextUrl.searchParams.set('id', promptReplyTarget.promptId);
            }
            if (promptReplyTarget.commentId && !nextUrl.searchParams.get('commentId')) {
                nextUrl.searchParams.set('commentId', promptReplyTarget.commentId);
            }
            if (promptReplyTarget.commentId && !nextUrl.searchParams.get('comments')) {
                nextUrl.searchParams.set('comments', '1');
            }
        }

        return nextUrl;
    }

    isEngagementVerifyPath(pathname = '') {
        return /\/verify(?:\.html)?\/?$/i.test(String(pathname || '').trim());
    }

    getEngagementVerifyHelpTarget(actionUrl = '', metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        const rawActionUrl = String(actionUrl || '').trim();
        let targetUrl = null;
        let urlTargetsVerify = false;
        let targetSection = '';
        const helpSections = ['help', 'guide', 'verify-help', 'verify-guide'];
        const historySections = ['history', 'verify-history'];

        if (rawActionUrl) {
            try {
                targetUrl = new URL(rawActionUrl, window.location.origin);
                const hash = decodeURIComponent(String(targetUrl.hash || '').replace(/^#/, '').trim()).toLowerCase();
                if (targetUrl.origin === window.location.origin && this.isEngagementVerifyPath(targetUrl.pathname)) {
                    if (helpSections.includes(hash)) {
                        urlTargetsVerify = true;
                        targetSection = 'help';
                    } else if (historySections.includes(hash)) {
                        urlTargetsVerify = true;
                        targetSection = 'history';
                    }
                }
            } catch (_) {
                targetUrl = null;
            }
        }

        const metadataPageId = String(source.page_id || source.pageId || source.page || '').trim().toLowerCase();
        const metadataSection = String(source.section || source.target_section || source.targetSection || '').trim().toLowerCase();
        const metadataTargetsVerify = metadataPageId === 'verify'
            && (helpSections.includes(metadataSection) || historySections.includes(metadataSection));

        if (!urlTargetsVerify && !metadataTargetsVerify) {
            return null;
        }

        return {
            targetUrl,
            section: targetSection || (historySections.includes(metadataSection) ? 'history' : 'help')
        };
    }

    isCurrentEngagementVerifyPage() {
        return this.isEngagementVerifyPath(window.location?.pathname || '')
            || this.getEngagementPageId() === 'verify';
    }

    waitForVerifyHelpFocus(timeoutMs = 2200) {
        if (typeof window.ZaoyoeVerifyFocusHelp === 'function') {
            return Promise.resolve(window.ZaoyoeVerifyFocusHelp);
        }

        const startedAt = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                if (typeof window.ZaoyoeVerifyFocusHelp === 'function') {
                    resolve(window.ZaoyoeVerifyFocusHelp);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(null);
                    return;
                }
                window.setTimeout(check, 80);
            };
            check();
        });
    }

    waitForVerifyHistoryFocus(timeoutMs = 2200) {
        if (typeof window.ZaoyoeVerifyFocusHistory === 'function') {
            return Promise.resolve(window.ZaoyoeVerifyFocusHistory);
        }

        const startedAt = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                if (typeof window.ZaoyoeVerifyFocusHistory === 'function') {
                    resolve(window.ZaoyoeVerifyFocusHistory);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(null);
                    return;
                }
                window.setTimeout(check, 80);
            };
            check();
        });
    }

    async focusVerifyHelpFromEngagement(target = {}) {
        if (!this.isCurrentEngagementVerifyPage()) {
            return false;
        }

        const section = String(target?.section || 'help').trim().toLowerCase() === 'history'
            ? 'history'
            : 'help';
        const focusHandler = section === 'history'
            ? await this.waitForVerifyHistoryFocus()
            : await this.waitForVerifyHelpFocus();
        if (typeof focusHandler === 'function') {
            const focused = await Promise.resolve(focusHandler({ source: 'engagement_bubble' }));
            if (focused) {
                this.clearUnread();
                return true;
            }
        }

        const focusTarget = section === 'history'
            ? (document.getElementById('verifyHistoryCard')
                || document.getElementById('verifyHistoryList')
                || document.querySelector('.verify-history-card, .verify-history-list, #verify-widget-container'))
            : (document.getElementById('help')
                || document.querySelector('[data-verify-help="1"], .verify-guide-card, #verify-widget-container'));
        if (!focusTarget?.scrollIntoView) {
            return false;
        }
        focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        focusTarget.classList?.remove?.('is-engagement-focus');
        void focusTarget.offsetWidth;
        focusTarget.classList?.add?.('is-engagement-focus');
        window.setTimeout(() => focusTarget.classList?.remove?.('is-engagement-focus'), 3200);
        this.clearUnread();
        return true;
    }

    isEngagementShopPath(pathname = '') {
        return /\/shop(?:\.html)?\/?$/i.test(String(pathname || '').trim());
    }

    getEngagementShopCartTarget(actionUrl = '', metadata = {}) {
        const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {};
        const rawActionUrl = String(actionUrl || '').trim();
        if (!rawActionUrl) {
            return null;
        }

        try {
            const targetUrl = new URL(rawActionUrl, window.location.origin);
            const hash = decodeURIComponent(String(targetUrl.hash || '').replace(/^#/, '').trim()).toLowerCase();
            if (targetUrl.origin !== window.location.origin || !this.isEngagementShopPath(targetUrl.pathname)) {
                return null;
            }
            if (!['cart', 'shop-cart'].includes(hash)) {
                return null;
            }
            return {
                targetUrl,
                section: 'cart',
                pageId: String(source.page_id || source.pageId || source.page || '').trim().toLowerCase() || 'shop'
            };
        } catch (_) {
            return null;
        }
    }

    isCurrentEngagementShopPage() {
        return this.isEngagementShopPath(window.location?.pathname || '')
            || this.getEngagementPageId() === 'shop';
    }

    async focusShopCartFromEngagement() {
        if (!this.isCurrentEngagementShopPage()) {
            return false;
        }

        const openCart = typeof window.ZaoyoeShopOpenCartFromEngagement === 'function'
            ? window.ZaoyoeShopOpenCartFromEngagement
            : (typeof window.ShopClient?.openCartFromEngagement === 'function'
                ? window.ShopClient.openCartFromEngagement.bind(window.ShopClient)
                : null);
        if (typeof openCart !== 'function') {
            return false;
        }

        const opened = await Promise.resolve(openCart({ source: 'engagement_bubble' }));
        if (!opened) {
            return false;
        }
        this.clearUnread();
        return true;
    }

    normalizeEngagementAccountView(view = '') {
        const normalized = String(view || '').trim().toLowerCase().replace(/_/g, '-').replace(/^view-/, '');
        const aliases = {
            account: 'profile',
            me: 'profile',
            user: 'profile',
            member: 'profile',
            settings: 'profile',
            setting: 'profile',
            profile: 'profile',
            security: 'security',
            safe: 'security',
            password: 'security',
            'account-security': 'security'
        };
        const viewId = aliases[normalized] || normalized;
        return ['profile', 'security'].includes(viewId) ? viewId : '';
    }

    getEngagementAccountViewFromActionUrl(actionUrl = '', metadata = {}) {
        const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
        const metadataView = this.normalizeEngagementAccountView(
            normalizedMetadata.account_view
                || normalizedMetadata.accountView
                || normalizedMetadata.profile_view
                || normalizedMetadata.profileView
                || ''
        );
        if (metadataView) {
            return metadataView;
        }

        const rawUrl = String(actionUrl || '').trim();
        if (!rawUrl) {
            return '';
        }

        if (/^profile:/i.test(rawUrl)) {
            return 'profile';
        }

        if (/^account:/i.test(rawUrl)) {
            const accountTarget = decodeURIComponent(
                rawUrl
                    .replace(/^account:(\/\/)?/i, '')
                    .replace(/^\/+/, '')
                    .split(/[?#/]/)[0]
            );
            return this.normalizeEngagementAccountView(accountTarget || 'profile') || 'profile';
        }

        try {
            const targetUrl = new URL(rawUrl, window.location.origin);
            if (targetUrl.origin !== window.location.origin) {
                return '';
            }
            const queryView = targetUrl.searchParams.get('account_view')
                || targetUrl.searchParams.get('account')
                || targetUrl.searchParams.get('profile_view')
                || '';
            const hashView = decodeURIComponent(String(targetUrl.hash || '').replace(/^#/, '').trim());
            return this.normalizeEngagementAccountView(queryView)
                || this.normalizeEngagementAccountView(hashView)
                || '';
        } catch (_) {
            return '';
        }
    }

    async openEngagementAccountView(view = '', targetUrl = null) {
        const accountView = this.normalizeEngagementAccountView(view);
        if (!['profile', 'security'].includes(accountView)) {
            return false;
        }

        const applyProfileView = async () => {
            if (accountView !== 'security') {
                return true;
            }
            const startedAt = Date.now();
            while (Date.now() - startedAt < 2200) {
                const profileModal = document.getElementById('profileModal');
                const canSwitch = typeof window.switchProfileTab === 'function'
                    && profileModal
                    && profileModal.classList.contains('active');
                if (canSwitch) {
                    window.switchProfileTab('security');
                    return true;
                }
                await new Promise((resolve) => window.setTimeout(resolve, 80));
            }
            return false;
        };

        try {
            if (typeof window.requestProfileModalOpen === 'function') {
                window.requestProfileModalOpen();
                await applyProfileView();
                this.clearUnread();
                return true;
            }
            if (typeof window.openProfileModal === 'function') {
                await Promise.resolve(window.openProfileModal());
                await applyProfileView();
                this.clearUnread();
                return true;
            }
            if (typeof window.ZaoyoeProfileModalBootstrap?.ensure === 'function') {
                await window.ZaoyoeProfileModalBootstrap.ensure();
                if (typeof window.openProfileModal === 'function') {
                    await Promise.resolve(window.openProfileModal());
                    await applyProfileView();
                    this.clearUnread();
                    return true;
                }
            }
        } catch (error) {
            console.warn('[ChatWidget] Failed to open profile modal from engagement bubble:', error?.message || error);
        }

        try {
            window.sessionStorage?.setItem('openProfileModal', 'true');
        } catch (_) {
            // Ignore storage failures and try the navigation fallback below.
        }

        if (targetUrl instanceof URL && ['http:', 'https:'].includes(targetUrl.protocol) && targetUrl.origin === window.location.origin) {
            window.location.href = targetUrl.href;
            this.clearUnread();
            return true;
        }

        return false;
    }

    getEngagementActionLoadingLabel(item = {}, actionTarget = {}) {
        const normalized = this.normalizeEngagementItem(item);
        const actionUrl = String(actionTarget?.action_url || normalized?.action_url || '').trim();
        const metadata = normalized
            ? {
                ...normalized.metadata,
                page_id: normalized.page_id,
                source: normalized.source,
                source_module: normalized.source_module
            }
            : {};
        const guestbookTarget = normalized
            ? this.getEngagementGuestbookReplyTarget(actionUrl, {
                ...metadata
            })
            : null;
        const promptTarget = normalized
            ? this.getEngagementPromptReplyTarget(actionUrl, metadata)
            : null;
        const verifyHelpTarget = normalized
            ? this.getEngagementVerifyHelpTarget(actionUrl, metadata)
            : null;
        const shopCartTarget = normalized
            ? this.getEngagementShopCartTarget(actionUrl, metadata)
            : null;

        if ((guestbookTarget && this.isCurrentEngagementGuestbookPage())
            || (promptTarget && this.isCurrentEngagementPromptsPage())
            || (verifyHelpTarget && this.isCurrentEngagementVerifyPage())
            || (shopCartTarget && this.isCurrentEngagementShopPage())) {
            return '定位中...';
        }
        return this.t('chat.loading', '加载中...');
    }

    async activateEngagementItemWithFeedback(item = {}, options = {}) {
        const root = options.rootElement?.nodeType === 1
            ? options.rootElement
            : options.sourceElement?.closest?.('.engagement-preview, .engagement-surface') || null;
        if (root?.dataset?.engagementActivating === '1') return;

        const actionTarget = options.actionTarget && typeof options.actionTarget === 'object' && !Array.isArray(options.actionTarget)
            ? options.actionTarget
            : {};
        const feedbackTarget = this.setEngagementActionLoading(
            options.feedbackElement || options.sourceElement,
            root,
            this.getEngagementActionLoadingLabel(item, actionTarget)
        );
        if (root?.dataset) {
            root.dataset.engagementActivating = '1';
        }
        root?.classList?.add('is-activating');

        try {
            await this.activateEngagementItem(item, {
                actionTarget
            });
        } catch (error) {
            console.warn('[ChatWidget] Failed to activate engagement item:', error?.message || error);
            this.clearEngagementActionLoading(feedbackTarget);
            if (root?.dataset) {
                delete root.dataset.engagementActivating;
            }
            root?.classList?.remove('is-activating');
        }
    }

    async triggerEngagementEvent(triggerType = 'page_view', metadata = {}, options = {}) {
        const normalizedTrigger = this.normalizeEngagementTriggerType(triggerType);
        if (!normalizedTrigger || normalizedTrigger === 'page_view') {
            return this.refreshEngagementFeed({ force: true });
        }
        const triggerMetadata = this.prepareEngagementTriggerMetadata(normalizedTrigger, metadata);
        const triggerKey = this.getEngagementTriggerKey(normalizedTrigger, triggerMetadata);
        if (options.once !== false && this.engagementTriggeredKeys.has(triggerKey)) {
            return null;
        }
        const result = await this.refreshEngagementFeed({
            force: true,
            triggerType: normalizedTrigger,
            metadata: triggerMetadata
        });
        if (options.once !== false && result) {
            this.engagementTriggeredKeys.add(triggerKey);
        }
        return result;
    }

    async refreshEngagementFeed(options = {}) {
        const requestedTriggerType = this.normalizeEngagementTriggerType(options.triggerType || 'page_view');
        if (this.isOpen && requestedTriggerType === 'page_view') return null;
        if (this.engagementFeedLoading && options.force !== true) return;
        this.engagementFeedLoading = true;

        try {
            const pageId = this.getEngagementPageId();
            const externalSite = String(this.getEngagementExternalConfig().site || '').trim().toLowerCase();
            const site = (externalSite || String(window.SiteConfig?.site || 'cn').trim().toLowerCase()) === 'intl' ? 'intl' : 'cn';
            const readerKey = this.getEngagementReaderKey();
            const triggerType = requestedTriggerType;
            const eventMetadata = options.metadata && typeof options.metadata === 'object' && !Array.isArray(options.metadata)
                ? options.metadata
                : {};
            const params = new URLSearchParams({
                page_id: pageId,
                site,
                reader_key: readerKey,
                trigger_type: triggerType,
                limit: '6'
            });
            const clientContext = this.getEngagementExperienceContext({
                trigger_type: triggerType
            });
            const sourceModule = String(eventMetadata.source_module || eventMetadata.sourceModule || '').trim();
            const sourceEventId = String(eventMetadata.source_event_id || eventMetadata.sourceEventId || '').trim();
            if (sourceModule) params.set('source_module', sourceModule);
            if (sourceEventId) params.set('source_event_id', sourceEventId);
            if (Object.keys(eventMetadata).length) {
                params.set('event_context', JSON.stringify(eventMetadata).slice(0, 1000));
            }
            params.set('client_context', JSON.stringify(clientContext).slice(0, 1000));
            const accessToken = await this.getEngagementAccessToken();
            const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
            let payload = null;
            let lastError = null;
            for (const url of this.getEngagementApiUrls('feed', params)) {
                try {
                    const response = await fetch(url, {
                        headers,
                        credentials: this.getEngagementFetchCredentials()
                    });
                    const responsePayload = await response.json().catch(() => ({}));
                    if (!response.ok || responsePayload?.success === false) {
                        throw new Error(responsePayload?.message || `Engagement feed failed (${response.status})`);
                    }
                    payload = responsePayload;
                    break;
                } catch (error) {
                    lastError = error;
                }
            }
            if (!payload) {
                throw lastError || new Error('Engagement feed failed');
            }
            this.applyEngagementAssetStyle(payload?.asset_center?.style || {});
            this.applyEngagementSupportEntry(payload?.support_entry || {});
            this.engagementEventPriorityCenter = this.normalizeEngagementEventPriorityCenter(payload?.event_priority_center || {});
            this.scheduleEngagementScheduledRuleRefresh(payload?.next_scheduled_rule_at || '');

            const item = this.dedupeEngagementFeedItems(Array.isArray(payload?.items) ? payload.items : [])
                .filter(Boolean)
                .filter((entry) => this.shouldSurfaceEngagementItem(entry))
                .filter((entry) => !this.isEngagementItemSuppressed(entry))
                .filter((entry) => !this.isEngagementItemSessionQuiet(entry))
                .sort((left, right) => {
                    const priorityDelta = this.compareEngagementDisplayPriority(left, right);
                    if (priorityDelta) return priorityDelta;
                    return Number(right.priority || 0) - Number(left.priority || 0);
                });

            this.engagementFeedLoaded = true;
            if (item.length) {
                const [nextItem, ...backlogItems] = item;
                backlogItems.forEach((entry) => {
                    this.queuePendingEngagementItem(entry, {
                        source: 'engagement_feed_backlog',
                        queued: true
                    });
                });
                this.showEngagementItem(nextItem);
                return nextItem;
            }
            return null;
        } catch (error) {
            console.warn('[ChatWidget] Engagement feed skipped:', error?.message || error);
            return null;
        } finally {
            this.engagementFeedLoading = false;
        }
    }

    async trackEngagementEvent(item = {}, eventType = 'view', metadata = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return;
        const accessToken = await this.getEngagementAccessToken();
        const headers = {
            'Content-Type': 'application/json'
        };
        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }
        try {
            const experienceContext = this.getEngagementExperienceContext({
                placement: normalized.placement,
                source: normalized.source,
                event_type: eventType
            });
            const body = JSON.stringify({
                event_type: eventType,
                delivery_id: normalized.delivery_id || null,
                rule_id: normalized.rule_id || null,
                notification_id: normalized.notification_id || null,
                page_id: normalized.page_id,
                site: normalized.site,
                reader_key: this.getEngagementReaderKey(),
                source_module: normalized.source_module,
                source_event_id: normalized.source_event_id,
                metadata: {
                    ...normalized.metadata,
                    ...experienceContext,
                    ...metadata,
                    placement: normalized.placement,
                    source: normalized.source,
                    title: normalized.title
                }
            });
            for (const url of this.getEngagementApiUrls('event')) {
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    credentials: this.getEngagementFetchCredentials(),
                    body
                });
                if (response.ok) {
                    break;
                }
            }
        } catch (error) {
            console.warn('[ChatWidget] Failed to record engagement event:', error?.message || error);
        }
    }

    showEngagementBubble(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized || !this.fab || this.isOpen) return;

        this.removeEngagementSurfaceElements();
        const existingPreview = this.fab.querySelector('.message-preview');
        if (existingPreview) existingPreview.remove();

        const viewKey = this.getEngagementItemKey(normalized);
        const hasSeenInSession = this.engagementViewedKeys.has(viewKey);
        this.engagementActiveItem = normalized;
        this.updateBadge();
        this._pauseFabAmbientMotion(8200, true);
        this.fab.classList.toggle('has-unread', this.unreadCount > 0);
        this.fab.classList.add('has-new-message');
        setTimeout(() => this.fab?.classList.remove('has-new-message'), 600);

        const preview = document.createElement('div');
        preview.className = `message-preview engagement-preview engagement-preview--${normalized.tone}`;
        preview.setAttribute('role', 'status');
        preview.setAttribute('aria-live', 'polite');
        preview.dataset.engagementPlacement = normalized.placement;
        preview.dataset.engagementTone = normalized.tone;
        preview.dataset.engagementPage = normalized.page_id;
        preview.dataset.engagementSource = normalized.source;
        preview.dataset.engagementSourceModule = normalized.source_module;
        preview.innerHTML = `
            <div class="preview-sender">${this.escapeHtml(normalized.title)}</div>
            <div class="preview-text">${this.renderEngagementContentHtml(normalized)}</div>
            <div class="engagement-preview__actions">
                ${normalized.action_label ? `<button type="button" class="engagement-preview__action">${this.escapeHtml(normalized.action_label)}</button>` : ''}
                <button type="button" class="engagement-preview__close" aria-label="关闭提醒">关闭</button>
            </div>
        `;

        preview.addEventListener('click', (event) => {
            event.stopPropagation();
            const eventTarget = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
            const closeButton = eventTarget?.closest?.('.engagement-preview__close');
            if (closeButton) {
                this.dismissEngagementBubble(normalized, { eventType: 'dismiss' });
                return;
            }
            const routeLink = eventTarget?.closest?.('.engagement-preview__path-link');
            if (routeLink) {
                event.preventDefault();
                void this.activateEngagementItemWithFeedback(normalized, {
                    rootElement: preview,
                    sourceElement: routeLink,
                    actionTarget: this.getEngagementRouteTargetFromElement(routeLink)
                });
                return;
            }
            const actionButton = eventTarget?.closest?.('.engagement-preview__action');
            void this.activateEngagementItemWithFeedback(normalized, {
                rootElement: preview,
                sourceElement: actionButton || eventTarget,
                feedbackElement: actionButton || null
            });
        });

        const autoDismissDelayMs = 9000;
        let autoDismissTimer = null;
        let autoDismissStartedAt = 0;
        let autoDismissRemainingMs = autoDismissDelayMs;
        let isAutoDismissPaused = false;
        const canAutoDismiss = () => preview.parentNode && this.engagementActiveItem?.id === normalized.id;
        const clearAutoDismissTimer = () => {
            if (autoDismissTimer) {
                window.clearTimeout(autoDismissTimer);
                autoDismissTimer = null;
            }
        };
        const scheduleAutoDismiss = (delayMs = autoDismissRemainingMs) => {
            clearAutoDismissTimer();
            autoDismissRemainingMs = Math.max(0, delayMs);
            autoDismissStartedAt = Date.now();
            autoDismissTimer = window.setTimeout(() => {
                autoDismissTimer = null;
                if (!canAutoDismiss()) return;
                if (isAutoDismissPaused || preview.matches?.(':hover')) {
                    isAutoDismissPaused = true;
                    autoDismissRemainingMs = 1200;
                    return;
                }
                this.dismissEngagementBubble(normalized, { eventType: 'dismiss', passive: true });
            }, autoDismissRemainingMs);
        };
        const pauseAutoDismiss = () => {
            if (isAutoDismissPaused) return;
            isAutoDismissPaused = true;
            if (autoDismissTimer) {
                const elapsedMs = Date.now() - autoDismissStartedAt;
                autoDismissRemainingMs = Math.max(1200, autoDismissRemainingMs - elapsedMs);
            }
            clearAutoDismissTimer();
        };
        const resumeAutoDismiss = () => {
            if (!isAutoDismissPaused) return;
            isAutoDismissPaused = false;
            if (canAutoDismiss()) {
                scheduleAutoDismiss(autoDismissRemainingMs);
            }
        };
        preview.addEventListener('mouseenter', pauseAutoDismiss);
        preview.addEventListener('mouseleave', resumeAutoDismiss);
        preview.addEventListener('focusin', pauseAutoDismiss);
        preview.addEventListener('focusout', () => {
            if (!preview.contains(document.activeElement)) {
                resumeAutoDismiss();
            }
        });

        this.fab.appendChild(preview);
        const shouldTrackView = normalized.source === 'rule' || !hasSeenInSession || options.manual === true;
        if (shouldTrackView) {
            this.engagementViewedKeys.add(viewKey);
            this.quietEngagementItemForRepeatInterval(normalized);
            void this.trackEngagementEvent(normalized, 'view', this.getEngagementElementMetrics(preview, normalized.placement));
        }

        scheduleAutoDismiss();
    }

    showEngagementItem(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return;
        const activeSemanticKey = this.engagementActiveItem ? this.getEngagementSemanticDedupeKey(this.engagementActiveItem) : '';
        const nextSemanticKey = this.getEngagementSemanticDedupeKey(normalized);
        if (activeSemanticKey && nextSemanticKey && activeSemanticKey === nextSemanticKey) {
            return;
        }
        if (this.isOpen) {
            this.queuePendingEngagementItem(normalized, options);
            this.schedulePendingEngagementFlush();
            return;
        }
        if (this.engagementActiveItem || this.isEngagementDisplayCoolingDown() || this.shouldThrottleEngagementForAuthBurst(options)) {
            this.queuePendingEngagementItem(normalized, options);
            this.schedulePendingEngagementFlush(this.getEngagementNextDisplayDelayMs(options));
            return;
        }
        this.clearPendingEngagementFlushTimer();
        this.markEngagementDisplayStarted(options);
        if (normalized.placement === 'robot_bubble') {
            this.showEngagementBubble(normalized, options);
            return;
        }
        this.showEngagementSurface(normalized, options);
    }

    removeEngagementSurfaceElements() {
        if (this.engagementSurfaceEscapeHandler) {
            document.removeEventListener('keydown', this.engagementSurfaceEscapeHandler, true);
            this.engagementSurfaceEscapeHandler = null;
        }
        document.querySelectorAll('.engagement-surface').forEach((element) => element.remove());
    }

    bindEngagementSurfaceEscape(surface, item = {}) {
        if (!surface || this.engagementSurfaceEscapeHandler) return;
        this.engagementSurfaceEscapeHandler = (event) => {
            if (event.key !== 'Escape' || !document.body.contains(surface)) return;
            event.preventDefault();
            this.dismissEngagementSurface(item, { eventType: 'dismiss' });
        };
        document.addEventListener('keydown', this.engagementSurfaceEscapeHandler, true);
    }

    renderEngagementSurfaceHtml(item = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return '';
        const actionLabel = normalized.action_label || (normalized.action_url ? '查看详情' : '');
        return `
            <button type="button" class="engagement-surface__close" aria-label="关闭提醒">×</button>
            <div class="engagement-surface__body">
                <strong>${this.escapeHtml(normalized.title)}</strong>
                <p>${this.renderEngagementContentHtml(normalized)}</p>
            </div>
            ${actionLabel ? `<button type="button" class="engagement-surface__action">${this.escapeHtml(actionLabel)}</button>` : ''}
        `;
    }

    showEngagementSurface(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized || this.isOpen) return;

        this.removeEngagementSurfaceElements();
        this.fab?.querySelector('.message-preview.engagement-preview')?.remove();

        const viewKey = this.getEngagementItemKey(normalized);
        const hasSeenInSession = this.engagementViewedKeys.has(viewKey);
        this.engagementActiveItem = normalized;
        const surface = document.createElement('aside');
        surface.className = `engagement-surface engagement-surface--${normalized.placement} engagement-surface--${normalized.tone}`;
        surface.setAttribute('role', normalized.placement === 'modal' ? 'dialog' : 'status');
        surface.setAttribute('aria-live', normalized.placement === 'modal' ? 'assertive' : 'polite');
        surface.dataset.engagementPlacement = normalized.placement;
        surface.dataset.engagementTone = normalized.tone;
        surface.dataset.engagementPage = normalized.page_id;
        surface.dataset.engagementSource = normalized.source;
        surface.dataset.engagementSourceModule = normalized.source_module;
        if (normalized.placement === 'modal') {
            surface.setAttribute('aria-modal', 'true');
        }
        surface.innerHTML = this.renderEngagementSurfaceHtml(normalized);
        this.bindEngagementSurfaceEscape(surface, normalized);

        surface.addEventListener('click', (event) => {
            const eventTarget = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
            const closeButton = eventTarget?.closest?.('.engagement-surface__close');
            if (closeButton) {
                this.dismissEngagementSurface(normalized, { eventType: 'dismiss' });
                return;
            }
            const routeLink = eventTarget?.closest?.('.engagement-preview__path-link');
            if (routeLink) {
                event.preventDefault();
                void this.activateEngagementItemWithFeedback(normalized, {
                    rootElement: surface,
                    sourceElement: routeLink,
                    actionTarget: this.getEngagementRouteTargetFromElement(routeLink)
                });
                return;
            }
            const actionButton = eventTarget?.closest?.('.engagement-surface__action');
            if (actionButton || normalized.placement === 'floating_badge') {
                event.preventDefault();
                void this.activateEngagementItemWithFeedback(normalized, {
                    rootElement: surface,
                    sourceElement: actionButton || eventTarget,
                    feedbackElement: actionButton || null
                });
            }
        });

        document.body.appendChild(surface);
        const shouldTrackView = normalized.source === 'rule' || !hasSeenInSession || options.manual === true;
        if (shouldTrackView) {
            this.engagementViewedKeys.add(viewKey);
            this.quietEngagementItemForRepeatInterval(normalized);
            void this.trackEngagementEvent(normalized, 'view', {
                ...this.getEngagementElementMetrics(surface, normalized.placement),
                placement: normalized.placement
            });
        }

        if (normalized.placement !== 'modal') {
            window.setTimeout(() => {
                if (document.body.contains(surface) && this.engagementActiveItem?.id === normalized.id) {
                    this.dismissEngagementSurface(normalized, { eventType: 'dismiss', passive: true });
                }
            }, normalized.placement === 'top_banner' ? 11000 : 13000);
        }
    }

    dismissEngagementSurface(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item || this.engagementActiveItem || {});
        this.dismissEngagementBubble(normalized, {
            ...options,
            surfaceOnly: true
        });
        const surface = document.querySelector('.engagement-surface');
        if (surface) {
            surface.classList.add('hiding');
            window.setTimeout(() => {
                surface.remove();
            }, 260);
        }
        if (normalized && options.passive === true) {
            this.quietEngagementItemForRepeatInterval(normalized);
            this.scheduleEngagementFollowupRefresh(520);
        } else if (normalized) {
            this.suppressEngagementItem(normalized);
            void this.trackEngagementEvent(normalized, options.eventType || 'dismiss', {
                placement: normalized.placement
            });
        }
        this.engagementActiveItem = null;
        this.beginEngagementDisplayCooldown(this.getEngagementRespirationDelayMs(options));
        this.schedulePendingEngagementFlush();
    }

    dismissEngagementBubble(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item || this.engagementActiveItem || {});
        const preview = this.fab?.querySelector('.message-preview.engagement-preview');
        if (preview) {
            preview.classList.add('hiding');
            setTimeout(() => {
                preview.remove();
                this._scheduleFabAmbientMotion();
            }, 400);
        }
        if (options.surfaceOnly !== true) {
            this.removeEngagementSurfaceElements();
        }
        if (normalized && options.passive === true && options.surfaceOnly !== true) {
            this.quietEngagementItemForRepeatInterval(normalized);
            this.scheduleEngagementFollowupRefresh(720);
        } else if (normalized && options.surfaceOnly !== true) {
            this.suppressEngagementItem(normalized);
            void this.trackEngagementEvent(normalized, options.eventType || 'dismiss');
        }
        this.engagementActiveItem = null;
        if (options.surfaceOnly !== true) {
            this.beginEngagementDisplayCooldown(this.getEngagementRespirationDelayMs(options));
            this.schedulePendingEngagementFlush();
        }
    }

    async openEngagementWalletView(view = '', context = {}) {
        const walletView = this.normalizeEngagementWalletView(view) || 'balance';
        const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
            ? context
            : {};
        const orderDetailId = String(
            normalizedContext.wallet_order_detail_id
            || normalizedContext.walletOrderDetailId
            || normalizedContext.order_detail_id
            || normalizedContext.orderDetailId
            || ''
        ).trim();
        const walletContext = {
            entry: 'engagement_bubble',
            source_module: 'engagement',
            ...normalizedContext
        };

        try {
            let walletModal = null;
            if (typeof window.ZaoyoeWalletModalBootstrap?.open === 'function') {
                walletModal = await window.ZaoyoeWalletModalBootstrap.open(walletView, walletContext);
            } else if (typeof window.WalletModal?.open === 'function') {
                await window.WalletModal.open(walletView, walletContext);
                walletModal = window.WalletModal;
            }

            if (walletModal) {
                if (typeof walletModal.switchView === 'function') {
                    walletModal.switchView(walletView);
                }
                this.openEngagementWalletOrderDetail(walletModal, orderDetailId);
                this.clearUnread();
                return true;
            }
        } catch (error) {
            console.warn('[ChatWidget] Failed to open wallet from engagement bubble:', error?.message || error);
        }

        return false;
    }

    openEngagementWalletOrderDetail(walletModal, orderDetailId = '') {
        const normalizedOrderId = String(orderDetailId || '').trim();
        if (!normalizedOrderId || typeof walletModal?.showOrderDetail !== 'function') {
            return false;
        }

        if (document.getElementById(`order-detail-${normalizedOrderId}`)) {
            return true;
        }

        window.setTimeout(() => {
            if (document.getElementById(`order-detail-${normalizedOrderId}`)) {
                return;
            }
            try {
                const detailPromise = walletModal.showOrderDetail(normalizedOrderId);
                if (detailPromise && typeof detailPromise.catch === 'function') {
                    detailPromise.catch((error) => {
                        console.warn('[ChatWidget] Failed to open wallet order detail from engagement:', error?.message || error);
                    });
                }
            } catch (error) {
                console.warn('[ChatWidget] Failed to open wallet order detail from engagement:', error?.message || error);
            }
        }, 0);
        return true;
    }

    normalizeEngagementAuthView(view = '') {
        const normalized = String(view || '').trim().toLowerCase().replace(/\s+/g, '-');
        const aliases = {
            signin: 'login',
            'sign-in': 'login',
            signup: 'register',
            'sign-up': 'register',
            forgot: 'reset',
            recover: 'reset',
            forgotpassword: 'reset',
            'forgot-password': 'reset',
            resetpassword: 'reset',
            'reset-password': 'reset'
        };
        const resolved = aliases[normalized] || normalized;
        return ['login', 'register', 'reset'].includes(resolved) ? resolved : '';
    }

    getEngagementAuthViewFromLabel(label = '') {
        const content = String(label || '').trim();
        if (!content) return '';
        if (/(注册|signup|sign\s*up|register)/iu.test(content)) {
            return 'register';
        }
        if (/(重置|找回|忘记|reset|forgot|recover)/iu.test(content)) {
            return 'reset';
        }
        if (/(登录|登入|signin|sign\s*in|login)/iu.test(content)) {
            return 'login';
        }
        return '';
    }

    getEngagementAuthViewFromActionUrl(actionUrl = '', fallbackLabel = '', metadata = {}) {
        const normalizedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
        const metadataView = this.normalizeEngagementAuthView(
            normalizedMetadata.auth_view
            || normalizedMetadata.authView
            || normalizedMetadata.action_auth_view
            || normalizedMetadata.actionAuthView
            || ''
        );
        if (metadataView) {
            return metadataView;
        }

        const labelView = this.getEngagementAuthViewFromLabel(fallbackLabel);
        const rawUrl = String(actionUrl || '').trim();
        if (!rawUrl) {
            return labelView || '';
        }

        if (/^(auth|login):/i.test(rawUrl)) {
            const authTarget = decodeURIComponent(
                rawUrl
                    .replace(/^(auth|login):(\/\/)?/i, '')
                    .replace(/^\/+/, '')
                    .split(/[?#/]/)[0]
            );
            const schemeView = this.normalizeEngagementAuthView(authTarget || 'login') || 'login';
            return labelView && schemeView === 'login' ? labelView : schemeView;
        }

        let urlView = '';
        try {
            const targetUrl = new URL(rawUrl, window.location.origin);
            if (targetUrl.origin === window.location.origin) {
                const queryView = targetUrl.searchParams.get('auth_view')
                    || targetUrl.searchParams.get('auth')
                    || targetUrl.searchParams.get('modal')
                    || targetUrl.searchParams.get('view')
                    || '';
                urlView = this.normalizeEngagementAuthView(queryView);

                if (!urlView) {
                    const hashView = decodeURIComponent(String(targetUrl.hash || '').replace(/^#/, '').trim());
                    urlView = this.normalizeEngagementAuthView(hashView);
                }

                if (!urlView) {
                    const normalizedPath = String(targetUrl.pathname || '').trim().toLowerCase();
                    if (/\/register(?:\.html)?$/i.test(normalizedPath)) {
                        urlView = 'register';
                    } else if (/\/login(?:\.html)?$/i.test(normalizedPath)) {
                        urlView = 'login';
                    } else if (/\/reset(?:-password)?(?:\.html)?$/i.test(normalizedPath)) {
                        urlView = 'reset';
                    }
                }
            }
        } catch (_) {
            return labelView || '';
        }

        if (labelView && (!urlView || urlView === 'login')) {
            return labelView;
        }
        return urlView || labelView || '';
    }

    async openEngagementAuthView(view = '', targetUrl = null) {
        const authView = this.normalizeEngagementAuthView(view) || 'login';

        try {
            if (typeof window.requestLoginModalOpen === 'function') {
                window.requestLoginModalOpen(authView);
                this.clearUnread();
                return true;
            }
            if (typeof window.openLoginModal === 'function') {
                await Promise.resolve(window.openLoginModal(authView));
                this.clearUnread();
                return true;
            }
        } catch (error) {
            console.warn('[ChatWidget] Failed to open auth modal from engagement bubble:', error?.message || error);
        }

        try {
            window.sessionStorage?.setItem('openLoginModal', 'true');
            window.sessionStorage?.setItem('openLoginModalView', authView);
        } catch (_) {
            // Ignore storage failures and try the navigation fallback below.
        }

        if (targetUrl instanceof URL && ['http:', 'https:'].includes(targetUrl.protocol) && targetUrl.origin === window.location.origin) {
            window.location.href = targetUrl.href;
            this.clearUnread();
            return true;
        }

        return false;
    }

    async activateEngagementItem(item = {}, options = {}) {
        const normalized = this.normalizeEngagementItem(item);
        if (!normalized) return;
        const actionTarget = options.actionTarget && typeof options.actionTarget === 'object' && !Array.isArray(options.actionTarget)
            ? options.actionTarget
            : {};
        const actionUrl = String(actionTarget.action_url || normalized.action_url || '').trim();
        const metadataWalletView = this.normalizeEngagementWalletView(normalized.metadata?.wallet_view || '');
        const walletView = this.normalizeEngagementWalletView(actionTarget.wallet_view || '')
            || this.getEngagementWalletViewFromActionUrl(actionUrl)
            || (!actionUrl ? metadataWalletView : '');
        const routeLabel = String(actionTarget.label || actionTarget.route_label || '').trim();
        const routeMetadata = {
            ...normalized.metadata,
            page_id: normalized.page_id,
            source: normalized.source,
            source_module: normalized.source_module
        };
        const walletOrderDetailTarget = walletView === 'orders'
            ? this.getEngagementWalletOrderDetailTarget(actionUrl, {
                ...routeMetadata,
                ...actionTarget
            })
            : null;
        const walletReturnContext = this.getEngagementWalletReturnContext({
            ...routeMetadata,
            ...actionTarget
        });
        const guestbookReplyTarget = this.getEngagementGuestbookReplyTarget(actionUrl, {
            ...routeMetadata
        });
        const promptReplyTarget = this.getEngagementPromptReplyTarget(actionUrl, routeMetadata);
        const verifyHelpTarget = this.getEngagementVerifyHelpTarget(actionUrl, routeMetadata);
        const shopCartTarget = this.getEngagementShopCartTarget(actionUrl, routeMetadata);
        const supportTarget = this.getEngagementSupportTarget(actionUrl, routeMetadata);
        const accountView = this.getEngagementAccountViewFromActionUrl(actionUrl, normalized.metadata || {});
        this.suppressEngagementItem(normalized);
        await this.trackEngagementEvent(normalized, 'click', {
            action_url: actionUrl || (walletView ? `wallet://${walletView}` : normalized.action_url),
            route_label: routeLabel || null,
            placement: normalized.placement
        });

        if (guestbookReplyTarget && this.isCurrentEngagementGuestbookPage()) {
            const focused = await this.focusGuestbookReplyFromEngagement(guestbookReplyTarget);
            if (focused) {
                this.dismissEngagementSurface(normalized, { passive: true });
                return;
            }
        }

        if (promptReplyTarget && this.isCurrentEngagementPromptsPage()) {
            const focused = await this.focusPromptReplyFromEngagement(promptReplyTarget);
            if (focused) {
                this.dismissEngagementSurface(normalized, { passive: true });
                return;
            }
        }

        if (verifyHelpTarget && this.isCurrentEngagementVerifyPage()) {
            const focused = await this.focusVerifyHelpFromEngagement(verifyHelpTarget);
            if (focused) {
                this.dismissEngagementSurface(normalized, { passive: true });
                return;
            }
        }

        if (shopCartTarget && this.isCurrentEngagementShopPage()) {
            const focused = await this.focusShopCartFromEngagement(shopCartTarget);
            if (focused) {
                this.dismissEngagementSurface(normalized, { passive: true });
                return;
            }
        }

        this.dismissEngagementSurface(normalized, { passive: true });

        if (accountView) {
            let accountTargetUrl = null;
            if (!/^account:/i.test(actionUrl) && !/^profile:/i.test(actionUrl) && actionUrl) {
                try {
                    accountTargetUrl = new URL(actionUrl, window.location.origin);
                } catch (_) {
                    accountTargetUrl = null;
                }
            }
            const opened = await this.openEngagementAccountView(accountView, accountTargetUrl);
            if (opened) {
                return;
            }
        }

        const authView = this.getEngagementAuthViewFromActionUrl(
            actionUrl,
            actionTarget.label || normalized.action_label || normalized.title || '',
            normalized.metadata || {}
        );
        if (authView) {
            let authTargetUrl = null;
            if (!/^(auth|login):/i.test(actionUrl) && actionUrl) {
                try {
                    authTargetUrl = new URL(actionUrl, window.location.origin);
                } catch (_) {
                    authTargetUrl = null;
                }
            }
            const opened = await this.openEngagementAuthView(authView, authTargetUrl);
            if (opened) {
                return;
            }
        }

        if (walletView) {
            const opened = await this.openEngagementWalletView(walletView, {
                source_module: normalized.source_module,
                source_event_id: normalized.source_event_id,
                notification_id: normalized.notification_id,
                rule_id: normalized.rule_id,
                route_label: routeLabel || null,
                wallet_order_detail_id: walletOrderDetailTarget?.orderId || null,
                wallet_order_ids: walletOrderDetailTarget?.orderIds || [],
                ...walletReturnContext
            });
            if (opened) {
                return;
            }
        }

        if (normalized.source === 'ops_alert' || /^ops-alert:/i.test(actionUrl)) {
            const opened = await this.openOpsAlertEngagementTarget(normalized);
            if (opened) {
                return;
            }
        }

        if (supportTarget?.type === 'ticket_history') {
            const opened = await this.openSupportTicketHistoryFromEngagement({
                ticketId: supportTarget.ticketId,
                orderId: supportTarget.orderId,
                ticketStatus: supportTarget.ticketStatus,
                ticketStatusLabel: supportTarget.ticketStatusLabel
            });
            if (opened) {
                return;
            }
        }

        if (actionUrl) {
            let targetUrl = null;
            try {
                targetUrl = new URL(actionUrl, window.location.origin);
            } catch (_) {
                await this.openChat();
                this.clearUnread();
                return;
            }
            if (!['http:', 'https:'].includes(targetUrl.protocol)) {
                await this.openChat();
                this.clearUnread();
                return;
            }
            if (targetUrl.origin === window.location.origin) {
                targetUrl = this.buildEngagementReplyNavigationUrl(targetUrl, {
                    guestbookReplyTarget,
                    promptReplyTarget
                });
                window.location.href = targetUrl.href;
                return;
            }
            window.open(targetUrl.href, '_blank', 'noopener,noreferrer');
            return;
        }

        await this.openChat();
        this.clearUnread();
    }

    // ===== Notification System =====

    showNotification(message, senderName = null, forceShow = false) {
        senderName = senderName || this.t('chat.newMessage', '新消息');
        // Don't show notification if chat is open (unless forceShow is true)
        if (this.isOpen && !forceShow) return;

        // Increment unread count
        this.unreadCount++;
        this.updateBadge();
        this._pauseFabAmbientMotion(6200, true);

        // Add animation classes
        this.fab.classList.add('has-unread');
        this.fab.classList.add('has-new-message');

        // Remove bounce animation after it completes
        setTimeout(() => {
            this.fab.classList.remove('has-new-message');
        }, 600);

        // Add wiggle animation
        setTimeout(() => {
            this.fab.classList.add('wiggle');
            setTimeout(() => this.fab.classList.remove('wiggle'), 500);
        }, 700);

        // Show message preview tooltip
        this.showMessagePreview(message, senderName);

        // Play notification sound (optional - subtle)
        this.playNotificationSound();
    }

    updateBadge() {
        // Remove existing badge
        const existingBadge = this.fab.querySelector('.notification-badge');
        if (existingBadge) existingBadge.remove();

        if (this.unreadCount > 0) {
            const badge = document.createElement('div');
            badge.className = 'notification-badge';
            badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
            this.fab.appendChild(badge);
        }
    }

    clearUnread() {
        this.unreadCount = 0;
        this.fab.classList.remove('has-unread');
        const badge = this.fab.querySelector('.notification-badge');
        if (badge) badge.remove();
        const preview = this.fab.querySelector('.message-preview');
        if (preview) preview.remove();
    }

    showMessagePreview(message, senderName) {
        // Remove existing preview
        const existingPreview = this.fab.querySelector('.message-preview');
        if (existingPreview) existingPreview.remove();

        // Create preview tooltip
        const preview = document.createElement('div');
        preview.className = 'message-preview';
        preview.innerHTML = `
            <div class="preview-sender">${senderName}</div>
            <div class="preview-text">${this.escapeHtml(message.substring(0, 100))}${message.length > 100 ? '...' : ''}</div>
        `;
        this.fab.appendChild(preview);

        // Auto-hide after 5 seconds with cute retract animation
        setTimeout(() => {
            if (preview.parentNode) {
                preview.classList.add('hiding');
                setTimeout(() => {
                    preview.remove();
                    this._scheduleFabAmbientMotion();
                }, 400);
            }
        }, 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeAttribute(text) {
        return this.escapeHtml(text)
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    sanitizeMediaUrl(url) {
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
            console.warn('[ChatWidget] Blocked unsafe media URL:', trimmed, err);
        }

        return '';
    }

    playNotificationSound() {
        // Create a subtle notification sound using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        } catch (e) {
            // Audio not supported, ignore
        }
    }

    // ===== End Notification System =====

    renderAdminMode() {
        // Two-column layout: Left = Session List, Right = Chat Area
        this.isAdmin = true;
        this.persistBootstrapShellMode('admin');
        this.currentSessionId = null;
        this.currentSessionKey = null;
        this.currentSessionIds = [];
        this.sessions = [];

        const claimedShell = this.claimBootstrapShell('admin');
        this.chatWindow = claimedShell || document.createElement('div');
        if (claimedShell) {
            this.chatWindow.classList.add('chat-window', 'admin-mode-layout');
        } else {
            this.chatWindow.className = 'chat-window admin-mode-layout';
        }
        const bootstrapContentSnapshot = this.getBootstrapContentSnapshotMarkup(this.chatWindow);

        // Create overlay for clicking outside to close
        const claimedOverlay = this.claimBootstrapOverlay('admin');
        this.overlay = claimedOverlay || document.createElement('div');
        if (!claimedOverlay) {
            this.overlay.className = 'chat-overlay';
            document.body.appendChild(this.overlay);
        }

        this.chatWindow.innerHTML = `
            <!-- Left Sidebar: Session List -->
            <div class="admin-sidebar">
                <div class="admin-sidebar-header">
                    <h3>${this.t('chat.sidebarTitle', '客服消息')}</h3>
                    <button class="chat-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="admin-sidebar-body">
                    <div class="admin-search">
                        <input type="text" id="sessionSearch" placeholder="🔍 ${this.t('chat.searchPlaceholderFull', '搜索会话或聊天记录...')}">
                    </div>
                    <section class="admin-sidebar-insights is-collapsed" id="adminSidebarInsights">
                        <button type="button" class="admin-sidebar-insights__header" id="adminSidebarInsightsToggle" aria-expanded="false">
                            <span class="admin-sidebar-insights__eyebrow">值班概览</span>
                            <span class="admin-sidebar-insights__summary" id="adminSidebarInsightsSummary">正在整理当前队列...</span>
                            <span class="admin-sidebar-insights__toggle-text">展开</span>
                        </button>
                        <div class="admin-sidebar-insights__body" id="adminSidebarInsightsBody">
                            <div class="session-queue-overview is-loading" id="sessionQueueOverview">
                                ${this.getAdminSessionOverviewSkeletonMarkup()}
                            </div>
                            <div class="session-queue-snapshot is-loading" id="sessionQueueSnapshot">
                                ${this.getAdminSessionQueueSnapshotSkeletonMarkup()}
                            </div>
                            <div class="session-queue-presets" id="sessionQueueViews"></div>
                            <div class="session-filter-bar" id="sessionFilterBar"></div>
                        </div>
                    </section>
                    <div class="session-list" id="sessionList">
                        ${this.getAdminSessionListSkeletonMarkup()}
                    </div>
                </div>
            </div>

            <!-- Right Panel: Chat Area -->
            <div class="admin-chat-area">
                <div class="admin-chat-header" id="adminChatHeader">
                    <button class="back-to-list-btn" id="backToListBtn">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <div class="chat-user-info">
                        <span class="chat-user-name">${this.t('chat.selectConversation', '选择一个会话')}</span>
                        <span class="chat-user-id"></span>
                        <div class="chat-user-status-chips" id="chatUserStatusChips" hidden></div>
                        <div class="chat-user-meta-row" id="chatUserMetaRow" hidden>
                            <div class="user-status-indicator" id="chatUserPresenceStatus" hidden></div>
                            <div class="admin-chat-header-actions" id="adminChatHeaderActions" hidden></div>
                        </div>
                    </div>
                </div>
                <div class="chat-context-panel" id="chatContextPanel" hidden></div>
                <div class="chat-messages" id="chatMessages">
                    <div class="empty-state">
                        <i class="fas fa-comments"></i>
                        <p>${this.t('chat.emptyState', '请从左侧选择一个会话开始回复')}</p>
                    </div>
                </div>
                <div class="chat-reply-templates" id="chatReplyTemplateBar" hidden></div>
                <div class="chat-input-area">
                    <input type="file" id="chatImageInput" class="chat-file-input" accept="image/*">
                    <button class="chat-action-btn" id="chatUploadBtn"><i class="fas fa-plus"></i></button>
                    <input type="text" class="chat-input" id="chatInput" placeholder="${this.t('chat.inputPlaceholder', '输入回复...')}">
                    <button class="chat-action-btn" id="chatEmojiBtn"><i class="far fa-smile"></i></button>
                    <button class="chat-send-btn" id="chatSendBtn"><i class="fas fa-paper-plane"></i></button>
                </div>
                <div class="emoji-picker-popover" id="emojiPicker">
                    ${this.emojis.map(e => `<div class="emoji-item">${e}</div>`).join('')}
                </div>
            </div>
            ${bootstrapContentSnapshot}
        `;
        if (!claimedShell) {
            document.body.appendChild(this.chatWindow);
        }
        this.scheduleBootstrapAdoptedContentSettle();

        this.messagesContainer = this.chatWindow.querySelector('#chatMessages');
        this.input = this.chatWindow.querySelector('#chatInput');
        this.emojiPicker = this.chatWindow.querySelector('#emojiPicker');
        this.sessionList = this.chatWindow.querySelector('#sessionList');
        this.sessionQueueOverview = this.chatWindow.querySelector('#sessionQueueOverview');
        this.sessionQueueViews = this.chatWindow.querySelector('#sessionQueueViews');
        this.sessionFilterBar = this.chatWindow.querySelector('#sessionFilterBar');
        this.adminSidebarInsights = this.chatWindow.querySelector('#adminSidebarInsights');
        this.adminSidebarInsightsSummary = this.chatWindow.querySelector('#adminSidebarInsightsSummary');
        this.adminSidebarInsightsToggle = this.chatWindow.querySelector('#adminSidebarInsightsToggle');
        this.chatHeader = this.chatWindow.querySelector('#adminChatHeader');
        this.userContextPanel = this.chatWindow.querySelector('#chatContextPanel');
        this.replyTemplateBar = this.chatWindow.querySelector('#chatReplyTemplateBar');
        this.scheduleAdminFloatingPanelOffsetSync();

        // Inject admin layout styles
        this.injectAdminLayoutStyles();
        this._syncDesktopViewportInsetMode();
        this.syncAdminResponsiveLayout({ force: true });
        this.observeAdminLayoutSize();

        // Bind events
        this.bindAdminEvents();

        const restoredSessions = this.restoreAdminSessionSnapshot();
        if (restoredSessions.length > 0) {
            this._adminSessionListBootstrapping = false;
            this.setAdminChatSessions(restoredSessions);
        } else {
            this._adminSessionListBootstrapping = true;
        }

        // Prewarm admin conversations in the background so opening the widget feels faster.
        this.scheduleAdminSessionPrewarm({ immediate: restoredSessions.length === 0 });

        // Subscribe to all messages for admin
        this.subscribeToAdminMessages();
        this.subscribeToUserPresence();
        this.subscribeToUserActivity();
        this.startAdminOpsAlertPolling();
        this.startAdminSessionSlaTicker();
    }

    // Update admin mode text when language changes
    updateAdminModeText() {
        if (!this.chatWindow || !this.isAdmin) return;

        // Update sidebar header title
        const sidebarTitle = this.chatWindow.querySelector('.admin-sidebar-header h3');
        if (sidebarTitle) {
            sidebarTitle.textContent = this.t('chat.sidebarTitle', '客服消息');
        }

        // Update search placeholder
        const searchInput = this.chatWindow.querySelector('#sessionSearch');
        if (searchInput) {
            searchInput.placeholder = `🔍 ${this.t('chat.searchPlaceholderFull', '搜索会话或聊天记录...')}`;
        }

        // Update chat header (if no session selected)
        const chatUserName = this.chatWindow.querySelector('.chat-user-name');
        if (chatUserName && !this.currentSessionKey) {
            chatUserName.textContent = this.t('chat.selectConversation', '选择一个会话');
        }

        // Update empty state message
        const emptyState = this.chatWindow.querySelector('.empty-state p');
        if (emptyState) {
            emptyState.textContent = this.t('chat.emptyState', '请从左侧选择一个会话开始回复');
        }

        // Update input placeholder
        const chatInput = this.chatWindow.querySelector('#chatInput');
        if (chatInput) {
            chatInput.placeholder = this.t('chat.inputPlaceholder', '输入回复...');
        }

        // Update loading text if visible
        const loadingText = this.chatWindow.querySelector('.session-loading');
        if (loadingText) {
            loadingText.textContent = this.t('chat.loading', '加载中...');
        }

        this.updateAdminSidebarInsightsShell();
    }

    getAdminSessionOverviewSkeletonMarkup() {
        return Array.from({ length: 4 }, () => `
            <div class="session-queue-card session-queue-card--skeleton" aria-hidden="true">
                <span class="session-queue-skeleton session-queue-skeleton--value"></span>
                <span class="session-queue-skeleton session-queue-skeleton--label"></span>
                <span class="session-queue-skeleton session-queue-skeleton--hint"></span>
            </div>
        `).join('');
    }

    getAdminSessionQueueSnapshotSkeletonMarkup() {
        return `
            <div class="session-queue-skeleton session-queue-skeleton--eyebrow"></div>
            <div class="session-queue-skeleton session-queue-skeleton--line"></div>
            <div class="session-queue-skeleton session-queue-skeleton--line session-queue-skeleton--line-wide"></div>
            <div class="session-queue-skeleton session-queue-skeleton--pill-row">
                <span class="session-queue-skeleton session-queue-skeleton--pill"></span>
                <span class="session-queue-skeleton session-queue-skeleton--pill"></span>
                <span class="session-queue-skeleton session-queue-skeleton--pill"></span>
            </div>
        `;
    }

    getAdminSessionListSkeletonMarkup(count = 6) {
        return Array.from({ length: count }, () => `
            <div class="session-skeleton" aria-hidden="true">
                <span class="session-skeleton__avatar"></span>
                <span class="session-skeleton__body">
                    <span class="session-skeleton__line session-skeleton__line--primary"></span>
                    <span class="session-skeleton__line session-skeleton__line--secondary"></span>
                    <span class="session-skeleton__line session-skeleton__line--tertiary"></span>
                </span>
            </div>
        `).join('');
    }

    setAdminSidebarInsightsCollapsed(collapsed = false) {
        this.adminSidebarInsightsCollapsed = collapsed !== false;
        this.updateAdminSidebarInsightsShell();
    }

    updateAdminSidebarInsightsShell(snapshot = null) {
        const shell = this.adminSidebarInsights;
        const toggle = this.adminSidebarInsightsToggle;
        const summary = this.adminSidebarInsightsSummary;
        if (!shell || !toggle) {
            return;
        }

        const collapsed = this.adminSidebarInsightsCollapsed !== false;
        shell.classList.toggle('is-collapsed', collapsed);
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

        const toggleText = toggle.querySelector('.admin-sidebar-insights__toggle-text');
        if (toggleText) {
            toggleText.textContent = collapsed ? '展开' : '收起';
        }

        if (!summary) {
            return;
        }

        const sourceSnapshot = snapshot && typeof snapshot === 'object'
            ? snapshot
            : this.getAdminSessionQueueBacklogSnapshot?.();
        if (!sourceSnapshot || typeof sourceSnapshot !== 'object') {
            summary.textContent = '正在整理当前队列...';
            return;
        }

        const summaryParts = [];
        if (Number(sourceSnapshot.pendingReply || 0) > 0) {
            summaryParts.push(`待回复 ${sourceSnapshot.pendingReply}`);
        }
        if (Number(sourceSnapshot.staleReply || 0) > 0) {
            summaryParts.push(`久未回复 ${sourceSnapshot.staleReply}`);
        }
        if (Number(sourceSnapshot.openTickets || 0) > 0) {
            summaryParts.push(`工单中 ${sourceSnapshot.openTickets}`);
        }
        if (Number(sourceSnapshot.verificationAlerts || 0) > 0) {
            summaryParts.push(`验证异常 ${sourceSnapshot.verificationAlerts}`);
        }

        summary.textContent = summaryParts.length
            ? summaryParts.slice(0, 3).join(' · ')
            : '当前队列比较平稳';
    }

    setAdminChatSessions(chatSessions = []) {
        const normalizedChatSessions = this.sortAdminSessions(Array.isArray(chatSessions) ? chatSessions : []);
        this.sessions = [
            this.buildOpsAlertSession(),
            ...normalizedChatSessions
        ];
        this.applyUserPresenceToAdminSessions();
        this.persistAdminSessionSnapshot(normalizedChatSessions);
        this.renderAdminSessionList();
    }

    injectAdminLayoutStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Admin Mode Layout - Two Column with Glassmorphism */
            .chat-window.admin-mode-layout {
                --chat-admin-top-gap: clamp(18px, 4vh, 36px);
                --chat-admin-bottom-gap: 24px;
                width: min(1040px, calc(100vw - 32px)) !important;
                max-width: 97vw;
                height: min(760px, calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap)))) !important;
                max-height: calc(100vh - (var(--chat-admin-top-gap) + var(--chat-admin-bottom-gap))) !important;
                top: var(--chat-admin-top-gap) !important;
                right: 30px !important;
                bottom: auto !important;
                display: flex;
                flex-direction: row !important;
                transform-origin: bottom right !important;
                border-radius: 20px;
                overflow: hidden;
                background: rgba(8, 10, 16, 0.98) !important;
                background-image: none !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                border: 1px solid rgba(255, 255, 255, 0.16) !important;
                box-shadow: 
                    0 24px 60px rgba(0, 0, 0, 0.24),
                    inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
            }

            .chat-window.admin-mode-layout.chat-widget-bootstrap-shell--admin[data-chat-widget-bootstrap-adopted="1"] {
                display: flex !important;
                flex-direction: row !important;
            }

            .chat-window.admin-mode-layout.chat-window--desktop-edge-safe {
                --chat-admin-top-gap: clamp(56px, 9vh, 96px);
                top: 50% !important;
                transform: translateY(calc(-50% + 20px)) scale(0.95) !important;
                transform-origin: center right !important;
            }

            .chat-window.admin-mode-layout.chat-window--desktop-edge-safe.active {
                transform: translateY(-50%) scale(1) !important;
            }

            .chat-window.admin-mode-layout.keyboard-docked,
            .chat-window.admin-mode-layout.keyboard-docked.active,
            .chat-window.admin-mode-layout.chat-window--keyboard-height-locked.keyboard-docked,
            .chat-window.admin-mode-layout.chat-window--keyboard-height-locked.keyboard-docked.active {
                top: 50% !important;
                left: 50% !important;
                right: auto !important;
                bottom: auto !important;
                transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                transform-origin: center center !important;
            }
            
            /* Left Sidebar */
            .admin-sidebar {
                width: 324px;
                min-width: 300px;
                max-width: 35%;
                display: flex;
                flex-direction: column;
                background: rgba(12, 15, 22, 0.98);
                background-image: none;
                border-right: 1px solid rgba(255, 255, 255, 0.1);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
                min-height: 0;
                overflow: hidden;
            }
            
            .admin-sidebar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 15px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .admin-sidebar-header h3 {
                margin: 0;
                font-size: 16px;
                color: white;
                font-weight: 600;
            }
            
            .admin-search {
                padding: 10px 12px;
            }
            .admin-sidebar-body {
                flex: 1;
                min-height: 0;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .admin-sidebar-insights {
                margin: 0 12px 10px;
                border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.045);
                overflow: hidden;
                flex: 0 0 auto;
            }
            .admin-sidebar-insights__header {
                appearance: none;
                width: 100%;
                border: 0;
                background: transparent;
                color: inherit;
                padding: 12px 14px;
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 4px 12px;
                align-items: center;
                text-align: left;
                cursor: pointer;
            }
            .admin-sidebar-insights__eyebrow {
                color: rgba(255, 255, 255, 0.72);
                font-size: 11px;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }
            .admin-sidebar-insights__summary {
                grid-column: 1 / 2;
                color: rgba(255, 255, 255, 0.82);
                font-size: 12px;
                line-height: 1.5;
                min-width: 0;
            }
            .admin-sidebar-insights__toggle-text {
                grid-column: 2 / 3;
                grid-row: 1 / span 2;
                align-self: center;
                color: rgba(255, 255, 255, 0.62);
                font-size: 12px;
                white-space: nowrap;
            }
            .admin-sidebar-insights__body {
                padding-bottom: 10px;
                max-height: min(300px, 42vh);
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: rgba(148, 148, 148, 0.55) transparent;
            }
            .admin-sidebar-insights.is-collapsed .admin-sidebar-insights__body {
                display: none;
            }
            .session-queue-overview {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
                padding: 0 12px 10px;
            }
            .session-queue-card {
                appearance: none;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(255, 255, 255, 0.05);
                border-radius: 14px;
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 2px;
                color: inherit;
                cursor: pointer;
                transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
            }
            .session-queue-card:hover {
                background: rgba(255, 255, 255, 0.08);
                transform: translateY(-1px);
            }
            .session-queue-card.is-active {
                background: rgba(107, 158, 206, 0.16);
                border-color: rgba(107, 158, 206, 0.28);
            }
            .session-queue-card__value {
                color: #f8fafc;
                font-size: 18px;
                font-weight: 700;
                line-height: 1.1;
            }
            .session-queue-card__label {
                color: rgba(255, 255, 255, 0.92);
                font-size: 12px;
                font-weight: 600;
            }
            .session-queue-card__hint {
                color: rgba(255, 255, 255, 0.55);
                font-size: 11px;
            }
            .session-queue-snapshot {
                margin: 0 12px 10px;
                padding: 10px 12px;
                border-radius: 14px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.05);
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .session-queue-snapshot__title {
                color: rgba(255, 255, 255, 0.72);
                font-size: 11px;
                letter-spacing: 0.04em;
            }
            .session-queue-snapshot__mode {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                color: rgba(255, 255, 255, 0.58);
                font-size: 11px;
            }
            .session-queue-snapshot__summary {
                color: #f8fafc;
                font-size: 12px;
                font-weight: 600;
                line-height: 1.45;
            }
            .session-queue-snapshot__meta {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                color: rgba(255, 255, 255, 0.58);
                font-size: 11px;
            }
            .session-queue-snapshot__capacity {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .session-queue-snapshot__capacity-badge {
                display: inline-flex;
                align-items: center;
                border-radius: 999px;
                padding: 5px 10px;
                font-size: 11px;
                line-height: 1.2;
            }
            .session-queue-snapshot__capacity-badge--warning {
                background: rgba(244, 195, 99, 0.16);
                color: #fde68a;
            }
            .session-queue-snapshot__capacity-badge--danger {
                background: rgba(239, 68, 68, 0.18);
                color: #fecaca;
            }
            .session-queue-snapshot__actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
            }
            .session-queue-snapshot__action {
                appearance: none;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(255, 255, 255, 0.06);
                color: #f8fafc;
                border-radius: 999px;
                padding: 5px 10px;
                font-size: 11px;
                line-height: 1.2;
                cursor: pointer;
            }
            .session-queue-snapshot__action--ghost {
                background: rgba(255, 255, 255, 0.02);
                color: rgba(255, 255, 255, 0.78);
            }
            .session-queue-snapshot__hint {
                color: rgba(255, 255, 255, 0.62);
                font-size: 11px;
            }
            .session-queue-snapshot__suggestions {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .session-queue-suggestion {
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(10, 14, 24, 0.32);
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .session-queue-suggestion--danger {
                border-color: rgba(248, 113, 113, 0.28);
                background: rgba(127, 29, 29, 0.18);
            }
            .session-queue-suggestion--warning {
                border-color: rgba(250, 204, 21, 0.24);
                background: rgba(113, 63, 18, 0.18);
            }
            .session-queue-suggestion--calm {
                border-color: rgba(107, 158, 206, 0.24);
                background: rgba(107, 158, 206, 0.16);
            }
            .session-queue-suggestion__eyebrow {
                color: rgba(255, 255, 255, 0.6);
                font-size: 10px;
                letter-spacing: 0.05em;
                text-transform: uppercase;
            }
            .session-queue-suggestion__title {
                color: #f8fafc;
                font-size: 12px;
                font-weight: 700;
                line-height: 1.35;
            }
            .session-queue-suggestion__desc {
                color: rgba(255, 255, 255, 0.78);
                font-size: 11px;
                line-height: 1.55;
            }
            .session-queue-suggestion__action {
                appearance: none;
                align-self: flex-start;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(255, 255, 255, 0.08);
                color: #f8fafc;
                border-radius: 999px;
                padding: 5px 10px;
                font-size: 11px;
                line-height: 1.2;
                cursor: pointer;
            }
            .session-queue-suggestion__hint {
                color: rgba(255, 255, 255, 0.68);
                font-size: 11px;
            }
            .session-queue-suggestion__list {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .session-queue-suggestion__list-item {
                display: flex;
                align-items: flex-start;
                gap: 8px;
            }
            .session-queue-suggestion__index {
                width: 18px;
                height: 18px;
                flex: 0 0 18px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.12);
                color: #f8fafc;
                font-size: 10px;
                font-weight: 700;
            }
            .session-queue-suggestion__list-body {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .session-queue-suggestion__list-title {
                color: #f8fafc;
                font-size: 11px;
                font-weight: 600;
                line-height: 1.35;
            }
            .session-queue-suggestion__list-detail {
                color: rgba(255, 255, 255, 0.7);
                font-size: 11px;
                line-height: 1.45;
            }
            .session-queue-presets {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                padding: 0 12px 10px;
            }
            .session-queue-preset {
                appearance: none;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.78);
                border-radius: 999px;
                padding: 6px 10px;
                font-size: 11px;
                line-height: 1.2;
                cursor: pointer;
                transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
            }
            .session-queue-preset:hover {
                background: rgba(255, 255, 255, 0.08);
                color: rgba(255, 255, 255, 0.95);
            }
            .session-queue-preset.is-active {
                background: rgba(244, 195, 99, 0.16);
                border-color: rgba(244, 195, 99, 0.28);
                color: #fde68a;
            }
            .session-filter-bar {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                padding: 0 12px 10px;
            }
            .session-queue-card--skeleton {
                pointer-events: none;
            }
            .session-queue-skeleton {
                display: block;
                border-radius: 999px;
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.08));
                background-size: 220% 100%;
                animation: session-skeleton-shimmer 1.25s linear infinite;
            }
            .session-queue-skeleton--value {
                width: 42px;
                height: 20px;
            }
            .session-queue-skeleton--label {
                width: 64px;
                height: 12px;
            }
            .session-queue-skeleton--hint {
                width: 52px;
                height: 10px;
            }
            .session-queue-skeleton--eyebrow {
                width: 58px;
                height: 10px;
                margin-bottom: 8px;
            }
            .session-queue-skeleton--line {
                width: 78%;
                height: 12px;
                margin-bottom: 8px;
            }
            .session-queue-skeleton--line-wide {
                width: 94%;
            }
            .session-queue-skeleton--pill-row {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 6px;
            }
            .session-queue-skeleton--pill {
                width: 72px;
                height: 22px;
            }
            .session-filter-btn {
                appearance: none;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.68);
                border-radius: 999px;
                padding: 6px 10px;
                font-size: 11px;
                line-height: 1.2;
                cursor: pointer;
                transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
            }
            .session-filter-btn:hover {
                background: rgba(255, 255, 255, 0.08);
                color: rgba(255, 255, 255, 0.9);
                transform: translateY(-1px);
            }
            .session-filter-btn.is-active {
                background: rgba(107, 158, 206, 0.18);
                border-color: rgba(107, 158, 206, 0.3);
                color: #d9e8f4;
            }
            .chat-window.admin-mode-layout .admin-search:focus-within {
                border-color: transparent !important;
                box-shadow: none !important;
            }
            .admin-search input {
                width: 100%;
                padding: 8px 12px;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                background: rgba(255, 255, 255, 0.08);
                color: white;
                font-size: 13px;
                box-sizing: border-box;
            }
            .chat-window.admin-mode-layout .admin-search input:focus,
            .chat-window.admin-mode-layout .admin-search input:focus-visible,
            .chat-window.admin-mode-layout .admin-search input:-webkit-autofill:focus,
            .chat-window.admin-mode-layout .admin-search input:-webkit-autofill:focus-visible {
                outline: none;
                border-color: #6b9ece !important;
                background: rgba(255, 255, 255, 0.042) !important;
                box-shadow: 0 0 0 3px rgba(107, 158, 206, 0.14) !important;
                caret-color: #6b9ece !important;
            }
            .admin-mode-layout .chat-input:focus,
            .admin-mode-layout .chat-input:focus-visible,
            .admin-mode-layout .chat-input:-webkit-autofill:focus,
            .admin-mode-layout .chat-input:-webkit-autofill:focus-visible {
                border-color: #6b9ece !important;
                background: rgba(255, 255, 255, 0.042) !important;
                box-shadow: 0 0 0 3px rgba(107, 158, 206, 0.14) !important;
                outline: none !important;
                caret-color: #6b9ece !important;
            }
            .admin-search input::placeholder {
                color: rgba(255, 255, 255, 0.4);
            }
            
            /* Session List */
            .session-list {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                scrollbar-gutter: stable both-edges;
                scrollbar-width: thin;
                scrollbar-color: rgba(148, 148, 148, 0.72) transparent;
                padding-bottom: 10px;
            }
            .session-skeleton {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 15px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }
            .session-skeleton__avatar {
                width: 36px;
                height: 36px;
                flex: 0 0 36px;
                border-radius: 50%;
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.08));
                background-size: 220% 100%;
                animation: session-skeleton-shimmer 1.25s linear infinite;
            }
            .session-skeleton__body {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .session-skeleton__line {
                height: 10px;
                border-radius: 999px;
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.08));
                background-size: 220% 100%;
                animation: session-skeleton-shimmer 1.25s linear infinite;
            }
            .session-skeleton__line--primary {
                width: 54%;
            }
            .session-skeleton__line--secondary {
                width: 72%;
            }
            .session-skeleton__line--tertiary {
                width: 42%;
            }
            @keyframes session-skeleton-shimmer {
                0% {
                    background-position: 200% 0;
                }
                100% {
                    background-position: -20% 0;
                }
            }
            
            .session-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 15px;
                cursor: pointer;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                transition: background 0.2s;
            }
            .session-item:hover {
                background: rgba(255, 255, 255, 0.08);
            }
            .session-item.active {
                background: rgba(107, 158, 206, 0.16);
                border-left: 3px solid #6b9ece;
            }
            .session-item--ops {
                background: linear-gradient(180deg, rgba(107, 158, 206, 0.16), rgba(107, 158, 206, 0.08));
            }
            .session-item--ops:hover {
                background: linear-gradient(180deg, rgba(107, 158, 206, 0.2), rgba(95, 143, 188, 0.14));
            }
            .session-item--ops .session-name {
                color: #d9e8f4;
                font-weight: 600;
            }
            .session-item--ops .session-badge {
                background: rgba(255, 255, 255, 0.14);
                color: #d9e8f4;
            }
            .session-item--ops .session-email {
                color: rgba(217, 232, 244, 0.72);
            }
            .session-item--ops .session-preview {
                color: rgba(217, 232, 244, 0.82);
            }
            
            /* Unread session - attention-grabbing style */
            .session-item.unread {
                background: rgba(255, 107, 107, 0.1);
                border-left: 3px solid #ff6b6b;
                animation: unread-pulse 2s ease-in-out infinite;
            }
            .session-item.unread .session-name {
                font-weight: 700;
                color: #fff;
            }
            .session-item.unread .session-preview {
                color: rgba(255, 255, 255, 0.9);
            }
            .session-item.unread .session-time {
                color: #ff6b6b;
                font-weight: 600;
            }
            
            @keyframes unread-pulse {
                0%, 100% {
                    background: rgba(255, 107, 107, 0.1);
                }
                50% {
                    background: rgba(255, 107, 107, 0.2);
                }
            }
            
            /* Unread badge on session item */
            .session-item .unread-dot {
                width: 8px;
                height: 8px;
                background: #ff6b6b;
                border-radius: 50%;
                flex-shrink: 0;
                animation: dot-pulse 1.5s ease-in-out infinite;
            }
            
            @keyframes dot-pulse {
                0%, 100% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.3); opacity: 0.7; }
            }
            
            .session-avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: linear-gradient(135deg, rgba(107, 158, 206, 0.95) 0%, rgba(95, 143, 188, 0.92) 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 14px;
                flex-shrink: 0;
            }
            .session-avatar.has-image {
                background: rgba(255, 255, 255, 0.08);
                overflow: hidden;
            }
            .session-avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .session-avatar--ops {
                background: linear-gradient(135deg, rgba(107, 158, 206, 0.98) 0%, rgba(95, 143, 188, 0.98) 100%);
                box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 14px 24px rgba(107, 158, 206, 0.32);
            }
            .session-avatar--ops i {
                font-size: 14px;
            }
            
            .session-info {
                flex: 1;
                min-width: 0;
            }
            .session-name-row {
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
            }
            .session-name {
                color: white;
                font-weight: 500;
                font-size: 13px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .session-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 38px;
                padding: 2px 8px;
                border-radius: 999px;
                background: rgba(107, 158, 206, 0.18);
                color: #d9e8f4;
                font-size: 10px;
                line-height: 1.2;
                letter-spacing: 0.02em;
                flex-shrink: 0;
            }
            .session-badge--ticket {
                background: rgba(244, 195, 99, 0.18);
                color: #fde68a;
            }
            .session-badge--warning {
                background: rgba(244, 195, 99, 0.18);
                color: #fde68a;
            }
            .session-badge--danger {
                background: rgba(239, 68, 68, 0.22);
                color: #fecaca;
            }
            .session-preview {
                color: rgba(255, 255, 255, 0.5);
                font-size: 12px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 2px;
            }
            .session-time {
                color: rgba(255, 255, 255, 0.4);
                font-size: 11px;
                flex-shrink: 0;
            }
            .session-time--online,
            .session-item.unread .session-time--online {
                color: #22c55e;
                font-weight: 700;
            }
            .session-email {
                color: rgba(255, 255, 255, 0.4);
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            /* Search match count badge */
            .search-match-count {
                background: linear-gradient(135deg, #6b9ece 0%, #5f8fbc 100%);
                color: white;
                font-size: 10px;
                font-weight: 600;
                padding: 3px 8px;
                border-radius: 10px;
                white-space: nowrap;
                margin-left: auto;
                flex-shrink: 0;
                animation: badge-pop 0.3s ease;
            }
            
            /* User online status in chat header */
            .user-status-indicator {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-top: 4px;
            }
            .user-status-indicator[hidden] {
                display: none !important;
            }
            .user-status-indicator .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }
            .user-status-indicator .status-dot.online {
                background: #4cd964;
                box-shadow: 0 0 8px rgba(76, 217, 100, 0.5);
            }
            .user-status-indicator .status-dot.away {
                background: #ffcc00;
            }
            .user-status-indicator .status-dot.offline {
                background: #8e8e93;
            }
            .user-status-indicator .status-text {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.5);
            }
            .chat-user-meta-row {
                display: flex;
                align-items: center;
                gap: 8px;
                justify-content: space-between;
                flex-wrap: nowrap;
                margin-top: 8px;
                width: 100%;
                min-width: 0;
            }
            .chat-user-meta-row:empty {
                display: none;
            }
            .chat-user-meta-row[hidden] {
                display: none !important;
            }
            .chat-user-meta-row .user-status-indicator {
                margin-top: 0;
                flex: 0 0 auto;
            }
            .chat-user-context-inline-trigger {
                appearance: none;
                display: none;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 999px;
                border: 1px solid rgba(107, 158, 206, 0.22);
                background: rgba(107, 158, 206, 0.14);
                color: rgba(217, 232, 244, 0.92);
                font-size: 11px;
                line-height: 1.2;
                cursor: pointer;
                transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
            }
            .chat-user-context-inline-trigger:hover {
                background: rgba(107, 158, 206, 0.2);
                border-color: rgba(107, 158, 206, 0.32);
                color: #ffffff;
            }
            .chat-user-context-inline-trigger.is-active {
                background: rgba(107, 158, 206, 0.24);
                border-color: rgba(107, 158, 206, 0.38);
            }
            .chat-user-context-inline-trigger__label {
                white-space: nowrap;
            }
            .ops-alert-toolbar-trigger {
                appearance: none;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 12px;
                border-radius: 999px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(255, 255, 255, 0.055);
                color: rgba(226, 232, 240, 0.92);
                font-size: 12px;
                font-weight: 600;
                line-height: 1.2;
                cursor: pointer;
                transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
            }
            .ops-alert-toolbar-trigger:hover {
                background: rgba(255, 255, 255, 0.11);
                border-color: rgba(255, 255, 255, 0.18);
                color: #ffffff;
            }
            .ops-alert-toolbar-trigger.is-active {
                background: rgba(107, 158, 206, 0.18);
                border-color: rgba(107, 158, 206, 0.28);
                color: #d9e8f4;
            }
            .ops-alert-toolbar-trigger__count {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 20px;
                height: 20px;
                padding: 0 6px;
                border-radius: 999px;
                background: rgba(107, 158, 206, 0.22);
                color: #d9e8f4;
                font-size: 11px;
                font-weight: 700;
                line-height: 1;
            }
            .chat-user-status-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }
            .chat-user-status-chips[hidden] {
                display: none !important;
            }
            .chat-user-status-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 5px 10px;
                border-radius: 999px;
                background: rgba(148, 163, 184, 0.12);
                border: 1px solid rgba(148, 163, 184, 0.12);
            }
            .chat-user-status-chip__label {
                color: rgba(255, 255, 255, 0.52);
                font-size: 11px;
            }
            .chat-user-status-chip__value {
                color: rgba(255, 255, 255, 0.92);
                font-size: 11px;
                font-weight: 600;
            }
            .chat-user-status-chip--success {
                background: rgba(74, 222, 128, 0.12);
                border-color: rgba(74, 222, 128, 0.18);
            }
            .chat-user-status-chip--success .chat-user-status-chip__value {
                color: #dcfce7;
            }
            .chat-user-status-chip--warning {
                background: rgba(244, 195, 99, 0.14);
                border-color: rgba(244, 195, 99, 0.18);
            }
            .chat-user-status-chip--warning .chat-user-status-chip__value {
                color: #fff1cc;
            }
            .chat-user-status-chip--danger {
                background: rgba(255, 107, 107, 0.14);
                border-color: rgba(255, 107, 107, 0.18);
            }
            .chat-user-status-chip--danger .chat-user-status-chip__value {
                color: #ffd9d9;
            }
            .chat-context-panel {
                position: absolute;
                left: 16px;
                right: 16px;
                top: var(--chat-admin-context-top, 128px);
                z-index: 4;
                padding: 0;
                flex: 0 0 auto;
                min-height: 0;
                background: transparent;
                pointer-events: auto;
            }
            .chat-context-panel[hidden] {
                display: none !important;
            }
            .chat-context-panel__state {
                padding: 12px 14px;
                border-radius: 14px;
                background: rgba(12, 16, 24, 0.72);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.62);
                font-size: 12px;
                line-height: 1.6;
                backdrop-filter: blur(14px) saturate(165%);
                -webkit-backdrop-filter: blur(14px) saturate(165%);
            }
            .chat-context-panel--error .chat-context-panel__state {
                color: #fecaca;
                background: rgba(127, 29, 29, 0.28);
                border-color: rgba(248, 113, 113, 0.2);
            }
            .user-context-shell {
                position: relative;
                border-radius: 18px;
                background: rgba(12, 16, 24, 0.72);
                background-image: none;
                border: 1px solid rgba(255, 255, 255, 0.12);
                overflow: hidden;
                box-shadow: 0 18px 38px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(255, 255, 255, 0.025);
                backdrop-filter: blur(14px) saturate(165%);
                -webkit-backdrop-filter: blur(14px) saturate(165%);
            }
            .user-context-shell::before,
            .chat-reply-templates::before {
                content: "";
                position: absolute;
                inset: 0;
                z-index: 0;
                pointer-events: none;
                border-radius: inherit;
                background: none;
                opacity: 0;
            }
            .user-context-shell__toggle,
            .user-context-shell__body,
            .chat-reply-templates__label,
            .chat-reply-templates__list {
                position: relative;
                z-index: 1;
            }
            .user-context-shell__toggle {
                appearance: none;
                width: 100%;
                border: 0;
                background: transparent;
                color: inherit;
                padding: 14px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                text-align: left;
                cursor: pointer;
            }
            .user-context-shell__toggle:hover {
                background: transparent;
            }
            .user-context-shell__toggle-copy {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 0;
                flex: 1;
            }
            .user-context-shell__eyebrow {
                color: rgba(255, 255, 255, 0.5);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }
            .user-context-shell__title {
                color: rgba(255, 255, 255, 0.96);
                font-size: 14px;
                font-weight: 700;
                line-height: 1.4;
            }
            .user-context-shell__summary {
                color: rgba(255, 255, 255, 0.58);
                font-size: 12px;
                line-height: 1.6;
                word-break: break-word;
            }
            .user-context-shell__toggle-side {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
            }
            .user-context-shell__toggle-text {
                color: rgba(217, 232, 244, 0.88);
                font-size: 12px;
                font-weight: 600;
            }
            .user-context-shell__toggle-icon {
                color: rgba(217, 232, 244, 0.72);
                font-size: 12px;
                transition: transform 0.2s ease;
            }
            .user-context-shell__body {
                max-height: min(320px, 42vh);
                opacity: 1;
                overflow: hidden;
                border-top: 1px solid rgba(148, 163, 184, 0.07);
                transition: max-height 0.24s ease, opacity 0.2s ease, border-color 0.2s ease;
            }
            .user-context-shell__body-inner {
                max-height: min(320px, 42vh);
                overflow-y: auto;
                padding: 0 16px 16px;
            }
            .user-context-shell.is-collapsed .user-context-shell__body {
                max-height: 0;
                opacity: 0;
                border-top-color: transparent;
            }
            .user-context-shell.is-collapsed .user-context-shell__toggle-icon {
                transform: rotate(-90deg);
            }
            .chat-reply-templates {
                position: absolute;
                left: 16px;
                right: 16px;
                top: var(--chat-admin-context-top, 128px);
                bottom: auto;
                margin: 0;
                padding: 12px;
                border-radius: 18px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(12, 16, 24, 0.72);
                background-image: none;
                box-shadow: 0 18px 38px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(255, 255, 255, 0.025);
                backdrop-filter: blur(14px) saturate(165%);
                -webkit-backdrop-filter: blur(14px) saturate(165%);
                z-index: 4;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: auto;
            }
            .chat-reply-templates[hidden] {
                display: none !important;
            }
            .chat-reply-templates__label {
                color: rgba(255, 255, 255, 0.52);
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.02em;
            }
            .chat-reply-templates__toggle {
                appearance: none;
                display: none;
                width: 100%;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 999px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(255, 255, 255, 0.055);
                color: rgba(255, 255, 255, 0.9);
                cursor: pointer;
            }
            .chat-reply-templates__toggle-copy {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
            }
            .chat-reply-templates__toggle-label {
                font-size: 12px;
                font-weight: 600;
                line-height: 1.2;
            }
            .chat-reply-templates__toggle-count {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 20px;
                height: 20px;
                padding: 0 6px;
                border-radius: 999px;
                background: rgba(107, 158, 206, 0.22);
                color: #d9e8f4;
                font-size: 11px;
                font-weight: 700;
                line-height: 1;
            }
            .chat-reply-templates__toggle-text {
                color: rgba(217, 232, 244, 0.82);
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
            }
            .chat-reply-templates__content {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .chat-reply-templates__list {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .chat-reply-template-btn {
                appearance: none;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.065);
                background-image: none;
                color: rgba(255, 255, 255, 0.92);
                border-radius: 14px;
                padding: 10px 12px;
                display: inline-flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 2px;
                cursor: pointer;
                transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
            }
            .chat-reply-template-btn:hover {
                transform: translateY(-1px);
                border-color: rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.11);
                box-shadow: 0 10px 20px rgba(0, 0, 0, 0.14);
            }
            .chat-reply-template-btn__label {
                color: rgba(255, 255, 255, 0.92);
                font-size: 12px;
                font-weight: 600;
                line-height: 1.4;
            }
            .chat-reply-template-btn__hint {
                color: rgba(255, 255, 255, 0.56);
                font-size: 11px;
                line-height: 1.5;
            }
            .user-context-card {
                padding-top: 14px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .user-context-summary {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 10px;
            }
            .user-context-pill {
                padding: 10px 12px;
                border-radius: 14px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.09);
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .user-context-pill__label {
                color: rgba(255, 255, 255, 0.48);
                font-size: 11px;
            }
            .user-context-pill__value {
                color: rgba(255, 255, 255, 0.92);
                font-size: 13px;
                line-height: 1.5;
                word-break: break-word;
            }
            .user-context-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
            }
            .user-context-headline {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 12px;
                border-radius: 16px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.09);
            }
            .user-context-headline__label {
                color: rgba(255, 255, 255, 0.82);
                font-size: 12px;
                font-weight: 600;
            }
            .user-context-headline__items {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .user-context-headline__item {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 10px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.065);
                border: 1px solid rgba(255, 255, 255, 0.08);
            }
            .user-context-headline__item-label {
                color: rgba(255, 255, 255, 0.52);
                font-size: 11px;
            }
            .user-context-headline__item-value {
                color: rgba(255, 255, 255, 0.92);
                font-size: 12px;
                font-weight: 600;
            }
            .user-context-headline__item--success {
                background: rgba(74, 222, 128, 0.12);
                border-color: rgba(74, 222, 128, 0.14);
            }
            .user-context-headline__item--success .user-context-headline__item-value {
                color: #dcfce7;
            }
            .user-context-headline__item--warning {
                background: rgba(244, 195, 99, 0.14);
                border-color: rgba(244, 195, 99, 0.15);
            }
            .user-context-headline__item--warning .user-context-headline__item-value {
                color: #fff1cc;
            }
            .user-context-headline__item--danger {
                background: rgba(255, 107, 107, 0.14);
                border-color: rgba(255, 107, 107, 0.15);
            }
            .user-context-headline__item--danger .user-context-headline__item-value {
                color: #ffd9d9;
            }
            .user-context-recent-action {
                appearance: none;
                width: 100%;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.065);
                border-radius: 16px;
                padding: 12px 14px;
                display: flex;
                align-items: center;
                gap: 10px;
                text-align: left;
                cursor: pointer;
                transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
            }
            .user-context-recent-action:hover {
                transform: translateY(-1px);
                border-color: rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.11);
                box-shadow: 0 10px 20px rgba(0, 0, 0, 0.14);
            }
            .user-context-recent-action__label {
                color: rgba(255, 255, 255, 0.76);
                font-size: 11px;
                font-weight: 700;
                white-space: nowrap;
            }
            .user-context-recent-action__value {
                color: rgba(255, 255, 255, 0.92);
                font-size: 12px;
                font-weight: 600;
                line-height: 1.5;
                min-width: 0;
                flex: 1;
                word-break: break-word;
            }
            .user-context-recent-action__time {
                color: rgba(255, 255, 255, 0.5);
                font-size: 11px;
                white-space: nowrap;
            }
            .user-context-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
            }
            .user-context-action-btn {
                appearance: none;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.065);
                color: rgba(255, 255, 255, 0.92);
                border-radius: 14px;
                padding: 10px 12px;
                display: inline-flex;
                align-items: center;
                gap: 10px;
                min-width: 0;
                cursor: pointer;
                transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
            }
            .user-context-action-btn:hover {
                transform: translateY(-1px);
                border-color: rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.11);
                box-shadow: 0 10px 20px rgba(0, 0, 0, 0.14);
            }
            .user-context-action-btn--recent {
                border-color: rgba(74, 222, 128, 0.18);
                background: rgba(74, 222, 128, 0.12);
                box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.05);
            }
            .user-context-action-btn__icon {
                width: 28px;
                height: 28px;
                border-radius: 10px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                background: rgba(255, 255, 255, 0.08);
                color: rgba(255, 255, 255, 0.86);
                flex-shrink: 0;
            }
            .user-context-action-btn--payment_read {
                border-color: rgba(74, 222, 128, 0.16);
                background: rgba(22, 101, 52, 0.18);
            }
            .user-context-action-btn--payment_read .user-context-action-btn__icon {
                background: rgba(74, 222, 128, 0.16);
                color: #bbf7d0;
            }
            .user-context-action-btn__text {
                display: flex;
                flex-direction: column;
                gap: 2px;
                min-width: 0;
            }
            .user-context-action-btn__title {
                color: rgba(255, 255, 255, 0.92);
                font-size: 12px;
                font-weight: 600;
                line-height: 1.4;
            }
            .user-context-action-btn__hint {
                color: rgba(255, 255, 255, 0.56);
                font-size: 11px;
                line-height: 1.5;
                word-break: break-word;
            }
            .user-context-section {
                padding: 12px;
                border-radius: 14px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.09);
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-width: 0;
            }
            .user-context-section__title {
                color: rgba(255, 255, 255, 0.82);
                font-size: 12px;
                font-weight: 600;
            }
            .user-context-section__empty {
                color: rgba(255, 255, 255, 0.42);
                font-size: 12px;
                line-height: 1.6;
            }
            .user-context-item {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 0;
            }
            .user-context-item__main {
                color: rgba(255, 255, 255, 0.92);
                font-size: 13px;
                line-height: 1.5;
                word-break: break-word;
            }
            .user-context-item__sub {
                color: rgba(255, 255, 255, 0.56);
                font-size: 12px;
                line-height: 1.6;
                word-break: break-word;
            }
            .user-context-section--timeline {
                grid-column: 1 / -1;
            }
            .user-context-timeline {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .user-context-timeline-item {
                display: grid;
                grid-template-columns: auto 1fr auto;
                gap: 10px;
                align-items: start;
                min-width: 0;
                padding: 10px 12px;
                border-radius: 14px;
                background: rgba(255, 255, 255, 0.012);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .user-context-timeline-item--actionable {
                appearance: none;
                width: 100%;
                text-align: left;
                font: inherit;
                cursor: pointer;
                transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
            }
            .user-context-timeline-item--actionable:hover {
                transform: translateY(-1px);
                border-color: rgba(255, 255, 255, 0.24);
                background: rgba(255, 255, 255, 0.08);
                box-shadow: 0 12px 24px rgba(0, 0, 0, 0.18);
            }
            .user-context-timeline-item--actionable:focus-visible {
                outline: 2px solid rgba(107, 158, 206, 0.52);
                outline-offset: 2px;
            }
            .user-context-timeline-item--recent {
                border-color: rgba(74, 222, 128, 0.22);
                background: rgba(74, 222, 128, 0.08);
                box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.08);
            }
            .user-context-timeline-item__badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 42px;
                padding: 4px 8px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.86);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.02em;
            }
            .user-context-timeline-item--order .user-context-timeline-item__badge {
                background: rgba(255, 255, 255, 0.1);
            }
            .user-context-timeline-item--payment .user-context-timeline-item__badge {
                background: rgba(244, 195, 99, 0.18);
                color: #fff1cc;
            }
            .user-context-timeline-item--verify .user-context-timeline-item__badge {
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.86);
            }
            .user-context-timeline-item--ticket .user-context-timeline-item__badge {
                background: rgba(74, 222, 128, 0.16);
                color: #dcfce7;
            }
            .user-context-timeline-item__body {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 0;
            }
            .user-context-timeline-item__main {
                color: rgba(255, 255, 255, 0.92);
                font-size: 13px;
                line-height: 1.5;
                word-break: break-word;
            }
            .user-context-timeline-item__sub {
                color: rgba(255, 255, 255, 0.56);
                font-size: 12px;
                line-height: 1.6;
                word-break: break-word;
            }
            .user-context-timeline-item__jump {
                color: rgba(255, 255, 255, 0.42);
                align-self: center;
                font-size: 12px;
            }
            
            .session-loading {
                padding: 20px;
                text-align: center;
                color: rgba(255, 255, 255, 0.5);
            }
            
            /* Right Chat Area */
            .admin-chat-area {
                position: relative;
                flex: 1;
                display: flex;
                flex-direction: column;
                min-width: 0;
                min-height: 0;
                background: rgba(8, 10, 16, 0.98);
            }
            
            .admin-chat-header {
                display: flex;
                align-items: flex-start;
                gap: 14px;
                padding: 15px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(8, 10, 16, 0.98);
                background-image: none;
            }
            .chat-user-info {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
            }
            .chat-user-name {
                color: white;
                font-weight: 600;
                font-size: 15px;
            }
            .chat-user-id {
                color: rgba(255, 255, 255, 0.5);
                font-size: 12px;
                margin-left: 8px;
            }
            .chat-admin-readonly-notice {
                margin: 12px 20px 0;
                padding: 10px 12px;
                border-radius: 12px;
                background: rgba(107, 158, 206, 0.12);
                border: 1px solid rgba(107, 158, 206, 0.2);
                color: rgba(217, 232, 244, 0.92);
                font-size: 12px;
                line-height: 1.5;
            }
            .admin-chat-header-actions {
                display: none;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                flex-wrap: wrap;
                margin-left: auto;
                min-width: 0;
            }
            .admin-chat-header-actions[hidden] {
                display: none !important;
            }
            .admin-chat-header-actions:not([hidden]) {
                display: flex;
            }
            .admin-chat-header-actions .chat-user-context-inline-trigger,
            .admin-chat-header-actions .chat-reply-templates__toggle,
            .admin-chat-header-actions .ops-alert-toolbar-trigger {
                display: inline-flex;
                width: auto;
                flex: 0 0 auto;
                min-height: 34px;
                white-space: nowrap;
            }
            .admin-chat-header-actions .chat-reply-templates__toggle {
                align-items: center;
                justify-content: flex-start;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 999px;
                border-color: rgba(107, 158, 206, 0.22);
                background: rgba(107, 158, 206, 0.14);
                color: rgba(217, 232, 244, 0.92);
                font-size: 11px;
                font-weight: 400;
                line-height: 1.2;
            }
            .admin-chat-header-actions .chat-reply-templates__toggle:hover {
                background: rgba(107, 158, 206, 0.2);
                border-color: rgba(107, 158, 206, 0.32);
                color: #ffffff;
            }
            .admin-chat-header-actions .chat-reply-templates__toggle.is-active {
                background: rgba(107, 158, 206, 0.24);
                border-color: rgba(107, 158, 206, 0.38);
            }
            .admin-chat-header-actions .chat-reply-templates__toggle-copy {
                flex-shrink: 0;
                gap: 6px;
            }
            .admin-chat-header-actions .chat-reply-templates__toggle-label {
                font-size: 11px;
                font-weight: 400;
                line-height: 1.2;
            }
            .admin-chat-header-actions .chat-reply-templates__toggle-count {
                min-width: 18px;
                height: 18px;
                padding: 0 5px;
                font-size: 10px;
            }
            .admin-chat-header-actions .chat-reply-templates__toggle-text {
                display: none;
            }
            
            .admin-mode-layout .chat-messages {
                position: relative;
                z-index: 1;
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 20px;
                background: rgba(8, 10, 16, 0.98) !important;
                background-image: none !important;
                box-shadow: none !important;
                scroll-behavior: auto !important; /* Force instant scrolling */
                overscroll-behavior-y: contain; /* Prevent scroll chaining */
            }

            .admin-chat-area.has-user-context .chat-messages {
                padding-top: calc(20px + var(--chat-admin-context-height, 148px));
            }

            .admin-chat-area.has-reply-templates .chat-messages {
                padding-top: calc(20px + var(--chat-admin-reply-height, 148px));
            }
            
            .empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: rgba(255, 255, 255, 0.4);
            }
            .empty-state i {
                font-size: 48px;
                margin-bottom: 15px;
                opacity: 0.5;
            }
            .empty-state p {
                margin: 0;
                font-size: 14px;
            }
            
            /* Limit image size in chat */
            .message-image {
                max-width: 200px;
                max-height: 200px;
                border-radius: 12px;
                cursor: pointer;
                object-fit: cover;
            }
            
            /* Overlay for clicking outside to close */
            .chat-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(7, 9, 12, 0);
                z-index: 9998;
                backdrop-filter: blur(0) saturate(100%);
                -webkit-backdrop-filter: blur(0) saturate(100%);
                transform: translateZ(0);
                -webkit-transform: translateZ(0);
                will-change: opacity, backdrop-filter;
                opacity: 0;
                transition:
                    opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
                    background-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
                    backdrop-filter 260ms cubic-bezier(0.22, 1, 0.36, 1),
                    -webkit-backdrop-filter 260ms cubic-bezier(0.22, 1, 0.36, 1);
            }
            .chat-overlay.visible {
                display: block;
            }
            .chat-overlay.visible.chat-overlay--active {
                background: var(--chat-overlay-bg, var(--app-modal-backdrop, rgba(34, 41, 52, 0.48)));
                backdrop-filter: var(--chat-overlay-filter, var(--app-modal-backdrop-filter, blur(6px) saturate(106%)));
                -webkit-backdrop-filter: var(--chat-overlay-filter, var(--app-modal-backdrop-filter, blur(6px) saturate(106%)));
                opacity: 1;
            }
            
            /* Shake hint animation for input */
            .shake-hint {
                animation: shake-input 0.4s ease;
                border-color: #ff6b6b !important;
                background: rgba(255, 107, 107, 0.1) !important;
            }
            
            @keyframes shake-input {
                0%, 100% { transform: translateX(0); }
                20% { transform: translateX(-8px); }
                40% { transform: translateX(8px); }
                60% { transform: translateX(-4px); }
                80% { transform: translateX(4px); }
            }
            
            /* Message time stamp */
            .message-time {
                display: block;
                font-size: 10px;
                color: rgba(255, 255, 255, 0.4);
                margin-top: 4px;
                text-align: right;
            }
            .message.user .message-time {
                color: rgba(255, 255, 255, 0.6);
            }
            .message-text {
                display: block;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .message--ops-alert {
                max-width: min(540px, 92%);
                width: min(540px, 92%);
                box-sizing: border-box;
                padding: 14px 16px;
                border-radius: 18px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(255, 255, 255, 0.08);
                box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
            }
            .message--ops-alert-warning {
                border-color: rgba(244, 195, 99, 0.28);
                background: linear-gradient(180deg, rgba(244, 195, 99, 0.12), rgba(255, 255, 255, 0.06));
            }
            .message--ops-alert-critical {
                border-color: rgba(255, 107, 107, 0.3);
                background: linear-gradient(180deg, rgba(255, 107, 107, 0.12), rgba(255, 255, 255, 0.06));
            }
            .message--ops-alert-info {
                border-color: rgba(107, 158, 206, 0.3);
                background: linear-gradient(180deg, rgba(107, 158, 206, 0.14), rgba(255, 255, 255, 0.06));
            }
            .ops-alert-card-header {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .ops-alert-card-title-wrap {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }
            .ops-alert-card-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 44px;
                padding: 4px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.02em;
            }
            .ops-alert-card-badge--info {
                color: #d9e8f4;
                background: rgba(107, 158, 206, 0.22);
            }
            .ops-alert-card-badge--warning {
                color: #fff1cc;
                background: rgba(244, 195, 99, 0.24);
            }
            .ops-alert-card-badge--critical {
                color: #ffd9d9;
                background: rgba(255, 107, 107, 0.22);
            }
            .ops-alert-card-status {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 56px;
                padding: 4px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.02em;
                border: 1px solid transparent;
            }
            .ops-alert-card-status--open {
                color: #ffe3a6;
                background: rgba(244, 195, 99, 0.18);
                border-color: rgba(244, 195, 99, 0.26);
            }
            .ops-alert-card-status--claimed {
                color: #d9e8f4;
                background: rgba(107, 158, 206, 0.18);
                border-color: rgba(107, 158, 206, 0.28);
            }
            .ops-alert-card-status--resolved {
                color: #c8f8dc;
                background: rgba(54, 179, 126, 0.18);
                border-color: rgba(54, 179, 126, 0.28);
            }
            .ops-alert-card-status--muted {
                color: #e2e8f0;
                background: rgba(148, 163, 184, 0.16);
                border-color: rgba(148, 163, 184, 0.26);
            }
            .ops-alert-card-title {
                color: #fff;
                font-size: 14px;
                font-weight: 600;
                line-height: 1.5;
            }
            .ops-alert-card-meta {
                color: rgba(255, 255, 255, 0.56);
                font-size: 11px;
                line-height: 1.5;
            }
            .ops-alert-card-content {
                margin-top: 12px;
                color: rgba(255, 255, 255, 0.88);
                font-size: 13px;
                line-height: 1.65;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .ops-alert-card-case-summary {
                margin-top: 12px;
                padding: 10px 12px;
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.06);
                color: rgba(255, 255, 255, 0.74);
                font-size: 12px;
                line-height: 1.6;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .ops-alert-card-history {
                margin-top: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .ops-alert-card-history-item {
                position: relative;
                padding-left: 14px;
                color: rgba(255, 255, 255, 0.62);
                font-size: 12px;
                line-height: 1.6;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .ops-alert-card-history-item::before {
                content: '';
                position: absolute;
                left: 0;
                top: 0.65em;
                width: 6px;
                height: 6px;
                border-radius: 999px;
                background: rgba(107, 158, 206, 0.9);
                box-shadow: 0 0 0 4px rgba(107, 158, 206, 0.12);
            }
            .ops-alert-card-error {
                margin-top: 12px;
                padding: 10px 12px;
                border-radius: 12px;
                background: rgba(255, 107, 107, 0.12);
                color: #ffd6d6;
                font-size: 12px;
                line-height: 1.5;
            }
            .ops-alert-card-footer {
                margin-top: 14px;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .ops-alert-toolbar {
                width: fit-content;
                max-width: calc(100% - 56px);
                margin: 0 auto 18px;
                display: flex;
                flex-wrap: nowrap;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 10px 12px;
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(0, 0, 0, 0.56);
                box-sizing: border-box;
                position: sticky;
                top: 4px;
                z-index: 8;
                overflow: visible;
                box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(22px) saturate(118%);
                -webkit-backdrop-filter: blur(22px) saturate(118%);
            }
            .ops-alert-toolbar--panel {
                width: 100%;
                max-width: none;
                margin: 0;
                padding: 14px;
                border-radius: 20px;
                position: static;
                top: auto;
                display: flex;
                flex-direction: column;
                align-items: stretch;
                justify-content: flex-start;
                gap: 12px;
                overflow: visible;
            }
            .ops-alert-toolbar__panel-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
            }
            .ops-alert-toolbar__panel-copy {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 0;
            }
            .ops-alert-toolbar__panel-eyebrow {
                color: rgba(226, 232, 240, 0.58);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.04em;
            }
            .ops-alert-toolbar__panel-title {
                color: #f8fafc;
                font-size: 14px;
                font-weight: 700;
                line-height: 1.35;
            }
            .ops-alert-toolbar__panel-count {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 34px;
                height: 34px;
                padding: 0 10px;
                border-radius: 999px;
                background: rgba(107, 158, 206, 0.16);
                border: 1px solid rgba(107, 158, 206, 0.24);
                color: #d9e8f4;
                font-size: 12px;
                font-weight: 700;
                line-height: 1;
            }
            .ops-alert-toolbar__panel-summary {
                color: rgba(226, 232, 240, 0.66);
                font-size: 12px;
                line-height: 1.6;
            }
            .ops-alert-toolbar__panel-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
            }
            .ops-alert-toolbar__panel-grid .ops-alert-toolbar-filter--scope,
            .ops-alert-toolbar__panel-grid .ops-alert-toolbar-filter--owner {
                grid-column: 1 / -1;
            }
            .ops-alert-toolbar--panel .ops-alert-toolbar-filter {
                width: 100%;
                min-height: 0;
                padding: 12px;
                border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(255, 255, 255, 0.04);
                display: flex;
                flex-direction: column;
                align-items: stretch;
                justify-content: flex-start;
                gap: 8px;
            }
            .ops-alert-toolbar--panel .ops-alert-toolbar-copy {
                color: rgba(226, 232, 240, 0.54);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.02em;
            }
            .ops-alert-toolbar--panel .ops-alert-toolbar-dropdown,
            .ops-alert-toolbar--panel .ops-alert-toolbar-dropdown--compact {
                width: 100%;
                min-width: 0;
            }
            .ops-alert-toolbar__panel-actions {
                width: 100%;
                justify-content: stretch;
                flex-wrap: wrap;
            }
            .ops-alert-toolbar__panel-actions .ops-alert-toolbar-btn {
                flex: 1 1 140px;
                min-height: 40px;
            }
            .ops-alert-toolbar-copy {
                color: rgba(226, 232, 240, 0.64);
                font-size: 12px;
                font-weight: 600;
                flex: 0 0 auto;
            }
            .ops-alert-toolbar-filter {
                display: inline-flex;
                align-items: center;
                justify-content: flex-start;
                gap: 0;
                flex: 0 0 auto;
                min-width: 0;
                min-height: 34px;
                padding: 0;
                border-radius: 999px;
                background: transparent;
                border: 0;
            }
            .ops-alert-toolbar-filter--scope {
                justify-content: flex-start;
            }
            .ops-alert-toolbar-read {
                display: inline-flex;
                align-items: center;
                flex-wrap: nowrap;
                gap: 8px;
                flex: 0 0 auto;
                min-width: 0;
                min-height: 34px;
                padding: 0;
                border-radius: 0;
                background: transparent;
                border: 0;
            }
            .ops-alert-toolbar-read .ops-alert-toolbar-filter {
                min-width: 0;
                min-height: 0;
                padding: 0;
                border: 0;
                background: transparent;
                justify-content: flex-start;
            }
            .ops-alert-toolbar-read .ops-alert-toolbar-copy:empty {
                display: none;
            }
            .ops-alert-toolbar-actions {
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                flex: 0 0 auto;
                min-width: 0;
            }
            .ops-alert-toolbar-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(0, 0, 0, 0.18);
                color: #e2e8f0;
                font-size: 12px;
                font-weight: 700;
                border-radius: 999px;
                min-height: 34px;
                padding: 6px 11px;
                cursor: pointer;
                transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
            }
            .ops-alert-toolbar-btn.is-active {
                border-color: rgba(255, 255, 255, 0.22);
                background: rgba(255, 255, 255, 0.1);
                color: #d9e8f4;
            }
            .ops-alert-toolbar-btn--read {
                border-color: rgba(74, 222, 128, 0.24);
                background: rgba(22, 101, 52, 0.18);
                color: #bbf7d0;
            }
            .ops-alert-toolbar-btn--read-standalone {
                min-width: 58px;
            }
            .ops-alert-toolbar-btn:hover {
                transform: translateY(-1px);
            }
            .ops-alert-toolbar-btn:disabled {
                cursor: not-allowed;
                opacity: 0.48;
                transform: none;
            }
            .ops-alert-toolbar-select {
                min-width: 132px;
                max-width: 100%;
                box-sizing: border-box;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(0, 0, 0, 0.18);
                color: #e2e8f0;
                font-size: 12px;
                font-weight: 600;
                border-radius: 999px;
                padding: 6px 28px 6px 12px;
                outline: none;
                cursor: pointer;
            }
            .ops-alert-toolbar-select--compact {
                min-width: 118px;
                flex: 1 1 118px;
            }
            .ops-alert-toolbar-filter--scope .ops-alert-toolbar-select {
                min-width: 148px;
            }
            .ops-alert-toolbar-dropdown {
                position: relative;
                width: 100%;
                min-width: 0;
                max-width: 100%;
            }
            .ops-alert-toolbar-dropdown--compact {
                flex: 0 0 108px;
                width: 108px;
            }
            .ops-alert-toolbar-filter--scope .ops-alert-toolbar-dropdown {
                width: 112px;
            }
            .ops-alert-toolbar-filter--owner .ops-alert-toolbar-dropdown {
                width: 118px;
            }
            .ops-alert-toolbar-dropdown-trigger {
                width: 100%;
                min-height: 34px;
                display: inline-flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(0, 0, 0, 0.18);
                color: #e2e8f0;
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.01em;
                border-radius: 999px;
                padding: 6px 12px 6px 14px;
                outline: none;
                cursor: pointer;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
                transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
            }
            .ops-alert-toolbar-dropdown-trigger:hover,
            .ops-alert-toolbar-dropdown.is-open .ops-alert-toolbar-dropdown-trigger {
                border-color: rgba(255, 255, 255, 0.24);
                background: rgba(255, 255, 255, 0.08);
                box-shadow: none;
            }
            .ops-alert-toolbar-dropdown-value {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .ops-alert-toolbar-dropdown-icon {
                flex: 0 0 auto;
                color: #94a3b8;
                font-size: 11px;
                transition: transform 0.2s ease, color 0.2s ease;
            }
            .ops-alert-toolbar-dropdown.is-open .ops-alert-toolbar-dropdown-icon {
                color: #d9e8f4;
                transform: rotate(180deg);
            }
            .ops-alert-toolbar-dropdown-menu {
                position: absolute;
                top: calc(100% + 8px);
                left: 0;
                z-index: 30;
                min-width: 100%;
                width: max-content;
                max-width: min(320px, calc(100vw - 48px));
                max-height: 280px;
                overflow: auto;
                display: grid;
                gap: 4px;
                padding: 7px;
                border: 1px solid rgba(148, 163, 184, 0.22);
                border-radius: 16px;
                background: rgba(15, 23, 42, 0.96);
                box-shadow: 0 22px 50px rgba(2, 6, 23, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(18px) saturate(145%);
                -webkit-backdrop-filter: blur(18px) saturate(145%);
                opacity: 0;
                pointer-events: none;
                transform: translateY(-6px) scale(0.98);
                transform-origin: top left;
                transition: opacity 0.16s ease, transform 0.16s ease;
            }
            .ops-alert-toolbar-dropdown.is-open .ops-alert-toolbar-dropdown-menu {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0) scale(1);
            }
            .ops-alert-toolbar-dropdown-option {
                width: 100%;
                min-width: 132px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                border: 0;
                border-radius: 12px;
                background: transparent;
                color: #cbd5e1;
                font-size: 12px;
                font-weight: 700;
                line-height: 1.35;
                text-align: left;
                white-space: nowrap;
                padding: 9px 10px;
                cursor: pointer;
                transition: background 0.16s ease, color 0.16s ease, transform 0.16s ease;
            }
            .ops-alert-toolbar-dropdown-option:hover,
            .ops-alert-toolbar-dropdown-option:focus-visible {
                background: rgba(255, 255, 255, 0.08);
                color: #d9e8f4;
                outline: none;
            }
            .ops-alert-toolbar-dropdown-option.is-selected {
                background: rgba(255, 255, 255, 0.1);
                color: #d9e8f4;
            }
            .ops-alert-toolbar-dropdown-option:disabled {
                cursor: not-allowed;
                color: rgba(148, 163, 184, 0.48);
                background: transparent;
            }
            .ops-alert-toolbar-dropdown-check {
                opacity: 0;
                color: #6b9ece;
                font-size: 11px;
            }
            .ops-alert-toolbar-dropdown-option.is-selected .ops-alert-toolbar-dropdown-check {
                opacity: 1;
            }
            .message--ops-alert-read {
                opacity: 0.72;
            }
            @media (max-width: 1180px) {
                .ops-alert-toolbar {
                    max-width: calc(100% - 40px);
                    justify-content: flex-start;
                }
                .ops-alert-toolbar-filter--owner {
                    order: 3;
                }
                .ops-alert-toolbar-actions {
                    order: 4;
                    justify-content: flex-end;
                }
            }
            @media (max-width: 980px) {
                .ops-alert-toolbar {
                    width: calc(100% - 32px);
                    max-width: calc(100% - 32px);
                }
                .ops-alert-toolbar-filter,
                .ops-alert-toolbar-read,
                .ops-alert-toolbar-actions {
                    width: auto;
                    min-width: 0;
                    flex-wrap: nowrap;
                    justify-content: flex-start;
                }
                .ops-alert-toolbar-filter--scope .ops-alert-toolbar-dropdown,
                .ops-alert-toolbar-filter--owner .ops-alert-toolbar-dropdown,
                .ops-alert-toolbar-dropdown--compact {
                    flex-basis: auto;
                }
                .ops-alert-toolbar-btn--read-standalone,
                .ops-alert-toolbar-btn--accent {
                    width: auto;
                }
            }
            .ops-alert-card-entry {
                flex: 1;
                min-width: 180px;
                color: rgba(255, 255, 255, 0.62);
                font-size: 12px;
                line-height: 1.5;
            }
            .ops-alert-card-actions {
                display: flex;
                flex-wrap: wrap;
                justify-content: flex-end;
                gap: 8px;
            }
            .ops-alert-card-action {
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(255, 255, 255, 0.08);
                color: rgba(255, 255, 255, 0.88);
                font-size: 12px;
                font-weight: 600;
                border-radius: 999px;
                padding: 8px 14px;
                cursor: pointer;
                transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease;
            }
            .ops-alert-card-action--primary {
                border-color: rgba(107, 158, 206, 0.32);
                background: rgba(107, 158, 206, 0.18);
                color: #d9e8f4;
            }
            .ops-alert-card-action--danger {
                border-color: rgba(255, 107, 107, 0.28);
                background: rgba(255, 107, 107, 0.14);
                color: #ffd6d6;
            }
            .ops-alert-card-action--ghost {
                border-color: rgba(54, 179, 126, 0.28);
                background: rgba(54, 179, 126, 0.12);
                color: #d8ffe8;
            }
            .ops-alert-card-action:hover:not(:disabled) {
                transform: translateY(-1px);
                border-color: rgba(107, 158, 206, 0.4);
            }
            .ops-alert-card-action:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }

            /* Back button - hidden on desktop, visible on mobile */
            .back-to-list-btn {
                display: none;
                background: none;
                border: none;
                color: white;
                font-size: 18px;
                padding: 8px 12px;
                cursor: pointer;
                margin-right: 8px;
                border-radius: 8px;
                transition: background 0.2s;
            }
            .back-to-list-btn:hover {
                background: rgba(255, 255, 255, 0.1);
            }

            /* Admin Mode Light Theme */
            html[data-theme="light"] .chat-window.admin-mode-layout {
                --chat-admin-light-bg: rgba(255, 255, 255, 0.98);
                --chat-admin-light-panel: rgba(248, 250, 252, 0.98);
                --chat-admin-light-sidebar: rgba(241, 245, 249, 0.98);
                --chat-admin-light-soft: rgba(248, 250, 252, 0.98);
                --chat-admin-light-card: rgba(255, 255, 255, 0.72);
                --chat-admin-light-border: rgba(15, 23, 42, 0.1);
                --chat-admin-light-border-soft: rgba(148, 163, 184, 0.18);
                --chat-admin-light-text: #0f172a;
                --chat-admin-light-text-strong: #1e293b;
                --chat-admin-light-muted: #64748b;
                --chat-admin-light-faint: #94a3b8;
                --chat-admin-light-accent: #6b9ece;
                --chat-admin-light-accent-soft: rgba(107, 158, 206, 0.1);
                --chat-admin-light-accent-softer: rgba(107, 158, 206, 0.06);
                --chat-admin-light-warning-bg: rgba(245, 158, 11, 0.14);
                --chat-admin-light-warning-text: #92400e;
                --chat-admin-light-danger-bg: rgba(239, 68, 68, 0.1);
                --chat-admin-light-danger-text: #b91c1c;
                --chat-admin-light-success-bg: rgba(34, 197, 94, 0.12);
                --chat-admin-light-success-text: #166534;
                background: var(--chat-admin-light-bg) !important;
                background-image: none !important;
                border: 1px solid var(--chat-admin-light-border) !important;
                box-shadow: 0 22px 56px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.42) !important;
                color: var(--chat-admin-light-text);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar {
                background: var(--chat-admin-light-sidebar);
                border-right: 1px solid var(--chat-admin-light-border);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-header,
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-chat-header,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-input-area {
                background: var(--chat-admin-light-panel);
                border-color: var(--chat-admin-light-border);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-chat-area,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-messages {
                background: var(--chat-admin-light-soft) !important;
                background-image: none !important;
                box-shadow: none !important;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-header h3,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-name,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-name,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-card__value,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-card__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__summary,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__list-title,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-template-btn__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-pill__value,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline__item-value,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-recent-action__value,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-section__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-item__main,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__main,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-title,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-content {
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-insights__eyebrow,
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-insights__toggle-text,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-preview,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-time,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-email,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-id,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-status-indicator .status-text,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-status-chip__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-template-btn__hint,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__eyebrow,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__summary,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-pill__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline__item-label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-recent-action__time,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn__hint,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-section__empty,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-item__sub,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__sub,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__jump,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-meta,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-entry,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-history-item,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-copy,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-loading {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-time--online,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-item.unread .session-time--online {
                color: #16a34a;
                font-weight: 700;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-insights,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-card,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-context-panel__state,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-pill,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-section,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-template-btn,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-recent-action,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn,
            html[data-theme="light"] .chat-window.admin-mode-layout .message--ops-alert,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-case-summary {
                background: var(--chat-admin-light-card);
                border-color: var(--chat-admin-light-border-soft);
                box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-insights {
                background: rgba(255, 255, 255, 0.38);
                border-color: rgba(148, 163, 184, 0.16);
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.48);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-insights__header {
                background: rgba(255, 255, 255, 0.16);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-card,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion {
                background: rgba(255, 255, 255, 0.54);
                border-color: rgba(148, 163, 184, 0.16);
                box-shadow: none;
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-card:hover {
                background: rgba(255, 255, 255, 0.64);
                border-color: rgba(148, 163, 184, 0.18);
                transform: none;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar {
                background: rgba(255, 255, 255, 0.78);
                border-color: rgba(255, 255, 255, 0.42);
                box-shadow: 0 18px 38px rgba(148, 163, 184, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.72), inset 0 -1px 0 rgba(255, 255, 255, 0.26);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar--panel .ops-alert-toolbar-filter {
                background: rgba(248, 250, 252, 0.82);
                border-color: rgba(148, 163, 184, 0.16);
                box-shadow: none;
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar__panel-title {
                color: var(--chat-admin-light-text-strong);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar__panel-eyebrow,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar__panel-summary {
                color: var(--chat-admin-light-muted);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar__panel-count {
                background: var(--chat-admin-light-accent-soft);
                border-color: rgba(107, 158, 206, 0.18);
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-filter {
                background: transparent;
                border: 0;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-read,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-read .ops-alert-toolbar-filter {
                background: transparent;
                border: 0;
                box-shadow: none;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar-insights__summary,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-card__hint,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__mode,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__meta,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__hint,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__eyebrow,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__desc,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__hint,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__list-detail,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-case-summary {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-search input,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-input {
                background: #ffffff;
                border-color: var(--chat-admin-light-border-soft);
                color: var(--chat-admin-light-text);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-search input::placeholder,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-input::placeholder {
                color: var(--chat-admin-light-faint);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .admin-search input:focus,
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-search input:focus-visible,
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-search input:-webkit-autofill:focus,
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-search input:-webkit-autofill:focus-visible,
            html[data-theme="light"] .admin-mode-layout .chat-input:focus,
            html[data-theme="light"] .admin-mode-layout .chat-input:focus-visible,
            html[data-theme="light"] .admin-mode-layout .chat-input:-webkit-autofill:focus,
            html[data-theme="light"] .admin-mode-layout .chat-input:-webkit-autofill:focus-visible {
                background: #ffffff !important;
                border-color: var(--chat-admin-light-accent) !important;
                box-shadow: 0 0 0 3px var(--chat-admin-light-accent-soft) !important;
                caret-color: var(--chat-admin-light-accent) !important;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item {
                border-bottom-color: rgba(15, 23, 42, 0.06);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item:hover {
                background: #f1f5f9;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item.active {
                background: var(--chat-admin-light-accent-soft);
                border-left-color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item--ops {
                background: var(--chat-admin-light-accent-softer);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item--ops:hover {
                background: var(--chat-admin-light-accent-soft);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item--ops .session-name,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-item--ops .session-preview,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-item--ops .session-email {
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item.unread {
                background: var(--chat-admin-light-danger-bg);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item.unread .session-name {
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-item.unread .session-preview {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-badge,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-item--ops .session-badge,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__badge,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-badge--info,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-status--claimed {
                background: rgba(107, 158, 206, 0.12);
                color: #5f8fbc;
                border-color: rgba(107, 158, 206, 0.18);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-badge--ticket,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-badge--warning,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__capacity-badge--warning,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-badge--warning,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-status--open {
                background: var(--chat-admin-light-warning-bg);
                color: var(--chat-admin-light-warning-text);
                border-color: rgba(245, 158, 11, 0.2);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-badge--danger,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__capacity-badge--danger,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-badge--critical,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-error {
                background: var(--chat-admin-light-danger-bg);
                color: var(--chat-admin-light-danger-text);
                border-color: rgba(239, 68, 68, 0.18);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-status--resolved,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-action--ghost,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn--recent,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item--recent {
                background: var(--chat-admin-light-success-bg);
                color: var(--chat-admin-light-success-text);
                border-color: rgba(34, 197, 94, 0.2);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion--danger,
            html[data-theme="light"] .chat-window.admin-mode-layout .message--ops-alert-critical {
                background: rgba(254, 242, 242, 0.9);
                border-color: rgba(239, 68, 68, 0.18);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion--warning,
            html[data-theme="light"] .chat-window.admin-mode-layout .message--ops-alert-warning {
                background: rgba(255, 251, 235, 0.92);
                border-color: rgba(245, 158, 11, 0.2);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion--calm,
            html[data-theme="light"] .chat-window.admin-mode-layout .message--ops-alert-info {
                background: rgba(235, 243, 250, 0.92);
                border-color: rgba(107, 158, 206, 0.18);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__index,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn__icon {
                background: var(--chat-admin-light-accent-soft);
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-context-panel__state {
                background: rgba(255, 255, 255, 0.78);
                background-image: none;
                border-color: rgba(255, 255, 255, 0.42);
                box-shadow: 0 18px 38px rgba(148, 163, 184, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.72), inset 0 -1px 0 rgba(255, 255, 255, 0.26);
                backdrop-filter: blur(14px) saturate(165%);
                -webkit-backdrop-filter: blur(14px) saturate(165%);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates::before,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell::before {
                background: none;
                opacity: 0;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates__toggle,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-context-inline-trigger,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-trigger {
                border-color: rgba(148, 163, 184, 0.22);
                background: rgba(255, 255, 255, 0.9);
                color: var(--chat-admin-light-text);
                box-shadow: none;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates__toggle-count {
                background: var(--chat-admin-light-accent-soft);
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-trigger__count {
                background: var(--chat-admin-light-accent-soft);
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates__toggle-text,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-context-inline-trigger i,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-trigger i {
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates__toggle:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-context-inline-trigger:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-context-inline-trigger.is-active,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-trigger:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-trigger.is-active {
                background: rgba(239, 246, 255, 0.92);
                border-color: rgba(107, 158, 206, 0.24);
                color: var(--chat-admin-light-text-strong);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-status-chip--success {
                background: rgba(220, 252, 231, 0.78);
                border-color: rgba(34, 197, 94, 0.2);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-status-chip--success .chat-user-status-chip__label {
                color: #4b5563;
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-status-chip--success .chat-user-status-chip__value {
                color: var(--chat-admin-light-success-text);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-status-chip--warning {
                background: rgba(255, 248, 235, 0.94);
                border-color: rgba(245, 158, 11, 0.22);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-status-chip--warning .chat-user-status-chip__label {
                color: #7c5a11;
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-user-status-chip--warning .chat-user-status-chip__value {
                color: var(--chat-admin-light-warning-text);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout .admin-chat-header-actions .chat-reply-templates__toggle.is-active {
                background: rgba(239, 246, 255, 0.92);
                border-color: rgba(107, 158, 206, 0.24);
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-context-panel__state {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-context-panel--error .chat-context-panel__state {
                color: var(--chat-admin-light-danger-text);
                background: rgba(254, 242, 242, 0.82);
                border-color: rgba(248, 113, 113, 0.28);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-template-btn,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-pill,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-section,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-recent-action,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn {
                background: rgba(255, 255, 255, 0.56);
                border-color: rgba(148, 163, 184, 0.2);
                color: var(--chat-admin-light-text-strong);
                box-shadow: none;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-template-btn:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-recent-action:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item--actionable:hover {
                background: rgba(255, 255, 255, 0.68);
                border-color: rgba(107, 158, 206, 0.22);
                color: var(--chat-admin-light-text-strong);
                box-shadow: 0 10px 20px rgba(148, 163, 184, 0.12);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-template-btn__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-pill__value,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline__item-value,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-recent-action__value,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-section__title,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-item__main,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__main {
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-templates__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .chat-reply-template-btn__hint,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__eyebrow,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__summary,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-pill__label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline__item-label,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-recent-action__time,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn__hint,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-section__empty,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-item__sub,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__sub,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__jump {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-headline__item,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-timeline-item__badge {
                background: rgba(241, 245, 249, 0.84);
                border-color: rgba(148, 163, 184, 0.18);
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn__icon {
                background: rgba(107, 158, 206, 0.12);
                border-color: rgba(107, 158, 206, 0.18);
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn--payment_read {
                background: rgba(220, 252, 231, 0.54);
                border-color: rgba(34, 197, 94, 0.22);
                color: var(--chat-admin-light-success-text);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-action-btn--payment_read .user-context-action-btn__icon {
                background: rgba(34, 197, 94, 0.14);
                color: var(--chat-admin-light-success-text);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__action,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-suggestion__action,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-preset,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-filter-btn,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-btn,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-select,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-trigger,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-action {
                background: rgba(255, 255, 255, 0.56);
                border-color: rgba(148, 163, 184, 0.2);
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-btn,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-trigger {
                background: rgba(255, 255, 255, 0.56);
                border-color: rgba(148, 163, 184, 0.2);
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-btn--read {
                background: rgba(220, 252, 231, 0.78);
                border-color: rgba(34, 197, 94, 0.22);
                color: var(--chat-admin-light-success-text);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-snapshot__action--ghost,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-status--muted {
                color: var(--chat-admin-light-muted);
                background: rgba(241, 245, 249, 0.86);
                border-color: var(--chat-admin-light-border-soft);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-preset:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-filter-btn:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-btn:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-trigger:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown.is-open .ops-alert-toolbar-dropdown-trigger,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-action:hover:not(:disabled) {
                background: rgba(255, 255, 255, 0.68);
                border-color: rgba(107, 158, 206, 0.22);
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-preset.is-active,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-filter-btn.is-active,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-btn.is-active,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-action--primary {
                background: var(--chat-admin-light-accent);
                border-color: var(--chat-admin-light-accent);
                color: #ffffff;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-card-action--danger {
                background: var(--chat-admin-light-danger-bg);
                border-color: rgba(239, 68, 68, 0.22);
                color: var(--chat-admin-light-danger-text);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-icon,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-check,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__toggle-text,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__toggle-icon {
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__toggle-text,
            html[data-theme="light"] .chat-window.admin-mode-layout .user-context-shell__toggle-icon {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-menu {
                background: #ffffff;
                border-color: var(--chat-admin-light-border-soft);
                box-shadow: 0 24px 48px rgba(15, 23, 42, 0.16);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-option {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-option:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-option:focus-visible,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-option.is-selected {
                background: var(--chat-admin-light-accent-soft);
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar-dropdown-option:disabled {
                color: var(--chat-admin-light-faint);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar .ops-alert-toolbar-btn,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar .ops-alert-toolbar-dropdown-trigger {
                background: rgba(255, 255, 255, 0.56);
                border-color: rgba(148, 163, 184, 0.2);
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar .ops-alert-toolbar-btn:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar .ops-alert-toolbar-dropdown-trigger:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar .ops-alert-toolbar-dropdown.is-open .ops-alert-toolbar-dropdown-trigger {
                background: rgba(255, 255, 255, 0.68);
                border-color: rgba(107, 158, 206, 0.22);
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .ops-alert-toolbar .ops-alert-toolbar-btn--read {
                background: rgba(220, 252, 231, 0.78);
                border-color: rgba(34, 197, 94, 0.22);
                color: var(--chat-admin-light-success-text);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-action-btn {
                background: #ffffff;
                border-color: var(--chat-admin-light-border-soft);
                color: var(--chat-admin-light-muted);
                box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout #chatEmojiBtn.chat-action-btn {
                background: transparent;
                border: none;
                box-shadow: none;
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-action-btn:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout #chatEmojiBtn.chat-action-btn:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .back-to-list-btn:hover {
                background: var(--chat-admin-light-accent-soft);
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-send-btn {
                color: var(--chat-admin-light-accent);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-close,
            html[data-theme="light"] .chat-window.admin-mode-layout .back-to-list-btn {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .chat-close:hover,
            html[data-theme="light"] .chat-window.admin-mode-layout .back-to-list-btn:hover {
                color: var(--chat-admin-light-text-strong);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .empty-state {
                color: var(--chat-admin-light-muted);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .empty-state i {
                color: var(--chat-admin-light-faint);
                opacity: 0.8;
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .message-time,
            html[data-theme="light"] .chat-window.admin-mode-layout .message.user .message-time {
                color: var(--chat-admin-light-faint);
            }

            html[data-theme="light"] .chat-window.admin-mode-layout .session-skeleton,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-skeleton__avatar,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-skeleton__line,
            html[data-theme="light"] .chat-window.admin-mode-layout .session-queue-skeleton {
                background: linear-gradient(90deg, rgba(226, 232, 240, 0.62), rgba(248, 250, 252, 0.96), rgba(226, 232, 240, 0.62));
                border-bottom-color: rgba(15, 23, 42, 0.06);
            }
            
            /* Mobile/Narrow: Slide Navigation Pattern */
            @media (max-width: 700px) {
                .chat-window.admin-mode-layout {
                    width: min(460px, max(97vw, calc(100vw - 16px))) !important;
                    max-width: 97vw;
                    height: min(640px, 84vh) !important;
                    max-height: 82vh;
                    border-radius: 20px !important;
                    overflow: hidden;
                    /* Center the modal on mobile */
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    /* scale(0.9) gives a visible animation instead of relying on opacity alone */
                    transform: translate(-50%, -50%) scale(0.9) !important;
                    /* Force opaque — rely on visibility:hidden + scale for animation, not opacity.
                       opacity transition + backdrop-filter = Chromium compositor flash bug */
                    opacity: 1 !important;
                    /* Disable backdrop-filter during animation to avoid Chromium flash bug */
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
                .chat-window.admin-mode-layout.active {
                    transform: translate(-50%, -50%) scale(1) !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
                
                /* Mobile: Side by side sliding panels */
                .admin-sidebar {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(12, 15, 22, 0.98);
                    z-index: 2;
                    transition: transform 0.3s ease-out;
                    display: flex;
                    flex-direction: column;
                }
                .admin-sidebar-insights__body {
                    max-height: min(260px, 40vh);
                }
                
                /* Chat area also full size, positioned to the right */
                .admin-chat-area {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    transform: translateX(100%);
                    transition: transform 0.3s ease-out;
                    display: flex;
                    flex-direction: column;
                    z-index: 1;
                }
                
                /* When chat is active: slide sidebar out, slide chat in */
                .admin-mode-layout.chat-active .admin-sidebar {
                    transform: translateX(-100%);
                }
                .admin-mode-layout.chat-active .admin-chat-area {
                    transform: translateX(0);
                }
                
                /* Show back button on mobile */
                .back-to-list-btn {
                    display: block;
                }
                
                /* Session list takes full available space */
                .session-list {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                }
                
                /* Chat header layout */
                .admin-chat-header {
                    display: flex;
                    align-items: center;
                }
                
                /* Messages area */
                .admin-mode-layout .chat-messages {
                    flex: 1;
                    overflow-y: auto;
                }
                .chat-reply-templates {
                    left: 12px;
                    right: 12px;
                    bottom: 68px;
                }
                .chat-context-panel {
                    left: 12px;
                    right: 12px;
                    top: var(--chat-admin-context-top, 92px);
                }
                .admin-chat-area.has-user-context .chat-messages {
                    padding-top: 132px;
                }
                .admin-chat-area.has-reply-templates .chat-messages {
                    padding-bottom: 132px;
                }
                .ops-alert-toolbar {
                    width: calc(100% - 24px);
                    justify-content: flex-start;
                }
                .ops-alert-toolbar-filter,
                .ops-alert-toolbar-read,
                .ops-alert-toolbar-dropdown {
                    flex-wrap: wrap;
                    justify-content: flex-start;
                    width: 100%;
                    min-width: 0;
                }
                .ops-alert-toolbar-dropdown,
                .ops-alert-toolbar-dropdown--compact {
                    width: 100%;
                    min-width: 0;
                }
                .ops-alert-toolbar-dropdown-menu {
                    width: 100%;
                    max-width: 100%;
                }
                .ops-alert-toolbar-filter--owner {
                    margin-left: 0;
                }
                .ops-alert-toolbar-btn--read-standalone {
                    justify-self: stretch;
                    width: 100%;
                }
                
                /* Input always at bottom */
                .admin-mode-layout .chat-input-area {
                    flex: 0 0 auto;
                    padding: 10px 12px;
                }
                html[data-theme="light"] .chat-window.admin-mode-layout .admin-sidebar {
                    background: var(--chat-admin-light-sidebar);
                }
                html[data-theme="light"] .chat-window.admin-mode-layout .admin-chat-area {
                    background: var(--chat-admin-light-soft);
                }
                html[data-theme="light"] .chat-window.admin-mode-layout .chat-input-area {
                    background: var(--chat-admin-light-panel);
                }
            }

            .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-sidebar {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                max-width: none;
                min-width: 0;
                background: rgba(12, 15, 22, 0.98);
                z-index: 2;
                transition: transform 0.3s ease-out;
                display: flex;
                flex-direction: column;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-sidebar-insights__body {
                max-height: min(260px, 40vh);
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-chat-area {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                transform: translateX(100%);
                transition: transform 0.3s ease-out;
                display: flex;
                flex-direction: column;
                z-index: 1;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow.chat-active .admin-sidebar {
                transform: translateX(-100%);
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow.chat-active .admin-chat-area {
                transform: translateX(0);
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .back-to-list-btn {
                display: block;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-close {
                display: none;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .session-list {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-chat-header {
                display: grid;
                grid-template-columns: auto minmax(0, 1fr) auto;
                grid-template-areas:
                    "back name name"
                    "back email email"
                    "back chips chips"
                    "back meta meta";
                column-gap: 12px;
                row-gap: 6px;
                align-items: center;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-info {
                display: contents;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .back-to-list-btn {
                grid-area: back;
                align-self: start;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-name {
                grid-area: name;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-id {
                grid-area: email;
                margin-left: 0;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding-right: 6px;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-meta-row {
                grid-area: meta;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: nowrap;
                min-width: 0;
                width: 100%;
                margin-top: 0;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-chat-header-actions {
                justify-self: end;
                align-self: start;
                justify-content: flex-end;
                gap: 6px;
                flex-wrap: nowrap;
                max-width: none;
                margin-top: 0;
                margin-bottom: 1px;
                margin-left: auto;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .user-status-indicator {
                justify-self: start;
                align-self: center;
                gap: 8px;
                flex-wrap: nowrap;
                margin-top: 0;
                min-width: 0;
                margin-bottom: 0;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .user-status-indicator .status-text {
                white-space: nowrap;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-context-inline-trigger {
                display: inline-flex;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-status-chips {
                grid-area: chips;
                margin-top: 0;
                gap: 6px;
                align-items: center;
                justify-self: start;
                width: 100%;
                flex-wrap: nowrap;
                overflow-x: auto;
                overflow-y: hidden;
                padding-bottom: 2px;
                scrollbar-width: none;
                -ms-overflow-style: none;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-status-chips::-webkit-scrollbar {
                display: none;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-status-chip {
                gap: 4px;
                min-height: 34px;
                padding: 4px 10px;
                max-width: none;
                flex: 0 0 auto;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-status-chip__label,
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-user-status-chip__value {
                font-size: 11px;
                line-height: 1.2;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-context-panel {
                position: absolute;
                top: var(--chat-admin-context-top, 92px);
                left: 12px;
                right: 12px;
                width: auto;
                max-width: none;
                padding: 0;
                z-index: 6;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-context-panel--ops-filter {
                width: auto;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-reply-templates {
                position: absolute;
                top: var(--chat-admin-context-top, 92px);
                left: 12px;
                right: 12px;
                bottom: auto;
                width: auto;
                max-width: none;
                margin: 0;
                padding: 12px;
                gap: 10px;
                z-index: 6;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-reply-templates > .chat-reply-templates__toggle {
                display: none;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-reply-template-btn {
                width: 100%;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .message--ops-alert {
                width: 100%;
                max-width: none;
                margin-left: auto;
                margin-right: auto;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-card-footer {
                flex-direction: column;
                align-items: stretch;
                gap: 12px;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-card-entry {
                width: 100%;
                min-width: 0;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-card-actions {
                width: 100%;
                justify-content: flex-start;
                align-items: center;
                gap: 6px;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-card-action {
                padding: 8px 12px;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-card-action--primary {
                margin-left: auto;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-chat-area.has-user-context .chat-messages {
                padding-top: calc(20px + var(--chat-admin-context-height, 148px));
                padding-bottom: 20px;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-chat-area.has-reply-templates .chat-messages {
                padding-top: calc(20px + var(--chat-admin-reply-height, 148px));
                padding-bottom: 20px;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) {
                width: calc(100% - 24px);
                justify-content: flex-start;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) .ops-alert-toolbar-filter,
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) .ops-alert-toolbar-read,
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) .ops-alert-toolbar-dropdown {
                flex-wrap: wrap;
                justify-content: flex-start;
                width: 100%;
                min-width: 0;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) .ops-alert-toolbar-dropdown,
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) .ops-alert-toolbar-dropdown--compact {
                width: 100%;
                min-width: 0;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar-dropdown-menu {
                width: 100%;
                max-width: 100%;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) .ops-alert-toolbar-filter--owner {
                margin-left: 0;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar:not(.ops-alert-toolbar--panel) .ops-alert-toolbar-btn--read-standalone {
                justify-self: stretch;
                width: 100%;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar--panel {
                width: 100%;
                max-width: none;
                margin: 0;
                padding: 14px;
                border-radius: 18px;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar__panel-grid {
                grid-template-columns: minmax(0, 1fr);
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar__panel-grid .ops-alert-toolbar-filter--scope,
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar__panel-grid .ops-alert-toolbar-filter--owner {
                grid-column: auto;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .ops-alert-toolbar__panel-actions .ops-alert-toolbar-btn {
                width: 100%;
                flex-basis: 100%;
            }
            .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-input-area {
                flex: 0 0 auto;
                padding: 10px 12px;
            }
            html[data-theme="light"] .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-sidebar {
                background: var(--chat-admin-light-sidebar);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout.admin-mode-layout--narrow .admin-chat-area {
                background: var(--chat-admin-light-soft);
            }
            html[data-theme="light"] .chat-window.admin-mode-layout.admin-mode-layout--narrow .chat-input-area {
                background: var(--chat-admin-light-panel);
            }
            
            /* Very narrow screens */
            @media (max-width: 480px) {
                .chat-window.admin-mode-layout {
                    width: 97vw !important;
                    max-width: 97vw !important;
                    height: 78vh !important;
                    max-height: 78vh !important;
                    border-radius: 16px !important;
                }
            }
            
            /* Loading Spinner for message loading */
            .loading-overlay {
                opacity: 1;
                transition: opacity 160ms cubic-bezier(0.22, 1, 0.36, 1);
            }

            .loading-overlay .loading-spinner {
                width: 32px;
                height: 32px;
                border: 3px solid rgba(255, 255, 255, 0.2);
                border-top-color: rgba(107, 158, 206, 0.8);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }

            .loading-overlay.is-exiting {
                opacity: 0 !important;
                pointer-events: none !important;
                transition: opacity 160ms cubic-bezier(0.22, 1, 0.36, 1) !important;
            }

            .loading-overlay--user-dots {
                background: var(--chat-panel-bg, rgba(248, 250, 252, 0.94)) !important;
                color: var(--chat-accent-blue, #6b94c6) !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }

            .chat-loading-state {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 72px;
                min-height: 44px;
            }

            .chat-loading-state--user-handoff {
                margin: auto;
                color: var(--chat-accent-blue, #6b94c6);
            }

            .chat-loading-dots {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                flex-shrink: 0;
            }

            .chat-loading-dots span {
                width: 9px;
                height: 9px;
                border-radius: 999px;
                background: currentColor;
                opacity: 0.24;
                animation: chat-widget-loading-dots 1.05s ease-in-out infinite;
            }

            .chat-loading-dots span:nth-child(2) {
                animation-delay: 0.16s;
            }

            .chat-loading-dots span:nth-child(3) {
                animation-delay: 0.32s;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            @keyframes chat-widget-loading-dots {
                0%, 80%, 100% {
                    transform: translateY(0);
                    opacity: 0.24;
                }

                40% {
                    transform: translateY(-3px);
                    opacity: 0.96;
                }
            }
        `;
        document.head.appendChild(style);
    }

    isOpsAlertSessionId(sessionId) {
        return String(sessionId || '').trim() === this.opsAlertSessionId;
    }

    isOpsAlertSession(session) {
        return Boolean(session) && (
            session.kind === 'ops_alerts'
            || this.isOpsAlertSessionId(session.id)
            || this.isOpsAlertSessionId(session.sessionId)
        );
    }

    parseChatOpsPayload(value) {
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

    extractOpsAlertEntryPath(content = '') {
        return String(content || '')
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.startsWith('处理入口：'))
            ?.replace(/^处理入口：/, '')
            .trim() || '';
    }

    stripOpsAlertEntryPath(content = '') {
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

    buildOpsAlertPreview(alert = {}) {
        const title = String(alert.title || '').trim();
        if (title) {
            return `${this.getOpsAlertSeverityLabel(alert.severity)} · ${title}`;
        }

        const firstLine = this.stripOpsAlertEntryPath(alert.content || '')
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
        const normalized = String(status || '').trim().toLowerCase() || 'open';
        if (normalized === 'resolved') return 'resolved';
        if (normalized === 'claimed') return 'claimed';
        return 'open';
    }

    getOpsAlertCaseStatusLabel(status = '') {
        const normalized = String(status || '').trim().toLowerCase() || 'open';
        const labelMap = {
            open: '待处理',
            claimed: '处理中',
            resolved: '已关闭'
        };
        return labelMap[normalized] || '待处理';
    }

    getOpsAlertCaseEventActionLabel(action = '') {
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
        const normalized = this.normalizeOpsAlertCaseEventRecord(event);
        if (!normalized) {
            return '';
        }

        const muteUntil = String(normalized.metadata?.mute_until || '').trim();
        const action = String(normalized.action || '').trim().toLowerCase();
        const summary = action === 'batch_mute' && muteUntil
            ? `已静音至 ${this.formatOpsAlertDetailTime(muteUntil)}`
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
            parts.push(this.formatOpsAlertDetailTime(normalized.created_at));
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
        const caseRecord = alert.caseRecord || null;
        const parts = [];
        if (alert.moduleMuteActive && alert.moduleMuteUntil) {
            const muteCopy = alert.moduleMuteAllowCritical
                ? `已静音至 ${this.formatOpsAlertDetailTime(alert.moduleMuteUntil)}（紧急继续通知）`
                : `已静音至 ${this.formatOpsAlertDetailTime(alert.moduleMuteUntil)}`;
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
            parts.push(`更新于 ${this.formatOpsAlertDetailTime(caseRecord.last_action_at)}`);
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

    async appendOpsAlertCaseNote(alert = {}, note = '') {
        const normalizedNote = String(note || '').trim();
        if (!normalizedNote || !alert.caseCategoryKey || !alert.caseTargetId) {
            return null;
        }

        const headers = await this.getOpsAlertCaseApiHeaders();
        const response = await fetch('/api/admin/settings/ops-alert-monitor-cases', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: 'add_note',
                site: this.getOpsAlertCaseSite(alert),
                category_key: alert.caseCategoryKey,
                target_id: alert.caseTargetId,
                alert_type: alert.alertType || '',
                title: alert.title || '',
                note: normalizedNote,
                metadata: {
                    site: this.getOpsAlertCaseSite(alert),
                    category: alert.caseCategoryKey,
                    alert_type: alert.alertType || '',
                    reference_label: alert.referenceLabel || '',
                    reference_value: alert.referenceValue || '',
                    title: alert.title || ''
                }
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || '回写工单备注失败');
        }
        return payload.case || null;
    }

    async openLinkedOpsAlertTicket(alert = {}) {
        const ticketId = this.getOpsAlertLinkedTicketId(alert);
        if (!ticketId) {
            this.showNotification('这条代办还没有关联工单', '📌 站内代办', true);
            return false;
        }

        const context = {
            ...this.buildOpsAlertContext(alert.alertType || '', alert.payload || {}, alert.title || ''),
            referenceLabel: '工单号',
            referenceValue: ticketId,
            targetId: ticketId,
            target_id: ticketId
        };

        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher === 'function') {
            return this.openWorkbenchEntry('tickets-pending', context);
        }

        return this.openAdminStudioForOpsAlertWorkspace({
            kind: 'ops-workspace',
            workspaceKey: 'tickets-pending',
            context
        });
    }

    async handleCreateOpsAlertTicket(alert = {}) {
        if (!this.canCreateOpsAlertTicket(alert)) {
            this.showNotification('当前告警暂不支持直接转工单', '📌 站内代办', true);
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
                console.warn('[ChatWidget] Failed to append linked ticket note:', noteError);
            }
        }

        this.refreshOpsAlertUi();
        this.showNotification(payload.message || `已转工单：${ticketId || '已创建'}`, '📌 站内代办', true);
        return true;
    }

    getOpsAlertCaseActions(alert = {}) {
        if (!alert.caseCategoryKey || !alert.caseTargetId) {
            return [];
        }

        const status = String(alert.case_status || '').trim().toLowerCase() || 'open';
        const linkedTicketId = this.getOpsAlertLinkedTicketId(alert);
        if (status === 'resolved') {
            const actions = [
                ...(linkedTicketId ? [{ action: 'open_ticket', label: '查看工单', style: 'secondary' }] : []),
                { action: 'reopen', label: '重新打开', style: 'ghost' },
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
            console.warn('[ChatWidget] Failed to load ops alert monitor meta:', error);
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
        if (this.isOpen && this.currentSessionKey === this.opsAlertSessionId) {
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

        const options = [{ value: 'all', label: '负责人' }];
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
        if (this.isOpen && this.currentSessionKey === this.opsAlertSessionId) {
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
            { value: 'all', label: '分类' },
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
            { value: 'visible', label: '当前' },
            { value: 'hour', label: '1h' },
            { value: 'today', label: '今天' },
            { value: 'all', label: '全部' }
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
        if (this.isOpen && this.currentSessionKey === this.opsAlertSessionId) {
            this.renderOpsAlertMessages();
        }
    }

    handleOpsAlertReadTimeChange(value = 'visible') {
        const normalized = String(value || 'visible').trim().toLowerCase();
        const allowed = new Set(this.getOpsAlertReadTimeOptions().map((item) => item.value));
        this.opsAlertReadTimeFilter = allowed.has(normalized) ? normalized : 'visible';
        if (this.isOpen && this.currentSessionKey === this.opsAlertSessionId) {
            this.renderOpsAlertMessages();
        }
    }

    markFilteredOpsAlertsRead() {
        const targets = this.getOpsAlertReadTargetAlerts();
        if (!targets.length) {
            this.showNotification('无未读', '📌 站内代办', true);
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
        this.refreshOpsAlertUi();
        this.showNotification(`已读 ${this.formatCompactCount(targets.length)}`, '📌 站内代办', true);
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
            this.showNotification('无可转交', '📌 站内代办', true);
            return false;
        }

        const defaultOwnerAdminId = this.opsAlertOwnerFilter !== 'all' && this.opsAlertOwnerFilter !== 'unassigned'
            ? this.opsAlertOwnerFilter
            : this.opsAlertCurrentAdminId;

        try {
            this.opsAlertBatchAssignBusy = true;
            this.refreshOpsAlertUi();

            const selectedOwner = await this.promptOpsAlertAssignee(defaultOwnerAdminId);
            if (!selectedOwner) {
                return false;
            }

            const note = String(window.prompt(`备注（可选，${alerts.length} 条）`, '') || '').trim();
            const label = this.opsAlertOwnerFilter === 'unassigned' ? '指派' : '接力';
            if (!window.confirm(`确认${label} ${alerts.length} 条给 ${selectedOwner.label}？`)) {
                return false;
            }

            const headers = await this.getOpsAlertCaseApiHeaders();
            const response = await fetch('/api/admin/settings/ops-alert-monitor-cases', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    action: 'assign',
                    owner_admin_id: selectedOwner.id,
                    owner_label: selectedOwner.label,
                    note,
                    metadata: {
                        source: 'chat_widget_toolbar_batch_assign',
                        filter_view: this.opsAlertViewFilter,
                        filter_owner: this.opsAlertOwnerFilter
                    },
                    items: alerts.map((alert) => ({
                        category_key: alert.caseCategoryKey,
                        target_id: alert.caseTargetId,
                        alert_type: alert.alertType || '',
                        title: alert.title || '',
                        reference_label: alert.referenceLabel || '',
                        reference_value: alert.referenceValue || '',
                        metadata: {
                            title: alert.title || '',
                            reference_label: alert.referenceLabel || '',
                            reference_value: alert.referenceValue || '',
                            alert_type: alert.alertType || ''
                        }
                    }))
                })
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.success === false) {
                throw new Error(payload.message || '批量转交站内代办失败');
            }

            this.applyOpsAlertCasesToMessages(payload.cases || []);
            await this.refreshOpsAlertCaseStateForAlerts(alerts);
            this.refreshOpsAlertUi();
            this.showNotification(payload.message || '站内代办已批量转交', '📌 站内代办', true);
            return true;
        } catch (error) {
            console.error('[ChatWidget] Failed to batch assign ops alerts:', error);
            this.showNotification(`处理失败：${error.message || '未知错误'}`, '📌 站内代办', true);
            return false;
        } finally {
            this.opsAlertBatchAssignBusy = false;
            this.refreshOpsAlertUi();
        }
    }

    closeOpsAlertToolbarDropdowns(root = document) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        scope.querySelectorAll('.ops-alert-toolbar-dropdown.is-open').forEach((dropdown) => {
            if (typeof dropdown._closeOpsAlertToolbarDropdown === 'function') {
                dropdown._closeOpsAlertToolbarDropdown();
                return;
            }
            dropdown.classList.remove('is-open');
            dropdown.querySelector('.ops-alert-toolbar-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
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
        field.className = `ops-alert-toolbar-filter${fieldClassName ? ` ${fieldClassName}` : ''}`;

        if (label) {
            const labelEl = document.createElement('span');
            labelEl.className = 'ops-alert-toolbar-copy';
            labelEl.textContent = label;
            field.appendChild(labelEl);
        }

        const dropdown = document.createElement('div');
        dropdown.className = `ops-alert-toolbar-dropdown${compact ? ' ops-alert-toolbar-dropdown--compact' : ''}`;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ops-alert-toolbar-dropdown-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', ariaLabel || label || '筛选');

        const triggerText = document.createElement('span');
        triggerText.className = 'ops-alert-toolbar-dropdown-value';
        triggerText.textContent = selectedOption.label || selectedOption.value || '请选择';
        trigger.appendChild(triggerText);

        const triggerIcon = document.createElement('i');
        triggerIcon.className = 'fas fa-chevron-down ops-alert-toolbar-dropdown-icon';
        triggerIcon.setAttribute('aria-hidden', 'true');
        trigger.appendChild(triggerIcon);

        const menu = document.createElement('div');
        menu.className = 'ops-alert-toolbar-dropdown-menu';
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
            optionButton.className = `ops-alert-toolbar-dropdown-option${isSelected ? ' is-selected' : ''}`;
            optionButton.setAttribute('role', 'option');
            optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            optionButton.dataset.value = optionValue;
            optionButton.disabled = Boolean(option.disabled);

            const optionText = document.createElement('span');
            optionText.textContent = option.label || optionValue || '未命名';
            optionButton.appendChild(optionText);

            const checkIcon = document.createElement('i');
            checkIcon.className = 'fas fa-check ops-alert-toolbar-dropdown-check';
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
            const enabledOptions = Array.from(menu.querySelectorAll('.ops-alert-toolbar-dropdown-option:not(:disabled)'));
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

    createOpsAlertToolbarElement({ panel = false } = {}) {
        const wrapper = document.createElement('div');
        wrapper.className = `ops-alert-toolbar${panel ? ' ops-alert-toolbar--panel' : ''}`;

        const unreadCount = this.getOpsAlertUnreadCount();
        const filteredCount = this.getFilteredOpsAlertMessages().length;
        const viewOptions = [
            { key: 'all', label: '全部' },
            { key: 'active', label: '未关' },
            { key: 'unread', label: unreadCount > 0 ? `未读 ${this.formatCompactCount(unreadCount)}` : '未读' },
            { key: 'read', label: '已读' },
            { key: 'mine', label: '我的' }
        ];
        const readOptions = this.getOpsAlertReadCategoryOptions();
        this.syncOpsAlertReadCategoryFilter(readOptions);
        const readTargetCount = this.getOpsAlertReadTargetAlerts().length;
        const ownerOptions = this.getOpsAlertOwnerFilterOptions();
        this.syncOpsAlertOwnerFilter(ownerOptions);

        if (panel) {
            const panelHeader = document.createElement('div');
            panelHeader.className = 'ops-alert-toolbar__panel-header';
            panelHeader.innerHTML = `
                <div class="ops-alert-toolbar__panel-copy">
                    <span class="ops-alert-toolbar__panel-eyebrow">站内代办筛选</span>
                    <strong class="ops-alert-toolbar__panel-title">筛选范围与批量动作</strong>
                </div>
                <span class="ops-alert-toolbar__panel-count">${this.formatCompactCount(filteredCount)}</span>
            `;
            wrapper.appendChild(panelHeader);

            const panelSummary = document.createElement('div');
            panelSummary.className = 'ops-alert-toolbar__panel-summary';

            const summaryParts = [];
            const activeView = viewOptions.find((item) => item.key === this.opsAlertViewFilter)?.label || '全部';
            summaryParts.push(`范围 ${activeView}`);

            const activeReadCategory = readOptions.find((item) => item.value === this.opsAlertReadCategoryFilter)?.label || '全部分类';
            summaryParts.push(`分类 ${activeReadCategory}`);

            const activeReadTime = this.getOpsAlertReadTimeOptions()
                .find((item) => item.value === this.opsAlertReadTimeFilter)?.label || '可见消息';
            summaryParts.push(`时间 ${activeReadTime}`);

            if (ownerOptions.length > 1) {
                const activeOwner = ownerOptions.find((item) => item.value === this.opsAlertOwnerFilter)?.label || '全部负责人';
                summaryParts.push(`负责人 ${activeOwner}`);
            }

            panelSummary.textContent = `${summaryParts.join(' · ')} · 当前 ${this.formatCompactCount(filteredCount)} 条`;
            wrapper.appendChild(panelSummary);
        }

        const scopeLabel = panel ? '范围' : '';
        const scopeFilterWrap = this.createOpsAlertToolbarDropdown({
            label: scopeLabel,
            ariaLabel: '范围',
            options: viewOptions.map((item) => ({
                value: item.key,
                label: item.label,
                disabled: item.key === 'mine' && !this.opsAlertCurrentAdminId
            })),
            value: this.opsAlertViewFilter,
            onChange: (nextValue) => this.setOpsAlertViewFilter(nextValue),
            fieldClassName: 'ops-alert-toolbar-filter--scope'
        });

        const readWrap = document.createElement('div');
        readWrap.className = 'ops-alert-toolbar-read';

        const readCategoryFilterWrap = this.createOpsAlertToolbarDropdown({
            label: panel ? '分类' : '',
            ariaLabel: '分类',
            options: readOptions,
            value: this.opsAlertReadCategoryFilter,
            onChange: (nextValue) => this.handleOpsAlertReadCategoryChange(nextValue),
            compact: true
        });
        readWrap.appendChild(readCategoryFilterWrap);

        const readTimeFilterWrap = this.createOpsAlertToolbarDropdown({
            label: panel ? '时间' : '',
            ariaLabel: '时间',
            options: this.getOpsAlertReadTimeOptions(),
            value: this.opsAlertReadTimeFilter,
            onChange: (nextValue) => this.handleOpsAlertReadTimeChange(nextValue),
            compact: true
        });
        readWrap.appendChild(readTimeFilterWrap);

        let ownerFilterWrap = null;

        if (ownerOptions.length > 1) {
            ownerFilterWrap = this.createOpsAlertToolbarDropdown({
                label: panel ? '负责人' : '',
                ariaLabel: '负责人',
                options: ownerOptions,
                value: this.opsAlertOwnerFilter,
                onChange: (nextValue) => this.setOpsAlertOwnerFilter(nextValue),
                fieldClassName: 'ops-alert-toolbar-filter--owner'
            });
        }

        if (panel) {
            const panelGrid = document.createElement('div');
            panelGrid.className = 'ops-alert-toolbar__panel-grid';
            panelGrid.appendChild(scopeFilterWrap);
            panelGrid.appendChild(readCategoryFilterWrap);
            panelGrid.appendChild(readTimeFilterWrap);
            if (ownerFilterWrap) {
                panelGrid.appendChild(ownerFilterWrap);
            }
            wrapper.appendChild(panelGrid);
        } else {
            wrapper.appendChild(scopeFilterWrap);
            wrapper.appendChild(readWrap);
            if (ownerFilterWrap) {
                wrapper.appendChild(ownerFilterWrap);
            }
        }

        const actionsWrap = document.createElement('div');
        actionsWrap.className = panel ? 'ops-alert-toolbar-actions ops-alert-toolbar__panel-actions' : 'ops-alert-toolbar-actions';

        const readButton = document.createElement('button');
        readButton.type = 'button';
        readButton.className = 'ops-alert-toolbar-btn ops-alert-toolbar-btn--read ops-alert-toolbar-btn--read-standalone';
        readButton.disabled = readTargetCount <= 0;
        readButton.setAttribute('aria-label', '已读');
        readButton.innerHTML = panel
            ? `<i class="fas fa-check-double" aria-hidden="true"></i><span>标记已读 ${readTargetCount > 0 ? this.formatCompactCount(readTargetCount) : '0'}</span>`
            : `<i class="fas fa-check-double" aria-hidden="true"></i><span>${readTargetCount > 0 ? this.formatCompactCount(readTargetCount) : '0'}</span>`;
        readButton.addEventListener('click', () => {
            this.markFilteredOpsAlertsRead();
        });
        actionsWrap.appendChild(readButton);

        if (this.shouldShowOpsAlertBatchAssign()) {
            const batchButton = document.createElement('button');
            batchButton.type = 'button';
            batchButton.className = 'ops-alert-toolbar-btn ops-alert-toolbar-btn--accent';
            const count = this.getBatchAssignableOpsAlerts().length;
            batchButton.textContent = `${panel ? '批量' : ''}${this.opsAlertOwnerFilter === 'unassigned' ? '指派' : '接力'} ${this.formatCompactCount(count)}`;
            batchButton.disabled = this.opsAlertBatchAssignBusy;
            if (this.opsAlertBatchAssignBusy) {
                batchButton.textContent = '处理中';
            }
            batchButton.addEventListener('click', () => {
                this.handleOpsAlertBatchAssign();
            });
            actionsWrap.appendChild(batchButton);
        }
        wrapper.appendChild(actionsWrap);

        return wrapper;
    }

    renderOpsAlertToolbarPanel() {
        if (!this.userContextPanel) return;

        const shouldRenderPanel = this.isNarrowAdminMode() && this.isOpsAlertSessionSelected();
        const panelKind = String(this.userContextPanel.dataset.panelKind || '').trim();

        if (!shouldRenderPanel) {
            if (panelKind === 'ops-filter') {
                this.userContextPanel.dataset.panelKind = '';
                this.userContextPanel.className = 'chat-context-panel';
                this.userContextPanel.hidden = true;
                this.userContextPanel.replaceChildren();
            }
            this.syncUserContextPanelVisibility();
            this.scheduleAdminFloatingPanelOffsetSync();
            return;
        }

        this.userContextPanel.dataset.panelKind = 'ops-filter';
        this.userContextPanel.className = 'chat-context-panel chat-context-panel--ops-filter';
        this.userContextPanel.replaceChildren(this.createOpsAlertToolbarElement({ panel: true }));
        this.syncUserContextPanelVisibility();
        this.scheduleAdminFloatingPanelOffsetSync();
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
                site: caseSite,
                category_key: item.caseCategoryKey,
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
                site: caseSite,
                category_key: sourceAlert.caseCategoryKey,
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

    async fetchOpsAlertSettingsConfig() {
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
            message: `已将${selection.moduleLabel}稍后至 ${this.formatOpsAlertDetailTime(selection.until)}`,
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
            if (!categoryKey || !site || !targetIds.length) {
                return accumulator;
            }
            const groupKey = this.buildOpsAlertCaseKey(categoryKey, '', site);
            if (!accumulator.has(groupKey)) {
                accumulator.set(groupKey, { site, categoryKey, targetIds: [] });
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
        return this.getSupportAuthHeaders();
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

        const headers = await this.getOpsAlertCaseApiHeaders();
        const response = await fetch('/api/admin/settings/ops-alert-monitor-cases', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: normalizedAction,
                site: this.getOpsAlertCaseSite(alert),
                category_key: alert.caseCategoryKey,
                target_id: alert.caseTargetId,
                alert_type: alert.alertType || '',
                title: alert.title || '',
                owner_admin_id: ownerAdminId,
                owner_label: ownerLabel,
                note,
                resolution,
                metadata: {
                    site: this.getOpsAlertCaseSite(alert),
                    category: alert.caseCategoryKey,
                    alert_type: alert.alertType || '',
                    reference_label: alert.referenceLabel || '',
                    reference_value: alert.referenceValue || '',
                    title: alert.title || ''
                }
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
            throw new Error(payload.message || '站内代办处理失败');
        }
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

    refreshOpsAlertUi() {
        this.refreshOpsAlertSessionEntry();
        if (this.isOpen && this.currentSessionKey === this.opsAlertSessionId) {
            this.renderOpsAlertMessages();
        } else {
            this.renderOpsAlertToolbarPanel();
        }
    }

    async handleOpsAlertCaseAction(alert = {}, action = '') {
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!normalizedAction) return false;
        if (this.isOpsAlertCaseActionBusy(alert.id, normalizedAction)) {
            return false;
        }

        try {
            this.markOpsAlertCaseActionBusy(alert.id, normalizedAction, true);
            this.refreshOpsAlertUi();

            if (normalizedAction === 'snooze') {
                const result = await this.applyOpsAlertSnooze(alert);
                if (!result) {
                    return false;
                }
                await this.refreshOpsAlertCaseStateForAlerts(
                    (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
                        .filter((item) => String(item.caseCategoryKey || '').trim().toLowerCase() === String(result.moduleKey || '').trim().toLowerCase())
                );
                this.refreshOpsAlertUi();
                this.showNotification(result.message || '站内代办已更新', '📌 站内代办', true);
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
            this.refreshOpsAlertUi();
            this.showNotification('站内代办已更新', '📌 站内代办', true);
            return true;
        } catch (error) {
            console.error('[ChatWidget] Failed to mutate ops alert case:', error);
            this.showNotification(`处理失败：${error.message || '未知错误'}`, '📌 站内代办', true);
            return false;
        } finally {
            this.markOpsAlertCaseActionBusy(alert.id, normalizedAction, false);
            this.refreshOpsAlertUi();
        }
    }

    buildOpsAlertContext(alertType = '', payload = {}, title = '', options = {}) {
        const targetId = this.getOpsAlertTargetId(payload, {
            ...options,
            alertType
        });
        const categoryKey = this.getOpsAlertCaseCategoryKey(alertType, targetId);

        return {
            title: String(title || '').trim(),
            alertType,
            alert_type: alertType,
            category: categoryKey,
            referenceLabel: this.getOpsAlertReferenceLabel(payload),
            referenceValue: this.getOpsAlertReferenceValue(payload),
            targetId,
            target_id: targetId,
            site: this.normalizeOpsAlertCaseSite(payload.site || payload.site_id || payload.siteId || payload.site_context, 'cn'),
            userId: String(payload.user_id || '').trim(),
            user_id: String(payload.user_id || '').trim(),
            clientIp: String(payload.client_ip || '').trim(),
            client_ip: String(payload.client_ip || '').trim(),
            discountCode: String(payload.discount_code || '').trim(),
            discount_code: String(payload.discount_code || '').trim(),
            sessionId: String(payload.session_id || '').trim(),
            session_id: String(payload.session_id || '').trim(),
            messageId: String(payload.message_id || '').trim(),
            message_id: String(payload.message_id || '').trim()
        };
    }

    resolveOpsAlertEntryWorkspace(entryPath = '', baseContext = {}) {
        if (typeof window.resolveOpsAlertEntryWorkspace === 'function') {
            return window.resolveOpsAlertEntryWorkspace(entryPath, baseContext);
        }

        const normalizedEntryPath = String(entryPath || '').trim();
        if (!normalizedEntryPath) {
            return { kind: 'none' };
        }
        return { kind: 'none' };
    }

    resolveShopRiskWorkspaceForChat(baseContext = {}, payload = {}) {
        if (typeof window.resolveShopRiskWorkspace === 'function') {
            return window.resolveShopRiskWorkspace(baseContext, payload);
        }
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-orders',
            context: baseContext
        };
    }

    resolveOpsAlertWorkspace(alertType = '', payload = {}, title = '', entryPath = '', options = {}) {
        const baseContext = this.buildOpsAlertContext(alertType, payload, title, options);

        if (typeof window.resolveOpsAlertWorkspace === 'function') {
            return window.resolveOpsAlertWorkspace(alertType, payload, baseContext, entryPath);
        }

        return this.resolveOpsAlertEntryWorkspace(entryPath, baseContext);
    }

    normalizeOpsAlertJob(row = {}) {
        const payload = this.parseChatOpsPayload(row.payload);
        const alertType = String(row.alert_type || '').trim().toLowerCase();
        const rawContent = String(row.content || '').trim();
        const content = rawContent || this.buildOpsAlertFallbackContent(alertType, payload, row.title);
        const entryPath = String(payload.entry_path || '').trim() || this.extractOpsAlertEntryPath(content);
        const createdAt = row.created_at || row.updated_at || new Date().toISOString();
        const updatedAt = row.updated_at || createdAt;
        const dedupeKey = String(row.dedupe_key || '').trim();
        const targetId = this.getOpsAlertTargetId(payload, { alertType, dedupeKey });
        const caseCategoryKey = this.getOpsAlertCaseCategoryKey(alertType, targetId);
        const alert = {
            id: String(row.id || `ops-alert-${createdAt}`),
            alertType,
            site: String(payload.site || payload.site_id || payload.siteId || 'cn').trim().toLowerCase() || 'cn',
            severity: String(row.severity || 'warning').trim().toLowerCase() || 'warning',
            title: String(row.title || '系统告警').trim() || '系统告警',
            content,
            displayContent: this.stripOpsAlertEntryPath(content),
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
            dedupeKey,
            dedupe_key: dedupeKey,
            caseCategoryKey,
            caseTargetId: targetId,
            caseSite: this.getOpsAlertCaseSite({
                payload,
                site: payload.site || payload.site_id || payload.siteId || payload.site_context || 'cn'
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

        alert.workspace = this.resolveOpsAlertWorkspace(alertType, payload, alert.title, entryPath, { dedupeKey });
        alert.preview = this.buildOpsAlertPreview(alert);
        return alert;
    }

    buildOpsAlertEngagementItem(alert = {}) {
        const normalized = alert && typeof alert === 'object' && !Array.isArray(alert) ? alert : {};
        const id = String(normalized.id || '').trim();
        if (!id) return null;
        const content = String(
            normalized.displayContent
            || normalized.content
            || normalized.preview
            || normalized.title
            || '站内代办提醒'
        ).trim();
        if (!content) return null;
        const severity = String(normalized.severity || 'warning').trim().toLowerCase() || 'warning';
        return this.normalizeEngagementItem({
            id: `ops_alert:${id}`,
            source: 'ops_alert',
            source_module: 'ops_alert_jobs',
            source_event_id: `ops_alert:${id}`,
            trigger_type: 'ops_alert',
            title: String(normalized.title || '站内代办提醒').trim() || '站内代办提醒',
            content,
            category: String(normalized.alertType || 'ops_alert').trim() || 'ops_alert',
            page_id: this.getEngagementPageId(),
            site: normalized.site || 'cn',
            placement: 'robot_bubble',
            priority: severity === 'critical' ? 95 : (severity === 'info' ? 55 : 78),
            tone: severity === 'critical' ? 'alert' : (severity === 'info' ? 'info' : 'warning'),
            action_label: '处理告警',
            action_url: `ops-alert://${encodeURIComponent(id)}`,
            dismiss_ttl_hours: 8,
            repeat_interval_minutes: 15,
            metadata: {
                alert_type: normalized.alertType || '',
                severity,
                site: normalized.site || 'cn',
                status: normalized.status || '',
                entry_path: normalized.entryPath || '',
                payload: normalized.payload || {},
                created_at: normalized.created_at || '',
                updated_at: normalized.updated_at || '',
                source_module: 'ops_alert_jobs',
                source_event_id: `ops_alert:${id}`
            }
        });
    }

    showOpsAlertEngagementBubble(alert = {}, options = {}) {
        if (!this.isCnAdminEngagementBubbleContext()) {
            return false;
        }
        const item = this.buildOpsAlertEngagementItem(alert);
        if (!item) {
            return false;
        }
        return this.showRealtimeEngagementItem(item, {
            source: 'ops_alert_jobs',
            ...(options || {})
        });
    }

    async openOpsAlertEngagementTarget(item = {}) {
        if (!this.isAdmin) {
            return false;
        }
        await this.openChat();
        try {
            await this.refreshOpsAlerts({ announceNew: false });
        } catch (error) {
            console.warn('[ChatWidget] Failed to refresh ops alerts from engagement action:', error?.message || error);
        }
        if (!this.sessionList || !this.chatHeader) {
            return false;
        }
        const session = this.sessions.find((entry) => this.isOpsAlertSession(entry)) || this.buildOpsAlertSession();
        this.selectSession(this.opsAlertSessionId, session);
        this.clearUnread();
        return true;
    }

    buildOpsAlertSessionSearchText() {
        return this.opsAlertMessages
            .slice(0, 24)
            .map((alert) => [alert.title, alert.displayContent, alert.entryPath, alert.preview, alert.case_owner_label].filter(Boolean).join('\n'))
            .join('\n');
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

    buildOpsAlertSession() {
        const latest = this.opsAlertMessages[0] || null;
        const latestActive = (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .find((alert) => !this.isOpsAlertClosed(alert)) || null;
        const activeCount = this.getOpsAlertActiveCount();
        const mutedModuleCount = this.getOpsAlertMutedModuleCount();
        const ownerSummary = this.getOpsAlertOwnerSummary();
        const preview = this.opsAlertLoadError
            ? `同步失败：${this.opsAlertLoadError}`
            : latestActive
                ? (latestActive.preview || '站外告警会同步到这里')
                : latest
                    ? '当前没有未关闭的站内代办'
                    : '站外告警会同步到这里';

        const totalCountLabel = this.opsAlertMessages.length > 99 ? '99+' : String(this.opsAlertMessages.length || 0);
        const subtextParts = this.opsAlertLoadError
            ? ['站外告警同步异常']
            : [ownerSummary || '固定系统联系人'];
        if (!this.opsAlertLoadError && this.opsAlertMessages.length) {
            subtextParts.push(`${totalCountLabel} 条同步`);
        }
        if (activeCount > 0) {
            subtextParts.push(`未关闭 ${activeCount > 99 ? '99+' : activeCount}`);
        }
        if (mutedModuleCount > 0) {
            subtextParts.push(`静音 ${mutedModuleCount > 99 ? '99+' : mutedModuleCount} 组`);
        }
        const subtext = subtextParts.join(' · ');
        const badge = this.opsAlertLoadError
            ? '异常'
            : activeCount > 0
                ? `${activeCount > 99 ? '99+' : activeCount}待办`
                : mutedModuleCount > 0
                    ? `${mutedModuleCount > 99 ? '99+' : mutedModuleCount}静音`
                    : '置顶';

        return {
            id: this.opsAlertSessionId,
            sessionIds: [this.opsAlertSessionId],
            nickname: '站内代办',
            email: subtext,
            lastLogin: latestActive?.created_at || latest?.created_at || '',
            lastMessage: preview,
            lastTime: latestActive?.updated_at || latestActive?.created_at || latest?.updated_at || latest?.created_at || '',
            isAdmin: false,
            userId: '',
            avatarUrl: '',
            kind: 'ops_alerts',
            subtext,
            badge,
            searchText: this.buildOpsAlertSessionSearchText()
        };
    }

    async fetchOpsAlertJobs() {
        const { data, error } = await this.supabase
            .from('ops_alert_jobs')
            .select('id, dedupe_key, alert_type, severity, title, content, payload, status, last_error, created_at, updated_at, delivered_at')
            .order('created_at', { ascending: false })
            .limit(160);

        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    shouldIncludeOpsAlertJobRow(row = {}) {
        const payload = this.parseChatOpsPayload(row?.payload);
        return this.matchesCurrentSite({
            site: String(payload.site || payload.site_id || payload.siteId || 'cn').trim().toLowerCase() || 'cn'
        }, 'cn');
    }

    async refreshOpsAlerts(options = {}) {
        const announceNew = options.announceNew === true;
        const isViewingOpsSession = this.isOpen && this.currentSessionKey === this.opsAlertSessionId;
        const knownIds = new Set((Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : []).map((alert) => alert.id));

        try {
            const results = await Promise.allSettled([
                this.fetchOpsAlertJobs(),
                this.ensureOpsAlertMonitorMeta(),
                this.fetchOpsAlertSettingsConfig()
            ]);
            const rowsResult = results[0];
            if (results[1]?.status !== 'fulfilled') {
                console.warn('[ChatWidget] Failed to fetch ops alert assignee meta:', results[1]?.reason);
            }
            if (results[2]?.status !== 'fulfilled') {
                console.warn('[ChatWidget] Failed to fetch ops alert mute rules:', results[2]?.reason);
            }
            if (!rowsResult || rowsResult.status !== 'fulfilled') {
                throw rowsResult?.reason || new Error('站外告警读取失败');
            }
            const rows = rowsResult.value;
            await this.processOpsAlertData(rows);

            const newAlerts = this.opsAlertMessages.filter((alert) => !knownIds.has(alert.id));
            if (newAlerts.length && announceNew && !isViewingOpsSession) {
                this.unreadSessions.add(this.opsAlertSessionId);
                const newestAlert = newAlerts[0];
                try {
                    this.showNotification(newestAlert.title || newestAlert.preview || '收到新的站外告警', '📌 站内代办', true);
                } catch (notificationError) {
                    console.warn('[ChatWidget] Failed to show ops alert notification:', notificationError);
                }
            } else if (isViewingOpsSession) {
                this.clearSessionUnreadState(this.opsAlertSessionId, [this.opsAlertSessionId]);
            }

            this.refreshOpsAlertSessionEntry();
            if (isViewingOpsSession) {
                this.renderOpsAlertMessages();
            }
            return this.opsAlertMessages;
        } catch (error) {
            this.opsAlertMessages = [];
            this.opsAlertLoadError = error?.message || '站外告警读取失败';
            this.refreshOpsAlertSessionEntry();
            if (isViewingOpsSession) {
                this.renderOpsAlertMessages();
            }
            throw error;
        }
    }

    startAdminOpsAlertPolling() {
        if (this.adminOpsAlertPollTimer) return;

        this.adminOpsAlertPollTimer = setInterval(() => {
            this.refreshOpsAlerts({ announceNew: true }).catch((error) => {
                console.warn('[ChatWidget] Admin ops alert polling failed:', error?.message || error);
            });
        }, 15000);
    }

    async processOpsAlertData(rows) {
        this.opsAlertLoadError = '';
        const alerts = (Array.isArray(rows) ? rows : [])
            .filter((row) => this.shouldIncludeOpsAlertJobRow(row))
            .map((row) => this.normalizeOpsAlertJob(row));
        this.opsAlertMessages = (await this.attachOpsAlertCases(alerts))
            .sort((left, right) => {
                const leftTime = left.sortTimestamp instanceof Date ? left.sortTimestamp.getTime() : 0;
                const rightTime = right.sortTimestamp instanceof Date ? right.sortTimestamp.getTime() : 0;
                return rightTime - leftTime;
            });
    }

    refreshOpsAlertSessionEntry() {
        const nonOpsSessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => !this.isOpsAlertSession(session));
        this.sessions = [this.buildOpsAlertSession(), ...this.sortAdminSessions(nonOpsSessions)];
        this.renderAdminSessionQueueControls();
        this.renderAdminSessionList();
    }

    getAdminSessionFilterEmptyMessage() {
        if (this.adminSessionQueueView === 'priority') {
            return '当前没有高优先会话';
        }
        if (this.adminSessionQueueView === 'ticket_followup') {
            return '当前没有售后值守会话';
        }
        if (this.adminSessionQueueView === 'payment_verify') {
            return '当前没有支付或验证异常会话';
        }

        switch (this.adminSessionQueueFilter) {
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
                return this.t('chat.noSessions', '暂无会话');
        }
    }

    renderAdminSessionList() {
        if (!this.sessionList) return;

        if (this._adminSessionListBootstrapping && (!Array.isArray(this.sessions) || this.sessions.length === 0)) {
            return;
        }

        const existingSessionItems = new Map(
            Array.from(this.sessionList.querySelectorAll(':scope > .session-item'))
                .map((item) => [item.dataset.sessionId || '', item])
                .filter(([sessionId]) => sessionId)
        );
        const renderSessionState = (message) => {
            const stateEl = document.createElement('div');
            stateEl.className = 'session-loading';
            stateEl.textContent = message;
            this.sessionList.replaceChildren(stateEl);
        };

        this.renderAdminSessionQueueControls();
        if (!Array.isArray(this.sessions) || this.sessions.length === 0) {
            renderSessionState(this.t('chat.noSessions', '暂无会话'));
            return;
        }

        const visibleSessions = this.sessions
            .filter((session) => this.matchesAdminSessionQueueView(session))
            .filter((session) => this.matchesAdminSessionQueueFilter(session));

        if (!visibleSessions.length) {
            renderSessionState(this.getAdminSessionFilterEmptyMessage());
            return;
        }

        const fragment = document.createDocumentFragment();
        visibleSessions.forEach((session) => {
            const item = existingSessionItems.get(session.id) || document.createElement('div');
            item.replaceChildren();
            const isOpsSession = this.isOpsAlertSession(session);
            item.className = `session-item${isOpsSession ? ' session-item--ops' : ''}`;
            item.dataset.sessionId = session.id;
            item.classList.toggle('active', this.currentSessionKey === session.id);

            const sessionIds = session.sessionIds || [session.id];
            const hasUnread = sessionIds.some((sid) => this.unreadSessions.has(sid));
            if (hasUnread) {
                item.classList.add('unread');
            }

            const previewText = String(session.lastMessage || '').trim();
            const preview = previewText.length > 20 ? `${previewText.slice(0, 20)}...` : previewText;
            const presenceLabel = isOpsSession ? '' : this.getUserPresenceLabelForSession(session);
            const isPresenceOnline = presenceLabel === this.t('chat.online', '在线');
            const inactiveActivityFallback = this.hasKnownUserIdentityForSession(session)
                ? this.t('chat.noActiveRecord', '暂无活跃')
                : this.formatTime(session.lastTime);
            const time = isOpsSession
                ? ''
                : isPresenceOnline
                ? presenceLabel
                : (presenceLabel || inactiveActivityFallback);
            const displayName = isOpsSession
                ? '站内代办'
                : (session.nickname.length > 12 ? `${session.nickname.slice(0, 12)}...` : session.nickname);
            const prioritySignals = isOpsSession ? [] : this.getAdminSessionPrioritySignals(session);
            const badgeText = isOpsSession ? session.badge : (prioritySignals[0]?.label || '');
            const badgeClass = isOpsSession ? '' : (prioritySignals[0]?.badgeClass || '');
            const baseDetailLine = isOpsSession
                ? (session.subtext || session.email || '固定系统联系人')
                : (session.id.startsWith('guest_')
                    ? ''
                    : ((session.email || '').length > 20 ? `${session.email.slice(0, 20)}...` : (session.email || '')));
            const prioritySubtext = prioritySignals
                .map((signal) => signal.subtext)
                .filter(Boolean)
                .slice(0, 2)
                .join(' · ');
            const presenceDetail = presenceLabel && presenceLabel !== this.t('chat.online', '在线') ? presenceLabel : '';
            const detailBaseWithPresence = presenceDetail
                ? (baseDetailLine ? `${presenceDetail} · ${baseDetailLine}` : presenceDetail)
                : baseDetailLine;
            const detailLine = prioritySubtext
                ? (detailBaseWithPresence ? `${detailBaseWithPresence} · ${prioritySubtext}` : prioritySubtext)
                : detailBaseWithPresence;

            item.dataset.searchText = [
                displayName,
                detailLine,
                previewText,
                session.searchText || '',
                prioritySignals.map((signal) => `${signal.label} ${signal.subtext || ''}`).join(' '),
                session.ticketSummary?.latestOpenTicket?.description || '',
                session.ticketSummary?.latestOpenTicket?.status || '',
                session.ticketSummary?.latestOpenTicket?.id || '',
                session.paymentSummary?.status || '',
                session.paymentSummary?.package_name || '',
                session.paymentSummary?.id || '',
                session.verificationSummary?.status || '',
                session.verificationSummary?.message || '',
                session.verificationSummary?.verification_id || '',
                badgeText
            ].filter(Boolean).join('\n').toLowerCase();

            const avatarEl = this.createSessionAvatarElement(session);

            const infoEl = document.createElement('div');
            infoEl.className = 'session-info';

            const nameRowEl = document.createElement('div');
            nameRowEl.className = 'session-name-row';

            const nameEl = document.createElement('div');
            nameEl.className = 'session-name';
            nameEl.textContent = displayName;

            nameRowEl.appendChild(nameEl);

            if (badgeText) {
                const badgeEl = document.createElement('span');
                badgeEl.className = `session-badge${badgeClass ? ` ${badgeClass}` : ''}`;
                badgeEl.textContent = badgeText;
                nameRowEl.appendChild(badgeEl);
            }

            const emailEl = document.createElement('div');
            emailEl.className = 'session-email';
            emailEl.textContent = detailLine;

            const previewEl = document.createElement('div');
            previewEl.className = 'session-preview';
            previewEl.textContent = preview;

            infoEl.appendChild(nameRowEl);
            infoEl.appendChild(emailEl);
            infoEl.appendChild(previewEl);

            const timeEl = document.createElement('div');
            timeEl.className = `session-time${isPresenceOnline ? ' session-time--online' : ''}`;
            timeEl.textContent = time;

            item.appendChild(avatarEl);
            item.appendChild(infoEl);
            item.appendChild(timeEl);

            if (hasUnread) {
                const unreadDot = document.createElement('div');
                unreadDot.className = 'unread-dot';
                item.appendChild(unreadDot);
            }

            if (item.__chatWidgetSessionClickHandler) {
                item.removeEventListener('click', item.__chatWidgetSessionClickHandler);
            }
            item.__chatWidgetSessionClickHandler = () => this.selectSession(session.id, session);
            item.addEventListener('click', item.__chatWidgetSessionClickHandler);
            fragment.appendChild(item);
        });
        this.sessionList.replaceChildren(fragment);

        if (this.adminSessionSearchQuery) {
            void this.searchSessions(this.adminSessionSearchQuery);
        }
    }

    updateAdminSessionSearchEmptyState(query = '') {
        if (!this.sessionList) return;

        this.sessionList.querySelector('.session-search-empty')?.remove();
        const normalizedQuery = String(query || '').trim();
        if (!normalizedQuery) return;

        const visibleCount = Array.from(this.sessionList.querySelectorAll('.session-item'))
            .filter((item) => !item.classList.contains('session-item--hidden'))
            .length;
        if (visibleCount > 0) return;

        const emptyEl = document.createElement('div');
        emptyEl.className = 'session-loading session-search-empty';
        emptyEl.textContent = `没有匹配“${normalizedQuery}”的会话`;
        this.sessionList.appendChild(emptyEl);
    }

    formatOpsAlertDetailTime(value) {
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

    createOpsAlertMessageElement(alert = {}) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message admin message--ops-alert message--ops-alert-${this.escapeHtml(alert.severity || 'warning')}`;
        if (this.isOpsAlertRead(alert)) {
            msgDiv.classList.add('message--ops-alert-read');
        }
        msgDiv.dataset.alertId = alert.id || '';

        const header = document.createElement('div');
        header.className = 'ops-alert-card-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'ops-alert-card-title-wrap';

        const badge = document.createElement('span');
        badge.className = `ops-alert-card-badge ops-alert-card-badge--${this.escapeHtml(alert.severity || 'warning')}`;
        badge.textContent = this.getOpsAlertSeverityLabel(alert.severity);

        const title = document.createElement('div');
        title.className = 'ops-alert-card-title';
        title.textContent = alert.title || '系统告警';

        titleWrap.appendChild(badge);
        if (alert.caseTargetId) {
            const statusBadge = document.createElement('span');
            statusBadge.className = `ops-alert-card-status ops-alert-card-status--${this.escapeHtml(this.getOpsAlertCaseStatusTone(alert.case_status))}`;
            statusBadge.textContent = this.getOpsAlertCaseStatusLabel(alert.case_status);
            titleWrap.appendChild(statusBadge);
        }
        if (alert.moduleMuteActive && alert.moduleMuteUntil) {
            const muteBadge = document.createElement('span');
            muteBadge.className = 'ops-alert-card-status ops-alert-card-status--muted';
            muteBadge.textContent = `已静音至 ${this.formatOpsAlertDetailTime(alert.moduleMuteUntil)}`;
            titleWrap.appendChild(muteBadge);
        }
        titleWrap.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'ops-alert-card-meta';
        const metaParts = [
            `创建于 ${this.formatOpsAlertDetailTime(alert.created_at)}`,
            this.getOpsAlertStatusLabel(alert)
        ];
        if (alert.updated_at && alert.updated_at !== alert.created_at) {
            metaParts.push(`更新于 ${this.formatOpsAlertDetailTime(alert.updated_at)}`);
        }
        meta.textContent = metaParts.join(' · ');

        header.appendChild(titleWrap);
        header.appendChild(meta);

        const body = document.createElement('div');
        body.className = 'ops-alert-card-content';
        body.textContent = this.buildOpsAlertBodyText(alert);

        msgDiv.appendChild(header);
        msgDiv.appendChild(body);

        const caseSummary = this.buildOpsAlertCaseSummary(alert);
        if (caseSummary) {
            const summaryEl = document.createElement('div');
            summaryEl.className = 'ops-alert-card-case-summary';
            summaryEl.textContent = caseSummary;
            msgDiv.appendChild(summaryEl);
        }

        const recentEvents = this.getOpsAlertCaseRecentEvents(alert)
            .map((event) => this.getOpsAlertCaseRecentEventText(event))
            .filter(Boolean)
            .slice(0, 3);
        if (recentEvents.length) {
            const historyEl = document.createElement('div');
            historyEl.className = 'ops-alert-card-history';
            recentEvents.forEach((eventText) => {
                const itemEl = document.createElement('div');
                itemEl.className = 'ops-alert-card-history-item';
                itemEl.textContent = eventText;
                historyEl.appendChild(itemEl);
            });
            msgDiv.appendChild(historyEl);
        }

        if (alert.lastError) {
            const errorEl = document.createElement('div');
            errorEl.className = 'ops-alert-card-error';
            errorEl.textContent = `最近错误：${alert.lastError}`;
            msgDiv.appendChild(errorEl);
        }

        const footer = document.createElement('div');
        footer.className = 'ops-alert-card-footer';

        const entry = document.createElement('div');
        entry.className = 'ops-alert-card-entry';
        entry.textContent = alert.entryPath || '暂无处理入口';

        footer.appendChild(entry);

        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'ops-alert-card-actions';

        this.getOpsAlertCaseActions(alert).forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `ops-alert-card-action ops-alert-card-action--${item.style || 'secondary'}`;
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
        actionButton.className = 'ops-alert-card-action ops-alert-card-action--primary';
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
        msgDiv.appendChild(footer);

        return msgDiv;
    }

    renderOpsAlertMessages() {
        if (!this.messagesContainer) return;

        this.renderOpsAlertToolbarPanel();

        this.messagesContainer.innerHTML = '';
        this.lastDisplayedTime = null;

        if (this.opsAlertLoadError) {
            this.messagesContainer.innerHTML = `<div class="message admin">${this.escapeHtml(`站外告警读取失败：${this.opsAlertLoadError}`)}</div>`;
            return;
        }

        const toolbar = !this.isNarrowAdminMode() ? this.createOpsAlertToolbarElement() : null;
        if (toolbar) {
            this.messagesContainer.appendChild(toolbar);
        }

        const alerts = [...this.getFilteredOpsAlertMessages()].sort((left, right) => {
            const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : 0;
            const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : 0;
            return leftTime - rightTime;
        });

        if (!alerts.length) {
            let emptyMessage = this.opsAlertViewFilter === 'mine'
                ? '暂无我的'
                : this.opsAlertViewFilter === 'active'
                    ? '暂无未关'
                    : this.opsAlertViewFilter === 'unread'
                        ? '暂无未读'
                        : this.opsAlertViewFilter === 'read'
                            ? '暂无已读'
                            : this.t('chat.noOpsAlerts', '暂无代办');
            if (this.opsAlertOwnerFilter === 'unassigned') {
                emptyMessage = '暂无未认领';
            } else if (this.opsAlertOwnerFilter !== 'all') {
                const ownerOption = this.getOpsAlertOwnerFilterOptions()
                    .find((option) => option.value === this.opsAlertOwnerFilter);
                if (ownerOption?.label) {
                    emptyMessage = `暂无 ${ownerOption.label}`;
                }
            }
            this.messagesContainer.insertAdjacentHTML('beforeend', `<div class="message admin">${this.escapeHtml(emptyMessage)}</div>`);
            return;
        }

        alerts.forEach((alert) => {
            const currentTime = alert.timestamp instanceof Date ? alert.timestamp : new Date(alert.created_at || Date.now());
            let showTime = false;

            if (!this.lastDisplayedTime) {
                showTime = true;
            } else {
                const timeDiff = Math.abs(currentTime.getTime() - this.lastDisplayedTime.getTime());
                if (timeDiff >= this.timeDisplayThreshold) {
                    showTime = true;
                }
            }

            if (showTime) {
                this.lastDisplayedTime = currentTime;
                const timeSeparator = document.createElement('div');
                timeSeparator.className = 'message-time-separator';
                timeSeparator.textContent = currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                this.messagesContainer.appendChild(timeSeparator);
            }

            this.messagesContainer.appendChild(this.createOpsAlertMessageElement(alert));
        });

        this.scrollToBottom();
    }

    setAdminReplyReadonly(readonly) {
        const inputArea = this.chatWindow?.querySelector('.chat-input-area');
        const uploadBtn = this.chatWindow?.querySelector('#chatUploadBtn');
        const emojiBtn = this.chatWindow?.querySelector('#chatEmojiBtn');
        const sendBtn = this.chatWindow?.querySelector('#chatSendBtn');
        const imageInput = this.chatWindow?.querySelector('#chatImageInput');
        const templateBar = this.replyTemplateBar;
        const chatArea = this.chatWindow?.querySelector('.admin-chat-area');

        if (inputArea) {
            inputArea.hidden = readonly;
            inputArea.style.display = readonly ? 'none' : 'flex';
        }
        if (templateBar) {
            templateBar.hidden = readonly;
        }
        if (chatArea && readonly) {
            chatArea.classList.remove('has-reply-templates');
        }
        if (this.input) {
            this.input.disabled = readonly;
            this.input.placeholder = readonly ? '站内代办为只读告警流' : this.t('chat.inputPlaceholder', '输入回复...');
        }
        if (uploadBtn) uploadBtn.disabled = readonly;
        if (emojiBtn) emojiBtn.disabled = readonly;
        if (sendBtn) sendBtn.disabled = readonly;
        if (imageInput) imageInput.disabled = readonly;
        this.syncReplyTemplateBarCollapsedState();
        this.scheduleAdminFloatingPanelOffsetSync();
    }

    normalizeOpsAlertWorkspaceForAdminStudio(workspace = {}) {
        if (workspace.kind === 'ops-workspace') {
            return {
                workspaceKey: String(workspace.workspaceKey || '').trim(),
                context: workspace.context || {},
                module: this.getAdminStudioModuleForOpsWorkspaceKey(workspace.workspaceKey)
            };
        }
        if (workspace.kind === 'shop-orders') {
            return {
                workspaceKey: 'shop-risk-orders',
                context: workspace.context || {},
                module: 'shop'
            };
        }
        if (workspace.kind === 'chat-session') {
            return {
                workspaceKey: '',
                context: workspace.context || {},
                module: 'chat'
            };
        }
        return {
            workspaceKey: '',
            context: workspace.context || {},
            module: ''
        };
    }

    getAdminStudioModuleForOpsWorkspaceKey(workspaceKey = '') {
        const normalized = String(workspaceKey || '').trim().toLowerCase();
        if (typeof window.getAdminWorkbenchModuleForWorkspaceKey === 'function') {
            const sharedModuleName = String(window.getAdminWorkbenchModuleForWorkspaceKey(normalized) || '').trim();
            if (sharedModuleName) {
                return sharedModuleName;
            }
        }
        const moduleMap = {
            'payments-overview': 'payments',
            'payments-ops': 'payments',
            'verify-monitor': 'settings',
            'admin-audit-monitor': 'settings',
            'tickets-pending': 'tickets',
            'tickets-resolved': 'tickets',
            'shop-inventory': 'shop',
            'shop-fulfillment': 'shop',
            'shop-risk-orders': 'shop',
            'shop-risk-discounts': 'discounts',
            'shop-risk-users': 'users'
        };
        return moduleMap[normalized] || '';
    }

    persistPendingOpsAlertWorkspace(workspaceKey = '', context = {}) {
        if (typeof window.savePendingOpsAlertWorkspace === 'function') {
            window.savePendingOpsAlertWorkspace(workspaceKey, context);
            return;
        }
        if (!workspaceKey || typeof window.localStorage === 'undefined') return;
        const payload = {
            workspaceKey: String(workspaceKey || '').trim(),
            context: context && typeof context === 'object' ? context : {},
            createdAt: new Date().toISOString()
        };
        window.localStorage.setItem('zaoyoe_pending_ops_alert_workspace', JSON.stringify(payload));
    }

    hasInlineAdminWorkbench() {
        return typeof window.switchModule === 'function'
            && Boolean(document.getElementById('adminSidebar'))
            && Boolean(document.querySelector('.admin-layout'));
    }

    getWorkbenchLauncher() {
        return this.hasInlineAdminWorkbench()
            ? (window.openAdminWorkbenchEntry || window.openOpsAlertWorkspace || null)
            : null;
    }

    async openWorkbenchEntry(workspaceKey, context = {}) {
        const launcher = this.getWorkbenchLauncher();
        if (typeof launcher !== 'function') {
            return false;
        }
        return launcher(workspaceKey, context);
    }

    openAdminStudioForOpsAlertWorkspace(workspace = {}) {
        const normalized = this.normalizeOpsAlertWorkspaceForAdminStudio(workspace);
        const moduleName = normalized.module || this.getAdminStudioModuleForOpsWorkspaceKey(normalized.workspaceKey);
        if (!moduleName && !normalized.workspaceKey) {
            this.showNotification('这条告警暂时没有可跳转的处理页', '📌 站内代办', true);
            return false;
        }

        if (normalized.workspaceKey) {
            this.persistPendingOpsAlertWorkspace(normalized.workspaceKey, normalized.context || {});
        }

        const targetUrl = new URL('admin-studio.html', window.location.origin);
        if (moduleName) {
            targetUrl.searchParams.set('module', moduleName);
        }
        if (normalized.workspaceKey) {
            targetUrl.searchParams.set('workbench', normalized.workspaceKey);
            try {
                targetUrl.searchParams.set('workbench_context', JSON.stringify(normalized.context || {}));
            } catch (_) {
                // Ignore context serialization failures and rely on localStorage fallback.
            }
        }

        const openedWindow = window.open(targetUrl.toString(), '_blank');
        if (openedWindow) {
            try {
                openedWindow.opener = null;
            } catch (_) {
                // Ignore browsers that disallow touching opener after launch.
            }
            return true;
        }

        this.showNotification('浏览器拦截了新窗口，请允许弹窗后重试', '💬 客服', true);
        return false;
    }

    async handleOpsAlertNavigation(alert = {}) {
        const workspace = alert.workspace || { kind: 'none' };
        const launcher = this.getWorkbenchLauncher();

        try {
            if (workspace.kind === 'chat-session') {
                const sessionId = String(
                    workspace.context?.sessionId
                    || workspace.context?.session_id
                    || workspace.context?.referenceValue
                    || ''
                ).trim();
                const matchingSession = this.sessions.find((session) => (
                    !this.isOpsAlertSession(session)
                    && (session.sessionIds || [session.id]).includes(sessionId)
                ));

                if (matchingSession) {
                    this.selectSession(matchingSession.id, matchingSession);
                    return true;
                }
            }

            if (workspace.kind === 'ops-workspace' && typeof launcher === 'function') {
                return await this.openWorkbenchEntry(workspace.workspaceKey, workspace.context || {});
            }

            if (workspace.kind === 'chat-session' && typeof launcher === 'function') {
                return await this.openWorkbenchEntry('chat-session', workspace.context || {});
            }

            return this.openAdminStudioForOpsAlertWorkspace(workspace);
        } catch (error) {
            console.error('[ChatWidget] Failed to open ops alert workspace:', error);
            this.showNotification(`打开处理页失败：${error.message || '未知错误'}`, '📌 站内代办', true);
            return false;
        }
    }

    async upsertOpsAlertMessage(row, options = {}) {
        const [normalized] = await this.attachOpsAlertCases([this.normalizeOpsAlertJob(row)]);
        if (!this.matchesCurrentSite({ site: normalized?.site || 'cn' }, 'cn')) {
            return;
        }
        const existingIndex = this.opsAlertMessages.findIndex((item) => item.id === normalized.id);

        if (existingIndex > -1) {
            this.opsAlertMessages.splice(existingIndex, 1, normalized);
        } else {
            this.opsAlertMessages.push(normalized);
        }

        this.opsAlertMessages.sort((left, right) => {
            const leftTime = left.sortTimestamp instanceof Date ? left.sortTimestamp.getTime() : 0;
            const rightTime = right.sortTimestamp instanceof Date ? right.sortTimestamp.getTime() : 0;
            return rightTime - leftTime;
        });

        const isViewingOpsSession = this.isOpen && this.currentSessionKey === this.opsAlertSessionId;
        if (!isViewingOpsSession && options.announce !== false) {
            this.unreadSessions.add(this.opsAlertSessionId);
            let showedEngagementBubble = false;
            try {
                showedEngagementBubble = this.showOpsAlertEngagementBubble(normalized, { realtime: true });
            } catch (engagementError) {
                console.warn('[ChatWidget] Failed to show realtime ops alert engagement bubble:', engagementError);
            }
            if (showedEngagementBubble && !this.isOpen) {
                this.refreshOpsAlertSessionEntry();
                return;
            }
            try {
                this.showNotification(normalized.title || normalized.preview || '收到新的站外告警', '📌 站内代办', true);
            } catch (notificationError) {
                console.warn('[ChatWidget] Failed to show realtime ops alert notification:', notificationError);
            }
        } else if (isViewingOpsSession) {
            this.clearSessionUnreadState(this.opsAlertSessionId, [this.opsAlertSessionId]);
        }

        this.refreshOpsAlertSessionEntry();

        if (isViewingOpsSession) {
            this.renderOpsAlertMessages();
        }
    }

    async loadAdminSessions() {
        const requestId = ++this._adminSessionLoadRequestId;
        try {
            // Get current admin user to exclude from list
            const { data: { user: currentUser } } = await this.supabase.auth.getUser();
            const adminUserId = currentUser?.id;
            this.currentAdminUserId = String(adminUserId || '').trim();

            // Get all messages grouped by session, including user_id for lookup
            const { data: messages, error } = await this.queryForCurrentSite(
                this.supabase
                    .from('chat_messages')
                    .select('session_id, created_at, content, is_admin, user_id, message_type'),
                this.getCurrentSite()
            )
                .order('created_at', { ascending: false });

            if (error) throw error;
            if (requestId !== this._adminSessionLoadRequestId) return;

            // Only use USER messages (not admin replies) for grouping sessions
            const userMessages = messages.filter(m => !m.is_admin);

            // Collect all user IDs from USER messages (for looking up guest sessions with logged-in users)
            const userIds = [...new Set(userMessages.filter(m => m.user_id).map(m => m.user_id))];
            const emailSessionIds = [...new Set(
                userMessages
                    .filter(m => !m.user_id && typeof m.session_id === 'string' && m.session_id.includes('@'))
                    .map(m => m.session_id.trim().toLowerCase())
                    .filter(Boolean)
            )];

            // Group USER messages by user_id (for logged-in users) or session_id (for pure guests)
            // This merges all sessions from the same user into one
            const userSessionMap = new Map(); // key: user_id or session_id, value: { lastMsg, sessionIds[] }
            const sessionIdToGroupKey = new Map();

            userMessages.forEach(msg => {
                // Determine the grouping key: prefer user_id for registered users
                const groupKey = msg.user_id || msg.session_id;

                // Skip admin's own messages (don't show admin as a chat session)
                if (groupKey === adminUserId) return;

                if (!userSessionMap.has(groupKey)) {
                    userSessionMap.set(groupKey, {
                        lastMsg: msg,
                        sessionIds: new Set([msg.session_id]),
                        userId: msg.user_id,
                        lastUserMessageAt: null,
                        lastAdminMessageAt: null
                    });
                } else {
                    // Add this session_id to the set (for loading all messages later)
                    userSessionMap.get(groupKey).sessionIds.add(msg.session_id);
                }

                sessionIdToGroupKey.set(msg.session_id, groupKey);
            });

            messages.forEach((msg) => {
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

            const buildSessionsFromProfileMaps = (userMapById = new Map(), userMapByEmail = new Map()) => Array.from(userSessionMap.entries()).map(([groupKey, data]) => {
                const msg = data.lastMsg;
                const normalizedGroupKey = typeof groupKey === 'string' ? groupKey.trim() : String(groupKey || '');
                const userInfo = data.userId
                    ? userMapById.get(data.userId)
                    : userMapByEmail.get(normalizedGroupKey.toLowerCase()) || null;
                const sessionIds = Array.from(data.sessionIds);
                const resolvedEmail = this.resolveSessionEmail(userInfo, normalizedGroupKey, sessionIds);

                // Determine display name: use username if available, else email username, else "访客" for guests
                const displayNickname = this.resolveSessionNickname(userInfo, normalizedGroupKey, resolvedEmail);

                return {
                    id: normalizedGroupKey, // Use user_id or session_id as the identifier
                    sessionIds, // All session_ids for this user (for message loading)
                    nickname: displayNickname,
                    email: resolvedEmail,
                    lastLogin: msg.created_at,
                    lastMessage: msg.message_type === 'image' ? this.t('chat.image', '[图片]') : msg.content,
                    lastTime: msg.created_at,
                    isAdmin: msg.is_admin,
                    userId: data.userId || String(userInfo?.id || '').trim(),
                    avatarUrl: userInfo?.avatar_url || null,
                    lastUserMessageAt: data.lastUserMessageAt || null,
                    lastAdminMessageAt: data.lastAdminMessageAt || null,
                    replySummary: this.buildSessionReplySummary(data.lastUserMessageAt, data.lastAdminMessageAt)
                };
            });

            const initialSessions = buildSessionsFromProfileMaps();
            this._adminSessionListBootstrapping = false;
            this.setAdminChatSessions(initialSessions);
            void this.refreshUserActivityForAdminSessions(initialSessions, { render: true });

            const [profilesById, profilesByEmail] = await Promise.all([
                userIds.length > 0 ? this.fetchChatProfiles('id', userIds) : Promise.resolve([]),
                emailSessionIds.length > 0 ? this.fetchChatProfiles('email', emailSessionIds) : Promise.resolve([])
            ]);
            if (requestId !== this._adminSessionLoadRequestId) return;

            const userMapById = new Map((Array.isArray(profilesById) ? profilesById : []).map((profile) => [profile.id, profile]));
            const userMapByEmail = new Map(
                (Array.isArray(profilesByEmail) ? profilesByEmail : [])
                    .filter((profile) => profile?.email)
                    .map((profile) => [String(profile.email || '').toLowerCase(), profile])
            );

            const profiledSessions = buildSessionsFromProfileMaps(userMapById, userMapByEmail);
            await this.refreshUserActivityForAdminSessions(profiledSessions, { render: false });
            this.setAdminChatSessions(profiledSessions);

            this.attachSessionTicketSummaries(profiledSessions)
                .then((enrichedSessions) => {
                    if (requestId !== this._adminSessionLoadRequestId) return;
                    this.setAdminChatSessions(enrichedSessions);
                })
                .catch((summaryError) => {
                    console.error('Failed to enrich admin sessions:', summaryError);
                });

            this.refreshOpsAlerts({ announceNew: false }).catch((opsError) => {
                console.error('Failed to load ops alert sessions:', opsError);
            });

        } catch (err) {
            console.error('Failed to load sessions:', err);
            if (requestId !== this._adminSessionLoadRequestId) return;
            this._adminSessionListBootstrapping = false;
            this.sessionList.innerHTML = `<div class="session-loading">${this.t('chat.loadFailed', '加载失败')}</div>`;
        }
    }

    getAdminSessionHydrationEmailKey(session = {}) {
        const email = String(session?.email || '').trim().toLowerCase();
        if (email) return email;
        const emailSessionId = (Array.isArray(session?.sessionIds) ? session.sessionIds : [])
            .map((value) => String(value || '').trim().toLowerCase())
            .find((value) => value.includes('@'));
        return emailSessionId || '';
    }

    scheduleAdminSessionHydration({ userIds = [], emails = [] } = {}) {
        (Array.isArray(userIds) ? userIds : []).forEach((value) => {
            const normalized = String(value || '').trim();
            if (normalized) this._pendingAdminSessionHydrationUserIds.add(normalized);
        });
        (Array.isArray(emails) ? emails : []).forEach((value) => {
            const normalized = String(value || '').trim().toLowerCase();
            if (normalized) this._pendingAdminSessionHydrationEmails.add(normalized);
        });

        if (!this._pendingAdminSessionHydrationUserIds.size && !this._pendingAdminSessionHydrationEmails.size) {
            return;
        }

        if (this._adminSessionHydrationTimer) {
            clearTimeout(this._adminSessionHydrationTimer);
        }

        this._adminSessionHydrationTimer = setTimeout(() => {
            this._adminSessionHydrationTimer = null;
            this.flushAdminSessionHydration();
        }, 180);
    }

    async flushAdminSessionHydration() {
        const userIds = [...this._pendingAdminSessionHydrationUserIds];
        const emails = [...this._pendingAdminSessionHydrationEmails];
        this._pendingAdminSessionHydrationUserIds.clear();
        this._pendingAdminSessionHydrationEmails.clear();

        if (!userIds.length && !emails.length) {
            return;
        }

        const requestId = ++this._adminSessionHydrationRequestId;
        const chatSessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => !this.isOpsAlertSession(session));

        const [profilesById, profilesByEmail] = await Promise.all([
            userIds.length > 0 ? this.fetchChatProfiles('id', userIds) : Promise.resolve([]),
            emails.length > 0 ? this.fetchChatProfiles('email', emails) : Promise.resolve([])
        ]);
        if (requestId !== this._adminSessionHydrationRequestId) return;

        const userMapById = new Map((Array.isArray(profilesById) ? profilesById : []).map((profile) => [profile.id, profile]));
        const userMapByEmail = new Map(
            (Array.isArray(profilesByEmail) ? profilesByEmail : [])
                .filter((profile) => profile?.email)
                .map((profile) => [String(profile.email || '').toLowerCase(), profile])
        );

        const nextChatSessions = chatSessions.map((session) => {
            const normalizedUserId = String(session?.userId || '').trim();
            const emailKey = this.getAdminSessionHydrationEmailKey(session);
            const shouldHydrate = (normalizedUserId && userIds.includes(normalizedUserId))
                || (emailKey && emails.includes(emailKey));
            if (!shouldHydrate) {
                return session;
            }

            const profile = normalizedUserId
                ? userMapById.get(normalizedUserId)
                : (emailKey ? userMapByEmail.get(emailKey) : null);
            const sessionIds = Array.isArray(session?.sessionIds) ? session.sessionIds : [session?.id];
            const resolvedEmail = this.resolveSessionEmail(profile, session.email || session.id, sessionIds);

            return {
                ...session,
                userId: normalizedUserId || String(profile?.id || '').trim(),
                email: resolvedEmail || session.email,
                nickname: this.resolveSessionNickname(profile, session.id || '', resolvedEmail || session.email || ''),
                avatarUrl: profile?.avatar_url || session.avatarUrl || ''
            };
        });

        await this.refreshUserActivityForAdminSessions(nextChatSessions, { render: false });
        this.setAdminChatSessions(nextChatSessions);
        if (userIds.length > 0) {
            await this.refreshAdminSessionTicketSummariesForUserIds(userIds);
        }
        if (this.currentSessionKey) {
            const nextCurrentSession = this.sessions.find((session) => session.id === this.currentSessionKey) || null;
            if (nextCurrentSession) {
                this.currentSessionInfo = nextCurrentSession;
                this.currentSessionIds = Array.isArray(nextCurrentSession.sessionIds) && nextCurrentSession.sessionIds.length
                    ? [...nextCurrentSession.sessionIds]
                    : [nextCurrentSession.id];
            }
        }
    }

    applyIncomingAdminUserMessage(message = {}) {
        const normalizedSessionId = String(message?.session_id || '').trim();
        const normalizedCreatedAt = String(message?.created_at || new Date().toISOString()).trim();
        const normalizedUserId = String(message?.user_id || '').trim();
        const normalizedContent = String(message?.content || '').trim();
        const normalizedMessageType = String(message?.message_type || 'text').trim() || 'text';

        if (!normalizedSessionId || !normalizedCreatedAt) {
            return false;
        }

        if (normalizedUserId && normalizedUserId === this.currentAdminUserId) {
            return false;
        }

        const chatSessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => !this.isOpsAlertSession(session));
        const fallbackEmail = normalizedSessionId.includes('@') ? normalizedSessionId : '';
        let touched = false;
        const nextChatSessions = chatSessions.map((session) => {
            const sessionIds = Array.isArray(session?.sessionIds) && session.sessionIds.length
                ? session.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
                : [String(session?.id || '').trim()].filter(Boolean);
            const normalizedSessionUserId = String(session?.userId || '').trim();
            const isTargetSession = session.id === normalizedSessionId
                || sessionIds.includes(normalizedSessionId)
                || (normalizedUserId && normalizedSessionUserId === normalizedUserId);
            if (!isTargetSession) {
                return session;
            }

            touched = true;
            const nextSessionIds = [...new Set([...sessionIds, normalizedSessionId])];
            return {
                ...session,
                sessionIds: nextSessionIds,
                userId: normalizedSessionUserId || normalizedUserId,
                email: session.email || fallbackEmail,
                lastLogin: normalizedCreatedAt,
                lastTime: normalizedCreatedAt,
                lastMessage: normalizedMessageType === 'image'
                    ? this.t('chat.image', '[图片]')
                    : (normalizedContent || session.lastMessage),
                lastUserMessageAt: normalizedCreatedAt,
                replySummary: this.buildSessionReplySummary(normalizedCreatedAt, session.lastAdminMessageAt)
            };
        });

        if (!touched) {
            nextChatSessions.push({
                id: normalizedUserId || normalizedSessionId,
                sessionIds: [normalizedSessionId],
                nickname: normalizedUserId ? '已登录用户' : this.resolveSessionNickname(null, normalizedSessionId, fallbackEmail),
                email: fallbackEmail,
                lastLogin: normalizedCreatedAt,
                lastMessage: normalizedMessageType === 'image' ? this.t('chat.image', '[图片]') : normalizedContent,
                lastTime: normalizedCreatedAt,
                isAdmin: false,
                userId: normalizedUserId,
                avatarUrl: '',
                lastUserMessageAt: normalizedCreatedAt,
                lastAdminMessageAt: '',
                replySummary: this.buildSessionReplySummary(normalizedCreatedAt, '')
            });
        }

        this.setAdminChatSessions(nextChatSessions);
        this.scheduleAdminSessionHydration({
            userIds: normalizedUserId ? [normalizedUserId] : [],
            emails: !normalizedUserId && fallbackEmail ? [fallbackEmail.toLowerCase()] : []
        });
        if (this.currentSessionKey) {
            const nextCurrentSession = this.sessions.find((session) => session.id === this.currentSessionKey) || null;
            if (nextCurrentSession) {
                this.currentSessionInfo = nextCurrentSession;
                this.currentSessionIds = Array.isArray(nextCurrentSession.sessionIds) && nextCurrentSession.sessionIds.length
                    ? [...nextCurrentSession.sessionIds]
                    : [nextCurrentSession.id];
            }
        }
        return true;
    }

    formatTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) return '';
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return this.t('chat.justNow', '刚刚');
        if (diffMins < 60) return this.t('chat.minutesAgo', '{minutes}分钟前').replace('{minutes}', diffMins);

        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return this.t('chat.hoursAgo', '{hours}小时前').replace('{hours}', diffHours);

        const isEnglish = window.i18n && window.i18n.isEnglish && window.i18n.isEnglish();
        return date.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' });
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
                .eq('site', this.getCurrentSite())
                .order('created_at', { ascending: false });

            if (error) throw error;
            return this.buildSessionTicketSummaryMap(data || []);
        } catch (error) {
            console.warn('[ChatWidget] Failed to fetch session ticket summaries:', error);
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
                .eq('site', this.getCurrentSite())
                .order('created_at', { ascending: false });

            if (error) throw error;
            return this.buildSessionLatestRecordMap(data || []);
        } catch (error) {
            console.warn('[ChatWidget] Failed to fetch session payment summaries:', error);
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
                .eq('site', this.getCurrentSite())
                .order('created_at', { ascending: false });

            if (error) throw error;
            return this.buildSessionLatestRecordMap(data || []);
        } catch (error) {
            console.warn('[ChatWidget] Failed to fetch session verification summaries:', error);
            return new Map();
        }
    }

    getAdminSessionPaymentSignal(summary = null) {
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
            this.showNotification('未找到可标记的待支付记录', '💬 客服', true);
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

        const opsSession = (Array.isArray(this.sessions) ? this.sessions : []).find((session) => this.isOpsAlertSession(session)) || null;
        const chatSessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => !this.isOpsAlertSession(session))
            .map((session) => {
                const paymentSummary = session.paymentSummary && typeof session.paymentSummary === 'object'
                    ? updatePayment(session.paymentSummary)
                    : session.paymentSummary;
                return paymentSummary === session.paymentSummary ? session : { ...session, paymentSummary };
            });
        this.sessions = opsSession
            ? [opsSession, ...this.sortAdminSessions(chatSessions)]
            : this.sortAdminSessions(chatSessions);
        this.renderAdminSessionList();
        this.showNotification('已将这笔待支付标记为已读', '💬 客服', true);
        return true;
    }

    getAdminSessionVerificationSignal(summary = null) {
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

    getAdminSessionPrioritySignals(session = {}) {
        const signals = [];
        const ticketBadge = this.getAdminSessionTicketBadge(session.ticketSummary);
        const ticketSubtext = this.getAdminSessionTicketSubtext(session.ticketSummary);
        if (ticketBadge) {
            signals.push({
                key: 'ticket',
                label: ticketBadge,
                subtext: ticketSubtext,
                score: 100 + Number(session?.ticketSummary?.openCount || 0),
                badgeClass: 'session-badge--ticket'
            });
        }

        const verificationSignal = this.getAdminSessionVerificationSignal(session.verificationSummary);
        if (verificationSignal) {
            signals.push(verificationSignal);
        }

        const paymentSignal = this.getAdminSessionPaymentSignal(session.paymentSummary);
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

    sortAdminSessions(sessions = []) {
        return [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => {
            const priorityDiff = this.getAdminSessionPrioritySignals(right)
                .reduce((maxScore, signal) => Math.max(maxScore, Number(signal?.score || 0)), 0)
                - this.getAdminSessionPrioritySignals(left)
                    .reduce((maxScore, signal) => Math.max(maxScore, Number(signal?.score || 0)), 0);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }

            const leftTime = Date.parse(left?.lastTime || left?.lastLogin || 0);
            const rightTime = Date.parse(right?.lastTime || right?.lastLogin || 0);
            return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        });
    }

    async attachSessionTicketSummaries(sessions = []) {
        const userIds = (Array.isArray(sessions) ? sessions : []).map((session) => session?.userId);
        const [ticketSummaryMap, paymentSummaryMap, verificationSummaryMap] = await Promise.all([
            this.fetchSessionTicketSummaryMap(userIds),
            this.fetchSessionPaymentSummaryMap(userIds),
            this.fetchSessionVerificationSummaryMap(userIds)
        ]);

        return this.sortAdminSessions((Array.isArray(sessions) ? sessions : []).map((session) => {
            const userId = String(session?.userId || '').trim();
            return {
                ...session,
                ticketSummary: userId ? (ticketSummaryMap.get(userId) || null) : null,
                paymentSummary: userId ? (paymentSummaryMap.get(userId) || null) : null,
                verificationSummary: userId ? (verificationSummaryMap.get(userId) || null) : null
            };
        }));
    }

    async refreshAdminSessionTicketSummariesForUserIds(userIds = []) {
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
        const opsSession = (Array.isArray(this.sessions) ? this.sessions : []).find((session) => this.isOpsAlertSession(session)) || null;
        const chatSessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => !this.isOpsAlertSession(session))
            .map((session) => {
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

        this.sessions = opsSession
            ? [opsSession, ...this.sortAdminSessions(chatSessions)]
            : this.sortAdminSessions(chatSessions);
        this.renderAdminSessionList();
    }

    getAdminSessionTicketBadge(summary = null) {
        const openCount = Number(summary?.openCount || 0);
        if (!Number.isFinite(openCount) || openCount <= 0) return '';
        return openCount > 1 ? `${openCount}工单` : '工单中';
    }

    getAdminSessionTicketSubtext(summary = null) {
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

    upsertAdminMessageCacheEntry(message = {}) {
        const normalizedSessionId = String(message?.session_id || '').trim();
        const normalizedCreatedAt = String(message?.created_at || '').trim();
        if (!normalizedSessionId || !normalizedCreatedAt || !(this.sessionMessagesCache instanceof Map)) {
            return;
        }

        for (const [cacheKey, cachedMessages] of this.sessionMessagesCache.entries()) {
            const cacheSessionIds = String(cacheKey || '')
                .split('|')
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            if (!cacheSessionIds.includes(normalizedSessionId) || !Array.isArray(cachedMessages)) {
                continue;
            }

            const alreadyExists = cachedMessages.some((item) => (
                String(item?.session_id || '').trim() === normalizedSessionId
                && String(item?.created_at || '').trim() === normalizedCreatedAt
                && String(item?.content || '') === String(message.content || '')
                && String(item?.message_type || 'text') === String(message.message_type || 'text')
                && Boolean(item?.is_admin) === Boolean(message.is_admin)
            ));
            if (alreadyExists) {
                continue;
            }

            const nextMessages = [...cachedMessages, {
                session_id: normalizedSessionId,
                content: message.content,
                is_admin: Boolean(message.is_admin),
                message_type: String(message.message_type || 'text'),
                created_at: normalizedCreatedAt
            }].sort((left, right) => Date.parse(left?.created_at || 0) - Date.parse(right?.created_at || 0));
            this.sessionMessagesCache.set(cacheKey, nextMessages);
        }
    }

    applyAdminReplySessionUpdate(sessionId = '', message = {}) {
        const normalizedSessionId = String(sessionId || '').trim();
        const normalizedCreatedAt = String(message?.created_at || new Date().toISOString()).trim();
        if (!normalizedSessionId || !Array.isArray(this.sessions) || !this.sessions.length) {
            return;
        }

        this.upsertAdminMessageCacheEntry({
            session_id: normalizedSessionId,
            content: message?.content || '',
            is_admin: true,
            message_type: String(message?.message_type || 'text'),
            created_at: normalizedCreatedAt
        });

        let touched = false;
        const chatSessions = this.sessions
            .filter((session) => !this.isOpsAlertSession(session))
            .map((session) => {
                const sessionIds = Array.isArray(session?.sessionIds) && session.sessionIds.length
                    ? session.sessionIds.map((value) => String(value || '').trim()).filter(Boolean)
                    : [String(session?.id || '').trim()].filter(Boolean);
                const isTargetSession = session.id === normalizedSessionId
                    || sessionIds.includes(normalizedSessionId);
                if (!isTargetSession) {
                    return session;
                }

                touched = true;
                return {
                    ...session,
                    lastTime: normalizedCreatedAt,
                    lastMessage: String(message?.message_type || 'text') === 'image'
                        ? this.t('chat.image', '[图片]')
                        : String(message?.content || '').trim() || session.lastMessage,
                    lastAdminMessageAt: normalizedCreatedAt,
                    replySummary: this.buildSessionReplySummary(session.lastUserMessageAt, normalizedCreatedAt)
                };
            });

        if (!touched) {
            return;
        }

        this.setAdminChatSessions(chatSessions);
        if (this.currentSessionKey) {
            const nextCurrentSession = this.sessions.find((session) => session.id === this.currentSessionKey) || null;
            if (nextCurrentSession) {
                this.currentSessionInfo = nextCurrentSession;
                this.currentSessionIds = Array.isArray(nextCurrentSession.sessionIds) && nextCurrentSession.sessionIds.length
                    ? [...nextCurrentSession.sessionIds]
                    : [nextCurrentSession.id];
            }
        }
    }

    refreshAdminSessionReplySummaries() {
        const opsSession = (Array.isArray(this.sessions) ? this.sessions : []).find((session) => this.isOpsAlertSession(session)) || null;
        const chatSessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => !this.isOpsAlertSession(session))
            .map((session) => ({
                ...session,
                replySummary: this.buildSessionReplySummary(session.lastUserMessageAt, session.lastAdminMessageAt)
            }));

        this.sessions = opsSession
            ? [opsSession, ...this.sortAdminSessions(chatSessions)]
            : this.sortAdminSessions(chatSessions);
        this.renderAdminSessionList();
    }

    startAdminSessionSlaTicker() {
        if (this.adminSessionSlaTimer) {
            return;
        }

        this.adminSessionSlaTimer = window.setInterval(() => {
            this.refreshAdminSessionReplySummaries();
        }, 60000);
    }

    getAdminSessionFilterOptions() {
        const sessions = (Array.isArray(this.sessions) ? this.sessions : []).filter((session) => !this.isOpsAlertSession(session));
        return [
            { value: 'all', label: '全部', count: sessions.length },
            { value: 'reply', label: '待回复', count: sessions.filter((session) => session.replySummary?.pending).length },
            { value: 'stale_reply', label: '久未回复', count: sessions.filter((session) => Number(session.replySummary?.waitMinutes || 0) >= 60).length },
            { value: 'ticket', label: '工单中', count: sessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length },
            { value: 'verification', label: '验证异常', count: sessions.filter((session) => Boolean(this.getAdminSessionVerificationSignal(session.verificationSummary))).length }
        ];
    }

    isHighPriorityAdminSession(session = {}) {
        const maxScore = this.getAdminSessionPrioritySignals(session)
            .reduce((score, signal) => Math.max(score, Number(signal?.score || 0)), 0);
        return maxScore >= 45;
    }

    getAdminSessionOverviewCards() {
        const sessions = (Array.isArray(this.sessions) ? this.sessions : []).filter((session) => !this.isOpsAlertSession(session));
        return [
            { value: 'all', label: '全部会话', count: sessions.length, hint: '当前队列' },
            { value: 'reply', label: '待回复', count: sessions.filter((session) => session.replySummary?.pending).length, hint: '需要跟进' },
            { value: 'stale_reply', label: '久未回复', count: sessions.filter((session) => Number(session.replySummary?.waitMinutes || 0) >= 60).length, hint: '优先处理' },
            { value: 'ticket', label: '工单中', count: sessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length, hint: '售后处理中' },
            { value: 'verification', label: '验证异常', count: sessions.filter((session) => Boolean(this.getAdminSessionVerificationSignal(session.verificationSummary))).length, hint: '需要排查' }
        ];
    }

    renderAdminSessionOverview() {
        const container = this.sessionQueueOverview;
        if (!container) return;

        const cards = this.getAdminSessionOverviewCards();
        container.replaceChildren();

        cards.forEach((card) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `session-queue-card${this.adminSessionQueueView === 'all' && this.adminSessionQueueFilter === card.value ? ' is-active' : ''}`;
            button.setAttribute('data-session-stat-filter', card.value);
            button.innerHTML = `
                <span class="session-queue-card__value">${card.count}</span>
                <span class="session-queue-card__label">${card.label}</span>
                <span class="session-queue-card__hint">${card.hint}</span>
            `;
            container.appendChild(button);
        });
    }

    getAdminSessionViewOptions() {
        const sessions = (Array.isArray(this.sessions) ? this.sessions : []).filter((session) => !this.isOpsAlertSession(session));
        return [
            { value: 'all', label: '全部视图', count: sessions.length },
            { value: 'priority', label: '高优先', count: sessions.filter((session) => this.isHighPriorityAdminSession(session)).length },
            { value: 'ticket_followup', label: '售后值守', count: sessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length },
            {
                value: 'payment_verify',
                label: '支付/验证',
                count: sessions.filter((session) => Boolean(
                    this.getAdminSessionPaymentSignal(session.paymentSummary)
                    || this.getAdminSessionVerificationSignal(session.verificationSummary)
                )).length
            }
        ];
    }

    buildAdminSessionQueueSnapshot({ view = 'all', filter = 'all' } = {}) {
        const normalizedView = this.normalizeAdminSessionQueueView(view);
        const normalizedFilter = this.normalizeAdminSessionQueueFilter(filter);
        const sessions = (Array.isArray(this.sessions) ? this.sessions : [])
            .filter((session) => this.matchesAdminSessionQueueViewMode(session, normalizedView))
            .filter((session) => this.matchesAdminSessionQueueFilterMode(session, normalizedFilter, normalizedView));
        const chatSessions = sessions.filter((session) => !this.isOpsAlertSession(session));

        const pendingReply = chatSessions.filter((session) => session.replySummary?.pending).length;
        const staleReply = chatSessions.filter((session) => Number(session.replySummary?.waitMinutes || 0) >= 60).length;
        const highPriority = chatSessions.filter((session) => this.isHighPriorityAdminSession(session)).length;
        const openTickets = chatSessions.filter((session) => Boolean(session.ticketSummary?.latestOpenTicket)).length;
        const verificationAlerts = chatSessions.filter((session) => Boolean(this.getAdminSessionVerificationSignal(session.verificationSummary))).length;
        const paymentFollowups = chatSessions.filter((session) => Boolean(this.getAdminSessionPaymentSignal(session.paymentSummary))).length;
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

    getAdminSessionQueueSnapshot() {
        return this.buildAdminSessionQueueSnapshot({
            view: this.adminSessionQueueView,
            filter: this.adminSessionQueueFilter
        });
    }

    getAdminSessionQueueBacklogSnapshot() {
        return this.buildAdminSessionQueueSnapshot({
            view: 'all',
            filter: 'all'
        });
    }

    getAdminSessionQueueCapacityAlerts(snapshot = {}) {
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

    getAdminSessionQueuePriorityItems(snapshot = {}) {
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

    getAdminSessionQueueRecommendedMode(snapshot = {}) {
        const specializedLoad = Number(snapshot.specializedLoad || 0);
        const defaultView = this.normalizeAdminSessionQueueView(this.adminSessionQueueDefaultView || 'all');
        const defaultFilter = this.normalizeAdminSessionQueueFilter(this.adminSessionQueueDefaultFilter || 'all');

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
                reason: '验证异常更集中，适合先切到验证异常视图集中排查。'
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

    getAdminSessionQueueCoordinationAdvice(snapshot = {}) {
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

    getAdminSessionQueueDutyAdvice(snapshot = null) {
        const backlogSnapshot = snapshot || this.getAdminSessionQueueBacklogSnapshot();
        const recommendedMode = this.getAdminSessionQueueRecommendedMode(backlogSnapshot);
        const priorityItems = this.getAdminSessionQueuePriorityItems(backlogSnapshot);
        const coordination = this.getAdminSessionQueueCoordinationAdvice(backlogSnapshot);
        const recommendedLabel = this.formatAdminSessionQueueModeLabel(recommendedMode.view, recommendedMode.filter);
        const isCurrentModeRecommended = this.normalizeAdminSessionQueueView(this.adminSessionQueueView) === recommendedMode.view
            && this.normalizeAdminSessionQueueFilter(this.adminSessionQueueFilter) === recommendedMode.filter;

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

    renderAdminSessionQueueSnapshot() {
        const container = this.chatWindow?.querySelector('#sessionQueueSnapshot');
        if (!container) return;

        const snapshot = this.getAdminSessionQueueBacklogSnapshot();
        const capacityAlerts = this.getAdminSessionQueueCapacityAlerts(snapshot);
        const dutyAdvice = this.getAdminSessionQueueDutyAdvice(snapshot);
        const currentMode = this.formatAdminSessionQueueModeLabel(this.adminSessionQueueView, this.adminSessionQueueFilter);
        const defaultMode = this.formatAdminSessionQueueModeLabel(this.adminSessionQueueDefaultView, this.adminSessionQueueDefaultFilter);
        const isDefaultMode = this.isAdminSessionQueueUsingDefaultView();
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

    renderAdminSessionViews() {
        const container = this.sessionQueueViews;
        if (!container) return;

        const options = this.getAdminSessionViewOptions();
        container.replaceChildren();

        options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `session-queue-preset${this.adminSessionQueueView === option.value ? ' is-active' : ''}`;
            button.setAttribute('data-session-view', option.value);
            button.textContent = option.count > 0 ? `${option.label} ${option.count}` : option.label;
            container.appendChild(button);
        });
    }

    renderAdminSessionQueueControls() {
        const backlogSnapshot = this.getAdminSessionQueueBacklogSnapshot();
        this.renderAdminSessionOverview();
        this.renderAdminSessionQueueSnapshot();
        this.renderAdminSessionViews();
        this.renderAdminSessionFilters();
        this.updateAdminSidebarInsightsShell(backlogSnapshot);
    }

    renderAdminSessionFilters() {
        const container = this.sessionFilterBar;
        if (!container) return;

        const options = this.getAdminSessionFilterOptions();
        container.replaceChildren();

        options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `session-filter-btn${this.adminSessionQueueFilter === option.value ? ' is-active' : ''}`;
            button.setAttribute('data-session-filter', option.value);
            button.textContent = option.count > 0 ? `${option.label} ${option.count}` : option.label;
            container.appendChild(button);
        });
    }

    setAdminSessionQueueView(value = 'all', { resetFilter = true } = {}) {
        const nextValue = this.normalizeAdminSessionQueueView(value);
        this.adminSessionQueueView = nextValue;
        if (resetFilter) {
            this.adminSessionQueueFilter = 'all';
        }
        this.persistAdminSessionQueuePreferences();
        this.renderAdminSessionQueueControls();
        this.renderAdminSessionList();
    }

    setAdminSessionQueueFilter(value = 'all') {
        const nextValue = this.normalizeAdminSessionQueueFilter(value);
        this.adminSessionQueueFilter = nextValue;
        this.persistAdminSessionQueuePreferences();
        this.renderAdminSessionQueueControls();
        this.renderAdminSessionList();
    }

    matchesAdminSessionQueueView(session = {}) {
        return this.matchesAdminSessionQueueViewMode(session, this.adminSessionQueueView);
    }

    matchesAdminSessionQueueViewMode(session = {}, view = 'all') {
        const normalizedView = this.normalizeAdminSessionQueueView(view);
        if (this.isOpsAlertSession(session)) {
            return normalizedView === 'all';
        }

        switch (normalizedView) {
            case 'priority':
                return this.isHighPriorityAdminSession(session);
            case 'ticket_followup':
                return Boolean(session.ticketSummary?.latestOpenTicket);
            case 'payment_verify':
                return Boolean(
                    this.getAdminSessionPaymentSignal(session.paymentSummary)
                    || this.getAdminSessionVerificationSignal(session.verificationSummary)
                );
            case 'all':
            default:
                return true;
        }
    }

    matchesAdminSessionQueueFilter(session = {}) {
        return this.matchesAdminSessionQueueFilterMode(session, this.adminSessionQueueFilter, this.adminSessionQueueView);
    }

    matchesAdminSessionQueueFilterMode(session = {}, filter = 'all', view = 'all') {
        const normalizedFilter = this.normalizeAdminSessionQueueFilter(filter);
        const normalizedView = this.normalizeAdminSessionQueueView(view);
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
                return Boolean(this.getAdminSessionVerificationSignal(session.verificationSummary));
            case 'all':
            default:
                return true;
        }
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
        const container = this.chatHeader?.querySelector('#chatUserStatusChips');
        if (!container) return;

        container.replaceChildren();

        const items = context ? this.getUserContextHeaderStatusItems(context) : [];
        if (!items.length) {
            container.hidden = true;
            this.syncUserContextInlineTrigger();
            this.scheduleAdminFloatingPanelOffsetSync();
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
        this.syncUserContextInlineTrigger();
        this.scheduleAdminFloatingPanelOffsetSync();
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
        const nextCollapsed = Boolean(collapsed);
        this.userContextPanelCollapsed = nextCollapsed;

        if (!nextCollapsed) {
            this.replyTemplateBarCollapsed = true;
            this.opsAlertToolbarCollapsed = true;
        }

        const shell = this.userContextPanel?.querySelector('.user-context-shell');
        const toggle = this.userContextPanel?.querySelector('#userContextPanelToggle');
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

        this.syncReplyTemplateBarCollapsedState();
        this.syncUserContextInlineTrigger();
        this.syncUserContextPanelVisibility();
        if (!nextCollapsed && this.userContextPanel) {
            const panelKind = String(this.userContextPanel.dataset.panelKind || '').trim();
            if (['context', 'state'].includes(panelKind)) {
                this.userContextPanel.hidden = false;
                this.userContextPanel.closest('.admin-chat-area')?.classList.add('has-user-context');
            }
        }
        this.scheduleAdminFloatingPanelOffsetSync();
    }

    setReplyTemplateBarCollapsed(collapsed = false) {
        const nextCollapsed = Boolean(collapsed);
        this.replyTemplateBarCollapsed = nextCollapsed;
        if (!nextCollapsed) {
            this.userContextPanelCollapsed = true;
            this.opsAlertToolbarCollapsed = true;
        }
        this.syncReplyTemplateBarCollapsedState();
        this.syncUserContextInlineTrigger();
        this.syncUserContextPanelVisibility();
        this.syncReplyTemplateBarCollapsedState();
        if (!nextCollapsed && this.replyTemplateBar) {
            this.userContextPanel?.closest('.admin-chat-area')?.classList.remove('has-user-context');
            if (this.userContextPanel) {
                this.userContextPanel.hidden = true;
            }
            this.replyTemplateBar.hidden = false;
            this.replyTemplateBar.classList.remove('is-collapsed');
            this.replyTemplateBar.closest('.admin-chat-area')?.classList.add('has-reply-templates');
        }
        this.scheduleAdminFloatingPanelOffsetSync();
    }

    setOpsAlertToolbarCollapsed(collapsed = false) {
        const nextCollapsed = Boolean(collapsed);
        this.opsAlertToolbarCollapsed = nextCollapsed;
        if (!nextCollapsed) {
            this.userContextPanelCollapsed = true;
            this.replyTemplateBarCollapsed = true;
        }
        this.syncReplyTemplateBarCollapsedState();
        this.renderOpsAlertToolbarPanel();
        this.syncUserContextInlineTrigger();
        this.scheduleAdminFloatingPanelOffsetSync();
    }

    isOpsAlertSessionSelected() {
        return String(this.currentSessionKey || '').trim() === this.opsAlertSessionId;
    }

    getHeaderReplyTemplateCount() {
        return Number(this.replyTemplateBar?.dataset?.templateCount || 0) || 0;
    }

    buildHeaderActionButton({
        className = '',
        label = '',
        count = 0,
        icon = 'fa-chevron-down',
        active = false,
        onClick = null,
        ariaLabel = ''
    } = {}) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        if (active) {
            button.classList.add('is-active');
        }
        button.setAttribute('aria-label', ariaLabel || label);
        button.setAttribute('aria-expanded', active ? 'true' : 'false');
        if (typeof onClick === 'function') {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            });
        }

        if (className.includes('chat-reply-templates__toggle')) {
            button.innerHTML = `
                <span class="chat-reply-templates__toggle-copy">
                    <span class="chat-reply-templates__toggle-label">${this.escapeHtml(label)}</span>
                    ${count > 0 ? `<span class="chat-reply-templates__toggle-count">${this.formatCompactCount(count)}</span>` : ''}
                </span>
                <span class="chat-reply-templates__toggle-text">展开</span>
                <i class="fas ${this.escapeHtml(icon)}" aria-hidden="true"></i>
            `;
            return button;
        }

        if (className.includes('ops-alert-toolbar-trigger')) {
            button.innerHTML = `
                <span>${this.escapeHtml(label)}</span>
                ${count > 0 ? `<span class="ops-alert-toolbar-trigger__count">${this.formatCompactCount(count)}</span>` : ''}
                <i class="fas ${this.escapeHtml(icon)}" aria-hidden="true"></i>
            `;
            return button;
        }

        button.innerHTML = `
            <span class="chat-user-context-inline-trigger__label">${this.escapeHtml(label)}</span>
            <i class="fas ${this.escapeHtml(icon)}" aria-hidden="true"></i>
        `;
        return button;
    }

    getOpsAlertToolbarTriggerCount() {
        if (!this.isOpsAlertSessionSelected()) {
            return 0;
        }

        const nonDefaultFilterCount = [
            this.opsAlertViewFilter !== 'active',
            this.opsAlertOwnerFilter !== 'all',
            this.opsAlertReadCategoryFilter !== 'all',
            this.opsAlertReadTimeFilter !== 'visible'
        ].filter(Boolean).length;

        return nonDefaultFilterCount || this.getOpsAlertReadTargetAlerts().length;
    }

    syncChatUserMetaRowVisibility() {
        const metaRow = this.chatHeader?.querySelector('#chatUserMetaRow');
        if (!metaRow) return;

        const status = metaRow.querySelector('.user-status-indicator');
        const actions = metaRow.querySelector('#adminChatHeaderActions');
        const hasStatus = Boolean(status && !status.hidden && String(status.textContent || '').trim());
        const hasActions = Boolean(actions && !actions.hidden && actions.childElementCount > 0);
        metaRow.hidden = !(hasStatus || hasActions);
    }

    syncReplyTemplateBarCollapsedState() {
        const bar = this.replyTemplateBar;
        if (!bar) return;

        const chatArea = bar.closest('.admin-chat-area');
        const templateCount = Number(bar.dataset.templateCount || 0) || 0;
        const hasTemplates = templateCount > 0;
        const expanded = hasTemplates && this.replyTemplateBarCollapsed === false;

        bar.classList.toggle('is-collapsed', hasTemplates && !expanded);
        bar.hidden = !expanded;
        chatArea?.classList.toggle('has-reply-templates', expanded);
    }

    syncUserContextInlineTrigger() {
        const actionsContainer = this.chatHeader?.querySelector('#adminChatHeaderActions');
        if (!actionsContainer) {
            return;
        }

        actionsContainer.replaceChildren();

        if (this.isOpsAlertSessionSelected()) {
            if (!this.isNarrowAdminMode()) {
                actionsContainer.hidden = true;
                this.syncChatUserMetaRowVisibility();
                return;
            }
            actionsContainer.appendChild(this.buildHeaderActionButton({
                className: 'ops-alert-toolbar-trigger',
                label: '筛选',
                count: this.getOpsAlertToolbarTriggerCount(),
                icon: this.opsAlertToolbarCollapsed ? 'fa-sliders' : 'fa-xmark',
                active: !this.opsAlertToolbarCollapsed,
                ariaLabel: '展开站内代办筛选',
                onClick: () => {
                    this.setOpsAlertToolbarCollapsed(!this.opsAlertToolbarCollapsed);
                }
            }));
            actionsContainer.hidden = false;
            this.syncChatUserMetaRowVisibility();
            return;
        }

        if (!this.currentSessionInfo || this.isOpsAlertSession(this.currentSessionInfo)) {
            actionsContainer.hidden = true;
            this.syncChatUserMetaRowVisibility();
            return;
        }

        actionsContainer.appendChild(this.buildHeaderActionButton({
            className: 'chat-user-context-inline-trigger',
            label: '用户 360',
            icon: this.userContextPanelCollapsed ? 'fa-chevron-down' : 'fa-chevron-up',
            active: !this.userContextPanelCollapsed,
            ariaLabel: '展开用户 360',
            onClick: () => {
                this.setUserContextPanelCollapsed(!this.userContextPanelCollapsed);
            }
        }));

        const replyCount = this.getHeaderReplyTemplateCount();
        if (replyCount > 0 && !this.input?.disabled) {
            actionsContainer.appendChild(this.buildHeaderActionButton({
                className: 'chat-reply-templates__toggle',
                label: '快捷回复',
                count: replyCount,
                icon: this.replyTemplateBarCollapsed ? 'fa-chevron-down' : 'fa-chevron-up',
                active: !this.replyTemplateBarCollapsed,
                ariaLabel: '展开快捷回复',
                onClick: () => {
                    this.setReplyTemplateBarCollapsed(!this.replyTemplateBarCollapsed);
                }
            }));
        }

        actionsContainer.hidden = actionsContainer.childElementCount === 0;
        this.syncChatUserMetaRowVisibility();
    }

    syncUserContextPanelVisibility() {
        const panel = this.userContextPanel;
        if (!panel) {
            return;
        }

        const chatArea = panel.closest('.admin-chat-area');
        const panelKind = String(panel.dataset.panelKind || '').trim();
        const hideCollapsedContext = ['context', 'state'].includes(panelKind)
            && this.userContextPanelCollapsed;
        const hideCollapsedOpsFilter = this.isNarrowAdminMode()
            && panelKind === 'ops-filter'
            && this.opsAlertToolbarCollapsed;

        const shouldShow = Boolean(panelKind) && !hideCollapsedContext && !hideCollapsedOpsFilter;
        panel.hidden = !shouldShow;
        chatArea?.classList.toggle('has-user-context', shouldShow);
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

    resolveUserContextEmail(session = {}) {
        return this.resolveSessionEmail(null, session.email || session.id, session.sessionIds || []);
    }

    hasKnownUserIdentityForSession(session = {}) {
        const userId = String(session?.userId || session?.profile?.id || '').trim();
        const email = this.resolveUserContextEmail(session);
        return Boolean(userId || email);
    }

    buildUserContextCacheKey(session = {}) {
        const userId = String(session?.userId || '').trim();
        const email = this.resolveUserContextEmail(session).toLowerCase();
        const sessionId = String(session?.id || '').trim();
        if (userId) return `user:${userId}`;
        if (email) return `email:${email}`;
        return `session:${sessionId}`;
    }

    async fetchUser360Context(session = {}) {
        const cacheKey = this.buildUserContextCacheKey(session);
        if (this.userContextCache.has(cacheKey)) {
            return this.userContextCache.get(cacheKey);
        }
        const currentSite = this.getCurrentSite();

        const initialUserId = String(session?.userId || '').trim();
        const initialEmail = this.resolveUserContextEmail(session);
        let fetchedProfiles = initialUserId
            ? await this.fetchChatProfiles('id', [initialUserId])
            : [];
        if ((!Array.isArray(fetchedProfiles) || !fetchedProfiles.length) && initialEmail) {
            fetchedProfiles = await this.fetchChatProfiles('email', [initialEmail]);
        }
        const profile = Array.isArray(fetchedProfiles) && fetchedProfiles.length
            ? fetchedProfiles[0]
            : {};
        const userId = String(profile.id || initialUserId || '').trim();
        const email = String(initialEmail || profile.email || '').trim();

        const [ordersResult, paymentsResult, verifyResult, ticketsResult] = await Promise.allSettled([
            userId
                ? this.supabase
                    .from('shop_orders')
                    .select('id, created_at, price_paid, snapshot_product_name, refund_status, delivery_status')
                    .eq('user_id', userId)
                    .eq('site', currentSite)
                    .order('created_at', { ascending: false })
                    .limit(2)
                : Promise.resolve({ data: [] }),
            userId
                ? this.supabase
                    .from('payment_orders')
                    .select('id, user_id, created_at, package_name, paid_amount, expected_amount, status, provider')
                    .eq('user_id', userId)
                    .eq('site', currentSite)
                    .order('created_at', { ascending: false })
                    .limit(2)
                : Promise.resolve({ data: [] }),
            (userId || email)
                ? (() => {
                    let query = this.supabase
                        .from('verification_logs')
                        .select('verification_id, user_id, status, message, created_at')
                        .eq('site', currentSite)
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
                    .eq('site', currentSite)
                    .order('created_at', { ascending: false })
                    .limit(2)
                : Promise.resolve({ data: [] })
        ]);

        const context = {
            cacheKey,
            userId,
            email,
            displayName: this.resolveSessionNickname(profile, session.id || '', email),
            avatarUrl: String(profile.avatar_url || session.avatarUrl || '').trim(),
            sessionId: String(session?.id || '').trim(),
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
        if (!this.userContextPanel) return;
        const text = String(message || '').trim();
        if (!text) {
            this.userContextPanel.dataset.panelKind = '';
            this.userContextPanel.hidden = true;
            this.userContextPanel.replaceChildren();
            this.syncUserContextInlineTrigger();
            this.syncUserContextPanelVisibility();
            this.scheduleAdminFloatingPanelOffsetSync();
            return;
        }
        this.userContextPanel.dataset.panelKind = 'state';
        this.userContextPanel.className = `chat-context-panel chat-context-panel--${variant}`;
        this.userContextPanel.innerHTML = `<div class="chat-context-panel__state">${this.escapeHtml(text)}</div>`;
        this.syncUserContextInlineTrigger();
        this.syncUserContextPanelVisibility();
        this.scheduleAdminFloatingPanelOffsetSync();
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
            this.showNotification('当前账号未分配「售后工单」模块权限', '💬 客服', true);
            return false;
        }
        if (!this.canCreateUserContextTicket(context)) {
            this.showNotification('当前会话暂不适合直接转售后工单', '💬 客服', true);
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

        this.showNotification(payload.message || `已转工单：${payload.ticket_id || '已创建'}`, '💬 客服', true);
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
                console.warn('[ChatWidget] Failed to load quick reply templates:', error);
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
        const templateText = String(template.text || '').trim();
        if (!this.input || this.input.disabled || !templateText) {
            return;
        }

        const currentValue = String(this.input.value || '');
        const separator = currentValue.trim() ? ' ' : '';
        this.input.value = `${currentValue}${separator}${templateText}`;
        this._focusInputWithoutScroll(this.input);
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        this.setReplyTemplateBarCollapsed(true);
    }

    renderReplyTemplateBar(context = null) {
        const bar = this.replyTemplateBar;
        if (!bar) return;

        const renderToken = (this._replyTemplateRenderToken || 0) + 1;
        this._replyTemplateRenderToken = renderToken;
        const renderTemplates = () => this.getReplyTemplateDrafts(context || {});
        const templates = renderTemplates();
        bar.replaceChildren();

        if (!templates.length) {
            bar.dataset.templateCount = '0';
            bar.hidden = true;
            bar.classList.remove('is-collapsed');
            bar.closest('.admin-chat-area')?.classList.remove('has-reply-templates');
        } else {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'chat-reply-templates__toggle';
            toggle.setAttribute('data-reply-template-toggle', 'true');
            toggle.innerHTML = `
                <span class="chat-reply-templates__toggle-copy">
                    <span class="chat-reply-templates__toggle-label">快捷回复</span>
                    <span class="chat-reply-templates__toggle-count">${templates.length}</span>
                </span>
                <span class="chat-reply-templates__toggle-text">展开</span>
            `;
            toggle.addEventListener('click', () => {
                this.setReplyTemplateBarCollapsed(!this.replyTemplateBarCollapsed);
            });
            bar.appendChild(toggle);

            const content = document.createElement('div');
            content.className = 'chat-reply-templates__content';

            const label = document.createElement('div');
            label.className = 'chat-reply-templates__label';
            label.textContent = '快捷回复';
            content.appendChild(label);

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

            content.appendChild(list);
            bar.appendChild(content);
            bar.hidden = false;
            bar.dataset.templateCount = String(templates.length);
            bar.closest('.admin-chat-area')?.classList.add('has-reply-templates');
        }

        this.syncReplyTemplateBarCollapsedState();
        this.syncUserContextInlineTrigger();
        this.scheduleAdminFloatingPanelOffsetSync();

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
            button.dataset.userContextAction = action.key;
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
                console.error('[ChatWidget] Failed to create chat session ticket:', error);
                this.showNotification(`转工单失败：${error.message || '未知错误'}`, '💬 客服', true);
                return false;
            }
        }

        const workspaceKey = String(action.workspaceKey || '').trim();
        if (!workspaceKey) {
            this.showNotification('当前动作缺少目标工作区', '💬 客服', true);
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
                result = this.openAdminStudioForOpsAlertWorkspace({
                    kind: 'ops-workspace',
                    workspaceKey,
                    context: action.context || {}
                });
            }
            if (result) {
                this.rememberUserContextAction(this.currentUserContext || {}, action);
            }
            return result;
        } catch (error) {
            console.error('[ChatWidget] Failed to open user context workspace:', error);
            this.showNotification(`打开失败：${error.message || '未知错误'}`, '💬 客服', true);
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
            const ticketId = String(item.id || '').trim();
            const isResolved = String(item.status || '').trim().toLowerCase() === 'resolved';
            const entry = this.buildUserContextWorkbenchEntry('ticket', {
                ticketId,
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
        if (!this.userContextPanel) return;
        if (!context) {
            this.userContextPanel.dataset.panelKind = '';
            this.userContextPanel.hidden = true;
            this.userContextPanel.replaceChildren();
            this.renderUserContextHeaderStatus(null);
            this.renderReplyTemplateBar(null);
            this.syncUserContextInlineTrigger();
            this.syncUserContextPanelVisibility();
            this.scheduleAdminFloatingPanelOffsetSync();
            return;
        }

        this.userContextPanel.dataset.panelKind = 'context';
        this.userContextPanel.className = 'chat-context-panel';
        this.userContextPanel.replaceChildren();
        this.renderUserContextHeaderStatus(context);
        this.renderReplyTemplateBar(context);
        this.scheduleAdminFloatingPanelOffsetSync();

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
        this.userContextPanel.appendChild(shell);
        this.setUserContextPanelCollapsed(this.userContextPanelCollapsed);
        this.syncUserContextInlineTrigger();
        this.syncUserContextPanelVisibility();
    }

    async loadUser360Context(session = {}) {
        const requestId = ++this._userContextRequestId;
        this.renderUserContextPanelState('正在整理用户上下文...', 'loading');

        try {
            const context = await this.fetchUser360Context(session);
            if (requestId !== this._userContextRequestId || this.currentSessionKey !== session.id) {
                return null;
            }
            this.currentUserContext = context;
            this.renderUser360Context(context);
            return context;
        } catch (error) {
            if (requestId !== this._userContextRequestId || this.currentSessionKey !== session.id) {
                return null;
            }
            this.currentUserContext = null;
            this.renderUserContextPanelState('暂时无法读取用户上下文', 'error');
            return null;
        }
    }

    async refreshCurrentUserContext({ silent = true } = {}) {
        const session = this.currentSessionInfo;
        const activeSessionKey = String(this.currentSessionKey || '').trim();
        if (!session || !activeSessionKey || this.isOpsAlertSessionId(activeSessionKey)) {
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
            if (requestId !== this._userContextRequestId || String(this.currentSessionKey || '').trim() !== activeSessionKey) {
                return null;
            }
            this.currentUserContext = context;
            this.renderUser360Context(context);
            return context;
        } catch (error) {
            if (!silent && requestId === this._userContextRequestId && String(this.currentSessionKey || '').trim() === activeSessionKey) {
                this.currentUserContext = null;
                this.renderUserContextPanelState('暂时无法读取用户上下文', 'error');
            }
            return null;
        }
    }

    async handleTicketRealtimeChange(ticket = {}) {
        if (!this.matchesCurrentSite(ticket)) {
            return;
        }
        const currentUserId = String(this.currentUserContext?.userId || '').trim();
        const ticketUserId = String(ticket?.user_id || '').trim();
        if (ticketUserId) {
            await this.refreshAdminSessionTicketSummariesForUserIds([ticketUserId]);
        }
        if (!currentUserId || !ticketUserId || currentUserId !== ticketUserId) {
            return;
        }

        await this.refreshCurrentUserContext({ silent: true });
    }

    async handlePaymentRealtimeChange(payment = {}) {
        if (!this.matchesCurrentSite(payment)) {
            return;
        }
        const currentUserId = String(this.currentUserContext?.userId || '').trim();
        const paymentUserId = String(payment?.user_id || '').trim();
        if (paymentUserId) {
            await this.refreshAdminSessionTicketSummariesForUserIds([paymentUserId]);
        }
        if (!currentUserId || !paymentUserId || currentUserId !== paymentUserId) {
            return;
        }

        await this.refreshCurrentUserContext({ silent: true });
    }

    async handleVerificationRealtimeChange(entry = {}) {
        if (!this.matchesCurrentSite(entry)) {
            return;
        }
        const currentUserId = String(this.currentUserContext?.userId || '').trim();
        const verificationUserId = String(entry?.user_id || '').trim();
        if (verificationUserId) {
            await this.refreshAdminSessionTicketSummariesForUserIds([verificationUserId]);
        }
        if (!currentUserId || !verificationUserId || currentUserId !== verificationUserId) {
            return;
        }

        await this.refreshCurrentUserContext({ silent: true });
    }

    async fetchChatProfiles(filterType, values = []) {
        const uniqueValues = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
        if (!uniqueValues.length) return [];

        const selectVariants = [
            'id, email, display_name, username, avatar_url',
            'id, email, username, avatar_url',
            'id, username, avatar_url'
        ];

        let lastError = null;

        for (const selectClause of selectVariants) {
            try {
                const query = this.supabase
                    .from('profiles')
                    .select(selectClause)
                    .in(filterType, uniqueValues);

                const { data, error } = await query;
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
            console.warn(`[ChatWidget] Failed to fetch profiles by ${filterType}:`, lastError);
        }
        return [];
    }

    getMessageRenderType(isAdminMessage) {
        return Boolean(isAdminMessage) === Boolean(this.isAdmin) ? 'user' : 'admin';
    }

    resolveSessionEmail(profile, fallbackKey = '', sessionIds = []) {
        const email = typeof profile?.email === 'string' ? profile.email.trim() : '';
        if (email) return email;

        const normalizedFallback = typeof fallbackKey === 'string' ? fallbackKey.trim() : String(fallbackKey || '');
        if (normalizedFallback.includes('@')) return normalizedFallback;

        const emailSessionId = (Array.isArray(sessionIds) ? sessionIds : [])
            .find(id => typeof id === 'string' && id.includes('@'));
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

    getSessionAvatarInitial(session) {
        if (!session) return 'U';
        if (session.id && session.id.startsWith('guest_')) return 'G';
        const seed = session.nickname || session.email || session.id || 'U';
        return String(seed).trim().charAt(0).toUpperCase() || 'U';
    }

    getSessionAvatarCacheKey(session = {}) {
        const userId = String(session?.userId || '').trim();
        if (userId) return `user:${userId}`;

        const email = String(session?.email || '').trim().toLowerCase();
        if (email) return `email:${email}`;

        const sessionId = String(session?.id || '').trim();
        if (sessionId) return `session:${sessionId}`;

        const avatarUrl = String(session?.avatarUrl || '').trim();
        return avatarUrl ? `avatar:${avatarUrl}` : '';
    }

    createStableSessionAvatarImage(session, avatarUrl, fallbackInitial, avatarEl) {
        const cacheKey = this.getSessionAvatarCacheKey(session);
        const normalizedUrl = String(avatarUrl || '').trim();
        let img = cacheKey ? this.sessionAvatarImageCache.get(cacheKey) : null;

        if (!img || img.tagName !== 'IMG' || img.isConnected) {
            img = document.createElement('img');
            if (cacheKey) {
                this.sessionAvatarImageCache.set(cacheKey, img);
            }
        }

        const previousErrorHandler = img.__chatWidgetAvatarErrorHandler;
        if (previousErrorHandler) {
            img.removeEventListener('error', previousErrorHandler);
        }

        img.alt = `${session.nickname || session.email || session.id || 'user'} avatar`;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        if (img.getAttribute('src') !== normalizedUrl) {
            img.src = normalizedUrl;
        }

        const errorHandler = () => {
            if (cacheKey && this.sessionAvatarImageCache.get(cacheKey) === img) {
                this.sessionAvatarImageCache.delete(cacheKey);
            }
            avatarEl.classList.remove('has-image');
            avatarEl.textContent = fallbackInitial;
            img.remove();
        };
        img.__chatWidgetAvatarErrorHandler = errorHandler;
        img.addEventListener('error', errorHandler, { once: true });
        return img;
    }

    createSessionAvatarElement(session) {
        const avatarEl = document.createElement('div');
        avatarEl.className = 'session-avatar';

        if (this.isOpsAlertSession(session)) {
            avatarEl.classList.add('session-avatar--ops');
            avatarEl.innerHTML = '<i class="fas fa-thumbtack"></i>';
            return avatarEl;
        }

        const fallbackInitial = this.getSessionAvatarInitial(session);
        const avatarUrl = String(session?.avatarUrl || '').trim();
        if (!avatarUrl) {
            avatarEl.textContent = fallbackInitial;
            return avatarEl;
        }

        avatarEl.classList.add('has-image');
        const img = this.createStableSessionAvatarImage(session, avatarUrl, fallbackInitial, avatarEl);
        avatarEl.appendChild(img);
        return avatarEl;
    }

    selectSession(sessionId, sessionInfo = null) {
        this.currentSessionKey = sessionId;
        this.currentSessionId = sessionId;

        // Update active state
        this.sessionList.querySelectorAll('.session-item').forEach(item => {
            item.classList.toggle('active', item.dataset.sessionId === sessionId);
        });

        // Find session info if not passed
        if (!sessionInfo) {
            sessionInfo = this.sessions.find(s => s.id === sessionId) || {
                nickname: sessionId.startsWith('guest_') ? this.t('chat.guest', '访客') : sessionId.split('@')[0],
                email: sessionId,
                lastLogin: null
            };
        }

        if (this.isOpsAlertSession(sessionInfo)) {
            this.currentSessionInfo = null;
            this.currentUserContext = null;
            this.userContextPanelCollapsed = true;
            this.replyTemplateBarCollapsed = true;
            this.opsAlertToolbarCollapsed = true;
            this.renderUser360Context(null);
            this.chatHeader.querySelector('.chat-user-name').textContent = '站内代办';
            this.chatHeader.querySelector('.chat-user-id').textContent = '站外告警同步 / 可认领、备注、关闭并跳转处理页';
            this.renderUserContextHeaderStatus(null);

            let statusContainer = this.chatHeader.querySelector('.user-status-indicator');
            if (!statusContainer) {
                statusContainer = document.createElement('div');
                statusContainer.className = 'user-status-indicator';
                this.chatHeader.querySelector('.chat-user-info').appendChild(statusContainer);
            }
            statusContainer.hidden = false;
            statusContainer.innerHTML = '<span class="status-dot online"></span><span class="status-text">固定系统联系人</span>';
            this.syncUserContextInlineTrigger();
            this.scheduleAdminFloatingPanelOffsetSync();

            this.chatWindow.classList.add('chat-active');
            this.setAdminReplyReadonly(true);
            this.clearSessionUnreadState(this.opsAlertSessionId, [this.opsAlertSessionId]);
            this.renderOpsAlertMessages();
            return;
        }

        this.setAdminReplyReadonly(false);
        this.currentSessionInfo = sessionInfo;
        this.currentUserContext = null;
        this.userContextPanelCollapsed = true;
        this.replyTemplateBarCollapsed = true;
        this.opsAlertToolbarCollapsed = true;
        this.renderReplyTemplateBar({
            sessionId,
            userId: sessionInfo?.userId || '',
            email: sessionInfo?.email || '',
            orders: [],
            payments: [],
            verifications: [],
            tickets: []
        });

        // Update header with user info
        this.chatHeader.querySelector('.chat-user-name').textContent = sessionInfo.nickname;
        // Prefer email in the header; only fall back when the session truly has no email.
        const headerEmail = this.resolveSessionEmail(null, sessionInfo.email || sessionInfo.id, sessionInfo.sessionIds || []);
        const displayId = headerEmail || sessionInfo.id;
        this.chatHeader.querySelector('.chat-user-id').textContent = displayId;

        // Update or add online status indicator
        let statusContainer = this.chatHeader.querySelector('.user-status-indicator');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.className = 'user-status-indicator';
            this.chatHeader.querySelector('.chat-user-info').appendChild(statusContainer);
        }

        this.renderSelectedSessionPresenceStatus(sessionInfo);
        this.scheduleAdminFloatingPanelOffsetSync();

        // Slide to chat view on mobile
        this.chatWindow.classList.add('chat-active');

        this.loadUser360Context(sessionInfo).catch((error) => {
            console.warn('[ChatWidget] Failed to load user 360 context:', error);
        });

        // Clear unread status for this session
        const sessionIdsToMark = sessionInfo.sessionIds || [sessionId];
        this.clearSessionUnreadState(sessionId, sessionIdsToMark);

        // Load messages (pass all session IDs for merged sessions)
        this.loadSessionMessages(sessionInfo.sessionIds || [sessionId]);
    }

    renderSelectedSessionPresenceStatus(sessionInfo = this.currentSessionInfo) {
        if (!sessionInfo || this.isOpsAlertSession(sessionInfo) || !this.chatHeader) return;

        let statusContainer = this.chatHeader.querySelector('.user-status-indicator');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.className = 'user-status-indicator';
            this.chatHeader.querySelector('.chat-user-info')?.appendChild(statusContainer);
        }
        if (!statusContainer) return;

        const presence = this.getUserPresenceStateForSession(sessionInfo);
        const presenceLastSeen = Date.parse(presence.lastSeenAt || '');

        let statusClass, statusText;
        if (presence.online) {
            statusClass = 'online';
            statusText = this.t('chat.online', '在线');
        } else if (!Number.isFinite(presenceLastSeen)) {
            statusClass = 'offline';
            statusText = this.t('chat.noActiveRecord', '暂无活跃记录');
        } else {
            const diffMins = Math.max(1, Math.floor((Date.now() - presenceLastSeen) / 60000));
            if (diffMins < 5) {
                statusClass = 'online';
                statusText = this.t('chat.online', '在线');
            } else if (diffMins < 30) {
                statusClass = 'away';
                statusText = this.t('chat.activeMinutesAgo', '{minutes}分钟前活跃').replace('{minutes}', diffMins);
            } else if (diffMins < 60) {
                statusClass = 'away';
                statusText = this.t('chat.minutesAgo', '{minutes}分钟前').replace('{minutes}', diffMins);
            } else if (diffMins < 1440) {
                statusClass = 'offline';
                statusText = this.t('chat.hoursAgo', '{hours}小时前').replace('{hours}', Math.floor(diffMins / 60));
            } else {
                statusClass = 'offline';
                statusText = this.t('chat.daysAgo', '{days}天前').replace('{days}', Math.floor(diffMins / 1440));
            }
        }

        statusContainer.hidden = false;
        statusContainer.innerHTML = `<span class="status-dot ${statusClass}"></span><span class="status-text">${statusText}</span>`;
        this.syncUserContextInlineTrigger();
    }

    // Lock scroll during preloading
    lockScroll() {
        if (this.messagesContainer) {
            this.isPreloading = true;
            this.messagesContainer.classList.add('scroll-locked');
        }
    }

    // Unlock scroll after preloading complete
    unlockScroll() {
        if (this.messagesContainer) {
            this.isPreloading = false;
            this.messagesContainer.classList.remove('scroll-locked');
        }
    }

    getSessionCacheKey(sessionIds) {
        const normalized = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean))];
        return normalized.sort().join('|');
    }

    clearSessionLoadingOverlayTimer() {
        if (this._sessionLoadingOverlayTimer) {
            clearTimeout(this._sessionLoadingOverlayTimer);
            this._sessionLoadingOverlayTimer = null;
        }
    }

    clearUserHistoryLoadFailsafeTimer() {
        if (this._userHistoryLoadFailsafeTimer) {
            clearTimeout(this._userHistoryLoadFailsafeTimer);
            this._userHistoryLoadFailsafeTimer = null;
        }
    }

    renderUserHistoryLoadFallback() {
        if (this.isAdmin || !this.messagesContainer) return;

        const fallbackMessages = Array.isArray(this._lastRenderedUserHistoryMessages)
            ? this._lastRenderedUserHistoryMessages
            : [];
        this.renderUserHistoryMessages(fallbackMessages);
        this._setMessagesContainerMinHeight(null);
        this.unlockScroll();
        this.finishUserHistoryLoadHandoff();
    }

    scheduleUserHistoryLoadFailsafe(requestId = 0) {
        this.clearUserHistoryLoadFailsafeTimer();
        if (!requestId || this.isAdmin || !this.messagesContainer) return;

        this._userHistoryLoadFailsafeTimer = setTimeout(() => {
            this._userHistoryLoadFailsafeTimer = null;
            if (requestId !== this._userHistoryLoadRequestId || this.isAdmin || !this.messagesContainer) {
                return;
            }

            const blockingLoader = this.messagesContainer.querySelector('.loading-overlay, .chat-loading-state--user-handoff');
            if (!blockingLoader) return;

            console.warn('[ChatWidget] User history load is slow; showing chat fallback while history continues.');
            this.renderUserHistoryLoadFallback();
        }, 6500);
    }

    ensureSessionLoadingOverlay() {
        if (!this.messagesContainer) return null;

        let loadingOverlay = this.messagesContainer.querySelector('.loading-overlay');
        if (loadingOverlay) return loadingOverlay;

        loadingOverlay = document.createElement('div');
        if (this.isAdmin) {
            loadingOverlay.className = 'loading-overlay';
            loadingOverlay.innerHTML = '<div class="loading-spinner"></div><span>预加载消息中...</span>';
        } else {
            loadingOverlay.className = 'loading-overlay loading-overlay--user-dots';
            loadingOverlay.innerHTML = this.getChatLoadingDotsMarkup(this.t('chat.loading', '加载中...'));
        }
        this.messagesContainer.appendChild(loadingOverlay);
        return loadingOverlay;
    }

    removeSessionLoadingOverlay() {
        this.clearSessionLoadingOverlayTimer();
        if (!this.messagesContainer) return;
        const loadingOverlay = this.messagesContainer.querySelector('.loading-overlay');
        if (loadingOverlay) loadingOverlay.remove();
    }

    finishUserHistoryLoadingOverlayHandoff(loadingOverlay = null) {
        this.clearSessionLoadingOverlayTimer();
        const overlay = loadingOverlay || this.messagesContainer?.querySelector('.loading-overlay');
        if (!overlay) return;

        requestAnimationFrame(() => {
            if (!overlay.isConnected) return;
            overlay.classList.add('is-exiting');
            setTimeout(() => {
                if (overlay.isConnected) {
                    overlay.remove();
                }
            }, 180);
        });
    }

    clearSessionUnreadState(sessionKey, sessionIds = []) {
        const idsToClear = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean))];
        idsToClear.forEach(sid => this.unreadSessions.delete(sid));

        this.sessionList?.querySelectorAll('.session-item').forEach(item => {
            if (item.dataset.sessionId !== sessionKey) return;
            item.classList.remove('unread');
            const unreadDot = item.querySelector('.unread-dot');
            if (unreadDot) unreadDot.remove();
        });
    }

    renderSessionMessages(messages = []) {
        if (!this.messagesContainer) return;

        this.removeSessionLoadingOverlay();
        this.messagesContainer.innerHTML = '';
        this.lastDisplayedTime = null;

        if (!messages.length) {
            this.messagesContainer.innerHTML = `<div class="message admin">${this.t('chat.noMessages', '暂无消息')}</div>`;
            return;
        }

        messages.forEach(msg => {
            this.appendMessage(
                msg.content,
                this.getMessageRenderType(msg.is_admin),
                msg.message_type === 'image' ? 'image' : 'text',
                msg.created_at
            );
        });
    }

    // HIGH REFRESH RATE OPTIMIZATION: Disable expensive effects during scroll
    // 240Hz and above monitors need frame times < 4.16ms, backdrop-filter can't keep up
    setupScrollOptimization() {
        // Disabled: toggling extra classes during scroll caused style recalculation
        // without any matching CSS benefit, which could desync native scrollbar paint.
    }

    async loadSessionMessages(sessionIds) {
        // sessionIds can be an array (merged user) or will be converted to array
        const sessionIdArray = [...new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean))];
        const cacheKey = this.getSessionCacheKey(sessionIdArray);
        const requestId = ++this._sessionLoadRequestId;
        this.currentSessionIds = sessionIdArray;
        // Set currentSessionId for sending messages (use first one as the reply session)
        this.currentSessionId = sessionIdArray[0];

        const cachedMessages = this.sessionMessagesCache.get(cacheKey);
        if (Array.isArray(cachedMessages) && cachedMessages.length) {
            this.renderSessionMessages(cachedMessages);
            this._setMessagesContainerMinHeight(null);
            this.unlockScroll();
        } else {
            // PRELOAD STRATEGY: Lock scroll during message loading
            this.lockScroll();

            // Preserve current scroll state and container height to prevent scroll jump
            const currentHeight = this.messagesContainer.offsetHeight;

            // Set min-height to preserve layout during content swap
            this._setMessagesContainerMinHeight(currentHeight);

            // Only show the blocking overlay when the request is actually slow.
            this.clearSessionLoadingOverlayTimer();
            this._sessionLoadingOverlayTimer = setTimeout(() => {
                if (this._sessionLoadRequestId !== requestId) return;
                this.ensureSessionLoadingOverlay();
            }, 180);
        }

        try {
            const { data, error } = await this.queryForCurrentSite(
                this.supabase
                    .from('chat_messages')
                    .select('session_id, content, is_admin, message_type, created_at')
                    .in('session_id', sessionIdArray),
                this.getCurrentSite()
            )
                .order('created_at', { ascending: true });

            if (error) throw error;
            if (requestId !== this._sessionLoadRequestId) return;

            const normalizedData = Array.isArray(data) ? data : [];
            this.sessionMessagesCache.set(cacheKey, normalizedData);
            this.renderSessionMessages(normalizedData);

            // Remove min-height constraint after content is loaded
            this._setMessagesContainerMinHeight(null);

            // Scroll to bottom (new conversation loaded)
            this.scrollToBottom();

            // PRELOAD COMPLETE: Unlock scroll after all messages are rendered
            this.unlockScroll();

        } catch (err) {
            console.error('Failed to load messages:', err);
            if (requestId !== this._sessionLoadRequestId) return;
            this.removeSessionLoadingOverlay();
            this._setMessagesContainerMinHeight(null);
            this.messagesContainer.innerHTML = '<div class="message admin">加载失败</div>';
            // Unlock scroll even on error
            this.unlockScroll();
        }
    }

    async searchSessions(query) {
        const normalizedQuery = String(query || '').toLowerCase().trim();

        // First, search in session list (name, email, preview)
        this.sessionList.querySelectorAll('.session-item').forEach(item => {
            this._setSessionItemHidden(item, false);
            // Remove previous match count
            const existingCount = item.querySelector('.search-match-count');
            if (existingCount) existingCount.remove();
        });
        this.updateAdminSessionSearchEmptyState('');

        if (!normalizedQuery) {
            return;
        }

        // Then search in chat messages database
        try {
            const { data: messages, error } = await this.queryForCurrentSite(
                this.supabase
                    .from('chat_messages')
                    .select('session_id, content')
                    .ilike('content', `%${normalizedQuery}%`),
                this.getCurrentSite()
            );

            if (error) throw error;

            // Count matches per session
            const matchCounts = {};
            if (messages) {
                messages.forEach(msg => {
                    matchCounts[msg.session_id] = (matchCounts[msg.session_id] || 0) + 1;
                });
            }

            // Get all session IDs that have matched messages
            const matchedSessionIds = new Set(Object.keys(matchCounts));

            // Update UI
            this.sessionList.querySelectorAll('.session-item').forEach(item => {
                const sessionId = item.dataset.sessionId;
                const name = item.querySelector('.session-name')?.textContent.toLowerCase() || '';
                const email = item.querySelector('.session-email')?.textContent.toLowerCase() || '';
                const preview = item.querySelector('.session-preview')?.textContent.toLowerCase() || '';
                const extra = item.dataset.searchText || '';

                // Check if session info matches OR if there are message matches
                const session = this.sessions?.find(s => s.id === sessionId);
                const sessionIds = session?.sessionIds || [sessionId];
                const hasMessageMatch = sessionIds.some(sid => matchedSessionIds.has(sid));
                const hasInfoMatch = name.includes(normalizedQuery)
                    || email.includes(normalizedQuery)
                    || preview.includes(normalizedQuery)
                    || extra.includes(normalizedQuery);

                if (hasInfoMatch || hasMessageMatch) {
                    this._setSessionItemHidden(item, false);

                    // Show match count if there are message matches
                    const totalMatches = sessionIds.reduce((sum, sid) => sum + (matchCounts[sid] || 0), 0);
                    if (totalMatches > 0) {
                        const countBadge = document.createElement('div');
                        countBadge.className = 'search-match-count';
                        countBadge.textContent = `${totalMatches} 条匹配`;
                        item.appendChild(countBadge);
                    }
                } else {
                    this._setSessionItemHidden(item, true);
                }
            });
            this.updateAdminSessionSearchEmptyState(normalizedQuery);
        } catch (err) {
            console.error('Search failed:', err);
            // Fallback to basic search
            this.sessionList.querySelectorAll('.session-item').forEach(item => {
                const name = item.querySelector('.session-name')?.textContent.toLowerCase() || '';
                const preview = item.querySelector('.session-preview')?.textContent.toLowerCase() || '';
                const extra = item.dataset.searchText || '';
                const matches = name.includes(normalizedQuery)
                    || preview.includes(normalizedQuery)
                    || extra.includes(normalizedQuery);
                this._setSessionItemHidden(item, !matches);
            });
            this.updateAdminSessionSearchEmptyState(normalizedQuery);
        }
    }

    bindAdminEvents() {
        // Close button
        this.chatWindow.querySelector('.chat-close').addEventListener('click', () => this.closeChat());

        // Overlay click to close
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.closeChat());
        }

        window.addEventListener('resize', this._adminFloatingPanelResizeHandler, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this._adminFloatingPanelResizeHandler, { passive: true });
        }

        // Back to list button (mobile slide navigation)
        const backBtn = this.chatWindow.querySelector('#backToListBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.chatWindow.classList.remove('chat-active');
            });
        }

        if (this.adminSidebarInsightsToggle) {
            this.adminSidebarInsightsToggle.addEventListener('click', () => {
                this.setAdminSidebarInsightsCollapsed(!this.adminSidebarInsightsCollapsed);
            });
        }

        if (this.userContextPanel) {
            this.userContextPanel.addEventListener('click', (event) => {
                const toggle = event.target.closest('[data-user-context-panel-toggle]');
                if (!toggle) return;
                this.setUserContextPanelCollapsed(!this.userContextPanelCollapsed);
            });
        }

        // Session search filter - enhanced with chat message search
        const searchInput = this.chatWindow.querySelector('#sessionSearch');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', async (e) => {
                const query = e.target.value.toLowerCase().trim();
                this.adminSessionSearchQuery = query;

                // Clear previous search timeout
                if (searchTimeout) clearTimeout(searchTimeout);

                if (!query) {
                    this.renderAdminSessionList();
                    return;
                }

                // Debounce search
                searchTimeout = setTimeout(async () => {
                    await this.searchSessions(query);
                }, 300);
            });
        }

        if (this.sessionFilterBar) {
            this.chatWindow?.querySelector('#sessionQueueSnapshot')?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-snapshot-action]');
                if (!button) return;
                const action = button.getAttribute('data-session-snapshot-action');
                if (action === 'restore-default') {
                    this.restoreAdminSessionQueueDefaultView();
                } else if (action === 'apply-recommended-mode') {
                    this.adminSessionQueueView = this.normalizeAdminSessionQueueView(button.getAttribute('data-session-recommended-view') || 'all');
                    this.adminSessionQueueFilter = this.normalizeAdminSessionQueueFilter(button.getAttribute('data-session-recommended-filter') || 'all');
                    this.persistAdminSessionQueuePreferences();
                    this.renderAdminSessionQueueControls();
                    this.renderAdminSessionList();
                } else if (action === 'save-default') {
                    this.saveCurrentAdminSessionQueueAsDefault();
                }
            });

            this.sessionQueueOverview?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-stat-filter]');
                if (!button) return;
                this.adminSessionQueueView = 'all';
                this.setAdminSessionQueueFilter(button.getAttribute('data-session-stat-filter') || 'all');
            });

            this.sessionQueueViews?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-view]');
                if (!button) return;
                this.setAdminSessionQueueView(button.getAttribute('data-session-view') || 'all');
            });

            this.sessionFilterBar.addEventListener('click', (event) => {
                const button = event.target.closest('[data-session-filter]');
                if (!button) return;
                this.setAdminSessionQueueFilter(button.getAttribute('data-session-filter') || 'all');
            });
        }

        // Send Message (as admin)
        this.chatWindow.querySelector('#chatSendBtn').addEventListener('click', () => this.sendAdminMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendAdminMessage();
        });
        this._bindInputFocusStabilizer(this.input);

        // Emoji Picker
        const emojiBtn = this.chatWindow.querySelector('#chatEmojiBtn');
        this._bindEmojiPicker(emojiBtn);

        // Image Upload
        const uploadBtn = this.chatWindow.querySelector('#chatUploadBtn');
        const imageInput = this.chatWindow.querySelector('#chatImageInput');
        uploadBtn.addEventListener('click', () => imageInput.click());
        imageInput.addEventListener('change', (e) => this.handleAdminImageUpload(e));

        // HIGH REFRESH RATE: Setup scroll optimization
        this.setupScrollOptimization();
    }

    async sendAdminMessage() {
        if (!this.currentSessionId) {
            // Show friendly inline hint instead of alert
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 请先选择一个会话';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '输入回复...';
            }, 2000);
            return;
        }

        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 站内代办为只读告警流';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '站内代办为只读告警流';
            }, 2000);
            return;
        }

        const text = this.input.value.trim();
        if (!text) return;

        // Optimistic UI update
        this.appendMessage(text, this.getMessageRenderType(true), 'text');
        this.input.value = '';
        this.scrollToBottom();

        try {
            const { data: sentMessage, error } = await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    site: this.getCurrentSite(),
                    content: text,
                    message_type: 'text',
                    is_admin: true
                })
                .select('session_id, content, is_admin, message_type, created_at')
                .single();
            if (error) throw error;
            window.ZaoyoeAdminPresence?.markActive?.();

            this.applyAdminReplySessionUpdate(this.currentSessionId, sentMessage || {
                session_id: this.currentSessionId,
                content: text,
                is_admin: true,
                message_type: 'text',
                created_at: new Date().toISOString()
            });

            // 🔔 Create system notification for the user's bell
            await this.createNotificationForUser(this.currentSessionId, text);
        } catch (err) {
            console.error('Failed to send:', err);
        }
    }

    // 🔔 Create a system notification for user when admin replies
    async createNotificationForUser(sessionId, messageContent) {
        try {
            if (sessionId.startsWith('guest_')) {
                console.log('⏭️ Skipping notification for guest user');
                return;
            }

            let targetUserId = null;

            if (sessionId.startsWith('user_')) {
                targetUserId = sessionId.slice('user_'.length) || null;
            } else {
                const { data: profile, error: profileError } = await this.supabase
                    .from('profiles')
                    .select('id')
                    .eq('email', sessionId)
                    .single();

                if (!profileError && profile?.id) {
                    targetUserId = profile.id;
                }
            }

            if (!targetUserId) {
                const { data: messageRow, error: messageRowError } = await this.supabase
                    .from('chat_messages')
                    .select('user_id')
                    .eq('session_id', sessionId)
                    .eq('site', this.getCurrentSite())
                    .not('user_id', 'is', null)
                    .limit(1)
                    .single();

                if (!messageRowError && messageRow?.user_id) {
                    targetUserId = messageRow.user_id;
                }
            }

            if (!targetUserId) {
                console.warn('Could not find user for notification:', sessionId);
                return;
            }

            // Create system notification
            const { error } = await insertScopedSystemNotification(this.supabase, {
                user_id: targetUserId,
                site: this.getCurrentSite(),
                title: '客服回复',
                content: messageContent.substring(0, 100) + (messageContent.length > 100 ? '...' : ''),
                type: 'info',
                is_read: false,
                scope: 'user_personal',
                category: 'chat_reply',
                action_label: '打开客服',
                metadata: {
                    page_id: 'home',
                    site: this.getCurrentSite(),
                    event_type: 'support_reply',
                    session_id: sessionId
                },
                priority: 60,
                source_module: 'chat',
                source_event_id: `support_reply:${sessionId}:${Date.now()}`
            });

            if (error) {
                throw error;
            }

            console.log('🔔 Notification created for user:', targetUserId);
        } catch (err) {
            console.error('Failed to create notification:', err);
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

    async uploadChatImageToR2(file, options = {}) {
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
                    sessionId: options.sessionId || this.currentSessionId || session.user.id,
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

    async handleAdminImageUpload(event) {
        if (!this.currentSessionId) {
            // Show friendly inline hint instead of alert
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 请先选择一个会话';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '输入回复...';
            }, 2000);
            event.target.value = ''; // Clear file input
            return;
        }

        if (this.isOpsAlertSessionId(this.currentSessionId)) {
            this.input.classList.add('shake-hint');
            this.input.placeholder = '⚠️ 站内代办为只读告警流';
            setTimeout(() => {
                this.input.classList.remove('shake-hint');
                this.input.placeholder = '站内代办为只读告警流';
            }, 2000);
            event.target.value = '';
            return;
        }

        const file = event.target.files[0];
        if (!file) return;

        try {
            // Compress image
            const compressedFile = await this.compressImage(file);

            const imageUrl = await this.uploadChatImageToR2(compressedFile, {
                sessionId: this.currentSessionId
            });

            // Send as image message
            const { data: sentImageMessage, error: insertError } = await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    site: this.getCurrentSite(),
                    content: imageUrl,
                    message_type: 'image',
                    is_admin: true
                })
                .select('session_id, content, is_admin, message_type, created_at')
                .single();
            if (insertError) throw insertError;
            window.ZaoyoeAdminPresence?.markActive?.();

            this.appendMessage(imageUrl, this.getMessageRenderType(true), 'image');
            this.applyAdminReplySessionUpdate(this.currentSessionId, sentImageMessage || {
                session_id: this.currentSessionId,
                content: imageUrl,
                is_admin: true,
                message_type: 'image',
                created_at: new Date().toISOString()
            });
            this.scrollToBottom();

        } catch (err) {
            console.error('Failed to upload:', err);
            alert('上传失败: ' + err.message);
        }

        event.target.value = '';
    }

    subscribeToAdminMessages() {
        if (this.adminMessageChannel) {
            this.supabase.removeChannel(this.adminMessageChannel);
        }
        if (this.adminOpsAlertChannel) {
            this.supabase.removeChannel(this.adminOpsAlertChannel);
        }
        if (this.adminTicketChannel) {
            this.supabase.removeChannel(this.adminTicketChannel);
        }
        if (this.adminPaymentChannel) {
            this.supabase.removeChannel(this.adminPaymentChannel);
        }
        if (this.adminVerificationChannel) {
            this.supabase.removeChannel(this.adminVerificationChannel);
        }

        this.adminMessageChannel = this.createRealtimeSubscription(
            `admin-chat-global-${Date.now()}`,
            (channel) => channel.on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages',
                filter: this.getCurrentSiteRealtimeFilter()
            }, (payload) => {
                const msg = payload.new;
                const isTicketSyncMessage = this.isTicketSyncChatMessage(msg);
                const isAdminReply = Boolean(msg?.is_admin) && !isTicketSyncMessage;
                const normalizedIncomingUserId = String(msg?.user_id || '').trim();

                if (isAdminReply) {
                    this.applyAdminReplySessionUpdate(msg.session_id, msg);
                    return;
                }

                if (normalizedIncomingUserId && normalizedIncomingUserId === this.currentAdminUserId) {
                    return;
                }

                // Check if we're currently ACTIVELY viewing this session's chat
                // Must be: window open + selected this session + on mobile: must be in chat view (not list view)
                const isMobile = window.innerWidth <= 700;
                const isInChatView = !isMobile || (this.chatWindow && this.chatWindow.classList.contains('chat-active'));
                const activeSessionIds = this.currentSessionIds || (this.currentSessionId ? [this.currentSessionId] : []);
                const currentSessionUserId = String(this.currentSessionInfo?.userId || '').trim();
                const isViewingThisSession = this.isOpen &&
                    (
                        (activeSessionIds.length > 0 && activeSessionIds.includes(msg.session_id))
                        || (normalizedIncomingUserId && currentSessionUserId === normalizedIncomingUserId)
                    ) &&
                    isInChatView;

                if (isViewingThisSession) {
                    // Append message to current chat - with animation (isNewMessage=true)
                    this.appendMessage(
                        msg.content,
                        this.getMessageRenderType(msg.is_admin),
                        msg.message_type === 'image' ? 'image' : 'text',
                        msg.created_at,
                        true
                    );
                    this.scrollToBottom();
                }

                // Always show notification if not actively viewing the chat
                if (!isViewingThisSession) {
                    const messageContent = msg.message_type === 'image' ? '📷 发送了一张图片' : msg.content;
                    const senderName = isTicketSyncMessage
                        ? '工单结果同步'
                        : (msg.user_id ? '已登录用户' : '访客');
                    this.showNotification(messageContent, `💬 ${senderName}`, true); // forceShow for admin

                    // Mark session as unread
                    this.unreadSessions.add(msg.session_id);
                }

                if (!this.applyIncomingAdminUserMessage(msg)) {
                    this.loadAdminSessions();
                }
            }),
            { feature: 'chat_widget_admin_messages' }
        );

        this.adminOpsAlertChannel = this.createRealtimeSubscription(
            `admin-ops-alerts-${Date.now()}`,
            (channel) => channel
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ops_alert_jobs' }, (payload) => {
                this.upsertOpsAlertMessage(payload.new, { announce: true });
            })
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ops_alert_jobs' }, (payload) => {
                this.upsertOpsAlertMessage(payload.new, { announce: false });
            }),
            { feature: 'chat_widget_ops_alerts' }
        );

        this.adminTicketChannel = this.createRealtimeSubscription(
            `admin-ticket-context-${Date.now()}`,
            (channel) => channel.on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'shop_tickets',
                filter: this.getCurrentSiteRealtimeFilter()
            }, (payload) => {
                this.handleTicketRealtimeChange(payload.new);
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'shop_tickets',
                filter: this.getCurrentSiteRealtimeFilter()
            }, (payload) => {
                this.handleTicketRealtimeChange(payload.new);
            })
            ,
            { feature: 'chat_widget_ticket_context' }
        );

        this.adminPaymentChannel = this.createRealtimeSubscription(
            `admin-payment-context-${Date.now()}`,
            (channel) => channel.on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'payment_orders',
                filter: this.getCurrentSiteRealtimeFilter()
            }, (payload) => {
                this.handlePaymentRealtimeChange(payload.new);
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'payment_orders',
                filter: this.getCurrentSiteRealtimeFilter()
            }, (payload) => {
                this.handlePaymentRealtimeChange(payload.new);
            })
            ,
            { feature: 'chat_widget_payment_context' }
        );

        this.adminVerificationChannel = this.createRealtimeSubscription(
            `admin-verification-context-${Date.now()}`,
            (channel) => channel.on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'verification_logs',
                filter: this.getCurrentSiteRealtimeFilter()
            }, (payload) => {
                this.handleVerificationRealtimeChange(payload.new);
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'verification_logs',
                filter: this.getCurrentSiteRealtimeFilter()
            }, (payload) => {
                this.handleVerificationRealtimeChange(payload.new);
            })
            ,
            { feature: 'chat_widget_verification_context' }
        );
    }

    injectUserLayoutStyles() {
        // Avoid duplicate injection
        if (document.getElementById('user-chat-styles')) return;

        const style = document.createElement('style');
        style.id = 'user-chat-styles';
        style.textContent = `
            /* User Mode Glassmorphism Enhancement */
            .chat-window:not(.admin-mode-layout) {
                position: fixed !important;
                right: 30px !important;
                bottom: 100px !important;
                width: 380px !important;
                height: 600px !important;
                max-width: calc(100vw - 32px) !important;
                max-height: 80vh !important;
                min-width: 0 !important;
                min-height: 0 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
                z-index: 9998 !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                transform: translateY(20px) scale(0.95) !important;
                transform-origin: bottom right !important;
                background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98)) !important;
                background-image: none !important;
                backdrop-filter: var(--chat-shell-filter, none) !important;
                -webkit-backdrop-filter: var(--chat-shell-filter, none) !important;
                border: 1px solid var(--chat-shell-border, rgba(255, 255, 255, 0.16)) !important;
                box-shadow: var(--chat-shell-shadow, 0 26px 70px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06)) !important;
            }

            .chat-window:not(.admin-mode-layout).active {
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: all !important;
                transform: translateY(0) scale(1) !important;
            }

            html[data-theme="light"] .chat-window:not(.admin-mode-layout) {
                --chat-shell-bg: rgba(252, 253, 255, 0.98);
                --chat-panel-bg: rgba(243, 247, 251, 0.96);
                --chat-panel-shadow: none;
                --chat-avatar-bg: rgba(107, 158, 206, 0.18);
                --chat-avatar-border: rgba(107, 158, 206, 0.14);
                --chat-admin-shadow: 0 8px 18px rgba(148, 163, 184, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.88);
                --chat-mascot-head-shadow: none;
            }

            html[data-theme="light"] .chat-window:not(.admin-mode-layout) .chat-header,
            html[data-theme="light"] .chat-window:not(.admin-mode-layout) .chat-input-area {
                background: var(--chat-shell-bg) !important;
            }

            html[data-theme="light"] .chat-window:not(.admin-mode-layout) .chat-messages {
                background: var(--chat-panel-bg) !important;
                box-shadow: none !important;
            }

            html[data-theme="light"] .chat-window:not(.admin-mode-layout) .chat-avatar {
                background: var(--chat-avatar-bg) !important;
                border-color: var(--chat-avatar-border) !important;
            }

            html[data-theme="light"] .chat-window:not(.admin-mode-layout) .mascot-head {
                box-shadow: none !important;
            }

            html[data-theme="light"] .chat-window:not(.admin-mode-layout) .message.user {
                box-shadow:
                    0 10px 22px rgba(35, 118, 78, 0.14),
                    inset 0 1px 0 rgba(255, 255, 255, 0.42) !important;
            }

            .chat-window:not(.admin-mode-layout).chat-opening--bootstrap-handoff,
            .chat-window:not(.admin-mode-layout).chat-opening--bootstrap-handoff.active {
                transform: translateY(0) scale(1) !important;
                transform-origin: bottom right !important;
            }

            .chat-window:not(.admin-mode-layout).chat-opening--bootstrap-handoff.active {
                transition:
                    opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
                    transform 360ms cubic-bezier(0.18, 0.88, 0.24, 1),
                    visibility 320ms !important;
            }

            .chat-window--bootstrap-adopting-content > *:not(.chat-bootstrap-content-snapshot) {
                opacity: 0;
            }

            .chat-window--bootstrap-adopting-content.chat-window--bootstrap-content-ready > *:not(.emoji-picker-popover):not(.chat-bootstrap-content-snapshot) {
                opacity: 1;
                animation: chat-widget-content-settle 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
            }

            .chat-bootstrap-content-snapshot {
                position: absolute;
                inset: 0;
                z-index: 5;
                display: flex;
                flex-direction: column;
                min-width: 0;
                min-height: 0;
                overflow: hidden;
                background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98));
                opacity: 1;
                pointer-events: none;
                transition: opacity 300ms cubic-bezier(0.22, 1, 0.36, 1);
                contain: paint;
            }

            html[data-theme="light"] .chat-bootstrap-content-snapshot {
                background: var(--chat-shell-bg, rgba(252, 253, 255, 0.98));
            }

            .chat-window--bootstrap-content-ready .chat-bootstrap-content-snapshot {
                opacity: 0;
                transition-delay: 80ms;
            }

            .chat-window--bootstrap-adopting-content .emoji-picker-popover:not(.active),
            .chat-window--bootstrap-content-ready .emoji-picker-popover:not(.active) {
                opacity: 0 !important;
                pointer-events: none !important;
                transform: translateY(10px) !important;
                animation: none !important;
            }

            .chat-window--bootstrap-interaction-locked .chat-input-area,
            .chat-window--bootstrap-interaction-locked .chat-action-btn,
            .chat-window--bootstrap-interaction-locked .chat-send-btn,
            .chat-window--bootstrap-interaction-locked .chat-input,
            .chat-window--bootstrap-interaction-locked .emoji-picker-popover {
                pointer-events: none !important;
            }

            .chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn,
            .chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn:hover,
            .chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn:active,
            .chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn:focus,
            .chat-window--bootstrap-interaction-locked #chatEmojiBtn.chat-action-btn i {
                background: transparent !important;
                color: var(--chat-action-color, rgba(255, 255, 255, 0.7)) !important;
                box-shadow: none !important;
                transform: none !important;
                filter: none !important;
            }

            .chat-window--bootstrap-interaction-locked .emoji-picker-popover,
            .chat-window--bootstrap-interaction-locked .emoji-picker-popover.active {
                opacity: 0 !important;
                transform: translateY(10px) !important;
                pointer-events: none !important;
            }

            @keyframes chat-widget-content-swap {
                0% {
                    opacity: 0;
                    filter: blur(3px);
                    transform: translateY(8px);
                }
                58% {
                    opacity: 0.9;
                    filter: blur(1px);
                }
                100% {
                    opacity: 1;
                    filter: blur(0);
                    transform: translateY(0);
                }
            }

            @keyframes chat-widget-content-settle {
                0% {
                    opacity: 1;
                    transform: translateY(4px);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .chat-loading-state--user-handoff {
                margin: auto;
                color: var(--chat-accent-blue, #6b94c6);
            }

            .chat-window:not(.admin-mode-layout) .chat-header {
                background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98)) !important;
                border-bottom: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-messages {
                background: var(--chat-panel-bg, rgba(12, 15, 22, 0.98)) !important;
                background-image: none !important;
                box-shadow: var(--chat-panel-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.04), inset 0 -12px 24px rgba(0, 0, 0, 0.08)) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input-area {
                background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98)) !important;
                border-top: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input,
            .chat-window:not(.admin-mode-layout) .chat-action-btn {
                backdrop-filter: var(--chat-panel-filter, none) !important;
                -webkit-backdrop-filter: var(--chat-panel-filter, none) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-action-btn {
                background: var(--chat-panel-bg, rgba(12, 15, 22, 0.98)) !important;
                background-image: none !important;
                border: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
                box-shadow: var(--chat-panel-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.04), inset 0 -12px 24px rgba(0, 0, 0, 0.08)) !important;
                min-width: 36px !important;
                min-height: 36px !important;
                flex: 0 0 36px !important;
                margin: 0 !important;
                appearance: none !important;
                -webkit-appearance: none !important;
                -webkit-tap-highlight-color: transparent !important;
                touch-action: manipulation !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-action-btn i {
                width: 16px !important;
                height: 16px !important;
                display: inline-flex !important;
                justify-content: center !important;
                align-items: center !important;
                font-size: 16px !important;
                line-height: 1 !important;
            }

            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn {
                width: 36px !important;
                height: 36px !important;
                min-width: 36px !important;
                min-height: 36px !important;
                flex: 0 0 36px !important;
                padding: 0 !important;
                margin: 0 !important;
                background: transparent !important;
                border: none !important;
                border-radius: 50% !important;
                box-shadow: none !important;
                outline: none !important;
                color: var(--chat-action-color, rgba(255, 255, 255, 0.7)) !important;
            }

            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn:hover {
                background: transparent !important;
                color: var(--chat-action-hover-color, white) !important;
            }

            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn:active,
            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn:focus:not(:focus-visible),
            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn:active i,
            .chat-window:not(.admin-mode-layout) #chatEmojiBtn.chat-action-btn:focus:not(:focus-visible) i {
                background: transparent !important;
                color: var(--chat-action-color, rgba(255, 255, 255, 0.7)) !important;
                box-shadow: none !important;
                transform: none !important;
                filter: none !important;
                outline: none !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input {
                background: var(--chat-input-bg, rgba(0, 0, 0, 0.2)) !important;
                background-image: none !important;
                border: 1px solid var(--chat-input-border, rgba(255, 255, 255, 0.1)) !important;
                box-shadow: none !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-input:focus {
                background: var(--chat-input-bg-focus, rgba(0, 0, 0, 0.4)) !important;
                border-color: var(--chat-accent-blue, rgba(107, 158, 206, 0.96)) !important;
                box-shadow: 0 0 0 3px var(--chat-accent-blue-soft, rgba(107, 158, 206, 0.12)) !important;
            }

            .chat-window:not(.admin-mode-layout) .chat-send-btn {
                color: var(--chat-accent-blue, rgba(107, 158, 206, 0.96)) !important;
            }

            .chat-window:not(.admin-mode-layout) .emoji-picker-popover {
                background: var(--chat-shell-bg, rgba(10, 13, 20, 0.98)) !important;
                background-image: none !important;
                backdrop-filter: var(--chat-shell-filter, none) !important;
                -webkit-backdrop-filter: var(--chat-shell-filter, none) !important;
                border: 1px solid var(--chat-panel-border, rgba(255, 255, 255, 0.08)) !important;
                box-shadow: var(--chat-shell-shadow, 0 26px 70px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.06)) !important;
            }

            .chat-window:not(.admin-mode-layout) .message.admin {
                background: var(--chat-admin-bubble, rgba(255, 255, 255, 0.12)) !important;
                background-image: none !important;
                color: var(--chat-admin-text, rgba(255, 255, 255, 0.92)) !important;
                border: 1px solid var(--chat-admin-border, rgba(255, 255, 255, 0.08)) !important;
                box-shadow: var(--chat-admin-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.04), inset 0 -12px 24px rgba(0, 0, 0, 0.08)) !important;
            }

            body.chat-spotlight-suspended .spotlight-overlay,
            body.chat-spotlight-suspended .poetry-nav-container:hover .spotlight-overlay,
            body.chat-spotlight-suspended #ambientCanvas,
            body.chat-spotlight-suspended #starryCanvas {
                pointer-events: none !important;
            }
            
            @media (max-width: 768px) {
                .user-context-summary,
                .user-context-grid {
                    grid-template-columns: 1fr;
                }
                .user-context-shell__toggle {
                    align-items: flex-start;
                }
                .user-context-shell__toggle-side {
                    margin-top: 2px;
                }
                .user-context-shell__body,
                .user-context-shell__body-inner {
                    max-height: min(260px, 34vh);
                }
            }
            
            /* Overlay for user mode (same as admin) */
            .chat-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(7, 9, 12, 0);
                z-index: 9997;
                backdrop-filter: blur(0) saturate(100%);
                -webkit-backdrop-filter: blur(0) saturate(100%);
                transform: translateZ(0);
                -webkit-transform: translateZ(0);
                will-change: opacity, backdrop-filter;
                opacity: 0;
                transition:
                    opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
                    background-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
                    backdrop-filter 260ms cubic-bezier(0.22, 1, 0.36, 1),
                    -webkit-backdrop-filter 260ms cubic-bezier(0.22, 1, 0.36, 1);
            }
            .chat-overlay.visible {
                display: block;
            }
            .chat-overlay.visible.chat-overlay--active {
                background: var(--chat-overlay-bg, var(--app-modal-backdrop, rgba(34, 41, 52, 0.48)));
                backdrop-filter: var(--chat-overlay-filter, var(--app-modal-backdrop-filter, blur(6px) saturate(106%)));
                -webkit-backdrop-filter: var(--chat-overlay-filter, var(--app-modal-backdrop-filter, blur(6px) saturate(106%)));
                opacity: 1;
            }
            .chat-overlay.closing {
                display: block;
                opacity: 0;
                background: rgba(7, 9, 12, 0);
                backdrop-filter: blur(0) saturate(100%);
                -webkit-backdrop-filter: blur(0) saturate(100%);
                transition:
                    opacity 140ms linear,
                    background-color 140ms linear,
                    backdrop-filter 140ms linear,
                    -webkit-backdrop-filter 140ms linear;
            }
            .chat-overlay.chat-overlay--user {
                background: rgba(7, 9, 12, 0) !important;
                backdrop-filter: blur(0) saturate(100%) !important;
                -webkit-backdrop-filter: blur(0) saturate(100%) !important;
            }
            .chat-overlay.chat-overlay--user.visible.chat-overlay--active {
                background: var(--chat-overlay-bg, var(--app-modal-backdrop, rgba(34, 41, 52, 0.48))) !important;
                backdrop-filter: var(--chat-overlay-filter, var(--app-modal-backdrop-filter, blur(6px) saturate(106%))) !important;
                -webkit-backdrop-filter: var(--chat-overlay-filter, var(--app-modal-backdrop-filter, blur(6px) saturate(106%))) !important;
            }
            .chat-overlay.chat-overlay--user.closing {
                background: rgba(7, 9, 12, 0) !important;
                backdrop-filter: blur(0) saturate(100%) !important;
                -webkit-backdrop-filter: blur(0) saturate(100%) !important;
            }
            
            /* Narrow desktop: keep the same centered user-chat shell as narrow touch viewports. */
            @media (max-width: 700px) and (hover: hover) and (pointer: fine) {
                .chat-window:not(.admin-mode-layout) {
                    --chat-base-translate-y: -50%;
                    --chat-shift-y: 0px;
                    width: min(460px, max(97vw, calc(100vw - 16px))) !important;
                    max-width: 97vw !important;
                    height: 70vh !important;
                    max-height: 600px !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px) + 24px), 0) scale(0.94) !important;
                    transform-origin: center center !important;
                }

                .chat-window:not(.admin-mode-layout).active {
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                }

                .chat-window:not(.admin-mode-layout).chat-opening--bootstrap-handoff,
                .chat-window:not(.admin-mode-layout).chat-opening--bootstrap-handoff.active {
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    transform-origin: center center !important;
                }
            }

            /* Touch narrow screens: use the centered modal animation */
            @media (max-width: 700px) and (hover: none), (max-width: 700px) and (pointer: coarse) {
                .chat-window:not(.admin-mode-layout) .chat-header {
                    justify-content: flex-start !important;
                }

                .chat-window:not(.admin-mode-layout) {
                    --chat-base-translate-y: -50%;
                    --chat-shift-y: 0px;
                    --chat-open-offset-x: 0px;
                    --chat-open-offset-y: 24px;
                    --chat-open-scale: 0.94;
                    --chat-close-scale: 0.94;
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    /* Mobile position must stay stable; keyboard movement is controlled by JS only. */
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    width: min(460px, max(97vw, calc(100vw - 16px))) !important;
                    max-width: 97vw !important;
                    height: 70vh !important;
                    max-height: 600px !important;
                    /* Keep position stable; visibility and scale handle the open state. */
                    opacity: 1 !important;
                    /* Match admin mobile's compositor path: overlay owns the blur, the scaling shell stays cheap. */
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }

                .chat-window:not(.admin-mode-layout).chat-opening {
                    visibility: visible !important;
                    pointer-events: none !important;
                    opacity: 0 !important;
                    transform: translate3d(
                        calc(-50% + var(--chat-open-offset-x, 0px)),
                        calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px) + var(--chat-open-offset-y, 0px)),
                        0
                    ) scale(var(--chat-open-scale, 0.2)) !important;
                    transform-origin: center center !important;
                    will-change: transform, opacity !important;
                    backface-visibility: hidden !important;
                    -webkit-backface-visibility: hidden !important;
                    contain: layout paint style !important;
                }
                
                .chat-window:not(.admin-mode-layout).active {
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }

                .chat-window:not(.admin-mode-layout).chat-opening.active {
                    visibility: visible !important;
                    pointer-events: all !important;
                    opacity: 1 !important;
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    transition:
                        opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
                        transform 360ms cubic-bezier(0.18, 0.88, 0.24, 1) !important;
                }

                .chat-window:not(.admin-mode-layout).chat-opening.chat-opening--bootstrap-handoff {
                    opacity: 0 !important;
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    transform-origin: center center !important;
                }

                .chat-window:not(.admin-mode-layout).chat-opening.chat-opening--bootstrap-handoff.active {
                    opacity: 1 !important;
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    transition:
                        opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
                        transform 360ms cubic-bezier(0.18, 0.88, 0.24, 1) !important;
                }

                .chat-window:not(.admin-mode-layout).keyboard-docked,
                .chat-window:not(.admin-mode-layout).keyboard-docked.active,
                .chat-window:not(.admin-mode-layout).keyboard-docked.is-active,
                .chat-window:not(.admin-mode-layout).keyboard-docked.is-handoff,
                .chat-window:not(.admin-mode-layout).keyboard-docked.is-handoff:not(.is-active),
                .chat-window:not(.admin-mode-layout).chat-window--keyboard-height-locked.keyboard-docked,
                .chat-window:not(.admin-mode-layout).chat-window--keyboard-height-locked.keyboard-docked.active,
                .chat-window:not(.admin-mode-layout).chat-window--keyboard-height-locked.keyboard-docked.is-active,
                .chat-window:not(.admin-mode-layout).chat-window--keyboard-height-locked.keyboard-docked.is-handoff,
                .chat-window:not(.admin-mode-layout).chat-window--keyboard-height-locked.keyboard-docked.is-handoff:not(.is-active) {
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    transform: translate3d(-50%, calc(var(--chat-base-translate-y, -50%) + var(--chat-shift-y, 0px)), 0) scale(1) !important;
                    transform-origin: center center !important;
                }

            }
            
            /* Enforce instant scrolling for user mode too */
            .chat-window:not(.admin-mode-layout) .chat-messages {
                scroll-behavior: auto !important;
                overscroll-behavior-y: contain;
            }
        `;
        document.head.appendChild(style);
    }

    renderUserMode() {
        this.isAdmin = false;
        this.persistBootstrapShellMode('user');

        // Create Chat Window
        const claimedShell = this.claimBootstrapShell('user');
        this.chatWindow = claimedShell || document.createElement('div');
        if (claimedShell) {
            this.chatWindow.classList.add('chat-window');
            this.chatWindow.classList.remove('admin-mode-layout', 'admin-mode-layout--narrow');
        } else {
            this.chatWindow.className = 'chat-window';
        }
        const bootstrapContentSnapshot = this.getBootstrapContentSnapshotMarkup(this.chatWindow);
        const shouldUseInitialLoadingHandoff = Boolean(claimedShell);
        const initialMessagesMarkup = this.getUserInitialMessagesMarkup({
            loading: shouldUseInitialLoadingHandoff
        });
        this.chatWindow.innerHTML = `
            <div class="chat-header">
                <div class="chat-header-info">
                    <div class="chat-avatar">
                        <div class="mascot-wrapper mascot-wrapper--compact">
                            <div class="mascot-head">
                                <div class="mascot-ears"></div>
                                <div class="mascot-face">
                                    <div class="mascot-eyes">
                                        <span class="eye left"></span>
                                        <span class="eye right"></span>
                                    </div>
                                    <div class="mascot-mouth"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="chat-title">
                        <h3>${this.t('chat.onlineSupport', '在线客服')}</h3>
                        <div class="chat-status-row">
                            <div class="chat-status-indicator">
                                <span class="status-dot online"></span>
                                <span class="status-text target-admin-status">${this.t('chat.adminOnline', '管理员在线')}</span>
                            </div>
                            <div class="chat-header-actions" id="chatHeaderActions" hidden>
                                <button type="button" class="chat-header-mode-switch" id="chatHeaderSupportBtn">${this.escapeHtml(this.getSupportEntryLabel())}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="chat-messages" id="chatMessages">
                ${initialMessagesMarkup}
            </div>
            <div class="chat-support-panel" id="chatSupportPanel" hidden></div>
            <div class="chat-input-area">
                <input type="file" id="chatImageInput" class="chat-file-input" accept="image/*">
                <button class="chat-action-btn" id="chatUploadBtn"><i class="fas fa-plus"></i></button>
                <input type="text" class="chat-input" id="chatInput" placeholder="${this.t('chat.inputMessagePlaceholder', '输入消息...')}">
                <button class="chat-action-btn" id="chatEmojiBtn"><i class="far fa-smile"></i></button>
                <button class="chat-send-btn" id="chatSendBtn"><i class="fas fa-paper-plane"></i></button>
            </div>
            ${bootstrapContentSnapshot}
            <div class="emoji-picker-popover" id="emojiPicker">
                ${this.emojis.map(e => `<div class="emoji-item">${e}</div>`).join('')}
            </div>
        `;
        if (!claimedShell) {
            document.body.appendChild(this.chatWindow);
        }

        // Create overlay for clicking outside to close (same as admin mode)
        const claimedOverlay = this.claimBootstrapOverlay('user');
        this.overlay = claimedOverlay || document.createElement('div');
        if (!claimedOverlay) {
            this.overlay.className = 'chat-overlay chat-overlay--user';
            document.body.appendChild(this.overlay);
        }

        // Inject user mode styles (glassmorphism enhancement)
        this.injectUserLayoutStyles();

        this.messagesContainer = this.chatWindow.querySelector('#chatMessages');
        this.supportPanel = this.chatWindow.querySelector('#chatSupportPanel');
        this.inputArea = this.chatWindow.querySelector('.chat-input-area');
        this.input = this.chatWindow.querySelector('#chatInput');
        this.emojiPicker = this.chatWindow.querySelector('#emojiPicker');
        this.headerActions = this.chatWindow.querySelector('#chatHeaderActions');
        this.headerSupportToggle = this.chatWindow.querySelector('#chatHeaderSupportBtn');
        this.syncSupportShellState();
        this.scheduleSupportPanelPrewarm();
        this.bindUserEvents();
        if (shouldUseInitialLoadingHandoff) {
            this.scheduleBootstrapAdoptedContentSettle();
        }
    }

    bindUserEvents() {
        // Overlay click to close (same as admin mode)
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.closeChat());
        }

        // Send Message
        this.chatWindow.querySelector('#chatSendBtn').addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        this._bindInputFocusStabilizer(this.input);
        this.supportPanel?.addEventListener('click', (event) => this.handleSupportPanelClick(event));
        this.supportPanel?.addEventListener('submit', (event) => this.handleSupportPanelSubmit(event));
        this.messagesContainer?.addEventListener('click', (event) => this.handleSupportAssistMessageClick(event));
        this.headerSupportToggle?.addEventListener('click', () => this.renderSupportRootPanel());

        // Emoji Picker
        const emojiBtn = this.chatWindow.querySelector('#chatEmojiBtn');
        this._bindEmojiPicker(emojiBtn);

        // Image Upload
        const uploadBtn = this.chatWindow.querySelector('#chatUploadBtn');
        const fileInput = this.chatWindow.querySelector('#chatImageInput');

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleImageUpload(e));

        // HIGH REFRESH RATE: Setup scroll optimization
        this.setupScrollOptimization();
    }

    toggleChat() {
        if (!this.chatWindow) {
            this._pendingOpenAfterInit = !this.isOpen;
            return;
        }

        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            if (!this.isAdmin) {
                if (this.input) this.input.value = '';
                this.setSupportDisplayMode('chat');
                this.scheduleSupportPanelPrewarm();
            } else {
                this.refreshOpsAlerts({ announceNew: false }).catch((error) => {
                    console.warn('[ChatWidget] Failed to refresh ops alerts on open:', error?.message || error);
                });
            }
            this._pauseFabAmbientMotion();
            document.documentElement.classList.add('chat-widget-open');
            document.body.classList.add('chat-widget-open');
            this._closeChromeCleanupStarted = false;
            this._clearOpeningAnimationTimer();
            this._clearClosingAnimationTimer();
            this.chatWindow.classList.remove('chat-closing');
            this.chatWindow.classList.remove('chat-closing-end');
            this.chatWindow.classList.remove('chat-opening');
            this.chatWindow.classList.remove('chat-opening--bootstrap-handoff');
            const useBootstrapHandoffOpening = this.isBootstrapShellAdopted() || (!this.isAdmin && this._shouldUseBootstrapHandoffOpening());
            this._syncDesktopViewportInsetMode();
            this.syncAdminResponsiveLayout({ force: true });
            if (useBootstrapHandoffOpening) {
                this._primeOpeningAnimationForBootstrapHandoff();
                this._setChatWindowTransitionless(false);
                this._setChatWindowForceHidden(false);
            } else {
                this.chatWindow.classList.remove('active');
                this._setChatWindowTransitionless(true);
                this._setChatWindowForceHidden(true);
                this._primeOpeningAnimationFromFab();
            }
            this.chatWindow.classList.add('chat-opening');
            this.chatWindow.classList.toggle('chat-opening--bootstrap-handoff', useBootstrapHandoffOpening);
            const deferFabHideForOpening = this._shouldDeferFabHideForOpening(useBootstrapHandoffOpening);
            this._showStatusBarShield();
            // 1. 先执行所有会触发布局突变的操作（弹窗此刻仍然 opacity:0, visibility:hidden）
            this._setFabTransitionless(false);
            if (!deferFabHideForOpening) {
                this._setFabHidden(true);
            }
            this._setFabDisabled(true);
            this._showChatOverlay();
            this._freezeOverlay();

            if (window.iOSScrollLock) {
                // Strictly use lockLight across all platforms.
                // Using hard lock (position: fixed) on iOS violently conflicts with 
                // native Safari scroll-to-input behaviors during keyboard popup, causing visual jitter.
                window.iOSScrollLock.lockLight(this.chatWindow, {
                    restoreScrollDuringViewport: true
                });
            }
            this._enableSessionVisualLock();
            if (this._shouldUseFocusDockFallback()) {
                this._attachKeyboardListener();
            }

            // 2. 提交 opening 初始态后启动动画；移动端二次打开同步提交初始态，避免多等一帧造成顿挫。
            this._scheduleChatOpeningActivation(useBootstrapHandoffOpening, {
                deferFabHide: deferFabHideForOpening,
                immediateStartFrame: deferFabHideForOpening
            });

        } else {
            this._pauseFabAmbientMotion(1800);
            document.documentElement.classList.remove('chat-widget-open');
            document.body.classList.remove('chat-widget-open');
            this._runChatCloseChromeCleanup();
            this._finalizeChatClose();
            window.setTimeout(() => {
                this.flushPendingEngagementItems();
            }, 520);
        }
    }

    requestBootstrapPendingOpen() {
        try {
            if (typeof window.ZaoyoeChatWidgetBootstrap?.requestPendingOpen === 'function') {
                window.ZaoyoeChatWidgetBootstrap.requestPendingOpen();
                return;
            }

            window.dispatchEvent(new CustomEvent('zaoyoe:chat-widget-runtime-pending-open', {
                detail: { source: 'chat-widget-runtime' }
            }));
        } catch (error) {
            console.warn('[ChatWidget] Failed to request bootstrap pending open:', error);
        }
    }

    openChat() {
        if (!this.chatWindow) {
            this._pendingOpenAfterInit = true;
            this.requestBootstrapPendingOpen();
            return this.ready || Promise.resolve(this);
        }

        this._pendingOpenAfterInit = false;
        if (!this.isOpen) {
            this.toggleChat();
        }

        return Promise.resolve(this);
    }

    closeChat() {
        this._pendingOpenAfterInit = false;
        if (!this.chatWindow) {
            return Promise.resolve(this);
        }

        if (this.isOpen) {
            this.toggleChat();
        }

        return Promise.resolve(this);
    }

    /**
     * iOS 键盘适配：不阻止 Safari 滚动（会抖），
     * 只在键盘弹出时给聊天窗口加 bottom 偏移，让输入框露在键盘上方
     */
    _attachKeyboardListener() {
        if (!window.visualViewport) {
            this._onChatFocusIn = () => {
                if (this._shouldUseFocusDockFallback()) {
                    this._clearPendingUndockTimer();
                    this._applyKeyboardDock(window.innerHeight || 0, 0, true);
                    this._keyboardDocked = true;
                    this._lastKeyboardInset = 0;
                }
            };
            this._onChatFocusOut = () => {
                if (this._isIOSMobile()) {
                    this._clearPendingUndockTimer();
                    this._resetKeyboardViewportStyles(true);
                    this._keyboardDocked = false;
                    this._lastKeyboardInset = 0;
                } else {
                    this._scheduleUndock();
                }
            };
            this.chatWindow?.addEventListener('focusin', this._onChatFocusIn, true);
            this.chatWindow?.addEventListener('focusout', this._onChatFocusOut, true);
            return;
        }

        const vv = window.visualViewport;
        this._viewportBaseHeight = Math.max(
            this._viewportBaseHeight || 0,
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            (vv.height || 0) + (vv.offsetTop || 0)
        );
        this._viewportBaseVisualHeight = Math.max(
            this._viewportBaseVisualHeight || 0,
            vv.height || 0
        );
        this._captureStableDockHeight();

        this._onViewportResize = () => {
            const vv = window.visualViewport;
            const visualTop = Math.max(0, vv.offsetTop || 0);
            const visualHeight = Math.max(0, vv.height || 0);
            const visualBottom = visualTop + visualHeight;

            this._viewportBaseHeight = Math.max(
                this._viewportBaseHeight || 0,
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                visualBottom
            );

            this._viewportBaseVisualHeight = Math.max(
                this._viewportBaseVisualHeight || 0,
                visualHeight
            );

            const insetFromLayout = Math.max(0, this._viewportBaseHeight - visualBottom);
            const insetFromViewportDelta = Math.max(0, (this._viewportBaseVisualHeight || visualHeight) - visualHeight);
            const bottomInset = Math.max(insetFromLayout, insetFromViewportDelta);
            if (bottomInset < 40) {
                this._captureStableDockHeight();
            } else {
                this._scheduleStableKeyboardInset(bottomInset);
            }
            const isFocusedInChat = this._isChatInputFocused();
            const isIOS = this._isIOSMobile();
            const shouldDock = this._isNarrowViewport() && (
                isIOS
                    ? (
                        !this._keyboardBlurUndocking &&
                        (this._keyboardDocked ? bottomInset > 8 : bottomInset > 24)
                    )
                    : (bottomInset > 60)
            );

            if (isIOS && !isFocusedInChat && bottomInset <= 8) {
                this._keyboardBlurUndocking = false;
                this._pendingStableKeyboardInset = 0;
                this._clearKeyboardSettleTimer();
            }

            if (shouldDock) {
                this._clearPendingUndockTimer();
                this._keyboardPreLiftActive = false;
                if (!this._keyboardDocked) {
                    if (isIOS) {
                        this._scheduleInitialKeyboardDock(visualHeight, bottomInset);
                    } else {
                        // Only animate on the edge transition into keyboard-docked state.
                        this._applyKeyboardDock(visualHeight, bottomInset, true);
                        this._keyboardDocked = true;
                        this._lastKeyboardInset = bottomInset;
                    }
                } else if (Math.abs(bottomInset - this._lastKeyboardInset) > 1) {
                    if (this._isHighRefreshDisplay && performance.now() < this._keyboardDockAnimatingUntil) {
                        this._lastKeyboardInset = bottomInset;
                        return;
                    }
                    // Follow keyboard without animation to avoid repeated transition restarts.
                    this._applyKeyboardDock(visualHeight, bottomInset, false);
                    this._lastKeyboardInset = bottomInset;
                }
            } else {
                this._clearPendingFirstDock();
                if (!isIOS) {
                    // 非 iOS 保留平滑过渡
                    this._scheduleUndock();
                } else {
                    this._clearPendingUndockTimer();
                    if (this._keyboardDocked) {
                        this._resetKeyboardViewportStyles(true);
                    }
                    this._keyboardDocked = false;
                    this._lastKeyboardInset = 0;
                }
            }
        };
        this._onViewportChange = () => this._requestViewportSync();
        window.visualViewport.addEventListener('resize', this._onViewportChange, { passive: true });
        window.visualViewport.addEventListener('scroll', this._onViewportChange, { passive: true });
        window.addEventListener('resize', this._onViewportChange, { passive: true });
        window.addEventListener('orientationchange', this._onViewportChange, { passive: true });

        this._onChatFocusIn = () => {
            this._keyboardBlurUndocking = false;
            this._keyboardPreLiftActive = false;
            if (window.visualViewport) {
                const vv = window.visualViewport;
                this._viewportBaseHeight = Math.max(
                    this._viewportBaseHeight || 0,
                    window.innerHeight || 0,
                    document.documentElement.clientHeight || 0,
                    (vv.height || 0) + (vv.offsetTop || 0)
                );
                this._viewportBaseVisualHeight = Math.max(
                    this._viewportBaseVisualHeight || 0,
                    vv.height || 0
                );
            }
            this._captureStableDockHeight();
            this._clearKeyboardSettleTimer();
            this._requestViewportSync();
            setTimeout(() => this._requestViewportSync(), 160);
        };
        this._onChatFocusOut = () => {
            this._clearPendingUndockTimer();
            this._clearKeyboardSettleTimer();
            this._keyboardPreLiftActive = false;
            requestAnimationFrame(() => {
                if (this._isChatInputFocused()) return;
                this._keyboardBlurUndocking = true;
                if (this._keyboardDocked) {
                    this._resetKeyboardViewportStyles(true);
                }
                this._requestViewportSync();
                setTimeout(() => this._requestViewportSync(), 140);
                setTimeout(() => this._requestViewportSync(), 320);
            });
        };
        this.chatWindow?.addEventListener('focusin', this._onChatFocusIn, true);
        this.chatWindow?.addEventListener('focusout', this._onChatFocusOut, true);

        this._requestViewportSync();
    }

    _detachKeyboardListener() {
        if (window.visualViewport && this._onViewportChange) {
            window.visualViewport.removeEventListener('resize', this._onViewportChange);
            window.visualViewport.removeEventListener('scroll', this._onViewportChange);
            window.removeEventListener('resize', this._onViewportChange);
            window.removeEventListener('orientationchange', this._onViewportChange);
            this._onViewportChange = null;
        }
        if (this._viewportThrottleTimer) {
            clearTimeout(this._viewportThrottleTimer);
            this._viewportThrottleTimer = null;
        }
        if (this._viewportRafId) {
            cancelAnimationFrame(this._viewportRafId);
            this._viewportRafId = null;
        }
        if (this._onViewportResize) {
            this._onViewportResize = null;
        }
        if (this.chatWindow && this._onChatFocusIn) {
            this.chatWindow.removeEventListener('focusin', this._onChatFocusIn, true);
            this._onChatFocusIn = null;
        }
        if (this.chatWindow && this._onChatFocusOut) {
            this.chatWindow.removeEventListener('focusout', this._onChatFocusOut, true);
            this._onChatFocusOut = null;
        }
        this._viewportBaseHeight = null;
        this._viewportBaseVisualHeight = null;
        this._stableDockHeight = null;
        this._keyboardDocked = false;
        this._lastKeyboardInset = 0;
        this._keyboardBlurUndocking = false;
        this._keyboardPreLiftActive = false;
        this._clearKeyboardSettleTimer();
        this._clearTransitionCleanupTimer();
        this._clearPendingFirstDock();
        this._clearPendingUndockTimer();
        this._restoreMotionVisuals();
    }

    _captureStableDockHeight() {
        if (!this.chatWindow) return;
        if (window.visualViewport) {
            const vv = window.visualViewport;
            const visualBottom = (vv.height || 0) + (vv.offsetTop || 0);
            const layoutHeight = Math.max(
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                visualBottom
            );
            const keyboardInset = Math.max(0, layoutHeight - visualBottom);
            if (keyboardInset > 60) return;
        }
        const rect = this.chatWindow.getBoundingClientRect();
        const height = Math.round(rect.height || 0);
        if (height > 220) {
            this._stableDockHeight = height;
        }
    }

    _isNarrowViewport() {
        return window.matchMedia('(max-width: 700px)').matches;
    }

    _isIOSMobile() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    _isTouchPrimaryInput() {
        if (navigator.maxTouchPoints > 0) return true;
        if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
            return true;
        }
        return 'ontouchstart' in window;
    }

    _usesTouchNarrowLayout() {
        return this._isNarrowViewport() && (this._isIOSMobile() || this._isTouchPrimaryInput());
    }

    _shouldUseFocusDockFallback() {
        return this._usesTouchNarrowLayout();
    }

    _isChatInputFocused() {
        const active = document.activeElement;
        if (!active || !this.chatWindow) return false;
        if (!this.chatWindow.contains(active)) return false;
        return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    }

    _focusInputWithoutScroll(inputEl) {
        if (!inputEl) return;
        if (!this._isIOSMobile() || !this._isNarrowViewport()) {
            inputEl.focus();
            return;
        }
        try {
            inputEl.focus({ preventScroll: true });
        } catch (err) {
            inputEl.focus();
        }
    }

    _bindInputFocusStabilizer(inputEl) {
        if (!inputEl || inputEl.dataset.preventScrollBind === '1') return;

        const handleTouchFocus = (e) => {
            if (!this.isOpen || !this._isIOSMobile() || !this._isNarrowViewport()) return;
            if (e.cancelable) e.preventDefault();
            if (window.iOSScrollLock && this.chatWindow) {
                window.iOSScrollLock.lockLight(this.chatWindow, {
                    restoreScrollDuringViewport: true
                });
            }
            this._focusInputWithoutScroll(inputEl);
            this._requestViewportSync();
        };

        inputEl.addEventListener('touchstart', handleTouchFocus, { passive: false });
        inputEl.dataset.preventScrollBind = '1';
    }

    _freezeOverlay() {
        if (!this.overlay) return;
        const vv = window.visualViewport;
        const initialViewportHeight = Math.max(
            window.innerHeight || 0,
            document.documentElement.clientHeight || 0,
            vv ? ((vv.height || 0) + (vv.offsetTop || 0)) : 0,
            window.screen?.height || 0
        );
        this._overlayBaseHeight = initialViewportHeight + 64;

        // 高度基线，避免 body.no-scroll 裁切导致底部漏层
        this._toggleElementClass(this.overlay, 'chat-overlay--frozen', true);
        this._syncOverlayFrame = () => {
            if (!this.overlay) return;
            const vv = window.visualViewport;
            const overlayHeight = Math.max(
                this._overlayBaseHeight || 0,
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                vv ? ((vv.height || 0) + (vv.offsetTop || 0) + 64) : 0,
                window.screen?.height || 0
            );
            this._setRuntimeStyle(this.overlay, '--chat-overlay-frozen-height', `${overlayHeight}px`, 'important');
        };
        this._syncOverlayFrame();

        window.addEventListener('resize', this._syncOverlayFrame, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this._syncOverlayFrame, { passive: true });
            window.visualViewport.addEventListener('scroll', this._syncOverlayFrame, { passive: true });
        }
    }

    _restoreOverlay() {
        if (!this.overlay) return;
        if (this._syncOverlayFrame) {
            window.removeEventListener('resize', this._syncOverlayFrame);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', this._syncOverlayFrame);
                window.visualViewport.removeEventListener('scroll', this._syncOverlayFrame);
            }
            this._syncOverlayFrame = null;
        }
        this._toggleElementClass(this.overlay, 'chat-overlay--frozen', false);
        this._setRuntimeStyle(this.overlay, '--chat-overlay-frozen-height', null);
        this._overlayBaseHeight = null;
    }

    _applyKeyboardDock(visualHeight, bottomInset, animate = false) {
        if (!this.chatWindow) return;

        this.chatWindow.classList.add('keyboard-docked');
        this._clearTransitionCleanupTimer();
        const dockDuration = 250;
        if (animate) {
            this._applyMotionVisualLock(dockDuration + 40);
            this._keyboardDockAnimatingUntil = performance.now() + dockDuration + 24;
            this._setChatWindowTransitionless(false);
            this._setChatWindowKeyboardAnimating(true, dockDuration);
            this._transitionCleanupTimer = setTimeout(() => {
                this._transitionCleanupTimer = null;
                if (this.chatWindow && this.chatWindow.classList.contains('keyboard-docked')) {
                    this._setChatWindowKeyboardAnimating(false);
                }
            }, dockDuration + 40);
        } else {
            this._setChatWindowKeyboardAnimating(false);
            this._setChatWindowTransitionless(true);
        }

        const isIOS = this._isIOSMobile();
        if (isIOS) {
            const baseViewportHeight = Math.max(
                this._viewportBaseHeight || 0,
                window.innerHeight || 0,
                document.documentElement.clientHeight || 0,
                visualHeight + Math.max(0, bottomInset)
            );
            const fallbackHeight = Math.min(600, Math.max(420, Math.round(baseViewportHeight * 0.7)));
            const dockHeight = Math.max(320, Math.round(this._stableDockHeight || fallbackHeight));
            // Compute the docked offset directly so Safari never paints an intermediate centered state.
            const centeredBottom = (baseViewportHeight * 0.5) + (dockHeight * 0.5);
            const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
            const targetBottom = Math.max(40, keyboardTop - 12);
            const deltaY = Math.max(-520, Math.min(520, targetBottom - centeredBottom));
            this._setChatWindowDockBottom(null);
            this._setChatWindowDockHeight(dockHeight);
            this._setChatTranslateVars('-50%', deltaY);
            return;
        }
        const dockBottom = Math.max(0, bottomInset);
        // 覆盖移动端居中定位，改为贴近键盘上沿
        this._setChatWindowDockHeight(null);
        this._setChatWindowDockBottom(dockBottom);
        this._setChatTranslateVars('0px', 0);
    }

    _scheduleUndock() {
        if (!this._isNarrowViewport()) {
            this._resetKeyboardViewportStyles();
            return;
        }
        this._clearPendingUndockTimer();
        this._pendingUndockTimer = setTimeout(() => {
            if (!this._isChatInputFocused()) {
                this._resetKeyboardViewportStyles();
            }
            this._pendingUndockTimer = null;
        }, 260);
    }

    _clearPendingUndockTimer() {
        if (this._pendingUndockTimer) {
            clearTimeout(this._pendingUndockTimer);
            this._pendingUndockTimer = null;
        }
    }

    _requestViewportSync() {
        if (!this._onViewportResize) return;
        const useHighRefreshGuard = this._isIOSMobile() && this._isNarrowViewport() && this._isHighRefreshDisplay;
        if (useHighRefreshGuard) {
            const now = performance.now();
            const minInterval = 1000 / 60;
            const elapsed = now - this._lastViewportSyncAt;
            if (elapsed < minInterval) {
                if (this._viewportThrottleTimer) return;
                this._viewportThrottleTimer = setTimeout(() => {
                    this._viewportThrottleTimer = null;
                    this._requestViewportSync();
                }, Math.max(0, Math.round(minInterval - elapsed)));
                return;
            }
        }
        if (this._viewportRafId) return;
        this._viewportRafId = requestAnimationFrame(() => {
            this._viewportRafId = null;
            this._lastViewportSyncAt = performance.now();
            this._onViewportResize?.();
        });
    }

    _clearKeyboardSettleTimer() {
        if (this._keyboardSettleTimer) {
            clearTimeout(this._keyboardSettleTimer);
            this._keyboardSettleTimer = null;
        }
    }

    _clearOpeningAnimationTimer() {
        if (this._openingAnimationTimer) {
            clearTimeout(this._openingAnimationTimer);
            this._openingAnimationTimer = null;
        }
        if (this._openingAnimationFrame) {
            cancelAnimationFrame(this._openingAnimationFrame);
            this._openingAnimationFrame = null;
        }
        this._openingAnimationRunId += 1;
    }

    _clearClosingAnimationTimer() {
        if (this._closingAnimationTimer) {
            clearTimeout(this._closingAnimationTimer);
            this._closingAnimationTimer = null;
        }
    }

    _getFabMotionMetrics() {
        if (!this.chatWindow || !this.fab || this.chatWindow.classList.contains('admin-mode-layout')) return;
        if (!this._usesTouchNarrowLayout()) return;

        const chatRect = this.chatWindow.getBoundingClientRect();
        const fabRect = this.fab.getBoundingClientRect();
        if (!chatRect.width || !chatRect.height || !fabRect.width || !fabRect.height) return;

        const chatCenterX = chatRect.left + (chatRect.width / 2);
        const chatCenterY = chatRect.top + (chatRect.height / 2);
        const fabCenterX = fabRect.left + (fabRect.width / 2);
        const fabCenterY = fabRect.top + (fabRect.height / 2);
        const offsetX = Math.round(fabCenterX - chatCenterX);
        const offsetY = Math.round(fabCenterY - chatCenterY);
        const scaleX = fabRect.width / chatRect.width;
        const scaleY = fabRect.height / chatRect.height;
        const startScale = Math.max(0.16, Math.min(0.28, Math.min(scaleX, scaleY) * 1.15));
        const closeScale = Math.max(0.08, Math.min(0.13, Math.min(scaleX, scaleY) * 0.82));

        return { offsetX, offsetY, startScale, closeScale, chatRect, fabRect };
    }

    _primeOpeningAnimationFromFab() {
        if (!this.isAdmin && this._usesTouchNarrowLayout()) {
            this._primeOpeningAnimationForBootstrapLaunch();
            return;
        }

        const motion = this._getFabMotionMetrics();
        if (!motion || !this.chatWindow) {
            this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', '0px');
            this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', '0px');
            this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', '0.2');
            this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', '0.11');
            return;
        }

        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', `${motion.offsetX}px`);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', `${motion.offsetY}px`);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', motion.startScale.toFixed(3));
        this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', motion.closeScale.toFixed(3));
    }

    _primeOpeningAnimationForBootstrapLaunch() {
        if (!this.chatWindow) return;
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', '0px');
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', '24px');
        this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', '0.94');
        this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', '0.94');
    }

    _shouldUseBootstrapHandoffOpening() {
        if (typeof document === 'undefined') return false;
        return Boolean(document.querySelector('.chat-widget-bootstrap-shell.is-visible'));
    }

    _primeOpeningAnimationForBootstrapHandoff() {
        if (!this.chatWindow) return;
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', '0px');
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', '0px');
        this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', '1');
        this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', '0.11');
    }

    _shouldDeferFabHideForOpening(useBootstrapHandoffOpening) {
        return !this.isAdmin
            && useBootstrapHandoffOpening !== true
            && this._usesTouchNarrowLayout();
    }

    _scheduleChatOpeningActivation(useBootstrapHandoffOpening, options = {}) {
        if (!this.chatWindow) return;

        const deferFabHide = options.deferFabHide === true;
        const immediateStartFrame = options.immediateStartFrame === true;
        const openingRunId = ++this._openingAnimationRunId;
        const commitOpeningStartFrame = () => {
            this._openingAnimationFrame = null;
            if (!this.isOpen || !this.chatWindow || openingRunId !== this._openingAnimationRunId) return;

            this._setChatWindowForceHidden(false);
            this._setChatWindowTransitionless(false);
            this.chatWindow.getBoundingClientRect();

            this._openingAnimationFrame = requestAnimationFrame(() => {
                this._openingAnimationFrame = null;
                if (!this.isOpen || !this.chatWindow || openingRunId !== this._openingAnimationRunId) return;

                if (deferFabHide) {
                    this._setFabHidden(true);
                }
                this.chatWindow.classList.add('active');
                if (!this.isBootstrapShellAdopted()) {
                    this.completeBootstrapShellAdoption();
                }
                this._captureStableDockHeight();
                const openingCleanupDelay = useBootstrapHandoffOpening ? 560 : 440;
                this._openingAnimationTimer = setTimeout(() => {
                    this._openingAnimationTimer = null;
                    if (!this.isOpen || !this.chatWindow || openingRunId !== this._openingAnimationRunId) return;
                    if (this.isBootstrapShellAdopted()
                        && !this.chatWindow.classList.contains('chat-window--bootstrap-adopting-content')) {
                        this.completeBootstrapShellAdoption();
                    }
                    this.chatWindow.classList.remove('chat-opening');
                    this._clearOpeningAnimationState();
                    if (!this.chatWindow.classList.contains('keyboard-docked')) {
                        this._setChatWindowTransitionless(false);
                    }
                }, openingCleanupDelay);
            });
        };

        if (immediateStartFrame) {
            commitOpeningStartFrame();
        } else {
            this._openingAnimationFrame = requestAnimationFrame(commitOpeningStartFrame);
        }
    }

    _clearOpeningAnimationState() {
        if (!this.chatWindow) return;
        this.chatWindow.classList.remove('chat-opening--bootstrap-handoff');
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-x', null);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-offset-y', null);
        this._setRuntimeStyle(this.chatWindow, '--chat-open-scale', null);
        this._setRuntimeStyle(this.chatWindow, '--chat-close-scale', null);
    }

    _finalizeChatClose() {
        if (!this.chatWindow) return;
        this._clearOpeningAnimationTimer();
        this.chatWindow.classList.remove('chat-opening');
        this.chatWindow.classList.remove('chat-opening--bootstrap-handoff');
        this.chatWindow.classList.remove('chat-closing');
        this.chatWindow.classList.remove('chat-closing-end');
        this.chatWindow.classList.remove('active');
        this._clearOpeningAnimationState();
        this._setChatWindowTransitionless(true);
        this._setChatWindowForceHidden(true);
        this._setFabDisabled(true);
        if (this.overlay) {
            this.overlay.classList.remove('chat-overlay--active');
            this.overlay.classList.remove('visible');
            this.overlay.classList.remove('closing');
        }

        this._disableSessionVisualLock();
        this._detachKeyboardListener();
        this._resetKeyboardViewportStyles();
        this._clearPendingUndockTimer();
        this._restoreOverlay();
        this._stableDockHeight = null;

        if (window.iOSScrollLock) window.iOSScrollLock.unlock();
        this._runChatCloseChromeCleanup();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (this.isOpen) return;
                this._setFabTransitionless(true);
                this._setFabHidden(false);
                this._setFabDisabled(false);
                this._scheduleFabAmbientMotion();
                requestAnimationFrame(() => {
                    if (!this.isOpen) {
                        this._setFabTransitionless(false);
                        this._setChatWindowTransitionless(false);
                    }
                });
            });
        });
    }

    _setPromptSpotlightSuspended(suspended) {
        const path = window.location.pathname || '';
        if (!/\/prompts(?:\.html)?$/i.test(path)) return;
        if (!document.body) return;

        document.body.classList.toggle('chat-spotlight-suspended', suspended);

        const container = document.querySelector('.poetry-nav-container');
        if (!container) return;
        this._toggleElementClass(container, 'chat-prompt-spotlight-suspended', suspended);
    }

    _clearTransitionCleanupTimer() {
        if (this._transitionCleanupTimer) {
            clearTimeout(this._transitionCleanupTimer);
            this._transitionCleanupTimer = null;
        }
    }

    _clearPendingFirstDock() {
        if (this._pendingFirstDockTimer) {
            clearTimeout(this._pendingFirstDockTimer);
            this._pendingFirstDockTimer = null;
        }
        this._pendingFirstDockParams = null;
    }

    _scheduleInitialKeyboardDock(visualHeight, bottomInset) {
        const requiresFirstKeyboardWarmup = this._isIOSMobile() && this._lastStableKeyboardInset <= 40;
        let predictedInset = bottomInset;
        if (this._isIOSMobile() && this._lastStableKeyboardInset > 40) {
            if (bottomInset < 24) {
                predictedInset = this._lastStableKeyboardInset;
            } else {
                predictedInset = Math.min(bottomInset, this._lastStableKeyboardInset + 12);
            }
        }
        this._pendingFirstDockParams = {
            visualHeight,
            bottomInset: predictedInset,
            animate: !requiresFirstKeyboardWarmup
        };
        if (this._pendingFirstDockTimer) return;
        const delay = requiresFirstKeyboardWarmup
            ? (this._isHighRefreshDisplay ? 120 : 88)
            : (this._isHighRefreshDisplay ? 50 : 34);
        this._pendingFirstDockTimer = setTimeout(() => {
            const params = this._pendingFirstDockParams;
            this._pendingFirstDockTimer = null;
            this._pendingFirstDockParams = null;
            if (!params || !this.isOpen || !this.chatWindow || this._keyboardDocked) return;
            if (!this._isChatInputFocused()) return;
            this._applyKeyboardDock(params.visualHeight, params.bottomInset, params.animate !== false);
            this._keyboardDocked = true;
            this._lastKeyboardInset = params.bottomInset;
            if (params.bottomInset > 40) {
                this._lastStableKeyboardInset = params.bottomInset;
            }
        }, delay);
    }

    _clearMotionVisualLockTimer() {
        if (this._motionVisualLockTimer) {
            clearTimeout(this._motionVisualLockTimer);
            this._motionVisualLockTimer = null;
        }
    }

    _applyStableVisualStyles() {
        if (!this.chatWindow) return;
        this._toggleElementClass(this.chatWindow, 'chat-window--stable-visuals', true);
    }

    _enableSessionVisualLock() {
        if (!this.chatWindow) return;
        this._setPromptSpotlightSuspended(true);
        if (!(this._isIOSMobile() && this._isNarrowViewport())) {
            this._sessionVisualLocked = false;
            return;
        }
        this._sessionVisualLocked = true;
        this._applyStableVisualStyles();
    }

    _disableSessionVisualLock() {
        this._setPromptSpotlightSuspended(false);
        this._sessionVisualLocked = false;
        this._restoreMotionVisuals();
    }

    _restoreMotionVisuals() {
        this._clearMotionVisualLockTimer();
        if (!this.chatWindow) return;
        if (this._sessionVisualLocked) {
            this._applyStableVisualStyles();
            return;
        }
        this._toggleElementClass(this.chatWindow, 'chat-window--stable-visuals', false);
    }

    _applyMotionVisualLock(duration = 180) {
        if (!this.chatWindow) return;
        if (!this._isIOSMobile() || !this._isNarrowViewport()) return;
        if (this._sessionVisualLocked) {
            this._applyStableVisualStyles();
            return;
        }
        this._clearMotionVisualLockTimer();
        // iOS 移动 backdrop-filter 图层时会偶发重采样闪烁，动画期临时关闭磨砂层。
        this._applyStableVisualStyles();
        this._motionVisualLockTimer = setTimeout(() => {
            this._motionVisualLockTimer = null;
            this._restoreMotionVisuals();
        }, Math.max(130, duration));
    }

    _applyKeyboardPreLift() {
        if (!this.chatWindow || this._keyboardPreLiftActive) return;
        this._keyboardPreLiftActive = true;
        this._clearTransitionCleanupTimer();
        this._applyMotionVisualLock(160);
        this._setChatWindowTransitionless(false);
        this._setChatWindowKeyboardAnimating(true, 250);
        this._setChatTranslateVars('-50%', -24);
        this._transitionCleanupTimer = setTimeout(() => {
            this._transitionCleanupTimer = null;
            if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                this._setChatWindowKeyboardAnimating(false);
            }
        }, 290);
    }

    _resetKeyboardViewportStyles(animate = false) {
        this._keyboardDocked = false;
        this._lastKeyboardInset = 0;
        this._keyboardPreLiftActive = false;
        if (this.chatWindow) {
            this.chatWindow.classList.remove('keyboard-docked');
            this._clearTransitionCleanupTimer();
            const resetDuration = 250;
            if (animate) {
                this._applyMotionVisualLock(resetDuration + 40);
                this._keyboardDockAnimatingUntil = performance.now() + resetDuration + 24;
                this._setChatWindowTransitionless(false);
                this._setChatWindowKeyboardAnimating(true, resetDuration);
            } else {
                this._setChatWindowKeyboardAnimating(false);
                this._setChatWindowTransitionless(true);
                this._restoreMotionVisuals();
            }
            this._setChatWindowDockHeight(null);

            if (this.isOpen && this._isNarrowViewport()) {
                this._setChatWindowDockBottom(null);
                this._setChatTranslateVars('-50%', 0);
            } else {
                this._setChatWindowDockBottom(null);
                this._setRuntimeStyle(this.chatWindow, '--chat-base-translate-y', null);
                this._setRuntimeStyle(this.chatWindow, '--chat-shift-y', null);
                this._setRuntimeStyle(this.chatWindow, 'transform', null);
            }

            if (animate) {
                this._transitionCleanupTimer = setTimeout(() => {
                    this._transitionCleanupTimer = null;
                    if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                        this._setChatWindowKeyboardAnimating(false);
                    }
                }, resetDuration + 40);
            } else {
                requestAnimationFrame(() => {
                    if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                        this._setChatWindowTransitionless(false);
                    }
                });
            }
        }

        if (this.overlay) {
            // overlay 由 _freezeOverlay/_restoreOverlay 负责生命周期管理
        }
    }

    async sendMessage() {
        const text = this.input.value.trim();
        if (!text) return;

        const optimisticCreatedAt = new Date().toISOString();

        // Optimistic UI update
        this.appendMessage(text, this.getMessageRenderType(false), 'text', optimisticCreatedAt);
        this.input.value = '';

        const autoSupportAssistPromise = this.maybeRunAutoSupportAssist(text).catch((error) => {
            console.warn('[ChatWidget] Auto support assist failed:', error?.message || error);
            return false;
        });

        try {
            const { user, sessionId } = await this.refreshUserSessionContext();
            const userId = user ? user.id : null;

            const { error } = await this.supabase
                .from('chat_messages')
                .insert({
                    content: text,
                    message_type: 'text',
                    user_id: userId,
                    session_id: sessionId,
                    site: this.getCurrentSite(),
                    is_admin: false
                });

            if (error) throw error;
            window.ZaoyoeUserPresence?.markActive?.();
            this.upsertUserHistoryCacheEntry({
                session_id: sessionId,
                content: text,
                is_admin: false,
                message_type: 'text',
                created_at: optimisticCreatedAt
            });
        } catch (err) {
            console.error('Error sending message:', err);
            // Could add retry logic or error indicator here
        }

        await autoSupportAssistPromise;
    }

    // Client-side image compression
    async compressImage(file) {
        return new Promise((resolve, reject) => {
            const maxWidth = 1920;
            const quality = 0.7;
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (maxWidth / width) * height;
                        width = maxWidth;
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            // Create a new File object with .webp extension
                            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                                type: 'image/webp',
                                lastModified: Date.now(),
                            });
                            resolve(newFile);
                        } else {
                            reject(new Error('Canvas is empty'));
                        }
                    }, 'image/webp', quality);
                };
                img.onerror = (error) => reject(error);
            };
            reader.onerror = (error) => reject(error);
        });
    }

    async handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Compress image
            const compressedFile = await this.compressImage(file);
            const { user, sessionId } = await this.refreshUserSessionContext();
            if (!user) {
                throw new Error('请先登录后再上传图片');
            }
            const userId = user.id;
            const publicUrl = await this.uploadChatImageToR2(compressedFile, {
                sessionId
            });

            const optimisticCreatedAt = new Date().toISOString();

            // Optimistic UI for Image
            this.appendMessage(publicUrl, this.getMessageRenderType(false), 'image', optimisticCreatedAt);

            await this.supabase
                .from('chat_messages')
                .insert({
                    content: publicUrl,
                    message_type: 'image',
                    user_id: userId,
                    session_id: sessionId,
                    site: this.getCurrentSite(),
                    is_admin: false
                });
            window.ZaoyoeUserPresence?.markActive?.();

            this.upsertUserHistoryCacheEntry({
                session_id: sessionId,
                content: publicUrl,
                is_admin: false,
                message_type: 'image',
                created_at: optimisticCreatedAt
            });

        } catch (err) {
            console.error('Error uploading image:', err);
            alert('图片上传失败，请重试');
        }
    }

    // isNewMessage: true for real-time messages, false for history (skip animation)
    appendMessage(content, type, messageType = 'text', timestamp = null, isNewMessage = false) {
        // Smart time display - only show if 5+ minutes since last shown time
        const currentTime = timestamp ? new Date(timestamp) : new Date();
        let showTime = false;

        if (!this.lastDisplayedTime) {
            // First message - always show time
            showTime = true;
        } else {
            const timeDiff = Math.abs(currentTime.getTime() - this.lastDisplayedTime.getTime());
            if (timeDiff >= this.timeDisplayThreshold) {
                showTime = true;
            }
        }

        // If time needs to be shown, insert a time separator BEFORE the message
        if (showTime) {
            this.lastDisplayedTime = currentTime;
            const timeStr = currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const timeSeparator = document.createElement('div');
            timeSeparator.className = 'message-time-separator';
            timeSeparator.textContent = timeStr;
            this.messagesContainer.appendChild(timeSeparator);
        }

        // Create the message bubble (no time inside)
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}${isNewMessage ? ' new-message' : ''}`;

        if (messageType === 'support-assist' && content && typeof content === 'object') {
            msgDiv.classList.add('message--support-assist');

            const textEl = document.createElement('span');
            textEl.className = 'message-text';
            textEl.textContent = String(content.text || '').trim();
            msgDiv.appendChild(textEl);

            const actions = Array.isArray(content.actions) ? content.actions : [];
            if (actions.length) {
                const actionsEl = document.createElement('div');
                actionsEl.className = 'chat-support-assist-actions';

                actions.forEach((action) => {
                    if (!action || typeof action !== 'object') return;

                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = `chat-support-assist-btn${action.primary ? ' chat-support-assist-btn--primary' : ''}${action.kind === 'root' ? ' chat-support-assist-btn--secondary' : ''}`;
                    button.textContent = String(action.label || '').trim();

                    if (action.kind === 'root') {
                        button.setAttribute('data-support-chat-root', '1');
                    } else {
                        button.setAttribute('data-support-chat-action-id', String(action.actionId || '').trim());
                        button._supportAssistState = {
                            detected: content.detected || null,
                            explanation: content.explanation || null,
                            fallbackError: content.fallbackError || ''
                        };
                    }

                    actionsEl.appendChild(button);
                });

                if (actionsEl.childNodes.length) {
                    msgDiv.appendChild(actionsEl);
                }
            }
        } else if (messageType === 'image') {
            const safeUrl = this.sanitizeMediaUrl(content);
            if (safeUrl) {
                const img = document.createElement('img');
                img.src = safeUrl;
                img.className = 'message-image';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                img.addEventListener('click', () => window.open(safeUrl, '_blank', 'noopener'));
                msgDiv.appendChild(img);
            } else {
                const fallback = document.createElement('span');
                fallback.className = 'message-text';
                fallback.textContent = this.t('chat.imageUnavailable', '[图片地址无效]');
                msgDiv.appendChild(fallback);
            }
        } else {
            msgDiv.innerHTML = `<span class="message-text">${this.escapeHtml(content)}</span>`;
        }

        this.messagesContainer.appendChild(msgDiv);

        // Only scroll for new messages (not history batch loads)
        if (isNewMessage) {
            this.scrollToBottom();
        }
    }

    getUserHistoryMessageSignature(message = {}) {
        return [
            String(message?.session_id || '').trim(),
            String(message?.created_at || '').trim(),
            String(message?.message_type || 'text').trim(),
            Boolean(message?.is_admin) ? '1' : '0',
            String(message?.content || '')
        ].join('\u001f');
    }

    areUserHistoryMessagesEquivalent(left = [], right = []) {
        if (!Array.isArray(left) || !Array.isArray(right)) return false;
        if (left.length !== right.length) return false;

        return left.every((message, index) => (
            this.getUserHistoryMessageSignature(message) === this.getUserHistoryMessageSignature(right[index])
        ));
    }

    renderUserHistoryMessages(messages = []) {
        if (!this.messagesContainer) return;

        this.clearSessionLoadingOverlayTimer();
        const loadingOverlay = this.messagesContainer.querySelector('.loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('loading-overlay--handoff');
            Array.from(this.messagesContainer.childNodes).forEach((node) => {
                if (node !== loadingOverlay) {
                    node.remove();
                }
            });
        } else {
            this.messagesContainer.innerHTML = '';
        }
        this.lastDisplayedTime = null;
        this._lastRenderedUserHistoryMessages = Array.isArray(messages) ? messages : [];

        const welcomeMessage = document.createElement('div');
        welcomeMessage.className = 'message admin';
        welcomeMessage.textContent = this.t('chat.welcomeMessage', '您好！有什么可以帮您的吗？');
        this.messagesContainer.appendChild(welcomeMessage);

        (Array.isArray(messages) ? messages : []).forEach((msg) => {
            this.appendMessage(
                msg.content,
                this.getMessageRenderType(msg.is_admin),
                msg.message_type,
                msg.created_at
            );
        });

        if (loadingOverlay) {
            this.finishUserHistoryLoadingOverlayHandoff(loadingOverlay);
        }
    }

    async fetchUserHistoryBatch(sessionIds = [], { fullHistory = false } = {}) {
        const normalizedSessionIds = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean))];
        if (!normalizedSessionIds.length) return [];

        let query = this.supabase
            .from('chat_messages')
            .select('session_id, content, is_admin, message_type, created_at');
        query = this.queryForCurrentSite(query, this.getCurrentSite());

        query = normalizedSessionIds.length === 1
            ? query.eq('session_id', normalizedSessionIds[0])
            : query.in('session_id', normalizedSessionIds);

        if (fullHistory) {
            const { data, error } = await query.order('created_at', { ascending: true });
            if (error) throw error;
            return Array.isArray(data) ? data : [];
        }

        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(80);
        if (error) throw error;
        return (Array.isArray(data) ? data : []).slice().reverse();
    }

    scheduleUserHistorySync(sessionIds = [], cacheKey = '', requestId = 0) {
        this.clearUserHistorySyncHandle();

        const run = () => {
            this._userHistorySyncHandle = null;
            this.syncUserHistoryComplete(sessionIds, cacheKey, requestId);
        };

        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            const handle = window.requestIdleCallback(run, { timeout: 700 });
            this._userHistorySyncHandle = { type: 'idle', handle };
            return;
        }

        this._userHistorySyncHandle = setTimeout(run, 180);
    }

    async syncUserHistoryComplete(sessionIds = [], cacheKey = '', requestId = 0) {
        try {
            const fullHistory = await this.fetchUserHistoryBatch(sessionIds, { fullHistory: true });
            if (requestId !== this._userHistoryLoadRequestId) return;
            if (cacheKey !== this.getSessionCacheKey(this.getActiveUserSessionIds())) return;

            const previousHistory = Array.isArray(this.userHistoryCache.get(cacheKey))
                ? this.userHistoryCache.get(cacheKey)
                : this._lastRenderedUserHistoryMessages;
            const shouldRenderFullHistory = !this.areUserHistoryMessagesEquivalent(previousHistory, fullHistory)
                && !this.areUserHistoryMessagesEquivalent(this._lastRenderedUserHistoryMessages, fullHistory);

            this.userHistoryCache.set(cacheKey, fullHistory);
            this.persistUserHistorySnapshot(sessionIds, fullHistory);

            if (shouldRenderFullHistory) {
                this.renderUserHistoryMessages(fullHistory);
                this._setMessagesContainerMinHeight(null);
                this.scrollToBottom();
            }
            this.unlockScroll();
        } catch (error) {
            console.warn('[ChatWidget] Failed to sync complete user history:', error);
        }
    }

    upsertUserHistoryCacheEntry(message = {}) {
        const activeSessionIds = this.getActiveUserSessionIds();
        const normalizedSessionId = String(message?.session_id || '').trim();
        const normalizedCreatedAt = String(message?.created_at || '').trim();
        if (!activeSessionIds.includes(normalizedSessionId) || !normalizedCreatedAt) {
            return;
        }

        const cacheKey = this.getSessionCacheKey(activeSessionIds);
        const cachedMessages = Array.isArray(this.userHistoryCache.get(cacheKey))
            ? this.userHistoryCache.get(cacheKey)
            : this.restoreUserHistorySnapshot(activeSessionIds);

        const alreadyExists = (Array.isArray(cachedMessages) ? cachedMessages : []).some((item) => (
            String(item?.session_id || '').trim() === normalizedSessionId
            && String(item?.created_at || '').trim() === normalizedCreatedAt
            && String(item?.content || '') === String(message?.content || '')
            && String(item?.message_type || 'text') === String(message?.message_type || 'text')
            && Boolean(item?.is_admin) === Boolean(message?.is_admin)
        ));
        if (alreadyExists) {
            return;
        }

        const nextMessages = [...(Array.isArray(cachedMessages) ? cachedMessages : []), {
            session_id: normalizedSessionId,
            content: message?.content || '',
            is_admin: Boolean(message?.is_admin),
            message_type: String(message?.message_type || 'text'),
            created_at: normalizedCreatedAt
        }].sort((left, right) => Date.parse(left?.created_at || 0) - Date.parse(right?.created_at || 0));

        this.userHistoryCache.set(cacheKey, nextMessages);
        this.persistUserHistorySnapshot(activeSessionIds, nextMessages);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    subscribeToMessages() {
        if (this.userMessageChannel) {
            this.supabase.removeChannel(this.userMessageChannel);
        }

        this.userMessageChannel = this.createRealtimeSubscription(
            'chat-room',
            (channel) => channel.on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: this.getCurrentSiteRealtimeFilter()
                },
                (payload) => {
                    const activeSessionIds = this.getActiveUserSessionIds();
                    if (!activeSessionIds.includes(payload.new.session_id)) {
                        return;
                    }

                    // Only append if it's NOT from us (avoid duplicate since we did optimistic UI)
                    // Or check if is_admin is true
                    if (payload.new.is_admin) {
                        // Real-time message - animate with isNewMessage=true
                        this.appendMessage(
                            payload.new.content,
                            this.getMessageRenderType(payload.new.is_admin),
                            payload.new.message_type,
                            payload.new.created_at,
                            true
                        );
                        this.upsertUserHistoryCacheEntry(payload.new);
                        void this.checkAdminStatus();

                        // Show cute notification if chat is closed
                        const messageContent = payload.new.message_type === 'image' ? '📷 发送了一张图片' : payload.new.content;
                        this.showNotification(messageContent, '💬 客服');
                    }
                }
            ),
            { feature: 'chat_widget_user_messages' }
        );
    }

    async loadHistory() {
        const requestId = ++this._userHistoryLoadRequestId;
        // PRELOAD STRATEGY: Lock scroll during history loading
        this.lockScroll();
        this.scheduleUserHistoryLoadFailsafe(requestId);

        try {
            const sessionIds = this.getActiveUserSessionIds();
            if (!sessionIds.length) {
                this.clearUserHistoryLoadFailsafeTimer();
                this.unlockScroll();
                this.renderUserHistoryLoadFallback();
                return;
            }
            const cacheKey = this.getSessionCacheKey(sessionIds);
            const cachedHistory = this.userHistoryCache.get(cacheKey) || this.restoreUserHistorySnapshot(sessionIds);

            if (Array.isArray(cachedHistory) && cachedHistory.length) {
                this.clearUserHistoryLoadFailsafeTimer();
                this.userHistoryCache.set(cacheKey, cachedHistory);
                this.renderUserHistoryMessages(cachedHistory);
                this._setMessagesContainerMinHeight(null);
                this.scrollToBottom();
                this.unlockScroll();
                this.finishUserHistoryLoadHandoff();
                this.scheduleUserHistorySync(sessionIds, cacheKey, requestId);
                return;
            }

            const useBootstrapHistoryHandoff = this.isBootstrapShellAdopted();
            if (!useBootstrapHistoryHandoff) {
                this.holdUserHistoryComposerHandoff();
                const currentHeight = this.messagesContainer.offsetHeight;
                this._setMessagesContainerMinHeight(currentHeight);
                this.clearSessionLoadingOverlayTimer();
                this._sessionLoadingOverlayTimer = setTimeout(() => {
                    if (this._userHistoryLoadRequestId !== requestId) return;
                    this.ensureSessionLoadingOverlay();
                }, 180);
            } else {
                this.clearSessionLoadingOverlayTimer();
            }

            const recentHistory = await this.fetchUserHistoryBatch(sessionIds, { fullHistory: false });
            if (requestId !== this._userHistoryLoadRequestId) return;
            this.clearUserHistoryLoadFailsafeTimer();

            this.userHistoryCache.set(cacheKey, recentHistory);
            this.persistUserHistorySnapshot(sessionIds, recentHistory);
            this.renderUserHistoryMessages(recentHistory);
            this._setMessagesContainerMinHeight(null);
            this.scrollToBottom();
            this.unlockScroll();
            this.finishUserHistoryLoadHandoff();
            this.scheduleUserHistorySync(sessionIds, cacheKey, requestId);

        } catch (err) {
            console.error('Error loading history:', err);
            if (requestId !== this._userHistoryLoadRequestId) return;
            this.clearUserHistoryLoadFailsafeTimer();
            this.removeSessionLoadingOverlay();
            this.renderUserHistoryLoadFallback();
        }
    }
}

if (typeof window !== 'undefined') {
    window.ChatWidget = ChatWidget;
}

// Auto-init specific styling for mobile viewport handling (optional)
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        // Adjust chat window height if keyboard opens on mobile
    });
}
