'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sql = read('supabase/migrations/20261016_tg_purchase_fulfillment_review.sql');
const verification = read('supabase/migrations/20261016_verify_tg_purchase_fulfillment_review.sql');
const settlement = read('supabase/migrations/20261016_tg_purchase_zpay_reconciliation.sql');
const definition = (source, name) => {
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, `${name} is present`);
    const end = source.indexOf('\n$$;', start);
    assert.ok(end > start, `${name} is complete`);
    return source.slice(start, end + 4);
};
const approval = definition(sql, 'fn_tg_approve_purchase_fulfillment');
const ready = definition(sql, 'fn_tg_purchase_fulfillment_review_ready');
const includes = (source, fragments) => fragments.forEach((fragment) => assert.ok(source.includes(fragment), fragment));
const position = (source, fragment) => { const index = source.indexOf(fragment); assert.ok(index >= 0, fragment); return index; };
const signature = 'public.fn_tg_approve_purchase_fulfillment(TEXT, UUID, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, JSONB, BOOLEAN, BOOLEAN)';

// Static safety contracts only. No database connection, SQL execution, live
// approval, worker invocation or claim of DB concurrency acceptance.
test('install is one additive transaction and cannot approve existing orders or enable fulfillment', () => {
    assert.match(sql, /^BEGIN;$/m); assert.match(sql, /\nCOMMIT;\s*$/);
    const outsideFunctions = sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$\$;/g, '');
    assert.doesNotMatch(outsideFunctions, /\b(?:INSERT INTO|UPDATE public|DELETE FROM|SELECT\s+public\.fn_tg_approve_purchase_fulfillment)\b/i);
    assert.doesNotMatch(sql, /ALTER TABLE|DROP TABLE|TRUNCATE|SET\s+(?:enabled|sale_enabled)\s*=|TG_FULFILLMENT_ENABLED/i);
    includes(sql, ['Apply the TG ZPay reconciliation migration first', 'IF NOT public.fn_tg_purchase_payment_reconciliation_ready() THEN']);
});

test('readiness requires the valid unique purchase index and the predecessor reconciliation contract', () => {
    for (const source of [sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION')), ready]) includes(source, [
        'public.idx_tg_redemption_orders_purchase', "i.indrelid = 'public.tg_redemption_orders'::regclass", 'i.indisunique', 'i.indisvalid',
        "i.indnatts = 1 AND pg_get_indexdef(i.indexrelid, 1, true) = 'purchase_id'", "pg_get_expr(i.indpred, i.indrelid) = '(purchase_id IS NOT NULL)'"
    ]);
    includes(ready, ['public.fn_tg_purchase_payment_reconciliation_ready()', 'AND prosecdef', "NOT has_function_privilege('anon'", "NOT has_function_privilege('authenticated'", "has_function_privilege('service_role'"]);
});

test('only service_role can execute either definer function with a fixed search path', () => {
    for (const fn of [approval, ready]) assert.match(fn, /SECURITY DEFINER SET search_path = public, pg_temp/);
    for (const fn of [signature, 'public.fn_tg_purchase_fulfillment_review_ready()']) {
        includes(sql, [`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated;`, `GRANT EXECUTE ON FUNCTION ${fn} TO service_role;`]);
    }
    assert.doesNotMatch(sql, /GRANT EXECUTE[^;]+TO\s+(?:PUBLIC|anon|authenticated)/i);
});

test('mandatory administrator confirmations and recent authenticated paid evidence are NULL-safe', () => {
    includes(approval, ["coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$'", 'p_actor_id IS NULL', 'p_expected_updated_at IS NULL',
        'p_payment_checked_at IS NULL', "p_payment_checked_at < clock_timestamp() - interval '120 seconds'",
        "p_payment_checked_at > clock_timestamp() + interval '5 seconds'", 'p_review_note IS NULL', 'char_length(btrim(p_review_note)) NOT BETWEEN 6 AND 500',
        'p_confirm_no_refund IS DISTINCT FROM true', 'p_confirm_no_delivery IS DISTINCT FROM true', "jsonb_typeof(p_verified_payment) IS DISTINCT FROM 'object'",
        "p_verified_payment->>'verified_by' IS DISTINCT FROM 'authenticated_query'", "p_verified_payment->>'event_status' IS DISTINCT FROM 'paid'"]);
    assert.ok(position(approval, "'code', 'invalid_review'") < position(approval, 'pg_advisory_xact_lock'));
});

test('all receipt bindings and trade reuse are rechecked under the same lock order as settlement', () => {
    const trade = position(approval, "pg_advisory_xact_lock(hashtextextended('tg-payment-trade:' || v_trade_no, 0))");
    const purchase = position(approval, 'WHERE order_no = p_order_no FOR UPDATE');
    const receipt = position(approval, "p_verified_payment->>'provider_order_no' IS DISTINCT FROM v_order.order_no");
    const fulfillment = position(approval, 'WHERE purchase_id = v_order.id FOR UPDATE');
    const mutation = position(approval, 'UPDATE public.tg_purchase_orders SET');
    assert.ok(trade < purchase && purchase < receipt && receipt < fulfillment && fulfillment < mutation);
    includes(approval, ["p_verified_payment->>'merchant_id' IS DISTINCT FROM v_order.payment_merchant_id", 'v_trade_no IS DISTINCT FROM v_order.provider_trade_no',
        "p_verified_payment->>'checkout_trade_no' IS DISTINCT FROM v_order.provider_trade_no", "p_verified_payment->>'payment_channel' IS DISTINCT FROM v_order.payment_channel",
        "p_verified_payment->>'amount_minor' IS DISTINCT FROM v_order.total_minor::TEXT", "p_verified_payment->>'currency' IS DISTINCT FROM v_order.currency",
        "v_order.currency IS DISTINCT FROM 'CNY'", 'other.id <> v_order.id', 'other.payment_provider = v_order.payment_provider',
        'other.payment_merchant_id = v_order.payment_merchant_id', 'other.provider_trade_no = v_trade_no']);
    includes(settlement, ["pg_advisory_xact_lock(hashtextextended('tg-payment-trade:' || p_provider_trade_no, 0))", 'WHERE order_no = p_order_no FOR UPDATE']);
});

test('first approval requires recorded payment, no cancellation, the exact review version and the expiry review reason', () => {
    const mutation = position(approval, 'UPDATE public.tg_purchase_orders SET');
    const beforeMutation = approval.slice(0, mutation);
    includes(beforeMutation, ["v_order.payment_provider IS DISTINCT FROM 'zpay'", "v_order.payment_channel NOT IN ('alipay', 'wxpay')", 'v_order.cancelled_at IS NOT NULL',
        'v_order.paid_at IS NULL', 'v_order.checkout_started_at IS NULL', 'v_order.provider_trade_no IS NULL', 'v_order.provider_trade_no = v_order.order_no',
        'v_order.updated_at IS DISTINCT FROM p_expected_updated_at', "'code', 'review_stale'", "v_order.payment_status IS DISTINCT FROM 'manual_review'",
        "v_order.last_error_code IS DISTINCT FROM 'payment_received_after_expiry'"]);
    assert.equal((approval.match(/UPDATE public\.tg_purchase_orders SET/g) || []).length, 1);
});

test('an existing task returns idempotently only when its original approval and all immutable bindings match', () => {
    const branch = approval.slice(position(approval, 'IF v_fulfillment.id IS NOT NULL THEN'), position(approval, 'IF v_order.updated_at IS DISTINCT FROM'));
    includes(branch, ["v_order.payment_status = 'paid'", "v_fulfillment.order_source = 'purchase'", 'v_fulfillment.code_id IS NULL',
        'v_fulfillment.telegram_username IS NOT DISTINCT FROM v_order.telegram_username', 'v_fulfillment.product_family IS NOT DISTINCT FROM v_order.product_family',
        'v_fulfillment.term_months IS NOT DISTINCT FROM v_order.term_months', 'v_fulfillment.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity',
        'v_fulfillment.status_token_hash IS NOT DISTINCT FROM v_order.status_token_hash', 'v_fulfillment.idempotency_key_hash =', 'v_fulfillment.provider_idempotency_key =',
        "a.target_type = 'purchase_order' AND a.target_id = v_order.id", "a.event_type = 'purchase_fulfillment_approved'", "a.metadata->>'fulfillment_id' = v_fulfillment.id::TEXT",
        "'existing', true", "'code', 'fulfillment_exists'"]);
    assert.doesNotMatch(branch, /\b(?:UPDATE|INSERT INTO|DELETE FROM)\b/i);
    assert.doesNotMatch(approval, /UPDATE public\.tg_redemption_orders|DELETE FROM|ON CONFLICT|EXCEPTION\s+WHEN/i);
});

test('approval creates the exact normal worker task namespace and never changes original prices, receipts or trade identity', () => {
    const taskInsert = (source) => source.slice(position(source, 'INSERT INTO public.tg_redemption_orders('), position(source, 'RETURNING * INTO v_fulfillment;') + 'RETURNING * INTO v_fulfillment;'.length);
    assert.equal(taskInsert(approval), taskInsert(definition(settlement, 'fn_tg_confirm_purchase_payment')));
    const update = approval.slice(position(approval, 'UPDATE public.tg_purchase_orders SET'), position(approval, 'INSERT INTO public.tg_redemption_orders('));
    includes(update, ["payment_status = 'paid'", 'last_error_code = NULL', 'checkout_lease_token = NULL', 'checkout_lease_expires_at = NULL']);
    assert.doesNotMatch(update, /\b(?:paid_at|verified_payment|provider_trade_no|status_token_hash|total_minor|subtotal_minor|payment_fee_minor|payment_fee_rate_bps|currency|telegram_username|product_family|term_months|stars_quantity)\s*=/i);
});

test('audit actor, note, confirmations and task link commit with payment and fulfillment without storing private query data', () => {
    const audit = approval.slice(position(approval, 'INSERT INTO public.tg_audit_events('));
    includes(audit, ['actor_user_id, event_type, target_type, target_id, metadata', "VALUES (p_actor_id, 'purchase_fulfillment_approved', 'purchase_order', v_order.id",
        "'note', btrim(p_review_note)", "'previous_reason', v_previous_reason", "'payment_checked_at', p_payment_checked_at", "'verified_by', 'authenticated_query'",
        "'total_minor', v_order.total_minor", "'currency', v_order.currency", "'confirm_no_refund', true", "'confirm_no_delivery', true", "'fulfillment_id', v_fulfillment.id"]);
    assert.doesNotMatch(audit, /status_token|idempotency_key|provider_trade_no|p_verified_payment|merchant_id|checkout_url|EXCEPTION\s+WHEN/i);
    assert.ok(position(audit, "'existing', false") > position(audit, 'v_fulfillment.id'));
});

test('operator verification checks installed safety contracts without invoking approval or mutating order data', () => {
    includes(verification, ['fn_tg_purchase_fulfillment_review_ready()', 'pg_get_functiondef(', 'purchase_fulfillment_approved', 'p_expected_updated_at',
        'authenticated_query', 'payment_received_after_expiry', 'p_confirm_no_refund IS DISTINCT FROM true', 'p_confirm_no_delivery IS DISTINCT FROM true',
        'no order was approved']);
    assert.doesNotMatch(verification, /\b(?:INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE|GRANT |REVOKE )/i);
    assert.doesNotMatch(verification, /(?:SELECT|PERFORM)\s+public\.fn_tg_approve_purchase_fulfillment\s*\(/i);
    assert.match(verification, /SELECT public\.fn_tg_purchase_fulfillment_review_ready\(\) AS tg_purchase_fulfillment_review_ready;/);
});
