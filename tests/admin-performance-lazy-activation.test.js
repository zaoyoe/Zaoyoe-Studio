const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('comments module defers first list fetch until shell activation', () => {
    const commentsSource = readRepoFile('admin-comments.js');

    const requiredMarkers = [
        'let commentsSkipNextActivateReload = false;',
        'function activateCommentsModule() {',
        'function ensureCommentsModuleActive(options = {}) {',
        'async function openAdminCommentsShellContext(context = {}, options = {}) {',
        'window.openAdminCommentsShellContext = openAdminCommentsShellContext;',
        "switchLayoutView(currentViewLayout, { loadIfNeeded: false });",
        "window.AdminShell.registerModule('comments', {",
        'init: initCommentsModule,',
        'activate: activateCommentsModule,'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(commentsSource.includes(marker), true, `admin-comments.js should contain ${marker}`);
    }

    assert.equal(
        commentsSource.includes('const initCommentsLayout = () => switchLayoutView(currentViewLayout);'),
        false,
        'admin-comments.js should no longer bootstrap the full comments list on access grant'
    );
    assert.equal(
        commentsSource.includes("window.switchModule('comments');"),
        false,
        'admin-comments.js should no longer switch the comments module directly inside context helpers'
    );
});

test('growth center uses shell-driven lazy activation instead of unconditional boot', () => {
    const growthSource = readRepoFile('js/admin-growth-center.js');

    const requiredMarkers = [
        'skipNextActivateSync: false,',
        'pendingActivationSync: false,',
        "async openModule(moduleId = '', context = {}) {",
        "async openAsset(moduleId = '', assetType = '', id = '') {",
        'async function openAdminGrowthCenterShellContext(context = {}, options = {}) {',
        'function activateVisibleGrowthCenterOnAccess() {',
        'function handleAdminGrowthCenterSiteChange() {',
        'activate() {',
        'handleContext(context = {}, options = {}) {',
        'window.handleAdminGrowthCenterSiteChange = handleAdminGrowthCenterSiteChange;',
        'window.openAdminGrowthCenterShellContext = openAdminGrowthCenterShellContext;',
        "window.AdminShell.registerModule('growth-center', {",
        'window.AdminGrowthCenter?.activate?.();',
        'handleContext: (context = {}, options = {}) => window.AdminGrowthCenter?.handleContext?.(context, options),',
        'onSiteChange: handleAdminGrowthCenterSiteChange',
        'window.addEventListener(\'adminStudioAccessGranted\', activateVisibleGrowthCenterOnAccess, { once: true });'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(growthSource.includes(marker), true, `js/admin-growth-center.js should contain ${marker}`);
    }

    assert.equal(
        growthSource.includes('window.AdminGrowthCenter?.init?.();\n    }, { once: true });\n} else {\n    window.AdminGrowthCenter?.init?.();'),
        false,
        'js/admin-growth-center.js should no longer unconditionally boot the growth center outside shell activation'
    );
});

test('homepage module exposes a shared shell context helper alongside shell activation lifecycle hooks', () => {
    const homepageSource = readRepoFile('admin-homepage.js');

    const requiredMarkers = [
        'async function activateHomepageModule(context = {}, options = {}) {',
        'async function handleHomepageShellContext(context = {}, options = {}) {',
        'async function openAdminHomepageShellContext(context = {}, options = {}) {',
        'openShellContext: openAdminHomepageShellContext,',
        'window.openAdminHomepageShellContext = (context = {}, options = {}) => window.HomepageAdmin?.openShellContext?.(context, options);',
        'window.handleAdminHomepageSiteChange = (detail = {}) => window.HomepageAdmin?.handleSiteChange?.(detail);',
        "window.AdminShell.registerModule('homepage', {"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(homepageSource.includes(marker), true, `admin-homepage.js should contain ${marker}`);
    }
});

test('points module waits for shell activation before hydrating data-heavy views', () => {
    const pointsSource = readRepoFile('admin-points.js');

    const requiredMarkers = [
        'let pointsModuleInitialized = false;',
        'let pointsPendingActivationSync = false;',
        'function resolvePointsShellContext(context = {}) {',
        'function initPointsModule() {',
        'function activatePointsModule(context = {}) {',
        'async function openAdminPointsShellContext(context = {}, options = {}) {',
        'window.handleAdminPointsSiteChange = handleAdminPointsSiteChange;',
        'window.openAdminPointsShellContext = openAdminPointsShellContext;',
        'pointsPendingActivationSync = pointsModuleInitialized;',
        "window.AdminShell.registerModule('points', {",
        'activate: activatePointsModule,',
        'onSiteChange: handleAdminPointsSiteChange'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should contain ${marker}`);
    }
});

test('users module initializes through shell activation while preserving site refresh and modal restore', () => {
    const usersSource = readRepoFile('admin-users.js');

    const requiredMarkers = [
        'function activateUsersModule(context = {}, options = {}) {',
        'async function handleAdminUsersShellContext(context = {}, options = {}) {',
        'async function openAdminUsersShellContext(context = {}, options = {}) {',
        'return refreshUsersOnActivate({',
        'function activateVisibleUsersModuleOnAccess() {',
        'window.openAdminUsersShellContext = openAdminUsersShellContext;',
        "window.AdminShell.registerModule('users', {",
        'activate: activateUsersModule,',
        'handleContext: handleAdminUsersShellContext,',
        'onSiteChange: handleAdminUsersSiteChange,'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(usersSource.includes(marker), true, `admin-users.js should contain ${marker}`);
    }
});

test('settings module resolves the target tab through shell activation before warming config', () => {
    const configSource = readRepoFile('admin-config.js');

    const requiredMarkers = [
        'function resolveSettingsModuleViewName(context = {}, options = {}) {',
        'async function activateSettingsModule(context = {}, options = {}) {',
        'async function handleSettingsModuleContext(context = {}, options = {}) {',
        'async function openAdminSettingsShellContext(context = {}, options = {}) {',
        'async function activateOpsAlertsModule(context = {}, options = {}) {',
        'async function handleAdminOpsAlertsShellContext(context = {}, options = {}) {',
        'async function openAdminOpsAlertsShellContext(context = {}, options = {}) {',
        "window.switchSettingsView(viewName, { warm: false });",
        'await initSettingsModule({',
        'loadConfig: false,',
        'window.openAdminOpsAlertsShellContext = openAdminOpsAlertsShellContext;',
        'window.openAdminSettingsShellContext = openAdminSettingsShellContext;',
        "window.AdminShell.registerModule('settings', {",
        "window.AdminShell.registerModule('ops-alerts', {",
        'activate: activateSettingsModule',
        'handleContext: handleSettingsModuleContext'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(configSource.includes(marker), true, `admin-config.js should contain ${marker}`);
    }
});

test('discounts module initializes through shell activation and handles workbench context', () => {
    const discountsSource = readRepoFile('admin-discounts.js');
    const bootstrapSource = readRepoFile('js/admin-studio-bootstrap.js');

    const requiredMarkers = [
        'activate: async function (context = {}, options = {}) {',
        'handleShellContext: async function (context = {}, options = {}) {',
        'resolveShellDiscountSearchValue: function (context = {}) {',
        'window.openAdminDiscountsShellContext = async (context = {}, options = {}) => {',
        "window.AdminShell.registerModule('discounts', {",
        'activate: (context = {}, options = {}) => AdminDiscounts.activate(context, options),',
        'handleContext: (context = {}, options = {}) => AdminDiscounts.handleShellContext(context, options),'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(discountsSource.includes(marker), true, `admin-discounts.js should contain ${marker}`);
    }

    assert.equal(
        bootstrapSource.includes("normalizedModuleId === 'discounts'"),
        false,
        'js/admin-studio-bootstrap.js should no longer initialize discounts directly on module switch'
    );
});

test('payments module initializes through shell activation before applying workbench context', () => {
    const paymentsSource = readRepoFile('js/admin-payments.js');

    const requiredMarkers = [
        "const PAYMENTS_TABS = new Set(['overview', 'finance', 'ops']);",
        'async function activatePaymentsModule(context = {}, options = {}) {',
        'async function handlePaymentsModuleContext(context = {}, options = {}) {',
        'async function openAdminPaymentsShellContext(context = {}, options = {}) {',
        'function handlePaymentsSiteChange() {',
        'function activateVisiblePaymentsModuleOnAccess() {',
        'window.handleAdminPaymentsSiteChange = handlePaymentsSiteChange;',
        'window.openAdminPaymentsShellContext = openAdminPaymentsShellContext;',
        "window.AdminShell.registerModule('payments', {",
        'activate: activatePaymentsModule,',
        'handleContext: handlePaymentsModuleContext,',
        'onSiteChange: handlePaymentsSiteChange',
        'reload: handlePaymentsSiteChange'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(paymentsSource.includes(marker), true, `js/admin-payments.js should contain ${marker}`);
    }
});

test('shop module initializes through shell activation and skips legacy site-change listeners when shell is available', () => {
    const shopSource = readRepoFile('js/admin-shop.js');

    const requiredMarkers = [
        'activate: async function (context = {}, options = {}) {',
        'handleShellContext: async function (context = {}, options = {}) {',
        'function handleAdminShopSiteChange(detail = {}) {',
        'async function openAdminShopShellContext(context = {}, options = {}) {',
        'function activateVisibleShopModuleOnAccess() {',
        'function scheduleVisibleShopModuleActivation() {',
        'function bootstrapShopModuleActivation() {',
        'function handleShopTabActivationFallback(event = {}) {',
        "window.addEventListener('admin-shell-module-activated', handleShopShellModuleActivated);",
        "window.addEventListener('permissionsLoaded', scheduleVisibleShopModuleActivation, { once: true });",
        "document.addEventListener('click', handleShopTabActivationFallback, true);",
        "if (document.readyState === 'loading') {",
        'window.handleAdminShopSiteChange = handleAdminShopSiteChange;',
        'window.openAdminShopShellContext = openAdminShopShellContext;',
        "window.AdminShell.registerModule('shop', {",
        'activate: (context = {}, options = {}) => window.ShopAdmin?.activate?.(context, options),',
        'handleContext: (context = {}, options = {}) => window.ShopAdmin?.handleShellContext?.(context, options),',
        'onSiteChange: handleAdminShopSiteChange,',
        'reload: handleAdminShopSiteChange'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(shopSource.includes(marker), true, `js/admin-shop.js should contain ${marker}`);
    }

    assert.equal(
        shopSource.includes('if (this.shopContextListenersBound || window.AdminShell?.registerModule) {'),
        true,
        'js/admin-shop.js should skip the legacy admin-site-changed listener when the shell lifecycle is available'
    );
});

test('tickets module initializes through shell activation and routes context through the shell lifecycle', () => {
    const ticketsSource = readRepoFile('js/admin-tickets.js');

    const requiredMarkers = [
        'normalizeShellContextObject: function (value) {',
        'activate: async function (context = {}, options = {}) {',
        'handleShellContext: async function (context = {}, options = {}) {',
        'handleShellSiteChange: function () {',
        'async function openAdminTicketsShellContext(context = {}, options = {}) {',
        'function handleAdminTicketsSiteChange(detail = {}) {',
        'function activateVisibleTicketsModuleOnAccess() {',
        'window.handleAdminTicketsSiteChange = handleAdminTicketsSiteChange;',
        'window.openAdminTicketsShellContext = openAdminTicketsShellContext;',
        "window.AdminShell.registerModule('tickets', {",
        'activate: (context = {}, options = {}) => window.AdminTickets?.activate?.(context, options),',
        'handleContext: (context = {}, options = {}) => window.AdminTickets?.handleShellContext?.(context, options),',
        'onSiteChange: handleAdminTicketsSiteChange,',
        'reload: handleAdminTicketsSiteChange'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(ticketsSource.includes(marker), true, `js/admin-tickets.js should contain ${marker}`);
    }
});

test('chat module initializes through shell activation while keeping instance reuse and site refresh in the shell lifecycle', () => {
    const chatSource = readRepoFile('js/admin-chat.js');

    const requiredMarkers = [
        'function ensureAdminChatInstance(options = {}) {',
        'async function activateChatModule(context = {}, options = {}) {',
        'async function handleChatModuleContext(context = {}, options = {}) {',
        'async function handleChatModuleSiteChange() {',
        'function activateVisibleChatModuleOnAccess() {',
        'window.handleAdminChatModuleSiteChange = handleChatModuleSiteChange;',
        "window.AdminShell.registerModule('chat', {",
        'activate: activateChatModule,',
        'handleContext: handleChatModuleContext,',
        'onSiteChange: handleChatModuleSiteChange'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(chatSource.includes(marker), true, `js/admin-chat.js should contain ${marker}`);
    }
});

test('workbench fallbacks reuse module activation instead of direct init bootstraps', () => {
    const analyticsWorkbenchSource = readRepoFile('js/admin-analytics-workbench.js');
    const adminWorkbenchSource = readRepoFile('js/admin-workbench.js');
    const chatSource = readRepoFile('js/admin-chat.js');
    const commentsSource = readRepoFile('admin-comments.js');

    const requiredMarkers = [
        [analyticsWorkbenchSource, 'await window.AdminPayments?.activate?.({', 'js/admin-analytics-workbench.js should activate payments in fallback paths'],
        [analyticsWorkbenchSource, 'await window.AdminTickets?.activate?.({', 'js/admin-analytics-workbench.js should activate tickets in fallback paths'],
        [adminWorkbenchSource, 'await window.AdminPayments?.activate?.({', 'js/admin-workbench.js should activate payments in fallback paths'],
        [adminWorkbenchSource, 'await window.AdminTickets?.activate?.({', 'js/admin-workbench.js should activate tickets in fallback paths'],
        [adminWorkbenchSource, 'await window.ShopAdmin?.activate?.({', 'js/admin-workbench.js should activate shop in fallback paths'],
        [chatSource, 'await window.ShopAdmin?.activate?.({', 'js/admin-chat.js should activate shop in alert fallback paths'],
        [chatSource, 'await window.AdminPayments?.activate?.({', 'js/admin-chat.js should activate payments in alert fallback paths'],
        [commentsSource, 'await window.AdminTickets?.activate?.({', 'admin-comments.js should activate tickets before focusing linked records']
    ];

    for (const [source, marker, message] of requiredMarkers) {
        assert.equal(source.includes(marker), true, message);
    }

    const removedMarkers = [
        [analyticsWorkbenchSource, 'await window.AdminPayments?.init?.();', 'js/admin-analytics-workbench.js should no longer call payments init directly in fallback paths'],
        [analyticsWorkbenchSource, 'await window.AdminTickets?.init?.();', 'js/admin-analytics-workbench.js should no longer call tickets init directly in fallback paths'],
        [adminWorkbenchSource, 'await window.AdminPayments?.init?.();', 'js/admin-workbench.js should no longer call payments init directly in fallback paths'],
        [adminWorkbenchSource, 'await window.AdminTickets?.init?.();', 'js/admin-workbench.js should no longer call tickets init directly in fallback paths'],
        [adminWorkbenchSource, 'await window.ShopAdmin?.init?.();', 'js/admin-workbench.js should no longer call shop init directly in fallback paths'],
        [chatSource, 'await window.ShopAdmin?.init?.();', 'js/admin-chat.js should no longer call shop init directly in alert fallback paths'],
        [chatSource, 'await window.AdminPayments?.init?.();', 'js/admin-chat.js should no longer call payments init directly in alert fallback paths'],
        [commentsSource, 'await window.AdminTickets?.init?.();', 'admin-comments.js should no longer call tickets init directly before focusing linked records']
    ];

    for (const [source, marker, message] of removedMarkers) {
        assert.equal(source.includes(marker), false, message);
    }
});
