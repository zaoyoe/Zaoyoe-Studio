-- Run manually AFTER the reconciled runtime and purchase-review resolution migrations.
-- Additive capability only: this migration does not process any order or refund.
BEGIN;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_resolution_ready()') IS NULL THEN
        RAISE EXCEPTION 'Apply TG purchase review resolution first';
    END IF;
    IF NOT public.fn_tg_purchase_resolution_ready() THEN
        RAISE EXCEPTION 'TG purchase review resolution is not ready';
    END IF;
END;
$$;

-- UUID order IDs are case insensitive. This also fences concurrent worker writes.
-- Existing conflicting ownership aborts installation for an operator to reconcile.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tg_provider_order_casefold
    ON public.tg_redemption_orders(provider, lower(provider_order_id))
    WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tg_purchase_recovery_events (
    operation_id UUID PRIMARY KEY,
    purchase_id UUID NOT NULL REFERENCES public.tg_purchase_orders(id) ON DELETE RESTRICT,
    task_id UUID NOT NULL REFERENCES public.tg_redemption_orders(id) ON DELETE RESTRICT,
    actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('link_upstream_order', 'close_with_nonacceptance')),
    request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    purchase_version_before TIMESTAMPTZ NOT NULL,
    task_version_before TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL,
    submission_fingerprint TEXT NOT NULL CHECK (submission_fingerprint ~ '^[0-9a-f]{64}$'),
    provider_order_id TEXT,
    note TEXT NOT NULL CHECK (char_length(btrim(note)) BETWEEN 6 AND 500 AND note !~ '[[:cntrl:]]'),
    evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
    upstream_check JSONB NOT NULL CHECK (jsonb_typeof(upstream_check) = 'object'),
    result_status TEXT NOT NULL CHECK (result_status IN ('retry_waiting', 'succeeded', 'failed', 'closed')),
    checked_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT tg_purchase_recovery_kind CHECK (
        (action = 'link_upstream_order' AND provider_order_id IS NOT NULL AND result_status <> 'closed')
        OR (action = 'close_with_nonacceptance' AND provider_order_id IS NULL AND result_status = 'closed'
            AND evidence->>'verification' = 'operator_attestation')
    )
);
CREATE INDEX IF NOT EXISTS idx_tg_purchase_recovery_history ON public.tg_purchase_recovery_events(purchase_id, created_at DESC);
ALTER TABLE public.tg_purchase_recovery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tg_purchase_recovery_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.tg_purchase_recovery_events TO service_role;

CREATE OR REPLACE FUNCTION public.tg_recovery_evidence_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'TG recovery evidence is append-only' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION public.tg_recovery_evidence_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tg_recovery_evidence_immutable ON public.tg_purchase_recovery_events;
CREATE TRIGGER trg_tg_recovery_evidence_immutable BEFORE UPDATE OR DELETE ON public.tg_purchase_recovery_events
    FOR EACH ROW EXECUTE FUNCTION public.tg_recovery_evidence_immutable();

CREATE OR REPLACE FUNCTION public.fn_tg_apply_purchase_recovery(
    p_order_no TEXT, p_actor_id UUID, p_action TEXT, p_operation_id UUID, p_request_hash TEXT,
    p_expected_updated_at TIMESTAMPTZ, p_expected_task_updated_at TIMESTAMPTZ,
    p_note TEXT, p_provider_order_id TEXT, p_evidence JSONB, p_checked_at TIMESTAMPTZ, p_check JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.tg_purchase_orders%ROWTYPE;
    v_task public.tg_redemption_orders%ROWTYPE;
    v_existing public.tg_purchase_recovery_events%ROWTYPE;
    v_provider_id TEXT := lower(p_provider_order_id);
    v_result TEXT;
    v_check JSONB;
    v_confirmed_at TIMESTAMPTZ;
BEGIN
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$' OR p_actor_id IS NULL OR p_operation_id IS NULL
       OR p_action IS NULL OR p_action NOT IN ('link_upstream_order', 'close_with_nonacceptance')
       OR coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$'
       OR p_expected_updated_at IS NULL OR p_expected_task_updated_at IS NULL
       OR p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 6 AND 500 OR p_note ~ '[[:cntrl:]]'
       OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR jsonb_typeof(p_check) IS DISTINCT FROM 'object'
       OR p_evidence->'confirm_original_request' IS DISTINCT FROM 'true'::JSONB THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_recovery');
    END IF;
    -- Same lock order as worker claim/finish, payment settlement and review.
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'recovery_not_allowed'); END IF;
    -- Response-loss retries return the committed result without querying upstream again.
    SELECT * INTO v_existing FROM public.tg_purchase_recovery_events WHERE operation_id = p_operation_id;
    IF v_existing.operation_id IS NOT NULL THEN
        IF v_existing.purchase_id IS DISTINCT FROM v_order.id OR v_existing.actor_user_id IS DISTINCT FROM p_actor_id
           OR v_existing.action IS DISTINCT FROM p_action OR v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'recovery_conflict');
        END IF;
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF p_checked_at IS NULL OR p_checked_at < clock_timestamp() - interval '120 seconds' OR p_checked_at > clock_timestamp() + interval '5 seconds' THEN
        RETURN jsonb_build_object('success', false, 'code', 'recovery_stale');
    END IF;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'recovery_stale');
    END IF;
    IF v_order.closed_at IS NOT NULL OR v_order.cancelled_at IS NOT NULL OR v_order.paid_at IS NULL
       OR v_order.payment_status <> 'paid' THEN
        RETURN jsonb_build_object('success', false, 'code', 'recovery_not_allowed');
    END IF;
    SELECT * INTO v_task FROM public.tg_redemption_orders WHERE purchase_id = v_order.id FOR UPDATE;
    IF v_task.id IS NULL OR v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'recovery_stale');
    END IF;
    IF v_task.order_source IS DISTINCT FROM 'purchase' OR v_task.code_id IS NOT NULL OR v_task.provider IS DISTINCT FROM 'gramix'
       OR v_task.telegram_username IS DISTINCT FROM v_order.telegram_username
       OR v_task.product_family IS DISTINCT FROM v_order.product_family
       OR v_task.term_months IS DISTINCT FROM v_order.term_months OR v_task.stars_quantity IS DISTINCT FROM v_order.stars_quantity
       OR v_task.submitted_at IS NULL OR v_task.attempt_count < 1 OR nullif(v_task.provider_idempotency_key, '') IS NULL
       OR v_task.provider_payment_currency IS NULL OR v_task.provider_payment_currency NOT IN ('gram', 'usdt') THEN
        RETURN jsonb_build_object('success', false, 'code', 'recovery_not_allowed');
    END IF;
    IF v_task.status NOT IN ('manual_review', 'failed') OR v_task.lease_token IS NOT NULL OR v_task.lease_expires_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'recovery_active');
    END IF;

    IF p_action = 'link_upstream_order' THEN
        IF coalesce(v_provider_id, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR (v_task.provider_order_id IS NOT NULL AND lower(v_task.provider_order_id) IS DISTINCT FROM v_provider_id)
           OR EXISTS (SELECT 1 FROM public.tg_redemption_orders other WHERE other.provider = 'gramix'
                AND lower(other.provider_order_id) = v_provider_id AND other.id <> v_task.id) THEN
            RETURN jsonb_build_object('success', false, 'code', 'recovery_conflict');
        END IF;
        -- Only an independent official GET with the EXACT original submission key
        -- may identify a lost response. Same username/amount/time is insufficient.
        IF NOT coalesce(
            p_check->>'provider_order_id' = v_provider_id AND p_check->>'verified_by' = 'order_get'
            AND p_check->>'method' = 'api' AND p_check->'idempotency_key_matches' = 'true'::JSONB
            AND p_check->>'telegram_username' = v_task.telegram_username AND p_check->>'product_family' = v_task.product_family
            AND p_check->>'currency' = CASE v_task.provider_payment_currency WHEN 'usdt' THEN 'usd' WHEN 'gram' THEN 'gram' END
            AND jsonb_typeof(p_check->'amount') = 'string' AND p_check->>'amount' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
            AND p_check->>'provider_status' IN ('created', 'processing', 'completed', 'failed', 'canceled')
            AND p_check->'completed' = to_jsonb(p_check->>'provider_status' = 'completed')
            AND ((v_task.product_family = 'telegram_stars' AND v_task.term_months IS NULL
                    AND p_check->>'product_type' = 'stars' AND p_check->'term_months' = 'null'::JSONB
                    AND jsonb_typeof(p_check->'stars_quantity') = 'number' AND p_check->>'stars_quantity' = v_task.stars_quantity::TEXT)
                OR (v_task.product_family = 'telegram_premium' AND v_task.stars_quantity IS NULL
                    AND p_check->>'product_type' = 'premium_' || v_task.term_months::TEXT || '_month'
                    AND p_check->'stars_quantity' = 'null'::JSONB AND jsonb_typeof(p_check->'term_months') = 'number'
                    AND p_check->>'term_months' = v_task.term_months::TEXT)), false) THEN
            RETURN jsonb_build_object('success', false, 'code', 'recovery_provider_mismatch');
        END IF;
        SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::JSONB) INTO v_check FROM jsonb_each(p_check) e
        WHERE e.key IN ('provider_order_id','provider_status','completed','telegram_username','product_family',
            'term_months','stars_quantity','product_type','method','idempotency_key_matches','verified_by','amount','currency');
        v_result := CASE p_check->>'provider_status' WHEN 'completed' THEN 'succeeded' WHEN 'failed' THEN 'failed' WHEN 'canceled' THEN 'failed'
            ELSE 'retry_waiting' END;
        -- Never buy again: provider ID + original submission marker select the poll path.
        -- Preserve original idempotency key, attempts and submission time verbatim.
        UPDATE public.tg_redemption_orders SET provider_order_id = v_provider_id, provider_response = v_check, status = v_result,
            completed_at = CASE WHEN v_result = 'succeeded' THEN clock_timestamp() ELSE completed_at END,
            last_error_code = CASE WHEN v_result = 'succeeded' THEN NULL ELSE last_error_code END,
            last_error_message = CASE WHEN v_result = 'succeeded' THEN NULL ELSE last_error_message END,
            next_attempt_at = CASE WHEN v_result = 'retry_waiting' THEN clock_timestamp() ELSE next_attempt_at END,
            updated_at = clock_timestamp() WHERE id = v_task.id;
        UPDATE public.tg_purchase_orders SET updated_at = clock_timestamp() WHERE id = v_order.id;
    ELSE
        -- A negative search is a contradiction check, never the nonacceptance proof.
        IF v_task.provider_order_id IS NOT NULL OR p_provider_order_id IS NOT NULL
           OR p_check->>'status' IS DISTINCT FROM 'not_found'
           OR p_check#>'{search,exhausted}' IS DISTINCT FROM 'true'::JSONB
           OR p_check#>'{search,missing_correlation}' IS DISTINCT FROM 'false'::JSONB THEN
            RETURN jsonb_build_object('success', false, 'code', 'recovery_negative_unconfirmed');
        END IF;
        IF p_evidence->>'verification' IS DISTINCT FROM 'operator_attestation'
           OR coalesce(p_evidence->>'kind', '') NOT IN ('provider_support', 'provider_rejection')
           OR p_evidence->'confirm_nonacceptance' IS DISTINCT FROM 'true'::JSONB
           OR p_evidence->'confirm_no_delivery' IS DISTINCT FROM 'true'::JSONB
           OR p_evidence->'confirm_payment_handled' IS DISTINCT FROM 'true'::JSONB
           OR coalesce(char_length(btrim(p_evidence->>'reference')), 0) NOT BETWEEN 6 AND 200
           OR coalesce(char_length(btrim(p_evidence->>'summary')), 0) NOT BETWEEN 20 AND 1000
           OR (p_evidence->>'reference') ~ '[[:cntrl:]]' OR (p_evidence->>'summary') ~ '[[:cntrl:]]'
           OR coalesce(p_evidence->>'confirmed_at', '') !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$' THEN
            RETURN jsonb_build_object('success', false, 'code', 'invalid_recovery');
        END IF;
        BEGIN v_confirmed_at := (p_evidence->>'confirmed_at')::TIMESTAMPTZ;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
            RETURN jsonb_build_object('success', false, 'code', 'invalid_recovery');
        END;
        IF v_confirmed_at < v_task.submitted_at OR v_confirmed_at > clock_timestamp() THEN
            RETURN jsonb_build_object('success', false, 'code', 'invalid_recovery');
        END IF;
        v_check := jsonb_build_object('status', 'not_found', 'search', jsonb_build_object('exhausted', true, 'missing_correlation', false));
        v_result := 'closed';
        UPDATE public.tg_redemption_orders SET status = 'cancelled', cancelled_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = v_task.id;
        -- Closure does not change payment_status, paid_at or perform a refund.
        UPDATE public.tg_purchase_orders SET closed_at = clock_timestamp(), closed_by = p_actor_id, close_note = btrim(p_note), updated_at = clock_timestamp() WHERE id = v_order.id;
    END IF;
    INSERT INTO public.tg_purchase_recovery_events(operation_id,purchase_id,task_id,actor_user_id,action,request_hash,
        purchase_version_before,task_version_before,submitted_at,submission_fingerprint,provider_order_id,note,evidence,upstream_check,result_status,checked_at)
    VALUES(p_operation_id,v_order.id,v_task.id,p_actor_id,p_action,p_request_hash,v_order.updated_at,v_task.updated_at,v_task.submitted_at,
        encode(sha256(convert_to(v_task.provider_idempotency_key, 'UTF8')), 'hex'),v_provider_id,btrim(p_note),p_evidence,v_check,v_result,p_checked_at);
    INSERT INTO public.tg_audit_events(actor_user_id,event_type,target_type,target_id,metadata)
    VALUES(p_actor_id,CASE WHEN p_action = 'link_upstream_order' THEN 'purchase_upstream_linked' ELSE 'purchase_nonacceptance_closed' END,
        'purchase_order',v_order.id,jsonb_build_object('action',p_action,'note',btrim(p_note),'operation_id',p_operation_id,
            'provider_order_id',v_provider_id,'result_status',v_result,'evidence_kind',p_evidence->>'kind','evidence_reference',p_evidence->>'reference'));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
EXCEPTION WHEN unique_violation THEN
    -- Roll back all state/evidence/audit changes on concurrent ownership conflict.
    RETURN jsonb_build_object('success', false, 'code', 'recovery_conflict');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_tg_apply_purchase_recovery(TEXT,UUID,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,JSONB,TIMESTAMPTZ,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_apply_purchase_recovery(TEXT,UUID,TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,JSONB,TIMESTAMPTZ,JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_tg_purchase_recovery_ready()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT public.fn_tg_purchase_resolution_ready()
        AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.ux_tg_provider_order_casefold') AND indisunique AND indisvalid)
        AND EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.tg_purchase_recovery_events'::regclass AND relrowsecurity)
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_purchase_recovery_events'::regclass
            AND tgname = 'trg_tg_recovery_evidence_immutable' AND NOT tgisinternal AND tgenabled = 'O')
        AND NOT has_table_privilege('anon', 'public.tg_purchase_recovery_events', 'SELECT,INSERT,UPDATE,DELETE')
        AND NOT has_table_privilege('authenticated', 'public.tg_purchase_recovery_events', 'SELECT,INSERT,UPDATE,DELETE')
        AND NOT has_table_privilege('service_role', 'public.tg_purchase_recovery_events', 'INSERT,UPDATE,DELETE')
        AND has_table_privilege('service_role', 'public.tg_purchase_recovery_events', 'SELECT')
        AND NOT has_function_privilege('anon', 'public.fn_tg_apply_purchase_recovery(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,jsonb,timestamptz,jsonb)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.fn_tg_apply_purchase_recovery(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,jsonb,timestamptz,jsonb)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.fn_tg_apply_purchase_recovery(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,jsonb,timestamptz,jsonb)', 'EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.fn_tg_purchase_recovery_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_recovery_ready() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
