-- Migration: Store shop product images as explicit responsive asset objects.

ALTER TABLE public.shop_products
ADD COLUMN IF NOT EXISTS image_assets JSONB DEFAULT '{}'::jsonb;

UPDATE public.shop_products
SET image_assets = jsonb_build_object('original', icon_url)
WHERE (
    image_assets IS NULL
    OR jsonb_typeof(image_assets) <> 'object'
    OR image_assets = '{}'::jsonb
)
AND NULLIF(btrim(icon_url), '') IS NOT NULL
AND btrim(icon_url) !~* '^fa[srbltd]?\s';

COMMENT ON COLUMN public.shop_products.image_assets
IS 'Responsive product image asset object with original/card/thumb/home/detail URLs.';
