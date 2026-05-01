const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('legacy user drawer close path delegates to the current user modal without requiring a drawer overlay', () => {
    const source = readRepoFile('admin-users.js');

    assert.match(
        source,
        /function closeUserDrawer\(\) \{\s*closeUserModal\(\);\s*\}/,
        'primary drawer alias should close the current user modal'
    );
    assert.match(
        source,
        /function closeUserDrawer\(\) \{\s*closeUserModal\(\);\s*document\.getElementById\('userDrawerOverlay'\)\?\.classList\.remove\('active'\);\s*\}/,
        'legacy overlay fallback should be null-safe when only the user modal overlay exists'
    );
    assert.doesNotMatch(
        source,
        /document\.getElementById\('userDrawerOverlay'\)\.classList\.remove/,
        'legacy drawer close path should not assume #userDrawerOverlay is present'
    );
});
