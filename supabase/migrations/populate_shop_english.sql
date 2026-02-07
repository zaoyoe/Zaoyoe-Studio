-- ============================================
-- Populate English translations for shop products
-- Note: Adjust translations as needed for your specific products
-- ============================================

-- Based on actual database records, update products with English translations
-- Product names and descriptions customized for current inventory

UPDATE shop_products 
SET 
  name_en = CASE 
    WHEN name = 'gemini' THEN 'Gemini API Key'
    WHEN name = 'zao' THEN 'Zao Service'
    WHEN name = '监控' THEN 'Monitoring Service'
    WHEN name LIKE '%gmail%' OR name LIKE '%Email%' THEN 
      CASE 
        WHEN name LIKE '%2FA%' THEN 'Gmail Account (2+ Years, 2FA Enabled, Random Region)'
        ELSE 'Gmail Account'
      END
    WHEN name LIKE '%无视地区%' THEN 
      CASE 
        WHEN name LIKE '%iOS%' THEN 'iOS App (Region-Free, 1 Month)'
        WHEN name LIKE '%Google%' THEN 'Google GWE Access (Region-Free)'
        ELSE 'Region-Free Service'
      END
    ELSE name  -- Keep original if no translation available
  END,
  description_en = CASE 
    WHEN name = 'gemini' THEN 'Official Gemini API access key for development and integration'
    WHEN name = 'zao' THEN 'Premium Zao platform service access'
    WHEN name = '监控' THEN 'Real-time monitoring service with instant alerts and analytics'
    WHEN name LIKE '%gmail%' OR name LIKE '%Email%' THEN 
      'High-quality Gmail account with 2-factor authentication and random region registration'
    WHEN name LIKE '%无视地区%' AND name LIKE '%iOS%' THEN 
      'iOS application access for one month, works in any region'
    WHEN name LIKE '%无视地区%' AND name LIKE '%Google%' THEN 
      'Google GWE (Great Wall Edition) access without region restrictions'
    ELSE description  -- Keep original if no translation available
  END
WHERE name IS NOT NULL;

-- Verify the updates
SELECT id, name, name_en, description, description_en 
FROM shop_products 
LIMIT 10;
