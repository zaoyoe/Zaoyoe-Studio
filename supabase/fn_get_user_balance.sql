-- Run this in Supabase SQL Editor
-- Site-aware balance RPC aligned with the hardened migration

DROP FUNCTION IF EXISTS public.fn_get_user_balance(UUID);
DROP FUNCTION IF EXISTS public.fn_get_user_balance(VARCHAR);

CREATE OR REPLACE FUNCTION public.fn_get_user_balance(
    p_user_id UUID DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result RECORD;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
BEGIN
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

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    SELECT paid_balance, bonus_balance, total_balance
    INTO v_result
    FROM public.points_balance
    WHERE user_id = v_effective_user_id
      AND site = p_site;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'paid_balance', 0,
            'bonus_balance', 0,
            'total_balance', 0,
            'site', p_site
        );
    END IF;

    RETURN jsonb_build_object(
        'paid_balance', v_result.paid_balance,
        'bonus_balance', v_result.bonus_balance,
        'total_balance', v_result.total_balance,
        'site', p_site
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_user_balance(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_user_balance(UUID, VARCHAR) TO authenticated, service_role;
