
class AdminChat {
    constructor() {
        this.supabase = window.supabaseClient;
        this.currentSessionId = null;
        this.sessions = [];
        this.init();
    }

    init() {
        const container = document.getElementById('chat-admin-container');
        if (!container) return;

        this.renderLayout(container);
        this.fetchSessions();
        this.subscribeToRealtime();

        document.getElementById('sessionSearch').addEventListener('input', (e) => {
            this.filterSessions(e.target.value);
        });
    }

    renderLayout(container) {
        container.innerHTML = `
            <div class="chat-container" id="chatMainContainer">
                <div class="chat-sidebar" id="chatSidebar">
                    <div class="chat-search">
                        <input type="text" id="sessionSearch" placeholder="搜索会话...">
                    </div>
                    <div class="session-list" id="sessionList">
                        <!-- Sessions will be loaded here -->
                    </div>
                </div>

                <div class="chat-main" id="chatMainPanel">
                    <div id="chatEmptyState" class="chat-empty-state">
                        <i class="fas fa-comments"></i>
                        <p>请从左侧选择一个会话开始聊天</p>
                    </div>
                    <div id="chatInterface" style="display: none; height: 100%; flex-direction: column;">
                        <div class="chat-main-header">
                            <div class="mobile-back-btn" id="mobileBackBtn">
                                <i class="fas fa-arrow-left"></i>
                            </div>
                            
                            <div class="chat-user-title">
                                <h3 id="currentChatUser">访客</h3>
                                <span id="currentChatId">ID: ...</span>
                            </div>
                        </div>
                        <div class="chat-messages-area" id="adminMessagesArea">
                            <!-- Messages -->
                        </div>
                        <div class="chat-input-wrapper">
                            <textarea class="admin-chat-input" id="adminChatInput" placeholder="输入回复... (Enter 发送)"></textarea>
                            <button class="admin-send-btn" id="adminSendBtn"><i class="fas fa-paper-plane"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('adminSendBtn').addEventListener('click', () => this.sendReply());
        document.getElementById('adminChatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendReply();
            }
        });

        document.getElementById('mobileBackBtn').addEventListener('click', () => this.backToSessions());
    }

    async fetchSessions() {
        try {
            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(500);

            if (data) {
                await this.processSessionsData(data);
                this.renderSessionList();
            }
        } catch (err) {
            console.error('Error fetching sessions:', err);
        }
    }

    async processSessionsData(messages) {
        const sessionMap = new Map();
        const userIdsToFetch = new Set();

        messages.forEach(msg => {
            if (!sessionMap.has(msg.session_id)) {
                // Determine if it's a registered user (UUID check)
                if (msg.user_id && msg.user_id.length > 20 && !msg.user_id.startsWith('guest')) {
                    userIdsToFetch.add(msg.user_id);
                }

                sessionMap.set(msg.session_id, {
                    sessionId: msg.session_id,
                    lastMessage: msg.message_type === 'image' ? '[图片]' : msg.content,
                    timestamp: new Date(msg.created_at),
                    userId: msg.user_id,
                    unread: 0,
                    profile: null // Will be populated
                });
            }
        });

        // 1. Fetch Profiles for gathered User IDs
        if (userIdsToFetch.size > 0) {
            try {
                const { data: profiles, error } = await this.supabase
                    .from('profiles')
                    .select('id, username, email, avatar_url')
                    .in('id', Array.from(userIdsToFetch));

                if (profiles) {
                    const profileMap = new Map(profiles.map(p => [p.id, p]));
                    // 2. Attach profiles to sessions
                    for (let session of sessionMap.values()) {
                        if (session.userId && profileMap.has(session.userId)) {
                            session.profile = profileMap.get(session.userId);
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to fetch profiles:", err);
            }
        }

        this.sessions = Array.from(sessionMap.values());
    }

    renderSessionList(filter = '') {
        const listEl = document.getElementById('sessionList');
        listEl.innerHTML = '';

        this.sessions
            .filter(s => {
                const name = s.profile?.username || s.sessionId;
                const email = s.profile?.email || '';
                return name.toLowerCase().includes(filter.toLowerCase()) ||
                    email.toLowerCase().includes(filter.toLowerCase());
            })
            .forEach(session => {
                const el = document.createElement('div');
                el.className = `session-item ${this.currentSessionId === session.sessionId ? 'active' : ''}`;
                el.onclick = () => this.loadSession(session.sessionId);

                const timeStr = session.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                // Determine Display Info
                let displayName = '访客';
                let displaySub = session.sessionId.substr(0, 8) + '...';
                let avatarContent = session.sessionId.substr(0, 2).toUpperCase();
                let avatarImg = '';

                if (session.profile) {
                    displayName = session.profile.username || '未命名用户';
                    displaySub = session.profile.email || '无邮箱';

                    if (session.profile.avatar_url) {
                        // Handle potential external vs Supabase storage URLs? Assume standard URL
                        avatarImg = `<img src="${session.profile.avatar_url}" style="width:100%;height:100%;object-fit:cover;">`;
                    } else {
                        avatarContent = displayName.substr(0, 1).toUpperCase();
                    }
                } else if (session.sessionId.startsWith('guest')) {
                    displayName = '访客';
                }

                // Avatar Container Style
                const avatarStyle = session.profile?.avatar_url
                    ? 'overflow:hidden; background:transparent;'
                    : '';

                el.innerHTML = `
                    <div class="session-avatar" style="${avatarStyle}">
                        ${avatarImg || avatarContent}
                    </div>
                    <div class="session-info">
                        <div class="session-header">
                            <span class="session-name">${displayName}</span>
                            <span class="session-time">${timeStr}</span>
                        </div>
                        <div class="session-preview" style="font-size:12px; color:#94a3b8; margin-bottom:2px;">${displaySub}</div>
                        <div class="session-preview">${session.lastMessage}</div>
                    </div>
                `;
                listEl.appendChild(el);
            });
    }

    async loadSession(sessionId) {
        this.currentSessionId = sessionId;
        this.renderSessionList();

        const container = document.getElementById('chatMainContainer');
        container.classList.add('mobile-chat-active');

        document.getElementById('chatEmptyState').style.display = 'none';
        const interfaceEl = document.getElementById('chatInterface');
        interfaceEl.style.display = 'flex';

        // Find Session Data for Header
        const session = this.sessions.find(s => s.sessionId === sessionId);
        let title = sessionId.startsWith('guest') ? '访客' : '用户';
        let sub = 'Session: ' + sessionId;

        if (session && session.profile) {
            title = session.profile.username || '未命名用户';
            sub = session.profile.email || sessionId;
        }

        document.getElementById('currentChatUser').textContent = title;
        document.getElementById('currentChatId').textContent = sub;

        const area = document.getElementById('adminMessagesArea');
        area.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">加载中...</div>';

        const { data, error } = await this.supabase
            .from('chat_messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

        area.innerHTML = '';

        if (data) {
            data.forEach(msg => this.appendMessage(msg));
        }

        this.scrollToBottom();
    }

    backToSessions() {
        const container = document.getElementById('chatMainContainer');
        container.classList.remove('mobile-chat-active');
        this.currentSessionId = null;
        this.renderSessionList();
    }

    appendMessage(msg) {
        const area = document.getElementById('adminMessagesArea');
        const d = document.createElement('div');
        const isSentByAdmin = msg.is_admin;

        d.className = `admin-message ${isSentByAdmin ? 'sent' : 'received'}`;

        if (msg.message_type === 'image') {
            d.innerHTML = `<img src="${msg.content}" onclick="window.open(this.src)">`;
        } else {
            d.textContent = msg.content;
        }

        area.appendChild(d);
        this.scrollToBottom();
    }

    async sendReply() {
        const input = document.getElementById('adminChatInput');
        const text = input.value.trim();
        if (!text || !this.currentSessionId) return;

        const fakeMsg = {
            id: 'temp-' + Date.now(),
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

    scrollToBottom() {
        const area = document.getElementById('adminMessagesArea');
        area.scrollTop = area.scrollHeight;
    }

    subscribeToRealtime() {
        this.supabase
            .channel('admin-chat-global')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'chat_messages' },
                (payload) => {
                    const newMsg = payload.new;
                    this.updateSessionOnNewMessage(newMsg);

                    if (this.currentSessionId === newMsg.session_id) {
                        if (!newMsg.is_admin) {
                            this.appendMessage(newMsg);
                        }
                    }
                }
            )
            .subscribe();
    }

    async updateSessionOnNewMessage(msg) {
        const existingIndex = this.sessions.findIndex(s => s.sessionId === msg.session_id);

        // If it's a new session we haven't seen, we might need to fetch profile (if new user)
        // For simplicity, just update last message.
        // If it's a completely new session, fetching profile is harder here without async overhead.
        // But renderSessionList handles missing profile gracefully.

        const sessionData = {
            sessionId: msg.session_id,
            lastMessage: msg.message_type === 'image' ? '[图片]' : msg.content,
            timestamp: new Date(msg.created_at),
            userId: msg.user_id,
            unread: 0,
            profile: null // Keep null for now or copy from existing
        };

        if (existingIndex > -1) {
            sessionData.profile = this.sessions[existingIndex].profile; // Preserve profile
            this.sessions.splice(existingIndex, 1);
            this.sessions.unshift(sessionData);
        } else {
            // New session entirely. Ideally we fetch profile here?
            // Let's try basic fetch if user_id looks like UUID
            if (msg.user_id && msg.user_id.length > 20 && !msg.user_id.startsWith('guest')) {
                const { data } = await this.supabase
                    .from('profiles')
                    .select('id, username, email, avatar_url')
                    .eq('id', msg.user_id)
                    .single();
                if (data) sessionData.profile = data;
            }
            this.sessions.unshift(sessionData);
        }

        this.renderSessionList();
    }

    filterSessions(query) {
        this.renderSessionList(query);
    }
}

window.AdminChat = AdminChat;
