-- 🔧 Admin Deduct Points Function
-- 用于管理员撤销兑换码时扣除用户积分
-- 需要在 Supabase SQL Editor 中执行此脚本

-- 创建管理员版本的扣分函数（可指定用户ID）
CREATE OR REPLACE FUNCTION fn_deduct_points(
    p_target_user_id UUID,
    p_amount INT,
    p_reason TEXT DEFAULT 'Admin Deduction',
    p_reference_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    current_bonus INT;
    current_paid INT;
    deduct_from_bonus INT := 0;
    deduct_from_paid INT := 0;
    actual_deducted INT := 0;
BEGIN
    -- 1. Lock record for update
    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM points_balance
    WHERE user_id = p_target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- User has no balance, nothing to deduct
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'message', 'User has no balance'
        );
    END IF;

    -- 2. Calculate how much we can actually deduct (don't go negative)
    actual_deducted := LEAST(p_amount, current_bonus + current_paid);
    
    IF actual_deducted <= 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'deducted', 0,
            'message', 'User has zero balance'
        );
    END IF;

    -- 3. Calculate Deduction Logic (Bonus First)
    IF current_bonus >= actual_deducted THEN
        deduct_from_bonus := actual_deducted;
        deduct_from_paid := 0;
    ELSE
        deduct_from_bonus := current_bonus;
        deduct_from_paid := actual_deducted - current_bonus;
    END IF;

    -- 4. Update Balance
    UPDATE points_balance
    SET bonus_balance = bonus_balance - deduct_from_bonus,
        paid_balance = paid_balance - deduct_from_paid,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = p_target_user_id;

    -- 5. Record Ledger (negative amount for deduction)
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (p_target_user_id, -actual_deducted, p_reason, p_reference_id);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', actual_deducted,
        'new_total', (current_bonus + current_paid - actual_deducted)
    );
END;
$$;

-- 注意：此函数只能由 SECURITY DEFINER 函数（如 fn_revoke_code）内部调用
-- 不直接授予用户执行权限以防止滥用
