const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('points ledger delete access is explicitly revoked in migrations and helper scripts', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260326_revoke_points_ledger_delete_access.sql'));
    const legacyHelperSql = readRepoFile(path.join('supabase', 'enable_ledger_delete.sql'));

    assert.match(
        migrationSql,
        /DROP POLICY IF EXISTS "Users delete own ledger" ON public\.points_ledger;/,
        'points-ledger delete hardening migration should remove the legacy self-delete policy'
    );
    assert.match(
        migrationSql,
        /REVOKE DELETE ON public\.points_ledger FROM authenticated;/,
        'points-ledger delete hardening migration should revoke authenticated delete privileges'
    );
    assert.doesNotMatch(
        legacyHelperSql,
        /CREATE POLICY "Users delete own ledger"/,
        'the legacy helper script should no longer recreate the unsafe self-delete policy'
    );
    assert.match(
        legacyHelperSql,
        /REVOKE DELETE ON public\.points_ledger FROM authenticated;/,
        'the legacy helper script should now fail closed by revoking delete access'
    );
});
