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
    const nextCaseIndex = source.indexOf('\n                case ', startIndex + startMarker.length);
    const defaultIndex = source.indexOf('\n                default:', startIndex + startMarker.length);
    const endCandidates = [nextCaseIndex, defaultIndex].filter((index) => index !== -1);
    const endIndex = endCandidates.length ? Math.min(...endCandidates) : source.length;
    return source.slice(startIndex, endIndex);
}

test('analytics lifecycle loads only the active tab phase set', () => {
    const lifecycleSource = readRepoFile('js/admin-analytics-lifecycle.js');
    const mainAnalyticsSource = readRepoFile('admin-analytics.js');

    const requiredMarkers = [
        'function normalizeAnalyticsTabId(tabId = \'\') {',
        'function isAnalyticsTabLoaded(tabId = \'\', contextKey = getAnalyticsAIContextKey()) {',
        'function markAnalyticsTabLoaded(tabId = \'\', contextKey = getAnalyticsAIContextKey()) {',
        'function scheduleAnalyticsDeferredTaskPhases(options = {}) {',
        'options.ensureTabLoad !== false',
        'activeTabId: normalizedTabId',
        'stopIfStale: true',
        'markAnalyticsTabLoaded(activeTabId, contextKey);'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(lifecycleSource.includes(marker), true, `js/admin-analytics-lifecycle.js should contain ${marker}`);
    }

    assert.equal(
        mainAnalyticsSource.includes('loadedTabsByContext: {},'),
        true,
        'admin-analytics.js should track which analytics tabs are loaded for each context'
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
});
