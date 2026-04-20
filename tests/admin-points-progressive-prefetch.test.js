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

test('points sibling prefetch warms only shared catalog snapshot', () => {
    const source = readRepoFile('admin-points.js');
    const prefetchSegment = getFunctionSegment(source, 'prefetchPointsView', 'schedulePointsViewPrefetch');

    assert.equal(
        source.includes("const POINTS_PREFETCH_VIEWS = ['catalog'];"),
        true,
        'points sibling prefetch should not enumerate heavy batches or generate views'
    );
    assert.equal(
        prefetchSegment.includes('fetchPointsCatalogSnapshot({ site: getPointsReadSite() });'),
        true,
        'points sibling prefetch should warm the shared catalog snapshot'
    );
    assert.equal(
        prefetchSegment.includes('loadBatches()'),
        false,
        'points sibling prefetch should not fetch and render the batches table'
    );
    assert.equal(
        prefetchSegment.includes('loadPointsPackageCatalog()'),
        false,
        'points sibling prefetch should not render the hidden catalog workspace'
    );
    assert.equal(
        prefetchSegment.includes('loadPackagesForSelect()'),
        false,
        'points sibling prefetch should not render the hidden generate form'
    );
    assert.equal(
        prefetchSegment.includes('initBatchExpiresPicker()'),
        false,
        'points sibling prefetch should not initialize hidden generate widgets'
    );
});
