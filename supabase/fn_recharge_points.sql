-- Function to handle recharging points with separate paid and bonus tracking
DROP FUNCTION IF EXISTS fn_recharge_points(UUID, INTEGER, INTEGER, TEXT, TEXT);

CREATE OR REPLACE FUNCTION fn_recharge_points(
    target_user_id UUID,
    p_paid NUMERIC(12,1),
    p_bonus NUMERIC(12,1),
    p_reason TEXT,
    p_reference_id TEXT
)
RETURNS JSONB AS $$
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

    -- 1. Insert into Ledger
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, v_paid + v_bonus, p_reason, p_reference_id)
    RETURNING id INTO v_recharge_ledger_id;

    -- 2. Update Balance Table (Upsert)
    INSERT INTO points_balance (user_id, paid_balance, bonus_balance)
    VALUES (target_user_id, v_paid, v_bonus)
    ON CONFLICT (user_id)
    DO UPDATE SET
        paid_balance = points_balance.paid_balance + EXCLUDED.paid_balance,
        bonus_balance = points_balance.bonus_balance + EXCLUDED.bonus_balance,
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;

    -- 3. Unlock pending affiliate signup reward on the invitee's first real recharge
    IF (v_paid + v_bonus) > 0
       AND (
           p_reason = 'package_purchase'
           OR p_reason = 'afdian_recharge'
           OR p_reason LIKE '模拟充值:%'
           OR p_reason LIKE '模拟充值：%'
       ) THEN
        SELECT *
        INTO v_pending_reward
        FROM pending_referral_rewards
        WHERE invitee_id = target_user_id;

        IF FOUND THEN
            INSERT INTO points_balance (user_id, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, 0, v_pending_reward.reward_points)
            ON CONFLICT (user_id) DO UPDATE SET
                bonus_balance = points_balance.bonus_balance + EXCLUDED.bonus_balance,
                updated_at = NOW();

            INSERT INTO points_ledger (user_id, amount, reason, reference_id)
            VALUES (
                v_pending_reward.inviter_id,
                v_pending_reward.reward_points,
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id
            );

            DELETE FROM pending_referral_rewards
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
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;
