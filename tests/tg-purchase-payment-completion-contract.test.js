'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(require.resolve('../' + path), 'utf8');
const sql = read('supabase/migrations/20261017_tg_purchase_payment_review_completion.sql');
const verify = read('supabase/migrations/20261017_verify_tg_purchase_payment_review_completion.sql');
const runtime = read('supabase/migrations/20261017_tg_runtime_reconciliation.sql');
const rpc = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_complete_purchase_review('), sql.indexOf('REVOKE ALL ON FUNCTION public.fn_tg_complete_purchase_review'));

// Static contracts only. Database application and transaction/concurrency
// acceptance remain operator actions, not evidence supplied by these tests.
test('payment-review completion is an incremental transaction preserving original completion records', () => {
    assert.match(sql, /^BEGIN;/m); assert.match(sql, /^COMMIT;/m);
    assert.match(sql, /IF NOT public\.fn_tg_purchase_completion_ready\(\)/);
    assert.match(sql, /DROP CONSTRAINT tg_purchase_completion_record/);
    assert.match(sql, /ADD CONSTRAINT tg_purchase_completion_record CHECK/);
    assert.match(sql, /completion_outcome IN \('refunded','delivery_confirmed','agreed_settlement','no_valid_payment'\)/);
    const constraint = sql.slice(sql.indexOf('ADD CONSTRAINT'), sql.indexOf('CREATE OR REPLACE FUNCTION'));
    assert.doesNotMatch(constraint, /paid_at|payment_status/);
    const outsideFunctions = sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\n\$\$;/g, '');
    assert.doesNotMatch(outsideFunctions, /^\s*(?:UPDATE|INSERT INTO|DELETE FROM|TRUNCATE|DROP TABLE)\b/mi);
});

test('unverified payment completion serializes with receipt callbacks and requires no delivery task', () => {
    const lock = rpc.indexOf('WHERE order_no = p_order_no FOR UPDATE');
    const taskLock = rpc.indexOf('WHERE purchase_id = v_order.id FOR UPDATE');
    const mutate = rpc.indexOf('UPDATE public.tg_redemption_orders');
    assert.ok(lock > 0 && taskLock > lock && mutate > taskLock);
    for (const guard of ['v_order.updated_at IS DISTINCT FROM p_expected_updated_at', 'v_task.id IS DISTINCT FROM p_expected_task_id',
        'v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at', 'v_order.checkout_lease_token IS NOT NULL OR v_order.checkout_lease_expires_at IS NOT NULL',
        "v_order.paid_at IS NULL AND v_order.payment_status IS DISTINCT FROM 'manual_review'", 'v_order.cancelled_at IS NOT NULL',
        'v_order.paid_at IS NULL AND v_task.id IS NOT NULL', "v_task.status NOT IN ('manual_review','failed')",
        'v_task.lease_token IS NOT NULL OR v_task.lease_expires_at IS NOT NULL']) {
        const index = rpc.indexOf(guard); assert.ok(index > lock && index < mutate, guard);
    }
});

test('payment-dependent outcomes are revalidated under both locks before mutations', () => {
    const guard = rpc.indexOf("v_order.paid_at IS NULL AND p_outcome = 'delivery_confirmed'");
    assert.ok(guard > rpc.indexOf('WHERE purchase_id = v_order.id FOR UPDATE'));
    assert.ok(guard < rpc.indexOf('UPDATE public.tg_redemption_orders'));
    assert.match(rpc, /v_order\.paid_at IS NOT NULL AND p_outcome = 'no_valid_payment'/);
    assert.match(rpc, /'code', 'completion_outcome_mismatch'/);
    for (const confirmation of ['p_confirm_payment_handled', 'p_confirm_stop_fulfillment', 'p_confirm_upstream_risk']) {
        assert.ok(rpc.includes(confirmation + ' IS DISTINCT FROM true'));
    }
});

test('payment-review completion retains payment and upstream facts and audits the actual payment mode', () => {
    const updates = [...rpc.matchAll(/UPDATE public\.\w+ SET[\s\S]*?;/g)].map(match => match[0]).join('\n');
    assert.match(updates, /closed_at = v_closed_at, closed_by = p_actor_id/);
    assert.doesNotMatch(updates, /\b(?:payment_status|paid_at|verified_payment|provider_trade_no|provider_order_id|submitted_at|attempt_count|completed_at|lease_token)\s*=/);
    assert.match(rpc, /'payment_unverified', v_order.paid_at IS NULL/);
    assert.match(rpc, /'purchase_manually_completed'/);
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.tg_purchase_order_json/);
});

test('response-loss retry keeps identical actor/request ownership and rolls back operation collisions', () => {
    assert.match(rpc, /completion_operation_id = p_operation_id AND v_order\.closed_by = p_actor_id[\s\S]*?completion_request_hash = p_request_hash/);
    assert.ok(rpc.indexOf('completion_operation_id = p_operation_id') < rpc.indexOf('v_order.updated_at IS DISTINCT FROM'));
    assert.match(rpc, /EXCEPTION WHEN unique_violation THEN[\s\S]*?'completion_conflict'/);
});

test('incremental readiness requires the installed late-receipt guard and cannot enable automatic delivery after close', () => {
    assert.match(sql, /pg_get_functiondef\(to_regprocedure\('public\.fn_tg_confirm_purchase_payment/);
    assert.match(sql, /'v_order.closed_at IS NOT NULL'/); assert.match(sql, /'payment_received_after_close'/);
    const guard = runtime.slice(runtime.indexOf('IF v_order.cancelled_at IS NOT NULL OR v_order.closed_at IS NOT NULL'), runtime.indexOf("IF v_order.payment_status IN ('manual_review', 'expired')"));
    assert.match(guard, /payment_status = 'manual_review'/); assert.match(guard, /paid_at = now\(\), verified_payment = p_verified_payload/);
    assert.match(guard, /payment_received_after_close/); assert.match(guard, /RETURN jsonb_build_object\('success', true/);
    assert.doesNotMatch(guard, /INSERT INTO public\.tg_redemption_orders/);
});

test('new capability and extended completion stay service-only, with honest read-only verification', () => {
    for (const name of ['fn_tg_complete_purchase_review', 'fn_tg_purchase_payment_review_completion_ready']) {
        assert.match(sql, new RegExp('REVOKE ALL ON FUNCTION public\\.' + name + '[^;]+FROM PUBLIC, anon, authenticated'));
        assert.match(sql, new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + name + '[^;]+TO service_role'));
    }
    assert.match(rpc, /SECURITY DEFINER SET search_path = public, pg_temp/);
    assert.match(verify, /^BEGIN TRANSACTION READ ONLY;/m); assert.match(verify, /^COMMIT;/m);
    assert.match(verify, /concurrent\/business acceptance remains NOT RUN/);
    assert.doesNotMatch(verify, /^\s*(?:UPDATE|INSERT INTO|DELETE FROM|CREATE|ALTER|DROP|TRUNCATE)\b/mi);
});
