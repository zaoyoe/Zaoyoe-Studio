'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const migration = read('supabase/migrations/20261019_shop_supplier_platform_v2_runtime.sql');
const verify = read('supabase/migrations/20261019_verify_shop_supplier_platform_v2_runtime.sql');
const runtimeRpc = migration.split('CREATE OR REPLACE FUNCTION public.fn_shop_supplier_runtime_v2(')[1]
    .split('CREATE OR REPLACE FUNCTION public.shop_supplier_runtime_projection_v2(')[0];

test('finish is fenced to a live start ACK and clears the request marker for retries', () => {
    assert.match(runtimeRpc, /lease_token = NULL,lease_expires_at = NULL,request_started_at = NULL/);

    const sharedLeaseGuard = runtimeRpc.match(/IF p_token IS NULL[\s\S]*?THEN RETURN jsonb_build_object\('applied',false\); END IF;/);
    assert.ok(sharedLeaseGuard, 'start/finish must have a shared lease guard');
    assert.doesNotMatch(sharedLeaseGuard[0], /request_started_at/);

    const startIndex = runtimeRpc.indexOf("IF p_action = 'start' THEN");
    const finishIndex = runtimeRpc.indexOf("IF p_action = 'finish' AND");
    const outcomeIndex = runtimeRpc.indexOf('IF p_outcome IS NULL');
    assert.ok(startIndex >= 0 && finishIndex > startIndex && outcomeIndex > finishIndex,
        'start and finish guards must remain ordered before outcome handling');

    const startGuard = runtimeRpc.slice(startIndex, runtimeRpc.indexOf('UPDATE public.shop_supplier_runtime_jobs SET request_started_at', startIndex));
    assert.match(startGuard, /v_job\.state <> 'running'/);
    assert.match(startGuard, /v_job\.request_started_at IS NOT NULL/);

    const finishGuard = runtimeRpc.slice(finishIndex, outcomeIndex);
    assert.match(finishGuard, /v_job\.state <> 'running'/);
    assert.match(finishGuard, /v_job\.request_started_at IS NULL/);
    assert.match(runtimeRpc.slice(startIndex, finishIndex), /request_started_at = v_now/);
});

test('runtime verification requires both start fencing and request-marker cleanup', () => {
    assert.match(verify, /position\('v_job\.state <> ''running''' IN v_definition\)/);
    assert.match(verify, /position\('v_job\.request_started_at IS NULL' IN v_definition\)/);
    assert.match(verify, /position\('v_job\.request_started_at IS NOT NULL' IN v_definition\)/);
    assert.match(verify, /position\('request_started_at = NULL' IN v_definition\)/);
    assert.match(verify, /position\('IF p_action = ''start'' THEN' IN v_definition\)/);
    assert.match(verify, /position\('IF p_action = ''finish'' AND' IN v_definition\)/);
    assert.match(verify, /position\('IF p_outcome IS NULL' IN v_definition\)/);
    assert.match(verify, /v_finish_pos > v_start_pos AND v_outcome_pos > v_finish_pos/);
    assert.match(verify, /position\('v_account\.lease_intent_id IS DISTINCT FROM p_intent_id' IN v_definition\)/);
    assert.match(verify, /position\('v_job\.lease_expires_at <= v_now' IN v_definition\)/);
    assert.match(verify, /position\('v_account\.lease_expires_at <= v_now' IN v_definition\)/);
});

test('runtime migration stays coordinator-only, private, and default-off', () => {
    assert.match(migration, /IF COALESCE\(auth\.role\(\),''\) <> 'service_role'/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.shop_supplier_runtime_resume_immutable_v2\(\),[\s\S]*public\.fn_shop_supplier_runtime_v2/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_shop_supplier_runtime_v2\([^;]*\) TO service_role;/s);
    assert.match(migration, /No worker schedule installed; concurrency\/business acceptance NOT RUN/);
    assert.match(migration, /P2E private coordination only; no financial writes or merchant evidence/);
    assert.doesNotMatch(runtimeRpc, /\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\.(?:shop_orders|shop_guest_orders|shop_order_funding|shop_supplier_merchant_evidence)\b/i);
});

test('resume receipt remains immutable and is not a substitute for the original business evidence', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.shop_supplier_runtime_resumes/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.shop_supplier_runtime_resume_immutable_v2\(\)/);
    assert.match(migration, /tr_supplier_runtime_resume_immutable_v2/);
    assert.match(runtimeRpc, /INSERT INTO public\.shop_supplier_runtime_resumes\(operation_id,intent_id,actor_id,previous_phase,previous_attempts\)/);
    assert.match(runtimeRpc, /Do not change the original procurement deadline, account circuit,/);
    assert.match(runtimeRpc, /merchant proof, dispatch policy, financial state or request identity/);
});
