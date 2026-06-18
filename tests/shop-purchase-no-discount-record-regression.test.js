const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260618_fix_shop_purchase_without_discount_record.sql'
);

test('shop purchase migration caches max_discount_quantity before snapshotting no-coupon orders', () => {
    const source = fs.readFileSync(migrationPath, 'utf8');

    assert.match(
        source,
        /v_max_discount_quantity INT := 0;/,
        'purchase core should initialize the derived quantity cap before optional discount lookup'
    );
    assert.match(
        source,
        /v_max_discount_quantity := COALESCE\(v_discount_record\.max_discount_quantity, 0\);/,
        'discount-backed purchases should populate the cached quantity cap from the locked record'
    );
    assert.match(
        source,
        /'COALESCE\(v_discount_record\.max_discount_quantity, 0\)'[\s\S]*'v_max_discount_quantity'/,
        'migration should replace direct max_discount_quantity reads with the initialized cache'
    );
    assert.match(
        source,
        /'v_max_discount_quantity := v_max_discount_quantity;'[\s\S]*'v_max_discount_quantity := COALESCE\(v_discount_record\.max_discount_quantity, 0\);'/,
        'the patch should restore the locked-record assignment if a previous run created a self-assignment'
    );
    assert.match(
        source,
        /POSITION\('''max_discount_quantity'', COALESCE\(v_discount_record\.max_discount_quantity, 0\)' IN v_definition\) > 0/,
        'migration verification should reject direct snapshot reads from possibly unassigned v_discount_record'
    );
    assert.match(
        source,
        /''max_discount_quantity'', v_max_discount_quantity/,
        'order snapshots should use the initialized cached value'
    );
});
