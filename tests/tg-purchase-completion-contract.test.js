'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(require.resolve('../' + path), 'utf8');
const sql = read('supabase/migrations/20261017_tg_purchase_manual_completion.sql');
const verify = read('supabase/migrations/20261017_verify_tg_purchase_manual_completion.sql');
const service = read('server/tg/purchase-completion.js');
const rpc = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_complete_purchase_review('), sql.indexOf('REVOKE ALL ON FUNCTION public.fn_tg_complete_purchase_review'));

test('manual completion is additive, transactionally installed and requires the existing closure safeguards', () => {
    assert.match(sql, /^BEGIN;/m); assert.match(sql, /^COMMIT;/m);
    assert.match(sql, /IF NOT public\.fn_tg_purchase_resolution_ready\(\)/);
    assert.doesNotMatch(sql, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/i);
    assert.match(sql, /CONSTRAINT tg_purchase_completion_record CHECK/);
    assert.match(sql, /closed_at IS NOT NULL AND closed_by IS NOT NULL AND completion_note IS NOT NULL/);
    assert.match(sql, /completion_outcome IN \('refunded','delivery_confirmed','agreed_settlement'\)/);
    assert.match(sql, /char_length\(btrim\(completion_note\)\) BETWEEN 6 AND 500/);
});
test('completion uses purchase then task locks and rejects stale versions, live leases and mismatched entitlements', () => {
    const purchaseLock = rpc.indexOf('WHERE order_no = p_order_no FOR UPDATE');
    const taskLock = rpc.indexOf('WHERE purchase_id = v_order.id FOR UPDATE');
    const mutation = rpc.indexOf('UPDATE public.tg_redemption_orders');
    assert.ok(purchaseLock > 0 && taskLock > purchaseLock && mutation > taskLock);
    for (const guard of ['v_order.updated_at IS DISTINCT FROM p_expected_updated_at', 'v_task.id IS DISTINCT FROM p_expected_task_id',
        'v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at', 'v_order.paid_at IS NULL', "v_order.payment_status NOT IN ('paid','manual_review')",
        'v_order.checkout_lease_token IS NOT NULL OR v_order.checkout_lease_expires_at IS NOT NULL', "v_task.status NOT IN ('manual_review','failed')",
        'v_task.lease_token IS NOT NULL OR v_task.lease_expires_at IS NOT NULL', "v_task.order_source IS DISTINCT FROM 'purchase'", 'v_task.code_id IS NOT NULL',
        'v_task.telegram_username IS DISTINCT FROM v_order.telegram_username', 'v_task.product_family IS DISTINCT FROM v_order.product_family',
        'v_task.term_months IS DISTINCT FROM v_order.term_months', 'v_task.stars_quantity IS DISTINCT FROM v_order.stars_quantity']) {
        assert.ok(rpc.indexOf(guard) > purchaseLock && rpc.indexOf(guard) < mutation, guard);
    }
});
test('a repeated completion needs identical actor and request ownership, with cross-order collision rollback', () => {
    const locked = rpc.indexOf('WHERE order_no = p_order_no FOR UPDATE');
    const replay = rpc.indexOf('v_order.completion_operation_id = p_operation_id');
    assert.ok(replay > locked && replay < rpc.indexOf('v_order.updated_at IS DISTINCT FROM p_expected_updated_at'));
    assert.match(rpc, /v_order.closed_by = p_actor_id[\s\S]*?v_order.completion_request_hash = p_request_hash/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS tg_purchase_completion_operation_unique[\s\S]*?\(completion_operation_id\)/);
    assert.match(rpc, /EXCEPTION WHEN unique_violation THEN[\s\S]*?'completion_conflict'/);
});
test('completion stops local delivery while retaining payment, submission and attempt evidence', () => {
    const updates = [...rpc.matchAll(/UPDATE public\.\w+ SET[\s\S]*?;/g)].map(match => match[0]).join('\n');
    assert.match(updates, /UPDATE public\.tg_redemption_orders SET status = 'cancelled'/);
    assert.match(updates, /closed_at = v_closed_at, closed_by = p_actor_id, close_note = btrim\(p_note\)/);
    assert.doesNotMatch(updates, /\b(?:payment_status|paid_at|provider_order_id|provider_trade_no|provider_idempotency_key|provider_payment_currency|submitted_at|attempt_count|completed_at|telegram_username|stars_quantity|term_months|lease_token)\s*=/);
    assert.doesNotMatch(rpc, /(?:UPDATE|INSERT INTO|DELETE FROM) public\.tg_fulfillment_attempts/);
    assert.doesNotMatch(service, /(?:purchase|buy)(?:Stars|Premium)\(|refund\(/);
});
test('settlement, customer explanation and all three attestations are mandatory and atomically audited', () => {
    for (const guard of ['p_note IS NULL', 'p_completion_note IS NULL', "p_outcome NOT IN ('refunded','delivery_confirmed','agreed_settlement')",
        'p_confirm_payment_handled IS DISTINCT FROM true', 'p_confirm_stop_fulfillment IS DISTINCT FROM true', 'p_confirm_upstream_risk IS DISTINCT FROM true']) assert.ok(rpc.includes(guard), guard);
    assert.match(rpc, /INSERT INTO public\.tg_audit_events[\s\S]*?'purchase_manually_completed'/);
    for (const field of ['completion_note', 'outcome', 'operation_id', 'previous_fulfillment_status', 'upstream_submitted']) assert.ok(rpc.includes("'" + field + "'"));
});
test('public SQL projection exposes only the dedicated explanation and keeps payment fees, USDT and closed-state precedence', () => {
    const projection = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.tg_purchase_order_json'), sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_complete_purchase_review'));
    assert.match(projection, /'completion_note', CASE WHEN p.closed_at IS NOT NULL THEN p.completion_note END/);
    assert.match(projection, /'fulfillment_status', CASE WHEN p.closed_at IS NOT NULL THEN 'closed'/);
    assert.doesNotMatch(projection, /p\.(?:close_note|closed_by|completion_outcome|completion_operation_id|completion_request_hash)\b/);
    for (const field of ['subtotal_minor', 'payment_fee_minor', 'payment_fee_rate_bps', 'crypto_checkout', 'closed_at', 'can_close']) assert.ok(projection.includes("'" + field + "'"), field);
});
test('completion and capability RPCs are service-only with a fixed definer search path', () => {
    for (const name of ['fn_tg_complete_purchase_review', 'fn_tg_purchase_completion_ready']) {
        assert.match(sql, new RegExp('REVOKE ALL ON FUNCTION public\\.' + name + '[^;]+FROM PUBLIC, anon, authenticated'));
        assert.match(sql, new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + name + '[^;]+TO service_role'));
    }
    assert.match(rpc, /SECURITY DEFINER SET search_path = public, pg_temp/);
});
test('verification is read only and cannot upgrade structural evidence into business or concurrency acceptance', () => {
    assert.match(verify, /^BEGIN TRANSACTION READ ONLY;/m); assert.match(verify, /^COMMIT;/m);
    assert.match(verify, /fn_tg_purchase_completion_ready/);
    assert.match(verify, /concurrent\/business acceptance remains NOT RUN/);
    assert.doesNotMatch(verify, /^\s*(?:UPDATE|INSERT INTO|DELETE FROM|CREATE|ALTER|DROP|TRUNCATE)\b/mi);
});
