DROP FUNCTION IF EXISTS public.fn_claim_and_query_afdian_code(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_claim_and_query_afdian_code(
    p_order_no TEXT,
    p_user_id UUID
)
RETURNS TABLE (
    code TEXT,
    points INTEGER,
    is_redeemed BOOLEAN,
    created_at TIMESTAMPTZ,
    payment_status TEXT,
    sign_verified BOOLEAN,
    amount_verified BOOLEAN,
    last_error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_payment RECORD;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    SELECT *
    INTO v_order
    FROM public.afdian_orders
    WHERE out_trade_no = p_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_order.payment_order_id IS NOT NULL THEN
        SELECT *
        INTO v_payment
        FROM public.payment_orders
        WHERE id = v_order.payment_order_id
        FOR UPDATE;
    END IF;

    IF v_order.site_user_id IS NOT NULL AND v_order.site_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF v_payment.id IS NOT NULL AND v_payment.user_id IS NOT NULL AND v_payment.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF v_order.site_user_id IS NULL THEN
        UPDATE public.afdian_orders
        SET
            site_user_id = p_user_id,
            claimed_at = COALESCE(claimed_at, NOW())
        WHERE id = v_order.id;
    END IF;

    IF v_payment.id IS NOT NULL AND v_payment.user_id IS NULL THEN
        UPDATE public.payment_orders
        SET
            user_id = p_user_id,
            claimed_at = COALESCE(claimed_at, NOW())
        WHERE id = v_payment.id;
    END IF;

    RETURN QUERY
    SELECT
        ao.redeem_code,
        COALESCE(rc.points_amount, ao.points, 0),
        COALESCE(rc.status = 'used', ao.is_redeemed, false),
        ao.created_at,
        COALESCE(po.status, ao.payment_status, 'pending')::TEXT,
        COALESCE(po.sign_verified, ao.sign_verified, false),
        COALESCE(po.amount_verified, ao.amount_verified, false),
        po.last_error
    FROM public.afdian_orders ao
    LEFT JOIN public.payment_orders po
        ON po.id = ao.payment_order_id
    LEFT JOIN public.redemption_codes rc
        ON rc.code = ao.redeem_code
    WHERE ao.id = v_order.id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_and_query_afdian_code(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_claim_and_query_afdian_code(TEXT, UUID) TO service_role;

DROP FUNCTION IF EXISTS public.fn_query_afdian_code(TEXT);

CREATE OR REPLACE FUNCTION public.fn_query_afdian_code(
    p_order_no TEXT
)
RETURNS TABLE (
    code TEXT,
    points INTEGER,
    is_redeemed BOOLEAN,
    created_at TIMESTAMPTZ,
    payment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ao.redeem_code,
        COALESCE(rc.points_amount, ao.points, 0),
        COALESCE(rc.status = 'used', ao.is_redeemed, false),
        ao.created_at,
        COALESCE(po.status, ao.payment_status, 'pending')::TEXT
    FROM public.afdian_orders ao
    LEFT JOIN public.payment_orders po
        ON po.id = ao.payment_order_id
    LEFT JOIN public.redemption_codes rc
        ON rc.code = ao.redeem_code
    WHERE ao.out_trade_no = p_order_no;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_query_afdian_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_query_afdian_code(TEXT) TO service_role;
