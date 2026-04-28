const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunction(source, functionName) {
    const asyncMarker = `async function ${functionName}(`;
    const plainMarker = `function ${functionName}(`;
    const start = source.indexOf(asyncMarker) !== -1
        ? source.indexOf(asyncMarker)
        : source.indexOf(plainMarker);

    assert.notEqual(start, -1, `Expected to find ${functionName}`);

    const paramsStart = source.indexOf('(', start);
    const bodyStart = source.indexOf('{', paramsStart);
    assert.notEqual(paramsStart, -1, `Expected parameter list for ${functionName}`);
    assert.notEqual(bodyStart, -1, `Expected function body for ${functionName}`);

    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\') {
            escaped = true;
            continue;
        }

        if (inSingle) {
            if (char === '\'') inSingle = false;
            continue;
        }

        if (inDouble) {
            if (char === '"') inDouble = false;
            continue;
        }

        if (inTemplate) {
            if (char === '`') inTemplate = false;
            continue;
        }

        if (char === '\'') {
            inSingle = true;
            continue;
        }

        if (char === '"') {
            inDouble = true;
            continue;
        }

        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }

        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract function ${functionName}`);
}

test('user trend chart renders the trend line before awaiting hydration completion', () => {
    const source = readRepoFile('js/admin-analytics-panel-loaders.js');
    const analyticsShell = readRepoFile('admin-analytics.js');
    const html = readRepoFile('admin-studio.html');
    const loadUserTrendChart = extractFunction(source, 'loadUserTrendChart');
    const hydrateValueStart = source.indexOf('async function hydrateAnalyticsUserTrendValuePanels({ days = 30, trendRows = [], requestId = 0 } = {}) {');
    const hydrateSummaryStart = source.indexOf('async function hydrateAnalyticsUserTrendSummaryWindow({ trendRows = [], requestId = 0 } = {}) {');
    const loadStart = source.indexOf('async function loadUserTrendChart(days = 30) {');
    assert.notEqual(hydrateValueStart, -1, 'Expected deferred user-value panel hydration helper');
    assert.notEqual(hydrateSummaryStart, -1, 'Expected deferred summary-window hydration helper');
    assert.notEqual(loadStart, -1, 'Expected user trend chart loader');
    const hydrateUserTrendPanels = source.slice(hydrateValueStart, hydrateSummaryStart);
    const hydrateSummaryWindow = source.slice(hydrateSummaryStart, loadStart);

    assert.equal(
        loadUserTrendChart.includes('getAnalyticsProductSummaryBundle({ days }).catch(() => null)'),
        false,
        'loadUserTrendChart should not block the chart on the product summary bundle'
    );
    assert.equal(
        loadUserTrendChart.includes('getAnalyticsSummaryWindowData().catch(() => null)'),
        false,
        'loadUserTrendChart should not block the chart on the summary-window bundle'
    );
    assert.equal(
        loadUserTrendChart.includes('const data = await fetchUserTrendData(days);'),
        true,
        'loadUserTrendChart should wait only for the trend series before rendering the chart'
    );
    assert.equal(
        loadUserTrendChart.includes('const summaryHydrationPromise = hydrateAnalyticsUserTrendSummaryWindow({ trendRows: data, requestId });'),
        true,
        'loadUserTrendChart should hydrate summary-window KPI details after the chart render path starts'
    );
    assert.equal(
        loadUserTrendChart.includes('await Promise.allSettled(['),
        true,
        'loadUserTrendChart should let the refresh lifecycle wait until follow-up hydration has settled'
    );
    assert.equal(
        loadUserTrendChart.includes('hydrateAnalyticsUserTrendValuePanels({ days, trendRows: data, requestId })'),
        true,
        'loadUserTrendChart should hydrate user-value panels after the chart render path'
    );
    assert.equal(
        hydrateUserTrendPanels.includes('getAnalyticsProductSummaryBundle({ days }).catch(() => null)'),
        true,
        'user-value panel hydration should still load product signals asynchronously'
    );
    assert.equal(
        hydrateUserTrendPanels.includes('if (requestId !== analyticsUserTrendRequestId)'),
        true,
        'late product-signal responses should not overwrite a newer user trend request'
    );
    assert.equal(
        hydrateSummaryWindow.includes('getAnalyticsSummaryWindowData().catch(() => null)'),
        true,
        'summary-window hydration should still refine KPI details asynchronously'
    );
    assert.equal(
        hydrateSummaryWindow.includes('if (requestId !== analyticsUserTrendRequestId)'),
        true,
        'late summary-window responses should not overwrite a newer user trend request'
    );
    assert.equal(
        analyticsShell.includes('let analyticsUserTrendRequestId = 0;'),
        true,
        'admin-analytics.js should expose a request guard for deferred user trend panel hydration'
    );
    assert.equal(
        html.includes('js/admin-analytics-panel-loaders.js?v=20260427_ANALYTICS_USER_TREND_LOADING_DOTS_1'),
        true,
        'admin-studio.html should bump the panel-loader version for immutable cache safety'
    );
});
