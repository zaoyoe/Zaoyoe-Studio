'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261017_tg_runtime_reconciliation.sql'), 'utf8');
const verify = fs.readFileSync(require.resolve('../supabase/migrations/20261017_verify_tg_runtime_reconciliation.sql'), 'utf8');
function get(name) {
    const result = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`));
    assert.ok(result, `missing ${name}`); return result[0];
}
function includes(source, parts) { for (const part of parts) assert.ok(source.includes(part), `missing ${part}`); }

test('final overlay requires network, operations and closed-order review prerequisites', () => {
    includes(sql, ['BEGIN;', 'COMMIT;', 'fn_tg_purchase_resolution_ready()', 'fn_tg_bind_purchase_network_quote(uuid,text)',
        'fn_tg_review_order(uuid,text,timestamp with time zone,uuid,text,jsonb)', 'RAISE EXCEPTION']);
    assert.ok(sql.indexOf('fn_tg_purchase_resolution_ready()') < sql.indexOf('CREATE OR REPLACE FUNCTION'));
    assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.tg_settings|UPDATE public\.tg_products/);
});

test('final validator preserves all four network identities, address rules, native prices and optional memo', () => {
    const fn = get('tg_valid_purchase_crypto_checkout');
    includes(fn, ["WHEN 'usdtbsc' THEN 'BSC (BEP20)'", "WHEN 'usdtton' THEN 'TON'", "WHEN 'usdtmatic' THEN 'Polygon'", "WHEN 'usdttrc20' THEN 'TRON (TRC20)'",
        "'payin_extra_id'", "NOT IN (8, 9)", "^0x[0-9a-fA-F]{40}$", "^T[1-9A-HJ-NP-Za-km-z]{33}$", '[EUek]Q',
        "p_checkout->>'price_currency' IS DISTINCT FROM p_checkout->>'pay_currency'", "(p_checkout->>'pay_amount')::NUMERIC * 100 = (p_checkout->>'price_amount_minor')::BIGINT"]);
});

test('network binding stays immutable and checkout writes require the exact network, live lease and unclosed order', () => {
    includes(get('fn_tg_bind_purchase_network_quote'), ['FOR UPDATE', 'USDT network quote immutable', 'Cannot bind network after order creation']);
    const fn = get('fn_tg_save_purchase_crypto_checkout');
    includes(fn, ['pg_advisory_xact_lock', 'FOR UPDATE', 'tg_purchase_network_quotes', 'payment_network_mismatch',
        'v_order.closed_at IS NOT NULL', 'v_order.cancelled_at IS NOT NULL', 'v_order.checkout_lease_token IS DISTINCT FROM p_lease_token', 'lease_lost']);
    assert.ok(fn.indexOf('payment_network_mismatch') < fn.indexOf('SET provider_trade_no'));
});

test('settlement retains authenticated ZPay query binding and compares USDT proof to the saved network and amount', () => {
    const fn = get('fn_tg_confirm_purchase_payment');
    includes(fn, ["NOT IN ('signed_notify', 'authenticated_query')", "'signed_notify_and_query'", "p_verified_payload->>'provider_order_no' IS DISTINCT FROM p_order_no",
        "p_verified_payload->>'merchant_id' IS DISTINCT FROM p_merchant_id", "p_verified_payload->>'checkout_trade_no' = v_order.provider_trade_no",
        "p_verified_payload->>'price_currency' IS DISTINCT FROM v_order.crypto_checkout->>'price_currency'",
        "p_verified_payload->>'pay_currency' IS DISTINCT FROM v_order.crypto_checkout->>'pay_currency'",
        "p_verified_payload->>'actually_paid_currency' IS DISTINCT FROM v_order.crypto_checkout->>'pay_currency'",
        "coalesce(p_verified_payload->>'payin_extra_id', '') IS DISTINCT FROM coalesce(v_order.crypto_checkout->>'payin_extra_id', '')",
        "(p_verified_payload->>'actually_paid')::NUMERIC < (v_order.crypto_checkout->>'pay_amount')::NUMERIC"]);
    assert.doesNotMatch(fn, /price_currency' IS DISTINCT FROM 'usd'|pay_currency' IS DISTINCT FROM 'usdtbsc'/);
});

test('close, cancellation, expired and review payments are guarded before any fulfillment insert', () => {
    const fn = get('fn_tg_confirm_purchase_payment');
    includes(fn, ['v_order.cancelled_at IS NOT NULL OR v_order.closed_at IS NOT NULL', "v_order.payment_status IN ('manual_review', 'expired')",
        'payment_received_after_close', 'payment_received_after_cancellation', 'payment_received_after_expiry']);
    for (const guard of ['v_order.closed_at IS NOT NULL', 'payment_received_after_expiry']) {
        assert.ok(fn.indexOf(guard) < fn.indexOf('INSERT INTO public.tg_redemption_orders'));
    }
    assert.ok(fn.indexOf('pg_advisory_xact_lock') < fn.indexOf('FOR UPDATE'));
    includes(get('fn_tg_close_purchase'), ['FOR UPDATE', 'p_expected_updated_at', 'v_order.closed_at IS NOT NULL', 'cancelled_at = coalesce(cancelled_at, now())']);
});

test('order projection preserves fees, crypto, closure and eligibility together', () => {
    includes(get('tg_purchase_order_json'), ["'subtotal_minor'", "'payment_fee_minor'", "'payment_fee_rate_bps'", "'price_version'", "'crypto_checkout'",
        "'closed_at'", "'can_close'", "CASE WHEN p.closed_at IS NOT NULL THEN 'closed'", 'p.paid_at IS NULL', 'p.last_error_code IS NULL', 'f.id IS NULL']);
});

test('legacy approval cannot bypass rechecked review and task review cannot reopen a closed purchase', () => {
    const legacy = get('fn_tg_review_purchase');
    includes(legacy, ["IF p_action = 'approve_payment' THEN", 'payment_recheck_required', "p_action IS DISTINCT FROM 'note'", 'version_conflict', 'purchase_review']);
    assert.doesNotMatch(legacy, /INSERT INTO public\.tg_redemption_orders|SET payment_status/);
    includes(get('fn_tg_review_order'), ['v_purchase.closed_at IS NOT NULL', 'provider_order_id', 'fn_tg_finish_order']);
});

test('all replaced functions are service-only and read-only verification keeps business acceptance separate', () => {
    const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(match => match[1]);
    const revoke = sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION'), sql.indexOf('GRANT EXECUTE ON FUNCTION'));
    const grant = sql.slice(sql.indexOf('GRANT EXECUTE ON FUNCTION'));
    for (const name of names) { includes(revoke, [`public.${name}(`]); includes(grant, [`public.${name}(`]); }
    includes(revoke, ['FROM PUBLIC, anon, authenticated']); includes(grant, ['TO service_role']);
    includes(verify, ['BEGIN READ ONLY;', "has_function_privilege('anon'", "has_function_privilege('authenticated'", "has_function_privilege('service_role'",
        'payment_recheck_required', 'usdttrc20', 'concurrent/business acceptance remains NOT RUN']);
    // Quoted function-body checks are evidence assertions, not SQL writes.
    assert.doesNotMatch(verify, /^\s*(?:UPDATE|INSERT INTO|DELETE FROM|CALL)\b/m);
});
