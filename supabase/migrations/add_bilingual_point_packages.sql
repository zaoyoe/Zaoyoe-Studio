-- ============================================
-- Add bilingual fields to points_packages for i18n support
-- ============================================

-- Add English translation column
ALTER TABLE points_packages 
ADD COLUMN IF NOT EXISTS name_en VARCHAR(100);

-- Comment for clarity
COMMENT ON COLUMN points_packages.name_en IS 'English package name for i18n support';

-- Update existing packages with English names
UPDATE points_packages SET name_en = 'Starter Pack' WHERE name = '新手尝鲜包';
UPDATE points_packages SET name_en = 'Value Pack' WHERE name = '超值进阶包';
UPDATE points_packages SET name_en = 'Premium Pack' WHERE name = '土豪尊享包';
