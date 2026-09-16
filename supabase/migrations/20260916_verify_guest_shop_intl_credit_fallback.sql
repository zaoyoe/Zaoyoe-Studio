-- Verify INTL credit-price fallback onto CN SKU points.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260916_guest_shop_intl_credit_fallback.sql. This script is read-only:
-- it does not enable guest products, does not mutate orders, and does not
-- rollback 20260913/14/15.

WITH helper_oid AS (
    SELECT to_regprocedure(
        'public.guest_shop_resolve_credit_unit_amount(text, numeric, numeric, boolean, jsonb, jsonb, jsonb, jsonb, numeric, numeric, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone)'
    )::OID AS oid
), helper_row AS (
    SELECT
        (h.oid IS NOT NULL) AS present,
        COALESCE(p.prosecdef, false) AS security_definer,
        COALESCE(p.provolatile, '') AS provolatile,
        EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) cfg
            WHERE cfg = 'search_path=public, pg_temp'
        ) AS search_path_pinned,
        pg_get_functiondef(h.oid) AS def
    FROM helper_oid h
    LEFT JOIN pg_proc p ON p.oid = h.oid
), grant_row AS (
    SELECT
        CASE
            WHEN h.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'service_role'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS service_role_execute,
        CASE
            WHEN h.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'anon'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS anon_execute,
        CASE
            WHEN h.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'authenticated'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS authenticated_execute,
        CASE
            WHEN h.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                WHERE g.grantee = 0
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS public_execute
    FROM helper_oid h
    LEFT JOIN pg_proc p ON p.oid = h.oid
), checks AS (
    SELECT
        1 AS sort_order,
        'intl_fallback_helper_present'::TEXT AS check_name,
        jsonb_build_object(
            'present', (SELECT present FROM helper_row),
            'security_definer', (SELECT security_definer FROM helper_row),
            'provolatile', (SELECT provolatile FROM helper_row),
            'search_path_pinned', (SELECT search_path_pinned FROM helper_row)
        ) AS observed,
        jsonb_build_object(
            'present', true,
            'security_definer', false,
            'provolatile', 's',
            'search_path_pinned', true
        ) AS expected

    UNION ALL

    SELECT
        2,
        'intl_fallback_helper_grants',
        jsonb_build_object(
            'service_role_execute', (SELECT service_role_execute FROM grant_row),
            'anon_execute', (SELECT anon_execute FROM grant_row),
            'authenticated_execute', (SELECT authenticated_execute FROM grant_row),
            'public_execute', (SELECT public_execute FROM grant_row)
        ),
        jsonb_build_object(
            'service_role_execute', true,
            'anon_execute', false,
            'authenticated_execute', false,
            'public_execute', false
        )

    UNION ALL

    SELECT
        3,
        'intl_missing_points_reuse_cn',
        jsonb_build_object(
            'has_marker', (SELECT def ILIKE '%intl_missing_points_reuse_cn%' FROM helper_row),
            'assigns_intl_first', (SELECT def ILIKE '%v_base := p_sku_price_points_intl%' FROM helper_row),
            'reuses_cn_points', (SELECT def ILIKE '%v_base := p_sku_price_points%' FROM helper_row),
            'coalesces_rules', (SELECT def ILIKE '%COALESCE(v_intl_rules, v_cn_rules)%' FROM helper_row),
            'no_product_price_fallback', (
                SELECT def !~* 'p_product_price_points|guest_cash_price'
                FROM helper_row
            ),
            'qty_fixed_to_one', (SELECT def ILIKE '%p_quantity IS DISTINCT FROM 1%' FROM helper_row),
            'flash_least', (SELECT def ILIKE '%LEAST(%' FROM helper_row)
        ),
        jsonb_build_object(
            'has_marker', true,
            'assigns_intl_first', true,
            'reuses_cn_points', true,
            'coalesces_rules', true,
            'no_product_price_fallback', true,
            'qty_fixed_to_one', true,
            'flash_least', true
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
