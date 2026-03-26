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
    const validateDiscountRouteSource = readRepoFile(path.join('api', 'shop', 'validate-discount.js'));
    const purchaseRouteSource = readRepoFile(path.join('api', 'shop', 'purchase.js'));

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
        validateDiscountRouteSource,
        /requireAuthenticatedUser/,
        'shop discount validation route should require an authenticated user'
    );
    assert.match(
        validateDiscountRouteSource,
        /takeRateLimitToken/,
        'shop discount validation route should apply rate limiting'
    );
    assert.match(
        validateDiscountRouteSource,
        /rpc\('fn_validate_discount_code'/,
        'shop discount validation route should delegate to the server-side discount RPC'
    );
    assert.match(
        purchaseRouteSource,
        /requireAuthenticatedUser/,
        'shop purchase route should require an authenticated user'
    );
    assert.match(
        purchaseRouteSource,
        /takeRateLimitToken/,
        'shop purchase route should apply rate limiting'
    );
    assert.match(
        purchaseRouteSource,
        /duplicate_submission/,
        'shop purchase route should reject duplicate submissions through an idempotency guard'
    );
    assert.match(
        purchaseRouteSource,
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
