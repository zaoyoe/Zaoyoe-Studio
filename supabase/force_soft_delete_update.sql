-- 强制更新清除函数为软删除（隐藏模式）
-- 请务必在 Supabase SQL Editor 中运行此脚本！

-- 1. 确保 is_visible 列存在
ALTER TABLE points_ledger 
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- 2. 重建清除函数（确保逻辑是 UPDATE 而不是 DELETE）
CREATE OR REPLACE FUNCTION fn_clear_user_history()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    -- 核心逻辑：UPDATE 设置不可见，而不是 DELETE
    UPDATE points_ledger 
    SET is_visible = false 
    WHERE user_id = v_user_id AND is_visible = true;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    return deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 授予权限（确保函数可执行）
GRANT EXECUTE ON FUNCTION fn_clear_user_history() TO authenticated;
GRANT UPDATE ON points_ledger TO authenticated; -- 需要 UPDATE 权限才能软删除 (即使是 SECURITY DEFINER 有时也需要，或者确保 RLS 允许)

-- 4. 添加 RLS 策略允许用户 UPDATE 自己的记录（is_visible 字段）
-- 如果没有此策略，即使是 SECURITY DEFINER 可能也会受限，或为了安全起见明确添加
DROP POLICY IF EXISTS "Users hide own ledger" ON points_ledger;
CREATE POLICY "Users hide own ledger" ON points_ledger
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
