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
    buildRpcRangeParams,
    buildLegacyRpcParams,
    callRpcWithFallback,
    hasChannelBreakdownV2Signal,
    hasTopContentV2Signal
} = panelSupportBundleHandler.__testUtils;

const DEFAULT_TOP_CONTENT_LIMIT = 5;

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function buildAnalyticsSummaryWindowPayload(summaryV2Data = {}, overview = {}) {
    return {
        overview: overview && typeof overview === 'object' ? overview : {},
        user_trend: Array.isArray(summaryV2Data.user_trend) ? summaryV2Data.user_trend : [],
        channel_breakdown: Array.isArray(summaryV2Data.channel_breakdown) ? summaryV2Data.channel_breakdown : [],
        top_content: Array.isArray(summaryV2Data.top_content) ? summaryV2Data.top_content : [],
        event_overview: summaryV2Data.event_overview && typeof summaryV2Data.event_overview === 'object'
            ? summaryV2Data.event_overview
            : {},
        event_funnels: summaryV2Data.event_funnels && typeof summaryV2Data.event_funnels === 'object'
            ? summaryV2Data.event_funnels
            : {},
        generated_at: summaryV2Data.generated_at || new Date().toISOString()
    };
}

function buildSegmentSuccess(site, summary, options = {}) {
    return {
        ok: true,
        statusCode: 200,
        message: '',
        site,
        rpc_name: options.rpcName || '',
        used_legacy_fallback: options.usedLegacyFallback === true,
        fallback_reason: String(options.fallbackReason || '').trim(),
        summary: summary && typeof summary === 'object' ? summary : {}
    };
}

function buildSegmentFailure(site, error, fallbackMessage = 'Failed to load analytics summary window bundle segment') {
    return {
        ok: false,
        statusCode: Number(error?.statusCode) || 500,
        message: error?.message || fallbackMessage,
        site,
        rpc_name: '',
        used_legacy_fallback: false,
        fallback_reason: '',
        summary: null
    };
}

async function loadOverviewWithTrendFallback(supabase, site = 'all') {
    try {
        return await callRpcWithFallback(supabase, 'get_overview_stats_with_trend', [
            { p_site: site === 'all' ? null : site },
            {}
        ]);
    } catch (_error) {
        return callRpcWithFallback(supabase, 'get_overview_stats', [
            { p_site: site === 'all' ? null : site },
            {}
        ]);
    }
}

async function loadChannelBreakdownRows(supabase, rangeParams = {}) {
    try {
        const v2Payload = await callRpcWithFallback(supabase, 'get_channel_breakdown_v2', [
            rangeParams,
            buildLegacyRpcParams(rangeParams),
            buildLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        if (hasChannelBreakdownV2Signal(v2Payload)) {
            return v2Payload;
        }
    } catch (_error) {
        // fall through to legacy
    }

    return callRpcWithFallback(supabase, 'get_channel_breakdown', [
        rangeParams,
        buildLegacyRpcParams(rangeParams),
        buildLegacyRpcParams(rangeParams, { excludeDays: true }),
        {}
    ]);
}

async function loadTopContentRows(supabase, rangeParams = {}) {
    try {
        const v2Payload = await callRpcWithFallback(supabase, 'get_content_top_v2', [
            rangeParams,
            buildLegacyRpcParams(rangeParams),
            buildLegacyRpcParams(rangeParams, { excludeSite: true }),
            { p_limit: rangeParams.p_limit || DEFAULT_TOP_CONTENT_LIMIT }
        ]);
        if (hasTopContentV2Signal(v2Payload)) {
            return v2Payload;
        }
    } catch (_error) {
        // fall through to legacy
    }

    return callRpcWithFallback(supabase, 'get_content_top', [
        rangeParams,
        buildLegacyRpcParams(rangeParams),
        buildLegacyRpcParams(rangeParams, { excludeDays: true }),
        { p_limit: rangeParams.p_limit || DEFAULT_TOP_CONTENT_LIMIT }
    ]);
}

async function loadSummaryWindowSiteSegment(supabase, {
    site = 'all',
    rangeWindow = {},
    topContentLimit = DEFAULT_TOP_CONTENT_LIMIT
} = {}) {
    const summaryRangeParams = buildRpcRangeParams(rangeWindow, site);
    const legacySummaryParams = buildLegacyRpcParams(summaryRangeParams);

    try {
        const summaryV2 = await callRpcWithFallback(supabase, 'get_ai_summary_data_v2', [
            summaryRangeParams,
            legacySummaryParams,
            buildLegacyRpcParams(summaryRangeParams, { excludeSite: true }),
            {}
        ]);
        const summaryV2Data = summaryV2 && typeof summaryV2 === 'object' ? summaryV2 : {};
        let overview = summaryV2Data.overview && typeof summaryV2Data.overview === 'object'
            ? summaryV2Data.overview
            : {};

        if (
            !Object.prototype.hasOwnProperty.call(overview, 'dau_growth')
            || !Object.prototype.hasOwnProperty.call(overview, 'comments_growth')
        ) {
            try {
                const trendOverview = await loadOverviewWithTrendFallback(supabase, site);
                if (trendOverview && typeof trendOverview === 'object') {
                    overview = { ...trendOverview, ...overview };
                }
            } catch (_error) {
                // keep summaryV2 overview if trend supplement fails
            }
        }

        return buildSegmentSuccess(site, buildAnalyticsSummaryWindowPayload(summaryV2Data, overview), {
            rpcName: 'get_ai_summary_data_v2',
            usedLegacyFallback: false
        });
    } catch (summaryError) {
        try {
            const topContentRangeParams = buildRpcRangeParams(rangeWindow, site, {
                p_limit: topContentLimit
            });
            const [overview, userTrend, channelBreakdown, topContent] = await Promise.all([
                loadOverviewWithTrendFallback(supabase, site),
                callRpcWithFallback(supabase, 'get_user_trend', [
                    summaryRangeParams,
                    legacySummaryParams,
                    buildLegacyRpcParams(summaryRangeParams, { excludeSite: true }),
                    {}
                ]),
                loadChannelBreakdownRows(supabase, buildRpcRangeParams(rangeWindow, site)),
                loadTopContentRows(supabase, topContentRangeParams)
            ]);

            return buildSegmentSuccess(site, buildAnalyticsSummaryWindowPayload({
                user_trend: userTrend,
                channel_breakdown: channelBreakdown,
                top_content: topContent,
                generated_at: new Date().toISOString()
            }, overview), {
                rpcName: 'fallback_summary_window',
                usedLegacyFallback: true,
                fallbackReason: summaryError?.message || 'summary_window_v2_failed'
            });
        } catch (fallbackError) {
            return buildSegmentFailure(site, fallbackError, 'Failed to load analytics summary window');
        }
    }
}

module.exports = async function analyticsSummaryWindowBundleHandler(req, res) {
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
        const activeSite = normalizeAdminSite(params.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';
        const includeComparisonSites = params.get('includeComparisonSites') === '1' || activeSite === 'all';
        const topContentLimit = normalizePositiveInteger(params.get('topContentLimit'), DEFAULT_TOP_CONTENT_LIMIT, 1, 20);
        const rangeWindow = buildRangeWindow(params);
        const siteKeys = Array.from(new Set([
            activeSite,
            ...(includeComparisonSites && activeSite === 'all' ? ['cn', 'intl'] : [])
        ]));

        const segmentEntries = await Promise.all(siteKeys.map(async (site) => ([
            site,
            await loadSummaryWindowSiteSegment(supabase, {
                site,
                rangeWindow,
                topContentLimit
            })
        ])));

        const summaries = Object.fromEntries(segmentEntries);

        return sendJson(res, 200, {
            success: true,
            active_site: activeSite,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            include_comparison_sites: includeComparisonSites,
            top_content_limit: topContentLimit,
            partial_failure_count: Object.values(summaries).filter((segment) => !segment.ok).length,
            summaries
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load analytics summary window bundle'
        });
    }
};

module.exports.__testUtils = {
    DEFAULT_TOP_CONTENT_LIMIT,
    buildAnalyticsSummaryWindowPayload,
    buildSegmentSuccess,
    buildSegmentFailure,
    loadSummaryWindowSiteSegment
};
