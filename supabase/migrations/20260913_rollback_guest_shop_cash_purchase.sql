-- Guarded rollback for 20260913_add_guest_shop_cash_purchase.sql.
-- This is only safe before any guest order exists. After rollout, disable the
-- product switch and retain the tables for paid-order fulfillment/refunds.

BEGIN;

DO $$
DECLARE
    v_order_count BIGINT := 0;
BEGIN
    IF to_regclass('public.guest_shop_orders') IS NOT NULL THEN
        SELECT COUNT(*) INTO v_order_count FROM public.guest_shop_orders;
    END IF;
    IF v_order_count > 0 THEN
        RAISE EXCEPTION 'refusing destructive guest-shop rollback: % guest orders exist; disable switches instead', v_order_count;
    END IF;
END;
$$;

DROP VIEW IF EXISTS public.admin_guest_shop_orders;
DROP TABLE IF EXISTS public.guest_shop_payment_events;
DROP TABLE IF EXISTS public.guest_shop_payment_orders;
DROP TABLE IF EXISTS public.guest_shop_inventory_reservations;
DROP TABLE IF EXISTS public.guest_shop_orders;

ALTER TABLE IF EXISTS public.shop_product_skus
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_cash_price_cny_check,
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_cash_price_intl_check,
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_max_quantity_check,
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_payment_channels_check;

ALTER TABLE IF EXISTS public.shop_product_skus
    DROP COLUMN IF EXISTS allow_guest_purchase,
    DROP COLUMN IF EXISTS guest_cash_price_cny,
    DROP COLUMN IF EXISTS guest_cash_price_intl,
    DROP COLUMN IF EXISTS guest_max_quantity,
    DROP COLUMN IF EXISTS guest_payment_channels;

ALTER TABLE IF EXISTS public.shop_products
    DROP CONSTRAINT IF EXISTS shop_products_guest_cash_price_cny_check,
    DROP CONSTRAINT IF EXISTS shop_products_guest_cash_price_intl_check,
    DROP CONSTRAINT IF EXISTS shop_products_guest_max_quantity_check,
    DROP CONSTRAINT IF EXISTS shop_products_guest_payment_channels_check;

ALTER TABLE IF EXISTS public.shop_products
    DROP COLUMN IF EXISTS allow_guest_purchase,
    DROP COLUMN IF EXISTS guest_cash_price_cny,
    DROP COLUMN IF EXISTS guest_cash_price_intl,
    DROP COLUMN IF EXISTS guest_max_quantity,
    DROP COLUMN IF EXISTS guest_payment_channels;

COMMIT;
