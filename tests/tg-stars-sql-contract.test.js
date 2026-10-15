'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Source contracts only; this test never connects to or executes PostgreSQL.
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015_tg_stars_redemption.sql'), 'utf8');
const currency = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015_tg_payment_currency_guard.sql'), 'utf8');
const functions = Array.from(sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^$]*?)\)\nRETURNS[\s\S]*?\n\$\$;/g), (m) => ({ name: m[1], args: m[2], definition: m[0] }));
const get = (name, arg = '') => functions.find((f) => f.name === name && f.args.includes(arg)).definition;
const includes = (source, fragments) => fragments.forEach((fragment) => assert.ok(source.includes(fragment), `missing safety contract: ${fragment}`));

test('Stars migration is additive, transactional and never changes original SQL or enables purchases', () => {
    assert.match(sql, /^BEGIN;$/m);
    assert.match(sql, /\nCOMMIT;\s*$/);
    assert.doesNotMatch(sql, /\b(?:DROP\s+TABLE|TRUNCATE\s+(?:TABLE\s+)?(?:public\.)?[A-Za-z_]\w*|DELETE\s+FROM)\b/i);
    assert.doesNotMatch(sql, /TG_FULFILLMENT_ENABLED|TG_REDEMPTION_ENABLED/);
    assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS stars_quantity INTEGER/g) || []).length, 2);
    assert.equal((sql.match(/ALTER COLUMN term_months DROP NOT NULL/g) || []).length, 2);
    assert.equal((sql.match(/stars_quantity IS NOT NULL AND stars_quantity BETWEEN 50 AND 1000000/g) || []).length, 2);
    assert.equal((sql.match(/term_months IN \(3, 6, 12\) AND stars_quantity IS NULL/g) || []).length, 2);
    assert.ok(sql.indexOf('DO $$') < sql.lastIndexOf('COMMIT;'));
});

test('Stars generation keeps code batch count separate from exact Stars entitlement', () => {
    const generate = get('fn_tg_generate_stars_batch');
    includes(generate, [
        'p_stars_quantity IS NULL OR p_stars_quantity NOT BETWEEN 50 AND 1000000',
        'p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000',
        'jsonb_array_length(p_codes) <> p_quantity',
        "v_batch_no, 'telegram_stars', NULL, p_stars_quantity, p_quantity",
        "'stars_quantity', v_batch.stars_quantity, 'quantity', v_batch.quantity",
        'GROUP BY code.item->>\'code_digest\'', 'duplicate TG code digest'
    ]);
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.fn_tg_generate_batch\(/);
});

test('code batches and order entitlements are immutable and cannot cross products', () => {
    includes(sql, [
        'NEW.batch_id IS DISTINCT FROM OLD.batch_id',
        'NEW.code_id IS DISTINCT FROM OLD.code_id',
        'NEW.product_family IS DISTINCT FROM v_batch.product_family',
        'NEW.term_months IS DISTINCT FROM v_batch.term_months',
        'NEW.stars_quantity IS DISTINCT FROM v_batch.stars_quantity',
        'BEFORE INSERT OR UPDATE OF code_id, product_family, term_months, stars_quantity',
        'existing TG entitlement mismatch requires manual review'
    ]);
    const reserve = get('fn_tg_reserve_code');
    includes(reserve, [
        'FOR UPDATE;', 'FOR SHARE;',
        'v_batch.product_family, v_batch.term_months, v_batch.stars_quantity',
        'eb.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity',
        "'product_family', v_order.product_family", "'stars_quantity', v_order.stars_quantity",
        'EXCEPTION WHEN unique_violation', "'idempotency_conflict'"
    ]);
    assert.equal((reserve.match(/eb\.stars_quantity IS NOT DISTINCT FROM v_order\.stars_quantity/g) || []).length, 3);
});

test('legacy workers can only claim Premium and Stars requires an explicit capability', () => {
    const legacy = functions.find((f) => f.name === 'fn_tg_claim_order' && !f.args.includes('p_product_families')).definition;
    const claim = get('fn_tg_claim_order', 'p_product_families');
    includes(legacy, ["ARRAY['telegram_premium']::TEXT[]"]);
    assert.doesNotMatch(legacy, /telegram_stars/);
    includes(claim, [
        'p_product_families TEXT[]', 'cardinality(p_product_families) = 0',
        'array_position(p_product_families, NULL) IS NOT NULL',
        "ARRAY['telegram_premium', 'telegram_stars']::TEXT[]",
        'o.product_family = ANY(p_product_families)',
        'FOR UPDATE OF c SKIP LOCKED', 'FOR UPDATE SKIP LOCKED',
        'v_order.attempt_count = 0', 'v_order.submitted_at IS NULL AND v_order.provider_payment_currency IS NULL',
        'missing_historical_payment_currency', "'stars_quantity', v_order.stars_quantity"
    ]);
    assert.equal((claim.match(/o\.product_family = ANY\(p_product_families\)/g) || []).length, 2);
    assert.ok(claim.indexOf('FOR UPDATE OF c SKIP LOCKED') < claim.indexOf('FOR UPDATE SKIP LOCKED'));
});

test('Stars leaves both fifth-migration submission marker implementations byte-for-byte intact', () => {
    const start = currency.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_mark_submitted(');
    const end = currency.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_finish_order(');
    assert.ok(sql.includes(currency.slice(start, end)));
});

test('completion requires exact product quantity, recipient, saved currency and independent GET', () => {
    const finish = get('fn_tg_finish_order');
    includes(finish, [
        "v_snapshot->>'product_family' = 'telegram_stars'",
        "v_snapshot->>'product_type' = 'stars'",
        "v_snapshot->>'stars_quantity' = v_order.stars_quantity::TEXT",
        "jsonb_typeof(v_snapshot->'stars_quantity') = 'number'",
        "coalesce(v_snapshot->'term_months', 'null'::JSONB) = 'null'::JSONB",
        "coalesce(v_snapshot->>'product_family', 'telegram_premium') = 'telegram_premium'",
        "v_snapshot->>'term_months' = v_order.term_months::TEXT",
        "v_snapshot->>'product_type' = 'premium_' || v_order.term_months::TEXT || '_month'",
        "v_snapshot->>'currency' = CASE v_order.provider_payment_currency",
        "WHEN 'gram' THEN 'gram' WHEN 'usdt' THEN 'usd' ELSE NULL END",
        "v_snapshot->>'verified_by' = 'order_get'", "v_snapshot->>'method' = 'api'",
        "v_snapshot->>'provider_order_id' = v_provider_id",
        "v_snapshot->'completed' = 'true'::JSONB",
        "v_snapshot->>'provider_status' = 'completed'",
        "lower(regexp_replace(coalesce(v_snapshot->>'telegram_username', ''), '^@', '')) = v_order.telegram_username",
        'provider_order_conflict', 'entitlement_binding_conflict',
        "'term_months', 'product_family', 'stars_quantity', 'product_type'",
        'v_order.lease_token IS DISTINCT FROM p_lease_token',
        'SET redeemed_count = redeemed_count + 1'
    ]);
    assert.doesNotMatch(finish, /status\s*=\s*'available'/);
});

test('upgraded functions stay service-only and transaction verifies ACL, RLS and identity guards', () => {
    for (const fn of functions) includes(fn.definition, ['SECURITY DEFINER', 'SET search_path = public, pg_temp']);
    assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (?:PUBLIC|anon|authenticated)/);
    for (const name of ['fn_tg_generate_stars_batch', 'fn_tg_reserve_code', 'fn_tg_order_status', 'fn_tg_claim_order', 'fn_tg_mark_submitted', 'fn_tg_finish_order']) {
        assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated;`));
        assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role;`));
    }
    const checks = sql.slice(sql.lastIndexOf('DO $$'));
    includes(checks, ['to_regprocedure(v_signature)', 'aclexplode', 'a.grantee = 0', 'p.prosecdef', 'c.relrowsecurity',
        "has_function_privilege('service_role'", 'pg_get_functiondef', 'trg_tg_order_entitlement_identity',
        'TG Stars schema, immutable entitlement, service ACL and worker guards verified']);
});
