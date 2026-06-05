ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS manual_delivery BOOLEAN NOT NULL DEFAULT false;

UPDATE public.shop_product_skus s
SET manual_delivery = COALESCE(p.manual_delivery, false)
FROM public.shop_products p
WHERE s.product_id = p.id
  AND s.manual_delivery IS DISTINCT FROM COALESCE(p.manual_delivery, false);

COMMENT ON COLUMN public.shop_product_skus.manual_delivery
    IS 'When true, this specific product SKU/spec requires manual fulfillment.';
