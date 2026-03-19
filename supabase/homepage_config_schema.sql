-- ============================================
-- 主页内容管理系统 - 数据库架构
-- ============================================

-- 主表：homepage_config (主页配置)
CREATE TABLE IF NOT EXISTS homepage_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section VARCHAR(50) NOT NULL UNIQUE, -- 区块标识: 'hero', 'prompts', 'shop', 'verify', 'guestbook', 'ticker'
    
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
INSERT INTO homepage_config (section, content, display_order) VALUES
('hero', '{
    "enable_auto": true,
    "title": "早鸟工作室",
    "subtitle": "创意 · 效率 · 无限可能",
    "cta": {
        "primary": {"text": "开始探索", "link": "#prompts"},
        "secondary": {"text": "了解更多", "link": "#about"}
    }
}'::JSONB, 1),

('prompts', '{
    "enable_auto": true,
    "max_items": 6,
    "sort": "popular",
    "section_title": "AI 提示词工作室",
    "section_subtitle": "让创作更高效，让灵感更自由"
}'::JSONB, 2),

('shop', '{
    "enable_auto": true,
    "max_items": 8,
    "category": "all",
    "sort": "popular",
    "section_title": "精选资源商城",
    "section_subtitle": "优质资源，助力成长"
}'::JSONB, 3),

('verify', '{
    "enable_auto": true,
    "screenshot_path": "/assets/verify-preview.png",
    "section_title": "Gemini API 验证",
    "section_subtitle": "快速验证您的 API 密钥，实时返回结果",
    "features": ["免费", "实时", "安全"]
}'::JSONB, 4),

('guestbook', '{
    "enable_auto": true,
    "max_items": 5,
    "section_title": "留言板",
    "section_subtitle": "用户的声音"
}'::JSONB, 5),

('ticker', '{
    "enable_auto": true,
    "speed": 30,
    "enable_prompts": true,
    "enable_products": true
}'::JSONB, 6);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_homepage_config_section ON homepage_config(section);
CREATE INDEX IF NOT EXISTS idx_homepage_config_visible ON homepage_config(is_visible);

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
CREATE OR REPLACE FUNCTION fn_get_homepage_config()
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
    SELECT section, content, is_visible, display_order
    FROM homepage_config
    WHERE is_visible = true
    ORDER BY display_order ASC;
$$;

COMMENT ON TABLE homepage_config IS '主页内容配置表，存储各区块的自定义内容和展示设置';
COMMENT ON COLUMN homepage_config.section IS '区块标识符，唯一';
COMMENT ON COLUMN homepage_config.content IS 'JSON 格式的配置数据，结构根据 section 类型而异';
COMMENT ON COLUMN homepage_config.is_visible IS '是否在主页显示该区块';
COMMENT ON COLUMN homepage_config.display_order IS '显示顺序，数字越小越靠前';
