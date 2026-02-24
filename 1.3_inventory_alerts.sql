-- 1. 为商品表添加库存告警阈值字段 (0表示不告警)
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS alert_threshold INT DEFAULT 0;

-- 2. 创建告警记录表 (用于解耦发货流程与Webhook发送，以及重试逻辑)
CREATE TABLE IF NOT EXISTS shop_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES shop_products(id),
    product_name VARCHAR(100),
    stock_count INT,
    alert_threshold INT,
    status VARCHAR(20) DEFAULT 'unresolved', -- unresolved, resolved
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- 3. 添加触发器：当库存变化且低于阈值时，自动插入告警记录
CREATE OR REPLACE FUNCTION fn_trigger_low_stock_alert()
RETURNS TRIGGER AS $$
BEGIN
    -- 只有当库存更新，且新库存 <= 阈值，且旧库存 > 阈值时触发，防止重复告警
    IF NEW.stock_count <= NEW.alert_threshold AND OLD.stock_count > OLD.alert_threshold AND NEW.alert_threshold > 0 THEN
        INSERT INTO shop_alerts (product_id, product_name, stock_count, alert_threshold)
        VALUES (NEW.id, NEW.name, NEW.stock_count, NEW.alert_threshold);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_low_stock_alert ON shop_products;
CREATE TRIGGER tr_low_stock_alert
    AFTER UPDATE OF stock_count ON shop_products
    FOR EACH ROW
    EXECUTE FUNCTION fn_trigger_low_stock_alert();

-- 4. RLS 安全策略
ALTER TABLE shop_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage shop alerts" ON shop_alerts FOR ALL USING (public.is_admin());
