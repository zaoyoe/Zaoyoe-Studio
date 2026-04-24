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
            : (normalizedTabId === 'product' || normalizedTabId === 'product-detail' || normalizedTabId === 'ops' || normalizedTabId === 'monetization' || normalizedTabId === 'verify'
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
                primaryTabs: ['product', 'product-detail', 'ops'],
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

function setAnalyticsChromeSectionHidden(bodyId = '', hidden = false) {
    const body = document.getElementById(bodyId);
    const section = body?.closest?.('section') || body;
    if (!section) {
        return false;
    }

    if (typeof setAnalyticsVisibility === 'function') {
        setAnalyticsVisibility(section, hidden);
    } else {
        section.hidden = hidden;
    }
    section.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    return true;
}

function syncAnalyticsChromeVisibility(tabId = '') {
    const normalizedTabId = String(tabId || 'overview').trim().toLowerCase() || 'overview';
    const hideGlobalChrome = normalizedTabId === 'product-detail';

    setAnalyticsChromeSectionHidden('analyticsBusinessCenterShell', hideGlobalChrome);
    setAnalyticsChromeSectionHidden('analyticsOperatingFocusWorkspace', hideGlobalChrome);
}

function normalizeAnalyticsTabId(tabId = '') {
    return String(tabId || 'overview').trim().toLowerCase() || 'overview';
}

function getActiveAnalyticsTabId() {
    return normalizeAnalyticsTabId(document.querySelector('#analyticsTabsNav .admin-tab.active')?.dataset?.tab);
}

function getAnalyticsLoadedTabSet(contextKey = getAnalyticsAIContextKey()) {
    const normalizedContextKey = String(contextKey || '').trim();
    if (!normalizedContextKey) {
        return new Set();
    }

    if (!analyticsRuntime.loadedTabsByContext || typeof analyticsRuntime.loadedTabsByContext !== 'object') {
        analyticsRuntime.loadedTabsByContext = {};
    }
    if (!Array.isArray(analyticsRuntime.loadedTabsByContext[normalizedContextKey])) {
        analyticsRuntime.loadedTabsByContext[normalizedContextKey] = [];
    }

    return new Set(analyticsRuntime.loadedTabsByContext[normalizedContextKey]);
}

function markAnalyticsTabLoaded(tabId = '', contextKey = getAnalyticsAIContextKey()) {
    const normalizedContextKey = String(contextKey || '').trim();
    const normalizedTabId = normalizeAnalyticsTabId(tabId);
    if (!normalizedContextKey || !normalizedTabId) {
        return;
    }

    const loadedTabs = getAnalyticsLoadedTabSet(normalizedContextKey);
    loadedTabs.add(normalizedTabId);
    analyticsRuntime.loadedTabsByContext[normalizedContextKey] = Array.from(loadedTabs);
}

function isAnalyticsTabLoaded(tabId = '', contextKey = getAnalyticsAIContextKey()) {
    return getAnalyticsLoadedTabSet(contextKey).has(normalizeAnalyticsTabId(tabId));
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

    if (!isAnalyticsTabLoaded(getActiveAnalyticsTabId(), contextKey)) {
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
        switchAnalyticsTab(initialView, {
            syncRoute: false,
            sectionId: routeState?.sectionId || '',
            ensureTabLoad: false,
            ensureProductDetailLoad: false
        });
    }
    if (initialView === 'product-detail' && routeState?.productId) {
        window.primeAnalyticsProductDetailFromRouteState?.(routeState);
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

async function handleAdminAnalyticsSiteChange(detail = {}) {
    const normalizedDetail = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
    const activeTabId = normalizeAnalyticsTabId(
        normalizedDetail.activeTabId
        || normalizedDetail.analyticsTab
        || normalizedDetail.tab
        || document.querySelector('#analyticsTabsNav .admin-tab.active')?.dataset?.tab
        || ''
    );
    const preferredModuleId = String(
        normalizedDetail.activeModuleId
        || getActiveAnalyticsSidebarModuleId()
        || ''
    ).trim().toLowerCase();

    analyticsRuntime.moduleActive = true;
    syncAnalyticsTabScope(activeTabId, { preferredModuleId });

    if (analyticsRuntime.initialized) {
        await reloadAnalyticsDashboard({
            reason: 'site-change',
            activeTabId,
            force: true
        });
        return true;
    }

    await initAnalyticsModule();
    return true;
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
    const normalizedTabId = normalizeAnalyticsTabId(tabId);
    const previousActiveTabId = String(nav.querySelector('.admin-tab.active')?.dataset?.tab || '').trim().toLowerCase();
    if (normalizedTabId === 'product-detail') {
        window.primeAnalyticsProductDetailSkeletonOnEntry?.({
            sectionId: String(options.sectionId || '').trim()
        });
    }
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
        syncAnalyticsChromeVisibility(normalizedTabId);
        window.dispatchEvent(new Event('resize'));
    } else {
        syncAnalyticsChromeVisibility(normalizedTabId);
    }

    if (options.syncRoute !== false && typeof window.syncAnalyticsRouteState === 'function') {
        window.syncAnalyticsRouteState({
            view: normalizedTabId,
            sectionId: String(options.sectionId || '').trim()
        });
    }

    if (normalizedTabId === 'product-detail' && options.ensureProductDetailLoad !== false) {
        const ensureResult = window.ensureAnalyticsProductDetailTabReady?.({
            sectionId: String(options.sectionId || '').trim(),
            focus: false,
            syncRoute: true
        });

        if (!ensureResult && typeof window.reloadAnalyticsDashboard === 'function') {
            const shouldForceReload = previousActiveTabId !== 'product-detail';
            void window.reloadAnalyticsDashboard({
                reason: 'product-detail-tab-focus',
                activeTabId: 'product-detail',
                force: shouldForceReload
            });
        }
    }

    if (
        normalizedTabId !== 'product-detail'
        && options.ensureTabLoad !== false
        && analyticsRuntime.initialized
        && !isAnalyticsTabLoaded(normalizedTabId)
        && typeof window.reloadAnalyticsDashboard === 'function'
    ) {
        void window.reloadAnalyticsDashboard({
            reason: `${normalizedTabId}-tab-focus`,
            activeTabId: normalizedTabId
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
    syncAnalyticsChromeVisibility(activeTabId);
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

function buildAnalyticsTaskPhases(phaseTaskIds = [], taskFactories = {}, seenTaskIds = new Set()) {
    return (Array.isArray(phaseTaskIds) ? phaseTaskIds : [])
        .map((taskIds) => (Array.isArray(taskIds) ? taskIds : [])
            .filter((taskId) => Object.prototype.hasOwnProperty.call(taskFactories, taskId))
            .filter((taskId) => {
                if (seenTaskIds.has(taskId)) {
                    return false;
                }
                seenTaskIds.add(taskId);
                return true;
            })
            .map((taskId) => taskFactories[taskId]))
        .filter((phase) => phase.length > 0);
}

async function runAnalyticsTaskPhases(phases = [], options = {}) {
    const requestId = Number(options.requestId || 0);
    const contextKey = String(options.contextKey || '').trim();
    const activeTabId = normalizeAnalyticsTabId(options.activeTabId || '');
    const stopIfStale = options.stopIfStale === true;

    for (let index = 0; index < phases.length; index += 1) {
        if (
            stopIfStale
            && (
                requestId !== analyticsRuntime.reloadRequestId
                || (contextKey && analyticsRuntime.reloadContextKey !== contextKey)
                || (activeTabId && getActiveAnalyticsTabId() !== activeTabId)
            )
        ) {
            return false;
        }

        const phasePromises = phases[index].map((runTask) => Promise.resolve().then(runTask));
        await Promise.allSettled(phasePromises);
        updateLastUpdateTime();
        if (index < phases.length - 1) {
            await waitForAnalyticsPaint(2);
        }
    }

    return true;
}

function scheduleAnalyticsDeferredTaskPhases(options = {}) {
    const phases = Array.isArray(options.phases) ? options.phases : [];
    if (!phases.length) {
        return;
    }

    window.setTimeout(() => {
        void (async () => {
            await waitForAnalyticsPaint(2);
            await runAnalyticsTaskPhases(phases, {
                requestId: options.requestId,
                contextKey: options.contextKey,
                activeTabId: options.activeTabId,
                stopIfStale: true
            });
        })().catch((error) => {
            console.warn('[Analytics] Deferred analytics panels failed:', error);
        });
    }, 0);
}

async function reloadAnalyticsDashboard() {
    const options = arguments[0] || {};
    const reason = String(options?.reason || '').trim().toLowerCase();
    const force = options?.force === true;
    const days = getAnalyticsRangeDays();
    const cohortWeeks = getAnalyticsCohortWeeks(days);
    const contextKey = getAnalyticsAIContextKey();
    const activeTabId = normalizeAnalyticsTabId(
        options?.activeTabId
        || document.querySelector('#analyticsTabsNav .admin-tab.active')?.dataset?.tab
        || ''
    );

    if (
        !force
        && analyticsRuntime.reloadPromise
        && analyticsRuntime.reloadContextKey === contextKey
        && analyticsRuntime.reloadTabId === activeTabId
    ) {
        return analyticsRuntime.reloadPromise;
    }

    const requestId = analyticsRuntime.reloadRequestId + 1;
    analyticsRuntime.reloadRequestId = requestId;
    analyticsRuntime.reloadContextKey = contextKey;
    analyticsRuntime.reloadTabId = activeTabId;

    const reloadPromise = (async () => {
        resetAnalyticsDerivedContext(contextKey);

        const taskFactories = {
            updateOnlineUsers: () => updateOnlineUsers({ force }),
            loadOverviewStats: () => loadOverviewStats(),
            loadOverviewDutyBoard: () => loadOverviewDutyBoard(),
            loadOverviewOperatingNavigator: () => loadOverviewOperatingNavigator(),
            loadOverviewBusinessMix: () => loadOverviewBusinessMix(),
            loadUserTrendChart: () => loadUserTrendChart(days),
            loadChannelChart: () => loadChannelChart(days),
            loadGeoDistribution: () => loadGeoDistribution(),
            loadContentTrendChart: () => loadContentTrendChart(days),
            loadTopContent: () => loadTopContent(days),
            loadProductAlerts: () => loadProductAlerts(),
            loadProductOverview: () => loadProductOverview(),
            loadProductRankings: () => loadProductRankings(),
            loadProductFunnel: () => loadProductFunnel(),
            loadProductHealth: () => loadProductHealth(),
            loadProductDetailPanel: () => loadProductDetailPanel(),
            loadOperationsCockpit: () => loadOperationsCockpit(),
            loadActivityHeatmap: () => loadActivityHeatmap(days),
            loadTopContributors: () => loadTopContributors(),
            loadCommunityChart: () => loadCommunityChart(days),
            loadConversionFunnel: () => loadConversionFunnel(days),
            loadRetentionCohort: () => loadRetentionCohort(cohortWeeks),
            loadPointsFlow: () => loadPointsFlow(days),
            loadPointsStats: () => loadPointsStats(days),
            loadPointsDistribution: () => loadPointsDistribution(),
            loadPointsLeaderboard: () => loadPointsLeaderboard(),
            loadRedemptionFunnel: () => loadRedemptionFunnel(days),
            loadVerifyServiceSummary: () => loadVerifyServiceSummary(),
            loadGrowthSummary: () => loadGrowthSummary(),
            loadEventFunnelPanels: () => loadEventFunnelPanels()
        };
        const phaseTaskConfig = (() => {
            switch (activeTabId) {
                case 'product':
                    return {
                        critical: [
                            ['updateOnlineUsers', 'loadProductAlerts', 'loadProductOverview', 'loadProductRankings'],
                            ['loadProductFunnel', 'loadProductHealth']
                        ]
                    };
                case 'product-detail':
                    return {
                        critical: [
                            ['loadProductDetailPanel']
                        ]
                    };
                case 'ops':
                    return {
                        critical: [
                            ['updateOnlineUsers', 'loadOverviewOperatingNavigator', 'loadOperationsCockpit']
                        ]
                    };
                case 'content':
                    return {
                        critical: [
                            ['updateOnlineUsers', 'loadTopContent', 'loadContentTrendChart'],
                            ['loadActivityHeatmap', 'loadConversionFunnel']
                        ]
                    };
                case 'growth':
                    return {
                        critical: [
                            ['updateOnlineUsers', 'loadGrowthSummary']
                        ],
                        deferred: [
                            ['loadUserTrendChart'],
                            ['loadEventFunnelPanels'],
                            ['loadTopContributors', 'loadCommunityChart', 'loadRetentionCohort']
                        ]
                    };
                case 'monetization':
                    return {
                        critical: [
                            ['updateOnlineUsers', 'loadPointsFlow', 'loadPointsStats', 'loadEventFunnelPanels'],
                            ['loadPointsDistribution', 'loadPointsLeaderboard', 'loadRedemptionFunnel']
                        ]
                    };
                case 'verify':
                    return {
                        critical: [
                            ['updateOnlineUsers', 'loadVerifyServiceSummary', 'loadEventFunnelPanels']
                        ]
                    };
                case 'overview':
                default:
                    return {
                        critical: [
                            ['updateOnlineUsers', 'loadOverviewStats', 'loadOverviewDutyBoard', 'loadOverviewOperatingNavigator', 'loadOverviewBusinessMix'],
                            ['loadUserTrendChart', 'loadChannelChart', 'loadGeoDistribution']
                        ]
                    };
            }
        })();
        const seenTaskIds = new Set();
        const phaseTaskIds = Array.isArray(phaseTaskConfig) ? phaseTaskConfig : phaseTaskConfig.critical;
        const deferredPhaseTaskIds = Array.isArray(phaseTaskConfig) ? [] : phaseTaskConfig.deferred;
        const phases = buildAnalyticsTaskPhases(phaseTaskIds, taskFactories, seenTaskIds);
        const deferredPhases = buildAnalyticsTaskPhases(deferredPhaseTaskIds, taskFactories, seenTaskIds);

        await runAnalyticsTaskPhases(phases, {
            requestId,
            contextKey,
            activeTabId,
            stopIfStale: true
        });

        if (deferredPhases.length > 0) {
            scheduleAnalyticsDeferredTaskPhases({
                phases: deferredPhases,
                requestId,
                contextKey,
                activeTabId
            });
        }

        if (activeTabId === 'product-detail') {
            window.settleAnalyticsProductDetailPendingState?.({
                activeTabId
            });
        }

        updateLastUpdateTime();

        if (requestId === analyticsRuntime.reloadRequestId) {
            analyticsRuntime.lastLoadedAt = Date.now();
            analyticsRuntime.lastLoadedContextKey = contextKey;
            analyticsRuntime.lastReloadReason = reason;
            markAnalyticsTabLoaded(activeTabId, contextKey);
        }

        if (typeof window.emitAnalyticsCommandCenterInventorySummaryUpdate === 'function') {
            window.emitAnalyticsCommandCenterInventorySummaryUpdate();
        }

        return true;
    })();

    analyticsRuntime.reloadPromise = reloadPromise;

    try {
        return await reloadPromise;
    } finally {
        if (analyticsRuntime.reloadPromise === reloadPromise) {
            analyticsRuntime.reloadPromise = null;
            analyticsRuntime.reloadTabId = '';
        }
    }
}

function teardownAnalyticsModule() {
    const options = arguments[0] || {};
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
window.handleAdminAnalyticsSiteChange = handleAdminAnalyticsSiteChange;
window.toggleAnalyticsAdvancedTools = toggleAnalyticsAdvancedTools;
window.reloadAnalyticsDashboard = reloadAnalyticsDashboard;
window.teardownAnalyticsModule = teardownAnalyticsModule;
window.refreshAllAnalytics = refreshAllAnalytics;
window.dismissAllAlerts = dismissAllAlerts;
