ALTER TABLE public.shop_categories
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN;

UPDATE public.shop_categories
SET is_public = true
WHERE is_public IS NULL;

ALTER TABLE public.shop_categories
    ALTER COLUMN is_public SET DEFAULT true,
    ALTER COLUMN is_public SET NOT NULL;

COMMENT ON COLUMN public.shop_categories.is_public
    IS 'Controls whether a shop category and its products are visible on the public storefront. Admin views still list every category.';

CREATE INDEX IF NOT EXISTS idx_shop_categories_public_sort
    ON public.shop_categories (is_public, sort_order);
