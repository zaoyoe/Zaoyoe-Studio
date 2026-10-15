'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source-only contracts: this suite never connects to a database or executes SQL.
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261015_tg_payment_currency_guard.sql'), 'utf8');
const functions = Array.from(sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\n\)\n([\s\S]*?)\n\$\$;/g), (match) => ({
    name: match[1], args: match[2], definition: match[0], body: match[3]
}));
const claim = functions.find((fn) => fn.name === 'fn_tg_claim_order').definition;
const legacyMarker = functions.find((fn) => fn.name === 'fn_tg_mark_submitted' && !fn.args.includes('p_payment_currency')).definition;
const marker = functions.find((fn) => fn.name === 'fn_tg_mark_submitted' && fn.args.includes('p_payment_currency')).definition;
const finish = functions.find((fn) => fn.name === 'fn_tg_finish_order').definition;

function containsAll(source, fragments) {
    for (const fragment of fragments) assert.ok(source.includes(fragment), `missing safety contract: ${fragment}`);
}

test('TG currency upgrade is one additive transaction without a guessed legacy backfill', () => {
    assert.match(sql, /^BEGIN;$/m);
    assert.match(sql, /\nCOMMIT;\s*$/);
    assert.ok(sql.indexOf('BEGIN;') < sql.indexOf('ALTER TABLE'));
    assert.ok(sql.lastIndexOf('DO $$') < sql.lastIndexOf('COMMIT;'));
    assert.match(sql, /ADD COLUMN IF NOT EXISTS provider_payment_currency TEXT;/);
    assert.match(sql, /provider_payment_currency IS NULL OR provider_payment_currency IN \('gram', 'usdt'\)/);
    assert.doesNotMatch(sql, /provider_payment_currency TEXT (?:NOT NULL|DEFAULT)/);
    assert.doesNotMatch(sql, /(?:current_setting|GRAMIX_PAYMENT_CURRENCY|SET\s+provider_payment_currency\s*=)/i);
    assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/i);
    assert.equal(functions.length, 4);
});

test('legacy submission overload refuses purchase without mutating a marker', () => {
    assert.match(legacyMarker, /RETURN jsonb_build_object\('success', false, 'code', 'payment_currency_required'\)/);
    assert.doesNotMatch(legacyMarker, /\b(?:UPDATE|INSERT|DELETE|PERFORM)\b/i);
    assert.match(marker, /p_payment_currency TEXT\n\)/);
    assert.doesNotMatch(marker, /p_payment_currency TEXT DEFAULT/);
});

test('currency and write-ahead marker are persisted atomically under the original single-submit lease CAS', () => {
    containsAll(marker, [
        "p_payment_currency IS NULL OR p_payment_currency NOT IN ('gram', 'usdt')",
        "'code', 'payment_currency_invalid'",
        'SET submitted_at = now(), provider_payment_currency = p_payment_currency, updated_at = now()',
        'o.id = p_order_id AND o.lease_token = p_lease_token',
        "o.lease_expires_at > now() AND o.status = 'processing'",
        'o.submitted_at IS NULL AND o.provider_order_id IS NULL',
        'o.provider_payment_currency IS NULL',
        'o.attempt_count = 1',
        "'code', 'submission_not_authorized'",
        'RETURNING o.submitted_at, o.attempt_count, o.provider_payment_currency',
        "'payment_currency', v_payment_currency"
    ]);
    assert.ok(marker.indexOf('payment_currency_invalid') < marker.indexOf('UPDATE public.tg_redemption_orders'));
    assert.equal((marker.match(/UPDATE public\.tg_redemption_orders/g) || []).length, 1);
    assert.match(marker, /UPDATE public\.tg_fulfillment_attempts[\s\S]*request_payload = coalesce\(request_payload, '\{\}'::JSONB\)[\s\S]*'payment_currency', v_payment_currency/);
    assert.match(marker, /provider_submission_marked[\s\S]*jsonb_build_object\('payment_currency', v_payment_currency\)/);
    assert.match(marker, /RETURN jsonb_build_object\('success', true,[\s\S]*'payment_currency', v_payment_currency\)/);
});

test('claim only buys an untouched entitlement and polls an order with saved payment currency', () => {
    containsAll(claim, [
        "v_order.status = 'pending' AND v_order.provider_order_id IS NULL",
        'v_order.submitted_at IS NULL AND v_order.provider_payment_currency IS NULL',
        'v_order.attempt_count = 0', "v_code.status = 'reserved'",
        'SELECT 1 FROM public.tg_fulfillment_attempts a WHERE a.order_id = v_order.id',
        "ELSIF v_order.provider_order_id IS NOT NULL\n          AND v_order.provider_payment_currency IN ('gram', 'usdt') THEN",
        "v_action := 'poll'", "'provider_payment_currency', v_order.provider_payment_currency",
        'provider_payment_currency_unconfirmed', 'missing_historical_payment_currency',
        "SET status = 'manual_review', lease_token = NULL, lease_expires_at = NULL",
        "SET status = 'fulfilling'", 'reservation_expires_at = NULL'
    ]);
    assert.ok(claim.indexOf('FOR UPDATE OF c SKIP LOCKED') < claim.indexOf('FOR UPDATE SKIP LOCKED'));
    assert.equal((claim.match(/o\.lease_token IS NULL OR o\.lease_expires_at <= now\(\)/g) || []).length, 2);
    assert.doesNotMatch(claim, /status\s*=\s*'available'/);
});

test('completion binds official GET denomination to historical currency rather than accepting both currencies', () => {
    containsAll(finish, [
        "v_order.provider_payment_currency IS NULL\n       AND (v_order.submitted_at IS NOT NULL OR v_provider_id IS NOT NULL OR v_state = 'succeeded')",
        "v_error_code := 'provider_payment_currency_unconfirmed'",
        'v_order.submitted_at IS NOT NULL',
        "v_order.provider_payment_currency IN ('gram', 'usdt')",
        "v_snapshot->>'currency' = CASE v_order.provider_payment_currency\n                WHEN 'gram' THEN 'gram' WHEN 'usdt' THEN 'usd' ELSE NULL END",
        "IF NOT coalesce(v_complete, false) THEN\n            v_state := 'manual_review'"
    ]);
    assert.doesNotMatch(finish, /v_snapshot->>'currency'\s+IN\s*\(/);
    assert.ok(finish.indexOf('provider_payment_currency_unconfirmed') < finish.indexOf("IF v_state = 'succeeded' THEN"));
});

test('currency upgrade preserves completion identity, snapshot redaction, lease and entitlement accounting guards', () => {
    containsAll(finish, [
        'SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_code_id FOR UPDATE;',
        'SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = p_order_id FOR UPDATE;',
        "v_order.lease_token IS DISTINCT FROM p_lease_token OR v_order.status <> 'processing'",
        "'code', 'lease_lost'", "v_error_code := 'provider_order_conflict'",
        'WHERE other.provider = v_order.provider AND other.provider_order_id = v_provider_id',
        'v_order.provider_order_id IS NOT NULL', 'v_provider_id = v_order.provider_order_id',
        "v_snapshot->>'provider_order_id' = v_provider_id", "v_snapshot->'completed' = 'true'::JSONB",
        "v_snapshot->>'provider_status' = 'completed'", "v_snapshot->>'method' = 'api'",
        "v_snapshot->>'verified_by' = 'order_get'",
        "lower(regexp_replace(coalesce(v_snapshot->>'telegram_username', ''), '^@', '')) = v_order.telegram_username",
        "v_snapshot->>'term_months' = v_order.term_months::TEXT",
        "v_snapshot->>'product_type' = 'premium_' || v_order.term_months::TEXT || '_month'",
        "coalesce(v_snapshot->'idempotency_key_matches', 'true'::JSONB) <> 'false'::JSONB",
        'FROM jsonb_each(p_provider_snapshot) e', 'WHERE e.key IN (',
        "'verified_by', 'amount', 'currency'", "SET status = CASE WHEN v_state = 'succeeded' THEN 'fulfilled'",
        'SET redeemed_count = redeemed_count + 1', "'payment_currency', v_order.provider_payment_currency"
    ]);
    assert.ok(finish.indexOf('SELECT * INTO v_code') < finish.indexOf('SELECT * INTO v_order'));
    assert.doesNotMatch(finish, /status\s*=\s*'available'/);
    assert.doesNotMatch(finish, /provider_payment_currency\s*=/);
});

test('all upgraded overloads stay service-only with a fixed definer search path', () => {
    for (const fn of functions) {
        containsAll(fn.definition, ['SECURITY DEFINER', 'SET search_path = public, pg_temp']);
    }
    for (const signature of [
        'fn_tg_claim_order(UUID, UUID, INTEGER)', 'fn_tg_mark_submitted(UUID, UUID)',
        'fn_tg_mark_submitted(UUID, UUID, TEXT)',
        'fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ)'
    ]) containsAll(sql, [
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`,
        `GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`
    ]);
    assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (?:PUBLIC|anon|authenticated)/);
});

test('same-transaction verification checks schema, overload implementations, ACL and security settings', () => {
    const checks = sql.slice(sql.lastIndexOf('DO $$'));
    containsAll(checks, [
        "column_name = 'provider_payment_currency' AND data_type = 'text'",
        "is_nullable = 'YES' AND column_default IS NULL", "c.contype = 'c' AND c.convalidated",
        'to_regprocedure(v_signature)', 'has_function_privilege(v_role, v_function',
        "has_function_privilege('service_role', v_function", 'aclexplode', 'a.grantee = 0',
        "ARRAY['search_path=public, pg_temp']", 'p.prosecdef', 'pg_get_functiondef',
        "'payment_currency_required'", "'missing_historical_payment_currency'",
        "'v_snapshot->>''currency'' = CASE v_order.provider_payment_currency'",
        "'WHEN ''gram'' THEN ''gram'' WHEN ''usdt'' THEN ''usd'' ELSE NULL END'",
        "RAISE NOTICE 'TG payment currency guard schema, ACL and RPC verification passed'"
    ]);
    assert.ok(checks.indexOf('RAISE NOTICE') < checks.indexOf('COMMIT;'));
});
