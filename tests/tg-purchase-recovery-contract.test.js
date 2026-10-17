'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(require.resolve('../' + path), 'utf8');
const sql = read('supabase/migrations/20261017_tg_purchase_upstream_recovery.sql');
const verify = read('supabase/migrations/20261017_verify_tg_purchase_upstream_recovery.sql');
const service = read('server/tg/purchase-recovery.js');
const ui = read('js/tg-admin.js');

test('recovery migration is additive and requires ready resolution schema before creating capabilities', () => {
    assert.match(sql, /^BEGIN;/m); assert.match(sql, /fn_tg_purchase_resolution_ready/); assert.match(sql, /^COMMIT;/m);
    assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE public\.tg_purchase_orders/i);
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_apply_purchase_recovery('), sql.indexOf('REVOKE ALL ON FUNCTION public.fn_tg_apply_purchase_recovery'));
    for (const match of sql.matchAll(/\b(?:UPDATE public\.|INSERT INTO public\.)/g)) assert.ok(sql.indexOf(match[0], match.index) >= sql.indexOf(body));
});
test('atomic recovery locks purchase then task and checks both versions plus original immutable entitlement', () => {
    const purchaseLock = sql.indexOf('SELECT * INTO v_order FROM public.tg_purchase_orders');
    const taskLock = sql.indexOf('SELECT * INTO v_task FROM public.tg_redemption_orders'); assert.ok(purchaseLock > 0 && taskLock > purchaseLock);
    assert.match(sql, /WHERE order_no = p_order_no FOR UPDATE/); assert.match(sql, /WHERE purchase_id = v_order.id FOR UPDATE/);
    for (const fragment of ['v_order.updated_at IS DISTINCT FROM p_expected_updated_at', 'v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at',
        'v_task.lease_token IS NOT NULL OR v_task.lease_expires_at IS NOT NULL', "v_order.payment_status <> 'paid'", 'v_order.closed_at IS NOT NULL',
        'v_task.code_id IS NOT NULL', 'v_task.telegram_username IS DISTINCT FROM v_order.telegram_username', 'v_task.stars_quantity IS DISTINCT FROM v_order.stars_quantity',
        'v_task.term_months IS DISTINCT FROM v_order.term_months', 'v_task.submitted_at IS NULL', 'v_task.attempt_count < 1']) assert.ok(sql.includes(fragment), fragment);
});
test('link proof requires order GET, strict original key, exact identity, currency, product and provider status', () => {
    for (const fragment of ["p_check->>'verified_by' = 'order_get'", "p_check->>'method' = 'api'", "p_check->'idempotency_key_matches' = 'true'::JSONB",
        "p_check->>'provider_order_id' = v_provider_id", "p_check->>'telegram_username' = v_task.telegram_username", "p_check->>'currency' = CASE v_task.provider_payment_currency",
        "p_check->>'product_family' = v_task.product_family", "p_check->>'stars_quantity' = v_task.stars_quantity::TEXT", "p_check->>'term_months' = v_task.term_months::TEXT",
        "p_check->'completed' = to_jsonb(p_check->>'provider_status' = 'completed')", "WHEN 'completed' THEN 'succeeded'", "WHEN 'failed' THEN 'failed'", "ELSE 'retry_waiting' END"]) assert.ok(sql.includes(fragment), fragment);
    assert.match(service, /checked\.snapshot\.idempotency_key_matches !== true/);
});
test('provider ownership has a case-folded unique constraint and rollback on concurrent conflict', () => {
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS ux_tg_provider_order_casefold[\s\S]*?\(provider, lower\(provider_order_id\)\)/);
    assert.match(sql, /lower\(other\.provider_order_id\) = v_provider_id/); assert.match(sql, /EXCEPTION WHEN unique_violation THEN[\s\S]*?recovery_conflict/);
});
test('negative lookup cannot replace structured and explicitly attested nonacceptance evidence', () => {
    for (const fragment of ["p_evidence->>'verification' IS DISTINCT FROM 'operator_attestation'", "'provider_support', 'provider_rejection'",
        "p_evidence->'confirm_nonacceptance' IS DISTINCT FROM 'true'::JSONB", "p_evidence->'confirm_no_delivery' IS DISTINCT FROM 'true'::JSONB",
        "p_evidence->'confirm_payment_handled' IS DISTINCT FROM 'true'::JSONB", "p_evidence->'confirm_original_request' IS DISTINCT FROM 'true'::JSONB",
        "p_check->>'status' IS DISTINCT FROM 'not_found'", "p_check#>'{search,exhausted}' IS DISTINCT FROM 'true'::JSONB",
        "p_check#>'{search,missing_correlation}' IS DISTINCT FROM 'false'::JSONB", 'v_confirmed_at < v_task.submitted_at', 'v_confirmed_at > clock_timestamp()',
        "UPDATE public.tg_redemption_orders SET status = 'cancelled'", 'closed_at = clock_timestamp(), closed_by = p_actor_id']) assert.ok(sql.includes(fragment), fragment);
});
test('recovery preserves payment, submission, idempotency and attempt history; cannot buy or reissue', () => {
    const updates = [...sql.matchAll(/UPDATE public\.\w+ SET[\s\S]*?;/g)].map(match => match[0]).join('\n');
    assert.doesNotMatch(updates, /\b(?:payment_status|paid_at|provider_idempotency_key|provider_payment_currency|submitted_at|attempt_count|telegram_username|stars_quantity|term_months)\s*=/);
    assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|INSERT INTO) public\.tg_fulfillment_attempts/);
    assert.doesNotMatch(service, /purchaseStars\(|purchasePremium\(|buyStars\(|buyPremium\(/);
    assert.match(sql, /INSERT INTO public\.tg_purchase_recovery_events/); assert.match(sql, /INSERT INTO public\.tg_audit_events/);
});
test('recovery evidence is private and append-only, with only service SELECT and definer RPC writes', () => {
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /REVOKE ALL ON public\.tg_purchase_recovery_events FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(sql, /GRANT SELECT ON public\.tg_purchase_recovery_events TO service_role/); assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE|ALL) ON public\.tg_purchase_recovery_events/);
    assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.tg_purchase_recovery_events/); assert.match(sql, /RAISE EXCEPTION 'TG recovery evidence is append-only'/);
    assert.match(sql, /SECURITY DEFINER SET search_path = public, pg_temp/); assert.match(sql, /REVOKE ALL ON FUNCTION public\.fn_tg_apply_purchase_recovery[^;]+FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /submission_fingerprint/); assert.doesNotMatch(sql, /jsonb_build_object\('provider_idempotency_key'/);
});
test('response-loss retries require exact request ownership and bypass only after locking purchase', () => {
    const replay = sql.indexOf('SELECT * INTO v_existing'); assert.ok(replay > sql.indexOf('WHERE order_no = p_order_no FOR UPDATE'));
    assert.ok(replay < sql.indexOf('v_order.updated_at IS DISTINCT FROM p_expected_updated_at'));
    for (const fragment of ['v_existing.purchase_id IS DISTINCT FROM v_order.id', 'v_existing.actor_user_id IS DISTINCT FROM p_actor_id', 'v_existing.action IS DISTINCT FROM p_action',
        'v_existing.request_hash IS DISTINCT FROM p_request_hash']) assert.ok(sql.includes(fragment));
    assert.match(sql, /'120 seconds'/); assert.match(service, /if \(!existing\)/); assert.match(ui, /if \(!payload\)/);
});
test('verification is read-only, asserts essential safeguards, and preserves the external acceptance boundary', () => {
    assert.match(verify, /BEGIN TRANSACTION READ ONLY/); assert.match(verify, /fn_tg_purchase_recovery_ready/);
    assert.match(verify, /concurrent\/business acceptance remains NOT RUN/);
    assert.doesNotMatch(verify, /^\s*(UPDATE|INSERT INTO|DELETE FROM|CREATE TABLE|ALTER TABLE)/mi);
    for (const fragment of ['recovery_stale', 'recovery_active', 'operator_attestation', 'idempotency_key_matches', 'request_hash', 'ux_tg_provider_order_casefold']) assert.ok(sql.includes(fragment));
});
