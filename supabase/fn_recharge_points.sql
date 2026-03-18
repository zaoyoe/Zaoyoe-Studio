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
BEGIN
    -- 1. Insert into Ledger
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, p_paid + p_bonus, p_reason, p_reference_id);

    -- 2. Update Balance Table (Upsert)
    INSERT INTO points_balance (user_id, paid_balance, bonus_balance)
    VALUES (target_user_id, p_paid, p_bonus)
    ON CONFLICT (user_id)
    DO UPDATE SET
        paid_balance = points_balance.paid_balance + EXCLUDED.paid_balance,
        bonus_balance = points_balance.bonus_balance + EXCLUDED.bonus_balance,
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;
        
    RETURN jsonb_build_object(
        'success', true,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
