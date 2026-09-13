const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260912_add_public_shop_product_sales_rpc.sql'
);

test('public shop sales migration keeps the RPC site-scoped and service-role-only', () => {
    const source = fs.readFileSync(migrationPath, 'utf8');

    for (const marker of [
        'ADD COLUMN IF NOT EXISTS item_count INT DEFAULT 1',
        'ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) DEFAULT \'none\'',
        'ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT \'cn\'',
        'CREATE INDEX IF NOT EXISTS idx_shop_orders_public_sales_site_product',
        'CREATE OR REPLACE FUNCTION public.fn_public_shop_product_sales_counts(',
        'SUM(GREATEST(COALESCE(o.item_count, 1), 1))::BIGINT',
        "NOT IN ('refunded', 'full_refund')",
        'REVOKE ALL ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) FROM anon;',
        'REVOKE ALL ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) FROM authenticated;',
        'GRANT EXECUTE ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) TO service_role;'
    ]) {
        assert.equal(source.includes(marker), true, `migration should contain ${marker}`);
    }

    assert.match(
        source,
        /LOWER\(BTRIM\(COALESCE\(NULLIF\(o\.site, ''\), 'cn'\)\)\)[\s\S]*CASE[\s\S]*'intl'/,
        'sales aggregation should normalize and isolate the requested site'
    );
    assert.equal(
        source.includes('GRANT EXECUTE ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) TO authenticated;'),
        false,
        'sales aggregation should not be callable by authenticated clients'
    );
});
