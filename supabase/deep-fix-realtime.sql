-- ============================================
-- 深度诊断 CHANNEL_ERROR 问题
-- ============================================

-- 1. 检查 Realtime 是否在项目级别启用
SELECT 
    EXISTS (
        SELECT 1 FROM pg_publication 
        WHERE pubname = 'supabase_realtime'
    ) AS realtime_publication_exists;

-- 2. 检查表是否在 publication 中（详细信息）
SELECT 
    pt.schemaname,
    pt.tablename,
    p.pubname,
    p.puballtables,
    CASE 
        WHEN pt.tablename IS NOT NULL THEN '✅ 已添加'
        ELSE '❌ 未添加'
    END AS status
FROM pg_publication p
LEFT JOIN pg_publication_tables pt 
    ON p.pubname = pt.pubname 
    AND pt.tablename = 'prompt_comments'
WHERE p.pubname = 'supabase_realtime';

-- 3. 检查所有 RLS 策略
SELECT 
    policyname,
    permissive,
    roles::text,
    cmd,
    CASE 
        WHEN cmd = 'SELECT' AND qual = 'true' THEN '✅ 允许所有读取'
        WHEN cmd = 'SELECT' THEN '⚠️ 有条件限制: ' || qual
        ELSE '其他操作'
    END AS policy_status
FROM pg_policies
WHERE tablename = 'prompt_comments'
ORDER BY cmd, policyname;

-- 4. 检查表的 GRANT 权限
SELECT 
    grantee,
    string_agg(privilege_type, ', ') AS privileges
FROM information_schema.role_table_grants
WHERE table_name = 'prompt_comments'
AND table_schema = 'public'
GROUP BY grantee
ORDER BY grantee;

-- 5. 检查 Realtime schema 权限
SELECT 
    schema_name,
    schema_owner
FROM information_schema.schemata
WHERE schema_name IN ('public', 'realtime');

-- ============================================
-- 强制重置 Realtime 配置
-- ============================================

-- Step 1: 完全移除并重新添加到 publication
BEGIN;

-- 移除表（忽略错误）
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.prompt_comments;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '表未在 publication 中或已移除';
END $$;

-- 设置 REPLICA IDENTITY
ALTER TABLE public.prompt_comments REPLICA IDENTITY FULL;

-- 重新添加
ALTER PUBLICATION supabase_realtime ADD TABLE public.prompt_comments;

COMMIT;

-- ============================================
-- 确保最宽松的 SELECT 权限
-- ============================================

-- 删除所有现有的 SELECT 策略
DROP POLICY IF EXISTS "Enable read access for all users" ON public.prompt_comments;
DROP POLICY IF EXISTS "Public read access" ON public.prompt_comments;
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.prompt_comments;

-- 创建单一的、最宽松的 SELECT 策略
CREATE POLICY "allow_select_all" 
ON public.prompt_comments 
FOR SELECT 
TO public
USING (true);

-- 授予基础权限
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.prompt_comments TO anon, authenticated, public;
GRANT SELECT ON public.profiles TO anon, authenticated, public;

-- ============================================
-- 最终验证
-- ============================================

SELECT '=== 配置验证结果 ===' AS step;

-- 验证 1: REPLICA IDENTITY
SELECT 
    '1. REPLICA IDENTITY' AS check_name,
    CASE relreplident
        WHEN 'f' THEN '✅ FULL'
        ELSE '❌ ' || relreplident::text
    END AS result
FROM pg_class
WHERE relname = 'prompt_comments';

-- 验证 2: Publication
SELECT 
    '2. Realtime Publication' AS check_name,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ 已添加'
        ELSE '❌ 未添加'
    END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND tablename = 'prompt_comments';

-- 验证 3: 权限
SELECT 
    '3. anon 权限' AS check_name,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ 有 SELECT 权限'
        ELSE '❌ 无权限'
    END AS result
FROM information_schema.role_table_grants
WHERE table_name = 'prompt_comments'
AND grantee = 'anon'
AND privilege_type = 'SELECT';

-- 验证 4: RLS 策略
SELECT 
    '4. SELECT 策略' AS check_name,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ 有策略'
        ELSE '❌ 无策略'
    END AS result
FROM pg_policies
WHERE tablename = 'prompt_comments'
AND cmd = 'SELECT';

SELECT '🔄 配置已重置！请刷新测试页面并重试' AS final_message;
