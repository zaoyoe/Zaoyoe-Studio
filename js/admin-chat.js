class AdminChat {
    constructor(targetContainer = null) {
        const previousInstance = window.adminChatInstance;
        if (previousInstance && previousInstance !== this && typeof previousInstance.destroy === 'function') {
            previousInstance.destroy();
        }

        this.supabase = window.supabaseClient;
        this.currentSessionId = null;
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
        this.sessionSlaTimer = null;
        this.sessionQueueView = 'all';
        this.sessionQueueFilter = 'all';
        this.sessionQueueDefaultView = 'all';
        this.sessionQueueDefaultFilter = 'all';
        this.opsAlertCaseActionLocks = new Set();
        this.opsAlertBatchAssignBusy = false;
        this.opsAlertViewFilter = 'all';
        this.opsAlertOwnerFilter = 'all';
        this.opsAlertAssignableAdmins = [];
        this.opsAlertCurrentAdminId = '';
        this.opsAlertCurrentAdminLabel = '';
        this.opsAlertModuleMuteRules = {};
        this.userContextCache = new Map();
        this.userContextRecentActions = new Map();
        this.currentUserContext = null;
        this.currentSessionInfo = null;
        this.replyTemplateConfigTemplates = null;
        this.replyTemplateConfigLoadedAt = 0;
        this.replyTemplateConfigPromise = null;
        this._replyTemplateRenderToken = 0;
        this._userContextRequestId = 0;
        this.destroyed = false;
        this.opsAlertSessionId = '__admin_ops_todo__';
        this.handleDocumentClick = this.handleDocumentClick.bind(this);
        this.handleOpsAlertConfigUpdated = this.handleOpsAlertConfigUpdated.bind(this);
        this.restoreSessionQueuePreferences();
        window.addEventListener('ops-alerts-config-updated', this.handleOpsAlertConfigUpdated);

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
        }

        if (this.sessionSlaTimer) {
            window.clearInterval(this.sessionSlaTimer);
            this.sessionSlaTimer = null;
        }

        document.removeEventListener('click', this.handleDocumentClick);
        window.removeEventListener('ops-alerts-config-updated', this.handleOpsAlertConfigUpdated);
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

        try {
            const parsed = new URL(trimmed, window.location.origin);
            if (['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
                return parsed.href;
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

        const initialSeed = (session.sessionId || displayName || '?').trim();
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

        const items = context ? this.getUserContextHeaderStatusItems(context) : [];
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
        return this.userContextRecentActions.get(cacheKey) || null;
    }

    rememberUserContextAction(context = {}, action = {}) {
        const cacheKey = String(context.cacheKey || action._contextCacheKey || '').trim();
        if (!cacheKey) return null;

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
        const profileEmail = String(session?.profile?.email || '').trim();
        if (profileEmail) {
            return profileEmail;
        }
        const sessionId = String(session?.sessionId || '').trim();
        return this.looksLikeEmail(sessionId) ? sessionId : '';
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
                        .select('verification_id, status, message, created_at')
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
            return;
        }
        panel.hidden = false;
        panel.className = `chat-context-panel chat-context-panel--${variant}`;
        panel.innerHTML = `<div class="chat-context-panel__state">${this.escapeHtml(text)}</div>`;
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

    getUserContextQuickActions(context = {}) {
        const actions = [];
        const latestOrder = this.getLatestUserContextRecord(context.orders);
        const latestPayment = this.getLatestUserContextRecord(context.payments);
        const latestVerification = this.getLatestUserContextRecord(context.verifications);
        const latestTicket = this.getLatestUserContextRecord(context.tickets);
        const openTicket = (Array.isArray(context.tickets) ? context.tickets : [])
            .find((ticket) => !['resolved', 'rejected'].includes(String(ticket?.status || '').trim().toLowerCase()));

        const userSearchValue = String(context.userId || context.email || '').trim();
        if (userSearchValue) {
            actions.push({
                key: 'user',
                label: '查用户',
                hint: context.userId
                    ? `UUID ${String(context.userId || '').slice(0, 8)}`
                    : this.truncateText(context.email || '当前会话', 24),
                workspaceKey: 'shop-risk-users',
                context: {
                    userId: context.userId || '',
                    email: context.email || '',
                    targetId: context.userId || userSearchValue,
                    target_id: context.userId || userSearchValue,
                    referenceLabel: context.userId ? '用户' : '邮箱',
                    referenceValue: userSearchValue
                }
            });
        }

        const orderId = String(latestOrder?.id || latestTicket?.order_id || '').trim();
        if (orderId) {
            actions.push({
                key: 'order',
                label: '打开订单',
                hint: `订单 ${orderId.slice(0, 8)}`,
                workspaceKey: 'shop-risk-orders',
                context: {
                    orderId,
                    targetId: orderId,
                    target_id: orderId,
                    referenceLabel: '订单',
                    referenceValue: orderId
                }
            });
        }

        const ticketId = String(latestTicket?.id || '').trim();
        if (ticketId) {
            const isResolved = String(latestTicket?.status || '').trim().toLowerCase() === 'resolved';
            actions.push({
                key: 'ticket',
                label: isResolved ? '查看工单' : '处理工单',
                hint: `工单 ${ticketId.slice(0, 8)}`,
                workspaceKey: isResolved ? 'tickets-resolved' : 'tickets-pending',
                context: {
                    ticketId,
                    ticketStatus: latestTicket?.status || '',
                    targetId: ticketId,
                    target_id: ticketId,
                    referenceLabel: '工单号',
                    referenceValue: ticketId
                }
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

        if (latestPayment) {
            const paymentId = String(latestPayment.id || '').trim();
            const paymentUserId = String(latestPayment.user_id || context.userId || '').trim();
            const paymentUserReference = String(paymentUserId || context.email || '').trim();
            actions.push({
                key: 'payment',
                label: '充值记录',
                hint: paymentId ? `支付单 ${paymentId.slice(0, 8)}` : '最近充值',
                workspaceKey: paymentUserReference ? 'shop-risk-users' : 'payments-overview',
                context: paymentUserReference ? {
                    userId: paymentUserId,
                    email: context.email || '',
                    paymentOrderId: paymentId,
                    targetId: paymentUserId || paymentUserReference,
                    target_id: paymentUserId || paymentUserReference,
                    referenceLabel: paymentUserId ? '支付单' : '邮箱',
                    referenceValue: paymentUserId
                        ? (paymentId || String(latestPayment.package_name || '最近充值').trim())
                        : paymentUserReference,
                    defaultTab: 'payments',
                    tab: 'payments'
                } : {
                    paymentOrderId: paymentId,
                    targetId: paymentId,
                    target_id: paymentId,
                    referenceLabel: paymentId ? '支付单' : '充值',
                    referenceValue: paymentId || String(latestPayment.package_name || '最近充值').trim()
                }
            });
        }

        const verificationId = String(latestVerification?.verification_id || '').trim();
        if (verificationId) {
            actions.push({
                key: 'verify',
                label: '验证面板',
                hint: this.truncateText(verificationId, 22),
                workspaceKey: 'verify-monitor',
                context: {
                    verificationId,
                    targetId: verificationId,
                    target_id: verificationId,
                    referenceLabel: '验证任务',
                    referenceValue: verificationId
                }
            });
        }

        return actions.slice(0, 5);
    }

    canCreateUserContextTicket(context = {}, { openTicket = null } = {}) {
        if (!context || typeof context !== 'object') {
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
            latestVerification ? `最近验证：${this.truncateText(latestVerification.verification_id || '验证任务', 24)}（${this.formatUserContextStatus(latestVerification.status)}）` : ''
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
            this.rememberUserContextAction(nextContext, {
                label: '处理工单',
                workspaceKey: 'tickets-pending',
                context: {
                    ticketId: String(ticket.id || '').trim(),
                    targetId: String(ticket.id || '').trim(),
                    target_id: String(ticket.id || '').trim(),
                    referenceLabel: '工单号',
                    referenceValue: String(ticket.id || '').trim()
                },
                _contextCacheKey: context.cacheKey
            });
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

        try {
            let result = false;
            if (typeof window.openOpsAlertWorkspace === 'function') {
                result = await window.openOpsAlertWorkspace(workspaceKey, action.context || {});
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
            if (!orderId) return null;
            return {
                key: 'order',
                label: '打开订单',
                workspaceKey: 'shop-risk-orders',
                context: {
                    orderId,
                    targetId: orderId,
                    target_id: orderId,
                    referenceLabel: '订单',
                    referenceValue: orderId
                }
            };
        }

        if (kind === 'payment') {
            const paymentId = String(item.id || '').trim();
            const paymentUserId = String(item.user_id || context.userId || '').trim();
            const paymentUserReference = String(paymentUserId || context.email || '').trim();
            return {
                key: 'payment',
                label: '查看充值记录',
                workspaceKey: paymentUserReference ? 'shop-risk-users' : 'payments-overview',
                context: paymentUserReference ? {
                    userId: paymentUserId,
                    email: context.email || '',
                    paymentOrderId: paymentId,
                    targetId: paymentUserId || paymentUserReference,
                    target_id: paymentUserId || paymentUserReference,
                    referenceLabel: paymentUserId ? '支付单' : '邮箱',
                    referenceValue: paymentUserId
                        ? (paymentId || String(item.package_name || '最近充值').trim())
                        : paymentUserReference,
                    defaultTab: 'payments',
                    tab: 'payments'
                } : {
                    paymentOrderId: paymentId,
                    targetId: paymentId,
                    target_id: paymentId,
                    referenceLabel: paymentId ? '支付单' : '充值',
                    referenceValue: paymentId || String(item.package_name || '最近充值').trim()
                }
            };
        }

        if (kind === 'verify') {
            const verificationId = String(item.verification_id || '').trim();
            if (!verificationId) return null;
            return {
                key: 'verify',
                label: '打开验证面板',
                workspaceKey: 'verify-monitor',
                context: {
                    verificationId,
                    targetId: verificationId,
                    target_id: verificationId,
                    referenceLabel: '验证任务',
                    referenceValue: verificationId
                }
            };
        }

        if (kind === 'ticket') {
            const ticketId = String(item.id || '').trim();
            if (!ticketId) return null;
            const isResolved = String(item.status || '').trim().toLowerCase() === 'resolved';
            return {
                key: 'ticket',
                label: isResolved ? '查看工单' : '处理工单',
                workspaceKey: isResolved ? 'tickets-resolved' : 'tickets-pending',
                context: {
                    ticketId,
                    ticketStatus: item.status || '',
                    targetId: ticketId,
                    target_id: ticketId,
                    referenceLabel: '工单号',
                    referenceValue: ticketId
                }
            };
        }

        return null;
    }

    buildUserContextTimelineEntries(context = {}) {
        const entries = [];

        (Array.isArray(context.orders) ? context.orders : []).forEach((order) => {
            const action = this.buildUserContextTimelineAction('order', order, context);
            entries.push({
                kind: 'order',
                label: '订单',
                time: String(order.created_at || '').trim(),
                title: this.truncateText(order.snapshot_product_name || `订单 ${String(order.id || '').slice(0, 8)}`, 48),
                meta: `${this.formatUserContextPoints(order.price_paid)} · ${this.formatUserContextStatus(order.delivery_status || order.refund_status)}`,
                action: action ? { ...action, _contextCacheKey: context.cacheKey || '' } : null,
                isRecent: action ? this.isUserContextActionRecent(context, action) : false
            });
        });

        (Array.isArray(context.payments) ? context.payments : []).forEach((payment) => {
            const action = this.buildUserContextTimelineAction('payment', payment, context);
            entries.push({
                kind: 'payment',
                label: '充值',
                time: String(payment.created_at || '').trim(),
                title: this.truncateText(payment.package_name || `支付单 ${String(payment.id || '').slice(0, 8)}`, 48),
                meta: `${this.formatUserContextCurrency(payment.paid_amount, this.formatUserContextCurrency(payment.expected_amount))} · ${this.formatUserContextStatus(payment.status)}`,
                action: action ? { ...action, _contextCacheKey: context.cacheKey || '' } : null,
                isRecent: action ? this.isUserContextActionRecent(context, action) : false
            });
        });

        (Array.isArray(context.verifications) ? context.verifications : []).forEach((item) => {
            const action = this.buildUserContextTimelineAction('verify', item, context);
            entries.push({
                kind: 'verify',
                label: '验证',
                time: String(item.created_at || '').trim(),
                title: this.truncateText(item.verification_id || '验证任务', 48),
                meta: `${this.formatUserContextStatus(item.status)} · ${this.truncateText(item.message || '暂无描述', 30)}`,
                action: action ? { ...action, _contextCacheKey: context.cacheKey || '' } : null,
                isRecent: action ? this.isUserContextActionRecent(context, action) : false
            });
        });

        (Array.isArray(context.tickets) ? context.tickets : []).forEach((ticket) => {
            const action = this.buildUserContextTimelineAction('ticket', ticket, context);
            entries.push({
                kind: 'ticket',
                label: '工单',
                time: String(ticket.created_at || '').trim(),
                title: this.truncateText(ticket.description || `工单 ${String(ticket.id || '').slice(0, 8)}`, 48),
                meta: `${this.formatUserContextStatus(ticket.status)}${ticket.order_id ? ` · 订单 ${String(ticket.order_id).slice(0, 8)}` : ''}`,
                action: action ? { ...action, _contextCacheKey: context.cacheKey || '' } : null,
                isRecent: action ? this.isUserContextActionRecent(context, action) : false
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
            return;
        }

        panel.hidden = false;
        panel.className = 'chat-context-panel';
        panel.replaceChildren();
        this.renderUserContextHeaderStatus(context);
        this.renderReplyTemplateBar(context);

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
            main: this.truncateText(item.verification_id || '验证任务', 42),
            sub: `${this.formatUserContextStatus(item.status)} · ${this.truncateText(item.message || '暂无描述', 26)} · ${this.formatUserContextDate(item.created_at)}`
        })), '最近没有验证记录'));

        grid.appendChild(this.createUserContextSection('售后工单', context.tickets.map((ticket) => ({
            main: this.truncateText(ticket.description || `工单 ${String(ticket.id || '').slice(0, 8)}`, 42),
            sub: `${this.formatUserContextStatus(ticket.status)}${ticket.order_id ? ` · 订单 ${String(ticket.order_id).slice(0, 8)}` : ''} · ${this.formatUserContextDate(ticket.created_at)}`
        })), '最近没有售后工单'));

        card.appendChild(grid);
        card.appendChild(this.createUserContextTimelineSection(this.buildUserContextTimelineEntries(context)));
        panel.appendChild(card);
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
            .filter((alert) => String(alert.case_status || '').trim().toLowerCase() !== 'resolved')
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
                .filter((alert) => String(alert.case_status || '').trim().toLowerCase() !== 'resolved')
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

    getOpsAlertReferenceLabel(payload = {}) {
        if (payload.ticket_id) return '工单号';
        if (payload.order_id) return '订单号';
        if (payload.payment_order_id) return '充值单号';
        if (payload.provider_order_no) return '支付单号';
        if (payload.message_id) return '消息ID';
        if (payload.session_id) return '会话ID';
        if (payload.user_id) return '用户ID';
        if (payload.target_id) return '目标';
        return '';
    }

    getOpsAlertReferenceValue(payload = {}) {
        return String(
            payload.ticket_id
            || payload.order_id
            || payload.payment_order_id
            || payload.provider_order_no
            || payload.message_id
            || payload.session_id
            || payload.user_id
            || payload.target_id
            || ''
        ).trim();
    }

    getOpsAlertTargetId(payload = {}) {
        return String(
            payload.target_id
            || payload.order_id
            || payload.payment_order_id
            || payload.ticket_id
            || payload.message_id
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

    buildOpsAlertCaseKey(categoryKey = '', targetId = '') {
        return `${String(categoryKey || '').trim().toLowerCase()}::${String(targetId || '').trim()}`;
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

    applyOpsAlertCaseRecord(alert = {}, row = null) {
        const caseRecord = row ? this.normalizeOpsAlertCaseRecord(row) : null;
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
        if (String(alert.case_status || '').trim().toLowerCase() === 'resolved') {
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
                category_key: alert.caseCategoryKey,
                target_id: alert.caseTargetId,
                alert_type: alert.alertType || '',
                title: alert.title || '',
                note: normalizedNote,
                metadata: {
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
            window.showToast?.('这条代办还没有关联工单', 'info');
            return false;
        }

        if (typeof window.openOpsAlertWorkspace !== 'function') {
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
        return window.openOpsAlertWorkspace('tickets-pending', context);
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
            console.warn('[AdminChat] Failed to load ops alert monitor meta:', error);
            return {
                assignable_admins: this.opsAlertAssignableAdmins,
                current_admin_id: this.opsAlertCurrentAdminId,
                current_admin_label: this.opsAlertCurrentAdminLabel
            };
        }
    }

    getFilteredOpsAlertMessages() {
        let alerts = Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [];
        if (this.opsAlertViewFilter === 'mine') {
            if (!this.opsAlertCurrentAdminId) {
                return alerts;
            }
            alerts = alerts.filter((alert) => String(alert.case_owner_admin_id || '').trim() === this.opsAlertCurrentAdminId);
        }
        if (this.opsAlertViewFilter === 'active') {
            alerts = alerts.filter((alert) => String(alert.case_status || '').trim().toLowerCase() !== 'resolved');
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
        const normalized = ['mine', 'active'].includes(normalizedRaw) ? normalizedRaw : 'all';
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
            .filter((alert) => String(alert.case_status || '').trim().toLowerCase() !== 'resolved');
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

    getBatchAssignableOpsAlerts() {
        const filteredAlerts = this.getFilteredOpsAlertMessages();
        const caseMap = new Map();
        filteredAlerts
            .filter((alert) => String(alert.case_status || '').trim().toLowerCase() !== 'resolved')
            .forEach((alert) => {
                const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId);
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
                .map((row) => [this.buildOpsAlertCaseKey(row.category_key, row.target_id), row])
        );

        this.opsAlertMessages = (Array.isArray(this.opsAlertMessages) ? this.opsAlertMessages : [])
            .map((alert) => {
                const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId);
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
                        source: 'admin_chat_toolbar_batch_assign',
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

    createOpsAlertToolbarElement() {
        const wrapper = document.createElement('div');
        wrapper.className = 'admin-alert-toolbar';

        const title = document.createElement('div');
        title.className = 'admin-alert-toolbar-copy';
        title.textContent = '筛选范围';
        wrapper.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'admin-alert-toolbar-actions';

        [
            { key: 'all', label: '全部' },
            { key: 'active', label: '未关闭' },
            { key: 'mine', label: '我认领的' }
        ].forEach((item) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `admin-alert-toolbar-btn${this.opsAlertViewFilter === item.key ? ' is-active' : ''}`;
            button.textContent = item.label;
            if (item.key === 'mine' && !this.opsAlertCurrentAdminId) {
                button.disabled = true;
            }
            button.addEventListener('click', () => this.setOpsAlertViewFilter(item.key));
            actions.appendChild(button);
        });

        wrapper.appendChild(actions);

        const ownerOptions = this.getOpsAlertOwnerFilterOptions();
        this.syncOpsAlertOwnerFilter(ownerOptions);
        if (ownerOptions.length > 1) {
            const ownerFilterWrap = document.createElement('label');
            ownerFilterWrap.className = 'admin-alert-toolbar-filter';

            const ownerFilterLabel = document.createElement('span');
            ownerFilterLabel.className = 'admin-alert-toolbar-copy';
            ownerFilterLabel.textContent = '负责人';
            ownerFilterWrap.appendChild(ownerFilterLabel);

            const ownerSelect = document.createElement('select');
            ownerSelect.className = 'admin-alert-toolbar-select';
            ownerOptions.forEach((option) => {
                const optionEl = document.createElement('option');
                optionEl.value = option.value;
                optionEl.textContent = option.label;
                if (option.value === this.opsAlertOwnerFilter) {
                    optionEl.selected = true;
                }
                ownerSelect.appendChild(optionEl);
            });
            ownerSelect.addEventListener('change', (event) => {
                this.setOpsAlertOwnerFilter(event.target.value);
            });
            ownerFilterWrap.appendChild(ownerSelect);
            wrapper.appendChild(ownerFilterWrap);
        }

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
            const caseKey = this.buildOpsAlertCaseKey(item.caseCategoryKey, item.caseTargetId);
            if (itemMap.has(caseKey)) {
                return;
            }
            itemMap.set(caseKey, {
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
            const caseKey = this.buildOpsAlertCaseKey(sourceAlert.caseCategoryKey, sourceAlert.caseTargetId);
            itemMap.set(caseKey, {
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
            message: `已将${selection.moduleLabel}稍后至 ${this.formatDetailTime(selection.until)}`,
            until: selection.until,
            moduleLabel: selection.moduleLabel
        };
    }

    async fetchOpsAlertCasesForAlerts(alerts = []) {
        const normalizedAlerts = Array.isArray(alerts) ? alerts : [];
        const targetIds = [...new Set(normalizedAlerts.map((alert) => String(alert.caseTargetId || '').trim()).filter(Boolean))];
        const categoryKeys = [...new Set(normalizedAlerts.map((alert) => String(alert.caseCategoryKey || '').trim().toLowerCase()).filter(Boolean))];

        if (!targetIds.length || !categoryKeys.length || !this.supabase?.from) {
            return new Map();
        }

        try {
            const { data, error } = await this.supabase
                .from('ops_alert_cases')
                .select('id, category_key, target_id, status, owner_admin_id, owner_label, note, resolution, last_action, last_action_at, created_at, updated_at')
                .in('category_key', categoryKeys)
                .in('target_id', targetIds);

            if (error) {
                throw error;
            }

            return new Map(
                (Array.isArray(data) ? data : [])
                    .map((row) => this.normalizeOpsAlertCaseRecord(row))
                    .filter(Boolean)
                    .map((row) => [this.buildOpsAlertCaseKey(row.category_key, row.target_id), row])
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
            const targetId = String(alert.caseTargetId || '').trim();
            if (!categoryKey || !targetId) {
                return accumulator;
            }
            if (!accumulator.has(categoryKey)) {
                accumulator.set(categoryKey, []);
            }
            accumulator.get(categoryKey).push(targetId);
            return accumulator;
        }, new Map());

        const eventMap = new Map();
        try {
            for (const [categoryKey, targetIds] of groupedTargets.entries()) {
                const { data, error } = await this.supabase
                    .from('ops_alert_case_events')
                    .select('id, category_key, target_id, action, status, owner_admin_id, owner_label, actor_admin_id, actor_label, note, resolution, metadata, created_at')
                    .in('category_key', [categoryKey])
                    .in('target_id', Array.from(new Set(targetIds)))
                    .order('created_at', { ascending: false });

                if (error) {
                    throw error;
                }

                (Array.isArray(data) ? data : []).forEach((row) => {
                    const event = this.normalizeOpsAlertCaseEventRecord(row);
                    if (!event) {
                        return;
                    }
                    const caseKey = this.buildOpsAlertCaseKey(event.category_key, event.target_id);
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
        return (Array.isArray(alerts) ? alerts : []).map((alert) => {
            const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId);
            this.applyOpsAlertCaseRecord(alert, caseMap.get(caseKey) || null);
            return this.applyOpsAlertCaseEvents(alert, eventMap.get(caseKey) || []);
        });
    }

    async refreshOpsAlertCaseStateForAlerts(alerts = []) {
        const uniqueAlerts = Array.from(new Map(
            (Array.isArray(alerts) ? alerts : [])
                .filter((alert) => alert?.caseCategoryKey && alert?.caseTargetId)
                .map((alert) => [this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId), alert])
        ).values());
        if (!uniqueAlerts.length) {
            return [];
        }

        const [caseMap, eventMap] = await Promise.all([
            this.fetchOpsAlertCasesForAlerts(uniqueAlerts),
            this.fetchOpsAlertCaseEventsForAlerts(uniqueAlerts)
        ]);

        uniqueAlerts.forEach((alert) => {
            const caseKey = this.buildOpsAlertCaseKey(alert.caseCategoryKey, alert.caseTargetId);
            this.applyOpsAlertCaseRecord(alert, caseMap.get(caseKey) || null);
            this.applyOpsAlertCaseEvents(alert, eventMap.get(caseKey) || []);
        });
        return uniqueAlerts;
    }

    async getOpsAlertCaseApiHeaders() {
        if (typeof window.getAdminConfigApiHeaders === 'function') {
            return window.getAdminConfigApiHeaders();
        }

        const { data: { session } = { session: null } } = await this.supabase.auth.getSession();
        const headers = {
            'Content-Type': 'application/json'
        };
        if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`;
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

        const headers = await this.getOpsAlertCaseApiHeaders();
        const response = await fetch('/api/admin/settings/ops-alert-monitor-cases', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                action: normalizedAction,
                category_key: alert.caseCategoryKey,
                target_id: alert.caseTargetId,
                alert_type: alert.alertType || '',
                title: alert.title || '',
                owner_admin_id: ownerAdminId,
                owner_label: ownerLabel,
                note,
                resolution,
                metadata: {
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

    buildOpsAlertContext(alertType = '', payload = {}, title = '') {
        const targetId = this.getOpsAlertTargetId(payload);
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

    resolveEntryPathWorkspace(entryPath = '', baseContext = {}) {
        const normalized = String(entryPath || '').trim();
        if (!normalized) {
            return { kind: 'none' };
        }

        if (normalized.includes('客服消息')) {
            return {
                kind: 'chat-session',
                context: baseContext
            };
        }
        if (normalized.includes('订单列表 / 优惠券码')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-discounts',
                context: baseContext
            };
        }
        if (normalized.includes('订单列表 / 用户详情') || normalized.includes('用户详情')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-users',
                context: baseContext
            };
        }
        if (normalized.includes('履约任务') || normalized.includes('异常订单')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-fulfillment',
                context: baseContext
            };
        }
        if (normalized.includes('库存 / 补货') || normalized.includes('库存')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-inventory',
                context: baseContext
            };
        }
        if (normalized.includes('支付配置审计') || normalized.includes('异常登录信号')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'admin-audit-monitor',
                context: baseContext
            };
        }
        if (normalized.includes('验证服务配置')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'verify-monitor',
                context: baseContext
            };
        }
        if (normalized.includes('售后工单')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: normalized.includes('已处理') ? 'tickets-resolved' : 'tickets-pending',
                context: baseContext
            };
        }
        if (normalized.includes('支付总览') || normalized.includes('异常运维')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'payments-ops',
                context: baseContext
            };
        }
        if (normalized.includes('最近订单')) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'payments-overview',
                context: baseContext
            };
        }
        if (normalized.includes('订单列表')) {
            return {
                kind: 'shop-orders',
                context: baseContext
            };
        }

        return { kind: 'none' };
    }

    resolveShopRiskWorkspace(baseContext = {}, payload = {}) {
        const signalType = String(payload.signal_type || '').trim().toLowerCase();
        if (String(payload.discount_code || '').trim()) {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-discounts',
                context: baseContext
            };
        }
        if (String(payload.user_id || '').trim() && signalType === 'user_velocity') {
            return {
                kind: 'ops-workspace',
                workspaceKey: 'shop-risk-users',
                context: baseContext
            };
        }
        return {
            kind: 'ops-workspace',
            workspaceKey: 'shop-risk-orders',
            context: baseContext
        };
    }

    resolveOpsAlertWorkspace(alertType = '', payload = {}, title = '', entryPath = '') {
        const baseContext = this.buildOpsAlertContext(alertType, payload, title);

        switch (String(alertType || '').trim().toLowerCase()) {
            case 'customer_chat_message_received':
            case 'customer_chat_message_summary':
                return {
                    kind: 'chat-session',
                    context: baseContext
                };
            case 'shop_purchase_succeeded':
            case 'shop_purchase_summary':
                return {
                    kind: 'shop-orders',
                    context: baseContext
                };
            case 'wallet_recharge_succeeded':
            case 'wallet_recharge_summary':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'payments-overview',
                    context: baseContext
                };
            case 'shop_inventory_summary':
            case 'shop_inventory_low':
            case 'shop_inventory_empty':
            case 'shop_inventory_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'shop-inventory',
                    context: baseContext
                };
            case 'ticket_new':
            case 'ticket_sla_summary':
            case 'ticket_sla_overdue':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'tickets-pending',
                    context: baseContext
                };
            case 'ticket_sla_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'tickets-resolved',
                    context: baseContext
                };
            case 'shop_order_delivery_summary':
            case 'shop_order_delivery_failed':
            case 'shop_order_delivery_recovered':
            case 'shop_order_delivery_incident':
            case 'shop_order_delivery_incident_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'shop-fulfillment',
                    context: baseContext
                };
            case 'payment_gateway_summary':
            case 'payment_gateway_degraded':
            case 'payment_gateway_recovered':
            case 'payment_refund_ops':
            case 'payment_refund_alert':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'payments-ops',
                    context: baseContext
                };
            case 'payment_config_changed':
            case 'payment_config_recovered':
            case 'payment_config_incident':
            case 'payment_config_incident_recovered':
            case 'security_admin_login_anomaly':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'admin-audit-monitor',
                    context: baseContext
                };
            case 'verify_quota_summary':
            case 'verify_quota_low':
            case 'verify_service_disabled':
            case 'verify_queue_summary':
            case 'verify_queue_backlog':
            case 'verify_failure_summary':
            case 'verify_failure_rate_spike':
            case 'verify_incident_escalated':
            case 'verify_incident_recovered':
                return {
                    kind: 'ops-workspace',
                    workspaceKey: 'verify-monitor',
                    context: baseContext
                };
            case 'shop_order_risk_anomaly':
            case 'shop_order_risk_recovered':
                return this.resolveShopRiskWorkspace(baseContext, payload);
            default:
                return this.resolveEntryPathWorkspace(entryPath, baseContext);
        }
    }

    normalizeOpsAlertJob(row = {}) {
        const payload = this.parseJsonObject(row.payload);
        const alertType = String(row.alert_type || '').trim().toLowerCase();
        const content = String(row.content || '').trim();
        const entryPath = String(payload.entry_path || '').trim() || this.extractEntryPathFromContent(content);
        const createdAt = row.created_at || row.updated_at || new Date().toISOString();
        const updatedAt = row.updated_at || createdAt;
        const targetId = this.getOpsAlertTargetId(payload);
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
            caseCategoryKey,
            caseTargetId: targetId,
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

        const site = String(alert.payload?.site || '').trim().toLowerCase();
        return !site || site === siteFilter;
    }

    buildOpsAlertSession() {
        const latest = this.opsAlertMessages[0] || null;
        const activeCount = this.getOpsAlertActiveCount();
        const mutedModuleCount = this.getOpsAlertMutedModuleCount();
        const ownerSummary = this.getOpsAlertOwnerSummary();
        const preview = this.opsAlertLoadError
            ? `同步失败：${this.opsAlertLoadError}`
            : (latest?.preview || '站外告警会同步到这里');

        const subtextParts = this.opsAlertLoadError
            ? ['站外告警同步异常']
            : [ownerSummary || '固定系统联系人'];
        if (!this.opsAlertLoadError && this.opsAlertMessages.length) {
            subtextParts.push(`${this.formatCompactCount(this.opsAlertMessages.length)} 条同步`);
        }
        if (activeCount > 0) {
            subtextParts.push(`未关闭 ${this.formatCompactCount(activeCount)}`);
        }
        if (mutedModuleCount > 0) {
            subtextParts.push(`静音 ${this.formatCompactCount(mutedModuleCount)} 组`);
        }
        const subtext = subtextParts.join(' · ');
        const badge = this.opsAlertLoadError
            ? '异常'
            : activeCount > 0
                ? `${this.formatCompactCount(activeCount)}待办`
                : mutedModuleCount > 0
                    ? `${this.formatCompactCount(mutedModuleCount)}静音`
                    : '置顶';

        return {
            sessionId: this.opsAlertSessionId,
            kind: 'ops_alerts',
            lastMessage: preview,
            timestamp: latest?.sortTimestamp || latest?.timestamp || null,
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
    }

    init() {
        const container = this.targetContainer || document.getElementById('chat-admin-container');
        if (!container) return;

        this.renderLayout(container);
        this.fetchSessions();
        this.subscribeToRealtime();
        this.startSessionSlaTicker();

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
                    <div class="chat-search">
                        <input type="text" id="sessionSearch" placeholder="${this.t('chat.searchPlaceholder', '搜索会话...')}">
                    </div>
                    <div class="session-queue-overview" id="sessionQueueOverview"></div>
                    <div class="session-queue-snapshot" id="sessionQueueSnapshot"></div>
                    <div class="session-queue-presets" id="sessionQueueViews"></div>
                    <div class="session-filter-bar" id="sessionFilterBar"></div>
                    <div class="session-list" id="sessionList">
                        <!-- Sessions will be loaded here -->
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
                        <div class="chat-input-wrapper" id="chatInputWrapper">
                            <input type="file" id="adminImageInput" class="admin-chat-file-input" accept="image/*" hidden>
                            <button class="chat-action-btn" id="adminUploadBtn"><i class="fas fa-plus"></i></button>
                            <textarea class="admin-chat-input" id="adminChatInput" placeholder="${this.t('chat.inputPlaceholder', '输入回复...')}"></textarea>
                            <button class="chat-action-btn" id="adminEmojiBtn"><i class="far fa-smile"></i></button>
                            <button class="admin-send-btn" id="adminSendBtn"><i class="fas fa-paper-plane"></i></button>
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

        document.addEventListener('click', this.handleDocumentClick);
    }

    async fetchChatMessages() {
        let query = this.supabase
            .from('chat_messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500);

        if (window.AdminSiteFilter) {
            query = window.AdminSiteFilter.applySiteFilter(query);
        }

        const { data, error } = await query;
        if (error) {
            throw error;
        }
        return Array.isArray(data) ? data : [];
    }

    async fetchOpsAlertJobs() {
        const { data, error } = await this.supabase
            .from('ops_alert_jobs')
            .select('id, alert_type, severity, title, content, payload, status, last_error, created_at, updated_at, delivered_at')
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

        const [chatResult, opsAlertResult, opsAlertMetaResult, opsAlertConfigResult] = await Promise.allSettled([
            this.fetchChatMessages(),
            this.fetchOpsAlertJobs(),
            this.ensureOpsAlertMonitorMeta(),
            this.fetchOpsAlertSettingsConfig()
        ]);

        if (chatResult.status === 'fulfilled') {
            await this.processSessionsData(chatResult.value);
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

        this.composeSessions();
        this.renderSessionList(this.searchQuery);

        if (this.currentSessionId && this.isOpsAlertSessionId(this.currentSessionId)) {
            this.renderOpsAlertMessages();
        }
    }

    async processSessionsData(messages) {
        const sessionMap = new Map();
        const userIdsToFetch = new Set();

        messages.forEach((msg) => {
            if (!sessionMap.has(msg.session_id)) {
                if (msg.user_id && msg.user_id.length > 20 && !msg.user_id.startsWith('guest')) {
                    userIdsToFetch.add(msg.user_id);
                }

                sessionMap.set(msg.session_id, {
                    sessionId: msg.session_id,
                    lastMessage: msg.message_type === 'image' ? this.t('chat.image', '[图片]') : msg.content,
                    timestamp: new Date(msg.created_at),
                    userId: msg.user_id,
                    unread: 0,
                    profile: null,
                    lastUserMessageAt: null,
                    lastAdminMessageAt: null,
                    replySummary: null
                });
            }

            const session = sessionMap.get(msg.session_id);
            if (msg.is_admin) {
                if (!session.lastAdminMessageAt) {
                    session.lastAdminMessageAt = msg.created_at;
                }
            } else if (!session.lastUserMessageAt) {
                session.lastUserMessageAt = msg.created_at;
            }
        });

        if (userIdsToFetch.size > 0) {
            try {
                const { data: profiles } = await this.supabase
                    .from('profiles')
                    .select('id, username, email, avatar_url')
                    .in('id', Array.from(userIdsToFetch));

                if (profiles) {
                    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
                    for (const session of sessionMap.values()) {
                        if (session.userId && profileMap.has(session.userId)) {
                            session.profile = profileMap.get(session.userId);
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to fetch profiles:', err);
            }
        }

        this.chatSessions = (await this.attachSessionTicketSummaries(Array.from(sessionMap.values())))
            .map((session) => ({
                ...session,
                replySummary: this.buildSessionReplySummary(session.lastUserMessageAt, session.lastAdminMessageAt)
            }));
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

        let displayName = this.t('chat.guest', '访客');
        let displaySub = session.sessionId.substr(0, 8) + '...';

        if (session.profile) {
            displayName = session.profile.username || this.t('chat.unnamed', '未命名用户');
            displaySub = session.profile.email || this.t('chat.noEmail', '无邮箱');
        } else if (session.sessionId.startsWith('guest')) {
            displayName = this.t('chat.guest', '访客');
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
                session.sessionId || '',
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
            emptyEl.textContent = this.getSessionQueueEmptyMessage(filter);
            listEl.appendChild(emptyEl);
            return;
        }

        visibleSessions.forEach((session) => {
                const display = this.getSessionDisplayInfo(session);
                const el = document.createElement('div');
                el.className = `session-item ${this.currentSessionId === session.sessionId ? 'active' : ''} ${this.isOpsAlertSession(session) ? 'session-item--ops' : ''}`;
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

                const timeEl = document.createElement('span');
                timeEl.className = 'session-time';
                timeEl.textContent = this.formatSessionTime(session.timestamp);

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
    }

    async loadSession(sessionId) {
        this.currentSessionId = sessionId;
        this.renderSessionList(this.searchQuery);

        const container = document.getElementById('chatMainContainer');
        container?.classList.add('mobile-chat-active');

        this.setElementHidden(document.getElementById('chatEmptyState'), true);
        const interfaceEl = document.getElementById('chatInterface');
        this.setElementHidden(interfaceEl, false);

        const session = this.sessions.find((item) => item.sessionId === sessionId);
        this.currentSessionInfo = session || null;
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
            sessionId,
            userId: session?.profile?.id || session?.userId || '',
            email: this.resolveSessionContextEmail(session),
            orders: [],
            payments: [],
            verifications: [],
            tickets: []
        });

        let title = sessionId.startsWith('guest') ? this.t('chat.guest', '访客') : this.t('chat.user', '用户');
        let sub = `${this.t('chat.session', 'Session')}: ${sessionId}`;

        if (session?.profile) {
            title = session.profile.username || this.t('chat.unnamed', '未命名用户');
            sub = session.profile.email || sessionId;
        }

        document.getElementById('currentChatUser').textContent = title;
        document.getElementById('currentChatId').textContent = sub;

        area.innerHTML = this.buildMessageAreaLoadingSkeleton();
        this.renderUserContextPanelState('正在整理用户上下文...', 'loading');

        const [messagesResult, contextResult] = await Promise.allSettled([
            this.supabase
                .from('chat_messages')
                .select('*')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: true }),
            this.fetchUser360Context(session || {})
        ]);

        if (contextRequestId !== this._userContextRequestId) {
            return;
        }

        const { data } = messagesResult.status === 'fulfilled'
            ? messagesResult.value
            : { data: [] };
        if (contextResult.status === 'fulfilled') {
            this.currentUserContext = contextResult.value;
            this.renderUser360Context(contextResult.value);
        } else {
            this.currentUserContext = null;
            this.renderUserContextPanelState('暂时无法读取用户上下文', 'error');
        }

        if (messagesResult.status !== 'fulfilled' || messagesResult.value?.error) {
            area.innerHTML = `<div class="chat-loading-state chat-loading-state--error">${this.escapeHtml(this.t('chat.loadFailed', '加载失败'))}</div>`;
            return;
        }

        area.innerHTML = '';
        (data || []).forEach((message) => this.appendMessage(message, { scroll: false }));
        this.scrollToBottom();
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
            let message = this.opsAlertViewFilter === 'mine'
                ? '当前还没有你认领的站内代办。'
                : this.opsAlertViewFilter === 'active'
                    ? '当前没有未关闭的站内代办。'
                    : '当前筛选下还没有同步过来的站外告警。';
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
        this.currentSessionInfo = null;
        this.currentUserContext = null;
        this.renderUserContextHeaderStatus(null);
        this.renderReplyTemplateBar(null);
        this.setElementHidden(document.getElementById('chatEmptyState'), false);
        this.setElementHidden(document.getElementById('chatInterface'), true);
        this.renderSessionList(this.searchQuery);
    }

    createOpsAlertMessageElement(alert = {}) {
        const wrapper = document.createElement('div');
        wrapper.className = `admin-message received admin-message--ops-alert admin-message--severity-${this.escapeHtml(alert.severity || 'warning')}`;
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
        body.textContent = alert.displayContent || alert.content || alert.title || '系统告警';

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
        } catch (err) {
            console.error('Failed to send:', err);
        }
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
            const fileName = `admin_${Date.now()}_${file.name}`;
            const { error: uploadError } = await this.supabase.storage
                .from('chat-images')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: urlData } = this.supabase.storage
                .from('chat-images')
                .getPublicUrl(fileName);

            const imageUrl = urlData.publicUrl;
            document.querySelector(`[data-id="${tempId}"]`)?.remove();

            await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    content: imageUrl,
                    message_type: 'image',
                    is_admin: true
                });

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
        if (!this.supabase?.channel) {
            return;
        }

        this.chatChannel = this.supabase
            .channel(`admin-chat-global-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'chat_messages' },
                (payload) => {
                    const newMsg = payload.new;
                    this.updateSessionOnNewMessage(newMsg);

                    if (this.currentSessionId === newMsg.session_id && (!newMsg.is_admin || this.isTicketSyncChatMessage(newMsg))) {
                        this.appendMessage(newMsg);
                    }
                }
            )
            .subscribe();

        this.opsAlertChannel = this.supabase
            .channel(`admin-ops-alerts-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'ops_alert_jobs' },
                (payload) => this.upsertOpsAlertMessage(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'ops_alert_jobs' },
                (payload) => this.upsertOpsAlertMessage(payload.new)
            )
            .subscribe();

        this.ticketChannel = this.supabase
            .channel(`admin-ticket-context-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'shop_tickets' },
                (payload) => this.handleTicketRealtimeChange(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'shop_tickets' },
                (payload) => this.handleTicketRealtimeChange(payload.new)
            )
            .subscribe();

        this.paymentChannel = this.supabase
            .channel(`admin-payment-context-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'payment_orders' },
                (payload) => this.handlePaymentRealtimeChange(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'payment_orders' },
                (payload) => this.handlePaymentRealtimeChange(payload.new)
            )
            .subscribe();

        this.verificationChannel = this.supabase
            .channel(`admin-verification-context-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'verification_logs' },
                (payload) => this.handleVerificationRealtimeChange(payload.new)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'verification_logs' },
                (payload) => this.handleVerificationRealtimeChange(payload.new)
            )
            .subscribe();
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
        const existingIndex = this.chatSessions.findIndex((session) => session.sessionId === msg.session_id);
        const existingSession = existingIndex > -1 ? this.chatSessions[existingIndex] : null;
        const sessionData = {
            sessionId: msg.session_id,
            lastMessage: msg.message_type === 'image' ? this.t('chat.image', '[图片]') : msg.content,
            timestamp: new Date(msg.created_at),
            userId: msg.user_id,
            unread: 0,
            profile: null,
            paymentSummary: existingSession?.paymentSummary || null,
            verificationSummary: existingSession?.verificationSummary || null,
            ticketSummary: existingSession?.ticketSummary || null,
            lastUserMessageAt: existingSession?.lastUserMessageAt || null,
            lastAdminMessageAt: existingSession?.lastAdminMessageAt || null,
            replySummary: null
        };

        if (msg.is_admin) {
            sessionData.lastAdminMessageAt = msg.created_at;
        } else {
            sessionData.lastUserMessageAt = msg.created_at;
        }
        sessionData.replySummary = this.buildSessionReplySummary(sessionData.lastUserMessageAt, sessionData.lastAdminMessageAt);

        if (existingIndex > -1) {
            sessionData.profile = existingSession?.profile || null;
            this.chatSessions.splice(existingIndex, 1);
            this.chatSessions.unshift(sessionData);
        } else {
            if (msg.user_id && msg.user_id.length > 20 && !msg.user_id.startsWith('guest')) {
                const { data } = await this.supabase
                    .from('profiles')
                    .select('id, username, email, avatar_url')
                    .eq('id', msg.user_id)
                    .single();
                if (data) sessionData.profile = data;
            }
            this.chatSessions.unshift(sessionData);
        }

        if (msg.user_id) {
            await this.refreshSessionOperationalSummariesForUserIds([msg.user_id]);
            return;
        }

        this.composeSessions();
        this.renderSessionList(this.searchQuery);
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

    async openChatSessionFromAlert(context = {}) {
        const sessionId = String(context.sessionId || context.session_id || context.referenceValue || '').trim();
        window.switchModule?.('chat');
        await this.settleWorkspace(80);

        const instance = window.adminChatInstance || this;
        if (sessionId) {
            await instance.loadSession(sessionId);
            return true;
        }

        instance.backToSessions();
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

    async openShopOrdersFromAlert(context = {}) {
        const searchValue = this.getContextSearchValue(context);
        window.switchModule?.('shop');
        await this.settleWorkspace(80);

        await window.ShopAdmin?.init?.();
        window.ShopAdmin?.switchTab?.('orders');
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

    async openPaymentsOverviewFromAlert() {
        window.switchModule?.('payments');
        await this.settleWorkspace(80);

        await window.AdminPayments?.init?.();
        window.AdminPayments?.switchTab?.('overview', { reload: false });
        await this.settleWorkspace(80);

        this.scrollToElement('paymentsOrdersTable');
        window.showToast?.('已打开支付最近订单', 'success');
        return true;
    }

    async handleOpsAlertNavigation(alert = {}) {
        const workspace = alert.workspace || { kind: 'none' };

        try {
            if (workspace.kind === 'chat-session') {
                return await this.openChatSessionFromAlert(workspace.context || {});
            }

            if (workspace.kind === 'shop-orders') {
                return await this.openShopOrdersFromAlert(workspace.context || {});
            }

            if (workspace.kind === 'ops-workspace' && typeof window.openOpsAlertWorkspace === 'function') {
                if (workspace.workspaceKey === 'payments-overview') {
                    return await this.openPaymentsOverviewFromAlert();
                }
                return await window.openOpsAlertWorkspace(workspace.workspaceKey, workspace.context || {});
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
