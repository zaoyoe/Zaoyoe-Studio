-- ♻️ 数据迁移：将旧版积分表 (user_points) 同步到新版积分表 (points_balance)
-- 解决管理员后台看到余额多，但用户前台显示 0 分的问题

-- 1. 创建同步函数
CREATE OR REPLACE FUNCTION sync_legacy_points_to_new()
RETURNS INTEGER AS $$
DECLARE
    migrated_count INTEGER := 0;
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM user_points LOOP
        -- 将旧积分视为付费积分 (paid_balance) 迁移
        -- 如果新表已有记录，则累加（或者覆盖？这里选择覆盖 update，假设旧表是真理）
        -- 为了安全，使用 UPSERT
        INSERT INTO points_balance (user_id, paid_balance, bonus_balance, version)
        VALUES (r.user_id, r.balance, 0, 1)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
            paid_balance = EXCLUDED.paid_balance,
            bonus_balance = points_balance.bonus_balance; -- 保留原有的奖励积分
            
        migrated_count := migrated_count + 1;
    END LOOP;
    
    RETURN migrated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 执行同步
SELECT sync_legacy_points_to_new() as "Migrated Users Count";

-- 3. (可选) 创建触发器保持同步
-- 为了防止后续管理员在旧后台修改积分后，新前台不更新，我们需要一个 Trigger
CREATE OR REPLACE FUNCTION trigger_sync_user_points_to_balance()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO points_balance (user_id, paid_balance, bonus_balance)
    VALUES (NEW.user_id, NEW.balance, 0)
    ON CONFLICT (user_id)
    DO UPDATE SET paid_balance = EXCLUDED.paid_balance;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_points_change ON user_points;
CREATE TRIGGER on_user_points_change
AFTER INSERT OR UPDATE ON user_points
FOR EACH ROW
EXECUTE FUNCTION trigger_sync_user_points_to_balance();
