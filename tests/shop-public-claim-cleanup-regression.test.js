const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260415_cleanup_duplicate_public_claim_assets.sql'
);

test('public-claim cleanup migration only deletes fresh duplicate assets that never touched orders', () => {
    const source = fs.readFileSync(migrationPath, 'utf8');

    assert.match(
        source,
        /DELETE FROM public\.discount_user_assets/,
        'cleanup migration should remove extra public-claim assets from the asset table'
    );
    assert.match(
        source,
        /LOWER\(BTRIM\(COALESCE\(d\.distribution_mode, ''\)\)\) = 'public_claim'/,
        'cleanup migration should only target public-claim discounts'
    );
    assert.match(
        source,
        /COUNT\(\*\)::INT - GREATEST\(0, COALESCE\(d\.claim_limit_per_user, 0\)\)/,
        'cleanup migration should compute the excess claim count from the per-user limit'
    );
    assert.match(
        source,
        /LOWER\(BTRIM\(COALESCE\(a\.asset_status, ''\)\)\) = 'available'[\s\S]*LOWER\(BTRIM\(COALESCE\(a\.source_type, ''\)\)\) = 'public_claim'/,
        'cleanup migration should only delete fresh available assets claimed from the public claim flow'
    );
    assert.match(
        source,
        /a\.consumed_at IS NULL[\s\S]*a\.restored_at IS NULL[\s\S]*a\.last_order_id IS NULL/,
        'cleanup migration should avoid deleting used or restored assets'
    );
    assert.match(
        source,
        /NOT EXISTS \([\s\S]*FROM public\.shop_orders o[\s\S]*o\.discount_asset_id = a\.id[\s\S]*\)/,
        'cleanup migration should skip any asset that is still referenced by an order record'
    );
});
