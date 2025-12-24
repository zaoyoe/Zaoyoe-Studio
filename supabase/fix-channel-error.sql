-- ============================================
-- 修复 Realtime CHANNEL_ERROR 问题
-- ============================================

-- 问题：Client 连接成功，但 Channel 订阅失败（CHANNEL_ERROR）
-- 原因：可能是 RLS 策略过于严格或 Realtime 权限不足

-- Step 1: 检查当前的 RLS 策略
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'prompt_comments'
ORDER BY policyname;

-- ============================================
-- Step 2: 确保有匿名用户的读取权限（Realtime 必需）
-- ============================================

-- 删除可能过于严格的旧策略
DROP POLICY IF EXISTS "Public read access" ON public.prompt_comments;

-- 创建新的公开读取策略（允许所有人读取）
CREATE POLICY "Enable read access for all users"
ON public.prompt_comments
FOR SELECT
TO public
USING (true);

-- ============================================
-- Step 3: 确保 anon 角色有访问权限
-- ============================================

-- 授予 anon 角色对表的 SELECT 权限
GRANT SELECT ON public.prompt_comments TO anon;
GRANT SELECT ON public.prompt_comments TO authenticated;

-- 授予 anon 角色对 profiles 表的访问权限（评论需要联表查询）
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.profiles TO authenticated;

-- ============================================
-- Step 4: 重新确认 Realtime 配置
-- ============================================

-- 确保 REPLICA IDENTITY 是 FULL
ALTER TABLE public.prompt_comments REPLICA IDENTITY FULL;

-- 确保在 Realtime publication 中
DO $$
BEGIN
    -- 先移除（如果存在）
    BEGIN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.prompt_comments;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;
    
    -- 重新添加
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prompt_comments;
END $$;

-- ============================================
-- Step 5: 验证配置
-- ============================================

-- 检查权限
SELECT 
    grantee,
    table_schema,
    table_name,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'prompt_comments'
AND grantee IN ('anon', 'authenticated', 'public')
ORDER BY grantee, privilege_type;

-- 检查 Realtime publication
SELECT 
    schemaname,
    tablename,
    '✅ 在 Realtime publication 中' as status
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND tablename = 'prompt_comments';

-- ============================================
-- 完成提示
-- ============================================
SELECT '✅ RLS 策略和权限已更新！请刷新测试页面重试' as message;
