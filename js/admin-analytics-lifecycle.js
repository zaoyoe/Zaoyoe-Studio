/**
 * Admin Analytics lifecycle orchestration, tab routing, tracking sdk, and anomaly hooks.
 * Keeps admin-analytics.js focused on shared helpers and panel-adjacent transforms.
 */

function getActiveAnalyticsSidebarModuleId() {
    const activeSidebarModuleId = String(document.querySelector('.sidebar-item.active[data-module]')?.dataset?.module || '').trim().toLowerCase();
    if (activeSidebarModuleId === 'business-overview' || activeSidebarModuleId === 'growth-center' || activeSidebarModuleId === 'commerce-center') {
        return activeSidebarModuleId;
    }

    const activeContainerModuleId = String(document.querySelector('.module-container.active')?.id || '')
        .replace(/^module-/, '')
        .trim()
        .toLowerCase();
    if (activeContainerModuleId === 'business-overview' || activeContainerModuleId === 'growth-center' || activeContainerModuleId === 'commerce-center') {
        return activeContainerModuleId;
    }

    return '';
}

function getAnalyticsScopeConfigForTab(tabId = '', options = {}) {
    const normalizedTabId = String(tabId || 'overview').trim().toLowerCase() || 'overview';
    const preferredModuleId = String(options.preferredModuleId || getActiveAnalyticsSidebarModuleId() || '').trim().toLowerCase();
    const sidebarModuleId = typeof window.getAdminAnalyticsSidebarModuleIdForTab === 'function'
        ? window.getAdminAnalyticsSidebarModuleIdForTab(normalizedTabId, { preferredModuleId })
        : (normalizedTabId === 'overview' || normalizedTabId === 'growth' || normalizedTabId === 'content'
            ? 'growth-center'
            : (normalizedTabId === 'product' || normalizedTabId === 'ops' || normalizedTabId === 'monetization' || normalizedTabId === 'verify'
                ? 'commerce-center'
                : 'growth-center'));

    switch (sidebarModuleId) {
        case 'growth-center':
            return {
                scopeId: 'growth-center',
                primaryLabel: '增长经营',
                supportLabel: '经营支撑',
                primaryTabs: ['overview', 'growth', 'content'],
                supportTabs: []
            };
        case 'commerce-center':
            return {
                scopeId: 'commerce-center',
                primaryLabel: '商品经营',
                supportLabel: '经营支撑',
                primaryTabs: ['product', 'ops'],
                supportTabs: ['monetization', 'verify']
            };
        default:
            return {
                scopeId: 'growth-center',
                primaryLabel: '增长经营',
                supportLabel: '经营支撑',
                primaryTabs: ['overview', 'growth', 'content'],
                supportTabs: []
            };
    }
}

function syncAnalyticsTabScope(tabId = '', options = {}) {
    const nav = document.getElementById('analyticsTabsNav');
    if (!nav) return null;

    const config = getAnalyticsScopeConfigForTab(tabId, options);
    const primaryGroup = nav.querySelector('.analytics-tab-group--primary');
    const supportGroup = nav.querySelector('.analytics-tab-group--support');
    const primaryLabel = primaryGroup?.querySelector('.analytics-tab-group__label');
    const supportLabel = supportGroup?.querySelector('.analytics-tab-group__label');
    const allowedTabs = new Set([...(config.primaryTabs || []), ...(config.supportTabs || [])]);

    nav.dataset.analyticsScope = config.scopeId;
    nav.setAttribute('aria-label', `${config.primaryLabel}分区`);

    if (primaryLabel) {
        primaryLabel.textContent = config.primaryLabel;
    }
    if (supportLabel) {
        supportLabel.textContent = config.supportLabel;
    }

    nav.querySelectorAll('.admin-tab').forEach((button) => {
        const buttonTabId = String(button.dataset.tab || '').trim().toLowerCase();
        button.hidden = !allowedTabs.has(buttonTabId);
    });

    if (primaryGroup) {
        primaryGroup.hidden = !(config.primaryTabs || []).length;
    }
    if (supportGroup) {
        supportGroup.hidden = !(config.supportTabs || []).length;
    }

    nav.hidden = allowedTabs.size <= 1;

    return config;
}

function canReuseRecentAnalyticsDashboard(reason = '') {
    const normalizedReason = String(reason || '').trim().toLowerCase();
    if (normalizedReason !== 're-enter') {
        return false;
    }

    if (!analyticsRuntime.initialized || !analyticsRuntime.lastLoadedAt) {
        return false;
    }

    const contextKey = getAnalyticsAIContextKey();
    if (!contextKey || analyticsRuntime.lastLoadedContextKey !== contextKey) {
        return false;
    }

    return (Date.now() - analyticsRuntime.lastLoadedAt) <= ANALYTICS_REENTRY_REFRESH_TTL_MS;
}

async function initAnalyticsModule() {
    console.log('[Analytics] Initializing...');
    analyticsRuntime.moduleActive = true;

    const routeState = typeof window.getAnalyticsRouteState === 'function'
        ? window.getAnalyticsRouteState()
        : {};
    const initialView = String(routeState?.view || '').trim().toLowerCase();
    if (initialView && typeof switchAnalyticsTab === 'function') {
        switchAnalyticsTab(initialView, { syncRoute: false, sectionId: routeState?.sectionId || '' });
    }

    initAnalyticsTabIndicator();
    updateAnalyticsPanelNotes();
    syncAnalyticsAdvancedWorkspaceUI();
    bindAnalyticsAdvancedWorkspaceToggle();

    try {
        const reloadReason = analyticsRuntime.initialized ? 're-enter' : 'initial-load';
        const currentContextKey = getAnalyticsAIContextKey();
        if (!analyticsRuntime.initialized) {
            TrackingSDK.init();
        }

        setupAnalyticsEvents();
        setupRealtimeSubscriptions();
        ensureAnalyticsAutoRefreshState();
        await ensureAnalyticsAdminCookieSession();

        if (analyticsRuntime.reloadPromise && analyticsRuntime.reloadContextKey === currentContextKey) {
            await analyticsRuntime.reloadPromise;
        } else if (!canReuseRecentAnalyticsDashboard(reloadReason)) {
            await reloadAnalyticsDashboard({
                reason: reloadReason
            });
        }
        await window.restoreAnalyticsRouteState?.({ focus: true });
        window.dispatchEvent(new Event('resize'));

        analyticsRuntime.initialized = true;
        console.log('[Analytics] Initialized successfully');
    } catch (error) {
        console.error('[Analytics] Init error:', error);
    }
}

function setupRealtimeSubscriptions() {
    if (analyticsRuntime.realtimeBound) {
        return;
    }

    try {
        const usersChannel = getAnalyticsSupabaseClient().channel('analytics-users')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'profiles' },
                () => {
                    if (!analyticsRuntime.moduleActive) return;
                    console.log('[Analytics] New user detected');
                    animateKPIIncrement('kpiMauValue');
                    animateKPIIncrement('kpiNewUsersValue');
                }
            )
            .subscribe();

        const commentsChannel = getAnalyticsSupabaseClient().channel('analytics-comments')
            .on(
                'postgres_changes',
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
    } catch (error) {
        console.error('[Analytics] Realtime subscription error:', error);
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
        } catch (error) {
            console.warn('[Analytics] Failed to remove realtime channel:', error);
        }
    });

    analyticsRuntime.realtimeChannels = [];
    analyticsRuntime.realtimeBound = false;
}

function animateKPIIncrement(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const currentText = element.textContent;
    const currentNum = parseFloat(currentText.replace(/[^\d.]/g, '')) || 0;
    const suffix = currentText.match(/[a-zA-Z]+$/)?.[0] || '';

    element.classList.add('kpi-pulse');

    if (suffix === 'w') {
        element.textContent = ((currentNum * 10000 + 1) / 10000).toFixed(1) + 'w';
    } else if (suffix === 'k') {
        element.textContent = ((currentNum * 1000 + 1) / 1000).toFixed(1) + 'k';
    } else {
        element.textContent = Math.round(currentNum + 1).toString();
    }

    setTimeout(() => {
        element.classList.remove('kpi-pulse');
    }, 600);
}

function setupAnalyticsEvents() {
    if (analyticsRuntime.eventsBound) {
        return;
    }

    document.querySelectorAll('.chart-period-selector .period-btn').forEach((button) => {
        button.addEventListener('click', async function () {
            const days = parseInt(this.dataset.days, 10);
            document.querySelectorAll('.chart-period-selector .period-btn').forEach((node) => node.classList.remove('active'));
            this.classList.add('active');
            await loadUserTrendChart(days);
        });
    });

    bindAnalyticsAIWorkspaceEvents();
    window.addEventListener('scroll', window.scheduleAnalyticsOperatingFocusSectionRefresh, { passive: true });
    window.addEventListener('resize', window.scheduleAnalyticsOperatingFocusSectionRefresh);
    analyticsRuntime.eventsBound = true;
}

function switchAnalyticsTab(tabId, options = {}) {
    const nav = document.getElementById('analyticsTabsNav');
    if (!nav) return;
    const normalizedTabId = String(tabId || 'overview').trim().toLowerCase() || 'overview';
    const preferredModuleId = getActiveAnalyticsSidebarModuleId();
    const scopeConfig = syncAnalyticsTabScope(normalizedTabId, { preferredModuleId }) || getAnalyticsScopeConfigForTab(normalizedTabId, { preferredModuleId });
    const primaryTabs = new Set(scopeConfig.primaryTabs || []);
    const supportTabs = new Set(scopeConfig.supportTabs || []);

    nav.querySelectorAll('.admin-tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === normalizedTabId);
    });

    nav.querySelectorAll('.analytics-tab-group__label[data-analytics-tab-group-trigger]').forEach((button) => {
        const groupId = String(button.dataset.analyticsTabGroupTrigger || '').trim().toLowerCase();
        const isActive = groupId === 'primary'
            ? primaryTabs.has(normalizedTabId)
            : groupId === 'support'
                ? supportTabs.has(normalizedTabId)
                : false;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    window.syncAdminStudioAnalyticsSidebar?.(normalizedTabId, { syncUrl: false, preferredModuleId: scopeConfig.scopeId });

    const activeTab = nav.querySelector('.admin-tab.active');
    if (activeTab) {
        window.updateAdminTabIndicator(activeTab);
    } else {
        nav.style.setProperty('--admin-tab-indicator-width', '0px');
        nav.style.setProperty('--admin-tab-indicator-left', '0px');
    }

    document.querySelectorAll('.analytics-tab-content').forEach((content) => {
        content.classList.remove('active');
    });

    const activeContent = document.getElementById(`analytics-tab-${normalizedTabId}`);
    if (activeContent) {
        activeContent.classList.add('active');
        window.dispatchEvent(new Event('resize'));
    }

    if (options.syncRoute !== false && typeof window.syncAnalyticsRouteState === 'function') {
        window.syncAnalyticsRouteState({
            view: normalizedTabId,
            sectionId: String(options.sectionId || '').trim()
        });
    }

    window.renderAnalyticsBusinessCenterShell?.();
    window.refreshAnalyticsSectionNavigatorActiveState?.();
    window.renderAnalyticsOperatingFocusWorkspace?.();
    window.scheduleAnalyticsOperatingFocusSectionRefresh?.();
}

function initAnalyticsTabIndicator() {
    const nav = document.getElementById('analyticsTabsNav');
    if (!nav) return;

    const activeTabId = nav.querySelector('.admin-tab.active')?.dataset?.tab || 'overview';
    syncAnalyticsTabScope(activeTabId, { preferredModuleId: getActiveAnalyticsSidebarModuleId() });
    const activeTab = nav.querySelector('.admin-tab.active');
    if (activeTab) {
        window.updateAdminTabIndicator(activeTab);
    }
}

function destroyAnalyticsCharts() {
    [
        userTrendChart,
        channelChart,
        contentTrendChart,
        communityChart,
        pointsDistributionChart,
        redemptionFunnelChart,
        productTrendChart,
        funnelChart,
        geoChart
    ].forEach((instance) => {
        try {
            instance?.destroy?.();
        } catch (error) {
            console.warn('[Analytics] Failed to destroy chart instance:', error);
        }
    });

    userTrendChart = null;
    channelChart = null;
    contentTrendChart = null;
    communityChart = null;
    pointsDistributionChart = null;
    redemptionFunnelChart = null;
    productTrendChart = null;
    funnelChart = null;
    geoChart = null;
}

async function reloadAnalyticsDashboard(options = {}) {
    const reason = String(options?.reason || '').trim().toLowerCase();
    const force = options?.force === true;
    const days = getAnalyticsRangeDays();
    const cohortWeeks = getAnalyticsCohortWeeks(days);
    const contextKey = getAnalyticsAIContextKey();

    if (!force && analyticsRuntime.reloadPromise && analyticsRuntime.reloadContextKey === contextKey) {
        return analyticsRuntime.reloadPromise;
    }

    const requestId = analyticsRuntime.reloadRequestId + 1;
    analyticsRuntime.reloadRequestId = requestId;
    analyticsRuntime.reloadContextKey = contextKey;

    const reloadPromise = (async () => {
        resetAnalyticsDerivedContext(contextKey);

        const phases = [
            [
                updateOnlineUsers(),
                loadOverviewStats(),
                loadOverviewDutyBoard(),
                loadOverviewOperatingNavigator(),
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
                loadProductAlerts(),
                loadProductOverview(),
                loadProductRankings(),
                loadProductFunnel(),
                loadProductHealth(),
                loadProductDetailPanel(),
                loadOperationsCockpit(),
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

        for (let index = 0; index < phases.length; index += 1) {
            await Promise.allSettled(phases[index]);
            updateLastUpdateTime();
            if (index < phases.length - 1) {
                await waitForAnalyticsPaint(2);
            }
        }

        updateLastUpdateTime();

        if (requestId === analyticsRuntime.reloadRequestId) {
            analyticsRuntime.lastLoadedAt = Date.now();
            analyticsRuntime.lastLoadedContextKey = contextKey;
            analyticsRuntime.lastReloadReason = reason;
        }

        return true;
    })();

    analyticsRuntime.reloadPromise = reloadPromise;

    try {
        return await reloadPromise;
    } finally {
        if (analyticsRuntime.reloadPromise === reloadPromise) {
            analyticsRuntime.reloadPromise = null;
        }
    }
}

function teardownAnalyticsModule(options = {}) {
    analyticsRuntime.moduleActive = false;
    stopAutoRefresh();
    teardownRealtimeSubscriptions();
    if (options?.destroyCharts === true) {
        destroyAnalyticsCharts();
    }
}

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
        return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
        } catch (error) {
            console.warn('[Tracking] Failed to track event:', error);
            return null;
        }
    },

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

let previousValues = {
    dau: null,
    comments: null,
    points: null
};

async function checkForAnomalies() {
    const alerts = [];

    try {
        const dauEl = document.getElementById('kpiDauValue');
        const commentsEl = document.getElementById('kpiCommentsValue');
        const currentDau = dauEl ? parseInt(dauEl.textContent, 10) || 0 : 0;
        const currentComments = commentsEl ? parseInt(commentsEl.textContent, 10) || 0 : 0;

        if (previousValues.dau !== null && previousValues.dau > 0) {
            const dauChange = ((currentDau - previousValues.dau) / previousValues.dau) * 100;
            if (dauChange < -50) {
                alerts.push({
                    type: 'dau_drop',
                    text: '业务 DAU 异常下降',
                    value: `${dauChange.toFixed(0)}%`
                });
            }
        }

        if (currentDau === 0 && previousValues.dau > 5) {
            alerts.push({
                type: 'zero_dau',
                text: '业务 DAU 降为 0',
                value: '需要关注'
            });
        }

        previousValues.dau = currentDau;
        previousValues.comments = currentComments;
        displayAlerts(alerts);
    } catch (error) {
        console.error('[Anomaly] Detection error:', error);
    }
}

function displayAlerts(alerts) {
    const area = document.getElementById('anomalyAlertsArea');
    const list = document.getElementById('alertsList');
    if (!area || !list) return;

    if (!alerts.length) {
        setAnalyticsVisibility(area, true);
        return;
    }

    setAnalyticsVisibility(area, false);
    list.innerHTML = alerts.map((alert) => `
        <div class="alert-item">
            <i class="fas fa-exclamation-circle"></i>
            <span class="alert-text">${alert.text}</span>
            <span class="alert-value">${alert.value}</span>
        </div>
    `).join('');
}

function dismissAllAlerts() {
    const area = document.getElementById('anomalyAlertsArea');
    if (area) {
        setAnalyticsVisibility(area, true);
    }
}

const originalAnalyticsRefresh = refreshAllAnalytics;
refreshAllAnalytics = async function (...args) {
    await originalAnalyticsRefresh(...args);
    setTimeout(checkForAnomalies, 500);
};

if (typeof window !== 'undefined') {
    window.TrackingSDK = TrackingSDK;
}

window.switchAnalyticsTab = switchAnalyticsTab;
window.initAnalyticsModule = initAnalyticsModule;
window.toggleAnalyticsAdvancedTools = toggleAnalyticsAdvancedTools;
window.reloadAnalyticsDashboard = reloadAnalyticsDashboard;
window.teardownAnalyticsModule = teardownAnalyticsModule;
window.refreshAllAnalytics = refreshAllAnalytics;
window.dismissAllAlerts = dismissAllAlerts;
