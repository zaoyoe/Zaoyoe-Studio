const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('invite capture is scoped to the current site before registration', () => {
    const authSource = readRepoFile('supabase-auth-functions.js');

    assert.match(authSource, /function getInviteCodeStorageSite\(\)/);
    assert.match(authSource, /function getInviteCodeStorageKey\(site = getInviteCodeStorageSite\(\)\)/);
    assert.match(authSource, /localStorage\.setItem\(getInviteCodeStorageKey\(\), normalizedInviteCode\)/);
    assert.match(authSource, /const inviteCode = getInviteCodeForCurrentSite\(\);/);
    assert.doesNotMatch(authSource, /localStorage\.setItem\('invite_code', ref\)/);
    assert.doesNotMatch(authSource, /localStorage\.getItem\('invite_code'\)/);
});

test('engagement reader and dismissed state are isolated by site', () => {
    const chatWidgetSource = readRepoFile('js/components/ChatWidget.js');

    assert.match(chatWidgetSource, /getEngagementReaderKeyStorageKey\(site = this\.getEngagementBroadcastSite\(\)\)/);
    assert.match(chatWidgetSource, /zaoyoe_engagement_reader_key_\$\{site\}_v1/);
    assert.match(chatWidgetSource, /getEngagementDismissedStorageKey\(site = this\.getEngagementBroadcastSite\(\)\)/);
    assert.match(chatWidgetSource, /zaoyoe_engagement_dismissed_\$\{site\}_v1/);
    assert.doesNotMatch(chatWidgetSource, /zaoyoe_engagement_reader_key_v1/);
    assert.doesNotMatch(chatWidgetSource, /zaoyoe_engagement_dismissed_v1/);
});

test('wallet pending payment caches are isolated by site with legacy migration', () => {
    const walletSource = readRepoFile('js/components/WalletModal.js');

    assert.match(walletSource, /getWalletSiteScope\(\)/);
    assert.match(walletSource, /wallet_pending_payment_claims_\$\{site\}_v1/);
    assert.match(walletSource, /wallet_pending_custom_recharge_quotes_\$\{site\}_v1/);
    assert.match(walletSource, /migrateLegacyPendingPaymentClaims\(site = this\.getWalletSiteScope\(\)\)/);
    assert.match(walletSource, /migrateLegacyPendingCustomRechargeQuotes\(site = this\.getWalletSiteScope\(\)\)/);
});

test('wallet site-scoped configs use public site-config endpoints instead of global system_config RPCs', () => {
    const walletSource = readRepoFile('js/components/WalletModal.js');

    assert.match(walletSource, /url\.searchParams\.set\('route', 'site-system-config'\)/);
    assert.match(walletSource, /url\.searchParams\.set\('site', this\.getWalletSiteScope\(\)\)/);
    assert.match(walletSource, /const site = this\.getWalletSiteScope\(\);/);
    assert.match(walletSource, /const relativeUrl = `\/api\/payments\/config\?site=\$\{encodeURIComponent\(normalizedSite\)\}`/);
    assert.match(walletSource, /buildWalletPublicApiUrl\('\/api\/payments\/config',\s*\{\s*site: normalizedSite\s*\}\)/);
    assert.doesNotMatch(walletSource, /rpc\('get_system_config',\s*\{\s*p_key:\s*'affiliate_program'/);
    assert.doesNotMatch(walletSource, /rpc\('get_system_config',\s*\{\s*p_key:\s*'affiliate_poster'/);
});

test('verify page price uses site-scoped public config instead of global system_config reads', () => {
    const verifySource = readRepoFile('js/verify-page.js');

    assert.match(verifySource, /route=verify-settings/);
    assert.match(verifySource, /getVerifyRuntimeSite\(\)/);
    assert.doesNotMatch(verifySource, /\.from\('system_config'\)/);
    assert.doesNotMatch(verifySource, /config_key'\)\s*\.eq\('config_key',\s*'verify_settings'/);
});
