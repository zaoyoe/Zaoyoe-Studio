-- ============================================
-- Harden points mutation RPCs against direct abuse
-- 修复负数反向加钱、公开余额变更 RPC 暴露问题
-- ============================================

DROP FUNCTION IF EXISTS public.fn_recharge_points(UUID, INTEGER, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_recharge_points(UUID, INTEGER, INTEGER, TEXT, TEXT, VARCHAR);

CREATE OR REPLACE FUNCTION public.fn_recharge_points(
    target_user_id UUID,
    p_paid NUMERIC(12,1),
    p_bonus NUMERIC(12,1),
    p_reason TEXT,
    p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_balance RECORD;
    v_recharge_ledger_id UUID;
    v_pending_reward RECORD;
    v_paid NUMERIC(12,1) := COALESCE(p_paid, 0);
    v_bonus NUMERIC(12,1) := COALESCE(p_bonus, 0);
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF v_paid < 0 OR v_bonus < 0 THEN
        RAISE EXCEPTION 'paid and bonus must be non-negative';
    END IF;

    IF (v_paid + v_bonus) <= 0 THEN
        RAISE EXCEPTION 'recharge total must be greater than 0';
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, v_paid + v_bonus, p_reason, p_reference_id)
    RETURNING id INTO v_recharge_ledger_id;

    INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
    VALUES (target_user_id, v_paid, v_bonus)
    ON CONFLICT (user_id)
    DO UPDATE SET
        paid_balance = public.points_balance.paid_balance + EXCLUDED.paid_balance,
        bonus_balance = public.points_balance.bonus_balance + EXCLUDED.bonus_balance,
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;

    IF (v_paid + v_bonus) > 0
       AND public.fn_is_affiliate_qualifying_recharge_reason(p_reason) THEN
        SELECT *
        INTO v_pending_reward
        FROM public.pending_referral_rewards
        WHERE invitee_id = target_user_id;

        IF FOUND THEN
            INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, 0, v_pending_reward.reward_points)
            ON CONFLICT (user_id) DO UPDATE SET
                bonus_balance = public.points_balance.bonus_balance + EXCLUDED.bonus_balance,
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
            VALUES (
                v_pending_reward.inviter_id,
                v_pending_reward.reward_points,
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id
            );

            DELETE FROM public.pending_referral_rewards
            WHERE id = v_pending_reward.id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_recharge_points(
    target_user_id UUID,
    p_paid NUMERIC(12,1),
    p_bonus NUMERIC(12,1),
    p_reason TEXT,
    p_reference_id TEXT,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_balance RECORD;
    v_recharge_ledger_id UUID;
    v_pending_reward RECORD;
    v_paid NUMERIC(12,1) := COALESCE(p_paid, 0);
    v_bonus NUMERIC(12,1) := COALESCE(p_bonus, 0);
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF v_paid < 0 OR v_bonus < 0 THEN
        RAISE EXCEPTION 'paid and bonus must be non-negative';
    END IF;

    IF (v_paid + v_bonus) <= 0 THEN
        RAISE EXCEPTION 'recharge total must be greater than 0';
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, v_paid + v_bonus, p_reason, p_reference_id, v_site)
    RETURNING id INTO v_recharge_ledger_id;

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (target_user_id, v_site, v_paid, v_bonus)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = public.points_balance.paid_balance + EXCLUDED.paid_balance,
        bonus_balance = public.points_balance.bonus_balance + EXCLUDED.bonus_balance,
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;

    IF (v_paid + v_bonus) > 0
       AND public.fn_is_affiliate_qualifying_recharge_reason(p_reason) THEN
        SELECT *
        INTO v_pending_reward
        FROM public.pending_referral_rewards
        WHERE invitee_id = target_user_id;

        IF FOUND THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, v_site, 0, v_pending_reward.reward_points)
            ON CONFLICT (user_id, site) DO UPDATE SET
                bonus_balance = public.points_balance.bonus_balance + EXCLUDED.bonus_balance,
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (
                v_pending_reward.inviter_id,
                v_pending_reward.reward_points,
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id,
                v_site
            );

            DELETE FROM public.pending_referral_rewards
            WHERE id = v_pending_reward.id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_add_points(
    target_user_id UUID,
    p_amount INT,
    p_reason TEXT DEFAULT 'System Add',
    p_reference_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    new_paid NUMERIC(12,1);
    new_bonus NUMERIC(12,1);
BEGIN
    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
    VALUES (target_user_id, p_amount, 0)
    ON CONFLICT (user_id) DO UPDATE SET
        paid_balance = public.points_balance.paid_balance + p_amount,
        updated_at = NOW(),
        version = public.points_balance.version + 1
    RETURNING paid_balance, bonus_balance INTO new_paid, new_bonus;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, p_amount, p_reason, p_reference_id);

    RETURN jsonb_build_object(
        'success', true,
        'new_total', new_paid + new_bonus,
        'added', p_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_add_points(
    target_user_id UUID,
    p_amount INT,
    p_reason TEXT DEFAULT 'System Add',
    p_reference_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    new_paid NUMERIC(12,1);
    new_bonus NUMERIC(12,1);
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
BEGIN
    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (target_user_id, v_site, p_amount, 0)
    ON CONFLICT (user_id, site) DO UPDATE SET
        paid_balance = public.points_balance.paid_balance + p_amount,
        updated_at = NOW(),
        version = public.points_balance.version + 1
    RETURNING paid_balance, bonus_balance INTO new_paid, new_bonus;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, p_amount, p_reason, p_reference_id, v_site);

    RETURN jsonb_build_object(
        'success', true,
        'new_total', new_paid + new_bonus,
        'added', p_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_deduct_points(
    p_amount INT,
    p_reason TEXT DEFAULT 'Consumption',
    p_reference_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    target_user_id UUID := auth.uid();
    current_bonus NUMERIC(12,1);
    current_paid NUMERIC(12,1);
    deduct_from_bonus NUMERIC(12,1) := 0;
    deduct_from_paid NUMERIC(12,1) := 0;
BEGIN
    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User balance account not found';
    END IF;

    IF (current_bonus + current_paid) < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    IF current_bonus >= p_amount THEN
        deduct_from_bonus := p_amount;
        deduct_from_paid := 0;
    ELSE
        deduct_from_bonus := current_bonus;
        deduct_from_paid := p_amount - current_bonus;
    END IF;

    UPDATE public.points_balance
    SET bonus_balance = bonus_balance - deduct_from_bonus,
        paid_balance = paid_balance - deduct_from_paid,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = target_user_id;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, -p_amount, p_reason, p_reference_id);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', p_amount,
        'new_total', (current_bonus + current_paid - p_amount)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_deduct_points(
    p_amount INT,
    p_reason TEXT DEFAULT 'Consumption',
    p_reference_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    target_user_id UUID := auth.uid();
    current_bonus NUMERIC(12,1);
    current_paid NUMERIC(12,1);
    deduct_from_bonus NUMERIC(12,1) := 0;
    deduct_from_paid NUMERIC(12,1) := 0;
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
BEGIN
    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = target_user_id
      AND site = v_site
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User balance account not found';
    END IF;

    IF (current_bonus + current_paid) < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    IF current_bonus >= p_amount THEN
        deduct_from_bonus := p_amount;
        deduct_from_paid := 0;
    ELSE
        deduct_from_bonus := current_bonus;
        deduct_from_paid := p_amount - current_bonus;
    END IF;

    UPDATE public.points_balance
    SET bonus_balance = bonus_balance - deduct_from_bonus,
        paid_balance = paid_balance - deduct_from_paid,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = target_user_id
      AND site = v_site;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, -p_amount, p_reason, p_reference_id, v_site);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', p_amount,
        'new_total', (current_bonus + current_paid - p_amount)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_deduct_points(
    p_target_user_id UUID,
    p_amount INT,
    p_reason TEXT DEFAULT 'Admin Deduction',
    p_reference_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_bonus NUMERIC(12,1);
    current_paid NUMERIC(12,1);
    deduct_from_bonus NUMERIC(12,1) := 0;
    deduct_from_paid NUMERIC(12,1) := 0;
    actual_deducted NUMERIC(12,1) := 0;
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

    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'message', 'User has no balance'
        );
    END IF;

    actual_deducted := LEAST(p_amount, current_bonus + current_paid);

    IF actual_deducted <= 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'message', 'User has zero balance'
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
    SET bonus_balance = bonus_balance - deduct_from_bonus,
        paid_balance = paid_balance - deduct_from_paid,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = p_target_user_id;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
    VALUES (p_target_user_id, -actual_deducted, p_reason, p_reference_id);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', actual_deducted,
        'new_total', (current_bonus + current_paid - actual_deducted)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_deduct_points_admin_site(
    p_target_user_id UUID,
    p_amount INT,
    p_reason TEXT DEFAULT 'Admin Deduction',
    p_reference_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_bonus NUMERIC(12,1);
    current_paid NUMERIC(12,1);
    deduct_from_bonus NUMERIC(12,1) := 0;
    deduct_from_paid NUMERIC(12,1) := 0;
    actual_deducted NUMERIC(12,1) := 0;
    existing_amount NUMERIC(12,1) := 0;
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
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
          AND site = v_site
          AND amount < 0
        ORDER BY created_at DESC
        LIMIT 1;

        IF existing_amount > 0 THEN
            RETURN jsonb_build_object(
                'success', true,
                'deducted', existing_amount,
                'duplicate', true
            );
        END IF;
    END IF;

    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = p_target_user_id
      AND site = v_site
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'message', 'User has no balance account for this site'
        );
    END IF;

    actual_deducted := LEAST(p_amount, current_bonus + current_paid);

    IF actual_deducted <= 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'message', 'User has zero balance'
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
    SET bonus_balance = bonus_balance - deduct_from_bonus,
        paid_balance = paid_balance - deduct_from_paid,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = p_target_user_id
      AND site = v_site;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (p_target_user_id, -actual_deducted, p_reason, p_reference_id, v_site);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', actual_deducted,
        'new_total', (current_bonus + current_paid - actual_deducted),
        'site', v_site
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.fn_add_points(UUID, INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_add_points(UUID, INT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_add_points(UUID, INT, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_add_points(UUID, INT, TEXT, TEXT, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.fn_deduct_points(INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_deduct_points(INT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_deduct_points(INT, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_deduct_points(INT, TEXT, TEXT, VARCHAR) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_deduct_points(UUID, INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_deduct_points(UUID, INT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_deduct_points_admin_site(UUID, INT, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_deduct_points_admin_site(UUID, INT, TEXT, TEXT, VARCHAR) TO service_role;
