DROP FUNCTION IF EXISTS public.fn_deduct_points_admin_site_with_breakdown(UUID, INT, TEXT, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS public.fn_deduct_points_admin_site_with_breakdown(UUID, NUMERIC, TEXT, TEXT, VARCHAR);

CREATE OR REPLACE FUNCTION public.fn_deduct_points_admin_site_with_breakdown(
    p_target_user_id UUID,
    p_amount NUMERIC(12,2),
    p_reason TEXT DEFAULT 'Admin Deduction',
    p_reference_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_bonus NUMERIC(12,2);
    current_paid NUMERIC(12,2);
    deduct_from_bonus NUMERIC(12,2) := 0;
    deduct_from_paid NUMERIC(12,2) := 0;
    actual_deducted NUMERIC(12,2) := 0;
    existing_amount NUMERIC(12,2) := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    IF p_reference_id IS NOT NULL THEN
        SELECT ABS(amount) INTO existing_amount
        FROM public.points_ledger
        WHERE user_id = p_target_user_id
          AND reference_id = p_reference_id
          AND site = p_site
          AND amount < 0
        ORDER BY created_at DESC
        LIMIT 1;

        IF existing_amount > 0 THEN
            RETURN jsonb_build_object(
                'success', true,
                'deducted', existing_amount,
                'deducted_paid', 0,
                'deducted_bonus', 0,
                'duplicate', true,
                'site', p_site
            );
        END IF;
    END IF;

    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = p_target_user_id
      AND site = p_site
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'deducted_paid', 0,
            'deducted_bonus', 0,
            'message', 'User has no balance account for this site',
            'site', p_site
        );
    END IF;

    actual_deducted := ROUND(LEAST(ROUND(p_amount, 2), ROUND(current_bonus + current_paid, 2)), 2);

    IF actual_deducted <= 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'deducted_paid', 0,
            'deducted_bonus', 0,
            'message', 'User has zero balance',
            'site', p_site
        );
    END IF;

    IF current_bonus >= actual_deducted THEN
        deduct_from_bonus := actual_deducted;
        deduct_from_paid := 0;
    ELSE
        deduct_from_bonus := current_bonus;
        deduct_from_paid := actual_deducted - current_bonus;
    END IF;

    UPDATE public.points_balance
    SET bonus_balance = ROUND(bonus_balance - deduct_from_bonus, 2),
        paid_balance = ROUND(paid_balance - deduct_from_paid, 2),
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = p_target_user_id
      AND site = p_site;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (p_target_user_id, -actual_deducted, p_reason, p_reference_id, p_site);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', actual_deducted,
        'deducted_paid', deduct_from_paid,
        'deducted_bonus', deduct_from_bonus,
        'new_total', ROUND(current_bonus + current_paid - actual_deducted, 2),
        'site', p_site
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_deduct_points_admin_site_with_breakdown(UUID, NUMERIC, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_deduct_points_admin_site_with_breakdown(UUID, NUMERIC, TEXT, TEXT, VARCHAR) TO service_role;
