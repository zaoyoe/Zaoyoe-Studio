-- ============================================
-- Custom Recharge Quote Resolution
-- 自定义充值按服务端报价单完成爱发电落单与发码
-- ============================================

DROP FUNCTION IF EXISTS public.fn_finalize_afdian_custom_payment(TEXT, UUID, VARCHAR, INTEGER, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_finalize_afdian_custom_payment(
    p_order_no TEXT,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_points INTEGER DEFAULT 0,
    p_expected_amount NUMERIC DEFAULT NULL,
    p_quote_id TEXT DEFAULT NULL,
    p_package_name TEXT DEFAULT '自定义充值'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_order public.afdian_orders%ROWTYPE;
    v_resolved_order public.payment_orders%ROWTYPE;
    v_quote_order public.payment_orders%ROWTYPE;
    v_target_order public.payment_orders%ROWTYPE;
    v_effective_code TEXT;
    v_effective_amount NUMERIC(10,2);
    v_quote_id TEXT := NULLIF(BTRIM(COALESCE(p_quote_id, '')), '');
    v_package_name TEXT := COALESCE(NULLIF(BTRIM(COALESCE(p_package_name, '')), ''), '自定义充值');
    v_quote_metadata JSONB := '{}'::JSONB;
    v_target_metadata JSONB := '{}'::JSONB;
    v_target_raw_payload JSONB := '{}'::JSONB;
    v_amount_matches BOOLEAN := FALSE;
BEGIN
    IF COALESCE(BTRIM(p_order_no), '') = '' THEN
        RAISE EXCEPTION 'order_no is required';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    IF COALESCE(p_points, 0) <= 0 THEN
        RAISE EXCEPTION 'points must be greater than 0';
    END IF;

    IF p_expected_amount IS NULL OR p_expected_amount <= 0 THEN
        RAISE EXCEPTION 'expected_amount must be greater than 0';
    END IF;

    p_site := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');

    SELECT *
    INTO v_order
    FROM public.afdian_orders
    WHERE out_trade_no = p_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'afdian order not found';
    END IF;

    IF v_order.site_user_id IS NOT NULL AND v_order.site_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF NOT COALESCE(v_order.sign_verified, false) THEN
        RAISE EXCEPTION 'afdian order signature not verified';
    END IF;

    SELECT *
    INTO v_resolved_order
    FROM public.payment_orders
    WHERE provider = 'afdian'
      AND provider_order_no = p_order_no
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_resolved_order.user_id IS NOT NULL AND v_resolved_order.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF v_quote_id IS NOT NULL THEN
        SELECT *
        INTO v_quote_order
        FROM public.payment_orders
        WHERE provider = 'afdian'
          AND user_id = p_user_id
          AND COALESCE(provider_metadata->>'custom_quote_id', '') = v_quote_id
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE;
    END IF;

    v_effective_amount := COALESCE(v_order.total_amount, v_resolved_order.paid_amount, 0);
    v_amount_matches := ABS(COALESCE(v_effective_amount, 0) - COALESCE(p_expected_amount, 0)) <= 0.01;
    IF NOT v_amount_matches THEN
        RAISE EXCEPTION 'paid amount does not match quoted amount';
    END IF;

    IF v_quote_order.id IS NOT NULL THEN
        v_quote_metadata := COALESCE(v_quote_order.provider_metadata, '{}'::JSONB);
    END IF;

    IF v_resolved_order.id IS NOT NULL THEN
        v_target_order := v_resolved_order;

        IF v_quote_order.id IS NOT NULL AND v_quote_order.id <> v_resolved_order.id THEN
            UPDATE public.payment_orders
            SET
                checkout_session_id = COALESCE(payment_orders.checkout_session_id, v_quote_order.checkout_session_id),
                user_id = COALESCE(payment_orders.user_id, p_user_id),
                site = COALESCE(NULLIF(BTRIM(p_site), ''), payment_orders.site),
                expected_amount = COALESCE(p_expected_amount, payment_orders.expected_amount),
                package_name = COALESCE(NULLIF(BTRIM(v_package_name), ''), payment_orders.package_name),
                provider_metadata = COALESCE(payment_orders.provider_metadata, '{}'::JSONB)
                    || jsonb_strip_nulls(jsonb_build_object(
                        'charge_type', 'custom',
                        'custom_quote_id', v_quote_id,
                        'custom_quote', v_quote_metadata->'custom_quote',
                        'custom_amount_reconciled_at', v_now,
                        'custom_amount_reconciled_from_payment_order_id', v_quote_order.id
                    )),
                updated_at = v_now
            WHERE id = v_resolved_order.id
            RETURNING * INTO v_target_order;

            UPDATE public.payment_orders
            SET
                checkout_session_id = NULL,
                provider_metadata = COALESCE(provider_metadata, '{}'::JSONB)
                    || jsonb_strip_nulls(jsonb_build_object(
                        'provider_order_pending', TRUE,
                        'provider_order_resolved', FALSE,
                        'checkout_session_detached_at', v_now,
                        'checkout_session_detached_by', 'fn_finalize_afdian_custom_payment',
                        'superseded_by_payment_order_id', v_resolved_order.id
                    )),
                last_error = COALESCE(NULLIF(BTRIM(last_error), ''), 'merged_into_finalized_custom_payment'),
                updated_at = v_now
            WHERE id = v_quote_order.id
              AND v_quote_order.checkout_session_id IS NOT NULL;
        END IF;
    ELSIF v_quote_order.id IS NOT NULL THEN
        UPDATE public.payment_orders
        SET
            provider_order_no = p_order_no,
            site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
            package_id = NULL,
            package_name = v_package_name,
            expected_amount = COALESCE(p_expected_amount, expected_amount),
            paid_amount = COALESCE(v_effective_amount, paid_amount),
            points_amount = GREATEST(COALESCE(points_amount, 0), COALESCE(p_points, 0)),
            sign_verified = TRUE,
            amount_verified = TRUE,
            provider_metadata = COALESCE(provider_metadata, '{}'::JSONB)
                || jsonb_strip_nulls(jsonb_build_object(
                    'charge_type', 'custom',
                    'custom_quote_id', v_quote_id,
                    'custom_quote', v_quote_metadata->'custom_quote',
                    'custom_amount_reconciled_at', v_now,
                    'provider_order_resolved', TRUE,
                    'provider_order_resolved_at', v_now
                )),
            paid_at = COALESCE(paid_at, v_now),
            verified_at = COALESCE(verified_at, v_now),
            last_error = NULL,
            status = CASE
                WHEN status = 'redeemed' THEN status
                ELSE 'paid'
            END,
            updated_at = v_now
        WHERE id = v_quote_order.id
        RETURNING * INTO v_target_order;
    ELSE
        INSERT INTO public.payment_orders (
            provider,
            provider_order_no,
            user_id,
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
            provider_metadata,
            paid_at,
            verified_at,
            last_error,
            created_at,
            updated_at
        ) VALUES (
            'afdian',
            p_order_no,
            p_user_id,
            p_site,
            NULL,
            v_package_name,
            p_expected_amount,
            v_effective_amount,
            GREATEST(COALESCE(p_points, 0), 0),
            'paid',
            TRUE,
            TRUE,
            COALESCE(v_order.raw_payload, '{}'::JSONB),
            jsonb_strip_nulls(jsonb_build_object(
                'charge_type', 'custom',
                'custom_quote_id', v_quote_id,
                'custom_amount_reconciled_at', v_now,
                'provider_order_resolved', TRUE,
                'provider_order_resolved_at', v_now
            )),
            v_now,
            v_now,
            NULL,
            v_now,
            v_now
        )
        RETURNING * INTO v_target_order;
    END IF;

    v_target_metadata := COALESCE(v_target_order.provider_metadata, '{}'::JSONB);
    v_target_raw_payload := COALESCE(v_target_order.raw_payload, '{}'::JSONB) || COALESCE(v_order.raw_payload, '{}'::JSONB);

    UPDATE public.payment_orders
    SET
        user_id = COALESCE(user_id, p_user_id),
        site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
        package_id = NULL,
        package_name = v_package_name,
        expected_amount = COALESCE(p_expected_amount, expected_amount),
        paid_amount = COALESCE(v_effective_amount, paid_amount),
        points_amount = GREATEST(COALESCE(points_amount, 0), COALESCE(p_points, 0)),
        sign_verified = TRUE,
        amount_verified = TRUE,
        raw_payload = v_target_raw_payload,
        provider_metadata = v_target_metadata || jsonb_strip_nulls(jsonb_build_object(
            'charge_type', 'custom',
            'custom_quote_id', v_quote_id,
            'custom_quote', COALESCE(v_quote_metadata->'custom_quote', v_target_metadata->'custom_quote'),
            'custom_amount_reconciled_at', v_now,
            'provider_order_resolved', TRUE,
            'provider_order_resolved_at', v_now
        )),
        paid_at = COALESCE(paid_at, v_now),
        verified_at = COALESCE(verified_at, v_now),
        last_error = NULL,
        status = CASE
            WHEN status = 'redeemed' THEN status
            ELSE 'paid'
        END,
        updated_at = v_now
    WHERE id = v_target_order.id
    RETURNING * INTO v_target_order;

    v_effective_code := public.fn_ensure_redemption_code_for_payment_order(
        v_target_order.id,
        NULL,
        GREATEST(COALESCE(p_points, 0), 0),
        p_site,
        p_order_no
    );

    UPDATE public.afdian_orders
    SET
        site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
        site_user_id = COALESCE(site_user_id, p_user_id),
        claimed_at = COALESCE(claimed_at, v_now),
        points = GREATEST(COALESCE(points, 0), COALESCE(p_points, 0)),
        redeem_code = COALESCE(redeem_code, v_effective_code),
        payment_status = CASE
            WHEN payment_status = 'redeemed' THEN payment_status
            ELSE 'paid'
        END,
        sign_verified = TRUE,
        amount_verified = TRUE,
        paid_at = COALESCE(paid_at, v_now),
        verified_at = COALESCE(verified_at, v_now),
        payment_order_id = v_target_order.id
    WHERE id = v_order.id;

    RETURN jsonb_build_object(
        'payment_order_id', v_target_order.id,
        'checkout_session_id', v_target_order.checkout_session_id,
        'status', CASE WHEN v_target_order.status = 'redeemed' THEN v_target_order.status ELSE 'paid' END,
        'code', v_effective_code,
        'points', GREATEST(COALESCE(v_target_order.points_amount, 0), COALESCE(p_points, 0)),
        'quote_id', v_quote_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_finalize_afdian_custom_payment(TEXT, UUID, VARCHAR, INTEGER, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_finalize_afdian_custom_payment(TEXT, UUID, VARCHAR, INTEGER, NUMERIC, TEXT, TEXT) TO service_role;
