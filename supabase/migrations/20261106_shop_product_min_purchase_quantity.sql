-- ============================================
-- Migration: Add min_purchase_quantity to shop_products and shop_product_skus
-- Supports product-level and SKU-level minimum purchase quantities (起售数量)
-- ============================================

-- 1. shop_products.min_purchase_quantity
ALTER TABLE public.shop_products
    ADD COLUMN IF NOT EXISTS min_purchase_quantity INT DEFAULT 1;

UPDATE public.shop_products
SET min_purchase_quantity = 1
WHERE min_purchase_quantity IS NULL OR min_purchase_quantity < 1;

ALTER TABLE public.shop_products
    DROP CONSTRAINT IF EXISTS shop_products_min_purchase_quantity_check;

ALTER TABLE public.shop_products
    ADD CONSTRAINT shop_products_min_purchase_quantity_check
    CHECK (
        min_purchase_quantity IS NULL
        OR (min_purchase_quantity >= 1 AND min_purchase_quantity <= 9999)
    );

COMMENT ON COLUMN public.shop_products.min_purchase_quantity IS '最低起售件数，默认 1。买家单笔购买数量不得低于该值。';

-- 2. shop_product_skus.min_purchase_quantity
ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS min_purchase_quantity INT DEFAULT 1;

UPDATE public.shop_product_skus
SET min_purchase_quantity = 1
WHERE min_purchase_quantity IS NULL OR min_purchase_quantity < 1;

ALTER TABLE public.shop_product_skus
    DROP CONSTRAINT IF EXISTS shop_product_skus_min_purchase_quantity_check;

ALTER TABLE public.shop_product_skus
    ADD CONSTRAINT shop_product_skus_min_purchase_quantity_check
    CHECK (
        min_purchase_quantity IS NULL
        OR (min_purchase_quantity >= 1 AND min_purchase_quantity <= 9999)
    );

COMMENT ON COLUMN public.shop_product_skus.min_purchase_quantity IS 'SKU 级最低起售件数，默认 1。';
