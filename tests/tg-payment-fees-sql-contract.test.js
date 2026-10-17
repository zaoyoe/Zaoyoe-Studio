'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const migration = read('supabase/migrations/20261015_tg_purchase_z_fees.sql');
const verify = read('supabase/migrations/20261015_verify_tg_z_purchase_fees.sql');
const usdt = read('supabase/migrations/20261015_tg_purchase_usdt_payments.sql');
const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?\n\$\$;/g)].map((match) => ({ name: match[1], source: match[0] }));
const get = (name) => functions.filter((fn) => fn.name === name).at(-1).source;
const contains = (source, parts) => parts.forEach((part) => assert.ok(source.includes(part), part));

test('fee migration preserves all old payable totals and the shared shop domain', () => {
    assert.match(migration, /^BEGIN;$/m); assert.match(migration, /\nCOMMIT;\s*$/);
    contains(migration, ['ACCESS EXCLUSIVE MODE', 'SET subtotal_minor = total_minor WHERE subtotal_minor IS NULL',
        'ENABLE TRIGGER trg_tg_purchase_quote_identity', 'ENABLE TRIGGER trg_tg_purchase_order_identity']);
    assert.doesNotMatch(migration, /SET\s+(?:total_minor|enabled|payment_status)\s*=/i);
    assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(?:shop_|wallet|payment_orders)/i);
    assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('SQL derives fee-inclusive quote totals and Stars entitlement from subtotal, not client amounts', () => {
    const quote = get('fn_tg_purchase_quote');
    contains(quote, ["p_payment_channel NOT IN ('alipay', 'wxpay', 'usdt_bep20')",
        "p_payment_channel IN ('alipay', 'usdt_bep20') THEN 100 ELSE 0", 'ceil(v_subtotal * v_rate / 10000)',
        'v_total := v_subtotal + v_fee', 'v_total > 100000000', 'FOR SHARE;',
        'v_subtotal::BIGINT, v_fee, v_rate, p_payment_channel']);
    contains(migration, ['total_minor = subtotal_minor + payment_fee_minor',
        'subtotal_minor = ceil(unit_price_micros::NUMERIC * stars_quantity / 10000)::BIGINT',
        'payment_fee_minor = ceil(subtotal_minor::NUMERIC * payment_fee_rate_bps / 10000)::BIGINT']);
    assert.ok(functions.filter((fn) => fn.name === 'fn_tg_purchase_quote')[0].source.includes("'code', 'quote_stale'"));
});

test('creation and identity guards bind channel, subtotal and fee snapshot while retaining idempotent old orders', () => {
    const create = get('fn_tg_create_purchase');
    contains(create, ['v_quote.payment_channel IS NULL', 'v_quote.payment_channel IS DISTINCT FROM p_payment_channel',
        'v_quote.total_minor IS DISTINCT FROM p_expected_total_minor', 'v_quote.subtotal_minor, v_quote.payment_fee_minor, v_quote.payment_fee_rate_bps',
        "'code', 'idempotency_conflict'", 'pg_advisory_xact_lock']);
    assert.ok(create.indexOf("'existing', true") < create.indexOf('v_quote.payment_channel IS NULL'));
    const guard = get('tg_guard_purchase_identity');
    for (const key of ['subtotal_minor', 'payment_fee_minor', 'payment_fee_rate_bps']) {
        contains(guard, [`NEW.${key} IS DISTINCT FROM OLD.${key}`, `NEW.${key} IS DISTINCT FROM v_quote.${key}`]);
    }
    contains(guard, ["TG_OP = 'INSERT' AND v_quote.payment_channel IS NULL", 'TG legacy quote cannot create a new purchase']);
});

test('settlement still binds the full frozen order amount before fulfillment; JSON and admin expose fee detail only', () => {
    const confirm = usdt.slice(usdt.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_confirm_purchase_payment'));
    assert.ok(confirm.indexOf('v_order.total_minor IS DISTINCT FROM p_amount_minor') < confirm.indexOf('INSERT INTO public.tg_redemption_orders'));
    contains(confirm, ["(p_verified_payload->>'actually_paid')::NUMERIC < (v_order.crypto_checkout->>'pay_amount')::NUMERIC"]);
    for (const field of ['subtotal_minor', 'payment_fee_minor', 'payment_fee_rate_bps']) contains(get('tg_purchase_order_json'), [`'${field}', p.${field}`]);
    const view = migration.slice(migration.indexOf('CREATE OR REPLACE VIEW'), migration.indexOf('REVOKE ALL ON FUNCTION'));
    contains(view, ['p.subtotal_minor', 'p.payment_fee_minor', 'p.payment_fee_rate_bps']);
    assert.doesNotMatch(view, /checkout_url|status_token|merchant_id|crypto_checkout/);
});

test('verification is identical and read-only, and new quote RPC stays service-only', () => {
    const checks = migration.slice(migration.lastIndexOf('DO $$'), migration.lastIndexOf('\nCOMMIT;')).trim();
    assert.ok(verify.includes(checks)); assert.match(verify, /^BEGIN READ ONLY;$/m);
    assert.doesNotMatch(verify, /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/im);
    contains(migration, ['REVOKE ALL ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;',
        'GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT, TEXT) TO service_role;']);
    functions.forEach((fn) => contains(fn.source, ['SECURITY DEFINER', 'SET search_path = public, pg_temp']));
});
