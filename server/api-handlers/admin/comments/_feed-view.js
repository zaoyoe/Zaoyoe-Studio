const {
    applyCommentsDateRange,
    applyCommentsSiteFilter,
    normalizeCommentsSite
} = require('./shared');
const { buildDefaultCommentWorkflow } = require('./_workflow');

const COMMENTS_FEED_VIEW = 'admin_comments_feed';
const COMMENTS_SUMMARY_RPC = 'fn_admin_comments_summary';
const COMMENTS_FEED_SELECT_FIELDS = [
    'id',
    'site',
    'type',
    'entity_type',
    'entity_label',
    'record_type',
    'level',
    'thread_depth',
    'content',
    'author',
    'email',
    'avatar',
    'created_at',
    'context',
    'context_title',
    'context_type_label',
    'prompt_title',
    'like_count',
    'likes',
    'user_id',
    'parent_id',
    'message_id',
    'prompt_id',
    'thread_root_id',
    'thread_root_type',
    'parent_snippet',
    'parent_author',
    'root_snippet',
    'image_url',
    'has_image',
    'is_pinned',
    'is_featured',
    'reply_count',
    'has_global_block',
    'is_guestbook_blocked',
    'is_gallery_blocked',
    'is_points_usage_blocked',
    'block_scopes',
    'workflow_status',
    'workflow_priority',
    'workflow_assignee_id',
    'workflow_assignee_label',
    'workflow_tags',
    'workflow_note_count',
    'workflow_linked_ticket_count',
    'workflow_linked_ticket_ids',
    'workflow_resolved_at',
    'workflow_updated_at',
    'workflow_last_activity_at',
    'workflow_metadata',
    'search_document',
    'is_blocked',
    'is_escalated',
    'is_high_risk'
].join(', ');

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function escapeIlikePattern(value) {
    return sanitizeText(value, 240).replace(/[%_\\]/g, (match) => `\\${match}`);
}

function isMissingAdminCommentsFeedError(error) {
    const message = sanitizeText(error?.message || error?.details || '', 500).toLowerCase();
    if (error?.code === 'ADMIN_COMMENTS_FEED_UNAVAILABLE') {
        return true;
    }

    if (!message) {
        return false;
    }

    return message.includes(COMMENTS_FEED_VIEW)
        || message.includes(COMMENTS_SUMMARY_RPC)
        || message.includes('search_document')
        || message.includes('block_scopes');
}

function buildMissingAdminCommentsFeedError(reason = '') {
    const error = new Error(`admin_comments_feed unavailable${reason ? `: ${reason}` : ''}`);
    error.code = 'ADMIN_COMMENTS_FEED_UNAVAILABLE';
    return error;
}

function buildUserBlockStateFromFeedRow(row = {}) {
    const scopes = Array.isArray(row?.block_scopes)
        ? row.block_scopes.map((scope) => sanitizeText(scope, 40)).filter(Boolean)
        : [];

    return {
        blocks: scopes.map((scope) => ({
            user_id: sanitizeText(row?.user_id, 160),
            scope,
            reason: '',
            expires_at: null
        })),
        scopes,
        hasGlobalBlock: row?.has_global_block === true,
        isGuestbookBlocked: row?.is_guestbook_blocked === true || row?.has_global_block === true,
        isGalleryBlocked: row?.is_gallery_blocked === true || row?.has_global_block === true
    };
}

function buildWorkflowFromFeedRow(row = {}) {
    return {
        ...buildDefaultCommentWorkflow({
            site: row?.site || 'all',
            entityType: row?.entity_type || '',
            entityId: row?.id || ''
        }),
        exists: sanitizeText(row?.workflow_status, 40).length > 0,
        status: sanitizeText(row?.workflow_status, 40).toLowerCase() || 'pending',
        priority: sanitizeText(row?.workflow_priority, 20).toLowerCase() || 'normal',
        assignee_id: sanitizeText(row?.workflow_assignee_id, 160),
        assignee_label: sanitizeText(row?.workflow_assignee_label, 255),
        tags: Array.isArray(row?.workflow_tags) ? row.workflow_tags : [],
        note_count: Math.max(0, Number.parseInt(row?.workflow_note_count, 10) || 0),
        linked_ticket_count: Math.max(0, Number.parseInt(row?.workflow_linked_ticket_count, 10) || 0),
        linked_ticket_ids: Array.isArray(row?.workflow_linked_ticket_ids) ? row.workflow_linked_ticket_ids : [],
        resolved_at: row?.workflow_resolved_at || null,
        updated_at: row?.workflow_updated_at || null,
        last_activity_at: row?.workflow_last_activity_at || null,
        metadata: row?.workflow_metadata && typeof row.workflow_metadata === 'object' && !Array.isArray(row.workflow_metadata)
            ? row.workflow_metadata
            : {}
    };
}

function shapeCommentFeedRow(row = {}) {
    return {
        id: sanitizeText(row?.id, 160),
        site: normalizeCommentsSite(row?.site, 'cn'),
        type: sanitizeText(row?.type, 40) || 'guestbook',
        entity_type: sanitizeText(row?.entity_type, 80),
        entity_label: sanitizeText(row?.entity_label, 80),
        record_type: sanitizeText(row?.record_type, 40),
        level: sanitizeText(row?.level, 40),
        thread_depth: Math.max(0, Number.parseInt(row?.thread_depth, 10) || 0),
        content: sanitizeText(row?.content, 8000),
        author: sanitizeText(row?.author, 255) || '未知用户',
        email: sanitizeText(row?.email, 320),
        avatar: row?.avatar || null,
        created_at: row?.created_at || null,
        context: sanitizeText(row?.context, 160),
        context_title: sanitizeText(row?.context_title, 255),
        context_type_label: sanitizeText(row?.context_type_label, 80),
        prompt_title: sanitizeText(row?.prompt_title, 255),
        like_count: Math.max(0, Number.parseInt(row?.like_count, 10) || 0),
        likes: Math.max(0, Number.parseInt(row?.likes, 10) || 0),
        user_id: sanitizeText(row?.user_id, 160),
        parent_id: sanitizeText(row?.parent_id, 160) || null,
        message_id: sanitizeText(row?.message_id, 160) || null,
        prompt_id: sanitizeText(row?.prompt_id, 160) || null,
        thread_root_id: sanitizeText(row?.thread_root_id, 160) || null,
        thread_root_type: sanitizeText(row?.thread_root_type, 80),
        parent_snippet: sanitizeText(row?.parent_snippet, 8000),
        parent_author: sanitizeText(row?.parent_author, 255),
        root_snippet: sanitizeText(row?.root_snippet, 8000),
        image_url: row?.image_url || null,
        is_pinned: row?.is_pinned === true,
        is_featured: row?.is_featured === true,
        reply_count: Math.max(0, Number.parseInt(row?.reply_count, 10) || 0),
        user_block_state: buildUserBlockStateFromFeedRow(row),
        workflow: buildWorkflowFromFeedRow(row)
    };
}

function applyFeedQueueFilter(query, queue = 'pending') {
    if (!query) {
        return query;
    }

    if (queue === 'pending') {
        if (typeof query?.or === 'function') {
            return query.or('workflow_status.is.null,workflow_status.eq.pending,workflow_status.eq.in_review,workflow_status.eq.escalated');
        }
        return query;
    }

    if (queue === 'all') {
        return query;
    }

    if (queue === 'guestbook_unreplied') {
        return query
            .eq('type', 'guestbook')
            .eq('record_type', 'message')
            .eq('reply_count', 0);
    }

    if (queue === 'high_risk') {
        return query.eq('is_high_risk', true);
    }

    if (queue === 'blocked_user') {
        return query.eq('is_blocked', true);
    }

    if (queue === 'escalated') {
        return query.eq('is_escalated', true);
    }

    return query;
}

function applyFeedSearchFilters(query, filters = {}, view = 'guestbook') {
    let nextQuery = query;
    const searchTerm = sanitizeText(filters?.search, 240);
    const searchTags = Array.isArray(filters?.searchTags) ? filters.searchTags : [];
    const normalizedSearch = searchTerm.toLowerCase();
    const isPinnedSearch = view === 'gallery' && (normalizedSearch === '置顶' || normalizedSearch === 'pinned');

    if (isPinnedSearch) {
        nextQuery = nextQuery.eq('is_pinned', true);
    } else if (searchTerm) {
        if (typeof nextQuery?.ilike !== 'function') {
            throw buildMissingAdminCommentsFeedError('missing ilike support');
        }
        nextQuery = nextQuery.ilike('search_document', `%${escapeIlikePattern(searchTerm)}%`);
    }

    searchTags.forEach((tag) => {
        const normalizedTag = sanitizeText(tag, 80);
        if (!normalizedTag) {
            return;
        }

        if (typeof nextQuery?.ilike !== 'function') {
            throw buildMissingAdminCommentsFeedError('missing ilike support');
        }
        nextQuery = nextQuery.ilike('search_document', `%${escapeIlikePattern(normalizedTag)}%`);
    });

    return nextQuery;
}

async function queryCommentsFeedPage(supabase, {
    view,
    site,
    dateFrom = '',
    dateTo = '',
    filters = {},
    page = 1,
    pageSize = 40
} = {}) {
    let query = supabase
        .from(COMMENTS_FEED_VIEW)
        .select(COMMENTS_FEED_SELECT_FIELDS, { count: 'exact' })
        .eq('type', view)
        .order('created_at', { ascending: false });

    query = applyCommentsSiteFilter(query, site);
    query = applyCommentsDateRange(query, { dateFrom, dateTo });

    if (filters.promptId) {
        query = query.eq('prompt_id', sanitizeText(filters.promptId, 160));
    }

    if (filters.source && filters.source !== 'all') {
        query = query.eq('type', filters.source);
    }

    if (filters.status === 'replied') {
        if (typeof query?.gt !== 'function') {
            throw buildMissingAdminCommentsFeedError('missing gt support');
        }
        query = query.gt('reply_count', 0);
    } else if (filters.status === 'unreplied') {
        query = query.eq('reply_count', 0);
    }

    if (filters.type === 'top') {
        query = query.eq('level', 'top');
    } else if (filters.type === 'reply') {
        query = query.eq('level', 'reply');
    }

    if (filters.hasImage) {
        query = query.eq('has_image', true);
    }

    query = applyFeedQueueFilter(query, filters.queue);
    query = applyFeedSearchFilters(query, filters, view);

    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safePageSize = Math.max(1, Math.min(Number.parseInt(pageSize, 10) || 40, 200));
    const start = (safePage - 1) * safePageSize;
    const end = start + safePageSize - 1;

    if (typeof query?.range !== 'function') {
        throw buildMissingAdminCommentsFeedError('missing range support');
    }
    const { data, error, count } = await query.range(start, end);
    if (error) {
        throw error;
    }

    const totalItems = Math.max(0, Number.parseInt(count, 10) || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
    const currentPage = Math.min(safePage, totalPages);

    return {
        comments: (data || []).map(shapeCommentFeedRow),
        pagination: {
            page: currentPage,
            pageSize: safePageSize,
            totalItems,
            totalPages,
            hasPrevPage: currentPage > 1,
            hasNextPage: currentPage < totalPages,
            returnedItems: Array.isArray(data) ? data.length : 0
        }
    };
}

async function fetchCommentsSummaryFromFeed(supabase, site = 'all') {
    if (typeof supabase?.rpc !== 'function') {
        throw buildMissingAdminCommentsFeedError('missing rpc support');
    }

    const { data, error } = await supabase.rpc(COMMENTS_SUMMARY_RPC, {
        p_site: normalizeCommentsSite(site, 'all')
    });

    if (error) {
        throw error;
    }

    return data || {};
}

module.exports = {
    COMMENTS_FEED_VIEW,
    COMMENTS_SUMMARY_RPC,
    fetchCommentsSummaryFromFeed,
    isMissingAdminCommentsFeedError,
    queryCommentsFeedPage
};
