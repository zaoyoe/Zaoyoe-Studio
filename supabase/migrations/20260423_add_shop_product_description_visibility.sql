ALTER TABLE public.shop_products
ADD COLUMN IF NOT EXISTS show_product_description BOOLEAN DEFAULT true;

UPDATE public.shop_products
SET show_product_description = true
WHERE show_product_description IS NULL;
