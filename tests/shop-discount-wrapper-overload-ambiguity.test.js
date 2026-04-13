const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260412_fix_shop_discount_wrapper_overload_ambiguity.sql'
);

test('shop discount wrapper ambiguity migration removes all defaults from 7-arg RPCs', () => {
    const source = fs.readFileSync(migrationPath, 'utf8');

    assert.match(
        source,
        /DROP FUNCTION IF EXISTS public\.fn_validate_discount_code\(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID\);/s,
        'validate wrapper should be dropped first because CREATE OR REPLACE cannot remove parameter defaults'
    );
    assert.match(
        source,
        /DROP FUNCTION IF EXISTS public\.fn_purchase_shop_item\(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID\);/s,
        'purchase wrapper should be dropped first because CREATE OR REPLACE cannot remove parameter defaults'
    );
    assert.match(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_validate_discount_code\(\s*p_product_id UUID,\s*p_user_id UUID,\s*p_site VARCHAR,\s*p_quantity INT,\s*p_discount_code VARCHAR,\s*p_discount_asset_id UUID,\s*p_agent_id UUID/s,
        'validate wrapper should require all 7 arguments explicitly'
    );
    assert.match(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_purchase_shop_item\(\s*p_product_id UUID,\s*p_user_id UUID,\s*p_site VARCHAR,\s*p_quantity INT,\s*p_discount_code VARCHAR,\s*p_discount_asset_id UUID,\s*p_agent_id UUID/s,
        'purchase wrapper should require all 7 arguments explicitly'
    );
    assert.doesNotMatch(
        source,
        /CREATE OR REPLACE FUNCTION public\.fn_(?:validate_discount_code|purchase_shop_item)\([\s\S]*?\bDEFAULT\b[\s\S]*?\)/g,
        '7-arg wrappers must not declare DEFAULT values, or PostgreSQL will either reject the signature or resolve inner overloads ambiguously'
    );
});
