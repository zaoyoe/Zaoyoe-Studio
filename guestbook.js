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

    // Lazy Loading State
    let allMessages = [];
    let renderedCount = 0;
    const INITIAL_LOAD = 20; // Increased for better initial fill
    const LOAD_MORE_COUNT = 20; // Increased for smoother scrolling
    let isLoading = false;
    let observer = null;

    // Make renderMessages global so it can be called by LeanCloud loader
    // Masonry Layout State
    let masonryColumns = [];
    let currentColumnCount = 0;

    // Initialize Masonry Layout
    function initMasonry() {
        const width = window.innerWidth;
        let newCols = 2; // Default Mobile/Tablet

        if (width > 1440) newCols = 5;
        else if (width > 1024) newCols = 4;

        // Only re-initialize if column count changes
        if (newCols !== currentColumnCount) {
            currentColumnCount = newCols;
            messageContainer.innerHTML = '';
            masonryColumns = [];

            for (let i = 0; i < newCols; i++) {
                const col = document.createElement('div');
                col.className = 'masonry-column';
                messageContainer.appendChild(col);
                masonryColumns.push(col);
            }
            return true; // Layout changed
        }
        return false; // No change
    }

    // Helper: Convert HTML string to DOM element
    function htmlToElement(html) {
        const template = document.createElement('template');
        html = html.trim(); // Never return a text node of whitespace as the result
        template.innerHTML = html;
        return template.content.firstChild;
    }

    // Helper: Find shortest column
    function getShortestColumn() {
        if (masonryColumns.length === 0) return messageContainer;

        let minHeight = Infinity;
        let shortest = masonryColumns[0];

        masonryColumns.forEach(col => {
            // Use offsetHeight for actual rendered height
            if (col.offsetHeight < minHeight) {
                minHeight = col.offsetHeight;
                shortest = col;
            }
        });
        return shortest;
    }

    // Make renderMessages global
    window.renderMessages = function (messages) {
        if (!messageContainer) return;

        allMessages = messages;
        renderedCount = 0;

        console.log('🔍 [Guestbook Debug] Total messages:', allMessages.length);

        // Fade in container
        messageContainer.style.opacity = '1';

        if (messages.length === 0) {
            emptyState.style.display = 'flex';
            messageContainer.innerHTML = ''; // Clear any columns
            return;
        }

        emptyState.style.display = 'none';

        // Force init masonry
        currentColumnCount = 0; // Reset to force init
        initMasonry();

        // Render initial batch
        renderBatch(INITIAL_LOAD);

        // Set up infinite scroll
        if (renderedCount < allMessages.length) {
            setupInfiniteScroll();
        } else {
            const loadingIndicator = document.getElementById('loadingIndicator');
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    };

    function renderBatch(count) {
        const startIndex = renderedCount;
        const endIndex = Math.min(renderedCount + count, allMessages.length);
        const batch = allMessages.slice(startIndex, endIndex);

        console.log(`🔍 [Guestbook Debug] Rendering batch: ${batch.length} items`);

        // Render batch
        batch.forEach((msg, index) => {
            const html = createMessageCard(msg, startIndex + index);
            const element = htmlToElement(html);

            // Find shortest column and append
            const targetCol = getShortestColumn();
            targetCol.appendChild(element);

            // Trigger animation
            // Simple delay based on batch index for top-to-bottom feel within the batch
            const delay = Math.min(index * 0.05, 0.5);
            element.style.transitionDelay = `${delay}s`;

            // Force reflow
            void element.offsetWidth;
            element.classList.add('visible');
        });

        renderedCount = endIndex;

        // Attach handlers
        attachCommentHandlers();

        // Add loading indicator
        updateLoadingIndicator();

        // Re-setup infinite scroll
        if (renderedCount < allMessages.length) {
            setupInfiniteScroll();
        }

        // Trigger scroll highlight (Mobile)
        observeNewItems();
    }

    // Handle Resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (initMasonry()) {
                // If layout changed, re-render everything
                // We need to reset renderedCount and re-render all currently loaded messages
                // But to keep it simple and consistent, let's just re-render the currently visible amount
                // Or just re-distribute? Re-distributing is hard because we need to detach and re-attach.
                // Easiest is to re-render from scratch up to current renderedCount.

                const currentCount = renderedCount;
                renderedCount = 0;
                currentColumnCount = 0; // Force init
                initMasonry();

                // Re-render all previously rendered messages
                // We render them in one go, but we might want to batch them if too many?
                // For now, just render them all.
                const messagesToRender = allMessages.slice(0, currentCount);

                messagesToRender.forEach((msg, index) => {
                    const html = createMessageCard(msg, index);
                    const element = htmlToElement(html);
                    const targetCol = getShortestColumn();
                    targetCol.appendChild(element);
                    element.classList.add('visible'); // No animation on resize
                    element.style.transitionDelay = '0s';
                });

                renderedCount = currentCount;
                attachCommentHandlers();
            }
        }, 200);
    });
    // Persistent observer
    let infiniteScrollObserver = null;

    function setupInfiniteScroll() {
        // 1. Create Sentinel (Invisible Trigger)
        let sentinel = document.getElementById('scrollSentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'scrollSentinel';
            sentinel.style.cssText = `
                width: 100%;
                height: 10px;
                background: transparent;
                pointer-events: none;
                clear: both;
            `;
            messageContainer.parentElement.appendChild(sentinel);
        }

        // 2. Create Loading Spinner (Visible Indicator)
        let loadingIndicator = document.getElementById('loadingIndicator');
        if (!loadingIndicator) {
            loadingIndicator = document.createElement('div');
            loadingIndicator.id = 'loadingIndicator';
            // Strictly transparent and hidden by default
            loadingIndicator.style.cssText = `
                width: 100%;
                padding: 20px;
                text-align: center;
                color: rgba(255, 255, 255, 0.6);
                font-size: 0.9rem;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                clear: both;
                opacity: 0;
                visibility: hidden; /* Ensure it's not rendered */
                transition: opacity 0.3s, visibility 0.3s;
                pointer-events: none; /* Prevent clicks */
            `;
            loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
            // Insert BEFORE sentinel so sentinel is always last
            messageContainer.parentElement.insertBefore(loadingIndicator, sentinel);
        }

        // If observer already exists, do nothing
        if (infiniteScrollObserver) return;

        // Set up Intersection Observer on the SENTINEL
        infiniteScrollObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                // Check if sentinel is intersecting
                if (entry.isIntersecting && !isLoading && renderedCount < allMessages.length) {
                    console.log('🔍 [Guestbook Debug] Sentinel intersected, triggering load');
                    isLoading = true;

                    // Show spinner
                    if (loadingIndicator) {
                        loadingIndicator.style.visibility = 'visible';
                        loadingIndicator.style.opacity = '1';
                    }

                    // Simulate delay
                    setTimeout(() => {
                        renderBatch(LOAD_MORE_COUNT);
                        isLoading = false;
                    }, 500);
                }
            });
        }, {
            root: null,
            rootMargin: '200px', // Trigger well before bottom
            threshold: 0.1
        });

        infiniteScrollObserver.observe(sentinel);
    }

    function updateLoadingIndicator() {
        const loadingIndicator = document.getElementById('loadingIndicator');
        const sentinel = document.getElementById('scrollSentinel');

        if (loadingIndicator) {
            if (renderedCount < allMessages.length) {
                // Keep spinner in DOM but hide it until loading starts
                // It will be shown by the observer callback when loading starts
                // Or we can show it "ready" state? No, better hide it.
                loadingIndicator.style.opacity = '0';
                loadingIndicator.style.visibility = 'hidden';
            } else {
                // All loaded
                loadingIndicator.style.display = 'none';
                if (sentinel) sentinel.style.display = 'none'; // Disable sentinel
                if (infiniteScrollObserver) infiniteScrollObserver.disconnect();
            }
        }
    }

    // Call this AFTER defining renderMessages to avoid race condition
    waitForLeanCloud();

    function createMessageCard(msg, index = 0) {
        const hasComments = msg.comments && msg.comments.length > 0;
        // Recursively count all comments (including nested replies)
        function countAllComments(comments) {
            if (!comments || comments.length === 0) return 0;
            let total = comments.length;
            comments.forEach(c => {
                if (c.replies && c.replies.length > 0) {
                    total += countAllComments(c.replies);
                }
            });
            return total;
        }
        const commentCount = msg.comments ? countAllComments(msg.comments) : 0;
        const shouldCollapse = commentCount > 2;

        // Calculate delay based on item's actual DOM position (top-to-bottom)
        // This is calculated after rendering using element's offsetTop
        const delay = 0; // Will be set dynamically after render

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
                        <div class="comment-row">
                            <div class="comment-main">
                                <div class="comment-header">
                                    <span class="comment-author">${escapeHtml(comment.name)}</span>
                                    <span class="comment-time">${comment.timestamp}</span>
                                </div>
                                <div class="comment-content">${mentionPrefix}${escapeHtml(comment.content)}</div>
                            </div>
                            <div class="comment-like-wrapper">
                                <button class="comment-like-btn ${comment.isLiked ? 'active' : ''}" 
                                        onclick="handleLike('Comment', '${comment.id}', this)">
                                    <i class="${comment.isLiked ? 'fas' : 'far'} fa-heart"></i>
                                    <span class="like-count">${comment.likes || 0}</span>
                                </button>
                            </div>
                        </div>
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
                <span>展开</span>
                <i class="fas fa-chevron-down"></i>
               </button>`
            : '';

        // 🔍 DEBUG: Check if image string is "null" or "undefined"
        const hasValidImage = msg.image && msg.image !== 'null' && msg.image !== 'undefined';
        if (msg.image && !hasValidImage) {
            console.warn(`⚠️ Invalid image URL detected for message ${msg.id}:`, msg.image);
        }

        const imageHtml = hasValidImage
            ? `<div class="message-image">
            <img src="${msg.image}" alt="用户上传图片" loading="lazy" onclick="openImageModal(this.src)" onerror="this.style.display='none'; this.parentElement.style.display='none';">
           </div>`
            : '';

        const messageHtml = `
            <div class="message-anim-wrapper" style="transition-delay: ${delay}s">
                <div class="message-item" data-id="${msg.id}">
                    
                    <!-- 1. Header (Author Info & Time) -->
                    <div class="message-header">
                        <div class="author-info">
                            ${msg.avatarUrl
                ? `<img src="${msg.avatarUrl}" alt="${escapeHtml(msg.name)}" class="author-avatar">`
                : '<i class="fas fa-user-circle author-avatar-placeholder"></i>'}
                            <span class="author-name">${escapeHtml(msg.name)}</span>
                        </div>
                        <span class="message-time">${msg.timestamp}</span>
                    </div>

                    <!-- 2. Content -->
                    <div class="message-content">${escapeHtml(msg.content)}</div>

                    <!-- 3. Image -->
                    ${imageHtml}
                    
                    <!-- 4. Actions Bar (Like & Comment) - Refactored for perfect symmetry -->
                    <div class="message-actions-bar">
                        <button class="action-btn like-btn ${msg.isLiked ? 'active' : ''}" 
                                onclick="handleLike('Message', '${msg.id}', this)">
                            <i class="${msg.isLiked ? 'fas' : 'far'} fa-heart"></i>
                            <span>${msg.likes || 0}</span>
                        </button>
                        
                        <button class="action-btn comment-btn" 
                                onclick="window.openCommentModal('${msg.id}')">
                            <i class="far fa-comment"></i>
                            <span>${commentCount || 0}</span>
                        </button>
                    </div>
                    
                    
                    <!-- 5. Comment Section -->
                    <div class="comment-section">
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
                    span.textContent = '收起';

                    // 6. Cleanup after animation (simple timeout is more reliable than transitionend here)
                    setTimeout(() => {
                        if (!commentList.classList.contains('collapsed')) {
                            commentList.style.maxHeight = 'none';
                        }
                    }, 500); // Match transition duration

                } else {
                    // Collapse
                    // Set explicit current height first for smooth animation
                    const currentHeight = commentList.scrollHeight;
                    commentList.style.maxHeight = currentHeight + 'px';

                    // Force reflow
                    void commentList.offsetHeight;

                    // Then animate to collapsed height
                    commentList.style.maxHeight = '200px';
                    commentList.classList.add('collapsed');

                    // Update button text
                    span.textContent = '展开';
                    icon.className = 'fas fa-chevron-down';
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
    // Initialize Scroll Highlight for Mobile
    let scrollObserver = null;

    // Mobile Scroll Highlight - Scroll Event Version (More Stable)
    function initScrollHighlight() {
        if (window.innerWidth > 768) return;

        const handleScroll = () => {
            const centerY = window.innerHeight / 2;
            const items = document.querySelectorAll('.message-item');
            let closestItem = null;
            let minDistance = Infinity;

            items.forEach(item => {
                const rect = item.getBoundingClientRect();
                // Calculate distance from item center to viewport center
                const itemCenterY = rect.top + (rect.height / 2);
                const distance = Math.abs(centerY - itemCenterY);

                if (distance < minDistance) {
                    minDistance = distance;
                    closestItem = item;
                }

                // Reset all
                item.classList.remove('active-focus');
            });

            // Highlight closest
            if (closestItem) {
                closestItem.classList.add('active-focus');
            }
        };

        // Throttled scroll listener
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    handleScroll();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });

        // Initial check
        handleScroll();
    }

    function observeNewItems() {
        // For scroll version, we just need to re-run the check
        // No need to observe individual items
        setTimeout(() => {
            if (window.innerWidth <= 768) {
                // Trigger a scroll check manually
                const event = new Event('scroll');
                window.dispatchEvent(event);
            }
        }, 200);
    }

    // Initialize on load
    scrollObserver = initScrollHighlight();
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
        // CRITICAL: Reset all inline styles to allow CSS animations
        modal.style.display = '';
        modal.style.visibility = '';
        modal.style.opacity = '';
        modal.style.pointerEvents = '';
        modal.style.backdropFilter = ''; // Also clear backdrop-filter
        modal.style.webkitBackdropFilter = ''; // Also clear webkit-backdrop-filter

        // Set messageId
        messageIdInput.value = messageId;
        if (parentIdInput) {
            parentIdInput.value = parentCommentId || ''; // Set or clear parent ID
        }

        // Add body class
        document.body.classList.add('modal-active');

        // Removed True Scroll Lock for iOS
        // window.savedScrollPosition = window.pageYOffset || document.documentElement.scrollTop;
        // document.body.style.position = 'fixed';
        // document.body.style.top = `-${window.savedScrollPosition}px`;
        // document.body.style.width = '100%';

        // Add active class to trigger CSS animation
        modal.classList.add('active');
        modal.classList.add('overlay-visible'); // Keep this for consistency with close
        modal.classList.remove('overlay-hidden'); // Keep this for consistency with close

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
    if (event &&
        (event.target.id === 'commentModal' ||
            event.target.closest('.mac-dot.red') ||
            event.target.closest('.close-btn'))) {

        const modal = document.getElementById('commentModal');
        if (modal) {
            // Remove body.modal-active class
            document.body.classList.remove('modal-active');

            // Removed Restore Scroll
            // document.body.style.position = '';
            // document.body.style.top = '';
            // document.body.style.width = '';
            // if (window.savedScrollPosition !== undefined) {
            //     window.scrollTo(0, window.savedScrollPosition);
            // }

            // Remove active class to trigger fade out
            modal.classList.remove('active');

            // Clear form
            const form = document.getElementById('commentForm');
            if (form) form.reset();

            // After animation completes, clean up
            setTimeout(() => {
                // Don't set display:none, just remove from view
                modal.style.visibility = 'hidden';
                modal.style.opacity = '0';
                modal.style.pointerEvents = 'none';
            }, 300); // Match CSS transition duration
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

    // 移除旧的事件监听器 - 让image-zoom.js接管所有图片交互
    // image-zoom.js会处理缩放、拖动和点击重置

    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // Lock background scrolling

}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ==================== 点赞处理 ====================
window.handleLike = async function (type, id, btn) {
    // 阻止冒泡，防止触发卡片点击
    if (event) event.stopPropagation();

    const icon = btn.querySelector('i');
    const countSpan = btn.querySelector('span');
    let count = parseInt(countSpan.textContent) || 0;

    // 乐观 UI 更新
    const isLiked = btn.classList.contains('active');
    if (isLiked) {
        btn.classList.remove('active');
        icon.classList.replace('fas', 'far');
        count = Math.max(0, count - 1);
    } else {
        btn.classList.add('active');
        icon.classList.replace('far', 'fas');
        count++;

        // 添加点赞动画效果
        icon.style.transform = 'scale(1.2)';
        setTimeout(() => icon.style.transform = 'scale(1)', 200);
    }
    countSpan.textContent = count;

    // 调用后端 API
    if (typeof toggleLike === 'function') {
        const result = await toggleLike(type, id);
        if (result) {
            // 确保最终状态一致
            countSpan.textContent = result.likes;
            if (result.isLiked) {
                btn.classList.add('active');
                icon.classList.replace('far', 'fas');
            } else {
                btn.classList.remove('active');
                icon.classList.replace('fas', 'far');
            }
        } else {
            // 失败回滚
            if (isLiked) {
                btn.classList.add('active');
                icon.classList.replace('far', 'fas');
                countSpan.textContent = count + 1;
            } else {
                btn.classList.remove('active');
                icon.classList.replace('fas', 'far');
                countSpan.textContent = count - 1;
            }
        }
    } else {
        console.error('toggleLike function not found!');
    }
};
