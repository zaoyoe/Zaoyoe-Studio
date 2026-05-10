const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('wallet realtime is the default fast path but never blocks modal fallback reads', () => {
    const walletModal = readRepoFile('js/components/WalletModal.js');
    const pointsService = readRepoFile('js/services/PointsService.js');
    const migration = readRepoFile('supabase/migrations/20260510_enable_wallet_realtime_publication.sql');
    const smokeScript = readRepoFile('scripts/realtime-production-smoke.js');
    const packageJson = JSON.parse(readRepoFile('package.json'));

    const walletMarkers = [
        'const WALLET_REALTIME_SUBSCRIBE_TIMEOUT_MS = 2600;',
        'const WALLET_REALTIME_DEGRADED_RETRY_MS = 30000;',
        'syncWalletRealtimeSubscription(user = null, options = {})',
        '.channel(`wallet-user-updates-${site}-${userId}`)',
        "table: 'points_balance'",
        "table: 'points_ledger'",
        "table: 'shop_orders'",
        "table: 'payment_orders'",
        "this.markWalletRealtimeDegraded('subscribe_timeout');",
        'void this.ensureWalletRealtimeForCurrentSession({ reason: \'wallet_prefetch\' });',
        "this.syncWalletRealtimeSubscription(session.user, { reason: 'wallet_open' });",
        'preserveExisting = false',
        'preserveExisting: true'
    ];

    for (const marker of walletMarkers) {
        assert.equal(walletModal.includes(marker), true, `WalletModal.js should contain ${marker}`);
    }

    assert.equal(
        pointsService.includes('force: options.force === true,'),
        true,
        'PointsService.getBalance should allow realtime refreshes to bypass stale overview cache'
    );

    for (const table of ['points_balance', 'points_ledger', 'shop_orders', 'payment_orders']) {
        assert.equal(
            migration.includes(`'${table}'`),
            true,
            `wallet realtime migration should include ${table}`
        );
    }

    assert.match(migration, /ALTER TABLE public\.points_balance ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /CREATE POLICY "Users view own points balance"/);
    assert.match(migration, /auth\.uid\(\) = user_id OR public\.is_admin\(\)/);

    assert.equal(
        packageJson.scripts['smoke:realtime-production'],
        'node scripts/realtime-production-smoke.js'
    );
    assert.match(smokeScript, /paid_balance: row\.paid_balance/);
    assert.match(smokeScript, /runOrderSmoke\(supabase, args, 'payment_orders'\)/);
    assert.match(smokeScript, /runOrderSmoke\(supabase, args, 'shop_orders'\)/);
    assert.match(smokeScript, /REALTIME_DEGRADED_STATUSES/);
    assert.match(smokeScript, /event: 'UPDATE'/);
});

test('notification realtime degrades to existing fetch retry instead of holding the drawer open', () => {
    const notificationClient = readRepoFile('notification-client.js');
    const engagementLoader = readRepoFile('js/engagement-runtime-loader.js');

    const markers = [
        'const NOTIFICATION_REALTIME_SUBSCRIBE_TIMEOUT_MS = 2600;',
        'const NOTIFICATION_REALTIME_RETRY_MS = 30000;',
        "const NOTIFICATION_SITE_SCOPED_SELECT_COLUMNS = 'id, title, content, type, category, scope, site, is_read, created_at, user_id';",
        "const NOTIFICATION_SITE_LEGACY_SELECT_COLUMNS = 'id, title, content, type, site, is_read, created_at, user_id';",
        "const NOTIFICATION_LEGACY_SELECT_COLUMNS = 'id, title, content, type, is_read, created_at, user_id';",
        'function markNotificationRealtimeDegraded(reason = \'channel_error\')',
        'function isMissingNotificationColumnError(error)',
        'async function selectNotificationsForUser(userId)',
        'function isNotificationForCurrentSite(notification)',
        'setupNotificationRealtime(normalizedUserId, { force: true, reason });',
        "event: '*'",
        "markNotificationRealtimeDegraded('subscribe_timeout');",
        "setNotificationRealtimeStatus('degraded', { reason });"
    ];

    for (const marker of markers) {
        assert.equal(notificationClient.includes(marker), true, `notification-client.js should contain ${marker}`);
    }

    assert.equal(
        notificationClient.includes(".select('id, title, content, type, category, is_read, is_pinned, created_at, user_id')"),
        false,
        'notification reads should not require the non-deployed is_pinned column'
    );
    assert.match(
        notificationClient,
        /site_scoped[\s\S]*site_legacy[\s\S]*scoped[\s\S]*legacy/,
        'notification reads should try site-scoped rows first and then fall back through older schemas'
    );

    assert.equal(
        engagementLoader.includes("const NOTIFICATION_SRC = 'notification-client.js?v=20260510_NOTIFICATION_SCHEMA_FALLBACK_1';"),
        true,
        'engagement runtime should cache-bust the notification schema fallback runtime'
    );
});

test('shared realtime guard keeps Pro-only subscriptions optional across public and admin surfaces', () => {
    const runtimeConfig = readRepoFile('js/runtime-supabase-config.js');
    const promptRuntime = readRepoFile('prompts-poetry.js');
    const guestbookRuntime = readRepoFile('supabase-guestbook-functions.js');
    const notificationManager = readRepoFile('js/notification-manager.js');
    const adminAnalytics = readRepoFile('js/admin-analytics-lifecycle.js');
    const adminChat = readRepoFile('js/admin-chat.js');
    const chatWidget = readRepoFile('js/components/ChatWidget.js');
    const adminUsers = readRepoFile('admin-users.js');

    for (const marker of [
        'function subscribeZaoyoeRealtime(options = {})',
        "const REALTIME_DEGRADED_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);",
        "markDegraded('subscribe_timeout');",
        "global.subscribeZaoyoeRealtime = subscribeZaoyoeRealtime;",
        "global.dispatchEvent?.(new CustomEvent('zaoyoe:realtime-state'"
    ]) {
        assert.equal(runtimeConfig.includes(marker), true, `runtime-supabase-config.js should contain ${marker}`);
    }

    assert.match(notificationManager, /this\.realtimeSubscribeTimers = new Map\(\)/);
    assert.match(notificationManager, /const realtimeTimeoutMs = Math\.max\(1000, Number\(config\.realtimeTimeoutMs \|\| 2600\) \|\| 2600\);/);
    assert.match(notificationManager, /markRealtimeDegraded\('subscribe_timeout'\)/);
    assert.match(notificationManager, /this\.startPolling\(config\);/);

    for (const source of [promptRuntime, guestbookRuntime, adminAnalytics, adminChat, chatWidget, adminUsers]) {
        assert.equal(
            source.includes('subscribeZaoyoeRealtime'),
            true,
            'Realtime callers should use the shared guard instead of assuming Pro Realtime is always available'
        );
    }

    assert.match(promptRuntime, /Realtime degraded, using on-open refresh only/);
    assert.match(guestbookRuntime, /keeping normal refresh\/post flow/);
    assert.match(adminAnalytics, /manual\/auto refresh remains available/);
    assert.match(adminChat, /polling\/manual refresh remains available/);
    assert.match(chatWidget, /polling\/manual refresh remains available/);
    assert.match(adminUsers, /30s refresh remains active/);

    for (const [label, source] of [
        ['admin-chat.js', adminChat],
        ['ChatWidget.js', chatWidget],
        ['prompts-poetry.js', promptRuntime],
        ['supabase-guestbook-functions.js', guestbookRuntime],
        ['admin-users.js', adminUsers],
        ['admin-analytics-lifecycle.js', adminAnalytics],
        ['notification-manager.js', notificationManager]
    ]) {
        assert.equal(
            /\.subscribe\(\);/.test(source),
            false,
            `${label} should not leave Realtime subscriptions without a status callback or guard`
        );
    }
});

test('Admin Studio ops realtime is aggregated and falls back to dashboard refreshes', () => {
    const adminAnalyticsRuntime = readRepoFile('admin-analytics.js');
    const adminAnalyticsLifecycle = readRepoFile('js/admin-analytics-lifecycle.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const migration = readRepoFile('supabase/migrations/20260510_enable_admin_ops_realtime_publication.sql');

    for (const marker of [
        'const ANALYTICS_OPS_REALTIME_REFRESH_DEBOUNCE_MS = 1500;',
        'opsRealtimeRefreshTimer: null',
        'opsRealtimeLastSource: \'\''
    ]) {
        assert.equal(adminAnalyticsRuntime.includes(marker), true, `admin-analytics.js should contain ${marker}`);
    }

    for (const marker of [
        'const ANALYTICS_OPS_REALTIME_TABLES = Object.freeze([',
        "table: 'ops_alert_jobs'",
        "table: 'ops_alert_cases'",
        "table: 'payment_orders'",
        "table: 'shop_orders'",
        "table: 'shop_products'",
        'function subscribeAnalyticsRealtimeChannel(options = {})',
        'function scheduleAnalyticsOpsRealtimeRefresh(sourceTable = \'\')',
        'function buildAnalyticsOpsRealtimeChannel(channel)',
        "channel: 'analytics-ops-events'",
        "feature: 'admin_analytics_ops'",
        "reason: 'ops-realtime'",
        'force: true',
        'Ops realtime degraded; manual/auto refresh remains available'
    ]) {
        assert.equal(adminAnalyticsLifecycle.includes(marker), true, `admin analytics lifecycle should contain ${marker}`);
    }

    assert.match(
        adminAnalyticsLifecycle,
        /getAnalyticsOpsRealtimeTables\(\)\.reduce\([\s\S]*postgres_changes[\s\S]*handleAnalyticsOpsRealtimePayload/,
        'ops realtime should use one aggregated channel builder instead of separate long connections'
    );
    assert.equal(
        /\.subscribe\(\);/.test(adminAnalyticsLifecycle),
        false,
        'admin analytics realtime should not leave subscriptions without a status callback or shared guard'
    );

    for (const table of ['ops_alert_jobs', 'ops_alert_cases', 'payment_orders', 'shop_orders', 'shop_products']) {
        assert.equal(migration.includes(`'${table}'`), true, `admin ops realtime migration should include ${table}`);
    }
    assert.match(migration, /GRANT SELECT ON TABLE public\.ops_alert_jobs TO authenticated/);
    assert.match(migration, /GRANT SELECT ON TABLE public\.ops_alert_cases TO authenticated/);
    assert.match(migration, /pg_publication_tables/);
    assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/);
    assert.match(migration, /public\.is_admin\(\)/);

    assert.equal(
        adminStudioHtml.includes('adminOpsRealtime=20260510_ADMIN_OPS_REALTIME_1'),
        true,
        'admin studio should cache-bust the admin ops realtime runtime'
    );
});

test('shop storefront realtime refreshes catalog and orders without replacing fallback reads', () => {
    const shopClient = readRepoFile('js/shop-client.js');
    const shopHtml = readRepoFile('shop.html');
    const migration = readRepoFile('supabase/migrations/20260510_enable_shop_storefront_realtime_publication.sql');

    for (const marker of [
        'const SHOP_REALTIME_SUBSCRIBE_TIMEOUT_MS = 2600;',
        'const SHOP_REALTIME_REFRESH_DEBOUNCE_MS = 650;',
        'const SHOP_REALTIME_RETRY_MS = 30000;',
        'setupStorefrontRealtime: async function ({ force = false, reason = \'init\' } = {})',
        'bindShopRealtimeAuthSync: function ()',
        "feature: 'shop-storefront'",
        "table: 'shop_products'",
        "table: 'shop_categories'",
        "table: 'shop_orders'",
        "filter: `user_id=eq.${userId}`",
        'this.scheduleShopRealtimeCatalogRefresh(sourceTable);',
        "this.scheduleShopRealtimeOrderRefresh('order_change');",
        'this.markStorefrontRealtimeDegraded(degradeReason);',
        'Realtime degraded, existing catalog/order reads remain available'
    ]) {
        assert.equal(shopClient.includes(marker), true, `js/shop-client.js should contain ${marker}`);
    }

    assert.equal(
        shopHtml.includes('js/shop-client.js?v=20260510_SHOP_REALTIME_FALLBACK_1'),
        true,
        'shop.html should cache-bust the storefront realtime fallback runtime'
    );

    for (const table of ['shop_products', 'shop_categories']) {
        assert.equal(migration.includes(`'${table}'`), true, `shop storefront realtime migration should include ${table}`);
        assert.match(migration, new RegExp(`ALTER PUBLICATION supabase_realtime ADD TABLE public\\.%I|ALTER PUBLICATION supabase_realtime ADD TABLE public\\.${table}`));
    }

    assert.equal(
        /\.subscribe\(\);/.test(shopClient),
        false,
        'shop storefront realtime should use the shared guard instead of a bare subscription'
    );
});
