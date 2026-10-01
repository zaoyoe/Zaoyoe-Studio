-- Guest shop promo TTL clock.
--
-- Codex does not execute this file. Apply it in the SQL editor, then run
-- 20260926_verify_guest_shop_promo_ttl_clock.sql. Do not create an order
-- until that verify returns ok=true on every row.
--
-- fn_guest_shop_create_order (20260923) stores v_now with clock_timestamp()
-- and sets expires_at to v_now + p_ttl_seconds. Its INSERT omits created_at.
-- The column default is still NOW(), which is transaction_timestamp() and is
-- frozen at transaction start. A 600-second promo TTL is therefore later than
-- created_at + 600 seconds. The deferred C-D5 trigger raises
-- guest_promo_order_ttl_invalid, the HTTP mapper turns that into a public
-- 500, and the transaction rolls back with no order.
--
-- clock_timestamp() as the default is taken when the omitted column is
-- filled, which is after v_now was captured. expires_at = v_now + 600 seconds
-- is then no later than created_at + 600 seconds. This does not rewrite
-- existing rows, does not replace the create function, and does not enable a
-- product, SKU, quantity, coupon, or promo switch. Do not apply a
-- different promo migration in place of this file.

ALTER TABLE public.guest_shop_orders
    ALTER COLUMN created_at SET DEFAULT clock_timestamp();
