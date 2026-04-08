/**
 * Admin Analytics Derived Bundle Helpers
 * Derived cache, summary-window accessors, and admin bundle wrappers for Admin Studio.
 */

const analyticsDerivedState = {
    contextKey: '',
    overviewBusinessMix: null,
    verifyServiceSummary: null,
    growthSummary: null,
    operationsHealthSnapshot: null,
    summaryWindowData: null,
    summaryWindowBundle: null,
    siteComparisonData: null,
    panelMetricContext: null,
    summaryContextBundle: null,
    adminSnapshotBundle: null,
    panelSupportBundle: null,
    trendSeriesBundle: null,
    visualPanelBundle: null,
    summaryPayloadBundle: null,
    summaryRowsBundle: null,
    productSummaryBundle: null,
    productRankBundle: null,
    productHealthBundle: null,
    productFunnelBundle: null,
    productDetailBundle: null,
    productDetailBundleKey: '',
    commentsSummaryData: null,
    verifyMonitorSnapshot: null
};

const analyticsDerivedRequests = {
    contextKey: '',
    requests: Object.create(null)
};

function ensureAnalyticsDerivedContext(contextKey = getAnalyticsAIContextKey()) {
    if (analyticsDerivedState.contextKey !== contextKey) {
        resetAnalyticsDerivedContext(contextKey);
    }

    return analyticsDerivedState;
}

function ensureAnalyticsDerivedRequestContext(contextKey = getAnalyticsAIContextKey()) {
    if (analyticsDerivedRequests.contextKey !== contextKey) {
        analyticsDerivedRequests.contextKey = contextKey;
        analyticsDerivedRequests.requests = Object.create(null);
    }

    return analyticsDerivedRequests.requests;
}

function getAnalyticsDerivedRequestPromise(key, contextKey = getAnalyticsAIContextKey()) {
    const requests = ensureAnalyticsDerivedRequestContext(contextKey);
    return requests[key] || null;
}

function setAnalyticsDerivedRequestPromise(key, promise, contextKey = getAnalyticsAIContextKey()) {
    const requests = ensureAnalyticsDerivedRequestContext(contextKey);
    requests[key] = promise;
    return promise;
}

function clearAnalyticsDerivedRequestPromise(key, contextKey = getAnalyticsAIContextKey()) {
    const requests = ensureAnalyticsDerivedRequestContext(contextKey);
    delete requests[key];
}

function resetAnalyticsDerivedContext(contextKey = getAnalyticsAIContextKey()) {
    analyticsDerivedState.contextKey = contextKey;
    analyticsDerivedState.overviewBusinessMix = null;
    analyticsDerivedState.verifyServiceSummary = null;
    analyticsDerivedState.growthSummary = null;
    analyticsDerivedState.operationsHealthSnapshot = null;
    analyticsDerivedState.summaryWindowData = null;
    analyticsDerivedState.summaryWindowBundle = null;
    analyticsDerivedState.siteComparisonData = null;
    analyticsDerivedState.panelMetricContext = null;
    analyticsDerivedState.summaryContextBundle = null;
    analyticsDerivedState.adminSnapshotBundle = null;
    analyticsDerivedState.panelSupportBundle = null;
    analyticsDerivedState.trendSeriesBundle = null;
    analyticsDerivedState.visualPanelBundle = null;
    analyticsDerivedState.summaryPayloadBundle = null;
    analyticsDerivedState.summaryRowsBundle = null;
    analyticsDerivedState.productSummaryBundle = null;
    analyticsDerivedState.productRankBundle = null;
    analyticsDerivedState.productHealthBundle = null;
    analyticsDerivedState.productFunnelBundle = null;
    analyticsDerivedState.productDetailBundle = null;
    analyticsDerivedState.productDetailBundleKey = '';
    analyticsDerivedState.commentsSummaryData = null;
    analyticsDerivedState.verifyMonitorSnapshot = null;

    analyticsDerivedRequests.contextKey = contextKey;
    analyticsDerivedRequests.requests = Object.create(null);

    return analyticsDerivedState;
}

function runAnalyticsDerivedRequest(key, fetcher, options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    const forceRefresh = Boolean(options.forceRefresh);
    if (!forceRefresh) {
        const cached = getAnalyticsDerivedStateValue(key, contextKey);
        if (cached) return Promise.resolve(cached);

        const pending = getAnalyticsDerivedRequestPromise(key, contextKey);
        if (pending) return pending;
    }

    const request = Promise.resolve()
        .then(fetcher)
        .then((value) => setAnalyticsDerivedStateValue(key, value, contextKey))
        .finally(() => {
            if (!forceRefresh) {
                clearAnalyticsDerivedRequestPromise(key, contextKey);
            }
        });

    if (!forceRefresh) {
        setAnalyticsDerivedRequestPromise(key, request, contextKey);
    }

    return request;
}

function setAnalyticsDerivedStateValue(key, value, contextKey = getAnalyticsAIContextKey()) {
    const state = ensureAnalyticsDerivedContext(contextKey);
    state[key] = value;
    return value;
}

function getAnalyticsDerivedStateValue(key, contextKey = getAnalyticsAIContextKey()) {
    if (analyticsDerivedState.contextKey !== contextKey) {
        return null;
    }

    return analyticsDerivedState[key];
}

function getAnalyticsAISourceData(data = null) {
    if (data) {
        return data;
    }

    const summaryWindowData = getAnalyticsDerivedStateValue('summaryWindowData');
    return {
        overviewBusinessMix: getAnalyticsDerivedStateValue('overviewBusinessMix'),
        verifyServiceSummary: getAnalyticsDerivedStateValue('verifyServiceSummary'),
        growthSummary: getAnalyticsDerivedStateValue('growthSummary'),
        operationsHealthSnapshot: getAnalyticsDerivedStateValue('operationsHealthSnapshot'),
        summaryWindowData,
        overview: summaryWindowData?.overview && typeof summaryWindowData.overview === 'object'
            ? summaryWindowData.overview
            : null,
        siteComparisonData: getAnalyticsDerivedStateValue('siteComparisonData'),
        panelMetricContext: getAnalyticsDerivedStateValue('panelMetricContext'),
        summaryContextBundle: getAnalyticsDerivedStateValue('summaryContextBundle'),
        productSummaryBundle: getAnalyticsDerivedStateValue('productSummaryBundle'),
        productRankBundle: getAnalyticsDerivedStateValue('productRankBundle'),
        productHealthBundle: getAnalyticsDerivedStateValue('productHealthBundle')
    };
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

function hasAnalyticsSummaryWindowPayloadSignal(summary = {}) {
    const overview = summary?.overview && typeof summary.overview === 'object'
        ? summary.overview
        : {};
    const eventOverview = summary?.event_overview && typeof summary.event_overview === 'object'
        ? summary.event_overview
        : {};
    const eventFunnels = summary?.event_funnels && typeof summary.event_funnels === 'object'
        ? summary.event_funnels
        : {};

    return (
        Object.keys(overview).length > 0
        || (Array.isArray(summary?.user_trend) && summary.user_trend.length > 0)
        || (Array.isArray(summary?.channel_breakdown) && summary.channel_breakdown.length > 0)
        || (Array.isArray(summary?.top_content) && summary.top_content.length > 0)
        || Object.keys(eventOverview).length > 0
        || Object.keys(eventFunnels).length > 0
    );
}

function createAnalyticsSummaryWindowDirectFallbackError(errors = [], fallbackMessage = 'Failed to load analytics summary window directly') {
    const normalizedErrors = (Array.isArray(errors) ? errors : [errors]).filter(Boolean);
    const error = new Error(
        normalizedErrors[0]?.message || fallbackMessage
    );
    error.statusCode = normalizedErrors.reduce(
        (statusCode, entry) => statusCode || Number(entry?.statusCode || 0),
        0
    ) || 500;
    error.causes = normalizedErrors;
    return error;
}

function buildAnalyticsSummaryWindowBundleQuery(options = {}) {
    const query = buildAnalyticsSummaryRowsBundleQuery(options);
    const site = String(
        options.site
        || window.AdminSiteFilter?.getSiteFilter?.()
        || 'all'
    ).trim().toLowerCase() || 'all';
    const includeComparisonSites = Object.prototype.hasOwnProperty.call(options, 'includeComparisonSites')
        ? options.includeComparisonSites === true
        : site === 'all';

    query.set('site', site);
    query.set('includeComparisonSites', includeComparisonSites ? '1' : '0');
    query.set('topContentLimit', '5');
    return query;
}

async function getAnalyticsSummaryWindowBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'summaryWindowBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/summary-window-bundle',
                buildAnalyticsSummaryWindowBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getAnalyticsSummaryWindowBundleSegment(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const summaries = bundle?.summaries && typeof bundle.summaries === 'object'
        ? bundle.summaries
        : {};
    const segment = normalizedKey ? summaries[normalizedKey] : null;
    return segment && typeof segment === 'object'
        ? segment
        : null;
}

function normalizeAnalyticsSummaryWindowSiteKey(site = null) {
    const normalized = String(site || 'all').trim().toLowerCase();
    return normalized || 'all';
}

function getAnalyticsSummaryWindowBundleSegmentSummary(bundle = null, key = '') {
    const segment = getAnalyticsSummaryWindowBundleSegment(bundle, key);
    return segment?.ok && segment.summary
        ? segment.summary
        : null;
}

function createAnalyticsSummaryWindowBundleSegmentError(segment = null, fallbackMessage = 'Analytics summary window bundle segment failed') {
    const error = new Error(
        String(segment?.message || fallbackMessage || 'Analytics summary window bundle segment failed')
    );
    error.statusCode = Number(segment?.statusCode || 500);
    error.payload = segment?.summary && typeof segment.summary === 'object'
        ? segment.summary
        : {};
    error.bundleSegment = segment || null;
    return error;
}

function hasAnalyticsChannelBreakdownSignal(rows = []) {
    return Array.isArray(rows) && rows.some((row) => (
        Number(row?.event_count || 0)
        + Number(row?.user_count || 0)
        + Number(row?.unlock_success_count || 0)
        + Number(row?.verify_submit_count || 0)
        + Number(row?.recharge_success_count || 0)
        + Number(row?.shop_purchase_count || 0)
    ) > 0);
}

function hasAnalyticsTopContentSignal(rows = []) {
    return Array.isArray(rows) && rows.some((row) => (
        Number(row?.view_count || 0)
        + Number(row?.unlock_count || 0)
        + Number(row?.comment_count || 0)
    ) > 0);
}

async function loadAnalyticsOverviewWithTrendDirect(site = 'all') {
    const rpcSite = site === 'all' ? null : site;

    try {
        return await callAnalyticsRpcWithFallback('get_overview_stats_with_trend', [
            { p_site: rpcSite },
            {}
        ]);
    } catch (_error) {
        return callAnalyticsRpcWithFallback('get_overview_stats', [
            { p_site: rpcSite },
            {}
        ]);
    }
}

async function loadAnalyticsSummaryWindowChannelBreakdownDirect(site = 'all', days = getAnalyticsRangeDays()) {
    const rangeParams = buildAnalyticsRangeRpcParams({}, { site: site === 'all' ? null : site, days });
    const legacyRangeParams = buildAnalyticsLegacyRpcParams(rangeParams);

    try {
        const v2Data = await callAnalyticsRpcWithFallback('get_channel_breakdown_v2', [
            rangeParams,
            legacyRangeParams,
            buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        if (hasAnalyticsChannelBreakdownSignal(v2Data)) {
            return v2Data;
        }
    } catch (_error) {
        // fall through to legacy
    }

    return callAnalyticsRpcWithFallback('get_channel_breakdown', [
        rangeParams,
        legacyRangeParams,
        buildAnalyticsLegacyRpcParams(rangeParams, { excludeDays: true }),
        {}
    ]);
}

async function loadAnalyticsSummaryWindowTopContentDirect(site = 'all', days = getAnalyticsRangeDays(), limit = 5) {
    const safeLimit = Math.max(1, Number(limit) || 5);
    const rangeParams = buildAnalyticsRangeRpcParams({ p_limit: safeLimit }, {
        site: site === 'all' ? null : site,
        days
    });
    const legacyRangeParams = buildAnalyticsLegacyRpcParams(rangeParams);

    try {
        const v2Data = await callAnalyticsRpcWithFallback('get_content_top_v2', [
            rangeParams,
            legacyRangeParams,
            buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
            { p_limit: safeLimit }
        ]);
        if (hasAnalyticsTopContentSignal(v2Data)) {
            return Array.isArray(v2Data) ? v2Data.slice(0, safeLimit) : [];
        }
    } catch (_error) {
        // fall through to legacy
    }

    const legacyData = await callAnalyticsRpcWithFallback('get_content_top', [
        rangeParams,
        legacyRangeParams,
        buildAnalyticsLegacyRpcParams(rangeParams, { excludeDays: true }),
        { p_limit: safeLimit }
    ]);
    return Array.isArray(legacyData) ? legacyData.slice(0, safeLimit) : [];
}

async function loadAnalyticsSummaryWindowSiteDirect(site = 'all', options = {}) {
    const normalizedSite = normalizeAnalyticsSummaryWindowSiteKey(site);
    const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
        ? Number(options.days)
        : getAnalyticsRangeDays();
    const rpcSite = normalizedSite === 'all' ? null : normalizedSite;
    const rangeParams = buildAnalyticsRangeRpcParams({}, { site: rpcSite, days });
    const legacyRangeParams = buildAnalyticsLegacyRpcParams(rangeParams);

    try {
        const summaryV2Data = await callAnalyticsRpcWithFallback('get_ai_summary_data_v2', [
            rangeParams,
            legacyRangeParams,
            buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
            {}
        ]);
        const summaryPayload = summaryV2Data && typeof summaryV2Data === 'object' ? summaryV2Data : {};
        let overview = summaryPayload.overview && typeof summaryPayload.overview === 'object'
            ? summaryPayload.overview
            : {};

        if (
            !Object.prototype.hasOwnProperty.call(overview, 'dau_growth')
            || !Object.prototype.hasOwnProperty.call(overview, 'comments_growth')
        ) {
            try {
                const trendOverview = await loadAnalyticsOverviewWithTrendDirect(normalizedSite);
                if (trendOverview && typeof trendOverview === 'object') {
                    overview = { ...trendOverview, ...overview };
                }
            } catch (_error) {
                // keep current overview
            }
        }

        return buildAnalyticsSummaryWindowPayload(summaryPayload, overview);
    } catch (summaryError) {
        const topContentLimit = Number(options.topContentLimit) > 0 ? Number(options.topContentLimit) : 5;
        const [overviewResult, userTrendResult, channelBreakdownResult, topContentResult] = await Promise.allSettled([
            loadAnalyticsOverviewWithTrendDirect(normalizedSite),
            callAnalyticsRpcWithFallback('get_user_trend', [
                rangeParams,
                legacyRangeParams,
                buildAnalyticsLegacyRpcParams(rangeParams, { excludeSite: true }),
                {}
            ]),
            loadAnalyticsSummaryWindowChannelBreakdownDirect(normalizedSite, days),
            loadAnalyticsSummaryWindowTopContentDirect(normalizedSite, days, topContentLimit)
        ]);

        const fallbackSummary = buildAnalyticsSummaryWindowPayload({
            user_trend: userTrendResult.status === 'fulfilled' ? userTrendResult.value : [],
            channel_breakdown: channelBreakdownResult.status === 'fulfilled' ? channelBreakdownResult.value : [],
            top_content: topContentResult.status === 'fulfilled' ? topContentResult.value : [],
            generated_at: new Date().toISOString()
        }, overviewResult.status === 'fulfilled' && overviewResult.value && typeof overviewResult.value === 'object'
            ? overviewResult.value
            : {});

        if (hasAnalyticsSummaryWindowPayloadSignal(fallbackSummary)) {
            return fallbackSummary;
        }

        throw createAnalyticsSummaryWindowDirectFallbackError([
            summaryError,
            overviewResult.status === 'rejected' ? overviewResult.reason : null,
            userTrendResult.status === 'rejected' ? userTrendResult.reason : null,
            channelBreakdownResult.status === 'rejected' ? channelBreakdownResult.reason : null,
            topContentResult.status === 'rejected' ? topContentResult.reason : null
        ], 'Failed to load analytics summary window directly');
    }
}

async function buildAnalyticsSummaryWindowDirectBundle(options = {}) {
    const selectedSiteKey = normalizeAnalyticsSummaryWindowSiteKey(options.site || getAnalyticsSiteParam());
    const includeComparisonSites = Object.prototype.hasOwnProperty.call(options, 'includeComparisonSites')
        ? options.includeComparisonSites === true
        : selectedSiteKey === 'all';
    const siteKeys = Array.from(new Set([
        selectedSiteKey,
        ...(includeComparisonSites && selectedSiteKey === 'all' ? ['cn', 'intl'] : [])
    ]));
    const summaries = {};

    await Promise.all(siteKeys.map(async (siteKey) => {
        try {
            const summary = await loadAnalyticsSummaryWindowSiteDirect(siteKey, options);
            summaries[siteKey] = {
                ok: true,
                statusCode: 200,
                message: '',
                site: siteKey,
                rpc_name: 'client_direct_summary_window',
                used_legacy_fallback: true,
                fallback_reason: 'admin_bundle_unavailable',
                summary
            };
        } catch (error) {
            summaries[siteKey] = {
                ok: false,
                statusCode: Number(error?.statusCode) || 500,
                message: error?.message || 'Failed to load analytics summary window directly',
                site: siteKey,
                rpc_name: '',
                used_legacy_fallback: true,
                fallback_reason: 'client_direct_summary_window_failed',
                summary: null
            };
        }
    }));

    return {
        success: true,
        active_site: selectedSiteKey,
        generated_at: new Date().toISOString(),
        include_comparison_sites: includeComparisonSites,
        partial_failure_count: Object.values(summaries).filter((segment) => !segment.ok).length,
        summaries
    };
}

async function loadAnalyticsSummaryWindowBundleForSelection(options = {}) {
    const selectedSiteKey = normalizeAnalyticsSummaryWindowSiteKey(options.site || getAnalyticsSiteParam());
    const includeComparisonSites = Object.prototype.hasOwnProperty.call(options, 'includeComparisonSites')
        ? options.includeComparisonSites === true
        : selectedSiteKey === 'all';

    try {
        return await getAnalyticsSummaryWindowBundle({
            contextKey: options.contextKey,
            forceRefresh: options.forceRefresh,
            site: selectedSiteKey,
            includeComparisonSites
        });
    } catch (error) {
        console.warn('[Analytics] Summary window admin bundle unavailable, falling back to direct RPC summary:', error);
        return buildAnalyticsSummaryWindowDirectBundle({
            ...options,
            site: selectedSiteKey,
            includeComparisonSites
        });
    }
}

async function resolveAnalyticsSummaryWindowSiteSummary(site = null, options = {}) {
    const siteKey = normalizeAnalyticsSummaryWindowSiteKey(site);
    const bundle = options.bundle || null;
    const bundleSummary = getAnalyticsSummaryWindowBundleSegmentSummary(bundle, siteKey);
    if (bundleSummary) {
        return bundleSummary;
    }

    const bundleSegment = getAnalyticsSummaryWindowBundleSegment(bundle, siteKey);
    const bundleError = createAnalyticsSummaryWindowBundleSegmentError(bundleSegment, 'Summary window bundle unavailable');
    if (typeof options.directLoader === 'function') {
        try {
            return await options.directLoader(siteKey);
        } catch (directError) {
            console.warn('[Analytics] Summary window segment fallback to direct RPC failed:', directError);
            directError.cause = directError.cause || bundleError;
            throw directError;
        }
    }

    throw bundleError;
}

async function getAnalyticsSummaryWindowData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'summaryWindowData',
        async () => {
            const selectedSiteKey = normalizeAnalyticsSummaryWindowSiteKey(getAnalyticsSiteParam());
            const bundle = await loadAnalyticsSummaryWindowBundleForSelection({
                contextKey,
                forceRefresh: options.forceRefresh,
                site: selectedSiteKey
            });
            return resolveAnalyticsSummaryWindowSiteSummary(selectedSiteKey, {
                bundle,
                days: getAnalyticsRangeDays(),
                directLoader: (fallbackSiteKey) => loadAnalyticsSummaryWindowSiteDirect(fallbackSiteKey, {
                    topContentLimit: 5
                })
            });
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getAnalyticsSiteComparisonData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    if (!options.forceRefresh) {
        const cached = getAnalyticsDerivedStateValue('siteComparisonData', contextKey);
        if (cached) return cached;
    }

    const selectedSite = getAnalyticsSiteParam();
    const selectedSiteKey = normalizeAnalyticsSummaryWindowSiteKey(selectedSite);
    const summaryWindowBundle = await loadAnalyticsSummaryWindowBundleForSelection({
        contextKey,
        forceRefresh: options.forceRefresh,
        site: selectedSiteKey,
        includeComparisonSites: !selectedSite
    });

    if (selectedSite) {
        const currentSummary = options.summaryWindowData || await resolveAnalyticsSummaryWindowSiteSummary(selectedSiteKey, {
            bundle: summaryWindowBundle,
            days: getAnalyticsRangeDays(),
            directLoader: (fallbackSiteKey) => loadAnalyticsSummaryWindowSiteDirect(fallbackSiteKey, {
                topContentLimit: 5
            })
        });
        const singlePayload = {
            mode: 'single',
            activeSite: selectedSite,
            snapshots: [buildAnalyticsSiteSnapshot(selectedSite, currentSummary)],
            focusSite: selectedSite,
            insights: [],
            generated_at: currentSummary?.generated_at || new Date().toISOString()
        };
        return setAnalyticsDerivedStateValue('siteComparisonData', singlePayload, contextKey);
    }

    const [cnResult, intlResult] = await Promise.allSettled([
        resolveAnalyticsSummaryWindowSiteSummary('cn', {
            bundle: summaryWindowBundle,
            days: getAnalyticsRangeDays(),
            directLoader: (fallbackSiteKey) => loadAnalyticsSummaryWindowSiteDirect(fallbackSiteKey, {
                topContentLimit: 5
            })
        }),
        resolveAnalyticsSummaryWindowSiteSummary('intl', {
            bundle: summaryWindowBundle,
            days: getAnalyticsRangeDays(),
            directLoader: (fallbackSiteKey) => loadAnalyticsSummaryWindowSiteDirect(fallbackSiteKey, {
                topContentLimit: 5
            })
        })
    ]);
    const snapshots = [];
    if (cnResult.status === 'fulfilled') {
        snapshots.push(buildAnalyticsSiteSnapshot('cn', cnResult.value));
    }
    if (intlResult.status === 'fulfilled') {
        snapshots.push(buildAnalyticsSiteSnapshot('intl', intlResult.value));
    }

    const comparisonPayload = buildAnalyticsSiteComparisonPayload(snapshots);
    return setAnalyticsDerivedStateValue('siteComparisonData', {
        ...comparisonPayload,
        generated_at: new Date().toISOString()
    }, contextKey);
}

function getAnalyticsSummaryWindowEventOverview(summaryWindow = {}) {
    return summaryWindow?.event_overview && typeof summaryWindow.event_overview === 'object'
        ? summaryWindow.event_overview
        : {};
}

function getAnalyticsSummaryWindowEventFunnels(summaryWindow = {}) {
    return summaryWindow?.event_funnels && typeof summaryWindow.event_funnels === 'object'
        ? summaryWindow.event_funnels
        : {};
}

function hasAnalyticsEventActivity(summaryWindow = {}, keys = []) {
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    return (Array.isArray(keys) ? keys : []).some((key) => normalizeAnalyticsNumber(eventOverview?.[key]) > 0);
}

function buildAnalyticsAdminSnapshotBundleQuery(options = {}) {
    const range = getAnalyticsRangeState();
    const query = new URLSearchParams();
    const site = String(
        options.site
        || window.AdminSiteFilter?.getSiteFilter?.()
        || 'all'
    ).trim().toLowerCase();
    const view = String(options.view || 'ops').trim().toLowerCase();
    const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
        ? Number(options.days)
        : (range.days || DEFAULT_ANALYTICS_DAYS);
    const startDate = Object.prototype.hasOwnProperty.call(options, 'startDate')
        ? options.startDate
        : range.startDate;
    const endDate = Object.prototype.hasOwnProperty.call(options, 'endDate')
        ? options.endDate
        : range.endDate;
    const taskPage = Number.isFinite(Number(options.taskPage)) && Number(options.taskPage) > 0
        ? Number(options.taskPage)
        : 1;
    const taskPageSize = Number.isFinite(Number(options.taskPageSize)) && Number(options.taskPageSize) > 0
        ? Number(options.taskPageSize)
        : 5;
    const failurePage = Number.isFinite(Number(options.failurePage)) && Number(options.failurePage) > 0
        ? Number(options.failurePage)
        : 1;
    const failurePageSize = Number.isFinite(Number(options.failurePageSize)) && Number(options.failurePageSize) > 0
        ? Number(options.failurePageSize)
        : 5;

    query.set('site', site || 'all');
    query.set('view', view || 'ops');
    query.set('taskPage', String(taskPage));
    query.set('taskPageSize', String(taskPageSize));
    query.set('failurePage', String(failurePage));
    query.set('failurePageSize', String(failurePageSize));

    const startIso = toAnalyticsRangeBoundaryIso(startDate, false);
    const endIso = toAnalyticsRangeBoundaryIso(endDate, true);
    if (startIso && endIso) {
        query.set('startDate', startIso);
        query.set('endDate', endIso);
    } else {
        query.set('days', String(days));
    }

    return query;
}

function getAnalyticsSnapshotBundleSegment(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    if (!bundle || typeof bundle !== 'object' || !normalizedKey) {
        return null;
    }

    const segment = bundle[normalizedKey];
    return segment && typeof segment === 'object'
        ? segment
        : null;
}

function createAnalyticsSnapshotBundleSegmentError(segment = null, fallbackMessage = 'Analytics snapshot bundle segment failed') {
    const error = new Error(
        String(segment?.message || fallbackMessage || 'Analytics snapshot bundle segment failed')
    );
    error.statusCode = Number(segment?.statusCode || 500);
    error.payload = segment?.payload && typeof segment.payload === 'object'
        ? segment.payload
        : {};
    error.bundleSegment = segment || null;
    return error;
}

async function getAnalyticsAdminSnapshotBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'adminSnapshotBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/snapshot-bundle',
                buildAnalyticsAdminSnapshotBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function buildAnalyticsSummaryRowsBundleQuery(options = {}) {
    const range = getAnalyticsRangeState();
    const query = new URLSearchParams();
    const site = String(
        options.site
        || window.AdminSiteFilter?.getSiteFilter?.()
        || 'all'
    ).trim().toLowerCase();
    const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
        ? Number(options.days)
        : (range.days || DEFAULT_ANALYTICS_DAYS);
    const startDate = Object.prototype.hasOwnProperty.call(options, 'startDate')
        ? options.startDate
        : range.startDate;
    const endDate = Object.prototype.hasOwnProperty.call(options, 'endDate')
        ? options.endDate
        : range.endDate;
    const startIso = toAnalyticsRangeBoundaryIso(startDate, false);
    const endIso = toAnalyticsRangeBoundaryIso(endDate, true);

    query.set('site', site || 'all');
    if (startIso && endIso) {
        query.set('startDate', startIso);
        query.set('endDate', endIso);
    } else {
        query.set('days', String(days));
    }

    return query;
}

async function getAnalyticsSummaryPayloadBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'summaryPayloadBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/summary-payload-bundle',
                buildAnalyticsSummaryRowsBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getAnalyticsSummaryPayloadBundleSegment(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const summaries = bundle?.summaries && typeof bundle.summaries === 'object'
        ? bundle.summaries
        : {};
    const segment = normalizedKey ? summaries[normalizedKey] : null;
    return segment && typeof segment === 'object'
        ? segment
        : null;
}

async function getAnalyticsSummaryRowsBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'summaryRowsBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/summary-rows-bundle',
                buildAnalyticsSummaryRowsBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getAnalyticsSummaryRowsBundleTable(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const tables = bundle?.tables && typeof bundle.tables === 'object'
        ? bundle.tables
        : {};
    const segment = normalizedKey ? tables[normalizedKey] : null;
    return segment && segment.ok && Array.isArray(segment.rows)
        ? segment.rows
        : null;
}

function buildAnalyticsPanelSupportBundleQuery(options = {}) {
    const query = buildAnalyticsSummaryRowsBundleQuery(options);
    query.set('topContentLimit', String(ANALYTICS_PANEL_SUPPORT_TOP_CONTENT_LIMIT));
    query.set('pointsLeaderboardLimit', String(ANALYTICS_PANEL_SUPPORT_POINTS_LEADERBOARD_LIMIT));
    return query;
}

async function getAnalyticsPanelSupportBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'panelSupportBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/panel-support-bundle',
                buildAnalyticsPanelSupportBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getAnalyticsPanelSupportBundleSegment(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const segments = bundle?.segments && typeof bundle.segments === 'object'
        ? bundle.segments
        : {};
    const segment = normalizedKey ? segments[normalizedKey] : null;
    return segment && typeof segment === 'object'
        ? segment
        : null;
}

function createAnalyticsPanelSupportBundleSegmentError(segment = null, fallbackMessage = 'Analytics panel support bundle segment failed') {
    const error = new Error(
        String(segment?.message || fallbackMessage || 'Analytics panel support bundle segment failed')
    );
    error.statusCode = Number(segment?.statusCode || 500);
    error.payload = segment?.payload;
    error.bundleSegment = segment || null;
    return error;
}

function buildAnalyticsVisualPanelBundleQuery(options = {}) {
    const range = getAnalyticsRangeState();
    const query = new URLSearchParams();
    const site = String(
        options.site
        || window.AdminSiteFilter?.getSiteFilter?.()
        || 'all'
    ).trim().toLowerCase();
    const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
        ? Number(options.days)
        : (range.days || DEFAULT_ANALYTICS_DAYS);
    const weeks = Number.isFinite(Number(options.weeks)) && Number(options.weeks) > 0
        ? Number(options.weeks)
        : getAnalyticsCohortWeeks(days);
    const startDate = Object.prototype.hasOwnProperty.call(options, 'startDate')
        ? options.startDate
        : range.startDate;
    const endDate = Object.prototype.hasOwnProperty.call(options, 'endDate')
        ? options.endDate
        : range.endDate;
    const startIso = toAnalyticsRangeBoundaryIso(startDate, false);
    const endIso = toAnalyticsRangeBoundaryIso(endDate, true);

    query.set('site', site || 'all');
    query.set('weeks', String(weeks));
    query.set('topContributorsLimit', '10');
    if (startIso && endIso) {
        query.set('startDate', startIso);
        query.set('endDate', endIso);
    } else {
        query.set('days', String(days));
    }

    return query;
}

async function getAnalyticsVisualPanelBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'visualPanelBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/visual-panel-bundle',
                buildAnalyticsVisualPanelBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getAnalyticsVisualPanelBundleSegment(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const segments = bundle?.segments && typeof bundle.segments === 'object'
        ? bundle.segments
        : {};
    const segment = normalizedKey ? segments[normalizedKey] : null;
    return segment && typeof segment === 'object'
        ? segment
        : null;
}

function createAnalyticsVisualPanelBundleSegmentError(segment = null, fallbackMessage = 'Analytics visual panel bundle segment failed') {
    const error = new Error(
        String(segment?.message || fallbackMessage || 'Analytics visual panel bundle segment failed')
    );
    error.statusCode = Number(segment?.statusCode || 500);
    error.payload = segment?.payload;
    error.bundleSegment = segment || null;
    return error;
}

function buildAnalyticsTrendSeriesBundleQuery(options = {}) {
    return buildAnalyticsSummaryRowsBundleQuery(options);
}

async function getAnalyticsTrendSeriesBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'trendSeriesBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/trend-series-bundle',
                buildAnalyticsTrendSeriesBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getAnalyticsTrendSeriesBundleSegment(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const segments = bundle?.segments && typeof bundle.segments === 'object'
        ? bundle.segments
        : {};
    const segment = normalizedKey ? segments[normalizedKey] : null;
    return segment && typeof segment === 'object'
        ? segment
        : null;
}

function createAnalyticsTrendSeriesBundleSegmentError(segment = null, fallbackMessage = 'Analytics trend series bundle segment failed') {
    const error = new Error(
        String(segment?.message || fallbackMessage || 'Analytics trend series bundle segment failed')
    );
    error.statusCode = Number(segment?.statusCode || 500);
    error.payload = segment?.payload;
    error.bundleSegment = segment || null;
    return error;
}

function buildAnalyticsProductBundleQuery(options = {}) {
    const query = buildAnalyticsSummaryRowsBundleQuery(options);
    if (Number.isFinite(Number(options.limit)) && Number(options.limit) > 0) {
        query.set('limit', String(Number(options.limit)));
    }
    return query;
}

async function getAnalyticsProductSummaryBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'productSummaryBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/product-summary-bundle',
                buildAnalyticsProductBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getAnalyticsProductRankBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'productRankBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/product-rank-bundle',
                buildAnalyticsProductBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getAnalyticsProductHealthBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'productHealthBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/product-health-bundle',
                buildAnalyticsProductBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getAnalyticsProductFunnelBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'productFunnelBundle',
        async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl(
                'analytics/product-funnel-bundle',
                buildAnalyticsProductBundleQuery(options)
            );
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getAnalyticsProductDetailBundle(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    const productId = String(options.productId || '').trim();
    if (!productId) {
        throw new Error('Missing productId for product detail bundle');
    }

    const query = buildAnalyticsProductBundleQuery(options);
    query.set('productId', productId);
    if (Number.isFinite(Number(options.recentOrderLimit)) && Number(options.recentOrderLimit) > 0) {
        query.set('recentOrderLimit', String(Number(options.recentOrderLimit)));
    }

    const cacheKey = query.toString();
    const derivedState = ensureAnalyticsDerivedContext(contextKey);
    if (
        !options.forceRefresh
        && derivedState.productDetailBundle
        && derivedState.productDetailBundleKey === cacheKey
    ) {
        return derivedState.productDetailBundle;
    }

    const requestKey = `productDetailBundle:${cacheKey}`;
    if (!options.forceRefresh) {
        const pending = getAnalyticsDerivedRequestPromise(requestKey, contextKey);
        if (pending) {
            return pending;
        }
    }

    const request = Promise.resolve()
        .then(async () => {
            const requestUrl = buildAnalyticsAdminRouteUrl('analytics/product-detail-bundle', query);
            const payload = await fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
            const state = ensureAnalyticsDerivedContext(contextKey);
            state.productDetailBundle = payload;
            state.productDetailBundleKey = cacheKey;
            return payload;
        })
        .finally(() => {
            clearAnalyticsDerivedRequestPromise(requestKey, contextKey);
        });

    if (!options.forceRefresh) {
        setAnalyticsDerivedRequestPromise(requestKey, request, contextKey);
    }

    return request;
}

function getAnalyticsProductBundleSegment(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const segments = bundle?.segments && typeof bundle.segments === 'object'
        ? bundle.segments
        : {};
    const segment = normalizedKey ? segments[normalizedKey] : null;
    return segment && typeof segment === 'object'
        ? segment
        : null;
}

async function getAnalyticsCommentsSummaryData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'commentsSummaryData',
        async () => {
            const bundle = await getAnalyticsAdminSnapshotBundle({
                contextKey,
                forceRefresh: options.forceRefresh
            }).catch(() => null);
            const bundleSegment = getAnalyticsSnapshotBundleSegment(bundle, 'comments');
            if (bundleSegment?.ok && bundleSegment.payload) {
                return bundleSegment.payload;
            }
            if (bundleSegment && bundleSegment.ok === false) {
                throw createAnalyticsSnapshotBundleSegmentError(bundleSegment, 'Comments summary unavailable');
            }

            const site = window.AdminSiteFilter?.getSiteFilter?.() || 'all';
            const requestUrl = buildAnalyticsAdminRouteUrl('comments/summary', { site });
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getAnalyticsVerifyMonitorSnapshotData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'verifyMonitorSnapshot',
        async () => {
            const bundle = await getAnalyticsAdminSnapshotBundle({
                contextKey,
                forceRefresh: options.forceRefresh,
                taskPage: 1,
                taskPageSize: 5,
                failurePage: 1,
                failurePageSize: 5
            }).catch(() => null);
            const bundleSegment = getAnalyticsSnapshotBundleSegment(bundle, 'verifyMonitor');
            if (bundleSegment?.ok && bundleSegment.payload) {
                return bundleSegment.payload;
            }
            if (bundleSegment && bundleSegment.ok === false) {
                throw createAnalyticsSnapshotBundleSegmentError(bundleSegment, 'Verify monitor snapshot unavailable');
            }

            const requestUrl = buildAnalyticsAdminRouteUrl('settings/verify-monitor', {
                taskPage: '1',
                taskPageSize: '5',
                failurePage: '1',
                failurePageSize: '5'
            });
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}
