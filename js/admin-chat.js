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
        this.destroyed = false;
        this.opsAlertSessionId = '__admin_ops_todo__';
        this.handleDocumentClick = this.handleDocumentClick.bind(this);

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
        }

        document.removeEventListener('click', this.handleDocumentClick);
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

    buildOpsAlertContext(alertType = '', payload = {}, title = '') {
        const targetId = String(
            payload.target_id
            || payload.order_id
            || payload.payment_order_id
            || payload.ticket_id
            || payload.message_id
            || ''
        ).trim();

        return {
            title: String(title || '').trim(),
            alertType,
            alert_type: alertType,
            category: alertType,
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
            preview: ''
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
        const preview = this.opsAlertLoadError
            ? `同步失败：${this.opsAlertLoadError}`
            : (latest?.preview || '站外告警会同步到这里');

        const subtext = this.opsAlertLoadError
            ? '站外告警同步异常'
            : `固定系统联系人${this.opsAlertMessages.length ? ` · ${this.formatCompactCount(this.opsAlertMessages.length)} 条同步` : ''}`;

        return {
            sessionId: this.opsAlertSessionId,
            kind: 'ops_alerts',
            lastMessage: preview,
            timestamp: latest?.sortTimestamp || latest?.timestamp || null,
            unread: 0,
            profile: null,
            subtext,
            badge: '置顶'
        };
    }

    composeSessions() {
        const sortedChatSessions = [...this.chatSessions].sort((left, right) => {
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
                            </div>
                        </div>
                        <div class="chat-messages-area" id="adminMessagesArea">
                            <!-- Messages -->
                        </div>
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

        const [chatResult, opsAlertResult] = await Promise.allSettled([
            this.fetchChatMessages(),
            this.fetchOpsAlertJobs()
        ]);

        if (chatResult.status === 'fulfilled') {
            await this.processSessionsData(chatResult.value);
        } else {
            console.error('Error fetching chat sessions:', chatResult.reason);
            this.chatSessions = [];
        }

        if (opsAlertResult.status === 'fulfilled') {
            this.processOpsAlertData(opsAlertResult.value);
        } else {
            console.error('Error fetching ops alert jobs:', opsAlertResult.reason);
            this.opsAlertMessages = [];
            this.opsAlertLoadError = opsAlertResult.reason?.message || '站外告警读取失败';
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
                    profile: null
                });
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

        this.chatSessions = Array.from(sessionMap.values());
    }

    processOpsAlertData(rows) {
        this.opsAlertLoadError = '';
        this.opsAlertMessages = rows
            .map((row) => this.normalizeOpsAlertJob(row))
            .filter((alert) => this.matchesOpsAlertSiteFilter(alert))
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

        return {
            name: displayName,
            subtext: displaySub,
            preview: session.lastMessage || '',
            badge: ''
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
                haystack.push(alert.title, alert.content, alert.entryPath);
            });
        } else {
            haystack.push(session.profile?.email || '', session.profile?.username || '', session.sessionId || '');
        }

        return haystack
            .join('\n')
            .toLowerCase()
            .includes(normalizedFilter);
    }

    renderSessionList(filter = '') {
        const listEl = document.getElementById('sessionList');
        if (!listEl) return;

        listEl.replaceChildren();

        this.sessions
            .filter((session) => this.sessionMatchesFilter(session, filter))
            .forEach((session) => {
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
                    badgeEl.className = 'session-badge';
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

        this.setElementHidden(inputWrapper, readonly);

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
        const area = document.getElementById('adminMessagesArea');
        if (!area) return;

        if (this.isOpsAlertSession(session)) {
            document.getElementById('currentChatUser').textContent = '站内代办';
            document.getElementById('currentChatId').textContent = '站外告警同步 / 可直接跳转处理页';
            this.setReadonlyMode(true);
            area.innerHTML = `<div class="chat-loading-state">${this.t('chat.loading', '加载中...')}</div>`;
            this.renderOpsAlertMessages();
            return;
        }

        this.setReadonlyMode(false);

        let title = sessionId.startsWith('guest') ? this.t('chat.guest', '访客') : this.t('chat.user', '用户');
        let sub = `${this.t('chat.session', 'Session')}: ${sessionId}`;

        if (session?.profile) {
            title = session.profile.username || this.t('chat.unnamed', '未命名用户');
            sub = session.profile.email || sessionId;
        }

        document.getElementById('currentChatUser').textContent = title;
        document.getElementById('currentChatId').textContent = sub;

        area.innerHTML = `<div class="chat-loading-state">${this.t('chat.loading', '加载中...')}</div>`;

        const { data } = await this.supabase
            .from('chat_messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

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

        const alerts = [...this.opsAlertMessages].sort((left, right) => {
            const leftTime = left.timestamp instanceof Date ? left.timestamp.getTime() : 0;
            const rightTime = right.timestamp instanceof Date ? right.timestamp.getTime() : 0;
            return leftTime - rightTime;
        });

        if (!alerts.length) {
            area.innerHTML = '<div class="chat-loading-state">当前筛选下还没有同步过来的站外告警。</div>';
            return;
        }

        alerts.forEach((alert) => this.appendMessage(alert, { scroll: false }));
        this.scrollToBottom();
    }

    backToSessions() {
        const container = document.getElementById('chatMainContainer');
        container?.classList.remove('mobile-chat-active');
        this.currentSessionId = null;
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

        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'admin-alert-action-btn';
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

        footer.appendChild(entry);
        footer.appendChild(actionButton);
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

                    if (this.currentSessionId === newMsg.session_id && !newMsg.is_admin) {
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
    }

    async upsertOpsAlertMessage(row) {
        const normalized = this.normalizeOpsAlertJob(row);
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
        const sessionData = {
            sessionId: msg.session_id,
            lastMessage: msg.message_type === 'image' ? this.t('chat.image', '[图片]') : msg.content,
            timestamp: new Date(msg.created_at),
            userId: msg.user_id,
            unread: 0,
            profile: null
        };

        if (existingIndex > -1) {
            sessionData.profile = this.chatSessions[existingIndex].profile;
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
