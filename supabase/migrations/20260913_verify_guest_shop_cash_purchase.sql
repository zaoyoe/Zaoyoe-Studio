-- Read-only verification for the guest cash purchase foundation.
-- Run after the forward migration and return the result sets to the implementer.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
      'guest_shop_orders',
      'guest_shop_inventory_reservations',
      'guest_shop_payment_orders',
      'guest_shop_payment_events'
  )
ORDER BY 1;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      table_name IN ('guest_shop_orders', 'guest_shop_inventory_reservations', 'guest_shop_payment_orders', 'guest_shop_payment_events')
      OR (table_name = 'shop_products' AND column_name LIKE 'guest_%')
      OR (table_name = 'shop_product_skus' AND column_name LIKE 'guest_%')
      OR (table_name IN ('shop_products', 'shop_product_skus') AND column_name = 'allow_guest_purchase')
  )
ORDER BY 1, 2;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
    'public.guest_shop_orders'::regclass,
    'public.guest_shop_inventory_reservations'::regclass,
    'public.guest_shop_payment_orders'::regclass,
    'public.guest_shop_payment_events'::regclass,
    'public.shop_products'::regclass,
    'public.shop_product_skus'::regclass
)
  AND conname LIKE '%guest%'
ORDER BY 1, conname;

SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'guest_shop_validate_inventory_reservation',
      'guest_shop_validate_payment_order',
      'guest_shop_validate_payment_event'
  )
ORDER BY 2, 3;

SELECT c.relname AS table_name,
       t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND t.tgname LIKE 'trg_guest_shop_%'
  AND NOT t.tgisinternal
ORDER BY 1, 2;

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('guest_shop_orders', 'guest_shop_inventory_reservations', 'guest_shop_payment_orders', 'guest_shop_payment_events')
ORDER BY 2, 3;

SELECT format('%I.%I', schemaname, indexname) AS index_name,
       format('%I.%I', schemaname, tablename) AS table_name,
       indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE '%guest%'
ORDER BY 2, 1;

SELECT COUNT(*) AS guest_orders, COUNT(*) FILTER (WHERE payment_status <> 'pending') AS non_pending_orders
FROM public.guest_shop_orders;

SELECT COUNT(*) AS enabled_guest_products
FROM public.shop_products
WHERE allow_guest_purchase = true;

SELECT COUNT(*) AS invalid_guest_order_site_currency
FROM public.guest_shop_orders
WHERE NOT ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'USD'));

SELECT COUNT(*) AS invalid_guest_payment_snapshots
FROM public.guest_shop_payment_orders p
JOIN public.guest_shop_orders o ON o.id = p.guest_order_id
WHERE p.merchant_order_no <> o.order_no
   OR p.site <> o.site
   OR p.currency <> o.currency
   OR p.expected_amount <> o.total_amount;

SELECT COUNT(*) AS invalid_guest_reservations
FROM public.guest_shop_inventory_reservations r
JOIN public.guest_shop_orders o ON o.id = r.order_id
JOIN public.shop_inventory i ON i.id = r.inventory_id
WHERE r.product_id <> o.product_id
   OR r.sku_id <> o.sku_id
   OR r.site <> o.site
   OR i.product_id IS DISTINCT FROM o.product_id
   OR (i.sku_id IS NOT NULL AND i.sku_id <> o.sku_id)
   OR COALESCE(i.is_shared, false);

SELECT COUNT(*) AS orphan_payment_events
FROM public.guest_shop_payment_events e
LEFT JOIN public.guest_shop_payment_orders p ON p.id = e.payment_order_id
WHERE p.id IS NULL AND NULLIF(BTRIM(e.merchant_order_no), '') IS NULL;
