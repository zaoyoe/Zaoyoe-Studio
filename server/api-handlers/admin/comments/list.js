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

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

const PROMPT_TITLE_SELECT_FIELDS = 'id, title, title_zh, title_en';
const PROMPT_TITLE_LEGACY_SELECT_FIELDS = 'id, title';

function isMissingOptionalPromptTitleColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;

    return ['title_zh', 'title_en'].some((field) => (
        message.includes(`column ${field}`) ||
        message.includes(`prompts.${field}`) ||
        message.includes(`"${field}"`)
    ));
}

async function loadGuestbookAdminComments(supabase, { site, dateFrom, dateTo }) {
    const messageQuery = applyCommentsDateRange(
        applyCommentsSiteFilter(
            supabase
                .from('guestbook_messages')
                .select('id, site, content, user_id, created_at, image_url, like_count')
                .order('created_at', { ascending: false })
                .limit(50),
            site
        ),
        { dateFrom, dateTo }
    );

    const commentQuery = applyCommentsDateRange(
        applyCommentsSiteFilter(
            supabase
                .from('guestbook_comments')
                .select('id, site, message_id, parent_id, content, user_id, created_at')
                .order('created_at', { ascending: false })
                .limit(100),
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

    const guestbookComments = comments || [];
    const guestbookMessages = messages || [];
    const guestbookUserIds = uniqueIds([
        ...guestbookMessages.map((message) => message.user_id),
        ...guestbookComments.map((comment) => comment.user_id)
    ]);
    const commentIds = guestbookComments.map(comment => comment.id).filter(Boolean);
    const messageReplyCounts = buildCountMap(guestbookComments, 'message_id');
    const commentReplyCounts = buildCountMap(guestbookComments.filter(comment => comment.parent_id), 'parent_id');
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

    const messageRows = guestbookMessages.map(message => ({
        id: message.id,
        site: normalizeCommentsSite(message.site, 'cn'),
        type: 'guestbook',
        record_type: 'message',
        level: 'top',
        content: message.content || '',
        author: profileMap.get(message.user_id)?.username || '未知用户',
        email: profileMap.get(message.user_id)?.email || '',
        avatar: profileMap.get(message.user_id)?.avatar_url || null,
        created_at: message.created_at,
        context: message.id,
        prompt_title: '',
        likes: Number(message.like_count || 0),
        user_id: message.user_id,
        parent_id: null,
        image_url: message.image_url || null,
        reply_count: messageReplyCounts[message.id] || 0
    }));

    const commentRows = guestbookComments.map(comment => ({
        id: comment.id,
        site: normalizeCommentsSite(comment.site, 'cn'),
        type: 'guestbook',
        record_type: comment.parent_id ? 'reply' : 'comment',
        level: 'reply',
        content: comment.content || '',
        author: profileMap.get(comment.user_id)?.username || '未知用户',
        email: profileMap.get(comment.user_id)?.email || '',
        avatar: profileMap.get(comment.user_id)?.avatar_url || null,
        created_at: comment.created_at,
        context: comment.message_id,
        prompt_title: '',
        likes: commentLikeCounts[comment.id] || 0,
        user_id: comment.user_id,
        parent_id: comment.parent_id,
        image_url: null,
        reply_count: commentReplyCounts[comment.id] || 0
    }));

    return sortByCreatedAtDesc([...messageRows, ...commentRows]);
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

async function loadGalleryAdminComments(supabase, { site, dateFrom, dateTo }) {
    const query = applyCommentsDateRange(
        applyCommentsSiteFilter(
            supabase
                .from('prompt_comments')
                .select('id, site, prompt_id, parent_id, content, user_id, created_at, image_url, is_pinned, is_featured')
                .order('created_at', { ascending: false })
                .limit(50),
            site
        ),
        { dateFrom, dateTo }
    );

    const { data, error } = await query;
    if (error) {
        throw error;
    }

    const comments = data || [];
    const replyCounts = buildCountMap(comments.filter(comment => comment.parent_id), 'parent_id');
    const promptIds = uniqueIds(comments.map((comment) => comment.prompt_id));
    const userIds = uniqueIds(comments.map((comment) => comment.user_id));
    const commentIds = uniqueIds(comments.map((comment) => comment.id));
    const [profileMap, promptMap, likeCounts] = await Promise.all([
        fetchProfilesByIds(supabase, userIds),
        fetchPromptTitlesByIds(supabase, promptIds),
        fetchPromptCommentLikeCounts(supabase, site, commentIds)
    ]);

    return sortByCreatedAtDesc(comments.map(comment => ({
        id: comment.id,
        site: normalizeCommentsSite(comment.site, 'cn'),
        type: 'gallery',
        record_type: comment.parent_id ? 'reply' : 'comment',
        level: comment.parent_id ? 'reply' : 'top',
        content: comment.content || '',
        author: profileMap.get(comment.user_id)?.username || '未知用户',
        email: profileMap.get(comment.user_id)?.email || '',
        avatar: profileMap.get(comment.user_id)?.avatar_url || null,
        created_at: comment.created_at,
        context: comment.prompt_id,
        prompt_title: promptMap.get(comment.prompt_id)?.title
            || promptMap.get(comment.prompt_id)?.title_zh
            || promptMap.get(comment.prompt_id)?.title_en
            || 'Unknown',
        likes: likeCounts[comment.id] || 0,
        user_id: comment.user_id,
        parent_id: comment.parent_id,
        image_url: comment.image_url || null,
        is_pinned: comment.is_pinned === true,
        is_featured: comment.is_featured === true,
        reply_count: replyCounts[comment.id] || 0
    })));
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
        const dateFrom = String(searchParams.get('dateFrom') || '').trim();
        const dateTo = String(searchParams.get('dateTo') || '').trim();

        const comments = view === 'gallery'
            ? await loadGalleryAdminComments(supabase, { site, dateFrom, dateTo })
            : await loadGuestbookAdminComments(supabase, { site, dateFrom, dateTo });

        return sendJson(res, 200, {
            success: true,
            view,
            site,
            comments
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Comments list request failed'
        });
    }
};
