-- Site-aware recharge RPC aligned with the hardened migration
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

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) TO service_role;
