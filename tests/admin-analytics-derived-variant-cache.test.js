const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function extractFunction(source, functionName) {
    const marker = `async function ${functionName}(options = {}) {`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `Expected to find ${functionName}`);

    let depth = 0;
    const bodyStart = start + marker.length - 1;
    assert.notEqual(bodyStart, -1, `Expected function body for ${functionName}`);

    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Failed to extract function ${functionName}`);
}

test('analytics derived bundle cache separates request variants such as limits and pages', () => {
    const source = readRepoFile('js/admin-analytics-derived-bundles.js');
    const html = readRepoFile('admin-studio.html');

    for (const marker of [
        'variantCache: Object.create(null)',
        'generations: Object.create(null)',
        'analyticsDerivedRequests.generations = Object.create(null);',
        'analyticsDerivedState.variantCache = Object.create(null);',
        'function getAnalyticsDerivedRequestKey(key, cacheKey = \'\') {',
        'function bumpAnalyticsDerivedRequestGeneration(key, contextKey = getAnalyticsAIContextKey()) {',
        'function getAnalyticsDerivedRequestGeneration(key, contextKey = getAnalyticsAIContextKey()) {',
        'function getAnalyticsDerivedCachedValue(key, contextKey = getAnalyticsAIContextKey(), cacheKey = \'\') {',
        'function setAnalyticsDerivedCachedValue(key, value, contextKey = getAnalyticsAIContextKey(), cacheKey = \'\') {',
        'const cacheKey = String(options.cacheKey || \'\').trim();',
        'const requestKey = getAnalyticsDerivedRequestKey(key, cacheKey);',
        'const requestGeneration = bumpAnalyticsDerivedRequestGeneration(requestKey, contextKey);',
        'getAnalyticsDerivedRequestGeneration(requestKey, contextKey) === requestGeneration',
        'getAnalyticsDerivedCachedValue(key, contextKey, cacheKey)',
        'setAnalyticsDerivedCachedValue(key, value, contextKey, cacheKey)',
        'state[key] = value;'
    ]) {
        assert.equal(source.includes(marker), true, `derived cache should contain ${marker}`);
    }

    const queryBackedBundleGetters = [
        ['getAnalyticsSummaryWindowBundle', 'buildAnalyticsSummaryWindowBundleQuery(options)'],
        ['getAnalyticsAdminSnapshotBundle', 'buildAnalyticsAdminSnapshotBundleQuery(options)'],
        ['getAnalyticsSummaryPayloadBundle', 'buildAnalyticsSummaryRowsBundleQuery(options)'],
        ['getAnalyticsSummaryRowsBundle', 'buildAnalyticsSummaryRowsBundleQuery(options)'],
        ['getAnalyticsPanelSupportBundle', 'buildAnalyticsPanelSupportBundleQuery(options)'],
        ['getAnalyticsVisualPanelBundle', 'buildAnalyticsVisualPanelBundleQuery(options)'],
        ['getAnalyticsTrendSeriesBundle', 'buildAnalyticsTrendSeriesBundleQuery(options)'],
        ['getAnalyticsProductSummaryBundle', 'buildAnalyticsProductBundleQuery(options)'],
        ['getAnalyticsProductDashboardBundle', 'buildAnalyticsProductBundleQuery(options)'],
        ['getAnalyticsProductRankBundle', 'buildAnalyticsProductBundleQuery(options)'],
        ['getAnalyticsProductHealthBundle', 'buildAnalyticsProductBundleQuery(options)'],
        ['getAnalyticsProductFunnelBundle', 'buildAnalyticsProductBundleQuery(options)']
    ];

    for (const [functionName, queryBuilder] of queryBackedBundleGetters) {
        const functionSource = extractFunction(source, functionName);
        assert.equal(
            functionSource.includes(`const query = ${queryBuilder};`),
            true,
            `${functionName} should build the exact query once for fetch and cache identity`
        );
        assert.equal(
            functionSource.includes('cacheKey: query.toString()'),
            true,
            `${functionName} should include query params in its derived cache key`
        );
    }

    assert.equal(
        html.includes('js/admin-analytics-derived-bundles.js?v=20260420_DERIVED_VARIANT_CACHE_1'),
        true,
        'admin-studio.html should bump the derived-bundle version for immutable cache safety'
    );
});
