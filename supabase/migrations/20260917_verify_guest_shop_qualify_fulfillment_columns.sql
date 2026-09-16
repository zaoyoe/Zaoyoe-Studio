-- Verify guest-shop RETURN QUERY column qualification.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260917_guest_shop_qualify_fulfillment_columns.sql. This script is
-- read-only: it does not enable guest products, does not mutate orders, and
-- does not rollback 20260913/14/15/16.

WITH expected_functions AS (
    SELECT *
    FROM (
        VALUES
            (
                'fn_guest_shop_claim_fulfillment',
                'uuid, uuid',
                true,
                'search_path=public, pg_temp'
            ),
            (
                'fn_guest_shop_release_reservation',
                'uuid, uuid, text',
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
        END AS def
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
        'claim_and_release_present'::TEXT AS check_name,
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
                'function_name', 'fn_guest_shop_claim_fulfillment',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_release_reservation',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            )
        ) AS expected
    FROM function_rows

    UNION ALL

    SELECT
        2,
        'claim_and_release_grants',
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
                'function_name', 'fn_guest_shop_claim_fulfillment',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_release_reservation',
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
        'claim_return_query_qualifies_fulfillment_status',
        jsonb_build_object(
            'present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_claim_fulfillment'),
            'has_aliased_select', (
                SELECT def ~* '\(SELECT[[:space:]]+o\.fulfillment_status[[:space:]]+FROM[[:space:]]+public\.guest_shop_orders[[:space:]]+o[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_claim_fulfillment'
            ),
            'no_unqualified_select', (
                SELECT def !~* '\(SELECT[[:space:]]+fulfillment_status[[:space:]]+FROM[[:space:]]+public\.guest_shop_orders[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_claim_fulfillment'
            )
        ),
        jsonb_build_object(
            'present', true,
            'has_aliased_select', true,
            'no_unqualified_select', true
        )

    UNION ALL

    SELECT
        4,
        'release_return_query_qualifies_status_columns',
        jsonb_build_object(
            'present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_release_reservation'),
            'has_aliased_reservation_status', (
                SELECT def ~* '\(SELECT[[:space:]]+r\.status[[:space:]]+FROM[[:space:]]+public\.guest_shop_inventory_reservations[[:space:]]+r[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_release_reservation'
            ),
            'has_aliased_payment_status', (
                SELECT def ~* '\(SELECT[[:space:]]+o\.payment_status[[:space:]]+FROM[[:space:]]+public\.guest_shop_orders[[:space:]]+o[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_release_reservation'
            ),
            'has_aliased_fulfillment_status', (
                SELECT def ~* '\(SELECT[[:space:]]+o\.fulfillment_status[[:space:]]+FROM[[:space:]]+public\.guest_shop_orders[[:space:]]+o[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_release_reservation'
            ),
            'has_aliased_refund_status', (
                SELECT def ~* '\(SELECT[[:space:]]+o\.refund_status[[:space:]]+FROM[[:space:]]+public\.guest_shop_orders[[:space:]]+o[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_release_reservation'
            ),
            'no_unqualified_select', (
                SELECT def !~* '\(SELECT[[:space:]]+(status|payment_status|fulfillment_status|refund_status)[[:space:]]+FROM[[:space:]]+public\.(guest_shop_inventory_reservations|guest_shop_orders)[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_release_reservation'
            )
        ),
        jsonb_build_object(
            'present', true,
            'has_aliased_reservation_status', true,
            'has_aliased_payment_status', true,
            'has_aliased_fulfillment_status', true,
            'has_aliased_refund_status', true,
            'no_unqualified_select', true
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
