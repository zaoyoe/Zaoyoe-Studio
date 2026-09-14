-- Verify guest-shop admin write-path RPCs.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260914_guest_shop_admin_ops.sql. This script is read-only: it does
-- not enable guest products, does not mutate orders, and does not rollback
-- 20260913.

WITH expected_functions AS (
    SELECT *
    FROM (
        VALUES
            ('guest_shop_has_active_worker_lease', 'jsonb, timestamp with time zone', false, 'search_path=public, pg_temp'),
            ('guest_shop_normalize_admin_reason', 'text', false, 'search_path=public, pg_temp'),
            ('guest_shop_merge_admin_action_metadata', 'jsonb, text, text, uuid, jsonb', false, 'search_path=public, pg_temp'),
            ('fn_guest_shop_admin_queue_refund', 'uuid, text, uuid, text', true, 'search_path=public, pg_temp'),
            ('fn_guest_shop_admin_unlock_dead_letter', 'uuid, text, uuid, text', true, 'search_path=public, pg_temp'),
            ('fn_guest_shop_admin_manual_fulfill', 'uuid, text, uuid, text', true, 'search_path=public, pg_temp')
    ) AS t(function_name, identity_args, requires_definer, expected_config)
), function_rows AS (
    SELECT
        e.function_name,
        e.identity_args,
        e.requires_definer,
        (p.oid IS NOT NULL) AS present,
        COALESCE(p.prosecdef, false) AS security_definer,
        EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) cfg
            WHERE cfg = e.expected_config
        ) AS search_path_pinned
    FROM expected_functions e
    LEFT JOIN pg_proc p
      ON p.oid = to_regprocedure(
          format('public.%I(%s)', e.function_name, e.identity_args)
      )::OID
), return_columns AS (
    SELECT
        e.function_name,
        e.identity_args,
        pg_get_function_result(p.oid) AS result_def
    FROM expected_functions e
    JOIN pg_proc p
      ON p.oid = to_regprocedure(
          format('public.%I(%s)', e.function_name, e.identity_args)
      )::OID
    WHERE e.function_name IN (
        'fn_guest_shop_admin_queue_refund',
        'fn_guest_shop_admin_unlock_dead_letter',
        'fn_guest_shop_admin_manual_fulfill'
    )
), grant_rows AS (
    SELECT
        e.function_name,
        e.identity_args,
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
), baseline_functions AS (
    SELECT COUNT(*)::INT AS present_count
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::REGNAMESPACE
      AND p.proname IN (
          'fn_guest_shop_create_order',
          'fn_guest_shop_confirm_payment',
          'fn_guest_shop_claim_fulfillment',
          'fn_guest_shop_mark_fulfilled',
          'fn_guest_shop_record_refund_result',
          'guest_shop_require_service_role'
      )
), merge_volatility AS (
    SELECT p.provolatile
    FROM pg_proc p
    WHERE p.oid = to_regprocedure(
        'public.guest_shop_merge_admin_action_metadata(jsonb, text, text, uuid, jsonb)'
    )::OID
), checks AS (
    SELECT
        1 AS sort_order,
        'admin_ops_functions'::TEXT AS check_name,
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'function_name', function_name,
                'identity_args', identity_args,
                'present', present,
                'security_definer', security_definer,
                'requires_definer', requires_definer,
                'search_path_pinned', search_path_pinned
            ) ORDER BY function_name)
            FROM function_rows
        ), '[]'::JSONB) AS observed,
        to_jsonb('six admin helper/RPC functions present with pinned search_path'::TEXT) AS expected

    UNION ALL

    SELECT
        2,
        'admin_ops_grants',
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'function_name', function_name,
                'identity_args', identity_args,
                'service_role_execute', service_role_execute,
                'anon_execute', anon_execute,
                'authenticated_execute', authenticated_execute,
                'public_execute', public_execute
            ) ORDER BY function_name)
            FROM grant_rows
        ), '[]'::JSONB),
        to_jsonb('service_role execute only; anon/authenticated/public revoked'::TEXT)

    UNION ALL

    SELECT
        3,
        'admin_ops_return_columns',
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'function_name', function_name,
                'identity_args', identity_args,
                'result_def', result_def
            ) ORDER BY function_name)
            FROM return_columns
        ), '[]'::JSONB),
        to_jsonb('write RPCs return status fields only; no content/claim/recovery'::TEXT)

    UNION ALL

    SELECT
        4,
        'baseline_atomic_rpcs_still_present',
        jsonb_build_object('present_count', (SELECT present_count FROM baseline_functions)),
        to_jsonb('20260913 atomic RPCs remain installed'::TEXT)

    UNION ALL

    SELECT
        5,
        'merge_metadata_volatility',
        jsonb_build_object(
            'provolatile', COALESCE((SELECT provolatile FROM merge_volatility), '')
        ),
        to_jsonb('guest_shop_merge_admin_action_metadata must be STABLE because it uses clock_timestamp()'::TEXT)
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        WHEN check_name = 'admin_ops_functions' THEN
            CASE
                WHEN jsonb_array_length(observed) = 6
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'present')::BOOLEAN IS NOT TRUE
                        OR (item->>'search_path_pinned')::BOOLEAN IS NOT TRUE
                        OR ((item->>'requires_definer')::BOOLEAN IS TRUE
                            AND (item->>'security_definer')::BOOLEAN IS NOT TRUE)
                        OR ((item->>'requires_definer')::BOOLEAN IS FALSE
                            AND (item->>'security_definer')::BOOLEAN IS TRUE)
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'admin_ops_grants' THEN
            CASE
                WHEN jsonb_array_length(observed) = 6
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'service_role_execute')::BOOLEAN IS NOT TRUE
                        OR (item->>'anon_execute')::BOOLEAN IS TRUE
                        OR (item->>'authenticated_execute')::BOOLEAN IS TRUE
                        OR (item->>'public_execute')::BOOLEAN IS TRUE
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'admin_ops_return_columns' THEN
            CASE
                WHEN jsonb_array_length(observed) = 3
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'result_def') ILIKE '%content%'
                        OR (item->>'result_def') ILIKE '%claim%'
                        OR (item->>'result_def') ILIKE '%recovery%'
                        OR (item->>'result_def') ILIKE '%secret%'
                 )
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'result_def') NOT ILIKE '%order_id%'
                        OR (item->>'result_def') NOT ILIKE '%order_no%'
                        OR (item->>'result_def') NOT ILIKE '%payment_status%'
                        OR (item->>'result_def') NOT ILIKE '%fulfillment_status%'
                        OR (item->>'result_def') NOT ILIKE '%refund_status%'
                        OR (item->>'result_def') NOT ILIKE '%reservation_status%'
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'baseline_atomic_rpcs_still_present' THEN
            CASE
                WHEN (observed->>'present_count')::INT >= 6 THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'merge_metadata_volatility' THEN
            CASE
                WHEN observed->>'provolatile' = 's' THEN 'PASS' ELSE 'FAIL'
            END
        ELSE 'REVIEW'
    END AS status
FROM checks
ORDER BY sort_order;
