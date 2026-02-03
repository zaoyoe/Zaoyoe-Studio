-- ============================================
-- Add bilingual fields to shop_products for i18n support
-- ============================================

-- Add English translation columns
ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS name_en VARCHAR(200),
ADD COLUMN IF NOT EXISTS description_en TEXT;

-- Comment for clarity
COMMENT ON COLUMN shop_products.name_en IS 'English product name (auto-translated or manually set)';
COMMENT ON COLUMN shop_products.description_en IS 'English product description (auto-translated or manually set)';
