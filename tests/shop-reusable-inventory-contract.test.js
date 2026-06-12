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
