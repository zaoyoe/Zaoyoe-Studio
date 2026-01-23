
class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.sessionId = this.getSessionId();
        this.supabase = window.supabaseClient; // Assuming global supabase client

        // Define common emojis
        this.emojis = ['😀', '😂', '😍', '🤔', '😭', '😡', '👍', '👎', '🎉', '🔥', '❤️', '👀', '🚀', '💯', '👋', '✨', '🤖', '👻'];

        this.init();
    }

    getSessionId() {
        let sid = localStorage.getItem('chat_session_id');
        if (!sid) {
            sid = 'guest_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('chat_session_id', sid);
        }
        return sid;
    }

    init() {
        this.render();
        this.bindEvents();
        this.subscribeToMessages();
        this.loadHistory();
    }

    render() {
        // Create FAB
        this.fab = document.createElement('div');
        this.fab.className = 'chat-widget-fab';
        this.fab.innerHTML = '<i class="fas fa-comment-alt"></i>';
        document.body.appendChild(this.fab);

        // Create Chat Window
        this.chatWindow = document.createElement('div');
        this.chatWindow.className = 'chat-window';
        this.chatWindow.innerHTML = `
            <div class="chat-header">
                <div class="chat-header-info">
                    <div class="chat-avatar"><i class="fas fa-robot"></i></div>
                    <div class="chat-title">
                        <h3>在线客服</h3>
                        <p>通常在几分钟内回复</p>
                    </div>
                </div>
                <button class="chat-close"><i class="fas fa-times"></i></button>
            </div>
            <div class="chat-messages" id="chatMessages">
                <!-- Welcome Message -->
                <div class="message admin">
                    您好！有什么可以帮您的吗？
                </div>
            </div>
            <div class="chat-input-area">
                <input type="file" id="chatImageInput" accept="image/*" style="display: none;">
                <button class="chat-action-btn" id="chatUploadBtn"><i class="fas fa-plus"></i></button>
                <input type="text" class="chat-input" id="chatInput" placeholder="输入消息...">
                <button class="chat-action-btn" id="chatEmojiBtn"><i class="far fa-smile"></i></button>
                <button class="chat-send-btn" id="chatSendBtn"><i class="fas fa-paper-plane"></i></button>
            </div>
            <div class="emoji-picker-popover" id="emojiPicker">
                ${this.emojis.map(e => `<div class="emoji-item">${e}</div>`).join('')}
            </div>
        `;
        document.body.appendChild(this.chatWindow);

        this.messagesContainer = this.chatWindow.querySelector('#chatMessages');
        this.input = this.chatWindow.querySelector('#chatInput');
        this.emojiPicker = this.chatWindow.querySelector('#emojiPicker');
    }

    bindEvents() {
        // Toggle Chat
        this.fab.addEventListener('click', () => this.toggleChat());
        this.chatWindow.querySelector('.chat-close').addEventListener('click', () => this.toggleChat());

        // Send Message
        this.chatWindow.querySelector('#chatSendBtn').addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

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
                this.input.focus();
            });
        });

        // Close UI when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.chatWindow.contains(e.target) && !this.fab.contains(e.target)) {
                // accessing private property from outside, technically ok directly
                // Logic: Close emoji picker if open
                this.emojiPicker.classList.remove('active');
            }
        });

        // Image Upload
        const uploadBtn = this.chatWindow.querySelector('#chatUploadBtn');
        const fileInput = this.chatWindow.querySelector('#chatImageInput');

        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleImageUpload(e));
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.chatWindow.classList.add('active');
            this.fab.style.opacity = '0';
            this.fab.style.pointerEvents = 'none';
        } else {
            this.chatWindow.classList.remove('active');
            this.fab.style.opacity = '1';
            this.fab.style.pointerEvents = 'all';
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

            const { error } = await this.supabase
                .from('chat_messages')
                .insert({
                    content: text,
                    message_type: 'text',
                    user_id: userId,
                    session_id: this.sessionId, // Fallback for guests
                    is_admin: false
                });

            if (error) throw error;
        } catch (err) {
            console.error('Error sending message:', err);
            // Could add retry logic or error indicator here
        }
    }

    async handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Upload to Supabase Storage
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `chat-images/${fileName}`;

            const { error: uploadError } = await this.supabase.storage
                .from('chat-assets') // Make sure this bucket exists or use a dedicated one
                .upload(filePath, file);

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

            await this.supabase
                .from('chat_messages')
                .insert({
                    content: publicUrl,
                    message_type: 'image',
                    user_id: userId,
                    session_id: this.sessionId, // Fallback for guests
                    is_admin: false
                });

        } catch (err) {
            console.error('Error uploading image:', err);
            alert('图片上传失败，请重试');
        }
    }

    appendMessage(content, type, messageType = 'text') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}`;

        if (messageType === 'image') {
            msgDiv.innerHTML = `<img src="${content}" class="message-image" onclick="window.open(this.src, '_blank')">`;
        } else {
            msgDiv.textContent = content; // Text content safe from XSS
        }

        this.messagesContainer.appendChild(msgDiv);
        this.scrollToBottom();
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
                        this.appendMessage(payload.new.content, 'admin', payload.new.message_type);
                        // Maybe play a sound
                    }
                }
            )
            .subscribe();
    }

    async loadHistory() {
        try {
            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('*')
                .eq('session_id', this.sessionId)
                .order('created_at', { ascending: true });

            if (data) {
                // Clear default welcome? or keep it at top
                // let's keep welcome, just append history
                data.forEach(msg => {
                    const type = msg.is_admin ? 'admin' : 'user';
                    this.appendMessage(msg.content, type, msg.message_type);
                });
            }
        } catch (err) {
            console.error('Error loading history:', err);
        }
    }
}

// Auto-init specific styling for mobile viewport handling (optional)
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        // Adjust chat window height if keyboard opens on mobile
    });
}
