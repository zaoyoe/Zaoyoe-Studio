const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('wallet affiliate RPCs pass the active site to site-scoped overloads', () => {
    const walletSource = readRepoFile(path.join('js', 'components', 'WalletModal.js'));

    assert.match(
        walletSource,
        /rpc\('fn_get_affiliate_stats',\s*\{\s*p_user_id:\s*user\.id,\s*p_site:\s*window\.SiteConfig\?\.site \|\| 'cn'\s*\}\)/s
    );
    assert.match(
        walletSource,
        /rpc\('fn_get_affiliate_reward_detail',\s*\{\s*p_user_id:\s*user\.id,\s*p_ledger_id:\s*orderId,\s*p_site:\s*window\.SiteConfig\?\.site \|\| 'cn'\s*\}\)/s
    );
});

test('wallet affiliate site-isolation migration adds site-scoped overloads and filters', () => {
    const migrationSource = readRepoFile(path.join('supabase', 'migrations', '20260508_wallet_affiliate_site_isolation.sql'));

    assert.match(
        migrationSource,
        /CREATE OR REPLACE FUNCTION public\.fn_get_affiliate_stats\(\s*p_user_id UUID,\s*p_site TEXT\s*\)/s
    );
    assert.match(
        migrationSource,
        /CREATE OR REPLACE FUNCTION public\.fn_get_affiliate_reward_detail\(\s*p_user_id UUID,\s*p_ledger_id UUID,\s*p_site TEXT\s*\)/s
    );
    assert.match(
        migrationSource,
        /TO_REGCLASS\('public\.user_login_history'\) IS NOT NULL/
    );
    assert.match(
        migrationSource,
        /COALESCE\(NULLIF\(BTRIM\(LOWER\(so\.site\)\), ''\), 'cn'\) = v_site/
    );
    assert.match(
        migrationSource,
        /COALESCE\(NULLIF\(BTRIM\(LOWER\(pl\.site\)\), ''\), 'cn'\) = v_site/
    );
});
