const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    applyCommentsSiteFilter,
    normalizeCommentsSite,
    normalizeCommentsView
} = require('./shared');
const {
    isMissingCommentWorkflowSchemaError
} = require('./_workflow');
const {
    fetchCommentsSummaryFromFeed,
    isMissingAdminCommentsFeedError
} = require('./_feed-view');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeCommentsSummaryView(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'all') {
        return 'all';
    }
    return normalizeCommentsView(normalized);
}

function isActiveBlock(row, now = new Date()) {
    const expiresAt = String(row?.expires_at || '').trim();
    if (!expiresAt) {
        return true;
    }

    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
        return true;
    }

    return expiresAtMs > now.getTime();
}

function countRowsWithinRange(rows = [], startMs = 0, endMs = Number.POSITIVE_INFINITY) {
    return (Array.isArray(rows) ? rows : []).filter((row) => {
        const createdAtMs = Date.parse(row?.created_at || 0);
        return Number.isFinite(createdAtMs) && createdAtMs >= startMs && createdAtMs < endMs;
    }).length;
}

function collectUniqueUsersWithinRange(rows = [], startMs = 0, endMs = Number.POSITIVE_INFINITY) {
    return new Set(
        (Array.isArray(rows) ? rows : [])
            .filter((row) => {
                const createdAtMs = Date.parse(row?.created_at || 0);
                return Number.isFinite(createdAtMs) && createdAtMs >= startMs && createdAtMs < endMs;
            })
            .map((row) => row?.user_id)
            .filter(Boolean)
    );
}

function getBlockedContentCount({
    guestbookMessages = [],
    guestbookComments = [],
    galleryComments = [],
    blockRows = [],
    view = 'all'
} = {}) {
    const now = new Date();
    const activeBlockRows = (Array.isArray(blockRows) ? blockRows : []).filter((row) => isActiveBlock(row, now));
    const blockStateByUser = activeBlockRows.reduce((acc, row) => {
        const userId = String(row?.user_id || '').trim();
        const scope = String(row?.scope || '').trim().toLowerCase();
        if (!userId || !scope) {
            return acc;
        }
        if (!acc[userId]) {
            acc[userId] = new Set();
        }
        acc[userId].add(scope);
        return acc;
    }, {});

    const isBlockedForScope = (userId, scope) => {
        const scopes = blockStateByUser[String(userId || '').trim()];
        return scopes instanceof Set && (scopes.has('all') || scopes.has(scope));
    };

    const includeGuestbook = view === 'all' || view === 'guestbook';
    const includeGallery = view === 'all' || view === 'gallery';

    return (includeGuestbook
        ? (guestbookMessages || []).filter((row) => isBlockedForScope(row?.user_id, 'guestbook')).length
            + (guestbookComments || []).filter((row) => isBlockedForScope(row?.user_id, 'guestbook')).length
        : 0)
        + (includeGallery
            ? (galleryComments || []).filter((row) => isBlockedForScope(row?.user_id, 'gallery')).length
            : 0);
}

async function fetchOptionalWorkflowRows(supabase, site) {
    const { data, error } = await applyCommentsSiteFilter(
        supabase
            .from('admin_comment_workflows')
            .select('entity_type, status, priority, linked_ticket_count, tags'),
        site
    );

    if (error) {
        if (isMissingCommentWorkflowSchemaError(error)) {
            return [];
        }
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

function matchesCommentsWorkflowView(row, view = 'all') {
    if (view === 'all') {
        return true;
    }

    const entityType = String(row?.entity_type || '').trim().toLowerCase();
    if (view === 'guestbook') {
        return entityType === 'guestbook_message' || entityType === 'guestbook_comment';
    }

    return entityType === 'prompt_comment';
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase } = await requireAdmin(req, { anyOf: ['content.moderate', 'analytics.view'] });
        const searchParams = getQueryParams(req);
        const site = normalizeCommentsSite(searchParams.get('site') || req.adminSite, 'all');
        const view = normalizeCommentsSummaryView(searchParams.get('view'));

        if (view === 'all') {
            try {
                const summary = await fetchCommentsSummaryFromFeed(supabase, site);
                return sendJson(res, 200, {
                    success: true,
                    site,
                    view,
                    summary
                });
            } catch (fastPathError) {
                if (!isMissingAdminCommentsFeedError(fastPathError)) {
                    throw fastPathError;
                }
            }
        }

        const now = Date.now();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartMs = todayStart.getTime();
        const weekStartMs = now - 7 * 24 * 60 * 60 * 1000;
        const twoWeeksAgoMs = now - 14 * 24 * 60 * 60 * 1000;

        const [
            { data: guestbookMessages, error: guestbookMessagesError },
            { data: guestbookComments, error: guestbookCommentsError },
            { data: galleryComments, error: galleryCommentsError },
            { data: blockRows, error: blockRowsError },
            workflowRows
        ] = await Promise.all([
            applyCommentsSiteFilter(
                supabase.from('guestbook_messages').select('id, user_id, created_at'),
                site
            ),
            applyCommentsSiteFilter(
                supabase.from('guestbook_comments').select('id, user_id, parent_id, message_id, created_at'),
                site
            ),
            applyCommentsSiteFilter(
                supabase.from('prompt_comments').select('id, user_id, parent_id, created_at'),
                site
            ),
            supabase.from('blocked_users').select('user_id, scope, expires_at'),
            fetchOptionalWorkflowRows(supabase, site)
        ]);

        if (guestbookMessagesError) throw guestbookMessagesError;
        if (guestbookCommentsError) throw guestbookCommentsError;
        if (galleryCommentsError) throw galleryCommentsError;
        if (blockRowsError) throw blockRowsError;

        const guestbookMessageRows = guestbookMessages || [];
        const guestbookCommentRows = guestbookComments || [];
        const galleryCommentRows = galleryComments || [];

        const scopedGuestbookMessages = view === 'gallery' ? [] : guestbookMessageRows;
        const scopedGuestbookComments = view === 'gallery' ? [] : guestbookCommentRows;
        const scopedGalleryComments = view === 'guestbook' ? [] : galleryCommentRows;
        const scopedWorkflowRows = workflowRows.filter((row) => matchesCommentsWorkflowView(row, view));

        const guestbookTopCommentCount = scopedGuestbookComments.filter((row) => !row?.parent_id).length;
        const guestbookReplyCount = scopedGuestbookComments.filter((row) => row?.parent_id).length;
        const galleryTopCommentCount = scopedGalleryComments.filter((row) => !row?.parent_id).length;
        const galleryReplyCount = scopedGalleryComments.filter((row) => row?.parent_id).length;

        const totalMessages = scopedGuestbookMessages.length;
        const totalComments = guestbookTopCommentCount + galleryTopCommentCount;
        const totalReplies = guestbookReplyCount + galleryReplyCount;
        const totalFeedback = totalMessages + totalComments + totalReplies;

        const todayCount = countRowsWithinRange(
            [...scopedGuestbookMessages, ...scopedGuestbookComments, ...scopedGalleryComments],
            todayStartMs,
            Number.POSITIVE_INFINITY
        );

        const activeUsersCount = new Set([
            ...collectUniqueUsersWithinRange(scopedGuestbookMessages, weekStartMs),
            ...collectUniqueUsersWithinRange(scopedGuestbookComments, weekStartMs),
            ...collectUniqueUsersWithinRange(scopedGalleryComments, weekStartMs)
        ]).size;

        const thisWeekCount = countRowsWithinRange(
            [...scopedGuestbookMessages, ...scopedGuestbookComments, ...scopedGalleryComments],
            weekStartMs,
            Number.POSITIVE_INFINITY
        );
        const prevWeekCount = countRowsWithinRange(
            [...scopedGuestbookMessages, ...scopedGuestbookComments, ...scopedGalleryComments],
            twoWeeksAgoMs,
            weekStartMs
        );
        const weekGrowth = prevWeekCount > 0
            ? Math.round(((thisWeekCount - prevWeekCount) / prevWeekCount) * 100)
            : 0;

        const workflowResolvedCount = scopedWorkflowRows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'resolved').length;
        const workflowIgnoredCount = scopedWorkflowRows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'ignored').length;
        const workflowEscalatedCount = scopedWorkflowRows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'escalated').length;
        const workflowHighRiskCount = scopedWorkflowRows.filter((row) => {
            const priority = String(row?.priority || '').trim().toLowerCase();
            const tags = Array.isArray(row?.tags) ? row.tags : [];
            return priority === 'high'
                || tags.some((tag) => ['risk', 'high_risk', 'spam', 'abuse'].includes(String(tag || '').toLowerCase()));
        }).length;

        // "未回复留言" 是一个跨页签队列入口，点击后会切回留言板，
        // 所以它始终展示当前站点下的真实留言积压，而不是当前 view 内的子集。
        const guestbookReplyCounts = guestbookCommentRows.reduce((acc, row) => {
            const messageId = String(row?.message_id || '').trim();
            if (!messageId) {
                return acc;
            }
            acc[messageId] = (acc[messageId] || 0) + 1;
            return acc;
        }, {});
        const guestbookUnrepliedCount = guestbookMessageRows.filter((row) => (guestbookReplyCounts[row.id] || 0) <= 0).length;

        const blockedUserContentCount = getBlockedContentCount({
            guestbookMessages: scopedGuestbookMessages,
            guestbookComments: scopedGuestbookComments,
            galleryComments: scopedGalleryComments,
            blockRows,
            view
        });

        const openGovernanceCount = Math.max(
            0,
            totalFeedback - workflowResolvedCount - workflowIgnoredCount
        );

        return sendJson(res, 200, {
            success: true,
            site,
            view,
            summary: {
                totalCount: totalFeedback,
                todayCount,
                activeUsersCount,
                weekGrowth,
                totalFeedback,
                totalMessages,
                totalComments,
                totalReplies,
                todayFeedbackCount: todayCount,
                activeUsers7d: activeUsersCount,
                openGovernanceCount,
                escalatedCount: workflowEscalatedCount,
                resolvedCount: workflowResolvedCount,
                queueCounts: {
                    pending: openGovernanceCount,
                    guestbook_unreplied: guestbookUnrepliedCount,
                    high_risk: Math.max(workflowHighRiskCount, blockedUserContentCount),
                    blocked_user: blockedUserContentCount,
                    escalated: workflowEscalatedCount
                }
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Comments summary request failed'
        });
    }
};
