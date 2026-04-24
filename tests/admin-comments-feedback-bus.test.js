const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const commentsPath = path.resolve(__dirname, '../admin-comments.js');

function readCommentsSource() {
    return fs.readFileSync(commentsPath, 'utf8');
}

test('admin comments feedback uses the shared toast bus when available', () => {
    const source = readCommentsSource();

    const markers = [
        "const showToast = (message, type = 'info') => {",
        "if (typeof window.showToast === 'function' && window.showToast !== showToast) {",
        "module: 'comments'",
        "source: 'admin-comments'",
        "new CustomEvent('admin-feedback-signal', {"
    ];

    for (const marker of markers) {
        assert.equal(source.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }
});
