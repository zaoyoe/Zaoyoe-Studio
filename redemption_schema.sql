-- ============================================
-- Phase 2.2: 兑换码系统 - 数据库架构
-- ============================================

-- 1. 批次表 - 管理兑换码批次
CREATE TABLE IF NOT EXISTS redemption_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,           -- 批次名称: "闲鱼1月活动"
    package_id UUID REFERENCES points_packages(id),
    channel VARCHAR(50) DEFAULT 'manual', -- xianyu, taobao, manual, promotion
    total_count INT NOT NULL,             -- 生成总数
    used_count INT DEFAULT 0,             -- 已使用数
    status VARCHAR(20) DEFAULT 'active',  -- active, frozen, expired
    expires_at TIMESTAMPTZ,               -- 过期时间 (NULL = 永不过期)
    notes TEXT,                           -- 备注
    created_by UUID,                      -- 创建者 (管理员)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 兑换码表 - 存储所有兑换码
CREATE TABLE IF NOT EXISTS redemption_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,     -- 格式: ZY-XXXX-XXXX (大写字母+数字)
    batch_id UUID REFERENCES redemption_batches(id) ON DELETE CASCADE,
    package_id UUID REFERENCES points_packages(id),
    
    -- 状态: pending(待使用) -> locked(已锁定/发货中) -> used(已使用) / revoked(已撤销)
    status VARCHAR(20) DEFAULT 'pending',
    
    -- 锁定信息 (自动发货时锁定)
    locked_at TIMESTAMPTZ,
    external_order_id VARCHAR(100),       -- 外部订单号 (闲鱼/淘宝)
    
    -- 使用信息
    used_by UUID REFERENCES profiles(id),
    used_at TIMESTAMPTZ,
    points_granted INT,                   -- 实际发放的积分数
    
    -- 撤销信息
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    revoke_reason VARCHAR(200),
    points_deducted INT,                  -- 撤销时扣回的积分
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 索引优化
CREATE INDEX IF NOT EXISTS idx_redemption_codes_code ON redemption_codes(code);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_status ON redemption_codes(status);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_batch ON redemption_codes(batch_id);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_used_by ON redemption_codes(used_by);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_external_order ON redemption_codes(external_order_id);

CREATE INDEX IF NOT EXISTS idx_redemption_batches_status ON redemption_batches(status);
CREATE INDEX IF NOT EXISTS idx_redemption_batches_channel ON redemption_batches(channel);

-- 4. 行级安全策略 (RLS)
ALTER TABLE redemption_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemption_codes ENABLE ROW LEVEL SECURITY;

-- 管理员可以查看所有批次和兑换码
CREATE POLICY "admins_full_access_batches" ON redemption_batches
    FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "admins_full_access_codes" ON redemption_codes
    FOR ALL TO authenticated USING (public.is_admin());

-- 用户只能查看自己使用过的兑换码
CREATE POLICY "users_view_own_codes" ON redemption_codes
    FOR SELECT TO authenticated USING (used_by = auth.uid());

-- 5. 触发器: 更新批次使用计数
CREATE OR REPLACE FUNCTION fn_update_batch_used_count()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'used' AND (OLD.status IS NULL OR OLD.status != 'used') THEN
        UPDATE redemption_batches 
        SET used_count = used_count + 1 
        WHERE id = NEW.batch_id;
    ELSIF OLD.status = 'used' AND NEW.status != 'used' THEN
        UPDATE redemption_batches 
        SET used_count = GREATEST(0, used_count - 1) 
        WHERE id = OLD.batch_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_batch_used_count
AFTER INSERT OR UPDATE ON redemption_codes
FOR EACH ROW EXECUTE FUNCTION fn_update_batch_used_count();

-- ============================================
-- 完成！请在 Supabase SQL Editor 中运行此脚本
-- ============================================
