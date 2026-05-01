const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('user detail admin toggle flushes before close and refreshes list role badge state', () => {
    const usersSource = readRepoFile('admin-users.js');
    const toggleRoleStart = usersSource.indexOf('async function toggleAdminRole(');
    const toggleRoleEnd = usersSource.indexOf('// Save admin permissions configuration', toggleRoleStart);
    assert.notEqual(toggleRoleStart, -1, 'toggleAdminRole should exist');
    assert.notEqual(toggleRoleEnd, -1, 'toggleAdminRole section should be bounded');
    const toggleRoleSource = usersSource.slice(toggleRoleStart, toggleRoleEnd);

    assert.match(
        usersSource,
        /adminTogglePromise:\s*null/,
        'modal permission state should track in-flight admin role toggles'
    );
    assert.match(
        usersSource,
        /Boolean\(modalAdminPermissionsState\.adminTogglePromise\)/,
        'pending admin role toggles should block modal exit work'
    );
    assert.match(
        usersSource,
        /const pendingAdminToggle = modalAdminPermissionsState\.adminTogglePromise;[\s\S]*await pendingAdminToggle;/,
        'closing the modal should wait for an in-flight admin toggle before resetting modal state'
    );
    assert.match(
        usersSource,
        /const operation = \(async \(\) => \{[\s\S]*await toggleAdminRole\(userId, isEnabled\);[\s\S]*modalAdminPermissionsState\.adminTogglePromise = operation;[\s\S]*return await operation;[\s\S]*modalAdminPermissionsState\.adminTogglePromise = null;/,
        'the modal admin toggle handler should publish and clear its pending promise'
    );
    assert.match(
        toggleRoleSource,
        /is_admin = true;[\s\S]*admin_role_expiry_meta = getAdminRoleExpiryMeta\([\s\S]*renderUsersTable\(\);/,
        'granting admin should immediately refresh the user list badge state'
    );
    assert.match(
        toggleRoleSource,
        /is_admin = false;[\s\S]*admin_role = null;[\s\S]*admin_role_expiry_meta = getAdminRoleExpiryMeta\([\s\S]*renderUsersTable\(\);/,
        'revoking admin should immediately remove the user list shield badge'
    );
});
