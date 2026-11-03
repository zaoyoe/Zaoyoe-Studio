'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const smokePath = path.resolve(__dirname, '../supabase/acceptance/20261102_supplier_p2g_import_rpc_rollback_smoke.sql');
const smoke = fs.readFileSync(smokePath, 'utf8');

test('P2G import smoke is bound to the isolated container and database', () => {
    assert.match(smoke, /Target only supabase_db_shop-supplier-p2g-baseline-20261102 on colima-p2g/);
    assert.match(smoke, /current_setting\('app\.supplier_p2g_target', true\)/);
    assert.match(smoke, /current_database\(\) <> 'postgres'/);
    assert.match(smoke, /v_target IS DISTINCT FROM 'supabase_db_shop-supplier-p2g-baseline-20261102'/);

    const guardIndex = smoke.indexOf('Refusing supplier smoke without the isolated P2G container marker');
    const firstWriteIndex = smoke.indexOf('INSERT INTO auth.users');
    assert.ok(guardIndex >= 0 && firstWriteIndex > guardIndex, 'target guard must run before fixture writes');
});

test('P2G import smoke is rollback-only and asserts safe, idempotent draft behavior', () => {
    assert.match(smoke, /^BEGIN;/m);
    assert.match(smoke, /^ROLLBACK;\s*$/m);
    assert.doesNotMatch(smoke, /^COMMIT;/im);
    assert.doesNotMatch(smoke, /\b(?:DROP|TRUNCATE)\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(smoke, /https?:\/\/|\bfetch\s*\(/i);

    assert.match(smoke, /provider_id = 'xiareng'[\s\S]*?account_key = 'default'[\s\S]*?is_enabled = false/);
    assert.match(smoke, /v_first->>'status' <> 'imported_as_draft'/);
    assert.match(smoke, /IF v_is_active OR v_allow_guest_purchase THEN/);
    assert.match(smoke, /IF v_mapping_enabled THEN/);
    assert.match(smoke, /v_second->>'status' <> 'already_imported'/);
    assert.match(smoke, /IF v_count <> 1 THEN[\s\S]*?Expected one audit record after replay/);
});
