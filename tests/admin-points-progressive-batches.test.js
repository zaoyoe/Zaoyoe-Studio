const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getFunctionSegment(source, functionName, nextFunctionName) {
    const start = source.indexOf(`function ${functionName}`);
    const end = source.indexOf(`function ${nextFunctionName}`, start + 1);
    assert.notEqual(start, -1, `Expected ${functionName} to exist`);
    assert.notEqual(end, -1, `Expected ${nextFunctionName} to follow ${functionName}`);
    return source.slice(start, end);
}

test('points batches load renders rows before warming package filters', () => {
    const source = readRepoFile('admin-points.js');
    const loadBatchesSegment = getFunctionSegment(source, 'loadBatches', 'initBatchTableHorizontalScroll');

    assert.equal(
        loadBatchesSegment.includes('void loadPackagesForFilter({ site: currentSite });'),
        true,
        'loadBatches should warm package filters in the background'
    );
    assert.equal(
        loadBatchesSegment.includes('await loadPackagesForFilter()'),
        false,
        'loadBatches should not block the batch list on package filter options'
    );

    const warmIndex = loadBatchesSegment.indexOf('void loadPackagesForFilter({ site: currentSite });');
    const applyIndex = loadBatchesSegment.indexOf('applyBatchFilters();');
    assert.notEqual(warmIndex, -1, 'loadBatches should schedule the package filter warm path');
    assert.notEqual(applyIndex, -1, 'loadBatches should still render the filtered batch list');
    assert.ok(
        applyIndex > warmIndex,
        'loadBatches should proceed to apply filters after scheduling the background warm path'
    );
});

test('points batch filter package cache is scoped by site and supports loading placeholders', () => {
    const source = readRepoFile('admin-points.js');
    const loadPackagesSegment = getFunctionSegment(source, 'loadPackagesForFilter', 'renderBatches');

    const markers = [
        "let pointsBatchFilterPackagesSite = '';",
        "let pointsBatchFilterPackagesPendingSite = '';",
        'function hasPointsBatchFilterPackagesForSite(site = getPointsReadSite()) {',
        "loadingOption.textContent = '套餐加载中...';",
        'renderBatchPackageFilterOptions(fallbackPackages, { loading: true });',
        'pointsBatchFilterPackagesSite = normalizedSite;',
        'const filterChanged = renderBatchPackageFilterOptions(allPackages);'
    ];

    for (const marker of markers) {
        assert.equal(
            source.includes(marker),
            true,
            `admin-points.js should contain ${marker}`
        );
    }

    assert.equal(
        loadPackagesSegment.includes('fetchPointsCatalogSnapshot({ site: normalizedSite, force })'),
        true,
        'loadPackagesForFilter should fetch site-scoped catalog snapshots'
    );
    assert.equal(
        loadPackagesSegment.includes('if (!force && hasPointsBatchFilterPackagesForSite(normalizedSite)) {'),
        true,
        'loadPackagesForFilter should reuse package filters only for the active site cache'
    );
});
