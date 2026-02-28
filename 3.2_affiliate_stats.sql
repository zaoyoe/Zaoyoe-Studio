CREATE OR REPLACE FUNCTION fn_get_affiliate_stats(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invited_count INT := 0;
    v_total_commission INT := 0;
    v_invite_code VARCHAR;
    v_rate_shop FLOAT;
    v_rate_agent FLOAT;
    v_reg_reward INT;
BEGIN
    SELECT invite_code INTO v_invite_code FROM profiles WHERE id = p_user_id;
    SELECT COUNT(id) INTO v_invited_count FROM profiles WHERE invited_by = p_user_id;

    -- Includes legacy and new rewards
    SELECT COALESCE(SUM(amount), 0) INTO v_total_commission 
    FROM points_ledger 
    WHERE user_id = p_user_id AND (reason LIKE '推广返佣%' OR reason LIKE '拉新固定奖励%');

    -- Fetch dynamic settings
    SELECT COALESCE((SELECT value::FLOAT FROM system_settings WHERE key = 'commission_rate_shop'), 0.10) INTO v_rate_shop;
    SELECT COALESCE((SELECT value::FLOAT FROM system_settings WHERE key = 'commission_rate_agent'), 0.10) INTO v_rate_agent;
    SELECT COALESCE((SELECT value::INT FROM system_settings WHERE key = 'registration_reward_points'), 0) INTO v_reg_reward;

    RETURN jsonb_build_object(
        'invite_code', v_invite_code,
        'invited_count', v_invited_count,
        'total_commission', v_total_commission,
        'commission_rate_shop', v_rate_shop,
        'commission_rate_agent', v_rate_agent,
        'registration_reward_points', v_reg_reward
    );
END;
$$;
