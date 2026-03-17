-- ============================================
-- 商品“注意事项”功能 - 数据库变更
-- ============================================

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS show_purchase_notes BOOLEAN DEFAULT false;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS purchase_notes TEXT;
