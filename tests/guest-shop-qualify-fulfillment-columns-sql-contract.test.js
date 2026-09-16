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
    '20260917_guest_shop_qualify_fulfillment_columns.sql'
);
const VERIFY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260917_verify_guest_shop_qualify_fulfillment_columns.sql'
);
const HISTORICAL_ATOMIC_RPCS_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260913_guest_shop_atomic_rpcs.sql'
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

test('20260917 only replaces claim/release, stays additive, and matches the patched 20260913 bodies', () => {
    const sql = readSql(MIGRATION_PATH);
    const historical = readSql(HISTORICAL_ATOMIC_RPCS_PATH);

    assert.match(sql, /Codex does not execute this file/i);
    assert.match(sql, /does not enable guest products/i);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+FUNCTION\b[^;]*\bCASCADE\b/i);
    assert.doesNotMatch(sql, /SET\s+allow_guest_purchase\s*=\s*(?:TRUE|true)/i);
    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_claim_fulfillment\s*\(/i);
    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_release_reservation\s*\(/i);
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_create_order\s*\(/i);
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_guest_shop_confirm_payment\s*\(/i);
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
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_guest_shop_release_reservation\(UUID,\s*UUID,\s*TEXT\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    assert.match(
        sql,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_guest_shop_release_reservation\(UUID,\s*UUID,\s*TEXT\)\s+TO\s+service_role/i
    );

    assert.equal(
        functionBlock(sql, 'fn_guest_shop_claim_fulfillment'),
        functionBlock(historical, 'fn_guest_shop_claim_fulfillment')
    );
    assert.equal(
        functionBlock(sql, 'fn_guest_shop_release_reservation'),
        functionBlock(historical, 'fn_guest_shop_release_reservation')
    );
});

test('20260917 claim/release UPDATE SET CASE arms use v_order status columns', () => {
    const sql = readSql(MIGRATION_PATH);
    const claim = functionBlock(sql, 'fn_guest_shop_claim_fulfillment');
    const release = functionBlock(sql, 'fn_guest_shop_release_reservation');

    for (const [name, body] of [['claim', claim], ['release', release]]) {
        assert.doesNotMatch(
            body,
            /WHEN\s+(fulfillment_status|refund_status)\s*(=|IN)/i,
            `${name} should not use unqualified WHEN status-column CASE arms`
        );
        assert.doesNotMatch(
            body,
            /(THEN|ELSE)\s+(fulfillment_status|refund_status)\b(?!\.)/i,
            `${name} should not use unqualified THEN/ELSE status-column CASE arms`
        );
    }
    assert.match(
        claim,
        /WHEN\s+v_order\.fulfillment_status\s*=\s*'delivered'\s+THEN\s+v_order\.fulfillment_status/i
    );
    assert.match(
        release,
        /WHEN\s+v_order\.refund_status\s*=\s*'succeeded'\s+THEN\s+v_order\.refund_status/i
    );
});

test('20260917 verifier is read-only and requires aliased RETURN QUERY columns', () => {
    const verify = readSql(VERIFY_PATH);

    assert.match(verify, /Codex does not execute this file/i);
    assert.match(verify, /read-only/i);
    assert.doesNotMatch(verify, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+|CREATE\s+OR\s+REPLACE/i);
    assert.match(verify, /to_regprocedure\(\s*format\('public\.%I\(%s\)'/i);
    assert.match(verify, /fn_guest_shop_claim_fulfillment/i);
    assert.match(verify, /fn_guest_shop_release_reservation/i);
    assert.match(verify, /o\\.fulfillment_status/i);
    assert.match(verify, /no_unqualified_select/i);
    assert.match(verify, /WHEN\s+observed\s*=\s*expected\s+THEN\s+'PASS'/i);
});
