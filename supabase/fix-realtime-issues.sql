-- ============================================
-- 修复实时评论通知问题
-- ============================================

-- 问题 1: 确保 Realtime 已启用
-- 问题 2: 添加 REPLICA IDENTITY FULL（必需用于 Realtime）

-- Step 1: 设置 REPLICA IDENTITY（关键！）
-- 这允许 Realtime 订阅看到完整的行数据
ALTER TABLE public.prompt_comments REPLICA IDENTITY FULL;

-- Step 2: 确保表已添加到 Realtime 发布
ALTER PUBLICATION supabase_realtime ADD TABLE public.prompt_comments;

-- Step 3: 验证 RLS 策略允许匿名读取（Realtime 需要）
-- 如果策略不存在，创建它
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'prompt_comments' 
        AND policyname = 'Public read access'
    ) THEN
        CREATE POLICY "Public read access" 
        ON public.prompt_comments 
        FOR SELECT 
        USING (true);
    END IF;
END $$;

-- ============================================
-- 验证脚本（在 Supabase SQL Editor 中运行）
-- ============================================

-- 检查 REPLICA IDENTITY
SELECT 
    relname AS table_name,
    CASE relreplident
        WHEN 'd' THEN 'DEFAULT'
        WHEN 'f' THEN 'FULL'
        WHEN 'i' THEN 'INDEX'
        WHEN 'n' THEN 'NOTHING'
    END AS replica_identity
FROM pg_class
WHERE relname = 'prompt_comments';

-- 检查是否在 Realtime 发布中
SELECT 
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND tablename = 'prompt_comments';

-- 检查 RLS 策略
SELECT 
    policyname,
    cmd,
    roles,
    qual
FROM pg_policies
WHERE tablename = 'prompt_comments';
