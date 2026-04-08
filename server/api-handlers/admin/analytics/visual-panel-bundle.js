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
    normalizePositiveInteger,
    normalizeRpcSite,
    buildRpcRangeParams,
    buildLegacyRpcParams,
    callRpcWithFallback
} = panelSupportBundleHandler.__testUtils;

const DEFAULT_TOP_CONTRIBUTORS_LIMIT = 10;

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
        used_legacy_fallback: options.usedLegacyFallback === true,
        fallback_reason: String(options.fallbackReason || '').trim(),
        payload
    };
}

function buildSegmentFailure(error, fallbackMessage = 'Failed to load analytics visual panel bundle segment') {
    return {
        ok: false,
        statusCode: Number(error?.statusCode) || 500,
        message: error?.message || fallbackMessage,
        rpc_name: '',
        used_legacy_fallback: false,
        fallback_reason: '',
        payload: null
    };
}

async function loadActivityHeatmapSegment(supabase, rangeParams = {}) {
    try {
        const payload = await callRpcWithFallback(supabase, 'get_activity_heatmap', [
            rangeParams,
            buildLegacyRpcParams(rangeParams),
            buildLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        return buildSegmentSuccess(payload, { rpcName: 'get_activity_heatmap' });
    } catch (error) {
        return buildSegmentFailure(error, 'Failed to load activity heatmap');
    }
}

async function loadRetentionCohortSegment(supabase, { site = 'all', weeks = 6, rangeWindow = {} } = {}) {
    const paramsWithExplicitRange = buildRpcRangeParams(rangeWindow, site, { p_weeks: weeks });
    delete paramsWithExplicitRange.p_days;

    try {
        const payload = await callRpcWithFallback(supabase, 'get_retention_cohort', [
            paramsWithExplicitRange,
            { p_weeks: weeks, p_site: normalizeRpcSite(site) },
            { p_weeks: weeks }
        ]);
        return buildSegmentSuccess(payload, { rpcName: 'get_retention_cohort' });
    } catch (error) {
        return buildSegmentFailure(error, 'Failed to load retention cohort');
    }
}

async function loadConversionFunnelSegment(supabase, rangeParams = {}) {
    try {
        const payload = await callRpcWithFallback(supabase, 'get_conversion_funnel_v2', [
            rangeParams,
            buildLegacyRpcParams(rangeParams),
            buildLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        return buildSegmentSuccess(payload, { rpcName: 'get_conversion_funnel_v2' });
    } catch (error) {
        return buildSegmentFailure(error, 'Failed to load conversion funnel');
    }
}

async function loadTopContributorsSegment(supabase, { site = 'all', limit = DEFAULT_TOP_CONTRIBUTORS_LIMIT } = {}) {
    try {
        const payload = await callRpcWithFallback(supabase, 'get_top_contributors', [
            { p_limit: limit, p_site: normalizeRpcSite(site) },
            { p_limit: limit }
        ]);
        return buildSegmentSuccess(payload, { rpcName: 'get_top_contributors' });
    } catch (error) {
        return buildSegmentFailure(error, 'Failed to load top contributors');
    }
}

async function loadGeoDistributionSegment(supabase, { site = 'all' } = {}) {
    try {
        const payload = await callRpcWithFallback(supabase, 'get_geo_distribution_by_site', [
            { p_site: normalizeRpcSite(site) },
            {}
        ]);
        return buildSegmentSuccess(payload, { rpcName: 'get_geo_distribution_by_site' });
    } catch (error) {
        return buildSegmentFailure(error, 'Failed to load geo distribution');
    }
}

module.exports = async function analyticsVisualPanelBundleHandler(req, res) {
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
        const weeks = normalizePositiveInteger(params.get('weeks'), Math.max(6, Math.min(26, Math.ceil((rangeWindow.days || 30) / 7) + 1)), 6, 26);
        const topContributorsLimit = normalizePositiveInteger(
            params.get('topContributorsLimit'),
            DEFAULT_TOP_CONTRIBUTORS_LIMIT,
            1,
            100
        );
        const rangeParams = buildRpcRangeParams(rangeWindow, site);

        const [
            activityHeatmap,
            retentionCohort,
            conversionFunnel,
            topContributors,
            geoDistribution
        ] = await Promise.all([
            loadActivityHeatmapSegment(supabase, rangeParams),
            loadRetentionCohortSegment(supabase, { site, weeks, rangeWindow }),
            loadConversionFunnelSegment(supabase, rangeParams),
            loadTopContributorsSegment(supabase, { site, limit: topContributorsLimit }),
            loadGeoDistributionSegment(supabase, { site })
        ]);

        const segments = {
            activityHeatmap,
            retentionCohort,
            conversionFunnel,
            topContributors,
            geoDistribution
        };

        return sendJson(res, 200, {
            success: true,
            site,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            weeks,
            limits: {
                topContributors: topContributorsLimit
            },
            partial_failure_count: Object.values(segments).filter((segment) => !segment.ok).length,
            segments
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load analytics visual panel bundle'
        });
    }
};

module.exports.__testUtils = {
    DEFAULT_TOP_CONTRIBUTORS_LIMIT,
    buildSegmentSuccess,
    buildSegmentFailure,
    loadActivityHeatmapSegment,
    loadRetentionCohortSegment,
    loadConversionFunnelSegment,
    loadTopContributorsSegment,
    loadGeoDistributionSegment
};
