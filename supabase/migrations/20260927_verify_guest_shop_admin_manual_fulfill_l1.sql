-- Read-only verifier for 20260927_guest_shop_admin_manual_fulfill_l1.sql.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after the migration. It only reads catalog metadata and function definitions.

WITH target AS (
    SELECT
        p.oid,
        CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_functiondef(p.oid) END AS def,
        CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_function_result(p.oid) END AS result_def,
        COALESCE(p.prosecdef, false) AS security_definer,
        EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) cfg
            WHERE cfg = 'search_path=public, pg_temp'
        ) AS search_path_pinned
    FROM (VALUES (to_regprocedure(
        'public.fn_guest_shop_admin_manual_fulfill(uuid, text, uuid, text)'
    )::OID)) AS x(oid)
    LEFT JOIN pg_proc p ON p.oid = x.oid
), grants AS (
    SELECT
        COALESCE(EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
            JOIN pg_roles r ON r.oid = g.grantee
            WHERE r.rolname = 'service_role' AND g.privilege_type = 'EXECUTE'
        ), false) AS service_role_execute,
        COALESCE(EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
            WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE'
        ), false) AS public_execute,
        COALESCE(EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
            JOIN pg_roles r ON r.oid = g.grantee
            WHERE r.rolname = 'anon' AND g.privilege_type = 'EXECUTE'
        ), false) AS anon_execute,
        COALESCE(EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
            JOIN pg_roles r ON r.oid = g.grantee
            WHERE r.rolname = 'authenticated' AND g.privilege_type = 'EXECUTE'
        ), false) AS authenticated_execute
    FROM target t
    LEFT JOIN pg_proc p ON p.oid = t.oid
), checks AS (
    SELECT 1 AS sort_order,
           'function_present'::TEXT AS check_name,
           (t.oid IS NOT NULL) AS ok,
           'fn_guest_shop_admin_manual_fulfill(uuid,text,uuid,text) is installed'::TEXT AS detail
    FROM target t

    UNION ALL
    SELECT 2,
           'security_and_search_path',
           t.oid IS NOT NULL AND t.security_definer AND t.search_path_pinned,
           format('security_definer=%s; search_path_pinned=%s', t.security_definer, t.search_path_pinned)
    FROM target t

    UNION ALL
    SELECT 3,
           'service_role_only',
           g.service_role_execute
               AND NOT g.public_execute
               AND NOT g.anon_execute
               AND NOT g.authenticated_execute,
           format('service_role=%s; public=%s; anon=%s; authenticated=%s',
                  g.service_role_execute, g.public_execute, g.anon_execute, g.authenticated_execute)
    FROM grants g

    UNION ALL
    SELECT 4,
           'return_shape_has_no_secret_or_content',
           t.result_def IS NOT NULL
               AND t.result_def NOT ILIKE '%content%'
               AND t.result_def NOT ILIKE '%claim%'
               AND t.result_def NOT ILIKE '%recovery%'
               AND t.result_def NOT ILIKE '%secret%',
           COALESCE(t.result_def, 'function missing')
    FROM target t

    UNION ALL
    SELECT 5,
           'l1_quantity_supported',
           t.def IS NOT NULL
               AND t.def NOT ILIKE '%quantity <> 1%'
               AND t.def ILIKE '%quantity < 1%'
               AND t.def ILIKE '%quantity > 5%',
           'no single-item rejection; order quantity is bounded to 1..5'
    FROM target t

    UNION ALL
    SELECT 6,
           'reservation_set_locked_and_count_checked',
           t.def IS NOT NULL
               AND t.def ILIKE '%guest_shop_inventory_reservations r%'
               AND t.def ILIKE '%order by r.created_at asc, r.id asc%'
               AND t.def ILIKE '%for update%'
               AND t.def ILIKE '%v_res_total <> v_order.quantity%'
               AND t.def ILIKE '%guest_reservation_count_mismatch%',
           'whole reservation set is locked in stable order and must equal order.quantity'
    FROM target t

    UNION ALL
    SELECT 7,
           'consumed_rows_are_verified',
           t.def IS NOT NULL
               AND t.def ILIKE '%v_reservation.status = ''consumed''%'
               AND t.def ILIKE '%v_inventory.status <> ''sold''%'
               AND t.def ILIKE '%coalesce(v_inventory.is_shared, false)%',
           'already consumed cards remain sold and non-shared'
    FROM target t

    UNION ALL
    SELECT 8,
           'replacement_uses_locked_available_stock',
           t.def IS NOT NULL
               AND t.def ILIKE '%i.status = ''available''%'
               AND t.def ILIKE '%coalesce(i.is_shared, false) = false%'
               AND t.def ILIKE '%for update of i skip locked%'
               AND t.def ILIKE '%set status = ''sold''%',
           'replacement candidates are matching non-shared available rows with SKIP LOCKED'
    FROM target t

    UNION ALL
    SELECT 9,
           'inventory_shortfall_is_atomic',
           t.def IS NOT NULL
               AND t.def ILIKE '%guest_inventory_unavailable%'
               AND t.def NOT ILIKE '%exception%guest_inventory_unavailable%after%commit%',
           'stock shortfall raises inside the transaction and rolls back all changes'
    FROM target t

    UNION ALL
    SELECT 10,
           'delivered_only_after_all_reservations_consumed',
           t.def IS NOT NULL
               AND t.def ILIKE '%v_res_consumed <> v_res_total%'
               AND t.def ILIKE '%fulfillment_status = ''delivered''%'
               AND t.def ILIKE '%reservation_status = ''consumed''%',
           'order is delivered only after every reservation is consumed'
    FROM target t

    UNION ALL
    SELECT 11,
           'existing_reservation_rows_are_updated',
           t.def IS NOT NULL
               AND t.def ILIKE '%update public.guest_shop_inventory_reservations%'
               AND t.def NOT ILIKE '%insert into public.guest_shop_inventory_reservations%',
           'the audit chain is preserved; no new reservation rows are inserted'
    FROM target t
)
SELECT sort_order, check_name, ok, detail
FROM checks
ORDER BY sort_order;
