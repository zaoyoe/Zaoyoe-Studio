/**
 * Admin Comments Module
 * Manages both guestbook messages and gallery comments
 */

// Get supabase client reference - check if already defined (from admin-points.js)
// Use existing function if available, otherwise define it
if (typeof getSupabase === 'undefined') {
    window.getSupabase = () => window.supabaseClient || window.supabase;
}

// Current state
// Current state
let currentCommentView = 'guestbook'; // 'guestbook' or 'gallery'
let commentsData = [];
let commentsById = new Map();
let commentsLoading = false;
let commentsInitialized = false;
let commentsSkipNextActivateReload = false;
let filteredComments = []; // Global filtered data for export
let commentsSummaryState = null;
const COMMENTS_DEFAULT_PAGE_SIZE = 15;
const COMMENTS_EXPORT_PAGE_SIZE = 200;
const COMMENTS_PREFETCH_VIEWS = ['guestbook', 'gallery'];
let retainedSelectedCommentIds = new Set();
let pendingFocusedCommentId = '';
let activeCommentQueue = 'pending';
let activeCommentDetailId = '';
let activeCommentDetailSnapshot = null;
let isCommentsSelectMode = false;
let activeCommentsBatchInteraction = null;
let commentDetailLoading = false;
let commentsPaginationState = {
    page: 1,
    pageSize: COMMENTS_DEFAULT_PAGE_SIZE,
    totalItems: 0,
    totalPages: 1
};
let pendingCommentsLoadRequest = null;
const commentsViewCache = {
    guestbook: { key: '', payload: null },
    gallery: { key: '', payload: null }
};
const commentsSummaryCache = {
    guestbook: { key: '', payload: null },
    gallery: { key: '', payload: null }
};
let commentsViewPrefetchHandle = 0;
let commentsViewPrefetchMode = '';
let commentsViewPrefetchTaskKey = '';
let commentsViewPrefetchPromise = null;
let commentsSummaryRequestVersion = 0;
let commentsSummaryPrefetchTaskKey = '';
let commentsSummaryPrefetchPromise = null;

// Filter state
const filterState = {
    date: 'all',           // 'all', 'today', 'week', 'month', 'custom'
    dateFrom: null,        // custom range start (datetime string)
    dateTo: null,          // custom range end (datetime string)
    user: '',              // DEPRECATED - separate search tags used instead
    currentSearchInput: '', // Live search input value
    status: 'all',         // 'all', 'replied', 'unreplied'
    type: 'all',           // 'all', 'top', 'reply'
    hasImage: false,       // checkbox
    source: 'all',         // 'all', 'guestbook', 'gallery'
    queue: 'pending',      // governance queue
    searchTags: [],        // Array of search strings
    promptId: '',
    promptTitle: ''
};

function getCommentsReadSite() {
    return window.AdminSiteFilter?.getSiteFilter?.() || 'all';
}

function isCurrentCommentsSite(site) {
    return String(getCommentsReadSite() || 'all').trim().toLowerCase()
        === String(site || 'all').trim().toLowerCase();
}

function requireWritableCommentsSite(options = {}) {
    return window.AdminSiteFilter?.requireWritableSite?.(options) || null;
}

function emitCommentsCommandFeedback(message = '', feedbackState = 'saved', options = {}) {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return null;
    }

    const detail = {
        kind: 'module-result',
        source: String(options?.source || 'comments-batch').trim().toLowerCase() || 'comments-batch',
        module: 'comments',
        state: String(feedbackState || options?.state || 'saved').trim().toLowerCase() || 'saved',
        tone: String(options?.tone || '').trim().toLowerCase(),
        message: normalizedMessage,
        persistent: options?.persistent === true,
        timestamp: Date.now()
    };

    if (typeof window.dispatchAdminStudioFeedbackSignal === 'function') {
        return window.dispatchAdminStudioFeedbackSignal(detail);
    }

    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('admin-feedback-signal', { detail }));
        } catch (_) {
            // Comments feedback is advisory and should not block governance actions.
        }
    }

    return detail;
}

function notifyCommentsBatchRecovery(message = '', feedbackState = 'failed') {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return;
    }

    const state = String(feedbackState || 'failed').trim().toLowerCase() || 'failed';
    showToast(normalizedMessage, state === 'partial' ? 'warning' : 'error');
    emitCommentsCommandFeedback(normalizedMessage, state, { source: 'comments-batch' });
}

function buildAdminCommentsUrl(route, params = {}) {
    const url = new URL(`/api/admin/${route}`, window.location.origin);

    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;

        if (Array.isArray(value)) {
            value
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
                .forEach((entry) => {
                    url.searchParams.append(key, entry);
                });
            return;
        }

        url.searchParams.set(key, String(value));
    });

    return `${url.pathname}${url.search}`;
}

async function parseAdminCommentsResponse(response) {
    let payload = {};

    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }

    if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || `Comments request failed (${response.status})`);
    }

    return payload;
}

async function fetchAdminCommentSummary(site = getCommentsReadSite(), view = currentCommentView) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminCommentsUrl('comments/summary', {
        site,
        view: view === 'gallery' ? 'gallery' : 'guestbook'
    }), {
        credentials: 'include'
    });

    return parseAdminCommentsResponse(response);
}

async function fetchAdminCommentsList({
    view,
    site = getCommentsReadSite(),
    dateFrom = '',
    dateTo = '',
    page = 1,
    pageSize = COMMENTS_DEFAULT_PAGE_SIZE,
    status = 'all',
    type = 'all',
    source = 'all',
    queue = 'pending',
    hasImage = false,
    promptId = '',
    search = '',
    searchTag = []
} = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminCommentsUrl('comments/list', {
        view,
        site,
        dateFrom,
        dateTo,
        page,
        pageSize,
        status: status !== 'all' ? status : '',
        type: type !== 'all' ? type : '',
        source: source !== 'all' ? source : '',
        queue: queue !== 'pending' ? queue : '',
        hasImage: hasImage ? '1' : '',
        promptId,
        search,
        searchTag
    }), {
        credentials: 'include'
    });

    return parseAdminCommentsResponse(response);
}

async function moderateCommentsViaAdminApi({ items = [], site, action = 'delete_many', reason = '' } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)('/api/admin/comments/moderate', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action,
            site,
            items,
            reason
        })
    });

    const payload = await parseAdminCommentsResponse(response);
    invalidateCommentsViewCache();
    return payload;
}

async function fetchAdminCommentBlockState(userId, site = getCommentsReadSite()) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminCommentsUrl('comments/blocks', {
        userId,
        site
    }), {
        credentials: 'include'
    });

    return parseAdminCommentsResponse(response);
}

async function mutateAdminCommentBlockState({ action, userId, scope, days = null, reason = '', site } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)('/api/admin/comments/blocks', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action,
            userId,
            scope,
            days,
            reason,
            site
        })
    });

    const payload = await parseAdminCommentsResponse(response);
    invalidateCommentsViewCache();
    return payload;
}

async function toggleCommentPinViaAdminApi({ id, promptId, currentStatus, site } = {}) {
    const response = await (window.AdminApi?.fetch || fetch)('/api/admin/comments/moderate', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action: 'toggle_pin',
            site,
            id,
            promptId,
            currentStatus
        })
    });

    const payload = await parseAdminCommentsResponse(response);
    invalidateCommentsViewCache();
    return payload;
}

async function fetchAdminCommentWorkflowDetail({
    site = getCommentsReadSite(),
    entityType = '',
    entityId = ''
} = {}) {
    const response = await (window.AdminApi?.fetch || fetch)(buildAdminCommentsUrl('comments/workflow', {
        site,
        entityType,
        entityId
    }), {
        credentials: 'include'
    });

    return parseAdminCommentsResponse(response);
}

async function mutateAdminCommentWorkflow({
    action,
    site = getCommentsReadSite(),
    entityType = '',
    entityId = '',
    status = '',
    priority = '',
    tags = [],
    note = '',
    comment = null
} = {}) {
    const response = await (window.AdminApi?.fetch || fetch)('/api/admin/comments/workflow', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action,
            site,
            entityType,
            entityId,
            status,
            priority,
            tags,
            note,
            comment
        })
    });

    const payload = await parseAdminCommentsResponse(response);
    invalidateCommentsViewCache();
    return payload;
}

function buildCommentLoadingSkeleton(count = 6) {
    const itemCount = Math.max(3, Number.parseInt(count, 10) || 6);
    return Array.from({ length: itemCount }, (_, index) => `
        <div class="comment-admin-item comment-admin-item--skeleton" aria-hidden="true" data-skeleton-index="${index}">
            <div class="item-checkbox-wrapper">
                <span class="admin-skeleton-block admin-skeleton-block--checkbox"></span>
            </div>
            <div class="item-header">
                <span class="admin-skeleton-block admin-skeleton-block--avatar"></span>
                <div class="item-meta">
                    <div class="comment-skeleton-meta-row">
                        <span class="admin-skeleton-block admin-skeleton-block--title" style="width:${42 + (index % 3) * 10}%"></span>
                        ${index % 2 === 0 ? '<span class="admin-skeleton-block admin-skeleton-block--pill comment-skeleton-chip" style="width:72px"></span>' : ''}
                    </div>
                    <div class="comment-skeleton-tags">
                        <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${24 + (index % 3) * 8}%"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--pill comment-skeleton-chip comment-skeleton-chip--mini" style="width:${56 + (index % 2) * 12}px"></span>
                    </div>
                </div>
            </div>
            <div class="item-content">
                <span class="admin-skeleton-block admin-skeleton-block--line" style="width:100%"></span>
                <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${76 - (index % 2) * 12}%"></span>
                <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${58 + (index % 3) * 10}%"></span>
                ${index % 3 === 1 ? `
                    <div class="comment-skeleton-reply">
                        <span class="admin-skeleton-block admin-skeleton-block--pill comment-skeleton-chip comment-skeleton-chip--mini" style="width:58px"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line" style="width:84%"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line" style="width:62%"></span>
                    </div>
                ` : `
                    <div class="comment-skeleton-context">
                        <span class="admin-skeleton-block admin-skeleton-block--pill comment-skeleton-chip comment-skeleton-chip--mini" style="width:${68 + (index % 2) * 12}px"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line" style="width:${36 + (index % 3) * 10}%"></span>
                    </div>
                `}
            </div>
            <div class="item-actions">
                <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                <span class="admin-skeleton-block admin-skeleton-block--action"></span>
                <span class="admin-skeleton-block admin-skeleton-block--action"></span>
            </div>
        </div>
    `).join('');
}

function buildCommentContextUrl(comment = {}) {
    const contextId = String(comment?.context || '').trim();
    const commentId = String(comment?.id || '').trim();

    if (!contextId) {
        return '';
    }

    if (comment?.type === 'guestbook') {
        const url = new URL('guestbook.html', window.location.origin);
        url.searchParams.set('messageId', contextId);
        if (comment?.record_type !== 'message' && commentId) {
            url.searchParams.set('commentId', commentId);
        }
        return `${url.pathname}${url.search}`;
    }

    const url = new URL('prompts.html', window.location.origin);
    url.searchParams.set('id', contextId);
    url.searchParams.set('comments', '1');
    if (commentId) {
        url.searchParams.set('commentId', commentId);
    }
    return `${url.pathname}${url.search}`;
}

function getAdminCommentsRouteUrlObject() {
    if (typeof window.getAdminStudioUrlObject === 'function') {
        const resolvedUrl = window.getAdminStudioUrlObject();
        if (resolvedUrl) {
            return resolvedUrl;
        }
    }

    try {
        return new URL(window.location.href);
    } catch (error) {
        console.warn('[Comments] Failed to parse current URL:', error);
        return null;
    }
}

function getAdminCommentsRouteState() {
    const url = getAdminCommentsRouteUrlObject();
    const searchParams = url?.searchParams;
    return {
        view: String(searchParams?.get('comments_view') || '').trim().toLowerCase() === 'gallery' ? 'gallery' : 'guestbook',
        queue: String(searchParams?.get('comments_queue') || '').trim().toLowerCase() || 'pending',
        promptId: String(searchParams?.get('comments_prompt_id') || '').trim(),
        promptTitle: String(searchParams?.get('comments_prompt_title') || '').trim(),
        focusCommentId: String(searchParams?.get('comments_focus_id') || '').trim()
    };
}

function syncAdminCommentsRouteState(nextState = {}, options = {}) {
    const url = getAdminCommentsRouteUrlObject();
    if (!url || typeof window.history?.replaceState !== 'function') {
        return false;
    }

    const currentState = getAdminCommentsRouteState();
    const view = Object.prototype.hasOwnProperty.call(nextState, 'view')
        ? (String(nextState.view || '').trim().toLowerCase() === 'gallery' ? 'gallery' : 'guestbook')
        : currentState.view;
    const queue = Object.prototype.hasOwnProperty.call(nextState, 'queue')
        ? (String(nextState.queue || '').trim().toLowerCase() || 'pending')
        : (currentState.queue || 'pending');
    const promptId = view === 'gallery'
        ? (Object.prototype.hasOwnProperty.call(nextState, 'promptId')
            ? String(nextState.promptId || '').trim()
            : currentState.promptId)
        : '';
    const promptTitle = promptId
        ? (Object.prototype.hasOwnProperty.call(nextState, 'promptTitle')
            ? String(nextState.promptTitle || '').trim()
            : currentState.promptTitle)
        : '';
    const focusCommentId = Object.prototype.hasOwnProperty.call(nextState, 'focusCommentId')
        ? String(nextState.focusCommentId || '').trim()
        : currentState.focusCommentId;

    if (options.ensureCommentsModule === true) {
        url.searchParams.set('module', 'comments');
    }

    url.searchParams.set('comments_view', view);
    if (queue && queue !== 'pending') {
        url.searchParams.set('comments_queue', queue);
    } else {
        url.searchParams.delete('comments_queue');
    }
    if (promptId) {
        url.searchParams.set('comments_prompt_id', promptId);
        if (promptTitle) {
            url.searchParams.set('comments_prompt_title', promptTitle);
        } else {
            url.searchParams.delete('comments_prompt_title');
        }
    } else {
        url.searchParams.delete('comments_prompt_id');
        url.searchParams.delete('comments_prompt_title');
    }

    if (focusCommentId) {
        url.searchParams.set('comments_focus_id', focusCommentId);
    } else {
        url.searchParams.delete('comments_focus_id');
    }

    const nextRelativeUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextRelativeUrl !== currentRelativeUrl) {
        window.history.replaceState(window.history.state, '', nextRelativeUrl);
    }
    return true;
}

function clearAdminCommentsPromptContext({ syncRoute = true } = {}) {
    filterState.promptId = '';
    filterState.promptTitle = '';
    if (syncRoute) {
        syncAdminCommentsRouteState({
            view: currentCommentView,
            promptId: '',
            promptTitle: ''
        });
    }
}

function renderCommentsPromptContextBar() {
    const container = document.getElementById('commentsPromptContextBar');
    if (!container) {
        return;
    }

    const shouldShow = currentCommentView === 'gallery' && Boolean(String(filterState.promptId || '').trim());
    if (!shouldShow) {
        container.innerHTML = '';
        container.hidden = true;
        container.classList.add('comments-prompt-context--hidden');
        return;
    }

    const promptTitle = String(filterState.promptTitle || filterState.promptId || '').trim();
    container.hidden = false;
    container.classList.remove('comments-prompt-context--hidden');
    container.innerHTML = `
        <div class="comments-prompt-context__head">
            <div>
                <div class="comments-prompt-context__eyebrow">Prompt 评论上下文</div>
                <div class="comments-prompt-context__title">${escapeHtml(promptTitle)}</div>
                <div class="comments-prompt-context__meta">${escapeHtml(getCommentSiteLabel(getCommentsReadSite()))} · ID ${escapeHtml(filterState.promptId)}</div>
            </div>
            <div class="comments-prompt-context__actions">
                <button type="button" class="comments-prompt-context__btn" data-comments-action="open-prompt-gallery">
                    <i class="fas fa-palette"></i> Gallery
                </button>
                <button type="button" class="comments-prompt-context__btn comments-prompt-context__btn--primary" data-comments-action="open-prompt-homepage">
                    <i class="fas fa-house"></i> Homepage
                </button>
                <button type="button" class="comments-prompt-context__btn" data-comments-action="open-prompt-analytics">
                    <i class="fas fa-chart-line"></i> Analytics
                </button>
                <button type="button" class="comments-prompt-context__btn" data-comments-action="clear-prompt-context">
                    <i class="fas fa-xmark"></i> 清除上下文
                </button>
            </div>
        </div>
    `;
}

function ensureCommentsModuleActive(options = {}) {
    const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};

    if (window.AdminShell?.activateModule) {
        return window.AdminShell.activateModule('comments', {
            fallback: normalizedOptions.fallback === true,
            silentDenied: normalizedOptions.silentDenied,
            reason: normalizedOptions.reason || 'comments-ensure-module'
        });
    }

    const moduleSwitcher = typeof window.switchModule === 'function'
        ? window.switchModule
        : null;
    if (moduleSwitcher) {
        return moduleSwitcher('comments');
    }

    return false;
}

function openAdminPromptCommentContext(context = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const promptId = String(normalizedContext.promptId || normalizedContext.id || '').trim();
    if (!promptId) {
        return false;
    }

    filterState.date = 'all';
    filterState.dateFrom = null;
    filterState.dateTo = null;
    filterState.status = 'all';
    filterState.type = 'all';
    filterState.hasImage = false;
    filterState.currentSearchInput = '';
    filterState.searchTags = [];
    filterState.queue = 'pending';
    filterState.promptId = promptId;
    filterState.promptTitle = String(normalizedContext.promptTitle || normalizedContext.title || '').trim();
    pendingFocusedCommentId = String(normalizedContext.focusCommentId || '').trim();
    activeCommentQueue = 'pending';

    syncAdminCommentsFilterUi();
    syncAdminCommentsRouteState({
        view: 'gallery',
        queue: 'pending',
        promptId: filterState.promptId,
        promptTitle: filterState.promptTitle,
        focusCommentId: pendingFocusedCommentId
    }, {
        ensureCommentsModule: true
    });

    if (normalizedContext.ensureModule !== false) {
        const switched = ensureCommentsModuleActive({
            reason: 'comments-prompt-context'
        });
        if (switched === false) {
            return false;
        }
    }
    switchCommentView('gallery');
    return true;
}

function openAdminUserCommentContext(context = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const targetView = String(
        normalizedContext.view
        || normalizedContext.commentView
        || normalizedContext.comment_view
        || (String(normalizedContext.promptId || normalizedContext.prompt_id || '').trim() ? 'gallery' : 'guestbook')
    ).trim().toLowerCase() === 'gallery'
        ? 'gallery'
        : 'guestbook';
    const focusCommentId = String(
        normalizedContext.focusCommentId
        || normalizedContext.commentId
        || normalizedContext.comment_id
        || ''
    ).trim();
    const promptId = targetView === 'gallery'
        ? String(normalizedContext.promptId || normalizedContext.prompt_id || '').trim()
        : '';
    const promptTitle = targetView === 'gallery'
        ? String(normalizedContext.promptTitle || normalizedContext.prompt_title || '').trim()
        : '';
    const queue = String(normalizedContext.queue || '').trim().toLowerCase() || 'pending';
    const search = String(
        normalizedContext.search
        || normalizedContext.userId
        || normalizedContext.user_id
        || normalizedContext.email
        || focusCommentId
        || ''
    ).trim();

    filterState.date = 'all';
    filterState.dateFrom = null;
    filterState.dateTo = null;
    filterState.status = 'all';
    filterState.type = 'all';
    filterState.queue = queue;
    filterState.hasImage = false;
    filterState.currentSearchInput = search;
    filterState.searchTags = [];
    filterState.promptId = promptId;
    filterState.promptTitle = promptTitle;
    pendingFocusedCommentId = focusCommentId;
    activeCommentQueue = queue;

    syncAdminCommentsFilterUi();
    syncAdminCommentsRouteState({
        view: targetView,
        queue,
        promptId,
        promptTitle,
        focusCommentId
    }, {
        ensureCommentsModule: true
    });

    if (normalizedContext.ensureModule !== false) {
        const switched = ensureCommentsModuleActive({
            reason: 'comments-user-context'
        });
        if (switched === false) {
            return false;
        }
    }
    switchCommentView(targetView);
    return true;
}

function buildAdminCommentsPromptShellContext(action = 'open-prompt-gallery') {
    const promptId = String(filterState.promptId || '').trim();
    const promptTitle = String(filterState.promptTitle || '').trim();
    return {
        source: 'comments',
        entity: 'prompt',
        action,
        site: getCommentsReadSite(),
        focus: {
            promptId,
            prompt_id: promptId
        },
        payload: {
            view: currentCommentView,
            queue: activeCommentQueue || filterState.queue || 'pending',
            promptId,
            prompt_id: promptId,
            promptTitle,
            prompt_title: promptTitle,
            sectionId: action === 'open-prompt-analytics' ? 'contentCommerceDetailSection' : '',
            focusTargetId: action === 'open-prompt-analytics' ? 'contentCommerceDetailSection' : ''
        },
        returnTo: {
            module: 'comments',
            view: currentCommentView,
            promptId,
            promptTitle
        }
    };
}

async function openAdminCommentsPromptGalleryContext() {
    const promptId = String(filterState.promptId || '').trim();
    if (!promptId) {
        return false;
    }

    const promptContext = buildAdminCommentsPromptShellContext('open-prompt-gallery');

    if (window.AdminShell?.openContext) {
        const opened = await window.AdminShell.openContext('gallery', promptContext, {
            settleMs: 0,
            silentDenied: true
        });
        if (opened) {
            return true;
        }
    }

    if (typeof window.openAdminGalleryShellContext === 'function') {
        try {
            return await window.openAdminGalleryShellContext(promptContext);
        } catch (error) {
            console.warn('[Comments] Failed to open gallery prompt context through shared helper:', error);
        }
    }

    return window.openAdminGalleryPromptContext?.(promptId, { ensureModule: true }) === true;
}

async function openAdminCommentsPromptHomepageContext() {
    const promptId = String(filterState.promptId || '').trim();
    if (!promptId) {
        return false;
    }

    const promptContext = buildAdminCommentsPromptShellContext('open-prompt-homepage');

    if (window.AdminShell?.openContext) {
        const opened = await window.AdminShell.openContext('homepage', promptContext, {
            settleMs: 0,
            silentDenied: true
        });
        if (opened) {
            return true;
        }
    }

    if (typeof window.openAdminHomepageShellContext === 'function') {
        try {
            return await window.openAdminHomepageShellContext(promptContext);
        } catch (error) {
            console.warn('[Comments] Failed to open homepage prompt context through shared helper:', error);
        }
    }

    return window.HomepageAdmin?.openPromptSectionContext?.(promptId, { ensureModule: true }) === true;
}

async function openAdminCommentsPromptAnalyticsContext() {
    const promptId = String(filterState.promptId || '').trim();
    if (!promptId) {
        return false;
    }

    const promptContext = buildAdminCommentsPromptShellContext('open-prompt-analytics');

    if (window.AdminShell?.openContext) {
        const opened = await window.AdminShell.openContext('growth-center', promptContext, {
            settleMs: 0,
            silentDenied: true,
            switchOptions: {
                analyticsTab: 'content',
                analyticsPromptId: promptId
            }
        });
        if (opened) {
            return true;
        }
    }

    if (typeof window.openAdminGrowthCenterShellContext === 'function') {
        try {
            return await window.openAdminGrowthCenterShellContext(promptContext, {
                switchOptions: {
                    analyticsTab: 'content',
                    analyticsPromptId: promptId
                }
            });
        } catch (error) {
            console.warn('[Comments] Failed to open growth center prompt context through shared helper:', error);
        }
    }

    const switched = window.switchModule?.('growth-center', {
        analyticsTab: 'content',
        analyticsPromptId: promptId
    });
    return switched !== false;
}

function restoreAdminCommentsRouteContext() {
    const routeState = getAdminCommentsRouteState();
    filterState.queue = routeState.queue || 'pending';
    filterState.promptId = routeState.view === 'gallery' ? routeState.promptId : '';
    filterState.promptTitle = routeState.view === 'gallery' ? routeState.promptTitle : '';
    pendingFocusedCommentId = routeState.focusCommentId || pendingFocusedCommentId;
    currentCommentView = routeState.view;
    activeCommentQueue = filterState.queue;
    window.currentCommentView = currentCommentView;
    return routeState;
}

function getCommentBlockRows(comment) {
    const state = comment?.user_block_state && typeof comment.user_block_state === 'object'
        ? comment.user_block_state
        : {};
    return Array.isArray(state.blocks) ? state.blocks : [];
}

function buildCommentBlockDescriptor(scope = '', block = null) {
    const normalizedScope = String(scope || '').trim().toLowerCase();
    if (!normalizedScope) {
        return {
            blocked: false,
            label: '',
            kind: '',
            temporary: false
        };
    }

    const scopeLabel = normalizedScope === 'all'
        ? '全站'
        : (normalizedScope === 'guestbook' ? '留言板' : '画廊');

    return {
        blocked: true,
        label: block?.expires_at ? `${scopeLabel}临时封禁` : `${scopeLabel}封禁`,
        kind: normalizedScope === 'all' ? 'global' : normalizedScope,
        temporary: Boolean(block?.expires_at)
    };
}

function getCommentAnyScopeBlockState(comment) {
    const state = comment?.user_block_state && typeof comment.user_block_state === 'object'
        ? comment.user_block_state
        : {};
    const blockRows = getCommentBlockRows(comment);
    const rowByScope = new Map(
        blockRows
            .map((row) => [String(row?.scope || '').trim().toLowerCase(), row])
            .filter(([scope]) => Boolean(scope))
    );

    if (rowByScope.has('all') || state.hasGlobalBlock === true) {
        return buildCommentBlockDescriptor('all', rowByScope.get('all'));
    }

    if (rowByScope.has('guestbook') || state.isGuestbookBlocked === true) {
        return buildCommentBlockDescriptor('guestbook', rowByScope.get('guestbook'));
    }

    if (rowByScope.has('gallery') || state.isGalleryBlocked === true) {
        return buildCommentBlockDescriptor('gallery', rowByScope.get('gallery'));
    }

    return buildCommentBlockDescriptor('', null);
}

function getCommentCurrentScopeBlockState(comment) {
    const state = comment?.user_block_state && typeof comment.user_block_state === 'object'
        ? comment.user_block_state
        : {};
    const blockRows = getCommentBlockRows(comment);
    const rowByScope = new Map(
        blockRows
            .map((row) => [String(row?.scope || '').trim().toLowerCase(), row])
            .filter(([scope]) => Boolean(scope))
    );
    const commentType = comment?.type === 'gallery' ? 'gallery' : 'guestbook';

    if (rowByScope.has('all') || state.hasGlobalBlock === true) {
        return buildCommentBlockDescriptor('all', rowByScope.get('all'));
    }

    if (commentType === 'guestbook' && (rowByScope.has('guestbook') || state.isGuestbookBlocked === true)) {
        return buildCommentBlockDescriptor('guestbook', rowByScope.get('guestbook'));
    }

    if (commentType === 'gallery' && (rowByScope.has('gallery') || state.isGalleryBlocked === true)) {
        return buildCommentBlockDescriptor('gallery', rowByScope.get('gallery'));
    }

    return buildCommentBlockDescriptor('', null);
}

function buildCommentUserBlockBadge(comment) {
    const blockState = getCommentCurrentScopeBlockState(comment);
    if (!blockState.blocked) {
        return '';
    }

    return `<span class="comment-block-badge comment-block-badge--${blockState.kind}">${escapeHtml(blockState.label)}</span>`;
}

/**
 * Initialize Comments Module
 */
function initCommentsModule() {
    console.log('Initializing Comments Module...');
    const routeState = restoreAdminCommentsRouteContext();

    // Check if supabase is available
    if (!getSupabase()) {
        console.error('Supabase client not available!');
        document.getElementById('adminCommentList').innerHTML =
            '<p class="error-text">数据库连接失败，请刷新页面重试</p>';
        return;
    }

    // Prevent double initialization
    if (commentsInitialized) {
        console.log('Comments module already initialized');
        commentsSkipNextActivateReload = true;
        switchLayoutView(currentViewLayout, { loadIfNeeded: false });
        syncAdminCommentsFilterUi();
        syncCommentsSelectModeUi();
        loadComments(routeState.view || currentCommentView, {
            resetPage: true,
            focusCommentId: routeState.focusCommentId || pendingFocusedCommentId
        });
        scheduleCommentStatsRefresh(routeState.view || currentCommentView, { showLoading: true });
        return;
    }
    commentsInitialized = true;
    commentsSkipNextActivateReload = true;
    currentCommentView = routeState.view || currentCommentView;
    window.currentCommentView = currentCommentView;

    switchLayoutView(currentViewLayout, { loadIfNeeded: false });
    syncAdminCommentsFilterUi();
    syncCommentsSelectModeUi(0);
    loadComments(currentCommentView, { resetPage: true });
    scheduleCommentStatsRefresh(currentCommentView, { showLoading: true });
    setupCommentEventHandlers();
}

function activateCommentsModule() {
    switchLayoutView(currentViewLayout, { loadIfNeeded: false });
    if (!commentsInitialized) {
        return;
    }

    syncAdminCommentsFilterUi();
    syncCommentsSelectModeUi();

    if (commentsSkipNextActivateReload) {
        commentsSkipNextActivateReload = false;
        return;
    }

    loadComments(currentCommentView, {
        resetPage: true,
        preserveSelection: true,
        focusCommentId: pendingFocusedCommentId
    });
    scheduleCommentStatsRefresh(currentCommentView, { showLoading: true });
}

/**
 * Setup event handlers
 */
function setupCommentEventHandlers() {
    // Setup filter dropdowns
    setupFilterDropdowns();
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeCommentDetailDrawer();
        }
    });
}

/**
 * Setup filter dropdown interactions
 */
function setupFilterDropdowns() {
    // Toggle dropdown on button click
    document.querySelectorAll('.filter-dropdown .filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = btn.closest('.filter-dropdown');

            // Close other dropdowns
            document.querySelectorAll('.filter-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });

            // Toggle this dropdown
            dropdown.classList.toggle('open');
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-dropdown')) {
            document.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
        }
    });

    // Handle filter option selection
    document.querySelectorAll('.filter-popup .filter-option').forEach(option => {
        option.addEventListener('click', () => {
            const dropdown = option.closest('.filter-dropdown');
            const filterType = dropdown.dataset.filter;

            // Skip action dropdowns (like Export)
            if (filterType === 'export') return;

            const value = option.dataset.value;

            // Update selection UI
            dropdown.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');

            // Update filter state
            updateFilterState(filterType, value);

            // Update button label and active state
            const btn = dropdown.querySelector('.filter-btn');
            const label = dropdown.querySelector('.filter-label');
            if (value !== 'all') {
                btn.classList.add('active');
                label.textContent = option.textContent;
            } else {
                btn.classList.remove('active');
                label.textContent = getDefaultLabel(filterType);
            }

            // Close dropdown and reload
            dropdown.classList.remove('open');
            loadComments(currentCommentView, { resetPage: true });
        });
    });

    // Expose export function globally
    window.exportData = exportData;

    // Handle hasImage checkbox
    const hasImageCheckbox = document.getElementById('filterHasImage');
    if (hasImageCheckbox) {
        hasImageCheckbox.addEventListener('change', () => {
            filterState.hasImage = hasImageCheckbox.checked;
            loadComments(currentCommentView, { resetPage: true });
        });
    }

    // Handle user search (Enter key to add tag, Input for live search)
    const userSearchInput = document.getElementById('commentSearch');
    if (userSearchInput) {
        // Enter key -> Create Tag
        userSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = e.target.value.trim();
                if (val && !filterState.searchTags.includes(val)) {
                    filterState.searchTags.push(val);
                    filterState.currentSearchInput = ''; // Clear live input state
                    e.target.value = ''; // Clear input UI
                    loadComments(currentCommentView, { resetPage: true });
                }
            }
        });

        // Input -> Live Search
        let timeout;
        userSearchInput.addEventListener('input', (e) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                filterState.currentSearchInput = e.target.value.trim();
                loadComments(currentCommentView, { resetPage: true });
            }, 300);
        });
    }

    // Handle custom date range inputs with Flatpickr
    const dateFromInput = document.getElementById('filterDateFrom');
    const dateToInput = document.getElementById('filterDateTo');

    const applyCustomDateRange = () => {
        if (dateFromInput.value || dateToInput.value) {
            filterState.date = 'custom';
            // Flatpickr value is already properly formatted if configured correctly
            filterState.dateFrom = dateFromInput.value || null;
            filterState.dateTo = dateToInput.value || null;

            // Update date filter button to show active state
            const dateDropdown = document.querySelector('[data-filter="date"]');
            const dateBtn = dateDropdown?.querySelector('.filter-btn');
            const dateLabel = dateDropdown?.querySelector('.filter-label');
            if (dateBtn) dateBtn.classList.add('active');
            if (dateLabel) dateLabel.textContent = '自定义';

            // Clear preset selections
            dateDropdown?.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));

            loadComments(currentCommentView, { resetPage: true });
        }
    };

    // Initialize Flatpickr
    const flatpickrConfig = {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        theme: "dark",
        locale: "zh",
        onChange: function (selectedDates, dateStr, instance) {
            applyCustomDateRange();
        }
    };

    // Check if flatpickr is loaded, if not wait a bit
    const initFlatpickr = async () => {
        if (!window.flatpickr && typeof window.ensureAdminFlatpickr === 'function') {
            try {
                await window.ensureAdminFlatpickr();
            } catch (error) {
                console.error('[AdminComments] Failed to load Flatpickr runtime:', error);
                return;
            }
        }

        if (window.flatpickr) {
            if (dateFromInput) flatpickr(dateFromInput, flatpickrConfig);
            if (dateToInput) flatpickr(dateToInput, flatpickrConfig);
        }
    };

    initFlatpickr();
}

/**
 * Update filter state
 */
function updateFilterState(filterType, value) {
    switch (filterType) {
        case 'date':
            filterState.date = value;
            break;
        case 'status':
            filterState.status = value;
            break;
        case 'type':
            filterState.type = value;
            break;
        case 'source':
            filterState.source = value;
            break;
    }
}

function getCommentFilterOptionLabel(filterType, value) {
    const normalizedType = String(filterType || '').trim().toLowerCase();
    const normalizedValue = String(value || '').trim().toLowerCase();
    const labels = {
        date: {
            all: '日期',
            today: '今天',
            week: '本周',
            month: '本月',
            custom: '自定义'
        },
        status: {
            all: '回复',
            replied: '有回复',
            unreplied: '无回复'
        },
        type: {
            all: '层级',
            top: '主评论',
            reply: '子回复'
        }
    };

    return labels[normalizedType]?.[normalizedValue] || getDefaultLabel(normalizedType);
}

function syncCommentQueueUi() {
    document.querySelectorAll('.comment-queue-btn').forEach((button) => {
        const queue = String(button.dataset.commentsQueue || 'pending').trim().toLowerCase() || 'pending';
        button.classList.toggle('active', queue === (filterState.queue || 'pending'));
    });
}

function syncAdminCommentsFilterUi() {
    const searchInput = document.getElementById('commentSearch');
    if (searchInput) {
        searchInput.value = filterState.currentSearchInput || '';
    }

    const hasImageCheckbox = document.getElementById('filterHasImage');
    if (hasImageCheckbox) {
        hasImageCheckbox.checked = filterState.hasImage === true;
    }

    ['date', 'status', 'type'].forEach((filterType) => {
        const dropdown = document.querySelector(`.filter-dropdown[data-filter="${filterType}"]`);
        if (!dropdown) return;

        const currentValue = String(filterState[filterType] || 'all');
        dropdown.querySelectorAll('.filter-option').forEach((option) => {
            option.classList.toggle('selected', String(option.dataset.value || '') === currentValue);
        });

        const btn = dropdown.querySelector('.filter-btn');
        const label = dropdown.querySelector('.filter-label');
        const isActive = currentValue !== 'all';
        if (btn) {
            btn.classList.toggle('active', isActive);
        }
        if (label) {
            label.textContent = getCommentFilterOptionLabel(filterType, currentValue);
        }
    });

    const dateFromInput = document.getElementById('filterDateFrom');
    const dateToInput = document.getElementById('filterDateTo');
    if (dateFromInput) {
        dateFromInput.value = filterState.date === 'custom' ? (filterState.dateFrom || '') : '';
    }
    if (dateToInput) {
        dateToInput.value = filterState.date === 'custom' ? (filterState.dateTo || '') : '';
    }

    syncCommentQueueUi();
    renderCommentsPromptContextBar();
    renderFilterTags();
}

function openAnalyticsCommentContext(context = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const targetView = String(normalizedContext.view || 'guestbook').trim().toLowerCase() === 'gallery' ? 'gallery' : 'guestbook';
    const focusCommentId = String(
        normalizedContext.focusCommentId
        || normalizedContext.commentId
        || normalizedContext.targetId
        || ''
    ).trim();
    const status = ['all', 'replied', 'unreplied'].includes(String(normalizedContext.status || '').trim().toLowerCase())
        ? String(normalizedContext.status || '').trim().toLowerCase()
        : 'all';
    const type = ['all', 'top', 'reply'].includes(String(normalizedContext.type || '').trim().toLowerCase())
        ? String(normalizedContext.type || '').trim().toLowerCase()
        : 'all';
    const queue = String(normalizedContext.queue || '').trim().toLowerCase() || 'pending';

    filterState.date = 'all';
    filterState.dateFrom = null;
    filterState.dateTo = null;
    filterState.status = status;
    filterState.type = type;
    filterState.queue = queue;
    filterState.hasImage = normalizedContext.hasImage === true;
    filterState.currentSearchInput = String(normalizedContext.search || normalizedContext.searchTerm || '').trim();
    filterState.searchTags = [];
    filterState.promptId = '';
    filterState.promptTitle = '';
    pendingFocusedCommentId = focusCommentId;
    activeCommentQueue = queue;

    syncAdminCommentsFilterUi();
    syncAdminCommentsRouteState({
        view: targetView,
        queue,
        promptId: '',
        promptTitle: '',
        focusCommentId
    }, {
        ensureCommentsModule: true
    });
    switchCommentView(targetView);
}

/**
 * Get default label for filter type
 */
function getDefaultLabel(filterType) {
    const labels = {
        date: '日期',
        user: '用户',
        status: '状态',
        type: '类型',
        source: '来源',
        queue: '队列'
    };
    return labels[filterType] || filterType;
}

function getCommentReplyCount(comment) {
    return Math.max(0, Number(comment?.reply_count || 0));
}

function isReplyLevelComment(comment) {
    return String(comment?.level || '').trim() === 'reply';
}

function getCommentWorkflow(comment) {
    return comment?.workflow && typeof comment.workflow === 'object' && !Array.isArray(comment.workflow)
        ? comment.workflow
        : {
            status: 'pending',
            priority: 'normal',
            tags: [],
            note_count: 0,
            linked_ticket_count: 0,
            linked_ticket_ids: [],
            linked_ticket_summary: {
                total_count: 0,
                active_count: 0,
                closed_count: 0,
                resolved_count: 0,
                rejected_count: 0
            },
            assignee_id: '',
            assignee_label: '',
            exists: false
        };
}

function getCommentTicketPillMeta(comment) {
    const workflow = getCommentWorkflow(comment);
    const linkedTicketCount = Math.max(0, Number(workflow.linked_ticket_count || 0));
    if (linkedTicketCount <= 0) {
        return null;
    }

    const workflowStatus = String(workflow.status || '').trim().toLowerCase();
    if (workflowStatus === 'escalated') {
        return {
            label: '已升级工单',
            tone: 'active'
        };
    }

    if (workflowStatus === 'resolved' || workflowStatus === 'ignored') {
        return {
            label: '工单已处理',
            tone: 'resolved'
        };
    }

    return {
        label: '有关联工单',
        tone: 'history'
    };
}

function getCommentWorkflowStatusMeta(status) {
    const normalized = String(status || '').trim().toLowerCase();
    const map = {
        pending: { label: '待处理', tone: 'pending' },
        in_review: { label: '复核中', tone: 'review' },
        escalated: { label: '已升级', tone: 'escalated' },
        resolved: { label: '已解决', tone: 'resolved' },
        ignored: { label: '已忽略', tone: 'muted' }
    };
    return map[normalized] || map.pending;
}

function getCommentSiteLabel(site) {
    return String(site || '').trim().toLowerCase() === 'intl' ? 'INTL' : 'CN';
}

function normalizeCommentAvatarUrl(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }

    const lowerCased = normalized.toLowerCase();
    if (lowerCased === 'null' || lowerCased === 'undefined') {
        return '';
    }

    return normalized;
}

function buildCommentAvatarMarkup(comment = {}) {
    const avatarInitial = (comment.author || '?').charAt(0).toUpperCase();
    const avatarFallback = `<span class="item-avatar-fallback" aria-hidden="true">${escapeHtml(avatarInitial)}</span>`;
    const avatarUrl = normalizeCommentAvatarUrl(comment.avatar);

    if (!avatarUrl) {
        return {
            avatarClassName: 'item-avatar',
            avatarMarkup: avatarFallback
        };
    }

    return {
        avatarClassName: 'item-avatar item-avatar--image',
        avatarMarkup: `${avatarFallback}<img class="item-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(comment.author || '用户')} 头像" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-comment-avatar="1">`
    };
}

function applyCommentAvatarFallback(imageEl) {
    if (!(imageEl instanceof HTMLImageElement)) {
        return;
    }

    const wrapper = imageEl.closest('.item-avatar');
    if (!wrapper) {
        return;
    }

    wrapper.classList.add('item-avatar--fallback');
    imageEl.setAttribute('aria-hidden', 'true');
    imageEl.dataset.avatarFailed = '1';
}

function getCommentUserRiskMeta(comment) {
    if (getCommentAnyScopeBlockState(comment).blocked) {
        return {
            label: '封禁中',
            tone: 'blocked'
        };
    }

    const workflow = getCommentWorkflow(comment);
    const workflowStatus = String(workflow.status || '').trim().toLowerCase();
    if (isHighRiskComment(comment) || workflowStatus === 'escalated' || workflowStatus === 'in_review') {
        return {
            label: '需关注',
            tone: 'watch'
        };
    }

    if (workflowStatus === 'resolved' || workflowStatus === 'ignored') {
        return {
            label: '正常',
            tone: 'normal'
        };
    }

    const summary = comment?.user_summary && typeof comment.user_summary === 'object'
        ? comment.user_summary
        : {};
    const riskLevel = String(summary.risk_level || '').trim().toLowerCase();
    if (riskLevel === 'watch') {
        return {
            label: '需关注',
            tone: 'watch'
        };
    }

    return {
        label: '正常',
        tone: 'normal'
    };
}

function getCommentUserRiskLabel(comment) {
    return getCommentUserRiskMeta(comment).label;
}

function isBlockedComment(comment) {
    const state = comment?.user_block_state && typeof comment.user_block_state === 'object'
        ? comment.user_block_state
        : {};
    if (state.hasGlobalBlock === true) {
        return true;
    }
    if (comment?.type === 'gallery') {
        return state.isGalleryBlocked === true;
    }
    return state.isGuestbookBlocked === true;
}

function isHighRiskComment(comment) {
    const workflow = getCommentWorkflow(comment);
    const tags = Array.isArray(workflow.tags) ? workflow.tags : [];
    return isBlockedComment(comment)
        || String(workflow.priority || '').trim().toLowerCase() === 'high'
        || tags.some((tag) => ['risk', 'high_risk', 'spam', 'abuse'].includes(String(tag || '').toLowerCase()));
}

function matchesCommentQueue(comment, queue) {
    const normalizedQueue = String(queue || '').trim().toLowerCase() || 'pending';
    const workflow = getCommentWorkflow(comment);

    if (normalizedQueue === 'pending') {
        const workflowStatus = String(workflow.status || '').trim().toLowerCase();
        return workflowStatus !== 'resolved' && workflowStatus !== 'ignored';
    }
    if (normalizedQueue === 'guestbook_unreplied') {
        return comment?.type === 'guestbook'
            && comment?.record_type === 'message'
            && getCommentReplyCount(comment) <= 0;
    }
    if (normalizedQueue === 'high_risk') {
        return isHighRiskComment(comment);
    }
    if (normalizedQueue === 'blocked_user') {
        return isBlockedComment(comment);
    }
    if (normalizedQueue === 'escalated') {
        return String(workflow.status || '').trim().toLowerCase() === 'escalated';
    }
    return true;
}

function getCommentContextTitle(comment) {
    return String(comment?.context_title || comment?.prompt_title || '').trim();
}

function getCommentEntityLabel(comment) {
    return String(comment?.entity_label || '').trim()
        || (comment?.type === 'gallery' ? '画廊评论' : '留言内容');
}

function getCommentSummaryMetricText(comment) {
    const likeCount = Number(comment?.like_count ?? comment?.likes ?? 0) || 0;
    const replyCount = Number(comment?.reply_count || 0) || 0;
    return `赞 ${likeCount} · 回复 ${replyCount}`;
}

function getCommentPreviewSnippet(comment = {}) {
    const currentContent = String(comment?.content || '').trim();
    const parentSnippet = String(comment?.parent_snippet || '').trim();
    const rootSnippet = String(comment?.root_snippet || '').trim();

    if (parentSnippet && parentSnippet !== currentContent) {
        return parentSnippet;
    }

    if (
        String(comment?.record_type || '').trim().toLowerCase() !== 'message'
        && rootSnippet
        && rootSnippet !== currentContent
        && rootSnippet !== parentSnippet
    ) {
        return rootSnippet;
    }

    return '';
}

/**
 * Apply filters to comments array
 */
function applyFilters(comments) {
    return comments.filter(comment => {
        if (filterState.promptId && String(comment.context || '').trim() !== String(filterState.promptId).trim()) {
            return false;
        }

        if (!matchesCommentQueue(comment, filterState.queue)) {
            return false;
        }

        // Date filter
        if (filterState.date !== 'all') {
            const commentDate = new Date(comment.created_at);
            const now = new Date();

            if (filterState.date === 'today') {
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                if (commentDate < todayStart) return false;
            } else if (filterState.date === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                if (commentDate < weekAgo) return false;
            } else if (filterState.date === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                if (commentDate < monthAgo) return false;
            } else if (filterState.date === 'custom') {
                // Custom date range (datetime-local gives minute precision)
                if (filterState.dateFrom) {
                    const fromDate = new Date(filterState.dateFrom);
                    if (commentDate < fromDate) return false;
                }
                if (filterState.dateTo) {
                    const toDate = new Date(filterState.dateTo);
                    if (commentDate > toDate) return false;
                }
            }
        }

        // Search filter (Accumulative tags AND Live Input - AND logic)
        // 1. Check Tags
        if (filterState.searchTags.length > 0) {
            const matchesTags = filterState.searchTags.every(tag => {
                const searchTerm = tag.toLowerCase();
                const matchesContent = comment.content.toLowerCase().includes(searchTerm);
                const matchesAuthor = comment.author.toLowerCase().includes(searchTerm);
                const matchesPrompt = comment.prompt_title && comment.prompt_title.toLowerCase().includes(searchTerm);
                const matchesPromptId = comment.context && String(comment.context).toLowerCase().includes(searchTerm);
                const matchesId = comment.id && comment.id.toLowerCase().includes(searchTerm);
                const matchesParentId = comment.parent_id && String(comment.parent_id).toLowerCase().includes(searchTerm);
                return matchesContent || matchesAuthor || matchesPrompt || matchesPromptId || matchesId || matchesParentId;
            });
            if (!matchesTags) return false;
        }

        // 2. Check Live Input
        if (filterState.currentSearchInput) {
            const searchTerm = filterState.currentSearchInput.toLowerCase();

            // Special keyword: "置顶" filters pinned comments only
            if (searchTerm === '置顶' || searchTerm === 'pinned') {
                if (!comment.is_pinned) return false;
            } else {
                const matchesContent = comment.content.toLowerCase().includes(searchTerm);
                const matchesAuthor = comment.author.toLowerCase().includes(searchTerm);
                const matchesPrompt = comment.prompt_title && comment.prompt_title.toLowerCase().includes(searchTerm);
                const matchesPromptId = comment.context && String(comment.context).toLowerCase().includes(searchTerm);
                const matchesId = comment.id && comment.id.toLowerCase().includes(searchTerm);
                const matchesParentId = comment.parent_id && String(comment.parent_id).toLowerCase().includes(searchTerm);

                if (!matchesContent && !matchesAuthor && !matchesPrompt && !matchesPromptId && !matchesId && !matchesParentId) return false;
            }
        }

        // Status filter
        const replyCount = getCommentReplyCount(comment);
        if (filterState.status === 'replied' && replyCount <= 0) return false;
        if (filterState.status === 'unreplied' && replyCount > 0) return false;

        // Type filter
        if (filterState.type === 'top' && isReplyLevelComment(comment)) return false;
        if (filterState.type === 'reply' && !isReplyLevelComment(comment)) return false;

        // Has image filter
        if (filterState.hasImage && !comment.image_url) return false;

        // Source filter is handled during fetch, but double-check here
        if (filterState.source !== 'all' && comment.type !== filterState.source) return false;

        return true;
    });
}

function updateCommentQueueCounts(summary = {}) {
    const queueCounts = summary?.queueCounts && typeof summary.queueCounts === 'object'
        ? summary.queueCounts
        : {};
    const totalFeedback = Number(summary?.totalFeedback || summary?.totalCount || 0);
    const pendingCount = Number(summary?.openGovernanceCount || queueCounts.pending || 0);
    const countsById = {
        commentQueueCountAll: totalFeedback,
        commentQueueCountPending: pendingCount,
        commentQueueCountGuestbookUnreplied: Number(queueCounts.guestbook_unreplied || 0),
        commentQueueCountHighRisk: Number(queueCounts.high_risk || 0),
        commentQueueCountBlockedUser: Number(queueCounts.blocked_user || 0),
        commentQueueCountEscalated: Number(queueCounts.escalated || 0)
    };

    Object.entries(countsById).forEach(([id, value]) => {
        const node = document.getElementById(id);
        if (node) {
            node.textContent = String(Math.max(0, value));
        }
    });
}

function applyCommentStatsSummary(summary = {}) {
    commentsSummaryState = summary && typeof summary === 'object' ? summary : {};
    const totalCount = Number(summary?.totalFeedback || summary?.totalCount || 0);
    const todayCount = Number(summary?.todayFeedbackCount || summary?.todayCount || 0);
    const activeUsersCount = Number(summary?.activeUsers7d || summary?.activeUsersCount || 0);
    const weekGrowth = Number(summary?.weekGrowth || 0);

    document.getElementById('totalCommentsCount').textContent = totalCount;
    document.getElementById('todayCommentsCount').textContent = todayCount;
    document.getElementById('activeUsersCount').textContent = activeUsersCount;
    document.getElementById('weekGrowth').textContent =
        weekGrowth >= 0 ? `+${weekGrowth}%` : `${weekGrowth}%`;
    updateCommentQueueCounts(summary || {});
}

function setCommentStatsLoadingState() {
    ['totalCommentsCount', 'todayCommentsCount', 'activeUsersCount', 'weekGrowth'].forEach((id) => {
        const node = document.getElementById(id);
        if (node) {
            node.textContent = '...';
        }
    });

    [
        'commentQueueCountAll',
        'commentQueueCountPending',
        'commentQueueCountGuestbookUnreplied',
        'commentQueueCountHighRisk',
        'commentQueueCountBlockedUser',
        'commentQueueCountEscalated'
    ].forEach((id) => {
        const node = document.getElementById(id);
        if (node) {
            node.textContent = '...';
        }
    });
}

/**
 * Load comment statistics
 */
async function loadCommentStats(view = currentCommentView, options = {}) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    const site = getCommentsReadSite();
    const requestVersion = ++commentsSummaryRequestVersion;
    const cachedPayload = getCommentsCachedSummary(normalizedView, site);

    if (cachedPayload?.summary) {
        applyCommentStatsSummary(cachedPayload.summary);
    } else if (options?.showLoading !== false) {
        setCommentStatsLoadingState();
    }

    try {
        const payload = await fetchAdminCommentSummary(site, normalizedView);
        storeCommentsCachedSummary(normalizedView, site, payload);

        if (requestVersion !== commentsSummaryRequestVersion || !isCurrentCommentsSite(site)) {
            return payload;
        }

        applyCommentStatsSummary(payload?.summary || {});

    } catch (error) {
        if (requestVersion !== commentsSummaryRequestVersion || !isCurrentCommentsSite(site)) {
            return null;
        }
        console.error('Error loading comment stats:', error);
    }

    return cachedPayload;
}

function scheduleCommentStatsRefresh(view = currentCommentView, options = {}) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    const delayMs = Math.max(0, Number(options?.delayMs) || 0);
    const showLoading = options?.showLoading === true;

    window.setTimeout(() => {
        if (!isCommentsModuleActive()) {
            return;
        }
        void loadCommentStats(normalizedView, { showLoading });
    }, delayMs);
}

/**
 * Switch comment view (guestbook/gallery)
 */
function switchCommentView(view) {
    currentCommentView = view;
    window.currentCommentView = view;
    if (view === 'gallery' && filterState.queue === 'guestbook_unreplied') {
        filterState.queue = 'pending';
        activeCommentQueue = 'pending';
    }
    syncCommentQueueUi();

    // Update tab active state
    document.querySelectorAll('[data-comment-view]').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-comment-view="${view}"]`)?.classList.add('active');

    loadComments(view, { resetPage: true });
    scheduleCommentStatsRefresh(view, { showLoading: true });
}

/**
 * Render active filter tags
 */
function renderFilterTags() {
    const container = document.getElementById('activeFilterTags');
    if (!container) return;

    let tagsHtml = '';

    // Date Filter
    if (filterState.date !== 'all') {
        let label = '时间';
        let value = '';
        if (filterState.date === 'today') value = '今天';
        else if (filterState.date === 'week') value = '本周';
        else if (filterState.date === 'month') value = '本月';
        else if (filterState.date === 'custom') {
            const start = filterState.dateFrom ? filterState.dateFrom.split(' ')[0] : '...';
            const end = filterState.dateTo ? filterState.dateTo.split(' ')[0] : '...';
            value = `${start} - ${end}`;
        }
        tagsHtml += createTagHtml('date', label, value);
    }

    // Status Filter
    if (filterState.status !== 'all') {
        const value = filterState.status === 'replied' ? '已回复' : '未回复';
        tagsHtml += createTagHtml('status', '状态', value);
    }

    // Type Filter
    if (filterState.type !== 'all') {
        const value = filterState.type === 'top' ? '主评论' : '子回复';
        tagsHtml += createTagHtml('type', '层级', value);
    }

    // Has Image
    if (filterState.hasImage) {
        tagsHtml += createTagHtml('hasImage', '包含', '图片');
    }

    if (filterState.queue && filterState.queue !== 'all') {
        const queueLabels = {
            all: '全部',
            pending: '待处理',
            guestbook_unreplied: '未回复留言',
            high_risk: '高风险评论',
            blocked_user: '已封禁用户内容',
            escalated: '已升级工单评论'
        };
        tagsHtml += createTagHtml('queue', '队列', queueLabels[filterState.queue] || filterState.queue);
    }

    if (filterState.promptId) {
        tagsHtml += createTagHtml(
            'prompt',
            'Prompt',
            filterState.promptTitle || filterState.promptId,
            filterState.promptId
        );
    }

    // User Search Tags
    if (filterState.searchTags && filterState.searchTags.length > 0) {
        filterState.searchTags.forEach(tag => {
            tagsHtml += createTagHtml('searchTag', '搜索', tag, tag); // Pass value as ID for removal
        });
    }

    container.innerHTML = tagsHtml;
}

function createTagHtml(type, label, value, idValue) {
    // idValue is optional, defaults to value
    const removeId = idValue || type;

    return `
        <div class="filter-tag">
            <span class="filter-tag-label">${label}:</span>
            <span class="filter-tag-value">${value}</span>
            <span class="filter-tag-close" data-comments-action="remove-filter" data-filter-type="${escapeHtml(type)}" data-filter-id="${encodeURIComponent(String(removeId))}">
                <i class="fas fa-times"></i>
            </span>
        </div>
    `;
}

/**
 * Remove a specific filter
 */
window.removeFilter = function (type, id) {
    if (type === 'date') {
        filterState.date = 'all';
        filterState.dateFrom = null;
        filterState.dateTo = null;
        // Reset inputs
        document.getElementById('filterDateFrom').value = '';
        document.getElementById('filterDateTo').value = '';
        updateDropdownUI('date', 'all');
    } else if (type === 'status') {
        filterState.status = 'all';
        updateDropdownUI('status', 'all');
    } else if (type === 'type') {
        filterState.type = 'all';
        updateDropdownUI('type', 'all');
    } else if (type === 'user') {
        filterState.user = ''; // Keep for backward compatibility if needed, though unused
        // document.getElementById('commentSearch').value = ''; // Don't clear input when removing tag? Maybe unnecessary.
        // Actually, logic is: 'user' type removed -> clear input?
        // Wait, 'user' type is legacy. The new type is 'searchTag'. 
        // But let's keep this safe just in case.
        const input = document.getElementById('commentSearch');
        if (input) input.value = ''; false;
    } else if (type === 'searchTag') {
        // Remove specific tag from array
        filterState.searchTags = filterState.searchTags.filter(t => t !== id);
    } else if (type === 'queue') {
        filterState.queue = 'all';
        activeCommentQueue = 'all';
        syncCommentQueueUi();
    } else if (type === 'prompt') {
        filterState.promptId = '';
        filterState.promptTitle = '';
    }

    loadComments(currentCommentView, { resetPage: true });
};

function updateDropdownUI(filterType, value) {
    const dropdown = document.querySelector(`.filter-dropdown[data-filter="${filterType}"]`);
    if (!dropdown) return;

    // Reset selection classes
    dropdown.querySelectorAll('.filter-option').forEach(o => o.classList.remove('selected'));
    const defaultOption = dropdown.querySelector(`.filter-option[data-value="${value}"]`);
    if (defaultOption) defaultOption.classList.add('selected');

    // Reset button text
    const btn = dropdown.querySelector('.filter-btn');
    const label = dropdown.querySelector('.filter-label');
    if (btn) btn.classList.remove('active');
    if (label) label.textContent = getDefaultLabel(filterType);
}

function normalizeCommentsPage(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCommentsDateRange() {
    const now = new Date();

    if (filterState.date === 'today') {
        return {
            dateFrom: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
            dateTo: ''
        };
    }

    if (filterState.date === 'week') {
        return {
            dateFrom: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            dateTo: ''
        };
    }

    if (filterState.date === 'month') {
        return {
            dateFrom: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            dateTo: ''
        };
    }

    if (filterState.date === 'custom') {
        return {
            dateFrom: document.getElementById('filterDateFrom')?.value || filterState.dateFrom || '',
            dateTo: document.getElementById('filterDateTo')?.value || filterState.dateTo || ''
        };
    }

    return {
        dateFrom: '',
        dateTo: ''
    };
}

function buildCommentsListRequestParams(view, overrides = {}) {
    const { dateFrom, dateTo } = resolveCommentsDateRange();

    return {
        view,
        site: overrides.site || getCommentsReadSite(),
        dateFrom,
        dateTo,
        page: overrides.page ?? commentsPaginationState.page,
        pageSize: overrides.pageSize ?? commentsPaginationState.pageSize,
        status: filterState.status,
        type: filterState.type,
        source: filterState.source,
        queue: filterState.queue,
        hasImage: filterState.hasImage,
        promptId: view === 'gallery' ? filterState.promptId : '',
        search: filterState.currentSearchInput,
        searchTag: filterState.searchTags
    };
}

function buildCommentsViewCacheKey(requestParams = {}) {
    const tags = Array.isArray(requestParams.searchTag)
        ? requestParams.searchTag.map((tag) => String(tag || '').trim()).filter(Boolean).sort()
        : [];

    return JSON.stringify({
        view: requestParams.view === 'gallery' ? 'gallery' : 'guestbook',
        site: requestParams.site || 'all',
        dateFrom: requestParams.dateFrom || '',
        dateTo: requestParams.dateTo || '',
        page: normalizeCommentsPage(requestParams.page, 1),
        pageSize: normalizeCommentsPage(requestParams.pageSize, COMMENTS_DEFAULT_PAGE_SIZE),
        status: requestParams.status || 'all',
        type: requestParams.type || 'all',
        source: requestParams.source || 'all',
        queue: requestParams.queue || 'pending',
        hasImage: requestParams.hasImage === true,
        promptId: String(requestParams.promptId || '').trim(),
        search: String(requestParams.search || '').trim(),
        searchTag: tags
    });
}

function buildCommentsSummaryCacheKey({ site = getCommentsReadSite(), view = currentCommentView } = {}) {
    return JSON.stringify({
        site: site || 'all',
        view: view === 'gallery' ? 'gallery' : 'guestbook'
    });
}

function getCommentsCachedPayload(view, requestParams = {}) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    const cached = commentsViewCache[normalizedView];
    if (!cached?.payload) {
        return null;
    }

    return cached.key === buildCommentsViewCacheKey(requestParams)
        ? cached.payload
        : null;
}

function storeCommentsCachedPayload(view, requestParams = {}, payload = null) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    commentsViewCache[normalizedView] = {
        key: buildCommentsViewCacheKey(requestParams),
        payload
    };
}

function getCommentsCachedSummary(view = currentCommentView, site = getCommentsReadSite()) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    const cached = commentsSummaryCache[normalizedView];
    if (!cached?.payload) {
        return null;
    }

    return cached.key === buildCommentsSummaryCacheKey({ site, view: normalizedView })
        ? cached.payload
        : null;
}

function storeCommentsCachedSummary(view = currentCommentView, site = getCommentsReadSite(), payload = null) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    commentsSummaryCache[normalizedView] = {
        key: buildCommentsSummaryCacheKey({ site, view: normalizedView }),
        payload
    };
}

function clearCommentsViewPrefetch() {
    if (!commentsViewPrefetchHandle) {
        return;
    }

    if (commentsViewPrefetchMode === 'idle' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(commentsViewPrefetchHandle);
    } else {
        window.clearTimeout(commentsViewPrefetchHandle);
    }

    commentsViewPrefetchHandle = 0;
    commentsViewPrefetchMode = '';
}

function invalidateCommentsViewCache(view = '') {
    clearCommentsViewPrefetch();

    if (view) {
        const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
        commentsViewCache[normalizedView] = {
            key: '',
            payload: null
        };
        commentsSummaryCache[normalizedView] = {
            key: '',
            payload: null
        };
        return;
    }

    COMMENTS_PREFETCH_VIEWS.forEach((cacheView) => {
        commentsViewCache[cacheView] = {
            key: '',
            payload: null
        };
        commentsSummaryCache[cacheView] = {
            key: '',
            payload: null
        };
    });
}

function isCommentsModuleActive() {
    const module = document.getElementById('module-comments');
    return Boolean(module && module.classList.contains('active') && window.getComputedStyle(module).display !== 'none');
}

function prefetchCommentsView(view) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    const requestParams = buildCommentsListRequestParams(normalizedView, { page: 1 });
    const taskKey = buildCommentsViewCacheKey(requestParams);
    const cachedPayload = getCommentsCachedPayload(normalizedView, requestParams);

    if (cachedPayload) {
        return Promise.resolve(cachedPayload);
    }

    if (commentsViewPrefetchPromise && commentsViewPrefetchTaskKey === taskKey) {
        return commentsViewPrefetchPromise;
    }

    commentsViewPrefetchTaskKey = taskKey;
    commentsViewPrefetchPromise = fetchAdminCommentsList(requestParams)
        .then((payload) => {
            storeCommentsCachedPayload(normalizedView, requestParams, payload);
            return payload;
        })
        .finally(() => {
            if (commentsViewPrefetchTaskKey === taskKey) {
                commentsViewPrefetchTaskKey = '';
                commentsViewPrefetchPromise = null;
            }
        });

    return commentsViewPrefetchPromise;
}

function prefetchCommentsSummary(view = currentCommentView) {
    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    const site = getCommentsReadSite();
    const taskKey = buildCommentsSummaryCacheKey({ site, view: normalizedView });
    const cachedPayload = getCommentsCachedSummary(normalizedView, site);

    if (cachedPayload) {
        return Promise.resolve(cachedPayload);
    }

    if (commentsSummaryPrefetchPromise && commentsSummaryPrefetchTaskKey === taskKey) {
        return commentsSummaryPrefetchPromise;
    }

    commentsSummaryPrefetchTaskKey = taskKey;
    commentsSummaryPrefetchPromise = fetchAdminCommentSummary(site, normalizedView)
        .then((payload) => {
            storeCommentsCachedSummary(normalizedView, site, payload);
            return payload;
        })
        .finally(() => {
            if (commentsSummaryPrefetchTaskKey === taskKey) {
                commentsSummaryPrefetchTaskKey = '';
                commentsSummaryPrefetchPromise = null;
            }
        });

    return commentsSummaryPrefetchPromise;
}

function scheduleCommentsViewPrefetch(activeView = currentCommentView) {
    const normalizedView = activeView === 'gallery' ? 'gallery' : 'guestbook';
    const siblingViews = COMMENTS_PREFETCH_VIEWS.filter((view) => view !== normalizedView);
    clearCommentsViewPrefetch();

    if (!isCommentsModuleActive() || siblingViews.length === 0) {
        return false;
    }

    const runPrefetch = async () => {
        commentsViewPrefetchHandle = 0;
        commentsViewPrefetchMode = '';

        if (!isCommentsModuleActive()) {
            return;
        }

        for (const view of siblingViews) {
            if (!isCommentsModuleActive()) {
                break;
            }

            try {
                // Keep sibling warming cheap: list rows are loaded only when the tab is opened.
                await prefetchCommentsSummary(view);
            } catch (error) {
                console.warn(`[AdminComments] Failed to prefetch ${view} comments summary:`, error);
            }
        }
    };

    if (typeof window.requestIdleCallback === 'function') {
        commentsViewPrefetchMode = 'idle';
        commentsViewPrefetchHandle = window.requestIdleCallback(runPrefetch, { timeout: 2400 });
        return true;
    }

    commentsViewPrefetchMode = 'timeout';
    commentsViewPrefetchHandle = window.setTimeout(runPrefetch, 600);
    return true;
}

function prefetchCommentsModule() {
    return scheduleCommentsViewPrefetch(currentCommentView);
}

function updateCommentsPaginationState(pagination = {}, fallbackCount = 0) {
    commentsPaginationState.page = normalizeCommentsPage(pagination.page, commentsPaginationState.page);
    commentsPaginationState.pageSize = normalizeCommentsPage(pagination.pageSize, commentsPaginationState.pageSize || COMMENTS_DEFAULT_PAGE_SIZE);
    commentsPaginationState.totalItems = Math.max(0, Number.parseInt(pagination.totalItems, 10) || fallbackCount || 0);
    commentsPaginationState.totalPages = Math.max(1, Number.parseInt(pagination.totalPages, 10) || (commentsPaginationState.totalItems > 0
        ? Math.ceil(commentsPaginationState.totalItems / commentsPaginationState.pageSize)
        : 1));
}

function renderCommentsPagination() {
    const container = document.getElementById('adminCommentsPagination');
    if (!container) return;

    const totalItems = Math.max(0, Number(commentsPaginationState.totalItems || 0));
    const totalPages = Math.max(1, Number(commentsPaginationState.totalPages || 1));
    const currentPage = Math.min(Math.max(1, Number(commentsPaginationState.page || 1)), totalPages);

    if (totalItems <= 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="pagination-shell comments-pagination-shell__inner">
            <div class="pagination-control">
                <button class="pagination-btn pagination-btn--step"
                    type="button"
                    data-admin-action="comments-pagination-go"
                    data-comments-page="${currentPage - 1}"
                    ${currentPage <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i>
                </button>
                <input type="number"
                    class="pagination-input"
                    value="${currentPage}"
                    min="1"
                    max="${totalPages}"
                    data-admin-change-action="comments-pagination-go"
                    data-comments-page-max="${totalPages}">
                <button class="pagination-btn pagination-btn--step"
                    type="button"
                    data-admin-action="comments-pagination-go"
                    data-comments-page="${currentPage + 1}"
                    ${currentPage >= totalPages ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
            <div class="pagination-total pagination-total--compact">第 ${currentPage} / ${totalPages} 页 · 共 ${totalItems} 条</div>
        </div>
    `;
}

function changeCommentsPage(page) {
    const nextPage = Math.min(
        Math.max(normalizeCommentsPage(page, commentsPaginationState.page), 1),
        Math.max(1, Number(commentsPaginationState.totalPages || 1))
    );

    if (nextPage === commentsPaginationState.page && commentsData.length > 0) {
        return;
    }

    loadComments(currentCommentView, { page: nextPage });
}

function collectVisibleSelectedCommentIds() {
    return new Set(
        Array.from(document.querySelectorAll('.comment-checkbox:checked'))
            .map((checkbox) => String(checkbox.dataset.id || '').trim())
            .filter(Boolean)
    );
}

function getSelectedComments() {
    return Array.from(document.querySelectorAll('.comment-checkbox:checked'))
        .map((checkbox) => getCommentById(String(checkbox.dataset.id || '').trim()))
        .filter(Boolean);
}

function getCommentsModuleRoot() {
    return document.getElementById('module-comments');
}

function syncCommentsSelectModeUi(count = null) {
    const module = getCommentsModuleRoot();
    const selectModeBtn = document.getElementById('commentsSelectModeBtn');
    const batchMenuContainer = document.getElementById('commentsBatchMenuContainer');
    const batchMenuTrigger = document.getElementById('commentsBatchMenuTrigger');
    const countWrapper = document.getElementById('commentsSelectionCountWrapper');
    const normalizedCount = Number.isFinite(Number(count))
        ? Number(count)
        : document.querySelectorAll('.comment-checkbox:checked').length;

    if (module) {
        module.setAttribute('data-comments-select-mode', isCommentsSelectMode ? 'true' : 'false');
    }

    if (selectModeBtn) {
        selectModeBtn.classList.toggle('active', isCommentsSelectMode);
        selectModeBtn.setAttribute('aria-pressed', isCommentsSelectMode ? 'true' : 'false');
    }

    if (batchMenuContainer) {
        batchMenuContainer.hidden = !isCommentsSelectMode;
        if (!isCommentsSelectMode) {
            batchMenuContainer.classList.remove('open');
        }
    }

    if (batchMenuTrigger && !isCommentsSelectMode) {
        batchMenuTrigger.setAttribute('aria-expanded', 'false');
    }

    if (countWrapper) {
        countWrapper.hidden = !isCommentsSelectMode || normalizedCount <= 0;
    }
}

function clearRetainedCommentSelection() {
    retainedSelectedCommentIds = new Set();
}

function prepareCommentReloadState({ preserveSelection = false, removeSelectionIds = [], focusCommentId = '' } = {}) {
    retainedSelectedCommentIds = preserveSelection
        ? collectVisibleSelectedCommentIds()
        : new Set();

    (Array.isArray(removeSelectionIds) ? removeSelectionIds : []).forEach((id) => {
        const normalizedId = String(id || '').trim();
        if (normalizedId) {
            retainedSelectedCommentIds.delete(normalizedId);
        }
    });

    pendingFocusedCommentId = String(focusCommentId || '').trim();
}

function restoreCommentSelectionState() {
    const checkboxes = document.querySelectorAll('.comment-checkbox');
    const visibleSelectedIds = new Set();

    if (!isCommentsSelectMode) {
        checkboxes.forEach((checkbox) => {
            checkbox.checked = false;
            const item = checkbox.closest('.comment-admin-item');
            if (item) {
                item.classList.remove('selected');
            }
        });

        clearRetainedCommentSelection();
        updateSelectionUI(0);
        return;
    }

    checkboxes.forEach((checkbox) => {
        const commentId = String(checkbox.dataset.id || '').trim();
        const checked = commentId && retainedSelectedCommentIds.has(commentId);
        checkbox.checked = checked;
        if (checked) {
            visibleSelectedIds.add(commentId);
        }

        const item = checkbox.closest('.comment-admin-item');
        if (item) {
            item.classList.toggle('selected', checked);
        }
    });

    retainedSelectedCommentIds = visibleSelectedIds;
    updateSelectionUI(visibleSelectedIds.size);

    const selectAll = document.getElementById('selectAllComments');
    if (selectAll) {
        selectAll.checked = visibleSelectedIds.size > 0 && visibleSelectedIds.size === checkboxes.length;
        selectAll.indeterminate = visibleSelectedIds.size > 0 && visibleSelectedIds.size < checkboxes.length;
    }
}

function focusCommentCard(commentId) {
    const normalizedId = String(commentId || '').trim();
    if (!normalizedId) {
        return;
    }

    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(normalizedId)
        : normalizedId.replace(/["\\]/g, '\\$&');
    const target = document.querySelector(`.comment-admin-item[data-id="${escapedId}"]`);
    if (!target) {
        return;
    }

    target.classList.remove('comment-admin-item--focused');
    void target.offsetWidth;
    target.classList.add('comment-admin-item--focused');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setTimeout(() => {
        target.classList.remove('comment-admin-item--focused');
    }, 2200);
}

function findAdjacentCommentId(commentId, excludedIds = []) {
    const normalizedId = String(commentId || '').trim();
    if (!normalizedId) {
        return '';
    }

    const excluded = new Set(
        (Array.isArray(excludedIds) ? excludedIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    );
    const items = Array.from(document.querySelectorAll('.comment-admin-item'));
    const currentIndex = items.findIndex((item) => item.dataset.id === normalizedId);

    if (currentIndex === -1) {
        return '';
    }

    for (let offset = 1; offset < items.length; offset += 1) {
        const nextItem = items[currentIndex + offset];
        if (nextItem?.dataset?.id && !excluded.has(nextItem.dataset.id)) {
            return nextItem.dataset.id;
        }

        const prevItem = items[currentIndex - offset];
        if (prevItem?.dataset?.id && !excluded.has(prevItem.dataset.id)) {
            return prevItem.dataset.id;
        }
    }

    return '';
}

function findVisibleCommentIdByUser(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
        return '';
    }

    const escapedUserId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(normalizedUserId)
        : normalizedUserId.replace(/["\\]/g, '\\$&');
    const match = document.querySelector(`.comment-admin-item[data-user-id="${escapedUserId}"]`);
    return String(match?.dataset?.id || '').trim();
}

function refreshCommentsForUserStatus(userId) {
    const focusCommentId = findVisibleCommentIdByUser(userId);
    prepareCommentReloadState({
        preserveSelection: true,
        focusCommentId
    });
    loadComments(currentCommentView, {
        preserveSelection: true,
        focusCommentId
    });
    loadCommentStats(currentCommentView, { showLoading: false });
}

function getCommentById(commentId) {
    const normalizedId = String(commentId || '').trim();
    if (!normalizedId) {
        return null;
    }
    return commentsById.get(normalizedId)
        || commentsData.find((item) => String(item?.id || '').trim() === normalizedId)
        || (String(activeCommentDetailSnapshot?.id || '').trim() === normalizedId ? activeCommentDetailSnapshot : null)
        || null;
}

function selectCommentQueue(queue = 'pending') {
    const normalizedQueue = String(queue || '').trim().toLowerCase() || 'pending';
    filterState.queue = normalizedQueue;
    activeCommentQueue = normalizedQueue;
    syncCommentQueueUi();

    const nextView = normalizedQueue === 'guestbook_unreplied' ? 'guestbook' : currentCommentView;
    syncAdminCommentsRouteState({
        view: nextView,
        queue: normalizedQueue,
        promptId: nextView === 'gallery' ? filterState.promptId : '',
        promptTitle: nextView === 'gallery' ? filterState.promptTitle : ''
    }, {
        ensureCommentsModule: true
    });

    if (nextView !== currentCommentView) {
        switchCommentView(nextView);
        return;
    }

    loadComments(currentCommentView, { resetPage: true });
}

function ensureCommentDetailDrawer() {
    let drawer = document.getElementById('commentDetailDrawer');
    if (drawer) {
        bindCommentDetailDrawerCloseActivation(drawer);
        return drawer;
    }

    drawer = document.createElement('div');
    drawer.id = 'commentDetailDrawer';
    drawer.className = 'comment-detail-drawer';
    drawer.innerHTML = `
        <div class="comment-detail-drawer__backdrop" data-comments-action="close-detail-drawer"></div>
        <aside class="comment-detail-drawer__panel" aria-label="评论详情">
            <div class="comment-detail-drawer__header">
                <div>
                    <div class="comment-detail-drawer__eyebrow">Comment V2</div>
                    <h3 class="comment-detail-drawer__title" id="commentDetailDrawerTitle">评论详情</h3>
                </div>
                <button type="button" class="comment-detail-drawer__close" data-comments-action="close-detail-drawer" aria-label="关闭评论详情" title="关闭评论详情">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </div>
            <div class="comment-detail-drawer__body" id="commentDetailDrawerBody"></div>
        </aside>
    `;

    document.body.appendChild(drawer);
    bindCommentDetailDrawerCloseActivation(drawer);
    return drawer;
}

function handleCommentDetailDrawerCloseActivation(event) {
    if (event.type === 'pointerup' && typeof event.button === 'number' && event.button !== 0) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeCommentDetailDrawer();
}

function bindCommentDetailDrawerCloseActivation(drawer) {
    if (!(drawer instanceof HTMLElement)) {
        return;
    }

    drawer.querySelectorAll('[data-comments-action="close-detail-drawer"]').forEach((trigger) => {
        if (!(trigger instanceof HTMLElement) || trigger.dataset.commentsDrawerTouchBound === '1') {
            return;
        }

        trigger.dataset.commentsDrawerTouchBound = '1';
        trigger.addEventListener('click', handleCommentDetailDrawerCloseActivation);
        trigger.addEventListener('pointerup', handleCommentDetailDrawerCloseActivation);
        trigger.addEventListener('touchend', handleCommentDetailDrawerCloseActivation, { passive: false });
    });
}

function closeCommentDetailDrawer() {
    activeCommentDetailId = '';
    activeCommentDetailSnapshot = null;
    const drawer = document.getElementById('commentDetailDrawer');
    if (drawer) {
        drawer.dataset.workflowBusy = 'false';
        drawer.dataset.governanceBusy = 'false';
        drawer.classList.remove('is-open');
    }
}

function setCommentDrawerBusyState({
    feedbackId = '',
    buttonSelector = '',
    datasetKey = '',
    isBusy = false,
    message = '',
    fallbackMessage = '正在处理中...'
} = {}) {
    const drawer = ensureCommentDetailDrawer();
    const feedback = feedbackId ? drawer.querySelector(`#${feedbackId}`) : null;
    const buttons = String(buttonSelector || '').trim()
        ? drawer.querySelectorAll(buttonSelector)
        : [];
    const normalizedMessage = String(message || '').trim();

    if (datasetKey) {
        drawer.dataset[datasetKey] = isBusy ? 'true' : 'false';
    }

    Array.from(buttons).forEach((button) => {
        button.disabled = isBusy;
    });

    if (feedback) {
        feedback.hidden = !isBusy;
        feedback.innerHTML = isBusy
            ? `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(normalizedMessage || fallbackMessage)}</span>`
            : '';
    }
}

function setCommentWorkflowBusyState(isBusy = false, message = '') {
    setCommentDrawerBusyState({
        feedbackId: 'commentWorkflowActionState',
        buttonSelector: [
            '[data-comments-action="set-workflow-status"]',
            '[data-comments-action="assign-comment-self"]',
            '[data-comments-action="toggle-comment-priority"]',
            '[data-comments-action="edit-comment-tags"]',
            '[data-comments-action="add-workflow-note"]'
        ].join(','),
        datasetKey: 'workflowBusy',
        isBusy,
        message,
        fallbackMessage: '正在处理 Workflow...'
    });
}

function setCommentGovernanceBusyState(isBusy = false, message = '') {
    setCommentDrawerBusyState({
        feedbackId: 'commentGovernanceActionState',
        buttonSelector: '[data-comments-action="create-comment-ticket"]',
        datasetKey: 'governanceBusy',
        isBusy,
        message,
        fallbackMessage: '正在创建工单...'
    });
}

function buildCommentDrawerActionButton({ action = '', label = '', icon = 'arrow-right', disabled = false, extraAttrs = '' } = {}) {
    return `
        <button type="button" class="comment-detail-drawer__action-btn" data-comments-action="${escapeHtml(action)}" ${disabled ? 'disabled' : ''} ${extraAttrs}>
            <i class="fas fa-${escapeHtml(icon)}"></i>
            <span>${escapeHtml(label)}</span>
        </button>
    `;
}

function renderCommentDetailDrawer(comment, detail = {}, options = {}) {
    const drawer = ensureCommentDetailDrawer();
    const body = drawer.querySelector('#commentDetailDrawerBody');
    const title = drawer.querySelector('#commentDetailDrawerTitle');
    if (!body || !title) {
        return;
    }

    const workflow = detail?.workflow && typeof detail.workflow === 'object'
        ? detail.workflow
        : getCommentWorkflow(comment);
    const workflowMeta = getCommentWorkflowStatusMeta(workflow.status);
    const userRiskMeta = getCommentUserRiskMeta(comment);
    const userSummary = comment?.user_summary && typeof comment.user_summary === 'object'
        ? comment.user_summary
        : {};
    const tickets = Array.isArray(detail?.tickets) ? detail.tickets : [];
    const notes = Array.isArray(detail?.notes) ? detail.notes : [];
    const tags = Array.isArray(workflow.tags) ? workflow.tags : [];
    const ticketIds = Array.isArray(workflow.linked_ticket_ids) ? workflow.linked_ticket_ids : [];
    const contextTitle = getCommentContextTitle(comment) || getCommentEntityLabel(comment);

    title.textContent = `${getCommentEntityLabel(comment)} · ${comment.author || '未知用户'}`;

    if (options.error) {
        body.innerHTML = `<div class="comment-detail-drawer__empty">加载失败：${escapeHtml(options.error)}</div>`;
        drawer.classList.add('is-open');
        return;
    }

    body.innerHTML = `
        <section class="comment-detail-drawer__section">
            <div class="comment-detail-drawer__hero">
                <div class="comment-detail-drawer__hero-main">
                    <div class="comment-detail-drawer__hero-row">
                        <span class="comment-detail-chip comment-detail-chip--site">${escapeHtml(getCommentSiteLabel(comment.site))}</span>
                        <span class="comment-detail-chip comment-detail-chip--entity">${escapeHtml(getCommentEntityLabel(comment))}</span>
                        <span class="comment-detail-chip comment-detail-chip--status comment-detail-chip--${escapeHtml(workflowMeta.tone)}">${escapeHtml(workflowMeta.label)}</span>
                    </div>
                    <div class="comment-detail-drawer__hero-title">${escapeHtml(contextTitle)}</div>
                    <div class="comment-detail-drawer__hero-meta">${escapeHtml(comment.author || '未知用户')} · ${escapeHtml(formatTimeAgo(comment.created_at))} · ${escapeHtml(getCommentSummaryMetricText(comment))}</div>
                </div>
                <div class="comment-detail-drawer__hero-side comment-detail-drawer__hero-side--${escapeHtml(userRiskMeta.tone)}">
                    <div class="comment-detail-drawer__hero-side-label">风险</div>
                    <div class="comment-detail-drawer__hero-side-value comment-detail-drawer__hero-side-value--${escapeHtml(userRiskMeta.tone)}">${escapeHtml(userRiskMeta.label)}</div>
                </div>
            </div>
        </section>

        <section class="comment-detail-drawer__section">
            <div class="comment-detail-drawer__section-head">
                <h4>治理动作</h4>
                <span>跨模块联动</span>
            </div>
            <div class="comment-detail-drawer__action-grid">
                ${buildCommentDrawerActionButton({
                    action: 'open-comment-user',
                    label: '查看用户',
                    icon: 'user',
                    disabled: !comment?.user_id,
                    extraAttrs: `data-comment-id="${encodeURIComponent(comment.id)}"`
                })}
                ${buildCommentDrawerActionButton({
                    action: 'view-comment-context',
                    label: '查看上下文',
                    icon: 'external-link-alt',
                    disabled: !comment?.context,
                    extraAttrs: `data-context-url="${encodeURIComponent(buildCommentContextUrl(comment))}"`
                })}
                ${buildCommentDrawerActionButton({
                    action: 'open-comment-prompt',
                    label: comment?.type === 'gallery' ? '编辑 Prompt' : '返回评论列表',
                    icon: comment?.type === 'gallery' ? 'wand-magic-sparkles' : 'comments',
                    disabled: comment?.type !== 'gallery',
                    extraAttrs: `data-comment-id="${encodeURIComponent(comment.id)}"`
                })}
                ${buildCommentDrawerActionButton({
                    action: tickets.length > 0 ? 'open-comment-ticket' : 'create-comment-ticket',
                    label: tickets.length > 0 ? '查看工单' : '创建工单',
                    icon: 'headset',
                    disabled: !window.hasPermission || !window.hasPermission('tickets.manage'),
                    extraAttrs: tickets.length > 0
                        ? `data-ticket-id="${encodeURIComponent(tickets[0]?.id || ticketIds[0] || '')}" data-comment-id="${encodeURIComponent(comment.id)}"`
                        : `data-comment-id="${encodeURIComponent(comment.id)}"`
                })}
            </div>
            <div id="commentGovernanceActionState" class="comment-detail-drawer__workflow-feedback" hidden></div>
        </section>

        <section class="comment-detail-drawer__section">
            <div class="comment-detail-drawer__section-head">
                <h4>线程上下文</h4>
                <span>${escapeHtml(getCommentEntityLabel(comment))}</span>
            </div>
            <div class="comment-detail-thread">
                ${comment.root_snippet ? `
                    <div class="comment-detail-thread__item">
                        <span class="comment-detail-thread__label">线程主文</span>
                        <div class="comment-detail-thread__content">${escapeHtml(comment.root_snippet)}</div>
                    </div>
                ` : ''}
                ${comment.parent_snippet ? `
                    <div class="comment-detail-thread__item">
                        <span class="comment-detail-thread__label">上级内容</span>
                        <div class="comment-detail-thread__content">${escapeHtml(comment.parent_snippet)}</div>
                    </div>
                ` : ''}
                <div class="comment-detail-thread__item comment-detail-thread__item--current">
                    <span class="comment-detail-thread__label">当前评论</span>
                    <div class="comment-detail-thread__content">${escapeHtml(comment.content || '')}</div>
                </div>
            </div>
        </section>

        <section class="comment-detail-drawer__section">
            <div class="comment-detail-drawer__section-head">
                <h4>用户侧信号</h4>
                <span>${escapeHtml(userRiskMeta.label)}</span>
            </div>
            <div class="comment-detail-stat-grid">
                <div class="comment-detail-stat"><span>留言主贴</span><strong>${Number(userSummary.guestbook_message_count || 0)}</strong></div>
                <div class="comment-detail-stat"><span>留言评论</span><strong>${Number(userSummary.guestbook_comment_count || 0)}</strong></div>
                <div class="comment-detail-stat"><span>画廊评论</span><strong>${Number(userSummary.gallery_comment_count || 0)}</strong></div>
                <div class="comment-detail-stat"><span>处理中工单</span><strong>${Number(userSummary.active_ticket_count || 0)}</strong></div>
                <div class="comment-detail-stat"><span>订单</span><strong>${Number(userSummary.order_count || 0)}</strong></div>
                <div class="comment-detail-stat"><span>支付单</span><strong>${Number(userSummary.payment_order_count || 0)}</strong></div>
            </div>
        </section>

        <section class="comment-detail-drawer__section comment-detail-drawer__section--workflow">
            <div class="comment-detail-drawer__section-head">
                <h4>Workflow</h4>
                <span>${escapeHtml(workflow.assignee_label || '未指派')}</span>
            </div>
            <div class="comment-detail-drawer__toolbar">
                <div class="comment-detail-drawer__status-group">
                    ${['pending', 'in_review', 'escalated', 'resolved', 'ignored'].map((status) => {
                        const meta = getCommentWorkflowStatusMeta(status);
                        return `
                            <button type="button" class="comment-status-pill${workflow.status === status ? ' active' : ''}" data-comments-action="set-workflow-status" data-comment-id="${encodeURIComponent(comment.id)}" data-workflow-status="${escapeHtml(status)}">
                                ${escapeHtml(meta.label)}
                            </button>
                        `;
                    }).join('')}
                </div>
                <div class="comment-detail-drawer__toolbar-actions">
                    <button type="button" class="comment-detail-drawer__minor-btn" data-comments-action="assign-comment-self" data-comment-id="${encodeURIComponent(comment.id)}">指派给我</button>
                    <button type="button" class="comment-detail-drawer__minor-btn${String(workflow.priority || '').trim().toLowerCase() === 'high' ? ' is-active' : ''}" data-comments-action="toggle-comment-priority" data-comment-id="${encodeURIComponent(comment.id)}">
                        ${String(workflow.priority || '').trim().toLowerCase() === 'high' ? '取消高优先' : '标记高优先'}
                    </button>
                    <button type="button" class="comment-detail-drawer__minor-btn" data-comments-action="edit-comment-tags" data-comment-id="${encodeURIComponent(comment.id)}">编辑标签</button>
                </div>
            </div>
            <div id="commentWorkflowActionState" class="comment-detail-drawer__workflow-feedback" hidden></div>
            <div class="comment-detail-tag-list">
                ${tags.length
            ? tags.map((tag) => `<span class="comment-detail-chip comment-detail-chip--tag">${escapeHtml(tag)}</span>`).join('')
            : '<span class="comment-detail-drawer__empty-inline">暂无标签</span>'}
            </div>
        </section>

        <section class="comment-detail-drawer__section">
            <div class="comment-detail-drawer__section-head">
                <h4>备注</h4>
                <span>${Number(workflow.note_count || 0)} 条</span>
            </div>
            <div class="comment-detail-note-composer">
                <textarea id="commentWorkflowNoteInput" class="comment-detail-note-input" placeholder="记录处理判断、交接信息或补充证据"></textarea>
                <button type="button" class="comment-detail-drawer__action-btn comment-detail-drawer__action-btn--primary" data-comments-action="add-workflow-note" data-comment-id="${encodeURIComponent(comment.id)}">
                    <i class="fas fa-note-sticky"></i>
                    <span>添加备注</span>
                </button>
            </div>
            <div class="comment-detail-note-list">
                ${notes.length
            ? notes.map((note) => `
                <div class="comment-detail-note-item">
                    <div class="comment-detail-note-item__meta">${escapeHtml(note.admin_label || note.admin_id || 'Admin')} · ${escapeHtml(formatTimeAgo(note.created_at))}</div>
                    <div class="comment-detail-note-item__content">${escapeHtml(note.note || '')}</div>
                </div>
            `).join('')
            : '<div class="comment-detail-drawer__empty-inline">还没有备注</div>'}
            </div>
        </section>

        <section class="comment-detail-drawer__section">
            <div class="comment-detail-drawer__section-head">
                <h4>关联工单</h4>
                <span>${tickets.length || Number(workflow.linked_ticket_count || 0)} 张</span>
            </div>
            <div class="comment-detail-ticket-list">
                ${tickets.length
            ? tickets.map((ticket) => `
                <button type="button" class="comment-detail-ticket-item" data-comments-action="open-comment-ticket" data-ticket-id="${encodeURIComponent(ticket.id || '')}" data-comment-id="${encodeURIComponent(comment.id)}">
                    <div class="comment-detail-ticket-item__id">${escapeHtml(ticket.id || '')}</div>
                    <div class="comment-detail-ticket-item__meta">${escapeHtml(ticket.status || 'PENDING')} · ${escapeHtml(formatTimeAgo(ticket.created_at))}</div>
                </button>
            `).join('')
            : '<div class="comment-detail-drawer__empty-inline">当前没有关联工单</div>'}
            </div>
        </section>
    `;

    drawer.classList.add('is-open');
}

async function openCommentDetail(commentId) {
    const comment = getCommentById(commentId);
    if (!comment) {
        showToast('未找到当前评论', 'error');
        return;
    }

    const drawer = ensureCommentDetailDrawer();
    const body = drawer.querySelector('#commentDetailDrawerBody');
    const title = drawer.querySelector('#commentDetailDrawerTitle');
    activeCommentDetailId = comment.id;
    activeCommentDetailSnapshot = { ...comment };
    commentDetailLoading = true;

    if (title) {
        title.textContent = '加载评论详情';
    }
    if (body) {
        body.innerHTML = '<div class="comment-detail-drawer__empty">正在加载评论治理详情...</div>';
    }
    drawer.classList.add('is-open');

    try {
        const detail = await fetchAdminCommentWorkflowDetail({
            site: comment.site || getCommentsReadSite(),
            entityType: comment.entity_type,
            entityId: comment.id
        });
        if (activeCommentDetailId !== comment.id) {
            return;
        }
        renderCommentDetailDrawer(comment, detail);
    } catch (error) {
        console.error('Failed to load comment detail:', error);
        renderCommentDetailDrawer(comment, null, {
            error: error.message || '未知错误'
        });
    } finally {
        commentDetailLoading = false;
    }
}

async function openCommentUser(commentId) {
    const comment = getCommentById(commentId);
    if (!comment?.user_id) {
        showToast('当前评论缺少用户信息', 'error');
        return;
    }

    const modalOptions = {
        defaultTab: 'content',
        analyticsContext: {
            sourceLabel: '评论管理',
            summary: `${getCommentEntityLabel(comment)} · ${comment.author || '未知用户'}`,
            referenceLabel: '评论',
            referenceValue: comment.id,
            destination: 'comments',
            destinationContext: {
                view: currentCommentView,
                focusCommentId: comment.id
            }
        }
    };
    const userContext = {
        source: 'comments',
        entity: 'user',
        action: 'open-user-modal',
        site: comment.site || getCommentsReadSite(),
        focus: {
            userId: comment.user_id,
            commentId: comment.id
        },
        payload: {
            modalOptions
        },
        returnTo: {
            module: 'comments',
            view: currentCommentView,
            focusCommentId: comment.id
        }
    };

    if (window.AdminShell?.openContext) {
        const opened = await window.AdminShell.openContext('users', userContext);
        if (opened) {
            return;
        }
    }

    const switched = window.AdminShell?.activateModule
        ? window.AdminShell.activateModule('users', { reason: 'comments-open-user', deferContext: true })
        : window.switchModule?.('users');
    if (switched === false) {
        return;
    }

    if (typeof window.openAdminUsersShellContext === 'function') {
        try {
            await window.openAdminUsersShellContext(userContext);
            return;
        } catch (error) {
            console.warn('Failed to open comment user through shared users helper:', error);
        }
    }

    window.setTimeout(() => {
        window.openUserModal?.(comment.user_id, {
            defaultTab: 'content',
            analyticsContext: modalOptions.analyticsContext
        });
    }, 160);
}

async function openCommentPromptAdmin(commentId) {
    const comment = getCommentById(commentId);
    if (!comment || comment.type !== 'gallery' || !comment.context) {
        showToast('当前评论没有可编辑的 Prompt', 'info');
        return;
    }
    const galleryContext = {
        source: 'comments',
        entity: 'prompt',
        action: 'edit-prompt',
        site: comment.site || getCommentsReadSite(),
        focus: {
            promptId: comment.context,
            commentId: comment.id
        },
        returnTo: {
            module: 'comments',
            view: currentCommentView,
            focusCommentId: comment.id
        }
    };

    if (window.AdminShell?.openContext) {
        const opened = await window.AdminShell.openContext('gallery', galleryContext);
        if (opened) {
            return;
        }
    }

    if (typeof window.openAdminGalleryShellContext === 'function') {
        try {
            await window.openAdminGalleryShellContext(galleryContext);
            return;
        } catch (error) {
            console.warn('Failed to open comment prompt through shared gallery helper:', error);
        }
    }

    const switched = window.AdminShell?.activateModule
        ? window.AdminShell.activateModule('gallery', { reason: 'comments-open-prompt', deferContext: true })
        : window.switchModule?.('gallery');
    if (switched === false) {
        return;
    }

    window.setTimeout(() => {
        window.editPrompt?.(comment.context);
    }, 180);
}

async function openCommentTicket(ticketId, commentId = '') {
    const normalizedTicketId = String(ticketId || '').trim();
    if (!normalizedTicketId) {
        showToast('当前评论还没有关联工单', 'info');
        return;
    }

    if (commentId) {
        activeCommentDetailId = commentId;
    }
    const ticketContext = {
        source: 'comments',
        entity: 'ticket',
        action: 'focus-ticket',
        site: getCommentsReadSite(),
        focus: {
            ticketId: normalizedTicketId,
            commentId
        },
        payload: {
            status: 'all'
        },
        returnTo: {
            module: 'comments',
            view: currentCommentView,
            focusCommentId: commentId
        }
    };

    if (window.AdminShell?.openContext) {
        const opened = await window.AdminShell.openContext('tickets', ticketContext);
        if (opened) {
            return;
        }
    }

    const switched = window.AdminShell?.activateModule
        ? window.AdminShell.activateModule('tickets', { reason: 'comments-open-ticket', deferContext: true })
        : window.switchModule?.('tickets');
    if (switched === false) {
        return;
    }

    if (typeof window.openAdminTicketsShellContext === 'function') {
        try {
            await window.openAdminTicketsShellContext(ticketContext, {
                workspace: 'queue'
            });
            return;
        } catch (error) {
            console.warn('Failed to open linked ticket through shared tickets helper:', error);
        }
    }

    window.setTimeout(async () => {
        try {
            await window.AdminTickets?.activate?.({
                ticketId: normalizedTicketId,
                workspace: 'queue',
                status: 'all'
            }, {
                workspace: 'queue'
            });
            await window.AdminTickets?.focusTicket?.(normalizedTicketId, { status: 'all' });
        } catch (error) {
            console.warn('Failed to open linked ticket:', error);
        }
    }, 180);

}

async function createCommentTicket(commentId) {
    const comment = getCommentById(commentId);
    if (!comment) {
        showToast('未找到当前评论', 'error');
        return;
    }

    try {
        setCommentGovernanceBusyState(true, '正在创建工单...');
        const payload = await mutateAdminCommentWorkflow({
            action: 'create_ticket',
            site: comment.site || getCommentsReadSite(),
            entityType: comment.entity_type,
            entityId: comment.id,
            comment
        });
        setCommentGovernanceBusyState(true, '工单已创建，正在同步评论列表...');
        const successMessage = payload?.message || '已创建工单';
        showToast(successMessage, 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        prepareCommentReloadState({
            preserveSelection: true,
            focusCommentId: comment.id
        });
        await loadComments(currentCommentView, {
            preserveSelection: true,
            focusCommentId: comment.id
        });
        loadCommentStats(currentCommentView, { showLoading: false });
        if (payload?.ticket_id) {
            setCommentGovernanceBusyState(true, '工单已创建，正在打开工单...');
            await openCommentTicket(payload.ticket_id, comment.id);
        } else {
            setCommentGovernanceBusyState(true, '工单已创建，正在刷新详情...');
            await openCommentDetail(comment.id);
        }
    } catch (error) {
        console.error('Failed to create comment ticket:', error);
        const failureMessage = error.message || '创建工单失败';
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
    } finally {
        setCommentGovernanceBusyState(false);
    }
}

async function updateCommentWorkflowStatus(commentId, status) {
    const comment = getCommentById(commentId);
    if (!comment) {
        return;
    }

    try {
        setCommentWorkflowBusyState(true, '正在更新 Workflow 状态...');
        await mutateAdminCommentWorkflow({
            action: 'set_status',
            site: comment.site || getCommentsReadSite(),
            entityType: comment.entity_type,
            entityId: comment.id,
            status
        });
        const statusLabel = getCommentWorkflowStatusMeta(status).label || '新状态';
        const successMessage = `评论状态已更新为 ${statusLabel}`;
        showToast('状态已更新', 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        prepareCommentReloadState({
            preserveSelection: true,
            focusCommentId: comment.id
        });
        await loadComments(currentCommentView, {
            preserveSelection: true,
            focusCommentId: comment.id
        });
        loadCommentStats(currentCommentView, { showLoading: false });
        await openCommentDetail(comment.id);
    } catch (error) {
        console.error('Failed to update comment workflow status:', error);
        const failureMessage = error.message || '状态更新失败';
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
    } finally {
        setCommentWorkflowBusyState(false);
    }
}

async function assignCommentWorkflowSelf(commentId) {
    const comment = getCommentById(commentId);
    if (!comment) {
        return;
    }

    try {
        setCommentWorkflowBusyState(true, '正在指派 Workflow...');
        await mutateAdminCommentWorkflow({
            action: 'assign_self',
            site: comment.site || getCommentsReadSite(),
            entityType: comment.entity_type,
            entityId: comment.id
        });
        const successMessage = '评论已指派给当前管理员';
        showToast('已指派给当前管理员', 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        await loadComments(currentCommentView, {
            preserveSelection: true,
            focusCommentId: comment.id
        });
        await openCommentDetail(comment.id);
    } catch (error) {
        console.error('Failed to assign comment workflow:', error);
        const failureMessage = error.message || '指派失败';
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
    } finally {
        setCommentWorkflowBusyState(false);
    }
}

async function toggleCommentWorkflowPriority(commentId) {
    const comment = getCommentById(commentId);
    if (!comment) {
        return;
    }

    const currentPriority = String(getCommentWorkflow(comment).priority || 'normal').trim().toLowerCase();
    const nextPriority = currentPriority === 'high' ? 'normal' : 'high';

    try {
        setCommentWorkflowBusyState(true, nextPriority === 'high' ? '正在标记高优先...' : '正在恢复常规优先级...');
        await mutateAdminCommentWorkflow({
            action: 'set_priority',
            site: comment.site || getCommentsReadSite(),
            entityType: comment.entity_type,
            entityId: comment.id,
            priority: nextPriority
        });
        const successMessage = nextPriority === 'high' ? '评论已标记高优先' : '评论已恢复常规优先级';
        showToast(nextPriority === 'high' ? '已标记高优先' : '已恢复常规优先级', 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        await loadComments(currentCommentView, {
            preserveSelection: true,
            focusCommentId: comment.id
        });
        await openCommentDetail(comment.id);
    } catch (error) {
        console.error('Failed to toggle comment priority:', error);
        const failureMessage = error.message || '优先级更新失败';
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
    } finally {
        setCommentWorkflowBusyState(false);
    }
}

async function editCommentWorkflowTags(commentId) {
    const comment = getCommentById(commentId);
    if (!comment) {
        return;
    }

    const currentTags = Array.isArray(getCommentWorkflow(comment).tags)
        ? getCommentWorkflow(comment).tags
        : [];
    const nextValue = window.prompt('请输入标签，使用英文逗号分隔', currentTags.join(', '));
    if (nextValue === null) {
        return;
    }

    try {
        setCommentWorkflowBusyState(true, '正在保存 Workflow 标签...');
        await mutateAdminCommentWorkflow({
            action: 'set_tags',
            site: comment.site || getCommentsReadSite(),
            entityType: comment.entity_type,
            entityId: comment.id,
            tags: nextValue
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
        });
        const successMessage = '评论标签已更新';
        showToast('标签已更新', 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        await loadComments(currentCommentView, {
            preserveSelection: true,
            focusCommentId: comment.id
        });
        await openCommentDetail(comment.id);
    } catch (error) {
        console.error('Failed to update comment tags:', error);
        const failureMessage = error.message || '标签更新失败';
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
    } finally {
        setCommentWorkflowBusyState(false);
    }
}

async function addCommentWorkflowNote(commentId) {
    const comment = getCommentById(commentId);
    const input = document.getElementById('commentWorkflowNoteInput');
    const note = String(input?.value || '').trim();

    if (!comment) {
        return;
    }
    if (!note) {
        showToast('请先填写备注', 'info');
        return;
    }

    try {
        setCommentWorkflowBusyState(true, '正在保存 Workflow 备注...');
        await mutateAdminCommentWorkflow({
            action: 'add_note',
            site: comment.site || getCommentsReadSite(),
            entityType: comment.entity_type,
            entityId: comment.id,
            note
        });
        if (input) {
            input.value = '';
        }
        const successMessage = '评论备注已添加';
        showToast('备注已添加', 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        await loadComments(currentCommentView, {
            preserveSelection: true,
            focusCommentId: comment.id
        });
        await openCommentDetail(comment.id);
    } catch (error) {
        console.error('Failed to add comment note:', error);
        const failureMessage = error.message || '备注保存失败';
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
    } finally {
        setCommentWorkflowBusyState(false);
    }
}

async function fetchAllFilteredCommentsForExport(view) {
    const baseParams = buildCommentsListRequestParams(view, {
        page: 1,
        pageSize: COMMENTS_EXPORT_PAGE_SIZE
    });
    const firstPayload = await fetchAdminCommentsList(baseParams);
    const pages = Math.max(1, Number(firstPayload?.pagination?.totalPages || 1));
    const allRows = Array.isArray(firstPayload?.comments) ? [...firstPayload.comments] : [];

    for (let page = 2; page <= pages; page += 1) {
        const payload = await fetchAdminCommentsList({
            ...baseParams,
            page
        });
        if (Array.isArray(payload?.comments) && payload.comments.length > 0) {
            allRows.push(...payload.comments);
        }
    }

    return allRows;
}


/**
 * Load comments from database
 */
async function loadComments(view, options = {}) {
    console.log('loadComments called for view:', view);
    // Render active filters
    renderCommentsPromptContextBar();
    renderFilterTags();

    const normalizedView = view === 'gallery' ? 'gallery' : 'guestbook';
    if (normalizedView !== 'gallery' && filterState.promptId) {
        filterState.promptId = '';
        filterState.promptTitle = '';
        renderCommentsPromptContextBar();
        renderFilterTags();
    }
    const normalizedOptions = {
        resetPage: options?.resetPage === true,
        preserveSelection: options?.preserveSelection === true,
        focusCommentId: String(options?.focusCommentId || '').trim(),
        page: options?.page == null ? null : normalizeCommentsPage(options.page, commentsPaginationState.page)
    };

    if (commentsLoading) {
        pendingCommentsLoadRequest = {
            view: normalizedView,
            options: normalizedOptions
        };
        console.warn('Comments already loading, queueing latest request...');
        return;
    }

    if (normalizedOptions.resetPage) {
        commentsPaginationState.page = 1;
    }
    if (normalizedOptions.page != null) {
        commentsPaginationState.page = normalizedOptions.page;
    }
    if (!normalizedOptions.preserveSelection) {
        clearRetainedCommentSelection();
        updateSelectionUI(0);
        const selectAll = document.getElementById('selectAllComments');
        if (selectAll) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
        }
    }
    if (normalizedOptions.focusCommentId) {
        pendingFocusedCommentId = normalizedOptions.focusCommentId;
    }

    commentsLoading = true;

    const listContainer = document.getElementById('adminCommentList');
    if (!listContainer) {
        console.error('adminCommentList container not found!');
        commentsLoading = false;
        return;
    }

    listContainer.innerHTML = buildCommentLoadingSkeleton();
    let requestSite = getCommentsReadSite();

    try {
        const requestParams = buildCommentsListRequestParams(normalizedView, {
            page: commentsPaginationState.page
        });
        requestSite = requestParams.site || requestSite;
        const requestCacheKey = buildCommentsViewCacheKey(requestParams);
        const cachedPayload = getCommentsCachedPayload(normalizedView, requestParams);
        const inFlightPrefetch = !cachedPayload
            && commentsViewPrefetchPromise
            && commentsViewPrefetchTaskKey === requestCacheKey
            ? commentsViewPrefetchPromise
            : null;

        console.log('Fetching comments...', requestParams);
        const payload = cachedPayload || await (inFlightPrefetch || fetchAdminCommentsList(requestParams));
        if (!isCurrentCommentsSite(requestParams.site)) {
            return false;
        }
        if (!cachedPayload) {
            storeCommentsCachedPayload(normalizedView, requestParams, payload);
        }
        const data = Array.isArray(payload?.comments) ? payload.comments : [];

        commentsData = data;
        commentsById = new Map(data.map((comment) => [String(comment?.id || '').trim(), comment]).filter(([id]) => Boolean(id)));
        filteredComments = data;
        updateCommentsPaginationState(payload?.pagination, data.length);
        syncAdminCommentsRouteState({
            view: normalizedView,
            queue: filterState.queue,
            promptId: normalizedView === 'gallery' ? filterState.promptId : '',
            promptTitle: normalizedView === 'gallery' ? filterState.promptTitle : '',
            focusCommentId: pendingFocusedCommentId
        });
        renderCommentList(filteredComments);
        renderCommentsPagination();
        restoreCommentSelectionState();
        if (pendingFocusedCommentId) {
            focusCommentCard(pendingFocusedCommentId);
            pendingFocusedCommentId = '';
        }
        scheduleCommentsViewPrefetch(normalizedView);

    } catch (error) {
        if (!isCurrentCommentsSite(requestSite)) {
            return false;
        }
        console.error('Error loading comments:', error);
        commentsById = new Map();
        commentsPaginationState.totalItems = 0;
        commentsPaginationState.totalPages = 1;
        clearRetainedCommentSelection();
        pendingFocusedCommentId = '';
        listContainer.innerHTML = `<p class="error-text">加载失败: ${error.message || '未知错误'}</p>`;
        renderCommentsPagination();
    } finally {
        commentsLoading = false;
        console.log('Comments loading finished.');
        if (pendingCommentsLoadRequest) {
            const nextRequest = pendingCommentsLoadRequest;
            pendingCommentsLoadRequest = null;
            void loadComments(nextRequest.view, nextRequest.options);
        }
    }
}

/**
 * Render comment list
 */
function renderCommentList(comments) {
    const container = document.getElementById('adminCommentList');
    if (!container) return;

    if (comments.length === 0) {
        container.innerHTML = '<p class="empty-text">暂无评论</p>';
        return;
    }

    container.innerHTML = comments.map(comment => {
        const { avatarClassName, avatarMarkup } = buildCommentAvatarMarkup(comment);
        const timeStr = formatTimeAgo(comment.created_at);
        const contextUrl = buildCommentContextUrl(comment);
        const blockState = getCommentCurrentScopeBlockState(comment);
        const anyBlockState = getCommentAnyScopeBlockState(comment);
        const blockBadge = buildCommentUserBlockBadge(comment);
        const workflow = getCommentWorkflow(comment);
        const workflowMeta = getCommentWorkflowStatusMeta(workflow.status);
        const contextTitle = getCommentContextTitle(comment);
        const entityLabel = getCommentEntityLabel(comment);
        const userRiskMeta = getCommentUserRiskMeta(comment);
        const summaryMetric = getCommentSummaryMetricText(comment);
        const ticketPill = getCommentTicketPillMeta(comment);
        const previewSnippet = getCommentPreviewSnippet(comment);

        return `
            <div class="comment-admin-item" data-id="${comment.id}" data-type="${comment.type}" data-user-id="${escapeHtml(comment.user_id || '')}" data-record-type="${comment.record_type || ''}" data-comments-action="open-detail" data-comment-id="${encodeURIComponent(comment.id)}">
                <div class="item-checkbox-wrapper" data-comments-action="toggle-selection" data-checkbox-id="cb-${comment.id}">
                    <input type="checkbox" class="comment-checkbox" id="cb-${comment.id}" 
                        data-id="${comment.id}" data-type="${comment.type}" data-record-type="${comment.record_type || ''}"
                        data-comments-change="selection">
                </div>

                <div class="item-header">
                    <div class="${avatarClassName}">
                        ${avatarMarkup}
                    </div>
                    <div class="item-meta">
                        <div class="item-meta-row">
                            <span class="item-name" title="${escapeHtml(comment.author)}">${escapeHtml(comment.author)}</span>
                            ${blockBadge}
                            <span class="comment-workflow-badge comment-workflow-badge--${escapeHtml(workflowMeta.tone)}">${escapeHtml(workflowMeta.label)}</span>
                        </div>
                        <div class="item-meta-subrow">
                            <span class="item-time">${timeStr}</span>
                            <span class="comment-context-pill">${escapeHtml(getCommentSiteLabel(comment.site))}</span>
                            <span class="comment-context-pill comment-context-pill--entity">${escapeHtml(entityLabel)}</span>
                            ${ticketPill ? `<span class="comment-context-pill comment-context-pill--ticket comment-context-pill--ticket-${escapeHtml(ticketPill.tone)}">${escapeHtml(ticketPill.label)}</span>` : ''}
                        </div>
                    </div>
                </div>

                <div class="item-content">
                    ${contextTitle ? `<div class="item-context-title">${escapeHtml(contextTitle)}</div>` : ''}
                    <p class="item-text">${escapeHtml(comment.content)}</p>
                    ${previewSnippet ? `<div class="item-context-snippet">${escapeHtml(previewSnippet)}</div>` : ''}
                    <div class="item-content-footer">
                        <span class="item-summary-risk item-summary-risk--${escapeHtml(userRiskMeta.tone)}">${escapeHtml(userRiskMeta.label)}</span>
                        <span class="item-summary-metric">${escapeHtml(summaryMetric)}</span>
                    </div>
                </div>

                <div class="item-actions">
                    <div class="action-info-wrapper">
                        <button class="action-info" type="button" data-comments-action="copy-comment-id" data-comment-id="${encodeURIComponent(comment.id)}" data-parent-id="${encodeURIComponent(comment.parent_id || '')}" title="复制 ID">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </div>

                    ${comment.type === 'gallery' && window.hasPermission && window.hasPermission('content.moderate') ? `
                    <button class="action-btn ${comment.is_pinned ? 'active' : ''}" 
                        type="button"
                        data-comments-action="toggle-pin"
                        data-comment-id="${encodeURIComponent(comment.id)}"
                        data-comment-pinned="${comment.is_pinned ? '1' : '0'}"
                        data-prompt-id="${encodeURIComponent(comment.context || '')}"
                        title="${comment.is_pinned ? '取消置顶' : '置顶评论'}">
                        <i class="fas fa-thumbtack${comment.is_pinned ? ' comment-pin-icon--active' : ''}"></i>
                    </button>
                    ` : ''}

                    ${window.hasPermission && window.hasPermission('users.manage') ? `
                    <div class="action-block-wrapper">
                        <!-- Legacy contract marker: action-btn action-block${anyBlockState.blocked ? ' action-btn--blocked' : ''} -->
                        <button class="action-btn action-block${blockState.blocked ? ' action-btn--blocked' : ''}" type="button" data-comments-action="toggle-block-dropdown" data-comment-id="${encodeURIComponent(comment.id)}" data-user-id="${encodeURIComponent(comment.user_id || '')}" title="${anyBlockState.blocked ? `${anyBlockState.label}，点击管理` : '用户管理'}">
                            <i class="fas fa-ban"></i>
                        </button>
                    </div>
                    ` : ''}

                    <button class="action-detail" type="button" data-comments-action="open-detail" data-comment-id="${encodeURIComponent(comment.id)}" title="查看治理详情">
                        <i class="fas fa-expand"></i>
                    </button>

                    ${comment.context ?
                `<button class="action-view" type="button" data-comments-action="view-comment-context" data-context-url="${encodeURIComponent(contextUrl)}" title="查看上下文">
                        <i class="fas fa-external-link-alt"></i>
                    </button>` : ''}

                    ${window.hasPermission && window.hasPermission('content.moderate') ? `
                    <button class="action-delete" type="button" data-comments-action="delete-comment" data-comment-id="${encodeURIComponent(comment.id)}" data-comment-type="${encodeURIComponent(comment.type)}" data-comment-record-type="${encodeURIComponent(comment.record_type || '')}" title="删除" aria-label="删除评论">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </div>

            </div>
        `;
    }).join('');
}

/**
 * Item selection handler (triggered by checkbox area click)
 */
function toggleCommentSelection(event, checkboxId) {
    if (!isCommentsSelectMode) {
        return;
    }

    // Ignore if clicked on button or link or input
    if (event.target.closest('button') || event.target.closest('a') || event.target.closest('input')) {
        return;
    }

    const checkbox = document.getElementById(checkboxId);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        updateSelection();
    }
}

function toggleCommentSelectionById(commentId = '') {
    if (!isCommentsSelectMode) {
        return;
    }

    const normalizedId = String(commentId || '').trim();
    if (!normalizedId) {
        return;
    }

    const checkbox = document.getElementById(`cb-${normalizedId}`);
    if (!checkbox) {
        return;
    }

    checkbox.checked = !checkbox.checked;
    updateSelection();
}

/**
 * Reset selection state
 */
function resetSelection() {
    clearRetainedCommentSelection();
    updateSelectionUI(0);
}

/**
 * Select all visible comments on current page
 */
function selectAllVisibleComments() {
    if (!isCommentsSelectMode) {
        return;
    }

    const checkboxes = document.querySelectorAll('.comment-checkbox');
    const nextSelectedIds = new Set();

    checkboxes.forEach(cb => {
        cb.checked = true;
        const item = cb.closest('.comment-admin-item');
        if (item) {
            item.classList.add('selected');
        }
        const commentId = String(cb.dataset.id || '').trim();
        if (commentId) {
            nextSelectedIds.add(commentId);
        }
    });

    retainedSelectedCommentIds = nextSelectedIds;
    updateSelectionUI(checkboxes.length);
    closeCommentsBatchMenu();
}

function toggleSelectAll() {
    selectAllVisibleComments();
}

/**
 * Update selection when individual checkbox changes
 */
function updateSelection() {
    const checkboxes = document.querySelectorAll('.comment-checkbox');
    const checked = document.querySelectorAll('.comment-checkbox:checked');
    retainedSelectedCommentIds = new Set(
        Array.from(checked)
            .map((checkbox) => String(checkbox.dataset.id || '').trim())
            .filter(Boolean)
    );

    // Update item selected state
    checkboxes.forEach(cb => {
        const item = cb.closest('.comment-admin-item');
        if (item) {
            item.classList.toggle('selected', cb.checked);
        }
    });

    updateSelectionUI(checked.length);
}

/**
 * Update selection UI (count and button state)
 */
function updateSelectionUI(count) {
    const countEl = document.getElementById('selectionCount');
    const batchMenuTrigger = document.getElementById('commentsBatchMenuTrigger');

    // Update Export text options
    const exportCsvBtn = document.querySelector('.export-popup .filter-option:nth-child(1)');
    const exportJsonBtn = document.querySelector('.export-popup .filter-option:nth-child(2)');

    const contextText = count > 0 ? `(选中 ${count} 项)` : `(当前筛选)`;

    if (exportCsvBtn) exportCsvBtn.innerHTML = `<i class="fas fa-file-csv"></i> 导出 CSV ${contextText}`;
    if (exportJsonBtn) exportJsonBtn.innerHTML = `<i class="fas fa-file-code"></i> 导出 JSON ${contextText}`;

    if (countEl) countEl.textContent = `已选 ${count} 条`;
    if (batchMenuTrigger) batchMenuTrigger.disabled = !isCommentsSelectMode;
    syncCommentsSelectModeUi(count);
}

function setCommentsBatchCardsPending(isPending = false, label = '') {
    document.querySelectorAll('.comment-admin-item.selected, .comment-admin-item.is-batch-pending').forEach((item) => {
        item.classList.toggle('is-batch-pending', Boolean(isPending));
        if (isPending && label) {
            item.dataset.batchPendingLabel = label;
        } else {
            delete item.dataset.batchPendingLabel;
        }
    });
}

function beginCommentsBatchMenuInteraction(actionEl, options = {}) {
    const menuItem = actionEl?.closest?.('.batch-menu-item');
    if (!menuItem) {
        return () => {};
    }

    if (activeCommentsBatchInteraction?.cleanup) {
        activeCommentsBatchInteraction.cleanup({ closeMenu: false });
    }

    const pendingLabel = String(options.pendingLabel || '').trim() || '正在处理...';
    const menuContainer = document.getElementById('commentsBatchMenuContainer');
    const menuTrigger = document.getElementById('commentsBatchMenuTrigger');
    const countWrapper = document.getElementById('commentsSelectionCountWrapper');
    const feedbackEl = document.getElementById('commentsBatchActionFeedback');
    const menuItems = Array.from(document.querySelectorAll('#commentsBatchDropdownMenu .batch-menu-item'));
    const iconEl = menuItem.querySelector('i');
    const originalIconClass = iconEl?.className || '';

    menuContainer?.classList.add('open', 'is-busy');
    if (menuContainer) {
        menuContainer.dataset.busy = 'true';
    }
    if (menuTrigger) {
        menuTrigger.disabled = true;
        menuTrigger.classList.add('is-busy');
    }

    menuItems.forEach((item) => {
        const isCurrent = item === menuItem;
        item.classList.toggle('is-pending', isCurrent);
        if (!isCurrent) {
            item.classList.add('is-disabled');
            item.setAttribute('aria-disabled', 'true');
        } else {
            item.removeAttribute('aria-disabled');
        }
    });

    if (iconEl) {
        iconEl.className = 'fas fa-spinner fa-spin';
    }

    if (countWrapper) {
        countWrapper.dataset.batchBusy = 'true';
    }
    if (feedbackEl) {
        feedbackEl.hidden = false;
        feedbackEl.textContent = pendingLabel;
    }

    setCommentsBatchCardsPending(true, pendingLabel);

    const cleanup = ({ closeMenu = true } = {}) => {
        menuItems.forEach((item) => {
            item.classList.remove('is-pending', 'is-disabled');
            item.removeAttribute('aria-disabled');
        });

        if (iconEl && originalIconClass) {
            iconEl.className = originalIconClass;
        }

        if (menuTrigger) {
            menuTrigger.disabled = false;
            menuTrigger.classList.remove('is-busy');
        }

        if (menuContainer) {
            delete menuContainer.dataset.busy;
            menuContainer.classList.remove('is-busy');
        }

        if (countWrapper) {
            delete countWrapper.dataset.batchBusy;
        }
        if (feedbackEl) {
            feedbackEl.hidden = true;
            feedbackEl.textContent = '';
        }

        setCommentsBatchCardsPending(false);

        if (closeMenu) {
            closeCommentsBatchMenu(true);
        }

        if (activeCommentsBatchInteraction?.cleanup === cleanup) {
            activeCommentsBatchInteraction = null;
        }
    };

    activeCommentsBatchInteraction = {
        cleanup
    };

    return cleanup;
}

function isAdminCommentsActionButton(actionEl) {
    return Boolean(actionEl && actionEl.nodeType === 1 && actionEl.tagName === 'BUTTON');
}

function isAdminCommentsCompactActionButton(button) {
    if (!isAdminCommentsActionButton(button)) {
        return false;
    }

    return button.matches('.action-info, .action-btn, .action-detail, .action-view, .action-delete')
        || button.closest('.comment-admin-item') instanceof HTMLElement;
}

function renderAdminCommentsActionButtonFeedback(button, state, text, options = {}) {
    if (!isAdminCommentsActionButton(button)) {
        return;
    }

    const normalizedState = ['loading', 'saved', 'failed'].includes(state) ? state : 'loading';
    const label = String(text || '').trim()
        || (normalizedState === 'loading' ? '处理中...' : normalizedState === 'failed' ? '操作失败' : '已完成');
    const compact = options.compact !== false && isAdminCommentsCompactActionButton(button);
    const iconClass = normalizedState === 'loading'
        ? 'fas fa-spinner fa-spin'
        : (normalizedState === 'failed' ? 'fas fa-exclamation-triangle' : 'fas fa-check');

    button.dataset.commentsActionFeedbackState = normalizedState;
    button.disabled = true;
    button.setAttribute('aria-busy', normalizedState === 'loading' ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = compact
        ? `<i class="${iconClass}" aria-hidden="true"></i><span class="admin-comments-action-feedback__sr">${escapeHtml(label)}</span>`
        : `<i class="${iconClass}" aria-hidden="true"></i><span class="admin-comments-action-feedback__label">${escapeHtml(label)}</span>`;
}

function beginAdminCommentsActionButtonFeedback(actionEl, options = {}) {
    if (!isAdminCommentsActionButton(actionEl)) {
        return () => {};
    }

    if (actionEl.dataset.commentsActionFeedbackRunning === 'true') {
        return () => {};
    }

    const snapshot = {
        html: actionEl.innerHTML,
        disabled: actionEl.disabled,
        title: actionEl.getAttribute('title'),
        ariaLabel: actionEl.getAttribute('aria-label')
    };
    const restoreDelayMs = Number.isFinite(Number(options.restoreDelayMs))
        ? Number(options.restoreDelayMs)
        : 900;

    actionEl.dataset.commentsActionFeedbackRunning = 'true';
    renderAdminCommentsActionButtonFeedback(actionEl, 'loading', options.loadingText || '处理中...', options);

    return ({ state = 'restore', text = '', restore = true } = {}) => {
        const normalizedState = ['saved', 'failed'].includes(state) ? state : 'restore';

        const restoreButton = () => {
            actionEl.innerHTML = snapshot.html;
            actionEl.disabled = Boolean(snapshot.disabled);
            if (snapshot.title === null) {
                actionEl.removeAttribute('title');
            } else {
                actionEl.setAttribute('title', snapshot.title);
            }
            if (snapshot.ariaLabel === null) {
                actionEl.removeAttribute('aria-label');
            } else {
                actionEl.setAttribute('aria-label', snapshot.ariaLabel);
            }
            actionEl.removeAttribute('aria-busy');
            actionEl.removeAttribute('data-comments-action-feedback-state');
            delete actionEl.dataset.commentsActionFeedbackRunning;
        };

        if (normalizedState === 'restore') {
            restoreButton();
            return;
        }

        const feedbackText = text
            || (normalizedState === 'failed' ? options.errorText : options.successText)
            || (normalizedState === 'failed' ? '操作失败' : '已完成');
        renderAdminCommentsActionButtonFeedback(actionEl, normalizedState, feedbackText, options);

        if (restore !== false) {
            window.setTimeout(restoreButton, Math.max(0, restoreDelayMs));
        }
    };
}

function beginAdminCommentsMenuOptionFeedback(actionEl, options = {}) {
    const optionEl = actionEl?.closest?.('.filter-option');
    if (!optionEl) {
        return () => {};
    }

    if (optionEl.dataset.commentsActionFeedbackRunning === 'true') {
        return () => {};
    }

    const snapshot = {
        html: optionEl.innerHTML,
        title: optionEl.getAttribute('title'),
        ariaDisabled: optionEl.getAttribute('aria-disabled')
    };
    const restoreDelayMs = Number.isFinite(Number(options.restoreDelayMs))
        ? Number(options.restoreDelayMs)
        : 900;

    const renderOptionFeedback = (state, text) => {
        const normalizedState = ['loading', 'saved', 'failed'].includes(state) ? state : 'loading';
        const label = String(text || '').trim()
            || (normalizedState === 'loading' ? '处理中...' : normalizedState === 'failed' ? '操作失败' : '已完成');
        const iconClass = normalizedState === 'loading'
            ? 'fas fa-spinner fa-spin'
            : (normalizedState === 'failed' ? 'fas fa-exclamation-triangle' : 'fas fa-check');

        optionEl.dataset.commentsActionFeedbackState = normalizedState;
        optionEl.setAttribute('aria-busy', normalizedState === 'loading' ? 'true' : 'false');
        optionEl.setAttribute('aria-disabled', 'true');
        optionEl.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i> ${escapeHtml(label)}`;
    };

    const restoreOption = () => {
        optionEl.innerHTML = snapshot.html;
        if (snapshot.title === null) {
            optionEl.removeAttribute('title');
        } else {
            optionEl.setAttribute('title', snapshot.title);
        }
        if (snapshot.ariaDisabled === null) {
            optionEl.removeAttribute('aria-disabled');
        } else {
            optionEl.setAttribute('aria-disabled', snapshot.ariaDisabled);
        }
        optionEl.removeAttribute('aria-busy');
        optionEl.removeAttribute('data-comments-action-feedback-state');
        delete optionEl.dataset.commentsActionFeedbackRunning;
    };

    optionEl.dataset.commentsActionFeedbackRunning = 'true';
    renderOptionFeedback('loading', options.loadingText || '处理中...');

    return ({ state = 'restore', text = '', restore = true } = {}) => {
        const normalizedState = ['saved', 'failed'].includes(state) ? state : 'restore';
        if (normalizedState === 'restore') {
            restoreOption();
            return;
        }

        const feedbackText = text
            || (normalizedState === 'failed' ? options.errorText : options.successText)
            || (normalizedState === 'failed' ? '操作失败' : '已完成');
        renderOptionFeedback(normalizedState, feedbackText);
        if (restore !== false) {
            window.setTimeout(restoreOption, Math.max(0, restoreDelayMs));
        }
    };
}

function closeCommentsBatchMenu(force = false) {
    const container = document.getElementById('commentsBatchMenuContainer');
    const trigger = document.getElementById('commentsBatchMenuTrigger');
    if (!force && container?.dataset?.busy === 'true') {
        return;
    }
    if (container) {
        container.classList.remove('open');
    }
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
    }
}

function toggleCommentsBatchMenu() {
    const container = document.getElementById('commentsBatchMenuContainer');
    const trigger = document.getElementById('commentsBatchMenuTrigger');
    if (!container || !trigger || trigger.disabled || container.dataset.busy === 'true') {
        return;
    }

    const isOpen = container.classList.toggle('open');
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function clearSelectedComments(options = {}) {
    if (options.closeMenu !== false) {
        closeCommentsBatchMenu();
    }
    resetSelection();
    document.querySelectorAll('.comment-checkbox').forEach((checkbox) => {
        checkbox.checked = false;
    });
    document.querySelectorAll('.comment-admin-item.selected').forEach((item) => {
        item.classList.remove('selected');
    });
}

function setCommentsSelectMode(nextMode, options = {}) {
    const shouldEnable = Boolean(nextMode);
    const shouldAutoOpenMenu = Boolean(options.autoOpenMenu);
    const shouldClearSelectionOnDisable = options.clearSelectionOnDisable !== false;

    if (shouldEnable === isCommentsSelectMode) {
        syncCommentsSelectModeUi();
        return;
    }

    isCommentsSelectMode = shouldEnable;

    if (!shouldEnable) {
        closeCommentsBatchMenu();
        if (shouldClearSelectionOnDisable) {
            clearSelectedComments({ closeMenu: false });
        }
    }

    syncCommentsSelectModeUi();
    updateSelectionUI(document.querySelectorAll('.comment-checkbox:checked').length);

    if (shouldEnable && shouldAutoOpenMenu) {
        const container = document.getElementById('commentsBatchMenuContainer');
        const trigger = document.getElementById('commentsBatchMenuTrigger');
        if (container && trigger) {
            container.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        }
    }
}

function toggleCommentsSelectMode() {
    setCommentsSelectMode(!isCommentsSelectMode, {
        autoOpenMenu: false,
        clearSelectionOnDisable: true
    });
}

async function batchSetCommentWorkflowStatus(status = '', actionEl = null) {
    const selectedComments = getSelectedComments();
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const statusLabels = {
        pending: '待处理',
        in_review: '复核中',
        resolved: '已解决',
        ignored: '已忽略'
    };

    if (!selectedComments.length) {
        notifyCommentsBatchRecovery('请先勾选要处理的评论，或在批量菜单中使用“全选当前页”。');
        return;
    }

    if (!statusLabels[normalizedStatus]) {
        notifyCommentsBatchRecovery('批量状态无效，请重新打开批量菜单后再试。');
        return;
    }

    const writableSite = requireWritableCommentsSite({ label: `批量评论设为${statusLabels[normalizedStatus]}` });
    if (!writableSite) {
        notifyCommentsBatchRecovery('批量评论治理需要先在站点筛选中选择 CN 或 INTL，all 视图仅用于查看。');
        return;
    }

    const finishInteraction = beginCommentsBatchMenuInteraction(actionEl, {
        pendingLabel: `正在批量设为${statusLabels[normalizedStatus]}...`
    });
    let successCount = 0;
    let failedCount = 0;
    try {
        for (const comment of selectedComments) {
            try {
                await mutateAdminCommentWorkflow({
                    action: 'set_status',
                    site: writableSite,
                    entityType: comment.entity_type,
                    entityId: comment.id,
                    status: normalizedStatus
                });
                successCount += 1;
            } catch (error) {
                failedCount += 1;
                console.error('[Comments] Batch workflow status update failed:', comment?.id, error);
            }
        }

        clearSelectedComments({ closeMenu: false });
        await loadComments(currentCommentView, { resetPage: true });
        loadCommentStats(currentCommentView, { showLoading: false });

        if (failedCount > 0) {
            const resultMessage = `批量处理完成：成功 ${successCount} 条，失败 ${failedCount} 条`;
            showToast(resultMessage, successCount > 0 ? 'warning' : 'error');
            emitCommentsCommandFeedback(resultMessage, successCount > 0 ? 'partial' : 'failed', { source: 'comments-batch' });
            return;
        }

        const successMessage = `已批量设为${statusLabels[normalizedStatus]}（${successCount} 条）`;
        showToast(successMessage, 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-batch' });
    } finally {
        finishInteraction({ closeMenu: true });
    }
}

async function batchAssignCommentWorkflowSelf(actionEl = null) {
    const selectedComments = getSelectedComments();
    if (!selectedComments.length) {
        notifyCommentsBatchRecovery('请先勾选要指派的评论，或在批量菜单中使用“全选当前页”。');
        return;
    }

    const writableSite = requireWritableCommentsSite({ label: '批量评论指派给我' });
    if (!writableSite) {
        notifyCommentsBatchRecovery('批量评论指派需要先在站点筛选中选择 CN 或 INTL，all 视图仅用于查看。');
        return;
    }

    const finishInteraction = beginCommentsBatchMenuInteraction(actionEl, {
        pendingLabel: '正在批量指派给我...'
    });
    let successCount = 0;
    let failedCount = 0;
    try {
        for (const comment of selectedComments) {
            try {
                await mutateAdminCommentWorkflow({
                    action: 'assign_self',
                    site: writableSite,
                    entityType: comment.entity_type,
                    entityId: comment.id
                });
                successCount += 1;
            } catch (error) {
                failedCount += 1;
                console.error('[Comments] Batch assign-self failed:', comment?.id, error);
            }
        }

        clearSelectedComments({ closeMenu: false });
        await loadComments(currentCommentView, { resetPage: true });

        if (failedCount > 0) {
            const resultMessage = `批量指派完成：成功 ${successCount} 条，失败 ${failedCount} 条`;
            showToast(resultMessage, successCount > 0 ? 'warning' : 'error');
            emitCommentsCommandFeedback(resultMessage, successCount > 0 ? 'partial' : 'failed', { source: 'comments-batch' });
            return;
        }

        const successMessage = `已批量指派给我（${successCount} 条）`;
        showToast(successMessage, 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-batch' });
    } finally {
        finishInteraction({ closeMenu: true });
    }
}

/**
 * Export data function
 * format: 'csv' | 'json'
 */
async function exportData(format, actionEl = null) {
    const finishMenuFeedback = beginAdminCommentsMenuOptionFeedback(actionEl, {
        loadingText: '导出中...',
        successText: '已导出',
        errorText: '导出失败'
    });

    try {
        const checked = document.querySelectorAll('.comment-checkbox:checked');
        let sourceData = [];

        // 1. Determine Data Source
        if (checked.length > 0) {
            // Export selected items from current filtered list
            const selectedIds = Array.from(checked).map(cb => cb.dataset.id);
            sourceData = filteredComments.filter(c => selectedIds.includes(c.id));
        } else {
            // Export all filtered items across every page
            sourceData = await fetchAllFilteredCommentsForExport(currentCommentView);
        }

        if (sourceData.length === 0) {
            alert('无数据可导出');
            finishMenuFeedback();
            return null;
        }

        // 2. Generate Content
        let content = '';
        let mimeType = '';
        let extension = '';
        const timestamp = new Date().toISOString().slice(0, 10);

        if (format === 'csv') {
            // CSV Generation with BOM for Excel
            content = generateCSV(sourceData);
            mimeType = 'text/csv;charset=utf-8;';
            extension = 'csv';
        } else {
            // JSON Generation
            content = JSON.stringify(sourceData, null, 2);
            mimeType = 'application/json';
            extension = 'json';
        }

        // 3. Trigger Download
        const blob = new Blob([format === 'csv' ? '\ufeff' + content : content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `comments_export_${timestamp}.${extension}`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        finishMenuFeedback({ state: 'saved', text: '已导出' });
        return true;
    } catch (error) {
        console.error('Export comments error:', error);
        finishMenuFeedback({ state: 'failed', text: '导出失败' });
        showToast('导出评论失败: ' + (error.message || '未知错误'), 'error');
        return false;
    }
}

/**
 * Helper: Generate CSV string from comments
 */
function generateCSV(data) {
    // Define columns
    const columns = [
        { header: 'ID', key: 'id' },
        { header: 'Author', key: 'author' },
        { header: 'Email', key: 'email' },
        { header: 'Content', key: 'content' },
        { header: 'Date', key: 'created_at' },
        { header: 'Type', key: 'type' },
        { header: 'Entity', key: 'entity_label' },
        { header: 'Context', key: 'context_title' },
        { header: 'Likes', key: 'likes' },
        { header: 'Replies', key: 'reply_count' },
        { header: 'Workflow', key: 'workflow_status' },
        { header: 'Tickets', key: 'ticket_count' },
        { header: 'Prompt Title', key: 'prompt_title' },
        { header: 'Prompt ID', key: 'context' },
        { header: 'Parent ID', key: 'parent_id' }
    ];

    // Create Header Row
    const headerRow = columns.map(col => `"${col.header}"`).join(',');

    // Create Data Rows
    const dataRows = data.map(item => {
        return columns.map(col => {
            let val = item[col.key] || '';

            if (col.key === 'workflow_status') {
                val = getCommentWorkflow(item).status || '';
            }
            if (col.key === 'ticket_count') {
                val = getCommentWorkflow(item).linked_ticket_count || 0;
            }

            // Format specific fields
            if (col.key === 'content') {
                // Escape quotes and handle newlines for CSV
                val = val.replace(/"/g, '""'); // Double quotes
                val = val.replace(/\n/g, ' '); // Replace newlines with space
            }
            if (col.key === 'created_at') {
                val = new Date(val).toLocaleString('zh-CN');
            }

            return `"${val}"`;
        }).join(',');
    });

    return [headerRow, ...dataRows].join('\n');
}

/**
 * Batch delete selected comments
 */
async function batchDeleteComments(actionEl = null) {
    const checked = document.querySelectorAll('.comment-checkbox:checked');
    if (checked.length === 0) {
        notifyCommentsBatchRecovery('请先勾选要删除的评论，或在批量菜单中使用“全选当前页”。');
        return;
    }

    const writableSite = requireWritableCommentsSite({ action: 'comments-batch-delete' });
    if (!writableSite) {
        notifyCommentsBatchRecovery('批量删除评论需要先在站点筛选中选择 CN 或 INTL，all 视图仅用于查看。');
        return;
    }

    if (!confirm(`确定要删除选中的 ${checked.length} 条评论吗？此操作无法撤销。`)) return;
    const moderationReason = String(window.prompt('可选：填写移除原因（会通知用户）', '') || '').trim();

    const items = Array.from(checked).map(cb => ({
        id: cb.dataset.id,
        type: cb.dataset.type,
        recordType: cb.dataset.recordType || ''
    }));
    const deletedIds = items.map((item) => item.id).filter(Boolean);
    const finishInteraction = beginCommentsBatchMenuInteraction(actionEl, {
        pendingLabel: `正在批量删除 ${items.length} 条评论...`
    });

    try {
        const payload = await moderateCommentsViaAdminApi({
            items,
            site: writableSite,
            action: 'delete_many',
            reason: moderationReason
        });
        const deleted = Number(payload?.deletedCount || 0);
        const cascadeDeleted = Number(payload?.cascadeDeletedCount || 0);
        prepareCommentReloadState({
            preserveSelection: true,
            removeSelectionIds: deletedIds
        });
        const successMessage = cascadeDeleted > 0
            ? `成功删除 ${deleted} 条内容（含级联 ${cascadeDeleted} 条）`
            : `成功删除 ${deleted} 条评论`;
        showToast(successMessage, 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-batch' });
        clearSelectedComments({ closeMenu: false });
        loadComments(currentCommentView, { preserveSelection: true });
        loadCommentStats(currentCommentView, { showLoading: false });
    } catch (error) {
        console.error('Batch delete error:', error);
        const failureMessage = '批量删除失败: ' + error.message;
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-batch' });
    } finally {
        finishInteraction({ closeMenu: true });
    }
}

/**
 * Delete a comment
 */
async function deleteComment(id, type, recordType = '', actionEl = null) {
    const writableSite = requireWritableCommentsSite({
        label: recordType === 'message' ? '删除留言主贴' : '删除评论'
    });
    if (!writableSite) {
        return false;
    }

    if (!confirm('确定要删除这条评论吗？此操作无法撤销。')) return null;
    const moderationReason = String(window.prompt('可选：填写移除原因（会通知用户）', '') || '').trim();

    const finishButtonFeedback = beginAdminCommentsActionButtonFeedback(actionEl, {
        loadingText: '删除中...',
        successText: '已删除',
        errorText: '删除失败'
    });

    try {
        const fallbackFocusId = findAdjacentCommentId(id, [id]);
        const payload = await moderateCommentsViaAdminApi({
            site: writableSite,
            action: 'delete',
            reason: moderationReason,
            items: [{
                id,
                type,
                recordType
            }]
        });

        // Remove from UI
        const item = document.querySelector(`.comment-admin-item[data-id="${id}"]`);
        if (item) {
            item.classList.add('comment-admin-item--removing');
            setTimeout(() => item.remove(), 200);
        }

        // Refresh list first, then sync stats in the background.
        prepareCommentReloadState({
            preserveSelection: true,
            removeSelectionIds: [id],
            focusCommentId: fallbackFocusId
        });
        loadComments(currentCommentView, {
            preserveSelection: true,
            focusCommentId: fallbackFocusId
        });
        loadCommentStats(currentCommentView, { showLoading: false });
        const cascadeDeleted = Number(payload?.cascadeDeletedCount || 0);
        const deleted = Number(payload?.deletedCount || 0);
        const successMessage = cascadeDeleted > 0
            ? `已删除 ${deleted} 条内容（含级联 ${cascadeDeleted} 条）`
            : '评论已删除';
        finishButtonFeedback({ state: 'saved', text: '已删除', restore: false });
        showToast(successMessage, 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        return true;

    } catch (error) {
        console.error('Error deleting comment:', error);
        const failureMessage = '删除失败: ' + error.message;
        finishButtonFeedback({ state: 'failed', text: '删除失败' });
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
        return false;
    }
}

/**
 * View comment context in a dedicated tab
 */
function viewCommentContext(contextUrl) {
    const targetUrl = String(contextUrl || '').trim();
    if (!targetUrl) {
        return;
    }

    window.open(targetUrl, '_blank');
}

/**
 * Format time ago
 */
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}天前`;

    return date.toLocaleDateString('zh-CN');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show toast notification
 */
const showToast = (message, type = 'info') => {
    const normalizedMessage = String(message ?? '').trim();
    const normalizedType = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';

    if (!normalizedMessage) return null;

    if (typeof window.showToast === 'function' && window.showToast !== showToast) {
        return window.showToast(normalizedMessage, normalizedType, {
            module: 'comments'
        });
    }

    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('admin-feedback-signal', {
                detail: {
                    kind: 'toast',
                    source: 'admin-comments',
                    state: normalizedType === 'success'
                        ? 'saved'
                        : (normalizedType === 'warning'
                            ? 'partial'
                            : (normalizedType === 'error' ? 'failed' : 'loading')),
                    tone: normalizedType,
                    message: normalizedMessage,
                    module: 'comments',
                    timestamp: Date.now()
                }
            }));
        } catch (_) {
            // Ignore feedback bus failures so the local toast still renders.
        }
    }

    const container = document.getElementById('toastContainer');
    if (!container) return null;

    const toast = document.createElement('div');
    toast.className = `toast toast-${normalizedType}`;
    toast.innerHTML = `
        <i class="fas fa-${normalizedType === 'success' ? 'check-circle' : normalizedType === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${normalizedMessage}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);

    return toast;
};

// Current source filter state
let currentSourceFilter = 'all';

// Current layout view state (grid or list)
let currentViewLayout = localStorage.getItem('admin_comment_layout') || 'grid';

/**
 * Switch Layout View (Grid/List)
 */
function switchLayoutView(layout, options = {}) {
    currentViewLayout = layout === 'list' ? 'list' : 'grid';
    localStorage.setItem('admin_comment_layout', currentViewLayout);

    // Update container class
    const container = document.getElementById('adminCommentList');
    if (container) {
        if (currentViewLayout === 'list') {
            container.classList.add('list-view');
        } else {
            container.classList.remove('list-view');
        }
    }

    // Re-render current page without refetching data
    if (filteredComments.length > 0) {
        renderCommentList(filteredComments);
        renderCommentsPagination();
        restoreCommentSelectionState();
        if (pendingFocusedCommentId) {
            focusCommentCard(pendingFocusedCommentId);
            pendingFocusedCommentId = '';
        }
    } else if (options?.loadIfNeeded !== false && !commentsLoading) {
        loadComments(currentCommentView);
    }

    // Update button states
    const btns = document.querySelectorAll('.view-btn');
    btns.forEach(btn => {
        if (btn.dataset.view === currentViewLayout) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}
// Initialize layout on load
document.addEventListener('DOMContentLoaded', () => {
    const initCommentsLayout = () => switchLayoutView(currentViewLayout, { loadIfNeeded: false });
    if (window.adminStudioAccessGranted) {
        initCommentsLayout();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initCommentsLayout, { once: true });
});


/**
 * Copy Comment ID to clipboard
 */
window.copyCommentId = function (id, parentId) {
    if (!id) return;

    // Copy ID (just the ID)
    navigator.clipboard.writeText(id).then(() => {
        // Show simplified toast
        showToast ? showToast(`已复制 ID`, 'info') : alert('ID Copied: ' + id);
    }).catch(err => {
        console.error('Failed to copy ID:', err);
    });
};

// Export functions for global access
window.initCommentsModule = initCommentsModule;
window.switchCommentView = switchCommentView;
window.switchAdminCommentsView = switchCommentView;
window.loadComments = loadComments;
window.openAnalyticsCommentContext = openAnalyticsCommentContext;
window.openAdminPromptCommentContext = openAdminPromptCommentContext;
window.openAdminUserCommentContext = openAdminUserCommentContext;
window.clearAdminCommentsPromptContext = clearAdminCommentsPromptContext;
window.deleteComment = deleteComment;
window.viewCommentContext = viewCommentContext;
window.toggleSelectAll = toggleSelectAll;
window.selectAllVisibleComments = selectAllVisibleComments;
window.updateSelection = updateSelection;
window.batchDeleteComments = batchDeleteComments;
window.toggleCommentsSelectMode = toggleCommentsSelectMode;
window.toggleCommentsBatchMenu = toggleCommentsBatchMenu;
window.batchSetCommentWorkflowStatus = batchSetCommentWorkflowStatus;
window.batchAssignCommentWorkflowSelf = batchAssignCommentWorkflowSelf;
window.clearSelectedComments = clearSelectedComments;
window.switchLayoutView = switchLayoutView;
window.changeCommentsPage = changeCommentsPage;
window.toggleCommentSelection = toggleCommentSelection;
window.prefetchCommentsModule = prefetchCommentsModule;
window.copyCommentId = window.copyCommentId;
window.handleAdminCommentsSiteChange = handleAdminCommentsSiteChange;

function handleAdminCommentsSiteChange() {
    invalidateCommentsViewCache();
    closeCommentDetailDrawer();

    if (!isCommentsModuleActive()) {
        return;
    }

    clearRetainedCommentSelection();
    pendingFocusedCommentId = '';
    commentsPaginationState.page = 1;
    void loadComments(currentCommentView, { resetPage: true });
    void loadCommentStats(currentCommentView, { showLoading: true });
}

function handleAdminCommentsShellContext(context = {}) {
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const rawContext = normalizedContext.raw && typeof normalizedContext.raw === 'object' ? normalizedContext.raw : {};
    const payload = normalizedContext.payload && typeof normalizedContext.payload === 'object' ? normalizedContext.payload : {};
    const focus = normalizedContext.focus && typeof normalizedContext.focus === 'object' ? normalizedContext.focus : {};
    const promptId = String(
        focus.promptId
        || rawContext.promptId
        || rawContext.prompt_id
        || payload.promptId
        || ''
    ).trim();
    const focusCommentId = String(
        focus.commentId
        || rawContext.focusCommentId
        || rawContext.commentId
        || rawContext.comment_id
        || payload.focusCommentId
        || payload.commentId
        || ''
    ).trim();
    const targetView = String(
        rawContext.view
        || rawContext.commentView
        || rawContext.comment_view
        || payload.view
        || payload.commentView
        || (promptId ? 'gallery' : 'guestbook')
    ).trim().toLowerCase() === 'gallery' ? 'gallery' : 'guestbook';

    return openAdminUserCommentContext({
        ...rawContext,
        ...payload,
        view: targetView,
        promptId,
        promptTitle: rawContext.promptTitle || rawContext.prompt_title || payload.promptTitle || payload.prompt_title || '',
        queue: rawContext.queue || payload.queue || 'pending',
        search: rawContext.search || payload.search || focusCommentId,
        focusCommentId,
        commentId: focusCommentId,
        site: normalizedContext.site || rawContext.site || payload.site || '',
        ensureModule: false
    });
}

async function openAdminCommentsShellContext(context = {}, options = {}) {
    if (!commentsInitialized) {
        initCommentsModule();
    } else {
        activateCommentsModule();
    }

    return handleAdminCommentsShellContext(context, options);
}

window.openAdminCommentsShellContext = openAdminCommentsShellContext;

if (window.AdminShell?.registerModule) {
    window.AdminShell.registerModule('comments', {
        init: initCommentsModule,
        activate: activateCommentsModule,
        onSiteChange: handleAdminCommentsSiteChange,
        handleContext: handleAdminCommentsShellContext,
        reload: handleAdminCommentsSiteChange
    });
} else {
    window.addEventListener('admin-site-changed', handleAdminCommentsSiteChange);
}

function bindAdminCommentsRuntimeDelegates() {
    if (document.documentElement.dataset.adminCommentsRuntimeDelegatesBound === '1') {
        return;
    }

    document.documentElement.dataset.adminCommentsRuntimeDelegatesBound = '1';

    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-comments-action]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.commentsAction) {
            case 'remove-filter':
                window.removeFilter?.(
                    actionEl.dataset.filterType || '',
                    decodeURIComponent(actionEl.dataset.filterId || '')
                );
                break;
            case 'clear-prompt-context':
                clearAdminCommentsPromptContext();
                loadComments(currentCommentView, { resetPage: true });
                break;
            case 'open-prompt-gallery':
                void openAdminCommentsPromptGalleryContext();
                break;
            case 'open-prompt-homepage':
                void openAdminCommentsPromptHomepageContext();
                break;
            case 'open-prompt-analytics':
                void openAdminCommentsPromptAnalyticsContext();
                break;
            case 'toggle-selection':
                toggleCommentSelection(event, actionEl.dataset.checkboxId || '');
                break;
            case 'copy-comment-id':
                event.stopPropagation();
                window.copyCommentId?.(
                    decodeURIComponent(actionEl.dataset.commentId || ''),
                    decodeURIComponent(actionEl.dataset.parentId || '')
                );
                break;
            case 'toggle-pin':
                event.stopPropagation();
                window.togglePin?.(
                    decodeURIComponent(actionEl.dataset.commentId || ''),
                    actionEl.dataset.commentPinned === '1',
                    decodeURIComponent(actionEl.dataset.promptId || ''),
                    actionEl
                );
                break;
            case 'toggle-block-dropdown':
                event.stopPropagation();
                window.toggleBlockDropdown?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl
                );
                break;
            case 'select-queue':
                event.stopPropagation();
                selectCommentQueue(actionEl.dataset.commentsQueue || 'pending');
                break;
            case 'open-detail':
                event.stopPropagation();
                if (isCommentsSelectMode) {
                    toggleCommentSelectionById(decodeURIComponent(actionEl.dataset.commentId || ''));
                    break;
                }
                openCommentDetail(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'close-detail-drawer':
                event.stopPropagation();
                closeCommentDetailDrawer();
                break;
            case 'open-comment-user':
                event.stopPropagation();
                openCommentUser(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'open-comment-prompt':
                event.stopPropagation();
                openCommentPromptAdmin(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'create-comment-ticket':
                event.stopPropagation();
                void createCommentTicket(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'open-comment-ticket':
                event.stopPropagation();
                openCommentTicket(
                    decodeURIComponent(actionEl.dataset.ticketId || ''),
                    decodeURIComponent(actionEl.dataset.commentId || '')
                );
                break;
            case 'set-workflow-status':
                event.stopPropagation();
                void updateCommentWorkflowStatus(
                    decodeURIComponent(actionEl.dataset.commentId || ''),
                    actionEl.dataset.workflowStatus || ''
                );
                break;
            case 'assign-comment-self':
                event.stopPropagation();
                void assignCommentWorkflowSelf(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'toggle-comment-priority':
                event.stopPropagation();
                void toggleCommentWorkflowPriority(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'edit-comment-tags':
                event.stopPropagation();
                void editCommentWorkflowTags(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'add-workflow-note':
                event.stopPropagation();
                void addCommentWorkflowNote(decodeURIComponent(actionEl.dataset.commentId || ''));
                break;
            case 'view-comment-context':
                event.stopPropagation();
                window.viewCommentContext?.(
                    decodeURIComponent(actionEl.dataset.contextUrl || '')
                );
                break;
            case 'delete-comment':
                event.stopPropagation();
                window.deleteComment?.(
                    decodeURIComponent(actionEl.dataset.commentId || ''),
                    decodeURIComponent(actionEl.dataset.commentType || ''),
                    decodeURIComponent(actionEl.dataset.commentRecordType || ''),
                    actionEl
                );
                break;
            case 'block-user': {
                event.stopPropagation();
                const rawDays = actionEl.dataset.blockDays;
                const days = rawDays === 'permanent' ? null : Number(rawDays || 0);
                window.blockUser?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl.dataset.userScope || '',
                    Number.isFinite(days) ? days : null,
                    actionEl
                );
                break;
            }
            case 'unblock-user':
                event.stopPropagation();
                window.unblockUser?.(
                    decodeURIComponent(actionEl.dataset.userId || ''),
                    actionEl.dataset.userScope || '',
                    actionEl
                );
                break;
            case 'check-user-status':
                event.stopPropagation();
                window.checkUserStatus?.(decodeURIComponent(actionEl.dataset.userId || ''), actionEl);
                break;
        }
    });

    document.addEventListener('change', (event) => {
        const target = event.target instanceof Element ? event.target : event.target?.parentElement;
        if (!target) {
            return;
        }

        const actionEl = target.closest('[data-comments-change]');
        if (!actionEl) {
            return;
        }

        switch (actionEl.dataset.commentsChange) {
            case 'selection':
                updateSelection();
                break;
        }
    });

    document.addEventListener('error', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement) || target.dataset.commentAvatar !== '1') {
            return;
        }

        applyCommentAvatarFallback(target);
    }, true);
}

bindAdminCommentsRuntimeDelegates();

document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (target?.closest('#commentsBatchMenuContainer')) {
        return;
    }
    closeCommentsBatchMenu();
});

/**
 * Toggle Pin Status (Single pin per card)
 */
window.togglePin = async function (id, currentStatus, promptId, actionEl = null) {
    console.log('togglePin called:', id, 'current:', currentStatus, 'prompt:', promptId);
    let finishButtonFeedback = () => {};
    try {
        const writableSite = requireWritableCommentsSite({ label: currentStatus ? '取消评论置顶' : '置顶评论' });
        if (!writableSite) {
            return false;
        }

        finishButtonFeedback = beginAdminCommentsActionButtonFeedback(actionEl, {
            loadingText: currentStatus ? '取消中...' : '置顶中...',
            successText: currentStatus ? '已取消' : '已置顶',
            errorText: '操作失败'
        });

        const payload = await toggleCommentPinViaAdminApi({
            id,
            promptId,
            currentStatus,
            site: writableSite
        });

        console.log('togglePin result:', payload);

        prepareCommentReloadState({
            preserveSelection: true,
            focusCommentId: id
        });
        const successMessage = currentStatus ? '已取消评论置顶' : '评论已置顶';
        finishButtonFeedback({ state: 'saved', text: currentStatus ? '已取消' : '已置顶' });
        showToast(currentStatus ? '已取消置顶' : '评论已置顶', 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        loadComments(currentCommentView, { preserveSelection: true, focusCommentId: id }); // Refresh list
        return true;
    } catch (err) {
        console.error('Error toggling pin:', err);
        const failureMessage = '评论置顶操作失败';
        finishButtonFeedback({ state: 'failed', text: '操作失败' });
        showToast('操作失败', 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
        return false;
    }
};

// --- User Blocking Functions ---

let activeBlockDropdown = null;

function getCommentBlockStateSeed(userId, btnElement) {
    const commentId = decodeURIComponent(btnElement?.dataset?.commentId || '');
    const comment = getCommentById(commentId)
        || commentsData.find((item) => String(item?.user_id || '').trim() === String(userId || '').trim())
        || null;
    const state = comment?.user_block_state && typeof comment.user_block_state === 'object'
        ? comment.user_block_state
        : {};

    return {
        isGuestbookBlocked: state.isGuestbookBlocked === true,
        isGalleryBlocked: state.isGalleryBlocked === true,
        hasGlobalBlock: state.hasGlobalBlock === true
    };
}

window.toggleBlockDropdown = function (userId, btnElement) {
    // Close existing if specific button clicked again or just close any open one
    if (activeBlockDropdown) {
        const isSame = activeBlockDropdown.dataset.triggerId === userId;
        activeBlockDropdown.remove();
        activeBlockDropdown = null;
        if (isSame) return; // Toggle off behavior
    }

    const initialState = getCommentBlockStateSeed(userId, btnElement);
    let isGuestbookBlocked = initialState.isGuestbookBlocked === true;
    let isGalleryBlocked = initialState.isGalleryBlocked === true;
    let hasGlobalBlock = initialState.hasGlobalBlock === true;

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'block-dropdown-menu';
    dropdown.dataset.triggerId = userId;
    dropdown.innerHTML = renderBlockDropdownMenu(userId, {
        isGuestbookBlocked,
        isGalleryBlocked,
        hasGlobalBlock
    });

    btnElement.parentNode.appendChild(dropdown);
    activeBlockDropdown = dropdown;

    // Robust Close Handler
    const closeHandler = (e) => {
        // If clicking inside dropdown, do nothing (handled by buttons)
        if (dropdown.contains(e.target)) return;

        // If clicking the button that opened it, do nothing (toggle logic handles it)
        if (btnElement.contains(e.target)) return;

        // Otherwise close
        dropdown.remove();
        activeBlockDropdown = null;
        document.removeEventListener('click', closeHandler);
        // Also remove mouseleave listener if we added one
    };

    // Add close listener with delay to avoid immediate trigger
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // Auto-close on mouse leave (requested "retract automatic")
    dropdown.onmouseleave = () => {
        // Create a grace period allowing moving to sibling elements? 
        // For now user said "won't automatically retract", implying they WANT it to retract.
        // Let's add a timeout to close on mouseleave
        dropdown._closeTimer = setTimeout(() => {
            dropdown.remove();
            activeBlockDropdown = null;
            document.removeEventListener('click', closeHandler);
        }, 500);
    };
    dropdown.onmouseenter = () => {
        clearTimeout(dropdown._closeTimer);
    };

    // -- Async Status Update --
    // Check status in background and update UI if user is blocked
    fetchAdminCommentBlockState(userId)
        .then((payload) => {
            if (activeBlockDropdown !== dropdown) {
                return;
            }

            isGuestbookBlocked = payload?.isGuestbookBlocked === true;
            isGalleryBlocked = payload?.isGalleryBlocked === true;
            hasGlobalBlock = payload?.hasGlobalBlock === true;

            dropdown.innerHTML = renderBlockDropdownMenu(userId, {
                isGuestbookBlocked,
                isGalleryBlocked,
                hasGlobalBlock
            });
        })
        .catch(console.error);
};

function renderBlockDropdownMenu(userId, { isGuestbookBlocked = false, isGalleryBlocked = false, hasGlobalBlock = false } = {}) {
    const encodedUserId = encodeURIComponent(userId || '');
    let html = `
        <div class="block-menu-header">封禁管理</div>
        <div class="block-menu-note">当前封禁按 scope 全站生效，不区分 CN / EN 站点。</div>
    `;

    if (hasGlobalBlock) {
        html += `
            <div class="block-menu-divider"></div>
            <button class="block-menu-btn" type="button" data-comments-action="unblock-user" data-user-id="${encodedUserId}" data-user-scope="all">🚫 解封全站</button>
        `;
    } else {
        html += `<button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="all" data-block-days="permanent">永久封禁全站</button>`;
    }

    html += '<div class="block-menu-divider"></div>';

    if (isGuestbookBlocked) {
        html += `<button class="block-menu-btn" type="button" data-comments-action="unblock-user" data-user-id="${encodedUserId}" data-user-scope="guestbook">🚫 解封留言板</button>`;
    } else {
        html += `<button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="guestbook" data-block-days="permanent">永久封禁留言板</button>`;
    }

    if (isGalleryBlocked) {
        html += `<button class="block-menu-btn" type="button" data-comments-action="unblock-user" data-user-id="${encodedUserId}" data-user-scope="gallery">🚫 解封画廊</button>`;
    } else {
        html += `<button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="permanent">永久封禁画廊</button>`;
        html += `
            <div class="block-menu-divider"></div>
            <div class="block-menu-header">临时封禁 (画廊)</div>
            <button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="3">封禁 3 天</button>
            <button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="7">封禁 7 天</button>
            <button class="block-menu-btn" type="button" data-comments-action="block-user" data-user-id="${encodedUserId}" data-user-scope="gallery" data-block-days="30">封禁 30 天</button>
        `;
    }

    html += `
        <div class="block-menu-divider"></div>
        <button class="block-menu-btn" type="button" data-comments-action="check-user-status" data-user-id="${encodedUserId}">查看状态详情</button>
    `;

    return html;
}

window.blockUser = async function (userId, scope, days, actionEl = null) {
    const durationStr = days ? `${days}天` : '永久';
    const scopeStr = scope === 'guestbook' ? '留言板' : (scope === 'all' ? '全站' : '画廊');

    if (!confirm(`确定要 [${durationStr}] 封禁该用户在 [${scopeStr}] 的权限吗？`)) return null;
    const reason = window.prompt('可选：填写封禁原因（会写入封禁历史）', '') || '';
    let finishButtonFeedback = () => {};

    try {
        const writableSite = requireWritableCommentsSite({ label: `${scopeStr}用户封禁` });
        if (!writableSite) {
            return false;
        }

        finishButtonFeedback = beginAdminCommentsActionButtonFeedback(actionEl, {
            loadingText: '封禁中...',
            successText: '已封禁',
            errorText: '封禁失败',
            compact: false
        });

        const payload = await mutateAdminCommentBlockState({
            action: 'block',
            userId,
            scope,
            days,
            reason,
            site: writableSite
        });

        if (activeBlockDropdown && activeBlockDropdown.dataset.triggerId === userId) {
            activeBlockDropdown.innerHTML = renderBlockDropdownMenu(userId, {
                isGuestbookBlocked: payload?.isGuestbookBlocked === true,
                isGalleryBlocked: payload?.isGalleryBlocked === true,
                hasGlobalBlock: payload?.hasGlobalBlock === true
            });
        }

        refreshCommentsForUserStatus(userId);
        const successMessage = `已${durationStr}封禁用户 ${scopeStr} 权限（全站生效）`;
        finishButtonFeedback({ state: 'saved', text: '已封禁', restore: false });
        showToast(successMessage, 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        return true;
    } catch (err) {
        console.error('Block user error:', err);
        const failureMessage = '操作失败: ' + err.message;
        finishButtonFeedback({ state: 'failed', text: '封禁失败' });
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
        return false;
    }
};

window.checkUserStatus = async function (userId, actionEl = null) {
    const finishButtonFeedback = beginAdminCommentsActionButtonFeedback(actionEl, {
        loadingText: '查询中...',
        successText: '已查询',
        errorText: '查询失败',
        compact: false
    });

    try {
        const payload = await fetchAdminCommentBlockState(userId);
        const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
        finishButtonFeedback({ state: 'saved', text: '已查询' });

        if (!blocks.length) {
            alert('该用户未被封禁');
        } else {
            const lines = blocks.map((block) => {
                const scopeLabel = block.scope === 'all'
                    ? '全部（留言板 / 画廊全站生效）'
                    : (block.scope === 'guestbook' ? '留言板（全站生效）' : '画廊（全站生效）');
                const expiryLabel = block.expires_at
                    ? `${new Date(block.expires_at).toLocaleDateString()} 到期`
                    : '永久';
                return `- [${scopeLabel}] ${expiryLabel}${block.reason ? `\n  原因: ${block.reason}` : ''}`;
            });
            alert(`用户当前封禁状态：\n\n${lines.join('\n\n')}`);
        }
        return true;
    } catch (err) {
        console.error('Check status error:', err);
        finishButtonFeedback({ state: 'failed', text: '查询失败' });
        showToast('查询失败', 'error');
        return false;
    }
};

window.unblockUser = async function (userId, scope, actionEl = null) {
    const scopeLabel = scope === 'guestbook'
        ? '留言板'
        : (scope === 'all' ? '全站' : '画廊');

    if (!confirm(`确定要解除该用户在 [${scopeLabel}] 的封禁吗？`)) return null;
    const reason = window.prompt('可选：填写解封说明（会写入封禁历史）', '') || '';
    let finishButtonFeedback = () => {};

    try {
        const writableSite = requireWritableCommentsSite({ label: `${scopeLabel}用户解封` });
        if (!writableSite) {
            return false;
        }

        finishButtonFeedback = beginAdminCommentsActionButtonFeedback(actionEl, {
            loadingText: '解封中...',
            successText: '已解封',
            errorText: '解封失败',
            compact: false
        });

        const payload = await mutateAdminCommentBlockState({
            action: 'unblock',
            userId,
            scope,
            reason,
            site: writableSite
        });

        if (activeBlockDropdown && activeBlockDropdown.dataset.triggerId === userId) {
            activeBlockDropdown.innerHTML = renderBlockDropdownMenu(userId, {
                isGuestbookBlocked: payload?.isGuestbookBlocked === true,
                isGalleryBlocked: payload?.isGalleryBlocked === true,
                hasGlobalBlock: payload?.hasGlobalBlock === true
            });
        }

        refreshCommentsForUserStatus(userId);
        const successMessage = `已解封用户 ${scopeLabel} 权限`;
        finishButtonFeedback({ state: 'saved', text: '已解封', restore: false });
        showToast(successMessage, 'success');
        emitCommentsCommandFeedback(successMessage, 'saved', { source: 'comments-governance' });
        return true;
    } catch (err) {
        console.error('Unblock user error:', err);
        const failureMessage = '操作失败: ' + err.message;
        finishButtonFeedback({ state: 'failed', text: '解封失败' });
        showToast(failureMessage, 'error');
        emitCommentsCommandFeedback(failureMessage, 'failed', { source: 'comments-governance' });
        return false;
    }
};
