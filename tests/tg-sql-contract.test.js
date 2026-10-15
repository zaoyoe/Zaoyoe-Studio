'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const domain = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261015_add_tg_premium_redemption_domain.sql'), 'utf8');
const worker = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261015_tg_redemption_worker.sql'), 'utf8');

test('TG SQL keeps browser roles away from bearer-code tables and server RPCs', () => {
    for (const table of ['tg_redemption_batches', 'tg_redemption_codes', 'tg_redemption_orders', 'tg_fulfillment_attempts', 'tg_audit_events']) {
        assert.match(domain, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`));
    }
    for (const signature of [
        'fn_tg_generate_batch', 'fn_tg_revoke_codes', 'fn_tg_reserve_code', 'fn_tg_order_status',
        'fn_tg_claim_order', 'fn_tg_mark_submitted', 'fn_tg_finish_order'
    ]) {
        const source = signature.startsWith('fn_tg_') && ['claim_order', 'mark_submitted', 'finish_order'].includes(signature.slice(6)) ? worker : domain;
        const definition = source.slice(source.indexOf(`FUNCTION public.${signature}`));
        assert.match(definition, /SECURITY DEFINER/);
        assert.match(definition, /REVOKE ALL ON FUNCTION public\./);
        assert.match(definition, /GRANT EXECUTE ON FUNCTION public\.[\s\S]*TO service_role/);
    }
});

test('TG SQL requires a durable marker before provider submission and manual review for unknown results', () => {
    assert.match(worker, /submitted_at TIMESTAMPTZ/);
    assert.match(worker, /fn_tg_mark_submitted/);
    assert.match(worker, /provider_result_unknown/);
    assert.match(worker, /expired_lease_without_provider_order/);
    assert.match(worker, /lease_lost/);
    assert.match(worker, /v_state := 'manual_review'/);
});

test('TG completion SQL binds provider order, recipient, product, duration, method and order-get verification', () => {
    for (const clause of [
        "v_snapshot->>'provider_order_id' = v_provider_id",
        "v_snapshot->'completed' = 'true'::JSONB",
        "v_snapshot->>'provider_status' = 'completed'",
        "v_snapshot->>'method' = 'api'",
        "v_snapshot->>'verified_by' = 'order_get'",
        "v_snapshot->>'term_months' = v_order.term_months::TEXT",
        "v_snapshot->>'product_type' = 'premium_' || v_order.term_months::TEXT || '_month'"
    ]) assert.match(worker, new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('TG domain only permits supported premium terms and keeps failed/manual codes unavailable', () => {
    assert.match(domain, /CHECK \(term_months IN \(3, 6, 12\)\)/);
    assert.match(domain, /status IN \('available', 'reserved', 'fulfilling', 'fulfilled', 'failed', 'revoked', 'expired'\)/);
    assert.match(domain, /WHERE id = p_code_id AND status IN \('available', 'failed'\)/);
    assert.match(domain, /status IN \('pending', 'processing', 'retry_waiting', 'manual_review'\)/);
});

test('TG concurrent redemption rechecks an existing key after acquiring the code lock', () => {
    const reserve = domain.slice(domain.indexOf('FUNCTION public.fn_tg_reserve_code('), domain.indexOf('FUNCTION public.fn_tg_order_status('));
    const lockIndex = reserve.indexOf('WHERE code_digest = v_code_digest\n    FOR UPDATE;');
    const unavailableIndex = reserve.indexOf("IF v_code.status <> 'available' THEN");
    assert.ok(lockIndex >= 0 && unavailableIndex > lockIndex);
    const lockedChecks = reserve.slice(lockIndex, unavailableIndex);
    assert.match(lockedChecks, /WHERE idempotency_key_hash = v_idempotency_key_hash/);
    assert.match(lockedChecks, /v_order\.code_id <> v_code\.id/);
    assert.match(lockedChecks, /v_order\.telegram_username <> v_username/);
    assert.match(lockedChecks, /v_order\.status_token_hash <> v_status_token_hash/);
    assert.match(lockedChecks, /'success', true, 'existing', true, 'order_no', v_order\.order_no/);
});
