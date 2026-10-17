'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(require.resolve(`../supabase/migrations/${name}`), 'utf8');
const sql = read('20261016_tg_purchase_zpay_reconciliation.sql');
const previous = read('20261016_payment_usdt_network_selection.sql');
const fn = source => source.match(/CREATE OR REPLACE FUNCTION public\.fn_tg_confirm_purchase_payment\([\s\S]*?\n\$\$;/)[0];

test('ZPay query reconciliation preserves the full existing crypto, expiry, cancellation and idempotent fulfillment logic', () => {
    const start = '    -- A signed IPN and independent provider GET';
    assert.equal(fn(sql).slice(fn(sql).indexOf(start)), fn(previous).slice(fn(previous).indexOf(start)));
    assert.ok(fn(sql).includes('pg_advisory_xact_lock'));
    assert.ok(fn(sql).includes('WHERE order_no = p_order_no FOR UPDATE'));
    assert.ok(fn(sql).includes('v_order.total_minor IS DISTINCT FROM p_amount_minor'));
    assert.ok(fn(sql).includes('other.provider_trade_no = p_provider_trade_no'));
});

test('only exact server query proof can replace the original checkout alias; signed callbacks cannot rebind a real trade', () => {
    for (const fragment of ["NOT IN ('signed_notify', 'authenticated_query')", "p_verified_payload->>'provider_order_no' IS DISTINCT FROM p_order_no",
        "p_verified_payload->>'merchant_id' IS DISTINCT FROM p_merchant_id", "p_verified_payload->>'provider_trade_no' IS DISTINCT FROM p_provider_trade_no",
        "p_verified_payload->>'payment_channel' IS DISTINCT FROM p_payment_channel", "p_verified_payload->>'amount_minor' IS DISTINCT FROM p_amount_minor::TEXT",
        "p_verified_payload->>'currency' IS DISTINCT FROM p_currency", "AND v_order.provider_trade_no = v_order.order_no",
        "AND p_verified_payload->>'checkout_trade_no' = v_order.provider_trade_no", 'AND v_order.paid_at IS NULL',
        'NOT EXISTS (SELECT 1 FROM public.tg_redemption_orders f WHERE f.purchase_id = v_order.id)', "'purchase_payment_trade_reconciled'"])
        assert.ok(sql.includes(fragment), fragment);
    assert.match(sql, /FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /TO service_role;/);
    assert.match(sql, /^BEGIN;$/m); assert.match(sql, /\nCOMMIT;\s*$/);
    assert.doesNotMatch(sql, /ALTER TABLE|DELETE FROM|SET\s+(enabled|total_minor|payment_expires_at)\s*=/i);
    assert.ok(sql.includes('fn_tg_purchase_payment_reconciliation_ready'));
});

test('absent or null checkout proof cannot bypass the transaction identity check', () => {
    assert.match(fn(sql), /v_order\.provider_trade_no IS DISTINCT FROM p_provider_trade_no[\s\S]*?AND NOT coalesce\(\(p_provider = 'zpay'[\s\S]*?p_verified_payload->>'checkout_trade_no' = v_order\.provider_trade_no[\s\S]*?NOT EXISTS \(SELECT 1 FROM public\.tg_redemption_orders f WHERE f\.purchase_id = v_order\.id\)\), false\)\)/);
});

test('the immutable purchase trigger accepts only the first authenticated alias reconciliation and preserves all quote identity checks', () => {
    const guard = source => source.match(/CREATE OR REPLACE FUNCTION public\.tg_guard_purchase_identity\(\)[\s\S]*?\n\$\$;/)[0];
    const oldGuard = guard(read('20261015_tg_purchase_z_fees.sql'));
    const newGuard = guard(sql);
    const before = '        -- Only a complete authenticated merchant-query proof';
    const oldBefore = '        IF OLD.provider_trade_no IS NOT NULL AND NEW.provider_trade_no';
    assert.equal(newGuard.slice(0, newGuard.indexOf(before)), oldGuard.slice(0, oldGuard.indexOf(oldBefore)));
    const after = "            RAISE EXCEPTION 'TG payment trade identity is immutable'";
    assert.equal(newGuard.slice(newGuard.indexOf(after)), oldGuard.slice(oldGuard.indexOf(after)));
    for (const fragment of ["AND NOT coalesce((OLD.payment_provider = 'zpay' AND OLD.provider_trade_no = OLD.order_no",
        'OLD.paid_at IS NULL AND OLD.checkout_started_at IS NOT NULL', "NEW.payment_status IN ('paid', 'manual_review') AND NEW.paid_at IS NOT NULL",
        "NEW.verified_payment->>'verified_by' = 'authenticated_query'", "NEW.verified_payment->>'event_status' = 'paid'",
        "NEW.verified_payment->>'checkout_trade_no' = OLD.provider_trade_no", "NEW.verified_payment->>'provider_order_no' = OLD.order_no",
        "NEW.verified_payment->>'merchant_id' = OLD.payment_merchant_id", "NEW.verified_payment->>'provider_trade_no' = NEW.provider_trade_no",
        "NEW.verified_payment->>'payment_channel' = OLD.payment_channel", "NEW.verified_payment->>'amount_minor' = OLD.total_minor::TEXT",
        "NEW.verified_payment->>'currency' = OLD.currency", 'NOT EXISTS (SELECT 1 FROM public.tg_redemption_orders f WHERE f.purchase_id = OLD.id)), false)'])
        assert.ok(newGuard.includes(fragment), fragment);
    const ready = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_purchase_payment_reconciliation_ready'));
    assert.ok(ready.includes("'public.tg_guard_purchase_identity()'::regprocedure"));
    assert.ok(ready.includes("position('NEW.verified_payment'"));
});
