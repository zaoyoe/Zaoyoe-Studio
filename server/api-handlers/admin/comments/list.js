const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    applyCommentsDateRange,
    applyCommentsSiteFilter,
    buildCountMap,
    normalizeCommentsSite,
    normalizeCommentsView,
    sortByCreatedAtDesc,
    uniqueIds
} = require('./shared');
const {
    buildCommentUserBlockStateMap,
    fetchCommentBlockStateRows
} = require('./_comment-block-state');
const {
    buildCommentWorkflowEntityKey,
    buildDefaultCommentWorkflow,
    fetchCommentWorkflowMap
} = require('./_workflow');
const {
    isMissingAdminCommentsFeedError,
    queryCommentsFeedPage
} = require('./_feed-view');

const EMPTY_COMMENT_USER_BLOCK_STATE = Object.freeze({
    blocks: [],
    scopes: [],
    hasGlobalBlock: false,
    isGuestbookBlocked: false,
    isGalleryBlocked: false
});

const PROMPT_TITLE_SELECT_FIELDS = 'id, title, title_zh, title_en';
const PROMPT_TITLE_LEGACY_SELECT_FIELDS = 'id, title';
const SUPPORTED_COMMENTS_QUEUES = new Set([
    'pending',
    'all',
    'guestbook_unreplied',
    'high_risk',
    'blocked_user',
    'escalated'
]);

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function truncateText(value, maxLength = 120) {
    const normalized = sanitizeText(value, maxLength + 1);
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function normalizeCommentsPage(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCommentsPageSize(value, fallback = 40) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, 200);
}

function normalizeCommentsStatusFilter(value) {
    const normalized = sanitizeText(value, 40).toLowerCase();
    return normalized === 'replied' || normalized === 'unreplied' ? normalized : 'all';
}

function normalizeCommentsTypeFilter(value) {
    const normalized = sanitizeText(value, 40).toLowerCase();
    return normalized === 'top' || normalized === 'reply' ? normalized : 'all';
}

function normalizeCommentsSourceFilter(value) {
    const normalized = sanitizeText(value, 40).toLowerCase();
    return normalized === 'guestbook' || normalized === 'gallery' ? normalized : 'all';
}

function normalizeCommentsQueueFilter(value) {
    const normalized = sanitizeText(value, 80).toLowerCase();
    if (!normalized) {
        return 'pending';
    }
    return SUPPORTED_COMMENTS_QUEUES.has(normalized) ? normalized : 'pending';
}

function normalizeCommentsBooleanFilter(value) {
    const normalized = sanitizeText(value, 20).toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeCommentsSearchTerms(searchParams) {
    const search = sanitizeText(searchParams.get('search'), 240);
    const searchTags = searchParams
        .getAll('searchTag')
        .map((value) => sanitizeText(value, 80))
        .filter(Boolean);

    return {
        search,
        searchTags
    };
}

function parseCommentsListFilters(searchParams) {
    const { search, searchTags } = normalizeCommentsSearchTerms(searchParams);

    return {
        promptId: sanitizeText(searchParams.get('promptId'), 160),
        search,
        searchTags,
        status: normalizeCommentsStatusFilter(searchParams.get('status')),
        type: normalizeCommentsTypeFilter(searchParams.get('type')),
        source: normalizeCommentsSourceFilter(searchParams.get('source')),
        queue: normalizeCommentsQueueFilter(searchParams.get('queue')),
        hasImage: normalizeCommentsBooleanFilter(searchParams.get('hasImage'))
    };
}

function getCommentReplyCount(comment) {
    return Math.max(0, Number(comment?.reply_count || 0));
}

function isReplyLevelComment(comment) {
    return sanitizeText(comment?.level, 20) === 'reply';
}

function getCommentWorkflowState(comment) {
    if (comment?.workflow && typeof comment.workflow === 'object' && !Array.isArray(comment.workflow)) {
        return comment.workflow;
    }

    return buildDefaultCommentWorkflow({
        site: comment?.site || 'all',
        entityType: comment?.entity_type || '',
        entityId: comment?.id || ''
    });
}

function isCommentBlocked(comment) {
    const state = comment?.user_block_state && typeof comment.user_block_state === 'object'
        ? comment.user_block_state
        : EMPTY_COMMENT_USER_BLOCK_STATE;
    const type = comment?.type === 'gallery' ? 'gallery' : 'guestbook';

    return state.hasGlobalBlock === true
        || (type === 'guestbook' && state.isGuestbookBlocked === true)
        || (type === 'gallery' && state.isGalleryBlocked === true);
}

function isCommentEscalated(comment) {
    const workflow = getCommentWorkflowState(comment);
    return workflow.status === 'escalated';
}

function isCommentHighRisk(comment) {
    const workflow = getCommentWorkflowState(comment);
    const tags = Array.isArray(workflow.tags) ? workflow.tags : [];
    return isCommentBlocked(comment)
        || workflow.priority === 'high'
        || tags.some((tag) => ['risk', 'high_risk', 'spam', 'abuse'].includes(String(tag || '').toLowerCase()));
}

function matchesCommentSearchTerm(comment, rawSearchTerm, { pinnedOnly = false } = {}) {
    const searchTerm = sanitizeText(rawSearchTerm, 120).toLowerCase();
    if (!searchTerm) {
        return true;
    }

    if (pinnedOnly && (searchTerm === '置顶' || searchTerm === 'pinned')) {
        return comment?.is_pinned === true;
    }

    const workflow = getCommentWorkflowState(comment);
    const fields = [
        comment?.content,
        comment?.author,
        comment?.email,
        comment?.user_id,
        comment?.prompt_title,
        comment?.context_title,
        comment?.context_type_label,
        comment?.entity_label,
        comment?.id,
        comment?.parent_id,
        comment?.message_id,
        comment?.prompt_id,
        comment?.thread_root_id,
        comment?.parent_snippet,
        comment?.root_snippet,
        comment?.site,
        comment?.type,
        comment?.entity_type,
        ...(Array.isArray(workflow.tags) ? workflow.tags : []),
        ...(Array.isArray(workflow.linked_ticket_ids) ? workflow.linked_ticket_ids : [])
    ];

    return fields.some((field) => sanitizeText(field, 400).toLowerCase().includes(searchTerm));
}

function applyCommentQueueFilter(comment, queue = 'pending') {
    const normalizedQueue = normalizeCommentsQueueFilter(queue);
    if (normalizedQueue === 'pending') {
        const workflow = getCommentWorkflowState(comment);
        const status = String(workflow.status || '').trim().toLowerCase();
        return status !== 'resolved' && status !== 'ignored';
    }

    if (normalizedQueue === 'guestbook_unreplied') {
        return comment?.type === 'guestbook'
            && comment?.record_type === 'message'
            && getCommentReplyCount(comment) <= 0;
    }

    if (normalizedQueue === 'high_risk') {
        return isCommentHighRisk(comment);
    }

    if (normalizedQueue === 'blocked_user') {
        return isCommentBlocked(comment);
    }

    if (normalizedQueue === 'escalated') {
        return isCommentEscalated(comment);
    }

    return true;
}

function applyCommentFilters(comments, filters = {}) {
    return (Array.isArray(comments) ? comments : []).filter((comment) => {
        if (filters.promptId && sanitizeText(comment?.context || comment?.prompt_id, 160) !== filters.promptId) {
            return false;
        }

        if (filters.source !== 'all' && comment.type !== filters.source) {
            return false;
        }

        if (!applyCommentQueueFilter(comment, filters.queue)) {
            return false;
        }

        if (filters.hasImage && !comment.image_url) {
            return false;
        }

        const replyCount = getCommentReplyCount(comment);
        if (filters.status === 'replied' && replyCount <= 0) {
            return false;
        }
        if (filters.status === 'unreplied' && replyCount > 0) {
            return false;
        }

        if (filters.type === 'top' && isReplyLevelComment(comment)) {
            return false;
        }
        if (filters.type === 'reply' && !isReplyLevelComment(comment)) {
            return false;
        }

        if (Array.isArray(filters.searchTags) && filters.searchTags.length > 0) {
            const matchesTags = filters.searchTags.every((tag) => matchesCommentSearchTerm(comment, tag));
            if (!matchesTags) {
                return false;
            }
        }

        return matchesCommentSearchTerm(comment, filters.search, { pinnedOnly: true });
    });
}

function paginateComments(comments, { page, pageSize }) {
    const totalItems = Array.isArray(comments) ? comments.length : 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;

    return {
        page: currentPage,
        pageSize,
        totalItems,
        totalPages,
        hasPrevPage: currentPage > 1,
        hasNextPage: currentPage < totalPages,
        returnedItems: Math.max(0, Math.min(totalItems, end) - start),
        comments: (Array.isArray(comments) ? comments : []).slice(start, end)
    };
}

async function attachCommentUserBlockState(supabase, comments = []) {
    const normalizedComments = Array.isArray(comments) ? comments : [];
    if (!normalizedComments.length) {
        return [];
    }

    const userIds = uniqueIds(normalizedComments.map((comment) => comment.user_id));
    const blockRows = await fetchCommentBlockStateRows(supabase, userIds);
    const userBlockStateMap = buildCommentUserBlockStateMap(blockRows, userIds);

    return normalizedComments.map((comment) => ({
        ...comment,
        user_block_state: userBlockStateMap[String(comment?.user_id || '').trim()] || EMPTY_COMMENT_USER_BLOCK_STATE
    }));
}

async function attachCommentWorkflowState(supabase, comments = []) {
    const normalizedComments = Array.isArray(comments) ? comments : [];
    if (!normalizedComments.length) {
        return [];
    }

    const workflowMap = await fetchCommentWorkflowMap(supabase, normalizedComments);
    return normalizedComments.map((comment) => {
        const workflowKey = buildCommentWorkflowEntityKey(comment?.site, comment?.entity_type, comment?.id);
        return {
            ...comment,
            workflow: workflowMap.get(workflowKey) || buildDefaultCommentWorkflow({
                site: comment?.site || 'all',
                entityType: comment?.entity_type || '',
                entityId: comment?.id || ''
            })
        };
    });
}

async function attachCommentUserSignals(supabase, comments = []) {
    const normalizedComments = Array.isArray(comments) ? comments : [];
    if (!normalizedComments.length) {
        return [];
    }

    const userIds = uniqueIds(normalizedComments.map((comment) => comment.user_id));
    if (!userIds.length) {
        return normalizedComments;
    }

    const [
        { data: guestbookMessages, error: guestbookMessagesError },
        { data: guestbookComments, error: guestbookCommentsError },
        { data: galleryComments, error: galleryCommentsError },
        { data: tickets, error: ticketsError },
        { data: orders, error: ordersError },
        { data: paymentOrders, error: paymentOrdersError }
    ] = await Promise.all([
        supabase.from('guestbook_messages').select('id, user_id').in('user_id', userIds),
        supabase.from('guestbook_comments').select('id, user_id').in('user_id', userIds),
        supabase.from('prompt_comments').select('id, user_id').in('user_id', userIds),
        supabase.from('shop_tickets').select('id, user_id, status').in('user_id', userIds),
        supabase.from('shop_orders').select('id, user_id').in('user_id', userIds),
        supabase.from('payment_orders').select('id, user_id').in('user_id', userIds)
    ]);

    if (guestbookMessagesError) throw guestbookMessagesError;
    if (guestbookCommentsError) throw guestbookCommentsError;
    if (galleryCommentsError) throw galleryCommentsError;
    if (ticketsError) throw ticketsError;
    if (ordersError) throw ordersError;
    if (paymentOrdersError) throw paymentOrdersError;

    const messageCounts = buildCountMap(guestbookMessages || [], 'user_id');
    const guestbookCommentCounts = buildCountMap(guestbookComments || [], 'user_id');
    const galleryCommentCounts = buildCountMap(galleryComments || [], 'user_id');
    const orderCounts = buildCountMap(orders || [], 'user_id');
    const paymentOrderCounts = buildCountMap(paymentOrders || [], 'user_id');
    const activeTicketCounts = (Array.isArray(tickets) ? tickets : []).reduce((acc, ticket) => {
        const userId = sanitizeText(ticket?.user_id, 160);
        if (!userId) {
            return acc;
        }
        const status = sanitizeText(ticket?.status, 60).toUpperCase();
        if (!['RESOLVED', 'REJECTED'].includes(status)) {
            acc[userId] = (acc[userId] || 0) + 1;
        }
        return acc;
    }, {});
    const ticketCounts = buildCountMap(tickets || [], 'user_id');

    return normalizedComments.map((comment) => {
        const userId = sanitizeText(comment?.user_id, 160);
        const totalCommentCount = (guestbookCommentCounts[userId] || 0) + (galleryCommentCounts[userId] || 0);
        return {
            ...comment,
            user_summary: {
                user_id: userId,
                guestbook_message_count: messageCounts[userId] || 0,
                guestbook_comment_count: guestbookCommentCounts[userId] || 0,
                gallery_comment_count: galleryCommentCounts[userId] || 0,
                total_comment_count: totalCommentCount,
                ticket_count: ticketCounts[userId] || 0,
                active_ticket_count: activeTicketCounts[userId] || 0,
                order_count: orderCounts[userId] || 0,
                payment_order_count: paymentOrderCounts[userId] || 0,
                risk_level: isCommentBlocked(comment)
                    ? 'blocked'
                    : ((activeTicketCounts[userId] || 0) > 0 ? 'watch' : 'normal')
            }
        };
    });
}

async function fetchProfilesByIds(supabase, userIds = []) {
    const normalizedIds = uniqueIds(userIds);
    if (!normalizedIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, email')
        .in('id', normalizedIds);

    if (error) {
        throw error;
    }

    return new Map(
        (data || [])
            .filter((row) => row?.id)
            .map((row) => [row.id, row])
    );
}

function isMissingOptionalPromptTitleColumnError(error) {
    const message = sanitizeText(error?.message || '', 400).toLowerCase();
    if (!message) return false;

    return ['title_zh', 'title_en'].some((field) => (
        message.includes(`column ${field}`)
        || message.includes(`prompts.${field}`)
        || message.includes(`"${field}"`)
    ));
}

async function fetchPromptTitlesByIds(supabase, promptIds = []) {
    const normalizedIds = uniqueIds(promptIds);
    if (!normalizedIds.length) {
        return new Map();
    }

    const primaryResult = await supabase
        .from('prompts')
        .select(PROMPT_TITLE_SELECT_FIELDS)
        .in('id', normalizedIds);

    if (primaryResult?.error && !isMissingOptionalPromptTitleColumnError(primaryResult.error)) {
        throw primaryResult.error;
    }

    if (!primaryResult?.error) {
        return new Map(
            (primaryResult.data || [])
                .filter((row) => row?.id)
                .map((row) => [row.id, row])
        );
    }

    const fallbackResult = await supabase
        .from('prompts')
        .select(PROMPT_TITLE_LEGACY_SELECT_FIELDS)
        .in('id', normalizedIds);

    if (fallbackResult.error) {
        throw fallbackResult.error;
    }

    return new Map(
        (fallbackResult.data || [])
            .filter((row) => row?.id)
            .map((row) => [row.id, row])
    );
}

async function fetchPromptCommentLikeCounts(supabase, site, commentIds = []) {
    const normalizedIds = uniqueIds(commentIds);
    if (!normalizedIds.length) {
        return {};
    }

    const { data, error } = await applyCommentsSiteFilter(
        supabase
            .from('comment_likes')
            .select('comment_id')
            .in('comment_id', normalizedIds),
        site
    );

    if (error) {
        throw error;
    }

    return buildCountMap(data || [], 'comment_id');
}

function resolveGuestbookThreadDepth(commentMap, comment) {
    let depth = 1;
    let current = comment;

    while (current?.parent_id) {
        depth += 1;
        current = commentMap.get(current.parent_id);
        if (!current) {
            break;
        }
    }

    return depth;
}

async function loadGuestbookAdminComments(supabase, { site, dateFrom, dateTo }) {
    const messageQuery = applyCommentsDateRange(
        applyCommentsSiteFilter(
            supabase
                .from('guestbook_messages')
                .select('id, site, content, user_id, created_at, image_url, like_count')
                .order('created_at', { ascending: false }),
            site
        ),
        { dateFrom, dateTo }
    );

    const commentQuery = applyCommentsDateRange(
        applyCommentsSiteFilter(
            supabase
                .from('guestbook_comments')
                .select('id, site, message_id, parent_id, content, user_id, created_at')
                .order('created_at', { ascending: false }),
            site
        ),
        { dateFrom, dateTo }
    );

    const [
        { data: messages, error: messagesError },
        { data: comments, error: commentsError }
    ] = await Promise.all([messageQuery, commentQuery]);

    if (messagesError) {
        throw messagesError;
    }

    if (commentsError) {
        throw commentsError;
    }

    const guestbookMessages = messages || [];
    const guestbookComments = comments || [];
    const messageMap = new Map(guestbookMessages.map((message) => [message.id, message]));
    const commentMap = new Map(guestbookComments.map((comment) => [comment.id, comment]));
    const guestbookUserIds = uniqueIds([
        ...guestbookMessages.map((message) => message.user_id),
        ...guestbookComments.map((comment) => comment.user_id)
    ]);
    const commentIds = guestbookComments.map((comment) => comment.id).filter(Boolean);
    const messageReplyCounts = buildCountMap(guestbookComments, 'message_id');
    const commentReplyCounts = buildCountMap(
        guestbookComments.filter((comment) => comment.parent_id),
        'parent_id'
    );
    const profileMap = await fetchProfilesByIds(supabase, guestbookUserIds);

    let commentLikeCounts = {};
    if (commentIds.length > 0) {
        const { data: likeRows, error: likesError } = await applyCommentsSiteFilter(
            supabase
                .from('guestbook_likes')
                .select('target_id, target_type')
                .eq('target_type', 'comment')
                .in('target_id', commentIds),
            site
        );

        if (likesError) {
            throw likesError;
        }

        commentLikeCounts = buildCountMap(likeRows || [], 'target_id');
    }

    const messageRows = guestbookMessages.map((message) => ({
        id: message.id,
        site: normalizeCommentsSite(message.site, 'cn'),
        type: 'guestbook',
        entity_type: 'guestbook_message',
        entity_label: '留言主贴',
        record_type: 'message',
        level: 'top',
        thread_depth: 0,
        content: message.content || '',
        author: profileMap.get(message.user_id)?.username || '未知用户',
        email: profileMap.get(message.user_id)?.email || '',
        avatar: profileMap.get(message.user_id)?.avatar_url || null,
        created_at: message.created_at,
        context: message.id,
        context_title: '留言板主贴',
        context_type_label: 'Guestbook',
        prompt_title: '',
        like_count: Number(message.like_count || 0),
        likes: Number(message.like_count || 0),
        user_id: message.user_id,
        parent_id: null,
        message_id: message.id,
        prompt_id: null,
        thread_root_id: message.id,
        thread_root_type: 'guestbook_message',
        parent_snippet: '',
        parent_author: '',
        root_snippet: message.content || '',
        image_url: message.image_url || null,
        reply_count: messageReplyCounts[message.id] || 0
    }));

    const commentRows = guestbookComments.map((comment) => {
        const message = messageMap.get(comment.message_id) || null;
        const parentComment = comment.parent_id ? commentMap.get(comment.parent_id) || null : null;
        const parentUserId = parentComment?.user_id || message?.user_id || '';
        const parentProfile = profileMap.get(parentUserId) || null;

        return {
            id: comment.id,
            site: normalizeCommentsSite(comment.site, 'cn'),
            type: 'guestbook',
            entity_type: 'guestbook_comment',
            entity_label: comment.parent_id ? '留言回复' : '留言评论',
            record_type: comment.parent_id ? 'reply' : 'comment',
            level: comment.parent_id ? 'reply' : 'top',
            thread_depth: resolveGuestbookThreadDepth(commentMap, comment),
            content: comment.content || '',
            author: profileMap.get(comment.user_id)?.username || '未知用户',
            email: profileMap.get(comment.user_id)?.email || '',
            avatar: profileMap.get(comment.user_id)?.avatar_url || null,
            created_at: comment.created_at,
            context: comment.message_id,
            context_title: '留言板主贴',
            context_type_label: 'Guestbook',
            prompt_title: '',
            like_count: commentLikeCounts[comment.id] || 0,
            likes: commentLikeCounts[comment.id] || 0,
            user_id: comment.user_id,
            parent_id: comment.parent_id,
            message_id: comment.message_id,
            prompt_id: null,
            thread_root_id: comment.message_id,
            thread_root_type: 'guestbook_message',
            parent_snippet: parentComment?.content || message?.content || '',
            parent_author: parentProfile?.username || '',
            root_snippet: message?.content || '',
            image_url: null,
            reply_count: commentReplyCounts[comment.id] || 0
        };
    });

    return sortByCreatedAtDesc([...messageRows, ...commentRows]);
}

function resolvePromptCommentDepth(commentMap, comment) {
    let depth = 0;
    let current = comment;

    while (current?.parent_id) {
        depth += 1;
        current = commentMap.get(current.parent_id);
        if (!current) {
            break;
        }
    }

    return depth;
}

function resolvePromptRootComment(commentMap, comment) {
    let current = comment;
    let previous = comment;

    while (current?.parent_id) {
        previous = current;
        current = commentMap.get(current.parent_id);
        if (!current) {
            return previous;
        }
    }

    return current || previous || comment;
}

async function loadGalleryAdminComments(supabase, { site, dateFrom, dateTo }) {
    const query = applyCommentsDateRange(
        applyCommentsSiteFilter(
            supabase
                .from('prompt_comments')
                .select('id, site, prompt_id, parent_id, content, user_id, created_at, image_url, is_pinned, is_featured')
                .order('created_at', { ascending: false }),
            site
        ),
        { dateFrom, dateTo }
    );

    const { data, error } = await query;
    if (error) {
        throw error;
    }

    const comments = data || [];
    const commentMap = new Map(comments.map((comment) => [comment.id, comment]));
    const replyCounts = buildCountMap(comments.filter((comment) => comment.parent_id), 'parent_id');
    const promptIds = uniqueIds(comments.map((comment) => comment.prompt_id));
    const userIds = uniqueIds(comments.map((comment) => comment.user_id));
    const commentIds = uniqueIds(comments.map((comment) => comment.id));
    const [profileMap, promptMap, likeCounts] = await Promise.all([
        fetchProfilesByIds(supabase, userIds),
        fetchPromptTitlesByIds(supabase, promptIds),
        fetchPromptCommentLikeCounts(supabase, site, commentIds)
    ]);

    return sortByCreatedAtDesc(comments.map((comment) => {
        const parentComment = comment.parent_id ? commentMap.get(comment.parent_id) || null : null;
        const rootComment = resolvePromptRootComment(commentMap, comment);
        const promptTitleRow = promptMap.get(comment.prompt_id);
        const promptTitle = promptTitleRow?.title
            || promptTitleRow?.title_zh
            || promptTitleRow?.title_en
            || 'Unknown';

        return {
            id: comment.id,
            site: normalizeCommentsSite(comment.site, 'cn'),
            type: 'gallery',
            entity_type: 'prompt_comment',
            entity_label: comment.parent_id ? '画廊回复' : '画廊评论',
            record_type: comment.parent_id ? 'reply' : 'comment',
            level: comment.parent_id ? 'reply' : 'top',
            thread_depth: resolvePromptCommentDepth(commentMap, comment),
            content: comment.content || '',
            author: profileMap.get(comment.user_id)?.username || '未知用户',
            email: profileMap.get(comment.user_id)?.email || '',
            avatar: profileMap.get(comment.user_id)?.avatar_url || null,
            created_at: comment.created_at,
            context: comment.prompt_id,
            context_title: promptTitle,
            context_type_label: 'Prompt',
            prompt_title: promptTitle,
            like_count: likeCounts[comment.id] || 0,
            likes: likeCounts[comment.id] || 0,
            user_id: comment.user_id,
            parent_id: comment.parent_id,
            message_id: null,
            prompt_id: comment.prompt_id,
            thread_root_id: rootComment?.id || comment.id,
            thread_root_type: 'prompt_comment',
            parent_snippet: parentComment?.content || '',
            parent_author: profileMap.get(parentComment?.user_id)?.username || '',
            root_snippet: rootComment?.content || comment.content || '',
            image_url: comment.image_url || null,
            is_pinned: comment.is_pinned === true,
            is_featured: comment.is_featured === true,
            reply_count: replyCounts[comment.id] || 0
        };
    }));
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'content.moderate' });
        const searchParams = getQueryParams(req);
        const view = normalizeCommentsView(searchParams.get('view'));
        const site = normalizeCommentsSite(searchParams.get('site') || req.adminSite, 'all');
        const dateFrom = sanitizeText(searchParams.get('dateFrom'), 80);
        const dateTo = sanitizeText(searchParams.get('dateTo'), 80);
        const filters = parseCommentsListFilters(searchParams);
        const page = normalizeCommentsPage(searchParams.get('page'));
        const pageSize = normalizeCommentsPageSize(searchParams.get('pageSize'));

        const shouldBypassFeedFastPath = filters.queue === 'blocked_user';

        if (!shouldBypassFeedFastPath) {
            try {
                const fastPath = await queryCommentsFeedPage(supabase, {
                    view,
                    site,
                    dateFrom,
                    dateTo,
                    filters,
                    page,
                    pageSize
                });
                const commentsWithBlocks = await attachCommentUserBlockState(supabase, fastPath.comments);
                const paginatedComments = await attachCommentUserSignals(supabase, commentsWithBlocks);

                return sendJson(res, 200, {
                    success: true,
                    view,
                    site,
                    filters: {
                        ...filters
                    },
                    comments: paginatedComments,
                    pagination: fastPath.pagination
                });
            } catch (fastPathError) {
                if (!isMissingAdminCommentsFeedError(fastPathError)) {
                    throw fastPathError;
                }
            }
        }

        const comments = view === 'gallery'
            ? await loadGalleryAdminComments(supabase, { site, dateFrom, dateTo })
            : await loadGuestbookAdminComments(supabase, { site, dateFrom, dateTo });
        const commentsWithBlocks = await attachCommentUserBlockState(supabase, comments);
        const commentsWithWorkflows = await attachCommentWorkflowState(supabase, commentsWithBlocks);
        const filteredComments = applyCommentFilters(commentsWithWorkflows, filters);
        const pagination = paginateComments(filteredComments, { page, pageSize });
        const paginatedComments = await attachCommentUserSignals(supabase, pagination.comments);

        return sendJson(res, 200, {
            success: true,
            view,
            site,
            filters: {
                ...filters
            },
            comments: paginatedComments,
            pagination: {
                page: pagination.page,
                pageSize: pagination.pageSize,
                totalItems: pagination.totalItems,
                totalPages: pagination.totalPages,
                hasPrevPage: pagination.hasPrevPage,
                hasNextPage: pagination.hasNextPage,
                returnedItems: pagination.returnedItems
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Comments list request failed'
        });
    }
};
