-- 🎁 Commercial Points System - Transaction Functions
-- UPDATED: Adapted to existing table structure

-- Drop old functions if they exist
DROP FUNCTION IF EXISTS fn_add_points(UUID, INT, VARCHAR, VARCHAR, TEXT, JSONB);
DROP FUNCTION IF EXISTS fn_deduct_points(INT, VARCHAR, TEXT, JSONB);

-- 1. ➕ Add Points (Recharge / Gift / Redeem)
-- Adapted to existing points_ledger structure: id, user_id, amount, created_at, reason, reference_id
CREATE OR REPLACE FUNCTION fn_add_points(
    target_user_id UUID,
    p_amount INT,
    p_reason TEXT DEFAULT 'System Add',
    p_reference_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_paid INT;
    new_bonus INT;
BEGIN
    -- 1. Validation
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    -- 2. Update or Insert Balance
    INSERT INTO points_balance (user_id, paid_balance, bonus_balance)
    VALUES (target_user_id, p_amount, 0)
    ON CONFLICT (user_id) DO UPDATE SET
        paid_balance = points_balance.paid_balance + p_amount,
        updated_at = NOW(),
        version = points_balance.version + 1
    RETURNING paid_balance, bonus_balance INTO new_paid, new_bonus;

    -- 3. Record in Ledger (using existing columns)
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, p_amount, p_reason, p_reference_id);

    RETURN jsonb_build_object(
        'success', true,
        'new_total', new_paid + new_bonus,
        'added', p_amount
    );
END;
$$;

-- 2. ➖ Deduct Points (Consumption)
-- Priority: Deduct BONUS balance FIRST, then PAID balance
CREATE OR REPLACE FUNCTION fn_deduct_points(
    p_amount INT,
    p_reason TEXT DEFAULT 'Consumption',
    p_reference_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_user_id UUID := auth.uid();
    current_bonus INT;
    current_paid INT;
    deduct_from_bonus INT := 0;
    deduct_from_paid INT := 0;
BEGIN
    -- 1. Lock record for update
    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM points_balance
    WHERE user_id = target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User balance account not found';
    END IF;

    -- 2. Check Sufficient Funds
    IF (current_bonus + current_paid) < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    -- 3. Calculate Deduction Logic (Bonus First)
    IF current_bonus >= p_amount THEN
        deduct_from_bonus := p_amount;
        deduct_from_paid := 0;
    ELSE
        deduct_from_bonus := current_bonus;
        deduct_from_paid := p_amount - current_bonus;
    END IF;

    -- 4. Update Balance
    UPDATE points_balance
    SET bonus_balance = bonus_balance - deduct_from_bonus,
        paid_balance = paid_balance - deduct_from_paid,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = target_user_id;

    -- 5. Record Ledger (negative amount for deduction)
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, -p_amount, p_reason, p_reference_id);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', p_amount,
        'new_total', (current_bonus + current_paid - p_amount)
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION fn_add_points(UUID, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_deduct_points(INT, TEXT, TEXT) TO authenticated;
