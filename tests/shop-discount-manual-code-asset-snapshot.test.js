const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/202606171245_fix_manual_discount_code_asset_snapshot.sql'
);

test('manual discount code purchases do not read an unassigned asset record for snapshots', () => {
    const source = fs.readFileSync(migrationPath, 'utf8');

    assert.match(
        source,
        /public\.fn_purchase_shop_item\(uuid,uuid,character varying,integer,character varying,uuid,uuid\)/,
        'migration should patch the 7-arg discount purchase wrapper'
    );
    assert.match(
        source,
        /public\.fn_purchase_shop_item\(uuid,uuid,character varying,integer,character varying,uuid,uuid,uuid\)/,
        'migration should patch the SKU-aware 8-arg discount purchase wrapper'
    );
    assert.match(
        source,
        /v_asset_source_type VARCHAR\(32\) := NULL;[\s\S]*v_asset_source_channel VARCHAR\(80\) := NULL;/,
        'asset source fields should be initialized before any optional asset lookup'
    );
    assert.match(
        source,
        /v_asset_source_type := v_asset\.source_type;[\s\S]*v_asset_source_channel := v_asset\.source_channel;/,
        'asset source fields should only be copied after the asset record is loaded'
    );
    assert.match(
        source,
        /'source_type'', v_asset_source_type[\s\S]*'source_channel'', v_asset_source_channel/,
        'manual code order snapshots should use initialized scalar values'
    );
    assert.match(
        source,
        /OR POSITION\('''source_type'', COALESCE\(v_asset\.source_type, NULL\),' IN v_definition\) > 0[\s\S]*OR POSITION\('''source_channel'', COALESCE\(v_asset\.source_channel, NULL\),' IN v_definition\) > 0/,
        'migration verification should reject direct snapshot reads from possibly unassigned v_asset'
    );
});
