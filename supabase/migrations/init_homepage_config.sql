-- ============================================
-- Homepage Config - Safe Initialization Migration
-- ============================================
-- Purpose: Initialize homepage_config table with default data
-- Usage: Run this in Supabase SQL Editor
-- ============================================

-- Step 1: Ensure RLS is enabled
ALTER TABLE homepage_config ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop existing policies if any (for clean reinstall)
DROP POLICY IF EXISTS "Public read homepage config" ON homepage_config;
DROP POLICY IF EXISTS "Admins manage homepage config" ON homepage_config;

-- Step 3: Create new policies
-- Public can read
CREATE POLICY "Public read homepage config" 
    ON homepage_config FOR SELECT 
    USING (true);

-- Only admins can write (insert, update, delete)
CREATE POLICY "Admins manage homepage config" 
    ON homepage_config FOR ALL 
    USING (
        (auth.jwt() ->> 'email') IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    );

-- Step 4: Insert default configuration (with conflict handling)
INSERT INTO homepage_config (section, content, is_visible, display_order) VALUES
('hero', '{
    "enable_auto": true,
    "title": "早鸟工作室",
    "subtitle": "创意 · 效率 · 无限可能",
    "cta": {
        "primary": {"text": "开始探索", "link": "#prompts"},
        "secondary": {"text": "了解更多", "link": "#about"}
    }
}'::JSONB, true, 1),

('prompts', '{
    "enable_auto": true,
    "max_items": 50,
    "sort": "popular",
    "section_title": "提示词",
    "section_subtitle": "让创作更高效，让灵感更自由",
    "featured_items": []
}'::JSONB, true, 2),

('shop', '{
    "enable_auto": true,
    "max_items": 8,
    "category": "all",
    "section_title": "资源商城",
    "section_subtitle": "优质资源，助力成长",
    "custom_items": []
}'::JSONB, true, 3),

('verify', '{
    "enable_auto": true,
    "screenshot_path": "/assets/verify-preview.png",
    "section_title": "Gemini Pro",
    "section_subtitle": "提交账号任务，自动获取试用链接",
    "features": ["免费", "实时", "安全"]
}'::JSONB, true, 4),

('guestbook', '{
    "enable_auto": true,
    "max_items": 5,
    "section_title": "留言板",
    "section_subtitle": "用户的声音"
}'::JSONB, true, 5),

('ticker', '{
    "enable_auto": true,
    "speed": 30,
    "enable_prompts": true,
    "enable_products": true
}'::JSONB, true, 6)

-- Handle conflicts: update if exists
ON CONFLICT (section) 
DO UPDATE SET
    is_visible = EXCLUDED.is_visible,
    display_order = EXCLUDED.display_order,
    updated_at = NOW();

-- Step 5: Verify data
SELECT section, content, is_visible, display_order 
FROM homepage_config 
ORDER BY display_order;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'homepage_config';

-- List all policies
SELECT * FROM pg_policies 
WHERE tablename = 'homepage_config';

-- Count records
SELECT COUNT(*) as total_sections FROM homepage_config;

-- ============================================
-- ROLLBACK (if needed for testing)
-- ============================================
-- Uncomment to reset:
-- DELETE FROM homepage_config WHERE section IN ('hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker');
