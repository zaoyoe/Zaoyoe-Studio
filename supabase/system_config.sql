-- ============================================
-- SYSTEM CONFIG TABLE
-- 系统配置表 - 管理员定价系统
-- ============================================

-- 配置表
CREATE TABLE IF NOT EXISTS public.system_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_system_config_key ON public.system_config(config_key);

-- RLS
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- 管理员可读写
DROP POLICY IF EXISTS "Admins can manage config" ON public.system_config;
CREATE POLICY "Admins can manage config" ON public.system_config
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND email IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
        )
    );

-- 所有认证用户可读取（前端需要读取定价信息）
DROP POLICY IF EXISTS "Authenticated users can read config" ON public.system_config;
CREATE POLICY "Authenticated users can read config" ON public.system_config
    FOR SELECT TO authenticated
    USING (true);

-- ============================================
-- INIT DEFAULT CONFIG
-- 初始化默认配置
-- ============================================

-- 解锁定价
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('unlock_pricing', '{
    "default_points": 1,
    "vip_discount": 0.9,
    "bulk_discounts": [
        {"min_count": 5, "discount": 0.8},
        {"min_count": 10, "discount": 0.7}
    ]
}'::jsonb, '解锁定价配置')
ON CONFLICT (config_key) DO NOTHING;

-- 礼包配置
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('packages', '[
    {"id": 1, "name": "新手尝鲜包", "points": 100, "price": 9.9, "enabled": true, "sort": 1},
    {"id": 2, "name": "超值进阶包", "points": 600, "price": 49, "enabled": true, "sort": 2},
    {"id": 3, "name": "土豪尊享包", "points": 7000, "price": 299, "enabled": true, "sort": 3}
]'::jsonb, '礼包配置')
ON CONFLICT (config_key) DO NOTHING;

-- 销售渠道
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('channels', '[
    {"id": 1, "name": "闲鱼", "icon": "fish", "is_default": true},
    {"id": 2, "name": "淘宝", "icon": "shopping-cart", "is_default": false},
    {"id": 3, "name": "手动发放", "icon": "hand-paper", "is_default": false},
    {"id": 4, "name": "促销活动", "icon": "gift", "is_default": false},
    {"id": 5, "name": "内部测试", "icon": "flask", "is_default": false}
]'::jsonb, '销售渠道配置')
ON CONFLICT (config_key) DO NOTHING;

-- 积分奖励
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('rewards', '{
    "signup_bonus": 50,
    "daily_checkin": 5,
    "comment_reward": 2,
    "event_multiplier": 1.0
}'::jsonb, '积分奖励配置')
ON CONFLICT (config_key) DO NOTHING;

-- 签到系统 V2
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('checkin_system', '{
    "base_points": 5,
    "consecutive_7_points": 50,
    "perfect_month_points": 200,
    "makeup_cost_points": 10
}'::jsonb, '签到系统 V2 配置')
ON CONFLICT (config_key) DO NOTHING;

-- 推广返现配置
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('affiliate_program', '{
    "commission_rate_shop": 0.10,
    "commission_rate_agent": 0.10,
    "registration_reward_points": 0,
    "registration_reward_requires_purchase": true,
    "reward_notice": "拉新固定奖励与持续返佣可叠加发放；异常流量、作弊注册、退款订单与刷单行为不计入奖励统计。",
    "legal_disclaimer": "活动最终解释权归平台所有"
}'::jsonb, '推广返现配置')
ON CONFLICT (config_key) DO NOTHING;

-- 推广海报模板
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('affiliate_poster', '{
    "chip_label": "推广",
    "title": "专属邀请函",
    "subtitle": "扫码注册 · 即享专属奖励",
    "reward_badge_text": "",
    "invite_code_label": "邀请码",
    "qr_label": "扫码注册领取新人福利",
    "footer": "邀请好友注册，享受固定奖励与持续返佣",
    "active_template_id": "midnight",
    "templates": [
        {
            "id": "midnight",
            "name": "星幕邀请函",
            "description": "深色高级感，适合作为默认分享海报。",
            "custom_background_url": ""
        },
        {
            "id": "sunset",
            "name": "暖金品牌卡",
            "description": "暖色氛围更强，适合活动档期与节庆传播。",
            "custom_background_url": ""
        },
        {
            "id": "crystal",
            "name": "清透极简版",
            "description": "浅色留白更多，适合搭配自定义品牌底图。",
            "custom_background_url": ""
        }
    ]
}'::jsonb, '推广海报模板配置')
ON CONFLICT (config_key) DO NOTHING;

-- 系统限制
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('limits', '{
    "daily_unlock_limit": 100,
    "code_expiry_days": 30,
    "points_expiry_days": 0
}'::jsonb, '系统限制配置')
ON CONFLICT (config_key) DO NOTHING;

-- Google One 验证服务
INSERT INTO public.system_config (config_key, config_value, description) VALUES
('verify_settings', '{
    "price_per_verify": 10,
    "enabled": true,
    "verify_api_key": "",
    "verify_api_base_url": "https://iqless.icu"
}'::jsonb, 'Google One 用户 API 配置')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================
-- RPC FUNCTIONS
-- ============================================

-- 获取配置
CREATE OR REPLACE FUNCTION get_system_config(p_key TEXT)
RETURNS JSONB AS $$
BEGIN
    RETURN (SELECT config_value FROM public.system_config WHERE config_key = p_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 获取所有配置
CREATE OR REPLACE FUNCTION get_all_system_config()
RETURNS TABLE (
    config_key TEXT,
    config_value JSONB,
    description TEXT,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sc.config_key,
        sc.config_value,
        sc.description,
        sc.updated_at
    FROM public.system_config sc
    ORDER BY sc.config_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 更新配置（仅管理员）- 使用 UPSERT 模式
CREATE OR REPLACE FUNCTION update_system_config(
    p_key TEXT,
    p_value JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    -- 检查管理员权限
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND email IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    ) INTO v_is_admin;
    
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;
    
    -- 使用 UPSERT 模式：如果键不存在则插入，存在则更新
    INSERT INTO public.system_config (config_key, config_value, updated_by, updated_at)
    VALUES (p_key, p_value, auth.uid(), NOW())
    ON CONFLICT (config_key) DO UPDATE SET
        config_value = EXCLUDED.config_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 权限授予
GRANT EXECUTE ON FUNCTION get_system_config(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_system_config() TO authenticated;
GRANT EXECUTE ON FUNCTION update_system_config(TEXT, JSONB) TO authenticated;
