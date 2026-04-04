/**
 * Admin Analytics Module
 * Data visualization dashboard for Admin Studio
 */

// Helper: Get site param for analytics RPC calls
function getAnalyticsSiteParam() {
    if (window.AdminSiteFilter) {
        const site = AdminSiteFilter.getSiteParam();
        return site; // null for 'all', 'cn' or 'intl'
    }
    return null;
}

function getAnalyticsSupabaseClient() {
    return window.supabaseClient || globalThis.supabaseClient;
}

// Chart instances
let userTrendChart = null;
let channelChart = null;
let contentTrendChart = null;
let communityChart = null;
let pointsDistributionChart = null;
let redemptionFunnelChart = null;
let analyticsDestinationFocusTimeoutId = 0;

// AI Insight cache and debounce
let aiInsightCache = null;
let aiInsightCacheTime = 0;
let aiInsightCacheKey = '';
const AI_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let aiInsightDebounce = false;
const DEFAULT_ANALYTICS_DAYS = 7;

const analyticsRuntime = {
    initialized: false,
    moduleActive: false,
    eventsBound: false,
    realtimeBound: false,
    realtimeChannels: [],
    outsideClickBound: false
};

const analyticsDerivedState = {
    contextKey: '',
    overviewBusinessMix: null,
    verifyServiceSummary: null,
    growthSummary: null,
    operationsHealthSnapshot: null,
    summaryWindowData: null,
    siteComparisonData: null,
    commentsSummaryData: null,
    verifyMonitorSnapshot: null
};

const analyticsDerivedRequests = {
    contextKey: '',
    requests: Object.create(null)
};

const ANALYTICS_PANEL_NOTE_DEFINITIONS = {
    overviewDutyBoardMeta: { basis: '规则待处理' },
    channelBreakdownMeta: { basis: '真实事件优先' },
    overviewBusinessMixMeta: { basis: '真实事件优先' },
    topContentMeta: { basis: '浏览/解锁/评论混合口径' },
    commerceEventFunnelMeta: { basis: '真实交易事件' },
    verifyEventFunnelMeta: { basis: '真实验证事件' },
    growthEventFunnelMeta: { basis: '真实增长事件' }
};

function normalizeAnalyticsDate(value) {
    if (!value) return null;

    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;

    date.setHours(0, 0, 0, 0);
    return date;
}

function toAnalyticsIsoDate(value) {
    const date = normalizeAnalyticsDate(value);
    return date ? date.toISOString().split('T')[0] : null;
}

function isAnalyticsModuleVisible() {
    const module = document.getElementById('module-analytics');
    return Boolean(module && !module.hidden && module.classList.contains('active'));
}

function getAnalyticsRangeState() {
    return {
        days: Number(globalDateRange?.days) > 0 ? Number(globalDateRange.days) : DEFAULT_ANALYTICS_DAYS,
        startDate: globalDateRange?.startDate || null,
        endDate: globalDateRange?.endDate || null
    };
}

function getAnalyticsRangeDays(fallback = DEFAULT_ANALYTICS_DAYS) {
    return getAnalyticsRangeState().days || fallback;
}

function getAnalyticsCohortWeeks(days = getAnalyticsRangeDays()) {
    return Math.max(6, Math.min(26, Math.ceil(days / 7) + 1));
}

function formatAnalyticsDateLabelPart(value) {
    const date = normalizeAnalyticsDate(value);
    if (!date) return '--/--';
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function buildAnalyticsRangeLabel(range = getAnalyticsRangeState()) {
    if (range?.startDate && range?.endDate) {
        return `${formatAnalyticsDateLabelPart(range.startDate)} - ${formatAnalyticsDateLabelPart(range.endDate)}`;
    }
    return `最近 ${range?.days || DEFAULT_ANALYTICS_DAYS} 天`;
}

function getAnalyticsRefreshTimeLabel(date = new Date()) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

function updateAnalyticsPanelNotes(timeLabel = '') {
    const normalizedTime = String(
        timeLabel
        || document.getElementById('lastUpdateTime')?.textContent
        || getAnalyticsRefreshTimeLabel()
    ).trim();
    const rangeLabel = buildAnalyticsRangeLabel();

    Object.entries(ANALYTICS_PANEL_NOTE_DEFINITIONS).forEach(([id, config]) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.textContent = `${config.basis || '数据口径'} · ${rangeLabel} · 更新 ${normalizedTime}`;
    });
}

function syncAnalyticsDateRange(startDate, endDate, days = null, labelText = null) {
    const normalizedStart = normalizeAnalyticsDate(startDate);
    const normalizedEnd = normalizeAnalyticsDate(endDate);

    if (!normalizedStart || !normalizedEnd) return;

    const normalizedDays = Number.isFinite(Number(days)) && Number(days) > 0
        ? Number(days)
        : Math.max(1, Math.ceil((normalizedEnd - normalizedStart) / (1000 * 60 * 60 * 24)));

    globalDateRange.days = normalizedDays;
    globalDateRange.startDate = toAnalyticsIsoDate(normalizedStart);
    globalDateRange.endDate = toAnalyticsIsoDate(normalizedEnd);

    if (calendarState?.start) {
        calendarState.start.selectedDate = new Date(normalizedStart);
        calendarState.start.year = normalizedStart.getFullYear();
        calendarState.start.month = normalizedStart.getMonth();
    }

    if (calendarState?.end) {
        calendarState.end.selectedDate = new Date(normalizedEnd);
        calendarState.end.year = normalizedEnd.getFullYear();
        calendarState.end.month = normalizedEnd.getMonth();
    }

    if (typeof inlineCalendarState !== 'undefined') {
        inlineCalendarState.startDate = new Date(normalizedStart);
        inlineCalendarState.endDate = new Date(normalizedEnd);
        inlineCalendarState.selectingEnd = false;
    }

    const labelEl = document.getElementById('dateRangeLabel');
    if (labelEl) {
        labelEl.textContent = labelText || buildAnalyticsRangeLabel({
            days: normalizedDays,
            startDate: globalDateRange.startDate,
            endDate: globalDateRange.endDate
        });
    }

    if (typeof updateCustomDateDisplays === 'function') {
        updateCustomDateDisplays();
    }

    updateAnalyticsPanelNotes();
}

function resetAnalyticsAICache() {
    aiInsightCache = null;
    aiInsightCacheTime = 0;
    aiInsightCacheKey = '';
}

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
    analyticsDerivedState.siteComparisonData = null;
    analyticsDerivedState.commentsSummaryData = null;
    analyticsDerivedState.verifyMonitorSnapshot = null;

    analyticsDerivedRequests.contextKey = contextKey;
    analyticsDerivedRequests.requests = Object.create(null);

    return analyticsDerivedState;
}

function waitForAnalyticsPaint(frames = 1) {
    const totalFrames = Math.max(1, Number(frames) || 1);
    return new Promise((resolve) => {
        let remaining = totalFrames;
        const tick = () => {
            remaining -= 1;
            if (remaining <= 0) {
                resolve();
                return;
            }
            setTimeout(tick, 16);
        };

        setTimeout(tick, 16);
    });
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

function getAnalyticsAIContextKey() {
    const { days, startDate, endDate } = getAnalyticsRangeState();
    return [getAnalyticsSiteParam() || 'all', days, startDate || '', endDate || ''].join(':');
}

function hasAdminAI() {
    return Boolean(window.AdminAI?.configured);
}

function normalizeAnalyticsNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function averageAnalyticsValues(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isGeminiQuotaError(error) {
    const message = String(error?.message || '');
    return Boolean(
        error?.isRateLimited
        || error?.status === 429
        || /resource exhausted|quota|429/i.test(message)
    );
}

function buildQuotaFallbackHint(label = '已切换为本地估算') {
    return `<p class="ai-cache-hint">Gemini 配额暂时不足，${escapeHtml(label)}。</p>`;
}

function getAnalyticsAISourceData(data = null) {
    if (data) {
        return data;
    }

    return {
        overviewBusinessMix: getAnalyticsDerivedStateValue('overviewBusinessMix'),
        verifyServiceSummary: getAnalyticsDerivedStateValue('verifyServiceSummary'),
        growthSummary: getAnalyticsDerivedStateValue('growthSummary'),
        operationsHealthSnapshot: getAnalyticsDerivedStateValue('operationsHealthSnapshot'),
        summaryWindowData: getAnalyticsDerivedStateValue('summaryWindowData'),
        siteComparisonData: getAnalyticsDerivedStateValue('siteComparisonData')
    };
}

function toAnalyticsRangeBoundaryIso(value, endOfDay = false) {
    const date = normalizeAnalyticsDate(value);
    if (!date) return null;

    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    } else {
        date.setHours(0, 0, 0, 0);
    }

    return date.toISOString();
}

async function getAnalyticsAdminAuthHeaders() {
    if (window.AdminAI?.getAuthHeaders) {
        return window.AdminAI.getAuthHeaders();
    }

    const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
    return {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    };
}

async function fetchAnalyticsAdminJson(url, options = {}) {
    const headers = {
        ...(await getAnalyticsAdminAuthHeaders()),
        ...(options.headers || {})
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
        const error = new Error(payload?.message || '后台请求失败');
        error.statusCode = Number(response.status || 0);
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function callAnalyticsRpcWithFallback(name, attempts = []) {
    const candidates = Array.isArray(attempts) && attempts.length ? attempts : [{}];
    let lastError = null;

    for (const attempt of candidates) {
        const params = attempt && typeof attempt === 'object' && !Array.isArray(attempt) ? attempt : {};
        const hasParams = Object.keys(params).length > 0;
        const { data, error } = hasParams
            ? await getAnalyticsSupabaseClient().rpc(name, params)
            : await getAnalyticsSupabaseClient().rpc(name);

        if (!error) {
            return data;
        }

        lastError = error;
    }

    throw lastError || new Error(`RPC ${name} 调用失败`);
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

async function fetchAnalyticsSummaryWindowBundleForSite(site = null) {
    const days = getAnalyticsRangeDays();
    try {
        const summaryV2 = await callAnalyticsRpcWithFallback('get_ai_summary_data_v2', [
            { p_days: days, p_site: site },
            { p_days: days },
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
                const trendOverview = await callAnalyticsRpcWithFallback('get_overview_stats_with_trend', [
                    { p_site: site },
                    {}
                ]);
                if (trendOverview && typeof trendOverview === 'object') {
                    overview = { ...trendOverview, ...overview };
                }
            } catch (_) {
                // Keep the v2 payload as-is if trend fallback is unavailable.
            }
        }

        return buildAnalyticsSummaryWindowPayload(summaryV2Data, overview);
    } catch (_) {
        const [overview, userTrend, channelBreakdown, topContent] = await Promise.all([
            (async () => {
                try {
                    return await callAnalyticsRpcWithFallback('get_overview_stats_with_trend', [
                        { p_site: site },
                        {}
                    ]);
                } catch (_) {
                    return callAnalyticsRpcWithFallback('get_overview_stats', [
                        { p_site: site },
                        {}
                    ]);
                }
            })(),
            callAnalyticsRpcWithFallback('get_user_trend', [
                { p_days: days, p_site: site },
                { p_days: days },
                {}
            ]),
            callAnalyticsRpcWithFallback('get_channel_breakdown', [
                { p_site: site, p_days: days },
                { p_site: site },
                {}
            ]),
            callAnalyticsRpcWithFallback('get_content_top', [
                { p_limit: 5, p_site: site, p_days: days },
                { p_limit: 5, p_site: site },
                { p_limit: 5 }
            ])
        ]);

        return buildAnalyticsSummaryWindowPayload({
            user_trend: userTrend,
            channel_breakdown: channelBreakdown,
            top_content: topContent,
            generated_at: new Date().toISOString()
        }, overview);
    }
}

async function getAnalyticsSummaryWindowData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'summaryWindowData',
        async () => fetchAnalyticsSummaryWindowBundleForSite(getAnalyticsSiteParam()),
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
    const currentSummary = options.summaryWindowData || await getAnalyticsSummaryWindowData({
        contextKey,
        forceRefresh: options.forceRefresh
    });

    if (selectedSite) {
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
        fetchAnalyticsSummaryWindowBundleForSite('cn'),
        fetchAnalyticsSummaryWindowBundleForSite('intl')
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

async function getAnalyticsCommentsSummaryData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'commentsSummaryData',
        async () => {
            const site = window.AdminSiteFilter?.getSiteFilter?.() || 'all';
            const requestUrl = new URL('/api/admin/comments/summary', window.location.origin);
            requestUrl.searchParams.set('site', site);
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
            const requestUrl = new URL('/api/admin/settings/verify-monitor', window.location.origin);
            requestUrl.searchParams.set('taskPage', '1');
            requestUrl.searchParams.set('taskPageSize', '5');
            requestUrl.searchParams.set('failurePage', '1');
            requestUrl.searchParams.set('failurePageSize', '5');
            return fetchAnalyticsAdminJson(`${requestUrl.pathname}${requestUrl.search}`);
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function buildAnalyticsPaymentsSummaryQuery(view = 'ops') {
    const { days, startDate, endDate } = getAnalyticsRangeState();
    const query = new URLSearchParams({
        view: String(view || 'ops')
    });
    const site = getAnalyticsSiteParam();

    if (site) {
        query.set('site', site);
    }

    if (startDate && endDate) {
        const startIso = toAnalyticsRangeBoundaryIso(startDate, false);
        const endIso = toAnalyticsRangeBoundaryIso(endDate, true);
        if (startIso && endIso) {
            query.set('startDate', startIso);
            query.set('endDate', endIso);
            return query;
        }
    }

    query.set('days', String(days || DEFAULT_ANALYTICS_DAYS));
    return query;
}

function collectAnalyticsActionRecommendations(data = null) {
    const baseRecommendations = [
        { panel: '总览', items: data?.overview_business_mix?.recommendations || data?.overviewBusinessMix?.recommendations || [] },
        { panel: '验证服务', items: data?.verify_service_summary?.recommendations || data?.verifyServiceSummary?.recommendations || [] },
        { panel: '社区与裂变', items: data?.growth_summary?.recommendations || data?.growthSummary?.recommendations || [] }
    ].flatMap((group) => (
        (Array.isArray(group.items) ? group.items : []).map((item) => ({
            panel: group.panel,
            tone: item.tone || 'neutral',
            level: item.level || '观察',
            title: item.title || '待处理项',
            summary: item.summary || '',
            actionLabel: item.actionLabel || '',
            destination: item.destination || '',
            icon: item.icon || '',
            context: item.context || item.destinationContext || null,
            sampleLabel: item.sampleLabel || '',
            sampleItems: Array.isArray(item.sampleItems) ? item.sampleItems : []
        }))
    ));

    return [
        ...baseRecommendations,
        ...buildAnalyticsEventDrivenRecommendations(data)
    ];
}

function serializeAnalyticsActionContext(context = null) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return '';
    }

    try {
        const serialized = JSON.stringify(context);
        return serialized && serialized !== '{}' ? encodeURIComponent(serialized) : '';
    } catch (error) {
        console.warn('[Analytics] Failed to serialize action context:', error);
        return '';
    }
}

function parseAnalyticsActionContext(context = null) {
    if (!context) return {};
    if (typeof context === 'object' && !Array.isArray(context)) return context;

    const raw = String(context || '').trim();
    if (!raw) return {};

    const candidates = [raw];
    try {
        const decoded = decodeURIComponent(raw);
        if (decoded !== raw) {
            candidates.unshift(decoded);
        }
    } catch (_) {
        // Ignore decode failures and fall through to raw parse attempt.
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (_) {
            // Try next candidate.
        }
    }

    return {};
}

function getAnalyticsActionPriority(level = '') {
    const normalized = String(level || '').trim();
    if (normalized.includes('优先')) return 0;
    if (normalized.includes('建议复核')) return 1;
    if (normalized.includes('建议跟进')) return 2;
    if (normalized.includes('可跟进')) return 3;
    if (normalized.includes('持续观察') || normalized.includes('运营观察')) return 4;
    if (normalized.includes('状态良好')) return 5;
    return 6;
}

function getAnalyticsDestinationMeta(destination = '', panel = '') {
    switch (String(destination || '').trim().toLowerCase()) {
        case 'payments':
        case 'payments-overview':
            return { icon: 'fas fa-credit-card', ctaLabel: '打开支付总览' };
        case 'payments-queue':
            return { icon: 'fas fa-tower-broadcast', ctaLabel: '查看支付告警队列' };
        case 'payments-ops':
            return { icon: 'fas fa-shield-heart', ctaLabel: '进入支付异常运维' };
        case 'payments-finance':
            return { icon: 'fas fa-sack-dollar', ctaLabel: '查看全站收支' };
        case 'tickets':
        case 'tickets-pending':
            return { icon: 'fas fa-life-ring', ctaLabel: '进入工单队列' };
        case 'tickets-overdue':
            return { icon: 'fas fa-clock', ctaLabel: '查看超时工单' };
        case 'tickets-overview':
            return { icon: 'fas fa-chart-pie', ctaLabel: '查看工单看板' };
        case 'tickets-summary':
            return { icon: 'fas fa-list-check', ctaLabel: '查看工单汇总' };
        case 'verify-monitor':
            return { icon: 'fas fa-wave-square', ctaLabel: '前往 Verify Monitor' };
        case 'settings-google-one':
            return { icon: 'fas fa-sliders', ctaLabel: '检查 Google One 配置' };
        case 'settings-affiliate':
            return { icon: 'fas fa-share-nodes', ctaLabel: '查看推广配置' };
        case 'comments-guestbook':
            return { icon: 'fas fa-comments', ctaLabel: '处理留言治理' };
        case 'analytics-monetization':
            return { icon: 'fas fa-wallet', ctaLabel: '查看积分与交易' };
        case 'analytics-content':
            return { icon: 'fas fa-fire', ctaLabel: '回看内容增长' };
        case 'points':
            return { icon: 'fas fa-ticket-alt', ctaLabel: '查看积分批次' };
        case 'analytics-overview':
            return { icon: 'fas fa-compass-drafting', ctaLabel: '回到经营总览' };
        case 'analytics-growth':
            return { icon: 'fas fa-bullhorn', ctaLabel: '查看社区与裂变' };
        case 'analytics-ai':
            return { icon: 'fas fa-compass-drafting', ctaLabel: '回到经营总览' };
        default:
            return {
                icon: panel === '验证服务' ? 'fas fa-shield-halved' : 'fas fa-arrow-right',
                ctaLabel: '打开对应模块'
            };
    }
}

function getAnalyticsActionGroupMeta(level = '') {
    const priority = getAnalyticsActionPriority(level);

    if (priority <= 1) {
        return {
            key: 'urgent',
            title: '优先处理',
            description: '优先处理会影响验证、付费或主链路转化的问题'
        };
    }

    if (priority <= 3) {
        return {
            key: 'followup',
            title: '建议跟进',
            description: '建议本轮顺手复核承接、评论和消费转化'
        };
    }

    return {
        key: 'observe',
        title: '持续观察',
        description: '作为经营驾驶舱观察项持续看趋势即可'
    };
}

function getAnalyticsAIMetricTone(value, thresholds = {}) {
    const numericValue = toNumericValue(value);
    if (numericValue === null) return 'neutral';

    if (Number.isFinite(thresholds.dangerBelow) && numericValue < thresholds.dangerBelow) return 'danger';
    if (Number.isFinite(thresholds.warningBelow) && numericValue < thresholds.warningBelow) return 'warning';
    if (Number.isFinite(thresholds.dangerAbove) && numericValue > thresholds.dangerAbove) return 'danger';
    if (Number.isFinite(thresholds.warningAbove) && numericValue > thresholds.warningAbove) return 'warning';
    if (thresholds.accent) return 'accent';
    return 'success';
}

function normalizeAnalyticsCountValue(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function formatAnalyticsMinutesWindow(value) {
    const minutes = normalizeAnalyticsCountValue(value);
    if (!minutes) return '0 分钟';
    if (minutes < 60) return `${minutes} 分钟`;
    if (minutes < 24 * 60) return `${roundTo(minutes / 60, 1)} 小时`;
    return `${roundTo(minutes / (24 * 60), 1)} 天`;
}

function getAnalyticsOpsQueueLabel(status = '') {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'dead_letter') return '死信';
    if (normalized === 'retry') return '重试中';
    if (normalized === 'handled') return '已处理';
    if (normalized === 'ignored') return '已忽略';
    if (normalized === 'active') return '处理中';
    if (normalized === 'pending') return '待处理';
    return normalized ? status : '告警';
}

function getAnalyticsSeverityLabel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'danger' || normalized === 'critical' || normalized === 'error') return '高危';
    if (normalized === 'warning' || normalized === 'warn') return '告警';
    if (normalized === 'success') return '正常';
    if (normalized === 'info') return '信息';
    return normalized ? value : '';
}

function getAnalyticsPaymentReferenceValue(item = {}) {
    return [
        item?.payment_order_id,
        item?.order_id,
        item?.provider_order_no,
        item?.reference_value,
        item?.target_id,
        item?.topic_label,
        item?.topic_key
    ].map((value) => String(value || '').trim()).find(Boolean) || '';
}

function formatAnalyticsPaymentAlertSample(item = {}) {
    const title = truncateAnalyticsSnippet(item?.title || item?.message || item?.topic_label || '支付异常', 20);
    const status = getAnalyticsOpsQueueLabel(item?.queue_status) || getAnalyticsSeverityLabel(item?.severity);
    const reference = truncateAnalyticsSnippet(getAnalyticsPaymentReferenceValue(item), 20);
    return [title, status, reference].filter(Boolean).join(' · ');
}

function formatAnalyticsTicketFocusSample(item = {}) {
    const ticketId = String(item?.ticket_id || item?.target_id || item?.id || '').trim() || '工单';
    const status = truncateAnalyticsSnippet(
        item?.ticket_status_label
        || item?.status
        || item?.severity
        || '',
        12
    );
    const summary = truncateAnalyticsSnippet(
        item?.wait_label
        || item?.title
        || item?.reason
        || item?.order_id
        || '',
        22
    );
    return [ticketId, status, summary].filter(Boolean).join(' · ');
}

function normalizeAnalyticsTicketsOverviewPayload(payload = {}) {
    const backlogSource = payload?.backlog && typeof payload.backlog === 'object' ? payload.backlog : {};
    const reminderSource = payload?.reminder && typeof payload.reminder === 'object' ? payload.reminder : {};
    const activitySource = reminderSource?.activity && typeof reminderSource.activity === 'object' ? reminderSource.activity : {};
    const digestSource = reminderSource?.summary_digest && typeof reminderSource.summary_digest === 'object' ? reminderSource.summary_digest : {};

    return {
        backlog: {
            total_pending: normalizeAnalyticsCountValue(backlogSource.total_pending),
            unassigned_count: normalizeAnalyticsCountValue(backlogSource.unassigned_count),
            overdue_count: normalizeAnalyticsCountValue(backlogSource.overdue_count),
            critical_overdue_count: normalizeAnalyticsCountValue(backlogSource.critical_overdue_count),
            high_priority_count: normalizeAnalyticsCountValue(backlogSource.high_priority_count),
            refundable_count: normalizeAnalyticsCountValue(backlogSource.refundable_count),
            oldest_wait_minutes: normalizeAnalyticsCountValue(backlogSource.oldest_wait_minutes)
        },
        reminder: {
            activity: {
                active_count: normalizeAnalyticsCountValue(activitySource.active_count),
                retry_count: normalizeAnalyticsCountValue(activitySource.retry_count),
                dead_letter_count: normalizeAnalyticsCountValue(activitySource.dead_letter_count),
                latest_overdue: activitySource.latest_overdue && typeof activitySource.latest_overdue === 'object'
                    ? activitySource.latest_overdue
                    : null
            },
            summary_digest: {
                failure_job_count: normalizeAnalyticsCountValue(digestSource.failure_job_count),
                retry_count: normalizeAnalyticsCountValue(digestSource.retry_count),
                dead_letter_count: normalizeAnalyticsCountValue(digestSource.dead_letter_count),
                latest_problem_job: digestSource.latest_problem_job && typeof digestSource.latest_problem_job === 'object'
                    ? digestSource.latest_problem_job
                    : null
            }
        }
    };
}

function buildOperationsHealthSnapshotFromPayloads({
    paymentsPayload = {},
    ticketsPayload = {}
} = {}) {
    const opsAlertSummary = paymentsPayload?.ops_alert_summary && typeof paymentsPayload.ops_alert_summary === 'object'
        ? paymentsPayload.ops_alert_summary
        : {};
    const opsAlertItems = Array.isArray(paymentsPayload?.ops_alert_items) ? paymentsPayload.ops_alert_items : [];
    const recentAnomalies = Array.isArray(paymentsPayload?.recent_anomalies) ? paymentsPayload.recent_anomalies : [];
    const exceptionTopics = Array.isArray(paymentsPayload?.exception_topics) ? paymentsPayload.exception_topics : [];
    const exceptionTopicItems = Array.isArray(paymentsPayload?.exception_topic_items) ? paymentsPayload.exception_topic_items : [];
    const normalizedTickets = typeof window.AdminTickets?.normalizeOverviewPayload === 'function'
        ? window.AdminTickets.normalizeOverviewPayload(ticketsPayload?.overview || ticketsPayload || {})
        : normalizeAnalyticsTicketsOverviewPayload(ticketsPayload?.overview || ticketsPayload || {});
    const backlog = normalizedTickets?.backlog || {};
    const reminderActivity = normalizedTickets?.reminder?.activity || {};
    const reminderDigest = normalizedTickets?.reminder?.summary_digest || {};

    const paymentsSummary = {
        alertTotal: normalizeAnalyticsCountValue(opsAlertSummary.total),
        deadLetterCount: normalizeAnalyticsCountValue(opsAlertSummary.dead_letter),
        retryCount: normalizeAnalyticsCountValue(opsAlertSummary.retry),
        handledCount: normalizeAnalyticsCountValue(opsAlertSummary.handled),
        ignoredCount: normalizeAnalyticsCountValue(opsAlertSummary.ignored),
        anomalyCount: recentAnomalies.length,
        exceptionTopicCount: exceptionTopics.reduce((sum, item) => sum + normalizeAnalyticsCountValue(item?.count), 0)
    };

    const ticketsSummary = {
        pendingCount: normalizeAnalyticsCountValue(backlog.total_pending),
        overdueCount: normalizeAnalyticsCountValue(backlog.overdue_count),
        criticalOverdueCount: normalizeAnalyticsCountValue(backlog.critical_overdue_count),
        unassignedCount: normalizeAnalyticsCountValue(backlog.unassigned_count),
        highPriorityCount: normalizeAnalyticsCountValue(backlog.high_priority_count),
        oldestWaitMinutes: normalizeAnalyticsCountValue(backlog.oldest_wait_minutes),
        reminderRetryCount: normalizeAnalyticsCountValue(reminderActivity.retry_count || reminderDigest.retry_count),
        reminderDeadLetterCount: normalizeAnalyticsCountValue(reminderActivity.dead_letter_count || reminderDigest.dead_letter_count),
        reminderFailureCount: normalizeAnalyticsCountValue(reminderDigest.failure_job_count)
    };

    return {
        metrics: {
            paymentAlertTotal: paymentsSummary.alertTotal,
            paymentDeadLetterCount: paymentsSummary.deadLetterCount,
            paymentRetryCount: paymentsSummary.retryCount,
            paymentAnomalyCount: paymentsSummary.anomalyCount,
            paymentExceptionTopicCount: paymentsSummary.exceptionTopicCount,
            ticketPendingCount: ticketsSummary.pendingCount,
            ticketOverdueCount: ticketsSummary.overdueCount,
            ticketCriticalOverdueCount: ticketsSummary.criticalOverdueCount,
            ticketOldestWaitMinutes: ticketsSummary.oldestWaitMinutes,
            ticketReminderRetryCount: ticketsSummary.reminderRetryCount,
            ticketReminderDeadLetterCount: ticketsSummary.reminderDeadLetterCount
        },
        payments: {
            summary: paymentsSummary,
            opsAlertItems,
            recentAnomalies,
            exceptionTopics,
            exceptionTopicItems,
            focusAlert: opsAlertItems[0] || recentAnomalies[0] || exceptionTopicItems[0] || null
        },
        tickets: {
            overview: normalizedTickets,
            backlog: ticketsSummary,
            focusOverdue: reminderActivity.latest_overdue || reminderDigest.latest_problem_job || null
        },
        samples: {
            paymentAlerts: [...opsAlertItems, ...recentAnomalies, ...exceptionTopicItems]
                .slice(0, 4)
                .map((item) => formatAnalyticsPaymentAlertSample(item)),
            ticketIssues: [
                reminderActivity.latest_overdue,
                reminderDigest.latest_problem_job
            ].filter(Boolean).slice(0, 3).map((item) => formatAnalyticsTicketFocusSample(item))
        },
        exportRows: [
            {
                '指标': '支付告警总数',
                '数值': paymentsSummary.alertTotal,
                '说明': `死信 ${paymentsSummary.deadLetterCount} / 重试 ${paymentsSummary.retryCount} / 专题 ${paymentsSummary.exceptionTopicCount}`
            },
            {
                '指标': '支付异常样本',
                '数值': paymentsSummary.anomalyCount,
                '说明': `${recentAnomalies.length} 条最近异常`
            },
            {
                '指标': '工单待处理',
                '数值': ticketsSummary.pendingCount,
                '说明': `超时 ${ticketsSummary.overdueCount} / critical ${ticketsSummary.criticalOverdueCount}`
            },
            {
                '指标': '最老等待时长',
                '数值': ticketsSummary.oldestWaitMinutes,
                '说明': formatAnalyticsMinutesWindow(ticketsSummary.oldestWaitMinutes)
            },
            {
                '指标': '工单提醒重试',
                '数值': ticketsSummary.reminderRetryCount,
                '说明': `提醒死信 ${ticketsSummary.reminderDeadLetterCount} / 失败摘要 ${ticketsSummary.reminderFailureCount}`
            }
        ]
    };
}

function getAnalyticsAnomalyTonePriority(tone = '') {
    if (tone === 'danger') return 0;
    if (tone === 'warning') return 1;
    if (tone === 'accent') return 2;
    if (tone === 'neutral') return 3;
    return 4;
}

function buildAnalyticsEventSampleItems(view = {}, limit = 3) {
    return (Array.isArray(view?.items) ? view.items : [])
        .slice(0, limit)
        .map((item) => [
            String(item?.title || '').trim(),
            String(item?.value || '').trim(),
            String(item?.badgeLabel || '').trim()
        ].filter(Boolean).join(' · '));
}

function buildAnalyticsEventDrivenRecommendations(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const summarySource = sourceData?.summaryWindowData || sourceData || {};
    const siteComparisonData = sourceData?.site_comparison || sourceData?.siteComparisonData || null;
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const commerce = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const growth = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const recommendations = [];

    const walletOpenUsers = normalizeAnalyticsCountValue(commerce.wallet_open_users ?? eventOverview.wallet_open_users);
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerce.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerce.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerce.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewUsers = normalizeAnalyticsCountValue(commerce.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerce.shop_purchase_users ?? eventOverview.shop_purchase_users);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerce.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);
    const businessActiveUsers = normalizeAnalyticsCountValue(eventOverview.business_active_users);
    const guestbookPostUsers = normalizeAnalyticsCountValue(growth.guestbook_post_users ?? eventOverview.guestbook_post_users);
    const inviteClickUsers = normalizeAnalyticsCountValue(growth.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growth.checkin_success_users ?? eventOverview.checkin_success_users);
    const inviteCoverageRate = getAnalyticsPercentRate(inviteClickUsers, businessActiveUsers);
    const checkinCoverageRate = getAnalyticsPercentRate(checkinSuccessUsers, businessActiveUsers);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);
    const commerceView = buildCommerceEventFunnelViewData(summarySource);
    const growthView = buildGrowthEventFunnelViewData(summarySource);

    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        recommendations.push({
            panel: '积分与交易',
            tone: rechargeSuccessRate < 40 ? 'danger' : 'warning',
            level: rechargeSuccessRate < 40 ? '优先处理' : '建议复核',
            title: '真实事件显示充值成功率偏低',
            summary: `当前窗口钱包打开 ${formatNumber(walletOpenUsers)} 人、充值点击 ${formatNumber(rechargeClickUsers)} 人，但最终只有 ${formatNumber(rechargeSuccessUsers)} 人完成充值，建议优先检查支付链路。`,
            actionLabel: '去支付排查',
            destination: 'payments-queue',
            icon: 'fas fa-credit-card',
            context: {
                focusQueue: true,
                sectionId: 'paymentsOpsAlertQueuePanel'
            },
            sampleLabel: '交易转化线索',
            sampleItems: buildAnalyticsEventSampleItems(commerceView)
        });
    }

    if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        recommendations.push({
            panel: '积分与交易',
            tone: shopPurchaseRate < 10 ? 'warning' : 'accent',
            level: shopPurchaseRate < 10 ? '建议跟进' : '持续观察',
            title: '商城浏览已形成但成交承接偏弱',
            summary: `当前窗口商城浏览 ${formatNumber(shopViewUsers)} 人，但成交只有 ${formatNumber(shopPurchaseUsers)} 人，建议回到积分与交易排查套餐、权益和价格承接。`,
            actionLabel: '看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-wallet',
            context: {
                sectionId: 'commerceEventFunnel'
            },
            sampleLabel: '交易转化线索',
            sampleItems: buildAnalyticsEventSampleItems(commerceView)
        });
    }

    if (businessActiveUsers >= 10 && referralRewardPoints > 0 && inviteClickUsers === 0) {
        recommendations.push({
            panel: '社区与裂变',
            tone: 'warning',
            level: '建议复核',
            title: '返佣奖励已投放但邀请点击仍未起量',
            summary: `当前窗口返佣/拉新奖励 ${formatNumber(referralRewardPoints)} 积分，但还没有看到真实邀请点击，建议先复核推广入口和文案。`,
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: 'commission_rate_shop'
            },
            sampleLabel: '增长动作线索',
            sampleItems: buildAnalyticsEventSampleItems(growthView)
        });
    }

    if (guestbookPostUsers >= 3 && inviteCoverageRate < 3 && checkinCoverageRate < 8 && checkinRewardPoints > 0) {
        recommendations.push({
            panel: '社区与裂变',
            tone: 'accent',
            level: '持续观察',
            title: '社区反馈有量，但裂变与签到承接偏弱',
            summary: `当前窗口留言发布 ${formatNumber(guestbookPostUsers)} 人、签到成功 ${formatNumber(checkinSuccessUsers)} 人、邀请点击 ${formatNumber(inviteClickUsers)} 人，建议回看增长动作是否形成连续承接。`,
            actionLabel: '查看社区与裂变',
            destination: 'analytics-growth',
            icon: 'fas fa-bullhorn',
            context: {
                sectionId: 'growthEventFunnel'
            },
            sampleLabel: '增长动作线索',
            sampleItems: buildAnalyticsEventSampleItems(growthView)
        });
    }

    if (siteComparisonData?.mode === 'compare') {
        const cnSnapshot = siteComparisonData.snapshots?.find((item) => item.site === 'cn') || null;
        const intlSnapshot = siteComparisonData.snapshots?.find((item) => item.site === 'intl') || null;
        if (cnSnapshot && intlSnapshot) {
            const verifyGap = roundTo((cnSnapshot.metrics.verifySuccessRate || 0) - (intlSnapshot.metrics.verifySuccessRate || 0), 1) || 0;
            const rechargeGap = roundTo((cnSnapshot.metrics.rechargeSuccessRate || 0) - (intlSnapshot.metrics.rechargeSuccessRate || 0), 1) || 0;
            const weakerVerifySite = verifyGap === 0 ? '' : (verifyGap > 0 ? 'intl' : 'cn');
            const weakerRechargeSite = rechargeGap === 0 ? '' : (rechargeGap > 0 ? 'intl' : 'cn');

            if (Math.abs(verifyGap) >= 12 && weakerVerifySite) {
                recommendations.push({
                    panel: '站点差异',
                    tone: Math.abs(verifyGap) >= 20 ? 'warning' : 'accent',
                    level: Math.abs(verifyGap) >= 20 ? '建议复核' : '持续观察',
                    title: `${getAnalyticsSiteLabel(weakerVerifySite)} 验证成功率明显落后`,
                    summary: `当前窗口 CN 验证成功率 ${formatPercent(cnSnapshot.metrics.verifySuccessRate)}，INTL 为 ${formatPercent(intlSnapshot.metrics.verifySuccessRate)}，建议优先复核更弱站点的验证链路。`,
                    actionLabel: '看验证服务',
                    destination: 'analytics-verify',
                    icon: 'fas fa-globe',
                    context: {
                        site: weakerVerifySite,
                        sectionId: 'verifyEventFunnel'
                    },
                    sampleLabel: '站点差异',
                    sampleItems: siteComparisonData.insights?.slice(0, 2) || []
                });
            }

            if (Math.abs(rechargeGap) >= 15 && weakerRechargeSite) {
                recommendations.push({
                    panel: '站点差异',
                    tone: Math.abs(rechargeGap) >= 25 ? 'warning' : 'accent',
                    level: Math.abs(rechargeGap) >= 25 ? '建议跟进' : '持续观察',
                    title: `${getAnalyticsSiteLabel(weakerRechargeSite)} 充值成功率低于另一侧`,
                    summary: `当前窗口 CN 充值成功率 ${formatPercent(cnSnapshot.metrics.rechargeSuccessRate)}，INTL 为 ${formatPercent(intlSnapshot.metrics.rechargeSuccessRate)}，建议优先排查更弱站点的支付承接。`,
                    actionLabel: '看积分与交易',
                    destination: 'analytics-monetization',
                    icon: 'fas fa-wallet',
                    context: {
                        site: weakerRechargeSite,
                        sectionId: 'commerceEventFunnel'
                    },
                    sampleLabel: '站点差异',
                    sampleItems: siteComparisonData.insights?.slice(0, 2) || []
                });
            }
        }
    }

    return recommendations;
}

function buildAnalyticsBusinessAnomalyCardsData(data = null, limit = 4) {
    const sourceData = getAnalyticsAISourceData(data);
    const overviewMetrics = sourceData?.overview_business_mix?.metrics || sourceData?.overviewBusinessMix?.metrics || {};
    const verifyMetrics = sourceData?.verify_service_summary?.metrics || sourceData?.verifyServiceSummary?.metrics || {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const operationsHealth = sourceData?.operations_health_snapshot || sourceData?.operationsHealthSnapshot || {};
    const summarySource = sourceData?.summaryWindowData || sourceData || {};
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const commerceFunnel = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const siteComparisonData = sourceData?.site_comparison || sourceData?.siteComparisonData || null;
    const operationsMetrics = operationsHealth?.metrics || {};
    const paymentSummary = operationsHealth?.payments?.summary || {};
    const ticketSummary = operationsHealth?.tickets?.backlog || {};
    const paymentFocusRow = operationsHealth?.payments?.focusAlert || null;
    const ticketFocusRow = operationsHealth?.tickets?.focusOverdue || null;
    const verifyFailedCount = normalizeAnalyticsCountValue(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsCountValue(verifyMetrics.activeCount);
    const verifySuccessRate = normalizeAnalyticsNumber(verifyMetrics.successRate || overviewMetrics.verifySuccessRate);
    const verifyRequestCount = normalizeAnalyticsCountValue(verifyMetrics.requestCount || overviewMetrics.verifyRequestCount);
    const unlockCount = normalizeAnalyticsCountValue(overviewMetrics.unlockCount);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);
    const rewardPressure = roundTo(referralRewardPoints + checkinRewardPoints, 1) || 0;
    const rewardPerCoreAction = rewardPressure > 0
        ? rewardPressure / Math.max(1, unlockCount + verifyRequestCount)
        : 0;
    const anomalyCards = [];
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerceFunnel.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_purchase_users ?? eventOverview.shop_purchase_users);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerceFunnel.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);
    const commerceEventView = buildCommerceEventFunnelViewData(summarySource);

    if (
        normalizeAnalyticsCountValue(operationsMetrics.paymentAlertTotal) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.paymentDeadLetterCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.paymentRetryCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.paymentAnomalyCount) > 0
    ) {
        const deadLetterCount = normalizeAnalyticsCountValue(paymentSummary.deadLetterCount);
        const retryCount = normalizeAnalyticsCountValue(paymentSummary.retryCount);
        const alertTotal = normalizeAnalyticsCountValue(paymentSummary.alertTotal);
        const tone = deadLetterCount > 0 ? 'danger' : (retryCount > 0 || alertTotal >= 3 ? 'warning' : 'accent');
        anomalyCards.push({
            tone,
            level: deadLetterCount > 0 ? '优先处理' : '建议复核',
            panel: '支付异常',
            title: deadLetterCount > 0 ? '支付告警队列出现死信' : '支付异常队列仍在堆积',
            metricLabel: deadLetterCount > 0 ? '待处理死信' : '站外支付告警',
            metricValue: `${formatNumber(deadLetterCount || alertTotal)} 条`,
            meta: `重试 ${formatNumber(retryCount)} / 专题 ${formatNumber(paymentSummary.exceptionTopicCount)}`,
            summary: deadLetterCount > 0
                ? '支付侧已经出现死信任务，建议优先进入支付告警队列收口，避免真实订单反馈继续堆积。'
                : '支付侧当前还有重试或未处理告警，建议继续查看队列、专题异常和近期支付波动。',
            actionLabel: '去支付排查',
            destination: 'payments-queue',
            icon: 'fas fa-tower-broadcast',
            context: paymentFocusRow?.order_id || paymentFocusRow?.payment_order_id || paymentFocusRow?.provider_order_no
                ? {
                    paymentOrderId: String(
                        paymentFocusRow.order_id
                        || paymentFocusRow.payment_order_id
                        || paymentFocusRow.provider_order_no
                    ).trim(),
                    focusQueue: true,
                    sectionId: 'paymentsOpsAlertQueuePanel'
                }
                : {
                    focusQueue: true,
                    sectionId: 'paymentsOpsAlertQueuePanel'
                },
            sampleLabel: '最近支付异常',
            sampleItems: Array.isArray(operationsHealth?.samples?.paymentAlerts) ? operationsHealth.samples.paymentAlerts.slice(0, 3) : []
        });
    }

    if (siteComparisonData?.mode === 'compare' && Array.isArray(siteComparisonData.comparisons) && siteComparisonData.topGap?.focusSite) {
        const topGap = siteComparisonData.topGap;
        const gapMagnitude = Math.abs(normalizeAnalyticsNumber(topGap.diff));
        if (gapMagnitude >= 12) {
            anomalyCards.push({
                tone: gapMagnitude >= 20 ? 'warning' : 'accent',
                level: gapMagnitude >= 20 ? '建议复核' : '持续观察',
                panel: '站点差异',
                title: `${siteComparisonData.focusLabel || getAnalyticsSiteLabel(topGap.focusSite)} 在 ${topGap.label} 上明显落后`,
                metricLabel: topGap.label,
                metricValue: `${formatPercent(topGap.focusSite === 'intl' ? topGap.intlValue : topGap.cnValue)}`,
                meta: `CN ${formatPercent(topGap.cnValue)} / INTL ${formatPercent(topGap.intlValue)}`,
                summary: `当前窗口 ${topGap.label} 的站点差异约 ${trimTrailingZeros(gapMagnitude.toFixed(1))} 个百分点，建议优先复核 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(topGap.focusSite)} 对应链路。`,
                actionLabel: /验证/.test(topGap.label) ? '看验证服务' : '看积分与交易',
                destination: /验证/.test(topGap.label) ? 'analytics-verify' : 'analytics-monetization',
                icon: 'fas fa-globe',
                context: {
                    site: topGap.focusSite,
                    sectionId: /验证/.test(topGap.label) ? 'verifyEventFunnel' : 'commerceEventFunnel'
                },
                sampleLabel: '站点差异',
                sampleItems: siteComparisonData.insights?.slice(0, 3) || []
            });
        }
    }

    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        anomalyCards.push({
            tone: rechargeSuccessRate < 40 ? 'danger' : 'warning',
            level: rechargeSuccessRate < 40 ? '优先处理' : '建议复核',
            panel: '交易转化',
            title: rechargeSuccessRate < 40 ? '充值点击后成功转化明显偏低' : '充值成功率仍低于稳定区间',
            metricLabel: '充值成功率',
            metricValue: formatPercent(rechargeSuccessRate),
            meta: `点击 ${formatNumber(rechargeClickUsers)} / 成功 ${formatNumber(rechargeSuccessUsers)} / 商城成交 ${formatNumber(shopPurchaseUsers)}`,
            summary: rechargeSuccessRate < 40
                ? '真实交易事件显示点击后成功转化明显偏低，建议优先联动支付告警和交易看板排查链路问题。'
                : '真实交易事件显示充值点击已有需求，但支付成功仍偏低，建议继续检查支付异常和配置一致性。',
            actionLabel: '去支付排查',
            destination: 'payments-queue',
            icon: 'fas fa-credit-card',
            context: {
                focusQueue: true,
                sectionId: 'paymentsOpsAlertQueuePanel'
            },
            sampleLabel: '真实交易转化',
            sampleItems: buildAnalyticsEventSampleItems(commerceEventView)
        });
    } else if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        anomalyCards.push({
            tone: shopPurchaseRate < 10 ? 'warning' : 'accent',
            level: shopPurchaseRate < 10 ? '建议跟进' : '持续观察',
            panel: '交易转化',
            title: '商城浏览和成交之间仍有明显流失',
            metricLabel: '商城成交率',
            metricValue: formatPercent(shopPurchaseRate),
            meta: `浏览 ${formatNumber(shopViewUsers)} / 成交 ${formatNumber(shopPurchaseUsers)} / 充值成功 ${formatNumber(rechargeSuccessUsers)}`,
            summary: '真实交易事件显示用户已经进入商城，但成交承接偏弱，建议回看积分与交易里的套餐、权益和消费路径。',
            actionLabel: '看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-wallet',
            context: {
                sectionId: 'commerceEventFunnel'
            },
            sampleLabel: '真实交易转化',
            sampleItems: buildAnalyticsEventSampleItems(commerceEventView)
        });
    }

    if (
        normalizeAnalyticsCountValue(operationsMetrics.ticketOverdueCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.ticketCriticalOverdueCount) > 0
        || normalizeAnalyticsCountValue(operationsMetrics.ticketPendingCount) >= 6
        || normalizeAnalyticsCountValue(operationsMetrics.ticketReminderDeadLetterCount) > 0
    ) {
        const overdueCount = normalizeAnalyticsCountValue(ticketSummary.overdueCount);
        const criticalOverdueCount = normalizeAnalyticsCountValue(ticketSummary.criticalOverdueCount);
        const pendingCount = normalizeAnalyticsCountValue(ticketSummary.pendingCount);
        const oldestWaitMinutes = normalizeAnalyticsCountValue(ticketSummary.oldestWaitMinutes);
        const reminderDeadLetterCount = normalizeAnalyticsCountValue(ticketSummary.reminderDeadLetterCount);
        const tone = criticalOverdueCount > 0 || reminderDeadLetterCount > 0
            ? 'danger'
            : (overdueCount > 0 || pendingCount >= 10 ? 'warning' : 'accent');
        anomalyCards.push({
            tone,
            level: criticalOverdueCount > 0 || reminderDeadLetterCount > 0 ? '优先处理' : '建议跟进',
            panel: '工单队列',
            title: criticalOverdueCount > 0 ? '工单队列已有 critical 超时' : '工单队列出现待处理堆积',
            metricLabel: overdueCount > 0 ? '超时工单' : '待处理工单',
            metricValue: `${formatNumber(overdueCount || pendingCount)} 单`,
            meta: `critical ${formatNumber(criticalOverdueCount)} / 最老 ${formatAnalyticsMinutesWindow(oldestWaitMinutes)}`,
            summary: criticalOverdueCount > 0 || reminderDeadLetterCount > 0
                ? '当前工单提醒或超时任务已经进入高优先级区间，建议尽快进入工单队列确认负责人与响应进度。'
                : '工单待处理量正在抬升，建议检查未指派、高优先和超时队列是否需要重新分配。',
            actionLabel: '进入工单队列',
            destination: overdueCount > 0 || criticalOverdueCount > 0 ? 'tickets-overdue' : 'tickets-pending',
            icon: 'fas fa-life-ring',
            context: ticketFocusRow?.ticket_id
                ? {
                    ticketId: String(ticketFocusRow.ticket_id).trim(),
                    targetId: String(ticketFocusRow.ticket_id).trim(),
                    workspace: 'queue',
                    quickFilter: overdueCount > 0 || criticalOverdueCount > 0 ? 'overdue' : '',
                    status: 'pending'
                }
                : {
                    workspace: 'queue',
                    quickFilter: overdueCount > 0 || criticalOverdueCount > 0 ? 'overdue' : '',
                    status: 'pending'
                },
            sampleLabel: '最近队列样本',
            sampleItems: Array.isArray(operationsHealth?.samples?.ticketIssues) ? operationsHealth.samples.ticketIssues.slice(0, 3) : []
        });
    }

    if (verifyRequestCount > 0 && (verifyFailedCount > 0 || verifyActiveCount >= 3 || verifySuccessRate < 85)) {
        const tone = verifyFailedCount > 0 || verifySuccessRate < 70 ? 'danger' : 'warning';
        const verifyRows = sourceData?.verify_service_summary?.focusRows || sourceData?.verifyServiceSummary?.focusRows || [];
        const focusRow = Array.isArray(verifyRows) ? verifyRows[0] : null;
        anomalyCards.push({
            tone,
            level: tone === 'danger' ? '优先处理' : '建议复核',
            panel: '验证服务',
            title: verifyFailedCount > 0 ? '验证服务出现失败/阻塞任务' : '验证队列仍有处理中任务',
            metricLabel: verifyFailedCount > 0 ? '失败/阻塞验证' : '处理中验证',
            metricValue: `${formatNumber(verifyFailedCount || verifyActiveCount)} 条`,
            meta: `成功率 ${formatPercent(verifySuccessRate)} / 请求 ${formatNumber(verifyRequestCount)}`,
            summary: verifyFailedCount > 0
                ? '验证主链路已有失败或阻塞样本，建议优先进入 Verify Monitor 处理失败任务和配置问题。'
                : '验证队列仍在积压，建议继续检查额度、接口状态和重试情况。',
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: focusRow?.['验证单号'] ? {
                verificationId: String(focusRow['验证单号']).trim(),
                targetId: String(focusRow['验证单号']).trim(),
                referenceValue: String(focusRow['验证单号']).trim()
            } : null,
            sampleLabel: '最近验证异常',
            sampleItems: Array.isArray(sourceData?.verify_service_summary?.samples?.focusTasks || sourceData?.verifyServiceSummary?.samples?.focusTasks)
                ? (sourceData.verify_service_summary?.samples?.focusTasks || sourceData.verifyServiceSummary?.samples?.focusTasks).slice(0, 3)
                : []
        });
    }

    if (rewardPressure > 0 && (rewardPressure >= 120 || rewardPerCoreAction >= 30 || unlockCount === 0)) {
        const growthSamples = sourceData?.growth_summary?.samples || sourceData?.growthSummary?.samples || {};
        const tone = rewardPerCoreAction >= 30 || unlockCount === 0 ? 'warning' : 'accent';
        anomalyCards.push({
            tone,
            level: tone === 'warning' ? '建议复核' : '持续观察',
            panel: '裂变与激励',
            title: referralRewardPoints > 0 ? '返佣与拉新奖励正在放量' : '签到补贴正在抬升',
            metricLabel: '激励积分',
            metricValue: `${formatNumber(rewardPressure)} 积分`,
            meta: `返佣/拉新 ${formatNumber(referralRewardPoints)} / 签到 ${formatNumber(checkinRewardPoints)}`,
            summary: unlockCount === 0
                ? '当前窗口激励积分已经投放，但还没有看到足够的内容解锁或验证承接，建议先复核投放策略。'
                : '激励投放已经明显抬升，建议结合推广配置、返佣 ROI 和消费承接一起看，避免只放量不转化。',
            actionLabel: referralRewardPoints > 0 ? '查看推广配置' : '查看积分流水',
            destination: referralRewardPoints > 0 ? 'settings-affiliate' : 'points',
            icon: referralRewardPoints > 0 ? 'fas fa-share-nodes' : 'fas fa-calendar-check',
            context: referralRewardPoints > 0
                ? {
                    field: referralRewardPoints >= checkinRewardPoints ? 'commission_rate_shop' : 'registration_reward_points'
                }
                : {
                    view: 'lookup',
                    quick: 'today'
                },
            sampleLabel: '最近激励样本',
            sampleItems: referralRewardPoints > 0
                ? (Array.isArray(growthSamples.referralRewards) ? growthSamples.referralRewards.slice(0, 3) : [])
                : (Array.isArray(growthSamples.checkinRewards) ? growthSamples.checkinRewards.slice(0, 3) : [])
        });
    }

    const normalizedCards = anomalyCards
        .sort((left, right) => getAnalyticsAnomalyTonePriority(left.tone) - getAnalyticsAnomalyTonePriority(right.tone))
        .slice(0, limit);

    if (normalizedCards.length > 0) {
        return normalizedCards;
    }

    return [{
        tone: 'success',
        level: '状态良好',
        panel: '运营健康',
        title: '当前窗口未发现明显经营异常',
        metricLabel: '健康状态',
        metricValue: '稳定',
        meta: '支付、工单、验证和激励链路暂时平稳',
        summary: '可以继续结合内容消费、验证成功率和社区承接看更细的经营变化。',
        actionLabel: '回到经营总览',
        destination: 'analytics-overview',
        icon: 'fas fa-compass-drafting',
        sampleLabel: '',
        sampleItems: []
    }];
}

function renderAnalyticsAnomalyCardGrid(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return renderHintState('fas fa-triangle-exclamation', '当前窗口暂无待排查异常');
    }

    return `
        <div class="ai-anomaly-grid">
            ${items.map((item) => `
                <button
                    type="button"
                    class="ai-anomaly-card ai-anomaly-card--${escapeHtml(item.tone || 'neutral')}"
                    data-admin-action="analytics-open-destination"
                    data-analytics-destination="${escapeHtml(item.destination || '')}"
                    data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item.context || null))}"
                >
                    <div class="ai-anomaly-card__top">
                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone || 'neutral')}">${escapeHtml(item.level || '观察')}</span>
                        <span class="ai-anomaly-card__panel">${escapeHtml(item.panel || '经营异常')}</span>
                    </div>
                    <div class="ai-anomaly-card__metric-row">
                        <div>
                            <span class="ai-anomaly-card__metric-label">${escapeHtml(item.metricLabel || '异常指标')}</span>
                            <strong class="ai-anomaly-card__metric">${escapeHtml(item.metricValue || '--')}</strong>
                        </div>
                        <i class="${escapeHtml(item.icon || 'fas fa-triangle-exclamation')}"></i>
                    </div>
                    <strong class="ai-anomaly-card__title">${escapeHtml(item.title || '经营异常')}</strong>
                    ${item.meta ? `<div class="ai-anomaly-card__meta">${escapeHtml(item.meta)}</div>` : ''}
                    <div class="ai-anomaly-card__summary">${escapeHtml(item.summary || '建议打开对应模块继续处理')}</div>
                    ${Array.isArray(item.sampleItems) && item.sampleItems.length ? `
                        <div class="ai-anomaly-card__samples">
                            <span class="ai-anomaly-card__sample-label">${escapeHtml(item.sampleLabel || '样本线索')}</span>
                            <div class="ai-anomaly-card__sample-list">
                                ${item.sampleItems.slice(0, 3).map((sample) => `
                                    <span class="ai-anomaly-card__sample-pill">${escapeHtml(sample)}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <span class="ai-anomaly-card__cta">${escapeHtml(item.actionLabel || '打开对应模块')}<i class="fas fa-arrow-right"></i></span>
                </button>
            `).join('')}
        </div>
    `;
}

function renderAnalyticsDutyQueue(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return renderHintState('fas fa-triangle-exclamation', '当前窗口暂无待排查异常');
    }

    const [primaryItem, ...secondaryItems] = items;
    const primarySamples = Array.isArray(primaryItem?.sampleItems) ? primaryItem.sampleItems.slice(0, 2) : [];
    const primaryMetric = splitAnalyticsDutyDisplayValue(primaryItem?.metricValue || '--');

    return `
        <div class="analytics-duty-queue${secondaryItems.length ? '' : ' analytics-duty-queue--single'}">
            <article class="analytics-duty-hero analytics-duty-hero--${escapeHtml(primaryItem?.tone || 'neutral')}">
                <div class="analytics-duty-hero__top">
                    <div class="analytics-duty-hero__badge-row">
                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(primaryItem?.tone || 'neutral')}">${escapeHtml(primaryItem?.level || '观察')}</span>
                        <span class="analytics-duty-hero__panel">${escapeHtml(primaryItem?.panel || '经营异常')}</span>
                    </div>
                </div>
                <div class="analytics-duty-hero__body">
                    <div class="analytics-duty-hero__content">
                        <strong class="analytics-duty-hero__title">${escapeHtml(primaryItem?.title || '经营异常')}</strong>
                        ${(primaryItem?.meta || primaryItem?.summary) ? `
                            <div class="analytics-duty-hero__summary">${escapeHtml(primaryItem?.meta || primaryItem?.summary || '')}</div>
                        ` : ''}
                        ${primarySamples.length ? `
                            <div class="analytics-duty-hero__samples">
                                ${primarySamples.map((sample) => `
                                    <span class="analytics-duty-hero__sample-pill">${escapeHtml(sample)}</span>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="analytics-duty-hero__metric-card">
                        <div class="analytics-duty-hero__metric-stack">
                            <strong class="analytics-duty-hero__metric">${escapeHtml(primaryMetric.primary)}</strong>
                            ${primaryMetric.secondary ? `<span class="analytics-duty-hero__metric-unit">${escapeHtml(primaryMetric.secondary)}</span>` : ''}
                        </div>
                        <span class="analytics-duty-hero__metric-label">${escapeHtml(primaryItem?.metricLabel || '异常指标')}</span>
                    </div>
                    <div class="analytics-duty-hero__aside">
                        <div class="analytics-duty-hero__footer">
                            <button
                                type="button"
                                class="analytics-duty-hero__cta"
                                data-admin-action="analytics-open-destination"
                                data-analytics-destination="${escapeHtml(primaryItem?.destination || '')}"
                                data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(primaryItem?.context || null))}"
                            >${escapeHtml(primaryItem?.actionLabel || '打开对应模块')}</button>
                        </div>
                    </div>
                </div>
            </article>
            ${secondaryItems.length ? `
                <div class="analytics-duty-list" role="list" aria-label="待处理队列">
                    ${secondaryItems.map((item) => `
                        <article
                            class="analytics-duty-list-item analytics-duty-list-item--${escapeHtml(item?.tone || 'neutral')}"
                            role="listitem"
                        >
                            <div class="analytics-duty-list-item__top">
                                <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item?.tone || 'neutral')}">${escapeHtml(item?.level || '观察')}</span>
                                <span class="analytics-duty-list-item__panel">${escapeHtml(item?.panel || '经营异常')}</span>
                                <strong class="analytics-duty-list-item__metric">${escapeHtml(item?.metricValue || '--')}</strong>
                            </div>
                            <strong class="analytics-duty-list-item__title">${escapeHtml(item?.title || '经营异常')}</strong>
                            <div class="analytics-duty-list-item__summary">${escapeHtml(item?.meta || item?.summary || '建议打开对应模块继续处理')}</div>
                            <button
                                type="button"
                                class="analytics-duty-list-item__cta"
                                data-admin-action="analytics-open-destination"
                                data-analytics-destination="${escapeHtml(item?.destination || '')}"
                                data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item?.context || null))}"
                            >${escapeHtml(item?.actionLabel || '去处理')}<i class="fas fa-arrow-right"></i></button>
                        </article>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function splitAnalyticsDutyDisplayValue(rawValue = '--') {
    const value = String(rawValue ?? '--').trim();
    if (!value) {
        return { primary: '--', secondary: '' };
    }

    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
        return { primary: value, secondary: '' };
    }

    return {
        primary: parts.slice(0, -1).join(' '),
        secondary: parts[parts.length - 1]
    };
}

function renderAnalyticsBusinessAnomalyCards(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }

    return `
        <section class="ai-anomaly-board">
            <div class="ai-anomaly-board__header">
                <div>
                    <p class="ai-anomaly-board__eyebrow">经营异常</p>
                    <h4 class="ai-anomaly-board__title">当前窗口最值得先排查的业务风险</h4>
                </div>
                <span class="ai-anomaly-board__meta">${items.length} 个异常卡片</span>
            </div>
            ${renderAnalyticsAnomalyCardGrid(items)}
        </section>
    `;
}

function buildAnalyticsDutyBoardData(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const verifyMetrics = sourceData?.verify_service_summary?.metrics || sourceData?.verifyServiceSummary?.metrics || {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const operationsHealth = sourceData?.operations_health_snapshot || sourceData?.operationsHealthSnapshot || {};
    const operationsMetrics = operationsHealth?.metrics || {};
    const verifyFailedCount = normalizeAnalyticsCountValue(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsCountValue(verifyMetrics.activeCount);
    const verifyRequestCount = normalizeAnalyticsCountValue(verifyMetrics.requestCount);
    const verifySuccessRate = normalizeAnalyticsNumber(verifyMetrics.successRate);
    const paymentAlertTotal = normalizeAnalyticsCountValue(operationsMetrics.paymentAlertTotal);
    const paymentDeadLetterCount = normalizeAnalyticsCountValue(operationsMetrics.paymentDeadLetterCount);
    const paymentRetryCount = normalizeAnalyticsCountValue(operationsMetrics.paymentRetryCount);
    const ticketPendingCount = normalizeAnalyticsCountValue(operationsMetrics.ticketPendingCount);
    const ticketOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketOverdueCount);
    const ticketCriticalOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketCriticalOverdueCount);
    const ticketOldestWaitMinutes = normalizeAnalyticsCountValue(operationsMetrics.ticketOldestWaitMinutes);
    const guestbookMessageCount = normalizeAnalyticsCountValue(growthMetrics.guestbookMessageCount);
    const guestbookCommentCount = normalizeAnalyticsCountValue(growthMetrics.guestbookCommentCount);
    const guestbookReplyRate = normalizeAnalyticsNumber(growthMetrics.guestbookReplyRate);
    const verifyOpenCount = verifyFailedCount + verifyActiveCount;
    const guestbookPendingCount = Math.max(0, guestbookMessageCount - guestbookCommentCount);
    const stats = [
        {
            label: '验证待处理',
            value: `${formatNumber(verifyOpenCount)} 条`,
            detail: verifyRequestCount > 0
                ? `失败 ${formatNumber(verifyFailedCount)} / 处理中 ${formatNumber(verifyActiveCount)} / 完成率 ${formatPercent(verifySuccessRate)}`
                : '当前窗口暂无验证样本',
            tone: verifyOpenCount > 0
                ? getAnalyticsAIMetricTone(verifySuccessRate, { dangerBelow: 70, warningBelow: 85 })
                : (verifyRequestCount > 0 ? 'success' : 'neutral')
        },
        {
            label: '支付告警',
            value: `${formatNumber(paymentAlertTotal)} 条`,
            detail: paymentAlertTotal > 0 || paymentDeadLetterCount > 0 || paymentRetryCount > 0
                ? `死信 ${formatNumber(paymentDeadLetterCount)} / 重试 ${formatNumber(paymentRetryCount)}`
                : '当前窗口支付链路平稳',
            tone: paymentDeadLetterCount > 0 ? 'danger' : (paymentAlertTotal > 0 || paymentRetryCount > 0 ? 'warning' : 'success')
        },
        {
            label: ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0 ? '超时工单' : '待处理工单',
            value: `${formatNumber(ticketOverdueCount || ticketPendingCount)} 单`,
            detail: ticketPendingCount > 0 || ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0
                ? `待处理 ${formatNumber(ticketPendingCount)} / critical ${formatNumber(ticketCriticalOverdueCount)} / 最老 ${formatAnalyticsMinutesWindow(ticketOldestWaitMinutes)}`
                : '当前窗口暂无工单堆积',
            tone: ticketCriticalOverdueCount > 0 ? 'danger' : (ticketOverdueCount > 0 || ticketPendingCount >= 6 ? 'warning' : (ticketPendingCount > 0 ? 'accent' : 'success'))
        },
        {
            label: '社区待回',
            value: `${formatNumber(guestbookPendingCount)} 条`,
            detail: guestbookMessageCount > 0
                ? `发帖 ${formatNumber(guestbookMessageCount)} / 回复 ${formatNumber(guestbookCommentCount)} / 回复率 ${formatPercent(guestbookReplyRate)}`
                : '当前窗口暂无留言样本',
            tone: guestbookMessageCount > 0
                ? getAnalyticsAIMetricTone(guestbookReplyRate, { dangerBelow: 50, warningBelow: 80 })
                : 'neutral'
        }
    ];

    return {
        stats,
        items: buildAnalyticsBusinessAnomalyCardsData(sourceData, 4)
    };
}

function renderAnalyticsDutyBoard(view = {}) {
    const stats = Array.isArray(view?.stats) ? view.stats : [];
    const items = Array.isArray(view?.items) ? view.items : [];
    if (!stats.length && !items.length) {
        return renderHintState('fas fa-clipboard-list', '当前窗口暂无待处理数据');
    }

    const actionableCount = items.filter((item) => item?.tone !== 'success').length;

    return `
        <div class="analytics-duty-board">
            <div class="analytics-duty-board__summary">
                <div class="analytics-duty-stats">
                    ${stats.map((item) => `
                        ${(() => {
                            const valueParts = splitAnalyticsDutyDisplayValue(item.value || '--');
                            return `
                        <article class="analytics-duty-stat analytics-duty-stat--${escapeHtml(item.tone || 'neutral')}">
                            <div class="analytics-duty-stat__head">
                                <span class="analytics-duty-stat__label">${escapeHtml(item.label || '待处理项')}</span>
                            </div>
                            <div class="analytics-duty-stat__value-wrap">
                                <strong class="analytics-duty-stat__value">${escapeHtml(valueParts.primary)}</strong>
                                ${valueParts.secondary ? `<span class="analytics-duty-stat__unit">${escapeHtml(valueParts.secondary)}</span>` : ''}
                            </div>
                            <div class="analytics-duty-stat__detail">${escapeHtml(item.detail || '当前窗口暂无说明')}</div>
                        </article>
                    `;
                        })()}
                    `).join('')}
                </div>
            </div>
            <div class="analytics-duty-board__queue">
                <div class="analytics-duty-board__section">
                    <div class="analytics-duty-board__section-head">
                        <div>
                            <strong>优先排查队列</strong>
                            <p>${actionableCount > 0 ? `当前最值得先处理的 ${actionableCount} 项异常` : '当前窗口没有更高优先级异常，继续观察即可'}</p>
                        </div>
                        <span class="analytics-duty-board__section-meta">${items.length} 项</span>
                    </div>
                    ${renderAnalyticsDutyQueue(items)}
                </div>
            </div>
        </div>
    `;
}

function buildAnalyticsAIPulseSummaryData(data = null) {
    const sourceData = getAnalyticsAISourceData(data);
    const summarySource = sourceData?.summaryWindowData || sourceData || {};
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const overviewMetrics = sourceData?.overview_business_mix?.metrics || sourceData?.overviewBusinessMix?.metrics || {};
    const verifyMetrics = sourceData?.verify_service_summary?.metrics || sourceData?.verifyServiceSummary?.metrics || {};
    const growthMetrics = sourceData?.growth_summary?.metrics || sourceData?.growthSummary?.metrics || {};
    const commerceFunnel = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const growthFunnel = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};
    const unlockCount = normalizeAnalyticsNumber(overviewMetrics.unlockCount);
    const verifyRequestCount = normalizeAnalyticsNumber(overviewMetrics.verifyRequestCount || verifyMetrics.requestCount);
    const verifySuccessRate = normalizeAnalyticsNumber(overviewMetrics.verifySuccessRate || verifyMetrics.successRate);
    const verifyFailedCount = normalizeAnalyticsNumber(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsNumber(verifyMetrics.activeCount);
    const guestbookMessageCount = normalizeAnalyticsNumber(growthMetrics.guestbookMessageCount);
    const guestbookCommentCount = normalizeAnalyticsNumber(growthMetrics.guestbookCommentCount);
    const guestbookReplyRate = normalizeAnalyticsNumber(growthMetrics.guestbookReplyRate);
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerceFunnel.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const inviteClickUsers = normalizeAnalyticsCountValue(growthFunnel.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growthFunnel.checkin_success_users ?? eventOverview.checkin_success_users);
    const rewardPoints = normalizeAnalyticsNumber(overviewMetrics.rewardPoints);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);

    return [
        {
            label: '内容解锁',
            value: formatNumber(unlockCount),
            detail: unlockCount > 0 ? '当前窗口内容消费样本' : '当前窗口暂无内容消费样本',
            tone: unlockCount > 0 ? 'accent' : 'neutral'
        },
        {
            label: '验证成功率',
            value: verifyRequestCount > 0 ? formatPercent(verifySuccessRate) : '--',
            detail: verifyRequestCount > 0
                ? `失败 ${formatNumber(verifyFailedCount)} / 处理中 ${formatNumber(verifyActiveCount)}`
                : '当前窗口暂无验证样本',
            tone: verifyRequestCount > 0
                ? getAnalyticsAIMetricTone(verifySuccessRate, { dangerBelow: 70, warningBelow: 85 })
                : 'neutral'
        },
        {
            label: '充值成功率',
            value: rechargeClickUsers > 0 ? formatPercent(rechargeSuccessRate) : '--',
            detail: rechargeClickUsers > 0
                ? `点击 ${formatNumber(rechargeClickUsers)} / 成功 ${formatNumber(rechargeSuccessUsers)}`
                : '当前窗口暂无充值链路样本',
            tone: rechargeClickUsers > 0
                ? getAnalyticsAIMetricTone(rechargeSuccessRate, { dangerBelow: 40, warningBelow: 60 })
                : 'neutral'
        },
        {
            label: '留言回复率',
            value: guestbookMessageCount > 0 ? formatPercent(guestbookReplyRate) : '--',
            detail: guestbookMessageCount > 0
                ? `发帖 ${formatNumber(guestbookMessageCount)} / 回复 ${formatNumber(guestbookCommentCount)}`
                : '当前窗口暂无留言样本',
            tone: guestbookMessageCount > 0
                ? getAnalyticsAIMetricTone(guestbookReplyRate, { dangerBelow: 50, warningBelow: 80 })
                : 'neutral'
        },
        {
            label: '激励投放',
            value: formatNumber(rewardPoints || (referralRewardPoints + checkinRewardPoints)),
            detail: `返佣/拉新 ${formatNumber(referralRewardPoints)} / 邀请 ${formatNumber(inviteClickUsers)} / 签到 ${formatNumber(checkinSuccessUsers)}`,
            tone: rewardPoints > 0 || referralRewardPoints > 0 || checkinRewardPoints > 0
                ? 'warning'
                : 'neutral'
        }
    ];
}

const ANALYTICS_EXPERIMENT_METRIC_DEFINITIONS = [
    { value: 'verify_success', label: '验证成功', mode: 'business' },
    { value: 'recharge_success', label: '充值成功', mode: 'business' },
    { value: 'shop_purchase', label: '商城成交', mode: 'business' },
    { value: 'unlock_success', label: '内容解锁', mode: 'business' },
    { value: 'affiliate_invite_click', label: '邀请点击', mode: 'business' },
    { value: 'checkin_success', label: '签到完成', mode: 'business' },
    { value: 'guestbook_post', label: '留言发布', mode: 'business' },
    { value: 'verify_submit', label: '验证提交', mode: 'business' },
    { value: 'recharge_click', label: '充值点击', mode: 'business' },
    { value: 'shop_view', label: '商城浏览', mode: 'business' },
    { value: 'prompt_view', label: '内容浏览', mode: 'business' },
    { value: 'page_view', label: '页面浏览量', mode: 'legacy' },
    { value: 'button_click', label: '按钮点击', mode: 'legacy' },
    { value: 'signup', label: '注册转化', mode: 'legacy' },
    { value: 'purchase', label: '购买转化', mode: 'legacy' },
    { value: 'engagement', label: '互动参与', mode: 'legacy' }
];

function getAnalyticsExperimentMetricDefinition(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return ANALYTICS_EXPERIMENT_METRIC_DEFINITIONS.find((item) => item.value === normalized) || null;
}

function normalizeAnalyticsExperimentTargetMetric(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return getAnalyticsExperimentMetricDefinition(normalized)?.value || 'engagement';
}

function getAnalyticsExperimentTargetMetricLabel(value = '') {
    return getAnalyticsExperimentMetricDefinition(value)?.label || '互动参与';
}

function getAnalyticsExperimentTargetMetricMode(value = '') {
    return getAnalyticsExperimentMetricDefinition(value)?.mode || 'legacy';
}

function buildAnalyticsExperimentTemplate(payload = {}) {
    const normalizedMetric = normalizeAnalyticsExperimentTargetMetric(payload.targetMetric);
    const variants = Array.isArray(payload.variants) && payload.variants.length > 0
        ? payload.variants.map((variant, index) => ({
            name: String(variant?.name || `Variant ${index + 1}`).trim() || `Variant ${index + 1}`,
            weight: normalizeAnalyticsCountValue(variant?.weight || 0)
        }))
        : [
            { name: 'Control', weight: 50 },
            { name: 'Variant A', weight: 50 }
        ];

    return {
        name: String(payload.name || '').trim(),
        description: String(payload.description || '').trim(),
        targetMetric: normalizedMetric,
        targetMetricLabel: getAnalyticsExperimentTargetMetricLabel(normalizedMetric),
        site: String(payload.site || '').trim().toLowerCase(),
        variants
    };
}

function buildAnalyticsExperimentSuggestionsData(data = null, limit = 3) {
    const sourceData = getAnalyticsAISourceData(data);
    const siteComparisonData = sourceData?.site_comparison || sourceData?.siteComparisonData || null;
    if (siteComparisonData?.mode !== 'compare' || !siteComparisonData.focusSnapshot) {
        return [];
    }

    const focusSite = String(siteComparisonData.focusSite || '').trim().toLowerCase();
    const focusLabel = siteComparisonData.focusLabel || getAnalyticsSiteLabel(focusSite);
    const focusSnapshot = siteComparisonData.focusSnapshot || {};
    const topGap = siteComparisonData.topGap || {};
    const topChannelName = focusSnapshot.topChannel?.name || '主入口';
    const topCategoryName = focusSnapshot.topCategory?.name || '重点分类';
    const topPromptTitle = focusSnapshot.topContent?.title || '当前热门 Prompt';
    const suggestions = [];

    if (topGap.key === 'verifySuccessRate') {
        const template = buildAnalyticsExperimentTemplate({
            name: `${focusLabel} 验证入口承接实验`,
            description: `${focusLabel} 当前验证成功率落后，建议围绕 ${topChannelName} 入口的说明文案、预期结果和失败兜底提示做 A/B，对照验证提交后的继续率。`,
            targetMetric: 'verify_success',
            site: focusSite,
            variants: [
                { name: 'Control', weight: 50 },
                { name: '强化说明版', weight: 50 }
            ]
        });
        suggestions.push({
            tone: Math.abs(normalizeAnalyticsNumber(topGap.diff)) >= 20 ? 'warning' : 'accent',
            level: '建议实验',
            siteLabel: focusLabel,
            title: `${focusLabel} 验证链路承接实验`,
            experimentLabel: `${topChannelName} 入口文案 / 失败兜底`,
            targetMetricLabel: template.targetMetricLabel,
            summary: `优先在 ${focusLabel} 对 ${topChannelName} 入口做验证前说明和失败兜底的对照实验，目标先把 ${topGap.label} 拉回到更接近另一站的水平。`,
            actionLabel: '预填 A/B 实验',
            action: 'analytics-open-experiment-modal',
            icon: 'fas fa-flask',
            context: template,
            sampleLabel: '站点实验线索',
            sampleItems: siteComparisonData.insights?.slice(0, 3) || []
        });
    }

    if (topGap.key === 'rechargeSuccessRate' || topGap.key === 'shopPurchaseRate') {
        const template = buildAnalyticsExperimentTemplate({
            name: `${focusLabel} 交易承接实验`,
            description: `${focusLabel} 当前交易转化落后，建议围绕 ${topChannelName} 入口和 ${topCategoryName} 内容后的权益提示做 A/B，对照充值或商城成交转化。`,
            targetMetric: topGap.key === 'shopPurchaseRate' ? 'shop_purchase' : 'recharge_success',
            site: focusSite,
            variants: [
                { name: 'Control', weight: 50 },
                { name: '强化权益版', weight: 50 }
            ]
        });
        suggestions.push({
            tone: Math.abs(normalizeAnalyticsNumber(topGap.diff)) >= 20 ? 'warning' : 'accent',
            level: '建议实验',
            siteLabel: focusLabel,
            title: `${focusLabel} 交易转化承接实验`,
            experimentLabel: `${topChannelName} 入口权益 / 钱包提示`,
            targetMetricLabel: template.targetMetricLabel,
            summary: `建议在 ${focusLabel} 对 ${topChannelName} 入口后的钱包提示或商城权益做对照实验，先验证能否提升 ${topGap.label}。`,
            actionLabel: '预填 A/B 实验',
            action: 'analytics-open-experiment-modal',
            icon: 'fas fa-flask',
            context: template,
            sampleLabel: '站点实验线索',
            sampleItems: siteComparisonData.insights?.slice(0, 3) || []
        });
    }

    const categoryTemplate = buildAnalyticsExperimentTemplate({
        name: `${focusLabel} ${topCategoryName} 内容包装实验`,
        description: `${focusLabel} 当前热度更集中在 ${topCategoryName}，建议围绕《${topPromptTitle}》同类内容的标题、封面或权益描述做 A/B，观察互动和消费承接是否提升。`,
        targetMetric: 'unlock_success',
        site: focusSite,
        variants: [
            { name: 'Control', weight: 50 },
            { name: '高意图包装版', weight: 50 }
        ]
    });
    suggestions.push({
        tone: 'accent',
        level: '持续实验',
        siteLabel: focusLabel,
        title: `${focusLabel} 分类内容包装实验`,
        experimentLabel: `${topCategoryName} 分类 / 《${truncateAnalyticsSnippet(topPromptTitle, 18)}》`,
        targetMetricLabel: categoryTemplate.targetMetricLabel,
        summary: `建议拿 ${focusLabel} 当前最热的 ${topCategoryName} 分类做包装实验，优先验证标题、封面和权益描述是否能带来更高互动或解锁承接。`,
        actionLabel: '预填 A/B 实验',
        action: 'analytics-open-experiment-modal',
        icon: 'fas fa-flask',
        context: categoryTemplate,
        sampleLabel: '内容实验线索',
        sampleItems: [
            `${focusLabel} 当前主要入口 ${topChannelName}`,
            `${focusLabel} 热门分类 ${topCategoryName}`,
            `${focusLabel} 热门 Prompt 《${truncateAnalyticsSnippet(topPromptTitle, 22)}》`
        ]
    });

    return suggestions.slice(0, limit);
}

function buildAnalyticsAIActionCardsData(data = null, limit = 6) {
    const sourceData = getAnalyticsAISourceData(data);

    const deduped = [];
    const seen = new Set();
    const rawItems = collectAnalyticsActionRecommendations(sourceData)
        .filter((item) => item.destination || item.actionLabel || item.title)
        .sort((left, right) => getAnalyticsActionPriority(left.level) - getAnalyticsActionPriority(right.level));

    rawItems.forEach((item) => {
        const dedupeKey = [item.destination || '', item.actionLabel || '', item.title || ''].join('::');
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        deduped.push(item);
    });

    const normalizedItems = deduped.slice(0, limit).map((item) => {
        const destinationMeta = getAnalyticsDestinationMeta(item.destination, item.panel);
        const groupMeta = getAnalyticsActionGroupMeta(item.level);
        return {
            ...item,
            groupKey: groupMeta.key,
            groupTitle: groupMeta.title,
            groupDescription: groupMeta.description,
            icon: item.icon || destinationMeta.icon,
            ctaLabel: item.actionLabel || destinationMeta.ctaLabel,
            context: parseAnalyticsActionContext(item.context || item.destinationContext || null)
        };
    });

    const fallbackItems = normalizedItems.length > 0 ? normalizedItems : [{
        panel: '总览',
        tone: 'success',
        level: '继续观察',
        title: '回到经营总览',
        summary: '当前没有更高优先级的异常，可以继续查看内容消费、验证和激励链路的联动变化。',
        actionLabel: '查看总览',
        destination: 'analytics-overview',
        icon: 'fas fa-compass-drafting',
        ctaLabel: '打开经营总览',
        groupKey: 'observe',
        groupTitle: '持续观察',
        groupDescription: '作为经营驾驶舱观察项持续看趋势即可'
    }];

    const groups = ['urgent', 'followup', 'observe'].map((key) => {
        const items = fallbackItems.filter((item) => item.groupKey === key);
        if (!items.length) return null;

        return {
            key,
            title: items[0].groupTitle,
            description: items[0].groupDescription,
            items
        };
    }).filter(Boolean);

    return {
        items: fallbackItems,
        groups,
        pulseSummary: buildAnalyticsAIPulseSummaryData(sourceData)
    };
}

function renderAnalyticsExperimentSuggestions(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }

    return `
        <section class="ai-experiment-board">
            <div class="ai-experiment-board__header">
                <div>
                    <p class="ai-experiment-board__eyebrow">实验建议</p>
                    <h4 class="ai-experiment-board__title">按站点、入口和分类生成的可执行 A/B 假设</h4>
                </div>
                <span class="ai-experiment-board__meta">${items.length} 个候选实验</span>
            </div>
            <div class="ai-experiment-grid">
                ${items.map((item) => `
                    <button
                        type="button"
                        class="ai-experiment-card ai-experiment-card--${escapeHtml(item.tone || 'accent')}"
                        data-admin-action="${escapeHtml(item.action || 'analytics-open-experiment-modal')}"
                        data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item.context || null))}"
                    >
                        <div class="ai-experiment-card__top">
                            <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone || 'accent')}">${escapeHtml(item.level || '建议实验')}</span>
                            <span class="ai-experiment-card__site">${escapeHtml(item.siteLabel || '站点')}</span>
                        </div>
                        <strong class="ai-experiment-card__title">${escapeHtml(item.title || '实验建议')}</strong>
                        <div class="ai-experiment-card__meta">
                            <span>${escapeHtml(item.experimentLabel || '实验方向')}</span>
                            <span>${escapeHtml(item.targetMetricLabel || '目标指标')}</span>
                        </div>
                        <div class="ai-experiment-card__summary">${escapeHtml(item.summary || '建议在对应链路上创建 A/B 实验')}</div>
                        ${Array.isArray(item.sampleItems) && item.sampleItems.length ? `
                            <div class="ai-experiment-card__samples">
                                <span class="ai-experiment-card__sample-label">${escapeHtml(item.sampleLabel || '实验线索')}</span>
                                <div class="ai-experiment-card__sample-list">
                                    ${item.sampleItems.slice(0, 3).map((sample) => `
                                        <span class="ai-experiment-card__sample-pill">${escapeHtml(sample)}</span>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                        <span class="ai-experiment-card__cta">${escapeHtml(item.actionLabel || '预填 A/B 实验')}<i class="fas fa-arrow-right"></i></span>
                    </button>
                `).join('')}
            </div>
        </section>
    `;
}

function renderAnalyticsAIPulseSummary(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }

    return `
        <section class="ai-pulse-board">
            <div class="ai-pulse-board__header">
                <div>
                    <p class="ai-pulse-board__eyebrow">经营快照</p>
                    <h4 class="ai-pulse-board__title">当前窗口最值得先看的关键指标</h4>
                </div>
            </div>
            <div class="ai-pulse-grid">
                ${items.map((item) => `
                    <article class="ai-pulse-card ai-pulse-card--${escapeHtml(item.tone || 'neutral')}">
                        <span class="ai-pulse-card__label">${escapeHtml(item.label || '指标')}</span>
                        <strong class="ai-pulse-card__value">${escapeHtml(item.value || '--')}</strong>
                        <span class="ai-pulse-card__detail">${escapeHtml(item.detail || '暂无补充说明')}</span>
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function renderAnalyticsAIActionCards(actionData = {}) {
    const groups = Array.isArray(actionData?.groups) ? actionData.groups : [];
    const flatItems = Array.isArray(actionData?.items) ? actionData.items : [];
    if (!groups.length && !flatItems.length) {
        return '';
    }

    return `
        <section class="ai-action-rail">
            <div class="ai-action-rail__header">
                <div>
                    <p class="ai-action-rail__eyebrow">建议动作</p>
                    <h4 class="ai-action-rail__title">按优先级排序的后台处理入口</h4>
                </div>
                <span class="ai-action-rail__meta">${flatItems.length} 个高相关入口</span>
            </div>
            <div class="ai-action-group-list">
                ${groups.map((group) => `
                    <section class="ai-action-group ai-action-group--${escapeHtml(group.key || 'observe')}">
                        <div class="ai-action-group__header">
                            <div>
                                <h5 class="ai-action-group__title">${escapeHtml(group.title || '建议动作')}</h5>
                                <p class="ai-action-group__desc">${escapeHtml(group.description || '建议进入对应模块继续处理')}</p>
                            </div>
                            <span class="ai-action-group__count">${group.items.length} 项</span>
                        </div>
                        <div class="ai-action-card-grid">
                            ${group.items.map((item) => `
                                <button
                                    type="button"
                                    class="ai-action-card"
                                    data-admin-action="analytics-open-destination"
                                    data-analytics-destination="${escapeHtml(item.destination || '')}"
                                    data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item.context || null))}"
                                >
                                    <div class="ai-action-card__top">
                                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone || 'neutral')}">${escapeHtml(item.level || '观察')}</span>
                                        <span class="ai-action-card__panel">${escapeHtml(item.panel || '总览')}</span>
                                    </div>
                                    <div class="ai-action-card__headline">
                                        <i class="${escapeHtml(item.icon || 'fas fa-arrow-right')}"></i>
                                        <strong>${escapeHtml(item.actionLabel || item.title || '打开模块')}</strong>
                                    </div>
                                    <div class="ai-action-card__summary">${escapeHtml(item.summary || '建议进入对应模块继续处理。')}</div>
                                    ${Array.isArray(item.sampleItems) && item.sampleItems.length ? `
                                        <div class="ai-action-card__samples">
                                            <span class="ai-action-card__sample-label">${escapeHtml(item.sampleLabel || '样本线索')}</span>
                                            <div class="ai-action-card__sample-list">
                                                ${item.sampleItems.slice(0, 3).map((sample) => `
                                                    <span class="ai-action-card__sample-pill">${escapeHtml(sample)}</span>
                                                `).join('')}
                                            </div>
                                        </div>
                                    ` : ''}
                                    <span class="ai-action-card__cta">${escapeHtml(item.ctaLabel || '打开对应模块')}<i class="fas fa-arrow-right"></i></span>
                                </button>
                            `).join('')}
                        </div>
                    </section>
                `).join('')}
            </div>
        </section>
    `;
}

function getAnalyticsInsightCacheReport(cacheValue = aiInsightCache) {
    if (cacheValue && typeof cacheValue === 'object') {
        return String(cacheValue.report || '').trim();
    }

    return String(cacheValue || '').trim();
}

function getAnalyticsInsightCacheSummary(cacheValue = aiInsightCache) {
    return cacheValue && typeof cacheValue === 'object'
        ? cacheValue.summaryData || null
        : null;
}

function renderAIInsightMarkup(reportText, options = {}) {
    const {
        hintHtml = '',
        summaryData = null
    } = options;
    const normalizedReport = String(reportText || '').trim();
    const actionData = buildAnalyticsAIActionCardsData(summaryData);
    const anomalyCards = buildAnalyticsBusinessAnomalyCardsData(summaryData);
    const experimentSuggestions = buildAnalyticsExperimentSuggestionsData(summaryData);
    const pulseMarkup = renderAnalyticsAIPulseSummary(actionData.pulseSummary);
    const siteComparisonMarkup = renderAnalyticsAISiteComparison(summaryData?.site_comparison || summaryData?.siteComparisonData || null);
    const anomalyMarkup = renderAnalyticsBusinessAnomalyCards(anomalyCards);
    const experimentMarkup = renderAnalyticsExperimentSuggestions(experimentSuggestions);
    const cardsMarkup = renderAnalyticsAIActionCards(actionData);

    return `
        <div class="ai-insight-layout">
            ${normalizedReport ? `<div class="ai-report">${formatAIResponse(normalizedReport)}</div>` : ''}
            ${pulseMarkup}
            ${siteComparisonMarkup}
            ${anomalyMarkup}
            ${experimentMarkup}
            ${cardsMarkup}
            ${hintHtml}
        </div>
    `;
}

function buildLocalAnalyticsInsight(data) {
    const overview = data?.overview || {};
    const summarySource = data?.summaryWindowData || data || {};
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summarySource);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summarySource);
    const dau = normalizeAnalyticsNumber(overview.dau);
    const mau = normalizeAnalyticsNumber(overview.mau);
    const newUsers = normalizeAnalyticsNumber(overview.new_users_week);
    const totalPoints = normalizeAnalyticsNumber(overview.total_points);
    const totalComments = normalizeAnalyticsNumber(overview.total_comments);
    const dauMauRatio = mau > 0 ? (dau / mau) * 100 : 0;
    const overviewBusinessMix = data?.overview_business_mix || data?.overviewBusinessMix || {};
    const verifyServiceSummary = data?.verify_service_summary || data?.verifyServiceSummary || {};
    const growthSummary = data?.growth_summary || data?.growthSummary || {};
    const operationsHealthSnapshot = data?.operations_health_snapshot || data?.operationsHealthSnapshot || {};
    const overviewMetrics = overviewBusinessMix.metrics || {};
    const verifyMetrics = verifyServiceSummary.metrics || {};
    const growthMetrics = growthSummary.metrics || {};
    const operationsMetrics = operationsHealthSnapshot.metrics || {};
    const siteComparisonData = data?.site_comparison || data?.siteComparisonData || null;
    const commerceFunnel = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const growthFunnel = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};
    const unlockCount = normalizeAnalyticsNumber(overviewMetrics.unlockCount);
    const verifyRequestCount = normalizeAnalyticsNumber(overviewMetrics.verifyRequestCount || verifyMetrics.requestCount);
    const verifySuccessRate = normalizeAnalyticsNumber(overviewMetrics.verifySuccessRate || verifyMetrics.successRate);
    const rewardPoints = normalizeAnalyticsNumber(overviewMetrics.rewardPoints);
    const communityInteractionCount = normalizeAnalyticsNumber(overviewMetrics.communityInteractionCount);
    const verifyFailedCount = normalizeAnalyticsNumber(verifyMetrics.failedCount);
    const verifyActiveCount = normalizeAnalyticsNumber(verifyMetrics.activeCount);
    const verifyAvgPointsCost = normalizeAnalyticsNumber(verifyMetrics.avgPointsCostPerSuccess);
    const guestbookReplyRate = normalizeAnalyticsNumber(growthMetrics.guestbookReplyRate);
    const referralRewardPoints = normalizeAnalyticsNumber(growthMetrics.referralRewardPoints);
    const checkinRewardPoints = normalizeAnalyticsNumber(growthMetrics.checkinRewardPoints);
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerceFunnel.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerceFunnel.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerceFunnel.shop_purchase_users ?? eventOverview.shop_purchase_users);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerceFunnel.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);
    const inviteClickUsers = normalizeAnalyticsCountValue(growthFunnel.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growthFunnel.checkin_success_users ?? eventOverview.checkin_success_users);
    const paymentAlertTotal = normalizeAnalyticsCountValue(operationsMetrics.paymentAlertTotal);
    const paymentDeadLetterCount = normalizeAnalyticsCountValue(operationsMetrics.paymentDeadLetterCount);
    const ticketOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketOverdueCount);
    const ticketCriticalOverdueCount = normalizeAnalyticsCountValue(operationsMetrics.ticketCriticalOverdueCount);
    const ticketOldestWaitMinutes = normalizeAnalyticsCountValue(operationsMetrics.ticketOldestWaitMinutes);
    const actionRecommendations = collectAnalyticsActionRecommendations(data);
    const anomalyCards = buildAnalyticsBusinessAnomalyCardsData(data, 4);
    const experimentSuggestions = buildAnalyticsExperimentSuggestionsData(data, 2);

    const trendRows = Array.isArray(data?.user_trend) ? data.user_trend : [];
    const trendValues = trendRows
        .map((item) => normalizeAnalyticsNumber(item?.new_users ?? item?.dau ?? item?.user_count ?? item?.value))
        .filter((value) => Number.isFinite(value));
    const recentWindow = trendValues.slice(-3);
    const previousWindow = trendValues.slice(-6, -3);
    const recentAvg = averageAnalyticsValues(recentWindow);
    const previousAvg = averageAnalyticsValues(previousWindow);
    const trendDelta = recentAvg - previousAvg;

    const channels = (Array.isArray(data?.channel_breakdown) ? data.channel_breakdown : [])
        .map((item) => {
            const numericKeys = ['user_count', 'count', 'orders', 'value', 'total', 'total_amount'];
            const volume = numericKeys
                .map((key) => normalizeAnalyticsNumber(item?.[key]))
                .find((value) => value > 0) || 0;
            return {
                name: String(item?.channel || item?.name || item?.source || '未知渠道'),
                volume
            };
        })
        .sort((left, right) => right.volume - left.volume);

    const channelTotal = channels.reduce((sum, item) => sum + item.volume, 0);
    const topChannel = channels[0] || null;
    const topChannelShare = topChannel && channelTotal > 0
        ? (topChannel.volume / channelTotal) * 100
        : 0;

    const highlights = [];
    if (dauMauRatio >= 20) {
        highlights.push(`- DAU/MAU 约 ${dauMauRatio.toFixed(1)}%，近期活跃度表现稳健。`);
    } else if (dau > 0 || mau > 0) {
        highlights.push(`- 当前 DAU ${dau}、MAU ${mau}，活跃基础仍在持续累积。`);
    }
    if (newUsers > 0) {
        highlights.push(`- 最近 7 天新增用户 ${newUsers} 人，仍有持续拉新能力。`);
    }
    if (trendValues.length >= 6) {
        const trendText = trendDelta >= 0
            ? `近 3 天均值较前一阶段提升约 ${Math.abs(trendDelta).toFixed(1)}`
            : `近 3 天均值较前一阶段回落约 ${Math.abs(trendDelta).toFixed(1)}`;
        highlights.push(`- 用户趋势显示 ${trendText}。`);
    }
    if (topChannel && topChannel.volume > 0) {
        highlights.push(`- 当前主要渠道为 ${topChannel.name}，占样本约 ${topChannelShare.toFixed(1)}%。`);
    }
    if (unlockCount > 0 || verifyRequestCount > 0) {
        highlights.push(`- 当前窗口内容解锁 ${unlockCount} 次、验证请求 ${verifyRequestCount} 次，核心经营链路已有真实消费样本。`);
    }
    if (rechargeClickUsers > 0) {
        highlights.push(`- 真实交易链路中充值成功率约 ${rechargeSuccessRate.toFixed(1)}%，商城成交率约 ${shopPurchaseRate.toFixed(1)}%。`);
    }
    if (verifyRequestCount > 0 && verifySuccessRate >= 85) {
        highlights.push(`- 验证成功率约 ${verifySuccessRate.toFixed(1)}%，验证服务主链路整体稳定。`);
    }
    if (communityInteractionCount > 0 || referralRewardPoints > 0 || inviteClickUsers > 0 || checkinSuccessUsers > 0) {
        highlights.push(`- 社区互动 ${communityInteractionCount} 次，邀请点击 ${inviteClickUsers} 次，签到成功 ${checkinSuccessUsers} 次，增长动作已经开始形成真实承接。`);
    }
    if (siteComparisonData?.mode === 'compare' && Array.isArray(siteComparisonData.insights) && siteComparisonData.insights.length > 0) {
        highlights.push(`- 分站对比显示当前更值得优先关注 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.focusSite)}，主要差异在 ${siteComparisonData.insights[0] || '核心转化链路'}。`);
    }
    if (siteComparisonData?.focusSnapshot?.topChannel?.name || siteComparisonData?.focusSnapshot?.topCategory?.name) {
        highlights.push(`- ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.focusSite)} 当前主要入口是 ${siteComparisonData.focusSnapshot?.topChannel?.name || '待补充'}，内容热度更集中在 ${siteComparisonData.focusSnapshot?.topCategory?.name || '待补充'}。`);
    }
    if (paymentAlertTotal === 0 && ticketOverdueCount === 0 && ticketCriticalOverdueCount === 0) {
        highlights.push('- 支付异常和工单超时当前都比较平稳，运营侧暂时没有明显堆积。');
    }
    if (!highlights.length) {
        highlights.push('- 当前统计样本较少，建议继续观察近 7 天的真实行为数据。');
    }

    const risks = [];
    if (mau > 0 && dauMauRatio < 12) {
        risks.push('- DAU/MAU 偏低，短期活跃留存还有提升空间。');
    }
    if (trendValues.length >= 6 && trendDelta < 0) {
        risks.push('- 最近 3 天新增/活跃趋势走弱，需要关注拉新效率是否下滑。');
    }
    if (topChannelShare >= 65) {
        risks.push(`- 渠道流量过度依赖 ${topChannel?.name}，波动风险偏高。`);
    }
    if (totalComments <= 0) {
        risks.push('- 评论互动偏少，社区反馈数据不足。');
    }
    if (verifyRequestCount > 0 && verifySuccessRate < 85) {
        risks.push(`- 验证成功率只有 ${verifySuccessRate.toFixed(1)}%，需要优先排查失败任务、额度或接口稳定性。`);
    }
    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        risks.push(`- 充值点击 ${rechargeClickUsers} 人但成功只有 ${rechargeSuccessUsers} 人，交易链路转化仍偏低。`);
    }
    if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        risks.push(`- 商城浏览 ${shopViewUsers} 人但成交率约 ${shopPurchaseRate.toFixed(1)}%，消费承接还有明显流失。`);
    }
    if (verifyActiveCount > 0 || verifyFailedCount > 0) {
        risks.push(`- 当前仍有 ${verifyActiveCount + verifyFailedCount} 条处理中/失败验证任务，可能影响付费体验。`);
    }
    if (rewardPoints > 0 && unlockCount <= 0) {
        risks.push('- 激励积分已经投放，但内容消费承接偏弱，需要警惕只发补贴不转化。');
    }
    if (growthMetrics.guestbookMessageCount > 0 && guestbookReplyRate < 80) {
        risks.push(`- 留言板回复率约 ${guestbookReplyRate.toFixed(1)}%，社区承接仍有缺口。`);
    }
    if (paymentDeadLetterCount > 0 || paymentAlertTotal > 0) {
        risks.push(`- 支付侧当前仍有 ${paymentAlertTotal} 条告警，死信 ${paymentDeadLetterCount} 条，需要尽快收口。`);
    }
    if (ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0) {
        risks.push(`- 工单侧已有 ${ticketOverdueCount} 单超时、critical ${ticketCriticalOverdueCount} 单，最老等待约 ${formatAnalyticsMinutesWindow(ticketOldestWaitMinutes)}。`);
    }
    if (siteComparisonData?.mode === 'compare' && siteComparisonData.topGap?.focusSite && Math.abs(normalizeAnalyticsNumber(siteComparisonData.topGap.diff)) >= 12) {
        risks.push(`- 分站差异明显，${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.topGap.focusSite)} 在 ${siteComparisonData.topGap.label} 上落后约 ${trimTrailingZeros(Math.abs(siteComparisonData.topGap.diff).toFixed(1))} 个百分点。`);
    }
    if (!risks.length) {
        risks.push('- 当前未发现明显异常，建议继续监控流量结构和留存波动。');
    }

    const suggestions = [];
    if (topChannelShare >= 65) {
        suggestions.push('- 增加第二增长渠道投放，降低单一渠道依赖。');
    } else {
        suggestions.push('- 对表现最好的渠道继续做素材复盘，放大稳定来源。');
    }
    if (dauMauRatio < 20) {
        suggestions.push('- 针对近 7 天新增用户做签到、提醒或权益触达，提升次日留存。');
    } else {
        suggestions.push('- 可以把活跃用户转化到评论、签到或积分任务，提升复访深度。');
    }
    if (rechargeClickUsers >= 3 && rechargeSuccessRate < 60) {
        suggestions.push('- 优先检查支付告警队列和充值成功链路，把真实点击后的支付损耗先收口。');
    } else if (shopViewUsers >= 5 && shopPurchaseRate < 18) {
        suggestions.push('- 重点复核商城套餐、权益和积分承接，让充值后的用户更顺滑地完成成交。');
    }
    if (totalPoints > 0) {
        suggestions.push('- 联动积分消费与内容解锁活动，提升积分流通和转化。');
    } else {
        suggestions.push('- 先补齐积分或互动活动数据，后续 AI 分析会更稳定。');
    }
    if (verifyRequestCount > 0 && verifySuccessRate < 85) {
        suggestions.push('- 优先查看 Verify Monitor 和 Google One 配置，先把验证成功率拉回稳定区间。');
    }
    if (referralRewardPoints > 0 || checkinRewardPoints > 0) {
        suggestions.push('- 把返佣、拉新、签到奖励和后续消费联动分析，确认补贴是否真正带来解锁或验证转化。');
    }
    if (verifyAvgPointsCost > 0) {
        suggestions.push(`- 继续跟踪验证单次成功成本，目前约 ${verifyAvgPointsCost.toFixed(1)} 积分，避免服务成本侵蚀利润。`);
    }
    if (paymentAlertTotal > 0) {
        suggestions.push('- 支付告警队列先做一轮清队，优先处理死信和重复重试，避免订单异常长期挂起。');
    }
    if (ticketOverdueCount > 0 || ticketCriticalOverdueCount > 0) {
        suggestions.push('- 工单队列建议优先处理超时与 critical 项，再复核未指派和高优先任务。');
    }
    if (siteComparisonData?.mode === 'compare' && siteComparisonData.topGap?.focusSite && Math.abs(normalizeAnalyticsNumber(siteComparisonData.topGap.diff)) >= 12) {
        suggestions.push(`- 把 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.topGap.focusSite)} 站点作为本轮优先收口对象，先修复 ${siteComparisonData.topGap.label} 这条落后链路。`);
    }
    if (siteComparisonData?.focusSnapshot?.topChannel?.name || siteComparisonData?.focusSnapshot?.topContent?.title) {
        suggestions.push(`- 优先复盘 ${siteComparisonData.focusLabel || getAnalyticsSiteLabel(siteComparisonData.focusSite)} 的 ${siteComparisonData.focusSnapshot?.topChannel?.name || '主要入口'} 和《${siteComparisonData.focusSnapshot?.topContent?.title || '当前热门 Prompt'}》承接，确认入口和内容是否匹配。`);
    }

    const priorityActions = anomalyCards.length > 0
        ? anomalyCards
            .slice(0, 2)
            .map((item) => `- ${item.actionLabel || item.title}：${item.summary || '建议优先排查。'}`)
        : (actionRecommendations.length > 0
            ? actionRecommendations
                .slice(0, 2)
                .map((item) => `- ${item.actionLabel || item.title}：${item.summary || '建议优先排查。'}`)
            : ['- Analytics 总览：继续观察经营主线、验证和社区裂变的联动变化。']);

    const experimentLines = experimentSuggestions.length > 0
        ? experimentSuggestions
            .slice(0, 2)
            .map((item) => `- ${item.title}：${item.summary || '建议在对应链路上做 A/B 验证。'}`)
        : ['- 当前窗口暂无高置信度实验建议，可先继续观察分站差异。'];

    return [
        '1. 数据亮点',
        ...highlights.slice(0, 3),
        '',
        '2. 潜在风险',
        ...risks.slice(0, 2),
        '',
        '3. 运营建议',
        ...suggestions.slice(0, 3),
        '',
        '4. 建议优先查看的后台入口',
        ...priorityActions,
        '',
        '5. 建议优先尝试的实验',
        ...experimentLines
    ].join('\n');
}

function buildLocalPrediction(values, horizon = 7) {
    const series = (Array.isArray(values) ? values : [])
        .map((value) => Math.max(0, Math.round(normalizeAnalyticsNumber(value))))
        .filter((value) => Number.isFinite(value));

    if (!series.length) {
        return Array.from({ length: horizon }, () => 0);
    }

    const recentWindow = series.slice(-7);
    const base = recentWindow[recentWindow.length - 1] * 0.55 + averageAnalyticsValues(recentWindow) * 0.45;
    const earlierWindow = recentWindow.slice(0, Math.max(1, Math.floor(recentWindow.length / 2)));
    const laterWindow = recentWindow.slice(Math.max(1, Math.floor(recentWindow.length / 2)));
    const rawSlope = averageAnalyticsValues(laterWindow) - averageAnalyticsValues(earlierWindow);
    const normalizedSlope = Math.abs(rawSlope) > base ? Math.sign(rawSlope) * Math.max(1, Math.round(base * 0.18)) : rawSlope;

    return Array.from({ length: horizon }, (_, index) => {
        const drift = normalizedSlope * ((index + 1) / Math.max(2, recentWindow.length));
        return Math.max(0, Math.round(base + drift));
    });
}

function renderPredictionMarkup(predictions, note = '') {
    return `
        <div class="prediction-result">
            <p><strong>未来7天预测:</strong></p>
            <div class="prediction-values">
                ${predictions.map((value, index) => `<span class="pred-day">D${index + 1}: ${value}</span>`).join('')}
            </div>
            ${note ? buildQuotaFallbackHint(note) : ''}
        </div>
    `;
}

function renderAnalyticsExperimentVariantRows(variants = null) {
    const normalizedVariants = Array.isArray(variants) && variants.length > 0
        ? variants
        : [
            { name: 'Control', weight: 50 },
            { name: 'Variant A', weight: 50 }
        ];

    return normalizedVariants.map((variant, index) => `
        <div class="variant-row">
            <input type="text" placeholder="Variant ${String.fromCharCode(65 + index)}" value="${escapeHtml(String(variant?.name || '').trim() || `Variant ${index + 1}`)}" class="variant-name">
            <input type="number" placeholder="${normalizeAnalyticsCountValue(variant?.weight || 0)}" value="${normalizeAnalyticsCountValue(variant?.weight || 0)}" class="variant-weight" min="0" max="100">
            <span>%</span>
            ${index >= 2 ? `
                <button type="button" class="btn-icon-sm" data-admin-action="analytics-remove-variant-row">
                    <i class="fas fa-times"></i>
                </button>
            ` : ''}
        </div>
    `).join('');
}

function applyAnalyticsExperimentTemplate(context = null) {
    const template = buildAnalyticsExperimentTemplate(parseAnalyticsActionContext(context));
    const nameEl = document.getElementById('expName');
    const descriptionEl = document.getElementById('expDescription');
    const targetMetricEl = document.getElementById('expTargetMetric');
    const variantsList = document.getElementById('variantsList');
    if (!nameEl || !descriptionEl || !targetMetricEl || !variantsList) {
        return;
    }

    nameEl.value = template.name || '';
    descriptionEl.value = template.description || '';
    targetMetricEl.value = normalizeAnalyticsExperimentTargetMetric(template.targetMetric);
    variantsList.innerHTML = renderAnalyticsExperimentVariantRows(template.variants);
}

// Chart theme colors
const chartColors = {
    primary: '#6b9ece',
    secondary: '#8b5cf6',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    gradientStart: 'rgba(107, 158, 206, 0.3)',
    gradientEnd: 'rgba(107, 158, 206, 0.0)'
};

// Get theme-aware colors
function getChartTheme() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    return {
        text: isDark ? '#e2e8f0' : '#1e293b',
        grid: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        background: isDark ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.9)'
    };
}

// Initialize Analytics Module
async function initAnalyticsModule() {
    console.log('[Analytics] Initializing...');
    analyticsRuntime.moduleActive = true;

    // Initialize tab indicator
    initAnalyticsTabIndicator();
    updateAnalyticsPanelNotes();

    try {
        if (!analyticsRuntime.initialized) {
            TrackingSDK.init();
        }

        setupAnalyticsEvents();
        setupRealtimeSubscriptions();
        ensureAnalyticsAutoRefreshState();

        await reloadAnalyticsDashboard({
            reason: analyticsRuntime.initialized ? 're-enter' : 'initial-load',
            includeExperiments: shouldLoadAnalyticsAdvancedTools()
        });

        analyticsRuntime.initialized = true;

        console.log('[Analytics] Initialized successfully');
    } catch (err) {
        console.error('[Analytics] Init error:', err);
    }
}

// Setup Supabase Realtime subscriptions for live updates
function setupRealtimeSubscriptions() {
    if (analyticsRuntime.realtimeBound) {
        return;
    }

    try {
        // Subscribe to new user registrations
        const usersChannel = getAnalyticsSupabaseClient().channel('analytics-users')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'profiles' },
                () => {
                    if (!analyticsRuntime.moduleActive) return;
                    console.log('[Analytics] New user detected');
                    animateKPIIncrement('kpiMauValue');
                    animateKPIIncrement('kpiNewUsersValue');
                }
            )
            .subscribe();

        // Subscribe to new comments
        const commentsChannel = getAnalyticsSupabaseClient().channel('analytics-comments')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'prompt_comments' },
                () => {
                    if (!analyticsRuntime.moduleActive) return;
                    console.log('[Analytics] New comment detected');
                    animateKPIIncrement('kpiCommentsValue');
                }
            )
            .subscribe();

        analyticsRuntime.realtimeChannels = [usersChannel, commentsChannel];
        analyticsRuntime.realtimeBound = true;
        console.log('[Analytics] Realtime subscriptions active');
    } catch (err) {
        console.error('[Analytics] Realtime subscription error:', err);
    }
}

function teardownRealtimeSubscriptions() {
    if (!analyticsRuntime.realtimeChannels.length) {
        analyticsRuntime.realtimeBound = false;
        return;
    }

    analyticsRuntime.realtimeChannels.forEach((channel) => {
        try {
            void getAnalyticsSupabaseClient().removeChannel(channel);
        } catch (err) {
            console.warn('[Analytics] Failed to remove realtime channel:', err);
        }
    });

    analyticsRuntime.realtimeChannels = [];
    analyticsRuntime.realtimeBound = false;
}

// Animate KPI increment with pulse effect
function animateKPIIncrement(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Get current value and increment
    const currentText = el.textContent;
    const currentNum = parseFloat(currentText.replace(/[^\d.]/g, '')) || 0;
    const suffix = currentText.match(/[a-zA-Z]+$/)?.[0] || '';

    // Add pulse animation
    el.classList.add('kpi-pulse');

    // Update value with animation
    if (suffix === 'w') {
        el.textContent = ((currentNum * 10000 + 1) / 10000).toFixed(1) + 'w';
    } else if (suffix === 'k') {
        el.textContent = ((currentNum * 1000 + 1) / 1000).toFixed(1) + 'k';
    } else {
        el.textContent = Math.round(currentNum + 1).toString();
    }

    // Remove animation class after transition
    setTimeout(() => {
        el.classList.remove('kpi-pulse');
    }, 600);
}

// Load Overview Statistics with Trend
async function loadOverviewStats() {
    try {
        // Try new trend function first, fallback to basic
        let data, error;
        const siteParam = getAnalyticsSiteParam();
        ({ data, error } = await getAnalyticsSupabaseClient().rpc('get_overview_stats_with_trend', { p_site: siteParam }));

        if (error) {
            // Fallback to basic stats
            ({ data, error } = await getAnalyticsSupabaseClient().rpc('get_overview_stats', { p_site: siteParam }));
            if (error) throw error;
        }

        if (!data || typeof data !== 'object') {
            const summaryWindow = await getAnalyticsSummaryWindowData({ forceRefresh: true }).catch(() => null);
            const fallbackOverview = summaryWindow?.overview && typeof summaryWindow.overview === 'object'
                ? summaryWindow.overview
                : null;
            if (fallbackOverview) {
                data = fallbackOverview;
            }
        }

        if (!data || typeof data !== 'object') {
            throw new Error('Analytics overview payload missing');
        }

        // Update KPI cards with values
        const kpiBindings = [
            ['kpiDauValue', data.dau],
            ['kpiMauValue', data.mau],
            ['kpiNewUsersValue', data.new_users_week],
            ['kpiPointsValue', data.total_points],
            ['kpiCommentsValue', data.total_comments]
        ];
        kpiBindings.forEach(([elementId, value]) => {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = formatNumber(value);
            }
        });

        // Add trend arrows if available
        if (document.getElementById('kpiDauTrend') && data.dau_growth !== undefined) {
            updateTrendArrow('kpiDauTrend', data.dau_growth);
        }
        if (document.getElementById('kpiNewUsersTrend') && data.new_users_growth !== undefined) {
            updateTrendArrow('kpiNewUsersTrend', data.new_users_growth);
        }
        if (document.getElementById('kpiCommentsTrend') && data.comments_growth !== undefined) {
            updateTrendArrow('kpiCommentsTrend', data.comments_growth);
        }

    } catch (err) {
        console.error('[Analytics] Failed to load overview:', err);
    }
}

// Helper: Update trend arrow
function updateTrendArrow(elementId, growthRate) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (growthRate === 0 || growthRate === null) {
        el.innerHTML = '<span class="trend-neutral">—</span>';
    } else if (growthRate > 0) {
        el.innerHTML = `<span class="trend-up">↑ ${Math.abs(growthRate)}%</span>`;
    } else {
        el.innerHTML = `<span class="trend-down">↓ ${Math.abs(growthRate)}%</span>`;
    }
}

// Load User Trend Chart
async function loadUserTrendChart(days = 30) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_user_trend', { p_days: days, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const ctx = document.getElementById('userTrendChart');
        if (!ctx) return;

        const theme = getChartTheme();

        // Create gradient
        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, chartColors.gradientStart);
        gradient.addColorStop(1, chartColors.gradientEnd);

        // Destroy existing chart
        if (userTrendChart) {
            userTrendChart.destroy();
        }

        userTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '活跃用户',
                        data: data.map(d => d.active_users),
                        borderColor: chartColors.primary,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: '新增用户',
                        data: data.map(d => d.new_users),
                        borderColor: chartColors.success,
                        backgroundColor: 'transparent',
                        borderDash: [5, 5],
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load user trend:', err);
    }
}

function getChannelBreakdownMetricMeta(rows = []) {
    const metrics = [
        { key: 'event_count', unitLabel: '事件', tooltipSuffix: '次事件', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'user_count', unitLabel: '用户', tooltipSuffix: '位用户', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'unlock_success_count', unitLabel: '内容解锁', tooltipSuffix: '次解锁', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'verify_submit_count', unitLabel: '验证提交', tooltipSuffix: '次提交', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'recharge_success_count', unitLabel: '充值成功', tooltipSuffix: '次充值', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'shop_purchase_count', unitLabel: '商城成交', tooltipSuffix: '次成交', rateKey: 'share_rate', rateLabel: '占比' },
        { key: 'total_points', unitLabel: '积分', tooltipSuffix: '积分' },
        { key: 'used_codes', unitLabel: '已核销码', tooltipSuffix: '个核销码' },
        { key: 'total_codes', unitLabel: '兑换码', tooltipSuffix: '个兑换码' },
        { key: 'batch_count', unitLabel: '批次', tooltipSuffix: '个批次' }
    ];

    for (const metric of metrics) {
        if (rows.some((row) => (toNumericValue(row?.[metric.key]) || 0) > 0)) {
            return metric;
        }
    }

    return metrics[0];
}

function renderChannelBreakdownState(message, variant = 'empty') {
    const container = document.getElementById('channelBreakdownList');
    if (!(container instanceof HTMLElement)) return;
    container.innerHTML = renderHintState('fas fa-list-ul', message, variant);
}

function getChannelBreakdownActionConfig(metricKey = '') {
    switch (String(metricKey || '').trim()) {
        case 'verify_submit_count':
            return { destination: 'analytics-verify', sectionId: 'verifyEventFunnel', label: '看验证服务' };
        case 'recharge_success_count':
        case 'shop_purchase_count':
            return { destination: 'analytics-monetization', sectionId: 'commerceEventFunnel', label: '看积分与交易' };
        case 'total_points':
        case 'used_codes':
        case 'total_codes':
        case 'batch_count':
            return { destination: 'analytics-monetization', sectionId: 'pointsFlow', label: '看积分与交易' };
        default:
            return { destination: 'analytics-content', sectionId: 'topContentList', label: '看内容分栏' };
    }
}

function renderChannelBreakdownDetails(rows = [], metricMeta = {}) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return renderHintState('fas fa-list-ul', '当前窗口暂无渠道明细');
    }

    const actionConfig = getChannelBreakdownActionConfig(metricMeta.key);

    return `
        <div class="analytics-recommendation-stack">
            ${rows.slice(0, 5).map((row) => {
                const primaryValue = toNumericValue(row?.[metricMeta.key]) || 0;
                const shareRate = toNumericValue(row?.[metricMeta.rateKey || 'share_rate']);
                const detailParts = [];

                if (metricMeta.key !== 'user_count' && (toNumericValue(row?.user_count) || 0) > 0) {
                    detailParts.push(`覆盖 ${formatNumber(row.user_count)} 位用户`);
                }
                if (metricMeta.key !== 'event_count' && (toNumericValue(row?.event_count) || 0) > 0) {
                    detailParts.push(`事件 ${formatNumber(row.event_count)}`);
                }
                if (metricMeta.key !== 'unlock_success_count' && (toNumericValue(row?.unlock_success_count) || 0) > 0) {
                    detailParts.push(`解锁 ${formatNumber(row.unlock_success_count)}`);
                }
                if (metricMeta.key !== 'verify_submit_count' && (toNumericValue(row?.verify_submit_count) || 0) > 0) {
                    detailParts.push(`验证 ${formatNumber(row.verify_submit_count)}`);
                }
                if (metricMeta.key !== 'shop_purchase_count' && (toNumericValue(row?.shop_purchase_count) || 0) > 0) {
                    detailParts.push(`成交 ${formatNumber(row.shop_purchase_count)}`);
                }
                if (metricMeta.key !== 'used_codes' && (toNumericValue(row?.used_codes) || 0) > 0) {
                    detailParts.push(`核销 ${formatNumber(row.used_codes)}`);
                }
                if (shareRate !== null) {
                    detailParts.push(`占比 ${formatPercent(shareRate)}`);
                } else if ((toNumericValue(row?.redemption_rate) || 0) > 0) {
                    detailParts.push(`使用率 ${formatPercent(row.redemption_rate)}`);
                }

                return `
                    <article class="analytics-recommendation-item">
                        <div class="analytics-recommendation-item__top">
                            <span class="analytics-status-chip analytics-status-chip--accent">${escapeHtml(metricMeta.unitLabel || '样本')}</span>
                            <strong class="analytics-recommendation-item__title">${escapeHtml(row?.channel || '未分类')}</strong>
                        </div>
                        <div class="analytics-recommendation-item__summary">
                            ${escapeHtml(`${metricMeta.unitLabel || '样本'} ${formatNumber(primaryValue)}${detailParts.length ? ` · ${detailParts.join(' / ')}` : ''}`)}
                        </div>
                        <div class="analytics-recommendation-item__actions">
                            <button
                                type="button"
                                class="btn-sm btn-secondary"
                                data-admin-action="analytics-open-destination"
                                data-analytics-destination="${escapeHtml(actionConfig.destination)}"
                                data-analytics-context="${escapeHtml(serializeAnalyticsActionContext({ sectionId: actionConfig.sectionId }))}"
                            >
                                <i class="fas fa-arrow-right"></i> ${escapeHtml(actionConfig.label)}
                            </button>
                        </div>
                    </article>
                `;
            }).join('')}
        </div>
    `;
}

async function fetchChannelBreakdownData(days = getAnalyticsRangeDays()) {
    const site = getAnalyticsSiteParam();
    try {
        const v2Data = await callAnalyticsRpcWithFallback('get_channel_breakdown_v2', [
            { p_site: site, p_days: days },
            { p_days: days },
            {}
        ]);
        const hasV2Signal = Array.isArray(v2Data) && v2Data.some((row) => (
            normalizeAnalyticsCountValue(row?.event_count)
            + normalizeAnalyticsCountValue(row?.user_count)
            + normalizeAnalyticsCountValue(row?.unlock_success_count)
            + normalizeAnalyticsCountValue(row?.verify_submit_count)
            + normalizeAnalyticsCountValue(row?.recharge_success_count)
            + normalizeAnalyticsCountValue(row?.shop_purchase_count)
        ) > 0);
        if (hasV2Signal) {
            return v2Data;
        }
    } catch (error) {
        console.warn('[Analytics] get_channel_breakdown_v2 RPC failed, falling back to legacy breakdown:', error);
    }

    return callAnalyticsRpcWithFallback('get_channel_breakdown', [
        { p_site: site, p_days: days },
        { p_site: site },
        {}
    ]);
}

function ensureChannelChartCanvas() {
    const panel = document.getElementById('channelChartPanel');
    if (!(panel instanceof HTMLElement)) return null;

    let canvas = panel.querySelector('#channelChart');
    if (!(canvas instanceof HTMLCanvasElement)) {
        panel.innerHTML = '<canvas id="channelChart"></canvas>';
        canvas = panel.querySelector('#channelChart');
    }

    return canvas instanceof HTMLCanvasElement ? canvas : null;
}

function renderChannelChartState(message, variant = 'empty') {
    const panel = document.getElementById('channelChartPanel');
    if (!(panel instanceof HTMLElement)) return;

    if (channelChart) {
        channelChart.destroy();
        channelChart = null;
    }

    panel.innerHTML = renderHintState('fas fa-diagram-project', message, variant);
    renderChannelBreakdownState(variant === 'error' ? '渠道明细加载失败' : '当前窗口暂无渠道明细', variant);
}

// Load Channel Distribution Chart
async function loadChannelChart(days = getAnalyticsRangeDays()) {
    try {
        const data = await fetchChannelBreakdownData(days);

        const ctx = ensureChannelChartCanvas();
        if (!ctx) return;
        const detailContainer = document.getElementById('channelBreakdownList');

        const metricMeta = getChannelBreakdownMetricMeta(data || []);
        const chartRows = Array.isArray(data)
            ? data.filter((row) => (toNumericValue(row?.[metricMeta.key]) || 0) > 0)
            : [];

        if (chartRows.length === 0) {
            renderChannelChartState('暂无渠道分布数据');
            return;
        }

        const theme = getChartTheme();
        const colors = [chartColors.primary, chartColors.secondary, chartColors.success, chartColors.warning, chartColors.danger];
        const backgroundColors = chartRows.map((_, index) => colors[index % colors.length]);

        // Destroy existing chart
        if (channelChart) {
            channelChart.destroy();
        }

        channelChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: chartRows.map((row) => row.channel || '未分类'),
                datasets: [{
                    data: chartRows.map((row) => toNumericValue(row?.[metricMeta.key]) || 0),
                    backgroundColor: backgroundColors,
                    borderWidth: 2,
                    borderColor: theme.background
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: theme.text }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const row = chartRows[context.dataIndex] || {};
                                const rate = toNumericValue(row?.[metricMeta.rateKey || 'redemption_rate']);
                                const rateText = rate !== null
                                    ? ` (${trimTrailingZeros(rate.toFixed(2))}% ${metricMeta.rateLabel || '核销'})`
                                    : '';
                                return `${label}: ${formatNumber(value)} ${metricMeta.tooltipSuffix}${rateText}`;
                            }
                        }
                    }
                }
            }
        });

        if (detailContainer) {
            detailContainer.innerHTML = renderChannelBreakdownDetails(chartRows, metricMeta);
        }

    } catch (err) {
        console.error('[Analytics] Failed to load channel chart:', err);
        renderChannelChartState('渠道分布加载失败', 'error');
    }
}

// Load Content Trend Chart
async function loadContentTrendChart(days = 30) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_content_trend', { p_days: days, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const ctx = document.getElementById('contentTrendChart');
        if (!ctx) return;

        const theme = getChartTheme();

        // Destroy existing chart
        if (contentTrendChart) {
            contentTrendChart.destroy();
        }

        contentTrendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '评论',
                        data: data.map(d => d.comments),
                        backgroundColor: chartColors.primary,
                        borderRadius: 4
                    },
                    {
                        label: '解锁',
                        data: data.map(d => d.unlocks),
                        backgroundColor: chartColors.secondary,
                        borderRadius: 4
                    },
                    {
                        label: '点赞',
                        data: data.map(d => d.likes),
                        backgroundColor: chartColors.success,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: theme.text }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load content trend:', err);
    }
}

async function fetchTopContentData(limit = 10, days = getAnalyticsRangeDays()) {
    const site = getAnalyticsSiteParam();
    try {
        const v2Data = await callAnalyticsRpcWithFallback('get_content_top_v2', [
            { p_limit: limit, p_site: site, p_days: days },
            { p_limit: limit, p_days: days },
            { p_limit: limit }
        ]);
        const hasV2Signal = Array.isArray(v2Data) && v2Data.some((row) => (
            normalizeAnalyticsCountValue(row?.view_count)
            + normalizeAnalyticsCountValue(row?.unlock_count)
            + normalizeAnalyticsCountValue(row?.comment_count)
        ) > 0);
        if (hasV2Signal) {
            return v2Data;
        }
    } catch (error) {
        console.warn('[Analytics] get_content_top_v2 RPC failed, falling back to legacy top content:', error);
    }

    return callAnalyticsRpcWithFallback('get_content_top', [
        { p_limit: limit, p_site: site, p_days: days },
        { p_limit: limit, p_site: site },
        { p_limit: limit }
    ]);
}

// Load Top Content
async function loadTopContent(days = getAnalyticsRangeDays()) {
    try {
        const data = await fetchTopContentData(10, days);

        const container = document.getElementById('topContentList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无数据</div>';
            return;
        }

        container.innerHTML = data.map((item, index) => `
            <div class="top-content-item">
                <span class="rank rank-${index + 1}">${index + 1}</span>
                <div class="top-content-item__main">
                    <div class="top-content-item__title" title="${item.title || '无标题'}">${truncate(item.title || '无标题', 34)}</div>
                    <div class="top-content-item__meta">
                        <span>${escapeHtml(item.category || '未分类')}</span>
                        ${normalizeAnalyticsCountValue(item.score) > 0 ? `<span>热度 ${formatNumber(item.score)}</span>` : ''}
                        ${item.prompt_id ? `<span>ID ${escapeHtml(String(item.prompt_id).trim())}</span>` : ''}
                    </div>
                </div>
                <span class="stats">
                    ${normalizeAnalyticsCountValue(item.view_count) > 0
                        ? `<span class="view"><i class="fas fa-eye"></i> ${item.view_count}</span>`
                        : ''}
                    <span class="unlock"><i class="fas fa-unlock"></i> ${item.unlock_count}</span>
                    <span class="comment"><i class="fas fa-comment"></i> ${item.comment_count}</span>
                </span>
                <div class="top-content-item__actions">
                    <button class="btn-view-context" type="button" data-admin-action="analytics-view-context" data-prompt-id="${item.prompt_id}" title="查看上下文">
                        <i class="fas fa-up-right-from-square"></i> 看上下文
                    </button>
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('[Analytics] Failed to load top content:', err);
        const container = document.getElementById('topContentList');
        if (container) {
            container.innerHTML = '<div class="error-state">加载失败</div>';
        }
    }
}

// Setup Event Listeners
function setupAnalyticsEvents() {
    if (analyticsRuntime.eventsBound) {
        return;
    }

    // Period selector for user trend
    document.querySelectorAll('.chart-period-selector .period-btn').forEach(btn => {
        btn.addEventListener('click', async function () {
            const days = parseInt(this.dataset.days);

            // Update active state
            document.querySelectorAll('.chart-period-selector .period-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // Reload chart
            await loadUserTrendChart(days);
        });
    });

    // AI Insight button
    const insightBtn = document.getElementById('generateInsightBtn');
    if (insightBtn) {
        insightBtn.addEventListener('click', generateAIInsight);
    }

    analyticsRuntime.eventsBound = true;
}

// Generate AI Insight
async function generateAIInsight() {
    const btn = document.getElementById('generateInsightBtn');
    const content = document.getElementById('aiInsightContent');
    let aiSummaryData = null;
    const { days, startDate, endDate } = getAnalyticsRangeState();
    const rangeLabel = buildAnalyticsRangeLabel({ days, startDate, endDate });
    const currentCacheKey = getAnalyticsAIContextKey();

    if (!btn || !content) return;

    // Debounce check - prevent rapid clicks
    if (aiInsightDebounce) {
        content.innerHTML = '<p class="ai-error">请稍候再试（5秒内只能请求一次）</p>';
        return;
    }

    // Cache check - reuse recent results
    const now = Date.now();
    if (currentCacheKey !== aiInsightCacheKey) {
        resetAnalyticsAICache();
    }

    if (aiInsightCache && (now - aiInsightCacheTime) < AI_CACHE_DURATION) {
        const cachedReport = getAnalyticsInsightCacheReport(aiInsightCache);
        const cachedSummary = getAnalyticsInsightCacheSummary(aiInsightCache);
        content.innerHTML = renderAIInsightMarkup(cachedReport, {
            summaryData: cachedSummary,
            hintHtml: `<p class="ai-cache-hint">📋 缓存结果 (${Math.round((AI_CACHE_DURATION - (now - aiInsightCacheTime)) / 60000)} 分钟后刷新)</p>`
        });
        return;
    }

    // Check for API key (use same format as admin-studio.js)
    if (!hasAdminAI()) {
        try {
            await window.AdminAI?.checkHealth?.();
        } catch (err) {
            console.warn('[Analytics] AI proxy health check failed:', err);
        }
    }

    if (!hasAdminAI()) {
        content.innerHTML = '<p class="ai-error">请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key</p>';
        return;
    }

    // Set debounce
    aiInsightDebounce = true;
    setTimeout(() => { aiInsightDebounce = false; }, 5000);

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 分析中...';
    content.innerHTML = '<p class="ai-loading">AI 正在分析数据...</p>';

    try {
        // Get summary data
        let data = null;
        try {
            data = await callAnalyticsRpcWithFallback('get_ai_summary_data_v2', [
                { p_days: days, p_site: getAnalyticsSiteParam() }
            ]);
        } catch (_error) {
            const fallbackResult = await getAnalyticsSupabaseClient().rpc('get_ai_summary_data', {
                p_days: days,
                p_site: getAnalyticsSiteParam()
            });

            if (fallbackResult.error) throw fallbackResult.error;
            data = fallbackResult.data;
        }
        if (!data || !data.overview) throw new Error('数据获取失败');

        const [overviewBusinessMixResult, verifyServiceResult, growthSummaryResult, operationsHealthResult, siteComparisonResult] = await Promise.allSettled([
            getOverviewBusinessMixSummaryData(),
            getVerifyServiceSummaryData(),
            getGrowthSummaryData(),
            getOperationsHealthSnapshotData(),
            getAnalyticsSiteComparisonData({ summaryWindowData: data })
        ]);

        aiSummaryData = {
            ...data,
            overview_business_mix: overviewBusinessMixResult.status === 'fulfilled' ? overviewBusinessMixResult.value : null,
            verify_service_summary: verifyServiceResult.status === 'fulfilled' ? verifyServiceResult.value : null,
            growth_summary: growthSummaryResult.status === 'fulfilled' ? growthSummaryResult.value : null,
            operations_health_snapshot: operationsHealthResult.status === 'fulfilled' ? operationsHealthResult.value : null,
            site_comparison: siteComparisonResult.status === 'fulfilled' ? siteComparisonResult.value : null
        };

        console.log('[Analytics] AI Summary Data:', aiSummaryData);

        // Safely extract values with defaults
        const overview = aiSummaryData.overview || {};
        const dau = overview.dau ?? 0;
        const mau = overview.mau ?? 0;
        const newUsers = overview.new_users_week ?? 0;
        const totalPoints = overview.total_points ?? 0;
        const totalComments = overview.total_comments ?? 0;
        const eventOverview = aiSummaryData.event_overview || {};
        const eventFunnels = aiSummaryData.event_funnels || {};
        const commerceEventFunnel = buildCommerceEventFunnelViewData(aiSummaryData);
        const verifyEventFunnel = buildVerifyEventFunnelViewData(aiSummaryData);
        const growthEventFunnel = buildGrowthEventFunnelViewData(aiSummaryData);
        const overviewBusinessMix = aiSummaryData.overview_business_mix?.metrics || {};
        const verifyService = aiSummaryData.verify_service_summary?.metrics || {};
        const growthSummary = aiSummaryData.growth_summary?.metrics || {};
        const operationsHealth = aiSummaryData.operations_health_snapshot?.metrics || {};
        const siteComparison = aiSummaryData.site_comparison || {};
        const actionRecommendations = collectAnalyticsActionRecommendations(aiSummaryData).slice(0, 6);
        const businessAnomalyCards = buildAnalyticsBusinessAnomalyCardsData(aiSummaryData, 4);
        const experimentSuggestions = buildAnalyticsExperimentSuggestionsData(aiSummaryData, 3);

        // Call Gemini API
        const prompt = `你是一位专业的数据分析师。请基于以下平台数据，生成一份简洁的运营洞察报告（使用中文）：

分析范围：${rangeLabel}

数据概览：
- DAU: ${dau}
- MAU: ${mau}
- 本周新增用户: ${newUsers}
- 积分流通总量: ${totalPoints}
- 总评论数: ${totalComments}

用户趋势（当前窗口）：
${JSON.stringify(aiSummaryData.user_trend || [], null, 2)}

渠道表现：
${JSON.stringify(aiSummaryData.channel_breakdown || [], null, 2)}

真实行为摘要：
${JSON.stringify(eventOverview, null, 2)}

真实行为漏斗：
${JSON.stringify(eventFunnels, null, 2)}

交易事件转化：
${JSON.stringify(commerceEventFunnel.exportRows || [], null, 2)}

验证事件转化：
${JSON.stringify(verifyEventFunnel.exportRows || [], null, 2)}

增长动作：
${JSON.stringify(growthEventFunnel.exportRows || [], null, 2)}

站点对比：
${JSON.stringify(siteComparison, null, 2)}

实验建议候选：
${JSON.stringify(experimentSuggestions, null, 2)}

经营主线摘要：
${JSON.stringify(overviewBusinessMix, null, 2)}

验证服务摘要：
${JSON.stringify(verifyService, null, 2)}

验证关注任务：
${JSON.stringify(aiSummaryData.verify_service_summary?.focusRows || aiSummaryData.verify_service_summary?.recentRows || [], null, 2)}

社区与裂变摘要：
${JSON.stringify(growthSummary, null, 2)}

运营健康快照：
${JSON.stringify(operationsHealth, null, 2)}

经营异常卡片：
${JSON.stringify(businessAnomalyCards, null, 2)}

建议动作候选：
${JSON.stringify(actionRecommendations, null, 2)}

请输出：
1. 数据亮点（2-3条）
2. 潜在风险（1-2条）
3. 运营建议（2-3条）
4. 建议优先查看的后台入口（1-2条，格式“入口：原因”）

请用简洁的要点形式，每条不超过一行。`;

        const text = await window.AdminAI.generateText(prompt, {
            model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024
            }
        });

        // Cache the result
        aiInsightCache = {
            report: text || '分析失败，请重试',
            summaryData: aiSummaryData
        };
        aiInsightCacheTime = Date.now();
        aiInsightCacheKey = currentCacheKey;

        // Format and display
        content.innerHTML = renderAIInsightMarkup(aiInsightCache.report, {
            summaryData: aiSummaryData
        });

    } catch (err) {
        console.error('[Analytics] AI insight error:', err);
        if (isGeminiQuotaError(err)) {
            aiInsightCache = {
                report: buildLocalAnalyticsInsight(aiSummaryData || {}),
                summaryData: aiSummaryData || null
            };
            aiInsightCacheTime = Date.now();
            aiInsightCacheKey = currentCacheKey;
            content.innerHTML = renderAIInsightMarkup(aiInsightCache.report, {
                summaryData: aiInsightCache.summaryData,
                hintHtml: buildQuotaFallbackHint('已切换为本地规则洞察')
            });
        } else {
            const errMsg = err.message || (err.details ? err.details : '未知错误');
            content.innerHTML = `<p class="ai-error">分析失败：${errMsg}</p>`;
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> 生成分析';
    }
}

// Helper: Format AI Response
function formatAIResponse(text) {
    const escaped = escapeHtml(text || '');
    return escaped
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>')
        .replace(/^(\d+)\./gm, '<span class="ai-number">$1.</span>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper: Format Number
function formatNumber(num) {
    const value = toNumericValue(num);
    if (value === null) return '--';

    const absValue = Math.abs(value);
    if (absValue >= 10000) {
        return trimTrailingZeros((value / 10000).toFixed(1)) + 'w';
    }
    if (absValue >= 1000) {
        return trimTrailingZeros((value / 1000).toFixed(1)) + 'k';
    }
    if (!Number.isInteger(value)) {
        return trimTrailingZeros(value.toFixed(1));
    }
    return value.toString();
}

// Helper: Format Date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Helper: Truncate Text
function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
}

function toNumericValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value, digits = 1) {
    const numericValue = toNumericValue(value);
    if (numericValue === null) return null;
    const factor = 10 ** digits;
    return Math.round(numericValue * factor) / factor;
}

function trimTrailingZeros(value) {
    return String(value)
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.0+$/, '');
}

function formatPercent(value) {
    const numericValue = toNumericValue(value);
    if (numericValue === null) return '--';
    return `${trimTrailingZeros(numericValue.toFixed(2))}%`;
}

function renderHintState(iconClass, message, variant = 'empty') {
    const className = variant === 'error' ? 'error-state' : 'empty-state-hint';
    return `<div class="${className}">
        <i class="${iconClass}"></i>
        <span>${message}</span>
    </div>`;
}

function renderOverviewDutyBoardSkeleton() {
    return `
        <div class="analytics-duty-board-skeleton" aria-hidden="true">
            <div class="analytics-duty-board-skeleton__stats">
                ${Array.from({ length: 4 }).map(() => `
                    <div class="analytics-duty-board-skeleton__stat">
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                        <span class="admin-skeleton-block analytics-duty-board-skeleton__value"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-70"></span>
                    </div>
                `).join('')}
            </div>
            <div class="analytics-duty-board-skeleton__queue">
                <div class="analytics-duty-board-skeleton__queue-head">
                    <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-30"></span>
                    <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                </div>
                <div class="analytics-duty-board-skeleton__hero">
                    <div class="analytics-duty-board-skeleton__hero-main">
                        <div class="analytics-duty-board-skeleton__chips">
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-sm"></span>
                            <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-md"></span>
                        </div>
                        <span class="admin-skeleton-block admin-skeleton-block--title admin-skeleton-w-60"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-50"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--pill admin-skeleton-w-chip-lg"></span>
                    </div>
                    <div class="analytics-duty-board-skeleton__hero-metric">
                        <span class="admin-skeleton-block analytics-duty-board-skeleton__metric-number"></span>
                        <span class="admin-skeleton-block admin-skeleton-block--line admin-skeleton-w-40"></span>
                    </div>
                    <div class="analytics-duty-board-skeleton__hero-action">
                        <span class="admin-skeleton-block admin-skeleton-block--action admin-skeleton-w-chip-lg"></span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function getAnalyticsRangeWindow() {
    const range = getAnalyticsRangeState();
    let start = normalizeAnalyticsDate(range.startDate);
    let end = normalizeAnalyticsDate(range.endDate);

    if (!start || !end) {
        end = normalizeAnalyticsDate(new Date());
        start = new Date(end);
        start.setDate(start.getDate() - (range.days || DEFAULT_ANALYTICS_DAYS));
        start = normalizeAnalyticsDate(start);
    }

    const inclusiveEnd = new Date(end);
    inclusiveEnd.setHours(23, 59, 59, 999);

    return {
        start,
        end: inclusiveEnd,
        days: range.days || DEFAULT_ANALYTICS_DAYS
    };
}

function applyAnalyticsTimeRange(query, column = 'created_at', range = getAnalyticsRangeWindow()) {
    if (!query || !column) return query;

    if (range?.start) {
        query = query.gte(column, range.start.toISOString());
    }

    if (range?.end) {
        query = query.lte(column, range.end.toISOString());
    }

    return query;
}

function isAnalyticsValueInRange(value, range = getAnalyticsRangeWindow()) {
    if (!value) return false;

    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return false;

    return date >= range.start && date <= range.end;
}

async function fetchAnalyticsTableRows(table, columns = '*', options = {}) {
    const {
        siteColumn = 'site',
        orderBy = 'created_at',
        ascending = false,
        limit = 0,
        rangeColumn = 'created_at'
    } = options;

    let query = getAnalyticsSupabaseClient().from(table).select(columns);

    if (siteColumn) {
        query = window.AdminSiteFilter?.applySiteFilter(query, siteColumn) || query;
    }

    if (rangeColumn) {
        query = applyAnalyticsTimeRange(query, rangeColumn);
    }

    if (orderBy) {
        query = query.order(orderBy, { ascending });
    }

    if (limit > 0) {
        query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) throw error;

    let rows = Array.isArray(data) ? data : [];
    if (rangeColumn) {
        const range = getAnalyticsRangeWindow();
        rows = rows.filter((row) => isAnalyticsValueInRange(row?.[rangeColumn], range));
    }

    return rows;
}

function formatAnalyticsDateTime(value) {
    if (!value) return '--';

    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '--';

    return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function renderAnalyticsCompactItems(items = [], emptyConfig = {}) {
    if (!Array.isArray(items) || items.length === 0) {
        return renderHintState(
            emptyConfig.iconClass || 'fas fa-chart-simple',
            emptyConfig.message || '当前窗口暂无数据'
        );
    }

    return `<div class="analytics-compact-stack">
        ${items.map((item) => `
            <article class="analytics-compact-item">
                <div class="analytics-compact-item__top">
                    <div class="analytics-compact-item__heading">
                        <strong class="analytics-compact-item__title">${escapeHtml(item.title || '未命名指标')}</strong>
                        ${item.meta ? `<div class="analytics-compact-item__meta">${escapeHtml(item.meta)}</div>` : ''}
                    </div>
                    ${item.value ? `<div class="analytics-compact-item__value">${escapeHtml(item.value)}</div>` : ''}
                </div>
                ${item.badgeLabel ? `
                    <div class="analytics-compact-item__badge-row">
                        <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.badgeTone || 'neutral')}">${escapeHtml(item.badgeLabel)}</span>
                    </div>
                ` : ''}
                ${item.summary ? `<div class="analytics-compact-item__summary">${escapeHtml(item.summary)}</div>` : ''}
                ${item.actionLabel ? `
                    <div class="analytics-compact-item__actions">
                        <button
                            type="button"
                            class="btn-sm btn-secondary"
                            data-admin-action="${escapeHtml(item.action || 'analytics-open-destination')}"
                            ${item.action === 'analytics-view-context'
                                ? `data-prompt-id="${escapeHtml(String(item.promptId || '').trim())}"`
                                : `data-analytics-destination="${escapeHtml(item.destination || '')}"
                                   data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item.context || item.destinationContext || null))}"`}
                        >
                            <i class="${escapeHtml(item.icon || 'fas fa-arrow-right')}"></i> ${escapeHtml(item.actionLabel)}
                        </button>
                    </div>
                ` : ''}
            </article>
        `).join('')}
    </div>`;
}

function renderAnalyticsRecommendationItems(items = [], emptyConfig = {}) {
    if (!Array.isArray(items) || items.length === 0) {
        return renderHintState(
            emptyConfig.iconClass || 'fas fa-lightbulb',
            emptyConfig.message || '当前窗口暂无建议动作'
        );
    }

    return `<div class="analytics-recommendation-stack">
        ${items.map((item) => `
            <article class="analytics-recommendation-item">
                <div class="analytics-recommendation-item__top">
                    <span class="analytics-status-chip analytics-status-chip--${escapeHtml(item.tone || 'neutral')}">${escapeHtml(item.level || '观察')}</span>
                    <strong class="analytics-recommendation-item__title">${escapeHtml(item.title || '待处理项')}</strong>
                </div>
                <div class="analytics-recommendation-item__summary">${escapeHtml(item.summary || '建议进入对应模块继续处理')}</div>
                ${item.actionLabel ? `
                    <div class="analytics-recommendation-item__actions">
                        <button
                            type="button"
                            class="btn-sm btn-secondary"
                            data-admin-action="analytics-open-destination"
                            data-analytics-destination="${escapeHtml(item.destination || '')}"
                            data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(item.context || item.destinationContext || null))}"
                        >
                            <i class="${escapeHtml(item.icon || 'fas fa-arrow-right')}"></i> ${escapeHtml(item.actionLabel)}
                        </button>
                    </div>
                ` : ''}
            </article>
        `).join('')}
    </div>`;
}

function scheduleAnalyticsNavigationStep(callback, delay = 90) {
    if (typeof callback !== 'function') return;

    window.requestAnimationFrame(() => {
        window.setTimeout(() => {
            try {
                callback();
            } catch (error) {
                console.warn('[Analytics] Deferred navigation step failed:', error);
            }
        }, delay);
    });
}

function focusAnalyticsDestinationTarget(targetOrId, options = {}) {
    const resolvedTarget = typeof targetOrId === 'string'
        ? document.getElementById(String(targetOrId || '').trim())
        : targetOrId;
    const focusTarget = resolvedTarget instanceof HTMLElement
        ? (
            resolvedTarget.closest?.('.chart-card, .kpi-card, .config-card, .points-batch-row, .lookup-card, .verify-monitor-item, .ops-alert-monitor-item, .admin-audit-monitor-item')
            || resolvedTarget
        )
        : null;

    document.querySelectorAll('.analytics-nav-focus-target--active').forEach((element) => {
        element.classList.remove('analytics-nav-focus-target--active');
    });

    if (!(focusTarget instanceof HTMLElement)) {
        return false;
    }

    focusTarget.classList.add('analytics-nav-focus-target--active');
    focusTarget.scrollIntoView({
        behavior: 'smooth',
        block: options.block || 'center'
    });

    if (analyticsDestinationFocusTimeoutId) {
        window.clearTimeout(analyticsDestinationFocusTimeoutId);
    }

    analyticsDestinationFocusTimeoutId = window.setTimeout(() => {
        focusTarget.classList.remove('analytics-nav-focus-target--active');
    }, 2600);

    return true;
}

function scheduleAnalyticsWorkbenchOpen(workspaceKey = '', context = {}, delay = 120) {
    const normalizedWorkspaceKey = String(workspaceKey || '').trim().toLowerCase();
    if (!normalizedWorkspaceKey) {
        return false;
    }

    const launcher = window.openAdminWorkbenchEntry || window.openOpsAlertWorkspace;
    if (typeof launcher !== 'function') {
        return false;
    }

    scheduleAnalyticsNavigationStep(() => {
        void Promise.resolve(launcher(normalizedWorkspaceKey, context)).catch((error) => {
            console.warn('[Analytics] Failed to open admin workbench destination:', error);
        });
    }, delay);
    return true;
}

async function openAnalyticsPaymentsContext(mode = 'overview', context = {}) {
    const normalizedMode = String(mode || 'overview').trim().toLowerCase();
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
        ? context
        : {};
    const targetTab = normalizedMode === 'finance'
        ? 'finance'
        : (normalizedMode === 'ops' || normalizedMode === 'queue' ? 'ops' : 'overview');
    const paymentOrderId = String(
        normalizedContext.paymentOrderId
        || normalizedContext.orderId
        || normalizedContext.providerOrderNo
        || ''
    ).trim();
    const topicKey = String(
        normalizedContext.topicKey
        || normalizedContext.exceptionTopic
        || normalizedContext.topic
        || ''
    ).trim().toLowerCase();
    const focusTargetId = String(
        normalizedContext.focusTargetId
        || normalizedContext.sectionId
        || (normalizedMode === 'queue'
            ? 'paymentsOpsAlertQueuePanel'
            : (targetTab === 'ops' ? 'paymentsExceptionTopics' : (targetTab === 'finance' ? 'paymentsSitewideGrid' : 'paymentsOverviewGrid')))
    ).trim();

    const switched = window.switchModule?.('payments');
    if (switched === false) {
        return false;
    }

    await window.AdminPayments?.init?.();
    window.AdminPayments?.showWorkbenchContext?.(normalizedContext);

    if (paymentOrderId && typeof window.AdminPayments?.focusOrder === 'function') {
        await window.AdminPayments.focusOrder(paymentOrderId, {
            switchTab: true,
            reload: true
        });
        return true;
    }

    if (normalizedMode === 'queue' && typeof window.AdminPayments?.focusOpsAlertQueue === 'function') {
        await window.AdminPayments.focusOpsAlertQueue();
        return true;
    }

    if ((normalizedMode === 'ops' || topicKey) && typeof window.AdminPayments?.focusExceptionTopic === 'function') {
        await window.AdminPayments.focusExceptionTopic(topicKey || 'all');
        return true;
    }

    window.AdminPayments?.switchTab?.(targetTab, { reload: false });
    if (focusTargetId) {
        scheduleAnalyticsNavigationStep(() => {
            focusAnalyticsDestinationTarget(focusTargetId, { block: 'start' });
        }, 120);
    }
    return true;
}

async function openAnalyticsTicketsContext(mode = 'pending', context = {}) {
    const normalizedMode = String(mode || 'pending').trim().toLowerCase();
    const normalizedContext = context && typeof context === 'object' && !Array.isArray(context)
        ? context
        : {};
    const workspace = ['overview', 'summary', 'queue'].includes(String(normalizedContext.workspace || '').trim().toLowerCase())
        ? String(normalizedContext.workspace || '').trim().toLowerCase()
        : (['overview', 'summary'].includes(normalizedMode) ? normalizedMode : 'queue');
    const status = String(
        normalizedContext.status
        || (normalizedMode === 'resolved' ? 'resolved' : 'pending')
    ).trim().toLowerCase();
    const ticketId = String(normalizedContext.ticketId || normalizedContext.targetId || '').trim();
    const searchQuery = String(normalizedContext.search || normalizedContext.referenceValue || '').trim();
    const quickFilter = String(normalizedContext.quickFilter || '').trim().toLowerCase();
    const assigneeFilter = String(normalizedContext.assignee || '').trim().toLowerCase();
    const replyAction = String(normalizedContext.replyAction || '').trim().toLowerCase();
    const focusTargetId = String(
        normalizedContext.focusTargetId
        || normalizedContext.sectionId
        || (workspace === 'overview'
            ? 'ticketsOverviewPanel'
            : (workspace === 'summary' ? 'ticketsOverviewReminderSection' : 'ticketsQueueControls'))
    ).trim();

    const switched = window.switchModule?.('tickets');
    if (switched === false) {
        return false;
    }

    await window.AdminTickets?.init?.();
    window.AdminTickets?.showWorkbenchContext?.(normalizedContext);

    if (ticketId && workspace === 'queue' && typeof window.AdminTickets?.focusTicket === 'function') {
        const focusResult = await window.AdminTickets.focusTicket(ticketId, { status });
        if (focusResult?.matched && replyAction && typeof window.AdminTickets?.openReplyModal === 'function') {
            window.AdminTickets.openReplyModal(ticketId, replyAction === 'rejected' ? 'REJECTED' : 'RESOLVED');
        }
        return true;
    }

    window.AdminTickets?.setWorkspaceView?.(workspace, {
        targetId: focusTargetId,
        scroll: true,
        highlight: true
    });

    if (workspace !== 'queue') {
        return true;
    }

    const normalizedStatus = window.AdminTickets?.normalizeStatusFilter?.(status) || status || 'pending';
    const overdueOnly = normalizedMode === 'overdue' || quickFilter === 'overdue' || normalizedContext.overdueOnly === true;
    const priority = quickFilter === 'priority' || String(normalizedContext.priority || '').trim().toLowerCase() === 'high'
        ? 'high'
        : 'all';
    const assignee = ['mine', 'unassigned'].includes(quickFilter)
        ? quickFilter
        : (['mine', 'unassigned'].includes(assigneeFilter) ? assigneeFilter : 'all');

    if (window.AdminTickets) {
        window.AdminTickets.focusedTicketId = '';
        window.AdminTickets.currentStatus = normalizedStatus;
        window.AdminTickets.quickFilters = {
            overdueOnly,
            priority,
            assignee
        };
        window.AdminTickets.searchQuery = searchQuery;
        window.AdminTickets.syncSearchInput?.();
        window.AdminTickets.syncQuickFilterButtons?.();
    }

    const filterButton = document.querySelector(`[data-admin-action="tickets-filter"][data-ticket-status="${normalizedStatus}"]`);
    await window.AdminTickets?.filter?.(normalizedStatus, filterButton);
    return true;
}

function applyAnalyticsDestinationSiteContext(context = {}) {
    const nextSite = String(context?.site || '').trim().toLowerCase();
    if (!nextSite || !['cn', 'intl'].includes(nextSite)) {
        return false;
    }

    const currentSite = String(window.AdminSiteFilter?.getSiteFilter?.() || 'all').trim().toLowerCase();
    if (currentSite === nextSite) {
        return false;
    }

    window.AdminSiteFilter?.select?.(nextSite);
    return true;
}

function openAnalyticsDestination(destination = '', context = null) {
    const normalized = String(destination || '').trim().toLowerCase();
    const normalizedContext = parseAnalyticsActionContext(context);
    if (!normalized) return false;

    applyAnalyticsDestinationSiteContext(normalizedContext);

    if (normalized.startsWith('workbench-')) {
        const workspaceKey = normalized.slice('workbench-'.length).trim();
        if (!workspaceKey) {
            return false;
        }
        return scheduleAnalyticsWorkbenchOpen(workspaceKey, normalizedContext, 120);
    }

    switch (normalized) {
        case 'analytics-overview':
        case 'analytics-content':
        case 'analytics-monetization':
        case 'analytics-verify':
        case 'analytics-growth':
        case 'analytics-ai': {
            const requestedTab = normalized.replace('analytics-', '');
            const nextTab = requestedTab === 'ai' ? 'overview' : requestedTab;
            const focusSectionId = String(
                normalizedContext.sectionId
                || normalizedContext.focusTargetId
                || normalizedContext.targetId
                || ''
            ).trim();
            if (!isAnalyticsModuleVisible()) {
                const switched = window.switchModule?.('analytics');
                if (switched === false) return false;
                scheduleAnalyticsNavigationStep(() => {
                    switchAnalyticsTab(nextTab);
                    if (focusSectionId) {
                        scheduleAnalyticsNavigationStep(() => {
                            focusAnalyticsDestinationTarget(focusSectionId, { block: 'start' });
                        }, 140);
                    }
                });
            } else {
                switchAnalyticsTab(nextTab);
                if (focusSectionId) {
                    scheduleAnalyticsNavigationStep(() => {
                        focusAnalyticsDestinationTarget(focusSectionId, { block: 'start' });
                    }, 120);
                }
            }
            return true;
        }
        case 'payments-overview':
        case 'payments-finance':
        case 'payments-ops':
        case 'payments-queue': {
            const workbenchKey = normalized === 'payments-ops'
                ? 'payments-ops'
                : (normalized === 'payments-overview' ? 'payments-overview' : '');
            if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                return true;
            }
            scheduleAnalyticsNavigationStep(() => {
                void openAnalyticsPaymentsContext(
                    normalized.replace('payments-', ''),
                    normalizedContext
                ).catch((error) => {
                    console.warn('[Analytics] Failed to open payments destination:', error);
                });
            }, 120);
            return true;
        }
        case 'payments':
        case 'points':
        case 'users':
        case 'tickets': {
            if (normalized === 'payments') {
                const requestedMode = String(normalizedContext.tab || normalizedContext.mode || '').trim().toLowerCase();
                const paymentsMode = requestedMode === 'finance'
                    ? 'finance'
                    : (normalizedContext.focusQueue === true ? 'queue' : (requestedMode === 'ops' ? 'ops' : 'overview'));
                const workbenchKey = paymentsMode === 'ops' ? 'payments-ops' : (paymentsMode === 'overview' ? 'payments-overview' : '');
                if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                    return true;
                }
                scheduleAnalyticsNavigationStep(() => {
                    void openAnalyticsPaymentsContext(paymentsMode, normalizedContext).catch((error) => {
                        console.warn('[Analytics] Failed to open payments context:', error);
                    });
                }, 120);
                return true;
            }
            if (normalized === 'tickets') {
                const requestedMode = String(
                    normalizedContext.mode
                    || normalizedContext.status
                    || normalizedContext.workspace
                    || ''
                ).trim().toLowerCase();
                const ticketMode = ['resolved', 'overview', 'summary', 'overdue'].includes(requestedMode)
                    ? requestedMode
                    : 'pending';
                const workbenchKey = ticketMode === 'resolved' ? 'tickets-resolved' : (ticketMode === 'pending' ? 'tickets-pending' : '');
                if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                    return true;
                }
                scheduleAnalyticsNavigationStep(() => {
                    void openAnalyticsTicketsContext(ticketMode, normalizedContext).catch((error) => {
                        console.warn('[Analytics] Failed to open tickets context:', error);
                    });
                }, 120);
                return true;
            }

            const switched = window.switchModule?.(normalized);
            if (switched === false) return false;
            if (normalized === 'points' && typeof window.openAnalyticsPointsContext === 'function') {
                scheduleAnalyticsNavigationStep(() => {
                    window.openAnalyticsPointsContext?.(normalizedContext);
                }, 120);
            } else if (normalized === 'points' && normalizedContext.batchId && typeof window.navigateToBatch === 'function') {
                scheduleAnalyticsNavigationStep(() => {
                    window.navigateToBatch?.(
                        normalizedContext.batchId,
                        normalizedContext.code ? { code: normalizedContext.code } : {}
                    );
                }, 120);
            }
            return true;
        }
        case 'tickets-pending':
        case 'tickets-resolved':
        case 'tickets-overdue':
        case 'tickets-overview':
        case 'tickets-summary': {
            const workbenchKey = normalized === 'tickets-resolved'
                ? 'tickets-resolved'
                : (normalized === 'tickets-pending' ? 'tickets-pending' : '');
            if (workbenchKey && scheduleAnalyticsWorkbenchOpen(workbenchKey, normalizedContext, 120)) {
                return true;
            }
            scheduleAnalyticsNavigationStep(() => {
                void openAnalyticsTicketsContext(
                    normalized.replace('tickets-', ''),
                    normalizedContext
                ).catch((error) => {
                    console.warn('[Analytics] Failed to open ticket destination:', error);
                });
            }, 120);
            return true;
        }
        case 'comments-guestbook': {
            const switched = window.switchModule?.('comments');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                if (typeof window.openAnalyticsCommentContext === 'function') {
                    window.openAnalyticsCommentContext({
                        ...normalizedContext,
                        view: 'guestbook'
                    });
                } else {
                    window.switchCommentView?.('guestbook');
                }
            });
            return true;
        }
        case 'comments-gallery': {
            const switched = window.switchModule?.('comments');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                if (typeof window.openAnalyticsCommentContext === 'function') {
                    window.openAnalyticsCommentContext({
                        ...normalizedContext,
                        view: 'gallery'
                    });
                } else {
                    window.switchCommentView?.('gallery');
                }
            });
            return true;
        }
        case 'settings-google-one': {
            const switched = window.switchModule?.('settings');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                window.switchSettingsView?.('google-one');
                void window.refreshVerifyMonitor?.(true)?.catch?.((error) => {
                    console.warn('[Analytics] Failed to refresh verify monitor from analytics:', error);
                });
                window.renderVerifyMonitorWorkbenchContext?.(normalizedContext);
                if (Object.keys(normalizedContext).length > 0) {
                    window.setTimeout(() => {
                        window.focusVerifyMonitorWorkspace?.(normalizedContext);
                    }, 160);
                }
            });
            return true;
        }
        case 'settings-affiliate': {
            const switched = window.switchModule?.('settings');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                window.switchSettingsView?.('affiliate');
                if (Object.keys(normalizedContext).length > 0) {
                    window.setTimeout(() => {
                        window.focusAffiliateSettingsContext?.(normalizedContext);
                    }, 140);
                }
            });
            return true;
        }
        case 'verify-monitor': {
            const switched = window.switchModule?.('settings');
            if (switched === false) return false;
            scheduleAnalyticsNavigationStep(() => {
                window.switchSettingsView?.('google-one');
                if (typeof window.openOpsAlertWorkspace === 'function') {
                    void Promise.resolve(window.openOpsAlertWorkspace('verify-monitor', normalizedContext)).catch((error) => {
                        console.warn('[Analytics] Failed to open verify monitor workspace:', error);
                    });
                } else {
                    void window.refreshVerifyMonitor?.(true)?.catch?.((error) => {
                        console.warn('[Analytics] Failed to refresh verify monitor from analytics:', error);
                    });
                    window.renderVerifyMonitorWorkbenchContext?.(normalizedContext);
                    if (Object.keys(normalizedContext).length > 0) {
                        window.setTimeout(() => {
                            window.focusVerifyMonitorWorkspace?.(normalizedContext);
                        }, 160);
                    }
                }
            }, 120);
            return true;
        }
        default: {
            console.warn('[Analytics] Unknown destination:', normalized);
            return false;
        }
    }
}

function getAnalyticsLedgerReason(row = {}) {
    return String(row?.reason || '').trim().toLowerCase();
}

function getAnalyticsLedgerReference(row = {}) {
    return String(row?.reference_id || '').trim().toUpperCase();
}

function truncateAnalyticsSnippet(value, maxLength = 36) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

function isAnalyticsCheckinRewardEntry(row = {}) {
    return getAnalyticsLedgerReason(row) === 'daily_checkin';
}

function isAnalyticsAffiliateRewardEntry(row = {}) {
    const reference = getAnalyticsLedgerReference(row);
    return reference.startsWith('AFFILIATE_REWARD_') || reference.startsWith('AFF_REW_');
}

function isAnalyticsActivationRewardEntry(row = {}) {
    return getAnalyticsLedgerReference(row).startsWith('REG_REWARD_UNLOCK_');
}

function isAnalyticsRegistrationRewardEntry(row = {}) {
    const reference = getAnalyticsLedgerReference(row);
    return reference.startsWith('REG_REWARD_') && !reference.startsWith('REG_REWARD_UNLOCK_');
}

function sumAnalyticsPositiveAmounts(rows = []) {
    return rows.reduce((sum, row) => {
        const amount = toNumericValue(row?.amount) || 0;
        return amount > 0 ? sum + amount : sum;
    }, 0);
}

function getVerifyStatusGroup(status = '') {
    const normalized = String(status || '').trim().toLowerCase();

    if (/success|succeed|completed|complete|verified|done|pass/.test(normalized)) {
        return 'success';
    }

    if (/process|pending|queue|running|retry|progress|active|submitted/.test(normalized)) {
        return 'active';
    }

    if (/fail|error|timeout|unsupported|reject|blocked|conflict|quota|disabled/.test(normalized)) {
        return 'failed';
    }

    return 'other';
}

function getVerifyStatusLabel(statusGroup = 'other') {
    switch (statusGroup) {
        case 'success':
            return '已完成';
        case 'active':
            return '处理中';
        case 'failed':
            return '失败/阻塞';
        default:
            return '其他状态';
    }
}

function getVerifyStatusTone(statusGroup = 'other') {
    switch (statusGroup) {
        case 'success':
            return 'success';
        case 'active':
            return 'warning';
        case 'failed':
            return 'danger';
        default:
            return 'neutral';
    }
}

function getAnalyticsVerificationSummary(row = {}) {
    return String(
        row.summary
        || row.message
        || row.error_message
        || row.stage_label
        || row.raw_status
        || ''
    ).trim();
}

function formatAnalyticsVerificationSample(row = {}) {
    const id = row?.verification_id || row?.email || row?.user_id || '验证任务';
    const status = getVerifyStatusLabel(getVerifyStatusGroup(row?.status));
    const summary = truncateAnalyticsSnippet(getAnalyticsVerificationSummary(row), 30);
    return [id, status, summary].filter(Boolean).join(' · ');
}

function getAnalyticsRewardLabel(row = {}) {
    if (isAnalyticsAffiliateRewardEntry(row)) return '返佣';
    if (isAnalyticsActivationRewardEntry(row)) return '首单激活';
    if (isAnalyticsRegistrationRewardEntry(row)) return '注册奖励';
    if (isAnalyticsCheckinRewardEntry(row)) return '签到';
    return '系统奖励';
}

function formatAnalyticsRewardSample(row = {}) {
    const label = getAnalyticsRewardLabel(row);
    const amount = toNumericValue(row?.amount) || 0;
    const reference = truncateAnalyticsSnippet(String(row?.reference_id || ''), 20);
    return [label, `${formatNumber(amount)} 积分`, reference].filter(Boolean).join(' · ');
}

function formatAnalyticsGuestbookMessageSample(row = {}) {
    const content = truncateAnalyticsSnippet(row?.content || row?.message || '未填写留言内容', 26);
    const timeLabel = formatAnalyticsDateTime(row?.created_at);
    return [timeLabel, content].filter(Boolean).join(' · ');
}

function buildAnalyticsRecommendationExportRows(section, items = []) {
    return (Array.isArray(items) ? items : []).map((item) => ({
        '板块': section,
        '优先级': item.level || '观察',
        '标题': item.title || '待处理项',
        '摘要': item.summary || '',
        '建议动作': item.actionLabel || '',
        '跳转目标': item.destination || '',
        '样本线索': Array.isArray(item.sampleItems) ? item.sampleItems.join(' | ') : ''
    }));
}

function buildAnalyticsBusinessAnomalyExportRows(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => ({
        '板块': item.panel || '经营异常',
        '优先级': item.level || '观察',
        '标题': item.title || '异常卡片',
        '核心指标': [item.metricLabel || '', item.metricValue || ''].filter(Boolean).join('：'),
        '摘要': item.summary || '',
        '建议动作': item.actionLabel || '',
        '跳转目标': item.destination || '',
        '样本线索': Array.isArray(item.sampleItems) ? item.sampleItems.join(' | ') : ''
    }));
}

function buildAnalyticsExperimentSuggestionExportRows(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => ({
        '优先级': item.level || '观察',
        '实验名称': item.title || '实验建议',
        '目标站点': item.siteLabel || '',
        '实验方向': item.experimentLabel || '',
        '目标指标': item.targetMetricLabel || '',
        '摘要': item.summary || '',
        '建议动作': item.actionLabel || '',
        '样本线索': Array.isArray(item.sampleItems) ? item.sampleItems.join(' | ') : ''
    }));
}

function enrichOverviewBusinessMixSummaryWithEvents(summary = {}, summaryWindow = {}) {
    if (!summary || typeof summary !== 'object') {
        return summary;
    }

    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    const hasContentEvents = hasAnalyticsEventActivity(summaryWindow, ['prompt_view_count', 'unlock_click_count', 'unlock_success_count']);
    const hasVerifyEvents = hasAnalyticsEventActivity(summaryWindow, ['verify_submit_count', 'verify_success_count', 'verify_fail_count']);
    const hasBusinessEvents = normalizeAnalyticsCountValue(eventOverview.business_active_users) > 0;

    if (!hasContentEvents && !hasVerifyEvents && !hasBusinessEvents) {
        return summary;
    }

    const metrics = summary.metrics && typeof summary.metrics === 'object'
        ? { ...summary.metrics }
        : {};
    const promptViewCount = normalizeAnalyticsCountValue(eventOverview.prompt_view_count);
    const unlockClickCount = normalizeAnalyticsCountValue(eventOverview.unlock_click_count);
    const unlockCount = hasContentEvents
        ? normalizeAnalyticsCountValue(eventOverview.unlock_success_count)
        : normalizeAnalyticsCountValue(metrics.unlockCount);
    const verifyRequestCount = hasVerifyEvents
        ? normalizeAnalyticsCountValue(eventOverview.verify_submit_count)
        : normalizeAnalyticsCountValue(metrics.verifyRequestCount);
    const verifySuccessCount = hasVerifyEvents
        ? normalizeAnalyticsCountValue(eventOverview.verify_success_count)
        : normalizeAnalyticsCountValue(metrics.verifySuccessCount);
    const verifyFailedCount = hasVerifyEvents
        ? normalizeAnalyticsCountValue(eventOverview.verify_fail_count)
        : 0;
    const verifySuccessRate = hasVerifyEvents
        ? (roundTo(normalizeAnalyticsNumber(eventOverview.verify_success_rate), 2) || 0)
        : normalizeAnalyticsNumber(metrics.verifySuccessRate);
    const businessActiveUsers = hasBusinessEvents
        ? normalizeAnalyticsCountValue(eventOverview.business_active_users)
        : 0;

    metrics.unlockCount = unlockCount;
    metrics.verifyRequestCount = verifyRequestCount;
    metrics.verifySuccessCount = verifySuccessCount;
    metrics.verifySuccessRate = verifySuccessRate;
    if (businessActiveUsers > 0) {
        metrics.businessActiveUsers = businessActiveUsers;
    }

    const items = Array.isArray(summary.items)
        ? summary.items.map((item) => {
            if (!item || typeof item !== 'object') {
                return item;
            }

            if (hasContentEvents && /内容/.test(String(item.title || ''))) {
                return {
                    ...item,
                    value: formatNumber(unlockCount),
                    meta: `真实事件：浏览 ${formatNumber(promptViewCount)} / 点击 ${formatNumber(unlockClickCount)}`,
                    summary: '优先采用真实浏览、点击和解锁事件衡量内容消费'
                };
            }

            if (hasVerifyEvents && /验证/.test(String(item.title || ''))) {
                return {
                    ...item,
                    value: formatNumber(verifyRequestCount),
                    meta: `成功 ${formatNumber(verifySuccessCount)} / 失败 ${formatNumber(verifyFailedCount)}`,
                    summary: `真实事件成功率 ${formatPercent(verifySuccessRate)}`
                };
            }

            if (hasBusinessEvents && /积分|活跃/.test(String(item.title || ''))) {
                return {
                    ...item,
                    meta: `经营活跃用户 ${formatNumber(businessActiveUsers)}`,
                    summary: item.summary || '优先采用真实业务事件回看窗口活跃'
                };
            }

            return item;
        })
        : [];

    let recommendations = Array.isArray(summary.recommendations)
        ? [...summary.recommendations]
        : [];

    if (
        hasVerifyEvents
        && verifyRequestCount > 0
        && (verifyFailedCount > 0 || verifySuccessRate < 85)
        && !recommendations.some((item) => item?.destination === 'verify-monitor')
    ) {
        recommendations.unshift({
            tone: verifyFailedCount > 0 || verifySuccessRate < 70 ? 'danger' : 'warning',
            level: verifyFailedCount > 0 ? '优先处理' : '建议复核',
            title: verifyFailedCount > 0 ? '真实事件显示验证仍有失败样本' : '真实事件显示验证成功率偏低',
            summary: verifyFailedCount > 0
                ? `当前窗口记录到 ${formatNumber(verifyFailedCount)} 次验证失败，建议优先进入 Verify Monitor 继续收口。`
                : `当前窗口真实事件验证成功率约 ${formatPercent(verifySuccessRate)}，建议复核队列和配置状态。`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square'
        });
    }

    const exportRows = Array.isArray(summary.exportRows)
        ? summary.exportRows.map((row) => {
            const metricLabel = String(row?.['指标'] || '');
            if (hasContentEvents && /内容/.test(metricLabel)) {
                return {
                    ...row,
                    '数值': unlockCount,
                    '说明': `真实事件：浏览 ${promptViewCount} / 点击 ${unlockClickCount}`
                };
            }
            if (hasVerifyEvents && /验证/.test(metricLabel)) {
                return {
                    ...row,
                    '数值': verifyRequestCount,
                    '说明': `成功 ${verifySuccessCount} / 失败 ${verifyFailedCount} / 成功率 ${formatPercent(verifySuccessRate)}`
                };
            }
            return row;
        })
        : [];

    if (hasVerifyEvents && !exportRows.some((row) => /验证/.test(String(row?.['指标'] || '')))) {
        exportRows.push({
            '指标': '验证请求',
            '数值': verifyRequestCount,
            '说明': `成功 ${verifySuccessCount} / 失败 ${verifyFailedCount} / 成功率 ${formatPercent(verifySuccessRate)}`
        });
    }

    return {
        ...summary,
        metrics,
        items,
        recommendations: recommendations.slice(0, 3),
        exportRows
    };
}

function enrichVerifyServiceSummaryWithEvents(summary = {}, summaryWindow = {}) {
    if (!summary || typeof summary !== 'object') {
        return summary;
    }

    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    const hasVerifyEvents = hasAnalyticsEventActivity(summaryWindow, ['verify_submit_count', 'verify_success_count', 'verify_fail_count']);
    if (!hasVerifyEvents) {
        return summary;
    }

    const metrics = summary.metrics && typeof summary.metrics === 'object'
        ? { ...summary.metrics }
        : {};
    const requestCount = normalizeAnalyticsCountValue(eventOverview.verify_submit_count);
    const successCount = normalizeAnalyticsCountValue(eventOverview.verify_success_count);
    const failedCount = normalizeAnalyticsCountValue(eventOverview.verify_fail_count);
    const successRate = roundTo(normalizeAnalyticsNumber(eventOverview.verify_success_rate), 2) || 0;
    const totalPointsCost = normalizeAnalyticsNumber(metrics.totalPointsCost);
    const avgPointsCostPerSuccess = successCount > 0
        ? (roundTo(totalPointsCost / successCount, 1) || 0)
        : 0;

    metrics.requestCount = requestCount;
    metrics.successCount = successCount;
    metrics.failedCount = failedCount;
    metrics.successRate = successRate;
    metrics.avgPointsCostPerSuccess = avgPointsCostPerSuccess;

    const statusItems = Array.isArray(summary.statusItems)
        ? summary.statusItems.map((item) => {
            if (!item || typeof item !== 'object') {
                return item;
            }

            const title = String(item.title || '');
            if (title === '已完成') {
                return {
                    ...item,
                    value: formatNumber(successCount),
                    meta: `占真实请求 ${formatPercent(successRate)}`,
                    summary: '优先采用真实提交与成功事件衡量完成产能'
                };
            }
            if (title === '失败 / 阻塞') {
                return {
                    ...item,
                    value: formatNumber(failedCount),
                    meta: '真实失败事件样本',
                    summary: '来自真实验证失败事件，适合和 Verify Monitor 一起排查'
                };
            }
            return item;
        })
        : [];

    const recommendations = Array.isArray(summary.recommendations)
        ? summary.recommendations.map((item) => {
            if (!item || typeof item !== 'object') {
                return item;
            }

            if (item.destination === 'verify-monitor') {
                return {
                    ...item,
                    summary: `当前窗口真实事件记录到 ${formatNumber(failedCount)} 次失败，建议优先进入 Verify Monitor 收口。`
                };
            }

            if (item.destination === 'settings-google-one') {
                return {
                    ...item,
                    summary: `当前窗口真实事件验证成功率约 ${formatPercent(successRate)}，建议继续检查额度、接口状态和队列。`
                };
            }

            return item;
        })
        : [];

    return {
        ...summary,
        metrics,
        statusItems,
        recommendations
    };
}

function enrichGrowthSummaryWithEvents(summary = {}, summaryWindow = {}) {
    if (!summary || typeof summary !== 'object') {
        return summary;
    }

    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    const hasGuestbookEvents = hasAnalyticsEventActivity(summaryWindow, ['guestbook_post_count']);
    const hasInviteEvents = hasAnalyticsEventActivity(summaryWindow, ['affiliate_invite_click_count']);
    const hasCheckinEvents = hasAnalyticsEventActivity(summaryWindow, ['checkin_success_count']);
    if (!hasGuestbookEvents && !hasInviteEvents && !hasCheckinEvents) {
        return summary;
    }

    const metrics = summary.metrics && typeof summary.metrics === 'object'
        ? { ...summary.metrics }
        : {};
    const guestbookPostCount = hasGuestbookEvents
        ? normalizeAnalyticsCountValue(eventOverview.guestbook_post_count)
        : normalizeAnalyticsCountValue(metrics.guestbookMessageCount);
    const affiliateInviteClickCount = hasInviteEvents
        ? normalizeAnalyticsCountValue(eventOverview.affiliate_invite_click_count)
        : 0;
    const checkinSuccessCount = hasCheckinEvents
        ? normalizeAnalyticsCountValue(eventOverview.checkin_success_count)
        : 0;

    metrics.guestbookMessageCount = guestbookPostCount;
    metrics.affiliateInviteClickCount = affiliateInviteClickCount;
    metrics.checkinSuccessCount = checkinSuccessCount;

    const breakdownItems = Array.isArray(summary.breakdownItems)
        ? summary.breakdownItems.map((item) => {
            if (!item || typeof item !== 'object') {
                return item;
            }

            if (/留言板|社区反馈/.test(String(item.title || '')) && hasGuestbookEvents) {
                return {
                    ...item,
                    meta: String(item.title || '').includes('社区反馈')
                        ? `真实发帖 ${formatNumber(guestbookPostCount)} / 当前反馈 ${formatNumber(metrics.guestbookCommentCount || 0)}`
                        : `发帖 ${formatNumber(guestbookPostCount)} / 评论 ${formatNumber(metrics.guestbookCommentCount || 0)} / 点赞 ${formatNumber(metrics.guestbookLikeCount || 0)}`,
                    summary: '留言板发帖优先采用真实发布事件'
                };
            }

            if (String(item.title || '') === '分销返佣' && hasInviteEvents) {
                return {
                    ...item,
                    meta: `${String(item.meta || '').trim()} / 邀请点击 ${formatNumber(affiliateInviteClickCount)}`.replace(/^ \/ /, ''),
                    summary: '同时参考真实邀请点击事件，判断返佣和裂变是否同向增长'
                };
            }

            if (String(item.title || '') === '签到奖励' && hasCheckinEvents) {
                return {
                    ...item,
                    meta: `${String(item.meta || '').trim()} / 签到成功 ${formatNumber(checkinSuccessCount)}`.replace(/^ \/ /, ''),
                    summary: '同时参考真实签到成功事件，判断补贴是否正在拉活'
                };
            }

            return item;
        })
        : [];

    const recommendations = Array.isArray(summary.recommendations)
        ? summary.recommendations.map((item) => {
            if (!item || typeof item !== 'object') {
                return item;
            }

            if (item.destination === 'settings-affiliate' && hasInviteEvents) {
                return {
                    ...item,
                    summary: `${String(item.summary || '').trim()} 当前窗口邀请点击 ${formatNumber(affiliateInviteClickCount)} 次。`.trim()
                };
            }

            if (item.destination === 'points' && hasCheckinEvents) {
                return {
                    ...item,
                    summary: `${String(item.summary || '').trim()} 当前窗口签到成功 ${formatNumber(checkinSuccessCount)} 次。`.trim()
                };
            }

            return item;
        })
        : [];

    const exportRows = Array.isArray(summary.exportRows)
        ? [...summary.exportRows]
        : [];

    if (hasGuestbookEvents) {
        exportRows.push({
            '指标': '留言板发帖事件',
            '数值': guestbookPostCount,
            '说明': '真实 guestbook_post 事件'
        });
    }
    if (hasInviteEvents) {
        exportRows.push({
            '指标': '邀请点击事件',
            '数值': affiliateInviteClickCount,
            '说明': '真实 affiliate_invite_click 事件'
        });
    }
    if (hasCheckinEvents) {
        exportRows.push({
            '指标': '签到成功事件',
            '数值': checkinSuccessCount,
            '说明': '真实 checkin_success 事件'
        });
    }

    return {
        ...summary,
        metrics,
        breakdownItems,
        recommendations,
        exportRows
    };
}

function getAnalyticsPercentRate(numerator, denominator, digits = 2) {
    const numeratorValue = normalizeAnalyticsNumber(numerator);
    const denominatorValue = normalizeAnalyticsNumber(denominator);
    if (!denominatorValue) return 0;
    return roundTo((numeratorValue / denominatorValue) * 100, digits) || 0;
}

function getAnalyticsRateBadgeTone(rate, thresholds = {}) {
    const value = normalizeAnalyticsNumber(rate);
    const {
        successAbove = 65,
        warningAbove = 30
    } = thresholds;

    if (value >= successAbove) return 'success';
    if (value >= warningAbove) return 'warning';
    return 'danger';
}

function getAnalyticsSiteLabel(site = '') {
    return String(site || '').trim().toLowerCase() === 'intl' ? 'INTL' : 'CN';
}

function getAnalyticsChannelBreakdownVolume(row = {}) {
    return normalizeAnalyticsNumber(
        row?.event_count
        || row?.user_count
        || row?.unlock_success_count
        || row?.verify_submit_count
        || row?.recharge_success_count
        || row?.shop_purchase_count
        || row?.total_points
        || row?.used_codes
        || row?.batch_count
    );
}

function getAnalyticsTopContentSignal(row = {}) {
    return normalizeAnalyticsNumber(
        row?.score
        || row?.view_count
        || row?.unlock_count
        || row?.comment_count
    );
}

function buildAnalyticsTopCategorySnapshot(rows = []) {
    const categoryMap = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const name = String(row?.category || '未分类').trim() || '未分类';
        const signal = getAnalyticsTopContentSignal(row);
        const current = categoryMap.get(name) || 0;
        categoryMap.set(name, current + signal);
    });

    return [...categoryMap.entries()]
        .map(([name, signal]) => ({ name, signal }))
        .sort((left, right) => right.signal - left.signal)[0] || null;
}

function buildAnalyticsSiteSnapshot(site = '', summaryWindow = {}) {
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summaryWindow);
    const channelRows = Array.isArray(summaryWindow?.channel_breakdown) ? summaryWindow.channel_breakdown : [];
    const topContentRows = Array.isArray(summaryWindow?.top_content) ? summaryWindow.top_content : [];
    const commerce = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};
    const verify = eventFunnels?.verify && typeof eventFunnels.verify === 'object'
        ? eventFunnels.verify
        : {};
    const growth = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};

    const businessActiveUsers = normalizeAnalyticsCountValue(eventOverview.business_active_users);
    const verifySubmitUsers = normalizeAnalyticsCountValue(verify.submit_users ?? eventOverview.verify_submit_users);
    const verifySuccessRate = normalizeAnalyticsNumber(verify.success_rate) || getAnalyticsPercentRate(
        normalizeAnalyticsCountValue(verify.success_users ?? eventOverview.verify_success_users),
        verifySubmitUsers
    );
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerce.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerce.recharge_success_users ?? eventOverview.recharge_success_users);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerce.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewUsers = normalizeAnalyticsCountValue(commerce.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerce.shop_purchase_users ?? eventOverview.shop_purchase_users);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerce.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);
    const inviteClickUsers = normalizeAnalyticsCountValue(growth.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const inviteCoverageRate = getAnalyticsPercentRate(inviteClickUsers, businessActiveUsers);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growth.checkin_success_users ?? eventOverview.checkin_success_users);
    const checkinCoverageRate = getAnalyticsPercentRate(checkinSuccessUsers, businessActiveUsers);
    const promptUnlockUsers = normalizeAnalyticsCountValue(eventOverview.unlock_success_users);
    const promptViewUsers = normalizeAnalyticsCountValue(eventOverview.prompt_view_users);
    const unlockRate = normalizeAnalyticsNumber(eventOverview.unlock_rate) || getAnalyticsPercentRate(promptUnlockUsers, promptViewUsers);
    const topChannel = [...channelRows]
        .map((row) => ({
            name: String(row?.channel || '未分类').trim() || '未分类',
            sourceKind: String(row?.source_kind || '').trim() || '业务入口',
            shareRate: normalizeAnalyticsNumber(row?.share_rate),
            volume: getAnalyticsChannelBreakdownVolume(row)
        }))
        .sort((left, right) => right.volume - left.volume)[0] || null;
    const topContent = [...topContentRows]
        .map((row) => ({
            title: String(row?.title || row?.prompt_id || '热门 Prompt').trim() || '热门 Prompt',
            promptId: String(row?.prompt_id || '').trim(),
            category: String(row?.category || '未分类').trim() || '未分类',
            signal: getAnalyticsTopContentSignal(row),
            viewCount: normalizeAnalyticsCountValue(row?.view_count),
            unlockCount: normalizeAnalyticsCountValue(row?.unlock_count)
        }))
        .sort((left, right) => right.signal - left.signal)[0] || null;
    const topCategory = buildAnalyticsTopCategorySnapshot(topContentRows);

    return {
        site: String(site || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn',
        label: getAnalyticsSiteLabel(site),
        summaryWindow,
        metrics: {
            businessActiveUsers,
            verifySubmitUsers,
            verifySuccessRate,
            rechargeClickUsers,
            rechargeSuccessUsers,
            rechargeSuccessRate,
            shopViewUsers,
            shopPurchaseUsers,
            shopPurchaseRate,
            inviteClickUsers,
            inviteCoverageRate,
            checkinSuccessUsers,
            checkinCoverageRate,
            promptViewUsers,
            promptUnlockUsers,
            unlockRate
        },
        topChannel,
        topContent,
        topCategory
    };
}

function buildAnalyticsSiteComparisonPayload(snapshots = []) {
    const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
        .filter((item) => item && typeof item === 'object');
    const cnSnapshot = normalizedSnapshots.find((item) => item.site === 'cn') || null;
    const intlSnapshot = normalizedSnapshots.find((item) => item.site === 'intl') || null;

    if (!cnSnapshot || !intlSnapshot) {
        return {
            mode: normalizedSnapshots.length ? 'single' : 'empty',
            activeSite: normalizedSnapshots[0]?.site || '',
            focusSite: normalizedSnapshots[0]?.site || '',
            snapshots: normalizedSnapshots,
            insights: []
        };
    }

    const comparisons = [
        {
            key: 'verifySuccessRate',
            label: '验证成功率',
            unit: '%',
            cnValue: normalizeAnalyticsNumber(cnSnapshot.metrics.verifySuccessRate),
            intlValue: normalizeAnalyticsNumber(intlSnapshot.metrics.verifySuccessRate),
            betterHigh: true
        },
        {
            key: 'rechargeSuccessRate',
            label: '充值成功率',
            unit: '%',
            cnValue: normalizeAnalyticsNumber(cnSnapshot.metrics.rechargeSuccessRate),
            intlValue: normalizeAnalyticsNumber(intlSnapshot.metrics.rechargeSuccessRate),
            betterHigh: true
        },
        {
            key: 'shopPurchaseRate',
            label: '商城成交率',
            unit: '%',
            cnValue: normalizeAnalyticsNumber(cnSnapshot.metrics.shopPurchaseRate),
            intlValue: normalizeAnalyticsNumber(intlSnapshot.metrics.shopPurchaseRate),
            betterHigh: true
        },
        {
            key: 'inviteCoverageRate',
            label: '邀请覆盖率',
            unit: '%',
            cnValue: normalizeAnalyticsNumber(cnSnapshot.metrics.inviteCoverageRate),
            intlValue: normalizeAnalyticsNumber(intlSnapshot.metrics.inviteCoverageRate),
            betterHigh: true
        }
    ].map((item) => {
        const diff = roundTo(item.cnValue - item.intlValue, 1) || 0;
        const focusSite = diff === 0
            ? ''
            : (diff > 0 ? 'intl' : 'cn');
        return {
            ...item,
            diff,
            focusSite,
            focusLabel: focusSite ? getAnalyticsSiteLabel(focusSite) : ''
        };
    });

    const rankedComparisons = [...comparisons].sort((left, right) => Math.abs(right.diff) - Math.abs(left.diff));
    const topGap = rankedComparisons[0] || null;
    const focusSite = topGap?.focusSite || (
        normalizeAnalyticsNumber(cnSnapshot.metrics.businessActiveUsers) >= normalizeAnalyticsNumber(intlSnapshot.metrics.businessActiveUsers)
            ? 'intl'
            : 'cn'
    );
    const focusLabel = getAnalyticsSiteLabel(focusSite);
    const focusSnapshot = focusSite === 'intl' ? intlSnapshot : cnSnapshot;
    const insights = rankedComparisons
        .filter((item) => Math.abs(item.diff) >= 8)
        .slice(0, 3)
        .map((item) => `${item.label}：CN ${trimTrailingZeros(item.cnValue.toFixed(1))}% / INTL ${trimTrailingZeros(item.intlValue.toFixed(1))}% ，当前更弱的是 ${item.focusLabel || '两站接近'}`);

    if (focusSnapshot?.topChannel?.name) {
        insights.push(`${focusLabel} 当前主要入口是 ${focusSnapshot.topChannel.name}，来源类型 ${focusSnapshot.topChannel.sourceKind}`);
    }
    if (focusSnapshot?.topCategory?.name) {
        insights.push(`${focusLabel} 当前内容热度更集中在 ${focusSnapshot.topCategory.name} 分类`);
    }
    if (focusSnapshot?.topContent?.title) {
        insights.push(`${focusLabel} 当前最热 Prompt 是《${focusSnapshot.topContent.title}》`);
    }

    return {
        mode: 'compare',
        activeSite: 'all',
        focusSite,
        focusLabel,
        focusSnapshot,
        topGap,
        snapshots: normalizedSnapshots,
        comparisons,
        insights: insights.slice(0, 6)
    };
}

function renderAnalyticsAISiteComparison(comparisonData = null) {
    if (!comparisonData || comparisonData.mode !== 'compare' || !Array.isArray(comparisonData.snapshots) || comparisonData.snapshots.length < 2) {
        return '';
    }

    const snapshotCards = comparisonData.snapshots.map((snapshot) => {
        const metrics = snapshot.metrics || {};
        const isFocus = snapshot.site === comparisonData.focusSite;
        return `
            <article class="ai-site-card ai-site-card--${isFocus ? 'focus' : 'default'}">
                <div class="ai-site-card__top">
                    <strong class="ai-site-card__title">${escapeHtml(snapshot.label || '站点')}</strong>
                    <span class="analytics-status-chip analytics-status-chip--${isFocus ? 'warning' : 'neutral'}">${isFocus ? '优先关注' : '对照样本'}</span>
                </div>
                <div class="ai-site-card__metrics">
                    <span>经营活跃 ${formatNumber(metrics.businessActiveUsers || 0)}</span>
                    <span>验证 ${formatPercent(metrics.verifySuccessRate || 0)}</span>
                    <span>充值 ${formatPercent(metrics.rechargeSuccessRate || 0)}</span>
                    <span>成交 ${formatPercent(metrics.shopPurchaseRate || 0)}</span>
                    <span>邀请覆盖 ${formatPercent(metrics.inviteCoverageRate || 0)}</span>
                    ${snapshot.topChannel?.name ? `<span>入口 ${escapeHtml(snapshot.topChannel.name)}</span>` : ''}
                    ${snapshot.topCategory?.name ? `<span>分类 ${escapeHtml(snapshot.topCategory.name)}</span>` : ''}
                    ${snapshot.topContent?.title ? `<span>Prompt ${escapeHtml(truncateAnalyticsSnippet(snapshot.topContent.title, 18))}</span>` : ''}
                </div>
            </article>
        `;
    }).join('');

    const insightsMarkup = Array.isArray(comparisonData.insights) && comparisonData.insights.length > 0
        ? `
            <div class="ai-site-board__insights">
                ${comparisonData.insights.map((item) => `<span class="ai-site-board__insight-pill">${escapeHtml(item)}</span>`).join('')}
            </div>
        `
        : '';

    return `
        <section class="ai-site-board">
            <div class="ai-site-board__header">
                <div>
                    <p class="ai-site-board__eyebrow">站点对比</p>
                    <h4 class="ai-site-board__title">当前窗口的 CN / INTL 经营差异</h4>
                </div>
                <span class="ai-site-board__meta">当前更值得先看 ${escapeHtml(comparisonData.focusLabel || '目标站点')}</span>
            </div>
            <div class="ai-site-grid">
                ${snapshotCards}
            </div>
            ${insightsMarkup}
        </section>
    `;
}

function buildCommerceEventFunnelViewData(summaryWindow = {}) {
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summaryWindow);
    const commerce = eventFunnels?.commerce && typeof eventFunnels.commerce === 'object'
        ? eventFunnels.commerce
        : {};

    const businessActiveUsers = normalizeAnalyticsCountValue(eventOverview.business_active_users);
    const walletOpenCount = normalizeAnalyticsCountValue(commerce.wallet_open_count ?? eventOverview.wallet_open_count);
    const walletOpenUsers = normalizeAnalyticsCountValue(commerce.wallet_open_users ?? eventOverview.wallet_open_users);
    const rechargeClickCount = normalizeAnalyticsCountValue(commerce.recharge_click_count ?? eventOverview.recharge_click_count);
    const rechargeClickUsers = normalizeAnalyticsCountValue(commerce.recharge_click_users ?? eventOverview.recharge_click_users);
    const rechargeSuccessCount = normalizeAnalyticsCountValue(commerce.recharge_success_count ?? eventOverview.recharge_success_count);
    const rechargeSuccessUsers = normalizeAnalyticsCountValue(commerce.recharge_success_users ?? eventOverview.recharge_success_users);
    const shopViewCount = normalizeAnalyticsCountValue(commerce.shop_view_count ?? eventOverview.shop_view_count);
    const shopViewUsers = normalizeAnalyticsCountValue(commerce.shop_view_users ?? eventOverview.shop_view_users);
    const shopPurchaseCount = normalizeAnalyticsCountValue(commerce.shop_purchase_count ?? eventOverview.shop_purchase_count);
    const shopPurchaseUsers = normalizeAnalyticsCountValue(commerce.shop_purchase_users ?? eventOverview.shop_purchase_users);

    const hasData = [
        walletOpenCount,
        rechargeClickCount,
        rechargeSuccessCount,
        shopViewCount,
        shopPurchaseCount
    ].some((value) => value > 0);

    if (!hasData) {
        return {
            items: [],
            exportRows: []
        };
    }

    const walletCoverageRate = getAnalyticsPercentRate(walletOpenUsers, businessActiveUsers);
    const rechargeIntentRate = getAnalyticsPercentRate(rechargeClickUsers, walletOpenUsers);
    const rechargeSuccessRate = normalizeAnalyticsNumber(commerce.recharge_success_rate) || getAnalyticsPercentRate(rechargeSuccessUsers, rechargeClickUsers);
    const shopViewCoverageRate = getAnalyticsPercentRate(shopViewUsers, businessActiveUsers);
    const shopPurchaseRate = normalizeAnalyticsNumber(commerce.shop_purchase_rate) || getAnalyticsPercentRate(shopPurchaseUsers, shopViewUsers);

    return {
        items: [
            {
                title: '钱包打开',
                value: formatNumber(walletOpenUsers),
                meta: `${formatNumber(walletOpenCount)} 次打开`,
                badgeLabel: businessActiveUsers > 0 ? `覆盖 ${formatPercent(walletCoverageRate)}` : '真实事件',
                badgeTone: businessActiveUsers > 0 ? getAnalyticsRateBadgeTone(walletCoverageRate, { successAbove: 35, warningAbove: 15 }) : 'neutral',
                summary: '作为充值和消费链路的起点，优先看真实 wallet_open 事件。',
                actionLabel: '看积分与交易',
                destination: 'analytics-monetization',
                icon: 'fas fa-wallet',
                context: {
                    sectionId: 'commerceEventFunnel'
                }
            },
            {
                title: '充值点击',
                value: formatNumber(rechargeClickUsers),
                meta: `${formatNumber(rechargeClickCount)} 次点击`,
                badgeLabel: `占钱包打开 ${formatPercent(rechargeIntentRate)}`,
                badgeTone: getAnalyticsRateBadgeTone(rechargeIntentRate, { successAbove: 45, warningAbove: 20 }),
                summary: '反映从钱包浏览到充值意图的真实转化。',
                actionLabel: rechargeSuccessRate < 60 ? '去支付排查' : '看积分与交易',
                destination: rechargeSuccessRate < 60 ? 'payments-queue' : 'analytics-monetization',
                icon: rechargeSuccessRate < 60 ? 'fas fa-credit-card' : 'fas fa-wallet',
                context: rechargeSuccessRate < 60
                    ? { focusQueue: true, sectionId: 'paymentsOpsAlertQueuePanel' }
                    : { sectionId: 'commerceEventFunnel' }
            },
            {
                title: '充值成功',
                value: formatNumber(rechargeSuccessUsers),
                meta: `${formatNumber(rechargeSuccessCount)} 次完成`,
                badgeLabel: `成功率 ${formatPercent(rechargeSuccessRate)}`,
                badgeTone: getAnalyticsRateBadgeTone(rechargeSuccessRate, { successAbove: 65, warningAbove: 35 }),
                summary: '用于排查充值链路是否在点击后顺利闭环。',
                actionLabel: rechargeSuccessRate < 60 ? '去支付排查' : '看积分与交易',
                destination: rechargeSuccessRate < 60 ? 'payments-queue' : 'analytics-monetization',
                icon: rechargeSuccessRate < 60 ? 'fas fa-credit-card' : 'fas fa-wallet',
                context: rechargeSuccessRate < 60
                    ? { focusQueue: true, sectionId: 'paymentsOpsAlertQueuePanel' }
                    : { sectionId: 'commerceEventFunnel' }
            },
            {
                title: '商城浏览',
                value: formatNumber(shopViewUsers),
                meta: `${formatNumber(shopViewCount)} 次浏览`,
                badgeLabel: businessActiveUsers > 0 ? `覆盖 ${formatPercent(shopViewCoverageRate)}` : '真实事件',
                badgeTone: businessActiveUsers > 0 ? getAnalyticsRateBadgeTone(shopViewCoverageRate, { successAbove: 25, warningAbove: 10 }) : 'neutral',
                summary: '帮助判断充值后是否有足够用户继续进入商城消费场景。',
                actionLabel: '看积分与交易',
                destination: 'analytics-monetization',
                icon: 'fas fa-wallet',
                context: {
                    sectionId: 'commerceEventFunnel'
                }
            },
            {
                title: '商城成交',
                value: formatNumber(shopPurchaseUsers),
                meta: `${formatNumber(shopPurchaseCount)} 次成交`,
                badgeLabel: `占商城浏览 ${formatPercent(shopPurchaseRate)}`,
                badgeTone: getAnalyticsRateBadgeTone(shopPurchaseRate, { successAbove: 30, warningAbove: 12 }),
                summary: '真实成交事件优先衡量商城的最终消费转化。',
                actionLabel: '看积分与交易',
                destination: 'analytics-monetization',
                icon: 'fas fa-wallet',
                context: {
                    sectionId: 'commerceEventFunnel'
                }
            }
        ],
        exportRows: [
            { '阶段': '钱包打开', '用户数': walletOpenUsers, '事件数': walletOpenCount, '比率(%)': walletCoverageRate, '说明': '真实 wallet_open 事件，口径为覆盖经营活跃用户' },
            { '阶段': '充值点击', '用户数': rechargeClickUsers, '事件数': rechargeClickCount, '比率(%)': rechargeIntentRate, '说明': '真实 recharge_click 事件，口径为占钱包打开用户' },
            { '阶段': '充值成功', '用户数': rechargeSuccessUsers, '事件数': rechargeSuccessCount, '比率(%)': rechargeSuccessRate, '说明': '真实 recharge_success 事件，口径为占充值点击用户' },
            { '阶段': '商城浏览', '用户数': shopViewUsers, '事件数': shopViewCount, '比率(%)': shopViewCoverageRate, '说明': '真实 shop_view 事件，口径为覆盖经营活跃用户' },
            { '阶段': '商城成交', '用户数': shopPurchaseUsers, '事件数': shopPurchaseCount, '比率(%)': shopPurchaseRate, '说明': '真实 shop_purchase 事件，口径为占商城浏览用户' }
        ]
    };
}

function buildVerifyEventFunnelViewData(summaryWindow = {}) {
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summaryWindow);
    const verify = eventFunnels?.verify && typeof eventFunnels.verify === 'object'
        ? eventFunnels.verify
        : {};

    const submitCount = normalizeAnalyticsCountValue(verify.submit_count ?? eventOverview.verify_submit_count);
    const submitUsers = normalizeAnalyticsCountValue(verify.submit_users ?? eventOverview.verify_submit_users);
    const successCount = normalizeAnalyticsCountValue(verify.success_count ?? eventOverview.verify_success_count);
    const successUsers = normalizeAnalyticsCountValue(verify.success_users ?? eventOverview.verify_success_users);
    const failCount = normalizeAnalyticsCountValue(verify.fail_count ?? eventOverview.verify_fail_count);
    const failUsers = normalizeAnalyticsCountValue(verify.fail_users ?? eventOverview.verify_fail_users);

    const hasData = [submitCount, successCount, failCount].some((value) => value > 0);
    if (!hasData) {
        return {
            items: [],
            exportRows: []
        };
    }

    const successRate = normalizeAnalyticsNumber(verify.success_rate) || getAnalyticsPercentRate(successUsers, submitUsers);
    const failRate = getAnalyticsPercentRate(failUsers, submitUsers);

    return {
        items: [
            {
                title: '提交任务',
                value: formatNumber(submitUsers),
                meta: `${formatNumber(submitCount)} 次提交`,
                badgeLabel: '真实事件',
                badgeTone: 'neutral',
                summary: '优先采用 verify_submit 事件衡量窗口内的真实需求量。',
                actionLabel: '打开 Verify Monitor',
                destination: 'verify-monitor',
                icon: 'fas fa-wave-square'
            },
            {
                title: '成功完成',
                value: formatNumber(successUsers),
                meta: `${formatNumber(successCount)} 次完成`,
                badgeLabel: `完成率 ${formatPercent(successRate)}`,
                badgeTone: getAnalyticsRateBadgeTone(successRate, { successAbove: 80, warningAbove: 55 }),
                summary: '用于快速判断当前验证产能是否正常闭环。',
                actionLabel: successRate < 80 ? '检查验证配置' : '打开 Verify Monitor',
                destination: successRate < 80 ? 'settings-google-one' : 'verify-monitor',
                icon: successRate < 80 ? 'fas fa-sliders' : 'fas fa-wave-square'
            },
            {
                title: '失败样本',
                value: formatNumber(failUsers),
                meta: `${formatNumber(failCount)} 次失败`,
                badgeLabel: `占提交 ${formatPercent(failRate)}`,
                badgeTone: failUsers > 0 ? getAnalyticsRateBadgeTone(100 - failRate, { successAbove: 92, warningAbove: 80 }) : 'neutral',
                summary: '直接对应 verify_fail 事件，适合联动 Verify Monitor 收口。',
                actionLabel: '打开 Verify Monitor',
                destination: 'verify-monitor',
                icon: 'fas fa-wave-square'
            }
        ],
        exportRows: [
            { '阶段': '提交任务', '用户数': submitUsers, '事件数': submitCount, '比率(%)': 100, '说明': '真实 verify_submit 事件' },
            { '阶段': '成功完成', '用户数': successUsers, '事件数': successCount, '比率(%)': successRate, '说明': '真实 verify_success 事件，口径为占提交用户' },
            { '阶段': '失败样本', '用户数': failUsers, '事件数': failCount, '比率(%)': failRate, '说明': '真实 verify_fail 事件，口径为占提交用户' }
        ]
    };
}

function buildGrowthEventFunnelViewData(summaryWindow = {}) {
    const eventOverview = getAnalyticsSummaryWindowEventOverview(summaryWindow);
    const eventFunnels = getAnalyticsSummaryWindowEventFunnels(summaryWindow);
    const growth = eventFunnels?.growth && typeof eventFunnels.growth === 'object'
        ? eventFunnels.growth
        : {};

    const businessActiveUsers = normalizeAnalyticsCountValue(eventOverview.business_active_users);
    const guestbookPostCount = normalizeAnalyticsCountValue(growth.guestbook_post_count ?? eventOverview.guestbook_post_count);
    const guestbookPostUsers = normalizeAnalyticsCountValue(growth.guestbook_post_users ?? eventOverview.guestbook_post_users);
    const inviteClickCount = normalizeAnalyticsCountValue(growth.affiliate_invite_click_count ?? eventOverview.affiliate_invite_click_count);
    const inviteClickUsers = normalizeAnalyticsCountValue(growth.affiliate_invite_click_users ?? eventOverview.affiliate_invite_click_users);
    const checkinSuccessCount = normalizeAnalyticsCountValue(growth.checkin_success_count ?? eventOverview.checkin_success_count);
    const checkinSuccessUsers = normalizeAnalyticsCountValue(growth.checkin_success_users ?? eventOverview.checkin_success_users);

    const hasData = [guestbookPostCount, inviteClickCount, checkinSuccessCount].some((value) => value > 0);
    if (!hasData) {
        return {
            items: [],
            exportRows: []
        };
    }

    const guestbookCoverageRate = getAnalyticsPercentRate(guestbookPostUsers, businessActiveUsers);
    const inviteCoverageRate = getAnalyticsPercentRate(inviteClickUsers, businessActiveUsers);
    const checkinCoverageRate = getAnalyticsPercentRate(checkinSuccessUsers, businessActiveUsers);

    return {
        items: [
            {
                title: '留言发布',
                value: formatNumber(guestbookPostUsers),
                meta: `${formatNumber(guestbookPostCount)} 次发布`,
                badgeLabel: businessActiveUsers > 0 ? `覆盖 ${formatPercent(guestbookCoverageRate)}` : '真实事件',
                badgeTone: businessActiveUsers > 0 ? getAnalyticsRateBadgeTone(guestbookCoverageRate, { successAbove: 18, warningAbove: 8 }) : 'neutral',
                summary: '用于衡量社区反馈入口是否正在承接真实用户需求。',
                actionLabel: '处理留言治理',
                destination: 'comments-guestbook',
                icon: 'fas fa-comments',
                context: {
                    view: 'guestbook',
                    status: 'unreplied'
                }
            },
            {
                title: '邀请点击',
                value: formatNumber(inviteClickUsers),
                meta: `${formatNumber(inviteClickCount)} 次点击`,
                badgeLabel: businessActiveUsers > 0 ? `覆盖 ${formatPercent(inviteCoverageRate)}` : '真实事件',
                badgeTone: businessActiveUsers > 0 ? getAnalyticsRateBadgeTone(inviteCoverageRate, { successAbove: 12, warningAbove: 4 }) : 'neutral',
                summary: '优先采用 affiliate_invite_click 事件判断裂变传播是否真的发生。',
                actionLabel: '查看推广配置',
                destination: 'settings-affiliate',
                icon: 'fas fa-share-nodes'
            },
            {
                title: '签到成功',
                value: formatNumber(checkinSuccessUsers),
                meta: `${formatNumber(checkinSuccessCount)} 次成功`,
                badgeLabel: businessActiveUsers > 0 ? `覆盖 ${formatPercent(checkinCoverageRate)}` : '真实事件',
                badgeTone: businessActiveUsers > 0 ? getAnalyticsRateBadgeTone(checkinCoverageRate, { successAbove: 30, warningAbove: 12 }) : 'neutral',
                summary: '帮助判断签到补贴是否正在形成真实拉活，而不只是账面发放。',
                actionLabel: '查看积分流水',
                destination: 'points',
                icon: 'fas fa-calendar-check',
                context: {
                    view: 'batches',
                    quick: 'today'
                }
            }
        ],
        exportRows: [
            { '动作': '留言发布', '用户数': guestbookPostUsers, '事件数': guestbookPostCount, '覆盖率(%)': guestbookCoverageRate, '说明': '真实 guestbook_post 事件' },
            { '动作': '邀请点击', '用户数': inviteClickUsers, '事件数': inviteClickCount, '覆盖率(%)': inviteCoverageRate, '说明': '真实 affiliate_invite_click 事件' },
            { '动作': '签到成功', '用户数': checkinSuccessUsers, '事件数': checkinSuccessCount, '覆盖率(%)': checkinCoverageRate, '说明': '真实 checkin_success 事件' }
        ]
    };
}

function buildOverviewBusinessMixSummaryFromRows({
    unlockRows = [],
    verifyRows = [],
    guestbookMessages = [],
    guestbookComments = [],
    guestbookLikes = [],
    promptComments = [],
    rewardRows = []
} = {}) {
    const successCount = verifyRows.filter((row) => getVerifyStatusGroup(row?.status) === 'success').length;
    const successRate = verifyRows.length > 0 ? (successCount / verifyRows.length) * 100 : 0;
    const communityCount = guestbookMessages.length + guestbookComments.length + guestbookLikes.length + promptComments.length;
    const failedVerifyRows = verifyRows
        .filter((row) => getVerifyStatusGroup(row?.status) === 'failed')
        .slice(0, 2);
    const rewardEligibleRows = rewardRows
        .filter((row) => (
            isAnalyticsAffiliateRewardEntry(row)
            || isAnalyticsRegistrationRewardEntry(row)
            || isAnalyticsActivationRewardEntry(row)
            || isAnalyticsCheckinRewardEntry(row)
        ));
    const rewardFocusRows = rewardEligibleRows
        .slice(0, 3);
    const rewardPoints = roundTo(sumAnalyticsPositiveAmounts(
        rewardEligibleRows
    ), 1) || 0;

    const items = [
        {
            title: '内容解锁',
            value: formatNumber(unlockRows.length),
            meta: 'Prompt 权益释放次数',
            badgeLabel: '内容',
            badgeTone: 'accent',
            summary: '反映提示词卡片和资源包的内容消费深度',
            actionLabel: '查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-fire',
            context: {
                sectionId: 'topContentList'
            }
        },
        {
            title: '验证请求',
            value: formatNumber(verifyRows.length),
            meta: `完成 ${successCount} / ${verifyRows.length || 0}`,
            badgeLabel: '验证',
            badgeTone: 'warning',
            summary: `当前窗口完成率 ${formatPercent(successRate)}`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square'
        },
        {
            title: '社区互动',
            value: formatNumber(communityCount),
            meta: `留言 ${guestbookMessages.length} / 评论 ${guestbookComments.length + promptComments.length} / 点赞 ${guestbookLikes.length}`,
            badgeLabel: '社区',
            badgeTone: 'neutral',
            summary: '覆盖留言板、Prompt 评论和点赞反馈',
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: {
                view: 'guestbook',
                status: 'unreplied'
            }
        },
        {
            title: '激励投放',
            value: formatNumber(rewardPoints),
            meta: '签到、返佣与拉新奖励积分',
            badgeLabel: '激励',
            badgeTone: 'success',
            summary: '帮助判断积分增长是否由运营激励驱动',
            actionLabel: '查看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-coins',
            context: {
                sectionId: 'pointsFlow'
            }
        }
    ];

    const recommendations = [];

    if (verifyRows.length > 0 && successRate < 85) {
        const failedFocusRow = failedVerifyRows[0] || verifyRows.find((row) => getVerifyStatusGroup(row?.status) !== 'success') || null;
        recommendations.push({
            tone: 'danger',
            level: '优先处理',
            title: '验证成功率偏低',
            summary: `当前窗口验证完成率只有 ${formatPercent(successRate)}，建议先检查失败/阻塞任务和额度状态。`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: failedFocusRow?.verification_id ? {
                verificationId: failedFocusRow.verification_id,
                targetId: failedFocusRow.verification_id,
                referenceValue: failedFocusRow.verification_id
            } : null,
            sampleLabel: '最近失败样本',
            sampleItems: failedVerifyRows.map((row) => formatAnalyticsVerificationSample(row))
        });
    }

    if (rewardPoints > 0) {
        recommendations.push({
            tone: 'warning',
            level: '建议复核',
            title: '激励投放正在影响积分结构',
            summary: `当前窗口已发放 ${formatNumber(rewardPoints)} 积分激励，建议结合积分与交易查看是否真正带来消费承接。`,
            actionLabel: '查看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-coins',
            context: {
                sectionId: 'pointsFlow'
            },
            sampleLabel: '最近放量样本',
            sampleItems: rewardFocusRows.map((row) => formatAnalyticsRewardSample(row))
        });
    }

    if (unlockRows.length > 0 && communityCount < unlockRows.length) {
        recommendations.push({
            tone: 'neutral',
            level: '可跟进',
            title: '内容消费已发生，社区反馈偏少',
            summary: `本窗口内容解锁 ${formatNumber(unlockRows.length)} 次，但社区互动只有 ${formatNumber(communityCount)} 次，可以检查留言治理和内容评论承接。`,
            actionLabel: '查看社区与裂变',
            destination: 'analytics-growth',
            icon: 'fas fa-comments'
        });
    }

    if (!recommendations.length) {
        recommendations.push({
            tone: 'success',
            level: '状态良好',
            title: '当前经营主线没有明显异常',
            summary: '建议继续观察内容消费、验证完成率和激励成本的联动变化。',
            actionLabel: '继续查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-chart-line'
        });
    }

    return {
        metrics: {
            unlockCount: unlockRows.length,
            verifyRequestCount: verifyRows.length,
            verifySuccessCount: successCount,
            verifySuccessRate: roundTo(successRate, 2) || 0,
            communityInteractionCount: communityCount,
            guestbookMessageCount: guestbookMessages.length,
            guestbookCommentCount: guestbookComments.length,
            guestbookLikeCount: guestbookLikes.length,
            promptCommentCount: promptComments.length,
            rewardPoints
        },
        items,
        recommendations,
        exportRows: [
            { '指标': '内容解锁', '数值': unlockRows.length, '说明': 'Prompt 权益释放次数' },
            { '指标': '验证请求', '数值': verifyRows.length, '说明': `已完成 ${successCount}，完成率 ${formatPercent(successRate)}` },
            { '指标': '社区互动', '数值': communityCount, '说明': `留言 ${guestbookMessages.length} / 评论 ${guestbookComments.length + promptComments.length} / 点赞 ${guestbookLikes.length}` },
            { '指标': '激励投放积分', '数值': rewardPoints, '说明': '签到、返佣与拉新奖励积分发放' }
        ]
    };
}

function buildOverviewBusinessMixFallbackSummary({
    summaryWindow = {},
    commentsSummary = null
} = {}) {
    const overview = summaryWindow?.overview && typeof summaryWindow.overview === 'object' ? summaryWindow.overview : {};
    const topContent = Array.isArray(summaryWindow?.top_content) ? summaryWindow.top_content : [];
    const channels = Array.isArray(summaryWindow?.channel_breakdown) ? summaryWindow.channel_breakdown : [];
    const totalUnlockCount = topContent.reduce((sum, row) => sum + normalizeAnalyticsCountValue(row?.unlock_count), 0);
    const totalCommentCount = normalizeAnalyticsCountValue(
        overview.total_comments || topContent.reduce((sum, row) => sum + normalizeAnalyticsCountValue(row?.comment_count), 0)
    );
    const totalPoints = normalizeAnalyticsNumber(overview.total_points);
    const activeUsers = normalizeAnalyticsCountValue(overview.dau);
    const channelRows = channels
        .map((row) => ({
            name: String(row?.channel || '未分类').trim() || '未分类',
            volume: normalizeAnalyticsNumber(
                row?.event_count
                || row?.user_count
                || row?.unlock_success_count
                || row?.verify_submit_count
                || row?.recharge_success_count
                || row?.shop_purchase_count
                || row?.total_points
                || row?.used_codes
                || row?.batch_count
            )
        }))
        .sort((left, right) => right.volume - left.volume);
    const topChannel = channelRows[0] || null;
    const channelTotal = channelRows.reduce((sum, item) => sum + item.volume, 0);
    const topChannelShare = topChannel && channelTotal > 0 ? (topChannel.volume / channelTotal) * 100 : 0;
    const commentStats = commentsSummary?.summary && typeof commentsSummary.summary === 'object'
        ? commentsSummary.summary
        : {};
    const totalFeedback = normalizeAnalyticsCountValue(commentStats.totalCount || totalCommentCount);
    const todayFeedback = normalizeAnalyticsCountValue(commentStats.todayCount);

    const items = [
        {
            title: '内容消费样本',
            value: formatNumber(totalUnlockCount),
            meta: '兼容口径：热门内容解锁聚合',
            badgeLabel: '内容',
            badgeTone: 'accent',
            summary: '当前环境未开放明细表读权限时，会退回到热门内容聚合口径'
        },
        {
            title: '社区反馈',
            value: formatNumber(totalFeedback),
            meta: `今日 ${formatNumber(todayFeedback)} / 总计 ${formatNumber(totalCommentCount)}`,
            badgeLabel: '社区',
            badgeTone: 'neutral',
            summary: '使用评论摘要和热门内容反馈估算站内互动承接'
        },
        {
            title: '主渠道',
            value: topChannel?.name || '未分类',
            meta: topChannel ? `占样本约 ${formatPercent(topChannelShare)}` : '当前窗口暂无渠道样本',
            badgeLabel: '渠道',
            badgeTone: 'warning',
            summary: '帮助判断当前核销和消费主要来自哪个渠道'
        },
        {
            title: '积分流通',
            value: formatNumber(totalPoints),
            meta: `活跃用户 ${formatNumber(activeUsers)}`,
            badgeLabel: '积分',
            badgeTone: 'success',
            summary: '用总流通积分和活跃样本补看经营节奏'
        }
    ];

    const recommendations = [];

    if (totalUnlockCount <= 0 && totalFeedback <= 0) {
        recommendations.push({
            tone: 'warning',
            level: '建议跟进',
            title: '当前窗口内容与反馈样本偏少',
            summary: '建议先回看内容增长和站内评论承接，确认最近窗口是否确实没有消费或互动发生。',
            actionLabel: '查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-fire'
        });
    } else {
        recommendations.push({
            tone: 'accent',
            level: '持续观察',
            title: '经营主线已切到兼容口径',
            summary: '当前区块已经退回到概览聚合数据，适合先判断内容消费、渠道和积分是否同向变化。',
            actionLabel: '查看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-wallet',
            context: {
                sectionId: 'pointsFlow'
            }
        });
    }

    if (topChannel && topChannelShare >= 65) {
        recommendations.push({
            tone: 'warning',
            level: '建议复核',
            title: '当前经营样本仍然偏向单一渠道',
            summary: `当前主渠道 ${topChannel.name} 占比约 ${formatPercent(topChannelShare)}，建议结合内容增长复看是否存在渠道单点依赖。`,
            actionLabel: '查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-chart-line'
        });
    }

    if (totalFeedback <= 0) {
        recommendations.push({
            tone: 'neutral',
            level: '可跟进',
            title: '社区反馈样本不足',
            summary: '建议直接进入留言治理或评论区，确认最近窗口的互动承接是否缺位。',
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: {
                view: 'guestbook',
                status: 'unreplied'
            }
        });
    }

    return enrichOverviewBusinessMixSummaryWithEvents({
        metrics: {
            unlockCount: totalUnlockCount,
            verifyRequestCount: 0,
            verifySuccessCount: 0,
            verifySuccessRate: 0,
            communityInteractionCount: totalFeedback,
            guestbookMessageCount: todayFeedback,
            guestbookCommentCount: totalCommentCount,
            guestbookLikeCount: 0,
            promptCommentCount: 0,
            rewardPoints: 0
        },
        items,
        recommendations: recommendations.slice(0, 3),
        exportRows: [
            { '指标': '内容消费样本', '数值': totalUnlockCount, '说明': '兼容口径：热门内容解锁聚合' },
            { '指标': '社区反馈', '数值': totalFeedback, '说明': `今日 ${todayFeedback} / 评论汇总 ${totalCommentCount}` },
            { '指标': '主渠道占比', '数值': roundTo(topChannelShare, 2) || 0, '说明': topChannel?.name || '未分类' },
            { '指标': '积分流通', '数值': totalPoints, '说明': `活跃用户 ${activeUsers}` }
        ],
        fallback: true
    }, summaryWindow);
}

async function getOverviewBusinessMixSummaryData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'overviewBusinessMix',
        async () => {
            const [rowResults, summaryWindow] = await Promise.all([
                Promise.all([
                    fetchAnalyticsTableRows('prompt_unlocks', 'id, unlocked_at, site', {
                        orderBy: 'unlocked_at',
                        rangeColumn: 'unlocked_at'
                    }),
                    fetchAnalyticsTableRows('verification_logs', 'verification_id, status, created_at, points_deducted, summary, message, error_message, stage_label, raw_status, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('guestbook_messages', 'id, content, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('guestbook_comments', 'id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('guestbook_likes', 'id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('prompt_comments', 'id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('points_ledger', 'id, amount, reason, reference_id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    })
                ]),
                getAnalyticsSummaryWindowData({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null)
            ]);
            const [unlockRows, verifyRows, guestbookMessages, guestbookComments, guestbookLikes, promptComments, rewardRows] = rowResults;
            const baseSummary = buildOverviewBusinessMixSummaryFromRows({
                unlockRows,
                verifyRows,
                guestbookMessages,
                guestbookComments,
                guestbookLikes,
                promptComments,
                rewardRows
            });

            return enrichOverviewBusinessMixSummaryWithEvents(baseSummary, summaryWindow || {});
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function buildVerifyServiceSummaryFromRows(rows = []) {
    const sortedRows = [...rows].sort((left, right) => new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime());
    const successRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'success');
    const activeRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'active');
    const failedRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'failed');
    const otherRows = sortedRows.filter((row) => getVerifyStatusGroup(row?.status) === 'other');
    const totalPoints = roundTo(sortedRows.reduce((sum, row) => sum + (toNumericValue(row?.points_deducted) || 0), 0), 1) || 0;
    const successRate = sortedRows.length > 0 ? (successRows.length / sortedRows.length) * 100 : 0;
    const avgPointsCostPerSuccess = successRows.length > 0
        ? roundTo(totalPoints / successRows.length, 1)
        : null;

    const statusItems = [
        {
            title: '已完成',
            value: formatNumber(successRows.length),
            meta: `占总请求 ${formatPercent(successRate)}`,
            badgeLabel: '健康',
            badgeTone: 'success',
            summary: '说明当前验证主链路的完成产能'
        },
        {
            title: '处理中',
            value: formatNumber(activeRows.length),
            meta: '排队、重试或运行中的任务',
            badgeLabel: '队列',
            badgeTone: 'warning',
            summary: '适合结合验证队列和告警工作区持续观察'
        },
        {
            title: '失败 / 阻塞',
            value: formatNumber(failedRows.length),
            meta: '超时、错误、限制或人工介入',
            badgeLabel: '风险',
            badgeTone: 'danger',
            summary: '建议和失败类型、错误码一起排查'
        },
        {
            title: '其他状态',
            value: formatNumber(otherRows.length),
            meta: '未归类到成功/处理中/失败',
            badgeLabel: '观察',
            badgeTone: 'neutral',
            summary: '用于发现新增状态或状态流转不一致'
        }
    ];

    const recentItems = sortedRows.slice(0, 5).map((row) => {
        const statusGroup = getVerifyStatusGroup(row?.status);
        const verificationId = String(row?.verification_id || '').trim();
        const identity = row?.email || row?.user_id || '未记录身份';
        const siteLabel = String(row?.site || getAnalyticsSiteParam() || 'all').toUpperCase();
        return {
            title: row?.verification_id || identity,
            value: formatAnalyticsDateTime(row?.created_at),
            meta: `${identity} · ${siteLabel}`,
            badgeLabel: getVerifyStatusLabel(statusGroup),
            badgeTone: getVerifyStatusTone(statusGroup),
            summary: getAnalyticsVerificationSummary(row) || '暂无额外摘要',
            actionLabel: verificationId ? '打开任务' : '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: verificationId ? {
                verificationId,
                targetId: verificationId,
                referenceValue: verificationId
            } : null
        };
    });

    const focusTaskRows = sortedRows
        .filter((row) => ['failed', 'active'].includes(getVerifyStatusGroup(row?.status)))
        .slice(0, 6);

    const focusItems = focusTaskRows.map((row) => {
        const statusGroup = getVerifyStatusGroup(row?.status);
        const verificationId = String(row?.verification_id || '').trim();
        return {
            title: row?.verification_id || row?.email || row?.user_id || '未命名验证任务',
            value: formatAnalyticsDateTime(row?.created_at),
            meta: `${String(row?.site || getAnalyticsSiteParam() || 'all').toUpperCase()} · ${row?.email || row?.user_id || '匿名用户'}`,
            badgeLabel: getVerifyStatusLabel(statusGroup),
            badgeTone: getVerifyStatusTone(statusGroup),
            summary: getAnalyticsVerificationSummary(row) || '暂无失败摘要',
            actionLabel: verificationId ? '打开任务' : '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: verificationId ? {
                verificationId,
                targetId: verificationId,
                referenceValue: verificationId
            } : null
        };
    });

    const recommendations = [];

    if (failedRows.length > 0) {
        const failedFocusRow = failedRows[0] || null;
        recommendations.push({
            tone: 'danger',
            level: '优先处理',
            title: '存在失败或阻塞任务',
            summary: `当前窗口有 ${formatNumber(failedRows.length)} 条失败/阻塞任务，建议先进入 Verify Monitor 看高频失败原因和待收口告警。`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: failedFocusRow?.verification_id ? {
                verificationId: failedFocusRow.verification_id,
                targetId: failedFocusRow.verification_id,
                referenceValue: failedFocusRow.verification_id
            } : null,
            sampleLabel: '最近异常',
            sampleItems: failedRows.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row))
        });
    }

    if (activeRows.length > 0) {
        const activeFocusRow = activeRows[0] || null;
        recommendations.push({
            tone: 'warning',
            level: '建议复核',
            title: '验证队列仍有处理中任务',
            summary: `当前仍有 ${formatNumber(activeRows.length)} 条处理中任务，建议检查 Google One API 配置、额度和队列状态。`,
            actionLabel: '检查验证配置',
            destination: 'settings-google-one',
            icon: 'fas fa-sliders',
            context: activeFocusRow?.verification_id ? {
                verificationId: activeFocusRow.verification_id,
                targetId: activeFocusRow.verification_id,
                referenceValue: activeFocusRow.verification_id
            } : null,
            sampleLabel: '排队样本',
            sampleItems: activeRows.slice(0, 2).map((row) => formatAnalyticsVerificationSample(row))
        });
    }

    if (avgPointsCostPerSuccess !== null && avgPointsCostPerSuccess > 0) {
        recommendations.push({
            tone: 'neutral',
            level: '持续观察',
            title: '跟踪验证成功成本',
            summary: `当前窗口单次成功平均消耗约 ${formatNumber(avgPointsCostPerSuccess)} 积分，建议结合积分与交易看验证业务是否仍然划算。`,
            actionLabel: '查看积分与交易',
            destination: 'analytics-monetization',
            icon: 'fas fa-wallet',
            context: {
                sectionId: 'pointsFlow'
            }
        });
    }

    if (!recommendations.length) {
        recommendations.push({
            tone: 'success',
            level: '状态良好',
            title: '验证链路暂时平稳',
            summary: '当前窗口没有明显失败或堆积，可以继续观察完成率和成本的变化。',
            actionLabel: '查看验证配置',
            destination: 'settings-google-one',
            icon: 'fas fa-shield-halved'
        });
    }

    return {
        metrics: {
            requestCount: sortedRows.length,
            successCount: successRows.length,
            activeCount: activeRows.length,
            failedCount: failedRows.length,
            otherCount: otherRows.length,
            successRate: roundTo(successRate, 2) || 0,
            totalPointsCost: totalPoints,
            avgPointsCostPerSuccess: avgPointsCostPerSuccess ?? 0
        },
        statusItems,
        recentItems,
        focusItems,
        recentRows: sortedRows.slice(0, 8).map((row) => ({
            '验证单号': row?.verification_id || '',
            '用户': row?.email || row?.user_id || '匿名用户',
            '站点': String(row?.site || getAnalyticsSiteParam() || 'all').toUpperCase(),
            '状态': getVerifyStatusLabel(getVerifyStatusGroup(row?.status)),
            '积分消耗': toNumericValue(row?.points_deducted) || 0,
            '时间': formatAnalyticsDateTime(row?.created_at),
            '摘要': getAnalyticsVerificationSummary(row) || ''
        })),
        focusRows: focusTaskRows.map((row) => ({
            '验证单号': row?.verification_id || '',
            '用户': row?.email || row?.user_id || '匿名用户',
            '站点': String(row?.site || getAnalyticsSiteParam() || 'all').toUpperCase(),
            '状态': getVerifyStatusLabel(getVerifyStatusGroup(row?.status)),
            '时间': formatAnalyticsDateTime(row?.created_at),
            '摘要': getAnalyticsVerificationSummary(row) || ''
        })),
        samples: {
            focusTasks: focusTaskRows.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row)),
            recentTasks: sortedRows.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row))
        },
        recommendations
    };
}

function buildVerifyServiceSummaryFallback({ snapshot = null, summaryWindow = {} } = {}) {
    const summary = snapshot?.summary && typeof snapshot.summary === 'object' ? snapshot.summary : {};
    const facts = snapshot?.facts && typeof snapshot.facts === 'object' ? snapshot.facts : {};
    const recentTasks = Array.isArray(snapshot?.recent_tasks) ? snapshot.recent_tasks : [];
    const recentFailures = Array.isArray(snapshot?.recent_failures) ? snapshot.recent_failures : [];
    const requestCount = normalizeAnalyticsCountValue(summary.deduped_task_count);
    const successCount = normalizeAnalyticsCountValue(facts.success_task_count);
    const activeCount = normalizeAnalyticsCountValue(summary.active_task_count);
    const failedCount = normalizeAnalyticsCountValue(summary.failure_task_count);
    const successRate = requestCount > 0 ? (successCount / requestCount) * 100 : 0;
    const mapRow = (row = {}) => {
        const statusGroup = getVerifyStatusGroup(row?.status);
        const verificationId = String(row?.verification_id || '').trim();
        return {
            title: row?.verification_id || row?.email || row?.user_id || '验证任务',
            value: formatAnalyticsDateTime(row?.created_at),
            meta: `${String(row?.site || getAnalyticsSiteParam() || 'all').toUpperCase()} · ${row?.email || row?.user_id || '匿名用户'}`,
            badgeLabel: getVerifyStatusLabel(statusGroup),
            badgeTone: getVerifyStatusTone(statusGroup),
            summary: getAnalyticsVerificationSummary(row) || '来自验证运维兼容口径',
            actionLabel: verificationId ? '打开任务' : '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: verificationId ? {
                verificationId,
                targetId: verificationId,
                referenceValue: verificationId
            } : null
        };
    };

    const recommendations = [];
    if (failedCount > 0) {
        recommendations.push({
            tone: 'danger',
            level: '优先处理',
            title: '验证运维中仍有失败样本',
            summary: `当前兼容口径下看到 ${formatNumber(failedCount)} 条失败/异常任务，建议优先进入 Verify Monitor 收口。`,
            actionLabel: '打开 Verify Monitor',
            destination: 'verify-monitor',
            icon: 'fas fa-wave-square',
            context: recentFailures[0]?.verification_id ? {
                verificationId: String(recentFailures[0].verification_id).trim(),
                targetId: String(recentFailures[0].verification_id).trim()
            } : null,
            sampleLabel: '最近失败样本',
            sampleItems: recentFailures.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row))
        });
    }
    if (activeCount > 0) {
        recommendations.push({
            tone: 'warning',
            level: '建议复核',
            title: '验证队列仍有活跃任务',
            summary: `当前兼容口径下仍有 ${formatNumber(activeCount)} 条活跃任务，建议顺手检查队列和额度。`,
            actionLabel: '检查验证配置',
            destination: 'settings-google-one',
            icon: 'fas fa-sliders'
        });
    }
    if (!recommendations.length) {
        recommendations.push({
            tone: 'success',
            level: '状态良好',
            title: '验证摘要已切到兼容口径',
            summary: '当前没有明显失败或堆积，可以继续观察 Verify Monitor 的最新任务。',
            actionLabel: '查看验证配置',
            destination: 'settings-google-one',
            icon: 'fas fa-shield-halved'
        });
    }

    return enrichVerifyServiceSummaryWithEvents({
        metrics: {
            requestCount,
            successCount,
            activeCount,
            failedCount,
            otherCount: 0,
            successRate: roundTo(successRate, 2) || 0,
            totalPointsCost: 0,
            avgPointsCostPerSuccess: 0
        },
        statusItems: [
            {
                title: '已完成',
                value: formatNumber(successCount),
                meta: `兼容口径成功率 ${formatPercent(successRate)}`,
                badgeLabel: '健康',
                badgeTone: 'success',
                summary: '来自 Verify Monitor 聚合摘要'
            },
            {
                title: '处理中',
                value: formatNumber(activeCount),
                meta: '兼容口径活跃任务',
                badgeLabel: '队列',
                badgeTone: 'warning',
                summary: '用于快速看当前验证是否仍有排队'
            },
            {
                title: '失败 / 阻塞',
                value: formatNumber(failedCount),
                meta: '兼容口径失败样本',
                badgeLabel: '风险',
                badgeTone: 'danger',
                summary: '适合先从最近失败任务开始排查'
            }
        ],
        recentItems: recentTasks.slice(0, 5).map(mapRow),
        focusItems: recentFailures.slice(0, 5).map(mapRow),
        recentRows: recentTasks.slice(0, 8).map((row) => ({
            '验证单号': row?.verification_id || '',
            '用户': row?.email || row?.user_id || '匿名用户',
            '站点': String(row?.site || getAnalyticsSiteParam() || 'all').toUpperCase(),
            '状态': getVerifyStatusLabel(getVerifyStatusGroup(row?.status)),
            '积分消耗': toNumericValue(row?.points_deducted) || 0,
            '时间': formatAnalyticsDateTime(row?.created_at),
            '摘要': getAnalyticsVerificationSummary(row) || ''
        })),
        focusRows: recentFailures.slice(0, 8).map((row) => ({
            '验证单号': row?.verification_id || '',
            '用户': row?.email || row?.user_id || '匿名用户',
            '站点': String(row?.site || getAnalyticsSiteParam() || 'all').toUpperCase(),
            '状态': getVerifyStatusLabel(getVerifyStatusGroup(row?.status)),
            '时间': formatAnalyticsDateTime(row?.created_at),
            '摘要': getAnalyticsVerificationSummary(row) || ''
        })),
        samples: {
            focusTasks: recentFailures.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row)),
            recentTasks: recentTasks.slice(0, 3).map((row) => formatAnalyticsVerificationSample(row))
        },
        recommendations,
        fallback: true
    }, summaryWindow);
}

async function getVerifyServiceSummaryData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'verifyServiceSummary',
        async () => {
            const [rows, summaryWindow] = await Promise.all([
                fetchAnalyticsTableRows(
                    'verification_logs',
                    'verification_id, user_id, email, site, status, summary, message, error_message, stage_label, raw_status, points_deducted, created_at',
                    { orderBy: 'created_at', rangeColumn: 'created_at', limit: 80 }
                ),
                getAnalyticsSummaryWindowData({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null)
            ]);
            const baseSummary = buildVerifyServiceSummaryFromRows(rows);

            return enrichVerifyServiceSummaryWithEvents(baseSummary, summaryWindow || {});
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function buildGrowthSummaryFromRows({
    guestbookMessages = [],
    guestbookComments = [],
    guestbookLikes = [],
    promptComments = [],
    ledgerRows = []
} = {}) {
    const interactionCount = guestbookComments.length + guestbookLikes.length + promptComments.length;
    const repliedMessageIds = new Set(
        guestbookComments
            .map((row) => String(row?.message_id || '').trim())
            .filter(Boolean)
    );
    const unrepliedMessages = guestbookMessages
        .filter((row) => !repliedMessageIds.has(String(row?.id || '').trim()))
        .slice(0, 3);
    const affiliateRewardRows = ledgerRows.filter((row) => isAnalyticsAffiliateRewardEntry(row));
    const registrationRewardRows = ledgerRows.filter((row) => isAnalyticsRegistrationRewardEntry(row));
    const activationRewardRows = ledgerRows.filter((row) => isAnalyticsActivationRewardEntry(row));
    const checkinRewardRows = ledgerRows.filter((row) => isAnalyticsCheckinRewardEntry(row));
    const guestbookReplyRate = guestbookMessages.length > 0
        ? (guestbookComments.length / guestbookMessages.length) * 100
        : 0;

    const affiliateRewardPoints = roundTo(sumAnalyticsPositiveAmounts(affiliateRewardRows), 1) || 0;
    const registrationRewardPoints = roundTo(sumAnalyticsPositiveAmounts(registrationRewardRows), 1) || 0;
    const activationRewardPoints = roundTo(sumAnalyticsPositiveAmounts(activationRewardRows), 1) || 0;
    const referralRewardPoints = roundTo(sumAnalyticsPositiveAmounts([
        ...affiliateRewardRows,
        ...registrationRewardRows,
        ...activationRewardRows
    ]), 1) || 0;
    const checkinRewardPoints = roundTo(sumAnalyticsPositiveAmounts(checkinRewardRows), 1) || 0;
    const referralConfigField = affiliateRewardPoints >= (registrationRewardPoints + activationRewardPoints)
        ? 'commission_rate_shop'
        : 'registration_reward_points';
    const referralFocusRow = referralConfigField === 'commission_rate_shop'
        ? (affiliateRewardRows[0] || registrationRewardRows[0] || activationRewardRows[0] || null)
        : (registrationRewardRows[0] || activationRewardRows[0] || affiliateRewardRows[0] || null);
    const checkinFocusRow = checkinRewardRows[0] || null;

    const breakdownItems = [
        {
            title: '留言板互动',
            value: formatNumber(guestbookMessages.length + guestbookComments.length + guestbookLikes.length),
            meta: `发帖 ${guestbookMessages.length} / 评论 ${guestbookComments.length} / 点赞 ${guestbookLikes.length}`,
            badgeLabel: '社区',
            badgeTone: 'accent',
            summary: '最能反映站内公开讨论和反馈热度',
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: {
                view: 'guestbook',
                status: 'unreplied'
            }
        },
        {
            title: 'Prompt 评论',
            value: formatNumber(promptComments.length),
            meta: '内容页评论参与',
            badgeLabel: '内容',
            badgeTone: 'neutral',
            summary: '能帮助判断内容讨论是否转化为二次互动',
            actionLabel: '回看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-fire',
            context: {
                sectionId: 'topContentList'
            }
        },
        {
            title: '分销返佣',
            value: formatNumber(affiliateRewardPoints),
            meta: `${affiliateRewardRows.length} 笔奖励`,
            badgeLabel: '返佣',
            badgeTone: 'success',
            summary: '对应商城或充值带来的分销奖励发放',
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: 'commission_rate_shop'
            }
        },
        {
            title: '拉新激活',
            value: formatNumber(roundTo(registrationRewardPoints + activationRewardPoints, 1) || 0),
            meta: `注册 ${registrationRewardRows.length} / 首单 ${activationRewardRows.length}`,
            badgeLabel: '拉新',
            badgeTone: 'warning',
            summary: '观察邀请注册与首单激活是否真正形成闭环',
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: 'registration_reward_points'
            }
        },
        {
            title: '签到奖励',
            value: formatNumber(checkinRewardPoints),
            meta: `${checkinRewardRows.length} 笔发放`,
            badgeLabel: '签到',
            badgeTone: 'accent',
            summary: '帮助判断日常活跃维护是否依赖签到补贴',
            actionLabel: '查看积分流水',
            destination: 'points',
            icon: 'fas fa-calendar-check',
            context: checkinFocusRow ? {
                view: 'lookup',
                lookupValue: String(checkinFocusRow.id || '').trim(),
                ledgerId: String(checkinFocusRow.id || '').trim(),
                referenceId: String(checkinFocusRow.reference_id || '').trim()
            } : {
                view: 'batches',
                quick: 'today'
            }
        }
    ];

    const recommendations = [];

    if (guestbookMessages.length > 0 && guestbookReplyRate < 80) {
        const focusMessage = unrepliedMessages[0] || guestbookMessages[0] || null;
        recommendations.push({
            tone: 'warning',
            level: '建议跟进',
            title: '留言板回复率还有提升空间',
            summary: `当前窗口发帖 ${formatNumber(guestbookMessages.length)} 条，留言板回复率约 ${formatPercent(guestbookReplyRate)}，建议进入留言治理补承接。`,
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: focusMessage?.id ? {
                view: 'guestbook',
                commentId: focusMessage.id,
                focusCommentId: focusMessage.id,
                status: 'unreplied',
                search: truncateAnalyticsSnippet(focusMessage.content || '', 16)
            } : {
                view: 'guestbook',
                status: 'unreplied'
            },
            sampleLabel: '待承接留言',
            sampleItems: unrepliedMessages.map((row) => formatAnalyticsGuestbookMessageSample(row))
        });
    }

    if (referralRewardPoints > 0) {
        recommendations.push({
            tone: 'neutral',
            level: '持续观察',
            title: '返佣与拉新奖励已开始放量',
            summary: `当前窗口裂变相关奖励发放 ${formatNumber(referralRewardPoints)} 积分，建议复核推广配置和返佣 ROI。`,
            actionLabel: '查看推广配置',
            destination: 'settings-affiliate',
            icon: 'fas fa-share-nodes',
            context: {
                field: referralConfigField,
                referenceId: String(referralFocusRow?.reference_id || '').trim(),
                rewardType: getAnalyticsRewardLabel(referralFocusRow || {})
            },
            sampleLabel: '最近奖励样本',
            sampleItems: [...affiliateRewardRows, ...registrationRewardRows, ...activationRewardRows]
                .slice(0, 3)
                .map((row) => formatAnalyticsRewardSample(row))
        });
    }

    if (checkinRewardPoints > 0) {
        recommendations.push({
            tone: 'accent',
            level: '运营观察',
            title: '签到奖励正在维持活跃',
            summary: `当前窗口签到奖励发放 ${formatNumber(checkinRewardPoints)} 积分，建议结合积分与交易判断签到补贴是否转化成消费。`,
            actionLabel: '查看积分流水',
            destination: 'points',
            icon: 'fas fa-calendar-check',
            context: checkinFocusRow ? {
                view: 'lookup',
                lookupValue: String(checkinFocusRow.id || '').trim(),
                ledgerId: String(checkinFocusRow.id || '').trim(),
                referenceId: String(checkinFocusRow.reference_id || '').trim()
            } : {
                view: 'batches',
                quick: 'today'
            },
            sampleLabel: '最近签到流水',
            sampleItems: checkinRewardRows.slice(0, 3).map((row) => formatAnalyticsRewardSample(row))
        });
    }

    if (!recommendations.length) {
        recommendations.push({
            tone: 'success',
            level: '状态良好',
            title: '社区与裂变链路暂时平稳',
            summary: '建议继续观察留言回复、邀请转化和签到奖励的联动变化。',
            actionLabel: '查看内容增长',
            destination: 'analytics-content',
            icon: 'fas fa-fire'
        });
    }

    return {
        metrics: {
            guestbookMessageCount: guestbookMessages.length,
            guestbookCommentCount: guestbookComments.length,
            guestbookLikeCount: guestbookLikes.length,
            promptCommentCount: promptComments.length,
            interactionCount,
            guestbookReplyRate: roundTo(guestbookReplyRate, 2) || 0,
            affiliateRewardPoints,
            registrationRewardPoints,
            activationRewardPoints,
            referralRewardPoints,
            checkinRewardPoints
        },
        samples: {
            unrepliedMessages: unrepliedMessages.map((row) => formatAnalyticsGuestbookMessageSample(row)),
            referralRewards: [...affiliateRewardRows, ...registrationRewardRows, ...activationRewardRows]
                .slice(0, 3)
                .map((row) => formatAnalyticsRewardSample(row)),
            checkinRewards: checkinRewardRows.slice(0, 3).map((row) => formatAnalyticsRewardSample(row))
        },
        breakdownItems,
        recommendations,
        exportRows: [
            { '指标': '留言板发帖', '数值': guestbookMessages.length, '说明': `回复率 ${formatPercent(guestbookReplyRate)}` },
            { '指标': '留言板评论', '数值': guestbookComments.length, '说明': '留言治理承接量' },
            { '指标': '留言板点赞', '数值': guestbookLikes.length, '说明': '用户轻互动反馈' },
            { '指标': 'Prompt 评论', '数值': promptComments.length, '说明': '内容页评论参与' },
            { '指标': '分销返佣积分', '数值': affiliateRewardPoints, '说明': `${affiliateRewardRows.length} 笔奖励` },
            { '指标': '拉新注册积分', '数值': registrationRewardPoints, '说明': `${registrationRewardRows.length} 笔奖励` },
            { '指标': '首单激活积分', '数值': activationRewardPoints, '说明': `${activationRewardRows.length} 笔奖励` },
            { '指标': '签到奖励积分', '数值': checkinRewardPoints, '说明': `${checkinRewardRows.length} 笔发放` }
        ]
    };
}

function buildGrowthSummaryFallback({
    summaryWindow = {},
    commentsSummary = null
} = {}) {
    const overview = summaryWindow?.overview && typeof summaryWindow.overview === 'object' ? summaryWindow.overview : {};
    const topContent = Array.isArray(summaryWindow?.top_content) ? summaryWindow.top_content : [];
    const commentStats = commentsSummary?.summary && typeof commentsSummary.summary === 'object'
        ? commentsSummary.summary
        : {};
    const totalFeedback = normalizeAnalyticsCountValue(commentStats.totalCount || overview.total_comments);
    const todayFeedback = normalizeAnalyticsCountValue(commentStats.todayCount);
    const activeUsersCount = normalizeAnalyticsCountValue(commentStats.activeUsersCount);
    const weekGrowth = normalizeAnalyticsNumber(commentStats.weekGrowth);
    const contentCommentCount = topContent.reduce((sum, row) => sum + normalizeAnalyticsCountValue(row?.comment_count), 0);

    const breakdownItems = [
        {
            title: '社区反馈总量',
            value: formatNumber(totalFeedback),
            meta: `今日 ${formatNumber(todayFeedback)} / 活跃用户 ${formatNumber(activeUsersCount)}`,
            badgeLabel: '社区',
            badgeTone: 'accent',
            summary: '兼容口径：来自评论后台摘要'
        },
        {
            title: '内容讨论样本',
            value: formatNumber(contentCommentCount),
            meta: '热门内容评论聚合',
            badgeLabel: '内容',
            badgeTone: 'neutral',
            summary: '用于补看内容消费后的反馈承接'
        },
        {
            title: '周增长',
            value: `${weekGrowth >= 0 ? '+' : ''}${formatNumber(Math.abs(weekGrowth))}%`,
            meta: '评论后台摘要周环比',
            badgeLabel: '趋势',
            badgeTone: weekGrowth >= 0 ? 'success' : 'warning',
            summary: '适合快速判断最近一周互动是抬升还是回落'
        }
    ];

    const recommendations = [];
    if (totalFeedback <= 0) {
        recommendations.push({
            tone: 'warning',
            level: '建议跟进',
            title: '社区反馈样本偏少',
            summary: '当前兼容口径下几乎没有看到评论和留言反馈，建议直接进入留言治理确认是否缺少承接。',
            actionLabel: '处理留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-comments',
            context: {
                view: 'guestbook',
                status: 'unreplied'
            }
        });
    } else {
        recommendations.push({
            tone: weekGrowth < 0 ? 'warning' : 'accent',
            level: weekGrowth < 0 ? '建议跟进' : '持续观察',
            title: '社区与裂变已切到兼容口径',
            summary: weekGrowth < 0
                ? '最近一周互动环比回落，建议先复核留言治理和内容评论承接。'
                : '当前区块已退回评论摘要口径，适合继续看站内互动是否稳定。 ',
            actionLabel: '查看留言治理',
            destination: 'comments-guestbook',
            icon: 'fas fa-bullhorn',
            context: {
                view: 'guestbook'
            }
        });
    }

    return enrichGrowthSummaryWithEvents({
        metrics: {
            guestbookMessageCount: todayFeedback,
            guestbookCommentCount: totalFeedback,
            guestbookLikeCount: 0,
            promptCommentCount: contentCommentCount,
            interactionCount: totalFeedback,
            guestbookReplyRate: 0,
            affiliateRewardPoints: 0,
            registrationRewardPoints: 0,
            activationRewardPoints: 0,
            referralRewardPoints: 0,
            checkinRewardPoints: 0
        },
        samples: {
            unrepliedMessages: [],
            referralRewards: [],
            checkinRewards: []
        },
        breakdownItems,
        recommendations,
        exportRows: [
            { '指标': '社区反馈总量', '数值': totalFeedback, '说明': `今日 ${todayFeedback}` },
            { '指标': '内容讨论样本', '数值': contentCommentCount, '说明': '热门内容评论聚合' },
            { '指标': '活跃反馈用户', '数值': activeUsersCount, '说明': '评论后台摘要' },
            { '指标': '周增长', '数值': weekGrowth, '说明': '评论后台周环比' }
        ],
        fallback: true
    }, summaryWindow);
}

async function getGrowthSummaryData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'growthSummary',
        async () => {
            const [rowResults, summaryWindow] = await Promise.all([
                Promise.all([
                    fetchAnalyticsTableRows('guestbook_messages', 'id, content, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('guestbook_comments', 'id, message_id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('guestbook_likes', 'id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('prompt_comments', 'id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    }),
                    fetchAnalyticsTableRows('points_ledger', 'id, amount, reason, reference_id, created_at, site', {
                        orderBy: 'created_at',
                        rangeColumn: 'created_at'
                    })
                ]),
                getAnalyticsSummaryWindowData({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null)
            ]);
            const [guestbookMessages, guestbookComments, guestbookLikes, promptComments, ledgerRows] = rowResults;
            const baseSummary = buildGrowthSummaryFromRows({
                guestbookMessages,
                guestbookComments,
                guestbookLikes,
                promptComments,
                ledgerRows
            });

            return enrichGrowthSummaryWithEvents(baseSummary, summaryWindow || {});
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

async function getOperationsHealthSnapshotData(options = {}) {
    const contextKey = options.contextKey || getAnalyticsAIContextKey();
    return runAnalyticsDerivedRequest(
        'operationsHealthSnapshot',
        async () => {
            const ticketsMetricsUrl = typeof window.AdminTickets?.getTicketsMetricsUrl === 'function'
                ? window.AdminTickets.getTicketsMetricsUrl()
                : '/api/admin?route=tickets/metrics';
            const paymentsQuery = buildAnalyticsPaymentsSummaryQuery('ops');
            const [paymentsResult, ticketsResult] = await Promise.allSettled([
                fetchAnalyticsAdminJson(`/api/admin/payments/summary?${paymentsQuery.toString()}`),
                fetchAnalyticsAdminJson(ticketsMetricsUrl)
            ]);

            return buildOperationsHealthSnapshotFromPayloads({
                paymentsPayload: paymentsResult.status === 'fulfilled' ? paymentsResult.value : {},
                ticketsPayload: ticketsResult.status === 'fulfilled' ? ticketsResult.value : {}
            });
        },
        { contextKey, forceRefresh: options.forceRefresh }
    );
}

function getPointsFlowIncomeLabel(rowOrReason = '') {
    const row = rowOrReason && typeof rowOrReason === 'object' && !Array.isArray(rowOrReason)
        ? rowOrReason
        : { reason: rowOrReason };
    const reason = String(row.reason || '');
    const referenceId = String(row.reference_id || '').trim().toUpperCase();
    if (/兑换码|redeem/i.test(reason)) return '兑换码';
    if (/daily_checkin|签到|check-?in/i.test(reason)) return '签到奖励';
    if (referenceId.startsWith('AFFILIATE_REWARD_') || referenceId.startsWith('AFF_REW_') || /推广返佣|commission/i.test(reason)) return '推广返佣';
    if (referenceId.startsWith('REG_REWARD_UNLOCK_') || /首单激活|首充激活/i.test(reason)) return '拉新激活';
    if (referenceId.startsWith('REG_REWARD_') || /signup_bonus|register_bonus|邀请拉新奖励|注册奖励/i.test(reason)) return '注册奖励';
    if (/推广返佣|commission/i.test(reason)) return '推广返佣';
    if (/首单激活|首充激活/i.test(reason)) return '拉新激活';
    if (/signup_bonus|register_bonus|邀请拉新奖励|注册奖励/i.test(reason)) return '注册奖励';
    if (/充值|recharge|purchase|top-?up/i.test(reason)) return '充值';
    if (/奖励|reward|bonus|签到|check-?in|返佣|commission|拉新|signup/i.test(reason)) return '系统奖励';
    return '其他收入';
}

function getPointsFlowExpenseLabel(rowOrReason = '') {
    const row = rowOrReason && typeof rowOrReason === 'object' && !Array.isArray(rowOrReason)
        ? rowOrReason
        : { reason: rowOrReason };
    const reason = String(row.reason || '');
    const referenceId = String(row.reference_id || '').trim().toUpperCase();
    if (/解锁|unlock|consume|download|generate/i.test(reason)) return '内容解锁';
    if (/google one|trial link|verify service|link service/i.test(reason)) return '验证服务';
    if (referenceId.startsWith('SHOP_ORDER_') || /商城购买|shop purchase/i.test(reason)) return '商城兑换';
    if (/商城购买|shop purchase/i.test(reason)) return '商城兑换';
    if (/makeup_checkin_cost|补签/i.test(reason)) return '补签成本';
    if (/扣除|deduct|admin/i.test(reason)) return '管理扣除';
    return '其他消费';
}

function buildPointsFlowFromLedger(rows = []) {
    const incomes = new Map();
    const outflows = new Map();

    rows.forEach((row) => {
        const amount = toNumericValue(row.amount);
        if (amount === null || amount === 0) return;

        const absAmount = Math.abs(amount);

        if (amount > 0) {
            const label = getPointsFlowIncomeLabel(row);
            incomes.set(label, (incomes.get(label) || 0) + absAmount);
        } else {
            const label = getPointsFlowExpenseLabel(row);
            outflows.set(label, (outflows.get(label) || 0) + absAmount);
        }
    });

    const data = [];

    incomes.forEach((value, label) => {
        data.push({
            source_node: label,
            target_node: '用户余额',
            value: roundTo(value, 1) || 0
        });
    });

    outflows.forEach((value, label) => {
        data.push({
            source_node: '用户余额',
            target_node: label,
            value: roundTo(value, 1) || 0
        });
    });

    return data.sort((a, b) => (toNumericValue(b.value) || 0) - (toNumericValue(a.value) || 0));
}

function sumPointsFlow(items = [], direction = 'in') {
    return roundTo(items.reduce((sum, item) => {
        const value = toNumericValue(item.value) || 0;

        if (direction === 'in' && item.target_node === '用户余额') {
            return sum + value;
        }

        if (direction === 'out' && item.source_node === '用户余额') {
            return sum + value;
        }

        return sum;
    }, 0), 1) || 0;
}

async function fetchPointsHealthData() {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_points_health', { p_site: getAnalyticsSiteParam() });
        if (error) throw error;
        if (data && typeof data === 'object') return data;
    } catch (err) {
        console.warn('[Analytics] get_points_health RPC failed, falling back to direct queries:', err);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let balanceQuery = getAnalyticsSupabaseClient().from('points_balance').select('user_id,total_balance');
    balanceQuery = window.AdminSiteFilter?.applySiteFilter(balanceQuery) || balanceQuery;

    let ledgerQuery = supabaseClient
        .from('points_ledger')
        .select('user_id,amount,created_at')
        .lt('amount', 0)
        .gte('created_at', thirtyDaysAgo.toISOString());
    ledgerQuery = window.AdminSiteFilter?.applySiteFilter(ledgerQuery) || ledgerQuery;

    const [{ data: balanceRows, error: balanceError }, { data: spendRows, error: spendError }] = await Promise.all([
        balanceQuery,
        ledgerQuery
    ]);

    if (balanceError) throw balanceError;
    if (spendError) throw spendError;

    let totalCirculation = 0;
    let activeHolders = 0;

    (balanceRows || []).forEach((row) => {
        const balance = toNumericValue(row.total_balance) || 0;
        totalCirculation += balance;
        if (balance > 0) activeHolders += 1;
    });

    let monthlySpend = 0;
    const recentSpenders = new Set();

    (spendRows || []).forEach((row) => {
        const amount = toNumericValue(row.amount);
        if (amount === null || amount >= 0) return;

        monthlySpend += Math.abs(amount);
        if (row.user_id) recentSpenders.add(row.user_id);
    });

    const hoardingUsers = Math.max(activeHolders - recentSpenders.size, 0);
    const velocity = totalCirculation > 0 ? roundTo((monthlySpend / totalCirculation) * 100, 2) : 0;
    const hoardingRate = activeHolders > 0 ? roundTo((hoardingUsers / activeHolders) * 100, 2) : 0;

    return {
        total_circulation: roundTo(totalCirculation, 1) || 0,
        monthly_spend: roundTo(monthlySpend, 1) || 0,
        velocity: velocity || 0,
        hoarding_rate: hoardingRate || 0,
        active_holders: activeHolders,
        hoarding_users: hoardingUsers
    };
}

async function fetchPointsFlowData(days = 30) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_points_flow_v2', {
            p_days: days,
            p_site: getAnalyticsSiteParam()
        });

        if (error) throw error;
        if (Array.isArray(data)) {
            return data.map((item) => ({
                ...item,
                value: roundTo(item.value, 1) || 0
            }));
        }
    } catch (err) {
        console.warn('[Analytics] get_points_flow_v2 RPC failed, falling back to legacy points flow:', err);
    }

    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_points_flow', {
            p_days: days,
            p_site: getAnalyticsSiteParam()
        });

        if (error) throw error;
        if (Array.isArray(data)) {
            return data.map((item) => ({
                ...item,
                value: roundTo(item.value, 1) || 0
            }));
        }
    } catch (err) {
        console.warn('[Analytics] get_points_flow RPC failed, falling back to direct ledger query:', err);
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = supabaseClient
        .from('points_ledger')
        .select('amount,reason,reference_id,created_at')
        .gte('created_at', startDate.toISOString());
    query = window.AdminSiteFilter?.applySiteFilter(query) || query;

    const { data, error } = await query;
    if (error) throw error;

    return buildPointsFlowFromLedger(data || []);
}

async function fetchPointsLeaderboardData(limit = 10) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_points_leaderboard', {
            p_limit: limit,
            p_site: getAnalyticsSiteParam()
        });

        if (error) throw error;
        if (Array.isArray(data)) {
            return data.map((row) => ({
                ...row,
                balance: roundTo(row.balance, 1) || 0,
                total_spent: roundTo(row.total_spent, 1) || 0
            }));
        }
    } catch (err) {
        console.warn('[Analytics] get_points_leaderboard RPC failed, falling back to direct queries:', err);
    }

    let balanceQuery = getAnalyticsSupabaseClient().from('points_balance').select('user_id,total_balance');
    balanceQuery = window.AdminSiteFilter?.applySiteFilter(balanceQuery) || balanceQuery;

    const { data: balanceRows, error: balanceError } = await balanceQuery;
    if (balanceError) throw balanceError;

    const balanceByUser = new Map();
    (balanceRows || []).forEach((row) => {
        if (!row.user_id) return;
        const amount = toNumericValue(row.total_balance) || 0;
        balanceByUser.set(row.user_id, (balanceByUser.get(row.user_id) || 0) + amount);
    });

    const topUsers = Array.from(balanceByUser.entries())
        .map(([user_id, balance]) => ({ user_id, balance: roundTo(balance, 1) || 0 }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, limit);

    if (topUsers.length === 0) return [];

    const userIds = topUsers.map((row) => row.user_id);

    const [{ data: profiles, error: profileError }, { data: spentRows, error: spentError }] = await Promise.all([
        getAnalyticsSupabaseClient().from('profiles').select('id,username,avatar_url').in('id', userIds),
        (() => {
            let query = supabaseClient
                .from('points_ledger')
                .select('user_id,amount')
                .in('user_id', userIds)
                .lt('amount', 0);
            query = window.AdminSiteFilter?.applySiteFilter(query) || query;
            return query;
        })()
    ]);

    if (profileError) throw profileError;
    if (spentError) throw spentError;

    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const spentByUser = new Map();

    (spentRows || []).forEach((row) => {
        const amount = Math.abs(toNumericValue(row.amount) || 0);
        spentByUser.set(row.user_id, (spentByUser.get(row.user_id) || 0) + amount);
    });

    return topUsers.map((row) => {
        const profile = profileMap.get(row.user_id) || {};

        return {
            user_id: row.user_id,
            username: profile.username || '匿名用户',
            avatar_url: profile.avatar_url || '',
            balance: row.balance,
            total_spent: roundTo(spentByUser.get(row.user_id) || 0, 1) || 0
        };
    });
}

// Export for global access
// ============================================
// POINTS ANALYTICS (PHASE 2)
// ============================================

// Load Points Health Stats
async function loadPointsStats(days = getAnalyticsRangeDays()) {
    try {
        const [data, weeklyFlow] = await Promise.all([
            fetchPointsHealthData(),
            fetchPointsFlowData(days)
        ]);

        const totalCirculation = toNumericValue(data?.total_circulation);
        const fallbackIncome = sumPointsFlow(weeklyFlow, 'in');
        const fallbackSpend = sumPointsFlow(weeklyFlow, 'out');
        const weeklyIncome = days === 7
            ? (toNumericValue(data?.weekly_income) ?? fallbackIncome)
            : fallbackIncome;
        const weeklySpend = days === 7
            ? (toNumericValue(data?.weekly_spend) ?? fallbackSpend)
            : fallbackSpend;

        const circulationEl = document.getElementById('kpiPointsValue');
        if (circulationEl && totalCirculation !== null) {
            circulationEl.textContent = formatNumber(totalCirculation);
        }

        const incomeEl = document.getElementById('kpiPointsInValue');
        if (incomeEl) {
            incomeEl.textContent = formatNumber(weeklyIncome);
        }

        const spendEl = document.getElementById('kpiPointsOutValue');
        if (spendEl) {
            spendEl.textContent = formatNumber(weeklySpend);
        }

        const velocityEl = document.getElementById('kpiPointsVelocityValue');
        if (velocityEl) {
            velocityEl.textContent = formatPercent(data?.velocity || 0);
        }

    } catch (err) {
        console.error('[Analytics] Failed to load points health:', err);

        const incomeEl = document.getElementById('kpiPointsInValue');
        const spendEl = document.getElementById('kpiPointsOutValue');
        const velocityEl = document.getElementById('kpiPointsVelocityValue');

        if (incomeEl) incomeEl.textContent = '--';
        if (spendEl) spendEl.textContent = '--';
        if (velocityEl) velocityEl.textContent = '--';
    }
}

// Load Points Distribution Chart
async function loadPointsDistribution() {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_points_distribution', { p_site: getAnalyticsSiteParam() });
        if (error) throw error;

        const ctx = document.getElementById('pointsDistChart');
        if (!ctx) return;

        const theme = getChartTheme();

        if (pointsDistributionChart) {
            pointsDistributionChart.destroy();
        }

        pointsDistributionChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.range_label),
                datasets: [{
                    label: '用户数',
                    data: data.map(d => d.user_count),
                    backgroundColor: chartColors.primary,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `用户数: ${ctx.raw}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load points distribution:', err);
        const ctx = document.getElementById('pointsDistChart');
        if (ctx?.parentElement) {
            ctx.parentElement.innerHTML = renderHintState('fas fa-chart-bar', '积分分布加载失败', 'error');
        }
    }
}

// Load Points Leaderboard
async function loadPointsLeaderboard() {
    try {
        const data = await fetchPointsLeaderboardData(10);
        const container = document.getElementById('pointsLeaderboard');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = renderHintState('fas fa-trophy', '暂无积分排行榜数据');
            return;
        }

        container.innerHTML = data.map((user, index) => `
            <div class="leaderboard-item">
                <div class="rank rank-${index + 1}">${index + 1}</div>
                <div class="user-info">
                    <img src="${user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.user_id}" class="avatar">
                    <div class="details">
                        <div class="name">${user.username || '匿名用户'}</div>
                        <div class="sub">总消费: ${formatNumber(user.total_spent)}</div>
                    </div>
                </div>
                <div class="points-value">
                    <i class="fas fa-coins text-warning"></i> ${formatNumber(user.balance)}
                </div>
            </div>
        `).join('');

    } catch (err) {
        console.error('[Analytics] Failed to load leaderboard:', err);
        const container = document.getElementById('pointsLeaderboard');
        if (container) {
            container.innerHTML = renderHintState('fas fa-triangle-exclamation', '积分富豪榜加载失败', 'error');
        }
    }
}

// Load Redemption Funnel
async function loadRedemptionFunnel(days = getAnalyticsRangeDays()) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_redemption_funnel', {
            p_site: getAnalyticsSiteParam(),
            p_days: days
        });
        if (error) throw error;

        const ctx = document.getElementById('redemptionFunnelChart');
        if (!ctx) return;

        // Check if data is empty or all zeros
        if (!data || data.length === 0 || data.every(d => d.count === 0)) {
            ctx.parentElement.innerHTML = `
                <div class="empty-state-hint">
                    <i class="fas fa-info-circle"></i>
                    <span>暂无兑换码数据</span>
                </div>
            `;
            return;
        }

        // Calculate conversion rates for display
        // data: [{step: '已生成', count: 100, conversion_rate: 100}, ...]

        // Update Redeemed Rate KPI if exists
        const redeemRate = data.find(d => d.step === '已核销')?.conversion_rate;
        const rateEl = document.getElementById('kpiRedeemRateValue');
        if (rateEl && redeemRate !== undefined) {
            rateEl.textContent = redeemRate + '%';
        }

        const theme = getChartTheme();

        if (redemptionFunnelChart) {
            redemptionFunnelChart.destroy();
        }

        redemptionFunnelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.step),
                datasets: [{
                    label: '数量',
                    data: data.map(d => d.count),
                    backgroundColor: [chartColors.primary, chartColors.success, chartColors.secondary],
                    borderRadius: 4,
                    barPercentage: 0.5
                }]
            },
            options: {
                indexAxis: 'y', // Horizontal bar to simulate funnel
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => `${c.raw} (${data[c.dataIndex].conversion_rate}%)`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: theme.text, font: { weight: 'bold' } }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load redemption funnel:', err);
        const ctx = document.getElementById('redemptionFunnelChart');
        if (ctx?.parentElement) {
            ctx.parentElement.innerHTML = renderHintState('fas fa-ticket-alt', '兑换漏斗加载失败', 'error');
        }
    }
}

async function loadOverviewBusinessMix() {
    const container = document.getElementById('overviewBusinessMix');
    const recommendations = document.getElementById('overviewActionRecommendations');
    if (!container) return;

    try {
        const summary = await getOverviewBusinessMixSummaryData();

        container.innerHTML = renderAnalyticsCompactItems(summary.items, {
            iconClass: 'fas fa-compass-drafting',
            message: '当前窗口暂无经营主线数据'
        });

        if (recommendations) {
            recommendations.innerHTML = renderAnalyticsRecommendationItems(summary.recommendations, {
                iconClass: 'fas fa-list-check',
                message: '当前窗口暂无建议动作'
            });
        }
    } catch (err) {
        console.error('[Analytics] Failed to load overview business mix:', err);
        try {
            const [summaryWindow, commentsSummary] = await Promise.all([
                getAnalyticsSummaryWindowData({ forceRefresh: true }),
                getAnalyticsCommentsSummaryData({ forceRefresh: true }).catch(() => null)
            ]);
            const fallbackSummary = buildOverviewBusinessMixFallbackSummary({
                summaryWindow,
                commentsSummary
            });
            container.innerHTML = renderAnalyticsCompactItems(fallbackSummary.items, {
                iconClass: 'fas fa-compass-drafting',
                message: '当前窗口暂无经营主线数据'
            });
            if (recommendations) {
                recommendations.innerHTML = renderAnalyticsRecommendationItems(fallbackSummary.recommendations, {
                    iconClass: 'fas fa-list-check',
                    message: '当前窗口暂无建议动作'
                });
            }
        } catch (fallbackErr) {
            console.error('[Analytics] Overview business mix fallback failed:', fallbackErr);
            container.innerHTML = renderHintState('fas fa-compass-drafting', '经营主线加载失败', 'error');
            if (recommendations) {
                recommendations.innerHTML = renderHintState('fas fa-list-check', '建议动作加载失败', 'error');
            }
        }
    }
}

async function loadOverviewDutyBoard() {
    const container = document.getElementById('overviewDutyBoard');
    if (!container) return;

    container.innerHTML = renderOverviewDutyBoardSkeleton();

    try {
        const [summaryWindowResult, overviewResult, verifyResult, growthResult, operationsResult] = await Promise.allSettled([
            getAnalyticsSummaryWindowData(),
            getOverviewBusinessMixSummaryData(),
            getVerifyServiceSummaryData(),
            getGrowthSummaryData(),
            getOperationsHealthSnapshotData()
        ]);

        const summaryBundle = {
            summaryWindowData: summaryWindowResult.status === 'fulfilled' ? summaryWindowResult.value : null,
            overviewBusinessMix: overviewResult.status === 'fulfilled' ? overviewResult.value : null,
            verifyServiceSummary: verifyResult.status === 'fulfilled' ? verifyResult.value : null,
            growthSummary: growthResult.status === 'fulfilled' ? growthResult.value : null,
            operationsHealthSnapshot: operationsResult.status === 'fulfilled' ? operationsResult.value : null
        };

        container.innerHTML = renderAnalyticsDutyBoard(buildAnalyticsDutyBoardData(summaryBundle));
    } catch (err) {
        console.error('[Analytics] Failed to load overview duty board:', err);
        container.innerHTML = renderHintState('fas fa-clipboard-list', '今日待处理加载失败', 'error');
    }
}

async function loadVerifyServiceSummary() {
    const statusContainer = document.getElementById('verifyStatusList');
    const recentContainer = document.getElementById('verifyRecentList');
    const failureContainer = document.getElementById('verifyFailureList');
    const recommendations = document.getElementById('verifyActionRecommendations');

    if (!statusContainer && !recentContainer && !failureContainer) return;

    try {
        const summary = await getVerifyServiceSummaryData();
        const metrics = summary.metrics || {};

        const requestsEl = document.getElementById('kpiVerifyRequestsValue');
        const successRateEl = document.getElementById('kpiVerifySuccessRateValue');
        const queueEl = document.getElementById('kpiVerifyQueueValue');
        const pointsEl = document.getElementById('kpiVerifyPointsValue');

        if (requestsEl) requestsEl.textContent = formatNumber(metrics.requestCount || 0);
        if (successRateEl) successRateEl.textContent = formatPercent(metrics.successRate || 0);
        if (queueEl) queueEl.textContent = formatNumber(metrics.activeCount || 0);
        if (pointsEl) pointsEl.textContent = formatNumber(metrics.totalPointsCost || 0);

        if (statusContainer) {
            statusContainer.innerHTML = renderAnalyticsCompactItems(summary.statusItems, {
                iconClass: 'fas fa-signal',
                message: '当前窗口暂无验证状态数据'
            });
        }

        if (recentContainer) {
            recentContainer.innerHTML = renderAnalyticsCompactItems(summary.recentItems, {
                iconClass: 'fas fa-list-check',
                message: '当前窗口暂无验证任务'
            });
        }

        if (failureContainer) {
            failureContainer.innerHTML = renderAnalyticsCompactItems(summary.focusItems, {
                iconClass: 'fas fa-triangle-exclamation',
                message: '当前窗口没有失败或阻塞任务'
            });
        }

        if (recommendations) {
            recommendations.innerHTML = renderAnalyticsRecommendationItems(summary.recommendations, {
                iconClass: 'fas fa-list-check',
                message: '当前窗口暂无建议动作'
            });
        }
    } catch (err) {
        console.error('[Analytics] Failed to load verify summary:', err);
        try {
            const [snapshot, summaryWindow] = await Promise.all([
                getAnalyticsVerifyMonitorSnapshotData({ forceRefresh: true }),
                getAnalyticsSummaryWindowData({ forceRefresh: true }).catch(() => null)
            ]);
            const fallbackSummary = buildVerifyServiceSummaryFallback({
                snapshot,
                summaryWindow
            });
            const metrics = fallbackSummary.metrics || {};

            const requestsEl = document.getElementById('kpiVerifyRequestsValue');
            const successRateEl = document.getElementById('kpiVerifySuccessRateValue');
            const queueEl = document.getElementById('kpiVerifyQueueValue');
            const pointsEl = document.getElementById('kpiVerifyPointsValue');

            if (requestsEl) requestsEl.textContent = formatNumber(metrics.requestCount || 0);
            if (successRateEl) successRateEl.textContent = formatPercent(metrics.successRate || 0);
            if (queueEl) queueEl.textContent = formatNumber(metrics.activeCount || 0);
            if (pointsEl) pointsEl.textContent = formatNumber(metrics.totalPointsCost || 0);

            if (statusContainer) {
                statusContainer.innerHTML = renderAnalyticsCompactItems(fallbackSummary.statusItems, {
                    iconClass: 'fas fa-signal',
                    message: '当前窗口暂无验证状态数据'
                });
            }
            if (recentContainer) {
                recentContainer.innerHTML = renderAnalyticsCompactItems(fallbackSummary.recentItems, {
                    iconClass: 'fas fa-list-check',
                    message: '当前窗口暂无验证任务'
                });
            }
            if (failureContainer) {
                failureContainer.innerHTML = renderAnalyticsCompactItems(fallbackSummary.focusItems, {
                    iconClass: 'fas fa-triangle-exclamation',
                    message: '当前窗口没有失败或阻塞任务'
                });
            }
            if (recommendations) {
                recommendations.innerHTML = renderAnalyticsRecommendationItems(fallbackSummary.recommendations, {
                    iconClass: 'fas fa-list-check',
                    message: '当前窗口暂无建议动作'
                });
            }
        } catch (fallbackErr) {
            console.error('[Analytics] Verify summary fallback failed:', fallbackErr);
            const errorState = renderHintState('fas fa-shield-halved', '验证服务摘要加载失败', 'error');
            if (statusContainer) statusContainer.innerHTML = errorState;
            if (recentContainer) recentContainer.innerHTML = errorState;
            if (failureContainer) failureContainer.innerHTML = errorState;
            if (recommendations) recommendations.innerHTML = renderHintState('fas fa-list-check', '建议动作加载失败', 'error');
        }
    }
}

async function loadGrowthSummary() {
    const breakdownContainer = document.getElementById('growthBreakdownList');
    const recommendations = document.getElementById('growthActionRecommendations');
    if (!breakdownContainer) return;

    try {
        const summary = await getGrowthSummaryData();
        const metrics = summary.metrics || {};

        const messagesEl = document.getElementById('kpiGrowthMessagesValue');
        const interactionsEl = document.getElementById('kpiGrowthInteractionsValue');
        const referralEl = document.getElementById('kpiGrowthReferralRewardsValue');
        const checkinEl = document.getElementById('kpiGrowthCheckinRewardsValue');

        if (messagesEl) messagesEl.textContent = formatNumber(metrics.guestbookMessageCount || 0);
        if (interactionsEl) interactionsEl.textContent = formatNumber(metrics.interactionCount || 0);
        if (referralEl) referralEl.textContent = formatNumber(metrics.referralRewardPoints || 0);
        if (checkinEl) checkinEl.textContent = formatNumber(metrics.checkinRewardPoints || 0);

        breakdownContainer.innerHTML = renderAnalyticsCompactItems(summary.breakdownItems, {
            iconClass: 'fas fa-bullhorn',
            message: '当前窗口暂无裂变与激励数据'
        });

        if (recommendations) {
            recommendations.innerHTML = renderAnalyticsRecommendationItems(summary.recommendations, {
                iconClass: 'fas fa-list-check',
                message: '当前窗口暂无建议动作'
            });
        }
    } catch (err) {
        console.error('[Analytics] Failed to load growth summary:', err);
        try {
            const [summaryWindow, commentsSummary] = await Promise.all([
                getAnalyticsSummaryWindowData({ forceRefresh: true }),
                getAnalyticsCommentsSummaryData({ forceRefresh: true }).catch(() => null)
            ]);
            const fallbackSummary = buildGrowthSummaryFallback({
                summaryWindow,
                commentsSummary
            });
            const metrics = fallbackSummary.metrics || {};
            const messagesEl = document.getElementById('kpiGrowthMessagesValue');
            const interactionsEl = document.getElementById('kpiGrowthInteractionsValue');
            const referralEl = document.getElementById('kpiGrowthReferralRewardsValue');
            const checkinEl = document.getElementById('kpiGrowthCheckinRewardsValue');

            if (messagesEl) messagesEl.textContent = formatNumber(metrics.guestbookMessageCount || 0);
            if (interactionsEl) interactionsEl.textContent = formatNumber(metrics.interactionCount || 0);
            if (referralEl) referralEl.textContent = formatNumber(metrics.referralRewardPoints || 0);
            if (checkinEl) checkinEl.textContent = formatNumber(metrics.checkinRewardPoints || 0);

            breakdownContainer.innerHTML = renderAnalyticsCompactItems(fallbackSummary.breakdownItems, {
                iconClass: 'fas fa-bullhorn',
                message: '当前窗口暂无裂变与激励数据'
            });
            if (recommendations) {
                recommendations.innerHTML = renderAnalyticsRecommendationItems(fallbackSummary.recommendations, {
                    iconClass: 'fas fa-list-check',
                    message: '当前窗口暂无建议动作'
                });
            }
        } catch (fallbackErr) {
            console.error('[Analytics] Growth summary fallback failed:', fallbackErr);
            breakdownContainer.innerHTML = renderHintState('fas fa-bullhorn', '裂变与激励摘要加载失败', 'error');
            if (recommendations) recommendations.innerHTML = renderHintState('fas fa-list-check', '建议动作加载失败', 'error');
        }
    }
}

async function loadEventFunnelPanels() {
    const commerceContainer = document.getElementById('commerceEventFunnel');
    const verifyContainer = document.getElementById('verifyEventFunnel');
    const growthContainer = document.getElementById('growthEventFunnel');

    if (!commerceContainer && !verifyContainer && !growthContainer) {
        return;
    }

    try {
        const summaryWindow = await getAnalyticsSummaryWindowData();
        const commerceView = buildCommerceEventFunnelViewData(summaryWindow);
        const verifyView = buildVerifyEventFunnelViewData(summaryWindow);
        const growthView = buildGrowthEventFunnelViewData(summaryWindow);

        if (commerceContainer) {
            commerceContainer.innerHTML = renderAnalyticsCompactItems(commerceView.items, {
                iconClass: 'fas fa-credit-card',
                message: '真实交易事件开始采集中'
            });
        }

        if (verifyContainer) {
            verifyContainer.innerHTML = renderAnalyticsCompactItems(verifyView.items, {
                iconClass: 'fas fa-shuffle',
                message: '真实验证事件开始采集中'
            });
        }

        if (growthContainer) {
            growthContainer.innerHTML = renderAnalyticsCompactItems(growthView.items, {
                iconClass: 'fas fa-seedling',
                message: '真实增长事件开始采集中'
            });
        }
    } catch (err) {
        console.error('[Analytics] Failed to load event funnel panels:', err);
        const errorState = renderHintState('fas fa-chart-simple', '真实事件视图加载失败', 'error');
        if (commerceContainer) commerceContainer.innerHTML = errorState;
        if (verifyContainer) verifyContainer.innerHTML = errorState;
        if (growthContainer) growthContainer.innerHTML = errorState;
    }
}

// ============================================
// ANALYTICS TABS LOGIC
// ============================================

function switchAnalyticsTab(tabId) {
    const nav = document.getElementById('analyticsTabsNav');
    if (!nav) return;

    // Update tab buttons
    const tabs = nav.querySelectorAll('.admin-tab');
    tabs.forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update indicator position
    const activeTab = nav.querySelector('.admin-tab.active');
    if (activeTab) {
        window.updateAdminTabIndicator(activeTab);
    } else {
        nav.style.setProperty('--admin-tab-indicator-width', '0px');
        nav.style.setProperty('--admin-tab-indicator-left', '0px');
    }

    // Update tab content
    document.querySelectorAll('.analytics-tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const activeContent = document.getElementById(`analytics-tab-${tabId}`);
    if (activeContent) {
        activeContent.classList.add('active');

        // Trigger resize for charts in case they were hidden
        window.dispatchEvent(new Event('resize'));
    }

    if (tabId === 'ai') {
        loadExperimentsList();
    }
}

// Initialize indicator position on page load
function initAnalyticsTabIndicator() {
    const nav = document.getElementById('analyticsTabsNav');
    if (!nav) return;

    const activeTab = nav.querySelector('.admin-tab.active');
    if (activeTab) {
        window.updateAdminTabIndicator(activeTab);
    }
}

function shouldLoadAnalyticsAdvancedTools() {
    return document.getElementById('analytics-tab-ai')?.classList.contains('active') === true;
}

function getAnalyticsToneLevel(intensity) {
    const normalized = Number.isFinite(intensity) ? intensity : 0;
    if (normalized <= 0) return 0;
    if (normalized < 0.25) return 1;
    if (normalized < 0.5) return 2;
    if (normalized < 0.75) return 3;
    return 4;
}

function getHeatmapToneClass(count, intensity) {
    return `heatmap-cell--level-${getAnalyticsToneLevel(count > 0 ? intensity : 0)}`;
}

function getCohortToneClass(percent) {
    return `cohort-cell cohort-cell--level-${getAnalyticsToneLevel((Number(percent) || 0) / 100)}`;
}

function setAnalyticsVisibility(element, hidden) {
    if (!element) return;
    element.hidden = hidden;
}

// Export for global access
window.switchAnalyticsTab = switchAnalyticsTab;
window.initAnalyticsModule = initAnalyticsModule;
window.openAnalyticsDestination = openAnalyticsDestination;

function destroyAnalyticsCharts() {
    [
        userTrendChart,
        channelChart,
        contentTrendChart,
        communityChart,
        pointsDistributionChart,
        redemptionFunnelChart,
        funnelChart,
        geoChart,
        abCompareChartInstance
    ].forEach((instance) => {
        try {
            instance?.destroy?.();
        } catch (err) {
            console.warn('[Analytics] Failed to destroy chart instance:', err);
        }
    });

    userTrendChart = null;
    channelChart = null;
    contentTrendChart = null;
    communityChart = null;
    pointsDistributionChart = null;
    redemptionFunnelChart = null;
    funnelChart = null;
    geoChart = null;
    abCompareChartInstance = null;
}

function ensureAnalyticsAutoRefreshState() {
    const toggle = document.getElementById('autoRefreshToggle');
    if (!toggle || !toggle.checked || !isAnalyticsModuleVisible()) {
        stopAutoRefresh();
        return;
    }

    startAutoRefresh();
}

async function reloadAnalyticsDashboard(options = {}) {
    const { includeExperiments = false } = options;
    const days = getAnalyticsRangeDays();
    const cohortWeeks = getAnalyticsCohortWeeks(days);
    const shouldLoadExperiments = includeExperiments || document.getElementById('analytics-tab-ai')?.classList.contains('active');
    const contextKey = getAnalyticsAIContextKey();

    resetAnalyticsDerivedContext(contextKey);

    const phases = [
        [
            updateOnlineUsers(),
            loadOverviewStats(),
            loadOverviewDutyBoard(),
            loadOverviewBusinessMix()
        ],
        [
            loadUserTrendChart(days),
            loadChannelChart(days),
            loadGeoDistribution()
        ],
        [
            loadContentTrendChart(days),
            loadTopContent(days),
            loadActivityHeatmap(days),
            loadTopContributors(),
            loadCommunityChart(days),
            loadConversionFunnel(days),
            loadRetentionCohort(cohortWeeks),
            loadPointsFlow(days),
            loadPointsStats(days),
            loadPointsDistribution(),
            loadPointsLeaderboard(),
            loadRedemptionFunnel(days),
            loadVerifyServiceSummary(),
            loadGrowthSummary(),
            loadEventFunnelPanels()
        ]
    ];

    if (shouldLoadExperiments) {
        phases.push([loadExperimentsList()]);
    }

    for (let index = 0; index < phases.length; index += 1) {
        await Promise.allSettled(phases[index]);
        updateLastUpdateTime();
        if (index < phases.length - 1) {
            await waitForAnalyticsPaint(2);
        }
    }

    updateLastUpdateTime();
}

function teardownAnalyticsModule() {
    analyticsRuntime.moduleActive = false;
    stopAutoRefresh();
    teardownRealtimeSubscriptions();
    destroyAnalyticsCharts();
}

window.reloadAnalyticsDashboard = reloadAnalyticsDashboard;
window.teardownAnalyticsModule = teardownAnalyticsModule;

// ============================================
// ADVANCED CHARTS
// ============================================

// Load Activity Heatmap
async function loadActivityHeatmap(days = getAnalyticsRangeDays(30)) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_activity_heatmap', { p_days: days, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('activityHeatmap');
        if (!container) return;

        // Day names (Sunday = 0)
        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        // Build heatmap matrix (7 days x 24 hours)
        const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
        let maxCount = 0;
        let totalCount = 0;

        data.forEach(d => {
            matrix[d.day_of_week][d.hour_of_day] = d.activity_count;
            totalCount += d.activity_count;
            if (d.activity_count > maxCount) maxCount = d.activity_count;
        });

        // Check if no data
        if (totalCount === 0) {
            container.innerHTML = `
                <div class="empty-state-hint">
                    <i class="fas fa-info-circle"></i>
                    <span>当前窗口暂无登录活动数据</span>
                </div>
            `;
            return;
        }

        // Generate HTML with gradient colors
        let html = '<div class="heatmap-grid">';

        // Header row (hours)
        html += '<div class="heatmap-row header"><div class="heatmap-label"></div>';
        for (let h = 0; h < 24; h += 2) {
            html += `<div class="heatmap-hour">${h}</div>`;
        }
        html += '</div>';

        // Data rows
        for (let d = 0; d < 7; d++) {
            html += `<div class="heatmap-row"><div class="heatmap-label">${dayNames[d]}</div>`;
            for (let h = 0; h < 24; h++) {
                const count = matrix[d][h];
                const intensity = maxCount > 0 ? count / maxCount : 0;
                html += `<div class="heatmap-cell ${getHeatmapToneClass(count, intensity)}" title="${dayNames[d]} ${h}:00 - ${count} 次活动"></div>`;
            }
            html += '</div>';
        }
        html += '</div>';

        // Add legend
        html += `
            <div class="heatmap-legend">
                <span class="legend-label">少</span>
                <div class="legend-gradient"></div>
                <span class="legend-label">多</span>
            </div>
        `;

        container.innerHTML = html;

    } catch (err) {
        console.error('[Analytics] Failed to load heatmap:', err);
        const container = document.getElementById('activityHeatmap');
        if (container) container.innerHTML = '<div class="empty-state">暂无数据</div>';
    }
}

// Load Top Contributors
async function loadTopContributors() {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_top_contributors', { p_limit: 10, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('topContributorsList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无数据</div>';
            return;
        }

        container.innerHTML = data.map((user, index) => `
            <div class="contributor-item">
                <span class="rank rank-${index + 1}">${index + 1}</span>
                <img class="contributor-avatar" src="${user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.user_id}" alt="avatar">
                <div class="contributor-info">
                    <span class="contributor-name">${user.username || '匿名用户'}</span>
                    <span class="contributor-stats">
                        <span><i class="fas fa-comment"></i> ${user.comment_count}</span>
                        <span><i class="fas fa-envelope"></i> ${user.message_count}</span>
                        <span><i class="fas fa-heart"></i> ${user.total_likes_received}</span>
                    </span>
                </div>
                <span class="contributor-score">${Math.round(user.contribution_score)}</span>
            </div>
        `).join('');

    } catch (err) {
        console.error('[Analytics] Failed to load contributors:', err);
        const container = document.getElementById('topContributorsList');
        if (container) container.innerHTML = '<div class="error-state">加载失败</div>';
    }
}

// Load Community Chart
async function loadCommunityChart(days = 30) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_community_stats', { p_days: days, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const ctx = document.getElementById('communityChart');
        if (!ctx) return;

        const theme = getChartTheme();

        // Destroy existing chart
        if (communityChart) {
            communityChart.destroy();
        }

        communityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => formatDate(d.stat_date)),
                datasets: [
                    {
                        label: '留言',
                        data: data.map(d => d.messages),
                        borderColor: chartColors.primary,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    },
                    {
                        label: '评论',
                        data: data.map(d => d.comments),
                        borderColor: chartColors.secondary,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    },
                    {
                        label: '点赞',
                        data: data.map(d => d.likes),
                        borderColor: chartColors.success,
                        backgroundColor: 'transparent',
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: theme.text }
                    }
                },
                scales: {
                    x: {
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Failed to load community chart:', err);
    }
}

// ============================================
// PHASE 10: ADVANCED ANALYTICS
// ============================================

// Chart instance for funnel
let funnelChart = null;

// Load Conversion Funnel
async function loadConversionFunnel(days = getAnalyticsRangeDays(30)) {
    try {
        let data = null;
        let funnelFallbackReason = '';
        try {
            data = await callAnalyticsRpcWithFallback('get_conversion_funnel_v2', [
                { p_days: days, p_site: getAnalyticsSiteParam() }
            ]);
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('empty_v2_conversion_funnel');
            }
            const hasMeaningfulEventData = data.some((item) => normalizeAnalyticsCountValue(item?.user_count) > 0);
            if (!hasMeaningfulEventData) {
                throw new Error('zero_v2_conversion_funnel');
            }
        } catch (error) {
            funnelFallbackReason = String(error?.message || '').trim();
            const fallbackResult = await getAnalyticsSupabaseClient().rpc('get_conversion_funnel', { p_days: days, p_site: getAnalyticsSiteParam() });
            if (fallbackResult.error) throw fallbackResult.error;
            data = fallbackResult.data;
        }

        const container = document.getElementById('conversionFunnel');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-filter"></i>
                <span>暂无转化数据</span>
            </div>`;
            return;
        }

        container.querySelector('.analytics-proxy-hint')?.remove();

        const theme = getChartTheme();
        const ctx = document.getElementById('funnelChart');
        if (!ctx) return;

        // Destroy existing chart
        if (funnelChart) funnelChart.destroy();

        // Horizontal bar chart for funnel
        funnelChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.step_name),
                datasets: [{
                    label: '用户数',
                    data: data.map(d => d.user_count),
                    backgroundColor: [
                        'rgba(107, 158, 206, 0.8)',
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(34, 197, 94, 0.8)'
                    ],
                    borderRadius: 8
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const rate = data[ctx.dataIndex]?.conversion_rate || 0;
                                return `${ctx.raw} 用户 (${rate}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { color: theme.text }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: theme.text }
                    }
                }
            }
        });

        if (data.some((item) => item?.is_proxy_metric)) {
            const proxyHint = (
                funnelFallbackReason === 'empty_v2_conversion_funnel'
                || funnelFallbackReason === 'zero_v2_conversion_funnel'
            )
                ? '当前区间真实事件历史不足，已回退到登录、评论与解锁行为的代理口径。'
                : '当前漏斗仍基于登录、评论与解锁行为的代理口径，后续建议补齐真实浏览事件。';
            container.insertAdjacentHTML(
                'beforeend',
                `<p class="analytics-proxy-hint">${proxyHint}</p>`
            );
        }

    } catch (err) {
        console.error('[Analytics] Failed to load funnel:', err);
    }
}

// Load Retention Cohort Heatmap
async function loadRetentionCohort(weeks = getAnalyticsCohortWeeks()) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_retention_cohort', { p_weeks: weeks, p_site: getAnalyticsSiteParam() });

        if (error) throw error;

        const container = document.getElementById('retentionCohort');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-th"></i>
                <span>暂无留存数据</span>
            </div>`;
            return;
        }

        // Build cohort table
        let html = `
            <table class="cohort-table">
                <thead>
                    <tr>
                        <th>注册周</th>
                        <th>W0</th>
                        <th>W1</th>
                        <th>W2</th>
                        <th>W3</th>
                        <th>W4</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.forEach(row => {
            html += `<tr>
                <td>${row.cohort_week}</td>
                <td class="${getCohortToneClass(row.week_0)}">${row.week_0 || 0}%</td>
                <td class="${getCohortToneClass(row.week_1)}">${row.week_1 || 0}%</td>
                <td class="${getCohortToneClass(row.week_2)}">${row.week_2 || 0}%</td>
                <td class="${getCohortToneClass(row.week_3)}">${row.week_3 || 0}%</td>
                <td class="${getCohortToneClass(row.week_4)}">${row.week_4 || 0}%</td>
            </tr>`;
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (err) {
        console.error('[Analytics] Failed to load retention cohort:', err);
    }
}

// Load Points Flow (Sankey-style list)
async function loadPointsFlow(days = getAnalyticsRangeDays(30)) {
    try {
        const data = await fetchPointsFlowData(days);
        const container = document.getElementById('pointsFlow');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = renderHintState('fas fa-exchange-alt', '暂无积分流向数据');
            return;
        }

        // Group by source -> target
        const inflows = data.filter(d => d.target_node === '用户余额');
        const outflows = data.filter(d => d.source_node === '用户余额');

        let html = '<div class="points-flow-container">';

        // Inflows
        html += '<div class="flow-section"><h4><i class="fas fa-arrow-right flow-section-icon flow-section-icon--inflow"></i> 收入来源</h4>';
        inflows.forEach(item => {
            html += `<div class="flow-item inflow">
                <span class="flow-label">${item.source_node}</span>
                <span class="flow-value">+${formatNumber(item.value)}</span>
            </div>`;
        });
        html += '</div>';

        // Outflows
        html += '<div class="flow-section"><h4><i class="fas fa-arrow-left flow-section-icon flow-section-icon--outflow"></i> 消费去向</h4>';
        outflows.forEach(item => {
            html += `<div class="flow-item outflow">
                <span class="flow-label">${item.target_node}</span>
                <span class="flow-value">-${formatNumber(item.value)}</span>
            </div>`;
        });
        html += '</div></div>';

        container.innerHTML = html;

    } catch (err) {
        console.error('[Analytics] Failed to load points flow:', err);
        const container = document.getElementById('pointsFlow');
        if (container) {
            container.innerHTML = renderHintState('fas fa-triangle-exclamation', '积分流向加载失败', 'error');
        }
    }
}

// ============================================
// PHASE 12: AI PREDICTION
// ============================================

async function loadAIPrediction() {
    const container = document.getElementById('aiPredictionContent');
    if (!container) return;
    let trendSeries = [];
    const days = Math.max(7, getAnalyticsRangeDays(30));

    if (!hasAdminAI()) {
        try {
            await window.AdminAI?.checkHealth?.();
        } catch (err) {
            console.warn('[Analytics] AI proxy health check failed:', err);
        }
    }

    if (!hasAdminAI()) {
        container.innerHTML = '<p class="ai-error">请先在后台 API 配置或 Vercel 环境变量中配置 Gemini Key</p>';
        return;
    }

    container.innerHTML = '<p class="ai-loading">AI 正在生成预测...</p>';

    try {
        // Get trend data
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_user_trend', { p_days: days, p_site: getAnalyticsSiteParam() });
        if (error) throw error;
        trendSeries = Array.isArray(data) ? data.map((item) => item?.new_users) : [];

        const prompt = `基于以下 ${days} 天的用户数据趋势，预测未来7天的走势（每天一个数字）。
只返回JSON数组格式，例如: [15, 18, 20, 22, 19, 21, 25]

数据：${JSON.stringify(trendSeries)}`;

        const text = await window.AdminAI.generateText(prompt, {
            model: window.AdminAI?.defaultModel || 'gemini-2.0-flash',
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 256
            }
        });

        // Parse prediction
        const match = (text || '[]').match(/\[[\d,\s]+\]/);
        if (match) {
            const predictions = JSON.parse(match[0]);
            container.innerHTML = renderPredictionMarkup(predictions);
        } else {
            container.innerHTML = '<p class="ai-error">预测解析失败</p>';
        }

    } catch (err) {
        console.error('[Analytics] AI prediction error:', err);
        if (isGeminiQuotaError(err)) {
            const fallbackPredictions = buildLocalPrediction(trendSeries, 7);
            container.innerHTML = renderPredictionMarkup(fallbackPredictions, '已切换为本地趋势估算');
        } else {
            container.innerHTML = `<p class="ai-error">预测失败: ${err.message}</p>`;
        }
    }
}

// ============================================
// PHASE 11: GEO DISTRIBUTION
// ============================================

// Geo chart instance
let geoChart = null;

async function loadGeoDistribution() {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_geo_distribution_by_site', {
            p_site: getAnalyticsSiteParam()
        });

        if (error) throw error;

        const container = document.getElementById('geoDistribution');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-globe-asia"></i>
                <span>暂无地理数据</span>
            </div>`;
            return;
        }

        const theme = getChartTheme();
        const ctx = document.getElementById('geoChart');
        if (!ctx) return;

        if (geoChart) geoChart.destroy();

        geoChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.region),
                datasets: [{
                    data: data.map(d => d.user_count),
                    backgroundColor: [
                        '#6b9ece', '#8b5cf6', '#22c55e', '#f59e0b',
                        '#ef4444', '#ec4899', '#14b8a6', '#64748b'
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: theme.text }
                    }
                }
            }
        });

    } catch (err) {
        console.error('[Analytics] Geo distribution error:', err);
    }
}

// ============================================
// PHASE 13: TRACKING SDK
// Frontend event tracking
// ============================================

const TrackingSDK = {
    sessionId: null,

    init() {
        this.sessionId = this.generateSessionId();
        console.log('[Tracking] SDK initialized, session:', this.sessionId);
    },

    generateSessionId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `sess_${crypto.randomUUID()}`;
        }
        return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    async track(eventType, eventName, eventData = {}) {
        try {
            const { data, error } = await getAnalyticsSupabaseClient().rpc('track_event', {
                p_event_type: eventType,
                p_event_name: eventName,
                p_event_data: eventData,
                p_page_url: window.location.href,
                p_session_id: this.sessionId
            });

            if (error) throw error;
            console.log('[Tracking] Event tracked:', eventName);
            return data;
        } catch (err) {
            console.warn('[Tracking] Failed to track event:', err);
            return null;
        }
    },

    // Convenience methods
    pageView(pageName) {
        return this.track('page_view', pageName, { url: window.location.pathname });
    },

    click(elementName, data = {}) {
        return this.track('click', elementName, data);
    },

    conversion(conversionName, data = {}) {
        return this.track('conversion', conversionName, data);
    }
};

// Initialize tracking on load
if (typeof window !== 'undefined') {
    window.TrackingSDK = TrackingSDK;
}

// ============================================
// PHASE 14: A/B TESTING UI
// ============================================

async function loadExperimentsList() {
    try {
        const { data, error } = await supabaseClient
            .from('ab_experiments')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const container = document.getElementById('experimentsList');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state-hint">
                <i class="fas fa-flask"></i>
                <span>暂无实验</span>
            </div>`;
            return;
        }

        container.innerHTML = data.map(exp => {
            const metricLabel = getAnalyticsExperimentTargetMetricLabel(exp.target_metric);
            const metricMode = getAnalyticsExperimentTargetMetricMode(exp.target_metric);
            return `
            <div class="experiment-card">
                <div class="exp-header">
                    <span class="exp-name">${exp.name}</span>
                    <span class="exp-status status-${exp.status}">${exp.status}</span>
                </div>
                <div class="exp-meta">
                    <span>${exp.description || '无描述'}</span>
                </div>
                <div class="exp-metric-row">
                    <span class="exp-target-chip exp-target-chip--${metricMode}">目标：${escapeHtml(metricLabel)}</span>
                    <span class="exp-target-chip exp-target-chip--subtle">${metricMode === 'business' ? '真实事件回看' : '旧口径兼容映射'}</span>
                </div>
                <div class="exp-variants">
                    ${(exp.variants || []).map(v => `
                        <span class="variant-badge">${v.name} (${v.weight}%)</span>
                    `).join('')}
                </div>
                <button class="btn-sm btn-secondary view-results-btn"
                    data-admin-action="analytics-show-ab-results"
                    data-experiment-id="${encodeURIComponent(String(exp.id || ''))}"
                    data-experiment-name="${encodeURIComponent(String(exp.name || ''))}"
                    data-experiment-target-metric="${encodeURIComponent(String(exp.target_metric || ''))}"
                    data-experiment-variants="${encodeURIComponent(JSON.stringify(exp.variants || []))}">
                    <i class="fas fa-chart-bar"></i> 查看结果
                </button>
            </div>
        `;
        }).join('');

    } catch (err) {
        console.error('[Analytics] Experiments list error:', err);
    }
}

async function getExperimentVariant(experimentName) {
    try {
        const { data, error } = await getAnalyticsSupabaseClient().rpc('get_experiment_variant', {
            p_experiment_name: experimentName
        });

        if (error) throw error;
        return data;
    } catch (err) {
        console.warn('[A/B] Failed to get variant:', err);
        return null;
    }
}

// Expose A/B testing to window
if (typeof window !== 'undefined') {
    window.ABTest = {
        getVariant: getExperimentVariant
    };
}

// ============================================
// A/B EXPERIMENT MANAGEMENT UI
// ============================================

function bindExperimentModalOverlayDismiss() {
    const modal = document.getElementById('experimentModal');
    if (!(modal instanceof HTMLElement) || modal.dataset.overlayDismissBound === '1') {
        return;
    }

    modal.dataset.overlayDismissBound = '1';
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeExperimentModal();
        }
    });
}

function openExperimentModal(context = null) {
    const modal = document.getElementById('experimentModal');
    if (modal) {
        bindExperimentModalOverlayDismiss();
        modal.classList.add('active');
        const parsedContext = parseAnalyticsActionContext(context);
        const hasTemplateContext = parsedContext && typeof parsedContext === 'object' && Object.keys(parsedContext).length > 0;
        if (hasTemplateContext) {
            applyAnalyticsExperimentTemplate(parsedContext);
        } else {
            applyAnalyticsExperimentTemplate({
                name: '',
                description: '',
                targetMetric: 'page_view',
                variants: [
                    { name: 'Control', weight: 50 },
                    { name: 'Variant A', weight: 50 }
                ]
            });
        }
        requestAnimationFrame(() => document.getElementById('expName')?.focus());
    }
}

function closeExperimentModal() {
    const modal = document.getElementById('experimentModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function addVariantRow() {
    const list = document.getElementById('variantsList');
    if (!list) return;

    const count = list.querySelectorAll('.variant-row').length;
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.innerHTML = `
        <input type="text" placeholder="Variant ${String.fromCharCode(65 + count)}" class="variant-name">
        <input type="number" placeholder="0" value="0" class="variant-weight" min="0" max="100">
        <span>%</span>
        <button type="button" class="btn-icon-sm" data-admin-action="analytics-remove-variant-row">
            <i class="fas fa-times"></i>
        </button>
    `;
    list.appendChild(row);
}

async function handleCreateExperiment(event) {
    event.preventDefault();

    const name = document.getElementById('expName').value.trim();
    const description = document.getElementById('expDescription').value.trim();
    const targetMetric = document.getElementById('expTargetMetric')?.value || 'page_view';

    // Collect variants
    const variantRows = document.querySelectorAll('#variantsList .variant-row');
    const variants = [];

    variantRows.forEach(row => {
        const nameInput = row.querySelector('.variant-name');
        const weightInput = row.querySelector('.variant-weight');
        if (nameInput && weightInput) {
            variants.push({
                name: nameInput.value.trim() || `Variant ${variants.length + 1}`,
                weight: parseInt(weightInput.value) || 0
            });
        }
    });

    // Validate
    if (!name) {
        alert('请输入实验名称');
        return;
    }

    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    if (totalWeight !== 100) {
        alert(`变体权重总和必须为 100%，当前为 ${totalWeight}%`);
        return;
    }

    try {
        const { data: { user } } = await getAnalyticsSupabaseClient().auth.getUser();

        const { error } = await supabaseClient
            .from('ab_experiments')
            .insert({
                name: name,
                description: description,
                status: 'running',
                variants: variants,
                target_metric: targetMetric,
                created_by: user?.id
            });

        if (error) throw error;

        closeExperimentModal();
        loadExperimentsList();
        if (typeof showToast === 'function') {
            showToast('实验创建成功！', 'success');
        }
    } catch (err) {
        console.error('[A/B] Create experiment error:', err);
        alert('创建失败: ' + err.message);
    }
}

// Expose to window
window.loadAIPrediction = loadAIPrediction;
window.loadExperimentsList = loadExperimentsList;
window.openExperimentModal = openExperimentModal;
window.closeExperimentModal = closeExperimentModal;
window.addVariantRow = addVariantRow;
window.handleCreateExperiment = handleCreateExperiment;

// A/B Results Chart
let abCompareChartInstance = null;

const ANALYTICS_EXPERIMENT_PLACEMENT_LABELS = {
    prompt_unlock_button: 'Prompt 解锁按钮',
    verify_submit_button: 'Verify 提交按钮',
    wallet_custom_recharge_button: '钱包自定义充值',
    shop_purchase_modal_confirm: '商城购买确认'
};

const ANALYTICS_EXPERIMENT_PLACEMENT_DESTINATIONS = {
    prompt_unlock_button: {
        destination: 'analytics-content',
        sectionId: 'topContentList',
        actionLabel: '查看内容入口',
        icon: 'fas fa-sparkles'
    },
    verify_submit_button: {
        destination: 'verify-monitor',
        actionLabel: '打开 Verify Monitor',
        icon: 'fas fa-wave-square'
    },
    wallet_custom_recharge_button: {
        destination: 'analytics-monetization',
        sectionId: 'commerceEventFunnel',
        actionLabel: '查看充值入口',
        icon: 'fas fa-wallet'
    },
    shop_purchase_modal_confirm: {
        destination: 'analytics-monetization',
        sectionId: 'commerceEventFunnel',
        actionLabel: '查看商城入口',
        icon: 'fas fa-bag-shopping'
    }
};

function getAnalyticsExperimentPlacementLabel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '未标记入口';
    if (ANALYTICS_EXPERIMENT_PLACEMENT_LABELS[normalized]) {
        return ANALYTICS_EXPERIMENT_PLACEMENT_LABELS[normalized];
    }
    if (normalized === 'default') return '默认入口';
    return normalized
        .split(/[_-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function getAnalyticsExperimentBreakdownLabel(dimensionType = '', dimensionValue = '') {
    const normalizedType = String(dimensionType || '').trim().toLowerCase();
    const normalizedValue = String(dimensionValue || '').trim().toLowerCase();
    if (normalizedType === 'site') {
        if (normalizedValue === 'cn') return 'CN 站点';
        if (normalizedValue === 'intl') return 'INTL 站点';
        return normalizedValue ? `${normalizedValue.toUpperCase()} 站点` : '未标记站点';
    }
    if (normalizedType === 'placement') {
        return getAnalyticsExperimentPlacementLabel(normalizedValue);
    }
    return String(dimensionValue || '未标记').trim() || '未标记';
}

function getAnalyticsExperimentCurrentSiteContext() {
    const currentSite = String(window.AdminSiteFilter?.getSiteFilter?.() || 'all').trim().toLowerCase();
    return ['cn', 'intl'].includes(currentSite) ? currentSite : '';
}

function buildAnalyticsExperimentBreakdownAction(dimensionType = '', dimensionValue = '', options = {}) {
    const normalizedType = String(dimensionType || '').trim().toLowerCase();
    const normalizedValue = String(dimensionValue || '').trim().toLowerCase();
    const variantName = String(options?.variantName || '').trim();
    const experimentId = String(options?.experimentId || '').trim();
    const experimentName = String(options?.experimentName || '').trim();
    const targetMetric = String(options?.targetMetric || '').trim();
    const currentSite = getAnalyticsExperimentCurrentSiteContext();
    const experimentVariantLabel = [experimentName, variantName].filter(Boolean).join(' · ');

    if (normalizedType === 'site' && ['cn', 'intl'].includes(normalizedValue)) {
        return {
            destination: 'analytics-ai',
            icon: 'fas fa-arrow-right',
            actionLabel: `切到 ${normalizedValue === 'intl' ? 'INTL' : 'CN'} 查看`,
            context: {
                site: normalizedValue,
                sectionId: 'abResultsChart',
                experimentId,
                experimentName,
                targetMetric,
                variantName,
                title: experimentVariantLabel || experimentName || '实验结果',
                referenceLabel: variantName ? '实验变体' : '实验',
                referenceValue: experimentVariantLabel || experimentName || ''
            }
        };
    }

    if (normalizedType === 'placement') {
        const placementConfig = ANALYTICS_EXPERIMENT_PLACEMENT_DESTINATIONS[normalizedValue];
        if (placementConfig) {
            return {
                destination: placementConfig.destination,
                icon: placementConfig.icon,
                actionLabel: placementConfig.actionLabel,
                context: {
                    ...(currentSite ? { site: currentSite } : {}),
                    ...(placementConfig.sectionId ? { sectionId: placementConfig.sectionId } : {}),
                    experimentId,
                    experimentName,
                    targetMetric,
                    variantName,
                    placement: normalizedValue,
                    title: getAnalyticsExperimentPlacementLabel(normalizedValue),
                    referenceLabel: variantName ? '实验变体' : '实验',
                    referenceValue: experimentVariantLabel || experimentName || ''
                }
            };
        }
    }

    return {
        destination: 'analytics-ai',
        icon: 'fas fa-arrow-right',
        actionLabel: '回到实验结果',
        context: {
            ...(currentSite ? { site: currentSite } : {}),
            sectionId: 'abResultsChart',
            experimentId,
            experimentName,
            targetMetric,
            variantName,
            title: experimentVariantLabel || experimentName || '实验结果',
            referenceLabel: variantName ? '实验变体' : '实验',
            referenceValue: experimentVariantLabel || experimentName || ''
        }
    };
}

function normalizeAnalyticsExperimentResultsPayload(results = [], variants = []) {
    const rows = Array.isArray(results) ? results : [];
    const hasV2Rows = rows.some((row) => String(row?.dimension_type || '').trim());
    const overviewSeed = new Map();

    (Array.isArray(variants) ? variants : []).forEach((variant) => {
        const variantName = String(variant?.name || '').trim();
        if (!variantName || overviewSeed.has(variantName)) return;
        overviewSeed.set(variantName, {
            variant_name: variantName,
            assigned_user_count: 0,
            exposure_user_count: 0,
            conversion_count: 0,
            conversion_rate: 0
        });
    });

    const sourceRows = hasV2Rows
        ? rows.filter((row) => String(row?.dimension_type || '').trim().toLowerCase() === 'overall')
        : rows;

    sourceRows.forEach((row) => {
        const variantName = String(row?.variant_name || '').trim();
        if (!variantName) return;
        overviewSeed.set(variantName, {
            variant_name: variantName,
            assigned_user_count: Number(
                row?.assigned_user_count
                ?? row?.user_count
                ?? 0
            ) || 0,
            exposure_user_count: Number(
                row?.exposure_user_count
                ?? row?.user_count
                ?? 0
            ) || 0,
            conversion_count: Number(row?.conversion_count || 0) || 0,
            conversion_rate: Number(row?.conversion_rate || 0) || 0
        });
    });

    if (overviewSeed.size === 0 && hasV2Rows) {
        rows.forEach((row) => {
            const variantName = String(row?.variant_name || '').trim();
            if (!variantName || overviewSeed.has(variantName)) return;
            overviewSeed.set(variantName, {
                variant_name: variantName,
                assigned_user_count: 0,
                exposure_user_count: 0,
                conversion_count: 0,
                conversion_rate: 0
            });
        });
    }

    return {
        isV2: hasV2Rows,
        overviewRows: Array.from(overviewSeed.values()),
        siteRows: hasV2Rows
            ? rows.filter((row) => String(row?.dimension_type || '').trim().toLowerCase() === 'site')
            : [],
        placementRows: hasV2Rows
            ? rows.filter((row) => String(row?.dimension_type || '').trim().toLowerCase() === 'placement')
            : []
    };
}

function buildAnalyticsExperimentResultsSummary(overviewRows = []) {
    const totals = (Array.isArray(overviewRows) ? overviewRows : []).reduce((accumulator, row) => {
        accumulator.assigned += Number(row?.assigned_user_count || 0) || 0;
        accumulator.exposure += Number(row?.exposure_user_count || 0) || 0;
        accumulator.conversion += Number(row?.conversion_count || 0) || 0;
        return accumulator;
    }, { assigned: 0, exposure: 0, conversion: 0 });

    const exposureRate = getAnalyticsPercentRate(totals.exposure, totals.assigned, 1);
    const conversionRate = getAnalyticsPercentRate(totals.conversion, totals.exposure, 1);
    const leader = [...(Array.isArray(overviewRows) ? overviewRows : [])]
        .sort((left, right) => {
            const rateDelta = (Number(right?.conversion_rate || 0) || 0) - (Number(left?.conversion_rate || 0) || 0);
            if (rateDelta !== 0) return rateDelta;
            const conversionDelta = (Number(right?.conversion_count || 0) || 0) - (Number(left?.conversion_count || 0) || 0);
            if (conversionDelta !== 0) return conversionDelta;
            return (Number(right?.exposure_user_count || 0) || 0) - (Number(left?.exposure_user_count || 0) || 0);
        })
        .find((row) => (Number(row?.assigned_user_count || 0) || 0) > 0) || null;

    return {
        totals,
        exposureRate,
        conversionRate,
        leader
    };
}

function renderAnalyticsExperimentResultsHighlights(overviewRows = [], targetMetricLabel = '') {
    const summary = buildAnalyticsExperimentResultsSummary(overviewRows);
    const leaderLabel = summary.leader?.variant_name
        ? `${escapeHtml(summary.leader.variant_name)} ${formatPercent(summary.leader.conversion_rate)}`
        : '等待曝光';

    return `
        <div class="ab-results-highlight-grid">
            <div class="ab-results-highlight-card">
                <span class="ab-results-highlight-card__label">已分配用户</span>
                <span class="ab-results-highlight-card__value">${formatNumber(summary.totals.assigned)}</span>
                <span class="ab-results-highlight-card__meta">当前进入实验分桶的总人数</span>
            </div>
            <div class="ab-results-highlight-card">
                <span class="ab-results-highlight-card__label">已曝光用户</span>
                <span class="ab-results-highlight-card__value">${formatNumber(summary.totals.exposure)}</span>
                <span class="ab-results-highlight-card__meta">覆盖率 ${formatPercent(summary.exposureRate)}，真正看到了实验入口的用户</span>
            </div>
            <div class="ab-results-highlight-card">
                <span class="ab-results-highlight-card__label">${escapeHtml(targetMetricLabel)}</span>
                <span class="ab-results-highlight-card__value">${formatNumber(summary.totals.conversion)}</span>
                <span class="ab-results-highlight-card__meta">曝光后转化率 ${formatPercent(summary.conversionRate)}</span>
            </div>
            <div class="ab-results-highlight-card">
                <span class="ab-results-highlight-card__label">当前领先变体</span>
                <span class="ab-results-highlight-card__value">${leaderLabel}</span>
                <span class="ab-results-highlight-card__meta">${summary.leader ? `曝光 ${formatNumber(summary.leader.exposure_user_count)} / 转化 ${formatNumber(summary.leader.conversion_count)}` : '等待实验曝光和转化样本'}</span>
            </div>
        </div>
    `;
}

function renderAnalyticsExperimentBreakdownPanel(title, dimensionType, rows = [], options = {}) {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    if (normalizedRows.length === 0) {
        return `
            <div class="ab-results-panel">
                <div class="ab-results-panel__header">
                    <span class="ab-results-panel__title">${escapeHtml(title)}</span>
                    <span class="ab-results-panel__meta">按真实 experiment_exposure 回看</span>
                </div>
                ${renderHintState('fas fa-wave-square', '当前还没有可用于下钻的曝光样本', 'empty')}
            </div>
        `;
    }

    const grouped = normalizedRows.reduce((accumulator, row) => {
        const key = String(row?.dimension_value || '').trim().toLowerCase() || 'default';
        if (!accumulator.has(key)) {
            accumulator.set(key, []);
        }
        accumulator.get(key).push({
            variant_name: String(row?.variant_name || '').trim() || 'Unknown',
            exposure_user_count: Number(row?.exposure_user_count || 0) || 0,
            conversion_count: Number(row?.conversion_count || 0) || 0,
            conversion_rate: Number(row?.conversion_rate || 0) || 0
        });
        return accumulator;
    }, new Map());

    const groups = Array.from(grouped.entries())
        .map(([dimensionValue, items]) => {
            const sortedItems = items.sort((left, right) => {
                const rateDelta = right.conversion_rate - left.conversion_rate;
                if (rateDelta !== 0) return rateDelta;
                return right.exposure_user_count - left.exposure_user_count;
            });
            const totalExposure = sortedItems.reduce((sum, item) => sum + item.exposure_user_count, 0);
            const totalConversion = sortedItems.reduce((sum, item) => sum + item.conversion_count, 0);
            return {
                dimensionValue,
                label: getAnalyticsExperimentBreakdownLabel(dimensionType, dimensionValue),
                items: sortedItems,
                totalExposure,
                totalConversion,
                totalRate: getAnalyticsPercentRate(totalConversion, totalExposure, 1)
            };
        })
        .sort((left, right) => {
            const rateDelta = right.totalRate - left.totalRate;
            if (rateDelta !== 0) return rateDelta;
            return right.totalExposure - left.totalExposure;
        });

    return `
        <div class="ab-results-panel">
            <div class="ab-results-panel__header">
                <span class="ab-results-panel__title">${escapeHtml(title)}</span>
                <span class="ab-results-panel__meta">按真实 experiment_exposure 回看</span>
            </div>
            <div class="ab-results-breakdown-list">
                ${groups.map((group) => `
                    <div class="ab-breakdown-card">
                        <div class="ab-breakdown-card__header">
                            <span class="ab-breakdown-card__title">${escapeHtml(group.label)}</span>
                            <span class="ab-breakdown-card__meta">曝光 ${formatNumber(group.totalExposure)} / 转化 ${formatNumber(group.totalConversion)} / ${formatPercent(group.totalRate)}</span>
                        </div>
                        <div class="ab-breakdown-card__rows">
                            ${group.items.map((item, index) => `
                                ${(() => {
                                    const action = buildAnalyticsExperimentBreakdownAction(dimensionType, group.dimensionValue, {
                                        experimentId: options.experimentId,
                                        experimentName: options.experimentName,
                                        targetMetric: options.targetMetric,
                                        variantName: item.variant_name
                                    });
                                    return `
                                <div class="ab-breakdown-row${index === 0 ? ' is-best' : ''}">
                                    <span class="ab-breakdown-row__variant">${escapeHtml(item.variant_name)}</span>
                                    <span class="ab-breakdown-row__metric">曝光 ${formatNumber(item.exposure_user_count)}</span>
                                    <span class="ab-breakdown-row__metric">转化 ${formatNumber(item.conversion_count)}</span>
                                    <strong class="ab-breakdown-row__rate">${formatPercent(item.conversion_rate)}</strong>
                                    <button
                                        type="button"
                                        class="btn-sm btn-secondary ab-breakdown-row__action"
                                        data-admin-action="analytics-open-destination"
                                        data-analytics-destination="${escapeHtml(action.destination || '')}"
                                        data-analytics-context="${escapeHtml(serializeAnalyticsActionContext(action.context || null))}"
                                    >
                                        <i class="${escapeHtml(action.icon || 'fas fa-arrow-right')}"></i> ${escapeHtml(action.actionLabel || '去排查')}
                                    </button>
                                </div>
                            `;
                                })()}
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderAnalyticsExperimentResultsBody(payload = null, targetMetricLabel = '', options = {}) {
    const overviewRows = Array.isArray(payload?.overviewRows) ? payload.overviewRows : [];
    const siteRows = Array.isArray(payload?.siteRows) ? payload.siteRows : [];
    const placementRows = Array.isArray(payload?.placementRows) ? payload.placementRows : [];
    const isV2 = payload?.isV2 === true;

    return `
        ${renderAnalyticsExperimentResultsHighlights(overviewRows, targetMetricLabel)}
        ${!isV2 ? `<div class="ab-results-fallback-note">当前数据库还在使用旧版实验结果 RPC，已先展示聚合结果；执行最新 SQL 后这里会出现按站点和入口的真实曝光下钻。</div>` : ''}
        <div class="ab-results-panel-grid">
            ${renderAnalyticsExperimentBreakdownPanel('按站点回看', 'site', siteRows, options)}
            ${renderAnalyticsExperimentBreakdownPanel('按入口回看', 'placement', placementRows, options)}
        </div>
    `;
}

async function showABResults(experimentId, experimentName, variants, targetMetric = '') {
    console.log('[A/B] Showing results for:', experimentName);

    const chartContainer = document.getElementById('abResultsChart');
    const chartTitle = document.getElementById('abChartTitle');
    const canvas = document.getElementById('abCompareChart');
    const canvasWrap = chartContainer?.querySelector('.ab-results-canvas-wrap');
    const bodyContainer = document.getElementById('abResultsBody');
    const targetMetricLabel = getAnalyticsExperimentTargetMetricLabel(targetMetric);

    if (!chartContainer || !canvas || !bodyContainer) return;

    // Show chart area
    setAnalyticsVisibility(chartContainer, false);
    setAnalyticsVisibility(canvasWrap, false);
    if (chartTitle) chartTitle.textContent = `${experimentName} - ${targetMetricLabel} 结果对比`;

    try {
        let payload = null;

        try {
            const { data: v2Results, error: v2Error } = await getAnalyticsSupabaseClient().rpc('get_experiment_results_v2', {
                p_experiment_id: experimentId
            });
            if (v2Error) throw v2Error;
            payload = normalizeAnalyticsExperimentResultsPayload(v2Results, variants);
        } catch (v2Error) {
            console.warn('[A/B] Results v2 unavailable, fallback to legacy RPC:', v2Error);
            const { data: legacyResults, error: legacyError } = await getAnalyticsSupabaseClient().rpc('get_experiment_results', {
                p_experiment_id: experimentId
            });
            if (legacyError) throw legacyError;
            payload = normalizeAnalyticsExperimentResultsPayload(legacyResults, variants);
        }

        const overviewRows = Array.isArray(payload?.overviewRows) ? payload.overviewRows : [];
        const labels = overviewRows.map((row) => row.variant_name);
        const assignedData = overviewRows.map((row) => Number(row?.assigned_user_count || 0));
        const exposureData = overviewRows.map((row) => Number(row?.exposure_user_count || 0));
        const conversionData = overviewRows.map((row) => Number(row?.conversion_count || 0));
        const conversionRates = overviewRows.map((row) => Number(row?.conversion_rate || 0));
        const datasets = payload?.isV2
            ? [
                {
                    label: '分配用户数',
                    data: assignedData,
                    backgroundColor: 'rgba(107, 158, 206, 0.45)',
                    borderColor: '#6b9ece',
                    borderWidth: 1,
                    borderRadius: 6
                },
                {
                    label: '曝光用户数',
                    data: exposureData,
                    backgroundColor: 'rgba(245, 158, 11, 0.58)',
                    borderColor: '#f59e0b',
                    borderWidth: 1,
                    borderRadius: 6
                },
                {
                    label: '转化用户数',
                    data: conversionData,
                    backgroundColor: 'rgba(52, 211, 153, 0.7)',
                    borderColor: '#34d399',
                    borderWidth: 1,
                    borderRadius: 6
                }
            ]
            : [
                {
                    label: '分配用户数',
                    data: assignedData,
                    backgroundColor: 'rgba(107, 158, 206, 0.7)',
                    borderColor: '#6b9ece',
                    borderWidth: 1,
                    borderRadius: 6
                },
                {
                    label: '转化用户数',
                    data: conversionData,
                    backgroundColor: 'rgba(52, 211, 153, 0.7)',
                    borderColor: '#34d399',
                    borderWidth: 1,
                    borderRadius: 6
                }
            ];

        // Destroy previous chart
        if (abCompareChartInstance) {
            abCompareChartInstance.destroy();
        }

        // Create chart with multiple datasets
        const ctx = canvas.getContext('2d');
        abCompareChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-main') || '#333' }
                    },
                    tooltip: {
                        callbacks: {
                            afterBody: function (context) {
                                const index = context[0].dataIndex;
                                return `转化率: ${conversionRates[index]}%`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#888' }
                    },
                    x: {
                        ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-main') || '#333' }
                    }
                }
            }
        });

        bodyContainer.innerHTML = renderAnalyticsExperimentResultsBody(payload, targetMetricLabel, {
            experimentId,
            experimentName,
            targetMetric
        });

        if (assignedData.every((value) => value === 0)) {
            bodyContainer.innerHTML += '<div class="ab-results-fallback-note">当前还没有进入实验分流的用户，先确认前台入口是否已经接入实验曝光埋点。</div>';
        } else if (payload?.isV2 && exposureData.every((value) => value === 0)) {
            bodyContainer.innerHTML += '<div class="ab-results-fallback-note">当前已有实验分配，但还没有看到 experiment_exposure，优先检查前台入口是否真正调用了实验运行时。</div>';
        } else if (conversionData.every((value) => value === 0)) {
            bodyContainer.innerHTML += `<div class="ab-results-fallback-note">当前还没有匹配到 ${escapeHtml(targetMetricLabel)} 事件，建议先确认目标链路是否已把 experimentId / variantId 一起写入 user_events。</div>`;
        }

    } catch (err) {
        console.error('[A/B] Results error:', err);
        if (abCompareChartInstance) {
            abCompareChartInstance.destroy();
            abCompareChartInstance = null;
        }
        setAnalyticsVisibility(canvasWrap, true);
        bodyContainer.innerHTML = renderHintState('fas fa-triangle-exclamation', `加载失败: ${err.message}`, 'error');
    }
}

function closeABResultsChart() {
    const chartContainer = document.getElementById('abResultsChart');
    const bodyContainer = document.getElementById('abResultsBody');
    const canvasWrap = chartContainer?.querySelector('.ab-results-canvas-wrap');
    if (chartContainer) {
        setAnalyticsVisibility(chartContainer, true);
    }
    if (abCompareChartInstance) {
        abCompareChartInstance.destroy();
        abCompareChartInstance = null;
    }
    if (bodyContainer) {
        bodyContainer.innerHTML = '';
    }
    if (canvasWrap) {
        setAnalyticsVisibility(canvasWrap, false);
    }
}

window.showABResults = showABResults;
window.closeABResultsChart = closeABResultsChart;

// ============================================
// PHASE 1: DATE RANGE & EXPORT
// ============================================

// Global date range state
let globalDateRange = {
    days: 7,
    startDate: null,
    endDate: null
};

// Calendar state
let calendarState = {
    start: { year: 2026, month: 0, selectedDate: null },
    end: { year: 2026, month: 0, selectedDate: null },
    activeCalendar: null
};

// Initialize date range controls with dropdown menu
function initDateRangeControls() {
    const existingRange = getAnalyticsRangeState();
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (existingRange.startDate && existingRange.endDate) {
        syncAnalyticsDateRange(
            existingRange.startDate,
            existingRange.endDate,
            existingRange.days,
            buildAnalyticsRangeLabel(existingRange)
        );
    } else {
        syncAnalyticsDateRange(sevenDaysAgo, today, DEFAULT_ANALYTICS_DAYS, '最近 7 天');
    }

    // Initialize custom date inputs
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');
    if (startInput && endInput) {
        startInput.value = formatDateForInput(sevenDaysAgo);
        endInput.value = formatDateForInput(today);
    }

    if (!analyticsRuntime.outsideClickBound) {
        document.addEventListener('click', function (e) {
            const dropdown = document.getElementById('dateRangeDropdown');
            if (dropdown && !e.target.closest('.date-range-dropdown') && !e.target.closest('.inline-calendar')) {
                dropdown.classList.remove('open');
            }
        });
        analyticsRuntime.outsideClickBound = true;
    }
}

// Toggle date range dropdown
function toggleDateRangeDropdown() {
    const dropdown = document.getElementById('dateRangeDropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

// Select preset range
function selectPresetRange(days) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);

    // Update label
    const labels = { 7: '最近 7 天', 30: '最近 30 天', 90: '最近 90 天', 365: '最近 1 年' };
    syncAnalyticsDateRange(start, end, days, labels[days] || `最近 ${days} 天`);

    // Update active state
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.range) === days);
    });

    // Update custom inputs
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');
    if (startInput && endInput) {
        startInput.value = formatDateForInput(start);
        endInput.value = formatDateForInput(end);
    }

    // Close dropdown
    document.getElementById('dateRangeDropdown')?.classList.remove('open');

    // Refresh charts
    refreshChartsWithDateRange(days);
}

// Apply custom date range
function applyCustomRange() {
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');

    if (!startInput || !endInput || !startInput.value || !endInput.value) {
        showToast('请选择开始和结束日期', 'error');
        return;
    }

    const start = new Date(startInput.value);
    const end = new Date(endInput.value);

    if (start > end) {
        showToast('开始日期不能晚于结束日期', 'error');
        return;
    }

    // Calculate days difference
    const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    syncAnalyticsDateRange(start, end, days);

    // Clear preset active states
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    // Close dropdown
    document.getElementById('dateRangeDropdown')?.classList.remove('open');

    // Refresh charts
    refreshChartsWithDateRange(days);
}

// Format date for input value (YYYY-MM-DD)
function formatDateForInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ============================================
// INLINE CALENDAR COMPONENT
// ============================================

let inlineCalendarState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    startDate: null,
    endDate: null,
    selectingEnd: false
};

// Initialize inline calendar when dropdown opens
function initInlineCalendar() {
    const today = normalizeAnalyticsDate(new Date());
    const { days, startDate, endDate } = getAnalyticsRangeState();
    const normalizedEnd = normalizeAnalyticsDate(endDate) || today;
    const normalizedStart = normalizeAnalyticsDate(startDate) || (() => {
        const fallbackStart = new Date(normalizedEnd);
        fallbackStart.setDate(fallbackStart.getDate() - days);
        return fallbackStart;
    })();

    inlineCalendarState.year = normalizedEnd.getFullYear();
    inlineCalendarState.month = normalizedEnd.getMonth();
    inlineCalendarState.startDate = normalizedStart;
    inlineCalendarState.endDate = normalizedEnd;
    inlineCalendarState.selectingEnd = false;

    renderInlineCalendar();
    updateCustomDateDisplays();

    // Show calendar
    document.getElementById('inlineCalendar')?.classList.add('visible');
}

// Render inline calendar
function renderInlineCalendar() {
    const { year, month, startDate, endDate } = inlineCalendarState;
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月',
        '七月', '八月', '九月', '十月', '十一月', '十二月'];

    // Update title
    const title = document.getElementById('calendarTitle');
    if (title) title.textContent = `${monthNames[month]} ${year}`;

    // Calculate days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    // Previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    let html = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Previous month padding
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthLastDay - i;
        html += `<div class="cal-day other-month" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month - 1}" data-analytics-day="${day}">${day}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);

        let classes = ['cal-day'];

        // Today
        if (date.getTime() === today.getTime()) {
            classes.push('today');
        }

        // Range highlighting
        if (startDate && endDate) {
            const start = new Date(startDate); start.setHours(0, 0, 0, 0);
            const end = new Date(endDate); end.setHours(0, 0, 0, 0);

            if (date.getTime() === start.getTime()) {
                classes.push('range-start');
            } else if (date.getTime() === end.getTime()) {
                classes.push('range-end');
            } else if (date > start && date < end) {
                classes.push('in-range');
            }
        } else if (startDate) {
            const start = new Date(startDate); start.setHours(0, 0, 0, 0);
            if (date.getTime() === start.getTime()) {
                classes.push('selected');
            }
        }

        html += `<div class="${classes.join(' ')}" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month}" data-analytics-day="${day}">${day}</div>`;
    }

    // Next month padding
    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        html += `<div class="cal-day other-month" data-admin-action="analytics-inline-select-date" data-analytics-year="${year}" data-analytics-month="${month + 1}" data-analytics-day="${i}">${i}</div>`;
    }

    const container = document.getElementById('calendarDays');
    if (container) container.innerHTML = html;
}

// Select date in inline calendar
function selectInlineDate(year, month, day, event) {
    // Prevent event bubbling to avoid closing dropdown
    if (event) event.stopPropagation();

    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    if (!inlineCalendarState.selectingEnd || !inlineCalendarState.startDate) {
        // First selection: set start date
        inlineCalendarState.startDate = date;
        inlineCalendarState.endDate = null;
        inlineCalendarState.selectingEnd = true;
    } else {
        // Second selection: set end date
        if (date < inlineCalendarState.startDate) {
            // Swap if end is before start
            inlineCalendarState.endDate = inlineCalendarState.startDate;
            inlineCalendarState.startDate = date;
        } else {
            inlineCalendarState.endDate = date;
        }
        inlineCalendarState.selectingEnd = false;
    }

    // Update view
    inlineCalendarState.year = year;
    inlineCalendarState.month = month;

    renderInlineCalendar();
    updateCustomDateDisplays();
}

// Update display values
function updateCustomDateDisplays() {
    const { startDate, endDate, selectingEnd } = inlineCalendarState;

    const startEl = document.getElementById('customStartDisplay');
    const endEl = document.getElementById('customEndDisplay');
    const hintEl = document.getElementById('calendarHint');

    if (startEl) {
        startEl.textContent = startDate
            ? `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}`
            : '选择开始日期';
    }

    if (endEl) {
        endEl.textContent = endDate
            ? `${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()}`
            : '选择结束日期';
    }

    // Update hint
    if (hintEl) {
        if (!startDate) {
            hintEl.textContent = '选择开始日期';
        } else if (selectingEnd) {
            hintEl.textContent = '选择结束日期';
        } else {
            hintEl.textContent = `${startDate.getMonth() + 1}/${startDate.getDate()} — ${endDate.getMonth() + 1}/${endDate.getDate()}`;
        }
    }
}

// Change month
function changeInlineMonth(delta) {
    inlineCalendarState.month += delta;

    if (inlineCalendarState.month > 11) {
        inlineCalendarState.month = 0;
        inlineCalendarState.year++;
    } else if (inlineCalendarState.month < 0) {
        inlineCalendarState.month = 11;
        inlineCalendarState.year--;
    }

    renderInlineCalendar();
}

// Reset calendar
function resetInlineCalendar() {
    inlineCalendarState.startDate = null;
    inlineCalendarState.endDate = null;
    inlineCalendarState.selectingEnd = false;
    renderInlineCalendar();
    updateCustomDateDisplays();
}

// Set to today
function setInlineToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    inlineCalendarState.year = today.getFullYear();
    inlineCalendarState.month = today.getMonth();
    inlineCalendarState.endDate = today;

    if (!inlineCalendarState.startDate || inlineCalendarState.startDate > today) {
        const start = new Date(today);
        start.setDate(start.getDate() - 7);
        inlineCalendarState.startDate = start;
    }

    inlineCalendarState.selectingEnd = false;
    renderInlineCalendar();
    updateCustomDateDisplays();
}

// Override applyCustomRange to use inline calendar
function applyCustomRange() {
    const { startDate, endDate } = inlineCalendarState;

    if (!startDate || !endDate) {
        showToast('请选择开始和结束日期', 'error');
        return;
    }

    // Calculate days difference
    const days = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)));
    syncAnalyticsDateRange(startDate, endDate, days);

    // Clear preset active states
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    // Close dropdown
    document.getElementById('dateRangeDropdown')?.classList.remove('open');

    // Refresh charts
    refreshChartsWithDateRange(days);
}

// Enhanced toggle to init calendar
const originalToggle = toggleDateRangeDropdown;
function toggleDateRangeDropdown() {
    const dropdown = document.getElementById('dateRangeDropdown');
    if (dropdown) {
        const wasOpen = dropdown.classList.contains('open');
        dropdown.classList.toggle('open');

        if (!wasOpen) {
            initInlineCalendar();
        }
    }
}

// Toggle inline calendar visibility
function toggleInlineCalendar(event) {
    if (event) event.stopPropagation();

    const calendar = document.getElementById('inlineCalendar');
    if (calendar) {
        const isVisible = calendar.classList.contains('visible');
        if (!isVisible) {
            // Show calendar and initialize
            calendar.classList.add('visible');
            renderInlineCalendar();
            updateCustomDateDisplays();
        } else {
            calendar.classList.remove('visible');
        }
    }
}

// Export functions
window.toggleDateRangeDropdown = toggleDateRangeDropdown;
window.selectPresetRange = selectPresetRange;
window.applyCustomRange = applyCustomRange;
window.changeInlineMonth = changeInlineMonth;
window.selectInlineDate = selectInlineDate;
window.resetInlineCalendar = resetInlineCalendar;
window.setInlineToday = setInlineToday;
window.toggleInlineCalendar = toggleInlineCalendar;

// Toggle calendar dropdown
function toggleDatePicker(type) {
    const calendarId = type === 'start' ? 'calendarStart' : 'calendarEnd';
    const calendar = document.getElementById(calendarId);

    if (!calendar) return;

    // Close other calendar
    const otherId = type === 'start' ? 'calendarEnd' : 'calendarStart';
    document.getElementById(otherId)?.classList.remove('active');

    // Toggle this calendar
    const isActive = calendar.classList.contains('active');
    if (isActive) {
        calendar.classList.remove('active');
        calendarState.activeCalendar = null;
    } else {
        calendarState.activeCalendar = type;
        renderCalendar(type);
        calendar.classList.add('active');
    }
}

// Close all calendars
function closeAllCalendars() {
    document.querySelectorAll('.calendar-dropdown').forEach(c => c.classList.remove('active'));
    calendarState.activeCalendar = null;
}

// Render calendar - Range selection mode
function renderCalendar(type) {
    const calendar = document.getElementById('calendarStart');
    if (!calendar) return;

    // Use start state for navigation
    const state = calendarState.start;
    const months = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

    const firstDay = new Date(state.year, state.month, 1);
    const lastDay = new Date(state.year, state.month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = calendarState.start.selectedDate;
    const endDate = calendarState.end.selectedDate;

    let daysHtml = '';

    // Previous month days
    const prevMonthDays = new Date(state.year, state.month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        daysHtml += `<div class="calendar-day other-month">${prevMonthDays - i}</div>`;
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
        const thisDate = new Date(state.year, state.month, day);
        thisDate.setHours(0, 0, 0, 0);
        const isToday = thisDate.getTime() === today.getTime();

        const isStart = startDate && thisDate.getTime() === new Date(startDate).setHours(0, 0, 0, 0);
        const isEnd = endDate && thisDate.getTime() === new Date(endDate).setHours(0, 0, 0, 0);
        const inRange = startDate && endDate && thisDate > startDate && thisDate < endDate;

        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isStart) classes += ' range-start';
        if (isEnd) classes += ' range-end';
        if (inRange) classes += ' in-range';

        daysHtml += `<div class="${classes}" data-admin-action="analytics-range-select-date" data-analytics-year="${state.year}" data-analytics-month="${state.month}" data-analytics-day="${day}">${day}</div>`;
    }

    // Next month days
    const totalCells = Math.ceil((startDayOfWeek + daysInMonth) / 7) * 7;
    const nextDays = totalCells - (startDayOfWeek + daysInMonth);
    for (let i = 1; i <= nextDays; i++) {
        daysHtml += `<div class="calendar-day other-month">${i}</div>`;
    }

    // Determine which date is being selected
    const selectionHint = !calendarState.rangeStep || calendarState.rangeStep === 'start'
        ? '选择开始日期'
        : '选择结束日期';

    calendar.innerHTML = `
        <div class="calendar-header">
            <button type="button" data-admin-action="analytics-range-change-month" data-calendar-type="start" data-month-delta="-1"><i class="fas fa-chevron-left"></i></button>
            <span class="month-year">${months[state.month]} ${state.year}</span>
            <button type="button" data-admin-action="analytics-range-change-month" data-calendar-type="start" data-month-delta="1"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div class="calendar-hint">${selectionHint}</div>
        <div class="calendar-weekdays">
            ${weekdays.map(d => `<span>${d}</span>`).join('')}
        </div>
        <div class="calendar-days">
            ${daysHtml}
        </div>
        <div class="calendar-footer">
            <button type="button" data-admin-action="analytics-range-reset">重置</button>
            <button type="button" data-admin-action="analytics-range-apply">确定</button>
        </div>
    `;
}

// Select date in range mode
function selectRangeDate(year, month, day) {
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);

    if (!calendarState.rangeStep || calendarState.rangeStep === 'start') {
        // First click: set start date
        calendarState.start.selectedDate = date;
        calendarState.start.year = year;
        calendarState.start.month = month;
        calendarState.rangeStep = 'end';
    } else {
        // Second click: set end date
        if (date < calendarState.start.selectedDate) {
            // If end is before start, swap
            calendarState.end.selectedDate = calendarState.start.selectedDate;
            calendarState.start.selectedDate = date;
        } else {
            calendarState.end.selectedDate = date;
        }
        calendarState.end.year = date.getFullYear();
        calendarState.end.month = date.getMonth();
        calendarState.rangeStep = 'start';
    }

    updateDateDisplay('start');
    updateDateDisplay('end');
    renderCalendar('start');
}

// Reset date range
function resetDateRange() {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    syncAnalyticsDateRange(sevenDaysAgo, today, DEFAULT_ANALYTICS_DAYS, '最近 7 天');
    calendarState.rangeStep = 'start';

    updateDateDisplay('start');
    updateDateDisplay('end');
    renderCalendar('start');
}

// Apply and close
function applyAndClose() {
    applyDateRange();
    closeAllCalendars();
}

// Expose new functions
window.selectRangeDate = selectRangeDate;
window.resetDateRange = resetDateRange;
window.applyAndClose = applyAndClose;

// Change month
function changeMonth(type, delta) {
    const state = calendarState[type];
    state.month += delta;

    if (state.month > 11) {
        state.month = 0;
        state.year++;
    } else if (state.month < 0) {
        state.month = 11;
        state.year--;
    }

    renderCalendar(type);
}

// Select date
function selectDate(type, year, month, day) {
    const date = new Date(year, month, day);
    calendarState[type].selectedDate = date;
    updateDateDisplay(type);
    closeAllCalendars();
}

// Set to today
function setToday(type) {
    const today = new Date();
    calendarState[type].selectedDate = today;
    calendarState[type].year = today.getFullYear();
    calendarState[type].month = today.getMonth();
    updateDateDisplay(type);
    renderCalendar(type);
}

// Clear date
function clearDate(type) {
    calendarState[type].selectedDate = null;
    updateDateDisplay(type);
}

// Update date display
function updateDateDisplay(type) {
    const displayId = type === 'start' ? 'dateStartDisplay' : 'dateEndDisplay';
    const display = document.getElementById(displayId);
    const date = calendarState[type].selectedDate;

    if (display) {
        if (date) {
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            display.textContent = `${m}/${d}`;
        } else {
            display.textContent = '--/--';
        }
    }
}

// Apply custom date range (updated for custom picker)
function applyDateRange() {
    const startDate = calendarState.start.selectedDate;
    const endDate = calendarState.end.selectedDate;

    if (!startDate || !endDate) {
        alert('请选择开始和结束日期');
        return;
    }

    if (startDate > endDate) {
        alert('开始日期不能晚于结束日期');
        return;
    }

    const days = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)));
    syncAnalyticsDateRange(startDate, endDate, days);

    document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));

    refreshChartsWithDateRange(days);

    if (typeof showToast === 'function') {
        showToast(`已应用 ${days} 天的数据范围`, 'success');
    }
}

// Adjust date by days
function adjustDate(type, days) {
    const state = calendarState[type];
    if (!state.selectedDate) {
        state.selectedDate = new Date();
    }

    const newDate = new Date(state.selectedDate);
    newDate.setDate(newDate.getDate() + days);
    state.selectedDate = newDate;
    state.year = newDate.getFullYear();
    state.month = newDate.getMonth();

    updateDateDisplay(type);

    // Auto apply when using arrows
    const startDate = calendarState.start.selectedDate;
    const endDate = calendarState.end.selectedDate;
    if (startDate && endDate && startDate <= endDate) {
        const daysDiff = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)));
        syncAnalyticsDateRange(startDate, endDate, daysDiff);
        refreshChartsWithDateRange(daysDiff);
    }
}

// Expose calendar functions
window.toggleDatePicker = toggleDatePicker;
window.changeMonth = changeMonth;
window.selectDate = selectDate;
window.setToday = setToday;
window.clearDate = clearDate;
window.adjustDate = adjustDate;
window.applyDateRange = applyDateRange;

// Refresh all charts with new date range
async function refreshChartsWithDateRange(days) {
    console.log(`[Analytics] Refreshing charts for ${days} days`);

    try {
        if (Number.isFinite(Number(days)) && Number(days) > 0) {
            globalDateRange.days = Number(days);
        }
        resetAnalyticsAICache();
        await reloadAnalyticsDashboard({ reason: 'date-range-change' });
    } catch (err) {
        console.error('[Analytics] Error refreshing charts:', err);
    }
}

// Export analytics data
async function exportAnalyticsData(format) {
    console.log(`[Analytics] Exporting data as ${format}`);

    try {
        // Collect all data
        const { days, startDate, endDate } = getAnalyticsRangeState();
        const dateRangeLabel = buildAnalyticsRangeLabel({ days, startDate, endDate });

        // Fetch Phase 1 data
        const sp = getAnalyticsSiteParam();
        const { data: overviewData } = await getAnalyticsSupabaseClient().rpc('get_overview_stats', { p_site: sp });
        const { data: userTrendData } = await getAnalyticsSupabaseClient().rpc('get_user_trend', { p_days: days, p_site: sp });
        const { data: contentTrendData } = await getAnalyticsSupabaseClient().rpc('get_content_trend', { p_days: days, p_site: sp });
        const { data: revenueTrendData } = await getAnalyticsSupabaseClient().rpc('get_revenue_trend', { p_days: days, p_site: sp });
        const channelData = await fetchChannelBreakdownData(days);
        const { data: communityData } = await getAnalyticsSupabaseClient().rpc('get_community_stats', { p_days: days, p_site: sp });
        const topContentData = await fetchTopContentData(100, days);

        // Fetch Phase 2 (Points) data
        const { data: pointsDist } = await getAnalyticsSupabaseClient().rpc('get_points_distribution', { p_site: sp });
        const { data: pointsLead } = await getAnalyticsSupabaseClient().rpc('get_points_leaderboard', { p_limit: 100, p_site: sp });
        const { data: funnelData } = await getAnalyticsSupabaseClient().rpc('get_redemption_funnel', {
            p_site: sp,
            p_days: days
        });
        const [overviewBusinessMix, verifyServiceSummary, growthSummary, operationsHealthSnapshot] = await Promise.allSettled([
            getOverviewBusinessMixSummaryData({ forceRefresh: true }),
            getVerifyServiceSummaryData({ forceRefresh: true }),
            getGrowthSummaryData({ forceRefresh: true }),
            getOperationsHealthSnapshotData({ forceRefresh: true })
        ]).then((results) => results.map((result) => (result.status === 'fulfilled' ? result.value : null)));
        const summaryWindowData = await getAnalyticsSummaryWindowData({ forceRefresh: true });
        const siteComparisonData = await getAnalyticsSiteComparisonData({
            forceRefresh: true,
            summaryWindowData
        }).catch(() => null);
        const commerceEventFunnel = buildCommerceEventFunnelViewData(summaryWindowData);
        const verifyEventFunnel = buildVerifyEventFunnelViewData(summaryWindowData);
        const growthEventFunnel = buildGrowthEventFunnelViewData(summaryWindowData);

        const summaryBundle = {
            overviewBusinessMix,
            verifyServiceSummary,
            growthSummary,
            operationsHealthSnapshot,
            summaryWindowData,
            siteComparisonData
        };
        const businessAnomalyCards = buildAnalyticsBusinessAnomalyCardsData(summaryBundle, 6);

        const actionRecommendations = [
            ...buildAnalyticsRecommendationExportRows('总览', overviewBusinessMix?.recommendations || []),
            ...buildAnalyticsRecommendationExportRows('验证服务', verifyServiceSummary?.recommendations || []),
            ...buildAnalyticsRecommendationExportRows('社区与裂变', growthSummary?.recommendations || [])
        ];
        const businessAnomalies = buildAnalyticsBusinessAnomalyExportRows(businessAnomalyCards);
        const experimentSuggestions = buildAnalyticsExperimentSuggestionExportRows(
            buildAnalyticsExperimentSuggestionsData(summaryBundle, 4)
        );

        // Prepare export data
        const exportData = {
            overview: overviewData,
            overviewBusinessMix,
            verifyServiceSummary,
            growthSummary,
            operationsHealthSnapshot,
            userTrend: userTrendData || [],
            contentTrend: contentTrendData || [],
            revenueTrend: revenueTrendData || [],
            channelBreakdown: channelData || [],
            communityStats: communityData || [],
            topContent: topContentData || [],
            // New data
            pointsDistribution: pointsDist || [],
            pointsLeaderboard: pointsLead || [],
            redemptionFunnel: funnelData || [],
            commerceEventFunnel,
            verifyEventFunnel,
            growthEventFunnel,
            businessAnomalies,
            actionRecommendations,
            experimentSuggestions,

            exportDate: new Date().toISOString(),
            dateRange: days,
            dateRangeLabel,
            startDate,
            endDate
        };

        if (format === 'csv') {
            exportAsCSV(exportData);
        } else if (format === 'excel') {
            exportAsExcel(exportData);
        }

        if (typeof showToast === 'function') {
            showToast(`${format.toUpperCase()} 导出成功！`, 'success');
        }
    } catch (err) {
        console.error('[Analytics] Export error:', err);
        alert('导出失败: ' + err.message);
    }
}

function hasEventChannelBreakdownData(rows = []) {
    return (Array.isArray(rows) ? rows : []).some((row) => (
        row?.event_count !== undefined
        || row?.user_count !== undefined
        || row?.share_rate !== undefined
        || row?.source_kind !== undefined
    ));
}

function hasEventTopContentData(rows = []) {
    return (Array.isArray(rows) ? rows : []).some((row) => (
        row?.view_count !== undefined
        || row?.category !== undefined
    ));
}

// Export as CSV - Comprehensive multi-section export
function exportAsCSV(data) {
    let csv = '';
    const separator = ',';

    // ========================================
    // Section 1: Overview Summary
    // ========================================
    csv += '=== 数据概览 ===\n';
    csv += `导出时间,${data.exportDate}\n`;
    csv += `日期范围,${data.dateRangeLabel || `${data.dateRange} 天`}\n`;
    if (data.overview) {
        csv += `日活用户 (DAU),${data.overview.dau || 0}\n`;
        csv += `月活用户 (MAU),${data.overview.mau || 0}\n`;
        csv += `今日新用户,${data.overview.new_users_today || 0}\n`;
        csv += `本周新用户,${data.overview.new_users_week || 0}\n`;
        csv += `积分流通总量,${data.overview.total_points || 0}\n`;
        csv += `总评论数,${data.overview.total_comments || 0}\n`;
    }
    csv += '\n';

    // ========================================
    // Section 2: Business Mix Summary
    // ========================================
    csv += '=== 经营主线 ===\n';
    csv += '指标,数值,说明\n';
    if (data.overviewBusinessMix?.exportRows?.length > 0) {
        data.overviewBusinessMix.exportRows.forEach((row) => {
            csv += `${row['指标'] || '-'},${row['数值'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 3: Verify Service Summary
    // ========================================
    csv += '=== 验证服务摘要 ===\n';
    csv += '指标,数值\n';
    if (data.verifyServiceSummary?.metrics) {
        csv += `请求总数,${data.verifyServiceSummary.metrics.requestCount || 0}\n`;
        csv += `成功数,${data.verifyServiceSummary.metrics.successCount || 0}\n`;
        csv += `处理中,${data.verifyServiceSummary.metrics.activeCount || 0}\n`;
        csv += `失败/阻塞,${data.verifyServiceSummary.metrics.failedCount || 0}\n`;
        csv += `成功率(%),${data.verifyServiceSummary.metrics.successRate || 0}\n`;
        csv += `积分消耗总计,${data.verifyServiceSummary.metrics.totalPointsCost || 0}\n`;
        csv += `单次成功平均成本,${data.verifyServiceSummary.metrics.avgPointsCostPerSuccess || 0}\n`;
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 4: Verify Focus Tasks
    // ========================================
    csv += '=== 验证关注任务 ===\n';
    csv += '验证单号,用户,站点,状态,时间,摘要\n';
    if (data.verifyServiceSummary?.focusRows?.length > 0) {
        data.verifyServiceSummary.focusRows.forEach((row) => {
            csv += `${row['验证单号'] || '-'},${String(row['用户'] || '').replace(/,/g, '，')},${row['站点'] || '-'},${row['状态'] || '-'},${row['时间'] || '-'},${String(row['摘要'] || '').replace(/,/g, '，')}\n`;
        });
    } else if (data.verifyServiceSummary?.recentRows?.length > 0) {
        data.verifyServiceSummary.recentRows.forEach((row) => {
            csv += `${row['验证单号'] || '-'},${String(row['用户'] || '').replace(/,/g, '，')},${row['站点'] || '-'},${row['状态'] || '-'},${row['时间'] || '-'},${String(row['摘要'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 5: Verify Event Funnel
    // ========================================
    csv += '=== 验证事件转化 ===\n';
    csv += '阶段,用户数,事件数,比率(%),说明\n';
    if (data.verifyEventFunnel?.exportRows?.length > 0) {
        data.verifyEventFunnel.exportRows.forEach((row) => {
            csv += `${row['阶段'] || '-'},${row['用户数'] || 0},${row['事件数'] || 0},${row['比率(%)'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 5: Growth Summary
    // ========================================
    csv += '=== 社区与裂变 ===\n';
    csv += '指标,数值,说明\n';
    if (data.growthSummary?.exportRows?.length > 0) {
        data.growthSummary.exportRows.forEach((row) => {
            csv += `${row['指标'] || '-'},${row['数值'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 6: 增长动作
    // ========================================
    csv += '=== 增长动作 ===\n';
    csv += '动作,用户数,事件数,覆盖率(%),说明\n';
    if (data.growthEventFunnel?.exportRows?.length > 0) {
        data.growthEventFunnel.exportRows.forEach((row) => {
            csv += `${row['动作'] || '-'},${row['用户数'] || 0},${row['事件数'] || 0},${row['覆盖率(%)'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 6: Operations Health
    // ========================================
    csv += '=== 运营健康 ===\n';
    csv += '指标,数值,说明\n';
    if (data.operationsHealthSnapshot?.exportRows?.length > 0) {
        data.operationsHealthSnapshot.exportRows.forEach((row) => {
            csv += `${row['指标'] || '-'},${row['数值'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 7: Business Anomalies
    // ========================================
    csv += '=== 经营异常 ===\n';
    csv += '板块,优先级,标题,核心指标,摘要,建议动作,跳转目标,样本线索\n';
    if (data.businessAnomalies?.length > 0) {
        data.businessAnomalies.forEach((row) => {
            csv += `${row['板块'] || '-'},${row['优先级'] || '-'},${String(row['标题'] || '').replace(/,/g, '，')},${String(row['核心指标'] || '').replace(/,/g, '，')},${String(row['摘要'] || '').replace(/,/g, '，')},${String(row['建议动作'] || '').replace(/,/g, '，')},${row['跳转目标'] || '-'},${String(row['样本线索'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 8: Action Recommendations
    // ========================================
    csv += '=== 建议动作 ===\n';
    csv += '板块,优先级,标题,摘要,建议动作,跳转目标,样本线索\n';
    if (data.actionRecommendations?.length > 0) {
        data.actionRecommendations.forEach((row) => {
            csv += `${row['板块'] || '-'},${row['优先级'] || '-'},${String(row['标题'] || '').replace(/,/g, '，')},${String(row['摘要'] || '').replace(/,/g, '，')},${String(row['建议动作'] || '').replace(/,/g, '，')},${row['跳转目标'] || '-'},${String(row['样本线索'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 9: Experiment Suggestions
    // ========================================
    csv += '=== 实验建议 ===\n';
    csv += '优先级,实验名称,目标站点,实验方向,目标指标,摘要,建议动作,样本线索\n';
    if (data.experimentSuggestions?.length > 0) {
        data.experimentSuggestions.forEach((row) => {
            csv += `${row['优先级'] || '-'},${String(row['实验名称'] || '').replace(/,/g, '，')},${String(row['目标站点'] || '').replace(/,/g, '，')},${String(row['实验方向'] || '').replace(/,/g, '，')},${String(row['目标指标'] || '').replace(/,/g, '，')},${String(row['摘要'] || '').replace(/,/g, '，')},${String(row['建议动作'] || '').replace(/,/g, '，')},${String(row['样本线索'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 10: User Trend (Daily)
    // ========================================
    csv += '=== 用户趋势 ===\n';
    csv += '日期,新用户数,活跃用户数\n';
    if (data.userTrend && data.userTrend.length > 0) {
        data.userTrend.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.new_users || 0},${row.active_users || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 11: Content Trend (Daily)
    // ========================================
    csv += '=== 内容趋势 ===\n';
    csv += '日期,评论数,解锁数,点赞数\n';
    if (data.contentTrend && data.contentTrend.length > 0) {
        data.contentTrend.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.comments || 0},${row.unlocks || 0},${row.likes || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 12: Revenue/Points Trend (Daily)
    // ========================================
    csv += '=== 积分趋势 ===\n';
    csv += '日期,积分收入,积分支出,兑换次数\n';
    if (data.revenueTrend && data.revenueTrend.length > 0) {
        data.revenueTrend.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.points_in || 0},${row.points_out || 0},${row.redemptions || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 13: Community Stats (Daily)
    // ========================================
    csv += '=== 社区互动 ===\n';
    csv += '日期,留言数,评论数,点赞数\n';
    if (data.communityStats && data.communityStats.length > 0) {
        data.communityStats.forEach(row => {
            const dateStr = row.stat_date || row.date || '-';
            csv += `${dateStr},${row.messages || 0},${row.comments || 0},${row.likes || 0}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 14: Channel Breakdown
    // ========================================
    csv += '=== 渠道分析 ===\n';
    const channelUsesEventSchema = hasEventChannelBreakdownData(data.channelBreakdown);
    csv += channelUsesEventSchema
        ? '渠道,事件数,覆盖用户,内容解锁,验证提交,充值成功,商城成交,占比(%),来源类型\n'
        : '渠道,批次数,总码数,已使用,总积分,使用率(%)\n';
    if (data.channelBreakdown && data.channelBreakdown.length > 0) {
        data.channelBreakdown.forEach(row => {
            if (channelUsesEventSchema) {
                csv += `${row.channel || '未分类'},${row.event_count || 0},${row.user_count || 0},${row.unlock_success_count || 0},${row.verify_submit_count || 0},${row.recharge_success_count || 0},${row.shop_purchase_count || 0},${row.share_rate || 0},${row.source_kind || '业务入口'}\n`;
            } else {
                csv += `${row.channel || '未分类'},${row.batch_count || 0},${row.total_codes || 0},${row.used_codes || 0},${row.total_points || 0},${row.redemption_rate || 0}\n`;
            }
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 15: Top Content
    // ========================================
    csv += '=== 热门内容 Top 100 ===\n';
    const topContentUsesEventSchema = hasEventTopContentData(data.topContent);
    csv += topContentUsesEventSchema
        ? '排名,Prompt ID,标题,浏览数,解锁数,评论数,热度分,分类\n'
        : '排名,Prompt ID,标题,解锁数,评论数,热度分\n';
    if (data.topContent && data.topContent.length > 0) {
        data.topContent.forEach((row, index) => {
            // Escape title if it contains comma
            const title = (row.title || '').replace(/,/g, '，');
            if (topContentUsesEventSchema) {
                csv += `${index + 1},${row.prompt_id || '-'},${title},${row.view_count || 0},${row.unlock_count || 0},${row.comment_count || 0},${row.score || 0},${(row.category || '未分类').replace(/,/g, '，')}\n`;
            } else {
                csv += `${index + 1},${row.prompt_id || '-'},${title},${row.unlock_count || 0},${row.comment_count || 0},${row.score || 0}\n`;
            }
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 16: Commerce Event Funnel
    // ========================================
    csv += '=== 交易事件转化 ===\n';
    csv += '阶段,用户数,事件数,比率(%),说明\n';
    if (data.commerceEventFunnel?.exportRows?.length > 0) {
        data.commerceEventFunnel.exportRows.forEach((row) => {
            csv += `${row['阶段'] || '-'},${row['用户数'] || 0},${row['事件数'] || 0},${row['比率(%)'] || 0},${String(row['说明'] || '').replace(/,/g, '，')}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 17: Points Distribution
    // ========================================
    csv += '=== 积分分布 ===\n';
    csv += '持有区间,用户数\n';
    if (data.pointsDistribution && data.pointsDistribution.length > 0) {
        data.pointsDistribution.forEach(row => {
            csv += `${row.range_label},${row.user_count}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 18: Points Leaderboard
    // ========================================
    csv += '=== 积分富豪榜 ===\n';
    csv += '排名,用户名,余额,总消费\n';
    if (data.pointsLeaderboard && data.pointsLeaderboard.length > 0) {
        data.pointsLeaderboard.forEach((row, index) => {
            csv += `${index + 1},${row.username || '匿名'},${row.balance},${row.total_spent}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }
    csv += '\n';

    // ========================================
    // Section 19: Redemption Funnel
    // ========================================
    csv += '=== 兑换漏斗 ===\n';
    csv += '步骤,数量,转化率(%)\n';
    if (data.redemptionFunnel && data.redemptionFunnel.length > 0) {
        data.redemptionFunnel.forEach(row => {
            csv += `${row.step},${row.count},${row.conversion_rate}\n`;
        });
    } else {
        csv += '暂无数据\n';
    }

    // Download
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `analytics_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// Export as Excel using SheetJS
function exportAsExcel(data) {
    if (typeof XLSX === 'undefined') {
        alert('Excel 导出组件未加载，请刷新页面重试');
        return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Overview
    const overviewSheet = XLSX.utils.json_to_sheet([{
        '导出时间': data.exportDate,
        '日期范围': data.dateRangeLabel || `${data.dateRange} 天`,
        'DAU': data.overview?.dau || 0,
        'MAU': data.overview?.mau || 0,
        '今日新用户': data.overview?.new_users_today || 0,
        '本周新用户': data.overview?.new_users_week || 0,
        '积分流通总量': data.overview?.total_points || 0,
        '总评论数': data.overview?.total_comments || 0
    }]);
    XLSX.utils.book_append_sheet(wb, overviewSheet, '概览');

    // Sheet 2: Business Mix
    if (data.overviewBusinessMix?.exportRows?.length > 0) {
        const mixSheet = XLSX.utils.json_to_sheet(data.overviewBusinessMix.exportRows);
        XLSX.utils.book_append_sheet(wb, mixSheet, '经营主线');
    }

    // Sheet 3: Verify Summary
    if (data.verifyServiceSummary?.metrics) {
        const verifySummarySheet = XLSX.utils.json_to_sheet([{
            '请求总数': data.verifyServiceSummary.metrics.requestCount || 0,
            '成功数': data.verifyServiceSummary.metrics.successCount || 0,
            '处理中': data.verifyServiceSummary.metrics.activeCount || 0,
            '失败/阻塞': data.verifyServiceSummary.metrics.failedCount || 0,
            '其他状态': data.verifyServiceSummary.metrics.otherCount || 0,
            '成功率(%)': data.verifyServiceSummary.metrics.successRate || 0,
            '积分消耗总计': data.verifyServiceSummary.metrics.totalPointsCost || 0,
            '单次成功平均成本': data.verifyServiceSummary.metrics.avgPointsCostPerSuccess || 0
        }]);
        XLSX.utils.book_append_sheet(wb, verifySummarySheet, '验证摘要');
    }

    // Sheet 4: Verify Focus
    if (data.verifyServiceSummary?.focusRows?.length > 0 || data.verifyServiceSummary?.recentRows?.length > 0) {
        const verifyFocusRows = data.verifyServiceSummary.focusRows?.length > 0
            ? data.verifyServiceSummary.focusRows
            : data.verifyServiceSummary.recentRows;
        const verifyFocusSheet = XLSX.utils.json_to_sheet(verifyFocusRows);
        XLSX.utils.book_append_sheet(wb, verifyFocusSheet, '验证关注');
    }

    // Sheet 5: Verify Event Funnel
    if (data.verifyEventFunnel?.exportRows?.length > 0) {
        const verifyEventSheet = XLSX.utils.json_to_sheet(data.verifyEventFunnel.exportRows);
        XLSX.utils.book_append_sheet(wb, verifyEventSheet, '验证转化');
    }

    // Sheet 6: Growth Summary
    if (data.growthSummary?.exportRows?.length > 0) {
        const growthSheet = XLSX.utils.json_to_sheet(data.growthSummary.exportRows);
        XLSX.utils.book_append_sheet(wb, growthSheet, '社区裂变');
    }

    // Sheet 7: Growth Event Funnel
    if (data.growthEventFunnel?.exportRows?.length > 0) {
        const growthEventSheet = XLSX.utils.json_to_sheet(data.growthEventFunnel.exportRows);
        XLSX.utils.book_append_sheet(wb, growthEventSheet, '增长动作');
    }

    // Sheet 8: Operations Health
    if (data.operationsHealthSnapshot?.exportRows?.length > 0) {
        const operationsSheet = XLSX.utils.json_to_sheet(data.operationsHealthSnapshot.exportRows);
        XLSX.utils.book_append_sheet(wb, operationsSheet, '运营健康');
    }

    // Sheet 9: Business Anomalies
    if (data.businessAnomalies?.length > 0) {
        const anomalySheet = XLSX.utils.json_to_sheet(data.businessAnomalies);
        XLSX.utils.book_append_sheet(wb, anomalySheet, '经营异常');
    }

    // Sheet 10: Recommendations
    if (data.actionRecommendations?.length > 0) {
        const recommendationSheet = XLSX.utils.json_to_sheet(data.actionRecommendations);
        XLSX.utils.book_append_sheet(wb, recommendationSheet, '建议动作');
    }

    // Sheet 11: Experiment Suggestions
    if (data.experimentSuggestions?.length > 0) {
        const experimentSheet = XLSX.utils.json_to_sheet(data.experimentSuggestions);
        XLSX.utils.book_append_sheet(wb, experimentSheet, '实验建议');
    }

    // Sheet 12: User Trend
    if (data.userTrend && data.userTrend.length > 0) {
        const trendSheet = XLSX.utils.json_to_sheet(data.userTrend.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '新用户': row.new_users || 0,
            '活跃用户': row.active_users || 0
        })));
        XLSX.utils.book_append_sheet(wb, trendSheet, '用户趋势');
    }

    // Sheet 13: Content Trend
    if (data.contentTrend && data.contentTrend.length > 0) {
        const contentSheet = XLSX.utils.json_to_sheet(data.contentTrend.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '评论数': row.comments || 0,
            '解锁数': row.unlocks || 0,
            '点赞数': row.likes || 0
        })));
        XLSX.utils.book_append_sheet(wb, contentSheet, '内容趋势');
    }

    // Sheet 14: Revenue/Points Trend
    if (data.revenueTrend && data.revenueTrend.length > 0) {
        const revenueSheet = XLSX.utils.json_to_sheet(data.revenueTrend.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '积分收入': row.points_in || 0,
            '积分支出': row.points_out || 0,
            '兑换次数': row.redemptions || 0
        })));
        XLSX.utils.book_append_sheet(wb, revenueSheet, '积分趋势');
    }

    // Sheet 15: Community Stats
    if (data.communityStats && data.communityStats.length > 0) {
        const communitySheet = XLSX.utils.json_to_sheet(data.communityStats.map(row => ({
            '日期': row.stat_date || row.date || '-',
            '留言数': row.messages || 0,
            '评论数': row.comments || 0,
            '点赞数': row.likes || 0
        })));
        XLSX.utils.book_append_sheet(wb, communitySheet, '社区互动');
    }

    // Sheet 16: Channel Breakdown
    if (data.channelBreakdown && data.channelBreakdown.length > 0) {
        const channelSheet = XLSX.utils.json_to_sheet(data.channelBreakdown.map(row => (
            hasEventChannelBreakdownData(data.channelBreakdown)
                ? {
                    '渠道': row.channel || '未分类',
                    '事件数': row.event_count || 0,
                    '覆盖用户': row.user_count || 0,
                    '内容解锁': row.unlock_success_count || 0,
                    '验证提交': row.verify_submit_count || 0,
                    '充值成功': row.recharge_success_count || 0,
                    '商城成交': row.shop_purchase_count || 0,
                    '占比(%)': row.share_rate || 0,
                    '来源类型': row.source_kind || '业务入口'
                }
                : {
                    '渠道': row.channel || '未分类',
                    '批次数': row.batch_count || 0,
                    '总码数': row.total_codes || 0,
                    '已使用': row.used_codes || 0,
                    '总积分': row.total_points || 0,
                    '使用率(%)': row.redemption_rate || 0
                }
        )));
        XLSX.utils.book_append_sheet(wb, channelSheet, '渠道分析');
    }

    // Sheet 17: Top Content
    if (data.topContent && data.topContent.length > 0) {
        const topSheet = XLSX.utils.json_to_sheet(data.topContent.map((row, index) => (
            hasEventTopContentData(data.topContent)
                ? {
                    '排名': index + 1,
                    'Prompt ID': row.prompt_id || '-',
                    '标题': row.title || '',
                    '浏览数': row.view_count || 0,
                    '解锁数': row.unlock_count || 0,
                    '评论数': row.comment_count || 0,
                    '热度分': row.score || 0,
                    '分类': row.category || '未分类'
                }
                : {
                    '排名': index + 1,
                    'Prompt ID': row.prompt_id || '-',
                    '标题': row.title || '',
                    '解锁数': row.unlock_count || 0,
                    '评论数': row.comment_count || 0,
                    '热度分': row.score || 0
                }
        )));
        XLSX.utils.book_append_sheet(wb, topSheet, '热门内容');
    }

    // Sheet 18: Commerce Event Funnel
    if (data.commerceEventFunnel?.exportRows?.length > 0) {
        const commerceEventSheet = XLSX.utils.json_to_sheet(data.commerceEventFunnel.exportRows);
        XLSX.utils.book_append_sheet(wb, commerceEventSheet, '交易事件');
    }

    // Sheet 19: Points Distribution
    if (data.pointsDistribution && data.pointsDistribution.length > 0) {
        const distSheet = XLSX.utils.json_to_sheet(data.pointsDistribution.map(row => ({
            '持有区间': row.range_label,
            '用户数': row.user_count
        })));
        XLSX.utils.book_append_sheet(wb, distSheet, '积分分布');
    }

    // Sheet 20: Points Leaderboard
    if (data.pointsLeaderboard && data.pointsLeaderboard.length > 0) {
        const leadSheet = XLSX.utils.json_to_sheet(data.pointsLeaderboard.map((row, index) => ({
            '排名': index + 1,
            '用户名': row.username || '匿名',
            '积分余额': row.balance,
            '总消费': row.total_spent
        })));
        XLSX.utils.book_append_sheet(wb, leadSheet, '积分富豪榜');
    }

    // Sheet 21: Redemption Funnel
    if (data.redemptionFunnel && data.redemptionFunnel.length > 0) {
        const funnelSheet = XLSX.utils.json_to_sheet(data.redemptionFunnel.map(row => ({
            '步骤': row.step,
            '数量': row.count,
            '转化率(%)': row.conversion_rate
        })));
        XLSX.utils.book_append_sheet(wb, funnelSheet, '兑换漏斗');
    }

    // Download
    XLSX.writeFile(wb, `analytics_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', function () {
    const initAnalyticsBoot = () => {
        // Delay to ensure DOM is ready
        setTimeout(initDateRangeControls, 500);
        setTimeout(initRealtimeFeatures, 1000);
    };

    if (window.adminStudioAccessGranted) {
        initAnalyticsBoot();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initAnalyticsBoot, { once: true });
});

// Expose to window
window.applyDateRange = applyDateRange;
window.exportAnalyticsData = exportAnalyticsData;

// ============================================
// PHASE 3: REALTIME FEATURES
// ============================================

let autoRefreshInterval = null;
let currentRefreshIntervalMs = 300000; // Default 5 minutes

// Initialize realtime features
function initRealtimeFeatures() {
    // Load saved interval from localStorage
    const savedInterval = localStorage.getItem('analyticsAutoRefreshInterval');
    if (savedInterval) {
        currentRefreshIntervalMs = parseInt(savedInterval);
        const selectEl = document.getElementById('autoRefreshInterval');
        if (selectEl) selectEl.value = savedInterval;
    }

    // Auto refresh toggle
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle) {
        toggle.addEventListener('change', function () {
            if (this.checked) {
                startAutoRefresh();
            } else {
                stopAutoRefresh();
            }
        });

        ensureAnalyticsAutoRefreshState();
    }

    // Initial online users update
    updateOnlineUsers();

    // Update timestamp
    updateLastUpdateTime();
}

// Update auto refresh interval from settings
function updateAutoRefreshInterval(ms) {
    currentRefreshIntervalMs = parseInt(ms);
    localStorage.setItem('analyticsAutoRefreshInterval', ms);

    // Restart auto refresh with new interval if active
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle && toggle.checked) {
        stopAutoRefresh();
        startAutoRefresh();
    }

    // Update tooltip
    const intervalText = {
        60000: '1分钟',
        180000: '3分钟',
        300000: '5分钟',
        600000: '10分钟',
        900000: '15分钟',
        1800000: '30分钟'
    }[ms] || '5分钟';

    const toggleContainer = document.querySelector('.auto-refresh-toggle');
    if (toggleContainer) {
        toggleContainer.title = `自动刷新 (${intervalText})`;
    }

    showToast(`自动刷新间隔已更新为 ${intervalText}`, 'success');
}

// Start auto refresh
function startAutoRefresh() {
    if (autoRefreshInterval || !isAnalyticsModuleVisible()) return;

    autoRefreshInterval = setInterval(() => {
        refreshAllAnalytics({ silent: true, reason: 'auto-refresh' });
    }, currentRefreshIntervalMs);

    console.log(`[Analytics] Auto refresh started (${currentRefreshIntervalMs / 1000}s interval)`);
}

// Stop auto refresh
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    console.log('[Analytics] Auto refresh stopped');
}

// Toggle custom dropdown
function toggleCustomDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
        // Close all other dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(d => {
            if (d.id !== dropdownId) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    }
}

// Select dropdown option
function selectDropdownOption(dropdownId, value, label) {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
        // Update display value
        const valueEl = dropdown.querySelector('.dropdown-value');
        if (valueEl) valueEl.textContent = label;

        // Update selected state
        dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });

        // Close dropdown
        dropdown.classList.remove('open');

        // Trigger the update based on dropdown type
        if (dropdownId === 'refreshIntervalDropdown') {
            updateAutoRefreshInterval(value);
        } else if (dropdownId === 'lockoutDurationDropdown') {
            // 🔒 保存锁定时长设置
            saveSecurityDropdownSetting('lockout_duration', parseInt(value));
        } else if (dropdownId === 'sessionTimeoutDropdown') {
            // 🔒 保存会话超时设置
            saveSecurityDropdownSetting('session_timeout', parseInt(value));
        }
    }
}

// 🔒 Save security dropdown settings
async function saveSecurityDropdownSetting(key, value) {
    try {
        // Get current security config from system_config table
        const { data: currentData } = await supabaseClient
            .from('system_config')
            .select('value')
            .eq('key', 'security')
            .single();

        const config = currentData?.value || {
            login_lockout_attempts: 5,
            lockout_duration: 900000,
            session_timeout: 3600000
        };

        // Update the specific key
        config[key] = value;

        // Save back using RPC (admin-config.js saveConfig pattern)
        const { error } = await getAnalyticsSupabaseClient().rpc('update_system_config', {
            p_key: 'security',
            p_value: config
        });

        if (error) throw error;

        console.log(`✅ 安全设置已保存: ${key} = ${value}`);

        if (typeof showToast === 'function') {
            showToast('设置已保存', 'success');
        }
    } catch (err) {
        console.error('保存安全设置失败:', err);
        if (typeof showToast === 'function') {
            showToast('保存失败: ' + err.message, 'error');
        }
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function (e) {
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
    }
});

// Export
window.updateAutoRefreshInterval = updateAutoRefreshInterval;
window.toggleCustomDropdown = toggleCustomDropdown;
window.selectDropdownOption = selectDropdownOption;

// Refresh all analytics data
async function refreshAllAnalytics(options = {}) {
    console.log('[Analytics] Refreshing all data...');
    const { silent = false, reason = 'manual-refresh' } = options;

    if (!isAnalyticsModuleVisible()) {
        stopAutoRefresh();
        return;
    }

    // Add spinning animation to all refresh buttons
    const refreshBtns = document.querySelectorAll('.toolbar-icon-btn i.fa-sync-alt, .btn-icon-sm i.fa-redo');
    refreshBtns.forEach(btn => btn.classList.add('fa-spin'));

    try {
        if (reason !== 'auto-refresh') {
            resetAnalyticsAICache();
        }

        await reloadAnalyticsDashboard({
            reason,
            includeExperiments: shouldLoadAnalyticsAdvancedTools()
        });

        // Show success feedback
        if (!silent && typeof showToast === 'function') {
            showToast('数据已刷新', 'success');
        }

    } catch (err) {
        console.error('[Analytics] Refresh error:', err);
        if (!silent && typeof showToast === 'function') {
            showToast('刷新失败', 'error');
        }
    } finally {
        // Remove spinning animation
        setTimeout(() => {
            refreshBtns.forEach(btn => btn.classList.remove('fa-spin'));
        }, 500);
    }
}

// Update online users count (users active in last 5 minutes)
async function updateOnlineUsers() {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const countEl = document.getElementById('onlineUsersCount');

        if (!countEl) return;

        const uniqueUsers = new Set();

        // 1. Query comments for recent activity
        try {
            let commentsQuery = supabaseClient
                .from('prompt_comments')
                .select('user_id')
                .gte('created_at', fiveMinutesAgo);
            commentsQuery = window.AdminSiteFilter?.applySiteFilter(commentsQuery) || commentsQuery;
            const { data: comments } = await commentsQuery;

            if (comments) {
                comments.forEach(c => c.user_id && uniqueUsers.add(c.user_id));
            }
        } catch (e) {
            console.warn('[Analytics] Comments query failed');
        }

        // 2. Query comment_likes for recent activity
        try {
            let likesQuery = supabaseClient
                .from('comment_likes')
                .select('user_id')
                .gte('created_at', fiveMinutesAgo);
            likesQuery = window.AdminSiteFilter?.applySiteFilter(likesQuery) || likesQuery;
            const { data: likes } = await likesQuery;

            if (likes) {
                likes.forEach(l => l.user_id && uniqueUsers.add(l.user_id));
            }
        } catch (e) {
            console.warn('[Analytics] Likes query failed');
        }

        // 3. Query user_events for page views (if table exists)
        try {
            let eventsQuery = supabaseClient
                .from('user_events')
                .select('user_id')
                .gte('created_at', fiveMinutesAgo);
            eventsQuery = window.AdminSiteFilter?.applySiteFilter(eventsQuery) || eventsQuery;
            const { data: events } = await eventsQuery;

            if (events) {
                events.forEach(ev => ev.user_id && uniqueUsers.add(ev.user_id));
            }
        } catch (e) {
            // user_events table may not exist, ignore
        }

        // 4. Fallback: check profiles updated_at
        if (uniqueUsers.size === 0) {
            try {
                const { count: profileCount } = await supabaseClient
                    .from('profiles')
                    .select('*', { count: 'exact', head: true })
                    .gte('updated_at', fiveMinutesAgo);

                if (profileCount) {
                    countEl.textContent = profileCount;
                    return;
                }
            } catch (e2) { }
        }

        countEl.textContent = uniqueUsers.size;

    } catch (err) {
        console.warn('[Analytics] Online users error:', err.message);
        const countEl = document.getElementById('onlineUsersCount');
        if (countEl) countEl.textContent = '0';
    }
}

// Update last update time
function updateLastUpdateTime() {
    const el = document.getElementById('lastUpdateTime');
    const timeLabel = getAnalyticsRefreshTimeLabel();
    if (el) {
        el.textContent = timeLabel;
    }
    updateAnalyticsPanelNotes(timeLabel);
}

// View prompt context - jump to Gallery page with prompt highlighted
function viewPromptContext(promptId) {
    if (!promptId) return;
    // Open Gallery page with prompt ID in URL hash
    window.open(`prompts.html#prompt-${promptId}`, '_blank');
}

// Expose to window
window.refreshAllAnalytics = refreshAllAnalytics;
window.viewPromptContext = viewPromptContext;

// ============================================
// PHASE 4: ANOMALY DETECTION
// ============================================

// Store previous values for comparison
let previousValues = {
    dau: null,
    comments: null,
    points: null
};

// Check for anomalies after data refresh
async function checkForAnomalies() {
    const alerts = [];

    try {
        // Get current values
        const dauEl = document.getElementById('kpiDauValue');
        const commentsEl = document.getElementById('kpiCommentsValue');

        const currentDau = dauEl ? parseInt(dauEl.textContent) || 0 : 0;
        const currentComments = commentsEl ? parseInt(commentsEl.textContent) || 0 : 0;

        // Check DAU anomaly (drop > 50%)
        if (previousValues.dau !== null && previousValues.dau > 0) {
            const dauChange = ((currentDau - previousValues.dau) / previousValues.dau) * 100;
            if (dauChange < -50) {
                alerts.push({
                    type: 'dau_drop',
                    text: 'DAU 异常下降',
                    value: `${dauChange.toFixed(0)}%`
                });
            }
        }

        // Check for zero activity
        if (currentDau === 0 && previousValues.dau > 5) {
            alerts.push({
                type: 'zero_dau',
                text: 'DAU 降为 0',
                value: '需要关注'
            });
        }

        // Store for next comparison
        previousValues.dau = currentDau;
        previousValues.comments = currentComments;

        // Display alerts
        displayAlerts(alerts);

    } catch (err) {
        console.error('[Anomaly] Detection error:', err);
    }
}

// Display alerts in UI
function displayAlerts(alerts) {
    const area = document.getElementById('anomalyAlertsArea');
    const list = document.getElementById('alertsList');

    if (!area || !list) return;

    if (alerts.length === 0) {
        setAnalyticsVisibility(area, true);
        return;
    }

    setAnalyticsVisibility(area, false);
    list.innerHTML = alerts.map(alert => `
        <div class="alert-item">
            <i class="fas fa-exclamation-circle"></i>
            <span class="alert-text">${alert.text}</span>
            <span class="alert-value">${alert.value}</span>
        </div>
    `).join('');
}

// Dismiss all alerts
function dismissAllAlerts() {
    const area = document.getElementById('anomalyAlertsArea');
    if (area) {
        setAnalyticsVisibility(area, true);
    }
}

// Hook into refresh cycle
const originalRefresh = refreshAllAnalytics;
refreshAllAnalytics = async function (...args) {
    await originalRefresh(...args);
    // Check for anomalies after refresh
    setTimeout(checkForAnomalies, 500);
};

window.refreshAllAnalytics = refreshAllAnalytics;
window.dismissAllAlerts = dismissAllAlerts;
