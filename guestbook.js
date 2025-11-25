/* ==================== Guestbook Display Page JavaScript ==================== */

document.addEventListener('DOMContentLoaded', () => {
    const messageContainer = document.getElementById('messageContainer');
    const emptyState = document.getElementById('emptyState');
    const clearAllBtn = document.getElementById('clearAllBtn');

    // Load and display messages from Firestore
    if (messageContainer) {
        // 1. Try Cache IMMEDIATELY (Instant Display)
        try {
            const cached = localStorage.getItem('guestbook_cache');
            if (cached) {
                const cachedMessages = JSON.parse(cached);
                if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
                    console.log('🚀 Loaded messages from cache instantly');
                    renderMessages(cachedMessages);
                } else {
                    messageContainer.innerHTML = '<div style="text-align:center; padding:20px; color:white;">正在连接云端数据库...<br><i class="fas fa-spinner fa-spin"></i></div>';
                }
            } else {
                messageContainer.innerHTML = '<div style="text-align:center; padding:20px; color:white;">正在连接云端数据库...<br><i class="fas fa-spinner fa-spin"></i></div>';
            }
        } catch (e) {
            messageContainer.innerHTML = '<div style="text-align:center; padding:20px; color:white;">正在连接云端数据库...<br><i class="fas fa-spinner fa-spin"></i></div>';
        }
    }

    let retryCount = 0;
    const maxRetries = 20; // 10 seconds timeout

    // Clear all messages handler (Only for admin/local cleanup, maybe hide or disable for cloud)
    if (clearAllBtn) {
        clearAllBtn.style.display = 'none'; // Hide clear button for cloud version to prevent accidental deletion
    }

    function initFirestoreListener() {
        const db = window.firebaseDB;
        const collection = window.firestoreCollection;
        const query = window.firestoreQuery;
        const orderBy = window.firestoreOrderBy;
        const onSnapshot = window.firestoreOnSnapshot;

        if (db && collection && query && orderBy && onSnapshot) {
            console.log('✅ Connected to Firestore, listening for updates...');

            // 1. Load from Cache FIRST (Instant Display)
            try {
                const cached = localStorage.getItem('guestbook_cache');
                if (cached) {
                    const cachedMessages = JSON.parse(cached);
                    if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
                        console.log('🚀 Loaded messages from cache');
                        renderMessages(cachedMessages);
                    }
                }
            } catch (e) {
                console.error('Error loading cache:', e);
            }

            const q = query(collection(db, "messages"), orderBy("timestamp", "desc"));

            // Real-time listener
            onSnapshot(q, (snapshot) => {
                const messages = [];
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    messages.push({
                        id: doc.id,
                        ...data,
                        timestamp: data.displayTime || data.timestamp // Fallback
                    });
                });

                // Update Cache
                localStorage.setItem('guestbook_cache', JSON.stringify(messages));

                if (messages.length === 0) {
                    if (messageContainer) {
                        messageContainer.innerHTML = ''; // Clear loading immediately
                        if (emptyState) emptyState.style.display = 'flex';
                    }
                } else {
                    renderMessages(messages);
                }
            }, (error) => {
                console.error("Error listening to guestbook updates:", error);
                if (messageContainer) messageContainer.innerHTML = `<div style="text-align:center; color: #ff6b6b;">无法加载留言: ${error.message}</div>`;
            });
        } else {
            retryCount++;
            if (retryCount < maxRetries) {
                console.log(`⏳ Waiting for Firebase... (${retryCount}/${maxRetries})`);
                // Check more frequently (100ms) to reduce perceived delay
                setTimeout(initFirestoreListener, 100);
            } else {
                console.error("❌ Firebase initialization timeout");
                if (messageContainer) messageContainer.innerHTML = '<div style="text-align:center; color: #ff6b6b;">连接数据库超时，请刷新页面重试。</div>';
            }
        }
    }

    // Start trying
    initFirestoreListener();

    function renderMessages(messages) {
        if (!messageContainer) return;

        if (messages.length === 0) {
            messageContainer.innerHTML = '';
            emptyState.style.display = 'flex';
            return;
        }

        emptyState.style.display = 'none';
        // Pass index to createMessageCard for staggered animation
        messageContainer.innerHTML = messages.map((msg, index) => createMessageCard(msg, index)).join('');

        // Attach comment form handlers after rendering
        attachCommentHandlers();

        // Initialize magnetic effect for new cards
        initMagneticEffect();
    }

    function createMessageCard(msg, index = 0) {
        const hasComments = msg.comments && msg.comments.length > 0;
        const commentCount = msg.comments ? msg.comments.length : 0;
        const shouldCollapse = commentCount > 2;

        // Calculate delay: 0.03s per item, max 0.5s
        const delay = Math.min(index * 0.03, 0.5);

        const commentsHtml = hasComments
            ? msg.comments.map(comment => `
                <div class="comment-item">
                    <div class="comment-header">
                        <i class="fas fa-user-circle"></i>
                        <span class="comment-author">${escapeHtml(comment.name)}</span>
                        <span class="comment-time">${comment.timestamp}</span>
                    </div>
                    <div class="comment-content">${escapeHtml(comment.content)}</div>
                </div>
            `).join('')
            : '<div class="no-comments">暂无评论</div>';

        const toggleButtonHtml = shouldCollapse
            ? `<button class="comment-toggle-btn" data-message-id="${msg.id}">
                <i class="fas fa-chevron-down"></i>
                <span>展开全部 ${commentCount} 条评论</span>
               </button>`
            : '';

        const imageHtml = msg.image
            ? `<div class="message-image">
                <img src="${msg.image}" alt="用户上传图片" onclick="openImageModal(this.src)">
               </div>`
            : '';

        const messageHtml = `
            <div class="message-anim-wrapper" style="animation-delay: ${delay}s">
                <div class="message-item" data-id="${msg.id}">
                    
                    <!-- 1. Header (Author Info) -->
                    <div class="message-footer-meta">
                        <div class="author-info">
                            ${msg.avatarUrl
                ? `<img src="${msg.avatarUrl}" alt="${escapeHtml(msg.name)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.3);">`
                : '<i class="fas fa-user-circle"></i>'}
                            <span class="author-name">${escapeHtml(msg.name)}</span>
                        </div>
                        <span class="message-time">${msg.timestamp.split(' ')[0]}</span> <!-- Only show date -->
                    </div>

                    <!-- 2. Content (Primary Focus) -->
                    <div class="message-content">${escapeHtml(msg.content)}</div>

                    <!-- 3. Image -->
                    ${imageHtml}
                    
                    <div class="comment-section">
                        <div class="comment-header-bar">
                            <div class="comment-count-group">
                                <i class="fas fa-comments"></i>
                                <span>${commentCount}</span>
                            </div>
                            <!-- Add Comment Trigger Button in header -->
                            <button class="add-comment-trigger-btn" onclick="window.openCommentModal('${msg.id}')">
                                <i class="fas fa-plus"></i> 评论
                            </button>
                        </div>
                        <div class="comment-list ${shouldCollapse ? 'collapsed' : ''}" data-message-id="${msg.id}">
                            ${commentsHtml}
                        </div>
                        ${toggleButtonHtml}
                    </div>
                </div>
            </div>
        `;
        return messageHtml;
    }

    function attachCommentHandlers() {
        const toggleButtons = document.querySelectorAll('.comment-toggle-btn');

        // Toggle comments expansion
        toggleButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                const messageId = this.dataset.messageId;
                const commentList = document.querySelector(`.comment-list[data-message-id="${messageId}"]`);
                const icon = this.querySelector('i');
                const span = this.querySelector('span');

                if (commentList.classList.contains('collapsed')) {
                    // Expand
                    commentList.classList.remove('collapsed');
                    commentList.offsetHeight;

                    // 4. Animate to full height
                    commentList.style.maxHeight = fullHeight + 'px';

                    // 5. Update button
                    icon.className = 'fas fa-chevron-up';
                    span.textContent = '收起评论';

                    // 6. Cleanup after animation
                    commentList.addEventListener('transitionend', function handler() {
                        commentList.style.maxHeight = 'none';
                        commentList.removeEventListener('transitionend', handler);
                    }, { once: true });

                } else {
                    // Collapse
                    // 1. Set explicit height (current full height)
                    commentList.style.maxHeight = commentList.scrollHeight + 'px';

                    // Force reflow
                    commentList.offsetHeight;

                    // 2. Animate down to 200px
                    // Add collapsed class immediately to trigger gradient fade in (if we add transition to it)
                    commentList.classList.add('collapsed');
                    commentList.style.maxHeight = '200px';

                    // 3. Update button
                    const count = span.textContent.match(/\d+/)[0];
                    icon.className = 'fas fa-chevron-down';
                    span.textContent = `展开全部 ${count} 条评论`;
                }
            });
        });
    }

    // Handle Comment Submission
    const commentForm = document.getElementById('commentForm');
    if (commentForm) {
        commentForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // Check Auth
            const auth = window.firebaseAuth;
            if (!auth || !auth.currentUser) {
                alert("请先登录后再评论");
                return;
            }

            const user = auth.currentUser;
            const messageId = parseInt(document.getElementById('commentMessageId').value);
            // Use Auth Display Name or Fallback
            const name = user.displayName || user.email.split('@')[0];
            const content = document.getElementById('commentContent').value.trim();

            if (content) {
                addComment(messageId, name, content);
                // Close modal
                document.getElementById('commentModal').classList.remove('active');
                commentForm.reset();
            }
        });
    }

    function addComment(messageId, name, content) {
        const messages = JSON.parse(localStorage.getItem('guestbook_messages') || '[]');

        // Find the message by ID
        const messageIndex = messages.findIndex(msg => msg.id === messageId);
        if (messageIndex === -1) return;

        const newComment = {
            id: Date.now(),
            name: name,
            content: content,
            timestamp: new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })
        };

        // Initialize comments array if it doesn't exist
        if (!messages[messageIndex].comments) {
            messages[messageIndex].comments = [];
        }

        // Add comment to the message
        messages[messageIndex].comments.push(newComment);

        // Save back to localStorage
        try {
            localStorage.setItem('guestbook_messages', JSON.stringify(messages));
            window.location.reload();
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                alert('存储空间已满! 请清理旧留言。');
            } else {
                console.error('保存失败:', error);
            }
        }
    }
});

// --- Global Modal Functions (Must be outside DOMContentLoaded) ---

window.openCommentModal = function (messageId) {
    // Check Auth First
    const auth = window.firebaseAuth;
    if (!auth || !auth.currentUser) {
        alert("请先登录后再评论");
        // Optional: Trigger login modal if accessible
        if (window.openAuthModal) window.openAuthModal('login');
        return;
    }

    const modal = document.getElementById('commentModal');
    const messageIdInput = document.getElementById('commentMessageId');
    if (modal && messageIdInput) {
        messageIdInput.value = messageId;
        modal.classList.add('active');
        // Focus content input
        setTimeout(() => {
            const contentInput = document.getElementById('commentContent');
            if (contentInput) contentInput.focus();
        }, 100);
    }
};

window.closeCommentModal = function (event) {
    // Close if clicked on overlay or close button
    if (event.target.classList.contains('modal-overlay') ||
        event.target.closest('.mac-dot.red') ||
        event.target.closest('.close-btn')) {

        const modal = document.getElementById('commentModal');
        if (modal) {
            modal.classList.remove('active');
            // Clear form
            const form = document.getElementById('commentForm');
            if (form) form.reset();
        }
    }
};



// Initialize magnetic effect for message items
function initMagneticEffect() {
    const cards = document.querySelectorAll('.message-item');

    cards.forEach(card => {
        // Fix: Animation 'forwards' locks the transform property.
        // We must remove the animation after it finishes to allow JS transforms.

        // Method 1: Event Listener
        card.addEventListener('animationend', () => {
            card.style.opacity = '1';
            card.style.animation = 'none';
        }, { once: true });

        // Method 2: Timeout Fallback (for safety)
        setTimeout(() => {
            const computedStyle = window.getComputedStyle(card);
            if (computedStyle.animationName !== 'none') {
                card.style.opacity = '1';
                card.style.animation = 'none';
            }
        }, 600); // Slightly longer than 0.4s animation + delays

        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Consistent subtle effect: Divisor 25
            const deltaX = (x - centerX) / 25;
            const deltaY = (y - centerY) / 25;

            card.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.01)`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
        });
    });
}


// Helper to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Image Modal for full-screen view
function openImageModal(src) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.className = 'image-modal';
        modal.innerHTML = `
            <div class="image-modal-content">
                <button class="image-modal-close" onclick="closeImageModal()">
                    <i class="fas fa-times"></i>
                </button>
                <img src="" alt="查看大图">
            </div>
        `;
        document.body.appendChild(modal);

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeImageModal();
            }
        });
    }

    const img = modal.querySelector('img');
    img.src = src;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}
