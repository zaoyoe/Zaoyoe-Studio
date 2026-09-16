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
    '20260918_guest_shop_qualify_update_set_status_columns.sql'
);
const VERIFY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260918_verify_guest_shop_qualify_update_set_status_columns.sql'
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
const QUALIFY_RETURN_QUERY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260917_guest_shop_qualify_fulfillment_columns.sql'
);

const TARGET_FUNCTIONS = [
    'fn_guest_shop_claim_fulfillment',
    'fn_guest_shop_release_reservation',
    'fn_guest_shop_confirm_payment',
    'fn_guest_shop_record_refund_result',
    'fn_guest_shop_admin_queue_refund',
    'fn_guest_shop_admin_unlock_dead_letter'
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

function assertNoUnqualifiedUpdateSet(sql, label) {
    assert.doesNotMatch(
        sql,
        /WHEN\s+(fulfillment_status|refund_status)\s*(=|IN)/i,
        `${label} should not use unqualified WHEN status-column CASE arms`
    );
    assert.doesNotMatch(
        sql,
        /(THEN|ELSE)\s+(fulfillment_status|refund_status)\b(?!\.)/i,
        `${label} should not use unqualified THEN/ELSE status-column CASE arms`
    );
}

test('20260918 only replaces the ambiguous UPDATE SET RPCs, stays additive, and matches patched sources', () => {
    const sql = readSql(MIGRATION_PATH);
    const atomic = readSql(ATOMIC_RPCS_PATH);
    const admin = readSql(ADMIN_OPS_PATH);
    const qualify = readSql(QUALIFY_RETURN_QUERY_PATH);

    assert.match(sql, /Codex does not execute this file/i);
    assert.match(sql, /does not enable guest products/i);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+FUNCTION\b[^;]*\bCASCADE\b/i);
    assert.doesNotMatch(sql, /SET\s+allow_guest_purchase\s*=\s*(?:TRUE|true)/i);
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_create_order\s*\(/i);
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_mark_fulfilled\s*\(/i);

    for (const name of TARGET_FUNCTIONS) {
        assert.match(
            sql,
            new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i')
        );
    }

    assert.match(
        sql,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_guest_shop_claim_fulfillment\(UUID,\s*UUID\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    assert.match(
        sql,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_guest_shop_claim_fulfillment\(UUID,\s*UUID\)\s+TO\s+service_role/i
    );
    assert.match(
        sql,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_unlock_dead_letter\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    assert.match(
        sql,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_guest_shop_admin_unlock_dead_letter\(UUID,\s*TEXT,\s*UUID,\s*TEXT\)\s+TO\s+service_role/i
    );

    assert.equal(
        functionBlock(sql, 'fn_guest_shop_claim_fulfillment'),
        functionBlock(qualify, 'fn_guest_shop_claim_fulfillment')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_release_reservation'),
        functionBlock(qualify, 'fn_guest_shop_release_reservation')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_confirm_payment'),
        functionBlock(atomic, 'fn_guest_shop_confirm_payment')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_record_refund_result'),
        functionBlock(atomic, 'fn_guest_shop_record_refund_result')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_admin_queue_refund'),
        functionBlock(admin, 'fn_guest_shop_admin_queue_refund')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_admin_unlock_dead_letter'),
        functionBlock(admin, 'fn_guest_shop_admin_unlock_dead_letter')
    );
});

test('20260918 function bodies qualify UPDATE SET CASE arms with v_order columns', () => {
    const sql = readSql(MIGRATION_PATH);
    for (const name of TARGET_FUNCTIONS) {
        assertNoUnqualifiedUpdateSet(functionBlock(sql, name), name);
    }

    const claim = functionBlock(sql, 'fn_guest_shop_claim_fulfillment');
    assert.match(
        claim,
        /WHEN\s+v_order\.fulfillment_status\s*=\s*'delivered'\s+THEN\s+v_order\.fulfillment_status/i
    );
    assert.match(
        claim,
        /WHEN\s+v_order\.refund_status\s*=\s*'succeeded'\s+THEN\s+v_order\.refund_status/i
    );

    const unlock = functionBlock(sql, 'fn_guest_shop_admin_unlock_dead_letter');
    assert.match(
        unlock,
        /WHEN\s+v_order\.fulfillment_status\s*=\s*'dead_letter'\s+THEN\s+'failed'/i
    );
    assert.match(unlock, /ELSE\s+v_order\.fulfillment_status/i);

    const confirm = functionBlock(sql, 'fn_guest_shop_confirm_payment');
    assert.match(
        confirm,
        /WHEN\s+v_order\.fulfillment_status\s+IN\s*\(\s*'delivered'\s*,\s*'refunded'\s*\)/i
    );
});

test('20260918 verifier is read-only and requires qualified UPDATE SET status columns', () => {
    const verify = readSql(VERIFY_PATH);

    assert.match(verify, /Codex does not execute this file/i);
    assert.match(verify, /read-only/i);
    assert.doesNotMatch(verify, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+|CREATE\s+OR\s+REPLACE/i);
    assert.match(verify, /to_regprocedure\(\s*format\('public\.%I\(%s\)'/i);
    for (const name of TARGET_FUNCTIONS) {
        assert.match(verify, new RegExp(name, 'i'));
    }
    assert.match(verify, /no_unqualified_update_set/i);
    assert.match(verify, /WHEN\[\[:space:\]\]\+\(fulfillment_status\|refund_status\)/i);
    assert.match(verify, /v_order\\.fulfillment_status/i);
    assert.match(verify, /WHEN\s+observed\s*=\s*expected\s+THEN\s+'PASS'/i);
});
