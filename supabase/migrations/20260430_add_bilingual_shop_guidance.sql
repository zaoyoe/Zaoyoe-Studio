-- Adds bilingual guidance copy for shop product purchase notes and usage instructions.
-- The legacy purchase_notes / usage_instructions columns remain as the CN fallback for older code paths.

ALTER TABLE shop_products
ADD COLUMN IF NOT EXISTS purchase_notes_zh TEXT,
ADD COLUMN IF NOT EXISTS purchase_notes_en TEXT,
ADD COLUMN IF NOT EXISTS usage_instructions_zh TEXT,
ADD COLUMN IF NOT EXISTS usage_instructions_en TEXT;

COMMENT ON COLUMN shop_products.purchase_notes_zh IS 'Chinese purchase notes shown before checkout confirmation';
COMMENT ON COLUMN shop_products.purchase_notes_en IS 'English purchase notes shown before checkout confirmation';
COMMENT ON COLUMN shop_products.usage_instructions_zh IS 'Chinese usage instructions shown after successful purchase';
COMMENT ON COLUMN shop_products.usage_instructions_en IS 'English usage instructions shown after successful purchase';

UPDATE shop_products
SET purchase_notes_zh = COALESCE(NULLIF(purchase_notes_zh, ''), purchase_notes)
WHERE purchase_notes IS NOT NULL
  AND NULLIF(purchase_notes, '') IS NOT NULL
  AND NULLIF(COALESCE(purchase_notes_zh, ''), '') IS NULL;

UPDATE shop_products
SET usage_instructions_zh = COALESCE(NULLIF(usage_instructions_zh, ''), usage_instructions)
WHERE usage_instructions IS NOT NULL
  AND NULLIF(usage_instructions, '') IS NOT NULL
  AND NULLIF(COALESCE(usage_instructions_zh, ''), '') IS NULL;
