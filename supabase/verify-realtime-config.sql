-- ============================================
-- 验证 Realtime 配置是否完整
-- ============================================

-- 1. 检查 REPLICA IDENTITY（最关键！）
SELECT 
    relname AS table_name,
    CASE relreplident
        WHEN 'd' THEN '❌ DEFAULT (不支持 Realtime)'
        WHEN 'f' THEN '✅ FULL (支持 Realtime)'
        WHEN 'i' THEN 'INDEX'
        WHEN 'n' THEN 'NOTHING'
    END AS replica_identity,
    relreplident AS raw_value
FROM pg_class
WHERE relname = 'prompt_comments';

-- 预期结果：replica_identity 应该是 "✅ FULL (支持 Realtime)"

-- ============================================

-- 2. 检查是否在 supabase_realtime publication 中
SELECT 
    schemaname AS schema,
    tablename AS table,
    '✅ 已启用 Realtime' AS status
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND tablename = 'prompt_comments';

-- 预期结果：应该返回一行，显示 prompt_comments 已在 publication 中

-- 如果没有结果，说明表未添加到 Realtime，需要执行：
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.prompt_comments;
