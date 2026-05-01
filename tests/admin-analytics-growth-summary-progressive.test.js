const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getSegment(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + 1);
    assert.notEqual(start, -1, `Expected segment start ${startMarker}`);
    assert.notEqual(end, -1, `Expected segment end ${endMarker}`);
    return source.slice(start, end);
}

test('growth summary renders the base summary before background product signal warmup', () => {
    const analyticsCoreSource = readRepoFile('admin-analytics.js');
    const panelLoadersSource = readRepoFile('js/admin-analytics-panel-loaders.js');
    const warmSegment = getSegment(
        panelLoadersSource,
        'function scheduleGrowthSummaryProductSignalsWarm(summary = {}, options = {})',
        'async function loadGrowthSummary()'
    );
    const loadSegment = getSegment(
        panelLoadersSource,
        'async function loadGrowthSummary()',
        'async function loadEventFunnelPanels()'
    );

    assert.equal(
        analyticsCoreSource.includes('let analyticsGrowthSummaryRequestId = 0;'),
        true,
        'analytics runtime should track growth summary request ids to avoid stale background refreshes'
    );
    assert.equal(
        panelLoadersSource.includes('function applyGrowthSummaryPanelState(summary = {}, options = {}) {'),
        true,
        'growth summary should centralize first-paint rendering in a reusable helper'
    );

    assert.equal(
        loadSegment.includes('const [summary, productSummaryBundle, summaryWindow] = await Promise.all(['),
        false,
        'growth summary should no longer wait for product summary bundle on the critical path'
    );
    assert.equal(
        loadSegment.includes('const [summary, summaryWindow] = await Promise.all(['),
        true,
        'growth summary should keep only the base summary and summary window on the critical path'
    );
    assert.equal(
        loadSegment.includes('applyGrowthSummaryPanelState(summary, { summaryWindow });'),
        true,
        'growth summary should render the base payload as soon as it resolves'
    );
    assert.equal(
        loadSegment.includes('await scheduleGrowthSummaryProductSignalsWarm(summary, { requestId, summaryWindow });'),
        false,
        'growth summary should not keep the refresh lifecycle open for product-signal enrichment'
    );
    assert.equal(
        loadSegment.includes('void scheduleGrowthSummaryProductSignalsWarm(summary, { requestId, summaryWindow });'),
        true,
        'growth summary should warm product signals in the background after first paint'
    );
    assert.equal(
        loadSegment.includes('await scheduleGrowthSummaryProductSignalsWarm(fallbackSummary, { requestId, summaryWindow });'),
        false,
        'growth summary fallback should not keep the refresh lifecycle open for product-signal enrichment'
    );
    assert.equal(
        loadSegment.includes('void scheduleGrowthSummaryProductSignalsWarm(fallbackSummary, { requestId, summaryWindow });'),
        true,
        'growth summary fallback should also warm product signals in the background'
    );

    assert.equal(
        warmSegment.includes('return new Promise((resolve) => {'),
        true,
        'growth summary product warm should expose a promise that the refresh lifecycle can await'
    );
    assert.equal(
        warmSegment.includes('getAnalyticsProductSummaryBundle().catch(() => null)'),
        true,
        'growth summary product warm should reuse the cached product summary bundle'
    );
    assert.equal(
        warmSegment.includes('enrichAnalyticsGrowthSummaryWithProductSignals(summary, productSummary)'),
        true,
        'growth summary product warm should enrich the already-rendered base summary instead of rebuilding it'
    );
});
