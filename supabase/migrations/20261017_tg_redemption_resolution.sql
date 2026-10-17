-- Apply manually after the reconciled TG runtime. Does not process orders or refunds.
-- Separate from purchase completion: this capability only handles standalone code orders.
BEGIN;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamptz)') IS NULL
       OR to_regprocedure('public.fn_tg_review_order(uuid,text,timestamptz,uuid,text,jsonb)') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = 'tg_redemption_orders' AND column_name = 'provider_payment_currency') THEN
        RAISE EXCEPTION 'Apply the reconciled TG runtime before redemption resolution';
    END IF;
END;
$$;

ALTER TABLE public.tg_redemption_orders
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS completion_outcome TEXT,
    ADD COLUMN IF NOT EXISTS completion_note TEXT,
    ADD COLUMN IF NOT EXISTS code_disposition TEXT;
ALTER TABLE public.tg_redemption_orders
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_status_check,
    ADD CONSTRAINT tg_redemption_orders_status_check CHECK (status IN
        ('pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled', 'closed')),
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_resolution_check,
    ADD CONSTRAINT tg_redemption_orders_resolution_check CHECK (
        (status <> 'closed' AND closed_at IS NULL AND closed_by IS NULL AND completion_outcome IS NULL
            AND completion_note IS NULL AND code_disposition IS NULL)
        OR (status = 'closed' AND order_source = 'redemption' AND purchase_id IS NULL AND code_id IS NOT NULL
            AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND completed_at IS NULL
            AND lease_token IS NULL AND lease_expires_at IS NULL
            AND completion_note IS NOT NULL AND char_length(btrim(completion_note)) BETWEEN 6 AND 500
            AND regexp_replace(completion_note, E'\n', '', 'g') !~ '[[:cntrl:]]'
            AND completion_outcome IS NOT NULL AND code_disposition IS NOT NULL
            AND ((completion_outcome = 'delivery_confirmed' AND code_disposition = 'fulfilled')
                OR (completion_outcome IN ('refunded', 'agreed_settlement') AND code_disposition = 'revoked')
                OR (completion_outcome = 'not_accepted' AND code_disposition IN ('available', 'revoked'))))
    );
-- Enforce provider ownership across workers, purchases and standalone redemptions.
-- Conflicting existing ownership aborts installation; never delete evidence to install.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tg_provider_order_casefold
    ON public.tg_redemption_orders(provider, lower(provider_order_id)) WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tg_redemption_resolution_events (
    operation_id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.tg_redemption_orders(id) ON DELETE RESTRICT,
    code_id UUID NOT NULL REFERENCES public.tg_redemption_codes(id) ON DELETE RESTRICT,
    actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('link_upstream_order', 'close_with_nonacceptance', 'complete_review')),
    request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    order_version_before TIMESTAMPTZ NOT NULL,
    code_version_before TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    submission_fingerprint TEXT NOT NULL CHECK (submission_fingerprint ~ '^[0-9a-f]{64}$'),
    provider_order_id TEXT,
    note TEXT NOT NULL CHECK (char_length(btrim(note)) BETWEEN 6 AND 500
        AND regexp_replace(note, E'\n', '', 'g') !~ '[[:cntrl:]]'),
    completion_note TEXT,
    outcome TEXT,
    code_disposition TEXT NOT NULL CHECK (code_disposition IN ('available', 'revoked', 'fulfilled', 'failed', 'fulfilling')),
    evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
    upstream_check JSONB NOT NULL CHECK (jsonb_typeof(upstream_check) = 'object'),
    result_status TEXT NOT NULL CHECK (result_status IN ('retry_waiting', 'succeeded', 'failed', 'closed')),
    checked_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT tg_redemption_resolution_kind CHECK (
        (action = 'link_upstream_order' AND provider_order_id IS NOT NULL AND result_status <> 'closed'
            AND outcome IS NULL AND completion_note IS NULL)
        OR (action IN ('close_with_nonacceptance', 'complete_review') AND result_status = 'closed'
            AND outcome IS NOT NULL AND completion_note IS NOT NULL
            AND char_length(btrim(completion_note)) BETWEEN 6 AND 500
            AND evidence->>'verification' = 'operator_attestation')
    )
);
CREATE INDEX IF NOT EXISTS idx_tg_redemption_resolution_history ON public.tg_redemption_resolution_events(order_id, created_at DESC);
ALTER TABLE public.tg_redemption_resolution_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tg_redemption_resolution_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.tg_redemption_resolution_events TO service_role;
CREATE OR REPLACE FUNCTION public.tg_redemption_resolution_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'TG redemption resolution evidence is append-only' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_tg_redemption_resolution_immutable ON public.tg_redemption_resolution_events;
CREATE TRIGGER trg_tg_redemption_resolution_immutable BEFORE UPDATE OR DELETE ON public.tg_redemption_resolution_events
    FOR EACH ROW EXECUTE FUNCTION public.tg_redemption_resolution_immutable();

CREATE OR REPLACE FUNCTION public.tg_redemption_resolution_json(p_order_id UUID)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object('id', o.id, 'order_no', o.order_no, 'status', o.status, 'updated_at', o.updated_at,
        'closed_at', o.closed_at, 'completion_outcome', o.completion_outcome,
        'completion_note', o.completion_note, 'code_disposition', o.code_disposition)
    FROM public.tg_redemption_orders o WHERE o.id = p_order_id AND o.order_source = 'redemption' AND o.purchase_id IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_apply_redemption_resolution(
    p_order_no TEXT, p_actor_id UUID, p_action TEXT, p_operation_id UUID, p_request_hash TEXT,
    p_expected_updated_at TIMESTAMPTZ, p_expected_code_updated_at TIMESTAMPTZ,
    p_note TEXT, p_completion_note TEXT, p_outcome TEXT, p_code_disposition TEXT, p_provider_order_id TEXT,
    p_evidence JSONB, p_checked_at TIMESTAMPTZ, p_check JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_source public.tg_redemption_orders%ROWTYPE;
    v_order public.tg_redemption_orders%ROWTYPE;
    v_code public.tg_redemption_codes%ROWTYPE;
    v_batch public.tg_redemption_batches%ROWTYPE;
    v_existing public.tg_redemption_resolution_events%ROWTYPE;
    v_provider_id TEXT := lower(p_provider_order_id);
    v_state TEXT; v_disposition TEXT; v_result JSONB; v_check JSONB := '{}'::JSONB;
    v_lease UUID := gen_random_uuid(); v_now TIMESTAMPTZ := clock_timestamp();
    v_confirmed_at TIMESTAMPTZ;
BEGIN
    IF coalesce(p_order_no, '') !~ '^TG-[A-Z0-9]{12,24}$' OR p_actor_id IS NULL OR p_operation_id IS NULL
       OR coalesce(p_action, '') NOT IN ('link_upstream_order', 'close_with_nonacceptance', 'complete_review')
       OR coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$' OR p_expected_updated_at IS NULL OR p_expected_code_updated_at IS NULL
       OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 6 AND 500
       OR regexp_replace(p_note, E'\n', '', 'g') ~ '[[:cntrl:]]'
       OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR jsonb_typeof(p_check) IS DISTINCT FROM 'object'
       OR p_evidence->'confirm_original_request' IS DISTINCT FROM 'true'::JSONB THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_redemption_resolution');
    END IF;
    SELECT * INTO v_source FROM public.tg_redemption_orders WHERE order_no = p_order_no;
    IF v_source.id IS NULL OR v_source.order_source <> 'redemption' OR v_source.purchase_id IS NOT NULL OR v_source.code_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_not_allowed');
    END IF;
    -- Same lock order as reserve/claim/finish/review: code -> order -> batch.
    SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_source.code_id FOR UPDATE;
    SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = v_source.id FOR UPDATE;
    IF v_order.order_source IS DISTINCT FROM 'redemption' OR v_order.purchase_id IS NOT NULL OR v_order.code_id IS DISTINCT FROM v_code.id THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_conflict');
    END IF;
    -- Same operation and payload returns the saved outcome, including after response loss.
    SELECT * INTO v_existing FROM public.tg_redemption_resolution_events WHERE operation_id = p_operation_id;
    IF v_existing.operation_id IS NOT NULL THEN
        IF v_existing.order_id IS DISTINCT FROM v_order.id OR v_existing.actor_user_id IS DISTINCT FROM p_actor_id
           OR v_existing.action IS DISTINCT FROM p_action OR v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_conflict');
        END IF;
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_redemption_resolution_json(v_order.id));
    END IF;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at OR v_code.updated_at IS DISTINCT FROM p_expected_code_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_stale');
    END IF;
    IF v_order.status NOT IN ('manual_review', 'failed') OR v_order.closed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_not_allowed');
    END IF;
    -- Reject expired as well as live leases. A stale lease is not evidence of no in-flight request.
    IF v_order.lease_token IS NOT NULL OR v_order.lease_expires_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_active');
    END IF;
    SELECT * INTO v_batch FROM public.tg_redemption_batches WHERE id = v_code.batch_id FOR UPDATE;
    IF v_code.id IS NULL OR v_code.status NOT IN ('reserved', 'fulfilling', 'failed')
       OR v_code.fulfilled_at IS NOT NULL OR v_code.redeemed_at IS NOT NULL
       OR v_code.telegram_username IS DISTINCT FROM v_order.telegram_username OR v_order.provider <> 'gramix'
       OR v_batch.id IS NULL OR v_batch.product_family IS DISTINCT FROM v_order.product_family
       OR v_batch.term_months IS DISTINCT FROM v_order.term_months OR v_batch.stars_quantity IS DISTINCT FROM v_order.stars_quantity
       OR EXISTS (SELECT 1 FROM public.tg_redemption_orders other WHERE other.code_id = v_code.id AND other.id <> v_order.id
            AND other.status IN ('pending', 'processing', 'retry_waiting', 'manual_review', 'failed', 'succeeded')) THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_conflict');
    END IF;
    IF p_checked_at IS NULL OR p_checked_at < clock_timestamp() - interval '120 seconds' OR p_checked_at > clock_timestamp() + interval '5 seconds' THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_stale');
    END IF;
    IF p_action <> 'complete_review' AND (v_order.submitted_at IS NULL OR v_order.attempt_count < 1
        OR char_length(coalesce(v_order.provider_idempotency_key, '')) < 16 OR v_order.provider_payment_currency IS NULL
        OR v_order.provider_payment_currency NOT IN ('gram', 'usdt')) THEN
        RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_submission_missing');
    END IF;

    IF p_action = 'link_upstream_order' THEN
        IF coalesce(v_provider_id, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR (v_order.provider_order_id IS NOT NULL AND lower(v_order.provider_order_id) <> v_provider_id)
           OR EXISTS (SELECT 1 FROM public.tg_redemption_orders other WHERE other.provider = v_order.provider
                AND lower(other.provider_order_id) = v_provider_id AND other.id <> v_order.id) THEN
            RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_conflict');
        END IF;
        IF p_outcome IS NOT NULL OR p_code_disposition IS NOT NULL OR p_completion_note IS NOT NULL
           OR p_check->>'provider_order_id' IS DISTINCT FROM v_provider_id
           OR p_check->>'verified_by' IS DISTINCT FROM 'order_get' OR p_check->>'method' IS DISTINCT FROM 'api'
           OR p_check->'idempotency_key_matches' IS DISTINCT FROM 'true'::JSONB
           OR p_check->>'telegram_username' IS DISTINCT FROM v_order.telegram_username
           OR p_check->>'product_family' IS DISTINCT FROM v_order.product_family
           OR p_check->'term_months' IS DISTINCT FROM coalesce(to_jsonb(v_order.term_months), 'null'::JSONB)
           OR p_check->'stars_quantity' IS DISTINCT FROM coalesce(to_jsonb(v_order.stars_quantity), 'null'::JSONB)
           OR p_check->>'product_type' IS DISTINCT FROM (CASE WHEN v_order.product_family = 'telegram_stars'
                THEN 'stars' ELSE 'premium_' || v_order.term_months::TEXT || '_month' END)
           OR p_check->>'currency' IS DISTINCT FROM (CASE v_order.provider_payment_currency WHEN 'usdt' THEN 'usd' WHEN 'gram' THEN 'gram' END)
           OR coalesce(p_check->>'amount', '') !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$'
           OR coalesce(p_check->>'provider_status', '') NOT IN ('created', 'processing', 'completed', 'failed', 'canceled')
           OR p_check->'completed' IS DISTINCT FROM to_jsonb(p_check->>'provider_status' = 'completed') THEN
            RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_provider_mismatch');
        END IF;
        SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::JSONB) INTO v_check FROM jsonb_each(p_check) e
        WHERE e.key IN ('provider_order_id', 'provider_status', 'completed', 'telegram_username', 'term_months',
            'product_family', 'stars_quantity', 'product_type', 'idempotency_key_matches', 'method', 'verified_by', 'amount', 'currency');
        v_state := CASE p_check->>'provider_status' WHEN 'completed' THEN 'succeeded'
            WHEN 'failed' THEN 'failed' WHEN 'canceled' THEN 'failed' ELSE 'retry_waiting' END;
        -- Bind the original ID first, then reuse the worker's entitlement finalizer.
        -- The lease and binding changes roll back if the finalizer rejects anything.
        UPDATE public.tg_redemption_orders SET provider_order_id = v_provider_id, status = 'processing',
            lease_token = v_lease, lease_expires_at = now() + interval '120 seconds', updated_at = v_now WHERE id = v_order.id;
        v_result := public.fn_tg_finish_order(v_order.id, v_lease, v_state, v_provider_id, v_check,
            CASE WHEN v_state = 'failed' THEN 'provider_confirmed_failure' END,
            CASE WHEN v_state = 'failed' THEN '上游已确认失败，等待管理员处理兑换结果' END, now() + interval '30 seconds');
        IF v_result->>'success' IS DISTINCT FROM 'true' OR v_result->>'status' IS DISTINCT FROM v_state THEN
            RAISE EXCEPTION 'TG redemption recovery finalization rejected' USING ERRCODE = '23514';
        END IF;
        SELECT status INTO v_disposition FROM public.tg_redemption_codes WHERE id = v_code.id;
    ELSE
        IF p_completion_note IS NULL OR char_length(btrim(p_completion_note)) NOT BETWEEN 6 AND 500
           OR regexp_replace(p_completion_note, E'\n', '', 'g') ~ '[[:cntrl:]]'
           OR p_evidence->'confirm_stop_fulfillment' IS DISTINCT FROM 'true'::JSONB
           OR p_evidence->>'verification' IS DISTINCT FROM 'operator_attestation' THEN
            RETURN jsonb_build_object('success', false, 'code', 'invalid_redemption_resolution');
        END IF;
        IF p_action = 'close_with_nonacceptance' THEN
            IF v_order.provider_order_id IS NOT NULL OR p_provider_order_id IS NOT NULL
               OR p_outcome IS DISTINCT FROM 'not_accepted' OR coalesce(p_code_disposition, '') NOT IN ('available', 'revoked')
               OR p_check->>'status' IS DISTINCT FROM 'not_found'
               OR p_check->'search'->'exhausted' IS DISTINCT FROM 'true'::JSONB
               OR p_check->'search'->'missing_correlation' IS DISTINCT FROM 'false'::JSONB
               OR coalesce(p_evidence->>'kind', '') NOT IN ('provider_support', 'provider_rejection')
               OR coalesce(char_length(btrim(p_evidence->>'reference')), 0) NOT BETWEEN 6 AND 200
               OR coalesce(char_length(btrim(p_evidence->>'summary')), 0) NOT BETWEEN 20 AND 1000
               OR regexp_replace(coalesce(p_evidence->>'reference', '') || coalesce(p_evidence->>'summary', ''), E'\n', '', 'g') ~ '[[:cntrl:]]'
               OR p_evidence->'confirm_nonacceptance' IS DISTINCT FROM 'true'::JSONB
               OR p_evidence->'confirm_no_delivery' IS DISTINCT FROM 'true'::JSONB THEN
                RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_negative_unconfirmed');
            END IF;
            BEGIN
                v_confirmed_at := (p_evidence->>'confirmed_at')::TIMESTAMPTZ;
            EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
                RETURN jsonb_build_object('success', false, 'code', 'invalid_redemption_resolution');
            END;
            IF v_confirmed_at IS NULL OR NOT isfinite(v_confirmed_at) OR v_confirmed_at < v_order.submitted_at OR v_confirmed_at > clock_timestamp() THEN
                RETURN jsonb_build_object('success', false, 'code', 'invalid_redemption_resolution');
            END IF;
            IF p_code_disposition = 'available' AND (v_batch.status <> 'active' OR v_batch.valid_from > clock_timestamp()
                OR v_batch.valid_until <= clock_timestamp() OR v_code.expires_at <= clock_timestamp()) THEN
                RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_code_unavailable');
            END IF;
            v_disposition := p_code_disposition;
            v_check := jsonb_build_object('status', 'not_found', 'search', jsonb_build_object('exhausted', true, 'missing_correlation', false));
        ELSE
            IF coalesce(p_outcome, '') NOT IN ('delivery_confirmed', 'refunded', 'agreed_settlement')
               OR p_provider_order_id IS NOT NULL OR p_check <> '{}'::JSONB
               OR p_evidence->'confirm_result_handled' IS DISTINCT FROM 'true'::JSONB
               OR p_evidence->'confirm_upstream_risk' IS DISTINCT FROM 'true'::JSONB
               OR p_code_disposition IS DISTINCT FROM (CASE WHEN p_outcome = 'delivery_confirmed' THEN 'fulfilled' ELSE 'revoked' END) THEN
                RETURN jsonb_build_object('success', false, 'code', 'invalid_redemption_resolution');
            END IF;
            v_disposition := p_code_disposition;
        END IF;
        v_state := 'closed';
        -- Preserve submission/provider/error evidence. closed_at is distinct from provider completed_at.
        UPDATE public.tg_redemption_orders SET status = 'closed', closed_at = v_now, closed_by = p_actor_id,
            completion_outcome = p_outcome, completion_note = btrim(p_completion_note), code_disposition = v_disposition,
            lease_token = NULL, lease_expires_at = NULL, updated_at = v_now WHERE id = v_order.id;
        UPDATE public.tg_redemption_codes SET status = v_disposition, reservation_expires_at = NULL,
            reserved_at = CASE WHEN v_disposition = 'available' THEN NULL ELSE reserved_at END,
            fulfillment_started_at = CASE WHEN v_disposition = 'available' THEN NULL ELSE fulfillment_started_at END,
            telegram_username = CASE WHEN v_disposition = 'available' THEN NULL ELSE telegram_username END,
            telegram_user_id = CASE WHEN v_disposition = 'available' THEN NULL ELSE telegram_user_id END,
            fulfilled_at = CASE WHEN v_disposition = 'fulfilled' THEN v_now ELSE fulfilled_at END,
            redeemed_at = CASE WHEN v_disposition = 'fulfilled' THEN v_now ELSE redeemed_at END,
            revoked_at = CASE WHEN v_disposition = 'revoked' THEN v_now ELSE revoked_at END,
            revoked_by = CASE WHEN v_disposition = 'revoked' THEN p_actor_id ELSE revoked_by END,
            revoke_reason = CASE WHEN v_disposition = 'revoked' THEN '兑换订单已人工完结：' || v_order.order_no ELSE revoke_reason END,
            updated_at = v_now WHERE id = v_code.id;
        IF v_disposition = 'fulfilled' THEN
            -- The locked code was never redeemed. Operation replay returns before this increment.
            UPDATE public.tg_redemption_batches SET redeemed_count = redeemed_count + 1, updated_at = v_now WHERE id = v_batch.id;
        END IF;
        UPDATE public.tg_fulfillment_attempts SET status = 'unknown', finished_at = coalesce(finished_at, v_now),
            error_code = coalesce(error_code, 'operator_closed'), error_message = coalesce(error_message, '订单已由管理员完结，保留原上游提交记录')
        WHERE order_id = v_order.id AND status IN ('started', 'submitted') AND finished_at IS NULL;
    END IF;
    INSERT INTO public.tg_redemption_resolution_events(operation_id, order_id, code_id, actor_user_id, action, request_hash,
        order_version_before, code_version_before, submitted_at, submission_fingerprint, provider_order_id,
        note, completion_note, outcome, code_disposition, evidence, upstream_check, result_status, checked_at)
    VALUES (p_operation_id, v_order.id, v_code.id, p_actor_id, p_action, p_request_hash, v_order.updated_at, v_code.updated_at,
        v_order.submitted_at, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_order.provider_idempotency_key, 'UTF8')), 'hex'),
        CASE WHEN p_action = 'link_upstream_order' THEN v_provider_id ELSE v_order.provider_order_id END,
        btrim(p_note), CASE WHEN v_state = 'closed' THEN btrim(p_completion_note) END, p_outcome, v_disposition,
        p_evidence, v_check, v_state, p_checked_at);
    INSERT INTO public.tg_audit_events(actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (p_actor_id, 'redemption_resolution', 'redemption_order', v_order.id,
        jsonb_build_object('action', p_action, 'note', btrim(p_note), 'previous_status', v_order.status, 'result_status', v_state));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_redemption_resolution_json(v_order.id));
EXCEPTION WHEN unique_violation THEN
    -- Roll back every state change if a concurrent operation wins ownership or the receipt UUID.
    RETURN jsonb_build_object('success', false, 'code', 'redemption_resolution_conflict');
END;
$$;

-- Both token queries and email/password queries use this safe projection.
CREATE OR REPLACE FUNCTION public.fn_tg_order_status(p_order_no TEXT, p_status_token_hash CHAR(64))
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce((SELECT jsonb_build_object('success', true, 'order_no', o.order_no, 'status', o.status,
        'username', o.telegram_username, 'product_family', o.product_family, 'term_months', o.term_months,
        'stars_quantity', o.stars_quantity, 'created_at', o.created_at, 'updated_at', o.updated_at,
        'closed_at', CASE WHEN o.status = 'closed' THEN o.closed_at END,
        'completion_note', CASE WHEN o.status = 'closed' THEN o.completion_note END)
        FROM public.tg_redemption_orders o WHERE o.order_no = trim(p_order_no)
            AND o.status_token_hash = lower(trim(p_status_token_hash)) LIMIT 1),
        jsonb_build_object('success', false, 'code', 'not_found', 'message', '订单不存在或查询凭证无效'));
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_redemption_resolution_ready()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT to_regclass('public.tg_redemption_resolution_events') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.tg_redemption_resolution_events') AND relrowsecurity)
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_redemption_orders'::regclass
            AND conname = 'tg_redemption_orders_resolution_check' AND convalidated)
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_redemption_orders'::regclass
            AND conname = 'tg_redemption_orders_status_check' AND convalidated AND strpos(pg_get_constraintdef(oid), 'closed') > 0)
        AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.ux_tg_provider_order_casefold') AND indisunique AND indisvalid)
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_redemption_resolution_events'::regclass
            AND tgname = 'trg_tg_redemption_resolution_immutable' AND tgenabled = 'O')
        AND to_regprocedure('public.fn_tg_apply_redemption_resolution(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,text,text,text,jsonb,timestamptz,jsonb)') IS NOT NULL
        AND strpos(pg_get_functiondef('public.fn_tg_order_status(text,character)'::regprocedure), 'completion_note') > 0
        AND NOT has_table_privilege('anon', 'public.tg_redemption_resolution_events', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.tg_redemption_resolution_events', 'SELECT');
$$;
CREATE OR REPLACE FUNCTION public.fn_tg_redemption_resolution_confirmation_ready()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT public.fn_tg_redemption_resolution_ready()
        AND strpos(pg_get_functiondef('public.fn_tg_apply_redemption_resolution(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,text,text,text,jsonb,timestamptz,jsonb)'::regprocedure),
            'pg_catalog.sha256(pg_catalog.convert_to(v_order.provider_idempotency_key') > 0
        AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('abc', 'UTF8')), 'hex')
            = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
$$;
REVOKE ALL ON FUNCTION public.tg_redemption_resolution_immutable(), public.tg_redemption_resolution_json(UUID),
    public.fn_tg_apply_redemption_resolution(TEXT,UUID,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,TIMESTAMPTZ,JSONB),
    public.fn_tg_order_status(TEXT,CHAR), public.fn_tg_redemption_resolution_ready(), public.fn_tg_redemption_resolution_confirmation_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_redemption_resolution_json(UUID),
    public.fn_tg_apply_redemption_resolution(TEXT,UUID,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,TIMESTAMPTZ,JSONB),
    public.fn_tg_order_status(TEXT,CHAR), public.fn_tg_redemption_resolution_ready(), public.fn_tg_redemption_resolution_confirmation_ready() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
