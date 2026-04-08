const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const summaryRowsBundleHandler = require('./summary-rows-bundle');
const panelSupportBundleHandler = require('./panel-support-bundle');

const {
    buildRangeWindow
} = summaryRowsBundleHandler.__testUtils;

const {
    buildRpcRangeParams,
    buildLegacyRpcParams,
    callRpcWithFallback
} = panelSupportBundleHandler.__testUtils;

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function buildSegmentSuccess(payload, options = {}) {
    return {
        ok: true,
        statusCode: 200,
        message: '',
        rpc_name: options.rpcName || '',
        payload
    };
}

function buildSegmentFailure(error, fallbackMessage = 'Failed to load analytics trend series bundle segment') {
    return {
        ok: false,
        statusCode: Number(error?.statusCode) || 500,
        message: error?.message || fallbackMessage,
        rpc_name: '',
        payload: null
    };
}

async function loadTrendSegment(supabase, rpcName, rangeParams = {}, fallbackMessage = '') {
    try {
        const payload = await callRpcWithFallback(supabase, rpcName, [
            rangeParams,
            buildLegacyRpcParams(rangeParams),
            buildLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        return buildSegmentSuccess(payload, { rpcName });
    } catch (error) {
        return buildSegmentFailure(error, fallbackMessage || `Failed to load ${rpcName}`);
    }
}

module.exports = async function analyticsTrendSeriesBundleHandler(req, res) {
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
        const rangeParams = buildRpcRangeParams(rangeWindow, site);

        const [userTrend, contentTrend, revenueTrend] = await Promise.all([
            loadTrendSegment(supabase, 'get_user_trend', rangeParams, 'Failed to load user trend'),
            loadTrendSegment(supabase, 'get_content_trend', rangeParams, 'Failed to load content trend'),
            loadTrendSegment(supabase, 'get_revenue_trend', rangeParams, 'Failed to load revenue trend')
        ]);

        const segments = {
            userTrend,
            contentTrend,
            revenueTrend
        };

        return sendJson(res, 200, {
            success: true,
            site,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            partial_failure_count: Object.values(segments).filter((segment) => !segment.ok).length,
            segments
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load analytics trend series bundle'
        });
    }
};

module.exports.__testUtils = {
    buildSegmentSuccess,
    buildSegmentFailure,
    loadTrendSegment
};
