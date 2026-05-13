const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('admin settings frontend carries site filter through site-scoped config reads and writes', () => {
    const adminConfigSource = readRepoFile('admin-config.js');

    assert.match(adminConfigSource, /const ADMIN_SITE_SCOPED_SYSTEM_CONFIG_KEYS = new Set\(\[/);
    ['unlock_pricing', 'discount_trigger_rules', 'affiliate_program', 'rewards', 'checkin_system', 'notifications', 'verify_settings', 'ops_alerts'].forEach((key) => {
        assert.match(adminConfigSource, new RegExp(`'${key}'`));
    });
    assert.match(adminConfigSource, /searchParams\.set\('site', getAdminSettingsSiteFilterValue\(\)\)/);
    assert.match(adminConfigSource, /function isAdminSettingsSiteFilterStillCurrent\(site = ''\)/);
    assert.match(adminConfigSource, /let adminSettingsSiteScopedCacheSite = '';/);
    assert.match(adminConfigSource, /function clearAdminSettingsSiteScopedConfigCache\(options = \{\}\)/);
    assert.match(adminConfigSource, /ADMIN_SITE_SCOPED_SYSTEM_CONFIG_KEYS\.forEach\(\(key\) => \{[\s\S]*delete systemConfigCache\[key\];/);
    assert.match(adminConfigSource, /settingsDomainWarmPromises\.clear\(\);[\s\S]*settingsDomainLastLoadedAt\.clear\(\);/);
    assert.match(adminConfigSource, /function ensureAdminSettingsSiteScopedCacheMatchesCurrentSite\(\)/);
    assert.match(adminConfigSource, /function renderSettingsViewSections\(viewName = ''\) \{[\s\S]*ensureAdminSettingsSiteScopedCacheMatchesCurrentSite\(\);/);
    assert.match(adminConfigSource, /const requestSite = getAdminSettingsSiteFilterValue\(\);[\s\S]*if \(!isAdminSettingsSiteFilterStillCurrent\(requestSite\)\) \{[\s\S]*return settledResults;/);
    assert.match(adminConfigSource, /adminSettingsSiteScopedCacheSite = normalizeAdminSettingsSiteContext\(requestSite, 'all'\);/);
    assert.match(adminConfigSource, /async function handleAdminSettingsSiteChange\(detail = \{\}\) \{[\s\S]*await warmSettingsViewConfigInBackground\(\{[\s\S]*force: true,[\s\S]*viewName[\s\S]*\}\);/);
    assert.match(adminConfigSource, /const isSiteScoped = isAdminSiteScopedSystemConfigKey\(key\);/);
    assert.match(adminConfigSource, /site: isSiteScoped \? writableSite : undefined/);
    assert.match(adminConfigSource, /fetch\(`\/api\/admin\/settings\/payment-channels\?site=\$\{encodeURIComponent\(requestSite\)\}`/);
    assert.match(adminConfigSource, /if \(!isAdminSettingsSiteFilterStillCurrent\(requestSite\)\) \{[\s\S]*return payload;/);
    assert.match(adminConfigSource, /adminSettingsSiteScopedCacheSite = normalizeAdminSettingsSiteContext\(writableSite, 'all'\);/);
    assert.match(adminConfigSource, /const writableSite = requireWritableAdminSettingsSite\('保存支付通道配置'\);/);
    assert.match(adminConfigSource, /site: getAdminSettingsSiteFilterValue\(\),\s+errorMessage: '加载站外告警配置失败'/);
    assert.match(adminConfigSource, /site: normalizeAdminSettingsSiteContext\(options\.site \|\| getAdminSettingsSiteFilterValue\(\), 'all'\)/);
    assert.match(adminConfigSource, /const writableSite = requireWritableAdminSettingsSite\(options\.siteLabel \|\| '保存站外告警配置'\);/);
});

test('admin studio site-scoped modules discard stale site switch payloads', () => {
    const engagementSource = readRepoFile('js/admin-engagement.js');
    const homepageSource = readRepoFile('admin-homepage.js');
    const commentsSource = readRepoFile('admin-comments.js');
    const pointsSource = readRepoFile('admin-points.js');
    const growthSource = readRepoFile('js/admin-growth-center.js');
    const paymentsSource = readRepoFile('js/admin-payments.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    assert.match(engagementSource, /requestId: 0,[\s\S]*loadedSite: ''/);
    assert.match(engagementSource, /function isCurrentEngagementSiteRequest\(site, requestId = state\.requestId\)/);
    assert.match(engagementSource, /async function fetchOverview\(site = getCurrentSite\(\)\)/);
    assert.match(engagementSource, /const requestSite = getCurrentSite\(\);[\s\S]*const requestId = state\.requestId \+ 1;[\s\S]*const payload = await fetchOverview\(requestSite\);[\s\S]*if \(!isCurrentEngagementSiteRequest\(requestSite, requestId\)\)/);
    assert.match(engagementSource, /function handleAdminEngagementSiteChange\(\) \{[\s\S]*state\.loadedSite = '';/);

    assert.match(homepageSource, /let homepageLoadRequestId = 0;/);
    assert.match(homepageSource, /function isCurrentHomepageConfigRequest\(site, requestId\)/);
    assert.match(homepageSource, /async function loadAllConfig\(site = getHomepageReadSite\(\), requestId = homepageLoadRequestId\)/);
    assert.match(homepageSource, /if \(!isCurrentHomepageConfigRequest\(requestSite, requestId\)\) \{[\s\S]*return false;/);
    assert.match(homepageSource, /const nextLoadingPromise = Promise\.resolve\(\)[\s\S]*\.then\(\(\) => loadAllConfig\(normalizedTargetSite, requestId\)\)[\s\S]*if \(loadingPromise === nextLoadingPromise\)/);

    assert.match(commentsSource, /function isCurrentCommentsSite\(site\)/);
    assert.match(commentsSource, /let requestSite = getCommentsReadSite\(\);[\s\S]*requestSite = requestParams\.site \|\| requestSite;[\s\S]*if \(!isCurrentCommentsSite\(requestParams\.site\)\)/);
    assert.match(commentsSource, /if \(requestVersion !== commentsSummaryRequestVersion \|\| !isCurrentCommentsSite\(site\)\)/);
    assert.match(commentsSource, /void loadCommentStats\(currentCommentView, \{ showLoading: true \}\);/);

    assert.match(pointsSource, /const currentSite = getPointsReadSite\(\);[\s\S]*const payload = await fetchPointsBatchesPayload\(\{ site: currentSite \}\);[\s\S]*getPointsReadSite\(\) !== currentSite/);
    assert.match(pointsSource, /const payload = await fetchPointsCatalogSnapshot\(\{ site: currentSite, force \}\);[\s\S]*if \(getPointsReadSite\(\) !== currentSite\)/);

    assert.match(growthSource, /isCurrentSiteRequest\(site, requestId = this\.state\.requestId\)/);
    assert.match(growthSource, /async fetchPayload\(\{ force = false, mode = 'full', site = this\.getReadSite\(\), requestId = this\.state\.requestId \} = \{\}\)/);
    assert.match(growthSource, /if \(!this\.isCurrentSiteRequest\(site, requestId\)\) \{[\s\S]*return null;/);
    assert.match(growthSource, /this\.scheduleDetailLoad\(\{ force, requestId, site \}\);/);

    assert.match(paymentsSource, /const requestCacheKey = getCurrentCacheKey\(\);/);
    assert.match(paymentsSource, /requestToken !== state\.requestToken \|\| requestCacheKey !== getCurrentCacheKey\(\)/);
    assert.match(paymentsSource, /function handlePaymentsSiteChange\(\) \{[\s\S]*state\.requestToken = Date\.now\(\) \+ Math\.random\(\);/);

    [
        'admin-points.js',
        'js/admin-growth-center.js',
        'admin-comments.js',
        'js/admin-payments.js',
        'admin-homepage.js',
        'js/admin-engagement.js'
    ].forEach((scriptName) => {
        assert.match(
            adminStudioHtml,
            new RegExp(`${scriptName.replace(/[/.]/g, '\\$&')}[^"]*siteSwitchGuard=20260513_ADMIN_SITE_SWITCH_STALE_GUARD_1`)
        );
    });
});
