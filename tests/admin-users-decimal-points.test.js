const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ADMIN_USERS_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'admin-users.js'), 'utf8');

function extractFunction(name) {
    const start = ADMIN_USERS_SOURCE.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `expected ${name} to be present`);

    const bodyStart = ADMIN_USERS_SOURCE.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `expected ${name} to have a function body`);

    let depth = 0;
    for (let index = bodyStart; index < ADMIN_USERS_SOURCE.length; index += 1) {
        const character = ADMIN_USERS_SOURCE[index];
        if (character === '{') depth += 1;
        if (character === '}') depth -= 1;
        if (depth === 0) return ADMIN_USERS_SOURCE.slice(start, index + 1);
    }

    assert.fail(`expected ${name} function body to close`);
}

function loadFormattingHelpers() {
    return Function(`
        ${extractFunction('formatAdminPointValue')}
        ${extractFunction('normalizeAdminLedgerValue')}
        return { formatAdminPointValue, normalizeAdminLedgerValue };
    `)();
}

test('admin user detail keeps cent-level recharge points visible', () => {
    const { formatAdminPointValue, normalizeAdminLedgerValue } = loadFormattingHelpers();

    assert.equal(formatAdminPointValue(0.01), '0.01');
    assert.equal(formatAdminPointValue(0.1), '0.1');
    assert.equal(formatAdminPointValue(1.01), '1.01');
    assert.equal(formatAdminPointValue(12.34), '12.34');
    assert.equal(normalizeAdminLedgerValue(0.01), 0.01);
    assert.equal(normalizeAdminLedgerValue(-0.01), -0.01);
});
