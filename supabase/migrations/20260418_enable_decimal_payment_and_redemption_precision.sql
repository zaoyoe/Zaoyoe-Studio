-- ============================================
-- Enable decimal precision for payment + redemption flows
-- - align payment checkout sessions / payment orders to 0.01 precision
-- - allow package definitions and redemption codes to carry decimal points
-- - rebuild the affected RPCs so they no longer coerce points to integers
-- ============================================

-- mv_channel_performance aggregates points_packages.points_amount, so PostgreSQL
-- blocks ALTER COLUMN until we temporarily remove the dependent materialized view.
-- SECTION 1: schema precision upgrade + analytics materialized view rebuild
DROP MATERIALIZED VIEW IF EXISTS public.mv_channel_performance;

ALTER TABLE IF EXISTS public.points_packages
    ALTER COLUMN points_amount TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(points_amount, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.points_packages
    ALTER COLUMN bonus_points TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(bonus_points, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.payment_checkout_sessions
    ALTER COLUMN requested_points TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(requested_points, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.payment_checkout_sessions
    ALTER COLUMN bonus_points TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(bonus_points, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.payment_checkout_sessions
    ALTER COLUMN granted_points TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(granted_points, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.payment_orders
    ALTER COLUMN points_amount TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(points_amount, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.redemption_batches
    ALTER COLUMN custom_points_amount TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(custom_points_amount, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.redemption_codes
    ALTER COLUMN points_amount TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(points_amount, 0)::NUMERIC, 2);

ALTER TABLE IF EXISTS public.redemption_codes
    ALTER COLUMN points_granted TYPE NUMERIC(12,2)
    USING ROUND(COALESCE(points_granted, 0)::NUMERIC, 2);

CREATE MATERIALIZED VIEW public.mv_channel_performance AS
SELECT
    b.channel,
    COUNT(DISTINCT b.id) AS batch_count,
    COUNT(c.id) AS total_codes,
    COUNT(c.id) FILTER (WHERE c.status = 'used') AS used_codes,
    COALESCE(SUM(pkg.points_amount) FILTER (WHERE c.status = 'used'), 0) AS total_points_redeemed,
    ROUND(
        COUNT(c.id) FILTER (WHERE c.status = 'used')::NUMERIC /
        NULLIF(COUNT(c.id), 0) * 100,
        2
    ) AS redemption_rate
FROM public.redemption_batches b
LEFT JOIN public.redemption_codes c ON c.batch_id = b.id
LEFT JOIN public.points_packages pkg ON b.package_id = pkg.id
GROUP BY b.channel
ORDER BY total_points_redeemed DESC;

CREATE UNIQUE INDEX idx_mv_channel_performance_channel
ON public.mv_channel_performance(channel);

GRANT SELECT ON public.mv_channel_performance TO authenticated;

-- SECTION 2: checkout session creation RPC
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
    v_requested_points NUMERIC(12,2) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'requested_points', '')), '')::NUMERIC(12,2), 0);
    v_bonus_points NUMERIC(12,2) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'bonus_points', '')), '')::NUMERIC(12,2), 0);
    v_granted_points NUMERIC(12,2) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'granted_points', '')), '')::NUMERIC(12,2), 0);
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
        ROUND(v_requested_points, 2),
        ROUND(v_bonus_points, 2),
        ROUND(v_granted_points, 2),
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

-- SECTION 3: pending payment order creation RPC
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
    v_points_amount NUMERIC(12,2) := COALESCE(NULLIF(BTRIM(COALESCE(v_payload->>'points_amount', '')), '')::NUMERIC(12,2), 0);
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
        ROUND(v_points_amount, 2),
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

-- SECTION 4: payment redemption hardening RPCs
-- SECTION 4A: mint / ensure redemption code for payment order
DROP FUNCTION IF EXISTS public.fn_ensure_redemption_code_for_payment_order(UUID, UUID, INTEGER, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS public.fn_ensure_redemption_code_for_payment_order(UUID, UUID, NUMERIC, VARCHAR, TEXT);

CREATE OR REPLACE FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    p_payment_order_id UUID,
    p_package_id UUID DEFAULT NULL,
    p_points NUMERIC(12,2) DEFAULT 0,
    p_site VARCHAR DEFAULT 'cn',
    p_external_order_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_user_id UUID := auth.uid();
    v_is_admin BOOLEAN := FALSE;
    v_normalized_status TEXT;
    v_payment_order public.payment_orders%ROWTYPE;
    v_effective_code TEXT;
BEGIN
    IF v_request_role <> 'service_role' THEN
        v_is_admin := COALESCE(v_request_user_id IS NOT NULL AND public.is_admin(), FALSE);
        IF NOT v_is_admin THEN
            RAISE EXCEPTION 'Unauthorized: admin or service_role only';
        END IF;
    END IF;

    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'payment_order_id is required';
    END IF;

    SELECT *
    INTO v_payment_order
    FROM public.payment_orders
    WHERE id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment order not found';
    END IF;

    v_normalized_status := COALESCE(NULLIF(BTRIM(LOWER(v_payment_order.status)), ''), '');

    IF GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0) <= 0 THEN
        RAISE EXCEPTION 'payment order points must be greater than 0 before issuing redemption code';
    END IF;

    IF v_request_role = 'service_role' THEN
        IF v_normalized_status NOT IN ('paid', 'redeemed') THEN
            RAISE EXCEPTION 'payment order must be paid before issuing redemption code';
        END IF;
    ELSIF v_is_admin THEN
        IF v_normalized_status NOT IN ('paid', 'redeemed', 'pending_review', 'amount_mismatch') THEN
            RAISE EXCEPTION 'admin review can only issue codes for paid/redeemed/reviewable payment orders';
        END IF;
    END IF;

    IF COALESCE(NULLIF(BTRIM(LOWER(v_payment_order.provider)), ''), '') = 'afdian'
       AND v_request_role = 'service_role'
       AND (
            NOT COALESCE(v_payment_order.sign_verified, FALSE)
            OR NOT COALESCE(v_payment_order.amount_verified, FALSE)
       )
    THEN
        RAISE EXCEPTION 'afdian payment order is not fully verified';
    END IF;

    v_effective_code := NULLIF(BTRIM(v_payment_order.redemption_code), '');

    IF COALESCE(v_effective_code, '') = '' THEN
        FOR i IN 1..8 LOOP
            BEGIN
                v_effective_code := public.generate_redemption_code();

                INSERT INTO public.redemption_codes (
                    code,
                    package_id,
                    points_amount,
                    status,
                    site,
                    external_order_id
                ) VALUES (
                    v_effective_code,
                    COALESCE(p_package_id, v_payment_order.package_id),
                    ROUND(GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0), 2),
                    'pending',
                    COALESCE(NULLIF(BTRIM(p_site), ''), v_payment_order.site, 'cn'),
                    COALESCE(NULLIF(BTRIM(p_external_order_id), ''), NULLIF(BTRIM(v_payment_order.provider_order_no), ''), v_payment_order.id::TEXT)
                );

                EXIT;
            EXCEPTION WHEN unique_violation THEN
                v_effective_code := NULL;
            END;
        END LOOP;

        IF COALESCE(v_effective_code, '') = '' THEN
            RAISE EXCEPTION 'failed to generate redemption code';
        END IF;
    END IF;

    INSERT INTO public.redemption_codes (
        code,
        package_id,
        points_amount,
        status,
        site,
        external_order_id
    ) VALUES (
        v_effective_code,
        COALESCE(p_package_id, v_payment_order.package_id),
        ROUND(GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0), 2),
        'pending',
        COALESCE(NULLIF(BTRIM(p_site), ''), v_payment_order.site, 'cn'),
        COALESCE(NULLIF(BTRIM(p_external_order_id), ''), NULLIF(BTRIM(v_payment_order.provider_order_no), ''), v_payment_order.id::TEXT)
    )
    ON CONFLICT (code) DO UPDATE SET
        package_id = COALESCE(redemption_codes.package_id, EXCLUDED.package_id),
        points_amount = COALESCE(redemption_codes.points_amount, EXCLUDED.points_amount),
        site = COALESCE(redemption_codes.site, EXCLUDED.site),
        external_order_id = COALESCE(redemption_codes.external_order_id, EXCLUDED.external_order_id);

    UPDATE public.payment_orders
    SET
        redemption_code = v_effective_code,
        updated_at = NOW()
    WHERE id = p_payment_order_id;

    RETURN v_effective_code;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    UUID,
    UUID,
    NUMERIC,
    VARCHAR,
    TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    UUID,
    UUID,
    NUMERIC,
    VARCHAR,
    TEXT
) TO authenticated, service_role;

-- SECTION 4B: manual payment order review RPC
CREATE OR REPLACE FUNCTION public.fn_apply_payment_order_review(
    p_payment_order_id UUID,
    p_action TEXT,
    p_note TEXT DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_user_id UUID := auth.uid();
    v_is_admin BOOLEAN := FALSE;
    v_effective_actor_id UUID := COALESCE(p_actor_id, v_request_user_id);
    v_order public.payment_orders%ROWTYPE;
    v_action TEXT := COALESCE(NULLIF(BTRIM(LOWER(p_action)), ''), '');
    v_note TEXT := NULLIF(BTRIM(p_note), '');
    v_now TIMESTAMPTZ := NOW();
    v_next_status TEXT;
    v_redemption_code TEXT;
    v_manual_review JSONB;
BEGIN
    IF v_request_role <> 'service_role' THEN
        v_is_admin := COALESCE(v_request_user_id IS NOT NULL AND public.is_admin(), FALSE);
        IF NOT v_is_admin THEN
            RAISE EXCEPTION 'Unauthorized: admin or service_role only';
        END IF;
    END IF;

    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'payment_order_id is required';
    END IF;

    IF v_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'unsupported review action';
    END IF;

    SELECT *
    INTO v_order
    FROM public.payment_orders
    WHERE id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment order not found';
    END IF;

    IF COALESCE(NULLIF(BTRIM(LOWER(v_order.status)), ''), '') NOT IN ('pending_review', 'amount_mismatch') THEN
        RAISE EXCEPTION 'only pending_review or amount_mismatch orders can be reviewed';
    END IF;

    v_next_status := CASE WHEN v_action = 'approve' THEN 'paid' ELSE 'rejected' END;

    IF v_action = 'approve'
       AND COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian'
       AND GREATEST(COALESCE(v_order.points_amount, 0), 0) <= 0
       AND COALESCE(NULLIF(BTRIM(v_order.redemption_code), ''), '') = ''
    THEN
        RAISE EXCEPTION 'afdian order has no valid package/points, cannot approve safely';
    END IF;

    IF v_action = 'approve'
       AND COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian'
    THEN
        v_redemption_code := public.fn_ensure_redemption_code_for_payment_order(
            v_order.id,
            v_order.package_id,
            v_order.points_amount,
            v_order.site,
            v_order.provider_order_no
        );
    ELSE
        v_redemption_code := v_order.redemption_code;
    END IF;

    v_manual_review := jsonb_strip_nulls(jsonb_build_object(
        'action', v_action,
        'previous_status', v_order.status,
        'reviewed_at', v_now,
        'reviewed_by', v_effective_actor_id,
        'note', v_note,
        'amount_override', (v_order.status = 'amount_mismatch' AND v_action = 'approve')
    ));

    UPDATE public.payment_orders
    SET
        status = v_next_status,
        paid_at = CASE
            WHEN v_action = 'approve' THEN COALESCE(v_order.paid_at, v_now)
            ELSE v_order.paid_at
        END,
        verified_at = CASE
            WHEN v_action = 'approve' THEN v_now
            ELSE COALESCE(v_order.verified_at, v_now)
        END,
        redemption_code = COALESCE(v_redemption_code, v_order.redemption_code),
        last_error = CASE
            WHEN v_action = 'approve' THEN NULL
            ELSE COALESCE(v_note, '已人工审核驳回')
        END,
        provider_metadata = COALESCE(v_order.provider_metadata, '{}'::JSONB) || jsonb_build_object(
            'manual_review', v_manual_review,
            'provider_order_resolved', TRUE,
            'provider_order_resolved_at', COALESCE(
                COALESCE(v_order.provider_metadata, '{}'::JSONB)->'provider_order_resolved_at',
                to_jsonb(v_now)
            )
        ),
        updated_at = v_now
    WHERE id = v_order.id;

    IF v_order.checkout_session_id IS NOT NULL THEN
        UPDATE public.payment_checkout_sessions
        SET
            payment_order_id = v_order.id,
            status = CASE
                WHEN v_action = 'approve' THEN 'completed'
                ELSE 'failed'
            END,
            completed_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(completed_at, v_now)
                ELSE completed_at
            END,
            error_message = CASE
                WHEN v_action = 'approve' THEN NULL
                ELSE COALESCE(v_note, '已人工审核驳回')
            END,
            provider_metadata = COALESCE(provider_metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
                'linked_by', 'manual_review',
                'linked_at', v_now,
                'payment_status', v_next_status,
                'provider_order_no', v_order.provider_order_no
            )),
            updated_at = v_now
        WHERE id = v_order.checkout_session_id;
    END IF;

    IF COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian' THEN
        UPDATE public.afdian_orders
        SET
            payment_status = v_next_status,
            redeem_code = COALESCE(v_redemption_code, redeem_code),
            sign_verified = COALESCE(sign_verified, false) OR COALESCE(v_order.sign_verified, false),
            amount_verified = COALESCE(amount_verified, false) OR COALESCE(v_order.amount_verified, false),
            paid_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(paid_at, v_order.paid_at, v_now)
                ELSE paid_at
            END,
            verified_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(verified_at, v_now)
                ELSE verified_at
            END,
            payment_order_id = v_order.id
        WHERE out_trade_no = v_order.provider_order_no
           OR payment_order_id = v_order.id;
    END IF;

    RETURN jsonb_build_object(
        'payment_order_id', v_order.id,
        'status', v_next_status,
        'redemption_code', COALESCE(v_redemption_code, v_order.redemption_code),
        'checkout_session_id', v_order.checkout_session_id,
        'reviewed_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_apply_payment_order_review(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_apply_payment_order_review(UUID, TEXT, TEXT, UUID)
TO authenticated, service_role;

-- SECTION 5: redemption batch generation + redeem RPCs
-- SECTION 5A: custom redemption batch generation RPC
DROP FUNCTION IF EXISTS public.fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR);
DROP FUNCTION IF EXISTS public.fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR);
DROP FUNCTION IF EXISTS public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.fn_generate_custom_codes(
    p_batch_name TEXT,
    p_points_amount NUMERIC(12,2),
    p_count INTEGER,
    p_channel TEXT DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS TABLE(code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch_id UUID;
    v_code TEXT;
    i INTEGER;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Admin only';
    END IF;

    IF COALESCE(BTRIM(p_batch_name), '') = '' THEN
        RAISE EXCEPTION 'batch name is required';
    END IF;

    IF p_points_amount <= 0 THEN
        RAISE EXCEPTION 'Points amount must be positive';
    END IF;

    IF p_count <= 0 OR p_count > 1000 THEN
        RAISE EXCEPTION 'Count must be between 1 and 1000';
    END IF;

    INSERT INTO public.redemption_batches (
        name,
        package_id,
        channel,
        total_count,
        used_count,
        expires_at,
        custom_points_amount,
        site,
        created_by
    ) VALUES (
        p_batch_name,
        NULL,
        COALESCE(NULLIF(BTRIM(p_channel), ''), 'manual'),
        p_count,
        0,
        p_expires_at,
        ROUND(p_points_amount, 2),
        COALESCE(NULLIF(BTRIM(p_site), ''), 'cn'),
        auth.uid()
    ) RETURNING id INTO v_batch_id;

    FOR i IN 1..p_count LOOP
        v_code := 'ZY-'
            || upper(substring(md5(random()::text) from 1 for 4))
            || '-'
            || upper(substring(md5(random()::text) from 1 for 4))
            || '-'
            || upper(substring(md5(random()::text) from 1 for 4));

        INSERT INTO public.redemption_codes (
            batch_id,
            code,
            points_amount,
            status,
            expires_at,
            site
        ) VALUES (
            v_batch_id,
            v_code,
            ROUND(p_points_amount, 2),
            'pending',
            p_expires_at,
            COALESCE(NULLIF(BTRIM(p_site), ''), 'cn')
        );

        RETURN QUERY SELECT v_code;
    END LOOP;

    RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_generate_custom_codes(
    p_batch_name TEXT,
    p_points_amount NUMERIC(12,2),
    p_count INTEGER,
    p_channel TEXT DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT generated.code
    FROM public.fn_generate_custom_codes(
        p_batch_name,
        p_points_amount,
        p_count,
        p_channel,
        p_expires_at,
        'cn'
    ) AS generated(code);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;

-- SECTION 5B: site-aware redeem code RPC
CREATE OR REPLACE FUNCTION public.fn_redeem_code(
    p_code VARCHAR,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_code_record RECORD;
    v_batch_expires_at TIMESTAMPTZ;
    v_package RECORD;
    v_points_amount NUMERIC(12,2);
    v_package_name TEXT;
    v_effective_expires_at TIMESTAMPTZ;
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    p_code := UPPER(TRIM(COALESCE(p_code, '')));

    IF p_code = '' THEN
        RETURN json_build_object('success', false, 'message', '兑换码不能为空');
    END IF;

    SELECT *
    INTO v_code_record
    FROM public.redemption_codes
    WHERE code = p_code
    FOR UPDATE;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无效的兑换码');
    END IF;

    IF v_code_record.status = 'used' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被使用');
    ELSIF v_code_record.status = 'revoked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被撤销');
    ELSIF v_code_record.status = 'locked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被锁定');
    ELSIF v_code_record.status = 'disabled' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被禁用');
    END IF;

    SELECT expires_at
    INTO v_batch_expires_at
    FROM public.redemption_batches
    WHERE id = v_code_record.batch_id;

    v_effective_expires_at := COALESCE(v_code_record.expires_at, v_batch_expires_at);

    IF v_effective_expires_at IS NOT NULL AND v_effective_expires_at < NOW() THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已过期');
    END IF;

    SELECT *
    INTO v_package
    FROM public.points_packages
    WHERE id = v_code_record.package_id;

    IF v_package IS NULL THEN
        IF COALESCE(v_code_record.points_amount, 0) > 0 THEN
            v_points_amount := ROUND(COALESCE(v_code_record.points_amount, 0), 2);
            v_package_name := '自定义积分';
        ELSE
            RETURN json_build_object('success', false, 'message', '关联的套餐不存在');
        END IF;
    ELSE
        v_points_amount := ROUND(COALESCE(v_package.points_amount, 0) + COALESCE(v_package.bonus_points, 0), 2);
        v_package_name := v_package.name;
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (
        v_user_id,
        v_points_amount,
        '兑换码充值: ' || v_package_name,
        'redeem_' || p_code,
        v_site
    );

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (v_user_id, v_site, v_points_amount, 0)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        updated_at = NOW(),
        version = public.points_balance.version + 1;

    UPDATE public.redemption_codes
    SET status = 'used',
        used_by = v_user_id,
        used_at = NOW(),
        points_granted = v_points_amount
    WHERE id = v_code_record.id;

    RETURN json_build_object(
        'success', true,
        'message', '兑换成功！',
        'points', v_points_amount,
        'package_name', v_package_name
    );
END;
$$;

DROP FUNCTION IF EXISTS public.fn_redeem_code(VARCHAR);

REVOKE ALL ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) TO authenticated;
