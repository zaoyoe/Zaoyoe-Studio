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
    '20260919_guest_shop_qualify_where_out_columns.sql'
);
const VERIFY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260919_verify_guest_shop_qualify_where_out_columns.sql'
);
const ATOMIC_RPCS_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260913_guest_shop_atomic_rpcs.sql'
);
const ADMIN_OPS_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260914_guest_shop_admin_ops.sql'
);
const QUALIFY_UPDATE_SET_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260918_guest_shop_qualify_update_set_status_columns.sql'
);

const TARGET_FUNCTIONS = [
    'fn_guest_shop_mark_fulfilled',
    'fn_guest_shop_admin_queue_refund',
    'fn_guest_shop_admin_manual_fulfill'
];

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

function assertNoUnqualifiedWhereOutColumns(sql, label) {
    assert.doesNotMatch(
        sql,
        /(WHERE|AND)\s+order_id\s*=/i,
        `${label} should not use unqualified WHERE order_id`
    );
    assert.doesNotMatch(
        sql,
        /(WHERE|AND)\s+fulfillment_status\s*(=|<>)/i,
        `${label} should not use unqualified WHERE fulfillment_status`
    );
    assert.doesNotMatch(
        sql,
        /(WHERE|AND)\s+payment_status\s*=/i,
        `${label} should not use unqualified WHERE payment_status`
    );
    assert.doesNotMatch(
        sql,
        /(WHERE|AND)\s+refund_status\s*(=|NOT)/i,
        `${label} should not use unqualified WHERE refund_status`
    );
}

test('20260919 only replaces the ambiguous WHERE OUT-column RPCs, stays additive, and matches patched sources', () => {
    const sql = readSql(MIGRATION_PATH);
    const atomic = readSql(ATOMIC_RPCS_PATH);
    const admin = readSql(ADMIN_OPS_PATH);
    const updateSet = readSql(QUALIFY_UPDATE_SET_PATH);

    assert.match(sql, /Codex does not execute this file/i);
    assert.match(sql, /does not enable guest products/i);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+FUNCTION\b[^;]*\bCASCADE\b/i);
    assert.doesNotMatch(sql, /SET\s+allow_guest_purchase\s*=\s*(?:TRUE|true)/i);
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_create_order\s*\(/i);
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_claim_fulfillment\s*\(/i);
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_confirm_payment\s*\(/i);

    for (const name of TARGET_FUNCTIONS) {
        assert.match(
            sql,
            new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i')
        );
    }

    assert.doesNotMatch(
        updateSet,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_mark_fulfilled\s*\(/i,
        '20260918 must still not replace mark_fulfilled'
    );

    assert.match(
        sql,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_guest_shop_mark_fulfilled\(UUID,\s*UUID\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    assert.match(
        sql,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_guest_shop_mark_fulfilled\(UUID,\s*UUID\)\s+TO\s+service_role/i
    );
    assert.match(
        sql,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_queue_refund\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    assert.match(
        sql,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_queue_refund\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+TO\s+service_role/i
    );
    assert.match(
        sql,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_manual_fulfill\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    assert.match(
        sql,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_manual_fulfill\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+TO\s+service_role/i
    );

    assert.equal(
        functionBlock(sql, 'fn_guest_shop_mark_fulfilled'),
        functionBlock(atomic, 'fn_guest_shop_mark_fulfilled')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_admin_queue_refund'),
        functionBlock(admin, 'fn_guest_shop_admin_queue_refund')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_admin_manual_fulfill'),
        functionBlock(admin, 'fn_guest_shop_admin_manual_fulfill')
    );
    assert.equal(
        functionBlock(updateSet, 'fn_guest_shop_admin_queue_refund'),
        functionBlock(admin, 'fn_guest_shop_admin_queue_refund')
    );
});

test('20260919 function bodies qualify WHERE OUT columns with table aliases', () => {
    const sql = readSql(MIGRATION_PATH);
    for (const name of TARGET_FUNCTIONS) {
        assertNoUnqualifiedWhereOutColumns(functionBlock(sql, name), name);
    }

    const mark = functionBlock(sql, 'fn_guest_shop_mark_fulfilled');
    assert.match(
        mark,
        /FROM\s+public\.guest_shop_inventory_reservations\s+r\s+WHERE\s+r\.order_id\s*=\s*p_order_id/i
    );
    assert.match(
        mark,
        /UPDATE\s+public\.guest_shop_orders\s+o\s+SET/i
    );
    assert.match(mark, /o\.payment_status\s*=\s*'confirmed'/i);
    assert.match(mark, /o\.fulfillment_status\s*<>\s*'delivered'/i);

    const queue = functionBlock(sql, 'fn_guest_shop_admin_queue_refund');
    assert.match(
        queue,
        /o\.refund_status\s+NOT\s+IN\s*\(\s*'succeeded'\s*,\s*'manual_review'\s*\)/i
    );
    assert.match(queue, /o\.refund_status\s*=\s*'none'/i);

    const manual = functionBlock(sql, 'fn_guest_shop_admin_manual_fulfill');
    assert.match(
        manual,
        /FROM\s+public\.guest_shop_inventory_reservations\s+r\s+WHERE\s+r\.order_id\s*=\s*p_order_id/i
    );
    assert.match(manual, /r\.order_id\s*=\s*p_order_id/i);
    assert.match(manual, /o\.payment_status\s*=\s*'confirmed'/i);
    assert.match(manual, /o\.fulfillment_status\s*=\s*'paid_unfulfillable'/i);
});

test('20260919 verifier is read-only and requires aliased WHERE OUT columns', () => {
    const verify = readSql(VERIFY_PATH);

    assert.match(verify, /Codex does not execute this file/i);
    assert.match(verify, /read-only/i);
    assert.doesNotMatch(verify, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+|CREATE\s+OR\s+REPLACE/i);
    assert.match(verify, /to_regprocedure\(\s*format\('public\.%I\(%s\)'/i);
    for (const name of TARGET_FUNCTIONS) {
        assert.match(verify, new RegExp(name, 'i'));
    }
    assert.match(verify, /no_unqualified_where_out_columns/i);
    assert.match(verify, /r\\.order_id/i);
    assert.match(verify, /o\\.fulfillment_status/i);
    assert.match(verify, /o\\.refund_status/i);
    assert.match(verify, /WHEN\s+observed\s*=\s*expected\s+THEN\s+'PASS'/i);
});
