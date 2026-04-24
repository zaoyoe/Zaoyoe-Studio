const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('admin sidebar modules expose warm-load hooks for sibling views', () => {
    const bootstrapSource = readRepoFile('js/admin-studio-bootstrap.js');
    const studioSource = readRepoFile('admin-studio.js');
    const commentsSource = readRepoFile('admin-comments.js');
    const pointsSource = readRepoFile('admin-points.js');
    const paymentsSource = readRepoFile('js/admin-payments.js');

    const bootstrapMarkers = [
        "return () => window.prefetchGalleryModule?.();",
        "return () => window.prefetchCommentsModule?.();",
        "return () => window.prefetchPointsModule?.();",
        "return () => window.AdminPayments?.scheduleTabPrefetch?.(window.AdminPayments?.getActiveTab?.() || 'overview');",
        "return () => window.prefetchSettingsModule?.();",
        "return () => window.prefetchOpsAlertsModule?.();",
        'window.scheduleAdminModulePrefetch = scheduleAdminModulePrefetch;'
    ];

    for (const marker of bootstrapMarkers) {
        assert.equal(
            bootstrapSource.includes(marker),
            true,
            `js/admin-studio-bootstrap.js should contain ${marker}`
        );
    }

    assert.equal(
        bootstrapSource.includes('const ADMIN_BOOTSTRAP_MODULE_PREFETCH_ALLOWLIST = new Set([]);'),
        true,
        'js/admin-studio-bootstrap.js should keep bootstrap module prefetch disabled by default'
    );
    assert.equal(
        bootstrapSource.includes('if (!ADMIN_BOOTSTRAP_MODULE_PREFETCH_ALLOWLIST.has(normalizedModuleId)) {'),
        true,
        'js/admin-studio-bootstrap.js should skip bootstrap prefetch for heavy modules by default'
    );
    assert.match(
        bootstrapSource,
        /function scheduleHomepageModulePrewarm\(activeModule = restoreAdminStudioModuleFromUrl\(\)\) \{[\s\S]*normalizeAdminModuleId\(activeModule\) !== 'homepage'/,
        'js/admin-studio-bootstrap.js should not prewarm homepage config unless homepage is the active startup module'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /window\.addEventListener\('permissionsLoaded', \(\) => \{[\s\S]*scheduleAdminChatPrewarm\(\);[\s\S]*\}\);/,
        'js/admin-studio-bootstrap.js should not eagerly prewarm chat during the permissionsLoaded bootstrap path'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /window\.addEventListener\('load', \(\) => \{[\s\S]*scheduleAdminChatPrewarm\(\);[\s\S]*\}\);/,
        'js/admin-studio-bootstrap.js should not eagerly prewarm chat during the window load bootstrap path'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /function scheduleAdminChatPrewarm\(\)/,
        'js/admin-studio-bootstrap.js should remove the legacy admin chat prewarm scheduler entirely'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /} else if \(normalizedModuleId === 'settings'\) \{\s+window\.initSettingsModule\?\.\(\);\s+}/,
        'js/admin-studio-bootstrap.js should leave settings hydration to the shell activation lifecycle'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /} else if \(normalizedModuleId === 'points'\) \{\s+window\.loadBatches\?\.\(\);\s+}/,
        'js/admin-studio-bootstrap.js should leave points hydration to the shell activation lifecycle'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /if \(normalizedModuleId === 'payments' && window\.AdminPayments\?\.init\) window\.AdminPayments\.init\(\);/,
        'js/admin-studio-bootstrap.js should leave payments hydration to the shell activation lifecycle'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /if \(normalizedModuleId === 'users'\) window\.initUserModule\?\.\(\);/,
        'js/admin-studio-bootstrap.js should leave users hydration to the shell activation lifecycle'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /if \(normalizedModuleId === 'shop'\) window\.ShopAdmin\?\.init\?\.\(\);/,
        'js/admin-studio-bootstrap.js should leave shop hydration to the shell activation lifecycle'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /if \(normalizedModuleName === 'tickets' && typeof window\.AdminTickets\?\.init === 'function'\) \{\s+window\.AdminTickets\.init\(\);\s+}/,
        'js/admin-studio-bootstrap.js should leave tickets hydration to the shell activation lifecycle'
    );
    assert.doesNotMatch(
        bootstrapSource,
        /if \(normalizedModuleName === 'chat' && !window\.adminChatInstance && typeof window\.AdminChat === 'function'\) \{\s+window\.adminChatInstance = new window\.AdminChat\(\);\s+}/,
        'js/admin-studio-bootstrap.js should leave chat hydration to the shell activation lifecycle'
    );
    assert.equal(
        bootstrapSource.includes('function warmOpsAlertsModuleData() {'),
        true,
        'js/admin-studio-bootstrap.js should expose a dedicated warm path for the ops-alerts workspace'
    );
    assert.match(
        bootstrapSource,
        /if \(normalizedModuleId === 'ops-alerts'\) \{\s+window\.initSettingsModule\?\.\(\{ bindListeners: true, loadConfig: false \}\);\s+window\.initOpsAlertsModule\?\.\(\);\s+warmOpsAlertsModuleData\(\);\s+}/,
        'js/admin-studio-bootstrap.js should bind settings listeners and warm ops-alert data only when the ops-alerts module becomes active'
    );

    const studioMarkers = [
        'function prefetchGalleryModule() {',
        'function prefetchSettingsModule() {',
        'function prefetchOpsAlertsModule() {',
        'window.prefetchGalleryModule = prefetchGalleryModule;',
        'window.prefetchSettingsModule = prefetchSettingsModule;',
        'window.prefetchOpsAlertsModule = prefetchOpsAlertsModule;'
    ];

    for (const marker of studioMarkers) {
        assert.equal(
            studioSource.includes(marker),
            true,
            `admin-studio.js should contain ${marker}`
        );
    }

    const commentsMarkers = [
        'const COMMENTS_PREFETCH_VIEWS = [\'guestbook\', \'gallery\'];',
        'function buildCommentsViewCacheKey(requestParams = {}) {',
        'function scheduleCommentsViewPrefetch(activeView = currentCommentView) {',
        'window.prefetchCommentsModule = prefetchCommentsModule;'
    ];

    for (const marker of commentsMarkers) {
        assert.equal(
            commentsSource.includes(marker),
            true,
            `admin-comments.js should contain ${marker}`
        );
    }

    const pointsMarkers = [
        'const POINTS_PREFETCH_VIEWS = [\'catalog\'];',
        'function resolvePointsShellContext(context = {}) {',
        'function schedulePointsViewPrefetch(activeView = getActivePointsViewName()) {',
        'async function openAdminPointsShellContext(context = {}, options = {}) {',
        'window.openAdminPointsShellContext = openAdminPointsShellContext;',
        "window.AdminShell.registerModule('points', {",
        'activate: activatePointsModule,',
        'window.prefetchPointsModule = prefetchPointsModule;'
    ];

    for (const marker of pointsMarkers) {
        assert.equal(
            pointsSource.includes(marker),
            true,
            `admin-points.js should contain ${marker}`
        );
    }

    const usersMarkers = [
        'function activateUsersModule(context = {}, options = {}) {',
        'async function handleAdminUsersShellContext(context = {}, options = {}) {',
        'async function openAdminUsersShellContext(context = {}, options = {}) {',
        'function activateVisibleUsersModuleOnAccess() {',
        'window.openAdminUsersShellContext = openAdminUsersShellContext;',
        "window.AdminShell.registerModule('users', {",
        'activate: activateUsersModule,',
        'handleContext: handleAdminUsersShellContext,',
        'onSiteChange: handleAdminUsersSiteChange,'
    ];

    for (const marker of usersMarkers) {
        assert.equal(
            readRepoFile('admin-users.js').includes(marker),
            true,
            `admin-users.js should contain ${marker}`
        );
    }

    const discountsMarkers = [
        'activate: async function (context = {}, options = {}) {',
        'handleShellContext: async function (context = {}, options = {}) {',
        'window.openAdminDiscountsShellContext = async (context = {}, options = {}) => {',
        "window.AdminShell.registerModule('discounts', {",
        'handleContext: (context = {}, options = {}) => AdminDiscounts.handleShellContext(context, options),'
    ];

    for (const marker of discountsMarkers) {
        assert.equal(
            readRepoFile('admin-discounts.js').includes(marker),
            true,
            `admin-discounts.js should contain ${marker}`
        );
    }

    const settingsMarkers = [
        'async function activateSettingsModule(context = {}, options = {}) {',
        'async function handleSettingsModuleContext(context = {}, options = {}) {',
        'async function openAdminSettingsShellContext(context = {}, options = {}) {',
        'async function openAdminOpsAlertsShellContext(context = {}, options = {}) {',
        'window.openAdminOpsAlertsShellContext = openAdminOpsAlertsShellContext;',
        'window.openAdminSettingsShellContext = openAdminSettingsShellContext;',
        "window.AdminShell.registerModule('settings', {",
        "window.AdminShell.registerModule('ops-alerts', {",
        'activate: activateSettingsModule',
        'handleContext: handleSettingsModuleContext'
    ];

    for (const marker of settingsMarkers) {
        assert.equal(
            readRepoFile('admin-config.js').includes(marker),
            true,
            `admin-config.js should contain ${marker}`
        );
    }

    const paymentsMarkers = [
        'const PAYMENTS_PREFETCH_TABS = [];',
        "const PAYMENTS_TABS = new Set(['overview', 'finance', 'ops']);",
        'function prefetchTabData(tabId, options = {}) {',
        'function scheduleTabPrefetch(activeTab = state.activeTab) {',
        'async function activatePaymentsModule(context = {}, options = {}) {',
        "window.AdminShell.registerModule('payments', {",
        'scheduleTabPrefetch,',
        'getActiveTab: () => state.activeTab,'
    ];

    for (const marker of paymentsMarkers) {
        assert.equal(
            paymentsSource.includes(marker),
            true,
            `js/admin-payments.js should contain ${marker}`
        );
    }

    const chatMarkers = [
        'function ensureAdminChatInstance(options = {}) {',
        'async function activateChatModule(context = {}, options = {}) {',
        'async function handleChatModuleContext(context = {}, options = {}) {',
        "window.AdminShell.registerModule('chat', {",
        'handleContext: handleChatModuleContext,'
    ];

    for (const marker of chatMarkers) {
        assert.equal(
            readRepoFile('js/admin-chat.js').includes(marker),
            true,
            `js/admin-chat.js should contain ${marker}`
        );
    }

    const shopMarkers = [
        'SHOP_TAB_PREFETCH_ALLOWLIST: [],',
        'scheduleShopTabPrefetch: function (activeTab = this.currentTab) {',
        'activate: async function (context = {}, options = {}) {',
        "window.AdminShell.registerModule('shop', {",
        'handleContext: (context = {}, options = {}) => window.ShopAdmin?.handleShellContext?.(context, options),'
    ];

    for (const marker of shopMarkers) {
        assert.equal(
            readRepoFile('js/admin-shop.js').includes(marker),
            true,
            `js/admin-shop.js should contain ${marker}`
        );
    }

    const ticketsMarkers = [
        'resolveActivationWorkspace: function (context = {}, options = {}) {',
        'buildShellQueueState: function (context = {}, options = {}) {',
        'activate: async function (context = {}, options = {}) {',
        'async function openAdminTicketsShellContext(context = {}, options = {}) {',
        'window.openAdminTicketsShellContext = openAdminTicketsShellContext;',
        "window.AdminShell.registerModule('tickets', {",
        'handleContext: (context = {}, options = {}) => window.AdminTickets?.handleShellContext?.(context, options),'
    ];

    for (const marker of ticketsMarkers) {
        assert.equal(
            readRepoFile('js/admin-tickets.js').includes(marker),
            true,
            `js/admin-tickets.js should contain ${marker}`
        );
    }
});
