const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('comments queue chip hides for 全部 and shows for 待处理 plus other explicit queues', () => {
    const source = readRepoFile('admin-comments.js');

    assert.equal(
        source.includes("if (filterState.queue && filterState.queue !== 'all') {"),
        true,
        'admin-comments.js should hide the queue chip when the current queue is 全部'
    );
    assert.equal(
        source.includes("pending: '待处理',"),
        true,
        'admin-comments.js should expose the 待处理 queue label for the active queue chip'
    );
});

test('comments queue chip clear action resets queue back to 全部', () => {
    const source = readRepoFile('admin-comments.js');
    const cssSource = readRepoFile('admin-sidebar.css');

    assert.equal(
        source.includes("filterState.queue = 'all';"),
        true,
        'admin-comments.js should reset the queue filter back to 全部 when the queue chip is cleared'
    );
    assert.equal(
        source.includes("activeCommentQueue = 'all';"),
        true,
        'admin-comments.js should keep the queue button state aligned after clearing the queue chip'
    );
    assert.equal(
        cssSource.includes('padding: 0 var(--comments-shell-inline-padding);'),
        true,
        'admin-sidebar.css should align the queue chip container with the comments content gutter'
    );
});
