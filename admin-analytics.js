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
let productTrendChart = null;
let activeAnalyticsProductId = '';
let activeAnalyticsProductName = '';
let analyticsProductDetailRequestId = 0;
let analyticsUserTrendRequestId = 0;
let analyticsGrowthSummaryRequestId = 0;
let analyticsDestinationFocusTimeoutId = 0;
const DEFAULT_ANALYTICS_DAYS = 7;
const ANALYTICS_DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_REENTRY_REFRESH_TTL_MS = 15000;
const ANALYTICS_ADVANCED_WORKSPACE_STORAGE_KEY = 'analyticsAdvancedWorkspaceOpen';
const ANALYTICS_ADVANCED_TOGGLE_BINDING_FLAG = 'analyticsAdvancedToggleBound';
const ANALYTICS_PANEL_SUPPORT_TOP_CONTENT_LIMIT = 100;
const ANALYTICS_PANEL_SUPPORT_POINTS_LEADERBOARD_LIMIT = 100;
let pendingAnalyticsAdminSessionPromise = null;

const analyticsRuntime = {
    initialized: false,
    moduleActive: false,
    eventsBound: false,
    realtimeBound: false,
    realtimeChannels: [],
    outsideClickBound: false,
    focusScrollSyncQueued: false,
    reloadPromise: null,
    reloadRequestId: 0,
    reloadContextKey: '',
    reloadTabId: '',
    refreshIndicatorBusyCount: 0,
    refreshIndicatorActive: false,
    loadedTabsByContext: {},
    lastLoadedAt: 0,
    lastLoadedContextKey: '',
    lastReloadReason: ''
};

function getAnalyticsGlobalDateRangeState() {
    if (!globalThis.__analyticsGlobalDateRangeState || typeof globalThis.__analyticsGlobalDateRangeState !== 'object') {
        globalThis.__analyticsGlobalDateRangeState = {
            days: DEFAULT_ANALYTICS_DAYS,
            startDate: null,
            endDate: null
        };
    }

    return globalThis.__analyticsGlobalDateRangeState;
}

function getAnalyticsCalendarRuntimeState() {
    if (!globalThis.__analyticsCalendarRuntimeState || typeof globalThis.__analyticsCalendarRuntimeState !== 'object') {
        const today = normalizeAnalyticsDate(new Date()) || new Date();
        globalThis.__analyticsCalendarRuntimeState = {
            start: { year: today.getFullYear(), month: today.getMonth(), selectedDate: null },
            end: { year: today.getFullYear(), month: today.getMonth(), selectedDate: null },
            activeCalendar: null,
            rangeStep: 'start'
        };
    }

    return globalThis.__analyticsCalendarRuntimeState;
}

function getAnalyticsInlineCalendarRuntimeState() {
    if (!globalThis.__analyticsInlineCalendarRuntimeState || typeof globalThis.__analyticsInlineCalendarRuntimeState !== 'object') {
        const today = normalizeAnalyticsDate(new Date()) || new Date();
        globalThis.__analyticsInlineCalendarRuntimeState = {
            year: today.getFullYear(),
            month: today.getMonth(),
            startDate: null,
            endDate: null,
            selectingEnd: false
        };
    }

    return globalThis.__analyticsInlineCalendarRuntimeState;
}

const ANALYTICS_PANEL_NOTE_DEFINITIONS = {
    overviewDutyBoardMeta: { basis: '规则待处理' },
    userTrendMeta: { basis: '真实业务活跃优先' },
    channelBreakdownMeta: { basis: '真实事件优先' },
    overviewBusinessMixMeta: { basis: '真实事件优先' },
    productAlertsMeta: { basis: '库存 / 履约 / 转化预警' },
    productOverviewMeta: { basis: '成交 / 浏览 / 站点对比' },
    productRankingsMeta: { basis: '销量 / 收入 / 转化 / 风险榜' },
    productFunnelMeta: { basis: '详情到支付 / 发货漏斗' },
    productHealthMeta: { basis: '库存 / 售后 / 履约风险' },
    productDetailMeta: { basis: '点击商品打开单品详情' },
    topContentMeta: { basis: '浏览/解锁/评论混合口径' },
    contentOperatingCockpitMeta: { basis: '内容级经营判断 / 复查 / 建议动作' },
    contentCommerceDetailMeta: { basis: '点击带货内容展开详情' },
    userValueCockpitStandaloneMeta: { basis: '首单 / 复购 / 跨商品 / 风险复查' },
    activityHeatmapMeta: { basis: '真实业务事件热度' },
    conversionFunnelMeta: { basis: '真实业务事件漏斗' },
    retentionCohortMeta: { basis: '真实业务回访留存' },
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

function formatAnalyticsLocalDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function toAnalyticsIsoDate(value) {
    const date = normalizeAnalyticsDate(value);
    return formatAnalyticsLocalDate(date);
}

function isAnalyticsModuleVisible() {
    const activeModule = document.querySelector('.module-container.active');
    if (!activeModule) {
        return false;
    }

    const activeModuleId = String(activeModule.id || '').replace(/^module-/, '').trim().toLowerCase();
    return ['analytics', 'business-overview', 'growth-center', 'commerce-center'].includes(activeModuleId);
}

function readAnalyticsAdvancedWorkspacePreference() {
    try {
        return window.localStorage?.getItem(ANALYTICS_ADVANCED_WORKSPACE_STORAGE_KEY) === '1';
    } catch (_error) {
        return false;
    }
}

function writeAnalyticsAdvancedWorkspacePreference(isOpen) {
    try {
        window.localStorage?.setItem(ANALYTICS_ADVANCED_WORKSPACE_STORAGE_KEY, isOpen ? '1' : '0');
    } catch (_error) {
        // Ignore storage failures and keep the UI state in-memory only.
    }
}

function syncAnalyticsAdvancedWorkspaceUI() {
    const isOpen = readAnalyticsAdvancedWorkspacePreference();
    const workspace = document.getElementById('analyticsAdvancedWorkspace');
    const toggleButton = document.getElementById('analyticsAdvancedToggleBtn');
    const toggleLabel = document.getElementById('analyticsAdvancedToggleLabel');

    if (workspace) {
        workspace.hidden = !isOpen;
        workspace.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }

    if (toggleButton) {
        toggleButton.classList.toggle('is-active', isOpen);
        toggleButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        toggleButton.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
        toggleButton.title = isOpen
            ? '收起高级分析工具区'
            : '高级分析默认关闭，仅在手动打开后可用';
    }

    if (toggleLabel) {
        toggleLabel.textContent = isOpen ? '收起高级分析' : '按需高级分析';
    }
}

function setAnalyticsAdvancedWorkspaceOpen(isOpen, options = {}) {
    const nextState = isOpen === true;
    writeAnalyticsAdvancedWorkspacePreference(nextState);
    syncAnalyticsAdvancedWorkspaceUI();

    if (nextState && options.scrollIntoView !== false) {
        scheduleAnalyticsNavigationStep(() => {
            focusAnalyticsDestinationTarget('analyticsAdvancedWorkspace', {
                block: options.block || 'start'
            });
        }, 60);
    }
}

function toggleAnalyticsAdvancedTools() {
    setAnalyticsAdvancedWorkspaceOpen(!readAnalyticsAdvancedWorkspacePreference());
}

function bindAnalyticsAdvancedWorkspaceToggle() {
    const toggleButton = document.getElementById('analyticsAdvancedToggleBtn');
    if (!toggleButton || toggleButton.dataset[ANALYTICS_ADVANCED_TOGGLE_BINDING_FLAG] === '1') {
        return false;
    }

    toggleButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleAnalyticsAdvancedTools();
    });
    toggleButton.dataset[ANALYTICS_ADVANCED_TOGGLE_BINDING_FLAG] = '1';
    return true;
}

function getAnalyticsRangeState() {
    const globalDateRange = getAnalyticsGlobalDateRangeState();
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

function getAnalyticsRangeDayDiff(startDate, endDate) {
    const normalizedStart = normalizeAnalyticsDate(startDate);
    const normalizedEnd = normalizeAnalyticsDate(endDate);
    if (!normalizedStart || !normalizedEnd) {
        return DEFAULT_ANALYTICS_DAYS;
    }

    const diff = Math.round((normalizedEnd.getTime() - normalizedStart.getTime()) / ANALYTICS_DAY_MS) + 1;
    return Math.max(1, diff);
}

function buildAnalyticsPresetRange(days = DEFAULT_ANALYTICS_DAYS, anchorDate = new Date()) {
    const normalizedDays = Number.isFinite(Number(days)) && Number(days) > 0
        ? Math.round(Number(days))
        : DEFAULT_ANALYTICS_DAYS;
    const end = normalizeAnalyticsDate(anchorDate) || normalizeAnalyticsDate(new Date());
    const start = new Date(end);
    start.setDate(start.getDate() - Math.max(0, normalizedDays - 1));

    return {
        start,
        end,
        days: normalizedDays
    };
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
    const globalDateRange = getAnalyticsGlobalDateRangeState();
    const calendarState = getAnalyticsCalendarRuntimeState();
    const inlineCalendarState = getAnalyticsInlineCalendarRuntimeState();

    if (!normalizedStart || !normalizedEnd) return;

    const normalizedDays = Number.isFinite(Number(days)) && Number(days) > 0
        ? Number(days)
        : getAnalyticsRangeDayDiff(normalizedStart, normalizedEnd);

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

    inlineCalendarState.startDate = new Date(normalizedStart);
    inlineCalendarState.endDate = new Date(normalizedEnd);
    inlineCalendarState.selectingEnd = false;

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

function getAnalyticsAIContextKey() {
    const { days, startDate, endDate } = getAnalyticsRangeState();
    return [getAnalyticsSiteParam() || 'all', days, startDate || '', endDate || ''].join(':');
}

function normalizeAnalyticsNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function averageAnalyticsValues(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toAnalyticsRangeBoundaryIso(value, endOfDay = false) {
    const date = normalizeAnalyticsDate(value);
    if (!date) return null;

    if (endOfDay) {
        date.setHours(23, 59, 59, 999);
    } else {
        date.setHours(0, 0, 0, 0);
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = String(Math.floor(absoluteOffsetMinutes / 60)).padStart(2, '0');
    const offsetRemainderMinutes = String(absoluteOffsetMinutes % 60).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetSign}${offsetHours}:${offsetRemainderMinutes}`;
}

async function getAnalyticsAdminAuthHeaders() {
    if (window.AdminAI?.getAuthHeaders) {
        return window.AdminAI.getAuthHeaders();
    }

    const baseHeaders = {
        'Content-Type': 'application/json',
    };

    if (window.AdminApi?.buildRequestInit) {
        try {
            const requestInit = await window.AdminApi.buildRequestInit({
                headers: baseHeaders
            });
            return requestInit?.headers || baseHeaders;
        } catch (_) {
            // Fall through to direct token resolution.
        }
    }

    let accessToken = '';

    try {
        const { data: { session } = {} } = await window.supabaseClient.auth.getSession();
        accessToken = String(session?.access_token || '').trim();
    } catch (_) {
        accessToken = '';
    }

    if (!accessToken && typeof window.supabaseClient?.accessToken === 'function') {
        try {
            accessToken = String(await window.supabaseClient.accessToken() || '').trim();
        } catch (_) {
            accessToken = '';
        }
    }

    if (accessToken) {
        baseHeaders.Authorization = `Bearer ${accessToken}`;
    }

    return baseHeaders;
}

async function ensureAnalyticsAdminCookieSession(options = {}) {
    const forceRefresh = options.forceRefresh === true;

    if (!forceRefresh && pendingAnalyticsAdminSessionPromise) {
        return pendingAnalyticsAdminSessionPromise;
    }

    const sessionPromise = (async () => {
        try {
            await Promise.resolve(window.__adminStudioSessionRestoreReady);
        } catch (error) {
            console.warn('[Analytics] Admin session restore wait failed:', error);
        }

        const accessClient = window.AdminAccess;
        if (!accessClient?.createAdminStudioSession) {
            return false;
        }

        const access = accessClient.getCurrentAdminAccess
            ? await accessClient.getCurrentAdminAccess({
                forceRefresh
            })
            : null;

        if (!access?.user || !access.isAdmin) {
            window.adminStudioSessionGranted = false;
            return false;
        }

        let sessionResult = await accessClient.createAdminStudioSession({
            supabaseClient: window.supabaseClient,
            userId: access.user.id,
            forceRefresh
        });

        if (!sessionResult?.ok && !forceRefresh && accessClient.getCurrentAdminAccess) {
            const refreshedAccess = await accessClient.getCurrentAdminAccess({
                forceRefresh: true
            });

            if (refreshedAccess?.user && refreshedAccess.isAdmin) {
                sessionResult = await accessClient.createAdminStudioSession({
                    supabaseClient: window.supabaseClient,
                    userId: refreshedAccess.user.id,
                    forceRefresh: true
                });
            }
        }

        window.adminStudioSessionGranted = Boolean(sessionResult?.ok);
        if (!window.adminStudioSessionGranted && sessionResult) {
            console.warn('[Analytics] Failed to ensure admin cookie session:', sessionResult);
        }

        return window.adminStudioSessionGranted;
    })();

    if (!forceRefresh) {
        pendingAnalyticsAdminSessionPromise = sessionPromise;
        sessionPromise.finally(() => {
            if (pendingAnalyticsAdminSessionPromise === sessionPromise) {
                pendingAnalyticsAdminSessionPromise = null;
            }
        });
    }

    return sessionPromise;
}

function buildAnalyticsAdminRouteUrl(route = '', params = null) {
    const normalizedRoute = String(route || '').trim().replace(/^\/+|\/+$/g, '');
    const pathname = '/api/admin';
    const url = new URL(pathname, window.location.origin);

    if (normalizedRoute) {
        url.searchParams.set('route', normalizedRoute);
    }

    if (params instanceof URLSearchParams) {
        params.forEach((value, key) => {
            if (value === undefined || value === null || value === '') return;
            url.searchParams.append(key, String(value));
        });
    } else if (params && typeof params === 'object' && !Array.isArray(params)) {
        Object.entries(params).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            url.searchParams.set(key, String(value));
        });
    }

    return url;
}

async function fetchAnalyticsAdminJson(url, options = {}) {
    const performRequest = async (requestOptions = {}) => {
        const hasAdminCookieSession = await ensureAnalyticsAdminCookieSession({
            forceRefresh: requestOptions.forceSessionRefresh === true
        });
        const headers = {
            ...(!hasAdminCookieSession ? (await getAnalyticsAdminAuthHeaders()) : { 'Content-Type': 'application/json' }),
            ...(options.headers || {})
        };

        const response = await fetch(url, {
            ...options,
            credentials: 'same-origin',
            headers
        });

        const payload = await response.json().catch(() => ({}));
        return {
            response,
            payload
        };
    };

    let { response, payload } = await performRequest();
    const shouldRetryAuth = (Number(response.status || 0) === 401 || Number(response.status || 0) === 403)
        && !options.__authRetry;

    if (shouldRetryAuth) {
        window.adminStudioSessionGranted = false;
        try {
            window.AdminAccess?.clearCachedAdminStudioSession?.();
        } catch (_error) {
            // Ignore cache clear failures and fall back to a forced session refresh.
        }

        ({ response, payload } = await performRequest({
            forceSessionRefresh: true
        }));
    }

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

function buildAnalyticsRangeRpcParams(baseParams = {}, options = {}) {
    const range = getAnalyticsRangeState();
    const hasOptionSite = Object.prototype.hasOwnProperty.call(options, 'site');
    const hasOptionStart = Object.prototype.hasOwnProperty.call(options, 'startDate');
    const hasOptionEnd = Object.prototype.hasOwnProperty.call(options, 'endDate');
    const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0
        ? Number(options.days)
        : (range.days || DEFAULT_ANALYTICS_DAYS);
    const rawSite = hasOptionSite ? options.site : getAnalyticsSiteParam();
    const site = String(rawSite || '').trim().toLowerCase() === 'all'
        ? null
        : rawSite;
    const startDate = hasOptionStart ? options.startDate : range.startDate;
    const endDate = hasOptionEnd ? options.endDate : range.endDate;
    const normalizedStartDate = toAnalyticsIsoDate(startDate);
    const normalizedEndDate = toAnalyticsIsoDate(endDate);
    const params = {
        ...(baseParams && typeof baseParams === 'object' && !Array.isArray(baseParams) ? baseParams : {})
    };

    if (options.includeSite !== false) {
        params.p_site = site;
    }

    if (options.includeDays !== false) {
        params.p_days = days;
    }

    if (normalizedStartDate && normalizedEndDate) {
        params.p_start_date = normalizedStartDate;
        params.p_end_date = normalizedEndDate;
    }

    return params;
}

function buildAnalyticsLegacyRpcParams(params = {}, options = {}) {
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

// Derived bundle cache, summary-window/site-comparison accessors, and admin bundle wrappers
// are externalized in js/admin-analytics-derived-bundles.js.
// Date-range controls, refresh orchestration, online-user probes, and realtime toolbar helpers
// are externalized in js/admin-analytics-runtime-controls.js.
// Bundle-first panel fetchers are externalized in js/admin-analytics-panel-loaders.js.

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

// Panel renderers and chart loaders are externalized in js/admin-analytics-panel-loaders.js.
// Lifecycle orchestration, tab routing, realtime bindings, and tracking/anomaly hooks
// are externalized in js/admin-analytics-lifecycle.js.

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
        const presetRange = buildAnalyticsPresetRange(range.days || DEFAULT_ANALYTICS_DAYS);
        start = presetRange.start;
        end = presetRange.end;
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

function getOverviewProductBundleSegmentPayload(bundle = null, key = '') {
    const normalizedKey = String(key || '').trim();
    const segments = bundle?.segments && typeof bundle.segments === 'object'
        ? bundle.segments
        : {};
    const segment = normalizedKey ? segments[normalizedKey] : null;
    if (!segment || typeof segment !== 'object' || segment.ok !== true) {
        return null;
    }
    return segment.payload && typeof segment.payload === 'object'
        ? segment.payload
        : null;
}

function createAnalyticsCommandCenterInventorySummary() {
    return {
        ready: false,
        status: 'idle',
        lowStockCount: 0,
        soldOutCount: 0,
        deliveryRiskProductCount: 0,
        purchaseConversionRate: null,
        orderCount: 0,
        activeProducts: 0,
        actionableCount: 0,
        lastMessage: ''
    };
}

function buildAnalyticsCommandCenterInventorySummary({ productSummaryBundle = null, productHealthBundle = null } = {}) {
    const summary = getOverviewProductBundleSegmentPayload(productSummaryBundle, 'summary');
    const health = {
        lowStockProducts: getOverviewProductBundleSegmentPayload(productHealthBundle, 'lowStockProducts') || [],
        soldOutProducts: getOverviewProductBundleSegmentPayload(productHealthBundle, 'soldOutProducts') || [],
        deliveryRiskProducts: getOverviewProductBundleSegmentPayload(productHealthBundle, 'deliveryRiskProducts') || []
    };

    if (!summary && !health.lowStockProducts.length && !health.soldOutProducts.length && !health.deliveryRiskProducts.length) {
        return createAnalyticsCommandCenterInventorySummary();
    }

    const lowStockCount = normalizeAnalyticsCountValue(summary?.low_stock_product_count ?? health.lowStockProducts.length);
    const soldOutCount = normalizeAnalyticsCountValue(summary?.sold_out_product_count ?? health.soldOutProducts.length);
    const deliveryRiskProductCount = normalizeAnalyticsCountValue(summary?.delivery_risk_product_count ?? health.deliveryRiskProducts.length);
    const recentItems = [];

    if (health.lowStockProducts[0]) {
        const product = health.lowStockProducts[0];
        recentItems.push({
            label: '低库存',
            copy: `${product.product_name || '未命名商品'} · 库存 ${formatNumber(product.stock_count || 0)}`,
            tone: 'warn',
            moduleId: 'shop',
            stateKey: `inventory-low-stock-${String(product.product_id || product.id || product.product_name || 'recent').trim() || 'recent'}`,
            feedbackLabel: product.product_name || '库存导入',
            intent: `打开商城系统导入，继续处理 ${product.product_name || '该商品'} 的补货。`,
            context: {
                destination: 'shop',
                entity: 'shop-inventory',
                action: 'focus-import-product',
                focus: {
                    productId: product.product_id,
                    product_id: product.product_id
                },
                payload: {
                    workspace: 'import',
                    defaultTab: 'import',
                    tab: 'import',
                    productId: product.product_id,
                    product_id: product.product_id,
                    productName: product.product_name,
                    product_name: product.product_name
                }
            },
            options: {
                defaultTab: 'import',
                tab: 'import'
            }
        });
    }

    if (health.soldOutProducts[0]) {
        const product = health.soldOutProducts[0];
        recentItems.push({
            label: '售罄商品',
            copy: `${product.product_name || '未命名商品'} · 当前已售罄`,
            tone: 'warn',
            moduleId: 'shop',
            stateKey: `inventory-sold-out-${String(product.product_id || product.id || product.product_name || 'recent').trim() || 'recent'}`,
            feedbackLabel: product.product_name || '库存导入',
            intent: `打开商城系统导入，继续处理 ${product.product_name || '该商品'} 的补货。`,
            context: {
                destination: 'shop',
                entity: 'shop-inventory',
                action: 'focus-import-product',
                focus: {
                    productId: product.product_id,
                    product_id: product.product_id
                },
                payload: {
                    workspace: 'import',
                    defaultTab: 'import',
                    tab: 'import',
                    productId: product.product_id,
                    product_id: product.product_id,
                    productName: product.product_name,
                    product_name: product.product_name
                }
            },
            options: {
                defaultTab: 'import',
                tab: 'import'
            }
        });
    }

    if (health.deliveryRiskProducts[0]) {
        const product = health.deliveryRiskProducts[0];
        recentItems.push({
            label: '履约风险',
            copy: `${product.product_name || '未命名商品'} · 风险 ${formatNumber(product.delivery_risk_count || 0)} 单`,
            tone: 'warn',
            moduleId: 'commerce-center',
            stateKey: `inventory-delivery-risk-${String(product.product_id || product.id || product.product_name || 'recent').trim() || 'recent'}`,
            feedbackLabel: product.product_name || '商品履约风险',
            intent: `打开 ${product.product_name || '该商品'} 的履约风险拆解。`,
            context: {
                payload: {
                    view: 'product',
                    tab: 'product',
                    focusTargetId: 'productRiskBreakdownSection',
                    productId: product.product_id,
                    productName: product.product_name,
                    detailFocus: 'delivery-risk'
                }
            },
            options: {
                viewName: 'product'
            }
        });
    }

    if (!recentItems.length && Number.isFinite(Number(summary?.purchase_conversion_rate))) {
        recentItems.push({
            label: '商品转化',
            copy: `当前购买转化 ${formatPercent(summary.purchase_conversion_rate)}`,
            tone: 'ok',
            moduleId: 'commerce-center',
            stateKey: 'inventory-conversion-overview',
            feedbackLabel: '商品漏斗',
            intent: '打开商品经营漏斗，查看最近转化。',
            context: {
                payload: {
                    view: 'product',
                    tab: 'product',
                    focusTargetId: 'productFunnelSection'
                }
            },
            options: {
                viewName: 'product'
            }
        });
    }

    return {
        ready: true,
        status: 'ready',
        lowStockCount,
        soldOutCount,
        deliveryRiskProductCount,
        purchaseConversionRate: summary ? normalizeAnalyticsNumber(summary.purchase_conversion_rate) : null,
        orderCount: normalizeAnalyticsCountValue(summary?.order_count),
        activeProducts: normalizeAnalyticsCountValue(summary?.active_product_count),
        actionableCount: lowStockCount + soldOutCount + deliveryRiskProductCount,
        lastMessage: '',
        recentItems: recentItems.slice(0, 3)
    };
}

function getAnalyticsCommandCenterInventorySummary() {
    if (typeof getAnalyticsDerivedStateValue !== 'function') {
        return createAnalyticsCommandCenterInventorySummary();
    }

    return buildAnalyticsCommandCenterInventorySummary({
        productSummaryBundle: getAnalyticsDerivedStateValue('productSummaryBundle'),
        productHealthBundle: getAnalyticsDerivedStateValue('productHealthBundle')
    });
}

function emitAnalyticsCommandCenterInventorySummaryUpdate(summary = null) {
    if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') {
        return summary || null;
    }

    const nextSummary = summary && typeof summary === 'object'
        ? summary
        : getAnalyticsCommandCenterInventorySummary();

    try {
        window.dispatchEvent(new CustomEvent('admin-analytics-inventory-summary-updated', {
            detail: nextSummary
        }));
    } catch (_) {
        // Command center sync should never block analytics rendering.
    }

    return nextSummary;
}

async function primeAnalyticsCommandCenterInventorySummary(options = {}) {
    if (typeof getAnalyticsProductSummaryBundle !== 'function' || typeof getAnalyticsProductHealthBundle !== 'function') {
        return createAnalyticsCommandCenterInventorySummary();
    }

    try {
        const [productSummaryBundle, productHealthBundle] = await Promise.all([
            getAnalyticsProductSummaryBundle({ forceRefresh: options.force === true }).catch(() => null),
            getAnalyticsProductHealthBundle({ forceRefresh: options.force === true }).catch(() => null)
        ]);
        return emitAnalyticsCommandCenterInventorySummaryUpdate(
            buildAnalyticsCommandCenterInventorySummary({
                productSummaryBundle,
                productHealthBundle
            })
        );
    } catch (error) {
        const summary = {
            ...createAnalyticsCommandCenterInventorySummary(),
            ready: true,
            status: 'error',
            lastMessage: error?.message || '商品经营摘要同步失败'
        };
        return emitAnalyticsCommandCenterInventorySummaryUpdate(summary);
    }
}

function buildOverviewBusinessMixProductSignals({
    productSummary = {},
    productHealth = {},
    productRanks = {}
} = {}) {
    const summary = productSummary && typeof productSummary === 'object' ? productSummary : {};
    const health = productHealth && typeof productHealth === 'object' ? productHealth : {};
    const ranks = productRanks && typeof productRanks === 'object' ? productRanks : {};

    const orderCount = normalizeAnalyticsCountValue(summary.order_count);
    const buyerCount = normalizeAnalyticsCountValue(summary.unique_buyer_count);
    const gmvPoints = normalizeAnalyticsNumber(summary.gmv_points);
    const viewUsers = normalizeAnalyticsCountValue(summary.view_user_count);
    const detailUsers = normalizeAnalyticsCountValue(summary.detail_view_user_count);
    const purchaseIntentUsers = normalizeAnalyticsCountValue(summary.purchase_click_user_count);
    const activeProducts = normalizeAnalyticsCountValue(summary.active_product_count);
    const lowStockCount = normalizeAnalyticsCountValue(summary.low_stock_product_count);
    const soldOutCount = normalizeAnalyticsCountValue(summary.sold_out_product_count);
    const deliveryRiskProductCount = normalizeAnalyticsCountValue(summary.delivery_risk_product_count);
    const refundRate = normalizeAnalyticsNumber(summary.refund_rate);
    const purchaseConversionRate = normalizeAnalyticsNumber(summary.purchase_conversion_rate);
    const topProductName = String(summary.top_product_name || '').trim();
    const highExposureRows = Array.isArray(ranks.highExposureLowConversion) ? ranks.highExposureLowConversion : [];
    const contentDrivenRows = Array.isArray(ranks.contentDrivenTop) ? ranks.contentDrivenTop : [];
    const refundRiskRows = Array.isArray(health.refundRiskProducts) ? health.refundRiskProducts : [];
    const deliveryRiskRows = Array.isArray(health.deliveryRiskProducts) ? health.deliveryRiskProducts : [];
    const lowStockRows = Array.isArray(health.lowStockProducts) ? health.lowStockProducts : [];
    const soldOutRows = Array.isArray(health.soldOutProducts) ? health.soldOutProducts : [];
    const topExposureGap = highExposureRows[0] || null;
    const topRefundRisk = refundRiskRows[0] || null;
    const topDeliveryRisk = deliveryRiskRows[0] || null;
    const topLowStock = lowStockRows[0] || soldOutRows[0] || null;
    const topContentDriven = contentDrivenRows[0] || null;
    const hasSignal = Boolean(
        orderCount > 0
        || buyerCount > 0
        || gmvPoints > 0
        || viewUsers > 0
        || detailUsers > 0
        || purchaseIntentUsers > 0
        || activeProducts > 0
        || lowStockCount > 0
        || soldOutCount > 0
        || deliveryRiskProductCount > 0
        || highExposureRows.length > 0
        || contentDrivenRows.length > 0
        || refundRiskRows.length > 0
        || deliveryRiskRows.length > 0
        || lowStockRows.length > 0
        || soldOutRows.length > 0
        || topProductName
    );

    if (!hasSignal) {
        return null;
    }

    const item = {
        title: '商品经营',
        value: formatNumber(orderCount > 0 ? orderCount : Math.max(viewUsers, activeProducts)),
        meta: orderCount > 0
            ? `买家 ${formatNumber(buyerCount)} / GMV ${formatNumber(gmvPoints)}`
            : `浏览 ${formatNumber(viewUsers)} / 活跃商品 ${formatNumber(activeProducts)}`,
        badgeLabel: '商品',
        badgeTone: 'accent',
        summary: orderCount > 0
            ? `当前窗口商品成交 ${formatNumber(orderCount)} 单，转化 ${formatPercent(purchaseConversionRate)}${topProductName ? `，头部商品是 ${topProductName}` : ''}。`
            : (purchaseIntentUsers > 0
                ? `当前窗口已有 ${formatNumber(purchaseIntentUsers)} 个购买意图，但暂时还没形成成交，优先看商品漏斗和支付承接。`
                : `当前窗口商品浏览 ${formatNumber(viewUsers)}、详情触达 ${formatNumber(detailUsers)}，建议继续看商品经营承接。`),
        actionLabel: '查看商品经营',
        destination: 'analytics-product',
        icon: 'fas fa-box-open',
        context: {
            focusTargetId: orderCount > 0 ? 'productOverviewSection' : 'productFunnelSection'
        }
    };

    let recommendation = null;

    if (topRefundRisk) {
        recommendation = {
            tone: 'danger',
            level: '优先处理',
            title: '商品售后风险已进入经营总览',
            summary: `${topRefundRisk.product_name || '头部商品'} 当前退款率 ${formatPercent(topRefundRisk.refund_rate || 0)}，建议优先回看商品详情里的退款拆解和售后摘要。`,
            actionLabel: '看商品售后风险',
            destination: 'analytics-product',
            icon: 'fas fa-rotate-left',
            context: {
                productId: topRefundRisk.product_id,
                productName: topRefundRisk.product_name,
                detailFocus: 'refund-risk',
                focusTargetId: 'productRiskBreakdownSection'
            },
            sampleLabel: '商品风险',
            sampleItems: [
                `${topRefundRisk.product_name || '未命名商品'} · 退款 ${formatNumber(topRefundRisk.refunded_order_count || 0)} 单`,
                `退款率 ${formatPercent(topRefundRisk.refund_rate || 0)}`,
                `总单量 ${formatNumber((topRefundRisk.order_count || 0) + (topRefundRisk.refunded_order_count || 0))}`
            ]
        };
    } else if (topDeliveryRisk) {
        recommendation = {
            tone: 'warning',
            level: '建议复核',
            title: '商品履约异常已经影响经营承接',
            summary: `${topDeliveryRisk.product_name || '头部商品'} 当前履约风险 ${formatNumber(topDeliveryRisk.delivery_risk_count || 0)} 单，建议优先回看商品详情里的履约拆解。`,
            actionLabel: '看商品履约风险',
            destination: 'analytics-product',
            icon: 'fas fa-truck-fast',
            context: {
                productId: topDeliveryRisk.product_id,
                productName: topDeliveryRisk.product_name,
                detailFocus: 'delivery-risk',
                focusTargetId: 'productRiskBreakdownSection'
            },
            sampleLabel: '商品风险',
            sampleItems: [
                `${topDeliveryRisk.product_name || '未命名商品'} · 风险 ${formatNumber(topDeliveryRisk.delivery_risk_count || 0)} 单`,
                `支付 ${formatNumber(topDeliveryRisk.order_count || 0)} 单`,
                `履约异常率 ${formatPercent(topDeliveryRisk.delivery_risk_rate || 0)}`
            ]
        };
    } else if (topExposureGap) {
        recommendation = {
            tone: 'warning',
            level: '建议跟进',
            title: '商品高曝光低转化信号已进入总览',
            summary: `${topExposureGap.product_name || '头部商品'} 当前浏览 ${formatNumber(topExposureGap.view_user_count || 0)}、转化 ${formatPercent(topExposureGap.conversion_rate || 0)}，建议优先看商品漏斗。`,
            actionLabel: '看商品漏斗',
            destination: 'analytics-product',
            icon: 'fas fa-filter-circle-dollar',
            context: {
                productId: topExposureGap.product_id,
                productName: topExposureGap.product_name,
                focusTargetId: 'productFunnelSection'
            },
            sampleLabel: '商品断点',
            sampleItems: [
                `${topExposureGap.product_name || '未命名商品'} · 浏览 ${formatNumber(topExposureGap.view_user_count || 0)}`,
                `转化 ${formatPercent(topExposureGap.conversion_rate || 0)}`,
                `低转化分 ${formatNumber(topExposureGap.low_conversion_score || 0)}`
            ]
        };
    } else if (orderCount <= 0 && (purchaseIntentUsers > 0 || viewUsers > 0)) {
        recommendation = {
            tone: purchaseIntentUsers > 0 ? 'warning' : 'accent',
            level: purchaseIntentUsers > 0 ? '建议复核' : '持续观察',
            title: '商品浏览已形成，但成交还没起量',
            summary: purchaseIntentUsers > 0
                ? `当前窗口已有 ${formatNumber(purchaseIntentUsers)} 个购买意图，但仍是 0 成交，建议优先复核支付承接和商品详情承接。`
                : `当前窗口商品浏览 ${formatNumber(viewUsers)}、详情触达 ${formatNumber(detailUsers)}，建议继续观察商品漏斗是否开始形成购买意图。`,
            actionLabel: '查看商品经营',
            destination: 'analytics-product',
            icon: 'fas fa-box-open',
            context: {
                focusTargetId: 'productFunnelSection'
            }
        };
    } else if (topLowStock) {
        recommendation = {
            tone: soldOutCount > 0 ? 'warning' : 'accent',
            level: soldOutCount > 0 ? '建议复核' : '持续观察',
            title: '商品库存信号已进入经营总览',
            summary: `${topLowStock.product_name || '头部商品'} 当前库存 ${formatNumber(topLowStock.stock_count || 0)}，建议结合销量和履约情况判断是否需要补货。`,
            actionLabel: '看库存健康',
            destination: 'analytics-product',
            icon: 'fas fa-layer-group',
            context: {
                focusTargetId: 'productHealthSection'
            }
        };
    } else if (topContentDriven) {
        recommendation = {
            tone: 'success',
            level: '持续观察',
            title: '内容带货已经开始影响商品成交',
            summary: `${topContentDriven.product_name || '头部商品'} 当前归因 GMV ${formatNumber(topContentDriven.content_assisted_gmv_points || 0)}，可以继续看内容与商品联动放量。`,
            actionLabel: '看商品带货',
            destination: 'analytics-product',
            icon: 'fas fa-wand-magic-sparkles',
            context: {
                productId: topContentDriven.product_id,
                productName: topContentDriven.product_name,
                detailFocus: 'content-attribution',
                focusTargetId: 'productContentBreakdownSection'
            }
        };
    }

    return {
        metrics: {
            productOrderCount: orderCount,
            productBuyerCount: buyerCount,
            productGmvPoints: gmvPoints,
            productViewUserCount: viewUsers,
            productPurchaseIntentUserCount: purchaseIntentUsers,
            productLowStockCount: lowStockCount,
            productSoldOutCount: soldOutCount,
            productDeliveryRiskProductCount: deliveryRiskProductCount,
            productRefundRate: refundRate,
            productPurchaseConversionRate: purchaseConversionRate
        },
        item,
        recommendation,
        exportRows: [
            { '指标': '商品成交订单', '数值': orderCount, '说明': `买家 ${buyerCount} / GMV ${formatNumber(gmvPoints)}` },
            { '指标': '商品浏览用户', '数值': viewUsers, '说明': `详情 ${detailUsers} / 购买意图 ${purchaseIntentUsers}` },
            { '指标': '商品转化率', '数值': roundTo(purchaseConversionRate, 2) || 0, '说明': `退款率 ${formatPercent(refundRate)} / 低库存 ${lowStockCount} / 售罄 ${soldOutCount}` }
        ]
    };
}

function enrichOverviewBusinessMixSummaryWithProductSignals(summary = {}, productSignals = null) {
    if (!summary || typeof summary !== 'object' || !productSignals || typeof productSignals !== 'object') {
        return summary;
    }

    const metrics = summary.metrics && typeof summary.metrics === 'object'
        ? { ...summary.metrics, ...(productSignals.metrics && typeof productSignals.metrics === 'object' ? productSignals.metrics : {}) }
        : { ...(productSignals.metrics && typeof productSignals.metrics === 'object' ? productSignals.metrics : {}) };
    const items = Array.isArray(summary.items) ? [...summary.items] : [];
    const recommendations = Array.isArray(summary.recommendations) ? [...summary.recommendations] : [];
    const exportRows = Array.isArray(summary.exportRows) ? [...summary.exportRows] : [];

    if (productSignals.item) {
        const existingIndex = items.findIndex((item) => /商品/.test(String(item?.title || '')));
        if (existingIndex >= 0) {
            items.splice(existingIndex, 1, productSignals.item);
        } else {
            items.push(productSignals.item);
        }
    }

    if (productSignals.recommendation) {
        recommendations.unshift(productSignals.recommendation);
    }

    if (Array.isArray(productSignals.exportRows) && productSignals.exportRows.length > 0) {
        exportRows.push(...productSignals.exportRows);
    }

    return {
        ...summary,
        metrics,
        items: items.slice(0, 5),
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

function getAnalyticsNewUsersLabels(site = getAnalyticsSiteParam()) {
    if (site) {
        return {
            todayLabel: '今日站点新增',
            weekLabel: '近 7 天站点新增',
            seriesLabel: '站点新增'
        };
    }

    return {
        todayLabel: '今日全局注册',
        weekLabel: '近 7 天全局注册',
        seriesLabel: '新增注册'
    };
}

function getAnalyticsNewUsersTooltip(overview = {}, site = getAnalyticsSiteParam()) {
    const globalNewUsers = normalizeAnalyticsCountValue(overview?.global_new_users_week ?? overview?.new_users_week);
    const currentViewNewUsers = normalizeAnalyticsCountValue(overview?.new_users_week);
    const siteAttributedNewUsers = normalizeAnalyticsCountValue(overview?.site_attributed_new_users_week);
    const pendingAttribution = normalizeAnalyticsCountValue(overview?.unattributed_new_users_week);

    if (site) {
        return `首站点归因口径：${getAnalyticsSiteLabel(site)} 近 7 天新增 ${formatNumber(currentViewNewUsers)} / 全局注册 ${formatNumber(globalNewUsers)}${pendingAttribution > 0 ? `，待归因 ${formatNumber(pendingAttribution)}` : ''}`;
    }

    return `全局注册口径：近 7 天注册 ${formatNumber(globalNewUsers)}，其中已完成站点归因 ${formatNumber(siteAttributedNewUsers)}${pendingAttribution > 0 ? `，待归因 ${formatNumber(pendingAttribution)}` : ''}`;
}

function syncAnalyticsNewUsersContext(overview = {}) {
    const labels = getAnalyticsNewUsersLabels();
    const labelElement = document.getElementById('kpiNewUsersLabel');
    const cardElement = document.getElementById('kpiNewUsers');
    const valueElement = document.getElementById('kpiNewUsersValue');
    const tooltip = getAnalyticsNewUsersTooltip(overview);

    if (labelElement) {
        labelElement.textContent = labels.weekLabel;
    }

    if (cardElement) {
        cardElement.title = tooltip;
    }

    if (valueElement) {
        valueElement.title = tooltip;
    }
}

function getAnalyticsActiveUserLabels() {
    return {
        dauLabel: '业务日活 (DAU)',
        mauLabel: '业务月活 (MAU)',
        seriesLabel: '业务活跃用户',
        promptDauLabel: '业务 DAU',
        promptMauLabel: '业务 MAU'
    };
}

function getAnalyticsActiveUsersTooltip(overview = {}) {
    const businessDau = normalizeAnalyticsCountValue(overview?.business_dau ?? overview?.dau);
    const businessMau = normalizeAnalyticsCountValue(overview?.business_mau ?? overview?.mau);
    const loginDau = normalizeAnalyticsCountValue(overview?.login_dau);
    const loginMau = normalizeAnalyticsCountValue(overview?.login_mau);

    if (loginDau > 0 || loginMau > 0) {
        return `真实业务活跃口径：今日 ${formatNumber(businessDau)} / 30 天 ${formatNumber(businessMau)}；登录活跃参考：今日 ${formatNumber(loginDau)} / 30 天 ${formatNumber(loginMau)}`;
    }

    return `真实业务活跃口径：今日 ${formatNumber(businessDau)} / 30 天 ${formatNumber(businessMau)}`;
}

function syncAnalyticsActiveUsersContext(overview = {}) {
    const labels = getAnalyticsActiveUserLabels();
    const tooltip = getAnalyticsActiveUsersTooltip(overview);
    const cardBindings = [
        {
            cardId: 'kpiDau',
            labelId: 'kpiDauLabel',
            valueId: 'kpiDauValue',
            trendId: 'kpiDauTrend',
            label: labels.dauLabel
        },
        {
            cardId: 'kpiMau',
            labelId: 'kpiMauLabel',
            valueId: 'kpiMauValue',
            trendId: null,
            label: labels.mauLabel
        }
    ];

    cardBindings.forEach((binding) => {
        const cardElement = document.getElementById(binding.cardId);
        const labelElement = document.getElementById(binding.labelId);
        const valueElement = document.getElementById(binding.valueId);
        const trendElement = binding.trendId ? document.getElementById(binding.trendId) : null;

        if (labelElement) {
            labelElement.textContent = binding.label;
        }

        if (cardElement) {
            cardElement.title = tooltip;
        }

        if (valueElement) {
            valueElement.title = tooltip;
        }

        if (trendElement) {
            trendElement.title = tooltip;
        }
    });
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

function hasVerifyServiceSummarySignal(summary = {}) {
    const metrics = summary?.metrics && typeof summary.metrics === 'object'
        ? summary.metrics
        : {};
    return normalizeAnalyticsCountValue(metrics.requestCount) > 0
        || normalizeAnalyticsCountValue(metrics.successCount) > 0
        || normalizeAnalyticsCountValue(metrics.activeCount) > 0
        || normalizeAnalyticsCountValue(metrics.failedCount) > 0
        || (Array.isArray(summary?.recentItems) && summary.recentItems.length > 0)
        || (Array.isArray(summary?.focusItems) && summary.focusItems.length > 0);
}

function buildVerifyEventFunnelFallbackViewData(summary = {}) {
    const metrics = summary?.metrics && typeof summary.metrics === 'object'
        ? summary.metrics
        : {};
    const requestCount = normalizeAnalyticsCountValue(metrics.requestCount);
    const successCount = normalizeAnalyticsCountValue(metrics.successCount);
    const activeCount = normalizeAnalyticsCountValue(metrics.activeCount);
    const failedCount = normalizeAnalyticsCountValue(metrics.failedCount);
    const issueCount = failedCount + activeCount;

    if (![requestCount, successCount, issueCount].some((value) => value > 0)) {
        return {
            items: [],
            exportRows: [],
            compatibilityMode: false
        };
    }

    const successRate = normalizeAnalyticsNumber(metrics.successRate) || getAnalyticsPercentRate(successCount, requestCount);
    const issueRate = getAnalyticsPercentRate(issueCount, requestCount);

    return {
        compatibilityMode: true,
        items: [
            {
                title: '提交任务',
                value: formatNumber(requestCount),
                meta: `成功 ${formatNumber(successCount)} / 风险 ${formatNumber(issueCount)}`,
                badgeLabel: '兼容口径',
                badgeTone: 'neutral',
                summary: '当前缺少 verify_* 真实事件时，先回退到验证任务摘要口径帮助排查。',
                actionLabel: '打开 Verify Monitor',
                destination: 'verify-monitor',
                icon: 'fas fa-wave-square'
            },
            {
                title: '成功完成',
                value: formatNumber(successCount),
                meta: `完成率 ${formatPercent(successRate)}`,
                badgeLabel: '兼容口径',
                badgeTone: getAnalyticsRateBadgeTone(successRate, { successAbove: 80, warningAbove: 55 }),
                summary: '基于验证任务摘要估算当前窗口的完成表现，适合继续回看验证配置和队列。',
                actionLabel: successRate < 80 ? '检查验证配置' : '打开 Verify Monitor',
                destination: successRate < 80 ? 'settings-google-one' : 'verify-monitor',
                icon: successRate < 80 ? 'fas fa-sliders' : 'fas fa-wave-square'
            },
            {
                title: '失败 / 阻塞',
                value: formatNumber(issueCount),
                meta: `失败 ${formatNumber(failedCount)} / 处理中 ${formatNumber(activeCount)}`,
                badgeLabel: `占提交 ${formatPercent(issueRate)}`,
                badgeTone: issueCount > 0 ? getAnalyticsRateBadgeTone(100 - issueRate, { successAbove: 92, warningAbove: 80 }) : 'neutral',
                summary: '兼容口径会把失败与处理中任务一起提出来，避免当前窗口完全看不到验证承接风险。',
                actionLabel: '打开 Verify Monitor',
                destination: 'verify-monitor',
                icon: 'fas fa-wave-square'
            }
        ],
        exportRows: [
            { '阶段': '提交任务', '用户数': requestCount, '事件数': requestCount, '比率(%)': 100, '说明': '兼容口径：验证任务摘要' },
            { '阶段': '成功完成', '用户数': successCount, '事件数': successCount, '比率(%)': successRate, '说明': '兼容口径：验证任务摘要中的成功任务' },
            { '阶段': '失败 / 阻塞', '用户数': issueCount, '事件数': issueCount, '比率(%)': issueRate, '说明': '兼容口径：失败任务 + 处理中任务' }
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
            const [payloadBundle, summaryWindow, productSummaryBundle, productRankBundle, productHealthBundle] = await Promise.all([
                getAnalyticsSummaryPayloadBundle({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null),
                getAnalyticsSummaryWindowData({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null),
                getAnalyticsProductSummaryBundle({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null),
                getAnalyticsProductRankBundle({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null),
                getAnalyticsProductHealthBundle({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null)
            ]);
            const productSignals = buildOverviewBusinessMixProductSignals({
                productSummary: getOverviewProductBundleSegmentPayload(productSummaryBundle, 'summary'),
                productHealth: {
                    lowStockProducts: getOverviewProductBundleSegmentPayload(productHealthBundle, 'lowStockProducts') || [],
                    soldOutProducts: getOverviewProductBundleSegmentPayload(productHealthBundle, 'soldOutProducts') || [],
                    deliveryRiskProducts: getOverviewProductBundleSegmentPayload(productHealthBundle, 'deliveryRiskProducts') || [],
                    refundRiskProducts: getOverviewProductBundleSegmentPayload(productHealthBundle, 'refundRiskProducts') || []
                },
                productRanks: {
                    highExposureLowConversion: getOverviewProductBundleSegmentPayload(productRankBundle, 'highExposureLowConversion') || [],
                    contentDrivenTop: getOverviewProductBundleSegmentPayload(productRankBundle, 'contentDrivenTop') || []
                }
            });
            const payloadSegment = getAnalyticsSummaryPayloadBundleSegment(payloadBundle, 'overviewBusinessMix');
            if (payloadSegment?.ok && payloadSegment.summary) {
                return enrichOverviewBusinessMixSummaryWithProductSignals(
                    enrichOverviewBusinessMixSummaryWithEvents(payloadSegment.summary, summaryWindow || {}),
                    productSignals
                );
            }

            const rowsBundle = await getAnalyticsSummaryRowsBundle({
                contextKey,
                forceRefresh: options.forceRefresh
            }).catch(() => null);

            const bundledUnlockRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'promptUnlocks');
            const bundledVerifyRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'verificationLogs');
            const bundledGuestbookMessages = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'guestbookMessages');
            const bundledGuestbookComments = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'guestbookComments');
            const bundledGuestbookLikes = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'guestbookLikes');
            const bundledPromptComments = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'promptComments');
            const bundledRewardRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'pointsLedger');

            const rowResults = bundledUnlockRows
                && bundledVerifyRows
                && bundledGuestbookMessages
                && bundledGuestbookComments
                && bundledGuestbookLikes
                && bundledPromptComments
                && bundledRewardRows
                ? [
                    bundledUnlockRows,
                    bundledVerifyRows,
                    bundledGuestbookMessages,
                    bundledGuestbookComments,
                    bundledGuestbookLikes,
                    bundledPromptComments,
                    bundledRewardRows
                ]
                : await Promise.all([
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

            return enrichOverviewBusinessMixSummaryWithProductSignals(
                enrichOverviewBusinessMixSummaryWithEvents(baseSummary, summaryWindow || {}),
                productSignals
            );
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
            const [payloadBundle, summaryWindow] = await Promise.all([
                getAnalyticsSummaryPayloadBundle({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null),
                getAnalyticsSummaryWindowData({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null)
            ]);
            const payloadSegment = getAnalyticsSummaryPayloadBundleSegment(payloadBundle, 'verifyServiceSummary');
            if (payloadSegment?.ok && payloadSegment.summary) {
                const enrichedSummary = (() => {
                    return enrichVerifyServiceSummaryWithEvents(payloadSegment.summary, summaryWindow || {});
                })();
                if (hasVerifyServiceSummarySignal(enrichedSummary)) {
                    return enrichedSummary;
                }
            }

            const rowsBundle = await getAnalyticsSummaryRowsBundle({
                contextKey,
                forceRefresh: options.forceRefresh
            }).catch(() => null);
            const bundledRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'verificationLogs');
            const rows = Array.isArray(bundledRows)
                ? bundledRows
                : await fetchAnalyticsTableRows(
                    'verification_logs',
                    'verification_id, user_id, email, site, status, summary, message, error_message, stage_label, raw_status, points_deducted, created_at',
                    { orderBy: 'created_at', rangeColumn: 'created_at' }
                );
            const baseSummary = buildVerifyServiceSummaryFromRows(rows);
            const enrichedSummary = enrichVerifyServiceSummaryWithEvents(baseSummary, summaryWindow || {});
            if (hasVerifyServiceSummarySignal(enrichedSummary)) {
                return enrichedSummary;
            }

            const snapshot = await getAnalyticsVerifyMonitorSnapshotData({
                contextKey,
                forceRefresh: options.forceRefresh
            }).catch(() => null);
            const fallbackSummary = buildVerifyServiceSummaryFallback({
                snapshot,
                summaryWindow: summaryWindow || {}
            });
            return hasVerifyServiceSummarySignal(fallbackSummary)
                ? fallbackSummary
                : enrichedSummary;
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
            const [payloadBundle, summaryWindow] = await Promise.all([
                getAnalyticsSummaryPayloadBundle({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null),
                getAnalyticsSummaryWindowData({
                    contextKey,
                    forceRefresh: options.forceRefresh
                }).catch(() => null)
            ]);
            const payloadSegment = getAnalyticsSummaryPayloadBundleSegment(payloadBundle, 'growthSummary');
            if (payloadSegment?.ok && payloadSegment.summary) {
                return enrichGrowthSummaryWithEvents(payloadSegment.summary, summaryWindow || {});
            }

            const rowsBundle = await getAnalyticsSummaryRowsBundle({
                contextKey,
                forceRefresh: options.forceRefresh
            }).catch(() => null);

            const bundledGuestbookMessages = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'guestbookMessages');
            const bundledGuestbookComments = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'guestbookComments');
            const bundledGuestbookLikes = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'guestbookLikes');
            const bundledPromptComments = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'promptComments');
            const bundledLedgerRows = getAnalyticsSummaryRowsBundleTable(rowsBundle, 'pointsLedger');
            const rowResults = bundledGuestbookMessages
                && bundledGuestbookComments
                && bundledGuestbookLikes
                && bundledPromptComments
                && bundledLedgerRows
                ? [
                    bundledGuestbookMessages,
                    bundledGuestbookComments,
                    bundledGuestbookLikes,
                    bundledPromptComments,
                    bundledLedgerRows
                ]
                : await Promise.all([
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

// Panel summaries and chart loaders are externalized in js/admin-analytics-panel-loaders.js.

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

window.toggleAnalyticsAdvancedTools = toggleAnalyticsAdvancedTools;
window.getAnalyticsCommandCenterInventorySummary = getAnalyticsCommandCenterInventorySummary;
window.primeAnalyticsCommandCenterInventorySummary = primeAnalyticsCommandCenterInventorySummary;
window.emitAnalyticsCommandCenterInventorySummaryUpdate = emitAnalyticsCommandCenterInventorySummaryUpdate;

// ============================================
// ADVANCED CHARTS
// Panel renderers extracted to js/admin-analytics-panel-loaders.js
// ============================================

let funnelChart = null;
let geoChart = null;

// Runtime controls, date-range state, and realtime toolbar helpers
// are externalized in js/admin-analytics-runtime-controls.js.
// Lifecycle orchestration, tab routing, chart teardown, tracking sdk,
// and anomaly refresh hooks are externalized in js/admin-analytics-lifecycle.js.
