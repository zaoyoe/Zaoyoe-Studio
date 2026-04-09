const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    applyCommentsSiteFilter,
    normalizeCommentsSite
} = require('./shared');
const {
    isMissingCommentWorkflowSchemaError
} = require('./_workflow');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
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
    blockRows = []
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

    return (guestbookMessages || []).filter((row) => isBlockedForScope(row?.user_id, 'guestbook')).length
        + (guestbookComments || []).filter((row) => isBlockedForScope(row?.user_id, 'guestbook')).length
        + (galleryComments || []).filter((row) => isBlockedForScope(row?.user_id, 'gallery')).length;
}

async function fetchOptionalWorkflowRows(supabase, site) {
    const { data, error } = await applyCommentsSiteFilter(
        supabase
            .from('admin_comment_workflows')
            .select('status, priority, linked_ticket_count, tags'),
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

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'content.moderate' });
        const searchParams = getQueryParams(req);
        const site = normalizeCommentsSite(searchParams.get('site') || req.adminSite, 'all');

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

        const guestbookTopCommentCount = guestbookCommentRows.filter((row) => !row?.parent_id).length;
        const guestbookReplyCount = guestbookCommentRows.filter((row) => row?.parent_id).length;
        const galleryTopCommentCount = galleryCommentRows.filter((row) => !row?.parent_id).length;
        const galleryReplyCount = galleryCommentRows.filter((row) => row?.parent_id).length;

        const totalMessages = guestbookMessageRows.length;
        const totalComments = guestbookTopCommentCount + galleryTopCommentCount;
        const totalReplies = guestbookReplyCount + galleryReplyCount;
        const totalFeedback = totalMessages + totalComments + totalReplies;

        const todayCount = countRowsWithinRange(
            [...guestbookMessageRows, ...guestbookCommentRows, ...galleryCommentRows],
            todayStartMs,
            Number.POSITIVE_INFINITY
        );

        const activeUsersCount = new Set([
            ...collectUniqueUsersWithinRange(guestbookMessageRows, weekStartMs),
            ...collectUniqueUsersWithinRange(guestbookCommentRows, weekStartMs),
            ...collectUniqueUsersWithinRange(galleryCommentRows, weekStartMs)
        ]).size;

        const thisWeekCount = countRowsWithinRange(
            [...guestbookMessageRows, ...guestbookCommentRows, ...galleryCommentRows],
            weekStartMs,
            Number.POSITIVE_INFINITY
        );
        const prevWeekCount = countRowsWithinRange(
            [...guestbookMessageRows, ...guestbookCommentRows, ...galleryCommentRows],
            twoWeeksAgoMs,
            weekStartMs
        );
        const weekGrowth = prevWeekCount > 0
            ? Math.round(((thisWeekCount - prevWeekCount) / prevWeekCount) * 100)
            : 0;

        const workflowResolvedCount = workflowRows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'resolved').length;
        const workflowIgnoredCount = workflowRows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'ignored').length;
        const workflowEscalatedCount = workflowRows.filter((row) => {
            const status = String(row?.status || '').trim().toLowerCase();
            const linkedTicketCount = Number.parseInt(row?.linked_ticket_count, 10) || 0;
            return status === 'escalated' || linkedTicketCount > 0;
        }).length;
        const workflowHighRiskCount = workflowRows.filter((row) => {
            const priority = String(row?.priority || '').trim().toLowerCase();
            const tags = Array.isArray(row?.tags) ? row.tags : [];
            return priority === 'high'
                || tags.some((tag) => ['risk', 'high_risk', 'spam', 'abuse'].includes(String(tag || '').toLowerCase()));
        }).length;

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
            guestbookMessages: guestbookMessageRows,
            guestbookComments: guestbookCommentRows,
            galleryComments: galleryCommentRows,
            blockRows
        });

        const openGovernanceCount = Math.max(
            0,
            totalFeedback - workflowResolvedCount - workflowIgnoredCount
        );

        return sendJson(res, 200, {
            success: true,
            site,
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
