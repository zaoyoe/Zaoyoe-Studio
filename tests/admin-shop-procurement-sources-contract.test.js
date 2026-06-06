const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop procurement source migration links imports to source batches and inventory cost snapshots', () => {
    const migration = readRepoFile('supabase/migrations/20260606_add_shop_inventory_procurement_sources.sql');

    for (const fragment of [
        'CREATE TABLE IF NOT EXISTS public.shop_inventory_sources',
        'CREATE TABLE IF NOT EXISTS public.shop_procurement_batches',
        'ADD COLUMN IF NOT EXISTS source_batch_id UUID',
        'ADD COLUMN IF NOT EXISTS purchase_unit_cost_cny NUMERIC',
        'shop_inventory_source_batch_id_fkey',
        'CREATE OR REPLACE FUNCTION public.fn_admin_list_inventory',
        'pb.batch_code AS procurement_batch_code',
        'src.source_name',
        'src.source_url',
        'purchase_unit_cost_cny',
        'Admins manage shop inventory sources',
        'Admins manage shop procurement batches'
    ]) {
        assert.equal(migration.includes(fragment), true, `migration should include ${fragment}`);
    }

    assert.match(migration, /UNIQUE \(site, batch_code\)/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_admin_list_inventory/);
});

test('shop order point spend migration persists paid and bonus balance attribution', () => {
    const migration = readRepoFile('supabase/migrations/20260606_add_shop_order_points_spend_breakdown.sql');

    for (const fragment of [
        'ADD COLUMN IF NOT EXISTS paid_points_spent NUMERIC(12,2)',
        'ADD COLUMN IF NOT EXISTS bonus_points_spent NUMERIC(12,2)',
        'ADD COLUMN IF NOT EXISTS points_spend_breakdown JSONB',
        'historical_untracked',
        'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)',
        'v_spent_bonus_points := v_deduct_bonus;',
        "''paid_points'', v_spent_paid_points",
        "''bonus_points'', v_spent_bonus_points",
        'SELECT public.fn_recharge_points(',
        'v_refund_paid_points',
        'v_refund_bonus_points',
        "to_regprocedure('public.fn_sync_shop_product_sku_stock_counts(uuid[])')",
        "EXECUTE 'SELECT public.fn_sync_shop_product_sku_stock_counts($1::uuid[])'",
        'GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;'
    ]) {
        assert.equal(migration.includes(fragment), true, `migration should include ${fragment}`);
    }

    assert.equal(
        migration.includes('GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order TO authenticated;'),
        false,
        'refund rpc should remain service-role only after spend split migration'
    );
});

test('shop admin frontend exposes order point spend attribution details', () => {
    const shopSource = readRepoFile('js/admin-shop.js');
    const adminStudioHtml = readRepoFile('admin-studio.html');

    for (const fragment of [
        'paid_points_spent',
        'bonus_points_spent',
        'untracked_revenue_points',
        '积分来源',
        '精确拆分',
        '历史估算'
    ]) {
        assert.equal(shopSource.includes(fragment), true, `admin-shop.js should include ${fragment}`);
    }

    assert.equal(
        adminStudioHtml.includes('pointsSpendBreakdown=20260606_ADMIN_SHOP_ORDER_POINTS_SPEND_BREAKDOWN_1'),
        true,
        'admin-studio.html should cache-bust the shop point-spend breakdown UI'
    );
});
