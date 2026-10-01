-- Read-only verification for 20260924_guest_shop_promo_safety_gates.sql.
-- Codex does not execute this file. Every row is a reviewable PASS/FAIL fact.

WITH checks AS (
    SELECT 'stock_gate_function' AS check_name,
           to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()') IS NOT NULL AS ok,
           'C-D3/C-D4/C-D5 trigger function exists' AS detail
    UNION ALL
    SELECT 'deferred_trigger',
           EXISTS (
               SELECT 1
               FROM pg_trigger t
               WHERE t.tgrelid = 'public.guest_shop_orders'::regclass
                 AND t.tgname = 'guest_shop_promo_safety_gates'
                 AND t.tgconstraint <> 0
                 AND t.tgdeferrable
                 AND t.tginitdeferred
                 AND t.tgenabled = 'O'
                 AND t.tgfoid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
           ),
           'constraint trigger is deferred until transaction commit'
    UNION ALL
    SELECT 'reservation_deferred_trigger',
           EXISTS (
               SELECT 1
               FROM pg_trigger t
               WHERE t.tgrelid = 'public.guest_shop_inventory_reservations'::regclass
                 AND t.tgname = 'guest_shop_promo_safety_reservation_gates'
                 AND t.tgconstraint <> 0
                 AND t.tgdeferrable
                 AND t.tginitdeferred
                 AND t.tgenabled = 'O'
                 AND t.tgfoid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
           ),
           'reservation status and TTL updates are covered by the same deferred guard'
    UNION ALL
    SELECT 'stock_index',
           EXISTS (
               SELECT 1
               FROM pg_indexes
               WHERE schemaname = 'public'
                 AND indexname = 'idx_guest_shop_guest_reservations_stock_gate'
                 AND indexdef ~ $$\(product_id, inventory_source_sku_id, status\)$$
           ),
           'reservation source-snapshot stock-gate index exists'
    UNION ALL
    SELECT 'contact_index',
           EXISTS (
               SELECT 1
               FROM pg_indexes
               WHERE schemaname = 'public'
                 AND indexname = 'idx_guest_shop_orders_open_contact_gate'
                 AND indexdef ~ $$\(buyer_contact_hash, expires_at\)$$
           ),
           'open-contact index uses the global identity key'
    UNION ALL
    SELECT 'ip_index',
           EXISTS (
               SELECT 1
               FROM pg_indexes
               WHERE schemaname = 'public'
                 AND indexname = 'idx_guest_shop_orders_open_ip_gate'
                 AND indexdef ~ $$\(request_ip_hash, expires_at\)$$
           ),
           'open-IP index uses the global identity key'
    UNION ALL
    -- pg_get_functiondef() prints this as SET search_path TO 'public, pg_temp'.
    -- Matching that deparsed text is brittle, so use the catalog attributes that
    -- already passed for the other guest-shop RPCs: prosecdef plus proconfig.
    SELECT 'function_security',
           COALESCE((
               SELECT p.prosecdef
                      AND EXISTS (
                          SELECT 1
                          FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS item
                          WHERE split_part(item, '=', 1) = 'search_path'
                            AND regexp_replace(split_part(item, '=', 2), '[[:space:]]', '', 'g')
                                = 'public,pg_temp'
                      )
               FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
           ), false),
           COALESCE((
               SELECT 'prosecdef=' || p.prosecdef::TEXT
                      || '; search_path=' || COALESCE((
                          SELECT regexp_replace(split_part(item, '=', 2), '[[:space:]]', '', 'g')
                          FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS item
                          WHERE split_part(item, '=', 1) = 'search_path'
                          LIMIT 1
                      ), 'missing')
               FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
           ), 'function missing')
    UNION ALL
    SELECT 'ttl_hard_ceiling',
           EXISTS (
               SELECT 1
               FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
                 AND position('600 seconds' IN pg_get_functiondef(p.oid)) > 0
                 AND position('guest_promo_order_ttl_invalid' IN pg_get_functiondef(p.oid)) > 0
           ),
           'discounted orders have a 600-second maximum TTL'
    UNION ALL
    SELECT 'open_order_guard',
           EXISTS (
               SELECT 1
               FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
                 AND position('guest_open_orders_limit' IN pg_get_functiondef(p.oid)) > 0
                 AND position('payment_status' IN pg_get_functiondef(p.oid)) > 0
                 AND position('reservation_status' IN pg_get_functiondef(p.oid)) > 0
                 AND position('created' IN pg_get_functiondef(p.oid)) > 0
                 AND position('review' IN pg_get_functiondef(p.oid)) > 0
           ),
           'contact/IP open-order cap is present'
    UNION ALL
    SELECT 'stock_ratio_guard',
           EXISTS (
               SELECT 1
               FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
                 AND position('guest_stock_hold_limit' IN pg_get_functiondef(p.oid)) > 0
                 AND position('v_held * 100' IN pg_get_functiondef(p.oid)) > 0
                 AND position('v_total * 20' IN pg_get_functiondef(p.oid)) > 0
                 AND position('inventory_source_sku_id' IN pg_get_functiondef(p.oid)) > 0
           ),
           'guest stock hold ratio rejects at 20 percent'
    UNION ALL
    SELECT 'promo_reservation_ttl_guard',
           EXISTS (
               SELECT 1
               FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.fn_guest_shop_enforce_promo_safety_gates()')
                 AND position('v_promo_deadline' IN pg_get_functiondef(p.oid)) > 0
                 AND position('reserved_until' IN pg_get_functiondef(p.oid)) > 0
                 AND position('guest_promo_order_ttl_invalid' IN pg_get_functiondef(p.oid)) > 0
           ),
           'discounted reservations cannot outlive the 600-second order deadline'
)
SELECT check_name, ok, detail
FROM checks
ORDER BY check_name;
