'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ADMIN_OPS_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260914_guest_shop_admin_ops.sql'
);
const ADMIN_OPS_VERIFY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260914_verify_guest_shop_admin_ops.sql'
);

function readSql(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function functionBlock(sql, name) {
    const start = sql.search(new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`,
        'i'
    ));
    assert.notEqual(start, -1, `missing ${name} definition`);
    const end = sql.indexOf('$$;', start);
    assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
    return sql.slice(start, end + 3);
}

const RPC_NAMES = [
    'fn_guest_shop_admin_queue_refund',
    'fn_guest_shop_admin_unlock_dead_letter',
    'fn_guest_shop_admin_manual_fulfill'
];

const HELPER_NAMES = [
    'guest_shop_has_active_worker_lease',
    'guest_shop_normalize_admin_reason',
    'guest_shop_merge_admin_action_metadata'
];

test('guest admin ops migration is additive and never drops tables', () => {
    const sql = readSql(ADMIN_OPS_PATH);
    const verify = readSql(ADMIN_OPS_VERIFY_PATH);

    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+FUNCTION\b[^;]*\bCASCADE\b/i);
    assert.doesNotMatch(sql, /fn_purchase_shop_item|payment_checkout_sessions|rechargePointsForPayment/i);
    assert.match(sql, /Codex does not execute this file/i);
    assert.doesNotMatch(sql, /guest_purchase_enabled\s*=\s*true|enable guest product/i);
    assert.doesNotMatch(verify, /^\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/im);
    assert.match(verify, /Codex does not execute this file/i);
});

test('guest admin write RPCs are SECURITY DEFINER with pinned search_path and service_role-only execute', () => {
    const sql = readSql(ADMIN_OPS_PATH);

    for (const name of RPC_NAMES) {
        const block = functionBlock(sql, name);
        assert.match(
            block,
            /SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
            `${name} must pin search_path`
        );
        assert.match(block, /guest_shop_require_service_role\s*\(/i);
        assert.match(
            sql,
            new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^;]*\\)\\s+FROM\\s+[^;]*(?:PUBLIC|anon|authenticated)`, 'i'),
            `${name} must revoke public/client execute access`
        );
        assert.match(
            sql,
            new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^;]*\\)\\s+TO\\s+service_role`, 'i'),
            `${name} must grant execute only to service_role`
        );
    }

    for (const name of HELPER_NAMES) {
        const block = functionBlock(sql, name);
        assert.doesNotMatch(block, /SECURITY\s+DEFINER/i, `${name} must remain invoker`);
        assert.match(block, /SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
        assert.match(
            sql,
            new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^;]*\\)\\s+FROM\\s+[^;]*(?:PUBLIC|anon|authenticated)`, 'i')
        );
        assert.match(
            sql,
            new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^;]*\\)\\s+TO\\s+service_role`, 'i')
        );
    }
});

test('admin action metadata merge is STABLE because it uses clock_timestamp', () => {
    const sql = readSql(ADMIN_OPS_PATH);
    const merge = functionBlock(sql, 'guest_shop_merge_admin_action_metadata');
    const reason = functionBlock(sql, 'guest_shop_normalize_admin_reason');
    const lease = functionBlock(sql, 'guest_shop_has_active_worker_lease');

    assert.match(merge, /LANGUAGE\s+plpgsql\s+STABLE/i);
    assert.doesNotMatch(merge, /\bIMMUTABLE\b/i);
    assert.match(merge, /clock_timestamp\s*\(/i);
    assert.match(merge, /__guest_shop_admin/i);
    assert.match(reason, /LANGUAGE\s+plpgsql\s+IMMUTABLE/i);
    assert.match(reason, /char_length\(\s*v_reason\s*\)\s*<\s*8/i);
    assert.match(lease, /LANGUAGE\s+plpgsql\s+STABLE/i);
    assert.match(lease, /fulfillment[\s\S]*refund|_lease_expires_at/i);
});

test('queue_refund is eligible for confirmed or paid_unfulfillable orders and first queue becomes pending', () => {
    const sql = readSql(ADMIN_OPS_PATH);
    const queue = functionBlock(sql, 'fn_guest_shop_admin_queue_refund');

    assert.match(queue, /guest_shop_has_active_worker_lease/i);
    assert.match(queue, /guest_admin_active_lease/i);
    assert.match(queue, /payment_status\s+IN\s*\(\s*'refunded'\s*,\s*'chargeback'\s*\)/i);
    assert.match(queue, /refund_status\s+IN\s*\(\s*'succeeded'\s*,\s*'manual_review'\s*\)/i);
    assert.match(queue, /payment_status\s*<>\s*'confirmed'/i);
    assert.match(queue, /fulfillment_status\s*<>\s*'paid_unfulfillable'/i);
    assert.match(queue, /ELSE\s+'pending'/i);
    assert.match(queue, /refund_status\s*=\s*'pending'/i);
    assert.match(queue, /previous_refund_status/i);
    assert.doesNotMatch(queue, /RETURNS TABLE[\s\S]*(content|claim_secret|recovery_code)/i);
});

test('unlock_dead_letter is single-order, requires no active lease, and clears worker dead-letter metadata', () => {
    const sql = readSql(ADMIN_OPS_PATH);
    const unlock = functionBlock(sql, 'fn_guest_shop_admin_unlock_dead_letter');

    assert.match(unlock, /guest_shop_has_active_worker_lease/i);
    assert.match(unlock, /guest_admin_active_lease/i);
    assert.match(unlock, /fulfillment_status\s*=\s*'dead_letter'\s+THEN\s+'failed'/i);
    assert.match(unlock, /fulfillment_status',\s*'retry_waiting'/i);
    assert.match(unlock, /fulfillment_attempt_count',\s*0/i);
    assert.match(unlock, /fulfillment_dead_lettered_at',\s*NULL/i);
    assert.match(unlock, /refund_dead_lettered_at',\s*NULL/i);
    assert.match(unlock, /fulfillment_lease_token',\s*NULL/i);
    assert.match(unlock, /WHERE\s+id\s*=\s*p_order_id/i);
    assert.doesNotMatch(unlock, /WHERE\s+id\s+IN\s*\(/i);
    assert.match(unlock, /THEN\s+'failed'/i);
    assert.doesNotMatch(unlock, /THEN\s+'dead_letter'/i);
    assert.doesNotMatch(unlock, /RETURNS TABLE[\s\S]*(content|claim_secret|recovery_code)/i);
});

test('manual_fulfill rebinds the unique reservation with SKIP LOCKED and never returns secrets', () => {
    const sql = readSql(ADMIN_OPS_PATH);
    const manual = functionBlock(sql, 'fn_guest_shop_admin_manual_fulfill');

    assert.match(manual, /FOR\s+UPDATE\s+OF\s+i\s+SKIP\s+LOCKED/i);
    assert.match(manual, /fulfillment_status\s*<>\s*'paid_unfulfillable'/i);
    assert.match(manual, /payment_status\s*<>\s*'confirmed'/i);
    assert.match(manual, /quantity\s*<>\s*1/i);
    assert.match(manual, /snapshot_sku_manual_delivery|snapshot_manual_delivery/i);
    assert.match(manual, /COALESCE\s*\(\s*i\.is_shared\s*,\s*false\s*\)\s*=\s*false/i);
    assert.match(manual, /status\s*=\s*'sold'/i);
    assert.match(manual, /UPDATE\s+public\.guest_shop_inventory_reservations\s+SET\s+inventory_id/i);
    assert.match(manual, /previous_inventory_id/i);
    assert.doesNotMatch(manual, /INSERT\s+INTO\s+public\.guest_shop_inventory_reservations/i);
    assert.doesNotMatch(manual, /RETURNS TABLE[\s\S]*(content|claim_secret|recovery_code)/i);
    assert.doesNotMatch(manual, /\bcontent\b/i);
});

test('admin ops verifier resolves functions by regprocedure and stays read-only', () => {
    const verify = readSql(ADMIN_OPS_VERIFY_PATH);

    assert.match(
        verify,
        /to_regprocedure\(\s*format\('public\.%I\(%s\)'/i
    );
    assert.doesNotMatch(
        verify,
        /pg_get_function_identity_arguments\(p\.oid\)\s*=\s*e\.identity_args/i
    );
    assert.match(verify, /fn_guest_shop_admin_queue_refund/i);
    assert.match(verify, /fn_guest_shop_admin_unlock_dead_letter/i);
    assert.match(verify, /fn_guest_shop_admin_manual_fulfill/i);
    assert.match(verify, /service_role/i);
    assert.match(verify, /content|claim|recovery/i);
    assert.match(verify, /provolatile/i);
    assert.match(verify, /baseline_atomic_rpcs_still_present/i);
});
