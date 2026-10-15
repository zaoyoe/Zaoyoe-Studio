-- Apply after 20261015_add_tg_premium_redemption_domain.sql.
-- Service-only fulfillment leases. No provider purchase is made by SQL.
-- A claimed or ambiguously submitted entitlement is never made available again.

ALTER TABLE public.tg_redemption_orders
    ADD COLUMN IF NOT EXISTS lease_token UUID,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE public.tg_redemption_orders
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_lease_check,
    ADD CONSTRAINT tg_redemption_orders_lease_check CHECK (
        (lease_token IS NULL AND lease_expires_at IS NULL)
        OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_tg_redemption_orders_lease
    ON public.tg_redemption_orders(status, lease_expires_at)
    WHERE lease_token IS NOT NULL;

COMMENT ON COLUMN public.tg_redemption_orders.submitted_at IS
    'Durable write-ahead marker committed before the first provider purchase request. Never clear to retry a purchase.';
COMMENT ON COLUMN public.tg_redemption_orders.lease_token IS
    'Worker compare-and-swap token; an expired lease never authorizes a second purchase.';

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
       AND v_order.submitted_at IS NULL AND v_order.attempt_count = 0
       AND v_code.status = 'reserved'
       AND NOT EXISTS (
           SELECT 1 FROM public.tg_fulfillment_attempts a WHERE a.order_id = v_order.id
       ) THEN
        v_action := 'buy';
    ELSIF v_order.provider_order_id IS NOT NULL THEN
        v_action := 'poll';
    ELSE
        -- A worker may have died before receiving the create response. Even
        -- an absent submitted marker is not permission to buy after a claim.
        UPDATE public.tg_redemption_orders
        SET status = 'manual_review', lease_token = NULL, lease_expires_at = NULL,
            last_error_code = 'provider_result_unknown',
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
            jsonb_build_object('reason', 'expired_lease_without_provider_order'));
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
        jsonb_build_object('action', v_action, 'term_months', v_order.term_months)
    );
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('fulfillment_claimed', 'redemption_order', v_order.id,
        jsonb_build_object('action', v_action, 'attempt_no', v_order.attempt_count));

    RETURN jsonb_build_object(
        'success', true, 'action', v_action,
        'order', jsonb_build_object(
            'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
            'telegram_username', v_order.telegram_username, 'term_months', v_order.term_months,
            'provider_order_id', v_order.provider_order_id,
            'provider_idempotency_key', v_order.provider_idempotency_key,
            'attempt_count', v_order.attempt_count, 'submitted_at', v_order.submitted_at,
            'lease_token', v_order.lease_token, 'lease_expires_at', v_order.lease_expires_at
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_mark_submitted(
    p_order_id UUID,
    p_lease_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_submitted_at TIMESTAMPTZ;
    v_attempt_no INTEGER;
BEGIN
    -- This is deliberately not idempotent: the same worker may not use a
    -- successful old write-ahead marker to authorize a second create call.
    UPDATE public.tg_redemption_orders o
    SET submitted_at = now(), updated_at = now()
    WHERE o.id = p_order_id AND o.lease_token = p_lease_token
      AND o.lease_expires_at > now() AND o.status = 'processing'
      AND o.submitted_at IS NULL AND o.provider_order_id IS NULL
      AND o.attempt_count = 1
    RETURNING o.submitted_at, o.attempt_count INTO v_submitted_at, v_attempt_no;

    IF v_submitted_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'submission_not_authorized');
    END IF;
    UPDATE public.tg_fulfillment_attempts
    SET status = 'submitted'
    WHERE order_id = p_order_id AND attempt_no = v_attempt_no AND status = 'started';
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('provider_submission_marked', 'redemption_order', p_order_id, '{}'::JSONB);
    RETURN jsonb_build_object('success', true, 'submitted_at', v_submitted_at);
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

    IF v_state = 'succeeded' THEN
        -- A create response is never enough. Require the saved provider order
        -- plus an independently queried completed entitlement with exact binding.
        v_complete := v_order.provider_order_id IS NOT NULL
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
            'error_code', CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_code END));
    RETURN jsonb_build_object('success', true, 'status', v_state);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
