const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('wallet shop order detail reads route through PointsService cache and modal prefetch hooks', () => {
    const pointsServiceSource = readRepoFile('js/services/PointsService.js');
    const walletModalSource = readRepoFile('js/components/WalletModal.js');

    const pointsServiceMarkers = [
        'const WALLET_SHOP_ORDER_DETAIL_CACHE_TTL_MS = 60_000;',
        'peekWalletShopOrderDetail({ orderId = \'\' } = {})',
        'getWalletShopOrderDetail({ orderId = \'\', force = false } = {})',
        "this._postWalletJson('/api/wallet/order-detail', {",
        'this._shopOrderDetailPromises = new Map()'
    ];

    for (const marker of pointsServiceMarkers) {
        assert.equal(pointsServiceSource.includes(marker), true, `js/services/PointsService.js should contain ${marker}`);
    }

    const walletMarkers = [
        'prefetchShopOrderDetails(orders = [], { limit = 4 } = {})',
        'this.prefetchShopOrderDetails(this._prefetchedShopOrders, { limit: 4 });',
        'this.prefetchShopOrderDetails(orders, { limit: 4 });',
        'buildWalletShopOrderPreviewMarkup(orderId = \'\', previewOrder = {})',
        'const previewOrder = this.findShopOrderPreview(orderId);',
        'pointsService?.peekWalletShopOrderDetail?.({ orderId })',
        'await pointsService.getWalletShopOrderDetail({ orderId })'
    ];

    for (const marker of walletMarkers) {
        assert.equal(walletModalSource.includes(marker), true, `js/components/WalletModal.js should contain ${marker}`);
    }
});

test('shop order detail handler skips unnecessary item lookups and parallelizes guidance loading', () => {
    const shopHandlerSource = readRepoFile('server/api-handlers/public/shop.js');

    const markers = [
        "const needsOrderItems = normalizedItemCount > 1 || !String(order?.inventory_id || '').trim();",
        'const guidancePromise = (async () => {',
        'const [orderItems, guidance] = await Promise.all(['
    ];

    for (const marker of markers) {
        assert.equal(shopHandlerSource.includes(marker), true, `server/api-handlers/public/shop.js should contain ${marker}`);
    }
});

test('shop purchase handler keeps post-purchase bookkeeping off the response path without reloading guidance', () => {
    const shopHandlerSource = readRepoFile('server/api-handlers/public/shop.js');

    const markers = [
        'const responseUsageInstructions = normalizeGuidanceText(responseData.usage_instructions);',
        'const responseHasUsageInstructions = responseData.show_usage_instructions === true',
        'async function safeProcessShopPurchaseRewards(supabase, { orderId = \'\', site = \'cn\' } = {})',
        'function scheduleShopPurchaseFollowups(followupTask) {',
        "if (typeof setImmediate === 'function') {",
        'scheduleShopPurchaseFollowups(async () => {',
        'await safeProcessShopPurchaseRewards(systemSupabase, {'
    ];

    for (const marker of markers) {
        assert.equal(shopHandlerSource.includes(marker), true, `server/api-handlers/public/shop.js should contain ${marker}`);
    }

    assert.equal(
        shopHandlerSource.includes('const guidancePromise = loadProductGuidance(requestAdminSupabase || adminSupabase || supabase, {'),
        false,
        'server/api-handlers/public/shop.js should not block purchase success on a guidance refetch'
    );
    assert.equal(
        shopHandlerSource.includes('await Promise.all([\n                        affiliateLinkagePromise,\n                        paidTagPromise'),
        false,
        'server/api-handlers/public/shop.js should not block purchase success on post-purchase follow-ups'
    );
});

test('shop purchase handler emits segmented server timing diagnostics for bottleneck tracing', () => {
    const shopHandlerSource = readRepoFile('server/api-handlers/public/shop.js');

    const markers = [
        'function createServerTimingTracker() {',
        "res.setHeader('Server-Timing', serverTimingValue);",
        'const authPromise = (async () => {',
        'const bodyPromise = parseJsonBody(req);',
        'const [userRateLimit, idempotencyResult] = await Promise.all([',
        'const rpcPhaseName = payload.discountSelections.length > 1',
        'recordServerTimingPhase(timingTracker, rpcPhaseName, rpcStartedAt);',
        "recordServerTimingPhase(timingTracker, 'shop-purchase-followups'",
        'function maybeLogSlowPurchaseTiming(summary = {}, context = {}) {'
    ];

    for (const marker of markers) {
        assert.equal(shopHandlerSource.includes(marker), true, `server/api-handlers/public/shop.js should contain ${marker}`);
    }
});

test('shop purchase rpc hot path migration collapses repeated scans and balance reads', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260509_optimize_shop_purchase_rpc_hot_path.sql');
    const purchaseFunctionSource = migrationSource.slice(migrationSource.indexOf('CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item('));

    const markers = [
        "CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(",
        'v_purchase_limit_24h_started_at TIMESTAMPTZ := NULL;',
        'v_purchase_limit_window_started_at TIMESTAMPTZ := NULL;',
        'COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT,',
        'SELECT total_balance, bonus_balance, paid_balance',
        'inventory_id,',
        'delivery_status,',
        'SET delivery_task_id = v_task_id',
        'INSERT INTO public.shop_purchase_reward_jobs ('
    ];

    for (const marker of markers) {
        assert.equal(migrationSource.includes(marker), true, `supabase/migrations/20260509_optimize_shop_purchase_rpc_hot_path.sql should contain ${marker}`);
    }

    assert.equal(
        migrationSource.includes('SELECT bonus_balance, paid_balance\n            INTO v_current_bonus, v_current_paid'),
        false,
        'optimized shop purchase migration should not re-read points_balance after locking it once'
    );
    assert.equal(
        migrationSource.includes("WHEN v_product.delivery_type = 'API' THEN 0\n            ELSE NULL"),
        false,
        'optimized shop purchase migration should not write a null delivery attempt count for KEY orders'
    );
    assert.equal(
        purchaseFunctionSource.includes('FROM public.system_config'),
        false,
        'optimized shop purchase RPC should defer affiliate config reads out of the user-facing hot path'
    );
    assert.equal(
        purchaseFunctionSource.includes('FROM public.pending_referral_rewards'),
        false,
        'optimized shop purchase RPC should defer pending referral reward reads out of the user-facing hot path'
    );
});

test('shop purchase reward job migration keeps deferred reward processing idempotent', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260509_optimize_shop_purchase_rpc_hot_path.sql');

    const markers = [
        'CREATE TABLE IF NOT EXISTS public.shop_purchase_reward_jobs',
        'CREATE OR REPLACE FUNCTION public.fn_process_shop_purchase_rewards(',
        "IF COALESCE(v_job.status, '') = 'processed' THEN",
        "WHERE user_id = v_inviter_id\n              AND reference_id = v_affiliate_reference_id",
        "WHERE user_id = v_job.agent_id\n              AND reference_id = 'AGENT_PROF_' || p_order_id::TEXT",
        "WHERE user_id = v_pending_reward.inviter_id\n              AND reference_id = 'REG_REWARD_UNLOCK_' || p_order_id::TEXT",
        "GRANT EXECUTE ON FUNCTION public.fn_process_shop_purchase_rewards(UUID, VARCHAR) TO service_role;"
    ];

    for (const marker of markers) {
        assert.equal(migrationSource.includes(marker), true, `supabase/migrations/20260509_optimize_shop_purchase_rpc_hot_path.sql should contain ${marker}`);
    }
});

test('shop purchase delivery attempt count follow-up migration guards the non-null insert', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260509_optimize_shop_purchase_rpc_zz_delivery_attempt_count_fix.sql');
    const purchaseFunctionSource = migrationSource.slice(migrationSource.indexOf('CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item('));

    assert.equal(
        migrationSource.includes('Fix shop purchase delivery attempt count null regression'),
        true,
        'delivery attempt count fix migration should describe the null regression it patches'
    );
    assert.equal(
        migrationSource.includes("WHEN v_product.delivery_type = 'API' THEN 0\n            ELSE NULL"),
        false,
        'delivery attempt count fix migration should never write null into delivery_attempt_count'
    );
    assert.equal(
        migrationSource.includes('\n        0,\n        v_site\n    )'),
        true,
        'delivery attempt count fix migration should insert a concrete zero attempt count for every new shop order'
    );
    assert.equal(
        purchaseFunctionSource.includes('INSERT INTO public.shop_purchase_reward_jobs ('),
        true,
        'delivery attempt count fix migration should preserve deferred reward jobs in the optimized purchase RPC'
    );
    assert.equal(
        purchaseFunctionSource.includes('FROM public.system_config'),
        false,
        'delivery attempt count fix migration should not reintroduce affiliate config reads into the purchase hot path'
    );
    assert.equal(
        purchaseFunctionSource.includes('FROM public.pending_referral_rewards'),
        false,
        'delivery attempt count fix migration should not reintroduce pending referral reward reads into the purchase hot path'
    );
});

test('shop purchase hot-path index migration covers purchase-cap and discount reuse lookups', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260509_add_shop_purchase_hot_path_indexes.sql');

    const markers = [
        'CREATE INDEX IF NOT EXISTS idx_shop_orders_purchase_limit_active_window',
        'ON public.shop_orders (user_id, product_id, created_at DESC)',
        'INCLUDE (item_count)',
        "WHERE COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund')",
        'CREATE INDEX IF NOT EXISTS idx_shop_orders_discount_user_active',
        'ON public.shop_orders (user_id, discount_code, created_at DESC)',
        "WHERE NULLIF(BTRIM(COALESCE(discount_code, '')), '') IS NOT NULL",
        'CREATE INDEX IF NOT EXISTS idx_shop_inventory_available_purchase',
        'ON public.shop_inventory (product_id, id)',
        'INCLUDE (content)',
        'CREATE INDEX IF NOT EXISTS idx_shop_inventory_available_stock_sync',
        "WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'available'"
    ];

    for (const marker of markers) {
        assert.equal(migrationSource.includes(marker), true, `supabase/migrations/20260509_add_shop_purchase_hot_path_indexes.sql should contain ${marker}`);
    }
});

test('shop inventory stock sync hot-path migration batches trigger recounts per statement', () => {
    const migrationSource = readRepoFile('supabase/migrations/20260509_optimize_shop_inventory_stock_sync_hot_path.sql');

    const markers = [
        'CREATE OR REPLACE FUNCTION public.fn_sync_shop_product_stock_counts(p_product_ids UUID[])',
        'CREATE OR REPLACE FUNCTION public.fn_trigger_update_stock_count_update_statement()',
        'DROP TRIGGER IF EXISTS tr_shop_inventory_stock ON public.shop_inventory;',
        'CREATE TRIGGER tr_shop_inventory_stock_update',
        'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows',
        'FOR EACH STATEMENT',
        'GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) TO service_role;'
    ];

    for (const marker of markers) {
        assert.equal(migrationSource.includes(marker), true, `supabase/migrations/20260509_optimize_shop_inventory_stock_sync_hot_path.sql should contain ${marker}`);
    }

    assert.equal(
        migrationSource.includes('FOR EACH ROW'),
        false,
        'optimized inventory stock sync should not recount stock once per updated inventory row'
    );
});
