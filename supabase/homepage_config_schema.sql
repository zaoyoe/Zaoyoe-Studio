-- ============================================
-- 主页内容管理系统 - 数据库架构
-- ============================================

-- 主表：homepage_config (主页配置)
CREATE TABLE IF NOT EXISTS homepage_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site VARCHAR(10) NOT NULL DEFAULT 'cn' CHECK (site IN ('cn', 'intl')), -- 站点: 'cn' | 'intl'
    section VARCHAR(50) NOT NULL, -- 区块标识: 'hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker', 'footer'
    
    -- 内容配置 (JSON 格式)
    content JSONB NOT NULL DEFAULT '{}'::JSONB,
    /* 
    通用结构示例：
    {
        "enable_auto": true,           // 是否启用自动聚合
        "title": "自定义标题",
        "subtitle": "副标题",
        "max_items": 6,                // 最大显示数量
        "sort": "popular",             // 排序方式: popular, latest, random
        "custom_image": "/assets/custom/bg.jpg",  // 自定义图片路径
        "featured_items": [            // 手动选择的特色项目
            {"id": "prompt-1", "priority": 1},
            {"id": "product-uuid", "priority": 2}
        ],
        "cta": {                       // 行动号召按钮
            "text": "立即探索",
            "link": "#prompts"
        }
    }
    */
    
    -- 显示控制
    is_visible BOOLEAN DEFAULT true,
    display_order INT DEFAULT 0,
    
    -- 元数据
    updated_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 权限策略
ALTER TABLE homepage_config ENABLE ROW LEVEL SECURITY;

-- 所有人可读
CREATE POLICY "Public read homepage config" 
    ON homepage_config FOR SELECT 
    USING (true);

-- 仅管理员可写
CREATE POLICY "Admins manage homepage config" 
    ON homepage_config FOR ALL 
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 初始化默认配置
INSERT INTO homepage_config (site, section, content, display_order) VALUES
('cn', 'hero', '{
    "enable_auto": true,
    "title": "早鸟工作室",
    "subtitle": "创意 · 效率 · 无限可能",
    "cta": {
        "primary": {"text": "开始探索", "link": "#prompts"},
        "secondary": {"text": "了解更多", "link": "#about"}
    }
}'::JSONB, 1),

('intl', 'hero', '{
    "enable_auto": true,
    "title": "Zaoyoe Studio",
    "subtitle": "Creativity · Speed · Endless Possibility",
    "title_zh": "早鸟工作室",
    "subtitle_zh": "创意 · 效率 · 无限可能",
    "cta": {
        "primary": {"text": "开始探索", "link": "#prompts"},
        "secondary": {"text": "了解更多", "link": "#about"}
    }
}'::JSONB, 1),

('cn', 'prompts', '{
    "enable_auto": true,
    "max_items": 6,
    "sort": "popular",
    "section_title": "提示词",
    "section_subtitle": "让创作更高效，让灵感更自由"
}'::JSONB, 2),

('intl', 'prompts', '{
    "enable_auto": true,
    "max_items": 6,
    "sort": "popular",
    "section_title": "Prompts",
    "section_subtitle": "Create faster, ideate freer",
    "section_title_zh": "提示词",
    "section_subtitle_zh": "让创作更高效，让灵感更自由"
}'::JSONB, 2),

('cn', 'shop', '{
    "enable_auto": true,
    "max_items": 8,
    "category": "all",
    "sort": "popular",
    "section_title": "资源商城",
    "section_subtitle": "优质资源，助力成长"
}'::JSONB, 3),

('intl', 'shop', '{
    "enable_auto": true,
    "max_items": 8,
    "category": "all",
    "sort": "popular",
    "section_title": "Curated Marketplace",
    "section_subtitle": "Premium resources for faster growth",
    "section_title_zh": "资源商城",
    "section_subtitle_zh": "优质资源，助力成长"
}'::JSONB, 3),

('cn', 'verify', '{
    "enable_auto": true,
    "screenshot_path": "/assets/verify-preview.png",
    "section_title": "Gemini Pro",
    "section_subtitle": "提交账号任务，自动获取试用链接",
    "features": ["免费", "实时", "安全"]
}'::JSONB, 4),

('intl', 'verify', '{
    "enable_auto": true,
    "screenshot_path": "/assets/verify-preview.png",
    "section_title": "Gemini API Check",
    "section_subtitle": "Validate your API key and get instant feedback",
    "section_title_zh": "Gemini Pro",
    "section_subtitle_zh": "提交账号任务，自动获取试用链接",
    "features": ["Free", "Realtime", "Secure"]
}'::JSONB, 4),

('cn', 'guestbook', '{
    "enable_auto": true,
    "max_items": 5,
    "section_title": "留言板",
    "section_subtitle": "用户的声音"
}'::JSONB, 5),

('intl', 'guestbook', '{
    "enable_auto": true,
    "max_items": 5,
    "section_title": "Guestbook",
    "section_subtitle": "Hear from the community",
    "section_title_zh": "留言板",
    "section_subtitle_zh": "用户的声音"
}'::JSONB, 5),

('cn', 'ticker', '{
    "enable_auto": true,
    "speed": 30,
    "enable_prompts": true,
    "enable_products": true
}'::JSONB, 6),

('intl', 'ticker', '{
    "enable_auto": true,
    "speed": 30,
    "enable_prompts": true,
    "enable_products": true
}'::JSONB, 6),

('cn', 'footer', '{}'::JSONB, 7),

('intl', 'footer', '{}'::JSONB, 7);

-- 添加索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_homepage_config_site_section ON homepage_config(site, section);
CREATE INDEX IF NOT EXISTS idx_homepage_config_section ON homepage_config(section);
CREATE INDEX IF NOT EXISTS idx_homepage_config_site_visible_order ON homepage_config(site, is_visible, display_order);

-- 添加触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_homepage_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_homepage_config_timestamp
    BEFORE UPDATE ON homepage_config
    FOR EACH ROW
    EXECUTE FUNCTION update_homepage_config_timestamp();

CREATE OR REPLACE FUNCTION audit_homepage_config_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND public.is_admin() THEN
        BEGIN
            INSERT INTO public.admin_audit_logs (admin_id, action_type, details)
            VALUES (
                auth.uid(),
                CASE TG_OP
                    WHEN 'INSERT' THEN 'homepage_config.create'
                    WHEN 'DELETE' THEN 'homepage_config.delete'
                    ELSE 'homepage_config.update'
                END,
                jsonb_build_object(
                    'site', COALESCE(NEW.site, OLD.site),
                    'section', COALESCE(NEW.section, OLD.section),
                    'operation', TG_OP,
                    'old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
                    'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
                )
            );
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_audit_homepage_config_changes ON homepage_config;
CREATE TRIGGER trigger_audit_homepage_config_changes
    AFTER INSERT OR UPDATE OR DELETE ON homepage_config
    FOR EACH ROW
    EXECUTE FUNCTION audit_homepage_config_changes();

-- 辅助函数：获取公开配置（供前端使用）
CREATE OR REPLACE FUNCTION fn_get_homepage_config(
    p_site VARCHAR DEFAULT 'cn',
    p_include_hidden BOOLEAN DEFAULT false
)
RETURNS TABLE (
    section VARCHAR,
    content JSONB,
    is_visible BOOLEAN,
    display_order INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        hc.section,
        hc.content,
        hc.is_visible,
        hc.display_order
    FROM homepage_config hc
    WHERE hc.site = CASE WHEN p_site = 'intl' THEN 'intl' ELSE 'cn' END
      AND (p_include_hidden OR hc.is_visible = true)
    ORDER BY display_order ASC;
$$;

COMMENT ON TABLE homepage_config IS '主页内容配置表，存储各区块的自定义内容和展示设置';
COMMENT ON COLUMN homepage_config.site IS '站点标识符，仅允许 cn 或 intl';
COMMENT ON COLUMN homepage_config.section IS '区块标识符，在每个站点内唯一';
COMMENT ON COLUMN homepage_config.content IS 'JSON 格式的配置数据，结构根据 section 类型而异';
COMMENT ON COLUMN homepage_config.is_visible IS '是否在主页显示该区块';
COMMENT ON COLUMN homepage_config.display_order IS '显示顺序，数字越小越靠前';
