const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('payments local smoke stays wired to a dedicated module branch', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../js/local-smoke-fixtures.js'), 'utf8');

    assert.match(source, /async function runAdminPaymentsSmoke\(\)/);
    assert.match(source, /moduleParam === 'payments'/);
    assert.match(source, /await runAdminPaymentsSmoke\(\)/);
});
