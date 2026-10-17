'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(require.resolve('../' + path), 'utf8');
const sql = read('supabase/migrations/20261017_tg_redemption_resolution.sql');
const verify = read('supabase/migrations/20261017_verify_tg_redemption_resolution.sql');
const service = read('server/tg/redemption-resolution.js');
const workerSql = read('supabase/migrations/20261015_tg_purchase_domain.sql');
const docs = read('docs/tg-redemption-resolution.md');
const rpc = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_apply_redemption_resolution('), sql.indexOf('-- Both token queries'));
const mutation = rpc.indexOf('UPDATE public.tg_redemption_orders');

function beforeMutation(fragment) {
    const position = rpc.indexOf(fragment);
    assert.ok(position >= 0 && position < mutation, fragment);
}

test('redemption resolution installs transactionally without processing historical orders', () => {
    assert.match(sql, /^BEGIN;/m); assert.match(sql, /^COMMIT;/m);
    assert.ok(sql.indexOf("to_regprocedure('public.fn_tg_finish_order") < sql.indexOf('ALTER TABLE'));
    assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE public\.tg_purchase_orders/i);
    assert.doesNotMatch(sql.slice(0, sql.indexOf(rpc)), /^\s*(?:UPDATE|INSERT INTO)\s+public\./m);
    assert.match(sql, /status = 'closed' AND order_source = 'redemption' AND purchase_id IS NULL AND code_id IS NOT NULL/);
    assert.match(sql, /closed_at IS NOT NULL AND closed_by IS NOT NULL AND completed_at IS NULL/);
});

test('atomic updates share worker lock ordering and reject stale ownership or any residual lease', () => {
    const code = rpc.indexOf('WHERE id = v_source.code_id FOR UPDATE');
    const order = rpc.indexOf('WHERE id = v_source.id FOR UPDATE');
    const batch = rpc.indexOf('WHERE id = v_code.batch_id FOR UPDATE');
    assert.ok(code > 0 && order > code && batch > order && batch < mutation);
    for (const fragment of ['v_order.updated_at IS DISTINCT FROM p_expected_updated_at', 'v_code.updated_at IS DISTINCT FROM p_expected_code_updated_at',
        "v_order.status NOT IN ('manual_review', 'failed')", 'v_order.lease_token IS NOT NULL OR v_order.lease_expires_at IS NOT NULL',
        "v_order.order_source IS DISTINCT FROM 'redemption'", 'v_order.purchase_id IS NOT NULL', 'v_order.code_id IS DISTINCT FROM v_code.id',
        'v_code.fulfilled_at IS NOT NULL OR v_code.redeemed_at IS NOT NULL', 'v_code.telegram_username IS DISTINCT FROM v_order.telegram_username',
        'v_batch.product_family IS DISTINCT FROM v_order.product_family', 'v_batch.term_months IS DISTINCT FROM v_order.term_months',
        'v_batch.stars_quantity IS DISTINCT FROM v_order.stars_quantity', 'other.code_id = v_code.id AND other.id <> v_order.id']) beforeMutation(fragment);
});

test('receipt replay requires identical actor and payload and returns before versions and counters', () => {
    const replay = rpc.indexOf('WHERE operation_id = p_operation_id');
    const stale = rpc.indexOf('v_order.updated_at IS DISTINCT FROM p_expected_updated_at');
    assert.ok(replay > rpc.indexOf('WHERE id = v_source.id FOR UPDATE') && replay < stale);
    for (const field of ['order_id IS DISTINCT FROM v_order.id', 'actor_user_id IS DISTINCT FROM p_actor_id', 'action IS DISTINCT FROM p_action', 'request_hash IS DISTINCT FROM p_request_hash']) {
        assert.ok(rpc.indexOf(field) > replay && rpc.indexOf(field) < stale, field);
    }
    assert.match(sql, /operation_id UUID PRIMARY KEY/);
    assert.match(rpc, /EXCEPTION WHEN unique_violation THEN[\s\S]*?'redemption_resolution_conflict'/);
    assert.match(service, /if \(!existing\) \{[\s\S]*?eligible\(context, value\)/);
});

test('linking proves the original GET request and delegates every terminal or polling state to the worker finalizer', () => {
    for (const fragment of ['v_order.submitted_at IS NULL', 'v_order.attempt_count < 1',
        "p_check->>'verified_by' IS DISTINCT FROM 'order_get'", "p_check->>'method' IS DISTINCT FROM 'api'",
        "p_check->'idempotency_key_matches' IS DISTINCT FROM 'true'::JSONB", "p_check->>'telegram_username' IS DISTINCT FROM v_order.telegram_username",
        "p_check->>'product_family' IS DISTINCT FROM v_order.product_family", "p_check->'term_months' IS DISTINCT FROM",
        "p_check->'stars_quantity' IS DISTINCT FROM", "p_check->>'currency' IS DISTINCT FROM (CASE v_order.provider_payment_currency",
        "p_check->'completed' IS DISTINCT FROM to_jsonb(p_check->>'provider_status' = 'completed')"]) beforeMutation(fragment);
    assert.match(rpc, /public\.fn_tg_finish_order\(v_order\.id, v_lease, v_state, v_provider_id, v_check/);
    assert.match(rpc, /v_result->>'status' IS DISTINCT FROM v_state THEN\s+RAISE EXCEPTION/);
    assert.match(service, /\.getOrder\(id, \{ timeoutMs: 3000 \}\)/);
    assert.match(service, /checked\.snapshot\.idempotency_key_matches !== true/);
    assert.doesNotMatch(service, /\.(?:purchasePremium|purchaseStars|buyPremium|buyStars|refund)\(/);
});

test('casefolded provider ownership conflicts abort the whole transaction instead of reassigning another order', () => {
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS ux_tg_provider_order_casefold[\s\S]*?\(provider, lower\(provider_order_id\)\)/);
    beforeMutation('lower(other.provider_order_id) = v_provider_id AND other.id <> v_order.id');
    assert.match(service, /\.ilike\('provider_order_id', id\)/);
    assert.match(rpc, /EXCEPTION WHEN unique_violation THEN/);
});

test('nonacceptance combines exhaustive correlated lookup with separately attested and dated provider evidence', () => {
    for (const fragment of ["p_check->>'status' IS DISTINCT FROM 'not_found'", "p_check->'search'->'exhausted' IS DISTINCT FROM 'true'::JSONB",
        "p_check->'search'->'missing_correlation' IS DISTINCT FROM 'false'::JSONB", "p_evidence->>'verification' IS DISTINCT FROM 'operator_attestation'",
        "p_evidence->'confirm_nonacceptance' IS DISTINCT FROM 'true'::JSONB", "p_evidence->'confirm_no_delivery' IS DISTINCT FROM 'true'::JSONB",
        'v_confirmed_at < v_order.submitted_at', 'v_confirmed_at > clock_timestamp()', "v_batch.status <> 'active'",
        'v_batch.valid_until <= clock_timestamp()', 'v_code.expires_at <= clock_timestamp()']) assert.ok(rpc.includes(fragment), fragment);
    assert.match(rpc, /p_code_disposition, ''\) NOT IN \('available', 'revoked'\)/);
    assert.match(rpc, /v_order\.provider_order_id IS NOT NULL OR p_provider_order_id IS NOT NULL/);
    assert.match(service, /check\.search\?\.exhausted !== true \|\| check\.search\?\.missing_correlation !== false/);
});

test('manual completion requires a distinct public explanation, actual outcome and risk confirmations', () => {
    for (const fragment of ['p_completion_note IS NULL', "p_evidence->'confirm_stop_fulfillment' IS DISTINCT FROM 'true'::JSONB",
        "p_evidence->'confirm_result_handled' IS DISTINCT FROM 'true'::JSONB", "p_evidence->'confirm_upstream_risk' IS DISTINCT FROM 'true'::JSONB",
        "p_outcome, '') NOT IN ('delivery_confirmed', 'refunded', 'agreed_settlement')", "CASE WHEN p_outcome = 'delivery_confirmed' THEN 'fulfilled' ELSE 'revoked' END"]) assert.ok(rpc.includes(fragment), fragment);
    assert.match(rpc, /status = 'closed', closed_at = v_now, closed_by = p_actor_id/);
    assert.match(rpc, /completion_outcome = p_outcome, completion_note = btrim\(p_completion_note\), code_disposition = v_disposition/);
});

test('code disposition, single redeemed count and dangling attempts are committed with the receipt', () => {
    assert.match(rpc, /UPDATE public\.tg_redemption_codes SET status = v_disposition, reservation_expires_at = NULL/);
    assert.match(rpc, /telegram_username = CASE WHEN v_disposition = 'available' THEN NULL ELSE telegram_username END/);
    assert.match(rpc, /IF v_disposition = 'fulfilled' THEN[\s\S]*?redeemed_count = redeemed_count \+ 1/);
    assert.equal((rpc.match(/redeemed_count = redeemed_count \+ 1/g) || []).length, 1);
    assert.match(rpc, /UPDATE public\.tg_fulfillment_attempts SET status = 'unknown'[\s\S]*?status IN \('started', 'submitted'\) AND finished_at IS NULL/);
    const closureUpdates = rpc.slice(rpc.indexOf("v_state := 'closed';"), rpc.indexOf('INSERT INTO public.tg_redemption_resolution_events'));
    assert.doesNotMatch(closureUpdates, /\b(?:submitted_at|provider_idempotency_key|provider_payment_currency|provider_order_id|attempt_count|completed_at|last_error_code|last_error_message)\s*=/);
    assert.match(rpc, /INSERT INTO public\.tg_redemption_resolution_events/); assert.match(rpc, /INSERT INTO public\.tg_audit_events/);
});

test('closed tasks cannot accept an old worker result, and finalizer failures roll back provisional linking', () => {
    const finish = workerSql.slice(workerSql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_finish_order('));
    assert.match(finish, /v_order\.lease_token IS DISTINCT FROM p_lease_token OR v_order\.status <> 'processing'/);
    assert.match(rpc, /lease_token = NULL, lease_expires_at = NULL/);
    assert.match(rpc, /RAISE EXCEPTION 'TG redemption recovery finalization rejected' USING ERRCODE = '23514'/);
});

test('public projection is credential bound and never contains private processing evidence', () => {
    const projection = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_order_status('), sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_tg_redemption_resolution_ready('));
    assert.match(projection, /o\.status_token_hash = lower\(trim\(p_status_token_hash\)\)/);
    assert.match(projection, /'closed_at', CASE WHEN o\.status = 'closed' THEN o\.closed_at END/);
    assert.match(projection, /'completion_note', CASE WHEN o\.status = 'closed' THEN o\.completion_note END/);
    assert.doesNotMatch(projection, /o\.(?:closed_by|completion_outcome|code_disposition|provider_idempotency_key)|'note'|'evidence'|'request_hash'/);
    assert.match(read('supabase/migrations/20261016_tg_order_email_query.sql'), /public\.fn_tg_order_status\(/);
});

test('receipts are private and append only and resolution functions cannot be called by browser roles', () => {
    assert.match(sql, /ALTER TABLE public\.tg_redemption_resolution_events ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON public\.tg_redemption_resolution_events FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(sql, /GRANT SELECT ON public\.tg_redemption_resolution_events TO service_role/);
    assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.tg_redemption_resolution_events/);
    assert.match(sql, /RAISE EXCEPTION 'TG redemption resolution evidence is append-only'/);
    const revoke = sql.slice(sql.indexOf('REVOKE ALL ON FUNCTION public.tg_redemption_resolution_immutable()'));
    for (const name of ['tg_redemption_resolution_json', 'fn_tg_apply_redemption_resolution', 'fn_tg_order_status', 'fn_tg_redemption_resolution_ready']) {
        assert.ok(revoke.slice(0, revoke.indexOf('FROM PUBLIC, anon, authenticated')).includes('public.' + name), name);
        assert.ok(revoke.slice(revoke.indexOf('GRANT EXECUTE')).includes('public.' + name), name);
    }
    assert.match(rpc, /SECURITY DEFINER SET search_path = public, pg_temp/);
});

test('verification and operator documentation preserve the database and business acceptance boundary', () => {
    assert.match(verify, /^BEGIN TRANSACTION READ ONLY;/m); assert.match(verify, /^COMMIT;/m);
    assert.match(verify, /concurrent\/business acceptance remains NOT RUN/);
    assert.doesNotMatch(verify, /^\s*(?:UPDATE|INSERT INTO|DELETE FROM|CREATE|ALTER|DROP|TRUNCATE)\b/mi);
    for (const value of ['20261017_tg_redemption_resolution.sql', '20261017_verify_tg_redemption_resolution.sql', '数据库迁移应用：NOT RUN',
        '数据库事务、并发与真实业务验收：NOT RUN', '目标真实订单完结：NOT RUN', '生产发布：NOT RUN']) assert.ok(docs.includes(value), value);
});


test('confirmation repair keeps the canonical atomic function and uses schema-independent built-in SHA-256', () => {
    const repair = read('supabase/migrations/20261017_tg_redemption_resolution_confirmation.sql');
    const body = value => value.match(/CREATE OR REPLACE FUNCTION public\.fn_tg_apply_redemption_resolution\([\s\S]*?\n\$\$;/)[0];
    assert.equal(body(repair), body(sql));
    for (const value of [sql, repair]) {
        assert.match(value, /pg_catalog\.encode\(pg_catalog\.sha256\(pg_catalog\.convert_to\(v_order\.provider_idempotency_key, 'UTF8'\)\), 'hex'\)/);
        assert.doesNotMatch(body(value), /\bdigest\s*\(/i);
        assert.match(value, /pg_catalog\.sha256\(pg_catalog\.convert_to\('abc', 'UTF8'\)\)/);
        assert.ok(value.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
    }
});

test('confirmation repair changes only function definitions and requires the existing structural migration', () => {
    const repair = read('supabase/migrations/20261017_tg_redemption_resolution_confirmation.sql');
    assert.match(repair, /^BEGIN;/m); assert.match(repair, /^COMMIT;/m);
    const prerequisite = repair.indexOf('IF NOT public.fn_tg_redemption_resolution_ready()');
    assert.ok(prerequisite > 0 && prerequisite < repair.indexOf('CREATE OR REPLACE FUNCTION'));
    const statementsOutsideFunctions = repair.replace(/CREATE OR REPLACE FUNCTION [\s\S]*?\n\$\$;/g, '');
    assert.doesNotMatch(statementsOutsideFunctions, /\b(?:UPDATE|INSERT INTO|DELETE FROM|TRUNCATE|ALTER TABLE|DROP)\b/i);
    assert.doesNotMatch(statementsOutsideFunctions, /(?:SELECT|PERFORM)\s+public\.fn_tg_apply_redemption_resolution\s*\(/i);
    assert.match(repair, /NOTIFY pgrst, 'reload schema'/);
});

test('confirmation readiness and its verifier enforce service-role access without writing orders', () => {
    const repair = read('supabase/migrations/20261017_tg_redemption_resolution_confirmation.sql');
    const verification = read('supabase/migrations/20261017_verify_tg_redemption_resolution_confirmation.sql');
    for (const value of [sql, repair]) {
        assert.match(value, /fn_tg_redemption_resolution_confirmation_ready\(\)[\s\S]*?SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp/);
        assert.match(value, /strpos\(pg_get_functiondef\([\s\S]*?'pg_catalog\.sha256\(pg_catalog\.convert_to\(v_order\.provider_idempotency_key'/);
        assert.match(value, /REVOKE ALL ON FUNCTION[\s\S]*?fn_tg_redemption_resolution_confirmation_ready\(\)[\s\S]*?FROM PUBLIC, anon, authenticated/);
        assert.match(value, /GRANT EXECUTE ON FUNCTION[\s\S]*?fn_tg_redemption_resolution_confirmation_ready\(\)[\s\S]*?TO service_role/);
    }
    assert.match(verification, /^BEGIN TRANSACTION READ ONLY;/m); assert.match(verification, /^COMMIT;/m);
    assert.match(verification, /has_function_privilege\('anon', 'public\.fn_tg_redemption_resolution_confirmation_ready\(\)', 'EXECUTE'\)/);
    assert.match(verification, /has_function_privilege\('authenticated', 'public\.fn_tg_redemption_resolution_confirmation_ready\(\)', 'EXECUTE'\)/);
    assert.match(verification, /NOT has_function_privilege\('service_role', 'public\.fn_tg_redemption_resolution_confirmation_ready\(\)', 'EXECUTE'\)/);
    assert.match(verification, /concurrent\/business acceptance remains NOT RUN/);
    assert.doesNotMatch(verification, /^\s*(?:UPDATE|INSERT INTO|DELETE FROM|CREATE|ALTER|DROP|TRUNCATE)\b/mi);
});
