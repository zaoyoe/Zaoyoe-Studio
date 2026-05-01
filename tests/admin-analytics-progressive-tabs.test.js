const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function extractCaseBody(source, caseLabel) {
    const startMarker = `case '${caseLabel}':`;
    const startIndex = source.indexOf(startMarker);
    assert.notEqual(startIndex, -1, `missing ${startMarker}`);
    const rest = source.slice(startIndex + startMarker.length);
    const nextCaseMatch = rest.match(/\n\s+case\s+'/);
    const defaultMatch = rest.match(/\n\s+default:/);
    const nextCaseIndex = nextCaseMatch ? startIndex + startMarker.length + nextCaseMatch.index : -1;
    const defaultIndex = defaultMatch ? startIndex + startMarker.length + defaultMatch.index : -1;
    const endCandidates = [nextCaseIndex, defaultIndex].filter((index) => index !== -1);
    const endIndex = endCandidates.length ? Math.min(...endCandidates) : source.length;
    return source.slice(startIndex, endIndex);
}

function getSegment(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + 1);
    assert.notEqual(start, -1, `Expected segment start ${startMarker}`);
    assert.notEqual(end, -1, `Expected segment end ${endMarker}`);
    return source.slice(start, end);
}

test('analytics lifecycle loads only the active tab phase set', () => {
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');
    const mainAnalyticsSource = readRepoFile('admin-analytics.js');

    const requiredMarkers = [
        'function normalizeAnalyticsTabId(tabId = \'\') {',
        'function isAnalyticsTabLoaded(tabId = \'\', contextKey = getAnalyticsAIContextKey()) {',
        'function markAnalyticsTabLoaded(tabId = \'\', contextKey = getAnalyticsAIContextKey()) {',
        'function scheduleAnalyticsDeferredTaskPhases(options = {}) {',
        'function settleAnalyticsRefreshContent(options = {}) {',
        'function waitForAnalyticsRefreshContentSettled(options = {}) {',
        'function clearAnalyticsStaleRefreshContent(activeTabId = getActiveAnalyticsTabId()) {',
        'function getAnalyticsRefreshContentSettleTimeoutMs(options = {}) {',
        'options.ensureTabLoad !== false',
        'activeTabId: normalizedTabId',
        'stopIfStale: true',
        'const contentSettled = await settleAnalyticsRefreshContent({',
        'waitForDeferred: phaseTaskConfig.waitForDeferred !== false',
        'if (!contentSettled) {',
        'markAnalyticsTabLoaded(activeTabId, contextKey);',
        'markAnalyticsTiming(`${activeTabId}:reload:start`,',
        'markAnalyticsTiming(`${activeTabId}:critical:end`,',
        'measureAnalyticsTiming(',
        'markAnalyticsTiming(`${activeTabId}:content:settled`,'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(lifecycleSource.includes(marker), true, `js/admin-analytics-lifecycle.js should contain ${marker}`);
    }

    assert.equal(
        mainAnalyticsSource.includes('loadedTabsByContext: {},'),
        true,
        'admin-analytics.js should track which analytics tabs are loaded for each context'
    );
    assert.equal(
        mainAnalyticsSource.includes('refreshIndicatorBusyCount: 0,'),
        true,
        'admin-analytics.js should track refresh indicator busy depth'
    );

    const overviewCase = extractCaseBody(lifecycleSource, 'overview');
    for (const crossTabTask of [
        'loadTopContent',
        'loadProductAlerts',
        'loadOperationsCockpit',
        'loadGrowthSummary',
        'loadPointsFlow',
        'loadVerifyServiceSummary',
        'loadEventFunnelPanels'
    ]) {
        assert.equal(
            overviewCase.includes(crossTabTask),
            false,
            `overview reload should not include hidden-tab task ${crossTabTask}`
        );
    }

    const productCase = extractCaseBody(lifecycleSource, 'product');
    assert.equal(productCase.includes('loadProductOverview'), true);
    assert.equal(productCase.includes('loadGrowthSummary'), false);
    assert.equal(productCase.includes('loadVerifyServiceSummary'), false);
});

test('product overview reuses the shared dashboard bundle request variant', () => {
    const panelLoadersSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const overviewStart = panelLoadersSource.indexOf('async function loadProductOverview()');
    const rankingsStart = panelLoadersSource.indexOf('function syncAnalyticsProductRankingsMeta', overviewStart);
    assert.notEqual(overviewStart, -1, 'product overview loader should exist');
    assert.notEqual(rankingsStart, -1, 'product rankings section should follow product overview');

    const overviewSegment = panelLoadersSource.slice(overviewStart, rankingsStart);
    assert.equal(
        overviewSegment.includes('const bundle = await getAnalyticsProductDashboardBundle({ limit: 10 });'),
        true,
        'product overview should share the same dashboard bundle cache key as alerts, rankings, and health'
    );
});

test('product funnel reuses the shared dashboard bundle instead of loading a second product dataset', () => {
    const panelLoadersSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const funnelStart = panelLoadersSource.indexOf('async function loadProductFunnel()');
    const healthStart = panelLoadersSource.indexOf('async function loadProductHealth()', funnelStart);
    assert.notEqual(funnelStart, -1, 'product funnel loader should exist');
    assert.notEqual(healthStart, -1, 'product health loader should follow product funnel');

    const funnelSegment = panelLoadersSource.slice(funnelStart, healthStart);
    assert.equal(
        funnelSegment.includes('const bundle = await getAnalyticsProductDashboardBundle({ limit: 10 });'),
        true,
        'product funnel should reuse the cached product dashboard bundle'
    );
    assert.equal(
        funnelSegment.includes('getAnalyticsProductFunnelBundle({ limit: 6 })'),
        false,
        'product funnel should not request a separate product funnel bundle on the page path'
    );
    assert.equal(
        funnelSegment.includes("getAnalyticsProductBundlePayloadOrThrow(bundle, 'funnelSummary'"),
        true,
        'product funnel should read the dashboard funnel summary segment'
    );
});

test('overview growth entry warms product signals outside the critical path', () => {
    const analyticsCoreSource = readRepoFile('admin-analytics.js');
    const panelLoadersSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const navigatorStart = panelLoadersSource.indexOf('async function loadOverviewOperatingNavigator()');
    const businessMixStart = panelLoadersSource.indexOf('function renderOverviewBusinessMixSummary', navigatorStart);
    assert.notEqual(navigatorStart, -1, 'overview operating navigator should exist');
    assert.notEqual(businessMixStart, -1, 'business mix helpers should follow the navigator');

    const navigatorSegment = panelLoadersSource.slice(navigatorStart, businessMixStart);
    assert.equal(
        navigatorSegment.includes('scheduleProductDashboardWarm'),
        true,
        'overview navigator should schedule product dashboard enrichment separately'
    );
    assert.equal(
        navigatorSegment.includes("['productDashboardBundle', getAnalyticsProductDashboardBundle()]"),
        false,
        'overview navigator critical requests should not wait for the product dashboard bundle'
    );

    assert.equal(
        analyticsCoreSource.includes('async function getOverviewBusinessMixProductSignalsData(options = {})'),
        true,
        'overview business mix should expose a product-only warmup request'
    );
    const productSignalsSegment = getSegment(
        analyticsCoreSource,
        'async function getOverviewBusinessMixProductSignalsData(options = {})',
        'async function getOverviewBusinessMixSummaryData(options = {})'
    );
    assert.equal(
        productSignalsSegment.includes('const productDashboardBundle = await getAnalyticsProductDashboardBundle({'),
        true,
        'overview business mix product warmup should reuse the shared dashboard bundle'
    );
    assert.equal(
        productSignalsSegment.includes('getAnalyticsProductSummaryBundle({'),
        false,
        'overview business mix product warmup should not request a separate summary bundle'
    );
    assert.equal(
        productSignalsSegment.includes('getAnalyticsProductRankBundle({'),
        false,
        'overview business mix product warmup should not request a separate rank bundle'
    );
    assert.equal(
        productSignalsSegment.includes('getAnalyticsProductHealthBundle({'),
        false,
        'overview business mix product warmup should not request a separate health bundle'
    );
    assert.equal(
        analyticsCoreSource.includes("const requestKey = includeProductSignals ? 'overviewBusinessMix' : 'overviewBusinessMixBase';"),
        true,
        'overview business mix should keep base and product-enriched derived caches separate'
    );

    const businessMixSegment = getSegment(
        panelLoadersSource,
        'async function loadOverviewBusinessMix()',
        'async function loadOverviewDutyBoard()'
    );
    assert.equal(
        businessMixSegment.includes('getOverviewBusinessMixSummaryData({ includeProductSignals: false })'),
        true,
        'overview business mix first paint should request base data without product signals'
    );
    assert.equal(
        businessMixSegment.includes('void scheduleOverviewBusinessMixProductSignalsWarm(summary, { requestId });'),
        true,
        'overview business mix should warm product signals after first paint'
    );

    const dutyBoardSegment = getSegment(
        panelLoadersSource,
        'async function loadOverviewDutyBoard()',
        'function renderVerifyServiceSummaryUnavailableState'
    );
    assert.equal(
        dutyBoardSegment.includes('getOverviewBusinessMixSummaryData({ includeProductSignals: false })'),
        true,
        'overview duty board should use the base business mix summary on the critical path'
    );
});

test('overview user trend waits for deferred panel hydration after the chart render path starts', () => {
    const panelLoadersSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const userTrendSegment = getSegment(
        panelLoadersSource,
        'async function loadUserTrendChart(days = 30)',
        'function getChannelBreakdownMetricMeta'
    );

    assert.equal(
        userTrendSegment.includes('const summaryHydrationPromise = hydrateAnalyticsUserTrendSummaryWindow({ trendRows: data, requestId });'),
        true,
        'user trend should start summary hydration after the chart data is available'
    );
    assert.equal(
        userTrendSegment.includes('hydrateAnalyticsUserTrendValuePanels({ days, trendRows: data, requestId })'),
        true,
        'user trend should hydrate product value panels after the chart render path'
    );
    assert.equal(
        userTrendSegment.includes('await Promise.allSettled(['),
        true,
        'user trend refresh lifecycle should wait until deferred hydration settles'
    );
});

test('command center inventory summary reuses dashboard cache and primes later', () => {
    const analyticsCoreSource = readRepoFile('admin-analytics.js');

    for (const marker of [
        'let analyticsCommandCenterInventoryPrimeTimerId = 0;',
        'let analyticsCommandCenterInventoryPrimePromise = null;',
        "const productDashboardBundle = getAnalyticsDerivedStateValue('productDashboardBundle');",
        "productSummaryBundle: getAnalyticsDerivedStateValue('productSummaryBundle') || productDashboardBundle",
        "productHealthBundle: getAnalyticsDerivedStateValue('productHealthBundle') || productDashboardBundle",
        'async function loadAnalyticsCommandCenterInventorySummary(options = {})',
        'const productDashboardBundle = await getAnalyticsProductDashboardBundle({',
        'limit: 10,',
        'function scheduleAnalyticsCommandCenterInventorySummaryPrime(options = {})',
        'scheduleAnalyticsCommandCenterInventorySummaryPrime(options);',
        'return emitAnalyticsCommandCenterInventorySummaryUpdate(currentSummary);'
    ]) {
        assert.equal(analyticsCoreSource.includes(marker), true, `admin analytics should contain ${marker}`);
    }

    const primeSegment = getSegment(
        analyticsCoreSource,
        'async function primeAnalyticsCommandCenterInventorySummary(options = {})',
        'function buildOverviewBusinessMixProductSignals'
    );
    assert.equal(
        primeSegment.includes('await Promise.all(['),
        false,
        'command center prime should not synchronously wait for product summary and health bundles'
    );
});

test('analytics refresh indicator follows the full split-module refresh lifecycle', () => {
    const runtimeControlsSource = readRepoFile('js/admin-analytics-runtime-controls.js');
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');

    for (const marker of [
        'function beginAnalyticsRefreshIndicator() {',
        "scopeId === 'growth-center' || scopeId === 'commerce-center'",
        "icon.classList.toggle('fa-spin', isBusy);",
        "button.setAttribute('aria-busy', isBusy ? 'true' : 'false');",
        'const refreshCompleted = await reloadAnalyticsDashboard({',
        "showToast('部分数据仍在加载，稍后会自动补齐', 'warning');",
        'window.beginAnalyticsRefreshIndicator = beginAnalyticsRefreshIndicator;',
        'window.syncAnalyticsRefreshIndicator = syncAnalyticsRefreshIndicator;'
    ]) {
        assert.equal(runtimeControlsSource.includes(marker), true, `runtime controls should contain ${marker}`);
    }

    for (const marker of [
        'const releaseRefreshIndicator = typeof window.beginAnalyticsRefreshIndicator === \'function\'',
        'const contentSettled = await settleAnalyticsRefreshContent({',
        'clearAnalyticsStaleRefreshContent(activeTabId);',
        'return waitForAnalyticsRefreshContentSettled({',
        'ANALYTICS_REFRESH_PENDING_SELECTOR',
        '.analytics-product-dashboard--skeleton',
        'function renderAnalyticsDelayedRefreshState(message =',
        '当前分区数据仍在加载，稍后会自动补齐。'
    ]) {
        assert.equal(lifecycleSource.includes(marker), true, `lifecycle should contain ${marker}`);
    }
});

test('analytics refresh cannot complete successfully while visible panels stay pending', () => {
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');

    for (const marker of [
        'completedWithoutRejectedTasks = false;',
        'console.warn(\'[Analytics] Panel task failed during refresh:\', result.reason);',
        'if (options.waitForDeferred === false) {',
        'void runAnalyticsDeferredTaskPhases(options);',
        'await waitForAnalyticsPaint(2);',
        'return true;',
        'function getAnalyticsVisibleRefreshPendingNodes(activeTabId = getActiveAnalyticsTabId()) {',
        'const ANALYTICS_VERIFY_STALE_CONTAINER_SELECTOR = [',
        'return isAnalyticsCompactMobileViewport() ? 45000 : 18000;',
        'function clearVerifyAnalyticsStaleRefreshContent() {',
        'const verifyTarget = node.closest?.(ANALYTICS_VERIFY_STALE_CONTAINER_SELECTOR);',
        'window.renderVerifyServiceSummaryUnavailableState(\'验证承接数据暂未返回，请稍后刷新或打开 Verify Monitor。\');',
        'verifyEventFunnel.innerHTML = renderAnalyticsStaleRefreshFallback(',
        '{ variant: \'error\' }',
        'requestId === analyticsRuntime.reloadRequestId && criticalPhasesCompleted && contentSettled',
        'return criticalPhasesCompleted && contentSettled;',
        'window.clearAnalyticsStaleRefreshContent = clearAnalyticsStaleRefreshContent;'
    ]) {
        assert.equal(lifecycleSource.includes(marker), true, `lifecycle should contain ${marker}`);
    }
});

test('analytics growth tab renders critical summary before deferred panels', () => {
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');
    const growthCase = extractCaseBody(lifecycleSource, 'growth');
    const criticalStart = growthCase.indexOf('critical:');
    const deferredStart = growthCase.indexOf('deferred:');
    assert.notEqual(criticalStart, -1, 'growth case should define a critical phase');
    assert.notEqual(deferredStart, -1, 'growth case should define deferred phases');
    assert.ok(
        deferredStart > criticalStart,
        'growth deferred phases should be declared after the critical phase'
    );

    const criticalBody = growthCase.slice(criticalStart, deferredStart);
    const deferredBody = growthCase.slice(deferredStart);

    for (const criticalTask of ['updateOnlineUsers', 'loadGrowthSummary']) {
        assert.equal(
            criticalBody.includes(criticalTask),
            true,
            `growth critical phase should include ${criticalTask}`
        );
    }

    for (const deferredTask of [
        'loadUserTrendChart',
        'loadEventFunnelPanels',
        'loadTopContributors',
        'loadCommunityChart',
        'loadRetentionCohort'
    ]) {
        assert.equal(
            criticalBody.includes(deferredTask),
            false,
            `growth critical phase should not wait for ${deferredTask}`
        );
        assert.equal(
            deferredBody.includes(deferredTask),
            true,
            `growth deferred phase should include ${deferredTask}`
        );
    }

    assert.equal(
        growthCase.includes('waitForDeferred: false'),
        true,
        'growth deferred phases should not block the refresh completion path'
    );
});
