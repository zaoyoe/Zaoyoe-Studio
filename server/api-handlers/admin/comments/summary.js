const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    applyCommentsSiteFilter,
    normalizeCommentsSite
} = require('./shared');

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
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

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayISO = today.toISOString();

        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        const lastWeekISO = lastWeek.toISOString();

        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const twoWeeksAgoISO = twoWeeksAgo.toISOString();

        const [
            { count: guestbookMessageCount },
            { count: guestbookCommentCount },
            { count: galleryCount },
            { count: todayGuestbookMessageCount },
            { count: todayGuestbookCommentCount },
            { count: todayGalleryCount },
            { data: guestbookMessageUsers },
            { data: guestbookCommentUsers },
            { data: galleryUsers },
            { count: thisWeekGuestbookMessages },
            { count: thisWeekGuestbookComments },
            { count: thisWeekGallery },
            { count: prevWeekGuestbookMessages },
            { count: prevWeekGuestbookComments },
            { count: prevWeekGallery }
        ] = await Promise.all([
            applyCommentsSiteFilter(supabase.from('guestbook_messages').select('*', { count: 'exact', head: true }), site),
            applyCommentsSiteFilter(supabase.from('guestbook_comments').select('*', { count: 'exact', head: true }), site),
            applyCommentsSiteFilter(supabase.from('prompt_comments').select('*', { count: 'exact', head: true }), site),
            applyCommentsSiteFilter(supabase.from('guestbook_messages').select('*', { count: 'exact', head: true }).gte('created_at', todayISO), site),
            applyCommentsSiteFilter(supabase.from('guestbook_comments').select('*', { count: 'exact', head: true }).gte('created_at', todayISO), site),
            applyCommentsSiteFilter(supabase.from('prompt_comments').select('*', { count: 'exact', head: true }).gte('created_at', todayISO), site),
            applyCommentsSiteFilter(supabase.from('guestbook_messages').select('user_id').not('user_id', 'is', null), site),
            applyCommentsSiteFilter(supabase.from('guestbook_comments').select('user_id').not('user_id', 'is', null), site),
            applyCommentsSiteFilter(supabase.from('prompt_comments').select('user_id').not('user_id', 'is', null), site),
            applyCommentsSiteFilter(supabase.from('guestbook_messages').select('*', { count: 'exact', head: true }).gte('created_at', lastWeekISO), site),
            applyCommentsSiteFilter(supabase.from('guestbook_comments').select('*', { count: 'exact', head: true }).gte('created_at', lastWeekISO), site),
            applyCommentsSiteFilter(supabase.from('prompt_comments').select('*', { count: 'exact', head: true }).gte('created_at', lastWeekISO), site),
            applyCommentsSiteFilter(supabase.from('guestbook_messages').select('*', { count: 'exact', head: true }).gte('created_at', twoWeeksAgoISO).lt('created_at', lastWeekISO), site),
            applyCommentsSiteFilter(supabase.from('guestbook_comments').select('*', { count: 'exact', head: true }).gte('created_at', twoWeeksAgoISO).lt('created_at', lastWeekISO), site),
            applyCommentsSiteFilter(supabase.from('prompt_comments').select('*', { count: 'exact', head: true }).gte('created_at', twoWeeksAgoISO).lt('created_at', lastWeekISO), site)
        ]);

        const totalCount = (guestbookMessageCount || 0) + (guestbookCommentCount || 0) + (galleryCount || 0);
        const todayCount = (todayGuestbookMessageCount || 0) + (todayGuestbookCommentCount || 0) + (todayGalleryCount || 0);
        const activeUsersCount = new Set([
            ...(guestbookMessageUsers || []).map(user => user.user_id),
            ...(guestbookCommentUsers || []).map(user => user.user_id),
            ...(galleryUsers || []).map(user => user.user_id)
        ].filter(Boolean)).size;

        const thisWeekCount = (thisWeekGuestbookMessages || 0) + (thisWeekGuestbookComments || 0) + (thisWeekGallery || 0);
        const prevWeekCount = (prevWeekGuestbookMessages || 0) + (prevWeekGuestbookComments || 0) + (prevWeekGallery || 0);
        const weekGrowth = prevWeekCount > 0
            ? Math.round(((thisWeekCount - prevWeekCount) / prevWeekCount) * 100)
            : 0;

        return sendJson(res, 200, {
            success: true,
            site,
            summary: {
                totalCount,
                todayCount,
                activeUsersCount,
                weekGrowth
            }
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Comments summary request failed'
        });
    }
};
