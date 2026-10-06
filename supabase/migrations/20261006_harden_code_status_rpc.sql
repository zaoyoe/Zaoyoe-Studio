-- F002: harden support-facing redemption-code status lookups.
--
-- This file is intentionally only a migration artifact. Codex must not execute
-- it against Supabase; apply it through the authorised database release flow.
--
-- Keep fn_check_code_status unchanged for the authenticated admin points lookup:
-- that function still supports both redemption-code and external-order-number
-- investigations. The support bot gets a separate, minimized RPC instead.

CREATE OR REPLACE FUNCTION public.fn_check_support_code_status(
    p_code VARCHAR
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_input TEXT := UPPER(TRIM(COALESCE(p_code, '')));
    v_result JSON;
BEGIN
    -- The support surface accepts redemption codes only. External order-number
    -- investigations remain in the authenticated admin/order-specific flows.
    IF v_input = ''
       OR v_input !~ '^ZY-[A-Z0-9]+(-[A-Z0-9]+)+$'
       OR v_input !~ '[A-Z]'
    THEN
        RETURN json_build_object(
            'valid', false,
            'message', '请输入有效的兑换码'
        );
    END IF;

    SELECT json_build_object(
        'valid', rc.status = 'pending',
        'status', rc.status,
        'package_name', COALESCE(pp.name, '自定义积分'),
        'points', COALESCE(
            pp.points_amount + COALESCE(pp.bonus_points, 0),
            rc.points_amount,
            rc.points_granted
        ),
        'expires_at', rb.expires_at,
        'used_at', rc.used_at,
        'revoke_reason', rc.revoke_reason,
        'revoked_at', rc.revoked_at
    )
    INTO v_result
    FROM public.redemption_codes AS rc
    LEFT JOIN public.redemption_batches AS rb ON rb.id = rc.batch_id
    LEFT JOIN public.points_packages AS pp ON pp.id = rc.package_id
    WHERE rc.code = v_input;

    IF v_result IS NULL THEN
        RETURN json_build_object(
            'valid', false,
            'message', '无效的兑换码'
        );
    END IF;

    RETURN v_result;
END;
$function$;

-- The support endpoint invokes this through service_role. Browser clients
-- must use the authenticated support endpoint so rate limiting, input validation,
-- audit context, and response minimization remain server-side.
REVOKE ALL ON FUNCTION public.fn_check_support_code_status(VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_support_code_status(VARCHAR) TO service_role;

-- Preserve the admin RPC boundary explicitly. Do not grant this function to
-- browser roles: it returns external order numbers and operator context.
REVOKE ALL ON FUNCTION public.fn_check_code_status(VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_code_status(VARCHAR) TO service_role;
