-- Allow shop_products.price_points to act as the CN site sale switch.
-- price_points_intl is already nullable for INTL-only products; keeping
-- price_points NOT NULL breaks EN product creation and tempts callers to
-- mirror INTL prices into CN. NULL now consistently means "not sold here".

ALTER TABLE public.shop_products
    ALTER COLUMN price_points DROP NOT NULL;

COMMENT ON COLUMN public.shop_products.price_points
    IS 'CN shop price. NULL means the product is not sold on the CN shop.';
