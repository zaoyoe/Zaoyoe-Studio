CREATE OR REPLACE FUNCTION fn_get_affiliate_stats(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invited_count INT := 0;
    v_total_commission NUMERIC(12,1) := 0;
    v_invite_code VARCHAR;
    v_rate_shop FLOAT;
    v_rate_agent FLOAT;
    v_reg_reward NUMERIC(12,1);
    v_requires_purchase BOOLEAN;
    v_reward_notice TEXT;
    v_legal_disclaimer TEXT;
    v_affiliate_config JSONB;
BEGIN
    SELECT invite_code INTO v_invite_code FROM profiles WHERE id = p_user_id;
    SELECT COUNT(id) INTO v_invited_count FROM profiles WHERE invited_by = p_user_id;

    -- Includes legacy and new rewards
    SELECT COALESCE(SUM(amount), 0) INTO v_total_commission 
    FROM points_ledger 
    WHERE user_id = p_user_id
      AND (
        reason LIKE '推广返佣%'
        OR reason LIKE '拉新固定奖励%'
        OR reason LIKE '邀请拉新奖励%'
      );

    SELECT config_value INTO v_affiliate_config
    FROM system_config
    WHERE config_key = 'affiliate_program';

    -- Fetch dynamic settings
    v_rate_shop := COALESCE(
        (v_affiliate_config->>'commission_rate_shop')::FLOAT,
        (SELECT value::FLOAT FROM system_settings WHERE key = 'commission_rate_shop'),
        0.10
    );
    v_rate_agent := COALESCE(
        (v_affiliate_config->>'commission_rate_agent')::FLOAT,
        (SELECT value::FLOAT FROM system_settings WHERE key = 'commission_rate_agent'),
        0.10
    );
    v_reg_reward := COALESCE(
        (v_affiliate_config->>'registration_reward_points')::NUMERIC(12,1),
        (SELECT value::NUMERIC(12,1) FROM system_settings WHERE key = 'registration_reward_points'),
        0
    );
    v_requires_purchase := COALESCE(
        (v_affiliate_config->>'registration_reward_requires_purchase')::BOOLEAN,
        (SELECT value::BOOLEAN FROM system_settings WHERE key = 'registration_reward_requires_purchase'),
        true
    );
    v_reward_notice := COALESCE(
        NULLIF(v_affiliate_config->>'reward_notice', ''),
        '拉新固定奖励与持续返佣可叠加发放；异常流量、作弊注册、退款订单与刷单行为不计入奖励统计。'
    );
    v_legal_disclaimer := COALESCE(
        NULLIF(v_affiliate_config->>'legal_disclaimer', ''),
        '活动最终解释权归平台所有'
    );

    RETURN jsonb_build_object(
        'invite_code', v_invite_code,
        'invited_count', v_invited_count,
        'total_commission', v_total_commission,
        'commission_rate_shop', v_rate_shop,
        'commission_rate_agent', v_rate_agent,
        'registration_reward_points', v_reg_reward,
        'registration_reward_requires_purchase', v_requires_purchase,
        'reward_notice', v_reward_notice,
        'legal_disclaimer', v_legal_disclaimer
    );
END;
$$;
