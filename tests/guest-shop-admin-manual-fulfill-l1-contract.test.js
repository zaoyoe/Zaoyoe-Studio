'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260927_guest_shop_admin_manual_fulfill_l1.sql'
);
const VERIFY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260927_verify_guest_shop_admin_manual_fulfill_l1.sql'
);

function readSql(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function functionBlock(sql) {
    const start = sql.search(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_admin_manual_fulfill\s*\(/i
    );
    assert.notEqual(start, -1, 'missing manual fulfillment function');
    const end = sql.indexOf('$$;', start);
    assert.notEqual(end, -1, 'manual fulfillment function should be dollar quoted');
    return sql.slice(start, end + 3);
}

test('L1 manual fulfillment migration is additive and service-role only', () => {
    const sql = readSql(MIGRATION_PATH);
    assert.match(sql, /Codex does not execute this file/i);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.guest_shop_inventory_reservations/i);
    assert.match(sql, /SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
    assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_manual_fulfill\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_manual_fulfill\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+TO\s+service_role/i);
});

test('L1 manual fulfillment handles the whole reservation set atomically', () => {
    const manual = functionBlock(readSql(MIGRATION_PATH));

    assert.doesNotMatch(manual, /quantity\s*<>\s*1/i);
    assert.match(manual, /quantity\s*<\s*1\s+OR\s+v_order\.quantity\s*>\s*5/i);
    assert.match(manual, /v_res_total\s*<>\s*v_order\.quantity/i);
    assert.match(manual, /guest_reservation_count_mismatch/i);
    assert.match(manual, /ORDER\s+BY\s+r\.created_at\s+ASC,\s*r\.id\s+ASC\s*\n?\s*FOR\s+UPDATE/i);
    assert.match(manual, /FOR\s+UPDATE\s+OF\s+i\s+SKIP\s+LOCKED/i);
    assert.match(manual, /status\s*=\s*'available'/i);
    assert.match(manual, /SET\s+status\s*=\s*'sold'/i);
    assert.match(manual, /v_reservation\.status\s*=\s*'consumed'/i);
    assert.match(manual, /v_inventory\.status\s*<>\s*'sold'/i);
    assert.match(manual, /guest_inventory_unavailable/i);
    assert.match(manual, /v_res_consumed\s*<>\s*v_res_total/i);
    assert.match(manual, /fulfillment_status\s*=\s*'delivered'/i);
    assert.match(manual, /reservation_status\s*=\s*'consumed'/i);
    assert.match(manual, /replacement_count/i);
    assert.match(manual, /previous_inventory_ids/i);
    assert.doesNotMatch(manual, /\bcontent\b|claim_secret|recovery_code/i);
});

test('L1 verifier is read-only and checks the replacement invariants', () => {
    const verify = readSql(VERIFY_PATH);
    assert.match(verify, /Codex does not execute this file/i);
    assert.match(verify, /read-only/i);
    assert.doesNotMatch(verify, /^\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/im);
    for (const phrase of [
        'function_present',
        'service_role_only',
        'l1_quantity_supported',
        'reservation_set_locked_and_count_checked',
        'replacement_uses_locked_available_stock',
        'inventory_shortfall_is_atomic',
        'delivered_only_after_all_reservations_consumed'
    ]) {
        assert.match(verify, new RegExp(phrase, 'i'));
    }
});
