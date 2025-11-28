/* ==================== Guestbook Display Page JavaScript ==================== */

document.addEventListener('DOMContentLoaded', () => {
    const messageContainer = document.getElementById('messageContainer');
    const floatingBackBtn = document.querySelector('.floating-back-btn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const emptyState = document.getElementById('emptyState');

    // CRITICAL FIX: Clean up any modal state on page load
    document.body.classList.remove('modal-active');
    const allModals = document.querySelectorAll('.modal-overlay');
    allModals.forEach(modal => {
        modal.classList.remove('active', 'overlay-visible');
        modal.classList.add('overlay-hidden');
        modal.style.backdropFilter = 'none';
        modal.style.webkitBackdropFilter = 'none';
    });
    console.log('✅ Modal state cleaned up on page load');

    // Initialize magnetic effect after page load
    // setTimeout(() => {
    //     initMagneticEffect();
    // }, 100);

    // Hide clear button (not needed for LeanCloud version)
    if (clearAllBtn) {
        clearAllBtn.style.display = 'none';
    }

    // Load messages from LeanCloud
    console.log('📋 加载 LeanCloud 留言...');

    // Show loading state
    if (messageContainer) {
        messageContainer.innerHTML = '<div style="text-align:center; padding:20px; color:rgba(255,255,255,0.5); font-size:0.9rem;">加载中...</div>';
    }

    // Wait for LeanCloud to be ready, then load messages
    function waitForLeanCloud() {
        if (typeof AV !== 'undefined' && typeof loadGuestbookMessages === 'function') {
            console.log('✅ LeanCloud 已就绪，加载留言');
            loadGuestbookMessages();
        } else {
            console.log('⏳ 等待 LeanCloud 初始化...');
            setTimeout(waitForLeanCloud, 100);
        }
    }

    // waitForLeanCloud(); // Moved to after renderMessages definition

    // Make renderMessages global so it can be called by LeanCloud loader
    window.renderMessages = function (messages) {
        if (!messageContainer) return;

        // Clear loading state
        messageContainer.innerHTML = '';

        // Fade in container
        messageContainer.style.opacity = '1';

        if (messages.length === 0) {
            emptyState.style.display = 'flex';
            return;
        }

        emptyState.style.display = 'none';
        // Pass index to createMessageCard for staggered animation
        messageContainer.innerHTML = messages.map((msg, index) => createMessageCard(msg, index)).join('');

        // Attach comment form handlers after rendering
        attachCommentHandlers();

        // Initialize magnetic effect for new cards
        // initMagneticEffect();

        // Trigger entrance animation with a small delay to ensure DOM is ready
        setTimeout(() => {
            const wrappers = messageContainer.querySelectorAll('.message-anim-wrapper');
            wrappers.forEach(wrapper => {
                // Force reflow to ensure browser registers initial state
                void wrapper.offsetWidth;
                wrapper.classList.add('visible');
            });
        }, 150);
    };

    // Call this AFTER defining renderMessages to avoid race condition
    waitForLeanCloud();

    function createMessageCard(msg, index = 0) {
        const hasComments = msg.comments && msg.comments.length > 0;
        const commentCount = msg.comments ? msg.comments.length : 0;
        const shouldCollapse = commentCount > 2;

        // Calculate delay: 0.03s per item, max 0.5s
        const delay = Math.min(index * 0.03, 0.5);

        // Recursively render comment tree
        function renderCommentTree(comments, depth = 0, messageId, parentName = null) {
            console.log(`📊 renderCommentTree: depth=${depth}, parentName="${parentName}", comments=${comments?.length || 0}`);
            if (!comments || comments.length === 0) return '';

            const maxDepth = 2; // Limit nesting depth
            const indentPx = Math.min(depth * 20, 40); // Max 40px indent
            const canReply = depth < maxDepth; // Can reply if not at max depth

            return comments.map((comment, idx) => {
                const hasReplies = comment.replies && comment.replies.length > 0;

                console.log(`  Comment #${idx}: id=${comment.id}, name="${comment.name}", parentUserName="${comment.parentUserName}", depth=${depth}`);

                // 🔧 FIX: 过滤掉字符串 "null" 和 "undefined"，将它们当作实际的 null
                const cleanParentUserName = (comment.parentUserName && comment.parentUserName !== 'null' && comment.parentUserName !== 'undefined')
                    ? comment.parentUserName
                    : null;

                // 🆕 优先使用数据库中的 parentUserName（清洗后），如果没有则使用递归传递的 parentName
                const mentionName = cleanParentUserName || parentName;

                console.log(`    → cleanParentUserName="${cleanParentUserName}", parentName="${parentName}", final mentionName="${mentionName}"`);
                console.log(`    → Result: mentionName="${mentionName}", hasReplies=${hasReplies}, depth>0=${depth > 0}`);

                // Add @mention if this is a nested comment and we have a parent name
                const mentionPrefix = (depth > 0 && mentionName)
                    ? `<span class="comment-mention">@${escapeHtml(mentionName)}</span> `
                    : '';

                console.log(`    → mentionPrefix="${mentionPrefix.substring(0, 50)}..."`);

                const html = `
                    <div class="comment-item ${depth > 0 ? 'comment-item--nested' : ''} ${canReply ? 'comment-item--clickable' : ''}"
                         style="margin-left: ${indentPx}px"
                         data-comment-id="${comment.id}" 
                         data-message-id="${messageId}"
                         data-can-reply="${canReply}">
                        <div class="comment-header">
                            <i class="fas fa-user-circle"></i>
                            <span class="comment-author">${escapeHtml(comment.name)}</span>
                            <span class="comment-time">${comment.timestamp}</span>
                        </div>
                        <div class="comment-content">${mentionPrefix}${escapeHtml(comment.content)}</div>
                        ${hasReplies ? renderCommentTree(comment.replies, depth + 1, messageId, comment.name) : ''}
                    </div>
                `;
                return html;
            }).join('');
        }

        const commentsHtml = hasComments
            ? renderCommentTree(msg.comments, 0, msg.id, null)
            : '<div class="no-comments">暂无评论</div>';

        const toggleButtonHtml = shouldCollapse
            ? `<button class="comment-toggle-btn" data-message-id="${msg.id}" data-count="${commentCount}">
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
            <div class="message-anim-wrapper" style="transition-delay: ${delay}s">
                <div class="message-item" data-id="${msg.id}">
                    
                    <!-- 1. Header (Author Info) -->
                    <div class="message-footer-meta">
                        <div class="author-info">
                            ${msg.avatarUrl
                ? `<img src="${msg.avatarUrl}" alt="${escapeHtml(msg.name)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.3);">`
                : '<i class="fas fa-user-circle"></i>'}
                            <span class="author-name">${escapeHtml(msg.name)}</span>
                        </div>
                        <span class="message-time">${msg.timestamp}</span> <!-- Show full date and time -->
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
        const clickableComments = document.querySelectorAll('.comment-item--clickable');

        // Toggle comments expansion
        toggleButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                const messageId = this.dataset.messageId;
                const count = this.dataset.count; // Get count from data attribute
                const commentList = document.querySelector(`.comment-list[data-message-id="${messageId}"]`);
                const icon = this.querySelector('i');
                const span = this.querySelector('span');

                if (commentList.classList.contains('collapsed')) {
                    // Expand
                    // 1. Lock current height (200px) explicitly to ensure transition start point
                    commentList.style.maxHeight = '200px';

                    // 2. Force reflow
                    void commentList.offsetHeight;

                    // 3. Remove class
                    commentList.classList.remove('collapsed');

                    // Get the full height for animation
                    const fullHeight = commentList.scrollHeight;

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
                    icon.className = 'fas fa-chevron-down';
                    span.textContent = `展开全部 ${count} 条评论`;
                }
            });
        });

        // Handle comment item clicks (click entire comment to reply)
        clickableComments.forEach(item => {
            item.addEventListener('click', function (e) {
                // Don't trigger if clicking on nested comments
                if (e.target.closest('.comment-item') !== this) return;

                const canReply = this.dataset.canReply === 'true';
                if (!canReply) return;

                const commentId = this.dataset.commentId;
                const messageId = this.dataset.messageId;

                console.log(`🖱️ Clicked comment: id=${commentId}, message=${messageId}`);

                if (!commentId || commentId === 'undefined') {
                    console.error('❌ Invalid comment ID on click');
                    return;
                }

                // Open comment modal with parent comment tracking
                openCommentModal(messageId, commentId);
            });
        });
    }

    // Handle Comment Submission
    if (commentForm) {
        commentForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // Check Auth - LeanCloud
            const currentUser = AV.User.current();
            if (!currentUser) {
                alert("请先登录后再评论");
                if (typeof toggleLoginModal === 'function') {
                    toggleLoginModal();
                }
                return;
            }

            const messageId = document.getElementById('commentMessageId').value;
            const parentCommentId = document.getElementById('commentParentId').value;
            const content = document.getElementById('commentContent').value.trim();

            if (content) {
                // Check if this is a reply to a comment or a top-level comment
                if (parentCommentId) {
                    // Nested reply
                    if (typeof addReplyToComment === 'function') {
                        addReplyToComment(parentCommentId, messageId, content);
                    }
                } else {
                    // Top-level comment
                    if (typeof addCommentToMessage === 'function') {
                        addCommentToMessage(messageId, content);
                    }
                }

                // Close modal and reset form
                document.getElementById('commentModal').classList.remove('active');
                commentForm.reset();
            }
        });
    }

    async function addComment(messageId, name, content) {
        // Use LeanCloud function if available
        if (typeof addCommentToMessage === 'function') {
            const success = await addCommentToMessage(messageId, content);
            if (success) {
                // Success is handled inside addCommentToMessage (reloads messages)
                // Scroll to the comment section of this message
                setTimeout(() => {
                    const messageCard = document.querySelector(`.message-item[data-id="${messageId}"]`);
                    if (messageCard) {
                        messageCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Add a subtle highlight effect
                        messageCard.style.transition = 'background 0.5s ease';
                        messageCard.style.background = 'rgba(155, 93, 229, 0.15)';
                        setTimeout(() => {
                            messageCard.style.background = '';
                        }, 2000);
                    }
                }, 500); // Wait for reload to complete
            }
        } else {
            console.error("❌ addCommentToMessage function not found!");
            alert("评论功能暂时不可用");
        }
    }
});

// --- Global Modal Functions (Must be outside DOMContentLoaded) ---

window.openCommentModal = function (messageId, parentCommentId = null) {
    console.log('=== openCommentModal called ===');
    console.log('Message ID:', messageId);
    console.log('Parent Comment ID:', parentCommentId);
    console.log('typeof AV:', typeof AV);

    // Check if AV SDK is loaded
    if (typeof AV === 'undefined') {
        console.error('❌ LeanCloud SDK not loaded yet');
        alert("系统加载中，请稍后再试\n\n调试信息: LeanCloud SDK未加载");
        return;
    }

    console.log('✅ AV SDK loaded');

    // Check Auth First - LeanCloud
    let currentUser;
    try {
        currentUser = AV.User.current();
        console.log('AV.User.current() result:', currentUser);

        if (currentUser) {
            console.log('✅ User object exists');
            console.log('User ID:', currentUser.id);
            console.log('Username:', currentUser.get('username'));
            console.log('Email:', currentUser.get('email'));
        } else {
            console.log('❌ No current user');
        }
    } catch (error) {
        console.error('Error getting current user:', error);
        alert("获取用户信息失败\n\n错误: " + error.message);
        return;
    }

    if (!currentUser) {
        console.warn('⚠️ No user logged in, showing login prompt');
        alert("请先登录后再评论");
        // Trigger login modal
        if (typeof toggleLoginModal === 'function') {
            console.log('Calling toggleLoginModal...');
            toggleLoginModal();
        } else {
            console.error('toggleLoginModal function not found!');
        }
        return;
    }

    console.log('✅ User authenticated, opening comment modal');
    const modal = document.getElementById('commentModal');
    const messageIdInput = document.getElementById('commentMessageId');
    const parentIdInput = document.getElementById('commentParentId');

    console.log('Modal element:', modal);
    console.log('Message ID input:', messageIdInput);
    console.log('Parent ID input:', parentIdInput);

    if (modal && messageIdInput) {
        messageIdInput.value = messageId;
        if (parentIdInput) {
            parentIdInput.value = parentCommentId || ''; // Set or clear parent ID
        }

        // CRITICAL FIX: Add body.modal-active class for CSS backdrop-filter support
        document.body.classList.add('modal-active');

        // Clear any inline styles and backdrop-filter from previous close
        modal.style.display = '';
        modal.style.visibility = '';
        modal.style.opacity = '';
        modal.style.pointerEvents = '';
        modal.style.backdropFilter = '';
        modal.style.webkitBackdropFilter = '';

        modal.classList.add('active');
        modal.classList.add('overlay-visible');
        modal.classList.remove('overlay-hidden');

        console.log('✅ Modal opened successfully');
        console.log('✅ body.modal-active class added');

        // Focus content input
        setTimeout(() => {
            const contentInput = document.getElementById('commentContent');
            if (contentInput) {
                contentInput.focus();
                console.log('✅ Content input focused');
            }
        }, 100);
    } else {
        console.error('❌ Modal or input not found!');
    }
};

window.closeCommentModal = function (event) {
    // Close if clicked on overlay or close button
    if (event.target.classList.contains('modal-overlay') ||
        event.target.closest('.mac-dot.red') ||
        event.target.closest('.close-btn')) {

        const modal = document.getElementById('commentModal');
        if (modal) {
            // CRITICAL FIX: Remove body.modal-active class to clear background blur
            document.body.classList.remove('modal-active');
            console.log('✅ body.modal-active class removed');

            modal.classList.remove('active');
            modal.classList.remove('overlay-visible'); // CRITICAL: Remove this to allow fade out

            // Immediately remove backdrop-filter to prevent residue
            modal.style.backdropFilter = 'none';
            modal.style.webkitBackdropFilter = 'none';

            // Clear form
            const form = document.getElementById('commentForm');
            if (form) form.reset();

            // After animation, force complete cleanup
            setTimeout(() => {
                modal.classList.add('overlay-hidden');
                modal.style.display = 'none'; // Force display none
                modal.style.visibility = 'hidden';
                modal.style.opacity = '0';
                modal.style.pointerEvents = 'none';
                modal.style.backdropFilter = 'none';
                modal.style.webkitBackdropFilter = 'none';
                document.body.style.overflow = ''; // Restore scroll
            }, 200);
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
