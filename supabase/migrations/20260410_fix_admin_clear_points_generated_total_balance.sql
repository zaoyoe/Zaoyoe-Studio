-- Fix admin clear-point helpers after points_balance.total_balance became a generated column.
-- Generated columns cannot be updated directly, so only writable component balances
-- should be reset.

CREATE OR REPLACE FUNCTION public.fn_admin_clear_user_data(
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
    IF clear_points THEN
        UPDATE public.user_points
        SET balance = 0, total_earned = 0
        WHERE user_id = target_user_id;
        GET DIAGNOSTICS v_legacy_count = ROW_COUNT;

        UPDATE public.points_balance
        SET paid_balance = 0, bonus_balance = 0
        WHERE user_id = target_user_id;
        GET DIAGNOSTICS v_balance_count = ROW_COUNT;
    END IF;

    IF clear_purchases THEN
        SELECT COUNT(*) INTO v_initial_purchases
        FROM public.prompt_unlocks
        WHERE user_id = target_user_id;

        DELETE FROM public.prompt_unlocks
        WHERE user_id = target_user_id;
        GET DIAGNOSTICS v_purchases_count = ROW_COUNT;

        SELECT COUNT(*) INTO v_remaining_purchases
        FROM public.prompt_unlocks
        WHERE user_id = target_user_id;
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

CREATE OR REPLACE FUNCTION public.fn_admin_clear_points(target_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_legacy_count INT;
    v_balance_count INT;
BEGIN
    UPDATE public.user_points
    SET balance = 0, total_earned = 0
    WHERE user_id = target_user_id;
    GET DIAGNOSTICS v_legacy_count = ROW_COUNT;

    UPDATE public.points_balance
    SET paid_balance = 0, bonus_balance = 0
    WHERE user_id = target_user_id;
    GET DIAGNOSTICS v_balance_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'legacy_updated', v_legacy_count,
        'balance_updated', v_balance_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
