'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sql = read('supabase/migrations/20261016_tg_purchase_cancellation_expiry.sql');
const verify = read('supabase/migrations/20261016_verify_tg_purchase_cancellation_expiry.sql');
const original = read('supabase/migrations/20261015_tg_purchase_usdt_payments.sql');
function fn(source, name) { return source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))[0]; }
const contains = (source, fragments) => fragments.forEach(fragment => assert.ok(source.includes(fragment), fragment));

test('new migration is transactional, preserves existing quotes and never changes switches or shared shop data', () => {
    assert.match(sql, /^BEGIN;$/m); assert.match(sql, /\nCOMMIT;\s*$/);
    assert.doesNotMatch(sql, /SET\s+(?:enabled|total_minor|payment_expires_at|crypto_checkout)\s*=/i);
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(?:shop_|guest_shop_|wallet|payment_orders)/i);
    contains(sql, ['ACCESS EXCLUSIVE MODE', 'cancelled_at TIMESTAMPTZ', "payment_status IN ('cancelled', 'manual_review')"]);
    const save = fn(sql, 'fn_tg_save_purchase_crypto_checkout');
    const before = fn(original, 'fn_tg_save_purchase_crypto_checkout');
    assert.equal(save, before.replace("\n       OR (p_crypto_checkout->>'quote_expires_at')::TIMESTAMPTZ > now() + interval '5 minutes'", ''), 'all lease, identity, immutable deadline and provider safeguards survive');
});

test('cancellation RPC binds ownership and provider verification under the same purchase row lock as settlement', () => {
    const cancel = fn(sql, 'fn_tg_cancel_purchase');
    contains(cancel, ['status_token_hash = p_status_token_hash FOR UPDATE', "v_order.payment_status = 'cancelled'",
        'v_order.paid_at IS NOT NULL', "v_order.payment_status NOT IN ('awaiting_payment', 'expired')",
        'v_order.provider_trade_no IS DISTINCT FROM p_provider_trade_no', 'p_provider_checked IS DISTINCT FROM true',
        'v_order.checkout_started_at IS NOT NULL', 'WHERE purchase_id = v_order.id', "'purchase_cancelled'"]);
    assert.ok(cancel.indexOf('FOR UPDATE') < cancel.indexOf("SET payment_status = 'cancelled'"));
    assert.doesNotMatch(cancel, /INSERT INTO public\.tg_redemption_orders|DELETE FROM/);
});

test('cancelled callback funds go to manual review before fulfillment without weakening original payment verification', () => {
    const confirm = fn(sql, 'fn_tg_confirm_purchase_payment');
    const start = confirm.indexOf('    -- Cancellation and settlement serialize on the purchase row.');
    const end = confirm.indexOf('    IF v_order.payment_expires_at <= now()', start);
    const cancelled = confirm.slice(start, end);
    contains(cancelled, ['v_order.cancelled_at IS NOT NULL', "SET payment_status = 'manual_review'", 'paid_at = now()',
        'verified_payment = p_verified_payload', 'payment_received_after_cancellation', 'RETURN jsonb_build_object']);
    assert.doesNotMatch(cancelled, /INSERT INTO public\.tg_redemption_orders|SET payment_status = 'paid'/);
    assert.equal(confirm.slice(0, start) + confirm.slice(end), fn(original, 'fn_tg_confirm_purchase_payment'), 'all original signature, merchant, amount, settlement, expiry and idempotency guards survive');
    assert.ok(confirm.indexOf('v_order.cancelled_at IS NOT NULL') < confirm.indexOf('INSERT INTO public.tg_redemption_orders'));
    contains(fn(sql, 'tg_guard_purchase_cancellation'), ['OLD.cancelled_at IS NOT NULL', 'NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at', "NEW.payment_status NOT IN ('cancelled', 'manual_review')"]);
    const worker = read('supabase/migrations/20261015_tg_purchase_domain.sql');
    contains(worker, ["p.payment_status = 'paid' AND p.paid_at IS NOT NULL"]);
});

test('new service-only RPC and read-only verification preserve the evidence boundary', () => {
    contains(sql, ['REVOKE ALL ON FUNCTION public.fn_tg_cancel_purchase(TEXT, CHAR(64), TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;',
        'GRANT EXECUTE ON FUNCTION public.fn_tg_cancel_purchase(TEXT, CHAR(64), TEXT, BOOLEAN) TO service_role;']);
    [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.\w+\([\s\S]*?\n\$\$;/g)].forEach(([source]) => contains(source, ['SECURITY DEFINER', 'SET search_path = public, pg_temp']));
    assert.match(verify, /^BEGIN READ ONLY;$/m);
    assert.doesNotMatch(verify, /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/im);
    assert.ok(verify.includes(sql.slice(sql.lastIndexOf('DO $$'), sql.lastIndexOf('\nCOMMIT;')).trim()));
});

test('public dispatcher exposes cancellation and payment actions keep query on the left', () => {
    contains(read('api/public.js'), ["'purchase/cancel': purchases.cancel"]);
    const html = read('tg.html');
    assert.match(html, /class="tg-payment-actions"[\s\S]*id="tgPaymentRefresh"[\s\S]*id="tgPaymentCancelOrder"/);
});
