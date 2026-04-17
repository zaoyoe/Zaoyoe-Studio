const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260416_enable_decimal_shop_points_precision.sql'
);

test('decimal settlement migration upgrades percent coupons from integer floor to two-decimal checkout totals', () => {
    const source = fs.readFileSync(migrationPath, 'utf8');

    assert.match(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_resolve_shop_percent_discount\(/,
        'migration should redefine the shared percent-discount helper for decimal settlement'
    );
    assert.match(
        source,
        /v_discounted_total := ROUND\(\(v_subtotal \* v_discount_value::NUMERIC\) \/ 100, 2\);/,
        'helper should round percent-settlement totals to two decimal places instead of flooring to integers'
    );
    assert.match(
        source,
        /ALTER TABLE public\.points_balance ALTER COLUMN paid_balance TYPE NUMERIC\(12,2\)/,
        'migration should upgrade the points balance precision to two decimals'
    );
    assert.match(
        source,
        /ALTER TABLE public\.shop_orders ALTER COLUMN price_paid TYPE NUMERIC\(12,2\)/,
        'migration should upgrade persisted shop order amounts to two decimals'
    );
    assert.match(
        source,
        /'final_total', v_total_price/,
        'purchase RPC should now return the exact decimal payable total'
    );
    assert.match(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_purchase_shop_item\([\s\S]*?DECLARE[\s\S]*?v_applied_discount_type VARCHAR\(32\) := NULL;[\s\S]*?v_applied_discount_value INT := NULL;/,
        'purchase RPC should declare the applied-discount snapshot fields before assigning them'
    );
    assert.doesNotMatch(
        source,
        /折后价低于 1 积分|WHEN v_subtotal > 1 THEN 1/,
        'migration should no longer force low-price percent coupons back up to a minimum integer payment'
    );
});
