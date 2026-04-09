const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('shop discount validation is no longer handled by public table reads in the user client', () => {
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const sharedShopHandlerSource = readRepoFile(path.join('server', 'api-handlers', 'public', 'shop.js'));

    assert.doesNotMatch(
        shopClientSource,
        /\.from\(['"]discount_codes['"]\)\s*\.select\(\s*['"]\*['"]\s*\)/s,
        'shop-client.js should not fetch discount_codes directly from the browser anymore'
    );
    assert.match(
        shopClientSource,
        /fetch\('\/api\/shop\/validate-discount'/,
        'shop-client.js should validate discounts through the hardened API route'
    );
    assert.doesNotMatch(
        shopClientSource,
        /\.rpc\('fn_purchase_shop_item'/,
        'shop-client.js should no longer call the purchase RPC directly from the browser'
    );
    assert.match(
        shopClientSource,
        /fetch\('\/api\/shop\/purchase'/,
        'shop-client.js should submit purchases through the hardened API route'
    );
    assert.match(
        sharedShopHandlerSource,
        /requireAuthenticatedUser/,
        'shared shop handlers should require an authenticated user'
    );
    assert.match(
        sharedShopHandlerSource,
        /takeRateLimitToken/,
        'shared shop handlers should apply rate limiting'
    );
    assert.match(
        sharedShopHandlerSource,
        /rpc\('fn_validate_discount_code'/,
        'shop discount validation route should delegate to the server-side discount RPC'
    );
    assert.match(
        sharedShopHandlerSource,
        /duplicate_submission/,
        'shop purchase route should reject duplicate submissions through an idempotency guard'
    );
    assert.match(
        sharedShopHandlerSource,
        /rpc\('fn_purchase_shop_item'/,
        'shop purchase route should delegate to the server-side purchase RPC'
    );
});

test('shop migration restores site-aware pricing, balance isolation, and secure discount validation', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260326_harden_shop_discount_and_site_isolation.sql'));

    assert.match(
        migrationSql,
        /DROP POLICY IF EXISTS "Public read active discount codes" ON public\.discount_codes;/,
        'shop hardening migration should remove the public discount-code read policy'
    );
    assert.match(
        migrationSql,
        /CREATE OR REPLACE FUNCTION public\.fn_validate_discount_code\(/,
        'shop hardening migration should define the discount preview RPC'
    );
    assert.match(
        migrationSql,
        /price_points_intl/,
        'shop hardening migration should consult the intl price field'
    );
    assert.match(
        migrationSql,
        /WHERE user_id = v_effective_user_id\s+AND site = v_site/s,
        'shop hardening migration should scope balance reads and writes to the active site'
    );
    assert.match(
        migrationSql,
        /INSERT INTO public\.shop_orders\s*\(\s*user_id,\s*product_id,\s*price_paid,\s*total_price,\s*item_count,\s*snapshot_product_name,\s*discount_code,\s*discount_amount,\s*site/s,
        'shop hardening migration should stamp the site onto shop orders'
    );
    assert.match(
        migrationSql,
        /INSERT INTO public\.points_ledger \(user_id, amount, reason, reference_id, site\)/,
        'shop hardening migration should keep shop ledger writes site-aware'
    );
});

test('follow-up shop hardening adds a server-side quantity cap and removes direct ledger update grants', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260326_harden_shop_quantity_cap_and_ledger_update_grants.sql'));
    const walletModalSource = readRepoFile(path.join('js', 'components', 'WalletModal.js'));

    assert.match(
        migrationSql,
        /v_max_quantity INT := 99;/,
        'follow-up hardening migration should define an explicit server-side purchase quantity cap'
    );
    assert.match(
        migrationSql,
        /IF p_quantity > v_max_quantity THEN\s+RETURN jsonb_build_object\('success', false, 'message', '单次购买数量不能超过' \|\| v_max_quantity\);/s,
        'shop purchase and discount validation RPCs should reject oversized quantities on the server'
    );
    assert.match(
        walletModalSource,
        /rpc\('fn_clear_user_history'\)/,
        'wallet history clearing should continue to go through the controlled RPC'
    );
    assert.match(
        migrationSql,
        /CREATE OR REPLACE FUNCTION public\.fn_clear_user_history\(\)\s+RETURNS INTEGER\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/s,
        'history clearing should remain behind a SECURITY DEFINER function with a fixed search_path'
    );
    assert.match(
        migrationSql,
        /REVOKE UPDATE ON public\.points_ledger FROM authenticated;/,
        'authenticated users should no longer keep blanket UPDATE access on points_ledger'
    );
});

test('shop policy-control migration adds per-product caps and zero-total discount guardrails', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260326_add_shop_purchase_policy_controls.sql'));

    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS max_purchase_quantity INT;/,
        'policy-control migration should add a per-product max_purchase_quantity column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS allow_zero_total BOOLEAN DEFAULT false;/,
        'policy-control migration should add the allow_zero_total flag to discount_codes'
    );
    assert.match(
        migrationSql,
        /当前商品单次最多购买/,
        'discount preview and purchase RPCs should reject quantities above a product-specific cap'
    );
    assert.match(
        migrationSql,
        /NOT COALESCE\(v_discount_record\.allow_zero_total, false\)/,
        'discount preview and purchase RPCs should consult the allow_zero_total flag before approving a zero-total order'
    );
    assert.match(
        migrationSql,
        /该优惠码不允许全额抵扣/,
        'policy-control migration should return a clear failure when a non-whitelisted discount would zero out the order'
    );
});

test('cumulative purchase-limit migration adds admin-managed bypass entitlements and rolling caps', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260326_add_shop_cumulative_purchase_limits_and_unlimited_purchase_entitlements.sql'));

    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS purchase_limit_24h_quantity INT,/,
        'cumulative-limit migration should add a 24-hour per-user purchase cap column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS purchase_limit_window_minutes INT,/,
        'cumulative-limit migration should add a rolling window duration column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS purchase_limit_window_quantity INT,/,
        'cumulative-limit migration should add a rolling window quantity cap column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS per_account_purchase_limit INT;/,
        'cumulative-limit migration should add a lifetime per-account purchase cap column'
    );
    assert.match(
        migrationSql,
        /CREATE TABLE IF NOT EXISTS public\.user_purchase_entitlements/,
        'cumulative-limit migration should introduce a dedicated user purchase entitlement table'
    );
    assert.match(
        migrationSql,
        /unlimited_shop_purchases BOOLEAN NOT NULL DEFAULT false/,
        'purchase entitlement table should persist the unlimited-purchase bypass flag'
    );
    assert.match(
        migrationSql,
        /pg_advisory_xact_lock\(60424, hashtext\(v_purchase_limit_lock_name\)\)/,
        'purchase RPC should serialize cumulative purchase-limit enforcement per user and product'
    );
    assert.match(
        migrationSql,
        /当前账号在24小时内最多还可购买/,
        'cumulative-limit migration should return a clear 24-hour cap failure message'
    );
    assert.match(
        migrationSql,
        /当前账号在最近' \|\| v_product\.purchase_limit_window_minutes \|\| '分钟内最多还可购买/,
        'cumulative-limit migration should return a clear rolling-window cap failure message'
    );
});

test('discount scope-control migration adds site, scope, and per-user coupon guardrails', () => {
    const migrationSql = readRepoFile(path.join('supabase', 'migrations', '20260327_add_discount_scope_controls.sql'));

    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS applicable_site VARCHAR\(10\),/,
        'discount scope-control migration should add an optional site restriction column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS max_uses_per_user INT DEFAULT 0,/,
        'discount scope-control migration should add a per-user coupon usage cap column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS scope_type VARCHAR\(20\) DEFAULT 'all',/,
        'discount scope-control migration should add an explicit scope type column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS scope_category VARCHAR\(100\),/,
        'discount scope-control migration should add a category scope column'
    );
    assert.match(
        migrationSql,
        /ADD COLUMN IF NOT EXISTS scope_product_id UUID;/,
        'discount scope-control migration should add a product scope column'
    );
    assert.match(
        migrationSql,
        /discount_codes_scope_target_check/,
        'discount scope-control migration should constrain the allowed scope target combinations'
    );
    assert.match(
        migrationSql,
        /该优惠码仅适用于指定站点/,
        'discount preview and purchase RPCs should reject coupons outside their site scope'
    );
    assert.match(
        migrationSql,
        /该优惠码仅适用于指定分类商品/,
        'discount preview and purchase RPCs should reject coupons outside their category scope'
    );
    assert.match(
        migrationSql,
        /该优惠码仅适用于指定商品/,
        'discount preview and purchase RPCs should reject coupons outside their product scope'
    );
    assert.match(
        migrationSql,
        /当前账号已达到该优惠码的使用上限/,
        'discount preview and purchase RPCs should enforce per-user usage caps'
    );
    assert.match(
        migrationSql,
        /scope_category IS 'Required when scope_type=category\. Stores the category name used by shop_products\.category\.'/,
        'scope-control migration should document that category restrictions use the shop product category name'
    );
});

test('site-aware product filtering and admin discount semantics stay aligned in the frontend', () => {
    const siteConfigSource = readRepoFile(path.join('js', 'site-config.js'));
    const indexBootstrapSource = readRepoFile(path.join('js', 'index-home-bootstrap.js'));
    const framerHomeSource = readRepoFile(path.join('js', 'framer_home.js'));
    const prefetchHomeSource = readRepoFile(path.join('js', 'prefetch-home.js'));
    const adminDiscountsSource = readRepoFile('admin-discounts.js');

    assert.match(
        siteConfigSource,
        /filterProductsForCurrentSite: function \(products\)/,
        'SiteConfig should expose a reusable current-site product filter'
    );
    assert.match(
        indexBootstrapSource,
        /site: currentSite/,
        'shop prefetch payloads should carry the current site so stale caches do not bleed across sites'
    );
    assert.match(
        framerHomeSource,
        /filterProductsForCurrentSite/,
        'homepage shop aggregation should filter out products not sold on the current site'
    );
    assert.match(
        prefetchHomeSource,
        /filteredShopResult/,
        'homepage prefetch should only cache site-compatible shop products'
    );
    assert.match(
        adminDiscountsSource,
        /formatPercentDiscountValue/,
        'admin discounts UI should format percentage discounts with the same fold semantics used at checkout'
    );
});

test('admin and storefront surfaces wire the purchase-policy controls through to the hardened backend', () => {
    const adminStudioSource = readRepoFile('admin-studio.html');
    const adminShopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const adminDiscountsSource = readRepoFile('admin-discounts.js');
    const shopClientSource = readRepoFile(path.join('js', 'shop-client.js'));
    const adminUsersSource = readRepoFile('admin-users.js');

    assert.match(
        adminStudioSource,
        /id="prodMaxPurchaseQuantity"/,
        'admin product modal should expose the per-product max purchase quantity field'
    );
    assert.match(
        adminShopSource,
        /max_purchase_quantity: normalizedMaxPurchaseQuantity/,
        'admin product save flow should persist the per-product max purchase quantity'
    );
    assert.match(
        adminStudioSource,
        /id="prodPurchaseLimit24hQuantity"/,
        'admin product modal should expose the 24-hour cumulative purchase cap field'
    );
    assert.match(
        adminStudioSource,
        /id="prodPurchaseLimitWindowQuantity"/,
        'admin product modal should expose the rolling-window quantity cap field'
    );
    assert.match(
        adminStudioSource,
        /id="prodPurchaseLimitWindowMinutes"/,
        'admin product modal should expose the rolling-window duration field'
    );
    assert.match(
        adminStudioSource,
        /id="prodPerAccountPurchaseLimit"/,
        'admin product modal should expose the lifetime per-account cap field'
    );
    assert.match(
        adminShopSource,
        /purchase_limit_24h_quantity: normalizedPurchaseLimit24hQuantity/,
        'admin product save flow should persist the 24-hour cumulative purchase cap'
    );
    assert.match(
        adminShopSource,
        /purchase_limit_window_quantity: normalizedPurchaseLimitWindowQuantity/,
        'admin product save flow should persist the rolling-window quantity cap'
    );
    assert.match(
        adminShopSource,
        /purchase_limit_window_minutes: normalizedPurchaseLimitWindowMinutes/,
        'admin product save flow should persist the rolling-window duration'
    );
    assert.match(
        adminShopSource,
        /per_account_purchase_limit: normalizedPerAccountPurchaseLimit/,
        'admin product save flow should persist the lifetime per-account cap'
    );
    assert.match(
        adminStudioSource,
        /id="discountAllowZeroTotal"/,
        'admin discount modal should expose the allow-zero-total toggle'
    );
    assert.match(
        adminDiscountsSource,
        /allow_zero_total: allowZeroTotal/,
        'discount creation should persist the allow_zero_total flag'
    );
    assert.match(
        adminStudioSource,
        /id="discountApplicableSite"/,
        'admin discount modal should expose the site-restriction field'
    );
    assert.match(
        adminStudioSource,
        /id="discountMaxUsesPerUser"/,
        'admin discount modal should expose the per-user usage cap field'
    );
    assert.match(
        adminStudioSource,
        /id="discountScopeType"/,
        'admin discount modal should expose the scope-type selector'
    );
    assert.match(
        adminStudioSource,
        /id="discountScopeCategory"/,
        'admin discount modal should expose the category scope selector'
    );
    assert.match(
        adminStudioSource,
        /id="discountScopeProduct"/,
        'admin discount modal should expose the product scope selector'
    );
    assert.match(
        adminDiscountsSource,
        /max_uses_per_user: maxUsesPerUser/,
        'discount creation should persist the per-user usage cap'
    );
    assert.match(
        adminDiscountsSource,
        /applicable_site: applicableSite/,
        'discount creation should persist the optional site restriction'
    );
    assert.match(
        adminDiscountsSource,
        /scope_type: scopeType/,
        'discount creation should persist the coupon scope type'
    );
    assert.match(
        adminDiscountsSource,
        /scope_category: scopeCategory/,
        'discount creation should persist the scoped category name'
    );
    assert.match(
        adminDiscountsSource,
        /scope_product_id: scopeProductId/,
        'discount creation should persist the scoped product id'
    );
    assert.match(
        shopClientSource,
        /dataset\.maxPurchaseQuantity = String\(maxPurchaseQuantity\);/,
        'shop product cards should pass the product-specific cap into the purchase modal'
    );
    assert.match(
        shopClientSource,
        /\.from\('user_purchase_entitlements'\)/,
        'shop client should read the current user purchase entitlement before clamping bulk purchase quantities'
    );
    assert.match(
        shopClientSource,
        /quantityInput\.removeAttribute\('max'\)/,
        'unlimited-purchase users should have the purchase modal max attribute removed'
    );
    assert.match(
        adminUsersSource,
        /id="modalUnlimitedPurchasesToggle"/,
        'user detail permissions panel should expose the unlimited-purchase override checkbox'
    );
    assert.match(
        adminUsersSource,
        /\.from\('user_purchase_entitlements'\)\s*\.upsert/s,
        'saving user permissions should persist the unlimited-purchase entitlement'
    );
    assert.match(
        adminUsersSource,
        /\.from\('user_purchase_entitlements'\)\s*\.select\('unlimited_shop_purchases'\)/s,
        'user detail modal should load the unlimited-purchase entitlement when opening the permissions panel'
    );
});
