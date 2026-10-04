-- Migration: 20261004_shop_flash_sale_price_decimal.sql
-- Description: Upgrade shop_products.flash_sale_price from INTEGER to NUMERIC(12,2)
-- Align CN flash_sale_price with flash_sale_price_intl and SKU decimal precision.

ALTER TABLE IF EXISTS public.shop_products
    ALTER COLUMN flash_sale_price TYPE NUMERIC(12,2)
    USING (
        CASE
            WHEN flash_sale_price IS NOT NULL THEN ROUND(flash_sale_price::NUMERIC, 2)
            ELSE NULL
        END
    );

COMMENT ON COLUMN public.shop_products.flash_sale_price IS 'CN 秒杀特价，支持 2 位小数 (NUMERIC(12,2))，与 flash_sale_price_intl 精度对齐';
