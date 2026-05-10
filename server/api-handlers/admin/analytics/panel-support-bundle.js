const {
    normalizeAdminSite,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const summaryRowsBundleHandler = require('./summary-rows-bundle');

const {
    buildRangeWindow
} = summaryRowsBundleHandler.__testUtils;

const DEFAULT_TOP_CONTENT_LIMIT = 100;
const DEFAULT_POINTS_LEADERBOARD_LIMIT = 100;
const rpcAttemptPreference = Object.create(null);

function getQueryParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizePositiveInteger(value, fallback, min = 1, max = Number.POSITIVE_INFINITY) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return fallback;
    }

    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function normalizeRpcSite(site = 'all') {
    return site && site !== 'all' ? site : null;
}

function toRpcDateValue(value) {
    const normalized = String(value || '').trim();
    const localDateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/);
    if (localDateMatch) {
        return localDateMatch[1];
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function buildRpcRangeParams(rangeWindow = {}, site = 'all', baseParams = {}) {
    const params = {
        ...(baseParams && typeof baseParams === 'object' && !Array.isArray(baseParams) ? baseParams : {})
    };
    const rpcSite = normalizeRpcSite(site);
    const startDate = toRpcDateValue(rangeWindow.startIso);
    const endDate = toRpcDateValue(rangeWindow.endIso);

    params.p_site = rpcSite;

    if (Number.isFinite(rangeWindow.days) && rangeWindow.days > 0) {
        params.p_days = rangeWindow.days;
    }

    if (startDate && endDate) {
        params.p_start_date = startDate;
        params.p_end_date = endDate;
    }

    return params;
}

function buildLegacyRpcParams(params = {}, options = {}) {
    const legacyParams = {
        ...(params && typeof params === 'object' && !Array.isArray(params) ? params : {})
    };

    delete legacyParams.p_start_date;
    delete legacyParams.p_end_date;

    if (options.excludeSite === true) {
        delete legacyParams.p_site;
    }

    if (options.excludeDays === true) {
        delete legacyParams.p_days;
    }

    return legacyParams;
}

async function callRpcWithFallback(supabase, name, attempts = []) {
    const candidates = orderRpcAttempts(name, attempts);
    let lastError = null;

    for (const attempt of candidates) {
        const params = attempt && typeof attempt === 'object' && !Array.isArray(attempt) ? attempt : {};
        const hasParams = Object.keys(params).length > 0;
        const { data, error } = hasParams
            ? await supabase.rpc(name, params)
            : await supabase.rpc(name);

        if (!error) {
            rpcAttemptPreference[String(name || '')] = getRpcAttemptSignature(params);
            return data;
        }

        lastError = error;
    }

    throw lastError || new Error(`RPC ${name} 调用失败`);
}

function getRpcAttemptSignature(params = {}) {
    const keys = Object.keys(params && typeof params === 'object' && !Array.isArray(params) ? params : {})
        .sort();
    return keys.length ? keys.join('|') : '<empty>';
}

function orderRpcAttempts(name, attempts = []) {
    const candidates = Array.isArray(attempts) && attempts.length > 0 ? attempts : [{}];
    const preferredSignature = rpcAttemptPreference[String(name || '')] || '';
    if (!preferredSignature || candidates.length < 2) {
        return candidates;
    }

    const preferredIndex = candidates.findIndex((attempt) => (
        getRpcAttemptSignature(attempt) === preferredSignature
    ));

    if (preferredIndex <= 0) {
        return candidates;
    }

    return [
        candidates[preferredIndex],
        ...candidates.slice(0, preferredIndex),
        ...candidates.slice(preferredIndex + 1)
    ];
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

function buildSegmentFailure(error, fallbackMessage = 'Failed to load analytics panel support bundle segment') {
    return {
        ok: false,
        statusCode: Number(error?.statusCode) || 500,
        message: error?.message || fallbackMessage,
        rpc_name: '',
        payload: null
    };
}

function hasChannelBreakdownV2Signal(rows = []) {
    return Array.isArray(rows) && rows.some((row) => (
        Number(row?.event_count || 0)
        + Number(row?.user_count || 0)
        + Number(row?.unlock_success_count || 0)
        + Number(row?.verify_submit_count || 0)
        + Number(row?.recharge_success_count || 0)
        + Number(row?.shop_purchase_count || 0)
    ) > 0);
}

function hasTopContentV2Signal(rows = []) {
    return Array.isArray(rows) && rows.some((row) => (
        Number(row?.view_count || 0)
        + Number(row?.unlock_count || 0)
        + Number(row?.comment_count || 0)
    ) > 0);
}

async function loadChannelBreakdownSegment(supabase, rangeParams = {}) {
    let lastError = null;
    const legacyRangeParams = buildLegacyRpcParams(rangeParams);

    try {
        const v2Data = await callRpcWithFallback(supabase, 'get_channel_breakdown_v2', [
            rangeParams,
            legacyRangeParams,
            buildLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        if (hasChannelBreakdownV2Signal(v2Data)) {
            return buildSegmentSuccess(v2Data, { rpcName: 'get_channel_breakdown_v2' });
        }
    } catch (error) {
        lastError = error;
    }

    try {
        const legacyData = await callRpcWithFallback(supabase, 'get_channel_breakdown', [
            rangeParams,
            legacyRangeParams,
            buildLegacyRpcParams(rangeParams, { excludeDays: true }),
            {}
        ]);
        return buildSegmentSuccess(legacyData, { rpcName: 'get_channel_breakdown' });
    } catch (error) {
        return buildSegmentFailure(error || lastError, 'Failed to load channel breakdown');
    }
}

async function loadTopContentSegment(supabase, rangeParams = {}) {
    let lastError = null;
    const legacyRangeParams = buildLegacyRpcParams(rangeParams);

    try {
        const v2Data = await callRpcWithFallback(supabase, 'get_content_top_v2', [
            rangeParams,
            legacyRangeParams,
            buildLegacyRpcParams(rangeParams, { excludeSite: true }),
            { p_limit: rangeParams.p_limit || DEFAULT_TOP_CONTENT_LIMIT }
        ]);
        if (hasTopContentV2Signal(v2Data)) {
            return buildSegmentSuccess(v2Data, { rpcName: 'get_content_top_v2' });
        }
    } catch (error) {
        lastError = error;
    }

    try {
        const legacyData = await callRpcWithFallback(supabase, 'get_content_top', [
            rangeParams,
            legacyRangeParams,
            buildLegacyRpcParams(rangeParams, { excludeDays: true }),
            { p_limit: rangeParams.p_limit || DEFAULT_TOP_CONTENT_LIMIT }
        ]);
        return buildSegmentSuccess(legacyData, { rpcName: 'get_content_top' });
    } catch (error) {
        return buildSegmentFailure(error || lastError, 'Failed to load top content');
    }
}

async function loadSimpleRpcSegment(supabase, rpcName, attempts = [], fallbackMessage = '') {
    try {
        const payload = await callRpcWithFallback(supabase, rpcName, attempts);
        return buildSegmentSuccess(payload, { rpcName });
    } catch (error) {
        return buildSegmentFailure(error, fallbackMessage || `Failed to load ${rpcName}`);
    }
}

module.exports = async function analyticsPanelSupportBundleHandler(req, res) {
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
        const rpcSite = normalizeRpcSite(site);
        const rangeParams = buildRpcRangeParams(rangeWindow, site);
        const communityRangeParams = buildRpcRangeParams(rangeWindow, site);
        const redemptionRangeParams = buildRpcRangeParams(rangeWindow, site);
        const topContentRangeParams = buildRpcRangeParams(rangeWindow, site, {
            p_limit: normalizePositiveInteger(params.get('topContentLimit'), DEFAULT_TOP_CONTENT_LIMIT, 1, 500)
        });
        const leaderboardLimit = normalizePositiveInteger(
            params.get('pointsLeaderboardLimit'),
            DEFAULT_POINTS_LEADERBOARD_LIMIT,
            1,
            500
        );

        const [
            channelBreakdown,
            topContent,
            communityStats,
            pointsDistribution,
            pointsLeaderboard,
            redemptionFunnel
        ] = await Promise.all([
            loadChannelBreakdownSegment(supabase, rangeParams),
            loadTopContentSegment(supabase, topContentRangeParams),
            loadSimpleRpcSegment(
                supabase,
                'get_community_stats',
                [
                    communityRangeParams,
                    buildLegacyRpcParams(communityRangeParams),
                    buildLegacyRpcParams(communityRangeParams, { excludeSite: true }),
                    {}
                ],
                'Failed to load community stats'
            ),
            loadSimpleRpcSegment(
                supabase,
                'get_points_distribution',
                [{ p_site: rpcSite }],
                'Failed to load points distribution'
            ),
            loadSimpleRpcSegment(
                supabase,
                'get_points_leaderboard',
                [{ p_limit: leaderboardLimit, p_site: rpcSite }],
                'Failed to load points leaderboard'
            ),
            loadSimpleRpcSegment(
                supabase,
                'get_redemption_funnel',
                [
                    redemptionRangeParams,
                    buildLegacyRpcParams(redemptionRangeParams),
                    buildLegacyRpcParams(redemptionRangeParams, { excludeDays: true }),
                    {}
                ],
                'Failed to load redemption funnel'
            )
        ]);

        const segments = {
            channelBreakdown,
            topContent,
            communityStats,
            pointsDistribution,
            pointsLeaderboard,
            redemptionFunnel
        };

        return sendJson(res, 200, {
            success: true,
            site,
            generated_at: new Date().toISOString(),
            range: rangeWindow,
            limits: {
                topContent: topContentRangeParams.p_limit || DEFAULT_TOP_CONTENT_LIMIT,
                pointsLeaderboard: leaderboardLimit
            },
            partial_failure_count: Object.values(segments).filter((segment) => !segment.ok).length,
            segments
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to load analytics panel support bundle'
        });
    }
};

module.exports.__testUtils = {
    DEFAULT_TOP_CONTENT_LIMIT,
    DEFAULT_POINTS_LEADERBOARD_LIMIT,
    normalizePositiveInteger,
    normalizeRpcSite,
    toRpcDateValue,
    buildRpcRangeParams,
    buildLegacyRpcParams,
    callRpcWithFallback,
    getRpcAttemptSignature,
    orderRpcAttempts,
    hasChannelBreakdownV2Signal,
    hasTopContentV2Signal
};
