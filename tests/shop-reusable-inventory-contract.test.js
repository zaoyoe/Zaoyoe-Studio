const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop reusable inventory migration keeps shared delivery rows reusable', () => {
    const migration = readRepoFile('supabase/migrations/20260612_add_shop_reusable_inventory.sql');

    for (const marker of [
        'ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false',
        'CREATE INDEX IF NOT EXISTS idx_shop_inventory_reusable_available',
        'COALESCE(i.is_shared, false) AS is_shared',
        'CREATE OR REPLACE FUNCTION public.fn_admin_list_inventory',
        "POSITION('v_inventory_primary_id UUID := NULL;' IN v_definition) > 0",
        'COALESCE(is_shared, false) = false',
        'COALESCE(is_shared, false) = true',
        'generate_series(1, p_quantity)',
        'generate_series(1, v_quantity)',
        'AND COALESCE(is_shared, false) = false;',
        'failed to patch fn_purchase_shop_item_core with reusable inventory support',
        'failed to patch fn_create_marketplace_shop_order with reusable inventory support'
    ]) {
        assert.equal(migration.includes(marker), true, `migration should contain ${marker}`);
    }

    assert.match(
        migration,
        /SELECT id INTO v_reusable_inventory_id[\s\S]*COALESCE\(is_shared, false\) = true[\s\S]*LIMIT 1/,
        'purchase RPC patches should fall back to one reusable available row when one-time stock is insufficient'
    );
    assert.match(
        migration,
        /UPDATE public\.shop_inventory[\s\S]*SET status = ''sold''[\s\S]*WHERE id = ANY\(v_inventory_ids\)[\s\S]*AND COALESCE\(is_shared, false\) = false;/,
        'purchase RPC patches should never mark reusable rows as sold'
    );
});

test('shop priority inventory-source migration resolves and locks sources in order', () => {
    const migration = readRepoFile('supabase/migrations/20260613_add_shop_sku_inventory_source_priority.sql');
    const localPriorityPatch = readRepoFile('supabase/migrations/20260613_allow_shop_sku_local_priority_inventory_source.sql');
    const siteScopedPatch = readRepoFile('supabase/migrations/20260615_site_scoped_shop_sku_inventory_sources.sql');

    for (const marker of [
        'ADD COLUMN IF NOT EXISTS inventory_source_sku_ids UUID[]',
        'CREATE OR REPLACE FUNCTION public.fn_resolve_shop_sku_inventory_sources',
        'CREATE OR REPLACE FUNCTION public.fn_lock_shop_sku_inventory',
        'fn_lock_shop_sku_inventory(p_product_id, v_sku_id, p_quantity)',
        'fn_lock_shop_sku_inventory(p_product_id, v_sku_id, v_quantity)',
        'array_agg(source_sku_id ORDER BY item_index)',
        'COALESCE(inventory.sku_id, locked.source_sku_id, v_inventory_sku_id)',
        'failed to patch fn_purchase_shop_item_core with priority SKU inventory sources',
        'failed to patch fn_create_marketplace_shop_order with priority SKU inventory sources'
    ]) {
        assert.equal(migration.includes(marker), true, `priority migration should contain ${marker}`);
    }

    assert.match(
        migration,
        /ORDER BY source_rows\.source_rank ASC, i\.created_at ASC, i\.id ASC[\s\S]*LIMIT v_quantity[\s\S]*FOR UPDATE OF i SKIP LOCKED/,
        'priority lock helper should consume one-time inventory by configured source priority'
    );
    assert.match(
        migration,
        /COALESCE\(i\.is_shared, false\) = true[\s\S]*ORDER BY source_rows\.source_rank ASC, i\.created_at ASC, i\.id ASC[\s\S]*LIMIT 1/,
        'priority lock helper should fall back to the first reusable row from the highest-priority available source'
    );
    assert.match(
        localPriorityPatch,
        /NEW\.inventory_source_sku_ids := COALESCE\(v_source_ids, ARRAY\[\]::UUID\[\]\);[\s\S]*IF v_source_id = NEW\.id THEN[\s\S]*CONTINUE;/,
        'local-priority patch should allow the current SKU itself as the first inventory source'
    );
    assert.equal(
        localPriorityPatch.includes('sku cannot use itself as inventory source'),
        false,
        'local-priority patch should not reject self as an inventory source'
    );

    for (const marker of [
        'ADD COLUMN IF NOT EXISTS inventory_source_sku_ids_intl UUID[]',
        'public.fn_resolve_shop_sku_inventory_sources(UUID, TEXT)',
        'public.fn_lock_shop_sku_inventory(UUID, UUID, INT, TEXT)',
        'fn_lock_shop_sku_inventory(p_product_id, v_sku_id, p_quantity, v_site)',
        'fn_lock_shop_sku_inventory(p_product_id, v_sku_id, v_quantity, v_site)',
        'failed to patch fn_purchase_shop_item_core with site-scoped SKU inventory sources',
        'failed to patch fn_create_marketplace_shop_order with site-scoped SKU inventory sources'
    ]) {
        assert.equal(siteScopedPatch.includes(marker), true, `site-scoped patch should contain ${marker}`);
    }
    assert.match(
        siteScopedPatch,
        /WHEN t\.normalized_site = 'intl'[\s\S]*THEN t\.inventory_source_sku_ids_intl[\s\S]*WHEN t\.normalized_site <> 'intl'[\s\S]*THEN t\.inventory_source_sku_ids/,
        'site-scoped patch should resolve INTL and CN fallback chains independently'
    );
});
