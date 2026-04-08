const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const DEFAULT_ANALYTICS_DAYS = 7;
const ANALYTICS_ROW_PAGE_SIZE = 500;
const ANALYTICS_ROW_MAX_PAGES = 12;

const TABLE_DEFINITIONS = Object.freeze({
    promptUnlocks: {
        table: 'prompt_unlocks',
        columns: 'id, unlocked_at, site',
        orderBy: 'unlocked_at',
        rangeColumn: 'unlocked_at'
    },
    verificationLogs: {
        table: 'verification_logs',
        columns: 'verification_id, user_id, email, site, status, summary, message, error_message, stage_label, raw_status, points_deducted, created_at',
        orderBy: 'created_at',
        rangeColumn: 'created_at'
    },
    guestbookMessages: {
        table: 'guestbook_messages',
        columns: 'id, content, created_at, site',
        orderBy: 'created_at',
        rangeColumn: 'created_at'
    },
    guestbookComments: {
        table: 'guestbook_comments',
        columns: 'id, message_id, created_at, site',
        orderBy: 'created_at',
        rangeColumn: 'created_at'
    },
    guestbookLikes: {
        table: 'guestbook_likes',
        columns: 'id, created_at, site',
        orderBy: 'created_at',
        rangeColumn: 'created_at'
    },
    promptComments: {
        table: 'prompt_comments',
        columns: 'id, created_at, site',
        orderBy: 'created_at',
        rangeColumn: 'created_at'
    },
    pointsLedger: {
        table: 'points_ledger',
        columns: 'id, amount, reason, reference_id, created_at, site',
        orderBy: 'created_at',
        rangeColumn: 'created_at'
    }
});

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizePositiveInteger(value, fallback, min = 1, max = Number.POSITIVE_INFINITY) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function parseQueryDate(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function buildRangeWindow(params) {
    const startDate = parseQueryDate(params.get('startDate'));
    const endDate = parseQueryDate(params.get('endDate'));

    if (startDate && endDate && startDate.getTime() <= endDate.getTime()) {
        return {
            mode: 'explicit',
            startIso: startDate.toISOString(),
            endIso: endDate.toISOString()
        };
    }

    const days = normalizePositiveInteger(params.get('days'), DEFAULT_ANALYTICS_DAYS, 1, 3660);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - Math.max(0, days - 1));

    return {
        mode: 'rolling',
        days,
        startIso: start.toISOString(),
        endIso: end.toISOString()
    };
}

async function fetchPagedRows(supabase, definition, {
    site = 'all',
    startIso = '',
    endIso = ''
} = {}) {
    const rows = [];
    let truncated = false;

    for (let pageIndex = 0; pageIndex < ANALYTICS_ROW_MAX_PAGES; pageIndex += 1) {
        const from = pageIndex * ANALYTICS_ROW_PAGE_SIZE;
        const to = from + ANALYTICS_ROW_PAGE_SIZE - 1;
        let query = supabase
            .from(definition.table)
            .select(definition.columns)
            .order(definition.orderBy, { ascending: false })
            .range(from, to);

        if (site && site !== 'all') {
            query = query.eq('site', site);
        }

        if (definition.rangeColumn && startIso) {
            query = query.gte(definition.rangeColumn, startIso);
        }

        if (definition.rangeColumn && endIso) {
            query = query.lte(definition.rangeColumn, endIso);
        }

        const { data, error } = await query;
        if (error) {
            throw error;
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);

        if (batch.length < ANALYTICS_ROW_PAGE_SIZE) {
            break;
        }

        if (pageIndex === ANALYTICS_ROW_MAX_PAGES - 1) {
            truncated = true;
        }
    }

    return {
        rows,
        truncated
    };
}

async function loadTableSegment(supabase, definition, options = {}) {
    try {
        const result = await fetchPagedRows(supabase, definition, options);
        return {
            ok: true,
            statusCode: 200,
            message: '',
            rowCount: result.rows.length,
            truncated: result.truncated,
            rows: result.rows
        };
    } catch (error) {
        return {
            ok: false,
            statusCode: Number(error?.statusCode) || 500,
            message: error?.message || 'Failed to load analytics rows',
            rowCount: 0,
            truncated: false,
            rows: []
        };
    }
}

async function analyticsSummaryRowsBundleHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, { permission: 'analytics.view' });
        const params = getQueryParams(req);
        const site = normalizeAdminSite(params.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';
        const rangeWindow = buildRangeWindow(params);
        const segmentOptions = {
            site,
            startIso: rangeWindow.startIso,
            endIso: rangeWindow.endIso
        };

        const [
            promptUnlocks,
            verificationLogs,
            guestbookMessages,
            guestbookComments,
            guestbookLikes,
            promptComments,
            pointsLedger
        ] = await Promise.all([
            loadTableSegment(supabase, TABLE_DEFINITIONS.promptUnlocks, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.verificationLogs, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.guestbookMessages, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.guestbookComments, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.guestbookLikes, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.promptComments, segmentOptions),
            loadTableSegment(supabase, TABLE_DEFINITIONS.pointsLedger, segmentOptions)
        ]);

        const tables = {
            promptUnlocks,
            verificationLogs,
            guestbookMessages,
            guestbookComments,
            guestbookLikes,
            promptComments,
            pointsLedger
        };

        return sendJson(res, 200, {
            success: true,
            site,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            partial_failure_count: Object.values(tables).filter((segment) => !segment.ok).length,
            tables
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load analytics summary rows bundle'
        });
    }
}

module.exports = analyticsSummaryRowsBundleHandler;
module.exports.__testUtils = {
    TABLE_DEFINITIONS,
    buildRangeWindow,
    fetchPagedRows,
    loadTableSegment
};
