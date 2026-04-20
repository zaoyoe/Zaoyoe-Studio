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

test('comments sibling prefetch warms only lightweight summaries', () => {
    const source = readRepoFile('admin-comments.js');
    const segment = getFunctionSegment(source, 'scheduleCommentsViewPrefetch', 'prefetchCommentsModule');

    assert.equal(
        segment.includes('prefetchCommentsSummary(view);'),
        true,
        'comments sibling prefetch should keep summary counts warm'
    );
    assert.equal(
        segment.includes('prefetchCommentsView(view);'),
        false,
        'comments sibling prefetch should not fetch the sibling tab full list'
    );
    assert.match(
        segment,
        /list rows are loaded only when the tab is opened/,
        'comments sibling prefetch should document why full list warming stays disabled'
    );
});
