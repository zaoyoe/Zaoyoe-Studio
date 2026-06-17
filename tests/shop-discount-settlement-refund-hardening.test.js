const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260617_harden_discount_settlement_and_refunds.sql'
);

function readMigration() {
    return fs.readFileSync(migrationPath, 'utf8');
}

test('discount per-user limits count stacked coupon snapshots and ignore refunded orders', () => {
    const source = readMigration();

    assert.match(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_shop_discount_user_net_use_count\(/,
        'migration should add a shared net coupon-use counter'
    );
    assert.match(
        source,
        /discount_snapshot -> 'applied_discounts'[\s\S]*applied_discount ->> 'code'[\s\S]*applied_discount ->> 'discount_code'/,
        'counter should inspect multi-coupon snapshots, not only the legacy discount_code column'
    );
    assert.match(
        source,
        /COALESCE\(o\.refund_status, 'none'\) NOT IN \('refunded', 'full_refund'\)/,
        'counter should exclude refunded orders from per-user coupon usage'
    );
    assert.match(
        source,
        /SELECT public\.fn_shop_discount_user_net_use_count\(v_effective_user_id, v_discount_code\)/,
        'single-coupon validation should use the snapshot-aware counter'
    );
    assert.match(
        source,
        /SELECT public\.fn_shop_discount_user_net_use_count\(v_effective_user_id, v_discount_row\.code\)/,
        'multi-coupon purchases should recheck per-user usage inside the locked purchase flow'
    );
});

test('multi-coupon purchase locks coupon and asset quotas before settlement', () => {
    const source = readMigration();

    assert.match(
        source,
        /v_site VARCHAR := LOWER\(COALESCE\(NULLIF\(BTRIM\(COALESCE\(p_site, ''\)\), ''\), 'cn'\)\);[\s\S]*IF v_site NOT IN \('cn', 'intl'\) THEN/,
        'multi-coupon purchases should normalize and validate site before touching balances'
    );
    assert.match(
        source,
        /v_preview_discount_id := NULLIF\(v_preview_data ->> 'discount_id', ''\)::UUID;/,
        'purchase flow should preserve the discount id returned by server validation'
    );
    assert.match(
        source,
        /FROM public\.discount_user_assets a[\s\S]*WHERE a\.id = v_effective_discount_asset_id[\s\S]*FOR UPDATE;[\s\S]*FROM public\.discount_codes d[\s\S]*WHERE d\.id = COALESCE\(v_asset_discount_id, v_preview_discount_id\)[\s\S]*FOR UPDATE;/,
        'purchase flow should lock asset-backed coupons before their discount rule to match the single-coupon flow'
    );
    assert.match(
        source,
        /FROM public\.discount_codes d[\s\S]*WHERE d\.id = COALESCE\(v_asset_discount_id, v_preview_discount_id\)[\s\S]*FOR UPDATE;/,
        'purchase flow should lock each discount rule before checking remaining uses'
    );
    assert.match(
        source,
        /IF v_discount_row\.code = ANY\(v_existing_discount_codes\)[\s\S]*同一张优惠券不能重复叠加/,
        'purchase flow should dedupe by the resolved rule code, including asset-only inputs'
    );
    assert.match(
        source,
        /FROM public\.discount_user_assets a[\s\S]*WHERE a\.id = v_effective_discount_asset_id[\s\S]*FOR UPDATE;/,
        'purchase flow should lock asset-backed coupons before marking them used'
    );
    assert.match(
        source,
        /IF v_effective_discount_asset_id IS NOT NULL[\s\S]*AND v_asset_discount_id IS DISTINCT FROM v_discount_row\.id[\s\S]*卡券与优惠码不匹配/,
        'asset-backed coupons should be rechecked against the locked discount rule'
    );
    assert.match(
        source,
        /CASE LOWER\(BTRIM\(COALESCE\(v_asset_status, 'available'\)\)\)[\s\S]*WHEN 'used'[\s\S]*WHEN 'expired'[\s\S]*WHEN 'revoked'/,
        'asset status should be revalidated under lock'
    );
    assert.match(
        source,
        /UPDATE public\.discount_codes[\s\S]*SET used_count = COALESCE\(used_count, 0\) \+ 1[\s\S]*COALESCE\(max_uses, 0\) <= 0[\s\S]*COALESCE\(used_count, 0\) < COALESCE\(max_uses, 0\)/,
        'global usage should be reserved with an atomic conditional update'
    );
    assert.match(
        source,
        /FOREACH v_reserved_discount_id IN ARRAY v_reserved_discount_ids LOOP[\s\S]*SET used_count = GREATEST\(0, COALESCE\(used_count, 0\) - 1\)/,
        'failed purchases should release any previously reserved coupon quota'
    );
});

test('stacked discounts settle wallets and point lots against the final payable amount', () => {
    const source = readMigration();

    assert.match(
        source,
        /FROM public\.fn_resolve_shop_discount_amount\([\s\S]*COALESCE\(\(v_discount_entry ->> 'max_discount_quantity'\)::INT, 0\)/,
        'stacked purchases should preserve the per-coupon maximum discounted quantity cap'
    );
    assert.match(
        source,
        /v_desired_bonus_points := LEAST\(v_original_bonus_balance, v_running_total\);[\s\S]*v_desired_paid_points := ROUND\(GREATEST\(v_running_total - v_desired_bonus_points, 0\), 2\);/,
        'wallet split should be recomputed from the final payable amount'
    );
    assert.match(
        source,
        /UPDATE public\.points_balance[\s\S]*paid_balance = ROUND\(GREATEST\(v_original_paid_balance - v_desired_paid_points, 0\), 2\)[\s\S]*bonus_balance = ROUND\(GREATEST\(v_original_bonus_balance - v_desired_bonus_points, 0\), 2\)/,
        'stored balances should be restored to original minus net payable after the temporary gross checkout'
    );
    assert.match(
        source,
        /DELETE FROM public\.wallet_point_lot_consumptions[\s\S]*fn_consume_wallet_point_lots_for_shop_order/,
        'wallet point lot consumptions should be rebuilt for the net payable amount'
    );
    assert.match(
        source,
        /basis', 'multi_discount_net_settlement'/,
        'order breakdown should mark stacked purchases as net settlements'
    );
    assert.match(
        source,
        /paid_points_spent = v_desired_paid_points,[\s\S]*bonus_points_spent = v_desired_bonus_points/,
        'order spend attribution should store the recomputed paid and bonus point split'
    );
    assert.doesNotMatch(
        source,
        /SHOP_STACK_DISCOUNT_/,
        'multi-coupon settlement should not create a synthetic top-up ledger entry'
    );
});

test('refund rpc restores stacked coupon usage, assets, and point-source attribution', () => {
    const source = readMigration();

    assert.match(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_admin_refund_order\(/,
        'migration should replace the refund rpc with the combined hardened version'
    );
    assert.match(
        source,
        /IF COALESCE\(auth\.role\(\), ''\) <> 'service_role' THEN/,
        'refund rpc should remain service-role only'
    );
    assert.match(
        source,
        /v_refund_paid_points := ROUND\(GREATEST\(COALESCE\(v_order\.paid_points_spent, v_refund_amount\), 0\), 2\);[\s\S]*v_refund_bonus_points := ROUND\(GREATEST\(COALESCE\(v_order\.bonus_points_spent, 0\), 0\), 2\);/,
        'refund rpc should preserve paid versus bonus point attribution'
    );
    assert.match(
        source,
        /FROM jsonb_array_elements\(v_applied_discounts\)[\s\S]*SET used_count = GREATEST\(0, COALESCE\(used_count, 0\) - 1\)/,
        'refund rpc should restore each stacked coupon usage counter'
    );
    assert.match(
        source,
        /UPDATE public\.discount_user_assets[\s\S]*SET asset_status = 'available'[\s\S]*event_type[\s\S]*'refund_restore'/,
        'refund rpc should restore asset-backed coupons and log the restore event'
    );
    assert.match(
        source,
        /points_spend_breakdown = COALESCE\(points_spend_breakdown, '\{\}'::JSONB\) \|\| jsonb_build_object\([\s\S]*'refund_paid_points', v_refund_paid_points[\s\S]*'refund_bonus_points', v_refund_bonus_points/,
        'refund metadata should record the paid and bonus point refund split'
    );
    assert.match(
        source,
        /REVOKE ALL ON FUNCTION public\.fn_admin_refund_order\(UUID, UUID, VARCHAR, TEXT\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.fn_admin_refund_order\(UUID, UUID, VARCHAR, TEXT\) TO service_role;/,
        'refund rpc grants should not reopen client-side execution'
    );
});
