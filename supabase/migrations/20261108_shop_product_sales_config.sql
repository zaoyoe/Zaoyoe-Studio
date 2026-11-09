-- Migration: 20261108_shop_product_sales_config.sql
-- Description: Add sales_config column to shop_products for customizable sales display modes

ALTER TABLE public.shop_products
ADD COLUMN IF NOT EXISTS sales_config JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.shop_products.sales_config IS '销量展示配置：mode (1: 真实+基数, 2: 每日随机+基数, 3: 完全真实销量), base_sales, daily_random_min, daily_random_max, random_seed, start_date';
