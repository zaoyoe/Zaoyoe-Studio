-- Function to clear user data (Points and/or Purchases) with Admin privileges (Bypassing RLS)
-- Usage: SELECT fn_admin_clear_user_data('uuid', true, true);

CREATE OR REPLACE FUNCTION fn_admin_clear_user_data(
    target_user_id UUID,
    clear_points BOOLEAN DEFAULT false,
    clear_purchases BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
    v_legacy_count INT := 0;
    v_balance_count INT := 0;
    v_purchases_count INT := 0;
    v_remaining_purchases INT := 0;
    v_initial_purchases INT := 0;
BEGIN
    -- 1. Clear Points Logic
    IF clear_points THEN
        -- Reset Legacy Table
        UPDATE user_points 
        SET balance = 0, total_earned = 0 
        WHERE user_id = target_user_id;
        GET DIAGNOSTICS v_legacy_count = ROW_COUNT;

        -- Reset New Points Balance
        UPDATE points_balance 
        SET paid_balance = 0, bonus_balance = 0 
        WHERE user_id = target_user_id;
        GET DIAGNOSTICS v_balance_count = ROW_COUNT;
    END IF;

    -- 2. Clear Purchases Logic
    IF clear_purchases THEN
        -- Check count before
        SELECT COUNT(*) INTO v_initial_purchases FROM prompt_unlocks WHERE user_id = target_user_id;
        
        -- Explicitly Delete
        DELETE FROM prompt_unlocks 
        WHERE user_id = target_user_id;
        GET DIAGNOSTICS v_purchases_count = ROW_COUNT;
        
        -- Check count after (Should be 0)
        SELECT COUNT(*) INTO v_remaining_purchases FROM prompt_unlocks WHERE user_id = target_user_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'points_cleared', (v_legacy_count + v_balance_count) > 0,
        'purchases_found', v_initial_purchases,
        'purchases_deleted', v_purchases_count,
        'purchases_remaining', v_remaining_purchases,
        'message', CASE 
            WHEN v_remaining_purchases > 0 THEN 'Error: Failed to delete all records' 
            ELSE 'Successfully cleared data' 
        END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
