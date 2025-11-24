/* ==================== Guestbook Display Page JavaScript ==================== */

document.addEventListener('DOMContentLoaded', () => {
    const messageContainer = document.getElementById('messageContainer');
    const emptyState = document.getElementById('emptyState');
    const clearAllBtn = document.getElementById('clearAllBtn');

    // Load and display messages
    loadMessages();

    // Clear all messages handler
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有留言吗？此操作不可恢复。')) {
                localStorage.removeItem('guestbook_messages');
                loadMessages();
            }
        });
    }

    function loadMessages() {
        const messages = JSON.parse(localStorage.getItem('guestbook_messages') || '[]');
        renderMessages(messages);
    }

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
                    
                    <!-- 1. Content (Primary Focus) -->
                    <div class="message-content">${escapeHtml(msg.content)}</div>

                    <!-- 2. Image -->
                    ${imageHtml}

                    <!-- 3. Footer (Meta Info) -->
                    <div class="message-footer-meta">
                        <div class="author-info">
                            <i class="fas fa-user-circle"></i>
                            <span class="author-name">${escapeHtml(msg.name)}</span>
                        </div>
                        <span class="message-time">${msg.timestamp.split(' ')[0]}</span> <!-- Only show date -->
                    </div>
                    
                    <div class="comment-section">
                        <div class="comment-header-bar">
                            <div class="comment-count-group">
                                <i class="fas fa-comments"></i>
                                <span>${commentCount}</span>
                            </div>
                            <!-- Add Comment Trigger Button in header -->
                            <button class="add-comment-trigger-btn" onclick="openCommentModal(${msg.id})">
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
            const messageId = parseInt(document.getElementById('commentMessageId').value);
            const name = document.getElementById('commentName').value.trim();
            const content = document.getElementById('commentContent').value.trim();

            if (name && content) {
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

            // Re-render messages
            // We need to access renderMessages which is inside the scope. 
            // Since we are moving this function out, we need to pass it or reload.
            // Simplest fix: Reload page or re-read from localStorage inside the scope.
            // But wait, addComment is called by the form listener which is inside the scope.
            // So addComment CAN stay inside.

            // Only open/close need to be global.

            // Let's reload to reflect changes simply, or re-render.
            // Since renderMessages is internal, we can just reload for now or expose renderMessages.
            // Better: Expose renderMessages globally or keep addComment inside and only move open/close.

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
    const modal = document.getElementById('commentModal');
    const messageIdInput = document.getElementById('commentMessageId');
    if (modal && messageIdInput) {
        messageIdInput.value = messageId;
        modal.classList.add('active');
        // Focus name input
        setTimeout(() => {
            const nameInput = document.getElementById('commentName');
            if (nameInput) nameInput.focus();
        }, 100);
    }
};

window.closeCommentModal = function (event) {
    // Close if clicked on overlay or close button
    if (event.target.classList.contains('modal-overlay') ||
        event.target.closest('.mac-dot.red') ||
        event.target.closest('.close-btn')) { // Added safety check

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
