const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('prompts page removes the disclaimer while retaining support links', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../prompts.html'), 'utf8');
    const css = fs.readFileSync(path.resolve(__dirname, '../prompts-poetry.css'), 'utf8');

    assert.doesNotMatch(html, /gallery\.disclaimer(?:Title)?/);
    assert.doesNotMatch(html, /class="disclaimer-/);
    assert.doesNotMatch(css, /\.disclaimer-(?:footer|content|title|text)/);
    assert.match(html, /class="prompts-support-footer"/);
    assert.match(html, /class="support-link prompts-support-link"/);
});
