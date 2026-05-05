const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin users frontend routes sensitive actions through hardened admin APIs', () => {
    const source = readRepoFile('admin-users.js');

    assert.match(source, /\/api\/admin\/users\/manage/);
    assert.match(source, /\/api\/admin\/users\/blocks/);
    assert.match(source, /import_tags_by_email/);
    assert.doesNotMatch(source, /from\('admin_roles'\)\.(?:insert|update|upsert|delete)/);
    assert.doesNotMatch(source, /from\('blocked_users'\)\.(?:insert|update|upsert|delete)/);
    assert.doesNotMatch(source, /from\('points_ledger'\)\.(?:insert|update|upsert|delete)/);
    assert.doesNotMatch(source, /from\('user_tags'\)\.(?:insert|update|upsert|delete)/);
    assert.doesNotMatch(source, /from\('system_notifications'\)\.(?:insert|update|upsert|delete)/);
    assert.doesNotMatch(source, /rpc\('fn_admin_clear_user_data'/);
});

test('admin config frontend routes hardened settings actions through admin APIs', () => {
    const source = readRepoFile('admin-config.js');

    assert.match(source, /\/api\/admin\/settings\/system-config/);
    assert.match(source, /\/api\/admin\/settings\/security-locks/);
    assert.match(source, /scope:\s*'admin_personal'/);
    assert.match(source, /category:\s*'announcement'/);
    assert.doesNotMatch(source, /from\('system_notifications'\)\.(?:insert|update|upsert|delete)/);
    assert.doesNotMatch(source, /rpc\('admin_unlock_account'/);
    assert.doesNotMatch(source, /rpc\('admin_unlock_all_accounts'/);
    assert.doesNotMatch(source, /rpc\('get_all_system_config'/);
    assert.doesNotMatch(source, /rpc\('update_system_config'/);
});
