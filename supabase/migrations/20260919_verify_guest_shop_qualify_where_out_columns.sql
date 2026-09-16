-- Verify guest-shop WHERE-clause OUT-column qualification.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260919_guest_shop_qualify_where_out_columns.sql. This script is
-- read-only: it does not enable guest products, does not mutate orders,
-- and does not rollback 20260913/14/15/16/17/18.

WITH expected_functions AS (
    SELECT *
    FROM (
        VALUES
            (
                'fn_guest_shop_mark_fulfilled',
                'uuid, uuid',
                true,
                'search_path=public, pg_temp'
            ),
            (
                'fn_guest_shop_admin_queue_refund',
                'uuid, text, uuid, text',
                true,
                'search_path=public, pg_temp'
            ),
            (
                'fn_guest_shop_admin_manual_fulfill',
                'uuid, text, uuid, text',
                true,
                'search_path=public, pg_temp'
            )
    ) AS t(function_name, identity_args, requires_definer, expected_config)
), function_rows AS (
    SELECT
        e.function_name,
        e.identity_args,
        (p.oid IS NOT NULL) AS present,
        COALESCE(p.prosecdef, false) AS security_definer,
        EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) cfg
            WHERE cfg = e.expected_config
        ) AS search_path_pinned,
        CASE
            WHEN p.oid IS NULL THEN NULL
            ELSE pg_get_functiondef(p.oid)
        END AS def,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE
                pg_get_functiondef(p.oid) !~* '(WHERE|AND)[[:space:]]+order_id[[:space:]]*='
                AND pg_get_functiondef(p.oid) !~* '(WHERE|AND)[[:space:]]+fulfillment_status[[:space:]]*(=|<>)'
                AND pg_get_functiondef(p.oid) !~* '(WHERE|AND)[[:space:]]+payment_status[[:space:]]*='
                AND pg_get_functiondef(p.oid) !~* '(WHERE|AND)[[:space:]]+refund_status[[:space:]]*(=|NOT)'
        END AS no_unqualified_where_out_columns
    FROM expected_functions e
    LEFT JOIN pg_proc p
      ON p.oid = to_regprocedure(
          format('public.%I(%s)', e.function_name, e.identity_args)
      )::OID
), grant_rows AS (
    SELECT
        e.function_name,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'service_role'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS service_role_execute,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'anon'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS anon_execute,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'authenticated'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS authenticated_execute,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                WHERE g.grantee = 0
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS public_execute
    FROM expected_functions e
    LEFT JOIN pg_proc p
      ON p.oid = to_regprocedure(
          format('public.%I(%s)', e.function_name, e.identity_args)
      )::OID
), checks AS (
    SELECT
        1 AS sort_order,
        'target_functions_present'::TEXT AS check_name,
        jsonb_agg(
            jsonb_build_object(
                'function_name', function_name,
                'present', present,
                'security_definer', security_definer,
                'search_path_pinned', search_path_pinned
            )
            ORDER BY function_name
        ) AS observed,
        jsonb_build_array(
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_manual_fulfill',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_queue_refund',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_mark_fulfilled',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            )
        ) AS expected
    FROM function_rows

    UNION ALL

    SELECT
        2,
        'target_function_grants',
        jsonb_agg(
            jsonb_build_object(
                'function_name', function_name,
                'service_role_execute', service_role_execute,
                'anon_execute', anon_execute,
                'authenticated_execute', authenticated_execute,
                'public_execute', public_execute
            )
            ORDER BY function_name
        ),
        jsonb_build_array(
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_manual_fulfill',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_queue_refund',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_mark_fulfilled',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            )
        )
    FROM grant_rows

    UNION ALL

    SELECT
        3,
        'no_unqualified_where_out_columns',
        jsonb_agg(
            jsonb_build_object(
                'function_name', function_name,
                'present', present,
                'no_unqualified_where_out_columns', no_unqualified_where_out_columns
            )
            ORDER BY function_name
        ),
        jsonb_build_array(
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_manual_fulfill',
                'present', true,
                'no_unqualified_where_out_columns', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_queue_refund',
                'present', true,
                'no_unqualified_where_out_columns', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_mark_fulfilled',
                'present', true,
                'no_unqualified_where_out_columns', true
            )
        )
    FROM function_rows

    UNION ALL

    SELECT
        4,
        'mark_where_qualifies_order_id_and_fulfillment_status',
        jsonb_build_object(
            'present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_mark_fulfilled'),
            'has_aliased_reservation_order_id', (
                SELECT def ~* 'FROM[[:space:]]+public\.guest_shop_inventory_reservations[[:space:]]+r[[:space:]]+WHERE[[:space:]]+r\.order_id[[:space:]]*=[[:space:]]*p_order_id'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_mark_fulfilled'
            ),
            'has_aliased_update_fulfillment_status', (
                SELECT def ~* 'UPDATE[[:space:]]+public\.guest_shop_orders[[:space:]]+o[[:space:]]+SET'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_mark_fulfilled'
            ),
            'has_aliased_payment_status', (
                SELECT def ~* 'o\.payment_status[[:space:]]*=[[:space:]]*''confirmed'''
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_mark_fulfilled'
            ),
            'has_aliased_fulfillment_status', (
                SELECT def ~* 'o\.fulfillment_status[[:space:]]*<>[[:space:]]*''delivered'''
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_mark_fulfilled'
            )
        ),
        jsonb_build_object(
            'present', true,
            'has_aliased_reservation_order_id', true,
            'has_aliased_update_fulfillment_status', true,
            'has_aliased_payment_status', true,
            'has_aliased_fulfillment_status', true
        )

    UNION ALL

    SELECT
        5,
        'queue_where_qualifies_refund_status',
        jsonb_build_object(
            'present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_admin_queue_refund'),
            'has_aliased_refund_status_not_in', (
                SELECT def ~* 'o\.refund_status[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\(''succeeded'',[[:space:]]*''manual_review''\)'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_queue_refund'
            ),
            'has_aliased_refund_status_none', (
                SELECT def ~* 'o\.refund_status[[:space:]]*=[[:space:]]*''none'''
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_queue_refund'
            )
        ),
        jsonb_build_object(
            'present', true,
            'has_aliased_refund_status_not_in', true,
            'has_aliased_refund_status_none', true
        )

    UNION ALL

    SELECT
        6,
        'manual_where_qualifies_order_and_status_columns',
        jsonb_build_object(
            'present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_admin_manual_fulfill'),
            'has_aliased_reservation_order_id', (
                SELECT def ~* 'FROM[[:space:]]+public\.guest_shop_inventory_reservations[[:space:]]+r[[:space:]]+WHERE[[:space:]]+r\.order_id[[:space:]]*=[[:space:]]*p_order_id'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_manual_fulfill'
            ),
            'has_aliased_update_reservation_order_id', (
                SELECT def ~* 'r\.order_id[[:space:]]*=[[:space:]]*p_order_id'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_manual_fulfill'
            ),
            'has_aliased_payment_status', (
                SELECT def ~* 'o\.payment_status[[:space:]]*=[[:space:]]*''confirmed'''
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_manual_fulfill'
            ),
            'has_aliased_fulfillment_status', (
                SELECT def ~* 'o\.fulfillment_status[[:space:]]*=[[:space:]]*''paid_unfulfillable'''
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_manual_fulfill'
            )
        ),
        jsonb_build_object(
            'present', true,
            'has_aliased_reservation_order_id', true,
            'has_aliased_update_reservation_order_id', true,
            'has_aliased_payment_status', true,
            'has_aliased_fulfillment_status', true
        )
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        WHEN observed = expected THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM checks
ORDER BY sort_order;
