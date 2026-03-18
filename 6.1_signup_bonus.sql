-- ============================================
-- 首次注册赠送积分
-- 从 system_config.rewards.signup_bonus 读取奖励值
-- 触发器：新用户插入 profiles 表后自动执行
-- ============================================

-- 1. 创建触发器函数
CREATE OR REPLACE FUNCTION fn_signup_bonus()
RETURNS TRIGGER AS $$
DECLARE
    v_bonus NUMERIC(12,1) := 0;
    v_config JSONB;
    v_already_granted BOOLEAN := false;
BEGIN
    -- 读取 system_config 中管理员设置的注册奖励积分
    SELECT config_value INTO v_config
    FROM system_config
    WHERE config_key = 'rewards';
    
    v_bonus := COALESCE((v_config->>'signup_bonus')::NUMERIC(12,1), 0);
    
    -- 如果奖励为 0，直接返回
    IF v_bonus <= 0 THEN
        RETURN NEW;
    END IF;
    
    -- 防重复：检查是否已经发放过注册奖励
    SELECT EXISTS(
        SELECT 1 FROM points_ledger
        WHERE user_id = NEW.id AND reason = 'signup_bonus'
    ) INTO v_already_granted;
    
    IF v_already_granted THEN
        RETURN NEW;
    END IF;
    
    -- 发放奖励积分到 bonus_balance
    INSERT INTO points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (NEW.id, 'cn', 0, v_bonus)
    ON CONFLICT (user_id, site) DO UPDATE SET
        bonus_balance = points_balance.bonus_balance + v_bonus,
        updated_at = NOW();
    
    -- 记录积分流水
    INSERT INTO points_ledger (user_id, site, amount, reason, reference_id)
    VALUES (NEW.id, 'cn', v_bonus, 'signup_bonus', 'REG_BONUS_' || NEW.id);
    
    RAISE NOTICE '[SignupBonus] Granted % points to new user %', v_bonus, NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 创建触发器（在 profiles 插入后触发）
DROP TRIGGER IF EXISTS trg_signup_bonus ON profiles;
CREATE TRIGGER trg_signup_bonus
    AFTER INSERT ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION fn_signup_bonus();
