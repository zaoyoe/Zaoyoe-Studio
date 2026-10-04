-- Read-only verifier for 20261004_guest_shop_quantity_ceiling_99.sql.
-- Codex does not execute this file. It reports the installed constraints and
-- function guards without exposing order contents or secrets.
WITH constraints AS (
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid IN (
        to_regclass('public.guest_shop_orders'),
        to_regclass('public.guest_shop_discount_redemptions')
    )
      AND conname IN ('guest_shop_orders_quantity_check', 'guest_shop_discount_redemptions_qty_check')
), functions AS (
    SELECT p.proname, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    WHERE p.oid IN (
        to_regprocedure('public.fn_guest_shop_evaluate_discount(text,uuid,uuid,integer,numeric,text,uuid,text,text,integer,integer)'),
        to_regprocedure('public.fn_guest_shop_reserve_discount(text,uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,integer,integer)'),
        to_regprocedure('public.fn_guest_shop_create_order(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)'),
        to_regprocedure('public.fn_guest_shop_admin_manual_fulfill(uuid,text,uuid,text)')
    )
)
SELECT * FROM (
    SELECT 'orders_quantity_check' AS check_name,
           EXISTS (SELECT 1 FROM constraints WHERE conname = 'guest_shop_orders_quantity_check' AND lower(definition) LIKE '%quantity <= 99%') AS ok,
           COALESCE((SELECT definition FROM constraints WHERE conname = 'guest_shop_orders_quantity_check'), 'missing') AS detail
    UNION ALL
    SELECT 'discount_redemptions_quantity_check',
           EXISTS (SELECT 1 FROM constraints WHERE conname = 'guest_shop_discount_redemptions_qty_check' AND lower(definition) LIKE '%quantity <= 99%'),
           COALESCE((SELECT definition FROM constraints WHERE conname = 'guest_shop_discount_redemptions_qty_check'), 'missing')
    UNION ALL
    SELECT 'evaluate_quantity_guard',
           EXISTS (SELECT 1 FROM functions WHERE proname = 'fn_guest_shop_evaluate_discount' AND lower(definition) LIKE '%quantity > 99%'),
           COALESCE((SELECT 'evaluate guard present' FROM functions WHERE proname = 'fn_guest_shop_evaluate_discount'), 'missing')
    UNION ALL
    SELECT 'reserve_quantity_guard',
           EXISTS (SELECT 1 FROM functions WHERE proname = 'fn_guest_shop_reserve_discount' AND lower(definition) LIKE '%quantity > 99%'),
           COALESCE((SELECT 'reserve guard present' FROM functions WHERE proname = 'fn_guest_shop_reserve_discount'), 'missing')
    UNION ALL
    SELECT 'manual_fulfill_quantity_guard',
           EXISTS (SELECT 1 FROM functions WHERE proname = 'fn_guest_shop_admin_manual_fulfill' AND lower(definition) LIKE '%quantity > 99%'),
           COALESCE((SELECT 'manual fulfillment guard present' FROM functions WHERE proname = 'fn_guest_shop_admin_manual_fulfill'), 'missing')
    UNION ALL
    SELECT 'create_quantity_guard',
           EXISTS (SELECT 1 FROM functions WHERE proname = 'fn_guest_shop_create_order' AND lower(definition) LIKE '%quantity > 99%' AND lower(definition) LIKE '%least(%99%'),
           COALESCE((SELECT 'create guard present' FROM functions WHERE proname = 'fn_guest_shop_create_order'), 'missing')
) checks
ORDER BY check_name;
