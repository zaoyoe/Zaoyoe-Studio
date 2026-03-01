-- ============================================
-- 每日签到 RPC 函数
-- 用户每天签到一次，获得 system_config.rewards.daily_checkin 积分
-- 调用方式: SELECT * FROM fn_daily_checkin(p_user_id, p_site)
-- ============================================

CREATE OR REPLACE FUNCTION fn_daily_checkin(
    p_user_id UUID,
    p_site TEXT DEFAULT 'cn'
)
RETURNS JSONB AS $$
DECLARE
    v_reward INT := 0;
    v_config JSONB;
    v_already_checked BOOLEAN := false;
    v_new_balance NUMERIC;
BEGIN
    -- 参数校验
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '用户未登录');
    END IF;
    
    -- 读取签到奖励配置
    SELECT config_value INTO v_config
    FROM system_config
    WHERE config_key = 'rewards';
    
    v_reward := COALESCE((v_config->>'daily_checkin')::INT, 5);
    
    -- 检查今天是否已签到（基于用户时区，用 UTC date 判断）
    SELECT EXISTS(
        SELECT 1 FROM points_ledger
        WHERE user_id = p_user_id
          AND site = p_site
          AND reason = 'daily_checkin'
          AND created_at::date = NOW()::date
    ) INTO v_already_checked;
    
    IF v_already_checked THEN
        RETURN jsonb_build_object(
            'success', false,
            'already_checked', true,
            'message', '今日已签到',
            'points', 0
        );
    END IF;
    
    -- 发放签到积分
    INSERT INTO points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (p_user_id, p_site, 0, v_reward)
    ON CONFLICT (user_id, site) DO UPDATE SET
        bonus_balance = points_balance.bonus_balance + v_reward,
        updated_at = NOW();
    
    -- 记录积分流水
    INSERT INTO points_ledger (user_id, site, amount, reason, reference_id)
    VALUES (p_user_id, p_site, v_reward, 'daily_checkin', 'CHECKIN_' || TO_CHAR(NOW(), 'YYYYMMDD'));
    
    -- 查询最新余额
    SELECT COALESCE(total_balance, 0) INTO v_new_balance
    FROM points_balance
    WHERE user_id = p_user_id AND site = p_site;
    
    RETURN jsonb_build_object(
        'success', true,
        'already_checked', false,
        'message', '签到成功',
        'points', v_reward,
        'new_balance', v_new_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
