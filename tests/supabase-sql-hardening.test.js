const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('standalone Supabase helper SQL files stay aligned with hardened site-aware signatures', () => {
    const balanceSql = readRepoFile(path.join('supabase', 'fn_get_user_balance.sql'));
    const rechargeSql = readRepoFile(path.join('supabase', 'fn_recharge_points.sql'));
    const redeemSql = readRepoFile(path.join('supabase', 'fn_redeem_code_v2.sql'));

    assert.match(
        balanceSql,
        /CREATE OR REPLACE FUNCTION public\.fn_get_user_balance\(\s*p_user_id UUID DEFAULT NULL,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_get_user_balance helper should expose the hardened site-aware signature'
    );
    assert.doesNotMatch(
        balanceSql,
        /GRANT EXECUTE ON FUNCTION fn_get_user_balance\(UUID\) TO authenticated, service_role;/,
        'fn_get_user_balance helper must not re-grant the legacy single-argument overload'
    );

    assert.match(
        rechargeSql,
        /CREATE OR REPLACE FUNCTION public\.fn_recharge_points\(\s*target_user_id UUID,\s*p_paid NUMERIC\(12,1\),\s*p_bonus NUMERIC\(12,1\),\s*p_reason TEXT,\s*p_reference_id TEXT,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_recharge_points helper should preserve the site-aware overload'
    );

    assert.match(
        redeemSql,
        /CREATE OR REPLACE FUNCTION public\.fn_redeem_code\(\s*p_code VARCHAR,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_redeem_code helper should only define the site-aware overload'
    );
    assert.match(
        redeemSql,
        /DROP FUNCTION IF EXISTS public\.fn_redeem_code\(VARCHAR\);/,
        'fn_redeem_code helper should remove the legacy single-argument overload'
    );
    assert.match(
        redeemSql,
        /GRANT EXECUTE ON FUNCTION public\.fn_redeem_code\(VARCHAR, VARCHAR\) TO authenticated;/,
        'fn_redeem_code helper should only grant authenticated callers access to the site-aware overload'
    );
});

test('database migrations retire the legacy redemption overload and formalize the new guardrails', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260322_retire_legacy_redemption_overloads.sql'));

    assert.match(
        migrationSql,
        /CREATE OR REPLACE FUNCTION public\.fn_redeem_code\(\s*p_code VARCHAR,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'retirement migration should define the site-aware redemption RPC'
    );
    assert.match(
        migrationSql,
        /DROP FUNCTION IF EXISTS public\.fn_redeem_code\(VARCHAR\);/,
        'retirement migration should drop the legacy redemption overload'
    );
    assert.match(
        migrationSql,
        /REVOKE ALL ON FUNCTION public\.fn_redeem_code\(VARCHAR, VARCHAR\) FROM PUBLIC;/,
        'retirement migration should remove PUBLIC execute from fn_redeem_code'
    );
    assert.match(
        migrationSql,
        /GRANT EXECUTE ON FUNCTION public\.fn_redeem_code\(VARCHAR, VARCHAR\) TO authenticated;/,
        'retirement migration should re-grant fn_redeem_code only to authenticated callers'
    );
    assert.match(
        migrationSql,
        /DROP FUNCTION IF EXISTS public\.fn_get_user_balance\(UUID\);/,
        'retirement migration should remain idempotent against old balance overloads'
    );
});
