-- 删除用户可见的所有交易记录
-- 在 Supabase SQL Editor 中运行

DROP FUNCTION IF EXISTS fn_clear_user_history();
DROP FUNCTION IF EXISTS fn_clear_user_history(TEXT);

CREATE OR REPLACE FUNCTION fn_clear_user_history(p_site TEXT DEFAULT 'cn')
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
    v_user_id UUID;
    v_site TEXT;
BEGIN
    -- 获取当前用户 ID
    v_user_id := auth.uid();
    v_site := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    
    -- 软删除：设置 is_visible 为 false
    -- 管理员操作也会保留数据，只是对当前用户界面隐藏
    UPDATE points_ledger 
    SET is_visible = false 
    WHERE user_id = v_user_id
      AND site = v_site
      AND is_visible = true;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
