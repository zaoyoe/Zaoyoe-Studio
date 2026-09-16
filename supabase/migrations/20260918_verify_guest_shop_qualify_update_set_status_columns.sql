-- Verify guest-shop SET-clause status-column qualification.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260918_guest_shop_qualify_update_set_status_columns.sql. This script
-- is read-only: it does not enable guest products, does not mutate orders,
-- and does not rollback 20260913/14/15/16/17.

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
            ),
            (
                'fn_guest_shop_confirm_payment',
                'uuid, uuid, text, text, text, text, numeric, text, text, boolean, boolean, boolean, boolean',
                true,
                'search_path=public, pg_temp'
            ),
            (
                'fn_guest_shop_record_refund_result',
                'uuid, text, text, text, text',
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
                'fn_guest_shop_admin_unlock_dead_letter',
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
                pg_get_functiondef(p.oid) !~* 'WHEN[[:space:]]+(fulfillment_status|refund_status)[[:space:]]*(=|IN)'
                AND pg_get_functiondef(p.oid) !~* '(THEN|ELSE)[[:space:]]+(fulfillment_status|refund_status)([^._]|$)'
        END AS no_unqualified_update_set
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
                'function_name', 'fn_guest_shop_admin_queue_refund',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_unlock_dead_letter',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_claim_fulfillment',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_confirm_payment',
                'present', true,
                'security_definer', true,
                'search_path_pinned', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_record_refund_result',
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
                'function_name', 'fn_guest_shop_admin_queue_refund',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_unlock_dead_letter',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_claim_fulfillment',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_confirm_payment',
                'service_role_execute', true,
                'anon_execute', false,
                'authenticated_execute', false,
                'public_execute', false
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_record_refund_result',
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
        'no_unqualified_update_set_status_columns',
        jsonb_agg(
            jsonb_build_object(
                'function_name', function_name,
                'present', present,
                'no_unqualified_update_set', no_unqualified_update_set
            )
            ORDER BY function_name
        ),
        jsonb_build_array(
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_queue_refund',
                'present', true,
                'no_unqualified_update_set', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_admin_unlock_dead_letter',
                'present', true,
                'no_unqualified_update_set', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_claim_fulfillment',
                'present', true,
                'no_unqualified_update_set', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_confirm_payment',
                'present', true,
                'no_unqualified_update_set', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_record_refund_result',
                'present', true,
                'no_unqualified_update_set', true
            ),
            jsonb_build_object(
                'function_name', 'fn_guest_shop_release_reservation',
                'present', true,
                'no_unqualified_update_set', true
            )
        )
    FROM function_rows

    UNION ALL

    SELECT
        4,
        'claim_update_set_qualifies_fulfillment_status',
        jsonb_build_object(
            'present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_claim_fulfillment'),
            'has_qualified_delivered_case', (
                SELECT def ~* 'WHEN[[:space:]]+v_order\.fulfillment_status[[:space:]]*=[[:space:]]*''delivered''[[:space:]]+THEN[[:space:]]+v_order\.fulfillment_status'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_claim_fulfillment'
            ),
            'has_qualified_refund_case', (
                SELECT def ~* 'WHEN[[:space:]]+v_order\.refund_status[[:space:]]*=[[:space:]]*''succeeded''[[:space:]]+THEN[[:space:]]+v_order\.refund_status'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_claim_fulfillment'
            ),
            'has_aliased_select', (
                SELECT def ~* '\(SELECT[[:space:]]+o\.fulfillment_status[[:space:]]+FROM[[:space:]]+public\.guest_shop_orders[[:space:]]+o[[:space:]]+WHERE'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_claim_fulfillment'
            )
        ),
        jsonb_build_object(
            'present', true,
            'has_qualified_delivered_case', true,
            'has_qualified_refund_case', true,
            'has_aliased_select', true
        )

    UNION ALL

    SELECT
        5,
        'unlock_update_set_qualifies_fulfillment_status',
        jsonb_build_object(
            'present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_admin_unlock_dead_letter'),
            'has_qualified_dead_letter_case', (
                SELECT def ~* 'WHEN[[:space:]]+v_order\.fulfillment_status[[:space:]]*=[[:space:]]*''dead_letter''[[:space:]]+THEN[[:space:]]+''failed'''
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_unlock_dead_letter'
            ),
            'has_qualified_else', (
                SELECT def ~* 'ELSE[[:space:]]+v_order\.fulfillment_status'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_unlock_dead_letter'
            )
        ),
        jsonb_build_object(
            'present', true,
            'has_qualified_dead_letter_case', true,
            'has_qualified_else', true
        )

    UNION ALL

    SELECT
        6,
        'confirm_and_record_update_set_qualify_status_columns',
        jsonb_build_object(
            'confirm_present', (SELECT present FROM function_rows WHERE function_name = 'fn_guest_shop_confirm_payment'),
            'confirm_has_qualified_fulfillment_in', (
                SELECT def ~* 'WHEN[[:space:]]+v_order\.fulfillment_status[[:space:]]+IN[[:space:]]*\(''delivered'',[[:space:]]*''refunded''\)'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_confirm_payment'
            ),
            'release_has_qualified_refund_case', (
                SELECT def ~* 'WHEN[[:space:]]+v_order\.refund_status[[:space:]]*=[[:space:]]*''succeeded''[[:space:]]+THEN[[:space:]]+v_order\.refund_status'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_release_reservation'
            ),
            'queue_has_qualified_refund_in', (
                SELECT def ~* 'WHEN[[:space:]]+v_order\.refund_status[[:space:]]+IN[[:space:]]*\(''pending'',[[:space:]]*''failed''\)'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_admin_queue_refund'
            ),
            'record_has_qualified_else', (
                SELECT def ~* 'ELSE[[:space:]]+v_order\.fulfillment_status'
                FROM function_rows
                WHERE function_name = 'fn_guest_shop_record_refund_result'
            )
        ),
        jsonb_build_object(
            'confirm_present', true,
            'confirm_has_qualified_fulfillment_in', true,
            'release_has_qualified_refund_case', true,
            'queue_has_qualified_refund_in', true,
            'record_has_qualified_else', true
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
