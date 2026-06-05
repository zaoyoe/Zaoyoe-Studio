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

test('wallet affiliate poster preserves real avatars through the canvas-safe CDN path', () => {
    const walletSource = readRepoFile(path.join('js', 'components', 'WalletModal.js'));

    assert.match(
        walletSource,
        /isGeneratedWalletAvatarUrl\(value = ''\)[\s\S]*ui-avatars\\\.com\|dicebear\\\.com[\s\S]*data:image\\\/svg\\\+xml/s
    );
    assert.match(
        walletSource,
        /getCurrentWalletAvatarCandidates\(\)[\s\S]*document\.getElementById\('navUserAvatar'\)[\s\S]*window\.__ZAOYOE_LAST_AUTH_USER__\?\.avatarUrl[\s\S]*cachedProfile\.avatarUrl/s
    );
    assert.match(
        walletSource,
        /getProfileAvatarCandidates\(profile = \{\}, user = \{\}\)[\s\S]*identityCandidates[\s\S]*profile\.avatar_url[\s\S]*user\.user_metadata\?\.picture[\s\S]*\.\.\.identityCandidates[\s\S]*\.\.\.this\.getCurrentWalletAvatarCandidates\(\)/s
    );
    assert.match(
        walletSource,
        /normalizeWalletAvatarUrl\(value = '', options = \{\}\)[\s\S]*allowSupabaseStorage/s
    );
    assert.match(
        walletSource,
        /isGoogleWalletAvatarUrl\(value = ''\)[\s\S]*googleusercontent\\\.com/s
    );
    assert.match(
        walletSource,
        /uploadAffiliatePosterAvatarToR2\(source = '', userId = ''\)[\s\S]*window\.uploadAvatarToR2\(\{[\s\S]*userId,[\s\S]*imageUrl: source/s
    );
    assert.match(
        walletSource,
        /uploadAffiliatePosterAvatarViaFunction\(source = '', userId = ''\)[\s\S]*returnDataUrl: true[\s\S]*payload\?\.dataUrl \|\| payload\?\.imageDataUrl/s
    );
    assert.match(
        walletSource,
        /getAffiliatePosterAvatarCandidateGroups\(profile = this\.affiliateProfile \|\| \{\}\)[\s\S]*\.\.\.this\.getCurrentWalletAvatarCandidates\(\)[\s\S]*const custom = \[\];[\s\S]*const google = \[\];[\s\S]*google\.push\(normalized\)[\s\S]*custom\.push\(normalized\)/s
    );
    assert.match(
        walletSource,
        /getAffiliatePosterAvatarUrls\(profile = this\.affiliateProfile \|\| \{\}\)[\s\S]*\.\.\.custom\.filter\(value => this\.isCanvasReadyWalletAvatarUrl\(value\)\)[\s\S]*const uploadedUrl = await this\.uploadAffiliatePosterAvatarToR2\(googleUrl, userId\)[\s\S]*orderedUrls\.push\(googleUrl\)/s
    );
    assert.match(
        walletSource,
        /loadAffiliatePosterAvatarImage\(profile = this\.affiliateProfile \|\| \{\}\)[\s\S]*const urls = await this\.getAffiliatePosterAvatarUrls\(profile\);[\s\S]*const userId = String\(profile\.userId \|\| ''\)\.trim\(\);[\s\S]*const dataUrl = await this\.uploadAffiliatePosterAvatarToR2\(url, userId\);[\s\S]*return null;/s
    );
    assert.match(
        walletSource,
        /avatarCandidates: this\.getProfileAvatarCandidates\(profileSource, user\)/s
    );
    assert.match(
        walletSource,
        /const avatarImage = await this\.loadAffiliatePosterAvatarImage\(\);/s
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
