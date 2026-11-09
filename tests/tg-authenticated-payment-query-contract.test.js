'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(require.resolve(`../supabase/migrations/${name}`), 'utf8');
const sql = read('20261108013826_tg_authenticated_payment_query.sql');
const definitions = source => [...source.matchAll(/CREATE OR REPLACE FUNCTION public\.fn_tg_confirm_purchase_payment\([\s\S]*?\n\$\$;/g)].map(match => match[0]);

test('the candidate tightens only ZPay proof and preserves the latest recovery function in full', () => {
    const previous = definitions(read('20261017_tg_runtime_recovery.sql')).at(-1);
    assert.ok(previous, 'latest recovery definition must exist');
    assert.equal(definitions(sql).length, 1);
    const expected = previous
        .replace('-- This RPC is service-only. Signature verification happens before the call;', '-- This RPC is service-only. Signature AND authenticated query checks precede the call;')
        .replace("coalesce(p_verified_payload->>'verified_by', '') NOT IN ('signed_notify', 'authenticated_query')", "p_verified_payload->>'verified_by' IS DISTINCT FROM 'authenticated_query'");
    assert.notEqual(expected, previous, 'the new proof restriction must actually be applied');
    assert.equal(definitions(sql)[0], expected, 'locks, NULL handling, crypto, closed orders and idempotency must remain intact');
});

test('the candidate remains transactional and callable only with the exact service-role signature', () => {
    const signature = 'public.fn_tg_confirm_purchase_payment(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,JSONB)';
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`));
    assert.match(sql, /^BEGIN;$/m);
    assert.match(sql, /\nCOMMIT;\s*$/);
    assert.doesNotMatch(sql, /ALTER TABLE|DROP\s|DELETE FROM|UPDATE public\.tg_purchase_products|SET\s+enabled\s*=/i);
});
