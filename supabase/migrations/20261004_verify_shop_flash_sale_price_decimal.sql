-- Read-only verification for 20261004_shop_flash_sale_price_decimal.sql.
-- Run in the target Supabase SQL editor after applying the migration.

SELECT
    column_name,
    data_type,
    numeric_precision,
    numeric_scale,
    CASE
        WHEN data_type = 'numeric' AND numeric_precision = 12 AND numeric_scale = 2
            THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'shop_products'
  AND column_name IN ('flash_sale_price', 'flash_sale_price_intl')
ORDER BY column_name;
