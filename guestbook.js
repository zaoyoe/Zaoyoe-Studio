/* ==================== Guestbook Display Page JavaScript ==================== */

document.addEventListener('DOMContentLoaded', () => {
    const messageContainer = document.getElementById('messageContainer');
    const floatingBackBtn = document.querySelector('.floating-back-btn');
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

    // 🔧 FIX: Declare these variables early to avoid ReferenceError
    let commentHandlersAttached = false;
    let mobileHighlightActive = false;
    let currentHighlightedItem = null;

    // Load messages from Supabase
    console.log('📋 加载 Supabase 留言...');

    // Show loading state
    if (messageContainer) {
        messageContainer.innerHTML = `<div style="text-align:center; padding:20px; color:rgba(255,255,255,0.5); font-size:0.9rem;">${window.i18n?.t('common.loading') || '加载中...'}</div>`;
    }

    // Wait for Supabase to be ready, then load messages
    function waitForSupabase() {
        if (typeof window.supabaseClient !== 'undefined' && typeof loadGuestbookMessages === 'function') {
            console.log('✅ Supabase 已就绪，加载留言');
            loadGuestbookMessages();

            // ✅ 启用实时推送（Supabase Realtime）
            if (typeof enableRealTimeUpdates === 'function') {
                console.log('🔌 准备启用 Supabase Realtime...');
                setTimeout(enableRealTimeUpdates, 1000);
            } else {
                console.warn('⚠️ enableRealTimeUpdates 函数未找到');
            }
        } else {
            console.log('⏳ 等待 Supabase 初始化...');
            setTimeout(waitForSupabase, 100);
        }
    }



    // Lazy Loading State
    // ⚡ PERF: Adaptive Pagination Strategy
    // Mobile: 10 items (Balanced load)
    // Desktop: 15 items (Fill screen)
    const getBatchSize = () => window.innerWidth <= 768 ? 10 : 15;

    // Initial load uses the same logic
    const getInitialLoadSize = () => window.innerWidth <= 768 ? 10 : 15;

    let allMessages = [];
    let renderedCount = 0;
    let isLoading = false;
    let infiniteScrollObserver = null;

    // 🚨 状态重置函数（供loadGuestbookMessages调用）
    window.resetGuestbookState = function () {
        console.log('🔄 重置留言板状态');
        renderedCount = 0;
        isLoading = false;
        allMessages = [];
        // 如果有infiniteScrollObserver，先销毁
        if (infiniteScrollObserver) {
            infiniteScrollObserver.disconnect();
            infiniteScrollObserver = null;
        }
    };

    // Make renderMessages global so it can be called by Supabase loader
    // Masonry Layout State
    let masonryColumns = [];
    let currentColumnCount = 0;


    // Initialize Masonry Layout
    function initMasonry() {
        // Use matchMedia for more reliable mobile detection
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const width = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);

        console.log('🔍 [Masonry Debug] isMobile:', isMobile, 'width:', width, 'innerWidth:', window.innerWidth, 'clientWidth:', document.documentElement.clientWidth);

        let newCols = 1; // Default

        if (isMobile) {
            newCols = 1; // Force 1 column on mobile
            console.log('📱 [Masonry] Mobile detected, forcing 1 column');
        } else {
            // Desktop/Tablet breakpoints
            if (width > 2400) newCols = 5;      // Ultra-wide
            else if (width > 1600) newCols = 4; // 4K / Large Desktop
            else if (width > 1024) newCols = 3;  // Standard Desktop
            else if (width > 768) newCols = 2;  // Tablets
            else newCols = 1;                   // Fallback
            console.log('💻 [Masonry] Desktop/Tablet mode, columns:', newCols);
        }

        console.log('📊 [Masonry] Final column count:', newCols, 'Previous:', currentColumnCount);

        // Only re-initialize if column count changes
        if (newCols !== currentColumnCount) {
            currentColumnCount = newCols;
            messageContainer.innerHTML = '';
            masonryColumns = [];

            // 🔧 Mobile: Use simple container without flex columns
            if (isMobile) {
                console.log('📱 [Masonry] Creating simple mobile container');
                messageContainer.style.display = 'block';
                messageContainer.style.width = '100%';
                masonryColumns.push(messageContainer);
            } else {
                // Desktop: Use flex columns
                console.log('💻 [Masonry] Creating', newCols, 'flex columns');
                messageContainer.style.display = 'flex';
                messageContainer.style.width = '100%';

                for (let i = 0; i < newCols; i++) {
                    const col = document.createElement('div');
                    col.className = 'masonry-column';
                    messageContainer.appendChild(col);
                    masonryColumns.push(col);
                }
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
            const h = col.offsetHeight;
            // If height is smaller, pick it
            if (h < minHeight) {
                minHeight = h;
                shortest = col;
            }
            // If heights are equal (e.g. both 0 on initial load), pick the one with fewer items
            else if (h === minHeight) {
                if (col.childElementCount < shortest.childElementCount) {
                    shortest = col;
                }
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

        // Initial render
        const initialCount = getInitialLoadSize();
        console.log(`🚀 Initial render count: ${initialCount} (Mobile: ${window.innerWidth <= 768})`);
        renderBatch(initialCount);

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
            try {
                const html = createMessageCard(msg, startIndex + index);
                if (!html) {
                    console.error('❌ createMessageCard returned null for msg:', msg.id);
                    return;
                }
                const element = htmlToElement(html);
                if (!element) {
                    console.error('❌ htmlToElement failed for msg:', msg.id);
                    return;
                }

                // Find shortest column and append
                const targetCol = getShortestColumn();
                targetCol.appendChild(element);

                // Trigger animation with delay
                // ⚡ CRITICAL FIX: Always use staggered animation for "cascading" effect
                // This restores the "obvious" animation user requested
                const delay = Math.min(index * 0.1, 1.0); // 100ms stagger, capped at 1s

                setTimeout(() => {
                    element.classList.add('visible');
                }, delay * 1000);
            } catch (err) {
                console.error('❌ Error rendering message:', msg.id, err);
            }
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

        // ✅ 同步用户最新头像
        syncUserAvatars();
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

                    // ⚡ VISUALS FIRST: Enable staggered animation on resize
                    // Using slightly faster stagger (50ms) for resize to feel responsive but fluid
                    const delay = Math.min(index * 0.05, 1.0);
                    setTimeout(() => {
                        element.classList.add('visible');
                    }, delay * 1000);
                });

                renderedCount = currentCount;
                attachCommentHandlers();
            }
        }, 200);
    });

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
            loadingIndicator.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${window.i18n?.t('common.loading') || '加载中...'}`;
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
                        // Load more
                        const batchSize = getBatchSize();
                        console.log(`📜 Loading more: ${batchSize} items`);
                        renderBatch(batchSize);
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
    waitForSupabase();

    function createMessageCard(msg, index = 0) {
        const hasComments = msg.comments && msg.comments.length > 0;
        console.log('💬 [createMessageCard] hasComments:', hasComments, 'count:', msg.comments?.length);
        // Recursively count all comments (including nested replies)
        function countAllComments(comments) {
            if (!comments || comments.length === 0) return 0;
            let total = 0;
            comments.forEach(c => {
                if (!c) return; // ⚡ Skip null comments
                total++;
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
            const indentPx = Math.min(depth * 10, 20); // Reduced indent: Max 20px (was 40px)
            // ⚡ CRITICAL FIX: Always allow clicking, handle depth limit in UI
            const canReply = true; // Always allow reply

            return comments.map((comment, idx) => {
                if (!comment) return ''; // ⚡ Skip null comments
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

                // ✅ 显示 @mention：只要有 mentionName 就显示（不限制 depth）
                const mentionPrefix = mentionName
                    ? `<span class="comment-mention">@${escapeHtml(mentionName)}</span> `
                    : '';

                console.log(`    → mentionPrefix="${mentionPrefix.substring(0, 50)}..."`);

                const html = `
                    <div class="comment-item ${depth > 0 ? 'comment-item--nested' : ''} ${canReply ? 'comment-item--clickable' : ''}"
                         style="margin-left: ${indentPx}px"
                         data-depth="${depth}"
                         data-comment-id="${comment.id}" 
                         data-message-id="${messageId}"
                         data-author-id="${comment.authorId || ''}"
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
            : '';  // ✅ 移除"暂无评论"，留空即可

        console.log('🎭 commentsHtml 长度:', commentsHtml.length, '预览:', commentsHtml.substring(0, 100));

        const toggleButtonHtml = shouldCollapse
            ? `<button class="comment-toggle-btn" data-message-id="${msg.id}" data-count="${commentCount}">
                <span>${window.i18n?.t('guestbook.expand') || '展开'}</span>
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
            <img src="${msg.image}" alt="用户上传图片" loading="lazy" decoding="async" onclick="openImageModal(this.src)" onerror="this.style.display='none'; this.parentElement.style.display='none';">
           </div>`
            : '';

        const messageHtml = `
            <div class="message-anim-wrapper" style="transition-delay: ${delay}s">
                <div class="message-item" data-message-id="${msg.id}" data-author-id="${msg.authorId || ''}">
                    
                    <!-- 1. Header (Author Info & Time) -->
                    <div class="message-header">
                        <div class="author-info">
                            ${msg.avatarUrl
                ? `<img src="${msg.avatarUrl}" alt="${escapeHtml(msg.name)}" class="author-avatar" loading="lazy" decoding="async">`
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
                            <span class="like-count">${msg.likes || 0}</span>
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

    // ✅ 暴露到全局作用域，供其他文件使用
    window.createMessageCard = createMessageCard;


    // Use event delegation for comment handlers to avoid duplicate listeners

    function attachCommentHandlers() {
        // Only attach once using event delegation
        if (commentHandlersAttached) return;
        commentHandlersAttached = true;

        // Event delegation for toggle buttons
        document.addEventListener('click', function (e) {
            const toggleBtn = e.target.closest('.comment-toggle-btn');
            if (!toggleBtn) return;

            console.log('🖱️ Toggle button clicked:', toggleBtn);
            e.stopPropagation();
            const messageId = toggleBtn.dataset.messageId;
            const count = toggleBtn.dataset.count;
            const commentList = document.querySelector(`.comment-list[data-message-id="${messageId}"]`);
            const icon = toggleBtn.querySelector('i');
            const span = toggleBtn.querySelector('span');

            if (!commentList) {
                console.error('❌ Comment list not found for message:', messageId);
                return;
            }

            // Find parent message item
            const messageItem = toggleBtn.closest('.message-item');

            if (commentList.classList.contains('collapsed')) {
                // Expand
                // ⚡ PERF: Pause highlight observer during massive layout shift
                if (mobileHighlightObserver) {
                    mobileHighlightObserver.disconnect();
                    mobileHighlightActive = false;
                }

                // ⚡ FIX: Prevent overlap by clipping content during animation
                commentList.style.overflow = 'hidden';

                // ⚡ FIX: Raise z-index of expanded card
                if (messageItem) messageItem.classList.add('expanded');

                commentList.style.maxHeight = '160px';
                void commentList.offsetHeight;
                commentList.classList.remove('collapsed');
                const fullHeight = commentList.scrollHeight;

                // ⚡ PERF: Adaptive animation speed based on content height
                // Formula: Height / 1500 (seconds), clamped between 0.4s and 0.8s
                const duration = Math.min(Math.max(fullHeight / 1500, 0.4), 0.8);

                // Apply dynamic duration to both content and card container
                commentList.style.transitionDuration = `${duration}s`;
                if (messageItem) {
                    messageItem.style.transitionDuration = `${duration}s`;
                }

                // ⚡ FIX: Add 50px buffer to prevent snap at end of animation
                commentList.style.maxHeight = (fullHeight + 50) + 'px';
                icon.className = 'fas fa-chevron-up';
                span.textContent = window.i18n?.t('guestbook.collapse') || '收起';

                // Timeout = duration + 0.2s buffer
                setTimeout(() => {
                    if (!commentList.classList.contains('collapsed')) {
                        commentList.style.maxHeight = 'none';
                        // ⚡ FIX: Restore visible overflow for glow effects after animation
                        commentList.style.overflow = 'visible';

                        // Reset inline styles to allow CSS to take over (optional, but good practice)
                        // commentList.style.transitionDuration = '';
                        // if (messageItem) messageItem.style.transitionDuration = '';
                    }
                    // ⚡ PERF: Resume highlight observer
                    initMobileHighlight();
                }, (duration * 1000) + 200);
            } else {
                // Collapse
                // ⚡ PERF: Pause highlight observer during massive layout shift
                if (mobileHighlightObserver) {
                    mobileHighlightObserver.disconnect();
                    mobileHighlightActive = false;
                }

                // ⚡ FIX: Clip immediately to prevent spillover
                commentList.style.overflow = 'hidden';

                // ⚡ FIX: Reset z-index when collapsed
                if (messageItem) messageItem.classList.remove('expanded');

                const currentHeight = commentList.scrollHeight;

                // ⚡ PERF: Adaptive animation speed based on content height
                // Formula: Height / 1500 (seconds), clamped between 0.4s and 0.8s
                const duration = Math.min(Math.max(currentHeight / 1500, 0.4), 0.8);

                // Apply dynamic duration to both content and card container
                commentList.style.transitionDuration = `${duration}s`;
                if (messageItem) {
                    messageItem.style.transitionDuration = `${duration}s`;
                }

                // ⚡ OPTIMIZATION: Force reflow then collapse in next frame
                commentList.style.maxHeight = currentHeight + 'px';
                void commentList.offsetHeight; // Force reflow

                requestAnimationFrame(() => {
                    commentList.style.maxHeight = '160px';
                    commentList.classList.add('collapsed');
                });

                // 🔧 FIX: Revert button text and icon
                icon.className = 'fas fa-chevron-down';
                span.textContent = window.i18n?.t('guestbook.expand') || '展开';
            }
        });

        // Event delegation for clickable comments
        document.addEventListener('click', function (e) {
            const clickableComment = e.target.closest('.comment-item--clickable');
            if (!clickableComment) return;

            // Don't trigger if clicking on nested comments
            if (e.target.closest('.comment-item') !== clickableComment) return;

            const canReply = clickableComment.dataset.canReply === 'true';
            if (!canReply) return;

            const commentId = clickableComment.dataset.commentId;
            const messageId = clickableComment.dataset.messageId;

            console.log(`🖱️ Clicked comment: id=${commentId}, message=${messageId}`);

            if (!commentId || commentId === 'undefined') {
                console.error('❌ Invalid comment ID on click');
                return;
            }

            // Open comment modal with parent comment tracking
            openCommentModal(messageId, commentId);
        });
    }


    // Handle Comment Submission
    if (commentForm) {
        commentForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Check Auth - Supabase
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) {
                alert(window.i18n?.t('auth.loginRequired') || '请先登录后再评论');
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
        // Use Supabase function if available
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
            alert(window.i18n?.t('auth.commentUnavailable') || '评论功能暂时不可用');
        }
    }
    // Mobile Scroll Highlight - Optimized with IntersectionObserver
    // (Variables declared at top of file)
    let mobileHighlightObserver = null;

    function initMobileHighlight() {
        if (window.innerWidth > 768) return;
        if (mobileHighlightActive) return;

        console.log('📱 [Mobile Highlight] Initializing Optimized Observer...');

        // ⚡ OPTIMIZATION: Use IntersectionObserver instead of scroll listener
        // rootMargin: '-50% 0px -50% 0px' creates a 0px high line in the center of the viewport
        const options = {
            root: null, // viewport
            rootMargin: '-50% 0px -50% 0px',
            threshold: 0
        };

        mobileHighlightObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Card entered the center line

                    // Remove focus from previous
                    if (currentHighlightedItem && currentHighlightedItem !== entry.target) {
                        currentHighlightedItem.classList.remove('active-focus');
                    }

                    // Add focus to new
                    entry.target.classList.add('active-focus');
                    currentHighlightedItem = entry.target;
                    // console.log('📱 [Mobile Highlight] Focused:', entry.target.dataset.messageId);
                }
            });
        }, options);

        // Start observing all existing items
        const items = document.querySelectorAll('.message-item');
        items.forEach(item => mobileHighlightObserver.observe(item));

        mobileHighlightActive = true;
        console.log('📱 [Mobile Highlight] Optimized Observer Initialized');
    }

    function observeNewItems() {
        // For mobile, ensure highlight system is initialized
        if (window.innerWidth <= 768) {
            if (!mobileHighlightActive) {
                initMobileHighlight();
            } else if (mobileHighlightObserver) {
                // Add new items to observer
                const items = document.querySelectorAll('.message-item:not(.observed-by-highlight)');
                items.forEach(item => {
                    mobileHighlightObserver.observe(item);
                    item.classList.add('observed-by-highlight'); // Mark as observed
                });
            }
        }
    }

    // Mobile highlight will be initialized by observeNewItems() when first batch renders
});

// --- Global Modal Functions (Must be outside DOMContentLoaded) ---

window.openCommentModal = async function (messageId, parentCommentId = null) {
    console.log('=== openCommentModal called ===');
    console.log('Message ID:', messageId);
    console.log('Parent Comment ID:', parentCommentId);

    // Check Auth First - Supabase
    let user;
    try {
        const { data: { user: currentUser }, error } = await window.supabaseClient.auth.getUser();
        user = currentUser;
        console.log('Supabase user:', user);

        if (user) {
            console.log('✅ User authenticated');
            console.log('User ID:', user.id);
            console.log('Email:', user.email);
        } else {
            console.log('❌ No current user');
        }
    } catch (error) {
        console.error('Error getting current user:', error);
        alert("获取用户信息失败\n\n错误: " + error.message);
        return;
    }

    if (!user) {
        console.warn('⚠️ No user logged in, showing login prompt');
        alert(window.i18n?.t('auth.loginRequired') || '请先登录后再评论');
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

    // 禁用按钮，防止重复点击
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.style.cursor = 'not-allowed';

    // 调用后端 API
    if (typeof toggleLike === 'function') {
        console.log(`💗 开始点赞操作...`);
        const result = await toggleLike(type, id);
        console.log(`💗 点赞操作返回:`, result);

        if (result) {
            // 根据后端返回结果更新UI
            console.log(`💗 更新UI: likes=${result.likes}, isLiked=${result.isLiked}`);
            countSpan.textContent = result.likes;

            if (result.isLiked) {
                btn.classList.add('active');
                icon.classList.remove('far');
                icon.classList.add('fas');
                // 添加点赞动画
                icon.style.transform = 'scale(1.2)';
                setTimeout(() => icon.style.transform = 'scale(1)', 200);
            } else {
                btn.classList.remove('active');
                icon.classList.remove('fas');
                icon.classList.add('far');
            }
        } else {
            console.error('💗 点赞操作失败');
        }
    } else {
        console.error('toggleLike function not found!');
    }

    // 重新启用按钮
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
};

// === Phase 3: 智能滚动辅助函数 ===

/**
 * 🧠 辅助函数：等待元素出现（基于 MutationObserver）
 * @param {string} selector - CSS 选择器
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Element|null>} 找到的元素或 null
 */
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
        // 1. 立即查找，可能已存在
        const existingElement = document.querySelector(selector);
        if (existingElement) {
            return resolve(existingElement);
        }

        // 2. 不存在，启动观察者
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        // 3. 只监听主要容器，提升性能
        const container = document.querySelector('.message-container') || document.body;
        observer.observe(container, {
            childList: true,
            subtree: true
        });

        // 4. 超时保险
        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

/**
 * 🎣 辅助函数：拉取单条留言并插入
 * @param {string} messageId - 留言 ID
 * @param {string} targetId - (可选) 触发拉取的目标ID（可能是评论ID）
 * @param {string} type - (可选) 类型 'message' | 'comment'
 * @returns {Promise<boolean>} 是否成功
 */
async function fetchAndInsertSingleMessage(messageId, targetId = null, type = 'message') {
    try {
        console.log(`🎣 拉取单条留言: ${messageId}`);

        // ✅ 首先检查是否已存在
        const existingEarly = document.getElementById(`msg-${messageId}`);
        if (existingEarly) {
            console.warn(`⚠️ [早期检查] 留言已存在，直接返回: ${messageId}`);
            return true;
        }

        // 1. 拉取留言本体
        const messageQuery = new AV.Query('Message');
        messageQuery.include('author');
        messageQuery.descending('createdAt');
        const avMessage = await messageQuery.get(messageId);

        // 2. 拉取该留言的所有评论
        console.log('📝 拉取评论数据...');
        const commentQuery = new AV.Query('Comment');

        // ✅ 修复：使用Pointer字段查询
        const messagePointer = AV.Object.createWithoutData('Message', messageId);
        commentQuery.equalTo('message', messagePointer);

        commentQuery.include('author');
        commentQuery.ascending('createdAt');
        const avComments = await commentQuery.find();

        console.log(`✅ 找到 ${avComments.length} 条评论`);

        // 验证第一条评论的ID
        if (avComments.length > 0) {
            console.log('🔑 第一条评论 ID:', avComments[0].id);
        }

        // 3. 数据完整性处理 (Batch Likes & Tree Build) ---

        // 3.1 收集所有 ID (留言 + 评论) 用于批量查询点赞
        const allTargetIds = [messageId, ...avComments.map(c => c.id)];
        const likeCounts = {};
        const userLikedSet = new Set();
        const currentUserId = AV.User.current()?.id;

        if (allTargetIds.length > 0) {
            try {
                const likeQuery = new AV.Query('Like');
                likeQuery.containedIn('targetId', allTargetIds);
                likeQuery.limit(1000); // Max limit
                const allLikes = await likeQuery.find();

                allLikes.forEach(like => {
                    const tid = like.get('targetId');
                    likeCounts[tid] = (likeCounts[tid] || 0) + 1;
                    const likeUserId = like.get('userId') || like.get('user')?.id;
                    if (currentUserId && likeUserId === currentUserId) {
                        userLikedSet.add(tid);
                    }
                });
                console.log(`✅ 批量获取点赞成功: ${allLikes.length} 条记录`);
            } catch (e) {
                console.warn('⚠️ 批量获取点赞失败:', e);
            }
        }

        // 3.2 格式化评论并构建树
        const commentMap = new Map();
        const topLevelComments = [];

        avComments.forEach(c => {
            // 处理 parentCommentId 为字符串 "null" 的情况
            let pId = c.get('parentCommentId');
            if (pId === 'null' || pId === 'undefined') pId = null;

            const formattedComment = {
                id: c.id,
                name: c.get('userName') || '匿名用户',
                avatarUrl: c.get('userAvatar') || null,
                content: c.get('content') || '',
                timestamp: c.createdAt ? c.createdAt.toLocaleString('zh-CN', {
                    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                }) : '',
                rawDate: c.createdAt, // ✅ 补充 rawDate
                parentCommentId: pId,
                parentUserName: c.get('parentUserName') || null,
                likes: likeCounts[c.id] || 0, // ✅ 填充点赞数
                isLiked: userLikedSet.has(c.id), // ✅ 填充点赞状态
                replies: [] // 准备存放子评论
            };
            commentMap.set(c.id, formattedComment);
        });

        // 构建树
        commentMap.forEach(comment => {
            if (comment.parentCommentId && commentMap.has(comment.parentCommentId)) {
                const parent = commentMap.get(comment.parentCommentId);
                parent.replies.push(comment);
                // 补充 parentUserName 如果缺失
                if (!comment.parentUserName) comment.parentUserName = parent.name;
            } else {
                topLevelComments.push(comment);
            }
        });

        console.log(`🌳 评论树构建完成: ${topLevelComments.length} 条顶级评论`);

        // 检查留言是否已存在
        const existing = document.querySelector(`.message-item[data-message-id="${messageId}"]`);
        if (existing) {
            console.log('✅ 留言已存在，跳过插入');
            return true;
        }

        // 格式化留言对象，确保所有必要字段都存在
        const author = avMessage.get('author');
        const userName = avMessage.get('userName');

        const message = {
            id: avMessage.id,
            name: userName || '匿名用户',
            avatarUrl: avMessage.get('userAvatar') || (author ? author.get('avatarUrl') : null),
            email: author ? author.get('email') : null,
            content: avMessage.get('content') || '',
            image: avMessage.get('image') || avMessage.get('imageUrl') || null,
            imageUrl: avMessage.get('imageUrl') || avMessage.get('image') || null,
            timestamp: avMessage.createdAt ? avMessage.createdAt.toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            }) : '',
            rawDate: avMessage.createdAt, // ✅ 补充 rawDate
            likes: likeCounts[avMessage.id] || 0, // ✅ 使用批量查询的结果
            isLiked: userLikedSet.has(avMessage.id), // ✅ 填充点赞状态
            likedBy: [], // 兼容旧逻辑
            comments: topLevelComments // ✅ 传入构建好的顶级评论（包含嵌套子评论）
        };

        // 使用 createMessageCard 创建 HTML
        const createMessageCard = window.createMessageCard;
        if (!createMessageCard) {
            console.error('❌ createMessageCard 函数不存在');
            return false;
        }

        console.log('📝 生成HTML，留言对象:', message);
        console.log('🔑 验证 message.id:', message.id, typeof message.id);
        console.log('💬 评论数量:', message.comments?.length || 0);
        const html = createMessageCard(message, 0);

        // ✅ 立即验证 HTML 字符串
        console.log('🧩 createMessageCard 返回类型:', typeof html);
        if (typeof html === 'string') {
            console.log('📊 HTML字符串总长度:', html.length);
            console.log('🔍 包含 comment-section?', html.includes('comment-section'));
            console.log('🔍 包含 comment-list?', html.includes('comment-list'));
            console.log('🔍 预览 (0-200):', html.substring(0, 200));
        } else {
            console.log('⚠️ createMessageCard 返回的不是字符串！');
        }

        // 检查生成的HTML
        if (typeof html === 'string') {
            console.log('🔍 HTML片段:', html.substring(0, 300));
            console.log(html.includes('data-message-id') ? '✅ 包含data-message-id' : '❌ 不包含data-message-id');
            const commentCount = (html.match(/data-comment-id/g) || []).length;
            console.log(`💬 HTML中的评论元素数: ${commentCount}`);
        }

        // 宽容处理：字符串转DOM，对象直接用
        let element;
        if (typeof html === 'string') {
            console.log('📦 HTML字符串长度:', html.length);
            console.log('🔍 HTML包含comment-section?', html.includes('comment-section'));
            console.log('🔍 HTML包含comment-list?', html.includes('comment-list'));

            element = window.htmlToElement ? window.htmlToElement(html) : (() => {
                const div = document.createElement('div');
                div.innerHTML = html.trim();
                return div.firstElementChild;
            })();

            console.log('⚙️ 转换后元素:', element.tagName, element.className);
            console.log('⚙️ 转换后innerHTML长度:', element.innerHTML?.length || 0);
            console.log('🔍 转换后包含comment-section?', element.innerHTML?.includes('comment-section'));
            console.log('🔍 转换后包含comment-list?', element.innerHTML?.includes('comment-list'));
        } else if (html && typeof html === 'object') {
            // ✅ 只要是对象就接受
            element = html;
        } else {
            console.error('❌ createMessageCard 返回了不支持的类型:', typeof html);
            return false;
        }

        if (!element) {
            console.error('❌ 无法创建DOM元素');
            return false;
        }

        // ✅ 关键修复：提取真正的 .message-item（去掉包装层）
        console.log('🔍 原始元素:', element.tagName, element.className);
        console.log('🔍 classList:', element.classList);
        console.log('🔍 是否包含 message-anim-wrapper:', element.classList?.contains('message-anim-wrapper'));

        let actualCard = element;
        if (element.classList && element.classList.contains('message-anim-wrapper')) {
            console.log('🔄 检测到包装层，提取内部 .message-item');
            actualCard = element.querySelector('.message-item');
            console.log('🔄 提取结果:', actualCard);

            // 验证子元素
            if (actualCard) {
                const commentSection = actualCard.querySelector('.comment-section');
                const commentList = actualCard.querySelector('.comment-list');
                console.log('🔍 提取后验证 - .comment-section:', !!commentSection);
                console.log('🔍 提取后验证 - .comment-list:', !!commentList);
            }
        } else {
            console.log('✅ 不是包装层，直接使用');

            // 直接使用的也验证一下
            const commentSection = element.querySelector('.comment-section');
            const commentList = element.querySelector('.comment-list');
            console.log('🔍 直接使用验证 - .comment-section:', !!commentSection);
            console.log('🔍 直接使用验证 - .comment-list:', !!commentList);
        }

        if (!actualCard) {
            console.error('❌ 无法找到 .message-item');
            return false;
        }

        // 使用提取出的卡片
        element = actualCard;

        // 🚨 关键修复：强制补全 data-message-id（双保险）
        const safeId = message.id || messageId;
        if (safeId && element) {
            element.setAttribute('data-message-id', safeId);
            element.id = 'msg-' + safeId;
            console.log('🔧 [强制修复] 已补全 data-message-id:', safeId);
        }

        // 标记（移除highlight效果，因为评论已经有高亮）
        if (element.classList) {
            element.classList.add('fetched-history');
            // element.classList.add('highlight-flash');  // ✅ 移除紫色光晕
        }

        // ✅ 防止重复插入：检查该留言卡片是否已存在
        const existingCard = document.getElementById('msg-' + safeId);
        if (existingCard) {
            console.log('⚠️ 卡片已存在，跳过插入，直接使用现有卡片');
            // 添加高亮效果
            existingCard.classList.remove('highlight-flash');
            void existingCard.offsetWidth;
            existingCard.classList.add('highlight-flash');
            return true; // 返回成功，使用现有卡片
        }

        // 插入到容器 - 优先使用已知存在的容器
        console.log('🔍 开始查找容器...');
        const grid = document.querySelector('.message-container')  // 优先：主容器
            || document.querySelector('#messageContainer')          // 其次：ID选择器
            || document.querySelector('.masonry-column')            // 第三：列容器
            || document.querySelector('.grid');                     // 最后：通用网格

        console.log('📦 找到的容器:', grid);

        if (grid) {
            // 如果容器有子容器（列），插入到第一列
            const firstColumn = grid.querySelector('.masonry-column');
            const targetContainer = firstColumn || grid;

            console.log('🎯 目标容器:', targetContainer);
            console.log('🔧 插入前验证 - 元素class:', element.className);
            console.log('🔧 插入前验证 - data-message-id:', element.dataset.messageId || element.getAttribute('data-message-id'));

            // 1. 先设置为不可见（防止闪烁）
            element.style.opacity = '0';

            // 2. 插入DOM
            targetContainer.insertBefore(element, targetContainer.firstChild);

            // 3. 🚨 立即通知 Masonry
            if (typeof window.masonry !== 'undefined' && window.masonry.prepended) {
                console.log('📐 通知 Masonry 接收新卡片...');
                window.masonry.prepended(element);
                window.masonry.layout();
                console.log('✅ Masonry 布局完成');
            } else {
                element.style.opacity = '1';
            }

            // 4. 延迟验证元素是否存活
            setTimeout(() => {
                if (document.body.contains(element)) {
                    console.log('✨ 卡片存活确认，ID:', element.id);
                    element.style.opacity = '1';
                    element.classList.add('visible');
                } else {
                    console.error('💀 卡片被删除了！');
                }
            }, 200);

            // 绑定事件处理器
            if (typeof window.attachCommentHandlers === 'function') {
                window.attachCommentHandlers();
            }

            console.log('✅ 留言已插入到网格');
            return true;
        }

        console.error('❌ 无法找到网格容器');
        console.error('📍 当前页面URL:', window.location.href);
        console.error('📍 messageContainer存在?', !!document.querySelector('#messageContainer'));
        console.error('📍 .message-container存在?', !!document.querySelector('.message-container'));
        return false;
    } catch (err) {
        console.error('❌ 拉取单条留言失败:', err);
        console.error('错误堆栈:', err.stack);
        return false;
    }
}

/**
 * 🚀 智能滚动到指定元素并高亮（v6.0 Ultimate - Observer Pattern）
 * @param {string} targetId - 目标元素 ID
 * @param {string} type - 类型：'message' 或 'comment'
 * @param {string} parentMessageId - 评论的父留言 ID（可选）
 */
window.handleSmartScroll = async function (targetId, type = 'message', parentMessageId = null) {
    if (!targetId) return;

    // 特殊处理：滚动到顶部
    if (targetId === 'TOP') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    console.log(`🚀 [SmartScroll v6.0] 目标: ${type} #${targetId} (父ID: ${parentMessageId})`);

    // ⚡ UX IMPROVEMENT: Immediate feedback
    if (window.showToast) showToast('定位中... 🧭', 'info');

    // --- 1. 确定选择器 ---
    const selector = type === 'message'
        ? `.message-item[data-message-id="${targetId}"]`
        : `[data-comment-id="${targetId}"]`;

    console.log('🔍 查找选择器:', selector);

    // --- 2. 尝试直接寻找目标 ---
    let targetElement = document.querySelector(selector);
    console.log('🔎 直接查找结果:', targetElement ? '✅ 找到' : '❌ 未找到');

    // --- 3. 如果找不到，可能父留言都不在（漏网之鱼）---
    if (!targetElement && type === 'comment' && parentMessageId) {
        const parentSelector = `.message-item[data-message-id="${parentMessageId}"]`;
        const parentCard = document.querySelector(parentSelector);

        if (!parentCard) {
            console.log('🎣 父留言不在当前视图，启动局部打捞...');
            // ⚡ FIX: Pass targetId and type to ensure comment like count is updated
            const success = await fetchAndInsertSingleMessage(parentMessageId, targetId, 'comment');
            if (success) {
                // 等待插入完成
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }

    // Case B: 留言本身不在 (挖坟点赞)
    if (!targetElement && type === 'message') {
        console.log('🎣 留言不在当前视图，启动局部打捞...');
        // ⚡ FIX: Pass targetId and type explicitly
        const success = await fetchAndInsertSingleMessage(targetId, targetId, 'message');
        if (success) {
            // 等待插入完成
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // --- 4. 启动"守株待兔"（MutationObserver）---
    if (!targetElement) {
        // 如果是评论，尝试自动展开父留言的评论区
        if (type === 'comment' && parentMessageId) {
            const parentSelector = `.message-item[data-message-id="${parentMessageId}"]`;
            const parentCard = document.querySelector(parentSelector);

            if (parentCard) {
                console.log('📦 找到父留言卡片');

                // 检查评论区是否折叠
                const commentList = parentCard.querySelector('.comment-list');
                const toggleBtn = parentCard.querySelector('.comment-toggle-btn');

                console.log('💡 commentList存在?', !!commentList);
                console.log('💡 toggleBtn存在?', !!toggleBtn);

                if (commentList) {
                    const isCollapsed = commentList.classList.contains('collapsed');
                    const isHidden = commentList.style.display === 'none' || commentList.style.maxHeight === '0px';
                    console.log('💡 评论区状态 - collapsed:', isCollapsed, 'hidden:', isHidden);

                    if ((isCollapsed || isHidden) && toggleBtn) {
                        console.log('📜 自动触发展开...');
                        toggleBtn.click();  // 触发完整的展开逻辑
                        // ⏳ WAIT: Wait for expansion animation (600ms)
                        await new Promise(r => setTimeout(r, 600));
                        console.log('✅ 展开动画完成');
                    } else {
                        console.log('✅ 评论区已经展开');
                    }
                } else {
                    console.warn('⚠️ 未找到 .comment-list 元素');
                }
            } else {
                console.warn('⚠️ 未找到父留言卡片');
            }
        }

        // 等待元素出现 (Keep this wait as it's for DOM rendering, not animation)
        console.log('⏳ 等待元素渲染...');
        targetElement = await waitForElement(selector, 5000);
    }

    // --- 5. 最终执行滚动与高亮 ---
    if (targetElement) {
        console.log('🎯 锁定目标，执行优雅滚动');

        // 1. ⚡ FIX: Mobile content-visibility comprehensive handling
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        let parentCard = null;
        let commentsSection = null;

        if (isMobile) {
            // 禁用目标元素的 content-visibility
            targetElement.style.contentVisibility = 'visible';
            targetElement.style.containIntrinsicSize = 'auto';

            // 如果是评论，还需要禁用父卡片和评论区的 content-visibility
            if (type === 'comment' && parentMessageId) {
                parentCard = document.querySelector(`.message-item[data-message-id="${parentMessageId}"]`);
                if (parentCard) {
                    console.log('📱 移动端评论定位：禁用父卡片和评论区的 content-visibility');
                    parentCard.style.contentVisibility = 'visible';

                    commentsSection = parentCard.querySelector('.comment-list');
                    if (commentsSection) {
                        commentsSection.style.contentVisibility = 'visible';
                    }
                }
            }

            // 强制重排，确保高度正确计算
            void targetElement.offsetHeight;
            void targetElement.getBoundingClientRect();
            if (parentCard) void parentCard.offsetHeight;
            if (commentsSection) void commentsSection.offsetHeight;
        }

        // 2. 等待渲染稳定
        await new Promise(r => setTimeout(r, 100));
        await new Promise(resolve => requestAnimationFrame(resolve));

        // 3. ✅ 新逻辑：如果是评论，先滚动到父卡片位置
        if (type === 'comment' && parentMessageId) {
            const parentCardForScroll = document.querySelector(`.message-item[data-message-id="${parentMessageId}"]`);
            if (parentCardForScroll) {
                console.log('📜 Step 1: 先滚动到父卡片');
                await smoothScrollTo(parentCardForScroll, 600);
                await new Promise(r => setTimeout(r, 200));
            }
        }

        // 4. ✅ 新逻辑：展开评论区（此时用户能看到展开动画）
        if (type === 'comment') {
            const commentList = targetElement.closest('.comment-list');
            if (commentList && commentList.classList.contains('collapsed')) {
                console.log('📜 Step 2: 展开评论区');
                commentList.classList.remove('collapsed');
                const fullHeight = commentList.scrollHeight;
                commentList.style.maxHeight = fullHeight + 'px';

                // 更新按钮状态
                const messageId = targetElement.closest('.message-item')?.dataset?.messageId;
                const toggleBtn = document.querySelector(`.comment-toggle-btn[data-message-id="${messageId}"]`);
                if (toggleBtn) {
                    const icon = toggleBtn.querySelector('i');
                    const span = toggleBtn.querySelector('span');
                    if (icon) icon.className = 'fas fa-chevron-up';
                    if (span) span.textContent = '收起';
                }

                // ⏳ 等待展开动画完成（让用户看到）
                await new Promise(r => setTimeout(r, 600));
                console.log('✅ 展开动画完成');
            }
        }

        // 5. ✅ 新逻辑：滚动到目标评论并高亮
        console.log('📜 Step 3: 滚动到目标评论');
        await smoothScrollTo(targetElement, 800);
        await new Promise(r => setTimeout(r, 200));

        // 6. 最后闪烁高亮
        console.log('📜 Step 4: 高亮目标');
        targetElement.classList.remove('highlight-flash');
        void targetElement.offsetWidth;  // Force reflow
        targetElement.classList.add('highlight-flash');

        // ✅ 显示定位成功提示（移动端和桌面端通用）
        if (window.showToast) showToast('已定位', 'success');

        // ✅ 移动端：延迟清理，避免归位弹动，但必须清理类名
        if (isMobile) {
            console.log('📱 移动端：延迟清理高亮类，避免闪出效果');

            // 移动端延迟清理（动画 3.5s + 缓冲 0.5s）
            setTimeout(() => {
                targetElement.classList.remove('highlight-flash');
                targetElement.style.willChange = '';

                // 定位完成后，恢复 content-visibility 优化
                targetElement.style.contentVisibility = '';
                targetElement.style.containIntrinsicSize = '';
                if (parentCard) parentCard.style.contentVisibility = '';
                if (commentsSection) commentsSection.style.contentVisibility = '';
            }, 4000);

            return;
        }

        // ✅ 桌面端：分两步清理，避免突然移除will-change导致的布局抖动
        // 步骤1：3.5秒后动画自然结束，保持最终状态
        setTimeout(() => {
            // 先清除 will-change，让浏览器知道不再需要优化
            targetElement.style.willChange = 'auto';
        }, 3500);

        // 步骤2：给浏览器200ms缓冲期，然后再移除类名
        setTimeout(() => {
            targetElement.classList.remove('highlight-flash');
            // 清理内联样式
            targetElement.style.willChange = '';
        }, 3700);
    } else {
    }
};

/**
 * 显示Toast提示 (Redesigned to match Smart Capsule)
 */
window.showToast = function (message, type = 'info') {
    // 1. 清除旧的 Toast
    const existingToast = document.querySelector('.capsule-wrapper.toast-instance');
    if (existingToast) existingToast.remove();

    // 2. 创建新 Toast (复用 Smart Capsule 样式)
    const toast = document.createElement('div');
    toast.className = 'capsule-wrapper toast-instance'; // Add marker class

    // ⚡ CUSTOMIZATION: Green theme for success
    if (type === 'success') {
        toast.classList.add('success-theme');
    }

    // 3. 添加内容 (带动画的 emoji)
    // 注入一个简单的旋转/呼吸动画样式
    const styleId = 'toast-anim-style';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            @keyframes compass-pulse {
                0% { transform: scale(1) rotate(0deg); }
                50% { transform: scale(1.2) rotate(15deg); }
                100% { transform: scale(1) rotate(0deg); }
            }
            .toast-icon-anim {
                display: inline-block;
                animation: compass-pulse 2s infinite ease-in-out;
            }
        `;
        document.head.appendChild(style);
    }

    // 解析 emoji 和 文本 (假设 message 包含 emoji，或者我们强制加一个)
    // 用户现在的 message 是 "定位中... 🧭"
    // 我们把它拆分一下，或者直接用 innerHTML
    toast.innerHTML = `
        <span class="toast-icon-anim">🧭</span>
        <span>${message.replace('🧭', '').trim()}</span>
    `;

    // 4. 添加到页面
    document.body.appendChild(toast);

    // 5. 触发进场动画 (Slide Down)
    requestAnimationFrame(() => {
        toast.classList.add('active');
    });

    // 6. 自动消失 (3秒后)
    setTimeout(() => {
        toast.classList.remove('active'); // Slide Up
        setTimeout(() => toast.remove(), 500); // Wait for transition then remove
    }, 3000);
};

/**
 * ✅ 头像同步功能
 * 页面加载后批量查询用户最新头像并更新 DOM
 */
window.syncUserAvatars = async function () {
    console.log('🔄 开始同步用户最新头像...');

    try {
        // 1. 首先处理当前登录用户的头像（最重要）
        const currentUser = AV.User.current();
        if (currentUser) {
            const currentAvatarUrl = currentUser.get('avatarUrl');
            const currentNickname = currentUser.get('nickname') || currentUser.get('username');
            const currentUserId = currentUser.id;

            if (currentAvatarUrl) {
                let selfUpdatedCount = 0;

                // 更新自己的所有留言头像（通过 data-author-id 匹配）
                document.querySelectorAll(`.message-item[data-author-id="${currentUserId}"]`).forEach(item => {
                    const avatarImg = item.querySelector('.author-avatar');
                    if (avatarImg && avatarImg.src !== currentAvatarUrl) {
                        avatarImg.src = currentAvatarUrl;
                        selfUpdatedCount++;
                    }
                });

                // 也通过用户名匹配（备用方案，用于旧数据）
                document.querySelectorAll('.message-item').forEach(item => {
                    const authorName = item.querySelector('.author-name');
                    if (authorName && authorName.textContent === currentNickname) {
                        const avatarImg = item.querySelector('.author-avatar');
                        if (avatarImg && avatarImg.src !== currentAvatarUrl) {
                            avatarImg.src = currentAvatarUrl;
                            selfUpdatedCount++;
                        }
                    }
                });

                // 更新自己的所有评论头像
                document.querySelectorAll(`.comment-item[data-author-id="${currentUserId}"]`).forEach(item => {
                    const avatarImg = item.querySelector('.comment-avatar');
                    if (avatarImg && avatarImg.src !== currentAvatarUrl) {
                        avatarImg.src = currentAvatarUrl;
                        selfUpdatedCount++;
                    }
                });

                // 也通过评论作者名匹配
                document.querySelectorAll('.comment-item').forEach(item => {
                    const authorName = item.querySelector('.comment-author');
                    if (authorName && authorName.textContent === currentNickname) {
                        const avatarImg = item.querySelector('.comment-avatar');
                        if (avatarImg && avatarImg.src !== currentAvatarUrl) {
                            avatarImg.src = currentAvatarUrl;
                            selfUpdatedCount++;
                        }
                    }
                });

                console.log(`✅ 已更新当前用户(${currentNickname})的 ${selfUpdatedCount} 个头像`);
            }
        }

        // 2. 收集所有有 authorId 的留言/评论
        const messageItems = document.querySelectorAll('.message-item[data-author-id]');
        const commentItems = document.querySelectorAll('.comment-item[data-author-id]');

        const userIds = new Set();

        messageItems.forEach(item => {
            const authorId = item.dataset.authorId;
            if (authorId && authorId !== '' && authorId !== 'null') {
                userIds.add(authorId);
            }
        });

        commentItems.forEach(item => {
            const authorId = item.dataset.authorId;
            if (authorId && authorId !== '' && authorId !== 'null') {
                userIds.add(authorId);
            }
        });

        // 排除当前用户（已经处理过了）
        if (currentUser) {
            userIds.delete(currentUser.id);
        }

        if (userIds.size === 0) {
            console.log('ℹ️ 没有其他用户需要同步头像');
            return;
        }

        console.log(`📋 准备同步其他 ${userIds.size} 个用户的头像`);

        // 3. 批量查询其他用户最新信息
        const userQuery = new AV.Query('_User');
        userQuery.containedIn('objectId', Array.from(userIds));
        userQuery.select(['objectId', 'avatarUrl', 'username', 'nickname']);

        const users = await userQuery.find();
        console.log(`✅ 查询到 ${users.length} 个用户`);

        // 4. 构建 userId -> avatarUrl 映射
        const avatarMap = new Map();
        users.forEach(user => {
            const avatarUrl = user.get('avatarUrl');
            if (avatarUrl) {
                avatarMap.set(user.id, avatarUrl);
            }
        });

        // 5. 更新 DOM 中的头像
        let updatedCount = 0;

        messageItems.forEach(item => {
            const authorId = item.dataset.authorId;
            if (authorId && avatarMap.has(authorId)) {
                const avatarImg = item.querySelector('.author-avatar');
                if (avatarImg && avatarImg.src !== avatarMap.get(authorId)) {
                    avatarImg.src = avatarMap.get(authorId);
                    updatedCount++;
                }
            }
        });

        commentItems.forEach(item => {
            const authorId = item.dataset.authorId;
            if (authorId && avatarMap.has(authorId)) {
                const avatarImg = item.querySelector('.comment-avatar');
                if (avatarImg && avatarImg.src !== avatarMap.get(authorId)) {
                    avatarImg.src = avatarMap.get(authorId);
                    updatedCount++;
                }
            }
        });

        console.log(`✅ 头像同步完成，更新了其他用户 ${updatedCount} 个头像`);

    } catch (error) {
        console.error('❌ 头像同步失败:', error);
    }
};
