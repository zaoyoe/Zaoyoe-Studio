ALTER TABLE public.shop_products
    ADD COLUMN IF NOT EXISTS manual_delivery BOOLEAN;

UPDATE public.shop_products
SET manual_delivery = false
WHERE manual_delivery IS NULL;

ALTER TABLE public.shop_products
    ALTER COLUMN manual_delivery SET DEFAULT false,
    ALTER COLUMN manual_delivery SET NOT NULL;

COMMENT ON COLUMN public.shop_products.manual_delivery
    IS 'When true, the product remains visible in the storefront but cannot be self-service purchased or added to cart.';

CREATE INDEX IF NOT EXISTS idx_shop_products_manual_delivery_active
    ON public.shop_products (manual_delivery, is_active);
