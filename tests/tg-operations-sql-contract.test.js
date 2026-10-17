'use strict';
// Source contracts only: no database connection or transaction execution.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations/', name), 'utf8');
const sql = read('20261017_tg_operations_closure.sql');
const verify = read('20261017_verify_tg_operations_closure.sql');
const previous = read('20261015_tg_purchase_usdt_payments.sql');
function get(source, name) {
    const found = source.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.' + name + '\\([\\s\\S]*?\\$\\$;'));
    assert.ok(found, name); return found[0];
}
function includes(source, values) { for (const value of values) assert.ok(source.includes(value), 'Missing safety guard: ' + value); }

test('closure migration is additive, keeps all payment states and exposes new RPCs only to service_role', () => {
    assert.match(sql, /^BEGIN;$/m); assert.match(sql, /COMMIT;\s*$/);
    assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/i);
    assert.doesNotMatch(sql, /SET enabled\s*=\s*true|UPDATE public\.(?:shop_|wallet|payment_orders)/i);
    includes(sql, ["'awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'expired', 'cancelled'"]);
    for (const name of ['fn_tg_preview_code', 'fn_tg_close_purchase', 'fn_tg_review_purchase', 'fn_tg_review_order']) {
        const fn = get(sql, name); includes(fn, ['SECURITY DEFINER SET search_path = public, pg_temp']);
        assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated;`));
        assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role;`));
    }
});

test('preview never mutates reservations and only exposes valid or safely reclaimable entitlements', () => {
    const fn = get(sql, 'fn_tg_preview_code');
    assert.doesNotMatch(fn, /\b(?:UPDATE|INSERT|DELETE|PERFORM)\b/);
    includes(fn, ["b.status = 'active'", 'b.valid_from <= now()', 'c.expires_at > now()', 'b.valid_until > now()',
        "c.status = 'available'", "c.status = 'reserved'", 'c.reservation_expires_at <= now()', "o.status = 'pending'",
        'o.submitted_at IS NULL', 'o.provider_order_id IS NULL', 'o.provider_payment_currency IS NULL', 'o.attempt_count = 0',
        'o.lease_token IS NULL', 'NOT EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts a WHERE a.order_id = o.id)',
        'least(c.expires_at, b.valid_until)']);
    assert.doesNotMatch(fn, /code_ciphertext|code_last4|status_token|telegram_username/);
});

test('purchase close serializes against payments, requires ownership or actor/version, and cannot cancel paid fulfillment', () => {
    const fn = get(sql, 'fn_tg_close_purchase');
    includes(fn, ['WHERE order_no = p_order_no FOR UPDATE', 'v_order.status_token_hash IS DISTINCT FROM p_status_token_hash',
        'p_status_token_hash IS NOT NULL OR p_expected_updated_at IS NULL', 'v_order.updated_at IS DISTINCT FROM p_expected_updated_at',
        "v_order.payment_status NOT IN ('awaiting_payment', 'expired')", 'v_order.paid_at IS NOT NULL', 'v_order.checkout_lease_token IS NOT NULL',
        'v_order.last_error_code IS NOT NULL', 'WHERE purchase_id = v_order.id', "SET payment_status = 'cancelled', checkout_url = NULL", "'purchase_closed'"]);
    assert.ok(fn.indexOf('FOR UPDATE') < fn.indexOf("v_order.payment_status = 'cancelled'"));
    assert.doesNotMatch(fn, /SET paid_at\s*=\s*NULL|UPDATE public\.tg_redemption_codes|INSERT INTO public\.tg_redemption_orders/);
});

test('late payment handling preserves the entire existing signature, merchant, amount and USDT binding contract', () => {
    const current = get(sql, 'fn_tg_confirm_purchase_payment');
    const original = get(previous, 'fn_tg_confirm_purchase_payment');
    const boundary = "    IF v_order.payment_status = 'paid' OR v_order.paid_at IS NOT NULL THEN";
    assert.equal(current.slice(0, current.indexOf(boundary)), original.slice(0, original.indexOf(boundary)));
    includes(current, ["IN ('cancelled', 'manual_review', 'expired')", 'v_order.payment_expires_at <= now()',
        "SET payment_status = 'manual_review'", 'paid_at = now(), verified_payment = p_verified_payload', 'payment_received_after_close']);
    const lateBranch = current.slice(current.indexOf("IF v_order.payment_status IN ('cancelled'"), current.indexOf("UPDATE public.tg_purchase_orders SET payment_status = 'paid'"));
    assert.doesNotMatch(lateBranch, /INSERT INTO public\.tg_redemption_orders/);
    assert.match(lateBranch, /RETURN jsonb_build_object\('success', true/);
});

test('payment approval requires stored verified funds and immutable entitlement, with no duplicate fulfillment', () => {
    const fn = get(sql, 'fn_tg_review_purchase');
    includes(fn, ['WHERE order_no = p_order_no FOR UPDATE', 'v_order.updated_at IS DISTINCT FROM p_expected_updated_at',
        "v_order.payment_status <> 'manual_review'", 'v_order.paid_at IS NULL', 'v_order.provider_trade_no IS NULL', 'v_order.checkout_started_at IS NULL',
        "v_order.verified_payment->>'event_status' IS DISTINCT FROM 'paid'", "WHEN 'zpay' THEN 'signed_notify' WHEN 'nowpayments' THEN 'signed_notify_and_query'",
        'EXISTS (SELECT 1 FROM public.tg_redemption_orders WHERE purchase_id = v_order.id)', 'v_order.product_family, v_order.term_months, v_order.stars_quantity, v_order.telegram_username',
        "'tg-purchase-' || replace(v_order.id::TEXT, '-', '')", "'purchase_review'"]);
    assert.doesNotMatch(fn, /p_verified_payload|SET total_minor|SET telegram_username|SET paid_at|UPDATE public\.tg_redemption_codes/);
});

test('order review takes the same source/order locks as the worker and rejects stale or live-leased operations', () => {
    const fn = get(sql, 'fn_tg_review_order');
    const orderLock = fn.indexOf('SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = p_order_id FOR UPDATE');
    for (const source of ['tg_purchase_orders WHERE id = v_source.purchase_id FOR UPDATE', 'tg_redemption_codes WHERE id = v_source.code_id FOR UPDATE']) {
        assert.ok(fn.indexOf(source) >= 0 && fn.indexOf(source) < orderLock);
    }
    includes(fn, ['v_order.updated_at IS DISTINCT FROM p_expected_updated_at', "v_order.status <> 'manual_review'", 'v_order.lease_expires_at > now()',
        "v_purchase.payment_status IS DISTINCT FROM 'paid'", "v_code.status NOT IN ('reserved', 'fulfilling')"]);
});

test('resume and code release forbid every provider attempt and never clear submission identity', () => {
    const fn = get(sql, 'fn_tg_review_order');
    const block = fn.slice(fn.indexOf("IF p_action IN ('resume_unsubmitted', 'close')"), fn.indexOf("ELSIF p_action = 'reconcile'"));
    includes(block, ['v_order.submitted_at IS NOT NULL', 'v_order.provider_order_id IS NOT NULL', 'v_order.provider_payment_currency IS NOT NULL',
        'v_order.attempt_count <> 0', 'EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts WHERE order_id = v_order.id)', "'submission_unknown'",
        "status = CASE WHEN p_action = 'close' THEN 'cancelled' ELSE 'pending' END"]);
    assert.doesNotMatch(block, /SET submitted_at|SET provider_order_id|attempt_count\s*=\s*0|DELETE FROM/);
});

test('review binds all provider identity and entitlement fields before using the existing worker finalizer', () => {
    const fn = get(sql, 'fn_tg_review_order');
    includes(fn, ["p_snapshot->>'provider_order_id' = v_order.provider_order_id", "p_snapshot->>'verified_by' = 'order_get'", "p_snapshot->>'method' = 'api'",
        "p_snapshot->>'telegram_username' = v_order.telegram_username", "p_snapshot->>'product_family' = v_order.product_family",
        "p_snapshot->'term_months' = coalesce(to_jsonb(v_order.term_months)", "p_snapshot->'stars_quantity' = coalesce(to_jsonb(v_order.stars_quantity)",
        "WHEN 'usdt' THEN 'usd' WHEN 'gram' THEN 'gram'", "IN ('created', 'processing', 'completed', 'failed', 'canceled')",
        'IF NOT coalesce(v_bound, false)', "WHEN 'completed' THEN 'succeeded'", "WHEN 'canceled' THEN 'failed' ELSE 'retry_waiting'",
        'public.fn_tg_finish_order(', "IF v_result->>'success' IS DISTINCT FROM 'true'", "'order_review'"]);
    assert.doesNotMatch(fn, /redeemed_count\s*=|provider_idempotency_key\s*=/);
});

test('operator verification is read-only and distinguishes structural checks from transaction acceptance', () => {
    includes(verify, ['BEGIN READ ONLY;', "has_function_privilege('anon'", "has_function_privilege('authenticated'", "has_function_privilege('service_role'",
        'purchase_binding_conflict', 'provider_completion_unconfirmed', 'concurrent/business acceptance remains NOT RUN']);
    assert.doesNotMatch(verify, /\b(?:UPDATE|INSERT INTO|DELETE FROM)\b/);
});
