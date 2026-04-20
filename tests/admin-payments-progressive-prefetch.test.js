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

test('payments sibling tab prefetch stays disabled by default', () => {
    const source = readRepoFile('js/admin-payments.js');
    const autoQueueSegment = getFunctionSegment(source, 'getAutoPrefetchTabs', 'scheduleTabPrefetch');

    assert.equal(
        source.includes('const PAYMENTS_PREFETCH_TABS = [];'),
        true,
        'payments should keep automatic sibling tab prefetch disabled'
    );
    assert.match(
        autoQueueSegment,
        /Payment tabs fan out into orders, events, sessions, queries, and ledger scans/,
        'payments prefetch queue should document why sibling tabs stay on demand'
    );
    assert.equal(
        autoQueueSegment.includes('return PAYMENTS_PREFETCH_TABS;'),
        true,
        'payments auto-prefetch queue should come from the empty allowlist'
    );
    assert.equal(
        autoQueueSegment.includes("tabId !== 'finance'"),
        false,
        'payments should not rely on a finance-only exclusion while still prefetching other heavy tabs'
    );
});
