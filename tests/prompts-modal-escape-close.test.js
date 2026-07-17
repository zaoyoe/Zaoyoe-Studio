const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('prompt detail modal closes through the shared cleanup path on Escape', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../prompts-poetry.js'), 'utf8');

    assert.match(source, /function handlePromptModalEscapeKey\(event\) \{/);
    assert.match(source, /event\.key !== 'Escape'/);
    assert.match(source, /modal\?\.classList\.contains\('active'\)/);
    assert.match(source, /event\.stopImmediatePropagation\(\);\s*closePromptModal\(\);/);
    assert.match(source, /document\.addEventListener\('keydown', handlePromptModalEscapeKey, true\);/);
});
