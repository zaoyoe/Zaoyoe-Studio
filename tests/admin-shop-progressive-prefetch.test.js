const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function getFunctionSegment(source, functionName, nextFunctionName) {
    const start = source.indexOf(`${functionName}: function`);
    const end = source.indexOf(`${nextFunctionName}: function`, start + 1);
    assert.notEqual(start, -1, `Expected ${functionName} to exist`);
    assert.notEqual(end, -1, `Expected ${nextFunctionName} to follow ${functionName}`);
    return source.slice(start, end);
}

test('shop sibling tab prefetch is explicit allowlist only', () => {
    const source = readRepoFile('js/admin-shop.js');
    const queueSegment = getFunctionSegment(source, 'getShopTabPrefetchQueue', 'runShopTabLoader');

    assert.equal(
        source.includes('SHOP_TAB_PREFETCH_ALLOWLIST: [],'),
        true,
        'shop should keep automatic sibling tab prefetch disabled by default'
    );
    assert.match(
        queueSegment,
        /large grids, order lists, inventory browsers, and fulfillment queues/,
        'shop prefetch queue should document why hidden tabs stay on demand'
    );
    assert.equal(
        queueSegment.includes('this.SHOP_TAB_IDS.filter'),
        false,
        'shop should not build background prefetch from every sibling tab'
    );
    assert.equal(
        queueSegment.includes('this.SHOP_TAB_PREFETCH_ALLOWLIST.filter'),
        true,
        'shop should only prefetch tabs that are explicitly allowlisted'
    );
});

test('admin bootstrap does not prefetch full modules by default', () => {
    const source = readRepoFile('js/admin-studio-bootstrap.js');

    assert.equal(
        source.includes('const ADMIN_BOOTSTRAP_MODULE_PREFETCH_ALLOWLIST = new Set([]);'),
        true,
        'admin bootstrap should not prefetch full modules by default'
    );
    assert.match(
        source,
        /function scheduleHomepageModulePrewarm\(activeModule = restoreAdminStudioModuleFromUrl\(\)\) \{[\s\S]*normalizeAdminModuleId\(activeModule\) !== 'homepage'/,
        'homepage prewarm should be scoped to the active startup module'
    );
});
