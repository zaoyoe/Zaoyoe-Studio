-- Apply AFTER all four original 20261015 TG domain/worker and verification files.
-- Additive protection for databases where those files have already succeeded.
-- No purchase is made by SQL. Do not backfill old orders from current environment.
-- Official Gramix SDK commit 79df455e7d5de1c0e3813dab4fe8e0f5ff426889:
-- PaymentCurrency = gram | usdt; order GET currency = gram | usd (USDT -> usd).
BEGIN;

ALTER TABLE public.tg_redemption_orders
    ADD COLUMN IF NOT EXISTS provider_payment_currency TEXT;

ALTER TABLE public.tg_redemption_orders
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_provider_payment_currency_check,
    ADD CONSTRAINT tg_redemption_orders_provider_payment_currency_check CHECK (
        provider_payment_currency IS NULL OR provider_payment_currency IN ('gram', 'usdt')
    );

COMMENT ON COLUMN public.tg_redemption_orders.provider_payment_currency IS
    'Non-secret provider paymentCurrency committed atomically with submitted_at before purchase. NULL legacy submissions require manual review; never infer from current configuration.';

CREATE OR REPLACE FUNCTION public.fn_tg_claim_order(
    p_order_id UUID DEFAULT NULL,
    p_lease_token UUID DEFAULT NULL,
    p_lease_seconds INTEGER DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code public.tg_redemption_codes%ROWTYPE;
    v_order public.tg_redemption_orders%ROWTYPE;
    v_action TEXT;
    v_manual_reason TEXT;
BEGIN
    IF p_lease_token IS NULL OR p_lease_seconds IS NULL
       OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
        RAISE EXCEPTION 'invalid TG worker lease' USING ERRCODE = '22023';
    END IF;

    -- Always lock code before order, matching public reservation and avoiding
    -- a lock inversion with reservation-expiry reconciliation.
    SELECT c.* INTO v_code
    FROM public.tg_redemption_codes c
    JOIN public.tg_redemption_orders o ON o.code_id = c.id
    WHERE (p_order_id IS NULL OR o.id = p_order_id)
      AND o.status IN ('pending', 'processing', 'retry_waiting')
      AND o.next_attempt_at <= now()
      AND (o.lease_token IS NULL OR o.lease_expires_at <= now())
      AND c.status IN ('reserved', 'fulfilling')
    ORDER BY o.next_attempt_at, o.created_at, o.id
    LIMIT 1
    FOR UPDATE OF c SKIP LOCKED;

    IF v_code.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'no_order');
    END IF;

    SELECT * INTO v_order
    FROM public.tg_redemption_orders o
    WHERE o.code_id = v_code.id
      AND (p_order_id IS NULL OR o.id = p_order_id)
      AND o.status IN ('pending', 'processing', 'retry_waiting')
      AND o.next_attempt_at <= now()
      AND (o.lease_token IS NULL OR o.lease_expires_at <= now())
    ORDER BY o.created_at, o.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_order.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'no_order');
    END IF;

    IF v_order.status = 'pending' AND v_order.provider_order_id IS NULL
       AND v_order.submitted_at IS NULL AND v_order.provider_payment_currency IS NULL
       AND v_order.attempt_count = 0
       AND v_code.status = 'reserved'
       AND NOT EXISTS (
           SELECT 1 FROM public.tg_fulfillment_attempts a WHERE a.order_id = v_order.id
       ) THEN
        v_action := 'buy';
    ELSIF v_order.provider_order_id IS NOT NULL
          AND v_order.provider_payment_currency IN ('gram', 'usdt') THEN
        v_action := 'poll';
    ELSE
        -- Never infer a historical payment currency from today's environment
        -- or from an order GET denomination. Legacy unbound submissions need review.
        v_manual_reason := CASE
            WHEN v_order.provider_payment_currency IS NULL
                 AND (v_order.provider_order_id IS NOT NULL OR v_order.submitted_at IS NOT NULL)
            THEN 'provider_payment_currency_unconfirmed'
            ELSE 'provider_result_unknown' END;
        -- A worker may have died before receiving the create response. Even
        -- an absent submitted marker is not permission to buy after a claim.
        UPDATE public.tg_redemption_orders
        SET status = 'manual_review', lease_token = NULL, lease_expires_at = NULL,
            last_error_code = v_manual_reason,
            last_error_message = '上游结果待核实，已停止自动重试', updated_at = now()
        WHERE id = v_order.id;
        UPDATE public.tg_redemption_codes
        SET status = 'fulfilling', fulfillment_started_at = coalesce(fulfillment_started_at, now()),
            reservation_expires_at = NULL, updated_at = now()
        WHERE id = v_code.id;
        UPDATE public.tg_fulfillment_attempts
        SET status = 'unknown', error_code = 'worker_lease_expired', finished_at = now()
        WHERE order_id = v_order.id AND status IN ('started', 'submitted') AND finished_at IS NULL;
        INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
        VALUES ('fulfillment_manual_review', 'redemption_order', v_order.id,
            jsonb_build_object('reason', CASE
                WHEN v_manual_reason = 'provider_payment_currency_unconfirmed'
                THEN 'missing_historical_payment_currency'
                ELSE 'expired_lease_without_provider_order' END));
        RETURN jsonb_build_object('success', false, 'code', 'manual_review', 'status', 'manual_review');
    END IF;

    UPDATE public.tg_fulfillment_attempts
    SET status = 'unknown', error_code = 'worker_lease_expired', finished_at = now()
    WHERE order_id = v_order.id AND status IN ('started', 'submitted') AND finished_at IS NULL;

    UPDATE public.tg_redemption_orders
    SET status = 'processing', lease_token = p_lease_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
    WHERE id = v_order.id
    RETURNING * INTO v_order;

    UPDATE public.tg_redemption_codes
    SET status = 'fulfilling', fulfillment_started_at = coalesce(fulfillment_started_at, now()),
        reservation_expires_at = NULL, updated_at = now()
    WHERE id = v_code.id;

    INSERT INTO public.tg_fulfillment_attempts (
        order_id, attempt_no, status, provider_order_id, request_payload
    ) VALUES (
        v_order.id, v_order.attempt_count, 'started', v_order.provider_order_id,
        jsonb_build_object('action', v_action, 'term_months', v_order.term_months,
            'payment_currency', v_order.provider_payment_currency)
    );
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('fulfillment_claimed', 'redemption_order', v_order.id,
        jsonb_build_object('action', v_action, 'attempt_no', v_order.attempt_count,
            'payment_currency', v_order.provider_payment_currency));

    RETURN jsonb_build_object(
        'success', true, 'action', v_action,
        'order', jsonb_build_object(
            'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
            'telegram_username', v_order.telegram_username, 'term_months', v_order.term_months,
            'provider_order_id', v_order.provider_order_id,
            'provider_payment_currency', v_order.provider_payment_currency,
            'provider_idempotency_key', v_order.provider_idempotency_key,
            'attempt_count', v_order.attempt_count, 'submitted_at', v_order.submitted_at,
            'lease_token', v_order.lease_token, 'lease_expires_at', v_order.lease_expires_at
        )
    );
END;
$$;

-- Keep the old overload as an explicit fail-closed compatibility gate. An old
-- worker must never cross the purchase boundary without persisting currency.
CREATE OR REPLACE FUNCTION public.fn_tg_mark_submitted(
    p_order_id UUID,
    p_lease_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object('success', false, 'code', 'payment_currency_required');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_mark_submitted(
    p_order_id UUID,
    p_lease_token UUID,
    p_payment_currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_submitted_at TIMESTAMPTZ;
    v_attempt_no INTEGER;
    v_payment_currency TEXT;
BEGIN
    IF p_payment_currency IS NULL OR p_payment_currency NOT IN ('gram', 'usdt') THEN
        RETURN jsonb_build_object('success', false, 'code', 'payment_currency_invalid');
    END IF;
    -- This is deliberately not idempotent: the same worker may not use a
    -- successful old write-ahead marker to authorize a second create call.
    UPDATE public.tg_redemption_orders o
    SET submitted_at = now(), provider_payment_currency = p_payment_currency, updated_at = now()
    WHERE o.id = p_order_id AND o.lease_token = p_lease_token
      AND o.lease_expires_at > now() AND o.status = 'processing'
      AND o.submitted_at IS NULL AND o.provider_order_id IS NULL
      AND o.provider_payment_currency IS NULL
      AND o.attempt_count = 1
    RETURNING o.submitted_at, o.attempt_count, o.provider_payment_currency
    INTO v_submitted_at, v_attempt_no, v_payment_currency;

    IF v_submitted_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'submission_not_authorized');
    END IF;
    UPDATE public.tg_fulfillment_attempts
    SET status = 'submitted',
        request_payload = coalesce(request_payload, '{}'::JSONB)
            || jsonb_build_object('payment_currency', v_payment_currency)
    WHERE order_id = p_order_id AND attempt_no = v_attempt_no AND status = 'started';
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('provider_submission_marked', 'redemption_order', p_order_id,
        jsonb_build_object('payment_currency', v_payment_currency));
    RETURN jsonb_build_object('success', true, 'submitted_at', v_submitted_at,
        'payment_currency', v_payment_currency);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_finish_order(
    p_order_id UUID,
    p_lease_token UUID,
    p_state TEXT,
    p_provider_order_id TEXT DEFAULT NULL,
    p_provider_snapshot JSONB DEFAULT '{}'::JSONB,
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code public.tg_redemption_codes%ROWTYPE;
    v_order public.tg_redemption_orders%ROWTYPE;
    v_code_id UUID;
    v_state TEXT := p_state;
    v_provider_id TEXT := nullif(trim(p_provider_order_id), '');
    v_error_code TEXT := left(p_error_code, 100);
    v_error_message TEXT := left(p_error_message, 500);
    v_snapshot JSONB;
    v_complete BOOLEAN;
BEGIN
    IF p_order_id IS NULL OR p_lease_token IS NULL
       OR p_state IS NULL OR p_state NOT IN ('processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review')
       OR coalesce(jsonb_typeof(p_provider_snapshot), '') <> 'object'
       OR (v_provider_id IS NOT NULL AND char_length(v_provider_id) > 200) THEN
        RAISE EXCEPTION 'invalid TG worker result' USING ERRCODE = '22023';
    END IF;

    SELECT code_id INTO v_code_id FROM public.tg_redemption_orders WHERE id = p_order_id;
    IF v_code_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_found');
    END IF;
    SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_code_id FOR UPDATE;
    SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.lease_token IS DISTINCT FROM p_lease_token OR v_order.status <> 'processing' THEN
        RETURN jsonb_build_object('success', false, 'code', 'lease_lost');
    END IF;

    -- Strip all unknown fields, even if a caller accidentally passes a raw
    -- provider response. Provider credentials and full request bodies stay out.
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::JSONB) INTO v_snapshot
    FROM jsonb_each(p_provider_snapshot) e
    WHERE e.key IN (
        'provider_order_id', 'provider_status', 'completed', 'telegram_username',
        'term_months', 'product_type', 'idempotency_key_matches', 'method',
        'verified_by', 'amount', 'currency'
    );

    IF v_provider_id IS NULL THEN
        v_provider_id := v_order.provider_order_id;
    END IF;
    IF (v_order.provider_order_id IS NOT NULL AND v_provider_id IS DISTINCT FROM v_order.provider_order_id)
       OR (v_provider_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.tg_redemption_orders other
           WHERE other.provider = v_order.provider AND other.provider_order_id = v_provider_id
             AND other.id <> v_order.id
       )) THEN
        v_state := 'manual_review';
        v_provider_id := v_order.provider_order_id;
        v_error_code := 'provider_order_conflict';
        v_error_message := '上游订单归属待核实，已停止自动操作';
    END IF;

    IF v_state IN ('processing', 'retry_waiting') AND v_provider_id IS NULL THEN
        v_state := 'manual_review';
        v_error_code := 'provider_result_unknown';
        v_error_message := '上游结果待核实，已停止自动重试';
    END IF;

    IF v_order.provider_payment_currency IS NULL
       AND (v_order.submitted_at IS NOT NULL OR v_provider_id IS NOT NULL OR v_state = 'succeeded') THEN
        v_state := 'manual_review';
        v_error_code := 'provider_payment_currency_unconfirmed';
        v_error_message := '历史订单扣款币种未确认，等待人工核查';
    END IF;

    IF v_state = 'succeeded' THEN
        -- A create response is never enough. Require the saved provider order
        -- plus an independently queried completed entitlement with exact binding.
        v_complete := v_order.provider_order_id IS NOT NULL
            AND v_order.submitted_at IS NOT NULL
            AND v_order.provider_payment_currency IN ('gram', 'usdt')
            -- Official SDK: USDT paymentCurrency is returned as Order.currency usd.
            AND v_snapshot->>'currency' = CASE v_order.provider_payment_currency
                WHEN 'gram' THEN 'gram' WHEN 'usdt' THEN 'usd' ELSE NULL END
            AND v_provider_id = v_order.provider_order_id
            AND v_snapshot->>'provider_order_id' = v_provider_id
            AND v_snapshot->'completed' = 'true'::JSONB
            AND v_snapshot->>'provider_status' = 'completed'
            AND v_snapshot->>'method' = 'api'
            AND v_snapshot->>'verified_by' = 'order_get'
            AND lower(regexp_replace(coalesce(v_snapshot->>'telegram_username', ''), '^@', '')) = v_order.telegram_username
            AND v_snapshot->>'term_months' = v_order.term_months::TEXT
            AND v_snapshot->>'product_type' = 'premium_' || v_order.term_months::TEXT || '_month'
            AND coalesce(v_snapshot->'idempotency_key_matches', 'true'::JSONB) <> 'false'::JSONB;
        IF NOT coalesce(v_complete, false) THEN
            v_state := 'manual_review';
            v_error_code := 'provider_completion_unconfirmed';
            v_error_message := '上游完成状态或订单归属未确认';
        END IF;
    END IF;

    UPDATE public.tg_redemption_orders
    SET status = v_state, provider_order_id = v_provider_id, provider_response = v_snapshot,
        last_error_code = CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_code END,
        last_error_message = CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_message END,
        next_attempt_at = CASE WHEN v_state IN ('processing', 'retry_waiting')
            THEN greatest(coalesce(p_next_attempt_at, now() + interval '30 seconds'), now() + interval '1 second')
            ELSE next_attempt_at END,
        completed_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE completed_at END,
        lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = v_order.id;

    UPDATE public.tg_fulfillment_attempts
    SET status = CASE WHEN v_state = 'succeeded' THEN 'succeeded'
                      WHEN v_state = 'failed' THEN 'failed'
                      WHEN v_state = 'manual_review' THEN 'unknown'
                      ELSE 'submitted' END,
        provider_order_id = v_provider_id, response_payload = v_snapshot,
        error_code = v_error_code, error_message = v_error_message, finished_at = now(),
        duration_ms = least(2147483647, greatest(0, floor(extract(epoch FROM (now() - started_at)) * 1000)))::INTEGER
    WHERE order_id = v_order.id AND attempt_no = v_order.attempt_count;

    UPDATE public.tg_redemption_codes
    SET status = CASE WHEN v_state = 'succeeded' THEN 'fulfilled'
                      WHEN v_state = 'failed' THEN 'failed' ELSE 'fulfilling' END,
        fulfilled_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE fulfilled_at END,
        redeemed_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE redeemed_at END,
        reservation_expires_at = NULL, updated_at = now()
    WHERE id = v_order.code_id;

    IF v_state = 'succeeded' THEN
        UPDATE public.tg_redemption_batches
        SET redeemed_count = redeemed_count + 1, updated_at = now()
        WHERE id = v_code.batch_id;
    END IF;
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('fulfillment_result', 'redemption_order', v_order.id,
        jsonb_build_object('status', v_state, 'attempt_no', v_order.attempt_count,
            'error_code', CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_code END,
            'payment_currency', v_order.provider_payment_currency));
    RETURN jsonb_build_object('success', true, 'status', v_state);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- Verify the upgrade in the SAME transaction. Any unsafe schema/RPC/ACL state
-- aborts the entire file; successful execution needs no follow-up verification SQL.
DO $$
DECLARE
    v_signature TEXT;
    v_role TEXT;
    v_function OID;
    v_source TEXT;
    v_claim_source TEXT;
    v_finish_source TEXT;
    v_marker_source TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tg_redemption_orders'
          AND column_name = 'provider_payment_currency' AND data_type = 'text'
          AND is_nullable = 'YES' AND column_default IS NULL
    ) THEN
        RAISE EXCEPTION 'TG payment currency column must be nullable text without a default';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.tg_redemption_orders'::regclass
          AND c.conname = 'tg_redemption_orders_provider_payment_currency_check'
          AND c.contype = 'c' AND c.convalidated
          AND position('provider_payment_currency IS NULL' IN pg_get_constraintdef(c.oid)) > 0
          AND position('gram' IN pg_get_constraintdef(c.oid)) > 0
          AND position('usdt' IN pg_get_constraintdef(c.oid)) > 0
    ) THEN
        RAISE EXCEPTION 'TG payment currency constraint is missing or invalid';
    END IF;

    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_claim_order(uuid,uuid,integer)',
        'public.fn_tg_mark_submitted(uuid,uuid)',
        'public.fn_tg_mark_submitted(uuid,uuid,text)',
        'public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'
    ] LOOP
        v_function := to_regprocedure(v_signature);
        IF v_function IS NULL THEN
            RAISE EXCEPTION 'missing TG currency-protected RPC: %', v_signature;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_function_privilege(v_role, v_function, 'EXECUTE') THEN
                RAISE EXCEPTION 'unsafe browser role % can invoke %', v_role, v_signature;
            END IF;
        END LOOP;
        IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
            RAISE EXCEPTION 'service_role cannot invoke %', v_signature;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_proc p,
                LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = v_function AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'PUBLIC can invoke TG currency-protected RPC: %', v_signature;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_proc p WHERE p.oid = v_function AND p.prosecdef
              AND p.proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]
        ) THEN
            RAISE EXCEPTION 'TG RPC must retain SECURITY DEFINER and fixed search_path: %', v_signature;
        END IF;
    END LOOP;

    SELECT pg_get_functiondef('public.fn_tg_mark_submitted(uuid,uuid)'::regprocedure) INTO v_source;
    IF position('payment_currency_required' IN v_source) = 0
       OR position('UPDATE public.' IN v_source) > 0
       OR position('INSERT INTO public.' IN v_source) > 0 THEN
        RAISE EXCEPTION 'old TG submission overload is not fail-closed';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_mark_submitted(uuid,uuid,text)'::regprocedure) INTO v_marker_source;
    IF position('p_payment_currency NOT IN (''gram'', ''usdt'')' IN v_marker_source) = 0
       OR position('SET submitted_at = now(), provider_payment_currency = p_payment_currency' IN v_marker_source) = 0
       OR position('o.lease_token = p_lease_token' IN v_marker_source) = 0
       OR position('o.lease_expires_at > now()' IN v_marker_source) = 0
       OR position('o.provider_payment_currency IS NULL' IN v_marker_source) = 0
       OR position('o.submitted_at IS NULL AND o.provider_order_id IS NULL' IN v_marker_source) = 0
       OR position('o.attempt_count = 1' IN v_marker_source) = 0
       OR position('''payment_currency'', v_payment_currency' IN v_marker_source) = 0 THEN
        RAISE EXCEPTION 'TG submission marker is not atomically currency-bound';
    END IF;

    SELECT pg_get_functiondef('public.fn_tg_claim_order(uuid,uuid,integer)'::regprocedure) INTO v_claim_source;
    IF position('v_order.provider_payment_currency IS NULL' IN v_claim_source) = 0
       OR position('v_order.provider_payment_currency IN (''gram'', ''usdt'')' IN v_claim_source) = 0
       OR position('missing_historical_payment_currency' IN v_claim_source) = 0
       OR position('''provider_payment_currency'', v_order.provider_payment_currency' IN v_claim_source) = 0
       OR position('FOR UPDATE OF c SKIP LOCKED' IN v_claim_source) = 0
       OR position('FOR UPDATE SKIP LOCKED' IN v_claim_source) = 0
       OR position('FOR UPDATE OF c SKIP LOCKED' IN v_claim_source)
          >= position('FOR UPDATE SKIP LOCKED' IN v_claim_source) THEN
        RAISE EXCEPTION 'TG claim RPC lost currency protection or safe locking';
    END IF;

    SELECT pg_get_functiondef('public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'::regprocedure) INTO v_finish_source;
    IF position('provider_payment_currency_unconfirmed' IN v_finish_source) = 0
       OR position('v_order.submitted_at IS NOT NULL' IN v_finish_source) = 0
       OR position('v_order.provider_payment_currency IN (''gram'', ''usdt'')' IN v_finish_source) = 0
       OR position('v_snapshot->>''currency'' = CASE v_order.provider_payment_currency' IN v_finish_source) = 0
       OR position('WHEN ''gram'' THEN ''gram'' WHEN ''usdt'' THEN ''usd'' ELSE NULL END' IN v_finish_source) = 0
       OR position('v_snapshot->>''verified_by'' = ''order_get''' IN v_finish_source) = 0
       OR position('v_order.lease_token IS DISTINCT FROM p_lease_token' IN v_finish_source) = 0
       OR position('SELECT * INTO v_code FROM public.tg_redemption_codes' IN v_finish_source)
          >= position('SELECT * INTO v_order FROM public.tg_redemption_orders' IN v_finish_source) THEN
        RAISE EXCEPTION 'TG finish RPC lost historical currency binding or safe locking';
    END IF;
    RAISE NOTICE 'TG payment currency guard schema, ACL and RPC verification passed';
END;
$$;

COMMIT;

