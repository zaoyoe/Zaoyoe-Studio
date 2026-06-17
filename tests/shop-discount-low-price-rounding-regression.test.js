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

test('zero percent coupon migration keeps free checkout behind allow-zero guard', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260617_allow_zero_percent_discount_coupons.sql'),
        'utf8'
    );
    const constraintMigration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260617_zero_percent_discount_value_constraint.sql'),
        'utf8'
    );

    assert.match(
        constraintMigration,
        /ALTER TABLE public\.discount_codes[\s\S]*DROP CONSTRAINT IF EXISTS chk_discount_value_percent;[\s\S]*ADD CONSTRAINT chk_discount_value_percent[\s\S]*discount_type = 'percent' AND discount_value >= 0 AND discount_value <= 100[\s\S]*discount_type = 'fixed' AND discount_value > 0/,
        'migration should relax the table check constraint for percent coupons while keeping fixed coupons positive'
    );
    assert.match(
        migration,
        /CREATE OR REPLACE FUNCTION public\.fn_resolve_shop_percent_discount\(/,
        'migration should redefine the shared percent-discount helper'
    );
    assert.doesNotMatch(
        migration,
        /v_discount_value\s*<=\s*0/,
        '0 percent settlement should not be treated as no discount'
    );
    assert.match(
        migration,
        /v_discounted_total = 0[\s\S]*NOT COALESCE\(p_allow_zero_total, false\)/,
        '0 percent settlement should still require allow_zero_total before checkout succeeds'
    );
    assert.match(
        migration,
        /discount_value 0 means 0% settlement\/free checkout/,
        'function comment should document the 0 percent settlement semantics'
    );
});

test('max discount quantity migration caps percent and fixed coupon amounts per order', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260617_add_discount_max_discount_quantity.sql'),
        'utf8'
    );

    assert.match(
        migration,
        /ADD COLUMN IF NOT EXISTS max_discount_quantity INT NOT NULL DEFAULT 0/,
        'migration should add a non-null quantity cap field with unlimited as the default'
    );
    assert.match(
        migration,
        /ADD CONSTRAINT discount_codes_max_discount_quantity_check[\s\S]*CHECK \(max_discount_quantity >= 0\)/,
        'migration should reject negative coupon quantity caps'
    );
    assert.match(
        migration,
        /CREATE OR REPLACE FUNCTION public\.fn_resolve_shop_discount_amount\([\s\S]*p_max_discount_quantity INT DEFAULT 0[\s\S]*v_eligible_subtotal[\s\S]*v_discount_type = 'percent'[\s\S]*v_discount_type = 'fixed'/,
        'shared resolver should calculate a capped eligible subtotal for both percent and fixed coupons'
    );
    assert.match(
        migration,
        /v_unit_price \* v_eligible_quantity/,
        'quantity caps should be based on the selected SKU unit price'
    );
    assert.match(
        migration,
        /COALESCE\(v_discount_record\.max_discount_quantity, 0\)/,
        'preview and purchase RPC patches should pass the stored cap into discount calculation'
    );
    assert.match(
        migration,
        /''max_discount_quantity'', COALESCE\(v_discount_row\.max_discount_quantity, 0\)/,
        'multi-discount purchases should preserve each coupon cap in the applied discount snapshot'
    );
});

test('single coupon validation preserves full-discount blocked message after max quantity resolver', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '202606171235_fix_discount_full_block_message.sql'),
        'utf8'
    );

    assert.match(
        migration,
        /public\.fn_validate_discount_code_core\(uuid,uuid,character varying,integer,character varying,uuid,uuid\)/,
        'migration should patch single-coupon preview validation'
    );
    assert.match(
        migration,
        /public\.fn_purchase_shop_item_core\(uuid,uuid,character varying,integer,character varying,uuid,uuid\)/,
        'migration should patch single-coupon purchase validation'
    );
    assert.match(
        migration,
        /IF v_final_total = 0[\s\S]*AND v_discount_amount > 0[\s\S]*NOT COALESCE\(v_discount_record\.allow_zero_total, false\)[\s\S]*'该优惠码不允许全额抵扣'/,
        'zero-total blocked coupons should return the explicit full-discount restriction'
    );
    assert.match(
        migration,
        /RETURN jsonb_build_object\(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码''\)/,
        'generic no-discountable-amount message should remain as the fallback'
    );
    assert.match(
        migration,
        /fn_resolve_shop_discount_amount\(/,
        'patch should only run after the shared max-quantity resolver is present'
    );
});
