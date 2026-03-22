-- ============================================
-- Harden Payment Creation Entry Points
-- 真实支付创建链路改走用户绑定 RPC，避免默认依赖 service_role 直写 payment tables
-- ============================================

ALTER TABLE IF EXISTS public.payment_orders ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.payment_orders TO authenticated;

DROP POLICY IF EXISTS "Users view own payment orders" ON public.payment_orders;
CREATE POLICY "Users view own payment orders"
    ON public.payment_orders
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins view all payment orders" ON public.payment_orders;
CREATE POLICY "Admins view all payment orders"
    ON public.payment_orders
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP FUNCTION IF EXISTS public.fn_create_payment_checkout_session(JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_create_payment_checkout_session(
    p_payload JSONB DEFAULT '{}'::JSONB,
    p_user_id UUID DEFAULT NULL
)
RETURNS public.payment_checkout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_payload JSONB := COALESCE(p_payload, '{}'::JSONB);
    v_session public.payment_checkout_sessions%ROWTYPE;
    v_session_key TEXT := NULLIF(BTRIM(COALESCE(v_payload->>'session_key', '')), '');
    v_provider TEXT := COALESCE(NULLIF(BTRIM(LOWER(COALESCE(v_payload->>'provider', ''))), ''), 'unknown');
    v_site VARCHAR(10) := COALESCE(NULLIF(BTRIM(LOWER(COALESCE(v_payload->>'site', ''))), ''), 'cn');
    v_package_id UUID := CASE
        WHEN COALESCE(v_payload->>'package_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (v_payload->>'package_id')::UUID
        ELSE NULL
    END;
    v_request_payload JSONB := CASE
        WHEN jsonb_typeof(COALESCE(v_payload->'request_payload', '{}'::JSONB)) = 'object'
            THEN COALESCE(v_payload->'request_payload', '{}'::JSONB)
        ELSE '{}'::JSONB
    END;
    v_provider_metadata JSONB := CASE
        WHEN jsonb_typeof(COALESCE(v_payload->'provider_metadata', '{}'::JSONB)) = 'object'
            THEN COALESCE(v_payload->'provider_metadata', '{}'::JSONB)
        ELSE '{}'::JSONB
    END;
    v_requested_points NUMERIC(12,1) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'requested_points', '')), '')::NUMERIC(12,1), 0);
    v_bonus_points NUMERIC(12,1) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'bonus_points', '')), '')::NUMERIC(12,1), 0);
    v_granted_points NUMERIC(12,1) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'granted_points', '')), '')::NUMERIC(12,1), 0);
    v_expected_amount NUMERIC(10,2) := NULLIF(BTRIM(COALESCE(v_payload->>'expected_amount', '')), '')::NUMERIC(10,2);
    v_expires_at TIMESTAMPTZ := NULLIF(BTRIM(COALESCE(v_payload->>'expires_at', '')), '')::TIMESTAMPTZ;
    v_payload_user_id UUID := CASE
        WHEN COALESCE(v_payload->>'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (v_payload->>'user_id')::UUID
        ELSE NULL
    END;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_payload_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    IF v_session_key IS NULL THEN
        RAISE EXCEPTION 'session_key is required';
    END IF;

    INSERT INTO public.payment_checkout_sessions (
        session_key,
        provider,
        user_id,
        site,
        package_id,
        package_name,
        requested_points,
        bonus_points,
        granted_points,
        expected_amount,
        status,
        request_payload,
        provider_metadata,
        expires_at
    ) VALUES (
        v_session_key,
        v_provider,
        v_effective_user_id,
        v_site,
        v_package_id,
        NULLIF(BTRIM(COALESCE(v_payload->>'package_name', '')), ''),
        v_requested_points,
        v_bonus_points,
        v_granted_points,
        v_expected_amount,
        'created',
        v_request_payload,
        v_provider_metadata,
        v_expires_at
    )
    RETURNING * INTO v_session;

    RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_payment_checkout_session(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_payment_checkout_session(JSONB, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_update_payment_checkout_session(UUID, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_update_payment_checkout_session(
    p_session_id UUID,
    p_patch JSONB DEFAULT '{}'::JSONB,
    p_user_id UUID DEFAULT NULL
)
RETURNS public.payment_checkout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_patch JSONB := COALESCE(p_patch, '{}'::JSONB);
    v_session public.payment_checkout_sessions%ROWTYPE;
    v_next_status VARCHAR(30);
    v_next_checkout_url TEXT;
    v_next_query_mode TEXT;
    v_next_payment_order_id UUID;
    v_next_provider_metadata JSONB;
    v_next_error_message TEXT;
    v_next_completed_at TIMESTAMPTZ;
BEGIN
    IF p_session_id IS NULL THEN
        RAISE EXCEPTION 'session_id is required';
    END IF;

    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    SELECT *
    INTO v_session
    FROM public.payment_checkout_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment checkout session not found';
    END IF;

    IF v_request_role <> 'service_role'
       AND v_session.user_id IS NOT NULL
       AND v_session.user_id <> v_effective_user_id
    THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_next_status := CASE
        WHEN v_patch ? 'status' THEN NULLIF(BTRIM(COALESCE(v_patch->>'status', '')), '')
        ELSE v_session.status
    END;

    IF v_next_status IS NOT NULL
       AND v_next_status NOT IN ('created', 'redirect_ready', 'completed', 'failed', 'expired', 'cancelled')
    THEN
        RAISE EXCEPTION 'invalid checkout session status';
    END IF;

    v_next_checkout_url := CASE
        WHEN v_patch ? 'checkout_url' THEN NULLIF(BTRIM(COALESCE(v_patch->>'checkout_url', '')), '')
        ELSE v_session.checkout_url
    END;

    v_next_query_mode := CASE
        WHEN v_patch ? 'query_mode' THEN NULLIF(BTRIM(COALESCE(v_patch->>'query_mode', '')), '')
        ELSE v_session.query_mode
    END;

    v_next_payment_order_id := CASE
        WHEN v_patch ? 'payment_order_id'
             AND COALESCE(v_patch->>'payment_order_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (v_patch->>'payment_order_id')::UUID
        WHEN v_patch ? 'payment_order_id' THEN NULL
        ELSE v_session.payment_order_id
    END;

    v_next_provider_metadata := CASE
        WHEN v_patch ? 'provider_metadata'
             AND jsonb_typeof(COALESCE(v_patch->'provider_metadata', '{}'::JSONB)) = 'object'
            THEN COALESCE(v_patch->'provider_metadata', '{}'::JSONB)
        WHEN v_patch ? 'provider_metadata' THEN '{}'::JSONB
        ELSE COALESCE(v_session.provider_metadata, '{}'::JSONB)
    END;

    v_next_error_message := CASE
        WHEN v_patch ? 'error_message' THEN NULLIF(BTRIM(COALESCE(v_patch->>'error_message', '')), '')
        ELSE v_session.error_message
    END;

    v_next_completed_at := CASE
        WHEN v_patch ? 'completed_at'
             AND NULLIF(BTRIM(COALESCE(v_patch->>'completed_at', '')), '') IS NOT NULL
            THEN (v_patch->>'completed_at')::TIMESTAMPTZ
        WHEN v_patch ? 'completed_at' THEN NULL
        ELSE v_session.completed_at
    END;

    UPDATE public.payment_checkout_sessions
    SET
        status = COALESCE(v_next_status, v_session.status),
        checkout_url = v_next_checkout_url,
        query_mode = v_next_query_mode,
        payment_order_id = v_next_payment_order_id,
        provider_metadata = v_next_provider_metadata,
        error_message = v_next_error_message,
        completed_at = v_next_completed_at
    WHERE id = p_session_id
    RETURNING * INTO v_session;

    RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_payment_checkout_session(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_update_payment_checkout_session(UUID, JSONB, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_create_pending_payment_order_for_checkout_session(JSONB, UUID);

CREATE OR REPLACE FUNCTION public.fn_create_pending_payment_order_for_checkout_session(
    p_payload JSONB DEFAULT '{}'::JSONB,
    p_user_id UUID DEFAULT NULL
)
RETURNS public.payment_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_payload JSONB := COALESCE(p_payload, '{}'::JSONB);
    v_checkout_session_id UUID := CASE
        WHEN COALESCE(v_payload->>'checkout_session_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (v_payload->>'checkout_session_id')::UUID
        ELSE NULL
    END;
    v_payload_user_id UUID := CASE
        WHEN COALESCE(v_payload->>'user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (v_payload->>'user_id')::UUID
        ELSE NULL
    END;
    v_session public.payment_checkout_sessions%ROWTYPE;
    v_existing_order public.payment_orders%ROWTYPE;
    v_order public.payment_orders%ROWTYPE;
    v_provider TEXT;
    v_provider_order_no TEXT := NULLIF(BTRIM(COALESCE(v_payload->>'provider_order_no', '')), '');
    v_site VARCHAR(10);
    v_package_id UUID := CASE
        WHEN COALESCE(v_payload->>'package_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (v_payload->>'package_id')::UUID
        ELSE NULL
    END;
    v_package_name TEXT := NULLIF(BTRIM(COALESCE(v_payload->>'package_name', '')), '');
    v_expected_amount NUMERIC(10,2) := NULLIF(BTRIM(COALESCE(v_payload->>'expected_amount', '')), '')::NUMERIC(10,2);
    v_points_amount NUMERIC(12,1) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'points_amount', '')), '')::NUMERIC(12,1), 0);
    v_raw_payload JSONB := CASE
        WHEN jsonb_typeof(COALESCE(v_payload->'raw_payload', '{}'::JSONB)) = 'object'
            THEN COALESCE(v_payload->'raw_payload', '{}'::JSONB)
        ELSE '{}'::JSONB
    END;
    v_provider_metadata JSONB := CASE
        WHEN jsonb_typeof(COALESCE(v_payload->'provider_metadata', '{}'::JSONB)) = 'object'
            THEN COALESCE(v_payload->'provider_metadata', '{}'::JSONB)
        ELSE '{}'::JSONB
    END;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_payload_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    IF v_checkout_session_id IS NULL THEN
        RAISE EXCEPTION 'checkout_session_id is required';
    END IF;

    SELECT *
    INTO v_session
    FROM public.payment_checkout_sessions
    WHERE id = v_checkout_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment checkout session not found';
    END IF;

    IF v_session.user_id IS NOT NULL AND v_session.user_id <> v_effective_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_provider := COALESCE(NULLIF(BTRIM(LOWER(COALESCE(v_payload->>'provider', ''))), ''), LOWER(COALESCE(v_session.provider, '')));
    v_site := COALESCE(NULLIF(BTRIM(LOWER(COALESCE(v_payload->>'site', ''))), ''), COALESCE(v_session.site, 'cn'));
    v_package_id := COALESCE(v_package_id, v_session.package_id);
    v_package_name := COALESCE(v_package_name, v_session.package_name);
    v_expected_amount := COALESCE(v_expected_amount, v_session.expected_amount);
    v_points_amount := GREATEST(v_points_amount, COALESCE(v_session.granted_points, 0));

    IF v_provider IS NULL OR v_provider = '' THEN
        RAISE EXCEPTION 'provider is required';
    END IF;

    IF v_provider_order_no IS NULL THEN
        RAISE EXCEPTION 'provider_order_no is required';
    END IF;

    SELECT *
    INTO v_existing_order
    FROM public.payment_orders
    WHERE provider = v_provider
      AND checkout_session_id = v_checkout_session_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN v_existing_order;
    END IF;

    INSERT INTO public.payment_orders (
        provider,
        provider_order_no,
        user_id,
        checkout_session_id,
        site,
        package_id,
        package_name,
        expected_amount,
        paid_amount,
        points_amount,
        status,
        sign_verified,
        amount_verified,
        raw_payload,
        provider_metadata
    ) VALUES (
        v_provider,
        v_provider_order_no,
        v_effective_user_id,
        v_checkout_session_id,
        v_site,
        v_package_id,
        v_package_name,
        v_expected_amount,
        NULL,
        v_points_amount,
        'pending',
        FALSE,
        FALSE,
        v_raw_payload,
        v_provider_metadata
    )
    RETURNING * INTO v_order;

    RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_pending_payment_order_for_checkout_session(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_pending_payment_order_for_checkout_session(JSONB, UUID) TO authenticated, service_role;
