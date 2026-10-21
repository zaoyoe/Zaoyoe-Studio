'use strict';
// Offline text contracts only. These tests NEVER execute SQL or certify DB races.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONTRACT_HASH } = require('../server/integrations/suppliers/procurement');
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261019_shop_supplier_platform_v2_procurement_dispatch.sql'), 'utf8');
const verify = fs.readFileSync(path.join(root, 'supabase/migrations/20261019_verify_shop_supplier_platform_v2_procurement_dispatch.sql'), 'utf8');
const env = fs.readFileSync(path.join(root, 'server/.env.example'), 'utf8');
const executable = sql.replace(/--[^\n]*/g, '');
function body(name) {
    const a = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); assert.ok(a >= 0, name);
    const b = sql.indexOf('\n$$;', a); assert.ok(b > a, name); return sql.slice(a, b);
}
function ordered(source, markers) {
    let offset = -1;
    for (const marker of markers) { const at = source.indexOf(marker, offset + 1); assert.ok(at > offset, marker); offset = at; }
}
const dispatch = body('fn_shop_supplier_dispatch_v2');
const recovery = dispatch.slice(dispatch.indexOf('-- Recovery uses ONLY'));

test('P2C is default off and provisions neither verified merchants, public handlers nor schedulers', () => {
    assert.match(sql, /dispatch_enabled BOOLEAN NOT NULL DEFAULT false/);
    assert.match(env, /^SHOP_SUPPLIER_DISPATCH_V2_ENABLED=false$/m);
    assert.match(env, /^SHOP_SUPPLIER_RECONCILE_V2_ENABLED=false$/m);
    assert.doesNotMatch(executable, /INSERT INTO public\.shop_supplier_dispatch_verifications/);
    assert.doesNotMatch(executable, /(?:intake_enabled|checkout_enabled|dispatch_enabled|is_enabled)\s*=\s*true/i);
    const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
    assert.doesNotMatch(server, /createProcurementRunner|fn_shop_supplier_dispatch_v2/);
});
test('current runner and SQL freeze the exact same verified contract hash', () => {
    assert.equal(CONTRACT_HASH, '4b6dbbf3491c950baeb4860d85128dcd2493ff4a1d61490a0c02892864fb9cae');
    assert.ok(sql.includes(CONTRACT_HASH)); assert.ok(verify.includes(CONTRACT_HASH));
    for (const marker of ['request_lookup_verified', 'immutable_request_key_verified', 'final_rejection_verified', 'atomic_cny_ceiling_verified',
        'v_proof.provider_id IS DISTINCT FROM v_account.provider_id', 'v_proof.credential_ref IS DISTINCT FROM v_account.credential_ref',
        'v_proof.verified_at > clock_timestamp()', 'v_proof.expires_at <= clock_timestamp()']) assert.ok(dispatch.includes(marker), marker);
});
test('each intent has one persistent attempt and one original account/request with no recreation path', () => {
    assert.match(sql, /intent_id UUID NOT NULL UNIQUE REFERENCES public\.shop_supplier_procurement_intents/);
    assert.match(sql, /UNIQUE \(supplier_account_id, original_request_id\)/);
    assert.match(sql, /UNIQUE \(attempt_id, event_type, token_hash\)/);
    assert.doesNotMatch(dispatch, /DELETE FROM|ON CONFLICT[^;]*DO UPDATE/);
    for (const field of ['intent_id', 'supplier_account_id', 'original_request_id', 'account_snapshot', 'frozen_request', 'contract_hash', 'evidence_hash', 'created_at', 'reconcile_deadline_at']) {
        assert.ok(body('shop_supplier_dispatch_immutable_v2').includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`), field);
    }
});
test('native-first locking and a native row write fence refund races including stale RR snapshots', () => {
    ordered(dispatch, ['FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE',
        'FROM public.shop_supplier_fulfillment_units WHERE id = v_unit.id FOR UPDATE',
        'WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE',
        'FROM public.shop_supplier_procurement_intents WHERE id = p_intent_id FOR UPDATE',
        'FROM public.shop_supplier_dispatch_attempts WHERE intent_id = p_intent_id FOR UPDATE']);
    assert.ok(dispatch.includes('FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE'));
    assert.equal((dispatch.match(/supplier_dispatch_version = supplier_dispatch_version \+ 1/g) || []).length, 2);
    const guard = body('shop_supplier_dispatch_native_guard_v2');
    for (const field of ['refund_status', 'delivery_status', 'price_paid', 'user_id', 'discount_refund_amount', 'payment_status', 'fulfillment_status', 'total_amount', 'paid_at']) {
        assert.ok(guard.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`), field);
    }
    assert.match(guard, /supplier_dispatch_resolution_required/);
    assert.doesNotMatch(guard, /current_setting|set_config|state\s+IN|state\s*=/);
    assert.match(sql, /BEFORE UPDATE ON public\.shop_orders/);
    assert.match(sql, /BEFORE UPDATE ON public\.guest_shop_orders/);
});
test('prepare and begin both require funded native state, held exposure, current source, policy and proof', () => {
    const gates = dispatch.slice(dispatch.indexOf("IF p_action IN ('prepare', 'begin')"), dispatch.indexOf('v_request :='));
    for (const marker of ['NOT COALESCE(v_native_ready, false)', "v_unit.funding_state <> 'funded'", "v_intent.exposure_status <> 'held'",
        'v_intent.reserved_cost_cny IS DISTINCT FROM v_unit.cost_ceiling_cny', 'NOT v_policy.intake_enabled', 'NOT v_policy.checkout_enabled',
        'NOT v_policy.dispatch_enabled', 'NOT v_account.is_enabled', 'NOT v_mapping.is_enabled', 'NOT v_mapping.is_primary',
        'v_mapping.updated_at IS DISTINCT FROM v_unit.mapping_revision', "v_mapping.supplier_variant IS DISTINCT FROM v_unit.source_snapshot->'variant'",
        'v_mapping.sku_id IS DISTINCT FROM v_unit.sku_id', 'v_proof.contract_hash IS DISTINCT FROM p_contract_hash']) assert.ok(gates.includes(marker), marker);
    assert.match(dispatch, /v_order\.delivery_status = 'pending'/);
    assert.match(dispatch, /v_guest\.payment_status = 'confirmed'/);
});
test('only prepared leases can be reclaimed; persisted begin is non-replayable and expiry is query-only', () => {
    assert.match(dispatch, /v_intent\.status NOT IN \('not_submitted', 'prepared'\)/);
    assert.match(dispatch, /v_attempt\.state <> 'prepared'/);
    assert.match(dispatch, /v_attempt\.lease_expires_at <= v_now/);
    assert.match(dispatch, /v_attempt\.reconcile_deadline_at <= v_now/);
    assert.match(dispatch, /state = 'dispatching', lease_kind = 'dispatch',\s+request_started_at = v_now/);
    assert.doesNotMatch(recovery, /state = 'prepared'|state = 'dispatching'|INSERT INTO public\.shop_supplier_dispatch_attempts/);
    assert.match(recovery, /state = 'outcome_unknown', lease_kind = 'none'/);
    assert.match(recovery, /v_attempt\.lease_token IS DISTINCT FROM p_token/);
});
test('query recovery preserves frozen source even when sales/account/proof become disabled or expired', () => {
    assert.doesNotMatch(recovery, /v_policy\.(?:intake_enabled|checkout_enabled|dispatch_enabled)|v_mapping|v_proof|v_account\.is_enabled/);
    assert.match(body('shop_supplier_dispatch_ticket_v2'), /'account', \(p_attempt\)\.account_snapshot/);
    assert.match(body('shop_supplier_dispatch_ticket_v2'), /'request', \(p_attempt\)\.frozen_request/);
    assert.match(recovery, /lease_kind = 'query', lease_token = v_token/);
    assert.match(recovery, /query_count = query_count \+ 1/);
    assert.match(recovery, /LEAST\(3600, 30 \* power\(2, query_count\)::INTEGER\)/);
});
test('query exhaustion/deadline enters review and never releases budget or invents rejection', () => {
    ordered(recovery, ["IF p_action = 'claim_query'", 'v_attempt.query_count >= 12 OR v_attempt.reconcile_deadline_at <= v_now',
        "SET state = 'review'", "SET status = 'review'", 'reconciliation_exhausted']);
    assert.match(recovery, /'not_found', 'outcome_unknown'/);
    assert.doesNotMatch(executable, /SET\s+(?:exposure_status|reserved_cost_cny|actual_cost_cny)|SET[^;]*actual_cost_cny\s*=/i);
    assert.doesNotMatch(executable, /(?:UPDATE|INSERT INTO|DELETE FROM) public\.(?:points_ledger|points_balance|wallet_point_lots|shop_inventory|shop_profit_ledger|guest_shop_refunds)\b/i);
    assert.match(sql, /actual_cost_cny IS NULL AND/);
});
test('record requires exact nonsecret result shape and content-hash replay; conflicting replay fails', () => {
    ordered(recovery, ['p_result IS DISTINCT FROM v_expected', 'v_result_hash := encode(sha256(',
        "event_type = 'result' AND token_hash = v_token_hash", 'v_event.result_hash IS DISTINCT FROM v_result_hash',
        'supplier_dispatch_result_conflict', 'RETURN v_event.response', 'v_attempt.lease_token IS DISTINCT FROM p_token']);
    assert.match(recovery, /'orderNo', p_result->>'orderNo', 'evidenceHash', p_result->>'evidenceHash', 'code', 'accepted'/);
    assert.match(recovery, /'code', 'explicitly_not_accepted'/);
    assert.doesNotMatch(executable, /raw_response|response_body|app_key|card_secret|claim_secret/);
});
test('accepted is only upstream acceptance; supplier order identity cannot collide across two intents', () => {
    assert.match(recovery, /supplier_order_no = p_result->>'orderNo' AND id <> v_intent\.id/);
    assert.match(recovery, /v_state := 'review'/);
    assert.match(recovery, /WHEN 'accepted' THEN 'awaiting_delivery'/);
    assert.doesNotMatch(executable, /SET[^;]*(?:delivery_status|fulfillment_status)\s*=|SET[^;]*refund_status\s*=/i);
});
test('new tables have RLS and read-only service access; helpers cannot be invoked through PostgREST', () => {
    for (const name of ['verifications', 'attempts', 'events']) {
        assert.ok(sql.includes(`ALTER TABLE public.shop_supplier_dispatch_${name} ENABLE ROW LEVEL SECURITY`));
    }
    assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role;\s+GRANT SELECT ON TABLE/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.fn_shop_supplier_dispatch_v2\(TEXT, UUID, TEXT, UUID, JSONB\) TO service_role/);
    assert.match(sql, /shop_supplier_dispatch_native_guard_v2\(\)\s+FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(dispatch, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
});
test('readonly verifier checks privileges, enabled triggers, protocol anchors, data identity and honest evidence boundary', () => {
    assert.match(verify, /SET TRANSACTION READ ONLY/);
    assert.match(verify, /has_any_column_privilege/);
    assert.match(verify, /tgenabled NOT IN \('O', 'A'\)/);
    assert.match(verify, /a\.state IS DISTINCT FROM i\.status/);
    assert.match(verify, /i\.actual_cost_cny IS NOT NULL/);
    assert.match(verify, /WHERE dispatch_enabled/);
    assert.match(verify, /database transaction\/concurrency\/business\/merchant acceptance remains NOT RUN/);
    assert.doesNotMatch(verify.replace(/--[^\n]*/g, ''), /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|CREATE TABLE|CREATE FUNCTION)\b/i);
    assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
});

test('abandoned preparation reaches review at its deadline without inventing an HTTP start', () => {
    const retirement = dispatch.slice(dispatch.indexOf('-- Abandoned preparation'), dispatch.indexOf("IF p_action IN ('prepare', 'begin') THEN"));
    ordered(retirement, ["v_attempt.state = 'prepared'", 'v_attempt.reconcile_deadline_at <= v_now',
        "SET state = 'review', lease_kind = 'none', lease_token = NULL", "SET status = 'review'", 'reconciliation_exhausted']);
    assert.doesNotMatch(retirement, /request_started_at\s*=|exposure_status\s*=|reserved_cost_cny\s*=/);
    assert.match(sql, /state = 'review' AND lease_kind = 'none'/);
});

test('native guards use actual points refund/delivery columns and revalidate frozen funding identity', () => {
    const guard = body('shop_supplier_dispatch_native_guard_v2');
    assert.doesNotMatch(guard, /NEW\.status|OLD\.status/);
    assert.doesNotMatch(dispatch, /v_order\.status/);
    assert.match(dispatch, /v_order\.price_paid = v_unit\.sale_amount/);
    assert.match(dispatch, /v_order\.user_id = v_unit\.buyer_user_id/);
    assert.match(dispatch, /v_guest\.total_amount - COALESCE\(v_guest\.payment_fee_amount, 0\) = v_unit\.sale_amount/);
    for (const column of ['total_price', 'item_count', 'discount_amount', 'discount_code', 'unit_amount', 'quantity', 'currency', 'payment_fee_amount']) {
        assert.ok(guard.includes(`NEW.${column} IS DISTINCT FROM OLD.${column}`), column);
    }
});

test('migration preflight refuses missing P2B or incompatible native columns before installing triggers', () => {
    ordered(sql, ["to_regprocedure('public.fn_purchase_shop_supplier_points_v2(uuid,uuid)')", 'information_schema.columns',
        'Supplier P2C native schema incompatible', 'CREATE TRIGGER tr_shop_supplier_dispatch_native_guard_v2']);
    assert.doesNotMatch(sql.slice(0, sql.indexOf('ALTER TABLE public.shop_supplier_transaction_policies')), /['"]status['"]/);
});
