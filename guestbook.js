/* ==================== Guestbook Display Page JavaScript ==================== */

function setInlineStyles(target, styles) {
    const style = target?.style;
    if (!style || !styles) return;
    for (const [property, value] of Object.entries(styles)) {
        style[property] = value ?? '';
    }
}

function setCssVariables(target, variables) {
    const style = target?.style;
    if (!style || !variables) return;
    const setProperty = style['setProperty'].bind(style);
    const removeProperty = style['removeProperty'].bind(style);
    for (const [property, value] of Object.entries(variables)) {
        if (value === undefined || value === null || value === '') {
            removeProperty(property);
        } else {
            setProperty(property, value);
        }
    }
}

function setElementHidden(target, hidden, visibleDisplay = '') {
    if (!target) return;
    target.hidden = !!hidden;
    if (visibleDisplay || hidden) {
        setInlineStyles(target, { display: hidden ? 'none' : visibleDisplay });
    }
}

function normalizeGuestbookDisplayImageUrl(url) {
    const source = String(url || '').trim();
    if (!source || /^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) {
        return '';
    }
    if (/^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i.test(source)) {
        return '';
    }

    try {
        const parsed = new URL(source, window.location.origin);
        if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
            return '';
        }
        return window.SiteConfig?.normalizeAssetUrlForCurrentSite?.(parsed.href) || parsed.href;
    } catch (error) {
        return '';
    }
}

function requestGuestbookLoginPrompt(message, options = {}) {
    const normalizedMessage = String(
        message || window.i18n?.t?.('auth.loginRequired') || '请先登录'
    ).trim();

    if (typeof window.requestGuestbookLogin === 'function') {
        window.requestGuestbookLogin(normalizedMessage, options);
        return;
    }

    if (typeof window.openLoginModalWithMessage === 'function') {
        window.openLoginModalWithMessage(normalizedMessage, {
            viewId: 'login',
            type: 'error'
        });
        return;
    }

    if (typeof window.openLoginModal === 'function') {
        window.openLoginModal('login', {
            initialMessage: normalizedMessage,
            initialMessageType: 'error'
        });
        return;
    }

    if (document.getElementById('loginModal') && typeof window.toggleLoginModal === 'function') {
        window.toggleLoginModal('login');
        return;
    }

    alert(normalizedMessage);
}

let guestbookDeepLinkHandled = false;
let guestbookDeepLinkRetryTimer = null;
let guestbookPendingDeepLinkTarget = null;
let guestbookDeepLinkInFlight = false;
let guestbookDeepLinkAttemptCount = 0;
const GUESTBOOK_DEEP_LINK_MAX_ATTEMPTS = 6;

function getGuestbookDeepLinkTarget() {
    const params = new URLSearchParams(window.location.search || '');
    const messageId = String(params.get('messageId') || '').trim();
    const commentId = String(params.get('commentId') || '').trim();

    if (!messageId) {
        return null;
    }

    return {
        messageId,
        commentId
    };
}

function normalizeGuestbookDeepLinkTarget(target = null) {
    if (!target || typeof target !== 'object') {
        return null;
    }

    const messageId = String(target.messageId || target.message_id || '').trim();
    const commentId = String(target.commentId || target.comment_id || '').trim();
    if (!messageId) {
        return null;
    }

    return {
        messageId,
        commentId
    };
}

function rememberGuestbookDeepLinkTarget(target = null) {
    const normalizedTarget = normalizeGuestbookDeepLinkTarget(target);
    if (normalizedTarget) {
        const changed = !guestbookPendingDeepLinkTarget
            || guestbookPendingDeepLinkTarget.messageId !== normalizedTarget.messageId
            || guestbookPendingDeepLinkTarget.commentId !== normalizedTarget.commentId;
        guestbookPendingDeepLinkTarget = normalizedTarget;
        if (changed) {
            guestbookDeepLinkAttemptCount = 0;
        }
    }
    return guestbookPendingDeepLinkTarget;
}

function clearGuestbookDeepLinkRetryTimer() {
    if (guestbookDeepLinkRetryTimer) {
        clearTimeout(guestbookDeepLinkRetryTimer);
        guestbookDeepLinkRetryTimer = null;
    }
}

function scheduleGuestbookDeepLinkRetry(delayMs = 180, options = {}) {
    clearGuestbookDeepLinkRetryTimer();
    guestbookDeepLinkRetryTimer = setTimeout(() => {
        guestbookDeepLinkRetryTimer = null;
        void maybeHandleGuestbookDeepLink(options);
    }, Math.max(40, Number(delayMs) || 180));
}

async function maybeHandleGuestbookDeepLink(options = {}) {
    const deepLink = rememberGuestbookDeepLinkTarget(getGuestbookDeepLinkTarget());
    if (!deepLink || guestbookDeepLinkHandled || guestbookDeepLinkInFlight) {
        return false;
    }

    if (typeof window.handleSmartScroll !== 'function') {
        scheduleGuestbookDeepLinkRetry(120, options);
        return false;
    }

    guestbookDeepLinkInFlight = true;
    guestbookDeepLinkAttemptCount += 1;
    clearGuestbookDeepLinkRetryTimer();
    const startDelayMs = options.force === true ? 80 : 320;

    try {
        await new Promise((resolve) => setTimeout(resolve, startDelayMs));
        const focused = deepLink.commentId
            ? await Promise.resolve(window.handleSmartScroll(deepLink.commentId, 'comment', deepLink.messageId))
            : await Promise.resolve(window.handleSmartScroll(deepLink.messageId, 'message'));
        if (focused !== false) {
            guestbookDeepLinkHandled = true;
            guestbookPendingDeepLinkTarget = null;
            guestbookDeepLinkAttemptCount = 0;
            return true;
        }
    } finally {
        guestbookDeepLinkInFlight = false;
    }

    if (!guestbookDeepLinkHandled && guestbookDeepLinkAttemptCount < GUESTBOOK_DEEP_LINK_MAX_ATTEMPTS) {
        scheduleGuestbookDeepLinkRetry(options.force === true ? 480 : 720, {
            ...options,
            force: true
        });
    }
    return false;
}

window.maybeHandleGuestbookDeepLink = maybeHandleGuestbookDeepLink;

function triggerGuestbookDeepLinkReplay(options = {}) {
    if (guestbookDeepLinkHandled) return;
    rememberGuestbookDeepLinkTarget(getGuestbookDeepLinkTarget());
    void maybeHandleGuestbookDeepLink({
        ...options,
        force: true
    });
}

function primeGuestbookDeepLinkHandling() {
    rememberGuestbookDeepLinkTarget(getGuestbookDeepLinkTarget());
    void maybeHandleGuestbookDeepLink();
}

function finalizeGuestbookDeepLinkHandling() {
    triggerGuestbookDeepLinkReplay({ reason: 'guestbook_messages_ready' });
}

function applyGuestbookImageReadyState(image) {
    if (!(image instanceof HTMLImageElement)) return;

    const wrapper = image.closest('.message-image');
    if (!wrapper) return;

    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setCssVariables(wrapper, {
            '--guestbook-image-ratio': `${image.naturalWidth} / ${image.naturalHeight}`
        });
    }

    wrapper.classList.add('is-loaded');
    image.classList.add('is-loaded');
}

function stabilizeGuestbookMessageImages(scope = document) {
    const images = scope?.querySelectorAll
        ? scope.querySelectorAll('.message-image img[data-guestbook-open-image="1"]')
        : [];

    images.forEach((image) => {
        if (!(image instanceof HTMLImageElement)) return;

        const wrapper = image.closest('.message-image');
        if (wrapper) {
            wrapper.classList.remove('is-loaded');
        }
        image.classList.remove('is-loaded');

        const markReady = () => {
            if (!image.naturalWidth || !image.naturalHeight) return;
            applyGuestbookImageReadyState(image);
        };

        const waitForDecode = () => {
            if (typeof image.decode === 'function') {
                image.decode().then(markReady).catch(markReady);
                return;
            }
            markReady();
        };

        if (image.dataset.guestbookImageBound === '1') {
            if (image.complete) {
                waitForDecode();
            }
            return;
        }

        image.dataset.guestbookImageBound = '1';

        image.addEventListener('load', waitForDecode);
        image.addEventListener('error', () => {
            wrapper?.classList.remove('is-loaded');
            image.classList.remove('is-loaded');
        });

        if (image.complete) {
            waitForDecode();
        }
    });
}

function initGuestbookPage() {
    const messageContainer = document.getElementById('messageContainer');
    const floatingBackBtn = document.querySelector('.floating-back-btn');
    const emptyState = document.getElementById('emptyState');
    const commentForm = document.getElementById('commentForm');
    const commentInput = document.getElementById('commentContent');
    const commentEditor = document.getElementById('commentComposerEditor');
    const commentCancelBtn = document.getElementById('commentComposerCancelBtn');
    const commentModal = document.getElementById('commentModal');

    // CRITICAL FIX: Clean up any modal state on page load
    document.body.classList.remove('modal-active');
    const allModals = document.querySelectorAll('.modal-overlay');
    allModals.forEach(modal => {
        modal.classList.remove('active', 'overlay-visible');
        modal.classList.add('overlay-hidden');
        setInlineStyles(modal, {
            backdropFilter: 'none',
            webkitBackdropFilter: 'none'
        });
    });
    console.log('✅ Modal state cleaned up on page load');

    if (floatingBackBtn) {
        floatingBackBtn.addEventListener('click', (event) => {
            event.preventDefault();
            const targetUrl = floatingBackBtn.getAttribute('href');
            const mainContainer = document.querySelector('.guestbook-main');

            if (mainContainer) {
                mainContainer.classList.add('page-exit');
            }

            setTimeout(() => {
                if (targetUrl) {
                    window.location.href = targetUrl;
                }
            }, 300);
        });
    }

    if (!window.__guestbookMediaErrorHandlerBound) {
        document.addEventListener('error', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLImageElement)) return;

            const avatarFallback = target.dataset.avatarFallback;
            if (avatarFallback) {
                if (target.dataset.avatarFallbackApplied === '1') return;
                target.dataset.avatarFallbackApplied = '1';
                target.src = avatarFallback;
                return;
            }

            if (target.dataset.hideOnError === '1') {
                setElementHidden(target, true);
                setElementHidden(target.parentElement, true);
            }
        }, true);

        window.__guestbookMediaErrorHandlerBound = true;
    }

    // 🔧 FIX: Declare these variables early to avoid ReferenceError
    let commentHandlersAttached = false;
    let mobileHighlightActive = false;
    let currentHighlightedItem = null;

    // Load messages from Supabase
    console.log('📋 加载 Supabase 留言...');

    // Show loading state
    if (messageContainer) {
        messageContainer.innerHTML = `<div class="guestbook-loading-state">${window.i18n?.t('common.loading') || '加载中...'}</div>`;
    }

    const SUPABASE_BOOT_TIMEOUT_MS = 4500;
    const supabaseWaitStartedAt = Date.now();
    let bootErrorRendered = false;

    function buildSupabaseBootErrorMessage() {
        const initState = window.__ZAOYOE_SUPABASE_CLIENT_STATE__ || null;
        const runtimeConfig = typeof window.getZaoyoeSupabaseConfig === 'function'
            ? window.getZaoyoeSupabaseConfig()
            : null;
        const isStaticPreview = window.location.protocol === 'file:';

        if (initState?.reason === 'runtime_config_missing' || initState?.reason === 'runtime_config_unavailable') {
            if (isStaticPreview) {
                return '当前是静态预览模式，缺少 Supabase 运行时配置，请改用 npm run preview:local 打开留言页。';
            }
            return '缺少 Supabase 运行时配置，请通过 npm run preview:local 或已部署环境打开此页。';
        }

        if (initState?.reason === 'sdk_missing') {
            return 'Supabase SDK 加载失败，请检查网络或 CDN 是否可访问。';
        }

        if (window.supabaseClient && typeof loadGuestbookMessages !== 'function') {
            return '留言脚本未完成初始化，请刷新后重试。';
        }

        if (!runtimeConfig) {
            return '缺少 Supabase 运行时配置，请通过 npm run preview:local 或已部署环境打开此页。';
        }

        if (initState?.message) {
            return `留言初始化失败：${initState.message}`;
        }

        return '留言初始化超时，请刷新后重试。';
    }

    function renderGuestbookBootError(message) {
        if (bootErrorRendered || !messageContainer) return;
        bootErrorRendered = true;

        const skeletonContainer = document.getElementById('skeletonContainer');
        if (skeletonContainer) {
            skeletonContainer.classList.add('hidden');
        }

        setElementHidden(emptyState, true);
        messageContainer.innerHTML = `<p class="guestbook-message-error">${escapeHtml(message)}</p>`;
        messageContainer.classList.add('guestbook-message-container-ready');
    }

    // Wait for Supabase to be ready, then load messages
    function waitForSupabase() {
        if (typeof window.supabaseClient !== 'undefined' && typeof loadGuestbookMessages === 'function') {
            console.log('✅ Supabase 已就绪，加载留言');
            primeGuestbookDeepLinkHandling();
            void Promise.resolve(loadGuestbookMessages())
                .finally(() => {
                    finalizeGuestbookDeepLinkHandling();
                });

            console.log('🔌 首屏渲染后再启用 Supabase Realtime...');
            scheduleRealtimeSetup();
        } else {
            const initState = window.__ZAOYOE_SUPABASE_CLIENT_STATE__ || null;
            const waitTimedOut = (Date.now() - supabaseWaitStartedAt) >= SUPABASE_BOOT_TIMEOUT_MS;
            const hasFatalInitError = initState?.status === 'error';

            if (hasFatalInitError || waitTimedOut) {
                console.error('❌ Guestbook boot failed before Supabase became ready:', initState || 'timeout');
                renderGuestbookBootError(buildSupabaseBootErrorMessage());
                return;
            }

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
    let realtimeSetupTimer = null;

    function scheduleRealtimeSetup(delay = 2500) {
        if (realtimeSetupTimer || window.__guestbookRealtimeEnabled) return;

        if (typeof enableRealTimeUpdates !== 'function') {
            console.warn('⚠️ enableRealTimeUpdates 函数未找到');
            return;
        }

        realtimeSetupTimer = setTimeout(() => {
            realtimeSetupTimer = null;
            enableRealTimeUpdates();
        }, delay);
    }

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
                messageContainer.classList.add('message-container--single-column');
                messageContainer.classList.remove('message-container--masonry');
                masonryColumns.push(messageContainer);
            } else {
                // Desktop: Use flex columns
                console.log('💻 [Masonry] Creating', newCols, 'flex columns');
                messageContainer.classList.add('message-container--masonry');
                messageContainer.classList.remove('message-container--single-column');

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
    window.htmlToElement = htmlToElement;

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

        // Hide skeleton loading
        const skeletonContainer = document.getElementById('skeletonContainer');
        if (skeletonContainer) {
            skeletonContainer.classList.add('hidden');
        }

        // Fade in container
        messageContainer.classList.add('guestbook-message-container-ready');

        if (messages.length === 0) {
            setElementHidden(emptyState, false, 'flex');
            messageContainer.innerHTML = ''; // Clear any columns
            return;
        }

        setElementHidden(emptyState, true);

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
            setElementHidden(loadingIndicator, true);
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

                // Apply the stagger delay before the element is inserted so the first paint matches the animation timing.
                const delay = Math.min(index * 0.1, 1.0); // 100ms stagger, capped at 1s
                setCssVariables(element, { '--guestbook-stagger-delay': `${delay}s` });

                // Find shortest column and append
                const targetCol = getShortestColumn();
                targetCol.appendChild(element);
                stabilizeGuestbookMessageImages(element);

                // Trigger animation with delay
                // ⚡ CRITICAL FIX: Always use staggered animation for "cascading" effect
                // This restores the "obvious" animation user requested

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
                    stabilizeGuestbookMessageImages(element);

                    // ⚡ VISUALS FIRST: Enable staggered animation on resize
                    // Using slightly faster stagger (50ms) for resize to feel responsive but fluid
                const delay = Math.min(index * 0.05, 1.0);
                setCssVariables(element, { '--guestbook-stagger-delay': `${delay}s` });
                setTimeout(() => {
                    element.classList.add('visible');
                }, delay * 1000);
                });

                renderedCount = currentCount;
                attachCommentHandlers();
                syncMobileHighlightMode();
            }
        }, 200);
    });

    function setupInfiniteScroll() {
        // 1. Create Sentinel (Invisible Trigger)
        let sentinel = document.getElementById('scrollSentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'scrollSentinel';
            sentinel.className = 'guestbook-scroll-sentinel';
            messageContainer.parentElement.appendChild(sentinel);
        }

        // 2. Create Loading Spinner (Visible Indicator)
        let loadingIndicator = document.getElementById('loadingIndicator');
        if (!loadingIndicator) {
            loadingIndicator = document.createElement('div');
            loadingIndicator.id = 'loadingIndicator';
            loadingIndicator.className = 'guestbook-loading-indicator';
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
                        loadingIndicator.classList.add('is-visible');
                        setElementHidden(loadingIndicator, false);
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
                loadingIndicator.classList.remove('is-visible');
                setElementHidden(loadingIndicator, false);
            } else {
                // All loaded
                setElementHidden(loadingIndicator, true);
                setElementHidden(sentinel, true); // Disable sentinel
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
        const shouldCollapse = commentCount > 2 && !msg.forceExpanded;

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
                    <div class="comment-item ${depth > 0 ? 'comment-item--nested' : ''} comment-item--depth-${Math.min(depth, maxDepth)} ${canReply ? 'comment-item--clickable' : ''}"
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
                                <button class="comment-like-btn ${comment.isLiked ? 'active' : ''}" type="button"
                                        data-comment-id="${comment.id}">
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
                <span data-i18n="guestbook.expand">展开</span>
                <i class="fas fa-chevron-down"></i>
               </button>`
            : '';

        // 🔍 DEBUG: Check if image string is "null" or "undefined"
        const normalizedMessageImage = normalizeGuestbookDisplayImageUrl(msg.image);
        const hasValidImage = Boolean(normalizedMessageImage);
        if (msg.image && !hasValidImage) {
            console.warn(`⚠️ Invalid image URL detected for message ${msg.id}:`, msg.image);
        }

        const imageHtml = hasValidImage
            ? `<div class="message-image">
            <img src="${escapeHtml(normalizedMessageImage)}" alt="用户上传图片" loading="lazy" decoding="async" data-guestbook-open-image="1" data-hide-on-error="1">
           </div>`
            : '';
        const normalizedAvatarUrl = normalizeGuestbookDisplayImageUrl(msg.avatarUrl);

        const commentSectionHtml = hasComments
            ? `
                    <div class="comment-section">
                        <div class="comment-list ${shouldCollapse ? 'collapsed' : ''}" data-message-id="${msg.id}">
                            ${commentsHtml}
                        </div>
                        ${toggleButtonHtml}
                    </div>
              `
            : '';

        const messageHtml = `
            <div class="message-anim-wrapper">
                <div class="message-item" data-message-id="${msg.id}" data-author-id="${msg.authorId || ''}">
                    
                    <!-- 1. Header (Author Info & Time) -->
                    <div class="message-header">
                        <div class="author-info">
                            ${normalizedAvatarUrl
                ? `<img src="${escapeHtml(normalizedAvatarUrl)}" alt="${escapeHtml(msg.name)}" class="author-avatar" loading="lazy" decoding="async" data-avatar-fallback="https://ui-avatars.com/api/?name=${encodeURIComponent(msg.name)}&background=random" data-avatar-fallback-applied="0">`
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
                        <button class="action-btn like-btn ${msg.isLiked ? 'active' : ''}" type="button"
                                data-message-id="${msg.id}" data-message-action="like">
                            <i class="${msg.isLiked ? 'fas' : 'far'} fa-heart"></i>
                            <span class="like-count">${msg.likes || 0}</span>
                        </button>
                        
                        <button class="action-btn comment-btn" type="button"
                                data-message-id="${msg.id}" data-message-action="comment">
                            <i class="far fa-comment"></i>
                            <span>${commentCount || 0}</span>
                        </button>
                    </div>
                    
                    
                    <!-- 5. Comment Section -->
                    ${commentSectionHtml}
                </div>
            </div>
        `;
        return messageHtml;
    }

    // ✅ 暴露到全局作用域，供其他文件使用
    window.createMessageCard = createMessageCard;

    window.insertMessageToDOM = function (msg, options = {}) {
        if (!messageContainer || !msg) return null;

        const { position = 'prepend', markFetchedHistory = false } = options;

        if (masonryColumns.length === 0) {
            currentColumnCount = 0;
            initMasonry();
        }

        const html = createMessageCard(msg, 0);
        const element = htmlToElement(html);
        if (!element) return null;

        const card = element.querySelector('.message-item');
        const messageId = msg.id || msg.objectId || '';

        if (card && messageId) {
            card.id = `msg-${messageId}`;
            card.setAttribute('data-message-id', messageId);

            if (markFetchedHistory) {
                card.classList.add('fetched-history');
            }
        }

        let targetContainer = messageContainer;
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (!isMobile && masonryColumns.length > 0) {
            targetContainer = position === 'prepend'
                ? masonryColumns[0]
                : getShortestColumn();
        }

        if (position === 'prepend' && targetContainer.firstChild) {
            targetContainer.insertBefore(element, targetContainer.firstChild);
        } else {
            targetContainer.appendChild(element);
        }

        stabilizeGuestbookMessageImages(element);

        if (messageId && !allMessages.some(existing => existing.id === messageId)) {
            if (position === 'prepend') {
                allMessages.unshift(msg);
            } else {
                allMessages.push(msg);
            }
            renderedCount += 1;
        }

        attachCommentHandlers();

        requestAnimationFrame(() => {
            element.classList.add('visible');
        });

        return card || element;
    };

    function getMessageIdentity(messageOrId) {
        if (!messageOrId) return null;
        if (typeof messageOrId === 'string') return messageOrId;
        return messageOrId.id || messageOrId.objectId || null;
    }

    function findMessageState(messageId) {
        const normalizedMessageId = getMessageIdentity(messageId);
        return allMessages.find(msg => getMessageIdentity(msg) === normalizedMessageId) || null;
    }

    function findCommentState(comments, commentId) {
        if (!Array.isArray(comments) || !commentId) return null;

        for (const comment of comments) {
            if (!comment) continue;

            if (getMessageIdentity(comment) === commentId) {
                return comment;
            }

            const nestedMatch = findCommentState(comment.replies, commentId);
            if (nestedMatch) return nestedMatch;
        }

        return null;
    }

    function normalizeInsertedComment(comment, fallback = {}) {
        const normalizedId = getMessageIdentity(comment);
        const userId = comment?.userId || comment?.authorId || comment?.user_id || fallback.userId || fallback.authorId || '';
        const createdAt = comment?.createdAt || comment?.created_at || fallback.createdAt || null;
        const replies = Array.isArray(comment?.replies)
            ? comment.replies.map(reply => normalizeInsertedComment(reply))
            : [];

        return {
            ...comment,
            id: normalizedId,
            objectId: normalizedId,
            content: comment?.content || '',
            name: comment?.name || comment?.username || fallback.name || 'Anonymous',
            username: comment?.username || comment?.name || fallback.username || fallback.name || 'Anonymous',
            avatarUrl: comment?.avatarUrl || comment?.avatar_url || fallback.avatarUrl || null,
            userId,
            authorId: userId,
            parentId: comment?.parentId || comment?.parentCommentId || comment?.parent_id || fallback.parentId || null,
            parentCommentId: comment?.parentCommentId || comment?.parentId || comment?.parent_id || fallback.parentId || null,
            parentUserName: comment?.parentUserName || comment?.parent_user_name || fallback.parentUserName || null,
            likes: typeof comment?.likes === 'number' ? comment.likes : (comment?.like_count || 0),
            isLiked: Boolean(comment?.isLiked),
            createdAt,
            timestamp: comment?.timestamp
                || (typeof formatTime === 'function' && createdAt ? formatTime(createdAt) : '刚刚'),
            replies
        };
    }

    function flashInsertedComment(commentId, autoScroll = true) {
        if (!commentId) return;

        const targetComment = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
        if (!targetComment) return;

        targetComment.classList.remove('highlight-flash');
        void targetComment.offsetWidth;
        targetComment.classList.add('highlight-flash');

        if (autoScroll) {
            setTimeout(() => {
                targetComment.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 80);
        }

        setTimeout(() => {
            targetComment.classList.remove('highlight-flash');
        }, 3200);
    }

    function rerenderMessageCard(messageId) {
        const normalizedMessageId = getMessageIdentity(messageId);
        if (!normalizedMessageId) return null;

        const messageState = findMessageState(normalizedMessageId);
        if (!messageState) {
            console.warn('⚠️ Message state not found for rerender:', normalizedMessageId);
            return null;
        }

        const currentCard = document.querySelector(`.message-item[data-message-id="${normalizedMessageId}"]`);
        if (!currentCard) return null;

        const currentWrapper = currentCard.closest('.message-anim-wrapper') || currentCard;
        const replacementElement = htmlToElement(createMessageCard(messageState, 0));
        if (!replacementElement) return null;

        const replacementCard = replacementElement.querySelector('.message-item');
        if (!replacementCard) return null;

        replacementCard.id = `msg-${normalizedMessageId}`;
        replacementCard.setAttribute('data-message-id', normalizedMessageId);

        if (currentCard.classList.contains('fetched-history')) {
            replacementCard.classList.add('fetched-history');
        }

        if (currentCard.classList.contains('expanded')) {
            replacementCard.classList.add('expanded');
        }

        if (currentWrapper.classList.contains('visible')) {
            replacementElement.classList.add('visible');
        }

        currentWrapper.replaceWith(replacementElement);
        stabilizeGuestbookMessageImages(replacementElement);
        attachCommentHandlers();

        return replacementCard;
    }

    window.upsertGuestbookMessageDOM = function (message, options = {}) {
        const normalizedMessageId = getMessageIdentity(message);
        if (!normalizedMessageId || !message) return null;

        const existingState = findMessageState(normalizedMessageId);
        const nextMessage = {
            ...message,
            id: message.id || message.objectId || normalizedMessageId,
            objectId: message.objectId || message.id || normalizedMessageId,
            forceExpanded: options.forceExpanded === true
                ? true
                : Boolean(message.forceExpanded || existingState?.forceExpanded)
        };

        if (existingState) {
            Object.keys(existingState).forEach((key) => {
                delete existingState[key];
            });
            Object.assign(existingState, nextMessage);
            return rerenderMessageCard(normalizedMessageId);
        }

        const currentCard = document.querySelector(`.message-item[data-message-id="${normalizedMessageId}"]`);
        if (currentCard) {
            allMessages.unshift(nextMessage);
            const currentWrapper = currentCard.closest('.message-anim-wrapper') || currentCard;
            const replacementElement = htmlToElement(createMessageCard(nextMessage, 0));
            const replacementCard = replacementElement?.querySelector?.('.message-item') || null;
            if (!replacementElement || !replacementCard) return null;
            replacementCard.id = `msg-${normalizedMessageId}`;
            replacementCard.setAttribute('data-message-id', normalizedMessageId);
            if (currentCard.classList.contains('fetched-history')) {
                replacementCard.classList.add('fetched-history');
            }
            if (currentWrapper.classList.contains('visible')) {
                replacementElement.classList.add('visible');
            }
            currentWrapper.replaceWith(replacementElement);
            stabilizeGuestbookMessageImages(replacementElement);
            attachCommentHandlers();
            return replacementCard;
        }

        return window.insertMessageToDOM(nextMessage, {
            position: options.position || 'prepend',
            markFetchedHistory: options.markFetchedHistory !== false
        });
    };

    window.renderGuestbookCommentInsert = function (messageId, comment, options = {}) {
        const normalizedMessageId = getMessageIdentity(messageId);
        if (!normalizedMessageId || !comment) return false;

        const messageState = findMessageState(normalizedMessageId);
        if (!messageState) {
            console.warn('⚠️ Unable to locate message state for comment insert:', normalizedMessageId);
            return false;
        }

        if (!Array.isArray(messageState.comments)) {
            messageState.comments = [];
        }

        const normalizedComment = normalizeInsertedComment(comment);
        if (!normalizedComment.id) {
            console.warn('⚠️ Skipping comment insert without id');
            return false;
        }

        if (!findCommentState(messageState.comments, normalizedComment.id)) {
            messageState.comments.push(normalizedComment);
        }

        messageState.forceExpanded = true;
        rerenderMessageCard(normalizedMessageId);
        flashInsertedComment(normalizedComment.id, options.autoScroll !== false);
        return true;
    };

    window.renderGuestbookReplyInsert = function (messageId, parentCommentId, reply, options = {}) {
        const normalizedMessageId = getMessageIdentity(messageId);
        const normalizedParentId = getMessageIdentity(parentCommentId);
        if (!normalizedMessageId || !normalizedParentId || !reply) return false;

        const messageState = findMessageState(normalizedMessageId);
        if (!messageState) {
            console.warn('⚠️ Unable to locate message state for reply insert:', normalizedMessageId);
            return false;
        }

        if (!Array.isArray(messageState.comments)) {
            messageState.comments = [];
        }

        const normalizedReply = normalizeInsertedComment(reply, { parentId: normalizedParentId });
        if (!normalizedReply.id) {
            console.warn('⚠️ Skipping reply insert without id');
            return false;
        }

        if (findCommentState(messageState.comments, normalizedReply.id)) {
            flashInsertedComment(normalizedReply.id, options.autoScroll !== false);
            return true;
        }

        const parentComment = findCommentState(messageState.comments, normalizedParentId);
        if (!parentComment) {
            console.warn('⚠️ Parent comment not found in state, falling back to top-level insert:', normalizedParentId);
            return window.renderGuestbookCommentInsert(normalizedMessageId, normalizedReply, options);
        }

        if (!Array.isArray(parentComment.replies)) {
            parentComment.replies = [];
        }

        if (!normalizedReply.parentUserName) {
            normalizedReply.parentUserName = parentComment.name || null;
        }

        parentComment.replies.push(normalizedReply);
        messageState.forceExpanded = true;
        rerenderMessageCard(normalizedMessageId);
        flashInsertedComment(normalizedReply.id, options.autoScroll !== false);
        return true;
    };


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
                setInlineStyles(commentList, { overflow: 'hidden' });

                // ⚡ FIX: Raise z-index of expanded card
                if (messageItem) messageItem.classList.add('expanded');

                setInlineStyles(commentList, { maxHeight: '160px' });
                void commentList.offsetHeight;
                commentList.classList.remove('collapsed');
                const fullHeight = commentList.scrollHeight;

                // ⚡ PERF: Adaptive animation speed based on content height
                // Formula: Height / 1500 (seconds), clamped between 0.4s and 0.8s
                const duration = Math.min(Math.max(fullHeight / 1500, 0.4), 0.8);

                // Apply dynamic duration to both content and card container
                setInlineStyles(commentList, { transitionDuration: `${duration}s` });
                setInlineStyles(messageItem, { transitionDuration: `${duration}s` });

                // ⚡ FIX: Add 50px buffer to prevent snap at end of animation
                setInlineStyles(commentList, { maxHeight: `${fullHeight + 50}px` });
                icon.className = 'fas fa-chevron-up';
                span.textContent = window.i18n?.t('guestbook.collapse', '收起');
                span.setAttribute('data-i18n', 'guestbook.collapse');

                // Timeout = duration + 0.2s buffer
                setTimeout(() => {
                    if (!commentList.classList.contains('collapsed')) {
                        setInlineStyles(commentList, { maxHeight: 'none' });
                        // ⚡ FIX: Restore visible overflow for glow effects after animation
                        setInlineStyles(commentList, { overflow: 'visible' });

                        // Resetting animated durations is optional here; current timing is harmless if left intact.
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
                setInlineStyles(commentList, { overflow: 'hidden' });

                // ⚡ FIX: Reset z-index when collapsed
                if (messageItem) messageItem.classList.remove('expanded');

                const currentHeight = commentList.scrollHeight;

                // ⚡ PERF: Adaptive animation speed based on content height
                // Formula: Height / 1500 (seconds), clamped between 0.4s and 0.8s
                const duration = Math.min(Math.max(currentHeight / 1500, 0.4), 0.8);

                // Apply dynamic duration to both content and card container
                setInlineStyles(commentList, { transitionDuration: `${duration}s` });
                setInlineStyles(messageItem, { transitionDuration: `${duration}s` });

                // ⚡ OPTIMIZATION: Force reflow then collapse in next frame
                setInlineStyles(commentList, { maxHeight: `${currentHeight}px` });
                void commentList.offsetHeight; // Force reflow

                requestAnimationFrame(() => {
                    setInlineStyles(commentList, { maxHeight: '160px' });
                    commentList.classList.add('collapsed');
                });

                // 🔧 FIX: Revert button text and icon
                icon.className = 'fas fa-chevron-down';
                span.textContent = window.i18n?.t('guestbook.expand', '展开');
                span.setAttribute('data-i18n', 'guestbook.expand');
            }
        });

        // Event delegation for clickable comments
        document.addEventListener('click', function (e) {
            const commentLikeBtn = e.target.closest('.comment-like-btn[data-comment-id]');
            if (commentLikeBtn) {
                handleLike('Comment', commentLikeBtn.dataset.commentId, commentLikeBtn);
                return;
            }

            const messageActionBtn = e.target.closest('.action-btn[data-message-id][data-message-action]');
            if (messageActionBtn) {
                const messageId = messageActionBtn.dataset.messageId;
                if (!messageId) return;

                if (messageActionBtn.dataset.messageAction === 'like') {
                    handleLike('Message', messageId, messageActionBtn);
                    return;
                }

                if (messageActionBtn.dataset.messageAction === 'comment') {
                    window.openCommentModal(messageId);
                    return;
                }
            }

            const messageImage = e.target.closest('.message-image img[data-guestbook-open-image="1"]');
            if (messageImage instanceof HTMLImageElement) {
                openImageModal(messageImage.currentSrc || messageImage.src);
                return;
            }

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
    window.attachCommentHandlers = attachCommentHandlers;


    commentInput?.addEventListener('input', syncCommentComposerEmptyState);
    commentInput?.addEventListener('focus', syncCommentComposerEmptyState);
    commentInput?.addEventListener('blur', syncCommentComposerEmptyState);
    commentEditor?.addEventListener('click', (event) => {
        if (!commentInput) return;
        if (event.target instanceof HTMLElement && event.target.closest('button, a')) return;
        try {
            commentInput.focus({ preventScroll: true });
        } catch (_) {
            commentInput.focus();
        }
    });
    commentCancelBtn?.addEventListener('click', () => {
        window.closeCommentModal();
    });
    commentModal?.addEventListener('click', (event) => {
        if (event.target === commentModal) {
            window.closeCommentModal(event);
        }
    });
    syncCommentComposerEmptyState();
    syncCommentModalHitTargets(false);

    // Handle Comment Submission
    if (commentForm) {
        commentForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Check Auth - Supabase
            const { data: { user } } = await window.supabaseClient.auth.getUser();
            if (!user) {
                requestGuestbookLoginPrompt(window.i18n?.t?.('auth.loginRequired') || '请先登录后再评论', {
                    closeComment: true
                });
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
                window.closeCommentModal();
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
                        messageCard.classList.add('comment-post-highlight');
                        setTimeout(() => {
                            messageCard.classList.remove('comment-post-highlight');
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
    let mobileHighlightResizeTimer = null;

    function clearMobileHighlight() {
        if (mobileHighlightObserver) {
            mobileHighlightObserver.disconnect();
            mobileHighlightObserver = null;
        }

        mobileHighlightActive = false;
        currentHighlightedItem = null;

        document.querySelectorAll('.message-item.active-focus').forEach(item => {
            item.classList.remove('active-focus');
        });

        document.querySelectorAll('.message-item.observed-by-highlight').forEach(item => {
            item.classList.remove('observed-by-highlight');
        });
    }

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
        items.forEach(item => {
            mobileHighlightObserver.observe(item);
            item.classList.add('observed-by-highlight');
        });

        mobileHighlightActive = true;
        console.log('📱 [Mobile Highlight] Optimized Observer Initialized');
    }

    function syncMobileHighlightMode() {
        if (window.innerWidth <= 768) {
            if (!mobileHighlightActive) {
                initMobileHighlight();
            } else {
                observeNewItems();
            }
            return;
        }

        if (mobileHighlightActive || mobileHighlightObserver || currentHighlightedItem) {
            clearMobileHighlight();
        }
    }

    window.addEventListener('resize', () => {
        window.clearTimeout(mobileHighlightResizeTimer);
        mobileHighlightResizeTimer = window.setTimeout(syncMobileHighlightMode, 120);
    }, { passive: true });

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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGuestbookPage, { once: true });
} else {
    initGuestbookPage();
}

// --- Comment Composer Helpers ---
let commentComposerEntryTimer = null;
const COMMENT_MODAL_KEYBOARD_SETTLE_MS = 90;
const commentModalKeyboardState = {
    viewportCleanup: null,
    viewportRafId: null,
    stableViewportProbe: null,
    baseViewportHeight: 0,
    baseVisualHeight: 0,
    baseCardHeight: 0,
    docked: false,
    lastBottomInset: 0,
    initialDockTimer: null,
    insetDropTimer: null,
    focusedReleaseTimer: null,
    pendingInset: 0,
    sheetAnimationTimer: null
};

function getCommentModalElements() {
    const overlay = document.getElementById('commentModal');
    return {
        overlay,
        card: overlay?.querySelector('.comment-composer-sheet, .comment-modal-content') || null,
        form: document.getElementById('commentForm'),
        input: document.getElementById('commentContent'),
        editor: document.getElementById('commentComposerEditor'),
        title: document.getElementById('commentModalTitle'),
        meta: document.getElementById('commentModalMeta'),
        kicker: document.getElementById('commentModalKicker'),
        submitText: document.getElementById('commentComposerSubmitText'),
        placeholder: document.getElementById('commentComposerPlaceholder'),
        messageIdInput: document.getElementById('commentMessageId'),
        parentIdInput: document.getElementById('commentParentId')
    };
}

function isCommentModalKeyboardDockEnabled() {
    const ua = navigator.userAgent || '';
    const isiOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isiOS && window.matchMedia('(max-width: 768px)').matches && Boolean(window.visualViewport);
}

function getActiveCommentModalInput() {
    const { overlay } = getCommentModalElements();
    const active = document.activeElement;
    if (!overlay || !active || !overlay.contains(active)) return null;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) ? active : null;
}

function focusCommentModalInputWithoutScroll(input) {
    if (!input) return;
    try {
        input.focus({ preventScroll: true });
    } catch (_) {
        input.focus();
    }
}

function bindCommentModalInputFocusStabilizer(input) {
    if (!input || input.dataset.commentFocusStabilizerBound === '1') return;

    input.addEventListener('touchstart', () => {
        const { overlay } = getCommentModalElements();
        if (!isCommentModalKeyboardDockEnabled() || !overlay?.classList.contains('active')) return;
        if (document.activeElement !== input) {
            focusCommentModalInputWithoutScroll(input);
        }
    }, { passive: true });

    input.dataset.commentFocusStabilizerBound = '1';
}

function getCommentModalStableViewportProbe() {
    if (commentModalKeyboardState.stableViewportProbe?.isConnected) {
        return commentModalKeyboardState.stableViewportProbe;
    }

    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.className = 'comment-modal-viewport-probe';
    document.body.appendChild(probe);
    commentModalKeyboardState.stableViewportProbe = probe;
    return probe;
}

function getCommentModalStableViewportHeight() {
    const probe = getCommentModalStableViewportProbe();
    return Math.max(0, Math.round(probe?.getBoundingClientRect().height || probe?.offsetHeight || 0));
}

function clearCommentModalKeyboardTimers() {
    if (commentModalKeyboardState.initialDockTimer) {
        clearTimeout(commentModalKeyboardState.initialDockTimer);
        commentModalKeyboardState.initialDockTimer = null;
    }
    if (commentModalKeyboardState.insetDropTimer) {
        clearTimeout(commentModalKeyboardState.insetDropTimer);
        commentModalKeyboardState.insetDropTimer = null;
    }
    clearCommentModalFocusedReleaseTimer();
    commentModalKeyboardState.pendingInset = 0;
}

function clearCommentModalSheetAnimationTimer() {
    if (commentModalKeyboardState.sheetAnimationTimer) {
        clearTimeout(commentModalKeyboardState.sheetAnimationTimer);
        commentModalKeyboardState.sheetAnimationTimer = null;
    }
}

function clearCommentModalFocusedReleaseTimer() {
    if (commentModalKeyboardState.focusedReleaseTimer) {
        clearTimeout(commentModalKeyboardState.focusedReleaseTimer);
        commentModalKeyboardState.focusedReleaseTimer = null;
    }
}

function scheduleCommentModalFocusedRelease() {
    if (commentModalKeyboardState.focusedReleaseTimer) return;

    commentModalKeyboardState.focusedReleaseTimer = setTimeout(() => {
        commentModalKeyboardState.focusedReleaseTimer = null;
        const { overlay } = getCommentModalElements();
        if (!overlay?.classList.contains('active')) return;
        if (!commentModalKeyboardState.docked || !getActiveCommentModalInput()) return;

        const liveMetrics = getCommentModalViewportMetrics();
        if (liveMetrics.bottomInset <= 24) {
            releaseCommentModalKeyboardDock(true);
        }
    }, 48);
}

function toggleCommentModalSheetAnimation(card, animate) {
    if (!card) return;
    clearCommentModalSheetAnimationTimer();
    card.classList.toggle('comment-sheet-animating', Boolean(animate));
    if (!animate) return;

    commentModalKeyboardState.sheetAnimationTimer = setTimeout(() => {
        card.classList.remove('comment-sheet-animating');
        commentModalKeyboardState.sheetAnimationTimer = null;
    }, 290);
}

function captureCommentModalKeyboardBase() {
    const { overlay, card } = getCommentModalElements();
    const vv = window.visualViewport;
    const visualTop = Math.max(0, vv?.offsetTop || 0);
    const visualHeight = Math.max(0, vv?.height || 0);
    const visualBottom = visualTop + visualHeight;
    const stableViewportHeight = getCommentModalStableViewportHeight();
    const fallbackBaseHeight = Math.max(
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualBottom,
        visualHeight
    );
    const normalizedBaseHeight = Math.max(
        stableViewportHeight || 0,
        fallbackBaseHeight
    );

    commentModalKeyboardState.baseViewportHeight = normalizedBaseHeight;
    commentModalKeyboardState.baseVisualHeight = Math.max(commentModalKeyboardState.baseVisualHeight || 0, visualHeight);
    if (overlay && normalizedBaseHeight) {
        setCssVariables(overlay, {
            '--comment-modal-overlay-height': `${normalizedBaseHeight}px`
        });
    }
    if (card) {
        const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 420);
        commentModalKeyboardState.baseCardHeight = Math.max(300, liveHeight || 400);
    }
}

function getCommentModalViewportMetrics() {
    const vv = window.visualViewport;
    const visualTop = Math.max(0, vv?.offsetTop || 0);
    const visualHeight = Math.max(0, vv?.height || 0);
    const visualBottom = visualTop + visualHeight;
    const baseViewportHeight = Math.max(
        commentModalKeyboardState.baseViewportHeight || 0,
        window.innerHeight || 0,
        document.documentElement.clientHeight || 0,
        visualBottom
    );
    const baseVisualHeight = Math.max(commentModalKeyboardState.baseVisualHeight || 0, visualHeight);
    const insetFromLayout = Math.max(0, baseViewportHeight - visualBottom);
    const insetFromViewportDelta = Math.max(0, baseVisualHeight - visualHeight);

    return {
        visualHeight,
        visualBottom,
        baseViewportHeight,
        baseVisualHeight,
        bottomInset: Math.max(0, Math.round(Math.max(insetFromLayout, insetFromViewportDelta)))
    };
}

function applyCommentModalKeyboardDock(bottomInset, animate = false) {
    const { overlay, card } = getCommentModalElements();
    if (!overlay || !card) return;

    clearCommentModalFocusedReleaseTimer();
    clearCommentComposerEntryTimer();
    overlay.classList.remove('comment-entrying');
    overlay.classList.add('keyboard-docked');

    const metrics = getCommentModalViewportMetrics();
    if (!commentModalKeyboardState.baseCardHeight) {
        const liveHeight = Math.round(card.offsetHeight || card.getBoundingClientRect().height || 400);
        commentModalKeyboardState.baseCardHeight = Math.max(300, liveHeight || 400);
    }

    const baseCardHeight = Math.max(300, commentModalKeyboardState.baseCardHeight || 400);
    const baseViewportHeight = Math.max(metrics.baseViewportHeight || 0, commentModalKeyboardState.baseViewportHeight || 0);
    const keyboardTop = Math.max(0, baseViewportHeight - Math.max(0, bottomInset));
    const minTop = 12;
    const keyboardClearance = 12;
    const maxAvailableHeight = Math.max(260, Math.round(keyboardTop - minTop - keyboardClearance));
    const dockHeight = Math.min(baseCardHeight, maxAvailableHeight);
    const centeredBottom = (baseViewportHeight * 0.5) + (dockHeight * 0.5);
    const targetBottom = Math.max(40, keyboardTop - keyboardClearance);
    const translateY = Math.round(Math.max(-520, Math.min(520, targetBottom - centeredBottom)));

    setCssVariables(overlay, {
        '--comment-modal-translate-y': `${translateY}px`
    });
    setCssVariables(card, {
        '--comment-modal-card-height': `${dockHeight}px`,
        '--comment-modal-card-max-height': `${dockHeight}px`
    });
    toggleCommentModalSheetAnimation(card, animate);
    commentModalKeyboardState.docked = bottomInset > 0;
    commentModalKeyboardState.lastBottomInset = Math.max(0, bottomInset);
}

function releaseCommentModalKeyboardDock(animate = false) {
    const { overlay, card } = getCommentModalElements();
    if (!overlay || !card) return;

    clearCommentModalFocusedReleaseTimer();
    overlay.classList.remove('keyboard-docked');
    setCssVariables(overlay, {
        '--comment-modal-translate-y': '0px'
    });
    setCssVariables(card, {
        '--comment-modal-card-height': '',
        '--comment-modal-card-max-height': ''
    });
    toggleCommentModalSheetAnimation(card, animate);
    commentModalKeyboardState.docked = false;
    commentModalKeyboardState.lastBottomInset = 0;
}

function resetCommentModalKeyboardDockState() {
    clearCommentModalKeyboardTimers();
    clearCommentModalSheetAnimationTimer();
    if (commentModalKeyboardState.viewportRafId) {
        cancelAnimationFrame(commentModalKeyboardState.viewportRafId);
        commentModalKeyboardState.viewportRafId = null;
    }
    releaseCommentModalKeyboardDock(false);
    commentModalKeyboardState.baseViewportHeight = 0;
    commentModalKeyboardState.baseVisualHeight = 0;
    commentModalKeyboardState.baseCardHeight = 0;
}

function syncCommentModalKeyboardDock() {
    const { overlay, card } = getCommentModalElements();
    if (!overlay || !card || !overlay.classList.contains('active')) {
        resetCommentModalKeyboardDockState();
        return;
    }

    if (!isCommentModalKeyboardDockEnabled()) {
        releaseCommentModalKeyboardDock(false);
        return;
    }

    const activeInput = getActiveCommentModalInput();
    const metrics = getCommentModalViewportMetrics();
    const bottomInset = metrics.bottomInset;
    const shouldDock = Boolean(activeInput) && (commentModalKeyboardState.docked ? bottomInset > 8 : bottomInset > 24);
    const nextInset = shouldDock ? bottomInset : 0;
    const previousInset = commentModalKeyboardState.lastBottomInset;
    const isInsetDroppingWhileFocused = commentModalKeyboardState.docked
        && Boolean(activeInput)
        && nextInset > 24
        && nextInset + 24 < previousInset;

    if (!commentModalKeyboardState.docked && shouldDock) {
        commentModalKeyboardState.pendingInset = nextInset;
        if (!commentModalKeyboardState.initialDockTimer) {
            commentModalKeyboardState.initialDockTimer = setTimeout(() => {
                commentModalKeyboardState.initialDockTimer = null;
                if (!getActiveCommentModalInput()) return;
                const liveMetrics = getCommentModalViewportMetrics();
                if (liveMetrics.bottomInset <= 24) return;
                applyCommentModalKeyboardDock(liveMetrics.bottomInset, true);
            }, COMMENT_MODAL_KEYBOARD_SETTLE_MS);
        }
        return;
    }

    if (commentModalKeyboardState.initialDockTimer && (commentModalKeyboardState.docked || !shouldDock)) {
        clearTimeout(commentModalKeyboardState.initialDockTimer);
        commentModalKeyboardState.initialDockTimer = null;
    }

    if (commentModalKeyboardState.insetDropTimer && (!isInsetDroppingWhileFocused || nextInset >= previousInset)) {
        clearTimeout(commentModalKeyboardState.insetDropTimer);
        commentModalKeyboardState.insetDropTimer = null;
        commentModalKeyboardState.pendingInset = 0;
    }

    if (isInsetDroppingWhileFocused) {
        commentModalKeyboardState.pendingInset = 0;
        applyCommentModalKeyboardDock(nextInset, false);
        return;
    }

    if (commentModalKeyboardState.docked && activeInput && nextInset <= 24) {
        scheduleCommentModalFocusedRelease();
        return;
    }

    if (nextInset > 24) {
        applyCommentModalKeyboardDock(nextInset, false);
        return;
    }

    if (commentModalKeyboardState.docked) {
        releaseCommentModalKeyboardDock(!activeInput && previousInset > 0);
    }
}

function attachCommentModalKeyboardDock() {
    if (!isCommentModalKeyboardDockEnabled()) return;

    const { overlay } = getCommentModalElements();
    const vv = window.visualViewport;
    if (!overlay || !vv) return;

    detachCommentModalKeyboardDock();
    captureCommentModalKeyboardBase();
    syncCommentModalKeyboardDock();

    const inputs = Array.from(overlay.querySelectorAll('input, textarea, select'));
    inputs.forEach((input) => bindCommentModalInputFocusStabilizer(input));

    const handleViewportChange = () => {
        if (commentModalKeyboardState.viewportRafId) return;
        commentModalKeyboardState.viewportRafId = requestAnimationFrame(() => {
            commentModalKeyboardState.viewportRafId = null;
            syncCommentModalKeyboardDock();
        });
    };

    vv.addEventListener('resize', handleViewportChange, { passive: true });
    vv.addEventListener('scroll', handleViewportChange, { passive: true });
    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('orientationchange', handleViewportChange, { passive: true });
    inputs.forEach((input) => {
        input.addEventListener('focus', handleViewportChange);
        input.addEventListener('blur', handleViewportChange);
    });

    commentModalKeyboardState.viewportCleanup = () => {
        vv.removeEventListener('resize', handleViewportChange);
        vv.removeEventListener('scroll', handleViewportChange);
        window.removeEventListener('resize', handleViewportChange);
        window.removeEventListener('orientationchange', handleViewportChange);
        inputs.forEach((input) => {
            input.removeEventListener('focus', handleViewportChange);
            input.removeEventListener('blur', handleViewportChange);
        });
        if (commentModalKeyboardState.viewportRafId) {
            cancelAnimationFrame(commentModalKeyboardState.viewportRafId);
            commentModalKeyboardState.viewportRafId = null;
        }
        commentModalKeyboardState.viewportCleanup = null;
    };
}

function detachCommentModalKeyboardDock() {
    if (typeof commentModalKeyboardState.viewportCleanup === 'function') {
        commentModalKeyboardState.viewportCleanup();
    }
    clearCommentModalKeyboardTimers();
}

function isEnglishDocument() {
    return (document.documentElement.lang || '').toLowerCase().startsWith('en');
}

function truncateCommentComposerText(text, maxLength = 42) {
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength).trim()}...`;
}

function syncCommentComposerEmptyState() {
    const { input, editor } = getCommentModalElements();
    if (!input || !editor) return;
    editor.classList.toggle('is-empty', !input.value.trim());
}

function syncCommentModalHitTargets(isOpen) {
    const { overlay, card } = getCommentModalElements();
    if (!overlay || !card) return;

    const interactive = !!isOpen;
    overlay.setAttribute('aria-hidden', interactive ? 'false' : 'true');
    overlay.classList.toggle('comment-modal-interactive', interactive);
}

function clearCommentComposerEntryTimer() {
    if (commentComposerEntryTimer) {
        clearTimeout(commentComposerEntryTimer);
        commentComposerEntryTimer = null;
    }
}

function playCommentComposerEntryAnimation() {
    const { overlay } = getCommentModalElements();
    if (!overlay) return;

    clearCommentComposerEntryTimer();
    overlay.classList.remove('comment-entrying');
    void overlay.offsetWidth;
    overlay.classList.add('comment-entrying');

    commentComposerEntryTimer = setTimeout(() => {
        overlay.classList.remove('comment-entrying');
        commentComposerEntryTimer = null;
    }, 760);
}

function buildCommentComposerContext(messageId, parentCommentId = null) {
    const english = isEnglishDocument();

    if (parentCommentId) {
        const parentComment = document.querySelector(`[data-comment-id="${parentCommentId}"]`);
        const authorName = parentComment?.querySelector('.comment-author')?.textContent?.trim() || '';
        const contentPreview = truncateCommentComposerText(
            parentComment?.querySelector('.comment-content')?.textContent || ''
        );

        return {
            kicker: english ? 'REPLY' : '回复',
            title: english ? 'Reply to Comment' : '回复评论',
            meta: authorName
                ? (english ? `Replying to @${authorName}${contentPreview ? ` · ${contentPreview}` : ''}` : `正在回复 @${authorName}${contentPreview ? ` · ${contentPreview}` : ''}`)
                : (english ? 'Continue the conversation here.' : '在这里继续这段对话。'),
            placeholder: authorName
                ? (english ? `Reply to @${authorName}...` : `回复 @${authorName}...`)
                : (english ? 'Write your reply...' : '写下您的回复...'),
            submitText: english ? 'Reply' : '回复'
        };
    }

    const messageCard = document.querySelector(`.message-item[data-message-id="${messageId}"]`);
    const authorName = messageCard?.querySelector('.author-name')?.textContent?.trim() || '';
    const contentPreview = truncateCommentComposerText(
        messageCard?.querySelector('.message-content')?.textContent || ''
    );

    return {
        kicker: english ? 'COMMENT' : '评论',
        title: english ? 'Post Comment' : '发表评论',
        meta: authorName
            ? (english ? `Commenting on @${authorName}${contentPreview ? ` · ${contentPreview}` : ''}` : `评论 @${authorName} 的留言${contentPreview ? ` · ${contentPreview}` : ''}`)
            : (english ? 'Share your thoughts with everyone here.' : '写下你的想法，和大家一起交流。'),
        placeholder: english ? 'Write your comment...' : '写下您的评论...',
        submitText: english ? 'Send' : '发送'
    };
}

function applyCommentComposerContext(messageId, parentCommentId = null) {
    const { title, meta, kicker, input, submitText, placeholder } = getCommentModalElements();
    const context = buildCommentComposerContext(messageId, parentCommentId);

    if (title) title.textContent = context.title;
    if (meta) meta.textContent = context.meta;
    if (kicker) kicker.textContent = context.kicker;
    if (submitText) submitText.textContent = context.submitText;
    if (placeholder) placeholder.textContent = context.placeholder;
    if (input) {
        input.placeholder = '';
        input.setAttribute('aria-label', context.title);
    }
}

// --- Global Modal Functions (Must be outside DOMContentLoaded) ---

window.openCommentModal = async function (messageId, parentCommentId = null) {
    console.log('💬 openCommentModal:', messageId, parentCommentId);

    // ⚡ PERF: Use getSession (cached) instead of getUser (network call)
    // getSession uses local storage cache, getUser always makes a network request
    let user;
    try {
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        user = session?.user;

        if (error) {
            console.error('Session error:', error);
        }
    } catch (error) {
        console.error('Error getting session:', error);
        alert("获取用户信息失败\n\n错误: " + error.message);
        return;
    }

    if (!user) {
        requestGuestbookLoginPrompt(window.i18n?.t?.('auth.loginRequired') || '请先登录后再评论');
        return;
    }

    const {
        overlay: modal,
        form,
        input: contentInput,
        messageIdInput,
        parentIdInput
    } = getCommentModalElements();

    if (modal && messageIdInput) {
        clearCommentComposerEntryTimer();
        detachCommentModalKeyboardDock();
        resetCommentModalKeyboardDockState();
        form?.reset();

        // Set messageId
        messageIdInput.value = messageId;
        if (parentIdInput) {
            parentIdInput.value = parentCommentId || '';
        }

        applyCommentComposerContext(messageId, parentCommentId);
        syncCommentComposerEmptyState();
        syncCommentModalHitTargets(true);

        // Add body class
        document.body.classList.add('modal-active');
        if (window.iOSScrollLock) window.iOSScrollLock.lockLight(modal);

        // Add active class to trigger CSS animation
        modal.classList.remove('active', 'comment-entrying', 'keyboard-docked', 'ios-focus-lock', 'comment-modal-force-hidden');
        setCssVariables(modal, {
            '--comment-modal-translate-y': '0px'
        });
        void modal.offsetWidth;
        modal.classList.add('active');
        modal.classList.add('overlay-visible');
        modal.classList.remove('overlay-hidden');
        playCommentComposerEntryAnimation();
        attachCommentModalKeyboardDock();

        // Focus content input
        setTimeout(() => {
            if (contentInput) {
                focusCommentModalInputWithoutScroll(contentInput);
                setTimeout(() => syncCommentModalKeyboardDock(), 120);
            }
        }, 100);
    } else {
        console.error('❌ Modal or input not found!');
    }
};

window.closeCommentModal = function (event) {
    const { overlay: modal, form } = getCommentModalElements();
    if (!modal) return;

    const shouldClose = !event ||
        event.target === modal ||
        event.target?.closest?.('#commentComposerCancelBtn');

    if (!shouldClose) {
        return;
    }

    clearCommentComposerEntryTimer();
    window.runSiteModalCloseChromeCleanup?.({
        targets: [modal],
        forceHiddenClass: 'comment-modal-force-hidden',
        restoreDelayMs: 320
    });
    getActiveCommentModalInput()?.blur();
    detachCommentModalKeyboardDock();
    resetCommentModalKeyboardDockState();

    document.body.classList.remove('modal-active');
    if (window.iOSScrollLock) window.iOSScrollLock.unlock();

    modal.classList.remove('active', 'comment-entrying', 'keyboard-docked', 'ios-focus-lock', 'overlay-visible');
    modal.classList.add('overlay-hidden');
    modal.querySelector('.comment-composer-sheet')?.classList.remove('comment-sheet-animating');
    setCssVariables(modal, {
        '--comment-modal-translate-y': '0px',
        '--comment-modal-overlay-height': ''
    });
    syncCommentModalHitTargets(false);

    form?.reset();
    applyCommentComposerContext('', null);
    syncCommentComposerEmptyState();
};



// Initialize magnetic effect for message items
function initMagneticEffect() {
    const cards = document.querySelectorAll('.message-item');

    cards.forEach(card => {
        // Fix: Animation 'forwards' locks the transform property.
        // We must remove the animation after it finishes to allow JS transforms.

        // Method 1: Event Listener
        card.addEventListener('animationend', () => {
            setInlineStyles(card, {
                opacity: '1',
                animation: 'none'
            });
        }, { once: true });

        // Method 2: Timeout Fallback (for safety)
        setTimeout(() => {
            const computedStyle = window.getComputedStyle(card);
            if (computedStyle.animationName !== 'none') {
                setInlineStyles(card, {
                    opacity: '1',
                    animation: 'none'
                });
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

            setInlineStyles(card, { transform: `translate(${deltaX}px, ${deltaY}px) scale(1.01)` });
        });

        card.addEventListener('mouseleave', () => {
            setInlineStyles(card, { transform: '' });
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
                <button class="image-modal-close" type="button">
                    <i class="fas fa-times"></i>
                </button>
                <img src="" alt="查看大图">
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.image-modal-close')?.addEventListener('click', () => {
            closeImageModal();
        });

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

    modal.classList.remove('image-modal-force-hidden');
    modal.classList.add('active');
    if (window.iOSScrollLock) window.iOSScrollLock.lockLight(modal); // Lock background scrolling (light mode to preserve transparency)

}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        window.runSiteModalCloseChromeCleanup?.({
            targets: [modal],
            forceHiddenClass: 'image-modal-force-hidden',
            restoreDelayMs: 320
        });
        modal.classList.remove('active');
        if (window.iOSScrollLock) window.iOSScrollLock.unlock();
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
    btn.classList.add('is-processing');

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
                icon.classList.add('like-icon-bounce');
                setTimeout(() => icon.classList.remove('like-icon-bounce'), 200);
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
    btn.classList.remove('is-processing');
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
async function fetchAndInsertSingleMessage(messageId, targetId = null, type = 'message', options = {}) {
    try {
        console.log(`🎣 拉取单条留言: ${messageId}`);

        const forceRefresh = options.forceRefresh === true;
        const existingEarly = document.querySelector(`.message-item[data-message-id="${messageId}"]`);
        if (existingEarly && !forceRefresh) {
            console.warn(`⚠️ [早期检查] 留言已存在，直接返回: ${messageId}`);
            return true;
        }

        if (!window.supabaseClient) {
            console.error('❌ Supabase client not ready');
            return false;
        }

        const currentSite = window.SiteConfig?.site || 'cn';
        const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
        const currentUserId = session?.user?.id || null;

        const [messageResult, commentsResult] = await Promise.all([
            window.supabaseClient
                .from('guestbook_messages')
                .select(`
                    id,
                    content,
                    image_url,
                    like_count,
                    created_at,
                    user_id,
                    profiles:user_id (id, username, avatar_url)
                `)
                .eq('id', messageId)
                .eq('site', currentSite)
                .single(),
            window.supabaseClient
                .from('guestbook_comments')
                .select(`
                    id,
                    message_id,
                    parent_id,
                    content,
                    created_at,
                    user_id,
                    profiles:user_id (id, username, avatar_url)
                `)
                .eq('message_id', messageId)
                .eq('site', currentSite)
                .order('created_at', { ascending: true })
        ]);

        if (messageResult.error || !messageResult.data) {
            throw messageResult.error || new Error('留言不存在');
        }
        if (commentsResult.error) throw commentsResult.error;

        const comments = commentsResult.data || [];
        const commentIds = comments.map(comment => comment.id);
        const allTargetIds = [messageId, ...commentIds];

        const [commentLikesResult, userLikesResult] = await Promise.all([
            commentIds.length > 0
                ? window.supabaseClient
                    .from('guestbook_likes')
                    .select('target_id')
                    .eq('target_type', 'comment')
                    .in('target_id', commentIds)
                : Promise.resolve({ data: [] }),
            currentUserId && allTargetIds.length > 0
                ? window.supabaseClient
                    .from('guestbook_likes')
                    .select('target_type, target_id')
                    .eq('user_id', currentUserId)
                    .in('target_id', allTargetIds)
                : Promise.resolve({ data: [] })
        ]);

        if (commentLikesResult.error) throw commentLikesResult.error;
        if (userLikesResult.error) throw userLikesResult.error;

        const commentLikeCounts = {};
        (commentLikesResult.data || []).forEach(like => {
            commentLikeCounts[like.target_id] = (commentLikeCounts[like.target_id] || 0) + 1;
        });

        const normalizedLikeKeys = (userLikesResult.data || []).map(like => {
            const normalizedType = like.target_type.charAt(0).toUpperCase() + like.target_type.slice(1);
            return `${normalizedType}_${like.target_id}`;
        });

        if (normalizedLikeKeys.length > 0 && window.guestbookCache?.userLikes) {
            window.guestbookCache.userLikes = new Set([
                ...window.guestbookCache.userLikes,
                ...normalizedLikeKeys
            ]);
        }

        const commentMap = new Map(comments.map(comment => [comment.id, comment]));
        const enrichedComments = comments.map(comment => ({
            ...comment,
            like_count: commentLikeCounts[comment.id] || 0,
            parentUserName: comment.parent_id
                ? commentMap.get(comment.parent_id)?.profiles?.username || null
                : null
        }));

        const buildLocalCommentTree = (items) => {
            const localMap = {};
            const roots = [];

            items.forEach(item => {
                localMap[item.id] = { ...item, replies: [] };
            });

            items.forEach(item => {
                if (item.parent_id && localMap[item.parent_id]) {
                    localMap[item.parent_id].replies.push(localMap[item.id]);
                } else {
                    roots.push(localMap[item.id]);
                }
            });

            return roots;
        };

        const messageRecord = {
            ...messageResult.data,
            comments: buildLocalCommentTree(enrichedComments)
        };

        const formattedMessage = typeof formatMessageForUI === 'function'
            ? formatMessageForUI(messageRecord)
            : {
                id: messageRecord.id,
                objectId: messageRecord.id,
                content: messageRecord.content,
                image: messageRecord.image_url,
                imageUrl: messageRecord.image_url,
                name: messageRecord.profiles?.username || 'Anonymous',
                username: messageRecord.profiles?.username || 'Anonymous',
                avatarUrl: messageRecord.profiles?.avatar_url || null,
                userId: messageRecord.user_id,
                authorId: messageRecord.user_id,
                likes: messageRecord.like_count || 0,
                timestamp: typeof formatTime === 'function' ? formatTime(messageRecord.created_at) : '',
                comments: [],
                isLiked: Boolean(window.guestbookCache?.userLikes?.has?.(`Message_${messageRecord.id}`))
            };

        const shouldForceExpand = options.forceExpanded === true || (type === 'comment' && Boolean(targetId));
        const insertedCard = typeof window.upsertGuestbookMessageDOM === 'function'
            ? window.upsertGuestbookMessageDOM(formattedMessage, {
                position: 'prepend',
                markFetchedHistory: true,
                forceExpanded: shouldForceExpand
            })
            : (typeof window.insertMessageToDOM === 'function' && !existingEarly
                ? window.insertMessageToDOM({
                    ...formattedMessage,
                    forceExpanded: shouldForceExpand
                }, {
                    position: 'prepend',
                    markFetchedHistory: true
                })
                : null);

        if (!insertedCard) {
            console.error('❌ 无法插入补拉留言到 DOM');
            return false;
        }

        insertedCard.classList.remove('highlight-flash');
        void insertedCard.offsetWidth;
        insertedCard.classList.add('highlight-flash');
        return true;
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
    if (!targetId) return false;

    // 特殊处理：滚动到顶部
    if (targetId === 'TOP') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return true;
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
            const success = await fetchAndInsertSingleMessage(parentMessageId, targetId, 'comment', {
                forceExpanded: true
            });
            if (success) {
                // 等待插入完成
                await new Promise(r => setTimeout(r, 500));
            }
        } else {
            console.log('🔄 父留言已在当前视图，强制刷新评论树后再定位...');
            const success = await fetchAndInsertSingleMessage(parentMessageId, targetId, 'comment', {
                forceRefresh: true,
                forceExpanded: true
            });
            if (success) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        targetElement = document.querySelector(selector);
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
        targetElement = document.querySelector(selector);
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
                    const isHidden = commentList.hidden || commentList.classList.contains('collapsed');
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
            setInlineStyles(targetElement, {
                contentVisibility: 'visible',
                containIntrinsicSize: 'auto'
            });

            // 如果是评论，还需要禁用父卡片和评论区的 content-visibility
            if (type === 'comment' && parentMessageId) {
                parentCard = document.querySelector(`.message-item[data-message-id="${parentMessageId}"]`);
                if (parentCard) {
                    console.log('📱 移动端评论定位：禁用父卡片和评论区的 content-visibility');
                    setInlineStyles(parentCard, { contentVisibility: 'visible' });

                    commentsSection = parentCard.querySelector('.comment-list');
                    if (commentsSection) {
                        setInlineStyles(commentsSection, { contentVisibility: 'visible' });
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
                setInlineStyles(commentList, { maxHeight: `${fullHeight}px` });

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
                setInlineStyles(targetElement, { willChange: '' });

                // 定位完成后，恢复 content-visibility 优化
                setInlineStyles(targetElement, {
                    contentVisibility: '',
                    containIntrinsicSize: ''
                });
                setInlineStyles(parentCard, { contentVisibility: '' });
                setInlineStyles(commentsSection, { contentVisibility: '' });
            }, 4000);

            return true;
        }

        // ✅ 桌面端：分两步清理，避免突然移除will-change导致的布局抖动
        // 步骤1：3.5秒后动画自然结束，保持最终状态
        setTimeout(() => {
            // 先清除 will-change，让浏览器知道不再需要优化
            setInlineStyles(targetElement, { willChange: 'auto' });
        }, 3500);

        // 步骤2：给浏览器200ms缓冲期，然后再移除类名
        setTimeout(() => {
            targetElement.classList.remove('highlight-flash');
            // 清理内联样式
            setInlineStyles(targetElement, { willChange: '' });
        }, 3700);
        return true;
    } else {
        return false;
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

// ==================== Language Change Handler ====================
// Update dynamically generated text when language is switched
window.addEventListener('languageChanged', () => {
    console.log('🌍 [Guestbook] Language changed, updating dynamic text...');

    // Update expand/collapse toggle buttons
    document.querySelectorAll('.comment-toggle-btn').forEach(btn => {
        const span = btn.querySelector('span');
        const icon = btn.querySelector('i');

        if (span && icon) {
            // Check current state by icon class
            const isExpanded = icon.classList.contains('fa-chevron-up');
            span.textContent = isExpanded
                ? window.i18n?.t('guestbook.collapse', '收起')
                : window.i18n?.t('guestbook.expand', '展开');
        }
    });

    // Update loading indicator text
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${window.i18n?.t('common.loading') || '加载中...'}`;
    }

    console.log('✅ [Guestbook] Dynamic text updated');
});
