-- ============================================
-- Harden payment/redemption entrypoints against packet-tampering abuse
-- ============================================

ALTER TABLE public.redemption_batches
    ADD COLUMN IF NOT EXISTS custom_points_amount INTEGER;

ALTER TABLE public.redemption_batches
    ADD COLUMN IF NOT EXISTS site VARCHAR DEFAULT 'cn';

ALTER TABLE public.redemption_codes
    ADD COLUMN IF NOT EXISTS points_amount INTEGER;

ALTER TABLE public.redemption_codes
    ADD COLUMN IF NOT EXISTS site VARCHAR DEFAULT 'cn';

DROP FUNCTION IF EXISTS public.fn_purchase_shop_item(UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    p_payment_order_id UUID,
    p_package_id UUID DEFAULT NULL,
    p_points INTEGER DEFAULT 0,
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
                    GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0),
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
        GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0),
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
    INTEGER,
    VARCHAR,
    TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    UUID,
    UUID,
    INTEGER,
    VARCHAR,
    TEXT
) TO authenticated, service_role;

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

CREATE OR REPLACE FUNCTION public.fn_dispatch_code(
    p_sku_id VARCHAR,
    p_external_order_id VARCHAR
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code_record RECORD;
    v_package_id UUID;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: service_role only';
    END IF;

    IF COALESCE(BTRIM(p_sku_id), '') = '' THEN
        RAISE EXCEPTION 'sku_id is required';
    END IF;

    IF COALESCE(BTRIM(p_external_order_id), '') = '' THEN
        RAISE EXCEPTION 'external_order_id is required';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.redemption_codes
        WHERE external_order_id = p_external_order_id
          AND status IN ('locked', 'used')
    ) THEN
        SELECT code
        INTO v_code_record
        FROM public.redemption_codes
        WHERE external_order_id = p_external_order_id
        LIMIT 1;

        RETURN json_build_object(
            'success', true,
            'code', v_code_record.code,
            'note', 'Already dispatched'
        );
    END IF;

    v_package_id := p_sku_id::UUID;

    SELECT *
    INTO v_code_record
    FROM public.redemption_codes
    WHERE package_id = v_package_id
      AND status = 'pending'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '没有可用的兑换码');
    END IF;

    UPDATE public.redemption_codes
    SET
        status = 'locked',
        locked_at = NOW(),
        external_order_id = p_external_order_id
    WHERE id = v_code_record.id;

    RETURN json_build_object(
        'success', true,
        'code', v_code_record.code,
        'expires_hint', '请在24小时内使用'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_dispatch_code(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dispatch_code(VARCHAR, VARCHAR) TO service_role;

DROP FUNCTION IF EXISTS public.fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.fn_generate_custom_codes(
    p_batch_name TEXT,
    p_points_amount INTEGER,
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
        p_points_amount,
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
            p_points_amount,
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
    p_points_amount INTEGER,
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

REVOKE ALL ON FUNCTION public.fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;
