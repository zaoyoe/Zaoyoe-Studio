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
    const customCodesSql = readRepoFile(path.join('supabase', 'fn_generate_custom_codes.sql'));

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

    assert.match(
        customCodesSql,
        /CREATE OR REPLACE FUNCTION public\.fn_generate_custom_codes\(\s*p_batch_name TEXT,\s*p_points_amount INTEGER,\s*p_count INTEGER,\s*p_channel TEXT DEFAULT 'manual',\s*p_expires_at TIMESTAMPTZ DEFAULT NULL,\s*p_site VARCHAR DEFAULT 'cn'/s,
        'fn_generate_custom_codes helper should expose the hardened site-aware signature'
    );
    assert.match(
        customCodesSql,
        /CREATE OR REPLACE FUNCTION public\.fn_generate_custom_codes\(\s*p_batch_name TEXT,\s*p_points_amount INTEGER,\s*p_count INTEGER,\s*p_channel TEXT DEFAULT 'manual',\s*p_expires_at TIMESTAMPTZ DEFAULT NULL\s*\)/s,
        'fn_generate_custom_codes helper should keep the legacy wrapper only as a delegator'
    );
});

test('database migrations retire the legacy redemption overload and formalize the new guardrails', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260322_retire_legacy_redemption_overloads.sql'));
    const verificationSql = readRepoFile(path.join('supabase', 'verify_payment_redemption_hardening.sql'));

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
    assert.match(
        verificationSql,
        /public\.fn_redeem_code\(character varying\)/,
        'verification SQL should explicitly check that the legacy single-argument redemption overload is gone'
    );
    assert.match(
        verificationSql,
        /public\.fn_redeem_code\(character varying,character varying\)/,
        'verification SQL should explicitly check the site-aware redemption overload'
    );
    assert.match(
        verificationSql,
        /public\.fn_get_user_balance\(uuid\)/,
        'verification SQL should explicitly check that the old single-argument balance overload is gone'
    );
    assert.match(
        verificationSql,
        /public\.fn_get_user_balance\(uuid,character varying\)/,
        'verification SQL should explicitly check the site-aware balance overload'
    );
});

test('root legacy SQL scripts no longer ship executable single-site payment or redemption entrypoints', () => {
    const rootCommercialSql = readRepoFile('commercial_points_functions.sql');
    const rootRedemptionSql = readRepoFile('redemption_functions.sql');
    const affiliateUpgradeSql = readRepoFile('6.5_affiliate_dashboard_upgrade.sql');
    const fixRedemptionSiteSql = readRepoFile(path.join('supabase', 'fix_redemption_site.sql'));
    const dualSiteFunctionsSql = readRepoFile(path.join('supabase', 'dual_site_functions.sql'));
    const afdianOrdersSql = readRepoFile(path.join('supabase', 'afdian_orders.sql'));

    assert.doesNotMatch(
        rootCommercialSql,
        /CREATE OR REPLACE FUNCTION fn_add_points\(/,
        'commercial_points_functions.sql should be a deprecated stub, not an executable fn_add_points source'
    );
    assert.doesNotMatch(
        rootCommercialSql,
        /CREATE OR REPLACE FUNCTION fn_deduct_points\(/,
        'commercial_points_functions.sql should be a deprecated stub, not an executable fn_deduct_points source'
    );

    assert.doesNotMatch(
        rootRedemptionSql,
        /CREATE OR REPLACE FUNCTION fn_redeem_code\(/,
        'redemption_functions.sql should not redefine the legacy redemption RPC'
    );
    assert.doesNotMatch(
        rootRedemptionSql,
        /GRANT EXECUTE ON FUNCTION fn_redeem_code\(VARCHAR\) TO authenticated;/,
        'redemption_functions.sql must not re-grant the legacy single-argument redemption overload'
    );

    assert.doesNotMatch(
        affiliateUpgradeSql,
        /CREATE OR REPLACE FUNCTION public\.fn_recharge_points\(/,
        '6.5_affiliate_dashboard_upgrade.sql should not redeclare points recharge RPCs'
    );

    assert.doesNotMatch(
        fixRedemptionSiteSql,
        /CREATE OR REPLACE FUNCTION fn_generate_codes\(/,
        'fix_redemption_site.sql should be a deprecated stub, not an executable fn_generate_codes source'
    );
    assert.doesNotMatch(
        fixRedemptionSiteSql,
        /CREATE OR REPLACE FUNCTION fn_generate_custom_codes\(/,
        'fix_redemption_site.sql should be a deprecated stub, not an executable fn_generate_custom_codes source'
    );

    assert.doesNotMatch(
        dualSiteFunctionsSql,
        /CREATE OR REPLACE FUNCTION fn_(purchase_shop_item|get_user_balance|recharge_points|add_points|deduct_points|redeem_code)\(/,
        'dual_site_functions.sql should be a deprecated stub, not an executable RPC bundle'
    );

    assert.doesNotMatch(
        afdianOrdersSql,
        /CREATE OR REPLACE FUNCTION public\.fn_(ensure_redemption_code_for_payment_order|apply_payment_order_review|process_afdian_payment|finalize_afdian_custom_payment)\(/,
        'afdian_orders.sql should be a deprecated stub, not an executable payment bundle'
    );
});
