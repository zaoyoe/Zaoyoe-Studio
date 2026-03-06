
class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.isVerifyPage = /(^|\/)verify(?:\.html)?\/?$/i.test(window.location.pathname || '');
        this.sessionId = this.getSessionId();
        this.supabase = window.supabaseClient; // Assuming global supabase client
        this.unreadCount = 0; // Track unread messages
        this.lastMessageTime = null; // Track last seen message
        this.unreadSessions = new Set(); // Track sessions with unread messages (admin mode)

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
        this._keyboardSettleTimer = null;
        this._transitionCleanupTimer = null;
        this._keyboardBlurUndocking = false;
        this._keyboardPreLiftActive = false;
        this._motionVisualLockTimer = null;
        this._sessionVisualLocked = false;

        this._ensureVisualLockStyles();
        this.init();
    }

    // i18n helper with fallback
    t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            return window.i18n.t(key);
        }
        return fallback || key;
    }

    _ensureVisualLockStyles() {
        if (document.getElementById('chat-widget-visual-lock-styles')) return;
        const style = document.createElement('style');
        style.id = 'chat-widget-visual-lock-styles';
        style.textContent = `
            .chat-window.visual-solid {
                background: rgb(20, 20, 30) !important;
                border-color: rgba(86, 90, 108, 0.98) !important;
                box-shadow: 0 24px 56px rgba(0, 0, 0, 0.62) !important;
            }
            .chat-window.visual-solid,
            .chat-window.visual-solid * {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
            .chat-window.visual-solid .chat-header,
            .chat-window.visual-solid .chat-input-area,
            .chat-window.visual-solid .admin-sidebar,
            .chat-window.visual-solid .admin-chat-header,
            .chat-window.visual-solid .admin-chat-area {
                background: rgb(24, 24, 36) !important;
            }
            .chat-window.visual-solid .chat-messages {
                background: rgb(16, 16, 28) !important;
            }
            .chat-window.visual-solid .emoji-picker-popover {
                background: rgb(28, 28, 40) !important;
            }
            .chat-overlay.visual-solid {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                background: rgba(0, 0, 0, 0.38) !important;
            }
        `;
        document.head.appendChild(style);
    }

    getSessionId() {
        let sid = localStorage.getItem('chat_session_id');
        if (!sid) {
            sid = 'guest_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('chat_session_id', sid);
        }
        return sid;
    }

    async init() {
        this.renderFAB();
        this.bindFabEvents();

        // Check if user is admin
        let isAdmin = false;
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            // Hardcoded check for super admin as per request logic
            if (user && user.email === 'zaoyoe@gmail.com') {
                isAdmin = true;
            }
        } catch (e) { console.error(e); }

        if (isAdmin) {
            this.renderAdminMode();

            // Listen for language changes and update text
            window.addEventListener('languageChanged', () => {
                if (this.isAdmin && this.chatWindow) {
                    this.updateAdminModeText();
                }
            });
        } else {
            // For logged-in users, use their email as session_id instead of guest ID
            try {
                const { data: { user } } = await this.supabase.auth.getUser();
                if (user && user.email) {
                    this.sessionId = user.email;
                }
            } catch (e) { console.error('Failed to get user for session:', e); }

            this.renderUserMode();
            // User mode specific logic
            this.bindUserEvents(); // Split bindEvents
            this.subscribeToMessages();
            this.loadHistory();
            this.checkAdminStatus();
            setInterval(() => this.checkAdminStatus(), 60000);
        }
    }

    async checkAdminStatus() {
        try {
            // Find the latest message from an admin
            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('created_at')
                .eq('is_admin', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            const statusText = this.chatWindow.querySelector('.target-admin-status');
            const statusDot = this.chatWindow.querySelector('.status-dot');

            if (!statusText || !statusDot) return;

            if (error || !data) {
                // No admin history, default to just "Active" or similar, or keep "Online" for positivity
                // But honestly, if no data, maybe "admin offline"
                statusText.innerText = this.t('chat.adminOffline', '管理员离线');
                statusDot.className = "status-dot offline";
                return;
            }

            const lastActive = new Date(data.created_at);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastActive) / (1000 * 60));

            if (diffMinutes < 15) {
                statusText.innerText = this.t('chat.adminOnline', '管理员在线');
                statusDot.className = "status-dot online";
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

    renderFAB() {
        // Create FAB with Custom Mascot (CSS Art)
        this.fab = document.createElement('div');
        this.fab.className = 'chat-widget-fab';
        this.fab.innerHTML = `
            <div class="mascot-wrapper">
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
        `;
        document.body.appendChild(this.fab);
    }

    bindFabEvents() {
        this.fab.addEventListener('click', () => {
            this.toggleChat();
            // Clear unread count when opening chat
            if (this.isOpen) {
                this.clearUnread();
            }
        });
    }

    // ===== Notification System =====

    showNotification(message, senderName = null, forceShow = false) {
        senderName = senderName || this.t('chat.newMessage', '新消息');
        // Don't show notification if chat is open (unless forceShow is true)
        if (this.isOpen && !forceShow) return;

        // Increment unread count
        this.unreadCount++;
        this.updateBadge();

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
                setTimeout(() => preview.remove(), 400);
            }
        }, 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
        this.currentSessionId = null;
        this.sessions = [];

        this.chatWindow = document.createElement('div');
        this.chatWindow.className = 'chat-window admin-mode-layout';

        // Create overlay for clicking outside to close
        this.overlay = document.createElement('div');
        this.overlay.className = 'chat-overlay';
        document.body.appendChild(this.overlay);

        this.chatWindow.innerHTML = `
            <!-- Left Sidebar: Session List -->
            <div class="admin-sidebar">
                <div class="admin-sidebar-header">
                    <h3>${this.t('chat.sidebarTitle', '客服消息')}</h3>
                    <button class="chat-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="admin-search">
                    <input type="text" id="sessionSearch" placeholder="🔍 ${this.t('chat.searchPlaceholderFull', '搜索会话或聊天记录...')}">
                </div>
                <div class="session-list" id="sessionList">
                    <div class="session-loading">${this.t('chat.loading', '加载中...')}</div>
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
                    </div>
                </div>
                <div class="chat-messages" id="chatMessages">
                    <div class="empty-state">
                        <i class="fas fa-comments"></i>
                        <p>${this.t('chat.emptyState', '请从左侧选择一个会话开始回复')}</p>
                    </div>
                </div>
                <div class="chat-input-area">
                    <input type="file" id="chatImageInput" accept="image/*" style="display: none;">
                    <button class="chat-action-btn" id="chatUploadBtn"><i class="fas fa-plus"></i></button>
                    <input type="text" class="chat-input" id="chatInput" placeholder="${this.t('chat.inputPlaceholder', '输入回复...')}">
                    <button class="chat-action-btn" id="chatEmojiBtn"><i class="far fa-smile"></i></button>
                    <button class="chat-send-btn" id="chatSendBtn"><i class="fas fa-paper-plane"></i></button>
                </div>
                <div class="emoji-picker-popover" id="emojiPicker">
                    ${this.emojis.map(e => `<div class="emoji-item">${e}</div>`).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(this.chatWindow);

        this.messagesContainer = this.chatWindow.querySelector('#chatMessages');
        this.input = this.chatWindow.querySelector('#chatInput');
        this.emojiPicker = this.chatWindow.querySelector('#emojiPicker');
        this.sessionList = this.chatWindow.querySelector('#sessionList');
        this.chatHeader = this.chatWindow.querySelector('#adminChatHeader');

        // Inject admin layout styles
        this.injectAdminLayoutStyles();

        // Bind events
        this.bindAdminEvents();

        // Load sessions
        this.loadAdminSessions();

        // Subscribe to all messages for admin
        this.subscribeToAdminMessages();
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
        if (chatUserName && !this.currentSessionId) {
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
    }

    injectAdminLayoutStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Admin Mode Layout - Two Column with Glassmorphism */
            .chat-window.admin-mode-layout {
                width: 700px !important;
                max-width: 95vw;
                height: 600px;
                max-height: 85vh;
                display: flex;
                flex-direction: row;
                border-radius: 20px;
                overflow: hidden;
                /* Glassmorphism effect - balanced transparency */
                background: rgba(20, 20, 30, 0.7) !important;
                backdrop-filter: blur(20px) saturate(150%) !important;
                -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                box-shadow: 
                    0 25px 50px -12px rgba(0, 0, 0, 0.6) !important;
            }
            
            /* Left Sidebar */
            .admin-sidebar {
                width: 240px;
                min-width: 200px;
                display: flex;
                flex-direction: column;
                background: rgba(0, 0, 0, 0.15);
                border-right: 1px solid rgba(255, 255, 255, 0.1);
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
            .admin-search input::placeholder {
                color: rgba(255, 255, 255, 0.4);
            }
            
            /* Session List */
            .session-list {
                flex: 1;
                overflow-y: auto;
            }
            .session-list::-webkit-scrollbar { width: 4px; }
            .session-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
            
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
                background: rgba(102, 126, 234, 0.2);
                border-left: 3px solid #667eea;
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
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 14px;
                flex-shrink: 0;
            }
            
            .session-info {
                flex: 1;
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
            .session-email {
                color: rgba(255, 255, 255, 0.4);
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            /* Search match count badge */
            .search-match-count {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            
            .session-loading {
                padding: 20px;
                text-align: center;
                color: rgba(255, 255, 255, 0.5);
            }
            
            /* Right Chat Area */
            .admin-chat-area {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-width: 0;
            }
            
            .admin-chat-header {
                padding: 15px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.03);
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
            
            .admin-mode-layout .chat-messages {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
                scroll-behavior: auto !important; /* Force instant scrolling */
                overscroll-behavior-y: contain; /* Prevent scroll chaining */
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
            
            /* Overlay for clicking outside to close — no opacity transition to avoid flash */
            .chat-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.25);
                z-index: 9998;
                backdrop-filter: blur(3px);
                visibility: hidden;
                pointer-events: none;
                transition: visibility 0s linear 0.4s;
            }
            .chat-overlay.visible {
                visibility: visible;
                pointer-events: auto;
                transition: visibility 0s;
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
            
            /* Mobile/Narrow: Slide Navigation Pattern */
            @media (max-width: 700px) {
                .chat-window.admin-mode-layout {
                    width: 380px !important;
                    max-width: 95vw;
                    height: 550px !important;
                    max-height: 80vh;
                    border-radius: 20px !important;
                    overflow: hidden;
                    /* Center the modal on mobile */
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    transform: translate(-50%, -50%) !important;
                }
                
                /* Mobile: Side by side sliding panels */
                .admin-sidebar {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: transparent;
                    z-index: 2;
                    transition: transform 0.3s ease-out;
                    display: flex;
                    flex-direction: column;
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
                
                /* Input always at bottom */
                .admin-mode-layout .chat-input-area {
                    flex: 0 0 auto;
                    padding: 10px 12px;
                }
            }
            
            /* Very narrow screens */
            @media (max-width: 480px) {
                .chat-window.admin-mode-layout {
                    width: 95vw;
                    height: 75vh;
                    border-radius: 16px;
                }
            }
            
            /* Loading Spinner for message loading */
            .loading-overlay .loading-spinner {
                width: 32px;
                height: 32px;
                border: 3px solid rgba(255, 255, 255, 0.2);
                border-top-color: rgba(102, 126, 234, 0.8);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    async loadAdminSessions() {
        try {
            // Get current admin user to exclude from list
            const { data: { user: currentUser } } = await this.supabase.auth.getUser();
            const adminUserId = currentUser?.id;

            // Get all messages grouped by session, including user_id for lookup
            const { data: messages, error } = await this.supabase
                .from('chat_messages')
                .select('session_id, created_at, content, is_admin, user_id')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Only use USER messages (not admin replies) for grouping sessions
            const userMessages = messages.filter(m => !m.is_admin);

            // Collect all user IDs from USER messages (for looking up guest sessions with logged-in users)
            const userIds = [...new Set(userMessages.filter(m => m.user_id).map(m => m.user_id))];

            // Fetch user info from profiles table using user IDs
            let userMapById = new Map();

            if (userIds.length > 0) {
                const { data: profiles } = await this.supabase
                    .from('profiles')
                    .select('id, email, username')
                    .in('id', userIds);

                if (profiles) {
                    profiles.forEach(u => {
                        userMapById.set(u.id, u);
                    });
                }
            }

            // Group USER messages by user_id (for logged-in users) or session_id (for pure guests)
            // This merges all sessions from the same user into one
            const userSessionMap = new Map(); // key: user_id or session_id, value: { lastMsg, sessionIds[] }

            userMessages.forEach(msg => {
                // Determine the grouping key: prefer user_id for registered users
                const groupKey = msg.user_id || msg.session_id;

                // Skip admin's own messages (don't show admin as a chat session)
                if (groupKey === adminUserId) return;

                if (!userSessionMap.has(groupKey)) {
                    userSessionMap.set(groupKey, {
                        lastMsg: msg,
                        sessionIds: new Set([msg.session_id]),
                        userId: msg.user_id
                    });
                } else {
                    // Add this session_id to the set (for loading all messages later)
                    userSessionMap.get(groupKey).sessionIds.add(msg.session_id);
                }
            });

            // Build sessions with user info
            this.sessions = Array.from(userSessionMap.entries()).map(([groupKey, data]) => {
                const msg = data.lastMsg;
                const userInfo = data.userId ? userMapById.get(data.userId) : null;

                // Determine display name: use username if available, else email username, else "访客" for guests
                let displayNickname;
                if (userInfo?.username) {
                    displayNickname = userInfo.username;
                } else if (userInfo?.email) {
                    displayNickname = userInfo.email.split('@')[0];
                } else if (groupKey.includes && groupKey.includes('@')) {
                    displayNickname = groupKey.split('@')[0];
                } else {
                    displayNickname = this.t('chat.guest', '访客');
                }

                return {
                    id: groupKey, // Use user_id or session_id as the identifier
                    sessionIds: Array.from(data.sessionIds), // All session_ids for this user (for message loading)
                    nickname: displayNickname,
                    email: userInfo?.email || (groupKey.includes && groupKey.includes('@') ? groupKey : null),
                    lastLogin: msg.created_at,
                    lastMessage: msg.content,
                    lastTime: msg.created_at,
                    isAdmin: msg.is_admin,
                    userId: data.userId
                };
            });

            // Render session list
            this.sessionList.innerHTML = '';
            if (this.sessions.length === 0) {
                this.sessionList.innerHTML = `<div class="session-loading">${this.t('chat.noSessions', '暂无会话')}</div>`;
                return;
            }

            this.sessions.forEach(s => {
                const item = document.createElement('div');
                item.className = 'session-item';
                item.dataset.sessionId = s.id;

                // Check if any of this user's session IDs are in unreadSessions
                const sessionIds = s.sessionIds || [s.id];
                const hasUnread = sessionIds.some(sid => this.unreadSessions.has(sid));
                if (hasUnread) {
                    item.classList.add('unread');
                }

                const initials = s.id.startsWith('guest_') ? 'G' : s.nickname.charAt(0).toUpperCase();
                const preview = s.lastMessage.length > 20 ? s.lastMessage.slice(0, 20) + '...' : s.lastMessage;
                const time = this.formatTime(s.lastTime);
                const displayName = s.nickname.length > 12 ? s.nickname.slice(0, 12) + '...' : s.nickname;
                const displayEmail = s.id.startsWith('guest_') ? '' : (s.email.length > 20 ? s.email.slice(0, 20) + '...' : s.email);

                item.innerHTML = `
                    <div class="session-avatar">${initials}</div>
                    <div class="session-info">
                        <div class="session-name">${displayName}</div>
                        <div class="session-email">${displayEmail}</div>
                        <div class="session-preview">${preview}</div>
                    </div>
                    <div class="session-time">${time}</div>
                    ${hasUnread ? '<div class="unread-dot"></div>' : ''}
                `;

                item.addEventListener('click', () => this.selectSession(s.id, s));
                this.sessionList.appendChild(item);
            });

        } catch (err) {
            console.error('Failed to load sessions:', err);
            this.sessionList.innerHTML = `<div class="session-loading">${this.t('chat.loadFailed', '加载失败')}</div>`;
        }
    }

    formatTime(isoString) {
        const date = new Date(isoString);
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

    selectSession(sessionId, sessionInfo = null) {
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

        // Update header with user info
        this.chatHeader.querySelector('.chat-user-name').textContent = sessionInfo.nickname;
        // Show email if available, otherwise show session ID
        const displayId = sessionInfo.email && !sessionInfo.email.startsWith('guest_')
            ? sessionInfo.email
            : (sessionInfo.id.includes('@') ? sessionInfo.id : sessionInfo.id);
        this.chatHeader.querySelector('.chat-user-id').textContent = displayId;

        // Update or add online status indicator
        let statusContainer = this.chatHeader.querySelector('.user-status-indicator');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.className = 'user-status-indicator';
            this.chatHeader.querySelector('.chat-user-info').appendChild(statusContainer);
        }

        // Calculate online status based on last activity
        const lastActivity = new Date(sessionInfo.lastLogin || sessionInfo.lastTime);
        const now = new Date();
        const diffMins = Math.floor((now - lastActivity) / 60000);

        let statusClass, statusText;
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

        statusContainer.innerHTML = `<span class="status-dot ${statusClass}"></span><span class="status-text">${statusText}</span>`;

        // Slide to chat view on mobile
        this.chatWindow.classList.add('chat-active');

        // Clear unread status for this session
        const sessionIdsToMark = sessionInfo.sessionIds || [sessionId];
        sessionIdsToMark.forEach(sid => this.unreadSessions.delete(sid));
        // Refresh list to remove unread styling
        this.loadAdminSessions();

        // Load messages (pass all session IDs for merged sessions)
        this.loadSessionMessages(sessionInfo.sessionIds || [sessionId]);
    }

    // Lock scroll during preloading
    lockScroll() {
        if (this.messagesContainer) {
            this.isPreloading = true;
            this.messagesContainer.classList.add('scroll-locked');
            this.messagesContainer.style.overflowY = 'hidden';
        }
    }

    // Unlock scroll after preloading complete
    unlockScroll() {
        if (this.messagesContainer) {
            this.isPreloading = false;
            this.messagesContainer.classList.remove('scroll-locked');
            this.messagesContainer.style.overflowY = '';
        }
    }

    // HIGH REFRESH RATE OPTIMIZATION: Disable expensive effects during scroll
    // 240Hz and above monitors need frame times < 4.16ms, backdrop-filter can't keep up
    setupScrollOptimization() {
        if (!this.messagesContainer) return;

        // Target element: chatWindow for user mode, or find .chat-container for admin mode
        const targetElement = this.chatWindow || document.querySelector('.chat-container');
        if (!targetElement) return;

        let scrollTimeout = null;
        let isScrolling = false;

        const onScroll = () => {
            // Add is-scrolling class immediately when scroll starts
            if (!isScrolling) {
                isScrolling = true;
                targetElement.classList.add('is-scrolling');

                // Also add to chat-container if it exists (admin mode)
                const chatContainer = document.querySelector('.chat-container');
                if (chatContainer && chatContainer !== targetElement) {
                    chatContainer.classList.add('is-scrolling');
                }
            }

            // Clear existing timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // Remove is-scrolling class 150ms after scroll stops
            scrollTimeout = setTimeout(() => {
                isScrolling = false;
                targetElement.classList.remove('is-scrolling');

                // Also remove from chat-container
                const chatContainer = document.querySelector('.chat-container');
                if (chatContainer && chatContainer !== targetElement) {
                    chatContainer.classList.remove('is-scrolling');
                }
            }, 150);
        };

        // Use passive listener for best scroll performance
        this.messagesContainer.addEventListener('scroll', onScroll, { passive: true });
    }

    async loadSessionMessages(sessionIds) {
        // sessionIds can be an array (merged user) or will be converted to array
        const sessionIdArray = Array.isArray(sessionIds) ? sessionIds : [sessionIds];
        this.currentSessionIds = sessionIdArray;
        // Set currentSessionId for sending messages (use first one as the reply session)
        this.currentSessionId = sessionIdArray[0];

        // PRELOAD STRATEGY: Lock scroll during message loading
        this.lockScroll();

        // Preserve current scroll state and container height to prevent scroll jump
        const currentHeight = this.messagesContainer.offsetHeight;

        // Set min-height to preserve layout during content swap
        this.messagesContainer.style.minHeight = currentHeight + 'px';

        // Add loading overlay instead of clearing content (prevents scroll position loss)
        let loadingOverlay = this.messagesContainer.querySelector('.loading-overlay');
        if (!loadingOverlay) {
            loadingOverlay = document.createElement('div');
            loadingOverlay.className = 'loading-overlay';
            loadingOverlay.innerHTML = '<div class="loading-spinner"></div><span>预加载消息中...</span>';
            loadingOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(20, 20, 30, 0.85);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 10px;
                color: rgba(255, 255, 255, 0.7);
                font-size: 14px;
                z-index: 10;
                backdrop-filter: blur(4px);
            `;
            // Ensure container has relative positioning for overlay
            this.messagesContainer.style.position = 'relative';
            this.messagesContainer.appendChild(loadingOverlay);
        }

        try {
            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('*')
                .in('session_id', sessionIdArray)
                .order('created_at', { ascending: true });

            if (error) throw error;

            // Clear existing content first
            this.messagesContainer.innerHTML = '';
            // Reset smart time display for new session
            this.lastDisplayedTime = null;

            // Batch render all messages (preload complete set before enabling scroll)
            data.forEach(msg => {
                this.appendMessage(msg.content, msg.is_admin ? 'admin' : 'user', msg.message_type === 'image' ? 'image' : 'text', msg.created_at);
            });

            // Remove min-height constraint after content is loaded
            this.messagesContainer.style.minHeight = '';

            // Scroll to bottom (new conversation loaded)
            this.scrollToBottom();

            // PRELOAD COMPLETE: Unlock scroll after all messages are rendered
            this.unlockScroll();

        } catch (err) {
            console.error('Failed to load messages:', err);
            // Remove loading overlay on error
            if (loadingOverlay && loadingOverlay.parentNode) {
                loadingOverlay.remove();
            }
            this.messagesContainer.style.minHeight = '';
            this.messagesContainer.innerHTML = '<div class="message admin">加载失败</div>';
            // Unlock scroll even on error
            this.unlockScroll();
        }
    }

    async searchSessions(query) {
        // First, search in session list (name, email, preview)
        this.sessionList.querySelectorAll('.session-item').forEach(item => {
            item.style.display = 'flex';
            // Remove previous match count
            const existingCount = item.querySelector('.search-match-count');
            if (existingCount) existingCount.remove();
        });

        // Then search in chat messages database
        try {
            const { data: messages, error } = await this.supabase
                .from('chat_messages')
                .select('session_id, content')
                .ilike('content', `%${query}%`);

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

                // Check if session info matches OR if there are message matches
                const session = this.sessions?.find(s => s.id === sessionId);
                const sessionIds = session?.sessionIds || [sessionId];
                const hasMessageMatch = sessionIds.some(sid => matchedSessionIds.has(sid));
                const hasInfoMatch = name.includes(query) || email.includes(query) || preview.includes(query);

                if (hasInfoMatch || hasMessageMatch) {
                    item.style.display = 'flex';

                    // Show match count if there are message matches
                    const totalMatches = sessionIds.reduce((sum, sid) => sum + (matchCounts[sid] || 0), 0);
                    if (totalMatches > 0) {
                        const countBadge = document.createElement('div');
                        countBadge.className = 'search-match-count';
                        countBadge.textContent = `${totalMatches} 条匹配`;
                        item.appendChild(countBadge);
                    }
                } else {
                    item.style.display = 'none';
                }
            });
        } catch (err) {
            console.error('Search failed:', err);
            // Fallback to basic search
            this.sessionList.querySelectorAll('.session-item').forEach(item => {
                const name = item.querySelector('.session-name')?.textContent.toLowerCase() || '';
                const preview = item.querySelector('.session-preview')?.textContent.toLowerCase() || '';
                const matches = name.includes(query) || preview.includes(query);
                item.style.display = matches ? 'flex' : 'none';
            });
        }
    }

    bindAdminEvents() {
        // Close button
        this.chatWindow.querySelector('.chat-close').addEventListener('click', () => this.toggleChat());

        // Overlay click to close
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.toggleChat());
        }

        // Back to list button (mobile slide navigation)
        const backBtn = this.chatWindow.querySelector('#backToListBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.chatWindow.classList.remove('chat-active');
            });
        }

        // Session search filter - enhanced with chat message search
        const searchInput = this.chatWindow.querySelector('#sessionSearch');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', async (e) => {
                const query = e.target.value.toLowerCase().trim();

                // Clear previous search timeout
                if (searchTimeout) clearTimeout(searchTimeout);

                if (!query) {
                    // Show all sessions when empty
                    this.sessionList.querySelectorAll('.session-item').forEach(item => {
                        item.style.display = 'flex';
                        // Remove search highlights
                        const highlight = item.querySelector('.search-match-count');
                        if (highlight) highlight.remove();
                    });
                    return;
                }

                // Debounce search
                searchTimeout = setTimeout(async () => {
                    await this.searchSessions(query);
                }, 300);
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
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.emojiPicker.classList.toggle('active');
        });

        this.emojiPicker.addEventListener('click', (e) => {
            if (e.target.classList.contains('emoji-item')) {
                this.input.value += e.target.textContent;
                this._focusInputWithoutScroll(this.input);
            }
        });

        document.addEventListener('click', () => this.emojiPicker.classList.remove('active'));

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

        const text = this.input.value.trim();
        if (!text) return;

        // Optimistic UI update
        this.appendMessage(text, 'admin');
        this.input.value = '';
        this.scrollToBottom();

        try {
            await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    content: text,
                    message_type: 'text',
                    is_admin: true
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
            // sessionId can be email (logged-in user) or guest_xxx (guest)
            // Skip notification for guest users
            if (sessionId.startsWith('guest_')) {
                console.log('⏭️ Skipping notification for guest user');
                return;
            }

            // Lookup user_id by email from auth.users or profiles
            const { data: profile, error: profileError } = await this.supabase
                .from('profiles')
                .select('id')
                .eq('email', sessionId)
                .single();

            if (profileError || !profile) {
                console.warn('Could not find user for notification:', sessionId);
                return;
            }

            // Create system notification
            await this.supabase
                .from('system_notifications')
                .insert({
                    user_id: profile.id,
                    title: '客服回复',
                    content: messageContent.substring(0, 100) + (messageContent.length > 100 ? '...' : ''),
                    type: 'info',
                    is_read: false
                });

            console.log('🔔 Notification created for user:', profile.id);
        } catch (err) {
            console.error('Failed to create notification:', err);
        }
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

        const file = event.target.files[0];
        if (!file) return;

        try {
            // Compress image
            const compressedFile = await this.compressImage(file);

            const fileName = `admin_${Date.now()}_${Math.random().toString(36).substring(7)}.webp`;
            const { error: uploadError } = await this.supabase.storage
                .from('chat-images')
                .upload(fileName, compressedFile);

            if (uploadError) throw uploadError;

            const { data: urlData } = this.supabase.storage
                .from('chat-images')
                .getPublicUrl(fileName);

            const imageUrl = urlData.publicUrl;

            // Send as image message
            await this.supabase
                .from('chat_messages')
                .insert({
                    session_id: this.currentSessionId,
                    content: imageUrl,
                    message_type: 'image',
                    is_admin: true
                });

            this.appendMessage(imageUrl, 'admin', true);
            this.scrollToBottom();

        } catch (err) {
            console.error('Failed to upload:', err);
            alert('上传失败: ' + err.message);
        }

        event.target.value = '';
    }

    subscribeToAdminMessages() {
        this.supabase
            .channel('admin-chat-global')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
                const msg = payload.new;

                // Skip admin's own messages
                if (msg.is_admin) return;

                // Check if we're currently ACTIVELY viewing this session's chat
                // Must be: window open + selected this session + on mobile: must be in chat view (not list view)
                const isMobile = window.innerWidth <= 700;
                const isInChatView = !isMobile || (this.chatWindow && this.chatWindow.classList.contains('chat-active'));
                const isViewingThisSession = this.isOpen &&
                    this.currentSessionId &&
                    msg.session_id === this.currentSessionId &&
                    isInChatView;

                if (isViewingThisSession) {
                    // Append message to current chat - with animation (isNewMessage=true)
                    this.appendMessage(msg.content, 'user', msg.message_type === 'image' ? 'image' : 'text', null, true);
                    this.scrollToBottom();
                }

                // Always show notification if not actively viewing the chat
                if (!isViewingThisSession) {
                    const messageContent = msg.message_type === 'image' ? '📷 发送了一张图片' : msg.content;
                    const senderName = msg.session_id.includes('@') ? msg.session_id.split('@')[0] : '访客';
                    this.showNotification(messageContent, `💬 ${senderName}`, true); // forceShow for admin

                    // Mark session as unread
                    this.unreadSessions.add(msg.session_id);
                }

                // Refresh session list to show new messages (will apply unread styling)
                this.loadAdminSessions();
            })
            .subscribe();
    }

    injectUserLayoutStyles() {
        // Avoid duplicate injection
        if (document.getElementById('user-chat-styles')) return;

        const style = document.createElement('style');
        style.id = 'user-chat-styles';
        style.textContent = `
            /* User Mode Glassmorphism Enhancement */
            .chat-window:not(.admin-mode-layout) {
                /* Glassmorphism effect - same as admin mode */
                background: rgba(20, 20, 30, 0.7) !important;
                backdrop-filter: blur(20px) saturate(150%) !important;
                -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
                box-shadow: 
                    0 25px 50px -12px rgba(0, 0, 0, 0.6),
                    0 0 0 1px rgba(255, 255, 255, 0.08),
                    inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
            }
            
            /* Overlay for user mode — no opacity transition to avoid flash */
            .chat-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.25);
                z-index: 9997;
                backdrop-filter: blur(3px);
                visibility: hidden;
                pointer-events: none;
                transition: visibility 0s linear 0.4s;
            }
            .chat-overlay.visible {
                visibility: visible;
                pointer-events: auto;
                transition: visibility 0s;
            }
            
            /* Mobile: Center the chat window */
            @media (max-width: 700px) {
                .chat-window:not(.admin-mode-layout) {
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    right: auto !important;
                    bottom: auto !important;
                    transform: translate(-50%, -50%) !important;
                    width: 90vw !important;
                    max-width: 400px !important;
                    height: 70vh !important;
                    max-height: 600px !important;
                }
                
                .chat-window:not(.admin-mode-layout).active {
                    transform: translate(-50%, -50%) scale(1) !important;
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
        // Create Chat Window
        this.chatWindow = document.createElement('div');
        this.chatWindow.className = 'chat-window';
        this.chatWindow.innerHTML = `
            <div class="chat-header">
                <div class="chat-header-info">
                    <div class="chat-avatar">
                        <div class="mascot-wrapper" style="transform: scale(0.8);">
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
                        <div class="chat-status-indicator">
                            <span class="status-dot online"></span>
                            <span class="status-text target-admin-status">${this.t('chat.adminOnline', '管理员在线')}</span>
                        </div>
                    </div>
                </div>
                <button class="chat-close"><i class="fas fa-times"></i></button>
            </div>
            <div class="chat-messages" id="chatMessages">
                <!-- Welcome Message -->
                <div class="message admin">
                    ${this.t('chat.welcomeMessage', '您好！有什么可以帮您的吗？')}
                </div>
            </div>
            <div class="chat-input-area">
                <input type="file" id="chatImageInput" accept="image/*" style="display: none;">
                <button class="chat-action-btn" id="chatUploadBtn"><i class="fas fa-plus"></i></button>
                <input type="text" class="chat-input" id="chatInput" placeholder="${this.t('chat.inputMessagePlaceholder', '输入消息...')}">
                <button class="chat-action-btn" id="chatEmojiBtn"><i class="far fa-smile"></i></button>
                <button class="chat-send-btn" id="chatSendBtn"><i class="fas fa-paper-plane"></i></button>
            </div>
            <div class="emoji-picker-popover" id="emojiPicker">
                ${this.emojis.map(e => `<div class="emoji-item">${e}</div>`).join('')}
            </div>
        `;
        document.body.appendChild(this.chatWindow);

        // Create overlay for clicking outside to close (same as admin mode)
        this.overlay = document.createElement('div');
        this.overlay.className = 'chat-overlay';
        document.body.appendChild(this.overlay);

        // Inject user mode styles (glassmorphism enhancement)
        this.injectUserLayoutStyles();

        this.messagesContainer = this.chatWindow.querySelector('#chatMessages');
        this.input = this.chatWindow.querySelector('#chatInput');
        this.emojiPicker = this.chatWindow.querySelector('#emojiPicker');
    }

    bindUserEvents() {
        // Toggle Chat (Close button inside header)
        this.chatWindow.querySelector('.chat-close').addEventListener('click', () => this.toggleChat());

        // Overlay click to close (same as admin mode)
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.toggleChat());
        }

        // Send Message
        this.chatWindow.querySelector('#chatSendBtn').addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        this._bindInputFocusStabilizer(this.input);

        // Emoji Picker
        const emojiBtn = this.chatWindow.querySelector('#chatEmojiBtn');
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.emojiPicker.classList.toggle('active');
        });

        // Add Emoji
        this.chatWindow.querySelectorAll('.emoji-item').forEach(item => {
            item.addEventListener('click', (e) => {
                this.input.value += e.target.textContent;
                this.emojiPicker.classList.remove('active');
                this._focusInputWithoutScroll(this.input);
            });
        });

        // Close UI when clicking outside
        document.addEventListener('click', (e) => {
            if (this.chatWindow.contains(e.target) || this.fab.contains(e.target)) return;
            // logic: close emoji picker
            if (this.emojiPicker) this.emojiPicker.classList.remove('active');
        });

        // Image Upload
        const uploadBtn = this.chatWindow.querySelector('#chatUploadBtn');
        const fileInput = this.chatWindow.querySelector('#chatImageInput');

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleImageUpload(e));

        // HIGH REFRESH RATE: Setup scroll optimization
        this.setupScrollOptimization();
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.chatWindow.classList.add('active');
            this._captureStableDockHeight();
            requestAnimationFrame(() => this._captureStableDockHeight());
            this.fab.style.opacity = '0';
            this.fab.style.pointerEvents = 'none';
            // Show overlay (for admin mode)
            if (this.overlay) this.overlay.classList.add('visible');
            this._freezeOverlay();

            // iOS 窄屏统一强锁背景，弹窗位移完全交给键盘监听逻辑处理。
            if (window.iOSScrollLock) {
                if (this._isIOSMobile() && this._isNarrowViewport()) {
                    window.iOSScrollLock.lock(this.chatWindow);
                } else {
                    window.iOSScrollLock.lockLight(this.chatWindow);
                }
            }
            this._enableSessionVisualLock();

            // iOS 键盘适配：监听 visualViewport 变化，动态调整聊天窗口大小
            this._attachKeyboardListener();

        } else {
            this.chatWindow.classList.remove('active');
            this.fab.style.opacity = '1';
            this.fab.style.pointerEvents = 'all';
            // Hide overlay
            if (this.overlay) this.overlay.classList.remove('visible');

            // 清理键盘监听 & 还原样式
            this._disableSessionVisualLock();
            this._detachKeyboardListener();
            this._resetKeyboardViewportStyles();
            this._clearPendingUndockTimer();
            this._restoreOverlay();
            this._stableDockHeight = null;

            // UNLOCK SCROLL
            if (window.iOSScrollLock) window.iOSScrollLock.unlock();
        }
    }

    /**
     * iOS 键盘适配：不阻止 Safari 滚动（会抖），
     * 只在键盘弹出时给聊天窗口加 bottom 偏移，让输入框露在键盘上方
     */
    _attachKeyboardListener() {
        if (!window.visualViewport) {
            this._onChatFocusIn = () => {
                if (this._isNarrowViewport()) {
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
            }
            const isFocusedInChat = this._isChatInputFocused();
            const isIOS = this._isIOSMobile();
            const shouldDock = this._isNarrowViewport() && (
                isIOS
                    ? (
                        !this._keyboardBlurUndocking &&
                        (this._keyboardDocked ? bottomInset > 8 : bottomInset > 24)
                    )
                    : (isFocusedInChat || bottomInset > 60)
            );

            if (isIOS && !isFocusedInChat && bottomInset <= 8) {
                this._keyboardBlurUndocking = false;
            }

            if (shouldDock) {
                this._clearPendingUndockTimer();
                this._keyboardPreLiftActive = false;
                if (!this._keyboardDocked) {
                    // Only animate on the edge transition into keyboard-docked state.
                    this._applyKeyboardDock(visualHeight, bottomInset, true);
                } else if (Math.abs(bottomInset - this._lastKeyboardInset) > 1) {
                    // Follow keyboard without animation to avoid repeated transition restarts.
                    this._applyKeyboardDock(visualHeight, bottomInset, false);
                }
                this._keyboardDocked = true;
                this._lastKeyboardInset = bottomInset;
            } else {
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

        this._onChatFocusIn = () => {
            this._keyboardBlurUndocking = false;
            if (this._isIOSMobile() && this._isNarrowViewport() && !this._keyboardDocked) {
                this._applyKeyboardPreLift();
            }
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
            this._onViewportChange = null;
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
            this._focusInputWithoutScroll(inputEl);
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

        // 固定定位 + 高度基线，避免 body.no-scroll 裁切导致底部漏层
        this.overlay.style.setProperty('position', 'fixed', 'important');
        this.overlay.style.setProperty('top', '0', 'important');
        this.overlay.style.setProperty('left', '0', 'important');
        this.overlay.style.setProperty('right', '0', 'important');
        this.overlay.style.setProperty('bottom', 'auto', 'important');
        this.overlay.style.setProperty('width', '100%', 'important');
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
            this.overlay.style.setProperty('height', `${overlayHeight}px`, 'important');
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
        this.overlay.style.removeProperty('position');
        this.overlay.style.removeProperty('top');
        this.overlay.style.removeProperty('left');
        this.overlay.style.removeProperty('right');
        this.overlay.style.removeProperty('bottom');
        this.overlay.style.removeProperty('width');
        this.overlay.style.removeProperty('height');
        this._overlayBaseHeight = null;
    }

    _applyKeyboardDock(visualHeight, bottomInset, animate = false) {
        if (!this.chatWindow) return;

        this.chatWindow.classList.add('keyboard-docked');
        this._clearTransitionCleanupTimer();
        if (animate) {
            this._applyMotionVisualLock(190);
            this.chatWindow.style.setProperty(
                'transition',
                'transform 140ms cubic-bezier(0.22, 1, 0.36, 1), bottom 140ms cubic-bezier(0.22, 1, 0.36, 1)',
                'important'
            );
            this._transitionCleanupTimer = setTimeout(() => {
                this._transitionCleanupTimer = null;
                if (this.chatWindow && this.chatWindow.classList.contains('keyboard-docked')) {
                    this.chatWindow.style.removeProperty('transition');
                }
            }, 180);
        } else {
            this.chatWindow.style.setProperty('transition', 'none', 'important');
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

            this.chatWindow.style.setProperty('position', 'fixed', 'important');
            this.chatWindow.style.setProperty('top', '50%', 'important');
            this.chatWindow.style.setProperty('left', '50%', 'important');
            this.chatWindow.style.setProperty('right', 'auto', 'important');
            this.chatWindow.style.setProperty('bottom', 'auto', 'important');
            this.chatWindow.style.setProperty('height', `${dockHeight}px`, 'important');
            this.chatWindow.style.setProperty('max-height', `${dockHeight}px`, 'important');
            this.chatWindow.style.setProperty('transform', 'translate3d(-50%, -50%, 0) scale(1)', 'important');

            const rect = this.chatWindow.getBoundingClientRect();
            const targetBottom = Math.max(40, visualHeight - 12);
            const deltaY = Math.max(-520, Math.min(520, targetBottom - rect.bottom));
            this.chatWindow.style.setProperty(
                'transform',
                `translate3d(-50%, calc(-50% + ${Math.round(deltaY)}px), 0) scale(1)`,
                'important'
            );
            return;
        }
        const dockBottom = Math.max(0, bottomInset);
        // 覆盖移动端居中定位，改为贴近键盘上沿
        this.chatWindow.style.setProperty('top', 'auto', 'important');
        this.chatWindow.style.setProperty('left', '50%', 'important');
        this.chatWindow.style.setProperty('right', 'auto', 'important');
        this.chatWindow.style.setProperty('bottom', `${dockBottom}px`, 'important');
        this.chatWindow.style.setProperty('transform', 'translate3d(-50%, 0, 0) scale(1)', 'important');

        // 不再在键盘期间改高度，避免“上下压缩后弹开”
        this.chatWindow.style.removeProperty('height');
        this.chatWindow.style.removeProperty('max-height');
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
        if (this._viewportRafId) return;
        this._viewportRafId = requestAnimationFrame(() => {
            this._viewportRafId = null;
            this._onViewportResize?.();
        });
    }

    _clearKeyboardSettleTimer() {
        if (this._keyboardSettleTimer) {
            clearTimeout(this._keyboardSettleTimer);
            this._keyboardSettleTimer = null;
        }
    }

    _clearTransitionCleanupTimer() {
        if (this._transitionCleanupTimer) {
            clearTimeout(this._transitionCleanupTimer);
            this._transitionCleanupTimer = null;
        }
    }

    _clearMotionVisualLockTimer() {
        if (this._motionVisualLockTimer) {
            clearTimeout(this._motionVisualLockTimer);
            this._motionVisualLockTimer = null;
        }
    }

    _applyStableVisualStyles() {
        if (!this.chatWindow) return;
        this.chatWindow.style.setProperty('will-change', 'transform', 'important');
        this.chatWindow.style.setProperty('backface-visibility', 'hidden', 'important');
        this.chatWindow.style.setProperty('-webkit-backface-visibility', 'hidden', 'important');
        this.chatWindow.style.setProperty('transform-style', 'preserve-3d', 'important');
        this.chatWindow.style.setProperty('contain', 'layout paint style', 'important');
        this.chatWindow.style.setProperty('isolation', 'isolate', 'important');
        this.chatWindow.style.setProperty('-webkit-mask-image', '-webkit-radial-gradient(white, black)', 'important');
        this.chatWindow.style.setProperty('backdrop-filter', 'none', 'important');
        this.chatWindow.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        this.chatWindow.style.setProperty('background', 'rgb(20, 20, 30)', 'important');
    }

    _enableSessionVisualLock() {
        if (!this.chatWindow) return;
        if (!(this._isIOSMobile() && this._isNarrowViewport())) {
            this._sessionVisualLocked = false;
            return;
        }
        this._sessionVisualLocked = true;
        this.chatWindow.classList.add('visual-solid');
        this._applyStableVisualStyles();
        if (this.overlay) {
            this.overlay.classList.add('visual-solid');
            this.overlay.style.setProperty('backdrop-filter', 'none', 'important');
            this.overlay.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
            this.overlay.style.setProperty('background', 'rgba(0, 0, 0, 0.36)', 'important');
        }
    }

    _disableSessionVisualLock() {
        this._sessionVisualLocked = false;
        if (this.chatWindow) {
            this.chatWindow.classList.remove('visual-solid');
        }
        if (this.overlay) {
            this.overlay.classList.remove('visual-solid');
            this.overlay.style.removeProperty('backdrop-filter');
            this.overlay.style.removeProperty('-webkit-backdrop-filter');
            this.overlay.style.removeProperty('background');
        }
        this._restoreMotionVisuals();
    }

    _restoreMotionVisuals() {
        this._clearMotionVisualLockTimer();
        if (!this.chatWindow) return;
        if (this._sessionVisualLocked) {
            this._applyStableVisualStyles();
            return;
        }
        this.chatWindow.style.removeProperty('backdrop-filter');
        this.chatWindow.style.removeProperty('-webkit-backdrop-filter');
        this.chatWindow.style.removeProperty('background');
        this.chatWindow.style.removeProperty('will-change');
        this.chatWindow.style.removeProperty('backface-visibility');
        this.chatWindow.style.removeProperty('-webkit-backface-visibility');
        this.chatWindow.style.removeProperty('transform-style');
        this.chatWindow.style.removeProperty('contain');
        this.chatWindow.style.removeProperty('isolation');
        this.chatWindow.style.removeProperty('-webkit-mask-image');
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
        this.chatWindow.style.setProperty('position', 'fixed', 'important');
        this.chatWindow.style.setProperty('top', '50%', 'important');
        this.chatWindow.style.setProperty('left', '50%', 'important');
        this.chatWindow.style.setProperty('right', 'auto', 'important');
        this.chatWindow.style.setProperty('bottom', 'auto', 'important');
        this.chatWindow.style.setProperty('transition', 'transform 120ms cubic-bezier(0.22, 1, 0.36, 1)', 'important');
        this.chatWindow.style.setProperty('transform', 'translate3d(-50%, calc(-50% - 24px), 0) scale(1)', 'important');
        this._transitionCleanupTimer = setTimeout(() => {
            this._transitionCleanupTimer = null;
            if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                this.chatWindow.style.removeProperty('transition');
            }
        }, 150);
    }

    _resetKeyboardViewportStyles(animate = false) {
        this._keyboardDocked = false;
        this._lastKeyboardInset = 0;
        this._keyboardPreLiftActive = false;
        if (this.chatWindow) {
            this.chatWindow.classList.remove('keyboard-docked');
            this._clearTransitionCleanupTimer();
            if (animate) {
                this._applyMotionVisualLock(210);
                this.chatWindow.style.setProperty(
                    'transition',
                    'transform 160ms cubic-bezier(0.22, 1, 0.36, 1), bottom 160ms cubic-bezier(0.22, 1, 0.36, 1)',
                    'important'
                );
            } else {
                this.chatWindow.style.setProperty('transition', 'none', 'important');
                this._restoreMotionVisuals();
            }
            this.chatWindow.style.removeProperty('height');
            this.chatWindow.style.removeProperty('max-height');

            if (this.isOpen && this._isNarrowViewport()) {
                this.chatWindow.style.setProperty('position', 'fixed', 'important');
                this.chatWindow.style.setProperty('top', '50%', 'important');
                this.chatWindow.style.setProperty('left', '50%', 'important');
                this.chatWindow.style.setProperty('right', 'auto', 'important');
                this.chatWindow.style.setProperty('bottom', 'auto', 'important');
                this.chatWindow.style.setProperty('transform', 'translate3d(-50%, -50%, 0) scale(1)', 'important');
            } else {
                this.chatWindow.style.removeProperty('top');
                this.chatWindow.style.removeProperty('left');
                this.chatWindow.style.removeProperty('right');
                this.chatWindow.style.removeProperty('bottom');
                this.chatWindow.style.removeProperty('position');
                this.chatWindow.style.removeProperty('transform');
            }

            if (animate) {
                this._transitionCleanupTimer = setTimeout(() => {
                    this._transitionCleanupTimer = null;
                    if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                        this.chatWindow.style.removeProperty('transition');
                    }
                }, 200);
            } else {
                requestAnimationFrame(() => {
                    if (this.chatWindow && !this.chatWindow.classList.contains('keyboard-docked')) {
                        this.chatWindow.style.removeProperty('transition');
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

        // Optimistic UI update
        this.appendMessage(text, 'user', 'text');
        this.input.value = '';

        try {
            // Check auth
            const { data: { user } } = await this.supabase.auth.getUser();
            const userId = user ? user.id : null;
            // Use email as session_id for logged-in users, otherwise guest session
            const sessionId = user?.email || this.sessionId;

            const { error } = await this.supabase
                .from('chat_messages')
                .insert({
                    content: text,
                    message_type: 'text',
                    user_id: userId,
                    session_id: sessionId,
                    is_admin: false
                });

            if (error) throw error;
        } catch (err) {
            console.error('Error sending message:', err);
            // Could add retry logic or error indicator here
        }
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

            // Upload to Supabase Storage
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.webp`;
            const filePath = `chat-images/${fileName}`; // Keep filePath structure but use webp

            const { error: uploadError } = await this.supabase.storage
                .from('chat-assets') // Make sure this bucket exists
                .upload(filePath, compressedFile);

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data: { publicUrl } } = this.supabase.storage
                .from('chat-assets')
                .getPublicUrl(filePath);

            // Optimistic UI for Image
            this.appendMessage(publicUrl, 'user', 'image');

            // Save to DB
            const { data: { user } } = await this.supabase.auth.getUser();
            const userId = user ? user.id : null;
            // Use email as session_id for logged-in users, otherwise guest session
            const sessionId = user?.email || this.sessionId;

            await this.supabase
                .from('chat_messages')
                .insert({
                    content: publicUrl,
                    message_type: 'image',
                    user_id: userId,
                    session_id: sessionId,
                    is_admin: false
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

        if (messageType === 'image') {
            msgDiv.innerHTML = `<img src="${content}" class="message-image" onclick="window.open(this.src, '_blank')">`;
        } else {
            msgDiv.innerHTML = `<span class="message-text">${this.escapeHtml(content)}</span>`;
        }

        this.messagesContainer.appendChild(msgDiv);

        // Only scroll for new messages (not history batch loads)
        if (isNewMessage) {
            this.scrollToBottom();
        }
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
        const channel = this.supabase
            .channel('chat-room')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `session_id=eq.${this.sessionId}` // Only listen to own session replies (or admin replies)
                },
                (payload) => {
                    // Only append if it's NOT from us (avoid duplicate since we did optimistic UI)
                    // Or check if is_admin is true
                    if (payload.new.is_admin) {
                        // Real-time message - animate with isNewMessage=true
                        this.appendMessage(payload.new.content, 'admin', payload.new.message_type, null, true);

                        // Show cute notification if chat is closed
                        const messageContent = payload.new.message_type === 'image' ? '📷 发送了一张图片' : payload.new.content;
                        this.showNotification(messageContent, '💬 客服');
                    }
                }
            )
            .subscribe();
    }

    async loadHistory() {
        // PRELOAD STRATEGY: Lock scroll during history loading
        this.lockScroll();

        try {
            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('*')
                .eq('session_id', this.sessionId)
                .order('created_at', { ascending: true });

            if (data) {
                // Batch render all history messages before enabling scroll
                data.forEach(msg => {
                    const type = msg.is_admin ? 'admin' : 'user';
                    this.appendMessage(msg.content, type, msg.message_type);
                });

                // Scroll to bottom after all messages loaded
                this.scrollToBottom();
            }

            // PRELOAD COMPLETE: Unlock scroll
            this.unlockScroll();

        } catch (err) {
            console.error('Error loading history:', err);
            // Unlock scroll even on error
            this.unlockScroll();
        }
    }
}

// Auto-init specific styling for mobile viewport handling (optional)
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        // Adjust chat window height if keyboard opens on mobile
    });
}
